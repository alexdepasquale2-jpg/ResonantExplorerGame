/* Resonant — the Orbital Shell scope. Rungs 2–3, and the only place where two
 * things are forbidden from being the same.
 *
 * ── The only-here rule: exclusion ─────────────────────────────────────────
 *
 * Every other scope in the game lets manifestations overlap freely. Here they
 * cannot: no two occupants may share a full set of quantum numbers (n, l, m,
 * s). That is not a rule anybody chose — it is what "fermion" means — and it is
 * the reason matter takes up space, the reason there is a periodic table, and
 * the reason a star can stop collapsing.
 *
 * Mechanically it makes this the one scope with a **finite, contested** set of
 * places to be. A shell has 2(2l+1) slots and no more. Occupied slots are gone.
 * Which slot a manifestation lands in is derived from its essence, so two
 * essences that want the same state genuinely fight over it, and the one that
 * loses is displaced outward to a higher shell — which costs energy, and shows.
 *
 * ── What you can find only here: degeneracy ───────────────────────────────
 *
 * Two configurations with different quantum numbers but the *same* energy. In
 * our universe they are the reason chemistry exists — degenerate orbitals are
 * where bonds come from — and they are unstable to any perturbation, so
 * catching one is catching a coincidence. The scope pays for it, and how many
 * there are depends on the physics block, which means the Ensemble and this
 * scope talk to each other without either being told about the other.
 *
 * ── TWIN is native here ───────────────────────────────────────────────────
 *
 * Spin-up and spin-down share every other quantum number and differ only in the
 * one that cannot be observed without choosing it. The Probabilistic layer's
 * primitive is not a metaphor at this rung; it is the literal situation.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, hashF, hashN, TAU } = RS.core;

  /* How many shells to render. Beyond n = 5 the radii are too close together
   * to read and nothing interesting is happening out there anyway. */
  const N_MAX = 5;

  /* Slots in subshell l: 2(2l+1) — two spins × (2l+1) orientations. */
  function slotsIn(l) { return 2 * (2 * l + 1); }

  /* Energy of a state, in arbitrary but ordered units. The Madelung rule —
   * order by (n + l), then by n — is why 4s fills before 3d and therefore why
   * the periodic table has the shape it has. Degeneracies are exactly the
   * states that tie. */
  function energyOf(n, l) { return (n + l) + n / 100; }

  /* Which state an essence wants. Derived, so an essence always goes for the
   * same place and a player learns where to expect it — and so two essences
   * that both want it genuinely collide. */
  function desiredState(ess) {
    const a = RS.emergence.axes(ess);
    /* Complexity picks the principal number: an intricate essence sits further
     * out, which is both the obvious reading and the useful one. */
    const n = 1 + Math.floor(a.c * (N_MAX - 1) + 0.5);
    /* Branching picks the subshell: s is spherical (no branching), p, d and f
     * have progressively more lobes. Exactly what `branching` means. */
    const l = Math.min(n - 1, Math.round(a.b * 3));
    /* Symmetry picks the orientation within the subshell. */
    const m = Math.round((a.s * 2 - 1) * l);
    /* Persistence picks the spin, so a Memory and a Seed in the same orbital
     * are the two halves of a pair rather than a collision. */
    const s = a.p >= 0.5 ? 1 : -1;
    return { n, l, m, s };
  }

  function stateKey(q) { return q.n + ':' + q.l + ':' + q.m + ':' + q.s; }

  /* ── The configuration ────────────────────────────────────────────────────
   *
   * Fill the shells with essences, honouring exclusion. An essence whose state
   * is taken is pushed outward until it finds one free — the Aufbau principle
   * running as a placement algorithm rather than as a diagram.
   */
  function shellsAt(game, scale, out) {
    const o = out || {};
    const occupants = o.occupants || (o.occupants = []);
    occupants.length = 0;
    const taken = o.__taken || (o.__taken = new Map());
    taken.clear();

    const E = RS.fractal.ESSENCES;
    let displaced = 0;

    for (let i = 0; i < E.length; i++) {
      const ess = E[i];
      const want = desiredState(ess);
      let q = want, bumped = 0;
      /* Walk outward until a free state turns up. It always does: there are
       * far more states within N_MAX than there are essences. */
      while (taken.has(stateKey(q)) && bumped < 40) {
        bumped++;
        let n = q.n, l = q.l, m = q.m, s = q.s;
        if (s > 0) s = -1;                    // try the other spin first
        else { s = 1; m++; }                  // then the next orientation
        if (m > l) { m = -l; l++; }           // then the next subshell
        if (l > n - 1) { l = 0; m = 0; n++; } // then the next shell
        if (n > N_MAX) { n = 1; l = 0; m = 0; }
        q = { n, l, m, s };
      }
      taken.set(stateKey(q), ess.id);
      if (bumped) displaced++;

      const shell = q.n;
      const rad = 0.16 + (shell - 1) / N_MAX * 0.74;
      /* Position within the shell from the orientation, so m is visible as an
       * angle rather than being a number in a tooltip. */
      const ang = (q.m + q.l + 0.5) / (2 * q.l + 1) * TAU + q.l * 0.6;

      occupants.push({
        essence: ess,
        form: (ess.forms && ess.forms.orbital) || ess.name,
        q, want, bumped,
        /* Energy cost of being displaced. Real: a displaced electron is in an
         * excited state and wants to fall back. */
        excited: bumped > 0,
        energy: energyOf(q.n, q.l),
        x: Math.cos(ang) * rad, y: Math.sin(ang) * rad * 0.9,
        rad, ang,
        /* Spin-up and spin-down are the literal TWIN of this rung. */
        spin: q.s,
        hue: 196 + q.l * 26 + (q.s > 0 ? 0 : 18)
      });
    }

    /* Degeneracies: distinct states that happen to share an energy. In our
     * block the Madelung ordering produces plenty; in a block where the
     * mass–luminosity exponents have moved, fewer or more — so the Ensemble
     * changes what this rung contains without either scope knowing about the
     * other. */
    const byEnergy = new Map();
    for (const oc of occupants) {
      const k = oc.energy.toFixed(3);
      byEnergy.set(k, (byEnergy.get(k) || 0) + 1);
    }
    let degenerate = 0;
    for (const [, n] of byEnergy) if (n > 1) degenerate += n;

    o.occupants = occupants;
    o.displaced = displaced;
    o.degenerate = degenerate;
    o.shells = N_MAX;
    o.capacity = capacityWithin(N_MAX);
    o.scale = scale;
    return o;
  }

  function capacityWithin(nMax) {
    let n = 0;
    for (let i = 1; i <= nMax; i++) for (let l = 0; l < i; l++) n += slotsIn(l);
    return n;
  }

  function enter(game, bus) {
    const s = game.scene;
    s.shells = shellsAt(game, game.dials.space.value, s.shells);
    bus.emit('shells:enter', { shells: s.shells });
    return s.shells;
  }

  function tick(game, bus, dt) {
    const s = game.scene;
    s.shellT = (s.shellT || 0) + dt;
    if (!s.shells) enter(game, bus);
  }

  /* Degeneracy is a coincidence and coincidences are worth catching. Displaced
   * occupants pay too — an excited state is a thing that is about to stop
   * being, and working one before it falls back is the timing element this rung
   * has instead of a gate. */
  function bonusFor(game) {
    const s = game.scene;
    const sh = s.shells;
    if (s.kind !== 'shells' || !sh) return 1;
    return 1 + clamp01(sh.degenerate / 8) * 1.4 + clamp01(sh.displaced / 6) * 0.8;
  }

  function readout(game) {
    const s = game.scene;
    const sh = s.shells;
    if (!sh) return { title: 'Orbital Shells', sub: 'resolving…' };
    return {
      title: 'Orbital Shells',
      sub: 'No two occupants may share a state. That is why matter takes up space.',
      occupied: sh.occupants.length,
      capacity: sh.capacity,
      displaced: sh.displaced,
      degenerate: sh.degenerate,
      bonus: bonusFor(game)
    };
  }

  RS.shells = {
    N_MAX, slotsIn, energyOf, desiredState, stateKey, shellsAt,
    capacityWithin, enter, tick, bonusFor, readout
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
