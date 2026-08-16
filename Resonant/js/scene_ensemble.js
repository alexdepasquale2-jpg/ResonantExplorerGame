/* Resonant — the Ensemble scope. The last thing the premise has to say.
 *
 * ── The argument, finished ────────────────────────────────────────────────
 *
 * The claim all game has been that one body of information is rendered
 * differently by local rules. So far "local rules" has meant a rung's geometry
 * and a band's primitives — the *same* essence drawn as a spiral arm here and a
 * coiled flagellum there, behaving the same way in both because it is the same
 * four numbers underneath.
 *
 * Here, local rules means **the laws**. An ensemble node is an alternative
 * block of constants (physics.js), and standing in one swaps them: stars fuse
 * at a different temperature, atmospheres bleed away or cannot, life starts
 * everywhere or almost nowhere. And the essences are *still the same
 * essences*. Cascade still branches. That is either a trivial observation or
 * the entire thesis, depending on how seriously the premise was meant, and the
 * game means it seriously.
 *
 * ── What you actually do ──────────────────────────────────────────────────
 *
 * Nodes are blocks. Each is drawn as a figure by the same self-similar
 * generator that draws everything else, in `abstract` geometry, because a
 * universe has no spatial form to render — only relations.
 *
 * Standing in one, the game **derives a specimen system under those laws** and
 * shows it beside the same address derived under ours. Two stars, one address,
 * different constants. It is the most direct statement the game can make, and
 * it is a picture rather than a paragraph.
 *
 * ── The safety rule ───────────────────────────────────────────────────────
 *
 * Leaving the scope restores our block, always. An alternative universe you
 * forgot you were standing in would silently re-derive every world in the game
 * and look like a bug rather than a mechanic. The scope owns the swap, and
 * `scenes.changeScene` restores on exit.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, hashF, hashN, TAU } = RS.core;

  const NODE_COUNT = 9;

  /* Which slice of the ensemble a rung looks at. The top four rungs are already
   * labelled with Tegmark's levels, so the scope uses them as its index: a
   * different rung is a different family of alternatives, not a zoom. */
  function familyOf(tierId) {
    const t = RS.cosmos.BY_ID[tierId];
    return t && t.level ? t.level : 'I';
  }

  function ensembleAt(game, tierId, out) {
    const o = out || {};
    const family = familyOf(tierId);
    const base = hashN(game.seed ^ 0xE115, family.length * 31, 0x77);
    const nodes = o.nodes || (o.nodes = []);
    nodes.length = 0;

    for (let i = 0; i < NODE_COUNT; i++) {
      const idx = (base + i * 7919) >>> 0;
      const block = RS.physics.blockAt(game.seed, idx, nodes[i] && nodes[i].block);
      const h = hashN(base, i, 5);
      const ang = (i / NODE_COUNT) * TAU + hashF(h, 1) * 0.35;
      const rad = 0.34 + hashF(h, 2) * 0.46;
      nodes.push({
        i, idx, block,
        x: Math.cos(ang) * rad, y: Math.sin(ang) * rad,
        /* Distance from our block drives everything visible about a node: how
         * far out it sits, how strange it looks, and what it pays. */
        distance: RS.physics.distanceFrom(block),
        /* An essence per node, so the abstract geometry has something to draw
         * and so a player can hunt a *particular* essence across universes —
         * which is the RECOGNITION pathway's endgame. */
        essence: RS.fractal.essenceAt(game.seed, idx, i),
        hue: 186 + RS.physics.distanceFrom(block) * 120
      });
    }
    o.family = family;
    o.tierId = tierId;
    return o;
  }

  /* ── Standing in a block ──────────────────────────────────────────────────
   *
   * Adopting one swaps the live constants. Everything derived afterwards —
   * stars, worlds, biospheres — comes out of the new block, which is the whole
   * mechanic, and is also why the galaxy cache has to be dropped: a cached star
   * is a star from the universe you just left.
   */
  function adopt(game, bus, node) {
    const s = game.scene;
    if (!node) return null;
    s.blockNode = node;
    RS.physics.use(node.block);
    invalidate(game);
    bus.emit('ensemble:adopt', { block: node.block, distance: node.distance });
    return node.block;
  }

  function release(game, bus) {
    const s = game.scene;
    if (RS.physics.isOurs() && !s.blockNode) return;
    s.blockNode = null;
    RS.physics.use(RS.physics.OURS);
    invalidate(game);
    if (bus) bus.emit('ensemble:release', {});
  }

  /* Anything derived-and-kept has to go when the laws change. There is very
   * little of it, because the game stores almost nothing — which is exactly the
   * property that makes a mechanic like this cheap instead of impossible. */
  function invalidate(game) {
    if (game.galaxy) game.galaxy.cacheKey = '';
    const s = game.scene;
    s.specimen = null;
    /* The current system and planet were derived under the old block. Drop
     * them; they will be re-derived on demand under the new one. */
    if (s.system) s.system = null;
    if (s.planet) s.planet = null;
  }

  /* ── The specimen ─────────────────────────────────────────────────────────
   *
   * One address, derived twice: once under our block and once under the
   * adopted one. This is the scope's picture, and it is worth more than any
   * amount of prose about what a different mass–luminosity exponent means.
   */
  function specimenFor(game, block) {
    const prev = RS.physics.use(RS.physics.OURS);
    const ours = sampleSystem(game);
    RS.physics.use(block);
    const there = sampleSystem(game);
    RS.physics.use(prev);
    return { ours, there };
  }

  function sampleSystem(game) {
    const sys = RS.stellar.systemAt(game.seed, 0, 0, 0);
    if (!sys) return null;
    const st = sys.primary;
    let worlds = 0, living = 0;
    for (let i = 0; i < sys.bodies.length; i++) {
      if (sys.bodies[i].kind !== 'planet') continue;
      worlds++;
      const p = RS.planet.planetAt(sys, i);
      if (p && p.biosphere) living++;
    }
    return {
      name: sys.name,
      mass: st.mass,
      temp: st.temperature,
      lum: st.luminosity,
      cls: st.cls.name,
      hzInner: sys.hz.inner, hzOuter: sys.hz.outer,
      worlds, living
    };
  }

  function enter(game, bus) {
    const s = game.scene;
    const tier = RS.cosmos.TIERS[clamp(Math.round(game.dials.space.value), 0, RS.cosmos.TIERS.length - 1)];
    s.ensemble = ensembleAt(game, tier.id, s.ensemble);
    s.blockNode = null;
    RS.physics.use(RS.physics.OURS);
    bus.emit('ensemble:enter', { ensemble: s.ensemble });
    return s.ensemble;
  }

  function tick(game, bus, dt) {
    const s = game.scene;
    s.ensembleT = (s.ensembleT || 0) + dt;
    const tier = RS.cosmos.TIERS[clamp(Math.round(game.dials.space.value), 0, RS.cosmos.TIERS.length - 1)];
    if (!s.ensemble || s.ensemble.tierId !== tier.id) {
      /* Moving between the four ensemble rungs is moving between *families* of
       * alternative, so the block you were standing in does not come with you. */
      release(game, bus);
      s.ensemble = ensembleAt(game, tier.id, s.ensemble);
    }

    /* Δ selects. The phase dial is the only one not already spoken for here —
     * there is no space to move through and no time to scrub — so it becomes
     * the thing that picks which universe you are pointed at, which is a
     * genuinely good use of a dial that is otherwise idle in this scope. */
    const want = pick(game);
    if (want && want !== s.blockNode) adopt(game, bus, want);

    if (s.blockNode && !s.specimen) s.specimen = specimenFor(game, s.blockNode.block);
  }

  /* Which node Δ is pointed at. Nodes sit at their own angles, so this is a
   * literal compass. */
  function pick(game) {
    const s = game.scene;
    if (!s.ensemble || !s.ensemble.nodes.length) return null;
    const phi = game.dials.phase.value;
    let best = null, bd = Infinity;
    for (const n of s.ensemble.nodes) {
      const a = Math.atan2(n.y, n.x);
      const d = Math.abs(RS.core.angDelta(phi, a));
      if (d < bd) { bd = d; best = n; }
    }
    /* Only within a reasonable arc — pointing between two universes should
     * select neither, so the dial has a dead zone and the choice is
     * deliberate. */
    return bd < 0.32 ? best : null;
  }

  /* Recognising an essence under laws unlike ours is the premise's strongest
   * claim, so it is the scope's payout. Scales with how far the block is from
   * ours, because a universe that differs by 3% proves nothing. */
  function bonusFor(game) {
    const s = game.scene;
    if (s.kind !== 'ensemble' || !s.blockNode) return 1;
    return 1 + s.blockNode.distance * 3.0;
  }

  function readout(game) {
    const s = game.scene;
    const e = s.ensemble;
    if (!e) return { title: 'Ensemble', sub: 'resolving…' };
    if (!s.blockNode) {
      return {
        title: 'Level ' + e.family + ' Ensemble',
        sub: 'Turn Δ to point at a block. Nothing here has a place — only laws.',
        count: e.nodes.length
      };
    }
    const b = s.blockNode.block;
    return {
      title: b.name,
      sub: b.blurb,
      level: b.level,
      distance: s.blockNode.distance,
      rows: RS.physics.compare(b, []),
      specimen: s.specimen,
      bonus: bonusFor(game)
    };
  }

  RS.ensemble = {
    NODE_COUNT, familyOf, ensembleAt, adopt, release, invalidate,
    specimenFor, sampleSystem, enter, tick, pick, bonusFor, readout
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
