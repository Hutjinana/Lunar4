/**
 * Phase 9 - Mission Metrics user settings (pure: no DOM, no THREE).
 *
 * These settings only affect the NAVIGATOR (Mission Metrics card, 3D panel, "Your setting" chart).
 * Comparison never imports this module: it always uses the defaults (10 m mast, best fixed panel).
 *
 * Units of the stored values:
 *   areaM2 [m^2], efficiency [0..1], mastHeightM [m], frequencyHz [Hz],
 *   pBaseW / pHeaterW [W], depthOfDischarge [0..1], batteryCapacityWh [Wh],
 *   manual.tiltDeg / manual.azimuthDeg [deg].
 * The UI shows frequency in GHz; `parseFrequencyGHz` converts to Hz.
 */
import {
  DEFAULT_PANEL_AREA_M2, DEFAULT_SOLAR_EFFICIENCY, DEFAULT_MAST_HEIGHT_M, DEFAULT_FREQUENCY_HZ,
  DEFAULT_P_BASE_W, DEFAULT_P_HEATER_W, DEFAULT_DEPTH_OF_DISCHARGE, DEFAULT_BATTERY_CAPACITY_WH,
} from './missionMetrics.js';

/** Fresh default settings (a new object each call so callers can mutate their copy). */
export function defaultMissionSettings() {
  return {
    areaM2: DEFAULT_PANEL_AREA_M2,
    efficiency: DEFAULT_SOLAR_EFFICIENCY,
    mastHeightM: DEFAULT_MAST_HEIGHT_M,
    frequencyHz: DEFAULT_FREQUENCY_HZ,
    pBaseW: DEFAULT_P_BASE_W,
    pHeaterW: DEFAULT_P_HEATER_W,
    depthOfDischarge: DEFAULT_DEPTH_OF_DISCHARGE,
    batteryCapacityWh: DEFAULT_BATTERY_CAPACITY_WH,
    manual: { on: false, tiltDeg: 0, azimuthDeg: 0 },
  };
}

/** Allowed ranges. `minExclusive` means the lower bound itself is not allowed (e.g. area must be > 0). */
export const MISSION_INPUT_RULES = {
  areaM2: { label: 'A_panel', unit: 'm²', min: 0, max: 1000, minExclusive: true },
  efficiency: { label: 'η_solar', unit: '', min: 0, max: 1, minExclusive: true },
  mastHeightM: { label: 'Mast height', unit: 'm', min: 0, max: 30 }, // realistic range; Comparison always uses 10 m
  frequencyGHz: { label: 'Frequency', unit: 'GHz', min: 0.1, max: 100 },
  pBaseW: { label: 'P_base', unit: 'W', min: 0, max: 10000 },
  pHeaterW: { label: 'P_heater', unit: 'W', min: 0, max: 10000 },
  depthOfDischarge: { label: 'DoD', unit: '', min: 0, max: 1, minExclusive: true },
  batteryCapacityWh: { label: 'Battery', unit: 'Wh', min: 0, max: 10000000, minExclusive: true },
  tiltDeg: { label: 'Tilt', unit: '°', min: 0, max: 90 },
  azimuthDeg: { label: 'Azimuth', unit: '°', min: 0, max: 360 },
};

function toFiniteNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = v.trim().replace(',', '.');
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Validates one input field. Never clamps: an out-of-range value is rejected with a short message
 * and the caller keeps the previous valid setting.
 * @param {string} field key of MISSION_INPUT_RULES
 * @param {string|number} raw
 * @returns {{ok:true, value:number} | {ok:false, message:string}}
 */
export function validateMissionInput(field, raw) {
  const rule = MISSION_INPUT_RULES[field];
  if (!rule) return { ok: false, message: 'Unknown field.' };
  const n = toFiniteNumber(raw);
  const range = `${rule.minExclusive ? '>' : ''}${rule.min}–${rule.max}${rule.unit ? ' ' + rule.unit : ''}`;
  if (n === null) return { ok: false, message: `${rule.label}: enter a number (${range}).` };
  const lowOk = rule.minExclusive ? n > rule.min : n >= rule.min;
  if (!lowOk || n > rule.max) return { ok: false, message: `${rule.label} must be ${range}.` };
  // An azimuth of 360° is the same direction as 0°
  return { ok: true, value: field === 'azimuthDeg' && n === 360 ? 0 : n };
}

/** GHz (UI) -> Hz (model). */
export function ghzToHz(ghz) {
  return ghz * 1e9;
}

/** Hz (model) -> GHz (UI). */
export function hzToGhz(hz) {
  return hz / 1e9;
}

/**
 * Pre-fills the Manual panel with the current best fixed configuration so users never start from a bad one.
 * Tilt and azimuth are rounded to whole degrees (the optimiser grid is 5°, so this is exact for its output).
 */
export function manualFromBestFixed(bestFixed) {
  return {
    on: true,
    tiltDeg: Math.round(bestFixed.beta),
    azimuthDeg: Math.round(bestFixed.az) % 360,
  };
}

/** Compact signature of every setting that changes the cached Navigator metrics (panel orientation excluded). */
export function metricsSettingsKey(settings) {
  return `${settings.mastHeightM}|${settings.areaM2}|${settings.efficiency}|${settings.frequencyHz}`;
}
