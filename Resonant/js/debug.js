/* Resonant — developer cheat / debug HUD.
 *
 * Not a player feature. Gated by localhost, ?debug=1, or
 * localStorage.resonantDebug=1. Actions mutate through existing RS.* APIs so
 * bus/reactions and saves stay consistent. Pure HTML builders here; ui.js owns
 * the DOM mount and click wiring.
 */
(function (RS) {
  'use strict';

  const SCENE_JUMPS = [
    { id: 'foam', label: 'Foam' },
    { id: 'shells', label: 'Shells' },
    { id: 'molecular', label: 'Molecular' },
    { id: 'cellular', label: 'Cell' },
    { id: 'planet', label: 'Surface' },
    { id: 'system', label: 'System' },
    { id: 'galaxy', label: 'Map' },
    { id: 'field', label: 'Field' },
    { id: 'web', label: 'Web' },
    { id: 'ensemble', label: 'Ensemble' }
  ];

  function enabled() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('resonantDebug') === '1') {
        return true;
      }
    } catch (_) { /* private mode */ }
    try {
      if (typeof location === 'undefined') return false;
      const h = location.hostname || '';
      if (h === 'localhost' || h === '127.0.0.1') return true;
      const q = location.search || '';
      if (/(?:^|[?&])debug=1(?:&|$)/.test(q)) return true;
    } catch (_) { /* no location */ }
    return false;
  }

  /* Ensure a dial's reach covers `v` by buying range (free in debug). */
  function ensureReach(dial, v) {
    let guard = 64;
    while (guard-- > 0 && (v < dial.min || v > dial.max)) {
      if (!RS.dials.canUpgrade(dial, 'range')) break;
      RS.dials.applyUpgrade(dial, 'range');
    }
  }

  function grantInsight(game, amount) {
    const n = Math.max(0, amount | 0);
    game.insight += n;
    game.lifetimeInsight = (game.lifetimeInsight || 0) + n;
    if (RS.field && RS.field.updateDerived) RS.field.updateDerived(game);
    return { ok: true, insight: game.insight };
  }

  function setYieldMul(game, mul) {
    game.yieldMul = Math.max(0, +mul || 1);
    if (RS.field && RS.field.updateDerived) RS.field.updateDerived(game);
    return { ok: true, yieldMul: game.yieldMul };
  }

  function maxDials(game) {
    for (const def of RS.dials.DEFS) {
      const dial = game.dials[def.id];
      for (const kind of ['range', 'precision', 'focus']) {
        while (RS.dials.canUpgrade(dial, kind)) RS.dials.applyUpgrade(dial, kind);
      }
    }
    RS.dials.refreshReach(game.dials);
    return { ok: true };
  }

  function maxStrike(game) {
    if (!game.strikeLevels) game.strikeLevels = { strike: 0, tempo: 0, resonance: 0 };
    for (const u of RS.strike.UPGRADES) game.strikeLevels[u.id] = u.max;
    return { ok: true };
  }

  function unlockAllResearch(game, bus) {
    const busSafe = bus || { emit() {} };
    /* tryResearch spends insight and respects deps; RESEARCH is authored in
     * dependency order, so one pass with a padded wallet is enough. */
    const need = RS.influence.RESEARCH.reduce((s, n) => s + n.cost, 0) + 1;
    if (game.insight < need) grantInsight(game, need - game.insight);
    for (const n of RS.influence.RESEARCH) RS.influence.tryResearch(game, busSafe, n.id);
    RS.influence.recomputeFields(game);
    return { ok: true };
  }

  function unlockAllVessels(game) {
    for (const a of RS.vessel.ARCHETYPES) game.vessels.unlocked[a.id] = true;
    return { ok: true };
  }

  function unlockAllStructures(game) {
    for (const s of RS.influence.STRUCTURES) game.structuresUnlocked[s.id] = true;
    return { ok: true };
  }

  function knowAllBands(game) {
    for (const b of RS.spectrum.BANDS) game.known.bands[b.id] = true;
    return { ok: true };
  }

  function knowAllTiers(game) {
    for (const t of RS.cosmos.TIERS) game.known.tiers[t.id] = true;
    return { ok: true };
  }

  function unlockAll(game, bus) {
    maxDials(game);
    maxStrike(game);
    unlockAllResearch(game, bus);
    unlockAllVessels(game);
    unlockAllStructures(game);
    knowAllBands(game);
    knowAllTiers(game);
    RS.influence.recomputeFields(game);
    return { ok: true };
  }

  function jumpScene(game, bus, sceneId) {
    const busSafe = bus || { emit() {} };
    if (!RS.scenes.SCENE_BY_ID[sceneId]) return { ok: false, reason: 'unknown scene' };
    if (game.inhabiting) RS.scenes.disembark(game, busSafe);
    const tier = RS.scenes.tierForScene(sceneId);
    const space = game.dials.space;
    ensureReach(space, tier);
    RS.dials.refreshReach(game.dials);
    RS.dials.setValue(game, space, tier);
    const t = RS.cosmos.TIERS[tier];
    if (t) game.known.tiers[t.id] = true;
    /* scenes.tick is what actually flips kind from Σ while observing. */
    RS.scenes.tick(game, busSafe, 0);
    return { ok: true, kind: game.scene.kind, tier };
  }

  function snapPhi(game, bandId) {
    const band = RS.spectrum.BY_ID[bandId];
    if (!band) return { ok: false, reason: 'unknown band' };
    const freq = game.dials.frequency;
    ensureReach(freq, band.centre);
    RS.dials.refreshReach(game.dials);
    RS.dials.setValue(game, freq, band.centre);
    game.known.bands[band.id] = true;
    return { ok: true, phi: freq.value };
  }

  function presetFresh(game, bus) {
    const seed = game.seed;
    const g = RS.game.newGame(seed);
    /* Replace mutable fields on the live object so __RESONANT__ / ui keep the
     * same reference. */
    for (const k of Object.keys(g)) game[k] = g[k];
    /* Preserve bus handle if present. */
    if (bus) game.__bus = bus;
    return { ok: true, preset: 'fresh' };
  }

  function presetMid(game, bus) {
    grantInsight(game, 5000);
    /* Open the ladder and spectrum a useful amount without maxing everything. */
    for (const def of RS.dials.DEFS) {
      const dial = game.dials[def.id];
      for (let i = 0; i < 8; i++) {
        if (RS.dials.canUpgrade(dial, 'range')) RS.dials.applyUpgrade(dial, 'range');
        if (RS.dials.canUpgrade(dial, 'precision')) RS.dials.applyUpgrade(dial, 'precision');
        if (RS.dials.canUpgrade(dial, 'focus')) RS.dials.applyUpgrade(dial, 'focus');
      }
    }
    RS.dials.refreshReach(game.dials);
    const early = ['locomotion', 'buoyancy', 'extraction', 'sensing', 'aerodynamics'];
    const need = early.reduce((s, id) => {
      const n = RS.influence.RESEARCH_BY_ID[id];
      return s + (n && !game.research[id] ? n.cost : 0);
    }, 0);
    if (need > 0) grantInsight(game, need);
    const busSafe = bus || { emit() {} };
    for (const id of early) RS.influence.tryResearch(game, busSafe, id);
    for (const b of RS.spectrum.BANDS.slice(0, 5)) game.known.bands[b.id] = true;
    for (const t of RS.cosmos.TIERS) {
      if (t.index >= RS.cosmos.ROOT_INDEX - 4 && t.index <= RS.cosmos.ROOT_INDEX + 3) {
        game.known.tiers[t.id] = true;
      }
    }
    RS.influence.recomputeFields(game);
    return { ok: true, preset: 'mid' };
  }

  function presetEndgame(game, bus) {
    grantInsight(game, 1e6);
    unlockAll(game, bus);
    return { ok: true, preset: 'endgame' };
  }

  function forceSave(game) {
    if (!RS.save || !RS.save.writeNow) return { ok: false, reason: 'no save' };
    RS.save.writeNow(game);
    return { ok: true };
  }

  function wipeSave() {
    if (!RS.save || !RS.save.wipe) return { ok: false, reason: 'no save' };
    RS.save.wipe();
    return { ok: true };
  }

  function dumpSave(game) {
    if (!RS.save || !RS.save.serialise) return { ok: false, reason: 'no save' };
    const json = JSON.stringify(RS.save.serialise(game), null, 2);
    return { ok: true, json };
  }

  function dumpUnderfoot(game) {
    const s = game.scene;
    if (!s || !s.planet) return { ok: false, reason: 'not on a planet' };
    RS.scenes.sampleSurface(game);
    const su = s.surface;
    const line = (s.planet.name || 'world') +
      ' lon ' + (s.lon * 57.3).toFixed(2) +
      ' lat ' + (s.lat * 57.3).toFixed(2) +
      ' elev ' + (su ? su.elev.toFixed(3) : '?') +
      ' biome ' + (su && su.biome ? su.biome.id : '?') +
      ' cam ' + RS.scenes.cameraMode(game);
    return { ok: true, json: line, dump: line };
  }

  function teleport(game, lonLat) {
    const s = game.scene;
    if (!s || s.kind !== 'planet') return { ok: false, reason: 'not on a planet' };
    const parts = String(lonLat || '0,0').split(',');
    const lonDeg = parseFloat(parts[0]), latDeg = parseFloat(parts[1]);
    if (!Number.isFinite(lonDeg) || !Number.isFinite(latDeg)) {
      return { ok: false, reason: 'lon,lat degrees' };
    }
    s.lon = RS.planet.wrapLon(lonDeg * Math.PI / 180);
    s.lat = RS.planet.clampLat(latDeg * Math.PI / 180);
    RS.scenes.sampleSurface(game);
    return { ok: true, lon: s.lon, lat: s.lat };
  }

  function setCam(game, mode) {
    const s = game.scene;
    if (!s) return { ok: false, reason: 'no scene' };
    if (mode === 'auto') { s.forceCam = null; return { ok: true, forceCam: null }; }
    if (mode !== 'globe') {
      return { ok: false, reason: 'only globe camera' };
    }
    s.forceCam = mode;
    return { ok: true, forceCam: mode };
  }

  function persistDebug(on) {
    try {
      if (typeof localStorage === 'undefined') return { ok: false, reason: 'no storage' };
      if (on) localStorage.setItem('resonantDebug', '1');
      else localStorage.removeItem('resonantDebug');
      return { ok: true, persist: !!on };
    } catch (_) {
      return { ok: false, reason: 'storage blocked' };
    }
  }

  function skipTime(game, seconds) {
    const n = Math.max(0, +seconds || 0);
    game.stats.playSeconds = (game.stats.playSeconds || 0) + n;
    return { ok: true, playSeconds: game.stats.playSeconds };
  }

  function leaveBody(game, bus) {
    if (!game.inhabiting) return { ok: false, reason: 'not embodied' };
    RS.scenes.disembark(game, bus || { emit() {} });
    return { ok: true };
  }

  function takeBody(game, bus, archId) {
    const busSafe = bus || { emit() {} };
    if (archId === '_off') return leaveBody(game, busSafe);
    return RS.scenes.embark(game, busSafe, archId);
  }

  function takeBestBody(game, bus) {
    const best = RS.vessel.bestHere(game);
    if (!best) return { ok: false, reason: 'no vessel works here' };
    return takeBody(game, bus, best.id);
  }

  function planetPlayground(game, bus) {
    const busSafe = bus || { emit() {} };
    jumpScene(game, busSafe, 'planet');
    presetMid(game, busSafe);
    const emb = takeBestBody(game, busSafe);
    return { ok: true, embarked: emb.ok ? emb : null, kind: game.scene.kind };
  }

  function bumpFirstCrystal(game, bus) {
    game.stats.crystals = Math.max(game.stats.crystals || 0, 1);
    grantInsight(game, 120);
    const gal = RS.cosmos.TIERS.find(t => t.id === 'galactic');
    if (gal) game.known.tiers[gal.id] = true;
    if (bus && bus.emit) bus.emit('debug:first-crystal', {});
    return { ok: true, crystals: game.stats.crystals };
  }

  function fillGnosis(game, contexts) {
    const want = Math.max(1, contexts | 0);
    const nBand = RS.spectrum.BANDS.length;
    const nTier = RS.cosmos.TIERS.length;
    for (const ess of RS.fractal.ESSENCES) {
      const list = game.gnosis[ess.id] || (game.gnosis[ess.id] = []);
      let guard = want * 4;
      for (let t = 0; t < nTier && list.length < want && guard-- > 0; t++) {
        for (let b = 0; b < nBand && list.length < want && guard-- > 0; b++) {
          const key = RS.fractal.contextKey(ess.id, t, b);
          if (list.indexOf(key) < 0) list.push(key);
        }
      }
    }
    return { ok: true };
  }

  function maxSurveyHere(game) {
    const s = game.scene;
    if (!s || s.kind !== 'planet' || !s.planet) return { ok: false, reason: 'not on a planet' };
    if (!game.surveys) game.surveys = Object.create(null);
    const key = RS.influence.planetKey(s.planet);
    game.surveys[key] = { work: 48, lastAt: game.stats.playSeconds || 0 };
    return { ok: true, work: 48 };
  }

  function pinHunt(game, essenceId) {
    if (!RS.game || !RS.game.pinHunt) return { ok: false, reason: 'no hunt' };
    return RS.game.pinHunt(game, essenceId);
  }

  function forceOpenSeed(game, bus) {
    if (!RS.game || !RS.game.openSeed) return { ok: false, reason: 'no seed' };
    fillGnosis(game, 8);
    if (!RS.game.canOpenSeed(game)) {
      grantInsight(game, 50000);
      unlockAll(game, bus);
    }
    return RS.game.openSeed(game, bus);
  }

  const ACTIONS = {
    'insight-1k': (g) => grantInsight(g, 1000),
    'insight-100k': (g) => grantInsight(g, 100000),
    'yield-1': (g) => setYieldMul(g, 1),
    'yield-10': (g) => setYieldMul(g, 10),
    'max-dials': (g) => maxDials(g),
    'max-strike': (g) => maxStrike(g),
    'research-all': (g, b) => unlockAllResearch(g, b),
    'vessels-all': (g) => unlockAllVessels(g),
    'structures-all': (g) => unlockAllStructures(g),
    'bands-all': (g) => knowAllBands(g),
    'tiers-all': (g) => knowAllTiers(g),
    'unlock-all': (g, b) => unlockAll(g, b),
    'preset-fresh': (g, b) => presetFresh(g, b),
    'preset-mid': (g, b) => presetMid(g, b),
    'preset-endgame': (g, b) => presetEndgame(g, b),
    'save-now': (g) => forceSave(g),
    'save-wipe': () => wipeSave(),
    'save-dump': (g) => dumpSave(g),
    'dump-underfoot': (g) => dumpUnderfoot(g),
    'debug-on': () => persistDebug(true),
    'debug-off': () => persistDebug(false),
    'time-10m': (g) => skipTime(g, 600),
    'time-1h': (g) => skipTime(g, 3600),
    'first-crystal': (g, b) => bumpFirstCrystal(g, b),
    'max-gnosis': (g) => fillGnosis(g, 8),
    'open-seed': (g, b) => forceOpenSeed(g, b),
    'planet-play': (g, b) => planetPlayground(g, b),
    'disembark': (g, b) => leaveBody(g, b),
    'embark-best': (g, b) => takeBestBody(g, b),
    'survey-maxed': (g) => maxSurveyHere(g)
  };

  function run(game, bus, action, arg) {
    if (!game) return { ok: false, reason: 'no game' };
    if (action === 'jump') return jumpScene(game, bus, arg);
    if (action === 'phi') return snapPhi(game, arg);
    if (action === 'teleport') return teleport(game, arg);
    if (action === 'cam') return setCam(game, arg);
    if (action === 'embark') return takeBody(game, bus, arg);
    if (action === 'pin-hunt') return pinHunt(game, arg);
    const fn = ACTIONS[action];
    if (!fn) return { ok: false, reason: 'unknown action' };
    return fn(game, bus);
  }

  function statusLine(game) {
    if (!game) return 'no game';
    const tier = RS.cosmos.tierAt(game.dials.space.value);
    const band = RS.spectrum.nearestBand(game.dials.frequency.value);
    return 'Ψ ' + Math.floor(game.insight) +
      ' · ' + (game.scene.kind || '?') +
      ' · Σ ' + tier.short +
      ' · φ ' + (band ? band.name : '?') +
      ' · ×' + (game.yieldMul || 1);
  }

  function btn(action, label, arg) {
    let attrs = 'type="button" class="dbg-btn" data-dbg="' + action + '"';
    if (arg != null) attrs += ' data-dbg-arg="' + arg + '"';
    return '<button ' + attrs + '>' + label + '</button>';
  }

  function panelHTML(game) {
    let h = '<header class="dbg-head"><strong>DEV</strong>' +
      '<span class="dbg-status">' + statusLine(game) + '</span>' +
      '<button type="button" class="dbg-close" data-dbg="close" title="Hide (`)">✕</button></header>';

    h += '<section><h4>Resources</h4><div class="dbg-row">' +
      btn('insight-1k', '+1k Ψ') +
      btn('insight-100k', '+100k Ψ') +
      btn('yield-1', '×1 yield') +
      btn('yield-10', '×10 yield') +
      '</div></section>';

    h += '<section><h4>Unlocks</h4><div class="dbg-row">' +
      btn('unlock-all', 'Unlock ALL') +
      btn('max-dials', 'Max dials') +
      btn('max-strike', 'Max strike') +
      btn('research-all', 'Research') +
      btn('vessels-all', 'Vessels') +
      btn('structures-all', 'Structures') +
      btn('bands-all', 'Bands') +
      btn('tiers-all', 'Tiers') +
      '</div></section>';

    h += '<section><h4>Scene</h4><div class="dbg-row">';
    for (const s of SCENE_JUMPS) h += btn('jump', s.label, s.id);
    h += '</div></section>';

    h += '<section><h4>φ snap</h4><div class="dbg-row">';
    for (const b of RS.spectrum.BANDS) {
      h += btn('phi', b.name.slice(0, 4), b.id);
    }
    h += '</div></section>';

    h += '<section><h4>Presets</h4><div class="dbg-row">' +
      btn('preset-fresh', 'Fresh') +
      btn('preset-mid', 'Midgame') +
      btn('preset-endgame', 'Endgame') +
      '</div></section>';

    h += '<section><h4>Save</h4><div class="dbg-row">' +
      btn('save-now', 'Save now') +
      btn('save-wipe', 'Wipe save') +
      btn('save-dump', 'Dump JSON') +
      '</div></section>';

    h += '<section><h4>Quick tests</h4><div class="dbg-row">' +
      btn('planet-play', 'Planet + body') +
      btn('first-crystal', '1st crystal') +
      btn('embark-best', 'Best body') +
      btn('disembark', 'Leave body') +
      btn('survey-maxed', 'Survey maxed') +
      btn('max-gnosis', 'Max gnosis') +
      btn('open-seed', 'Open seed') +
      btn('time-10m', '+10 min') +
      btn('time-1h', '+1 hour') +
      '</div></section>';

    h += '<section><h4>Bodies</h4><div class="dbg-row">';
    for (const a of RS.vessel.ARCHETYPES) {
      if (a.id === 'mote') continue;
      h += btn('embark', a.name.slice(0, 5), a.id);
    }
    h += btn('disembark', 'Off', '_off') + '</div></section>';

    h += '<section><h4>Hunt pin</h4><div class="dbg-row">';
    for (const e of RS.fractal.ESSENCES) h += btn('pin-hunt', e.glyph + ' ' + e.name.slice(0, 4), e.id);
    h += '</div></section>';

    h += '<section><h4>Planet</h4><div class="dbg-row">' +
      btn('teleport', 'Eq 0,0', '0,0') +
      btn('teleport', 'N pole', '0,88') +
      btn('teleport', 'S pole', '0,-88') +
      btn('teleport', 'Antimeridian', '179,10') +
      btn('cam', 'Globe', 'globe') +
      btn('cam', 'Cam auto', 'auto') +
      btn('dump-underfoot', 'Dump underfoot') +
      '</div></section>';

    h += '<section><h4>Gate</h4><div class="dbg-row">' +
      btn('debug-on', 'Persist ON') +
      btn('debug-off', 'Persist OFF') +
      '</div></section>';

    h += '<p class="dbg-hint">Topbar <kbd>⚙</kbd> or <kbd>`</kbd> · localhost / ?debug=1 / localStorage</p>';
    return h;
  }

  RS.debug = {
    enabled, run, panelHTML, statusLine, SCENE_JUMPS,
    grantInsight, maxDials, maxStrike, unlockAll, unlockAllResearch,
    jumpScene, snapPhi, ensureReach, teleport, setCam, dumpUnderfoot,
    persistDebug, skipTime, planetPlayground, fillGnosis, forceOpenSeed
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
