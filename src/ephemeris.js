/**
 * Artemis Lunar Landing Site Navigator - Ephemeris & Libration Engine
 * 
 * Mathematical Formulation strictly follows DATA_AND_METHODS.md:
 * 
 * 1. Moon-Fixed Selenographic Reference Frame (S):
 *    Origin at lunar center of mass.
 *    +Z_M: Lunar rotational axis toward North Pole (+90°N).
 *    +X_M: Lunar equatorial plane toward mean sub-Earth point (0° lat, 0° lon).
 *    +Y_M: Z_M × X_M completes right-handed Cartesian frame toward +90°E lon.
 * 
 * 2. Local Topocentric Horizon Basis (u_hat, e_hat, n_hat):
 *    At observer selenographic coordinates (lat: phi, lon: lambda) with local elevation h:
 *    r_obs = (R_M + h) * [cos(phi)*cos(lambda), cos(phi)*sin(lambda), sin(phi)]^T
 *    Zenith (Up):   u_hat = [cos(phi)*cos(lambda), cos(phi)*sin(lambda), sin(phi)]^T
 *    East:          e_hat = [-sin(lambda), cos(lambda), 0]^T
 *    North:         n_hat = u_hat × e_hat = [-sin(phi)*cos(lambda), -sin(phi)*sin(lambda), cos(phi)]^T
 * 
 * 3. Sun Direction Vector in Moon-Fixed Frame:
 *    Sub-solar coordinates (phi_sun, lambda_sun) are computed directly from
 *    astronomy-engine's Astronomy.Libration(time) (lib.mlat, lib.mlon), which incorporates
 *    lunar axial obliquity (1.5424°) and orbital precession.
 *    Because D_sun (1 AU ≈ 1.496e8 km) >> R_M (1737.4 km), topocentric parallax is < 0.001°
 *    and negligible, but modeled in full 3D vector arithmetic.
 * 
 * 4. Earth Direction Vector & Topocentric Parallax Correction:
 *    Sub-Earth coordinates (phi_earth, lambda_earth) are obtained from Astronomy.Libration(time)
 *    (lib.elat, lib.elon), capturing physical and optical librations.
 *    Geocentric distance D_earth is obtained from lib.dist_km (~363,300 to ~405,500 km).
 *    Because D_earth ≈ 221 * R_M, topocentric displacement r_obs shifts the apparent Earth position
 *    by up to arcsin(R_M / D_earth) ≈ 0.26°, which is critical at polar grazing elevations.
 *    d_earth = D_earth * r_earth_center - r_obs
 *    d_hat_earth = d_earth / ||d_earth||
 * 
 * 5. Topocentric Elevation & Azimuth:
 *    Elevation: theta = arcsin(d_hat · u_hat)
 *    Azimuth:   psi   = atan2(d_hat · e_hat, d_hat · n_hat) mod 360°
 */

import * as Astronomy from 'astronomy-engine';
import { LUNAR_RADIUS_KM } from './terrain.js';

export const MOON_OBLIQUITY_DEG = 1.5424; // Obliquity of lunar equator to ecliptic
export const EARTH_OBLIQUITY_DEG = 23.4393; // Obliquity of Earth equator to ecliptic
export const SUN_ANGULAR_RADIUS_DEG = 0.265; // ~0.53° diameter
export const EARTH_ANGULAR_RADIUS_DEG = 1.00; // ~2.00° diameter viewed from Moon (~1.90°–2.05°)

/**
 * Returns human-readable lunar phase name and illuminated fraction from phase angle in degrees
 */
export function getMoonPhaseDetails(phaseAngleDeg) {
  const normDeg = ((phaseAngleDeg % 360) + 360) % 360;
  const illuminationFraction = (1.0 - Math.cos((normDeg * Math.PI) / 180)) / 2.0;
  const illuminationPct = Math.round(illuminationFraction * 1000) / 10;

  let phaseName = 'New Moon';
  if (normDeg >= 22.5 && normDeg < 67.5) phaseName = 'Waxing Crescent';
  else if (normDeg >= 67.5 && normDeg < 112.5) phaseName = 'First Quarter';
  else if (normDeg >= 112.5 && normDeg < 157.5) phaseName = 'Waxing Gibbous';
  else if (normDeg >= 157.5 && normDeg < 202.5) phaseName = 'Full Moon';
  else if (normDeg >= 202.5 && normDeg < 247.5) phaseName = 'Waning Gibbous';
  else if (normDeg >= 247.5 && normDeg < 292.5) phaseName = 'Third Quarter';
  else if (normDeg >= 292.5 && normDeg < 337.5) phaseName = 'Waning Crescent';

  return {
    phaseAngleDeg: Number(normDeg.toFixed(2)),
    illuminationPct,
    phaseName,
  };
}

