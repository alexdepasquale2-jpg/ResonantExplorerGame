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

  /* Awareness accrues while you are in their system. Reality field is the main
   * driver — being *able to affect* a world is what makes you detectable in
   * it — plus anything you have built, plus sheer time. */
  function accrueAwareness(game, planet, civ, dt) {
    const rec = recordOf(game, planet);
    const rf = game.fields ? game.fields.reality : 0;
    const built = RS.influence.structuresOn(game, planet).length;
    const rate = (0.012 + rf * 0.05 + built * 0.03) * (0.5 + civ.tech) * civ.disposition.contact;
    rec.awareness = clamp01(rec.awareness + rate * dt);
    return rec.awareness;
  }

  function stateOf(game, planet, civ, lock) {
    const rec = recordOf(game, planet);
    if (rec.standing < -0.45) return STATES.cold;
    if (lock && lock.total > 0.72 && rec.awareness > 0.35) {
      return rec.standing > 0.4 ? STATES.warm : STATES.open;
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
    }
    return { ok: false, reason: 'unknown' };
  }

  /* Uplift is applied on top of the derived civilisation, the same way
   * structures are applied on top of a derived planet. */
  function applyTo(game, planet, civ) {
    const k = contactKey(planet);
    const rec = game.contacts[k];
    if (!rec) return civ;
    if (rec.uplifted > 0) {
      civ.tech = clamp01(civ.tech + 0.09 * rec.uplifted);
      civ.tier = RS.civ.techTierOf(civ.tech);
      civ.uplifted = rec.uplifted;
    }
    civ.standing = rec.standing;
    civ.awareness = rec.awareness;
    civ.met = rec.met;
    return civ;
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
    CARRIER_BANDS, STATES, VOICE,
    carrierBandOf, carrierOf, contactKey, recordOf, lockOf,
    accrueAwareness, stateOf, isOpen, greeting, warmthOf, offersFor, act,
    applyTo, totalMet, allies
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
