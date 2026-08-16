/* Resonant — the scale ladder.
 *
 * The root layer of the game is Galactic. Everything else is reached by
 * driving the SPACE dial *within* (down the ladder toward the Planck scale)
 * or *beyond* it (up, past the Hubble volume into the ensemble tiers).
 *
 * The rungs are real. `logM` is log10 of the tier's characteristic size in
 * metres and the numbers are the accepted physical ones — a hydrogen atom is
 * ~1e-10 m, the Milky Way ~1e21 m, the observable universe ~8.8e26 m across.
 * Above the Hubble volume, "size in metres" stops being the right coordinate,
 * so those tiers carry `logM: null` and are instead classified by Tegmark's
 * multiverse levels, which is the standard scientific taxonomy for what lies
 * beyond an observer's horizon. They are labelled as such rather than
 * pretending to a measurement nobody has.
 *
 * `rules` is the important gameplay field. Campbell's premise — the one the
 * whole game is built on — is that the information is identical everywhere
 * and only the *rendering* is local. So a tier never changes what a thing
 * is; it changes how much it costs to hold, how fast its local clock runs,
 * and what geometry it is drawn with. Same essence, local rules.
 */
(function (RS) {
  'use strict';

  /* geometry: how the field is laid out and drawn at this tier.
   *   'foam'    — seething, sub-pixel, no stable positions
   *   'orbital' — discrete shells around a centre
   *   'chain'   — bonded strands
   *   'cell'    — packed lobed blobs
   *   'body'    — discrete solid objects
   *   'disc'    — flattened rotating spiral
   *   'web'     — filaments and voids
   *   'abstract'— no spatial metaphor survives; pure relational graph
   */
  const TIERS = [
    { id: 'planck', name: 'Planck Foam', short: 'PLANCK', logM: -35,
      sci: 'Planck length, 1.616×10⁻³⁵ m — the scale at which spacetime geometry ceases to be defined.',
      geometry: 'foam', clock: 34.0, density: 2.4, hue: 291, drag: 0.30 },
    { id: 'quantum', name: 'Quantum Field', short: 'QUANTUM', logM: -18,
      sci: 'Below the nucleon; quark confinement and virtual pair production dominate.',
      geometry: 'foam', clock: 12.0, density: 2.0, hue: 268, drag: 0.42 },
    { id: 'nucleonic', name: 'Nucleonic', short: 'NUCLEON', logM: -15,
      sci: 'Nuclear radius ≈ 1 femtometre. The strong force sets the local rules.',
      geometry: 'orbital', clock: 7.0, density: 1.7, hue: 246, drag: 0.55 },
    { id: 'atomic', name: 'Atomic', short: 'ATOMIC', logM: -10,
      sci: 'Bohr radius, 5.29×10⁻¹¹ m. Electron probability shells, not surfaces.',
      geometry: 'orbital', clock: 4.2, density: 1.5, hue: 223, drag: 0.66 },
    { id: 'molecular', name: 'Molecular', short: 'MOLECULE', logM: -8,
      sci: 'Covalent bond lengths and folded macromolecules, 10⁻¹⁰–10⁻⁷ m.',
      geometry: 'chain', clock: 2.8, density: 1.35, hue: 196, drag: 0.74 },
    { id: 'cellular', name: 'Cellular', short: 'CELL', logM: -5,
      sci: 'Eukaryotic cells, 10–100 μm. The first tier where metabolism closes a loop.',
      geometry: 'cell', clock: 1.9, density: 1.2, hue: 168, drag: 0.80 },
    { id: 'organism', name: 'Organismic', short: 'ORGANISM', logM: 0,
      sci: 'Metre scale. Nervous systems, and the only tier evolved to be perceived directly.',
      geometry: 'body', clock: 1.0, density: 1.0, hue: 138, drag: 0.86 },
    { id: 'geologic', name: 'Geologic', short: 'GEOLOGIC', logM: 5,
      sci: 'Orogeny and plate tectonics, 10²–10⁶ m, on 10⁶-year clocks.',
      geometry: 'body', clock: 0.62, density: 0.92, hue: 96, drag: 0.90 },
    { id: 'planetary', name: 'Planetary', short: 'PLANET', logM: 7,
      sci: 'Earth radius 6.371×10⁶ m. Gravity rounds anything above ~10⁵ m.',
      geometry: 'body', clock: 0.45, density: 0.86, hue: 62, drag: 0.92 },
    { id: 'stellar', name: 'Stellar', short: 'STAR', logM: 9,
      sci: 'Solar radius 6.96×10⁸ m. Hydrostatic equilibrium between fusion and collapse.',
      geometry: 'body', clock: 0.34, density: 0.80, hue: 43, drag: 0.93 },
    { id: 'system', name: 'Planetary System', short: 'SYSTEM', logM: 13,
      sci: 'Heliopause ≈ 1.8×10¹³ m. One gravitational well, many bound bodies.',
      geometry: 'orbital', clock: 0.26, density: 0.74, hue: 28, drag: 0.94 },
    { id: 'interstellar', name: 'Interstellar', short: 'INTERSTELLAR', logM: 17,
      sci: 'Light-year, 9.46×10¹⁵ m. Molecular clouds, and the medium between stars.',
      geometry: 'web', clock: 0.19, density: 0.66, hue: 14, drag: 0.95 },
    { id: 'cluster', name: 'Stellar Cluster', short: 'CLUSTER', logM: 18,
      sci: 'Globular clusters, ~10¹⁸ m, 10⁵–10⁶ coeval stars in a bound sphere.',
      geometry: 'orbital', clock: 0.15, density: 0.60, hue: 356, drag: 0.955 },

    /* ── ROOT ──────────────────────────────────────────────────────────── */
    { id: 'galactic', name: 'Galactic', short: 'GALACTIC', logM: 21, root: true,
      sci: 'Milky Way disc ≈ 9.5×10²⁰ m. Spiral density waves in a dark-matter halo.',
      geometry: 'disc', clock: 0.12, density: 0.55, hue: 338, drag: 0.96 },
    /* ──────────────────────────────────────────────────────────────────── */

    { id: 'group', name: 'Local Group', short: 'GROUP', logM: 23,
      sci: '≈3×10²² m. ~80 galaxies gravitationally bound against cosmic expansion.',
      geometry: 'web', clock: 0.095, density: 0.50, hue: 318, drag: 0.965 },
    { id: 'supercluster', name: 'Supercluster', short: 'SUPERCLUSTER', logM: 25,
      sci: 'Laniakea, 1.6×10²⁵ m, defined by the convergence of local peculiar velocities.',
      geometry: 'web', clock: 0.075, density: 0.45, hue: 297, drag: 0.97 },
    { id: 'web', name: 'Cosmic Web', short: 'WEB', logM: 26,
      sci: 'Filament and void structure, ~10²⁶ m — the largest gravitationally-shaped pattern.',
      geometry: 'web', clock: 0.06, density: 0.40, hue: 276, drag: 0.975 },
    { id: 'hubble', name: 'Hubble Volume', short: 'HUBBLE', logM: 26.94,
      sci: 'Observable universe, 8.8×10²⁶ m across. The edge is causal, not physical.',
      geometry: 'web', clock: 0.05, density: 0.36, hue: 255, drag: 0.98 },

    /* Beyond the horizon: no metre measure applies, so these are classified by
     * Tegmark level rather than by size. */
    { id: 'inflationary', name: 'Inflationary Bulk', short: 'BULK', logM: null, level: 'I',
      sci: 'Tegmark Level I — space continues past the horizon; same laws, other initial conditions.',
      geometry: 'web', clock: 0.04, density: 0.32, hue: 234, drag: 0.982 },
    { id: 'bubbles', name: 'Bubble Ensemble', short: 'BUBBLE', logM: null, level: 'II',
      sci: 'Tegmark Level II — eternal inflation; other bubbles, other constants.',
      geometry: 'abstract', clock: 0.032, density: 0.28, hue: 210, drag: 0.985 },
    { id: 'branches', name: 'Branch Ensemble', short: 'BRANCH', logM: null, level: 'III',
      sci: 'Tegmark Level III — Everett branches; the same laws over the full Hilbert space.',
      geometry: 'abstract', clock: 0.026, density: 0.24, hue: 186, drag: 0.988 },
    { id: 'ensemble', name: 'Mathematical Ensemble', short: 'ENSEMBLE', logM: null, level: 'IV',
      sci: 'Tegmark Level IV — all structures that exist mathematically. Nothing is contingent here.',
      geometry: 'abstract', clock: 0.02, density: 0.20, hue: 162, drag: 0.99 }
  ];

  const BY_ID = Object.create(null);
  TIERS.forEach((t, i) => { t.index = i; BY_ID[t.id] = t; });

  const ROOT_INDEX = TIERS.findIndex(t => t.root);

  /* The SPACE dial reads in "scale units" rather than raw log-metres, because
   * the ladder is not uniform in log-metres (there are 17 decades between
   * Planck foam and the quantum field, and 1 between the cosmic web and the
   * Hubble volume) and a dial that spends 40% of its travel crossing empty
   * scale would feel dead. One unit = one tier, and fractional values sit
   * *between* tiers, where the field blends the two. */
  const SCALE_MIN = 0;
  const SCALE_MAX = TIERS.length - 1;

  function tierAt(scale) {
    return TIERS[Math.max(0, Math.min(TIERS.length - 1, Math.round(scale)))];
  }

  /* Blend factor between the two tiers a fractional scale straddles. Returns
   * { a, b, t } so the renderer can cross-fade geometry rather than popping. */
  function tierBlend(scale) {
    const s = Math.max(SCALE_MIN, Math.min(SCALE_MAX, scale));
    const i = Math.floor(s);
    const j = Math.min(TIERS.length - 1, i + 1);
    return { a: TIERS[i], b: TIERS[j], t: s - i };
  }

  /* Interpolated log-metres for the readout. The ensemble tiers have no metre
   * value; once either side of the blend is dimensionless the readout is too. */
  function logMetresAt(scale) {
    const { a, b, t } = tierBlend(scale);
    if (a.logM == null || b.logM == null) return null;
    return a.logM + (b.logM - a.logM) * t;
  }

  /* Local clock rate. Deep tiers run fast, large tiers run slow — this is what
   * makes the TIME dial mean something different at every rung. */
  function clockAt(scale) {
    const { a, b, t } = tierBlend(scale);
    /* Geometric, not linear: clock rates span three orders of magnitude and a
     * linear blend would make the fast end feel like a cliff. */
    return Math.exp(Math.log(a.clock) * (1 - t) + Math.log(b.clock) * t);
  }

  function densityAt(scale) {
    const { a, b, t } = tierBlend(scale);
    return a.density + (b.density - a.density) * t;
  }

  function hueAt(scale) {
    const { a, b, t } = tierBlend(scale);
    return RS.core.mixHue(a.hue, b.hue, t);
  }

  function dragAt(scale) {
    const { a, b, t } = tierBlend(scale);
    return a.drag + (b.drag - a.drag) * t;
  }

  /* Distance from the root, in rungs. Used for pricing: the further from the
   * Galactic layer you push, the more the manifestation costs to hold — which
   * is what keeps expansion a progression rather than a free scroll. */
  function depthFromRoot(scale) { return Math.abs(scale - ROOT_INDEX); }

  function describe(scale) {
    const { a, b, t } = tierBlend(scale);
    if (t < 0.12) return a.name;
    if (t > 0.88) return b.name;
    return a.short + '·' + b.short;
  }

  RS.cosmos = {
    TIERS, BY_ID, ROOT_INDEX, SCALE_MIN, SCALE_MAX,
    tierAt, tierBlend, logMetresAt, clockAt, densityAt, hueAt, dragAt,
    depthFromRoot, describe
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
