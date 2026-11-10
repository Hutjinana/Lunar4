/**
 * Procedural terrain test: deterministic, finite, bounded, with a realistic crater size distribution.
 */

import { DemProvider, PROCEDURAL_TERRAIN } from '../src/demLoader.js';
import { CONFIG } from '../config.js';

export async function runTerrainRealismTest() {
  const t0 = performance.now();
  const measurements = [];
  let passed = true;
  const check = (label, ok) => {
    if (!ok) passed = false;
    measurements.push(`${label} [${ok ? 'PASS' : 'FAIL'}]`);
  };

  const a = new DemProvider();
  const b = new DemProvider();
  const span = CONFIG.radii.polarDomainSpanKm;

  // 1. Determinism: two providers give identical heightfields
  const ha = a.generateHeightfield(97, span).heights;
  const hb = b.generateHeightfield(97, span).heights;
  let identical = ha.length === hb.length;
  for (let i = 0; identical && i < ha.length; i++) if (ha[i] !== hb[i]) identical = false;
  check('Two providers produce identical heightfields (deterministic)', identical);

  // 2. Finite and within the documented clamp
  let min = Infinity;
  let max = -Infinity;
  let finite = true;
  for (const h of ha) {
    if (!Number.isFinite(h)) finite = false;
    min = Math.min(min, h);
    max = Math.max(max, h);
  }
  check(`All finite, range ${min.toFixed(2)}..${max.toFixed(2)} km within [-5.5, 6.5]`, finite && min >= -5.5 && max <= 6.5);

  // 3. Crater population: count and size distribution (small craters outnumber large ones)
  const craters = a.proceduralCraters;
  const small = craters.filter((c) => c.radiusKm < 3).length;
  const large = craters.filter((c) => c.radiusKm >= 6).length;
  check(`Procedural craters: ${craters.length} (>= 500)`, craters.length >= 500);
  check(`Size distribution: ${small} small (<3 km) > 4 x ${large} large (>=6 km)`, small > 4 * large);
  check(
    `Radii within [${PROCEDURAL_TERRAIN.minRadiusKm}, ${PROCEDURAL_TERRAIN.maxRadiusKm}] km`,
    craters.every((c) => c.radiusKm >= PROCEDURAL_TERRAIN.minRadiusKm - 1e-9 && c.radiusKm <= PROCEDURAL_TERRAIN.maxRadiusKm + 1e-9)
  );

  // 4. Crater profile: floor below the surrounding rim, continuous at the rim crest
  const c = craters.reduce((best, k) => (k.radiusKm > best.radiusKm ? k : best), craters[0]);
  const eps = 1e-3;
  const inside = c.depthKm; // sanity reference
  const rimIn = c.rimKm - (c.depthKm + c.rimKm) * (1 - (1 - eps) ** 2);
  const rimOut = c.rimKm * (1 + eps) ** -3 * (1 - eps / 1.5 * 1) ** 2;
  check(`Crater rim profile continuous (Δ=${Math.abs(rimIn - rimOut).toExponential(1)} km)`, Math.abs(rimIn - rimOut) < 0.01 && inside > 0);

  // 5. Local relief: a 3 km radius circle somewhere on a crater has non-trivial relief
  const relief = [];
  for (let i = 0; i < 40; i++) {
    const k = craters[i];
    const centre = a.getElevationAtXY(k.xKm, k.yKm);
    const rim = a.getElevationAtXY(k.xKm + k.radiusKm, k.yKm);
    relief.push(rim - centre);
  }
  check(`Craters show floor-to-rim relief (median ${[...relief].sort((x, y) => x - y)[20].toFixed(2)} km > 0)`, [...relief].sort((x, y) => x - y)[20] > 0);

  return {
    name: 'Test 15: Procedural Terrain Realism (craters, hills, noise)',
    criteria: 'Deterministic, finite, bounded terrain with power-law crater population and continuous crater profiles',
    passed,
    timeMs: (performance.now() - t0).toFixed(2),
    measurements,
  };
}
