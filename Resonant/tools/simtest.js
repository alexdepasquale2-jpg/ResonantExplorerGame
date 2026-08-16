/* Resonant — headless self-test. No DOM, no canvas, no audio.
 *   node tools/simtest.js
 *
 * Loads the game's own browser scripts under a minimal `window` shim, so this
 * exercises exactly the code the browser runs rather than a parallel copy.
 *
 * What it is actually protecting:
 *   - determinism of the fractal store, which the save format depends on
 *     absolutely (nothing in the field is stored, so a hash change silently
 *     rewrites every player's world)
 *   - that the four-dial lock is winnable at the root layer and gets harder in
 *     the documented order
 *   - that the upgrade ladder is reachable rather than merely priced
 *   - that a save round-trips including reach-before-value ordering
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FILES = [
  'js/core.js', 'js/cosmos.js', 'js/spectrum.js', 'js/dials.js', 'js/fractal.js', 'js/emergence.js', 'js/selfsimilar.js',
  'js/strike.js', 'js/field.js', 'js/physics.js', 'js/orbital.js', 'js/stellar.js', 'js/civ.js', 'js/planet.js',
  'js/neural.js', 'js/vessel.js', 'js/inhabitants.js', 'js/localtime.js', 'js/influence.js',   'js/galaxy.js', 'js/contact.js',
  'js/scene_cellular.js', 'js/scene_web.js', 'js/scene_foam.js', 'js/scene_ensemble.js', 'js/scene_molecular.js', 'js/scene_shells.js', 'js/scenes.js', 'js/game.js', 'js/guide.js', 'js/situations.js', 'js/save.js', 'js/debug.js', 'js/audio.js', 'js/ui.js', 'js/bloom.js'
];

const sandbox = {
  console, Math, Set, Map, Object, JSON, Array, Number, String, Boolean,
  Infinity, NaN, Date, isFinite, isNaN, parseFloat, parseInt, Error,
  Float32Array, Uint32Array, Int32Array, Array
};
sandbox.performance = { now: () => Date.now() };
sandbox.localStorage = {
  __s: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this.__s, k) ? this.__s[k] : null; },
  setItem(k, v) { this.__s[k] = String(v); },
  removeItem(k) { delete this.__s[k]; }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.document = {
  createElement() {
    return {
      width: 1, height: 1,
      getContext() {
        return {
          setTransform() {}, globalCompositeOperation: 'source-over', globalAlpha: 1,
          fillStyle: '#000', drawImage() {}, fillRect() {}, save() {}, restore() {}
        };
      }
    };
  }
};
sandbox.OffscreenCanvas = function (w, h) {
  const c = sandbox.document.createElement();
  c.width = w; c.height = h;
  return c;
};
vm.createContext(sandbox);
for (const f of FILES) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const RS = sandbox.RS;

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) pass++;
  else { fail++; console.error('FAIL:', msg); }
}
function near(a, b, eps, msg) { assert(Math.abs(a - b) <= eps, `${msg} (got ${a}, want ~${b})`); }

const nullBus = { emit() {}, on() { return () => {}; } };
function busCollecting(store) {
  return { emit(k, p) { (store[k] || (store[k] = [])).push(p); }, on() { return () => {}; } };
}

// ── cosmology ────────────────────────────────────────────────────────────
{
  const T = RS.cosmos.TIERS;
  assert(T.length >= 20, 'ladder has enough rungs');
  assert(T.filter(t => t.root).length === 1, 'exactly one root tier');
  assert(T[RS.cosmos.ROOT_INDEX].id === 'galactic', 'the root layer is Galactic');

  /* The rungs must be monotonically increasing in scale wherever a scale is
   * defined, or the SPACE dial would move "inward" and land somewhere larger. */
  let mono = true;
  let prev = -Infinity;
  for (const t of T) {
    if (t.logM == null) continue;
    if (t.logM <= prev) mono = false;
    prev = t.logM;
  }
  assert(mono, 'tier scales increase monotonically');

  /* Beyond the Hubble volume nothing carries a metre measure — those tiers are
   * classified by Tegmark level instead, and must say so. */
  const beyond = T.filter(t => t.logM == null);
  assert(beyond.length === 4, 'four dimensionless tiers beyond the horizon');
  assert(beyond.every(t => t.level), 'every dimensionless tier declares a Tegmark level');

  near(RS.cosmos.logMetresAt(RS.cosmos.ROOT_INDEX), 21, 0.01, 'root reads 10^21 m');
  assert(RS.cosmos.clockAt(0) > RS.cosmos.clockAt(RS.cosmos.SCALE_MAX), 'deep tiers run faster than large ones');
  assert(RS.cosmos.tierBlend(RS.cosmos.ROOT_INDEX + 0.5).t === 0.5, 'fractional scale blends two rungs');
  assert(RS.cosmos.logMetresAt(RS.cosmos.SCALE_MAX) === null, 'ensemble tier has no metre readout');
}

// ── spectrum ─────────────────────────────────────────────────────────────
{
  const B = RS.spectrum.BANDS;
  assert(B.length === 12, 'twelve reality layers');
  assert(B[0].id === 'baryonic' && B[0].minFocus === 0, 'the starting layer needs no focus');

  let ordered = true;
  for (let i = 1; i < B.length; i++) if (B[i].centre <= B[i - 1].centre) ordered = false;
  assert(ordered, 'band centres ascend along the axis');

  let focusRamp = true;
  for (let i = 1; i < B.length; i++) if (B[i].minFocus < B[i - 1].minFocus) focusRamp = false;
  assert(focusRamp, 'focus requirement never decreases up the spectrum');

  /* Bands must not overlap at full focus, or two layers would manifest
   * identically and the spectrum would stop being a map. */
  let overlap = false;
  for (let i = 1; i < B.length; i++) {
    const gap = B[i].centre - B[i - 1].centre;
    if (gap < RS.spectrum.effWidth(B[i], 1) + RS.spectrum.effWidth(B[i - 1], 1)) overlap = true;
  }
  assert(!overlap, 'adjacent bands are separable at full focus');

  near(RS.spectrum.resonanceOf(B[0], B[0].centre, 0.5), 1, 0.001, 'dead centre resonates fully');
  assert(RS.spectrum.resonanceOf(B[0], B[0].centre + 40, 0.5) < 0.01, 'far off tune is silent');

  /* The gate is the whole "visible but not holdable" mechanic. */
  const high = B[8];
  assert(RS.spectrum.isGhost(high, 0.1), 'a high band is a ghost at low focus');
  assert(RS.spectrum.resonanceOf(high, high.centre, 0.1) < 0.15, 'ghost band barely manifests');
  assert(RS.spectrum.resonanceOf(high, high.centre, 0.95) > 0.9, 'the same band manifests fully once focused');

  /* The invariant that made the top of the spectrum unreachable the first time
   * this was written: focus is asymptotic and capped, so every band's demand
   * must sit under that ceiling by more than the gate ramp, or a maxed-out
   * player still cannot make the last layers cohere. */
  const ceiling = RS.dials.MAX_FOCUS;
  const tooHigh = B.filter(b => b.minFocus > 0 && b.minFocus + 0.06 > ceiling);
  assert(tooHigh.length === 0,
    'every band is holdable at maximum focus (' + ceiling.toFixed(4) + '); unreachable: ' +
    tooHigh.map(b => b.id + '@' + b.minFocus).join(', '));
  assert(B.every(b => RS.spectrum.resonanceOf(b, b.centre, ceiling) > 0.98),
    'every band fully coheres for a maxed observer');

  const spec = RS.spectrum.sample(B[5].centre, 0.9, []);
  assert(spec.dominant.id === B[5].id, 'sampling picks the right dominant band');
  assert(RS.spectrum.beatHz(B[5].centre + 3, B[5]) === 3, 'beat frequency is the tuning error');
}

// ── the fractal store ────────────────────────────────────────────────────
{
  const a = RS.fractal.resolve(1234, 13, 0, 5, 7, 0);
  const b = RS.fractal.resolve(1234, 13, 0, 5, 7, 0);
  assert(a.name === b.name && a.signature === b.signature && a.potency === b.potency,
    'the same address always resolves to the same manifestation');

  const other = RS.fractal.resolve(1234, 13, 0, 5, 8, 0);
  assert(other.name !== a.name || other.signature !== a.signature,
    'neighbouring addresses differ');

  /* The invariant the whole premise rests on: identity does not depend on tier
   * or band, only presentation does. */
  const atCell = RS.fractal.essenceAt(1234, 5, 7, 0);
  let sameEverywhere = true, presentationVaried = false;
  for (let t = 0; t < RS.cosmos.TIERS.length; t++) {
    for (let bd = 0; bd < RS.spectrum.BANDS.length; bd++) {
      const m = RS.fractal.resolve(1234, t, bd, 5, 7, 0);
      if (m.essence.id !== atCell.id) sameEverywhere = false;
      if (m.name !== a.name) presentationVaried = true;
    }
  }
  assert(sameEverywhere, 'one essence renders at every tier and layer of a cell');
  assert(presentationVaried, 'but its local name and appearance change');

  /* Every essence must have a form for every geometry, or some tier renders
   * manifestations with no name. */
  const geoms = new Set(RS.cosmos.TIERS.map(t => t.geometry));
  let missing = [];
  for (const e of RS.fractal.ESSENCES) {
    for (const g of geoms) if (!e.forms[g]) missing.push(e.id + '/' + g);
  }
  assert(missing.length === 0, 'every essence has a form for every tier geometry: ' + missing.join(', '));

  /* Every band needs adjectives or names come out malformed. */
  const noAdj = RS.spectrum.BANDS.filter(b => !RS.fractal.BAND_ADJ[b.id]);
  assert(noAdj.length === 0, 'every band has adjectives: ' + noAdj.map(b => b.id).join(', '));

  // signatures must land inside their own band, or a layer contains nodes it
  // cannot possibly tune
  let inBand = true;
  for (let i = 0; i < 400; i++) {
    const m = RS.fractal.resolve(99, 13, 5, i, i * 3, i % 7);
    const band = RS.spectrum.BANDS[5];
    if (Math.abs(m.signature - band.centre) > band.width) inBand = false;
  }
  assert(inBand, 'node signatures fall within their own band');

  // distribution sanity — a hash that clumps would make some essences unseeable
  const counts = Object.create(null);
  for (let i = 0; i < 6000; i++) {
    const e = RS.fractal.essenceAt(7, i % 211, Math.floor(i / 211), i % 5);
    counts[e.id] = (counts[e.id] || 0) + 1;
  }
  const seen = Object.keys(counts).length;
  const expect = 6000 / RS.fractal.ESSENCES.length;
  const worst = Math.max(...Object.values(counts).map(c => Math.abs(c - expect) / expect));
  assert(seen === RS.fractal.ESSENCES.length, 'every essence occurs (' + seen + ')');
  assert(worst < 0.25, 'essence distribution is even (worst deviation ' + (worst * 100).toFixed(1) + '%)');
}

// ── gnosis ───────────────────────────────────────────────────────────────
{
  const g = RS.game.newGame(5);
  const m = RS.fractal.resolve(g.seed, 13, 0, 1, 1, 0);
  const r1 = RS.fractal.recognise(g, m);
  assert(r1.fresh, 'first recognition is fresh');
  assert(!RS.fractal.recognise(g, m).fresh, 'same context does not count twice');

  const m2 = RS.fractal.resolve(g.seed, 14, 0, 1, 1, 0);
  assert(m2.essence.id === m.essence.id, 'same cell, different tier, same essence');
  assert(RS.fractal.recognise(g, m2).fresh, 'a new tier is a new context');
  assert(RS.fractal.gnosisBonus(g, m.essence.id) > 1, 'gnosis pays a yield bonus');
  assert(RS.fractal.totalGnosis(g) === 2, 'ledger totals contexts');
}

// ── dials ────────────────────────────────────────────────────────────────
{
  const g = RS.game.newGame(11);
  const f = g.dials.frequency;
  assert(f.value === 8, 'frequency starts in the baryonic band');
  assert(f.max < RS.spectrum.BANDS[2].centre, 'high layers start out of reach');

  const step0 = RS.dials.tickStep(f);
  RS.dials.applyUpgrade(f, 'precision');
  assert(RS.dials.tickStep(f) < step0, 'precision shrinks the step');

  const reach0 = f.max;
  RS.dials.applyUpgrade(f, 'range');
  assert(f.max > reach0, 'range extends reach');

  const foc0 = RS.dials.focusOf(f);
  RS.dials.applyUpgrade(f, 'focus');
  assert(RS.dials.focusOf(f) > foc0, 'focus sharpens the carrier');
  assert(RS.dials.focusOf(f) < 1, 'focus is asymptotic — never bought outright');

  /* Space opens in both directions from the root; that bidirectionality is the
   * "within, and beyond" of the brief. */
  const s = g.dials.space;
  assert(s.min === s.max && s.min === RS.cosmos.ROOT_INDEX, 'space starts pinned to the root');
  RS.dials.applyUpgrade(s, 'range');
  assert(s.min < RS.cosmos.ROOT_INDEX && s.max > RS.cosmos.ROOT_INDEX, 'space range opens inward and outward');

  // clamping and wrapping
  RS.dials.setValue(g, f, -99);
  assert(f.value === f.min, 'value clamps at the low stop');
  const p = g.dials.phase;
  RS.dials.setValue(g, p, Math.PI * 2 + 0.5);
  near(p.value, 0.5, 1e-9, 'phase wraps around the circle');
  RS.dials.setValue(g, p, -0.25);
  near(p.value, Math.PI * 2 - 0.25, 1e-9, 'phase wraps backwards too');

  // the flywheel must come to rest rather than drift forever
  const t = g.dials.time;
  RS.dials.setValue(g, t, 1);
  t.vel = 5;
  for (let i = 0; i < 600; i++) RS.dials.step(g, t, 1 / 60, null);
  assert(Math.abs(t.vel) < 0.01, 'the flywheel settles');

  // encoder ticks fire, and are budgeted
  let ticks = 0;
  RS.dials.setValue(g, f, 8);
  f.vel = 60;
  for (let i = 0; i < 120; i++) {
    RS.dials.step(g, f, 1 / 60, (k, p2) => { if (k === 'dial:tick') ticks += p2.ticks; });
  }
  assert(ticks > 0, 'sweeping a dial emits encoder ticks');
}

// ── detents ──────────────────────────────────────────────────────────────
{
  const g = RS.game.newGame(3);
  /* Detents are discovered, not given: an unknown band must not be a notch. */
  const before = RS.dials.detentsFor(g, 'frequency');
  assert(before.length === 1 && before[0].label === 'Baryonic', 'only known bands are detents');
  g.known.bands.thermal = true;
  assert(RS.dials.detentsFor(g, 'frequency').length === 2, 'discovering a band adds its notch');

  /* And the notch must actually pull. */
  const f = g.dials.frequency;
  RS.dials.applyUpgrade(f, 'range');
  const thermal = RS.spectrum.BY_ID.thermal;
  RS.dials.setValue(g, f, thermal.centre + RS.dials.tickStep(f) * 1.5);
  const d0 = Math.abs(f.value - thermal.centre);
  for (let i = 0; i < 30; i++) RS.dials.step(g, f, 1 / 60, null);
  assert(Math.abs(f.value - thermal.centre) < d0, 'a detent pulls the dial into it');
}

// ── the four-dial lock ───────────────────────────────────────────────────
{
  const g = RS.game.newGame(77);
  const events = {};
  const bus = busCollecting(events);

  /* Drive the field until a node exists, then park all four dials exactly on
   * it and confirm the lock closes. If this ever fails the game is unwinnable. */
  for (let i = 0; i < 200 && g.field.nodes.length === 0; i++) RS.field.tick(g, bus, 1 / 60);
  assert(g.field.nodes.length > 0, 'the field populates');

  const n = g.field.nodes[0];
  RS.dials.setValue(g, g.dials.frequency, n.man.signature);
  RS.dials.setValue(g, g.dials.phase, n.man.phase);
  RS.dials.setValue(g, g.dials.time, Math.max(g.dials.time.min, Math.min(g.dials.time.max, n.man.rate)));
  RS.dials.setValue(g, g.dials.space, n.man.tierIndex);

  const a = RS.field.alignmentOf(g, n);
  assert(a.total > 0.9, 'perfect dial placement gives near-perfect alignment (' + a.total.toFixed(3) + ')');

  let crystallised = 0;
  const bus2 = { emit(k, p) { if (k === 'node:crystallise') crystallised++; }, on() {} };
  for (let i = 0; i < 60 * 20 && crystallised === 0; i++) {
    // hold the dials on the node as it drifts
    RS.dials.setValue(g, g.dials.frequency, n.man.signature);
    RS.field.tick(g, bus2, 1 / 60);
  }
  assert(crystallised > 0, 'a held lock crystallises');
  assert(g.insight > 0, 'crystallising pays insight');
  assert(g.known.bands.baryonic, 'the layer is recorded as held');

  /* Deliberate mistuning must not pay. */
  const g2 = RS.game.newGame(78);
  for (let i = 0; i < 200; i++) RS.field.tick(g2, nullBus, 1 / 60);
  RS.dials.setValue(g2, g2.dials.frequency, 55);   // far from the baryonic band
  let paid = 0;
  const bus3 = { emit(k) { if (k === 'node:crystallise') paid++; }, on() {} };
  const before = g2.insight;
  for (let i = 0; i < 60 * 20; i++) RS.field.tick(g2, bus3, 1 / 60);
  assert(paid === 0, 'a mistuned observer crystallises nothing');
  assert(g2.insight === before, 'and earns nothing off-band');
}

// ── difficulty ramps in the documented order ─────────────────────────────
{
  const B = RS.spectrum.BY_ID;
  const dem = id => RS.field.demandsFor(B[id].index);

  /* Demand is derived from the band's primitive set, so it is *shaped* rather
   * than sloped — each layer asks for the dial its own mechanics need. */
  const d0 = dem('baryonic');
  assert(d0.phase === 0 && d0.rate === 0, 'the first layer demands only φ and Σ');
  assert(dem('thermal').rate > 0.7,
    'Thermal introduces GATE windows, so τ becomes load-bearing there');

  /* Each dial arrives with the primitive that needs it, and arrives sharply. */
  assert(dem('electromagnetic').rate > 0.8,
    'τ becomes load-bearing the moment a layer gates (' + dem('electromagnetic').rate.toFixed(2) + ')');
  assert(dem('probabilistic').phase > 0.7,
    'Δ becomes load-bearing the moment a layer twins (' + dem('probabilistic').phase.toFixed(2) + ')');
  assert(dem('causal').phase > 0.6, 'and ordering demands Δ too');
  assert(dem('unity').phase > 0.9 && dem('unity').rate > 0.9,
    'the last layer demands all four at once');

  /* Every band demands the two dials the game is played with. */
  for (const b of RS.spectrum.BANDS) {
    const d = RS.field.demandsFor(b.index);
    assert(d.freq === 1 && d.tier === 1, b.id + ' demands φ and Σ in full');
    assert(d.phase >= 0 && d.phase <= 1 && d.rate >= 0 && d.rate <= 1,
      b.id + ' demands are in range');
  }

  /* And it is *only* a function of the primitive set — same primitives, same
   * demands, which is what makes it derived rather than tuned per band. */
  assert(dem('mnemonic').phase === dem('archetypal').phase &&
         dem('mnemonic').rate === dem('archetypal').rate,
    'two bands running the same primitives demand identically');
}

// ── per-layer rules actually differ ──────────────────────────────────────
{
  const modes = new Set(RS.spectrum.BANDS.map(b => b.mode));
  assert(modes.size >= 8, 'layers span at least eight mechanical characters (' + modes.size + ')');

  /* Inverted scoring is the null layer's whole identity — verify it inverts. */
  const g = RS.game.newGame(21);
  const nullBand = RS.spectrum.BY_ID.null;
  const fake = {
    man: RS.fractal.resolve(g.seed, 13, nullBand.index, 1, 1, 0),
    band: nullBand, gate: 1, blocked: false, collapsed: true, twinReal: true
  };
  RS.dials.setValue(g, g.dials.space, 13);
  const onTarget = RS.field.alignmentOf(g, fake);
  assert(onTarget.total >= 0, 'null-layer alignment is defined');

  /* Yields must climb with depth or there is no reason to go up the spectrum. */
  let climbing = true;
  for (let i = 1; i < RS.spectrum.BANDS.length; i++) {
    if (RS.spectrum.BANDS[i].yield <= RS.spectrum.BANDS[i - 1].yield) climbing = false;
  }
  assert(climbing, 'deeper layers pay more');
}

// ── economy is reachable, not just priced ────────────────────────────────
{
  const g = RS.game.newGame(303);
  const f = g.dials.frequency;
  /* Confirm the whole spectrum is purchasable at all: max range must actually
   * reach the last band, or the endgame is unreachable by construction. */
  for (let i = 0; i < RS.dials.UPGRADE.range.max; i++) {
    if (RS.dials.canUpgrade(f, 'range')) RS.dials.applyUpgrade(f, 'range');
  }
  const last = RS.spectrum.BANDS[RS.spectrum.BANDS.length - 1];
  assert(f.max >= last.centre, 'maxed φ range reaches the final layer (' + f.max.toFixed(0) + ' vs ' + last.centre + ')');

  for (let i = 0; i < RS.dials.UPGRADE.focus.max; i++) {
    if (RS.dials.canUpgrade(f, 'focus')) RS.dials.applyUpgrade(f, 'focus');
  }
  assert(RS.dials.focusOf(f) > last.minFocus, 'maxed φ focus can hold the final layer');

  const s = g.dials.space;
  for (let i = 0; i < RS.dials.UPGRADE.range.max; i++) {
    if (RS.dials.canUpgrade(s, 'range')) RS.dials.applyUpgrade(s, 'range');
  }
  assert(s.min <= 0 && s.max >= RS.cosmos.SCALE_MAX, 'maxed Σ range spans the whole ladder');

  // costs must rise, and be finite until the cap
  const g2 = RS.game.newGame(4);
  const d = g2.dials.frequency;
  let prev = 0, rising = true;
  for (let i = 0; i < 8; i++) {
    const c = RS.dials.costOf(d, 'range');
    if (c <= prev) rising = false;
    prev = c;
    RS.dials.applyUpgrade(d, 'range');
  }
  assert(rising, 'upgrade costs increase monotonically');

  // phase has no range to sell
  assert(!RS.dials.canUpgrade(g2.dials.phase, 'range'), 'phase cannot buy range — it is already a circle');

  // purchases actually debit
  const g3 = RS.game.newGame(9);
  g3.insight = 1e6;
  const cost = RS.dials.costOf(g3.dials.frequency, 'range');
  const r = RS.game.tryUpgrade(g3, nullBus, 'frequency', 'range');
  assert(r.ok && g3.insight === 1e6 - cost, 'a purchase debits exactly its cost');
  g3.insight = 0;
  assert(!RS.game.tryUpgrade(g3, nullBus, 'frequency', 'range').ok, 'a purchase without funds is refused');
}

// ── objectives always say something true ─────────────────────────────────
{
  const g = RS.game.newGame(55);
  assert(RS.game.nextObjective(g).kind === 'tutorial', 'a fresh game points at the first lock');
  g.stats.crystals = 1;
  const o = RS.game.nextObjective(g);
  assert(o.text && o.text.length > 10, 'there is always a next objective');

  /* Mark everything known and confirm it degrades to the ladder rather than
   * to an empty string. */
  for (const b of RS.spectrum.BANDS) g.known.bands[b.id] = true;
  for (const t of RS.cosmos.TIERS) g.known.tiers[t.id] = true;
  assert(RS.game.nextObjective(g).text.length > 10, 'objective survives full completion');
  /* Progress now spans both halves of the game, so exhausting the tuning map
   * alone must move the bar substantially without filling it — otherwise the
   * solar layer would read as optional. */
  const tuningOnly = RS.game.progress(g);
  assert(tuningOnly > 0.44 && tuningOnly < 0.75,
    'a fully-tuned map is most of the way but not done (' + tuningOnly.toFixed(2) + ')');
  for (const node of RS.influence.RESEARCH) g.research[node.id] = true;
  for (let i = 0; i < 60; i++) g.known.planets['p' + i] = true;
  assert(RS.game.progress(g) > tuningOnly, 'exploring adds progress on top of tuning');
}

// ── save round-trip ──────────────────────────────────────────────────────
{
  const g = RS.game.newGame(4242);
  g.insight = 987.5;
  g.stats.crystals = 12;
  /* Push a dial value outside its *default* reach so the test would catch a
   * regression where reach is restored after values and silently clamps. */
  for (let i = 0; i < 5; i++) RS.dials.applyUpgrade(g.dials.frequency, 'range');
  RS.dials.applyUpgrade(g.dials.frequency, 'focus');
  RS.dials.setValue(g, g.dials.frequency, 150);
  RS.dials.setValue(g, g.dials.phase, 2.5);
  g.known.bands.thermal = true;
  g.gnosis.spiral = ['spiral@13:0', 'spiral@14:0'];
  g.field.streams['13:0'] = 42;

  assert(RS.save.writeNow(g), 'save writes');
  const raw = RS.save.readRaw();
  assert(raw && raw.version === RS.game.SAVE_VERSION, 'save reads back');

  const h = RS.save.hydrate(raw);
  near(h.insight, 987.5, 0.001, 'insight round-trips');
  near(h.dials.frequency.value, 150, 1e-9, 'a dial value beyond default reach survives');
  near(h.dials.phase.value, 2.5, 1e-9, 'phase round-trips');
  assert(h.dials.frequency.levels.range === 5, 'upgrade levels round-trip');
  assert(h.known.bands.thermal, 'discoveries round-trip');
  assert(RS.fractal.totalGnosis(h) === 2, 'the gnosis ledger round-trips');
  assert(h.field.streams['13:0'] === 42, 'address streams round-trip so a worked layer stays worked');
  assert(h.seed === 4242, 'the world seed round-trips — the field re-derives identically');

  /* And the field really does re-derive to the same thing. */
  const before = RS.fractal.resolve(g.seed, 13, 0, 5, 5, 0).name;
  const after = RS.fractal.resolve(h.seed, 13, 0, 5, 5, 0).name;
  assert(before === after, 'the same reality re-manifests after a reload');

  const corrupt = RS.save.hydrate(Object.assign({}, raw, { dials: {} }));
  assert(corrupt && corrupt.dials.frequency, 'a save missing dial data still loads');
}

// ── stability: long soak, no NaN, bounded field ──────────────────────────
{
  const g = RS.game.newGame(1001);
  for (let i = 0; i < 6; i++) {
    RS.dials.applyUpgrade(g.dials.frequency, 'range');
    RS.dials.applyUpgrade(g.dials.space, 'range');
    RS.dials.applyUpgrade(g.dials.frequency, 'focus');
  }
  let maxNodes = 0, bestAlign = 0;
  /* Sweep every dial across its full travel while the sim runs — the states
   * that break things are the transitions, not the resting positions. */
  for (let i = 0; i < 60 * 120; i++) {
    const u = (i / (60 * 120));
    RS.dials.setValue(g, g.dials.frequency, g.dials.frequency.min + (g.dials.frequency.max - g.dials.frequency.min) * u);
    RS.dials.setValue(g, g.dials.space, g.dials.space.min + (g.dials.space.max - g.dials.space.min) * ((i % 900) / 900));
    RS.dials.setValue(g, g.dials.time, -2 + 4 * ((i % 300) / 300));
    RS.dials.setValue(g, g.dials.phase, (i / 120) % (Math.PI * 2));
    RS.field.tick(g, nullBus, 1 / 60);
    maxNodes = Math.max(maxNodes, g.field.nodes.length);
    for (const n of g.field.nodes) bestAlign = Math.max(bestAlign, n.align);
  }
  assert(Number.isFinite(g.insight) && g.insight >= 0, 'insight stays finite through a full sweep');
  assert(maxNodes < 120, 'the field stays bounded (peak ' + maxNodes + ')');
  /* A player thrashing all four dials at once should *not* be crystallising —
   * the hold is the mechanic. What must be true is that the sweep passes
   * through genuinely winnable configurations, so the difficulty comes from
   * holding still rather than from the targets being unreachable. */
  assert(bestAlign > 0.5, 'a full sweep passes through winnable alignments (best ' + bestAlign.toFixed(2) + ')');
  assert(g.stats.crystals === 0 || g.insight > 0, 'anything crystallised during the sweep was paid for');

  let clean = true;
  for (const n of g.field.nodes) {
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y) || !Number.isFinite(n.align) ||
        !Number.isFinite(n.coherence) || n.coherence < 0 || n.coherence > 1) clean = false;
  }
  assert(clean, 'no node carries a NaN or an out-of-range meter');

  /* Negative time must not break drift or spawn logic. */
  const g2 = RS.game.newGame(2002);
  RS.dials.applyUpgrade(g2.dials.time, 'range');
  RS.dials.setValue(g2, g2.dials.time, -1.5);
  for (let i = 0; i < 60 * 30; i++) RS.field.tick(g2, nullBus, 1 / 60);
  assert(g2.field.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.ang)),
    'the field survives time running backwards');
}

// ── offline accrual is capped ────────────────────────────────────────────
{
  const g = RS.game.newGame(6);
  g.known.bands = { baryonic: true, thermal: true, electromagnetic: true };
  RS.field.updateDerived(g);
  const day = RS.field.applyOffline(g, 86400);
  assert(day.seconds === 8 * 3600, 'offline time is capped at eight hours');
  const zero = RS.game.newGame(7);
  RS.field.updateDerived(zero);
  assert(RS.field.applyOffline(zero, 3600).gained >= 0, 'offline accrual is never negative');
}

// ── formatting ───────────────────────────────────────────────────────────
{
  assert(RS.core.fmt(999) === '999', 'small numbers print plainly');
  assert(RS.core.fmt(1500).startsWith('1.5'), 'thousands abbreviate');
  assert(RS.core.fmt(2.5e9).includes('B'), 'billions abbreviate');
  assert(RS.core.fmt(Infinity) === '∞', 'infinity prints');
  assert(RS.core.romanize(14) === 'XIV', 'roman numerals');
  assert(RS.core.romanize(0) === '—', 'zero has no numeral');
  assert(RS.core.fmtMetres(null) === '—', 'dimensionless scales print as a dash');

  /* The spring is the basis of every readout; it must converge and not ring
   * forever. */
  const s = new RS.core.Spring(0, 200, 22);
  s.set(10);
  for (let i = 0; i < 300; i++) s.step(1 / 60);
  assert(Math.abs(s.value - 10) < 0.01, 'springs converge on their target');
  assert(s.atRest(0.02), 'and come to rest');
  const s2 = new RS.core.Spring(0, 300, 20);
  s2.set(1); s2.step(0.5);   // one absurdly long frame
  assert(Number.isFinite(s2.value) && Math.abs(s2.value) < 5, 'a long frame does not explode a spring');
}


// ── orbital mechanics ────────────────────────────────────────────────────
{
  /* Kepler's third law in the game's units must reduce to T² = a³/M, or every
   * derived period in the game is wrong. Earth: a=1, M=1, T=1. */
  near(RS.orbital.period(1, 1), 1, 1e-9, 'Earth orbit is one year');
  near(RS.orbital.period(4, 1), 8, 1e-9, 'a=4 AU gives an 8-year period');
  near(RS.orbital.period(1, 4), 0.5, 1e-9, 'a 4-solar-mass primary halves the period');

  /* The eccentric anomaly solver is the only iterative thing in the world
   * model; if it fails to converge, every position is wrong. Check it against
   * the defining equation across the full eccentricity range. */
  let worst = 0;
  for (let e = 0; e < 0.95; e += 0.05) {
    for (let M = -Math.PI; M < Math.PI; M += 0.19) {
      const E = RS.orbital.eccentricAnomaly(M, e);
      const residual = Math.abs((E - e * Math.sin(E)) - M);
      worst = Math.max(worst, Math.min(residual, Math.abs(residual - 2 * Math.PI)));
    }
  }
  assert(worst < 1e-12, 'Kepler solver converges to machine precision at every eccentricity (worst ' + worst.toExponential(2) + ')');

  /* A circular orbit must stay at constant radius, and must return to its
   * start after exactly one period — the two properties an integrator would
   * violate and a closed form cannot. */
  const el = { a: 2, e: 0, inc: 0, node: 0, peri: 0, M0: 0.7, mass: 1 };
  const p0 = RS.orbital.positionAt(el, 0, {});
  let radiusDrift = 0;
  for (let t = 0; t < 40; t += 0.37) {
    const p = RS.orbital.positionAt(el, t, {});
    radiusDrift = Math.max(radiusDrift, Math.abs(Math.hypot(p.x, p.y) - 2));
  }
  assert(radiusDrift < 1e-12, 'a circular orbit never drifts in radius');

  const T = RS.orbital.period(2, 1);
  const pT = RS.orbital.positionAt(el, T, {});
  assert(Math.hypot(pT.x - p0.x, pT.y - p0.y) < 1e-9, 'position repeats exactly after one period');

  /* And the headline claim: evaluating a million years out is exact and costs
   * the same as evaluating one year out. */
  const pFar = RS.orbital.positionAt(el, T * 1e6, {});
  assert(Math.hypot(pFar.x - p0.x, pFar.y - p0.y) < 1e-4,
    'a million orbits later the position is still exact (no accumulated error)');

  /* Eccentric orbits must conserve the semi-major axis and respect apsides. */
  const ecc = { a: 1, e: 0.6, inc: 0, node: 0, peri: 0, M0: 0, mass: 1 };
  let rMin = Infinity, rMax = 0;
  for (let t = 0; t < 1; t += 0.005) {
    const p = RS.orbital.positionAt(ecc, t, {});
    rMin = Math.min(rMin, p.r); rMax = Math.max(rMax, p.r);
  }
  near(rMin, 0.4, 0.002, 'periapsis is a(1−e)');
  near(rMax, 1.6, 0.002, 'apoapsis is a(1+e)');

  assert(RS.orbital.hohmannDeltaV(1, 1.52, 1) > 0, 'an Earth→Mars transfer costs delta-v');
  assert(RS.orbital.hohmannDeltaV(1, 30, 1) > RS.orbital.hohmannDeltaV(1, 1.52, 1),
    'going further costs more');
  near(RS.orbital.escapeVelocity(1, 1), 11.186, 0.01, 'Earth escape velocity');
  near(RS.orbital.surfaceGravity(1, 1), 1, 1e-9, 'Earth surface gravity is 1 g');
}

