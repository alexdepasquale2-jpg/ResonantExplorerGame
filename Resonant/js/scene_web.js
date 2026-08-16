/* Resonant — the Cosmic Web scope. Four rungs, one structure, thirteen billion
 * years of it assembling while you watch.
 *
 * ── Why this scope, and why τ is the whole point of it ────────────────────
 *
 * Rungs 14–17 (Local Group, Supercluster, Cosmic Web, Hubble Volume) all
 * rendered the attunement field, which meant the largest structure in the
 * universe looked exactly like the inside of an atom. It also meant the `web`
 * geometry — written, and the right answer for four separate rungs — never
 * appeared as anything but a faint backdrop.
 *
 * The only-here rule is **time**. Everywhere else in the game τ is a throttle
 * or a scrub over a few million years. Here it is the age of the universe, and
 * the structure is a *function* of it: at 0.5 Gyr the sky is nearly uniform, by
 * 3 Gyr the overdensities have found each other, and by 13.8 the filaments are
 * unmistakable and the voids between them are most of the volume. Nothing is
 * integrated — the growth is a closed-form logistic on each node's own
 * primordial seed, so scrubbing thirteen billion years costs the same as
 * scrubbing one.
 *
 * ── What you can find only here ───────────────────────────────────────────
 *
 * **Disconnection.** Past the cosmological *event* horizon — about 4.9 Gpc
 * comoving, not the 14.3 Gpc particle horizon — you can still see a structure,
 * because its old light is already on its way, but nothing you send will ever
 * arrive and nothing it sends from now on ever will either. Visible and
 * permanently incommunicado. An essence recognised out there is information
 * you have no way to corroborate locally, which is the purest statement the
 * game can make of its own premise, and it is worth accordingly more. It is
 * also why the Hubble-volume rung is worth climbing to: it is the only slab
 * wide enough to contain anything past that line.
 *
 * **Assembly.** A filament pays best while it is actually forming — when its
 * growth rate, not its size, is at maximum. Reading the clock rather than the
 * picture is the skill, and it is a skill that exists nowhere else in the game.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, hashF, hashN, TAU } = RS.core;

  /* Age of the universe now, in Gyr. Structure formation is measured against
   * this, and the scope lets τ run past it — a supercluster in 40 Gyr is a
   * legitimate thing to look at and the curve is defined there. */
  const AGE_NOW = 13.79;

  /* Comoving radius of the observable universe, in Gpc — how far the *slab*
   * can extend, because that is everything there is to look at. */
  const HORIZON_GPC = 14.3;

  /* The cosmological *event* horizon, and the one that matters here. Structures
   * further away than this can be seen — their old light is already on its way
   * — but no signal sent from here will ever reach them, and nothing they send
   * from now on will ever reach us. They are visible and permanently
   * incommunicado, which is a much stranger and more useful fact than "too far
   * to see", and it is why the Hubble-volume rung is worth climbing to. */
  const EVENT_HORIZON_GPC = 4.9;

  const NODE_COUNT = 34;

  /* Each rung of this scope looks at a different slab of the same structure —
   * the volume grows by about an order of magnitude a rung, so what was one
   * node at the Local Group rung is a speck at the Hubble rung. */
  const SPANS = {
    group: 0.004,          // ~4 Mpc: the Local Group and its neighbours
    supercluster: 0.11,    // ~110 Mpc: Laniakea-scale
    web: 1.4,              // Gpc: the filament network proper
    hubble: HORIZON_GPC    // everything there is
  };

  function spanFor(tierId) { return SPANS[tierId] || SPANS.web; }

  /* ── Growth ───────────────────────────────────────────────────────────────
   *
   * Overdensity against the mean, as a logistic in cosmic time. Each node has
   * its own primordial seed amplitude and its own collapse time, both hashed —
   * which is the honest shape: structure formation is one process running at
   * different rates on a spectrum of initial perturbations, not a set of
   * objects that appear on a schedule.
   */
  function growthAt(seedAmp, collapseGyr, tGyr) {
    if (!(tGyr > 0)) return 0;
    /* Steepness rises with the seed: a big primordial overdensity collapses
     * fast once it goes, a small one takes forever. */
    const k = 0.35 + seedAmp * 1.1;
    return 1 / (1 + Math.exp(-k * (tGyr - collapseGyr)));
  }

  /* d(growth)/dt, normalised to its own peak. This is what "assembling now"
   * means, and it is the number the bonus reads. */
  function assemblyAt(seedAmp, collapseGyr, tGyr) {
    const g = growthAt(seedAmp, collapseGyr, tGyr);
    /* Logistic derivative is k·g·(1-g), peaking at g = 0.5 where it equals
     * k/4 — so g·(1-g)·4 is exactly the fraction of peak rate, with no need
     * to know k. */
    return clamp01(g * (1 - g) * 4);
  }

  /* ── The slab ─────────────────────────────────────────────────────────────
   *
   * Derived from (worldSeed, sector, rung). Pure, so the same patch of sky is
   * the same patch every time, and scrubbing τ moves the structure rather than
   * re-rolling it.
   */
  function webAt(game, sx, sy, tierId, tGyr, out) {
    const span = spanFor(tierId);
    const seed = hashN(game.seed ^ 0x5EED, sx, sy, tierId.length * 977);
    const o = out || {};
    const nodes = o.nodes || (o.nodes = []);
    nodes.length = 0;

    let deepestVoid = 0, assembling = 0, disconnected = 0;

    for (let i = 0; i < NODE_COUNT; i++) {
      const h = hashN(seed, i, 0x11);
      const ang = hashF(h, 1) * TAU;
      /* Uniform in area, not in radius — otherwise everything piles into the
       * middle and the "void" measurement is meaningless. */
      const rad = Math.sqrt(hashF(h, 2)) * 0.95;
      const amp = 0.15 + hashF(h, 3) * 0.85;
      /* Collapse time: big seeds collapse early. Real, and it is why the
       * universe looks lumpier the further back the picture is taken from. */
      const collapse = lerp(9.5, 1.2, amp);
      const g = growthAt(amp, collapse, tGyr);
      const asm = assemblyAt(amp, collapse, tGyr);
      if (asm > assembling) assembling = asm;

      /* Comoving distance of this node, in Gpc, from the span of the rung. */
      const dist = rad * span;
      const beyond = dist > EVENT_HORIZON_GPC;
      if (beyond) disconnected++;

      nodes.push({
        i,
        x: Math.cos(ang) * rad, y: Math.sin(ang) * rad,
        amp, collapse,
        growth: g,
        assembly: asm,
        dist,
        beyond,
        /* An essence, addressed exactly as the field addresses one, so the
         * thing you recognise in a supercluster is the thing you recognised in
         * a cell. */
        essence: RS.fractal.essenceAt(game.seed, sx * 613 + i, sy * 811),
        /* Only structures that have actually collapsed are visible as
         * anything. Before that they are a smoothly overdense region. */
        formed: g > 0.5
      });
    }

    /* Voids. Measured properly: for a grid of sample points, the distance to
     * the nearest *formed* node. The biggest such distance is the deepest void
     * in this slab, and finding it is a real observation rather than a label —
     * it also genuinely grows with τ, because a node that has not collapsed
     * does not fill a void. */
    /* Before anything has collapsed the whole slab is void, and the loop below
     * would report zero because it never finds a node to measure against —
     * which is exactly backwards. An empty universe is not a universe without
     * voids; it is a universe that is nothing but one. */
    let anyFormed = false;
    for (const n of nodes) if (n.formed) { anyFormed = true; break; }
    if (!anyFormed) deepestVoid = 0.95;

    for (let gx = -3; gx <= 3; gx++) {
      for (let gy = -3; gy <= 3; gy++) {
        const px = gx / 3.4, py = gy / 3.4;
        if (Math.hypot(px, py) > 0.95) continue;
        let near = Infinity;
        for (const n of nodes) {
          if (!n.formed) continue;
          const d = Math.hypot(n.x - px, n.y - py);
          if (d < near) near = d;
        }
        if (anyFormed && near !== Infinity && near > deepestVoid) deepestVoid = near;
      }
    }

    /* Filaments. A pair is linked when both have collapsed and they are close
     * enough that the growing mode had time to bridge them — which is a
     * function of τ, so the network genuinely assembles rather than fading in.
     */
    const links = o.links || (o.links = []);
    links.length = 0;
    const reach = 0.22 + clamp01(tGyr / AGE_NOW) * 0.26;
    for (let a = 0; a < nodes.length; a++) {
      if (!nodes[a].formed) continue;
      for (let b = a + 1; b < nodes.length; b++) {
        if (!nodes[b].formed) continue;
        const d = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
        if (d > reach) continue;
        links.push({ a, b, d, strength: clamp01(1 - d / reach) });
      }
    }

    o.span = span;
    o.tierId = tierId;
    o.tGyr = tGyr;
    o.deepestVoid = deepestVoid;
    /* In real units, which is the number worth reporting: the largest void in
     * the local universe is about 0.3 Gpc across, so this should land in the
     * same neighbourhood at the web rung. */
    o.voidGpc = deepestVoid * span;
    o.assembling = assembling;
    o.disconnected = disconnected;
    o.formed = nodes.reduce((n, x) => n + (x.formed ? 1 : 0), 0);
    return o;
  }

  /* Cosmic time from the τ dial. Unembodied τ is a scrub everywhere else too;
   * here the scale is the age of the universe, which is what makes the same
   * control feel completely different without being a different control. */
  function timeOf(game) {
    const s = game.scene;
    return Math.max(0.02, AGE_NOW + (s.webT || 0));
  }

  function tick(game, bus, dt) {
    const s = game.scene;
    const D = game.dials;
    /* τ scrubs Gyr rather than years. Cubic in the dial so a small turn is a
     * careful look at one collapse and a big one is the whole history. */
    const rate = Math.sign(D.time.value) * Math.pow(Math.abs(D.time.value), 3) * 1.4;
    s.webT = clamp((s.webT || 0) + rate * dt, -AGE_NOW + 0.05, 90);

    const tier = RS.cosmos.TIERS[clamp(Math.round(D.space.value), 0, RS.cosmos.TIERS.length - 1)];
    s.web = webAt(game, game.galaxy.sx, game.galaxy.sy, tier.id, timeOf(game), s.web);
    if (game.inhabiting && game.body) RS.vessel.confine(game.body, 0.95);
  }

  function enter(game, bus) {
    const s = game.scene;
    s.webT = s.webT || 0;
    tick(game, bus, 0);
    bus.emit('web:enter', { web: s.web });
    return s.web;
  }

  /* ── The only-here payout ─────────────────────────────────────────────────
   *
   * Two multipliers, both of which require reading something no other scope
   * shows you: whether the structure you are working is *assembling right now*,
   * and whether it is causally *disconnected* from here.
   */
  function bonusFor(game) {
    const s = game.scene;
    if (s.kind !== 'web' || !s.web) return 1;
    /* Assembly: at most double, and only while the growth rate is near its
     * peak. Sitting at the present day is the *worst* time to work a filament
     * that finished collapsing eight billion years ago. */
    const asm = 1 + s.web.assembling * 1.0;
    /* Disconnection: information from beyond the horizon cannot be checked
     * against anything local, which is either worthless or the most valuable
     * thing in the game depending on whether you believe the premise. The game
     * believes the premise. */
    const dis = 1 + clamp01(s.web.disconnected / NODE_COUNT) * 1.6;
    return asm * dis;
  }

  function readout(game) {
    const s = game.scene;
    const w = s.web;
    if (!w) return { title: 'Cosmic Web', sub: 'resolving…' };
    const t = w.tGyr;
    return {
      title: (RS.cosmos.BY_ID[w.tierId] || { name: 'Cosmic Web' }).name,
      sub: t < 1 ? 'Nearly uniform. Structure has not found itself yet.'
        : t < 5 ? 'Overdensities are collapsing. The network is finding its shape.'
          : t < 20 ? 'Filaments and voids. Most of the volume is empty.'
            : 'Long past the present. The web has finished, and is coming apart.',
      tGyr: t,
      formed: w.formed,
      voidGpc: w.voidGpc,
      assembling: w.assembling,
      disconnected: w.disconnected,
      bonus: bonusFor(game)
    };
  }

  RS.web = {
    AGE_NOW, HORIZON_GPC, EVENT_HORIZON_GPC, NODE_COUNT, SPANS, spanFor,
    growthAt, assemblyAt, webAt, timeOf, tick, enter, bonusFor, readout
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
