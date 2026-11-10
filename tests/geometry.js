/**
 * Artemis Lunar Landing Site Navigator - Map Geometry & Azimuth Ground Truth Test Suite
 * 
 * Verifies Part B Ground Truth Requirements:
 * 1. Independent spherical great-circle ground truth calculation stepping along
 *    t = cos(az) * N + sin(az) * E with epsilon = 0.002 rad.
 * 2. Horizon ray-march direction equals ground truth (tolerance 0.5°).
 * 3. Comms-ray direction equals ground truth (tolerance 0.5°).
 * 4. All 9 Earth rays are parallel to each other (spread <= 0.5°, direction ≈ 5.3° from +Z toward +X).
 * 5. Sun light direction in scene equals ground-truth Sun direction at (-90°, 0°) with true elevation.
 * 6. Synthetic DEM wall test: ridge at map angle 40° from +Z toward +X, 5 km away;
 *    horizon profile peaks at psi = (40° - lambda) mod 360°.
 */

import { REGIONS } from '../regions.js';
import { computeEphemeris, computeTopocentricHorizon } from '../src/ephemeris.js';
import { latLonToPolarStereo, demProvider } from '../src/demLoader.js';
import { computeHorizonMarchDirection, computeHorizonProfile } from '../src/horizon.js';
import { computeCommsRayVector, computePolarSunLightVector } from '../src/scene.js';

/**
 * Calculates independent spherical ground-truth scene-plane direction angle.
 * At (latDeg, lonDeg), steps epsilon = 0.002 rad along horizontal tangent
 * t = cos(az) * N + sin(az) * E on the unit sphere, projects to polar stereographic map,
 * and measures the resulting scene-plane (deltaX, -deltaY) direction angle in [0, 360).
 */
export function computeGroundTruthSceneDirection(latDeg, lonDeg, azDeg, epsilon = 0.002) {
  const phi = (latDeg * Math.PI) / 180.0;
  const lambda = (lonDeg * Math.PI) / 180.0;
  const azRad = (azDeg * Math.PI) / 180.0;

  // Observer unit vector u on sphere
  const u = [
    Math.cos(phi) * Math.cos(lambda),
    Math.cos(phi) * Math.sin(lambda),
    Math.sin(phi)
  ];

  // Local North N (increasing latitude toward equator)
  const N = [
    -Math.sin(phi) * Math.cos(lambda),
    -Math.sin(phi) * Math.sin(lambda),
    Math.cos(phi)
  ];

  // Local East E (increasing longitude)
  const E = [
    -Math.sin(lambda),
    Math.cos(lambda),
    0.0
  ];

  // Horizontal tangent vector t = cos(az)*N + sin(az)*E
  const t = [
    Math.cos(azRad) * N[0] + Math.sin(azRad) * E[0],
    Math.cos(azRad) * N[1] + Math.sin(azRad) * E[1],
    Math.cos(azRad) * N[2] + Math.sin(azRad) * E[2]
  ];

  // Step point p along great circle
  const p = [
    u[0] * Math.cos(epsilon) + t[0] * Math.sin(epsilon),
    u[1] * Math.cos(epsilon) + t[1] * Math.sin(epsilon),
    u[2] * Math.cos(epsilon) + t[2] * Math.sin(epsilon)
  ];

  const pNorm = Math.hypot(p[0], p[1], p[2]);
  const latP = (Math.asin(Math.max(-1, Math.min(1, p[2] / pNorm))) * 180.0) / Math.PI;
  const lonP = (Math.atan2(p[1], p[0]) * 180.0) / Math.PI;

  const p0 = latLonToPolarStereo(latDeg, lonDeg);
  const p1 = latLonToPolarStereo(latP, lonP);

  const deltaX = p1.x - p0.x;
  const deltaY = p1.y - p0.y;

  // In 3D scene (x, z) = (mapX, -mapY), so displacement is (deltaX, -deltaY)
  const sceneX = deltaX;
  const sceneZ = -deltaY;

  return ((Math.atan2(sceneX, sceneZ) * 180.0) / Math.PI + 360.0) % 360.0;
}

/**
 * Computes shortest angular difference in degrees in [-180, 180]
 */
export function angularDifference(a, b) {
  return (((a - b + 180.0) % 360.0 + 360.0) % 360.0) - 180.0;
}

/**
 * Runs the comprehensive geometry validation suite.
 */
