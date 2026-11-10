/**
 * Phase 8 - 3D solar panel on a mast: pure helpers (no THREE, no DOM).
 *
 * DISPLAY EXAGGERATION (not to scale): the scene is 0.35 scene units per km, so a real 10 m mast
 * would be ~0.0035 units tall. The mast and panel are drawn MAST_DISPLAY_UNITS_PER_M = 0.3 units per
 * metre of mast height (10 m -> 3 units, ~85x taller than true scale) and the panel is
 * PANEL_DISPLAY_WIDTH x PANEL_DISPLAY_HEIGHT units. Orientation (tilt, azimuth) and lit state are NOT exaggerated.
 */
import { azimuthToMapDirection } from './mapGeometry.js';
import { DEFAULT_MAST_HEIGHT_M } from './horizon.js';

export const MAST_DISPLAY_UNITS_PER_M = 0.3;
export const PANEL_DISPLAY_WIDTH = 2.6;
export const PANEL_DISPLAY_HEIGHT = 1.7;
export const MAST_DISPLAY_RADIUS = 0.07;

/** Display height of the mast in scene units for a real mast height in metres. */
export function mastDisplayHeight(mastHeightM = DEFAULT_MAST_HEIGHT_M) {
  return Math.max(0, Number(mastHeightM) || 0) * MAST_DISPLAY_UNITS_PER_M;
}

/**
 * Panel normal in SCENE coordinates (+y up). tilt = degrees from horizontal (0 = faces zenith),
 * azimuth = degrees clockwise from local North, same convention as the Sun/Earth azimuths, mapped with
 * azimuthToMapDirection at the site longitude (scene horizontal = (sin(az+lon), cos(az+lon))).
 */
export function panelNormalScene(tiltDeg, azimuthDeg, lonDeg) {
  const t = (tiltDeg * Math.PI) / 180;
  const d = azimuthToMapDirection(azimuthDeg, lonDeg);
  return { x: d.x * Math.sin(t), y: Math.cos(t), z: d.z * Math.sin(t) };
}

/**
 * Panel look: lit = I(t) = 1 AND cos(theta_inc) > 0 -> bright emissive with intensity proportional to cos(theta);
 * otherwise dim grey (shadowed or facing away).
 */
export function panelShading(illuminated, cosInc) {
  const lit = Boolean(illuminated) && cosInc > 0;
  return { lit, intensity: lit ? Math.min(1, cosInc) : 0 };
}
