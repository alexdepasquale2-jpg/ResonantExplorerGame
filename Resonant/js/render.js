/* Resonant — the renderer.
 *
 * The field is drawn in normalised space: the origin is the point of
 * consciousness, and radius 1.0 is the rim. Everything scales off `view.R` so
 * the same code is correct on a phone in portrait and a desktop in landscape.
 *
 * Draw order is deliberate and is itself part of the feedback design:
 *
 *   backdrop     the tier's geometry, faint — this is *where* you are
 *   layer wash   the band's palette bleeding in — this is *what layer* you are in
 *   beat ring    a ring pulsing at the audio beat rate — visual tuning aid
 *   nodes        unresolved smudges → resolved manifestations
 *   reticle      per-dial alignment arcs for the node you are closest to
 *   centre       you
 *   particles    the harvest, arriving
 *   post         flash, vignette, aberration
 *
 * The reticle matters more than it looks. A four-dial lock that fails without
 * telling you *which* dial is wrong is not difficulty, it is noise — so the
 * four arcs around the centre are a permanent readout of exactly how wrong
 * each axis is, and they are the difference between the game feeling precise
 * and feeling arbitrary.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, damp, ease, hsl, TAU, fmt } = RS.core;

  const view = { w: 0, h: 0, dpr: 1, cx: 0, cy: 0, R: 1 };

  /* Smoothed visuals — the renderer never reads a raw game value directly,
   * because every one of them can change instantly and nothing on screen is
   * allowed to. */
  const vis = {
    hue: new RS.core.Spring(205, 60, 15),
    sat: new RS.core.Spring(0.3, 60, 15),
    strength: new RS.core.Spring(0, 70, 16),
    tierMix: new RS.core.Spring(RS.cosmos.ROOT_INDEX, 90, 18),
    beatPhase: 0,
    starT: 0
  };

  function resize(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    view.w = w; view.h = h; view.dpr = dpr;
    view.cx = w / 2;

    /* Centre the world in the space that is actually free, not in the raw
     * viewport. The instrument cluster owns the bottom of the screen and the
     * topbar owns a strip at the top, so the usable band is between them —
     * centring in the viewport buries the world behind the dials on a phone
     * and leaves a dead gap on a tall screen. `clusterTop` comes from the HUD
     * layout, which is the authority on where the instruments start. */
    const top = h * 0.13;
    const bottom = (RS.hud && RS.hud.layout.clusterTop) ? RS.hud.layout.clusterTop : h * 0.78;
    const band = Math.max(120, bottom - top);
    view.cy = top + band * 0.5;
    /* Radius fits the narrower of the two axes, with a little margin so ripples
     * and rim glows are not clipped. */
    view.R = Math.min(w * 0.46, band * 0.46);
    return view;
  }

  const px = v => v * view.R;
  const sx = x => view.cx + x * view.R;
  const sy = y => view.cy + y * view.R;

  // --- backdrops -----------------------------------------------------------

  /* Each tier geometry gets its own faint backdrop. These are cheap on
   * purpose: they must run at 60fps on a phone while everything else is also
   * happening, so none of them allocate and none of them use shadows. */
  function drawBackdrop(ctx, game, geom, hue, alpha, t) {
    if (alpha < 0.004) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(1, px(0.003));

    switch (geom) {
      case 'foam': {
        /* Seething sub-structure: many tiny dots, re-hashed each frame band so
         * it genuinely boils rather than scrolls. */
        const n = 200;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU * 7.3;
          const r = (RS.core.hashF(i, 1) * 0.98);
          const flick = RS.core.noise2(i, t * 3.4, r * 6);
          if (flick < 0.42) continue;
          const rr = r + Math.sin(t * 2 + i) * 0.012;
          ctx.fillStyle = hsl(hue + i % 40, 0.7, 0.55, flick * 0.5);
          const s = px(0.004 + flick * 0.006);
          ctx.fillRect(sx(Math.cos(a) * rr) - s / 2, sy(Math.sin(a) * rr) - s / 2, s, s);
        }
        break;
      }
      case 'orbital': {
        for (let i = 1; i <= 7; i++) {
          const r = i / 7.4;
          ctx.strokeStyle = hsl(hue, 0.55, 0.55, 0.16 * (1 - r * 0.4));
          ctx.beginPath();
          ctx.ellipse(view.cx, view.cy, px(r), px(r * (0.55 + 0.45 * Math.sin(t * 0.3 + i))), t * 0.05 * i, 0, TAU);
          ctx.stroke();
        }
        break;
      }
      case 'chain': {
        for (let s = 0; s < 5; s++) {
          ctx.strokeStyle = hsl(hue + s * 9, 0.5, 0.5, 0.16);
          ctx.beginPath();
          for (let i = 0; i <= 60; i++) {
            const u = i / 60;
            const a = u * TAU + s * 1.25 + t * 0.09;
            const r = 0.18 + u * 0.78 + Math.sin(u * 15 + t) * 0.03;
            const fn = i === 0 ? 'moveTo' : 'lineTo';
            ctx[fn](sx(Math.cos(a) * r), sy(Math.sin(a) * r));
          }
          ctx.stroke();
        }
        break;
      }
      case 'cell': {
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * TAU + t * 0.05;
          const r = 0.32 + RS.core.hashF(i, 3) * 0.55;
          const rad = 0.09 + RS.core.hashF(i, 4) * 0.13;
          const wob = 1 + Math.sin(t * 0.9 + i) * 0.09;
          ctx.strokeStyle = hsl(hue + i * 5, 0.5, 0.5, 0.18);
          ctx.beginPath();
          ctx.ellipse(sx(Math.cos(a) * r), sy(Math.sin(a) * r), px(rad * wob), px(rad / wob), a, 0, TAU);
          ctx.stroke();
        }
        break;
      }
      case 'body': {
        ctx.strokeStyle = hsl(hue, 0.42, 0.5, 0.2);
        for (let i = 0; i < 4; i++) {
          const r = 0.25 + i * 0.21;
          ctx.beginPath();
          ctx.arc(view.cx, view.cy, px(r), Math.PI * (0.08 + i * 0.03), Math.PI * (0.92 - i * 0.03));
          ctx.stroke();
        }
        break;
      }
      case 'disc': {
        /* Spiral density waves — the root tier's signature, so it gets the
         * most attention of any backdrop. */
        const arms = 4;
        for (let a0 = 0; a0 < arms; a0++) {
          ctx.strokeStyle = hsl(hue + a0 * 7, 0.6, 0.56, 0.2);
          ctx.lineWidth = Math.max(1, px(0.006));
          ctx.beginPath();
          for (let i = 0; i <= 70; i++) {
            const u = i / 70;
            const r = 0.06 + u * 1.02;
            const a = (a0 / arms) * TAU + u * 2.7 + t * 0.045;
            const fn = i === 0 ? 'moveTo' : 'lineTo';
            ctx[fn](sx(Math.cos(a) * r), sy(Math.sin(a) * r * 0.86));
          }
          ctx.stroke();
        }
        break;
      }
      case 'web': {
        /* Filaments between quasi-stable nodes; voids are what is left over. */
        const N = 16;
        ctx.strokeStyle = hsl(hue, 0.45, 0.55, 0.14);
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const ai = RS.core.hashF(i, 5) * TAU + t * 0.02;
          const ri = 0.2 + RS.core.hashF(i, 6) * 0.85;
          for (let j = i + 1; j < N; j++) {
            const aj = RS.core.hashF(j, 5) * TAU + t * 0.02;
            const rj = 0.2 + RS.core.hashF(j, 6) * 0.85;
            const x1 = Math.cos(ai) * ri, y1 = Math.sin(ai) * ri;
            const x2 = Math.cos(aj) * rj, y2 = Math.sin(aj) * rj;
            if (Math.hypot(x2 - x1, y2 - y1) > 0.42) continue;
            ctx.moveTo(sx(x1), sy(y1)); ctx.lineTo(sx(x2), sy(y2));
          }
        }
        ctx.stroke();
        break;
      }
      case 'abstract': {
        /* No spatial metaphor survives up here, so the backdrop stops
         * pretending to be a place and becomes a relation graph. */
        const N = 11;
        for (let i = 0; i < N; i++) {
          const a = (i / N) * TAU;
          const r = 0.72 + Math.sin(t * 0.4 + i) * 0.05;
          const x = sx(Math.cos(a) * r), y = sy(Math.sin(a) * r);
          ctx.fillStyle = hsl(hue, 0.3, 0.7, 0.35);
          ctx.beginPath(); ctx.arc(x, y, px(0.008), 0, TAU); ctx.fill();
          for (let j = i + 1; j < N; j++) {
            if ((i * j + Math.floor(t * 0.4)) % 5 !== 0) continue;
            const b = (j / N) * TAU;
            ctx.strokeStyle = hsl(hue, 0.3, 0.6, 0.09);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(sx(Math.cos(b) * r), sy(Math.sin(b) * r));
            ctx.stroke();
          }
        }
        break;
      }
    }
    ctx.restore();
  }

  // --- manifestations ------------------------------------------------------

  /* An unresolved node: you can see that *something* is there and nothing
   * more. The jitter is deliberate — a still smudge reads as a rendering bug,
   * a jittering one reads as a signal you have not locked. */
  function drawSmudge(ctx, x, y, r, hue, alpha, t, seed) {
    const j = 0.006 * (1 - alpha);
    const jx = Math.sin(t * 9 + seed) * j, jy = Math.cos(t * 11 + seed * 1.7) * j;
    const g = ctx.createRadialGradient(sx(x + jx), sy(y + jy), 0, sx(x + jx), sy(y + jy), px(r * 2.2));
    g.addColorStop(0, hsl(hue, 0.4, 0.6, 0.30 * alpha));
    g.addColorStop(0.5, hsl(hue, 0.4, 0.5, 0.11 * alpha));
    g.addColorStop(1, hsl(hue, 0.4, 0.5, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sx(x + jx), sy(y + jy), px(r * 2.2), 0, TAU);
    ctx.fill();
  }

  /* The essence glyphs. Each is drawn from the manifestation's own derived
   * parameters, so two instances of the same essence are recognisably the same
   * shape without being identical drawings. */
  /* ── One generator, every essence ────────────────────────────────────────
   *
   * This used to be fourteen hand-drawn cases — a spiral routine, a lattice
   * routine, a cascade routine. They looked fine and they proved nothing: two
   * shapes drawn by two unrelated functions are alike only because someone
   * said so. Now every essence comes out of `selfsimilar.build()`, driven by
   * the same four axes that drive its behaviour, and `geometry` decides only
   * how the ink is laid down.
   *
   * So a Cascade in a molecular tier and a Cascade in a filament tier are the
   * same skeleton rendered as bonds and as filaments — demonstrably the same
   * essence rather than nominally so — and a player can see the kinship before
   * they can name it. It also reaches the 42 form names that were previously
   * unreachable, because a geometry is no longer tied to a hand-written case.
   */
  function drawEssence(ctx, man, x, y, r, hue, alpha, t) {
    const geom = (RS.cosmos.TIERS[man.tierIndex] || RS.cosmos.TIERS[0]).geometry;
    /* Cached on the manifestation: the skeleton is pure in (essence, geometry,
     * seed), so it is built once and redrawn every frame for free. */
    let buf = man.__ss;
    if (!buf || buf.__geom !== geom) {
      buf = man.__ss = RS.selfsimilar.build(man.essence, geom, man.seed, buf);
      buf.__geom = geom;
    }
    ctx.save();
    ctx.translate(sx(x), sy(y));
    ctx.rotate(t * 0.15 * man.twist);
    /* Fitted rather than scaled, so a branching essence and a converging one
     * occupy the same footprint on screen — otherwise a Cascade node reads as
     * five times the size of an Attractor node of identical potency, and size
     * is supposed to mean something. */
    RS.selfsimilar.draw(ctx, buf, 0, 0, RS.selfsimilar.fit(buf, px(r) * 1.6),
      hue, man.sat + 0.15, alpha, t);
    ctx.restore();
  }

  /* ── The cell ─────────────────────────────────────────────────────────────
   *
   * Organelles are essences, and they are drawn by the *same* generator that
   * draws a galaxy — `selfsimilar` with geometry `cell`, which lays the same
   * skeleton down as soft lobes instead of spiral arms. So a Cascade in here
   * is visibly the Cascade you met at the galactic rung, and the four `cell`
   * form names that were written and unreachable finally appear.
   */
  function drawCell(ctx, game, t) {
    const c = game.scene.cell;
    if (!c) return;
    const ct = game.scene.cellT || 0;

    /* Cytoplasmic streaming, drawn as a faint rotating wash so the interior is
     * never still — a static cell reads as a diagram rather than a living
     * thing. */
    const g = ctx.createRadialGradient(view.cx, view.cy, 0, view.cx, view.cy, px(1.0));
    g.addColorStop(0, hsl(c.type.hue, 0.4, 0.30, 0.20));
    g.addColorStop(1, hsl(c.type.hue - 20, 0.4, 0.12, 0.06));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(view.cx, view.cy, px(1.0), 0, TAU); ctx.fill();

    for (let i = 0; i < c.organelles.length; i++) {
      const o = c.organelles[i];
      /* Each drifts on its own slow circle — streaming, not orbit. */
      const a = Math.atan2(o.y, o.x) + ct * o.drift;
      const r = Math.hypot(o.x, o.y) * (1 + Math.sin(ct * 0.8 + o.phase) * 0.05);
      const x = Math.cos(a) * r, y = Math.sin(a) * r;

      let buf = o.__ss;
      if (!buf) buf = o.__ss = RS.selfsimilar.build(o.essence, 'cell', i * 7919 + 13, buf);
      /* Kept inside the membrane. The generator's extent depends on the
       * essence — a branching one reaches much further than a converging one
       * from the same nominal size — so scale against the room actually left
       * between here and the wall rather than against a constant. */
      const room = Math.max(0.14, 0.95 - r);
      ctx.save();
      ctx.translate(sx(x), sy(y));
      ctx.rotate(ct * 0.12 * (i % 2 ? 1 : -1));
      RS.selfsimilar.draw(ctx, buf, 0, 0,
        RS.selfsimilar.fit(buf, px(Math.min(o.size * 3.4, room))), o.hue, 0.75, 1.0, t);
      ctx.restore();
    }
  }

  /* ── The cosmic web ──────────────────────────────────────────────────────
   *
   * Drawn as a function of cosmic time, so scrubbing τ visibly assembles it:
   * uncollapsed overdensities are faint smears, collapsed ones are bright, and
   * filaments appear between them only once the growing mode has had time to
   * bridge the gap. A node currently at peak growth rate gets a halo, because
   * "assembling now" is the thing the scope pays for and a player has to be
   * able to see it rather than infer it from a number.
   */
  function drawWeb(ctx, game, t) {
    const w = game.scene.web;
    if (!w) return;

    /* Filaments first, under everything. */
    ctx.lineCap = 'round';
    for (let i = 0; i < w.links.length; i++) {
      const L = w.links[i];
      const a = w.nodes[L.a], b = w.nodes[L.b];
      ctx.strokeStyle = hsl(276, 0.45, 0.55, 0.06 + L.strength * 0.30);
      ctx.lineWidth = Math.max(0.6, px(0.002 + L.strength * 0.006));
      ctx.beginPath();
      ctx.moveTo(sx(a.x), sy(a.y));
      ctx.lineTo(sx(b.x), sy(b.y));
      ctx.stroke();
    }

    for (let i = 0; i < w.nodes.length; i++) {
      const n = w.nodes[i];
      const X = sx(n.x), Y = sy(n.y);
      const size = px(0.012 + n.amp * 0.026) * (0.4 + n.growth * 0.9);

      /* Beyond the horizon: drawn in outline only. It is there, it is real,
       * and no signal from it has ever reached here — the ring says so without
       * a word of explanation. */
      if (n.beyond) {
        ctx.strokeStyle = hsl(200, 0.5, 0.62, 0.28 + n.growth * 0.30);
        ctx.lineWidth = Math.max(1, px(0.0025));
        ctx.setLineDash([px(0.008), px(0.008)]);
        ctx.beginPath(); ctx.arc(X, Y, size * 1.5, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      }

      /* Assembling: a halo at peak growth rate. This is the tell. */
      if (n.assembly > 0.25) {
        const g = ctx.createRadialGradient(X, Y, 0, X, Y, size * 5);
        g.addColorStop(0, hsl(46, 0.85, 0.62, 0.30 * n.assembly));
        g.addColorStop(1, hsl(46, 0.85, 0.6, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(X, Y, size * 5, 0, TAU); ctx.fill();
      }

      ctx.fillStyle = n.formed
        ? hsl(276 + n.amp * 40, 0.6, 0.52 + n.growth * 0.22, 0.35 + n.growth * 0.5)
        : hsl(230, 0.3, 0.4, 0.10 + n.growth * 0.2);
      ctx.beginPath(); ctx.arc(X, Y, size, 0, TAU); ctx.fill();
    }
  }

  /* ── Quantum foam ────────────────────────────────────────────────────────
   *
   * Pairs, springing apart and annihilating. The one that does not close is
   * drawn as a line rather than a pair of dots, because it is no longer a pair
   * — it is the thing that got away, and it should be the only stable object
   * on a screen where nothing else is.
   */
  function drawFoam(ctx, game, t) {
    const f = game.scene.foam;
    if (!f) return;
    for (let i = 0; i < f.pairs.length; i++) {
      const p = f.pairs[i];
      if (p.presence < 0.02) continue;
      const dx = Math.cos(p.ang + Math.PI / 2) * p.sep;
      const dy = Math.sin(p.ang + Math.PI / 2) * p.sep;
      const x1 = sx(p.x + dx), y1 = sy(p.y + dy);
      const x2 = sx(p.x - dx), y2 = sy(p.y - dy);
      const r = px(0.008) * (0.5 + p.presence);

      if (p.survives) {
        ctx.strokeStyle = hsl(46, 0.9, 0.68, 0.55 * p.presence);
        ctx.lineWidth = Math.max(1, px(0.0035));
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      /* Opposite hues, because the two halves of a pair are opposite in every
       * quantum number they have. */
      ctx.fillStyle = hsl(p.hue, 0.75, 0.66, 0.75 * p.presence);
      ctx.beginPath(); ctx.arc(x1, y1, r, 0, TAU); ctx.fill();
      ctx.fillStyle = hsl(p.hue + 180, 0.75, 0.66, 0.75 * p.presence);
      ctx.beginPath(); ctx.arc(x2, y2, r, 0, TAU); ctx.fill();
    }
  }

  /* ── The ensemble ────────────────────────────────────────────────────────
   *
   * Universes have no spatial form, so there is nothing here to draw *as a
   * place* — only relations, which is exactly what the `abstract` geometry is
   * for. Each block is one essence rendered by the same generator that renders
   * everything else, and the further a block sits from ours the further out and
   * the more saturated it is drawn. The one Δ is pointed at gets a ring.
   */
  function drawEnsemble(ctx, game, t) {
    const e = game.scene.ensemble;
    if (!e) return;
    const sel = game.scene.blockNode;

    /* The compass. Δ is the selector in this scope and nothing else uses it, so
     * the needle is worth drawing plainly. */
    const phi = game.dials.phase.value;
    ctx.strokeStyle = hsl(268, 0.5, 0.6, 0.22);
    ctx.lineWidth = Math.max(1, px(0.003));
    ctx.beginPath();
    ctx.moveTo(view.cx, view.cy);
    ctx.lineTo(sx(Math.cos(phi) * 0.9), sy(Math.sin(phi) * 0.9));
    ctx.stroke();

    for (let i = 0; i < e.nodes.length; i++) {
      const n = e.nodes[i];
      const on = sel === n;
      let buf = n.__ss;
      if (!buf) buf = n.__ss = RS.selfsimilar.build(n.essence, 'abstract', n.idx, buf);

      ctx.save();
      ctx.translate(sx(n.x), sy(n.y));
      ctx.rotate(t * 0.06 * (1 + n.distance));
      /* `abstract` draws dashed relations and dotted nodes, both of which are
       * faint by construction — so this scope needs a much higher alpha than a
       * lobed or filamentary one to read at all. */
      RS.selfsimilar.draw(ctx, buf, 0, 0,
        RS.selfsimilar.fit(buf, px(0.09 + n.distance * 0.07)),
        n.hue, 0.5 + n.distance * 0.45, on ? 1.0 : 0.82, t);
      ctx.restore();

      if (on) {
        ctx.strokeStyle = hsl(n.hue, 0.9, 0.75, 0.85);
        ctx.lineWidth = Math.max(2, px(0.006));
        ctx.beginPath();
        ctx.arc(sx(n.x), sy(n.y), px(0.15 + Math.sin(t * 2.2) * 0.008), 0, TAU);
        ctx.stroke();
      } else {
        /* Unselected blocks still get a mark, so the compass has visible
         * detents rather than a needle sweeping through fog. */
        ctx.fillStyle = hsl(n.hue, 0.6, 0.6, 0.35);
        ctx.beginPath(); ctx.arc(sx(n.x), sy(n.y), Math.max(1.5, px(0.005)), 0, TAU); ctx.fill();
      }
    }

    /* The specimen: one address, two universes. Two stars side by side, sized
     * and coloured by what each block actually derives. */
    const sp = game.scene.specimen;
    if (sp && sp.ours && sp.there) {
      const y = view.cy + px(0.70);
      /* Wide enough apart that the two captions cannot collide — they are the
       * comparison, so overlapping them destroys the only thing this picture
       * is for. */
      const pairs = [[sp.ours, view.cx - px(0.42), 'ours'], [sp.there, view.cx + px(0.42), 'there']];
      for (const [d, x, tag] of pairs) {
        const r = px(0.018) * Math.pow(clamp(d.lum, 0.001, 1e5), 0.12);
        /* Star colour from its derived temperature — the difference between the
         * two discs *is* the difference between the two universes, so it has to
         * run the right way: 3000 K is red, 5800 K is yellow-white, 10000 K and
         * up is blue. A linear ramp gets this backwards at one end or the
         * other, because the yellow-to-blue half of the sequence covers three
         * times the temperature range that the red-to-yellow half does. */
        const hue = d.temp < 5000
          ? lerp(16, 44, clamp01((d.temp - 2500) / 2500))
          : lerp(44, 215, clamp01((d.temp - 5000) / 6000));
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
        g.addColorStop(0, hsl(hue, 0.75, 0.72, 0.9));
        g.addColorStop(1, hsl(hue, 0.75, 0.6, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, TAU); ctx.fill();
        ctx.fillStyle = hsl(hue, 0.5, 0.85, 0.95);
        ctx.beginPath(); ctx.arc(x, y, Math.max(2, r), 0, TAU); ctx.fill();

        ctx.textAlign = 'center';
        ctx.fillStyle = hsl(0, 0, 0.62, 0.75);
        ctx.font = '9px ui-monospace, Menlo, monospace';
        ctx.fillText(tag, x, y + px(0.085));
        ctx.fillStyle = hsl(hue, 0.5, 0.78, 0.9);
        ctx.font = '11px ui-monospace, Menlo, monospace';
        ctx.fillText(Math.round(d.temp) + ' K', x, y + px(0.135));
        ctx.fillStyle = hsl(d.living ? 140 : 0, 0.5, 0.66, 0.8);
        ctx.font = '9px ui-monospace, Menlo, monospace';
        ctx.fillText(d.living + '/' + d.worlds + ' alive', x, y + px(0.175));
      }
    }
  }

  /* ── The molecule ────────────────────────────────────────────────────────
   *
   * A coiled chain of sites, bonded. Handedness is the whole point, so it is
   * the loudest thing on screen: warm for the minority hand, cool for the
   * majority, neutral green for the achiral sites where the question does not
   * arise. On a sterile world the two colours are evenly mixed; on a living one
   * the screen is nearly one colour and the odd warm site is the find.
   */
  function drawMolecule(ctx, game, t) {
    const m = game.scene.molecule;
    if (!m) return;
    const ct = game.scene.molT || 0;

    /* Bonds first. Line weight is bond order, which is the essence's
     * persistence — how tightly it holds on, everywhere in the game. */
    for (let i = 0; i < m.sites.length - 1; i++) {
      const a = m.sites[i], b = m.sites[i + 1];
      ctx.strokeStyle = hsl(200, 0.3, 0.55, 0.35);
      ctx.lineWidth = Math.max(1, px(0.002 * a.bond));
      ctx.beginPath();
      ctx.moveTo(sx(a.x), sy(a.y));
      ctx.lineTo(sx(b.x), sy(b.y));
      ctx.stroke();
      /* A double or triple bond is drawn as such — it is a real distinction
       * and it costs one extra line. */
      for (let k = 1; k < a.bond; k++) {
        const dx = (b.y - a.y), dy = -(b.x - a.x);
        const len = Math.hypot(dx, dy) + 1e-5;
        const off = px(0.006 * k) / len;
        ctx.beginPath();
        ctx.moveTo(sx(a.x) + dx * off, sy(a.y) + dy * off);
        ctx.lineTo(sx(b.x) + dx * off, sy(b.y) + dy * off);
        ctx.stroke();
      }
    }

    for (let i = 0; i < m.sites.length; i++) {
      const st = m.sites[i];
      const wob = Math.sin(ct * 1.3 + i * 0.7) * 0.006;
      const X = sx(st.x + wob), Y = sy(st.y + wob);
      /* The minority hand gets a halo, because on a homochiral world it is the
       * one thing in the scope worth crossing the screen for. */
      if (st.hand < 0 && m.bias > 0.4) {
        const g = ctx.createRadialGradient(X, Y, 0, X, Y, px(st.size * 4));
        g.addColorStop(0, hsl(24, 0.9, 0.6, 0.4));
        g.addColorStop(1, hsl(24, 0.9, 0.6, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(X, Y, px(st.size * 4), 0, TAU); ctx.fill();
      }
      ctx.fillStyle = hsl(st.hue, st.chiral ? 0.75 : 0.35, 0.62, 0.9);
      ctx.beginPath(); ctx.arc(X, Y, px(st.size), 0, TAU); ctx.fill();
    }
  }

  /* ── Orbital shells ──────────────────────────────────────────────────────
   *
   * Concentric shells with their occupants on them. Spin is drawn as a tick
   * above or below — the only quantum number that has nowhere else to go, and
   * the one that makes two otherwise identical occupants distinguishable, which
   * is exactly the situation TWIN describes.
   */
  function drawShells(ctx, game, t) {
    const sh = game.scene.shells;
    if (!sh) return;

    for (let n = 1; n <= sh.shells; n++) {
      const r = 0.16 + (n - 1) / sh.shells * 0.74;
      ctx.strokeStyle = hsl(200, 0.4, 0.5, 0.13);
      ctx.lineWidth = Math.max(1, px(0.002));
      ctx.beginPath();
      ctx.ellipse(view.cx, view.cy, px(r), px(r * 0.9), 0, 0, TAU);
      ctx.stroke();
    }

    for (let i = 0; i < sh.occupants.length; i++) {
      const oc = sh.occupants[i];
      /* Occupants precess around their shell at a rate set by n, so an inner
       * shell visibly runs faster — which is true and is the cheapest possible
       * way to say "this one is more tightly bound". */
      const a = oc.ang + t * (0.30 / oc.q.n);
      const X = sx(Math.cos(a) * oc.rad), Y = sy(Math.sin(a) * oc.rad * 0.9);

      /* Displaced occupants are excited states — about to fall back, and worth
       * catching before they do. */
      if (oc.excited) {
        const g = ctx.createRadialGradient(X, Y, 0, X, Y, px(0.05));
        g.addColorStop(0, hsl(46, 0.9, 0.66, 0.42));
        g.addColorStop(1, hsl(46, 0.9, 0.6, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(X, Y, px(0.05), 0, TAU); ctx.fill();
      }

      ctx.fillStyle = hsl(oc.hue, 0.7, 0.66, 0.9);
      ctx.beginPath(); ctx.arc(X, Y, px(0.013), 0, TAU); ctx.fill();

      /* Spin: a tick up or down. */
      ctx.strokeStyle = hsl(oc.hue, 0.8, 0.75, 0.8);
      ctx.lineWidth = Math.max(1, px(0.0022));
      ctx.beginPath();
      ctx.moveTo(X, Y);
      ctx.lineTo(X, Y + px(0.022) * (oc.spin > 0 ? -1 : 1));
      ctx.stroke();
    }
  }

  /* Whatever lives here. Deliberately small and dim: they are the difference
   * between a place and a diagram, not the thing you are looking at, and a
   * scope whose traffic competes with its nodes for attention would be worse
   * than one with none. */
  function drawInhabitants(ctx, game, t) {
    const inh = game.scene.inhabitants;
    if (!inh || !inh.list.length) return;
    for (let i = 0; i < inh.list.length; i++) {
      const o = inh.list[i];
      const X = sx(o.x), Y = sy(o.y);
      const r = px(o.size);
      ctx.fillStyle = hsl(o.hue, 0.7, 0.62, 0.30 * o.bright);
      ctx.beginPath(); ctx.arc(X, Y, r, 0, TAU); ctx.fill();
      /* A short wake in the direction of travel — the cheapest possible way to
       * say "this is going somewhere" rather than "this is a dot". */
      ctx.strokeStyle = hsl(o.hue, 0.7, 0.6, 0.16 * o.bright);
      ctx.lineWidth = Math.max(1, r * 0.7);
      ctx.beginPath();
      ctx.moveTo(X, Y);
      ctx.lineTo(X - Math.cos(o.heading) * r * 4, Y - Math.sin(o.heading) * r * 4);
      ctx.stroke();
    }
  }

  /* ── The combo ───────────────────────────────────────────────────────────
   *
   * Drawn on the centre, around you, because the combo is a property of the
   * observer rather than of any node — it survives the node that started it.
   * The ring is the window draining, which is the only pressure in the system
   * and therefore the only thing that has to be legible without being read.
   */
  function drawCombo(ctx, game, t) {
    const st = game.strike;
    if (!st || st.combo <= 0) return;
    const frac = RS.strike.windowFrac(game);
    const mul = RS.strike.multiplier(game);
    const R = px(0.145);
    /* Hue climbs with the combo and then stops, so early progress is visible
     * and a long streak does not cycle back to where it started. */
    const hue = 320 + Math.min(70, st.combo * 2.2);

    ctx.save();
    ctx.lineCap = 'round';

    /* The window, draining clockwise. Reddens as it runs out — the one piece
     * of urgency in a game that is otherwise about patience. */
    const urgent = frac < 0.3;
    ctx.lineWidth = Math.max(2, px(0.009));
    ctx.strokeStyle = hsl(urgent ? 8 : hue, 0.85, urgent ? 0.62 : 0.68,
      0.35 + frac * 0.5);
    ctx.beginPath();
    ctx.arc(view.cx, view.cy, R, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
    ctx.stroke();

    /* A soft backing so the ring reads against a bright field. */
    ctx.lineWidth = Math.max(1, px(0.003));
    ctx.strokeStyle = hsl(hue, 0.5, 0.5, 0.14);
    ctx.beginPath(); ctx.arc(view.cx, view.cy, R, 0, TAU); ctx.stroke();

    /* The numbers. The count large, the multiplier under it — that order,
     * because the count is what you are trying to raise and the multiplier is
     * why. */
    const pop = clamp01(1 - (game.stats.playSeconds - st.lastAt) * 6);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = hsl(hue, 0.9, 0.78, 0.95);
    ctx.font = (Math.round(px(0.052) * (1 + pop * 0.22))) + 'px ui-monospace, Menlo, monospace';
    /* Below the centre rather than above it. Above is where crystallisation
     * floaters travel and where the node readout sits; a combo counter that
     * shares that space is illegible exactly when it is most interesting. */
    ctx.fillText('×' + st.combo, view.cx, view.cy + px(0.235));
    ctx.fillStyle = hsl(hue, 0.6, 0.66, 0.7);
    ctx.font = Math.round(px(0.028)) + 'px ui-monospace, Menlo, monospace';
    ctx.fillText(mul.toFixed(2) + '× yield', view.cx, view.cy + px(0.29));
    ctx.restore();
  }

  function drawNode(ctx, game, n, t) {
    const man = n.man;
    const a = n.fade;
    if (a < 0.01) return;
    const hue = man.hue;
    const r = 0.036 * man.size * (1 + n.align * 0.28);

    /* TWIN: the uncollapsed double renders as a real, equally convincing node.
     * Half the time you tune the wrong one, which is the entire mechanic —
     * and how far off it sits is the essence's symmetry, so a Duality twins
     * almost on top of itself and a Cascade throws its double clear across
     * the field. */
    if (n.twinInfo && !n.collapsed) {
      const sep = 0.35 + n.twinSep * 1.3;
      const ta = n.ang + Math.PI * sep;
      const tx = Math.cos(ta) * n.rad, ty = Math.sin(ta) * n.rad;
      drawSmudge(ctx, tx, ty, r, hue, a * 0.5, t, man.seed);
      if (n.resolved > 0.3) drawEssence(ctx, man, tx, ty, r, hue, a * n.resolved * 0.45, t);
    }

    /* Gated layers dim when the window is shut, so the rhythm is visible as
     * well as audible. */
    const gateA = a * (0.28 + 0.72 * n.gate);

    drawSmudge(ctx, n.x, n.y, r, hue, gateA * (1 - n.resolved * 0.55), t, man.seed);

    if (n.resolved > 0.03) {
      /* Glow scales with alignment — approaching a node visibly ignites it. */
      if (n.align > 0.12) {
        const g = ctx.createRadialGradient(sx(n.x), sy(n.y), 0, sx(n.x), sy(n.y), px(r * 3.4));
        g.addColorStop(0, hsl(hue, 0.9, 0.62, 0.4 * n.align * gateA));
        g.addColorStop(1, hsl(hue, 0.9, 0.6, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(sx(n.x), sy(n.y), px(r * 3.4), 0, TAU); ctx.fill();
      }
      drawEssence(ctx, man, n.x, n.y, r, hue, gateA * n.resolved, t);
    }

    // coherence arc — the hold meter, drawn on the node itself
    if (n.coherence > 0.001) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.5, px(0.008));
      ctx.strokeStyle = hsl(hue + 25, 0.95, 0.66, 0.9 * a);
      ctx.beginPath();
      ctx.arc(sx(n.x), sy(n.y), px(r * 1.9), -Math.PI / 2, -Math.PI / 2 + TAU * n.coherence);
      ctx.stroke();
      /* A leading dot on the arc: it makes the fill read as *motion* rather
       * than as a static percentage, which is most of why progress rings feel
       * good at all. */
      const ea = -Math.PI / 2 + TAU * n.coherence;
      ctx.fillStyle = hsl(hue + 40, 1, 0.78, a);
      ctx.beginPath();
      ctx.arc(sx(n.x) + Math.cos(ea) * px(r * 1.9), sy(n.y) + Math.sin(ea) * px(r * 1.9), px(0.008), 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // blocked marker (causal layer)
    if (n.blocked && n.resolved > 0.3) {
      ctx.strokeStyle = hsl(0, 0.7, 0.6, 0.55 * a);
      ctx.lineWidth = Math.max(1, px(0.004));
      ctx.beginPath();
      ctx.arc(sx(n.x), sy(n.y), px(r * 2.3), 0, TAU);
      ctx.setLineDash([px(0.014), px(0.014)]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // rarity crown
    if (man.rarity > 0 && n.resolved > 0.5) {
      ctx.strokeStyle = hsl(hue + 55, 1, 0.72, 0.75 * a * n.resolved);
      ctx.lineWidth = Math.max(1, px(0.0035));
      for (let i = 0; i < man.rarity; i++) {
        ctx.beginPath();
        ctx.arc(sx(n.x), sy(n.y), px(r * (2.6 + i * 0.34)), t * (0.5 + i * 0.3), t * (0.5 + i * 0.3) + 1.4);
        ctx.stroke();
      }
    }
  }

  // --- the observer --------------------------------------------------------

  function drawCentre(ctx, game, t, spec) {
    const cx = view.cx, cy = view.cy;
    const focus = RS.dials.observerFocus(game.dials);
    const pulse = 1 + Math.sin(t * 2.1) * 0.06;
    const rr = px(0.028) * pulse * (0.75 + focus * 0.5);

    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr * 6);
    g.addColorStop(0, hsl(vis.hue.value, 0.2, 0.98, 0.95));
    g.addColorStop(0.18, hsl(vis.hue.value, 0.7, 0.75, 0.5));
    g.addColorStop(1, hsl(vis.hue.value, 0.8, 0.6, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, rr * 6, 0, TAU); ctx.fill();

    ctx.fillStyle = hsl(vis.hue.value, 0.1, 1, 0.98);
    ctx.beginPath(); ctx.arc(cx, cy, rr * 0.55, 0, TAU); ctx.fill();
  }

  /* Four arcs around the observer, one per dial, each showing how aligned that
   * axis is with the nearest node. Dim = wrong dial. This is the game's
   * diagnostic instrument and it is always on. */
  function drawReticle(ctx, game, t) {
    const n = game.focusNode;
    if (!n || !n.alignParts) return;
    const p = n.alignParts;
    const axes = [
      { v: p.f, d: p.dem.freq, hue: 187, label: 'φ' },
      { v: p.s, d: p.dem.tier, hue: 338, label: 'Σ' },
      { v: p.p, d: p.dem.phase, hue: 268, label: 'Δ' },
      { v: p.r, d: p.dem.rate, hue: 43, label: 'τ' }
    ];
    const R0 = px(0.10);
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const ax = axes[i];
      const a0 = -Math.PI / 2 + i * (TAU / 4) + 0.10;
      const a1 = a0 + TAU / 4 - 0.20;
      /* An axis this band does not demand is drawn as a hairline — the player
       * can see at a glance which dials are live in this layer. */
      const live = ax.d > 0.02;
      ctx.lineWidth = live ? Math.max(2, px(0.011)) : Math.max(1, px(0.003));
      ctx.strokeStyle = hsl(ax.hue, 0.5, 0.5, live ? 0.18 : 0.10);
      ctx.beginPath(); ctx.arc(view.cx, view.cy, R0, a0, a1); ctx.stroke();
      if (!live) continue;
      const fill = clamp01(ax.v);
      ctx.strokeStyle = hsl(ax.hue, 0.9, lerp(0.42, 0.72, fill), 0.35 + fill * 0.62);
      ctx.beginPath();
      ctx.arc(view.cx, view.cy, R0, a0, a0 + (a1 - a0) * fill);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* The beat ring. Pulses at exactly the audio beat rate: fast strobe when far
   * off tune, slow swell when close, and perfectly still when locked. The
   * player can tune by watching this alone. */
  function drawBeatRing(ctx, game, dt, t) {
    const D = game.dials;
    const focus = RS.dials.focusOf(D.frequency);
    const band = RS.spectrum.nearestBand(D.frequency.value);
    const err = Math.abs(D.frequency.value - band.centre);
    const beat = err * RS.audio.BEAT_SCALE;
    vis.beatPhase += dt * Math.min(beat, 22) * 0.55;
    const res = RS.spectrum.resonanceOf(band, D.frequency.value, focus);
    if (res < 0.02) return;

    const wob = Math.sin(vis.beatPhase * TAU);
    /* When the beat rate reaches zero the ring stops moving entirely — the
     * stillness is the signal. */
    const amp = clamp01(err / 6) * 0.5;
    const r = px(0.135) * (1 + wob * amp);
    const ghost = RS.spectrum.isGhost(band, focus);
    ctx.save();
    ctx.lineWidth = Math.max(1, px(0.004 + res * 0.006));
    ctx.strokeStyle = hsl(band.hue, ghost ? 0.15 : band.sat, ghost ? 0.45 : 0.62,
      res * (ghost ? 0.25 : 0.55) * (0.6 + 0.4 * (1 - amp)));
    if (ghost) ctx.setLineDash([px(0.02), px(0.02)]);
    ctx.beginPath(); ctx.arc(view.cx, view.cy, r, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // --- particles, ripples, floaters ---------------------------------------

  function drawParticles(ctx) {
    const ps = RS.feel.state.particles;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const u = p.age / p.life;
      const a = ease.impact(u);
      if (a <= 0.002) continue;
      const s = px(p.size * 0.006) * (p.kind === 'mote' ? 1 : (1 - u * 0.5));
      const X = sx(p.x), Y = sy(p.y);
      if (p.trail) {
        ctx.strokeStyle = hsl(p.hue, p.sat, p.lum, a * 0.55);
        ctx.lineWidth = s;
        ctx.beginPath();
        ctx.moveTo(sx(p.px), sy(p.py)); ctx.lineTo(X, Y);
        ctx.stroke();
      }
      ctx.fillStyle = hsl(p.hue, p.sat, p.lum, a);
      ctx.beginPath(); ctx.arc(X, Y, Math.max(0.5, s), 0, TAU); ctx.fill();
    }
  }

  function drawRipples(ctx) {
    const rs = RS.feel.state.ripples;
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i];
      const u = clamp01(r.age / r.life);
      const e = ease[r.ease] ? ease[r.ease](u) : u;
      const rad = px(lerp(r.r0, r.r1, e));
      const a = (1 - u) * (1 - u);
      ctx.strokeStyle = hsl(r.hue, r.sat, 0.68, a * 0.8);
      ctx.lineWidth = Math.max(0.6, px(r.width * 0.0022) * (1 - u * 0.6));
      ctx.beginPath(); ctx.arc(sx(r.x), sy(r.y), Math.max(0.5, rad), 0, TAU); ctx.stroke();
    }
  }

  function drawFloaters(ctx) {
    const fs = RS.feel.state.floaters;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < fs.length; i++) {
      const f = fs[i];
      const u = clamp01(f.age / f.life);
      const a = u < 0.75 ? 1 : 1 - (u - 0.75) / 0.25;
      const y = f.y - ease.outCubic(u) * f.rise;
      const scale = f.pop.value;
      ctx.font = '' + f.weight + ' ' + Math.round(f.size * scale) + 'px ui-monospace, SFMono-Regular, Menlo, monospace';
      const X = sx(f.x + f.drift * u), Y = sy(y);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(f.text, X + 1, Y + 1.5);
      ctx.fillStyle = hsl(f.hue, 0.95, 0.72, a);
      ctx.fillText(f.text, X, Y);
    }
    ctx.restore();
  }

  // --- post ----------------------------------------------------------------

  function drawPost(ctx) {
    const S = RS.feel.state;
    if (S.vignette > 0.004) {
      const g = ctx.createRadialGradient(view.cx, view.cy, px(0.3), view.cx, view.cy, Math.max(view.w, view.h) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,' + (S.vignette * 0.75).toFixed(3) + ')');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, view.w, view.h);
    }
    if (S.flash > 0.004) {
      /* 'lighter' rather than a flat overlay: a flash should *add* light, and
       * an alpha-blended white wash reads as fog instead of impact. */
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = hsl(S.flashHue, S.flashSat, 0.5, S.flash * 0.5);
      ctx.fillRect(0, 0, view.w, view.h);
      ctx.restore();
    }
  }

  // --- main ----------------------------------------------------------------

  /* ── How much each scope glows ───────────────────────────────────────────
   *
   * Bloom is not a uniform filter here; it is part of what a place *is*. The
   * foam seethes with light because everything in it is an event; a planet
   * surface barely blooms at all because it is lit rather than luminous; the
   * ensemble glows hard because it is not a place, it is a set of relations
   * drawn as light. The threshold moves with it — a scope full of dim things
   * needs a lower bar or nothing bleeds at all.
   */
  const BLOOM = {
    field:     { amt: 0.85, thr: 0.34 },
    foam:      { amt: 1.15, thr: 0.30 },
    shells:    { amt: 0.95, thr: 0.34 },
    molecular: { amt: 0.75, thr: 0.38 },
    cellular:  { amt: 0.80, thr: 0.36 },
    planet:    { amt: 0.42, thr: 0.55 },
    system:    { amt: 1.05, thr: 0.40 },
    galaxy:    { amt: 1.00, thr: 0.36 },
    web:       { amt: 0.90, thr: 0.32 },
    ensemble:  { amt: 1.10, thr: 0.30 }
  };

  function draw(game, canvas, ctx, dt) {
    resize(canvas);
    const S = RS.feel.state;
    const D = game.dials;
    const t = game.field.t;

    const focus = RS.dials.focusOf(D.frequency);
    const spec = RS.spectrum.sample(D.frequency.value, focus, game.__spec || (game.__spec = []));
    const blend = RS.spectrum.blendVisual(spec);
    const tierHue = RS.cosmos.hueAt(D.space.value);

    /* The palette is a blend of the layer being observed and the scale it is
     * observed at — so the same layer looks different at every tier, which is
     * the whole "local rules" premise rendered as colour. */
    const mixedHue = RS.core.mixHue(tierHue, blend.hue, clamp01(blend.strength * 0.85));
    vis.hue.set(mixedHue).step(dt);
    vis.sat.set(0.22 + blend.sat * 0.55).step(dt);
    vis.strength.set(blend.strength).step(dt);
    vis.tierMix.set(D.space.value).step(dt);

    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);

    /* Bloom reads an offscreen world buffer, never this canvas. Drawing the
     * world into a buffer and compositing it means capture is a copy of a
     * finished source rather than a flush of the frame still being built —
     * see bloom.js. Fall back to drawing on the display if the buffer cannot
     * be allocated, and skip bloom for that frame rather than stall it. */
    const displayCtx = ctx;
    const bloomOn = game.settings.bloom !== false && RS.bloom && RS.bloom.isEnabled();
    const worldBuf = bloomOn ? RS.bloom.begin(view.w, view.h, view.dpr) : null;
    if (worldBuf) ctx = worldBuf.ctx;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);

    ctx.clearRect(0, 0, view.w, view.h);

    // deep background
    const bg = ctx.createRadialGradient(view.cx, view.cy, 0, view.cx, view.cy, Math.max(view.w, view.h) * 0.8);
    bg.addColorStop(0, hsl(vis.hue.value, vis.sat.value * 0.6, 0.10, 1));
    bg.addColorStop(0.55, hsl(vis.hue.value - 12, vis.sat.value * 0.5, 0.055, 1));
    bg.addColorStop(1, '#03050a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, view.w, view.h);

    // camera: shake + zoom punch, applied to the field only so the HUD is stable
    ctx.save();
    const zoom = 1 + S.zoomPunch;
    ctx.translate(view.cx, view.cy);
    ctx.rotate(S.shakeRot);
    ctx.scale(zoom, zoom);
    /* ── Arrival, as movement ────────────────────────────────────────────
     *
     * The scope change scales the whole world: descending the ladder starts
     * you zoomed out and settles inward, climbing starts you zoomed in and
     * pulls back. It is one multiply on a transform that already exists, and
     * it is the difference between "the picture changed" and "you went
     * somewhere" — which matters because the ladder *is* the navigation, and a
     * cut makes twenty-two rungs read as twenty-two destinations rather than
     * as one continuous axis. */
    const sc = game.scene;
    if (sc && sc.transition > 0.001 && sc.transitionDir) {
      const k = ease.outCubic(1 - sc.transition);
      /* Descending the ladder is zooming *in*: things grow toward you as you
       * approach their scale, so the world starts small and expands into place.
       * Climbing is zooming out: it starts large and contracts. Getting this
       * backwards — which the first version did — makes descending feel like
       * retreating, and it is the kind of error that is obvious the moment you
       * see it and invisible while you are writing it. */
      const from = sc.transitionDir < 0 ? 0.62 : 1.55;
      const z = from + (1 - from) * k;
      ctx.translate(view.cx, view.cy);
      ctx.scale(z, z);
      ctx.translate(-view.cx, -view.cy);
    }

    ctx.translate(-view.cx + S.shakeX * px(0.08), -view.cy + S.shakeY * px(0.08));

    /* Scene dispatch. The attunement field, the solar system and a planet
     * surface are three different worlds drawn by three different modules, but
     * they share this camera, these particles and this post pass — so an
     * impact feels identical in all three, which is what keeps them feeling
     * like one game rather than three minigames. */
    const kind = game.scene ? game.scene.kind : 'field';

    if (kind === 'galaxy') {
      RS.galaxy.draw(ctx, game, dt);
    } else if (kind === 'system') {
      RS.worldrender.drawSystem(ctx, game, dt);
    } else if (kind === 'planet') {
      RS.worldrender.drawPlanet(ctx, game, dt);
    } else {
      /* The Cellular scope runs the same attunement loop as the field, because
       * that is the whole argument for having six primitives: a new scope is a
       * different *place*, not a different rule set. What changes is what the
       * place is made of — a membrane instead of a rim, organelles instead of
       * empty space — and what your work there does to the world outside. */
      const inCell = kind === 'cellular';
      const inWeb = kind === 'web';
      const inFoam = kind === 'foam';
      const inEnsemble = kind === 'ensemble';
      const inMol = kind === 'molecular';
      const inShells = kind === 'shells';

      // tier backdrops, cross-faded between the two rungs the dial straddles
      const tb = RS.cosmos.tierBlend(vis.tierMix.value);
      const upheavalFade = 1 - game.field.upheaval * 0.55;
      drawBackdrop(ctx, game, tb.a.geometry, tb.a.hue, (1 - tb.t) * 0.55 * upheavalFade, t);
      if (tb.b !== tb.a) drawBackdrop(ctx, game, tb.b.geometry, tb.b.hue, tb.t * 0.55 * upheavalFade, t);

      if (inCell) drawCell(ctx, game, t);
      else if (inWeb) drawWeb(ctx, game, t);
      else if (inFoam) drawFoam(ctx, game, t);
      else if (inEnsemble) drawEnsemble(ctx, game, t);
      else if (inMol) drawMolecule(ctx, game, t);
      else if (inShells) drawShells(ctx, game, t);

      /* The rim. A membrane in a cell, the horizon in the web, and absent in
       * the foam — there is no boundary at a scale where nothing persists long
       * enough to have one. */
      if (!inFoam) {
        ctx.strokeStyle = hsl(vis.hue.value, vis.sat.value, 0.4, inCell ? 0.34 : 0.20);
        ctx.lineWidth = Math.max(1, px(inCell ? 0.010 : 0.004));
        ctx.beginPath(); ctx.arc(view.cx, view.cy, px(1.0), 0, TAU); ctx.stroke();
      }

      drawBeatRing(ctx, game, dt, t);

      /* Sort by resolution so identified nodes sit above smudges — otherwise
       * the thing you are working on can be occluded by fog. */
      const nodes = game.field.nodes;
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].resolved <= 0.5) drawNode(ctx, game, nodes[i], t);
      }
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].resolved > 0.5) drawNode(ctx, game, nodes[i], t);
      }

      /* Inhabitants, under the nodes: whatever lives at this scope, doing what
       * it was already doing. */
      drawInhabitants(ctx, game, t);

      drawCombo(ctx, game, t);
      drawReticle(ctx, game, t);
      drawCentre(ctx, game, t, spec);

      /* The live primitives for whatever you are working on, stacked in the
       * gap between the reticle and the instruments. Anchored to the viewport
       * rather than to the node: a readout that chases a drifting node is
       * unreadable, and this one has to be legible while you are concentrating
       * on something else. */
      if (game.focusNode && game.focusNode.resolved > 0.25) {
        const rows = RS.primhud;
        const bandHue = vis.hue.value;
        const bottom = (RS.hud && RS.hud.layout.clusterTop) ? RS.hud.layout.clusterTop : view.h * 0.78;
        const need = RS.spectrum.BANDS[game.focusNode.man.bandIndex].prim.length;
        const y0 = bottom - 10 - need * rows.ROW_H;
        rows.drawFor(ctx, game, game.focusNode, 22, y0,
          bandHue, 0.35 + game.focusNode.resolved * 0.6);
      }
    }

    /* ── Arrival ─────────────────────────────────────────────────────────
     *
     * This was a white flash, which said "something changed" and nothing else.
     * The ladder is the navigation, so a scope change is a movement — and which
     * way you went is the one thing the transition should communicate.
     *
     * Rings travel *inward* when you descend the ladder and *outward* when you
     * climb it, at a speed that falls as the transition settles. It is two
     * strokes and a fill; the point is not the effect, it is that the direction
     * is never ambiguous, so twenty-two rungs read as one continuous axis
     * rather than as twenty-two destinations.
     */
    if (game.scene && game.scene.transition > 0.01) {
      const tr = game.scene.transition;
      const dir = game.scene.transitionDir || 0;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      /* The wash, dimmer than it was — it is now the background of the
       * movement rather than the whole of it. */
      ctx.fillStyle = hsl(vis.hue.value, 0.6, 0.5, tr * 0.16);
      ctx.fillRect(0, 0, view.w, view.h);

      if (dir !== 0) {
        /* `u` runs 0 → 1 as the transition settles, so the rings sweep once
         * rather than pulsing. Inward means they close on you; outward means
         * they leave. */
        const u = 1 - tr;
        const maxR = Math.hypot(view.w, view.h) * 0.6;
        ctx.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
          const off = i * 0.22;
          const k = clamp01(u + off);
          /* And the rings stream the way the world does: outward past you when
           * you dive in, inward past you when you pull back. */
          const r = dir < 0
            ? lerp(px(0.05), maxR, ease.outCubic(k))
            : lerp(maxR, px(0.05), ease.outCubic(k));
          const a = tr * (1 - Math.abs(k - 0.5) * 1.1) * 0.5;
          if (a <= 0.005) continue;
          ctx.strokeStyle = hsl(vis.hue.value + i * 12, 0.7, 0.66, a);
          ctx.lineWidth = Math.max(1.5, px(0.012) * (1 - k * 0.6));
          ctx.beginPath();
          ctx.arc(view.cx, view.cy, Math.max(1, r), 0, TAU);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    drawRipples(ctx);
    drawParticles(ctx);
    drawFloaters(ctx);

    ctx.restore();

    /* ── Bloom ───────────────────────────────────────────────────────────
     *
     * After the world and before the vignette, so light spills between things
     * and the vignette still darkens the edge of the result rather than being
     * bloomed itself. Capture reads the world buffer; the display only
     * receives a blit plus the glow. Pushed hard during a transition, which
     * is most of why an arrival now reads as an event rather than as a cut. */
    if (bloomOn && RS.bloom) {
      const b = BLOOM[kind] || BLOOM.field;
      const tr = game.scene ? game.scene.transition : 0;
      const amt = b.amt * (1 + tr * 1.4) * (game.settings.reduceMotion ? 0.6 : 1);
      if (worldBuf) {
        RS.bloom.captureWorld(view.w, view.h, b.thr * (1 - tr * 0.35));
        displayCtx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
        displayCtx.clearRect(0, 0, view.w, view.h);
        RS.bloom.blit(displayCtx, view.w, view.h);
        RS.bloom.composite(displayCtx, view.w, view.h, amt);
        ctx = displayCtx;
      }
    }

    drawPost(ctx);
  }

  RS.render = { view, resize, draw, sx, sy, px, vis };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
