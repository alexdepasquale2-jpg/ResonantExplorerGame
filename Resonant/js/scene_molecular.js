/* Resonant — the Molecular scope. Rung 4, and the one place handedness matters.
 *
 * ── The only-here rule: chirality ─────────────────────────────────────────
 *
 * A molecule with four different groups on a carbon comes in two forms that are
 * mirror images and cannot be superimposed — left-handed and right-handed. They
 * have identical energies, identical spectra, identical everything a physicist
 * measures. And life uses one of them almost exclusively: every amino acid in
 * every organism on Earth is left-handed, every sugar right-handed, and nobody
 * knows why it went that way rather than the other.
 *
 * That is the scope. On a sterile world the two handednesses are found in equal
 * numbers, because nothing is selecting. On a living world the chemistry is
 * **homochiral** — one hand dominates, and the fraction that has been driven
 * out is a direct measurement of how thoroughly life has taken the place over.
 * You can read a biosphere's depth off a bag of molecules without ever seeing
 * an organism, which is a real technique and a genuinely different way to look
 * at a world.
 *
 * And the discovery is the exception: on a homochiral world, the rare molecule
 * of the *wrong* hand. It is either contamination, or abiotic, or something
 * living that does not share an ancestor with everything else there.
 *
 * ── Where handedness comes from ───────────────────────────────────────────
 *
 * `symmetry`, straight through. An essence with symmetry 1.0 is achiral — its
 * mirror image *is* itself, so the question does not arise, which is exactly
 * what perfect symmetry means. Below that, the lower the symmetry the more
 * strongly a molecule commits to one hand. The player has been reading that
 * axis since the first layer; here it decides something no other scope uses it
 * for.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, hashF, hashN, TAU } = RS.core;

  const SITE_COUNT = 14;

  /* Below this, an essence is symmetric enough that its mirror image is itself
   * and handedness is not defined. */
  const ACHIRAL_ABOVE = 0.92;

  function isChiral(ess) {
    return RS.emergence.axes(ess).s < ACHIRAL_ABOVE;
  }

  /* How strongly life here has driven out one hand. Zero on a sterile world —
   * an equal mixture, which is what chemistry produces when nothing is
   * choosing — and rising toward total as a biosphere deepens. */
  function homochiralityOf(planet) {
    const bio = planet && planet.biosphere;
    if (!bio) return 0;
    /* Saturating: the first stirrings of life already bias the mixture
     * noticeably, and a mature biosphere is very nearly pure. */
    return clamp01(1 - Math.exp(-bio.complexity * 3.4));
  }

  /* Which hand this particular molecule is. On a sterile world it is a coin
   * flip; on a living one the coin is weighted by how homochiral the place is,
   * and the rare exception is the find. */
  function handOf(seed, i, bias) {
    const u = hashF(hashN(seed >>> 0, i, 0x0CA1), 3);
    /* `bias` 0 → half and half. `bias` 1 → the minority hand essentially never
     * appears. The threshold is the fraction of the minority hand. */
    const minority = (1 - bias) * 0.5;
    return u < minority ? -1 : 1;
  }

  function moleculeAt(game, planet, patch, index, out) {
    const o = out || {};
    const bias = homochiralityOf(planet);
    const seed = hashN(game.seed ^ 0x3013, Math.round(patch * 1e4), index);
    const sites = o.sites || (o.sites = []);
    sites.length = 0;

    let chiral = 0, minority = 0;
    for (let i = 0; i < SITE_COUNT; i++) {
      const h = hashN(seed, i, 11);
      const ess = RS.fractal.essenceAt(game.seed, index * 613 + i, Math.round(patch * 1e3));
      const chi = isChiral(ess);
      const hand = chi ? handOf(seed, i, bias) : 0;
      if (chi) { chiral++; if (hand < 0) minority++; }

      /* Sites sit on a chain that coils — the `chain` geometry's own shape, and
       * the reason the rung looks like nothing else on the ladder. */
      const u = i / SITE_COUNT;
      const turns = 2.4;
      const ang = u * TAU * turns + hashF(h, 1) * 0.18;
      const rad = 0.18 + u * 0.62;

      sites.push({
        i, essence: ess,
        form: (ess.forms && ess.forms.chain) || ess.name,
        chiral: chi, hand,
        x: Math.cos(ang) * rad, y: Math.sin(ang) * rad * 0.82,
        size: 0.030 + hashF(h, 2) * 0.030,
        /* Bond order to the next site — how tightly it is held, which is the
         * essence's persistence doing what it says everywhere else. */
        bond: 1 + Math.round(RS.emergence.axes(ess).p * 2),
        hue: chi ? (hand < 0 ? 24 : 196) : 140
      });
    }

    o.sites = sites;
    o.bias = bias;
    o.chiral = chiral;
    /* The find: molecules of the hand life here does *not* use. On a sterile
     * world this is meaningless (both hands are equally common); on a deeply
     * homochiral one it is the anomaly the whole scope exists to notice. */
    o.minority = minority;
    o.anomalous = bias > 0.5 ? minority : 0;
    o.host = planet ? planet.name : null;
    o.patch = patch;
    o.index = index;
    return o;
  }

  function reasonAbsent(planet) {
    if (!planet) return 'no world selected';
    /* Molecules exist everywhere; there is nothing to refuse. The scope is
     * simply much less interesting on a world with no chemistry worth the
     * name, and it says so rather than pretending. */
    return null;
  }

  function enter(game, bus) {
    const s = game.scene;
    s.molIndex = s.molIndex || 0;
    s.molecule = moleculeAt(game, s.planet, RS.cellular.patchOf(s), s.molIndex, s.molecule);
    bus.emit('molecule:enter', { molecule: s.molecule });
    return s.molecule;
  }

  function tick(game, bus, dt) {
    const s = game.scene;
    s.molT = (s.molT || 0) + dt * 0.7;
    if (!s.molecule) enter(game, bus);
  }

  /* Finding the wrong-handed molecule on a world that settled the question
   * long ago is the scope's discovery, and it scales with how settled the
   * question is — an anomaly in a 50/50 mixture is not an anomaly. */
  function bonusFor(game) {
    const s = game.scene;
    const m = s.molecule;
    if (s.kind !== 'molecular' || !m) return 1;
    return 1 + clamp01(m.anomalous / 3) * m.bias * 2.2;
  }

  function readout(game) {
    const s = game.scene;
    const m = s.molecule;
    if (!m) return { title: 'Molecular', sub: 'resolving…' };
    const pct = Math.round(m.bias * 100);
    return {
      title: m.bias > 0.5 ? 'Homochiral Chemistry' : 'Racemic Chemistry',
      sub: m.bias < 0.05
        ? 'Both hands in equal numbers. Nothing here is choosing.'
        : pct + '% of one hand — life here settled the question and never revisited it.',
      bias: m.bias,
      chiral: m.chiral,
      anomalous: m.anomalous,
      host: m.host,
      bonus: bonusFor(game)
    };
  }

  RS.molecular = {
    SITE_COUNT, ACHIRAL_ABOVE, isChiral, homochiralityOf, handOf,
    moleculeAt, reasonAbsent, enter, tick, bonusFor, readout
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