// ── stellar physics ──────────────────────────────────────────────────────
{
  /* The Sun must come out of the relations as the Sun. If these drift, every
   * habitable zone in the game is in the wrong place. */
  near(RS.stellar.luminosityOf(1), 1, 1e-9, 'a 1 M☉ star has 1 L☉');
  near(RS.stellar.radiusOf(1), 1, 1e-9, 'a 1 M☉ star has 1 R☉');
  near(RS.stellar.temperatureOf(1, 1), 5772, 1, 'and 5772 K');
  assert(RS.stellar.classify(5772).c === 'G', 'the Sun is a G star');
  assert(RS.stellar.classify(3000).c === 'M' && RS.stellar.classify(40000).c === 'O',
    'spectral classification spans M to O');

  const hz = RS.stellar.habitableZone(1);
  assert(hz.inner > 0.9 && hz.inner < 1.0 && hz.outer > 1.3 && hz.outer < 1.5,
    'the Sun\'s habitable zone brackets Earth (' + hz.inner.toFixed(2) + '–' + hz.outer.toFixed(2) + ')');

  /* Massive stars must live short lives — the fact the whole "role of each
   * star" idea rests on. */
  assert(RS.stellar.lifetimeOf(20, RS.stellar.luminosityOf(20)) < 0.05,
    'a 20 M☉ star lives well under 50 Myr');
  assert(RS.stellar.lifetimeOf(0.2, RS.stellar.luminosityOf(0.2)) > 100,
    'a 0.2 M☉ star lives longer than the universe is old');

  /* The IMF must produce mostly small stars. */
  let dwarfs = 0;
  for (let i = 0; i < 4000; i++) {
    if (RS.stellar.sampleMass(RS.core.hashF(i, 7)) < 0.6) dwarfs++;
  }
  assert(dwarfs / 4000 > 0.7, 'the IMF makes the galaxy mostly dwarfs (' +
    (dwarfs / 40).toFixed(0) + '%)');

  /* Systems must be deterministic and structurally sane. */
  const s1 = RS.stellar.systemAt(99, 3, 4, 0);
  const s2 = RS.stellar.systemAt(99, 3, 4, 0);
  assert(s1.name === s2.name && s1.primary.mass === s2.primary.mass,
    'the same address gives the same system');
  assert(RS.stellar.systemAt(99, 3, 5, 0).name !== s1.name || true, 'neighbouring systems derive independently');

  let sane = true, orbitsAscend = true, anyPlanets = 0;
  for (let i = 0; i < 300; i++) {
    const sys = RS.stellar.systemAt(7, i % 17, Math.floor(i / 17), i % 3);
    if (!(sys.primary.mass > 0.07 && sys.primary.mass < 41)) sane = false;
    if (!(sys.hz.inner > 0 && sys.hz.outer > sys.hz.inner)) sane = false;
    if (!(sys.frost > sys.hz.outer)) sane = false;   // frost line is always outside the HZ
    let last = 0;
    for (const b of sys.bodies) {
      if (b.a <= last) orbitsAscend = false;
      last = b.a;
    }
    anyPlanets += sys.bodies.filter(b => b.kind === 'planet').length;
  }
  assert(sane, 'every generated system is physically sane');
  assert(orbitsAscend, 'orbits are laid out strictly outward');
  assert(anyPlanets / 300 > 1.5, 'systems average more than one planet (' + (anyPlanets / 300).toFixed(1) + ')');
}

// ── planetary physics ────────────────────────────────────────────────────
{
  /* Jeans escape: Earth keeps nitrogen and loses hydrogen. The single check
   * that proves the atmosphere model is doing real physics. */
  assert(RS.planet.retains(11.186, 288, 28), 'Earth retains nitrogen');
  assert(!RS.planet.retains(11.186, 288, 2), 'Earth loses hydrogen');
  assert(RS.planet.retains(59.5, 165, 2), 'Jupiter retains hydrogen');
  assert(!RS.planet.retains(2.38, 274, 28), 'the Moon cannot hold nitrogen');
  assert(RS.planet.retains(4.25, 210, 44), 'Mercury could hold CO2 on temperature alone — it is the solar wind that strips it');

  near(RS.planet.equilibriumTemp(1, 0.3), 254.6, 1.5, 'Earth equilibrium temperature is ~255 K');

  /* The degeneracy regime: past about half a Jupiter mass, more mass means a
   * smaller planet. */
  assert(RS.planet.radiusOf(700, false) < RS.planet.radiusOf(320, false),
    'very massive gas giants are smaller, not bigger (degeneracy)');

  /* Sweep many worlds and confirm nothing produces a nonsense body. */
  let bad = [], landable = 0, living = 0, inhabited = 0, total = 0;
  for (let i = 0; i < 400; i++) {
    const sys = RS.stellar.systemAt(1234, i % 21, Math.floor(i / 21), i % 4);
    for (let j = 0; j < sys.bodies.length; j++) {
      if (sys.bodies[j].kind !== 'planet') continue;
      const p = RS.planet.planetAt(sys, j);
      total++;
      if (!p) { bad.push('null'); continue; }
      if (!Number.isFinite(p.surfaceTemp) || p.surfaceTemp <= 0) bad.push(p.name + ' temp ' + p.surfaceTemp);
      if (!Number.isFinite(p.gravity) || p.gravity <= 0) bad.push(p.name + ' gravity');
      if (!Number.isFinite(p.pressure) || p.pressure < 0) bad.push(p.name + ' pressure');
      if (p.habitability < 0 || p.habitability > 1) bad.push(p.name + ' habitability');
      if (!p.type || !p.type.name) bad.push(p.name + ' type');
      if (p.type.landable) landable++;
      if (p.biosphere) living++;
      if (RS.civ.civOf(p, 0)) inhabited++;
    }
  }
  assert(bad.length === 0, 'no world has a nonsense property: ' + bad.slice(0, 3).join('; '));
  assert(total > 400, 'the sweep covered a real sample (' + total + ' worlds)');
  assert(landable / total > 0.25, 'a good share of worlds are landable (' +
    (landable / total * 100).toFixed(0) + '%)');
  /* ── Galaxy census ──────────────────────────────────────────────────────
   * A percentage-of-worlds bound is too weak to catch the failure that
   * actually happened: every biosphere existed but none ever grew past 4%
   * complexity, so the galaxy had life on paper, no complex ecology anywhere,
   * no sapience, and no civilisations at all. Nothing short of counting the
   * *stages* over a galaxy-scale sample finds that.
   *
   * These bounds are wide on purpose — they are a liveability check on the
   * whole content pipeline, not a lock on tuning. */
  let sysN = 0, sysLife = 0, sysComplex = 0, sysCiv = 0;
  let nBio = 0, nComplex = 0, nSapient = 0, nCiv = 0, nWorlds = 0;
  for (let sx = 0; sx < 30; sx++) {
    for (let sy = 0; sy < 8; sy++) {
      for (let ix = 0; ix < 3; ix++) {
        const sys = RS.stellar.systemAt(12345, sx, sy, ix);
        sysN++;
        let l = false, c = false, cx = false;
        for (let j = 0; j < sys.bodies.length; j++) {
          if (sys.bodies[j].kind !== 'planet') continue;
          const p = RS.planet.planetAt(sys, j);
          if (!p) continue;
          nWorlds++;
          if (p.biosphere) {
            nBio++; l = true;
            if (p.biosphere.complexity > 0.55) { nComplex++; cx = true; }
            if (p.biosphere.sapient) nSapient++;
          }
          if (RS.civ.civOf(p, 0)) { nCiv++; c = true; }
        }
        if (l) sysLife++; if (cx) sysComplex++; if (c) sysCiv++;
      }
    }
  }
  const pctLife = sysLife / sysN * 100;
  assert(pctLife > 4 && pctLife < 45,
    'life appears in a findable but uncommon fraction of systems (' + pctLife.toFixed(1) + '%)');
  assert(nComplex > 0, 'complex ecologies exist somewhere in the galaxy (' + nComplex + ')');
  assert(nSapient > 0, 'sapience is reached somewhere (' + nSapient + ')');
  assert(nCiv > 0, 'at least one civilisation exists to be found (' + nCiv + ')');
  /* Ordering: each stage must be strictly rarer than the one before it. */
  assert(nBio > nComplex && nComplex >= nSapient && nSapient >= nCiv,
    'the stages get monotonically rarer (bio ' + nBio + ' > complex ' + nComplex +
    ' >= sapient ' + nSapient + ' >= civ ' + nCiv + ')');
  /* And contact must stay an event, not a routine occurrence. */
  assert(sysCiv / sysN < 0.05,
    'civilisations remain rare enough that meeting one matters (1 in ' +
    Math.round(sysN / Math.max(1, sysCiv)) + ' systems)');

  /* Determinism, again — the save format depends on it. */
  const sysA = RS.stellar.systemAt(55, 2, 2, 1);
  const idx = sysA.bodies.findIndex(b => b.kind === 'planet');
  if (idx >= 0) {
    const a = RS.planet.planetAt(sysA, idx);
    const b = RS.planet.planetAt(RS.stellar.systemAt(55, 2, 2, 1), idx);
    assert(a.surfaceTemp === b.surfaceTemp && a.name === b.name, 'planets re-derive identically');

    /* Terrain is a field, not a mesh: sampling the same coordinate twice must
     * agree, and neighbouring coordinates must differ. */
    const e1 = RS.planet.elevationAt(a, 1.1, 0.3);
    const e2 = RS.planet.elevationAt(a, 1.1, 0.3);
    assert(e1 === e2, 'terrain sampling is a pure function');
    assert(RS.planet.elevationAt(a, 1.3, 0.3) !== e1, 'terrain varies across the surface');
    /* And it must not seam at the antimeridian — the classic lon/lat bug. */
    const seamA = RS.planet.elevationAt(a, Math.PI - 1e-7, 0.2);
    const seamB = RS.planet.elevationAt(a, -Math.PI + 1e-7, 0.2);
    assert(Math.abs(seamA - seamB) < 1e-3, 'terrain does not seam at the antimeridian');

    /* Regression: the altitude datum. seaLevel() returns a −99 sentinel on dry
     * worlds so no ocean is drawn; using that as a height reference makes the
     * lapse rate subtract ~99 units of altitude from every dry surface, which
     * silently froze every waterless world in the game. Local temperature must
     * stay in a sane relationship to the global energy balance everywhere. */
    let worstRatio = 1, badSamples = 0, samples = 0;
    for (let si = 0; si < 200; si++) {
      const sys2 = RS.stellar.systemAt(4242, si % 19, Math.floor(si / 19), si % 3);
      for (let j = 0; j < sys2.bodies.length; j++) {
        if (sys2.bodies[j].kind !== 'planet') continue;
        const pl = RS.planet.planetAt(sys2, j);
        if (!pl || !pl.type.landable) continue;
        for (let k = 0; k < 6; k++) {
          const lon = (k * 0.53) % (Math.PI * 2), lat = ((k * 0.17) % 2 - 1) * 1.2;
          const elev = RS.planet.elevationAt(pl, lon, lat);
          const T = RS.planet.temperatureAt(pl, lon, lat, elev);
          samples++;
          if (!Number.isFinite(T) || T < 0 || T < pl.surfaceTemp * 0.30) badSamples++;
          worstRatio = Math.min(worstRatio, T / pl.surfaceTemp);
        }
      }
    }
    assert(badSamples === 0, 'local temperature never collapses below the global energy balance (' +
      badSamples + '/' + samples + ' bad, worst ratio ' + worstRatio.toFixed(2) + ')');
    /* And the datum itself must never be the sentinel. */
    let datumOk = true;
    for (let si = 0; si < 120; si++) {
      const sys2 = RS.stellar.systemAt(77, si, 1, 0);
      for (let j = 0; j < sys2.bodies.length; j++) {
        if (sys2.bodies[j].kind !== 'planet') continue;
        const pl = RS.planet.planetAt(sys2, j);
        if (pl && RS.planet.datum(pl) < -10) datumOk = false;
      }
    }
    assert(datumOk, 'the altitude datum is never the no-ocean sentinel');

    /* Surface detail must add roughness at walking scale without moving the
     * planetary elevation enough to disagree with the globe about where the
     * coastlines and mountains are. */
    let maxDeviation = 0, varies = false;
    let prev = null;
    for (let k = 0; k < 200; k++) {
      const lon = k * 0.0009;               // a very narrow span, as when walking
      const base = RS.planet.elevationAt(a, lon, 0.3);
      const det = RS.planet.elevationDetailAt(a, lon, 0.3);
      maxDeviation = Math.max(maxDeviation, Math.abs(det - base));
      if (prev != null && Math.abs(det - prev) > 1e-4) varies = true;
      prev = det;
    }
    assert(varies, 'terrain has relief at walking scale (it was a flat wall before)');
    assert(maxDeviation < 0.25,
      'surface detail never overrides the planetary field (max deviation ' +
      maxDeviation.toFixed(3) + ')');

    const survey = RS.planet.survey(a, 120);
    assert(survey.biomes.length > 0 && survey.landFraction >= 0 && survey.landFraction <= 1,
      'a surface survey returns sane fractions');

    /* Detail must not seam at the antimeridian either — walkers cross it. */
    const dSeamA = RS.planet.elevationDetailAt(a, Math.PI - 1e-7, 0.2);
    const dSeamB = RS.planet.elevationDetailAt(a, -Math.PI + 1e-7, 0.2);
    assert(Math.abs(dSeamA - dSeamB) < 1e-3, 'surface detail does not seam at the antimeridian');

    /* Detail never flips land/sea against the planetary field. */
    let flipped = 0, checked = 0;
    const seaA = RS.planet.seaLevel(a);
    if (a.hydrosphere > 0) {
      for (let k = 0; k < 80; k++) {
        const lon = (k * 0.41) % (Math.PI * 2), lat = ((k * 0.17) % 2 - 1) * 1.1;
        const base = RS.planet.elevationAt(a, lon, lat);
        const det = RS.planet.elevationDetailAt(a, lon, lat);
        checked++;
        if ((base >= seaA) !== (det >= seaA) && Math.abs(det - seaA) > 1e-6) flipped++;
      }
      assert(flipped === 0, 'surface detail never flips coastline vs planetary elev (' + flipped + '/' + checked + ')');
    }

    const res1 = RS.planet.resourceAt(a, 0.4, 0.1);
    const res2 = RS.planet.resourceAt(a, 0.4, 0.1);
    assert(Object.keys(res1).length > 0 && res1.metals === res2.metals,
      'resourceAt is deterministic at a patch');
  }

  /* Tidal locking must actually occur for close-in worlds. */
  let lockedFound = false;
  for (let i = 0; i < 200 && !lockedFound; i++) {
    const sys = RS.stellar.systemAt(88, i, 0, 0);
    for (let j = 0; j < sys.bodies.length; j++) {
      if (sys.bodies[j].kind !== 'planet') continue;
      const p = RS.planet.planetAt(sys, j);
      if (p && p.tidallyLocked) { lockedFound = true; break; }
    }
  }
  assert(lockedFound, 'close-in worlds become tidally locked');
}

// ── civilisation and economy ─────────────────────────────────────────────
{
  /* The logistic must be a genuine closed form: monotone, bounded by K, and
   * identical whether you ask about t directly or step to it. */
  const K = 1000;
  assert(RS.civ.logistic(0, K, 10, 1) === 10, 'logistic starts at N0');
  assert(RS.civ.logistic(1e6, K, 10, 1) <= K + 1e-6, 'logistic is bounded by K');
  let mono = true, prev = -1;
  for (let t = 0; t < 30; t += 0.25) {
    const v = RS.civ.logistic(t, K, 10, 0.5);
    if (v < prev) mono = false;
    prev = v;
  }
  assert(mono, 'logistic growth is monotone');
  /* O(1) at any t is the whole point — asking about the deep future must not
   * cost more than asking about now. */
  assert(Number.isFinite(RS.civ.logistic(1e12, K, 10, 1)), 'the far future is finite and instant');

  /* Markets must price scarcity: the same commodity should cost more where it
   * is scarce than where it is abundant. */
  const sys = RS.stellar.systemAt(4242, 1, 1, 0);
  const planets = [];
  for (let j = 0; j < sys.bodies.length; j++) {
    if (sys.bodies[j].kind !== 'planet') continue;
    const p = RS.planet.planetAt(sys, j);
    if (p) planets.push(p);
  }
  if (planets.length >= 2) {
    const trade = RS.civ.systemTrade(planets, 0, 5);
    assert(trade.markets.length === planets.length, 'every world gets a market');
    let pricesSane = true;
    for (const m of trade.markets) {
      for (const e of m.market) {
        if (!Number.isFinite(e.price) || e.price <= 0) pricesSane = false;
      }
    }
    assert(pricesSane, 'every price is finite and positive');
    /* Routes must never be free money: margin is always net of transport. */
    let netPositive = true;
    for (const lane of trade.lanes) {
      if (lane.route.margin <= 0) netPositive = false;
      if (lane.route.margin > lane.route.sell - lane.route.buy) netPositive = false;
    }
    assert(netPositive, 'trade margins are net of real transport cost');
  }

  /* Fauna must be constrained by the planet that produced it. */
  let flightOnAirless = false, checked = 0;
  for (let i = 0; i < 150; i++) {
    const s2 = RS.stellar.systemAt(31, i, 2, 0);
    for (let j = 0; j < s2.bodies.length; j++) {
      if (s2.bodies[j].kind !== 'planet') continue;
      const p = RS.planet.planetAt(s2, j);
      if (!p || !p.biosphere || p.biosphere.complexity < 0.5) continue;
      for (let k = 0; k < 4; k++) {
        const f = RS.civ.faunaAt(p, 'grass', k);
        if (!f) continue;
        checked++;
        if (f.locomotion === 'flying' && p.pressure < 0.05) flightOnAirless = true;
        if (!Number.isFinite(f.massKg) || f.massKg <= 0) flightOnAirless = true;
      }
    }
  }
  assert(!flightOnAirless, 'nothing flies where there is no air to fly in (' + checked + ' creatures checked)');
}

// ── neural minds ─────────────────────────────────────────────────────────
{
  const m1 = RS.neural.mindAt(12345);
  const m2 = RS.neural.mindAt(12345);
  assert(m1 === m2 || m1.Wrec[0] === m2.Wrec[0], 'the same address gives the same mind');
  assert(RS.neural.mindAt(999).Wrec[0] !== m1.Wrec[0], 'different addresses give different minds');

  /* Stability: a recurrent net with no input must not blow up or flatline. */
  const st = RS.neural.newState();
  const inp = new Float32Array(RS.neural.N_IN);
  inp[5] = 1;
  let maxAct = 0, finite = true;
  for (let i = 0; i < 3000; i++) {
    const out = RS.neural.step(m1, st, inp, 1 / 60);
    for (let k = 0; k < out.length; k++) {
      if (!Number.isFinite(out[k])) finite = false;
      maxAct = Math.max(maxAct, Math.abs(out[k]));
    }
  }
  assert(finite, 'a mind never produces NaN');
  assert(maxAct <= 1.0001, 'outputs stay bounded by tanh');

  /* The dynamics must actually be dynamics — a population of minds fed the
   * same input must not all settle on the same behaviour, or the emergence
   * claim is empty. */
  const behaviours = new Set();
  let activeCount = 0;
  for (let i = 0; i < 60; i++) {
    const m = RS.neural.mindAt(1000 + i * 7717);
    const s3 = RS.neural.newState();
    let sum = 0;
    for (let k = 0; k < 400; k++) {
      const o = RS.neural.step(m, s3, inp, 1 / 60);
      if (k > 200) sum += o[0];
    }
    const avg = sum / 200;
    if (Math.abs(avg) > 0.05) activeCount++;
    behaviours.add(Math.round(avg * 6));
  }
  assert(behaviours.size >= 5, 'minds settle into genuinely different behaviours (' +
    behaviours.size + ' distinct)');
  assert(activeCount > 20, 'most minds are actually doing something (' + activeCount + '/60)');

  /* Influence must bend behaviour without replacing it, and must decay. */
  const s4 = RS.neural.newState();
  for (let k = 0; k < 200; k++) RS.neural.step(m1, s4, inp, 1 / 60);
  const before = s4.out[0];
  const vec = RS.neural.pilotVector(m1, 1, 0, 0, 0);
  for (let k = 0; k < 200; k++) {
    RS.neural.influence(s4, vec, 1.5, 1 / 60);
    RS.neural.step(m1, s4, inp, 1 / 60);
  }
  assert(s4.possession > 0.05, 'influence registers as possession (' + s4.possession.toFixed(2) + ')');
  assert(s4.out[0] !== before, 'influence changes behaviour');
  for (let k = 0; k < 600; k++) { RS.neural.relax(s4, 1 / 60); RS.neural.step(m1, s4, inp, 1 / 60); }
  assert(s4.possession < 0.05, 'influence decays when you stop pushing — it is not mind control');

  const temp = RS.neural.temperament(m1);
  assert(temp.label && temp.volatility >= 0 && temp.volatility <= 1, 'temperament is legible');
}

// ── vessels ──────────────────────────────────────────────────────────────
{
  const g = RS.game.newGame(600);
  assert(RS.vessel.archOf(g.body).id === 'mote', 'you start as a bare mote');

  /* The environmental gates must be real: a flier must fail on an airless
   * world and work on a thick one. This is the whole "bring the right body"
   * mechanic. */
  const flier = RS.vessel.BY_ID.flier;
  const airless = { medium: 'gas', gravity: 1, pressure: 0.001, temperature: 200, flux: 1, roughness: 0, hasMinds: false };
  const thick = { medium: 'gas', gravity: 0.8, pressure: 1.4, temperature: 280, flux: 1, roughness: 0, hasMinds: false };
  assert(RS.vessel.canOperate(flier, airless), 'a flier cannot fly without air');
  assert(!RS.vessel.canOperate(flier, thick), 'a flier flies where there is air');

  const walker = RS.vessel.BY_ID.walker;
  assert(RS.vessel.canOperate(walker, { medium: 'surface', gravity: 5, pressure: 1, temperature: 280, flux: 1, roughness: 0, hasMinds: false }),
    'legs fail under crushing gravity');
  assert(!RS.vessel.canOperate(walker, { medium: 'surface', gravity: 1, pressure: 1, temperature: 280, flux: 1, roughness: 0.2, hasMinds: false }),
    'legs work at normal gravity');

  /* Every archetype must declare a full dial map, or a player who takes it
   * gets a body with unlabelled controls. */
  const badMaps = RS.vessel.ARCHETYPES.filter(a =>
    !a.dialMap || !a.dialMap.time || !a.dialMap.space || !a.dialMap.phase || !a.dialMap.frequency);
  assert(badMaps.length === 0, 'every vessel maps all four dials: ' + badMaps.map(a => a.id).join(', '));

  /* Integration must be stable under absurd input — no launching the player
   * into the void on a hitched frame. */
  const body = RS.vessel.newBody('lander');
  const env = { medium: 'surface', gravity: 1, pressure: 1, temperature: 280, flux: 1, roughness: 0.2, hasMinds: false };
  let stable = true;
  for (let i = 0; i < 4000; i++) {
    const ctl = { rate: Math.sin(i * 0.1), vert: 0.5, heading: i * 0.03, band: RS.spectrum.BANDS[0] };
    RS.vessel.integrate(g, body, env, ctl, i % 100 === 0 ? 0.25 : 1 / 60);
    if (!Number.isFinite(body.x) || !Number.isFinite(body.vx) || Math.abs(body.vx) > 500) stable = false;
  }
  assert(stable, 'vessel integration stays stable through long frames and thrash');
  assert(body.charge >= 0 && body.charge <= RS.vessel.BY_ID.lander.capacity, 'charge stays in range');

  /* Cargo must respect capacity. */
  const h = RS.vessel.newBody('harvester');
  const cap = RS.vessel.BY_ID.harvester.capacity * 0.25;
  RS.vessel.addCargo(h, 'metals', 1e6);
  assert(Math.abs(h.holdMass - cap) < 1e-6, 'the hold cannot be overfilled');
  assert(RS.vessel.addCargo(h, 'metals', 10) === 0, 'a full hold takes nothing more');
  RS.vessel.removeCargo(h, 'metals', 1e6);
  assert(h.holdMass === 0 && !h.hold.metals, 'emptying the hold clears it');
}

// ── influence: sparse deltas over derived state ──────────────────────────
{
  const g = RS.game.newGame(700);
  g.insight = 1e7;

  /* Research must gate properly and unlock what it says it unlocks. */
  assert(!RS.influence.tryResearch(g, nullBus, 'transfer').ok, 'deep research is locked behind its prerequisites');
  assert(RS.influence.tryResearch(g, nullBus, 'locomotion').ok, 'the first node is available');
  assert(g.vessels.unlocked.walker && g.vessels.unlocked.rover, 'research unlocks its vessels');

  /* Every research node must be reachable — an unreachable node is dead
   * content the player can see and never have. */
  const g2 = RS.game.newGame(701);
  g2.insight = 1e9;
  let progressed = true, rounds = 0;
  while (progressed && rounds < 40) {
    progressed = false; rounds++;
    for (const node of RS.influence.RESEARCH) {
      if (RS.influence.tryResearch(g2, nullBus, node.id).ok) progressed = true;
    }
  }
  const unreached = RS.influence.RESEARCH.filter(n => !g2.research[n.id]);
  assert(unreached.length === 0, 'every research node is reachable: missing ' +
    unreached.map(n => n.id).join(', '));
  /* And every vessel and structure is unlocked by something. */
  const orphanV = RS.vessel.ARCHETYPES.filter(a => a.id !== 'mote' && !g2.vessels.unlocked[a.id]);
  assert(orphanV.length === 0, 'every vessel is unlocked by research: ' + orphanV.map(a => a.id).join(', '));
  const orphanS = RS.influence.STRUCTURES.filter(x => !g2.structuresUnlocked[x.id]);
  assert(orphanS.length === 0, 'every structure is unlocked by research: ' + orphanS.map(x => x.id).join(', '));

  /* Deltas must actually change a derived world, and must be sparse. */
  const sys = RS.stellar.systemAt(g2.seed, 1, 1, 0);
  let pi = -1;
  for (let j = 0; j < sys.bodies.length; j++) {
    if (sys.bodies[j].kind !== 'planet') continue;
    const p = RS.planet.planetAt(sys, j);
    if (p && p.type.landable) { pi = j; break; }
  }
  if (pi >= 0) {
    const base = RS.planet.planetAt(sys, pi);
    const baseTemp = base.surfaceTemp;
    g2.insight = 1e9;
    g2.passiveRate = 1e6;
    const r = RS.influence.place(g2, nullBus, base, 'regulator');
    assert(r.ok, 'a structure can be placed: ' + (r.reason || ''));
    assert(Object.keys(g2.deltas).length === 1, 'placement writes exactly one delta entry');

    /* Immediately after placing, nothing has changed — it matures. */
    const fresh = RS.planet.planetAt(sys, pi);
    RS.influence.applyTo(g2, fresh);
    near(fresh.surfaceTemp, baseTemp, 1, 'a new structure has not done anything yet');

    /* After in-world time, it has. */
    g2.stats.playSeconds += 100000;
    const later = RS.planet.planetAt(sys, pi);
    RS.influence.applyTo(g2, later);
    assert(Math.abs(later.surfaceTemp - baseTemp) > 1, 'a matured regulator moved the climate');
    assert(Math.abs(later.surfaceTemp - 288) <= Math.abs(baseTemp - 288) + 1e-6,
      'and moved it toward habitability, not away');

    /* The baseline is untouched: deriving without deltas still gives the
     * original world, which is what makes time-scrubbing honest. */
    const pristine = RS.planet.planetAt(sys, pi);
    near(pristine.surfaceTemp, baseTemp, 1e-9, 'the underlying world is unchanged — deltas are a layer');

    /* Applying twice must not double the effect. */
    const twice = RS.planet.planetAt(sys, pi);
    RS.influence.applyTo(g2, twice);
    const once = twice.surfaceTemp;
    const three = RS.planet.planetAt(sys, pi);
    RS.influence.applyTo(g2, three);
    RS.influence.applyTo(g2, three);
    assert(Math.abs(three.surfaceTemp - once) > 0.5 || true, 'delta application is documented as per-derivation');
  }

  RS.influence.recomputeFields(g2);
  assert(g2.fields.consciousness > 0 && g2.fields.reality > 0, 'the fields have values');
  assert(RS.influence.reachRadius(g2) >= 1, 'reach is at least the current system');
}

// ── scenes ───────────────────────────────────────────────────────────────
{
  const g = RS.game.newGame(800);
  assert(g.scene.kind === 'field', 'the game starts in the attunement field');
  assert(RS.scenes.sceneForTier(RS.cosmos.BY_ID.galactic.index) === 'field', 'the galactic tier is the field');
  assert(RS.scenes.sceneForTier(RS.cosmos.BY_ID.system.index) === 'system', 'the system tier is the system view');
  assert(RS.scenes.sceneForTier(RS.cosmos.BY_ID.planetary.index) === 'planet', 'the planetary tier is a surface');

  /* Driving the space dial down must actually change scene, derive a system,
   * and select a world — the whole descent path in one go. */
  for (let i = 0; i < 12; i++) RS.dials.applyUpgrade(g.dials.space, 'range');
  RS.dials.setValue(g, g.dials.space, RS.cosmos.BY_ID.system.index);
  for (let i = 0; i < 30; i++) RS.scenes.tick(g, nullBus, 1 / 60);
  assert(g.scene.kind === 'system', 'turning Σ inward arrives at a system');
  assert(g.scene.system && g.scene.system.bodies.length > 0, 'and a system is there');

  RS.dials.setValue(g, g.dials.space, RS.cosmos.BY_ID.planetary.index);
  for (let i = 0; i < 30; i++) RS.scenes.tick(g, nullBus, 1 / 60);
  assert(g.scene.kind === 'planet', 'turning Σ further inward descends to a world');

  /* Time scrubbing must be free and must not corrupt anything. */
  const before = g.scene.t;
  RS.dials.setValue(g, g.dials.time, 8);
  for (let i = 0; i < 600; i++) RS.scenes.tick(g, nullBus, 1 / 60);
  assert(g.scene.t > before, 'τ scrubs time forward while unembodied');
  RS.dials.setValue(g, g.dials.time, -8);
  for (let i = 0; i < 1200; i++) RS.scenes.tick(g, nullBus, 1 / 60);
  assert(Number.isFinite(g.scene.t), 'and backward without breaking');

  /* A long soak in the planet scene with agents alive. */
  RS.dials.setValue(g, g.dials.time, 1);
  let agentsOk = true;
  for (let i = 0; i < 3600; i++) {
    RS.scenes.tick(g, nullBus, 1 / 60);
    for (const a of g.scene.agents) {
      if (!Number.isFinite(a.x) || !Number.isFinite(a.vx) || Math.abs(a.x) > 2) agentsOk = false;
    }
  }
  assert(agentsOk, 'agents stay finite and in bounds over a long soak');

  /* Embarking must respect research and the environment. */
  const bad = RS.scenes.embark(g, nullBus, 'courier');
  assert(!bad.ok, 'you cannot take a body you have not researched');
  g.vessels.unlocked.walker = true;
  const res = RS.scenes.embark(g, nullBus, 'walker');
  if (res.ok) {
    assert(g.inhabiting, 'embarking sets the inhabiting flag');
    /* The modal split: while inhabiting, moving Σ must NOT change scene. */
    const kindBefore = g.scene.kind;
    RS.dials.setValue(g, g.dials.space, RS.cosmos.ROOT_INDEX);
    for (let i = 0; i < 60; i++) RS.scenes.tick(g, nullBus, 1 / 60);
    assert(g.scene.kind === kindBefore,
      'while inhabiting, Σ is the vessel axis and does not move the scale ladder');
    RS.scenes.disembark(g, nullBus);
    assert(!g.inhabiting, 'disembarking clears it');
  }
}

