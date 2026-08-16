/* Resonant — nowhere is empty.
 *
 * ── The problem this fixes ────────────────────────────────────────────────
 *
 * `neural.mindAt` builds a small recurrent network from any address hash and
 * steps it for about 200 multiply-adds. It has been in the codebase since the
 * solar layer landed, and exactly two things called it: creatures on a planet
 * surface, and the mind you ride. Every other scope on the twenty-two-rung
 * ladder was furniture — a cell with no traffic in it, a filament with nothing
 * moving along it, an atom whose shells were a diagram.
 *
 * A scope with nothing living in it reads as a screensaver no matter how
 * correct its physics is. This file gives every scope its own inhabitants, from
 * the same generator, at the same cost.
 *
 * ── The rule that makes them feel alive ───────────────────────────────────
 *
 * **They act before you arrive and continue after you leave.** Nothing here is
 * spawned on entry or despawned on exit, because an inhabitant that begins
 * existing when you look at it is a decoration. Instead each one's *path* is a
 * pure function of (address, scene time), so the swarm you find in a cell has
 * demonstrably been circulating for as long as that cell has existed and will
 * still be doing it when you come back — and it costs nothing while you are
 * elsewhere, because it is not being simulated. It is being *derived*.
 *
 * The mind is real, though: each inhabitant carries a genuine recurrent network
 * whose output steers it, so what it does is emergent rather than scripted, and
 * two inhabitants of the same kind at different addresses behave differently
 * because their weights differ.
 *
 * ── Cost ──────────────────────────────────────────────────────────────────
 *
 * At most `MAX_LIVE` inhabitants are stepped per frame — the ones on screen —
 * and the rest are derived positionally when needed. Minds are cached by
 * address inside `neural.js`, so revisiting a place is free.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, hashF, hashN, TAU } = RS.core;

  /* Only this many carry a stepped mind at once. Beyond that they drift on
   * their derived paths, which is indistinguishable at the sizes they are
   * drawn at and costs nothing. */
  const MAX_LIVE = 10;

  /* ── What lives where ─────────────────────────────────────────────────────
   *
   * One entry per scope. `n` is how many, `size` how big they draw, `speed`
   * how fast they work through their cycle, and `blurb` what the readout calls
   * them — because "there are things moving" is worth much less than "those are
   * transcription complexes, and they are doing something".
   */
  const KINDS = {
    foam: {
      id: 'fluctuation', name: 'Fluctuations', n: 0,
      /* The foam's pairs *are* its inhabitants and they are already derived in
       * scene_foam. Adding more would be noise on top of noise. */
      blurb: 'Nothing here persists long enough to be anything.'
    },
    shells: {
      id: 'transition', name: 'Transitions', n: 5, size: 0.008, speed: 1.4, hue: 46,
      blurb: 'Occupants dropping between states, emitting as they fall.'
    },
    molecular: {
      id: 'enzyme', name: 'Catalysts', n: 6, size: 0.014, speed: 0.9, hue: 150,
      blurb: 'Enzymes working the chain — each one holds a substrate and lets go.'
    },
    cellular: {
      id: 'vesicle', name: 'Traffic', n: 9, size: 0.018, speed: 0.7, hue: 168,
      blurb: 'Vesicles and motor proteins, moving cargo along the cytoskeleton.'
    },
    planet: {
      /* The surface already has `scenes.agents`, which are stepped properly and
       * can be ridden. Nothing to add. */
      id: 'fauna', name: 'Fauna', n: 0, blurb: 'Whatever lives here.'
    },
    system: {
      id: 'ship', name: 'Traffic', n: 5, size: 0.010, speed: 0.35, hue: 45,
      blurb: 'Ships in transit. They were going somewhere before you arrived.'
    },
    galaxy: {
      id: 'probe', name: 'Probes', n: 4, size: 0.008, speed: 0.2, hue: 190,
      blurb: 'Somebody else’s probes, crossing between stars.'
    },
    web: {
      id: 'galaxy', name: 'Galaxies', n: 12, size: 0.006, speed: 0.12, hue: 276,
      blurb: 'Galaxies falling down the filaments toward the nodes.'
    },
    field: {
      id: 'drifter', name: 'Drifters', n: 6, size: 0.010, speed: 0.5, hue: 210,
      blurb: 'Something is moving out there that you are not tuned to.'
    },
    ensemble: {
      id: 'observer', name: 'Observers', n: 3, size: 0.012, speed: 0.25, hue: 210,
      blurb: 'Whatever is doing the observing in a universe that is not ours.'
    }
  };

  function kindFor(sceneKind) { return KINDS[sceneKind] || null; }

  /* ── Derivation ───────────────────────────────────────────────────────────
   *
   * Position is a pure function of (address, t). No state, no spawn, no
   * despawn — which is exactly what makes "it was already doing this" true
   * rather than a claim.
   */
  function inhabitantsFor(game, sceneKind, t, dt, out) {
    const k = kindFor(sceneKind);
    const o = out || {};
    const list = o.list || (o.list = []);
    list.length = 0;
    o.kind = k;
    if (!k || !k.n) return o;

    /* Addressed off the scene, so the same place has the same inhabitants and
     * a different place has different ones. */
    const seed = hashN(game.seed ^ 0x1A7B, sceneKind.length * 613, addressOf(game));

    for (let i = 0; i < k.n; i++) {
      const h = hashN(seed, i, 0x33);
      /* Each follows a slow closed path, so it circulates rather than
       * wandering off — a thing that leaves is a thing that was never really
       * living there. */
      const r0 = 0.22 + hashF(h, 1) * 0.62;
      const r1 = r0 * (0.55 + hashF(h, 2) * 0.5);
      const rate = k.speed * (0.6 + hashF(h, 3) * 0.9);
      const phase = hashF(h, 4) * TAU;
      const a = t * rate + phase;
      /* An ellipse with a slow precession — two frequencies, so the path never
       * quite repeats and the motion does not read as a carousel. */
      const prec = t * rate * 0.13;
      const ca = Math.cos(a), sa = Math.sin(a);
      const cp = Math.cos(prec), sp = Math.sin(prec);
      const x0 = ca * r0, y0 = sa * r1;

      /* The mind. Real, cached by address, and its output modulates the path —
       * so an inhabitant hesitates, doubles back and lingers in ways nothing
       * scripted it to. */
      let wob = 0, bright = 1;
      if (i < MAX_LIVE) {
        const mind = RS.neural.mindAt(h);
        const st = stateFor(h);
        stepMind(mind, st, t, i, dt);
        wob = st.out[0] * 0.06;
        bright = 0.55 + clamp01(st.out[1] * 0.5 + 0.5) * 0.75;
      }

      /* The *path* is pure in (address, t); the mind adds a small live
       * perturbation on top of it. Both are exposed, because the distinction is
       * real: `bx`/`by` is where this thing would be with nobody home, and
       * `x`/`y` is where it actually is. Anything that needs determinism reads
       * the base; the renderer reads the real one. */
      const bx = x0 * cp - y0 * sp;
      const by = x0 * sp + y0 * cp;
      list.push({
        i,
        bx, by,
        x: bx + wob,
        y: by + wob * 0.6,
        size: k.size * (0.7 + hashF(h, 5) * 0.7),
        hue: k.hue + (hashF(h, 6) * 40 - 20),
        bright,
        /* Heading, so something with a front can be drawn pointing along it. */
        heading: Math.atan2(
          Math.cos(a + 0.05) * r1 - sa * r1,
          -Math.sin(a + 0.05) * r0 + ca * r0) + prec
      });
    }
    return o;
  }

  /* Which place we are in, as one number, so two different systems have
   * different traffic and returning to one finds the same traffic. */
  function addressOf(game) {
    const s = game.scene;
    if (s.systemAddr) return hashN(s.systemAddr.sx | 0, s.systemAddr.sy | 0, s.systemAddr.index | 0);
    if (s.cell) return hashN(s.cellIndex | 0, 0x7, 0x7);
    return hashN(Math.round(game.dials.space.value * 4), game.galaxy ? game.galaxy.sx : 0,
      game.galaxy ? game.galaxy.sy : 0);
  }

  /* One persistent hidden state per live inhabitant, keyed by address. Held
   * here rather than in the list because the list is rebuilt every frame and a
   * recurrent network with no memory between frames is not recurrent. */
  const states = new Map();

  function stateFor(h) {
    let st = states.get(h);
    if (!st) {
      st = RS.neural.newState();
      st.inp = new Float32Array(RS.neural.N_IN);
      states.set(h, st);
      /* Bounded: a long session that visits many places must not accumulate
       * state for all of them. The oldest go first, and they re-derive
       * identically when revisited. */
      if (states.size > 240) {
        const first = states.keys().next().value;
        states.delete(first);
      }
    }
    return st;
  }

  function stepMind(mind, st, t, i, dt) {
    /* Senses: where it is in its own cycle, plus a slow shared drive so a
     * population responds to the same conditions and therefore looks like a
     * population rather than like independent dots. */
    const n = st.inp.length;
    if (n > 0) st.inp[0] = Math.sin(t * 0.7 + i);
    if (n > 1) st.inp[1] = Math.cos(t * 0.31 + i * 1.7);
    if (n > 2) st.inp[2] = Math.sin(t * 0.12);
    if (n > 3) st.inp[3] = st.out[0];
    if (n > 4) st.inp[4] = st.out[1];
    if (n > 5) st.inp[5] = 1;
    RS.neural.step(mind, st, st.inp, Math.min(0.05, dt || 1 / 60));
  }

  function readout(sceneKind) {
    const k = kindFor(sceneKind);
    return k && k.n ? { name: k.name, count: k.n, blurb: k.blurb } : null;
  }

  RS.inhabitants = { KINDS, MAX_LIVE, kindFor, inhabitantsFor, addressOf, readout, states };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
