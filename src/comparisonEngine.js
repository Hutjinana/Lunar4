/**
 * Artemis Lunar Landing Site Navigator - Region Comparison (Phase 10)
 *
 * The Comparison scores the nine candidate regions on EXACTLY the three criteria of the architecture
 * PDF, Section 5. Everything is computed by missionMetrics.js (binary, centre-point I(t) and C(t),
 * best FIXED panel per region, mast height fixed at 10 m). Nothing in this module reads Navigator
 * panel / mast settings, so user adjustments can never change a Comparison value.
 *
 * MISSION WINDOW   { startEpoch: Date, spanDays, stepMinutes }  (the existing time-window selector)
 * CRITERIA         (units; direction)
 *   1. energyWh         cumulative energy E = sum P_gen*dt of the region's own best fixed panel   [Wh; higher is better]
 *   2. longestDarkHours longest continuous run of I(t) = 0 inside the window (edge runs included) [h;  lower is better]
 *   3. commPercent      DTE coverage = DeltaT_comm / window length * 100, DeltaT_comm = sum C(t)*dt [%;  higher is better]
 *   Information only (not scored): total lit hours, longest comm gap, best tilt / azimuth.
 *
 * SCORING
 *   Min-max normalise each criterion across the regions (criterion 2 inverted):
 *     S_energy = (E - Emin) / (Emax - Emin + eps)          S_comm = (DTE - Dmin) / (Dmax - Dmin + eps)
 *     S_dark   = (Dkmax - Dk) / (Dkmax - Dkmin + eps)
 *   Score(r) = 100 * (w1*S_energy + w2*S_dark + w3*S_comm) / (w1 + w2 + w3)
 *   eps only prevents division by zero when all regions are equal (then every S = 0 and so is every score).
 *   A_panel (10 m^2) and eta_solar (0.29) are identical for all regions: they scale every energy by the same
 *   factor and cannot change the ranking.
 *
 * PERFORMANCE
 *   The Sun/Earth Moon-fixed series is computed once (chunked, shared by all regions), horizons once per
 *   (region, 10 m mast), and finished rows are cached per (start epoch, span, step, mast). Work is chunked
 *   with setTimeout yields and reports progress so the UI never freezes.
 *   The best-fixed search is the same exhaustive 5-degree tilt/azimuth grid the Navigator uses (it costs about
 *   1,300 cheap passes over the lit samples, a few ms per region even at 365 d), so Comparison and Navigator
 *   always agree on the best tilt and azimuth.
 */

import { REGIONS } from '../regions.js';
import {
  DEFAULT_MAST_HEIGHT_M, DEFAULT_PANEL_AREA_M2, DEFAULT_SOLAR_EFFICIENCY, DEFAULT_MISSION_SPAN_DAYS,
  computeRegionMissionMetrics, getCelestialSeriesAsync, longestRun,
} from './missionMetrics.js';
import { getRegionHorizonProfile } from './horizon.js';
import { getElevationAt } from './terrain.js';

/** Default mission window when none is given: the single shared default (missionMetrics.js). */
export const COMPARISON_DEFAULT_SPAN_DAYS = DEFAULT_MISSION_SPAN_DAYS;
/** Mast height fixed for every Comparison calculation (never the Navigator Advanced value). */
export const COMPARISON_MAST_HEIGHT_M = DEFAULT_MAST_HEIGHT_M;
/** Default criterion weights (sum 100; they are normalised again when scoring). */
export const COMPARISON_DEFAULT_WEIGHTS = Object.freeze({ energy: 33, dark: 33, comm: 34 });
/** Small epsilon that only guards the min-max division against a zero range. */
export const COMPARISON_EPSILON = 1e-9;

/** Coarser time step for longer spans (keeps 365 d fast): span upper bound (days) -> step (minutes). */
export const COMPARISON_STEP_BY_SPAN = Object.freeze([
  { maxDays: 45, stepMinutes: 30 },
  { maxDays: 120, stepMinutes: 60 },
  { maxDays: 200, stepMinutes: 120 },
  { maxDays: Infinity, stepMinutes: 180 },
]);

export function comparisonStepMinutesForSpan(spanDays) {
  return COMPARISON_STEP_BY_SPAN.find((r) => spanDays <= r.maxDays).stepMinutes;
}

/** Builds the explicit window object used everywhere (and in every cache key). */
export function makeComparisonWindow(startEpoch, spanDays = COMPARISON_DEFAULT_SPAN_DAYS, stepMinutes = comparisonStepMinutesForSpan(spanDays)) {
  return { startEpoch, spanDays, stepMinutes };
}

const comparisonCache = new Map();
const COMPARISON_CACHE_LIMIT = 12;

/**
 * Computes the three criteria (plus information columns) for the nine candidate regions.
 * Candidate regions only: user-picked points never appear here.
 *
 * @param {{startEpoch:Date, spanDays:number, stepMinutes?:number}} win
 * @param {(pct:number)=>void} [onProgress] 0..100
 * @returns {Promise<Array<Object>>} one row per region
 */