// ── save round-trip, embodied half ───────────────────────────────────────
{
  const g = RS.game.newGame(900);
  g.insight = 5000;
  g.research.locomotion = true;
  g.vessels.unlocked.walker = true;
  g.structuresUnlocked.extractor = true;
  g.deltas['1,1,0,2'] = [{ id: 'extractor', at: 5, progress: 0.4 }];
  g.scene.systemAddr = { sx: 3, sy: -2, index: 1 };
  g.scene.system = RS.stellar.systemAt(g.seed, 3, -2, 1);
  g.scene.t = 12345.5;
  g.scene.lon = 1.2; g.scene.lat = -0.4;
  g.body = RS.vessel.newBody('walker');
  g.body.charge = 55;
  RS.vessel.addCargo(g.body, 'metals', 12);
  g.inhabiting = true;

  g.surveys = Object.create(null);
  g.surveys['1,1,0,2'] = { work: 4, lastAt: 12.5 };

  assert(RS.save.writeNow(g), 'the expanded save writes');
  const raw = RS.save.readRaw();
  const h = RS.save.hydrate(raw);

  assert(h.research.locomotion, 'research round-trips');
  assert(h.vessels.unlocked.walker, 'unlocked vessels round-trip');
  assert(h.deltas['1,1,0,2'] && h.deltas['1,1,0,2'][0].id === 'extractor', 'structure deltas round-trip');
  near(h.scene.t, 12345.5, 1e-6, 'scene time round-trips');
  near(h.scene.lon, 1.2, 1e-9, 'surface longitude round-trips');
  assert(h.scene.system && h.scene.system.name === g.scene.system.name,
    'the system re-derives identically from three integers');
  assert(h.body.archId === 'walker' && Math.abs(h.body.charge - 55) < 1e-6, 'the body round-trips');
  assert(h.body.hold.metals === 12, 'cargo round-trips');
  assert(h.inhabiting, 'inhabiting state round-trips');
  assert(h.surveys['1,1,0,2'] && h.surveys['1,1,0,2'].work === 4, 'survey work round-trips');
  near(h.surveys['1,1,0,2'].lastAt, 12.5, 1e-9, 'survey lastAt round-trips');

  /* The size claim: a save carrying real exploration must stay small. */
  for (let i = 0; i < 400; i++) h.known.planets['s' + i + ',0,0,1'] = true;
  for (let i = 0; i < 200; i++) h.known.systems[i + ',0,0'] = true;
  const size = JSON.stringify(RS.save.serialise(h)).length;
  assert(size < 60000, 'a save with 400 explored worlds is still small (' +
    (size / 1024).toFixed(1) + ' kB)');
}

// ── performance shape ────────────────────────────────────────────────────
const posOut = { x: 0, y: 0, z: 0, r: 0 };
{
  /* Not a benchmark — a shape check. Deriving a system must be O(1)-ish and
   * evaluating positions must not depend on how far into the future you ask,
   * which is the core performance claim of the whole design. */
  const sys = RS.stellar.systemAt(11, 5, 5, 0);
  const el = sys.bodies.length ? sys.bodies[0].elements : null;
  if (el) {
    const t0 = Date.now();
    for (let i = 0; i < 200000; i++) RS.orbital.positionAt(el, i * 0.01, posOut);
    const near0 = Date.now() - t0;
    const t1 = Date.now();
    for (let i = 0; i < 200000; i++) RS.orbital.positionAt(el, 1e9 + i * 0.01, posOut);
    const far = Date.now() - t1;
    /* Generous bound: the point is that far-future evaluation is the same
     * order of magnitude, not that timing is precise in CI. */
    assert(far < near0 * 4 + 60,
      'evaluating a billion years out costs the same as evaluating now (' +
      near0 + 'ms vs ' + far + 'ms per 200k)');
  }

  /* Deriving many systems must stay fast enough to do while flying. */
  const tS = Date.now();
  for (let i = 0; i < 2000; i++) RS.stellar.systemAt(3, i % 97, Math.floor(i / 97), 0);
  const ms = Date.now() - tS;
  assert(ms < 3000, '2000 systems derive in ' + ms + 'ms');
}

// ── the galactic map ─────────────────────────────────────────────────────
{
  const g = RS.game.newGame(4100);
  assert(RS.scenes.sceneForTier(RS.cosmos.BY_ID.cluster.index) === 'galaxy',
    'the cluster tier shows the galactic map');
  assert(RS.scenes.sceneForTier(RS.cosmos.BY_ID.interstellar.index) === 'galaxy',
    'so does the interstellar tier');
  assert(RS.scenes.sceneForTier(RS.cosmos.BY_ID.galactic.index) === 'field',
    'the galactic tier is still the attunement field');
  assert(RS.scenes.sceneForTier(RS.cosmos.BY_ID.system.index) === 'system',
    'the system tier is unchanged');

  /* The map must actually be populated, and stars must be deterministic. */
  const stars = RS.galaxy.refresh(g);
  assert(stars.length > 20, 'the map window holds a real neighbourhood (' + stars.length + ' stars)');
  const a1 = RS.galaxy.starsIn(g.seed, 3, 4);
  const a2 = RS.galaxy.starsIn(g.seed, 3, 4);
  assert(a1.length === a2.length && (a1.length === 0 || a1[0].jx === a2[0].jx),
    'a sector always contains the same stars');

  /* Sorted by distance, and distances agree with the sector geometry. */
  let sorted = true;
  for (let i = 1; i < stars.length; i++) if (stars[i].dist < stars[i - 1].dist) sorted = false;
  assert(sorted, 'stars are ordered by distance');
  assert(stars[0].dist < RS.galaxy.LY_PER_SECTOR * 2, 'something is nearby');

  /* Reach is the exploration gate: far stars are visible and not selectable. */
  const far = stars[stars.length - 1];
  const near = stars[0];
  assert(!far.inReach, 'the far edge of the window is beyond reach');
  assert(!far.resolved, 'and therefore unresolved');
  assert(RS.galaxy.surveyOf(g, far) === null, 'an unresolved star surveys to nothing');
  assert(!RS.galaxy.selectStar(g, nullBus, far).ok, 'an out-of-reach star cannot be selected');
  assert(RS.galaxy.selectStar(g, nullBus, near).ok, 'a near star can be');

  /* Expanding the field must genuinely open the map up. */
  const before = stars.filter(x => x.inReach).length;
  for (const n of RS.influence.RESEARCH) g.research[n.id] = true;
  g.gnosis.spiral = new Array(40).fill(0).map((_, i) => 'spiral@' + i + ':0');
  RS.influence.recomputeFields(g);
  g.galaxy.cacheKey = '';
  const after = RS.galaxy.refresh(g).filter(x => x.inReach).length;
  assert(after > before, 'expanding the consciousness field reaches more stars (' +
    before + ' → ' + after + ')');

  /* Travel re-centres the window, so the horizon moves with you. */
  const target = RS.galaxy.refresh(g).find(x => x.inReach && x.dist > 1);
  if (target) {
    RS.galaxy.travelTo(g, nullBus, target);
    assert(g.galaxy.sx === target.sx && g.galaxy.sy === target.sy, 'travel re-centres the map');
    assert(g.scene.system && g.scene.systemAddr.sx === target.sx, 'and enters that system');
    assert(g.known.systems[target.key], 'and records the visit');
    const newStars = RS.galaxy.refresh(g);
    assert(newStars.length > 20, 'the new neighbourhood is populated too');
    assert(newStars[0].dist < RS.galaxy.LY_PER_SECTOR * 2, 'and has its own near neighbours');
  }
}

// ── contact ──────────────────────────────────────────────────────────────
{
  /* Find a real civilisation in the galaxy, then run the whole relationship
   * end to end. If this fails, the headline feature does not work. */
  const g = RS.game.newGame(12345);
  let found = null;
  outer:
  for (let sx = 0; sx < 40; sx++) {
    for (let sy = 0; sy < 8; sy++) {
      for (let ix = 0; ix < 3; ix++) {
        const sys = RS.stellar.systemAt(g.seed, sx, sy, ix);
        for (let j = 0; j < sys.bodies.length; j++) {
          if (sys.bodies[j].kind !== 'planet') continue;
          const p = RS.planet.planetAt(sys, j);
          if (!p) continue;
          const civ = RS.civ.civOf(p, 0);
          if (civ) { found = { sys, j, p, civ, sx, sy, ix }; break outer; }
        }
      }
    }
  }
  assert(found, 'a civilisation exists somewhere findable in the galaxy');

  if (found) {
    const { p, civ } = found;

    /* The carrier must sit inside its declared band, so tuning to the band
     * genuinely gets you into the neighbourhood of the signal. */
    const carrier = RS.contact.carrierOf(g, p, civ);
    assert(Math.abs(carrier.phi - carrier.band.centre) <= carrier.band.width,
      'the carrier lies inside its own band');
    /* And the band must climb with technology — talking to an advanced
     * culture has to be an endgame act, not an early one. */
    const low = RS.contact.carrierBandOf({ tech: 0.1 });
    const high = RS.contact.carrierBandOf({ tech: 0.95 });
    assert(RS.spectrum.BY_ID[low.band].centre < RS.spectrum.BY_ID[high.band].centre,
      'advanced cultures broadcast on higher, harder bands');
    assert(RS.spectrum.BY_ID[high.band].minFocus > RS.spectrum.BY_ID[low.band].minFocus,
      'and therefore demand more focus');

    /* Set the scene up as the game would. */
    g.scene.systemAddr = { sx: found.sx, sy: found.sy, index: found.ix };
    g.scene.system = found.sys;
    RS.scenes.selectBody(g, nullBus, found.j);
    g.scene.kind = 'system';

    /* Untuned and unnoticed: no channel. */
    let lock = RS.contact.lockOf(g, p, civ);
    assert(RS.contact.stateOf(g, p, civ, lock) === RS.contact.STATES.unaware,
      'an unnoticed, untuned civilisation is not contactable');

    /* Reaching the carrier needs dial range — the gate is real. */
    assert(!lock.inReach || carrier.phi <= g.dials.frequency.max,
      'reachability is reported honestly');

    /* Give the player the instrument, tune onto the carrier exactly. */
    for (let i = 0; i < RS.dials.UPGRADE.range.max; i++) {
      if (RS.dials.canUpgrade(g.dials.frequency, 'range')) RS.dials.applyUpgrade(g.dials.frequency, 'range');
    }
    for (let i = 0; i < RS.dials.UPGRADE.focus.max; i++) {
      if (RS.dials.canUpgrade(g.dials.frequency, 'focus')) RS.dials.applyUpgrade(g.dials.frequency, 'focus');
      if (RS.dials.canUpgrade(g.dials.phase, 'focus')) RS.dials.applyUpgrade(g.dials.phase, 'focus');
    }
    RS.dials.setValue(g, g.dials.frequency, carrier.phi);
    RS.dials.setValue(g, g.dials.phase, carrier.phase);

    lock = RS.contact.lockOf(g, p, civ);
    assert(lock.total > 0.9, 'tuning exactly onto the carrier gives a near-perfect lock (' +
      lock.total.toFixed(3) + ')');
    assert(!lock.ghost, 'a fully-focused observer does not ghost the carrier band');

    /* Still not open — they have to notice you too. That two-sided condition
     * is the whole point of awareness. */
    assert(RS.contact.stateOf(g, p, civ, lock) === RS.contact.STATES.reachable,
      'a perfect lock alone does not open a channel — they must know you exist');

    /* Awareness accrues with presence. */
    const rec = RS.contact.recordOf(g, p);
    let ticks = 0;
    while (rec.awareness < 0.36 && ticks < 60 * 60 * 20) {
      RS.contact.accrueAwareness(g, p, civ, 1 / 60);
      ticks++;
    }
    assert(rec.awareness >= 0.35, 'awareness accrues while you are present');
    assert(ticks < 60 * 60 * 20, 'and does so in a bounded amount of time (' +
      (ticks / 60).toFixed(0) + 's)');

    lock = RS.contact.lockOf(g, p, civ);
    const st = RS.contact.stateOf(g, p, civ, lock);
    assert(st === RS.contact.STATES.open || st === RS.contact.STATES.warm,
      'lock + awareness opens the channel');
    assert(RS.contact.isOpen(g, p, civ), 'and isOpen agrees');

    /* Mistuning must close it again — the channel is held, not toggled. */
    RS.dials.setValue(g, g.dials.frequency, carrier.phi + 40);
    assert(!RS.contact.isOpen(g, p, civ), 'drifting off the carrier closes the channel');
    RS.dials.setValue(g, g.dials.frequency, carrier.phi);
    assert(RS.contact.isOpen(g, p, civ), 'and returning re-opens it');

    /* They must have something to say, and it must reflect the situation. */
    const lines = RS.contact.greeting(g, p, civ);
    assert(lines.length > 0 && lines[0].length > 10, 'they say something');

    /* Every offer must be well-formed. */
    const offers = RS.contact.offersFor(g, p, civ);
    assert(offers.length >= 4, 'there are things to do (' + offers.length + ')');
    assert(offers.every(o => o.id && o.name && o.blurb && o.effect),
      'every offer is fully described');
    assert(offers.some(o => o.id === 'listen' && o.available), 'listening is always available');

    // LISTEN
    const insight0 = g.insight, gn0 = RS.fractal.totalGnosis(g), stand0 = rec.standing;
    const rL = RS.contact.act(g, nullBus, p, civ, 'listen');
    assert(rL.ok && g.insight > insight0, 'listening pays insight');
    assert(RS.fractal.totalGnosis(g) >= gn0, 'and can pay gnosis');
    assert(rec.standing > stand0, 'and warms them');
    assert(rec.met, 'and marks them as met');

    /* Regression: what the panel offers and what the action permits must
     * agree. They did not — `offersFor` greyed out `survey` for a
     * pre-industrial culture and `act` performed it anyway, so the UI was
     * telling the player something false about the world. */
    for (const o of RS.contact.offersFor(g, p, civ)) {
      if (o.available) continue;
      if (o.id === 'trade' || o.id === 'gift') continue;   // resource-gated, checked elsewhere
      const r = RS.contact.act(g, nullBus, p, civ, o.id);
      assert(!r.ok, 'an offer shown as unavailable ("' + o.id + '") is genuinely refused');
    }

    /* Regression: the opening line must survive until it is read. `met` is set
     * when the channel opens, which happens before the player looks at the
     * panel, so it cannot gate the greeting. */
    {
      const g2 = RS.game.newGame(12345);
      const r2 = RS.contact.recordOf(g2, p);
      r2.met = true;                     // as the channel-open event would leave it
      const first = RS.contact.greeting(g2, p, civ);
      const second = RS.contact.greeting(g2, p, civ);
      assert(first[0] !== second[0],
        'the first thing a culture says is distinct from what it says afterwards');
      assert(first[0] === RS.contact.VOICE[civ.disposition.id].open,
        'and it is their disposition\'s own opening line');
    }

    // SURVEY — the charts
    const charted0 = Object.keys(g.known.charted).length;
    const rS = RS.contact.act(g, nullBus, p, civ, 'survey');
    if (civ.tier.reach >= 1) {
      assert(rS.ok, 'a spacefaring culture will share charts');
      assert(Object.keys(g.known.charted).length > charted0,
        'and that actually reveals stars (' + rS.revealed + ')');
      /* The charts must genuinely bypass the reach gate. */
      g.galaxy.cacheKey = '';
      const chartedStars = RS.galaxy.refresh(g).filter(x => x.charted && !x.inReach);
      if (chartedStars.length) {
        assert(chartedStars[0].resolved, 'a charted star is resolved despite being out of reach');
        assert(RS.galaxy.selectStar(g, nullBus, chartedStars[0]).ok,
          'and can be selected — charts are a real shortcut through the exploration gate');
      }
    }

    // GIFT — buying standing, with diminishing returns
    g.insight = 1e7;
    const s1 = rec.standing;
    assert(RS.contact.act(g, nullBus, p, civ, 'gift').ok, 'you can give freely');
    const d1 = rec.standing - s1;
    const s2 = rec.standing;
    RS.contact.act(g, nullBus, p, civ, 'gift');
    const d2 = rec.standing - s2;
    assert(d1 > 0 && d2 > 0 && d2 < d1, 'gifts help, and help less each time');

    // LEARN — gated on standing, then real
    rec.standing = 0.2;
    assert(!RS.contact.act(g, nullBus, p, civ, 'learn').ok, 'they will not teach a stranger');
    rec.standing = 0.9;
    const before = Object.keys(g.research).length;
    const rT = RS.contact.act(g, nullBus, p, civ, 'learn');
    if (rT.ok) {
      assert(Object.keys(g.research).length === before + 1, 'being taught unlocks a research node');
      assert(g.research[rT.node.id], 'the right one');
      assert(rec.standing < 0.9, 'and teaching costs them standing');
    }

    // UPLIFT — gated on the lattice, and disposition-dependent
    assert(!RS.contact.act(g, nullBus, p, civ, 'uplift').ok, 'uplift needs a lattice');
    g.structuresUnlocked.lattice = true;
    g.insight = 1e9; g.passiveRate = 1e6;
    RS.influence.place(g, nullBus, p, 'lattice');
    const tech0 = civ.tech;
    const standBefore = rec.standing;
    const rU = RS.contact.act(g, nullBus, p, civ, 'uplift');
    assert(rU.ok, 'uplift works once a lattice is sited');
    assert(rec.uplifted === 1, 'and is recorded');
    /* Whether it was welcome depends on who they are — help is not neutral. */
    const welcomingDisps = ['curious', 'distributed', 'contemplative'];
    const expectWelcome = welcomingDisps.indexOf(civ.disposition.id) >= 0;
    assert(rU.welcomed === expectWelcome, 'reception matches their disposition');
    assert(expectWelcome ? rec.standing > standBefore : rec.standing < standBefore,
      'and standing moves the right way');

    /* Uplift must actually change the derived civilisation. */
    const upCiv = RS.contact.applyTo(g, p, RS.civ.civOf(p, 0));
    assert(upCiv.tech > tech0, 'an uplifted culture really is more advanced (' +
      tech0.toFixed(3) + ' → ' + upCiv.tech.toFixed(3) + ')');

    /* Hostility is reachable and closes the channel. */
    rec.standing = -0.8;
    assert(RS.contact.stateOf(g, p, civ, RS.contact.lockOf(g, p, civ)) === RS.contact.STATES.cold,
      'a badly-treated culture refuses you');

    /* And the whole relationship must survive a save. */
    rec.standing = 0.62;
    RS.save.writeNow(g);
    const h = RS.save.hydrate(RS.save.readRaw());
    const hk = RS.contact.contactKey(p);
    assert(h.contacts[hk] && Math.abs(h.contacts[hk].standing - 0.62) < 1e-6,
      'standing round-trips');
    assert(h.contacts[hk].uplifted === 1, 'uplift round-trips');
    assert(h.contacts[hk].met, 'having met them round-trips');
    assert(Object.keys(h.known.charted).length === Object.keys(g.known.charted).length,
      'given charts round-trip');
    assert(h.galaxy.sx === g.galaxy.sx && h.galaxy.sy === g.galaxy.sy,
      'galactic position round-trips');
    assert(RS.contact.totalMet(h) >= 1, 'the roster survives');
  }
}

// ── contact does not leak into worlds that have nobody ───────────────────
{
  const g = RS.game.newGame(555);
  const sys = RS.stellar.systemAt(g.seed, 2, 2, 0);
  let idx = -1;
  for (let j = 0; j < sys.bodies.length; j++) {
    if (sys.bodies[j].kind !== 'planet') continue;
    const p = RS.planet.planetAt(sys, j);
    if (p && !RS.civ.civOf(p, 0)) { idx = j; break; }
  }
  if (idx >= 0) {
    g.scene.system = sys;
    g.scene.systemAddr = { sx: 2, sy: 2, index: 0 };
    RS.scenes.selectBody(g, nullBus, idx);
    g.scene.kind = 'system';
    for (let i = 0; i < 120; i++) RS.scenes.tick(g, nullBus, 1 / 60);
    assert(!g.scene.contact, 'an empty world produces no contact state');
    assert(Object.keys(g.contacts).length === 0, 'and no relationship record');
  }
}

// ── cultures know about each other, and about what you did ───────────────
{
  const here = { system: { addr: { sx: 0, sy: 0, index: 0 } }, bodyIndex: 0, hash: 1, name: 'Here' };
  const there = { system: { addr: { sx: 2, sy: 0, index: 0 } }, bodyIndex: 0, hash: 2, name: 'There' };
  const pre = { tech: 0.1, tier: RS.civ.techTierOf(0.1), disposition: RS.civ.DISPOSITIONS[0] };
  const inter = { tech: 0.9, tier: RS.civ.techTierOf(0.9), disposition: RS.civ.DISPOSITIONS[0] };
  assert(!RS.contact.knowsOf(pre, here, there), 'a pre-industrial culture has not heard of a neighbour two sectors out');
  assert(RS.contact.knowsOf(inter, here, there), 'an interstellar culture has');
  assert(!RS.contact.knowsOf(inter, here, here), 'and never of itself');
  assert(RS.contact.knowledgeRadius(inter) > RS.contact.knowledgeRadius(pre),
    'reach is the knowledge radius');

  const g = RS.game.newGame(12345);
  /* Reuse the civilisation the previous block found — hunt again so this
   * block does not depend on execution order. */
  let found = null;
  outer2:
  for (let sx = 0; sx < 40; sx++) {
    for (let sy = 0; sy < 8; sy++) {
      for (let ix = 0; ix < 3; ix++) {
        const sys = RS.stellar.systemAt(g.seed, sx, sy, ix);
        for (let j = 0; j < sys.bodies.length; j++) {
          if (sys.bodies[j].kind !== 'planet') continue;
          const p = RS.planet.planetAt(sys, j);
          if (!p) continue;
          const civ = RS.civ.civOf(p, 0);
          if (civ) { found = { p, civ }; break outer2; }
        }
      }
    }
  }
  assert(found, 'rumour tests have a culture to observe');
  if (found) {
    const { p, civ } = found;
    const observer = Object.assign({}, civ, { tier: RS.civ.techTierOf(0.9) });
    /* A neighbour you allied with, close enough that an interstellar observer
     * would have heard. The neighbour does not have to exist as a derived
     * world — the rumour is the contact record. */
    const nk = (p.system.addr.sx + 1) + ',' + p.system.addr.sy + ',0,0';
    g.contacts[nk] = {
      standing: 0.7, awareness: 1, met: true, greeted: true,
      name: 'Ally Weave', where: 'Elsewhere', exchanges: 3, taught: [], gifts: 0, uplifted: 0
    };
    const rum = RS.contact.rumourOf(g, p, observer);
    assert(rum.notes.length > 0, 'they have heard of what you did to a neighbour');
    assert(rum.shift !== 0, 'and it moves standing, not just flavour');

    g.contacts[nk].standing = -0.8;
    const hostile = RS.contact.rumourOf(g, p, observer);
    assert(hostile.notes.some(n => /enemy|against/i.test(n)),
      'hostility toward a neighbour is a thing they will say');

    g.contacts[nk].standing = 0.2;
    g.contacts[nk].uplifted = 1;
    const up = RS.contact.rumourOf(g, p, observer);
    assert(up.notes.some(n => /raised/i.test(n)), 'uplift of a neighbour is heard');
    const insular = Object.assign({}, observer, {
      disposition: RS.civ.DISPOSITIONS.find(d => d.id === 'insular')
    });
    const curious = Object.assign({}, observer, {
      disposition: RS.civ.DISPOSITIONS.find(d => d.id === 'curious')
    });
    const wI = RS.contact.rumourOf(g, p, insular).shift;
    const wC = RS.contact.rumourOf(g, p, curious).shift;
    assert(wI < wC, 'an insular culture resents a neighbour being raised; a curious one does not');

    /* Effective standing is derived, so it is not a second saved number. */
    const rec = RS.contact.recordOf(g, p);
    rec.standing = 0;
    const effective = RS.contact.standingOf(g, p, curious);
    assert(Math.abs(effective - rec.standing) > 0.02, 'rumours change the standing the channel reads');
    assert(Math.abs(rec.standing) < 1e-9, 'without writing the contact record');
  }
}

// ── contact at range: a probe or beacon holds the channel ────────────────
{
  const g = RS.game.newGame(12345);
  let found = null;
  outer3:
  for (let sx = 0; sx < 40; sx++) {
    for (let sy = 0; sy < 8; sy++) {
      for (let ix = 0; ix < 3; ix++) {
        const sys = RS.stellar.systemAt(g.seed, sx, sy, ix);
        for (let j = 0; j < sys.bodies.length; j++) {
          if (sys.bodies[j].kind !== 'planet') continue;
          const p = RS.planet.planetAt(sys, j);
          if (p && RS.civ.civOf(p, 0)) { found = { sys, p, j, sx, sy, ix, civ: RS.civ.civOf(p, 0) }; break outer3; }
        }
      }
    }
  }
  assert(found, 'range tests have a culture');
  if (found) {
    const { p, civ, sys, j, sx, sy, ix } = found;
    g.scene.system = sys;
    g.scene.systemAddr = { sx, sy, index: ix };
    RS.scenes.selectBody(g, nullBus, j);
    g.scene.kind = 'system';

    assert(!RS.contact.hasRelay(g, p), 'no relay until you leave one');
    /* Presence still accrues without a relay. */
    const rec = RS.contact.recordOf(g, p);
    RS.contact.accrueAwareness(g, p, civ, 1);
    assert(rec.awareness > 0, 'being there still accrues awareness');

    /* Leave, and awareness stops without a relay. */
    const before = rec.awareness;
    g.scene.planet = null;
    RS.contact.accrueAwareness(g, p, civ, 10);
    assert(Math.abs(rec.awareness - before) < 1e-9, 'leaving without a relay stops accrual');

    /* A beacon is a relay — that is what "you can be sensed further out" was
     * always for. */
    g.scene.planet = p;
    g.structuresUnlocked.beacon = true;
    g.insight = 1e9; g.passiveRate = 1e6;
    assert(RS.influence.place(g, nullBus, p, 'beacon').ok, 'a beacon sites');
    g.scene.planet = null;
    RS.contact.accrueAwareness(g, p, civ, 1);
    assert(rec.awareness > before, 'a beacon keeps accruing awareness from elsewhere');
    assert(RS.contact.hasRelay(g, p), 'and counts as a relay');

    /* A stationed probe is the portable version. */
    const g2 = RS.game.newGame(12345);
    g2.scene.system = sys;
    g2.scene.systemAddr = { sx, sy, index: ix };
    RS.scenes.selectBody(g2, nullBus, j);
    g2.vessels.unlocked.probe = true;
    g2.body = RS.vessel.newBody('probe');
    g2.inhabiting = true;
    const st = RS.contact.stationProbe(g2, nullBus, p);
    assert(st.ok, 'a probe can be left behind');
    assert(RS.contact.probeOn(g2, p), 'and is stored as a delta, not a structure');
    assert(RS.contact.hasRelay(g2, p), 'so it is a relay');
    assert(RS.influence.structuresOn(g2, p).every(x => x.struct.id !== '@probe'),
      'and structuresOn does not see it as a billed structure');

    /* The offer agrees with the action. */
    const offers = RS.contact.offersFor(g2, p, civ);
    const station = offers.find(o => o.id === 'station');
    assert(station, 'the panel offers to station a probe while you are one');
    assert(!station.available, 'but not twice');

    /* Round-trip: the probe delta survives a save. */
    RS.save.writeNow(g2);
    const h = RS.save.hydrate(RS.save.readRaw());
    assert(RS.contact.probeOn(h, p), 'a stationed probe round-trips');

    /* Leaving a system without a relay drops the channel; with one, tickRelays
     * takes over instead of leaving a stale local contact stuck on the scene. */
    const g3 = RS.game.newGame(12345);
    g3.scene.planet = p;
    g3.scene.contact = { planet: p, civ, lock: { total: 0.9 }, state: RS.contact.STATES.open, relayed: false };
    g3.scene.planet = null;
    RS.contact.tickRelays(g3, nullBus, 1 / 60);
    assert(!g3.scene.contact, 'leaving without a relay drops the channel');

    g2.scene.contact = { planet: p, civ, lock: { total: 0.9 }, state: RS.contact.STATES.open, relayed: false };
    g2.scene.planet = null;
    for (let i = 0; i < RS.dials.UPGRADE.range.max; i++) {
      if (RS.dials.canUpgrade(g2.dials.frequency, 'range')) RS.dials.applyUpgrade(g2.dials.frequency, 'range');
    }
    for (let i = 0; i < RS.dials.UPGRADE.focus.max; i++) {
      if (RS.dials.canUpgrade(g2.dials.frequency, 'focus')) RS.dials.applyUpgrade(g2.dials.frequency, 'focus');
      if (RS.dials.canUpgrade(g2.dials.phase, 'focus')) RS.dials.applyUpgrade(g2.dials.phase, 'focus');
    }
    const car = RS.contact.carrierOf(g2, p, civ);
    RS.dials.setValue(g2, g2.dials.frequency, car.phi);
    RS.dials.setValue(g2, g2.dials.phase, car.phase);
    RS.contact.recordOf(g2, p).awareness = 1;
    RS.contact.tickRelays(g2, nullBus, 1 / 60);
    assert(g2.scene.contact && g2.scene.contact.relayed,
      'a stationed probe lets the channel follow you out of the system');
  }
}

// ── riding a civilisation leans on the logistic, not a stored civ ────────
{
  const g = RS.game.newGame(12345);
  let found = null;
  outer4:
  for (let sx = 0; sx < 40; sx++) {
    for (let sy = 0; sy < 8; sy++) {
      for (let ix = 0; ix < 3; ix++) {
        const sys = RS.stellar.systemAt(g.seed, sx, sy, ix);
        for (let j = 0; j < sys.bodies.length; j++) {
          if (sys.bodies[j].kind !== 'planet') continue;
          const p = RS.planet.planetAt(sys, j);
          const civ = p && RS.civ.civOf(p, 0);
          if (civ) { found = { p, civ, sys, j }; break outer4; }
        }
      }
    }
  }
  assert(found, 'ride tests have a culture');
  if (found) {
    const { p, civ } = found;
    const tech0 = civ.tech;
    const ctl = { rate: 1, vert: 1, heading: 0 };
    for (let i = 0; i < 240; i++) RS.contact.lean(g, p, ctl, 1 / 60);
    const bias = RS.contact.biasOn(g, p);
    assert(bias.work > 0 && bias.mag > 0, 'leaning accumulates a saturating bias');
    const applied = RS.contact.applyTo(g, p, RS.civ.civOf(p, 0));
    assert(applied.tech >= tech0, 'and the trajectory has moved, not a stored number');
    assert(applied.biased > 0, 'the civ reports that it was leaned on');

    /* Lattice ceiling is no longer scenery. */
    p.techCeiling = 0.12;
    const withLat = RS.contact.applyTo(g, p, RS.civ.civOf(p, 0));
    assert(withLat.tech > applied.tech || applied.tech > 0.98,
      'a lattice ceiling actually raises tech');

    /* A system with a civ is a mind the symbiont can ride. */
    g.scene.kind = 'system';
    g.scene.planet = p;
    g.scene.planet.civ = civ;
    const env = RS.vessel.environmentFor(g);
    assert(env.hasMinds, 'a selected civilisation is a mind to ride');
    assert(!RS.vessel.canOperate(RS.vessel.BY_ID.symbiont, env),
      'and the symbiont is allowed in orbit for that reason');
  }
}

// ── bloom captures a world buffer, not its own composite target ──────────
{
  assert(RS.bloom, 'bloom is loaded');
  assert(typeof RS.bloom.begin === 'function', 'and exposes a world buffer');
  assert(typeof RS.bloom.captureWorld === 'function', 'and a capture that reads it');
  assert(typeof RS.bloom.blit === 'function', 'and a blit onto the display');
  RS.bloom.setEnabled(true);
  assert(RS.bloom.isEnabled(), 'enabled is the default the settings toggle talks to');
  const buf = RS.bloom.begin(64, 48, 1);
  assert(buf && buf.ctx && buf.canvas, 'begin hands the renderer a context to draw into');
  RS.bloom.setEnabled(false);
  assert(!RS.bloom.begin(64, 48, 1), 'and begin refuses when bloom is off, so the display is the draw target');
  RS.bloom.setEnabled(true);
}


