/* Resonant — time you can feel standing in it.
 *
 * ── What was already true, and invisible ──────────────────────────────────
 *
 * `planet.js` has derived `dayHours`, `axialTilt`, `tidallyLocked` and a full
 * list of `moons` with real orbital periods since the solar layer landed. Every
 * one of those numbers was correct, none of them was rendered, and the surface
 * looked the same at every hour of every day of every year on every world.
 *
 * A tidally locked world is the clearest case. Half of it never sees the star
 * and half of it never stops seeing it — that is the single most important fact
 * about the most common kind of habitable world in the real galaxy, the game
 * knew it, and standing on one looked exactly like standing on Earth.
 *
 * ── What this file does ───────────────────────────────────────────────────
 *
 * Turns those numbers into a sun angle, a season, and a tide, all closed-form
 * in (planet, longitude, latitude, epoch). Nothing is integrated and nothing is
 * stored, so scrubbing τ across a thousand years costs exactly what standing
 * still costs.
 *
 * The interesting consequence is that τ acquires a second meaning on a surface
 * without gaining a second control: unembodied it already scrubs history, and
 * now that scrub visibly runs the day. Watching a tidally locked world's
 * terminator *not move* while a fast rotator strobes through fifty days is the
 * kind of thing that teaches a fact permanently.
 */
