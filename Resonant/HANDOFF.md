# Handoff — Resonant

For whoever picks this up next: Claude Code, Cursor, Grok, or a person. Read
this file, then `README.md`, then the header comment of whichever file you are
about to touch. The headers are not decoration — most of them explain *why* a
number is the number it is, and changing one without reading it is the main way
to break this codebase.

---

## 1. What it is, in one screen

A complete browser game at `Resonant/`. Vanilla JS, **zero dependencies, no
build step, no framework, no package.json**. Canvas2D + WebAudio.

You are a point of consciousness with four dials — **τ** time, **Σ** space,
**Δ** phase, **φ** frequency. Tuning φ selects one of 12 reality layers; tuning
Σ moves you along a 22-rung scale ladder from the Planck length to Tegmark
Level IV. The core loop is a *hold*: land all four dials on a drifting node and
keep them there while coherence fills.

**Nothing is stored.** Every star, world, biosphere, civilisation, cell,
molecule and orbital is derived from its address by hash. Player changes are
sparse deltas layered on top:

```
effective = derived(address) ⊕ Σ deltas(address)
```

That one decision is why a 22-rung ladder of scopes costs almost nothing, why
saves are ~2 kB, and why an alternative-physics universe is possible at all.

```bash
node tools/simtest.js      # 1652 assertions — must be green before you commit
node tools/build.mjs       # emits dist/resonant.html, one self-contained file
python3 -m http.server 8000   # then open /Resonant/index.html
```

---

## 2. The three ideas everything else follows from

If you understand these, the rest of the codebase reads itself.

### 2.1 Six primitives, 64 authored numbers

There are **no per-layer minigames**. There are six functions in
`js/emergence.js` — `GATE, NEST, FLOW, ORDER, TWIN, INVERT` — and every mechanic
anywhere is one or more of them, parameterised by the four numbers an essence
carries and scaled by the rung's clock.

- 16 essences × 4 axes (`complexity, branching, symmetry, persistence`) = **64
  authored numbers**, in `js/fractal.js`.
- A band declares which primitives are live (`prim: [...]` in `js/spectrum.js`).
  That *is* the layer's gameplay.
- A rung declares the tempo and the geometry (`js/cosmos.js`).

The point is **knowledge transfer**. Learn that `Cascade` branches (0.90) and you
know its rhythm subdivides five ways, its dependency graph fans out four wide,
its nests are wide and shallow and its gradient sprays — in every layer, at
every scale, before you have ever played it there. Twelve hand-written modes
cannot do that.

> **If you add a mechanic, express it as a primitive or as a composition of
> them.** A bespoke rule for one layer is the thing this architecture exists to
> avoid, and it will make that layer the one nobody can predict.

### 2.2 Everything is derived; nothing is simulated forward

- Orbits: closed-form Kepler via Halley's method. No integration.
- Biospheres and civilisations: logistic curves evaluated at time *t*.
- Cosmic structure: a logistic on each node's primordial seed, so scrubbing
  13.8 Gyr costs what standing still costs.
- Inhabitants: their *paths* are pure functions of (address, t).

The one exception is the player's own body, which is integrated per frame —
analytic where it buys scale, integrated where it buys feel.

> **If you find yourself adding an array of world objects, stop.** Derive it
> from its address instead. Everything in the game already does.

### 2.2b Dual cameras on a planet, one heightfield

While inhabiting a planet the camera is a view of the same derived sphere, not
a second world:

- **Observing** → globe (baked 96×48 biome table, unchanged).
- **Near the ground** → rich side-on slice (96-sample profile, multi-biome fill,
  tide waterline, parallax far band).
- **Altitude above ~0.22, or a debug/force toggle** → 48×32 freeroam
  neighbourhood. Zoom opens the span; sample count does not.

Pose is `(scene.lon, scene.lat, scene.altitude)`. Agents live in lon/lat.
Saves still persist only those numbers. Debug HUD can teleport and dump the
patch underfoot.

Sample budgets are fixed: profile 96, freeroam 48×32, globe 96×48. Do not grow
them with zoom. Cellular / system / galaxy / field / web / molecular / shells
draw the vessel glyph and couple `body.x/y` to the local derived room. Foam
stays embark-blocked.

### 2.3 The test suite is the specification

`tools/simtest.js` is 1652+ assertions and about half the value of this
repository. It runs headless in Node against the real modules (including
`ui.js`, `audio.js` — the HTML builders are pure string functions).

It does not test that code runs. It tests **claims**:

- Every band is winnable and measurably distinct.
- Every rung resolves to a scope; no gaps; none absorbed by an unrelated scope.
- The economy: every layer out-earns the one you came up through.
- `Cascade` branches identically in fifty alternative universes.
- Adding an essence propagates to every layer, scope, primitive and geometry.
- An unmet essence leaks nothing in the codex — not its name, trait, or forms.