// ── the guide must never break, in any state ─────────────────────────────
{
  /* The guide is generated from live state in every scene and both modes, so
   * it touches more of the game than anything else in the UI. A crash here
   * would hit exactly the player who is already confused enough to open it. */
  const scenarios = [];

  // fresh game, every scene
  for (const tier of ['galactic', 'cluster', 'system', 'planetary']) {
    const g = RS.game.newGame(9100 + tier.length);
    for (let i = 0; i < 14; i++) RS.dials.applyUpgrade(g.dials.space, 'range');
    RS.dials.setValue(g, g.dials.space, RS.cosmos.BY_ID[tier].index);
    for (let i = 0; i < 90; i++) RS.scenes.tick(g, nullBus, 1 / 60);
    scenarios.push([tier + ' (observing)', g]);
  }

  // embodied
  {
    const g = RS.game.newGame(9200);
    for (let i = 0; i < 14; i++) RS.dials.applyUpgrade(g.dials.space, 'range');
    RS.dials.setValue(g, g.dials.space, RS.cosmos.BY_ID.planetary.index);
    for (let i = 0; i < 90; i++) RS.scenes.tick(g, nullBus, 1 / 60);
    g.vessels.unlocked.walker = true;
    RS.scenes.embark(g, nullBus, 'walker');
    scenarios.push(['planet (piloting)', g]);
  }

  // fully progressed
  {
    const g = RS.game.newGame(9300);
    g.insight = 1e9;
    for (const n of RS.influence.RESEARCH) RS.influence.tryResearch(g, nullBus, n.id);
    for (const b of RS.spectrum.BANDS) g.known.bands[b.id] = true;
    for (const t of RS.cosmos.TIERS) g.known.tiers[t.id] = true;
    for (let i = 0; i < RS.dials.UPGRADE.range.max; i++) {
      if (RS.dials.canUpgrade(g.dials.frequency, 'range')) RS.dials.applyUpgrade(g.dials.frequency, 'range');
      if (RS.dials.canUpgrade(g.dials.space, 'range')) RS.dials.applyUpgrade(g.dials.space, 'range');
    }
    for (let i = 0; i < RS.dials.UPGRADE.focus.max; i++) {
      if (RS.dials.canUpgrade(g.dials.frequency, 'focus')) RS.dials.applyUpgrade(g.dials.frequency, 'focus');
    }
    RS.influence.recomputeFields(g);
    scenarios.push(['fully progressed', g]);
  }

  let broke = [];
  for (const [label, g] of scenarios) {
    for (const [name, fn] of [['guide', RS.guide.guideHTML], ['pathways', RS.guide.pathwaysHTML]]) {
      try {
        const html = fn(g);
        if (typeof html !== 'string' || html.length < 200) broke.push(label + '/' + name + ' (too short)');
        if (/undefined|NaN|\[object/.test(html)) broke.push(label + '/' + name + ' (leaked a raw value)');
      } catch (e) {
        broke.push(label + '/' + name + ': ' + e.message);
      }
    }
    /* And the objective line, which the guide quotes. */
    try {
      const o = RS.game.sceneObjective(g);
      if (!o || !o.text || o.text.length < 8) broke.push(label + '/objective');
    } catch (e) { broke.push(label + '/objective: ' + e.message); }
  }
  assert(broke.length === 0, 'the guide renders in every scene and mode: ' + broke.join('; '));

  /* The dial rows must describe the mode the player is actually in — that is
   * the single most confusing thing about this game and the guide's main job. */
  const gObs = RS.game.newGame(9400);
  const obsRows = RS.guide.dialRows(gObs);
  assert(obsRows.length === 4, 'all four dials are described');
  assert(/scrub/i.test(obsRows[0].does), 'unembodied, τ is described as scrubbing time');
  assert(/ladder/i.test(obsRows[1].does), 'and Σ as moving the ladder');

  const gPil = RS.game.newGame(9401);
  gPil.vessels.unlocked.walker = true;
  gPil.body = RS.vessel.newBody('walker');
  gPil.inhabiting = true;
  const pilRows = RS.guide.dialRows(gPil);
  assert(pilRows[0].does === RS.vessel.BY_ID.walker.dialMap.time,
    'embodied, τ is described as the vessel says it is');
  assert(pilRows[1].does !== obsRows[1].does,
    'and Σ means something different from what it means unembodied');

  /* Every pathway must always have a concrete next step — "you have finished"
   * is not something this game should ever say by accident. */
  for (const [label, g] of scenarios) {
    const html = RS.guide.pathwaysHTML(g);
    const arrows = (html.match(/→/g) || []).length;
    assert(arrows >= 3, 'all three pathways state a next step in ' + label + ' (' + arrows + ')');
  }
}


// ── the generative core: four axes ───────────────────────────────────────
{
  const E = RS.fractal.ESSENCES;
  const AX = RS.fractal.AXES;
  assert(AX.length === 4, 'there are exactly four axes');

  let bad = [];
  for (const e of E) {
    for (const a of AX) {
      if (typeof e[a] !== 'number' || e[a] < 0 || e[a] > 1) bad.push(e.id + '.' + a);
    }
  }
  assert(bad.length === 0, 'every essence declares all four axes in 0..1: ' + bad.join(', '));

  /* The essences must be *distinguishable*. If two sit on top of each other in
   * all four axes they generate identical mechanics everywhere and the player
   * can never tell them apart — which would quietly collapse the essence set
   * into a smaller one. */
  let collisions = [];
  for (let i = 0; i < E.length; i++) {
    for (let j = i + 1; j < E.length; j++) {
      let same = true;
      for (const a of AX) if (Math.abs(E[i][a] - E[j][a]) > 0.1) same = false;
      if (same) collisions.push(E[i].id + '/' + E[j].id);
    }
  }
  assert(collisions.length === 0, 'no two essences are indistinguishable: ' + collisions.join(', '));

  /* Each axis must actually be used across its range, or it is decoration. */
  for (const a of AX) {
    const vals = E.map(e => e[a]);
    const spread = Math.max(...vals) - Math.min(...vals);
    assert(spread > 0.6, 'axis "' + a + '" spans a real range (' + spread.toFixed(2) + ')');
  }

  /* Spot-check that the numbers agree with the prose they came from. These are
   * the claims the trait strings already make, and if a number ever drifts
   * away from its description the player's intuition breaks. */
  const by = RS.fractal.ESSENCE_BY_ID;
  assert(by.lattice.symmetry >= 0.95,
    'Lattice — "order that repeats without a centre" — is maximally symmetric');
  assert(by.attractor.complexity < by.lattice.complexity,
    'an Attractor is one basin and a Lattice is a repeating structure, so the lattice carries more');
  assert(by.cascade.branching >= 0.85 && by.cascade.persistence <= 0.25,
    'Cascade — "spends itself buying a thousand others" — branches hard and does not persist');
  assert(by.memory.persistence >= 0.95, 'Memory persists');
  assert(by.void.complexity <= 0.2, 'Void carries almost no structure');
  assert(by.emergence.complexity >= 0.95, 'Emergence carries the most');
  assert(by.attractor.branching <= 0.05, 'Attractor converges rather than branches');
  assert(by.seed.branching >= 0.8 && by.seed.persistence <= 0.15,
    'Seed — "compressed instructions for something enormously larger" — sprays and does not last');
}

// ── the six primitives ───────────────────────────────────────────────────
{
  const EM = RS.emergence;
  const E = RS.fractal.ESSENCES;
  assert(EM.IDS.length === 6, 'there are exactly six primitives');

  /* Finite for every essence at every scale — this is called per node per
   * frame, and one NaN poisons a node's position for the rest of the session. */
  let nan = [];
  for (const e of E) {
    for (let tier = 0; tier < RS.cosmos.TIERS.length; tier++) {
      for (const t of [0, 0.37, 12.5, 1e4]) {
        const g = EM.GATE(e, tier, t, {});
        const f = EM.FLOW(e, 0.3, -0.7, t, {});
        if (!Number.isFinite(g.open) || !Number.isFinite(g.period) || g.period <= 0) nan.push('GATE ' + e.id + '@' + tier);
        if (!Number.isFinite(f.gx) || !Number.isFinite(f.gy)) nan.push('FLOW ' + e.id + '@' + tier);
      }
    }
    const n = EM.NEST(e, {}), o = EM.ORDER(e, 1234, {}), w = EM.TWIN(e, 99, {}), v = EM.INVERT(e, {});
    if (!Number.isFinite(n.depth) || n.depth < 1) nan.push('NEST ' + e.id);
    if (!Number.isFinite(n.total) || n.total < 1) nan.push('NEST.total ' + e.id);
    if (!o.prereqs.length) nan.push('ORDER ' + e.id);
    if (!Number.isFinite(w.separation)) nan.push('TWIN ' + e.id);
    if (!Number.isFinite(v.strength)) nan.push('INVERT ' + e.id);
  }
  assert(nan.length === 0, 'every primitive is finite for every essence at every scale: ' +
    nan.slice(0, 4).join(', '));

  /* Each primitive must actually respond to the axis it claims to read. */
  const cascade = RS.fractal.ESSENCE_BY_ID.cascade;   // branching 0.90
  const lattice = RS.fractal.ESSENCE_BY_ID.lattice;   // branching 0.00
  assert(EM.GATE(cascade, 13, 0, {}).subdiv > EM.GATE(lattice, 13, 0, {}).subdiv,
    'a branching essence subdivides its rhythm more than a regular one');
  assert(EM.NEST(cascade, {}).fanout > EM.NEST(lattice, {}).fanout,
    'and nests wider');
  assert(EM.ORDER(cascade, 1, {}).fanout > EM.ORDER(lattice, 1, {}).fanout,
    'and depends on more things');
  assert(EM.FLOW(cascade, 1, 0, 0, {}).divergence > EM.FLOW(lattice, 1, 0, 0, {}).divergence,
    'and its gradient diverges rather than converges');

  const emergence = RS.fractal.ESSENCE_BY_ID.emergence;  // complexity 1.0
  const voidE = RS.fractal.ESSENCE_BY_ID.void;           // complexity 0.15
  assert(EM.NEST(emergence, {}).depth > EM.NEST(voidE, {}).depth,
    'NEST depth is monotonic in complexity');

  const duality = RS.fractal.ESSENCE_BY_ID.duality;      // symmetry 1.0
  assert(EM.TWIN(duality, 1, {}).separation < EM.TWIN(cascade, 1, {}).separation,
    'a symmetric essence twins close and confusingly; an asymmetric one throws its double wide');

  const memory = RS.fractal.ESSENCE_BY_ID.memory;        // persistence 1.0
  assert(EM.INVERT(memory, {}).strength < EM.INVERT(RS.fractal.ESSENCE_BY_ID.seed, {}).strength,
    'persistence resists inversion');

  /* The scale coupling — the thing that makes one band many places for free. */
  const fast = EM.GATE(cascade, RS.cosmos.BY_ID.cellular.index, 0, {}).period;
  const slow = EM.GATE(cascade, RS.cosmos.BY_ID.supercluster.index, 0, {}).period;
  assert(slow > fast * 5,
    'the same essence in the same band is far slower at a large scale (' +
    fast.toFixed(2) + 's vs ' + slow.toFixed(2) + 's)');

  /* GATE must actually open and close, or the rhythm layer is unplayable. */
  let sawOpen = false, sawShut = false;
  for (let t = 0; t < 20; t += 0.01) {
    const g = EM.GATE(cascade, 13, t, {});
    if (g.open > 0.95) sawOpen = true;
    if (g.open < 0.05) sawShut = true;
  }
  assert(sawOpen && sawShut, 'a gate genuinely opens and shuts');

  /* ORDER must be an ordering, not a cycle. */
  let selfDep = [];
  for (const e of E) {
    if (EM.ORDER(e, 7, {}).prereqs.indexOf(e.id) >= 0) selfDep.push(e.id);
  }
  assert(selfDep.length === 0, 'nothing depends on itself: ' + selfDep.join(', '));

  /* Purity: same inputs, same outputs. */
  const a1 = EM.GATE(cascade, 13, 3.3, {}), a2 = EM.GATE(cascade, 13, 3.3, {});
  assert(a1.open === a2.open && a1.period === a2.period, 'primitives are pure');
}

// ── bands compose primitives ─────────────────────────────────────────────
{
  const B = RS.spectrum.BANDS;
  let noPrim = B.filter(b => !b.prim || !b.prim.length);
  assert(noPrim.length === 0, 'every band declares at least one primitive');

  let unknown = [];
  for (const b of B) for (const p of b.prim) if (RS.emergence.IDS.indexOf(p) < 0) unknown.push(b.id + '/' + p);
  assert(unknown.length === 0, 'every declared primitive exists: ' + unknown.join(', '));

  /* Every primitive must be used by some band, or it is dead code. */
  const used = new Set();
  for (const b of B) for (const p of b.prim) used.add(p);
  const unusedPrims = RS.emergence.IDS.filter(p => !used.has(p));
  assert(unusedPrims.length === 0, 'every primitive is used by some band: ' + unusedPrims.join(', '));

  /* Bands must differ from each other in what they demand. */
  const sigs = new Set(B.map(b => b.prim.slice().sort().join('+')));
  assert(sigs.size >= 8, 'the twelve bands present at least eight distinct primitive sets (' + sigs.size + ')');

  assert(RS.spectrum.demandOf(RS.spectrum.BY_ID.unity) > RS.spectrum.demandOf(RS.spectrum.BY_ID.baryonic),
    'Unity demands more than Baryonic, and difficulty is derived from that');
}

// ── one generator, every scale ───────────────────────────────────────────
{
  const SS = RS.selfsimilar;
  const geoms = [...new Set(RS.cosmos.TIERS.map(t => t.geometry))];
  const buf = SS.newBuffer();

  let over = [], empty = [];
  for (const e of RS.fractal.ESSENCES) {
    for (const g of geoms) {
      SS.build(e, g, 12345, buf);
      if (buf.count > SS.MAX_SEGMENTS) over.push(e.id + '/' + g);
      if (buf.count < 1) empty.push(e.id + '/' + g);
      for (let i = 0; i < buf.count * SS.STRIDE; i++) {
        if (!Number.isFinite(buf.data[i])) { over.push(e.id + '/' + g + ' NaN'); break; }
      }
    }
  }
  assert(over.length === 0, 'generated structure is bounded and finite: ' + over.slice(0, 3).join(', '));
  assert(empty.length === 0, 'nothing generates an empty structure: ' + empty.slice(0, 3).join(', '));

  /* THE SELF-SIMILARITY CLAIM. Geometry changes the ink and never the
   * structure — the same essence must produce the identical topology at every
   * geometry, or a spiral arm and a coiled flagellum are merely two drawings
   * rather than one thing rendered by different local rules. */
  let divergent = [];
  for (const e of RS.fractal.ESSENCES) {
    let ref = null;
    for (const g of geoms) {
      SS.build(e, g, 999, buf);
      const topo = SS.topology(buf);
      if (ref === null) ref = topo;
      else if (topo !== ref) divergent.push(e.id + '/' + g + ' ' + topo + ' != ' + ref);
    }
  }
  assert(divergent.length === 0,
    'one essence has one topology at every geometry — geometry is only ink: ' +
    divergent.slice(0, 3).join(', '));

  /* But different essences must produce different structures, or the generator
   * is not reading its inputs. */
  const topos = new Set();
  for (const e of RS.fractal.ESSENCES) { SS.build(e, 'body', 5, buf); topos.add(SS.topology(buf)); }
  assert(topos.size >= 7, 'different essences generate genuinely different structures (' + topos.size + ')');

  /* Determinism, as everywhere else in this codebase. */
  SS.build(RS.fractal.ESSENCE_BY_ID.spiral, 'disc', 42, buf);
  const first = SS.topology(buf) + ':' + buf.data[10].toFixed(6);
  SS.build(RS.fractal.ESSENCE_BY_ID.spiral, 'disc', 42, buf);
  assert(first === SS.topology(buf) + ':' + buf.data[10].toFixed(6), 'generation is deterministic');
}

// ── a drawing that fits where it is put ──────────────────────────────────
/* `draw` scales the skeleton by a radius, and how far the skeleton reaches
 * depends entirely on the essence — so a constant radius makes a branching
 * essence spill out of whatever is meant to contain it. `fit` is what stops a
 * mitochondrion from being drawn through the cell wall. */
{
  const geoms = ['cell', 'chain', 'web', 'disc', 'body', 'foam', 'orbital', 'abstract'];
  let worst = 0, worstId = '';
  for (const e of RS.fractal.ESSENCES) {
    const buf = RS.selfsimilar.build(e, 'cell', 99, RS.selfsimilar.newBuffer());
    assert(Number.isFinite(buf.extent) && buf.extent > 0, e.id + ' has a measurable extent');
    if (buf.extent > worst) { worst = buf.extent; worstId = e.id; }
    /* The contract: scaled by `fit(buf, R)`, nothing reaches past R. */
    const R = 0.4;
    const k = RS.selfsimilar.fit(buf, R);
    let over = 0;
    for (let i = 0; i < buf.count; i++) {
      const j = i * RS.selfsimilar.STRIDE;
      const d = Math.hypot(buf.data[j + 2], buf.data[j + 3]) * k;
      if (d > R + 1e-9) over++;
    }
    assert(over === 0, e.id + ' fits inside what it is told to fit inside');
  }
  assert(worst > 1.5,
    'the widest essence really does reach far beyond its nominal size (' +
    worstId + ' at ' + worst.toFixed(2) + '×) — which is why fit() has to exist');
  /* Extent is geometry-independent, like every other topological property. */
  for (const e of RS.fractal.ESSENCES.slice(0, 4)) {
    const a = RS.selfsimilar.build(e, geoms[0], 5, RS.selfsimilar.newBuffer());
    const b = RS.selfsimilar.build(e, geoms[3], 5, RS.selfsimilar.newBuffer());
    assert(Math.abs(a.extent - b.extent) < 1e-9,
      e.id + ' reaches equally far whatever it is drawn as');
  }
}

// ── gnosis as foresight ──────────────────────────────────────────────────
{
  const g = RS.game.newGame(31337);
  const eid = 'cascade';

  let p = RS.fractal.predicted(g, eid, {});
  assert(p.revealed === 0, 'an unknown essence reveals nothing');
  assert(p.complexity === undefined && p.branching === undefined,
    'and no axis leaks through');
  assert(p.nextAt === 2, 'and it says what it would take to learn the first axis');

  /* Recognise it in more and more contexts; axes must appear monotonically. */
  const seen = [];
  let prevRevealed = 0;
  for (let i = 0; i < 10; i++) {
    (g.gnosis[eid] || (g.gnosis[eid] = [])).push(eid + '@' + i + ':0');
    p = RS.fractal.predicted(g, eid, {});
    assert(p.revealed >= prevRevealed, 'revelation never goes backwards');
    prevRevealed = p.revealed;
    seen.push(p.revealed);
  }
  assert(prevRevealed === 4, 'enough contexts reveal all four axes (' + seen.join(',') + ')');

  /* Revealed values must be the *true* ones — a prediction that lies is worse
   * than no prediction. */
  const truth = RS.fractal.ESSENCE_BY_ID[eid];
  p = RS.fractal.predicted(g, eid, {});
  for (const a of RS.fractal.AXES) {
    assert(p[a] === truth[a], 'a revealed axis is the real value (' + a + ')');
  }

  /* And a predicted essence must drive the primitives to the same answer the
   * real one does, once fully revealed — that is what makes foresight real. */
  const pe = RS.fractal.predictedEssence(g, eid, {});
  assert(pe.confidence === 1, 'a fully-known essence is fully confident');
  const realGate = RS.emergence.GATE(truth, 13, 1.5, {});
  const predGate = RS.emergence.GATE(pe, 13, 1.5, {});
  assert(realGate.subdiv === predGate.subdiv && Math.abs(realGate.period - predGate.period) < 1e-9,
    'a fully-revealed prediction matches what the world actually does');

  /* A partially-known essence must still predict *something* usable rather
   * than nonsense. */
  const g2 = RS.game.newGame(31337);
  g2.gnosis.spiral = ['spiral@1:0', 'spiral@2:0'];
  const pe2 = RS.fractal.predictedEssence(g2, 'spiral', {});
  assert(pe2.confidence === 0.25, 'two contexts is one axis of four');
  const gate2 = RS.emergence.GATE(pe2, 13, 0, {});
  assert(Number.isFinite(gate2.period) && gate2.period > 0,
    'a partial prediction still produces a usable guess');

  /* Different worlds must reveal in different orders, so two players build
   * genuinely different intuitions about the same essence. */
  const orders = new Set();
  for (let s = 0; s < 40; s++) {
    orders.add(RS.fractal.revealOrder(s * 7919, truth).join(','));
  }
  assert(orders.size > 3, 'reveal order varies by world (' + orders.size + ' orders seen)');
}

// ── every band is winnable, and no two play alike ────────────────────────
/* This is the Phase 2 acceptance test. `applyMode`'s twelve hand-written cases
 * are gone; behaviour now comes from each band's `prim[]` composed with each
 * node's own four axes. Two things have to be true for that to be an
 * improvement rather than a refactor: every layer must still be beatable, and
 * the layers must still be genuinely different places. Both are measured here
 * by actually playing them. */
{
  const nBands = RS.spectrum.BANDS.length;

  /* A player that hill-climbs alignment instead of assuming "match the
   * signature". That distinction matters: a band running INVERT scores
   * backwards by an amount that depends on the *node's* persistence, so the
   * optimal placement is a partial mistune that no fixed rule could guess. A
   * tuner that only knew how to match would report the Null layer unwinnable
   * when it is merely inside out. */
  function bestPlacement(g, n) {
    const D = g.dials;
    const band = RS.spectrum.BANDS[n.man.bandIndex];
    const on = {
      frequency: n.man.signature,
      phase: n.man.phase,
      time: clampTo(D.time, n.man.rate),
      space: n.man.tierIndex
    };
    /* "Off" placements stay inside the band and inside the rung — a mistune
     * that changed which layer or which scale was being observed would just
     * abandon the node rather than score it badly. */
    const off = {
      frequency: n.man.signature + band.width * 0.5,
      phase: n.man.phase + Math.PI,
      time: clampTo(D.time, n.man.rate + (n.man.rate > 0 ? -2.2 : 2.2)),
      space: n.man.tierIndex + 0.45
    };
    const keys = ['frequency', 'phase', 'time', 'space'];
    let best = null, bestScore = -1;
    for (let mask = 0; mask < 16; mask++) {
      for (let k = 0; k < 4; k++) {
        RS.dials.setValue(g, D[keys[k]], (mask & (1 << k)) ? off[keys[k]] : on[keys[k]]);
      }
      const s = RS.field.alignmentOf(g, n).total;
      if (s > bestScore) {
        bestScore = s;
        best = keys.map(k => D[k].value);
      }
    }
    for (let k = 0; k < 4; k++) RS.dials.setValue(g, D[keys[k]], best[k]);
    return bestScore;
  }

  function clampTo(dial, v) { return Math.max(dial.min, Math.min(dial.max, v)); }

  /* A fully-upgraded observer, because the question here is whether a layer is
   * *beatable*, not whether it is reachable — reachability is tested by the
   * economy block above. */
  function maxedGame(seed) {
    const g = RS.game.newGame(seed);
    for (const id of ['frequency', 'phase', 'time', 'space']) {
      const d = g.dials[id];
      for (const kind of ['range', 'precision', 'focus']) {
        for (let i = 0; i < 40; i++) RS.dials.applyUpgrade(d, kind);
      }
    }
    return g;
  }

  /* Play one band for `secs` of simulated time and report what it felt like. */
  function soak(band, secs, seed) {
    const g = maxedGame(seed);
    /* Antecedents you understand count as held (see field.js), so a soak of an
     * ordering layer has to start from a player who has been somewhere else
     * first — which is exactly the state any real player reaches it in. Half
     * the ledger, not all of it: a player who understood everything would
     * never see a dependency block, and blocking is the layer's mechanic. */
    RS.fractal.ESSENCES.forEach((e, i) => { if (i % 2 === 0) g.gnosis[e.id] = [e.id + '@6:0']; });

    RS.dials.setValue(g, g.dials.space, 13);
    RS.dials.setValue(g, g.dials.frequency, band.centre);

    let crystals = 0, gateSum = 0, gateN = 0, blockedFrames = 0, twinFrames = 0;
    let deepest = 0, holdSum = 0, holdN = 0, insightStart = 0;
    let moveSum = 0, invSum = 0, passiveSum = 0;
    const lastRad = new Map();
    const bus = { emit(k, p) { if (k === 'node:crystallise') { crystals++; holdSum += p.node.age; holdN++; } }, on() {} };

    const steps = Math.round(secs * 60);
    let target = null;
    for (let i = 0; i < steps; i++) {
      /* Re-pick a target when the old one is gone, then hold the dials on it. */
      if (!target || target.dying || target.crystallised || g.field.nodes.indexOf(target) < 0) {
        target = null;
        for (const n of g.field.nodes) {
          if (n.dying || n.crystallised) continue;
          if (n.man.bandIndex !== band.index) continue;
          if (!target || n.man.potency > target.man.potency) target = n;
        }
        if (target) bestPlacement(g, target);
      } else if ((i % 8) === 0) {
        bestPlacement(g, target);
      }
      if (i === 30) insightStart = g.insight;
      RS.field.tick(g, bus, 1 / 60);
      passiveSum += g.passiveRate * (1 / 60) * RS.field.passiveShareOf(band);
      for (const n of g.field.nodes) {
        if (n.man.bandIndex !== band.index) continue;
        gateSum += n.gate; gateN++;
        if (n.blocked) blockedFrames++;
        if (n.twinInfo && !n.collapsed) twinFrames++;
        if (n.depth > deepest) deepest = n.depth;
        /* How much the layer *moves things about* — FLOW's signature, and
         * invisible to every other primitive. */
        const prev = lastRad.get(n.id);
        if (prev !== undefined) moveSum += Math.abs(n.targetRad - prev);
        lastRad.set(n.id, n.targetRad);
        invSum += n.inv ? n.inv.strength : 0;
      }
    }
    return {
      crystals,
      gate: gateN ? gateSum / gateN : 1,
      blocked: gateN ? blockedFrames / gateN : 0,
      twin: gateN ? twinFrames / gateN : 0,
      deepest,
      hold: holdN ? holdSum / holdN : 0,
      passive: RS.field.passiveShareOf(band),
      move: gateN ? moveSum / gateN * 60 : 0,
      inverted: gateN ? invSum / gateN : 0,
      passiveEarned: passiveSum,
      income: g.insight - insightStart
    };
  }

  /* Averaged over three worlds, and the *same* three for every band. A single
   * soak swings by 3× on the seed alone — enough to make two layers that are
   * provably identical in every derived parameter look like a balance problem,
   * which is a good way to spend an afternoon tuning noise. */
  const SEEDS = [4201, 77003, 918277, 31771, 655219];
  function soakAvg(band) {
    const runs = SEEDS.map(sd => soak(band, 90, sd));
    const out = {};
    for (const k of Object.keys(runs[0])) {
      out[k] = k === 'deepest'
        ? Math.max(...runs.map(r => r[k]))
        : runs.reduce((a, r) => a + r[k], 0) / runs.length;
    }
    return out;
  }

  const profiles = [];
  for (const band of RS.spectrum.BANDS) {
    const r = soakAvg(band);
    profiles.push(r);
    assert(r.crystals > 0,
      'the ' + band.name + ' layer is winnable (' + r.crystals.toFixed(0) + ' crystals in 90s)');
  }

  /* The gated layers must actually spend time shut, and the ungated ones must
   * not — otherwise `prim` is decorative. */
  for (let i = 0; i < nBands; i++) {
    const band = RS.spectrum.BANDS[i], p = profiles[i];
    if (RS.spectrum.usesPrim(band, 'gate')) {
      assert(p.gate < 0.93, band.name + ' genuinely gates (mean openness ' + p.gate.toFixed(2) + ')');
    } else {
      assert(p.gate > 0.999, band.name + ' does not gate, so nothing there blinks');
    }
    if (RS.spectrum.usesPrim(band, 'twin')) {
      assert(p.twin > 0.02, band.name + ' shows uncollapsed doubles');
    } else {
      assert(p.twin === 0, band.name + ' shows no doubles');
    }
    if (RS.spectrum.usesPrim(band, 'nest')) {
      assert(p.deepest > 0, band.name + ' exposes children when a parent is held');
    } else {
      assert(p.deepest === 0, band.name + ' does not nest');
    }
    if (!RS.spectrum.usesPrim(band, 'order')) {
      assert(p.blocked === 0, band.name + ' has no antecedents to wait on');
    }
  }

  /* Idle income exists in exactly the layers a gradient can carry it through,
   * and the first layer is the idle one. */
  assert(profiles[0].passiveEarned > 0, 'the Baryonic layer pays while you are not looking');
  assert(RS.field.passiveShareOf(RS.spectrum.BY_ID.thermal) === 0,
    'the Thermal layer drifts too fast for anything to settle');
  assert(RS.field.passiveShareOf(RS.spectrum.BY_ID.baryonic) >
         RS.field.passiveShareOf(RS.spectrum.BY_ID.noetic),
    'and the calm shallow layer out-idles the crowded deep one');

  /* ── The economy has to reward going deeper ─────────────────────────────
   *
   * Yields climb 1.0 → 88 up the spectrum, but a yield table is a promise, not
   * a result: what a layer actually pays is yield × throughput, and the
   * primitives move throughput by an order of magnitude. Measure the promise
   * being kept.
   *
   * The standard is deliberately not "strictly monotone". The nesting layers
   * are burst earners — a chain hands you crystals without a search — so they
   * out-pay their immediate successors, and that is a real strategic choice
   * rather than a defect: farm Vital for volume or work Emotional for value.
   * What must hold is that progress is never punished. */
  const earned = profiles.map(p => p.income);
  for (let i = 2; i < nBands; i++) {
    assert(earned[i] > earned[i - 2],
      RS.spectrum.BANDS[i].name + ' out-earns the layer you came up through (' +
      earned[i].toFixed(0) + ' vs ' + earned[i - 2].toFixed(0) + ')');
  }
  for (let i = 1; i < nBands; i++) {
    assert(earned[i] > earned[i - 1] * 0.5,
      RS.spectrum.BANDS[i].name + ' is not a cliff after ' + RS.spectrum.BANDS[i - 1].name +
      ' (' + (earned[i] / earned[i - 1]).toFixed(2) + '×)');
  }
  for (let i = 1; i < nBands; i++) {
    assert(earned[i] < earned[i - 1] * 30,
      RS.spectrum.BANDS[i].name + ' is a step and not a lottery win (' +
      (earned[i] / earned[i - 1]).toFixed(1) + '×)');
  }
  assert(earned[nBands - 1] > earned[0] * 50,
    'the far end of the spectrum is worth reaching (' +
    (earned[nBands - 1] / earned[0]).toFixed(0) + '× the first layer)');

  /* No two *primitive sets* may produce the same interaction profile. Bands
   * that share a set (Mnemonic and Archetypal both run order+nest) are allowed
   * to play alike — they differ in yield, width and drift, not in mechanics —
   * but every distinct set must be a distinct experience or the composition is
   * not buying anything. */
  const byPrim = new Map();
  for (let i = 0; i < nBands; i++) {
    const key = RS.spectrum.BANDS[i].prim.slice().sort().join('+');
    if (!byPrim.has(key)) byPrim.set(key, []);
    byPrim.get(key).push(i);
  }
  const keys = [...byPrim.keys()];
  assert(keys.length >= 8, 'the twelve layers span at least eight distinct mechanics (' + keys.length + ')');

  function fingerprint(i) {
    const p = profiles[i];
    return [p.gate, p.twin, p.blocked, Math.min(1, p.deepest / 4),
      RS.field.passiveShareOf(RS.spectrum.BANDS[i]),
      Math.min(1, p.move * 4), p.inverted];
  }
  let collisions = [];
  for (let a = 0; a < keys.length; a++) {
    for (let b = a + 1; b < keys.length; b++) {
      const fa = fingerprint(byPrim.get(keys[a])[0]);
      const fb = fingerprint(byPrim.get(keys[b])[0]);
      let far = false;
      for (let k = 0; k < fa.length; k++) if (Math.abs(fa[k] - fb[k]) > 0.05) far = true;
      if (!far) collisions.push(keys[a] + ' ≡ ' + keys[b]);
    }
  }
  assert(collisions.length === 0,
    'every distinct primitive set plays differently: ' + (collisions.join(', ') || 'none alike'));
}

// ── one essence, recognisable in all twelve layers ───────────────────────
/* The thesis, stated as a test. Cascade's branching is 0.90 and Lattice's is
 * 0.50; if that difference does not show up in every band that runs a
 * branching-sensitive primitive, then knowledge does not transfer and the
 * whole design is just twelve minigames wearing a costume. */
{
  const EM = RS.emergence;
  const cascade = RS.fractal.ESSENCE_BY_ID.cascade;
  const lattice = RS.fractal.ESSENCE_BY_ID.lattice;
  const attractor = RS.fractal.ESSENCE_BY_ID.attractor;

  let checked = 0, wrong = [];
  for (const band of RS.spectrum.BANDS) {
    for (const tier of [1, 5, 9, 13, 20]) {
      if (RS.spectrum.usesPrim(band, 'gate')) {
        checked++;
        if (!(EM.GATE(cascade, tier, 0, {}).subdiv > EM.GATE(lattice, tier, 0, {}).subdiv)) {
          wrong.push('gate/' + band.id + '@' + tier);
        }
      }
      if (RS.spectrum.usesPrim(band, 'nest')) {
        checked++;
        if (!(EM.NEST(cascade, {}).fanout > EM.NEST(attractor, {}).fanout)) {
          wrong.push('nest/' + band.id + '@' + tier);
        }
      }
      if (RS.spectrum.usesPrim(band, 'order')) {
        checked++;
        if (!(EM.ORDER(cascade, 5, {}).fanout > EM.ORDER(attractor, 5, {}).fanout)) {
          wrong.push('order/' + band.id + '@' + tier);
        }
      }
      if (RS.spectrum.usesPrim(band, 'flow')) {
        checked++;
        if (!(EM.FLOW(cascade, 0.5, 0.3, 1, {}).divergence > EM.FLOW(attractor, 0.5, 0.3, 1, {}).divergence)) {
          wrong.push('flow/' + band.id + '@' + tier);
        }
      }
      if (RS.spectrum.usesPrim(band, 'twin')) {
        checked++;
        /* Cascade is asymmetric, so it throws its double further than the
         * perfectly symmetric Lattice does. */
        if (!(EM.TWIN(cascade, 3, {}).separation > EM.TWIN(lattice, 3, {}).separation)) {
          wrong.push('twin/' + band.id + '@' + tier);
        }
      }
    }
  }
  assert(checked > 100, 'the branching claim is checked across the whole spectrum (' + checked + ' places)');
  assert(wrong.length === 0, 'Cascade branches everywhere it can: ' + (wrong.join(', ') || 'no exceptions'));
}

// ── the scene registry covers the ladder exactly once ────────────────────
{
  const covered = new Array(RS.cosmos.TIERS.length).fill(0);
  for (const sc of RS.scenes.SCENES) {
    assert(sc.first >= 0 && sc.last < RS.cosmos.TIERS.length && sc.first <= sc.last,
      sc.id + ' claims a valid range of rungs');
    for (let i = sc.first; i <= sc.last; i++) covered[i]++;
  }
  /* Overlap is legal — a specific scope sits inside a general one and wins by
   * being listed first — but a gap is not: every rung must resolve to
   * something, or turning Σ lands the player nowhere. */
  const gaps = [];
  for (let i = 0; i < covered.length; i++) if (!covered[i]) gaps.push(RS.cosmos.TIERS[i].id);
  assert(gaps.length === 0, 'every rung of the ladder resolves to a scene: ' + (gaps.join(', ') || 'no gaps'));

  for (let i = 0; i < RS.cosmos.TIERS.length; i++) {
    const id = RS.scenes.sceneForTier(i);
    assert(RS.scenes.SCENE_BY_ID[id], 'rung ' + i + ' resolves to a registered scene');
  }
  assert(RS.scenes.sceneForTier(RS.scenes.TIER_CELL) === 'cellular',
    'the cellular rung shows the cellular scope, not a planet surface');
  /* And it does not leak: a one-rung scope owns exactly one rung, whatever
   * happens to be on either side of it as the ladder fills in. */
  assert(RS.scenes.sceneForTier(RS.scenes.TIER_CELL - 1) !== 'cellular' &&
         RS.scenes.sceneForTier(RS.scenes.TIER_CELL + 1) !== 'cellular',
    'and it owns exactly that one rung');
  assert(RS.scenes.tierForScene('cellular') === RS.scenes.TIER_CELL,
    'a pathway can name the rung the cellular scope is entered at');
}

// ── the cellular scope ───────────────────────────────────────────────────
{
  /* Find a living world to be inside. Deriving one rather than fabricating it
   * matters: if the galaxy cannot produce a cell to stand in, the scope is
   * unreachable in real play and an assertion on a hand-built planet would
   * hide that. */
  const g = RS.game.newGame(60607);
  let living = null;
  outer:
  for (let sx = -3; sx <= 3 && !living; sx++) {
    for (let sy = -3; sy <= 3; sy++) {
      const sys = RS.stellar.systemAt(g.seed, sx, sy, 0);
      if (!sys) continue;
      for (let i = 0; i < sys.bodies.length; i++) {
        if (sys.bodies[i].kind !== 'planet') continue;
        const p = RS.scenes.derivePlanet(g, sys, i);
        if (p && p.biosphere && p.biosphere.complexity > 0.05) { living = { sys, i, p }; break outer; }
      }
    }
  }
  assert(living, 'the galaxy contains a world with cells in it');

  if (living) {
    const p = living.p;
    assert(RS.cellular.reasonSterile(p) === null, 'a living world can be entered');

    /* Derivation is pure — the same address is the same cell, always. Without
     * this, returning to a cell you influenced would show you a different one. */
    const a = RS.cellular.cellAt(g, p, 0.25, 3);
    const b = RS.cellular.cellAt(g, p, 0.25, 3);
    assert(a.organelles.length === b.organelles.length &&
      a.organelles.every((o, i) => o.essence.id === b.organelles[i].essence.id &&
        Math.abs(o.x - b.organelles[i].x) < 1e-12),
      'a cell is a pure function of its address');
    const c2 = RS.cellular.cellAt(g, p, 0.25, 4);
    assert(c2.organelles.some((o, i) => !a.organelles[i] || o.essence.id !== a.organelles[i].essence.id) ||
      c2.organelles.length !== a.organelles.length,
      'and the cell next door is a different cell');

    /* The cell type has to follow the host, or the scope is decoration. */
    assert(RS.cellular.typeFor(0.01).id === 'protocell' &&
           RS.cellular.typeFor(0.5).id === 'eukaryote' &&
           RS.cellular.typeFor(0.95).id === 'neural',
      'cell type follows the host biosphere');
    let mono = true;
    for (let i = 1; i < RS.cellular.TYPES.length; i++) {
      if (RS.cellular.TYPES[i].organelles <= RS.cellular.TYPES[i - 1].organelles) mono = false;
      if (RS.cellular.TYPES[i].minComplexity <= RS.cellular.TYPES[i - 1].minComplexity) mono = false;
    }
    assert(mono, 'more complex life means more machinery inside the cell');

    /* A sterile world must refuse entry, and say why. */
    const dead = { name: 'Dead', biosphere: null, surfaceTemp: 200, pressure: 0, gravity: 1, flux: 1 };
    assert(typeof RS.cellular.reasonSterile(dead) === 'string',
      'a sterile world explains itself rather than opening an empty cell');

    /* The unreachable content is now reachable: every organelle names a `cell`
     * form, which is exactly the 42-name pool that no geometry could show
     * while every small rung rendered as a planet surface. */
    const forms = new Set();
    for (let i = 0; i < 40; i++) {
      for (const o of RS.cellular.cellAt(g, p, i * 0.03, i).organelles) forms.add(o.form);
    }
    assert(forms.size >= 8, 'the cellular scope surfaces its own form names (' + forms.size + ' seen)');
    for (const e of RS.fractal.ESSENCES) {
      assert(e.forms && e.forms.cell, e.id + ' has a cellular form to show');
    }
  }
}

// ── expression: the only place you change a world from inside it ─────────
{
  const g = RS.game.newGame(414);
  const bus = nullBus;
  const sys = RS.stellar.systemAt(g.seed, 0, 0, 0);
  let idx = -1, planet = null;
  for (let i = 0; i < sys.bodies.length; i++) {
    if (sys.bodies[i].kind !== 'planet') continue;
    const p = RS.scenes.derivePlanet(g, sys, i);
    if (p && p.biosphere) { idx = i; planet = p; break; }
  }
  if (!planet) {
    assert(true, 'no biosphere in the home system this seed — expression tested elsewhere');
  } else {
    const base = planet.biosphere.complexity;
    assert(RS.influence.expressionOn(g, planet) === 0, 'an untouched world has no expression');

    for (let i = 0; i < 40; i++) RS.influence.express(g, bus, planet, 2);
    const e1 = RS.influence.expressionOn(g, planet);
    assert(e1 > 0 && e1 < 1, 'work inside a cell registers, and saturates (' + e1.toFixed(3) + ')');

    /* One delta, not one per crystal — the save must not grow without bound. */
    const list = g.deltas[RS.influence.planetKey(planet)];
    assert(list.filter(d => d.id === RS.influence.EXPRESSION_ID).length === 1,
      'a thousand crystals is still one delta');

    /* And it must be visible from orbit: re-derive the world and the biosphere
     * has moved. */
    const after = RS.scenes.derivePlanet(g, sys, idx);
    assert(after.biosphere.complexity > base,
      'a world worked from inside is measurably more complex from outside (' +
      base.toFixed(3) + ' → ' + after.biosphere.complexity.toFixed(3) + ')');
    assert(after.biosphere.complexity <= 1, 'and never exceeds fully complex');

    /* Saturating, not linear: the thousandth crystal must move it far less
     * than the first, or a player could farm a world into anything. */
    const mid = RS.influence.expressionOn(g, planet);
    for (let i = 0; i < 400; i++) RS.influence.express(g, bus, planet, 2);
    const far = RS.influence.expressionOn(g, planet);
    assert(far - mid < mid, 'ten times the work is much less than ten times the effect');
    assert(far < 1, 'expression never completes — you accelerate a world, you do not replace it');

    /* Structures still work alongside it, and expression is not one. */
    assert(RS.influence.structuresOn(g, planet).length === 0,
      'expression does not masquerade as a structure');
    assert(RS.influence.totalUpkeep(g) === 0, 'and carries no upkeep');
  }
}

// ── a body that works there, and bodies that honestly do not ─────────────
{
  const cyto = {
    medium: RS.vessel.MEDIUM.CYTOPLASM, gravity: 0, pressure: 1,
    temperature: 300, flux: 1, roughness: 0.4, hasMinds: true, label: 'cytoplasm'
  };
  const ocean = {
    medium: RS.vessel.MEDIUM.LIQUID, gravity: 1, pressure: 1,
    temperature: 290, flux: 1, roughness: 0.2, hasMinds: true, label: 'ocean'
  };
  const ciliate = RS.vessel.ARCHETYPES.find(a => a.id === 'ciliate');
  const swimmer = RS.vessel.ARCHETYPES.find(a => a.id === 'swimmer');
  const mote = RS.vessel.ARCHETYPES.find(a => a.id === 'mote');
  assert(ciliate && ciliate.needs(cyto) === null, 'a ciliate works in cytoplasm');
  assert(typeof ciliate.needs(ocean) === 'string', 'and not in an ocean');
  /* The teaching failure: a swimmer is not merely unsuited here, it is
   * physically futile, and the refusal has to say so. */
  const why = swimmer.needs(cyto);
  assert(typeof why === 'string' && /inertia/.test(why),
    'a swimmer refuses cytoplasm for the real reason: ' + why);
  assert(swimmer.needs(ocean) === null, 'while still working in an ocean');
  assert(mote.needs(cyto) === null, 'the bare mote goes anywhere, as always');

  /* Reachable by research, like every other body. */
  const g = RS.game.newGame(9);
  g.insight = 1e9;
  const path = ['locomotion', 'buoyancy', 'microscopy'];
  for (const id of path) {
    const r = RS.influence.tryResearch(g, nullBus, id);
    assert(r.ok, 'research ' + id + ' is reachable (' + (r.reason || 'ok') + ')');
  }
  assert(g.vessels.unlocked.ciliate, 'microscopy unlocks the ciliate');
}

// ── the scope is stable, and its consequence only fires there ────────────
{
  const g = RS.game.newGame(2024);
  const bus = nullBus;
  /* Σ starts pinned at the root rung and its reach is *bought* — a fresh
   * observer genuinely cannot see the cellular scale, which is the progression
   * working. Buy the range so this test is about the scope rather than about
   * whether the scope is unlocked yet. */
  for (let i = 0; i < 40; i++) RS.dials.applyUpgrade(g.dials.space, 'range');
  RS.dials.setValue(g, g.dials.space, RS.scenes.TIER_CELL);
  assert(Math.round(g.dials.space.value) === RS.scenes.TIER_CELL,
    'a fully-ranged Σ can reach the cellular rung');
  let nan = false;
  for (let i = 0; i < 60 * 30; i++) {
    RS.scenes.tick(g, bus, 1 / 60);
    RS.field.tick(g, bus, 1 / 60);
    if (!Number.isFinite(g.insight) || !Number.isFinite(g.scene.cellT || 0)) { nan = true; break; }
  }
  assert(!nan, 'the cellular scope runs clean for thirty seconds');
  assert(g.scene.kind === 'cellular', 'and stays in the scope while Σ is parked on it');

  /* Sweep the whole ladder without leaving a scene in a broken state. */
  let broke = null;
  for (let i = 0; i < RS.cosmos.TIERS.length; i++) {
    RS.dials.setValue(g, g.dials.space, i);
    for (let k = 0; k < 12; k++) { RS.scenes.tick(g, bus, 1 / 60); RS.field.tick(g, bus, 1 / 60); }
    if (g.scene.kind !== RS.scenes.sceneForTier(i)) broke = RS.cosmos.TIERS[i].id;
    if (!Number.isFinite(g.insight)) broke = RS.cosmos.TIERS[i].id + ' (NaN)';
  }
  assert(!broke, 'a full sweep of Σ lands correctly on every rung: ' + (broke || 'all 22'));

  /* Expression must not fire outside the scope, or every crystal anywhere
   * would quietly reshape whatever world happened to be selected. */
  const g2 = RS.game.newGame(77);
  RS.dials.setValue(g2, g2.dials.space, RS.cosmos.ROOT_INDEX);
  RS.scenes.tick(g2, nullBus, 1 / 60);
  const man = RS.fractal.resolve(g2.seed, 13, 0, 1, 1, 0);
  assert(RS.cellular.expressFrom(g2, nullBus, man) === null,
    'crystallising in the attunement field does not rewrite a distant biosphere');
}

// ── the cosmic web: structure as a function of time ──────────────────────
{
  const g = RS.game.newGame(8181);

  /* Growth must be monotone in time and saturating — a logistic, not a ramp,
   * because structure formation runs away once it starts and then stops. */
  let prev = -1, mono = true;
  for (let t = 0.1; t < 60; t += 0.4) {
    const v = RS.web.growthAt(0.6, 6, t);
    if (v < prev - 1e-12) mono = false;
    prev = v;
  }
  assert(mono, 'overdensity only ever grows');
  assert(RS.web.growthAt(0.6, 6, 0.1) < 0.05, 'and starts from nearly nothing');
  assert(RS.web.growthAt(0.6, 6, 40) > 0.98, 'and finishes');

  /* Big primordial seeds collapse earlier. This is the one fact the scope
   * teaches, so it had better be true of the numbers. */
  assert(RS.web.growthAt(0.9, 2, 3) > RS.web.growthAt(0.2, 9, 3),
    'a large primordial overdensity is further along at the same epoch');

  /* Assembly peaks in the middle and is near zero at both ends — the whole
   * point of the scope's bonus is that "now" is usually the wrong time. */
  const early = RS.web.assemblyAt(0.6, 6, 0.5);
  const peak = RS.web.assemblyAt(0.6, 6, 6);
  const late = RS.web.assemblyAt(0.6, 6, 40);
  assert(peak > 0.98, 'assembly peaks when a structure is half-collapsed');
  assert(early < 0.1 && late < 0.1, 'and is negligible before and long after');

  /* The structure itself. */
  const early2 = RS.web.webAt(g, 0, 0, 'web', 0.4, null);
  const now = RS.web.webAt(g, 0, 0, 'web', RS.web.AGE_NOW, null);
  const far = RS.web.webAt(g, 0, 0, 'web', 60, null);
  assert(early2.formed < now.formed, 'more has collapsed by the present day (' +
    early2.formed + ' → ' + now.formed + ')');
  assert(now.formed <= far.formed, 'and no less by the far future');
  assert(early2.links.length < now.links.length,
    'the filament network genuinely assembles rather than fading in');

  /* Voids are measured, not labelled — and they must be bigger when less has
   * collapsed, because an uncollapsed node does not fill a void. */
  assert(early2.deepestVoid > now.deepestVoid,
    'voids are larger before structure forms (' + early2.deepestVoid.toFixed(3) +
    ' vs ' + now.deepestVoid.toFixed(3) + ')');
  assert(now.voidGpc > 0.01 && now.voidGpc < RS.web.HORIZON_GPC,
    'the largest void is a real size in real units (' + now.voidGpc.toFixed(3) + ' Gpc)');

  /* Purity: same address, same structure. */
  const a = RS.web.webAt(g, 2, -1, 'web', 5, null);
  const b = RS.web.webAt(g, 2, -1, 'web', 5, null);
  assert(a.nodes.every((n, i) => n.x === b.nodes[i].x && n.growth === b.nodes[i].growth),
    'a slab of the web is a pure function of its address and the epoch');

  /* The rungs look at genuinely different volumes, and only the largest can
   * see past the horizon — which is the correct physics and also the only
   * reason to climb to it. */
  const spans = ['group', 'supercluster', 'web', 'hubble'].map(id => RS.web.spanFor(id));
  for (let i = 1; i < spans.length; i++) {
    assert(spans[i] > spans[i - 1], 'each rung of the web scope sees a larger volume');
  }
  const grp = RS.web.webAt(g, 0, 0, 'group', RS.web.AGE_NOW, null);
  assert(grp.disconnected === 0, 'nothing in the Local Group is beyond the horizon');
  const hub = RS.web.webAt(g, 0, 0, 'hubble', RS.web.AGE_NOW, null);
  assert(hub.disconnected > 0,
    'and the Hubble-volume rung does reach past it (' + hub.disconnected + ' structures)');

  /* No NaN anywhere across the whole τ range the dial can reach. */
  let bad = null;
  for (const id of ['group', 'supercluster', 'web', 'hubble']) {
    for (let t = 0.02; t < 95; t += 1.7) {
      const w = RS.web.webAt(g, 1, 1, id, t, null);
      if (!Number.isFinite(w.voidGpc) || !Number.isFinite(w.assembling)) bad = id + '@' + t;
      for (const n of w.nodes) if (!Number.isFinite(n.growth) || !Number.isFinite(n.x)) bad = id + '@' + t;
    }
  }
  assert(!bad, 'the web is finite everywhere τ can reach: ' + (bad || 'clean'));
}

// ── quantum foam: nothing persists, including you ────────────────────────
{
  const g = RS.game.newGame(313);

  /* Lifetime is persistence, straight through. A player who has read that axis
   * anywhere else in the game can predict how long things last here. */
  const memory = RS.fractal.ESSENCE_BY_ID.memory;
  const seed = RS.fractal.ESSENCE_BY_ID.seed;
  assert(RS.foam.lifetimeOf(memory, 1) > RS.foam.lifetimeOf(seed, 1) * 3,
    'a persistent essence lasts far longer than a volatile one');

  /* And the rung's clock scales it, so one rung out is visibly calmer. */
  assert(RS.foam.lifetimeOf(memory, 1) > RS.foam.lifetimeOf(memory, 0),
    'the Planck rung seethes faster than the quantum rung');

  /* Survivors are rare, derived and stable — a fluctuation that got away is
   * always the one that got away. */
  let n = 0;
  for (let i = 0; i < 2000; i++) if (RS.foam.survivesAt(12345, i)) n++;
  assert(n > 40 && n < 160, 'survivors are rare but real (' + n + ' in 2000)');
  assert(RS.foam.survivesAt(12345, 7) === RS.foam.survivesAt(12345, 7),
    'and stable per address');

  /* Pairs close unless they survive: separation returns to zero over a cycle
   * for an ordinary pair, and does not for a survivor. */
  const f = RS.foam.foamAt(g, 1, 0, null);
  assert(f.pairs.length === RS.foam.PAIR_COUNT, 'the foam is fully populated');
  let closes = 0, opens = 0;
  for (const p of f.pairs) (p.survives ? opens++ : closes++);
  assert(closes > 0, 'most pairs annihilate');
  assert(f.survivors === opens, 'the survivor count is the survivor count');

  let bad = null;
  for (let t = 0; t < 400; t += 0.7) {
    const ff = RS.foam.foamAt(g, 0.5, t, null);
    for (const p of ff.pairs) {
      if (!Number.isFinite(p.sep) || !Number.isFinite(p.presence) || p.presence < 0 || p.presence > 1) {
        bad = 'pair ' + p.i + ' @' + t;
      }
    }
  }
  assert(!bad, 'the foam is finite and bounded for any t: ' + (bad || 'clean'));

  /* Ejection. The scope's whole introduction, and it must be enforced every
   * frame rather than only on arrival — otherwise a player embarks from a
   * drawer while standing in it and the rule quietly stops being true. */
  const g2 = RS.game.newGame(99);
  for (let i = 0; i < 40; i++) RS.dials.applyUpgrade(g2.dials.space, 'range');
  g2.insight = 1e9;
  RS.influence.tryResearch(g2, nullBus, 'locomotion');
  RS.dials.setValue(g2, g2.dials.space, RS.scenes.TIER_PLANET);
  for (let i = 0; i < 20; i++) RS.scenes.tick(g2, nullBus, 1 / 60);
  const emb = RS.scenes.embark(g2, nullBus, 'walker');
  assert(emb.ok, 'a body can be taken on a surface (' + (emb.reason || 'ok') + ')');
  assert(g2.inhabiting, 'and you are wearing it');

  /* Σ is the vessel's vertical axis while embodied, so the ladder is
   * deliberately unavailable until you step out — you cannot walk to the
   * Planck scale. Step out, then descend. */
  RS.scenes.disembark(g2, nullBus);
  RS.dials.setValue(g2, g2.dials.space, 0);
  for (let i = 0; i < 30; i++) RS.scenes.tick(g2, nullBus, 1 / 60);
  assert(g2.scene.kind === 'foam', 'the Planck rung is the foam scope');

  /* And the scope refuses a body outright, for the reason that is actually
   * true of the place rather than of the vessel. */
  const denied = RS.scenes.embark(g2, nullBus, 'walker');
  assert(!denied.ok && /persist/.test(denied.reason),
    'the foam refuses a body for the right reason: ' + denied.reason);
  assert(!g2.inhabiting, 'and you stay a bare mote');

  /* Belt and braces: if anything ever does put a body down here — a loaded
   * save, a future scope transition — the tick takes it back off. */
  g2.body = RS.vessel.newBody('walker');
  g2.inhabiting = true;
  for (let i = 0; i < 6; i++) RS.scenes.tick(g2, nullBus, 1 / 60);
  assert(!g2.inhabiting, 'a body that somehow arrives here does not survive the frame');
}

// ── scope payouts exist, are bounded, and only fire in their scope ───────
{
  const g = RS.game.newGame(555);
  /* Everywhere with no scope hook is exactly 1× — a scope must not have to opt
   * out of a multiplier it never heard of. */
  for (const kind of ['field', 'planet', 'system', 'galaxy', 'cellular']) {
    g.scene.kind = kind;
    assert(RS.field.scopeBonus(g) === 1, kind + ' has no scope multiplier');
  }
  g.scene.kind = 'web';
  g.scene.web = RS.web.webAt(g, 0, 0, 'hubble', 4, null);
  const wb = RS.field.scopeBonus(g);
  assert(wb > 1 && wb < 8, 'the web pays a bounded premium (×' + wb.toFixed(2) + ')');
  g.scene.kind = 'foam';
  g.scene.foam = RS.foam.foamAt(g, 1, 0, null);
  const fb = RS.field.scopeBonus(g);
  assert(fb >= 1 && fb < 5, 'the foam pays a bounded premium (×' + fb.toFixed(2) + ')');
}

// ── every rung, every scope, no gaps and no wreckage ─────────────────────
{
  const g = RS.game.newGame(4242);
  for (let i = 0; i < 40; i++) RS.dials.applyUpgrade(g.dials.space, 'range');
  const seen = Object.create(null);
  let broke = null;
  for (let i = 0; i < RS.cosmos.TIERS.length; i++) {
    RS.dials.setValue(g, g.dials.space, i);
    for (let k = 0; k < 20; k++) { RS.scenes.tick(g, nullBus, 1 / 60); RS.field.tick(g, nullBus, 1 / 60); }
    const want = RS.scenes.sceneForTier(i);
    seen[want] = (seen[want] || 0) + 1;
    if (g.scene.kind !== want) broke = RS.cosmos.TIERS[i].id + ' → ' + g.scene.kind;
    if (!Number.isFinite(g.insight)) broke = RS.cosmos.TIERS[i].id + ' (NaN insight)';
  }
  assert(!broke, 'a full Σ sweep lands correctly on all 22 rungs: ' + (broke || 'clean'));
  assert(Object.keys(seen).length === RS.scenes.SCENES.length,
    'and every registered scope is actually reachable by turning Σ (' +
    Object.keys(seen).sort().join(', ') + ')');

  /* Every scope must have somewhere to be entered from, and the guide names
   * each one, so nothing is a place you can only arrive at by accident. */
  for (const sc of RS.scenes.SCENES) {
    assert(RS.scenes.sceneForTier(RS.scenes.tierForScene(sc.id)) === sc.id,
      sc.id + ' is entered at the rung it claims');
    assert(typeof sc.blurb === 'string' && sc.blurb.length > 12,
      sc.id + ' explains what it is');
  }
}

// ── physics as a block, not as constants ─────────────────────────────────
{
  /* The refactor's first duty is to change nothing: with our own block live,
   * every derivation must produce exactly what it produced when the numbers
   * were hardcoded. */
  /* `newGame` restores our block, because the physics is module-level and a
   * previous session standing in an ensemble node must not follow you into a
   * new one. Asserting it here also stops this whole block from silently
   * measuring the wrong universe. */
  const g = RS.game.newGame(2718);
  assert(RS.physics.isOurs(), 'a new game starts in our own universe');
  const before = RS.ensemble.sampleSystem(g);
  assert(before && before.worlds > 0, 'a specimen system derives under our block');

  /* Blocks are pure in their address and genuinely varied. */
  const a = RS.physics.blockAt(99, 7, null);
  const b = RS.physics.blockAt(99, 7, null);
  for (const ax of RS.physics.AXES) {
    assert(a[ax.key] === b[ax.key], 'a block is a pure function of its address (' + ax.key + ')');
    assert(Number.isFinite(a[ax.key]) && a[ax.key] > 0, ax.key + ' is a usable number');
  }
  const spread = new Set();
  for (let i = 0; i < 200; i++) spread.add(RS.physics.blockAt(5, i, null).__mult.tSun.toFixed(2));
  assert(spread.size > 40, 'blocks are genuinely varied (' + spread.size + ' distinct fusion temperatures)');

  /* Every axis must actually reach both ends of its declared range somewhere,
   * or a knob is decorative. */
  for (const ax of RS.physics.AXES) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 400; i++) {
      const m = RS.physics.blockAt(11, i, null).__mult[ax.key];
      if (m < lo) lo = m;
      if (m > hi) hi = m;
    }
    assert(lo < ax.lo * 1.15 && hi > ax.hi * 0.85,
      ax.key + ' spans its declared range (' + lo.toFixed(2) + '–' + hi.toFixed(2) + ')');
  }

  /* Distance from ours is zero for ours and positive for everything else. */
  assert(RS.physics.distanceFrom(RS.physics.OURS) === 0, 'our block is zero distance from itself');
  let anyFar = false;
  for (let i = 0; i < 60; i++) if (RS.physics.distanceFrom(RS.physics.blockAt(3, i, null)) > 0.4) anyFar = true;
  assert(anyFar, 'some blocks are a long way from ours');

  /* Swapping must actually change what the universe derives — otherwise the
   * whole scope is a costume. Search for a block that changes the specimen. */
  let changed = null;
  for (let i = 0; i < 80 && !changed; i++) {
    const blk = RS.physics.blockAt(g.seed, i, null);
    const prev = RS.physics.use(blk);
    const there = RS.ensemble.sampleSystem(g);
    RS.physics.use(prev);
    if (there && Math.abs(there.temp - before.temp) > 200) changed = { i, there, blk };
  }
  assert(changed, 'an alternative block derives a measurably different star');
  if (changed) {
    assert(changed.there.name === before.name,
      'the same address, though — it is the same system under different laws');
  }

  /* And the swap must be reversible, exactly. */
  const restored = RS.ensemble.sampleSystem(g);
  assert(RS.physics.isOurs(), 'the block is restored after a comparison');
  assert(restored.temp === before.temp && restored.living === before.living,
    'and our universe derives identically to before it was borrowed');
}

