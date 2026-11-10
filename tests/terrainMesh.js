/**
 * Terrain mesh / pin / surface-picture alignment test.
 *
 * Builds the SAME Three.js PlaneGeometry as scene.js and checks, against the real LOLA DEM, that
 *  1. the mesh surface under each landmark pin is at the pin's elevation (a z-mirrored mesh puts
 *     pins metres-to-kilometres away from the ground; the unflipped ordering is checked to FAIL),
 *  2. the terrain-derived texture, sampled through the mesh UVs, matches the mesh height there,
 *  3. the albedo is bounded and follows slope (steeper = brighter) with no baked shading.
 */

import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../config.js';
import { DemProvider, latLonToPolarStereo } from '../src/demLoader.js';
import { orientHeightsForMesh, generateTerrainAlbedo } from '../src/terrain.js';

const SPATIAL_SCALE = 0.35; // must match LunarNavigatorScene.spatialScale

export async function runTerrainMeshTest() {
  const t0 = performance.now();
  const measurements = [];
  let passed = true;
  const check = (label, ok) => {
    if (!ok) passed = false;
    measurements.push(`${label} [${ok ? 'PASS' : 'FAIL'}]`);
  };

  const meta = JSON.parse(await readFile(fileURLToPath(new URL('../' + CONFIG.dem.metadataPath.replace(/^\.?\//, ''), import.meta.url)), 'utf8'));
  const buf = await readFile(fileURLToPath(new URL('../' + CONFIG.dem.path.replace(/^\.?\//, ''), import.meta.url)));
  const provider = new DemProvider();
  await provider.loadRealDem(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), meta);

  const N = CONFIG.radii.polarMeshGridSize;
  const H = CONFIG.radii.polarDomainSpanKm;
  const raw = provider.generateHeightfield(N, H).heights;
  const heights = orientHeightsForMesh(raw, N);

  const geometry = new THREE.PlaneGeometry(H * 2 * SPATIAL_SCALE, H * 2 * SPATIAL_SCALE, N - 1, N - 1);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const nearest = (x, z) => {
    let best = Infinity;
    let bi = 0;
    for (let i = 0; i < pos.count; i++) {
      const d = (pos.getX(i) - x) ** 2 + (pos.getZ(i) - z) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    return bi;
  };

  // 1. Pins vs mesh surface (pin placement as in scene.js: x = kmX*s, z = -kmY*s)
  const landmarks = [['Malapert', -85.9, 0.0], ['Shoemaker', -88.1, 44.9], ['Haworth', -87.5, -5.0], ['Cabeus B peak', -83.6, -68.8], ['Mons Mouton', -84.3, 30.6]];
  let worstFixed = 0;
  const unflippedErr = {};
  for (const [name, lat, lon] of landmarks) {
    const { x, y } = latLonToPolarStereo(lat, lon);
    const i = nearest(x * SPATIAL_SCALE, -y * SPATIAL_SCALE);
    const pin = provider.getElevationAt(lat, lon);
    worstFixed = Math.max(worstFixed, Math.abs(heights[i] - pin));
    unflippedErr[name] = Math.abs(raw[i] - pin);
  }
  check(`Mesh surface under ${landmarks.length} landmark pins: worst |Δ| = ${worstFixed.toFixed(2)} km (limit 0.30)`, worstFixed <= 0.3);
  check(`Unflipped ordering would be wrong (Malapert Δ ${unflippedErr.Malapert.toFixed(1)} km, Shoemaker Δ ${unflippedErr.Shoemaker.toFixed(1)} km, both > 1.5)`,
    unflippedErr.Malapert > 1.5 && unflippedErr.Shoemaker > 1.5);

  // 2. Texture through mesh UVs vs mesh height
  const size = 2048;
  const tex = generateTerrainAlbedo(size, H, provider);
  let sum = 0;
  let max = 0;
  let n = 0;
  for (let i = 0; i < pos.count; i += 29) {
    const px = Math.min(size - 1, Math.floor(uv.getX(i) * size));
    const py = Math.min(size - 1, Math.floor((1 - uv.getY(i)) * size));
    const d = Math.abs(tex.elevKm[py * size + px] - heights[i]);
    sum += d;
    max = Math.max(max, d);
    n++;
  }
  check(`Texture elevation at mesh UVs vs mesh height: mean |Δ| = ${(sum / n).toFixed(3)} km (limit 0.05), max ${max.toFixed(2)} km (limit 0.30) over ${n} vertices`,
    sum / n <= 0.05 && max <= 0.3);

  // 3. Albedo bounds and slope relationship
  const L = tex.albedo.length;
  let aMin = 1;
  let aMax = 0;
  let ma = 0;
  let ms = 0;
  for (let i = 0; i < L; i++) {
    aMin = Math.min(aMin, tex.albedo[i]);
    aMax = Math.max(aMax, tex.albedo[i]);
    ma += tex.albedo[i];
    ms += tex.slopeDeg[i];
  }
  ma /= L;
  ms /= L;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < L; i++) {
    const a = tex.albedo[i] - ma;
    const s = tex.slopeDeg[i] - ms;
    sxy += a * s;
    sxx += a * a;
    syy += s * s;
  }
  const corr = sxy / Math.sqrt(sxx * syy);
  check(`Albedo range ${aMin.toFixed(2)}…${aMax.toFixed(2)} within 0.25…0.80, RGBA length ${tex.rgba.length} = ${size * size * 4}`,
    aMin >= 0.25 && aMax <= 0.8 && tex.rgba.length === size * size * 4);
  check(`Albedo follows slope: correlation ${corr.toFixed(2)} (> 0.8), steeper = brighter`, corr > 0.8);

  return {
    name: 'Test 18: Terrain Mesh, Pin and Surface-Picture Alignment',
    criteria: 'Mesh surface matches the pins (not z-mirrored); terrain-derived texture matches the mesh UVs; albedo is bounded and follows slope',
    passed,
    timeMs: (performance.now() - t0).toFixed(2),
    measurements,
  };
}
