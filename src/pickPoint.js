/**
 * User-picked point helpers (pure logic, no DOM / Three.js).
 * A picked point is a pseudo-region: it is never part of REGIONS, the comparison table or the ranking.
 */

import { latLonToPolarStereo, polarStereoToLatLon } from './demLoader.js';
import { USER_PICK_REGION_ID } from './horizon.js';

export const PICK_LAT_MIN = -90;
export const PICK_LAT_MAX = -80;
export const PICK_LON_MIN = -180;
export const PICK_LON_MAX = 180;

export const USER_POINT_NAME = 'User-picked point';

function toFiniteNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Validates a signed latitude (-90..-80) and longitude (-180..180, °E positive).
 * Never clamps: out-of-domain input is rejected with a short message.
 * @returns {{ok: true, lat: number, lon: number} | {ok: false, message: string}}
 */
export function validatePickedPoint(lat, lon) {
  const la = toFiniteNumber(lat);
  const lo = toFiniteNumber(lon);
  if (la === null) return { ok: false, message: 'Enter a latitude between 80 and 90 °S.' };
  if (lo === null) return { ok: false, message: 'Enter a longitude between −180 and 180 °E.' };
  if (la < PICK_LAT_MIN || la > PICK_LAT_MAX) return { ok: false, message: 'Latitude must be 80–90 °S.' };
  if (lo < PICK_LON_MIN || lo > PICK_LON_MAX) return { ok: false, message: 'Longitude must be −180 to 180 °E.' };
  return { ok: true, lat: la, lon: lo };
}

/** Same as validatePickedPoint but takes the form's southern latitude (80..90 °S) */
export function validatePickedPointFromForm(latSouth, lonEast) {
  const s = toFiniteNumber(latSouth);
  if (s === null) return validatePickedPoint(NaN, lonEast);
  return validatePickedPoint(-s, lonEast);
}

/** Pseudo-region for a validated point */
export function makeUserPointRegion(lat, lon) {
  return {
    id: USER_PICK_REGION_ID,
    name: USER_POINT_NAME,
    lat,
    lon,
    kind: 'user_point',
    source: 'User-selected',
    source_url: '',
    reference_url: '',
    status: 'user_defined',
  };
}

/** Distance of a point from the pole on the polar stereographic map (km) */
export function distanceFromPoleKm(lat, lon) {
  const { x, y } = latLonToPolarStereo(lat, lon);
  return Math.hypot(x, y);
}

/**
 * Inverse of the pin mapping (pins use x = kmX*scale, z = -kmY*scale):
 * scene-space (x, z) of the terrain -> validated lat/lon.
 */
export function sceneXZToPickedPoint(x, z, spatialScale) {
  const kmX = x / spatialScale;
  const kmY = -z / spatialScale;
  const { lat, lon } = polarStereoToLatLon(kmX, kmY);
  return validatePickedPoint(lat, lon);
}
