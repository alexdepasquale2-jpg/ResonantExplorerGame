/* Resonant — planets as self-contained layers.
 *
 * A planet is one number (its mass) plus its orbit, put through a chain of
 * real physical relations until an entire world falls out the other end:
 *
 *   mass ─▶ radius ─▶ density ─▶ gravity ─▶ escape velocity
 *                                              │
 *   orbit + stellar flux ─▶ equilibrium temp ──┤
 *                                              ▼
 *                              which gases survive Jeans escape
 *                                              │
 *                                              ▼
 *                          pressure ─▶ greenhouse ─▶ surface temperature
 *                                              │
 *                                              ▼
 *                     liquid water? ─▶ biosphere ─▶ intelligence ─▶ economy
 *
 * Every arrow is a formula, so nothing about a world is stored and nothing is
 * arbitrary. A world is cold because it is far out or its star is dim; it has
 * no air because it is small and hot enough that hydrogen outran its gravity;
 * it has life because it held water long enough. The player can read the
 * causes off the effects, which is the entire reason to do it this way instead
 * of rolling on a table of planet types.
 *
 * Terrain is the same idea one level down: there is no heightmap. Elevation at
 * a coordinate is a noise field evaluated on demand, and biome is a function
 * of (elevation, latitude, temperature, moisture). A planet costs nothing
 * until you look at a specific piece of it, which is what makes descending to
 * a surface instant.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, invLerp, hashF, hashN, fbm, noise2, TAU } = RS.core;

  /* ── Mass–radius relations ────────────────────────────────────────────────
   * Three regimes, and the third is the interesting one: above roughly half a
   * Jupiter mass, electron degeneracy pressure means adding mass makes a
   * planet *smaller*, not bigger. So the largest planets are not the most
   * massive ones, which is real and consistently surprises people. */
  function radiusOf(massE, icy) {
    if (massE < 2) return Math.pow(massE, 0.27) * (icy ? 1.22 : 1);
    if (massE < 130) return Math.pow(massE, 0.59) * (icy ? 1.1 : 0.9);
    /* Degenerate regime: asymptotes to ~11–12 Earth radii and then shrinks. */
    const j = massE / 317.8;
    return 11.2 * Math.pow(j, -0.04) * (1 + 0.1 / (1 + j));
  }

  /* ── Atmospheric retention ────────────────────────────────────────────────
   * Jeans escape. A gas is retained over geological time if the escape
   * velocity comfortably exceeds the thermal velocity of its molecules — the
   * usual criterion is a factor of about six, because the Maxwell–Boltzmann
   * tail keeps leaking even well below escape speed.
   *
   * v_thermal = sqrt(3kT/m), which in convenient units is
   * 0.1574·sqrt(T/μ) km/s for molecular weight μ.
   */
  const GASES = [
    { id: 'H2', mu: 2, name: 'hydrogen', greenhouse: 0.0, lift: 1 },
    { id: 'He', mu: 4, name: 'helium', greenhouse: 0.0, lift: 0.9 },
    { id: 'CH4', mu: 16, name: 'methane', greenhouse: 0.9, lift: 0.4 },
    { id: 'H2O', mu: 18, name: 'water vapour', greenhouse: 1.0, lift: 0.35 },
    { id: 'N2', mu: 28, name: 'nitrogen', greenhouse: 0.02, lift: 0 },
    { id: 'O2', mu: 32, name: 'oxygen', greenhouse: 0.02, lift: 0 },
    { id: 'CO2', mu: 44, name: 'carbon dioxide', greenhouse: 0.75, lift: 0 },
    { id: 'SO2', mu: 64, name: 'sulphur dioxide', greenhouse: 0.6, lift: 0 }
  ];

  function thermalVelocity(T, mu) { return 0.1574 * Math.sqrt(T / mu); }

  function retains(vEsc, T, mu) { return vEsc > RS.physics.jeans() * thermalVelocity(T, mu); }

  /* ── Temperature ──────────────────────────────────────────────────────────
   * Equilibrium temperature from flux and albedo, then a greenhouse term.
   * 278.5 K is the equilibrium temperature of a zero-albedo body at 1 AU from
   * the Sun, which is the constant that makes the rest dimensionless. */
  function equilibriumTemp(flux, albedo) {
    return RS.physics.tEq1AU() * Math.pow(Math.max(1e-9, flux) * (1 - albedo), 0.25);
  }

  /* Greenhouse forcing. Saturating rather than linear, because doubling an
   * already-thick atmosphere adds much less than the first doubling did — but
   * it is allowed to run away, which is how Venus-analogues appear without
   * being special-cased. */
  function greenhouseFactor(pressure, opacity) {
    const tau = pressure * opacity;
    return 1 + RS.physics.greenhouseK() * Math.pow(tau, RS.physics.greenhouseP());
  }

  // ── the planet ───────────────────────────────────────────────────────────

  function planetAt(system, bodyIndex) {
    const body = system.bodies[bodyIndex];
    if (!body || body.kind !== 'planet') return null;
    const h = body.hash;
    const massE = body.massE;
    const a = body.a;
    const flux = RS.stellar.fluxAt(system, a);

    const icy = body.beyondFrost;
    const radiusE = radiusOf(massE, icy);
    /* Earth density is 5.51 g/cm³; density scales as M/R³ in Earth units. */
    const density = 5.51 * massE / Math.pow(radiusE, 3);
    const gravity = RS.orbital.surfaceGravity(massE, radiusE);
    const vEsc = RS.orbital.escapeVelocity(massE, radiusE);

    /* First pass with a provisional albedo, then recompute once the atmosphere
     * is known. Two passes is enough — the feedback converges fast and a third
     * would not move the classification. */
    const baseAlbedo = icy ? 0.5 : 0.18 + hashF(h, 30) * 0.2;
    let T = equilibriumTemp(flux, baseAlbedo);

    /* Which gases survive at that temperature. */
    const held = [];
    for (const g of GASES) if (retains(vEsc, T, g.mu)) held.push(g);

    /* Outgassing supplies the atmosphere: bigger and younger bodies vent more,
     * and a body needs internal heat to vent at all. Heat retention scales
     * with volume over surface area, i.e. with radius. */
    const heatRetention = clamp01(radiusE / 2.2);
    const age = system.primary.age;
    const outgassing = heatRetention * Math.exp(-age / 6) * (0.4 + hashF(h, 31) * 1.4);

    /* Hydrogen-dominated worlds are a different object: if the body kept H2 it
     * did not outgas an atmosphere, it captured one, and the pressure is
     * governed by its mass rather than its geology. */
    const heldH2 = held.some(g => g.id === 'H2');
    let pressure;
    if (heldH2 && massE > 8) {
      pressure = Math.pow(massE, 1.4);              // gas envelope, bar
    } else {
      const heavy = held.filter(g => g.mu >= 16);
      pressure = heavy.length === 0 ? 0
        : outgassing * Math.pow(massE, 0.9) * (0.15 + heavy.length * 0.35);
    }
    /* Solar wind strips thin atmospheres off close-in worlds entirely. */
    if (flux > 4 && pressure < 0.4) pressure *= clamp01(2 / flux);
    pressure = Math.max(0, pressure);

    /* Composition, weighted by what is available and what is retained. */
    const comp = composition(held, h, heldH2, massE, T);
    const opacity = comp.reduce((s, c) => s + c.frac * c.gas.greenhouse, 0);

    const albedo = clamp(
      pressure > 3 ? 0.55 : icy && T < 200 ? 0.62 : baseAlbedo + clamp01(pressure) * 0.1,
      0.04, 0.85);
    T = equilibriumTemp(flux, albedo);
    const surfaceTemp = T * greenhouseFactor(pressure, opacity);

    /* Water is the hinge. It needs to be liquid, which needs both temperature
     * and enough pressure that it does not sublimate straight to vapour. */
    const waterLiquid = surfaceTemp > 273 && surfaceTemp < 373 && pressure > 0.006;
    const iceWorld = surfaceTemp <= 273 && (icy || hashF(h, 33) > 0.4);
    /* How much water there ever was: bodies formed beyond the frost line got
     * far more, and small hot bodies lost what they had. */
    const waterBudget = clamp01((icy ? 0.55 : 0.10) + hashF(h, 34) * 0.5 - clamp01(flux / 12));
    const hydrosphere = waterLiquid ? waterBudget : 0;

    const type = classify(massE, radiusE, pressure, surfaceTemp, hydrosphere, iceWorld, heldH2, flux);

    /* Tidal locking: close-in worlds around small stars synchronise. The
     * timescale goes as a⁶, so this is effectively a hard threshold, and it is
     * why M-dwarf habitable worlds are almost all locked. */
    const lockRadius = 0.06 * Math.pow(system.primary.mass, 1 / 3) * Math.pow(age + 0.5, 1 / 6) * 3.2;
    const tidallyLocked = a < lockRadius;
    /* Rotation period in hours. Locked worlds rotate once per orbit. */
    const dayHours = tidallyLocked
      ? RS.orbital.period(a, system.primary.mass) * 8766
      : 4 + hashF(h, 36) * 60;

    const axialTilt = tidallyLocked ? 0 : hashF(h, 37) * 0.9;

    const planet = {
      system, bodyIndex, body, hash: h,
      name: RS.stellar.bodyName(system, bodyIndex),
      a, flux, massE, radiusE, density, gravity, vEsc,
      albedo, equilibriumTemp: T, surfaceTemp, pressure,
      composition: comp, opacity, held,
      waterLiquid, hydrosphere, iceWorld, waterBudget,
      type, tidallyLocked, dayHours, axialTilt, age,
      /* Tectonics needs internal heat and enough mass to keep a mantle
       * convecting; it is what makes a world's surface young. */
      tectonics: clamp01(heatRetention * Math.exp(-age / 8) * (massE > 0.4 ? 1 : 0.2)),
      magnetosphere: clamp01(heatRetention * (massE > 0.5 ? 1 : 0.25) * (1 / (1 + a * 0.1)) * (dayHours < 100 ? 1 : 0.2)),
      /* Impact cratering accumulates with age and is erased by tectonics and
       * atmosphere, so surface appearance follows from history. */
      cratering: clamp01(age / 8 * (1 - clamp01(pressure)) * (1 - 0.8 * heatRetention))
    };

    /* Order matters: habitability gates the biosphere, and the biosphere feeds
     * back into the resource profile (a living world accumulates organics), so
     * resources must be derived last. */
    planet.habitability = habitabilityOf(planet);
    planet.biosphere = RS.civ ? RS.civ.biosphereOf(planet) : null;
    planet.resources = resourcesOf(planet);
    planet.moons = moonsOf(planet);
    /* A biosphere that learned photosynthesis rewrites its own atmosphere.
     * Free oxygen is a biosignature, so this is the one place composition is
     * revised after the fact — and it is what makes an inhabited world
     * detectable from orbit before you ever land on it. */
    if (planet.biosphere && planet.biosphere.oxygenation > 0.15) {
      RS.civ.oxygenate(planet);
    }
    return planet;
  }

  /* Atmospheric composition as fractions. Not a lookup — the fractions come
   * from what the body could hold, weighted by cosmic abundance. */
  function composition(held, h, heldH2, massE, T) {
    if (!held.length) return [];
    const weights = held.map((g, i) => {
      let w = 1 / Math.sqrt(g.mu);          // lighter gases are more abundant
      if (g.id === 'H2') w *= heldH2 && massE > 8 ? 30 : 0.2;
      if (g.id === 'He') w *= heldH2 && massE > 8 ? 8 : 0.2;
      if (g.id === 'N2') w *= 2.2;
      /* Free oxygen does not accumulate abiotically — it is nearly always a
       * biosignature, so it stays vanishingly rare here and civ.js adds it
       * when a biosphere actually produces it. */
      if (g.id === 'O2') w *= 0.02;
      if (g.id === 'H2O') w *= T > 273 ? 1.4 : 0.15;
      if (g.id === 'CO2') w *= 3.0;
      return w * (0.5 + hashF(h, 60 + i) * 1.0);
    });
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    return held.map((g, i) => ({ gas: g, frac: weights[i] / total }))
      .filter(c => c.frac > 0.005)
      .sort((a, b) => b.frac - a.frac);
  }

  const TYPES = {
    gasGiant: { name: 'Gas Giant', hue: 32, landable: false },
    iceGiant: { name: 'Ice Giant', hue: 195, landable: false },
    hotJupiter: { name: 'Hot Jupiter', hue: 12, landable: false },
    miniNeptune: { name: 'Mini-Neptune', hue: 178, landable: false },
    chthonian: { name: 'Chthonian', hue: 8, landable: true },
    lava: { name: 'Lava World', hue: 16, landable: true },
    desert: { name: 'Desert World', hue: 38, landable: true },
    greenhouse: { name: 'Greenhouse World', hue: 46, landable: true },
    terran: { name: 'Terran World', hue: 130, landable: true },
    ocean: { name: 'Ocean World', hue: 200, landable: true },
    tundra: { name: 'Tundra World', hue: 168, landable: true },
    iceball: { name: 'Ice World', hue: 190, landable: true },
    barren: { name: 'Barren World', hue: 30, landable: true }
  };

  function classify(massE, radiusE, pressure, T, hydro, icy, heldH2, flux) {
    if (heldH2 && massE > 8) {
      if (T > 900) return TYPES.hotJupiter;
      if (massE > 60) return TYPES.gasGiant;
      if (massE > 14) return TYPES.iceGiant;
      return TYPES.miniNeptune;
    }
    if (T > 1200) return TYPES.lava;
    if (T > 700) return pressure < 0.05 ? TYPES.chthonian : TYPES.greenhouse;
    if (pressure < 0.005) return T < 150 ? TYPES.iceball : TYPES.barren;
    if (T > 400) return TYPES.greenhouse;
    if (hydro > 0.75) return TYPES.ocean;
    if (hydro > 0.12) return T < 288 ? TYPES.tundra : TYPES.terran;
    if (T < 240) return TYPES.iceball;
    return TYPES.desert;
  }

  /* A single 0..1 index, built from independent factors that each have to be
   * satisfied — multiplied, not averaged, so one fatal problem is fatal.
   *
   * The two tolerances are set from what life actually needs rather than from
   * what a mean surface temperature reads:
   *
   *   58 K on temperature, because a habitability index keyed to a *global
   *   mean* has to tolerate the spread around it. Earth's surface spans
   *   roughly 180–330 K regionally while averaging 288 K, and life occupies
   *   most of that; a narrow window would rule out worlds whose temperate belt
   *   is perfectly liveable.
   *
   *   ×5 on hydrosphere, so a fifth of the surface being ocean counts as fully
   *   watered. Earth is 0.71 and nothing about it is five times more habitable
   *   than a world at 0.2 — beyond a modest fraction, more ocean stops adding
   *   habitability and starts subtracting land.
   *
   * These are load-bearing for the whole solar layer: a galaxy-wide census
   * (simtest) puts life in ~16% of systems, complex ecologies in one system in
   * ~34, and civilisations in one in ~190. Tightening either tolerance empties
   * the galaxy; loosening them makes contact routine. */
  function habitabilityOf(p) {
    if (!p.type.landable) return 0;
    const temp = Math.exp(-Math.pow((p.surfaceTemp - 288) / RS.physics.habSigma(), 2));
    const grav = Math.exp(-Math.pow((p.gravity - 1) / 0.85, 2));
    const press = p.pressure < 0.02 ? 0 : Math.exp(-Math.pow(Math.log(p.pressure / 1.0) / 1.5, 2));
    const water = clamp01(p.hydrosphere * RS.physics.waterWeight());
    const shield = 0.3 + 0.7 * p.magnetosphere;
    return clamp01(temp * grav * press * water * shield);
  }

  /* ── Resources ────────────────────────────────────────────────────────────
   * Abundances follow from where and when the body formed: refractories
   * condensed close in, volatiles only beyond the frost line, and heavy
   * elements track the star's metallicity because they were made in earlier
   * stellar generations. These feed the economy directly. */
  const RESOURCE_KINDS = [
    { id: 'metals', name: 'Metals', hue: 30 },
    { id: 'silicates', name: 'Silicates', hue: 40 },
    { id: 'volatiles', name: 'Volatiles', hue: 190 },
    { id: 'organics', name: 'Organics', hue: 130 },
    { id: 'rareEarths', name: 'Rare Earths', hue: 285 },
    { id: 'fissiles', name: 'Fissiles', hue: 100 },
    { id: 'exotics', name: 'Exotics', hue: 320 }
  ];

  function resourcesOf(p) {
    const h = p.hash;
    const Z = p.system.primary.metallicity;
    const cold = p.body.beyondFrost ? 1 : 0;
    const diff = clamp01(p.massE / 3);   // differentiation concentrates metals in big bodies
    const out = {};
    out.metals = clamp01((0.25 + Z * 0.35) * (1 - cold * 0.45) * (0.5 + diff) * (0.6 + hashF(h, 70) * 0.9));
    out.silicates = clamp01((0.55 - cold * 0.3) * (0.7 + hashF(h, 71) * 0.7));
    out.volatiles = clamp01((0.08 + cold * 0.7) * (0.6 + hashF(h, 72) * 0.8) + p.hydrosphere * 0.3);
    out.organics = clamp01(p.hydrosphere * 0.6 + cold * 0.25 * hashF(h, 73) + (p.biosphere ? 0.4 : 0));
    out.rareEarths = clamp01(Z * 0.3 * diff * (0.3 + hashF(h, 74) * 1.4));
    out.fissiles = clamp01(Z * 0.22 * diff * Math.exp(-p.age / 9) * (0.3 + hashF(h, 75) * 1.5));
    /* Exotics only exist where extreme conditions made them — deep gravity
     * wells, extreme cold, or high radiation. They are the reason to go
     * somewhere hostile. */
    out.exotics = clamp01(
      (p.gravity > 2.4 ? 0.35 : 0) + (p.surfaceTemp < 60 ? 0.3 : 0) +
      (p.flux > 20 ? 0.25 : 0) + hashF(h, 76) * 0.15);
    return out;
  }

  /* ── Moons ────────────────────────────────────────────────────────────────
   * Constrained by the Hill sphere on the outside and the Roche limit on the
   * inside, so moon systems come out with the right shape without being tuned:
   * giants get many, small worlds get none, and anything inside the Roche
   * limit is a ring instead. */
  function moonsOf(p) {
    const h = p.hash;
    const hill = RS.orbital.hillRadius(p.a, p.body.elements.e,
      p.massE / RS.stellar.EARTH_MASSES_PER_SOLAR, p.system.primary.mass);
    const planetRadiusAU = p.radiusE * 4.2635e-5;
    const roche = RS.orbital.rocheLimit(planetRadiusAU, 1.5);

    const capacity = Math.log10(Math.max(1, p.massE)) * 2.6;
    const n = Math.min(9, Math.floor(capacity * (0.4 + hashF(h, 80) * 1.2)));
    const moons = [];
    let ma = roche * (1.15 + hashF(h, 81) * 0.9);
    for (let i = 0; i < n && ma < hill * 0.45; i++) {
      const mh = hashN(h, 400 + i);
      const mMass = p.massE * (0.0001 + hashF(mh, 1) * 0.02);
      moons.push({
        index: i, hash: mh,
        massE: mMass,
        radiusE: radiusOf(mMass, p.body.beyondFrost),
        a: ma,
        name: p.name + ' ' + String.fromCharCode(97 + i),
        elements: RS.orbital.elementsFrom(mh, ma,
          p.massE / RS.stellar.EARTH_MASSES_PER_SOLAR, { eMax: 0.06, iMax: 0.12 }),
        /* Tidal heating from a close, eccentric orbit around a massive primary
         * — the Europa/Io mechanism, and the reason a moon far outside the
         * habitable zone can still hold a subsurface ocean. */
        tidalHeat: clamp01((roche * 3 / ma) * p.massE / 60)
      });
      ma *= 1.5 + hashF(mh, 2) * 1.1;
    }
    /* Rings: material that never coalesced because it sits inside the Roche
     * limit. Massive planets with debris get them; small ones do not. */
    const hasRings = p.massE > 25 && hashF(h, 85) > 0.55;
    return {
      list: moons, hill, roche,
      rings: hasRings ? { inner: planetRadiusAU * 1.4, outer: roche * 0.98, opacity: 0.3 + hashF(h, 86) * 0.6 } : null
    };
  }

  /* ── Terrain ──────────────────────────────────────────────────────────────
   * No heightmap exists. Elevation is a noise field evaluated at the exact
   * coordinate asked for, which means a planet is instantly available at any
   * zoom, costs nothing until sampled, and is identical every time.
   *
   * The field is shaped by the planet's own physics: tectonics sets relief,
   * cratering adds impact basins, hydrosphere sets sea level. So terrain is
   * downstream of the same causal chain as everything else. */
  function elevationAt(p, lon, lat) {
    const h = p.hash;
    /* Sample on a sphere so nothing seams at the antimeridian or pinches at
     * the poles — a flat lon/lat noise lookup does both. */
    const cl = Math.cos(lat);
    const x = Math.cos(lon) * cl, y = Math.sin(lon) * cl, z = Math.sin(lat);
    const s = 2.4;

    /* Continents: low frequency, high amplitude, scaled by tectonic activity.
     * A dead world is smooth; an active one is mountainous. */
    let e = fbm(h, x * s + 11, y * s + 7, 5) * 2 - 1;
    e += (fbm(h ^ 0x77, y * s * 2.7 + 3, z * s * 2.7 + 5, 4) * 2 - 1) * 0.45;
    e *= 0.35 + p.tectonics * 0.95;

    /* Ridges: absolute-valued noise gives sharp crests rather than rolling
     * hills, which is what makes mountain ranges look like ranges. */
    const ridge = 1 - Math.abs(fbm(h ^ 0x1234, z * s * 3.1, x * s * 3.1, 4) * 2 - 1);
    e += ridge * ridge * p.tectonics * 0.55;

    /* Craters, on old dead surfaces. */
    if (p.cratering > 0.05) {
      const c = fbm(h ^ 0xC4A7, x * s * 6.5, y * s * 6.5, 3);
      e -= Math.pow(clamp01(c), 3) * p.cratering * 0.5;
    }
    return e;
  }

  /* Elevation including small-scale roughness.
   *
   * `elevationAt` is a *planetary* field: its features have wavelengths of
   * tenths of a radian, which is right for a globe and useless for standing on.
   * A walker sees maybe a hundredth of a radian of surface, over which the
   * planetary field is essentially a straight line — which is exactly what the
   * surface view looked like: a flat wall.
   *
   * So the surface adds octaves at metre-to-kilometre wavelengths on top. They
   * are strictly additive detail: they never move the planetary elevation
   * enough to change a biome or a coastline, so the globe and the ground still
   * agree about where the mountains and oceans are. Amplitude follows the
   * world's own tectonics and cratering, so a dead smooth world really is
   * smooth underfoot and an active one is broken ground. */
  function elevationDetailAt(p, lon, lat) {
    const base = elevationAt(p, lon, lat);
    const rough = 0.25 + p.tectonics * 0.9 + p.cratering * 0.5;
    /* Three bands, each an order of magnitude finer than the last: hills,
     * boulders, then the texture underfoot. */
    let d = 0;
    d += (fbm(p.hash ^ 0xD37A, lon * 42, lat * 42 + 5, 3) * 2 - 1) * 0.085;
    d += (fbm(p.hash ^ 0xB017, lon * 190, lat * 190 + 11, 2) * 2 - 1) * 0.028;
    d += (fbm(p.hash ^ 0x51CE, lon * 880, lat * 880 + 3, 2) * 2 - 1) * 0.008;
    /* Wind and water smooth things out; airless worlds keep their sharp edges. */
    const erosion = 1 / (1 + p.pressure * 0.35 + p.hydrosphere * 0.6);
    return base + d * rough * erosion;
  }

  /* Sea level, set so that the hydrosphere fraction of the surface is covered.
   * Derived from the water budget rather than picked, so an ocean world really
   * is nearly all ocean.
   *
   * A waterless world returns a large negative sentinel so that `elev < sea`
   * is never true and no ocean is ever drawn. That sentinel is *only* valid as
   * a comparison bound — see `datum` below. */
  function seaLevel(p) {
    return p.hydrosphere <= 0 ? -99 : lerp(0.55, -0.75, clamp01(p.hydrosphere));
  }

  /* The altitude reference for anything that measures *height above* the
   * surface: the atmospheric lapse rate, and relief shading.
   *
   * This exists because using seaLevel() for that is a trap, and one this code
   * fell into: on a dry world seaLevel is −99, so `elev − seaLevel` is about
   * 99, and the lapse rate then subtracts several thousand kelvin from every
   * dry surface on every planet. It turned 640 K greenhouse worlds into ice
   * sheets, silently, everywhere — the bug was invisible because the *global*
   * temperature stayed correct and only local samples were wrong.
   *
   * On a world with an ocean the datum is sea level; on a dry world it is the
   * mean radius, which is what a planetary scientist would use anyway. */
  function datum(p) {
    return p.hydrosphere > 0 ? seaLevel(p) : 0;
  }

  const BIOMES = [
    { id: 'ocean', name: 'Ocean', hue: 205, sat: 0.62, lum: 0.28 },
    { id: 'shallows', name: 'Shallows', hue: 186, sat: 0.62, lum: 0.42 },
    { id: 'ice', name: 'Ice Sheet', hue: 195, sat: 0.16, lum: 0.86 },
    { id: 'tundra', name: 'Tundra', hue: 150, sat: 0.20, lum: 0.48 },
    { id: 'taiga', name: 'Taiga', hue: 148, sat: 0.38, lum: 0.30 },
    { id: 'forest', name: 'Forest', hue: 122, sat: 0.44, lum: 0.31 },
    { id: 'jungle', name: 'Jungle', hue: 108, sat: 0.56, lum: 0.27 },
    { id: 'grass', name: 'Grassland', hue: 88, sat: 0.40, lum: 0.42 },
    { id: 'savanna', name: 'Savanna', hue: 62, sat: 0.44, lum: 0.48 },
    { id: 'desert', name: 'Desert', hue: 42, sat: 0.50, lum: 0.58 },
    { id: 'badlands', name: 'Badlands', hue: 22, sat: 0.42, lum: 0.40 },
    { id: 'regolith', name: 'Regolith', hue: 35, sat: 0.10, lum: 0.42 },
    { id: 'lava', name: 'Lava Field', hue: 14, sat: 0.85, lum: 0.42 },
    { id: 'mountain', name: 'Mountain', hue: 30, sat: 0.10, lum: 0.55 },
    { id: 'crystal', name: 'Crystal Flats', hue: 290, sat: 0.45, lum: 0.55 }
  ];
  const BIOME_BY_ID = Object.create(null);
  BIOMES.forEach((b, i) => { b.index = i; BIOME_BY_ID[b.id] = b; });

  /* Local temperature: global surface temperature, modified by latitude
   * (insolation falls with cos(lat)), altitude (lapse rate), and — for a
   * tidally locked world — by longitude, because one hemisphere never sees its
   * star. Locked worlds therefore get a genuinely different climate map with a
   * habitable terminator ring, and that falls out of the same formula. */
  function temperatureAt(p, lon, lat, elev) {
    let insolation;
    if (p.tidallyLocked) {
      /* Substellar point at lon 0. */
      const sub = Math.cos(lon) * Math.cos(lat);
      insolation = clamp01(sub) * 1.5 + 0.06;
    } else {
      insolation = Math.cos(lat) * 0.85 + 0.28;
    }
    /* Thick atmospheres transport heat and flatten the gradient — which is why
     * Venus is nearly isothermal and Mars is not. */
    const mixing = clamp01(p.pressure / 4);
    insolation = lerp(insolation, 1, mixing);
    const T = p.surfaceTemp * Math.pow(clamp(insolation, 0.02, 3), 0.25);
    const above = Math.max(0, elev - datum(p));
    /* Lapse rate scales with gravity and inversely with atmosphere. */
    return T - above * 55 * p.gravity / (1 + p.pressure * 0.5);
  }

  function moistureAt(p, lon, lat, elev) {
    if (p.hydrosphere <= 0) return 0;
    const cl = Math.cos(lat);
    const x = Math.cos(lon) * cl, y = Math.sin(lon) * cl, z = Math.sin(lat);
    const base = fbm(p.hash ^ 0x9157, x * 3.4 + 2, y * 3.4 + 9, 4);
    /* Closer to the datum and closer to water means wetter; high ground in a
     * continental interior is dry. */
    const proximity = clamp01(1 - (elev - datum(p)) * 1.6);
    return clamp01(base * 0.55 + proximity * 0.55) * clamp01(p.hydrosphere * 2.2);
  }

  function biomeAt(p, lon, lat) {
    const elev = elevationAt(p, lon, lat);
    const sea = seaLevel(p);
    const T = temperatureAt(p, lon, lat, elev);
    const M = moistureAt(p, lon, lat, elev);

    if (p.type === TYPES.lava) return { biome: BIOME_BY_ID.lava, elev, T, M };
    if (elev < sea) {
      if (T < 265) return { biome: BIOME_BY_ID.ice, elev, T, M };
      return { biome: elev < sea - 0.22 ? BIOME_BY_ID.ocean : BIOME_BY_ID.shallows, elev, T, M };
    }
    if (T > 1000) return { biome: BIOME_BY_ID.lava, elev, T, M };
    if (T < 250) return { biome: BIOME_BY_ID.ice, elev, T, M };
    if (elev > sea + 0.62) return { biome: BIOME_BY_ID.mountain, elev, T, M };
    if (p.pressure < 0.02) {
      /* No air: no weather, no biomes — just regolith, and crystal flats where
       * exotic chemistry had a chance. */
      return { biome: p.resources.exotics > 0.6 && ((lon * 7 + lat * 5) % 1.7) > 1.3
        ? BIOME_BY_ID.crystal : BIOME_BY_ID.regolith, elev, T, M };
    }
    if (M < 0.12) return { biome: T > 320 ? BIOME_BY_ID.desert : BIOME_BY_ID.badlands, elev, T, M };
    if (T < 273) return { biome: M > 0.4 ? BIOME_BY_ID.taiga : BIOME_BY_ID.tundra, elev, T, M };
    if (T > 305) return { biome: M > 0.6 ? BIOME_BY_ID.jungle : M > 0.3 ? BIOME_BY_ID.savanna : BIOME_BY_ID.desert, elev, T, M };
    return { biome: M > 0.55 ? BIOME_BY_ID.forest : BIOME_BY_ID.grass, elev, T, M };
  }

  /* Aggregate surface statistics, sampled rather than integrated. A coarse
   * Fibonacci-sphere sample gives a good estimate of biome fractions for a few
   * hundred evaluations, which is cheap enough to do when a planet is first
   * inspected and never again. */
  function survey(p, samples) {
    const n = samples || 240;
    const counts = Object.create(null);
    let land = 0, hab = 0;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const lat = Math.asin(2 * (i + 0.5) / n - 1);
      const lon = (i * golden) % TAU;
      const r = biomeAt(p, lon, lat);
      counts[r.biome.id] = (counts[r.biome.id] || 0) + 1;
      if (r.elev >= seaLevel(p)) land++;
      if (r.T > 260 && r.T < 320 && r.M > 0.15) hab++;
    }
    const out = [];
    for (const k in counts) out.push({ biome: BIOME_BY_ID[k], frac: counts[k] / n });
    out.sort((a, b) => b.frac - a.frac);
    return { biomes: out, landFraction: land / n, temperateFraction: hab / n };
  }

  RS.planet = {
    GASES, TYPES, BIOMES, BIOME_BY_ID, RESOURCE_KINDS,
    radiusOf, thermalVelocity, retains, equilibriumTemp, greenhouseFactor,
    planetAt, classify, habitabilityOf, resourcesOf, moonsOf,
    elevationAt, elevationDetailAt, seaLevel, datum, temperatureAt, moistureAt, biomeAt, survey
  };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
