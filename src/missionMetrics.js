/**
 * Artemis Lunar Landing Site Navigator - Mission Metrics (Step 5)
 *
 * Pure functions, NO DOM. Everything here is computed from the ephemeris and a horizon
 * profile; nothing is hand-written telemetry.
 *
 * CONVENTIONS
 *  - Angles in degrees at every public boundary; radians only inside formulas.
 *  - Azimuth: degrees clockwise from local North (same as computeTopocentricHorizon).
 *  - Panel tilt beta: degrees from horizontal (0 = flat, facing zenith; 90 = vertical).
 *  - Panel azimuth az_panel: direction the panel normal leans toward, same convention as Sun azimuth.
 *  - Distances: ephemeris gives km. Only FSPL converts to metres (d in m, f in Hz).
 *  - Energy in Wh, power in W, areas in m^2, time step dt in hours.
 *
 * MODEL DECISIONS (agreed with the product owner)
 *  - I(t) and C(t) are BINARY and CENTRE-POINT (as in the architecture PDF): the Sun/Earth
 *    disc centre is either above the local horizon mask or not. The extended-disc fraction
 *    used elsewhere in the app (horizon.js) is deliberately NOT used here.
 *  - "Best" panel = best FIXED tilt/azimuth per region over the evaluation window. No sun tracking.
 *  - Mast height defaults to 10 m for Comparison. User panel settings never feed Comparison.
 *
 * FORMULAS
 *   cos(theta_inc) = sin(a_sun)*cos(beta) + cos(a_sun)*sin(beta)*cos(az_sun - az_panel)
 *   S(t)           = 1361 W/m^2 * (1 AU / d_sun)^2                      [d_sun from ephemeris]
 *   I(t)           = 1 if a_sun   > theta_horizon(az_sun)   else 0
 *   P_gen(t)       = I(t) * A_panel * eta_solar * S(t) * max(0, cos(theta_inc))        [W]
 *   C(t)           = 1 if a_earth > theta_horizon(az_earth) else 0
 *   DeltaT_comm    = sum C(t)*dt                                        [h]
 *   FSPL_dB        = 20*log10(d_m) + 20*log10(f_Hz) - 147.55            [d in m, f in Hz]
 *   E              = sum P_gen(t)*dt                                    [Wh]
 *
 * SAMPLING
 *  Each sample i stands for the interval [t0 + i*dt, t0 + (i+1)*dt). With N = window/dt samples
 *  the window is covered exactly once (no extra end-point sample), so sum(flag)*dt <= window.
 *  Runs touching either window edge are reported with a *TouchesStart / *TouchesEnd flag because
 *  their true length is only a lower bound.
 *
 * CACHING
 *  - Moon-fixed Sun/Earth vectors are site-independent: computed ONCE per (start, window, step).
 *  - Per-region geometry (topocentric az/el, I, C, S, best fixed panel) is cached per
 *    (region id, lat, lon, mast height, start, window, step). Panel area and efficiency only
 *    scale power linearly, so they are applied afterwards and never invalidate the cache.
 *  - Nothing here should be called per animation frame: look samples up by index instead.
 */

import * as Astronomy from 'astronomy-engine';
import { computeEphemeris, sphericalToCartesian } from './ephemeris.js';
import { sampleHorizonMask, DEFAULT_MAST_HEIGHT_M } from './horizon.js';
import { LUNAR_RADIUS_KM } from './terrain.js';

// ---------------------------------------------------------------------------------------------
// Constants (named, so Phase 9 UI and Phase 10 Comparison share one source of truth)
// ---------------------------------------------------------------------------------------------
export const SOLAR_CONSTANT_W_M2 = 1361; // W/m^2 at 1 AU
export const AU_KM = 149597870.7; // 1 AU in km
export const SYNODIC_MONTH_DAYS = 29.530588;

export const DEFAULT_PANEL_AREA_M2 = 10; // A_panel
export const DEFAULT_SOLAR_EFFICIENCY = 0.29; // eta_solar
export { DEFAULT_MAST_HEIGHT_M }; // 10 m, defined in horizon.js; fixed for all Comparison calculations
export const DEFAULT_FREQUENCY_HZ = 8.4e9; // X-band

