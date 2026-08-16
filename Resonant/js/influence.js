/* Resonant — indirect influence, structures, research, and the two fields.
 *
 * ── The sparse-delta principle ────────────────────────────────────────────
 *
 * Everything in the world is derived (stellar.js, planet.js, civ.js). If the
 * player could edit a world directly, that would collapse — you would have to
 * store the whole world the moment it was touched, and the save would grow
 * without bound.
 *
 * So the player never edits a world. They place *structures*, and a structure
 * is a handful of numbers keyed by planet address. The world's actual state is
 * always:
 *
 *     effective = derived(address) ⊕ Σ deltas(address)
 *
 * A planet the player has terraformed for a hundred hours costs about forty
 * bytes. The baseline stays analytic, so time-scrubbing still works: the
 * deltas are applied *after* the closed-form evaluation at time t, which means
 * you can rewind and watch what a world would have done without you.
 *
 * ── Why influence is indirect ─────────────────────────────────────────────
 *
 * No structure sets a value. Every one of them changes a *rate* or a *bias* in
 * a system that then resolves on its own: a seeder nudges the abiogenesis rate
 * constant, it does not place life; a lattice raises a civilisation's tech
 * ceiling, it does not grant technology. The outcome runs through the same
 * closed-form models as everything else, so the player is always leaning on a
 * process rather than setting a variable — and processes push back, saturate,
 * and occasionally do something nobody intended.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, fmt } = RS.core;

  /* Address key for the delta store. Compact because it is the one thing here
   * that is actually persisted. */
  function planetKey(planet) {
    const a = planet.system.addr;
    return a.sx + ',' + a.sy + ',' + a.index + ',' + planet.bodyIndex;
  }

  function parsePlanetKey(key) {
    if (!key) return null;
    const p = String(key).split(',');
    if (p.length !== 4) return null;
    const sx = +p[0], sy = +p[1], index = +p[2], bodyIndex = +p[3];
    if (![sx, sy, index, bodyIndex].every(Number.isFinite)) return null;
    return { sx, sy, index, bodyIndex };
  }

  /* Re-derive a world from a stored address. Cheap, and the only way a
   * relationship record can talk about a neighbour without keeping a copy of
   * that neighbour around. */
  function planetFromKey(game, key) {
    const a = parsePlanetKey(key);
    if (!a) return null;
    const sys = RS.stellar.systemAt(game.seed, a.sx, a.sy, a.index);
    if (!sys || !sys.bodies[a.bodyIndex] || sys.bodies[a.bodyIndex].kind !== 'planet') return null;
    const p = RS.planet.planetAt(sys, a.bodyIndex);
    if (p) applyTo(game, p);
    return p;
  }

  /* ── Structures ───────────────────────────────────────────────────────────
   * `effect` names which derived quantity the structure biases. All of them
   * are rates, ceilings or radii — never absolute values. */
  const STRUCTURES = [
    {
      id: 'beacon', name: 'Resonance Beacon', glyph: '◇', hue: 200,
      cost: { insight: 220 }, research: 'fieldwork',
      blurb: 'Extends the consciousness field around it. You can sense, and be sensed, further out.',
      effect: 'Consciousness field +0.18 in this system.',
      upkeep: 0.4
    },
    {
      id: 'resonator', name: 'Reality Resonator', glyph: '◈', hue: 285,
      cost: { insight: 640 }, research: 'fieldwork',
      blurb: 'Thickens the reality field: your influence on local minds and processes bites harder.',
      effect: 'Reality field +0.15 in this system.',
      upkeep: 1.1
    },
    {
      id: 'extractor', name: 'Seam Extractor', glyph: '⊞', hue: 40,
      cost: { insight: 180 }, research: 'extraction',
      blurb: 'Works a resource seam continuously. The only structure that pays for itself.',
      effect: 'Passive yield scaled by the richest local resource.',
      upkeep: 0
    },
    {
      id: 'seeder', name: 'Biotic Seeder', glyph: '⚘', hue: 130,
      cost: { insight: 900 }, research: 'biotics',
      blurb: 'Raises the abiogenesis rate constant. It does not create life — it makes life likelier.',
      effect: 'Biosphere rate ×1.6, and can start one on a sterile but habitable world.',
      upkeep: 1.6
    },
    {
      id: 'regulator', name: 'Climate Regulator', glyph: '≋', hue: 175,
      cost: { insight: 1400 }, research: 'terraform',
      blurb: 'Biases the greenhouse term. Slow, planetary, and reversible if you leave.',
      effect: 'Surface temperature moved up to 40 K toward 288 K.',
      upkeep: 2.4
    },
    {
      id: 'lattice', name: 'Cognition Lattice', glyph: '⌘', hue: 60,
      cost: { insight: 2600 }, research: 'uplift',
      blurb: 'Raises what a local culture can reach. Whether they use it is theirs to decide.',
      effect: 'Local technology ceiling +0.12; contact likelihood up.',
      upkeep: 3.2
    },
    {
      id: 'anchor', name: 'Phase Anchor', glyph: '⊹', hue: 320,
      cost: { insight: 3800 }, research: 'anchoring',
      blurb: 'Pins a fourth-dimensional slice so it stops drifting. Locks hold without you.',
      effect: 'Coherence no longer decays in this system.',
      upkeep: 4.5
    }
  ];
  const STRUCT_BY_ID = Object.create(null);
  STRUCTURES.forEach((s, i) => { s.index = i; STRUCT_BY_ID[s.id] = s; });

  /* ── Research ─────────────────────────────────────────────────────────────
   * A small tree. Each node unlocks structures, vessels or field capacity.
   * Costs are in Insight, which ties the solar layer's progression back to the
   * attunement layer — you fund exploration by tuning, and tuning is what
   * exploration is for. */
  const RESEARCH = [
    { id: 'locomotion', name: 'Locomotion', cost: 120, needs: [], hue: 130,
      blurb: 'Bodies that walk and roll.', unlocks: { vessels: ['walker', 'rover'] } },
    { id: 'buoyancy', name: 'Buoyancy', cost: 300, needs: ['locomotion'], hue: 195,
      blurb: 'Displacement hulls for liquid media.', unlocks: { vessels: ['swimmer'] } },
    /* The INWARD branch. Deliberately hung off buoyancy rather than off
     * locomotion: a body that works where inertia does not exist is a
     * *departure* from swimming, not a refinement of walking, and the tree
     * should say so. It is also the cheapest route to a scope of its own,
     * which is what makes going inward a real alternative to going out. */
    { id: 'microscopy', name: 'Microscopy', cost: 520, needs: ['buoyancy'], hue: 150,
      blurb: 'Resolve, and inhabit, the scale a cell lives at.',
      unlocks: { vessels: ['ciliate'], senseBands: 1 } },
    { id: 'aerodynamics', name: 'Aerodynamics', cost: 420, needs: ['locomotion'], hue: 175,
      blurb: 'Lifting bodies. Requires an atmosphere to be worth anything.', unlocks: { vessels: ['flier'] } },
    { id: 'extraction', name: 'Extraction', cost: 380, needs: ['locomotion'], hue: 40,
      blurb: 'Take material out of a world.', unlocks: { vessels: ['harvester'], structures: ['extractor'] } },
    { id: 'reaction', name: 'Reaction Drive', cost: 900, needs: ['aerodynamics'], hue: 20,
      blurb: 'Leave a gravity well under your own power.', unlocks: { vessels: ['lander'] } },
    { id: 'transfer', name: 'Orbital Transfer', cost: 1600, needs: ['reaction'], hue: 285,
      blurb: 'Cross a system. Σ becomes orbital radius.', unlocks: { vessels: ['courier'] } },
    { id: 'sensing', name: 'Wide Sensing', cost: 700, needs: ['locomotion'], hue: 320,
      blurb: 'See further, and across more bands.', unlocks: { vessels: ['probe'], senseBands: 2 } },
    { id: 'fieldwork', name: 'Field Projection', cost: 1100, needs: ['sensing'], hue: 200,
      blurb: 'Build the two fields outward from where you stand.',
      unlocks: { structures: ['beacon', 'resonator'] } },
    { id: 'biotics', name: 'Biotic Engineering', cost: 2100, needs: ['fieldwork'], hue: 130,
      blurb: 'Bias where and how fast life takes hold.', unlocks: { structures: ['seeder'] } },
    { id: 'terraform', name: 'Climate Engineering', cost: 3200, needs: ['biotics'], hue: 175,
      blurb: 'Lean on a planet\'s energy balance.', unlocks: { structures: ['regulator'] } },
    { id: 'empathy', name: 'Affective Coupling', cost: 2400, needs: ['fieldwork'], hue: 340,
      blurb: 'Ride a living mind and lean on it.', unlocks: { vessels: ['symbiont'] } },
    { id: 'uplift', name: 'Uplift', cost: 5200, needs: ['empathy', 'biotics'], hue: 60,
      blurb: 'Raise what a culture can reach. They decide what to do with it.',
      unlocks: { structures: ['lattice'] } },
    { id: 'anchoring', name: 'Phase Anchoring', cost: 7400, needs: ['transfer', 'uplift'], hue: 320,
      blurb: 'Pin a slice of the fourth dimension in place.', unlocks: { structures: ['anchor'] } }
  ];
  const RESEARCH_BY_ID = Object.create(null);
  RESEARCH.forEach((r, i) => { r.index = i; RESEARCH_BY_ID[r.id] = r; });

  function isResearched(game, id) { return !!game.research[id]; }

  function researchAvailable(game, node) {
    return !isResearched(game, node.id) && node.needs.every(n => isResearched(game, n));
  }

  function tryResearch(game, bus, id) {
    const node = RESEARCH_BY_ID[id];
    if (!node) return { ok: false, reason: 'unknown' };
    if (isResearched(game, id)) return { ok: false, reason: 'done' };
    if (!researchAvailable(game, node)) return { ok: false, reason: 'locked' };
    if (game.insight < node.cost) return { ok: false, reason: 'insufficient', cost: node.cost };

    game.insight -= node.cost;
    game.research[id] = true;
    if (node.unlocks.vessels) for (const v of node.unlocks.vessels) game.vessels.unlocked[v] = true;
    if (node.unlocks.structures) for (const s of node.unlocks.structures) game.structuresUnlocked[s] = true;
    if (node.unlocks.senseBands) game.senseBonus = (game.senseBonus || 0) + node.unlocks.senseBands;
    bus.emit('research', { node });
    return { ok: true };
  }

  /* ── Placement ────────────────────────────────────────────────────────────
   * A structure is four numbers: what, where, when it was placed, and how far
   * along it is. Nothing else is stored about the world it changed. */
  function canPlace(game, planet, structId) {
    const s = STRUCT_BY_ID[structId];
    if (!s) return 'unknown structure';
    if (!game.structuresUnlocked[structId]) return 'not researched';
    if (game.insight < s.cost.insight) return 'needs ' + fmt(s.cost.insight) + ' Ψ';
    const list = game.deltas[planetKey(planet)];
    if (list && list.some(d => d.id === structId)) return 'already present';
    /* Upkeep is paid out of the passive rate; you cannot commit past your
     * income or the whole network browns out. */
    if (totalUpkeep(game) + s.upkeep > game.passiveRate + 0.5) return 'insufficient field income';
    return null;
  }

  function place(game, bus, planet, structId) {
    const reason = canPlace(game, planet, structId);
    if (reason) return { ok: false, reason };
    const s = STRUCT_BY_ID[structId];
    game.insight -= s.cost.insight;
    const key = planetKey(planet);
    const list = game.deltas[key] || (game.deltas[key] = []);
    list.push({ id: structId, at: game.stats.playSeconds, progress: 0 });
    bus.emit('structure:place', { planet, struct: s });
    return { ok: true };
  }

  /* ── Expression ───────────────────────────────────────────────────────────
   *
   * The Cellular scope's only-here consequence, and the only delta in the game
   * that is not a structure: it costs no insight and has no upkeep, because
   * what it costs is the attention you already spent crystallising inside the
   * cell. It is stored as one accumulating number per world rather than a
   * record per crystal — a player can hold a hundred nodes in there and the
   * save must not grow by a hundred entries.
   *
   * `structuresOn` and `totalUpkeep` filter by STRUCT_BY_ID and so skip it
   * without needing to know it exists.
   */
  const EXPRESSION_ID = '@expression';
  /* What a lifetime of work inside cells is worth, as a fraction of the way
   * from where the biosphere is to fully complex. Saturating, because a
   * biosphere is a logistic curve and shoving it is not the same as replacing
   * it: you can accelerate a world, not invent one. */
  const EXPRESSION_CAP = 0.45;
  const EXPRESSION_SCALE = 260;

  function express(game, bus, planet, amount) {
    if (!planet || !(amount > 0)) return null;
    const key = planetKey(planet);
    const list = game.deltas[key] || (game.deltas[key] = []);
    let rec = null;
    for (const d of list) if (d.id === EXPRESSION_ID) { rec = d; break; }
    if (!rec) { rec = { id: EXPRESSION_ID, at: game.stats.playSeconds, work: 0 }; list.push(rec); }
    rec.work += amount;
    if (bus) bus.emit('cell:express', { planet, work: rec.work, added: amount });
    return rec;
  }

  /* 0..1, how far this world has been pushed from inside. Saturating in the
   * accumulated work, so early crystals move it visibly and the thousandth
   * barely does — which is the honest shape for "nudging a logistic curve". */
  function expressionOn(game, planet) {
    const list = planet && game.deltas[planetKey(planet)];
    if (!list) return 0;
    for (const d of list) {
      if (d.id === EXPRESSION_ID) return 1 - Math.exp(-d.work / EXPRESSION_SCALE);
    }
    return 0;
  }

  function structuresOn(game, planet) {
    const list = game.deltas[planetKey(planet)];
    if (!list) return [];
    return list.map(d => ({ delta: d, struct: STRUCT_BY_ID[d.id] })).filter(x => x.struct);
  }

  function totalUpkeep(game) {
    let u = 0;
    for (const k in game.deltas) {
      for (const d of game.deltas[k]) {
        const s = STRUCT_BY_ID[d.id];
        if (s) u += s.upkeep;
      }
    }
    return u;
  }

  function structureCount(game) {
    let n = 0;
    for (const k in game.deltas) n += game.deltas[k].length;
    return n;
  }

  /* ── Applying deltas ──────────────────────────────────────────────────────
   * Called after a planet is derived. Mutates the *derived copy* — never a
   * stored one, because there is no stored one. Idempotent, since the copy is
   * freshly derived every time.
   *
   * `maturity` is the key idea: a structure's effect ramps in over in-world
   * time rather than snapping on. So placing a regulator does not terraform a
   * world, it starts terraforming one, and the player has to come back. */
  function applyTo(game, planet) {
    const list = game.deltas[planetKey(planet)];
    if (!list || !list.length) return planet;

    for (const d of list) {
      if (d.id === EXPRESSION_ID) {
        /* Work done inside the world's own cells, carried up to what the world
         * looks like from orbit. It cannot start life where there is none —
         * you have to have had a cell to stand in — but it can move a
         * biosphere a long way along a curve it was already on. */
        if (planet.biosphere) {
          const push = (1 - Math.exp(-d.work / EXPRESSION_SCALE)) * EXPRESSION_CAP;
          planet.biosphere.complexity = clamp01(
            planet.biosphere.complexity + (1 - planet.biosphere.complexity) * push);
          planet.biosphere.stage = RS.civ.stageOf(planet.biosphere.complexity);
          planet.biosphere.expressed = push;
          planet.influenced = true;
        }
        continue;
      }
      const s = STRUCT_BY_ID[d.id];
      if (!s) continue;
      /* Maturity: saturating over roughly twenty minutes of play. */
      const elapsed = Math.max(0, game.stats.playSeconds - d.at);
      const m = 1 - Math.exp(-elapsed / 1200);
      d.progress = m;

      switch (s.id) {
        case 'regulator': {
          /* Move surface temperature toward the biological optimum. Bounded,
           * because a regulator biases an energy balance — it does not
           * overrule one. */
          const target = 288;
          const shift = clamp(target - planet.surfaceTemp, -40, 40) * m;
          planet.surfaceTemp += shift;
          planet.influenced = true;
          break;
        }
        case 'seeder': {
          /* Raise the abiogenesis rate. If the world is habitable but sterile,
           * this can start a biosphere where the baseline said none — but it
           * still has to grow through the same logistic curve. */
          if (planet.habitability > 0.06) {
            if (!planet.biosphere) {
              planet.biosphere = {
                complexity: m * 0.25 * planet.habitability,
                stage: RS.civ.stageOf(m * 0.25 * planet.habitability),
                oxygenation: 0, biomass: m * 0.1, diversity: Math.floor(m * 90),
                chemistry: 'carbon-water', startedAt: 0, sapient: false, seeded: true
              };
            } else {
              planet.biosphere.complexity = clamp01(planet.biosphere.complexity * (1 + 0.6 * m));
              planet.biosphere.stage = RS.civ.stageOf(planet.biosphere.complexity);
              planet.biosphere.seeded = true;
            }
          }
          planet.influenced = true;
          break;
        }
        case 'extractor': {
          /* Marked so the economy can pay out; the yield itself is computed in
           * passiveFrom() so it stays a single source of truth. */
          planet.extracting = m;
          planet.influenced = true;
          break;
        }
        case 'lattice':
          planet.techCeiling = (planet.techCeiling || 0) + 0.12 * m;
          planet.influenced = true;
          break;
        case 'beacon':
          planet.beacon = m;
          break;
        case 'resonator':
          planet.resonator = m;
          break;
        case 'anchor':
          planet.anchored = m;
          break;
      }
    }
    /* Habitability is downstream of surface temperature, so anything that
     * moved the climate has to re-derive it rather than leave a stale value. */
    if (planet.influenced) planet.habitability = RS.planet.habitabilityOf(planet);
    return planet;
  }

  /* Passive income contributed by extractors, derived from the planet each one
   * sits on rather than being a flat rate — so siting matters. */
  function passiveFrom(game, planet) {
    if (!planet.extracting) return 0;
    let best = 0, kind = null;
    for (const k in planet.resources) {
      if (planet.resources[k] > best) { best = planet.resources[k]; kind = k; }
    }
    const c = RS.civ.COMM_BY_ID[kind];
    const value = c ? Math.log10(c.base + 10) : 1;
    return planet.extracting * best * value * 1.5;
  }

  /* ── The two fields ───────────────────────────────────────────────────────
   * Consciousness field: how far the player can reach and sense.
   * Reality field: how hard their influence bites when it gets there.
   *
   * Both grow from research, from gnosis (understanding is reach), and from
   * structures — three different currencies of progress feeding one pair of
   * numbers, which is what keeps the attunement layer relevant after the solar
   * layer opens. */
  function recomputeFields(game) {
    let beacons = 0, resonators = 0;
    for (const k in game.deltas) {
      for (const d of game.deltas[k]) {
        if (d.id === 'beacon') beacons += d.progress || 0;
        if (d.id === 'resonator') resonators += d.progress || 0;
      }
    }
    const gnosis = RS.fractal.totalGnosis(game);
    const researched = Object.keys(game.research).length;

    game.fields = {
      consciousness: clamp(0.1 + gnosis * 0.012 + researched * 0.05 + beacons * 0.18, 0, 6),
      reality: clamp(0.05 + gnosis * 0.008 + researched * 0.03 + resonators * 0.15, 0, 5),
      beacons, resonators
    };
    return game.fields;
  }

  /* How far the player can travel from their current locus, in systems. The
   * consciousness field is literally a reach radius, which is why expanding it
   * is the spine of the mid-game. */
  function reachRadius(game) {
    return 1 + Math.floor((game.fields ? game.fields.consciousness : 0) * 2.5);
  }

  RS.influence = {
    STRUCTURES, STRUCT_BY_ID, RESEARCH, RESEARCH_BY_ID,
    planetKey, parsePlanetKey, planetFromKey,
    isResearched, researchAvailable, tryResearch,
    canPlace, place, structuresOn, totalUpkeep, structureCount,
    express, expressionOn, EXPRESSION_ID, EXPRESSION_CAP, EXPRESSION_SCALE,
    applyTo, passiveFrom, recomputeFields, reachRadius
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