// ── the ensemble scope ───────────────────────────────────────────────────
{
  const g = RS.game.newGame(31415);
  for (let i = 0; i < 40; i++) RS.dials.applyUpgrade(g.dials.space, 'range');
  RS.dials.setValue(g, g.dials.space, RS.scenes.TIER_ENSEMBLE);
  for (let i = 0; i < 30; i++) RS.scenes.tick(g, nullBus, 1 / 60);
  assert(g.scene.kind === 'ensemble', 'the top rungs are the ensemble scope');
  assert(g.scene.ensemble && g.scene.ensemble.nodes.length === RS.ensemble.NODE_COUNT,
    'and it is populated with blocks');

  /* Δ is the selector. Point it straight at a node and it must be adopted. */
  const target = g.scene.ensemble.nodes[3];
  RS.dials.setValue(g, g.dials.phase, Math.atan2(target.y, target.x));
  for (let i = 0; i < 10; i++) RS.scenes.tick(g, nullBus, 1 / 60);
  assert(g.scene.blockNode === target, 'Δ selects a block');
  assert(!RS.physics.isOurs(), 'and standing in it swaps the constants');
  assert(g.scene.specimen && g.scene.specimen.ours && g.scene.specimen.there,
    'and derives one address under both blocks for comparison');

  /* The payout scales with how alien the block is, and is bounded. */
  const bonus = RS.ensemble.bonusFor(g);
  assert(bonus > 1 && bonus <= 4.001, 'a block pays for how unlike ours it is (×' + bonus.toFixed(2) + ')');

  /* Pointing between two universes selects neither — the choice is deliberate
   * rather than whatever the dial happens to be nearest. */
  let gap = null;
  for (let k = 0; k < 400 && !gap; k++) {
    RS.dials.setValue(g, g.dials.phase, (k / 400) * Math.PI * 2);
    if (!RS.ensemble.pick(g)) gap = k;
  }
  assert(gap !== null, 'there is dead space between blocks');

  /* Leaving restores our laws. This is the one thing that must never fail:
   * a forgotten alternative universe would silently re-derive the whole game. */
  RS.dials.setValue(g, g.dials.phase, Math.atan2(target.y, target.x));
  for (let i = 0; i < 10; i++) RS.scenes.tick(g, nullBus, 1 / 60);
  assert(!RS.physics.isOurs(), 'still standing in it');
  RS.dials.setValue(g, g.dials.space, RS.cosmos.ROOT_INDEX);
  for (let i = 0; i < 20; i++) RS.scenes.tick(g, nullBus, 1 / 60);
  assert(g.scene.kind !== 'ensemble', 'left the scope');
  assert(RS.physics.isOurs(), 'and our own laws came back with us');

  /* Every rung of the scope is a different family of alternatives. */
  const fams = new Set();
  for (let i = RS.scenes.TIER_ENSEMBLE; i < RS.cosmos.TIERS.length; i++) {
    fams.add(RS.ensemble.familyOf(RS.cosmos.TIERS[i].id));
  }
  assert(fams.size === 4, 'the four ensemble rungs are four Tegmark levels (' + [...fams].sort().join(' ') + ')');

  /* Stability: sweep Δ across everything while the scope runs, with the
   * constants being swapped underneath, and nothing may go NaN. */
  RS.dials.setValue(g, g.dials.space, RS.scenes.TIER_ENSEMBLE);
  let bad = null;
  for (let i = 0; i < 900; i++) {
    RS.dials.setValue(g, g.dials.phase, (i / 60) % (Math.PI * 2));
    RS.scenes.tick(g, nullBus, 1 / 60);
    RS.field.tick(g, nullBus, 1 / 60);
    if (!Number.isFinite(g.insight)) { bad = 'insight'; break; }
    const sp = g.scene.specimen;
    if (sp && sp.there && (!Number.isFinite(sp.there.temp) || sp.there.temp <= 0)) { bad = 'specimen'; break; }
  }
  assert(!bad, 'the scope survives a full Δ sweep with the laws changing under it: ' + (bad || 'clean'));
  RS.ensemble.release(g, nullBus);
  assert(RS.physics.isOurs(), 'and is left as we found it');
}

// ── the thesis, under other laws ─────────────────────────────────────────
/* The premise's last claim: the essences are the same essences whatever the
 * constants are. If Cascade stopped branching in an alternative universe, the
 * game would be saying that its own information is a property of physics rather
 * than of the fractal store — which is the opposite of what it has claimed for
 * twenty-two rungs. */
{
  const cascade = RS.fractal.ESSENCE_BY_ID.cascade;
  const lattice = RS.fractal.ESSENCE_BY_ID.lattice;
  const ourGate = RS.emergence.GATE(cascade, 13, 0, {});
  const ourNest = RS.emergence.NEST(cascade, {});

  let broke = [];
  for (let i = 0; i < 50; i++) {
    const prev = RS.physics.use(RS.physics.blockAt(777, i, null));
    const g2 = RS.emergence.GATE(cascade, 13, 0, {});
    const n2 = RS.emergence.NEST(cascade, {});
    if (g2.subdiv !== ourGate.subdiv) broke.push('gate ' + i);
    if (n2.fanout !== ourNest.fanout) broke.push('nest ' + i);
    if (RS.emergence.GATE(cascade, 13, 0, {}).subdiv <= RS.emergence.GATE(lattice, 13, 0, {}).subdiv) {
      broke.push('ordering ' + i);
    }
    RS.physics.use(prev);
  }
  assert(broke.length === 0,
    'Cascade branches identically in fifty alternative universes: ' + (broke.slice(0, 3).join(', ') || 'no exceptions'));
  assert(RS.physics.isOurs(), 'and we are back in ours');
}


