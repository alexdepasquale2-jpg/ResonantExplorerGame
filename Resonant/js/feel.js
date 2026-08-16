/* Resonant — feel. The layer that makes everything else land.
 *
 * Nothing in this file affects the simulation. It exists purely so that events
 * which are *mechanically* a number changing are *experienced* as impacts.
 * Every effect here obeys three rules learned the hard way about game feel:
 *
 *   1. Impact before decay. An effect that fades in is invisible. Every
 *      envelope here is instant-on and slow-off (core.ease.impact).
 *
 *   2. Redundant channels. A crystallisation shakes the screen, flashes the
 *      palette, bursts particles, pops a number, ripples a ring, clicks the
 *      haptics and strikes a chord — seven channels for one event. Any one of
 *      them alone reads as cheap; together they read as weight.
 *
 *   3. Budgeted. Trauma is capped, particles are pooled and finite, hitstop is
 *      clamped. Unbudgeted juice turns a good moment into an unreadable mess
 *      the tenth time it happens in a row.
 *
 * Hitstop deserves a note: it scales the *simulation* clock, never this
 * module's own clock or the renderer's. Freezing the world while the particles
 * keep moving is what makes a hit feel like it connected; freezing everything
 * just looks like a dropped frame.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, damp, ease, TAU } = RS.core;

  const MAX_PARTICLES = 900;
  const MAX_FLOATERS = 42;
  const MAX_RIPPLES = 36;

  const state = {
    trauma: 0,
    shakeX: 0, shakeY: 0, shakeRot: 0,
    hitstop: 0,
    timeScale: 1,
    flash: 0, flashHue: 200, flashSat: 0.8,
    aberr: 0,
    zoomPunch: 0,
    vignette: 0,
    t: 0,
    reduceMotion: false,
    haptics: true,
    particles: [],
    pFree: [],
    floaters: [],
    ripples: []
  };

  function init(opts) {
    state.reduceMotion = !!(opts && opts.reduceMotion);
    state.haptics = !(opts && opts.haptics === false);
    /* Preallocate the whole particle pool up front. Allocating mid-burst is
     * exactly when a GC pause is least affordable. */
    state.particles.length = 0;
    state.pFree.length = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      state.pFree.push({ alive: false });
    }
  }

  function setReduceMotion(v) { state.reduceMotion = !!v; }
  function setHaptics(v) { state.haptics = !!v; }

  // --- screen shake --------------------------------------------------------

  /* Trauma model: callers add trauma, shake renders as trauma², so small
   * events barely register and large ones dominate — which is the correct
   * relationship and the reason a linear shake always feels wrong. */
  function shake(amount) {
    if (state.reduceMotion) return;
    state.trauma = clamp01(state.trauma + amount);
  }

  function hitstop(seconds) {
    /* Clamped low. Hitstop past ~120 ms stops reading as impact and starts
     * reading as lag. */
    state.hitstop = Math.min(0.12, Math.max(state.hitstop, seconds));
  }

  function flash(hue, strength, sat) {
    state.flashHue = hue;
    state.flashSat = sat == null ? 0.8 : sat;
    state.flash = clamp01(Math.max(state.flash, strength));
  }

  function aberrate(amount) {
    if (state.reduceMotion) return;
    state.aberr = clamp(Math.max(state.aberr, amount), 0, 14);
  }

  function punch(amount) {
    if (state.reduceMotion) return;
    state.zoomPunch = clamp(Math.max(state.zoomPunch, amount), 0, 0.35);
  }

  function vignette(amount) {
    state.vignette = clamp01(Math.max(state.vignette, amount));
  }

  // --- haptics -------------------------------------------------------------

  /* Vibration patterns, kept short and distinct. Long buzzes are unpleasant
   * and get the whole feature switched off by the player. */
  const PATTERNS = {
    tick: 6,
    seat: [12],
    step: [8, 20, 8],
    crystal: [18, 26, 34],
    discover: [24, 40, 24, 40, 60],
    deny: [40, 30, 40]
  };
  let lastBuzz = 0;
  function buzz(kind) {
    if (!state.haptics || typeof navigator === 'undefined' || !navigator.vibrate) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    /* Rate limit: the encoder can tick 30×/second and the motor cannot keep
     * up — unlimited ticks feel like a single continuous mush. */
    if (kind === 'tick' && now - lastBuzz < 45) return;
    lastBuzz = now;
    try { navigator.vibrate(PATTERNS[kind] || 8); } catch (e) { /* unsupported */ }
  }

  // --- particles -----------------------------------------------------------

  function spawn(p) {
    const o = state.pFree.pop();
    if (!o) return null;
    o.alive = true;
    o.x = p.x; o.y = p.y;
    o.vx = p.vx || 0; o.vy = p.vy || 0;
    o.life = p.life || 1; o.age = 0;
    o.size = p.size || 2;
    o.hue = p.hue == null ? 200 : p.hue;
    o.sat = p.sat == null ? 0.8 : p.sat;
    o.lum = p.lum == null ? 0.65 : p.lum;
    o.drag = p.drag == null ? 1.6 : p.drag;
    o.grav = p.grav || 0;
    o.kind = p.kind || 'spark';
    o.spin = p.spin || 0;
    o.rot = p.rot || 0;
    o.homing = p.homing || 0;   // pull toward origin, for harvest streams
    o.trail = p.trail || 0;
    o.px = o.x; o.py = o.y;
    state.particles.push(o);
    return o;
  }

  /* Radial burst. `spread` < TAU makes a cone, which is how a directional hit
   * is distinguished from an omnidirectional one. */
  function burst(x, y, count, opts) {
    if (state.reduceMotion) count = Math.ceil(count * 0.35);
    const o = opts || {};
    const base = o.angle == null ? Math.random() * TAU : o.angle;
    const spread = o.spread == null ? TAU : o.spread;
    for (let i = 0; i < count; i++) {
      const a = base + (spread === TAU ? (i / count) * TAU : (Math.random() - 0.5) * spread);
      const sp = (o.speed || 0.4) * (0.35 + Math.random() * 0.95);
      spawn({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: (o.life || 0.8) * (0.6 + Math.random() * 0.8),
        size: (o.size || 2.4) * (0.5 + Math.random()),
        hue: (o.hue == null ? 200 : o.hue) + (Math.random() - 0.5) * (o.hueVar || 40),
        sat: o.sat == null ? 0.85 : o.sat,
        lum: o.lum == null ? 0.68 : o.lum,
        drag: o.drag == null ? 2.0 : o.drag,
        grav: o.grav || 0,
        kind: o.kind || 'spark',
        spin: (Math.random() - 0.5) * 8,
        homing: o.homing || 0,
        trail: o.trail || 0
      });
    }
  }

  /* Harvest stream: particles that curve into the centre. Used when a node
   * pays out, so the currency visibly *arrives* at the player rather than
   * appearing in a counter. */
  function stream(x, y, count, opts) {
    const o = opts || {};
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const sp = 0.18 + Math.random() * 0.3;
      spawn({
        x: x + Math.cos(a) * 0.02, y: y + Math.sin(a) * 0.02,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.75 + Math.random() * 0.5,
        size: 1.6 + Math.random() * 2.2,
        hue: (o.hue == null ? 200 : o.hue) + (Math.random() - 0.5) * 30,
        sat: 0.9, lum: 0.7,
        drag: 0.8,
        kind: 'mote',
        homing: o.homing == null ? 5.5 : o.homing,
        trail: 1
      });
    }
  }

  function ripple(x, y, opts) {
    if (state.ripples.length >= MAX_RIPPLES) state.ripples.shift();
    const o = opts || {};
    state.ripples.push({
      x, y, age: 0,
      life: o.life || 0.7,
      r0: o.r0 || 0.01, r1: o.r1 || 0.35,
      hue: o.hue == null ? 200 : o.hue,
      sat: o.sat == null ? 0.85 : o.sat,
      width: o.width || 2.5,
      ease: o.ease || 'outExpo',
      fill: !!o.fill
    });
  }

  function floater(x, y, text, opts) {
    if (state.floaters.length >= MAX_FLOATERS) state.floaters.shift();
    const o = opts || {};
    state.floaters.push({
      x, y, text, age: 0,
      life: o.life || 1.15,
      hue: o.hue == null ? 200 : o.hue,
      size: o.size || 15,
      rise: o.rise == null ? 0.13 : o.rise,
      drift: (Math.random() - 0.5) * 0.05,
      weight: o.weight || 700,
      /* Overshoot on arrival — a number that pops in past its final size and
       * settles reads as louder than one that simply appears. */
      pop: new RS.core.Spring(0, 420, 22).set(1)
    });
  }

  // --- update --------------------------------------------------------------

  /* `dt` here is real time, never scaled by hitstop — see the header. Returns
   * the scale the *simulation* should use this frame. */
  function update(dt) {
    state.t += dt;

    if (state.hitstop > 0) {
      state.hitstop = Math.max(0, state.hitstop - dt);
      /* Not a hard zero: a sliver of motion during hitstop keeps it from
       * reading as a frozen frame. */
      state.timeScale = 0.06;
    } else {
      state.timeScale = damp(state.timeScale, 1, 22, dt);
    }

    // shake
    if (state.trauma > 0) {
      state.trauma = Math.max(0, state.trauma - dt * 1.35);
      const s = state.trauma * state.trauma;
      const t = state.t * 34;
      state.shakeX = (RS.core.noise2(101, t, 0) * 2 - 1) * s;
      state.shakeY = (RS.core.noise2(202, 0, t) * 2 - 1) * s;
      state.shakeRot = (RS.core.noise2(303, t, t) * 2 - 1) * s * 0.06;
    } else {
      state.shakeX = state.shakeY = state.shakeRot = 0;
    }

    state.flash = Math.max(0, state.flash - dt * 3.1);
    state.aberr = damp(state.aberr, 0, 7.5, dt);
    state.zoomPunch = damp(state.zoomPunch, 0, 9.5, dt);
    state.vignette = damp(state.vignette, 0, 2.4, dt);

    // particles
    const ps = state.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        ps[i] = ps[ps.length - 1]; ps.pop();
        if (state.pFree.length < MAX_PARTICLES) state.pFree.push(p);
        continue;
      }
      p.px = p.x; p.py = p.y;
      if (p.homing > 0) {
        /* Accelerating pull, so motes leave lazily and arrive fast — a linear
         * pull looks like they are being sucked in by a machine. */
        const d = Math.hypot(p.x, p.y) + 1e-4;
        const pull = p.homing * (0.35 + p.age / p.life);
        p.vx -= (p.x / d) * pull * dt;
        p.vy -= (p.y / d) * pull * dt;
      }
      p.vy += p.grav * dt;
      const f = Math.exp(-p.drag * dt);
      p.vx *= f; p.vy *= f;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }

    for (let i = state.ripples.length - 1; i >= 0; i--) {
      const r = state.ripples[i];
      r.age += dt;
      if (r.age >= r.life) state.ripples.splice(i, 1);
    }
    for (let i = state.floaters.length - 1; i >= 0; i--) {
      const f = state.floaters[i];
      f.age += dt;
      f.pop.step(dt);
      if (f.age >= f.life) state.floaters.splice(i, 1);
    }

    return state.timeScale;
  }

  // --- composite effects ---------------------------------------------------
  /* Named after the *event*, not the effect, so callers read as a description
   * of what happened rather than a list of visual settings. */

  const FX = {
    dialTick(strength, hue) {
      buzz('tick');
      if (strength > 0.5) aberrate(0.6);
    },
    dialSeat(hue) {
      buzz('seat');
      shake(0.055);
      punch(0.012);
      aberrate(1.6);
      flash(hue, 0.06, 0.5);
    },
    /* ── A strike ─────────────────────────────────────────────────────────
     *
     * The ring is the important part. It expands *inward* — starting wide and
     * closing on the node — because a strike is attention arriving rather than
     * energy leaving, and an outward ring would read as the node emitting
     * something. It gets tighter and brighter with the combo, so the twentieth
     * strike does not look like the first.
     */
    strike(node, quality, combo) {
      if (!node) return;
      const hue = node.man ? node.man.hue : 200;
      const q = Math.max(0, Math.min(1, quality));
      buzz('step');
      ripple(node.x, node.y, {
        r0: 0.16 - q * 0.05, r1: 0.03,
        life: 0.30, hue: combo ? hue + 30 : hue,
        width: 1.2 + q * 2.2
      });
      if (combo) {
        burst(node.x, node.y, 3 + Math.min(9, Math.round(combo * 0.5)),
          { hue: hue + 30, speed: 0.20 + q * 0.16, life: 0.42, size: 1.4 + q });
        /* The count, floating off the node — but only at milestones. One per
         * strike buries the field in numbers within a few seconds, and a number
         * that arrives every time is a number nobody reads. Every fifth, plus
         * the fifth itself, so the first one lands early enough to explain what
         * is happening. The running count lives on the ring at the centre. */
        if (combo === 5 || (combo >= 10 && combo % 10 === 0)) {
          floater(node.x, node.y, '×' + combo, { hue: hue + 30, life: 0.9 });
        }
      }
      punch(0.006 + q * 0.010);
    },
    strikeBreak(node) {
      if (!node) return;
      buzz('deny');
      ripple(node.x, node.y, { r0: 0.04, r1: 0.13, life: 0.36, hue: 8, width: 1.4 });
      aberrate(1.2);
    },
    coherenceStep(x, y, mark, hue) {
      buzz('step');
      ripple(x, y, { r0: 0.02, r1: 0.09 + mark * 0.05, life: 0.45, hue, width: 1.6 });
      burst(x, y, 4 + Math.round(mark * 5), { hue, speed: 0.22, life: 0.5, size: 1.7 });
      shake(0.03 * mark);
    },
    crystallise(x, y, hue, rarity, amount) {
      buzz('crystal');
      const heft = 1 + rarity * 0.75;
      shake(0.14 * heft);
      hitstop(0.028 + rarity * 0.016);
      punch(0.05 * heft);
      aberrate(3.5 * heft);
      flash(hue, 0.16 * heft, 0.9);
      ripple(x, y, { r0: 0.03, r1: 0.30 + rarity * 0.12, life: 0.66, hue, width: 3.2 });
      ripple(x, y, { r0: 0.02, r1: 0.16, life: 0.36, hue: hue + 40, width: 1.4 });
      burst(x, y, 16 + rarity * 12, { hue, speed: 0.75, life: 0.85, size: 2.6, hueVar: 55 });
      stream(x, y, 10 + rarity * 8, { hue });
      floater(x, y, '+' + RS.core.fmt(amount), { hue, size: 15 + rarity * 5 });
    },
    discovery(hue, magnitude) {
      buzz('discover');
      shake(0.3 * magnitude);
      hitstop(0.06);
      punch(0.13 * magnitude);
      aberrate(9 * magnitude);
      flash(hue, 0.3 * magnitude, 0.95);
      vignette(0.7);
      for (let i = 0; i < 3; i++) {
        setTimeout(() => ripple(0, 0, {
          r0: 0.05, r1: 1.5, life: 1.5, hue: hue + i * 30, width: 4 - i
        }), i * 110);
      }
      burst(0, 0, 60, { hue, speed: 1.5, life: 1.6, size: 3.2, hueVar: 90, drag: 1.1 });
    },
    upheaval(hue, strength) {
      shake(0.2 * strength);
      aberrate(7 * strength);
      flash(hue, 0.12 * strength, 0.6);
      punch(0.07 * strength);
      ripple(0, 0, { r0: 1.3, r1: 0.02, life: 0.55, hue, width: 3 });
    },
    purchase(hue) {
      buzz('seat');
      shake(0.07); punch(0.03); aberrate(2.2);
      flash(hue, 0.1, 0.8);
      ripple(0, 0, { r0: 0.02, r1: 0.5, life: 0.6, hue, width: 2 });
    },
    deny() {
      buzz('deny');
      shake(0.05);
      flash(0, 0.08, 0.9);
    },
    footfall(hue) {
      if (state.reduceMotion) return;
      buzz('tap');
      ripple(0, 0, { r0: 0.7, r1: 0.02, life: 0.2, hue: hue || 130, width: 1.1 });
    }
  };

  RS.feel = {
    state, init, setReduceMotion, setHaptics,
    shake, hitstop, flash, aberrate, punch, vignette, buzz,
    burst, stream, ripple, floater, spawn, update, FX,
    get timeScale() { return state.timeScale; }
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
