/**
 * Mission Metrics (Phase 6) unit tests.
 * Covers: incidence angle, S(t), FSPL known value, run/edge logic, DeltaT_comm integration,
 * best-fixed optimiser, topocentric agreement with ephemeris.js, caching.
 * Mast-height-on-horizon and "Manual settings do not change Comparison" belong to Phases 7 and 10.
 */

import { REGIONS } from '../regions.js';
import { computeEphemeris, computeTopocentricHorizon } from '../src/ephemeris.js';
import { getRegionHorizonProfile, computeHorizonProfile, normalizeMastHeightM, DEFAULT_MAST_HEIGHT_M as HORIZON_DEFAULT_MAST_M, AZIMUTH_BIN_COUNT, HORIZON_RADIAL_STEP_KM, DEFAULT_HORIZON_RANGE_KM } from '../src/horizon.js';
import { demProvider } from '../src/demLoader.js';
import { getElevationAt, LUNAR_RADIUS_KM } from '../src/terrain.js';
import {
  cosIncidence, solarIntensityWm2, sunIlluminated, earthVisible, panelPowerW, freeSpacePathLossDb,
  longestRun, integrateFlagHours, darkPeriodStats, commsStats, integrateEnergyWh,
  findBestFixedPanel, panelPowerSeriesW, getCelestialSeries, sampleIndexAtTime,
  computeRegionMissionMetrics, instantMetricsAtIndex, clearMissionMetricsCaches,
  MISSION_WINDOW_DAYS, MISSION_STEP_MINUTES, DEFAULT_MISSION_SPAN_DAYS,
} from '../src/missionMetrics.js';

