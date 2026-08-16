# Resonant

You are a single point of consciousness. You cannot move. You have four dials,
and everything you will ever perceive is a consequence of where they sit.

Tune reality until it manifests. Descend the scale ladder from the galaxy to a
world you can stand on. Find somebody out there, and learn to talk to them by
ear.

**Stack:** vanilla JS + Canvas2D + WebAudio. No build step, no dependencies, no
backend, no assets. Runs offline from `index.html`.

```
python3 -m http.server 8000      # then open http://localhost:8000/index.html
node tools/simtest.js            # 1750 headless assertions, no DOM
node tools/build.mjs             # -> dist/resonant.html, one self-contained file
```

---

## The four dials

| | | |
|---|---|---|
| **τ** | Time | Rate and direction of the local clock |
| **Σ** | Space | Which rung of the scale ladder is rendered |
| **Δ** | Phase | Offset along the fourth dimension |
| **φ** | Frequency | Which reality layer manifests |

They are the whole interface. There is no second control scheme anywhere in the
game — the dials get *reinterpreted* instead (see [Bodies](#bodies)).

---

## The three layers

### 1. The attunement field — tuning reality

The root layer is **Galactic**. `js/cosmos.js` holds 22 rungs of a scale ladder
built from real numbers: Planck foam at 10⁻³⁵ m, the Bohr radius at 5.29×10⁻¹¹,
the Milky Way disc at ~10²¹, Laniakea at 1.6×10²⁵, the Hubble volume at
8.8×10²⁶. Above the horizon "size in metres" stops being the right coordinate,
so those four rungs carry no metre value and are classified by **Tegmark
multiverse level** instead — the standard taxonomy for what lies beyond an
observer's horizon. You open the ladder inward and outward from Galactic.

The **φ axis** carries twelve reality layers as Gaussian bands — Baryonic,
Thermal, Electromagnetic, Probabilistic, Vital, **Emotional**, Mnemonic,
Causal, Archetypal, Noetic, Null, Unity. Three dial upgrades gate them, and
they gate different things:

- **Range** — extends how far the dial physically reaches. Without it, the high
  bands are not hard, they are *absent*.
- **Precision** — shrinks the smallest step. High bands are narrow; without it
  you step straight over them.
- **Focus** — narrows your carrier. Below a band's `minFocus` your signal is too
  smeared to cohere, so the layer shows as a **ghost**: visible, not holdable.

Reach it, land on it, hold it.

Each layer imposes different mechanics on the field — `accretion` (incremental,
yield accrues unattended), `pulse` (rhythmic gating windows), `superposed`
(each node manifests twice, one is load-bearing), `valence` (attract/repel
social physics), `recursive` (nodes nest; depth is the payout), `causal` (a
node cannot be held before its antecedent), `inverted` (the null layer scores
alignment backwards), `unity`.

**The lock is four-dimensional.** Alignment is the product of four Gaussians,
one per dial, and each band declares how much it *demands* of each axis — the
baryonic layer asks only for φ and Σ; by the causal layer all four are live.
That ramp is the difficulty curve and the tutorial at once: each new layer
introduces exactly one more thing to think about.

### 2. The galactic map — choosing where to go

Turn **Σ** inward past the galactic tier and you arrive at the scale where what
you can see *is* neighbouring stars. That is the scale at which choosing a
destination is the meaningful act, so that is where the map lives.

The map is a window onto an unbounded sector grid — every star derived by
`stellar.systemAt`, so the galaxy is a function rather than a list, and panning
just asks it about different arguments. Roughly 300 stars are on screen at once
at ~12 light years per sector, coloured by real spectral class and sized by real
luminosity, with stellar density falling off toward the rim on the same
galactocentric gradient that sets metallicity.

What makes it feel vast rather than merely large is that **you can see much
further than you can reach.** Beyond the consciousness field, a star is a dim
unnamed point. Inside it, it resolves: planet count, life, civilisations. A
green ring means life; an amber pulse means somebody lives there, and it is the
rarest marker in the game. Expanding the field turns lights into places, and the
horizon recedes as you go — travelling re-centres the window, so each hop
becomes the origin of the next.

### 3. The solar layer — inhabiting it

Turn **Σ** inward again and the ladder keeps being the navigation: map → system
→ planet surface. There is no travel menu anywhere in the game.

Everything in it is derived from real astrophysics. A star's **mass is the only
free parameter**; its luminosity (piecewise mass–luminosity), radius,
temperature (inverted Stefan–Boltzmann), main-sequence lifetime, spectral class,
habitable zone and frost line all fall out of it. Then the frost line decides
where gas giants can form, the habitable zone decides where biospheres appear,
and galactic-radius metallicity decides how much rock there was to build with.
Masses are drawn from a Salpeter IMF, so the galaxy is overwhelmingly M dwarfs
with a scattering of giants — and a 20 M☉ star is *always found young*, because
it cannot live long enough to be found otherwise.

Planets run the same chain one level down:

```
mass → radius → density → gravity → escape velocity
                              ↓
orbit + flux → equilibrium temp → which gases survive Jeans escape
                              ↓
       pressure → greenhouse → surface temperature
                              ↓
   liquid water? → biosphere → intelligence → economy
```

Every arrow is a formula. A world has no air because it is small and hot enough
that hydrogen outran its gravity. It is nearly isothermal because a thick
atmosphere transports heat. It is tidally locked because it sits too close to a
dwarf. Free oxygen in its spectrum means something is alive down there — and you
can see that biosignature from orbit before you ever land. The player reads
causes off effects, which is the whole reason to do it this way rather than roll
on a table of planet types.

---

## Bodies

A body is not a new control scheme — it is a **reinterpretation of the same four
dials**, declared per archetype:

| Body | τ | Σ | Δ |
|---|---|---|---|
| Walker | gait rate | stance height | heading |
| Flier | throttle | altitude | bank |
| Swimmer | stroke rate | buoyancy | heading |
| Courier | burn rate | orbital radius | transfer angle |
| Symbiont | urgency | depth of hold | intent |

Muscle memory transfers completely while the meaning changes entirely. And the
constraints are physical: a flier needs `pressure × 3.4 > gravity × 0.8` to
generate lift, so thin-atmosphere worlds genuinely ground you; legs fail above
3.2 g because the square-cube law is not negotiable. Bring the wrong body and
the HUD names the missing condition.

### The modal split

The dials serve two jobs, so the game splits them by mode — and the split is
thematically exact:

> **Observing** (no body): τ scrubs time, Σ moves the scale ladder.
> **Inhabiting** (a body): τ is throttle, Σ is your vertical axis.

A point of consciousness can move through a world's *time* or its *space*, never
both. Detached, you watch four billion years of a biosphere in twenty seconds;
embodied, you are stuck in the present like everything else with a body. Scout a
system by scrubbing its history, then commit to a moment and go there.

### Minds you can ride

Every creature carries a small recurrent neural network whose weights are
**derived from its address** — nothing trained, nothing stored, same mind for
every player. Not a behaviour state machine: a dynamical system with attractors,
limit cycles and hysteresis nobody designed. Feed it real sensory gradients and
foraging, circling, fleeing and stubbornness appear on their own.

The recurrent spectral gain sits just above 1 — the edge-of-chaos band where the
interesting dynamics live. A galaxy census of 60 minds fed identical input
settles into 9+ genuinely distinct behaviours.

**Influence is indirect by construction.** You never set a creature's outputs.
You apply a *bias vector* — an additive pressure on the hidden units. That
deforms the landscape the behaviour lives in rather than commanding it, so the
result depends on where in state space the mind currently is. Push gently and
you nudge a tendency; push hard and you may throw it into an attractor you did
not want. The bias decays when you stop, so influence is a sustained act, not
mind control. Cost: 200 multiply-adds per mind per tick.

---

## Contact

Civilisations are rare — roughly one system in 190 — and finding one is only
half of it. **You reach them by tuning.** A culture broadcasts on a carrier
frequency, and you open the channel the same way you open anything else in this
game: land φ on it, hold Δ, and listen to the beat. Everything the player has
spent the game learning is exactly the apparatus for the most important content
in it.

The carrier band climbs with their technology:

| Their era | Band | |
|---|---|---|
| Pre-industrial · Industrial | Mnemonic φ437 | you are reading their records, not a signal |
| Atomic · Orbital | Causal φ542 | a deliberate broadcast; they are calling out |
| Interplanetary · System-wide | Archetypal φ655 | structured, symbolic, patient |
| Interstellar · Post-material | Noetic φ771 | no carrier at all — thought, already understood |

So talking to a young culture is merely hard and talking to an old one is an
endgame act: you must be able to *hold the layer minds live in* before a mind
will hold still for you.

**Awareness runs the other way.** They have to notice you too, and that accrues
from your reality field, from time in their system, and from anything you have
built there. A perfect carrier lock on a culture that has never detected you
opens nothing. When they notice you first, the game says so — it is the only
event where something else acts on you.

Once open, everything has a real mechanical consequence:

- **Listen** — their account of the world. Pays insight, and pays *gnosis*,
  because another mind recognising the same essence is literally a new context.
- **Ask what they know** — they hand you their charts. Stars within their
  technological reach become resolved on your map *regardless of your own
  field*, which is a genuine shortcut through the exploration gate and the best
  reason to talk to anyone.
- **Trade** — your hold at their prices, scaled by standing and disposition.
- **Give freely** — buys standing, and buys less each time, because the fifth
  unprompted gift reads differently from the first.
- **Ask to be taught** — an ally will hand you a research node outright. It
  costs them standing to give, and they know it.
- **Raise what they can reach** — uplift, gated on a Cognition Lattice.
  Whether it is welcomed depends on who they are: a curious or distributed
  culture absorbs it and asks for more; an insular or hierarchic one did not ask
  to be raised and knows exactly who did it. **Help is not neutral.**

Everything they say is composed rather than scripted — disposition picks the
voice, standing picks the warmth, and the situation supplies the subject, so a
culture can remark on the beacon you put in their sky or on the fact that their
oldest records describe a world that was sterile before you seeded it.

Standing is four numbers per culture in the save. The civilisation itself stays
derived.

## Understanding the game

Two panels exist because this game asks a lot of a new player, and both are
generated from live state rather than written out:

- **? — How this works.** Describes the thing actually in front of you: what τ
  means *in this mode, in this body*, which rungs of the ladder are open, what
  each symbol on screen is, and how the beat works. A player who is confused
  reads about their situation, not about the game in the abstract.
- **&#9672; Pathways.** Six genuinely different routes forward, and no way to tell
  that from the inside. **TUNE** is pure dial skill and needs nothing. **REACH**
  is research, bodies, worlds and structures. **CONTACT** is the shortcut — a
  culture hands you charts and research you would otherwise buy. **INWARD** runs
  down the ladder through the four small scopes to the one place you change a
  world from inside it. **BEYOND** runs up it, through structure formation to
  the laws themselves. **RECOGNITION** is hunting one essence across contexts
  until you can predict it — only a real strategy since gnosis became foresight.
  They feed each other, none is mandatory, and each always states a concrete
  next step computed from live state. The gates genuinely differ: INWARD and
  BEYOND run in opposite directions from the root, and RECOGNITION is the one
  route no amount of insight can buy.

A player-facing critique of how this actually plays — as opposed to how it is
built — lives in [`docs/PLAYER_CRITIQUE.md`](docs/PLAYER_CRITIQUE.md). What a
session should feel like, and a priority list of changes that would buy that
without a second control scheme, is [`docs/IDEAL_PLAY.md`](docs/IDEAL_PLAY.md).

## Scopes

Turning Σ is how you travel, and each range of rungs is somewhere different.

| Σ | scope | what it is | only here |
|---|---|---|---|
| planck · quantum | **Quantum foam** | pairs borrowing existence and paying it back | **no body works**; find the one that never cancelled |
| nucleonic · atomic | **Orbital shells** | finite states, and no two may be the same | catch a degeneracy — where chemistry comes from |
| molecular | **Molecular** | coiled chains, and handedness | read a biosphere's depth off a bag of molecules |
| cellular | **Cytoplasm** | inside one cell of a living world | change a biosphere from inside it |
| planetary and within | **Surface** | stand on a world | terrain, weather, creatures, structures |
| stellar · system | **System** | one gravity well and everything bound to it | trade, contact, orbital mechanics |
| interstellar · cluster | **Star map** | the stars around you | where to go next |
| local group → hubble | **Cosmic web** | filaments and voids | **tau is the age of the universe** |
| galactic · interstellar | **Attunement field** | tune layers, hold manifestations | the spectrum itself |
| inflationary → mathematical | **Ensemble** | alternative blocks of physical law | **the constants change under you** |

Each scope is deliberately a *place* rather than a rule set: the attunement loop
runs exactly as it does anywhere else, so a player who learned to read a rhythm
in the Electromagnetic layer reads one on arrival anywhere. What changes is what
the place is made of, and what your work there is worth.

### Cytoplasm

- The cell is derived from the host planet's own biosphere. A sterile world has
  no cell to enter and says so; a microbial one is a bare prokaryote; a
  complex one is a tissue or neural cell full of machinery.
- **Organelles are essences.** `essenceAt` excludes tier and band, so the same
  essence that was a spiral arm at the galactic rung is a Coiled Flagellum
  here — and its four axes are the same four axes.
- **Expression.** Crystallising inside a cell writes a delta that raises that
  biosphere's complexity. It is the only place you act on a world *from inside
  it*, and the change is visible from orbit afterwards. Saturating, because a
  biosphere is a logistic curve: you can accelerate a world, not replace it.
- **A body that works there, and bodies that honestly do not.** At a few
  microns the Reynolds number is ~1e-4, so inertia does not exist and a
  reversible stroke returns you exactly where you started. The Swimmer that
  works in an ocean refuses cytoplasm and says why; the Ciliate — almost no
  mass, enormous drag — is the body for a place where nothing coasts.

### Cosmic web

τ stops being a throttle and becomes the age of the universe. The structure is a
*function* of it — growth is a closed-form logistic on each node's own primordial
seed, so scrubbing thirteen billion years costs the same as scrubbing one. At
0.8 Gyr nothing has collapsed and the whole slab is void; by 13.8 there are 34
collapsed nodes and 119 filaments between them.

- **A filament pays best while it is assembling**, when its growth *rate* is at
  peak rather than its size. Reading the clock instead of the picture is a skill
  that exists nowhere else, and the present day is usually the wrong moment to
  be standing in.
- **Past the event horizon** — 4.9 Gpc comoving, not the 14.3 Gpc particle
  horizon — a structure is visible and permanently incommunicado: its old light
  is already on its way, and nothing sent from now on will ever cross in either
  direction. An essence recognised out there cannot be corroborated locally,
  which is the purest statement the game can make of its own premise. The
  Hubble-volume rung is the only slab wide enough to contain any.
- Voids are measured, not labelled: the distance from a grid of sample points to
  the nearest *collapsed* node, so they genuinely shrink as structure forms.

### Quantum foam

**You cannot wear a body here.** A body is a persistent arrangement of matter,
and nothing at 10⁻³⁵ m persists long enough to be arranged. It is the only scope
that refuses one outright, and it refuses for the reason that is true of the
*place* rather than of the vessel.

Everything here is a countdown, and how long a pair lasts is `persistence` — the
axis the player has been reading everywhere else, doing here exactly what it
says on the tin. A Memory hangs around long enough to work; a Seed is gone
before the reticle catches it. Rarely a pair separates too far to recombine and
what was borrowed is never repaid — which, at the largest scale, is the reason
there is anything at all rather than nothing. Finding one is the scope's
discovery.

### Orbital shells

The only scope with a **finite, contested** set of places to be. No two
occupants may share a full set of quantum numbers — that is not a rule anybody
chose, it is what "fermion" means, and it is why matter takes up space and why
there is a periodic table. An essence's four axes decide the state it wants:
complexity picks the shell, branching picks the subshell (s is spherical; p, d
and f have progressively more lobes), symmetry picks the orientation,
persistence picks the spin. Two essences that want the same state genuinely
fight over it, and the loser is pushed outward into an excited state that is
about to fall back.

The find is **degeneracy** — different states that happen to share an energy.
`4s` sits below `3d`, which the suite asserts, because that ordering is why the
periodic table has the shape it has.

### Molecular

A molecule with four different groups on a carbon comes in two mirror-image
forms that cannot be superimposed, with identical energies and identical
spectra. Life uses one almost exclusively — every amino acid on Earth is
left-handed — and nobody knows why it went that way.

So on a sterile world the two hands appear in equal numbers, and on a living one
the chemistry is **homochiral**. You can read a biosphere's depth off a bag of
molecules without ever seeing an organism, which is a real technique. The find is
the exception: on a homochiral world, the rare molecule of the wrong hand.

Handedness comes from `symmetry`, straight through — an essence at symmetry 1.0
is achiral, because its mirror image *is* itself.

### Ensemble

The premise's last claim. So far "local rules" has meant a rung's geometry and a
band's primitives. Here it means **the laws**.

`physics.js` gathers the numbers `stellar.js` and `planet.js` used to hardcode —
the solar photospheric temperature, the Salpeter slope, the Jeans escape factor
of six, the mass–luminosity exponents, the greenhouse coefficients — into one
named block. Hardcoded they are physics; gathered they are *one block among
many*. An ensemble node is an alternative block, derived from its address, and
Δ points at one. Stand in it and the constants swap: every star, world and
biosphere derived from that moment comes out of the new universe.

The scope's picture is one address derived twice, side by side: the same system,
under our laws and under those. And the essences are still the same essences —
Cascade still branches, in fifty alternative universes, which the suite asserts,
because if it stopped the game would be claiming its own information is a
property of physics rather than of the fractal store.

Leaving restores our block, always. An alternative universe you had forgotten
you were standing in would silently re-derive every star in the game and read as
a bug rather than a mechanic.

## Light, and arriving somewhere

Everything in this game emits — nodes ignite as you approach them, filaments
glow, a star is a disc of light — and all of it was drawn with radial gradients,
which is how you fake the *look* of light without any of its behaviour. Two
bright things did not add up. A small very bright thing looked like a large dim
one. Nothing spilled onto anything.

`bloom.js` is a real post pass: downscale to a quarter (the browser's bilinear
filter is the first blur, free), threshold with `difference` and `multiply` so
only genuinely bright things bleed, box-blur by drawing the buffer onto itself,
composite back with `lighter`. Each scope declares how hard it glows — the foam
seethes because everything in it is an event; a planet surface barely blooms
because it is lit rather than luminous.

**The world is drawn into an offscreen buffer**, and bloom reads that — never
the canvas it is about to composite onto. Sampling a canvas with drawing queued
on it forces the browser to finish all of it first: the steps cost 1.3 ms in
isolation and **16 ms** when they sampled their own target. A copy of a finished
world buffer is not that flush, the glow is in the same frame as the thing
making it, and the attunement field gets the headroom back.

It still costs a little in the busiest scope and nothing measurable in the
others, so there is a settings toggle.

### Arrival

`scene.transition` was a white flash, which says "something changed" and nothing
else. The ladder *is* the navigation, so a scope change is a movement, and the
one thing it has to communicate is which way you went.

Descending zooms in: the world starts small and expands into place, and rings
stream outward past you. Climbing does the reverse. The direction is derived
from the rungs the two scopes occupy, so it is right for every pair without
anyone enumerating them — and the suite checks that no ordered pair produces a
zero, because a zero would draw nothing and leave the change unexplained.

## Nowhere is empty

`neural.mindAt` builds a small recurrent network from any address and steps it
for about 200 multiply-adds. It was in the codebase from the solar layer onward,
and exactly two things called it: creatures on a planet surface, and the mind
you ride. Every other scope was furniture — a cell with no traffic, a filament
with nothing falling down it, an atom whose shells were a diagram.

Every scope now has its own inhabitants, from the same generator: transitions
dropping between states in the shells, catalysts working the chain, vesicles on
the cytoskeleton, ships in transit, somebody else's probes, galaxies falling
down filaments, and whatever does the observing in a universe that is not ours.

**They act before you arrive and continue after you leave.** Nothing is spawned
on entry or despawned on exit, because an inhabitant that begins existing when
you look at it is a decoration. Each one's *path* is a pure function of
(address, scene time) — so it costs nothing while you are elsewhere, because it
is not being simulated, it is being derived — and a real recurrent mind rides
that path and perturbs it, so what a thing does is emergent rather than
scripted. The test suite checks both halves: the path is byte-identical at the
same address and time, and the mind moves it without replacing it.

### Time you can feel standing in it

`dayHours`, `axialTilt`, `tidallyLocked` and a full list of `moons` with real
orbital periods have been derived since the solar layer landed. Every one of
those numbers was correct, none was rendered, and a surface looked the same at
every hour of every day of every year on every world.

Now the star's elevation is a real solar-elevation calculation in (planet,
longitude, latitude, epoch) — closed-form, so scrubbing τ across a thousand
years costs exactly what standing still costs, and τ gains a second meaning on a
surface without gaining a second control.

- **Twilight width is the atmosphere's own.** A dense world has a long dusk that
  reddens as the light path lengthens; an airless one snaps from noon to night,
  which is why the Moon has no dusk.
- **A tidally locked world has places instead of times of day.** The substellar
  point is directly under the star forever, the antistellar point never sees it,
  and nine hundred years later nothing has moved. That is the single most
  important fact about the commonest kind of habitable world in the real galaxy,
  and standing on one used to look exactly like standing on Earth.
- **Seasons turn**, from the real declination swing, and the hemispheres
  disagree about which one it is.
- **Tides scale as the cube of distance**, so a close small moon out-pulls a
  distant large one, and several moons produce a genuinely messy tide with
  occasional spring alignments rather than simply a bigger one. The waterline
  used for drawing and for "am I submerged?" follows that tide; hydrosphere
  itself is never mutated.

Embodied on a planet you walk a **lon/lat tangent plane** against the derived
heightfield. Near the ground the camera is a rich side-on slice (multi-biome
silhouette, vegetation ticks, live waterline, hashed clouds). Climb or press C
(or tap the scene tag) and it becomes a 48×32 freeroam neighbourhood of the
same samples, with slope lighting baked into the cache. Observing still uses
the globe (specular ocean, hashed city lights on the night limb). Switching
never teleports: pose is `(lon, lat, altitude)` and nothing about the sphere
is stored. Tap the ground to **pulse** a seam — insight on a cooldown, stored
as two numbers per world. A sited extractor pays idle Ψ from that world's
richest resource; upkeep still only gates placement.

### And silence where there is no medium

One ambient bed per scope: seething broadband in the foam, a resonant ring in
the shells, fluid pulse in a cell, a vast low drone in the web. On a planet
surface the wind scales with real atmospheric pressure and saturates, so Mars is
essentially silent and Venus is not ninety times louder than Earth.

The system and galaxy scopes are **silent**, because sound does not propagate
where there is no medium. It is the one place where the physics and the sound
design are the same decision, and the contrast when you descend into an
atmosphere is worth more than any amount of texture would have been.

## Six primitives

There are no per-layer minigames. There are **six functions**, and every mechanic
anywhere is one or more of them, parameterised by the **four numbers** each
essence carries and scaled by the rung's clock.

| | |
|---|---|
| **Gate** ▮ | available only in windows. `persistence` sets the period, `branching` the subdivision, `symmetry` the duty |
| **Nest** ◇ | contains smaller copies. `complexity` sets the depth, `branching` the fanout, `symmetry` the shrink |
| **Flow** ≈ | has a direction. `branching` sets divergence, `persistence` steadiness |
| **Order** → | needs its antecedents first. `branching` sets how many, `complexity` how deep the chain |
| **Twin** ◐ | exists twice, one load-bearing. `symmetry` sets how close, `persistence` the tell |
| **Invert** ○ | reads backwards. `persistence` is what resists it |

A band declares which are live. That is the whole of its gameplay:

```
baryonic ▸ flow            causal     ▸ order
thermal  ▸ flow            archetypal ▸ nest order
em       ▸ gate            noetic     ▸ nest gate flow
probab.  ▸ twin            null       ▸ invert
vital    ▸ nest flow       unity      ▸ all six
emotive  ▸ flow twin       mnemonic   ▸ order nest
```

**16 essences × 4 axes = 64 authored numbers**, and everything else is composed
from them. The point is not economy of code — it is that knowledge *transfers*.
Once you learn that `Cascade` branches (0.90), you know its rhythm subdivides
five ways, its dependency graph fans out four wide, its nests are wide and
shallow and its gradient sprays rather than converges — **in every layer, at
every scale, before you have ever played it there.** Twelve hand-written modes
cannot do that, because nothing learned in one predicts anything in another.

Difficulty and payout are derived from the same place. Which dials a layer
demands comes from its primitives — Electromagnetic makes τ matter the instant
you arrive because a rhythm is a thing in time; Probabilistic does the same for
Δ because the halves of a superposition differ by phase. And each primitive
carries a friction number that pays back the throughput it costs, so composing a
new band cannot silently create a layer that is a demotion to reach.

### The codex is the essence sheet

The player's map of the generative core, and the most useful screen in the game
once you know what it is for. Every essence gets a row: its four axes as bars,
its trait, how many contexts it has been met in, how many more until the next
axis, and the names it wears at each geometry.

Unrevealed axes are drawn as **blanks rather than hidden**, because the shape of
what you do not know is itself information — you can see that an essence has
three axes left and go hunting it deliberately, which is the whole RECOGNITION
pathway. The sheet's count agrees with `fractal.predicted` exactly, and the test
suite verifies that an unmet essence gives away nothing: not its name, not its
trait, not one of its form names.

Below it, the six primitives and which bands run each. Without that half the
axes are a stat block; with it, they are a prediction.

### Understanding becomes foresight

Recognising an essence in enough contexts reveals its axes one at a time, in an
order seeded per world, so two players build different intuitions about the same
essence. Once an axis is revealed the HUD **draws the expected behaviour behind
the measured one** — the rhythm bar ghosts the predicted subdivision, the depth
gauge ghosts the predicted descent.

Early on the ghost is absent and you play by looking. Later it lands exactly on
the real thing before it happens, and you are playing by knowing. That gap
closing is the reward the gnosis ledger builds toward, and it is something you
see rather than a percentage in a menu.

### One generator

`selfsimilar.js` draws a molecule and a galaxy with the *same* function, driven
by the same four axes. `geometry` picks the stroke — `chain` draws bonds, `cell`
draws lobes, `web` draws filaments, `disc` draws arms — and nothing else. The
topology is identical across geometries for the same essence, and the test suite
asserts it, because two shapes drawn by two unrelated routines are alike only
because someone said so.

## Why it is all formulae

**Nothing in this game is stored.** There is no array of world objects anywhere
in the codebase. Everything is derived on demand from its address:

```
(worldSeed, tier, band, cell, slot) ──hash──▶ manifestation
(worldSeed, sector, index)          ──hash──▶ a complete star system
```

Orbits are the clearest case. No body is integrated forward — position is a pure
function of six orbital elements and the time you ask about, via Kepler's
equation solved with **Halley's method** to machine precision in three
iterations. Consequences:

- **No loading.** A 400-body system is "generated" by deciding to look at it.
- **No stutter.** Cost is O(visible), and it is the *same* cost every frame — no
  integrator, no broadphase, no drift correction spikes.
- **Time is exact at any distance.** Scrubbing to t + 10,000 years costs exactly
  what t + 1 second costs, and it is correct — an integrator would smear into
  nonsense long before that. Measured: evaluating a billion years out takes the
  same time as evaluating now.
- **Tiny saves.** A run with 400 explored worlds is ~1.4 kB.

Measured in-browser (430×900, 2× DPR): simulation **0.02 ms/frame**, drawing
0.58–1.26 ms across all three scenes.

### Where the player changes things

The player can never edit a world — that would collapse the whole scheme. They
place **structures**, and the world's actual state is always:

```
effective = derived(address) ⊕ Σ deltas(address)
```

A structure is four numbers keyed by planet address. No structure sets a value:
every one biases a *rate* or a *ceiling* that then resolves through the same
closed-form models. A seeder raises the abiogenesis rate constant, it does not
place life. A lattice raises a culture's technology ceiling; what they do with it
is theirs. Effects mature over in-world time, so you place one and come back.

Because deltas apply *after* the analytic evaluation, time-scrubbing stays
honest: rewind and you see what the world would have done without you.

---

## Striking, and the combo

The core loop is a **hold** — four dials on a node while coherence fills — and
that is deliberately not a clicker. But a hold has one dead spot: once the dials
are on, there is nothing to *do* for the two to six seconds it takes, and the
hardest layers are the ones you sit in longest.

A **strike** is a tap that pushes a lock you are already winning. Its quality is
`alignment × gate` sampled at the instant you hit, which means it reads the same
primitives as everything else:

- In an ungated layer, strike when the lock is tight. Easy, and worth least.
- In a gated one, strike **inside the open window** — whose rhythm is the
  essence's `branching`, which you already know how to read. A Cascade gives you
  five narrow chances a bar; a Lattice one wide one.
- While a twin is uncollapsed, a strike is worth less, because you do not yet
  know which one you hit.

Three outcomes, not two: **clean** advances the combo, **held** keeps it,
**broke** drops it. "You did not lose it" is the feedback that keeps someone
playing a layer they have not mastered.

### The combo is logarithmic on purpose

    ×(1 + resonance · ln(1 + combo))

×1.6 at ten, ×2.0 at fifty, ×2.4 at three hundred. Genuinely cumulative — more
always helps — and it never runs away, because **doubling the combo adds a
constant rather than a factor**, which the suite asserts by checking that each
doubling adds the same amount. An exponential combo makes the first hour
irrelevant and the fifth absurd; a linear one needs a cap, and a cap is a wall
you can see. A log curve needs neither. It is capped anyway, because a curve
with no ceiling is a promise nobody checked.

### Striking can never replace holding

Each strike on the *same node* is worth 72% of the last. Geometric, so the total
a node can ever be pushed is bounded — about 85% of a lock with the upgrade
maxed, a third of one at base. Two hundred perfect strikes on one node still do
not finish it, which the suite verifies by actually doing it.

That rule exists because the hold is the game, and it turns out to be the better
mechanic anyway: without it the optimal play is to find one node and mash it,
and with it you are pushed across the whole field — which is what the combo
wanted from you in the first place.

### Three upgrades

**Strike** (how hard a hit pushes), **Tempo** (how long a combo survives between
hits), **Resonance** (how steeply the multiplier climbs). They trade against each
other, and they are priced on the same geometric curve the dials use so the whole
economy has one shape.

## Two currencies

- **Insight (Ψ)** is spent. Buys dial upgrades and research.
- **Gnosis** is never spent. It counts distinct `(essence, tier, band)` contexts
  you have recognised an essence in — and because it is stored against the
  *essence* rather than the instance, it pays out everywhere at once.

That second one is the premise as an economy. There are 14 **essences** —
Boundary, Flow, Recursion, Attractor, Duality, Emergence, Threshold, Lattice,
Spiral, Void, Seed, Weave, Cascade, Memory — and they are not content; they are
the alphabet every tier spells its content out of. The essence at a cell depends
on the cell alone, *not* on tier or band. So the same essence recurs down the
whole ladder wearing different clothes: `Spiral` is a Spiral Arm at the galactic
tier, a Coiled Flagellum at the cellular one, a Helix at the molecular one — and
observed through the emotional layer, a *Yearning* Spiral Arm. Learning to see
that is the real progression.

---

## Feedback design

The brief was that this must be the most satisfying thing to touch, so the
mechanics of that are load-bearing rather than decorative.

**The beat.** Two tones close in pitch beat at the difference of their
frequencies: far off, a fast ugly warble; closer, a slow throb; identical, the
warble vanishes and the tone goes glassy. That is how a guitar is tuned, and it
is the best feedback mechanism any physical instrument has, because the signal
gets *qualitatively* different as you close in rather than merely louder. So the
φ dial drives a real detuned oscillator pair: 4φ off tune is a 10 Hz flutter,
0.4φ off is a one-per-second throb, dead centre is silence. **A player can find
a layer with their eyes shut.** A ring on screen pulses at the same rate for
anyone playing muted.

**Everything else:**

- Dials have mass, friction scaled by the local tier's drag, and an encoder that
  clicks every notch. Detents are *discovered*, not given — the frequency dial
  only snaps to bands you have already made cohere.
- Distance-scaled precision: finger on the hub is coarse, swung out wide is fine,
  continuously, inside one gesture.
- Multi-touch — two thumbs, two dials. Hold φ steady while walking Δ in.
- Trauma-based shake (renders as trauma², so small events barely register),
  hit-stop that freezes the *simulation* while particles keep moving, pooled
  particles, springs on every needle so nothing ever teleports.
- Redundant channels: a crystallisation shakes, flashes, bursts, pops a number,
  ripples, buzzes the haptics and strikes a just-intonation chord in that band's
  own key — seven channels for one event.
- Feedback scales with **rarity**, not frequency. A detent tick gets 6 ms of
  haptic; first contact with a new reality layer gets everything the engine has.
- A permanent four-arc reticle shows how wrong *each* dial is, with a direction
  arrow. A four-dial lock you cannot diagnose is not difficulty, it is noise.

All audio is synthesised at runtime — there are no sound files.

---

## Files

| | |
|---|---|
| `core.js` | math, easing, springs, seeded hash/noise, event bus |
| `cosmos.js` | the 22-rung scale ladder, real scales + Tegmark levels |
| `spectrum.js` | 12 reality layers as Gaussian bands, resonance, focus gating |
| `dials.js` | dial physics, detents, encoder ticks, upgrade economics |
| `fractal.js` | essences and their four axes, address→manifestation, gnosis as foresight |
| `emergence.js` | the six primitives — every mechanic in the game is one of these |
| `selfsimilar.js` | one recursive generator; `geometry` picks the stroke and nothing else |
| `field.js` | the attunement loop: four-dial alignment, coherence, primitive dispatch |
| `strike.js` | the click, the combo curve, and the fatigue rule that keeps holds load-bearing |
| `orbital.js` | Kepler/Halley, Hill spheres, Roche limits, Hohmann transfers |
| `stellar.js` | IMF, mass–luminosity, habitable zones, system architecture |
| `planet.js` | Jeans escape, greenhouse, terrain fields, biomes, resources |
| `civ.js` | closed-form biospheres, civilisations, markets, emergent trade, fauna |
| `galaxy.js` | the star map: unbounded sector grid, reach gating, charts |
| `contact.js` | carriers, awareness, standing, dialogue, uplift |
| `guide.js` | the live guide and the three pathways |
| `neural.js` | derived recurrent minds; the influence channel |
| `inhabitants.js` | what lives in each scope — derived paths, real minds riding them |
| `localtime.js` | solar elevation, seasons and tides, closed-form in place and epoch |
| `vessel.js` | archetypes, forces, senses, expenditure, dial remapping |
| `influence.js` | structures, research, sparse deltas, the two fields |
| `scenes.js` | the scene registry, the modal split, agents |
| `scene_cellular.js` | Cytoplasm: derived cells, organelles as essences, expression |
| `scene_web.js` | Cosmic web: logistic structure formation, voids, the event horizon |
| `scene_foam.js` | Quantum foam: virtual pairs, lifetimes from persistence, ejection |
| `scene_ensemble.js` | Ensemble: alternative law, adoption, the two-universe specimen |
| `scene_molecular.js` | Molecular: chirality, and what homochirality says about a world |
| `scene_shells.js` | Orbital shells: exclusion, Aufbau placement, degeneracy |
| `physics.js` | the constants, gathered and swappable; ours is the default block |
| `game.js` `save.js` | state, economy, objectives, persistence |
| `bloom.js` | the post pass: world buffer, threshold, blur, blit |
| `audio.js` `feel.js` | procedural synthesis; shake/hitstop/particles/haptics |
| `primhud.js` | one readout per primitive, with the predicted behaviour ghosted behind |
| `render.js` `worldrender.js` `hud.js` `ui.js` `input.js` `reactions.js` | presentation |

`reactions.js` is the single place where "something happened" becomes "the
player felt it" — every other module emits plain events and knows nothing about
presentation.

---

## Tests

`node tools/simtest.js` — 315 assertions under a `window` shim, exercising the
same files the browser loads. It protects the things that are invisible until
they are catastrophic:

- **Determinism** of the fractal store and the save round-trip. Nothing in the
  field is stored, so a hash change silently rewrites every player's world.
- **Reachability**: maxed φ range must actually reach the final band and maxed
  focus must be able to hold it. It could not, once — focus is asymptotic and
  the top band demanded 0.96 while the ceiling was 0.9564, so the endgame was
  unreachable by construction.
- **Kepler to machine precision** across every eccentricity, and that a circular
  orbit returns to its start after exactly one period.
- **A galaxy census.** A percentage bound is too weak to catch what actually
  happened: every biosphere existed but none grew past 4% complexity, so the
  galaxy had life on paper, no complex ecology anywhere, and zero civilisations.
  Only counting the *stages* over ~700 systems finds that. Now asserted: life in
  4–45% of systems, complex ecologies exist, sapience is reached, at least one
  civilisation exists, and the stages get monotonically rarer.
- **The altitude datum.** `seaLevel` returns a −99 sentinel on dry worlds so no
  ocean is drawn; using it as a *height reference* made the lapse rate subtract
  ~99 units of altitude from every dry surface, freezing 640 K greenhouse worlds
  into ice sheets. Invisible, because the global temperature stayed correct and
  only local samples were wrong — 9,984 of 12,660 samples. Now asserted.
- **The whole contact lifecycle**, end to end against a civilisation actually
  found in the galaxy: carrier inside its band, bands climbing with technology,
  a perfect lock alone *not* opening a channel, awareness accruing in bounded
  time, drifting off the carrier closing it again, every offer, uplift
  reception matching disposition, hostility reachable, and the relationship
  surviving a save.
- **That the panel never lies**: any offer shown as unavailable is genuinely
  refused. It was not, once — `survey` was greyed out for a pre-industrial
  culture and worked anyway.
- **That the opening line survives until it is read.** `met` is set when the
  channel opens, before the player looks at the panel, so it could not gate the
  greeting — the first thing a culture ever said to you was being consumed by a
  state change nobody saw.
- **The guide renders in every scene and both modes** without leaking a raw
  `undefined`/`NaN`, and every pathway always states a next step.
- Vessel integration stability through 0.25 s frames, neural minds bounded and
  behaviourally diverse, influence decaying, every research node reachable,
  every vessel and structure unlocked by something.

Verified in Chromium via Playwright: zero console errors, 54–60 fps across all
four scenes, ~1.7 kB saves — including a full run that finds a Post-material
Insular culture, opens its channel, listens, takes its charts (45 stars
revealed) and reads its dialogue off the rendered DOM.

---

## Status

**Complete as designed.** Every phase of the plan this was built against has
landed, and the invariants are held by 1750 assertions rather than by intention:

- All **22 rungs** have a scope of their own, every one reachable by turning Σ,
  none absorbed by a scope that is not about it.
- All **12 layers** are winnable and measurably distinct, composed from six
  primitives and 64 authored numbers.
- **Six pathways** through it, each computed from live state, gating on
  genuinely different things.
- Nothing is stored. `node tools/build.mjs` still emits one self-contained HTML
  file with no dependencies and no build step, and it runs at 60 fps.

What a next pass would most usefully do, in order of how much it would change
the game:

- **Feel of a sector crossing.** Vacuum drift now changes `galaxy.sx/sy`; the
  map still recentres in one frame.
- **Foam remains embark-blocked.** A foam-native body would need its own
  medium, not a weakening of `embark`.
