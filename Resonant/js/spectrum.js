/* Resonant — the spectrum. Frequency bands *are* the reality layers.
 *
 * The FREQUENCY dial sweeps a continuous axis measured in φ (phi, the game's
 * attunement unit). Reality layers sit on that axis as Gaussian bands. Tuning
 * near a band's centre makes that layer manifest: its palette bleeds into the
 * field, its patterns take over the geometry, and — crucially — its *rules*
 * replace the rules you were playing under a moment ago.
 *
 * Three dial upgrades gate the spectrum, and they gate different things:
 *
 *   RANGE     extends how far up the axis the dial can physically reach.
 *             Without it the high bands are not hard, they are unreachable.
 *   PRECISION shrinks the smallest movement you can make. High bands are
 *             narrow; without precision you step straight over them.
 *   FOCUS     narrows your own carrier and raises its peak. Below a band's
 *             `minFocus` your signal is too smeared to make it cohere at all,
 *             so it shows as a ghost you can see but cannot hold.
 *
 * That is the progression the whole game hangs off: reach it, land on it,
 * hold it.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01 } = RS.core;

  /* ── `prim` is the layer's gameplay ───────────────────────────────────────
   *
   * A band does not have a hand-written mode. It declares which of the six
   * primitives in emergence.js are live, and everything else follows: the
   * primitive is parameterised by the *node's own essence* (its four axes) and
   * scaled by the *tier's clock*. So one band is already many different things
   * — Electromagnetic is a five-stroke burst when the node is a Cascade and a
   * single even beat when it is a Lattice, fast at the cellular scale and vast
   * at the supercluster one.
   *
   * Difficulty is derived from this rather than tuned: a band demanding six
   * primitives is harder than one demanding one, which is why the list length
   * drives `field.demandsFor()`.
   *
   * `mode` is kept alongside as a human-readable label and for the codex; it is
   * no longer read by the simulation.
   *
   *   accretion   — incremental: dense, slow, passive yield, compounding
   *   flux        — tracking: nodes drift fast, alignment leaks constantly
   *   pulse       — action/rhythm: nodes gate on and off, timing windows
   *   superposed  — puzzle: nodes exist twice, only one is real until locked
   *   valence     — attract/repel social physics, patterns bloom from mood
   *   recursive   — nodes contain nodes; locking one reveals its children
   *   causal      — locking A only works after its antecedent B is locked
   *   symbolic    — nodes are glyph puzzles; signature must be read, not swept
   *   inverted    — the null layer: alignment is scored by *mismatch*
   *   unity       — every band at once, no discrimination possible
   */
  const BANDS = [
    {
      id: 'baryonic', name: 'Baryonic', glyph: '◉',
      centre: 8, width: 7.5, minFocus: 0, hue: 205, sat: 0.34, mode: 'accretion',
      prim: ['flow'],
      blurb: 'Matter as it presents itself. The layer consciousness is issued with.',
      rules: 'Dense, slow, forgiving. Yield accrues without attention.',
      yield: 1.0, drift: 0.35, unlockedAtStart: true
    },
    {
      id: 'thermal', name: 'Thermal', glyph: '≋',
      centre: 44, width: 6.0, minFocus: 0, hue: 24, sat: 0.62, mode: 'flux',
      prim: ['flow'],
      blurb: 'Disorder made visible. Everything here is on its way to equilibrium.',
      rules: 'Nodes drift and cool. Coherence leaks unless you keep tracking.',
      yield: 1.5, drift: 1.5
    },
    {
      id: 'electromagnetic', name: 'Electromagnetic', glyph: '⌇',
      centre: 97, width: 4.6, minFocus: 0.15, hue: 187, sat: 0.75, mode: 'pulse',
      prim: ['gate'],
      blurb: 'The layer that carries every message the baryonic layer ever sends.',
      rules: 'Nodes gate on and off. Lock only counts inside the open window.',
      yield: 2.3, drift: 0.9
    },
    {
      id: 'probabilistic', name: 'Probabilistic', glyph: '⟡',
      centre: 168, width: 3.6, minFocus: 0.30, hue: 268, sat: 0.70, mode: 'superposed',
      prim: ['twin'],
      blurb: 'Where outcomes have not yet been asked to choose.',
      rules: 'Each node manifests twice. Only one is load-bearing until observed.',
      yield: 3.4, drift: 1.1
    },
    {
      id: 'vital', name: 'Vital', glyph: '⚘',
      centre: 253, width: 3.0, minFocus: 0.42, hue: 142, sat: 0.66, mode: 'recursive',
      prim: ['nest', 'flow'],
      blurb: 'Negative entropy, held against the gradient. What life looks like from outside.',
      rules: 'Nodes nest. Locking a parent exposes its children — depth is the payout.',
      yield: 5.0, drift: 0.7
    },
    {
      id: 'emotive', name: 'Emotional', glyph: '❥',
      centre: 341, width: 2.5, minFocus: 0.55, hue: 336, sat: 0.78, mode: 'valence',
      prim: ['flow', 'twin'],
      blurb: 'The first layer that reacts to being observed. Its geometry is its mood.',
      rules: 'Valence attracts and repels. Patterns and colour bloom with feeling.',
      yield: 7.4, drift: 1.3
    },
    {
      id: 'mnemonic', name: 'Mnemonic', glyph: '⌘',
      centre: 437, width: 2.1, minFocus: 0.64, hue: 47, sat: 0.60, mode: 'symbolic',
      prim: ['order', 'nest'],
      blurb: 'Everything that has been recorded, indexed by resemblance rather than time.',
      rules: 'Signatures must be read off the glyph. Sweeping blind will not find them.',
      yield: 11.0, drift: 0.5
    },
    {
      id: 'causal', name: 'Causal', glyph: '⇴',
      centre: 542, width: 1.75, minFocus: 0.72, hue: 12, sat: 0.72, mode: 'causal',
      prim: ['order'],
      blurb: 'The dependency graph underneath events. Time is a projection of this.',
      rules: 'A node cannot be held before its antecedent. Order is the puzzle.',
      yield: 16.0, drift: 0.6
    },
    {
      id: 'archetypal', name: 'Archetypal', glyph: '☉',
      centre: 655, width: 1.45, minFocus: 0.78, hue: 279, sat: 0.82, mode: 'symbolic',
      prim: ['nest', 'order'],
      blurb: 'The small set of shapes every other layer keeps rediscovering.',
      rules: 'Essences appear undisguised here. Recognition is worth more than yield.',
      yield: 23.0, drift: 0.4
    },
    {
      id: 'noetic', name: 'Noetic', glyph: '◈',
      centre: 771, width: 1.15, minFocus: 0.84, hue: 168, sat: 0.74, mode: 'recursive',
      prim: ['nest', 'gate', 'flow'],
      blurb: 'Knowing without inference. The layer where the fractal store is legible.',
      rules: 'Nesting runs arbitrarily deep. Descend as far as focus will hold.',
      yield: 34.0, drift: 0.35
    },
    {
      id: 'null', name: 'Null', glyph: '○',
      centre: 883, width: 0.9, minFocus: 0.86, hue: 220, sat: 0.10, mode: 'inverted',
      prim: ['invert'],
      blurb: 'The absence that the other layers are figure against.',
      rules: 'Alignment is scored inverted. Everything you learned reads backwards.',
      yield: 52.0, drift: 0.9
    },
    {
      id: 'unity', name: 'Unity', glyph: '✷',
      centre: 977, width: 0.65, minFocus: 0.90, hue: 0, sat: 0.0, mode: 'unity',
      prim: ['gate', 'nest', 'flow', 'order', 'twin', 'invert'],
      blurb: 'One band containing all the others. Discrimination stops working here.',
      rules: 'Every layer manifests at once. There is nothing left to tune against.',
      yield: 88.0, drift: 0.25
    }
  ];

  const BY_ID = Object.create(null);
  BANDS.forEach((b, i) => {
    b.index = i;
    BY_ID[b.id] = b;
    /* Every band must declare at least one primitive or it has no gameplay. */
    if (!b.prim || !b.prim.length) b.prim = ['flow'];
  });

  /* Does this band run this primitive? Hot path — called per node per frame. */
  function usesPrim(band, id) { return band.prim.indexOf(id) >= 0; }

  /* How many axes a band asks of the player. Derived, not authored: it is
   * simply how many primitives are live, which is also exactly how much there
   * is to think about. */
  function demandOf(band) { return band.prim.length; }

  /* ── Paying for friction ──────────────────────────────────────────────────
   *
   * `yield` is a promise; what a layer actually pays is yield × throughput,
   * and the primitives move throughput by nearly an order of magnitude. A gate
   * shuts you out for half of every cycle. A missing antecedent stops you
   * outright. A nest hands you children without a search. Left alone, the
   * Electromagnetic layer paid two thirds of what the tutorial layer did,
   * which means climbing the spectrum was a demotion.
   *
   * These six numbers buy that back. They are per *primitive*, not per band —
   * six instead of twelve — so composing a new band cannot silently create a
   * dead layer, and adding a primitive to an existing one automatically prices
   * itself in.
   *
   * Additive rather than multiplicative on purpose: Unity runs all six, and
   * multiplying would make the last band pay seventy times what the second-
   * last does rather than a handful.
   */
  const FRICTION = { gate: 1.4, twin: 1.0, order: 2.0, invert: 0.4, nest: 0.0, flow: 0.0 };

  function frictionOf(band) {
    let sum = 0;
    for (let i = 0; i < band.prim.length; i++) sum += FRICTION[band.prim[i]] || 0;
    return 1 + sum;
  }

  const PHI_MIN = 0;
  const PHI_MAX = 1000;

  /* Effective half-width of a band given the observer's focus. Focus narrows
   * the carrier, which makes the band *harder to hit* but *stronger when hit*
   * — the classic radio-tuning trade, and the reason focus upgrades feel like
   * a real decision rather than a straight buff. */
  function effWidth(band, focus) {
    /* At focus 0 you are smeared across ~2.2× the nominal width; at focus 1
     * you sit at 0.45×. */
    return band.width * (2.2 - 1.75 * clamp01(focus));
  }

  /* How strongly a band manifests at dial position `phi`.
   *
   * Gaussian in the distance from centre, then gated by focus: under the
   * band's minFocus the result is scaled hard toward zero so the layer is
   * visible as a ghost but cannot be worked. That "I can see it and can't
   * reach it yet" state is deliberate — it is the game's advertising for its
   * own upgrades. */
  function resonanceOf(band, phi, focus) {
    const w = effWidth(band, focus);
    const d = (phi - band.centre) / w;
    const raw = Math.exp(-d * d);
    if (raw < 1e-4) return 0;
    /* The gate ramp is narrow (0.06) on purpose: crossing a band's focus
     * threshold should feel like a switch closing, not like a slider creeping.
     * Every `minFocus` above is set below RS.dials.MAX_FOCUS by more than this
     * ramp, so a fully-focused observer reaches gate 1 on every band — simtest
     * asserts it, because a ramp that merely *approaches* 1 would leave the
     * final layers permanently dimmed with no way for a player to tell whether
     * they had missed an upgrade or hit a wall. */
    const gate = band.minFocus <= 0 ? 1 : clamp01((focus - band.minFocus) / 0.06 + 0.001);
    /* Even fully gated out, leave a sliver so the band renders as a ghost. */
    return raw * (0.06 + 0.94 * gate);
  }

  /* Is the band gated purely by focus — i.e. would it be manifesting if the
   * observer were sharper? Drives the "GHOST" tag in the HUD. */
  function isGhost(band, focus) { return focus < band.minFocus; }

  /* Full spectrum sample: resonance for every band at once, normalised into a
   * blend the renderer can mix. Called every frame, so it writes into a
   * caller-owned array rather than allocating. */
  function sample(phi, focus, out) {
    const arr = out || [];
    arr.length = BANDS.length;
    let total = 0, top = 0, topIdx = 0;
    for (let i = 0; i < BANDS.length; i++) {
      const r = resonanceOf(BANDS[i], phi, focus);
      arr[i] = r;
      total += r;
      if (r > top) { top = r; topIdx = i; }
    }
    arr.total = total;
    arr.dominant = BANDS[topIdx];
    arr.dominance = total > 0 ? top / total : 0;
    arr.peak = top;
    return arr;
  }

  /* Blended visual identity of the current tuning. When two bands overlap the
   * hue lands between them — the "reality bleed" that tells you, without any
   * text, that you are between layers. */
  function blendVisual(spec) {
    let x = 0, y = 0, sat = 0, wsum = 0;
    for (let i = 0; i < BANDS.length; i++) {
      const w = spec[i];
      if (w <= 0.001) continue;
      const a = BANDS[i].hue * Math.PI / 180;
      x += Math.cos(a) * w; y += Math.sin(a) * w;
      sat += BANDS[i].sat * w; wsum += w;
    }
    if (wsum <= 0) return { hue: 210, sat: 0.1, strength: 0 };
    let hue = Math.atan2(y, x) * 180 / Math.PI;
    if (hue < 0) hue += 360;
    /* Vector-averaging hues cancels when bands are opposite on the wheel; that
     * cancellation is meaningful (mixed layers desaturate), so feed the
     * magnitude back into saturation rather than hiding it. */
    const coherence = Math.sqrt(x * x + y * y) / wsum;
    return { hue, sat: (sat / wsum) * (0.35 + 0.65 * coherence), strength: clamp01(wsum) };
  }

  /* Bands the observer could reach with the dial's current maximum, used by
   * the HUD to draw the unreachable remainder of the spectrum as a locked
   * shelf rather than hiding it. Showing the whole axis from the first minute
   * is intentional: the player should always be able to see how much reality
   * they have not yet touched. */
  function bandsWithin(maxPhi) { return BANDS.filter(b => b.centre - b.width <= maxPhi); }

  function nearestBand(phi) {
    let best = BANDS[0], bd = Infinity;
    for (const b of BANDS) {
      const d = Math.abs(b.centre - phi);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  /* Beat frequency between the observer's carrier and a band centre.
   *
   * This is the single most important number in the game's feedback design.
   * Two nearby tones beat at the difference of their frequencies: far off, a
   * fast warble; close, a slow throb; dead on, silence and a steady tone. It
   * is how a guitar gets tuned, and it means a player can find a band with
   * their eyes shut. audio.js turns this into an actual audible beat and
   * render.js turns the same number into a pulsing ring. */
  function beatHz(phi, band) { return Math.abs(phi - band.centre); }

  RS.spectrum = {
    BANDS, BY_ID, PHI_MIN, PHI_MAX,
    effWidth, resonanceOf, isGhost, sample, blendVisual, bandsWithin, nearestBand, beatHz,
    usesPrim, demandOf, frictionOf, FRICTION
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
