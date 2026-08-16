/* Resonant — persistence.
 *
 * The save file is small on purpose, and the reason is the premise: nothing in
 * the field is ever stored. Manifestations are derived from their addresses
 * (fractal.js), so a save needs the world seed, where the dials are, what has
 * been *understood*, and how far each address stream has advanced. Reload and
 * the same reality re-derives itself around you, node for node.
 *
 * That is worth being explicit about because it is the difference between a
 * save that grows without bound and one that stays a couple of kilobytes after
 * a hundred hours.
 */
(function (RS) {
  'use strict';

  const KEY = 'resonant.save.v1';
  const PERIODIC_MS = 12000;

  function hasSave() {
    try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
  }

  function readRaw() {
    try {
      const s = localStorage.getItem(KEY);
      if (!s) return null;
      const data = JSON.parse(s);
      if (!data || data.version !== RS.game.SAVE_VERSION) return null;
      return data;
    } catch (e) {
      console.warn('[resonant] save unreadable, starting fresh', e);
      return null;
    }
  }

  function serialise(game) {
    const dials = Object.create(null);
    for (const id in game.dials) {
      const d = game.dials[id];
      dials[id] = { v: d.value, lv: [d.levels.range, d.levels.precision, d.levels.focus], fine: d.fine };
    }
    return {
      version: RS.game.SAVE_VERSION,
      seed: game.seed,
      createdAt: game.createdAt,
      savedAt: Date.now(),
      dials,
      insight: game.insight,
      lifetimeInsight: game.lifetimeInsight,
      known: game.known,
      gnosis: game.gnosis,
      stats: game.stats,
      streams: game.field.streams,
      settings: game.settings,
      flags: game.flags,
      /* ── the embodied half ────────────────────────────────────────────
       * Still tiny, because none of it describes a world. `deltas` is the
       * only record of anything the player changed, and it is a handful of
       * numbers per structure. A thousand visited systems is a list of
       * addresses. */
      research: game.research,
      /* Strike upgrade levels and the best combo. The live combo is not saved:
       * a streak you were not present for is not a streak. */
      strikeLevels: game.strikeLevels,
      bestCombo: game.strike ? game.strike.best : 0,
      vessels: game.vessels.unlocked,
      structuresUnlocked: game.structuresUnlocked,
      deltas: game.deltas,
      senseBonus: game.senseBonus,
      /* Relationships and galactic position. Both are addresses and small
       * numbers — the civilisations and the stars themselves re-derive. */
      contacts: game.contacts,
      surveys: game.surveys,
      galaxy: { sx: game.galaxy.sx, sy: game.galaxy.sy },
      scene: {
        kind: game.scene.kind,
        systemAddr: game.scene.systemAddr,
        bodyIndex: game.scene.bodyIndex,
        t: game.scene.t,
        lon: game.scene.lon,
        lat: game.scene.lat
      },
      body: game.inhabiting ? {
        archId: game.body.archId,
        charge: game.body.charge,
        strain: game.body.strain,
        hold: game.body.hold,
        holdMass: game.body.holdMass
      } : null
    };
  }

  function writeNow(game) {
    try {
      localStorage.setItem(KEY, JSON.stringify(serialise(game)));
      return true;
    } catch (e) {
      /* Quota or private mode. Not fatal — the game is still playable, the
       * player just loses the session, so say so once rather than throwing. */
      console.warn('[resonant] could not save', e);
      return false;
    }
  }

  function hydrate(data) {
    const game = RS.game.newGame(data.seed);
    game.createdAt = data.createdAt || Date.now();
    game.insight = data.insight || 0;
    game.lifetimeInsight = data.lifetimeInsight || 0;
    game.known = data.known || game.known;
    game.gnosis = data.gnosis || Object.create(null);
    game.stats = Object.assign(game.stats, data.stats || {});
    game.settings = Object.assign(game.settings, data.settings || {});
    game.flags = data.flags || Object.create(null);
    game.field.streams = data.streams || Object.create(null);

    for (const id in data.dials) {
      const d = game.dials[id];
      if (!d) continue;
      const s = data.dials[id];
      d.levels.range = s.lv[0] | 0;
      d.levels.precision = s.lv[1] | 0;
      d.levels.focus = s.lv[2] | 0;
      d.fine = !!s.fine;
    }
    /* Reach must be recomputed from levels *before* values are restored, or a
     * saved value outside the default reach gets clamped away. */
    RS.dials.refreshReach(game.dials);
    for (const id in data.dials) {
      const d = game.dials[id];
      if (!d) continue;
      RS.dials.setValue(game, d, data.dials[id].v);
      d.shown.snap(d.value);
    }

    /* ── the embodied half ──────────────────────────────────────────────
     * Restored before fields are recomputed, since fields are derived from
     * research and structures. */
    game.research = data.research || Object.create(null);
    game.strikeLevels = data.strikeLevels || Object.create(null);
    if (game.strike) game.strike.best = data.bestCombo || 0;
    game.vessels.unlocked = data.vessels || { mote: true };
    game.vessels.unlocked.mote = true;          // never lose the bare point
    game.structuresUnlocked = data.structuresUnlocked || Object.create(null);
    game.deltas = data.deltas || Object.create(null);
    game.senseBonus = data.senseBonus || 0;
    game.contacts = data.contacts || Object.create(null);
    game.surveys = data.surveys || Object.create(null);
    if (data.galaxy) {
      game.galaxy.sx = data.galaxy.sx || 0;
      game.galaxy.sy = data.galaxy.sy || 0;
      game.galaxy.cacheKey = '';
    }
    RS.influence.recomputeFields(game);

    if (data.scene) {
      const sc = game.scene;
      sc.t = data.scene.t || 0;
      sc.tGyr = sc.t * 1e-9;
      sc.lon = data.scene.lon || 0;
      sc.lat = data.scene.lat || 0;
      /* The system is re-derived from its address rather than loaded — this is
       * the payoff of deriving everything: a saved location is three integers
       * and the whole system comes back identical. */
      if (data.scene.systemAddr) {
        const a = data.scene.systemAddr;
        sc.systemAddr = a;
        sc.system = RS.stellar.systemAt(game.seed, a.sx, a.sy, a.index);
        if (data.scene.bodyIndex >= 0 && sc.system.bodies[data.scene.bodyIndex]) {
          sc.selected = data.scene.bodyIndex;
          sc.bodyIndex = data.scene.bodyIndex;
          sc.planet = RS.scenes.derivePlanet(game, sc.system, sc.bodyIndex);
        }
      }
      /* The scene kind itself is re-derived from the Σ dial on the first tick,
       * so it is not restored directly — the dial is the source of truth. */
    }

    if (data.body && data.body.archId && data.body.archId !== 'mote') {
      game.body = RS.vessel.newBody(data.body.archId);
      game.body.charge = data.body.charge || 0;
      game.body.strain = data.body.strain || 0;
      game.body.hold = data.body.hold || Object.create(null);
      game.body.holdMass = data.body.holdMass || 0;
      game.inhabiting = true;
    }

    RS.field.updateDerived(game);
    game.__lastInsight = game.insight;

    const away = Math.max(0, (Date.now() - (data.savedAt || Date.now())) / 1000);
    game.__offline = RS.field.applyOffline(game, away);
    return game;
  }

  function wipe() {
    try { localStorage.removeItem(KEY); } catch (e) { /* nothing to do */ }
  }

  RS.save = { KEY, PERIODIC_MS, hasSave, readRaw, serialise, writeNow, hydrate, wipe };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
