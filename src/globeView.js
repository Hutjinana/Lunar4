/**
 * Moon globe landing view: pure helpers (no Three.js, no DOM), so they can be unit-tested headlessly.
 *
 * The globe is for orientation and region picking only. It is NOT a replacement for the LOLA DEM terrain
 * and is not to scale with anything else in the app (the pole terrain keeps its own scene units).
 *
 * Scene frame (matches Three.js SphereGeometry with an equirectangular map centred on 0° longitude):
 *   position = R * (cos(lat) cos(lon), sin(lat), -cos(lat) sin(lon))
 *   +x = lon 0° on the equator, +y = lunar north pole, -z = 90°E
 */

import { CONFIG } from '../config.js';
import { computeEphemeris } from './ephemeris.js';
import { SYNODIC_MONTH_DAYS } from './missionMetrics.js';

/** Globe radius in scene units (1737.4 km is scaled to this). */
export const GLOBE_RADIUS = 10;
export const GLOBE_KM_TO_UNITS = GLOBE_RADIUS / CONFIG.radii.lunarRadiusKm;

/** Camera distance limits measured from the globe centre. */
export const GLOBE_MIN_DISTANCE = 11.5;
export const GLOBE_MAX_DISTANCE = 70;
/**
 * The camera looks at, and orbits around, a point on the Moon's rotation axis at the height of the 70°S latitude
 * circle (inside the globe, about 0.6 units from the south pole), so the south polar region stays at the centre
 * of the screen however the globe is turned.
 */
export const GLOBE_ORBIT_LAT_DEG = -70;
export const GLOBE_ORBIT_TARGET = Object.freeze({ x: 0, y: GLOBE_RADIUS * Math.sin(GLOBE_ORBIT_LAT_DEG * Math.PI / 180), z: 0 });
/** The camera is kept at or south of the equator plane (world y <= 0), so the view stays on the south polar region. */
export const GLOBE_MAX_CAMERA_Y = 0;
/** Polar angle (from +y, at the orbit target) at most this; kept off the axis so lookAt stays stable. */
export const GLOBE_PHI_MAX = Math.PI - 0.05;

/** Duration of the camera zoom after clicking a pin, before the view switches to South Pole mode. */
export const GLOBE_FLY_MS = 750;
export const GLOBE_FLY_DISTANCE = 11.8;
/** On-screen pin head radius as a fraction of the camera-to-pin distance (keeps pins the same size at any zoom). */
export const GLOBE_PIN_SCREEN_SCALE = 0.017;

// Phase G7: pin readability. The nine pins are close together (closest pair ~0.075 units apart), so when the camera
// is near the globe the pins shrink (below constant screen size) instead of overlapping.
/** Pins keep the constant screen size at camera-to-pin distances >= FAR and shrink smoothly to MIN_FACTOR at <= NEAR. */
export const GLOBE_PIN_SHRINK_NEAR = 4;
export const GLOBE_PIN_SHRINK_FAR = 16;
export const GLOBE_PIN_SHRINK_MIN_FACTOR = 0.4;
/** Absolute lower bound of the pin group scale (scene units). */
export const GLOBE_PIN_MIN_SCALE = 0.02;
/** The click/hover target never shrinks below this fraction of its normal (unshrunk) screen size. */
export const GLOBE_PIN_HIT_MIN_FACTOR = 0.6;

/** Pin group scale and hit-target compensation for a camera-to-pin distance (pure; see constants above). */
export function globePinScale(distance) {
  const t = Math.max(0, Math.min(1, (distance - GLOBE_PIN_SHRINK_NEAR) / (GLOBE_PIN_SHRINK_FAR - GLOBE_PIN_SHRINK_NEAR)));
  const shrink = GLOBE_PIN_SHRINK_MIN_FACTOR + (1 - GLOBE_PIN_SHRINK_MIN_FACTOR) * t * t * (3 - 2 * t);
  const scale = Math.max(GLOBE_PIN_MIN_SCALE, distance * GLOBE_PIN_SCREEN_SCALE * 2 * shrink);
  const full = distance * GLOBE_PIN_SCREEN_SCALE * 2;
  // Local scale of the hit sphere so that its world size is at least HIT_MIN_FACTOR of the unshrunk size
  const hitScale = Math.max(1, (GLOBE_PIN_HIT_MIN_FACTOR * full) / scale);
  return { scale, hitScale, shrink };
}

