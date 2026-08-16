/* Resonant — the guide, and the map of progression.
 *
 * ── Why this is generated rather than written ─────────────────────────────
 *
 * This game asks a player to understand four continuous dials, a 22-rung scale
 * ladder, twelve reality layers, four scenes, ten vessel types and a contact
 * protocol. A static manual for that would be long, and — worse — it would
 * describe the game in general while the player is looking at a specific
 * situation they do not understand.
 *
 * So every panel here is derived from live state. The dial section says what
 * τ does *right now*, in this mode, in this body. The ladder shows which rungs
 * are actually open and which one you are on. The pathways show what each
 * route has cost you and what it has given you. A player who is confused can
 * open this and read about the thing in front of them rather than about the
 * game in the abstract.
 *
 * ── The three pathways ────────────────────────────────────────────────────
 *
 * The progression panel exists because this game has six genuinely different
 * routes forward and no obvious way to tell that from the inside:
 *
 *   TUNE        spectrum bands → gnosis → yield everywhere. Pure skill; needs
 *               nothing but dials. Always available, never mandatory.
 *   REACH       research → vessels → worlds → structures. The material route.
 *   CONTACT     find a culture → standing → charts and teaching. The shortcut
 *               route: a civilisation can hand you research and reveal stars
 *               your own field cannot reach.
 *   INWARD      Σ range downward → microscopy → the four small scopes. The only
 *               route that reaches the one place you change a world from
 *               inside it.
 *   BEYOND      Σ range upward → the cosmic web → the ensemble. Ends in the
 *               game's final statement about its own premise: the same
 *               essences, under different laws.
 *   RECOGNITION hunt one essence across contexts until you can predict it.
 *               Only a real strategy since gnosis became foresight — before
 *               that, understanding was a yield multiplier and nothing else.
 *
 * The first three are about the spectrum, the material world and other people.
 * The last three are about the ladder and about knowledge, and a player can
 * finish the game having barely touched any given three of the six.
 *
 * They feed each other — insight from any of them buys any of them — but a
 * player can lead with whichever suits them, and the panel says so explicitly
 * rather than leaving it to be inferred.
 */