export async function runMissionMetricsTest() {
  const t0 = performance.now();
  const measurements = [];
  let passed = true;
  const check = (label, ok) => {
    if (!ok) passed = false;
    measurements.push(`${label} [${ok ? 'PASS' : 'FAIL'}]`);
  };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;

  // 1. Incidence angle edge cases
  check('cos(theta_inc), tilt 0 = sin(elevation) (Sun 30°: 0.5000)', near(cosIncidence(30, 0, 123, 77), 0.5, 1e-12));
  check('cos(theta_inc), tilt 90 facing the Sun at 0° elevation = 1', near(cosIncidence(0, 90, 200, 200), 1, 1e-12));
  check('cos(theta_inc), tilt 90 facing away at 0° elevation = -1 (no power)', near(cosIncidence(0, 90, 200, 20), -1, 1e-12));
  check('cos(theta_inc), normal pointing at the Sun (el 25°, tilt 65°, same az) = 1', near(cosIncidence(25, 65, 140, 140), 1, 1e-12));
  const mask0 = new Float32Array(AZIMUTH_BIN_COUNT).fill(0);
  const iBelow = sunIlluminated(-5, 10, mask0);
  const cBelow = cosIncidence(-5, 90, 10, 10);
  check(`Sun below horizon: I = ${iBelow}, even though cos(theta) = ${cBelow.toFixed(3)} > 0, so P_gen = 0`,
    iBelow === 0 && cBelow > 0 && panelPowerW(iBelow, 10, 0.29, 1361, cBelow) === 0);
  check('Negative cos(theta) contributes 0 power', panelPowerW(1, 10, 0.29, 1361, -0.4) === 0);
  check('P_gen = A*eta*S*cos: 10*0.29*1361*0.5 = 1973.45 W', near(panelPowerW(1, 10, 0.29, 1361, 0.5), 1973.45, 1e-9));

  // 2. Solar intensity and masks
  check('S at 1 AU = 1361 W/m²', near(solarIntensityWm2(1), 1361, 1e-9));
  check(`S at 0.9833 AU = ${solarIntensityWm2(0.9833).toFixed(1)} W/m² (inverse-square, expect ~1407.6)`, near(solarIntensityWm2(0.9833), 1407.6, 0.5));
  const flat = new Float32Array(AZIMUTH_BIN_COUNT).fill(2.0);
  check('I(t) binary centre-point: 2.1° above a 2.0° mask = 1, 1.9° = 0',
    sunIlluminated(2.1, 45, flat) === 1 && sunIlluminated(1.9, 45, flat) === 0);
  check('C(t) binary centre-point: Earth 2.1° above 2.0° mask = 1, 1.9° = 0',
    earthVisible(2.1, 300, flat) === 1 && earthVisible(1.9, 300, flat) === 0);

  // 3. FSPL
  const fsplMoon = freeSpacePathLossDb(384400, 8.4e9);
  check(`FSPL(384,400 km, 8.4 GHz) = ${fsplMoon.toFixed(2)} dB (expect ≈222.6)`, near(fsplMoon, 222.6, 0.05));
  check('FSPL converts km to metres (no 1000x slip: +60 dB vs. raw km value)', near(fsplMoon - 20 * Math.log10(384400) - 20 * Math.log10(8.4e9) + 147.55, 60, 1e-9));

  // 4. Longest runs, including edges
  const dt = 0.5;
  let r = longestRun([1, 1, 0, 0, 0, 1, 0, 0, 1, 1], dt, 0);
  check(`Longest dark run in the middle = ${r.hours} h, no edge flags`, r.hours === 1.5 && !r.touchesStart && !r.touchesEnd);
  r = longestRun([0, 0, 0, 0, 1, 1, 0], dt, 0);
  check(`Longest dark run touching the START = ${r.hours} h, touchesStart`, r.hours === 2 && r.touchesStart && !r.touchesEnd);
  r = longestRun([1, 0, 1, 0, 0, 0], dt, 0);
  check(`Longest dark run touching the END = ${r.hours} h, touchesEnd`, r.hours === 1.5 && r.touchesEnd && !r.touchesStart);
  r = longestRun([0, 0, 0, 0], dt, 0);
  check('All dark: run = whole window, touches both edges', r.hours === 2 && r.touchesStart && r.touchesEnd);
  r = longestRun([1, 1, 1], dt, 0);
  check('Never dark: longest dark run = 0 h', r.hours === 0 && !r.touchesStart && !r.touchesEnd);
  const ds = darkPeriodStats(Uint8Array.from([1, 1, 0, 0, 0, 1, 0, 1]), dt);
  check(`Dark stats: lit ${ds.totalLitHours} h (expect 2), ${ds.litPercent}% (expect 50), longest dark ${ds.longestDarkHours} h (expect 1.5)`,
    ds.totalLitHours === 2 && ds.litPercent === 50 && ds.longestDarkHours === 1.5);

  // 5. DeltaT_comm integration
  const cs = commsStats(Uint8Array.from([0, 1, 1, 1, 0, 1, 1, 0, 0, 1]), 0.25);
  check(`DeltaT_comm = ${cs.commHours} h (expect 1.5 = 6 samples x 0.25 h), longest contact ${cs.longestContactHours} h (expect 0.75)`,
    cs.commHours === 1.5 && cs.longestContactHours === 0.75 && cs.commPercent === 60);
  check('integrateFlagHours matches', integrateFlagHours([1, 0, 1, 1], 2) === 6);
  check('E = sum P*dt: [100, 200, 0] W x 0.5 h = 150 Wh', integrateEnergyWh([100, 200, 0], 0.5) === 150);

  // 6. Best-fixed optimiser on a controlled geometry: Sun fixed at el 30°, az 90° for the whole window
  const nSyn = 100;
  const synth = {
    sunEl: new Float64Array(nSyn).fill(30),
    sunAz: new Float64Array(nSyn).fill(90),
    illum: new Uint8Array(nSyn).fill(1),
    solarIntensity: new Float64Array(nSyn).fill(1361),
  };
  const bSyn = findBestFixedPanel(synth, 0.5);
  check(`Optimiser on a fixed Sun (el 30°, az 90°) picks tilt ${bSyn.beta}°, az ${bSyn.az}° (expect 60°, 90°)`, bSyn.beta === 60 && bSyn.az === 90);
  check(`Optimiser energy = ${bSyn.energyWh.toFixed(1)} Wh (expect 10*0.29*1361*100*0.5 = 197,345)`, near(bSyn.energyWh, 197345, 1e-6 * 197345));

  // 7. Optimiser vs. arbitrary manual configurations on real ephemeris geometry (Malapert, flat 0° mask)
  clearMissionMetricsCaches();
  const start = new Date('2026-11-08T00:00:00Z');
  const mal = REGIONS[2];
  const elevKm = getElevationAt(mal.lat, mal.lon);
  const flatMask = new Float32Array(AZIMUTH_BIN_COUNT).fill(0);
  const m0 = computeRegionMissionMetrics({
    regionId: 'test-flat', lat: mal.lat, lon: mal.lon, elevationKm: elevKm, horizonProfile: flatMask, startDate: start,
  });
  const g = m0.geometry;
  let worstManual = 0;
  let allBelow = true;
  for (const tilt of [0, 10, 37, 55, 80, 90]) {
    for (const az of [0, 45, 123, 180, 271, 355]) {
      const e = integrateEnergyWh(panelPowerSeriesW(g, tilt, az), g.dtHours);
      worstManual = Math.max(worstManual, e);
      if (e > m0.bestFixed.energyWh + 1e-6) allBelow = false;
    }
  }
  check(`Best fixed (tilt ${m0.bestFixed.beta}°, az ${m0.bestFixed.az}°, ${m0.bestFixed.energyWh.toFixed(0)} Wh) >= every manual config tried (max ${worstManual.toFixed(0)} Wh)`, allBelow && m0.bestFixed.energyWh > 0);
  check('bestFixed.energyWh equals integral of its own series', near(integrateEnergyWh(m0.bestFixed.series, g.dtHours), m0.bestFixed.energyWh, 1e-6));

  // 8. Sampling, caching, area/efficiency scaling
  const cel = getCelestialSeries(start);
  check('One shared default span: MISSION_WINDOW_DAYS = DEFAULT_MISSION_SPAN_DAYS = 30 d (not the 29.53 d synodic month)',
    DEFAULT_MISSION_SPAN_DAYS === 30 && MISSION_WINDOW_DAYS === DEFAULT_MISSION_SPAN_DAYS);
  const expectedN = Math.round((MISSION_WINDOW_DAYS * 24 * 60) / MISSION_STEP_MINUTES);
  check(`Window = ${MISSION_WINDOW_DAYS} d at ${MISSION_STEP_MINUTES} min → ${cel.n} samples (expect ${expectedN}), dt 0.5 h`, cel.n === expectedN && cel.dtHours === 0.5);
  check('Sun/Earth series is cached (same object on repeat call)', getCelestialSeries(start) === cel);
  const tCache = performance.now();
  const m1 = computeRegionMissionMetrics({
    regionId: 'test-flat', lat: mal.lat, lon: mal.lon, elevationKm: elevKm, horizonProfile: flatMask, startDate: start,
    areaM2: 20, efficiency: 0.29,
  });
  const cacheMs = performance.now() - tCache;
  check(`Region geometry cached: doubling A_panel reuses it (${cacheMs.toFixed(1)} ms) and doubles energy`,
    m1.geometry === m0.geometry && near(m1.energyWh, 2 * m0.energyWh, 1e-6 * m0.energyWh) && m1.bestFixed.beta === m0.bestFixed.beta && m1.bestFixed.az === m0.bestFixed.az);
  const mastM = computeRegionMissionMetrics({
    regionId: 'test-flat', lat: mal.lat, lon: mal.lon, elevationKm: elevKm, horizonProfile: flatMask, startDate: start, mastHeightM: 20,
  });
  check('Different mast height gets its own cache entry', mastM.geometry !== m0.geometry);
  check('Comms + lit hours never exceed the window', m0.commHours <= m0.window.days * 24 + 1e-9 && m0.totalLitHours <= m0.window.days * 24 + 1e-9);
  check(`S(t) uses the true Sun distance: ${Math.min(...g.solarIntensity).toFixed(1)}–${Math.max(...g.solarIntensity).toFixed(1)} W/m² (expect 1,3xx–14xx, finite)`,
    g.solarIntensity.every((v) => Number.isFinite(v) && v > 1300 && v < 1450));
  check(`FSPL range over window = ${m0.fsplDb.min.toFixed(1)}–${m0.fsplDb.max.toFixed(1)} dB (expect 220.9–222.9 for 357,000–406,700 km)`,
    m0.fsplDb.min > 220.5 && m0.fsplDb.max < 223.2);

  // 9. Topocentric agreement with the existing ephemeris.js routine (mast 0 m, same elevation)
  const m00 = computeRegionMissionMetrics({
    regionId: 'test-agree', lat: mal.lat, lon: mal.lon, elevationKm: elevKm, horizonProfile: flatMask, startDate: start, mastHeightM: 0,
  });
  let worstElErr = 0, worstAzErr = 0, worstDistRelErr = 0;
  for (const i of [0, 300, 700, 1100, 1400]) {
    const eph = computeEphemeris(new Date(start.getTime() + i * MISSION_STEP_MINUTES * 60000));
    const ref = computeTopocentricHorizon(mal.lat, mal.lon, eph.subEarthLat, eph.subEarthLon, eph.earthDistanceKm, elevKm);
    const sunRef = computeTopocentricHorizon(mal.lat, mal.lon, eph.subSolarLat, eph.subSolarLon, 149597870.7, elevKm);
    const gg = m00.geometry;
    worstElErr = Math.max(worstElErr, Math.abs(gg.earthEl[i] - ref.elevationDeg), Math.abs(gg.sunEl[i] - sunRef.elevationDeg));
    const dAz = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
    worstAzErr = Math.max(worstAzErr, dAz(gg.earthAz[i], ref.azimuthDeg), dAz(gg.sunAz[i], sunRef.azimuthDeg));
    worstDistRelErr = Math.max(worstDistRelErr, Math.abs(gg.earthDistKm[i] - ref.distanceKm) / ref.distanceKm);
  }
  check(`Topocentric el/az/distance match computeTopocentricHorizon (max el err ${worstElErr.toFixed(4)}°, az err ${worstAzErr.toFixed(4)}°, dist rel err ${worstDistRelErr.toExponential(1)})`,
    worstElErr < 0.01 && worstAzErr < 0.01 && worstDistRelErr < 1e-6);

  // 10. Real horizon profile (Phase-6 smoke test; mast-aware horizons arrive in Phase 7)
  const realProfile = getRegionHorizonProfile(mal.id, mal.lat, mal.lon);
  const mReal = computeRegionMissionMetrics({
    regionId: mal.id, lat: mal.lat, lon: mal.lon, elevationKm: elevKm, horizonProfile: realProfile, startDate: start,
  });
  check(`Malapert real horizon: lit ${mReal.litPercent.toFixed(1)}%, longest dark ${mReal.longestDarkHours.toFixed(1)} h, comms ${mReal.commHours.toFixed(1)} h, best tilt ${mReal.bestFixed.beta}°/az ${mReal.bestFixed.az}°, ${mReal.energyWh.toFixed(0)} Wh`,
    mReal.litPercent >= 0 && mReal.litPercent <= 100 && mReal.commPercent >= 0 && mReal.commPercent <= 100 && Number.isFinite(mReal.energyWh));
  check('With a real horizon the region is lit no more often than with a flat 0° mask', mReal.totalLitHours <= m0.totalLitHours + 1e-9);

  // 11. Instant lookup by index, no ephemeris call
  const iNow = sampleIndexAtTime(mReal.geometry, new Date(start.getTime() + 10 * 3600 * 1000));
  const inst = instantMetricsAtIndex(mReal, iNow);
  check(`Index lookup for t0+10 h = ${iNow} (expect 20); instant FSPL ${inst.fsplDb.toFixed(1)} dB, d_Earth ${inst.earthDistanceKm.toFixed(0)} km`,
    iNow === 20 && Number.isFinite(inst.fsplDb) && inst.earthDistanceKm > 3.5e5 && inst.earthDistanceKm < 4.1e5);
  check('Index lookup outside the window = -1', sampleIndexAtTime(mReal.geometry, new Date(start.getTime() - 1000)) === -1 && sampleIndexAtTime(mReal.geometry, new Date(start.getTime() + 40 * 86400000)) === -1);

  // 12. Mast height in the horizon (Phase 7)
  check('Default mast = 10 m; negative / NaN fall back to 10 m; 10.04 rounds to 10.0',
    HORIZON_DEFAULT_MAST_M === 10 && normalizeMastHeightM(-3) === 10 && normalizeMastHeightM(NaN) === 10 && normalizeMastHeightM(10.04) === 10 && normalizeMastHeightM(0) === 0);
  {
    // Analytic check on perfectly flat terrain (z = 0): theta = atan((0 - h_obs)/rho) - rho/(2 R_M), max over rho.
    const origXY = demProvider.getElevationAtXY.bind(demProvider);
    const origAt = demProvider.getElevationAt.bind(demProvider);
    demProvider.getElevationAtXY = () => 0.0;
    demProvider.getElevationAt = () => 0.0;
    try {
      const expectedMask = (mastM) => {
        let best = -90;
        const steps = Math.ceil((DEFAULT_HORIZON_RANGE_KM - 0.5) / HORIZON_RADIAL_STEP_KM);
        for (let s = 1; s <= steps; s++) {
          const rho = 0.5 + s * HORIZON_RADIAL_STEP_KM;
          const th = (Math.atan2(0 - mastM / 1000, rho) - rho / (2 * LUNAR_RADIUS_KM)) * 180 / Math.PI;
          if (th > best) best = th;
        }
        return best;
      };
      let worst = 0;
      for (const mast of [0, 10, 30]) {
        const prof = computeHorizonProfile(-85, 10, DEFAULT_HORIZON_RANGE_KM, mast);
        worst = Math.max(worst, Math.abs(prof[0] - expectedMask(mast)), Math.abs(prof[400] - expectedMask(mast)));
      }
      check(`Flat terrain: mask = max_k[atan((0-h_obs)/rho) - rho/2R] for mast 0/10/30 m (max |err| ${worst.toExponential(1)}°; 10 m → ${expectedMask(10).toFixed(3)}°, 0 m → ${expectedMask(0).toFixed(3)}°)`, worst < 0.002);
    } finally {
      demProvider.getElevationAtXY = origXY;
      demProvider.getElevationAt = origAt;
    }
  }
  const hDefault = getRegionHorizonProfile(mal.id, mal.lat, mal.lon);
  const h10 = getRegionHorizonProfile(mal.id, mal.lat, mal.lon, DEFAULT_HORIZON_RANGE_KM, 10);
  const h0 = getRegionHorizonProfile(mal.id, mal.lat, mal.lon, DEFAULT_HORIZON_RANGE_KM, 0);
  const h30 = getRegionHorizonProfile(mal.id, mal.lat, mal.lon, DEFAULT_HORIZON_RANGE_KM, 30);
  check('Cache: default call === explicit 10 m (same object); 10.04 m reuses it; 0 m and 30 m are separate entries',
    hDefault === h10 && getRegionHorizonProfile(mal.id, mal.lat, mal.lon, DEFAULT_HORIZON_RANGE_KM, 10.04) === h10 && h0 !== h10 && h30 !== h10 && h0 !== h30);
  let monotone = true, lowered = 0, maxDrop = 0;
  for (let b = 0; b < AZIMUTH_BIN_COUNT; b++) {
    if (!(h0[b] >= h10[b] - 1e-6 && h10[b] >= h30[b] - 1e-6)) monotone = false;
    if (h0[b] - h30[b] > 1e-4) lowered++;
    maxDrop = Math.max(maxDrop, h0[b] - h30[b]);
  }
  check(`Real DEM (Malapert): raising the mast never raises the mask; ${lowered}/${AZIMUTH_BIN_COUNT} bins lower at 30 m vs 0 m (max drop ${maxDrop.toFixed(3)}°)`, monotone && lowered > 0);
  const mMast = (profile, mast) => computeRegionMissionMetrics({
    regionId: `mast-${mast}`, lat: mal.lat, lon: mal.lon, elevationKm: elevKm, horizonProfile: profile, startDate: start, mastHeightM: mast,
  });
  const e0 = mMast(h0, 0), e30 = mMast(h30, 30);
  check(`Taller mast does not reduce lit time or contact: lit ${e0.totalLitHours.toFixed(1)} → ${e30.totalLitHours.toFixed(1)} h, comms ${e0.commHours.toFixed(1)} → ${e30.commHours.toFixed(1)} h`,
    e30.totalLitHours >= e0.totalLitHours - 1e-9 && e30.commHours >= e0.commHours - 1e-9);

  return {
    name: 'Test 23: Mission Metrics (Phase 6, pure functions)',
    criteria: 'Incidence/S/I/C formulas, FSPL = 222.6 dB at 384,400 km & 8.4 GHz, run edge logic, DeltaT_comm integration, best-fixed optimiser >= any manual panel, topocentric agreement with ephemeris.js, caching, mast-height horizon (Phase 7)',
    passed,
    timeMs: (performance.now() - t0).toFixed(2),
    measurements,
  };
}
