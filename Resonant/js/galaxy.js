/* Resonant — the galactic map.
 *
 * ── Why this scene exists ─────────────────────────────────────────────────
 *
 * Before this, a system was reached by an opaque formula over the phase and
 * frequency dials: you arrived *somewhere* and had no idea where, no sense of
 * what else was out there, and no way to choose. The galaxy was technically
 * infinite and experientially a single room.
 *
 * So the scale ladder gains a rung that is about *place* rather than scale.
 * The full descent now reads:
 *
 *   galactic+   the attunement field   — tune which reality layer manifests
 *   cluster     ┐
 *   interstellar┘ THE MAP             — see the stars around you, choose one
 *   stellar     ┐
 *   system      ┘ the system          — planets, moons, belts, trade
 *   planetary   the surface           — stand on it
 *
 * Which is physically exactly right: at interstellar and cluster scales what
 * you can see *is* neighbouring stars, and that is precisely the scale at
 * which choosing a destination is the meaningful act.
 *
 * ── Vastness on a budget ──────────────────────────────────────────────────
 *
 * The map is a window onto an unbounded sector grid. Every star in it is
 * derived by `stellar.systemAt`, so the galaxy is not a list of places — it is
 * a function, and panning simply asks it about different arguments. The window
 * is cached and only rebuilt when it moves, so a screen of two hundred stars
 * costs one derivation pass and then nothing.
 *
 * What makes it feel vast rather than merely large is that **you can see much
 * further than you can reach.** Stars beyond the consciousness field render as
 * dim, unnamed, unresolvable points. Expanding the field is what turns them
 * into places. The horizon is always populated and always receding.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, hsl, TAU, hashF, hashN, fmt } = RS.core;

  /* Light years per sector cell. Sized so a sector is a plausible stellar
   * neighbourhood and the numbers on screen are ones an astronomer would
   * recognise — the nearest star to the Sun is 4.2 ly away. */
  const LY_PER_SECTOR = 12;

  /* How many sectors of the grid to derive around the player. The visible
   * radius is larger than the reachable one on purpose. */
  const WINDOW = 7;

  function newState() {
    return {
      /* Which sector the player is centred on. This is their galactic
       * position, and it is the only navigation state that persists. */
      sx: 0, sy: 0,
      /* Derived window, rebuilt when the centre or reach changes. */
      stars: [],
      cacheKey: '',
      /* Currently highlighted star, and the one committed to as a target. */
      hover: -1,
      target: null,
      /* Slow parallax drift so the map is never completely still. */
      t: 0
    };
  }

  /* Sector → screen offset, in normalised field units. A star's position
   * within its sector is derived from the sector hash, so the field is
   * irregular the way a real stellar neighbourhood is rather than a lattice. */
  function starsIn(worldSeed, sx, sy) {
    const h = hashN(worldSeed ^ 0x6A1A, sx, sy);
    /* Stellar density falls off with galactocentric radius — the core is
     * crowded, the rim is empty. Same gradient that sets metallicity in
     * stellar.js, so a metal-rich neighbourhood is also a busy one. */
    const galR = Math.hypot(sx, sy) / 64;
    const density = clamp01(1.15 - galR * 0.9);
    const n = Math.max(0, Math.round((0.6 + hashF(h, 1) * 2.6) * density));
    const out = [];
    for (let i = 0; i < n && i < 5; i++) {
      out.push({
        sx, sy, index: i,
        /* Jitter inside the cell, so no star sits on a grid intersection. */
        jx: hashF(h, 10 + i * 3) - 0.5,
        jy: hashF(h, 11 + i * 3) - 0.5,
        hash: hashN(h, 100 + i)
      });
    }
    return out;
  }

  /* Distance in light years between two sector addresses, including the
   * sub-cell jitter, so the readouts are consistent with the picture. */
  function distanceLy(a, b) {
    const dx = (b.sx + (b.jx || 0)) - (a.sx + (a.jx || 0));
    const dy = (b.sy + (b.jy || 0)) - (a.sy + (a.jy || 0));
    return Math.hypot(dx, dy) * LY_PER_SECTOR;
  }

  /* Rebuild the visible window. Derives each star's system only far enough to
   * know its class and whether it holds anything — the full system is derived
   * on arrival, not here, or panning the map would derive thousands of worlds. */
  function refresh(game) {
    const G = game.galaxy;
    const reach = RS.influence.reachRadius(game);
    const key = G.sx + ',' + G.sy + ',' + reach + ',' +
      Object.keys(game.known.systems).length + ',' + Object.keys(game.known.charted).length;
    if (G.cacheKey === key) return G.stars;

    G.stars.length = 0;
    const here = { sx: G.sx, sy: G.sy, jx: 0, jy: 0 };
    for (let dy = -WINDOW; dy <= WINDOW; dy++) {
      for (let dx = -WINDOW; dx <= WINDOW; dx++) {
        const sx = G.sx + dx, sy = G.sy + dy;
        for (const st of starsIn(game.seed, sx, sy)) {
          const dist = distanceLy(here, st);
          if (dist > WINDOW * LY_PER_SECTOR) continue;

          /* Only the star itself is derived here — cheap, and enough to draw
           * and to decide whether it is worth going to. */
          const galR = clamp01(Math.hypot(sx, sy) / 64 + hashF(st.hash, 90) * 0.12);
          const star = RS.stellar.makeStar(hashN(game.seed ^ 0x5711A5, sx, sy, st.index), galR, 0);

          st.star = star;
          st.dist = dist;
          st.name = RS.stellar.nameSystem(hashN(game.seed ^ 0x5711A5, sx, sy, st.index));
          st.key = sx + ',' + sy + ',' + st.index;
          st.visited = !!game.known.systems[st.key];
          st.charted = !!game.known.charted[st.key];
          /* Within the consciousness field you can resolve what is there;
           * outside it, a star is a light and nothing more — unless somebody
           * who lives out there has told you about it. A chart given by a
           * civilisation resolves stars your own field cannot yet reach, which
           * is the concrete reward for the whole contact system. */
          st.inReach = dist <= reach * LY_PER_SECTOR;
          st.resolved = st.inReach || st.visited || st.charted;
          G.stars.push(st);
        }
      }
    }
    G.stars.sort((a, b) => a.dist - b.dist);
    G.cacheKey = key;
    return G.stars;
  }

  /* A cheap "is there anything here" survey, run only for resolved stars and
   * only when the player asks for it — deriving every system's biospheres to
   * paint the map would defeat the point. Cached per address. */
  const surveyCache = new Map();
  function surveyOf(game, st) {
    if (!st.resolved) return null;
    let s = surveyCache.get(st.key);
    if (s) return s;
    const sys = RS.stellar.systemAt(game.seed, st.sx, st.sy, st.index);
    let life = 0, civ = 0, worlds = 0, best = 0;
    for (let j = 0; j < sys.bodies.length; j++) {
      if (sys.bodies[j].kind !== 'planet') continue;
      const p = RS.planet.planetAt(sys, j);
      if (!p) continue;
      worlds++;
      best = Math.max(best, p.habitability);
      if (p.biosphere) life++;
      if (RS.civ.civOf(p, 0)) civ++;
    }
    s = { worlds, life, civ, best, planets: sys.bodies.filter(b => b.kind === 'planet').length };
    if (surveyCache.size > 400) surveyCache.delete(surveyCache.keys().next().value);
    surveyCache.set(st.key, s);
    return s;
  }

  function clearSurveys() { surveyCache.clear(); }

  /* Committing to a star. The reach check is the whole gate on exploration:
   * expanding the consciousness field is what opens the galaxy. */
  function selectStar(game, bus, st) {
    if (!st) return { ok: false, reason: 'nothing there' };
    if (!st.inReach && !st.visited && !st.charted) {
      return { ok: false, reason: 'beyond your consciousness field (' +
        st.dist.toFixed(1) + ' ly, reach ' + (RS.influence.reachRadius(game) * LY_PER_SECTOR).toFixed(0) + ' ly)' };
    }
    game.galaxy.target = st;
    bus.emit('galaxy:target', { star: st });
    return { ok: true };
  }

  /* Travelling re-centres the map on the chosen star, which is what makes the
   * galaxy explorable: each hop becomes the origin of the next window, and the
   * horizon moves with you. */
  function travelTo(game, bus, st) {
    const res = selectStar(game, bus, st);
    if (!res.ok) return res;
    game.galaxy.sx = st.sx;
    game.galaxy.sy = st.sy;
    game.galaxy.cacheKey = '';
    game.stats.jumps = (game.stats.jumps || 0) + 1;
    RS.scenes.enterSystem(game, bus, { sx: st.sx, sy: st.sy, index: st.index });
    bus.emit('galaxy:travel', { star: st });
    return { ok: true };
  }

  function tick(game, bus, dt) {
    game.galaxy.t += dt;
    refresh(game);
  }

  // ── rendering ────────────────────────────────────────────────────────────

  const labelBoxes = [];

  function draw(ctx, game, dt) {
    const V = RS.render.view;
    const G = game.galaxy;
    const stars = refresh(game);
    const reach = RS.influence.reachRadius(game);
    const px = v => v * V.R;

    /* Scale: the whole window maps to the field radius. */
    const span = WINDOW * 0.85;

    /* The reach ring — the single most important thing on this screen, because
     * it is the boundary between "places" and "lights". */
    const reachR = px(reach / span);
    ctx.save();
    const rg = ctx.createRadialGradient(V.cx, V.cy, reachR * 0.75, V.cx, V.cy, reachR);
    rg.addColorStop(0, 'hsla(190,80%,60%,0)');
    rg.addColorStop(1, 'hsla(190,80%,60%,0.07)');
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(V.cx, V.cy, reachR, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'hsla(190,80%,65%,0.30)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 6]);
    ctx.beginPath(); ctx.arc(V.cx, V.cy, reachR, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    /* Faint background haze that thickens toward the galactic core, so the map
     * has a direction and the player can tell which way is "inward". */
    const coreAng = Math.atan2(-G.sy, -G.sx);
    const hg = ctx.createLinearGradient(
      V.cx - Math.cos(coreAng) * px(1.2), V.cy - Math.sin(coreAng) * px(1.2),
      V.cx + Math.cos(coreAng) * px(1.2), V.cy + Math.sin(coreAng) * px(1.2));
    hg.addColorStop(0, 'hsla(40,50%,60%,0)');
    hg.addColorStop(1, 'hsla(40,60%,62%,0.055)');
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, V.w, V.h);

    // ── stars ──
    /* Placed label rectangles, so names can be skipped where they would
     * collide. Reset every frame; never allocated per star. */
    labelBoxes.length = 0;
    for (let i = stars.length - 1; i >= 0; i--) {
      const st = stars[i];
      const dx = (st.sx + st.jx) - G.sx;
      const dy = (st.sy + st.jy) - G.sy;
      const X = V.cx + (dx / span) * V.R;
      const Y = V.cy + (dy / span) * V.R * 0.86;
      if (X < -20 || X > V.w + 20 || Y < -20 || Y > V.h + 20) continue;

      const star = st.star;
      /* Apparent size follows real luminosity, compressed so an O star does
       * not swallow the screen but still visibly dominates. */
      const mag = clamp(Math.log10(1 + star.luminosity) * 0.4 + 0.35, 0.25, 1.5);
      const r = px(0.011) * mag;
      const dim = st.resolved ? 1 : 0.34;

      /* Glow. */
      const g = ctx.createRadialGradient(X, Y, 0, X, Y, r * 6);
      g.addColorStop(0, hsl(star.cls.hue, 0.6, 0.9, 0.85 * dim));
      g.addColorStop(0.3, hsl(star.cls.hue, 0.9, 0.66, 0.30 * dim));
      g.addColorStop(1, hsl(star.cls.hue, 0.9, 0.6, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(X, Y, r * 6, 0, TAU); ctx.fill();
      ctx.fillStyle = hsl(star.cls.hue, 0.3, 0.97, dim);
      ctx.beginPath(); ctx.arc(X, Y, r, 0, TAU); ctx.fill();

      st.__x = X; st.__y = Y; st.__r = r;

      if (!st.resolved) continue;

      /* Survey markers, only for resolved stars. These are the reason to look
       * at the map rather than pick the nearest thing. */
      const sv = surveyOf(game, st);
      if (sv) {
        if (sv.civ > 0) {
          /* A civilisation is the loudest thing on the map, and it pulses so
           * the eye finds it without reading anything. */
          const pulse = 0.6 + Math.sin(G.t * 2.4 + st.hash % 10) * 0.4;
          ctx.strokeStyle = hsl(45, 0.95, 0.68, 0.5 + pulse * 0.4);
          ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(X, Y, r * 4.2 + pulse * 2, 0, TAU); ctx.stroke();
        } else if (sv.life > 0) {
          ctx.strokeStyle = 'hsla(135,80%,60%,0.75)';
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(X, Y, r * 3.4, 0, TAU); ctx.stroke();
        }
      }

      if (st.visited) {
        ctx.strokeStyle = 'rgba(230,240,255,0.42)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(X, Y, r * 2.4, 0, TAU); ctx.stroke();
      } else if (st.charted && !st.inReach) {
        /* Known only because somebody told you. Drawn as a dashed ring so the
         * map visibly distinguishes "I can see this" from "I was told". */
        ctx.strokeStyle = 'hsla(45,85%,68%,0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.arc(X, Y, r * 2.8, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      }

      /* Names, only for the closest handful, and only where they do not collide
       * with a name already placed. Ten overlapping labels is strictly worse
       * than four readable ones — the first version of this piled four names
       * on top of each other and none of them could be read. */
      if (i < 12 && st.inReach) {
        ctx.font = '600 9px ui-monospace, Menlo, monospace';
        const w = ctx.measureText(st.name).width;
        const lx = X - w / 2, ly = Y + r * 6 + 4;
        let clear = true;
        for (const b of labelBoxes) {
          if (lx < b.x + b.w + 3 && lx + w + 3 > b.x && ly < b.y + b.h + 2 && ly + 11 + 2 > b.y) {
            clear = false; break;
          }
        }
        if (clear) {
          labelBoxes.push({ x: lx, y: ly, w, h: 11 });
          ctx.textAlign = 'center';
          /* A dark backing plate, because a light label on a star field is
           * unreadable wherever it crosses another star's glow. */
          ctx.fillStyle = 'rgba(3,6,12,0.62)';
          ctx.fillRect(lx - 2, ly, w + 4, 11);
          ctx.fillStyle = 'rgba(214,228,248,0.78)';
          ctx.fillText(st.name, X, ly + 8);
        }
      }
    }

    // ── the target ──
    const tg = G.target;
    if (tg && tg.__x != null) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      const rr = tg.__r * 6 + Math.sin(G.t * 3) * 2;
      for (let k = 0; k < 4; k++) {
        const a0 = k * TAU / 4 + G.t * 0.5;
        ctx.beginPath(); ctx.arc(tg.__x, tg.__y, rr, a0, a0 + 0.5); ctx.stroke();
      }
      /* A line home, so the player always knows where they are relative to
       * what they have chosen. */
      ctx.strokeStyle = 'rgba(160,200,255,0.22)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(V.cx, V.cy); ctx.lineTo(tg.__x, tg.__y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── you ──
    const yg = ctx.createRadialGradient(V.cx, V.cy, 0, V.cx, V.cy, px(0.06));
    yg.addColorStop(0, 'rgba(255,255,255,0.95)');
    yg.addColorStop(0.3, 'hsla(190,90%,70%,0.35)');
    yg.addColorStop(1, 'hsla(190,90%,70%,0)');
    ctx.fillStyle = yg;
    ctx.beginPath(); ctx.arc(V.cx, V.cy, px(0.06), 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(V.cx, V.cy, px(0.006), 0, TAU); ctx.fill();

    /* Scale bar — without one, "vast" is just a word. */
    const barLy = LY_PER_SECTOR;
    const barPx = (1 / span) * V.R;
    const bx = 16, by = V.cy + px(0.92);
    ctx.strokeStyle = 'rgba(200,220,245,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx, by); ctx.lineTo(bx + barPx, by);
    ctx.moveTo(bx, by - 3); ctx.lineTo(bx, by + 3);
    ctx.moveTo(bx + barPx, by - 3); ctx.lineTo(bx + barPx, by + 3);
    ctx.stroke();
    ctx.font = '600 9px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(200,220,245,0.6)';
    ctx.fillText(barLy + ' ly', bx, by - 6);
  }

  /* Hit test for taps. Generous, because stars are small targets. */
  function pick(game, px, py) {
    let best = null, bd = 30;
    for (const st of game.galaxy.stars) {
      if (st.__x == null) continue;
      const d = Math.hypot(px - st.__x, py - st.__y);
      if (d < bd) { bd = d; best = st; }
    }
    return best;
  }

  RS.galaxy = {
    LY_PER_SECTOR, WINDOW, newState, starsIn, distanceLy, refresh,
    surveyOf, clearSurveys, selectStar, travelTo, tick, draw, pick
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
