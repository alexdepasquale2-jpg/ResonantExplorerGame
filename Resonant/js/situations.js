/* Resonant — live situations. Derived hooks from this seed and this state.
 *
 * Not a quest log. Nothing here is authored as a beat. Each hook is a reading
 * of something the simulation is already doing: a ghost band in reach, a
 * hunted essence in the field, a filament assembling, a culture warming.
 * `nextObjective` may name one. Insight cannot buy any of them.
 */
(function (RS) {
  'use strict';

  function huntHere(game) {
    const nodes = game.field && game.field.nodes;
    if (!nodes || !nodes.length) return null;
    let ess = null;
    if (game.flags && game.flags.huntEssence) {
      ess = RS.fractal.ESSENCE_BY_ID[game.flags.huntEssence];
    }
    if (!ess && RS.guide && RS.guide.foresight) {
      const fs = RS.guide.foresight(game);
      if (fs && fs.nearest && RS.fractal.gnosisOf(game, fs.nearest.id) >= 2) ess = fs.nearest;
    }
    if (!ess) return null;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.dying || n.crystallised) continue;
      if (n.man && n.man.essence && n.man.essence.id === ess.id) {
        return { kind: 'hunt-here', essence: ess, node: n,
          text: ess.name + ' is in this field — hold the one you already know.' };
      }
    }
    return null;
  }

  function live(game) {
    const out = [];
    const D = game.dials;
    const foc = RS.dials.focusOf(D.frequency);

    const here = huntHere(game);
    if (here) out.push(here);

    for (let i = 0; i < RS.spectrum.BANDS.length; i++) {
      const b = RS.spectrum.BANDS[i];
      if (b.centre > D.frequency.max) continue;
      if (!RS.spectrum.isGhost(b, foc)) continue;
      if (game.known.bands[b.id]) continue;
      out.push({
        kind: 'ghost', band: b,
        text: 'The ' + b.name + ' layer is in reach but will not cohere. Buy φ FOCUS.'
      });
      break;
    }

    const s = game.scene;
    if (s && s.kind === 'web' && s.web && s.web.assembling > 0.25) {
      out.push({
        kind: 'assemble',
        text: 'A filament is assembling *now*. Present day is the wrong time — work it while it grows.'
      });
    }

    if (s && s.planet) {
      const rec = game.contacts && RS.influence && RS.influence.planetKey
        ? game.contacts[RS.influence.planetKey(s.planet)] : null;
      if (rec && rec.awareness >= 0.12 && rec.awareness < 0.35 && !rec.met) {
        const civ = s.planet.civ || (RS.civ && RS.civ.civOf(s.planet, s.tGyr));
        out.push({
          kind: 'warming',
          text: (civ ? civ.name : 'Someone') + ' has noticed you. Stay. Tune their carrier.'
        });
      }
    }

    if (s && s.kind === 'molecular' && RS.molecular) {
      const r = RS.molecular.readout(game);
      if (r && r.anomalous) {
        out.push({
          kind: 'chirality',
          text: r.anomalous + ' of the wrong hand — the warm ones. That is the find.'
        });
      }
    }

    return out.slice(0, 3);
  }

  RS.situations = { live, huntHere };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
