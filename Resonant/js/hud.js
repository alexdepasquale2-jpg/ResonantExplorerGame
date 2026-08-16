/* Resonant — the instrument panel.
 *
 * Drawn on its own canvas, layered over the field. That separation is not
 * cosmetic: the field gets shaken, punched and colour-flashed constantly, and
 * controls that move with it would be unusable. Instruments stay still. Only
 * the world moves.
 *
 * Two pieces live here:
 *
 *   THE SPECTRUM MAP — the whole φ axis, always visible, including the parts
 *   that are out of reach. The player should be able to see from the first
 *   minute exactly how much reality they have not touched; hiding the locked
 *   remainder would throw away the strongest pull the game has.
 *
 *   THE DIAL CLUSTER — four knobs. Each is drawn as a real instrument: an arc
 *   scale, tick marks at the current precision, raised notches at discovered
 *   detents, a needle with weight (it is a spring, so it overshoots and
 *   settles), and a live readout.
 *
 * Everything here reads `dial.shown.value` (the spring) rather than
 * `dial.value` (the truth), so no needle ever teleports.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, hsl, TAU, ease } = RS.core;

  const layout = {
    w: 0, h: 0, dpr: 1,
    strip: { x: 0, y: 0, w: 0, h: 0 },
    dials: [],       // { id, cx, cy, r }
    fineBtn: null
  };

  /* The φ axis is warped so every band gets comparable room. A linear 0–1000
   * axis crams the first five layers into the leftmost 25% and makes the early
   * game — the part everyone plays — the least legible part of the display. */
  function phiToU(phi) {
    const B = RS.spectrum.BANDS;
    if (phi <= B[0].centre) return (phi / Math.max(1e-6, B[0].centre)) * (0.5 / B.length);
    for (let i = 0; i < B.length - 1; i++) {
      if (phi <= B[i + 1].centre) {
        const t = (phi - B[i].centre) / (B[i + 1].centre - B[i].centre);
        return ((i + 0.5) + t) / B.length;
      }
    }
    const last = B[B.length - 1];
    const over = (phi - last.centre) / 100;
    return clamp01(((B.length - 0.5) + over) / B.length);
  }

  function computeLayout(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    layout.w = w; layout.h = h; layout.dpr = dpr;

    const narrow = w < 560;
    const pad = Math.max(10, w * 0.028);
    /* Dial size is bounded by both axes so the cluster never eats the field on
     * a short landscape window or overflow on a tall narrow one. */
    const dialR = clamp(narrow ? (w - pad * 5) / 8 : (w - pad * 6) / 10, 26, Math.min(58, h * 0.10));

    /* Each dial draws a symbol above it and a value below it, both outside the
     * knob's radius (at 1.34r and 1.36r). The cluster box has to account for
     * that or the symbol punches up through the spectrum strip and the value
     * runs off the bottom of the screen — which is exactly what happened the
     * first time this was laid out. */
    const labelUp = dialR * 0.34 + dialR * 0.42;      // symbol offset + its cap height
    const labelDown = dialR * 0.36 + dialR * 0.30;    // value offset + its cap height
    const clusterY = h - dialR - labelDown - pad * 0.8;

    layout.strip.x = pad;
    layout.strip.w = w - pad * 2;
    layout.strip.h = clamp(h * 0.038, 20, 34);
    layout.strip.y = clusterY - dialR - labelUp - layout.strip.h - pad * 0.7;
    /* Where the world is allowed to draw down to, so the renderer can centre
     * a scene in the space that is actually free. */
    layout.clusterTop = layout.strip.y - pad * 0.5;

    /* Publish it to CSS as well. The DOM overlay is a flex column that pushes
     * its bottom block (body bar, readout, objective) to the floor of #app —
     * and the floor of the viewport is where the instruments live, so without
     * this the readout renders underneath the dials. The canvas layout is the
     * authority on where that boundary is, so it is the thing that publishes
     * it rather than CSS guessing with a magic number. */
    if (typeof document !== 'undefined') {
      const reserve = Math.round(h - layout.clusterTop);
      if (reserve !== layout.__reserve) {
        layout.__reserve = reserve;
        document.documentElement.style.setProperty('--hud-h', reserve + 'px');
      }
    }

    layout.dials.length = 0;
    const ids = ['time', 'space', 'phase', 'frequency'];
    const gap = (w - pad * 2 - dialR * 2 * 4) / 3;
    for (let i = 0; i < 4; i++) {
      layout.dials.push({
        id: ids[i],
        cx: pad + dialR + i * (dialR * 2 + gap),
        cy: clusterY,
        r: dialR
      });
    }
    return layout;
  }

  function dialRegion(id) {
    for (const d of layout.dials) if (d.id === id) return d;
    return null;
  }

  // --- spectrum map --------------------------------------------------------

  function drawSpectrum(ctx, game, t) {
    const S = layout.strip;
    const D = game.dials.frequency;
    const focus = RS.dials.focusOf(D);
    const reach = D.max;

    ctx.save();

    // trough
    roundRect(ctx, S.x, S.y, S.w, S.h, S.h / 2);
    ctx.fillStyle = 'rgba(8,12,20,0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(140,180,230,0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // reachable portion, so the wall between "mine" and "not yet" is explicit
    const reachU = phiToU(reach);
    ctx.save();
    roundRect(ctx, S.x, S.y, S.w, S.h, S.h / 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(120,190,255,0.055)';
    ctx.fillRect(S.x, S.y, S.w * reachU, S.h);

    for (const b of RS.spectrum.BANDS) {
      const u = phiToU(b.centre);
      const x = S.x + S.w * u;
      const reachable = b.centre <= reach;
      const known = !!game.known.bands[b.id];
      const ghost = RS.spectrum.isGhost(b, focus);
      const res = RS.spectrum.resonanceOf(b, D.value, focus);

      // band well
      const halfW = (S.w / RS.spectrum.BANDS.length) * 0.36;
      const g = ctx.createLinearGradient(x - halfW, 0, x + halfW, 0);
      const alpha = !reachable ? 0.10 : ghost ? 0.20 : known ? 0.55 : 0.36;
      g.addColorStop(0, hsl(b.hue, b.sat, 0.55, 0));
      g.addColorStop(0.5, hsl(b.hue, b.sat, 0.55, alpha + res * 0.4));
      g.addColorStop(1, hsl(b.hue, b.sat, 0.55, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - halfW, S.y, halfW * 2, S.h);

      // glyph
      ctx.font = Math.round(S.h * 0.5) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = !reachable ? 'rgba(160,180,210,0.28)'
        : ghost ? hsl(b.hue, 0.3, 0.62, 0.55)
          : hsl(b.hue, b.sat, known ? 0.82 : 0.66, 0.9);
      ctx.fillText(!reachable ? '·' : b.glyph, x, S.y + S.h * 0.5);
    }
    ctx.restore();

    // the carrier: where the dial actually is
    const cu = phiToU(D.shown.value);
    const cx = S.x + S.w * cu;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, S.y - 3); ctx.lineTo(cx, S.y + S.h + 3);
    ctx.stroke();
    /* Carrier width shows focus: a blurred observer is visibly smeared across
     * the axis, and buying focus visibly sharpens the mark. */
    const band = RS.spectrum.nearestBand(D.value);
    const halfSpan = RS.spectrum.effWidth(band, focus) * 0.5;
    const wl = S.x + S.w * phiToU(Math.max(0, D.shown.value - halfSpan));
    const wr = S.x + S.w * phiToU(D.shown.value + halfSpan);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(wl, S.y, Math.max(1, wr - wl), S.h);

    ctx.restore();
  }

  // --- dials ---------------------------------------------------------------

  const ARC_START = Math.PI * 0.75;
  const ARC_SPAN = Math.PI * 1.5;

  function dialAngle(dial, def) {
    if (def.wraps) return dial.shown.value;
    const span = dial.max - dial.min;
    const u = span > 0 ? clamp01((dial.shown.value - dial.min) / span) : 0;
    return ARC_START + ARC_SPAN * u;
  }

  function valueOf(dial, def) {
    const v = dial.shown.value;
    switch (dial.id) {
      case 'time': return (v >= 0 ? '' : '−') + Math.abs(v).toFixed(2) + '×';
      case 'space': return RS.cosmos.describe(v);
      case 'phase': return (v / TAU * 360).toFixed(1) + '°';
      case 'frequency': return v.toFixed(dial.levels.precision > 4 ? 3 : 2);
    }
    return v.toFixed(2);
  }

  function drawDial(ctx, game, reg, t) {
    const dial = game.dials[reg.id];
    const def = RS.dials.defOf(reg.id);
    const { cx, cy, r } = reg;
    const focus = RS.dials.focusOf(dial);

    ctx.save();

    // body
    const bodyG = ctx.createRadialGradient(cx, cy - r * 0.35, r * 0.1, cx, cy, r);
    bodyG.addColorStop(0, 'rgba(30,40,58,0.96)');
    bodyG.addColorStop(1, 'rgba(10,15,24,0.96)');
    ctx.fillStyle = bodyG;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();

    // grabbed state reads immediately: the whole knob lifts
    const lift = dial.grabbed ? 1 : 0;
    ctx.strokeStyle = hsl(def.hue, 0.7, 0.55, 0.28 + lift * 0.5);
    ctx.lineWidth = 1 + lift;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();

    // scale arc
    const arcR = r * 0.82;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(150,180,220,0.16)';
    ctx.lineWidth = Math.max(2, r * 0.075);
    ctx.beginPath();
    if (def.wraps) ctx.arc(cx, cy, arcR, 0, TAU);
    else ctx.arc(cx, cy, arcR, ARC_START, ARC_START + ARC_SPAN);
    ctx.stroke();

    // filled portion
    if (!def.wraps) {
      const span = dial.max - dial.min;
      const u = span > 0 ? clamp01((dial.shown.value - dial.min) / span) : 0;
      ctx.strokeStyle = hsl(def.hue, 0.85, 0.6, 0.75);
      ctx.beginPath();
      ctx.arc(cx, cy, arcR, ARC_START, ARC_START + ARC_SPAN * u);
      ctx.stroke();
    }

    // detent notches — only the ones discovered, which is the point
    const detents = RS.dials.detentsFor(game, reg.id);
    for (const d of detents) {
      const span = dial.max - dial.min;
      if (d.at < dial.min || d.at > dial.max) continue;
      const u = span > 0 ? (d.at - dial.min) / span : 0;
      const a = def.wraps ? d.at : ARC_START + ARC_SPAN * u;
      const seated = dial.seatedOn === d.at;
      ctx.strokeStyle = seated ? hsl(def.hue, 1, 0.78, 1) : hsl(def.hue, 0.6, 0.65, d.strong ? 0.7 : 0.35);
      ctx.lineWidth = seated ? 3 : (d.strong ? 2 : 1);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (arcR - r * 0.16), cy + Math.sin(a) * (arcR - r * 0.16));
      ctx.lineTo(cx + Math.cos(a) * (arcR + r * 0.14), cy + Math.sin(a) * (arcR + r * 0.14));
      ctx.stroke();
    }

    // needle
    const na = dialAngle(dial, def);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = Math.max(2, r * 0.075);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(na) * r * 0.18, cy + Math.sin(na) * r * 0.18);
    ctx.lineTo(cx + Math.cos(na) * arcR * 0.94, cy + Math.sin(na) * arcR * 0.94);
    ctx.stroke();

    // hub, brightness = focus, so upgrades are visible on the instrument
    ctx.fillStyle = hsl(def.hue, 0.8, 0.35 + focus * 0.4, 1);
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.15, 0, TAU); ctx.fill();

    // fine-mode ring
    if (dial.fine) {
      ctx.strokeStyle = hsl(def.hue, 1, 0.75, 0.9);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.94, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }

    // labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 ' + Math.round(r * 0.42) + 'px ui-monospace, Menlo, monospace';
    ctx.fillStyle = hsl(def.hue, 0.8, 0.72, 0.95);
    ctx.fillText(def.symbol, cx, cy - r * 1.34);

    ctx.font = '600 ' + Math.round(Math.max(9, r * 0.27)) + 'px ui-monospace, Menlo, monospace';
    ctx.fillStyle = 'rgba(226,238,252,0.94)';
    /* Long tier names have to fit between two neighbouring knobs, so the label
     * is condensed and then shortened rather than clipped — a truncated scale
     * name is genuinely ambiguous ("Planetary Sy…" reads as either). */
    let label = valueOf(dial, def);
    const gap = layout.dials.length > 1 ? (layout.dials[1].cx - layout.dials[0].cx) : r * 2.6;
    const maxW = gap - 6;
    let m = ctx.measureText(label);
    if (m.width > maxW) {
      const scale = Math.max(0.66, maxW / m.width);
      ctx.font = '600 ' + Math.round(Math.max(8, r * 0.27 * scale)) + 'px ui-monospace, Menlo, monospace';
      m = ctx.measureText(label);
      if (m.width > maxW && dial.id === 'space') {
        label = RS.cosmos.tierAt(dial.shown.value).short;
      }
    }
    ctx.fillText(label, cx, cy + r * 1.36);

    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw(game, canvas, ctx, dt) {
    computeLayout(canvas);
    ctx.setTransform(layout.dpr, 0, 0, layout.dpr, 0, 0);
    ctx.clearRect(0, 0, layout.w, layout.h);
    const t = game.field.t;
    drawSpectrum(ctx, game, t);
    for (const reg of layout.dials) drawDial(ctx, game, reg, t);
  }

  /* Hit test, used by input.js. Generous radius: a knob you miss on a phone is
   * a knob that feels broken. */
  function hitDial(x, y) {
    for (const d of layout.dials) {
      if (Math.hypot(x - d.cx, y - d.cy) <= d.r * 1.45) return d;
    }
    return null;
  }

  /* Tapping the spectrum map jumps the dial there — but only within reach, and
   * the jump goes through the spring so it still arrives with weight. */
  function hitStrip(x, y) {
    const S = layout.strip;
    if (x < S.x || x > S.x + S.w || y < S.y - 8 || y > S.y + S.h + 8) return null;
    const u = (x - S.x) / S.w;
    /* Invert the warped axis by bisection — it is monotone, so 24 steps is
     * exact to well under one pixel. */
    let lo = 0, hi = RS.spectrum.PHI_MAX;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (phiToU(mid) < u) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  RS.hud = { layout, computeLayout, draw, hitDial, hitStrip, dialRegion, phiToU, roundRect };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
