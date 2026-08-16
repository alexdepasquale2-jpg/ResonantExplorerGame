/* Resonant — stellar physics and system architecture.
 *
 * Every star and every system is derived from its address by formula. Nothing
 * is authored, nothing is stored, and — the part that matters — nothing is
 * *arbitrary*: a star's mass is the only free parameter, and its luminosity,
 * radius, temperature, colour, lifetime, spectral class, habitable zone and
 * frost line all fall out of that one number through real astrophysical
 * relations. Then the frost line decides where gas giants can form, the
 * habitable zone decides where biospheres can appear, and the metallicity
 * decides how much rock there was to build with.
 *
 * That chain is why "the role of each star" is a real mechanic rather than a
 * label. An M dwarf gives you a tight, tidally-locked habitable zone hugging
 * a dim red star and a system you can cross cheaply. A blue B-class star gives
 * you an enormous habitable zone, spectacular flux, and a main-sequence
 * lifetime too short for anything complex to have evolved in it. The player
 * learns to read a system's whole biography off its colour, because the
 * colour and the biography come from the same variable.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, hashF, hashN, TAU } = RS.core;

  /* The block's numbers, read live rather than closed over — stepping into an
   * ensemble node swaps the physics under everything, and a cached constant
   * would quietly keep deriving the old universe. Geometry stays fixed: a solar
   * radius is a unit of length, not a law. */
  const P = RS.physics;
  const AU_PER_SOLAR_RADIUS = 0.00465047;
  const EARTH_MASSES_PER_SOLAR = 332946;

  /* ── Initial mass function ────────────────────────────────────────────────
   * Salpeter-style power law, inverse-transform sampled. The exponent is what
   * makes the galaxy overwhelmingly M dwarfs with a scattering of giants —
   * which is both true and much better design than a uniform spread, because
   * it makes a big star an event. */
  function sampleMass(u) {
    const a = P.imfAlpha(), lo = P.mMin(), hi = P.mMax();
    const pLo = Math.pow(lo, 1 - a);
    const pHi = Math.pow(hi, 1 - a);
    return Math.pow(pLo + u * (pHi - pLo), 1 / (1 - a));
  }

  /* ── Mass–luminosity relation ─────────────────────────────────────────────
   * Piecewise, as observed. The breaks are real: below ~0.43 M☉ the star is
   * fully convective, above ~2 M☉ radiation pressure starts to dominate. */
  function luminosityOf(m) {
    const b = P.get();
    if (m < 0.43) return 0.23 * Math.pow(m, b.mlLow);
    if (m < 2) return Math.pow(m, b.mlMid);
    if (m < 55) return 1.4 * Math.pow(m, b.mlHigh);
    return 32000 * m;
  }

  /* Mass–radius, also piecewise around solar. */
  function radiusOf(m) {
    return m < 1 ? Math.pow(m, 0.8) : Math.pow(m, 0.57);
  }

  /* Effective temperature by inverting Stefan–Boltzmann: L = 4πR²σT⁴. In solar
   * units that collapses to T = T☉·(L/R²)^¼. */
  function temperatureOf(L, R) {
    return P.tSun() * Math.pow(L / (R * R), 0.25);
  }

  /* Main-sequence lifetime in Gyr. Fuel scales with mass, burn rate with
   * luminosity — so the biggest stars live the shortest lives by far, and that
   * single fact governs where complex life can be found. */
  function lifetimeOf(m, L) { return 10 * (m / L); }

  const CLASSES = [
    { c: 'O', min: 30000, hue: 225, name: 'blue' },
    { c: 'B', min: 10000, hue: 215, name: 'blue-white' },
    { c: 'A', min: 7500, hue: 205, name: 'white' },
    { c: 'F', min: 6000, hue: 55, name: 'yellow-white' },
    { c: 'G', min: 5200, hue: 48, name: 'yellow' },
    { c: 'K', min: 3700, hue: 28, name: 'orange' },
    { c: 'M', min: 0, hue: 12, name: 'red' }
  ];

  function classify(T) {
    for (const c of CLASSES) if (T >= c.min) return c;
    return CLASSES[CLASSES.length - 1];
  }

  /* Habitable zone from luminosity alone — the classic conservative bounds,
   * scaled by the inverse-square law. */
  function habitableZone(L) {
    return { inner: Math.sqrt(L / 1.1), outer: Math.sqrt(L / 0.53) };
  }

  /* Frost line: where volatiles can condense into solids. Everything about a
   * system's architecture hinges on this — rocky worlds inside, gas and ice
   * giants outside, because outside there was simply far more solid material
   * to accrete. */
  function frostLine(L) { return 4.85 * Math.sqrt(L); }

  /* Metallicity, as a radial gradient across the galaxy. The inner disc is
   * metal-rich and builds big rocky planets; the halo is metal-poor and builds
   * almost nothing. This is the one place the solar layer reaches back up to
   * the galactic layer for a parameter, and it means *where* you are in the
   * galaxy genuinely changes what you find. */
  function metallicityAt(galR) {
    /* galR is normalised galactocentric radius, 0 at the core, 1 at the rim. */
    return clamp(Math.pow(10, 0.35 - 1.1 * galR), 0.02, 3.0);
  }

  // ── star construction ────────────────────────────────────────────────────

  function makeStar(h, galR, roleIndex) {
    const m = sampleMass(hashF(h, 1));
    const L = luminosityOf(m);
    const R = radiusOf(m);
    const T = temperatureOf(L, R);
    const cls = classify(T);
    const life = lifetimeOf(m, L);
    /* Age is drawn against the star's own lifetime, so short-lived giants are
     * always found young and long-lived dwarfs are usually found old. A giant
     * that has already left the main sequence is a different object entirely. */
    const ageFrac = hashF(h, 2);
    const age = ageFrac * Math.min(life, 12);
    const evolved = age > life;

    return {
      mass: m,
      luminosity: evolved ? L * 40 : L,   // post-main-sequence swelling
      radius: evolved ? R * 30 : R,
      temperature: evolved ? T * 0.55 : T,
      cls: evolved ? { c: 'K', min: 0, hue: 18, name: 'red giant' } : cls,
      lifetime: life,
      age,
      evolved,
      metallicity: metallicityAt(galR),
      /* Digit-precision spectral subclass, purely for the readout, but it is
       * what makes a star feel catalogued rather than generated. */
      sub: Math.floor(hashF(h, 3) * 10),
      roleIndex: roleIndex || 0
    };
  }

  /* ── System multiplicity ──────────────────────────────────────────────────
   * About half of all stellar systems are multiple, and the fraction rises
   * steeply with primary mass — massive stars almost always have companions.
   * Companions matter mechanically: they truncate the disc, so a close binary
   * simply has nowhere to put outer planets. */
  function companionCount(h, primaryMass) {
    const p = clamp01(0.28 + 0.42 * Math.log10(primaryMass + 1));
    const r = hashF(h, 11);
    if (r > p) return 0;
    return hashF(h, 12) > 0.82 ? 2 : 1;
  }

  /* ── The system ───────────────────────────────────────────────────────────
   * Addressed by (worldSeed, sectorX, sectorY, index). Returns a complete
   * architecture — stars, planets, moons, belts — with no simulation and no
   * storage. Called on demand and cached only for as long as it is looked at.
   */
  function systemAt(worldSeed, sx, sy, index) {
    const h = hashN(worldSeed ^ 0x5711A5, sx, sy, index | 0);
    /* Galactocentric radius from the sector address — a system's position in
     * the galaxy is what sets its metallicity, hence its whole character. */
    const galR = clamp01(Math.hypot(sx, sy) / 64 + hashF(h, 90) * 0.12);

    const primary = makeStar(h, galR, 0);
    const nComp = companionCount(h, primary.mass);
    const stars = [primary];
    for (let i = 0; i < nComp; i++) {
      const ch = hashN(h, 200 + i);
      const s = makeStar(ch, galR, i + 1);
      /* Companions are never more massive than the primary, by definition. */
      s.mass = Math.min(s.mass, primary.mass * (0.2 + hashF(ch, 4) * 0.75));
      s.luminosity = luminosityOf(s.mass);
      s.radius = radiusOf(s.mass);
      s.temperature = temperatureOf(s.luminosity, s.radius);
      s.cls = classify(s.temperature);
      /* Separation is bimodal in reality — close spectroscopic pairs, or wide
       * visual ones. The middle is dynamically unstable and genuinely rare. */
      const wide = hashF(ch, 5) > 0.45;
      s.separation = wide ? 40 + hashF(ch, 6) * 900 : 0.05 + hashF(ch, 7) * 1.6;
      s.elements = RS.orbital.elementsFrom(hashN(ch, 8), s.separation,
        primary.mass + s.mass, { eMax: 0.5, iMax: 0.4 });
      stars.push(s);
    }

    /* Total luminosity is what the planets actually experience. A close binary
     * shifts its whole habitable zone outward. */
    const totalL = stars.reduce((a, s) => a + s.luminosity, 0);
    const hz = habitableZone(totalL);
    const frost = frostLine(totalL);

    /* Disc truncation: a close companion clears everything past about a third
     * of its separation, so those systems are compact by physical necessity
     * rather than by fiat. */
    let discOuter = 60 * Math.sqrt(primary.mass);
    for (let i = 1; i < stars.length; i++) {
      if (stars[i].separation < 200) discOuter = Math.min(discOuter, stars[i].separation * 0.33);
    }
    const discInner = Math.max(0.02, 0.034 * Math.sqrt(totalL));

    /* Planet count scales with metallicity — no metals, no planets. */
    const richness = clamp01(Math.log10(primary.metallicity + 0.05) * 0.5 + 0.72);
    const nMax = Math.floor(1 + richness * 11);
    const bodies = [];

    /* Orbits laid out as a jittered geometric progression, which is what
     * accretion actually produces and what the Titius–Bode pattern is a
     * (rough) observation of. Ratios below ~1.35 are unstable over gigayears,
     * so the floor here is a stability constraint, not a taste one. */
    let a = discInner * (1 + hashF(h, 20) * 0.6);
    let slot = 0;
    while (a < discOuter && bodies.length < nMax && slot < 24) {
      const bh = hashN(h, 300 + slot);
      const beyondFrost = a > frost;

      /* A gap: the slot exists but nothing accreted in it. Sometimes that is a
       * belt, sometimes it is genuinely empty — this is where asteroid belts
       * come from, rather than being placed. */
      const failed = hashF(bh, 1) < (beyondFrost ? 0.10 : 0.20) * (2 - richness);

      if (failed) {
        if (hashF(bh, 2) > 0.42) {
          bodies.push({
            kind: 'belt', slot, a,
            width: a * (0.12 + hashF(bh, 3) * 0.30),
            density: 0.2 + hashF(bh, 4) * 0.8,
            hash: bh,
            elements: RS.orbital.elementsFrom(bh, a, totalL, { eMax: 0.04, iMax: 0.03 })
          });
        }
      } else {
        /* Mass budget: beyond the frost line there was several times more
         * solid material available, which is why gas giants live out there and
         * why the inner system is small worlds. */
        const budget = beyondFrost ? 40 + hashF(bh, 5) * 620 : 0.02 + hashF(bh, 6) * 5.4;
        /* Metallicity scales the rocky budget hard, the gas budget less so —
         * gas is mostly hydrogen and there is always hydrogen. */
        const massE = budget * (beyondFrost ? lerp(0.55, 1.35, richness) : lerp(0.12, 1.6, richness));

        bodies.push({
          kind: 'planet', slot, a, massE,
          beyondFrost,
          hash: bh,
          elements: RS.orbital.elementsFrom(bh, a, totalL, {
            /* Hot Jupiters and scattered worlds carry real eccentricity. */
            eMax: hashF(bh, 7) > 0.9 ? 0.42 : 0.09,
            iMax: hashF(bh, 8) > 0.93 ? 0.35 : 0.05
          })
        });
      }
      /* Next slot outward. */
      a *= 1.38 + hashF(bh, 9) * 0.85;
      slot++;
    }

    return {
      addr: { sx, sy, index },
      hash: h,
      galR,
      stars, primary,
      totalLuminosity: totalL,
      hz, frost,
      discInner, discOuter,
      richness,
      bodies,
      name: nameSystem(h)
    };
  }

  /* ── Naming ───────────────────────────────────────────────────────────────
   * Catalogue-style rather than fantasy-style: a designation the player can
   * actually read structure out of, since the same address always produces the
   * same designation and a system can therefore be recognised and returned to
   * by name alone. */
  const GREEK = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta',
    'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi', 'Rho', 'Sigma', 'Tau', 'Upsilon'];
  const STEMS = ['Ker', 'Vash', 'Ald', 'Mir', 'Tesh', 'Orv', 'Cal', 'Dros', 'Nim', 'Xar',
    'Yel', 'Zon', 'Bral', 'Ith', 'Ophi', 'Rhen', 'Sil', 'Thal', 'Umb', 'Vel'];
  const TAILS = ['ani', 'ara', 'eus', 'ion', 'is', 'or', 'ux', 'ys', 'ae', 'un'];

  function nameSystem(h) {
    const g = GREEK[hashN(h, 41) % GREEK.length];
    const s = STEMS[hashN(h, 42) % STEMS.length];
    const t = TAILS[hashN(h, 43) % TAILS.length];
    return g + ' ' + s + t;
  }

  function bodyName(system, idx) {
    /* Planets take the system name plus a Roman numeral, as real catalogues
     * do. Belts get a letter. */
    const b = system.bodies[idx];
    if (!b) return system.name;
    const n = system.bodies.slice(0, idx + 1).filter(x => x.kind === b.kind).length;
    return system.name + ' ' + (b.kind === 'belt' ? 'Belt ' + String.fromCharCode(64 + n) : RS.core.romanize(n));
  }

  /* Flux received at a distance, in Earth-equivalents. The single most
   * important derived quantity for a planet — it sets temperature, which sets
   * everything else. */
  function fluxAt(system, a) {
    return system.totalLuminosity / (a * a);
  }

  /* Which stars are actually visible in a planet's sky, and how bright. Used by
   * the surface renderer, and it is why a binary system's surface looks
   * genuinely different rather than just being labelled one. */
  function skyStars(system, a) {
    return system.stars.map((s, i) => ({
      star: s, index: i,
      flux: s.luminosity / Math.max(1e-6, i === 0 ? a * a : Math.pow(Math.abs(s.separation - a) + 0.1, 2)),
      hue: s.cls.hue
    }));
  }

  RS.stellar = {
     AU_PER_SOLAR_RADIUS, EARTH_MASSES_PER_SOLAR, CLASSES,
    sampleMass, luminosityOf, radiusOf, temperatureOf, lifetimeOf, classify,
    habitableZone, frostLine, metallicityAt, makeStar, companionCount,
    systemAt, nameSystem, bodyName, fluxAt, skyStars
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
