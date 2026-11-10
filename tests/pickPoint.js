/**
 * User-picked point tests: coordinate round trip, validation, horizon equivalence with a real region,
 * bounded horizon cache, and isolation from the 9-region comparison.
 */

import { REGIONS, regionKindLabel, regionStatusLabel } from '../regions.js';
import { latLonToPolarStereo, polarStereoToLatLon } from '../src/demLoader.js';
import { getRegionHorizonProfile, getUserPickCacheSize, USER_PICK_CACHE_LIMIT, USER_PICK_REGION_ID } from '../src/horizon.js';
import { computeRegionalComparisonData } from '../src/comparisonEngine.js';
import {
  validatePickedPoint,
  validatePickedPointFromForm,
  makeUserPointRegion,
  sceneXZToPickedPoint,
  distanceFromPoleKm,
} from '../src/pickPoint.js';

export async function runPickPointTest() {
  const t0 = performance.now();
  const measurements = [];
  let passed = true;
  const check = (label, ok) => {
    if (!ok) passed = false;
    measurements.push(`${label} [${ok ? 'PASS' : 'FAIL'}]`);
  };

  // 1. Round trip over 20 points (lat -80..-90, lon -180..180); skip lon within 0.5° of the pole
  let worstLat = 0;
  let worstLon = 0;
  for (let i = 0; i < 20; i++) {
    const lat = -80 - (10 * i) / 19;
    const lon = -180 + (360 * ((i * 7) % 20)) / 19;
    const { x, y } = latLonToPolarStereo(lat, lon);
    const back = polarStereoToLatLon(x, y);
    worstLat = Math.max(worstLat, Math.abs(back.lat - lat));
    if (lat < -89.5) continue;
    let dLon = Math.abs(back.lon - lon);
    if (dLon > 180) dLon = 360 - dLon; // ±180 are the same meridian
    worstLon = Math.max(worstLon, dLon);
  }
  check(`Round trip: max |Δlat|=${worstLat.toExponential(1)}°, max |Δlon|=${worstLon.toExponential(1)}° (<1e-6)`, worstLat < 1e-6 && worstLon < 1e-6);

  // 2. Validation
  const rejected = [
    ['lat -79.9', validatePickedPoint(-79.9, 0)],
    ['lat -90.1', validatePickedPoint(-90.1, 0)],
    ['lon 180.1', validatePickedPoint(-85, 180.1)],
    ['lat NaN', validatePickedPoint(NaN, 0)],
    ['lon NaN', validatePickedPoint(-85, NaN)],
    ["lat ''", validatePickedPoint('', 0)],
    ["lon ''", validatePickedPoint(-85, '')],
    ['form lat 79.9 °S', validatePickedPointFromForm('79.9', '0')],
    ['form lat 90.1 °S', validatePickedPointFromForm('90.1', '0')],
  ];
  check(`Rejected (${rejected.length}): ${rejected.every(([, r]) => !r.ok && r.message) ? 'all with message' : 'SOME ACCEPTED'}`, rejected.every(([, r]) => !r.ok && r.message));
  const accepted = [validatePickedPoint(-80, 0), validatePickedPoint(-90, 0), validatePickedPoint(-85, 180), validatePickedPoint(-85, -180), validatePickedPointFromForm('80', '-180'), validatePickedPointFromForm('90', '180')];
  check('Accepted: lat -80, -90; lon ±180 (and form 80/90 °S)', accepted.every((r) => r.ok));
  const exact = validatePickedPoint(-80, 180);
  check('Accepted values are returned unclamped', exact.ok && exact.lat === -80 && exact.lon === 180);

  // 3. Pseudo-region identity and labels
  const pr = makeUserPointRegion(-85, 10);
  check(
    'Pseudo-region fields and labels',
    pr.id === 'user-picked' && pr.name === 'User-picked point' && pr.kind === 'user_point' && pr.status === 'user_defined' &&
      pr.source === 'User-selected' && pr.source_url === '' && pr.reference_url === '' &&
      regionKindLabel(pr) === 'User-picked point (not a candidate region)' && regionStatusLabel(pr) === 'User-defined'
  );
  check(
    'Existing labels unchanged',
    regionKindLabel({ kind: 'region_centre' }) === 'Region centre (LROC mosaic)' &&
      regionKindLabel({ kind: 'candidate_site' }) === 'Candidate site (not region centre)' &&
      regionStatusLabel({ status: 'sourced' }) === 'Sourced – not NASA-verified'
  );

  // 4. Click mapping: inverse of the pin mapping (x = kmX*s, z = -kmY*s)
  const scale = 0.35;
  const malapert = REGIONS.find((r) => r.id === 'malapert-massif');
  const mk = latLonToPolarStereo(malapert.lat, malapert.lon);
  const click = sceneXZToPickedPoint(mk.x * scale, -mk.y * scale, scale);
  check(`Scene click -> lat/lon recovers Malapert (Δ=${click.ok ? Math.abs(click.lat - malapert.lat).toExponential(1) : 'n/a'}°)`, click.ok && Math.abs(click.lat - malapert.lat) < 1e-9 && Math.abs(click.lon - malapert.lon) < 1e-9);
  const corner = sceneXZToPickedPoint(300 * scale, 300 * scale, scale); // square corner, beyond 80°S
  check('Click in the square corner (outside 80°S) is rejected', !corner.ok);

  // 5. Distance from pole
  check(`Distance from pole at -90° = ${distanceFromPoleKm(-90, 0).toFixed(3)} km (0), at -80° = ${distanceFromPoleKm(-80, 0).toFixed(1)} km (≈304.0)`, distanceFromPoleKm(-90, 0) < 1e-9 && Math.abs(distanceFromPoleKm(-80, 0) - 304.0) < 0.1);

  // 6. Horizon profile of the pseudo-region equals the real region's profile at identical lat/lon
  const real = getRegionHorizonProfile(malapert.id, malapert.lat, malapert.lon);
  const user = getRegionHorizonProfile(USER_PICK_REGION_ID, malapert.lat, malapert.lon);
  let maxDiff = 0;
  for (let i = 0; i < real.length; i++) maxDiff = Math.max(maxDiff, Math.abs(real[i] - user[i]));
  check(`Pseudo-region horizon == Malapert horizon (${real.length} bins, max Δ=${maxDiff.toExponential(1)})`, real.length === user.length && maxDiff <= 1e-6);

  // 7. Cache cap: 60 distinct picks leave <= 50 user entries; real-region entries are not evicted
  const firstPick = getRegionHorizonProfile(USER_PICK_REGION_ID, -85, -170, 5);
  for (let i = 1; i < 60; i++) {
    getRegionHorizonProfile(USER_PICK_REGION_ID, -85 - i * 0.05, -170 + i * 5, 5);
  }
  const size = getUserPickCacheSize();
  check(`User cache entries after 60 picks: ${size} (limit ${USER_PICK_CACHE_LIMIT})`, size <= USER_PICK_CACHE_LIMIT);
  check('Oldest user pick was dropped (recomputed on request)', getRegionHorizonProfile(USER_PICK_REGION_ID, -85, -170, 5) !== firstPick);
  check('Real-region cache entry survived', getRegionHorizonProfile(malapert.id, malapert.lat, malapert.lon) === real);

  // 8. The comparison still has exactly 9 rows and REGIONS is untouched after a user pick
  const rows = await computeRegionalComparisonData({ startEpoch: new Date('2026-11-01T00:00:00Z'), spanDays: 2, stepMinutes: 120 });
  check(`Comparison rows after a user pick: ${rows.length} (expected 9)`, rows.length === 9 && rows.every((r) => r.id !== USER_PICK_REGION_ID));
  check(`REGIONS length ${REGIONS.length} (expected 9), no user point inside`, REGIONS.length === 9 && REGIONS.every((r) => r.kind !== 'user_point'));

  return {
    name: 'Test 16: User-Picked Point (validation, round trip, horizon, cache cap, isolation)',
    criteria: 'Picked points validate strictly, round-trip within 1e-6°, reuse the region horizon pipeline, cap cache at 50 and never join the 9-region comparison',
    passed,
    timeMs: (performance.now() - t0).toFixed(2),
    measurements,
  };
}
