/* Resonant — bloom, and the only reason the game can afford it.
 *
 * ── Why this is worth a file ──────────────────────────────────────────────
 *
 * Everything in this game emits: nodes ignite as you approach them, filaments
 * glow, a star is a disc of light, a crystallising lock is a ring that
 * brightens for four seconds. All of it was drawn with radial gradients, which
 * is what you do when you have no post pass — and radial gradients are how you
 * *fake* the look of light without any of the behaviour. Two bright things next
 * to each other did not add up. A small very bright thing looked the same as a
 * large dim one. Nothing spilled onto anything.
 *
 * A real bloom pass fixes all three at once and, unusually, the game can afford
 * it: the sim costs about 0.02 ms a frame and drawing costs 0.6–1.3 ms against
 * a 16 ms budget, so there has been an enormous amount of headroom sitting
 * unused since the first commit.
 *
 * ── How ───────────────────────────────────────────────────────────────────
 *
 * The cheapest bloom that actually looks like bloom, in Canvas2D:
 *
 *   1. Downscale the frame to 1/DOWN, which is both the cost saving and the
 *      first blur — the browser's bilinear filter does that work for free.
 *   2. Knock out everything below the threshold, so only things that are
 *      genuinely bright bleed. Without this, bloom is just a haze.
 *   3. Blur by repeatedly drawing the small canvas onto itself at slight
 *      offsets — a box blur, separable, four taps a pass.
 *   4. Draw it back over the frame with 'lighter'.
 *
 * At quarter resolution on a 1280×860 canvas that is a 320×215 buffer and
 * about ten compositing operations. It costs well under a millisecond and it is
 * the single largest visual change in the codebase.
 *
 * ── The threshold step is the whole trick ─────────────────────────────────
 *
 * Canvas2D has no shaders, so "keep only the bright parts" has to be done with
 * compositing. `difference` against a grey, then a hard multiply, gets close
 * enough: what survives is what was brighter than the grey, and everything else
 * collapses toward black. It is not a filmic threshold curve and it does not
 * need to be — it needs to stop dim things from glowing, which it does.
 */
