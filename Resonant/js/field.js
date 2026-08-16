/* Resonant — the field. The moment-to-moment game.
 *
 * You are a point at the centre. You cannot move, because a point of
 * consciousness has nowhere to go: what changes is not your position but
 * which information is being rendered to you. Manifestations drift through
 * the field, each carrying a tuning signature, and the loop is:
 *
 *     sweep ──▶ a smudge resolves ──▶ hold four dials on it ──▶ it crystallises
 *
 * ── The four-dial lock ─────────────────────────────────────────────────────
 *
 * Alignment is the product of four Gaussians, one per dial. On its own that
 * would be brutal, so each band declares how much it *demands* of each dial,
 * and the demand ramps with band index. The baryonic layer only really asks
 * for frequency and scale; by the causal layer all four are live and a node
 * exists in one narrow four-dimensional spot. That ramp is the difficulty
 * curve and it is also the tutorial: each new layer introduces exactly one
 * more thing to think about, which is the Spore trick applied to controls
 * rather than to body parts.
 *
 * ── Why hold, and not tap ──────────────────────────────────────────────────
 *
 * Coherence fills while aligned and drains while not. The payoff is gated on
 * a *sustained* state, because tension that builds and then releases is worth
 * far more than an instant reward — everything in feel.js and audio.js is
 * arranged around that ramp: the tone climbs, the beat slows, the ring
 * tightens, and then it breaks. Tap-to-collect would throw all of that away.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, damp, TAU, hashF, hashN, angDelta } = RS.core;

  const FIELD_RADIUS = 1.0;      // normalised; the renderer scales to viewport
  const SPAWN_MARGIN = 1.16;     // nodes are born just outside the visible rim
  const BASE_CAPACITY = 14;

  function newField() {
    return {
      nodes: [],
      /* Per-(tier,band) address stream. Returning to a layer continues its own
       * sequence rather than restarting it, so a place you have worked feels
       * worked. */
      streams: Object.create(null),
      t: 0,
      /* Rhythm time. Advances with the τ dial but *not* with the rung's clock,
       * because GATE derives its own period from the clock and would otherwise
       * be scaled by it twice. */
      rt: 0,
      /* essenceId → field.t at which it was last crystallised. This is the
       * state the ORDER primitive reads, and it is why the causal layers are a
       * graph you work rather than a queue you drain. */
      satisfied: Object.create(null),
      tierIndex: RS.cosmos.ROOT_INDEX,
      bandIndex: 0,
      /* Rises when the rendered reality changes out from under the player;
       * the renderer uses it to tear the old layer apart and re-form. */
      upheaval: 0,
      lastTierIndex: RS.cosmos.ROOT_INDEX,
      lastBandIndex: 0,
      spawnAcc: 0,
      /* Causal layer bookkeeping: the essence most recently crystallised, which
       * is what unblocks its dependents. */
      lastCrystal: null
    };
  }

  function streamKey(t, b) { return t + ':' + b; }

  function nextAddress(field, tierIndex, bandIndex) {
    const k = streamKey(tierIndex, bandIndex);
    const n = (field.streams[k] = (field.streams[k] || 0) + 1);
    /* Spread the stream over a 2D cell space rather than a line, so the hash
     * inputs vary in both arguments and the essence sequence doesn't fall into
     * a short cycle. */
    return { cellX: n % 977, cellY: Math.floor(n / 977), slot: n % 7 };
  }

  /* Capacity scales with the tier's density — the quantum tiers are crowded,
   * the ensemble tiers nearly empty — and with focus, because a sharper
   * observer resolves more at once. */
  function capacityOf(game) {
    const dens = RS.cosmos.densityAt(game.dials.space.value);
    const foc = RS.dials.observerFocus(game.dials);
    return Math.round(BASE_CAPACITY * dens * (0.7 + foc * 0.9)) + 3;
  }

  // --- demands -------------------------------------------------------------

  /* ── How much each dial matters in a given band ──────────────────────────
   *
   * Derived from the band's primitive set, not hand-tuned. Each primitive
   * genuinely leans on particular dials, and a band demands a dial to the
   * extent that *any* of its live primitives wants it — a probabilistic OR, so
   * two primitives that both want Δ compound rather than average.
   *
   *   gate   wants τ hardest: a rhythm is a thing in time.
   *   flow   wants neither. A gradient is read off φ and Σ alone, which is
   *          exactly why it is the primitive the game opens with — and why it
   *          is also the one that pays out passively.
   *   nest   wants Σ (already always 1) and a little of both others.
   *   order  wants Δ: a sequence is a position in the fourth dimension.
   *   twin   wants Δ: the two halves of a superposition differ by phase.
   *   invert wants everything, moderately.
   *
   * φ and Σ are always fully demanded — they are which layer and which rung,
   * and nothing is legible without them. The consequence is a curve that is
   * *shaped* rather than sloped: Baryonic and Thermal ask for nothing beyond
   * the two dials you start with, Electromagnetic makes τ matter the instant
   * you arrive, Probabilistic does the same for Δ, and Unity asks for all four
   * at once. Each layer introduces the dial its own mechanics need, which is a
   * better tutorial than a ramp because the reason is visible.
   */
  const DIAL_LOAD = {
    gate:   { phase: 0.15, rate: 0.90 },
    flow:   { phase: 0.00, rate: 0.00 },
    nest:   { phase: 0.30, rate: 0.15 },
    order:  { phase: 0.70, rate: 0.35 },
    twin:   { phase: 0.75, rate: 0.20 },
    invert: { phase: 0.60, rate: 0.60 }
  };

  function demandsFor(bandIndex) {
    const band = RS.spectrum.BANDS[bandIndex];
    let pMiss = 1, rMiss = 1;
    if (band) {
      for (let i = 0; i < band.prim.length; i++) {
        const load = DIAL_LOAD[band.prim[i]];
        if (!load) continue;
        pMiss *= 1 - load.phase;
        rMiss *= 1 - load.rate;
      }
    }
    return { freq: 1, tier: 1, phase: clamp01(1 - pMiss), rate: clamp01(1 - rMiss) };
  }

  function gauss(d) { return Math.exp(-d * d); }

  /* A demand-weighted Gaussian: at demand 0 the term is a free 1, at demand 1
   * it is the raw Gaussian, and in between it is softened. */
  function term(d, demand) { return lerp(1, gauss(d), demand); }

  /* The full four-dial alignment for one node, plus the per-axis breakdown the
   * HUD needs to tell the player *which* dial is wrong — a lock they can't
   * diagnose is just noise. */
  function alignmentOf(game, node) {
    const D = game.dials;
    const man = node.man;
    const band = RS.spectrum.BANDS[man.bandIndex];
    const dem = demandsFor(man.bandIndex);

    const fFoc = RS.dials.focusOf(D.frequency);
    const pFoc = RS.dials.focusOf(D.phase);
    const tFoc = RS.dials.focusOf(D.time);
    const sFoc = RS.dials.focusOf(D.space);

    /* Focus widens the window: it buys the ability to *hold* a lock. Reach is
     * bought with range and landing is bought with precision — three upgrades,
     * three genuinely different jobs. */
    const fWin = band.width * 0.34 * (0.5 + 1.25 * fFoc);
    const pWin = 0.62 * (0.42 + 1.30 * pFoc);
    const rWin = 0.62 * (0.42 + 1.35 * tFoc);
    const sWin = 0.46 * (0.55 + 1.05 * sFoc);

    const fd = (D.frequency.value - man.signature) / fWin;
    const pd = angDelta(D.phase.value, man.phase) / pWin;
    const rd = (D.time.value - man.rate) / rWin;
    const sd = (D.space.value - man.tierIndex) / sWin;

    const af = term(fd, dem.freq);
    const ap = term(pd, dem.phase);
    const ar = term(rd, dem.rate);
    const as = term(sd, dem.tier);

    let total = af * ap * ar * as;

    /* Inversion is a *primitive*, not a band. The Null layer runs it on every
     * node, so the layer reads backwards — but by how much is the node's own
     * business: INVERT.strength is 1 - persistence, so a Memory manifesting in
     * the Null layer barely inverts at all and a Seed inverts almost totally.
     * That is the difference between "the null band is the backwards one" and
     * "backwards is a thing essences do, and this band is where they all do
     * it" — the second is learnable, and gnosis on an essence tells you which
     * way its reading will run before you ever tune it. */
    if (RS.spectrum.usesPrim(band, 'invert')) {
      total = RS.emergence.applyInvert(
        RS.emergence.INVERT(man.essence, node.inv || (node.inv = {})), total);
    }

    /* Discrimination degrades as a band runs more primitives at once. With one
     * live you can read exactly what is wrong; with six there is always
     * something partly right and nothing ever fully so, which is precisely
     * what the Unity layer is supposed to feel like. Derived from the count,
     * so it arrives on its own the moment a band gets crowded. */
    const load = RS.spectrum.demandOf(band);
    if (load > 3) {
      const k = clamp01((load - 3) / 3);
      total = lerp(total, 0.45 + total * 0.5, k);
    }

    return { total: clamp01(total), f: af, p: ap, r: ar, s: as, fd, pd, rd, sd, dem };
  }

  // --- spawning ------------------------------------------------------------

  function spawnNode(game, field) {
    const tierIndex = clamp(Math.round(game.dials.space.value), 0, RS.cosmos.TIERS.length - 1);
    /* The first lock is a lesson, not a census. One nearby baryonic node
     * whose φ sits under the default needle — neighbour-band bleed and a rim
     * spawn would make the first sweep a hunt, and the first verb is hold. */
    const lesson = (game.stats.crystals || 0) === 0 && field.bandIndex === 0;
    let bandIndex = lesson ? 0 : field.bandIndex;
    if (!lesson) {
      /* Which layer a node belongs to is biased toward — but not locked to — the
       * band being observed. A quarter of nodes come from neighbouring bands, so
       * the spectrum always feels like it is bleeding at the edges and there is
       * always something just off-tune to chase. */
      const spread = hashF(hashN(game.seed, field.t * 1000 | 0, 3));
      if (spread > 0.78) {
        const dir = spread > 0.89 ? 1 : -1;
        const alt = bandIndex + dir;
        const focus = RS.dials.focusOf(game.dials.frequency);
        if (alt >= 0 && alt < RS.spectrum.BANDS.length &&
            RS.spectrum.BANDS[alt].centre <= game.dials.frequency.max &&
            !RS.spectrum.isGhost(RS.spectrum.BANDS[alt], focus)) bandIndex = alt;
      }
    }

    let addr = nextAddress(field, tierIndex, bandIndex);
    let man = RS.fractal.resolve(game.seed, tierIndex, bandIndex, addr.cellX, addr.cellY, addr.slot);
    if (lesson) {
      const needle = game.dials.frequency.value;
      let best = man, bestErr = Math.abs(man.signature - needle);
      for (let tries = 0; tries < 48 && bestErr > 0.4; tries++) {
        addr = nextAddress(field, tierIndex, bandIndex);
        const cand = RS.fractal.resolve(game.seed, tierIndex, bandIndex, addr.cellX, addr.cellY, addr.slot);
        const err = Math.abs(cand.signature - needle);
        if (err < bestErr) { bestErr = err; best = cand; }
      }
      man = best;
    } else if (RS.fractal.attuneLevel) {
      /* At attunement 3 the field slightly prefers essences you already know.
       * Still hashed — six retries, then whatever the address said. */
      let prefer = false;
      for (let i = 0; i < RS.fractal.ESSENCES.length; i++) {
        if (RS.fractal.attuneLevel(game, RS.fractal.ESSENCES[i].id) >= 3) { prefer = true; break; }
      }
      if (prefer && RS.fractal.attuneLevel(game, man.essence.id) < 3) {
        for (let tries = 0; tries < 6; tries++) {
          addr = nextAddress(field, tierIndex, bandIndex);
          const cand = RS.fractal.resolve(game.seed, tierIndex, bandIndex, addr.cellX, addr.cellY, addr.slot);
          if (RS.fractal.attuneLevel(game, cand.essence.id) >= 3) { man = cand; break; }
        }
      }
    }
    const band = RS.spectrum.BANDS[bandIndex];
    const h = hashN(man.seed, 31);

    const ang = hashF(h, 1) * TAU;
    const rad = lesson ? 0.22 : FIELD_RADIUS * SPAWN_MARGIN;
    /* Nodes drift on slow near-circular paths rather than straight lines —
     * straight lines leave the field too fast to ever be tuned into, and an
     * orbit reads as "this place has structure". The first node is already
     * in the room so the sweep is short. */
    const orbit = lesson ? 0.22 : (0.30 + hashF(h, 2) * 0.62);
    const node = {
      id: 'n' + (game.__nodeSeq = (game.__nodeSeq || 0) + 1),
      man, band,
      ang, rad,
      targetRad: orbit,
      spin: (hashF(h, 3) * 2 - 1) * 0.32 * band.drift,
      bob: hashF(h, 4) * TAU,
      x: Math.cos(ang) * rad, y: Math.sin(ang) * rad,
      age: 0,
      effort: 0,
      rawAlign: 0, observed: 0, struck: 0,
      life: 26 + hashF(h, 5) * 34,
      fade: 0,               // 0..1 presence, springs in and out
      align: 0, alignParts: null,
      coherence: 0,
      resolved: 0,           // 0..1 how much of its identity is legible
      crystallised: false,
      dying: false,
      /* Live primitive state. Every one of these is filled in by
       * `applyPrimitives` from the node's own essence; what is stored here is
       * only the part that cannot be derived — the per-node phase offset that
       * stops a field of gated nodes blinking in lockstep, and the seeds of
       * the geometry. */
      gate: 1,
      gatePhase: hashF(h, 6) * TAU,
      gateInfo: null, flowInfo: null, nestInfo: null,
      orderInfo: null, twinInfo: null, inv: null,
      twinAng: ang + Math.PI * (0.6 + hashF(h, 7) * 0.8),
      twinReal: true, twinSep: 0.3,
      collapsed: false,
      depth: 0,
      parent: null,
      blocked: false,
      orderMet: 0, orderNeed: 0, orderBonus: 1,
      lesson: lesson
    };
    field.nodes.push(node);
    return node;
  }

  /* Recursive layers: crystallising a parent exposes its children, which are
   * resolved from the *same* cell one slot deeper. Descent is the payout. */
  function spawnChildren(game, field, parent) {
    const nest = parent.nestInfo || RS.emergence.NEST(parent.man.essence, {});
    /* Fanout and depth are the essence's, not the band's — so a Cascade nests
     * wide and a Void does not nest at all, in every layer that nests. Capped
     * because a fanout-4 essence at depth 5 is 341 nodes and the frame budget
     * is not a suggestion. */
    const n = clamp(nest.fanout, 1, 3);
    const ratio = nest.ratio;
    if (field.nodes.length + n > capacityOf(game) * 1.7) return;
    for (let i = 0; i < n; i++) {
      const man = RS.fractal.resolve(game.seed, parent.man.tierIndex, parent.man.bandIndex,
        parent.man.cellX, parent.man.cellY, parent.man.slot + 1 + i);
      const h = hashN(man.seed, 53);
      const ang = parent.ang + (i - (n - 1) / 2) * 0.55;
      field.nodes.push({
        id: 'n' + (game.__nodeSeq = (game.__nodeSeq || 0) + 1),
        man, band: parent.band,
        ang, rad: parent.rad,
        targetRad: clamp(parent.targetRad - 0.1, 0.16, 0.95),
        spin: parent.spin * 1.3,
        bob: hashF(h, 4) * TAU,
        x: parent.x, y: parent.y,
        age: 0, effort: 0, rawAlign: 0, observed: 0, struck: 0, life: 22 + hashF(h, 5) * 18,
        fade: 0, align: 0, alignParts: null, coherence: 0, resolved: 0.4,
        crystallised: false, dying: false,
        gate: 1, gatePhase: hashF(h, 6) * TAU,
        gateInfo: null, flowInfo: null, nestInfo: null,
        orderInfo: null, twinInfo: null, inv: null,
        twinAng: ang + Math.PI, twinReal: true, twinSep: 0.3, collapsed: false,
        depth: parent.depth + 1, parent: parent.id, blocked: false,
        orderMet: 0, orderNeed: 0, orderBonus: 1,
        /* Children are worth more the deeper they are, and *how much* more is
         * the essence's shrink ratio: an asymmetric essence's children shrink
         * away fast and pay correspondingly better for being caught.
         *
         * Linear in depth, not exponential. Compounding it made the four
         * nesting layers out-earn every layer above them by an order of
         * magnitude, because descending already pays twice — a chain hands you
         * more crystals *and* hands them to you without a search. The real
         * reward for going deep is the extra nodes; this is the premium for
         * the risk of losing the chain on the way down.
         *
         * And it is split across the brood, which is where `branching` earns
         * its keep: a Cascade is "one event that spends itself buying a
         * thousand others", so its children are many and individually cheap,
         * while a narrow essence's single heir carries the whole premium. Same
         * number, opposite feel, and the player can read which they are in
         * from the axis they already know. */
        bonus: (1 + (parent.depth + 1) * (1 / ratio - 1) * 0.6) * (2 / (1 + n))
      });
    }
  }

  // --- tick ----------------------------------------------------------------

  function tick(game, bus, dt) {
    const field = game.field;
    const D = game.dials;

    /* The local clock. The TIME dial is a multiplier on it, and the tier sets
     * its base rate — so 1× at the Planck tier is nothing like 1× at the
     * supercluster tier, which is the point. */
    const tierClock = RS.cosmos.clockAt(D.space.value);
    const flow = D.time.value * tierClock;
    field.t += dt * Math.abs(flow);
    field.rt += dt * Math.abs(D.time.value);

    const tierIndex = clamp(Math.round(D.space.value), 0, RS.cosmos.TIERS.length - 1);
    const focus = RS.dials.focusOf(D.frequency);
    const spec = RS.spectrum.sample(D.frequency.value, focus, game.__spec || (game.__spec = []));
    const bandIndex = spec.dominant.index;

    /* Reality changing out from under you is an event, not a transition. */
    if (tierIndex !== field.lastTierIndex || bandIndex !== field.lastBandIndex) {
      const bigJump = tierIndex !== field.lastTierIndex;
      field.upheaval = Math.min(1, field.upheaval + (bigJump ? 1 : 0.55));
      bus.emit('field:shift', {
        tierIndex, bandIndex,
        fromTier: field.lastTierIndex, fromBand: field.lastBandIndex,
        big: bigJump
      });
      /* Nodes belonging to the reality you just left do not survive it. They
       * are released rather than deleted so they visibly dissolve. */
      for (const n of field.nodes) {
        if (n.man.tierIndex !== tierIndex) { n.dying = true; }
      }
      field.lastTierIndex = tierIndex;
      field.lastBandIndex = bandIndex;
    }
    field.tierIndex = tierIndex;
    field.bandIndex = bandIndex;
    field.upheaval = damp(field.upheaval, 0, 1.9, dt);

    /* Spawning. Rate follows how much of the spectrum is actually manifesting:
     * tuned to nothing, almost nothing appears, which makes the empty parts of
     * the axis feel genuinely empty rather than merely unrewarding. Until the
     * first crystal there is one node, because a crowded field teaches search
     * before it teaches hold. */
    const cap = ((game.stats.crystals || 0) === 0 && field.bandIndex === 0)
      ? 1 : capacityOf(game);
    const manifestStrength = clamp01(spec.peak);
    field.spawnAcc += dt * (0.55 + manifestStrength * 2.3);
    while (field.spawnAcc >= 1 && field.nodes.length < cap) {
      field.spawnAcc -= 1;
      spawnNode(game, field);
    }
    if (field.spawnAcc > 3) field.spawnAcc = 3;

    const holdRate = 0.55 + RS.dials.observerFocus(D) * 0.85;

    for (let i = field.nodes.length - 1; i >= 0; i--) {
      const n = field.nodes[i];
      const band = n.band;

      n.age += dt;

      // ── presence ──────────────────────────────────────────────────────
      const wantFade = n.dying ? 0 : 1;
      n.fade = damp(n.fade, wantFade, n.dying ? 2.6 : 1.5, dt);
      if (n.dying && n.fade < 0.01) { field.nodes.splice(i, 1); continue; }
      if (!n.dying && n.age > n.life) { n.dying = true; }

      // ── drift ─────────────────────────────────────────────────────────
      /* Orbital motion, scaled by the band's drift character and the local
       * clock. Under negative time it genuinely runs backwards. */
      const sgn = Math.sign(flow) || 1;
      n.ang += n.spin * dt * sgn * (0.6 + band.drift * 0.7);
      n.rad = damp(n.rad, n.targetRad, 0.5, dt);
      /* A slow bob keeps everything alive even when the player is not moving
       * a dial — a still field reads as a broken field. */
      const bobAmt = 0.022 * (1 + band.drift);
      const bx = Math.cos(field.t * 0.7 + n.bob) * bobAmt;
      const by = Math.sin(field.t * 0.53 + n.bob * 1.7) * bobAmt;
      n.x = Math.cos(n.ang) * n.rad + bx;
      n.y = Math.sin(n.ang) * n.rad + by;

      // ── primitives ────────────────────────────────────────────────────
      applyPrimitives(game, field, n, band, dt, sgn);

      // ── alignment ─────────────────────────────────────────────────────
      const a = alignmentOf(game, n);
      n.alignParts = a;
      n.rawAlign = a.total;
      /* A missing antecedent is a wall, so it scores as one. A shut gate is
       * not — it is a window, and windows are handled in the coherence block
       * below where they belong. Folding the gate into alignment punished it
       * twice, once for falling under the threshold and again for the margin
       * it lost above it, which is why a rhythmic layer used to pay a twelfth
       * of a still one for the same attention. */
      let eff = a.total;
      if (n.blocked) eff *= 0.15;
      n.align = damp(n.align, eff, 12, dt);

      /* Time actually spent working this node. Anything the band's primitives
       * do to slow you down — a shut gate, a twin to resolve, a missing
       * antecedent, a gradient carrying it away — shows up here as the gap
       * between how long this took and how long an unobstructed hold would
       * have, and the payout reads it. That is why no primitive needs a
       * hand-written compensation factor: friction pays for itself by
       * definition, and a band can be made harder by composing more
       * primitives without anyone re-opening the yield table.
       *
       * The bar is "clearly working this node", not "somewhere near it".
       * Counting proximity made every node in a slow layer max the multiplier
       * out and stop discriminating, which is the opposite of the point. */
      if (n.align > 0.45) n.effort += dt;

      /* Resolution: a node you are anywhere near begins to become legible.
       * Below that it is an unresolved smudge with no name and no glyph — the
       * fog of war is over *identity*, not position. */
      const wantRes = clamp01((n.align - 0.06) / 0.30);
      n.resolved = damp(n.resolved, Math.max(n.resolved * 0.998, wantRes), 3.2, dt);

      // ── coherence ─────────────────────────────────────────────────────
      if (!n.crystallised) {
        const need = 0.52;
        /* Working an uncollapsed double is slow rather than futile. Zeroing it
         * would deadlock the layer outright: the wrong twin could never build
         * enough coherence to reveal itself, so half of every Probabilistic
         * field would be nodes that could not be taken and could not be told
         * apart from the ones that could. */
        const twinDrag = (n.twinInfo && !n.collapsed && !n.twinReal) ? 0.35 : 1;
        if (n.align > need) {
          /* The gate scales the *rate*, so a shut window costs you the time it
           * is shut and nothing else: your hold parks where it stands rather
           * than unwinding. That makes a rhythmic layer about timing, which is
           * what it is for, instead of about attrition, which it is not. */
          const gain = (n.align - need) / (1 - need) * twinDrag * n.gate;
          const before = n.coherence;
          /* Knowing the shape of an essence (attunement ≥2) slightly speeds
           * the hold you are already winning. Capped at +10% so it never
           * replaces the hold. */
          const att = RS.fractal.attuneLevel ? RS.fractal.attuneLevel(game, n.man.essence.id) : 0;
          const know = att >= 2 ? (1 + Math.min(0.10, (att - 1) * 0.04)) : 1;
          n.coherence = clamp01(n.coherence + gain * holdRate * know * dt / holdTimeOf(n));
          /* Crossing 25/50/75% is worth marking — the ramp needs waypoints or
           * the last second of a long hold feels unearned. */
          for (const mark of [0.25, 0.5, 0.75]) {
            if (before < mark && n.coherence >= mark) {
              bus.emit('node:step', { node: n, mark });
            }
          }
          if (n.coherence >= 1) crystallise(game, bus, field, n);
        } else {
          /* Whether a partial hold survives being interrupted is the *node's*
           * property, not the band's. Persistence is exactly the axis that
           * says "this stays"; the band's drift only amplifies it. So a Memory
           * in the Thermal layer holds on where a Seed in the Baryonic layer
           * bleeds out, and a player who has read those two axes knows which
           * nodes are worth stepping away from. */
          const per = RS.emergence.axes(n.man.essence).p;
          const decay = (0.03 + 0.17 * (1 - per)) * (0.5 + band.drift);
          n.coherence = Math.max(0, n.coherence - decay * dt);
        }
      }
    }

    /* Passive accretion. FLOW is the one primitive that pays without
     * attention — a gradient carries things to you whether or not you are
     * watching — but only where the layer is calm enough for anything to
     * settle, and split between however many primitives are competing for it.
     * Baryonic (one slow flow) is therefore the idle layer; Thermal, which
     * runs the same primitive at four times the drift, pays nothing at all. */
    game.insight += game.passiveRate * dt * passiveShareOf(RS.spectrum.BANDS[bandIndex]);

    if (RS.strike) RS.strike.tick(game, bus, dt);

    updateDerived(game);
  }

  /* The scope multiplier. Kept here rather than in each scope so the payout
   * has exactly one shape, and so a scope that forgets to define one is 1×
   * rather than NaN. */
  function scopeBonus(game) {
    const k = game.scene && game.scene.kind;
    if (k === 'web' && RS.web) return RS.web.bonusFor(game);
    if (k === 'foam' && RS.foam) return RS.foam.bonusFor(game);
    if (k === 'ensemble' && RS.ensemble) return RS.ensemble.bonusFor(game);
    if (k === 'molecular' && RS.molecular) return RS.molecular.bonusFor(game);
    if (k === 'shells' && RS.shells) return RS.shells.bonusFor(game);
    return 1;
  }

  /* What fraction of the idle floor a band pays out. See the call site. */
  function passiveShareOf(band) {
    if (!RS.spectrum.usesPrim(band, 'flow')) return 0;
    return clamp01(1.25 - band.drift) / RS.spectrum.demandOf(band);
  }

  /* Hold time scales with what the node is worth. A common node is a beat; a
   * rare one at a deep layer is a genuine sustained effort, and the audio ramp
   * has room to become an event. */
  function holdTimeOf(n) {
    /* Deliberately *not* discounted by nesting depth. It used to be, and once
     * NEST started paying a derived depth bonus that became triple-dipping —
     * a deep child was worth more, took less time, and arrived without any
     * search — which made the nesting layers out-earn everything above them.
     * The bonus is the payout for descending; the hold is the price. */
    return 1.15 + n.man.potency * 0.42 + n.man.rarity * 0.9;
  }

  /* ── Node behaviour ───────────────────────────────────────────────────────
   *
   * There is no per-band code here, and that is the entire point. A band
   * declares which primitives are live; each primitive is called with the
   * *node's own essence* and the *current rung*, and applies its result. So a
   * single band is already many different things — Electromagnetic is a
   * five-stroke burst when the node is a Cascade and one even beat when it is
   * a Lattice, brisk at the cellular rung and ponderous at the supercluster —
   * and a player who learned Cascade in one band can predict it in every other
   * before they have ever tuned there. Twelve hand-written modes could not do
   * that, because nothing learned in one would say anything about the next.
   */
  function applyPrimitives(game, field, n, band, dt, sgn) {
    const E = RS.emergence;
    const ess = n.man.essence;
    const scale = game.dials.space.value;
    const prim = band.prim;

    n.gate = 1;
    n.blocked = false;

    for (let i = 0; i < prim.length; i++) {
      switch (prim[i]) {

        case 'gate': {
          /* `field.rt` rather than `field.t`: GATE derives its own period from
           * the rung's clock, so feeding it a clock-scaled time would count the
           * scale twice and freeze the deep tiers solid. The τ dial still
           * drives it — pushing time makes the window flicker faster, which is
           * the one place where a high throttle genuinely costs you. */
          const g = E.GATE(ess, scale, field.rt + n.gatePhase, n.gateInfo || (n.gateInfo = {}));
          n.gate *= g.open;
          break;
        }

        case 'flow': {
          /* The gradient moves the node rather than the player: a divergent
           * essence climbs away from you and a convergent one falls inward,
           * so "follow the flow" is a real tracking problem whose difficulty
           * is the essence's branching number. */
          const f = E.FLOW(ess, n.x, n.y, field.t, n.flowInfo || (n.flowInfo = {}));
          const d = Math.hypot(n.x, n.y) + 1e-4;
          const radial = (f.gx * n.x + f.gy * n.y) / d;
          const tangent = (f.gy * n.x - f.gx * n.y) / d;
          if (!n.lesson) {
            n.targetRad = clamp(n.targetRad + radial * f.strength * dt * 0.30 * sgn, 0.16, 1.08);
          }
          n.spin = clamp(n.spin + tangent * dt * 0.55 * sgn, -0.95, 0.95);
          break;
        }

        case 'nest': {
          /* No motion of its own — it decides what crystallising this node
           * exposes, and how much the descent is worth. */
          n.nestInfo = E.NEST(ess, n.nestInfo || {});
          break;
        }

        case 'order': {
          /* A node cannot be held until its antecedents have been. They are
           * other essences, derived from this one, so the layer is a
           * dependency graph you read and satisfy — and because ORDER.holds is
           * the essence's persistence, a persistent essence's chain stays
           * satisfied while a volatile one's has to be kept alive. */
          const o = E.ORDER(ess, n.man.seed, n.orderInfo || (n.orderInfo = {}));
          let met = 0, firstMissing = null;
          for (let k = 0; k < o.prereqs.length; k++) {
            const id = o.prereqs[k];
            if (holdsAntecedent(game, o, id)) met++;
            else if (!firstMissing) firstMissing = RS.fractal.ESSENCE_BY_ID[id];
          }
          n.orderMet = met;
          n.orderNeed = o.prereqs.length;
          n.antecedent = firstMissing || RS.fractal.ESSENCE_BY_ID[o.prereqs[0]];
          /* One satisfied antecedent unblocks; satisfying the rest is worth
           * paying for. A wall that needs all four at once would just be a
           * wall. */
          n.blocked = met === 0;
          n.orderBonus = 1 + (met - 1) * 0.55;
          break;
        }

        case 'twin': {
          /* Two positions, one load-bearing. Symmetry decides how close the
           * pair sits (a symmetric essence twins confusingly close),
           * persistence decides how much of the time the real one gives itself
           * away, and sustained attention collapses the pair — observation is
           * the mechanic rather than a metaphor. */
          const w = E.TWIN(ess, n.man.seed, n.twinInfo || (n.twinInfo = {}));
          n.twinReal = w.realIsFirst;
          n.twinAng += n.spin * dt * 0.6 * sgn;
          n.twinSep = w.separation;
          /* Collapse is driven by *observation*, not by coherence. Keying it
           * to coherence made it circular — the decoy's penalty is exactly
           * what stopped it accumulating the coherence that would have
           * revealed it as the decoy. Attention is the mechanic here, so
           * attention is what has to pay for it. How long it takes is the
           * essence's clarity: a persistent, simple essence gives itself away
           * almost at once, an intricate volatile one makes you stare. */
          if (!n.collapsed) {
            n.observed = (n.observed || 0) + (n.rawAlign > 0.45 ? dt : -dt * 0.7);
            if (n.observed > lerp(2.6, 0.5, w.clarity)) n.collapsed = true;
            else if (n.observed < 0) n.observed = 0;
          }
          break;
        }

        case 'invert': {
          /* Read by `alignmentOf`. Held on the node so the HUD can mirror the
           * reticle for exactly the nodes whose scoring actually runs
           * backwards, which is not all of them. */
          n.inv = E.INVERT(ess, n.inv || {});
          break;
        }
      }
    }
  }

  /* How long an unsatisfied-by-nature antecedent stays satisfied. Only applies
   * to essences whose persistence is below half — everything else holds. */
  const ORDER_WINDOW = 14;

  /* Is one antecedent currently held? Shared with the HUD so the dependency
   * graph a player reads is the same predicate the simulation enforces — two
   * copies of this rule would eventually disagree, and a puzzle whose display
   * lies about its own state is worse than no display. */
  function holdsAntecedent(game, o, id) {
    const stamp = game.field.satisfied[id];
    /* Two ways to hold an antecedent, and the second is the whole point of the
     * game: you have crystallised it here, recently — or you *understand* it,
     * from having met it anywhere else in the cosmos. Gnosis earned at the
     * cellular scale in the Thermal layer unblocks a dependency in the Causal
     * layer at the supercluster scale, because it is the same essence and the
     * ledger knows it. */
    if (stamp !== undefined && (o.holds || game.field.t - stamp < ORDER_WINDOW)) return true;
    return RS.fractal.gnosisOf(game, id) > 0;
  }

  function crystallise(game, bus, field, n) {
    n.crystallised = true;
    n.coherence = 1;
    n.dying = true;

    const man = n.man;
    const band = RS.spectrum.BANDS[man.bandIndex];
    const tier = RS.cosmos.TIERS[man.tierIndex];

    /* Payout. Every multiplier here is knowledge the player earned rather than
     * a number that went up on its own: the band they reached, the distance
     * from the root they are holding, and how well they understand this
     * particular essence across the whole ladder. */
    const gnosisMul = RS.fractal.gnosisBonus(game, man.essence.id);
    const depthMul = 1 + RS.cosmos.depthFromRoot(man.tierIndex) * 0.09;
    const nestMul = n.bonus || 1;
    /* Satisfying more antecedents than the one you needed pays for it. */
    const orderMul = n.orderBonus > 1 ? n.orderBonus : 1;
    /* Paid for the hold, not for the click. A node that took three times as
     * long to bring in — because its layer gated, or its double had to be
     * resolved first, or its antecedents were missing — is worth three times
     * as much. This is the whole balance mechanism for the primitives: every
     * friction they impose compensates itself, so a band can be made harder by
     * composing more of them without anyone having to re-tune a yield table.
     * Clamped at both ends so a node collected instantly still pays something
     * and a node left simmering all session is not a farm. */
    const effortMul = clamp(n.effort * 1.4 / holdTimeOf(n), 0.75, 8);
    /* What the layer charges you in throughput, paid back per crystal. */
    const frictionMul = RS.spectrum.frictionOf(band);
    /* And what the *scope* is worth. Each scope that has an only-here reason
     * to be worked declares its own multiplier — the Cosmic Web pays for
     * catching a filament while it assembles and for reaching past the
     * horizon, the Quantum Foam pays for a fluctuation that never cancelled.
     * Absent anywhere without one, so no scope has to opt out. */
    const scopeMul = scopeBonus(game);
    /* The combo. Logarithmic and capped, so it is genuinely cumulative and
     * never runs away — see strike.js for why that shape and not another. */
    const comboMul = RS.strike ? RS.strike.multiplier(game) : 1;
    const amount = man.potency * band.yield * gnosisMul * depthMul *
      nestMul * orderMul * effortMul * frictionMul * scopeMul * comboMul * game.yieldMul;

    game.insight += amount;
    game.stats.crystals++;
    game.stats.bestSingle = Math.max(game.stats.bestSingle, amount);

    /* Discovery bookkeeping — this is what fills in the map. */
    const firstBand = !game.known.bands[band.id];
    const firstTier = !game.known.tiers[tier.id];
    game.known.bands[band.id] = true;
    game.known.tiers[tier.id] = true;

    const rec = RS.fractal.recognise(game, man);
    field.lastCrystal = man.essence.id;
    /* Stamped rather than replaced: ORDER reads the whole ledger, so a player
     * who has recently worked several essences is holding several keys at once
     * and can attack the dependency graph from wherever it is thinnest. */
    field.satisfied[man.essence.id] = field.t;

    bus.emit('node:crystallise', {
      node: n, amount, man, band, tier,
      recognition: rec, firstBand, firstTier
    });
    /* Scope consequence. Guarded inside `expressFrom`, which returns
     * immediately anywhere but the Cellular scope — the field does not need to
     * know which scopes have hooks, only that it should offer the event. */
    if (RS.cellular) RS.cellular.expressFrom(game, bus, man);

    if (firstBand) bus.emit('discover:band', { band });
    if (firstTier) bus.emit('discover:tier', { tier });
    if (rec.fresh) bus.emit('discover:gnosis', { essence: man.essence, level: rec.level, man });

    if (RS.spectrum.usesPrim(band, 'nest') && n.nestInfo &&
        n.depth + 1 < Math.min(n.nestInfo.depth, 5)) {
      spawnChildren(game, field, n);
    }
  }

  /* Aggregates the HUD and the economy read every frame. */
  function updateDerived(game) {
    let best = null;
    for (const n of game.field.nodes) {
      if (n.dying || n.crystallised) continue;
      if (!best || n.align > best.align) best = n;
    }
    game.focusNode = best;

    /* Passive income is a function of how much of the ladder has been opened —
     * an idle floor that grows as the game does, so returning after a while is
     * always worth something. */
    const bands = Object.keys(game.known.bands).length;
    const tiers = Object.keys(game.known.tiers).length;
    const extract = (RS.influence && RS.influence.extractorRate)
      ? RS.influence.extractorRate(game) : 0;
    /* Extractors were marking the world and never paying. The idle floor is
     * knowledge plus what you sited; upkeep still gates placement, it does
     * not debit the stream. */
    game.passiveRate = (bands * 0.22 + tiers * 0.14) *
      (1 + RS.fractal.totalGnosis(game) * 0.03) + extract;
  }

  /* Offline accrual, applied once on load. Capped so the game is never better
   * played by not playing it. */
  function applyOffline(game, seconds) {
    const capped = Math.min(seconds, 8 * 3600);
    const gained = game.passiveRate * capped * 0.4;
    if (gained > 0.5) game.insight += gained;
    return { seconds: capped, gained };
  }

  RS.field = {
    FIELD_RADIUS, newField, tick, alignmentOf, demandsFor, capacityOf,
    holdTimeOf, spawnNode, applyOffline, updateDerived,
    applyPrimitives, passiveShareOf, holdsAntecedent, scopeBonus, DIAL_LOAD, ORDER_WINDOW
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