// Battery sizing defaults (Phase 9; all editable in the Advanced section)
export const DEFAULT_P_BASE_W = 40; // baseline platform load
export const DEFAULT_P_HEATER_W = 60; // survival heater load during the dark period
export const DEFAULT_DEPTH_OF_DISCHARGE = 0.8; // DoD
export const DEFAULT_BATTERY_CAPACITY_WH = 2000;

export const MISSION_STEP_MINUTES = 30;
/**
 * The ONE default mission window length (days), shared by the Navigator Mission Metrics card, the Comparison tab
 * (comparisonEngine.js) and the scrub span (timeStore.js). SYNODIC_MONTH_DAYS is kept only for things that are
 * genuinely about the synodic month (e.g. the Sun path ring in scene.js).
 */
export const DEFAULT_MISSION_SPAN_DAYS = 30;
export const MISSION_WINDOW_DAYS = DEFAULT_MISSION_SPAN_DAYS;

export const OPTIMISER_TILT_STEP_DEG = 5; // beta swept 0..90
export const OPTIMISER_TILT_MAX_DEG = 90;
export const OPTIMISER_AZIMUTH_STEP_DEG = 5; // az_panel swept 0..355

export const MISSION_METRICS_CACHE_LIMIT = 64; // 9 regions + user-picked points (oldest dropped first)

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------------------------
// Scalar formulas
// ---------------------------------------------------------------------------------------------

/**
 * cos(theta_inc) between the Sun direction and the panel normal.
 * Returns the raw value in [-1, 1]; negative means the Sun is behind the panel.
 * Does NOT gate on the Sun being above the horizon: multiply by I(t) for that.
 */
export function cosIncidence(sunElevationDeg, panelTiltDeg, sunAzimuthDeg, panelAzimuthDeg) {
  const a = sunElevationDeg * DEG;
  const b = panelTiltDeg * DEG;
  const c =
    Math.sin(a) * Math.cos(b) +
    Math.cos(a) * Math.sin(b) * Math.cos((sunAzimuthDeg - panelAzimuthDeg) * DEG);
  return Math.max(-1, Math.min(1, c));
}

/** S(t) = 1361 * (1 AU / d_sun)^2 in W/m^2, with d_sun given in AU. */
export function solarIntensityWm2(sunDistanceAu) {
  return SOLAR_CONSTANT_W_M2 / (sunDistanceAu * sunDistanceAu);
}

/** I(t): 1 if the Sun centre is strictly above the horizon mask at its azimuth, else 0. */
export function sunIlluminated(sunElevationDeg, sunAzimuthDeg, horizonProfile) {
  return sunElevationDeg > sampleHorizonMask(horizonProfile, sunAzimuthDeg) ? 1 : 0;
}

/** C(t): 1 if the Earth centre is strictly above the horizon mask at its azimuth, else 0. */
export function earthVisible(earthElevationDeg, earthAzimuthDeg, horizonProfile) {
  return earthElevationDeg > sampleHorizonMask(horizonProfile, earthAzimuthDeg) ? 1 : 0;
}

/**
 * P_gen in W for one instant. `illuminated` is I(t) (0/1).
 * Pass S in W/m^2 and cosInc from cosIncidence(); negative cosInc contributes 0.
 */
export function panelPowerW(illuminated, areaM2, efficiency, solarIntensity, cosInc) {
  return illuminated * areaM2 * efficiency * solarIntensity * Math.max(0, cosInc);
}

/**
 * Free-space path loss in dB. Distance is given in KILOMETRES (ephemeris unit) and converted
 * to metres here; frequency in Hz. FSPL = 20log10(d_m) + 20log10(f_Hz) - 147.55.
 * Check value: 384,400 km at 8.4 GHz ~ 222.6 dB.
 */
export function freeSpacePathLossDb(distanceKm, frequencyHz = DEFAULT_FREQUENCY_HZ) {
  const dMetres = distanceKm * 1000;
  return 20 * Math.log10(dMetres) + 20 * Math.log10(frequencyHz) - 147.55;
}

// ---------------------------------------------------------------------------------------------
// Run / window statistics
// ---------------------------------------------------------------------------------------------

