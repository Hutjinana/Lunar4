/**
 * Artemis Lunar Landing Site Navigator - Topography & Slope Evaluation Module
 * 
 * Powered by unified DemProvider (src/demLoader.js).
 * Computes:
 * 1. Selenographic <-> South Polar Stereographic coordinates
 * 2. Elevation queries via DemProvider interface
 * 3. Localized slope distributions (Mean and P95 slope) via central differences
 * 4. Conforming Cartographic Lat/Lon Grid lines (-80° to -90°)
 */

import { CONFIG } from '../config.js';
import {
  demProvider,
  latLonToPolarStereo,
  polarStereoToLatLon,
  LUNAR_RADIUS_KM,
} from './demLoader.js';

export { latLonToPolarStereo, polarStereoToLatLon, LUNAR_RADIUS_KM };

/**
 * Returns elevation in kilometers relative to lunar reference sphere at given lat/lon
 */
export function getElevationAt(lat, lon) {
  return demProvider.getElevationAt(lat, lon);
}

/**
 * Returns elevation in kilometers by polar stereographic coordinates (x, y in km)
 */
export function getElevationAtXY(xKm, yKm) {
  return demProvider.getElevationAtXY(xKm, yKm);
}

/**
 * Generates regular grid of heights for 3D terrain mesh
 */
export function generateDemHeightfield(gridSize = 128, halfSpanKm = CONFIG.radii.polarDomainSpanKm) {
  return demProvider.generateHeightfield(gridSize, halfSpanKm);
}

/**
 * Re-orders a heightfield from generateDemHeightfield() (row j = map y from -span to +span) into the
 * vertex order of the Three.js terrain mesh.
 *
 * PlaneGeometry rotated by -90° about X puts its first row at scene z = -span, but pins, graticule and
 * click mapping use z = -mapY (mapGeometry.js), i.e. map y = -span sits at z = +span. Without this
 * row flip the terrain is mirrored in z relative to every pin (a pin on a massif floats above a crater).
 */
export function orientHeightsForMesh(heights, gridSize) {
  const out = new Float32Array(heights.length);
  for (let iy = 0; iy < gridSize; iy++) {
    const src = (gridSize - 1 - iy) * gridSize;
    out.set(heights.subarray(src, src + gridSize), iy * gridSize);
  }
  return out;
}

/**
 * Terrain-derived surface texture (not imagery): per-pixel albedo from the DEM itself.
 *   - steeper ground is brighter (steep walls shed dust and expose fresher, brighter regolith),
 *   - higher ground is slightly brighter, lows (crater floors) slightly darker.
 * No shading is baked in: direct light comes from the live Sun vector and the mesh normals, so the
 * picture never disagrees with the lighting.
 *
 * Pixel (px, py) covers map x = -span + (px+0.5)*step and map y = +span - (py+0.5)*step, which is the
 * UV layout of the mesh after its -90° rotation (canvas row 0 = scene z = -span = map y = +span).
 *
 * @param {number} size - Texture width/height in pixels
 * @param {number} halfSpanKm - Half-width of the square mesh domain
 * @param {DemProvider} provider - Elevation source (defaults to the singleton)
 */
export function generateTerrainAlbedo(size = 1024, halfSpanKm = CONFIG.radii.polarDomainSpanKm, provider = demProvider) {
  const stepKm = (2 * halfSpanKm) / size;
  const elevKm = new Float32Array(size * size);
  for (let py = 0; py < size; py++) {
    const y = halfSpanKm - (py + 0.5) * stepKm;
    for (let px = 0; px < size; px++) {
      elevKm[py * size + px] = provider.getElevationAtXY(-halfSpanKm + (px + 0.5) * stepKm, y);
    }
  }

  const slopeDeg = new Float32Array(size * size);
  const albedo = new Float32Array(size * size);
  const rgba = new Uint8ClampedArray(size * size * 4);
  const RAD2DEG = 180 / Math.PI;

  for (let py = 0; py < size; py++) {
    const up = Math.max(0, py - 1);
    const dn = Math.min(size - 1, py + 1);
    for (let px = 0; px < size; px++) {
      const lf = Math.max(0, px - 1);
      const rt = Math.min(size - 1, px + 1);
      const dzdx = (elevKm[py * size + rt] - elevKm[py * size + lf]) / ((rt - lf) * stepKm);
      const dzdy = (elevKm[dn * size + px] - elevKm[up * size + px]) / ((dn - up) * stepKm);
      const slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * RAD2DEG;

      const t = Math.min(1, slope / 25.0);
      const smooth = t * t * (3 - 2 * t);
      const elevTerm = Math.max(-1, Math.min(1, elevKm[py * size + px] / 6.0));
      const a = Math.max(0.25, Math.min(0.8, 0.42 + 0.22 * smooth + 0.05 * elevTerm));

      const i = py * size + px;
      slopeDeg[i] = slope;
      albedo[i] = a;
      rgba[i * 4] = a * 255;
      rgba[i * 4 + 1] = a * 0.97 * 255;
      rgba[i * 4 + 2] = a * 0.92 * 255;
      rgba[i * 4 + 3] = 255;
    }
  }
  return { size, stepKm, elevKm, slopeDeg, albedo, rgba };
}

