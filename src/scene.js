/**
 * Artemis Lunar Landing Site Navigator - 3D Orrery & South Pole Scene Architecture
 * 
 * Round 2:
 * 1. South-Pole 3D Terrain Mesh from heightmap (grid size from CONFIG.radii.polarMeshGridSize, ±CONFIG.radii.polarDomainSpanKm)
 * 2. Directional solar shading (placeholder low grazing polar Sun direction)
 * 3. Conforming Lat/Lon grid from -80° to -90° (latitude rings + 30° radial meridians)
 * 4. Nine candidate region pins from regions.js sitting directly at terrain surface heights
 * 5. Raycaster pin hover tooltip and click-to-select detection
 * 6. Smooth exponential-damping camera transitions between Orrery, Pole overview, and docked regions
 */

import { mastDisplayHeight, panelNormalScene, panelShading, MAST_DISPLAY_RADIUS, PANEL_DISPLAY_WIDTH, PANEL_DISPLAY_HEIGHT } from './solarPanel3d.js';
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { REGIONS } from '../regions.js';
import {
  generateDemHeightfield,
  orientHeightsForMesh,
  generateTerrainAlbedo,
  generateLatLonGridLines,
  latLonToPolarStereo,
  getElevationAt,
} from './terrain.js';
import { EARTH_OBLIQUITY_DEG, computeTopocentricHorizon, computeEphemeris } from './ephemeris.js';
import { azimuthToMapDirection } from './mapGeometry.js';
import { sceneXZToPickedPoint } from './pickPoint.js';
import {
  GLOBE_RADIUS, GLOBE_MIN_DISTANCE, GLOBE_MAX_DISTANCE, GLOBE_FLY_DISTANCE, GLOBE_PIN_SCREEN_SCALE, globePinScale,
  GLOBE_DEFAULT_ORBIT, GLOBE_FOCUS_SOUTH_ORBIT, GLOBE_CAMERA_UP, GLOBE_DRAG_SIGN, GLOBE_ORBIT_TARGET, clampGlobeOrbit,
  latLonToGlobePosition, globePositionToLatLon, globeOrbitForLatLon, clampGlobePhi, clampGlobeDistance, globeCameraPosition, isGlobeHeadVisible, globeLightDirection, globeEarthshineIntensity, earthLitFractionFromMoon, GLOBE_SUN_LIGHT_INTENSITY, GLOBE_AMBIENT_INTENSITY, GLOBE_LIGHT_DISTANCE, GLOBE_EARTH_DISTANCE, GLOBE_EARTH_RADIUS, globeBodyPosition, globeProximityFade, GLOBE_EARTH_PATH_DAYS, GLOBE_PATH_STEP_HOURS, GLOBE_EARTH_PATH_PAST_OPACITY, GLOBE_EARTH_PATH_FUTURE_OPACITY, GLOBE_EARTH_MARKER_RADIUS_FACTOR, earthLibrationPathSamples, pathIndexAt, globePathNeedsRebuild, GLOBE_SUN_DISTANCE, GLOBE_SUN_RADIUS, GLOBE_SUN_LAT_EXAGGERATION, GLOBE_SUN_RING_PAST_OPACITY, GLOBE_SUN_RING_FUTURE_OPACITY, GLOBE_SUN_MARKER_RADIUS_FACTOR, sunOrbitRingSamples } from './globeView.js';
import { demProvider } from './demLoader.js';

/**
 * Procedural Earth 2D canvas equirectangular texture generator
 * Shared between Orrery mode and South Pole direct-to-Earth comms ray globe
 */
export function createProceduralEarthTexture() {
  if (typeof document === 'undefined') {
    return null;
  }
  const earthCanvas = document.createElement('canvas');
  earthCanvas.width = 512;
  earthCanvas.height = 256;
  const ectx = earthCanvas.getContext('2d');
  ectx.fillStyle = '#0a2342';
  ectx.fillRect(0, 0, 512, 256);
  ectx.fillStyle = '#123968';
  ectx.beginPath();
  ectx.arc(140, 110, 65, 0, Math.PI * 2);
  ectx.arc(330, 105, 80, 0, Math.PI * 2);
  ectx.fill();
  ectx.fillStyle = '#2f6f4e';
  ectx.beginPath();
  ectx.ellipse(120, 75, 40, 25, 0.3, 0, Math.PI * 2);
  ectx.ellipse(150, 155, 25, 45, 0.15, 0, Math.PI * 2);
  ectx.ellipse(320, 70, 70, 30, -0.1, 0, Math.PI * 2);
  ectx.ellipse(285, 140, 32, 45, 0.1, 0, Math.PI * 2);
  ectx.ellipse(410, 175, 22, 16, 0.2, 0, Math.PI * 2);
  ectx.fill();
  ectx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ectx.beginPath();
  ectx.arc(110, 85, 45, 0.2, Math.PI * 1.2);
  ectx.arc(290, 80, 55, 0.5, Math.PI * 1.4);
  ectx.fill();

  const earthTexture = new THREE.CanvasTexture(earthCanvas);
  earthTexture.colorSpace = THREE.SRGBColorSpace;
  return earthTexture;
}

const ORRERY_TEXTURE_BASE = './public/textures/';

/** Loads an image texture asynchronously; resolves null on any failure so callers keep their fallback. */
function loadOrreryTexture(file, { srgb = true } = {}) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof Image === 'undefined') { resolve(null); return; }
    new THREE.TextureLoader().load(
      ORRERY_TEXTURE_BASE + file,
      (tex) => {
        if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        resolve(tex);
      },
      undefined,
      () => resolve(null)
    );
  });
}

/**
 * Procedural solar photosphere (equirectangular, wraps horizontally): fractal granulation,
 * a few sunspot groups and bright faculae. Illustrative surface picture, not imagery.
 */
