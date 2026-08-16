# Ideal play, and the changes that buy it

What a session of Resonant should feel like, then the work that would make
the current build play that way. Companion to `PLAYER_CRITIQUE.md`.

Constraints that stay non-negotiable (see `HANDOFF.md`):

- No per-layer minigames. New verbs are primitives or compositions of them.
- No stored worlds. Deltas stay sparse. Sample budgets stay fixed.
- The hold is the game. Strike pushes a hold; it does not replace it.
- Comments and tests still explain *why*. British spelling.

If a change below needs a new clicker, a second control scheme, or a stored
heightmap, it is the wrong change.

---

## 1. What a good session feels like

Not a feature tour. A sequence of *felt* events.

### The first ninety seconds — one verb

BEGIN. The field is almost empty. One smudge. The objective is not “sweep φ”;
it is “drag the cyan knob until the tone goes still.” The beat slows as they
near it. The ring tightens. They hold. It crystallises. The first insight
number they ever see is the one that pop is attached to.

They should not open a menu. They should not buy an upgrade. They should not
see a planet. They should be able to do this with the sound off *and* know
they did it, because the ring and the needles agreed.

After that, the guide’s first sentence can be “you just held a layer.” Until
then, the game has not started.

### The first descent — a place they cannot touch

They buy enough Σ to fall inward because the objective named a *star*, not a
shop. The map is quiet. A star resolves. They turn Σ again. A system. A
globe. The readout says there is a surface and they have no body.

*That* is when Locomotion is a desire. Research is not a skill tree; it is
the price of touching the thing they are looking at.

### The first walk — land underfoot, not a refusal

They embark. The reticle is on ground a walker can stand on — or the game
refuses with a *destination* (“this is ocean; the shore is east” / “take the
swimmer”). Side-on shows a hill, a biome name they can read, something moving
that is not them. They tap the ground and the patch answers (pulse). They
press C and the neighbourhood is the same place from above, not a different
planet.

They leave the body. τ scrubs two million years. The biosphere is not the
one they walked. They understand the modal split without being told the
sentence.

### First contact — a conversation they earned with φ

An amber ring on the map, or a rumour that names a neighbour, or a chart
someone handed them. They travel. They hear a carrier. They tune φ and Δ the
way they have been tuning all along. The channel opens because *they* locked
it, and because the culture noticed them.

They listen. They get a chart. The map beyond their field lights up. Contact
has paid in the only currency that matters: places they could not have
reached alone.

### Recognition — playing by knowing

They hunt one essence across a cell, a world, a filament. The codex is not a
trophy room; it is a wanted poster with blanks. When the next axis fills, the
HUD ghosts the rhythm *before* it happens. The player strikes the window they
predicted. That is the endgame of TUNE, and it does not cost insight.

### Ensemble — the thesis, once

They stand in a block of laws that is not ours. The same system, twice. The
essences are still themselves. They leave, and physics restores, and they
know why the game refused to let them forget they had swapped it.

If they never do this, they still had a game. If they do it, they had the
ending.

---

## 2. Player-facing principles

Use these when a change looks tempting.

1. **One new verb per hour, taught in the world.** Not in a drawer. The first
   hour is hold. The second is descend-and-touch. The third is talk. Gnosis
   as foresight can wait until they have an essence they care about.
2. **The next action is on screen without a menu.** The objective line is
   already this. Make it name the *control* (“drag φ”, “press C”, “tap the
   amber star”), not only the goal.
3. **Failure names the fix and the place.** “Cannot operate in liquid” needs
   “shore is 12° east” or “the swimmer works here.” Ghost layers already do
   this (“buy φ FOCUS”). Bodies should too.
4. **Idle is a floor, not a loop.** Extractors and pulse may pay. They must
   not look more alive than a lock. If +Ψ/s is the most exciting number on
   the topbar, the hold has lost.
5. **Rarity is allowed; invisibility is not.** Civilisations stay rare.
   Finding the *first* one should be a mid-game event a determined player can
   force (rumour, chart, named amber, field expansion with a visible
   horizon), not a 190-system lottery.
