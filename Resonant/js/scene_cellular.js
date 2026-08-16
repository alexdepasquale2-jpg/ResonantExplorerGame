/* Resonant — the Cellular scope. One cell of a living world, from inside.
 *
 * ── Why this scope exists ─────────────────────────────────────────────────
 *
 * Four of the twenty-two rungs had a view of their own. Rungs 0–8 all rendered
 * the same planet surface, which meant that standing on a world and standing
 * inside one of its cells looked identical — and that the `cell` backdrop and
 * the four `cell` essence forms (Nucleus, Vacuole, Cytoskeleton, Spore) were
 * written and unreachable.
 *
 * ── What is new here, and what deliberately is not ────────────────────────
 *
 * **Not new: the mechanics.** There is no bespoke cellular minigame. The
 * attunement loop runs exactly as it does anywhere else, and what you do here
 * is whatever the band you are tuned to says — a rhythm if you are in the
 * Electromagnetic layer, a dependency graph if you are in the Causal one. That
 * is the entire point of having six primitives: a new scope costs a file, not
 * a rule set, and everything a player learned about Cascade elsewhere is true
 * here on arrival.
 *
 * **New: what the scope is made of, and what it does to the world.** The cell
 * is derived from the host planet's own biosphere — a sterile world has no
 * cell to enter, a microbial one is a bare prokaryote, a complex one is full
 * of machinery — and crystallising in here writes an *expression* delta that
 * raises that biosphere's complexity. It is the only place in the game where
 * you act on a world from inside it, and the change is visible from orbit
 * afterwards.
 *
 * ── Derivation ────────────────────────────────────────────────────────────
 *
 * Nothing is stored. A cell is a pure function of (planet address, patch,
 * index), so the same cell is the same cell every time you return to it, and
 * the ten thousand you did not visit cost nothing.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, hashF, hashN, TAU } = RS.core;

  /* Cell type follows the host biosphere, because it should: you cannot find a
   * nucleus on a world that has not evolved one. The thresholds match the
   * stages `civ.stageOf` already uses, so the scope and the orbital readout
   * never disagree about what lives there. */
  const TYPES = [
    {
      id: 'protocell', name: 'Protocell', minComplexity: 0.0,
      blurb: 'A bounded droplet running the first autocatalytic loops.',
      organelles: 2, hue: 190
    },
    {
      id: 'prokaryote', name: 'Prokaryote', minComplexity: 0.10,
      blurb: 'No nucleus. Everything happens in one compartment, all at once.',
      organelles: 4, hue: 150
    },
    {
      id: 'eukaryote', name: 'Eukaryote', minComplexity: 0.34,
      blurb: 'Compartmented. An ancestor swallowed another and kept it.',
      organelles: 7, hue: 130
    },
    {
      id: 'tissue', name: 'Tissue Cell', minComplexity: 0.62,
      blurb: 'Specialised, and in constant conversation with its neighbours.',
      organelles: 10, hue: 96
    },
    {
      id: 'neural', name: 'Neural Cell', minComplexity: 0.86,
      blurb: 'A cell whose whole business is carrying a difference.',
      organelles: 12, hue: 60
    }
  ];

  function typeFor(complexity) {
    let best = TYPES[0];
    for (const t of TYPES) if (complexity >= t.minComplexity) best = t;
    return best;
  }

  /* Can this world be entered at all? A cell needs something to be a cell of.
   * Returning the reason rather than a boolean lets the HUD say why, which is
   * the difference between a locked door and a wall. */
  function reasonSterile(planet) {
    if (!planet) return 'no world selected';
    if (!planet.biosphere) return 'no biosphere — nothing here is alive';
    if (planet.biosphere.complexity < 0.02) return 'life here has not organised into cells yet';
    return null;
  }

  /* ── The cell ─────────────────────────────────────────────────────────────
   *
   * Organelles are essences. That is not decoration: `essenceAt` deliberately
   * excludes tier and band, so the *same* essence that showed up as a spiral
   * arm at the galactic rung shows up here as a coiled flagellum, and a player
   * who has read its axes already knows how it will behave. Local rules change
   * the rendering; the information is the same information.
   */
  function cellAt(game, planet, patch, index) {
    const bio = planet.biosphere;
    const c = bio ? bio.complexity : 0;
    const type = typeFor(c);
    const seed = hashN(game.seed, Math.round(patch * 1e4), index, 0x0ce1);

    const n = Math.max(1, Math.round(type.organelles * (0.6 + hashF(seed, 1) * 0.7)));
    const organelles = [];
    for (let i = 0; i < n; i++) {
      const h = hashN(seed, i, 7);
      /* Address the organelle the same way the field addresses a node, so the
       * essence distribution here is drawn from the same well. */
      const ess = RS.fractal.essenceAt(game.seed, index * 977 + i, Math.round(patch * 1e3));
      const a = hashF(h, 1) * TAU;
      /* Packed toward the rim, because the middle is where the nucleus goes
       * and because a ring reads as "inside something" — but stopping well
       * short of the membrane, so an organelle has room to be drawn at a size
       * you can actually read. */
      const r = 0.18 + Math.sqrt(hashF(h, 2)) * 0.52;
      organelles.push({
        essence: ess,
        /* The `cell` geometry's form name for this essence — the content that
         * was unreachable while every small rung rendered as a planet. */
        form: (ess.forms && ess.forms.cell) || ess.name,
        x: Math.cos(a) * r, y: Math.sin(a) * r,
        size: 0.06 + hashF(h, 3) * 0.10,
        /* Organelles drift on their own slow cycle. Cytoplasm streams. */
        drift: (hashF(h, 4) * 2 - 1) * 0.22,
        phase: hashF(h, 5) * TAU,
        hue: type.hue + (hashF(h, 6) * 44 - 22)
      });
    }

    /* Environment. Real numbers where real numbers exist: cytoplasm sits near
     * the host's surface temperature for an ectotherm, and viscosity rises
     * with organelle packing. */
    const T = planet.surfaceTemp;
    return {
      type, patch, index, seed,
      organelles,
      /* Effective viscosity relative to water. Cytoplasm is famously
       * non-Newtonian and crowded; a fuller cell is a thicker one. */
      viscosity: 2.0 + n * 0.45,
      temperature: T,
      /* Reynolds number for something a few microns across moving at a few
       * body-lengths a second. It is ~1e-4, and that is the whole reason a
       * swimmer's stroke is useless in here: reverse the stroke and you go
       * back exactly where you came from. Purcell's scallop theorem, and it is
       * why this scope needs its own body. */
      reynolds: 1e-4,
      hostName: planet.name,
      complexity: c
    };
  }

  /* Which patch of the world we are inside a cell of. Derived from where the
   * planet scene was last standing, so descending Σ from a surface puts you
   * inside something that lives *there* — the continuity is the point. */
  function patchOf(scene) {
    return (scene.lat || 0) * 0.5 + (scene.lon || 0) * 0.125;
  }

  function enter(game, bus) {
    const s = game.scene;
    if (!s.planet) return null;
    if (reasonSterile(s.planet)) { s.cell = null; return null; }
    s.cellIndex = s.cellIndex || 0;
    s.cell = cellAt(game, s.planet, patchOf(s), s.cellIndex);
    bus.emit('cell:enter', { cell: s.cell, planet: s.planet });
    return s.cell;
  }

  /* Move to a neighbouring cell. Tissue is a lattice of them, so this is how
   * you look around at this scale — and each one is a different draw from the
   * essence pool, which is the reason to bother. */
  function nextCell(game, bus, dir) {
    const s = game.scene;
    if (!s.planet) return null;
    s.cellIndex = Math.max(0, (s.cellIndex || 0) + (dir || 1));
    s.cell = cellAt(game, s.planet, patchOf(s), s.cellIndex);
    bus.emit('cell:enter', { cell: s.cell, planet: s.planet });
    return s.cell;
  }

  function tick(game, bus, dt) {
    const s = game.scene;
    if (!s.planet) return;
    if (!s.cell) { enter(game, bus); return; }
    /* Cytoplasmic streaming. The cell is not still and should never look it —
     * a static interior reads as a diagram rather than as a living thing. */
    s.cellT = (s.cellT || 0) + dt * 0.6;
    tickPlace(game, dt);
  }

  /* Live pose of an organelle, matching the renderer so collision and drawing
   * agree. */
  function organellePose(o, ct) {
    const a = Math.atan2(o.y, o.x) + ct * o.drift;
    const r = Math.hypot(o.x, o.y) * (1 + Math.sin(ct * 0.8 + o.phase) * 0.05);
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }

  /* Bind the vessel into cell space: membrane wall, organelle obstacles and
   * attractors from the same essence axes used everywhere else. */
  function tickPlace(game, dt) {
    if (!game.inhabiting || !game.body) return;
    const s = game.scene;
    const cell = s.cell;
    if (!cell) return;
    const body = game.body;
    RS.vessel.confine(body, 0.92);
    const ct = s.cellT || 0;
    for (let i = 0; i < cell.organelles.length; i++) {
      const o = cell.organelles[i];
      const pose = organellePose(o, ct);
      const dx = body.x - pose.x, dy = body.y - pose.y;
      const d = Math.hypot(dx, dy) + 1e-4;
      const ess = o.essence || {};
      if (ess.id === 'attractor' || ess.persistence > 0.85) {
        body.vx -= dx / d * 0.18 * dt;
        body.vy -= dy / d * 0.18 * dt;
      } else if (d < o.size * 1.15) {
        const n = (o.size * 1.15 - d) / (o.size * 1.15);
        body.vx += dx / d * n * 2.4;
        body.vy += dy / d * n * 2.4;
      }
    }
  }

  /* ── The only-here consequence ────────────────────────────────────────────
   *
   * Crystallising inside a cell does not just pay insight; it nudges what that
   * cell expresses, and the host biosphere carries the change. This is the one
   * place you can act on a world from inside it, and unlike a structure it
   * costs nothing to place — it costs the attention you already spent.
   *
   * Deliberately small per crystal and saturating (see influence.js), because
   * a biosphere is a logistic curve and shoving it is not the same as
   * replacing it. Twenty minutes in a cell is a visible change from orbit; it
   * is not a new kingdom of life.
   */
  function expressFrom(game, bus, man) {
    const s = game.scene;
    if (s.kind !== 'cellular' || !s.planet || !s.cell) return null;
    /* An essence you understand pushes harder, because you know what you are
     * pushing. The gnosis ledger is the multiplier everywhere else too. */
    const gn = RS.fractal.gnosisOf(game, man.essence.id);
    const amount = 0.5 + man.potency * 0.5 + gn * 0.15;
    return RS.influence.express(game, bus, s.planet, amount);
  }

  function readout(game) {
    const s = game.scene;
    if (!s.planet) return { title: 'Cytoplasm', sub: 'no world selected' };
    const why = reasonSterile(s.planet);
    if (why) return { title: 'Cytoplasm', sub: why, sterile: true };
    const c = s.cell;
    if (!c) return { title: 'Cytoplasm', sub: 'resolving…' };
    return {
      title: c.type.name,
      sub: c.type.blurb,
      host: s.planet.name,
      organelles: c.organelles.length,
      expression: RS.influence.expressionOn(game, s.planet)
    };
  }

  RS.cellular = {
    TYPES, typeFor, reasonSterile, cellAt, patchOf,
    enter, nextCell, tick, tickPlace, organellePose, expressFrom, readout
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
