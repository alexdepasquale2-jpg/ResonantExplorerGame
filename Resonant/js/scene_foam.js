/* Resonant — the Quantum Foam scope. Rungs 0–1, and no body allowed.
 *
 * ── The rule that only exists here ────────────────────────────────────────
 *
 * **You are ejected from whatever you were riding on arrival.** A body is a
 * persistent arrangement of matter, and there is no such thing at 10⁻³⁵ m —
 * nothing here lasts long enough to be arranged. Being thrown back to the bare
 * mote teaches that in one second, and no amount of explanatory text would do
 * it as well. It is also the only place in the game where a scope takes
 * something away from you, which is worth exactly once.
 *
 * ── What the scope is made of ─────────────────────────────────────────────
 *
 * Virtual pairs. Each one borrows energy against time and pays it back by
 * annihilating, and how long it gets is `persistence` — the axis a player has
 * been reading everywhere else in the game, doing here what it says on the tin.
 * A Memory (1.00) hangs around long enough to be worked; a Seed (0.10) is gone
 * before the reticle catches it. The whole field seethes because everything in
 * it is a countdown.
 *
 * ── What you can find only here ───────────────────────────────────────────
 *
 * **A fluctuation that did not cancel.** Rarely, a pair separates far enough
 * that it cannot recombine, and what was borrowed is never repaid — which, at
 * the largest scale, is the reason there is anything at all rather than nothing.
 * Finding one is the scope's discovery, it is worth a great deal, and it is
 * derived rather than rolled, so a given fluctuation at a given address is
 * always the one that survives.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, hashF, hashN, TAU } = RS.core;

  const PAIR_COUNT = 40;

  /* How long a pair lasts, in local seconds. The energy–time uncertainty
   * relation says a bigger borrowing is a shorter one, and `persistence` is
   * exactly the game's word for how long a thing insists on existing — so the
   * two line up without either having to be bent. */
  function lifetimeOf(ess, scale) {
    const p = RS.emergence.axes(ess).p;
    /* Divided by the rung's clock: the Planck rung runs 34× and the quantum
     * rung 12×, so the same essence seethes visibly faster one rung in. */
    const clock = Math.max(0.02, RS.cosmos.clockAt(scale));
    return lerp(0.12, 2.4, p) / clock * 12;
  }

  /* Does this pair separate far enough to escape recombination? Rare, derived,
   * and stable per address — a survivor is always a survivor. */
  function survivesAt(seed, i) {
    return (hashN(seed >>> 0, i, 0x501171) % 23) === 0;
  }

  function foamAt(game, scale, t, out) {
    const o = out || {};
    const pairs = o.pairs || (o.pairs = []);
    pairs.length = 0;
    const seed = hashN(game.seed ^ 0xF0A3, Math.round(scale * 8), 0x11);

    let survivors = 0;
    for (let i = 0; i < PAIR_COUNT; i++) {
      const h = hashN(seed, i, 3);
      const ess = RS.fractal.essenceAt(game.seed, i * 331, Math.round(scale * 100));
      const life = lifetimeOf(ess, scale);
      /* Each pair runs its own cycle with its own offset, so the field
       * seethes rather than blinking in unison. */
      const off = hashF(h, 1) * life;
      const age = ((t + off) % life + life) % life;
      const u = age / life;
      const survives = survivesAt(seed, i);
      if (survives) survivors++;

      const ang = hashF(h, 2) * TAU;
      const rad = Math.sqrt(hashF(h, 3)) * 0.92;
      /* Separation: the pair springs apart and, unless it is a survivor,
       * comes back together to annihilate. That arc *is* the mechanic — a
       * pair is only workable near the top of it. */
      const sep = survives
        ? clamp01(u * 1.6) * 0.30
        : Math.sin(u * Math.PI) * 0.16;

      pairs.push({
        i, essence: ess,
        x: Math.cos(ang) * rad, y: Math.sin(ang) * rad,
        ang, sep, life, age, u,
        survives,
        /* Presence: fades in at birth and out at annihilation, so the field
         * reads as a boil rather than a strobe. A survivor never fades. */
        presence: survives ? clamp01(u * 4) : clamp01(Math.sin(u * Math.PI) * 1.8),
        hue: 268 + hashF(h, 4) * 60 - 30
      });
    }
    o.pairs = pairs;
    o.survivors = survivors;
    o.scale = scale;
    o.t = t;
    return o;
  }

  /* Ejection. Called on arrival, and it is the scope's whole introduction. */
  function eject(game, bus) {
    if (!game.inhabiting) return null;
    const arch = RS.vessel.archOf(game.body);
    if (arch && arch.medium && arch.medium.indexOf(RS.vessel.MEDIUM.FOAM) >= 0) return null;
    RS.scenes.disembark(game, bus);
    bus.emit('foam:eject', { arch });
    return arch;
  }

  function enter(game, bus) {
    const s = game.scene;
    s.foamT = s.foamT || 0;
    eject(game, bus);
    s.foam = foamAt(game, game.dials.space.value, s.foamT, s.foam);
    bus.emit('foam:enter', { foam: s.foam });
    return s.foam;
  }

  function tick(game, bus, dt) {
    const s = game.scene;
    const D = game.dials;
    s.foamT = (s.foamT || 0) + dt * Math.abs(D.time.value);
    s.foam = foamAt(game, D.space.value, s.foamT, s.foam);
    /* Existing bodies still cannot be taken here. The flucton is a pair, not
     * a lump of matter, so it is allowed to stay. */
    if (game.inhabiting) {
      const arch = RS.vessel.archOf(game.body);
      if (!arch || arch.medium.indexOf(RS.vessel.MEDIUM.FOAM) < 0) eject(game, bus);
    }
  }

  /* What working a survivor is worth. Large on purpose: it is rare, it is the
   * scope's only discovery, and it is the reason the universe is not empty. */
  function bonusFor(game) {
    const s = game.scene;
    if (s.kind !== 'foam' || !s.foam) return 1;
    return 1 + clamp01(s.foam.survivors / 4) * 2.4;
  }

  function readout(game) {
    const s = game.scene;
    const f = s.foam;
    if (!f) return { title: 'Quantum Foam', sub: 'resolving…' };
    /* Mean lifetime across what is currently manifesting — the number that
     * tells a player whether slowing τ down would help. */
    let life = 0;
    for (const p of f.pairs) life += p.life;
    life /= Math.max(1, f.pairs.length);
    return {
      title: 'Quantum Foam',
      sub: 'No body persists here. Pairs borrow existence and pay it back.',
      survivors: f.survivors,
      meanLife: life,
      bonus: bonusFor(game)
    };
  }

  RS.foam = {
    PAIR_COUNT, lifetimeOf, survivesAt, foamAt, eject, enter, tick, bonusFor, readout
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
