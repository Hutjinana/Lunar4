/**
 * Artemis Lunar Landing Site Navigator - Unified DEM & Topography Provider
 * 
 * Provides a unified DemProvider interface shared by both:
 * 1. Synthetic polar south terrain generator (deterministic, seeded, covers CONFIG.radii.polarDomainSpanKm)
 * 2. Real LOLA DEM file loader (supporting Float32 raw binary and 16-bit grayscale PNG)
 * 
 * Documented LOLA DEM Dataset Format:
 * - Projection: South Polar Stereographic (center: -90.0° lat, 0.0° lon, R_moon = 1737.4 km)
 * - Binary Format: Float32 IEEE 754 little-endian raster, or 16-bit unsigned PNG
 * - Metadata JSON structure:
 *   {
 *     "format": "Float32", // or "PNG16"
 *     "mPerPixel": 120.0,
 *     "width": 1667,
 *     "height": 1667,
 *     "centerLat": -90.0,
 *     "centerLon": 0.0,
 *     "halfSpanKm": 100.0,
 *     "verticalScale": 1.0,
 *     "verticalOffsetKm": 0.0,
 *     "nodata": -9999.0
 *   }
 */

import { CONFIG } from '../config.js';

export const LUNAR_RADIUS_KM = CONFIG.radii.lunarRadiusKm;

/**
 * Deterministic pseudo-random number generator (Mulberry32)
 */
function createMulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Converts Selenographic coordinates (lat, lon) to South Polar Stereographic (x, y in km)
 * Reference center: 90° S, Central Meridian: 0° E
 */
export function latLonToPolarStereo(latDeg, lonDeg) {
  const colatitudeRad = ((90 + latDeg) * Math.PI) / 180;
  const lonRad = (lonDeg * Math.PI) / 180;

  const rho = 2 * LUNAR_RADIUS_KM * Math.tan(colatitudeRad / 2);
  const x = rho * Math.sin(lonRad);
  const y = -rho * Math.cos(lonRad);

  return { x, y };
}

/**
 * Inverse conversion: South Polar Stereographic (x, y in km) to Selenographic (lat, lon)
 */
export function polarStereoToLatLon(x, y) {
  const rho = Math.sqrt(x * x + y * y);
  const colatitudeRad = 2 * Math.atan(rho / (2 * LUNAR_RADIUS_KM));
  const lat = (colatitudeRad * 180) / Math.PI - 90;

  let lon = (Math.atan2(x, -y) * 180) / Math.PI;
  if (lon < -180) lon += 360;
  if (lon > 180) lon -= 360;

  return { lat, lon };
}

/**
 * Procedural terrain parameters (ILLUSTRATIVE – generic, not real lunar features).
 * Craters follow a power-law size distribution N(>=R) = K * R^-2 (small craters far outnumber large ones),
 * with a spread of degradation states (fresh = deep with sharp rim, old = shallow and subdued).
 */
export const PROCEDURAL_TERRAIN = {
  seed: 7120261,
  craterCountMinRadius: 900, // number of craters with radius >= minRadiusKm
  minRadiusKm: 1.5,
  maxRadiusKm: 12.0,
  freshDepthRatio: 0.2, // depth / diameter of a fresh simple crater
  oldDepthRatio: 0.05, // depth / diameter of a heavily degraded crater
  rimToDepth: 0.25,
  hillCount: 14,
  hillRadiusKm: [7, 20],
  hillHeightKm: [0.25, 1.1],
  noiseWavelengthKm: 48.0,
  noiseAmplitudeKm: 0.22,
  noiseOctaves: 4,
  cellKm: 25.0,
};