const DEG = Math.PI / 180;

/**
 * The globe is shown upside down (camera roll 180°) so the south pole sits at the top of the screen.
 * The camera up vector is therefore -y; both drag axes are inverted to keep grab-and-rotate natural.
 */
export const GLOBE_CAMERA_UP = Object.freeze({ x: 0, y: -1, z: 0 });
export const GLOBE_DRAG_SIGN = -1;

/**
 * Initial landing view: side-on from the equator plane (looking at lon 0°) at the 70°S orbit target. With the globe
 * upside down, the south pole is at the centre of the screen with the pins standing up around it.
 */
export const GLOBE_DEFAULT_ORBIT = Object.freeze({ theta: Math.PI / 2, phi: Math.acos((GLOBE_MAX_CAMERA_Y - GLOBE_ORBIT_TARGET.y) / 30), distance: 30 });
/** "Focus South Pole" preset: camera nearly on the rotation axis below the globe, framing the polar pins from above. */
export const GLOBE_FOCUS_SOUTH_ORBIT = Object.freeze({ theta: Math.PI / 2, phi: Math.PI - 0.12, distance: 4.6 });

/** Point on the sphere (scene units) for a selenographic latitude/longitude in degrees. */
export function latLonToGlobePosition(latDeg, lonDeg, radius = GLOBE_RADIUS) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  return {
    x: radius * Math.cos(lat) * Math.cos(lon),
    y: radius * Math.sin(lat),
    z: -radius * Math.cos(lat) * Math.sin(lon),
  };
}

/**
 * Inverse of latLonToGlobePosition: selenographic lat/lon (degrees, lon in -180..180 °E) of a point on, or along the
 * radial line through, the globe surface. Used to turn a click on the sphere into a coordinate.
 */
export function globePositionToLatLon(pos) {
  const len = Math.hypot(pos.x, pos.y, pos.z) || 1;
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, pos.y / len))) / DEG,
    lon: Math.atan2(-pos.z, pos.x) / DEG,
  };
}

const ORBIT_T2 = GLOBE_ORBIT_TARGET.x ** 2 + GLOBE_ORBIT_TARGET.y ** 2 + GLOBE_ORBIT_TARGET.z ** 2;

/** Smallest polar angle that keeps the camera at or south of GLOBE_MAX_CAMERA_Y for this distance from the target. */
export function globePhiMinForDistance(d) {
  return Math.acos(Math.min(1, (GLOBE_MAX_CAMERA_Y - GLOBE_ORBIT_TARGET.y) / Math.max(d, 1e-6)));
}

/** Smallest distance from the target at which the camera is still GLOBE_MIN_DISTANCE from the globe centre. */
export function globeMinDistanceForPhi(phi) {
  const b = GLOBE_ORBIT_TARGET.y * Math.cos(phi);
  return -b + Math.sqrt(Math.max(0, b * b - ORBIT_T2 + GLOBE_MIN_DISTANCE * GLOBE_MIN_DISTANCE));
}

export function clampGlobePhi(phi, distance = GLOBE_DEFAULT_ORBIT.distance) {
  return Math.max(globePhiMinForDistance(distance), Math.min(GLOBE_PHI_MAX, phi));
}

export function clampGlobeDistance(d, phi = GLOBE_PHI_MAX) {
  return Math.max(globeMinDistanceForPhi(phi), Math.min(GLOBE_MAX_DISTANCE, d));
}

