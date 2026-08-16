/* Resonant — first contact.
 *
 * ── How you talk to somebody ──────────────────────────────────────────────
 *
 * Not with a "hail" button. A civilisation broadcasts on a **carrier
 * frequency**, and you reach them the same way you reach anything else in this
 * game: by tuning φ onto it and holding. The whole apparatus the player has
 * spent the game learning — range to reach a band, precision to land on it,
 * focus to hold it, the acoustic beat that tells them how close they are — is
 * exactly the apparatus for making contact. Nothing new to learn, and the most
 * important content in the game sits behind the most developed skill.
 *
 * The carrier band is set by their technology, and it climbs:
 *
 *   pre-industrial / industrial   Mnemonic     φ437   — records, not signals
 *   atomic / orbital              Causal       φ542   — they broadcast on purpose
 *   interplanetary / system-wide  Archetypal   φ655
 *   interstellar / post-material  Noetic       φ771   — thought without carrier
 *
 * Which means talking to a young culture is merely hard, and talking to an old
 * one is an endgame act — you must be able to *hold the layer minds live in*
 * before a mind will hold still for you. That is the progression gate and the
 * premise agreeing with each other.
 *
 * ── Awareness runs the other way ──────────────────────────────────────────
 *
 * They also have to notice *you*. Awareness accrues from your reality field,
 * from time spent in their system, and from anything you have built there. A
 * culture that has never detected you will not answer a carrier lock; one that
 * has been watching you terraform its neighbour will answer immediately, and
 * its opening line will say so.
 *
 * ── Standing is the consequence layer ─────────────────────────────────────
 *
 * Everything the player does near a civilisation moves a single number, and
 * that number changes what they will do for you, what they say, and whether
 * uplifting them is welcomed or resented. It is stored per address — four
 * numbers in the save — and everything else about them stays derived.
 *
 * ── They know about each other ────────────────────────────────────────────
 *
 * Standing with you is per-player. What they know about *each other* is the
 * same derived-plus-delta pattern with one more index: whether culture B has
 * heard of culture A is a function of B's technological reach and the
 * distance between them, and what they have heard *you* did to A is read
 * off A's contact record. Nothing new is stored. A culture you have not
 * met yet can already be cold because you raised their rival, and they will
 * say so when you arrive.
 *
 * ── Contact at range ──────────────────────────────────────────────────────
 *
 * A carrier lock used to require you in the system. A Resonance Beacon on
 * their world, or a probe left behind, is a relay: awareness still accrues
 * (slower) and a lock you are holding still opens the channel, across light
 * years. You still have to tune. The apparatus does not change; the medium
 * it travels through does.
 *
 * ── Riding a civilisation ─────────────────────────────────────────────────
 *
 * Riding a mind (vessel.js, neural.js) leans on hidden units. Riding a
 * culture is the same mechanic one scale up: you apply a bias vector to the
 * closed-form logistic `civOf` already is, stored as a saturating delta.
 * You never set a technology level. You lean on a trajectory.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, hashF, hashN, fmt } = RS.core;

  /* Which band a culture broadcasts on, by technology. */
  const CARRIER_BANDS = [
    { minTech: 0.00, band: 'mnemonic', note: 'unintentional — you are reading their records, not a signal' },
    { minTech: 0.34, band: 'causal', note: 'deliberate broadcast; they are calling out' },
    { minTech: 0.60, band: 'archetypal', note: 'structured, symbolic, patient' },
    { minTech: 0.84, band: 'noetic', note: 'no carrier at all — thought, arriving already understood' }
  ];

  function carrierBandOf(civ) {
    let b = CARRIER_BANDS[0];
    for (const c of CARRIER_BANDS) if (civ.tech >= c.minTech) b = c;
    return b;
  }

  /* Their exact carrier: inside their band, offset by their own hash, so every
   * culture must be found individually even once you can reach the band. */
  function carrierOf(game, planet, civ) {
    const spec = carrierBandOf(civ);
    const band = RS.spectrum.BY_ID[spec.band];
    const h = hashN(planet.hash, 0xC0FFEE);
    const offset = (hashF(h, 1) * 2 - 1) * band.width * 0.8;
    return {
      band, spec,
      phi: band.centre + offset,
      /* Phase matters too — a signal has a moment as well as a pitch. */
      phase: hashF(h, 2) * Math.PI * 2
    };
  }

  function contactKey(planet) { return RS.influence.planetKey(planet); }

  /* A probe left behind. Not a structure — it has no upkeep and is not in
   * the research tree — so `structuresOn` skips it the way it skips
   * expression. It is a delta because that is how anything the player
   * changes a world survives. */
  const PROBE_ID = '@probe';
  /* Accumulated lean on a culture's trajectory. Same shape as expression:
   * one number per world, saturating, never a stored civilisation. */
  const BIAS_ID = '@civbias';
  const BIAS_CAP = 0.32;
  const BIAS_SCALE = 48;
  const RUMOUR_CAP = 0.35;

  function recordOf(game, planet) {
    const k = contactKey(planet);
    return game.contacts[k] || (game.contacts[k] = {
      standing: 0,        // −1 hostile … +1 allied
      awareness: 0,       // how much they know you exist
      met: false,
      greeted: false,   // have they actually said their opening line to you
      /* Their name and where they live, cached on the record. Everything else
       * about a culture re-derives, but the roster has to be readable without
       * re-deriving every system you have ever visited — and "1,3,2,2" is not
       * a name. */
      name: '', where: '',
      exchanges: 0,
      taught: [],         // research ids they have given you
      gifts: 0,
      uplifted: 0
    });
  }

  // ── culture-to-culture ───────────────────────────────────────────────────

  /* Distance in sectors. The map's own unit, so a culture's technological
   * `reach` (0 atmosphere … 5 post-material) translates directly into how
   * far their knowledge extends. */
  function sectorDist(here, there) {
    const a = here.system.addr, b = there.system.addr;
    return Math.hypot(a.sx - b.sx, a.sy - b.sy);
  }

  /* How far a culture's astronomers, traders or thought can see, in sectors.
   * Pre-industrial cultures know their own world and nothing else; an
   * interstellar one has a neighbourhood. The numbers sit on the same
   * ladder `tier.reach` already is, so a culture that cannot leave its
   * atmosphere also cannot have heard of what you did three systems over. */
  function knowledgeRadius(civ) {
    const r = civ && civ.tier ? civ.tier.reach : 0;
    return [0, 0.15, 1.2, 2.5, 5, 9][clamp(r | 0, 0, 5)];
  }

  function knowsOf(civ, here, there) {
    if (!civ || !here || !there) return false;
    return knowsOfAddr(civ, here, {
      sx: there.system.addr.sx, sy: there.system.addr.sy,
      index: there.system.addr.index, bodyIndex: there.bodyIndex
    });
  }

  function knowsOfAddr(civ, here, addr) {
    if (!civ || !here || !addr) return false;
    const a = here.system.addr;
    if (a.sx === addr.sx && a.sy === addr.sy && a.index === addr.index &&
        here.bodyIndex === addr.bodyIndex) return false;
    const d = Math.hypot(a.sx - addr.sx, a.sy - addr.sy);
    if (d === 0) return civ.tier.reach >= 1;
    return d <= knowledgeRadius(civ);
  }

  /* How an observer feels about a kind of thing you did to someone else.
   * Curious cultures like uplift; insular ones do not; expansionists are
   * the ones who do not mind you making an enemy. */
  function rumourWeight(dispId, kind) {
    const d = dispId || 'curious';
    if (kind === 'uplift') {
      if (d === 'curious' || d === 'distributed' || d === 'contemplative') return 0.10;
      if (d === 'insular' || d === 'hierarchic') return -0.14;
      return 0.02;
    }
    if (kind === 'hostility') {
      if (d === 'expansionist') return 0.05;
      if (d === 'mercantile') return -0.06;
      return -0.11;
    }
    if (kind === 'alliance') {
      if (d === 'mercantile' || d === 'curious' || d === 'distributed') return 0.07;
      if (d === 'insular' || d === 'expansionist') return -0.05;
      return 0.02;
    }
    return 0;
  }

  /* What the observer has heard you did, derived entirely from existing
   * contact records. No extra save slot: the neighbour's standing, gifts
   * and uplifts *are* the rumour. */
  function rumourOf(game, observerPlanet, observerCiv) {
    const notes = [];
    let shift = 0;
    const selfKey = observerPlanet ? contactKey(observerPlanet) : '';
    for (const key in game.contacts) {
      if (key === selfKey) continue;
      const rec = game.contacts[key];
      if (!rec || !rec.met) continue;
      const addr = RS.influence.parsePlanetKey(key);
      if (!addr) continue;
      if (!knowsOfAddr(observerCiv, observerPlanet, addr)) continue;
      const name = rec.name || 'another culture';
      if (rec.uplifted > 0) {
        const w = rumourWeight(observerCiv.disposition.id, 'uplift');
        shift += w * Math.min(2, rec.uplifted);
        notes.push(w < 0
          ? 'They have heard you raised ' + name + ', and they did not ask you to do that to anyone.'
          : 'They have heard you raised ' + name + ', and they are not afraid of that.');
      }
      if (rec.standing < -0.45) {
        const w = rumourWeight(observerCiv.disposition.id, 'hostility');
        shift += w;
        notes.push(w > 0
          ? 'They know you made an enemy of ' + name + '. They do not mind an enemy of their rival.'
          : 'They know you turned ' + name + ' against you, and they are drawing the obvious conclusion.');
      } else if (rec.standing > 0.45) {
        const w = rumourWeight(observerCiv.disposition.id, 'alliance');
        shift += w;
        notes.push(w < 0
          ? 'They know you stand with ' + name + ', and that is not a recommendation here.'
          : 'They know you stand with ' + name + '. That counts for something.');
      }
    }
    shift = clamp(shift, -RUMOUR_CAP, RUMOUR_CAP);
    return { shift, notes };
  }

  /* Direct standing plus what they have heard. Offers, warmth and the
   * channel state all read this, so a rumour is a real mechanical
   * consequence rather than flavour on top of an unchanged number. */
  function standingOf(game, planet, civ) {
    const rec = game.contacts[contactKey(planet)];
    const base = rec ? rec.standing : 0;
    const rumour = civ ? rumourOf(game, planet, civ) : { shift: 0 };
    return clamp(base + rumour.shift, -1, 1);
  }

  /* Nearby cultures this one actually knows, sampled rather than exhaustively
   * scanned — a full neighbourhood derivation on every greeting would be the
   * one place the "nothing is stored" premise got expensive. The sample is
   * hashed from the address, so two players meet the same neighbours. */
  function neighboursOf(game, planet, civ) {
    const R = knowledgeRadius(civ);
    if (R < 0.5) return [];
    const addr = planet.system.addr;
    const h = planet.hash;
    const out = [];
    const seen = Object.create(null);
    const samples = 18 + civ.tier.reach * 10;
    for (let i = 0; i < samples && out.length < 8; i++) {
      const ang = hashF(h, 210 + i) * Math.PI * 2;
      const rad = 0.15 + hashF(h, 310 + i) * R;
      const sx = Math.round(addr.sx + Math.cos(ang) * rad);
      const sy = Math.round(addr.sy + Math.sin(ang) * rad);
      const ix = hashN(h, 410 + i) % 5;
      const key = sx + ',' + sy + ',' + ix;
      if (seen[key]) continue;
      seen[key] = true;
      if (sx === addr.sx && sy === addr.sy && ix === addr.index) continue;
      const sys = RS.stellar.systemAt(game.seed, sx, sy, ix);
      if (!sys) continue;
      for (let j = 0; j < sys.bodies.length; j++) {
        if (sys.bodies[j].kind !== 'planet') continue;
        const p = RS.planet.planetAt(sys, j);
        if (!p) continue;
        const c = RS.civ.civOf(p, 0);
        if (!c) continue;
        if (!knowsOf(civ, planet, p)) continue;
        out.push({ planet: p, civ: c, dist: sectorDist(planet, p) });
        break;
      }
    }
    return out;
  }

  function relationOf(civA, planetA, civB, planetB) {
    if (!knowsOf(civA, planetA, planetB)) return { known: false };
    const d = sectorDist(planetA, planetB);
    const same = civA.disposition.id === civB.disposition.id;
    let stance = 'aware';
    if (civA.disposition.id === 'insular') stance = 'wary';
    else if (civA.disposition.id === 'expansionist' && civB.disposition.id !== 'expansionist') stance = 'rival';
    else if (same || civA.disposition.id === 'curious' || civA.disposition.id === 'distributed') stance = 'open';
    else if (civA.disposition.id === 'mercantile') stance = 'trading';
    return { known: true, stance, dist: d, name: civB.name };
  }

  // ── relays ───────────────────────────────────────────────────────────────

  function probeOn(game, planet) {
    return probeOnKey(game, contactKey(planet));
  }

  function probeOnKey(game, key) {
    const list = game.deltas[key];
    if (!list) return false;
    for (const d of list) if (d.id === PROBE_ID) return true;
    return false;
  }

  /* A beacon on their world, or a probe you left. Either is enough to carry
   * a channel you are still holding. Presence is the other way: being there. */
  function hasRelay(game, planet) {
    return hasRelayKey(game, contactKey(planet));
  }

  function hasRelayKey(game, key) {
    if (probeOnKey(game, key)) return true;
    const list = game.deltas[key];
    if (!list) return false;
    for (const d of list) if (d.id === 'beacon') return true;
    return false;
  }

  function inPresence(game, planet) {
    const s = game.scene;
    if (!s || !s.planet) return false;
    return contactKey(s.planet) === contactKey(planet);
  }

  function stationProbe(game, bus, planet) {
    if (!game.inhabiting || !game.body || RS.vessel.archOf(game.body).id !== 'probe') {
      return { ok: false, reason: 'you have to be a probe to leave one behind' };
    }
    if (probeOn(game, planet)) return { ok: false, reason: 'a probe is already stationed here' };
    const key = contactKey(planet);
    const list = game.deltas[key] || (game.deltas[key] = []);
    list.push({ id: PROBE_ID, at: game.stats.playSeconds });
    if (bus) bus.emit('contact:station', { planet });
    return { ok: true };
  }

  // ── riding a culture ─────────────────────────────────────────────────────

  function biasRecord(game, planet) {
    const key = contactKey(planet);
    const list = game.deltas[key] || (game.deltas[key] = []);
    for (const d of list) if (d.id === BIAS_ID) return d;
    const rec = { id: BIAS_ID, at: game.stats.playSeconds, work: 0, intent: 0 };
    list.push(rec);
    return rec;
  }

  function biasOn(game, planet) {
    const list = planet && game.deltas[contactKey(planet)];
    if (!list) return { tech: 0, cohesion: 0, work: 0, intent: 0, mag: 0 };
    for (const d of list) {
      if (d.id !== BIAS_ID) continue;
      const u = 1 - Math.exp(-(d.work || 0) / BIAS_SCALE);
      const intent = d.intent || 0;
      /* Intent ≥ 0 leans on the technology logistic; intent < 0 leans on
       * cohesion (lowers collapse peril). Both saturate, because a culture
       * is a curve you can shove, not a value you can set. */
      return {
        tech: u * BIAS_CAP * (0.35 + 0.65 * clamp01(intent)),
        cohesion: u * BIAS_CAP * (0.35 + 0.65 * clamp01(-intent)),
        work: d.work || 0,
        intent,
        mag: u
      };
    }
    return { tech: 0, cohesion: 0, work: 0, intent: 0, mag: 0 };
  }

  /* Sustained lean. τ is urgency, Σ is depth of hold, Δ is intent — the
   * symbiont's own dial map, one scale up. Strength scales with the reality
   * field, which is where that meta-progression cashes out into capability. */
  function lean(game, planet, ctl, dt) {
    if (!planet || !ctl) return null;
    const rec = biasRecord(game, planet);
    const urgency = Math.abs(ctl.rate || 0);
    const depth = ctl.vert == null ? 0.5 : ctl.vert;
    const intent = Math.cos(ctl.heading || 0);
    const field = game.fields ? game.fields.reality : 0;
    const amount = urgency * (0.25 + depth * 0.9) * (0.55 + field * 1.6) * dt;
    rec.work += amount;
    /* Intent is a leaky average so a brief twitch of Δ does not rewrite a
     * long hold, and a long hold in one direction does. */
    rec.intent = rec.intent + (intent - rec.intent) * (1 - Math.exp(-dt * 1.8));
    return biasOn(game, planet);
  }

  const STATES = {
    unaware: { id: 'unaware', name: 'Unaware', hue: 220 },
    detected: { id: 'detected', name: 'Detecting', hue: 45 },
    reachable: { id: 'reachable', name: 'Carrier Found', hue: 190 },
    open: { id: 'open', name: 'Channel Open', hue: 135 },
    warm: { id: 'warm', name: 'Welcomed', hue: 120 },
    cold: { id: 'cold', name: 'Refusing', hue: 0 }
  };

  /* Alignment onto their carrier, using exactly the same maths the field uses
   * for a manifestation — so the reticle, the beat tone and the spectrum strip
   * all mean the same thing here that they mean everywhere else. */
  function lockOf(game, planet, civ) {
    const c = carrierOf(game, planet, civ);
    const D = game.dials;
    const focus = RS.dials.focusOf(D.frequency);
    const pFocus = RS.dials.focusOf(D.phase);

    const fWin = c.band.width * 0.34 * (0.5 + 1.25 * focus);
    const pWin = 0.62 * (0.42 + 1.30 * pFocus);
    const fd = (D.frequency.value - c.phi) / fWin;
    const pd = RS.core.angDelta(D.phase.value, c.phase) / pWin;

    const af = Math.exp(-fd * fd);
    const ap = Math.exp(-pd * pd);
    /* A ghosted band cannot carry a conversation — you can hear that somebody
     * is there and not make them out, which is its own kind of moment. */
    const ghost = RS.spectrum.isGhost(c.band, focus);
    return {
      carrier: c,
      total: clamp01(af * ap * (ghost ? 0.25 : 1)),
      f: af, p: ap, fd, pd, ghost,
      inReach: c.phi <= D.frequency.max
    };
  }

  /* Awareness accrues while you are in their system, or — slower — through
   * a relay you left behind. Reality field is the main driver, plus anything
   * you have built, plus sheer time. */
  function accrueAwareness(game, planet, civ, dt) {
    const rec = recordOf(game, planet);
    const rf = game.fields ? game.fields.reality : 0;
    const built = RS.influence.structuresOn(game, planet).length;
    const relay = hasRelay(game, planet);
    const here = inPresence(game, planet);
    if (!here && !relay) return rec.awareness;
    const presence = here ? 1 : 0.42;
    const rate = (0.012 + rf * 0.05 + built * 0.03 + (relay && !here ? 0.008 : 0)) *
      (0.5 + civ.tech) * civ.disposition.contact * presence;
    rec.awareness = clamp01(rec.awareness + rate * dt);
    return rec.awareness;
  }

  function stateOf(game, planet, civ, lock) {
    const rec = recordOf(game, planet);
    const standing = standingOf(game, planet, civ);
    if (standing < -0.45) return STATES.cold;
    if (lock && lock.total > 0.72 && rec.awareness > 0.35) {
      return standing > 0.4 ? STATES.warm : STATES.open;
    }
    if (rec.awareness > 0.35) return STATES.detected;
    if (lock && lock.total > 0.4) return STATES.reachable;
    return STATES.unaware;
  }

  /* Is the channel actually usable right now? */
  function isOpen(game, planet, civ) {
    const lock = lockOf(game, planet, civ);
    const st = stateOf(game, planet, civ, lock);
    return st === STATES.open || st === STATES.warm;
  }

  // ── what they say ────────────────────────────────────────────────────────

  /* Dialogue is composed, not written out: disposition picks the voice,
   * standing picks the warmth, and the situation supplies the subject. That
   * keeps every culture in the galaxy able to say something specific about
   * what you have actually done, without a script. */
  const VOICE = {
    curious: { open: 'You are a shape we do not have a word for. Say more.', reg: 'ask' },
    mercantile: { open: 'A new party at the table. What do you carry?', reg: 'deal' },
    insular: { open: 'We answered. We are not certain we should have.', reg: 'guard' },
    expansionist: { open: 'We felt you before we heard you. State your reach.', reg: 'assert' },
    contemplative: { open: 'We have been expecting something like you for a long while.', reg: 'muse' },
    hierarchic: { open: 'You are addressing the Concord. Identify your order.', reg: 'formal' },
    distributed: { open: 'Several of us are listening. Not all agree to.', reg: 'plural' }
  };

  const WARMTH = [
    { min: -1.0, tone: 'They answer flatly, and only once.' },
    { min: -0.4, tone: 'They answer with care, and watch what you do next.' },
    { min: 0.15, tone: 'They answer readily.' },
    { min: 0.5, tone: 'They answer as though you were expected.' },
    { min: 0.8, tone: 'They answer the way you answer your own.' }
  ];

  function warmthOf(standing) {
    let w = WARMTH[0];
    for (const x of WARMTH) if (standing >= x.min) w = x;
    return w;
  }

  /* An opening line that reflects the actual situation — what they have seen
   * you do, what state their world is in, how far along they are. */
  function greeting(game, planet, civ) {
    const rec = recordOf(game, planet);
    const v = VOICE[civ.disposition.id] || VOICE.curious;
    const lines = [];

    /* `met` is set the instant the channel opens, which is before the player
     * has looked at the panel — so it cannot be the flag that decides whether
     * they get their opening line. `greeted` is set here, when the words are
     * actually read, so the distinctive first thing a culture says to you is
     * never silently consumed by a state change you did not see. */
    const first = !rec.greeted;
    if (!rec.greeted) {
      rec.greeted = true;
      lines.push(v.open);
    } else {
      lines.push(warmthOf(rec.standing).tone);
    }

    const built = RS.influence.structuresOn(game, planet);
    if (built.length) {
      lines.push('They have seen what you put in their sky: ' +
        built.map(b => b.struct.name.toLowerCase()).join(', ') + '.');
    }
    if (rec.uplifted > 0) {
      lines.push(rec.standing > 0.2
        ? 'They know something was given to them, and they have decided to be grateful.'
        : 'They know something was given to them, and they have not decided how to feel.');
    }
    if (civ.collapsed) {
      lines.push('This is what is left of them. They are candid about that.');
    }
    if (planet.biosphere && planet.biosphere.seeded) {
      lines.push('Their oldest records describe a world that was sterile. They are aware the record is wrong.');
    }
    if (civ.tier.reach >= 4) {
      lines.push('They are already interstellar. You are not telling them anything about size.');
    }
    const rumour = rumourOf(game, planet, civ);
    for (const n of rumour.notes.slice(0, 2)) lines.push(n);
    const neigh = neighboursOf(game, planet, civ);
    if (neigh.length && !first) {
      const n0 = neigh[0];
      const rel = relationOf(civ, planet, n0.civ, n0.planet);
      if (rel.known) {
        const how = rel.stance === 'wary' ? 'warily'
          : rel.stance === 'rival' ? 'as a rival'
          : rel.stance === 'trading' ? 'as a market'
          : 'as a neighbour';
        lines.push('They know of ' + n0.civ.name + ' ' + how +
          (n0.dist < 0.5 ? ' in this system.' : ' ' + n0.dist.toFixed(1) + ' sectors out.'));
      }
    }
    const relay = hasRelay(game, planet);
    if (relay && !inPresence(game, planet)) {
      lines.push('The channel is riding a relay you left. They can still hear you.');
    }
    return lines;
  }

  // ── what you can do ──────────────────────────────────────────────────────

  /* Offers are derived from who they are and what state the relationship is
   * in. Every one of them has a real mechanical effect and a real cost. */
  function offersFor(game, planet, civ) {
    const rec = recordOf(game, planet);
    const out = [];
    const disp = civ.disposition;

    /* LISTEN — always available, and the first thing anyone should do. Pays
     * gnosis, because understanding another mind's account of the world is
     * literally recognising an essence in a new context. */
    out.push({
      id: 'listen', name: 'Listen',
      blurb: 'Take in their account of the world. Costs nothing but attention.',
      effect: 'Gnosis, and they warm slightly.',
      cost: 0, available: true
    });

    /* SURVEY — they tell you where things are. This is the strongest reason to
     * find a civilisation: they hand you the map. */
    out.push({
      id: 'survey', name: 'Ask what they know',
      blurb: 'Their astronomers have been looking longer than you have.',
      effect: 'Reveals nearby systems with life or civilisations on the galactic map.',
      cost: 0,
      available: rec.standing > -0.2 && civ.tier.reach >= 1,
      why: civ.tier.reach < 1 ? 'they have never left their atmosphere' : 'they will not share while cold'
    });

    /* TRADE — better prices with standing. */
    if (game.body && game.body.holdMass > 0) {
      out.push({
        id: 'trade', name: 'Trade your hold',
        blurb: 'Sell at their prices, adjusted by how they feel about you.',
        effect: 'Ψ from cargo × ' + (1 + rec.standing * 0.6).toFixed(2) + ' standing multiplier.',
        cost: 0, available: true
      });
    }

    /* GIFT — spend to buy standing. The honest, slow route. */
    const giftCost = Math.ceil(200 * Math.pow(1.7, rec.gifts));
    out.push({
      id: 'gift', name: 'Give freely',
      blurb: 'Hand over insight with nothing asked. They notice that.',
      effect: '+standing. Costs more each time — generosity stops reading as generous.',
      cost: giftCost,
      available: game.insight >= giftCost
    });

    /* TEACH — they give you research. The payoff for the whole relationship. */
    const teachable = RS.influence.RESEARCH.filter(n =>
      !game.research[n.id] && rec.taught.indexOf(n.id) < 0 &&
      /* They can only teach what they have themselves. */
      n.cost <= 1200 * (1 + civ.tech * 6));
    if (teachable.length) {
      const node = teachable[hashN(planet.hash, rec.exchanges) % teachable.length];
      out.push({
        id: 'learn', name: 'Ask to be taught: ' + node.name,
        blurb: 'They know how. Whether they will depends on where you stand.',
        effect: 'Unlocks ' + node.name + ' outright.',
        node,
        cost: 0,
        available: rec.standing > 0.45,
        why: 'they will only teach an ally (standing ' + rec.standing.toFixed(2) + '/0.45)'
      });
    }

    /* UPLIFT — the heaviest thing you can do, and it can go wrong. */
    const hasLattice = RS.influence.structuresOn(game, planet).some(b => b.struct.id === 'lattice');
    out.push({
      id: 'uplift', name: 'Raise what they can reach',
      blurb: 'Push their technology ceiling upward. They did not ask you to.',
      effect: 'Permanent tech gain. An insular or hierarchic culture may resent it.',
      cost: 0,
      available: hasLattice,
      why: 'needs a Cognition Lattice sited on this world'
    });

    /* WITHDRAW — closing a channel cleanly is a real choice for insular
     * cultures, who prefer it. */
    out.push({
      id: 'withdraw', name: 'Withdraw',
      blurb: 'Break the carrier and leave them alone.',
      effect: disp.id === 'insular' ? 'They will think better of you for it.' : 'Neutral.',
      cost: 0, available: true
    });

    /* STATION — leave a probe so the channel survives you leaving. The
     * beacon already does this as a side-effect of existing; a probe is the
     * cheaper, portable version of the same idea. */
    const flyingProbe = game.inhabiting && game.body &&
      RS.vessel.archOf(game.body).id === 'probe';
    if (flyingProbe || probeOn(game, planet)) {
      out.push({
        id: 'station', name: probeOn(game, planet) ? 'Probe stationed' : 'Leave a probe',
        blurb: 'A sensor left in their sky keeps the channel open after you go.',
        effect: 'Awareness and lock survive across light years, while you hold their carrier.',
        cost: 0,
        available: flyingProbe && !probeOn(game, planet),
        why: probeOn(game, planet) ? 'already stationed' : 'wear a Probe in this system'
      });
    }

    return out;
  }

  /* Executing an offer. Everything that changes is either standing (stored) or
   * a normal game resource — the civilisation itself stays derived. */
  function act(game, bus, planet, civ, offerId) {
    const rec = recordOf(game, planet);
    const disp = civ.disposition;
    rec.met = true;
    rec.name = civ.name;
    rec.where = planet.name;

    switch (offerId) {
      case 'listen': {
        rec.exchanges++;
        rec.standing = clamp(rec.standing + 0.06 * disp.contact, -1, 1);
        /* Their account of reality is another context for an essence you may
         * already know — which is exactly what gnosis measures. */
        const ess = RS.fractal.ESSENCES[hashN(planet.hash, rec.exchanges) % RS.fractal.ESSENCES.length];
        const fakeMan = {
          essence: ess,
          tierIndex: RS.cosmos.BY_ID.system.index,
          bandIndex: carrierBandOf(civ).band === 'noetic' ? RS.spectrum.BY_ID.noetic.index
            : RS.spectrum.BY_ID.mnemonic.index,
          name: 'their account of ' + ess.name.toLowerCase(),
          hue: disp.hue
        };
        const r = RS.fractal.recognise(game, fakeMan);
        const insight = 40 * (1 + civ.tech * 8) * (1 + rec.standing);
        game.insight += insight;
        bus.emit('contact:listen', { planet, civ, essence: ess, fresh: r.fresh, level: r.level, insight });
        return { ok: true, insight };
      }

      case 'survey': {
        /* These two conditions must match `offersFor` exactly. They did not
         * once — the panel greyed the option out for a pre-industrial culture
         * and the action ran anyway, which is the kind of divergence that
         * makes a UI feel like it is lying. Keeping the gate in one place
         * would be cleaner still, but at minimum it has to agree. */
        if (rec.standing <= -0.2) return { ok: false, reason: 'they will not share while cold' };
        if (civ.tier.reach < 1) {
          return { ok: false, reason: 'they have never left their atmosphere — they have no charts to give' };
        }
        rec.exchanges++;
        /* They mark their neighbourhood on your map. Mechanically: every star
         * within their technological reach becomes resolved regardless of your
         * consciousness field, which is a genuine shortcut through the
         * exploration gate and the best reason to talk to anyone. */
        const radius = 2 + civ.tier.reach;
        let revealed = 0;
        const G = game.galaxy;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            for (const st of RS.galaxy.starsIn(game.seed, G.sx + dx, G.sy + dy)) {
              const key = st.sx + ',' + st.sy + ',' + st.index;
              if (!game.known.charted[key]) { game.known.charted[key] = true; revealed++; }
            }
          }
        }
        G.cacheKey = '';
        rec.standing = clamp(rec.standing + 0.03, -1, 1);
        bus.emit('contact:survey', { planet, civ, revealed, radius });
        return { ok: true, revealed };
      }

      case 'trade': {
        if (!game.body || game.body.holdMass <= 0) return { ok: false, reason: 'your hold is empty' };
        const market = RS.civ.marketOf(planet, civ);
        const mul = (1 + rec.standing * 0.6) * disp.trade;
        let total = 0;
        for (const id in game.body.hold) {
          const e = market.find(m => m.commodity.id === id);
          if (!e) continue;
          const amount = game.body.hold[id];
          total += amount * e.price * 0.1 * mul;
          RS.vessel.removeCargo(game.body, id, amount);
        }
        if (total <= 0) return { ok: false, reason: 'nothing they want' };
        game.insight += total;
        rec.exchanges++;
        rec.standing = clamp(rec.standing + 0.04 * disp.trade, -1, 1);
        bus.emit('contact:trade', { planet, civ, total });
        return { ok: true, total };
      }

      case 'gift': {
        const cost = Math.ceil(200 * Math.pow(1.7, rec.gifts));
        if (game.insight < cost) return { ok: false, reason: 'needs ' + fmt(cost) + ' Ψ' };
        game.insight -= cost;
        rec.gifts++;
        /* Diminishing, because the fifth unprompted gift reads differently
         * from the first. */
        rec.standing = clamp(rec.standing + 0.22 / (1 + rec.gifts * 0.4), -1, 1);
        bus.emit('contact:gift', { planet, civ, cost, standing: rec.standing });
        return { ok: true };
      }

      case 'learn': {
        if (rec.standing <= 0.45) return { ok: false, reason: 'they will only teach an ally' };
        const teachable = RS.influence.RESEARCH.filter(n =>
          !game.research[n.id] && rec.taught.indexOf(n.id) < 0 &&
          n.cost <= 1200 * (1 + civ.tech * 6));
        if (!teachable.length) return { ok: false, reason: 'they have nothing left to teach you' };
        const node = teachable[hashN(planet.hash, rec.exchanges) % teachable.length];
        game.research[node.id] = true;
        if (node.unlocks.vessels) for (const v of node.unlocks.vessels) game.vessels.unlocked[v] = true;
        if (node.unlocks.structures) for (const s of node.unlocks.structures) game.structuresUnlocked[s] = true;
        rec.taught.push(node.id);
        rec.exchanges++;
        /* Teaching costs them something, and they know it. */
        rec.standing = clamp(rec.standing - 0.12, -1, 1);
        RS.influence.recomputeFields(game);
        bus.emit('contact:taught', { planet, civ, node });
        return { ok: true, node };
      }

      case 'uplift': {
        const hasLattice = RS.influence.structuresOn(game, planet).some(b => b.struct.id === 'lattice');
        if (!hasLattice) return { ok: false, reason: 'needs a Cognition Lattice here' };
        rec.uplifted++;
        rec.exchanges++;
        /* How they take it depends on who they are. An insular or hierarchic
         * culture experiences uplift as an intrusion on their own terms —
         * which is the point of the mechanic: help is not neutral. */
        const welcomed = disp.id === 'curious' || disp.id === 'distributed' || disp.id === 'contemplative';
        const delta = welcomed ? 0.18 : -0.26;
        rec.standing = clamp(rec.standing + delta, -1, 1);
        bus.emit('contact:uplift', { planet, civ, welcomed, standing: rec.standing });
        return { ok: true, welcomed };
      }

      case 'withdraw': {
        if (disp.id === 'insular') rec.standing = clamp(rec.standing + 0.08, -1, 1);
        bus.emit('contact:withdraw', { planet, civ });
        return { ok: true, closed: true };
      }

      case 'station': {
        return stationProbe(game, bus, planet);
      }
    }
    return { ok: false, reason: 'unknown' };
  }

  /* Uplift, lattice ceiling, rumour and cultural bias are applied on top of
   * the derived civilisation, the same way structures are applied on top of
   * a derived planet. The civilisation itself is never stored. */
  function applyTo(game, planet, civ) {
    const k = contactKey(planet);
    const rec = game.contacts[k];
    if (rec) {
      if (rec.uplifted > 0) {
        civ.tech = clamp01(civ.tech + 0.09 * rec.uplifted);
        civ.tier = RS.civ.techTierOf(civ.tech);
        civ.uplifted = rec.uplifted;
      }
      civ.awareness = rec.awareness;
      civ.met = rec.met;
    } else {
      civ.awareness = 0;
      civ.met = false;
    }
    /* The lattice writes a ceiling onto the planet; consume it here, because
     * a ceiling that is stored and never read is scenery. */
    if (planet.techCeiling) {
      civ.tech = clamp01(civ.tech + planet.techCeiling);
      civ.tier = RS.civ.techTierOf(civ.tech);
    }
    const bias = biasOn(game, planet);
    if (bias.mag > 0.002) {
      civ.tech = clamp01(civ.tech + (1 - civ.tech) * bias.tech);
      civ.tier = RS.civ.techTierOf(civ.tech);
      civ.peril = (civ.peril || 0) * (1 - bias.cohesion * 1.15);
      civ.biased = bias.mag;
    }
    civ.rumour = rumourOf(game, planet, civ).notes;
    civ.standing = standingOf(game, planet, civ);
    return civ;
  }

  /* Relays keep a channel you are still holding, even from another system.
   * Called every tick; cheap because it only walks contact records. */
  function tickRelays(game, bus, dt) {
    const s = game.scene;
    if (!s) return;
    const localKey = s.planet ? contactKey(s.planet) : null;
    /* A contact that is not the world under you and has no relay is stale:
     * you left, and nothing is carrying the channel. Clearing it here is
     * what lets a relay take over once you are in another system. */
    if (s.contact && s.contact.planet) {
      const ck = contactKey(s.contact.planet);
      if (ck !== localKey && !hasRelayKey(game, ck)) {
        s.contact = null;
        s.relayState = null;
      }
    }
    let best = null;
    for (const k in game.contacts) {
      if (k === localKey) continue;
      if (!hasRelayKey(game, k)) continue;
      const planet = RS.influence.planetFromKey(game, k);
      if (!planet) continue;
      const civ0 = RS.civ.civOf(planet, s.tGyr);
      if (!civ0) continue;
      const civ = applyTo(game, planet, civ0);
      accrueAwareness(game, planet, civ, dt);
      const lock = lockOf(game, planet, civ);
      if (lock.total > 0.4 && (!best || lock.total > best.lock.total)) {
        best = { planet, civ, lock };
      }
    }
    if (!best) return;
    if (s.contact && !s.contact.relayed && localKey &&
        contactKey(s.contact.planet) === localKey) return;
    const state = stateOf(game, best.planet, best.civ, best.lock);
    const prev = s.relayState;
    s.contact = { civ: best.civ, lock: best.lock, state, planet: best.planet, relayed: true };
    s.relayState = state;
    if (prev !== state && (state === STATES.open || state === STATES.warm) &&
        prev !== STATES.open && prev !== STATES.warm) {
      const rec = recordOf(game, best.planet);
      const first = !rec.met;
      rec.met = true;
      rec.name = best.civ.name;
      rec.where = best.planet.name;
      if (bus) bus.emit('contact:open', { planet: best.planet, civ: best.civ, first, lock: best.lock, relayed: true });
    }
  }

  function totalMet(game) {
    let n = 0;
    for (const k in game.contacts) if (game.contacts[k].met) n++;
    return n;
  }

  function allies(game) {
    let n = 0;
    for (const k in game.contacts) if (game.contacts[k].standing > 0.45) n++;
    return n;
  }

  RS.contact = {
    CARRIER_BANDS, STATES, VOICE, PROBE_ID, BIAS_ID, BIAS_CAP, RUMOUR_CAP,
    carrierBandOf, carrierOf, contactKey, recordOf, lockOf,
    accrueAwareness, stateOf, isOpen, greeting, warmthOf, offersFor, act,
    applyTo, totalMet, allies,
    sectorDist, knowledgeRadius, knowsOf, knowsOfAddr, rumourOf, rumourWeight,
    standingOf, neighboursOf, relationOf,
    hasRelay, hasRelayKey, probeOn, probeOnKey, inPresence, stationProbe, tickRelays,
    biasOn, biasRecord, lean
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
