# AGENTS.md

## Cursor Cloud specific instructions

The playable project lives in the `Resonant/` subdirectory, not the repository
root. Run all commands below from `Resonant/`.

Resonant is a single browser game: vanilla JS + Canvas2D + WebAudio with **zero
runtime dependencies, no `package.json`, and no build/bundler step**. The only
toolchain needed is Node (for the test suite and the single-file bundler) and
Python 3 (to serve the static files); both are preinstalled, so there is
nothing to install. See `Resonant/README.md` and `Resonant/HANDOFF.md` for the
authoritative developer guide.

Standard commands (run from `Resonant/`):

- Test: `node tools/simtest.js` — headless assertion suite (1650+ assertions,
  runs against the real modules under a `window` shim; takes ~25s). It must be
  green before committing. There is no separate lint step; this suite is the
  gate.
- Build: `node tools/build.mjs` — inlines everything into
  `dist/resonant.html`, one self-contained file. Not required to run the app.
- Run (dev): `python3 -m http.server 8000` then open
  `http://localhost:8000/index.html`. The app runs entirely client-side; there
  is no backend or database.

Developer cheat HUD (debug only):

- Enabled automatically on `localhost` / `127.0.0.1`, or with `?debug=1`, or
  when `localStorage.resonantDebug === '1'`.
- Press backtick (`` ` ``) to toggle the floating DEV panel. Grant Insight, max
  unlocks, jump scenes, snap φ to bands, apply presets, force-save, teleport
  lon/lat, dump the biome/elevation underfoot, and force planet camera mode
  (side-on / freeroam / globe) from there. Actions go through existing `RS.*`
  APIs (`js/debug.js`).

Planet cameras (while inhabiting): near-ground is the side-on slice; altitude
above ~0.22 is the 48×32 freeroam neighbourhood; observing is still the globe.
Cycle with the scene tag, `C`, or a tap on empty ground (AUTO → SIDE-ON → MAP).
The debug HUD can still force a mode, including globe. Sample counts are fixed
— do not grow them with zoom. No heightmaps: `effective = derived(address) ⊕
deltas`.

Non-obvious notes for developing/testing in the browser:

- The boot screen requires clicking `#btn-new` (the "BEGIN" button) to start a
  new game before anything is interactive.
- The live game object is exposed as `window.__RESONANT__` for scripted/manual
  driving (useful for Playwright-style testing, as noted in `HANDOFF.md`).
- Every new `js/*.js` module must be added in **both** `index.html` (script
  tags, load order matters) and the module list at the top of
  `tools/simtest.js`, or the suite/app will be out of sync.
- The game uses WebAudio; audio is synthesised at runtime (no asset files), so a
  headless/muted environment is fine for testing visuals and logic.