/**
 * Longest run of samples where flags[i] === wanted (default 1), in hours.
 * Runs touching the first/last sample are counted at the length observed inside the window
 * and reported via touchesStart / touchesEnd (their true length is a lower bound).
 */
export function longestRun(flags, dtHours, wanted = 1) {
  let best = 0;
  let bestStart = -1;
  let cur = 0;
  let curStart = 0;
  const n = flags.length;
  for (let i = 0; i < n; i++) {
    if (flags[i] === wanted) {
      if (cur === 0) curStart = i;
      cur++;
      if (cur > best) {
        best = cur;
        bestStart = curStart;
      }
    } else {
      cur = 0;
    }
  }
  return {
    samples: best,
    hours: best * dtHours,
    touchesStart: best > 0 && bestStart === 0,
    touchesEnd: best > 0 && bestStart + best === n,
  };
}

/** Sum of flags * dt: total hours with flag = 1. */
export function integrateFlagHours(flags, dtHours) {
  let count = 0;
  for (let i = 0; i < flags.length; i++) if (flags[i]) count++;
  return count * dtHours;
}

/** Dark-period statistics from the I(t) series: total lit hours, % lit, longest continuous dark interval. */
export function darkPeriodStats(illuminationFlags, dtHours) {
  const n = illuminationFlags.length;
  const litHours = integrateFlagHours(illuminationFlags, dtHours);
  const dark = longestRun(illuminationFlags, dtHours, 0);
  return {
    totalLitHours: litHours,
    litPercent: n > 0 ? (100 * litHours) / (n * dtHours) : 0,
    longestDarkHours: dark.hours,
    longestDarkTouchesStart: dark.touchesStart,
    longestDarkTouchesEnd: dark.touchesEnd,
  };
}

/** Comms statistics from the C(t) series: DeltaT_comm (h), % of window, longest continuous contact. */
export function commsStats(visibilityFlags, dtHours) {
  const n = visibilityFlags.length;
  const commHours = integrateFlagHours(visibilityFlags, dtHours);
  const contact = longestRun(visibilityFlags, dtHours, 1);
  return {
    commHours,
    commPercent: n > 0 ? (100 * commHours) / (n * dtHours) : 0,
    longestContactHours: contact.hours,
    longestContactTouchesStart: contact.touchesStart,
    longestContactTouchesEnd: contact.touchesEnd,
  };
}

/** E = sum P(t)*dt in Wh. */
export function integrateEnergyWh(powerSeriesW, dtHours) {
  let sum = 0;
  for (let i = 0; i < powerSeriesW.length; i++) sum += powerSeriesW[i];
  return sum * dtHours;
}

// ---------------------------------------------------------------------------------------------
// Shared (site-independent) Sun/Earth series in the Moon-fixed frame
// ---------------------------------------------------------------------------------------------

const celestialSeriesCache = new Map();

/**
 * Samples the ephemeris ONCE per (start, window, step) and stores Moon-fixed vectors:
 *  - sunVecKm / earthVecKm: 3 floats per sample, km from the Moon's centre
 *    (Sun at its true ephemeris distance, Earth at lib.dist_km).
 *  - sunDistAu: for S(t).
 * Per-region topocentric az/el (including Earth parallax) are derived from these without
 * touching the ephemeris again.
 */
export function getCelestialSeries(startDate, windowDays = MISSION_WINDOW_DAYS, stepMinutes = MISSION_STEP_MINUTES) {
  const hit = celestialSeriesCache.get(celestialKey(startDate, windowDays, stepMinutes));
  if (hit) return hit;
  const b = beginCelestialSeries(startDate, windowDays, stepMinutes);
  fillCelestialRange(b, 0, b.series.n);
  return storeCelestialSeries(b);
}

/**
 * Same result and same cache as getCelestialSeries, but fills the series in chunks and yields to the
 * browser between them (used by Comparison so a 365-day window never freezes the UI).
 * @param {(fraction:number)=>void} [onProgress] called with 0..1 after every chunk
 */
