/* Resonant — drawing the system and planet scenes.
 *
 * Both views are drawn straight from the closed-form models: nothing here
 * reads a cached mesh, texture or heightmap, because none exist. A planet's
 * horizon is `elevationAt` evaluated across the visible span this frame, and
 * its colour is `biomeAt` evaluated at the pixels that need it. That is what
 * makes descending from a system view to a surface instant — there is nothing
 * to build, only a different function to sample.
 *
 * The drawing budget is fixed by construction rather than by culling: the
 * terrain profile is a constant 96 samples, the globe is a constant number of
 * scanlines, and orbits are a constant number of segments. Zoom and detail do
 * not change the cost, so the frame time is flat and there is nothing to
 * stutter.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, hsl, TAU, ease, fmt } = RS.core;

  const V = () => RS.render.view;
  const px = v => v * RS.render.view.R;
  const sx = x => RS.render.view.cx + x * RS.render.view.R;
  const sy = y => RS.render.view.cy + y * RS.render.view.R;

  // ── system view ──────────────────────────────────────────────────────────

  /* Orbits are drawn in a log-compressed radius so that a system spanning
   * 0.03 AU to 60 AU is legible in one frame. A linear plot of a real system
   * is unreadable — the inner planets collapse into the star. */
  function radiusMap(scene, r) {
    const inner = Math.max(0.01, scene.system.discInner * 0.6);
    const outer = Math.max(inner * 2, scene.system.discOuter * 1.1);
    const u = (Math.log(clamp(r, inner, outer)) - Math.log(inner)) / (Math.log(outer) - Math.log(inner));
    return 0.13 + u * 0.84;
  }

  function drawSystem(ctx, game, dt) {
    const s = game.scene;
    if (!s.system) return;
    const sys = s.system;
    const t = s.t;

    // ── the star(s) ──
    const prim = sys.primary;
    const starR = px(0.055) * clamp(Math.pow(prim.radius, 0.3), 0.5, 2.4);
    const cx = V().cx, cy = V().cy;

    /* Corona. Colour is the star's real spectral hue, size follows luminosity
     * — a bright star genuinely dominates its system visually. */
    const glowR = starR * (3 + Math.log10(1 + prim.luminosity) * 2.2);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    g.addColorStop(0, hsl(prim.cls.hue, 0.55, 0.95, 0.95));
    g.addColorStop(0.14, hsl(prim.cls.hue, 0.85, 0.72, 0.6));
    g.addColorStop(0.45, hsl(prim.cls.hue, 0.9, 0.55, 0.16));
    g.addColorStop(1, hsl(prim.cls.hue, 0.9, 0.5, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, glowR, 0, TAU); ctx.fill();
    ctx.fillStyle = hsl(prim.cls.hue, 0.35, 0.97, 1);
    ctx.beginPath(); ctx.arc(cx, cy, starR, 0, TAU); ctx.fill();
    if (sys.keel) {
      ctx.fillStyle = hsl(48, 0.9, 0.7, 0.4 + sys.keel * 0.55);
      ctx.font = '700 ' + Math.round(10 + sys.keel * 8) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('\u2606', cx, cy - starR - 8);
    }

    /* Companions, on their own wide orbits. */
    for (let i = 1; i < sys.stars.length; i++) {
      const st = sys.stars[i];
      const p = RS.orbital.positionAt(st.elements, t, {});
      const rr = radiusMap(s, Math.hypot(p.x, p.y));
      const a = Math.atan2(p.y, p.x);
      const X = cx + Math.cos(a) * px(rr), Y = cy + Math.sin(a) * px(rr) * 0.62;
      const sr = starR * 0.55;
      const cg = ctx.createRadialGradient(X, Y, 0, X, Y, sr * 5);
      cg.addColorStop(0, hsl(st.cls.hue, 0.5, 0.92, 0.9));
      cg.addColorStop(1, hsl(st.cls.hue, 0.9, 0.5, 0));
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(X, Y, sr * 5, 0, TAU); ctx.fill();
    }

    // ── habitable zone ──
    /* Drawn as a band, because it is the single most useful piece of
     * information about a system and it is entirely derived from luminosity. */
    const hzIn = radiusMap(s, sys.hz.inner), hzOut = radiusMap(s, sys.hz.outer);
    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = hsl(130, 0.7, 0.5);
    ctx.beginPath();
    ctx.ellipse(cx, cy, px(hzOut), px(hzOut) * 0.62, 0, 0, TAU);
    ctx.ellipse(cx, cy, px(hzIn), px(hzIn) * 0.62, 0, 0, TAU, true);
    ctx.fill('evenodd');
    ctx.restore();

    /* Frost line, as a dashed ring — it explains the whole architecture of the
     * system at a glance once the player learns to read it. */
    const fl = radiusMap(s, sys.frost);
    if (fl < 1.0) {
      ctx.strokeStyle = hsl(195, 0.5, 0.6, 0.22);
      ctx.setLineDash([4, 7]);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(cx, cy, px(fl), px(fl) * 0.62, 0, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── bodies ──
    const positions = RS.scenes.systemPositions(game);

    /* Orbit traces first, so bodies sit on top of them. */
    for (const e of positions) {
      const rr = radiusMap(s, e.body.a);
      const sel = e.index === s.selected;
      ctx.strokeStyle = e.body.kind === 'belt'
        ? hsl(35, 0.35, 0.55, 0.14)
        : hsl(205, 0.3, 0.6, sel ? 0.42 : 0.13);
      ctx.lineWidth = sel ? 1.6 : 1;
      if (e.body.kind === 'belt') ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.ellipse(cx, cy, px(rr), px(rr) * 0.62, 0, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    /* Trade lanes: literally the top routes from civ.js, drawn as arcs. The
     * visual is the mechanic — a busy system looks busy because it is. */
    if (s.trade && s.trade.lanes.length) {
      for (let i = 0; i < Math.min(6, s.trade.lanes.length); i++) {
        const lane = s.trade.lanes[i];
        const a = positions.find(p => p.body === lane.from.planet.body);
        const b = positions.find(p => p.body === lane.to.planet.body);
        if (!a || !b) continue;
        const pa = bodyScreen(s, a), pb = bodyScreen(s, b);
        const alpha = clamp01(lane.route.margin / 60) * 0.5;
        ctx.strokeStyle = hsl(lane.route.commodity.hue, 0.8, 0.62, alpha);
        ctx.lineWidth = 1 + clamp01(lane.route.margin / 120) * 2;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        /* Bow the lane away from the star so overlapping routes stay legible. */
        const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
        const dx = mx - cx, dy = my - cy;
        const d = Math.hypot(dx, dy) || 1;
        ctx.quadraticCurveTo(mx + dx / d * px(0.09), my + dy / d * px(0.09), pb.x, pb.y);
        ctx.stroke();
      }
    }

    for (const e of positions) {
      const scr = bodyScreen(s, e);
      if (e.body.kind === 'belt') { drawBelt(ctx, s, e, scr); continue; }
      drawWorld(ctx, game, s, e, scr, t);
    }

    /* Embodied courier / lander sits on the orbital plane at the Σ radius. */
    if (game.inhabiting && game.body) {
      const rr = s.radius != null ? radiusMap(s, s.radius) : 0.5;
      const ang = s.orbitAngle || 0;
      const X = cx + Math.cos(ang) * px(rr);
      const Y = cy + Math.sin(ang) * px(rr) * 0.62;
      drawVesselGlyph(ctx, game, X, Y);
    }
  }

  function bodyScreen(scene, e) {
    const rr = radiusMap(scene, Math.hypot(e.x, e.y));
    const a = Math.atan2(e.y, e.x);
    return {
      x: RS.render.view.cx + Math.cos(a) * px(rr),
      /* Flattened vertically: the system is drawn as a shallow oblique rather
       * than flat-on, which reads as a disc instead of as a dartboard. */
      y: RS.render.view.cy + Math.sin(a) * px(rr) * 0.62,
      rr
    };
  }

  function drawBelt(ctx, scene, e, scr) {
    const rr = radiusMap(scene, e.body.a);
    const n = Math.round(40 + e.body.density * 90);
    ctx.fillStyle = hsl(35, 0.4, 0.6, 0.4);
    for (let i = 0; i < n; i++) {
      const h = RS.core.hashF(e.body.hash, i);
      const a = h * TAU;
      const jitter = 1 + (RS.core.hashF(e.body.hash, i + 500) - 0.5) * e.body.width / e.body.a;
      const r = rr * jitter;
      const x = RS.render.view.cx + Math.cos(a) * px(r);
      const y = RS.render.view.cy + Math.sin(a) * px(r) * 0.62;
      ctx.fillRect(x, y, 1.3, 1.3);
    }
  }

  function drawWorld(ctx, game, scene, e, scr, t) {
    /* Deriving every planet every frame would be wasteful, so the cheap
     * visual properties are taken from the body's own hash and only the
     * selected world gets fully derived. */
    const p = (scene.bodyIndex === e.index && scene.planet) ? scene.planet : null;
    const massE = e.body.massE;
    const rad = px(0.012) * clamp(Math.pow(massE, 0.22), 0.55, 3.4);
    const hue = p ? p.type.hue : (e.body.beyondFrost ? 195 : 35);
    const sel = e.index === scene.selected;

    /* Atmosphere halo, if it has one. */
    if (p && p.pressure > 0.02) {
      const ag = ctx.createRadialGradient(scr.x, scr.y, rad * 0.8, scr.x, scr.y, rad * 2.3);
      ag.addColorStop(0, hsl(hue, 0.7, 0.6, clamp01(p.pressure * 0.4) * 0.5));
      ag.addColorStop(1, hsl(hue, 0.7, 0.6, 0));
      ctx.fillStyle = ag;
      ctx.beginPath(); ctx.arc(scr.x, scr.y, rad * 2.3, 0, TAU); ctx.fill();
    }

    /* Rings, drawn as an ellipse pair. */
    if (p && p.moons && p.moons.rings) {
      ctx.strokeStyle = hsl(hue + 20, 0.4, 0.7, 0.5 * p.moons.rings.opacity);
      ctx.lineWidth = rad * 0.55;
      ctx.beginPath();
      ctx.ellipse(scr.x, scr.y, rad * 2.1, rad * 0.7, 0.35, 0, TAU);
      ctx.stroke();
    }

    // body
    const bg = ctx.createRadialGradient(
      scr.x - rad * 0.35, scr.y - rad * 0.35, rad * 0.1, scr.x, scr.y, rad);
    bg.addColorStop(0, hsl(hue, 0.55, 0.72, 1));
    bg.addColorStop(1, hsl(hue - 12, 0.6, 0.28, 1));
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(scr.x, scr.y, rad, 0, TAU); ctx.fill();

    /* A biosignature ring. This is the payoff for the whole atmosphere model:
     * free oxygen means life, and you can see it from orbit. */
    if (p && p.biosignature) {
      ctx.strokeStyle = hsl(130, 0.9, 0.65, 0.75 + Math.sin(t * 3) * 0.2);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(scr.x, scr.y, rad * 1.5, 0, TAU); ctx.stroke();
    }
    /* And a second ring for a civilisation, which is rarer still. */
    if (p && p.civ) {
      ctx.strokeStyle = hsl(p.civ.disposition.hue, 0.9, 0.7, 0.85);
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(scr.x, scr.y, rad * 2.0, t * 0.5, t * 0.5 + TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
    /* Structures the player has placed. */
    if (p && p.influenced) {
      ctx.strokeStyle = hsl(285, 0.85, 0.72, 0.8);
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 3; i++) {
        const a0 = t * 0.8 + i * TAU / 3;
        ctx.beginPath(); ctx.arc(scr.x, scr.y, rad * 2.6, a0, a0 + 0.7); ctx.stroke();
      }
    }

    if (sel) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.4;
      const r2 = rad * 3.2 + Math.sin(t * 2.4) * 1.5;
      for (let i = 0; i < 4; i++) {
        const a0 = i * TAU / 4 + t * 0.35;
        ctx.beginPath(); ctx.arc(scr.x, scr.y, r2, a0, a0 + 0.42); ctx.stroke();
      }
    }
  }

  // ── planet view ──────────────────────────────────────────────────────────

  function drawPlanet(ctx, game, dt) {
    const s = game.scene;
    const p = s.planet;
    if (!p) return;
    drawGlobe(ctx, game, p, s, dt);
  }

  /* ── Globe texture cache ──────────────────────────────────────────────────
   *
   * The globe used to call `biomeAt` for every cell every frame — about 2,700
   * evaluations, each running a five-octave fBm, which cost roughly a third of
   * the frame budget and dragged the view to 41fps. But a planet's surface does
   * not change from frame to frame: only which part of it faces you does.
   *
   * So the surface is baked once into a small equirectangular table of colours
   * and the per-frame loop just indexes it. The projection maths, the shading
   * and the rotation are unchanged — the noise field is simply not re-asked a
   * question it already answered. This is the one place in the codebase where
   * something derived is cached, and it is cached because it is *sampled far
   * more often than it changes*, which is exactly the condition that justifies
   * it.
   *
   * The table is 96x48 (4,608 entries, a few milliseconds to fill) and the
   * cache holds a handful of worlds so flicking between planets in a system
   * does not re-bake. */
  const TEX_W = 96, TEX_H = 48;
  const texCache = new Map();
  const TEX_MAX = 6;

  function globeTexture(game, p) {
    /* Keyed by address plus a coarse climate stamp, so a world the player has
     * terraformed re-bakes rather than showing a stale surface. */
    const key = RS.influence.planetKey(p) + '#' + (p.influenced ? Math.round(p.surfaceTemp) : 0);
    let tex = texCache.get(key);
    if (tex) return tex;

    /* Colour *strings*, not components. Building an hsla() string and letting
     * the canvas parse it is the single most expensive thing the globe does,
     * and doing it once per texel instead of once per drawn cell per frame is
     * the difference between 4.3 ms and nothing. */
    const css = new Array(TEX_W * TEX_H);
    const dat = RS.planet.datum(p);
    for (let iy = 0; iy < TEX_H; iy++) {
      const lat = -Math.PI / 2 + (iy + 0.5) / TEX_H * Math.PI;
      for (let ix = 0; ix < TEX_W; ix++) {
        const lon = (ix + 0.5) / TEX_W * TAU;
        const r = RS.planet.biomeAt(p, lon, lat);
        const relief = clamp(0.82 + (r.elev - dat) * 0.35, 0.55, 1.35);
        css[iy * TEX_W + ix] = hsl(r.biome.hue, r.biome.sat, clamp01(r.biome.lum * relief), 1);
      }
    }
    tex = { css, key };
    if (texCache.size >= TEX_MAX) texCache.delete(texCache.keys().next().value);
    texCache.set(key, tex);
    return tex;
  }

  /* Projected-disc cache. Keyed by texture, radius and rotation column. */
  let discCanvas = null, discKey = '';

  function globeDisc(game, p, s, R) {
    const tex = globeTexture(game, p);
    const size = Math.max(2, Math.ceil(R * 2));
    const col = Math.floor((((s.lon % TAU) + TAU) % TAU) / TAU * TEX_W);
    const key = tex.key + '|' + size + '|' + col;
    if (discCanvas && discKey === key) return discCanvas;

    if (!discCanvas) discCanvas = document.createElement('canvas');
    if (discCanvas.width !== size || discCanvas.height !== size) {
      discCanvas.width = size; discCanvas.height = size;
    }
    const g = discCanvas.getContext('2d');
    g.clearRect(0, 0, size, size);

    /* Orthographic projection: screen Y depends only on latitude, and the
     * horizontal position within a row is sin(longitude) scaled by cos(lat) —
     * which is why rows narrow toward the poles on their own. */
    const step = Math.PI / GLOBE_N;
    const c = size / 2;
    for (let iy = 0; iy < GLOBE_N; iy++) {
      const lat = -Math.PI / 2 + (iy + 0.5) * step;
      const cl = Math.cos(lat);
      const rowR = R * cl;
      const y = c - Math.sin(lat) * R;
      const n = Math.max(4, Math.round(GLOBE_N * 2 * cl));
      const ty = clamp(Math.floor((lat + Math.PI / 2) / Math.PI * TEX_H), 0, TEX_H - 1);
      const rowBase = ty * TEX_W;
      const h = step * R + 1.5;
      for (let ix = 0; ix < n; ix++) {
        const lon = s.lon + (-Math.PI / 2 + (ix + 0.5) / n * Math.PI);
        let tx = Math.floor((((lon % TAU) + TAU) % TAU) / TAU * TEX_W);
        if (tx >= TEX_W) tx = TEX_W - 1;
        const xoff = Math.sin((ix + 0.5) / n * Math.PI - Math.PI / 2) * rowR;
        const w = (Math.PI / n) * rowR * 1.25 + 1.5;
        g.fillStyle = tex.css[rowBase + tx];
        g.fillRect(c + xoff - w / 2, y - h / 2, w, h);
      }
    }
    discKey = key;
    return discCanvas;
  }

  /* Orbital view: the planet as a disc, sampled from the baked surface table.
   * The sample count is fixed, so this costs the same on every world. */
  const GLOBE_N = 46;
  function attentionOf(game) {
    if (!game.inhabiting || !game.dials) return 0.5;
    const D = game.dials.space;
    return clamp01((D.value - D.min) / Math.max(1e-6, D.max - D.min));
  }

  function globeProject(s, lon, lat, cx, cy, R) {
    const dlon = RS.scenes.wrapDeltaLon(lon - s.lon);
    if (Math.abs(dlon) > Math.PI * 0.52) return null;
    return {
      x: cx + Math.sin(dlon) * R * Math.cos(lat),
      y: cy - Math.sin(lat) * R
    };
  }

  function drawUnderfootApron(ctx, game, p, s, pinX, pinY, R, attention) {
    const halfSpan = 0.032 + (1 - attention) * 0.058;
    const prof = RS.scenes.terrainProfile(game, halfSpan);
    const n = prof.n;
    const body = game.body;
    const heading = body ? body.heading : 0;
    const mid = Math.floor(n / 2);
    const base = prof.elev[mid];
    const fanR = R * (0.11 + (1 - attention) * 0.09);
    const vscale = px(0.07) * (0.55 + (1 - attention) * 0.85);
    const dat = RS.planet.datum(p);

    ctx.save();
    ctx.translate(pinX, pinY);
    ctx.rotate(heading);
    ctx.globalAlpha = 0.55 + (1 - attention) * 0.35;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let i = 0; i < n; i++) {
      const u = (i / (n - 1)) - 0.5;
      const ang = u * Math.PI * 0.62;
      const elev = prof.elev[i] - base;
      const r = fanR * (0.25 + Math.abs(u) * 1.5);
      const x = Math.sin(ang) * r;
      const y = -Math.cos(ang) * r - elev * vscale;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    const surf = prof.biome[mid] || RS.planet.BIOME_BY_ID.regolith;
    const tg = ctx.createRadialGradient(0, -fanR * 0.2, 0, 0, 0, fanR * 1.4);
    tg.addColorStop(0, hsl(surf.hue, surf.sat, surf.lum * 1.1, 0.92));
    tg.addColorStop(1, hsl(surf.hue - 6, surf.sat * 0.7, surf.lum * 0.35, 0.75));
    ctx.fillStyle = tg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.32)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const u = (i / (n - 1)) - 0.5;
      const ang = u * Math.PI * 0.62;
      const elev = prof.elev[i] - base;
      const r = fanR * (0.25 + Math.abs(u) * 1.5);
      const x = Math.sin(ang) * r;
      const y = -Math.cos(ang) * r - elev * vscale;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    for (let i = 2; i < n - 2; i += 3) {
      const b = prof.biome[i];
      if (!b || prof.elev[i] < dat - 0.02) continue;
      const u = (i / (n - 1)) - 0.5;
      const ang = u * Math.PI * 0.62;
      const elev = prof.elev[i] - base;
      const r = fanR * (0.25 + Math.abs(u) * 1.5);
      const x = Math.sin(ang) * r;
      const y = -Math.cos(ang) * r - elev * vscale;
      if (b.id === 'forest' || b.id === 'jungle' || b.id === 'grass') {
        ctx.strokeStyle = hsl(b.hue, 0.5, 0.28, 0.7);
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (RS.core.hashF(p.hash, i) - 0.5) * 2.5, y - 4 - RS.core.hashF(p.hash, i + 40) * 5);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawAgentsOnGlobe(ctx, game, p, s, cx, cy, R) {
    if (!s.agents || !s.agents.length) return;
    for (let i = 0; i < s.agents.length; i++) {
      const a = s.agents[i];
      const pt = globeProject(s, a.lon, a.lat, cx, cy, R);
      if (!pt) continue;
      const f = a.fauna;
      const hue = f ? f.hue : 120;
      const size = px(0.012);
      ctx.fillStyle = hsl(hue, 0.65, 0.55, 0.85);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, size, 0, TAU);
      ctx.fill();
      if (a.ridden) {
        ctx.strokeStyle = hsl(340, 0.9, 0.72, 0.6);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, size * 2.4, 0, TAU);
        ctx.stroke();
      }
    }
  }

  function drawGlobe(ctx, game, p, s, dt) {
    const cx = V().cx, cy = V().cy;
    const attention = attentionOf(game);
    const zoom = game.inhabiting ? lerp(1.04, 1.14, attention) : 1;
    const R = px(0.62) * zoom;

    /* Space behind. */
    ctx.fillStyle = 'rgba(3,5,10,0.55)';
    ctx.fillRect(0, 0, V().w, V().h);

    /* The projected disc is itself cached to an offscreen canvas and blitted.
     * The projection only changes when the world rotates past a whole texture
     * column, so at a walking pace this re-renders a few times a second and is
     * a single drawImage the rest of the time.
     *
     * Both caches are the same argument at different levels: the surface does
     * not change, and the projection changes slowly. Neither is a departure
     * from deriving everything — the derivation is still the source of truth,
     * it is just not re-run to answer a question whose answer has not moved. */
    ctx.drawImage(globeDisc(game, p, s, R), Math.round(cx - R), Math.round(cy - R));

    /* Specular ocean flash on the day side — one ellipse, not a lighting model. */
    if (p.hydrosphere > 0.12) {
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
      const sg = ctx.createRadialGradient(cx - R * 0.28, cy - R * 0.32, 0, cx - R * 0.28, cy - R * 0.32, R * 0.55);
      sg.addColorStop(0, 'rgba(255,255,255,' + (0.07 + p.hydrosphere * 0.10) + ')');
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      ctx.restore();
    }

    /* Terminator, unless tidally locked — in which case the day side is fixed
     * and the night side is permanent, which the shading should show. */
    const tg = ctx.createRadialGradient(cx - R * 0.4, cy - R * 0.3, R * 0.1, cx, cy, R * 1.25);
    tg.addColorStop(0, 'rgba(255,250,235,0.16)');
    tg.addColorStop(0.55, 'rgba(0,0,0,0)');
    tg.addColorStop(1, 'rgba(0,0,10,0.72)');
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
    ctx.fillStyle = tg;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.restore();

    /* City lights on the night limb. Hashed from the civ, not a stored map. */
    const civ = p.civ || (s.tGyr != null ? RS.civ.civOf(p, s.tGyr) : null);
    if (civ && civ.tech > 0.22) {
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.98, 0, TAU); ctx.clip();
      const nLights = Math.round(6 + civ.tech * 26);
      for (let i = 0; i < nLights; i++) {
        const u = RS.core.hashF(p.hash, 900 + i);
        const v = RS.core.hashF(p.hash, 1100 + i);
        const lx = cx - R + u * R * 2;
        const ly = cy - R + v * R * 2;
        const dx = lx - cx, dy = ly - cy;
        if (dx * dx + dy * dy > R * R * 0.92) continue;
        if (lx < cx - R * 0.02) continue;
        ctx.fillStyle = hsl(42, 0.92, 0.72, 0.22 + civ.tech * 0.5);
        ctx.fillRect(lx, ly, 1.5, 1.5);
      }
      ctx.restore();
    }

    /* Atmosphere limb — thickness follows real pressure. */
    if (p.pressure > 0.01) {
      const hue = p.composition.length ? atmosphereHue(p) : 200;
      const ag = ctx.createRadialGradient(cx, cy, R * 0.97, cx, cy, R * (1.02 + clamp01(p.pressure / 6) * 0.14));
      ag.addColorStop(0, hsl(hue, 0.7, 0.6, 0.55));
      ag.addColorStop(1, hsl(hue, 0.7, 0.6, 0));
      ctx.fillStyle = ag;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.18, 0, TAU); ctx.fill();
    }

    /* Moons on their real orbits. */
    if (p.moons) {
      for (const m of p.moons.list) {
        const mp = RS.orbital.positionAt(m.elements, s.t, {});
        const mr = R * 1.35 + Math.log10(1 + m.a / p.moons.roche) * R * 0.35;
        const a = Math.atan2(mp.y, mp.x);
        const X = cx + Math.cos(a) * mr, Y = cy + Math.sin(a) * mr * 0.5;
        ctx.fillStyle = hsl(30, 0.15, m.tidalHeat > 0.4 ? 0.62 : 0.48, 1);
        ctx.beginPath(); ctx.arc(X, Y, Math.max(1.5, px(0.006) * Math.pow(m.massE / p.massE * 40, 0.3)), 0, TAU); ctx.fill();
      }
    }

    /* Landing reticle while observing; you are the pin while inhabiting. */
    if (!game.inhabiting) {
      const rx = cx, ry = cy - Math.sin(s.lat) * R;
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(rx, ry, 7, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(rx - 12, ry); ctx.lineTo(rx - 8, ry);
      ctx.moveTo(rx + 8, ry); ctx.lineTo(rx + 12, ry); ctx.stroke();
    }

    drawExtractorMarks(ctx, game, p, s, 'globe', { cx, cy, R });

    if (game.inhabiting && game.body) {
      const pinX = cx;
      const pinY = cy + R * (0.30 - attention * 0.06);
      drawUnderfootApron(ctx, game, p, s, pinX, pinY, R, attention);
      drawAgentsOnGlobe(ctx, game, p, s, cx, cy, R);
      const vscale = lerp(1.35, 0.72, attention);
      drawVesselGlyph(ctx, game, pinX, pinY, vscale);
    }
  }

  function extractorsOn(game, p) {
    const list = game.deltas && RS.influence && RS.influence.planetKey
      ? game.deltas[RS.influence.planetKey(p)] : null;
    if (!list) return [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const id = list[i].id;
      if (id === 'extractor' || id === 'catalyst' || id === 'chorus') out.push(list[i]);
    }
    return out;
  }

  /* A sited extractor is a mark on the world, not a cache key. Same sample
   * budgets; the glyph sits on the existing globe / slice / neighbourhood. */
  function drawExtractorMarks(ctx, game, p, s, mode, view) {
    const list = extractorsOn(game, p);
    if (!list.length) return;
    const wrap = RS.scenes.wrapDeltaLon;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      const lon = d.lon != null ? d.lon : s.lon;
      const lat = d.lat != null ? d.lat : s.lat;
      const m = d.progress || 0;
      const a = 0.38 + m * 0.62;
      const glyph = d.id === 'catalyst' ? '\u2697' : d.id === 'chorus' ? '\u25CE' : '\u229E';
      const hue = d.id === 'catalyst' ? 28 : d.id === 'chorus' ? 340 : 40;
      ctx.fillStyle = hsl(hue, 0.92, 0.62, a);
      if (mode === 'globe') {
        const dlon = wrap(lon - s.lon);
        if (Math.abs(dlon) > Math.PI * 0.52) continue;
        const X = view.cx + Math.sin(dlon) * view.R * Math.cos(lat);
        const Y = view.cy - Math.sin(lat) * view.R;
        ctx.font = '700 ' + Math.round(8 + m * 6) + 'px system-ui, sans-serif';
        ctx.fillText(glyph, X, Y);
      }
    }
    ctx.restore();
  }

  function atmosphereHue(p) {
    /* Hue from the dominant gas — a methane world really is blue and a
     * sulphurous one really is yellow, because the composition model said so. */
    const d = p.composition[0];
    if (!d) return 200;
    switch (d.gas.id) {
      case 'CH4': return 195;
      case 'CO2': return 35;
      case 'SO2': return 52;
      case 'N2': return 205;
      case 'O2': return 200;
      case 'H2': return 30;
      case 'He': return 45;
      default: return 190;
    }
  }

  /* Surface view: a side-on slice. The horizon is the elevation field sampled
   * across the visible span, re-evaluated every frame — there is no terrain
   * object anywhere in memory. */
  function drawSurface(ctx, game, p, s) {
    const w = V().w, h = V().h;
    const horizon = V().cy + px(0.35);
    const surf = s.surface || {};

    // ── sky ──
    /* Colour from the atmosphere's composition and thickness, and from the
     * star's own spectral hue. A thin atmosphere gives a black sky with a
     * bright star; a thick one gives a washed, saturated dome. */
    const aHue = atmosphereHue(p);
    const starHue = p.system.primary.cls.hue;
    const thick = clamp01(p.pressure / 2.2);

    /* ── Day and night ───────────────────────────────────────────────────
     *
     * `daylight` is the star's elevation softened through a terminator whose
     * width is the atmosphere's own — so a dense world has a long twilight and
     * an airless one snaps from noon to night, which is why the Moon has no
     * dusk. On a tidally locked world it does not change with time at all: it
     * changes with *longitude*, and half the world never sees the star.
     *
     * Everything below reads this one number, which is why the whole day/night
     * cycle costs a sine and two cosines rather than a lighting model. */
    const lt = s.clock;
    const day = lt && lt.ok ? lt.sun.daylight : 1;
    /* Twilight reddens near the terminator: long path length through the
     * atmosphere scatters the short wavelengths out, and only a world with air
     * can do it. */
    const redshift = clamp01(1 - Math.abs(day - 0.5) * 2) * thick * 34;

    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, hsl(aHue, 0.5 * thick, (0.04 + thick * 0.28) * (0.10 + day * 0.90), 1));
    sky.addColorStop(1, hsl(lerp(aHue, starHue, 0.45) - redshift,
      0.55 * thick * (0.5 + day * 0.5), (0.06 + thick * 0.5) * (0.08 + day * 0.92), 1));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizon);

    /* Stars, visible only where the air is thin enough not to scatter them
     * out — and at night, on any world with air at all, for exactly the same
     * reason. This is the same physics that makes Earth's daytime sky opaque. */
    const starVis = clamp01(clamp01(1 - thick * 1.5) + clamp01(1 - day) * thick);
    if (starVis > 0.02) {
      ctx.fillStyle = 'rgba(255,255,255,' + (starVis * 0.75).toFixed(2) + ')';
      for (let i = 0; i < 90; i++) {
        const hx = RS.core.hashF(p.hash, i * 2) * w;
        const hy = RS.core.hashF(p.hash, i * 2 + 1) * horizon;
        ctx.fillRect(hx, hy, 1.2, 1.2);
      }
    }

    /* The star(s) in the sky, sized by angular diameter — which is a real
     * function of the star's radius and the planet's orbit, so a red dwarf's
     * habitable world genuinely has an enormous sun. */
    for (const sk of RS.stellar.skyStars(p.system, p.a)) {
      const angular = sk.star.radius * RS.stellar.AU_PER_SOLAR_RADIUS / p.a;
      const r = clamp(angular * px(9), 3, px(0.3));
      const X = w * (0.24 + sk.index * 0.3);
      const Y = horizon - px(0.42);
      const sg = ctx.createRadialGradient(X, Y, 0, X, Y, r * 5);
      sg.addColorStop(0, hsl(sk.hue, 0.35, 0.98, 0.95));
      sg.addColorStop(0.2, hsl(sk.hue, 0.8, 0.78, 0.5));
      sg.addColorStop(1, hsl(sk.hue, 0.8, 0.6, 0));
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(X, Y, r * 5, 0, TAU); ctx.fill();
      ctx.fillStyle = hsl(sk.hue, 0.25, 0.98, 1);
      ctx.beginPath(); ctx.arc(X, Y, r, 0, TAU); ctx.fill();
    }

    /* Moons in the sky, because a world with four moons should feel like it. */
    if (p.moons) {
      for (const m of p.moons.list.slice(0, 4)) {
        const mp = RS.orbital.positionAt(m.elements, s.t, {});
        const X = w * (0.5 + Math.cos(Math.atan2(mp.y, mp.x)) * 0.42);
        const Y = horizon - px(0.5) - m.index * px(0.05);
        const mr = clamp(px(0.02) * Math.pow(m.massE / p.massE * 60, 0.3), 2, px(0.06));
        ctx.fillStyle = hsl(30, 0.12, 0.72, 0.85);
        ctx.beginPath(); ctx.arc(X, Y, mr, 0, TAU); ctx.fill();
      }
    }

    // ── terrain ──
    /* Visible span in radians. Wide enough that the surface detail bands in
     * planet.js resolve into hills rather than a straight line, and widening
     * as the body climbs — the same field, sampled at a different scale. */
    const span = 0.09 + s.altitude * 0.9;
    const prof = RS.scenes.terrainProfile(game, span);
    const n = RS.scenes.PROFILE_N;
    const vscale = px(0.5);
    /* The player's own ground height, from the same detailed field the profile
     * uses — mixing the two fields here would float the body above the hill it
     * is standing on. */
    const base = RS.planet.elevationDetailAt(p, s.lon, s.lat);
    const water = (surf.sea != null) ? surf.sea : RS.localtime.waterlineAt(p, s.lon, s.t || 0);

    /* Far/near parallax bands — same heightfield, wider then tighter span, so
     * the horizon has depth without a second mesh. */
    const far = RS.scenes.terrainProfile(game, span * 2.2, profileBuf(s, '__profileFar'));
    drawSilhouette(ctx, far, n, w, h, horizon, base, vscale * 0.42, 0.28, p, s, true);

    // ── weather veil ──
    const press = clamp01(p.pressure / 2.4);
    if (press > 0.04) {
      ctx.fillStyle = hsl(aHue, 0.25, 0.55, press * (0.04 + (1 - day) * 0.08));
      ctx.fillRect(0, 0, w, horizon);
    }

    /* Cloud wisps. Hashed bands, not a cloud map: pressure writes how many,
     * moisture in the profile writes how opaque. */
    if (press > 0.18 && day > 0.08) {
      const nCloud = Math.min(8, Math.round(5 * press));
      for (let i = 0; i < nCloud; i++) {
        const u = RS.core.hashF(p.hash, 50 + i);
        const moist = prof.moist ? prof.moist[Math.min(n - 1, (i * 13) % n)] : 0.4;
        ctx.fillStyle = hsl(aHue, 0.08, 0.93, (0.06 + press * 0.08) * (0.5 + moist));
        const x = ((u + (s.t || 0) * 0.0035 * (0.5 + press)) % 1) * w;
        const y = horizon * (0.12 + RS.core.hashF(p.hash, 61 + i) * 0.38);
        ctx.beginPath();
        ctx.ellipse(x, y, 26 + u * 48, 6 + u * 7, 0, 0, TAU);
        ctx.fill();
      }
    }

    /* Water, if the local ground is below the live (tide-aware) waterline. */
    if (p.hydrosphere > 0) {
      const wy = horizon + (base - water) * vscale;
      if (wy < h) {
        const wg = ctx.createLinearGradient(0, wy, 0, h);
        wg.addColorStop(0, hsl(200, 0.6, 0.34, 0.85));
        wg.addColorStop(1, hsl(210, 0.7, 0.14, 0.95));
        ctx.fillStyle = wg;
        ctx.fillRect(0, wy, w, h - wy);
        /* Splash at the tide line — denser when the tide is running. */
        const tideH = s.clock && s.clock.tide ? s.clock.tide.height : 0;
        if (tideH > 0.04) {
          ctx.fillStyle = hsl(195, 0.45, 0.85, 0.18 + tideH * 0.35);
          for (let i = 0; i < 18; i++) {
            const sx0 = RS.core.hashF(p.hash, 90 + i) * w;
            const bob = Math.sin((s.t || 0) * 40 + i) * 3;
            ctx.fillRect(sx0, wy - 2 + bob, 3, 3);
          }
        }
      }
    }

    /* Multi-biome land: one trapezoid per profile sample, 96 fills, fixed. */
    for (let i = 0; i < n - 1; i++) {
      const x0 = (i / (n - 1)) * w;
      const x1 = ((i + 1) / (n - 1)) * w;
      const y0 = horizon + (base - prof.elev[i]) * vscale;
      const y1 = horizon + (base - prof.elev[i + 1]) * vscale;
      const b = prof.biome[i] || surf.biome || RS.planet.BIOME_BY_ID.regolith;
      ctx.beginPath();
      ctx.moveTo(x0, h); ctx.lineTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x1, h);
      ctx.closePath();
      const tg = ctx.createLinearGradient(0, Math.min(y0, y1) - px(0.05), 0, h);
      tg.addColorStop(0, hsl(b.hue, b.sat, b.lum * 1.15, 1));
      tg.addColorStop(1, hsl(b.hue - 8, b.sat * 0.8, b.lum * 0.4, 1));
      ctx.fillStyle = tg;
      ctx.fill();
    }

    /* Vegetation, rock and seam glints from the same 96 samples. Extra
     * geometry, not extra geology — the profile already answered. */
    for (let i = 0; i < n; i += 2) {
      const b = prof.biome[i];
      if (!b) continue;
      const x = (i / (n - 1)) * w;
      const y = horizon + (base - prof.elev[i]) * vscale;
      const hsh = RS.core.hashF(p.hash, 70 + i);
      if (y > h - 4) continue;
      if (b.id === 'forest' || b.id === 'jungle' || b.id === 'grass') {
        const ht = (b.id === 'jungle' ? 13 : b.id === 'forest' ? 9 : 4.5) * (0.55 + hsh);
        ctx.strokeStyle = hsl(b.hue, 0.55, 0.26, 0.72);
        ctx.lineWidth = b.id === 'grass' ? 1 : 1.35;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (hsh - 0.5) * 3.2, y - ht);
        ctx.stroke();
      } else if (b.id === 'mountain' || b.id === 'badlands' || b.id === 'crystal') {
        ctx.fillStyle = hsl(b.hue, b.sat * 0.5, b.lum * 1.15, 0.55);
        ctx.beginPath();
        ctx.moveTo(x - 2.2, y);
        ctx.lineTo(x, y - 3.4 - hsh * 3);
        ctx.lineTo(x + 2.2, y);
        ctx.fill();
      }
    }
    ctx.fillStyle = 'rgba(255, 226, 150, 0.78)';
    for (let i = 4; i < n; i += 8) {
      if (RS.core.hashF(p.hash, 880 + i) < 0.35) continue;
      const x = (i / (n - 1)) * w;
      const y = horizon + (base - prof.elev[i]) * vscale;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin((s.t || 0) * 2.6 + i));
      ctx.globalAlpha = tw;
      ctx.fillRect(x - 1.4, y - 2.2, 2.8, 2.8);
    }
    ctx.globalAlpha = 1;

    /* Dust / weather particles scaled by pressure. A vacuum has none. */
    if (press > 0.08 && day > 0.15) {
      const nDust = Math.round(22 * press);
      ctx.fillStyle = hsl(38, 0.25, 0.7, 0.18 * press);
      for (let i = 0; i < nDust; i++) {
        const u = RS.core.hashF(p.hash, 200 + i);
        const x = ((u + (s.t || 0) * 0.015 * (0.4 + press)) % 1) * w;
        const y = horizon * (0.3 + RS.core.hashF(p.hash, 400 + i) * 0.7);
        ctx.fillRect(x, y, 1.6, 1.6);
      }
    }

    /* A rim light along the horizon line reads as atmosphere scattering and
     * separates ground from sky far better than a hard edge. */
    ctx.strokeStyle = hsl(lerp(aHue, starHue, 0.5), 0.7, 0.7, 0.25 + thick * 0.4);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * w;
      const y = horizon + (base - prof.elev[i]) * vscale;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // ── agents ──
    for (const a of s.agents) drawAgent(ctx, game, a, horizon, vscale, base, prof.elev, n, w);

    drawExtractorMarks(ctx, game, p, s, 'sideon');

    // ── the player's body ──
    drawBody(ctx, game, horizon, vscale, base, w);
  }

  function profileBuf(s, key) {
    return s[key] || (s[key] = {
      elev: new Float32Array(RS.scenes.PROFILE_N),
      moist: new Float32Array(RS.scenes.PROFILE_N),
      biome: new Array(RS.scenes.PROFILE_N),
      n: RS.scenes.PROFILE_N
    });
  }

  function drawSilhouette(ctx, prof, n, w, h, horizon, base, vscale, alpha, p, s, far) {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * w;
      const y = horizon + (base - prof.elev[i]) * vscale + (far ? px(0.08) : 0);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    const b = (s.surface && s.surface.biome) || RS.planet.BIOME_BY_ID.regolith;
    ctx.fillStyle = hsl(b.hue, b.sat * 0.7, b.lum * 0.55, alpha);
    ctx.fill();
  }

  function groundAt(prof, n, w, screenX) {
    const u = clamp01(screenX / w);
    const fi = u * (n - 1);
    const i0 = Math.floor(fi), i1 = Math.min(n - 1, i0 + 1);
    const elev = prof.elev || prof;
    return lerp(elev[i0], elev[i1], fi - i0);
  }

  function drawAgent(ctx, game, a, horizon, vscale, base, prof, n, w) {
    const X = w * (0.5 + a.x * 0.42);
    const ground = groundAt(prof, n, w, X);
    const Y = horizon + (base - ground) * vscale + a.y * vscale * 0.35;
    const f = a.fauna;
    const size = clamp(px(0.012) * Math.pow(Math.max(0.05, f.massKg), 0.22), 2.5, px(0.06));

    /* Arousal from the mind drives a visible pulse — you can see a creature
     * getting agitated before it does anything, which is the whole reason to
     * surface the network's internal state at all. */
    const pulse = 1 + a.state.arousal * 0.28;
    const hue = f.hue;

    ctx.save();
    ctx.translate(X, Y);
    ctx.fillStyle = hsl(hue, 0.6, a.ridden ? 0.78 : 0.52, 0.95);
    ctx.strokeStyle = hsl(hue, 0.7, 0.7, 0.9);
    ctx.lineWidth = 1.2;

    /* Body plan drives the silhouette. Not decoration — the plan came from the
     * planet's gravity, so a heavy world visibly has squat, many-limbed life. */
    switch (f.plan) {
      case 'radial':
        for (let i = 0; i < Math.max(3, f.limbs); i++) {
          const ang = (i / Math.max(3, f.limbs)) * TAU + a.heading;
          ctx.beginPath(); ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(ang) * size * 1.6 * pulse, Math.sin(ang) * size * 1.6 * pulse);
          ctx.stroke();
        }
        break;
      case 'sessile':
      case 'rooted':
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(0, -size * 2.2 * pulse); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, -size * 2.2 * pulse, size * 0.7, 0, TAU); ctx.fill();
        break;
      case 'colonial':
        for (let i = 0; i < 5; i++) {
          const ang = i * 1.3 + a.heading;
          ctx.beginPath();
          ctx.arc(Math.cos(ang) * size, Math.sin(ang) * size * 0.6 - size, size * 0.45 * pulse, 0, TAU);
          ctx.fill();
        }
        break;
      case 'segmented':
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.ellipse(-i * size * 0.8 * Math.cos(a.heading), -size - i * size * 0.15,
            size * 0.6 * pulse, size * 0.45, 0, 0, TAU);
          ctx.fill();
        }
        break;
      case 'amorphous':
        ctx.beginPath();
        for (let i = 0; i <= 12; i++) {
          const ang = (i / 12) * TAU;
          const rr = size * (1 + Math.sin(ang * 3 + a.state.arousal * 6) * 0.3) * pulse;
          const xx = Math.cos(ang) * rr, yy = Math.sin(ang) * rr * 0.7 - size;
          i === 0 ? ctx.moveTo(xx, yy) : ctx.lineTo(xx, yy);
        }
        ctx.closePath(); ctx.fill();
        break;
      default: // bilateral
        ctx.beginPath();
        ctx.ellipse(0, -size, size * 1.15 * pulse, size * 0.7 * pulse, 0, 0, TAU);
        ctx.fill();
        for (let i = 0; i < Math.min(6, f.limbs); i++) {
          const off = (i - f.limbs / 2) * size * 0.4;
          ctx.beginPath();
          ctx.moveTo(off, -size * 0.5);
          ctx.lineTo(off + Math.sin(a.state.arousal * 8 + i) * size * 0.3, 0);
          ctx.stroke();
        }
    }

    /* Possession halo when the player is riding this one. */
    if (a.ridden) {
      ctx.strokeStyle = hsl(340, 0.9, 0.72, 0.5 + Math.sin(game.scene.t * 40) * 0.2);
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(0, -size, size * 2.6, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  function drawBody(ctx, game, horizon, vscale, base, w) {
    const body = game.body;
    const X = w * 0.5;
    const Y = horizon + body.y * vscale * 0.35;
    drawVesselGlyph(ctx, game, X, Y);
  }

  /* ── Freeroam neighbourhood ───────────────────────────────────────────────
   *
   * A player-centred disc of biome-coloured samples. Fixed 48×32 budget, not
   * a mesh. Zoom opens with altitude / Σ so climbing shows more of the sphere
   * without sampling more cells. */
  const biomeColCache = new Map();
  const BIOME_COL_MAX = 2400;

  function biomeCached(p, lon, lat, epoch) {
    const lonBin = Math.floor(RS.planet.wrapLon(lon) / TAU * 192);
    const latBin = Math.floor(clamp((lat + Math.PI / 2) / Math.PI, 0, 0.999) * 96);
    const key = (p.hash >>> 0) + ':' + lonBin + ':' + latBin;
    let b = biomeColCache.get(key);
    if (b) return b;
    b = RS.planet.biomeAt(p, lon, lat, epoch).biome;
    if (biomeColCache.size >= BIOME_COL_MAX) biomeColCache.clear();
    biomeColCache.set(key, b);
    return b;
  }

  let hoodCanvas = null, hoodKey = '';

  function drawFreeroam(ctx, game, p, s) {
    const w = V().w, h = V().h;
    const span = 0.16 * (1 + s.altitude * 2.4);
    const FW = RS.scenes.FREE_W, FH = RS.scenes.FREE_H;
    const spanLat = span * (FH / FW);
    const epoch = s.t || 0;
    const lonBin = Math.floor(RS.planet.wrapLon(s.lon) / TAU * 256);
    const latBin = Math.floor(clamp((s.lat + Math.PI / 2) / Math.PI, 0, 0.999) * 128);
    const key = (p.hash >>> 0) + '|' + w + 'x' + h + '|' + lonBin + '|' + latBin + '|' + Math.round(span * 200);

    if (!hoodCanvas) hoodCanvas = document.createElement('canvas');
    if (hoodCanvas.width !== w || hoodCanvas.height !== h) {
      hoodCanvas.width = w; hoodCanvas.height = h;
      hoodKey = '';
    }
    if (hoodKey !== key) {
      const g = hoodCanvas.getContext('2d');
      const cellW = w / FW, cellH = h / FH;
      const dat = RS.planet.datum(p);
      g.fillStyle = 'rgba(4,8,14,0.92)';
      g.fillRect(0, 0, w, h);
      for (let iy = 0; iy < FH; iy++) {
        const lat = RS.planet.clampLat(s.lat - (iy / (FH - 1) - 0.5) * spanLat * 2);
        let prevElev = null;
        for (let ix = 0; ix < FW; ix++) {
          const lon = s.lon + (ix / (FW - 1) - 0.5) * span * 2;
          const b = biomeCached(p, lon, lat, epoch);
          const elev = RS.planet.elevationAt(p, lon, lat);
          let relief = clamp(0.78 + (elev - dat) * 0.4, 0.5, 1.35);
          if (prevElev != null) relief = clamp(relief + (elev - prevElev) * 0.55, 0.42, 1.5);
          g.fillStyle = hsl(b.hue, b.sat, clamp01(b.lum * relief), 1);
          g.fillRect(Math.floor(ix * cellW), Math.floor(iy * cellH), Math.ceil(cellW) + 1, Math.ceil(cellH) + 1);
          const bid = b.id;
          if (bid === 'mountain' || bid === 'forest' || bid === 'jungle' || bid === 'crystal') {
            const spark = RS.core.hashF(p.hash, (ix * 31 + iy * 17 + 4) | 0);
            if (spark > 0.78) {
              g.fillStyle = bid === 'crystal' ? 'rgba(180,230,255,0.45)' : 'rgba(18,42,28,0.32)';
              const x = Math.floor(ix * cellW), y = Math.floor(iy * cellH);
              g.fillRect(x + cellW * 0.3, y + cellH * 0.25, cellW * 0.35, cellH * 0.4);
            }
          }
          prevElev = elev;
        }
      }
      hoodKey = key;
    }
    ctx.drawImage(hoodCanvas, 0, 0);

    /* Agents in world lon/lat. */
    for (const a of s.agents) {
      const dlon = RS.scenes.wrapDeltaLon((a.lon != null ? a.lon : s.lon) - s.lon);
      const dlat = (a.lat != null ? a.lat : s.lat) - s.lat;
      const X = w * 0.5 + (dlon / (span * 2)) * w;
      const Y = h * 0.5 - (dlat / (spanLat * 2)) * h;
      if (X < -8 || X > w + 8 || Y < -8 || Y > h + 8) continue;
      ctx.fillStyle = hsl(a.fauna.hue, 0.6, a.ridden ? 0.78 : 0.55, 0.95);
      ctx.beginPath(); ctx.arc(X, Y, 3.2, 0, TAU); ctx.fill();
    }

    drawVesselGlyph(ctx, game, w * 0.5, h * 0.5);
    drawExtractorMarks(ctx, game, p, s, 'freeroam');
    /* Heading tick so the map reads as a body, not a cursor. */
    const body = game.body;
    const hd = body.heading || 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.5);
    ctx.lineTo(w * 0.5 + Math.cos(hd) * 16, h * 0.5 - Math.sin(hd) * 16);
    ctx.stroke();
  }

  function drawVesselSilhouette(ctx, arch, body, size, hue) {
    const id = arch.id;
    const phase = body.gaitPhase || body.strokePhase || 0;
    const bank = body.bank || 0;
    ctx.save();
    ctx.rotate(bank * 0.35);
    ctx.strokeStyle = hsl(hue, 0.85, 0.72, 1);
    ctx.fillStyle = hsl(hue, 0.45, 0.82, 1);
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (id === 'walker' || id === 'harvester') {
      const step = Math.sin(phase * TAU);
      ctx.beginPath();
      ctx.moveTo(-size * 0.5, size * 0.2);
      ctx.lineTo(0, -size * 0.5);
      ctx.lineTo(size * 0.5, size * 0.2);
      ctx.closePath();
      ctx.fill();
      const leg = size * 0.55 * (0.4 + step * 0.6);
      ctx.beginPath();
      ctx.moveTo(-size * 0.35, size * 0.2); ctx.lineTo(-size * 0.35, size * 0.2 + leg);
      ctx.moveTo(size * 0.35, size * 0.2); ctx.lineTo(size * 0.35, size * 0.2 - leg * 0.7);
      ctx.stroke();
    } else if (id === 'rover') {
      ctx.fillRect(-size * 0.7, -size * 0.15, size * 1.4, size * 0.35);
      ctx.beginPath();
      ctx.arc(-size * 0.45, size * 0.25, size * 0.22, 0, TAU);
      ctx.arc(size * 0.45, size * 0.25, size * 0.22, 0, TAU);
      ctx.fill();
    } else if (id === 'flier') {
      ctx.beginPath();
      ctx.moveTo(-size * 0.9, size * 0.1);
      ctx.lineTo(0, -size * 0.35);
      ctx.lineTo(size * 0.9, size * 0.1);
      ctx.lineTo(0, size * 0.15);
      ctx.closePath();
      ctx.fill();
    } else if (id === 'lander') {
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.55);
      ctx.lineTo(-size * 0.45, size * 0.35);
      ctx.lineTo(size * 0.45, size * 0.35);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-size * 0.3, size * 0.35); ctx.lineTo(-size * 0.3, size * 0.65);
      ctx.moveTo(size * 0.3, size * 0.35); ctx.lineTo(size * 0.3, size * 0.65);
      ctx.stroke();
    } else if (id === 'swimmer') {
      const w = Math.sin(phase * TAU);
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 0.55, size * 0.28, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-size * 0.5, 0);
      ctx.quadraticCurveTo(-size * 0.9, -size * 0.5 * w, -size * 1.1, 0);
      ctx.stroke();
    } else if (id === 'ciliate') {
      for (let i = 0; i < 6; i++) {
        const ang = i * TAU / 6 + phase * 0.4;
        const wob = Math.sin(phase * TAU + i) * size * 0.25;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * size * 0.2, Math.sin(ang) * size * 0.2);
        ctx.lineTo(Math.cos(ang) * (size * 0.75 + wob), Math.sin(ang) * (size * 0.75 + wob));
        ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(0, 0, size * 0.22, 0, TAU); ctx.fill();
    } else if (id === 'flucton') {
      ctx.beginPath();
      ctx.arc(-size * 0.28, 0, size * 0.22, 0, TAU);
      ctx.arc(size * 0.28, 0, size * 0.22, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = hsl(hue, 0.9, 0.7, 0.7);
      ctx.beginPath();
      ctx.moveTo(-size * 0.06, 0); ctx.lineTo(size * 0.06, 0);
      ctx.stroke();
    } else if (id === 'courier' || id === 'probe') {
      ctx.beginPath();
      ctx.moveTo(size * 0.6, 0);
      ctx.lineTo(-size * 0.35, -size * 0.35);
      ctx.lineTo(-size * 0.15, 0);
      ctx.lineTo(-size * 0.35, size * 0.35);
      ctx.closePath();
      ctx.fill();
    } else if (id === 'symbiont') {
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.65);
      ctx.lineTo(size * 0.5, 0);
      ctx.lineTo(0, size * 0.65);
      ctx.lineTo(-size * 0.5, 0);
      ctx.closePath();
      ctx.fill();
    } else if (id === 'weaver') {
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = i * TAU / 3 - Math.PI / 2;
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * size * 0.75, Math.sin(a) * size * 0.75);
      }
      ctx.stroke();
    } else if (id === 'mote') {
      ctx.beginPath(); ctx.arc(0, 0, size * 0.35, 0, TAU); ctx.fill();
    } else {
      ctx.font = '700 ' + Math.round(size * 1.4) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(arch.glyph, 0, 0);
    }
    ctx.restore();
  }

  function drawVesselGlyph(ctx, game, X, Y, scale) {
    const body = game.body;
    if (!body) return;
    const arch = RS.vessel.archOf(body);
    const size = px(0.022) * (scale || 1);

    ctx.save();
    ctx.translate(X, Y);
    ctx.rotate(body.heading || 0);

    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 3.2);
    glow.addColorStop(0, hsl(arch.hue, 0.8, 0.8, 0.5));
    glow.addColorStop(1, hsl(arch.hue, 0.8, 0.6, 0));
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, size * 3.2, 0, TAU); ctx.fill();

    drawVesselSilhouette(ctx, arch, body, size, arch.hue);

    ctx.restore();

    const cf = body.charge / arch.capacity;
    ctx.strokeStyle = hsl(cf > 0.25 ? 160 : 0, 0.85, 0.6, 0.8);
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(X, Y, size * 2.1, -Math.PI / 2, -Math.PI / 2 + TAU * clamp01(cf));
    ctx.stroke();

    ctx.strokeStyle = hsl(arch.hue, 0.9, 0.75, 0.9);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(X, Y);
    ctx.lineTo(X + Math.cos(body.heading || 0) * size * 2.8,
      Y + Math.sin(body.heading || 0) * size * 2.8);
    ctx.stroke();
  }

  RS.worldrender = { drawSystem, drawPlanet, radiusMap, bodyScreen, atmosphereHue,
    globeTexture, globeDisc, drawVesselGlyph, attentionOf, globeProject,
    clearTextureCache() { texCache.clear(); discCanvas = null; discKey = ''; biomeColCache.clear(); hoodCanvas = null; hoodKey = ''; } };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