/** Clamps an orbit (theta, phi, distance from the orbit target) to the allowed region. */
export function clampGlobeOrbit(orbit) {
  let { theta, phi, distance } = orbit;
  phi = Math.min(GLOBE_PHI_MAX, phi);
  for (let i = 0; i < 3; i++) {
    distance = clampGlobeDistance(distance, phi);
    phi = clampGlobePhi(phi, distance);
  }
  return { theta, phi, distance: clampGlobeDistance(distance, phi) };
}

/**
 * Orbit (about the orbit target) for a camera sitting on the line through the globe centre and the given lat/lon,
 * `distance` from the globe centre.
 */
export function globeOrbitForLatLon(latDeg, lonDeg, distance = GLOBE_DEFAULT_ORBIT.distance) {
  const c = latLonToGlobePosition(latDeg, lonDeg, distance);
  const ox = c.x - GLOBE_ORBIT_TARGET.x, oy = c.y - GLOBE_ORBIT_TARGET.y, oz = c.z - GLOBE_ORBIT_TARGET.z;
  const d = Math.hypot(ox, oy, oz) || 1;
  const horizontal = Math.hypot(ox, oz);
  return clampGlobeOrbit({
    theta: horizontal > 1e-6 ? Math.atan2(ox, oz) : Math.PI / 2 + lonDeg * DEG,
    phi: Math.acos(Math.max(-1, Math.min(1, oy / d))),
    distance: d,
  });
}

/** Camera world position for orbit angles around the orbit target. */
export function globeCameraPosition(orbit) {
  const { theta, phi, distance } = orbit;
  return {
    x: GLOBE_ORBIT_TARGET.x + distance * Math.sin(phi) * Math.sin(theta),
    y: GLOBE_ORBIT_TARGET.y + distance * Math.cos(phi),
    z: GLOBE_ORBIT_TARGET.z + distance * Math.sin(phi) * Math.cos(theta),
  };
}

/**
 * True when a surface point (given by its position vector) faces the camera, i.e. it is on the visible
 * hemisphere. Used so pins on the far side of the globe can be neither hovered nor clicked.
 */
export function isGlobePointVisible(pointPos, cameraPos, radius = GLOBE_RADIUS) {
  const len = Math.hypot(pointPos.x, pointPos.y, pointPos.z) || 1;
  const dot = (pointPos.x * cameraPos.x + pointPos.y * cameraPos.y + pointPos.z * cameraPos.z) / len;
  return dot > radius;
}

/**
 * True when a point (e.g. a pin head standing above the surface) can be seen from the camera, i.e. the straight
 * line from the camera to the point does not pass through the sphere. Unlike isGlobePointVisible this also keeps
 * pins that stand up beyond the limb (the polar pins seen side-on from the equator) visible and clickable.
 */
export function isGlobeHeadVisible(headPos, cameraPos, radius = GLOBE_RADIUS) {
  const dx = headPos.x - cameraPos.x, dy = headPos.y - cameraPos.y, dz = headPos.z - cameraPos.z;
  const len2 = dx * dx + dy * dy + dz * dz || 1;
  const t = Math.max(0, Math.min(1, -(cameraPos.x * dx + cameraPos.y * dy + cameraPos.z * dz) / len2));
  const cx = cameraPos.x + dx * t, cy = cameraPos.y + dy * t, cz = cameraPos.z + dz * t;
  return Math.hypot(cx, cy, cz) >= radius * 0.999;
}

// ---------------------------------------------------------------------------------------------
// Globe-view Earth and Sun (Phase G1): display constants and pure geometry. Nothing is drawn here.
// The Earth and the Sun are NOT to scale; only their directions (from the ephemeris) are real.
// ---------------------------------------------------------------------------------------------