6. **Each scope gets one sensory fact you cannot get elsewhere.** Vacuum is
   silent. Foam refuses a body. Cytoplasm’s expression is visible from orbit
   afterwards. Do not add a unique minigame; add a unique *consequence*.
7. **Do not add a currency, a clicker, or a second stick.** If the four dials
   cannot express it, it is not this game.

---

## 3. Changes, in order of player value

Work top-down. Later items assume earlier ones. Each item is a player-facing
outcome, not a file list.

### P0 — The first lock is a lesson

**Do**

- Spawn the tutorial field with *one* nearby node whose φ sits under the
  default needle, so the first sweep is short.
- Put the beat and the “swing wide for fine control” hint in the world for
  that first lock (beat-hint and a one-shot ghost arc), then never nag again.
- Make the first crystallise the loudest event in the game. Later ones can
  be quieter.

**Do not**

- Add a tutorial overlay with four paragraphs.
- Disable strike, pulse, or the drawer. Just do not *need* them yet.

**Ideal:** a new player crystallises once without opening ☰.

### P1 — Descent is a want, not a shop

**Do**

- After the first crystal, let the objective name a reachable star or “turn
  Σ inward” *once they can actually reach the map*, rather than only “buy
  RANGE”.
- When they are looking at a landable globe with no body, the objective
  should be “research Locomotion (120 Ψ) to walk this.” That sentence is
  already almost there; it should fire while the globe is on screen, not
  from the system view in the abstract.

**Do not**

- Gift a walker. The gate is the point. Showing the locked door is the
  missing piece.

### P2 — The first embark is on land

**Do**

- `mostInteresting` (or embark) should prefer a landable biome the current
  body can stand on, or move the reticle to the nearest shore when a walker
  is refused for liquid.
- If the only honest spawn is ocean, offer the swimmer as the fix on the
  pilot bar (this already happens in some blocked cases — make it the
  default for the first embark).
- Side-on on water should still read as a *place*: a shore in the profile,
  a tide line, a moon, not a flat fill. The profile already has the samples.

**Do not**

- Grow the 96-sample profile. Ask a different question of it (where is the
  nearest land sample in this span?).

**Ideal:** the first screenshot of inhabiting is a hill or a beach, not a
refusal toast.

### P3 — Tap has one visible verb

**Do**

- Keep the three tap meanings (strike / pulse / pick). Change the *cursor
  language*: the objective and a persistent verb (“STRIKE”, “SURVEY”, “AIM”,
  “TRAVEL”) that follows the scene.
- Observing pulse can stay, but the first pulse of a world should name the
  patch (biome + richest seam), not only “+Ψ”. Later pulses stay quiet.

**Do not**

- Cycle the camera with a ground tap. That lesson was already learned.
- Make pulse a farm. Diminishing returns stay.

### P4 — Contact can be found on purpose

**Do**

- Keep the 1-in-190 rarity of a living culture.
- Make the *first* amber ring in reach a named event: the map should be
  able to say “someone is here” without a census.
- Let a rumour or a gifted chart point at a specific neighbour with a
  bearing, not only a toast. The census already returns names; the map
  should be able to mark one.
- Awareness should be feelable while you are in-system (the “SOMETHING HAS
  NOTICED YOU” beat is correct; a slow warm-up with no feedback feels like
  a broken Hail).

**Do not**

- Add a Hail button.
- Sprinkle civilisations until the sky is crowded. The quiet sky is the
  setting.

**Ideal:** a player who has a courier and a mid-size consciousness field can
force first contact in one dedicated session, not one dedicated week.

### P5 — Only-here is a moment, not a multiplier

Each small scope already has a unique fact. Make that fact the *arrival*.

| Scope | The moment the player should have | Not this |
|---|---|---|
| Foam | A pair that never cancelled, bright and still, while everything else dies | “×bonus on a hold” |
| Shells | Two occupants fighting over one state, one pushed out | A diagram they do not know how to read |
| Molecular | The wrong-handed molecule on a living world, warm | Equal numbers on a sterile world with no instruction to leave |
| Cytoplasm | After a crystal, the *planet* readout from orbit has changed | A percentage in the cell HUD |
| Web | A filament that is assembling *now*; present day is the wrong time | A static web they hold in |
| Ensemble | The same system drawn twice; leaving restores our laws | A settings screen for constants |