export async function getCelestialSeriesAsync(startDate, windowDays = MISSION_WINDOW_DAYS, stepMinutes = MISSION_STEP_MINUTES, onProgress = null, chunk = 240) {
  const hit = celestialSeriesCache.get(celestialKey(startDate, windowDays, stepMinutes));
  if (hit) { if (onProgress) onProgress(1); return hit; }
  const b = beginCelestialSeries(startDate, windowDays, stepMinutes);
  for (let from = 0; from < b.series.n; from += chunk) {
    fillCelestialRange(b, from, Math.min(b.series.n, from + chunk));
    if (onProgress) onProgress(Math.min(1, (from + chunk) / b.series.n));
    await new Promise((r) => setTimeout(r, 0));
  }
  return storeCelestialSeries(b);
}

function celestialKey(startDate, windowDays, stepMinutes) {
  return `${startDate.getTime()}|${windowDays}|${stepMinutes}`;
}

function beginCelestialSeries(startDate, windowDays, stepMinutes) {
  const n = Math.max(1, Math.round((windowDays * 24 * 60) / stepMinutes));
  return {
    key: celestialKey(startDate, windowDays, stepMinutes),
    series: {
      startMs: startDate.getTime(), windowDays, stepMinutes, n, dtHours: stepMinutes / 60,
      sunVecKm: new Float64Array(3 * n), earthVecKm: new Float64Array(3 * n), sunDistAu: new Float64Array(n),
    },
  };
}

function fillCelestialRange(b, from, to) {
  const { series } = b;
  const { startMs, stepMinutes, sunVecKm, earthVecKm, sunDistAu } = series;
  for (let i = from; i < to; i++) {
    const eph = computeEphemeris(new Date(startMs + i * stepMinutes * 60000));
    const sd = sphericalToCartesian(eph.subSolarLat, eph.subSolarLon);
    const ed = sphericalToCartesian(eph.subEarthLat, eph.subEarthLon);
    // NOTE: eph.sunEcliptic.distAu is undefined (Astronomy.Ecliptic() has no .dist), so take the
    // geocentric Sun distance (~ Moon-Sun distance, error < 0.003 %) straight from the Sun's GeoVector.
    const dAu = Astronomy.GeoVector(Astronomy.Body.Sun, eph.astroTime, false).Length();
    sunDistAu[i] = dAu;
    for (let k = 0; k < 3; k++) {
      sunVecKm[3 * i + k] = sd[k] * dAu * AU_KM;
      earthVecKm[3 * i + k] = ed[k] * eph.earthDistanceKm;
    }
  }
}

function storeCelestialSeries(b) {
  const hit = celestialSeriesCache.get(b.key);
  if (hit) return hit; // another caller finished first
  celestialSeriesCache.set(b.key, b.series);
  while (celestialSeriesCache.size > 8) celestialSeriesCache.delete(celestialSeriesCache.keys().next().value);
  return b.series;
}

/** Index of the sample covering `time` (Date or ms), or -1 if outside the window. O(1). */
export function sampleIndexAtTime(series, time) {
  const ms = time instanceof Date ? time.getTime() : time;
  const i = Math.floor((ms - series.startMs) / (series.stepMinutes * 60000));
  return i >= 0 && i < series.n ? i : -1;
}

/**
 * Topocentric elevation/azimuth/distance for one Moon-fixed target vector (km) seen from an
 * observer at (latDeg, lonDeg) with radius R_M + observerElevationKm. Same basis as
 * computeTopocentricHorizon (zenith u, east e, north n).
 */
function topocentricSeries(vecKm, n, latDeg, lonDeg, observerRadiusKm) {
  const phi = latDeg * DEG;
  const lam = lonDeg * DEG;
  const ux = Math.cos(phi) * Math.cos(lam), uy = Math.cos(phi) * Math.sin(lam), uz = Math.sin(phi);
  const ex = -Math.sin(lam), ey = Math.cos(lam);
  const nx = -Math.sin(phi) * Math.cos(lam), ny = -Math.sin(phi) * Math.sin(lam), nz = Math.cos(phi);
  const ox = ux * observerRadiusKm, oy = uy * observerRadiusKm, oz = uz * observerRadiusKm;

  const el = new Float64Array(n);
  const az = new Float64Array(n);
  const dist = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const dx = vecKm[3 * i] - ox, dy = vecKm[3 * i + 1] - oy, dz = vecKm[3 * i + 2] - oz;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const up = (dx * ux + dy * uy + dz * uz) / len;
    const east = (dx * ex + dy * ey) / len;
    const north = (dx * nx + dy * ny + dz * nz) / len;
    el[i] = Math.asin(Math.max(-1, Math.min(1, up))) / DEG;
    let a = Math.atan2(east, north) / DEG;
    if (a < 0) a += 360;
    az[i] = a;
    dist[i] = len;
  }
  return { el, az, dist };
}

