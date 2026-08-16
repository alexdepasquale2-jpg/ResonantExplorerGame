/* Resonant — the fractal store.
 *
 * The premise, stated plainly: there is exactly one body of information, and
 * every layer and every scale is a *rendering* of it under local rules. Two
 * things that look nothing alike — a spiral arm at the galactic tier and a
 * coiled flagellum at the cellular one — are the same essence wearing
 * different clothes, and learning to see that is the game's real progression.
 *
 * So nothing here is stored. There is no array of world objects anywhere in
 * this codebase. A *manifestation* is derived on demand from its address:
 *
 *     (worldSeed, tier, band, cellX, cellY, slot) ──hash──▶ manifestation
 *
 * That is what makes the space endless without being random: 22 tiers × 12
 * bands × an unbounded cell grid, every cell stable forever, none of it
 * costing a byte until it is looked at. And because the essence is drawn from
 * a hash that *excludes* tier and band, the same essence recurs across the
 * whole ladder — which is the thing the player is ultimately learning to
 * recognise.
 */
(function (RS) {
  'use strict';
  const { hashN, hashF, clamp01, lerp, TAU } = RS.core;

  /* The irreducible set. These are not content; they are the alphabet every
   * tier and layer spells its content out of. `forms` gives the local noun for
   * each of cosmos.js's geometries — this table *is* the "local rules" idea in
   * its most literal form.
   *
   * ── The four axes: the entire authored seed of the game ──────────────────
   *
   * Sixteen essences × four numbers = 64 values, and every mechanic in the
   * game is generated from them (see emergence.js). 12 bands × 16 essences ×
   * 8 geometries = 1536 distinct situations, all traceable back to this table
   * — which is what makes them *recognisable* rather than merely various.
   *
   *   complexity   how much structure it carries      → nesting depth, ordering depth
   *   branching    how much it divides                → rhythm subdivision, fan-out, divergence
   *   symmetry     how regular it is                  → duty cycle, angle regularity, twin closeness
   *   persistence  how long it holds                  → period, gradient steadiness, inversion
   *
   * Each number must be a claim the essence's own `trait` string already makes
   * in prose. Lattice is "order that repeats without a centre" → symmetry 1,
   * branching 0. Cascade is "one event that spends itself buying a thousand
   * others" → branching 0.9, persistence 0.2. If a number and its trait ever
   * disagree, the trait is right and the number is a bug: the player learns
   * these essences by their described character and then has to be able to
   * predict their behaviour from it. */
  const ESSENCES = [
    { id: 'boundary', name: 'Boundary', glyph: '⊂', hueShift: -18, complexity: 0.35,
      /* A closed surface: more structure than a point, no branching, regular,
       * and it stays put — a boundary that moved would not be one. */
      branching: 0.05, symmetry: 0.85, persistence: 0.95,
      trait: 'Separates an inside from an outside, and is neither.',
      forms: { foam: 'Horizon Quantum', orbital: 'Valence Shell', chain: 'Membrane Fold',
        cell: 'Cell Wall', body: 'Coastline', disc: 'Galactic Rim', web: 'Void Wall', abstract: 'Distinction' } },
    { id: 'flow', name: 'Flow', glyph: '≈', hueShift: 12, complexity: 0.4,
      branching: 0.35, symmetry: 0.25, persistence: 0.30,
      trait: 'Transport down a gradient. Never the same twice, always the same shape.',
      forms: { foam: 'Probability Current', orbital: 'Electron Drift', chain: 'Solvent Channel',
        cell: 'Cytoplasmic Stream', body: 'River', disc: 'Density Wave', web: 'Filament Flow', abstract: 'Mapping' } },
    { id: 'recursion', name: 'Recursion', glyph: '⟳', hueShift: 34, complexity: 0.9,
      branching: 0.60, symmetry: 0.80, persistence: 0.50,
      trait: 'Contains a smaller copy of itself, and is a smaller copy of something.',
      forms: { foam: 'Self-Similar Foam', orbital: 'Nested Shell', chain: 'Branched Polymer',
        cell: 'Organelle Lineage', body: 'Fern Canopy', disc: 'Sub-Spiral', web: 'Nested Void', abstract: 'Fixed Point' } },
    { id: 'attractor', name: 'Attractor', glyph: '◎', hueShift: -34, complexity: 0.20,
      /* One basin everything falls into: minimal structure, zero branching
       * (its gradient converges hard), highly regular, and it does not move. */
      branching: 0.00, symmetry: 0.95, persistence: 0.90,
      trait: 'Everything nearby ends up here regardless of where it started.',
      forms: { foam: 'Vacuum Minimum', orbital: 'Ground State', chain: 'Folded Core',
        cell: 'Nucleus', body: 'Basin', disc: 'Galactic Core', web: 'Great Attractor', abstract: 'Limit' } },
    { id: 'duality', name: 'Duality', glyph: '◐', hueShift: 96, complexity: 0.5,
      branching: 0.10, symmetry: 1.00, persistence: 0.70,
      trait: 'One thing that must be described two incompatible ways at once.',
      forms: { foam: 'Virtual Pair', orbital: 'Spin Doublet', chain: 'Chirality',
        cell: 'Mitotic Pair', body: 'Binary', disc: 'Bar Mode', web: 'Filament Pair', abstract: 'Complement' } },
    { id: 'emergence', name: 'Emergence', glyph: '⁂', hueShift: 62, complexity: 1.0,
      branching: 0.75, symmetry: 0.30, persistence: 0.25,
      trait: 'A property of the whole that none of the parts possess.',
      forms: { foam: 'Condensate', orbital: 'Molecular Bond', chain: 'Tertiary Fold',
        cell: 'Tissue', body: 'Swarm', disc: 'Spiral Pattern', web: 'Web Topology', abstract: 'Supervenience' } },
    { id: 'threshold', name: 'Threshold', glyph: '⌇', hueShift: 8, complexity: 0.45,
      branching: 0.05, symmetry: 0.50, persistence: 0.15,
      trait: 'Below it nothing happens. Above it everything does.',
      forms: { foam: 'Symmetry Break', orbital: 'Ionisation Edge', chain: 'Melting Point',
        cell: 'Action Potential', body: 'Phase Change', disc: 'Star Formation Line', web: 'Collapse Density', abstract: 'Critical Value' } },
    { id: 'lattice', name: 'Lattice', glyph: '⧉', hueShift: -62, complexity: 0.55,
      /* A lattice repeats *outward to its neighbours*, so it branches — evenly,
       * which is the whole point. Zero branching would make it a chain; what
       * distinguishes it is symmetry 1.0, a perfectly regular fan with no
       * jitter and no centre. */
      branching: 0.50, symmetry: 1.00, persistence: 0.95,
      trait: 'Order that repeats without a centre and without an edge.',
      forms: { foam: 'Spin Network', orbital: 'Crystal Cell', chain: 'Polymer Grid',
        cell: 'Cytoskeleton', body: 'Mineral Seam', disc: 'Resonance Ring', web: 'Sheet Structure', abstract: 'Group' } },
    { id: 'spiral', name: 'Spiral', glyph: '❋', hueShift: 22, complexity: 0.7,
      branching: 0.10, symmetry: 0.40, persistence: 0.60,
      trait: 'Rotation that does not close. The compromise between orbit and escape.',
      forms: { foam: 'Vortex Quantum', orbital: 'Precessing Orbit', chain: 'Helix',
        cell: 'Coiled Flagellum', body: 'Cyclone', disc: 'Spiral Arm', web: 'Filament Curl', abstract: 'Iteration' } },
    { id: 'void', name: 'Void', glyph: '○', hueShift: 0, complexity: 0.15,
      branching: 0.00, symmetry: 0.70, persistence: 1.00,
      trait: 'The absence that gives everything else its shape.',
      forms: { foam: 'False Vacuum', orbital: 'Forbidden Gap', chain: 'Vacancy',
        cell: 'Vacuole', body: 'Cavern', disc: 'Inter-arm Gap', web: 'Cosmic Void', abstract: 'Null Set' } },
    { id: 'seed', name: 'Seed', glyph: '✦', hueShift: 46, complexity: 0.35,
      branching: 0.85, symmetry: 0.45, persistence: 0.10,
      trait: 'Compressed instructions for something enormously larger.',
      forms: { foam: 'Fluctuation', orbital: 'Nucleation Site', chain: 'Codon',
        cell: 'Spore', body: 'Germ', disc: 'Protostellar Core', web: 'Primordial Overdensity', abstract: 'Axiom' } },
    { id: 'weave', name: 'Weave', glyph: '⋈', hueShift: -8, complexity: 0.8,
      branching: 0.40, symmetry: 0.90, persistence: 0.80,
      trait: 'Strength that exists only in the crossing, never in the strands.',
      forms: { foam: 'Entanglement', orbital: 'Hybrid Orbital', chain: 'Double Helix',
        cell: 'Mycelium', body: 'Root Mat', disc: 'Tidal Bridge', web: 'Filament Node', abstract: 'Relation' } },
    { id: 'cascade', name: 'Cascade', glyph: '⋔', hueShift: 74, complexity: 0.75,
      branching: 0.90, symmetry: 0.15, persistence: 0.20,
      trait: 'One event that spends itself buying a thousand others.',
      forms: { foam: 'Decay Chain', orbital: 'Auger Cascade', chain: 'Reaction Cascade',
        cell: 'Signal Cascade', body: 'Avalanche', disc: 'Starburst', web: 'Merger Chain', abstract: 'Entailment' } },
    /* ── The two that were added last ─────────────────────────────────────
     *
     * Added to exercise the property the whole architecture exists to have:
     * an essence is 4 numbers, 8 form names and a trait, and adding one adds it
     * to twelve layers, twenty-two rungs, six primitives and every scope at
     * once. No band table, no scene, no renderer and no primitive was touched
     * to put these in the game — which is either a trivial observation about
     * data-driven design or the entire point, depending on whether you believe
     * the first fourteen were generated the same way. They were.
     *
     * They also fill two genuine holes in the axis space. Nothing branched
     * *and* was symmetric — every branching essence was lopsided, so a player
     * could have concluded that branching implies asymmetry, which is false and
     * a snowflake disproves it. And nothing was intricate, unbranched and
     * volatile all at once, which is what turbulence is. */
    { id: 'dendrite', name: 'Dendrite', glyph: '❋', hueShift: 58, complexity: 0.60,
      /* Reaches out many ways, and every way is the same way. High branching
       * with high symmetry — a snowflake, a radiolarian, a nerve arbor. */
      branching: 0.80, symmetry: 0.92, persistence: 0.45,
      trait: 'Reaches out in every direction at once, and every direction is the same one.',
      forms: { foam: 'Vertex Sheaf', orbital: 'Hybrid Orbital', chain: 'Dendrimer',
        cell: 'Arbor', body: 'Frost Fern', disc: 'Tidal Tail', web: 'Filament Node',
        abstract: 'Free Group' } },
    { id: 'turbulence', name: 'Turbulence', glyph: '≀', hueShift: -52, complexity: 0.85,
      /* Intricate, unbranched, lopsided and gone in a moment. The one thing
       * with no structure you can hold on to and far too much to describe. */
      branching: 0.25, symmetry: 0.10, persistence: 0.18,
      trait: 'Too much structure to describe and none of it lasts long enough to try.',
      forms: { foam: 'Vacuum Churn', orbital: 'Correlation Hole', chain: 'Molten Tangle',
        cell: 'Cytoplasmic Churn', body: 'Storm', disc: 'Shear Front', web: 'Infall Shock',
        abstract: 'Mixing Map' } },
    { id: 'memory', name: 'Memory', glyph: '⌸', hueShift: -46, complexity: 0.65,
      branching: 0.20, symmetry: 0.60, persistence: 1.00,
      trait: 'The present shaped by something that has already stopped existing.',
      forms: { foam: 'Vacuum Imprint', orbital: 'Hysteresis', chain: 'Conformational State',
        cell: 'Methylation Mark', body: 'Strata', disc: 'Stellar Stream', web: 'Relic Structure', abstract: 'State' } }
  ];

  const ESSENCE_BY_ID = Object.create(null);
  ESSENCES.forEach((e, i) => { e.index = i; ESSENCE_BY_ID[e.id] = e; });

  /* Each layer contributes an adjective. This is the other half of "local
   * rules": the essence and the geometry fix the noun, the band colours how it
   * is experienced. `Spiral` at the galactic tier is a Spiral Arm; observed
   * through the emotional layer it is a *Yearning* Spiral Arm. */
  const BAND_ADJ = {
    baryonic: ['Dense', 'Cold', 'Massive', 'Settled', 'Inert'],
    thermal: ['Seething', 'Radiant', 'Cooling', 'Restless', 'Bright'],
    electromagnetic: ['Charged', 'Pulsing', 'Polarised', 'Resonant', 'Modulated'],
    probabilistic: ['Undecided', 'Smeared', 'Superposed', 'Contingent', 'Latent'],
    vital: ['Quickening', 'Metabolic', 'Hungry', 'Reproducing', 'Persisting'],
    emotive: ['Yearning', 'Grieving', 'Exultant', 'Fearful', 'Tender', 'Furious', 'Serene'],
    mnemonic: ['Remembered', 'Rehearsed', 'Half-Forgotten', 'Indexed', 'Recurring'],
    causal: ['Necessary', 'Antecedent', 'Contingent', 'Determining', 'Downstream'],
    archetypal: ['Original', 'Undisguised', 'Primary', 'Recurrent', 'Naked'],
    noetic: ['Self-Evident', 'Transparent', 'Immediate', 'Comprehended', 'Given'],
    null: ['Absent', 'Unwitnessed', 'Erased', 'Silent', 'Negative'],
    unity: ['Undivided', 'Total', 'Single', 'Whole']
  };

  /* Address hashing. Three separate salts so that changing tier does not
   * reshuffle the essence — that stability across tiers is the entire point. */
  const SALT_ESSENCE = 0x9E3779B1;
  const SALT_LOCAL = 0x85EBCA77;
  const SALT_SIG = 0xC2B2AE3D;

  /* The essence at a cell is a function of the cell alone, plus the world
   * seed. Not the tier. Not the band. That is the fractal invariant: descend
   * the ladder over the same cell and you meet the same essence, dressed
   * differently every time. */
  function essenceAt(worldSeed, cellX, cellY, slot) {
    const h = hashN(worldSeed ^ SALT_ESSENCE, cellX, cellY, slot | 0);
    return ESSENCES[h % ESSENCES.length];
  }

  /* The full local rendering. Everything a node needs to exist, be drawn, be
   * tuned into, and be scored. */
  function resolve(worldSeed, tierIndex, bandIndex, cellX, cellY, slot) {
    slot = slot | 0;
    const tier = RS.cosmos.TIERS[tierIndex];
    const band = RS.spectrum.BANDS[bandIndex];
    const essence = essenceAt(worldSeed, cellX, cellY, slot);

    /* Local salt mixes in tier and band, so presentation varies while identity
     * does not. */
    const lh = hashN(worldSeed ^ SALT_LOCAL, cellX, cellY, slot, tierIndex, bandIndex);
    const r = RS.core.rngFrom(lh);

    const adjs = BAND_ADJ[band.id] || ['Manifest'];
    const adj = adjs[hashN(lh, 11) % adjs.length];
    const form = essence.forms[tier.geometry] || essence.name;

    /* Tuning signature. The node sits *near* its band centre but offset within
     * it — so finding the band gets you in the room, and finding the node
     * still takes work. Precision upgrades are what make that second search
     * tractable rather than tedious. */
    const sh = hashN(worldSeed ^ SALT_SIG, cellX, cellY, slot, tierIndex, bandIndex);
    const off = (hashF(sh, 1) * 2 - 1) * band.width * 0.86;
    const signature = band.centre + off;

    /* Fourth-dimensional phase, and the local clock rate it exists at. A node
     * whose rate is negative only manifests with time running backwards. */
    const phase = hashF(sh, 2) * TAU;
    const rateRoll = hashF(sh, 3);
    const rate = rateRoll < 0.14 ? -(0.4 + hashF(sh, 4) * 1.4)
      : rateRoll < 0.24 ? 0
        : 0.35 + hashF(sh, 5) * 2.1;

    /* Potency: the payout scalar. Rarity is deliberately heavy-tailed — most
     * nodes are ordinary and roughly one in forty is worth chasing across the
     * spectrum for. */
    const rare = hashF(lh, 7);
    const rarity = rare > 0.988 ? 3 : rare > 0.955 ? 2 : rare > 0.83 ? 1 : 0;
    const potency = (0.55 + hashF(lh, 8) * 0.9) * [1, 2.1, 4.6, 11][rarity];

    return {
      /* identity — invariant across tier and band */
      essence,
      /* local presentation */
      name: adj + ' ' + form,
      form, adj,
      glyph: essence.glyph,
      tierIndex, bandIndex, cellX, cellY, slot,
      /* tuning targets */
      signature, phase, rate,
      /* scoring */
      potency, rarity,
      /* rendering parameters, all derived so they never need storing */
      hue: band.hue + essence.hueShift * (0.4 + 0.6 * hashF(lh, 9)),
      sat: band.sat,
      size: 0.55 + hashF(lh, 10) * 0.9 + rarity * 0.22,
      arms: 3 + (hashN(lh, 12) % 6),
      twist: (hashF(lh, 13) * 2 - 1),
      wobble: 0.3 + hashF(lh, 14) * 1.4,
      complexity: essence.complexity,
      seed: lh
    };
  }

  /* Address key for the gnosis ledger. Deliberately (essence, tier, band) and
   * not the cell: recognising the *same* essence in a *new* context is the
   * achievement, meeting another one down the street is not. */
  function contextKey(essenceId, tierIndex, bandIndex) {
    return essenceId + '@' + tierIndex + ':' + bandIndex;
  }

  /* Gnosis level for an essence: how many distinct (tier, band) contexts it
   * has been recognised in. Each new context is worth progressively more
   * because it is progressively harder to reach. */
  function gnosisOf(game, essenceId) {
    const set = game.gnosis[essenceId];
    return set ? set.length : 0;
  }

  /* Recognition. Returns whether this was a *new* context — the thing worth
   * celebrating — so callers can fire the big feedback only when earned. */
  function recognise(game, man) {
    const key = contextKey(man.essence.id, man.tierIndex, man.bandIndex);
    const list = game.gnosis[man.essence.id] || (game.gnosis[man.essence.id] = []);
    if (list.indexOf(key) >= 0) return { fresh: false, level: list.length };
    list.push(key);
    return { fresh: true, level: list.length };
  }

  /* Permanent bonus from understanding an essence deeply. Applies to every
   * manifestation of it, at every tier, in every layer — because it is one
   * piece of knowledge, not a per-instance buff. */
  function gnosisBonus(game, essenceId) {
    return 1 + gnosisOf(game, essenceId) * 0.085;
  }

  /* ── Gnosis as foresight ───────────────────────────────────────────────────
   *
   * The yield bonus above is the small half of understanding. This is the real
   * one: recognising an essence in enough contexts progressively reveals its
   * four axes, and because every mechanic in the game is generated from those
   * four numbers (emergence.js), a revealed axis is a *prediction*.
   *
   * Know that Cascade has branching 0.9 and you know — without being told, and
   * without ever having played there — that its rhythm subdivides five ways in
   * the Electromagnetic layer, that its dependency graph fans out four wide in
   * the Causal layer, and that its nests are wide and shallow in the Vital
   * layer. You can walk into a layer you have never opened and already know how
   * it will behave.
   *
   * That is the difference between a game that *says* knowledge is fractal and
   * one where it demonstrably is. It only works because the world really is
   * generated from these numbers.
   *
   * Reveal order is hashed per essence, so two players learn the same essence
   * along different axes first and their intuitions genuinely differ. */
  const AXES = ['complexity', 'branching', 'symmetry', 'persistence'];

  /* Contexts needed to reveal 1, 2, 3, 4 axes. */
  const REVEAL_AT = [2, 4, 6, 8];

  function revealCount(contexts) {
    let n = 0;
    for (const need of REVEAL_AT) if (contexts >= need) n++;
    return n;
  }

  /* The order this particular essence gives itself up in. Stable per essence
   * and per world, derived by a Fisher–Yates shuffle off the address hash. */
  function revealOrder(worldSeed, essence) {
    const order = AXES.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = hashN(worldSeed ^ 0x0AE5, essence.index, i) % (i + 1);
      const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
    }
    return order;
  }

  /* What the player currently knows about an essence's generative axes.
   * Unrevealed axes are simply absent, so a HUD can render a blank rather than
   * a wrong guess. */
  function predicted(game, essenceId, out) {
    const o = out || {};
    const ess = ESSENCE_BY_ID[essenceId];
    o.essence = ess || null;
    o.contexts = gnosisOf(game, essenceId);
    o.revealed = ess ? revealCount(o.contexts) : 0;
    o.order = ess ? revealOrder(game.seed, ess) : [];
    /* Clear any previously-revealed values so a reused buffer cannot leak
     * knowledge the player has not earned in this call. */
    for (const a of AXES) o[a] = undefined;
    for (let i = 0; i < o.revealed; i++) o[o.order[i]] = ess[o.order[i]];
    /* What it would take to learn the next one — the thing that makes hunting
     * an essence across contexts a deliberate strategy. */
    o.next = ess && o.revealed < AXES.length ? o.order[o.revealed] : null;
    o.nextAt = o.revealed < REVEAL_AT.length ? REVEAL_AT[o.revealed] : null;
    return o;
  }

  /* Is a specific axis known? Hot path for HUD modules deciding whether to
   * ghost in a prediction. */
  function knows(game, essenceId, axis) {
    const ess = ESSENCE_BY_ID[essenceId];
    if (!ess) return false;
    const n = revealCount(gnosisOf(game, essenceId));
    const order = revealOrder(game.seed, ess);
    return order.indexOf(axis) < n;
  }

  /* An essence with only its known axes filled in, for feeding a primitive to
   * produce a *predicted* behaviour to ghost behind the real one. Unknown axes
   * fall back to the population mean so the ghost is a reasonable guess rather
   * than nonsense. */
  const MEAN = { complexity: 0.58, branching: 0.31, symmetry: 0.65, persistence: 0.62 };
  function predictedEssence(game, essenceId, out) {
    const o = out || {};
    const ess = ESSENCE_BY_ID[essenceId];
    if (!ess) return null;
    const p = predicted(game, essenceId, o.__p || (o.__p = {}));
    o.id = ess.id; o.index = ess.index; o.name = ess.name; o.glyph = ess.glyph;
    for (const a of AXES) o[a] = p[a] === undefined ? MEAN[a] : p[a];
    o.confidence = p.revealed / AXES.length;
    return o;
  }

  /* Total across the ledger, for the meta-progression readout. */
  function totalGnosis(game) {
    let n = 0;
    for (const k in game.gnosis) n += game.gnosis[k].length;
    return n;
  }

  RS.fractal = {
    ESSENCES, ESSENCE_BY_ID, BAND_ADJ,
    essenceAt, resolve, contextKey, gnosisOf, recognise, gnosisBonus, totalGnosis,
    AXES, REVEAL_AT, revealCount, revealOrder, predicted, knows, predictedEssence
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
