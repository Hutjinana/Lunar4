/**
 * Artemis Lunar Landing Site Navigator - Region Data Integrity & Provenance Test Suite
 *
 * Requirements:
 * - Exactly 9 regions
 * - 5 region_centre + 4 candidate_site
 * - All status "sourced"
 * - Every source_url and reference_url starts with "https://"
 * - Every lat in [-90, -83] and lon in [-180, 180]
 * - No status contains "verified"
 * - No two regions share identical lat AND lon
 */

import { REGIONS } from '../regions.js';

export async function runRegionsTest() {
  const t0 = performance.now();
  const measurements = [];
  let passed = true;

  // 1. Exactly 9 regions
  const countPass = REGIONS.length === 9;
  if (!countPass) passed = false;
  measurements.push(`Region count: ${REGIONS.length} (expected 9) [${countPass ? 'PASS' : 'FAIL'}]`);

  // 2. 5 region_centre + 4 candidate_site
  const centreCount = REGIONS.filter((r) => r.kind === 'region_centre').length;
  const siteCount = REGIONS.filter((r) => r.kind === 'candidate_site').length;
  const kindsPass = centreCount === 5 && siteCount === 4;
  if (!kindsPass) passed = false;
  measurements.push(
    `Kinds: ${centreCount} region_centre, ${siteCount} candidate_site (expected 5 + 4) [${kindsPass ? 'PASS' : 'FAIL'}]`
  );

  // 3. All status "sourced"
  const allSourced = REGIONS.every((r) => r.status === 'sourced');
  if (!allSourced) passed = false;
  measurements.push(`All status 'sourced': ${allSourced ? 'YES' : 'NO'} [${allSourced ? 'PASS' : 'FAIL'}]`);

  // 4. Every source_url and reference_url starts with https://
  const urlsPass = REGIONS.every(
    (r) =>
      typeof r.source_url === 'string' &&
      r.source_url.startsWith('https://') &&
      typeof r.reference_url === 'string' &&
      r.reference_url.startsWith('https://')
  );
  if (!urlsPass) passed = false;
  measurements.push(
    `All source_url & reference_url start with https://: ${urlsPass ? 'YES' : 'NO'} [${urlsPass ? 'PASS' : 'FAIL'}]`
  );

  // 5. Every lat in [-90,-83] and lon in [-180,180]
  const coordsRangePass = REGIONS.every(
    (r) => r.lat >= -90 && r.lat <= -83 && r.lon >= -180 && r.lon <= 180
  );
  if (!coordsRangePass) passed = false;
  measurements.push(
    `Coordinates in valid bounds (lat in [-90, -83], lon in [-180, 180]): ${coordsRangePass ? 'YES' : 'NO'} [${coordsRangePass ? 'PASS' : 'FAIL'}]`
  );

  // 6. No status contains "verified"
  const noVerified = REGIONS.every((r) => !String(r.status).toLowerCase().includes('verified'));
  if (!noVerified) passed = false;
  measurements.push(`No status contains 'verified': ${noVerified ? 'YES' : 'NO'} [${noVerified ? 'PASS' : 'FAIL'}]`);

  // 7. No two regions share identical lat AND lon
  const coordPairs = REGIONS.map((r) => `${r.lat},${r.lon}`);
  const uniqueCoordsPass = new Set(coordPairs).size === REGIONS.length;
  if (!uniqueCoordsPass) passed = false;
  measurements.push(`No duplicate lat/lon pairs: ${uniqueCoordsPass ? 'YES' : 'NO'} [${uniqueCoordsPass ? 'PASS' : 'FAIL'}]`);

  const elapsedMs = performance.now() - t0;
  return {
    id: 'test-13',
    name: '13. Region Provenance & Sourced Coordinates Integrity Test',
    passed,
    timeMs: elapsedMs.toFixed(2),
    criteria:
      'Exactly 9 regions (5 region_centre + 4 candidate_site) AND all status "sourced" (no "verified") AND all URLs https:// AND lat in [-90,-83], lon in [-180,180] AND unique lat/lon',
    measurements,
  };
}