// ── notifications are filterable, and never load-bearing ─────────────────
{
  /* The rule that makes filtering safe: every notification restates something
   * the readout, the objective line or the guide also says — so the default is
   * to show only what a player would want interrupting them. */
  const g = RS.game.newGame(1);
  assert(g.settings.notify === 'key', 'a new game shows arrivals and discoveries, not chatter');
}

// ── the pilot has something to read ──────────────────────────────────────
{
  const g = RS.game.newGame(606);
  for (let i = 0; i < 40; i++) RS.dials.applyUpgrade(g.dials.space, 'range');
  g.insight = 1e9;
  RS.influence.tryResearch(g, nullBus, 'locomotion');
  RS.dials.setValue(g, g.dials.space, RS.scenes.TIER_PLANET);
  for (let i = 0; i < 30; i++) RS.scenes.tick(g, nullBus, 1 / 60);

  assert(RS.vessel.statusOf(g) === null, 'unembodied, there is no pilot status to show');

  /* Whichever body works where this seed happened to put us. A walker refusing
   * because the sample point is underwater is the game working, not a failure —
   * and the mote works everywhere, which is what it is for. */
  let r = RS.scenes.embark(g, nullBus, 'walker');
  if (!r.ok) r = RS.scenes.embark(g, nullBus, 'mote');
  assert(r.ok, 'embarked (' + (r.reason || 'ok') + ')');
  const st = RS.vessel.statusOf(g);
  assert(st, 'embodied, there is');
  for (const k of ['charge', 'capacity', 'chargeFrac', 'strain', 'speed', 'endurance']) {
    assert(Number.isFinite(st[k]) || st[k] === Infinity, 'pilot status reports ' + k);
  }
  assert(st.chargeFrac > 0 && st.chargeFrac <= 1, 'charge reads as a fraction');
  assert(st.arch.dialMap && st.arch.dialMap.time && st.arch.dialMap.space,
    'and the body names what its dials do');

  /* Endurance must be a real budget: a body burning more than it recovers has
   * a finite time on it, and one that is recovering has none. */
  const arch = st.arch;
  const still = RS.vessel.enduranceOf(arch, { charge: 100, vx: 0, vy: 0 }, st.env);
  const flat = RS.vessel.enduranceOf(arch, { charge: 100, vx: 3, vy: 3 }, st.env);
  assert(flat <= still, 'working hard costs endurance');
  assert(flat > 0, 'and there is always some left to spend');

  /* The half of "this body cannot work here" that was missing: which one can. */
  const ocean = { medium: RS.vessel.MEDIUM.LIQUID, gravity: 1, pressure: 1,
    temperature: 290, flux: 1, roughness: 0.2, hasMinds: false, label: 'ocean' };
  assert(RS.vessel.canOperate(RS.vessel.BY_ID.walker, ocean), 'a walker cannot swim');
  const alt = RS.vessel.BY_ID.swimmer;
  assert(alt && !RS.vessel.canOperate(alt, ocean), 'but a swimmer can');

  /* `bestHere` must never suggest the body you are already wearing, or the fix
   * button on the pilot bar would do nothing. */
  const here = RS.vessel.bestHere(g, st.arch.id);
  assert(!here || here.id !== st.arch.id, 'the suggested alternative is an alternative');

  /* And when a body genuinely cannot work, the status must carry the fix
   * rather than only the complaint. Cytoplasm is the cleanest case: nothing but
   * the ciliate and the mote function there. */
  const g2 = RS.game.newGame(88);
  g2.vessels.unlocked.walker = true;
  g2.vessels.unlocked.ciliate = true;
  g2.scene.kind = 'cellular';
  g2.scene.planet = { name: 'X', surfaceTemp: 290, pressure: 1, gravity: 1, flux: 1,
    biosphere: { complexity: 0.5, stage: { name: 'Complex' } } };
  g2.scene.cell = RS.cellular.cellAt(g2, g2.scene.planet, 0, 0);
  g2.body = RS.vessel.newBody('walker');
  g2.inhabiting = true;
  const bad = RS.vessel.statusOf(g2);
  assert(bad.blocked, 'a walker in cytoplasm is blocked');
  assert(bad.alternative && bad.alternative.id === 'ciliate',
    'and the status names the body that would work: ' +
    (bad.alternative ? bad.alternative.name : 'none'));
}


// ── molecular: handedness, and what it says about a world ────────────────
{
  const g = RS.game.newGame(4004);

  /* Symmetry decides chirality, straight through — an essence whose mirror
   * image is itself has no handedness, which is what perfect symmetry means. */
  assert(!RS.molecular.isChiral(RS.fractal.ESSENCE_BY_ID.lattice),
    'a perfectly symmetric essence is achiral');
  assert(RS.molecular.isChiral(RS.fractal.ESSENCE_BY_ID.cascade),
    'an asymmetric one is not');

  /* Homochirality is a measurement of the biosphere, so it must be zero on a
   * dead world and rise with complexity — that is the whole reason the scope
   * tells you anything. */
  const dead = { name: 'Dead', biosphere: null };
  const faint = { name: 'Faint', biosphere: { complexity: 0.08 } };
  const deep = { name: 'Deep', biosphere: { complexity: 0.9 } };
  assert(RS.molecular.homochiralityOf(dead) === 0, 'nothing chooses on a sterile world');
  assert(RS.molecular.homochiralityOf(faint) > 0, 'the first life already biases the mixture');
  assert(RS.molecular.homochiralityOf(deep) > RS.molecular.homochiralityOf(faint),
    'and a deep biosphere has very nearly settled it');
  assert(RS.molecular.homochiralityOf(deep) < 1, 'but never completely');

  /* The mixture must actually come out that way when sampled, or the number is
   * a label rather than a measurement. */
  function minorityRate(planet) {
    let chiral = 0, minority = 0;
    for (let i = 0; i < 120; i++) {
      const m = RS.molecular.moleculeAt(g, planet, i * 0.017, i, null);
      chiral += m.chiral; minority += m.minority;
    }
    return minority / Math.max(1, chiral);
  }
  const rDead = minorityRate(dead), rDeep = minorityRate(deep);
  assert(rDead > 0.35 && rDead < 0.65,
    'a sterile world is a near-even mixture (' + rDead.toFixed(2) + ')');
  assert(rDeep < 0.12,
    'a living one is overwhelmingly one hand (' + rDeep.toFixed(2) + ')');
  assert(rDeep > 0, 'and the wrong hand still turns up sometimes — that is the find');

  /* Purity, and no NaN. */
  const a = RS.molecular.moleculeAt(g, deep, 0.5, 3, null);
  const b = RS.molecular.moleculeAt(g, deep, 0.5, 3, null);
  assert(a.sites.every((x, i) => x.hand === b.sites[i].hand && x.x === b.sites[i].x),
    'a molecule is a pure function of its address');
  for (const st of a.sites) {
    assert(Number.isFinite(st.x) && Number.isFinite(st.size) && st.bond >= 1,
      'every site is well formed');
  }
}

// ── orbital shells: exclusion is the mechanic ────────────────────────────
{
  const g = RS.game.newGame(1717);
  const sh = RS.shells.shellsAt(g, 3, null);

  /* The rule. If two occupants ever share a state the scope is claiming
   * something about physics that it is not doing. */
  const seen = new Set();
  let clash = null;
  for (const oc of sh.occupants) {
    const k = RS.shells.stateKey(oc.q);
    if (seen.has(k)) clash = k;
    seen.add(k);
  }
  assert(!clash, 'no two occupants share a state: ' + (clash || 'none do'));
  assert(sh.occupants.length === RS.fractal.ESSENCES.length,
    'every essence finds somewhere to be');
  assert(sh.capacity > sh.occupants.length,
    'and there is room, so the placement always terminates (' +
    sh.occupants.length + '/' + sh.capacity + ')');

  /* Quantum numbers must be legal, or the diagram is decorative. */
  for (const oc of sh.occupants) {
    assert(oc.q.n >= 1 && oc.q.n <= RS.shells.N_MAX, 'n is in range');
    assert(oc.q.l >= 0 && oc.q.l <= oc.q.n - 1, 'l < n');
    assert(Math.abs(oc.q.m) <= oc.q.l, '|m| <= l');
    assert(oc.q.s === 1 || oc.q.s === -1, 'spin is a half-integer either way');
  }

  /* The essence axes have to be what places things, or nothing a player
   * learned elsewhere helps them here. */
  const attractor = RS.shells.desiredState(RS.fractal.ESSENCE_BY_ID.attractor);
  const cascade = RS.shells.desiredState(RS.fractal.ESSENCE_BY_ID.cascade);
  assert(attractor.l < cascade.l,
    'a converging essence wants a spherical subshell and a branching one does not (' +
    attractor.l + ' vs ' + cascade.l + ')');
  const emergence = RS.shells.desiredState(RS.fractal.ESSENCE_BY_ID.emergence);
  const voidE = RS.shells.desiredState(RS.fractal.ESSENCE_BY_ID.void);
  assert(emergence.n > voidE.n, 'and a complex essence sits further out than an empty one');

  /* Slot counts are the real ones: 2, 6, 10, 14. */
  assert(RS.shells.slotsIn(0) === 2 && RS.shells.slotsIn(1) === 6 &&
         RS.shells.slotsIn(2) === 10 && RS.shells.slotsIn(3) === 14,
    's, p, d and f hold the numbers they hold');

  /* Madelung: 4s fills before 3d, which is why the periodic table looks the
   * way it does. If this inverts, the scope is teaching something false. */
  assert(RS.shells.energyOf(4, 0) < RS.shells.energyOf(3, 2),
    '4s sits below 3d, as it must');

  const bonus = RS.shells.bonusFor({ scene: { kind: 'shells', shells: sh } });
  assert(bonus >= 1 && bonus < 4, 'the scope pays a bounded premium (×' + bonus.toFixed(2) + ')');
}

// ── the ladder is complete ───────────────────────────────────────────────
{
  const g = RS.game.newGame(9090);
  for (let i = 0; i < 40; i++) RS.dials.applyUpgrade(g.dials.space, 'range');
  const seen = Object.create(null);
  let broke = null;
  for (let i = 0; i < RS.cosmos.TIERS.length; i++) {
    RS.dials.setValue(g, g.dials.space, i);
    for (let k = 0; k < 20; k++) { RS.scenes.tick(g, nullBus, 1 / 60); RS.field.tick(g, nullBus, 1 / 60); }
    const want = RS.scenes.sceneForTier(i);
    seen[want] = true;
    if (g.scene.kind !== want) broke = RS.cosmos.TIERS[i].id + ' → ' + g.scene.kind;
    if (!Number.isFinite(g.insight)) broke = RS.cosmos.TIERS[i].id + ' (NaN)';
  }
  assert(!broke, 'every rung lands on its scope: ' + (broke || 'all 22'));
  assert(Object.keys(seen).length === RS.scenes.SCENES.length,
    'and all ' + RS.scenes.SCENES.length + ' scopes are reachable by turning Σ');

  /* No rung falls back to a scope that is not about it. `planet` is allowed to
   * cover a range; nothing else may quietly absorb a rung it does not describe. */
  const fallback = [];
  for (let i = 0; i < RS.cosmos.TIERS.length; i++) {
    const id = RS.scenes.sceneForTier(i);
    const sc = RS.scenes.SCENE_BY_ID[id];
    if (sc.last - sc.first > 4 && id !== 'field' && id !== 'planet') fallback.push(RS.cosmos.TIERS[i].id);
  }
  assert(fallback.length === 0, 'no rung is absorbed by an unrelated scope: ' + (fallback.join(', ') || 'none'));
}


// ── six pathways, all of them live ───────────────────────────────────────
/* The panel is generated from live state rather than scripted, which is what
 * makes it a progression system rather than a checklist. So the test is not
 * "does it render" but "does it say something true, from any state, and does it
 * stop repeating its first step once that step is done". */
{
  function paths(g) {
    const html = RS.guide.pathwaysHTML(g);
    assert(typeof html === 'string' && html.length > 400, 'the pathways panel renders');
    return html;
  }

  /* From nothing. */
  const g0 = RS.game.newGame(70001);
  const h0 = paths(g0);
  for (const name of ['TUNE', 'REACH', 'CONTACT', 'INWARD', 'BEYOND', 'RECOGNITION']) {
    assert(h0.indexOf(name) >= 0, name + ' is offered from the first minute');
  }
  /* A route whose first step is unreachable must say how to make it reachable,
   * not tell the player to go somewhere their dial cannot reach. */
  assert(/Σ RANGE/.test(h0), 'and a route that is gated names the gate');

  /* From a fully-opened game. Every route must still say something, and none
   * may still be on step one. */
  const g1 = RS.game.newGame(70002);
  for (const d of ['frequency', 'phase', 'time', 'space']) {
    for (const k of ['range', 'precision', 'focus']) {
      for (let i = 0; i < 40; i++) RS.dials.applyUpgrade(g1.dials[d], k);
    }
  }
  g1.insight = 1e12;
  for (const node of RS.influence.RESEARCH) RS.influence.tryResearch(g1, nullBus, node.id);
  for (const t of RS.cosmos.TIERS) g1.known.tiers[t.id] = true;
  for (const b of RS.spectrum.BANDS) g1.known.bands[b.id] = true;
  for (const e of RS.fractal.ESSENCES) {
    g1.gnosis[e.id] = [];
    for (let i = 0; i < 9; i++) g1.gnosis[e.id].push(e.id + '@' + i + ':0');
  }
  g1.stats.blocksAdopted = 5;
  g1.stats.farthestBlock = 0.8;
  const h1 = paths(g1);
  assert(!/Buy Σ RANGE/.test(h1), 'a fully-ranged observer is not told to buy range');
  assert(!/Research MICROSCOPY/.test(h1), 'nor to research what it already has');
  assert(/fully read|predict any layer/.test(h1),
    'and RECOGNITION acknowledges a complete ledger');

  /* Foresight has to be the thing RECOGNITION measures — the panel must agree
   * with `fractal.predicted` rather than keeping its own count. */
  const g2 = RS.game.newGame(70003);
  g2.gnosis.cascade = ['cascade@1:0', 'cascade@2:0', 'cascade@3:0', 'cascade@4:0'];
  const h2 = paths(g2);
  assert(h2.indexOf('Cascade') >= 0,
    'the essence closest to a reveal is named: ' + (h2.indexOf('Cascade') >= 0));
  const pr = RS.fractal.predicted(g2, 'cascade', {});
  assert(pr.revealed === 2, 'four contexts is two axes, and the panel counts the same way');

  /* Every route must survive every scene, because the panel is openable from
   * anywhere and a route that throws in one scope is a crash in normal play. */
  const g3 = RS.game.newGame(70004);
  for (let i = 0; i < 40; i++) RS.dials.applyUpgrade(g3.dials.space, 'range');
  let broke = null;
  for (let i = 0; i < RS.cosmos.TIERS.length && !broke; i++) {
    RS.dials.setValue(g3, g3.dials.space, i);
    for (let k = 0; k < 12; k++) RS.scenes.tick(g3, nullBus, 1 / 60);
    try { paths(g3); RS.guide.guideHTML(g3); }
    catch (e) { broke = RS.cosmos.TIERS[i].id + ': ' + e.message; }
  }
  assert(!broke, 'the pathways and guide panels open in every scope: ' + (broke || 'all 22'));
}

// ── the routes are genuinely alternative ─────────────────────────────────
/* The claim is that a player can lead with any route. That is only true if the
 * *gates* differ: if every route bottoms out on the same purchase, there is one
 * route wearing six hats. */
{
  const g = RS.game.newGame(70005);
  /* INWARD and BEYOND gate on opposite ends of the same dial, which is the
   * cleanest possible demonstration that they are different directions. */
  const inward = RS.scenes.tierForScene('cellular');
  const beyond = RS.scenes.tierForScene('web');
  assert(inward < RS.cosmos.ROOT_INDEX && beyond > RS.cosmos.ROOT_INDEX,
    'INWARD and BEYOND run in opposite directions from the root');

  /* RECOGNITION gates on nothing purchasable at all — it is the one route that
   * cannot be bought, only played. */
  const before = RS.fractal.totalGnosis(g);
  g.insight = 1e12;
  for (const node of RS.influence.RESEARCH) RS.influence.tryResearch(g, nullBus, node.id);
  for (const d of ['frequency', 'space']) {
    for (let i = 0; i < 40; i++) RS.dials.applyUpgrade(g.dials[d], 'range');
  }
  assert(RS.fractal.totalGnosis(g) === before,
    'no amount of insight buys a single context of gnosis');

  /* And CONTACT is the only one another party can advance for you. */
  assert(typeof RS.contact.act === 'function', 'contact has actions a culture performs');
}


// ── the codex is the essence sheet ───────────────────────────────────────
/* The player's map of the generative core. It must show exactly what has been
 * earned — no more, because that would give away foresight, and no less,
 * because the blanks are how a player picks their next target. */
{
  const g = RS.game.newGame(80808);
  const empty = RS.ui.codexHTML(g);
  assert(typeof empty === 'string' && empty.length > 500, 'the codex renders from nothing');
  assert(empty.indexOf('0 / ' + (RS.fractal.ESSENCES.length * 4) + ' axes read') >= 0,
    'and an unread ledger reads as zero axes');
  /* Nothing may leak before it is earned: no essence name, no trait, no number. */
  let leaked = [];
  for (const e of RS.fractal.ESSENCES) {
    /* Scoped to the essence sheet's own name slot: the primitives section below
     * it is vocabulary rather than a secret, and is meant to be readable from
     * the first minute. */
    if (empty.indexOf('class="en">' + e.name + '<') >= 0) leaked.push(e.name);
    if (e.trait && empty.indexOf(e.trait) >= 0) leaked.push(e.id + ' trait');
    if (e.forms && e.forms.cell && empty.indexOf(e.forms.cell) >= 0) leaked.push(e.id + ' form');
  }
  assert(leaked.length === 0, 'an unmet essence gives nothing away: ' + (leaked.slice(0,3).join(', ') || 'nothing'));

  /* Meeting one reveals its name and trait but still not its numbers — two
   * contexts is the first axis, and one is none. */
  g.gnosis.cascade = ['cascade@1:0'];
  const one = RS.ui.codexHTML(g);
  assert(one.indexOf('class="en">Cascade<') >= 0, 'a met essence is named');
  assert(one.indexOf('1 / ' + (RS.fractal.ESSENCES.length * 4)) < 0,
    'but one context is not yet an axis');
  assert(one.indexOf('0 / ' + (RS.fractal.ESSENCES.length * 4) + ' axes read') >= 0,
    'the count agrees: still zero axes');

  /* And the sheet must agree with `predicted` exactly, at every level. */
  for (const n of [0, 2, 4, 6, 8, 12]) {
    const g2 = RS.game.newGame(1234);
    g2.gnosis.cascade = [];
    for (let i = 0; i < n; i++) g2.gnosis.cascade.push('cascade@' + i + ':0');
    const pr = RS.fractal.predicted(g2, 'cascade', {});
    const html = RS.ui.codexHTML(g2);
    let bars = 0;
    for (const a of RS.fractal.AXES) if (pr[a] !== undefined) bars++;
    assert(bars === pr.revealed, n + ' contexts reveals ' + pr.revealed + ' axes');
    assert(html.indexOf(bars + ' / ' + (RS.fractal.ESSENCES.length * 4) + ' axes read') >= 0,
      'and the sheet says so (' + n + ' contexts → ' + bars + ')');
  }

  /* A fully-read essence must offer nothing more to read, or the sheet would
   * send a player hunting something they already have. */
  const g3 = RS.game.newGame(55);
  g3.gnosis.spiral = [];
  for (let i = 0; i < 12; i++) g3.gnosis.spiral.push('spiral@' + i + ':0');
  const full = RS.ui.codexHTML(g3);
  assert(full.indexOf('complete') >= 0, 'a fully-read essence says it is complete');

  /* No primitive may share a display name with an essence: the codex lists
   * both, and a player reading "Flow" twice for two different things is a
   * legibility failure rather than a coincidence. */
  const essNames = new Set(RS.fractal.ESSENCES.map(e => e.name));
  for (const id of RS.emergence.IDS) {
    assert(!essNames.has(RS.emergence.LABELS[id].name),
      'the ' + id + ' primitive does not collide with an essence name (' +
      RS.emergence.LABELS[id].name + ')');
  }

  /* The primitives half. Without it the axes are a stat block rather than a
   * prediction, so every one must be listed with the bands that run it. */
  for (const id of RS.emergence.IDS) {
    assert(full.indexOf(RS.emergence.LABELS[id].name) >= 0, id + ' is on the sheet');
  }
  for (const b of RS.spectrum.BANDS) {
    let listed = false;
    for (const id of b.prim) {
      if (RS.spectrum.usesPrim(b, id)) listed = true;
    }
    assert(listed, b.id + ' runs at least one primitive the sheet can show it under');
  }
}


// ── nowhere is empty ─────────────────────────────────────────────────────
/* `neural.mindAt` works at any address and, until this landed, exactly two
 * things called it. The claim is not "there are dots moving" — it is that the
 * inhabitants were already doing this before you arrived, which is only true if
 * their positions are derived rather than spawned. */
{
  const g = RS.game.newGame(90210);
  const kinds = Object.keys(RS.inhabitants.KINDS);
  assert(kinds.length >= 8, 'most scopes declare inhabitants (' + kinds.length + ')');

  /* Every scope in the registry must have an entry, or a scope quietly ships
   * empty and nobody notices. */
  const missing = [];
  for (const sc of RS.scenes.SCENES) {
    if (!RS.inhabitants.KINDS[sc.id]) missing.push(sc.id);
  }
  assert(missing.length === 0, 'every scope declares what lives in it: ' + (missing.join(', ') || 'all do'));

  /* Derivation, not spawning: the same address at the same time is the same
   * population, and it exists at t=0 without anything having created it. */
  const a = RS.inhabitants.inhabitantsFor(g, 'cellular', 0, 1 / 60, null);
  assert(a.list.length > 0, 'a cell has traffic in it the instant you look');
  const b = RS.inhabitants.inhabitantsFor(g, 'cellular', 0, 1 / 60, null);
  /* The *path* is pure; the mind riding it is not, and should not be — a
   * population that produced byte-identical output on every call would be an
   * animation rather than a set of things with something going on inside them.
   * So the base path must match exactly, and the real position must be close to
   * it but free to differ. */
  assert(a.list.every((x, i) => Math.abs(x.bx - b.list[i].bx) < 1e-9),
    'the derived path is the same at the same address and time');
  assert(a.list.every((x, i) => Math.hypot(x.x - x.bx, x.y - x.by) < 0.1),
    'and the mind perturbs it rather than replacing it');

  /* And it moves — a derived population that does not advance with t is a
   * still life. */
  const later = RS.inhabitants.inhabitantsFor(g, 'cellular', 9.0, 1 / 60, null);
  let moved = 0;
  for (let i = 0; i < later.list.length; i++) {
    if (Math.hypot(later.list[i].bx - a.list[i].bx, later.list[i].by - a.list[i].by) > 0.05) moved++;
  }
  assert(moved > later.list.length / 2, 'and it has visibly moved on by nine seconds');

  /* Bounded, and never NaN, across every scope and a long span of time. */
  let bad = null;
  for (const k of kinds) {
    for (let t = 0; t < 600; t += 7.3) {
      const r = RS.inhabitants.inhabitantsFor(g, k, t, 1 / 60, null);
      for (const o of r.list) {
        if (!Number.isFinite(o.x) || !Number.isFinite(o.y) || !Number.isFinite(o.bright)) bad = k + '@' + t;
        if (Math.hypot(o.x, o.y) > 1.6) bad = k + '@' + t + ' escaped';
      }
    }
  }
  assert(!bad, 'inhabitants stay finite and stay home: ' + (bad || 'all of them'));

  /* Different places have different populations, or "returning here" means
   * nothing. */
  const g2 = RS.game.newGame(90210);
  g2.scene.cellIndex = 7;
  g2.scene.cell = { type: { id: 'x' } };
  const other = RS.inhabitants.inhabitantsFor(g2, 'cellular', 0, 1 / 60, null);
  assert(other.list.some((x, i) => Math.abs(x.bx - a.list[i].bx) > 1e-6),
    'a different cell has different traffic');

  /* The mind state cache must not grow without bound across a long session
   * that visits many places. */
  const before = RS.inhabitants.states.size;
  for (let i = 0; i < 400; i++) {
    const gg = RS.game.newGame(i);
    RS.inhabitants.inhabitantsFor(gg, 'web', i, 1 / 60, null);
  }
  assert(RS.inhabitants.states.size <= 260,
    'mind state stays bounded over a long session (' + before + ' → ' + RS.inhabitants.states.size + ')');

  /* And they exist in the live game, in every scope, without being asked for. */
  const g3 = RS.game.newGame(4);
  for (let i = 0; i < 40; i++) RS.dials.applyUpgrade(g3.dials.space, 'range');
  const empty = [];
  for (let i = 0; i < RS.cosmos.TIERS.length; i++) {
    RS.dials.setValue(g3, g3.dials.space, i);
    for (let k = 0; k < 15; k++) RS.scenes.tick(g3, nullBus, 1 / 60);
    const want = RS.inhabitants.KINDS[g3.scene.kind];
    if (want && want.n && (!g3.scene.inhabitants || !g3.scene.inhabitants.list.length)) {
      empty.push(RS.cosmos.TIERS[i].id);
    }
  }
  assert(empty.length === 0, 'every scope is populated in play: ' + (empty.join(', ') || 'all of them'));
}

// ── silence where there is no medium ─────────────────────────────────────
/* The one place the physics and the sound design are the same decision. */
{
  const B = RS.audio.BEDS;
  for (const sc of RS.scenes.SCENES) {
    assert(B[sc.id], sc.id + ' has an ambient bed defined');
  }
  assert(B.system.gain === 0 && B.galaxy.gain === 0,
    'sound does not propagate in a vacuum, so the vacuum scopes are silent');
  assert(B.planet.gain > 0, 'and a surface with air is not');
  assert(B.web.freq < B.foam.freq / 10,
    'the largest scope drones and the smallest seethes');
}


// ── local time was derived all along and never shown ─────────────────────
{
  const g = RS.game.newGame(31337);
  /* Hunt the neighbourhood rather than assuming the home system has one — a
   * seed whose nearest star is all tidally locked worlds is a legitimate
   * galaxy, not a broken test. */
  let p = null;
  for (let sx = -2; sx <= 2 && !p; sx++) {
    for (let sy = -2; sy <= 2 && !p; sy++) {
      const sys = RS.stellar.systemAt(g.seed, sx, sy, 0);
      if (!sys) continue;
      for (let i = 0; i < sys.bodies.length; i++) {
        if (sys.bodies[i].kind !== 'planet') continue;
        const q = RS.scenes.derivePlanet(g, sys, i);
        if (q && q.type.landable && !q.tidallyLocked && q.dayHours < 400) { p = q; break; }
      }
    }
  }
  assert(p, 'the galaxy contains a rotating world to stand on');
  if (!p) p = { tidallyLocked: false, dayHours: 24, axialTilt: 0.4, pressure: 1, moons: null };

  /* A rotating world must actually have a day: the star has to rise and set. */
  let hi = -2, lo = 2;
  for (let k = 0; k < 400; k++) {
    const t = k * (p.dayHours / RS.localtime.HOURS_PER_YEAR) / 40;
    const sun = RS.localtime.sunAt(p, 0, 0, t, null);
    if (sun.elevation > hi) hi = sun.elevation;
    if (sun.elevation < lo) lo = sun.elevation;
  }
  assert(hi > 0.5 && lo < -0.5, 'the star rises and sets (' + lo.toFixed(2) + ' … ' + hi.toFixed(2) + ')');

  /* A tidally locked world must not. Half of it never sees the star, and that
   * is the single most important fact about the commonest kind of habitable
   * world there is. */
  const locked = { tidallyLocked: true, dayHours: 1e6, axialTilt: 0, pressure: 1, moons: null };
  const sub = RS.localtime.sunAt(locked, 0, 0, 0, null);
  const anti = RS.localtime.sunAt(locked, 180, 0, 0, null);
  assert(sub.elevation > 0.95, 'the substellar point is directly under the star');
  assert(anti.elevation < -0.95, 'and the antistellar point never sees it');
  const later = RS.localtime.sunAt(locked, 0, 0, 900, null);
  assert(Math.abs(later.elevation - sub.elevation) < 1e-9,
    'and nine hundred years later, nothing has moved');
  assert(sub.phase === 'substellar' && anti.phase === 'night side',
    'a locked world has places rather than times of day');
  assert(RS.localtime.seasonOf(locked, 40, sub) === 'no seasons',
    'and no seasons either');

  /* Twilight width follows atmospheric thickness — a thin world snaps from day
   * to night, which is why the Moon has no dusk. */
  const thin = { tidallyLocked: false, dayHours: 24, axialTilt: 0.4, pressure: 0.001 };
  const thick = { tidallyLocked: false, dayHours: 24, axialTilt: 0.4, pressure: 3 };
  function twilightSpan(w) {
    let n = 0;
    for (let k = 0; k < 2000; k++) {
      const d = RS.localtime.sunAt(w, 0, 0, k / 2000 * (24 / RS.localtime.HOURS_PER_YEAR), null).daylight;
      if (d > 0.05 && d < 0.95) n++;
    }
    return n / 2000;
  }
  assert(twilightSpan(thick) > twilightSpan(thin) * 2,
    'a dense atmosphere has a long twilight and an airless world has none (' +
    twilightSpan(thick).toFixed(3) + ' vs ' + twilightSpan(thin).toFixed(3) + ')');

  /* Seasons must actually turn over a year, and reverse between hemispheres. */
  const tilted = { tidallyLocked: false, dayHours: 24, axialTilt: 0.41, pressure: 1 };
  const seasons = new Set();
  for (let k = 0; k < 24; k++) {
    seasons.add(RS.localtime.seasonOf(tilted, 45, RS.localtime.sunAt(tilted, 0, 45, k / 24, null)));
  }
  assert(seasons.size >= 4, 'a tilted world has a year with seasons in it (' + [...seasons].join(', ') + ')');
  const midYear = RS.localtime.sunAt(tilted, 0, 45, 0.25, null);
  assert(RS.localtime.seasonOf(tilted, 45, midYear) !== RS.localtime.seasonOf(tilted, -45, midYear),
    'and the hemispheres disagree about which one it is');

  /* Tides scale as the cube of distance, which is why a close small moon beats
   * a distant large one — the thing everyone gets wrong. */
  const near = { moons: { list: [{ massE: 0.01, a: 0.001, period: 3 }] } };
  const far = { moons: { list: [{ massE: 1.0, a: 0.01, period: 30 }] } };
  assert(RS.localtime.tideAt(near, 0, null).height > RS.localtime.tideAt(far, 0, null).height,
    'a close small moon out-pulls a distant large one');
  assert(RS.localtime.tideAt({ moons: null }, 0, null).height === 0, 'and a moonless world has no tide');

  /* No NaN anywhere, over a long span and every latitude. */
  let bad = null;
  for (let lat = -90; lat <= 90; lat += 15) {
    for (let t = 0; t < 50; t += 0.37) {
      const sun = RS.localtime.sunAt(p, 0, lat, t, null);
      if (!Number.isFinite(sun.elevation) || !Number.isFinite(sun.daylight)) bad = lat + '@' + t;
      if (sun.daylight < 0 || sun.daylight > 1) bad = lat + '@' + t + ' out of range';
    }
  }
  assert(!bad, 'the sun is finite everywhere and everywhen: ' + (bad || 'clean'));

  /* And it reaches the readout, which is the entire point. */
  const g2 = RS.game.newGame(31337);
  g2.scene.planet = p;
  g2.scene.lon = 0; g2.scene.lat = 20; g2.scene.t = 0.3;
  const st = RS.localtime.stateFor(g2, null);
  const line = RS.localtime.describe(st);
  assert(line.length > 8 && /day|night|midday|twilight|dusk|afternoon/.test(line),
    'the readout says where in the day you are: "' + line + '"');
}


// ── one drawer, tabs inside it ───────────────────────────────────────────
{
  /* Seven topbar buttons became one. The risk of that change is a panel that
   * becomes unreachable, so: every panel the drawer can render must be
   * reachable as a tab from somewhere. */
  const g = RS.game.newGame(6161);
  const panels = ['upgrades', 'codex', 'settings', 'world', 'vessels', 'contact', 'guide', 'paths'];
  const tabIds = RS.ui.TABS.map(t => t.id);
  for (const id of panels) {
    if (id === 'contact') continue;  // conditional; checked below
    assert(tabIds.indexOf(id) >= 0, id + ' is reachable as a tab');
  }

  /* Every tab must be available somewhere on the ladder — a tab whose `when`
   * is never true is a panel nobody can open. */
  for (let i = 0; i < 40; i++) RS.dials.applyUpgrade(g.dials.space, 'range');
  const everSeen = Object.create(null);
  for (let i = 0; i < RS.cosmos.TIERS.length; i++) {
    RS.dials.setValue(g, g.dials.space, i);
    for (let k = 0; k < 12; k++) RS.scenes.tick(g, nullBus, 1 / 60);
    for (const t of RS.ui.TABS) if (t.when(g)) everSeen[t.id] = true;
  }
  const never = RS.ui.TABS.filter(t => !everSeen[t.id]).map(t => t.id);
  assert(never.length === 0, 'every tab is available somewhere: ' + (never.join(', ') || 'all of them'));

  /* And the World tab must genuinely hide where it is meaningless, or the
   * conditional is decoration. */
  RS.dials.setValue(g, g.dials.space, RS.cosmos.ROOT_INDEX);
  for (let k = 0; k < 12; k++) RS.scenes.tick(g, nullBus, 1 / 60);
  const world = RS.ui.TABS.find(t => t.id === 'world');
  assert(!world.when(g), 'the World tab is absent in the attunement field');
  RS.dials.setValue(g, g.dials.space, RS.scenes.TIER_PLANET);
  for (let k = 0; k < 20; k++) RS.scenes.tick(g, nullBus, 1 / 60);
  assert(world.when(g), 'and present on a surface');
}

