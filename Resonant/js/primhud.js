/* Resonant — one readout per primitive, not one per layer.
 *
 * ── Why this file is organised by primitive ───────────────────────────────
 *
 * Because that is how the game is organised. There is no Electromagnetic HUD;
 * there is a GATE readout, and the Electromagnetic layer happens to run GATE.
 * When the Noetic layer runs GATE too, it gets the same readout, and a player
 * who learned to read a rhythm bar in the third layer can read one in the
 * tenth without being taught twice. A per-band HUD would have to re-teach the
 * same idea twelve times and would still leave Unity — which runs all six —
 * with nothing coherent to draw.
 *
 * ── The ghost ─────────────────────────────────────────────────────────────
 *
 * Every readout here draws twice: the *measured* behaviour solid, and behind
 * it, faint, the behaviour `fractal.predicted()` says this essence should
 * have, from whatever axes gnosis has revealed. Early on the ghost is absent
 * or wrong and you play by looking. Later the ghost lands exactly on the real
 * thing before it happens, and you are playing by knowing.
 *
 * That gap closing is the reward the gnosis ledger has been building toward,
 * and it is a thing you *see* rather than a percentage in a menu.
 *
 * ── Cost ──────────────────────────────────────────────────────────────────
 *
 * Drawn only for the focus node, only for that node's band's primitives — so
 * at most six short rows, once a frame. Scratch objects are module-level and
 * reused; nothing here allocates.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, hsl, TAU } = RS.core;

  /* Reused scratch. These are written by the primitives every frame and never
   * escape this module. */
  const _pred = {};
  const _real = {};
  const _predEss = {};

  const ROW_H = 15;
  const ROW_W = 132;

  /* An essence with only the axes gnosis has revealed, so a primitive fed with
   * it produces the player's *belief* about what is coming. */
  function beliefOf(game, ess) {
    return RS.fractal.predictedEssence(game, ess.id, _predEss);
  }

  function label(ctx, x, y, text, hue, alpha) {
    ctx.fillStyle = hsl(hue, 0.35, 0.72, alpha);
    ctx.font = '9px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  // ── GATE: a rhythm bar ───────────────────────────────────────────────────
  /* The bar is one full period; the lit blocks are the open strokes. A Cascade
   * shows five narrow strokes, a Lattice one wide one, and the moving needle
   * says where in the bar you are. The ghost strokes behind are the predicted
   * subdivision — get `branching` revealed and you know the pattern of a layer
   * you have never heard. */
  function gate(ctx, game, n, x, y, w, hue, alpha) {
    const scale = game.dials.space.value;
    const t = game.field.rt + n.gatePhase;
    const g = RS.emergence.GATE(n.man.essence, scale, t, _real);
    const p = RS.emergence.GATE(beliefOf(game, n.man.essence), scale, t, _pred);

    const h = 6;
    ctx.fillStyle = hsl(hue, 0.3, 0.35, alpha * 0.30);
    ctx.fillRect(x, y - h / 2, w, h);

    /* Predicted strokes, behind. */
    if (p.subdiv !== g.subdiv || Math.abs(p.duty - g.duty) > 0.02) {
      for (let i = 0; i < p.subdiv; i++) {
        const x0 = x + (i / p.subdiv) * w;
        ctx.fillStyle = hsl(hue + 40, 0.5, 0.6, alpha * 0.20);
        ctx.fillRect(x0, y - h / 2 - 3, (w / p.subdiv) * p.duty, 2);
      }
    }

    /* Measured strokes. */
    for (let i = 0; i < g.subdiv; i++) {
      const x0 = x + (i / g.subdiv) * w;
      const live = i === g.stroke;
      ctx.fillStyle = hsl(hue, 0.8, live ? 0.68 : 0.48, alpha * (live ? 0.95 : 0.5));
      ctx.fillRect(x0, y - h / 2, (w / g.subdiv) * g.duty, h);
    }

    /* The needle. */
    const nx = x + ((g.stroke + g.phase) / g.subdiv) * w;
    ctx.fillStyle = hsl(hue + 20, 1, 0.85, alpha);
    ctx.fillRect(nx - 1, y - h / 2 - 3, 2, h + 6);

    label(ctx, x + w + 6, y, g.open > 0.5 ? 'OPEN' : g.nextEdge.toFixed(1) + 's',
      g.open > 0.5 ? 140 : hue, alpha * 0.9);
  }

  // ── NEST: a depth gauge ──────────────────────────────────────────────────
  /* Pips for each level this essence can descend, filled to where you have
   * actually got to. The hollow pips are the payout you have not taken yet,
   * which is the entire argument for pushing deeper. */
  function nest(ctx, game, n, x, y, w, hue, alpha) {
    const g = RS.emergence.NEST(n.man.essence, _real);
    const p = RS.emergence.NEST(beliefOf(game, n.man.essence), _pred);
    const max = Math.max(g.depth, p.depth);
    const step = Math.min(13, w / Math.max(1, max));
    for (let i = 0; i < max; i++) {
      const cx = x + i * step + step / 2;
      const here = i <= n.depth;
      const real = i < g.depth;
      ctx.beginPath();
      ctx.arc(cx, y, real ? 3.4 : 2.2, 0, TAU);
      if (here) { ctx.fillStyle = hsl(hue, 0.85, 0.68, alpha); ctx.fill(); }
      else {
        ctx.strokeStyle = hsl(hue, 0.6, 0.6, alpha * (real ? 0.55 : 0.22));
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    label(ctx, x + max * step + 6, y, '×' + g.fanout + ' ·' + (n.bonus || 1).toFixed(1),
      hue, alpha * 0.9);
  }

  // ── FLOW: a gradient compass ─────────────────────────────────────────────
  /* Which way this node is being carried, and how hard. A converging essence
   * points inward and the needle shortens as it arrives; a diverging one
   * points outward and lengthens as it escapes, which is your warning. */
  function flow(ctx, game, n, x, y, w, hue, alpha) {
    const g = RS.emergence.FLOW(n.man.essence, n.x, n.y, game.field.t, _real);
    const cx = x + 9, cy = y;
    ctx.strokeStyle = hsl(hue, 0.4, 0.5, alpha * 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, 8, 0, TAU); ctx.stroke();

    const len = 3 + clamp01(g.strength) * 7;
    const a = Math.atan2(g.gy, g.gx);
    ctx.strokeStyle = hsl(g.divergence > 0.5 ? 12 : 168, 0.85, 0.66, alpha);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    ctx.stroke();

    label(ctx, x + 24, y, (g.divergence > 0.5 ? 'out' : 'in') +
      ' ' + (g.steadiness > 0.6 ? 'steady' : 'restless'), hue, alpha * 0.9);
  }

  // ── ORDER: the dependency graph ──────────────────────────────────────────
  /* The antecedents, ticked where held. This is the layer's whole puzzle made
   * visible: you can see which of them you are missing and go and get it,
   * rather than being told "blocked" and left to guess. */
  function order(ctx, game, n, x, y, w, hue, alpha) {
    const o = n.orderInfo || RS.emergence.ORDER(n.man.essence, n.man.seed, _real);
    let cx = x;
    for (let i = 0; i < o.prereqs.length; i++) {
      const ess = RS.fractal.ESSENCE_BY_ID[o.prereqs[i]];
      if (!ess) continue;
      const held = RS.field.holdsAntecedent(game, o, o.prereqs[i]);
      ctx.fillStyle = hsl(held ? 140 : 0, held ? 0.6 : 0.5, held ? 0.62 : 0.48,
        alpha * (held ? 0.95 : 0.5));
      ctx.font = '10px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText((held ? '✓' : '·') + ess.name.slice(0, 5), cx, y);
      cx += 42;
      if (cx > x + w) break;
    }
    label(ctx, x + w + 6, y, o.holds ? 'holds' : 'decays', hue, alpha * 0.7);
  }

  // ── TWIN: the tell ───────────────────────────────────────────────────────
  /* A bar that fills as observation accumulates, and a mark that says which of
   * the pair the tell is pointing at. Clarity sets how fast it fills, so a
   * player who knows the essence's persistence knows whether to wait for
   * certainty or commit and accept the drag. */
  function twin(ctx, game, n, x, y, w, hue, alpha) {
    const g = n.twinInfo || RS.emergence.TWIN(n.man.essence, n.man.seed, _real);
    const need = lerp(2.6, 0.5, g.clarity);
    const fill = n.collapsed ? 1 : clamp01((n.observed || 0) / need);
    const h = 5;
    ctx.fillStyle = hsl(hue, 0.3, 0.35, alpha * 0.3);
    ctx.fillRect(x, y - h / 2, w * 0.62, h);
    /* Coloured by the *answer*, not by the fact that there is one. A full
     * green bar over the word DECOY reads as good news, which is the opposite
     * of what it is. */
    const verdict = !n.collapsed ? 268 : (n.twinReal ? 140 : 8);
    ctx.fillStyle = hsl(verdict, 0.8, 0.64, alpha * 0.9);
    ctx.fillRect(x, y - h / 2, w * 0.62 * fill, h);
    label(ctx, x + w * 0.62 + 6, y,
      n.collapsed ? (n.twinReal ? 'REAL' : 'DECOY') : 'reading…',
      verdict, alpha * 0.95);
  }

  // ── INVERT: the mirror ───────────────────────────────────────────────────
  /* How far backwards this node reads, and on which axis. At strength 0 it is
   * an ordinary node sitting in the Null layer, which is a genuinely useful
   * thing to know and impossible to guess without this. */
  function invert(ctx, game, n, x, y, w, hue, alpha) {
    const g = n.inv || RS.emergence.INVERT(n.man.essence, _real);
    const h = 5, bw = w * 0.55;
    ctx.fillStyle = hsl(hue, 0.2, 0.35, alpha * 0.3);
    ctx.fillRect(x, y - h / 2, bw, h);
    /* Filled from the right, because the whole point is that it runs the other
     * way. */
    ctx.fillStyle = hsl(0, 0.0, 0.82, alpha * 0.85);
    ctx.fillRect(x + bw * (1 - g.strength), y - h / 2, bw * g.strength, h);
    label(ctx, x + bw + 6, y,
      g.strength < 0.1 ? 'reads true' : (g.axis === 'phase' ? 'Δ mirrored' : 'magnitude'),
      hue, alpha * 0.9);
  }

  const DRAW = { gate, nest, flow, order, twin, invert };

  /* Draw the live primitives for one node, stacked. Returns how many rows were
   * drawn so the caller can lay out around it. */
  function drawFor(ctx, game, n, x, y, hue, alpha) {
    if (!n || !n.man) return 0;
    const band = RS.spectrum.BANDS[n.man.bandIndex];
    if (!band) return 0;
    ctx.save();
    let row = 0;
    for (let i = 0; i < band.prim.length; i++) {
      const fn = DRAW[band.prim[i]];
      if (!fn) continue;
      const gy = y + row * ROW_H;
      const L = RS.emergence.LABELS[band.prim[i]];
      ctx.fillStyle = hsl(hue, 0.4, 0.66, alpha * 0.75);
      ctx.font = '10px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(L ? L.glyph : '·', x - 6, gy);
      fn(ctx, game, n, x, gy, ROW_W, hue, alpha);
      row++;
    }
    ctx.restore();
    return row;
  }

  RS.primhud = { drawFor, DRAW, ROW_H, ROW_W };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