> **A red suite means the game is wrong, not that the test is annoying.** Several
> of the best mechanics in here exist because an assertion refused to pass — see
> §6.

---

## 3. Map of the code

`js/` — 42 files, ~20k lines including comments. Load order is `index.html`;
the headless module list is at the top of `tools/simtest.js` and **must be kept
in sync** when you add a file.

| | |
|---|---|
| `core.js` | math, easing, springs, seeded hash/noise, event bus |
| `cosmos.js` | the 22-rung ladder: scales, clocks, geometries, hues |
| `spectrum.js` | 12 bands as Gaussians; `prim[]`; focus gating; friction |
| `dials.js` | dial physics, detents, encoder ticks, upgrade economics |
| `fractal.js` | **essences and their four axes**; address→manifestation; gnosis as foresight |
| `emergence.js` | **the six primitives** |
| `selfsimilar.js` | one recursive generator; `geometry` picks the stroke only |
| `field.js` | the attunement loop: alignment, coherence, primitive dispatch, payout |
| `strike.js` | the click, the combo curve, the fatigue rule |
| `physics.js` | the constants, gathered and swappable; ours is the default block |
| `orbital.js` `stellar.js` `planet.js` `civ.js` | derived astrophysics and life |
| `galaxy.js` `contact.js` | the star map; carriers, standing, dialogue |
| `neural.js` `vessel.js` `inhabitants.js` | minds; bodies; what lives in each scope |
| `influence.js` | structures, research, sparse deltas, the two fields |
| `localtime.js` | solar elevation, seasons, tides |
| `scenes.js` | **the scene registry** — add a scope here |
| `scene_*.js` | the six scopes with a view of their own |
| `guide.js` | the live guide and the six pathways |
| `game.js` `save.js` | state, economy, objectives, persistence |
| `render.js` `worldrender.js` `bloom.js` `primhud.js` `hud.js` `ui.js` `input.js` | presentation |
| `audio.js` `feel.js` `reactions.js` | synthesis; shake/particles/haptics; the wiring between them |

`reactions.js` is the single place where "something happened" becomes "the player
felt it". Every other module emits plain events and knows nothing about
presentation. **Keep it that way.**

---

## 4. How to do the four most likely tasks

### Add a scope (a new view for a rung)

1. Add a row to `SCENES` in `js/scenes.js` — `{ id, name, first, last, blurb }`,
   inclusive rung indices, **more specific entries first** (first match wins).
2. Write `js/scene_<id>.js`: a pure `<thing>At(game, …)` derivation, `enter`,
   `tick`, `readout`, and a `bonusFor` if it has an only-here reason to be
   worked.
3. Wire: `scenes.tick` dispatch, `changeScene` case, `newScene` fields,
   `field.scopeBonus`, `render.js` draw function + `BLOOM` entry,
   `ui.js` readout, `game.js` objective, `reactions.js` arrival row,
   `guide.js` ladder row, `inhabitants.js` `KINDS` entry, `audio.js` `BEDS`
   entry, `index.html`, `tools/simtest.js` module list.
4. The suite will tell you if you missed one — several assertions exist purely
   to catch a scope that shipped half-wired.

**Do not give it a bespoke rule set.** The attunement loop runs unchanged
everywhere; a scope is a *place*, and what makes it worth visiting is what it is
made of and what working it is worth.

### Add an essence

Add a row to `ESSENCES` in `js/fractal.js`: four axes in 0..1, a trait string
that the numbers actually match, and eight form names (one per geometry). That
is all. It will appear in twelve layers, twenty-two rungs, six primitives, nine
scopes and every geometry, because that is how the other sixteen got there. An
assertion verifies exactly this.

Two constraints: no two essences may sit within 0.1 on all four axes, and no
primitive may share a display name with an essence.

### Change a balance number

Read the comment above it first — most of them record what was tried and why the
number is what it is. Then run the suite: the economy soak averages **five
seeds** because a single soak swings 3× on seed alone, and tuning against that
noise is a mistake already made once in this repo's history.

### Add feedback

Emit an event from the system, handle it in `reactions.js`. Never call
`RS.audio` or `RS.feel` from a simulation module.

---

## 5. State of play

Everything in the original plan has landed.

- **22/22 rungs** have a scope: Quantum foam · Orbital shells · Molecular ·
  Cytoplasm · Surface · System · Star map · Attunement field · Cosmic web ·
  Ensemble.
- **12/12 layers** winnable and measurably distinct.
- **6 pathways**: TUNE, REACH, CONTACT, INWARD, BEYOND, RECOGNITION.
- Bloom, day/night with real solar elevation, inhabitants everywhere, ambient
  beds, directional arrival transitions, the strike/combo system, a tabbed
  drawer, and a codex that is the essence sheet.

