/**
 * Terrain domain coverage test: the square mesh (±polarDomainSpanKm) must cover
 * every region pin, the horizon march, and the whole 80°S–90°S disc.
 */

import { CONFIG } from '../config.js';
import { REGIONS } from '../regions.js';
import { latLonToPolarStereo } from '../src/demLoader.js';
import { generateDemHeightfield } from '../src/terrain.js';
import { DEFAULT_HORIZON_RANGE_KM } from '../src/horizon.js';

export async function runDomainTest() {
  const t0 = performance.now();
  const measurements = [];
  let passed = true;
  const check = (label, ok) => {
    if (!ok) passed = false;
    measurements.push(`${label} [${ok ? 'PASS' : 'FAIL'}]`);
  };

  const span = CONFIG.radii.polarDomainSpanKm;
  const gridSize = CONFIG.radii.polarMeshGridSize;

  // 1. Every region pin lies inside the square with a 5 km margin
  let worstXY = 0;
  let worstReach = 0;
  for (const r of REGIONS) {
    const { x, y } = latLonToPolarStereo(r.lat, r.lon);
    worstXY = Math.max(worstXY, Math.abs(x), Math.abs(y));
    worstReach = Math.max(worstReach, Math.hypot(x, y) + DEFAULT_HORIZON_RANGE_KM);
  }
  check(`Max |x|,|y| over regions = ${worstXY.toFixed(1)} km (limit ${span - 5})`, worstXY <= span - 5);

  // 2. Horizon march (radial distance from pole + range) stays inside the domain
  check(`Max pole distance + horizon range = ${worstReach.toFixed(1)} km (limit ${span})`, worstReach <= span);

  // 3. The 80°S circle fits in the square domain
  let worstCircle = 0;
  for (let lon = -180; lon <= 180; lon += 5) {
    const { x, y } = latLonToPolarStereo(-80, lon);
    worstCircle = Math.max(worstCircle, Math.abs(x), Math.abs(y));
  }
  check(`80°S circle max |x|,|y| = ${worstCircle.toFixed(1)} km (limit ${span})`, worstCircle <= span);

  // 4. Heightfield at mesh resolution is complete and finite
  const { heights } = generateDemHeightfield(gridSize, span);
  const finite = heights.length === gridSize * gridSize && Array.from(heights).every(Number.isFinite);
  check(`Heightfield ${gridSize}x${gridSize}: ${heights.length} values, all finite`, finite);

  return {
    name: 'Test 14: Terrain Domain Coverage (80°S–90°S)',
    criteria: 'All regions, the horizon march and the 80°S circle lie inside the ±polarDomainSpanKm mesh; heightfield is finite',
    passed,
    timeMs: (performance.now() - t0).toFixed(2),
    measurements,
  };
}