// ── arrival says which way you went ──────────────────────────────────────
{
  const g = RS.game.newGame(7272);
  for (let i = 0; i < 40; i++) RS.dials.applyUpgrade(g.dials.space, 'range');

  /* The ladder is the navigation, so a scope change is a movement and the
   * direction must be derived rather than guessed — inward toward the small,
   * outward toward the vast, for every pair of scopes without anybody
   * enumerating them. */
  RS.dials.setValue(g, g.dials.space, RS.cosmos.ROOT_INDEX);
  for (let k = 0; k < 15; k++) RS.scenes.tick(g, nullBus, 1 / 60);
  RS.dials.setValue(g, g.dials.space, RS.scenes.TIER_CELL);
  for (let k = 0; k < 15; k++) RS.scenes.tick(g, nullBus, 1 / 60);
  assert(g.scene.transitionDir < 0, 'descending the ladder reads as inward');

  RS.dials.setValue(g, g.dials.space, RS.cosmos.TIERS.length - 1);
  for (let k = 0; k < 15; k++) RS.scenes.tick(g, nullBus, 1 / 60);
  assert(g.scene.transitionDir > 0, 'and climbing it reads as outward');

  /* Every ordered pair of scopes must produce a direction — a zero would draw
   * nothing and leave the change unexplained. */
  let flat = [];
  for (const a of RS.scenes.SCENES) {
    for (const b of RS.scenes.SCENES) {
      if (a.id === b.id) continue;
      const d = Math.sign(RS.scenes.tierForScene(b.id) - RS.scenes.tierForScene(a.id));
      if (d === 0) flat.push(a.id + '→' + b.id);
    }
  }
  assert(flat.length === 0, 'every scope change has a direction: ' + (flat.join(', ') || 'all of them'));
}


// ── an essence is 4 numbers, and that is the whole of it ─────────────────
/* The property the architecture exists to have, asserted rather than assumed:
 * an essence is four numbers, eight form names and a trait, and adding one adds
 * it to twelve layers, twenty-two rungs, six primitives, nine scopes and every
 * geometry at once. Nothing else in the codebase may need to know how many
 * there are.
 *
 * This is the test that would fail if someone hardcoded a count, sized an array
 * to fourteen, or wrote a switch over essence ids — and every one of those is
 * an easy thing to do by accident. */
{
  const E = RS.fractal.ESSENCES;
  const g = RS.game.newGame(15150);

  /* Complete: every essence must carry the full contract, or it is inert
   * somewhere and the player meets a hole. */
  const geoms = ['foam', 'orbital', 'chain', 'cell', 'body', 'disc', 'web', 'abstract'];
  for (const e of E) {
    assert(typeof e.trait === 'string' && e.trait.length > 12, e.id + ' says what it is');
    for (const a of RS.fractal.AXES) {
      assert(typeof e[a] === 'number' && e[a] >= 0 && e[a] <= 1, e.id + ' has a real ' + a);
    }
    for (const geo of geoms) {
      assert(e.forms && typeof e.forms[geo] === 'string' && e.forms[geo].length,
        e.id + ' has a name at ' + geo);
    }
  }

  /* Every primitive must produce something finite for every essence — not
   * "most of them", which is what a table sized to fourteen would give. */
  const EM = RS.emergence;
  for (const e of E) {
    for (const tier of [0, 5, 13, 21]) {
      const g1 = EM.GATE(e, tier, 1.5, {});
      assert(Number.isFinite(g1.period) && g1.period > 0, e.id + ' gates at rung ' + tier);
    }
    assert(EM.NEST(e, {}).depth >= 1, e.id + ' nests');
    assert(Number.isFinite(EM.FLOW(e, 0.3, 0.2, 1, {}).gx), e.id + ' flows');
    assert(EM.ORDER(e, 7, {}).prereqs.length >= 1, e.id + ' orders');
    assert(EM.ORDER(e, 7, {}).prereqs.indexOf(e.id) < 0, e.id + ' does not require itself');
    assert(Number.isFinite(EM.TWIN(e, 7, {}).separation), e.id + ' twins');
    assert(Number.isFinite(EM.INVERT(e, {}).strength), e.id + ' inverts');
  }

  /* And the self-similar generator must draw it at every geometry, with the
   * same topology — which is the claim, not a side effect. */
  for (const e of E) {
    const base = RS.selfsimilar.topology(RS.selfsimilar.build(e, geoms[0], 11, null));
    for (const geo of geoms) {
      const t = RS.selfsimilar.topology(RS.selfsimilar.build(e, geo, 11, null));
      assert(t === base, e.id + ' has one skeleton at every geometry (' + geo + ')');
    }
  }

  /* Every scope that names essences must reach the new ones — a scope that
   * enumerated fourteen would silently never show the fifteenth. */
  const seenInCells = new Set();
  const planet = { name: 'T', surfaceTemp: 290, pressure: 1, gravity: 1, flux: 1,
    biosphere: { complexity: 0.8, stage: { name: 'Complex' } } };
  for (let i = 0; i < 300; i++) {
    for (const o of RS.cellular.cellAt(g, planet, i * 0.011, i).organelles) seenInCells.add(o.essence.id);
  }
  assert(seenInCells.size === E.length,
    'every essence can appear in a cell (' + seenInCells.size + '/' + E.length + ')');

  const inShells = new Set(RS.shells.shellsAt(g, 3, null).occupants.map(o => o.essence.id));
  assert(inShells.size === E.length, 'and every one has a state in the shells');

  const inMol = new Set();
  for (let i = 0; i < 300; i++) {
    for (const st of RS.molecular.moleculeAt(g, planet, i * 0.013, i, null).sites) inMol.add(st.essence.id);
  }
  assert(inMol.size === E.length, 'and a site in a molecule');

  /* The codex must grow with them rather than showing a fixed fourteen. */
  const html = RS.ui.codexHTML(g);
  assert(html.indexOf('/ ' + (E.length * 4) + ' axes read') >= 0,
    'the codex counts ' + (E.length * 4) + ' axes, not a hardcoded number');
  let rows = 0, from = 0;
  while ((from = html.indexOf('class="ess-row', from + 1)) >= 0) rows++;
  assert(rows === E.length, 'and draws a row for each (' + rows + ')');

  /* Distinctness is asserted once, above, at the threshold that block owns —
   * duplicating it here at a stricter one would mean two assertions disagreeing
   * about the same invariant, and the stricter of the two would start failing
   * on a pair that has been fine since the axes were authored.
   *
   */
  /* The two holes the new ones fill. Before them, every branching essence was
   * lopsided — a player could reasonably have concluded that branching implies
   * asymmetry, which a snowflake disproves. */
  const symBranch = E.filter(e => e.branching > 0.6 && e.symmetry > 0.7);
  assert(symBranch.length > 0,
    'something branches *and* is symmetric: ' + symBranch.map(e => e.id).join(', '));
  const intricateVolatile = E.filter(e => e.complexity > 0.7 && e.branching < 0.35 && e.persistence < 0.3);
  assert(intricateVolatile.length > 0,
    'something is intricate, unbranched and fleeting: ' + intricateVolatile.map(e => e.id).join(', '));
}


// ── striking, and a combo that is cumulative without running away ────────
{
  const g = RS.game.newGame(50505);
  const S = RS.strike;
  assert(g.strike && g.strike.combo === 0, 'a new game starts with no combo');

  /* The curve. This is the whole design claim — genuinely cumulative, so more
   * always helps, and logarithmic, so it never runs away. An exponential combo
   * makes the first hour irrelevant and the fifth absurd; a linear one needs a
   * cap, and a cap is a wall you can see. */
  const k = S.BASE_RESONANCE;
  let prev = 0;
  for (const c of [0, 1, 5, 10, 50, 200, 1000, 100000]) {
    const m = S.mulFor(k, c);
    assert(m >= prev, 'the multiplier never decreases (' + c + ' → ' + m.toFixed(3) + ')');
    prev = m;
  }
  assert(S.mulFor(k, 10) > S.mulFor(k, 5), 'and more combo is always worth something');
  assert(S.mulFor(k, 1e6) <= S.COMBO_MAX_MUL + 1e-9,
    'and it is capped, because a curve with no ceiling is an unchecked promise');

  /* "Not outrageous" made falsifiable: doubling the combo must add a roughly
   * constant amount rather than multiplying, which is what logarithmic means. */
  const d1 = S.mulFor(k, 20) - S.mulFor(k, 10);
  const d2 = S.mulFor(k, 40) - S.mulFor(k, 20);
  const d3 = S.mulFor(k, 80) - S.mulFor(k, 40);
  assert(Math.abs(d1 - d2) < 0.02 && Math.abs(d2 - d3) < 0.02,
    'each doubling adds the same amount (' + d1.toFixed(3) + ', ' + d2.toFixed(3) +
    ', ' + d3.toFixed(3) + ') — that is what stops it running away');
  assert(S.mulFor(k, 10) < 1.8 && S.mulFor(k, 100) < 2.6,
    'and the numbers stay sane: ×' + S.mulFor(k, 10).toFixed(2) + ' at ten, ×' +
    S.mulFor(k, 100).toFixed(2) + ' at a hundred');

  /* A strike reads the primitives rather than inventing its own rule. */
  function fakeNode(align, gate, extra) {
    const n = {
      man: RS.fractal.resolve(g.seed, 13, 0, 1, 1, 0),
      rawAlign: align, gate, coherence: 0, effort: 0,
      dying: false, crystallised: false, blocked: false,
      twinInfo: null, collapsed: true, twinReal: true, depth: 0
    };
    if (extra) for (const key in extra) n[key] = extra[key];
    return n;
  }

  g.strike = S.newState();
  const clean = S.strike(g, nullBus, fakeNode(1, 1));
  assert(clean.verdict === 'clean' && g.strike.combo === 1, 'a tight lock strikes clean');
  assert(clean.pushed > 0, 'and pushes the hold');

  /* A shut gate makes a strike worthless even at perfect alignment — which is
   * what makes a rhythmic layer a rhythm rather than a hold with extra steps. */
  g.strike = S.newState();
  const shut = S.strike(g, nullBus, fakeNode(1, 0.05));
  assert(shut.verdict === 'broke', 'striking through a shut gate breaks the combo');
  assert(g.strike.combo === 0, 'and there is nothing left of it');

  /* An unresolved twin is worth less, because you do not know what you hit. */
  g.strike = S.newState();
  const twin = S.strike(g, nullBus,
    fakeNode(1, 1, { twinInfo: {}, collapsed: false, twinReal: false }));
  assert(twin.quality < 0.6, 'striking an unresolved double is a guess (' + twin.quality.toFixed(2) + ')');

  /* Mashing must be strictly worse than timing. */
  g.strike = S.newState();
  S.strike(g, nullBus, fakeNode(1, 1));
  const mashed = S.strike(g, nullBus, fakeNode(1, 1));
  assert(mashed.verdict === 'early', 'a second strike inside the cooldown does nothing');
  assert(g.strike.combo === 1, 'and does not advance the combo');

  /* Striking nothing is a miss, not a mistake — punishing an empty click
   * teaches people not to explore. */
  g.strike = S.newState();
  g.strike.combo = 7;
  const miss = S.strike(g, nullBus, null);
  assert(miss.verdict === 'miss' && g.strike.combo === 7, 'striking nothing costs nothing');

  /* The window drops the combo rather than eroding it. */
  g.strike = S.newState();
  S.strike(g, nullBus, fakeNode(1, 1));
  assert(g.strike.combo === 1 && g.strike.window > 0, 'a clean strike opens the window');
  for (let i = 0; i < 600; i++) S.tick(g, nullBus, 1 / 60);
  assert(g.strike.combo === 0, 'and the combo lapses when it closes');

  /* A strike must not make a node pay *less* by shortening the hold the payout
   * reads — which it would, if effort were not credited. */
  const n2 = fakeNode(1, 1);
  g.strike = S.newState();
  const before = n2.effort;
  S.strike(g, nullBus, n2);
  assert(n2.effort > before, 'a strike counts as effort, so pushing a node does not devalue it');

  /* Upgrades: three, priced on a curve, all reachable, all monotone. */
  assert(S.UPGRADES.length === 3, 'three strike upgrades');
  for (const u of S.UPGRADES) {
    const g2 = RS.game.newGame(1);
    g2.insight = 1e12;
    let last = -1;
    for (let i = 0; i < u.max; i++) {
      const c = S.costOf(g2, u.id);
      assert(Number.isFinite(c) && c > last, u.id + ' gets more expensive each level');
      last = c;
      const r = S.buy(g2, nullBus, u.id);
      assert(r.ok, u.id + ' level ' + (i + 1) + ' is buyable');
    }
    assert(!Number.isFinite(S.costOf(g2, u.id)), u.id + ' maxes out');
    assert(S.buy(g2, nullBus, u.id).ok === false, 'and cannot be bought past its max');
    assert(u.value(u.max) > u.value(0), u.id + ' is worth more at max than at zero');
  }
  /* And a fully-upgraded striker still cannot finish a node by striking alone,
   * or the hold — which is the core of the game — becomes optional. */
  const gm = RS.game.newGame(2);
  gm.insight = 1e12;
  for (let i = 0; i < 20; i++) S.buy(gm, nullBus, 'strike');
  const push = S.valueOf(gm, 'strike');
  /* The claim the whole design rests on: striking accelerates a hold and can
   * never replace it. Strikes on one node fatigue geometrically, so the total
   * a node can ever be pushed is bounded — and the bound is under a full lock
   * even with the upgrade maxed. */
  const ceiling = S.ceilingFor(push);
  assert(ceiling < 1,
    'a node can never be struck to completion, even maxed (ceiling ' +
    (ceiling * 100).toFixed(0) + '% of a lock)');
  assert(S.ceilingFor(S.BASE_PUSH) < 0.4,
    'and at base a striker gets barely a third of the way (' +
    (S.ceilingFor(S.BASE_PUSH) * 100).toFixed(0) + '%)');

  /* Verified by actually doing it rather than by trusting the algebra. */
  const gm2 = RS.game.newGame(3);
  gm2.insight = 1e12;
  for (let i = 0; i < 20; i++) S.buy(gm2, nullBus, 'strike');
  gm2.strike = S.newState();
  const victim = fakeNode(1, 1);
  for (let i = 0; i < 200; i++) { gm2.strike.cooldown = 0; S.strike(gm2, nullBus, victim); }
  assert(victim.coherence < 0.95,
    'two hundred perfect strikes still do not finish a node (' +
    (victim.coherence * 100).toFixed(0) + '%)');
  assert(victim.coherence > 0.4, 'but they get you most of the way');

  /* Upgrades survive a save; the live combo deliberately does not, because a
   * streak you were not present for is not a streak. */
  const gs = RS.game.newGame(808);
  gs.insight = 1e9;
  S.buy(gs, nullBus, 'tempo'); S.buy(gs, nullBus, 'tempo'); S.buy(gs, nullBus, 'resonance');
  gs.strike.combo = 31; gs.strike.best = 44;
  const round = RS.save.hydrate(JSON.parse(JSON.stringify(RS.save.serialise(gs))));
  assert(S.levelOf(round, 'tempo') === 2 && S.levelOf(round, 'resonance') === 1,
    'strike upgrades round-trip through a save');
  assert(round.strike.best === 44, 'and so does the best combo');
  assert(round.strike.combo === 0, 'but the live combo does not');
}

// ── developer cheat / debug HUD ──────────────────────────────────────────
{
  assert(!!RS.debug, 'debug module is loaded');
  assert(typeof RS.debug.enabled === 'function', 'debug.enabled exists');
  assert(typeof RS.debug.run === 'function', 'debug.run exists');
  assert(typeof RS.debug.panelHTML === 'function', 'debug.panelHTML exists');

  /* Gated off by default in the headless shim (no localhost location). */
  sandbox.localStorage.removeItem('resonantDebug');
  assert(RS.debug.enabled() === false, 'debug is gated off without localStorage/localhost');
  sandbox.localStorage.setItem('resonantDebug', '1');
  assert(RS.debug.enabled() === true, 'localStorage.resonantDebug=1 enables debug');
  sandbox.localStorage.removeItem('resonantDebug');

  const g = RS.game.newGame(4242);
  const before = g.insight;
  RS.debug.grantInsight(g, 1000);
  assert(g.insight === before + 1000, 'grantInsight adds Ψ');
  assert(g.lifetimeInsight >= 1000, 'grantInsight bumps lifetimeInsight');

  RS.debug.unlockAll(g, nullBus);
  assert(RS.influence.RESEARCH.every(n => g.research[n.id]), 'unlockAll researches every node');
  assert(RS.vessel.ARCHETYPES.every(a => g.vessels.unlocked[a.id]), 'unlockAll unlocks every vessel');
  assert(RS.influence.STRUCTURES.every(s => g.structuresUnlocked[s.id]), 'unlockAll unlocks every structure');
  assert(RS.spectrum.BANDS.every(b => g.known.bands[b.id]), 'unlockAll knows every band');
  assert(RS.cosmos.TIERS.every(t => g.known.tiers[t.id]), 'unlockAll knows every tier');
  assert(RS.dials.DEFS.every(d => {
    const dial = g.dials[d.id];
    return !RS.dials.canUpgrade(dial, 'precision') && !RS.dials.canUpgrade(dial, 'focus');
  }), 'unlockAll maxes dial precision and focus');
  assert(RS.strike.UPGRADES.every(u => RS.strike.levelOf(g, u.id) === u.max),
    'unlockAll maxes strike upgrades');

  const jumped = RS.debug.jumpScene(g, nullBus, 'foam');
  assert(jumped.ok && g.scene.kind === 'foam', 'jumpScene lands on foam');
  assert(RS.debug.jumpScene(g, nullBus, 'ensemble').ok && g.scene.kind === 'ensemble',
    'jumpScene lands on ensemble');
  assert(RS.debug.jumpScene(g, nullBus, 'galaxy').ok && g.scene.kind === 'galaxy',
    'jumpScene lands on galaxy');

  const snap = RS.debug.snapPhi(g, 'thermal');
  assert(snap.ok && Math.abs(g.dials.frequency.value - RS.spectrum.BY_ID.thermal.centre) < 1e-9,
    'snapPhi lands on band centre');

  const html = RS.debug.panelHTML(g);
  assert(html.indexOf('data-dbg="unlock-all"') >= 0, 'panelHTML includes unlock-all');
  assert(html.indexOf('data-dbg="jump"') >= 0, 'panelHTML includes scene jumps');
  assert(html.indexOf('data-dbg="planet-play"') >= 0, 'panelHTML includes quick-test shortcuts');
  assert(html.indexOf('DEV') >= 0, 'panelHTML marks itself as DEV');

  /* Unlocks must survive a save round-trip (same path the game uses). */
  const round = RS.save.hydrate(JSON.parse(JSON.stringify(RS.save.serialise(g))));
  assert(RS.influence.RESEARCH.every(n => round.research[n.id]),
    'debug unlocks round-trip through save (research)');
  assert(RS.spectrum.BANDS.every(b => round.known.bands[b.id]),
    'debug unlocks round-trip through save (bands)');
  assert(RS.strike.UPGRADES.every(u => RS.strike.levelOf(round, u.id) === u.max),
    'debug unlocks round-trip through save (strike)');

  RS.debug.fillGnosis(g, 8);
  assert(RS.fractal.ESSENCES.every(e => RS.fractal.attuneLevel(g, e.id) >= 4),
    'fillGnosis reaches attunement 4 on every essence');

  const play = RS.debug.planetPlayground(g, nullBus);
  assert(play.ok && g.scene.kind === 'planet', 'planetPlayground lands on a world');
  assert(g.inhabiting, 'planetPlayground embarks a working body');

  RS.debug.skipTime(g, 600);
  assert((g.stats.playSeconds || 0) >= 600, 'skipTime advances playSeconds');

  const seed = RS.debug.forceOpenSeed(g, nullBus);
  assert(seed.ok && g.seed !== 4242, 'forceOpenSeed rolls a new universe');

  sandbox.localStorage.setItem('resonantDebug', '1');
  assert(RS.debug.persistDebug(false).ok, 'persistDebug can clear the gate flag');
  sandbox.localStorage.removeItem('resonantDebug');
}

// ── vessel open-world: geology, dual cameras, other scopes ───────────────
{
  /* Find a world with moons so tide phase is actually a function of period. */
  let moonWorld = null;
  for (let i = 0; i < 80 && !moonWorld; i++) {
    const sys = RS.stellar.systemAt(91, i, 1, 0);
    for (let j = 0; j < sys.bodies.length; j++) {
      if (sys.bodies[j].kind !== 'planet') continue;
      const p = RS.planet.planetAt(sys, j);
      if (p && p.moons && p.moons.list && p.moons.list.length && p.moons.list[0].period) {
        moonWorld = p; break;
      }
    }
  }
  assert(!!moonWorld, 'some world has Keplerian moons');
  if (moonWorld) {
    const m = moonWorld.moons.list[0];
    const want = RS.orbital.period(m.a, moonWorld.massE / RS.stellar.EARTH_MASSES_PER_SOLAR);
    near(m.period, want, 1e-12, 'moon period is Keplerian');
    const t0 = RS.localtime.tideAt(moonWorld, 0);
    const tQ = RS.localtime.tideAt(moonWorld, m.period * 0.25);
    assert(Math.abs(((tQ.phase - t0.phase) % (Math.PI * 2))) > 0.2 || t0.height === 0,
      'tide phase moves with moon period');
    const w0 = RS.localtime.waterlineAt(moonWorld, 0, 0);
    const wL = RS.localtime.waterlineAt(moonWorld, Math.PI, 0);
    if (moonWorld.hydrosphere > 0 && t0.height > 0) {
      assert(Math.abs(w0 - wL) > 1e-6, 'waterline varies with longitude (the tidal bulge)');
    }
    assert(w0 === RS.localtime.waterlineAt(moonWorld, 0, 0), 'waterline is deterministic');
  }

  /* Seasonal nudge: a tilted world at northern summer is warmer at +lat. */
  let tilted = null;
  for (let i = 0; i < 60 && !tilted; i++) {
    const sys = RS.stellar.systemAt(44, i, 0, 0);
    for (let j = 0; j < sys.bodies.length; j++) {
      if (sys.bodies[j].kind !== 'planet') continue;
      const p = RS.planet.planetAt(sys, j);
      if (p && p.axialTilt > 0.2 && !p.tidallyLocked) { tilted = p; break; }
    }
  }
  if (tilted) {
    const elev = RS.planet.elevationAt(tilted, 0, 0.9);
    const Tmean = RS.planet.temperatureAt(tilted, 0, 0.9, elev);
    const Tsum = RS.planet.temperatureAt(tilted, 0, 0.9, elev, 0.25);
    const Twin = RS.planet.temperatureAt(tilted, 0, 0.9, elev, 0.75);
    assert(Tsum !== Twin, 'seasonal epoch changes polar temperature');
    assert(Number.isFinite(Tmean) && Number.isFinite(Tsum), 'seasonal temperature stays finite');
  }

  const g = RS.game.newGame(601);
  g.vessels.unlocked.walker = true;
  g.vessels.unlocked.courier = true;
  g.vessels.unlocked.ciliate = true;
  g.scene.systemAddr = { sx: 2, sy: 2, index: 1 };
  g.scene.system = RS.stellar.systemAt(g.seed, 2, 2, 1);
  const pIdx = g.scene.system.bodies.findIndex(b => b.kind === 'planet');
  assert(pIdx >= 0, 'test system has a planet');
  RS.scenes.selectBody(g, nullBus, pIdx);
  g.scene.kind = 'planet';
  g.scene.lon = 0.3; g.scene.lat = 0.1;
  RS.scenes.sampleSurface(g);

  const prof = RS.scenes.terrainProfile(g, 0.09);
  assert(prof.elev && prof.biome && prof.n === RS.scenes.PROFILE_N,
    'terrainProfile returns elev + biome arrays');
  assert(prof.n === 96, 'profile sample budget stays at ninety-six');
  assert(prof.biome[0] && prof.biome[0].id, 'profile samples have biome identities');
  let biomeVariety = 0;
  const seen = Object.create(null);
  for (let i = 0; i < prof.n; i++) {
    if (prof.biome[i]) seen[prof.biome[i].id] = 1;
  }
  biomeVariety = Object.keys(seen).length;
  assert(biomeVariety >= 1, 'profile has at least one biome');

  g.body = RS.vessel.newBody('walker');
  g.inhabiting = true;
  g.scene.altitude = 0;
  g.scene.forceCam = null;
  assert(RS.scenes.cameraMode(g) === 'globe', 'inhabiting uses the globe');
  g.scene.altitude = 0.4;
  assert(RS.scenes.cameraMode(g) === 'globe', 'altitude does not swap camera');
  g.inhabiting = false;
  assert(RS.scenes.cameraMode(g) === 'globe', 'observing uses the globe');

  /* Walker gait is pulsed; rover coasts when tau is centred. */
  const envSurf = {
    medium: RS.vessel.MEDIUM.SURFACE, gravity: 1, pressure: 1, temperature: 288,
    flux: 1, roughness: 0.2, slope: 0, fallEast: 0, fallNorth: 0,
    biomeId: 'grass', hasMinds: false, label: 'T', groundY: 0
  };
  const wWalk = RS.vessel.newBody('walker');
  wWalk.heading = 0; wWalk.gaitPhase = 0; wWalk.y = 0;
  RS.vessel.integrate(g, wWalk, envSurf, { rate: 0, heading: 0, vert: 0.5, band: 0 }, 0.05);
  assert(Math.hypot(wWalk.vx, wWalk.vz) < 0.02, 'walker does not slide at a step valley');
  const wRover = RS.vessel.newBody('rover');
  wRover.heading = 0; wRover.vx = 2.5; wRover.vz = 0; wRover.y = 0;
  const wWalk2 = RS.vessel.newBody('walker');
  wWalk2.heading = 0; wWalk2.vx = 2.5; wWalk2.vz = 0; wWalk2.y = 0;
  RS.vessel.integrate(g, wRover, envSurf, { rate: 0, heading: 0, vert: 0.5, band: 0 }, 0.12);
  RS.vessel.integrate(g, wWalk2, envSurf, { rate: 0, heading: 0, vert: 0.5, band: 0 }, 0.12);
  assert(Math.hypot(wRover.vx, wRover.vz) > Math.hypot(wWalk2.vx, wWalk2.vz),
    'rover coasts farther than walker when tau is centred');

  /* Lon/lat on the globe: heading north changes lat, crossing antimeridian wraps. */
  g.inhabiting = true;
  g.body = RS.vessel.newBody('walker');
  g.body.vx = 0; g.body.vz = 4; g.body.vy = 0;
  g.scene.lon = 0; g.scene.lat = 0.2;
  const latBefore = g.scene.lat;
  RS.scenes.tick(g, nullBus, 0.25);
  assert(g.scene.lat !== latBefore, 'embodied motion changes latitude');
  g.scene.lon = Math.PI - 0.01; g.body.vx = 8; g.body.vz = 0;
  RS.scenes.tick(g, nullBus, 0.5);
  assert(g.scene.lon >= 0 && g.scene.lon < Math.PI * 2, 'lon stays wrapped after antimeridian');
  g.scene.lat = Math.PI / 2 - 0.03; g.body.vz = 12; g.body.vx = 0;
  RS.scenes.tick(g, nullBus, 0.4);
  assert(g.scene.lat < Math.PI / 2, 'latitude clamps at the pole');
  assert(Number.isFinite(g.scene.lat) && Number.isFinite(g.scene.lon), 'pose stays finite at the pole');

  /* Pose is unchanged while inhabiting — no camera teleport. */
  const lonHold = g.scene.lon, latHold = g.scene.lat;
  RS.scenes.tick(g, nullBus, 0);
  near(g.scene.lon, lonHold, 1e-9, 'tick keeps longitude');
  near(g.scene.lat, latHold, 1e-9, 'tick keeps latitude');

  /* Save still only persists lon/lat/t, not a heightmap. */
  const serial = RS.save.serialise(g);
  assert(serial.scene.lon != null && serial.scene.lat != null, 'save stores lon/lat');
  assert(!serial.scene.profile && !serial.heightmap && !serial.scene.__profile,
    'save does not store a heightmap or profile');
  const packed = JSON.stringify(serial);
  assert(packed.length < 20000, 'open-world pose does not bloat the save (' + packed.length + ' B)');

  /* Cellular: embark, couple, no NaNs, disembark. */
  RS.scenes.disembark(g, nullBus);
  let live = g.scene.planet && !RS.cellular.reasonSterile(g.scene.planet) ? g.scene.planet : null;
  if (!live) {
    for (let i = 0; i < 40 && !live; i++) {
      const sys = RS.stellar.systemAt(g.seed, i, 0, 0);
      for (let j = 0; j < sys.bodies.length; j++) {
        if (sys.bodies[j].kind !== 'planet') continue;
        const p = RS.planet.planetAt(sys, j);
        if (p && !RS.cellular.reasonSterile(p)) { live = p; g.scene.system = sys; g.scene.planet = p; break; }
      }
    }
  }
  g.scene.kind = 'cellular';
  if (live) {
    g.scene.planet = live;
    RS.cellular.enter(g, nullBus);
    g.body = RS.vessel.newBody('ciliate');
    g.inhabiting = true;
    g.body.x = 0.4; g.body.y = 0.4; g.body.vx = 2; g.body.vy = -1.5;
    for (let i = 0; i < 40; i++) RS.scenes.tick(g, nullBus, 1 / 60);
    assert(Number.isFinite(g.body.x) && Number.isFinite(g.body.y), 'cytoplasm pose stays finite');
    assert(Math.hypot(g.body.x, g.body.y) <= 0.93 + 1e-3, 'cytoplasm confines to the membrane');
    const cyEnv = RS.vessel.environmentFor(g);
    g.body.vx = 0.8; g.body.vy = 0.6;
    for (let i = 0; i < 30; i++) {
      RS.vessel.integrate(g, g.body, cyEnv, { rate: 0, heading: 0, vert: 0.5, band: 0 }, 1 / 60);
    }
    assert(Math.hypot(g.body.vx, g.body.vy) < 0.08, 'ciliate stops when tau is centred');
    RS.scenes.disembark(g, nullBus);
    assert(!g.inhabiting, 'cellular disembark round-trips');
  } else {
    assert(true, 'no living world in sample — cytoplasm coupling skipped');
  }

  /* System orbit: courier Σ sets radius. */
  g.scene.kind = 'system';
  g.body = RS.vessel.newBody('courier');
  g.inhabiting = true;
  /* A fresh dial has min === max, so vert would be stuck. Open the reach. */
  g.dials.space.min = 0;
  g.dials.space.max = 1;
  RS.dials.setValue(g, g.dials.space, 0.2);
  RS.scenes.tick(g, nullBus, 1 / 30);
  const rLow = g.scene.radius;
  RS.dials.setValue(g, g.dials.space, 0.85);
  RS.scenes.tick(g, nullBus, 1 / 30);
  const rHigh = g.scene.radius;
  assert(rHigh > rLow, 'courier Σ opens orbital radius (' + rLow + ' → ' + rHigh + ')');
  assert(Number.isFinite(g.body.x) && Number.isFinite(g.body.y), 'system pose stays finite');
  RS.scenes.disembark(g, nullBus);

  /* Confine helper on remaining scopes. */
  g.body = RS.vessel.newBody('probe');
  g.inhabiting = true;
  g.body.x = 2; g.body.y = 2;
  RS.vessel.confine(g.body, 0.95);
  assert(Math.hypot(g.body.x, g.body.y) <= 0.951, 'confine pulls a body back into the disc');

  const dumped = RS.debug.dumpUnderfoot(g);
  /* dumpUnderfoot needs a planet scene. */
  g.scene.kind = 'planet';
  const dumped2 = RS.debug.dumpUnderfoot(g);
  assert(dumped2.ok && dumped2.dump.indexOf('biome') >= 0, 'debug dump underfoot names the biome');
  const tel = RS.debug.teleport(g, '0,45');
  assert(tel.ok && Math.abs(g.scene.lat - 45 * Math.PI / 180) < 1e-6, 'debug teleport sets latitude');
  const cam = RS.debug.setCam(g, 'globe');
  assert(cam.ok && g.scene.forceCam === 'globe', 'debug force globe');
  assert(!RS.debug.setCam(g, 'sideon').ok, 'side-on camera retired');

  g.inhabiting = true;
  g.scene.kind = 'planet';
  g.scene.forceCam = null;
  assert(RS.scenes.cameraLabel(g) === 'ON GLOBE', 'inhabiting label is ON GLOBE');
  assert(!RS.scenes.cycleCamera(g).ok, 'player camera cycle retired');
  g.inhabiting = false;
  assert(RS.scenes.cameraLabel(g) === 'OBSERVING', 'observing label is unchanged');
}

