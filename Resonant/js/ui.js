/* Resonant — DOM layer: readouts, drawers, toasts.
 *
 * Canvas draws the world and the instruments; DOM handles text, lists and
 * anything scrollable, because canvas text at arbitrary sizes on arbitrary DPRs
 * is a losing fight and native scrolling is better than any reimplementation.
 *
 * The split is strict: nothing here reads the pointer, and nothing in input.js
 * writes text. The one thing DOM *does* own that matters for feel is that
 * numeric readouts are re-rendered only when they change, and changed numbers
 * get a one-shot class that pops them — an unchanging number should be
 * absolutely still, so that a changing one draws the eye.
 */
(function (RS) {
  'use strict';
  const { fmt, clamp01, hsl } = RS.core;

  const el = Object.create(null);
  const lastText = Object.create(null);
  let drawerOpen = null;
  let debugOpen = false;
  let debugAcc = 0;

  function $(id) { return document.getElementById(id); }

  function init(game, bus) {
    for (const id of ['insight-val', 'rate-val', 'gnosis-val', 'progress-fill', 'progress-pct',
      'tier-name', 'tier-sci', 'layer-name', 'layer-rules', 'objective',
      'toasts', 'readout', 'drawer', 'drawer-body', 'drawer-title', 'drawer-tabs',
      'btn-drawer-close', 'beat-hint', 'btn-menu',
      'scene-tag', 'body-bar', 'btn-contact', 'contact-hint']) {
      el[id] = $(id);
    }

    /* Debug HUD is opt-in (localhost / ?debug=1 / localStorage). Mount once;
     * stay hidden until toggled. Never a player-facing topbar control. */
    if (RS.debug && RS.debug.enabled()) {
      let hud = $('debug-hud');
      if (!hud) {
        hud = document.createElement('div');
        hud.id = 'debug-hud';
        hud.className = 'hidden';
        document.body.appendChild(hud);
      }
      el['debug-hud'] = hud;
      hud.addEventListener('click', ev => {
        const btn = ev.target.closest('[data-dbg]');
        if (!btn) return;
        const action = btn.dataset.dbg;
        if (action === 'close') { setDebugOpen(false); return; }
        const arg = btn.dataset.dbgArg;
        const r = RS.debug.run(game, bus, action, arg);
        if (r && r.json && typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(r.json).catch(() => {});
          toast({ kind: 'info', title: 'Save JSON copied', body: r.json.length + ' chars' });
        } else if (r && !r.ok) {
          bus.emit('ui:deny', { reason: 'blocked', message: r.reason || 'debug failed' });
        }
        renderDebug(game);
      });
    }

    /* One button, one drawer, tabs inside it. There were seven topbar buttons
     * and every new panel added another; on a phone they were already competing
     * with the insight readout for the same strip. Contact is the exception and
     * stays where it is, because it is event-driven — a channel opening is
     * something that happens *to* you, and burying it behind a menu would make
     * it missable. */
    el['btn-menu'].addEventListener('click', () => toggleDrawer(game, bus, drawerOpen ? null : lastTab));
    el['btn-contact'].addEventListener('click', () => toggleDrawer(game, bus, 'contact'));
    el['btn-drawer-close'].addEventListener('click', () => closeDrawer());

    el['drawer-tabs'].addEventListener('click', ev => {
      const t = ev.target.closest('[data-tab]');
      if (t) { lastTab = t.dataset.tab; openDrawer(game, bus, t.dataset.tab); }
    });

    /* The pilot bar is rebuilt every frame, so its two controls are delegated
     * too. Both exist so that changing body — the thing you most often want to
     * do the instant a body stops working — does not require opening a drawer,
     * scrolling past research, and closing it again. */
    el['body-bar'].addEventListener('click', ev => {
      const open = ev.target.closest('[data-open]');
      if (open) { toggleDrawer(game, bus, open.dataset.open); return; }
      const emb = ev.target.closest('[data-embark]');
      if (emb) {
        const r = RS.scenes.embark(game, bus, emb.dataset.embark);
        if (!r.ok) bus.emit('ui:deny', { reason: 'blocked', message: r.reason });
      }
    });

    /* Delegated, because the drawer body is rebuilt wholesale on every open and
     * per-node listeners would leak. */
    el['drawer-body'].addEventListener('click', ev => {
      const btn = ev.target.closest('[data-buy]');
      if (btn) {
        const [dialId, kind] = btn.dataset.buy.split(':');
        const res = RS.game.tryUpgrade(game, bus, dialId, kind);
        if (!res.ok) bus.emit('ui:deny', res);
        renderDrawer(game, bus);
        return;
      }
      const cyc = ev.target.closest('[data-cycle]');
      if (cyc) {
        const k = cyc.dataset.cycle;
        const order = ['all', 'key', 'off'];
        const i = order.indexOf(game.settings[k]);
        game.settings[k] = order[(i + 1) % order.length];
        bus.emit('settings', { key: k, value: game.settings[k] });
        renderDrawer(game, bus);
        return;
      }
      const tog = ev.target.closest('[data-toggle]');
      if (tog) {
        const k = tog.dataset.toggle;
        game.settings[k] = !game.settings[k];
        bus.emit('settings', { key: k, value: game.settings[k] });
        renderDrawer(game, bus);
        return;
      }
      const strk = ev.target.closest('[data-strike]');
      if (strk) {
        const r = RS.strike.buy(game, bus, strk.dataset.strike);
        if (!r.ok) bus.emit('ui:deny', r);
        renderDrawer(game, bus);
        return;
      }
      const res = ev.target.closest('[data-research]');
      if (res) {
        const r = RS.influence.tryResearch(game, bus, res.dataset.research);
        if (!r.ok) bus.emit('ui:deny', r);
        renderDrawer(game, bus);
        return;
      }
      const emb = ev.target.closest('[data-embark]');
      if (emb) {
        const id = emb.dataset.embark;
        const r = id === '_off' ? (RS.scenes.disembark(game, bus), { ok: true })
          : RS.scenes.embark(game, bus, id);
        if (!r.ok) bus.emit('ui:deny', { reason: 'blocked', message: r.reason });
        renderDrawer(game, bus);
        return;
      }
      const st = ev.target.closest('[data-build]');
      if (st) {
        const r = RS.influence.place(game, bus, game.scene.planet, st.dataset.build);
        if (!r.ok) bus.emit('ui:deny', { reason: 'blocked', message: r.reason });
        renderDrawer(game, bus);
        return;
      }
      const con = ev.target.closest('[data-contact]');
      if (con) {
        const c = game.scene.contact;
        if (c) {
          const r = RS.contact.act(game, bus, c.planet, c.civ, con.dataset.contact);
          if (!r.ok) bus.emit('ui:deny', { reason: 'blocked', message: r.reason });
          if (r.closed) closeDrawer(); else renderDrawer(game, bus);
        }
        return;
      }
      const trav = ev.target.closest('[data-travel]');
      if (trav) {
        const st = game.galaxy.stars.find(x => x.key === trav.dataset.travel);
        const r = RS.galaxy.travelTo(game, bus, st);
        if (!r.ok) bus.emit('ui:deny', { reason: 'blocked', message: r.reason });
        renderDrawer(game, bus);
        return;
      }
      const act = ev.target.closest('[data-act]');
      if (act) {
        const kind = act.dataset.act;
        const r = kind === 'extract' ? RS.scenes.extract(game, bus) : RS.scenes.sell(game, bus);
        if (!r.ok) bus.emit('ui:deny', { reason: 'blocked', message: r.reason });
        renderDrawer(game, bus);
      }
    });
  }

  // --- text helpers --------------------------------------------------------

  /* Only touch the DOM when the string actually changed, and flag the change
   * so CSS can pop it. */
  function setText(id, text, popClass) {
    const node = el[id];
    if (!node || lastText[id] === text) return false;
    lastText[id] = text;
    node.textContent = text;
    if (popClass) {
      node.classList.remove(popClass);
      /* Force reflow so re-adding the class restarts the animation. */
      void node.offsetWidth;
      node.classList.add(popClass);
    }
    return true;
  }

  // --- per-frame -----------------------------------------------------------

  function setDebugOpen(on) {
    debugOpen = !!on;
    const hud = el['debug-hud'];
    if (!hud) return;
    hud.classList.toggle('hidden', !debugOpen);
  }

  function toggleDebug(game, bus) {
    if (!RS.debug || !RS.debug.enabled() || !el['debug-hud']) return false;
    setDebugOpen(!debugOpen);
    if (debugOpen) renderDebug(game);
    return true;
  }

  function renderDebug(game) {
    const hud = el['debug-hud'];
    if (!hud || !debugOpen || !RS.debug) return;
    hud.innerHTML = RS.debug.panelHTML(game);
  }

  function render(game) {
    setText('insight-val', fmt(game.insight), 'pop');
    setText('rate-val', '+' + fmt(game.passiveRate) + '/s');
    setText('gnosis-val', String(RS.fractal.totalGnosis(game)));

    /* Refresh the debug status strip cheaply; full rebuild only when open. */
    if (debugOpen) {
      debugAcc++;
      if (debugAcc % 15 === 0) renderDebug(game);
    }

    const p = RS.game.progress(game);
    el['progress-fill'].style.width = (p * 100).toFixed(2) + '%';
    setText('progress-pct', (p * 100).toFixed(1) + '%');

    const D = game.dials;
    const tier = RS.cosmos.tierAt(D.space.value);
    setText('tier-name', tier.name.toUpperCase());
    setText('tier-sci', game.settings.showSci
      ? tier.sci
      : (tier.logM == null ? 'Tegmark Level ' + tier.level : RS.core.fmtMetres(tier.logM)));

    /* The second context line describes whatever is actually in front of the
     * player. Showing the reality layer's rules while looking at a star map
     * was simply false information in the most prominent text slot on screen. */
    const focus = RS.dials.focusOf(D.frequency);
    const band = RS.spectrum.BANDS[game.field.bandIndex];
    const ghost = RS.spectrum.isGhost(band, focus);
    const sc = game.scene;

    if (sc.kind === 'galaxy') {
      const inReach = game.galaxy.stars.filter(x => x.inReach).length;
      const reachLy = (RS.influence.reachRadius(game) * RS.galaxy.LY_PER_SECTOR).toFixed(0);
      setText('layer-name', 'SECTOR ' + game.galaxy.sx + ', ' + game.galaxy.sy);
      setText('layer-rules', game.galaxy.stars.length + ' stars in view · ' + inReach +
        ' within your ' + reachLy + ' ly field · green ring = life, amber = inhabited');
      el['layer-name'].style.color = hsl(190, 0.75, 0.72);
    } else if (sc.kind === 'system' && sc.system) {
      const st = sc.system.primary;
      setText('layer-name', sc.system.name.toUpperCase());
      setText('layer-rules', st.cls.c + st.sub + ' ' + st.cls.name + ' · ' +
        sc.system.bodies.filter(b => b.kind === 'planet').length + ' planets · habitable zone ' +
        sc.system.hz.inner.toFixed(2) + '–' + sc.system.hz.outer.toFixed(2) + ' AU');
      el['layer-name'].style.color = hsl(st.cls.hue, 0.8, 0.72);
    } else if (sc.kind === 'web') {
      const r = RS.web.readout(game);
      setText('layer-name', r.title.toUpperCase());
      setText('layer-rules', r.tGyr.toFixed(2) + ' Gyr · ' + r.formed + '/' +
        RS.web.NODE_COUNT + ' collapsed · largest void ' + r.voidGpc.toFixed(3) + ' Gpc' +
        (r.disconnected ? ' · ' + r.disconnected + ' beyond the horizon' : '') +
        (r.assembling > 0.25 ? ' · ASSEMBLING ×' + r.bonus.toFixed(2) : ''));
      el['layer-name'].style.color = hsl(276, 0.7, 0.72);
    } else if (sc.kind === 'ensemble') {
      const r = RS.ensemble.readout(game);
      setText('layer-name', r.title.toUpperCase());
      setText('layer-rules', r.rows
        ? r.sub + ' · ' + Math.round(r.distance * 100) + '% unlike ours · ×' + r.bonus.toFixed(2)
        : r.sub);
      el['layer-name'].style.color = hsl(r.rows ? 186 + r.distance * 120 : 210, 0.7, 0.72);
    } else if (sc.kind === 'foam') {
      const r = RS.foam.readout(game);
      setText('layer-name', 'QUANTUM FOAM');
      setText('layer-rules', r.sub + ' · mean lifetime ' + r.meanLife.toFixed(2) + ' s' +
        (r.survivors ? ' · ' + r.survivors + ' never cancelled ×' + r.bonus.toFixed(2) : ''));
      el['layer-name'].style.color = hsl(291, 0.7, 0.72);
    } else if (sc.kind === 'molecular') {
      const r = RS.molecular.readout(game);
      setText('layer-name', r.title.toUpperCase());
      setText('layer-rules', r.sub + ' · ' + r.chiral + ' chiral sites' +
        (r.anomalous ? ' · ' + r.anomalous + ' of the wrong hand ×' + r.bonus.toFixed(2) : ''));
      el['layer-name'].style.color = hsl(r.bias > 0.5 ? 150 : 196, 0.7, 0.72);
    } else if (sc.kind === 'shells') {
      const r = RS.shells.readout(game);
      setText('layer-name', 'ORBITAL SHELLS');
      setText('layer-rules', r.occupied + '/' + r.capacity + ' states filled · ' +
        r.displaced + ' displaced outward · ' + r.degenerate + ' degenerate' +
        (r.bonus > 1.05 ? ' ×' + r.bonus.toFixed(2) : ''));
      el['layer-name'].style.color = hsl(210, 0.7, 0.72);
    } else if (sc.kind === 'cellular') {
      const r = RS.cellular.readout(game);
      setText('layer-name', r.title.toUpperCase());
      setText('layer-rules', r.sterile ? r.sub
        : (r.sub + ' · ' + r.organelles + ' organelles · inside ' + r.host +
           (r.expression > 0.005 ? ' · expression ' + Math.round(r.expression * 100) + '%' : '')));
      el['layer-name'].style.color = hsl(150, 0.7, 0.72);
    } else if (sc.kind === 'planet' && sc.planet) {
      const p = sc.planet;
      const when = RS.localtime.describe(sc.clock);
      setText('layer-name', p.name.toUpperCase() + (when ? ' · ' + sc.clock.sun.phase.toUpperCase() : ''));
      setText('layer-rules', p.type.name + ' · ' + Math.round(p.surfaceTemp) + ' K · ' +
        p.gravity.toFixed(2) + ' g · ' +
        (p.pressure < 0.01 ? 'no atmosphere' : p.pressure.toFixed(2) + ' bar') +
        (p.biosphere ? ' · ' + p.biosphere.stage.name : ''));
      el['layer-name'].style.color = hsl(p.type.hue, 0.75, 0.72);
    } else {
      setText('layer-name', band.name.toUpperCase() + (ghost ? ' · GHOST' : ''));
      setText('layer-rules', ghost
        ? 'Beyond your focus. Visible, not holdable. Buy φ FOCUS to make it cohere.'
        : band.rules);
      el['layer-name'].style.color = hsl(band.hue, ghost ? 0.15 : band.sat, 0.72);
    }

    const obj = RS.game.sceneObjective(game);
    setText('objective', obj.text);

    /* Scene tag: which of the three worlds the player is in, and — critically —
     * which mode the dials are in, because that is the one thing they must
     * never be wrong about. */
    const s = game.scene;
    const modeLabel = game.inhabiting ? 'PILOTING' : 'OBSERVING';
    setText('scene-tag', s.kind.toUpperCase() + ' · ' + modeLabel);
    el['scene-tag'].style.color = game.inhabiting ? '#fca5a5' : '#7dd3fc';

    renderBodyBar(game);
    renderContactHint(game);
    renderReadout(game);
    renderBeatHint(game);
  }

  /* A civilisation in earshot is the rarest thing in the game, so it gets a
   * permanent, unmissable line of its own the moment one is detectable —
   * finding one and not realising it would be the worst failure this game
   * could have. */
  function renderContactHint(game) {
    const c = game.scene.contact;
    const btn = el['btn-contact'];
    const hint = el['contact-hint'];
    if (!c) {
      if (btn.dataset.on !== '0') { btn.dataset.on = '0'; btn.classList.remove('live'); }
      hint.style.opacity = '0';
      return;
    }
    btn.dataset.on = '1';
    btn.classList.add('live');
    const state = RS.contact.stateOf(game, c.planet, c.civ, c.lock);
    const open = state === RS.contact.STATES.open || state === RS.contact.STATES.warm;
    btn.style.color = hsl(state.hue, 0.85, 0.7);
    hint.style.opacity = '1';
    hint.style.color = hsl(state.hue, 0.85, 0.72);
    setText('contact-hint', open
      ? '◉ ' + c.civ.name + ' — channel open'
      : '◉ ' + c.civ.name + ' — carrier at φ' + c.lock.carrier.phi.toFixed(1) +
        ' (' + (c.lock.total * 100).toFixed(0) + '% lock)');
  }

  /* ── The pilot bar ───────────────────────────────────────────────────────
   *
   * Visible only while embodied, and it answers the four questions a pilot
   * actually has, in the order they matter:
   *
   *   what am I flying          glyph and name
   *   what do the dials do      the archetype's own dialMap, live
   *   how long have I got       charge, and endurance in seconds at this draw
   *   is anything wrong         strain, and the blocked reason plus the fix
   *
   * The dial map is the important addition. Every body reinterprets the same
   * four controls, which is the whole ergonomic idea — and until now the only
   * place that mapping appeared was a drawer you had to close to fly.
   */
  function renderBodyBar(game) {
    const bar = el['body-bar'];
    const st = RS.vessel.statusOf(game);
    if (!st) {
      if (bar.dataset.on !== '0') { bar.dataset.on = '0'; bar.innerHTML = ''; bar.style.opacity = '0'; }
      return;
    }
    bar.dataset.on = '1';
    bar.style.opacity = '1';

    const a = st.arch, dm = a.dialMap;
    const chargeHue = st.chargeFrac > 0.25 ? 160 : 0;
    /* Endurance is the number that says whether to turn back, so it is stated
     * in seconds rather than as a bar the player has to integrate by eye. */
    const end = st.endurance === Infinity ? '∞'
      : st.endurance > 90 ? Math.round(st.endurance / 60) + 'm'
        : Math.round(st.endurance) + 's';

    const dial = (sym, hue, what) =>
      '<span class="bb-dial" style="--h:' + hue + '"><b>' + sym + '</b>' + what + '</span>';

    bar.innerHTML =
      '<button class="bb-head" data-open="vessels" title="Change body">' +
        '<span class="bb-glyph" style="color:' + hsl(a.hue, 0.8, 0.7) + '">' + a.glyph + '</span>' +
        '<span class="bb-name">' + a.name + '</span>' +
      '</button>' +
      '<span class="bb-meter" title="charge ' + Math.round(st.charge) + '/' + st.capacity + '">' +
        '<b style="width:' + (st.chargeFrac * 100).toFixed(0) + '%;background:' +
        hsl(chargeHue, 0.85, 0.6) + '"></b></span>' +
      '<span class="bb-tag" title="endurance at this draw">' + end + '</span>' +
      (st.strain > 0.12
        ? '<span class="bb-tag" style="color:' + hsl(st.strain > 0.7 ? 8 : 40, 0.8, 0.66) +
          '" title="wear — change body before this reaches 100%">strain ' +
          Math.round(st.strain * 100) + '%</span>' : '') +
      (st.holdMass > 0 ? '<span class="bb-tag">' + fmt(st.holdMass) + 'u</span>' : '') +
      (st.possession != null ? '<span class="bb-tag" style="color:#f0abfc" ' +
        'title="how much of this mind is you">' + (st.possession * 100).toFixed(0) + '% you</span>' : '') +
      '<span class="bb-dials">' +
        dial('τ', 43, dm.time) + dial('Σ', 338, dm.space) +
        dial('Δ', 268, dm.phase) + dial('φ', 187, dm.frequency) +
      '</span>' +
      (st.blocked
        ? '<span class="bb-warn">' + st.blocked +
          (st.alternative
            ? ' — <button class="bb-fix" data-embark="' + st.alternative.id + '">take ' +
              st.alternative.name + '</button>'
            : ' — no body you have works here') + '</span>'
        : '');
  }

  /* The node readout. Names the thing, names its essence, and — the part that
   * matters — says which dial is wrong and in which direction. A four-axis
   * lock is only fair if the player can diagnose a miss. */
  function renderReadout(game) {
    const node = el['readout'];

    /* The node readout belongs to the attunement field. In an embodied scene
     * the same slot shows what is under the player instead — same position,
     * same role, different world. */
    if (game.scene.kind !== 'field') {
      renderSceneReadout(game, node);
      return;
    }

    const n = game.focusNode;
    if (!n || n.align < 0.04) {
      if (node.dataset.empty !== '1') {
        node.dataset.empty = '1';
        node.innerHTML = '<div class="ro-empty">Sweep φ to resolve something.</div>';
      }
      return;
    }
    node.dataset.empty = '0';
    const man = n.man;
    const p = n.alignParts;
    const resolved = n.resolved > 0.45;
    const gn = RS.fractal.gnosisOf(game, man.essence.id);

    const axes = [
      { k: 'φ', v: p.f, d: p.dem.freq, err: p.fd, hue: 187 },
      { k: 'Σ', v: p.s, d: p.dem.tier, err: p.sd, hue: 338 },
      { k: 'Δ', v: p.p, d: p.dem.phase, err: p.pd, hue: 268 },
      { k: 'τ', v: p.r, d: p.dem.rate, err: p.rd, hue: 43 }
    ];
    let bars = '';
    for (const a of axes) {
      if (a.d <= 0.02) {
        bars += '<span class="ax off" title="not demanded by this layer">' + a.k + '</span>';
        continue;
      }
      const good = a.v > 0.86;
      /* An arrow is worth more than a percentage: it says what to *do*. */
      const dir = Math.abs(a.err) < 0.25 ? '·' : (a.err > 0 ? '↓' : '↑');
      bars += '<span class="ax' + (good ? ' good' : '') + '" style="--h:' + a.hue + '">' +
        a.k + '<b style="width:' + (clamp01(a.v) * 100).toFixed(0) + '%"></b><i>' + dir + '</i></span>';
    }

    const title = resolved ? man.name : 'Unresolved';
    const sub = resolved
      ? man.essence.name + (gn ? ' · gnosis ' + gn : '') + (man.rarity ? ' · ' + '★'.repeat(man.rarity) : '')
      : 'Hold closer to resolve';
    const blocked = n.blocked && n.antecedent
      ? '<div class="ro-block">Blocked — requires ' + n.antecedent.name + ' crystallised first' +
        (n.orderNeed > 1 ? ' <small>(' + n.orderMet + '/' + n.orderNeed + ' antecedents held)</small>' : '') +
        '</div>'
      : (n.orderNeed > 1 && n.orderMet < n.orderNeed
        ? '<div class="ro-block ok">' + n.orderMet + '/' + n.orderNeed + ' antecedents held · ×' +
          n.orderBonus.toFixed(2) + '</div>' : '');

    node.innerHTML =
      '<div class="ro-head"><span class="ro-glyph" style="color:' + hsl(man.hue, 0.8, 0.7) + '">' +
        (resolved ? man.glyph : '?') + '</span>' +
      '<span class="ro-title">' + title + '</span></div>' +
      '<div class="ro-sub">' + sub + '</div>' +
      '<div class="ro-axes">' + bars + '</div>' + blocked;
  }

  /* What is under the player right now, in the embodied scenes. */
  function renderSceneReadout(game, node) {
    const s = game.scene;
    node.dataset.empty = '0';
    if (s.kind === 'galaxy') { renderGalaxyReadout(game, node); return; }
    if (s.kind === 'system' && s.system) {
      const p = s.planet;
      const prim = s.system.primary;
      node.innerHTML =
        '<div class="ro-head"><span class="ro-glyph" style="color:' + hsl(prim.cls.hue, 0.8, 0.7) + '">&#9673;</span>' +
        '<span class="ro-title">' + s.system.name + '</span></div>' +
        '<div class="ro-sub">' + prim.cls.c + prim.sub + ' ' + prim.cls.name + ' &middot; ' +
        s.system.bodies.length + ' bodies &middot; epoch ' + (s.t >= 0 ? '+' : '') + fmt(s.t) + ' yr</div>' +
        (p ? '<div class="ro-sub" style="margin-top:4px;color:' + hsl(p.type.hue, 0.7, 0.68) + '">' +
          p.name + ' &mdash; ' + p.type.name +
          (p.biosphere ? ' &middot; ' + p.biosphere.stage.name : '') +
          (p.civ ? ' &middot; ' + p.civ.tier.name : '') + '</div>' : '');
      return;
    }
    if (s.kind === 'web') {
      const r = RS.web.readout(game);
      node.innerHTML =
        '<div class="ro-head"><span class="ro-glyph" style="color:' + hsl(276, 0.8, 0.72) + '">&#8259;</span>' +
        '<span class="ro-title">' + r.title + '</span></div>' +
        '<div class="ro-sub">' + r.sub + '</div>' +
        '<div class="ro-sub" style="margin-top:4px">t = ' + r.tGyr.toFixed(2) +
        ' Gyr &middot; ' + r.formed + ' collapsed &middot; void ' + r.voidGpc.toFixed(3) + ' Gpc</div>' +
        (r.assembling > 0.25
          ? '<div class="ro-sub" style="color:' + hsl(46, 0.8, 0.66) + '">assembling now &mdash; &times;' +
            r.bonus.toFixed(2) + ' while it lasts</div>' : '') +
        (r.disconnected
          ? '<div class="ro-sub" style="color:' + hsl(200, 0.6, 0.68) + '">' + r.disconnected +
            ' structures past the horizon &mdash; no signal has ever crossed</div>' : '');
      return;
    }
    if (s.kind === 'ensemble') {
      const r = RS.ensemble.readout(game);
      if (!r.rows) {
        node.innerHTML =
          '<div class="ro-head"><span class="ro-glyph" style="color:' + hsl(210, 0.6, 0.72) + '">&#8757;</span>' +
          '<span class="ro-title">' + r.title + '</span></div>' +
          '<div class="ro-sub">' + r.sub + '</div>';
        return;
      }
      /* Every axis, against ours. This is the scope's whole content, and it has
       * to be a comparison rather than a list of numbers — "×1.7 of ours" says
       * something; "9812 K" says nothing without the other column. */
      const rows = r.rows.map(x =>
        '<div class="ro-sub" style="display:flex;gap:6px">' +
        '<b style="min-width:112px;font-weight:400;opacity:.7">' + x.name + '</b>' +
        '<span style="color:' + hsl(x.mult > 1 ? 36 : 190, 0.7, 0.7) + '">&times;' +
        x.mult.toFixed(2) + '</span>' +
        '<span style="opacity:.65">' + x.says + '</span></div>').join('');
      const sp = r.specimen;
      node.innerHTML =
        '<div class="ro-head"><span class="ro-glyph" style="color:' +
          hsl(186 + r.distance * 120, 0.8, 0.72) + '">&#8757;</span>' +
        '<span class="ro-title">' + r.title + '</span></div>' +
        '<div class="ro-sub">Level ' + r.level + ' &middot; ' + r.sub + '</div>' +
        rows +
        (sp && sp.ours && sp.there
          ? '<div class="ro-sub" style="margin-top:5px;opacity:.8">' + sp.ours.name +
            ', derived twice: ' + Math.round(sp.ours.temp) + ' K / ' + sp.ours.living +
            ' alive here &mdash; ' + Math.round(sp.there.temp) + ' K / ' + sp.there.living +
            ' alive there</div>' : '');
      return;
    }
    if (s.kind === 'foam') {
      const r = RS.foam.readout(game);
      node.innerHTML =
        '<div class="ro-head"><span class="ro-glyph" style="color:' + hsl(291, 0.8, 0.72) + '">&#8756;</span>' +
        '<span class="ro-title">Quantum Foam</span></div>' +
        '<div class="ro-sub">' + r.sub + '</div>' +
        '<div class="ro-sub" style="margin-top:4px">mean lifetime ' + r.meanLife.toFixed(2) +
        ' s &mdash; slow &tau; down or nothing will hold still</div>' +
        (r.survivors
          ? '<div class="ro-sub" style="color:' + hsl(46, 0.85, 0.68) + '">' + r.survivors +
            ' fluctuation' + (r.survivors > 1 ? 's' : '') + ' never cancelled &mdash; &times;' +
            r.bonus.toFixed(2) + '</div>' : '');
      return;
    }
    if (s.kind === 'molecular') {
      const r = RS.molecular.readout(game);
      node.innerHTML =
        '<div class="ro-head"><span class="ro-glyph" style="color:' +
          hsl(r.bias > 0.5 ? 150 : 196, 0.8, 0.72) + '">&#9901;</span>' +
        '<span class="ro-title">' + r.title + '</span></div>' +
        '<div class="ro-sub">' + r.sub + '</div>' +
        (r.host ? '<div class="ro-sub" style="margin-top:4px">' + r.host + ' &middot; ' +
          r.chiral + ' of ' + RS.molecular.SITE_COUNT + ' sites are chiral</div>' : '') +
        (r.anomalous
          ? '<div class="ro-sub" style="color:' + hsl(24, 0.85, 0.68) + '">' + r.anomalous +
            ' of the hand life here does not use &mdash; &times;' + r.bonus.toFixed(2) + '</div>' : '');
      return;
    }
    if (s.kind === 'shells') {
      const r = RS.shells.readout(game);
      node.innerHTML =
        '<div class="ro-head"><span class="ro-glyph" style="color:' + hsl(210, 0.8, 0.72) + '">&#9096;</span>' +
        '<span class="ro-title">Orbital Shells</span></div>' +
        '<div class="ro-sub">' + r.sub + '</div>' +
        '<div class="ro-sub" style="margin-top:4px">' + r.occupied + '/' + r.capacity +
        ' states filled</div>' +
        (r.displaced ? '<div class="ro-sub" style="color:' + hsl(46, 0.8, 0.68) + '">' +
          r.displaced + ' pushed outward &mdash; excited, and about to fall back</div>' : '') +
        (r.degenerate ? '<div class="ro-sub" style="color:' + hsl(150, 0.7, 0.66) + '">' +
          r.degenerate + ' degenerate &mdash; same energy, different state. This is where chemistry comes from.</div>' : '');
      return;
    }
    if (s.kind === 'cellular') {
      const r = RS.cellular.readout(game);
      const c = s.cell;
      node.innerHTML =
        '<div class="ro-head"><span class="ro-glyph" style="color:' + hsl(150, 0.8, 0.7) + '">&#10059;</span>' +
        '<span class="ro-title">' + r.title + '</span></div>' +
        '<div class="ro-sub">' + r.sub + '</div>' +
        (c ? '<div class="ro-sub" style="margin-top:4px">' +
          /* Naming the organelles is the point: these are the same essences the
           * player has met at every other scale, wearing their cellular names. */
          c.organelles.slice(0, 4).map(o => o.form).join(' &middot; ') +
          (c.organelles.length > 4 ? ' &middot; +' + (c.organelles.length - 4) : '') + '</div>' : '') +
        (r.expression > 0.005
          ? '<div class="ro-sub" style="margin-top:4px;color:' + hsl(140, 0.7, 0.66) + '">' +
            'expression ' + Math.round(r.expression * 100) + '% &mdash; ' + r.host +
            ' is measurably more complex than its baseline</div>' : '');
      return;
    }
    if (s.kind === 'planet' && s.planet) {
      const p = s.planet;
      const su = s.surface;
      /* Where in the day, the year, and the tide. All of it was already
       * derived and none of it was ever shown. */
      const when = RS.localtime.describe(s.clock);
      node.innerHTML =
        '<div class="ro-head"><span class="ro-glyph" style="color:' + hsl(p.type.hue, 0.8, 0.7) + '">&#9679;</span>' +
        '<span class="ro-title">' + p.name + '</span></div>' +
        '<div class="ro-sub">' + p.type.name + ' &middot; ' + p.gravity.toFixed(2) + ' g &middot; ' +
        (p.pressure < 0.01 ? 'no air' : p.pressure.toFixed(2) + ' bar') + '</div>' +
        (su ? '<div class="ro-sub" style="margin-top:4px;color:' + hsl(su.biome.hue, 0.6, 0.7) + '">' +
          su.biome.name + ' &middot; ' + Math.round(su.T) + ' K &middot; lat ' +
          (su.lat * 57.3).toFixed(0) + '&deg;</div>' : '') +
        (when ? '<div class="ro-sub" style="margin-top:4px;color:' +
          hsl(s.clock.sun.daylight > 0.5 ? 45 : 220, 0.55, 0.68) + '">' + when + '</div>' : '') +
        (s.agents.length ? '<div class="ro-sub" style="margin-top:4px">' + s.agents.length +
          ' minds nearby</div>' : '');
      return;
    }
    node.innerHTML = '<div class="ro-empty">Nowhere in particular.</div>';
  }

  /* A one-line hint that teaches the beat-tuning mechanic without a tutorial
   * box, shown only while the player is close enough for the beat to be
   * audible and slow enough to notice. */
  function renderBeatHint(game) {
    const D = game.dials.frequency;
    const band = RS.spectrum.nearestBand(D.value);
    const err = Math.abs(D.value - band.centre);
    const hz = err * RS.audio.BEAT_SCALE;
    const show = err < band.width * 2.2 && err > 0.02;
    el['beat-hint'].style.opacity = show ? '1' : '0';
    if (show) setText('beat-hint', 'beat ' + hz.toFixed(2) + ' Hz — slow it to zero');
  }

  // --- toasts --------------------------------------------------------------

  /* ── Notifications ────────────────────────────────────────────────────────
   *
   * These used to be centred, three deep, and long-lived, which meant that
   * during the parts of the game that generate the most events — arriving
   * somewhere, a run of discoveries — a wall of cards sat directly over the
   * thing the cards were about. A notification that hides the world it is
   * describing is worse than no notification.
   *
   * Four changes, in order of how much they matter:
   *
   *   1. They live in the top-right corner, out of the world entirely.
   *   2. There are at most two, and a third replaces the oldest immediately
   *      rather than queueing behind it.
   *   3. Repeats coalesce. Sweeping Δ across the ensemble used to fire one
   *      card per universe; now the card updates in place and shows a count.
   *   4. Chatter is filtered by a setting, and the default is to show only
   *      what a player would want interrupting them.
   *
   * Nothing here is load-bearing: every notification restates something that
   * is also visible in the readout, the objective line or the guide. That is
   * the property that makes filtering them safe.
   */
  const PRIORITY = { warn: 3, major: 3, gnosis: 2, buy: 1, info: 1, seat: 0 };
  /* 'all' shows everything; 'key' drops routine chatter and dial seating;
   * 'off' shows nothing but warnings, because a warning is the one kind that
   * exists to stop you wasting your time. */
  const LEVELS = { all: 0, key: 1, off: 3 };
  let notifyLevel = 'key';

  const MAX_TOASTS = 2;
  /* title → { node, at, n, timer } — one entry per distinct message, so a
   * repeat updates rather than stacks. */
  const liveToasts = new Map();

  function setNotifyLevel(v) { notifyLevel = LEVELS[v] != null ? v : 'key'; }

  function toast(opts) {
    const kind = opts.kind || 'info';
    if ((PRIORITY[kind] != null ? PRIORITY[kind] : 1) < LEVELS[notifyLevel]) return;

    const key = opts.title;
    const existing = liveToasts.get(key);
    if (existing) {
      /* Coalesce. The card stays where it is and gains a count, so a burst
       * reads as "this happened four times" rather than as four cards. */
      existing.n++;
      const c = existing.node.querySelector('u');
      if (c) c.textContent = '×' + existing.n;
      else existing.node.querySelector('b').insertAdjacentHTML('beforeend',
        ' <u style="font-style:normal;text-decoration:none;opacity:.55">×' + existing.n + '</u>');
      clearTimeout(existing.timer);
      existing.timer = setTimeout(() => retire(key), opts.ms || 3000);
      return;
    }

    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    if (opts.hue != null) t.style.setProperty('--h', opts.hue);
    /* Only the loudest kinds get a second line. Everything else is a title,
     * because a title is readable at a glance and a paragraph is not. */
    const wantBody = opts.body && (PRIORITY[kind] >= 2);
    t.innerHTML = '<i>' + (opts.icon || '◈') + '</i><span><b>' + opts.title + '</b>' +
      (wantBody ? '<em>' + opts.body + '</em>' : '') + '</span>';
    el['toasts'].appendChild(t);

    const rec = { node: t, n: 1, timer: null };
    liveToasts.set(key, rec);
    /* Retire the oldest immediately rather than letting a burst queue up —
     * a card the player never had time to read is just flicker. */
    while (liveToasts.size > MAX_TOASTS) retire(liveToasts.keys().next().value);
    rec.timer = setTimeout(() => retire(key), opts.ms || 3000);
  }

  function retire(key) {
    const rec = liveToasts.get(key);
    if (!rec) return;
    liveToasts.delete(key);
    clearTimeout(rec.timer);
    rec.node.classList.add('out');
    setTimeout(() => rec.node.remove(), 380);
  }

  // --- drawers -------------------------------------------------------------

  /* ── The panels ───────────────────────────────────────────────────────────
   *
   * Ordered as a player needs them: what is in front of me, what am I flying,
   * what do I know, where am I going, how does this work, and settings. `when`
   * decides whether a tab is worth showing at all — the World tab is
   * meaningless in the attunement field and its absence is information.
   */
  const TABS = [
    { id: 'world', label: 'World', glyph: '🜨',
      when: g => g.scene.kind !== 'field' && g.scene.kind !== 'ensemble' },
    { id: 'vessels', label: 'Bodies', glyph: '⋀', when: () => true },
    { id: 'upgrades', label: 'Dials', glyph: '⚙', when: () => true },
    { id: 'codex', label: 'Codex', glyph: '◇', when: () => true },
    { id: 'paths', label: 'Paths', glyph: '◈', when: () => true },
    { id: 'guide', label: 'Guide', glyph: '?', when: () => true },
    { id: 'settings', label: 'Settings', glyph: '⋯', when: () => true }
  ];
  /* Reopening the drawer returns you to the panel you were last in, because a
   * drawer that always opens on the same tab is a drawer you have to navigate
   * every single time. */
  let lastTab = 'upgrades';

  function openDrawer(game, bus, which) {
    drawerOpen = which;
    if (which && which !== 'contact') lastTab = which;
    el['drawer'].classList.add('open');
    renderTabs(game);
    renderDrawer(game, bus);
  }

  function toggleDrawer(game, bus, which) {
    if (!which || drawerOpen === which) { closeDrawer(); return; }
    openDrawer(game, bus, which);
  }

  function renderTabs(game) {
    const nav = el['drawer-tabs'];
    if (!nav) return;
    let h = '';
    for (const t of TABS) {
      if (!t.when(game)) continue;
      h += '<button data-tab="' + t.id + '"' + (drawerOpen === t.id ? ' class="on"' : '') +
        '><span>' + t.glyph + '</span>' + t.label + '</button>';
    }
    /* Contact only appears as a tab once there is a channel — otherwise it is
     * a door to an empty room. */
    if (game.scene.contact) {
      h += '<button data-tab="contact"' + (drawerOpen === 'contact' ? ' class="on"' : '') +
        '><span>◉</span>Contact</button>';
    }
    nav.innerHTML = h;
  }

  function closeDrawer() {
    drawerOpen = null;
    el['drawer'].classList.remove('open');
  }

  function renderDrawer(game, bus) {
    if (!drawerOpen) return;
    /* The tab row is part of the drawer, so an action that rebuilds the body —
     * buying an upgrade, taking a body — must not leave the tabs showing a
     * stale selection or a scope-conditional tab that no longer applies. */
    renderTabs(game);
    const titles = { upgrades: 'DIALS', codex: 'CODEX', settings: 'SETTINGS',
      world: 'WORLD', vessels: 'BODIES & RESEARCH', contact: 'CONTACT',
      guide: 'HOW THIS WORKS', paths: 'PATHWAYS' };
    el['drawer-title'].textContent = titles[drawerOpen] || '';
    el['drawer-body'].innerHTML =
      drawerOpen === 'upgrades' ? upgradesHTML(game)
        : drawerOpen === 'codex' ? codexHTML(game)
          : drawerOpen === 'world' ? worldHTML(game)
            : drawerOpen === 'vessels' ? vesselsHTML(game)
              : drawerOpen === 'contact' ? contactHTML(game, bus)
                : drawerOpen === 'guide' ? RS.guide.guideHTML(game)
                  : drawerOpen === 'paths' ? RS.guide.pathwaysHTML(game)
                    : settingsHTML(game);
  }

  const KIND_BLURB = {
    range: 'Extends how far the dial physically reaches.',
    precision: 'Shrinks the smallest step you can make.',
    focus: 'Narrows your carrier — makes layers cohere and locks hold.'
  };

  function upgradesHTML(game) {
    /* ── Strike upgrades ─────────────────────────────────────────────────
     *
     * A second economy alongside the dials, and deliberately a small one: the
     * dials are what let you reach and hold a layer at all, and these only make
     * the holding faster. Listed first anyway, because they are the ones a new
     * player can afford. */
    const st = game.strike;
    let sh = '<section class="up-dial" style="--h:320">' +
      '<header><span class="sym">✦</span><h3>Striking</h3></header>' +
      '<p class="blurb">Tap the field while a lock is tight to push it. Time it inside a ' +
      'layer\u2019s open window and the combo climbs \u2014 logarithmically, so it is always ' +
      'worth more and never runs away.</p>' +
      '<div class="stats">' +
      '<div>Combo <b>' + (st ? st.combo : 0) + '</b></div>' +
      '<div>Best <b>' + (st ? st.best : 0) + '</b></div>' +
      '<div>Now paying <b>' + RS.strike.multiplier(game).toFixed(2) + '&times;</b></div>' +
      '<div>Clean <b>' + (st && st.strikes ? Math.round(st.cleans / st.strikes * 100) : 0) + '%</b></div>' +
      '</div><div class="up-rows">';
    for (const u of RS.strike.UPGRADES) {
      const lv = RS.strike.levelOf(game, u.id);
      const cost = RS.strike.costOf(game, u.id);
      const maxed = !Number.isFinite(cost);
      const afford = game.insight >= cost;
      sh += '<button class="up-row" data-strike="' + u.id + '"' +
        (maxed || !afford ? ' disabled' : '') + ' style="--h:' + u.hue + '">' +
        '<span class="k">' + u.glyph + ' ' + u.name.toUpperCase() + '</span>' +
        '<span class="lv">' + lv + '/' + u.max + '</span>' +
        '<span class="d">' + u.blurb + '<br><i style="opacity:.6">' + u.format(lv) +
        (maxed ? '' : ' &rarr; ' + u.format(lv + 1)) + '</i></span>' +
        '<span class="c">' + (maxed ? 'MAX' : fmt(cost)) + '</span></button>';
    }
    sh += '</div></section>';

    let h = sh;
    for (const def of RS.dials.DEFS) {
      const d = game.dials[def.id];
      h += '<section class="up-dial" style="--h:' + def.hue + '">' +
        '<header><span class="sym">' + def.symbol + '</span><h3>' + def.name + '</h3>' +
        '<span class="reach">' + reachLabel(def, d) + '</span></header>' +
        '<p class="blurb">' + def.blurb + '</p><div class="up-rows">';
      for (const kind of ['range', 'precision', 'focus']) {
        const can = RS.dials.canUpgrade(d, kind);
        const cost = RS.dials.costOf(d, kind);
        const afford = game.insight >= cost;
        const lvl = d.levels[kind];
        if (!can && kind === 'range' && def.rangeStep === 0) {
          h += '<div class="up-row na"><span class="k">RANGE</span><span class="v">n/a — already a closed circle</span></div>';
          continue;
        }
        h += '<button class="up-row" data-buy="' + def.id + ':' + kind + '"' +
          (can && afford ? '' : ' disabled') + '>' +
          '<span class="k">' + kind.toUpperCase() + '</span>' +
          '<span class="lv">' + RS.core.romanize(lvl) + '</span>' +
          '<span class="d">' + KIND_BLURB[kind] + '</span>' +
          '<span class="c">' + (can ? fmt(cost) + ' Ψ' : 'MAX') + '</span></button>';
      }
      h += '</div></section>';
    }
    return h;
  }

  function reachLabel(def, d) {
    switch (def.id) {
      case 'frequency': return 'reach φ' + d.max.toFixed(0);
      case 'space': return RS.cosmos.TIERS[Math.round(d.min)].short + ' → ' + RS.cosmos.TIERS[Math.round(d.max)].short;
      case 'time': return d.min.toFixed(1) + '× → ' + d.max.toFixed(1) + '×';
      default: return 'full circle';
    }
  }

  function codexHTML(game) {
    let h = '<div class="codex-tabs">';

    /* ── The essence sheet ───────────────────────────────────────────────
     *
     * This is the player's map of the generative core, and it is the single
     * most useful screen in the game: every mechanic anywhere is one of six
     * primitives parameterised by the four numbers listed here, so a filled-in
     * row is a prediction about twelve layers at twenty-two scales.
     *
     * Unrevealed axes are drawn as blanks rather than hidden, because the shape
     * of what you do not know yet is itself information — you can see that
     * Cascade has three axes left and go hunting it deliberately, which is the
     * whole RECOGNITION pathway.
     */
    const AXIS_META = [
      { key: 'complexity', sym: 'C', hue: 268, lo: 'simple', hi: 'intricate' },
      { key: 'branching', sym: 'B', hue: 12, lo: 'single', hi: 'many' },
      { key: 'symmetry', sym: 'S', hue: 150, lo: 'lopsided', hi: 'even' },
      { key: 'persistence', sym: 'P', hue: 43, lo: 'fleeting', hi: 'lasting' }
    ];
    const totalAxes = RS.fractal.ESSENCES.length * 4;
    let shown = 0;
    for (const e of RS.fractal.ESSENCES) shown += RS.fractal.predicted(game, e.id, {}).revealed;

    h += '<section><h3>Essences <em>' + shown + ' / ' + totalAxes + ' axes read</em></h3>' +
      '<p class="blurb">One alphabet, spelled differently by every layer and every scale. ' +
      'Four numbers each, and every mechanic in the game is those numbers fed to one of six ' +
      'primitives — so a filled row is a prediction about twelve layers at twenty-two scales. ' +
      'Blanks are what you have not read yet.</p><div class="ess-sheet">';

    for (const e of RS.fractal.ESSENCES) {
      const n = RS.fractal.gnosisOf(game, e.id);
      const pr = RS.fractal.predicted(game, e.id, {});
      const met = n > 0;
      /* What is still to come, so a player can pick a target. */
      const nextAt = RS.fractal.REVEAL_AT[pr.revealed];
      const toGo = nextAt != null ? nextAt - n : 0;

      let bars = '';
      for (const a of AXIS_META) {
        const v = pr[a.key];
        const known = v !== undefined;
        bars += '<span class="ax' + (known ? '' : ' blank') + '" style="--h:' + a.hue + '" ' +
          'title="' + a.key + (known ? ': ' + v.toFixed(2) + ' — ' +
            (v > 0.66 ? a.hi : v < 0.34 ? a.lo : 'middling') : ' — not read yet') + '">' +
          '<b>' + a.sym + '</b>' +
          (known ? '<i style="width:' + (v * 100).toFixed(0) + '%"></i>' : '') +
          '</span>';
      }

      /* The forms this essence takes, which is the fractal claim made concrete:
       * the same information wearing eight different local names. Only shown
       * once met, because the point is recognising it, not reading it off. */
      const forms = met && e.forms
        ? Object.keys(e.forms).filter(k => e.forms[k]).map(k => e.forms[k]).slice(0, 4).join(' · ')
        : '';

      h += '<div class="ess-row' + (met ? '' : ' unknown') + '">' +
        '<span class="eg">' + (met ? e.glyph : '·') + '</span>' +
        '<span class="en">' + (met ? e.name : '—') +
          '<em>' + (met ? e.trait : 'not yet met') + '</em></span>' +
        '<span class="eax">' + bars + '</span>' +
        '<span class="ect">' + (met ? '×' + n : '') +
          (toGo > 0 && met ? '<em>+' + toGo + ' to read</em>' :
            met ? '<em>complete</em>' : '') + '</span>' +
        (forms ? '<span class="ef">' + forms + '</span>' : '') +
        '</div>';
    }
    h += '</div></section>';

    /* ── The primitives ──────────────────────────────────────────────────
     *
     * The other half of the map. The axes above are the numbers; these are the
     * six functions they are fed to, and which bands run which. Without this,
     * the axes are a stat block; with it, they are a prediction.
     */
    h += '<section><h3>Primitives <em>every mechanic is one of these</em></h3><div class="list">';
    for (const id of RS.emergence.IDS) {
      const L = RS.emergence.LABELS[id];
      const bands = RS.spectrum.BANDS.filter(b => RS.spectrum.usesPrim(b, id));
      const held = bands.filter(b => game.known.bands[b.id]);
      h += '<div class="row' + (held.length ? '' : ' dim') + '" style="--h:200">' +
        '<span class="g">' + L.glyph + '</span>' +
        '<span class="n">' + L.name + '<em>' + held.length + ' / ' + bands.length + ' layers held</em></span>' +
        '<span class="d">' + L.blurb + '<br><i style="opacity:.55">' +
        bands.map(b => b.name).join(', ') + '</i></span></div>';
    }
    h += '</div></section>';

    h += '<section><h3>Layers</h3><div class="list">';
    const foc = RS.dials.focusOf(game.dials.frequency);
    for (const b of RS.spectrum.BANDS) {
      const known = !!game.known.bands[b.id];
      const reachable = b.centre <= game.dials.frequency.max;
      const ghost = RS.spectrum.isGhost(b, foc);
      const status = known ? 'held' : !reachable ? 'out of reach' : ghost ? 'ghost — needs focus' : 'reachable';
      h += '<div class="row' + (known ? '' : ' dim') + '" style="--h:' + b.hue + '">' +
        '<span class="g">' + b.glyph + '</span>' +
        '<span class="n">' + b.name + '<em>φ' + b.centre + ' · ' + status + '</em></span>' +
        '<span class="d">' + (known ? b.blurb : '—') + '</span></div>';
    }
    h += '</div></section>';

    h += '<section><h3>Scales</h3><div class="list">';
    for (const t of RS.cosmos.TIERS) {
      const known = !!game.known.tiers[t.id];
      const inReach = t.index >= game.dials.space.min && t.index <= game.dials.space.max;
      h += '<div class="row' + (known ? '' : ' dim') + '" style="--h:' + t.hue + '">' +
        '<span class="g">' + (t.root ? '◉' : known ? '○' : inReach ? '·' : ' ') + '</span>' +
        '<span class="n">' + t.name + (t.root ? ' <b>ROOT</b>' : '') +
        '<em>' + (t.logM == null ? 'Tegmark Level ' + t.level : RS.core.fmtMetres(t.logM)) + '</em></span>' +
        '<span class="d">' + (known || inReach ? t.sci : '—') + '</span></div>';
    }
    h += '</div></section></div>';
    return h;
  }

  function settingsHTML(game) {
    const s = game.settings;
    const row = (k, label, blurb) =>
      '<button class="set-row" data-toggle="' + k + '"><span class="k">' + label + '</span>' +
      '<span class="d">' + blurb + '</span>' +
      '<span class="sw' + (s[k] ? ' on' : '') + '"></span></button>';
    return '<section class="settings">' +
      row('audio', 'Audio', 'Procedural synthesis. The beat tone is how you tune by ear — strongly recommended.') +
      row('haptics', 'Haptics', 'Detent ticks and impacts through the vibration motor.') +
      row('reduceMotion', 'Reduce motion', 'Disables screen shake and thins particle bursts.') +
      row('bloom', 'Bloom', 'Light spills between bright things. Costs about half a millisecond.') +
      row('showSci', 'Scientific notes', 'Show the physical definition of each scale.') +
      /* A cycle rather than a toggle, because three states is the right number:
       * everything, only what would be worth interrupting you, and nothing but
       * warnings. */
      '<button class="set-row" data-cycle="notify"><span class="k">Notifications</span>' +
      '<span class="d">' +
        (s.notify === 'all' ? 'Everything, including routine chatter.'
          : s.notify === 'off' ? 'Warnings only. Everything else is in the readout anyway.'
            : 'Arrivals, discoveries and warnings. Not chatter.') +
      '</span><span class="cyc">' + (s.notify || 'key').toUpperCase() + '</span></button>' +
      '<div class="stats"><h3>Session</h3>' +
      '<div>Crystallised <b>' + fmt(game.stats.crystals) + '</b></div>' +
      '<div>Best single <b>' + fmt(game.stats.bestSingle) + ' Ψ</b></div>' +
      '<div>Lifetime <b>' + fmt(game.lifetimeInsight) + ' Ψ</b></div>' +
      '<div>Layers held <b>' + Object.keys(game.known.bands).length + '/' + RS.spectrum.BANDS.length + '</b></div>' +
      '<div>Scales visited <b>' + Object.keys(game.known.tiers).length + '/' + RS.cosmos.TIERS.length + '</b></div>' +
      '<div>Played <b>' + RS.core.fmt(Math.floor(game.stats.playSeconds / 60)) + ' min</b></div>' +
      '</div></section>';
  }


  // --- world drawer --------------------------------------------------------

  /* Everything derivable about where the player currently is. This panel is
   * the payoff for the physics chain in planet.js: every line is a consequence
   * of the one before it, and the player can read the causality straight down
   * the list. */
  function worldHTML(game) {
    const s = game.scene;
    if (!s.system) return '<p class="blurb">Turn &Sigma; toward the system tier to arrive somewhere.</p>';

    const sys = s.system;
    const prim = sys.primary;
    let h = '';

    h += '<section><h3>' + sys.name + ' <em>' + sys.stars.length +
      (sys.stars.length === 1 ? ' star' : ' stars') + '</em></h3><div class="list">';
    for (const st of sys.stars) {
      h += '<div class="row" style="--h:' + st.cls.hue + '"><span class="g">&#9673;</span>' +
        '<span class="n">' + st.cls.c + st.sub + ' &middot; ' + st.cls.name +
        '<em>' + st.mass.toFixed(2) + ' M&#9737; &middot; ' + fmt(st.luminosity) + ' L&#9737; &middot; ' +
        Math.round(st.temperature) + ' K &middot; ' + st.age.toFixed(1) + '/' + st.lifetime.toFixed(1) + ' Gyr</em></span>' +
        '</div>';
    }
    h += '</div><div class="stats">' +
      '<div>Habitable zone <b>' + sys.hz.inner.toFixed(2) + '&ndash;' + sys.hz.outer.toFixed(2) + ' AU</b></div>' +
      '<div>Frost line <b>' + sys.frost.toFixed(2) + ' AU</b></div>' +
      '<div>Metallicity <b>' + prim.metallicity.toFixed(2) + ' Z&#9737;</b></div>' +
      '<div>Epoch <b>' + (s.t >= 0 ? '+' : '') + fmt(s.t) + ' yr</b></div>' +
      '</div></section>';

    const p = s.planet;
    if (!p) return h + '<p class="blurb">Tap a world to select it.</p>';

    const civ = p.civ || RS.civ.civOf(p, s.tGyr);
    h += '<section><h3>' + p.name + ' <em>' + p.type.name + '</em></h3>' +
      '<div class="stats">' +
      '<div>Orbit <b>' + p.a.toFixed(3) + ' AU</b></div>' +
      '<div>Mass / radius <b>' + fmt(p.massE) + ' M&#8853; / ' + p.radiusE.toFixed(2) + ' R&#8853;</b></div>' +
      '<div>Gravity <b>' + p.gravity.toFixed(2) + ' g</b></div>' +
      '<div>Escape velocity <b>' + p.vEsc.toFixed(1) + ' km/s</b></div>' +
      '<div>Stellar flux <b>' + p.flux.toFixed(2) + ' S&#8853;</b></div>' +
      '<div>Surface <b>' + Math.round(p.surfaceTemp) + ' K</b></div>' +
      '<div>Pressure <b>' + (p.pressure < 0.01 ? '&lt;0.01' : p.pressure.toFixed(2)) + ' bar</b></div>' +
      '<div>Day <b>' + (p.tidallyLocked ? 'tidally locked' : p.dayHours.toFixed(1) + ' h') + '</b></div>' +
      '<div>Hydrosphere <b>' + (p.hydrosphere * 100).toFixed(0) + '%</b></div>' +
      '<div>Habitability <b>' + (p.habitability * 100).toFixed(1) + '%</b></div>' +
      '</div>';

    if (p.composition.length) {
      h += '<h3 style="margin-top:10px">Atmosphere</h3><div class="list">';
      for (const c of p.composition.slice(0, 5)) {
        h += '<div class="row" style="--h:190"><span class="g">&middot;</span><span class="n">' +
          c.gas.name + '<em>' + (c.frac * 100).toFixed(1) + '%</em></span></div>';
      }
      h += '</div>';
    } else {
      h += '<p class="blurb">No atmosphere &mdash; too small and too hot to hold one.</p>';
    }

    if (p.biosphere) {
      const b = p.biosphere;
      h += '<h3 style="margin-top:10px">Biosphere ' +
        (b.seeded ? '<em>seeded by you</em>' : '') + '</h3><div class="stats">' +
        '<div>Stage <b>' + b.stage.name + '</b></div>' +
        '<div>Complexity <b>' + (b.complexity * 100).toFixed(0) + '%</b></div>' +
        '<div>Chemistry <b>' + b.chemistry + '</b></div>' +
        '<div>Oxygenation <b>' + (b.oxygenation * 100).toFixed(0) + '%</b></div>' +
        '<div>Diversity <b>' + fmt(b.diversity) + ' clades</b></div>' +
        '</div>';
    }

    if (civ) {
      h += '<h3 style="margin-top:10px">' + civ.name + '</h3><div class="stats">' +
        '<div>Technology <b>' + civ.tier.name + '</b></div>' +
        '<div>Population <b>' + fmt(civ.population) + '</b></div>' +
        '<div>Disposition <b>' + civ.disposition.name + '</b></div>' +
        '<div>Kardashev <b>' + civ.kardashev.toFixed(2) + '</b></div>' +
        (civ.collapsed ? '<div>Status <b style="color:var(--warn)">post-collapse</b></div>' : '') +
        '</div>';

      const market = RS.civ.marketOf(p, civ);
      h += '<h3 style="margin-top:10px">Market</h3><div class="list">';
      for (const m of market.slice(0, 7)) {
        h += '<div class="row" style="--h:' + m.commodity.hue + '"><span class="g">&#9671;</span>' +
          '<span class="n">' + m.commodity.name + '<em>' + m.price.toFixed(1) + ' &Psi;/u &middot; ' +
          (m.balance > 0 ? 'wants' : 'sells') + '</em></span></div>';
      }
      h += '</div>';
    }

    // resources
    h += '<h3 style="margin-top:10px">Resources</h3><div class="list">';
    for (const k of RS.planet.RESOURCE_KINDS) {
      const v = p.resources[k.id] || 0;
      if (v < 0.02) continue;
      h += '<div class="row" style="--h:' + k.hue + '"><span class="g">&#9632;</span>' +
        '<span class="n">' + k.name + '<em>' + (v * 100).toFixed(0) + '% abundance</em></span></div>';
    }
    h += '</div>';

    // player actions available here
    if (game.inhabiting) {
      const arch = RS.vessel.archOf(game.body);
      h += '<h3 style="margin-top:12px">Actions</h3><div class="up-rows">';
      if (arch.extracts) {
        h += '<button class="up-row" data-act="extract"><span class="k">EXTRACT</span><span class="lv">&#9660;</span>' +
          '<span class="d">Take the richest local seam into your hold.</span><span class="c">8 chg</span></button>';
      }
      if (game.body.holdMass > 0) {
        h += '<button class="up-row" data-act="sell"><span class="k">SELL</span><span class="lv">&#9650;</span>' +
          '<span class="d">Convert your hold at local prices.</span><span class="c">' +
          fmt(game.body.holdMass) + ' u</span></button>';
      }
      h += '</div>';
    }

    // structures
    const placed = RS.influence.structuresOn(game, p);
    h += '<h3 style="margin-top:12px">Structures <em>upkeep ' +
      RS.influence.totalUpkeep(game).toFixed(1) + '/' + fmt(game.passiveRate) + '</em></h3>';
    if (placed.length) {
      h += '<div class="list">';
      for (const x of placed) {
        h += '<div class="row" style="--h:' + x.struct.hue + '"><span class="g">' + x.struct.glyph + '</span>' +
          '<span class="n">' + x.struct.name + '<em>' + ((x.delta.progress || 0) * 100).toFixed(0) +
          '% matured &middot; ' + x.struct.effect + '</em></span></div>';
      }
      h += '</div>';
    }
    const buildable = RS.influence.STRUCTURES.filter(x => game.structuresUnlocked[x.id]);
    if (buildable.length) {
      h += '<div class="up-rows" style="margin-top:6px">';
      for (const x of buildable) {
        const why = RS.influence.canPlace(game, p, x.id);
        h += '<button class="up-row" data-build="' + x.id + '"' + (why ? ' disabled' : '') + '>' +
          '<span class="k">' + x.glyph + '</span><span class="lv"></span>' +
          '<span class="d"><b>' + x.name + '</b> &mdash; ' + x.blurb + '</span>' +
          '<span class="c">' + (why ? why : fmt(x.cost.insight) + ' &Psi;') + '</span></button>';
      }
      h += '</div>';
    } else {
      h += '<p class="blurb">Research FIELD PROJECTION to build anything here.</p>';
    }

    h += '</section>';
    return h;
  }

  // --- vessels & research drawer -------------------------------------------

  function vesselsHTML(game) {
    const avail = RS.vessel.availability(game);
    const cur = RS.vessel.archOf(game.body);
    let h = '<section><h3>Bodies <em>' + (game.inhabiting ? 'inhabiting ' + cur.name : 'unembodied') + '</em></h3>' +
      '<p class="blurb">The four dials become this body\'s controls while you are in it. ' +
      'Unembodied, &tau; scrubs time and &Sigma; moves the scale ladder; embodied, &tau; is throttle and &Sigma; is your vertical axis.</p>' +
      '<div class="up-rows">';

    if (game.inhabiting) {
      const b = game.body;
      h += '<div class="up-row na"><span class="k">CHARGE</span><span class="lv">' +
        Math.round(b.charge) + '</span><span class="d">of ' + cur.capacity +
        ' &middot; hold ' + fmt(b.holdMass) + ' u' +
        (b.mindState ? ' &middot; possession ' + (b.mindState.possession * 100).toFixed(0) + '%' : '') +
        '</span><span class="c"></span></div>';
      h += '<button class="up-row" data-embark="_off"><span class="k">LEAVE</span><span class="lv">&#8598;</span>' +
        '<span class="d">Return to the bare point of consciousness.</span><span class="c"></span></button>';
    }

    for (const a of avail) {
      if (!a.unlocked) continue;
      if (game.inhabiting && a.arch.id === cur.id) continue;
      const dm = a.arch.dialMap;
      h += '<button class="up-row" data-embark="' + a.arch.id + '"' + (a.reason ? ' disabled' : '') +
        ' style="--h:' + a.arch.hue + '">' +
        '<span class="k">' + a.arch.glyph + ' ' + a.arch.name.toUpperCase() + '</span><span class="lv"></span>' +
        '<span class="d">' + a.arch.blurb +
        '<br><i style="opacity:.6">&tau; ' + dm.time + ' &middot; &Sigma; ' + dm.space +
        ' &middot; &Delta; ' + dm.phase + '</i></span>' +
        '<span class="c">' + (a.reason ? a.reason : 'TAKE') + '</span></button>';
    }
    h += '</div></section>';

    h += '<section><h3>Research <em>' + Object.keys(game.research).length + '/' +
      RS.influence.RESEARCH.length + '</em></h3><div class="up-rows">';
    for (const node of RS.influence.RESEARCH) {
      const done = RS.influence.isResearched(game, node.id);
      const open = RS.influence.researchAvailable(game, node);
      const afford = game.insight >= node.cost;
      h += '<button class="up-row" data-research="' + node.id + '"' +
        (done || !open || !afford ? ' disabled' : '') + ' style="--h:' + node.hue + '">' +
        '<span class="k">' + node.name.toUpperCase() + '</span>' +
        '<span class="lv">' + (done ? '&#10003;' : open ? '' : '&#128274;') + '</span>' +
        '<span class="d">' + node.blurb +
        (node.needs.length && !open ? '<br><i style="opacity:.6">needs ' +
          node.needs.map(n => RS.influence.RESEARCH_BY_ID[n].name).join(', ') + '</i>' : '') +
        '</span><span class="c">' + (done ? '&mdash;' : fmt(node.cost) + ' &Psi;') + '</span></button>';
    }
    h += '</div></section>';

    h += '<section><h3>Fields</h3><div class="stats">' +
      '<div>Consciousness <b>' + game.fields.consciousness.toFixed(2) + '</b></div>' +
      '<div>Reality <b>' + game.fields.reality.toFixed(2) + '</b></div>' +
      '<div>Reach <b>' + RS.influence.reachRadius(game) + ' systems</b></div>' +
      '<div>Structures <b>' + RS.influence.structureCount(game) + '</b></div>' +
      '</div><p class="blurb">The consciousness field is how far you reach. ' +
      'The reality field is how hard your influence bites when it gets there. ' +
      'Both grow from gnosis, research and beacons &mdash; three currencies, one pair of numbers.</p></section>';

    return h;
  }


  // --- contact drawer ------------------------------------------------------

  /* The contact panel is the payoff for the whole tuning apparatus, so it
   * shows the *tuning* first: how close the carrier lock is, in the same
   * language the field uses, with the same arrows. A player who has learned to
   * land a manifestation already knows how to read this. */
  function contactHTML(game, bus) {
    const c = game.scene.contact;
    if (!c) {
      return '<p class="blurb">No mind within reach. Civilisations are rare &mdash; ' +
        'look for the pulsing amber rings on the galactic map, then descend into that system.</p>' +
        contactRosterHTML(game);
    }

    const { civ, lock, planet } = c;
    const rec = RS.contact.recordOf(game, planet);
    const state = RS.contact.stateOf(game, planet, civ, lock);
    const carrier = lock.carrier;
    let h = '';

    h += '<section><h3>' + civ.name + ' <em>' + planet.name + '</em></h3>' +
      '<div class="stats">' +
      '<div>Technology <b>' + civ.tier.name + '</b></div>' +
      '<div>Population <b>' + fmt(civ.population) + '</b></div>' +
      '<div>Disposition <b>' + civ.disposition.name + '</b></div>' +
      '<div>Channel <b style="color:' + hsl(state.hue, 0.8, 0.7) + '">' + state.name + '</b></div>' +
      '<div>They know of you <b>' + (rec.awareness * 100).toFixed(0) + '%</b></div>' +
      '<div>Standing <b style="color:' + hsl(rec.standing >= 0 ? 135 : 0, 0.8, 0.68) + '">' +
        (rec.standing >= 0 ? '+' : '') + rec.standing.toFixed(2) + '</b></div>' +
      '</div>';

    // ── the carrier ──
    h += '<h3 style="margin-top:12px">Carrier</h3>' +
      '<p class="blurb">They broadcast on the <b>' + carrier.band.name + '</b> layer &mdash; ' +
      carrier.spec.note + '. Tune &phi; onto it and hold &Delta; to open the channel.</p>';

    const dirF = Math.abs(lock.fd) < 0.25 ? 'on' : (lock.fd > 0 ? 'lower &phi;' : 'raise &phi;');
    const dirP = Math.abs(lock.pd) < 0.25 ? 'on' : (lock.pd > 0 ? 'lower &Delta;' : 'raise &Delta;');
    h += '<div class="ro-axes" style="margin:0 0 8px">' +
      '<span class="ax' + (lock.f > 0.86 ? ' good' : '') + '" style="--h:187">&phi;' +
        '<b style="width:' + (clamp01(lock.f) * 100).toFixed(0) + '%"></b><i>' + dirF + '</i></span>' +
      '<span class="ax' + (lock.p > 0.86 ? ' good' : '') + '" style="--h:268">&Delta;' +
        '<b style="width:' + (clamp01(lock.p) * 100).toFixed(0) + '%"></b><i>' + dirP + '</i></span>' +
      '</div>';

    if (!lock.inReach) {
      h += '<p class="blurb" style="color:var(--warn)">Their carrier sits at &phi;' +
        carrier.phi.toFixed(1) + ', past your dial\'s reach of &phi;' +
        game.dials.frequency.max.toFixed(0) + '. Buy &phi; RANGE.</p>';
    } else if (lock.ghost) {
      h += '<p class="blurb" style="color:var(--warn)">You can hear that somebody is there and cannot make them out. ' +
        'The ' + carrier.band.name + ' layer needs more &phi; FOCUS to cohere.</p>';
    } else if (rec.awareness < 0.35) {
      h += '<p class="blurb">They have not noticed you yet. Stay in their system, ' +
        'raise your reality field, or build something they can see.</p>';
    }

    // ── what they say ──
    if (state === RS.contact.STATES.open || state === RS.contact.STATES.warm) {
      h += '<h3 style="margin-top:12px">They say</h3><div class="say">';
      for (const line of RS.contact.greeting(game, planet, civ)) {
        h += '<p>' + line + '</p>';
      }
      h += '</div>';

      h += '<h3 style="margin-top:12px">Exchange</h3><div class="up-rows">';
      for (const o of RS.contact.offersFor(game, planet, civ)) {
        const dis = !o.available;
        h += '<button class="up-row" data-contact="' + o.id + '"' + (dis ? ' disabled' : '') +
          ' style="--h:' + civ.disposition.hue + '">' +
          '<span class="k">' + o.name.toUpperCase().slice(0, 22) + '</span><span class="lv"></span>' +
          '<span class="d">' + o.blurb + '<br><i style="opacity:.65">' +
            (dis && o.why ? o.why : o.effect) + '</i></span>' +
          '<span class="c">' + (o.cost ? fmt(o.cost) + ' &Psi;' : '') + '</span></button>';
      }
      h += '</div>';
    } else if (state === RS.contact.STATES.cold) {
      h += '<p class="blurb" style="color:var(--warn)">They are refusing you. ' +
        'Standing must rise above &minus;0.45 before they will answer again.</p>';
    }

    return h + contactRosterHTML(game);
  }

  /* Everyone you have ever spoken to, so relationships persist visibly rather
   * than existing only while you are standing in the right system. */
  function contactRosterHTML(game) {
    const keys = Object.keys(game.contacts).filter(k => game.contacts[k].met);
    if (!keys.length) return '';
    let h = '<section><h3>Known cultures <em>' + keys.length + '</em></h3><div class="list">';
    for (const k of keys) {
      const r = game.contacts[k];
      const hue = r.standing > 0.45 ? 135 : r.standing < -0.2 ? 0 : 45;
      h += '<div class="row" style="--h:' + hue + '"><span class="g">&#9673;</span>' +
        '<span class="n">' + (r.name || 'Unnamed culture') +
        (r.where ? ' <b style="color:var(--dimmer)">' + r.where + '</b>' : '') +
        '<em>standing ' + (r.standing >= 0 ? '+' : '') +
        r.standing.toFixed(2) + ' &middot; ' + r.exchanges + ' exchanges' +
        (r.taught.length ? ' &middot; taught you ' + r.taught.length : '') +
        (r.uplifted ? ' &middot; uplifted &times;' + r.uplifted : '') + '</em></span></div>';
    }
    return h + '</div></section>';
  }

  // --- galaxy readout ------------------------------------------------------

  /* What the player is looking at on the map, and what it would cost to go
   * there. Rendered into the same slot the node readout uses. */
  function renderGalaxyReadout(game, node) {
    const G = game.galaxy;
    const tg = G.target;
    const reachLy = RS.influence.reachRadius(game) * RS.galaxy.LY_PER_SECTOR;
    node.dataset.empty = '0';

    if (!tg) {
      node.innerHTML =
        '<div class="ro-head"><span class="ro-glyph" style="color:#7dd3fc">&#9678;</span>' +
        '<span class="ro-title">Sector ' + G.sx + ', ' + G.sy + '</span></div>' +
        '<div class="ro-sub">' + G.stars.length + ' stars in view &middot; reach ' +
        reachLy.toFixed(0) + ' ly</div>' +
        '<div class="ro-sub" style="margin-top:4px">Tap a star to select it.</div>';
      return;
    }

    const sv = RS.galaxy.surveyOf(game, tg);
    const st = tg.star;
    node.innerHTML =
      '<div class="ro-head"><span class="ro-glyph" style="color:' + hsl(st.cls.hue, 0.8, 0.72) + '">&#9673;</span>' +
      '<span class="ro-title">' + tg.name + '</span></div>' +
      '<div class="ro-sub">' + st.cls.c + st.sub + ' ' + st.cls.name + ' &middot; ' +
        st.mass.toFixed(2) + ' M&#9737; &middot; ' + tg.dist.toFixed(1) + ' ly</div>' +
      (sv ? '<div class="ro-sub" style="margin-top:4px">' + sv.planets + ' planets' +
        (sv.life ? ' &middot; <b style="color:#86efac">' + sv.life + ' living</b>' : '') +
        (sv.civ ? ' &middot; <b style="color:#fcd34d">' + sv.civ + ' inhabited</b>' : '') + '</div>'
        : '<div class="ro-sub" style="margin-top:4px;color:var(--warn)">Beyond your field &mdash; unresolved</div>') +
      '<div class="ro-sub" style="margin-top:4px">' +
        (tg.inReach || tg.visited || tg.charted
          ? 'Turn &Sigma; inward to travel here.'
          : 'Expand the consciousness field to reach it.') + '</div>';
  }

  RS.ui = {
    setNotifyLevel, init, render, toast, toggleDrawer, openDrawer, closeDrawer, renderDrawer, renderTabs, setText, TABS,
    worldHTML, vesselsHTML, contactHTML, codexHTML, upgradesHTML, settingsHTML,
    toggleDebug, renderDebug, setDebugOpen,
    get drawerOpen() { return drawerOpen; },
    get debugOpen() { return debugOpen; }
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