(function (RS) {
  'use strict';
  const { fmt, clamp01, hsl } = RS.core;

  /* Live meaning of each dial, in the mode the player is actually in. */
  function dialRows(game) {
    const embodied = game.inhabiting;
    const arch = RS.vessel.archOf(game.body);
    const D = game.dials;

    if (embodied) {
      const m = arch.dialMap;
      return [
        { sym: 'τ', hue: 43, name: 'Time', does: m.time,
          now: D.time.value.toFixed(2) + '×',
          note: 'While you have a body, τ is your throttle. Negative reverses.' },
        { sym: 'Σ', hue: 338, name: 'Space', does: m.space,
          now: (clamp01((D.space.value - D.space.min) / Math.max(1e-6, D.space.max - D.space.min)) * 100).toFixed(0) + '%',
          note: 'Your vertical axis in this body — it does not move the scale ladder while embodied.' },
        { sym: 'Δ', hue: 268, name: 'Phase', does: m.phase,
          now: (D.phase.value * 57.3).toFixed(0) + '°',
          note: 'A closed circle, which is exactly what a heading is.' },
        { sym: 'φ', hue: 187, name: 'Frequency', does: m.frequency,
          now: 'φ' + D.frequency.value.toFixed(1),
          note: 'Which layer your senses are tuned to.' }
      ];
    }
    return [
      { sym: 'τ', hue: 43, name: 'Time', does: 'scrubs history',
        now: D.time.value.toFixed(2) + '×',
        note: 'Unembodied, τ moves through a world\'s past and future. Populations, ' +
          'technologies and prices are closed-form, so this is exact at any distance.' },
      { sym: 'Σ', hue: 338, name: 'Space', does: 'moves the scale ladder',
        now: RS.cosmos.tierAt(D.space.value).name,
        note: 'Turning Σ inward descends: map → system → surface. It is the only navigation.' },
      { sym: 'Δ', hue: 268, name: 'Phase', does: 'the fourth dimension',
        now: (D.phase.value * 57.3).toFixed(0) + '°',
        note: 'Selects which slice of a worldline is present. Required by most layers, and by carriers.' },
      { sym: 'φ', hue: 187, name: 'Frequency', does: 'selects the reality layer',
        now: 'φ' + D.frequency.value.toFixed(1) + ' / ' + D.frequency.max.toFixed(0) + ' reach',
        note: 'The axis everything else is read against. Civilisations broadcast on it too.' }
    ];
  }

  const SYMBOLS = [
    { g: 'Ψ', name: 'Insight', what: 'Spent. Buys dial upgrades, research and structures.' },
    { g: '◈', name: 'Gnosis', what: 'Never spent. Counts contexts you have recognised an essence in. Pays out everywhere at once.' },
    { g: '◉', name: 'Contact', what: 'A civilisation is within earshot. The button only appears when one is.' },
    { g: '◎', name: 'Reach ring', what: 'On the map: the edge of your consciousness field. Inside it, stars are places; outside, lights.' },
    { g: '○', name: 'Green ring', what: 'On the map: that system holds life.' },
    { g: '◍', name: 'Amber pulse', what: 'On the map: that system is inhabited. This is the rarest marker in the game.' },
    { g: '⌇', name: 'Ghost layer', what: 'A band you can see and cannot hold. Buy φ FOCUS.' },
    { g: '⊘', name: 'Dashed ring', what: 'On a node: blocked. On the map: charted by somebody else, not by you.' }
  ];

  function guideHTML(game) {
    const D = game.dials;
    const sc = game.scene;
    let h = '';

    // ── where you are, right now ──
    h += '<section><h3>Right now</h3>' +
      '<p class="blurb">You are a point of consciousness. You cannot move. ' +
      'You change what is <em>rendered</em> to you, and everything else follows.</p>' +
      '<div class="stats">' +
      '<div>Scene <b>' + sc.kind.toUpperCase() + '</b></div>' +
      '<div>Mode <b style="color:' + (game.inhabiting ? '#fca5a5' : '#7dd3fc') + '">' +
        (game.inhabiting ? 'PILOTING — ' + RS.vessel.archOf(game.body).name : 'OBSERVING') + '</b></div>' +
      '<div>Scale <b>' + RS.cosmos.tierAt(D.space.value).name + '</b></div>' +
      '<div>Next <b>' + RS.game.sceneObjective(game).text.slice(0, 46) + '</b></div>' +
      '</div></section>';

    // ── the dials, as they mean things right now ──
    h += '<section><h3>Your four dials <em>' +
      (game.inhabiting ? 'piloting' : 'observing') + '</em></h3>' +
      '<p class="blurb">The dials are the whole interface. They mean different things ' +
      'in different modes — that is the only thing you have to keep track of.</p><div class="list">';
    for (const r of dialRows(game)) {
      h += '<div class="row" style="--h:' + r.hue + '">' +
        '<span class="g">' + r.sym + '</span>' +
        '<span class="n">' + r.name + ' — ' + r.does + '<em>' + r.now + '</em></span>' +
        '<span class="d">' + r.note + '</span></div>';
    }
    h += '</div>' +
      '<p class="blurb">Drag a knob in a circle. <b>Swing your finger wide for fine control</b> — ' +
      'sensitivity falls off with distance from the hub. Double-tap latches fine mode. ' +
      'Two thumbs work two dials at once.</p></section>';

    // ── the ladder ──
    h += '<section><h3>The scale ladder <em>Σ</em></h3>' +
      '<p class="blurb">Turning Σ is how you travel. Each range of rungs shows a different world.</p>' +
      '<div class="list">';
    const rungs = [
      { name: 'Attunement field', range: 'galactic and beyond', what: 'Tune reality layers. Where insight and gnosis come from.',
        active: sc.kind === 'field', hue: 338 },
      { name: 'Galactic map', range: 'interstellar · cluster', what: 'The stars around you. Choose where to go.',
        active: sc.kind === 'galaxy', hue: 190 },
      { name: 'System', range: 'stellar · planetary system', what: 'Planets, moons, belts, trade, and anybody living there.',
        active: sc.kind === 'system', hue: 285 },
      { name: 'Surface', range: 'planetary and within', what: 'Stand on a world. Needs a body.',
        active: sc.kind === 'planet', hue: 130 },
      { name: 'Cytoplasm', range: 'cellular', what: 'Inside one cell of a living world. Work here and its biosphere changes.',
        active: sc.kind === 'cellular', hue: 150 },
      { name: 'Orbital shells', range: 'nucleonic · atomic', what: 'Finite places, and no two may be the same. Catch a degeneracy.',
        active: sc.kind === 'shells', hue: 210 },
      { name: 'Molecular', range: 'molecular', what: 'Handedness. A living world settled which hand it uses — find one of the other.',
        active: sc.kind === 'molecular', hue: 196 },
      { name: 'Quantum foam', range: 'planck · quantum', what: 'Nothing persists, including your body. Find the pair that never cancelled.',
        active: sc.kind === 'foam', hue: 291 },
      { name: 'Cosmic web', range: 'local group → hubble volume', what: 'τ is the age of the universe. Catch a filament while it assembles.',
        active: sc.kind === 'web', hue: 276 },
      { name: 'Ensemble', range: 'inflationary → mathematical', what: 'Alternative laws. Δ picks one; the constants change under you.',
        active: sc.kind === 'ensemble', hue: 210 }
    ];
    for (const r of rungs) {
      h += '<div class="row' + (r.active ? '' : ' dim') + '" style="--h:' + r.hue + '">' +
        '<span class="g">' + (r.active ? '◉' : '○') + '</span>' +
        '<span class="n">' + r.name + '<em>Σ ' + r.range + '</em></span>' +
        '<span class="d">' + r.what + '</span></div>';
    }
    const reachLo = RS.cosmos.TIERS[Math.round(D.space.min)].short;
    const reachHi = RS.cosmos.TIERS[Math.round(D.space.max)].short;
    h += '</div><p class="blurb">Your Σ reaches <b>' + reachLo + '</b> to <b>' + reachHi +
      '</b>. Buy Σ RANGE to open the ladder further in either direction.</p></section>';

    // ── symbols ──
    h += '<section><h3>What the symbols mean</h3><div class="list">';
    for (const s of SYMBOLS) {
      h += '<div class="row" style="--h:200"><span class="g">' + s.g + '</span>' +
        '<span class="n">' + s.name + '</span><span class="d">' + s.what + '</span></div>';
    }
    h += '</div></section>';

    // ── the beat ──
    h += '<section><h3>Tuning by ear</h3>' +
      '<p class="blurb">Two tones close in pitch beat against each other. Far off tune, a fast ' +
      'warble; close, a slow throb; dead on, silence and a steady tone. The φ dial drives a real ' +
      'detuned oscillator pair, so <b>you can find a layer with your eyes shut</b> — and the ring ' +
      'around you pulses at the same rate if you are playing muted. This is the single most useful ' +
      'thing to learn.</p></section>';

    return h;
  }

  // ── progression ──────────────────────────────────────────────────────────

  function pathwaysHTML(game) {
    const D = game.dials;
    const bands = Object.keys(game.known.bands).length;
    const tiers = Object.keys(game.known.tiers).length;
    const gn = RS.fractal.totalGnosis(game);
    const res = Object.keys(game.research).length;
    const worlds = Object.keys(game.known.planets).length;
    const systems = Object.keys(game.known.systems).length;
    const charted = Object.keys(game.known.charted).length;
    const met = RS.contact.totalMet(game);
    const allies = RS.contact.allies(game);

    /* Scope coverage: how much of the ladder this player has actually stood on,
     * which is what the two new routes are about. */
    const scopesSeen = {};
    for (const id in game.known.tiers) {
      const t = RS.cosmos.BY_ID[id];
      if (t) scopesSeen[RS.scenes.sceneForTier(t.index)] = true;
    }
    const scopeCount = Object.keys(scopesSeen).length;
    const inwardScopes = ['foam', 'shells', 'molecular', 'cellular'].filter(k => scopesSeen[k]).length;
    const beyondScopes = ['web', 'ensemble'].filter(k => scopesSeen[k]).length;
    const expressed = expressionTotal(game);
    const fore = foresight(game);

    let h = '<section><h3>Six ways forward</h3>' +
      '<p class="blurb">They feed each other — insight from any route buys any other — ' +
      'but you can lead with whichever suits you. None of them is the main one, and ' +
      'the game can be finished having barely touched three of them.</p></section>';

    const paths = [
      {
        name: 'TUNE', hue: 187,
        premise: 'Skill with the dials. Needs nothing but the instrument you already have.',
        rows: [
          ['Layers held', bands + ' / ' + RS.spectrum.BANDS.length],
          ['Scales visited', tiers + ' / ' + RS.cosmos.TIERS.length],
          ['Gnosis', gn + ' contexts'],
          ['φ reach', 'φ' + D.frequency.max.toFixed(0)],
          ['φ focus', (RS.dials.focusOf(D.frequency) * 100).toFixed(0) + '%']
        ],
        next: nextTuning(game)
      },
      {
        name: 'REACH', hue: 130,
        premise: 'Research, bodies, worlds, structures. The material route.',
        rows: [
          ['Research', res + ' / ' + RS.influence.RESEARCH.length],
          ['Bodies', Object.keys(game.vessels.unlocked).length + ' / ' + RS.vessel.ARCHETYPES.length],
          ['Systems visited', systems],
          ['Worlds surveyed', worlds],
          ['Structures sited', RS.influence.structureCount(game)],
          ['Consciousness field', game.fields.consciousness.toFixed(2) +
            ' (' + (RS.influence.reachRadius(game) * RS.galaxy.LY_PER_SECTOR).toFixed(0) + ' ly)']
        ],
        next: nextReach(game)
      },
      {
        name: 'CONTACT', hue: 45,
        premise: 'Find a culture and stay on good terms. They hand you charts and teach you research ' +
          'you would otherwise have to buy.',
        rows: [
          ['Cultures met', met],
          ['Allies', allies],
          ['Stars charted by others', charted],
          ['Reality field', game.fields.reality.toFixed(2)]
        ],
        next: nextContact(game)
      },
      {
        /* INWARD. The ladder runs both ways and the small end was, until the
         * scopes existed, somewhere you could only look rather than work. */
        name: 'INWARD', hue: 150,
        premise: 'Down the ladder rather than out. Four scopes below the surface, each with ' +
          'something findable nowhere else — and the only place you change a world from inside it.',
        rows: [
          ['Small scopes entered', inwardScopes + ' / 4'],
          ['Microscopy', RS.influence.isResearched(game, 'microscopy') ? 'researched' : 'not yet'],
          ['Bodies for small places', (game.vessels.unlocked.ciliate ? 1 : 0) + ' / 1'],
          ['Worlds expressed', expressed.worlds],
          ['Deepest expression', (expressed.best * 100).toFixed(0) + '%'],
          ['Σ inward reach', RS.cosmos.TIERS[Math.round(game.dials.space.min)].short]
        ],
        next: nextInward(game, scopesSeen, expressed)
      },
      {
        /* BEYOND. The other end of the same ladder, and the one that ends in
         * the game's final statement about its own premise. */
        name: 'BEYOND', hue: 276,
        premise: 'Up the ladder past the galaxy. Structure that assembles over thirteen billion ' +
          'years, and then the laws themselves as a place you can stand in.',
        rows: [
          ['Vast scopes entered', beyondScopes + ' / 2'],
          ['Σ outward reach', RS.cosmos.TIERS[Math.round(game.dials.space.max)].short],
          ['Blocks adopted', game.stats.blocksAdopted || 0],
          ['Furthest from ours', ((game.stats.farthestBlock || 0) * 100).toFixed(0) + '%']
        ],
        next: nextBeyond(game, scopesSeen)
      },
      {
        /* RECOGNITION. Only a real strategy since gnosis became foresight —
         * before that, hunting a particular essence bought a yield multiplier
         * and nothing else. */
        name: 'RECOGNITION', hue: 320,
        premise: 'Hunt one essence across contexts until you can predict it. Understanding ' +
          'is not a multiplier any more — it draws the behaviour before you measure it.',
        rows: [
          ['Essences met', fore.met + ' / ' + RS.fractal.ESSENCES.length],
          ['Axes revealed', fore.axes + ' / ' + (RS.fractal.ESSENCES.length * 4)],
          ['Fully read', fore.complete],
          ['Closest to a reveal', fore.nearest ? fore.nearest.name + ' (' + fore.gap + ' more)' : '—']
        ],
        next: nextRecognition(game, fore)
      }
    ];

    for (const p of paths) {
      h += '<section class="up-dial" style="--h:' + p.hue + '">' +
        '<header><span class="sym">◈</span><h3>' + p.name + '</h3></header>' +
        '<p class="blurb">' + p.premise + '</p><div class="stats">';
      for (const [k, v] of p.rows) h += '<div>' + k + ' <b>' + v + '</b></div>';
      h += '</div><p class="blurb" style="color:hsl(' + p.hue + ',80%,70%)">→ ' + p.next + '</p></section>';
    }

    // overall
    const prog = RS.game.progress(game);
    h += '<section><h3>Overall</h3><div class="stats">' +
      '<div>Progress <b>' + (prog * 100).toFixed(1) + '%</b></div>' +
      '<div>Lifetime insight <b>' + fmt(game.lifetimeInsight) + ' Ψ</b></div>' +
      '<div>Crystallised <b>' + fmt(game.stats.crystals) + '</b></div>' +
      '<div>Jumps <b>' + (game.stats.jumps || 0) + '</b></div>' +
      '<div>Played <b>' + fmt(Math.floor(game.stats.playSeconds / 60)) + ' min</b></div>' +
      '</div></section>';
    return h;
  }

  function nextTuning(game) {
    const D = game.dials;
    const foc = RS.dials.focusOf(D.frequency);
    for (const b of RS.spectrum.BANDS) {
      if (game.known.bands[b.id]) continue;
      if (b.centre > D.frequency.max) continue;
      if (RS.spectrum.isGhost(b, foc)) return 'Buy φ FOCUS — ' + b.name + ' is in reach but will not cohere.';
      return 'Tune φ to ' + b.centre + ' and hold: the ' + b.name + ' layer is untouched.';
    }
    const nb = RS.spectrum.BANDS.find(b => b.centre > D.frequency.max);
    return nb ? 'Buy φ RANGE to reach the ' + nb.name + ' layer at φ' + nb.centre + '.'
      : 'Every layer is held. Deepen gnosis by finding the same essences at new scales.';
  }

  function nextReach(game) {
    const open = RS.influence.RESEARCH.filter(n => RS.influence.researchAvailable(game, n));
    if (open.length) {
      const cheap = open.reduce((a, b) => (a.cost < b.cost ? a : b));
      return 'Research ' + cheap.name + ' (' + fmt(cheap.cost) + ' Ψ) — ' + cheap.blurb;
    }
    if (!RS.influence.structureCount(game)) return 'Site your first structure on a world you care about.';
    return 'Raise the consciousness field with beacons to reach further stars.';
  }

  /* ── The three new routes ─────────────────────────────────────────────────
   *
   * Each answers the same question the first three do — "what is the single
   * most useful thing I could do next, given where I actually am" — against a
   * different axis of the game. They are computed from live state rather than
   * scripted, so a route that is already finished says so instead of repeating
   * its first step forever.
   */

  /* How much of the game's worlds this player has reshaped from inside. */
  function expressionTotal(game) {
    let worlds = 0, best = 0;
    for (const k in game.deltas) {
      for (const d of game.deltas[k]) {
        if (d.id !== RS.influence.EXPRESSION_ID) continue;
        worlds++;
        const v = 1 - Math.exp(-d.work / RS.influence.EXPRESSION_SCALE);
        if (v > best) best = v;
      }
    }
    return { worlds, best };
  }

  /* The state of the gnosis ledger as *foresight* rather than as a score:
   * how many axes are actually revealed, and which essence is closest to
   * giving up its next one. */
  function foresight(game) {
    let met = 0, axes = 0, complete = 0;
    let nearest = null, gap = Infinity;
    for (const e of RS.fractal.ESSENCES) {
      const n = RS.fractal.gnosisOf(game, e.id);
      if (n > 0) met++;
      const revealed = RS.fractal.revealCount(n);
      axes += revealed;
      if (revealed >= 4) { complete++; continue; }
      /* Distance to the next reveal threshold. Ties break toward the essence
       * you have already met most often: "two more contexts of Cascade, which
       * you have already seen four times" is a hunt worth continuing, whereas
       * "two more contexts of something you have never met" is just a
       * restatement of the reveal rule. */
      const need = RS.fractal.REVEAL_AT[revealed];
      const d = need - n;
      if (d > 0 && (d < gap || (d === gap && nearest &&
          n > RS.fractal.gnosisOf(game, nearest.id)))) {
        gap = d; nearest = e;
      }
    }
    return { met, axes, complete, nearest, gap: gap === Infinity ? 0 : gap };
  }

  function nextInward(game, seen, expressed) {
    const D = game.dials;
    /* Reach first: the small rungs are literally unreachable until Σ range is
     * bought, so telling a player to visit them would be nonsense. */
    for (const id of ['cellular', 'molecular', 'shells', 'foam']) {
      const rung = RS.scenes.tierForScene(id);
      if (rung < Math.round(D.space.min)) {
        return 'Buy Σ RANGE to reach the ' + RS.cosmos.TIERS[rung].name + ' rung — ' +
          'four scopes sit below where your dial currently stops.';
      }
      if (!seen[id]) {
        return 'Turn Σ to ' + RS.cosmos.TIERS[rung].name + '. ' +
          RS.scenes.SCENE_BY_ID[id].blurb;
      }
    }
    if (!RS.influence.isResearched(game, 'microscopy')) {
      return 'Research MICROSCOPY — the ciliate is the only body that works where inertia does not.';
    }
    if (!expressed.worlds) {
      return 'Crystallise inside a cell. It is the only place you change a world from inside it, ' +
        'and the change shows from orbit afterwards.';
    }
    if (expressed.best < 0.5) {
      return 'Keep working cells on the same world — expression saturates, so the early ' +
        'crystals move a biosphere furthest.';
    }
    return 'The small end is yours. Hunt a wrong-handed molecule on a homochiral world, ' +
      'or a degeneracy in the shells.';
  }

  function nextBeyond(game, seen) {
    const D = game.dials;
    for (const id of ['web', 'ensemble']) {
      const rung = RS.scenes.tierForScene(id);
      if (rung > Math.round(D.space.max)) {
        return 'Buy Σ RANGE to reach the ' + RS.cosmos.TIERS[rung].name + ' rung.';
      }
      if (!seen[id]) {
        return 'Turn Σ out to ' + RS.cosmos.TIERS[rung].name + '. ' +
          RS.scenes.SCENE_BY_ID[id].blurb;
      }
    }
    if (!game.stats.blocksAdopted) {
      return 'In the Ensemble, turn Δ onto a block and stand in it. The constants change under you ' +
        'and every world re-derives.';
    }
    if ((game.stats.farthestBlock || 0) < 0.5) {
      return 'Find a block further from ours — the payout scales with how unlike ours it is, ' +
        'and a universe 3% off proves nothing.';
    }
    return 'Recognise an essence under laws unlike ours. That is the strongest claim the game makes.';
  }

  function nextRecognition(game, fore) {
    if (!fore.met) {
      return 'Crystallise anything. Every manifestation is an essence, and meeting one in a new ' +
        'context is what reveals its axes.';
    }
    if (fore.nearest) {
      const known = RS.fractal.predicted(game, fore.nearest.id, {});
      const which = RS.fractal.AXES.find(a => known[a] === undefined);
      return 'Find ' + fore.nearest.name + ' in ' + fore.gap + ' more context' +
        (fore.gap > 1 ? 's' : '') + ' — a different layer or a different rung — and its ' +
        (which || 'next axis') + ' is revealed. The HUD will draw it before you measure it.';
    }
    if (fore.complete < RS.fractal.ESSENCES.length) {
      return fore.complete + ' essences fully read. Keep meeting the rest in new places.';
    }
    return 'Every essence is fully read. You can predict any layer at any scale before you tune it.';
  }

  function nextContact(game) {
    const met = RS.contact.totalMet(game);
    const c = game.scene.contact;
    if (c) {
      const st = RS.contact.stateOf(game, c.planet, c.civ, c.lock);
      if (st === RS.contact.STATES.open || st === RS.contact.STATES.warm) {
        if (c.relayed) {
          return 'A relay is holding the channel with ' + c.civ.name +
            '. Keep φ on their carrier, or go back and listen.';
        }
        return 'A channel is open with ' + c.civ.name + '. Listen first — it costs nothing.';
      }
      return 'Tune φ to ' + c.lock.carrier.phi.toFixed(1) + ' to reach ' + c.civ.name + '.';
    }
    if (!met) {
      const foc = RS.dials.focusOf(game.dials.frequency);
      const mn = RS.spectrum.BY_ID.mnemonic;
      if (mn.centre > game.dials.frequency.max) {
        return 'Nobody is reachable yet: the lowest carrier band sits at φ' + mn.centre +
          ', past your dial. Buy φ RANGE.';
      }
      if (RS.spectrum.isGhost(mn, foc)) {
        return 'You can reach the Mnemonic layer but not hold it. Buy φ FOCUS.';
      }
      return 'Look for amber pulsing rings on the galactic map, then descend into that system.';
    }
    return 'Raise standing above +0.45 with an ally and ask them to teach you. ' +
      'A probe left in their sky, or a beacon, keeps the channel open after you leave.';
  }

  RS.guide = { guideHTML, pathwaysHTML, dialRows, SYMBOLS };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
