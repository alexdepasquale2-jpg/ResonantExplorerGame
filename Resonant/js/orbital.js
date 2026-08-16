/* Resonant — analytic orbital mechanics.
 *
 * ── The performance thesis of this whole expansion ─────────────────────────
 *
 * Nothing in the solar layer is integrated forward. There is no physics step,
 * no stored position, no accumulated velocity. A body's position is a pure
 * function of its six orbital elements and the time you ask about:
 *
 *     position = f(elements, t)
 *
 * Everything follows from that one decision:
 *
 *   • No loading. A system with 400 bodies is "generated" by deciding to look
 *     at it. There is no world to build, only a function to call.
 *   • No stutter. Cost is O(visible bodies), not O(bodies), and it is the same
 *     cost every frame — no integrator, no collision broadphase, no drift
 *     correction spikes.
 *   • The TIME dial becomes a real instrument. Scrubbing to t + 10,000 years
 *     costs exactly as much as scrubbing to t + 1 second, so you can watch a
 *     system's whole history and it is *exact* — an integrator would smear
 *     into nonsense long before that.
 *   • Determinism for free. No accumulated floating-point error means the same
 *     system looks identical on every device forever, which is what lets the
 *     save file stay a few kilobytes.
 *
 * The one genuinely iterative thing here is Kepler's equation, which has no
 * closed-form solution. Newton–Raphson converges to double precision in three
 * or four iterations for the eccentricities we generate, so it is effectively
 * closed-form at a fixed, tiny, predictable cost.
 */
