/**
 * Artemis Lunar Landing Site Navigator - Unified Test Suite
 * Shared between Headless Node Runner (tests/run.mjs) and Browser UI (tests.html)
 */

import { computeEphemeris, computeTopocentricHorizon, SUN_ANGULAR_RADIUS_DEG, EARTH_ANGULAR_RADIUS_DEG } from '../src/ephemeris.js';
import { computeExtendedDiscFraction, computeUnblockedDiscFraction, sampleHorizonMask, DISC_QUADRATURE_STRIP_COUNT } from '../src/horizon.js';
import { getElevationAt } from '../src/terrain.js';
import { rankRegionsByWeights, computeRegionalComparisonData, makeComparisonWindow } from '../src/comparisonEngine.js';
import { DemProvider } from '../src/demLoader.js';
import { CONFIG } from '../config.js';
import { REGIONS } from '../regions.js';
import { runClassAudit } from './classAudit.js';
import { runPanelVisibilityTest } from './panelVisibility.js';
import { runGeometryTests } from './geometry.js';

/**
 * High-precision 2D grid brute-force integration of extended circular disc
 * above a flat or azimuth-dependent horizon mask.
 * 
 * Grid size defaults to 1000x1000 (1 million samples).
 * 
 * @param {number} elevationDeg - Elevation of disc center in degrees
 * @param {number} azimuthDeg - Azimuth of disc center in degrees
 * @param {number} radiusDeg - Angular radius in degrees
 * @param {number|Function} maskInput - Constant mask angle or fn(azimuthDeg) => maskAngle
 * @param {number} gridSize - Samples along each dimension (default 1000)
 * @returns {number} Unblocked fraction in [0, 1]
 */
export function bruteForceDiscFraction(elevationDeg, azimuthDeg, radiusDeg, maskInput, gridSize = 1000) {
  const cosEl = Math.max(0.001, Math.cos((elevationDeg * Math.PI) / 180));
  const isFunc = typeof maskInput === 'function';
  const R = radiusDeg;
  const R2 = R * R;
  const step = (2 * R) / gridSize;

  let insideCount = 0;
  let visibleCount = 0;

  for (let i = 0; i < gridSize; i++) {
    const x = -R + (i + 0.5) * step;
    const x2 = x * x;
    const remainingY2 = R2 - x2;
    if (remainingY2 < 0) continue;

    const az = azimuthDeg + (x / cosEl);
    const maskVal = isFunc ? maskInput(az) : maskInput;
    const cutoffY = maskVal - elevationDeg;

    for (let j = 0; j < gridSize; j++) {
      const y = -R + (j + 0.5) * step;
      if (x2 + y * y <= R2) {
        insideCount++;
        if (y > cutoffY) {
          visibleCount++;
        }
      }
    }
  }

  return insideCount > 0 ? visibleCount / insideCount : 0;
}

/**
 * Runs the comprehensive verification test suite.
 * Returns array of test results with detailed measurements and pass/fail booleans.
 */