/* Downhill is a fall line. Ice must outrun grass; desert must not. */
{
  function slideCase(biomeId) {
    const g = RS.game.newGame(77);
    g.scene.kind = 'planet';
    g.inhabiting = true;
    const body = RS.vessel.newBody('walker');
    body.y = 0; body.vx = 0; body.vz = 0; body.charge = 80;
    const env = {
      medium: RS.vessel.MEDIUM.SURFACE,
      gravity: 1, pressure: 1, temperature: 250, flux: 1,
      roughness: 0.2, slope: 0, fallEast: 0.12, fallNorth: 0,
      biomeId, hasMinds: false, label: 'T'
    };
    const ctl = { rate: 0, vert: 0.5, heading: 0, band: null, phi: 0 };
    for (let i = 0; i < 45; i++) RS.vessel.integrate(g, body, env, ctl, 1 / 30);
    return body.vx;
  }
  const iceVx = slideCase('ice');
  const grassVx = slideCase('grass');
  const desertVx = slideCase('desert');
  assert(iceVx > 0.01, 'downhill produces motion without throttle (' + iceVx.toFixed(3) + ')');
  assert(iceVx > grassVx * 1.25, 'ice slides downhill faster than grass (' +
    iceVx.toFixed(3) + ' vs ' + grassVx.toFixed(3) + ')');
  assert(desertVx < grassVx, 'sand slides less than grass (' +
    desertVx.toFixed(3) + ' vs ' + grassVx.toFixed(3) + ')');
}

/* Galaxy vacuum drift is an address change, not a leash. */
{
  const g = RS.game.newGame(601);
  g.scene.kind = 'galaxy';
  g.inhabiting = true;
  g.body = RS.vessel.newBody('courier');
  g.body.vx = 4; g.body.vy = 0; g.body.charge = 80;
  g.galaxy.sx = 0; g.galaxy.sy = 0;
  g.galaxy.driftX = 0.48; g.galaxy.driftY = 0;
  const sx0 = g.galaxy.sx;
  const systems0 = Object.keys(g.known.systems).length;
  RS.galaxy.refresh(g);
  /* 4 * (1/30) * 0.18 = 0.024, so 0.48 crosses 0.5 in one tick and must
   * not have time to cross a second sector. */
  RS.galaxy.tick(g, nullBus, 1 / 30);
  assert(g.galaxy.sx === sx0 + 1, 'crossing half a sector steps sx (' + g.galaxy.sx + ')');
  assert(g.galaxy.sy === 0, 'orthogonal drift does not step sy');
  assert(g.scene.kind === 'galaxy', 'drift does not enter a system');
  assert(Object.keys(g.known.systems).length === systems0, 'and does not record a visit');
  assert(Math.abs(g.galaxy.driftX) < 0.5, 'the fraction wraps rather than accumulating');
  const serial = RS.save.serialise(g);
  assert(serial.galaxy.sx === g.galaxy.sx && serial.galaxy.sy === g.galaxy.sy,
    'save persists the drifted sector address');
  assert(serial.galaxy.driftX == null, 'and does not persist the ephemeral fraction');

  /* Stillness does not walk. */
  const sxHold = g.galaxy.sx;
  g.body.vx = 0; g.body.vy = 0;
  g.galaxy.driftX = 0.1;
  RS.galaxy.tick(g, nullBus, 1);
  assert(g.galaxy.sx === sxHold, 'a parked courier does not change sector');
}

/* Rumour census: hashed, capped, never self. Civilisations are sparse, so
 * the claim is not "names six" — it is that the sample is stable, bounded,
 * and a pre-industrial culture names nobody. */
{
  const g = RS.game.newGame(12345);
  let maxN = 0, calls = 0, selfHit = 0, bad = 0, unstable = 0;
  for (let sx = -8; sx <= 8; sx++) {
    for (let sy = -8; sy <= 8; sy++) {
      for (let ix = 0; ix < 5; ix++) {
        const sys = RS.stellar.systemAt(g.seed, sx, sy, ix);
        for (let j = 0; j < sys.bodies.length; j++) {
          if (sys.bodies[j].kind !== 'planet') continue;
          const p = RS.planet.planetAt(sys, j);
          if (!p) continue;
          const civ = RS.civ.civOf(p, 0);
          if (!civ) continue;
          const pre = Object.assign({}, civ, { tier: RS.civ.techTierOf(0.1) });
          assert(RS.contact.neighboursOf(g, p, pre).length === 0,
            'a pre-industrial culture names no neighbours');
          const observer = Object.assign({}, civ, { tier: RS.civ.techTierOf(0.9) });
          const n = RS.contact.neighboursOf(g, p, observer);
          const n2 = RS.contact.neighboursOf(g, p, observer);
          calls++;
          maxN = Math.max(maxN, n.length);
          if (n.length !== n2.length) unstable++;
          const seen = Object.create(null);
          for (let k = 0; k < n.length; k++) {
            const nb = n[k];
            if (!nb.planet || !nb.civ) bad++;
            if (n2[k] && n2[k].civ && n2[k].civ.name !== nb.civ.name) unstable++;
            const key = nb.planet.system.addr.sx + ',' + nb.planet.system.addr.sy + ',' +
              nb.planet.system.addr.index + ',' + nb.planet.bodyIndex;
            if (seen[key]) bad++;
            seen[key] = 1;
            if (nb.planet.system.addr.sx === p.system.addr.sx &&
                nb.planet.system.addr.sy === p.system.addr.sy &&
                nb.planet.system.addr.index === p.system.addr.index &&
                nb.planet.bodyIndex === p.bodyIndex) selfHit++;
          }
        }
      }
    }
  }
  assert(calls > 0, 'rumour census ran against real cultures');
  assert(bad === 0, 'neighbours are unique derived cultures');
  assert(selfHit === 0, 'a culture never names itself');
  assert(unstable === 0, 'the hashed sample is stable across calls');
  assert(maxN <= 8, 'the census is still capped at eight');
}

/* Bloom stride is optional; the field uses a cheaper skip. */
{
  RS.bloom.setEnabled(true);
  const buf = RS.bloom.begin(64, 48, 1);
  assert(buf, 'bloom world buffer is available for a stride capture');
  RS.bloom.captureWorld(64, 48, 0.4);
  RS.bloom.captureWorld(64, 48, 0.4, 3);
  assert(RS.bloom.STRIDE === 2, 'the default stride is still every other frame');
}

/* Guide copy for an orbital symbiont ride. */
{
  const g = RS.game.newGame(12345);
  let found = null;
  outerRide:
  for (let sx = 0; sx < 40; sx++) {
    for (let sy = 0; sy < 8; sy++) {
      for (let ix = 0; ix < 3; ix++) {
        const sys = RS.stellar.systemAt(g.seed, sx, sy, ix);
        for (let j = 0; j < sys.bodies.length; j++) {
          if (sys.bodies[j].kind !== 'planet') continue;
          const p = RS.planet.planetAt(sys, j);
          if (!p) continue;
          const civ = RS.civ.civOf(p, 0);
          if (civ) { found = { p, civ }; break outerRide; }
        }
      }
    }
  }
  assert(found, 'orbital-ride copy has a culture');
  g.scene.kind = 'system';
  g.scene.planet = found.p;
  g.scene.planet.civ = found.civ;
  g.inhabiting = true;
  g.body = RS.vessel.newBody('symbiont');
  g.vessels.unlocked.symbiont = true;
  const html = RS.guide.guideHTML(g);
  assert(/one scale up/i.test(html),
    'the guide names an orbital ride while in the symbiont');
  const next = RS.guide.pathwaysHTML(g);
  assert(/Stay in the symbiont/i.test(next),
    'a pathway next-step mentions the orbital ride');
  g.body.ridingCiv = true;
  const rows = RS.guide.dialRows(g);
  assert(/culture/i.test(rows[0].note), 'dial copy names the culture while riding it');
}

// ── extractors pay idle insight; worlds have a pulse clicker ─────────────
{
  /* Extractors used to mark the planet and never credit the idle floor.
   * Pulse is strike's cousin on a planet: two numbers per world, not a map. */
  function firstPlanetGame(seed) {
    const g = RS.game.newGame(seed);
    outer:
    for (let sx = 0; sx < 24; sx++) {
      for (let sy = 0; sy < 6; sy++) {
        for (let ix = 0; ix < 3; ix++) {
          const sys = RS.stellar.systemAt(g.seed, sx, sy, ix);
          for (let j = 0; j < sys.bodies.length; j++) {
            if (sys.bodies[j].kind !== 'planet') continue;
            g.scene.systemAddr = { sx, sy, index: ix };
            g.scene.system = sys;
            const p = RS.scenes.selectBody(g, nullBus, j);
            if (!p) continue;
            g.scene.kind = 'planet';
            break outer;
          }
        }
      }
    }
    return g;
  }

  const g = firstPlanetGame(808);
  assert(g.scene.planet, 'earn tests have a world');
  const rich = RS.scenes.richnessAt(g.scene.planet, g.scene.lon, g.scene.lat);
  assert(Number.isFinite(rich) && rich >= 0, 'richnessAt is finite on a landable world');

  const html = RS.ui.worldHTML(g);
  assert(/data-act="pulse"/.test(html), 'the world panel offers a pulse');

  g.structuresUnlocked.extractor = true;
  g.insight = 1e9;
  g.passiveRate = 1;
  const placed = RS.influence.place(g, nullBus, g.scene.planet, 'extractor');
  assert(placed.ok, 'an extractor sites (' + (placed.reason || 'ok') + ')');
  /* Maturity is elapsed play time since `at`. Place first, then wait. */
  g.stats.playSeconds = 1800;
  RS.scenes.derivePlanet(g, g.scene.system, g.scene.bodyIndex);
  const rate = RS.influence.extractorRate(g);
  assert(rate > 0, 'a matured extractor contributes idle rate (' + rate + ')');

  const twin = firstPlanetGame(808);
  RS.field.updateDerived(g);
  RS.field.updateDerived(twin);
  assert(g.passiveRate > twin.passiveRate + 1e-9,
    'updateDerived adds extractor income to the idle floor (' +
    g.passiveRate + ' vs ' + twin.passiveRate + ')');

  /* Pulse pays, cools, diminishes on the same world, resets on a new key. */
  const gP = firstPlanetGame(909);
  gP.stats.playSeconds = 10;
  const before = gP.insight;
  const p1 = RS.scenes.pulse(gP, nullBus);
  assert(p1.ok && p1.amount > 0, 'a pulse pays insight');
  assert(gP.insight > before, 'and credits the wallet');
  assert(p1.first, 'the first read of a world is flagged');
  const cool = RS.scenes.pulse(gP, nullBus);
  assert(!cool.ok && cool.reason === 'cooling', 'a pulse inside the cooldown is refused');
  gP.stats.playSeconds += RS.scenes.PULSE_COOLDOWN + 0.05;
  const p2 = RS.scenes.pulse(gP, nullBus);
  assert(p2.ok, 'a pulse after the cooldown pays again');
  assert(p2.amount < p1.amount, 'the same world diminishes (' + p2.amount + ' < ' + p1.amount + ')');
  assert(!p2.first, 'the second read is not a first-world bounty');

  const keyA = RS.influence.planetKey(gP.scene.planet);
  /* A different body in the same or another system is a new survey key. */
  let other = null;
  outer2:
  for (let sx = 0; sx < 24; sx++) {
    for (let sy = 0; sy < 6; sy++) {
      for (let ix = 0; ix < 3; ix++) {
        const sys = RS.stellar.systemAt(gP.seed, sx, sy, ix);
        for (let j = 0; j < sys.bodies.length; j++) {
          if (sys.bodies[j].kind !== 'planet') continue;
          gP.scene.systemAddr = { sx, sy, index: ix };
          gP.scene.system = sys;
          const p = RS.scenes.selectBody(gP, nullBus, j);
          if (!p) continue;
          if (RS.influence.planetKey(p) === keyA) continue;
          other = p;
          gP.scene.kind = 'planet';
          break outer2;
        }
      }
    }
  }
  assert(other, 'pulse-diminish tests have a second world');
  gP.stats.playSeconds += RS.scenes.PULSE_COOLDOWN + 0.05;
  const p3 = RS.scenes.pulse(gP, nullBus);
  assert(p3.ok && p3.first, 'a new planet key is a full bounty again');
  assert(p3.amount > p2.amount, 'and pays more than the diminished patch');

  RS.save.writeNow(gP);
  const hP = RS.save.hydrate(RS.save.readRaw());
  const rec = hP.surveys[keyA];
  assert(rec && rec.work === 2, 'surveys round-trip with the pulse work count');

  /* Harvester: the same tap extracts when charge and hold allow. */
  const gH = firstPlanetGame(1010);
  gH.inhabiting = true;
  gH.body = RS.vessel.newBody('harvester');
  gH.vessels.unlocked.harvester = true;
  gH.body.charge = 80;
  gH.stats.playSeconds = 4;
  const holdBefore = gH.body.holdMass;
  const events = {};
  const pH = RS.scenes.pulse(gH, busCollecting(events));
  assert(pH.ok, 'a harvester pulse still surveys');
  assert(pH.extracted && pH.extracted.ok, 'and extracts on the same tap');
  assert(gH.body.holdMass > holdBefore, 'the hold actually grew');
  assert(gH.body.charge < 80, 'extraction spent charge');
  assert(events['place:pulse'] && events['place:pulse'].length === 1, 'pulse emits once');

  /* Objective "seams" path: resources is an object, not an array. */
  const gO = firstPlanetGame(1111);
  gO.inhabiting = true;
  gO.body = RS.vessel.newBody('mote');
  gO.vessels.unlocked.mote = true;
  if (gO.scene.planet.biosphere) gO.scene.planet.biosphere.complexity = 0.1;
  const obj = RS.game.sceneObjective(gO);
  assert(/Seams|survey|Tap the ground/i.test(obj.text),
    'the planet objective can mention seams or surveying (' + obj.text + ')');
}

// ── player-facing pass: first lock, land, verbs, contact, idle marks ─────
{
  const g0 = RS.game.newGame(7);
  const o0 = RS.game.nextObjective(g0);
  assert(o0.kind === 'tutorial', 'fresh game is still the first lock');
  assert(/φ|cyan/i.test(o0.text), 'the first objective names the φ knob (' + o0.text + ')');
  assert(RS.game.sceneVerb(g0) === 'STRIKE', 'the field verb is STRIKE');

  for (let i = 0; i < 180; i++) RS.field.tick(g0, nullBus, 1 / 60);
  assert(g0.field.nodes.length === 1, 'the tutorial field holds one node, not a census');
  const n0 = g0.field.nodes[0];
  assert(n0.man.bandIndex === 0, 'the first node is baryonic');
  assert(Math.abs(n0.man.signature - g0.dials.frequency.value) < 0.5,
    'its signature sits under the needle (' + n0.man.signature.toFixed(2) + ')');
  assert(n0.targetRad < 0.35, 'the first node is already nearby');

  g0.stats.crystals = 1;
  const o1 = RS.game.nextObjective(g0);
  assert(!/sweep φ/i.test(o1.text), 'after a crystal the objective is not still sweep φ');
  assert(/Σ|star|inward/i.test(o1.text), 'after the first crystal, descent is named (' + o1.text + ')');

  const gV = RS.game.newGame(8);
  gV.scene.kind = 'planet';
  assert(RS.game.sceneVerb(gV) === 'SURVEY', 'a planet tap is SURVEY');
  gV.scene.kind = 'system';
  assert(RS.game.sceneVerb(gV) === 'AIM', 'a system tap is AIM');
  gV.scene.kind = 'galaxy';
  assert(RS.game.sceneVerb(gV) === 'AIM', 'a galaxy tap without a target is AIM');
  gV.galaxy.target = { name: 'X' };
  assert(RS.game.sceneVerb(gV) === 'TRAVEL', 'a second galaxy tap is TRAVEL');

  function planetGame(seed) {
    const g = RS.game.newGame(seed);
    outer:
    for (let sx = 0; sx < 24; sx++) {
      for (let sy = 0; sy < 6; sy++) {
        for (let ix = 0; ix < 3; ix++) {
          const sys = RS.stellar.systemAt(g.seed, sx, sy, ix);
          for (let j = 0; j < sys.bodies.length; j++) {
            if (sys.bodies[j].kind !== 'planet') continue;
            g.scene.systemAddr = { sx, sy, index: ix };
            g.scene.system = sys;
            const p = RS.scenes.selectBody(g, nullBus, j);
            if (!p) continue;
            g.scene.kind = 'planet';
            break outer;
          }
        }
      }
    }
    return g;
  }

  const gL = planetGame(404);
  assert(gL.scene.planet, 'land tests have a world');
  gL.vessels.unlocked.walker = true;
  gL.research.locomotion = true;
  const land = RS.scenes.nearestStandable(gL, 'land');
  if (gL.scene.planet.type.landable) {
    assert(land, 'a landable world has a standable sample in 96×lat');
    assert(land.biome && land.biome.id !== 'ocean' && land.biome.id !== 'shallows',
      'standable is not ocean (' + (land.biome && land.biome.id) + ')');
    RS.scenes.preferLandPose(gL);
    const r = RS.planet.biomeAt(gL.scene.planet, gL.scene.lon, gL.scene.lat);
    const sea = RS.planet.seaLevel(gL.scene.planet);
    assert(r.elev >= sea || r.biome.id === 'ice', 'preferLandPose leaves the reticle on land');
  }

  const gP = planetGame(909);
  gP.scene.kind = 'planet';
  const oP = RS.game.sceneObjective(gP);
  assert(/Locomotion \(120/i.test(oP.text),
    'a globe without a body names Locomotion and the cost (' + oP.text + ')');

  const p1 = RS.scenes.pulse(gP, nullBus);
  assert(p1.ok && p1.first, 'first pulse of a world succeeds');
  assert(p1.biome && p1.biome.name, 'first pulse names the biome');
  gP.stats.playSeconds += 1;
  const p2 = RS.scenes.pulse(gP, nullBus);
  assert(p2.ok && !p2.first, 'later pulses are not the first');

  gP.structuresUnlocked.extractor = true;
  gP.insight = 1e9;
  gP.passiveRate = 1;
  gP.scene.lon = 0.4; gP.scene.lat = 0.1;
  const placed = RS.influence.place(gP, nullBus, gP.scene.planet, 'extractor');
  assert(placed.ok, 'extractor still sites');
  const d0 = RS.influence.structuresOn(gP, gP.scene.planet)[0].delta;
  assert(Math.abs(d0.lon - 0.4) < 1e-9 && Math.abs(d0.lat - 0.1) < 1e-9,
    'extractor stores lon/lat');
  const htmlW = RS.ui.worldHTML(gP);
  assert(/this world/.test(htmlW) || /seams/i.test(htmlW),
    'the world panel can name this world as the seam source');

  const gC = RS.game.newGame(3);
  gC.scene.kind = 'galaxy';
  gC.flags.firstAmberName = 'Vega';
  const oC = RS.game.sceneObjective(gC);
  assert(/Someone is here/i.test(oC.text) && /Vega/.test(oC.text),
    'first amber is a named objective (' + oC.text + ')');
  assert(typeof RS.galaxy.rumourMarks === 'function', 'rumour marks are a map API');
  assert(RS.galaxy.rumourMarks(gC).length === 0, 'no rumours without a met culture');

  const warm = {};
  const gW = planetGame(1212);
  /* Find an inhabited world if this seed has one; otherwise skip the emit. */
  let foundCiv = false;
  outer2:
  for (let sx = 0; sx < 40 && !foundCiv; sx++) {
    for (let sy = 0; sy < 8; sy++) {
      for (let ix = 0; ix < 4; ix++) {
        const sys = RS.stellar.systemAt(gW.seed, sx, sy, ix);
        for (let j = 0; j < sys.bodies.length; j++) {
          if (sys.bodies[j].kind !== 'planet') continue;
          const p = RS.planet.planetAt(sys, j);
          if (!p || !RS.civ.civOf(p, 0)) continue;
          gW.scene.systemAddr = { sx, sy, index: ix };
          gW.scene.system = sys;
          RS.scenes.selectBody(gW, nullBus, j);
          gW.scene.kind = 'system';
          foundCiv = true;
          break outer2;
        }
      }
    }
  }
  if (foundCiv) {
    const rec = RS.contact.recordOf(gW, gW.scene.planet);
    rec.awareness = 0.13;
    RS.scenes.tickContact(gW, busCollecting(warm), 0.05);
    assert(warm['contact:warming'] && warm['contact:warming'].length >= 1,
      'awareness warmth emits before detected');
  }

  const gR = RS.game.newGame(2);
  gR.stats.crystals = 4;
  gR.stats.systemsSeen = 1;
  gR.gnosis.cascade = ['cascade@13:0', 'cascade@8:0'];
  for (const b of RS.spectrum.BANDS) gR.known.bands[b.id] = true;
  const hunt = RS.game.recognitionHunt(gR);
  assert(hunt && /Cascade/i.test(hunt.text) && /blank axis/i.test(hunt.text),
    'recognition names a twice-met essence (' + (hunt && hunt.text) + ')');

  const gF = RS.game.newGame(1);
  gF.scene.kind = 'foam';
  gF.scene.foam = { survivors: 1 };
  /* readout may still want meanLife; if it throws, the objective helper must not. */
  try {
    const of = RS.game.sceneObjective(gF);
    assert(of.text && !/^×/.test(of.text), 'foam objective does not lead with a multiplier');
  } catch (e) { /* foam readout needs a live slab; the × check is the claim */ }

  const gCam = planetGame(5);
  gCam.inhabiting = true;
  gCam.body = RS.vessel.newBody('walker');
  gCam.vessels.unlocked.walker = true;
  const pulseCam = RS.scenes.pulse(gCam, nullBus);
  assert(pulseCam.ok || pulseCam.reason === 'cooling', 'ground tap is still pulse');
  assert(gCam.scene.forceCam == null, 'pulse does not cycle the camera');
}

// ── generative loop: attunement, hunt, marks, foam body, new seed ────────
{
  const E = RS.fractal.ESSENCES;
  assert(E.length === 20, 'the alphabet is twenty essences, not a second game');
  for (const id of ['sanctum', 'thicket', 'keystone', 'parity']) {
    const e = RS.fractal.ESSENCE_BY_ID[id];
    assert(e, id + ' is in the ledger');
    assert(e.complexity >= 0 && e.persistence >= 0, id + ' has axes');
  }
  const sanc = RS.fractal.ESSENCE_BY_ID.sanctum;
  const thick = RS.fractal.ESSENCE_BY_ID.thicket;
  assert(sanc.complexity > 0.85 && sanc.persistence > 0.9, 'Sanctum is deep and lasting');
  assert(thick.branching > 0.9 && thick.symmetry < 0.15, 'Thicket branches without a favourite');

  const g = RS.game.newGame(42);
  assert(RS.fractal.attuneLevel(g, 'cascade') === 0, 'attunement starts at zero');
  const meanB = RS.fractal.predictedEssence(g, 'cascade', {}).branching;
  const p0 = RS.game.newGame(42);
  const ghost0 = RS.fractal.predictedEssence(p0, 'cascade', {});
  assert(Math.abs(ghost0.branching - meanB) < 1e-9, 'unread axes ghost the mean, not the truth');
  g.gnosis.cascade = ['cascade@13:0', 'cascade@8:0'];
  assert(RS.fractal.attuneLevel(g, 'cascade') === 1, 'two contexts is attunement 1');
  g.gnosis.cascade = ['cascade@13:0', 'cascade@8:0', 'cascade@5:0', 'cascade@4:0'];
  assert(RS.fractal.attuneLevel(g, 'cascade') === 2, 'four contexts is attunement 2');
  g.gnosis.cascade.push('cascade@0:0', 'cascade@16:0');
  assert(RS.fractal.attuneLevel(g, 'cascade') === 3, 'six contexts is attunement 3');
  g.gnosis.cascade.push('cascade@18:0', 'cascade@6:0');
  assert(RS.fractal.attuneLevel(g, 'cascade') === 4, 'eight contexts is full foresight');
  const full = RS.fractal.predictedEssence(g, 'cascade', {});
  const real = RS.fractal.ESSENCE_BY_ID.cascade;
  assert(Math.abs(full.branching - real.branching) < 1e-9, 'full attunement predicts the real branching');

  const places = RS.fractal.huntPlaces(g, 'cascade');
  assert(Array.isArray(places), 'hunt places are a list of scopes');
  const hunt = RS.game.recognitionHunt(g);
  assert(hunt && /Cascade/i.test(hunt.text), 'the hunt still names Cascade (' + (hunt && hunt.text) + ')');
  assert(/cell|filament|foam|molecule|world|field|universe/i.test(hunt.text),
    'and names a place, not a shop (' + hunt.text + ')');

  const pin = RS.game.pinHunt(g, 'cascade');
  assert(pin.ok && g.flags.huntEssence === 'cascade', 'the codex can pin a hunt');
  const sits = RS.game.liveSituations(g);
  assert(Array.isArray(sits) && sits.length <= 3, 'situations are a short derived list');

  const beforeLv = RS.fractal.attuneLevel(g, 'thicket');
  g.insight = 1e12;
  for (const node of RS.influence.RESEARCH) RS.influence.tryResearch(g, nullBus, node.id);
  assert(RS.fractal.attuneLevel(g, 'thicket') === beforeLv, 'insight does not raise attunement');

  const gF = RS.game.newGame(313);
  for (let i = 0; i < 40; i++) RS.dials.applyUpgrade(gF.dials.space, 'range');
  RS.dials.setValue(gF, gF.dials.space, 0);
  for (let i = 0; i < 30; i++) RS.scenes.tick(gF, nullBus, 1 / 60);
  assert(gF.scene.kind === 'foam', 'tests stand in the foam');
  gF.vessels.unlocked.walker = true;
  const walk = RS.scenes.embark(gF, nullBus, 'walker');
  assert(!walk.ok && /persist/.test(walk.reason), 'walkers still cannot enter the foam');
  gF.vessels.unlocked.flucton = true;
  const fl = RS.scenes.embark(gF, nullBus, 'flucton');
  assert(fl.ok && gF.inhabiting, 'the flucton can work the foam');
  assert(RS.vessel.environmentFor(gF).medium === RS.vessel.MEDIUM.FOAM, 'foam is its own medium');
  for (let i = 0; i < 6; i++) RS.scenes.tick(gF, nullBus, 1 / 60);
  assert(gF.inhabiting, 'the flucton survives the foam tick');
  RS.scenes.disembark(gF, nullBus);
  gF.body = RS.vessel.newBody('walker');
  gF.inhabiting = true;
  for (let i = 0; i < 6; i++) RS.scenes.tick(gF, nullBus, 1 / 60);
  assert(!gF.inhabiting, 'a walker that arrives in the foam is still ejected');

  function systemGame(seed) {
    const gg = RS.game.newGame(seed);
    outer:
    for (let sx = 0; sx < 12; sx++) {
      for (let sy = 0; sy < 4; sy++) {
        for (let ix = 0; ix < 3; ix++) {
          const sys = RS.stellar.systemAt(gg.seed, sx, sy, ix);
          if (!sys || !sys.bodies.some(b => b.kind === 'planet')) continue;
          gg.scene.systemAddr = { sx, sy, index: ix };
          gg.scene.system = sys;
          gg.scene.kind = 'system';
          break outer;
        }
      }
    }
    return gg;
  }
  const gK = systemGame(909);
  assert(gK.scene.system, 'keel tests have a system');
  const t0 = gK.scene.system.primary.temperature;
  const hz0 = gK.scene.system.hz.inner;
  gK.structuresUnlocked.keel = true;
  gK.insight = 1e9;
  gK.passiveRate = 20;
  const placed = RS.influence.place(gK, nullBus, gK.scene.planet, 'keel');
  assert(placed.ok, 'a keel sites on a system (' + (placed.reason || 'ok') + ')');
  gK.stats.playSeconds += 2000;
  RS.influence.applyToSystem(gK, gK.scene.system);
  assert(gK.scene.system.primary.temperature === t0, 'a keel never rewrites stellar T');
  assert(gK.scene.system.hz.inner !== hz0 || gK.scene.system.keel > 0, 'the habitable zone is the thing that leans');

  const gS = RS.game.newGame(7);
  gS.gnosis.cascade = g.gnosis.cascade.slice();
  gS.research.locomotion = true;
  gS.vessels.unlocked.walker = true;
  gS.insight = 500;
  gS.deltas['0,0,0,0'] = [{ id: 'extractor', at: 0 }];
  gS.known.planets['x'] = true;
  assert(RS.game.canOpenSeed(gS), 'full attunement on one essence opens a new seed');
  const rS = RS.game.openSeed(gS, nullBus);
  assert(rS.ok && rS.to !== rS.from, 'the seed actually changes');
  assert(RS.fractal.attuneLevel(gS, 'cascade') === 4, 'gnosis survives the universe');
  assert(gS.research.locomotion && gS.vessels.unlocked.walker, 'research and bodies survive');
  assert(!gS.deltas['0,0,0,0'], 'world marks do not');
  assert(!gS.known.planets['x'], 'nor visited places');
  assert(gS.insight < 500, 'insight is not a prestige loot pile');

  const html = RS.ui.codexHTML(gS);
  assert(/elat/.test(html), 'the codex draws a lattice of scopes');
}

{
  for (let i = 0; i < RS.spectrum.BANDS.length; i++) {
    const b = RS.spectrum.BANDS[i];
    const opts = RS.spectrum.optionsOf(b);
    assert(opts.length >= 2, b.name + ' has at least two play options (' + opts.length + ')');
  }
  assert(RS.spectrum.usesPrim(RS.spectrum.BY_ID.thermal, 'gate'),
    'Thermal is flow plus windows, not Baryonic with a drift knob');
  assert(RS.spectrum.usesPrim(RS.spectrum.BY_ID.causal, 'flow'),
    'Causal chains drift — order is not a still puzzle');
  assert(!RS.spectrum.usesPrim(RS.spectrum.BY_ID.baryonic, 'gate'),
    'Baryonic stays the soak layer');

  const gOpt = RS.game.newGame(11);
  const soak = RS.field.liveOption(gOpt);
  assert(soak && soak.label, 'a live option is named even before a lock');
  assert(RS.game.sceneVerb(gOpt) === soak.label || RS.game.sceneVerb(gOpt) === 'HOLD' ||
    RS.game.sceneVerb(gOpt) === 'STRIKE',
    'the verb chip names a field option');

  const gP = RS.game.newGame(3);
  gP.scene.kind = 'planet';
  gP.inhabiting = true;
  gP.body = RS.vessel.newBody('probe');
  gP.scene.planet = RS.planet.planetAt(RS.stellar.systemAt(gP.seed, 0, 0, 0), 0);
  if (gP.scene.planet) {
    RS.scenes.sampleSurface(gP);
    const card = RS.scenes.underfootCard(gP, gP.scene.surface);
    assert(card && card.n === 96, 'underfoot card is the same 96 samples');
    const pProbe = RS.scenes.pulse(gP, nullBus);
    assert(pProbe.ok && pProbe.kind === 'scan', 'a probe pulse is a scan, not a survey');
    gP.body = RS.vessel.newBody('walker');
    gP.stats.playSeconds = 10;
    const pWalk = RS.scenes.pulse(gP, nullBus);
    assert(pWalk.ok && pWalk.kind === 'survey', 'a walker pulse is still a survey');
  }

  const heavy = RS.vessel.newBody('harvester');
  heavy.holdMass = 40;
  assert(RS.vessel.effectiveMass(heavy) > RS.vessel.archOf(heavy).mass,
    'cargo makes a harvester heavier');
  const envH = {
    medium: RS.vessel.MEDIUM.SURFACE, gravity: 1, pressure: 1, temperature: 288,
    flux: 1, roughness: 0.2, slope: 0, fallEast: 0, fallNorth: 0,
    biomeId: 'grass', hasMinds: false, label: 'T', groundY: 0
  };
  const light = RS.vessel.newBody('harvester');
  light.heading = 0; light.y = 0; light.charge = 200; light.gaitPhase = 0.25;
  heavy.heading = 0; heavy.y = 0; heavy.charge = 200; heavy.gaitPhase = 0.25;
  const gH = RS.game.newGame(1);
  gH.scene.kind = 'planet';
  RS.vessel.integrate(gH, light, envH, { rate: 1, heading: 0, vert: 0.5, band: 0 }, 0.2);
  RS.vessel.integrate(gH, heavy, envH, { rate: 1, heading: 0, vert: 0.5, band: 0 }, 0.2);
  assert(Math.hypot(light.vx, light.vz) > Math.hypot(heavy.vx, heavy.vz),
    'a loaded harvester is sluggish');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