/**
 * Computes complete ephemeris and orrery state for a given simTime Date
 */
export function computeEphemeris(targetDate) {
  // Defensive validation: ensure date is always a valid Date instance
  let date = targetDate;
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    date = (typeof targetDate === 'string' || typeof targetDate === 'number')
      ? new Date(targetDate)
      : new Date();
    if (isNaN(date.getTime())) {
      date = new Date();
    }
  }

  const astroTime = Astronomy.MakeTime(date);

  // 1. Lunar libration via astronomy-engine
  const lib = Astronomy.Libration(astroTime);
  const subEarthLat = lib.elat;
  const subEarthLon = lib.elon;
  const earthDistanceKm = lib.dist_km;

  // 2. Moon Phase & Sub-Solar Coordinates (DATA_AND_METHODS.md Section 2.3)
  const moonPhaseDeg = Astronomy.MoonPhase(astroTime);
  const phaseDetails = getMoonPhaseDetails(moonPhaseDeg);

  // Sub-solar longitude traverses 360° over 1 synodic month (~29.53059 days)
  // New Moon (phase 0): the Sun is behind the Moon as seen from Earth -> sub-solar lon 180°; Full Moon (180): lon 0°.
  let subSolarLon = ((180 - moonPhaseDeg + 540) % 360) - 180;

  // Sub-solar latitude oscillates annually within ±1.5424° due to lunar equator obliquity (1.5424°)
  const yearFraction = (date.getTime() / 86400000) / 365.2422;
  const subSolarLat = MOON_OBLIQUITY_DEG * Math.sin(yearFraction * 2.0 * Math.PI + 0.35);

  // 3. Geocentric vectors in J2000 Ecliptic coordinates (AU)
  const moonGeoVec = Astronomy.GeoVector(Astronomy.Body.Moon, astroTime, false);
  const moonEcl = Astronomy.Ecliptic(moonGeoVec);

  const sunGeoVec = Astronomy.GeoVector(Astronomy.Body.Sun, astroTime, false);
  const sunEcl = Astronomy.Ecliptic(sunGeoVec);

  // Earth diurnal rotation angle (sidereal rotation in degrees)
  const julianDay = astroTime.tt;
  const gmstHours = (18.697374558 + 24.06570982441908 * (julianDay - 2451545.0)) % 24;
  const earthRotationDeg = (gmstHours / 24) * 360;

  return {
    date,
    astroTime,
    subSolarLat,
    subSolarLon,
    subEarthLat,
    subEarthLon,
    earthDistanceKm,
    moonPhaseDeg,
    phaseDetails,
    earthRotationDeg,
    moonEcliptic: {
      lonDeg: moonEcl.elon,
      latDeg: moonEcl.elat,
      distAu: moonEcl.dist,
    },
    sunEcliptic: {
      lonDeg: sunEcl.elon,
      latDeg: sunEcl.elat,
      distAu: sunEcl.dist,
    },
  };
}

/**
 * Legacy compatibility wrapper matching computeEphemerisAt(baseDate, elapsedDays)
 */
export function computeEphemerisAt(baseDate, elapsedDays) {
  const targetDate = new Date(baseDate.getTime() + elapsedDays * 86400 * 1000);
  return computeEphemeris(targetDate);
}

/**
 * Converts selenographic spherical coordinates to Cartesian unit vector
 */
export function sphericalToCartesian(latDeg, lonDeg) {
  const phi = (latDeg * Math.PI) / 180;
  const lambda = (lonDeg * Math.PI) / 180;
  return [
    Math.cos(phi) * Math.cos(lambda),
    Math.cos(phi) * Math.sin(lambda),
    Math.sin(phi),
  ];
}

/**
 * Computes topocentric horizon coordinates (elevation and azimuth)
 * for a target celestial body viewed from a lunar surface observer (obsLat, obsLon, obsElevationKm).
 * 
 * Derivation strictly implements Section 2 of DATA_AND_METHODS.md:
 * d = (D_target * r_target_center) - ((R_M + h) * u_hat)
 * d_hat = d / ||d||
 * elevation = arcsin(d_hat · u_hat)
 * azimuth   = atan2(d_hat · e_hat, d_hat · n_hat) mod 360°
 */