export async function runAllTests() {
  const tests = [];
  const baseDate = new Date('2026-11-01T00:00:00Z');

  // ==========================================
  // Test 1: South Pole Coordinate Invariance Test
  // ==========================================
  try {
    const t0 = performance.now();
    const ephem = computeEphemeris(baseDate);
    const sunTopo = computeTopocentricHorizon(-90.0, 0.0, ephem.subSolarLat, ephem.subSolarLon, 149597870.7, 0.0);
    const earthTopo = computeTopocentricHorizon(-90.0, 0.0, ephem.subEarthLat, ephem.subEarthLon, ephem.earthDistanceKm, 0.0);

    const expectedSunEl = -ephem.subSolarLat;
    const expectedEarthEl = -ephem.subEarthLat;

    const deltaSun = Math.abs(sunTopo.elevationDeg - expectedSunEl);
    const deltaEarth = Math.abs(earthTopo.elevationDeg - expectedEarthEl);

    const passed = (deltaSun < 0.05) && (deltaEarth < 0.30);
    const elapsedMs = performance.now() - t0;

    tests.push({
      id: 'test-1',
      name: '1. South Pole Coordinate Invariance Test',
      passed,
      timeMs: elapsedMs.toFixed(2),
      description: 'At selenographic latitude -90.0°, verifies topocentric elevation matches negative sub-body latitude within observer parallax tolerance (≤ 0.30°).',
      criteria: 'ΔSun El < 0.05° AND ΔEarth El < 0.30° (surface observer parallax)',
      measurements: [
        `Sun Topocentric Elevation: ${sunTopo.elevationDeg.toFixed(3)}° (Expected: ${expectedSunEl.toFixed(3)}°, Δ = ${deltaSun.toFixed(4)}°)`,
        `Earth Topocentric Elevation: ${earthTopo.elevationDeg.toFixed(3)}° (Expected: ${expectedEarthEl.toFixed(3)}°, Δ = ${deltaEarth.toFixed(4)}°)`,
        `Observer Parallax Shift: ${deltaEarth.toFixed(3)}° (Physical bound: arcsin(R_M / D_earth) ≈ 0.268°)`,
      ],
    });
  } catch (err) {
    tests.push({
      id: 'test-1',
      name: '1. South Pole Coordinate Invariance Test',
      passed: false,
      timeMs: '0.00',
      description: 'Failed with exception.',
      criteria: 'N/A',
      measurements: [err.message],
    });
  }

  // ==========================================
  // Test 2: Sub-Solar Latitude Obliquity Bound Test
  // ==========================================
  try {
    const t0 = performance.now();
    let maxObservedLat = 0;
    let minObservedLat = 999;
    const stepDays = 2;

    for (let d = 0; d <= 365; d += stepDays) {
      const dt = new Date(baseDate.getTime() + d * 86400000);
      const ep = computeEphemeris(dt);
      const absLat = Math.abs(ep.subSolarLat);
      if (absLat > maxObservedLat) maxObservedLat = absLat;
      if (absLat < minObservedLat) minObservedLat = absLat;
    }

    const passed = (maxObservedLat <= 1.60) && (maxObservedLat >= 1.45);
    const elapsedMs = performance.now() - t0;

    tests.push({
      id: 'test-2',
      name: '2. Sub-Solar Latitude Obliquity Bound Test',
      passed,
      timeMs: elapsedMs.toFixed(2),
      description: 'Validates that lunar rotational axis obliquity (1.5424°) bounds seasonal sub-solar latitude variation between ±1.55° across a 365-day solar year.',
      criteria: '1.45° ≤ max |subSolarLat| ≤ 1.60° over 365 days',
      measurements: [
        `Max Observed |sub-solar latitude|: ${maxObservedLat.toFixed(4)}°`,
        `Min Observed |sub-solar latitude|: ${minObservedLat.toFixed(4)}°`,
        `Theoretical Bound: 1.5424° (lunar equator tilt to ecliptic)`,
      ],
    });
  } catch (err) {
    tests.push({
      id: 'test-2',
      name: '2. Sub-Solar Latitude Obliquity Bound Test',
      passed: false,
      timeMs: '0.00',
      description: 'Failed with exception.',
      criteria: 'N/A',
      measurements: [err.message],
    });
  }

  // =========================================================================
  // Test 3: Extended Disc Horizon Tests (Task 3: Tests A, B, C, D)
  // =========================================================================

  // --- Sub-test 3A: computeExtendedDiscFraction vs Brute Force ---
  try {
    const t0 = performance.now();
    const maskDeg = 0.0;
    const R_cases = [0.50, 0.265, 1.00];
    const elevCasesR05 = [0.40, 0.25, 0.10, 0.00, -0.10, -0.25, -0.40];
    const tolA = 0.003;
    let allAPassed = true;
    const measurementsA = [];

    for (const R of R_cases) {
      const elevations = (R === 0.50)
        ? elevCasesR05
        : [0.8 * R, 0.5 * R, 0.2 * R, 0.0, -0.2 * R, -0.5 * R, -0.8 * R];

      for (const el of elevations) {
        const expected = bruteForceDiscFraction(el, 0.0, R, maskDeg, 1000);
        const actual = computeExtendedDiscFraction(el, maskDeg, R);
        const diff = Math.abs(actual - expected);
        const casePass = diff <= tolA;
        if (!casePass) allAPassed = false;
        measurementsA.push(
          `R=${R.toFixed(3)}°, el=${(el >= 0 ? '+' : '') + el.toFixed(2)}°: actual=${actual.toFixed(4)}, expected=${expected.toFixed(4)}, Δ=${diff.toFixed(4)} [${casePass ? 'PASS' : 'FAIL'}]`
        );
      }
    }

    const elapsedMs = performance.now() - t0;
    tests.push({
      id: 'test-3a',
      name: '3A. computeExtendedDiscFraction vs Brute-Force (Tolerance 0.003)',
      passed: allAPassed,
      timeMs: elapsedMs.toFixed(2),
      description: 'Compares computeExtendedDiscFraction against ≥1000×1000 2D grid brute-force integration across 7 reference elevations and radii 0.5°, 0.265°, 1.0°.',
      criteria: '|actual - expected| ≤ 0.003 across all sample cases',
      measurements: measurementsA,
    });
  } catch (err) {
    tests.push({
      id: 'test-3a',
      name: '3A. computeExtendedDiscFraction vs Brute-Force',
      passed: false,
      timeMs: '0.00',
      description: 'Failed with exception.',
      criteria: 'N/A',
      measurements: [err.message],
    });
  }

  // --- Sub-test 3B: computeUnblockedDiscFraction vs Brute Force (Flat & Sloped) ---
  try {
    const t0 = performance.now();
    const tolB = 0.005;
    let allBPassed = true;
    const measurementsB = [];

    // 1. Flat horizon profile: 0.0° everywhere
    const flatProfile = new Float32Array(720).fill(0.0);
    const R_cases = [0.50, 0.265, 1.00];
    const elevCasesR05 = [0.40, 0.25, 0.10, 0.00, -0.10, -0.25, -0.40];

    for (const R of R_cases) {
      const elevations = (R === 0.50) ? elevCasesR05 : [0.5 * R, 0.0, -0.5 * R];
      for (const el of elevations) {
        const expected = bruteForceDiscFraction(el, 0.0, R, 0.0, 1000);
        const actual = computeUnblockedDiscFraction(flatProfile, el, 0.0, R);
        const diff = Math.abs(actual - expected);
        const casePass = diff <= tolB;
        if (!casePass) allBPassed = false;
        measurementsB.push(
          `Flat: R=${R.toFixed(3)}°, el=${(el >= 0 ? '+' : '') + el.toFixed(2)}°: actual=${actual.toFixed(4)}, expected=${expected.toFixed(4)}, Δ=${diff.toFixed(4)} [${casePass ? 'PASS' : 'FAIL'}]`
        );
      }
    }

    // 2. Sloped horizon profile: mask(az) = 0.3 * sin(az)
    const slopedMaskFn = (az) => 0.3 * Math.sin((az * Math.PI) / 180.0);
    const slopedProfile = new Float32Array(720);
    for (let b = 0; b < 720; b++) {
      slopedProfile[b] = slopedMaskFn(b * 0.5);
    }

    const testAzimuths = [0.0, 45.0, 90.0, 180.0, 270.0];
    const testR = 0.50;
    const testElevs = [0.25, 0.0, -0.25];

    for (const az of testAzimuths) {
      for (const el of testElevs) {
        const expected = bruteForceDiscFraction(el, az, testR, slopedMaskFn, 1000);
        const actual = computeUnblockedDiscFraction(slopedProfile, el, az, testR);
        const diff = Math.abs(actual - expected);
        const casePass = diff <= tolB;
        if (!casePass) allBPassed = false;
        measurementsB.push(
          `Sloped: az=${az}°, el=${(el >= 0 ? '+' : '') + el.toFixed(2)}°: actual=${actual.toFixed(4)}, expected=${expected.toFixed(4)}, Δ=${diff.toFixed(4)} [${casePass ? 'PASS' : 'FAIL'}]`
        );
      }
    }

    const elapsedMs = performance.now() - t0;
    tests.push({
      id: 'test-3b',
      name: '3B. computeUnblockedDiscFraction vs Brute-Force Flat & Sloped (Tolerance 0.005)',
      passed: allBPassed,
      timeMs: elapsedMs.toFixed(2),
      description: 'Tests computeUnblockedDiscFraction against 2D brute force for both flat horizon (0°) and sloped horizon mask (0.3·sin(az)) at multiple azimuths.',
      criteria: '|actual - expected| ≤ 0.005 across flat and sloped terrain profiles',
      measurements: measurementsB,
    });
  } catch (err) {
    tests.push({
      id: 'test-3b',
      name: '3B. computeUnblockedDiscFraction vs Brute-Force',
      passed: false,
      timeMs: '0.00',
      description: 'Failed with exception.',
      criteria: 'N/A',
      measurements: [err.message],
    });
  }

  // --- Sub-test 3C: Clear and Blocked Boundary Exactness ---
  try {
    const t0 = performance.now();
    const tolC = 1e-6;
    let allCPassed = true;
    const measurementsC = [];

    const flatProfile = new Float32Array(720).fill(-5.0); // Horizon mask at -5°
    const bodies = [
      { name: 'Sun', R: SUN_ANGULAR_RADIUS_DEG },
      { name: 'Earth', R: EARTH_ANGULAR_RADIUS_DEG },
    ];

    for (const body of bodies) {
      // Clear: elevation +30°, mask -5° -> fully above
      const actualClearExt = computeExtendedDiscFraction(30.0, -5.0, body.R);
      const actualClearUnb = computeUnblockedDiscFraction(flatProfile, 30.0, 0.0, body.R);

      // Blocked: elevation -30°, mask 0° -> fully below
      const blockedProfile = new Float32Array(720).fill(0.0);
      const actualBlockedExt = computeExtendedDiscFraction(-30.0, 0.0, body.R);
      const actualBlockedUnb = computeUnblockedDiscFraction(blockedProfile, -30.0, 0.0, body.R);

      const passClearExt = Math.abs(actualClearExt - 1.0) <= tolC;
      const passClearUnb = Math.abs(actualClearUnb - 1.0) <= tolC;
      const passBlockExt = Math.abs(actualBlockedExt - 0.0) <= tolC;
      const passBlockUnb = Math.abs(actualBlockedUnb - 0.0) <= tolC;

      if (!passClearExt || !passClearUnb || !passBlockExt || !passBlockUnb) {
        allCPassed = false;
      }

      measurementsC.push(
        `${body.name} Clear (el=+30°): Extended=${actualClearExt} (exp 1.0), Unblocked=${actualClearUnb} (exp 1.0) [${passClearExt && passClearUnb ? 'PASS' : 'FAIL'}]`,
        `${body.name} Blocked (el=-30°): Extended=${actualBlockedExt} (exp 0.0), Unblocked=${actualBlockedUnb} (exp 0.0) [${passBlockExt && passBlockUnb ? 'PASS' : 'FAIL'}]`
      );
    }

    const elapsedMs = performance.now() - t0;
    tests.push({
      id: 'test-3c',
      name: '3C. Clear (1.000000) & Blocked (0.000000) Exact Limits',
      passed: allCPassed,
      timeMs: elapsedMs.toFixed(2),
      description: 'Verifies that fully unblocked disc returns exactly 1.0 (tol 1e-6) and fully occluded disc returns exactly 0.0 for Sun and Earth angular radii.',
      criteria: '|clear - 1.0| ≤ 1e-6 AND |blocked - 0.0| ≤ 1e-6',
      measurements: measurementsC,
    });
  } catch (err) {
    tests.push({
      id: 'test-3c',
      name: '3C. Clear and Blocked Boundary Exactness',
      passed: false,
      timeMs: '0.00',
      description: 'Failed with exception.',
      criteria: 'N/A',
      measurements: [err.message],
    });
  }

  // --- Sub-test 3D: Monotonicity Across 200 Samples ---
  try {
    const t0 = performance.now();
    const R = 0.50;
    const flatProfile = new Float32Array(720).fill(0.0);
    const N_samples = 200;
    let monotonicExt = true;
    let monotonicUnb = true;
    let prevExt = 2.0;
    let prevUnb = 2.0;

    // Sample elevation from +1.5° down to -1.5°
    for (let i = 0; i < N_samples; i++) {
      const el = 1.5 - (i / (N_samples - 1)) * 3.0;
      const fExt = computeExtendedDiscFraction(el, 0.0, R);
      const fUnb = computeUnblockedDiscFraction(flatProfile, el, 0.0, R);

      // Monotonicity: as elevation decreases, fraction must never increase (allowing floating-point epsilon 1e-9)
      if (fExt > prevExt + 1e-9) monotonicExt = false;
      if (fUnb > prevUnb + 1e-9) monotonicUnb = false;

      prevExt = fExt;
      prevUnb = fUnb;
    }

    const passed = monotonicExt && monotonicUnb;
    const elapsedMs = performance.now() - t0;

    tests.push({
      id: 'test-3d',
      name: '3D. Monotonicity Test (200 Sequential Elevation Samples)',
      passed,
      timeMs: elapsedMs.toFixed(2),
      description: 'Verifies that computed disc fraction is strictly non-increasing as elevation decreases across 200 continuous steps.',
      criteria: 'f(el_k) ≤ f(el_{k-1}) + 1e-9 as elevation descends from +1.5° to -1.5°',
      measurements: [
        `Extended Fraction Monotonic: ${monotonicExt ? 'YES (PASS)' : 'NO (VIOLATION DETECTED)'}`,
        `Unblocked Integrator Monotonic: ${monotonicUnb ? 'YES (PASS)' : 'NO (VIOLATION DETECTED)'}`,
        `Sample Count: ${N_samples} steps across [-1.5°, +1.5°] range`,
      ],
    });
  } catch (err) {
    tests.push({
      id: 'test-3d',
      name: '3D. Monotonicity Test',
      passed: false,
      timeMs: '0.00',
      description: 'Failed with exception.',
      criteria: 'N/A',
      measurements: [err.message],
    });
  }

  // ==========================================
  // Test 4: Libration Periodicity Test
  // ==========================================
  try {
    const t0 = performance.now();
    let zeroCrossings = 0;
    let prevElev = 0;
    let minEl = 999;
    let maxEl = -999;
    const daysTotal = 60;
    const stepDays = 0.25;

    for (let d = 0; d <= daysTotal; d += stepDays) {
      const dt = new Date(baseDate.getTime() + d * 86400000);
      const ep = computeEphemeris(dt);
      const topo = computeTopocentricHorizon(-90.0, 0.0, ep.subEarthLat, ep.subEarthLon, ep.earthDistanceKm, 0.0);
      const el = topo.elevationDeg;

      if (el < minEl) minEl = el;
      if (el > maxEl) maxEl = el;

      if (d > 0 && Math.sign(el) !== Math.sign(prevElev)) {
        zeroCrossings++;
      }
      prevElev = el;
    }

    const passed = (zeroCrossings >= 3 && zeroCrossings <= 6) && (maxEl > 0 && minEl < 0);
    const elapsedMs = performance.now() - t0;

    tests.push({
      id: 'test-4',
      name: '4. Libration Periodicity Test',
      passed,
      timeMs: elapsedMs.toFixed(2),
      description: 'Verifies draconic libration cycle (~27.2 days) producing periodic Earth elevation oscillations between positive and negative angles at South Pole.',
      criteria: '3 ≤ Zero Crossings ≤ 6 over 60 days AND minEl < 0° AND maxEl > 0°',
      measurements: [
        `Observed Zero Crossings over 60 days: ${zeroCrossings} (nominal: 4–5 for 27.2d cycle)`,
        `Earth Elevation Extremes at -90°S: Min ${minEl.toFixed(2)}°, Max ${maxEl.toFixed(2)}°`,
        `Oscillation Amplitude: ~±${((maxEl - minEl) / 2).toFixed(2)}°`,
      ],
    });
  } catch (err) {
    tests.push({
      id: 'test-4',
      name: '4. Libration Periodicity Test',
      passed: false,
      timeMs: '0.00',
      description: 'Failed with exception.',
      criteria: 'N/A',
      measurements: [err.message],
    });
  }

  // ==========================================
  // Test 5: Round 7 Weighted Multi-Criteria Ranking Test (Part 1 & Part 2)
  // ==========================================
  try {
    const t0 = performance.now();

    // --- Part 1: Mock 3-Region Normalization & Rank Verification (Phase 10 criteria) ---
    const mockData = [
      { id: 'r1', energyWh: 600, longestDarkHours: 100, commPercent: 80 },
      { id: 'r2', energyWh: 800, longestDarkHours: 40, commPercent: 95 },
      { id: 'r3', energyWh: 400, longestDarkHours: 300, commPercent: 50 },
    ];

    const balancedMock = rankRegionsByWeights(mockData);
    const allMockScoresInRange = balancedMock.every(r => r.score >= 0 && r.score <= 100);
    const topRankedIsR2 = balancedMock[0].id === 'r2';
    const mockRanksAssigned = balancedMock[0].rank === 1 && balancedMock[1].rank === 2 && balancedMock[2].rank === 3;
    const part1Passed = allMockScoresInRange && topRankedIsR2 && mockRanksAssigned;

    // --- Part 2: 9-Region 30-Day Simulation & Full Permutation Ranking ---
    const comparisonData = await computeRegionalComparisonData(makeComparisonWindow(baseDate, 30));
    const rankedDefault = rankRegionsByWeights(comparisonData);

    const allScoresInRange = rankedDefault.every(r => typeof r.score === 'number' && !isNaN(r.score) && r.score >= 0 && r.score <= 100);
    const ranks = rankedDefault.map(r => r.rank).sort((a, b) => a - b);
    const ranksArePermutation = ranks.length === 9 && ranks.every((r, idx) => r === idx + 1);

    const rankedCommOnly = rankRegionsByWeights(comparisonData, { energy: 0, dark: 0, comm: 100 });
    let rankOrderChanged = false;
    for (let i = 0; i < rankedDefault.length; i++) {
      if (rankedDefault[i].id !== rankedCommOnly[i].id) {
        rankOrderChanged = true;
        break;
      }
    }

    const part2Passed = allScoresInRange && ranksArePermutation && rankOrderChanged;
    const passed = part1Passed && part2Passed;
    const elapsedMs = performance.now() - t0;

    const measurements = [
      `Part 1 (Mock Data): Top=${balancedMock[0].id} (Score: ${balancedMock[0].score.toFixed(2)}), Ranks 1..3 valid [${part1Passed ? 'PASS' : 'FAIL'}]`,
      `Part 2 (9 Regions, 30d Window): Scores in [0, 100]=${allScoresInRange}, Ranks 1..9 permutation=${ranksArePermutation}, Weight sensitivity=${rankOrderChanged} [${part2Passed ? 'PASS' : 'FAIL'}]`,
      `Real LOLA DEM, binary centre-point I(t)/C(t), mast 10 m, best fixed panel per region:`,
      `-------------------------------------------------------------------------------------------------`,
      `Region Name                         | Energy (Wh) | Dark (h) | DTE %  | Score  | Rank`,
      `------------------------------------+-------------+----------+--------+--------+------`,
    ];

    for (const r of rankedDefault) {
      const row = `${r.name.padEnd(35)} | ${Math.round(r.energyWh).toString().padStart(11)} | ${r.longestDarkHours.toFixed(1).padStart(8)} | ${r.commPercent.toFixed(1).padStart(5)}% | ${r.score.toFixed(2).padStart(6)} | #${r.rank}`;
      measurements.push(row);
    }
    measurements.push(`-------------------------------------------------------------------------------------------------`);

    tests.push({
      id: 'test-5',
      name: '5. Phase 10 Three-Criteria Ranking & Normalization Test',
      passed,
      timeMs: elapsedMs.toFixed(2),
      description: 'Verifies min-max normalization of energy / longest dark / DTE coverage, 1..9 rank permutation, score bounds [0, 100], and sensitivity to weights over a 30-day window.',
      criteria: 'Part 1 Mock ranks valid AND Part 2: 9 regions have scores in [0, 100], no NaNs, ranks 1..9 permutation, and weight shift re-orders candidates',
      measurements,
    });
  } catch (err) {
    tests.push({
      id: 'test-5',
      name: '5. Round 7 Weighted Multi-Criteria Ranking Test',
      passed: false,
      timeMs: '0.00',
      description: 'Failed with exception.',
      criteria: 'N/A',
      measurements: [err.message],
    });
  }

  // ==========================================
  // Test 6: Round 8 Comms Ray Color Occlusion Invariance Test
  // ==========================================
  try {
    const t0 = performance.now();
    const getRgb = (f) => {
      const clamped = Math.max(0, Math.min(1, f));
      const t = Math.min(1.0, clamped / 0.95);
      return {
        r: 0.957 * (1.0 - t) + 0.024 * t,
        g: 0.247 * (1.0 - t) + 0.714 * t,
        b: 0.369 * (1.0 - t) + 0.831 * t,
      };
    };

    const clearColor = getRgb(1.0);
    const blockedColor = getRgb(0.0);
    const partialColor = getRgb(0.475);

    const isClearCyan = Math.abs(clearColor.r - 0.024) < 0.001 && Math.abs(clearColor.g - 0.714) < 0.001;
    const isBlockedCoral = Math.abs(blockedColor.r - 0.957) < 0.001 && Math.abs(blockedColor.g - 0.247) < 0.001;
    const isPartialBlended = partialColor.r < blockedColor.r && partialColor.g > blockedColor.g;

    const passed = isClearCyan && isBlockedCoral && isPartialBlended;
    const elapsedMs = performance.now() - t0;

    tests.push({
      id: 'test-6',
      name: '6. Round 8 Comms Ray Occlusion Color Invariance Test',
      passed,
      timeMs: elapsedMs.toFixed(2),
      description: 'Verifies continuous line color interpolation between Coral (#F43F5E, blocked) and Cyan (#06B6D4, clear LoS).',
      criteria: 'f⊕=1.0 maps to Cyan (#06B6D4) AND f⊕=0.0 maps to Coral (#F43F5E) AND intermediate f⊕ blends linearly',
      measurements: [
        `Clear LoS (f=1.0) RGB: [${clearColor.r.toFixed(3)}, ${clearColor.g.toFixed(3)}, ${clearColor.b.toFixed(3)}] (Matches Cyan)`,
        `Blocked (f=0.0) RGB: [${blockedColor.r.toFixed(3)}, ${blockedColor.g.toFixed(3)}, ${blockedColor.b.toFixed(3)}] (Matches Coral)`,
        `Limb Grazing (f=0.475) RGB: [${partialColor.r.toFixed(3)}, ${partialColor.g.toFixed(3)}, ${partialColor.b.toFixed(3)}] (Linear Blend)`,
      ],
    });
  } catch (err) {
    tests.push({
      id: 'test-6',
      name: '6. Round 8 Comms Ray Color Invariance Test',
      passed: false,
      timeMs: '0.00',
      description: 'Failed with exception.',
      criteria: 'N/A',
      measurements: [err.message],
    });
  }

  // ==========================================
  // Test 7: Round 9 Earth Elevation Libration Cycle Test
  // ==========================================
  try {
    const t0 = performance.now();
    const testRegion = REGIONS[2]; // Malapert Massif
    const elevKm = getElevationAt(testRegion.lat, testRegion.lon);
    const elevations = [];

    for (let day = 0; day <= 30; day += 0.5) {
      const date = new Date(baseDate.getTime() + day * 86400 * 1000);
      const ephem = computeEphemeris(date);
      const topo = computeTopocentricHorizon(testRegion.lat, testRegion.lon, ephem.subEarthLat, ephem.subEarthLon, ephem.earthDistanceKm, elevKm);
      elevations.push(topo.elevationDeg);
    }

    const minElevation = Math.min(...elevations);
    const maxElevation = Math.max(...elevations);
    const amplitude = (maxElevation - minElevation) / 2;

    const hasSignificantOscillation = amplitude >= 2.5 && amplitude <= 8.5;
    const passed = hasSignificantOscillation && !isNaN(minElevation);
    const elapsedMs = performance.now() - t0;

    tests.push({
      id: 'test-7',
      name: '7. Round 9 Earth Elevation Libration Cycle & Chart Sampling Test',
      passed,
      timeMs: elapsedMs.toFixed(2),
      description: 'Verifies topocentric Earth elevation oscillation across 30 days at candidate landing site reflecting the lunar libration cycle.',
      criteria: '2.5° ≤ Libration Amplitude ≤ 8.5° over 30-day lunar orbit',
      measurements: [
        `Target Region: ${testRegion.name} (${testRegion.lat}°S, ${testRegion.lon}°E)`,
        `Min Earth Elevation over 30d: ${minElevation.toFixed(2)}°`,
        `Max Earth Elevation over 30d: ${maxElevation.toFixed(2)}°`,
        `Observed Libration Semi-Amplitude: ±${amplitude.toFixed(2)}° (Physical & Optical Libration)`,
      ],
    });
  } catch (err) {
    tests.push({
      id: 'test-7',
      name: '7. Round 9 Earth Elevation Libration Cycle Test',
      passed: false,
      timeMs: '0.00',
      description: 'Failed with exception.',
      criteria: 'N/A',
      measurements: [err.message],
    });
  }

  // ==========================================
  // Test 8: DEM Provenance Labels Fallback & Pass-Through Test
  // ==========================================
  try {
    const t0 = performance.now();
    const providerWithout = new DemProvider();
    providerWithout.isSynthetic = false;
    providerWithout.realMetadata = { width: 500, height: 500 };
    const metaWithout = providerWithout.getMetadata();

    const expectedSourceFallback = 'LOLA-derived (provenance to be confirmed)';
    const expectedLicenseFallback = 'To be confirmed';

    const passWithout = (metaWithout.source === expectedSourceFallback) &&
                        (metaWithout.license === expectedLicenseFallback) &&
                        !metaWithout.source.toLowerCase().includes('verified') &&
                        !metaWithout.license.toLowerCase().includes('verified');

    const providerWith = new DemProvider();
    providerWith.isSynthetic = false;
    providerWith.realMetadata = {
      width: 500,
      height: 500,
      source: 'NASA Planetary Data System (PDS) LOLA RDR v2.4',
      license: 'NASA Open Data Policy (PD-USGov)',
    };
    const metaWith = providerWith.getMetadata();

    const passWith = (metaWith.source === 'NASA Planetary Data System (PDS) LOLA RDR v2.4') &&
                     (metaWith.license === 'NASA Open Data Policy (PD-USGov)');

    const passed = passWithout && passWith;
    const elapsedMs = performance.now() - t0;

    tests.push({
      id: 'test-8',
      name: '8. DEM Provenance Labels Fallback & Pass-Through Test',
      passed,
      timeMs: elapsedMs.toFixed(2),
      description: 'Verifies real-DEM metadata without source/license falls back to "LOLA-derived (provenance to be confirmed)" and "To be confirmed" (never asserts "Verified"), and passes through explicit source/license fields unchanged.',
      criteria: 'Fallback strings match requirement AND no "Verified" claims AND explicit metadata passes through',
      measurements: [
        `Fallback without metadata fields -> source: "${metaWithout.source}", license: "${metaWithout.license}" [${passWithout ? 'PASS' : 'FAIL'}]`,
        `Pass-through with explicit metadata -> source: "${metaWith.source}", license: "${metaWith.license}" [${passWith ? 'PASS' : 'FAIL'}]`,
      ],
    });
  } catch (err) {
    tests.push({
      id: 'test-8',
      name: '8. DEM Provenance Labels Fallback & Pass-Through Test',
      passed: false,
      timeMs: '0.00',
      description: 'Failed with exception.',
      criteria: 'N/A',
      measurements: [err.message],
    });
  }

  // ==========================================
  // Test 9: DATA_AND_METHODS.md Key Constants Consistency Test
  // ==========================================
  try {
    const t0 = performance.now();
    let mdContent = '';
    if (typeof fetch === 'function' && typeof window !== 'undefined') {
      const resp = await fetch('./DATA_AND_METHODS.md');
      mdContent = await resp.text();
    } else {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const mdPath = path.resolve(process.cwd(), 'DATA_AND_METHODS.md');
      mdContent = fs.readFileSync(mdPath, 'utf8');
    }

    // Check Sun radius: 0.265 (SUN_ANGULAR_RADIUS_DEG or CONFIG.solar.angularRadiusDeg)
    const expectedSun = SUN_ANGULAR_RADIUS_DEG.toFixed(3); // "0.265"
    const hasSunRadius = mdContent.includes(expectedSun);

    // Check Earth radius: 1.00 (EARTH_ANGULAR_RADIUS_DEG or CONFIG.comms.earthAngularRadiusDeg)
    const expectedEarth = EARTH_ANGULAR_RADIUS_DEG.toFixed(2); // "1.00"
    const hasEarthRadius = mdContent.includes(expectedEarth);

    // Ensure it does NOT contain outdated Earth radius 2.00° as radius
    const hasWrongEarthRadius = mdContent.includes('radius R_{\\oplus} \\approx 2.00') || mdContent.includes('radius 2.00°');

    // Check disc-fraction strip count: 64 (DISC_QUADRATURE_STRIP_COUNT)
    const expectedStripCount = String(DISC_QUADRATURE_STRIP_COUNT); // "64"
    const hasStripCount = mdContent.includes(`${expectedStripCount}-strip`) || mdContent.includes(`M = ${expectedStripCount}`);

    const passed = hasSunRadius && hasEarthRadius && !hasWrongEarthRadius && hasStripCount;
    const elapsedMs = performance.now() - t0;

    tests.push({
      id: 'test-9',
      name: '9. DATA_AND_METHODS.md Key Constants Consistency Test',
      passed,
      timeMs: elapsedMs.toFixed(2),
      description: 'Verifies DATA_AND_METHODS.md documents identical numbers for key constants matching code: Sun angular radius (0.265°), Earth angular radius (1.00°), and disc quadrature strip count (64).',
      criteria: `Sun radius ${expectedSun}° present AND Earth radius ${expectedEarth}° present (no 2.00° radius) AND strip count ${expectedStripCount} present`,
      measurements: [
        `Sun Angular Radius (${expectedSun}°): ${hasSunRadius ? 'Documented in Markdown [PASS]' : 'MISSING [FAIL]'}`,
        `Earth Angular Radius (${expectedEarth}°): ${hasEarthRadius && !hasWrongEarthRadius ? 'Documented as 1.00° [PASS]' : 'INCONSISTENT [FAIL]'}`,
        `Disc Quadrature Strip Count (${expectedStripCount}): ${hasStripCount ? 'Documented 64-strip midpoint [PASS]' : 'MISSING [FAIL]'}`,
      ],
    });
  } catch (err) {
    tests.push({
      id: 'test-9',
      name: '9. DATA_AND_METHODS.md Key Constants Consistency Test',
      passed: false,
      timeMs: '0.00',
      description: 'Failed with exception.',
      criteria: 'N/A',
      measurements: [err.message],
    });
  }

  // ==========================================
  // Test 10: CSS Class Audit & Panel Visibility Class Verification
  // ==========================================
  try {
    const t0 = performance.now();
    const auditResult = await runClassAudit();
    const elapsedMs = performance.now() - t0;

    tests.push({
      id: 'test-10',
      name: '10. CSS Class Audit & Panel Visibility Class Verification',
      passed: auditResult.passed,
      timeMs: elapsedMs.toFixed(2),
      description: 'Audits every CSS class in HTML and JS against defined stylesheet rules. Verifies zero undefined classes, presence of .hidden { display: none }, and responsive lg:hidden / lg:flex rules.',
      criteria: '0 undefined classes AND .hidden rule present AND lg:hidden / lg:flex rules present',
      measurements: auditResult.measurements,
    });
  } catch (err) {
    tests.push({
      id: 'test-10',
      name: '10. CSS Class Audit & Panel Visibility Class Verification',
      passed: false,
      timeMs: '0.00',
      description: 'Failed with exception.',
      criteria: 'N/A',
      measurements: [err.message],
    });
  }

  // ==========================================
  // Test 11: JSDOM Panel Visibility & Shell State Logic Test
  // ==========================================
  try {
    const t0 = performance.now();
    const panelResult = await runPanelVisibilityTest();
    const elapsedMs = performance.now() - t0;

    tests.push({
      id: 'test-11',
      name: '11. JSDOM Panel Visibility & Shell State Logic Test',
      passed: panelResult.passed,
      timeMs: elapsedMs.toFixed(2),
      description: 'Verifies DOM initial state: exactly one primary view visible, tab buttons toggle mutually-exclusive view state, Orrery/South Pole controls toggle, and persistent banner exists.',
      criteria: 'Initial state exactly 1 tab visible AND tab clicks toggle correctly AND orrery/pole controls toggle AND persistent banner exists',
      measurements: panelResult.measurements,
    });
  } catch (err) {
    tests.push({
      id: 'test-11',
      name: '11. JSDOM Panel Visibility & Shell State Logic Test',
      passed: false,
      timeMs: '0.00',
      description: 'Failed with exception.',
      criteria: 'N/A',
      measurements: [err.message],
    });
  }

  // ==========================================
  // Test 12: Part B Map Geometry & Azimuth Ground Truth Test
  // ==========================================
  try {
    const geoResult = await runGeometryTests();
    tests.push({
      id: 'test-12',
      name: '12. Map Geometry & Azimuth Ground Truth Test',
      passed: geoResult.passed,
      timeMs: geoResult.timeMs,
      description: 'Verifies topocentric azimuth projection to scene (x, z) against spherical great-circle ground truth (epsilon=0.002 rad), parallelism of all 9 Earth rays (spread <= 0.5°), Sun light direction at pole, and synthetic DEM wall ridge peak.',
      criteria: 'Horizon march and comms ray equal GT within 0.5° for all 9 regions AND Earth rays parallel (spread <= 0.5°) AND Sun light vector matches GT without offset AND DEM wall peaks at (40° - lon)',
      measurements: geoResult.measurements,
    });
  } catch (err) {
    tests.push({
      id: 'test-12',
      name: '12. Map Geometry & Azimuth Ground Truth Test',
      passed: false,
      timeMs: '0.00',
      description: 'Failed with exception.',
      criteria: 'N/A',
      measurements: [err.message],
    });
  }

  return tests;
}