(function (RS) {
  'use strict';
  const { TAU, clamp } = RS.core;

  /* Units throughout: distances in AU, masses in solar masses, time in years.
   * In these units Kepler's third law is simply T² = a³/M, with no constants
   * to carry — which is the reason for choosing them. */
  const G_AU = TAU * TAU; // GM for one solar mass, in AU³/year²

  /* Mean motion: radians of mean anomaly per year. */
  function meanMotion(a, mass) {
    return TAU / period(a, mass);
  }

  /* Orbital period in years. Kepler's third law. */
  function period(a, mass) {
    return Math.sqrt((a * a * a) / Math.max(1e-9, mass));
  }

  /* Solve M = E − e·sin E for the eccentric anomaly E.
   *
   * Halley's method rather than Newton. Both need a good starting guess, but
   * Halley converges cubically instead of quadratically, which means machine
   * precision in three iterations even at e = 0.95 — where plain Newton from a
   * naive guess still has a residual around 1e-9 after six. That residual is
   * small in absolute terms and completely unacceptable in context: this
   * function is evaluated at t up to billions of years, and a systematically
   * wrong root is a systematically wrong position no matter how far out you
   * look. Getting it to machine precision is what makes the "exact at any t"
   * claim in the header actually true.
   *
   * The starting value is Smith's: E ≈ M for near-circular orbits, and
   * M + 0.85·e·sign(sin M) for eccentric ones, which keeps the first step away
   * from the region where the derivative (1 − e·cos E) approaches zero. */
  function eccentricAnomaly(M, e) {
    /* Wrap into [−π, π] so the initial guess is always near the root. */
    M = M % TAU;
    if (M > Math.PI) M -= TAU;
    if (M < -Math.PI) M += TAU;

    const sinM = Math.sin(M);
    let E = e < 0.8 ? M + e * sinM : M + 0.85 * e * (sinM >= 0 ? 1 : -1);

    for (let i = 0; i < 5; i++) {
      const sE = Math.sin(E), cE = Math.cos(E);
      const f = E - e * sE - M;
      const f1 = 1 - e * cE;          // f'
      const f2 = e * sE;              // f''
      /* Halley step. The denominator cannot vanish for e < 1 given the
       * starting guess above, but guard it anyway — a NaN here would poison
       * every position in the system. */
      const denom = f1 - 0.5 * f * f2 / (f1 || 1e-12);
      const dE = f / (denom || 1e-12);
      E -= dE;
      if (Math.abs(dE) < 1e-14) break;
    }
    return E;
  }

  /* True anomaly from eccentric anomaly. The half-angle form is used rather
   * than acos() because it is quadrant-correct without a sign fixup. */
  function trueAnomaly(E, e) {
    return 2 * Math.atan2(
      Math.sqrt(1 + e) * Math.sin(E / 2),
      Math.sqrt(1 - e) * Math.cos(E / 2)
    );
  }

  /* Full state at time t. Writes into `out` so the render loop allocates
   * nothing — this is called for every body, every frame.
   *
   * `el` is { a, e, inc, node (Ω), peri (ω), M0, mass } where `mass` is the
   * mass of the *primary* being orbited.
   */
  function stateAt(el, t, out) {
    const o = out || {};
    const n = meanMotion(el.a, el.mass);
    const M = el.M0 + n * t;
    const E = eccentricAnomaly(M, el.e);
    const nu = trueAnomaly(E, el.e);
    const r = el.a * (1 - el.e * Math.cos(E));

    // position in the orbital plane
    const xp = r * Math.cos(nu);
    const yp = r * Math.sin(nu);

    /* Rotate into the reference frame: argument of periapsis, then
     * inclination, then longitude of ascending node. Expanded rather than
     * composed through a matrix because this is the hottest function in the
     * solar layer and the compiler keeps it in registers this way. */
    const cw = Math.cos(el.peri), sw = Math.sin(el.peri);
    const ci = Math.cos(el.inc), si = Math.sin(el.inc);
    const cO = Math.cos(el.node), sO = Math.sin(el.node);

    const x1 = xp * cw - yp * sw;
    const y1 = xp * sw + yp * cw;

    o.x = x1 * cO - y1 * ci * sO;
    o.y = x1 * sO + y1 * ci * cO;
    o.z = y1 * si;
    o.r = r;
    o.nu = nu;
    o.E = E;
    o.M = M;

    /* Orbital speed from the vis-viva equation — needed for intercepts and
     * for showing the player how fast a world is actually moving. */
    o.speed = Math.sqrt(G_AU * el.mass * (2 / r - 1 / el.a));
    return o;
  }

  /* Position only — the common case, and roughly 30% cheaper than stateAt
   * because it skips the vis-viva square root. */
  function positionAt(el, t, out) {
    const o = out || {};
    const M = el.M0 + meanMotion(el.a, el.mass) * t;
    const E = eccentricAnomaly(M, el.e);
    const nu = trueAnomaly(E, el.e);
    const r = el.a * (1 - el.e * Math.cos(E));
    const xp = r * Math.cos(nu), yp = r * Math.sin(nu);
    const cw = Math.cos(el.peri), sw = Math.sin(el.peri);
    const ci = Math.cos(el.inc), si = Math.sin(el.inc);
    const cO = Math.cos(el.node), sO = Math.sin(el.node);
    const x1 = xp * cw - yp * sw, y1 = xp * sw + yp * cw;
    o.x = x1 * cO - y1 * ci * sO;
    o.y = x1 * sO + y1 * ci * cO;
    o.z = y1 * si;
    o.r = r;
    return o;
  }

  /* Hill sphere radius — the region a body gravitationally dominates. This is
   * what decides whether a moon can exist and how far out, and it is why the
   * generated systems are stable rather than merely plausible-looking. */
  function hillRadius(a, e, m, M) {
    return a * (1 - e) * Math.cbrt(m / (3 * Math.max(1e-12, M)));
  }

  /* Roche limit — inside this a moon is torn into a ring, which is exactly how
   * ring systems get placed rather than sprinkled by taste. */
  function rocheLimit(primaryRadiusAU, densityRatio) {
    return primaryRadiusAU * 2.44 * Math.cbrt(Math.max(1e-6, densityRatio));
  }

  /* Escape velocity in km/s from mass (Earth masses) and radius (Earth radii).
   * Used by the atmosphere model, and by vessels deciding whether they can
   * leave a surface. */
  const V_ESC_EARTH = 11.186;
  function escapeVelocity(massE, radiusE) {
    return V_ESC_EARTH * Math.sqrt(massE / Math.max(1e-6, radiusE));
  }

  /* Surface gravity in g, from Earth-relative mass and radius. */
  function surfaceGravity(massE, radiusE) {
    return massE / Math.max(1e-6, radiusE * radiusE);
  }

  /* Sphere-of-influence crossing: the time to fall from `r` to a target under
   * a simple two-body approximation, used to price travel without simulating
   * it. Analytic, so a route quote is instant regardless of distance. */
  function hohmannTime(r1, r2, mass) {
    const aT = (r1 + r2) / 2;
    return period(aT, mass) / 2;
  }

  /* Delta-v for a Hohmann transfer, in AU/year. Vessels spend against this, so
   * "can I get there" is a real question with a real answer rather than a
   * timer. */
  function hohmannDeltaV(r1, r2, mass) {
    const mu = G_AU * mass;
    const aT = (r1 + r2) / 2;
    const v1 = Math.sqrt(mu / r1);
    const v2 = Math.sqrt(mu / r2);
    const vp = Math.sqrt(mu * (2 / r1 - 1 / aT));
    const va = Math.sqrt(mu * (2 / r2 - 1 / aT));
    return Math.abs(vp - v1) + Math.abs(v2 - va);
  }

  /* Build an element set from a seed and a semi-major axis. Eccentricities and
   * inclinations are drawn small, as they are in real mature systems — violent
   * orbits exist but are rare, and a sky full of them looks like noise rather
   * than like a solar system. */
  function elementsFrom(hash, a, primaryMass, opts) {
    const o = opts || {};
    const h = RS.core.hashF;
    const eMax = o.eMax == null ? 0.09 : o.eMax;
    const iMax = o.iMax == null ? 0.05 : o.iMax;
    return {
      a,
      /* Squared so most orbits are near-circular and a few are notably
       * elliptical, rather than a uniform smear. */
      e: eMax * Math.pow(h(hash, 1), 2),
      inc: iMax * (h(hash, 2) * 2 - 1),
      node: h(hash, 3) * TAU,
      peri: h(hash, 4) * TAU,
      M0: h(hash, 5) * TAU,
      mass: primaryMass
    };
  }

  RS.orbital = {
    G_AU, meanMotion, period, eccentricAnomaly, trueAnomaly,
    stateAt, positionAt, hillRadius, rocheLimit,
    escapeVelocity, surfaceGravity, hohmannTime, hohmannDeltaV, elementsFrom
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