(function (RS) {
  'use strict';
  const { clamp, clamp01, lerp, TAU } = RS.core;

  const HOURS_PER_YEAR = 8766;   // 365.25 × 24

  /* ── Where the star is ────────────────────────────────────────────────────
   *
   * Returns the star's elevation above the horizon at this place and time, as a
   * signed cosine: +1 overhead, 0 at the horizon, −1 antipodal. Everything the
   * renderer needs follows from that one number.
   */
  function sunAt(p, lonDeg, latDeg, epochYears, out) {
    const o = out || {};
    const lat = latDeg * Math.PI / 180;

    /* Season. The declination of the star swings between ±tilt over a year,
     * which is what a season *is* — and a world with no tilt has no seasons,
     * which is why a tidally locked one is the same forever. */
    const yearPhase = (epochYears % 1 + 1) % 1;
    const decl = p.axialTilt * Math.sin(yearPhase * TAU);

    let hourAngle, dayFrac;
    if (p.tidallyLocked) {
      /* No rotation relative to the star. The hour angle is simply the
       * longitude: the substellar point is fixed at 0°, the antistellar point
       * at 180°, and the terminator is a permanent line of dusk that a
       * civilisation would build along. Time of day does not exist here. */
      hourAngle = lonDeg * Math.PI / 180;
      dayFrac = 0;
    } else {
      /* Real rotation. `dayHours` is derived from the world's own spin, so a
       * fast rotator genuinely strobes and a slow one crawls. */
      const hours = Math.max(0.05, p.dayHours);
      const elapsed = epochYears * HOURS_PER_YEAR;
      dayFrac = ((elapsed / hours) % 1 + 1) % 1;
      hourAngle = (dayFrac * TAU) + lonDeg * Math.PI / 180;
    }

    /* Standard solar elevation. This is the actual formula, not an
     * approximation of it — it costs one sin and two cos. */
    const elev = Math.sin(lat) * Math.sin(decl) +
      Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);

    o.elevation = clamp(elev, -1, 1);
    o.declination = decl;
    o.hourAngle = hourAngle;
    o.dayFrac = dayFrac;
    o.yearPhase = yearPhase;
    o.locked = !!p.tidallyLocked;
    /* Daylight, softened through the terminator: a thick atmosphere scatters
     * light around the limb, so a dense world has a long twilight and an airless
     * one snaps from noon to night. Real, and it is why the Moon has no dusk. */
    const soft = 0.04 + clamp01(p.pressure * 0.5) * 0.30;
    o.daylight = clamp01((o.elevation + soft) / (soft * 2));
    /* Where in the day, named. A tidally locked world gets a *place* name
     * instead, because it does not have times of day. */
    o.phase = o.locked
      ? (o.elevation > 0.55 ? 'substellar' : o.elevation > 0.05 ? 'day side'
        : o.elevation > -0.15 ? 'terminator' : 'night side')
      : (o.daylight > 0.92 ? 'midday' : o.daylight > 0.55 ? 'afternoon'
        : o.daylight > 0.12 ? 'twilight' : o.daylight > 0.02 ? 'dusk' : 'night');
    return o;
  }

  /* Season as a name, from the declination against this hemisphere. A world
   * with a tilt under about 5° does not really have them, and says so. */
  function seasonOf(p, latDeg, sun) {
    if (p.tidallyLocked || p.axialTilt < 0.09) return 'no seasons';
    const north = latDeg >= 0;
    const d = north ? sun.declination : -sun.declination;
    const peak = p.axialTilt;
    if (d > peak * 0.55) return 'high summer';
    if (d > peak * 0.15) return 'summer';
    if (d < -peak * 0.55) return 'deep winter';
    if (d < -peak * 0.15) return 'winter';
    return sun.yearPhase < 0.5 ? 'spring' : 'autumn';
  }

  /* ── Tides ────────────────────────────────────────────────────────────────
   *
   * The sum over moons of (mass / distance³), which is the actual tidal scaling
   * — and it is cubic rather than square, which is why a close small moon beats
   * a distant large one and why a world with four moons has a genuinely messy
   * tide rather than a bigger one.
   */
  function tideAt(p, epochYears, out) {
    const o = out || {};
    const moons = p.moons && p.moons.list;
    if (!moons || !moons.length) { o.height = 0; o.count = 0; o.spring = false; return o; }

    let sum = 0, maxOne = 0;
    /* Vector sum of the bulge directions, so two moons on opposite sides
     * partially cancel — the difference between a spring and a neap tide, which
     * is a real thing a player standing on a beach could notice. */
    let vx = 0, vy = 0;
    const planetMassSolar = p.massE / RS.stellar.EARTH_MASSES_PER_SOLAR;
    for (let i = 0; i < moons.length; i++) {
      const m = moons[i];
      /* Period is years (Kepler). Used to treat a missing period as 1 and then
       * multiply by 365.25, which made every moon a one-day clock. */
      const per = Math.max(1e-6, m.period || RS.orbital.period(m.a || 0.002, planetMassSolar));
      const ang = (epochYears / per) * TAU;
      const pull = (m.massE || 0.01) / Math.pow(Math.max(0.001, m.a || 0.002), 3) * 1e-9;
      sum += pull;
      if (pull > maxOne) maxOne = pull;
      vx += Math.cos(ang * 2) * pull;
      vy += Math.sin(ang * 2) * pull;
    }
    const coherent = Math.hypot(vx, vy);
    o.count = moons.length;
    o.height = clamp01(sum * 0.5);
    /* Aligned: the bulges reinforce. This is a spring tide, and on a world with
     * several moons it is rare and worth being somewhere else for. */
    o.alignment = sum > 0 ? clamp01(coherent / sum) : 0;
    o.spring = o.alignment > 0.82 && moons.length > 1;
    o.phase = Math.atan2(vy, vx);
    return o;
  }

  /* Instantaneous waterline at a longitude. Draw and collision sample only —
   * hydrosphere and `seaLevel` stay the derived constants they always were. */
  function waterlineAt(p, lon, epochYears) {
    const sea = RS.planet.seaLevel(p);
    if (p.hydrosphere <= 0) return sea;
    const tide = tideAt(p, epochYears || 0);
    /* k is small so a spring tide wets the beach without drowning a continent. */
    return sea + 0.055 * tide.height * Math.cos((tide.phase || 0) + lon);
  }

  /* Everything at once, for the readout and the renderer. One call per frame. */
  function stateFor(game, out) {
    const s = game.scene;
    const p = s.planet;
    const o = out || {};
    if (!p) { o.ok = false; return o; }
    o.ok = true;
    o.sun = sunAt(p, s.lon || 0, s.lat || 0, s.t || 0, o.sun);
    o.season = seasonOf(p, s.lat || 0, o.sun);
    o.tide = tideAt(p, s.t || 0, o.tide);
    o.dayHours = p.dayHours;
    o.locked = !!p.tidallyLocked;
    return o;
  }

  /* A one-line description, which is what the readout wants. */
  function describe(st) {
    if (!st || !st.ok) return '';
    const bits = [st.sun.phase];
    if (!st.locked) {
      bits.push(st.dayHours < 48
        ? st.dayHours.toFixed(1) + ' h day'
        : (st.dayHours / 24).toFixed(0) + ' d day');
    } else {
      bits.push('tidally locked');
    }
    if (st.season !== 'no seasons') bits.push(st.season);
    if (st.tide.count) {
      bits.push(st.tide.count + ' moon' + (st.tide.count > 1 ? 's' : '') +
        (st.tide.spring ? ' · spring tide' : ''));
    }
    return bits.join(' · ');
  }

  RS.localtime = { HOURS_PER_YEAR, sunAt, seasonOf, tideAt, waterlineAt, stateFor, describe };
})(typeof window !== 'undefined' ? (window.RS = window.RS || {}) : (globalThis.RS = globalThis.RS || {}));
