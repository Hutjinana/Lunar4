/**
 * Artemis Lunar Landing Site Navigator - Cartographic & Projection Map Geometry
 * 
 * Part A Core Geometry Module:
 * Converts topocentric azimuth psi (clockwise from local north) at observer longitude lambda
 * into direction vectors on the South Polar Stereographic projection map and in Three.js scene coordinates.
 * 
 * Derivation:
 * - South Polar Stereographic projection:
 *   x = rho * sin(lon)
 *   y = -rho * cos(lon)
 * - Three.js Polar Scene coordinates:
 *   (x, z) = (mapX, -mapY) = (rho * sin(lon), rho * cos(lon))
 *   +X points toward 90°E, +Z points toward 0°E (Prime Meridian).
 * - At observer longitude lambda:
 *   Local North points radially outward from the pole (toward lower latitudes):
 *   North_scene = (sin lambda, cos lambda)
 *   North_map   = (sin lambda, -cos lambda)
 *   Local East is +90° clockwise from North:
 *   East_scene  = (cos lambda, -sin lambda)
 *   East_map    = (cos lambda, sin lambda)
 * - Direction of an arbitrary topocentric azimuth psi (clockwise from North):
 *   dir_scene = cos(psi)*North_scene + sin(psi)*East_scene
 *             = (sin(psi + lambda), cos(psi + lambda))
 *   dir_map   = (sin(psi + lambda), -cos(psi + lambda))
 */

/**
 * Computes unit horizontal direction vectors for an azimuth at an observer longitude
 * @param {number} azimuthDeg - Topocentric azimuth clockwise from local north in degrees
 * @param {number} lonDeg - Observer selenographic longitude in degrees (default 0.0)
 * @returns {Object} Direction components and angle:
 *   - x: scene X component (sin(psi + lambda))
 *   - z: scene Z component (cos(psi + lambda))
 *   - mapX: map X component (sin(psi + lambda))
 *   - mapY: map Y component (-cos(psi + lambda))
 *   - angleDeg: scene-plane direction angle from +Z toward +X in [0, 360)
 */
export function azimuthToMapDirection(azimuthDeg, lonDeg = 0.0) {
  const angleRad = ((azimuthDeg + lonDeg) * Math.PI) / 180.0;
  const sinA = Math.sin(angleRad);
  const cosA = Math.cos(angleRad);

  return {
    x: sinA,
    z: cosA,
    mapX: sinA,
    mapY: -cosA,
    angleDeg: (((azimuthDeg + lonDeg) % 360.0) + 360.0) % 360.0,
  };
}
