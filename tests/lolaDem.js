/**
 * Real LOLA DEM regression test (public/data/lola_south_pole_320m.{bin,json}).
 *
 * Guards the things that fail silently: file integrity, units, and above all ORIENTATION. The source
 * GeoTIFF's y axis is the opposite of the app's map y axis; a mirrored DEM still "looks like terrain"
 * but puts every crater in the wrong place. Known landmarks catch that:
 *   Shoemaker (88.1°S, 44.9°E) and Haworth (87.5°S, 5.0°W) are deep craters; Malapert massif
 *   (85.9°S, 0.0°E) is a tall massif.
 * Uses its own DemProvider instances so the shared singleton (and every other test) stays synthetic.
 */

import { CONFIG } from '../config.js';
import { DemProvider, latLonToPolarStereo, loadConfiguredDem } from '../src/demLoader.js';

async function readBytes(urlPath) {
  // Detect Node itself (other tests install a JSDOM `window` global in the same process)
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const abs = fileURLToPath(new URL('../' + urlPath.replace(/^\.?\//, ''), import.meta.url));
    const buf = await readFile(abs);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  const res = await fetch(urlPath);
  return res.arrayBuffer();
}

const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');

export async function runLolaDemTest() {
  const t0 = performance.now();
  const measurements = [];
  let passed = true;
  const check = (label, ok) => {
    if (!ok) passed = false;
    measurements.push(`${label} [${ok ? 'PASS' : 'FAIL'}]`);
  };

  const meta = JSON.parse(new TextDecoder().decode(await readBytes(CONFIG.dem.metadataPath)));
  const bin = await readBytes(CONFIG.dem.path);

  // 1. Integrity
  const digest = hex(await crypto.subtle.digest('SHA-256', bin));
  check(`Raster size ${bin.byteLength} B = ${meta.width}x${meta.height}x4`, bin.byteLength === meta.width * meta.height * 4);
  check(`SHA-256 matches metadata (${digest.slice(0, 12)}…)`, digest === meta.sha256);

  const provider = new DemProvider();
  const loaded = await provider.loadRealDem(bin, meta);
  check('Provider accepts the raster (finite, size consistent)', loaded === true && provider.isSynthetic === false);

  // 2. Range and units (km above the 1737.4 km sphere)
  const data = provider.realData;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let i = 0; i < data.length; i++) {
    if (data[i] < zMin) zMin = data[i];
    if (data[i] > zMax) zMax = data[i];
  }
  check(`Elevation range ${zMin.toFixed(2)} … ${zMax.toFixed(2)} km is within ±8 km (units are km, not m)`, zMin > -8 && zMax < 8 && zMax - zMin > 10);

  // 3. Orientation against landmarks (mean over a 5 km disc)
  const discMean = (lat, lon, radiusKm = 5, stepKm = 0.5) => {
    const c = latLonToPolarStereo(lat, lon);
    let sum = 0;
    let n = 0;
    for (let dx = -radiusKm; dx <= radiusKm; dx += stepKm) {
      for (let dy = -radiusKm; dy <= radiusKm; dy += stepKm) {
        if (dx * dx + dy * dy <= radiusKm * radiusKm) {
          sum += provider.getElevationAtXY(c.x + dx, c.y + dy);
          n++;
        }
      }
    }
    return sum / n;
  };
  const shoemaker = discMean(-88.1, 44.9);
  const haworth = discMean(-87.5, -5.0);
  const malapert = discMean(-85.9, 0.0);
  check(`Shoemaker floor mean ${shoemaker.toFixed(2)} km < -3.0`, shoemaker < -3.0);
  check(`Haworth floor mean ${haworth.toFixed(2)} km < -2.5`, haworth < -2.5);
  check(`Malapert massif mean ${malapert.toFixed(2)} km > +2.5`, malapert > 2.5);

  // 4. Sampling: pixel-centre value is returned exactly; outside the raster holds the edge value
  const half = meta.halfSpanKm;
  const step = (2 * half) / (meta.width - 1);
  const i = 950;
  const j = 800;
  const raw = data[j * meta.width + i];
  const sampled = provider.getElevationAtXY(-half + i * step, -half + j * step);
  check(`Pixel-centre sample ${sampled.toFixed(4)} = raster ${raw.toFixed(4)} km`, Math.abs(sampled - raw) < 1e-4);
  const edge = provider.getElevationAtXY(half, 10);
  const beyond = provider.getElevationAtXY(half + 1.2, 10);
  check(`Beyond the raster holds the edge value (${beyond.toFixed(3)} = ${edge.toFixed(3)} km), no cliff to 0`, Math.abs(beyond - edge) < 1e-9);

  // 5. Provenance labels (never "verified"; cites the product)
  const m = provider.getMetadata();
  const blob = `${m.source} ${m.license}`.toLowerCase();
  check(`Provenance: ${m.mPerPixel} m/px, source cites LDEM_80S_80MPP_ADJ, no "verified" wording`,
    m.isSynthetic === false && m.mPerPixel === 320 && m.source.includes('LDEM_80S_80MPP_ADJ') && !blob.includes('verified'));

  // 6. Configured loader: success path and graceful fallback
  const okProvider = new DemProvider();
  const fakeFetch = (url) => Promise.resolve({
    ok: true,
    status: 200,
    json: async () => meta,
    arrayBuffer: async () => bin,
    url,
  });
  const okResult = await loadConfiguredDem(fakeFetch, okProvider);
  check('loadConfiguredDem activates the real DEM', okResult === true && okProvider.isSynthetic === false);

  const failProvider = new DemProvider();
  const prevWarn = console.warn;
  console.warn = () => {};
  const failResult = await loadConfiguredDem(() => Promise.resolve({ ok: false, status: 404 }), failProvider);
  console.warn = prevWarn;
  check('HTTP 404 falls back to synthetic terrain (keeps the synthetic banner)', failResult === false && failProvider.isSynthetic === true);

  const badProvider = new DemProvider();
  const badLoaded = await (async () => {
    const prevErr = console.error;
    console.error = () => {};
    const r = await badProvider.loadRealDem(new ArrayBuffer(16), meta);
    console.error = prevErr;
    return r;
  })();
  check('Truncated raster is rejected, provider stays synthetic', badLoaded === false && badProvider.isSynthetic === true);

  return {
    name: 'Test 17: Real LOLA DEM (integrity, orientation, sampling, provenance)',
    criteria: 'Raster matches its SHA-256 and size; craters/massif land at the right elevations (not mirrored); edges hold; labels cite the product; bad files fall back',
    passed,
    timeMs: (performance.now() - t0).toFixed(2),
    measurements,
  };
}
