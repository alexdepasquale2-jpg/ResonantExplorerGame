/* Resonant — one generator, every scale.
 *
 * ── The visual statement of the thesis ────────────────────────────────────
 *
 * This file draws a molecule and a galaxy with the same function. Not
 * similar functions — the same one, called with a different `geometry`.
 *
 * That is not a saving; it is the argument. The premise says one body of
 * information is rendered differently by local rules, so a spiral arm and a
 * coiled flagellum should come out of the same generator with the same
 * parameters and differ only in how the strokes are laid down. If they came
 * from two hand-drawn routines the game would merely *claim* they were the
 * same essence. This way they demonstrably are, and a player can see the
 * kinship before they can name it.
 *
 * ── How it is driven ──────────────────────────────────────────────────────
 *
 * Entirely by the four axes in fractal.js:
 *
 *   branching    → fanout at each node
 *   symmetry     → how regular the angles are (1.0 = perfectly even fan)
 *   persistence  → how slowly segments shorten with depth
 *   complexity   → how many levels
 *
 * `geometry` (from cosmos.js) chooses the stroke, and nothing else. Topology is
 * identical across geometries for the same essence — same segment count, same
 * depth — which is exactly what makes it self-similarity rather than variety,
 * and which simtest asserts.
 *
 * ── Cost ──────────────────────────────────────────────────────────────────
 *
 * Writes into a caller-owned flat array of segments and allocates nothing after
 * the first call. Segment count is bounded by MAX_SEGMENTS regardless of the
 * essence, so a maximally branching essence at full depth cannot blow the frame
 * budget — the recursion is capped, not trusted.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, TAU, hashF, hashN } = RS.core;

  /* Hard ceiling. Emergence at fanout 4 and depth 5 would be 341 nodes; capping
   * at 160 keeps the worst case cheap and the difference is invisible because
   * the deepest segments are sub-pixel anyway. */
  const MAX_SEGMENTS = 160;

  /* A segment is 7 flat numbers: x0, y0, x1, y1, depth, angle, scale.
   * Flat rather than objects because this is rebuilt for every visible node
   * every frame at some scales. */
  const STRIDE = 7;

  function newBuffer() {
    return { data: new Float32Array(MAX_SEGMENTS * STRIDE), count: 0, depthMax: 0, extent: 1 };
  }

  /* Build the structure. Pure and deterministic: the same essence always
   * produces the same skeleton, so a player recognises an essence by its shape
   * before they read its name. */
  function build(essence, geometry, seed, out) {
    const buf = out || newBuffer();
    buf.count = 0;
    buf.depthMax = 0;
    buf.geometry = geometry;
    buf.essence = essence;

    const a = RS.emergence.axes(essence);
    const depth = 1 + Math.floor(a.c * 4);
    const fanout = 1 + Math.round(a.b * 3);
    const decay = lerp(0.48, 0.86, a.p);
    /* Spread narrows as symmetry rises: a perfectly symmetric essence fans out
     * evenly and tightly, an asymmetric one throws its branches wide. */
    const spread = lerp(1.5, 0.55, a.s);
    /* Jitter is the inverse of symmetry, hashed so it is stable per essence. */
    const jitter = (1 - a.s) * 0.8;

    grow(buf, 0, 0, -Math.PI / 2, 1, 0, depth, fanout, decay, spread, jitter, seed >>> 0);

    /* How far the skeleton actually reaches from the origin. It varies a great
     * deal by essence — a persistent branching one accumulates segment lengths
     * outward and reaches several units, a converging one barely leaves 1 —
     * so a caller that needs the drawing to fit inside something (a cell
     * membrane, a node's glyph box) cannot use a constant. Measured once here
     * rather than guessed at every call site. */
    let ext = 1e-3;
    for (let s = 0; s < buf.count; s++) {
      const i = s * STRIDE;
      const d = Math.hypot(buf.data[i + 2], buf.data[i + 3]);
      if (d > ext) ext = d;
    }
    buf.extent = ext;
    return buf;
  }

  /* The `radius` to pass to `draw` so the whole figure fits inside `want`. */
  function fit(buf, want) { return want / (buf ? buf.extent : 1); }

  function grow(buf, x, y, ang, len, d, maxD, fanout, decay, spread, jitter, seed) {
    if (d >= maxD || buf.count >= MAX_SEGMENTS) return;

    const x1 = x + Math.cos(ang) * len;
    const y1 = y + Math.sin(ang) * len;

    const i = buf.count * STRIDE;
    buf.data[i] = x; buf.data[i + 1] = y;
    buf.data[i + 2] = x1; buf.data[i + 3] = y1;
    buf.data[i + 4] = d;
    buf.data[i + 5] = ang;
    buf.data[i + 6] = len;
    buf.count++;
    if (d > buf.depthMax) buf.depthMax = d;

    for (let k = 0; k < fanout; k++) {
      if (buf.count >= MAX_SEGMENTS) return;
      /* Even fan, then a stable per-branch jitter. */
      const base = fanout === 1 ? 0 : (k / (fanout - 1) - 0.5) * spread;
      const j = (hashF(hashN(seed, d, k), 3) * 2 - 1) * jitter;
      grow(buf, x1, y1, ang + base + j, len * decay, d + 1, maxD,
        fanout, decay, spread, jitter, seed);
    }
  }

  /* ── Strokes ──────────────────────────────────────────────────────────────
   *
   * The only thing `geometry` changes. Same skeleton, eight ways of laying ink
   * on it — which is precisely "local rules" rendered literally.
   */
  function draw(ctx, buf, cx, cy, radius, hue, sat, alpha, t) {
    if (!buf || !buf.count) return;
    const g = buf.geometry;
    const n = buf.count;
    const dm = Math.max(1, buf.depthMax);

    ctx.save();
    ctx.lineCap = 'round';

    for (let s = 0; s < n; s++) {
      const i = s * STRIDE;
      const x0 = cx + buf.data[i] * radius, y0 = cy + buf.data[i + 1] * radius;
      const x1 = cx + buf.data[i + 2] * radius, y1 = cy + buf.data[i + 3] * radius;
      const d = buf.data[i + 4];
      const len = buf.data[i + 6];
      /* Deeper segments fade — it reads as depth and it hides the cap. */
      const fade = alpha * (1 - d / (dm + 1) * 0.55);
      const w = Math.max(0.6, radius * len * 0.16);

      switch (g) {
        case 'chain':
          /* Bonds: a line with a node at each end. */
          ctx.strokeStyle = RS.core.hsl(hue, sat, 0.62, fade);
          ctx.lineWidth = w * 0.7;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
          ctx.fillStyle = RS.core.hsl(hue + d * 6, sat, 0.72, fade);
          ctx.beginPath(); ctx.arc(x1, y1, w * 0.9, 0, TAU); ctx.fill();
          break;

        case 'cell':
          /* Lobes: soft blobs along the skeleton, membrane-ish. */
          ctx.fillStyle = RS.core.hsl(hue + d * 4, sat * 0.9, 0.5, fade * 0.5);
          ctx.beginPath();
          ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2,
            Math.hypot(x1 - x0, y1 - y0) * 0.55, w * 1.6,
            Math.atan2(y1 - y0, x1 - x0), 0, TAU);
          ctx.fill();
          break;

        case 'web':
          /* Filaments: thin, long, with brighter intersections. */
          ctx.strokeStyle = RS.core.hsl(hue, sat * 0.8, 0.6, fade * 0.75);
          ctx.lineWidth = Math.max(0.5, w * 0.4);
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
          if (d < 2) {
            ctx.fillStyle = RS.core.hsl(hue, sat, 0.8, fade * 0.6);
            ctx.beginPath(); ctx.arc(x0, y0, w * 0.6, 0, TAU); ctx.fill();
          }
          break;

        case 'disc':
          /* Arms: swept, thick at the root, trailing. */
          ctx.strokeStyle = RS.core.hsl(hue + d * 8, sat, 0.6, fade * 0.85);
          ctx.lineWidth = w * 1.3;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.quadraticCurveTo(x0 + (x1 - x0) * 0.5 - (y1 - y0) * 0.25,
            y0 + (y1 - y0) * 0.5 + (x1 - x0) * 0.25, x1, y1);
          ctx.stroke();
          break;

        case 'foam':
          /* Flecks: no continuous structure survives at this scale, only the
           * vertices, and they flicker. */
          if (((s * 7 + Math.floor(t * 6)) % 3) === 0) break;
          ctx.fillStyle = RS.core.hsl(hue + s * 3, sat, 0.7, fade * 0.9);
          ctx.fillRect(x1 - w * 0.5, y1 - w * 0.5, w, w);
          break;

        case 'orbital':
          /* Shells: arcs at each depth rather than lines between them. */
          ctx.strokeStyle = RS.core.hsl(hue, sat, 0.65, fade * 0.7);
          ctx.lineWidth = Math.max(0.5, w * 0.45);
          ctx.beginPath();
          ctx.arc(cx, cy, Math.hypot(x1 - cx, y1 - cy),
            buf.data[i + 5] - 0.5, buf.data[i + 5] + 0.5);
          ctx.stroke();
          break;

        case 'abstract':
          /* Relations: nodes and edges, no spatial pretence. */
          ctx.strokeStyle = RS.core.hsl(hue, sat * 0.5, 0.6, fade * 0.5);
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 3]);
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = RS.core.hsl(hue, sat * 0.6, 0.75, fade);
          ctx.beginPath(); ctx.arc(x1, y1, Math.max(1, w * 0.7), 0, TAU); ctx.fill();
          break;

        default: // 'body'
          ctx.strokeStyle = RS.core.hsl(hue, sat, 0.62, fade);
          ctx.lineWidth = w;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* Topology fingerprint — two geometries of the same essence must agree on
   * this exactly. simtest uses it to assert that geometry changes the ink and
   * never the structure, which is the whole claim of this file. */
  function topology(buf) {
    return buf.count + ':' + buf.depthMax;
  }

  RS.selfsimilar = { MAX_SEGMENTS, STRIDE, newBuffer, build, draw, topology, fit };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