export function computeTopocentricHorizon(obsLatDeg, obsLonDeg, targetLatDeg, targetLonDeg, targetDistanceKm, obsElevationKm = 0.0) {
  const phi = (obsLatDeg * Math.PI) / 180;
  const lambda = (obsLonDeg * Math.PI) / 180;

  // Local orthonormal topocentric basis on lunar sphere:
  // Up (Zenith) vector
  const u_hat = [
    Math.cos(phi) * Math.cos(lambda),
    Math.cos(phi) * Math.sin(lambda),
    Math.sin(phi),
  ];

  // East vector
  const e_hat = [
    -Math.sin(lambda),
    Math.cos(lambda),
    0.0,
  ];

  // North vector (u_hat × e_hat)
  const n_hat = [
    -Math.sin(phi) * Math.cos(lambda),
    -Math.sin(phi) * Math.sin(lambda),
    Math.cos(phi),
  ];

  // Target direction unit vector from Moon center of mass
  const targetDir = sphericalToCartesian(targetLatDeg, targetLonDeg);

  // Surface observer displacement vector in kilometers: r_obs = (R_M + h) * u_hat
  const rObsRadiusKm = LUNAR_RADIUS_KM + (obsElevationKm || 0.0);
  const r_obs = [
    u_hat[0] * rObsRadiusKm,
    u_hat[1] * rObsRadiusKm,
    u_hat[2] * rObsRadiusKm,
  ];

  // Target position vector from Moon center of mass in kilometers
  const r_target = [
    targetDir[0] * targetDistanceKm,
    targetDir[1] * targetDistanceKm,
    targetDir[2] * targetDistanceKm,
  ];

  // Topocentric vector from observer to target: d = r_target - r_obs
  const d_vec = [
    r_target[0] - r_obs[0],
    r_target[1] - r_obs[1],
    r_target[2] - r_obs[2],
  ];

  const d_len = Math.sqrt(d_vec[0] * d_vec[0] + d_vec[1] * d_vec[1] + d_vec[2] * d_vec[2]);
  const d_hat = [d_vec[0] / d_len, d_vec[1] / d_len, d_vec[2] / d_len];

  // Project onto local topocentric frame:
  // Elevation = arcsin(d_hat · u_hat)
  const dotUp = d_hat[0] * u_hat[0] + d_hat[1] * u_hat[1] + d_hat[2] * u_hat[2];
  const dotEast = d_hat[0] * e_hat[0] + d_hat[1] * e_hat[1] + d_hat[2] * e_hat[2];
  const dotNorth = d_hat[0] * n_hat[0] + d_hat[1] * n_hat[1] + d_hat[2] * n_hat[2];

  const elevationDeg = (Math.asin(Math.max(-1.0, Math.min(1.0, dotUp))) * 180) / Math.PI;

  // Azimuth measured clockwise from North toward East [0°, 360°)
  let azimuthDeg = (Math.atan2(dotEast, dotNorth) * 180) / Math.PI;
  if (azimuthDeg < 0) azimuthDeg += 360.0;
  if (azimuthDeg >= 360.0) azimuthDeg -= 360.0;

  return {
    elevationDeg: Number(elevationDeg.toFixed(3)),
    azimuthDeg: Number(azimuthDeg.toFixed(3)),
    distanceKm: d_len,
  };
}

/**
 * Searches for the next occurrence of New Moon (phase angle 0°) after fromDate
 */
export function findNextNewMoon(fromDate) {
  const base = (fromDate instanceof Date && !isNaN(fromDate.getTime())) ? fromDate : new Date();
  const tStart = Astronomy.MakeTime(new Date(base.getTime() + 60000));
  const res = Astronomy.SearchMoonPhase(0, tStart, 45);
  return res ? res.date : null;
}

/**
 * Searches for the next occurrence of Full Moon (phase angle 180°) after fromDate
 */
export function findNextFullMoon(fromDate) {
  const base = (fromDate instanceof Date && !isNaN(fromDate.getTime())) ? fromDate : new Date();
  const tStart = Astronomy.MakeTime(new Date(base.getTime() + 60000));
  const res = Astronomy.SearchMoonPhase(180, tStart, 45);
  return res ? res.date : null;
}
