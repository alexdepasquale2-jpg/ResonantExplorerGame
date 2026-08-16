/* Resonant — shared substrate: math, easing, springs, seeded noise, bus, ids.
 *
 * Two rules govern this file:
 *
 * 1. Determinism. Every manifestation in the game is *derived*, never stored
 *    (see fractal.js). The same address must resolve to the same thing on
 *    every device, forever, so world-facing randomness always comes from the
 *    hash/RNG helpers here and never from Math.random().
 *
 * 2. Nothing snaps. The brief is "the most reactive, best feedback design",
 *    and the mechanical basis of that is: no displayed value ever jumps to a
 *    new one. It springs. `Spring` and the easing table below are used by
 *    every needle, readout, glow and camera in the game.
 */
(function (RS) {
  'use strict';

  const TAU = Math.PI * 2;

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const clamp01 = v => clamp(v, 0, 1);
  const lerp = (a, b, t) => a + (b - a) * t;
  const invLerp = (a, b, v) => (b === a ? 0 : clamp01((v - a) / (b - a)));
  const remap = (v, a, b, c, d) => lerp(c, d, invLerp(a, b, v));
  const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
  const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));

  /* Frame-rate independent exponential smoothing. `rate` is roughly "how much
   * of the gap is closed per second"; the exp() makes a 30fps frame and a
   * 144fps frame converge identically, which matters because the whole game
   * is smoothed values and they must not feel different on a slow phone. */
  const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

  function angDelta(a, b) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }

  // --- easing --------------------------------------------------------------
  /* Hand-picked set. `outExpo` for anything arriving (feels instant, settles
   * soft), `outBack` for anything that should feel physical, `outElastic`
   * reserved for rare high-impact moments — overused elastic reads as cheap. */
  const ease = {
    linear: t => t,
    inQuad: t => t * t,
    outQuad: t => t * (2 - t),
    inOutQuad: t => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
    outCubic: t => 1 - Math.pow(1 - t, 3),
    inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    outQuart: t => 1 - Math.pow(1 - t, 4),
    outExpo: t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    inExpo: t => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
    outBack: t => { const c = 1.70158, c3 = c + 1; return 1 + c3 * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
    outElastic: t => {
      if (t <= 0 || t >= 1) return t <= 0 ? 0 : 1;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1;
    },
    /* Sharp attack, long tail — the shape of a struck bell, used for every
     * one-shot flash so impacts read as *hits* rather than as fades. */
    impact: t => (t <= 0 ? 0 : t >= 1 ? 0 : Math.pow(1 - t, 2.5) * Math.min(1, t * 14))
  };

  /* Critically-damped-ish spring. Kept as a tiny class rather than a closure
   * because there are hundreds live at once and V8 keeps these monomorphic. */
  function Spring(value, stiffness, damping) {
    this.value = value || 0;
    this.target = this.value;
    this.vel = 0;
    this.k = stiffness || 120;
    this.d = damping == null ? 18 : damping;
  }
  Spring.prototype.step = function (dt) {
    /* Substep so a stiff spring can't explode on a long frame — the whole HUD
     * runs on these and a single 250ms hitch must not fling every needle. */
    const steps = dt > 1 / 45 ? Math.ceil(dt * 60) : 1;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = (this.target - this.value) * this.k - this.vel * this.d;
      this.vel += a * h;
      this.value += this.vel * h;
    }
    return this.value;
  };
  Spring.prototype.set = function (t) { this.target = t; return this; };
  Spring.prototype.snap = function (v) { this.value = this.target = v; this.vel = 0; return this; };
  Spring.prototype.nudge = function (v) { this.vel += v; return this; };
  Spring.prototype.atRest = function (eps) {
    const e = eps || 0.001;
    return Math.abs(this.vel) < e && Math.abs(this.target - this.value) < e;
  };

  // --- deterministic randomness -------------------------------------------
  /* mulberry32 — small, fast, good enough distribution for content synthesis. */
  function rngFrom(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Integer hash over an arbitrary tuple. This is the backbone of the fractal
   * store: an "address" (tier, band, cell, slot…) hashes to a stable 32-bit
   * value that seeds everything about the thing living at that address. */
  function hashN() {
    let h = 0x811c9dc5;
    for (let i = 0; i < arguments.length; i++) {
      let v = arguments[i] | 0;
      /* Mix all four bytes so neighbouring cells don't share high bits — a
       * naive multiply-add here produces visible grid banding in the field. */
      for (let b = 0; b < 4; b++) {
        h ^= (v & 0xff);
        h = Math.imul(h, 0x01000193) >>> 0;
        v >>>= 8;
      }
    }
    h ^= h >>> 15; h = Math.imul(h, 0x2545f491) >>> 0; h ^= h >>> 13;
    return h >>> 0;
  }
  const hashF = function () { return hashN.apply(null, arguments) / 4294967296; };

  function hash2(seed, x, y) { return hashN(seed, x, y) / 4294967296; }

  function noise2(seed, x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(seed, xi, yi), b = hash2(seed, xi + 1, yi);
    const c = hash2(seed, xi, yi + 1), d = hash2(seed, xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }

  function fbm(seed, x, y, octaves) {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let i = 0; i < (octaves || 4); i++) {
      sum += amp * noise2(seed + i * 7919, x * f, y * f);
      norm += amp; amp *= 0.52; f *= 2.03;
    }
    return sum / norm;
  }

  // --- formatting ----------------------------------------------------------
  const SUFFIX = ['', 'k', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
  function fmt(n) {
    if (!Number.isFinite(n)) return '∞';
    const neg = n < 0; n = Math.abs(n);
    if (n < 1000) return (neg ? '-' : '') + (n < 10 && n % 1 !== 0 ? n.toFixed(1) : String(Math.floor(n)));
    let tier = 0;
    while (n >= 1000 && tier < SUFFIX.length - 1) { n /= 1000; tier++; }
    return (neg ? '-' : '') + (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : n.toFixed(0)) + SUFFIX[tier];
  }

  /* Scientific scale readout — the space dial spans 10^-35 to 10^60 metres, so
   * the only honest display is an exponent. */
  function fmtMetres(logM) {
    if (logM == null) return '—';
    const e = Math.round(logM * 100) / 100;
    return '10^' + (e >= 0 ? '' : '') + e.toFixed(2) + ' m';
  }

  function fmtHz(v) {
    return v.toFixed(v < 100 ? 3 : 2) + ' φ';
  }

  function romanize(n) {
    const table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
      [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let out = '';
    for (const [v, s] of table) while (n >= v) { out += s; n -= v; }
    return out || '—';
  }

  // --- events --------------------------------------------------------------
  function makeBus() {
    const listeners = Object.create(null);
    return {
      on(kind, fn) {
        (listeners[kind] || (listeners[kind] = [])).push(fn);
        return () => { const a = listeners[kind]; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
      },
      emit(kind, payload) {
        const a = listeners[kind];
        if (!a) return;
        for (let i = 0; i < a.length; i++) {
          try { a[i](payload); } catch (e) { console.error('[resonant] listener failed for', kind, e); }
        }
      }
    };
  }

  function makeIdGen() {
    const counters = Object.create(null);
    return prefix => {
      counters[prefix] = (counters[prefix] || 0) + 1;
      return prefix + '_' + counters[prefix];
    };
  }

  // --- colour --------------------------------------------------------------
  /* Everything in the game is coloured in HSL and mixed in HSL, because the
   * central visual idea is *blending reality layers*: two bands at half
   * resonance should read as the hue between them, which RGB mixing muddies
   * into grey and HSL keeps luminous. */
  function hsl(h, s, l, a) {
    return 'hsla(' + (((h % 360) + 360) % 360).toFixed(1) + ',' + (s * 100).toFixed(1) + '%,' +
      (l * 100).toFixed(1) + '%,' + (a == null ? 1 : clamp01(a)).toFixed(3) + ')';
  }
  function mixHue(h1, h2, t) { return h1 + angDelta(h1 * Math.PI / 180, h2 * Math.PI / 180) * 180 / Math.PI * t; }

  RS.core = {
    TAU, clamp, clamp01, lerp, invLerp, remap, dist, dist2, damp, angDelta,
    ease, Spring, rngFrom, hashN, hashF, hash2, noise2, fbm,
    fmt, fmtMetres, fmtHz, romanize, makeBus, makeIdGen, hsl, mixHue
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
