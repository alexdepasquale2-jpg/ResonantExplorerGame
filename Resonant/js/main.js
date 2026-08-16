/* Resonant — bootstrap and the frame loop.
 *
 * The loop separates three clocks, and the separation is load-bearing:
 *
 *   realDt   wall time. Drives feel.js (particles, shake, springs) and the
 *            renderer. Never scaled — effects must keep animating during a
 *            hitstop or the hit reads as a dropped frame instead of an impact.
 *   simDt    realDt × feel.timeScale, fed to the field in fixed steps. This is
 *            what hitstop actually freezes.
 *   fieldT   the in-world clock, which the TIME dial and the tier's own rate
 *            scale again inside field.js.
 *
 * Simulation runs on a fixed accumulator so alignment, coherence and drift are
 * frame-rate independent — a lock that fills faster on a 144 Hz display would
 * be a real bug, not a cosmetic one.
 */
(function (RS) {
  'use strict';

  const lastStroke = { node: null, i: -1 };

  const SIM_DT = 1 / 60;
  const MAX_STEPS = 5;

  let game = null, bus = null;
  let fieldCanvas = null, fieldCtx = null, hudCanvas = null, hudCtx = null;
  let acc = 0, lastT = 0, rafId = null, saveAcc = 0, fieldAcc = 0;

  function boot() {
    const overlay = document.getElementById('boot');
    const btnNew = document.getElementById('btn-new');
    const btnCont = document.getElementById('btn-continue');

    if (RS.save.hasSave()) btnCont.classList.remove('hidden');

    btnNew.addEventListener('click', () => {
      if (RS.save.hasSave() && !confirm('Start a new reality? The current one is lost.')) return;
      RS.save.wipe();
      overlay.classList.add('gone');
      start(RS.game.newGame((Math.random() * 0xffffffff) >>> 0));
    });
    btnCont.addEventListener('click', () => {
      const data = RS.save.readRaw();
      overlay.classList.add('gone');
      start(data ? RS.save.hydrate(data) : RS.game.newGame((Math.random() * 0xffffffff) >>> 0));
    });
  }

  function start(g) {
    game = g;
    bus = RS.core.makeBus();
    game.__bus = bus;
    /* Debug handle only — nothing in the game reads this. */
    window.__RESONANT__ = game;

    fieldCanvas = document.getElementById('field');
    fieldCtx = fieldCanvas.getContext('2d');
    hudCanvas = document.getElementById('hud');
    hudCtx = hudCanvas.getContext('2d');

    RS.feel.init({ reduceMotion: game.settings.reduceMotion, haptics: game.settings.haptics });
    RS.audio.setEnabled(game.settings.audio);
    RS.ui.setNotifyLevel(game.settings.notify);
    if (RS.bloom) {
      RS.bloom.setEnabled(game.settings.bloom !== false);
      /* Pay the pipeline's first-frame cost now, while nobody is looking. */
      RS.bloom.warm(fieldCtx, fieldCanvas,
        fieldCanvas.clientWidth || window.innerWidth,
        fieldCanvas.clientHeight || window.innerHeight);
    }
    RS.ui.init(game, bus);
    RS.reactions.wire(game, bus);
    RS.input.attach(hudCanvas, game, bus, {
      onPickNode(node) {
        /* A tap in the field is a strike first. Striking the node you are
         * already working is the common case and needs no aim, so an empty tap
         * still strikes the focus node — the click mechanic must not require
         * hitting a moving target with a finger. */
        const target = node || game.focusNode;
        const r = RS.strike.strike(game, bus, target);
        if (r.verdict !== 'miss' && r.verdict !== 'early') return;

        if (!node) { RS.ui.closeDrawer(); return; }
        /* Tapping a node parks the frequency dial on its signature — a
         * "point at it and I'll get you close" affordance that removes the
         * tedium of hunting without removing the skill of landing. */
        const D = game.dials.frequency;
        if (node.man.signature >= D.min && node.man.signature <= D.max && node.resolved > 0.3) {
          RS.dials.setValue(game, D, node.man.signature);
          bus.emit('dial:jump', { dial: D });
        } else {
          RS.feel.ripple(node.x, node.y, { r0: 0.02, r1: 0.14, life: 0.5, hue: node.man.hue });
        }
      },
      /* Selecting a star on the galactic map. Tapping selects; tapping the
       * already-selected star commits to travelling there, so one gesture
       * covers both without a separate confirm button. */
      onPickStar(st) {
        const already = game.galaxy.target && game.galaxy.target.key === st.key;
        const r = already ? RS.galaxy.travelTo(game, bus, st)
          : RS.galaxy.selectStar(game, bus, st);
        if (!r.ok) {
          bus.emit('ui:deny', { reason: 'blocked', message: r.reason });
        } else {
          RS.audio.seat(0.6);
          RS.feel.FX.dialSeat(st.star.cls.hue);
        }
      },
      /* Selecting a world in the system view. */
      onPickBody(index) {
        RS.scenes.selectBody(game, bus, index);
        RS.audio.seat(0.5);
        RS.feel.FX.dialSeat(285);
      },
      /* A drag across the field is a steering impulse for the inhabited body —
       * available alongside the dials, never instead of them. */
      onSteer(dx, dy) {
        if (!game.inhabiting) return;
        game.body.steerX = RS.core.clamp(game.body.steerX + dx * 2.2, -1, 1);
        game.body.steerY = RS.core.clamp(game.body.steerY + dy * 2.2, -1, 1);
      }
    });

    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { RS.save.writeNow(game); RS.audio.suspend(); }
      else { RS.audio.resume(); lastT = 0; }
    });
    window.addEventListener('pagehide', () => RS.save.writeNow(game));

    onResize();

    if (game.__offline && game.__offline.gained > 1) {
      RS.ui.toast({
        kind: 'info', icon: '◈', ms: 5000, title: 'While you were away',
        body: 'The baryonic layer kept accreting: +' + RS.core.fmt(game.__offline.gained) + ' Ψ'
      });
    }
    if (game.stats.crystals === 0) firstRunHints();

    acc = 0; lastT = 0; saveAcc = 0; fieldAcc = 0;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  /* First run. Four staggered cards used to overlap each other and the world
   * they were describing; now they arrive one at a time, well spaced, and each
   * has retired before the next appears. Deliberately shown at `major` so the
   * notification setting cannot hide the only tutorial the game has — and
   * deliberately only four, because the guide is written against live state and
   * pointing at it is worth more than any amount of text here. */
  const FIRST_RUN = [
    { at: 0, icon: '◉', hue: 205, title: 'You are a point of consciousness',
      body: 'You cannot move. You can only change what is rendered to you.' },
    { at: 6500, icon: 'φ', hue: 187, title: 'Turn the φ dial',
      body: 'Drag it in a circle. Swing wide for fine control, and listen for the beat.' },
    { at: 13000, icon: '◈', hue: 43, title: 'Hold the lock',
      body: 'Line up the arcs around yourself. Coherence fills while you hold.' },
    { at: 19500, icon: '?', hue: 200, title: 'Lost? Tap ? at any time',
      body: 'The guide describes whatever is in front of you right now.' }
  ];

  function firstRunHints() {
    for (const h of FIRST_RUN) {
      const fire = () => RS.ui.toast({
        kind: 'major', icon: h.icon, hue: h.hue, ms: 5200,
        title: h.title, body: h.body
      });
      if (h.at === 0) fire(); else setTimeout(fire, h.at);
    }
  }

  function onResize() {
    /* HUD first: the renderer centres the world in the gap above the
     * instrument cluster, so it needs the cluster's position to already be
     * current for this viewport. */
    RS.hud.computeLayout(hudCanvas);
    RS.render.resize(fieldCanvas);
  }

  function loop(tMs) {
    rafId = requestAnimationFrame(loop);
    if (!lastT) lastT = tMs;
    let realDt = (tMs - lastT) / 1000;
    lastT = tMs;
    /* Cap: returning to a backgrounded tab must not run a minute of simulation
     * in one frame. Offline progress is handled explicitly on load instead. */
    realDt = Math.min(realDt, 0.1);

    const scale = RS.feel.update(realDt);

    acc += realDt * scale;
    let steps = 0;
    while (acc >= SIM_DT && steps < MAX_STEPS) {
      RS.dials.stepAll(game, SIM_DT, (kind, payload) => bus.emit(kind, payload));
      /* The attunement field only runs in its own scene. Deriving nodes for a
       * layer nobody is looking at would be pure waste, and the solar layer
       * has its own tick. */
      if (game.scene.kind === 'field') RS.field.tick(game, bus, SIM_DT);
      RS.scenes.tick(game, bus, SIM_DT);
      RS.game.tickMeta(game, SIM_DT);
      acc -= SIM_DT;
      steps++;
    }
    if (steps === MAX_STEPS) acc = 0;
  /* Which gate stroke last fired a click, so the track ticks once per stroke
   * rather than once per frame. */

    // audio follows the dials every frame, not every sim step
    if (game.settings.audio && RS.audio.isReady()) {
      const D = game.dials.frequency;
      const focus = RS.dials.focusOf(D);
      const band = RS.spectrum.nearestBand(D.value);
      /* In an embodied scene φ is a sense channel rather than a tuning target,
       * so the beat drone drops back to a bed instead of an instrument — it
       * would be exhausting to fly to. */
      const inField = game.scene.kind === 'field';
      RS.audio.updateDrone(D.value, band,
        RS.spectrum.resonanceOf(band, D.value, focus) * (inField ? 1 : 0.22),
        RS.spectrum.isGhost(band, focus));
      /* The scope's ambient bed. Silent in a vacuum, which is both correct
       * and the reason arriving in an atmosphere lands. */
      RS.audio.updateBed(game.scene.kind,
        game.scene.planet ? game.scene.planet.pressure : 0);

      const n = inField ? game.focusNode : null;
      RS.audio.updateRamp(n ? n.coherence : 0, n ? n.man.bandIndex : band.index, n);

      /* The click track is GATE's, not a metronome's. One tick per stroke of
       * whatever you are currently holding, so the rhythm you have to play to
       * is audible before you have worked out what it is — and its pattern is
       * the essence's `branching`, which means the beat is a tell. */
      if (n && n.gateInfo && n.resolved > 0.25) {
        if (lastStroke.node !== n.id || lastStroke.i !== n.gateInfo.stroke) {
          if (lastStroke.node === n.id) {
            RS.audio.click(n.gateInfo.stroke === 0 ? 0.5 : 0.26,
              n.gateInfo.stroke === 0 ? 1.5 : 1.0);
          }
          lastStroke.node = n.id;
          lastStroke.i = n.gateInfo.stroke;
        }
      } else if (lastStroke.node) {
        lastStroke.node = null;
      }
    }

    /* Fields depend on research, gnosis and structure maturity, all of which
     * change slowly — twice a second is plenty and keeps it off the hot path. */
    fieldAcc += realDt;
    if (fieldAcc > 0.5) {
      fieldAcc = 0;
      RS.influence.recomputeFields(game);
    }

    RS.render.draw(game, fieldCanvas, fieldCtx, realDt);
    RS.hud.draw(game, hudCanvas, hudCtx, realDt);
    RS.ui.render(game);

    saveAcc += realDt * 1000;
    if (saveAcc >= RS.save.PERIODIC_MS) { saveAcc = 0; RS.save.writeNow(game); }
  }

  RS.main = { boot, start, get game() { return game; } };
  document.addEventListener('DOMContentLoaded', boot);
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
