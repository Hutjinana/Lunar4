/**
 * Phase 10 tests: Comparison rebuilt on the three Section 5 criteria.
 * Weights, min-max scoring (dark interval inverted), no division by zero, weight sensitivity,
 * DTE = DeltaT_comm / window, isolation from Navigator panel/mast settings, window-keyed cache, no slope.
 */
import { REGIONS } from '../regions.js';
import {
  computeRegionalComparisonData, rankRegionsByWeights, makeComparisonWindow, clearComparisonCache,
  comparisonStepMinutesForSpan, COMPARISON_DEFAULT_WEIGHTS, COMPARISON_MAST_HEIGHT_M, COMPARISON_DEFAULT_SPAN_DAYS,
} from '../src/comparisonEngine.js';
import { DEFAULT_MISSION_SPAN_DAYS, MISSION_WINDOW_DAYS } from '../src/missionMetrics.js';
import { timeStore } from '../src/timeStore.js';
import { formatWindowLine } from '../src/missionMetricsCard.js';
import {
  computeRegionMissionMetrics, compareYourSettingToBest, clearMissionMetricsCaches, commsStats,
} from '../src/missionMetrics.js';
import { getRegionHorizonProfile } from '../src/horizon.js';
import { getElevationAt } from '../src/terrain.js';

