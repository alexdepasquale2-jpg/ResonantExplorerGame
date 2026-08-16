/* Resonant — inhabitable minds.
 *
 * A "vessel" in this game is not always a machine. The most interesting thing
 * a point of consciousness can occupy is another mind, and this module is what
 * makes that literal: every creature, drone and ship carries a small recurrent
 * neural network whose weights are *derived from its address*, exactly like
 * everything else in the world. Nothing is trained, nothing is stored, and two
 * players who visit the same creature meet the same mind.
 *
 * ── Why a real network instead of a behaviour state machine ────────────────
 *
 * Because the brief asks for emergent outcomes, and a state machine can only
 * produce the states someone wrote down. A recurrent net with random weights
 * is a dynamical system: it has attractors, limit cycles, hysteresis and
 * bifurcations that nobody designed. Feed it real sensory gradients and it
 * produces foraging, circling, fleeing, hesitation and stubbornness without
 * any of those being implemented. Two creatures with different hashes behave
 * *differently in kind*, not just with different constants.
 *
 * ── The influence mechanic ────────────────────────────────────────────────
 *
 * The player never sets a creature's outputs. They apply a bias vector — a
 * small additive pressure on the hidden units. That is genuinely indirect:
 * pushing a bias does not command a behaviour, it deforms the landscape the
 * behaviour lives in, and the result depends on where in state space the mind
 * currently is. Push gently and you nudge a tendency; push hard and you can
 * throw the system into a different attractor entirely, which may not be the
 * one you wanted. That is the whole fantasy of influencing a world rather than
 * ruling it, and it costs 200 multiply-adds.
 *
 * ── Cost ──────────────────────────────────────────────────────────────────
 *
 * N=10 hidden units, 6 inputs, 4 outputs: 100 + 60 + 40 = 200 MACs per tick
 * per mind, in flat Float32Arrays with no allocation. A hundred active minds
 * is 20k MACs a frame, which is nothing.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, hashF, hashN } = RS.core;

  const N_HIDDEN = 10;
  const N_IN = 6;
  const N_OUT = 4;

  /* Input channels. These are what a mind can know about its situation, and
   * deliberately no more — a creature does not get a map, it gets gradients.
   * Everything interesting the minds do comes from having to act on this. */
  const INPUTS = ['energy', 'threat', 'food', 'kin', 'light', 'bias'];
  /* Output channels, interpreted by whatever body the mind is driving. */
  const OUTPUTS = ['forward', 'turn', 'exert', 'signal'];

  /* Weight generation. Drawn from the address hash and scaled by 1/sqrt(fan-in)
   * — the standard initialisation — because unscaled weights saturate tanh
   * immediately and every mind ends up a rigid bang-bang controller instead of
   * a dynamical system. */
  function gaussian(h, i) {
    /* Box–Muller from two hashed uniforms. Cheap, and a normal distribution
     * matters here: uniform weights produce visibly duller dynamics. */
    const u1 = Math.max(1e-7, hashF(h, i * 2 + 1));
    const u2 = hashF(h, i * 2 + 2);
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  const cache = new Map();
  const CACHE_MAX = 512;

  /* Build (or fetch) the mind at an address. Cached because the weights are
   * pure and regenerating 200 Box–Muller draws per frame would be silly, but
   * the cache is a convenience, never a source of truth — evicting it changes
   * nothing about behaviour. */
  function mindAt(addrHash) {
    const key = addrHash >>> 0;
    let m = cache.get(key);
    if (m) return m;

    const Win = new Float32Array(N_HIDDEN * N_IN);
    const Wrec = new Float32Array(N_HIDDEN * N_HIDDEN);
    const Wout = new Float32Array(N_OUT * N_HIDDEN);
    const bias = new Float32Array(N_HIDDEN);

    const sIn = 1 / Math.sqrt(N_IN);
    const sRec = 1 / Math.sqrt(N_HIDDEN);
    let k = 0;
    for (let i = 0; i < Win.length; i++) Win[i] = gaussian(addrHash, k++) * sIn;
    /* Recurrent weights get a spectral scale slightly above 1. Below it every
     * mind decays to a fixed point and does nothing; far above it saturates
     * into noise. Just above is the edge-of-chaos band where the interesting
     * dynamics — persistent activity, slow oscillation, sensitivity to input —
     * actually live. */
    const gain = 1.05 + hashF(addrHash, 999) * 0.35;
    for (let i = 0; i < Wrec.length; i++) Wrec[i] = gaussian(addrHash, k++) * sRec * gain;
    for (let i = 0; i < Wout.length; i++) Wout[i] = gaussian(addrHash, k++) * sRec;
    for (let i = 0; i < bias.length; i++) bias[i] = gaussian(addrHash, k++) * 0.25;

    m = { hash: addrHash, Win, Wrec, Wout, bias, gain };
    if (cache.size >= CACHE_MAX) {
      /* Evict oldest — Map preserves insertion order, so this is exact LRU-ish
       * without keeping a second structure. */
      cache.delete(cache.keys().next().value);
    }
    cache.set(key, m);
    return m;
  }

  /* Per-agent mutable state. Separate from the weights so many agents can
   * share one mind (a swarm of the same species) while each thinks its own
   * thoughts. */
  function newState() {
    return {
      h: new Float32Array(N_HIDDEN),
      out: new Float32Array(N_OUT),
      /* The player's applied bias — the influence channel. Sparse in practice:
       * almost always all zeros. */
      influence: new Float32Array(N_HIDDEN),
      influenceMag: 0,
      /* How much of the mind's activity is currently the player's doing, 0..1.
       * Shown to the player, because influencing something without being able
       * to see how much you are distorting it is not a mechanic, it is a
       * mystery. */
      possession: 0,
      arousal: 0
    };
  }

  const tanh = Math.tanh;

  /* One step. `inputs` is a Float32Array of length N_IN, already normalised to
   * roughly [-1, 1] by the caller. No allocation anywhere in here. */
  function step(mind, st, inputs, dt) {
    const { Win, Wrec, Wout, bias } = mind;
    const h = st.h, out = st.out, inf = st.influence;

    /* Leak factor: the hidden state is a leaky integrator rather than a pure
     * map, which makes the dynamics continuous in dt and therefore stable
     * across framerates. A pure discrete RNN would behave differently on a
     * 144 Hz display, which for a game about influencing minds would be a
     * genuinely nasty bug. */
    const leak = 1 - Math.exp(-dt * 6);

    let act = 0, infSum = 0;
    for (let i = 0; i < N_HIDDEN; i++) {
      let s = bias[i] + inf[i];
      const rowIn = i * N_IN;
      for (let j = 0; j < N_IN; j++) s += Win[rowIn + j] * inputs[j];
      const rowRec = i * N_HIDDEN;
      for (let j = 0; j < N_HIDDEN; j++) s += Wrec[rowRec + j] * h[j];
      const target = tanh(s);
      h[i] += (target - h[i]) * leak;
      act += Math.abs(h[i]);
      infSum += Math.abs(inf[i]);
    }

    for (let o = 0; o < N_OUT; o++) {
      let s = 0;
      const row = o * N_HIDDEN;
      for (let j = 0; j < N_HIDDEN; j++) s += Wout[row + j] * h[j];
      out[o] = tanh(s);
    }

    st.arousal = act / N_HIDDEN;
    st.influenceMag = infSum;
    /* Possession is the share of total drive coming from the player. It rises
     * as you push and decays as you stop, so it reads as a live gauge of how
     * much of this creature is currently you. */
    st.possession = clamp01(infSum / (act + infSum + 1e-6));
    return out;
  }

  /* Apply player influence. `vec` is a direction in hidden space and `amount`
   * is how hard to push; the push decays on its own, so influence is a
   * sustained act rather than a permanent edit. That decay is what stops the
   * mechanic from being mind control with extra steps. */
  function influence(st, vec, amount, dt) {
    const inf = st.influence;
    for (let i = 0; i < N_HIDDEN; i++) {
      inf[i] += (vec[i] || 0) * amount * dt;
      inf[i] = clamp(inf[i], -2.5, 2.5);
    }
  }

  function relax(st, dt) {
    const inf = st.influence;
    const decay = Math.exp(-dt * 0.9);
    for (let i = 0; i < N_HIDDEN; i++) inf[i] *= decay;
  }

  /* Direct inhabitation: the player's four dials are projected into hidden
   * space as a strong bias. This is what "inhabiting" means mechanically —
   * you are not replacing the mind, you are leaning on it so hard that its own
   * dynamics become a texture on top of your intent. A stubborn creature (high
   * recurrent gain) still fights you, which is the good part. */
  const dialVec = new Float32Array(N_HIDDEN);
  function pilotVector(mind, forward, turn, exert, signal) {
    /* Project the desired *outputs* back through Wout to find a hidden-space
     * direction that produces them. A transpose is not an inverse, but it
     * points the right way, and being approximate is thematically correct:
     * you are pushing on a mind, not driving a machine. */
    const W = mind.Wout;
    for (let i = 0; i < N_HIDDEN; i++) {
      dialVec[i] =
        W[0 * N_HIDDEN + i] * forward +
        W[1 * N_HIDDEN + i] * turn +
        W[2 * N_HIDDEN + i] * exert +
        W[3 * N_HIDDEN + i] * signal;
    }
    return dialVec;
  }

  /* A one-number summary of a mind's character, for the readout. Derived from
   * the weights, so it is stable and honest rather than a label. */
  function temperament(mind) {
    let excite = 0, inhibit = 0;
    for (let i = 0; i < mind.Wrec.length; i++) {
      if (mind.Wrec[i] > 0) excite += mind.Wrec[i]; else inhibit -= mind.Wrec[i];
    }
    const balance = (excite - inhibit) / (excite + inhibit + 1e-6);
    return {
      volatility: clamp01((mind.gain - 1.0) / 0.45),
      balance,
      /* High gain and positive balance means it commits hard to whatever it is
       * already doing — stubborn. Negative balance means it second-guesses. */
      label: mind.gain > 1.28
        ? (balance > 0.05 ? 'driven' : 'volatile')
        : (balance > 0.05 ? 'steady' : 'skittish')
    };
  }

  function clearCache() { cache.clear(); }

  RS.neural = {
    N_HIDDEN, N_IN, N_OUT, INPUTS, OUTPUTS,
    mindAt, newState, step, influence, relax, pilotVector, temperament, clearCache,
    get cacheSize() { return cache.size; }
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