export async function computeRegionalComparisonData(win, onProgress = null) {
  const { startEpoch, spanDays } = win;
  const stepMinutes = win.stepMinutes ?? comparisonStepMinutesForSpan(spanDays);
  const key = `${startEpoch.getTime()}|${spanDays}|${stepMinutes}|${COMPARISON_MAST_HEIGHT_M}`;
  const hit = comparisonCache.get(key);
  if (hit) {
    if (onProgress) onProgress(100);
    return hit;
  }

  // Shared Sun/Earth series: 40 % of the progress bar
  await getCelestialSeriesAsync(startEpoch, spanDays, stepMinutes, (f) => onProgress && onProgress(Math.round(40 * f)));

  const rows = [];
  for (let i = 0; i < REGIONS.length; i++) {
    const reg = REGIONS[i];
    const horizonProfile = getRegionHorizonProfile(reg.id, reg.lat, reg.lon, undefined, COMPARISON_MAST_HEIGHT_M);
    const m = computeRegionMissionMetrics({
      regionId: reg.id, lat: reg.lat, lon: reg.lon,
      elevationKm: getElevationAt(reg.lat, reg.lon),
      horizonProfile, mastHeightM: COMPARISON_MAST_HEIGHT_M,
      startDate: startEpoch, windowDays: spanDays, stepMinutes,
      areaM2: DEFAULT_PANEL_AREA_M2, efficiency: DEFAULT_SOLAR_EFFICIENCY,
    });
    const gap = longestRun(m.geometry.comm, m.geometry.dtHours, 0);
    rows.push({
      id: reg.id, name: reg.name, lat: reg.lat, lon: reg.lon,
      source: reg.source, source_url: reg.source_url, reference_url: reg.reference_url,
      kind: reg.kind, status: reg.status,
      // scored criteria
      energyWh: m.energyWh,
      longestDarkHours: m.longestDarkHours,
      longestDarkTouchesStart: m.longestDarkTouchesStart,
      longestDarkTouchesEnd: m.longestDarkTouchesEnd,
      commPercent: m.commPercent,
      // information only
      commHours: m.commHours,
      totalLitHours: m.totalLitHours,
      litPercent: m.litPercent,
      longestCommGapHours: gap.hours,
      bestTiltDeg: m.bestFixed.beta,
      bestAzimuthDeg: m.bestFixed.az,
      // window description
      spanDays, stepMinutes, sampleCount: m.window.samples, mastHeightM: COMPARISON_MAST_HEIGHT_M,
    });
    if (onProgress) onProgress(40 + Math.round(60 * ((i + 1) / REGIONS.length)));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  comparisonCache.set(key, rows);
  while (comparisonCache.size > COMPARISON_CACHE_LIMIT) comparisonCache.delete(comparisonCache.keys().next().value);
  return rows;
}

/** Test helper: forget finished comparison rows. */
export function clearComparisonCache() {
  comparisonCache.clear();
}

/** Min-max normalisation to [0, 1]; `invert` flips it (lower raw value = better). */
function minMax(values, invert) {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const range = hi - lo + COMPARISON_EPSILON;
  return values.map((v) => (invert ? hi - v : v - lo) / range);
}

/**
 * Scores and ranks the regions.
 *
 * @param {Array<Object>} rawData rows from computeRegionalComparisonData (needs energyWh, longestDarkHours, commPercent)
 * @param {{energy:number, dark:number, comm:number}} weights any non-negative numbers; they are normalised to 100 %
 * @returns {Array<Object>} rows with normEnergyScore / normDarkScore / normCommScore in [0,1], score in [0,100],
 *                          rank (1 = best) and weightsMeta (actual percentages), sorted best first
 */
export function rankRegionsByWeights(rawData, weights = COMPARISON_DEFAULT_WEIGHTS) {
  if (!rawData || rawData.length === 0) return [];

  const w1 = Math.max(0, Number(weights.energy ?? COMPARISON_DEFAULT_WEIGHTS.energy) || 0);
  const w2 = Math.max(0, Number(weights.dark ?? COMPARISON_DEFAULT_WEIGHTS.dark) || 0);
  const w3 = Math.max(0, Number(weights.comm ?? COMPARISON_DEFAULT_WEIGHTS.comm) || 0);
  const total = w1 + w2 + w3;

  const sEnergy = minMax(rawData.map((r) => r.energyWh), false);
  const sDark = minMax(rawData.map((r) => r.longestDarkHours), true);
  const sComm = minMax(rawData.map((r) => r.commPercent), false);

  const ranked = rawData.map((r, i) => ({
    ...r,
    normEnergyScore: sEnergy[i],
    normDarkScore: sDark[i],
    normCommScore: sComm[i],
    score: total > 0 ? (100 * (w1 * sEnergy[i] + w2 * sDark[i] + w3 * sComm[i])) / total : 0,
    weightsMeta: total > 0
      ? { energyPct: (100 * w1) / total, darkPct: (100 * w2) / total, commPct: (100 * w3) / total, total }
      : { energyPct: 0, darkPct: 0, commPct: 0, total },
  }));

  ranked.sort((a, b) => b.score - a.score || b.energyWh - a.energyWh);
  ranked.forEach((r, i) => { r.rank = i + 1; });
  return ranked;
}
