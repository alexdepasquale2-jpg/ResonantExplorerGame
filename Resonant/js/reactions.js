/* Resonant — reactions. One place where "something happened" becomes
 * "the player felt it".
 *
 * Every other module emits plain events and knows nothing about presentation.
 * All the shake, sound, haptics and text live here, which means the answer to
 * "why did that feel flat?" is always in one file, and adding a channel to an
 * event never means touching the simulation.
 *
 * The scaling discipline that keeps this from turning into noise: feedback
 * strength is proportional to how *rare* the event is, not how often it fires.
 * A detent tick happens thirty times a second and gets a 6 ms haptic pulse and
 * a click. A first contact with a new reality layer happens maybe twelve times
 * in the whole game and gets everything the engine has. Anything in between is
 * scaled between those poles.
 */
(function (RS) {
  'use strict';

  function wire(game, bus) {
    // ── dial handling ────────────────────────────────────────────────────
    bus.on('dial:tick', ({ dial, ticks, speed, fine }) => {
      const def = RS.dials.defOf(dial.id);
      /* Pitch the click by which dial it is, so a player working two dials at
       * once can hear which one they are moving without looking. */
      const pitch = RS.dials.DEFS.indexOf(def) / 3;
      const strength = fine ? 0.45 : Math.min(1, 0.5 + ticks * 0.25);
      RS.audio.click(strength, pitch);
      RS.feel.FX.dialTick(strength, def.hue);
    });

    bus.on('dial:seat', ({ dial, detent }) => {
      const def = RS.dials.defOf(dial.id);
      const pitch = RS.dials.DEFS.indexOf(def) / 3;
      RS.audio.seat(pitch);
      RS.feel.FX.dialSeat(def.hue);
      if (detent.label) {
        RS.ui.toast({ kind: 'seat', icon: def.symbol, title: detent.label, hue: def.hue, ms: 1400 });
      }
    });

    bus.on('dial:fine', ({ dial }) => {
      const def = RS.dials.defOf(dial.id);
      RS.audio.seat(0.8);
      RS.feel.buzz('seat');
      RS.ui.toast({
        kind: 'info', icon: def.symbol, hue: def.hue, ms: 1600,
        title: def.name + (dial.fine ? ' — FINE' : ' — COARSE'),
        body: dial.fine ? 'Travel divided by ' + RS.dials.fineRatio(dial).toFixed(0) + '×' : null
      });
    });

    bus.on('dial:jump', ({ dial }) => {
      RS.audio.seat(0.3);
      RS.feel.aberrate(2);
    });

    bus.on('input:outofreach', () => {
      RS.audio.deny();
      RS.feel.FX.deny();
      RS.ui.toast({
        kind: 'warn', icon: '⊘', title: 'Beyond your reach',
        body: 'Buy φ RANGE to extend the dial.', ms: 2400
      });
    });

    // ── the hold ─────────────────────────────────────────────────────────
    bus.on('node:step', ({ node, mark }) => {
      RS.audio.step(mark, node.man.bandIndex);
      RS.feel.FX.coherenceStep(node.x, node.y, mark, node.man.hue);
    });

    bus.on('node:crystallise', ({ node, amount, man, recognition }) => {
      const first = game.stats.crystals === 1;
      RS.audio.crystal(man.bandIndex, man.rarity, man.potency);
      if (first) {
        /* The first lock is the loudest event in the game. Later crystals
         * stay quieter so this one remains the lesson. */
        RS.audio.discover(1.5);
        RS.feel.FX.discovery(man.hue, 1.35);
        RS.feel.FX.crystallise(node.x, node.y, man.hue, Math.max(2, man.rarity), amount);
        RS.ui.toast({
          kind: 'major', icon: man.glyph, hue: man.hue, ms: 5200,
          title: 'You just held a layer',
          body: '+' + RS.core.fmt(amount) + ' Ψ. Swing wide of a knob for fine control.'
        });
      } else {
        RS.feel.FX.crystallise(node.x, node.y, man.hue, man.rarity, amount);
        if (man.rarity >= 2) {
          RS.ui.toast({
            kind: 'rare', icon: man.glyph, hue: man.hue, ms: 3000,
            title: man.name, body: '★'.repeat(man.rarity) + ' · ' + RS.core.fmt(amount) + ' Ψ'
          });
        }
      }
    });

    // ── discovery: the loud end of the scale ─────────────────────────────
    bus.on('discover:band', ({ band }) => {
      /* Reaching a new layer for the first time is the biggest thing that
       * happens in this game and it gets treated that way. */
      RS.audio.discover(1.4);
      RS.feel.FX.discovery(band.hue, 1.25);
      RS.ui.toast({
        kind: 'major', icon: band.glyph, hue: band.hue, ms: 6000,
        title: band.name.toUpperCase() + ' LAYER HELD',
        body: band.blurb + ' — ' + band.rules
      });
    });

    bus.on('discover:tier', ({ tier }) => {
      RS.audio.discover(1.1);
      RS.feel.FX.discovery(tier.hue, 1.1);
      RS.ui.toast({
        kind: 'major', icon: '◈', hue: tier.hue, ms: 6000,
        title: tier.name.toUpperCase() + (tier.root ? ' · ROOT' : ''),
        body: tier.sci
      });
    });

    bus.on('discover:gnosis', ({ essence, level, man }) => {
      /* Recognising the same essence in a new context is the fractal payoff —
       * the moment the premise clicks. Named explicitly so it cannot be
       * mistaken for an ordinary payout. */
      RS.audio.discover(0.6 + level * 0.1);
      RS.feel.FX.discovery(man.hue, 0.55 + Math.min(0.5, level * 0.08));
      RS.ui.toast({
        kind: 'gnosis', icon: essence.glyph, hue: man.hue, ms: 5000,
        title: essence.name.toUpperCase() + ' — recognised again',
        body: 'Seen here as ' + man.name + '. Same essence, ' + level + ' context' +
          (level === 1 ? '' : 's') + ' known. +' +
          ((RS.fractal.gnosisBonus(game, essence.id) - 1) * 100).toFixed(0) + '% yield everywhere.'
      });
    });

    // ── reach ────────────────────────────────────────────────────────────
    bus.on('reach:band', ({ band }) => {
      RS.ui.toast({
        kind: 'major', icon: band.glyph, hue: band.hue, ms: 5200,
        title: band.name.toUpperCase() + ' NOW IN REACH',
        body: 'Tune φ to ' + band.centre + '.' +
          (band.minFocus > RS.dials.focusOf(game.dials.frequency)
            ? ' Your focus is too broad to hold it yet.' : '')
      });
    });

    bus.on('reach:tier', ({ tier }) => {
      RS.ui.toast({ kind: 'info', icon: '◈', hue: tier.hue, ms: 4200,
        title: tier.name + ' in reach', body: tier.sci });
    });

    bus.on('reach:cohere', ({ band }) => {
      RS.audio.discover(1.0);
      RS.feel.FX.discovery(band.hue, 0.9);
      RS.ui.toast({
        kind: 'major', icon: band.glyph, hue: band.hue, ms: 5200,
        title: band.name.toUpperCase() + ' WILL NOW COHERE',
        body: 'It was always there. You are sharp enough to hold it now.'
      });
    });

    // ── reality shifting under the player ────────────────────────────────
    bus.on('field:shift', ({ tierIndex, bandIndex, big }) => {
      const hue = big ? RS.cosmos.TIERS[tierIndex].hue : RS.spectrum.BANDS[bandIndex].hue;
      RS.audio.upheaval(big ? 1.3 : 0.6);
      RS.feel.FX.upheaval(hue, big ? 1.15 : 0.5);
    });

    // ── economy ──────────────────────────────────────────────────────────
    bus.on('upgrade', ({ dial, kind, level }) => {
      const def = RS.dials.defOf(dial.id);
      RS.audio.purchase();
      RS.feel.FX.purchase(def.hue);
      RS.ui.toast({
        kind: 'buy', icon: def.symbol, hue: def.hue, ms: 2600,
        title: def.name + ' ' + kind.toUpperCase() + ' ' + RS.core.romanize(level),
        body: kind === 'range' ? 'Reach extended.'
          : kind === 'precision' ? 'Step now ' + RS.dials.tickStep(dial).toFixed(4) + '.'
            : 'Focus now ' + (RS.dials.focusOf(dial) * 100).toFixed(0) + '%.'
      });
    });

    bus.on('ui:deny', res => {
      RS.audio.deny();
      RS.feel.FX.deny();
      if (res.message) {
        RS.ui.toast({ kind: 'warn', icon: '\u26A0', title: 'Cannot do that', body: res.message, ms: 2600 });
      } else if (res.reason === 'insufficient') {
        RS.ui.toast({ kind: 'warn', icon: 'Ψ', title: 'Not enough insight',
          body: 'Needs ' + RS.core.fmt(res.cost) + ' Ψ.', ms: 2200 });
      }
    });

    // ── the solar layer ──────────────────────────────────────────────────
    bus.on('scene:change', ({ kind, from, scene }) => {
      /* Arriving in a different world is the biggest transition the game has
       * after a first-contact discovery, so it gets a full upheaval. */
      /* One table rather than a chain of ternaries: there are five scopes now
       * and more coming, and a scope that forgets to name itself here arrives
       * announcing that it is the attunement field. */
      const ARRIVAL = {
        field: { hue: 200, icon: '◉',
          title: () => 'the attunement field',
          body: () => 'Tuning again. φ selects the layer.' },
        galaxy: { hue: 190, icon: '✦',
          title: () => 'the star map',
          body: () => 'Tap a star to select it. Tap again to travel.' },
        system: { hue: 285, icon: '◇',
          title: sc => sc.system ? sc.system.name : 'a system',
          body: () => 'Unembodied: τ scrubs this system’s history. Tap a world to select it.' },
        planet: { hue: 130, icon: '●',
          title: sc => sc.planet ? sc.planet.name : 'a world',
          body: () => 'Take a body to touch this world.' },
        web: { hue: 276, icon: '⁂',
          title: sc => (RS.cosmos.BY_ID[sc.web && sc.web.tierId] || { name: 'the cosmic web' }).name,
          body: sc => sc.web
            ? 'τ is the age of the universe here. Scrub it and watch the structure assemble.'
            : 'Filaments and voids.' },
        ensemble: { hue: 210, icon: '∵',
          title: sc => 'level ' + (sc.ensemble ? sc.ensemble.family : 'I') + ' ensemble',
          body: () => 'The same system, twice. Turn Δ to stand in other laws — leaving restores ours.' },
        foam: { hue: 291, icon: '∴',
          title: () => 'quantum foam',
          body: () => 'Nothing persists here, including you. Find the pair that never cancelled — the bright, still one.' },
        molecular: { hue: 196, icon: '⌬',
          title: sc => sc.molecule && sc.molecule.bias > 0.5 ? 'homochiral chemistry' : 'racemic chemistry',
          body: sc => sc.molecule && sc.molecule.bias > 0.5
            ? 'Life here settled which hand it uses. Find one of the other.'
            : 'Both hands in equal numbers. Nothing here is choosing.' },
        shells: { hue: 210, icon: '⌸',
          title: () => 'orbital shells',
          body: () => 'No two occupants may share a state. Finite places, and they are taken.' },
        cellular: { hue: 150, icon: '❋',
          title: sc => sc.cell ? sc.cell.type.name : 'cytoplasm',
          body: sc => {
            const why = RS.cellular.reasonSterile(sc.planet);
            if (why) return 'Nothing to be inside here — ' + why + '.';
            return 'Inside ' + sc.planet.name + '. Crystallise here and the world changes — you will see it from orbit.';
          } }
      };
      const a = ARRIVAL[kind] || ARRIVAL.field;
      RS.audio.upheaval(1.4);
      RS.feel.FX.upheaval(a.hue, 1.3);
      RS.feel.vignette(0.5);
      RS.ui.toast({
        kind: 'major', icon: a.icon, hue: a.hue, ms: 4200,
        title: String(a.title(scene)).toUpperCase(),
        body: a.body(scene)
      });
    });

    /* Ejection is the Quantum Foam scope's entire introduction, so it gets a
     * real one rather than a silent state change. */
    bus.on('foam:eject', ({ arch }) => {
      RS.audio.upheaval(1.8);
      RS.feel.FX.upheaval(291, 1.6);
      RS.ui.toast({
        kind: 'major', icon: '·', hue: 291, ms: 5200, title: 'BODY LOST',
        body: 'A ' + (arch ? arch.name.toLowerCase() : 'body') +
          ' is a persistent arrangement of matter. There is no such thing here.'
      });
    });

    bus.on('ensemble:adopt', ({ block, distance }) => {
      game.stats.blocksAdopted = (game.stats.blocksAdopted || 0) + 1;
      game.stats.farthestBlock = Math.max(game.stats.farthestBlock || 0, distance);
      RS.audio.upheaval(1.2 + distance);
      RS.feel.FX.upheaval(186 + distance * 120, 1.0 + distance);
      RS.ui.toast({
        kind: 'major', icon: '∵', hue: 186 + distance * 120, ms: 5000,
        title: block.name.toUpperCase(),
        body: block.blurb + ' Everything derives from here under these constants.'
      });
    });

    /* ── Striking ─────────────────────────────────────────────────────────
     *
     * A combo only feels like anything if every rung of it is *distinct*, so
     * the pitch climbs a semitone per clean strike and resets on a break. That
     * one detail is most of why a rising count feels like a rising count rather
     * than like the same click repeated — the ear is what tracks a streak, and
     * the number is only confirming it. */
    bus.on('strike', ({ node, verdict, quality, combo }) => {
      if (verdict === 'clean') {
        /* Semitones, wrapping after two octaves so it never becomes a whistle.
         * Louder and brighter with the combo, up to a point. */
        const step = (combo - 1) % 24;
        const pitch = Math.pow(2, step / 12);
        RS.audio.click(0.42 + Math.min(0.3, combo * 0.012), 1.4 * pitch);
        RS.feel.FX.strike(node, quality, combo);
        RS.feel.shake(0.10 + Math.min(0.22, combo * 0.006));
        RS.feel.buzz('step');
      } else if (verdict === 'held') {
        RS.audio.click(0.22, 0.85);
        RS.feel.FX.strike(node, quality, 0);
      } else if (verdict === 'broke') {
        /* A break is a downward sound, not a buzzer. It has to read as "that
         * one was loose" rather than as a penalty, or a player stops striking
         * in exactly the layers where striking is worth most. */
        RS.audio.click(0.30, 0.42);
        RS.feel.FX.strikeBreak(node);
        RS.feel.buzz('deny');
      }
    });

    /* Letting a combo lapse is quieter than breaking one — you did not do
     * anything wrong, you just stopped. */
    bus.on('strike:lapse', ({ lost }) => {
      if (lost >= 8) {
        RS.audio.click(0.20, 0.5);
        RS.ui.toast({ kind: 'info', icon: '◈', hue: 320, ms: 2200,
          title: 'Combo lapsed at ' + lost });
      }
    });

    bus.on('strike:upgrade', ({ id }) => {
      RS.audio.purchase();
      RS.feel.FX.discovery(320, 0.7);
    });

    bus.on('discover:system', ({ system }) => {
      game.stats.systemsSeen++;
      RS.audio.discover(1.2);
      RS.feel.FX.discovery(system.primary.cls.hue, 1.0);
      RS.ui.toast({
        kind: 'major', icon: '◉', hue: system.primary.cls.hue, ms: 6000,
        title: system.name.toUpperCase(),
        body: system.primary.cls.c + system.primary.sub + ' ' + system.primary.cls.name +
          ' · ' + system.bodies.length + ' bodies · habitable zone ' +
          system.hz.inner.toFixed(2) + '–' + system.hz.outer.toFixed(2) + ' AU'
      });
    });

    bus.on('discover:planet', ({ planet }) => {
      game.stats.worldsSeen++;
      /* Feedback scales with what was actually found. A barren rock is a
       * footnote; a living world is an event; an inhabited one stops the
       * screen. That ordering is the whole reward structure of exploring. */
      const civ = RS.civ.civOf(planet, game.scene.tGyr);
      const magnitude = civ ? 1.5 : planet.biosphere ? 1.0 : 0.35;
      RS.audio.discover(magnitude);
      RS.feel.FX.discovery(planet.type.hue, magnitude);
      RS.ui.toast({
        kind: civ || planet.biosphere ? 'major' : 'info',
        icon: '●', hue: planet.type.hue, ms: civ ? 7000 : 4000,
        title: planet.name + ' — ' + planet.type.name,
        body: (civ ? 'INHABITED: ' + civ.name + ', ' + civ.tier.name + '. '
          : planet.biosphere ? 'Life: ' + planet.biosphere.stage.name + '. ' : '') +
          Math.round(planet.surfaceTemp) + ' K · ' + planet.gravity.toFixed(2) + ' g · ' +
          (planet.pressure < 0.01 ? 'no atmosphere' : planet.pressure.toFixed(2) + ' bar')
      });
    });

    bus.on('vessel:embark', ({ arch }) => {
      RS.audio.purchase();
      RS.feel.FX.purchase(arch.hue);
      RS.feel.punch(0.09);
      const dm = arch.dialMap;
      RS.ui.toast({
        kind: 'major', icon: arch.glyph, hue: arch.hue, ms: 5200,
        title: arch.name.toUpperCase() + ' — INHABITED',
        body: 'τ ' + dm.time + ' · Σ ' + dm.space + ' · Δ ' + dm.phase +
          ' · φ ' + dm.frequency + '. Drag the world to shove.'
      });
      if (game.scene.kind === 'planet' && !game.flags.cameraHint) {
        game.flags.cameraHint = true;
        RS.ui.toast({
          kind: 'info', icon: '◎', hue: 200, ms: 4200,
          title: 'On the globe',
          body: 'You never leave the planet picture. Σ frames height. Tap the ground to survey.'
        });
      }
    });

    bus.on('vessel:disembark', ({ arch }) => {
      RS.audio.seat(0.2);
      RS.feel.FX.upheaval(200, 0.6);
      RS.ui.toast({ kind: 'info', icon: '·', ms: 2600,
        title: 'Unembodied',
        body: 'τ scrubs time again. Σ moves the scale ladder.' });
    });

    bus.on('vessel:blocked', ({ reason, arch }) => {
      RS.audio.deny();
      RS.feel.FX.deny();
      RS.ui.toast({ kind: 'warn', icon: '⚠', ms: 3600,
        title: arch.name + ' cannot work here', body: reason });
    });

    bus.on('vessel:lost', ({ arch }) => {
      RS.audio.upheaval(1.6);
      RS.feel.shake(0.45);
      RS.feel.FX.deny();
      RS.ui.toast({ kind: 'warn', icon: '⚠', ms: 5000,
        title: arch.name + ' lost',
        body: 'Charge exhausted under strain. The body is gone; you are not.' });
    });

    bus.on('research', ({ node }) => {
      RS.audio.discover(1.1);
      RS.feel.FX.discovery(node.hue, 0.95);
      const v = (node.unlocks.vessels || []).map(id => RS.vessel.BY_ID[id].name);
      const st = (node.unlocks.structures || []).map(id => RS.influence.STRUCT_BY_ID[id].name);
      RS.ui.toast({
        kind: 'major', icon: '◈', hue: node.hue, ms: 5200,
        title: node.name.toUpperCase() + ' RESEARCHED',
        body: [v.length ? 'Bodies: ' + v.join(', ') : null,
          st.length ? 'Structures: ' + st.join(', ') : null].filter(Boolean).join(' · ') || node.blurb
      });
    });

    bus.on('structure:place', ({ planet, struct }) => {
      RS.audio.purchase();
      RS.feel.FX.purchase(struct.hue);
      RS.ui.toast({
        kind: 'major', icon: struct.glyph, hue: struct.hue, ms: 5200,
        title: struct.name.toUpperCase() + ' SITED',
        body: struct.effect + ' It matures over time — come back and see what it did.'
      });
    });

    bus.on('extract', ({ id, amount, planet }) => {
      const c = RS.civ.COMM_BY_ID[id];
      RS.audio.crystal(2, 1, amount);
      RS.feel.FX.crystallise(0, 0.2, c ? c.hue : 40, 0, amount);
      RS.ui.toast({ kind: 'buy', icon: '⊞', hue: c ? c.hue : 40, ms: 2200,
        title: 'Extracted ' + RS.core.fmt(amount) + ' ' + (c ? c.name : id) });
    });

    bus.on('place:pulse', ({ amount, first, extracted, biome, seam }) => {
      RS.audio.click(0.4 + Math.min(0.5, amount / 12), 0.55);
      RS.feel.buzz('tick');
      /* Frequent pulses stay a click. The first read of a world names the
       * patch — biome and seam — so the tap is a survey, not a farm. */
      if (first && !extracted) {
        const where = biome && biome.name ? biome.name : 'this patch';
        RS.ui.toast({
          kind: 'info', icon: '◎', hue: 42, ms: 2400,
          title: where,
          body: (seam ? seam + ' underfoot. ' : '') + '+' + RS.core.fmt(amount) + ' Ψ'
        });
      }
    });

    bus.on('sell', ({ total, civ }) => {
      RS.audio.purchase();
      RS.feel.FX.crystallise(0, 0, 45, 2, total);
      RS.ui.toast({ kind: 'buy', icon: 'Ψ', hue: 45, ms: 3000,
        title: 'Sold to ' + civ.name,
        body: '+' + RS.core.fmt(total) + ' Ψ at local prices.' });
    });

    bus.on('scene:aim', () => { RS.audio.click(0.6, 0.4); RS.feel.buzz('tick'); });

    // ── the galactic map ─────────────────────────────────────────────────
    bus.on('galaxy:target', ({ star }) => {
      RS.audio.seat(0.5);
      const sv = RS.galaxy.surveyOf(game, star);
      RS.ui.toast({
        kind: 'info', icon: '◉', hue: star.star.cls.hue, ms: 3200,
        title: star.name + ' — ' + star.dist.toFixed(1) + ' ly',
        body: sv
          ? star.star.cls.c + star.star.sub + ' · ' + sv.planets + ' planets' +
            (sv.civ ? ' · INHABITED' : sv.life ? ' · life' : '') + '. Tap again to travel.'
          : 'Unresolved at this distance. Tap again to travel.'
      });
    });

    bus.on('galaxy:travel', ({ star }) => {
      RS.audio.discover(1.0);
      RS.feel.FX.discovery(star.star.cls.hue, 0.9);
      RS.ui.toast({
        kind: 'major', icon: '◈', hue: star.star.cls.hue, ms: 4200,
        title: 'ARRIVED — ' + star.name,
        body: 'Turn Σ inward to enter the system.'
      });
    });

    bus.on('galaxy:drift', ({ sx, sy, star }) => {
      RS.audio.seat(0.35);
      RS.ui.toast({
        kind: 'info', icon: '◇', hue: 190, ms: 1400,
        title: star ? star.name : ('Sector ' + sx + ', ' + sy),
        body: star ? 'In reach — turn Σ inward to enter.' : 'Vacuum. Keep burning.'
      });
    });

    // ── contact ──────────────────────────────────────────────────────────
    bus.on('discover:civ', ({ star }) => {
      RS.audio.discover(1.35);
      RS.feel.FX.discovery(45, 1.2);
      RS.ui.toast({
        kind: 'major', icon: '◍', hue: 45, ms: 7000,
        title: 'SOMEONE IS HERE — ' + star.name.toUpperCase(),
        body: 'An amber ring. Civilisations are rare. Tap it, then turn Σ inward and tune to their carrier.'
      });
    });

    bus.on('contact:warming', ({ planet, civ, stage }) => {
      RS.audio.seat(0.25 + stage * 0.12);
      RS.feel.vignette(0.22 + stage * 0.12);
      RS.ui.toast({
        kind: 'info', icon: '◉', hue: civ.disposition.hue, ms: 3200,
        title: stage === 1 ? 'A stirring' : 'They are beginning to notice',
        body: civ.name + ' on ' + planet.name +
          (stage === 1 ? ' has not seen you yet.' : ' is warming toward awareness. Hold the carrier.')
      });
    });

    bus.on('contact:detected', ({ planet, civ }) => {
      /* They noticed you first. This is deliberately unsettling and it is the
       * only event in the game where something else acts on you. */
      RS.audio.discover(0.8);
      RS.feel.FX.discovery(civ.disposition.hue, 0.7);
      RS.feel.vignette(0.6);
      const carrier = RS.contact.carrierOf(game, planet, civ);
      RS.ui.toast({
        kind: 'major', icon: '◉', hue: civ.disposition.hue, ms: 7000,
        title: 'SOMETHING HAS NOTICED YOU',
        body: civ.name + ' on ' + planet.name + ' is aware of you. They broadcast on the ' +
          carrier.band.name + ' layer at φ' + carrier.phi.toFixed(1) + '. Tune to it.'
      });
    });

    bus.on('contact:open', ({ planet, civ, first }) => {
      game.stats.contacts = (game.stats.contacts || 0) + (first ? 1 : 0);
      /* First contact is the biggest single moment the game has. */
      RS.audio.discover(first ? 1.6 : 0.9);
      RS.feel.FX.discovery(civ.disposition.hue, first ? 1.4 : 0.8);
      if (first) { RS.feel.hitstop(0.08); RS.feel.vignette(0.85); }
      RS.ui.toast({
        kind: 'major', icon: '◉', hue: civ.disposition.hue, ms: first ? 9000 : 4000,
        title: first ? 'FIRST CONTACT — ' + civ.name.toUpperCase() : 'CHANNEL OPEN — ' + civ.name,
        body: first
          ? civ.tier.name + ' · ' + civ.disposition.name + ' · ' + RS.core.fmt(civ.population) +
            ' minds. Open the ◉ panel to speak with them.'
          : 'Hold the carrier and open the ◉ panel.'
      });
    });

    bus.on('contact:listen', ({ civ, essence, fresh, level, insight }) => {
      RS.audio.crystal(RS.spectrum.BY_ID.noetic.index, fresh ? 2 : 0, 4);
      RS.feel.FX.crystallise(0, 0, civ.disposition.hue, fresh ? 2 : 0, insight);
      RS.ui.toast({
        kind: fresh ? 'gnosis' : 'info', icon: essence.glyph, hue: civ.disposition.hue,
        ms: fresh ? 5200 : 2800,
        title: fresh ? essence.name.toUpperCase() + ' — through their eyes'
          : 'They speak of ' + essence.name.toLowerCase(),
        body: (fresh ? 'A mind that is not yours recognising the same essence. Gnosis ' + level + '. ' : '') +
          '+' + RS.core.fmt(insight) + ' Ψ'
      });
    });

    bus.on('contact:survey', ({ civ, revealed, radius }) => {
      RS.audio.discover(1.2);
      RS.feel.FX.discovery(45, 1.0);
      RS.ui.toast({
        kind: 'major', icon: '◈', hue: 45, ms: 6000,
        title: 'THEY GAVE YOU THEIR CHARTS',
        body: revealed + ' stars within ' + (radius * RS.galaxy.LY_PER_SECTOR) +
          ' ly are now resolved on your map, regardless of your own field. ' +
          'Turn Σ out to the cluster tier to see them.'
      });
    });

    bus.on('contact:trade', ({ civ, total }) => {
      RS.audio.purchase();
      RS.feel.FX.crystallise(0, 0, 45, 1, total);
      RS.ui.toast({ kind: 'buy', icon: 'Ψ', hue: 45, ms: 3000,
        title: 'Traded with ' + civ.name, body: '+' + RS.core.fmt(total) + ' Ψ' });
    });

    bus.on('contact:gift', ({ civ, cost, standing }) => {
      RS.audio.purchase();
      RS.feel.FX.purchase(civ.disposition.hue);
      RS.ui.toast({ kind: 'info', icon: '◇', hue: civ.disposition.hue, ms: 3200,
        title: 'Given freely',
        body: '−' + RS.core.fmt(cost) + ' Ψ. Standing now ' +
          (standing >= 0 ? '+' : '') + standing.toFixed(2) + '.' });
    });

    bus.on('contact:taught', ({ civ, node }) => {
      RS.audio.discover(1.4);
      RS.feel.FX.discovery(node.hue, 1.2);
      RS.ui.toast({
        kind: 'major', icon: '◈', hue: node.hue, ms: 6500,
        title: civ.name.toUpperCase() + ' TAUGHT YOU ' + node.name.toUpperCase(),
        body: node.blurb + ' It cost them something to give, and their standing reflects that.'
      });
    });

    bus.on('contact:uplift', ({ civ, welcomed, standing }) => {
      RS.audio.discover(welcomed ? 1.3 : 0.5);
      RS.feel.FX.discovery(welcomed ? 120 : 0, 1.1);
      RS.ui.toast({
        kind: welcomed ? 'major' : 'warn', icon: '⌘', hue: welcomed ? 120 : 0, ms: 6500,
        title: welcomed ? 'THEY TOOK IT' : 'THEY RESENT IT',
        body: welcomed
          ? civ.disposition.name + ' — they absorbed the lattice and asked for more. Standing ' +
            (standing >= 0 ? '+' : '') + standing.toFixed(2) + '.'
          : civ.disposition.name + ' — they did not ask to be raised, and they know who did it. ' +
            'Standing ' + standing.toFixed(2) + '.'
      });
    });

    bus.on('contact:withdraw', ({ civ }) => {
      RS.audio.seat(0.2);
      RS.ui.toast({ kind: 'info', icon: '·', ms: 2400,
        title: 'Channel closed', body: 'You broke the carrier on ' + civ.name + '.' });
    });

    bus.on('contact:station', ({ planet }) => {
      RS.audio.discover(0.7);
      RS.feel.FX.discovery(320, 0.7);
      RS.ui.toast({
        kind: 'info', icon: '◈', hue: 320, ms: 4200,
        title: 'PROBE STATIONED',
        body: 'A sensor remains at ' + planet.name +
          '. Hold their carrier from anywhere and the channel stays open.'
      });
    });

    bus.on('seed:open', ({ from, to }) => {
      RS.audio.discover(1.6);
      RS.feel.FX.discovery(186, 1.4);
      RS.ui.toast({
        kind: 'major', icon: '✦', hue: 186, ms: 6400,
        title: 'ANOTHER SEED',
        body: 'The essences did not care. The galaxy did. Understanding kept; places reset.'
      });
    });

    bus.on('hunt:pin', ({ essence }) => {
      RS.audio.seat(0.5);
      RS.ui.toast({
        kind: 'info', icon: essence.glyph, hue: 200, ms: 2800,
        title: essence.name,
        body: 'The objective will name this hunt. Insight cannot buy it.'
      });
    });

    bus.on('settings', ({ key, value }) => {
      if (key === 'audio') RS.audio.setEnabled(value);
      if (key === 'haptics') RS.feel.setHaptics(value);
      if (key === 'reduceMotion') RS.feel.setReduceMotion(value);
      if (key === 'notify') RS.ui.setNotifyLevel(value);
      if (key === 'bloom' && RS.bloom) RS.bloom.setEnabled(value);
    });
  }

  RS.reactions = { wire };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