export async function runComparisonTest() {
  const t0 = performance.now();
  const measurements = [];
  let passed = true;
  const check = (label, ok) => { if (!ok) passed = false; measurements.push(`${label} [${ok ? 'PASS' : 'FAIL'}]`); };
  const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

  // ---- Weights -----------------------------------------------------------------------------------
  const mock = [
    { id: 'a', energyWh: 1000, longestDarkHours: 200, commPercent: 50 }, // best energy, worst dark
    { id: 'b', energyWh: 500, longestDarkHours: 20, commPercent: 60 }, // best dark
    { id: 'c', energyWh: 700, longestDarkHours: 100, commPercent: 100 }, // best DTE
  ];
  const def = rankRegionsByWeights(mock);
  const wm = def[0].weightsMeta;
  check(`Default weights ${JSON.stringify(COMPARISON_DEFAULT_WEIGHTS)}: displayed percentages sum to 100 (${(wm.energyPct + wm.darkPct + wm.commPct).toFixed(2)})`,
    COMPARISON_DEFAULT_WEIGHTS.energy === 33 && COMPARISON_DEFAULT_WEIGHTS.dark === 33 && COMPARISON_DEFAULT_WEIGHTS.comm === 34 &&
    near(wm.energyPct + wm.darkPct + wm.commPct, 100));
  const wm2 = rankRegionsByWeights(mock, { energy: 10, dark: 30, comm: 60 })[0].weightsMeta;
  check('Arbitrary weights 10/30/60 are normalised to 10 % / 30 % / 60 %', near(wm2.energyPct, 10) && near(wm2.darkPct, 30) && near(wm2.commPct, 60));
  const wm3 = rankRegionsByWeights(mock, { energy: 1, dark: 1, comm: 2 })[0].weightsMeta;
  check('Weights 1/1/2 normalise to 25 / 25 / 50 %', near(wm3.energyPct, 25) && near(wm3.darkPct, 25) && near(wm3.commPct, 50));

  // ---- Min-max, dark inverted -------------------------------------------------------------------
  const byId = Object.fromEntries(def.map((r) => [r.id, r]));
  check('Energy: highest raw value → score ≈ 1, lowest → 0', near(byId.a.normEnergyScore, 1, 1e-6) && byId.b.normEnergyScore === 0);
  check('Dark interval is inverted: shortest (20 h) → ≈ 1, longest (200 h) → 0', near(byId.b.normDarkScore, 1, 1e-6) && byId.a.normDarkScore === 0);
  check('Mid value normalises linearly: energy 700 → (700-500)/(1000-500) = 0.4', near(byId.c.normEnergyScore, 0.4, 1e-6));
  check('DTE: highest → ≈ 1, lowest → 0', near(byId.c.normCommScore, 1, 1e-6) && byId.a.normCommScore === 0);
  const manual = 100 * (33 * byId.c.normEnergyScore + 33 * byId.c.normDarkScore + 34 * byId.c.normCommScore) / 100;
  check(`Score = 100·(w1·S_e + w2·S_d + w3·S_c)/(w1+w2+w3): region c ${byId.c.score.toFixed(3)} = ${manual.toFixed(3)}`, near(byId.c.score, manual, 1e-9));

  // ---- Equal values: no division by zero ----------------------------------------------------------
  const flat = rankRegionsByWeights([
    { id: 'x', energyWh: 5, longestDarkHours: 10, commPercent: 40 },
    { id: 'y', energyWh: 5, longestDarkHours: 10, commPercent: 40 },
  ]);
  check('All regions equal → finite scores, no NaN / Infinity, equal ranks by order', flat.every((r) => Number.isFinite(r.score) && r.score >= 0 && r.score <= 100) && near(flat[0].score, flat[1].score));
  check('All weights 0 → scores 0 (no NaN)', rankRegionsByWeights(mock, { energy: 0, dark: 0, comm: 0 }).every((r) => r.score === 0));
  check('Empty input → empty ranking', rankRegionsByWeights([]).length === 0);

  // ---- Ranking moves in the expected direction when a weight changes --------------------------------
  const top = (w) => rankRegionsByWeights(mock, w)[0].id;
  check(`Energy-heavy → region a on top (${top({ energy: 100, dark: 0, comm: 0 })})`, top({ energy: 100, dark: 0, comm: 0 }) === 'a');
  check(`Dark-heavy → region b on top (${top({ energy: 0, dark: 100, comm: 0 })})`, top({ energy: 0, dark: 100, comm: 0 }) === 'b');
  check(`DTE-heavy → region c on top (${top({ energy: 0, dark: 0, comm: 100 })})`, top({ energy: 0, dark: 0, comm: 100 }) === 'c');
  const rankA = (w) => rankRegionsByWeights(mock, w).find((r) => r.id === 'a').rank;
  check('Raising the energy weight never worsens region a (best energy): rank at 0 % ≥ rank at 80 %', rankA({ energy: 0, dark: 50, comm: 50 }) >= rankA({ energy: 80, dark: 10, comm: 10 }));

  // ---- Real data: nine regions, three criteria -----------------------------------------------------------
  const start = new Date('2026-11-01T00:00:00Z');
  const win = makeComparisonWindow(start, 30);
  clearComparisonCache();
  clearMissionMetricsCaches();
  const rows = await computeRegionalComparisonData(win);
  check(`Nine candidate rows, no user point (${rows.length})`, rows.length === 9 && rows.every((r) => REGIONS.some((g) => g.id === r.id)));
  check('Mast fixed at 10 m; default span 30 d; 30-day window steps by 30 min',
    COMPARISON_MAST_HEIGHT_M === 10 && COMPARISON_DEFAULT_SPAN_DAYS === 30 && win.stepMinutes === 30 && rows.every((r) => r.mastHeightM === 10));
  check('Longer spans use a coarser step (30/90/180/365 d → 30/60/120/180 min)',
    [30, 90, 180, 365].map(comparisonStepMinutesForSpan).join() === '30,60,120,180');
  check('Every row has finite energy ≥ 0, dark ≥ 0 and DTE in [0, 100]',
    rows.every((r) => Number.isFinite(r.energyWh) && r.energyWh >= 0 && r.longestDarkHours >= 0 && r.commPercent >= 0 && r.commPercent <= 100));

  // DTE coverage = DeltaT_comm / window length * 100, checked independently from the raw C(t) series
  const reg = REGIONS[2];
  const m = computeRegionMissionMetrics({
    regionId: reg.id, lat: reg.lat, lon: reg.lon, elevationKm: getElevationAt(reg.lat, reg.lon),
    horizonProfile: getRegionHorizonProfile(reg.id, reg.lat, reg.lon, undefined, 10), startDate: start, windowDays: 30, stepMinutes: 30,
  });
  let flags = 0;
  for (let i = 0; i < m.geometry.n; i++) flags += m.geometry.comm[i];
  const deltaTcomm = flags * (30 / 60);
  const row = rows.find((r) => r.id === reg.id);
  check(`DTE coverage = ΔT_comm / window × 100: ${row.commPercent.toFixed(3)} % = ${deltaTcomm} h / ${30 * 24} h`,
    near(row.commPercent, (100 * deltaTcomm) / (30 * 24), 1e-9) && near(row.commHours, deltaTcomm, 1e-9) && near(commsStats(m.geometry.comm, 0.5).commPercent, row.commPercent, 1e-9));
  check('Energy equals the Navigator best-fixed energy for the same region and window; tilt/azimuth match',
    near(row.energyWh, m.energyWh, 1e-6) && row.bestTiltDeg === m.bestFixed.beta && row.bestAzimuthDeg === m.bestFixed.az);
  check('A 100 % DTE region has a 0 h longest comm gap', rows.filter((r) => r.commPercent === 100).every((r) => r.longestCommGapHours === 0));

  // ---- One default mission window everywhere (Navigator card, Comparison, scrub span) -----------------------
  check('Single default span: Comparison = Navigator (MISSION_WINDOW_DAYS) = scrub span (timeStore.maxDays) = 30 d',
    COMPARISON_DEFAULT_SPAN_DAYS === DEFAULT_MISSION_SPAN_DAYS && MISSION_WINDOW_DAYS === DEFAULT_MISSION_SPAN_DAYS &&
    timeStore.maxDays === DEFAULT_MISSION_SPAN_DAYS && DEFAULT_MISSION_SPAN_DAYS === 30);
  // Navigator = default settings and NO explicit window (the library defaults), 10 m mast, same start epoch
  const navDefault = computeRegionMissionMetrics({
    regionId: reg.id, lat: reg.lat, lon: reg.lon, elevationKm: getElevationAt(reg.lat, reg.lon),
    horizonProfile: getRegionHorizonProfile(reg.id, reg.lat, reg.lon, undefined, 10), startDate: start,
  });
  check(`Navigator defaults vs Comparison row (${reg.id}): energy ${navDefault.energyWh.toFixed(1)} Wh, longest dark ${navDefault.longestDarkHours} h, DTE ${navDefault.commPercent.toFixed(3)} % are identical`,
    navDefault.window.days === 30 && navDefault.window.stepMinutes === win.stepMinutes &&
    near(navDefault.energyWh, row.energyWh, 1e-6) && near(navDefault.longestDarkHours, row.longestDarkHours, 1e-9) &&
    near(navDefault.commPercent, row.commPercent, 1e-9) && near(navDefault.totalLitHours, row.totalLitHours, 1e-9));
  const allSame = rows.every((r) => {
    const g = REGIONS.find((x) => x.id === r.id);
    const n = computeRegionMissionMetrics({ regionId: g.id, lat: g.lat, lon: g.lon, elevationKm: getElevationAt(g.lat, g.lon),
      horizonProfile: getRegionHorizonProfile(g.id, g.lat, g.lon, undefined, 10), startDate: start });
    return near(n.energyWh, r.energyWh, 1e-6) && near(n.longestDarkHours, r.longestDarkHours, 1e-9) && near(n.commPercent, r.commPercent, 1e-9);
  });
  check('All nine regions: Navigator default metrics equal the Comparison row values', allSame);
  const appSrc = (await import('node:fs')).readFileSync((await import('node:path')).resolve(process.cwd(), 'src/app.js'), 'utf8');
  const navFn = appSrc.slice(appSrc.indexOf('_getMissionMetrics(region, elevKm) {'), appSrc.indexOf('_getChartMetrics(region, elevKm) {'));
  check('app.js Navigator metrics use the scrub span and the Comparison step (same window as Comparison)',
    /windowDays: span, stepMinutes: step/.test(navFn) && /timeStore\.maxDays/.test(navFn) && /comparisonStepMinutesForSpan\(span\)/.test(navFn));

  // ---- Window line shown on the card and in the Comparison header ----------------------------------------------
  check('Window line: "Window: 30 d from 2026-11-01 UTC, step 30 min"; 90 d → step 1 h',
    formatWindowLine({ startMs: start.getTime(), days: 30, stepMinutes: 30 }) === 'Window: 30 d from 2026-11-01 UTC, step 30 min' &&
    formatWindowLine({ startMs: start.getTime(), days: 90, stepMinutes: 60 }) === 'Window: 90 d from 2026-11-01 UTC, step 1 h');
  const uiSrc = (await import('node:fs')).readFileSync((await import('node:path')).resolve(process.cwd(), 'src/ui.js'), 'utf8');
  check('Comparison header has #comparison-window-line and _runComparisonCalculation updates it from the span and start epoch',
    uiSrc.includes('id="comparison-window-line"') && /getElementById\('comparison-window-line'\)[\s\S]{0,200}formatWindowLine\(\{ startMs: epoch\.getTime\(\), days: span/.test(uiSrc));

  // ---- Navigator manual panel / mast changes have no effect ----------------------------------------------
  const before = JSON.stringify(rows.map((r) => [r.id, r.energyWh, r.longestDarkHours, r.commPercent, r.bestTiltDeg, r.bestAzimuthDeg]));
  compareYourSettingToBest(m, 0, 0); // a bad Manual setting
  compareYourSettingToBest(m, 45, 180);
  computeRegionMissionMetrics({ // Navigator at a 25 m mast with different area/efficiency
    regionId: reg.id, lat: reg.lat, lon: reg.lon, elevationKm: getElevationAt(reg.lat, reg.lon),
    horizonProfile: getRegionHorizonProfile(reg.id, reg.lat, reg.lon, undefined, 25), mastHeightM: 25, startDate: start,
    windowDays: 30, stepMinutes: 30, areaM2: 3, efficiency: 0.1,
  });
  clearComparisonCache(); // force a real recompute, not a cache hit
  const after = JSON.stringify((await computeRegionalComparisonData(win)).map((r) => [r.id, r.energyWh, r.longestDarkHours, r.commPercent, r.bestTiltDeg, r.bestAzimuthDeg]));
  check('Manual panel settings, 25 m mast and other area/efficiency leave all Comparison values identical', before === after);

  // ---- Window is part of the cache key ----------------------------------------------------------------
  const rows90 = await computeRegionalComparisonData(makeComparisonWindow(start, 90));
  const rowsLater = await computeRegionalComparisonData(makeComparisonWindow(new Date(start.getTime() + 7 * 86400000), 30));
  const again = await computeRegionalComparisonData(makeComparisonWindow(start, 30));
  check('Different span / start epoch → different results; same window → cached result',
    rows90 !== rows && rows90[0].spanDays === 90 && rows90[0].stepMinutes === 60 && rowsLater !== rows &&
    rows90[0].energyWh !== rows[0].energyWh && again === (await computeRegionalComparisonData(makeComparisonWindow(start, 30))));

  // ---- Slope is not used anywhere in Comparison -------------------------------------------------------------
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = fs.readFileSync(path.resolve(process.cwd(), 'src/comparisonEngine.js'), 'utf8');
  check('comparisonEngine.js never mentions slope and does not import terrain slope helpers', !/slope/i.test(src) && !/computeLocalizedSlopeAt/.test(src));
  check('Rows carry no slope fields and no battery flag', rows.every((r) => !Object.keys(r).some((k) => /slope|battery/i.test(k))));
  const ui = fs.readFileSync(path.resolve(process.cwd(), 'src/ui.js'), 'utf8');
  const tab = ui.slice(ui.indexOf('id="comparison-tab"'), ui.indexOf('id="methods-tab"'));
  check('Comparison tab has three sliders (energy/dark/comm), no sun/earth/slope sliders, no slope column',
    ['energy', 'dark', 'comm'].every((k) => tab.includes(`id="slider-weight-${k}"`)) && !/slider-weight-(sun|earth|slope)/.test(tab) && !/data-sort="p95SlopeDeg"/.test(tab));

  // Every table column is sortable
  const cols = ['rank', 'name', 'score', 'energyWh', 'longestDarkHours', 'commPercent', 'totalLitHours', 'longestCommGapHours', 'bestTiltDeg'];
  check('Table is sortable by every column (rank, region, score, energy, dark, DTE, lit, gap, tilt/az)', cols.every((c) => tab.includes(`data-sort="${c}"`)));

  return {
    id: 'test-comparison',
    name: 'Phase 10: Comparison on the three Section 5 criteria (energy, longest dark, DTE coverage)',
    passed,
    timeMs: (performance.now() - t0).toFixed(2),
    description: 'Weights, min-max scoring with inverted dark interval, equal-value safety, weight sensitivity, DTE = ΔT_comm/window, isolation from Navigator settings, window-keyed cache, no slope.',
    criteria: 'Three criteria only, default weights 33/33/34 normalised to 100 %, Navigator panel/mast changes never change Comparison',
    measurements,
  };
}