/** Integer lattice hash -> [0,1) (deterministic, no tables) */
function latticeHash(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth 2D value noise in [-1, 1] */
function valueNoise2D(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = latticeHash(x0, y0, seed);
  const n10 = latticeHash(x0 + 1, y0, seed);
  const n01 = latticeHash(x0, y0 + 1, seed);
  const n11 = latticeHash(x0 + 1, y0 + 1, seed);
  const top = n00 + (n10 - n00) * sx;
  const bot = n01 + (n11 - n01) * sx;
  return (top + (bot - top) * sy) * 2 - 1;
}

/**
 * Major polar morphological features (named craters / massifs; positions sourced from the catalogue below)
 */
export const POLAR_MORPHOLOGY = [
  // Craters (negative depth with elevated raised rim ring)
  { name: 'Shackleton', lat: -89.9, lon: 0.0, radiusKm: 10.5, depthKm: 4.2, rimHeightKm: 1.2 },
  { name: 'Haworth', lat: -87.4, lon: -5.1, radiusKm: 25.0, depthKm: 3.8, rimHeightKm: 0.8 },
  { name: 'Shoemaker', lat: -88.1, lon: 45.0, radiusKm: 25.5, depthKm: 3.5, rimHeightKm: 0.9 },
  { name: 'Faustini', lat: -87.3, lon: 77.0, radiusKm: 19.5, depthKm: 3.2, rimHeightKm: 0.7 },
  { name: 'Cabeus', lat: -84.9, lon: -35.5, radiusKm: 49.0, depthKm: 4.0, rimHeightKm: 1.4 },
  { name: 'de Gerlache', lat: -88.5, lon: -88.3, radiusKm: 16.0, depthKm: 2.8, rimHeightKm: 1.1 },
  { name: 'Nobile', lat: -85.2, lon: 53.5, radiusKm: 36.0, depthKm: 3.6, rimHeightKm: 1.5 },
  { name: 'Amundsen', lat: -84.5, lon: 82.8, radiusKm: 52.0, depthKm: 4.8, rimHeightKm: 2.0 },
  { name: 'Slater', lat: -88.1, lon: 111.4, radiusKm: 12.5, depthKm: 1.8, rimHeightKm: 0.6 },

  // Elevated Massifs / Ridges / Mountains (positive height)
  { name: 'Malapert Massif', lat: -85.9, lon: 2.9, radiusKm: 22.0, depthKm: -5.0, rimHeightKm: -5.0 },
  { name: 'Mons Mouton', lat: -84.5, lon: 30.5, radiusKm: 35.0, depthKm: -5.6, rimHeightKm: -5.6 },
  { name: 'Peak near Cabeus B', lat: -83.6, lon: -68.8, radiusKm: 18.0, depthKm: -3.2, rimHeightKm: -3.2 },
];

/**
 * Unified DemProvider implementing the exact interface for both Synthetic and Real LOLA DEMs
 */
export class DemProvider {
  constructor(options = {}) {
    this.seed = options.seed || 20261031; // Deterministic seed (NASA Space Apps 2026 date)
    this.rng = createMulberry32(this.seed);

    // Initial state: Synthetic terrain fallback active
    this.isSynthetic = true;
    this.realData = null;
    this.realMetadata = null;

    // Cache polar stereographic coordinates of features
    this.features = POLAR_MORPHOLOGY.map((feat) => {
      const pos = latLonToPolarStereo(feat.lat, feat.lon);
      return { ...feat, xKm: pos.x, yKm: pos.y };
    });

    // Generic procedural craters and hills (illustrative; spatially hashed for fast lookup)
    this._buildProceduralField();
  }

  /**
   * Builds the seeded procedural crater/hill population and a uniform spatial hash grid.
   * Craters are generic; they do not represent real lunar features.
   */
  _buildProceduralField() {
    const P = PROCEDURAL_TERRAIN;
    const rng = createMulberry32(P.seed);
    const domainR = CONFIG.radii.polarDomainSpanKm * 1.02;
    const craters = [];
    const hills = [];

    const randomPoint = () => {
      // Uniform over the disc of radius domainR (rejection sampling in the square)
      for (;;) {
        const x = (rng() * 2 - 1) * domainR;
        const y = (rng() * 2 - 1) * domainR;
        if (x * x + y * y <= domainR * domainR) return { x, y };
      }
    };

    // Total crater count scales with domain area relative to the ±305 km reference
    const areaScale = (domainR * domainR) / (305 * 305 * 1.0404);
    const count = Math.round(P.craterCountMinRadius * areaScale);
    const ratioSpan = (P.minRadiusKm / P.maxRadiusKm) ** 2;
    for (let i = 0; i < count; i++) {
      const { x, y } = randomPoint();
      const u = rng();
      // Inverse-CDF of N(>=R) ∝ R^-2 truncated to [minRadiusKm, maxRadiusKm]
      const radiusKm = P.minRadiusKm / Math.sqrt(1 - u * (1 - ratioSpan));
      const fresh = rng();
      const ratio = P.oldDepthRatio + (P.freshDepthRatio - P.oldDepthRatio) * fresh * fresh;
      const depthKm = 2 * radiusKm * ratio;
      craters.push({ xKm: x, yKm: y, radiusKm, depthKm, rimKm: depthKm * P.rimToDepth });
    }

    for (let i = 0; i < P.hillCount; i++) {
      const { x, y } = randomPoint();
      const radiusKm = P.hillRadiusKm[0] + rng() * (P.hillRadiusKm[1] - P.hillRadiusKm[0]);
      const heightKm = P.hillHeightKm[0] + rng() * (P.hillHeightKm[1] - P.hillHeightKm[0]);
      hills.push({ xKm: x, yKm: y, radiusKm, heightKm });
    }

    // Spatial hash: each crater/hill registered in every cell its influence radius touches
    const cell = P.cellKm;
    this._grid = new Map();
    const key = (cx, cy) => cx * 100003 + cy;
    const register = (item, kind, influence) => {
      const cx0 = Math.floor((item.xKm - influence) / cell);
      const cx1 = Math.floor((item.xKm + influence) / cell);
      const cy0 = Math.floor((item.yKm - influence) / cell);
      const cy1 = Math.floor((item.yKm + influence) / cell);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const k = key(cx, cy);
          let bucket = this._grid.get(k);
          if (!bucket) {
            bucket = [];
            this._grid.set(k, bucket);
          }
          bucket.push({ kind, item });
        }
      }
    };
    craters.forEach((c) => register(c, 0, c.radiusKm * 2.5));
    hills.forEach((h) => register(h, 1, h.radiusKm * 1.0));

    this._gridKey = key;
    this._gridCell = cell;
    this.proceduralCraters = craters;
    this.proceduralHills = hills;
  }

  /**
   * Returns current DEM provenance and metadata
   */
  getMetadata() {
    if (!this.isSynthetic && this.realMetadata) {
      return {
        isSynthetic: false,
        source: this.realMetadata.source || 'LOLA-derived (provenance to be confirmed)',
        license: this.realMetadata.license || 'To be confirmed',
        format: this.realMetadata.format || 'Float32',
        mPerPixel: this.realMetadata.mPerPixel || 120.0,
        width: this.realMetadata.width,
        height: this.realMetadata.height,
        centerLat: this.realMetadata.centerLat || -90.0,
        centerLon: this.realMetadata.centerLon || 0.0,
        halfSpanKm: this.realMetadata.halfSpanKm || 100.0,
        projection: 'South Polar Stereographic',
      };
    }

    return {
      isSynthetic: true,
      source: 'Deterministic Seeded Synthetic Generator',
      license: 'Illustrative – Synthetic Fallback',
      format: 'Procedural Analytic Float32',
      mPerPixel: 120.0,
      width: 1667,
      height: 1667,
      centerLat: -90.0,
      centerLon: 0.0,
      halfSpanKm: CONFIG.radii.polarDomainSpanKm,
      projection: 'South Polar Stereographic',
      bannerText: CONFIG.dem.bannerText,
    };
  }

  /**
   * Core elevation retrieval method by Selenographic latitude and longitude
   * @param {number} lat - Latitude in degrees (-90 to 0)
   * @param {number} lon - Longitude in degrees (-180 to 180)
   * @returns {number} Elevation in kilometers relative to lunar reference sphere (1737.4 km)
   */
  getElevationAt(lat, lon) {
    const { x, y } = latLonToPolarStereo(lat, lon);
    return this.getElevationAtXY(x, y);
  }

  /**
   * Elevation retrieval method by South Polar Stereographic coordinates (x, y in km)
   * Domain: ~±100 km (covers 84°S to 90°S)
   */
  getElevationAtXY(xKm, yKm) {
    if (!this.isSynthetic && this.realData) {
      return this._sampleRealDem(xKm, yKm);
    }

    return this._sampleSyntheticDem(xKm, yKm);
  }

  /**
   * Deterministic, seeded synthetic elevation sampler
   */
  _sampleSyntheticDem(xKm, yKm) {
    let elevation = 0;

    // 1. South Pole-Aitken (SPA) basin broad regional slope
    const rho = Math.sqrt(xKm * xKm + yKm * yKm);
    const colatRad = 2 * Math.atan(rho / (2 * LUNAR_RADIUS_KM));
    elevation += -1.2 * Math.sin(colatRad * 4.0);

    // 2. Analytic Crater and Massif Features
    for (let i = 0; i < this.features.length; i++) {
      const feat = this.features[i];
      const dx = xKm - feat.xKm;
      const dy = yKm - feat.yKm;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (feat.depthKm < 0) {
        // Elevated Mountain / Massif (positive relief)
        const peakHeight = -feat.depthKm;
        const outerBound = feat.radiusKm * 1.8;
        if (dist < outerBound) {
          const normDist = dist / outerBound;
          const bell = Math.cos(normDist * (Math.PI / 2));
          elevation += peakHeight * Math.pow(bell, 1.8);
        }
      } else {
        // Impact Crater (bowl depression with raised parabolic rim)
        const outerRimBound = feat.radiusKm * 1.6;
        if (dist < outerRimBound) {
          const rRatio = dist / feat.radiusKm;
          if (rRatio < 1.0) {
            // Inside crater bowl
            const bowlDepth = feat.depthKm * (1.0 - rRatio * rRatio);
            elevation -= bowlDepth;
          } else {
            // Elevated rim wall
            const rimSpan = (rRatio - 1.0) / 0.6;
            const rimContrib = feat.rimHeightKm * Math.cos(rimSpan * (Math.PI / 2));
            elevation += Math.max(0, rimContrib);
          }
        }
      }
    }

    // 2b. Procedural generic craters & hills (illustrative) via spatial hash lookup
    if (this._grid) {
      const bucket = this._grid.get(this._gridKey(Math.floor(xKm / this._gridCell), Math.floor(yKm / this._gridCell)));
      if (bucket) {
        for (let i = 0; i < bucket.length; i++) {
          const { kind, item } = bucket[i];
          const dx = xKm - item.xKm;
          const dy = yKm - item.yKm;
          if (kind === 0) {
            const R = item.radiusKm;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const u = dist / R;
            if (u < 1.0) {
              // Bowl: parabolic floor rising continuously to the rim crest
              elevation += item.rimKm - (item.depthKm + item.rimKm) * (1.0 - u * u);
            } else if (u < 2.5) {
              // Rim crest + ejecta blanket decaying ~ r^-3, faded to zero at 2.5 R
              const fade = 1.0 - (u - 1.0) / 1.5;
              elevation += item.rimKm * Math.pow(u, -3.0) * fade * fade;
            }
          } else {
            const dist2 = (dx * dx + dy * dy) / (item.radiusKm * item.radiusKm);
            if (dist2 < 1.0) {
              const bell = Math.cos(Math.sqrt(dist2) * (Math.PI / 2));
              elevation += item.heightKm * bell * bell;
            }
          }
        }
      }
    }

    // 2c. Seeded fractal rolling-terrain noise (multi-octave value noise)
    {
      const P = PROCEDURAL_TERRAIN;
      let amp = P.noiseAmplitudeKm;
      let freq = 1.0 / P.noiseWavelengthKm;
      let sum = 0;
      for (let o = 0; o < P.noiseOctaves; o++) {
        sum += amp * valueNoise2D(xKm * freq, yKm * freq, P.seed + o * 31);
        amp *= 0.5;
        freq *= 2.1;
      }
      elevation += sum;
    }

    // 3. Deterministic Multi-Harmonic Regolith Roughness (replaces unseeded random noise)
    const harmonic1 = Math.sin(xKm * 0.075 + 1.2) * Math.cos(yKm * 0.075 + 0.8) * 0.18;
    const harmonic2 = Math.sin(xKm * 0.19 - 0.4) * Math.sin(yKm * 0.19 + 1.1) * 0.08;
    const harmonic3 = Math.cos(xKm * 0.42 + 2.1) * Math.cos(yKm * 0.42 - 1.7) * 0.035;

    elevation += harmonic1 + harmonic2 + harmonic3;

    return Math.max(-5.5, Math.min(6.5, elevation));
  }

  /**
   * Sample real DEM raster with bilinear interpolation
   */
  _sampleRealDem(xKm, yKm) {
    const meta = this.realMetadata;
    const span = meta.halfSpanKm || 100.0;
    const normX = (xKm + span) / (2 * span);
    const normY = (yKm + span) / (2 * span);

    // Outside the raster (the mesh square is slightly larger than the 80°S disc): hold the edge value
    // instead of dropping to 0, which would create a false cliff.
    const cNormX = Math.min(1, Math.max(0, normX));
    const cNormY = Math.min(1, Math.max(0, normY));

    const gridX = cNormX * (meta.width - 1);
    const gridY = cNormY * (meta.height - 1);

    const x0 = Math.floor(gridX);
    const x1 = Math.min(meta.width - 1, x0 + 1);
    const y0 = Math.floor(gridY);
    const y1 = Math.min(meta.height - 1, y0 + 1);

    const fx = gridX - x0;
    const fy = gridY - y0;

    const z00 = this.realData[y0 * meta.width + x0];
    const z10 = this.realData[y0 * meta.width + x1];
    const z01 = this.realData[y1 * meta.width + x0];
    const z11 = this.realData[y1 * meta.width + x1];

    const val = (1 - fx) * (1 - fy) * z00 + fx * (1 - fy) * z10 + (1 - fx) * fy * z01 + fx * fy * z11;
    return val * (meta.verticalScale || 1.0) + (meta.verticalOffsetKm || 0.0);
  }

  /**
   * Generates a 2D regular grid heightfield for 3D terrain mesh generation
   * @param {number} gridSize - Number of vertices along one axis (e.g. 64 or 128)
   * @param {number} halfSpanKm - Radius in km (default ±100 km)
   */
  generateHeightfield(gridSize = 64, halfSpanKm = 100) {
    const heights = new Float32Array(gridSize * gridSize);
    const step = (halfSpanKm * 2) / (gridSize - 1);

    for (let j = 0; j < gridSize; j++) {
      const y = -halfSpanKm + j * step;
      for (let i = 0; i < gridSize; i++) {
        const x = -halfSpanKm + i * step;
        heights[j * gridSize + i] = this.getElevationAtXY(x, y);
      }
    }

    return {
      heights,
      gridSize,
      halfSpanKm,
      isSynthetic: this.isSynthetic,
    };
  }

  /**
   * Loads real LOLA DEM binary and metadata JSON into the provider
   */
  async loadRealDem(binaryBuffer, metadata) {
    try {
      const data = new Float32Array(binaryBuffer);
      if (!metadata || !(metadata.width > 1) || !(metadata.height > 1) || data.length !== metadata.width * metadata.height) {
        throw new Error(`DEM size mismatch: ${data.length} values vs metadata ${metadata && metadata.width}x${metadata && metadata.height}`);
      }
      for (let i = 0; i < data.length; i++) {
        if (!Number.isFinite(data[i])) throw new Error(`DEM contains a non-finite value at index ${i}`);
      }
      this.realData = data;
      this.realMetadata = metadata;
      this.isSynthetic = false;
      return true;
    } catch (err) {
      console.error('Failed to load real DEM dataset:', err);
      this.isSynthetic = true;
      return false;
    }
  }
}