/**
 * Computes localized slope statistics using central differences on the elevation grid
 * within a user-chosen radius (default: 3.0 km, range: 0.5 to 15.0 km).
 * 
 * Central difference formulation:
 * dz/dx = (z(x + dx) - z(x - dx)) / (2*dx)
 * dz/dy = (z(y + dy) - z(y - dy)) / (2*dy)
 * slope = arctan(sqrt((dz/dx)^2 + (dz/dy)^2))
 * 
 * Reports Mean Slope and 95th Percentile Slope (P95).
 */
export function computeLocalizedSlopeAt(lat, lon, radiusKm = CONFIG.radii.defaultSlopeRadiusKm) {
  const centerPos = latLonToPolarStereo(lat, lon);
  const deltaKm = 0.4; // 400m finite difference step
  const samples = [];

  const radialSteps = Math.max(3, Math.min(12, Math.round(radiusKm / 1.0)));
  const angularSteps = 16;

  for (let r = 0; r <= radialSteps; r++) {
    const curR = (r / radialSteps) * radiusKm;
    const aSteps = curR === 0 ? 1 : angularSteps;

    for (let a = 0; a < aSteps; a++) {
      const angle = (a / aSteps) * 2 * Math.PI;
      const px = centerPos.x + curR * Math.cos(angle);
      const py = centerPos.y + curR * Math.sin(angle);

      // Central difference samples
      const zEast = getElevationAtXY(px + deltaKm, py);
      const zWest = getElevationAtXY(px - deltaKm, py);
      const zNorth = getElevationAtXY(px, py + deltaKm);
      const zSouth = getElevationAtXY(px, py - deltaKm);

      const dz_dx = (zEast - zWest) / (2 * deltaKm);
      const dz_dy = (zNorth - zSouth) / (2 * deltaKm);
      const gradMag = Math.sqrt(dz_dx * dz_dx + dz_dy * dz_dy);
      const slopeDeg = (Math.atan(gradMag) * 180) / Math.PI;

      samples.push(slopeDeg);
    }
  }

  // Compute Mean Slope
  const sum = samples.reduce((acc, v) => acc + v, 0);
  const meanSlope = samples.length > 0 ? sum / samples.length : 0;

  // Compute 95th Percentile Slope (P95)
  samples.sort((a, b) => a - b);
  const p95Index = Math.min(samples.length - 1, Math.floor(samples.length * 0.95));
  const p95Slope = samples[p95Index] || meanSlope;

  return {
    meanSlopeDeg: Number(meanSlope.toFixed(1)),
    p95SlopeDeg: Number(p95Slope.toFixed(1)),
    sampleCount: samples.length,
    radiusKm,
  };
}

/**
 * Generates conforming 3D line coordinates for the south-polar Lat/Lon grid (-80° to -90°)
 * @param {number} scale - Cartesian spatial scale factor (km -> Three.js units)
 * @param {number} verticalScale - Elevation scale factor
 * @returns {Array<{ points: Array<[number, number, number]>, label: string, isMeridian: boolean }>}
 */
export function generateLatLonGridLines(scale = 0.35, verticalScale = 0.35) {
  const gridLines = [];

  // 1. Latitude parallels (-80° to -88°, step 2°)
  const latitudes = [-80, -82, -84, -86, -88];
  const lonSegments = 96;

  latitudes.forEach((lat) => {
    const points = [];
    for (let i = 0; i <= lonSegments; i++) {
      const lon = (i / lonSegments) * 360.0 - 180.0;
      const { x: kmX, y: kmY } = latLonToPolarStereo(lat, lon);
      const zKm = getElevationAt(lat, lon);

      const x = kmX * scale;
      const z = -kmY * scale;
      const y = zKm * verticalScale + 0.05; // Slightly offset above terrain surface to avoid z-fighting

      points.push([x, y, z]);
    }
    gridLines.push({
      points,
      label: `${Math.abs(lat)}°S`,
      isMeridian: false,
      lat,
    });
  });

  // 2. Longitude meridians (every 30°: 0°, 30°, 60°, ..., 330°)
  const meridians = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
  const latSteps = 54;

  meridians.forEach((lon) => {
    const points = [];
    for (let i = 0; i <= latSteps; i++) {
      const lat = -80.0 - (i / latSteps) * 10.0; // -80° to -90°
      const { x: kmX, y: kmY } = latLonToPolarStereo(lat, lon);
      const zKm = getElevationAt(lat, lon);

      const x = kmX * scale;
      const z = -kmY * scale;
      const y = zKm * verticalScale + 0.05;

      points.push([x, y, z]);
    }

    let lonLabel = `${lon}°E`;
    if (lon === 0) lonLabel = '0° (Prime Meridian)';
    else if (lon === 180) lonLabel = '180°';
    else if (lon > 180) lonLabel = `${360 - lon}°W`;

    gridLines.push({
      points,
      label: lonLabel,
      isMeridian: true,
      lon,
    });
  });

  return gridLines;
}