export function createProceduralSunTexture(width = 1024, height = 512) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  let seed = 20260711;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  // Periodic (in x) value noise on a lattice
  const makeNoise = (cx, cy) => {
    const lat = new Float32Array(cx * cy);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    return (u, v) => {
      const x = u * cx, y = v * (cy - 1);
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const fx = x - x0, fy = y - y0;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = lat[y0 * cx + (x0 % cx)], b = lat[y0 * cx + ((x0 + 1) % cx)];
      const c = lat[(y0 + 1) * cx + (x0 % cx)], d = lat[(y0 + 1) * cx + ((x0 + 1) % cx)];
      return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    };
  };
  const octaves = [makeNoise(12, 6), makeNoise(48, 24), makeNoise(200, 100), makeNoise(512, 256)];
  const weights = [0.10, 0.18, 0.37, 0.35];

  // Sunspot groups (u, v in [0,1], radius in pixels)
  const spots = [];
  for (let g = 0; g < 7; g++) {
    const cu = rnd(), cv = 0.30 + rnd() * 0.40;
    const n = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      spots.push({ x: (cu * width + (rnd() - 0.5) * 40 + width) % width, y: cv * height + (rnd() - 0.5) * 14, r: 4 + rnd() * 6 });
    }
  }

  const img = ctx.createImageData(width, height);
  for (let j = 0; j < height; j++) {
    const v = j / height;
    for (let i = 0; i < width; i++) {
      const u = i / width;
      let n = 0;
      for (let o = 0; o < octaves.length; o++) n += weights[o] * octaves[o](u, v);
      // Granulation contrast: cells slightly brighter than lanes
      const g = Math.min(1, Math.max(0, (n - 0.5) * 3.0 + 0.5));
      let r = 255 * (0.93 + 0.07 * g);
      let gr = 255 * (0.66 + 0.30 * g);
      let b = 255 * (0.28 + 0.34 * g);

      let k = 1;
      for (let s = 0; s < spots.length; s++) {
        let dx = Math.abs(i - spots[s].x); if (dx > width / 2) dx = width - dx;
        const d = Math.hypot(dx, (j - spots[s].y) * 1.4) / spots[s].r;
        if (d < 2.2) k = Math.min(k, d < 0.9 ? 0.28 : 0.28 + (d - 0.9) / 1.3 * 0.72);
      }
      r *= k; gr *= k; b *= k;

      const idx = (j * width + i) * 4;
      img.data[idx] = r; img.data[idx + 1] = gr; img.data[idx + 2] = b; img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** Self-lit photosphere material with limb darkening (mu = cos of angle to view direction). */
function createSunMaterial(map) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, limbU: { value: 0.62 } },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vN;
      void main() {
        vUv = uv;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D map;
      uniform float limbU;
      varying vec2 vUv;
      varying vec3 vN;
      void main() {
        float mu = clamp(vN.z, 0.0, 1.0);
        float limb = 1.0 - limbU * (1.0 - mu);
        vec3 c = texture2D(map, vUv).rgb * limb * 1.35;
        // limb reddening
        c *= mix(vec3(1.0, 0.78, 0.55), vec3(1.0), mu);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/**
 * Fresnel rim-glow shell. Defaults reproduce the Orrery Earth atmosphere (soft back-face halo).
 * Pole-mode globe: halo (BackSide) for the subtle blue rim, and a FrontSide shell with a high
 * power + strength for the crisp rim shown when the Earth is below the horizon or blocked.
 */
function createAtmosphereMaterial({ color = 0x5aa9ff, strength = 0.55, power = 4.5, side = THREE.BackSide, depthTest = true } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      glow: { value: new THREE.Color(color) },
      strength: { value: strength },
      power: { value: power },
      fade: { value: 1 },
    },
    vertexShader: `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 glow;
      uniform float strength;
      uniform float power;
      uniform float fade;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(vN, vV)), power);
        gl_FragColor = vec4(glow, clamp(f * strength, 0.0, 1.0) * fade);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    depthTest,
    blending: THREE.AdditiveBlending,
    side,
  });
}

/**
 * Earth's heliocentric orbit as a closed polyline CENTRED ON THE SUN (scene units).
 * r(L) = a(1-e²)/(1+e·cos(L-ϖ)), a = ORRERY_SUN_DIST, e = 0.0167086, ϖ = 102.9472° (J2000 ecliptic).
 * Scene ecliptic mapping: (cos λ, 0, -sin λ) (right-handed, +y = ecliptic north).
 */
export const ORRERY_SUN_DIST = 130.0;
export function computeEarthOrbitPoints(segments = 256) {
  const e = 0.0167086;
  const varpi = (102.9472 * Math.PI) / 180;
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const L = (i / segments) * Math.PI * 2;
    const r = ORRERY_SUN_DIST * (1 - e * e) / (1 + e * Math.cos(L - varpi));
    pts.push(new THREE.Vector3(r * Math.cos(L), 0, -r * Math.sin(L)));
  }
  return pts;
}

/**
 * Computes polar grazing sun light vector in scene coordinates.
 * Reference pole longitude lambda = 0°.
 * Uses true topocentric elevation without artificial +1.2° offset.
 */
export function computePolarSunLightVector(ephem) {
  const sunTopo = computeTopocentricHorizon(-90.0, 0.0, ephem.subSolarLat, ephem.subSolarLon, 149597870.7, 0.0);
  const sunDir = azimuthToMapDirection(sunTopo.azimuthDeg, 0.0);
  const elDeg = sunTopo.elevationDeg; // True Sun elevation without +1.2° offset
  const elRad = (elDeg * Math.PI) / 180.0;

  const sunX = sunDir.x * Math.cos(elRad);
  const sunY = Math.sin(elRad);
  const sunZ = sunDir.z * Math.cos(elRad);
  const angleDeg = ((Math.atan2(sunX, sunZ) * 180.0) / Math.PI + 360.0) % 360.0;

  return { sunX, sunY, sunZ, elDeg, angleDeg, trueElevationDeg: sunTopo.elevationDeg };
}

/**
 * Computes direct-to-Earth comms ray direction vector in scene coordinates.
 * Scene horizontal direction is (sin(az + lambda), cos(az + lambda)), vertical is sin(el).
 */
export function computeCommsRayVector(region, earthTopo) {
  const lonDeg = (region && typeof region.lon === 'number') ? region.lon : 0.0;
  const mapDir = azimuthToMapDirection(earthTopo.azimuthDeg, lonDeg);
  const elRad = (earthTopo.elevationDeg * Math.PI) / 180.0;

  const dirX = mapDir.x * Math.cos(elRad);
  const dirY = Math.sin(elRad);
  const dirZ = mapDir.z * Math.cos(elRad);
  const angleDeg = ((Math.atan2(dirX, dirZ) * 180.0) / Math.PI + 360.0) % 360.0;

  return { dirX, dirY, dirZ, angleDeg };
}

// ---------------------------------------------------------------------------------------------
// Pole-mode display constants (scene units; terrain half-width = polarDomainSpanKm * 0.35 ≈ 106.8).
// Everything below is a DISPLAY choice, not to scale; true directions come from the ephemeris.
// ---------------------------------------------------------------------------------------------
/**
 * The Earth globe sits at the END of the comms ray, along the true Earth direction from the selected
 * site (display size, not to scale). Ray length and globe radius are display choices.
 */
export const EARTH_GLOBE_RADIUS = 2;
/** High Polar Overview camera: orbit around OVERVIEW_LOOK, viewed from the far side (camera on -z) so the
 *  globes at the ray ends (all sites' Earth bearing is scene +z) stay in frame for every region and libration. */
export const OVERVIEW_LOOK = Object.freeze({ x: 0, y: 0, z: 10 });
export const OVERVIEW_DISTANCE = 250;
export const OVERVIEW_THETA = 2.0;
export const OVERVIEW_PHI = 1.15;
/** Docked camera: orbit around (site + DOCK_LOOK_FORWARD in +z), also on the far side so the globe at the ray end is ahead of the camera. */
export const DOCK_DISTANCE = 34;
export const DOCK_THETA = Math.PI - 0.5;
export const DOCK_PHI = 1.1;
export const DOCK_LOOK_FORWARD = 12;
/** Sun marker and Sun path ring distance from the pole axis; outside the terrain half-width. */
export const SUN_DISPLAY_RADIUS = 135;
export const SUN_MARKER_RADIUS = 3.2;
/** The Sun path ring multiplies the true elevation by this factor so the ~1.5° swing stays readable. */
export const SUN_PATH_ELEVATION_EXAGGERATION = 3;
export const SYNODIC_MONTH_DAYS = 29.530588;
export const SUN_PATH_STEP_HOURS = 3;
/** Length of the comms ray; the Earth globe is centred on its end. */
export const COMMS_RAY_LENGTH = 70;

/**
 * Earth globe state from the topocentric elevation and the unblocked disc fraction.
 * mode 'visible': above the horizon and not blocked -> textured globe + crisp bright rim.
 * mode 'ghost'  : below the horizon or blocked      -> globe body hidden, only the crisp bright rim remains (drawn over terrain).
 */
export function formatEarthLabel(elevationDeg, fEarth) {
  const f = Math.max(0, Math.min(1, fEarth));
  let status = 'CLEAR';
  let tone = 'cyan';
  if (elevationDeg < 0) { status = 'BELOW HORIZON'; tone = 'coral'; }
  else if (f >= 0.95) { status = 'CLEAR'; tone = 'cyan'; }
  else if (f > 0.05) { status = 'PARTIAL'; tone = 'amber'; }
  else { status = 'BLOCKED'; tone = 'coral'; }
  const elStr = (elevationDeg >= 0 ? '+' : '') + elevationDeg.toFixed(1) + '°';
  return {
    text: `Earth · elevation ${elStr} · visible ${Math.round(f * 100)}% · ${status}`,
    status,
    tone,
    mode: elevationDeg < 0 || f <= 0.05 ? 'ghost' : 'visible',
  };
}

/** Sun marker label: topocentric elevation/azimuth at the selected region and its lit state. */
export function formatSunLabel(sunTopo, fSun) {
  const f = Math.max(0, Math.min(1, fSun));
  const el = sunTopo.elevationDeg;
  let status = 'LIT';
  let tone = 'amber';
  if (el < 0) { status = 'BELOW HORIZON'; tone = 'coral'; }
  else if (f >= 0.95) { status = 'LIT'; tone = 'amber'; }
  else if (f > 0.05) { status = 'PARTIAL'; tone = 'amber'; }
  else { status = 'SHADOWED'; tone = 'coral'; }
  const elStr = (el >= 0 ? '+' : '') + el.toFixed(1) + '°';
  const az = String(Math.round(((sunTopo.azimuthDeg % 360) + 360) % 360) % 360).padStart(3, '0');
  return { text: `Sun · elevation ${elStr} · azimuth ${az}° · ${status}`, status, tone };
}

/**
 * Keeps an HTML label fully inside the viewport. The anchor is the label's bottom-centre.
 * `rightInset` reserves the width of a panel overlapping the right edge of the canvas.
 */
export function clampLabelToViewport({ anchorX, anchorY, labelW, labelH, viewW, viewH, margin = 8, rightInset = 0 }) {
  const minX = margin + labelW / 2;
  const maxX = Math.max(minX, viewW - rightInset - margin - labelW / 2);
  const minY = margin + labelH;
  const maxY = Math.max(minY, viewH - margin);
  return {
    x: Math.min(maxX, Math.max(minX, anchorX)),
    y: Math.min(maxY, Math.max(minY, anchorY)),
  };
}

/**
 * Pins an off-screen target to the edge of the usable viewport (canvas minus the right-hand panel).
 * Returns the label CENTRE on the rectangle boundary along the ray from the usable-area centre toward the
 * target, plus the arrow angle in radians (0 = pointing right, y down), so the arrow points at the target.
 * `dirX`/`dirY` are the screen-space direction from the usable centre toward the target (y down).
 */
export function pinLabelToEdge({ dirX, dirY, labelW, labelH, viewW, viewH, margin = 8, rightInset = 0 }) {
  const left = margin + labelW / 2;
  const right = Math.max(left, viewW - rightInset - margin - labelW / 2);
  const top = margin + labelH / 2;
  const bottom = Math.max(top, viewH - margin - labelH / 2);
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const hw = (right - left) / 2;
  const hh = (bottom - top) / 2;
  let dx = dirX;
  let dy = dirY;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9)) { dx = 0; dy = -1; }
  const t = Math.min(Math.abs(dx) > 1e-9 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? hh / Math.abs(dy) : Infinity);
  return { x: cx + dx * t, y: cy + dy * t, angleRad: Math.atan2(dy, dx) };
}

/** Point on the display sky sphere for a polar Sun vector, with optional elevation exaggeration. */
export function polarSkyPoint(sunVec, radius, exaggeration = 1) {
  const h = Math.hypot(sunVec.sunX, sunVec.sunZ) || 1;
  const el = Math.asin(Math.max(-1, Math.min(1, sunVec.sunY))) * exaggeration;
  return { x: (radius * Math.cos(el) * sunVec.sunX) / h, y: radius * Math.sin(el), z: (radius * Math.cos(el) * sunVec.sunZ) / h };
}

/**
 * Sun track over one synodic month centred on `centerDate`, sampled every `stepHours` with the same
 * ephemeris and pole-observer geometry that drive the scene light (computePolarSunLightVector).
 * Returns { startMs, stepMs, samples: [{ azDeg, elDeg, point }] }; `point` is the exaggerated ring position.
 */
export function computeSunPathSamples(centerDate, spanDays = SYNODIC_MONTH_DAYS, stepHours = SUN_PATH_STEP_HOURS) {
  const stepMs = stepHours * 3600 * 1000;
  const spanMs = spanDays * 86400 * 1000;
  const startMs = centerDate.getTime() - spanMs / 2;
  const n = Math.round(spanMs / stepMs) + 1;
  const samples = [];
  for (let i = 0; i < n; i++) {
    const vec = computePolarSunLightVector(computeEphemeris(new Date(startMs + i * stepMs)));
    samples.push({
      azDeg: vec.angleDeg,
      elDeg: vec.elDeg,
      point: polarSkyPoint(vec, SUN_DISPLAY_RADIUS, SUN_PATH_ELEVATION_EXAGGERATION),
    });
  }
  return { startMs, stepMs, samples };
}

/** Index k of the sample at or before timeMs, clamped so that k and k+1 are valid. */
export function sunPathIndexAt(path, timeMs) {
  const k = Math.floor((timeMs - path.startMs) / path.stepMs);
  return Math.max(0, Math.min(path.samples.length - 2, k));
}

const LABEL_BASE = 'absolute left-0 top-0 px-2.5 py-1 rounded-xl bg-[#07090E]/90 border text-[11px] font-mono font-semibold text-white whitespace-nowrap shadow-lg';
const LABEL_TONE = { cyan: 'border-cyan-500/80', amber: 'border-amber-500/80', coral: 'border-rose-500/80' };

/**
 * Phase 8: procedural solar-cell texture for the 3D panel (no image file). `emissive=false` draws the colour map
 * (blue monocrystalline cells, silver busbars, light grid gaps, aluminium border); `emissive=true` draws a mask
 * (white cells on black) so only the cells glow when the panel is lit. Returns null when no 2D canvas exists
 * (headless tests), in which case the panel keeps its flat colour.
 */
const SOLAR_PANEL_DIM_INTENSITY = 0.75; // shadowed / facing away: still clearly visible
const SOLAR_PANEL_LIT_BASE = 0.85;      // lit: brighter, plus SOLAR_PANEL_LIT_GAIN * cos(theta_inc)
const SOLAR_PANEL_LIT_GAIN = 0.55;
const PANEL_TEX_COLS = 10;
const PANEL_TEX_ROWS = 6;
function createSolarCellTexture(emissive) {
  if (typeof document === 'undefined') return null;
  const w = 1024, h = Math.round(1024 * PANEL_DISPLAY_HEIGHT / PANEL_DISPLAY_WIDTH);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return null;
  const border = 26, gap = 9, corner = 14; // thick, bold lines so the pattern survives mipmapping at distance
  // Background = aluminium frame + bright cell separators (the emissive mask keeps them dark)
  ctx.fillStyle = emissive ? '#000000' : '#e2e8f0';
  ctx.fillRect(0, 0, w, h);
  const cw = (w - 2 * border - gap * (PANEL_TEX_COLS - 1)) / PANEL_TEX_COLS;
  const ch = (h - 2 * border - gap * (PANEL_TEX_ROWS - 1)) / PANEL_TEX_ROWS;
  for (let r = 0; r < PANEL_TEX_ROWS; r++) {
    for (let c = 0; c < PANEL_TEX_COLS; c++) {
      const x = border + c * (cw + gap), y = border + r * (ch + gap);
      // Monocrystalline cell with clipped corners
      ctx.beginPath();
      ctx.moveTo(x + corner, y); ctx.lineTo(x + cw - corner, y); ctx.lineTo(x + cw, y + corner);
      ctx.lineTo(x + cw, y + ch - corner); ctx.lineTo(x + cw - corner, y + ch); ctx.lineTo(x + corner, y + ch);
      ctx.lineTo(x, y + ch - corner); ctx.lineTo(x, y + corner); ctx.closePath();
      if (emissive) {
        ctx.fillStyle = '#9a9a9a'; // cells glow at a moderate level so the busbars below stay visible
        ctx.fill();
        ctx.fillStyle = '#3c3c3c';
        for (let k = 1; k <= 3; k++) ctx.fillRect(x + (k * cw) / 4 - 2, y, 4, ch);
        continue;
      }
      const g = ctx.createLinearGradient(x, y, x + cw, y + ch);
      g.addColorStop(0, '#2563eb');
      g.addColorStop(0.5, '#1e40af');
      g.addColorStop(1, '#0b1f5c');
      ctx.fillStyle = g;
      ctx.fill();
      // Three bold silver busbars per cell
      ctx.fillStyle = '#e2e8f0';
      for (let k = 1; k <= 3; k++) ctx.fillRect(x + (k * cw) / 4 - 2, y, 4, ch);
      // Fine horizontal fingers
      ctx.fillStyle = 'rgba(226,232,240,0.35)';
      for (let f = 1; f < 10; f++) ctx.fillRect(x, y + (f * ch) / 10 - 1, cw, 2);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = emissive ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export class LunarNavigatorScene {
  constructor(canvasContainer, callbacks = {}) {
    this.container = canvasContainer;
    this.callbacks = callbacks;
    this.regions = REGIONS;
    this.selectedRegion = this.regions[2]; // Default: Malapert Massif

    // View mode: 'orrery' (opening view) | 'globe' (Moon globe) | 'south_pole'
    this.viewMode = 'orrery';
    this.cameraPreset = 'overview';
    // Moon globe camera (orbits the globe centre; separate from the Orrery/pole orbit state)
    this.globeOrbit = { ...GLOBE_DEFAULT_ORBIT };

    // Scale constants (1 km = 0.35 Three.js units, vertical scale = 0.40)
    this.spatialScale = 0.35;
    this.verticalScale = 0.40;
    // Domain scale factor vs. the original ±100 km mesh (camera distances were tuned at 1.0)
    this.domainScale = CONFIG.radii.polarDomainSpanKm / 100.0;

    // Interactive orbit control state
    this.isDragging = false;
    this.prevMousePos = { x: 0, y: 0 };
    this.orbitAngle = { theta: 0.5, phi: 0.85, distance: 95 };

    // Camera animation targets (exponential damping)
    this.targetCamLook = new THREE.Vector3(0, 0, 0);
    this.currentCamLook = new THREE.Vector3(0, 0, 0);
    this.targetCamPos = new THREE.Vector3(0, 55, 95);

    // Dynamic celestial positions (Orrery)
    this.earthPos = new THREE.Vector3(0, 0, 0);
    this.moonPos = new THREE.Vector3(24, 0, 0);
    this.sunPos = new THREE.Vector3(130, 0, 0);

    // Raycasting for region pins
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(-999, -999);
    this.hoveredPin = null;

    // Triangle count tracker
    this.terrainTriangleCount = 0;

    // Round 8: Comms ray toggle state
    this.isCommsRayVisible = true;
    this.isEarthGlobeVisible = true;
    this.isSunVisible = true;
    this._overlayRightInset = 0;
    this._sunPath = null;
    this._sunPathCenterMs = NaN;
    this._globeEarthPath = null;
    this._globeEarthPathCenterMs = NaN;
    this._globeEarthPathBuilds = 0;
    this._globeSunRing = null;
    this._globeSunRingCenterMs = NaN;
    this._globeSunRingBuilds = 0;
    this.sunMarkerPos = new THREE.Vector3(SUN_DISPLAY_RADIUS, 0, 0);

    this._init();
  }

  _init() {
    // 1. WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: true,
    });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.container.appendChild(this.renderer.domElement);

    // 2. Scene & Camera
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(CONFIG.colors.background);
    this.scene.fog = new THREE.FogExp2(CONFIG.colors.background, 0.0012);

    this.camera = new THREE.PerspectiveCamera(
      45,
      this.container.clientWidth / this.container.clientHeight,
      0.1,
      3000
    );
    this.camera.position.set(0, 55, 95);

    // 3. Lighting Rig
    this.ambientLight = new THREE.AmbientLight(0x1e293b, 0.45);
    this.scene.add(this.ambientLight);

    // Orrery Sun Light
    this.sunLight = new THREE.DirectionalLight(0xfffbf0, 2.5);
    this.sunLight.position.set(130, 0, 0);
    this.scene.add(this.sunLight);

    // Polar Terrain Grazing Sun Light (placeholder constant low-angle direction until Round 4)
    this.polarSunLight = new THREE.DirectionalLight(0xfff8e7, 2.2);
    this.polarSunLight.position.set(60, 4.5, 30); // ~4.3° low polar grazing angle
    this.polarSunLight.castShadow = true;
    {
      const halfUnits = CONFIG.radii.polarDomainSpanKm * this.spatialScale;
      const sc = this.polarSunLight.shadow.camera;
      const ext = halfUnits * 1.5;
      sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
      sc.near = 0.5; sc.far = halfUnits * 6;
      sc.updateProjectionMatrix();
      this.polarSunLight.shadow.mapSize.set(2048, 2048);
    }
    this.scene.add(this.polarSunLight);

    // Subtle sky bounce fill light
    this.polarFillLight = new THREE.DirectionalLight(0x38bdf8, 0.25);
    this.polarFillLight.position.set(-40, 25, -40);
    this.scene.add(this.polarFillLight);

    // Moon globe lights (Phase G2): a directional Sun light along the TRUE Sun direction (updated whenever simulation
    // time changes), a faint constant ambient and an artistic earthshine fill from the Earth direction. Globe view only.
    this.globeLight = new THREE.DirectionalLight(0xfff8ee, GLOBE_SUN_LIGHT_INTENSITY);
    this.scene.add(this.globeLight);
    this.scene.add(this.globeLight.target);
    this.globeAmbientLight = new THREE.AmbientLight(0x1e293b, GLOBE_AMBIENT_INTENSITY);
    this.globeAmbientLight.visible = false;
    this.scene.add(this.globeAmbientLight);
    this.globeEarthshineLight = new THREE.DirectionalLight(0x9cc4ff, 0);
    this.globeEarthshineLight.visible = false;
    this.scene.add(this.globeEarthshineLight);
    this.scene.add(this.globeEarthshineLight.target);

    // 4. Background Starfield
    this._createStarfield();

    // 5. Planetary Bodies (Orrery Mode)
    this._createOrreryObjects();

    // 6. South Pole Terrain Mesh & Coordinate Grid (Round 2)
    this._createSouthPoleTerrain();
    this._createLatLonGrid();

    // 7. Nine Candidate Region Pins (Round 2)
    this._createRegionPins();

    // 7b. Phase 13: Moon globe landing view (orientation and region picking only)
    this._createMoonGlobe();
    this._createGlobeEarth();
    this._createGlobeSun();

    // 8. Round 8: Terrain-Occluded Direct-to-Earth Comms Ray
    this._createCommsRay();

    // 8b. Phase 5 Sun marker + Sun path, Phase 4 HTML labels
    this._createSunLayer();
    this._createSolarPanel();
    this._createOverlays();

    // 9. Event Listeners & Interaction
    this._setupEventListeners();

    // 10. Initial View Mode Visibility (the app opens on the Orrery)
    this.setViewMode('orrery', false);

    // 10. Animation Loop
    this.clock = new THREE.Clock();
    this._animate = this._animate.bind(this);
    this.frameId = requestAnimationFrame(this._animate);
  }

  _createStarfield() {
    const starCount = 2400;
    const starGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount * 3; i += 3) {
      const radius = 600 + Math.random() * 800;
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);

      positions[i] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i + 2] = radius * Math.cos(phi);

      const colorVal = 0.8 + Math.random() * 0.2;
      const tint = Math.random();
      if (tint > 0.85) {
        colors[i] = colorVal * 0.88;
        colors[i + 1] = colorVal * 0.94;
        colors[i + 2] = colorVal;
      } else if (tint < 0.2) {
        colors[i] = colorVal;
        colors[i + 1] = colorVal * 0.9;
        colors[i + 2] = colorVal * 0.75;
      } else {
        colors[i] = colorVal;
        colors[i + 1] = colorVal;
        colors[i + 2] = colorVal;
      }
    }

    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const starMaterial = new THREE.PointsMaterial({
      size: 1.4,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
    });

    this.starPoints = new THREE.Points(starGeometry, starMaterial);
    this.scene.add(this.starPoints);
  }

  _createOrreryObjects() {
    this.orreryGroup = new THREE.Group();

    // 1. Sun (procedural photosphere with limb darkening; textures are illustrative)
    const sunTexture = createProceduralSunTexture();
    const sunGeo = new THREE.SphereGeometry(7.0, 64, 64);
    this.sunMaterial = sunTexture
      ? createSunMaterial(sunTexture)
      : new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    this.sunMesh = new THREE.Mesh(sunGeo, this.sunMaterial);

    // Sun Halo / corona
    const haloCanvas = document.createElement('canvas');
    haloCanvas.width = 128;
    haloCanvas.height = 128;
    const hctx = haloCanvas.getContext('2d');
    const hgrad = hctx.createRadialGradient(64, 64, 20, 64, 64, 64);
    hgrad.addColorStop(0, 'rgba(255, 214, 120, 0.75)');
    hgrad.addColorStop(0.35, 'rgba(255, 160, 50, 0.30)');
    hgrad.addColorStop(0.7, 'rgba(255, 110, 20, 0.08)');
    hgrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    hctx.fillStyle = hgrad;
    hctx.fillRect(0, 0, 128, 128);
    const haloSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(haloCanvas),
      color: 0xfffbeb,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    haloSprite.scale.set(34, 34, 1);

    this.sunGroup = new THREE.Group();
    this.sunGroup.add(this.sunMesh);
    this.sunGroup.add(haloSprite);
    this.orreryGroup.add(this.sunGroup);

    // 2. Earth: procedural fallback first, swapped for NASA-derived maps as soon as they load
    const earthRadius = 4.2;
    this.earthMaterial = new THREE.MeshPhongMaterial({
      map: createProceduralEarthTexture(),
      specular: new THREE.Color(0x333333),
      shininess: 14,
    });
    this.earthMesh = new THREE.Mesh(new THREE.SphereGeometry(earthRadius, 96, 96), this.earthMaterial);
    this.earthCloudMesh = new THREE.Mesh(
      new THREE.SphereGeometry(earthRadius * 1.008, 96, 96),
      new THREE.MeshPhongMaterial({ transparent: true, opacity: 0.0, depthWrite: false })
    );
    this.earthAtmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(earthRadius * 1.07, 64, 64),
      createAtmosphereMaterial()
    );
    this.earthGroup = new THREE.Group();
    const earthTiltGroup = new THREE.Group();
    // North pole points toward ecliptic longitude 90° = -z in the scene mapping, so tilt about +x by -ε
    earthTiltGroup.rotation.x = -(EARTH_OBLIQUITY_DEG * Math.PI) / 180;
    earthTiltGroup.add(this.earthMesh);
    earthTiltGroup.add(this.earthCloudMesh);
    this.earthGroup.add(earthTiltGroup);
    this.earthGroup.add(this.earthAtmosphere);
    this.earthAtmosphere.rotation.x = earthTiltGroup.rotation.x;
    this.orreryGroup.add(this.earthGroup);

    // 3. Moon: neutral grey fallback, swapped for the LRO-derived map when loaded
    this.moonMaterial = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.95, metalness: 0.0 });
    this.moonMesh = new THREE.Mesh(new THREE.SphereGeometry(1.8, 96, 96), this.moonMaterial);
    this.moonGroup = new THREE.Group();
    this.moonGroup.add(this.moonMesh);
    this.orreryGroup.add(this.moonGroup);

    this._loadOrreryTextures();

    // 4. Orbit Lines & Sub-Solar Arrow
    const lunarOrbitPoints = [];
    for (let i = 0; i <= 128; i++) {
      const th = (i / 128) * Math.PI * 2;
      const r = 24.0;
      const inc = (5.145 * Math.PI) / 180;
      lunarOrbitPoints.push(new THREE.Vector3(r * Math.cos(th), r * Math.sin(th) * Math.sin(inc), -r * Math.sin(th) * Math.cos(inc)));
    }
    this.lunarOrbitLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(lunarOrbitPoints),
      new THREE.LineBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.35 })
    );
    this.orreryGroup.add(this.lunarOrbitLine);

    // Earth's orbit around the Sun: ellipse centred on the Sun (moved with it every update);
    // Earth sits on it because the Sun distance is scaled by the ephemeris distance in AU.
    this.earthOrbitLine = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(computeEarthOrbitPoints(256).slice(0, -1)),
      new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.55, fog: false })
    );
    this.orreryGroup.add(this.earthOrbitLine);

    this.subSolarArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 0),
      12.0,
      0xf59e0b,
      2.0,
      1.2
    );
    this.subSolarArrow.line.material.transparent = true;
    this.subSolarArrow.line.material.opacity = 0.85;
    this.orreryGroup.add(this.subSolarArrow);

    this.scene.add(this.orreryGroup);
  }

  /** Loads the Earth/Moon surface maps (public/textures) and upgrades the fallback materials in place. */
  async _loadOrreryTextures() {
    const [day, spec, normal, clouds, moon, lroc] = await Promise.all([
      loadOrreryTexture('earth_day.jpg'),
      loadOrreryTexture('earth_specular.jpg', { srgb: false }),
      loadOrreryTexture('earth_normal.jpg', { srgb: false }),
      loadOrreryTexture('earth_clouds.png'),
      loadOrreryTexture('moon.jpg'),
      loadOrreryTexture('moon_lroc_color_4k.jpg'),
    ]);
    if (day) {
      this.earthMaterial.map = day;
      this.earthMaterial.specularMap = spec;
      this.earthMaterial.normalMap = normal;
      if (normal) this.earthMaterial.normalScale.set(0.85, 0.85);
      this.earthMaterial.specular.set(0x4a5560);
      this.earthMaterial.needsUpdate = true;
    }
    // Pole-mode globe shares the same loaded textures (no second download / GPU copy)
    if (day && this.commsEarthMat) {
      const m = this.commsEarthMat;
      m.map = day;
      m.emissiveMap = day;
      m.specularMap = spec;
      m.normalMap = normal;
      if (normal) m.normalScale.set(0.85, 0.85);
      m.specular.set(0x4a5560);
      m.needsUpdate = true;
    }
    // Globe-view Earth shares the same day map
    if (day && this.globeEarthMat) {
      this.globeEarthMat.uniforms.map.value = day;
    }
    if (clouds && this.commsCloudMesh) {
      const m = this.commsCloudMesh.material;
      m.map = clouds;
      m.opacity = 0.85;
      m.needsUpdate = true;
    }
    if (clouds && this.earthCloudMesh) {
      const m = this.earthCloudMesh.material;
      m.map = clouds;
      m.alphaMap = null;
      m.opacity = 0.85;
      m.needsUpdate = true;
    }
    if (moon) {
      this.moonMaterial.map = moon;
      this.moonMaterial.color.set(0xffffff);
      this.moonMaterial.needsUpdate = true;
    }
    // Moon globe: LROC colour mosaic, falling back to the Orrery Moon map, then to plain grey
    const globeMap = lroc || moon;
    if (globeMap && this.globeMaterial) {
      this.globeMaterial.map = globeMap;
      this.globeMaterial.color.set(0xffffff);
      this.globeMaterial.needsUpdate = true;
    }
  }

  /**
   * Phase 13: Moon globe (initial view). A textured sphere, a faint lat/lon grid and the nine region pins
   * placed from regions.js lat/lon. Orientation only: it does not replace or feed the DEM terrain.
   */
  _createMoonGlobe() {
    this.globeGroup = new THREE.Group();
    this.globeGroup.name = 'moon-globe';

    this.globeMaterial = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 1.0, metalness: 0.0 });
    this.globeMesh = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_RADIUS, 128, 96), this.globeMaterial);
    this.globeGroup.add(this.globeMesh);

    // Faint lat/lon grid (same slate style as the polar grid), just above the surface
    const gridMat = new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.28 });
    const gridR = GLOBE_RADIUS * 1.002;
    const ring = (fn) => {
      const pts = [];
      for (let i = 0; i <= 96; i++) pts.push(fn(i / 96));
      const v = (p) => new THREE.Vector3(p.x, p.y, p.z);
      return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(v)), gridMat);
    };
    for (const lat of [-75, -60, -30, 0, 30, 60]) {
      this.globeGroup.add(ring((t) => latLonToGlobePosition(lat, -180 + 360 * t, gridR)));
    }
    for (let lon = -150; lon <= 180; lon += 30) {
      this.globeGroup.add(ring((t) => latLonToGlobePosition(-90 + 180 * t, lon, gridR)));
    }

    // Region pins: same colours/status styling as the polar pins (amber = candidate, cyan = selected)
    this.globePinsGroup = new THREE.Group();
    this.globePinHits = [];
    const stemGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.0, 8);
    const headGeo = new THREE.SphereGeometry(0.5, 16, 16);
    const ringGeo = new THREE.RingGeometry(0.3, 0.7, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const hitGeo = new THREE.SphereGeometry(1.1, 8, 8);
    const up = new THREE.Vector3(0, 1, 0);
    this.regions.forEach((reg) => {
      const p = latLonToGlobePosition(reg.lat, reg.lon, GLOBE_RADIUS);
      const normal = new THREE.Vector3(p.x, p.y, p.z).normalize();
      const isSelected = reg.id === this.selectedRegion.id;

      const g = new THREE.Group();
      g.name = reg.id;
      g.position.set(p.x, p.y, p.z);
      g.quaternion.setFromUnitVectors(up, normal);
      g.userData = { region: reg, surface: p };

      const stem = new THREE.Mesh(stemGeo, new THREE.MeshBasicMaterial({ color: 0x94a3b8 }));
      stem.position.y = 0.5;
      g.add(stem);

      const head = new THREE.Mesh(headGeo, new THREE.MeshStandardMaterial({
        color: isSelected ? 0x06b6d4 : 0xf59e0b,
        emissive: isSelected ? 0x0891b2 : 0xb45309,
        emissiveIntensity: isSelected ? 0.85 : 0.4,
        roughness: 0.3,
      }));
      head.position.y = 1.0;
      head.userData = { region: reg, isPinHead: true };
      g.add(head);

      const base = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: isSelected ? 0x06b6d4 : 0xf59e0b,
        transparent: true,
        opacity: isSelected ? 0.9 : 0.4,
        side: THREE.DoubleSide,
      }));
      base.position.y = 0.04;
      g.add(base);

      // Invisible, larger click/hover target (never rendered; raycasting ignores material.visible)
      const hit = new THREE.Mesh(hitGeo, new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.y = 1.0;
      hit.userData = { region: reg, isPinHit: true, group: g };
      g.add(hit);

      this.globePinsGroup.add(g);
      this.globePinHits.push(hit);
    });
    this.globeGroup.add(this.globePinsGroup);

    // Selection marker for the point or region picked on the globe (white ring + short stem, hidden until a pick)
    const selRing = new THREE.RingGeometry(0.75, 1.0, 32);
    selRing.rotateX(-Math.PI / 2);
    this.globeSelectMarker = new THREE.Group();
    this.globeSelectMarker.name = 'globe-selection';
    this.globeSelectMarker.visible = false;
    const selMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthTest: false });
    const selBase = new THREE.Mesh(selRing, selMat);
    selBase.position.y = 0.05;
    selBase.renderOrder = 5;
    const selDot = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), new THREE.MeshBasicMaterial({ color: 0x22d3ee, depthTest: false }));
    selDot.position.y = 0.2;
    selDot.renderOrder = 6;
    this.globeSelectMarker.add(selBase, selDot);
    this.globeGroup.add(this.globeSelectMarker);

    this.scene.add(this.globeGroup);
  }

  /**
   * Phase G3: Earth in the Moon globe view (child of the globe group, so it exists only there). Real day map, axial
   * tilt, real-time rotation, day/night side from the true Sun direction (uniform sunDir; texture never recoloured).
   * The body keeps the normal depth test (the Moon hides it); the crisp bright rim ignores depth, so it stays
   * visible when the Moon is in front. Not to scale; direction only is real.
   */
  _createGlobeEarth() {
    const R = GLOBE_EARTH_RADIUS;
    const fallbackTex = createProceduralEarthTexture();
    this.globeEarthMat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: fallbackTex },
        sunDir: { value: new THREE.Vector3(1, 0, 0) },
        fade: { value: 1 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNw;
        void main() {
          vUv = uv;
          vNw = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D map;
        uniform vec3 sunDir;
        uniform float fade;
        varying vec2 vUv;
        varying vec3 vNw;
        void main() {
          vec3 tex = texture2D(map, vUv).rgb;
          float lit = smoothstep(-0.12, 0.2, dot(normalize(vNw), normalize(sunDir)));
          vec3 col = tex * mix(0.07, 1.0, lit);
          gl_FragColor = vec4(col, fade);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthTest: true,
      depthWrite: true,
    });
    this.globeEarthMesh = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 64), this.globeEarthMat);
    this.globeEarthMesh.name = 'globe-earth-body';

    this.globeEarthHaloMesh = new THREE.Mesh(new THREE.SphereGeometry(R * 1.12, 48, 48), createAtmosphereMaterial({ strength: 0.55 }));
    this.globeEarthHaloMesh.name = 'globe-earth-halo';
    this.globeEarthRimMesh = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.02, 48, 48),
      createAtmosphereMaterial({ color: 0xbfe6ff, strength: 2.4, power: 3.0, side: THREE.FrontSide, depthTest: false })
    );
    this.globeEarthRimMesh.name = 'globe-earth-rim';
    this.globeEarthRimMesh.renderOrder = 21;

    this.globeEarthTiltGroup = new THREE.Group();
    this.globeEarthTiltGroup.rotation.z = (EARTH_OBLIQUITY_DEG * Math.PI) / 180.0;
    this.globeEarthTiltGroup.add(this.globeEarthMesh);

    this.globeEarthGroup = new THREE.Group();
    this.globeEarthGroup.name = 'globe-earth';
    this.globeEarthGroup.add(this.globeEarthTiltGroup, this.globeEarthRimMesh, this.globeEarthHaloMesh);
    this.globeEarthGroup.position.set(GLOBE_EARTH_DISTANCE, 0, 0);
    this.globeGroup.add(this.globeEarthGroup);

    // Phase G4: libration path. One shared position buffer, two line views (past dim, future bright), depth-tested
    // normally (the Moon hides it), plus a thin camera-facing marker ring around the Earth's current position.
    const maxSamples = Math.round((GLOBE_EARTH_PATH_DAYS * 24) / GLOBE_PATH_STEP_HOURS) + 2;
    this.globeEarthPathAttr = new THREE.BufferAttribute(new Float32Array(maxSamples * 3), 3);
    const pathColor = new THREE.Color(CONFIG.colors.accentEarthPath);
    const makePathLine = (opacity) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', this.globeEarthPathAttr);
      geo.setDrawRange(0, 0);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: pathColor, transparent: true, opacity, fog: false }));
      line.frustumCulled = false;
      return line;
    };
    this.globeEarthPathPast = makePathLine(GLOBE_EARTH_PATH_PAST_OPACITY);
    this.globeEarthPathFuture = makePathLine(GLOBE_EARTH_PATH_FUTURE_OPACITY);
    this.globeEarthPathPast.name = 'globe-earth-path-past';
    this.globeEarthPathFuture.name = 'globe-earth-path-future';
    const ringPts = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      ringPts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0).multiplyScalar(GLOBE_EARTH_RADIUS * GLOBE_EARTH_MARKER_RADIUS_FACTOR));
    }
    this.globeEarthMarkerRing = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ringPts),
      new THREE.LineBasicMaterial({ color: pathColor, transparent: true, opacity: 0.9, fog: false })
    );
    this.globeEarthMarkerRing.name = 'globe-earth-path-marker';
    this.globeEarthMarker = new THREE.Group();
    this.globeEarthMarker.add(this.globeEarthMarkerRing);
    this.globeGroup.add(this.globeEarthPathPast, this.globeEarthPathFuture, this.globeEarthMarker);
  }

  /**
   * Rebuilds the libration samples only when the simulation time has moved more than about one day from the
   * cached centre (never every frame), then sets the past/future draw ranges and the marker at the current time.
   */
  _updateGlobeEarthPath(ephem) {
    if (!ephem || !this.globeEarthPathAttr) return;
    const tMs = ephem.date.getTime();
    if (!this._globeEarthPath || globePathNeedsRebuild(this._globeEarthPathCenterMs, tMs)) {
      this._globeEarthPath = earthLibrationPathSamples(new Date(tMs));
      this._globeEarthPathCenterMs = tMs;
      this._globeEarthPathBuilds = (this._globeEarthPathBuilds || 0) + 1;
      const arr = this.globeEarthPathAttr.array;
      this._globeEarthPath.samples.forEach((smp, i) => {
        arr[i * 3] = smp.point.x; arr[i * 3 + 1] = smp.point.y; arr[i * 3 + 2] = smp.point.z;
      });
      this.globeEarthPathAttr.needsUpdate = true;
    }
    const n = this._globeEarthPath.samples.length;
    const k = pathIndexAt(this._globeEarthPath, tMs);
    this.globeEarthPathPast.geometry.setDrawRange(0, k + 1);
    this.globeEarthPathFuture.geometry.setDrawRange(k, n - k);
    if (this.globeEarthGroup) this.globeEarthMarker.position.copy(this.globeEarthGroup.position);
  }

  /** Places the globe-view Earth along the sub-Earth direction, spins it with real time and points its day side at the Sun. */
  _updateGlobeEarth(ephem) {
    if (!ephem || !this.globeEarthGroup) return;
    const p = globeBodyPosition(ephem.subEarthLat, ephem.subEarthLon, GLOBE_EARTH_DISTANCE);
    this.globeEarthGroup.position.set(p.x, p.y, p.z);
    this.globeEarthMesh.rotation.y = (ephem.earthRotationDeg * Math.PI) / 180.0;
    const s = globeLightDirection(ephem.subSolarLat, ephem.subSolarLon);
    this.globeEarthMat.uniforms.sunDir.value.set(s.x, s.y, s.z);
    this._updateGlobeEarthPath(ephem);
  }

  /** Fades the Earth (body, rim, halo) out smoothly when the camera comes close, so the camera never sits inside it. */
  _updateGlobeEarthFade() {
    if (!this.globeEarthGroup) return;
    const d = this.camera.position.distanceTo(this.globeEarthGroup.position);
    const f = globeProximityFade(d, GLOBE_EARTH_RADIUS);
    this.globeEarthMat.uniforms.fade.value = f;
    this.globeEarthRimMesh.material.uniforms.fade.value = f;
    this.globeEarthHaloMesh.material.uniforms.fade.value = f;
    this.globeEarthGroup.visible = f > 0.001;
    this._globeEarthFade = f;
    if (this.globeEarthMarker) {
      this.globeEarthMarker.visible = f > 0.001;
      this.globeEarthMarkerRing.material.opacity = 0.9 * f;
      this.globeEarthMarker.quaternion.copy(this.camera.quaternion); // ring always faces the camera
    }
  }

  /**
   * Phase G5: Sun in the Moon globe view (child of the globe group, so it exists only there; the pole-mode Sun layer
   * is separate and unchanged). An unlit emissive sphere with an additive glow, depth-tested so the Moon can hide it,
   * on the Sun's real track around the Moon (one synodic month, latitude swing exaggerated). Display size, not to scale.
   */
  _createGlobeSun() {
    const R = GLOBE_SUN_RADIUS;
    this.globeSunBody = new THREE.Mesh(
      new THREE.SphereGeometry(R, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0xfff3c4, toneMapped: false, fog: false, transparent: true, opacity: 1 })
    );
    this.globeSunBody.name = 'globe-sun-body';
    this.globeSunGroup = new THREE.Group();
    this.globeSunGroup.name = 'globe-sun';
    this.globeSunGroup.add(this.globeSunBody);
    this.globeSunGlow = null;
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      const grad = g && g.createRadialGradient ? g.createRadialGradient(64, 64, 0, 64, 64, 64) : null;
      if (grad && grad.addColorStop) {
        grad.addColorStop(0, 'rgba(255, 236, 170, 0.95)');
        grad.addColorStop(0.25, 'rgba(255, 190, 80, 0.45)');
        grad.addColorStop(1, 'rgba(255, 160, 40, 0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 128, 128);
        this.globeSunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
          map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
        }));
        this.globeSunGlow.scale.setScalar(R * 7);
        this.globeSunGroup.add(this.globeSunGlow);
      }
    }
    this.globeSunGroup.position.set(GLOBE_SUN_DISTANCE, 0, 0);

    // Orbit ring: one shared position buffer, two line views (past dim, future bright), depth-tested, plus a marker ring
    const maxSamples = Math.round((SYNODIC_MONTH_DAYS * 24) / GLOBE_PATH_STEP_HOURS) + 2;
    this.globeSunRingAttr = new THREE.BufferAttribute(new Float32Array(maxSamples * 3), 3);
    const amber = new THREE.Color(CONFIG.colors.accentAmber);
    const makeLine = (opacity) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', this.globeSunRingAttr);
      geo.setDrawRange(0, 0);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: amber, transparent: true, opacity, fog: false }));
      line.frustumCulled = false;
      return line;
    };
    this.globeSunRingPast = makeLine(GLOBE_SUN_RING_PAST_OPACITY);
    this.globeSunRingFuture = makeLine(GLOBE_SUN_RING_FUTURE_OPACITY);
    this.globeSunRingPast.name = 'globe-sun-ring-past';
    this.globeSunRingFuture.name = 'globe-sun-ring-future';
    const pts = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0).multiplyScalar(R * GLOBE_SUN_MARKER_RADIUS_FACTOR));
    }
    this.globeSunMarkerRing = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: amber, transparent: true, opacity: 0.9, fog: false })
    );
    this.globeSunMarkerRing.name = 'globe-sun-marker';
    this.globeSunMarker = new THREE.Group();
    this.globeSunMarker.add(this.globeSunMarkerRing);
    this.globeGroup.add(this.globeSunGroup, this.globeSunRingPast, this.globeSunRingFuture, this.globeSunMarker);
  }

  /** Sun body at the exaggerated sub-solar direction; ring rebuilt only when time moves more than about a day from its centre. */
  _updateGlobeSun(ephem) {
    if (!ephem || !this.globeSunGroup) return;
    const p = globeBodyPosition(ephem.subSolarLat, ephem.subSolarLon, GLOBE_SUN_DISTANCE, GLOBE_SUN_LAT_EXAGGERATION);
    this.globeSunGroup.position.set(p.x, p.y, p.z);
    this.globeSunMarker.position.set(p.x, p.y, p.z);
    const tMs = ephem.date.getTime();
    if (!this._globeSunRing || globePathNeedsRebuild(this._globeSunRingCenterMs, tMs)) {
      this._globeSunRing = sunOrbitRingSamples(new Date(tMs));
      this._globeSunRingCenterMs = tMs;
      this._globeSunRingBuilds = (this._globeSunRingBuilds || 0) + 1;
      const arr = this.globeSunRingAttr.array;
      this._globeSunRing.samples.forEach((smp, i) => {
        arr[i * 3] = smp.point.x; arr[i * 3 + 1] = smp.point.y; arr[i * 3 + 2] = smp.point.z;
      });
      this.globeSunRingAttr.needsUpdate = true;
    }
    const n = this._globeSunRing.samples.length;
    const k = pathIndexAt(this._globeSunRing, tMs);
    this.globeSunRingPast.geometry.setDrawRange(0, k + 1);
    this.globeSunRingFuture.geometry.setDrawRange(k, n - k);
  }

  /** Fades the Sun (body, glow, marker) out smoothly when the camera comes close, so the camera never sits inside it. */
  _updateGlobeSunFade() {
    if (!this.globeSunGroup) return;
    const d = this.camera.position.distanceTo(this.globeSunGroup.position);
    const f = globeProximityFade(d, GLOBE_SUN_RADIUS);
    this.globeSunBody.material.opacity = f;
    if (this.globeSunGlow) this.globeSunGlow.material.opacity = f;
    this.globeSunMarkerRing.material.opacity = 0.9 * f;
    this.globeSunGroup.visible = f > 0.001;
    this.globeSunMarker.visible = f > 0.001;
    this.globeSunMarker.quaternion.copy(this.camera.quaternion);
    this._globeSunFade = f;
  }

  /** Shows (lat/lon in degrees) or hides (null) the selection marker on the globe surface. */
  setGlobeSelection(sel) {
    const m = this.globeSelectMarker;
    if (!m) return;
    if (!sel) { m.visible = false; return; }
    const p = latLonToGlobePosition(sel.lat, sel.lon, GLOBE_RADIUS);
    m.position.set(p.x, p.y, p.z);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(p.x, p.y, p.z).normalize());
    m.visible = true;
    this._updateGlobePinScales();
  }

  /** Lat/lon under the pointer on the visible side of the globe sphere, or null (pointer is over empty space). */
  _pickGlobeSurface() {
    if (!this.globeMesh) return null;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hit = this.raycaster.intersectObject(this.globeMesh, false)[0];
    if (!hit) return null;
    const local = this.globeGroup.worldToLocal(hit.point.clone());
    return globePositionToLatLon(local);
  }

  /** Keeps globe pins the same size on screen at any zoom (scale by camera-to-pin distance). */
  _updateGlobePinScales() {
    if (!this.globePinsGroup) return;
    const camPos = this.camera.position;
    for (const g of this.globePinsGroup.children) {
      // Phase G7: pins shrink (clamped) when the camera is close; the hit target keeps a minimum size
      const { scale, hitScale } = globePinScale(camPos.distanceTo(g.position));
      g.scale.setScalar(scale);
      const hit = g.children[3];
      if (hit && hit.userData.isPinHit) hit.scale.setScalar(hitScale);
    }
    const m = this.globeSelectMarker;
    if (m && m.visible) m.scale.setScalar(Math.max(0.0005, camPos.distanceTo(m.position) * GLOBE_PIN_SCREEN_SCALE * 2));
  }

  /** Nearest visible (front-hemisphere) globe pin under the pointer, or null. */
  _pickGlobePin() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const cam = this.camera.position;
    const hits = this.raycaster.intersectObjects(this.globePinHits, false);
    let best = null, bestD = Infinity;
    for (const h of hits) {
      // The pin head must be in line of sight (not behind the sphere); heads standing past the limb still count
      const head = h.object.getWorldPosition(this._tmpV || (this._tmpV = new THREE.Vector3()));
      if (!isGlobeHeadVisible(head, { x: cam.x, y: cam.y, z: cam.z }, GLOBE_RADIUS)) continue;
      // Overlapping hit targets: choose the pin whose head is closest to the pointer ray, not merely the nearest sphere
      const d = this.raycaster.ray.distanceToPoint(head);
      if (d < bestD) { bestD = d; best = h.object.userData.region; }
    }
    return best;
  }

  _updateGlobeCamera(snap = false) {
    this.camera.up.set(GLOBE_CAMERA_UP.x, GLOBE_CAMERA_UP.y, GLOBE_CAMERA_UP.z); // globe is shown upside down
    this.targetCamLook.set(GLOBE_ORBIT_TARGET.x, GLOBE_ORBIT_TARGET.y, GLOBE_ORBIT_TARGET.z); // 70°S point on the axis
    const pos = globeCameraPosition(this.globeOrbit);
    this.targetCamPos.set(pos.x, pos.y, pos.z);
    if (snap) {
      this.camera.position.copy(this.targetCamPos);
      this.currentCamLook.copy(this.targetCamLook);
      this.camera.lookAt(this.currentCamLook);
    }
  }

  /** Globe camera preset: frames the nine polar pins from above the south pole. */
  focusGlobeSouthPole() {
    this.globeOrbit = { ...GLOBE_FOCUS_SOUTH_ORBIT };
    if (this.viewMode === 'globe') this._updateGlobeCamera(false);
  }

  /** Globe camera preset: the initial landing view. */
  resetGlobeView() {
    this.globeOrbit = { ...GLOBE_DEFAULT_ORBIT };
    if (this.viewMode === 'globe') this._updateGlobeCamera(false);
  }

  /** Smooth camera zoom toward a region's pin on the globe (the view then switches to South Pole mode). */
  flyGlobeToRegion(region) {
    this.globeOrbit = globeOrbitForLatLon(region.lat, region.lon, GLOBE_FLY_DISTANCE);
    if (this.viewMode === 'globe') this._updateGlobeCamera(false);
  }

  /**
   * South Pole 3D Terrain Mesh (Round 2 Core Deliverable)
   */
  _createSouthPoleTerrain() {
    this.poleTerrainGroup = new THREE.Group();

    const gridSize = CONFIG.radii.polarMeshGridSize; // ≈1.2 km per cell over the ±polarDomainSpanKm square (see config.js)
    const halfSpanKm = CONFIG.radii.polarDomainSpanKm;
    // Row-flip so the mesh lines up with the pins/graticule (z = -mapY); see orientHeightsForMesh()
    const heights = orientHeightsForMesh(generateDemHeightfield(gridSize, halfSpanKm).heights, gridSize);

    this.terrainTriangleCount = (gridSize - 1) * (gridSize - 1) * 2;

    const widthUnits = halfSpanKm * 2 * this.spatialScale;
    const geometry = new THREE.PlaneGeometry(widthUnits, widthUnits, gridSize - 1, gridSize - 1);
    geometry.rotateX(-Math.PI / 2); // Orient horizontal in X-Z plane

    const posAttr = geometry.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const zElevationKm = heights[i];
      // Vertical height in Three.js
      posAttr.setY(i, zElevationKm * this.verticalScale);
    }
    geometry.computeVertexNormals();

    // Surface picture derived from the terrain itself (slope + elevation albedo), one texture over the
    // whole mesh. It is not imagery and carries no baked shadows (the live Sun does the lighting).
    const texSize = demProvider.isSynthetic ? 512 : 2048;
    const albedo = generateTerrainAlbedo(texSize, halfSpanKm);
    const regolithCanvas = document.createElement('canvas');
    regolithCanvas.width = texSize;
    regolithCanvas.height = texSize;
    regolithCanvas.getContext('2d').putImageData(new ImageData(albedo.rgba, texSize, texSize), 0, 0);
    const regolithTex = new THREE.CanvasTexture(regolithCanvas);
    regolithTex.colorSpace = THREE.SRGBColorSpace;
    regolithTex.wrapS = THREE.ClampToEdgeWrapping;
    regolithTex.wrapT = THREE.ClampToEdgeWrapping;
    regolithTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    const terrainMaterial = new THREE.MeshStandardMaterial({
      map: regolithTex,
      roughness: 0.92,
      metalness: 0.08,
      flatShading: false,
    });

    this.terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
    this.terrainMesh.receiveShadow = true;
    this.poleTerrainGroup.add(this.terrainMesh);

    // South Pole center marker pin / flag
    const poleMarkerGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.0, 8);
    const poleMarkerMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const poleMarker = new THREE.Mesh(poleMarkerGeo, poleMarkerMat);
    poleMarker.position.set(0, 1.0, 0);
    this.poleTerrainGroup.add(poleMarker);

    this.scene.add(this.poleTerrainGroup);
  }

  /**
   * Conforming Lat/Lon Grid lines from -84° to -90° (Round 2)
   */
  _createLatLonGrid() {
    this.latLonGridGroup = new THREE.Group();
    const gridData = generateLatLonGridLines(this.spatialScale, this.verticalScale);

    gridData.forEach((line) => {
      const points = line.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
      const geom = new THREE.BufferGeometry().setFromPoints(points);

      const mat = new THREE.LineBasicMaterial({
        color: line.isMeridian ? 0x06b6d4 : 0x475569,
        transparent: true,
        opacity: line.isMeridian ? 0.35 : 0.50,
        linewidth: 1,
      });

      const lineMesh = new THREE.Line(geom, mat);
      this.latLonGridGroup.add(lineMesh);
    });

    this.poleTerrainGroup.add(this.latLonGridGroup);
  }

  /**
   * Nine Candidate Region Pins from regions.js (Round 2)
   */
  _createRegionPins() {
    this.pinsGroup = new THREE.Group();
    this.pinMeshes = [];

    const pinHeadGeo = new THREE.SphereGeometry(0.5, 16, 16);
    const pinStemGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.8, 8);
    const ringGeo = new THREE.RingGeometry(0.3, 0.7, 24);
    ringGeo.rotateX(-Math.PI / 2);

    this.regions.forEach((reg) => {
      const { x: kmX, y: kmY } = latLonToPolarStereo(reg.lat, reg.lon);
      const elevKm = getElevationAt(reg.lat, reg.lon);

      const x = kmX * this.spatialScale;
      const z = -kmY * this.spatialScale;
      const y = elevKm * this.verticalScale;

      const pinGroup = new THREE.Group();
      pinGroup.position.set(x, y, z);
      pinGroup.name = reg.id;
      pinGroup.userData = { region: reg, elevKm, x, y, z };

      const isSelected = reg.id === this.selectedRegion.id;

      // Pin stem
      const stemMat = new THREE.MeshBasicMaterial({ color: 0x94a3b8 });
      const stem = new THREE.Mesh(pinStemGeo, stemMat);
      stem.position.y = 0.9;
      pinGroup.add(stem);

      // Pin head sphere
      const headMat = new THREE.MeshStandardMaterial({
        color: isSelected ? 0x06b6d4 : 0xf59e0b,
        emissive: isSelected ? 0x0891b2 : 0xb45309,
        emissiveIntensity: isSelected ? 0.8 : 0.4,
        roughness: 0.3,
      });
      const head = new THREE.Mesh(pinHeadGeo, headMat);
      head.position.y = 1.8;
      head.userData = { region: reg, isPinHead: true };
      pinGroup.add(head);

      // Base landing ring
      const ringMat = new THREE.MeshBasicMaterial({
        color: isSelected ? 0x06b6d4 : 0xf59e0b,
        transparent: true,
        opacity: isSelected ? 0.8 : 0.4,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.04;
      pinGroup.add(ring);

      this.pinsGroup.add(pinGroup);
      this.pinMeshes.push(head);
    });

    this.poleTerrainGroup.add(this.pinsGroup);
  }

  /**
   * Round 8: Terrain-Occluded Direct-to-Earth Comms Ray
   * 
   * Line vector starts at the selected region's surface coordinates and points toward Earth.
   * Color interpolated dynamically:
   *   - f_earth >= 0.95 -> Cyan #06B6D4 (Clear direct line of sight)
   *   - f_earth <= 0.00 -> Coral #F43F5E (Terrain occluded)
   *   - 0.0 < f_earth < 0.95 -> Smooth linear color blend (limb grazing)
   */
  _createCommsRay() {
    this.commsRayGroup = new THREE.Group();
    this.commsRayGroup.name = 'comms-ray-group';

    // 1. Dynamic Comms Ray Line Geometry (2 vertices: origin and target in space)
    const rayPoints = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 10, 0)];
    this.commsRayGeometry = new THREE.BufferGeometry().setFromPoints(rayPoints);

    // Three.js LineDashedMaterial: solid when CLEAR (f⊕ >= 0.95), dashed when PARTIAL or BLOCKED
    this.commsRayMaterial = new THREE.LineDashedMaterial({
      color: 0x06b6d4,
      linewidth: 2,
      transparent: true,
      opacity: 0.95,
      dashSize: 10000,
      gapSize: 0,
      scale: 1,
    });

    this.commsRayLine = new THREE.Line(this.commsRayGeometry, this.commsRayMaterial);
    this.commsRayLine.frustumCulled = false; // geometry is rewritten every update
    this.commsRayGroup.add(this.commsRayLine);

    // 2. Earth globe at the end of the ray (positioned every update). Not to scale.
    this.commsEarthRadius = EARTH_GLOBE_RADIUS;
    const R = this.commsEarthRadius;

    // Procedural fallback until the NASA-derived maps finish loading (see _loadOrreryTextures)
    const fallbackTex = createProceduralEarthTexture();
    this.commsEarthMat = new THREE.MeshPhongMaterial({
      map: fallbackTex,
      specular: new THREE.Color(0x333333),
      shininess: 14,
      // Low emissive pass keeps the night side readable (the pole Sun is a grazing, fixed-direction light)
      emissive: new THREE.Color(0xffffff),
      emissiveMap: fallbackTex,
      emissiveIntensity: 0.28,
    });
    this.commsEarthMesh = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 64), this.commsEarthMat);
    this.commsCloudMesh = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.008, 64, 64),
      new THREE.MeshPhongMaterial({ transparent: true, opacity: 0.0, depthWrite: false })
    );

    // Rim glow: soft blue halo + crisp bright front rim, both always on (in every state the edge stays clear;
    // when the Earth is below the horizon / blocked the globe body is hidden and only this edge is shown)
    this.commsHaloMesh = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.12, 48, 48),
      createAtmosphereMaterial({ strength: 0.55 })
    );
    this.commsRimMesh = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.012, 48, 48),
      createAtmosphereMaterial({ color: 0xbfe6ff, strength: 2.4, power: 3.0, side: THREE.FrontSide, depthTest: false })
    );
    this.commsRimMesh.renderOrder = 21;
    this.commsRimMesh.visible = true;
    this._earthGlobeMode = 'visible';

    // Apply Earth axial tilt (23.44°)
    this.commsEarthTiltGroup = new THREE.Group();
    this.commsEarthTiltGroup.rotation.z = (EARTH_OBLIQUITY_DEG * Math.PI) / 180.0;
    this.commsEarthTiltGroup.add(this.commsEarthMesh);
    this.commsEarthTiltGroup.add(this.commsCloudMesh);
    this.commsEarthTiltGroup.add(this.commsRimMesh);

    this.commsEarthGroup = new THREE.Group();
    this.commsEarthGroup.add(this.commsEarthTiltGroup);
    this.commsEarthGroup.add(this.commsHaloMesh);

    this.commsRayGroup.add(this.commsEarthGroup);
    this.poleTerrainGroup.add(this.commsRayGroup);
  }

  /** Swaps the globe between the textured look and the rim-only look (body hidden, bright edge always on). */
  _setEarthGlobeMode(mode) {
    if (!this.commsEarthMesh || mode === this._earthGlobeMode) return;
    this._earthGlobeMode = mode;
    const ghost = mode === 'ghost';
    this.commsEarthMesh.visible = !ghost;
    this.commsCloudMesh.visible = !ghost;
    this.commsRimMesh.visible = true;
    this.commsHaloMesh.material.uniforms.strength.value = ghost ? 1.1 : 0.55;
    this.commsHaloMesh.material.depthTest = !ghost;
    this.commsHaloMesh.renderOrder = ghost ? 19 : 0;
  }

  setCommsRayVisible(visible) {
    this.isCommsRayVisible = Boolean(visible);
    this._syncCommsVisibility();
  }

  setEarthGlobeVisible(visible) {
    this.isEarthGlobeVisible = Boolean(visible);
    this._syncCommsVisibility();
  }

  setSunVisible(visible) {
    this.isSunVisible = Boolean(visible);
    this._syncSunVisibility();
  }

  /**
   * The ray line and the Earth globe share one parent group but are toggled independently:
   * the group shows if either is on, in South Pole mode only.
   */
  _syncCommsVisibility() {
    if (!this.commsRayGroup) return;
    this.commsRayGroup.visible = this.viewMode === 'south_pole' && (this.isCommsRayVisible || this.isEarthGlobeVisible);
    if (this.commsRayLine) this.commsRayLine.visible = this.isCommsRayVisible;
    if (this.commsEarthGroup) this.commsEarthGroup.visible = this.isEarthGlobeVisible;
  }

  _syncSunVisibility() {
    if (this.sunLayerGroup) this.sunLayerGroup.visible = this.viewMode === 'south_pole' && this.isSunVisible;
    if (this.solarPanelGroup) this.solarPanelGroup.visible = this.viewMode === 'south_pole' && this.isSolarPanelVisible !== false && this.solarPanelReady === true;
  }

  // -------------------------------------------------------------------------------------------
  // Phase 8: mast + solar panel at the selected site (Pole mode only; display exaggerated, see solarPanel3d.js)
  // -------------------------------------------------------------------------------------------
  _createSolarPanel() {
    this.solarPanelGroup = new THREE.Group();
    this.solarPanelGroup.name = 'solar-panel-3d';
    this.solarPanelGroup.visible = false;
    this.solarPanelReady = false;
    this.isSolarPanelVisible = true;
    this.solarMastMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(MAST_DISPLAY_RADIUS, MAST_DISPLAY_RADIUS, 1, 8),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.6, metalness: 0.4 })
    );
    this.solarPanelMaterial = new THREE.MeshStandardMaterial({ color: 0x334155, emissive: 0x000000, roughness: 0.5, metalness: 0.2 });
    const cellMap = createSolarCellTexture(false);
    if (cellMap) {
      this.solarPanelMaterial.map = cellMap;
      this.solarPanelMaterial.emissiveMap = cellMap; // self-lit: the cell pattern stays visible even in shadow
      this.solarPanelMaterial.needsUpdate = true;
    }
    // Box face order: +x, -x, +y (cell face), -y, +z, -z. Only the +y face carries the cells; the rest is a plain frame.
    const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.5, metalness: 0.6 });
    const faces = [frameMaterial, frameMaterial, this.solarPanelMaterial, frameMaterial, frameMaterial, frameMaterial];
    this.solarPanelMesh = new THREE.Mesh(new THREE.BoxGeometry(PANEL_DISPLAY_WIDTH, 0.12, PANEL_DISPLAY_HEIGHT), faces);
    this.solarPanelGroup.add(this.solarMastMesh, this.solarPanelMesh);
    this.poleTerrainGroup.add(this.solarPanelGroup);
  }

  setSolarPanelVisible(visible) {
    this.isSolarPanelVisible = Boolean(visible);
    this._syncSunVisibility();
  }

  /**
   * Places the mast at `region` and orients the panel. `panel` = { tiltDeg, azimuthDeg } (best fixed, or the user's
   * Manual values); `illuminated` = I(t); `cosInc` = cos(theta_inc). Returns the shading so callers/tests can inspect it.
   */
  updateSolarPanel(region, panel, illuminated, cosInc, mastHeightM) {
    if (!this.solarPanelGroup || !region || !panel) return null;
    const { x: kmX, y: kmY } = latLonToPolarStereo(region.lat, region.lon);
    const base = new THREE.Vector3(kmX * this.spatialScale, getElevationAt(region.lat, region.lon) * this.verticalScale, -kmY * this.spatialScale);
    const h = mastDisplayHeight(mastHeightM);
    this.solarMastMesh.scale.set(1, h, 1);
    this.solarMastMesh.position.set(base.x, base.y + h / 2, base.z);

    const n = panelNormalScene(panel.tiltDeg, panel.azimuthDeg, region.lon);
    const normal = new THREE.Vector3(n.x, n.y, n.z).normalize();
    this.solarPanelMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    this.solarPanelMesh.position.set(base.x, base.y + h, base.z).addScaledVector(normal, 0.1);

    const shade = panelShading(illuminated, cosInc);
    // Always visible: the panel is self-lit so its cell pattern is readable in shadow too. Lit = brighter (∝ cosθ),
    // shadowed / facing away = dimmer but never dark.
    const textured = Boolean(this.solarPanelMaterial.map);
    if (shade.lit) {
      this.solarPanelMaterial.color.setHex(textured ? 0xffffff : 0x1e3a5f);
      this.solarPanelMaterial.emissive.setHex(textured ? 0xffffff : 0x7dd3fc);
      this.solarPanelMaterial.emissiveIntensity = SOLAR_PANEL_LIT_BASE + SOLAR_PANEL_LIT_GAIN * shade.intensity;
    } else {
      this.solarPanelMaterial.color.setHex(textured ? 0xffffff : 0x475569);
      this.solarPanelMaterial.emissive.setHex(textured ? 0xb4c3e0 : 0x64748b);
      this.solarPanelMaterial.emissiveIntensity = SOLAR_PANEL_DIM_INTENSITY;
    }
    this.solarPanelReady = true;
    this._syncSunVisibility();
    return shade;
  }

  // -------------------------------------------------------------------------------------------
  // Phase 5: Sun marker + Sun path ring (Pole mode only)
  // -------------------------------------------------------------------------------------------
  _createSunLayer() {
    this.sunLayerGroup = new THREE.Group();
    this.sunLayerGroup.name = 'sun-layer';

    // Emissive Sun sphere (display size, not to scale) + additive glow sprite
    this.sunMarkerGroup = new THREE.Group();
    this.sunMarkerGroup.add(new THREE.Mesh(
      new THREE.SphereGeometry(SUN_MARKER_RADIUS, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0xfff3c4, toneMapped: false, fog: false })
    ));
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, 'rgba(255, 236, 170, 0.95)');
      grad.addColorStop(0.25, 'rgba(255, 190, 80, 0.45)');
      grad.addColorStop(1, 'rgba(255, 160, 40, 0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      }));
      glow.scale.setScalar(SUN_MARKER_RADIUS * 7);
      this.sunMarkerGroup.add(glow);
    }
    this.sunLayerGroup.add(this.sunMarkerGroup);

    // Sun path ring: one shared position buffer, two line views (past dim, future bright)
    const maxSamples = Math.round((SYNODIC_MONTH_DAYS * 24) / SUN_PATH_STEP_HOURS) + 1;
    this.sunPathAttr = new THREE.BufferAttribute(new Float32Array(maxSamples * 3), 3);
    const amber = new THREE.Color(CONFIG.colors.accentAmber);
    const makeLine = (opacity) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', this.sunPathAttr);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: amber, transparent: true, opacity, fog: false }));
      line.frustumCulled = false;
      return line;
    };
    this.sunPathPast = makeLine(0.3);
    this.sunPathFuture = makeLine(0.95);
    // One Sun ball only: the marker itself rides on the ring at the current time (no second marker sphere).
    this.sunLayerGroup.add(this.sunPathPast, this.sunPathFuture);
    this.poleTerrainGroup.add(this.sunLayerGroup);
  }

  /** Per-tick update: Sun ball on the ring at the true bearing, ring cached per quarter-synodic-month bucket. */
  _updateSunLayer(ephem, sunVec) {
    if (!this.sunLayerGroup) return;
    const tMs = ephem.date.getTime();
    const bucketMs = (SYNODIC_MONTH_DAYS * 86400 * 1000) / 4;
    const centerMs = Math.round(tMs / bucketMs) * bucketMs;
    if (!this._sunPath || centerMs !== this._sunPathCenterMs) {
      this._sunPath = computeSunPathSamples(new Date(centerMs));
      this._sunPathCenterMs = centerMs;
      const arr = this.sunPathAttr.array;
      this._sunPath.samples.forEach((smp, i) => {
        arr[i * 3] = smp.point.x; arr[i * 3 + 1] = smp.point.y; arr[i * 3 + 2] = smp.point.z;
      });
      this.sunPathAttr.needsUpdate = true;
    }
    const n = this._sunPath.samples.length;
    const k = sunPathIndexAt(this._sunPath, tMs);
    this.sunPathPast.geometry.setDrawRange(0, k + 1);
    this.sunPathFuture.geometry.setDrawRange(k, n - k);

    // Same bearing as the scene light; elevation exaggerated exactly like the ring so the ball sits ON it.
    const m = polarSkyPoint(sunVec, SUN_DISPLAY_RADIUS, SUN_PATH_ELEVATION_EXAGGERATION);
    this.sunMarkerPos.set(m.x, m.y, m.z);
    this.sunMarkerGroup.position.copy(this.sunMarkerPos);
  }

  /** Selected-region Sun readout for the Sun label (elevation, azimuth, lit state). */
  updateSunReadout(sunTopo, fSun) {
    if (!sunTopo) return;
    const st = formatSunLabel(sunTopo, fSun);
    this._setLabel(this.sunLabel, st.text, st.tone);
  }

  // -------------------------------------------------------------------------------------------
  // Phase 4: HTML overlay labels (fixed font size, anchored to the 3D object, clamped in view)
  // -------------------------------------------------------------------------------------------
  _createOverlays() {
    if (typeof document === 'undefined') return;
    if (getComputedStyle(this.container).position === 'static') this.container.style.position = 'relative';
    this.overlayRoot = document.createElement('div');
    this.overlayRoot.className = 'absolute inset-0 overflow-hidden pointer-events-none z-10';
    const make = (id, withArrow = false) => {
      const el = document.createElement('div');
      el.id = id;
      el.className = `${LABEL_BASE} hidden`;
      let arrowEl = null;
      if (withArrow) {
        // Small triangle pointing toward the object; only shown while the object is off-screen
        arrowEl = document.createElement('span');
        arrowEl.className = 'hidden';
        arrowEl.setAttribute('aria-hidden', 'true');
        arrowEl.style.cssText = 'display:inline-block;width:0;height:0;margin-right:6px;vertical-align:middle;border-top:5px solid transparent;border-bottom:5px solid transparent;border-left:9px solid #67e8f9;';
        el.appendChild(arrowEl);
      }
      const textEl = document.createElement('span');
      el.appendChild(textEl);
      this.overlayRoot.appendChild(el);
      return { el, textEl, arrowEl, arrowOn: false, text: '', tone: '', w: 0, h: 0, shown: false, lastX: NaN, lastY: NaN, lastAng: NaN };
    };
    this.earthLabel = make('earth-overlay-label', true);
    this.sunLabel = make('sun-overlay-label');
    this.container.appendChild(this.overlayRoot);
    this._tmpV = new THREE.Vector3();
    this._tmpP = new THREE.Vector3();
  }

  _setLabel(label, text, tone) {
    if (!label) return;
    if (label.text !== text) {
      label.textEl.textContent = text;
      label.text = text;
      label.w = 0; // re-measure on next placement
    }
    if (label.tone !== tone) {
      if (label.tone) label.el.classList.remove(LABEL_TONE[label.tone]);
      label.el.classList.add(LABEL_TONE[tone]);
      label.tone = tone;
    }
  }

  /** Reserve the part of the canvas covered by the right-hand panel so labels are never hidden behind it. */
  _refreshOverlayInsets() {
    if (typeof document === 'undefined') return;
    const panel = document.getElementById('pole-region-panel');
    if (panel && !panel.classList.contains('hidden')) {
      const pr = panel.getBoundingClientRect();
      const cr = this.container.getBoundingClientRect();
      this._overlayRightInset = Math.max(0, cr.right - pr.left);
    } else {
      this._overlayRightInset = 0;
    }
  }

  _placeLabel(label, world, worldRadius, active, viewW, viewH, edgeArrow = false) {
    if (!label) return;
    const hide = () => {
      if (label.shown) { label.el.classList.add('hidden'); label.shown = false; label.lastX = NaN; }
    };
    if (!active || !label.text) { hide(); return; }
    const view = this._tmpV.copy(world).applyMatrix4(this.camera.matrixWorldInverse);
    const behind = view.z >= -this.camera.near;
    if (behind && !edgeArrow) { hide(); return; } // behind the camera
    const ndc = this._tmpP.copy(world).project(this.camera);
    const cx = (ndc.x * 0.5 + 0.5) * viewW;
    const cy = (-ndc.y * 0.5 + 0.5) * viewH;
    const rPx = behind ? 0 : (worldRadius / -view.z) * (viewH * 0.5) / Math.tan((this.camera.fov * Math.PI) / 360);
    if (!label.shown) {
      label.el.classList.remove('hidden');
      label.shown = true;
      label.w = 0;
    }
    const inset = this._overlayRightInset || 0;
    const margin = 8;
    // Off-screen = the whole globe lies outside the usable area (canvas minus the right panel), or behind the camera
    const offScreen = edgeArrow && (behind
      || cx + rPx < margin || cx - rPx > viewW - inset - margin
      || cy + rPx < margin || cy - rPx > viewH - margin);
    if (label.arrowEl && offScreen !== label.arrowOn) {
      label.arrowEl.classList.toggle('hidden', !offScreen);
      label.arrowOn = offScreen;
      label.w = 0; // the arrow changes the label width: re-measure
    }
    if (!label.w) {
      label.w = label.el.offsetWidth;
      label.h = label.el.offsetHeight;
    }
    let tx; let ty;
    if (offScreen) {
      // Direction from the usable-area centre toward the globe. Behind the camera the projection is mirrored,
      // so use the view-space x/y instead (the way the user has to turn).
      const ucx = (viewW - inset) / 2;
      const ucy = viewH / 2;
      const dirX = behind ? view.x : cx - ucx;
      const dirY = behind ? -view.y : cy - ucy;
      const pin = pinLabelToEdge({ dirX, dirY, labelW: label.w, labelH: label.h, viewW, viewH, margin, rightInset: inset });
      tx = Math.round(pin.x - label.w / 2);
      ty = Math.round(pin.y - label.h / 2);
      const ang = Math.round((pin.angleRad * 180) / Math.PI);
      if (label.arrowEl && ang !== label.lastAng) {
        label.arrowEl.style.transform = `rotate(${ang}deg)`;
        label.lastAng = ang;
      }
    } else {
      const pos = clampLabelToViewport({
        anchorX: cx, anchorY: cy - rPx - 8, labelW: label.w, labelH: label.h,
        viewW, viewH, margin, rightInset: inset,
      });
      tx = Math.round(pos.x - label.w / 2);
      ty = Math.round(pos.y - label.h);
    }
    if (tx !== label.lastX || ty !== label.lastY) {
      label.el.style.transform = `translate(${tx}px, ${ty}px)`;
      label.lastX = tx;
      label.lastY = ty;
    }
  }

  _updateOverlayPositions() {
    if (!this.overlayRoot) return;
    const W = this.container.clientWidth;
    const H = this.container.clientHeight;
    const pole = this.viewMode === 'south_pole';
    this.camera.updateMatrixWorld();
    this._placeLabel(this.earthLabel, this.commsEarthGroup.position, EARTH_GLOBE_RADIUS, pole && this.isEarthGlobeVisible, W, H, true);
    this._placeLabel(this.sunLabel, this.sunMarkerPos, SUN_MARKER_RADIUS, pole && this.isSunVisible, W, H);
  }

  /**
   * Updates Comms Ray geometry and color from topocentric Earth coordinates and occlusion fraction
   * @param {Object} region - Active candidate region
   * @param {Object} earthTopo - Topocentric azimuth and elevation in degrees
   * @param {number} fEarth - Unblocked Earth disc fraction in [0.0, 1.0]
   */
  updateCommsRay(region, earthTopo, fEarth = 1.0) {
    if (!this.commsRayGroup || !region || !earthTopo) return;

    // Globe look + label text first, so they stay current even while the group is hidden
    const state = formatEarthLabel(earthTopo.elevationDeg, fEarth);
    this._setEarthGlobeMode(state.mode);
    this._setLabel(this.earthLabel, state.text, state.tone);

    // Visibility sync
    this._syncCommsVisibility();
    if (!this.commsRayGroup.visible) return;

    // 1. Ray Origin on Lunar South Pole terrain surface
    const { x: kmX, y: kmY } = latLonToPolarStereo(region.lat, region.lon);
    const elevKm = getElevationAt(region.lat, region.lon);

    const originX = kmX * this.spatialScale;
    const originZ = -kmY * this.spatialScale;
    const originY = (elevKm * this.verticalScale) + 0.5; // Elevate slightly above pin base
    const origin = new THREE.Vector3(originX, originY, originZ);

    // 2. Vector Direction toward Earth (true direction from the selected region)
    const rayVec = computeCommsRayVector(region, earthTopo);
    const dir = new THREE.Vector3(rayVec.dirX, rayVec.dirY, rayVec.dirZ);
    const targetPos = origin.clone().addScaledVector(dir, COMMS_RAY_LENGTH);

    // 3. Update Line Geometry Points & Dashing
    this.commsRayGeometry.setFromPoints([origin, targetPos]);

    const isClear = fEarth >= 0.95;
    if (isClear) {
      this.commsRayMaterial.dashSize = 10000;
      this.commsRayMaterial.gapSize = 0;
    } else {
      this.commsRayMaterial.dashSize = 1.6;
      this.commsRayMaterial.gapSize = 0.9;
    }
    this.commsRayLine.computeLineDistances();

    // Globe rides on the ray tip (true Earth direction from the selected site)
    this.commsEarthGroup.position.copy(targetPos);

    // 4. Globe diurnal rotation
    if (this.commsEarthMesh && this.currentEphem) {
      this.commsEarthMesh.rotation.y = (this.currentEphem.earthRotationDeg * Math.PI) / 180.0;
    }

    // 5. Color Interpolation based on fEarth (Rule 6 tokens: Cyan #06B6D4, Coral #F43F5E)
    // Cyan: [0.024, 0.714, 0.831], Coral: [0.957, 0.247, 0.369]
    const clampedF = Math.max(0.0, Math.min(1.0, fEarth));
    const t = Math.min(1.0, clampedF / 0.95); // >= 0.95 is fully clear cyan

    const r = 0.957 * (1.0 - t) + 0.024 * t;
    const g = 0.247 * (1.0 - t) + 0.714 * t;
    const b = 0.369 * (1.0 - t) + 0.831 * t;

    this.commsRayMaterial.color.setRGB(r, g, b);
  }

  _setupEventListeners() {
    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      this.isDragging = true;
      this.prevMousePos = { x: e.clientX, y: e.clientY };
      this._downPos = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e) => {
      // 1. Update normalized mouse coordinates for raycasting
      const rect = this.container.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      // 2. Perform hover raycasting in globe and south_pole modes
      if (this.viewMode === 'south_pole' || this.viewMode === 'globe') {
        this._checkPinHover(e.clientX, e.clientY);
      }

      // 3. Orbit camera rotation if dragging
      if (this.isDragging) {
        const deltaX = e.clientX - this.prevMousePos.x;
        const deltaY = e.clientY - this.prevMousePos.y;
        this.prevMousePos = { x: e.clientX, y: e.clientY };

        if (this.viewMode === 'globe') {
          // Grab-and-rotate: slower when close to the surface; phi spans the whole sphere so the poles are reachable
          const k = 0.005 * Math.min(1, this.globeOrbit.distance / GLOBE_DEFAULT_ORBIT.distance);
          this.globeOrbit = clampGlobeOrbit({
            theta: this.globeOrbit.theta - GLOBE_DRAG_SIGN * deltaX * k,
            phi: this.globeOrbit.phi - GLOBE_DRAG_SIGN * deltaY * k,
            distance: this.globeOrbit.distance,
          });
          this._updateGlobeCamera();
          return;
        }
        this.orbitAngle.theta -= deltaX * 0.005;
        this.orbitAngle.phi = Math.max(0.12, Math.min(Math.PI / 2 - 0.05, this.orbitAngle.phi + deltaY * 0.005));
        this._updateCameraFromOrbit();
      }
    };

    const onMouseUp = () => {
      this.isDragging = false;
    };

    const onWheel = (e) => {
      e.preventDefault();
      if (this.viewMode === 'globe') {
        this.globeOrbit = clampGlobeOrbit({ ...this.globeOrbit, distance: this.globeOrbit.distance * Math.exp(e.deltaY * 0.001) });
        this._updateGlobeCamera();
        return;
      }
      const minD = this.viewMode === 'south_pole' ? 8 : 12;
      const maxD = this.viewMode === 'south_pole' ? 85 * this.domainScale : 520;
      this.orbitAngle.distance = Math.max(minD, Math.min(maxD, this.orbitAngle.distance + e.deltaY * 0.06));
      this._updateCameraFromOrbit();
    };

    const onClick = (e) => {
      if (this.viewMode === 'globe') {
        // Ignore the click that ends an orbit drag. A click only SELECTS (pin -> its region, sphere -> a lat/lon,
        // empty space -> clears); the app shows the "View in South Pole 3D" button for the selection.
        const down = this._downPos;
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) >= 4) return;
        const rect = this.container.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        if (!this.callbacks.onGlobeSelect) return;
        const reg = this._pickGlobePin();
        if (reg) { this.callbacks.onGlobeSelect({ region: reg, lat: reg.lat, lon: reg.lon }); return; }
        const pt = this._pickGlobeSurface();
        this.callbacks.onGlobeSelect(pt ? { region: null, lat: pt.lat, lon: pt.lon } : null);
        return;
      }
      if (this.viewMode !== 'south_pole') return;

      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObjects(this.pinMeshes, false);

      if (intersects.length > 0) {
        const hit = intersects[0];
        const reg = hit.object.userData.region;
        if (reg) {
          this.selectRegion(reg);
          if (this.callbacks.onSelectRegion) {
            this.callbacks.onSelectRegion(reg);
          }
        }
        return;
      }

      // No pin hit: pick a point on the terrain, but never after an orbit drag (< 4 px movement only)
      const down = this._downPos;
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) >= 4) return;
      if (!this.terrainMesh || !this.callbacks.onPickPoint) return;

      const rect = this.container.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const terrainHits = this.raycaster.intersectObject(this.terrainMesh, false);
      if (terrainHits.length === 0) return;

      const local = this.poleTerrainGroup.worldToLocal(terrainHits[0].point.clone());
      this.callbacks.onPickPoint(sceneXZToPickedPoint(local.x, local.z, this.spatialScale));
    };

    this.container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    this.container.addEventListener('wheel', onWheel, { passive: false });
    this.container.addEventListener('click', onClick);

    this.onResize = () => {
      if (!this.container || !this.camera || !this.renderer) return;
      this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
      this._refreshOverlayInsets();
    };
    window.addEventListener('resize', this.onResize);
  }

  _checkPinHover(clientX, clientY) {
    if (this.viewMode === 'globe') {
      const reg = this._pickGlobePin();
      this.container.style.cursor = reg ? 'pointer' : 'grab';
      if (reg) {
        this.hoveredPin = reg;
        if (this.callbacks.onPinHover) this.callbacks.onPinHover({ region: reg, screenX: clientX, screenY: clientY, visible: true, globe: true });
      } else if (this.hoveredPin) {
        this.hoveredPin = null;
        if (this.callbacks.onPinHover) this.callbacks.onPinHover({ visible: false });
      }
      return;
    }
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.pinMeshes, false);

    if (intersects.length > 0) {
      const hit = intersects[0];
      const reg = hit.object.userData.region;

      this.container.style.cursor = 'pointer';

      if (this.callbacks.onPinHover) {
        this.callbacks.onPinHover({
          region: reg,
          screenX: clientX,
          screenY: clientY,
          visible: true,
        });
      }
      this.hoveredPin = hit.object;
    } else {
      this.container.style.cursor = 'default';
      if (this.hoveredPin) {
        this.hoveredPin = null;
        if (this.callbacks.onPinHover) {
          this.callbacks.onPinHover({ visible: false });
        }
      }
    }
  }

  _updateCameraFromOrbit() {
    const dist = this.orbitAngle.distance;
    const th = this.orbitAngle.theta;
    const ph = this.orbitAngle.phi;

    this.targetCamPos.set(
      this.targetCamLook.x + dist * Math.sin(ph) * Math.sin(th),
      this.targetCamLook.y + dist * Math.cos(ph),
      this.targetCamLook.z + dist * Math.sin(ph) * Math.cos(th)
    );
  }

  /**
   * Switches view between 'orrery' and 'south_pole' with smooth exponential damping
   */
  setViewMode(mode, smoothTransition = true) {
    const prev = this.viewMode;
    this.viewMode = mode;

    const isOrrery = mode === 'orrery';
    const isGlobe = mode === 'globe';
    const isPole = mode === 'south_pole';
    this.orreryGroup.visible = isOrrery;
    this.poleTerrainGroup.visible = isPole;
    if (this.globeGroup) this.globeGroup.visible = isGlobe;
    this.sunLight.visible = isOrrery;
    this.polarSunLight.visible = isPole;
    this.polarFillLight.visible = isPole;
    if (this.globeLight) this.globeLight.visible = isGlobe;
    if (this.globeAmbientLight) this.globeAmbientLight.visible = isGlobe;
    if (this.globeEarthshineLight) this.globeEarthshineLight.visible = isGlobe;
    if (this.ambientLight) this.ambientLight.visible = !isGlobe; // the globe has its own ambient; nothing leaks between views
    if (isGlobe && this.currentEphem) this._updateGlobeLighting(this.currentEphem);
    this._syncCommsVisibility();
    this._syncSunVisibility();
    this._refreshOverlayInsets();
    if (!isGlobe && this.hoveredPin) this.hoveredPin = null;
    if (this.container) this.container.style.cursor = isGlobe ? 'grab' : 'default';
    // Only the globe view is upside down; every other view uses the normal +y up vector
    if (isGlobe) this.camera.up.set(GLOBE_CAMERA_UP.x, GLOBE_CAMERA_UP.y, GLOBE_CAMERA_UP.z);
    else this.camera.up.set(0, 1, 0);

    // Views that change scene/units cut instantly (the UI fades in from black); Orrery <-> Pole keeps its glide
    const snap = !smoothTransition || prev === 'globe' || isGlobe;
    if (isGlobe) {
      // Coming back from another view: face the selected region; the very first call keeps the landing view
      if (prev !== 'globe' && this.selectedRegion && this.selectedRegion.kind !== 'user_point') {
        const o = globeOrbitForLatLon(this.selectedRegion.lat, this.selectedRegion.lon, GLOBE_DEFAULT_ORBIT.distance);
        // Same side-on view as the landing view, turned to the selected region's longitude
        this.globeOrbit = { theta: o.theta, phi: GLOBE_DEFAULT_ORBIT.phi, distance: GLOBE_DEFAULT_ORBIT.distance };
      }
      this._updateGlobeCamera(snap);
    } else if (isOrrery) {
      this.setCameraPreset(this.cameraPreset);
      if (snap) {
        this.camera.position.copy(this.targetCamPos);
        this.currentCamLook.copy(this.targetCamLook);
        this.camera.lookAt(this.currentCamLook);
      }
    } else {
      // Dock camera to currently selected region
      this.dockToRegion(this.selectedRegion, !snap);
    }
  }

  /**
   * Docks camera to a candidate region in South Pole 3D view
   */
  dockToRegion(region, smooth = true) {
    this.selectedRegion = region;
    this._highlightSelectedPin();

    const { x: kmX, y: kmY } = latLonToPolarStereo(region.lat, region.lon);
    const elevKm = getElevationAt(region.lat, region.lon);

    const targetX = kmX * this.spatialScale;
    const targetZ = -kmY * this.spatialScale;
    const targetY = elevKm * this.verticalScale;

    // Camera docks at a close vantage looking down at the region
    // Look slightly ahead of the site (toward the Earth bearing) so the globe at the ray end stays in frame
    this.targetCamLook.set(targetX, targetY, targetZ + DOCK_LOOK_FORWARD);

    this.orbitAngle.distance = DOCK_DISTANCE;
    this.orbitAngle.theta = DOCK_THETA;
    this.orbitAngle.phi = DOCK_PHI;

    this._updateCameraFromOrbit();

    if (!smooth) {
      this.camera.position.copy(this.targetCamPos);
      this.currentCamLook.copy(this.targetCamLook);
      this.camera.lookAt(this.currentCamLook);
    }
  }

  /**
   * Docks camera to high polar overview showing all regions
   */
  dockToPolarOverview(smooth = true) {
    this.targetCamLook.set(OVERVIEW_LOOK.x, OVERVIEW_LOOK.y, OVERVIEW_LOOK.z);
    this.orbitAngle.distance = OVERVIEW_DISTANCE;
    this.orbitAngle.theta = OVERVIEW_THETA;
    this.orbitAngle.phi = OVERVIEW_PHI;
    this._updateCameraFromOrbit();

    if (!smooth) {
      this.camera.position.copy(this.targetCamPos);
      this.currentCamLook.copy(this.targetCamLook);
      this.camera.lookAt(this.currentCamLook);
    }
  }

  selectRegion(region) {
    this.selectedRegion = region;
    this._highlightSelectedPin();
    if (this.viewMode === 'south_pole') {
      this.dockToRegion(region, true);
    }
  }

  /**
   * Shows the single temporary user pin (violet head, white ring); replaces any previous one.
   * It is not part of pinMeshes, so it never appears in hover tooltips or the 9-region pins.
   */
  setUserPin(region) {
    this.clearUserPin();
    const { x: kmX, y: kmY } = latLonToPolarStereo(region.lat, region.lon);
    const elevKm = getElevationAt(region.lat, region.lon);

    const group = new THREE.Group();
    group.name = 'user-picked-pin';
    group.position.set(kmX * this.spatialScale, elevKm * this.verticalScale, -kmY * this.spatialScale);

    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 1.8, 8),
      new THREE.MeshBasicMaterial({ color: 0xe2e8f0 })
    );
    stem.position.y = 0.9;
    group.add(stem);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xa78bfa, emissive: 0x7c3aed, emissiveIntensity: 0.8, roughness: 0.3 })
    );
    head.position.y = 1.8;
    head.scale.setScalar(1.35);
    group.add(head);

    const ringGeo = new THREE.RingGeometry(0.3, 0.7, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );
    ring.position.y = 0.04;
    group.add(ring);

    this.userPinGroup = group;
    this.poleTerrainGroup.add(group);
  }

  /** Removes the user pin (if any) and frees its GPU resources */
  clearUserPin() {
    if (!this.userPinGroup) return;
    this.poleTerrainGroup.remove(this.userPinGroup);
    this.userPinGroup.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
    this.userPinGroup = null;
  }

  _highlightSelectedPin() {
    for (const pins of [this.pinsGroup, this.globePinsGroup]) {
      if (!pins) continue;
      pins.children.forEach((group) => {
        const isSelected = group.name === this.selectedRegion.id;
        const head = group.children[1];
        const ring = group.children[2];

        if (head && head.material) {
          head.material.color.setHex(isSelected ? 0x06b6d4 : 0xf59e0b);
          head.material.emissive.setHex(isSelected ? 0x0891b2 : 0xb45309);
          head.material.emissiveIntensity = isSelected ? 0.85 : 0.4;
          head.scale.setScalar(isSelected ? 1.35 : 1.0);
        }
        if (ring && ring.material) {
          ring.material.color.setHex(isSelected ? 0x06b6d4 : 0xf59e0b);
          ring.material.opacity = isSelected ? 0.9 : 0.4;
        }
      });
    }
  }

  setCameraPreset(preset) {
    this.cameraPreset = preset;
    this._moonFollowPrev = null; // only the 'moon' preset follows
    if (preset === 'overview') {
      this.targetCamLook.set(0, 0, 0);
      this.orbitAngle.distance = 95;
      this.orbitAngle.theta = 0.5;
      this.orbitAngle.phi = 0.85;
      this._updateCameraFromOrbit();
    } else if (preset === 'system') {
      // Whole Earth orbit around the Sun (ring diameter ≈ 2 × ORRERY_SUN_DIST)
      this.targetCamLook.copy(this.sunPos).multiplyScalar(0.5);
      this.orbitAngle.distance = 470;
      this.orbitAngle.theta = 0.5;
      this.orbitAngle.phi = 0.55;
      this._updateCameraFromOrbit();
    } else if (preset === 'earth') {
      this.targetCamLook.copy(this.earthPos);
      this.targetCamPos.set(0, 8, 20);
    } else if (preset === 'moon') {
      // Follow mode: updateSimulation() carries look-at target and camera with the Moon every tick.
      // Orbit angles match the offset below, so drag/zoom keep working around the Moon.
      this.targetCamLook.copy(this.moonPos);
      this.targetCamPos.set(this.moonPos.x + 6, this.moonPos.y + 3, this.moonPos.z + 9);
      this.orbitAngle.distance = Math.hypot(6, 3, 9);
      this.orbitAngle.theta = Math.atan2(6, 9);
      this.orbitAngle.phi = Math.acos(3 / this.orbitAngle.distance);
      this._moonFollowPrev = this.moonPos.clone();
    } else if (preset === 'sun') {
      this.targetCamLook.copy(this.sunPos);
      this.targetCamPos.set(this.sunPos.x * 0.75, 12, this.sunPos.z * 0.75);
    }
  }

  updateSimulation(ephem) {
    if (!ephem) return;
    this.currentEphem = ephem;

    if (this.viewMode === 'globe') this._updateGlobeLighting(ephem);

    if (this.viewMode === 'orrery') {
      // 1. Sun (scene mapping: ecliptic lon λ -> (cos λ, sin β, -sin λ); right-handed, +y = ecliptic north)
      const sunLonRad = (ephem.sunEcliptic.lonDeg * Math.PI) / 180;
      const sunLatRad = (ephem.sunEcliptic.latDeg * Math.PI) / 180;
      const sunDist = ORRERY_SUN_DIST * (ephem.sunEcliptic.distAu || 1.0);
      this.sunPos.set(
        sunDist * Math.cos(sunLonRad) * Math.cos(sunLatRad),
        sunDist * Math.sin(sunLatRad),
        -sunDist * Math.sin(sunLonRad) * Math.cos(sunLatRad)
      );
      this.sunGroup.position.copy(this.sunPos);
      this.sunLight.position.copy(this.sunPos);
      if (this.earthOrbitLine) this.earthOrbitLine.position.copy(this.sunPos);

      // 2. Earth (GMST about the polar axis; +y rotation is prograde in this right-handed frame)
      this.earthPos.set(0, 0, 0);
      this.earthGroup.position.copy(this.earthPos);
      if (this.earthMesh) {
        this.earthMesh.rotation.y = (ephem.earthRotationDeg * Math.PI) / 180;
      }
      if (this.earthCloudMesh) {
        // clouds drift slightly relative to the ground (illustrative)
        this.earthCloudMesh.rotation.y = (ephem.earthRotationDeg * Math.PI) / 180 + ((ephem.date.getTime() / 86400000) % 360) * 0.02;
      }

      // 3. Moon
      const moonLonRad = (ephem.moonEcliptic.lonDeg * Math.PI) / 180;
      const moonLatRad = (ephem.moonEcliptic.latDeg * Math.PI) / 180;
      const moonDistScale = (ephem.earthDistanceKm / 384400.0) * 24.0;
      this.moonPos.set(
        moonDistScale * Math.cos(moonLonRad) * Math.cos(moonLatRad),
        moonDistScale * Math.sin(moonLatRad),
        -moonDistScale * Math.sin(moonLonRad) * Math.cos(moonLatRad)
      );
      this.moonGroup.position.copy(this.moonPos);

      // Camera follows the Moon while the Moon preset is active (shift target and camera by its motion)
      if (this.cameraPreset === 'moon' && this._moonFollowPrev) {
        const dx = this.moonPos.x - this._moonFollowPrev.x;
        const dy = this.moonPos.y - this._moonFollowPrev.y;
        const dz = this.moonPos.z - this._moonFollowPrev.z;
        this.targetCamLook.x += dx; this.targetCamLook.y += dy; this.targetCamLook.z += dz;
        this.targetCamPos.x += dx; this.targetCamPos.y += dy; this.targetCamPos.z += dz;
        this._moonFollowPrev.copy(this.moonPos);
      }

      // +z of the group faces Earth. Texture lon 0 sits on the mesh +x axis, so rotate it to +z
      // (-90° about y), then apply libration: sub-Earth longitude about y, latitude about x.
      this.moonGroup.lookAt(0, 0, 0);
      const elatRad = (ephem.subEarthLat * Math.PI) / 180;
      const elonRad = (ephem.subEarthLon * Math.PI) / 180;
      this.moonMesh.rotation.x = elatRad;
      this.moonMesh.rotation.y = -Math.PI / 2 - elonRad;

      if (this.subSolarArrow) {
        this.subSolarArrow.position.copy(this.moonPos);
        const toSunDir = new THREE.Vector3().subVectors(this.sunPos, this.moonPos).normalize();
        this.subSolarArrow.setDirection(toSunDir);
      }
    } else if (this.viewMode === 'south_pole') {
      // Dynamic Polar Solar Shading (Round 4):
      const dist = 75.0;
      const sunVec = computePolarSunLightVector(ephem);

      this.polarSunLight.position.set(sunVec.sunX * dist, sunVec.sunY * dist, sunVec.sunZ * dist);
      this.polarSunLight.lookAt(0, 0, 0);

      // Phase 5: Sun marker on the same true direction + Sun path ring
      this._updateSunLayer(ephem, sunVec);

      // Part C: Update textured Earth globe diurnal rotation
      if (this.commsEarthMesh) {
        this.commsEarthMesh.rotation.y = (ephem.earthRotationDeg * Math.PI) / 180.0;
      }
    }
  }

  /**
   * Phase G2: Moon globe lighting from the ephemeris. The Sun light sits along the true sub-solar direction in the
   * Moon-fixed frame; the earthshine fill comes from the sub-Earth direction with intensity scaled by the lit
   * fraction of the Earth (artistic, with a floor so the night side and the pins stay readable).
   */
  _updateGlobeLighting(ephem) {
    if (!ephem || !this.globeLight) return;
    const sun = globeLightDirection(ephem.subSolarLat, ephem.subSolarLon);
    this.globeLight.position.set(sun.x * GLOBE_LIGHT_DISTANCE, sun.y * GLOBE_LIGHT_DISTANCE, sun.z * GLOBE_LIGHT_DISTANCE);
    this.globeLight.target.position.set(0, 0, 0);
    this._updateGlobeEarth(ephem);
    this._updateGlobeSun(ephem);
    if (this.globeEarthshineLight) {
      const earth = globeLightDirection(ephem.subEarthLat, ephem.subEarthLon);
      this.globeEarthshineLight.position.set(earth.x * GLOBE_LIGHT_DISTANCE, earth.y * GLOBE_LIGHT_DISTANCE, earth.z * GLOBE_LIGHT_DISTANCE);
      this.globeEarthshineLight.target.position.set(0, 0, 0);
      this.globeEarthshineLight.intensity = globeEarthshineIntensity(
        earthLitFractionFromMoon({ lat: ephem.subSolarLat, lon: ephem.subSolarLon }, { lat: ephem.subEarthLat, lon: ephem.subEarthLon }));
    }
  }

  /** Per-frame globe upkeep: pins keep a constant screen size (the Sun light no longer follows the camera). */
  _updateGlobeFrame() {
    this.camera.updateMatrixWorld();
    this._updateGlobePinScales();
    this._updateGlobeEarthFade();
    this._updateGlobeSunFade();
  }

  _animate() {
    const delta = Math.min(this.clock.getDelta(), 0.1);

    // Starfield subtle drift
    if (this.starPoints) {
      this.starPoints.rotation.y += delta * 0.005;
    }

    // Smooth exponential-damping camera glide
    // decay = 4.5 gives responsive yet silky smooth cinematic transitions
    const dampingFactor = 1.0 - Math.exp(-4.5 * delta);
    this.camera.position.lerp(this.targetCamPos, dampingFactor);
    this.currentCamLook.lerp(this.targetCamLook, dampingFactor);
    this.camera.lookAt(this.currentCamLook);
    if (this.viewMode === 'globe') this._updateGlobeFrame();
    this._updateOverlayPositions();

    this.renderer.render(this.scene, this.camera);
    this.frameId = requestAnimationFrame(this._animate);
  }

  dispose() {
    cancelAnimationFrame(this.frameId);
    window.removeEventListener('resize', this.onResize);
    if (this.overlayRoot && this.overlayRoot.parentNode) this.overlayRoot.parentNode.removeChild(this.overlayRoot);
    this.renderer.dispose();
  }
}
