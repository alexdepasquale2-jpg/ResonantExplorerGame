/* Resonant — input.
 *
 * Three deliberate choices here, all of them about feel:
 *
 * 1. MULTI-TOUCH DIALS. Every dial tracks its own pointerId, so two thumbs can
 *    work two dials at once. Once a player discovers they can hold φ steady
 *    with one thumb while walking Δ in with the other, the controls stop being
 *    a menu and start being an instrument. This is the single highest-value
 *    thing in the file.
 *
 * 2. DISTANCE-SCALED PRECISION. Sensitivity falls off with how far the pointer
 *    is from the knob's centre — finger on the hub is coarse, finger swung out
 *    wide is fine. This is the standard trick in professional audio UIs and it
 *    is continuous, so a player can go from a full sweep to a hairline
 *    adjustment inside one gesture without ever letting go or hunting for a
 *    modifier. The explicit fine toggle stays as well, for players who never
 *    find it.
 *
 * 3. NO DEAD TAPS. Every tap resolves to something: the strip jumps the dial,
 *    a node opens its readout, the background dismisses. A control surface
 *    that silently ignores a third of the touches on it feels broken even when
 *    every individual feature works.
 */
(function (RS) {
  'use strict';
  const { clamp, TAU } = RS.core;

  const TAP_MS = 260;
  const TAP_SLOP = 12;
  const DOUBLE_MS = 300;

  function attach(canvas, game, bus, handlers) {
    /* pointerId → what that pointer is doing. */
    const active = new Map();
    let lastTapAt = 0, lastTapDial = null;

    const rectOf = () => canvas.getBoundingClientRect();

    function localPoint(e) {
      const r = rectOf();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function onDown(e) {
      /* Audio contexts can only be created inside a gesture. */
      if (game.settings.audio) RS.audio.unlock();

      const p = localPoint(e);
      const now = performance.now();

      const reg = RS.hud.hitDial(p.x, p.y);
      if (reg) {
        const dial = game.dials[reg.id];
        const ang = Math.atan2(p.y - reg.cy, p.x - reg.cx);
        RS.dials.grab(dial, ang);
        active.set(e.pointerId, {
          kind: 'dial', reg, dial,
          startX: p.x, startY: p.y, startAt: now, moved: 0
        });
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not captureable */ }
        e.preventDefault();
        return;
      }

      const phi = RS.hud.hitStrip(p.x, p.y);
      if (phi != null) {
        active.set(e.pointerId, { kind: 'strip', startX: p.x, startY: p.y, startAt: now, moved: 0, phi });
        e.preventDefault();
        return;
      }

      active.set(e.pointerId, { kind: 'field', startX: p.x, startY: p.y, startAt: now, moved: 0 });
    }

    function onMove(e) {
      const a = active.get(e.pointerId);
      if (!a) return;
      const p = localPoint(e);
      a.moved = Math.max(a.moved, Math.hypot(p.x - a.startX, p.y - a.startY));

      if (a.kind === 'dial') {
        const { reg, dial } = a;
        const dx = p.x - reg.cx, dy = p.y - reg.cy;
        const ang = Math.atan2(dy, dx);
        const radius = Math.hypot(dx, dy);

        /* Distance-scaled precision. Ratio 1 at the knob edge; swinging out to
         * three radii divides sensitivity by three. Clamped so a finger at the
         * exact centre — where the angle is numerically unstable — cannot
         * produce a huge jump. */
        const ratio = clamp(radius / Math.max(1, reg.r), 0.55, 6);
        const before = dial.value;
        const savedFine = dial.fine;
        /* Fold the distance factor in through the existing fine-ratio path so
         * the two mechanisms compose rather than fight. */
        const prevGrab = dial.grabAngle;
        let dAng = RS.core.angDelta(prevGrab, ang);
        dial.grabAngle = ang;
        const def = RS.dials.defOf(dial.id);
        let delta = (dAng / TAU) * def.spanPerTurn / ratio;
        if (dial.fine) delta /= RS.dials.fineRatio(dial);
        RS.dials.setValue(game, dial, dial.value + delta);
        const dt = Math.max(1e-3, (performance.now() - (a.lastMoveAt || a.startAt)) / 1000);
        dial.vel = RS.core.lerp(dial.vel, (dial.value - before) / dt, 0.4);
        a.lastMoveAt = performance.now();
        dial.fine = savedFine;
        e.preventDefault();
        return;
      }

      /* Dragging on the world steers an inhabited body. This exists alongside
       * the dials rather than instead of them: dials give precision and
       * sustained heading, the drag gives an immediate shove. Players reach
       * for one or the other depending on urgency, and neither is the "real"
       * control scheme. */
      if (a.kind === 'field' && game.inhabiting && handlers && handlers.onSteer) {
        const V = RS.render.view;
        const lx = (p.x - (a.lastX == null ? a.startX : a.lastX)) / V.R;
        const ly = (p.y - (a.lastY == null ? a.startY : a.lastY)) / V.R;
        handlers.onSteer(lx, ly);
        a.lastX = p.x; a.lastY = p.y;
        e.preventDefault();
        return;
      }

      if (a.kind === 'strip' && a.moved > TAP_SLOP) {
        /* Dragging along the strip scrubs the dial live rather than waiting
         * for release — scrubbing a spectrum analyser and hearing the layers
         * go past is one of the better things in the game. */
        const phi = RS.hud.hitStrip(p.x, p.y);
        if (phi != null) {
          RS.dials.setValue(game, game.dials.frequency,
            clamp(phi, game.dials.frequency.min, game.dials.frequency.max));
        }
        e.preventDefault();
      }
    }

    function onUp(e) {
      const a = active.get(e.pointerId);
      if (!a) return;
      active.delete(e.pointerId);
      const now = performance.now();
      const isTap = a.moved < TAP_SLOP && (now - a.startAt) < TAP_MS;

      if (a.kind === 'dial') {
        RS.dials.release(a.dial);
        if (isTap) {
          /* Double-tap latches fine mode. Single tap arrests the flywheel,
           * which is what a hand on a spinning knob does. */
          if (lastTapDial === a.dial.id && (now - lastTapAt) < DOUBLE_MS) {
            a.dial.fine = !a.dial.fine;
            bus.emit('dial:fine', { dial: a.dial });
            lastTapAt = 0; lastTapDial = null;
          } else {
            a.dial.vel = 0;
            lastTapAt = now; lastTapDial = a.dial.id;
          }
        }
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* fine */ }
        return;
      }

      if (a.kind === 'strip' && isTap && a.phi != null) {
        const D = game.dials.frequency;
        const target = clamp(a.phi, D.min, D.max);
        if (a.phi > D.max) {
          bus.emit('input:outofreach', { phi: a.phi });
        } else {
          /* Assign the value but leave the spring behind, so the needle
           * visibly travels there instead of teleporting. */
          RS.dials.setValue(game, D, target);
          bus.emit('dial:jump', { dial: D });
        }
        return;
      }

      if (a.kind === 'field' && isTap) {
        /* What a tap on the world means depends on which world it is. Each
         * scene resolves it to something; none of them swallow it. */
        const scene = game.scene;
        if (scene.kind === 'galaxy') {
          const st = RS.galaxy.pick(game, a.startX, a.startY);
          if (st && handlers && handlers.onPickStar) handlers.onPickStar(st);
        } else if (scene.kind === 'system') {
          const idx = pickBody(game, a.startX, a.startY);
          if (idx >= 0 && handlers && handlers.onPickBody) handlers.onPickBody(idx);
        } else if (scene.kind === 'planet') {
          /* Observing: tap aims a latitude. Embodied: the same tap reads the
           * patch underfoot — strike's cousin on a world. Camera cycle stays
           * on C and the scene tag, so walking is not a mode switch. */
          if (!game.inhabiting) {
            const V = RS.render.view;
            const dy = (a.startY - V.cy) / (V.R * 0.62);
            scene.lat = clamp(-Math.asin(clamp(dy, -1, 1)), -1.5, 1.5);
            RS.scenes.sampleSurface(game);
            bus.emit('scene:aim', { lat: scene.lat });
          }
          if (RS.scenes.pulse) {
            const r = RS.scenes.pulse(game, bus);
            if (r.ok) bus.emit('scene:pulse', r);
            else if (r.reason && r.reason !== 'cooling') {
              bus.emit('ui:deny', { reason: 'blocked', message: r.reason });
            }
          }
        } else {
          const hit = pickNode(game, a.startX, a.startY);
          if (handlers && handlers.onPickNode) handlers.onPickNode(hit);
        }
      }
    }

    function onCancel(e) {
      const a = active.get(e.pointerId);
      if (a && a.kind === 'dial') RS.dials.release(a.dial);
      active.delete(e.pointerId);
    }

    canvas.addEventListener('pointerdown', onDown, { passive: false });
    canvas.addEventListener('pointermove', onMove, { passive: false });
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    /* Wheel is a genuine advantage on desktop: it maps to a rotary control far
     * better than a drag does. Shift is the fine modifier. */
    canvas.addEventListener('wheel', e => {
      const p = localPoint(e);
      const reg = RS.hud.hitDial(p.x, p.y);
      if (!reg) return;
      e.preventDefault();
      const dial = game.dials[reg.id];
      const def = RS.dials.defOf(dial.id);
      const notches = -Math.sign(e.deltaY);
      let stepSize = RS.dials.tickStep(dial) * 2;
      if (e.shiftKey) stepSize /= RS.dials.fineRatio(dial) / 3;
      RS.dials.setValue(game, dial, dial.value + notches * stepSize);
      dial.vel = 0;
    }, { passive: false });

    /* Keyboard: arrows nudge the selected dial by exactly one notch, which is
     * the only input method that can be perfectly precise, and Tab cycles.
     * Useful for testing as well as for accessibility. */
    let kbIndex = 3;
    window.addEventListener('keydown', e => {
      /* Backtick toggles the gated developer cheat HUD. Do not steal f/Tab/arrows. */
      if (e.key === '`' || e.code === 'Backquote') {
        if (RS.debug && RS.debug.enabled() && RS.ui && RS.ui.toggleDebug) {
          e.preventDefault();
          RS.ui.toggleDebug(game, bus);
        }
        return;
      }
      const ids = ['time', 'space', 'phase', 'frequency'];
      if (e.key === 'Tab') { kbIndex = (kbIndex + 1) % 4; e.preventDefault(); bus.emit('dial:jump', { dial: game.dials[ids[kbIndex]] }); return; }
      if (e.key === 'c' || e.key === 'C') return;
      const dial = game.dials[ids[kbIndex]];
      let d = 0;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') d = 1;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') d = -1;
      else if (e.key === 'f') { dial.fine = !dial.fine; bus.emit('dial:fine', { dial }); return; }
      else return;
      e.preventDefault();
      const st = RS.dials.tickStep(dial) * (e.shiftKey ? 0.25 : 1);
      RS.dials.setValue(game, dial, dial.value + d * st);
      dial.vel = 0;
    });

    return {
      activeCount: () => active.size,
      selectedDial: () => ['time', 'space', 'phase', 'frequency'][kbIndex]
    };
  }

  /* Which node is under a tap. Uses the render transform so it stays correct
   * across viewport sizes. */
  function pickNode(game, px, py) {
    const V = RS.render.view;
    const x = (px - V.cx) / V.R, y = (py - V.cy) / V.R;
    let best = null, bd = 0.075;
    for (const n of game.field.nodes) {
      if (n.dying) continue;
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  /* Which world in the system view a tap landed on. Uses the same
   * radius-compression the renderer uses, so the hit region is exactly what is
   * drawn — a generous slop radius on top, because these are small targets on
   * a phone. */
  function pickBody(game, px, py) {
    const s = game.scene;
    if (!s.system) return -1;
    const positions = RS.scenes.systemPositions(game);
    let best = -1, bd = 34;
    for (const e of positions) {
      if (e.body.kind !== 'planet') continue;
      const scr = RS.worldrender.bodyScreen(s, e);
      const d = Math.hypot(px - scr.x, py - scr.y);
      if (d < bd) { bd = d; best = e.index; }
    }
    return best;
  }

  RS.input = { attach, pickNode, pickBody };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