**Do not** write a new ruleset for any of them. Change what the arrival and
the objective *point at*.

### P6 — Idle must look like a world, not a rate

**Do**

- When an extractor is sited, the globe / side-on / neighbourhood should
  mark that patch (a glyph on the existing samples, not a new mesh).
- The topbar rate, if it includes extractors, should be expandable to
  “seams +X from *this* world” in the world panel (the panel already has
  the hook).
- Maturity is twenty minutes of play. Show it as a pit deepening or a
  yield climbing on *that* planet, not as a cache key.

**Do not**

- Debit upkeep from insight/s. Upkeep as a placement gate is the correct
  shape.
- Add another idle building that only exists as a number.

### P7 — Recognition is a hunt you can see

**Do**

- After an essence has been met twice, the objective may name it: “Cascade
  still has a blank axis. Find it in a cell, or in a filament.”
- Keep unrevealed axes as blanks, not hidden. That is already right.
- Foresight ghosts stay the reward. They should appear in the field the
  player is looking at, not only in a drawer.

**Do not**

- Autocomplete the codex. Insight cannot buy this pathway; that is the
  point.

### P8 — Camera literacy without a manual

**Do**

- The first time inhabiting a planet, the scene tag should look pressable
  and the objective may say “C switches SIDE-ON and MAP; the ground is the
  same.”
- Auto-switch at altitude 0.22 is fine if the tag *changes* in a way the
  eye catches (it already appends the mode). A one-shot toast is enough.

**Do not**

- Bind camera to the same tap as pulse.

---

## 4. Ideal loops, compressed

These are the loops the game should *feel* like it has. Most of the code for
them exists.

**Attunement (always on).** Sweep → still beat → hold → optional strike in
the window → crystallise → insight and a gnosis tick. Buy range/focus only
when a ghost or a missing band is on the strip.

**Place.** Descend → see a world you cannot touch → buy a body → stand on
legal ground → survey a patch → maybe extract, maybe site one extractor →
leave and scrub time.

**People.** See an amber or a named rumour → travel → lock the carrier →
wait until they notice you → listen / chart / teach. Uplift is a late, moral
choice, not a DPS increase.

**Inward / beyond.** Open the ladder with Σ range because a *place* was
named (a cell on this living world; a filament that has not collapsed yet),
not because a shop was empty.

**Recognition.** Pick one essence. Follow it. The blanks fill. The ghost
lands on the real window. You are playing by knowing.

If a session does not contain at least one of: a hold, a descent, or a
conversation, it was an idle session. Idle sessions should be rare and
short.

---

## 5. What “done as a game” looks like

The simulation is already complete (22 rungs, 12 layers, contact, bodies,
ensemble). The game is done when a player who never reads `README.md` can
still have this week:

| Session | They can tell someone afterwards |
|---|---|
| 1 | “I held a layer until it crystallised. The knob has weight.” |
| 2 | “I fell into a star system. I could not walk it until I bought legs.” |
| 3 | “I stood on a shore. I tapped the ground and it paid me for reading it.” |
| 4 | “I found somebody. I had to tune to them. They noticed me first.” |
| 5 | “Cascade does the same trick in a cell as it did in the sky.” |
| *later* | “I stood in a universe that was not ours. The essences did not care.” |

If they can only say “I bought range and the number went up,” the game is
still a shop wrapped around a thesis.

---

## 6. Working order for the next passes

A practical sequence that matches the above without exploding scope:

1. First-lock lesson (P0) — field spawn + first crystallise + on-world fine-control hint.
2. First-embark land (P2) — reticle / biome / swimmer offer.
3. Objective verbs (P1, P3) — name the control; name Locomotion on the globe.
4. First-contact findability (P4) — named amber, rumour as a map mark, awareness warmth.
5. Scope arrivals (P5) — point the objective at the only-here object.
6. Extractor as a mark on the world (P6).
7. Recognition hunt in the objective (P7).
8. Camera literacy toast (P8).

Stop after any of these if the hold feels worse. The hold getting better is
the regression test that `simtest.js` cannot write.