**Performance**: 60 fps everywhere except the attunement field, which used to
run at ~57 with bloom on because capture sampled the display canvas. Bloom now
reads an offscreen world buffer; the flush that cost a quarter of the frame
budget is gone. There is still a settings toggle. See §7.

Culture-to-culture rumours, riding a civilisation, contact at range (beacon or
stationed probe), and a mobile pass on the drawer tabs and pilot bar have also
landed. `contact.js` is the file.

---

## 6. Things that were wrong, so you do not re-break them

These are load-bearing. Each was a real bug, and the fix is usually a mechanic
rather than a number.

| what | why it matters |
|---|---|
| **The Causal layer was unwinnable by construction.** Every node needs an antecedent, the ledger starts empty, a blocked node scores 0.15 against a 0.52 threshold. | Fixed by letting gnosis from *anywhere* count as holding an antecedent. Do not "simplify" that back to a local check. |
| **The twin penalty deadlocked its own layer.** The decoy could never build the coherence that would reveal it as the decoy. | The penalty scales the coherence *gain*, not the alignment. Moving it back to alignment reintroduces the deadlock. |
| **The gate punished a half-open window twice.** | `n.gate` scales the rate of progress, not `align`. A rhythmic layer paid a twelfth of the tutorial layer before this. |
| **A maxed Strike could finish a node by clicking.** | `FATIGUE = 0.72` per strike on the same node bounds the total at ~85% of a lock. The hold is the game. |
| **`seaLevel` returns −99 for dry worlds** and was used as a temperature datum. | 9,984 of 12,660 samples were wrong and the global average stayed correct, so nothing looked broken. Use `datum(p)`. |
| **Bloom must not sample the canvas it composites onto.** | Sampling a canvas with drawing queued forces a pipeline flush: 1.3 ms of work measured 16 ms. The world is drawn into an offscreen buffer; capture reads that, then the display gets a blit plus the glow. Drawing the world onto the display and capturing it again reintroduces the flush. |
| **The foam's ejection rule was dead code.** | Σ is the vessel's vertical axis while embodied, so you can never *arrive* there wearing a body. The live rule is `embark` refusing. |
| **`newGame` resets the physics block.** | It is module-level by necessity. Without the reset, a new session derives the galaxy under a previous one's borrowed laws. |

---

## 7. What to do next, in order of value

The vessel open-world pass has landed: planetary geology (essence meso-detail,
multi-biome profiles, live tides, seasons, `resourceAt`), lon/lat freeroam plus
rich side-on sharing one heightfield, and place-aware vessel glyphs in
cellular / system / galaxy / field / web / molecular / shells.

What is still worth doing:

1. **Bloom cost in the attunement field.** The world buffer removes the flush;
   the remaining ~1.3 ms of threshold/blur is still the dearest post in the
   game. A cheaper threshold (or skipping STRIDE more aggressively in that
   scope) is the next fps win, if any.
2. **A census of rumours.** Neighbour sampling is hashed and capped; a culture
   whose only neighbour sits outside the sample will not name them. Widening
   the sample is safe and cheap compared to a full sector walk.
3. **Guide copy for riding a culture.** The symbiont now works in orbit. The
   live guide still talks about riding a creature first, which is the common
   case, but an orbital ride is easy to miss.
4. **Galaxy vacuum drift** is a short leash around the current sector. A
   transfer that actually changes `galaxy.sx/sy` would make the courier's
   interstellar job real, but it has to stay an address change, not a stored
   path.

---

## 8. Conventions

- **Comments explain why, not what.** If a number is tuned, say what it was
  tuned against. If a rule looks odd, say what the obvious version broke.
- **British spelling** throughout (`crystallise`, `colour`, `behaviour`).
- IIFE modules on a global `RS` namespace. No imports, no bundler.
- Hot paths write into caller-owned `out` objects and allocate nothing.
- Nothing in a simulation module may touch the DOM, audio or the pointer.
- Every new module goes in **both** `index.html` and the list at the top of
  `tools/simtest.js`.
- Commit messages describe the *decision*, not the diff — including the things
  that turned out to be wrong. The log is the design record.

---

## 9. Verification checklist before you push

```bash
node tools/simtest.js     # 1652+ assertions, zero failures
node tools/build.mjs      # single file still builds
```

Then, in a browser: sweep Σ across all 22 rungs, open every drawer tab, and
confirm zero console errors and ≥55 fps. There is a Playwright harness pattern
used throughout this repo's history — launch Chromium at
`/opt/pw-browsers/chromium`, click `#btn-new`, then drive `window.__RESONANT__`
directly, which exposes the live game object for exactly this purpose.
