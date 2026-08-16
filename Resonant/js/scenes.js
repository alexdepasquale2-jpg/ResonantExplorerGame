/* Resonant — the scene stack: field → system → planet surface.
 *
 * ── The modal split, and why it is the best idea in this file ──────────────
 *
 * The four dials now have to serve two jobs: navigating the scale ladder and
 * piloting a body. Rather than adding a second control surface, the game
 * splits them by *mode*, and the split is thematically exact:
 *
 *   OBSERVING (no body)   τ scrubs time.  Σ moves the scale ladder.
 *   INHABITING (a body)   τ is throttle.  Σ is your vertical axis.
 *
 * So a point of consciousness can move through a world's *time* or through its
 * *space*, but never both at once. Detached, you watch four billion years of a
 * biosphere in twenty seconds; embodied, you are stuck in the present like
 * everything else that has a body. That is a real constraint with real
 * consequences — you scout a system by scrubbing its history, then commit to a
 * moment and go there — and it costs no extra buttons.
 *
 * ── Cost ──────────────────────────────────────────────────────────────────
 *
 * A scene holds no world data. It holds an *address*, a time, and a camera.
 * Entering a system is deriving it; leaving is dropping the reference. There
 * is nothing to load, stream, or unload, so transitions are a single frame at
 * any depth. The only per-frame work is O(visible bodies) closed-form
 * evaluation plus one integrated player body plus a handful of minds.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, damp, TAU, hashF, hashN } = RS.core;

  const TIER_PLANET = RS.cosmos.BY_ID.planetary.index;      // 8
  const TIER_STELLAR = RS.cosmos.BY_ID.stellar.index;       // 9
  const TIER_SYSTEM = RS.cosmos.BY_ID.system.index;         // 10
  const TIER_CLUSTER = RS.cosmos.BY_ID.cluster.index;       // 12

  const TIER_CELL = RS.cosmos.BY_ID.cellular.index;          // 5

  /* ── The scene registry ───────────────────────────────────────────────────
   *
   * Which scene a given rung of the ladder shows. The ladder *is* the
   * navigation, so there is no separate "travel" mode to learn, and each scene
   * lines up with what you would actually perceive at that scale.
   *
   * A table rather than a cascade of ifs, because the ladder has twenty-two
   * rungs and only five of them currently show something of their own — every
   * remaining scope is a row here plus a file, and adding one must not mean
   * editing a chain of comparisons in three modules. `first` and `last` are
   * inclusive rung indices; **more specific entries come first**, because the
   * first match wins and a scope like Cellular sits inside the range the
   * surface scene would otherwise claim.
   */
  const TIER_QUANTUM = RS.cosmos.BY_ID.quantum.index;        // 1
  const TIER_GROUP = RS.cosmos.BY_ID.group.index;            // 14
  const TIER_HUBBLE = RS.cosmos.BY_ID.hubble.index;          // 17
  const TIER_ENSEMBLE = RS.cosmos.BY_ID.inflationary.index;  // 18
  const TIER_ATOMIC = RS.cosmos.BY_ID.atomic.index;          // 3
  const TIER_MOLECULAR = RS.cosmos.BY_ID.molecular.index;    // 4

  const SCENES = [
    {
      id: 'foam', name: 'Quantum Foam', first: 0, last: TIER_QUANTUM,
      blurb: 'Below the scale at which anything persists. No body works here.'
    },
    {
      id: 'shells', name: 'Orbital Shells', first: TIER_QUANTUM + 1, last: TIER_ATOMIC,
      blurb: 'Where no two occupants may share a state. That is why matter takes up space.'
    },
    {
      id: 'molecular', name: 'Molecular', first: TIER_MOLECULAR, last: TIER_MOLECULAR,
      blurb: 'Chains and handedness. A living world settles which hand it uses and never revisits it.'
    },
    {
      id: 'cellular', name: 'Cytoplasm', first: TIER_CELL, last: TIER_CELL,
      blurb: 'Inside one cell of a living world. The machinery, at its own scale.'
    },
    {
      id: 'web', name: 'Cosmic Web', first: TIER_GROUP, last: TIER_HUBBLE,
      blurb: 'Filaments and voids, assembling over thirteen billion years.'
    },
    {
      id: 'ensemble', name: 'Ensemble', first: TIER_ENSEMBLE, last: RS.cosmos.TIERS.length - 1,
      blurb: 'Alternative blocks of physical law. Stand in one and the constants change.'
    },
    {
      id: 'planet', name: 'Surface', first: 0, last: TIER_PLANET,
      blurb: 'A surface you can stand on.'
    },
    {
      id: 'system', name: 'System', first: TIER_PLANET + 1, last: TIER_SYSTEM,
      blurb: 'One gravity well and everything bound to it.'
    },
    {
      id: 'galaxy', name: 'Star Map', first: TIER_SYSTEM + 1, last: TIER_CLUSTER,
      blurb: 'Neighbouring stars — the scale at which you choose.'
    },
    {
      id: 'field', name: 'Attunement Field', first: TIER_CLUSTER + 1,
      last: RS.cosmos.TIERS.length - 1,
      blurb: 'Where layers are tuned and manifestations are held.'
    }
  ];

  const SCENE_BY_ID = Object.create(null);
  for (const sc of SCENES) SCENE_BY_ID[sc.id] = sc;

  function sceneForTier(idx) {
    for (let i = 0; i < SCENES.length; i++) {
      if (idx >= SCENES[i].first && idx <= SCENES[i].last) return SCENES[i].id;
    }
    return 'field';
  }

  /* The rung a scene is actually entered at, so a pathway can say "turn Σ to
   * here" and mean something precise. Not simply `first`: a broad scope's range
   * can have a narrower one carved out of its start, so this asks the same
   * question the game asks — the first rung that really resolves to this id. */
  function tierForScene(id) {
    const sc = SCENE_BY_ID[id];
    if (!sc) return RS.cosmos.ROOT_INDEX;
    for (let i = sc.first; i <= sc.last; i++) if (sceneForTier(i) === id) return i;
    return sc.first;
  }

  function newScene() {
    return {
      kind: 'field',
      /* Where in the cosmos we are pointed. Addresses, not objects. */
      systemAddr: null,
      system: null,
      /* Cellular scope. `cell` is derived on arrival and never persisted — only
       * the index is, because the cell is a pure function of it. */
      cell: null,
      cellIndex: 0,
      cellT: 0,
      /* Cosmic web. `webT` is an offset from the present in Gyr — the only
       * place in the game where τ is measured against the age of the
       * universe. */
      web: null,
      webT: 0,
      /* Quantum foam. */
      foam: null,
      foamT: 0,
      /* Local time at the current lon/lat — day, season, tide. */
      clock: null,
      transitionDir: 0,
      /* Inhabitants — derived per frame, never persisted. */
      inhabitants: null,
      localT: 0,
      /* Molecular and orbital shells. */
      molecule: null, molIndex: 0, molT: 0,
      shells: null, shellT: 0,
      /* Ensemble. `blockNode` is the alternative physics currently adopted;
       * `specimen` is one address derived under both blocks side by side. */
      ensemble: null,
      ensembleT: 0,
      blockNode: null,
      specimen: null,
      bodyIndex: -1,
      planet: null,
      /* In-world time offset, in years, from the system's present. Driven by
       * the τ dial while observing. */
      t: 0,
      tGyr: 0,
      /* Planet-scene state. */
      lon: 0, lat: 0,
      altitude: 0,
      surface: null,
      /* Dual cameras while inhabiting: 'sideon' | 'freeroam' | 'globe', or
       * null to follow the altitude rule. Observing always uses the globe. */
      forceCam: null,
      /* Agents: derived creatures with live minds. Small, pooled, transient. */
      agents: [],
      agentAcc: 0,
      /* Selection and camera. */
      selected: -1,
      zoom: new RS.core.Spring(1, 60, 15),
      camX: new RS.core.Spring(0, 70, 16),
      camY: new RS.core.Spring(0, 70, 16),
      /* Cross-fade when the scene changes. */
      transition: 0,
      lastKind: 'field',
      /* Cached market data, recomputed only when the selection or time moves
       * meaningfully — prices are cheap but not free, and nothing reads them
       * more than a few times a second. */
      trade: null, tradeAt: -1
    };
  }

  /* Pick a system from the galactic locus. Derived from the address the player
   * reached by tuning, so which system you get is a consequence of where you
   * tuned rather than a menu choice. */
  function systemAddrFrom(game) {
    const D = game.dials;
    /* The galactic sector is addressed by the phase and frequency dials — the
     * two axes that are not being used for scale — so the whole galaxy is
     * reachable by tuning, and returning to a system means returning to a
     * tuning. */
    const sx = Math.round(Math.cos(D.phase.value) * 24 + D.frequency.value * 0.07);
    const sy = Math.round(Math.sin(D.phase.value) * 24 + game.field.streams.__sector || 0);
    return { sx, sy, index: Math.abs(Math.round(D.frequency.value)) % 5 };
  }

  function enterSystem(game, bus, addr) {
    const s = game.scene;
    s.systemAddr = addr;
    s.system = RS.stellar.systemAt(game.seed, addr.sx, addr.sy, addr.index);
    s.bodyIndex = -1;
    s.planet = null;
    s.selected = -1;
    s.trade = null; s.tradeAt = -1;
    if (!game.known.systems[systemKey(addr)]) {
      game.known.systems[systemKey(addr)] = true;
      bus.emit('discover:system', { system: s.system });
    }
    return s.system;
  }

  function systemKey(a) { return a.sx + ',' + a.sy + ',' + a.index; }

  /* Derive the currently-selected planet, with the player's structures applied
   * on top. Re-derived rather than cached because deriving is cheap and a
   * cached planet would go stale the moment a structure matured. */
  function derivePlanet(game, system, bodyIndex) {
    const p = RS.planet.planetAt(system, bodyIndex);
    if (!p) return null;
    RS.influence.applyTo(game, p);
    return p;
  }

  function selectBody(game, bus, index) {
    const s = game.scene;
    if (!s.system) return null;
    s.selected = index;
    const body = s.system.bodies[index];
    if (!body || body.kind !== 'planet') { s.planet = null; s.bodyIndex = -1; return null; }
    s.bodyIndex = index;
    s.planet = derivePlanet(game, s.system, index);
    s.trade = null; s.tradeAt = -1;
    if (s.planet && !game.known.planets[RS.influence.planetKey(s.planet)]) {
      game.known.planets[RS.influence.planetKey(s.planet)] = true;
      bus.emit('discover:planet', { planet: s.planet });
    }
    return s.planet;
  }

  // ── the tick ─────────────────────────────────────────────────────────────

  function tick(game, bus, dt) {
    const s = game.scene;
    const D = game.dials;
    const tierIdx = clamp(Math.round(D.space.value), 0, RS.cosmos.TIERS.length - 1);

    /* While inhabiting, Σ is the vessel's vertical axis, so the scene must not
     * follow it up and down the ladder — the player stays where they are. */
    const wantKind = game.inhabiting ? s.kind : sceneForTier(tierIdx);

    if (wantKind !== s.kind) {
      changeScene(game, bus, wantKind);
    }
    s.transition = damp(s.transition, 0, 2.6, dt);

    /* Time. Observing: τ scrubs, and the scale is enormous because the whole
     * point is watching history. Inhabiting: time runs at one second per
     * second like it does for everything with a body. */
    if (game.inhabiting) {
      s.t += dt / 3.156e7 * 1;   // seconds → years, real time
    } else {
      /* Years per real second, driven by τ. Exponential in the dial so the
       * same control covers watching a moon orbit and watching a star die. */
      const rate = Math.sign(D.time.value) * Math.pow(Math.abs(D.time.value), 2.4) * 0.9;
      s.t += rate * dt;
    }
    s.tGyr = s.t * 1e-9;

    /* Local time. Closed-form in (planet, lon, lat, epoch), so scrubbing τ
     * across a thousand years costs exactly what standing still costs — and it
     * gives τ a second meaning on a surface without a second control. */
    if (s.planet) s.clock = RS.localtime.stateFor(game, s.clock);

    if (s.kind === 'system') tickSystem(game, bus, dt);
    else if (s.kind === 'planet') tickPlanet(game, bus, dt);
    else if (s.kind === 'galaxy') RS.galaxy.tick(game, bus, dt);
    else if (s.kind === 'cellular') RS.cellular.tick(game, bus, dt);
    else if (s.kind === 'web') RS.web.tick(game, bus, dt);
    else if (s.kind === 'foam') RS.foam.tick(game, bus, dt);
    else if (s.kind === 'ensemble') RS.ensemble.tick(game, bus, dt);
    else if (s.kind === 'molecular') RS.molecular.tick(game, bus, dt);
    else if (s.kind === 'shells') RS.shells.tick(game, bus, dt);

    /* Relays keep channels open from other systems. Runs after the local
     * scene has had a chance to claim `s.contact`, and is a no-op unless
     * a probe or beacon is actually stationed somewhere. */
    RS.contact.tickRelays(game, bus, dt);

    /* Inhabitants, in every scope. Derived rather than spawned, so they were
     * already doing this before you arrived and will be doing it when you come
     * back — and cost nothing at all while you are elsewhere. */
    s.inhabitants = RS.inhabitants.inhabitantsFor(game, s.kind, s.t * 1e-4 + s.localT, dt, s.inhabitants);
    s.localT = (s.localT || 0) + dt;

    /* The body is integrated in every scene — even the attunement field, where
     * a mote drifts. */
    if (game.inhabiting) tickBody(game, bus, dt);
    /* Confine after integration so a long frame cannot punch through a wall. */
    if (game.inhabiting && game.body) {
      if (s.kind === 'cellular' || s.kind === 'web' || s.kind === 'molecular' || s.kind === 'shells') {
        RS.vessel.confine(game.body, 0.95);
      }
    }

    s.zoom.step(dt); s.camX.step(dt); s.camY.step(dt);
  }

  function changeScene(game, bus, kind) {
    const s = game.scene;
    s.lastKind = s.kind;
    s.kind = kind;
    s.transition = 1;
    /* Which way you went. The ladder is the navigation, so a scope change is a
     * *movement* — inward toward the small or outward toward the vast — and a
     * cut that does not say which makes the whole thing feel like a menu.
     * Derived from the rungs the two scopes occupy, so it is right for every
     * pair without anybody enumerating them. */
    s.transitionDir = Math.sign(tierForScene(kind) - tierForScene(s.lastKind)) || 0;

    /* Leaving the Ensemble always restores our own block. An alternative
     * universe you had forgotten you were standing in would silently re-derive
     * every star in the game and read as a bug rather than as a mechanic — so
     * the swap is scoped to the one place that owns it, unconditionally, on
     * the way out. */
    if (s.lastKind === 'ensemble' && kind !== 'ensemble' && RS.ensemble) {
      RS.ensemble.release(game, bus);
    }

    if (kind === 'galaxy') {
      /* The map centres on wherever the player currently is, so zooming out
       * from a system always shows that system's own neighbourhood. */
      if (s.systemAddr) {
        game.galaxy.sx = s.systemAddr.sx;
        game.galaxy.sy = s.systemAddr.sy;
      }
      game.galaxy.driftX = 0;
      game.galaxy.driftY = 0;
      game.galaxy.cacheKey = '';
      RS.galaxy.refresh(game);
    } else if (kind === 'system') {
      /* Entering the system layer with no system chosen derives one from where
       * the player has tuned — there is always somewhere to arrive. Once the
       * galactic map exists, a chosen target takes priority: picking a star and
       * turning Σ inward is the normal way to travel. */
      const tgt = game.galaxy && game.galaxy.target;
      if (tgt && (!s.systemAddr || s.systemAddr.sx !== tgt.sx ||
          s.systemAddr.sy !== tgt.sy || s.systemAddr.index !== tgt.index)) {
        enterSystem(game, bus, { sx: tgt.sx, sy: tgt.sy, index: tgt.index });
        game.galaxy.sx = tgt.sx; game.galaxy.sy = tgt.sy;
        game.galaxy.cacheKey = '';
      }
      if (!s.system) enterSystem(game, bus, systemAddrFrom(game));
      /* Default the selection to the most interesting world present, which is
       * almost always what the player wants to look at first. */
      if (s.selected < 0) selectBody(game, bus, mostInteresting(game, s.system));
    } else if (kind === 'planet') {
      if (!s.system) enterSystem(game, bus, systemAddrFrom(game));
      if (!s.planet) selectBody(game, bus, mostInteresting(game, s.system));
      s.agents.length = 0;
      s.lon = 0; s.lat = 0;
      sampleSurface(game);
    } else if (kind === 'cellular') {
      /* You are always inside a cell *of somewhere*. Arriving without a world
       * chosen picks the same one the surface scene would have — descending Σ
       * from a surface should put you inside something that lives there rather
       * than somewhere unrelated. */
      if (!s.system) enterSystem(game, bus, systemAddrFrom(game));
      if (!s.planet) selectBody(game, bus, mostInteresting(game, s.system));
      s.agents.length = 0;
      RS.cellular.enter(game, bus);
    } else if (kind === 'web') {
      s.agents.length = 0;
      RS.web.enter(game, bus);
    } else if (kind === 'foam') {
      s.agents.length = 0;
      RS.foam.enter(game, bus);
    } else if (kind === 'ensemble') {
      s.agents.length = 0;
      RS.ensemble.enter(game, bus);
    } else if (kind === 'molecular') {
      /* Molecules belong to a world, so the same rule as the cell: arriving
       * without one chosen picks the one the surface scene would have. */
      if (!s.system) enterSystem(game, bus, systemAddrFrom(game));
      if (!s.planet) selectBody(game, bus, mostInteresting(game, s.system));
      s.agents.length = 0;
      s.molecule = null;
      RS.molecular.enter(game, bus);
    } else if (kind === 'shells') {
      /* Shells belong to nothing in particular — an atom is an atom anywhere,
       * which is itself the point of the rung. */
      s.agents.length = 0;
      RS.shells.enter(game, bus);
    }
    bus.emit('scene:change', { kind, from: s.lastKind, scene: s });
  }

  /* Rank worlds by how much there is to find. Life beats habitability beats
   * resources beats size — which is the order a player cares about them in. */
  function mostInteresting(game, system) {
    let best = -1, score = -1;
    for (let i = 0; i < system.bodies.length; i++) {
      const b = system.bodies[i];
      if (b.kind !== 'planet') continue;
      const p = RS.planet.planetAt(system, i);
      if (!p) continue;
      let sc = p.habitability * 4 + (p.biosphere ? p.biosphere.complexity * 6 : 0) +
        (p.type.landable ? 1 : 0) + Math.log10(1 + p.massE) * 0.2;
      if (sc > score) { score = sc; best = i; }
    }
    return best >= 0 ? best : 0;
  }

  // ── system scene ─────────────────────────────────────────────────────────

  const posBuf = { x: 0, y: 0, z: 0, r: 0 };

  /* Positions of everything in the system at the current time. Written into a
   * reusable array so a 400-body system allocates nothing per frame. */
  function systemPositions(game, out) {
    const s = game.scene;
    const arr = out || (s.__pos || (s.__pos = []));
    arr.length = 0;
    if (!s.system) return arr;
    const t = s.t;
    for (let i = 0; i < s.system.bodies.length; i++) {
      const b = s.system.bodies[i];
      RS.orbital.positionAt(b.elements, t, posBuf);
      arr.push({ index: i, body: b, x: posBuf.x, y: posBuf.y, z: posBuf.z, r: posBuf.r });
    }
    return arr;
  }

  function tickSystem(game, bus, dt) {
    const s = game.scene;
    if (!s.system) return;

    /* Trade is recomputed at most a few times a second, and only for the
     * planets actually present. Prices depend on time only through the
     * civilisations, which change on geological scales — so this is nowhere
     * near a per-frame concern. */
    if (s.tradeAt < 0 || Math.abs(s.t - s.tradeAt) > 2000 || !s.trade) {
      const planets = [];
      for (let i = 0; i < s.system.bodies.length; i++) {
        if (s.system.bodies[i].kind !== 'planet') continue;
        const p = derivePlanet(game, s.system, i);
        if (p) planets.push(p);
      }
      s.trade = RS.civ.systemTrade(planets, s.tGyr, 8);
      s.tradeAt = s.t;
    }

    /* Keep the selected planet's derived state fresh — structures mature and
     * the time dial moves civilisations — but not every frame. Deriving a
     * planet runs the whole physics chain plus a moon system; at 60 Hz that is
     * pure waste, because none of its inputs can change meaningfully inside
     * 250 ms. Four times a second is indistinguishable and costs a fortieth as
     * much. */
    if (s.bodyIndex >= 0) {
      s.deriveAcc = (s.deriveAcc || 0) + dt;
      if (!s.planet || s.deriveAcc > 0.25) {
        s.deriveAcc = 0;
        s.planet = derivePlanet(game, s.system, s.bodyIndex);
        if (s.planet) s.planet.civ = civAt(game, s.planet, s.tGyr);
      }
    }

    /* Anyone in this system slowly becomes aware of you while you are in it.
     * Awareness is what makes a carrier lock answerable, so simply being
     * present is the first half of making contact. */
    tickContact(game, bus, dt);
    tickSystemPlace(game, dt);
  }

  /* Courier Σ → log-space orbital radius. Heading and τ walk the plane.
   * Hohmann delta-v is charged when the radius changes, so transferring is
   * not free even though the orbit itself stays analytic. */
  function tickSystemPlace(game, dt) {
    const s = game.scene;
    if (!game.inhabiting || !s.system) return;
    const ctl = RS.vessel.controlsFrom(game);
    const inner = Math.max(0.02, s.system.discInner || 0.05);
    const outer = Math.max(inner * 1.2, s.system.discOuter || inner * 20);
    const u = clamp01(ctl.vert);
    const radius = inner * Math.pow(outer / inner, u);
    s.orbitAngle = (s.orbitAngle || 0) + ctl.rate * dt * 0.55;
    /* Δ as transfer angle: a held heading precesses the true anomaly. */
    s.orbitAngle += Math.sin(ctl.heading) * dt * 0.12;
    const body = game.body;
    if (s.__lastRadius != null && Math.abs(radius - s.__lastRadius) > 0.001) {
      const dv = RS.orbital.hohmannDeltaV(s.__lastRadius, radius, s.system.primary.mass);
      if (dv > 0) body.charge -= Math.min(6, dv * 0.03) * dt;
    }
    s.radius = radius;
    s.__lastRadius = radius;
    const rr = 0.13 + 0.84 * u;
    body.x = Math.cos(s.orbitAngle) * rr;
    body.y = Math.sin(s.orbitAngle) * rr * 0.62;
  }

  /* A civilisation with the player's influence applied — uplift, standing,
   * awareness. Same pattern as derivePlanet: derive, then layer deltas. */
  function civAt(game, planet, tGyr) {
    const civ = RS.civ.civOf(planet, tGyr);
    return civ ? RS.contact.applyTo(game, planet, civ) : null;
  }

  /* Contact bookkeeping, run in both the system and planet scenes. Emits the
   * one-shot events that make first contact an occasion rather than a state
   * change nobody noticed. */
  function tickContact(game, bus, dt) {
    const s = game.scene;
    const p = s.planet;
    if (!p) return;
    const civ = p.civ || civAt(game, p, s.tGyr);
    if (!civ) { s.contact = null; return; }

    RS.contact.accrueAwareness(game, p, civ, dt);
    const lock = RS.contact.lockOf(game, p, civ);
    const state = RS.contact.stateOf(game, p, civ, lock);
    const prev = s.contact && s.contact.state;

    s.contact = { civ, lock, state, planet: p };

    if (prev !== state) {
      if (state === RS.contact.STATES.detected && prev !== RS.contact.STATES.open) {
        bus.emit('contact:detected', { planet: p, civ });
      }
      if ((state === RS.contact.STATES.open || state === RS.contact.STATES.warm) &&
          prev !== RS.contact.STATES.open && prev !== RS.contact.STATES.warm) {
        const rec = RS.contact.recordOf(game, p);
        const first = !rec.met;
        rec.met = true;
        rec.name = civ.name;
        rec.where = p.name;
        bus.emit('contact:open', { planet: p, civ, first, lock });
      }
    }
  }

  // ── planet scene ─────────────────────────────────────────────────────────

  /* Where on the planet the player is standing, and what it is like there. */
  function sampleSurface(game) {
    const s = game.scene;
    if (!s.planet) return null;
    const r = RS.planet.biomeAt(s.planet, s.lon, s.lat, s.t);
    const elev = RS.planet.elevationDetailAt(s.planet, s.lon, s.lat);
    const water = RS.localtime.waterlineAt(s.planet, s.lon, s.t);
    s.surface = {
      lon: s.lon, lat: s.lat,
      elev, T: r.T, M: r.M, biome: r.biome,
      sea: water,
      planetaryElev: r.elev,
      resource: RS.planet.resourceAt(s.planet, s.lon, s.lat)
    };
    return s.surface;
  }

  /* The terrain profile under the player: a side-on slice sampled from the
   * elevation field along the current latitude. There is no mesh — this is
   * evaluated fresh every frame for exactly the span on screen, which is why
   * a planet has no loading time and no level of detail to manage.
   *
   * Returns `{ elev, biome, moist, n }` rather than a bare Float32Array so the
   * side-on fill can be multi-biome without a second 96-sample pass. */
  const PROFILE_N = 96;
  function profileBuf(s, key) {
    return s[key] || (s[key] = {
      elev: new Float32Array(PROFILE_N),
      moist: new Float32Array(PROFILE_N),
      biome: new Array(PROFILE_N),
      n: PROFILE_N
    });
  }
  function terrainProfile(game, halfSpan, out) {
    const s = game.scene;
    const buf = out || profileBuf(s, '__profile');
    buf.n = PROFILE_N;
    if (!s.planet) return buf;
    const epoch = s.t || 0;
    for (let i = 0; i < PROFILE_N; i++) {
      const u = i / (PROFILE_N - 1);
      const lon = s.lon + (u - 0.5) * halfSpan * 2;
      buf.elev[i] = RS.planet.elevationDetailAt(s.planet, lon, s.lat);
      const r = RS.planet.biomeAt(s.planet, lon, s.lat, epoch);
      buf.biome[i] = r.biome;
      buf.moist[i] = r.M;
    }
    return buf;
  }

  /* Player-centred neighbourhood for the freeroam camera. Fixed 48×32 grid,
   * never a mesh, never stored. */
  const FREE_W = 48, FREE_H = 32;
  function neighbourhood(game, spanLon, out) {
    const s = game.scene;
    const buf = out || profileBuf(s, '__hood');
    /* Reuse the profile buffer shape but with a 2d colour table on the scene. */
    const n = FREE_W * FREE_H;
    if (!s.__hoodCss || s.__hoodCss.length !== n) s.__hoodCss = new Array(n);
    if (!s.__hoodElev || s.__hoodElev.length !== n) s.__hoodElev = new Float32Array(n);
    if (!s.planet) return { w: FREE_W, h: FREE_H, css: s.__hoodCss, elev: s.__hoodElev, spanLon: spanLon };
    const spanLat = spanLon * (FREE_H / FREE_W);
    const epoch = s.t || 0;
    for (let iy = 0; iy < FREE_H; iy++) {
      const lat = RS.planet.clampLat(s.lat - (iy / (FREE_H - 1) - 0.5) * spanLat * 2);
      for (let ix = 0; ix < FREE_W; ix++) {
        const lon = s.lon + (ix / (FREE_W - 1) - 0.5) * spanLon * 2;
        const i = iy * FREE_W + ix;
        const r = RS.planet.biomeAt(s.planet, lon, lat, epoch);
        s.__hoodCss[i] = r.biome;
        s.__hoodElev[i] = RS.planet.elevationDetailAt(s.planet, lon, lat);
      }
    }
    return { w: FREE_W, h: FREE_H, css: s.__hoodCss, elev: s.__hoodElev, spanLon, spanLat };
  }

  /* Dual-camera rule while inhabiting a planet:
   *   observing            → globe
   *   altitude / toggle    → freeroam neighbourhood
   *   near the ground      → rich side-on slice
   * Pose (lon, lat, altitude) is shared; switching never teleports. */
  function cameraMode(game) {
    const s = game.scene;
    if (!s || s.kind !== 'planet') return 'globe';
    if (s.forceCam === 'freeroam' || s.forceCam === 'sideon' || s.forceCam === 'globe') {
      return s.forceCam;
    }
    if (!game.inhabiting) return 'globe';
    if (s.altitude > 0.22) return 'freeroam';
    return 'sideon';
  }

  /* Player-facing cycle: AUTO → SIDE-ON → MAP → AUTO.
   * Globe stays an observing / debug mode, not a walk cycle. */
  function cycleCamera(game) {
    const s = game.scene;
    if (!s || s.kind !== 'planet' || !game.inhabiting) {
      return { ok: false, reason: 'not piloting a planet' };
    }
    if (s.forceCam == null) s.forceCam = 'sideon';
    else if (s.forceCam === 'sideon') s.forceCam = 'freeroam';
    else s.forceCam = null;
    return { ok: true, forceCam: s.forceCam, mode: cameraMode(game) };
  }

  function cameraLabel(game) {
    const s = game.scene;
    if (!s || s.kind !== 'planet' || !game.inhabiting) {
      return game.inhabiting ? 'PILOTING' : 'OBSERVING';
    }
    if (s.forceCam === 'freeroam') return 'MAP';
    if (s.forceCam === 'sideon') return 'SIDE-ON';
    if (s.forceCam === 'globe') return 'GLOBE';
    return 'AUTO';
  }

  function tickPlanet(game, bus, dt) {
    const s = game.scene;
    if (!s.planet) return;

    /* Same throttle as the system view, for the same reason. */
    s.deriveAcc = (s.deriveAcc || 0) + dt;
    if (s.deriveAcc > 0.25 && s.bodyIndex >= 0) {
      s.deriveAcc = 0;
      const fresh = derivePlanet(game, s.system, s.bodyIndex);
      if (fresh) { fresh.civ = civAt(game, fresh, s.tGyr); s.planet = fresh; }
    }
    tickContact(game, bus, dt);

    /* Walking moves you on the tangent plane. Heading × speed → (dlon, dlat)
     * using the planet's real radius, so a big world takes longer to cross
     * and the poles pinch longitude the way a sphere must. */
    if (game.inhabiting) {
      const body = game.body;
      const R = s.planet.radiusE * 6371;
      const clat = Math.max(0.12, Math.cos(s.lat));
      /* Same conversion the 1D longitude track used, now applied on two axes. */
      const k = 80 / Math.max(1, R);
      s.lon = RS.planet.wrapLon(s.lon + body.vx * k / clat * dt);
      s.lat = RS.planet.clampLat(s.lat + (body.vz || 0) * k * dt);
      s.altitude = Math.max(0, -body.y);
    }
    sampleSurface(game);

    /* Agents. Kept to a small live population near the player, derived from
     * the biome they are standing in. Each carries a real recurrent mind. */
    const bio = s.planet.biosphere;
    const wantAgents = bio && bio.complexity > 0.5 ? Math.round(3 + bio.complexity * 7) : 0;

    s.agentAcc += dt;
    if (s.agents.length < wantAgents && s.agentAcc > 0.6) {
      s.agentAcc = 0;
      spawnAgent(game, s);
    }
    while (s.agents.length > wantAgents) s.agents.pop();

    for (let i = s.agents.length - 1; i >= 0; i--) {
      stepAgent(game, s, s.agents[i], dt, i);
    }
  }

  function spawnAgent(game, s) {
    const biome = s.surface ? s.surface.biome.id : 'grass';
    const slot = (s.__agentSlot = (s.__agentSlot || 0) + 1);
    const fauna = RS.civ.faunaAt(s.planet, biome, slot);
    if (!fauna) return;
    const mind = RS.neural.mindAt(fauna.hash);
    s.agents.push({
      fauna, mind, state: RS.neural.newState(),
      lon: RS.planet.wrapLon(s.lon + (Math.random() * 2 - 1) * 0.04),
      lat: RS.planet.clampLat(s.lat + (Math.random() * 2 - 1) * 0.02),
      x: 0, y: 0, vx: 0, vy: 0, vz: 0,
      heading: Math.random() * TAU,
      energy: 0.6 + Math.random() * 0.4,
      ridden: false
    });
  }

  const agentIn = new Float32Array(RS.neural.N_IN);

  /* One agent step. The behaviour is not scripted anywhere — it is whatever
   * this particular random recurrent network does when fed these gradients.
   * Foraging, circling, fleeing and loitering all appear on their own. */
  function stepAgent(game, s, a, dt, idx) {
    const p = s.planet;
    const g = p.gravity;

    /* Sensory gradients, all local and all cheap. */
    const dlon = wrapDeltaLon((a.lon != null ? a.lon : s.lon) - s.lon);
    const dlat = (a.lat != null ? a.lat : s.lat) - s.lat;
    a.x = dlon / 0.09;
    const toPlayer = game.inhabiting ? -a.x : 0;
    const distPlayer = Math.hypot(dlon, dlat) / 0.09;
    /* The player reads as a threat or as kin depending on the reality field —
     * a strong field makes you legible to local life rather than alien to it. */
    const rf = game.fields ? game.fields.reality : 0;
    agentIn[0] = a.energy * 2 - 1;
    agentIn[1] = clamp(1 - distPlayer * 2, -1, 1) * (1 - clamp01(rf));
    /* Food gradient from the biome's own productivity field. */
    agentIn[2] = RS.core.noise2(a.fauna.hash, a.x * 3 + s.t * 0.01, 0) * 2 - 1;
    agentIn[3] = clamp(1 - distPlayer * 2, -1, 1) * clamp01(rf);
    agentIn[4] = clamp(p.flux * 0.5 - 1, -1, 1);
    agentIn[5] = 1;

    const out = RS.neural.step(a.mind, a.state, agentIn, dt);
    RS.neural.relax(a.state, dt);

    /* Outputs → motion, scaled by the creature's own physiology. Heavy
     * creatures on heavy worlds are slow, and that comes from the mass and
     * gravity, not from a speed stat. */
    const power = a.fauna.metabolism / (1 + a.fauna.massKg) / (0.5 + g);
    a.heading += out[1] * dt * 1.8;
    const drive = out[0] * power * 0.9;
    a.vx += Math.cos(a.heading) * drive * dt;
    a.vz = (a.vz || 0) + Math.sin(a.heading) * drive * dt;
    if (a.fauna.locomotion === 'flying') a.vy += (out[2] * 0.6 - g * 0.25) * dt;
    else a.vy += g * 0.5 * dt;

    const f = Math.exp(-(1.4 + p.pressure * 0.4) * dt);
    a.vx *= f; a.vy *= f; a.vz *= f;
    const R = p.radiusE * 6371;
    const k = 80 / Math.max(1, R);
    const clat = Math.max(0.12, Math.cos(a.lat != null ? a.lat : s.lat));
    a.lon = RS.planet.wrapLon((a.lon != null ? a.lon : s.lon) + a.vx * k / clat * dt);
    a.lat = RS.planet.clampLat((a.lat != null ? a.lat : s.lat) + a.vz * k * dt);
    a.y += a.vy * dt;
    if (a.y > 0) { a.y = 0; if (a.vy > 0) a.vy = 0; }
    /* Keep the live population near the player rather than wrapping a 1D strip. */
    const ndlon = wrapDeltaLon(a.lon - s.lon);
    const ndlat = a.lat - s.lat;
    if (Math.hypot(ndlon, ndlat) > 0.14) {
      a.lon = RS.planet.wrapLon(s.lon + ndlon * 0.25);
      a.lat = RS.planet.clampLat(s.lat + ndlat * 0.25);
    }
    a.x = wrapDeltaLon(a.lon - s.lon) / 0.09;

    a.energy = clamp01(a.energy + (Math.abs(drive) * -0.05 + 0.02) * dt);
  }

  function wrapDeltaLon(d) {
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }

  // ── the player's body ────────────────────────────────────────────────────

  function tickBody(game, bus, dt) {
    const s = game.scene;
    const body = game.body;
    const env = RS.vessel.environmentFor(game);
    const ctl = RS.vessel.controlsFrom(game);

    if (RS.vessel.archOf(body).neural && body.mind) {
      if (body.ridingCiv && s.planet) {
        /* Riding a culture: the closed-form trajectory is what you lean on,
         * not a creature's hidden units. Same dials, one scale up. */
        const bias = RS.contact.lean(game, s.planet, ctl, dt);
        if (bias) {
          body.possession = clamp01((Math.abs(ctl.rate) * (0.3 + ctl.vert)) * 0.7 + bias.mag * 0.5);
          body.arousal = bias.mag;
        }
        RS.vessel.integrate(game, body, env, { rate: 0, heading: body.heading, vert: ctl.vert, band: ctl.band }, dt);
      } else {
        /* Riding a mind: the mind drives, the player leans. */
        const sense = nearestSense(game, s);
        const r = RS.vessel.stepMind(game, body, env, ctl, dt, sense);
        if (r) {
          body.possession = r.possession;
          body.arousal = r.arousal;
        }
        /* Still integrate drag and gravity so the ridden body obeys the world. */
        RS.vessel.integrate(game, body, env, { rate: 0, heading: body.heading, vert: ctl.vert, band: ctl.band }, dt);
      }
    } else {
      const r = RS.vessel.integrate(game, body, env, ctl, dt);
      if (r.blocked && !body.__warned) {
        body.__warned = true;
        bus.emit('vessel:blocked', { reason: r.blocked, arch: RS.vessel.archOf(body) });
      } else if (!r.blocked) {
        body.__warned = false;
      }
    }

    /* Running out of charge somewhere hostile ejects the player back to the
     * mote. Not a death — a point of consciousness cannot die — but it costs
     * the body and whatever was in its hold. */
    if (body.charge <= 0 && body.strain > 0.85) {
      bus.emit('vessel:lost', { arch: RS.vessel.archOf(body) });
      disembark(game, bus);
    }
  }

  function nearestSense(game, s) {
    let food = 0, threat = 0, kin = 0;
    for (const a of s.agents) {
      const dlon = wrapDeltaLon((a.lon != null ? a.lon : s.lon) - s.lon);
      const dlat = (a.lat != null ? a.lat : s.lat) - s.lat;
      const d = Math.hypot(dlon, dlat) / 0.09;
      if (d > 0.6) continue;
      const w = 1 - d / 0.6;
      if (a.fauna.diet === 'predator') threat = Math.max(threat, w);
      else kin = Math.max(kin, w);
      food = Math.max(food, w * 0.5);
    }
    return { food, threat, kin };
  }

  // ── embark / disembark ───────────────────────────────────────────────────

  function embark(game, bus, archId) {
    const arch = RS.vessel.BY_ID[archId];
    if (!arch) return { ok: false, reason: 'unknown vessel' };
    if (!game.vessels.unlocked[archId]) return { ok: false, reason: 'not researched' };
    /* Some scopes refuse bodies outright rather than refusing a particular
     * one. The Quantum Foam is the only such place: a body is a persistent
     * arrangement of matter and nothing at that scale persists, so there is
     * nothing to arrange. Checked before the per-vessel predicate, because the
     * reason is about the *place* and answering "a walker needs a surface"
     * would be true and beside the point. */
    if (game.scene.kind === 'foam') {
      return { ok: false,
        reason: 'nothing persists at this scale — there is nothing for a body to be made of' };
    }
    const env = RS.vessel.environmentFor(game);
    const blocked = RS.vessel.canOperate(arch, env);
    if (blocked) return { ok: false, reason: blocked };

    game.body = RS.vessel.newBody(archId);
    game.body.charge = arch.capacity * 0.6;
    game.inhabiting = true;

    /* Riding a mind needs a mind to ride. A creature if there is one; a
     * civilisation if you are in their system with no body on the ground —
     * that is the same influence mechanic one scale up, and it is why the
     * symbiont works in orbit. */
    if (arch.neural) {
      const s = game.scene;
      let best = null;
      for (const a of s.agents) {
        if (!best || a.fauna.encephalisation > best.fauna.encephalisation) best = a;
      }
      if (best) {
        RS.vessel.ride(game.body, best.fauna.hash);
        best.ridden = true;
        game.body.riddenFauna = best.fauna;
        game.body.ridingCiv = false;
      } else if (s.planet && (s.planet.civ || RS.civ.civOf(s.planet, s.tGyr))) {
        RS.vessel.ride(game.body, s.planet.hash);
        game.body.ridingCiv = true;
        game.body.riddenCivKey = RS.influence.planetKey(s.planet);
      } else {
        game.inhabiting = false;
        game.body = RS.vessel.newBody('mote');
        return { ok: false, reason: 'no mind here to ride' };
      }
    }
    bus.emit('vessel:embark', { arch, env });
    return { ok: true };
  }

  function disembark(game, bus) {
    const was = RS.vessel.archOf(game.body);
    game.body = RS.vessel.newBody('mote');
    game.inhabiting = false;
    for (const a of game.scene.agents) a.ridden = false;
    bus.emit('vessel:disembark', { arch: was });
  }

  /* Extraction: a harvester takes material out of a world and into its hold.
   * Deliberately requires the right body in the right place — the whole point
   * of having bodies at all. */
  function extract(game, bus) {
    const s = game.scene;
    const arch = RS.vessel.archOf(game.body);
    if (!arch.extracts) return { ok: false, reason: 'this body cannot extract' };
    if (!s.planet) return { ok: false, reason: 'no world here' };
    if (game.body.charge < 8) return { ok: false, reason: 'insufficient charge' };

    /* What comes out depends on where you are standing: the biome and the
     * planet's resource profile together, sampled at this lon/lat. */
    const local = RS.planet.resourceAt(s.planet, s.lon, s.lat);
    let bestId = null, bestV = 0;
    for (const k in local) {
      const v = local[k];
      if (v > bestV) { bestV = v; bestId = k; }
    }
    if (!bestId) return { ok: false, reason: 'nothing here' };
    const amount = bestV * 6 * (1 + (game.fields ? game.fields.reality : 0));
    const took = RS.vessel.addCargo(game.body, bestId, amount);
    game.body.charge -= 8;
    if (took <= 0) return { ok: false, reason: 'hold full' };
    bus.emit('extract', { id: bestId, amount: took, planet: s.planet });
    return { ok: true, id: bestId, amount: took };
  }

  /* Tap-to-read a world. Strike is the clicker in the attunement field; this
   * is the clicker on a planet. Paid for attention on a patch, diminished per
   * world so a seam is not a farm, and stored as two numbers — never a cell
   * map. A harvester stroke rides the same tap. */
  const PULSE_COOLDOWN = 0.28;

  function richnessAt(planet, lon, lat) {
    const local = RS.planet.resourceAt(planet, lon, lat);
    let best = 0;
    for (const k in local) if (local[k] > best) best = local[k];
    return best;
  }

  function pulse(game, bus) {
    const s = game.scene;
    if (!s || s.kind !== 'planet' || !s.planet) return { ok: false, reason: 'no world here' };
    const now = game.stats.playSeconds || 0;
    const key = RS.influence.planetKey(s.planet);
    if (!game.surveys) game.surveys = Object.create(null);
    const rec = game.surveys[key] || (game.surveys[key] = { work: 0, lastAt: -99 });
    if (now - rec.lastAt < PULSE_COOLDOWN) return { ok: false, reason: 'cooling' };

    const rich = richnessAt(s.planet, s.lon, s.lat);
    const first = rec.work === 0;
    const dim = 1 / (1 + rec.work * 0.12);
    const gnosisMul = 1 + RS.fractal.totalGnosis(game) * 0.02;
    let amount = (0.4 + rich * 4.4) * gnosisMul * dim * (game.yieldMul || 1);
    if (first) amount += 2.8 + (s.planet.habitability || 0) * 8;
    if (s.planet.extracting) amount += RS.influence.passiveFrom(game, s.planet) * 1.8 * dim;

    rec.work += 1;
    rec.lastAt = now;
    game.stats.surveys = (game.stats.surveys || 0) + 1;
    game.insight += amount;

    let extracted = null;
    if (game.inhabiting && game.body && RS.vessel.archOf(game.body).extracts) {
      const ex = extract(game, bus);
      if (ex.ok) extracted = ex;
    }

    if (bus && bus.emit) {
      bus.emit('place:pulse', {
        amount, rich, first, planet: s.planet, work: rec.work, extracted
      });
    }
    return { ok: true, amount, rich, first, extracted };
  }

  /* Selling converts cargo to Insight at the local market price — which is why
   * a market's prices matter and why hauling somewhere is worth the delta-v. */
  function sell(game, bus) {
    const s = game.scene;
    if (!s.planet) return { ok: false, reason: 'no market here' };
    const civ = RS.civ.civOf(s.planet, s.tGyr);
    if (!civ) return { ok: false, reason: 'nobody here to trade with' };
    const market = RS.civ.marketOf(s.planet, civ);
    let total = 0;
    const sold = [];
    for (const id in game.body.hold) {
      const entry = market.find(m => m.commodity.id === id);
      if (!entry) continue;
      const amount = game.body.hold[id];
      const value = amount * entry.price * 0.1;
      RS.vessel.removeCargo(game.body, id, amount);
      total += value;
      sold.push({ id, amount, value });
    }
    if (total <= 0) return { ok: false, reason: 'nothing they want' };
    game.insight += total;
    bus.emit('sell', { total, sold, civ });
    return { ok: true, total };
  }

  RS.scenes = {
    TIER_PLANET, TIER_STELLAR, TIER_SYSTEM, TIER_CELL, TIER_QUANTUM, TIER_GROUP, TIER_HUBBLE, TIER_ENSEMBLE, TIER_ATOMIC, TIER_MOLECULAR,
    SCENES, SCENE_BY_ID, sceneForTier, tierForScene, newScene, systemAddrFrom, systemKey, enterSystem, selectBody,
    derivePlanet, mostInteresting, tick, systemPositions, terrainProfile,
    neighbourhood, cameraMode, cycleCamera, cameraLabel, sampleSurface, embark, disembark, extract, sell, pulse, richnessAt, PULSE_COOLDOWN, PROFILE_N,
    FREE_W, FREE_H,
    TIER_CLUSTER, civAt, tickContact, wrapDeltaLon
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