(function (RS) {
  'use strict';

  /* Quarter resolution. Eighth is faster and visibly blocky on the thin
   * strokes this game is mostly made of; half costs four times as much for a
   * difference nobody can see. */
  const DOWN = 4;
  /* How many blur passes. Three is the point where the falloff stops looking
   * like a stack of copies. */
  const PASSES = 3;

  let buf = null, bctx = null, tmp = null, tctx = null;
  let bw = 0, bh = 0;
  let enabled = true;

  /* Full-resolution world buffer. The display canvas is the composite
   * target; this is what bloom *reads*. Capture never samples the canvas
   * it is about to draw onto, which is the whole of the flush story. */
  let world = null, wctx = null, ww = 0, wh = 0;

  function ensure(w, h) {
    const nw = Math.max(1, Math.round(w / DOWN));
    const nh = Math.max(1, Math.round(h / DOWN));
    if (buf && bw === nw && bh === nh) return true;
    bw = nw; bh = nh;
    valid = false;
    if (!buf) {
      /* OffscreenCanvas where it exists, a detached <canvas> where it does
       * not — the difference is a few percent and not worth a code path that
       * only runs on one of them. */
      buf = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(nw, nh) : document.createElement('canvas');
      tmp = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(nw, nh) : document.createElement('canvas');
    }
    buf.width = nw; buf.height = nh;
    tmp.width = nw; tmp.height = nh;
    bctx = buf.getContext('2d');
    tctx = tmp.getContext('2d');
    return !!(bctx && tctx);
  }

  /* `amount` 0..1 scales the whole effect, so a scope can bloom harder than
   * another and the transition can push it. */
  /* ── Why capture never samples the display ───────────────────────────────
   *
   * Measured, because the first version of this was four times slower than it
   * had any right to be. The individual steps cost, on a 320×215 buffer:
   *
   *     downscale 0.0 ms · threshold 0.3 · blur 0.9 · composite 0.1
   *
   * — about 1.3 ms in total. But called at the end of the frame, after the
   * world had been drawn, `apply` measured **16 ms at p95**: an entire frame
   * budget, for 1.3 ms of work.
   *
   * The difference is the flush. Sampling a canvas that has drawing queued on
   * it forces the browser to finish all of that work first, and the attunement
   * field queues a great deal — fifteen nodes laying down radial gradients
   * under 'lighter'. The bloom was not slow; it was waiting.
   *
   * So the world is drawn into an offscreen buffer, and capture reads *that*
   * — never the canvas bloom is about to composite onto. Sampling a canvas
   * that is also the composite target, with drawing queued on it, was the
   * 16 ms flush. Reading a finished world buffer and blitting it is a copy,
   * not a flush of the frame you are still building. The glow is in the
   * same frame as the thing making it, and the attunement field gets the
   * ~3 fps back.
   *
   * `STRIDE` then halves the remaining work again: bloom is low-frequency, and
   * the glow around a thing that moved two pixels is the same glow.
   */
  const STRIDE = 2;
  let frame = 0, valid = false;

  function ensureWorld(pw, ph) {
    if (world && ww === pw && wh === ph && wctx) return true;
    ww = pw; wh = ph;
    valid = false;
    if (!world) {
      world = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(pw, ph) : document.createElement('canvas');
    }
    world.width = pw; world.height = ph;
    wctx = world.getContext('2d');
    return !!wctx;
  }

  /* Prepare the world buffer for this frame. The renderer draws into the
   * returned context (CSS pixels, same dpr transform as the display). */
  function begin(w, h, dpr) {
    if (!enabled) return null;
    const pw = Math.max(1, Math.round(w * (dpr || 1)));
    const ph = Math.max(1, Math.round(h * (dpr || 1)));
    if (!ensureWorld(pw, ph)) return null;
    wctx.setTransform(dpr || 1, 0, 0, dpr || 1, 0, 0);
    return { canvas: world, ctx: wctx };
  }

  function captureWorld(w, h, threshold) {
    if (!enabled || !world) return;
    capture(world, w, h, threshold);
  }

  function blit(ctx, w, h) {
    if (!world) return;
    ctx.drawImage(world, 0, 0, ww, wh, 0, 0, w, h);
  }

  /* Called on a finished source. Reads that image into the bloom buffer. */
  function capture(canvas, w, h, threshold) {
    if (!enabled) return;
    if (!ensure(w, h)) return;
    if (valid && (frame++ % STRIDE) !== 0) return;
    frame = 1;
    const t = threshold == null ? 0.42 : threshold;

    // 1 — downscale. The browser's filter is the first blur, for free.
    bctx.globalCompositeOperation = 'copy';
    bctx.globalAlpha = 1;
    bctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, bw, bh);

    /* 2 — threshold. `difference` against grey pushes anything darker than the
     * grey toward black and leaves the bright parts standing; the `multiply`
     * then crushes what is left of the midtones. Blunt, and it does the one job
     * it has to do: stop dim things from glowing. */
    const g = Math.round(t * 255);
    bctx.globalCompositeOperation = 'difference';
    bctx.fillStyle = 'rgb(' + g + ',' + g + ',' + g + ')';
    bctx.fillRect(0, 0, bw, bh);
    bctx.globalCompositeOperation = 'multiply';
    bctx.drawImage(buf, 0, 0);
    bctx.globalCompositeOperation = 'source-over';

    // 3 — blur, by drawing the buffer onto itself at four offsets per pass.
    for (let p = 0; p < PASSES; p++) {
      const r = 1 + p * 1.6;
      tctx.globalCompositeOperation = 'copy';
      tctx.globalAlpha = 1;
      tctx.drawImage(buf, 0, 0);
      bctx.globalAlpha = 0.30;
      bctx.globalCompositeOperation = 'source-over';
      bctx.drawImage(tmp, -r, 0);
      bctx.drawImage(tmp, r, 0);
      bctx.drawImage(tmp, 0, -r);
      bctx.drawImage(tmp, 0, r);
      bctx.globalAlpha = 1;
    }
    valid = true;
  }

  // 4 — add it back, at the end of the frame. 'lighter': light adds.
  function composite(ctx, w, h, amount) {
    if (!enabled || !valid || amount <= 0.004) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = amount;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(buf, 0, 0, bw, bh, 0, 0, w, h);
    ctx.restore();
  }

  /* ── Warm-up ──────────────────────────────────────────────────────────────
   *
   * The first frame that runs this pipeline costs about ten milliseconds more
   * than every subsequent one: allocating two canvases, uploading them, and
   * whatever the browser does the first time it sees `difference` and
   * `multiply` at a given size. Steady state is free — measured at 60.5 fps
   * with bloom on and 60.5 with it off — but the cost lands in the player's
   * first second, which is the worst possible second for it to land in.
   *
   * Run once during boot, when a few milliseconds are invisible. Called from
   * `main.start`.
   */
  function warm(ctx, canvas, w, h) {
    const dpr = (canvas && canvas.width && w) ? canvas.width / Math.max(1, w) : 1;
    if (!begin(w, h, dpr) && !ensure(w, h)) return false;
    if (wctx) {
      wctx.setTransform(1, 0, 0, 1, 0, 0);
      wctx.fillStyle = '#03050a';
      wctx.fillRect(0, 0, ww, wh);
    }
    for (let i = 0; i <= STRIDE; i++) {
      if (world) capture(world, w, h, 0.5);
      else capture(canvas, w, h, 0.5);
      composite(ctx, w, h, 0.005);
    }
    valid = false;
    return true;
  }

  function setEnabled(on) { enabled = !!on; valid = false; }
  function isEnabled() { return enabled; }

  RS.bloom = {
    DOWN, PASSES, STRIDE, capture, captureWorld, composite, blit, begin, warm,
    setEnabled, isEnabled
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
