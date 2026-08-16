/* Resonant — procedural audio. Everything is synthesised; there are no assets.
 *
 * ── The one idea this module exists for ────────────────────────────────────
 *
 * Two tones close in pitch beat against each other at the difference of their
 * frequencies. Far apart: a fast ugly warble. Closer: a slow throb. Identical:
 * the warble vanishes and the tone goes glassy and still. That is how a guitar
 * gets tuned, and it is the most satisfying feedback mechanism in any physical
 * instrument, because the signal gets *qualitatively* different as you close
 * in rather than merely louder.
 *
 * So the frequency dial drives a real detuned oscillator pair. The reference
 * sits at the nearest band's pitch; the player's carrier sits at that pitch
 * plus (φ error × BEAT_SCALE) Hz. Being 4φ off tune produces a 10 Hz flutter.
 * Being 0.4φ off produces a one-per-second throb. Landing dead centre
 * produces silence in the beat and a pure sustained tone. A player can find a
 * band with their eyes closed, and once they notice that, the dial stops
 * feeling like a slider and starts feeling like an instrument.
 *
 * Everything else here — clicks, seats, the coherence ramp, the crystal chord
 * — is arranged around not stepping on that.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp } = RS.core;

  const BEAT_SCALE = 2.6;   // Hz of detune per φ of tuning error
  const MASTER = 0.22;

  let ctx = null;
  let master = null, comp = null, verb = null, verbGain = null;
  let enabled = true, started = false;
  let droneGain = null, oscA = null, oscB = null, oscSub = null, droneFilter = null;
  let rampOsc = null, rampGain = null, rampFilter = null;
  let noiseBuf = null;
  let lastClickAt = 0;

  /* One musical pitch per band, climbing a stack of fifths and thirds so that
   * moving up the spectrum sounds like ascending rather than like an arbitrary
   * list. These are the reference tones the player tunes against. */
  const BAND_TONE = [
    98.00,   // G2   baryonic
    130.81,  // C3   thermal
    164.81,  // E3   electromagnetic
    196.00,  // G3   probabilistic
    246.94,  // B3   vital
    293.66,  // D4   emotional
    349.23,  // F4   mnemonic
    440.00,  // A4   causal
    523.25,  // C5   archetypal
    659.25,  // E5   noetic
    783.99,  // G5   null
    987.77   // B5   unity
  ];

  function supported() {
    return typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  }

  function init() {
    if (started || !supported()) return false;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();

    /* A compressor on the bus, because the crystal chords stack and a player
     * chaining locks should get louder-feeling payoffs, not clipping. */
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 22;
    comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.18;

    master = ctx.createGain();
    master.gain.value = enabled ? MASTER : 0;

    /* Small algorithmic reverb from a synthesised impulse — gives the deep
     * tiers a sense of enormous space without shipping an audio file. */
    verb = ctx.createConvolver();
    verb.buffer = makeImpulse(2.6, 2.4);
    verbGain = ctx.createGain();
    verbGain.gain.value = 0.34;

    master.connect(comp);
    comp.connect(ctx.destination);
    verbGain.connect(verb);
    verb.connect(master);

    noiseBuf = makeNoise(0.5);
    buildDrone();
    buildBed();
    buildMachinery();
    buildRamp();
    started = true;
    return true;
  }

  function makeImpulse(seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    /* Seeded rather than Math.random so the room is the same every session —
     * a reverb that changes character between loads is subtly unsettling. */
    const rnd = RS.core.rngFrom(0xA11CE);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  function makeNoise(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    const rnd = RS.core.rngFrom(0xBEEF);
    for (let i = 0; i < len; i++) d[i] = rnd() * 2 - 1;
    return buf;
  }

  // --- the tuning drone ----------------------------------------------------

  function buildDrone() {
    droneGain = ctx.createGain();
    droneGain.gain.value = 0;
    droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 700;
    droneFilter.Q.value = 1.2;

    oscA = ctx.createOscillator(); oscA.type = 'sine';
    oscB = ctx.createOscillator(); oscB.type = 'sine';
    /* A triangle an octave down gives the drone a body that a pair of sines
     * lacks; without it the tuning tone reads as a test signal. */
    oscSub = ctx.createOscillator(); oscSub.type = 'triangle';

    const gA = ctx.createGain(); gA.gain.value = 0.5;
    const gB = ctx.createGain(); gB.gain.value = 0.5;
    const gS = ctx.createGain(); gS.gain.value = 0.28;

    oscA.connect(gA); oscB.connect(gB); oscSub.connect(gS);
    gA.connect(droneFilter); gB.connect(droneFilter); gS.connect(droneFilter);
    droneFilter.connect(droneGain);
    droneGain.connect(master);
    droneGain.connect(verbGain);

    oscA.start(); oscB.start(); oscSub.start();
  }

  /* Called every frame. `phi` is the dial, `band` the nearest band, `res` the
   * resonance 0..1, `ghost` whether the band is beyond the observer's focus. */
  function updateDrone(phi, band, res, ghost) {
    if (!started || !enabled) return;
    const now = ctx.currentTime;
    const ref = BAND_TONE[band.index] || 220;
    const err = phi - band.centre;
    const carrier = Math.max(30, ref + err * BEAT_SCALE);

    /* setTargetAtTime rather than setValueAtTime: an instantaneous frequency
     * change on a running oscillator is an audible click, and this runs 60
     * times a second. */
    oscA.frequency.setTargetAtTime(ref, now, 0.02);
    oscB.frequency.setTargetAtTime(carrier, now, 0.02);
    oscSub.frequency.setTargetAtTime(ref / 2, now, 0.05);

    /* Volume follows resonance, so the empty stretches of the spectrum are
     * genuinely quiet and arriving at a band is an event. Ghost bands are
     * audible but muffled — you can hear a layer you cannot yet hold, which is
     * a far better advertisement for the focus upgrade than any text. */
    const vol = res * res * (ghost ? 0.22 : 1) * 0.5;
    droneGain.gain.setTargetAtTime(vol, now, 0.09);
    droneFilter.frequency.setTargetAtTime(
      ghost ? 420 : lerp(600, 4200, res), now, 0.12);
  }

  // --- ambient beds --------------------------------------------------------

  /* ── One bed per scope ────────────────────────────────────────────────────
   *
   * Not new machinery: one noise source and one filter, shaped differently per
   * scope. A place that sounds the same everywhere reads as a menu, and this is
   * the cheapest possible fix — the whole thing is two nodes and a table.
   *
   * The most important entry is the vacuum. Sound genuinely does not propagate
   * where there is no medium, so the system and galaxy scopes get *silence*,
   * and the contrast when you descend into an atmosphere and the wind arrives
   * is worth more than any amount of texture would have been.
   */
  const BEDS = {
    /* freq: the filter's centre. q: how resonant — high q is a pitch, low q is
     * a wash. gain: how loud, and zero means genuinely silent. */
    field:     { freq: 220,  q: 0.6, gain: 0.020, type: 'lowpass'  },
    foam:      { freq: 5200, q: 0.4, gain: 0.055, type: 'highpass' },
    shells:    { freq: 1400, q: 7.0, gain: 0.030, type: 'bandpass' },
    molecular: { freq: 700,  q: 3.0, gain: 0.026, type: 'bandpass' },
    cellular:  { freq: 300,  q: 1.6, gain: 0.040, type: 'lowpass'  },
    planet:    { freq: 500,  q: 0.7, gain: 0.045, type: 'lowpass'  },
    system:    { freq: 200,  q: 0.5, gain: 0.000, type: 'lowpass'  },
    galaxy:    { freq: 200,  q: 0.5, gain: 0.000, type: 'lowpass'  },
    web:       { freq: 70,   q: 0.8, gain: 0.050, type: 'lowpass'  },
    ensemble:  { freq: 950,  q: 12.0, gain: 0.022, type: 'bandpass' }
  };

  let bedSrc = null, bedFilter = null, bedGain = null;

  function buildBed() {
    bedGain = ctx.createGain(); bedGain.gain.value = 0;
    bedFilter = ctx.createBiquadFilter();
    bedFilter.type = 'lowpass';
    bedFilter.frequency.value = 400;
    bedFilter.Q.value = 1;
    bedSrc = ctx.createBufferSource();
    bedSrc.buffer = makeNoise(4);
    bedSrc.loop = true;
    bedSrc.connect(bedFilter);
    bedFilter.connect(bedGain);
    bedGain.connect(master);
    bedGain.connect(verbGain);
    bedSrc.start();
  }

  let machSrc = null, machFilter = null, machGain = null;

  function buildMachinery() {
    machGain = ctx.createGain(); machGain.gain.value = 0;
    machFilter = ctx.createBiquadFilter();
    machFilter.type = 'bandpass';
    machFilter.frequency.value = 180;
    machFilter.Q.value = 2.2;
    machSrc = ctx.createBufferSource();
    machSrc.buffer = makeNoise(2);
    machSrc.loop = true;
    machSrc.connect(machFilter);
    machFilter.connect(machGain);
    machGain.connect(master);
    machSrc.start();
  }

  const MACH = {
    walker: { freq: 140, q: 1.8 }, rover: { freq: 320, q: 0.9 },
    flier: { freq: 480, q: 1.2 }, lander: { freq: 260, q: 3.5 },
    swimmer: { freq: 95, q: 1.4 }, ciliate: { freq: 2200, q: 4.5 },
    harvester: { freq: 110, q: 1.5 }, courier: { freq: 380, q: 2.8 },
    probe: { freq: 720, q: 6 }, flucton: { freq: 1600, q: 3 },
    weaver: { freq: 55, q: 0.7 }, mote: { freq: 400, q: 8 }
  };

  function updateMachinery(archId, rate, speed) {
    if (!started || !enabled || !machGain) return;
    const now = ctx.currentTime;
    const m = MACH[archId] || MACH.mote;
    const exert = clamp01(Math.abs(rate) * 0.7 + speed * 0.5);
    machFilter.frequency.setTargetAtTime(m.freq * (0.85 + exert * 0.4), now, 0.08);
    machFilter.Q.setTargetAtTime(m.q, now, 0.12);
    machGain.gain.setTargetAtTime(exert * 0.028, now, 0.06);
  }

  function footfall(archId) {
    if (!started || !enabled) return;
    const m = MACH[archId] || MACH.walker;
    blip(m.freq * 1.4, 'triangle', 0.04, 0.002, 0.08, true);
    noiseBurst(0.02, 0.04, m.freq * 2.2, 2);
  }

  /* `pressure` scales the planet surface bed, because wind is a thing air does
   * and a body on an airless world should hear nothing but its own machinery.
   * That is the one place in the game where the physics and the sound design
   * are the same decision. */
  function updateBed(sceneKind, pressure) {
    if (!started || !enabled || !bedGain) return;
    const b = BEDS[sceneKind] || BEDS.field;
    const now = ctx.currentTime;
    let gain = b.gain;
    if (sceneKind === 'planet') {
      /* Saturating in pressure: Mars at 0.006 bar is essentially silent, Earth
       * at 1 is a light wind, and Venus at 92 is not 92 times louder. */
      gain *= clamp01(1 - Math.exp(-(pressure || 0) * 2.2));
    }
    bedFilter.type = b.type;
    bedFilter.frequency.setTargetAtTime(b.freq, now, 0.4);
    bedFilter.Q.setTargetAtTime(b.q, now, 0.4);
    /* Slow: a bed that crossfades quickly is a transition, and a bed that
     * crossfades slowly is a place changing around you. */
    bedGain.gain.setTargetAtTime(gain, now, 0.9);
  }

  // --- the coherence ramp --------------------------------------------------

  function buildRamp() {
    rampGain = ctx.createGain(); rampGain.gain.value = 0;
    rampFilter = ctx.createBiquadFilter();
    rampFilter.type = 'bandpass';
    rampFilter.frequency.value = 600; rampFilter.Q.value = 5;
    rampOsc = ctx.createOscillator();
    rampOsc.type = 'sawtooth';
    rampOsc.frequency.value = 180;
    rampOsc.connect(rampFilter);
    rampFilter.connect(rampGain);
    rampGain.connect(master);
    rampGain.connect(verbGain);
    rampOsc.start();
  }

  /* The rising tension while a lock fills. Pitch and filter both climb, so it
   * gets brighter as well as higher — brightness is what the ear reads as
   * "approaching", and it leaves the crystal chord somewhere to land. */
  function updateRamp(coherence, bandIndex, node) {
    if (!started || !enabled) return;
    const now = ctx.currentTime;
    if (coherence <= 0.001) {
      rampGain.gain.setTargetAtTime(0, now, 0.08);
      return;
    }
    const base = (BAND_TONE[bandIndex] || 220) * 0.5;
    const t = RS.core.ease.inQuad(clamp01(coherence));

    /* ── The primitives, audible ──────────────────────────────────────────
     *
     * The ramp is not just "a lock is filling"; it says *what kind of thing*
     * you are holding, using the same numbers the mechanics run on. Nothing
     * here is a new synth — it is the existing ramp, modulated by three
     * primitives, so the layers become audibly distinct for free and a player
     * can hear an essence's axes before the codex has revealed them.
     *
     *   GATE  ducks the ramp when the window shuts, so the rhythm you have to
     *         play to is a thing you hear rather than a thing you watch.
     *   NEST  transposes a fifth per level, so a descent literally climbs —
     *         and the pitch tells you how deep you are without looking.
     *   FLOW  jitters the filter by (1 - steadiness), so a volatile essence
     *         sounds unstable and a persistent one sounds locked.
     */
    let duck = 1, transpose = 1, jitter = 0;
    if (node && node.man) {
      const band = RS.spectrum.BANDS[node.man.bandIndex];
      if (band) {
        if (node.gateInfo && RS.spectrum.usesPrim(band, 'gate')) {
          duck = 0.25 + 0.75 * clamp01(node.gate);
        }
        if (node.nestInfo && RS.spectrum.usesPrim(band, 'nest')) {
          transpose = Math.pow(1.5, node.depth || 0);
        }
        if (node.flowInfo && RS.spectrum.usesPrim(band, 'flow')) {
          jitter = (1 - clamp01(node.flowInfo.steadiness)) *
            Math.sin(now * 9.1) * 700;
        }
      }
    }

    rampOsc.frequency.setTargetAtTime(base * transpose * (1 + t * 1.6), now, 0.04);
    rampFilter.frequency.setTargetAtTime(Math.max(120, 300 + t * 3600 + jitter), now, 0.05);
    rampFilter.Q.setTargetAtTime(4 + t * 12, now, 0.06);
    rampGain.gain.setTargetAtTime((0.03 + t * 0.075) * duck, now, 0.04);
  }

  // --- one-shots -----------------------------------------------------------

  function env(node, t0, attack, decay, peak) {
    const g = node.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  function blip(freq, type, peak, attack, decay, sendVerb, detune) {
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (detune) o.detune.setValueAtTime(detune, t0);
    o.connect(g); g.connect(master);
    if (sendVerb) g.connect(verbGain);
    env(g, t0, attack, decay, peak);
    o.start(t0);
    o.stop(t0 + attack + decay + 0.05);
    /* Explicit teardown — a game that runs for an hour creates tens of
     * thousands of these and orphaned nodes are a real leak. */
    o.onended = () => { try { o.disconnect(); g.disconnect(); } catch (e) { /* already gone */ } };
    return { o, g, t0 };
  }

  function noiseBurst(peak, decay, freq, q, type) {
    const t0 = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type || 'bandpass';
    f.frequency.setValueAtTime(freq, t0);
    f.Q.value = q || 6;
    const g = ctx.createGain();
    s.connect(f); f.connect(g); g.connect(master);
    env(g, t0, 0.001, decay, peak);
    s.start(t0);
    s.stop(t0 + decay + 0.05);
    s.onended = () => { try { s.disconnect(); f.disconnect(); g.disconnect(); } catch (e) { /* already gone */ } };
    return { f, g, t0 };
  }

  /* Encoder detent. Rate-limited hard: a fast sweep crosses dozens of notches
   * per second and firing all of them is a buzzsaw. Above the limit the clicks
   * merge into a single brighter tick, which is what a real fast-spun encoder
   * sounds like anyway. */
  function click(strength, pitch) {
    if (!started || !enabled) return;
    const now = ctx.currentTime;
    if (now - lastClickAt < 0.022) return;
    lastClickAt = now;
    const s = clamp(strength == null ? 1 : strength, 0.15, 1);
    noiseBurst(0.055 * s, 0.028, 1800 + (pitch || 0) * 900, 9);
    blip(760 + (pitch || 0) * 420, 'square', 0.018 * s, 0.001, 0.022, false);
  }

  /* Seating into a known detent — a deeper, rounder thunk than a plain notch,
   * so "I have arrived somewhere" and "I have moved a step" never sound alike. */
  function seat(pitch) {
    if (!started || !enabled) return;
    blip(196 * (1 + (pitch || 0) * 0.5), 'sine', 0.10, 0.004, 0.20, true);
    blip(392 * (1 + (pitch || 0) * 0.5), 'sine', 0.045, 0.003, 0.12, false);
    noiseBurst(0.03, 0.05, 420, 3);
  }

  /* Coherence waypoint — a small confirmation at 25/50/75%. Rises with the
   * mark so the three of them form a phrase rather than a repetition. */
  function step(mark, bandIndex) {
    if (!started || !enabled) return;
    const base = BAND_TONE[bandIndex] || 220;
    blip(base * (1 + mark), 'triangle', 0.05, 0.002, 0.11, true);
  }

  /* The payoff. A just-intonation chord on the band's own tone, so every layer
   * crystallises in its own key and the player learns the sound of each. */
  function crystal(bandIndex, rarity, potency) {
    if (!started || !enabled) return;
    const base = BAND_TONE[bandIndex] || 220;
    const ratios = rarity >= 2 ? [1, 5 / 4, 3 / 2, 2, 3] : rarity >= 1 ? [1, 5 / 4, 3 / 2, 2] : [1, 3 / 2, 2];
    const peak = 0.11 + clamp01(potency / 12) * 0.07;
    ratios.forEach((r, i) => {
      /* Stagger the partials by a few milliseconds. Simultaneous onsets sound
       * synthetic; a 6 ms spread reads as a struck object. */
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = i === 0 ? 'triangle' : 'sine';
      const t0 = ctx.currentTime + i * 0.006;
      o.frequency.setValueAtTime(base * r, t0);
      o.connect(g); g.connect(master); g.connect(verbGain);
      env(g, t0, 0.004, 0.55 + i * 0.12, peak / (1 + i * 0.55));
      o.start(t0); o.stop(t0 + 1.2);
      o.onended = () => { try { o.disconnect(); g.disconnect(); } catch (e) { /* already gone */ } };
    });
    noiseBurst(0.05, 0.28, base * 4, 2, 'bandpass');
  }

  /* Discovery. Bigger, slower, with an upward sweep — reserved for genuinely
   * new things so it never becomes wallpaper. */
  function discover(magnitude) {
    if (!started || !enabled) return;
    const m = magnitude || 1;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(160, t0);
    o.frequency.exponentialRampToValueAtTime(160 * (2 + m), t0 + 0.5);
    o.connect(g); g.connect(master); g.connect(verbGain);
    env(g, t0, 0.02, 1.1, 0.10);
    o.start(t0); o.stop(t0 + 1.4);
    o.onended = () => { try { o.disconnect(); g.disconnect(); } catch (e) { /* already gone */ } };
    [1, 3 / 2, 2, 5 / 2].forEach((r, i) => {
      setTimeout(() => blip(220 * r, 'sine', 0.06, 0.006, 0.7, true), i * 90);
    });
  }

  /* Reality changing out from under the player. A filtered noise sweep — the
   * sound of the render target being torn down. */
  function upheaval(strength) {
    if (!started || !enabled) return;
    const t0 = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 2.5;
    f.frequency.setValueAtTime(180, t0);
    f.frequency.exponentialRampToValueAtTime(5200, t0 + 0.45);
    const g = ctx.createGain();
    s.connect(f); f.connect(g); g.connect(master); g.connect(verbGain);
    env(g, t0, 0.01, 0.6, 0.05 * clamp(strength || 1, 0.3, 1.6));
    s.start(t0); s.stop(t0 + 0.9);
    s.onended = () => { try { s.disconnect(); f.disconnect(); g.disconnect(); } catch (e) { /* already gone */ } };
  }

  function purchase() {
    if (!started || !enabled) return;
    blip(523.25, 'sine', 0.07, 0.003, 0.14, true);
    setTimeout(() => blip(783.99, 'sine', 0.055, 0.003, 0.22, true), 70);
  }

  function deny() {
    if (!started || !enabled) return;
    blip(110, 'square', 0.05, 0.002, 0.09, false);
    blip(104, 'square', 0.04, 0.002, 0.11, false);
  }

  // --- lifecycle -----------------------------------------------------------

  /* Browsers require a user gesture before audio starts. Called from the first
   * pointer event rather than on load. */
  function unlock() {
    if (!started) { if (!init()) return false; }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  function setEnabled(on) {
    enabled = !!on;
    if (started && master) {
      master.gain.setTargetAtTime(enabled ? MASTER : 0, ctx.currentTime, 0.05);
    }
  }

  function suspend() { if (started && ctx.state === 'running') ctx.suspend(); }
  function resume() { if (started && ctx.state === 'suspended') ctx.resume(); }
  function isEnabled() { return enabled; }
  function isReady() { return started; }

  RS.audio = {
    BAND_TONE, BEAT_SCALE,
    init, unlock, setEnabled, isEnabled, isReady, suspend, resume,
    updateDrone, updateRamp, updateBed, updateMachinery, footfall, BEDS,
    click, seat, step, crystal, discover, upheaval, purchase, deny
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