/**
 * Display distances/radii from the globe centre, in scene units. Tuned to the owner's hand-set globe camera
 * (default view: camera ~28.5 from the globe centre on the equator plane at lon 0°, looking at the 70°S target):
 *  - The Earth must sit INSIDE the camera distance, otherwise it would be behind the default camera. At 18 it is
 *    ~10.5 in front of the camera and ~18° below the view axis, so it is fully on screen at the default view.
 *  - The Sun ring (100) encloses essentially the whole allowed camera range (max 70 from the target), so the camera
 *    is never inside the ring and the Sun is always farther away than the Earth.
 */
export const GLOBE_EARTH_DISTANCE = 60;
export const GLOBE_EARTH_RADIUS = 0.8;
export const GLOBE_SUN_DISTANCE = 100;
export const GLOBE_SUN_RADIUS = 2.5;
/** The Sun's real latitude swing is only ±1.54°; doubled so the ring is not perfectly flat (stated in the tooltip). */
export const GLOBE_SUN_LAT_EXAGGERATION = 2;
/** One libration cycle (the loop need not close exactly). */
export const GLOBE_EARTH_PATH_DAYS = 27.55;
export const GLOBE_PATH_STEP_HOURS = 6;

/** Scene position of a body in direction (lat, lon) at `distance` from the globe centre; latitude optionally exaggerated. */
export function globeBodyPosition(latDeg, lonDeg, distance, latExaggeration = 1) {
  return latLonToGlobePosition(latDeg * latExaggeration, lonDeg, distance);
}

function samplePath(centerDate, spanDays, stepHours, pick, distance, latExaggeration) {
  const stepMs = stepHours * 3600 * 1000;
  const spanMs = spanDays * 86400 * 1000;
  const startMs = centerDate.getTime() - spanMs / 2;
  const n = Math.round(spanMs / stepMs) + 1;
  const samples = [];
  for (let i = 0; i < n; i++) {
    const { lat, lon } = pick(computeEphemeris(new Date(startMs + i * stepMs)));
    samples.push({ lat, lon, point: globeBodyPosition(lat, lon, distance, latExaggeration) });
  }
  return { startMs, stepMs, samples };
}

/**
 * Sun's track around the Moon in the Moon-fixed frame: sub-solar lat/lon every `stepHours` over one synodic month
 * centred on `centerDate`, at GLOBE_SUN_DISTANCE (latitude exaggerated). Returns { startMs, stepMs, samples: [{ lat, lon, point }] }.
 */
export function sunOrbitRingSamples(centerDate, spanDays = SYNODIC_MONTH_DAYS, stepHours = GLOBE_PATH_STEP_HOURS) {
  return samplePath(centerDate, spanDays, stepHours, (e) => ({ lat: e.subSolarLat, lon: e.subSolarLon }), GLOBE_SUN_DISTANCE, GLOBE_SUN_LAT_EXAGGERATION);
}

/**
 * Libration path: sub-Earth lat/lon over `spanDays` centred on `centerDate`, at GLOBE_EARTH_DISTANCE (no exaggeration).
 * Same return shape as sunOrbitRingSamples.
 */
export function earthLibrationPathSamples(centerDate, spanDays = GLOBE_EARTH_PATH_DAYS, stepHours = GLOBE_PATH_STEP_HOURS) {
  return samplePath(centerDate, spanDays, stepHours, (e) => ({ lat: e.subEarthLat, lon: e.subEarthLon }), GLOBE_EARTH_DISTANCE, 1);
}

/** Index k of the sample at or before timeMs, clamped so that k and k+1 are valid. */
export function pathIndexAt(path, timeMs) {
  const k = Math.floor((timeMs - path.startMs) / path.stepMs);
  return Math.max(0, Math.min(path.samples.length - 2, k));
}

/**
 * Fraction of the Earth's disc that is lit as seen from the Moon: (1 - sunDir . earthDir) / 2, with both directions
 * given as selenographic { lat, lon } in degrees. 1 = full Earth (Sun behind the Moon, i.e. new Moon), 0 = new Earth.
 */
