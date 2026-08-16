/* Resonant — biospheres, civilisations and economies, in closed form.
 *
 * ── Why none of this is simulated ─────────────────────────────────────────
 *
 * Populations, technology levels and prices are all *analytic functions of
 * time*. A logistic curve has a closed form:
 *
 *     N(t) = K / (1 + ((K − N₀)/N₀)·e^(−r·t))
 *
 * so the population of a world four billion years from now costs exactly one
 * exponential to evaluate — the same as asking about next Tuesday. Nothing
 * ticks, nothing accumulates, nothing needs to have been running while you
 * were elsewhere.
 *
 * That is what makes the TIME dial into the game's most powerful instrument
 * rather than a fast-forward button. Scrub it and you watch biospheres ignite,
 * oxygenate, become complex, throw up a civilisation, and burn out — across a
 * whole system at once, at any speed, in either direction, with no loading and
 * no drift. A tick-based simulation could not do that at any framerate: it
 * would have to actually run those four billion years.
 *
 * The player's interventions are stored as sparse deltas layered *on top* of
 * the analytic baseline (see influence.js), so the save stays tiny and history
 * stays exact.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, hashF, hashN, fmt } = RS.core;

  /* Closed-form logistic. The workhorse of this entire file. */
  function logistic(t, K, N0, r) {
    if (t <= 0) return N0;
    if (K <= 0) return 0;
    const ratio = (K - N0) / Math.max(1e-12, N0);
    return K / (1 + ratio * Math.exp(-r * t));
  }

  /* A smooth 0→1 gate over a window, used wherever a threshold would otherwise
   * pop. Nothing in this game is allowed to appear instantly. */
  function ramp(x, a, b) { return clamp01((x - a) / Math.max(1e-9, b - a)); }

  // ── biosphere ────────────────────────────────────────────────────────────

  const STAGES = [
    { id: 'sterile', name: 'Sterile', min: 0.00 },
    { id: 'prebiotic', name: 'Prebiotic Chemistry', min: 0.06 },
    { id: 'microbial', name: 'Microbial', min: 0.20 },
    { id: 'oxygenic', name: 'Oxygenic', min: 0.38 },
    { id: 'multicellular', name: 'Multicellular', min: 0.56 },
    { id: 'complex', name: 'Complex Ecology', min: 0.72 },
    { id: 'sapient', name: 'Sapient', min: 0.88 }
  ];

  function stageOf(complexity) {
    let s = STAGES[0];
    for (const st of STAGES) if (complexity >= st.min) s = st;
    return s;
  }

  /* Abiogenesis is gated on habitability and on time. The rate constant is
   * scaled by habitability, so a marginal world may take its whole stellar
   * lifetime to get to microbes and never get further — which is almost
   * certainly the common case in reality and makes a complex biosphere feel
   * like the rarity it should be. */
  function biosphereOf(p) {
    if (p.habitability < 0.04) return null;
    const h = p.hash;
    /* Not every qualifying world gets started; abiogenesis is not guaranteed
     * even where it is possible. */
    if (hashF(h, 100) > 0.18 + p.habitability * 0.66) return null;

    /* Time available: how long the world has been habitable. Younger than the
     * lag and nothing has happened yet. */
    const lag = 0.35 + hashF(h, 101) * 0.7;      // Gyr before life takes hold
    const t = p.age - lag;
    if (t <= 0) return null;

    /* Rate: habitability drives it, but so does *stability* — a world with a
     * magnetosphere and plate tectonics recycles nutrients and shields its
     * surface, and those are the worlds that get past microbes.
     *
     * The leading constant is calibrated, not picked. The logistic runs over
     * gigayears from N0 = 0.012, so reaching complexity ~0.9 inside a stellar
     * lifetime needs r·t ≈ 6.6. At 3.2 a marginal world (habitability 0.2)
     * sits at ~0.12 after 5 Gyr and stays microbial forever, a good one (0.4)
     * reaches ~0.6 and becomes a complex ecology, and an excellent one (0.6+)
     * passes 0.94 and can become sapient. An earlier value of 0.30 put every
     * world in the galaxy below 0.04 — life existed on paper and nothing ever
     * got past pond scum, which is the sort of thing only a galaxy-scale
     * census catches. simtest now runs that census. */
    const stability = 0.35 + 0.4 * p.magnetosphere + 0.25 * p.tectonics;
    const r = RS.physics.abiogenesis() * p.habitability * stability * (0.6 + hashF(h, 102) * 0.9);

    const complexity = clamp01(logistic(t, 1.0, 0.012, r));
    const stage = stageOf(complexity);

    /* Oxygenation lags complexity — photosynthesis has to appear first, and
     * then the oxygen has to saturate every available sink before it starts
     * accumulating in the air. That delay is why Earth spent two billion years
     * microbial and anoxic. */
    const oxygenation = clamp01(ramp(complexity, 0.30, 0.72)) * clamp01(p.hydrosphere * 2);

    /* Biomass density and diversity, both bounded by the energy available. */
    const energy = clamp01(p.flux / 2) * clamp01(p.hydrosphere * 2.5);
    const biomass = complexity * energy * (0.5 + hashF(h, 103) * 0.8);
    const diversity = Math.floor(complexity * complexity * 4200 * (0.4 + hashF(h, 104)));

    /* Carbon vs alternative chemistry. Rare, and only where carbon-water
     * chemistry could not have worked. */
    const exotic = (p.surfaceTemp < 120 || p.surfaceTemp > 420) && hashF(h, 105) > 0.55;

    return {
      complexity, stage, oxygenation, biomass, diversity,
      chemistry: exotic ? (p.surfaceTemp < 120 ? 'cryogenic ammonia' : 'silicate-sulphur') : 'carbon-water',
      startedAt: lag,
      /* A sapient biosphere may or may not still have a civilisation on it. */
      sapient: complexity >= 0.88
    };
  }

  /* Free oxygen rewrites the atmosphere. Called by planet.js once a biosphere
   * is known to have oxygenated. */
  function oxygenate(p) {
    const frac = p.biosphere.oxygenation * 0.28;
    const o2 = RS.planet.GASES.find(g => g.id === 'O2');
    if (!o2 || !p.held.some(g => g.id === 'O2')) return;
    /* Scale everything else down to make room, then insert O2. */
    for (const c of p.composition) c.frac *= (1 - frac);
    const existing = p.composition.find(c => c.gas.id === 'O2');
    if (existing) existing.frac += frac;
    else p.composition.push({ gas: o2, frac });
    p.composition.sort((a, b) => b.frac - a.frac);
    p.biosignature = true;
  }

  // ── civilisation ─────────────────────────────────────────────────────────

  const TECH_TIERS = [
    { min: 0.00, name: 'Pre-industrial', reach: 0 },
    { min: 0.18, name: 'Industrial', reach: 0 },
    { min: 0.34, name: 'Atomic', reach: 0 },
    { min: 0.48, name: 'Orbital', reach: 1 },
    { min: 0.60, name: 'Interplanetary', reach: 2 },
    { min: 0.72, name: 'System-wide', reach: 3 },
    { min: 0.84, name: 'Interstellar', reach: 4 },
    { min: 0.94, name: 'Post-material', reach: 5 }
  ];

  function techTierOf(tech) {
    let t = TECH_TIERS[0];
    for (const tt of TECH_TIERS) if (tech >= tt.min) t = tt;
    return t;
  }

  const DISPOSITIONS = [
    { id: 'curious', name: 'Curious', trade: 1.15, contact: 1.4, hue: 190 },
    { id: 'mercantile', name: 'Mercantile', trade: 1.5, contact: 1.1, hue: 45 },
    { id: 'insular', name: 'Insular', trade: 0.55, contact: 0.35, hue: 265 },
    { id: 'expansionist', name: 'Expansionist', trade: 1.2, contact: 0.9, hue: 15 },
    { id: 'contemplative', name: 'Contemplative', trade: 0.7, contact: 0.8, hue: 285 },
    { id: 'hierarchic', name: 'Hierarchic', trade: 0.9, contact: 0.6, hue: 340 },
    { id: 'distributed', name: 'Distributed', trade: 1.05, contact: 1.2, hue: 150 }
  ];

  /* A civilisation, if there is one. `t` is the current in-world time offset
   * in Gyr from the planet's present, which is what the TIME dial moves — so
   * this same function answers "what is there now" and "what was there a
   * million years ago" at identical cost. */
  function civOf(p, tOffset) {
    const bio = p.biosphere;
    if (!bio || !bio.sapient) return null;
    const h = p.hash;

    /* Sapience is not civilisation. Most sapient biospheres, at any given
     * moment, do not have a technological culture on them. */
    if (hashF(h, 120) > 0.42) return null;

    /* When technology started, measured back from the present. Civilisations
     * are astronomically young, so this is thousands to millions of years, not
     * billions — which is exactly why finding one is remarkable. */
    const startAgo = (0.2 + hashF(h, 121) * 40) * 1e-6;   // Gyr
    const t = startAgo + (tOffset || 0);
    if (t <= 0) return null;

    /* Carrying capacity from the habitable surface actually available. */
    const surfaceE = p.radiusE * p.radiusE;
    const K = 1e9 * p.habitability * surfaceE * (0.3 + hashF(h, 122) * 2.2);
    const r = 6e5 * (0.5 + hashF(h, 123));                // per Gyr — fast on this scale
    const pop = logistic(t, K, 2e6, r);

    /* Technology follows population and time, but saturates: there is a
     * ceiling on what any culture reaches before it either transcends or
     * collapses. */
    const tech = clamp01(logistic(t, 1.0, 0.02, r * 0.85));

    /* Collapse risk rises with technology and falls with how distributed the
     * culture is. A civilisation that got interstellar is effectively immune;
     * one at the atomic threshold is at maximum risk. This makes the mid-tech
     * band conspicuously empty, which is a real hypothesis about why the sky
     * is quiet and it makes the ones you *do* find feel precarious. */
    const peril = Math.exp(-Math.pow((tech - 0.42) / 0.22, 2)) * (0.4 + hashF(h, 124) * 0.9);
    const collapsed = hashF(h, 125) < peril * 0.55;

    const disp = DISPOSITIONS[hashN(h, 126) % DISPOSITIONS.length];
    const tier = techTierOf(tech);

    return {
      population: collapsed ? pop * 0.02 : pop,
      tech: collapsed ? tech * 0.4 : tech,
      tier: collapsed ? techTierOf(tech * 0.4) : tier,
      disposition: disp,
      collapsed,
      peril,
      ageYears: t * 1e9,
      /* Energy use, as a Kardashev-style index. Purely derived, and it is what
       * decides whether they are detectable from another system. */
      kardashev: clamp(Math.log10(Math.max(1, pop) * Math.pow(10, 3 + tech * 9)) / 10 - 0.6, 0, 3),
      name: cultureName(h),
      /* Whether they have noticed you. Feeds the influence layer. */
      contactThreshold: 0.45 / Math.max(0.2, disp.contact)
    };
  }

  const CULT_A = ['Vel', 'Thren', 'Ossa', 'Kai', 'Mor', 'Ish', 'Ur', 'Aen', 'Dhar', 'Lys', 'Qen', 'Tor'];
  const CULT_B = ['ai', 'une', 'ari', 'oth', 'esk', 'ira', 'ux', 'anth', 'ode', 'ven'];
  const CULT_C = ['Concord', 'Assembly', 'Weave', 'Choir', 'Compact', 'Lineage', '承', 'Union', 'Reach', 'Accord'];

  function cultureName(h) {
    const a = CULT_A[hashN(h, 130) % CULT_A.length];
    const b = CULT_B[hashN(h, 131) % CULT_B.length];
    const c = CULT_C[hashN(h, 132) % CULT_C.length];
    return a + b + ' ' + c;
  }

  // ── economy ──────────────────────────────────────────────────────────────

  /* Commodities. The first seven mirror planet.js's resource kinds; the rest
   * are manufactured, and can only be produced by a civilisation with enough
   * technology — which is what gives inhabited systems a reason to exist in
   * the trade network rather than just being scenery. */
  const COMMODITIES = [
    { id: 'metals', name: 'Metals', base: 10, elasticity: 0.8, tech: 0, hue: 30 },
    { id: 'silicates', name: 'Silicates', base: 4, elasticity: 0.6, tech: 0, hue: 40 },
    { id: 'volatiles', name: 'Volatiles', base: 14, elasticity: 0.9, tech: 0, hue: 190 },
    { id: 'organics', name: 'Organics', base: 22, elasticity: 1.0, tech: 0, hue: 130 },
    { id: 'rareEarths', name: 'Rare Earths', base: 70, elasticity: 1.2, tech: 0, hue: 285 },
    { id: 'fissiles', name: 'Fissiles', base: 130, elasticity: 1.3, tech: 0, hue: 100 },
    { id: 'exotics', name: 'Exotics', base: 420, elasticity: 1.5, tech: 0, hue: 320 },
    { id: 'alloys', name: 'Alloys', base: 55, elasticity: 0.9, tech: 0.18, hue: 25, from: ['metals', 'silicates'] },
    { id: 'polymers', name: 'Polymers', base: 48, elasticity: 0.9, tech: 0.22, hue: 210, from: ['organics', 'volatiles'] },
    { id: 'computation', name: 'Computation', base: 210, elasticity: 1.1, tech: 0.48, hue: 175, from: ['rareEarths', 'silicates'] },
    { id: 'antimatter', name: 'Antimatter', base: 900, elasticity: 1.6, tech: 0.72, hue: 300, from: ['fissiles', 'exotics'] },
    { id: 'cognition', name: 'Cognition', base: 1600, elasticity: 1.4, tech: 0.86, hue: 60, from: ['computation', 'exotics'] }
  ];
  const COMM_BY_ID = Object.create(null);
  COMMODITIES.forEach((c, i) => { c.index = i; COMM_BY_ID[c.id] = c; });

  /* A market is a pure function of the planet's derived state. Supply comes
   * from what the world has and can extract; demand comes from who lives there
   * and how advanced they are; price is the ratio. No ledger, no history, no
   * simulation — and yet prices differ between worlds in ways that make
   * physical sense, which is all a trade game actually needs. */
  function marketOf(p, civ) {
    const tech = civ ? civ.tech : 0;
    const popScale = civ ? clamp01(Math.log10(Math.max(1, civ.population)) / 11) : 0;
    const out = [];

    for (const c of COMMODITIES) {
      if (c.tech > tech) continue;      // cannot be made here at all

      let supply, demand;
      if (c.from) {
        /* Manufactured: supply is limited by the scarcest input and by how
         * much industry there is to convert it. */
        let inputs = 1;
        for (const inId of c.from) {
          inputs = Math.min(inputs, (p.resources[inId] != null ? p.resources[inId] : 0.4));
        }
        supply = inputs * tech * popScale * 2.2;
        demand = popScale * (0.35 + tech * 1.5);
      } else {
        /* Raw: supply is the abundance, boosted by extraction technology. */
        supply = (p.resources[c.id] || 0) * (0.25 + tech * 1.5) * (0.4 + popScale);
        demand = popScale * (0.5 + tech * 1.2) * (c.id === 'organics' ? 1.6 : 1);
      }

      /* An uninhabited world still has supply — nobody is extracting it, but
       * it is there to be taken, which is what makes empty systems worth
       * visiting. */
      if (!civ) { supply = (p.resources[c.id] || 0) * 0.5; demand = 0; }

      supply = Math.max(1e-3, supply);
      demand = Math.max(1e-3, demand);

      /* Price from the supply/demand ratio, with the commodity's own
       * elasticity. Clamped hard: unbounded prices break a trade game. */
      const price = c.base * clamp(Math.pow(demand / supply, c.elasticity), 0.12, 9);
      out.push({
        commodity: c, supply, demand, price,
        /* Positive means the world wants it, negative means it dumps it. */
        balance: demand - supply
      });
    }
    return out;
  }

  /* Trade routes emerge rather than being authored: any pair of markets with a
   * price differential that beats the transport cost is a route, and the
   * transport cost is the real Hohmann delta-v from orbital.js. So the trade
   * map of a system is a consequence of its orbital architecture — inner
   * worlds trade with each other because they are cheap to reach. */
  function routesBetween(marketA, marketB, deltaV, limit) {
    const routes = [];
    const byId = Object.create(null);
    for (const e of marketB) byId[e.commodity.id] = e;
    for (const a of marketA) {
      const b = byId[a.commodity.id];
      if (!b) continue;
      const spread = b.price - a.price;
      /* Cost scales with delta-v and with how bulky the good is — cheap bulk
       * goods are not worth lifting out of a gravity well, which is why
       * high-value low-mass commodities dominate long routes. */
      const cost = deltaV * (a.commodity.base < 60 ? 9 : 2.2);
      const margin = spread - cost;
      if (margin > 0) routes.push({ commodity: a.commodity, buy: a.price, sell: b.price, margin, cost });
    }
    routes.sort((x, y) => y.margin - x.margin);
    return limit ? routes.slice(0, limit) : routes;
  }

  /* Everything tradeable in a system, ranked. Used by the system view to draw
   * live trade lanes between worlds — the lanes are literally the top routes,
   * so the visual is the mechanic rather than a decoration. */
  function systemTrade(planets, tOffset, limit) {
    const markets = planets.map(p => ({
      planet: p,
      civ: civOf(p, tOffset),
      market: null
    }));
    for (const m of markets) m.market = marketOf(m.planet, m.civ);

    const lanes = [];
    for (let i = 0; i < markets.length; i++) {
      for (let j = 0; j < markets.length; j++) {
        if (i === j) continue;
        const A = markets[i], B = markets[j];
        /* No trade without someone to trade with. */
        if (!A.civ && !B.civ) continue;
        const dv = RS.orbital.hohmannDeltaV(A.planet.a, B.planet.a, A.planet.system.primary.mass);
        const r = routesBetween(A.market, B.market, dv, 1);
        if (r.length) lanes.push({ from: A, to: B, route: r[0], deltaV: dv });
      }
    }
    lanes.sort((a, b) => b.route.margin - a.route.margin);
    return { markets, lanes: limit ? lanes.slice(0, limit) : lanes };
  }

  // ── fauna ────────────────────────────────────────────────────────────────

  /* Creatures are derived per (planet, biome, slot), the same way everything
   * else is. Their traits are constrained by the planet's physics — gravity
   * sets body plan, atmosphere sets respiration, temperature sets metabolism —
   * so an organism is a readable consequence of its world rather than a
   * decoration sampled from a bag. */
  const BODY_PLANS = ['radial', 'bilateral', 'sessile', 'colonial', 'amorphous', 'segmented'];
  const LOCOMOTION = ['walking', 'crawling', 'swimming', 'flying', 'burrowing', 'drifting', 'rooted'];

  function faunaAt(p, biomeId, slot) {
    const bio = p.biosphere;
    if (!bio || bio.complexity < 0.5) return null;
    const h = hashN(p.hash ^ 0xFA00A, biomeId.length, slot | 0);

    /* Gravity is the strongest single constraint on body plan. High gravity
     * means squat and strong; low gravity permits enormous fragile things and
     * makes flight cheap. */
    const g = p.gravity;
    const massKg = Math.exp(lerp(-4, 8, hashF(h, 1))) / Math.pow(g, 1.4);
    const height = Math.pow(massKg, 0.33) / Math.pow(g, 0.5);

    /* Flight needs either thick air or weak gravity; the wing-loading
     * inequality does the gating without a special case. */
    const canFly = p.pressure * 1.6 > g * (0.35 + hashF(h, 2) * 0.6);
    const aquatic = p.hydrosphere > 0.3 && (biomeId === 'ocean' || biomeId === 'shallows');

    let loco;
    if (aquatic) loco = 'swimming';
    else if (canFly && hashF(h, 3) > 0.62) loco = 'flying';
    else if (hashF(h, 4) > 0.86) loco = 'burrowing';
    else if (hashF(h, 5) > 0.9) loco = 'rooted';
    else loco = massKg > 2 ? 'walking' : 'crawling';

    const plan = BODY_PLANS[hashN(h, 6) % BODY_PLANS.length];
    /* Limb count scales with gravity: more legs to spread the load. */
    const limbs = loco === 'rooted' ? 0 : clamp(Math.round(2 + g * 2 + hashF(h, 7) * 3), 0, 12);
    /* Sensory modality follows what actually propagates on this world. A thin
     * atmosphere carries no sound, so those creatures are not deaf by fiat —
     * they simply never evolved hearing. */
    const senses = [];
    if (p.flux > 0.15) senses.push('photic');
    if (p.pressure > 0.1) senses.push('acoustic');
    if (p.magnetosphere > 0.4 && hashF(h, 8) > 0.6) senses.push('magnetic');
    if (hashF(h, 9) > 0.5) senses.push('chemical');
    if (p.flux < 0.2 || biomeId === 'ocean') senses.push('electric');

    return {
      hash: h,
      massKg, heightM: height, limbs, plan, locomotion: loco, senses,
      /* Metabolic rate follows Kleiber's law, M^0.75, scaled by temperature. */
      metabolism: Math.pow(massKg, 0.75) * clamp(p.surfaceTemp / 288, 0.2, 3),
      /* Encephalisation — the precursor to sapience, and what the player is
       * looking for when hunting for a mind worth inhabiting. */
      encephalisation: clamp01(bio.complexity * (0.2 + hashF(h, 10) * 1.3) - 0.15),
      diet: hashF(h, 11) > 0.62 ? 'predator' : hashF(h, 11) > 0.28 ? 'grazer' : 'detritivore',
      hue: (RS.planet.BIOME_BY_ID[biomeId] ? RS.planet.BIOME_BY_ID[biomeId].hue : 120) + (hashF(h, 12) * 60 - 30),
      name: faunaName(h)
    };
  }

  const F_A = ['grel', 'thi', 'oss', 'vun', 'mara', 'kesh', 'ply', 'dorn', 'sith', 'yala'];
  const F_B = ['-strider', '-clutch', '-drift', '-maw', ' wretch', ' bloom', '-crawler', ' herald', '-sift', ' warden'];
  function faunaName(h) {
    return (F_A[hashN(h, 20) % F_A.length] + F_B[hashN(h, 21) % F_B.length])
      .replace(/^./, c => c.toUpperCase());
  }

  RS.civ = {
    logistic, ramp, STAGES, stageOf, biosphereOf, oxygenate,
    TECH_TIERS, techTierOf, DISPOSITIONS, civOf, cultureName,
    COMMODITIES, COMM_BY_ID, marketOf, routesBetween, systemTrade,
    BODY_PLANS, LOCOMOTION, faunaAt
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
