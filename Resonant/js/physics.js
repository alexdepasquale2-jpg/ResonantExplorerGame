/* Resonant — the constants, in one place, and swappable.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 *
 * `stellar.js` and `planet.js` are full of numbers that are not arbitrary: the
 * Sun's photospheric temperature, the Salpeter slope, the Jeans escape factor
 * of six, the exponents of the mass–luminosity relation. They are our
 * universe's numbers. Hardcoded, they are physics; named and gathered, they
 * become **one block among many**.
 *
 * That distinction is the whole of the Ensemble scope, and it is the last thing
 * the game's premise has left to say. The claim has been that one body of
 * information is rendered differently by local rules — and so far "local rules"
 * has meant a tier's geometry and a band's primitives. Here it means the laws.
 * Step into an ensemble node and the same essences you have spent the game
 * collecting instantiate under a different block: stars that cannot fuse,
 * atmospheres nothing can hold, a habitable zone that does not exist.
 *
 * ── The contract ──────────────────────────────────────────────────────────
 *
 * `RS.physics.current` is the block every derivation reads. It is OURS by
 * default and is only ever swapped by the Ensemble scope, which restores it on
 * leaving. Every consumer reads through the accessors rather than closing over
 * the numbers, so a swap takes effect immediately and everywhere — that is the
 * point, and it is also the thing that would break silently if any module kept
 * a copy.
 *
 * Blocks are derived, not authored: an ensemble node's block is a pure function
 * of its address, so the same alternative universe is the same one every time
 * you return to it, and there are as many of them as there are addresses.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, hashF, hashN } = RS.core;

  /* ── Our universe ─────────────────────────────────────────────────────────
   *
   * Every number here is measured, and the comment says what by. A block is
   * legible precisely because the default is real: a player who has read this
   * screen knows what an alternative is an alternative *to*.
   */
  const OURS = {
    id: 'ours', name: 'This Universe', level: 'I',
    blurb: 'The block we were issued with. Everything else is a variation on it.',

    /* Stellar */
    tSun: 5772,            // K, solar photosphere
    imfAlpha: 2.35,        // Salpeter slope of the initial mass function
    mMin: 0.08,            // solar masses — below this, no hydrogen fusion
    mMax: 40,              // solar masses — above this, radiation pressure wins
    /* Mass–luminosity: L ∝ M^k, with k breaking at the points where the
     * dominant energy transport changes. */
    mlLow: 2.3, mlMid: 4.0, mlHigh: 3.5,

    /* Planetary */
    /* Equilibrium temperature of a zero-albedo body at 1 AU from the Sun. The
     * constant that makes everything downstream dimensionless. */
    tEq1AU: 278.5,
    /* Jeans escape: a gas is retained when escape velocity exceeds this many
     * thermal velocities. Six is the standard rule of thumb and it is why Earth
     * keeps nitrogen and loses hydrogen. */
    jeans: 6,
    greenhouseK: 0.42,     // forcing coefficient
    greenhouseP: 0.42,     // and its exponent — saturating, but able to run away

    /* Life. The rate constant of the abiogenesis logistic, solved numerically
     * so that roughly one system in six carries life. */
    abiogenesis: 3.2,

    /* How habitable a world has to be before anything takes hold, and how
     * forgiving the temperature window is. */
    habSigma: 58,
    waterWeight: 5
  };

  /* ── What can vary, and by how much ───────────────────────────────────────
   *
   * Each axis names a real physical knob and a range in which a universe is
   * still *describable* — a block where nothing fuses at all has no stars to
   * derive and is not interesting to stand in, it is just an empty screen. The
   * ranges are wide enough that a block feels genuinely other and narrow enough
   * that the same code can render it.
   */
  const AXES = [
    { key: 'tSun', name: 'Fusion temperature', lo: 0.55, hi: 1.8,
      says: v => v < 0.9 ? 'stars burn cool and red' : v > 1.2 ? 'stars burn hot and blue' : 'stars burn much as ours do' },
    { key: 'imfAlpha', name: 'Mass spectrum', lo: 0.62, hi: 1.5,
      says: v => v < 0.85 ? 'giants are common' : v > 1.2 ? 'almost everything is a dwarf' : 'a familiar spread of masses' },
    { key: 'jeans', name: 'Atmospheric retention', lo: 0.45, hi: 1.9,
      says: v => v < 0.8 ? 'worlds hold onto almost anything' : v > 1.3 ? 'atmospheres bleed away' : 'atmospheres behave' },
    { key: 'greenhouseK', name: 'Greenhouse forcing', lo: 0.2, hi: 2.6,
      says: v => v < 0.6 ? 'atmospheres barely warm a world' : v > 1.6 ? 'runaway is the normal outcome' : 'greenhouse forcing is mild' },
    { key: 'abiogenesis', name: 'Abiogenesis rate', lo: 0.12, hi: 2.4,
      says: v => v < 0.5 ? 'life almost never starts' : v > 1.6 ? 'life starts everywhere it can' : 'life starts sometimes' },
    { key: 'habSigma', name: 'Thermal tolerance', lo: 0.4, hi: 2.0,
      says: v => v < 0.7 ? 'life needs a narrow window' : v > 1.4 ? 'life tolerates almost any temperature' : 'a familiar tolerance' }
  ];

  /* Blocks are multiplicative variations rather than absolute values, so an
   * axis is always readable as "×1.4 of ours" and a player can compare two
   * ensemble nodes without memorising six numbers. */
  function blockAt(worldSeed, index, out) {
    const b = out || {};
    for (const k in OURS) b[k] = OURS[k];
    const h = hashN(worldSeed >>> 0, index | 0, 0xE5B1);

    const mult = b.__mult || (b.__mult = {});
    for (let i = 0; i < AXES.length; i++) {
      const ax = AXES[i];
      /* Squared toward the middle, so most blocks differ noticeably on one or
       * two axes rather than mildly on all six. A universe that is 15% off in
       * every direction is just noise; one that is unrecognisable in exactly
       * one respect is a place. */
      const u = hashF(h, i + 1);
      const skew = u < 0.5 ? 0.5 - Math.pow(1 - u * 2, 1.7) * 0.5
        : 0.5 + Math.pow(u * 2 - 1, 1.7) * 0.5;
      const m = lerp(ax.lo, ax.hi, skew);
      mult[ax.key] = m;
      b[ax.key] = OURS[ax.key] * m;
    }
    /* Mass limits follow the fusion temperature: a block where fusion is
     * harder needs more mass to start it, which is the honest consequence and
     * it changes what stars exist rather than just how they look. */
    b.mMin = OURS.mMin * mult.tSun;
    b.mMax = OURS.mMax * lerp(1.4, 0.7, clamp01((mult.tSun - 0.55) / 1.25));

    b.id = 'block:' + index;
    b.index = index;
    b.name = nameFor(worldSeed, index);
    b.level = LEVELS[hashN(h, 3) % LEVELS.length];
    b.blurb = describe(b);
    return b;
  }

  /* Tegmark's ladder: which *kind* of other universe this is. Flavour on the
   * surface, but it is the vocabulary the scale ladder's top four rungs are
   * already labelled with, so the two agree. */
  const LEVELS = ['I', 'II', 'III', 'IV'];

  const PREFIX = ['Aleph', 'Bet', 'Gimel', 'Dalet', 'He', 'Vav', 'Zayin', 'Chet',
    'Tet', 'Yod', 'Kaf', 'Lamed', 'Mem', 'Nun', 'Samekh', 'Ayin'];
  const SUFFIX = ['Branch', 'Sheet', 'Bulk', 'Fold', 'Leaf', 'Shell', 'Domain', 'Basin'];

  function nameFor(worldSeed, index) {
    const h = hashN(worldSeed >>> 0, index | 0, 0x9A11);
    return PREFIX[h % PREFIX.length] + ' ' +
      SUFFIX[hashN(h, 7) % SUFFIX.length] + ' ' + (1 + (index % 997));
  }

  /* The one-line character of a block: whichever axis departs furthest from
   * ours is what the place is *about*. */
  function describe(b) {
    let worst = AXES[0], far = 0;
    for (const ax of AXES) {
      const m = b.__mult[ax.key];
      const d = Math.abs(Math.log(m));
      if (d > far) { far = d; worst = ax; }
    }
    const s = worst.says(b.__mult[worst.key]);
    return s.charAt(0).toUpperCase() + s.slice(1) + '.';
  }

  /* How far this block is from ours overall, 0..1. Drives how alien the scope
   * looks, and how much a recognition made under it is worth. */
  function distanceFrom(b) {
    if (!b || !b.__mult) return 0;
    let sum = 0;
    for (const ax of AXES) sum += Math.abs(Math.log(b.__mult[ax.key]));
    return clamp01(sum / (AXES.length * 0.85));
  }

  /* Per-axis comparison rows, for the readout. */
  function compare(b, out) {
    const rows = out || [];
    rows.length = 0;
    if (!b || !b.__mult) return rows;
    for (const ax of AXES) {
      const m = b.__mult[ax.key];
      rows.push({ key: ax.key, name: ax.name, mult: m, says: ax.says(m), ours: OURS[ax.key], here: b[ax.key] });
    }
    return rows;
  }

  /* ── The live block ───────────────────────────────────────────────────────
   *
   * `current` is what every derivation reads. Swapping it changes the universe
   * for everything derived after the swap — which is exactly what stepping into
   * an ensemble node should do, and exactly why nothing may cache these values.
   */
  let current = OURS;

  function use(block) {
    const prev = current;
    current = block || OURS;
    return prev;
  }
  function get() { return current; }
  function isOurs() { return current === OURS; }

  RS.physics = {
    OURS, AXES, LEVELS, blockAt, nameFor, describe, distanceFrom, compare,
    use, get, isOurs,
    /* Accessors. Consumers call these rather than reading `current` directly,
     * so the indirection is one place and a mis-named key fails loudly here
     * rather than silently producing NaN three modules away. */
    tSun: () => current.tSun,
    imfAlpha: () => current.imfAlpha,
    mMin: () => current.mMin,
    mMax: () => current.mMax,
    ml: () => current,
    tEq1AU: () => current.tEq1AU,
    jeans: () => current.jeans,
    greenhouseK: () => current.greenhouseK,
    greenhouseP: () => current.greenhouseP,
    abiogenesis: () => current.abiogenesis,
    habSigma: () => current.habSigma,
    waterWeight: () => current.waterWeight
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
