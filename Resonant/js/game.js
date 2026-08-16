/* Resonant — game state, economy and progression gates.
 *
 * Two currencies, and they are deliberately different in kind:
 *
 *   INSIGHT (Ψ)  spent. Buys dial upgrades. Flows in from crystallising
 *                manifestations, so it measures activity.
 *   GNOSIS       never spent. Counts distinct (essence, tier, band) contexts
 *                a player has recognised an essence in, so it measures
 *                *understanding* — and because it is stored against the
 *                essence rather than the instance, it pays out everywhere at
 *                once. That is the fractal premise expressed as an economy:
 *                learn a thing anywhere, know it everywhere.
 */
(function (RS) {
  'use strict';
  const { clamp01 } = RS.core;

  const SAVE_VERSION = 2;

  function newGame(seed) {
    /* A new game starts in our own universe. The physics block is module-level
     * rather than per-game — it has to be, because every derivation reads it
     * without being handed a game — so beginning a session while an ensemble
     * block from a previous one is still adopted would silently derive the
     * whole galaxy under borrowed laws. */
    RS.physics.use(RS.physics.OURS);
    const game = {
      version: SAVE_VERSION,
      seed: (seed >>> 0) || 0x5EED1,
      createdAt: Date.now(),
      savedAt: Date.now(),

      dials: RS.dials.newSet(),
      field: RS.field.newField(),

      insight: 0,
      lifetimeInsight: 0,
      passiveRate: 0,
      yieldMul: 1,

      /* The map the player is filling in. Both start with only what the point
       * of consciousness is issued with: the root tier and the layer it is
       * already inside. */
      known: {
        tiers: { [RS.cosmos.TIERS[RS.cosmos.ROOT_INDEX].id]: true },
        bands: { baryonic: true },
        /* Systems and planets are recorded by address, not by content — the
         * worlds themselves re-derive, so this is a visited-list, not a
         * world-save. A thousand explored systems is a few kilobytes. */
        systems: Object.create(null),
        planets: Object.create(null),
        /* Stars a civilisation has told you about. Distinct from `systems`
         * (which you have been to) because a chart you were given is a real
         * thing to have and a real reason to talk to anyone. */
        charted: Object.create(null)
      },
      gnosis: Object.create(null),

      /* ── the embodied half ─────────────────────────────────────────────── */
      scene: RS.scenes.newScene(),
      galaxy: RS.galaxy.newState(),
      /* Per-civilisation relationship records. Four numbers per culture; the
       * culture itself stays derived. */
      contacts: Object.create(null),
      body: RS.vessel.newBody('mote'),
      inhabiting: false,
      vessels: { unlocked: { mote: true } },
      research: Object.create(null),
      structuresUnlocked: Object.create(null),
      /* Sparse deltas: the only thing the player can permanently change about
       * a world, keyed by planet address. See influence.js. */
      deltas: Object.create(null),
      fields: { consciousness: 0.1, reality: 0.05, beacons: 0, resonators: 0 },
      senseBonus: 0,
      /* Per-world survey work. Two numbers per planet you have tapped:
       * diminishing clicker income without a cell map. */
      surveys: Object.create(null),

      strike: RS.strike.newState(),

      strikeLevels: Object.create(null),

      stats: { blocksAdopted: 0, farthestBlock: 0, crystals: 0, bestSingle: 0, playSeconds: 0, ticks: 0, systemsSeen: 0, worldsSeen: 0, jumps: 0, contacts: 0, surveys: 0 },

      /* Transient, rebuilt every frame — never saved. */
      focusNode: null,
      __spec: null,

      settings: {
        audio: true, haptics: true, reduceMotion: false, showSci: true,
        /* 'all' | 'key' | 'off'. Default 'key': arrivals, discoveries and
         * warnings, but not routine chatter. Every notification restates
         * something the readout or the objective line also says, so filtering
         * them costs nothing but noise. */
        notify: 'key',
        /* Bloom. On by default because it costs well under a millisecond and
         * is the largest single visual change in the codebase; off is here for
         * anything that struggles. */
        bloom: true
      },
      flags: Object.create(null)
    };
    RS.dials.refreshReach(game.dials);
    RS.influence.recomputeFields(game);
    return game;
  }

  // --- upgrades ------------------------------------------------------------

  function tryUpgrade(game, bus, dialId, kind) {
    const dial = game.dials[dialId];
    if (!dial || !RS.dials.canUpgrade(dial, kind)) return { ok: false, reason: 'maxed' };
    const cost = RS.dials.costOf(dial, kind);
    if (!Number.isFinite(cost)) return { ok: false, reason: 'maxed' };
    if (game.insight < cost) return { ok: false, reason: 'insufficient', cost };

    game.insight -= cost;
    const beforeMax = dial.max;
    RS.dials.applyUpgrade(dial, kind);

    bus.emit('upgrade', { dial, kind, cost, level: dial.levels[kind] });

    /* Reaching further along the frequency axis can put a whole layer inside
     * the dial's travel for the first time. That is the biggest moment the
     * game has and it deserves its own event. */
    if (dialId === 'frequency' && kind === 'range') {
      for (const b of RS.spectrum.BANDS) {
        const nowReachable = b.centre <= dial.max;
        const wasReachable = b.centre <= beforeMax;
        if (nowReachable && !wasReachable) bus.emit('reach:band', { band: b });
      }
    }
    if (dialId === 'space' && kind === 'range') {
      for (const t of RS.cosmos.TIERS) {
        const now = t.index >= dial.min && t.index <= dial.max;
        const was = t.index >= (beforeMax === dial.max ? dial.min : dial.min) && t.index <= beforeMax;
        if (now && !was) bus.emit('reach:tier', { tier: t });
      }
    }
    /* Focus can lift a band out of ghost state without any dial movement — the
     * layer was always there and the observer simply became able to hold it. */
    if (dialId === 'frequency' && kind === 'focus') {
      const foc = RS.dials.focusOf(dial);
      const prevFoc = 1 - Math.pow(0.855, dial.levels.focus - 1);
      for (const b of RS.spectrum.BANDS) {
        if (b.minFocus > prevFoc && b.minFocus <= foc) bus.emit('reach:cohere', { band: b });
      }
    }
    return { ok: true, cost };
  }

  /* What the player should be told to do next. Kept as an explicit function
   * rather than a scripted tutorial so it stays correct at every point in the
   * game, including after a load. */
  function nextObjective(game) {
    const D = game.dials;
    const foc = RS.dials.focusOf(D.frequency);

    if (game.stats.crystals === 0) {
      return { text: 'Drag the cyan φ knob until the beat goes still, then hold.', kind: 'tutorial' };
    }
    /* Descent is a want, not a shop. After the first crystal, name the star
     * (or the Σ purchase that opens the map) before the next φ upgrade — the
     * globe they cannot touch is the reason to buy a body. */
    const mapRung = RS.scenes.tierForScene('galaxy');
    const canReachMap = mapRung >= D.space.min && mapRung <= D.space.max;
    if ((game.stats.systemsSeen || 0) === 0) {
      if (!canReachMap) {
        return { text: 'Buy Σ RANGE, then turn Σ inward — a star is waiting.', kind: 'range' };
      }
      return { text: 'Turn Σ inward to the star map. Tap a star, then turn Σ again.', kind: 'descend' };
    }
    const hunt = recognitionHunt(game);
    const sits = RS.situations && RS.situations.live ? RS.situations.live(game) : [];
    if (sits.length && sits[0].kind === 'hunt-here') return sits[0];
    /* A band inside the dial's reach but never crystallised is the strongest
     * pull the game has — it is visible, it is close, and it is not yours. */
    for (const b of RS.spectrum.BANDS) {
      if (game.known.bands[b.id]) continue;
      if (b.centre > D.frequency.max) continue;
      if (RS.spectrum.isGhost(b, foc)) {
        return { text: 'The ' + b.name + ' layer is in reach but will not cohere. Buy φ FOCUS.', kind: 'focus', band: b };
      }
      return { text: 'Untouched layer inside your reach: ' + b.name + ' at φ' + b.centre.toFixed(0) + '.', kind: 'tune', band: b };
    }
    /* Everything reachable is taken; the next thing is more reach. */
    const nextBand = RS.spectrum.BANDS.find(b => b.centre > D.frequency.max);
    if (nextBand) {
      return { text: 'Nothing new within φ' + D.frequency.max.toFixed(0) + '. Buy φ RANGE to reach ' + nextBand.name + '.', kind: 'range', band: nextBand };
    }
    if (hunt) return hunt;
    const nextTier = RS.cosmos.TIERS.find(t => !game.known.tiers[t.id] && t.index >= D.space.min && t.index <= D.space.max);
    if (nextTier) return { text: 'Unvisited scale in reach: ' + nextTier.name + '.', kind: 'tier', tier: nextTier };
    return { text: 'Buy Σ RANGE to open the ladder further within, or beyond.', kind: 'range' };
  }

  /* After an essence has been met twice, the objective may name it. Insight
   * cannot buy this pathway; that is the point. A pinned hunt (codex tap)
   * wins over the nearest-to-reveal, so the lattice is a map you can use. */
  function recognitionHunt(game) {
    let ess = null;
    if (game.flags && game.flags.huntEssence) {
      ess = RS.fractal.ESSENCE_BY_ID[game.flags.huntEssence];
    }
    if (!ess) {
      if (!RS.guide || !RS.guide.foresight) return null;
      const fs = RS.guide.foresight(game);
      if (!fs || !fs.nearest) return null;
      ess = fs.nearest;
    }
    const n = RS.fractal.gnosisOf(game, ess.id);
    if (n < 2) return null;
    const places = RS.fractal.huntPlaces(game, ess.id);
    if (!places.length && RS.fractal.attuneLevel(game, ess.id) >= 4 &&
        !(game.flags && game.flags.huntEssence === ess.id)) return null;
    const where = places.length
      ? 'Find it in ' + places.join(', or in ') + '.'
      : 'Find it in a cell, or in a filament.';
    const scene = game.scene && game.scene.kind;
    const here = RS.situations && RS.situations.huntHere && RS.situations.huntHere(game);
    if (here) return here;
    if (scene === 'cellular' && places.indexOf('a cell') >= 0) {
      return { text: ess.name + ' still has a blank here. Hold it in this cell.',
        kind: 'recognition', essence: ess };
    }
    if (scene === 'web' && places.indexOf('a filament') >= 0) {
      return { text: ess.name + ' still has a blank on this filament. Hold while it assembles.',
        kind: 'recognition', essence: ess };
    }
    return { text: ess.name + ' still has a blank axis. ' + where,
      kind: 'recognition', essence: ess };
  }

  function liveSituations(game) {
    return (RS.situations && RS.situations.live) ? RS.situations.live(game) : [];
  }

  function pinHunt(game, essenceId) {
    if (!game.flags) game.flags = Object.create(null);
    if (!essenceId || !RS.fractal.ESSENCE_BY_ID[essenceId]) {
      delete game.flags.huntEssence;
      return { ok: false, reason: 'unknown' };
    }
    game.flags.huntEssence = essenceId;
    return { ok: true, essence: RS.fractal.ESSENCE_BY_ID[essenceId] };
  }

  /* Persistent tap language. Same three meanings (strike / pulse / pick);
   * the chip is what stops the cursor from lying. */
  function sceneVerb(game) {
    const s = game.scene;
    if (!s) return 'STRIKE';
    if (s.kind === 'planet') return 'SURVEY';
    if (s.kind === 'system') return 'AIM';
    if (s.kind === 'galaxy') return game.galaxy && game.galaxy.target ? 'TRAVEL' : 'AIM';
    return 'STRIKE';
  }

  /* The objective line inside an embodied scene is a different question, so it
   * gets its own function rather than overloading the tuning one. */
  function sceneObjective(game) {
    const s = game.scene;
    if (s.kind === 'galaxy') {
      const reachLy = (RS.influence.reachRadius(game) * RS.galaxy.LY_PER_SECTOR).toFixed(0);
      if (game.flags && game.flags.firstAmberName && !game.stats.contacts) {
        return { text: 'Someone is here — ' + game.flags.firstAmberName +
          '. Tap the amber ring.', kind: 'contact' };
      }
      if (!game.galaxy.target) {
        const rumours = RS.galaxy.rumourMarks ? RS.galaxy.rumourMarks(game) : [];
        if (rumours.length) {
          return { text: 'A rumour names ' + rumours[0].name +
            '. Follow the dashed mark.', kind: 'contact' };
        }
        return { text: 'Tap a star to select it. Dim stars are beyond your ' + reachLy +
          ' ly field — amber rings are inhabited.', kind: 'select' };
      }
      const t = game.galaxy.target;
      if (!t.inReach && !t.visited && !t.charted) {
        return { text: t.name + ' is ' + t.dist.toFixed(1) + ' ly away, past your ' + reachLy +
          ' ly reach. Expand the consciousness field, or ask a civilisation for charts.', kind: 'reach' };
      }
      return { text: 'Tap ' + t.name + ' again to travel, then turn Σ inward to enter it.', kind: 'travel' };
    }
    if (s.kind === 'system') {
      if (s.contact) {
        const st = RS.contact.stateOf(game, s.contact.planet, s.contact.civ, s.contact.lock);
        if (st === RS.contact.STATES.open || st === RS.contact.STATES.warm) {
          return { text: 'Channel open with ' + s.contact.civ.name + '. Open the ◉ panel.', kind: 'contact' };
        }
        if (!s.contact.lock.inReach) {
          return { text: s.contact.civ.name + ' broadcasts at φ' + s.contact.lock.carrier.phi.toFixed(1) +
            ' — past your dial. Buy φ RANGE.', kind: 'contact' };
        }
        return { text: 'A carrier at φ' + s.contact.lock.carrier.phi.toFixed(1) + '. Tune φ and Δ onto it.', kind: 'contact' };
      }
      if (!game.research.locomotion) {
        return { text: 'Research Locomotion (120 Ψ) to walk this.', kind: 'research' };
      }
      if (s.planet && !s.planet.type.landable) {
        return { text: s.planet.name + ' has no surface. Select a rocky world, then turn Σ inward to descend.', kind: 'select' };
      }
      if (s.planet) {
        return { text: 'Turn Σ inward to descend to ' + s.planet.name + '. τ scrubs its history while you are unembodied.', kind: 'descend' };
      }
      return { text: 'Tap a world to select it.', kind: 'select' };
    }
    if (s.kind === 'web') {
      const w = s.web;
      if (!w) return { text: 'Resolving the structure…', kind: 'wait' };
      if (w.tGyr < 1) {
        return { text: 'Almost nothing has collapsed yet. Turn τ forward and watch it assemble.',
          kind: 'scrub' };
      }
      if (w.assembling > 0.25) {
        return { text: 'A filament is assembling *now*. Present day is the wrong time — crystallise while it is still growing.',
          kind: 'express' };
      }
      return { text: 'Nothing is assembling at ' + w.tGyr.toFixed(1) +
        ' Gyr. Scrub τ to find a collapse in progress.', kind: 'scrub' };
    }
    if (s.kind === 'ensemble') {
      if (!s.blockNode) {
        return { text: 'Turn Δ to point at a block of laws. Nothing here has a place — only rules.',
          kind: 'select' };
      }
      const d = Math.round(s.blockNode.distance * 100);
      return { text: 'The same system, twice: ours, and ' + s.blockNode.block.name +
        ' (' + d + '% unlike). Leave and physics restores.',
        kind: 'express' };
    }
    if (s.kind === 'molecular') {
      const m = s.molecule;
      if (!m) return { text: 'Resolving…', kind: 'wait' };
      if (m.bias < 0.1) {
        return { text: 'Both hands in equal numbers here — nothing is choosing. Find a living world and come back.',
          kind: 'select' };
      }
      if (m.anomalous) {
        return { text: m.anomalous + ' molecule' + (m.anomalous > 1 ? 's' : '') +
          ' of the wrong hand — the warm ones. That is the find.',
          kind: 'express' };
      }
      return { text: 'Every chiral site here is the hand life chose. Sweep Σ for a sample that is not.',
        kind: 'select' };
    }
    if (s.kind === 'shells') {
      const sh = s.shells;
      if (!sh) return { text: 'Resolving…', kind: 'wait' };
      if (sh.degenerate) {
        return { text: sh.degenerate + ' occupants share an energy without sharing a state. ' +
          'Two fighting over one place — that coincidence is where chemistry comes from.',
          kind: 'express' };
      }
      return { text: sh.displaced + ' occupants were pushed outward because their state was taken. ' +
        'Excited, and about to fall back.', kind: 'express' };
    }
    if (s.kind === 'foam') {
      const f = s.foam;
      if (!f) return { text: 'Resolving…', kind: 'wait' };
      const r = RS.foam.readout(game);
      if (r.meanLife < 1.2) {
        return { text: 'Nothing here lasts ' + r.meanLife.toFixed(2) +
          ' s. Bring τ down toward zero — slow time is the only way to hold anything.',
          kind: 'scrub' };
      }
      if (f.survivors) {
        return { text: f.survivors + ' fluctuation' + (f.survivors > 1 ? 's' : '') +
          ' never cancelled — the bright, still one. Work that.',
          kind: 'express' };
      }
      return { text: 'Every pair here closes. Sweep Σ for a slab where one did not.', kind: 'select' };
    }
    if (s.kind === 'cellular') {
      const why = RS.cellular.reasonSterile(s.planet);
      if (why) {
        return { text: 'Nothing here to be inside: ' + why +
          '. Turn Σ out and pick a world with life on it.', kind: 'select' };
      }
      if (!game.vessels.unlocked.ciliate && !game.inhabiting) {
        return { text: 'Research MICROSCOPY for a body that works where inertia does not.',
          kind: 'research' };
      }
      const ex = RS.influence.expressionOn(game, s.planet);
      if (ex < 0.005) {
        return { text: 'Crystallise in here and ' + s.planet.name +
          "'s biosphere changes. It is the only place you can work a world from inside.",
          kind: 'express' };
      }
      return { text: 'Turn Σ out — ' + s.planet.name +
        "'s biosphere has changed. You can read it from orbit.", kind: 'express' };
    }
    if (s.kind === 'planet') {
      if (!game.inhabiting) {
        if (!game.research.locomotion) {
          return { text: 'Research Locomotion (120 Ψ) to walk this.', kind: 'research' };
        }
        return { text: 'Take a body to touch this world. Unembodied, you can only watch it.', kind: 'embark' };
      }
      const st = RS.vessel.statusOf(game);
      if (st && st.blocked) {
        const shore = RS.scenes.nearestStandable && RS.scenes.nearestStandable(game, st.arch);
        let fix = st.alternative ? '. Take the ' + st.alternative.name + ' instead.'
          : '. Nothing you have works here.';
        if (/liquid/i.test(st.blocked) && shore && shore.bearing) {
          fix = '. Shore is ' + shore.bearing +
            (st.alternative ? ', or take the ' + st.alternative.name : '') + '.';
        }
        return { text: 'This body cannot work here: ' + st.blocked + fix, kind: 'blocked' };
      }
      /* The dial map lives on the pilot bar now and is permanently visible, so
       * repeating it here would spend the one line that could say something
       * about *this* world on something the player can already read. */
      if (st && st.strain > 0.6) {
        return { text: 'Strain at ' + Math.round(st.strain * 100) +
          '%. Leave the body before it fails, or the hold goes with it.', kind: 'blocked' };
      }
      if (st && st.endurance !== Infinity && st.endurance < 45) {
        return { text: Math.round(st.endurance) + 's of charge at this pace. Ease off τ or turn back.',
          kind: 'blocked' };
      }
      const p = s.planet;
      if (p && p.biosphere && p.biosphere.complexity > 0.34) {
        if (st && st.ridingCiv) {
          return { text: 'Riding this culture. τ leans on their trajectory — they do not become a creature.',
            kind: 'explore' };
        }
        if (st && st.arch && st.arch.id === 'symbiont') {
          return { text: 'The symbiont rides a mind here, or a civilisation from orbit. Tap the scene tag or C to change camera.',
            kind: 'explore' };
        }
        return { text: 'Life here. Ride a mind with the symbiont — in orbit that is a civilisation — or turn Σ inward to enter a cell.',
          kind: 'explore' };
      }
      if (p && p.resources && Object.keys(p.resources).length) {
        return { text: 'Seams below. Tap the ground to read them, or extract with the harvester.',
          kind: 'explore' };
      }
      return { text: 'Walk it. Tap the ground to survey a seam. C or the scene tag switches SIDE-ON / MAP.', kind: 'pilot' };
    }
    return nextObjective(game);
  }

  /* Overall completion, for the readout. Weighted so the player can see that
   * the ladder is the long game and the spectrum is the near one. */
  function progress(game) {
    const bands = Object.keys(game.known.bands).length / RS.spectrum.BANDS.length;
    const tiers = Object.keys(game.known.tiers).length / RS.cosmos.TIERS.length;
    const maxG = RS.fractal.ESSENCES.length * 6;
    const gn = Math.min(1, RS.fractal.totalGnosis(game) / maxG);
    /* The embodied half counts too, or the bar would stop moving the moment a
     * player commits to exploring rather than tuning. */
    const res = Object.keys(game.research).length / RS.influence.RESEARCH.length;
    const worlds = Math.min(1, Object.keys(game.known.planets).length / 60);
    return clamp01(bands * 0.24 + tiers * 0.24 + gn * 0.22 + res * 0.18 + worlds * 0.12);
  }

  function tickMeta(game, dt) {
    game.stats.playSeconds += dt;
    game.stats.ticks++;
    if (game.insight > game.__lastInsight) {
      game.lifetimeInsight += game.insight - game.__lastInsight;
    }
    game.__lastInsight = game.insight;
  }

  /* Understanding survives the universe. Places do not. */
  function canOpenSeed(game) {
    if (!game) return false;
    const ensemble = RS.scenes && RS.scenes.tierForScene
      ? RS.cosmos.TIERS[RS.scenes.tierForScene('ensemble')] : null;
    if (ensemble && game.known.tiers[ensemble.id]) return true;
    for (const e of RS.fractal.ESSENCES) {
      if (RS.fractal.attuneLevel(game, e.id) >= 4) return true;
    }
    return progress(game) >= 0.72;
  }

  function openSeed(game, bus) {
    if (!canOpenSeed(game)) {
      return { ok: false, reason: 'the essences are not finished with this universe' };
    }
    const keep = {
      gnosis: game.gnosis,
      research: game.research,
      vessels: game.vessels.unlocked,
      structuresUnlocked: game.structuresUnlocked,
      senseBonus: game.senseBonus,
      strikeLevels: game.strikeLevels,
      settings: game.settings,
      lifetimeInsight: game.lifetimeInsight,
      levels: {},
      seedsOpened: (game.stats.seedsOpened || 0) + 1,
      carry: Math.min(40, game.insight * 0.08)
    };
    for (const id in game.dials) {
      const d = game.dials[id];
      keep.levels[id] = {
        range: d.levels.range, precision: d.levels.precision, focus: d.levels.focus
      };
    }
    const from = game.seed;
    const next = (RS.core.hashN(game.seed, game.stats.playSeconds | 0, 0x5EED2) >>> 0) || 1;
    const fresh = newGame(next);
    const keys = Object.keys(fresh);
    for (let i = 0; i < keys.length; i++) game[keys[i]] = fresh[keys[i]];
    game.gnosis = keep.gnosis;
    game.research = keep.research;
    game.vessels.unlocked = keep.vessels;
    game.vessels.unlocked.mote = true;
    game.structuresUnlocked = keep.structuresUnlocked;
    game.senseBonus = keep.senseBonus;
    game.strikeLevels = keep.strikeLevels;
    game.settings = keep.settings;
    game.lifetimeInsight = keep.lifetimeInsight;
    game.insight = keep.carry;
    game.stats.seedsOpened = keep.seedsOpened;
    for (const id in keep.levels) {
      const d = game.dials[id];
      if (!d) continue;
      d.levels.range = keep.levels[id].range;
      d.levels.precision = keep.levels[id].precision;
      d.levels.focus = keep.levels[id].focus;
    }
    RS.dials.refreshReach(game.dials);
    RS.influence.recomputeFields(game);
    if (bus && bus.emit) bus.emit('seed:open', { from: from, to: game.seed });
    return { ok: true, from: from, to: game.seed };
  }

  RS.game = {
    SAVE_VERSION, newGame, tryUpgrade, nextObjective, sceneObjective, sceneVerb,
    recognitionHunt, liveSituations, pinHunt, canOpenSeed, openSeed,
    progress, tickMeta
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