export async function runGeometryTests() {
  const t0 = performance.now();
  const testEpoch = new Date('2026-11-03T00:00:00Z');
  const ephem = computeEphemeris(testEpoch);
  const tolDeg = 0.5;

  const measurements = [];
  let allHorizonPassed = true;
  let allCommsPassed = true;
  let allParallelPassed = true;
  let sunLightPassed = true;
  let demWallPassed = true;

  // ==========================================
  // 1. Horizon ray-march direction vs ground truth (all 9 regions)
  // ==========================================
  measurements.push('--- Part 1: Horizon Ray-March Direction vs Ground Truth (Tolerance 0.5°) ---');
  for (const reg of REGIONS) {
    const topo = computeTopocentricHorizon(reg.lat, reg.lon, ephem.subEarthLat, ephem.subEarthLon, ephem.earthDistanceKm, 0.0);
    const marchDir = computeHorizonMarchDirection(topo.azimuthDeg, reg.lon);
    const gtDir = computeGroundTruthSceneDirection(reg.lat, reg.lon, topo.azimuthDeg);
    const diff = Math.abs(angularDifference(marchDir.angleDeg, gtDir));
    const pass = diff <= tolDeg;
    if (!pass) allHorizonPassed = false;
    measurements.push(
      `${reg.name.padEnd(22)} (lon ${reg.lon >= 0 ? '+' : ''}${reg.lon.toFixed(1)}°): march=${marchDir.angleDeg.toFixed(2)}°, GT=${gtDir.toFixed(2)}°, Δ=${diff.toFixed(2)}° [${pass ? 'PASS' : 'FAIL'}]`
    );
  }

  // ==========================================
  // 2. Comms-ray direction vs ground truth (all 9 regions)
  // ==========================================
  measurements.push('--- Part 2: Comms-Ray Direction vs Ground Truth (Tolerance 0.5°) ---');
  const commsAngles = [];
  for (const reg of REGIONS) {
    const topo = computeTopocentricHorizon(reg.lat, reg.lon, ephem.subEarthLat, ephem.subEarthLon, ephem.earthDistanceKm, 0.0);
    const commsVec = computeCommsRayVector(reg, topo);
    commsAngles.push(commsVec.angleDeg);
    const gtDir = computeGroundTruthSceneDirection(reg.lat, reg.lon, topo.azimuthDeg);
    const diff = Math.abs(angularDifference(commsVec.angleDeg, gtDir));
    const pass = diff <= tolDeg;
    if (!pass) allCommsPassed = false;
    measurements.push(
      `${reg.name.padEnd(22)} (lon ${reg.lon >= 0 ? '+' : ''}${reg.lon.toFixed(1)}°): comms=${commsVec.angleDeg.toFixed(2)}°, GT=${gtDir.toFixed(2)}°, Δ=${diff.toFixed(2)}° [${pass ? 'PASS' : 'FAIL'}]`
    );
  }

  // ==========================================
  // 3. Earth rays parallelism across all 9 regions (spread <= 0.5°, direction ≈ 5.3°)
  // ==========================================
  measurements.push('--- Part 3: Earth Rays Parallelism Across All 9 Regions ---');
  let minAngle = commsAngles[0];
  let maxAngle = commsAngles[0];
  for (const a of commsAngles) {
    if (a < minAngle) minAngle = a;
    if (a > maxAngle) maxAngle = a;
  }
  const spread = maxAngle - minAngle;
  allParallelPassed = spread <= tolDeg;
  measurements.push(
    `Ray Direction Spread across 9 regions: ${spread.toFixed(2)}° (Min ${minAngle.toFixed(2)}°, Max ${maxAngle.toFixed(2)}°, Max Allowable: 0.50°) [${allParallelPassed ? 'PASS' : 'FAIL'}]`
  );

  // ==========================================
  // 4. Sun light direction in scene equals ground-truth Sun direction at (-90°, 0°)
  // ==========================================
  measurements.push('--- Part 4: Polar Sun Light Vector vs Ground Truth at (-90°, 0°) ---');
  const sunTopo = computeTopocentricHorizon(-90.0, 0.0, ephem.subSolarLat, ephem.subSolarLon, 149597870.7, 0.0);
  const sunVec = computePolarSunLightVector(ephem);
  const gtSunDir = computeGroundTruthSceneDirection(-90.0, 0.0, sunTopo.azimuthDeg);
  const sunAngleDiff = Math.abs(angularDifference(sunVec.angleDeg, gtSunDir));
  const sunElevDiff = Math.abs(sunVec.elDeg - sunTopo.elevationDeg);
  sunLightPassed = (sunAngleDiff <= tolDeg) && (sunElevDiff <= 0.05);
  measurements.push(
    `Sun Light Azimuth: measured=${sunVec.angleDeg.toFixed(2)}°, GT=${gtSunDir.toFixed(2)}°, Δ=${sunAngleDiff.toFixed(2)}° [${sunAngleDiff <= tolDeg ? 'PASS' : 'FAIL'}]`
  );
  measurements.push(
    `Sun Light Elevation: measured=${sunVec.elDeg.toFixed(2)}°, true=${sunTopo.elevationDeg.toFixed(2)}°, Δ=${sunElevDiff.toFixed(2)}° (No +1.2° offset) [${sunElevDiff <= 0.05 ? 'PASS' : 'FAIL'}]`
  );

  // ==========================================
  // 5. Synthetic DEM Wall Test (ridge at map angle 40° from +Z toward +X, 5 km away)
  // ==========================================
  measurements.push('--- Part 5: Synthetic DEM Wall Horizon Profile Peak Verification ---');
  const monsMouton = REGIONS.find((r) => r.id === 'mons-mouton');
  const slaterPlain = REGIONS.find((r) => r.id === 'slater-plain');
  const testLongitudes = [
    { name: 'Cabeus B', lat: -83.6, lon: -68.8 },
    { name: 'Malapert', lat: -85.9, lon: 2.9 },
    { name: 'Mons Mouton', lat: monsMouton.lat, lon: monsMouton.lon },
    { name: 'Slater Plain', lat: slaterPlain.lat, lon: slaterPlain.lon },
  ];

  for (const tLoc of testLongitudes) {
    const obsPos = latLonToPolarStereo(tLoc.lat, tLoc.lon);
    // Ridge at map angle 40° from +Z toward +X, 5 km away
    // In map (x, y): unit direction is (sin(40°), -cos(40°)), unit normal is (cos(40°), sin(40°))
    const rad40 = (40.0 * Math.PI) / 180.0;
    const sin40 = Math.sin(rad40);
    const cos40 = Math.cos(rad40);

    const origElevationAtXY = demProvider.getElevationAtXY.bind(demProvider);
    const origElevationAt = demProvider.getElevationAt.bind(demProvider);

    try {
      demProvider.getElevationAtXY = (x, y) => {
        const dx = x - obsPos.x;
        const dy = y - obsPos.y;
        // Distance along ray at map angle 40°
        const distParallel = dx * sin40 - dy * cos40;
        // Perpendicular offset from ridge crest
        const distPerp = Math.abs(dx * cos40 + dy * sin40);

        if (distParallel >= 4.0 && distParallel <= 6.0 && distPerp <= 0.6) {
          // Ridge crest peaks at distPerp = 0
          return 5.0 * Math.cos((distPerp / 0.6) * (Math.PI / 2));
        }
        return 0.0;
      };
      demProvider.getElevationAt = () => 0.0;

      const profile = computeHorizonProfile(tLoc.lat, tLoc.lon, 10.0);
      let maxElev = -999;
      let maxBin = 0;
      for (let b = 0; b < profile.length; b++) {
        if (profile[b] > maxElev) {
          maxElev = profile[b];
          maxBin = b;
        }
      }

      const measuredPeakAzimuth = (maxBin * 360.0) / profile.length;
      const expectedPeakAzimuth = ((40.0 - tLoc.lon) % 360.0 + 360.0) % 360.0;
      const peakDiff = Math.abs(angularDifference(measuredPeakAzimuth, expectedPeakAzimuth));
      const peakPass = peakDiff <= 0.5; // Matches 0.5° bin resolution
      if (!peakPass) demWallPassed = false;

      measurements.push(
        `${tLoc.name.padEnd(14)} (lon ${tLoc.lon >= 0 ? '+' : ''}${tLoc.lon.toFixed(1)}°): measured peak=${measuredPeakAzimuth.toFixed(1)}°, expected (40°-λ)=${expectedPeakAzimuth.toFixed(1)}°, Δ=${peakDiff.toFixed(1)}° [${peakPass ? 'PASS' : 'FAIL'}]`
      );
    } finally {
      demProvider.getElevationAtXY = origElevationAtXY;
      demProvider.getElevationAt = origElevationAt;
    }
  }

  const passed = allHorizonPassed && allCommsPassed && allParallelPassed && sunLightPassed && demWallPassed;
  const elapsedMs = performance.now() - t0;

  return {
    passed,
    timeMs: elapsedMs.toFixed(2),
    measurements,
    details: {
      allHorizonPassed,
      allCommsPassed,
      allParallelPassed,
      sunLightPassed,
      demWallPassed,
    },
  };
}
