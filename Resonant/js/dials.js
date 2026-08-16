/* Resonant — the dials. The player's entire interface with reality.
 *
 * A point of consciousness has no body and no position it can change. What it
 * has is four dials, and everything it will ever perceive is a consequence of
 * where they sit:
 *
 *   τ  TIME       rate and direction of the local clock
 *   Σ  SPACE      which rung of the scale ladder is being rendered
 *   Δ  PHASE      offset along the fourth dimension — which slice of the
 *                 worldline you are standing in
 *   φ  FREQUENCY  which reality layer manifests
 *
 * ── Why the physics here is elaborate ──────────────────────────────────────
 *
 * The brief is that this must be the most satisfying thing to touch. A dial
 * that maps pointer position to value directly feels like a slider with extra
 * steps. What makes a real control satisfying is that it has *mass* and it has
 * *notches*: it keeps turning after you let go, it resists slightly at each
 * detent and then gives, and every notch is a discrete event you can hear and
 * feel. So each dial here carries angular velocity, friction scaled by the
 * local tier's drag, a detent field that pulls toward known snap points, and
 * an encoder that emits a tick event every `tickStep` units crossed. Those
 * ticks are what audio.js clicks and what feel.js buzzes.
 *
 * Upgrades change the physics rather than just the numbers:
 *   RANGE     — raises `max`, reaching parts of the axis that were absent
 *   PRECISION — shrinks `tickStep` and deepens the fine-mode ratio
 *   FOCUS     — narrows the observation window, per-dial
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, TAU } = RS.core;

  /* Per-dial upgrade economics. Deliberately steep: the fantasy is that
   * touching a new layer is a campaign, not a purchase. */
  const UPGRADE = {
    range:     { base: 12,  mult: 1.62, max: 40 },
    precision: { base: 20,  mult: 1.74, max: 24 },
    focus:     { base: 34,  mult: 1.88, max: 22 }
  };

  const DEFS = [
    {
      id: 'time', name: 'Time', symbol: 'τ', unit: '×',
      min: -2, max0: 2.5, hardMax: 12,
      /* Time is signed — running the local clock backwards is a legitimate
       * position, not a cheat, and several layers only cohere under it. */
      rangeStep: 0.85, start: 1,
      tickStep0: 0.125, spanPerTurn: 6,
      hue: 43,
      blurb: 'Rate of the local clock. Negative values run the layer backwards.'
    },
    {
      id: 'space', name: 'Space', symbol: 'Σ', unit: '',
      min: RS.cosmos.ROOT_INDEX, max0: RS.cosmos.ROOT_INDEX,
      hardMin: RS.cosmos.SCALE_MIN, hardMax: RS.cosmos.SCALE_MAX,
      /* Space starts pinned to the root: the Galactic layer is the only rung
       * that exists until range opens the ladder in both directions. */
      rangeStep: 1, start: RS.cosmos.ROOT_INDEX, bidirectional: true,
      tickStep0: 0.1, spanPerTurn: 4,
      hue: 338,
      blurb: 'Which rung of the scale ladder renders. Opens inward and outward from Galactic.'
    },
    {
      id: 'phase', name: 'Phase', symbol: 'Δ', unit: 'rad',
      min: 0, max0: TAU, hardMax: TAU,
      /* Phase is a full circle from the start — the fourth dimension is not
       * gated by reach, only by how finely you can divide it. */
      rangeStep: 0, start: 0, wraps: true,
      tickStep0: TAU / 16, spanPerTurn: TAU,
      hue: 268,
      blurb: 'Offset along the fourth dimension. Selects which slice of a worldline is present.'
    },
    {
      id: 'frequency', name: 'Frequency', symbol: 'φ', unit: 'φ',
      min: 0, max0: 62, hardMax: RS.spectrum.PHI_MAX,
      rangeStep: 26, start: 8,
      tickStep0: 1.0, spanPerTurn: 90,
      hue: 187,
      blurb: 'Which reality layer manifests. The axis all the others are read against.'
    }
  ];

  function makeDial(def) {
    return {
      id: def.id,
      value: def.start,
      /* `shown` is what the needle actually draws — a spring chasing `value`,
       * so even an instant programmatic jump arrives with weight. */
      shown: new RS.core.Spring(def.start, 260, 26),
      vel: 0,
      min: def.hardMin != null && def.bidirectional ? def.min : def.min,
      max: def.max0,
      levels: { range: 0, precision: 0, focus: 0 },
      grabbed: false,
      grabAngle: 0,
      grabValue: 0,
      fine: false,
      /* Accumulated distance since the last encoder tick. */
      tickAcc: 0,
      lastTickAt: 0,
      /* Detent capture state, so we can emit a distinct "seated" event exactly
       * once when the dial settles into a notch rather than every frame. */
      seatedOn: null,
      idleT: 0
    };
  }

  function newSet() {
    const dials = Object.create(null);
    for (const d of DEFS) dials[d.id] = makeDial(d);
    return dials;
  }

  const defOf = id => DEFS.find(d => d.id === id);

  // --- derived stats -------------------------------------------------------

  /* Smallest meaningful movement: one encoder notch. Precision halves this
   * roughly every four levels, so late dials resolve four decimal places. */
  function tickStep(dial) {
    const def = defOf(dial.id);
    return def.tickStep0 / Math.pow(1.34, dial.levels.precision);
  }

  /* Fine mode divides pointer travel by this. It grows with precision so the
   * fine gear stays useful as the notches shrink. */
  function fineRatio(dial) { return 6 + dial.levels.precision * 2.2; }

  /* 0..1 observation sharpness. Feeds spectrum.resonanceOf for the frequency
   * dial, and the alignment windows for the others. Asymptotic — you approach
   * perfect focus and never quite buy it.
   *
   * The decay base and the level cap are load-bearing together: they set the
   * maximum focus any observer can ever reach (0.9754), and every band's
   * `minFocus` in spectrum.js must sit below that with room to spare, or the
   * top of the spectrum is unreachable no matter how much a player spends.
   * simtest.js asserts this rather than trusting it. */
  const FOCUS_DECAY = 0.845;
  function focusOf(dial) { return 1 - Math.pow(FOCUS_DECAY, dial.levels.focus); }
  /* Ceiling with every focus level bought — spectrum.js is written against it. */
  const MAX_FOCUS = 1 - Math.pow(FOCUS_DECAY, UPGRADE.focus.max);

  function reachOf(dial) {
    const def = defOf(dial.id);
    const lo = def.bidirectional
      ? clamp(def.min - def.rangeStep * dial.levels.range, def.hardMin, def.max0)
      : def.min;
    const hi = clamp(def.max0 + def.rangeStep * dial.levels.range, def.min, def.hardMax);
    return { lo, hi };
  }

  function costOf(dial, kind) {
    const u = UPGRADE[kind];
    const lvl = dial.levels[kind];
    if (lvl >= u.max) return Infinity;
    return Math.ceil(u.base * Math.pow(u.mult, lvl) * (1 + dial.levels.range * 0.04));
  }

  function canUpgrade(dial, kind) {
    const def = defOf(dial.id);
    /* Phase has no reach to buy — it is already a closed circle. */
    if (kind === 'range' && def.rangeStep === 0) return false;
    return dial.levels[kind] < UPGRADE[kind].max;
  }

  function applyUpgrade(dial, kind) {
    dial.levels[kind]++;
    const r = reachOf(dial);
    dial.min = r.lo; dial.max = r.hi;
    return dial;
  }

  function refreshReach(dials) {
    for (const id in dials) {
      const r = reachOf(dials[id]);
      dials[id].min = r.lo; dials[id].max = r.hi;
    }
  }

  // --- detents -------------------------------------------------------------

  /* Detents are *discovered*, not given. The frequency dial only snaps to
   * bands the player has already made cohere, which turns the spectrum into a
   * map you fill in rather than a menu you pick from. */
  function detentsFor(game, dialId) {
    const out = [];
    if (dialId === 'frequency') {
      for (const b of RS.spectrum.BANDS) {
        if (game.known.bands[b.id]) out.push({ at: b.centre, label: b.name, strong: true });
      }
    } else if (dialId === 'space') {
      for (const t of RS.cosmos.TIERS) {
        if (game.known.tiers[t.id]) out.push({ at: t.index, label: t.short, strong: t.root });
      }
    } else if (dialId === 'time') {
      /* Unity, stasis and reversal are structurally special rates. */
      out.push({ at: 1, label: '1×', strong: true });
      out.push({ at: 0, label: 'STASIS' });
      if (game.dials.time.min <= -1) out.push({ at: -1, label: '−1×' });
      if (game.dials.time.max >= 2) out.push({ at: 2, label: '2×' });
    } else if (dialId === 'phase') {
      const n = 4 + game.dials.phase.levels.precision;
      for (let i = 0; i < n; i++) out.push({ at: (i / n) * TAU, label: i === 0 ? '0' : null });
    }
    return out;
  }

  function nearestDetent(game, dial, value) {
    const ds = detentsFor(game, dial.id);
    let best = null, bd = Infinity;
    for (const d of ds) {
      const delta = Math.abs(d.at - value);
      if (delta < bd) { bd = delta; best = d; }
    }
    return best ? { detent: best, delta: bd } : null;
  }

  // --- interaction ---------------------------------------------------------

  function grab(dial, angle) {
    dial.grabbed = true;
    dial.grabAngle = angle;
    dial.grabValue = dial.value;
    dial.vel = 0;
    dial.idleT = 0;
  }

  /* Applied on pointer move. `angle` is absolute pointer angle around the dial
   * centre; we integrate the delta rather than mapping absolutely so the dial
   * never teleports when a finger lands off-centre. */
  function drag(game, dial, angle, dt) {
    const def = defOf(dial.id);
    let dAng = RS.core.angDelta(dial.grabAngle, angle);
    dial.grabAngle = angle;
    let delta = (dAng / TAU) * def.spanPerTurn;
    if (dial.fine) delta /= fineRatio(dial);
    const before = dial.value;
    setValue(game, dial, dial.value + delta);
    /* Velocity for the flywheel, smoothed so a jittery finger doesn't fling
     * the dial on release. */
    if (dt > 0) dial.vel = lerp(dial.vel, (dial.value - before) / dt, 0.4);
    dial.idleT = 0;
  }

  function release(dial) {
    dial.grabbed = false;
    /* Cap the flywheel: a fast flick should coast, not launch across the whole
     * spectrum and lose the player their place. */
    const def = defOf(dial.id);
    const cap = def.spanPerTurn * 1.6;
    dial.vel = clamp(dial.vel, -cap, cap);
  }

  function setValue(game, dial, v) {
    const def = defOf(dial.id);
    if (def.wraps) {
      const span = dial.max - dial.min;
      v = ((v - dial.min) % span + span) % span + dial.min;
    } else if (v < dial.min) {
      v = dial.min; dial.vel = 0;
    } else if (v > dial.max) {
      v = dial.max; dial.vel = 0;
    }
    dial.value = v;
    dial.shown.set(v);
  }

  /* Per-frame physics. Returns the number of encoder ticks crossed this frame
   * so the caller can fire exactly that many clicks. */
  function step(game, dial, dt, emit) {
    const def = defOf(dial.id);
    const before = dial.value;

    if (!dial.grabbed) {
      if (Math.abs(dial.vel) > 1e-5) {
        /* Friction rises with the tier's drag: the deep quantum tiers are
         * slippery and the ensemble tiers are treacle. Same dial, different
         * physics per reality — a cheap trick that sells the premise hard. */
        const drag = RS.cosmos.dragAt(game.dials.space.value);
        const friction = 2.4 + 9.0 * drag;
        dial.vel *= Math.exp(-friction * dt);
        setValue(game, dial, dial.value + dial.vel * dt);
        if (Math.abs(dial.vel) < 1e-4) dial.vel = 0;
      }
      dial.idleT += dt;
    }

    /* Detent field. Pulls toward the nearest known notch, but only inside a
     * capture radius and only when the dial is moving slowly — so it assists a
     * player homing in and never fights one sweeping past. */
    const nd = nearestDetent(game, dial, dial.value);
    if (nd) {
      const step0 = tickStep(dial);
      const capture = step0 * (2.6 + focusOf(dial) * 3.4);
      const speed = Math.abs(dial.vel);
      if (nd.delta < capture && speed < capture * 6) {
        const pull = (1 - nd.delta / capture);
        const force = pull * pull * (dial.grabbed ? 5.5 : 17.0);
        const dir = Math.sign(nd.detent.at - dial.value);
        const move = dir * Math.min(nd.delta, force * nd.delta * dt);
        setValue(game, dial, dial.value + move);
        if (!dial.grabbed) dial.vel *= Math.exp(-7 * dt);

        /* Seated: close enough that the notch has taken over. Fires once. */
        if (nd.delta < step0 * 0.35 && dial.seatedOn !== nd.detent.at) {
          dial.seatedOn = nd.detent.at;
          if (emit) emit('dial:seat', { dial, detent: nd.detent });
        }
      } else if (dial.seatedOn != null && nd.delta > capture) {
        dial.seatedOn = null;
      }
    } else {
      dial.seatedOn = null;
    }

    /* Encoder ticks. Counted on distance travelled rather than on absolute
     * position so a wrapped phase dial still clicks evenly. */
    const moved = Math.abs(dial.value - before);
    if (moved > 0) {
      dial.tickAcc += moved;
      const st = tickStep(dial);
      let ticks = 0;
      while (dial.tickAcc >= st && ticks < 12) { dial.tickAcc -= st; ticks++; }
      if (ticks > 0 && emit) {
        emit('dial:tick', { dial, ticks, speed: Math.abs(dial.vel), fine: dial.fine });
      }
      return ticks;
    }
    return 0;
  }

  function stepAll(game, dt, emit) {
    for (const id in game.dials) {
      const d = game.dials[id];
      step(game, d, dt, emit);
      d.shown.step(dt);
    }
  }

  /* Aggregate sharpness of the observer — the average of the four focus
   * levels, used wherever a single "how coherent is this consciousness"
   * number is wanted (the field's hold strength, mostly). */
  function observerFocus(dials) {
    let s = 0, n = 0;
    for (const id in dials) { s += focusOf(dials[id]); n++; }
    return n ? s / n : 0;
  }

  /* Normalised needle position, for rendering. */
  function normalised(dial) {
    const span = dial.max - dial.min;
    return span > 0 ? clamp01((dial.shown.value - dial.min) / span) : 0;
  }

  RS.dials = {
    DEFS, UPGRADE, newSet, defOf, tickStep, fineRatio, focusOf, reachOf,
    MAX_FOCUS, costOf, canUpgrade, applyUpgrade, refreshReach,
    detentsFor, nearestDetent, grab, drag, release, setValue, step, stepAll,
    observerFocus, normalised
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
