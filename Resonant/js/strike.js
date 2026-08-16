/* Resonant — striking, and the combo that grows out of it.
 *
 * ── Why the game needed a click at all ────────────────────────────────────
 *
 * The core loop is a *hold*: line up four dials and keep them there while
 * coherence fills. That is the right core, and it is deliberately not a clicker
 * — everything in feel.js and audio.js is arranged around a ramp that builds and
 * releases, and tap-to-collect would throw all of it away.
 *
 * But a hold has one dead spot. Once the dials are on a node there is nothing to
 * *do* for the two to six seconds it takes, and the hardest layers are the ones
 * where you sit longest. The game had no way to spend attention you already had.
 *
 * A strike is that. It is not an alternative to holding — you cannot strike a
 * node you are not already locked onto, and a strike on a badly aligned node is
 * worth nothing and costs you your combo. It is a way of pushing a hold you are
 * already winning, and its whole skill is *when*.
 *
 * ── When ──────────────────────────────────────────────────────────────────
 *
 * Quality is alignment × gate, sampled the instant you strike. Which means:
 *
 *   - In an ungated layer, strike whenever the lock is tight. Easy, and worth
 *     the least.
 *   - In a gated layer, strike inside the open window — and the window's rhythm
 *     is the essence's `branching`, which you already know how to read. A
 *     Cascade gives you five narrow chances a bar; a Lattice gives one wide one.
 *   - While a twin is uncollapsed, strikes are worth less, because you do not
 *     yet know which one you are hitting.
 *
 * So the click mechanic is not bolted on: it reads the same primitives
 * everything else does, and a player who has learned an essence already knows
 * how to strike it.
 *
 * ── The combo, and why it is deliberately not outrageous ──────────────────
 *
 * Consecutive clean strikes build a combo. The multiplier is **logarithmic**:
 *
 *     ×(1 + RESONANCE · ln(1 + combo))
 *
 * At the base rate that is ×1.6 at ten, ×2.0 at fifty, ×2.4 at three hundred. It
 * is genuinely cumulative — there is no point at which more stops helping — and
 * it never runs away, because doubling a combo adds a constant rather than a
 * factor. An exponential combo would make the first hour irrelevant and the
 * fifth hour absurd; a linear one would need a cap, and a cap is a wall you can
 * see. A log curve needs neither.
 *
 * It is also capped anyway, at COMBO_MAX_MUL, because a curve with no ceiling is
 * a promise you have not checked.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp } = RS.core;

  /* Quality thresholds. Below `KEEP` a strike breaks the combo; above `CLEAN`
   * it advances it; between, it holds. Three outcomes rather than two, because
   * "you did not lose it" is the feedback that keeps someone playing a layer
   * they have not mastered. */
  const CLEAN = 0.82;
  const KEEP = 0.50;

  /* How much of a node's remaining coherence one clean strike is worth, before
   * upgrades. Deliberately small: a strike is a push, not a shortcut, and at
   * base you cannot finish a node by striking alone. */
  const BASE_PUSH = 0.085;

  /* The combo window, in seconds. Constant rather than shrinking with the
   * combo, because a window that closes as you get better is a punishment for
   * getting better. */
  const BASE_WINDOW = 2.6;

  /* The log coefficient, and the ceiling that keeps the promise honest. */
  const BASE_RESONANCE = 0.26;
  const COMBO_MAX_MUL = 3.2;

  /* Strikes are rate-limited so that mashing is strictly worse than timing.
   * The limit is generous enough never to be felt by someone playing properly
   * and tight enough that an auto-clicker gains nothing. */
  const COOLDOWN = 0.22;

  /* What each successive strike on the same node is worth, relative to the one
   * before. Geometric, so the total is bounded: see the push. */
  const FATIGUE = 0.72;

  /* The most a node can ever be pushed by striking, at a given per-strike
   * value. Exported because it is the number the balance claim rests on. */
  function ceilingFor(push) { return push / (1 - FATIGUE); }

  function newState() {
    return {
      combo: 0,
      best: 0,
      /* Seconds left on the window. Rendered as a ring, so the pressure is
       * visible rather than remembered. */
      window: 0,
      cooldown: 0,
      /* Last strike's quality and verdict, for the HUD's one-frame flash. */
      lastQuality: 0,
      lastVerdict: '',
      lastAt: -99,
      /* Lifetime counters, for the stats panel and for upgrade gating. */
      strikes: 0, cleans: 0, breaks: 0
    };
  }

  /* ── Upgrades ─────────────────────────────────────────────────────────────
   *
   * Three, because there are exactly three things a player can want from this
   * and they trade against each other: hit harder, hold the combo longer, or
   * make the combo worth more. Priced on the same geometric curve the dials
   * use, so the whole economy has one shape.
   */
  const UPGRADES = [
    {
      id: 'strike', name: 'Strike', glyph: '✦', hue: 43, max: 20,
      blurb: 'How much a clean strike pushes a lock.',
      base: 260, growth: 1.62,
      /* +9% of base per level, so a fully-upgraded strike is worth about
       * two and a half times a bare one — meaningful, and still not a way to
       * finish a node without holding it. */
      value: lv => BASE_PUSH * (1 + lv * 0.09),
      format: lv => (BASE_PUSH * (1 + lv * 0.09) * 100).toFixed(1) + '% per strike'
    },
    {
      id: 'tempo', name: 'Tempo', glyph: '◷', hue: 187, max: 14,
      blurb: 'How long a combo survives between strikes.',
      base: 340, growth: 1.70,
      value: lv => BASE_WINDOW * (1 + lv * 0.11),
      format: lv => (BASE_WINDOW * (1 + lv * 0.11)).toFixed(1) + ' s window'
    },
    {
      id: 'resonance', name: 'Resonance', glyph: '◈', hue: 320, max: 16,
      blurb: 'How steeply the combo multiplier climbs. Logarithmic — it never runs away.',
      base: 520, growth: 1.78,
      value: lv => BASE_RESONANCE * (1 + lv * 0.10),
      format: lv => '×' + mulFor(BASE_RESONANCE * (1 + lv * 0.10), 50).toFixed(2) + ' at 50 combo'
    }
  ];
  const UP_BY_ID = Object.create(null);
  for (const u of UPGRADES) UP_BY_ID[u.id] = u;

  function levelOf(game, id) { return (game.strikeLevels && game.strikeLevels[id]) || 0; }
  function valueOf(game, id) { return UP_BY_ID[id].value(levelOf(game, id)); }

  function costOf(game, id) {
    const u = UP_BY_ID[id];
    const lv = levelOf(game, id);
    if (lv >= u.max) return Infinity;
    return Math.round(u.base * Math.pow(u.growth, lv));
  }

  function buy(game, bus, id) {
    const u = UP_BY_ID[id];
    if (!u) return { ok: false, reason: 'unknown' };
    const cost = costOf(game, id);
    if (!Number.isFinite(cost)) return { ok: false, reason: 'maxed' };
    if (game.insight < cost) return { ok: false, reason: 'insufficient', cost };
    game.insight -= cost;
    game.strikeLevels[id] = levelOf(game, id) + 1;
    if (bus) bus.emit('strike:upgrade', { id, level: game.strikeLevels[id], cost });
    return { ok: true };
  }

  /* The multiplier itself. Separate from `game` so the upgrade panel can show
   * what a level would be worth before it is bought. */
  function mulFor(resonance, combo) {
    return Math.min(COMBO_MAX_MUL, 1 + resonance * Math.log(1 + Math.max(0, combo)));
  }

  function multiplier(game) {
    const st = game.strike;
    if (!st) return 1;
    return mulFor(valueOf(game, 'resonance'), st.combo);
  }

  /* ── The strike ───────────────────────────────────────────────────────────
   *
   * Returns a verdict rather than a boolean, because every one of the four
   * outcomes needs different feedback and the caller should not have to infer
   * which it got.
   */
  function strike(game, bus, node) {
    const st = game.strike;
    if (!st) return { verdict: 'none' };

    if (st.cooldown > 0) return { verdict: 'early' };
    if (!node || node.dying || node.crystallised) {
      /* Striking nothing is not a mistake, it is a miss — it should not cost a
       * combo you earned. Punishing an empty click teaches people not to
       * explore. */
      return { verdict: 'miss' };
    }

    st.cooldown = COOLDOWN;
    st.strikes++;

    /* Quality is what the primitives say, at this instant. `gate` is the
     * rhythm; the twin drag is the uncertainty of hitting a double you have not
     * resolved yet. */
    let q = clamp01(node.rawAlign || 0) * clamp01(node.gate);
    if (node.twinInfo && !node.collapsed && !node.twinReal) q *= 0.45;
    if (node.blocked) q *= 0.2;

    st.lastQuality = q;
    st.lastAt = game.stats.playSeconds;

    let verdict;
    if (q >= CLEAN) {
      verdict = 'clean';
      st.combo++;
      st.cleans++;
      if (st.combo > st.best) st.best = st.combo;
      st.window = valueOf(game, 'tempo');
    } else if (q >= KEEP) {
      verdict = 'held';
      /* Holds refresh the window but do not advance the count, so a player who
       * is nearly there keeps what they have while the ceiling stays honest. */
      st.window = valueOf(game, 'tempo');
    } else {
      verdict = 'broke';
      if (st.combo > 0) st.breaks++;
      st.combo = 0;
      st.window = 0;
    }
    st.lastVerdict = verdict;

    /* The push. Scaled by quality, so a barely-clean strike is worth less than
     * a perfect one and there is headroom above the threshold to aim at — and
     * by FATIGUE, which is the rule that keeps the hold load-bearing.
     *
     * Each strike on the *same node* is worth FATIGUE of the last. Geometric,
     * so the total a node can ever be pushed is `push / (1 - FATIGUE)` — about
     * 85% of a lock even with the upgrade maxed, and a third of one at base.
     * Striking therefore accelerates a hold and can never replace it, which
     * matters because the hold is the game and a click that trivialises it
     * would be a worse game wearing a busier one's clothes.
     *
     * It is also the better mechanic on its own terms: without it the optimal
     * play is to find one node and mash it, and with it you are pushed across
     * the whole field — which is what the combo wanted from you anyway. */
    let pushed = 0;
    if (verdict !== 'broke' && !node.crystallised) {
      node.struck = (node.struck || 0) + 1;
      const fatigue = Math.pow(FATIGUE, node.struck - 1);
      pushed = valueOf(game, 'strike') * q * fatigue * (verdict === 'clean' ? 1 : 0.45);
      node.coherence = clamp01(node.coherence + pushed);
      /* Effort is what the payout reads, and a strike is effort — otherwise
       * striking a node would make it pay *less* by shortening the hold. */
      node.effort += pushed * RS.field.holdTimeOf(node) * 0.7;
    }

    if (bus) {
      bus.emit('strike', {
        node, verdict, quality: q, pushed,
        combo: st.combo, multiplier: multiplier(game)
      });
    }
    return { verdict, quality: q, pushed, combo: st.combo };
  }

  /* Decay. The window is the only thing that expires; the combo itself is not
   * eroded, it is dropped, because a number that ticks down while you watch is
   * a different and much worse feeling than one that is there until it is not. */
  function tick(game, bus, dt) {
    const st = game.strike;
    if (!st) return;
    if (st.cooldown > 0) st.cooldown = Math.max(0, st.cooldown - dt);
    if (st.combo > 0 || st.window > 0) {
      st.window -= dt;
      if (st.window <= 0) {
        st.window = 0;
        if (st.combo > 0) {
          const lost = st.combo;
          st.combo = 0;
          if (bus) bus.emit('strike:lapse', { lost });
        }
      }
    }
  }

  /* For the HUD: how full the window ring is, 0..1. */
  function windowFrac(game) {
    const st = game.strike;
    if (!st || st.combo <= 0) return 0;
    const full = valueOf(game, 'tempo');
    return clamp01(st.window / Math.max(0.001, full));
  }

  RS.strike = {
    CLEAN, KEEP, BASE_PUSH, BASE_WINDOW, BASE_RESONANCE, COMBO_MAX_MUL, COOLDOWN,
    FATIGUE, ceilingFor,
    UPGRADES, UP_BY_ID, newState, levelOf, valueOf, costOf, buy,
    mulFor, multiplier, strike, tick, windowFrac
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
