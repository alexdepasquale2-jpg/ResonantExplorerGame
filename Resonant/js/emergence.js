/* Resonant — the six primitives.
 *
 * ── The whole design in one paragraph ─────────────────────────────────────
 *
 * There are no per-layer minigames in this game. There are six functions, and
 * every mechanic anywhere is one or more of them, parameterised by the four
 * numbers an essence carries (fractal.js) and scaled by the local clock
 * (cosmos.js). A band declares which primitives are live (spectrum.js). A tier
 * declares how fast and how they are drawn.
 *
 *     64 authored numbers  ×  6 functions  =  1536 distinct situations
 *
 * ── Why this and not twelve hand-written modes ────────────────────────────
 *
 * Because the player has to be able to *transfer knowledge*, and that only
 * works if the world is actually generated from a small seed. Once you learn
 * that Cascade branches (branching 0.9), you know — without being told, and
 * without ever having played there — that its rhythm subdivides five ways, its
 * dependency graph fans out four wide, its nests are wide and shallow, and its
 * gradient sprays rather than converges. In every layer. At every scale.
 *
 * That is the premise ("one body of information, rendered differently by local
 * rules") stated as executable code rather than as flavour text. Hand-written
 * modes cannot do it: twelve authored minigames have twelve unrelated rule
 * sets, and nothing a player learns in one predicts anything in another.
 *
 * ── Contract ──────────────────────────────────────────────────────────────
 *
 * Every function here is pure, allocation-free (writes into a caller-owned
 * `out`), finite for all 20 essences × 22 tiers, and reads *all four* axes so
 * no essence is inert in any primitive. They are called per node per frame, so
 * they must stay cheap — no trigonometry beyond one sin/cos, no allocation.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, TAU } = RS.core;

  /* Guard: primitives are called with whatever essence a cell resolved to, and
   * a missing axis must degrade rather than produce NaN and poison a node's
   * position for the rest of the session. */
  function axes(ess) {
    return {
      c: ess && typeof ess.complexity === 'number' ? clamp01(ess.complexity) : 0.5,
      b: ess && typeof ess.branching === 'number' ? clamp01(ess.branching) : 0.3,
      s: ess && typeof ess.symmetry === 'number' ? clamp01(ess.symmetry) : 0.5,
      p: ess && typeof ess.persistence === 'number' ? clamp01(ess.persistence) : 0.5
    };
  }

  // ── GATE ─────────────────────────────────────────────────────────────────
  /* Something is available only sometimes.
   *
   * `persistence` sets how long a cycle lasts, `branching` how many times it
   * subdivides inside that cycle, `symmetry` how much of it is open. Scaled by
   * the tier's clock — so the *same* essence in the *same* band is a tight
   * pulse at the cellular scale and a slow vast one at the supercluster scale,
   * for free.
   *
   * The subdivision is what makes this recognisable: Cascade (branching 0.9)
   * gives a five-stroke burst, Lattice (branching 0) gives one even beat. A
   * player hears the difference before they read the name. */
  /* The tier clock spans 34.0 (Planck) to 0.02 (ensemble) — a factor of 1700.
   * Used raw that is a 2 ms strobe at one end and a 160 s wait at the other,
   * and neither is a game. Raising it to the 0.6 power keeps the whole ordering
   * (small is always faster than large) and the *feeling* of tempo while
   * shrinking the span to about 85×; the stroke clamp below closes the rest,
   * leaving a range a player can actually live inside. */
  const TEMPO_EXP = 0.6;
  /* No stroke is shorter than a sixth of a second (below that the gate is a
   * flicker rather than a rhythm) or longer than four (above that waiting for
   * the window stops being a decision). */
  const STROKE_MIN = 0.16, STROKE_MAX = 4.0;

  function GATE(ess, scale, t, out) {
    const o = out || {};
    const a = axes(ess);
    const tempo = Math.pow(Math.max(1e-3, RS.cosmos.clockAt(scale)), TEMPO_EXP);

    const subdiv = 1 + Math.round(a.b * 4);
    const duty = lerp(0.25, 0.75, a.s);

    /* Phase within the current subdivision. Each stroke is `period/subdiv`
     * long and open for `duty` of it. */
    const strokeLen = clamp(lerp(0.35, 3.2, a.p) / tempo / subdiv, STROKE_MIN, STROKE_MAX);
    const period = strokeLen * subdiv;
    const phase = ((t % strokeLen) + strokeLen) % strokeLen / strokeLen;

    /* Soft edges rather than a square wave — a hard gate is unplayable because
     * there is no warning, and the ramp is what makes the rhythm readable. */
    const edge = 0.12;
    let open;
    if (phase < edge) open = phase / edge;
    else if (phase < duty - edge) open = 1;
    else if (phase < duty) open = (duty - phase) / edge;
    else open = 0;

    o.open = clamp01(open);
    o.period = period;
    o.subdiv = subdiv;
    o.duty = duty;
    o.strokeLen = strokeLen;
    o.phase = phase;
    /* Time until the next opening edge — what a rhythm HUD counts down. */
    o.nextEdge = phase < duty ? (strokeLen - phase * strokeLen) : (1 - phase) * strokeLen;
    /* Which stroke of the bar we are on, so a HUD can show the pattern. */
    o.stroke = Math.floor((t % period) / strokeLen);
    return o;
  }

  // ── NEST ─────────────────────────────────────────────────────────────────
  /* Something contains a smaller version of itself.
   *
   * `complexity` sets how deep, `branching` how wide, `symmetry` how much
   * smaller each level is. Emergence (complexity 1.0) nests five deep; Void
   * (0.15) does not nest at all, which is exactly what "the absence that gives
   * everything else its shape" should do. */
  function NEST(ess, out) {
    const o = out || {};
    const a = axes(ess);
    o.depth = 1 + Math.floor(a.c * 4);
    o.fanout = 1 + Math.round(a.b * 3);
    o.ratio = lerp(0.45, 0.80, a.s);
    /* Total children if fully expanded — the payout ceiling for a descent, and
     * why a wide shallow essence and a narrow deep one are worth different
     * things. */
    o.total = o.fanout === 1 ? o.depth
      : Math.round((Math.pow(o.fanout, o.depth) - 1) / (o.fanout - 1));
    /* How much smaller each level is, compounded — a descent into a symmetric
     * essence stays legible, an asymmetric one shrinks away fast. */
    o.floor = Math.pow(o.ratio, o.depth - 1);
    return o;
  }

  // ── FLOW ─────────────────────────────────────────────────────────────────
  /* Something has a direction to follow.
   *
   * `branching` sets divergence (Seed sprays outward, Attractor converges on a
   * point), `persistence` sets steadiness (Memory holds a gradient still,
   * Threshold flickers). The field is derived from position and time, so it is
   * the same everywhere for the same essence — a gradient you learn to read. */
  function FLOW(ess, x, y, t, out) {
    const o = out || {};
    const a = axes(ess);

    /* Divergence: below 0.5 the field points inward, above it points outward.
     * Attractor (0.0) converges hard; Seed (0.85) sprays. */
    const div = a.b * 2 - 1;
    const d = Math.hypot(x, y) + 1e-5;

    /* A slow rotation whose rate falls with persistence, so a steady essence's
     * gradient is nearly static and a volatile one's swims. */
    const wobble = (1 - a.p) * 1.6;
    const ang = Math.atan2(y, x) + Math.sin(t * wobble + d * 3) * (1 - a.s) * 0.9;

    o.gx = Math.cos(ang) * div;
    o.gy = Math.sin(ang) * div;
    o.divergence = a.b;
    o.steadiness = a.p;
    /* Strength falls off with distance for a converging field and rises for a
     * diverging one, so following it is a real navigation problem either way. */
    o.strength = div < 0 ? clamp01(1 / (0.4 + d)) : clamp01(d * 1.2);
    return o;
  }

  // ── ORDER ────────────────────────────────────────────────────────────────
  /* Something requires another thing first.
   *
   * `branching` sets how many prerequisites, `complexity` how deep the chain
   * runs. Prerequisites are other *essences*, chosen by hash, so the dependency
   * graph is stable and learnable: Cascade always needs the same things, and a
   * player who has satisfied it once knows the shape next time. */
  function ORDER(ess, seed, out) {
    const o = out || {};
    const a = axes(ess);
    const E = RS.fractal.ESSENCES;
    o.fanout = 1 + Math.round(a.b * 3);
    o.depth = 1 + Math.floor(a.c * 3);

    const list = o.prereqs || (o.prereqs = []);
    list.length = 0;
    /* Offset from the essence's own index so nothing depends on itself, and so
     * the graph is a genuine ordering rather than a cycle. */
    for (let i = 0; i < o.fanout; i++) {
      const step = 1 + (RS.core.hashN(seed >>> 0, ess.index, i) % (E.length - 1));
      list.push(E[(ess.index + step) % E.length].id);
    }
    /* Persistence decides whether a satisfied prerequisite *stays* satisfied.
     * A volatile essence's chain has to be re-satisfied; a persistent one's
     * holds, which is the difference between a puzzle and a chore. */
    o.holds = a.p > 0.5;
    o.decay = (1 - a.p) * 0.4;
    return o;
  }

  // ── TWIN ─────────────────────────────────────────────────────────────────
  /* Something exists in two places; one is load-bearing.
   *
   * `symmetry` sets how close the twins sit — and a symmetric essence twins
   * *close and confusingly*, which is the right way round: Duality (symmetry
   * 1.0) is nearly impossible to tell apart, Cascade (0.15) throws its double a
   * long way off. `persistence` sets the `tell`: how much of the time the real
   * one gives itself away, so deduction is possible rather than a coin flip. */
  function TWIN(ess, seed, out) {
    const o = out || {};
    const a = axes(ess);
    o.separation = lerp(0.10, 0.60, 1 - a.s);
    o.tell = a.p;
    /* Which of the pair is real. Stable per address, so a player who works it
     * out and comes back is rewarded rather than re-rolled. */
    o.realIsFirst = (RS.core.hashN(seed >>> 0, 0x7217) & 1) === 0;
    /* How strongly the tell shows. Complexity muddies it — an intricate essence
     * is harder to read even when it is being honest. */
    o.clarity = clamp01(a.p * (1 - a.c * 0.45));
    o.bias = lerp(0.5, 0.85, a.b);
    return o;
  }

  // ── INVERT ───────────────────────────────────────────────────────────────
  /* A rule reads backwards.
   *
   * `persistence` is what resists inversion — Memory and Void (1.0) barely
   * invert at all, Seed (0.10) inverts almost completely. Which axis gets
   * inverted is derived from symmetry, so a given essence always inverts the
   * same way. */
  function INVERT(ess, out) {
    const o = out || {};
    const a = axes(ess);
    o.strength = 1 - a.p;
    /* Symmetric essences invert their *phase*; asymmetric ones invert their
     * *magnitude*. Two genuinely different kinds of backwards. */
    o.axis = a.s > 0.5 ? 'phase' : 'magnitude';
    o.partial = a.c > 0.6;   // complex essences invert only partly — messier
    return o;
  }

  /* Apply an inversion to a 0..1 alignment value. Kept here so every caller
   * inverts the same way. */
  function applyInvert(inv, value) {
    if (!inv || inv.strength <= 0) return value;
    const flipped = 1 - value;
    return lerp(value, inv.partial ? (flipped * 0.7 + value * 0.3) : flipped, inv.strength);
  }

  const BY_ID = { gate: GATE, nest: NEST, flow: FLOW, order: ORDER, twin: TWIN, invert: INVERT };
  const IDS = ['gate', 'nest', 'flow', 'order', 'twin', 'invert'];

  /* Human-readable names, used by the HUD and the guide so a player can learn
   * the vocabulary the game is actually built from. */
  /* Glyphs are deliberately drawn from Geometric Shapes, Arrows and Math
   * Operators only. The more expressive codepoints (⌷ ⧉ ⇴) are missing from
   * most monospace faces and render as tofu, and a HUD legend that shows a row
   * of empty boxes is worse than no legend. */
  const LABELS = {
    gate: { name: 'Gate', glyph: '▮', blurb: 'Available only in windows. Learn the rhythm.' },
    nest: { name: 'Nest', glyph: '◇', blurb: 'Contains smaller copies. Descend for the payout.' },
    /* Displayed as "Gradient", not "Flow". There is an *essence* called Flow,
     * and a codex listing the same word twice for two different things — one of
     * fourteen essences, and one of six primitives — is a legibility problem
     * rather than a coincidence. The id stays `flow` because that is what the
     * band tables and every call site say. */
    flow: { name: 'Gradient', glyph: '≈', blurb: 'Has a direction. Follow it.' },
    order: { name: 'Order', glyph: '→', blurb: 'Needs its antecedents first. Read the graph.' },
    twin: { name: 'Twin', glyph: '◐', blurb: 'Exists twice. One is real — find the tell.' },
    invert: { name: 'Invert', glyph: '○', blurb: 'Reads backwards. Unlearn what you know.' }
  };

  RS.emergence = { GATE, NEST, FLOW, ORDER, TWIN, INVERT, applyInvert, axes, BY_ID, IDS, LABELS };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