// ---------------------------------------------------------------------------------------------
// Best fixed-panel optimiser
// ---------------------------------------------------------------------------------------------

/**
 * Sweeps fixed tilt beta (0..90) and panel azimuth (0..355) and returns the pair maximising
 * energy over the window. Per-sample terms are precomputed once:
 *   S * cos(theta_inc) = S*sin(a)*cos(beta) + sin(beta) * [ S*cos(a)*cos(az_s) * cos(az_p)
 *                                                          + S*cos(a)*sin(az_s) * sin(az_p) ]
 * so each candidate is a cheap loop over the LIT samples only (no ephemeris, no trig per sample).
 *
 * Energy is returned for A_panel and eta given (linear scaling => the optimum itself does not
 * depend on them). Ties keep the first candidate found (lowest tilt, then lowest azimuth).
 *
 * @param {{sunEl:Float64Array, sunAz:Float64Array, illum:Uint8Array, solarIntensity:Float64Array}} geom
 * @returns {{beta:number, az:number, energyWh:number, series:Float64Array}}
 */
export function findBestFixedPanel(geom, dtHours, areaM2 = DEFAULT_PANEL_AREA_M2, efficiency = DEFAULT_SOLAR_EFFICIENCY) {
  const { sunEl, sunAz, illum, solarIntensity } = geom;
  const n = illum.length;

  // Compress to lit samples
  let m = 0;
  for (let i = 0; i < n; i++) if (illum[i]) m++;
  const A = new Float64Array(m); // S sin(a)
  const B = new Float64Array(m); // S cos(a) cos(az_s)
  const C = new Float64Array(m); // S cos(a) sin(az_s)
  for (let i = 0, j = 0; i < n; i++) {
    if (!illum[i]) continue;
    const a = sunEl[i] * DEG;
    const s = sunAz[i] * DEG;
    const S = solarIntensity[i];
    A[j] = S * Math.sin(a);
    B[j] = S * Math.cos(a) * Math.cos(s);
    C[j] = S * Math.cos(a) * Math.sin(s);
    j++;
  }

  const scale = areaM2 * efficiency * dtHours; // Wh per (W/m^2 summed over samples)
  let bestE = -1, bestBeta = 0, bestAz = 0;

  const evalCandidate = (betaDeg, azDeg) => {
    const cb = Math.cos(betaDeg * DEG), sb = Math.sin(betaDeg * DEG);
    const cp = Math.cos(azDeg * DEG), sp = Math.sin(azDeg * DEG);
    let sum = 0;
    for (let j = 0; j < m; j++) {
      const v = A[j] * cb + sb * (B[j] * cp + C[j] * sp);
      if (v > 0) sum += v;
    }
    return sum * scale;
  };

  for (let beta = 0; beta <= OPTIMISER_TILT_MAX_DEG + 1e-9; beta += OPTIMISER_TILT_STEP_DEG) {
    if (beta === 0) {
      // Flat panel: azimuth is irrelevant, evaluate once.
      const e = evalCandidate(0, 0);
      if (e > bestE) { bestE = e; bestBeta = 0; bestAz = 0; }
      continue;
    }
    for (let az = 0; az < 360; az += OPTIMISER_AZIMUTH_STEP_DEG) {
      const e = evalCandidate(beta, az);
      if (e > bestE) { bestE = e; bestBeta = beta; bestAz = az; }
    }
  }

  return {
    beta: bestBeta,
    az: bestAz,
    energyWh: Math.max(0, bestE),
    series: panelPowerSeriesW(geom, bestBeta, bestAz, areaM2, efficiency),
  };
}