// Default singleton instance
export const demProvider = new DemProvider();

/**
 * Loads the DEM configured in CONFIG.dem (path + metadataPath) into the singleton provider.
 * Must complete BEFORE the UI, terrain mesh or horizon cache are built (see app.js bootstrap).
 * On any failure the app keeps the synthetic terrain (and its banner) if CONFIG.dem.fallbackToSynthetic
 * is true; otherwise the error is re-thrown.
 *
 * @param {Function} fetchImpl - fetch-compatible function (injectable for tests)
 * @param {DemProvider} provider - target provider (injectable for tests; defaults to the singleton)
 * @returns {Promise<boolean>} true when the real DEM is active
 */
export async function loadConfiguredDem(fetchImpl = (typeof fetch === 'function' ? fetch : null), provider = demProvider) {
  const { path, metadataPath, fallbackToSynthetic } = CONFIG.dem;
  if (!path || !metadataPath) return false;
  try {
    if (!fetchImpl) throw new Error('fetch is not available');
    const [metaRes, binRes] = await Promise.all([fetchImpl(metadataPath), fetchImpl(path)]);
    if (!metaRes.ok) throw new Error(`DEM metadata HTTP ${metaRes.status}: ${metadataPath}`);
    if (!binRes.ok) throw new Error(`DEM raster HTTP ${binRes.status}: ${path}`);
    const metadata = await metaRes.json();
    const buffer = await binRes.arrayBuffer();
    const ok = await provider.loadRealDem(buffer, metadata);
    if (!ok) throw new Error('DEM rejected by loader (see console)');
    return true;
  } catch (err) {
    if (fallbackToSynthetic) {
      console.warn('Real DEM unavailable, using synthetic terrain:', err.message);
      return false;
    }
    throw err;
  }
}
