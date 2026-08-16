/* Resonant — vessels, and what it means to inhabit one.
 *
 * ── The ergonomic thesis ──────────────────────────────────────────────────
 *
 * The player already has a complete control surface: four continuous dials
 * they have spent the whole game learning to use with two thumbs. The
 * temptation when adding walking, flying, driving and orbiting is to bolt a
 * virtual stick and four buttons onto the screen for each one. That would be
 * five separate control schemes to learn, none of them as good as the one
 * already there.
 *
 * So instead: **the dials are the vessel's controls, reinterpreted per body.**
 * Every vessel declares a `dialMap` naming what τ, Σ, Δ and φ mean while you
 * are inside it. A walker's Σ is stance height; a flier's Σ is altitude; a
 * courier's Σ is orbital radius. τ is always "rate of your own action" — gait
 * frequency, throttle, burn rate. Δ is always heading. φ is always what you
 * are sensing with.
 *
 * The payoff is that the *muscle memory transfers completely* while the
 * *meaning changes entirely*. A player who has learned to walk Δ in with one
 * thumb while holding τ steady already knows how to fly. And because the axes
 * are continuous and composable rather than discrete buttons, the space of
 * things you can do with them is much larger than the space anyone designed —
 * gaits, glides, skips, hovers and stalls all fall out of combinations nobody
 * enumerated.
 *
 * ── Forces ────────────────────────────────────────────────────────────────
 *
 * One body is integrated per frame — the player's. Everything else in the
 * world stays analytic. Integrating a single vessel costs nothing and buys
 * responsive, physical control, which is exactly the trade you want: analytic
 * where it buys scale, integrated where it buys feel.
 *
 * The forces are real and they read off the planet's derived physics, so
 * flying on a thin-atmosphere world genuinely does not work, and a high-gravity
 * world genuinely is exhausting. The player learns planetary physics by being
 * subject to it rather than by reading it off a panel.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, damp, TAU, hashF, hashN } = RS.core;

  /* Medium determines which force terms are live at all. */
  /* CYTOPLASM is not just "liquid, but smaller". At a few microns the Reynolds
   * number is about 1e-4, which means inertia does not exist: stop pushing and
   * you stop, instantly, in less than your own diameter. A stroke that is the
   * reverse of itself returns you exactly where you started (Purcell's scallop
   * theorem), so the swimmer body that works in an ocean is genuinely useless
   * in here. Giving it its own medium is what lets the vessel predicates say
   * so honestly instead of pretending an ocean and a cell are the same place. */
  const MEDIUM = {
    VACUUM: 'vacuum', GAS: 'gas', LIQUID: 'liquid',
    SURFACE: 'surface', ORBIT: 'orbit', CYTOPLASM: 'cytoplasm',
    FOAM: 'foam'
  };

  /* ── Archetypes ───────────────────────────────────────────────────────────
   * `needs` is a predicate on the environment, and it is what makes vessel
   * choice a real decision: bring the wrong body to a world and it simply does
   * not function. The failure is legible — the HUD names the missing
   * condition — so it teaches rather than punishes. */
  const ARCHETYPES = [
    {
      id: 'mote', name: 'Mote', glyph: '·', hue: 200,
      blurb: 'The bare point of consciousness. No body, no force, no cost.',
      medium: [MEDIUM.VACUUM, MEDIUM.GAS, MEDIUM.LIQUID, MEDIUM.SURFACE, MEDIUM.ORBIT, MEDIUM.CYTOPLASM],
      mass: 0.02, thrust: 0.55, dragC: 0.9, liftC: 0, grip: 0,
      senseRadius: 0.55, senseBands: 3, capacity: 40, draw: 0.4, regen: 1.2,
      needs: () => null,
      dialMap: { time: 'drift rate', space: 'depth of attention', phase: 'facing', frequency: 'sense band' },
      tier: 0
    },
    {
      id: 'walker', name: 'Walker', glyph: '⋀', hue: 130,
      blurb: 'Legged frame. Gait frequency on τ, stance height on Σ. Cheap, patient, sure-footed.',
      medium: [MEDIUM.SURFACE],
      mass: 1.0, thrust: 1.5, dragC: 1.4, liftC: 0, grip: 1.0,
      senseRadius: 0.42, senseBands: 4, capacity: 120, draw: 0.7, regen: 1.0,
      /* Legs fail above roughly 3 g — the square-cube law is not negotiable. */
      needs: env => env.gravity > 3.2 ? 'gravity above 3.2 g crushes a legged frame'
        : env.medium !== MEDIUM.SURFACE ? 'needs a surface to stand on' : null,
      dialMap: { time: 'gait rate', space: 'stance height', phase: 'heading', frequency: 'sense band' },
      tier: 1
    },
    {
      id: 'rover', name: 'Rover', glyph: '⊙', hue: 40,
      blurb: 'Wheeled. Fast and efficient on open ground, helpless on broken terrain.',
      medium: [MEDIUM.SURFACE],
      mass: 2.2, thrust: 2.6, dragC: 0.9, liftC: 0, grip: 1.6,
      senseRadius: 0.5, senseBands: 4, capacity: 260, draw: 0.5, regen: 1.0,
      needs: env => env.medium !== MEDIUM.SURFACE ? 'needs a surface to drive on'
        : env.roughness > 0.72 ? 'terrain too broken to drive' : null,
      dialMap: { time: 'throttle', space: 'suspension', phase: 'steering', frequency: 'sense band' },
      tier: 1
    },
    {
      id: 'swimmer', name: 'Swimmer', glyph: '≈', hue: 195,
      blurb: 'Displacement hull. Buoyancy on Σ — sink to sense, rise to move.',
      medium: [MEDIUM.LIQUID],
      mass: 1.4, thrust: 1.8, dragC: 4.5, liftC: 0, grip: 0,
      senseRadius: 0.38, senseBands: 5, capacity: 180, draw: 0.8, regen: 0.9,
      needs: env => env.medium === MEDIUM.CYTOPLASM
        ? 'no inertia at this scale — a reversible stroke returns you where you started'
        : env.medium !== MEDIUM.LIQUID ? 'needs liquid to displace' : null,
      dialMap: { time: 'stroke rate', space: 'buoyancy', phase: 'heading', frequency: 'sense band' },
      tier: 2
    },
    {
      id: 'ciliate', name: 'Ciliate', glyph: '❋', hue: 150,
      blurb: 'A ring of beating cilia. The only stroke that gets anywhere where inertia does not exist.',
      medium: [MEDIUM.CYTOPLASM],
      /* Almost no mass, almost no thrust, and drag so high that it is the only
       * force that matters — which is exactly right. A ciliate does not coast;
       * it is dragged along by the fluid it is beating, and it stops dead the
       * instant it stops beating. */
      mass: 0.05, thrust: 0.9, dragC: 22.0, liftC: 0, grip: 0,
      senseRadius: 0.30, senseBands: 6, capacity: 60, draw: 0.5, regen: 1.4,
      needs: env => env.medium !== MEDIUM.CYTOPLASM
        ? 'cilia need a crowded fluid to beat against' : null,
      dialMap: { time: 'beat rate', space: 'depth in the cell', phase: 'heading', frequency: 'sense band' },
      tier: 2
    },
    {
      id: 'flier', name: 'Flier', glyph: '⌃', hue: 175,
      blurb: 'Lifting body. Needs air to bite on — thin atmospheres will not hold you.',
      medium: [MEDIUM.GAS],
      mass: 0.8, thrust: 2.2, dragC: 1.1, liftC: 3.4, grip: 0,
      senseRadius: 0.72, senseBands: 4, capacity: 200, draw: 1.3, regen: 0.9,
      /* The real constraint: wing loading. Lift scales with air density, so a
       * thin atmosphere needs impossible speed or weak gravity. */
      needs: env => (env.pressure * 3.4) < (env.gravity * 0.8)
        ? 'atmosphere too thin to generate lift at this gravity'
        : env.medium === MEDIUM.VACUUM ? 'no atmosphere' : null,
      dialMap: { time: 'throttle', space: 'altitude', phase: 'bank', frequency: 'sense band' },
      tier: 2
    },
    {
      id: 'lander', name: 'Lander', glyph: '⊻', hue: 20,
      blurb: 'Reaction thrust. Works anywhere, costs everywhere. The only way off a heavy world.',
      medium: [MEDIUM.VACUUM, MEDIUM.GAS, MEDIUM.SURFACE, MEDIUM.ORBIT],
      mass: 3.0, thrust: 5.5, dragC: 1.8, liftC: 0, grip: 0.3,
      senseRadius: 0.55, senseBands: 4, capacity: 420, draw: 3.2, regen: 0.7,
      needs: () => null,
      dialMap: { time: 'throttle', space: 'altitude', phase: 'attitude', frequency: 'sense band' },
      tier: 3
    },
    {
      id: 'courier', name: 'Courier', glyph: '◇', hue: 285,
      blurb: 'Interplanetary hull. Σ becomes orbital radius; you fly the system, not the ground.',
      medium: [MEDIUM.ORBIT, MEDIUM.VACUUM],
      mass: 6.0, thrust: 3.2, dragC: 0.2, liftC: 0, grip: 0,
      senseRadius: 1.6, senseBands: 6, capacity: 900, draw: 2.0, regen: 1.4,
      needs: env => env.medium === MEDIUM.SURFACE ? 'too large to operate at surface' : null,
      dialMap: { time: 'burn rate', space: 'orbital radius', phase: 'transfer angle', frequency: 'scan band' },
      tier: 3
    },
    {
      id: 'harvester', name: 'Harvester', glyph: '⊞', hue: 95,
      blurb: 'Extraction frame. Slow, armoured, and the only body that can take material out of a world.',
      medium: [MEDIUM.SURFACE, MEDIUM.LIQUID, MEDIUM.VACUUM],
      mass: 4.5, thrust: 1.4, dragC: 2.2, liftC: 0, grip: 2.0,
      senseRadius: 0.34, senseBands: 3, capacity: 520, draw: 1.1, regen: 0.8,
      needs: env => env.medium === MEDIUM.ORBIT ? 'must be at a surface to extract' : null,
      dialMap: { time: 'cycle rate', space: 'bore depth', phase: 'heading', frequency: 'seam band' },
      tier: 2,
      extracts: true
    },
    {
      id: 'probe', name: 'Probe', glyph: '◈', hue: 320,
      blurb: 'Sensor platform. Barely moves, sees everything. Reads minds at range.',
      medium: [MEDIUM.VACUUM, MEDIUM.GAS, MEDIUM.ORBIT, MEDIUM.SURFACE],
      mass: 0.3, thrust: 0.7, dragC: 1.2, liftC: 0.4, grip: 0,
      senseRadius: 2.2, senseBands: 8, capacity: 150, draw: 0.5, regen: 1.6,
      needs: () => null,
      dialMap: { time: 'integration time', space: 'aperture', phase: 'bearing', frequency: 'scan band' },
      tier: 2,
      reader: true
    },
    {
      id: 'symbiont', name: 'Symbiont', glyph: '◈', hue: 340,
      blurb: 'No body of its own. Rides a living mind and leans on it — you influence, you do not command.',
      medium: [MEDIUM.SURFACE, MEDIUM.LIQUID, MEDIUM.GAS, MEDIUM.ORBIT],
      mass: 0.05, thrust: 0, dragC: 1, liftC: 0, grip: 0,
      senseRadius: 0.6, senseBands: 5, capacity: 90, draw: 0.9, regen: 1.1,
      needs: env => !env.hasMinds ? 'no minds here to ride' : null,
      dialMap: { time: 'urgency', space: 'depth of hold', phase: 'intent', frequency: 'affect band' },
      tier: 4,
      neural: true
    },
    {
      id: 'flucton', name: 'Flucton', glyph: '∿', hue: 291,
      blurb: 'A pair that has not cancelled. The only body the foam will hold.',
      medium: [MEDIUM.FOAM],
      mass: 0.01, thrust: 0.4, dragC: 8, liftC: 0, grip: 0,
      senseRadius: 0.28, senseBands: 6, capacity: 40, draw: 0.6, regen: 1.8,
      needs: env => env.medium !== MEDIUM.FOAM
        ? 'nothing persists here except a pair that has not cancelled'
        : null,
      dialMap: { time: 'pair lifetime', space: 'slab depth', phase: 'which pair', frequency: 'sense band' },
      tier: 3
    },
    {
      id: 'weaver', name: 'Weaver', glyph: '⋈', hue: 268,
      blurb: 'Rides a filament. Σ is which strand; τ is how fast the web ages under you.',
      medium: [MEDIUM.VACUUM],
      mass: 0.4, thrust: 1.1, dragC: 0.4, liftC: 0, grip: 0,
      senseRadius: 1.4, senseBands: 5, capacity: 160, draw: 0.7, regen: 1.1,
      needs: env => env.label !== 'web' ? 'needs the cosmic web' : null,
      dialMap: { time: 'web age', space: 'strand', phase: 'along filament', frequency: 'sense band' },
      tier: 3,
      web: true
    }
  ];

  const BY_ID = Object.create(null);
  ARCHETYPES.forEach((a, i) => { a.index = i; BY_ID[a.id] = a; });

  /* ── Environment ──────────────────────────────────────────────────────────
   * Built from whatever the player is currently inside. This is the single
   * interface between the world models and the vessel physics, which is why a
   * vessel does not need to know whether it is on a planet, in a system, or in
   * the attunement field. */
  function environmentFor(game) {
    const scene = game.scene;
    if (scene.kind === 'planet' && scene.planet) {
      const p = scene.planet;
      const surf = scene.surface || {};
      const water = surf.sea != null ? surf.sea : RS.planet.seaLevel(p);
      const submerged = surf.elev != null && surf.elev < water;
      let slope = 0, fallEast = 0, fallNorth = 0;
      if (game.inhabiting && game.body) {
        const heading = game.body.heading;
        const step = 0.005;
        const clat = Math.max(0.12, Math.cos(scene.lat || 0));
        const e0 = RS.planet.elevationDetailAt(p, scene.lon, scene.lat);
        const e1 = RS.planet.elevationDetailAt(p,
          scene.lon + Math.cos(heading) * step / clat,
          scene.lat + Math.sin(heading) * step);
        slope = e1 - e0;
        /* Fall line is the negative gradient, independent of heading, so a
         * body on ice slides downhill even when τ is centred. */
        const eE = RS.planet.elevationDetailAt(p, scene.lon + step / clat, scene.lat);
        const eN = RS.planet.elevationDetailAt(p, scene.lon, scene.lat + step);
        fallEast = e0 - eE;
        fallNorth = e0 - eN;
      }
      const biomeId = surf.biome && surf.biome.id;
      return {
        medium: submerged ? MEDIUM.LIQUID : (scene.altitude > 0.04 ? MEDIUM.GAS : MEDIUM.SURFACE),
        gravity: p.gravity,
        pressure: p.pressure,
        temperature: surf.T == null ? p.surfaceTemp : surf.T,
        flux: p.flux,
        roughness: clamp01(p.tectonics * 0.8 + p.cratering * 0.5 + Math.abs(slope) * 2),
        slope,
        fallEast,
        fallNorth,
        biomeId,
        hasMinds: !!(p.biosphere && p.biosphere.complexity > 0.5),
        label: p.name
      };
    }
    if (scene.kind === 'cellular') {
      const c = scene.cell;
      const p = scene.planet;
      return {
        medium: MEDIUM.CYTOPLASM,
        /* Gravity is real but irrelevant here: viscous drag on a micron-scale
         * body exceeds its weight by orders of magnitude, so nothing at this
         * scale falls. Reporting it as zero is the honest reading of what the
         * body actually experiences. */
        gravity: 0,
        pressure: p ? p.pressure : 1,
        temperature: c ? c.temperature : (p ? p.surfaceTemp : 288),
        flux: p ? p.flux : 1,
        /* Crowding, not terrain — but it fills the same role for a body that
         * has to get through it. */
        roughness: c ? clamp01((c.viscosity - 2) / 8) : 0.4,
        hasMinds: true,
        label: c ? c.type.name : 'cytoplasm'
      };
    }
    if (scene.kind === 'foam') {
      return {
        medium: MEDIUM.FOAM,
        gravity: 0, pressure: 0, temperature: 0,
        flux: 1, roughness: 0, hasMinds: false, label: 'foam'
      };
    }
    if (scene.kind === 'web') {
      return {
        medium: MEDIUM.VACUUM,
        gravity: 0, pressure: 0, temperature: 3,
        flux: 1, roughness: 0, hasMinds: false, label: 'web'
      };
    }
    if (scene.kind === 'system') {
      const p = scene.planet;
      const civ = p && (p.civ || RS.civ.civOf(p, scene.tGyr));
      return {
        medium: MEDIUM.ORBIT,
        gravity: 0, pressure: 0,
        temperature: 3,
        flux: scene.system ? RS.stellar.fluxAt(scene.system, Math.max(0.05, scene.radius || 1)) : 1,
        roughness: 0,
        hasMinds: !!civ,
        label: scene.system ? scene.system.name : 'system'
      };
    }
    return {
      medium: MEDIUM.VACUUM, gravity: 0, pressure: 0, temperature: 3,
      flux: 1, roughness: 0, hasMinds: false, label: 'field'
    };
  }

  function canOperate(arch, env) {
    if (arch.medium.indexOf(env.medium) < 0) {
      return 'cannot operate in ' + env.medium;
    }
    return arch.needs(env);
  }

  /* Every archetype and its status in the current environment — the vessel
   * picker reads this, so an unavailable body always says *why*. */
  function availability(game) {
    const env = environmentFor(game);
    return ARCHETYPES.map(a => ({
      arch: a,
      unlocked: !!game.vessels.unlocked[a.id],
      reason: canOperate(a, env),
      env
    }));
  }

  /* The body that would actually work where you are standing, preferring the
   * most capable one you have unlocked. "This body cannot work here" is only
   * half a message; the other half is which one can, and the player should not
   * have to open a drawer and read six predicates to find out. */
  function bestHere(game, exclude) {
    const env = environmentFor(game);
    let best = null;
    for (const a of ARCHETYPES) {
      if (!game.vessels.unlocked[a.id]) continue;
      if (exclude && a.id === exclude) continue;
      if (canOperate(a, env)) continue;
      /* `tier` is the archetype's own sense of how much body it is, so the
       * most capable working body wins rather than whichever is listed first. */
      if (!best || a.tier > best.tier) best = a;
    }
    return best;
  }

  /* Everything a pilot needs to see at a glance, in one call, so the HUD does
   * not have to know the shape of a body. */
  function statusOf(game) {
    if (!game.inhabiting || !game.body) return null;
    const b = game.body;
    const a = archOf(b);
    const env = environmentFor(game);
    const blocked = canOperate(a, env);
    return {
      arch: a, body: b, env, blocked,
      charge: b.charge, capacity: a.capacity,
      chargeFrac: clamp01(b.charge / Math.max(1, a.capacity)),
      /* Strain is simulated and was never shown, so the one number that says
       * "change body soon" was invisible. */
      strain: clamp01(b.strain || 0),
      speed: Math.hypot(b.vx || 0, b.vy || 0),
      elevation: b.elevation || 0,
      holdMass: b.holdMass || 0,
      possession: b.mindState ? b.mindState.possession
        : (b.possession != null ? b.possession : null),
      ridingCiv: !!b.ridingCiv,
      /* Seconds of charge left at the current draw, which is the number that
       * actually tells you whether to turn back. Infinite while regenerating. */
      endurance: enduranceOf(a, b, env),
      alternative: blocked ? bestHere(game, a.id) : null
    };
  }

  /* Net charge budget: draw scales with exertion and with how hostile the
   * medium is; regen is the archetype's own recovery. Positive net means the
   * body is charging and endurance is unbounded. */
  function enduranceOf(arch, body, env) {
    const exertion = 0.35 + Math.hypot(body.vx || 0, body.vy || 0) * 1.6;
    const hostile = 1 + clamp01(Math.abs(env.temperature - 288) / 220);
    const net = arch.regen - arch.draw * exertion * hostile;
    if (net >= 0) return Infinity;
    return body.charge / -net;
  }

  // ── the inhabited body ───────────────────────────────────────────────────

  function newBody(archId) {
    return {
      archId: archId || 'mote',
      x: 0, y: 0,          // position in scene-normalised units
      vx: 0, vy: 0,
      vz: 0,               // northward on a surface; unused in other media
      heading: 0,
      /* Σ means something different per archetype but is always "the vertical
       * axis of this body" — altitude, depth, stance, orbital radius. */
      elevation: 0,
      charge: 40,
      /* Accumulated wear. Rises with exertion in hostile conditions and is the
       * reason to change bodies rather than brute-force everything. */
      strain: 0,
      /* Cargo, for extraction and trade. */
      hold: Object.create(null),
      holdMass: 0,
      /* Neural state, when riding a mind. */
      mind: null, mindState: null, mindAddr: 0,
      /* Direct steering vector from the field drag gesture, if any. */
      steerX: 0, steerY: 0,
      lastFire: 0,
      gaitPhase: 0, strokePhase: 0, bank: 0, lastStep: 0
    };
  }

  function angleDiff(from, to) {
    let d = to - from;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    return d;
  }

  function turnRateOf(arch) {
    switch (arch.id) {
      case 'walker': return 5.2;
      case 'rover': return 2.4;
      case 'harvester': return 2.8;
      case 'flier': return 3.6;
      case 'swimmer': return 4.0;
      case 'ciliate': return 6.5;
      default: return 3.2 / Math.sqrt(arch.mass || 1);
    }
  }

  function archOf(body) { return BY_ID[body.archId] || BY_ID.mote; }

  /* ── Dial interpretation ──────────────────────────────────────────────────
   * The heart of the ergonomics. Reads the four dials and returns normalised
   * control intents. Note that these are *normalised against each dial's own
   * reach*, so a player who has upgraded their dials gets finer control of
   * their vessel too — the same upgrade improves both tuning and piloting,
   * which keeps a single upgrade tree meaningful across both halves of the
   * game. */
  function controlsFrom(game) {
    const D = game.dials;
    /* τ: signed rate of the body's own action. Negative genuinely reverses —
     * backing up, descending, unwinding a gait. */
    const rate = clamp(D.time.value / Math.max(0.5, D.time.max), -1, 1);
    /* Σ: vertical axis, normalised across the dial's reach. When the space dial
     * is being used for scale navigation instead, the scene freezes this. */
    const span = Math.max(1e-6, D.space.max - D.space.min);
    const vert = clamp01((D.space.value - D.space.min) / span);
    /* Δ: heading, directly — the phase dial is already a circle, which is
     * exactly what a heading is. This is the single cleanest mapping in the
     * game and it is why phase was made to wrap in the first place. */
    const heading = D.phase.value;
    /* φ: which band the vessel's senses are tuned to. */
    const band = RS.spectrum.nearestBand(D.frequency.value);
    return { rate, vert, heading, band, phi: D.frequency.value };
  }

  // ── force integration ────────────────────────────────────────────────────

  /* One body, one Euler step with exponential drag — which is unconditionally
   * stable for the drag term regardless of dt, so a hitching frame cannot fling
   * the player across a planet. */
  function integrate(game, body, env, ctl, dt) {
    const arch = archOf(body);
    const blocked = canOperate(arch, env);

    /* A body that cannot operate does not simply stop — it falls, drifts or
     * flounders, which communicates the failure physically. */
    const authority = blocked ? 0.08 : 1;

    // --- thrust -----------------------------------------------------------
    /* Δ is facing; τ is gait/throttle; field drag yaws heading. On a planet
     * surface each archetype expresses those differently — walker steps,
     * rover coasts, flier banks. */
    const powered = body.charge > 0.5 ? 1 : 0.15;
    const accel = arch.thrust / effectiveMass(body) * authority * powered;
    const onPlanetSurface = env.medium === MEDIUM.SURFACE && game.scene && game.scene.kind === 'planet';
    let ax, ay, az = 0;

    if (onPlanetSurface && arch.id !== 'symbiont') {
      const tr = turnRateOf(arch) * authority / Math.max(0.35, arch.grip);
      const herr = angleDiff(body.heading, ctl.heading);
      body.heading += clamp(herr, -tr * dt, tr * dt);
      body.heading += (body.steerX * 2.8 + body.steerY * 0.4) * dt * authority;

      let thrustMag = 0;
      if (arch.id === 'walker' || arch.id === 'harvester') {
        body.gaitPhase = (body.gaitPhase || 0) + dt * (1.4 + Math.abs(ctl.rate) * 3.2);
        const step = Math.abs(ctl.rate) * Math.max(0, Math.sin(body.gaitPhase * TAU));
        thrustMag = step * accel * (arch.id === 'harvester' ? 0.62 : 1);
        if (step > 0.82 && body.gaitPhase - (body.lastStep || 0) > 0.45) {
          body.lastStep = body.gaitPhase;
          body.__footfall = 1;
        }
      } else if (arch.id === 'rover') {
        thrustMag = ctl.rate * accel;
        const steer = clamp(herr, -1, 1) * Math.min(1, Math.hypot(body.vx, body.vz) * 2.2);
        body.heading += steer * dt * 2.8 * authority;
      } else if (arch.id === 'lander') {
        body.gaitPhase = (body.gaitPhase || 0) + dt * 9;
        thrustMag = Math.abs(ctl.rate) * (Math.sin(body.gaitPhase * TAU) > 0.2 ? accel * 1.3 : 0);
        ax = Math.cos(body.heading) * thrustMag * Math.sign(ctl.rate || 1);
        az = Math.sin(body.heading) * thrustMag * Math.sign(ctl.rate || 1);
      } else if (arch.id === 'flier') {
        const spd = Math.hypot(body.vx, body.vz);
        body.bank = damp(body.bank || 0, herr * Math.min(1, spd * 1.6), 7, dt);
        body.heading += body.bank * dt * 2.4 * authority;
        thrustMag = ctl.rate * accel * (spd < 0.06 && ctl.rate > 0 ? 0.15 : 1);
      } else {
        thrustMag = ctl.rate * accel;
      }
      if (arch.id !== 'lander') {
        ax = Math.cos(body.heading) * thrustMag;
        az = Math.sin(body.heading) * thrustMag;
      }
      ay = 0;
    } else if (onPlanetSurface && arch.id === 'symbiont') {
      body.heading = ctl.heading;
      ax = 0; az = 0; ay = 0;
    } else if (onPlanetSurface) {
      ax = Math.cos(ctl.heading) * ctl.rate * accel;
      az = Math.sin(ctl.heading) * ctl.rate * accel;
      ay = 0;
    } else if (env.medium === MEDIUM.LIQUID && (arch.id === 'swimmer' || arch.id === 'ciliate')) {
      body.strokePhase = (body.strokePhase || 0) + dt * (arch.id === 'ciliate' ? 14 : 5) * (0.3 + Math.abs(ctl.rate));
      const asym = arch.id === 'ciliate'
        ? Math.max(0, Math.sin(body.strokePhase * TAU))
        : Math.max(0, Math.sin(body.strokePhase * TAU)) * (0.35 + Math.abs(ctl.rate));
      body.heading += angleDiff(body.heading, ctl.heading) * dt * turnRateOf(arch) * authority;
      body.heading += body.steerX * 2.2 * dt;
      ax = Math.cos(body.heading) * asym * accel;
      ay = Math.sin(body.heading) * asym * accel * 0.35;
    } else {
      body.heading += angleDiff(body.heading, ctl.heading) * dt * turnRateOf(arch) * authority * 0.7;
      body.heading += body.steerX * 2.2 * dt;
      let tx = Math.cos(body.heading) * ctl.rate;
      let ty = Math.sin(body.heading) * ctl.rate;
      tx += body.steerX * 0.35; ty += body.steerY * 0.35;
      const mag = Math.hypot(tx, ty);
      if (mag > 1) { tx /= mag; ty /= mag; }
      ax = tx * accel; ay = ty * accel;
    }
    const tmag = Math.abs(ctl.rate) + Math.hypot(body.steerX, body.steerY) * 0.35;

    // --- gravity ----------------------------------------------------------
    /* On a surface, "down" is +y in scene space (the surface view is a side-on
     * slice), and gravity only acts when the body is off the ground. */
    if (env.medium === MEDIUM.SURFACE || env.medium === MEDIUM.GAS) {
      const g = env.gravity * 0.55;
      ay += g;
      /* Lift: proportional to air density and to speed squared, and only if
       * the body has a lifting surface. This single term is the entire
       * difference between a flier working and not working on a given world. */
      if (arch.liftC > 0) {
        const speed = Math.hypot(body.vx, body.vy);
        const lift = arch.liftC * env.pressure * speed * speed / arch.mass;
        ay -= Math.min(lift, g * 2.4) * authority;
      }
      /* Σ verticals. Neutral at 0.5 so a centred dial does not hop. Walker
       * stance is a small crouch/stretch on the floor; flier/probe chase an
       * altitude; lander burns against gravity. */
      const vertLift = (ctl.vert - 0.5);
      if (env.medium === MEDIUM.SURFACE) {
        if (arch.id === 'lander') ay -= vertLift * 3.2 * authority;
        else if (arch.id === 'walker' || arch.id === 'rover' || arch.id === 'harvester' || arch.id === 'symbiont') {
          /* Hop only when Σ is pushed well above centre, so walking does not
           * bounce. Stance offset is applied after ground contact. */
          if (ctl.vert > 0.78 && body.y >= -0.02) ay -= (ctl.vert - 0.78) * 4.5 * authority;
        }
      }
      if (env.medium === MEDIUM.GAS && (arch.liftC > 0 || arch.id === 'lander' || arch.id === 'probe' || arch.id === 'flier')) {
        const targetY = -ctl.vert * 0.62;
        ay += (targetY - body.y) * 2.1 * authority;
      }
    }
    if (env.medium === MEDIUM.LIQUID) {
      /* Buoyancy set by Σ: the player trims their own density. Sink to sense,
       * rise to travel. */
      ay += (0.5 - ctl.vert) * 1.6 * authority;
    }
    if (env.medium === MEDIUM.ORBIT && (arch.id === 'courier' || arch.id === 'lander' || arch.id === 'probe')) {
      /* Courier Σ is orbital radius, applied in the system tick. Here it only
       * trims out-of-plane drift so the ship stays in the plane. */
      ay += -body.y * 1.4 * authority;
    }
    if (env.medium === MEDIUM.CYTOPLASM) {
      /* Depth in the cell is Σ; cilia beat is τ. No inertia to speak of. */
      ay += (ctl.vert - 0.5) * 0.8 * authority;
    }

    /* Uphill costs speed. Ice slips, sand drags — biome, not a stat. */
    if (onPlanetSurface && env.slope > 0) {
      const hill = 1 / (1 + env.slope * 5);
      ax *= hill; az *= hill;
    }
    /* Downhill is a fall line. Uphill already taxes thrust; without this,
     * ice and grass feel the same the moment you stop walking. */
    if (onPlanetSurface && body.y >= -0.05) {
      const slip = env.biomeId === 'ice' ? 1.8
        : (env.biomeId === 'desert' || env.biomeId === 'dunes') ? 0.25
        : 0.55;
      const fall = env.gravity * 2.4 * slip;
      ax += (env.fallEast || 0) * fall;
      az += (env.fallNorth || 0) * fall;
    }

    // --- drag / friction --------------------------------------------------
    /* Density of the medium the body is moving through. Vacuum has none, which
     * is why a courier coasts and a swimmer does not. */
    const density = env.medium === MEDIUM.LIQUID ? 30
      : env.medium === MEDIUM.CYTOPLASM ? 80
      : env.medium === MEDIUM.GAS ? env.pressure * 1.4
        : env.medium === MEDIUM.SURFACE ? 0.6 + env.pressure * 0.5
          : 0.02;
    let dragRate = arch.dragC * density * 0.35;
    if (env.biomeId === 'desert' || env.biomeId === 'dunes') dragRate *= 1.45;
    if (env.biomeId === 'shallows') dragRate *= 1.2;
    if (env.biomeId === 'crystal') dragRate *= 0.7;
    if (env.biomeId === 'lava') dragRate *= 1.8;

    body.vx += ax * dt;
    body.vy += ay * dt;
    body.vz = (body.vz || 0) + az * dt;

    const f = Math.exp(-dragRate * dt);
    body.vx *= f; body.vy *= f; body.vz *= f;

    /* Ground contact: friction and a floor. */
    const floor = env.groundY != null ? env.groundY : 0;
    if ((env.medium === MEDIUM.SURFACE) && body.y >= floor) {
      /* Walker stance: Σ above ~0.35 lifts the silhouette slightly (negative
       * y is up). Applied on the floor so gravity does not fight it. */
      const stanceUp = (arch.id === 'walker' && ctl.vert > 0.4)
        ? (ctl.vert - 0.4) * 0.14 : 0;
      body.y = floor - stanceUp;
      if (body.vy > 0) body.vy = 0;
      let grip = arch.grip;
      if (env.biomeId === 'ice') grip *= 0.22;
      else if (env.biomeId === 'desert' || env.biomeId === 'savanna') grip *= 0.72;
      if (arch.id === 'rover' && Math.abs(ctl.rate) < 0.08) grip *= 0.18;
      const gf = Math.exp(-grip * 3.4 * dt);
      body.vx *= gf;
      body.vz *= gf;
    }

    body.x += body.vx * dt;
    body.y += body.vy * dt;

    const sp = onPlanetSurface
      ? Math.hypot(body.vx, body.vz)
      : Math.hypot(body.vx, body.vy);

    // --- expenditure ------------------------------------------------------
    /* Charge drains with exertion and with hostility of the environment, and
     * regenerates from local stellar flux. On a dark world you are on a timer;
     * next to a bright star you are not. */
    const exertion = tmag * arch.draw * (1 + env.gravity * 0.5);
    const hostility = (env.temperature > 340 || env.temperature < 180 ? 0.35 : 0) +
      (env.pressure > 8 ? 0.3 : 0) +
      (env.biomeId === 'lava' ? 0.55 : 0);
    body.charge -= (exertion + hostility * arch.draw * 0.5) * dt;
    body.charge += arch.regen * clamp01(0.25 + env.flux * 0.4) * dt;
    body.charge = clamp(body.charge, 0, arch.capacity);

    body.strain = clamp01(body.strain + (hostility * 0.05 - 0.02) * dt);

    /* Steering impulse decays — it is a gesture, not a held state. */
    body.steerX = damp(body.steerX, 0, 5, dt);
    body.steerY = damp(body.steerY, 0, 5, dt);

    return { blocked, authority, speed: sp };
  }

  // ── riding a mind ────────────────────────────────────────────────────────

  const inputBuf = new Float32Array(RS.neural.N_IN);

  /* Attach to a creature's mind. The player does not take it over; they get a
   * bias channel and whatever the creature does with it. */
  function ride(body, addrHash) {
    body.mindAddr = addrHash >>> 0;
    body.mind = RS.neural.mindAt(body.mindAddr);
    body.mindState = RS.neural.newState();
  }

  function unride(body) {
    body.mind = null; body.mindState = null; body.mindAddr = 0;
  }

  /* Step the ridden mind and let its outputs drive the body. The player's
   * dials become a *bias*, not a command — so the creature's own dynamics are
   * always in the loop, and a stubborn one will refuse. */
  function stepMind(game, body, env, ctl, dt, sense) {
    if (!body.mind) return null;
    const st = body.mindState;

    inputBuf[0] = clamp(body.charge / archOf(body).capacity * 2 - 1, -1, 1);
    inputBuf[1] = clamp(sense.threat || 0, -1, 1);
    inputBuf[2] = clamp(sense.food || 0, -1, 1);
    inputBuf[3] = clamp(sense.kin || 0, -1, 1);
    inputBuf[4] = clamp(env.flux * 0.5 - 1, -1, 1);
    inputBuf[5] = 1;

    /* The player leans on the mind with an amount set by τ (urgency) and a
     * direction derived from the heading and exertion they are asking for. */
    const vec = RS.neural.pilotVector(body.mind,
      Math.cos(ctl.heading) * ctl.rate,
      Math.sin(ctl.heading) * ctl.rate,
      ctl.vert * 2 - 1,
      0);
    /* Influence strength scales with the reality field — this is where the
     * meta-progression actually cashes out into capability. */
    const strength = 0.6 + (game.fields ? game.fields.reality * 1.8 : 0);
    RS.neural.influence(st, vec, Math.abs(ctl.rate) * strength, dt);
    RS.neural.relax(st, dt);

    const out = RS.neural.step(body.mind, st, inputBuf, dt);

    /* The mind's outputs drive the body directly. Note the player's heading is
     * not applied here — only the creature's own turn output is, which is what
     * makes this feel like persuasion rather than driving. */
    const arch = archOf(body);
    const forward = out[0], turn = out[1], exert = out[2];
    body.heading += turn * dt * 2.2;
    const a = arch.thrust / arch.mass * (0.5 + Math.abs(exert) * 0.8);
    body.vx += Math.cos(body.heading) * forward * a * dt;
    body.vy += Math.sin(body.heading) * forward * a * dt;

    return { out, possession: st.possession, arousal: st.arousal };
  }

  /* Sensing. What the vessel can perceive is gated by its archetype's radius
   * and by how many spectrum bands it can resolve — so φ still matters inside
   * a vessel, and a probe genuinely sees things a walker cannot. */
  function senseRadius(game, body) {
    const arch = archOf(body);
    const foc = RS.dials.observerFocus(game.dials);
    const field = game.fields ? game.fields.consciousness : 0;
    return arch.senseRadius * (0.7 + foc * 0.6) * (1 + field * 0.5);
  }

  function canSenseBand(body, bandIndex) {
    return bandIndex < archOf(body).senseBands;
  }

  /* Cargo. Mass matters: a full hold makes everything sluggish, which is the
   * trade-off that makes hauling a decision. */
  function addCargo(body, commodityId, amount) {
    const arch = archOf(body);
    const cap = arch.capacity * 0.25;
    const space = cap - body.holdMass;
    const took = Math.max(0, Math.min(amount, space));
    if (took <= 0) return 0;
    body.hold[commodityId] = (body.hold[commodityId] || 0) + took;
    body.holdMass += took;
    return took;
  }

  function removeCargo(body, commodityId, amount) {
    const have = body.hold[commodityId] || 0;
    const gave = Math.min(have, amount);
    body.hold[commodityId] = have - gave;
    if (body.hold[commodityId] <= 1e-6) delete body.hold[commodityId];
    body.holdMass = Math.max(0, body.holdMass - gave);
    return gave;
  }

  function effectiveMass(body) {
    return archOf(body).mass + body.holdMass * 0.02;
  }

  /* Keep a body inside a disc of field units. Used by cytoplasm, shells, and
   * the other place-aware scopes so a vessel cannot leave the derived room. */
  function confine(body, radius) {
    const r = Math.hypot(body.x, body.y);
    if (r <= radius) return;
    const s = radius / (r || 1);
    body.x *= s; body.y *= s;
    body.vx *= 0.45; body.vy *= 0.45;
  }

  RS.vessel = {
    MEDIUM, ARCHETYPES, BY_ID,
    environmentFor, canOperate, availability, bestHere, statusOf, enduranceOf,
    newBody, archOf, controlsFrom, integrate, confine,
    ride, unride, stepMind, senseRadius, canSenseBand,
    addCargo, removeCargo, effectiveMass
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