/**
 * P_gen(t) series in W for ANY fixed tilt/azimuth (used for the Navigator "Your setting" curve).
 * Cheap: one pass over cached sun az/el, I(t) and S(t).
 */
export function panelPowerSeriesW(geom, tiltDeg, panelAzimuthDeg, areaM2 = DEFAULT_PANEL_AREA_M2, efficiency = DEFAULT_SOLAR_EFFICIENCY) {
  const { sunEl, sunAz, illum, solarIntensity } = geom;
  const out = new Float64Array(illum.length);
  for (let i = 0; i < illum.length; i++) {
    if (!illum[i]) continue;
    out[i] = panelPowerW(1, areaM2, efficiency, solarIntensity[i], cosIncidence(sunEl[i], tiltDeg, sunAz[i], panelAzimuthDeg));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Per-region metrics (cached)
// ---------------------------------------------------------------------------------------------

const regionMetricsCache = new Map();

/**
 * Computes (or returns cached) mission metrics for one region.
 *
 * The caller supplies the horizon profile (720 bins, deg) already built for the SAME mast height
 * (getRegionHorizonProfile(id, lat, lon, range, mastHeightM) is mast-aware); this module never builds horizons itself.
 * The cache is invalidated if a different profile object is passed for the same key.
 *
 * @param {Object} o
 * @param {string} o.regionId
 * @param {number} o.lat @param {number} o.lon  selenographic degrees
 * @param {number} o.elevationKm terrain elevation at the region (km above 1737.4 km sphere)
 * @param {Float32Array} o.horizonProfile
 * @param {number} [o.mastHeightM=10]
 * @param {Date}   o.startDate  window start
 * @param {number} [o.windowDays] @param {number} [o.stepMinutes]
 * @param {number} [o.areaM2] @param {number} [o.efficiency] @param {number} [o.frequencyHz]
 */
export function computeRegionMissionMetrics(o) {
  const {
    regionId, lat, lon, elevationKm = 0, horizonProfile, startDate,
    mastHeightM = DEFAULT_MAST_HEIGHT_M,
    windowDays = MISSION_WINDOW_DAYS,
    stepMinutes = MISSION_STEP_MINUTES,
    areaM2 = DEFAULT_PANEL_AREA_M2,
    efficiency = DEFAULT_SOLAR_EFFICIENCY,
    frequencyHz = DEFAULT_FREQUENCY_HZ,
  } = o;

  const key = `${regionId}|${lat}|${lon}|${mastHeightM}|${startDate.getTime()}|${windowDays}|${stepMinutes}`;
  let geo = regionMetricsCache.get(key);
  if (!geo || geo.horizonProfile !== horizonProfile) {
    geo = buildRegionGeometry(key, lat, lon, elevationKm, mastHeightM, horizonProfile, startDate, windowDays, stepMinutes);
    regionMetricsCache.delete(key);
    regionMetricsCache.set(key, geo);
    while (regionMetricsCache.size > MISSION_METRICS_CACHE_LIMIT) {
      regionMetricsCache.delete(regionMetricsCache.keys().next().value);
    }
  }

  // Area/efficiency only scale power: apply them without recomputing geometry.
  const best = findBestFixedPanelCached(geo, areaM2, efficiency);
  const lit = darkPeriodStats(geo.illum, geo.dtHours);
  const comms = commsStats(geo.comm, geo.dtHours);

  let fsplMin = Infinity, fsplMax = -Infinity, fsplSum = 0;
  for (let i = 0; i < geo.n; i++) {
    const f = freeSpacePathLossDb(geo.earthDistKm[i], frequencyHz);
    fsplSum += f;
    if (f < fsplMin) fsplMin = f;
    if (f > fsplMax) fsplMax = f;
  }

  return {
    regionId, lat, lon, mastHeightM,
    window: { startMs: geo.startMs, days: windowDays, stepMinutes, samples: geo.n, dtHours: geo.dtHours },
    geometry: geo, // cached per-sample series (read-only by convention)
    ...lit,
    ...comms,
    bestFixed: best, // { beta, az, energyWh, series }
    energyWh: best.energyWh,
    fsplDb: { min: fsplMin, mean: fsplSum / geo.n, max: fsplMax, frequencyHz },
    params: { areaM2, efficiency, frequencyHz },
  };
}

function buildRegionGeometry(key, lat, lon, elevationKm, mastHeightM, horizonProfile, startDate, windowDays, stepMinutes) {
  const cel = getCelestialSeries(startDate, windowDays, stepMinutes);
  const n = cel.n;
  const obsRadiusKm = LUNAR_RADIUS_KM + elevationKm + mastHeightM / 1000; // observer = terrain + mast tip

  const sun = topocentricSeries(cel.sunVecKm, n, lat, lon, obsRadiusKm);
  const earth = topocentricSeries(cel.earthVecKm, n, lat, lon, obsRadiusKm);

  const illum = new Uint8Array(n);
  const comm = new Uint8Array(n);
  const solarIntensity = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    illum[i] = sunIlluminated(sun.el[i], sun.az[i], horizonProfile);
    comm[i] = earthVisible(earth.el[i], earth.az[i], horizonProfile);
    solarIntensity[i] = solarIntensityWm2(cel.sunDistAu[i]);
  }

  return {
    key, horizonProfile, startMs: cel.startMs, n, dtHours: cel.dtHours, stepMinutes,
    sunEl: sun.el, sunAz: sun.az, earthEl: earth.el, earthAz: earth.az,
    earthDistKm: earth.dist, // topocentric Earth distance for FSPL
    illum, comm, solarIntensity,
    _best: null, // { beta, az, unitEnergy } cached argmax at A=1, eta=1
  };
}

/** Best-fixed search is cached on the geometry; area/eta rescale the energy and series only. */
function findBestFixedPanelCached(geo, areaM2, efficiency) {
  if (!geo._best) {
    const r = findBestFixedPanel(geo, geo.dtHours, 1, 1);
    geo._best = { beta: r.beta, az: r.az };
  }
  const { beta, az } = geo._best;
  const series = panelPowerSeriesW(geo, beta, az, areaM2, efficiency);
  return { beta, az, energyWh: integrateEnergyWh(series, geo.dtHours), series };
}

/**
 * Instantaneous values at sample index i (no ephemeris calls) for the default Mission Metrics view:
 * P_gen for the given panel (defaults to the best fixed one), cos(theta_inc), S, d_Earth, FSPL.
 */
export function instantMetricsAtIndex(metrics, i, panel = null) {
  const g = metrics.geometry;
  if (i < 0 || i >= g.n) return null;
  const tilt = panel ? panel.tiltDeg : metrics.bestFixed.beta;
  const az = panel ? panel.azimuthDeg : metrics.bestFixed.az;
  const { areaM2, efficiency, frequencyHz } = metrics.params;
  const cosInc = cosIncidence(g.sunEl[i], tilt, g.sunAz[i], az);
  return {
    illuminated: g.illum[i],
    earthVisible: g.comm[i],
    cosIncidence: cosInc,
    solarIntensityWm2: g.solarIntensity[i],
    powerW: panelPowerW(g.illum[i], areaM2, efficiency, g.solarIntensity[i], cosInc),
    earthDistanceKm: g.earthDistKm[i],
    fsplDb: freeSpacePathLossDb(g.earthDistKm[i], frequencyHz),
  };
}

// ---------------------------------------------------------------------------------------------
// Phase 9: battery sizing, instantaneous values at any time, "Your setting vs Best possible"
// ---------------------------------------------------------------------------------------------

/**
 * Required battery capacity to ride through the longest dark interval:
 *   C = (P_base + P_heater) * t_dark / DoD        [Wh]   (t_dark in h, DoD in (0, 1])
 * Returns NaN for invalid inputs instead of a misleading number.
 */
export function batteryRequiredCapacityWh(pBaseW, pHeaterW, longestDarkHours, dod = DEFAULT_DEPTH_OF_DISCHARGE) {
  if (!(dod > 0 && dod <= 1) || !(longestDarkHours >= 0) || !(pBaseW >= 0) || !(pHeaterW >= 0)) return NaN;
  return ((pBaseW + pHeaterW) * longestDarkHours) / dod;
}

/**
 * Survival time of a battery with capacity C (Wh) under the dark-period load:
 *   t = C * DoD / (P_base + P_heater)             [h]
 * Returns Infinity when the load is zero and NaN for invalid inputs.
 */
export function batterySurvivalHours(capacityWh, dod, pBaseW, pHeaterW) {
  if (!(dod > 0 && dod <= 1) || !(capacityWh >= 0) || !(pBaseW >= 0) || !(pHeaterW >= 0)) return NaN;
  const load = pBaseW + pHeaterW;
  return load === 0 ? Infinity : (capacityWh * dod) / load;
}

/** True Sun distance in AU for an astronomy-engine time (geocentric Sun, error vs Moon-Sun < 0.003 %). */
export function sunDistanceAu(astroTime) {
  return Astronomy.GeoVector(Astronomy.Body.Sun, astroTime, false).Length();
}

/**
 * Instantaneous Mission Metrics at ANY simulation time, computed directly from the already-known
 * topocentric Sun/Earth directions (no window, no series lookup, no ephemeris call here).
 * The default Mission Metrics view uses this so the readout also works beyond the 29.5-day window.
 *
 * @param {Object} o
 * @param {number} o.sunElevationDeg @param {number} o.sunAzimuthDeg
 * @param {number} o.earthDistanceKm topocentric Earth distance (km)
 * @param {number} o.sunDistanceAu
 * @param {Float32Array} o.horizonProfile  profile for the SAME mast height as the metrics
 * @param {number} o.tiltDeg @param {number} o.panelAzimuthDeg
 * @returns {{illuminated:number, cosIncidence:number, solarIntensityWm2:number, powerW:number, earthDistanceKm:number, fsplDb:number}}
 */
export function instantMetrics(o) {
  const {
    sunElevationDeg, sunAzimuthDeg, earthDistanceKm, sunDistanceAu: dAu, horizonProfile,
    tiltDeg, panelAzimuthDeg,
    areaM2 = DEFAULT_PANEL_AREA_M2, efficiency = DEFAULT_SOLAR_EFFICIENCY, frequencyHz = DEFAULT_FREQUENCY_HZ,
  } = o;
  const illuminated = sunIlluminated(sunElevationDeg, sunAzimuthDeg, horizonProfile);
  const cosInc = cosIncidence(sunElevationDeg, tiltDeg, sunAzimuthDeg, panelAzimuthDeg);
  const S = solarIntensityWm2(dAu);
  return {
    illuminated,
    cosIncidence: cosInc,
    solarIntensityWm2: S,
    powerW: panelPowerW(illuminated, areaM2, efficiency, S, cosInc),
    earthDistanceKm,
    fsplDb: freeSpacePathLossDb(earthDistanceKm, frequencyHz),
  };
}

/**
 * Data for the "Your setting vs Best possible" chart. Uses ONLY the cached per-sample sun series of
 * `metrics.geometry` (no ephemeris, no horizon work), so it is cheap enough to run on every input change.
 * @returns {{yourSeriesW:Float64Array, bestSeriesW:Float64Array, yourEnergyWh:number, bestEnergyWh:number, percentOfBest:number}}
 */
export function compareYourSettingToBest(metrics, tiltDeg, panelAzimuthDeg) {
  const { areaM2, efficiency } = metrics.params;
  const dt = metrics.geometry.dtHours;
  const yourSeriesW = panelPowerSeriesW(metrics.geometry, tiltDeg, panelAzimuthDeg, areaM2, efficiency);
  const yourEnergyWh = integrateEnergyWh(yourSeriesW, dt);
  const bestEnergyWh = metrics.bestFixed.energyWh;
  return {
    yourSeriesW,
    bestSeriesW: metrics.bestFixed.series,
    yourEnergyWh,
    bestEnergyWh,
    percentOfBest: bestEnergyWh > 0 ? (100 * yourEnergyWh) / bestEnergyWh : 0,
  };
}

/** Test/maintenance helper: drop every cached series. */
export function clearMissionMetricsCaches() {
  celestialSeriesCache.clear();
  regionMetricsCache.clear();
}