export function earthLitFractionFromMoon(subSolar, subEarth) {
  const s = latLonToGlobePosition(subSolar.lat, subSolar.lon, 1);
  const e = latLonToGlobePosition(subEarth.lat, subEarth.lon, 1);
  const f = (1 - (s.x * e.x + s.y * e.y + s.z * e.z)) / 2;
  return Math.max(0, Math.min(1, f));
}

// ---------------------------------------------------------------------------------------------
// Phase G2: real-Sun lighting of the Moon globe. Artistic fill values, NOT physically scaled.
// ---------------------------------------------------------------------------------------------
export const GLOBE_SUN_LIGHT_INTENSITY = 2.6;
/** Low constant ambient so the night hemisphere and the pins never go fully black. */
export const GLOBE_AMBIENT_INTENSITY = 0.22;
/** "Earthshine" fill from the Earth direction: intensity = floor + (max - floor) * litFraction of the Earth. */
export const GLOBE_EARTHSHINE_MIN = 0.35;
export const GLOBE_EARTHSHINE_MAX = 0.9;
/** Distance at which the directional lights sit (direction only matters for a DirectionalLight). */
export const GLOBE_LIGHT_DISTANCE = 100;

/** Unit direction from the Moon centre toward a selenographic lat/lon (Sun or Earth). */
export function globeLightDirection(latDeg, lonDeg) {
  return latLonToGlobePosition(latDeg, lonDeg, 1);
}

/** Earthshine fill intensity for a lit fraction of the Earth's disc (0..1), never below GLOBE_EARTHSHINE_MIN. */
export function globeEarthshineIntensity(litFraction) {
  const f = Math.max(0, Math.min(1, litFraction));
  return GLOBE_EARTHSHINE_MIN + (GLOBE_EARTHSHINE_MAX - GLOBE_EARTHSHINE_MIN) * f;
}

// ---------------------------------------------------------------------------------------------
// Phase G3: camera proximity fade (the camera orbits the Moon and can pass through the Earth or the Sun).
// ---------------------------------------------------------------------------------------------
/** A body is fully faded out (invisible) when the camera is within INNER * radius of its centre, fully visible beyond OUTER * radius. */
export const GLOBE_FADE_INNER_FACTOR = 2.5;
export const GLOBE_FADE_OUTER_FACTOR = 4;

/** Opacity factor 0..1 (smoothstep) for a body of `radius` seen from `distance` away. */
export function globeProximityFade(distance, radius) {
  const a = GLOBE_FADE_INNER_FACTOR * radius;
  const b = GLOBE_FADE_OUTER_FACTOR * radius;
  const t = Math.max(0, Math.min(1, (distance - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------------------------
// Phase G4: Earth libration path (display + cache rule)
// ---------------------------------------------------------------------------------------------
/** The libration (and later the Sun ring) samples are recomputed only when time moves more than this from their centre. */
export const GLOBE_PATH_RECENTER_MS = 86400 * 1000;
/** Opacity of the libration path: past part dim, future part bright; marker ring around the current position. */
export const GLOBE_EARTH_PATH_PAST_OPACITY = 0.3;
export const GLOBE_EARTH_PATH_FUTURE_OPACITY = 0.95;
export const GLOBE_EARTH_MARKER_RADIUS_FACTOR = 1.9;

/** True when a cached path centred on `centerMs` must be rebuilt for the time `tMs` (never true within about one day). */
export function globePathNeedsRebuild(centerMs, tMs) {
  return !Number.isFinite(centerMs) || Math.abs(tMs - centerMs) > GLOBE_PATH_RECENTER_MS;
}

// ---------------------------------------------------------------------------------------------
// Phase G5: Sun body and Sun orbit ring (display)
// ---------------------------------------------------------------------------------------------
export const GLOBE_SUN_RING_PAST_OPACITY = 0.3;
export const GLOBE_SUN_RING_FUTURE_OPACITY = 0.95;
export const GLOBE_SUN_MARKER_RADIUS_FACTOR = 1.6;
