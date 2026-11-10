/**
 * Phase 9 - Mission Metrics card (right-panel region inspector).
 *
 * DOM + formatting only. Every number shown comes from missionMetrics.js (pure functions); the card never
 * calls the ephemeris or builds a horizon. The app hands it:
 *   - setMetrics(metrics): the cached per-region result (window statistics, best fixed panel). Called only when
 *     the region, epoch or a metrics-affecting setting changes.
 *   - updateInstant(instant, elapsedDays, panelDesc): the cheap per-tick readout.
 *
 * Settings live here (the UI state object) and are persisted in memory for the session. They are Navigator-only:
 * Comparison never reads them.
 */
import {
  batteryRequiredCapacityWh, batterySurvivalHours, compareYourSettingToBest,
} from './missionMetrics.js';
import {
  defaultMissionSettings, validateMissionInput, ghzToHz, hzToGhz, manualFromBestFixed, MISSION_INPUT_RULES,
} from './missionSettings.js';
import { PowerComparisonChart, POWER_CHART_COLORS } from './powerChart.js';

/** "Window: 30 d from 2026-11-01 UTC, step 30 min" (step shown in hours from 60 min up). */
export function formatWindowLine({ startMs, days, stepMinutes }) {
  const step = stepMinutes >= 60 ? `${stepMinutes / 60} h` : `${stepMinutes} min`;
  const d = Number.isInteger(days) ? String(days) : days.toFixed(2);
  return `Window: ${d} d from ${new Date(startMs).toISOString().substring(0, 10)} UTC, step ${step}`;
}

const MAST_INPUT_IDS = ['mm-in-mast', 'mm-in-mast-dark', 'mm-in-mast-comm'];
const CELL = 'p-1.5 rounded-lg bg-[#07090E] border border-[#1E293B]';
const CELL_LABEL = 'text-[9px] text-slate-400 uppercase leading-tight';
const INPUT = 'mm-input w-full px-1.5 py-1 rounded-lg bg-[#07090E] border border-[#1E293B] text-white text-[11px] tabular-nums focus:outline-none focus:border-cyan-500 disabled:opacity-40';

function cell(id, label, color = 'text-white') {
  return `<div class="${CELL}">
                    <div class="${CELL_LABEL}">${label}</div>
                    <div id="${id}" class="${color} font-bold text-[12px] tabular-nums">--</div>
                  </div>`;
}

function field(id, label, value, unit, { min, max, hint } = {}) {
  const range = `${min !== undefined ? ` min="${min}"` : ''}${max !== undefined ? ` max="${max}"` : ''}`;
  return `<label class="space-y-0.5 block">
                      <span class="text-[9px] text-slate-400 uppercase">${label}${unit ? ` (${unit})` : ''}</span>
                      <input id="${id}" type="text" inputmode="decimal" autocomplete="off" value="${value}"${range} class="${INPUT}" />
                      ${hint ? `<span class="mm-hint block text-[9px] text-slate-500 leading-snug normal-case">${hint}</span>` : ''}
                    </label>`;
}

/** Section heading of one category card (coloured dot + title + optional right-hand badge). */
function cardHeader(title, dot, badgeId, badgeText, badgeColor) {
  return `<div class="flex items-center justify-between">
                  <div class="flex items-center gap-1.5 font-bold text-white text-[11px]">
                    <span class="w-2 h-2 rounded-full ${dot}"></span>
                    <span>${title}</span>
                  </div>
                  ${badgeId ? `<span id="${badgeId}" class="text-[10px] font-bold ${badgeColor} font-mono tabular-nums">${badgeText}</span>` : ''}
                </div>`;
}

/** Mast height changes the horizon, so it appears in every category whose numbers depend on the horizon. */
function mastField(suffix, d) {
  const { min, max } = MISSION_INPUT_RULES.mastHeightM;
  return field(`mm-in-mast${suffix}`, 'Mast height', d.mastHeightM, 'm', {
    min, max, hint: `Realistic range ${min}–${max} m (NASA VSAT studies: 10 m or more; some designs about 20–30 m).`,
  });
}

/** Shared tail of every Advanced section: validation message + reset button. */
function advancedFooter(errorId, resetId) {
  return `<div id="${errorId}" class="mm-error hidden text-rose-300 text-[10px]" role="alert"></div>
                    <button type="button" id="${resetId}" class="mm-reset px-2 py-1 rounded-lg bg-[#1E293B] text-slate-300 hover:text-white text-[10px] font-semibold transition-colors">Reset defaults</button>`;
}

const ADV_SUMMARY = 'px-2 py-1.5 cursor-pointer select-none text-[10px] font-bold text-slate-300 uppercase';
const ADV_BOX = 'rounded-lg border border-[#1E293B] bg-[#07090E]/60';

/**
 * Static markup of the three main categories (inserted once in the inspector):
 *   Sun & Power · Darkness & Battery · Communication with Earth.
 * Each category owns an Advanced section holding only the inputs that feed its numbers.
 */
export function missionMetricsCardHTML() {
  const d = defaultMissionSettings();
  return `
              <!-- Phase 9/11: three main categories (replaces the single "Mission Metrics" card) -->
              <div id="mission-metrics-card" class="space-y-2.5">

                <!-- 1. Sun & Power -->
                <div id="mm-card-sun" class="p-2.5 rounded-xl bg-[#0F172A] border border-[#1E293B] space-y-2.5">
                  ${cardHeader('Sun &amp; Power', 'bg-amber-400', 'mm-panel-config', 'Best fixed panel', 'text-emerald-300')}
                  <div class="space-y-1.5">
                    <div class="flex items-center justify-between text-[10px]">
                      <span class="text-slate-400 uppercase font-semibold">Now</span>
                      <span id="mm-now-label" class="text-slate-300 tabular-nums">--</span>
                    </div>
                    <div class="grid grid-cols-2 gap-1.5 text-center">
                      ${cell('mm-lit', 'Sun (centre)')}
                      ${cell('mm-pgen', 'P_gen (W)', 'text-amber-300')}
                      ${cell('mm-cos', 'cos θ_inc')}
                      ${cell('mm-solar', 'S_solar (W/m²)')}
                    </div>
                  </div>
                  <div class="space-y-1.5">
                    <div class="flex items-center justify-between text-[10px]">
                      <span class="text-slate-400 uppercase font-semibold">Evaluation window</span>
                      <span id="mm-window-label" class="text-slate-300 tabular-nums">--</span>
                    </div>
                    <div class="grid grid-cols-3 gap-1.5 text-center">
                      ${cell('mm-lit-pct', '% lit', 'text-amber-300')}
                      ${cell('mm-lit-hours', 'Total lit hours', 'text-amber-300')}
                      ${cell('mm-energy', 'Energy E (best fixed)', 'text-emerald-300')}
                    </div>
                    <div class="${CELL} flex items-center justify-between text-[10px]">
                      <span class="text-slate-400 uppercase">Best fixed tilt / azimuth</span>
                      <span id="mm-best-panel" class="text-emerald-300 font-bold tabular-nums">--</span>
                    </div>
                  </div>

                  <details id="mm-advanced" class="${ADV_BOX}">
                    <summary class="${ADV_SUMMARY}">Advanced</summary>
                    <div class="p-2 space-y-2 border-t border-[#1E293B]">
                      <div class="grid grid-cols-2 gap-1.5">
                        ${field('mm-in-area', 'A_panel', d.areaM2, 'm²')}
                        ${field('mm-in-eta', 'η_solar', d.efficiency, '0–1')}
                        ${mastField('', d)}
                      </div>
                      <p class="text-[9.5px] text-slate-400 leading-snug font-sans">Mast height changes the horizon (observer = terrain + mast). The DEM resolution is 320 m, so obstacles smaller than that are not resolved. Comparison always uses 10 m and the best fixed panel.</p>

                      <div class="pt-1.5 border-t border-[#1E293B] space-y-1.5">
                        <div class="flex items-center justify-between">
                          <span class="text-[10px] text-slate-200 font-bold">Manual panel</span>
                          <button type="button" id="mm-manual-switch" role="switch" aria-checked="false" class="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-800 text-slate-400 text-[10px] font-bold transition-colors">OFF</button>
                        </div>
                        <div class="grid grid-cols-2 gap-1.5">
                          ${field('mm-in-tilt', 'Tilt', '0', '°')}
                          ${field('mm-in-az', 'Azimuth', '0', '°')}
                        </div>
                      </div>
                      ${advancedFooter('mm-error', 'mm-reset')}
                    </div>
                  </details>

                  <div id="mm-chart-wrap" class="hidden space-y-1">
                    <div class="text-[10px] text-slate-400 uppercase font-semibold">Your setting vs Best possible · P_gen(t)</div>
                    <div id="mm-chart-legend" class="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] font-mono tabular-nums"></div>
                    <div class="h-44 rounded-lg overflow-hidden border border-[#1E293B]">
                      <canvas id="mm-power-canvas" class="w-full h-full cursor-crosshair block"></canvas>
                    </div>
                    <p class="text-[9.5px] text-slate-400 leading-snug font-sans">Click or drag on the chart to move the simulation time.</p>
                  </div>
                </div>

                <!-- 2. Darkness & Battery -->
                <div id="mm-card-dark" class="p-2.5 rounded-xl bg-[#0F172A] border border-[#1E293B] space-y-2.5">
                  ${cardHeader('Darkness &amp; Battery', 'bg-rose-400')}
                  <div class="grid grid-cols-2 gap-1.5 text-center">
                    ${cell('mm-longest-dark', 'Longest dark interval', 'text-rose-300')}
                    ${cell('mm-batt-required', 'Required capacity', 'text-rose-300')}
                    ${cell('mm-batt-survival', 'Survival time', 'text-amber-300')}
                  </div>
                  <p id="mm-batt-note" class="text-[9.5px] text-slate-400 leading-snug font-sans">--</p>

                  <details id="mm-advanced-dark" class="${ADV_BOX}">
                    <summary class="${ADV_SUMMARY}">Advanced</summary>
                    <div class="p-2 space-y-2 border-t border-[#1E293B]">
                      <div class="grid grid-cols-2 gap-1.5">
                        ${field('mm-in-pbase', 'P_base', d.pBaseW, 'W')}
                        ${field('mm-in-pheater', 'P_heater', d.pHeaterW, 'W')}
                        ${field('mm-in-dod', 'DoD', d.depthOfDischarge, '0–1')}
                        ${field('mm-in-batt', 'Battery', d.batteryCapacityWh, 'Wh')}
                        ${mastField('-dark', d)}
                      </div>
                      ${advancedFooter('mm-error-dark', 'mm-reset-dark')}
                    </div>
                  </details>
                </div>

                <!-- 3. Communication with Earth -->
                <div id="mm-card-comm" class="p-2.5 rounded-xl bg-[#0F172A] border border-[#1E293B] space-y-2.5">
                  ${cardHeader('Communication with Earth', 'bg-cyan-400')}
                  <div class="grid grid-cols-2 gap-1.5 text-center">
                    ${cell('mm-dearth', 'd_Earth (km)', 'text-cyan-300')}
                    ${cell('mm-fspl', 'FSPL (dB)', 'text-cyan-300')}
                    ${cell('mm-comm-hours', 'ΔT_comm (Earth visible)', 'text-cyan-300')}
                    ${cell('mm-longest-contact', 'Longest contact', 'text-cyan-300')}
                  </div>

                  <details id="mm-advanced-comm" class="${ADV_BOX}">
                    <summary class="${ADV_SUMMARY}">Advanced</summary>
                    <div class="p-2 space-y-2 border-t border-[#1E293B]">
                      <div class="grid grid-cols-2 gap-1.5">
                        ${field('mm-in-freq', 'Frequency', hzToGhz(d.frequencyHz), 'GHz')}
                        ${mastField('-comm', d)}
                      </div>
                      ${advancedFooter('mm-error-comm', 'mm-reset-comm')}
                    </div>
                  </details>
                </div>
              </div>
`;
}

function fmt(v, digits = 1) {
  return Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '--';
}

/** Energy in Wh, switching to kWh/MWh for readability. */
export function formatEnergy(wh) {
  if (!Number.isFinite(wh)) return '--';
  const a = Math.abs(wh);
  if (a >= 1e6) return `${fmt(wh / 1e6, 2)} MWh`;
  if (a >= 1e3) return `${fmt(wh / 1e3, 1)} kWh`;
  return `${fmt(wh, 0)} Wh`;
}

/** Hours, with a "≥" prefix when the run touches a window edge (true length is only a lower bound). */
export function formatHours(hours, lowerBound = false) {
  if (!Number.isFinite(hours)) return '--';
  return `${lowerBound ? '≥ ' : ''}${fmt(hours, 1)} h`;
}

export class MissionMetricsCard {
  /**
   * @param {Object} o
   * @param {Object} [o.callbacks]
   * @param {(settings:Object, changed:string)=>void} [o.callbacks.onSettingsChange] metrics-affecting setting changed
   * @param {(manual:Object)=>void} [o.callbacks.onManualChange] Manual switch / tilt / azimuth changed
   * @param {(days:number)=>void} [o.callbacks.onSeekDays] chart click/drag
   */
  constructor(o = {}) {
    this.callbacks = o.callbacks || {};
    this.settings = defaultMissionSettings();
    this.metrics = null;
    this.chart = null;
    this.lastElapsedDays = 0;
    this._bind();
    this._renderSettingsIntoInputs();
    this._syncManualUi();
  }

  $(id) { return document.getElementById(id); }

  _setText(id, text) {
    const el = this.$(id);
    if (el && el.textContent !== text) el.textContent = text;
  }

  // ---------------------------------------------------------------------------------------------
  // Inputs
  // ---------------------------------------------------------------------------------------------
  _bind() {
    const num = (id, field, apply, convert = (v) => v) => {
      const el = this.$(id);
      if (!el) return;
      el.addEventListener('change', () => {
        const r = validateMissionInput(field, el.value);
        if (!r.ok) { this._showError(r.message, el); return; }
        this._clearError(el);
        apply(convert(r.value));
      });
    };
    const metricsSetting = (key, field) => (value) => {
      if (this.settings[key] === value) return;
      this.settings[key] = value;
      if (key === 'mastHeightM') this._renderSettingsIntoInputs();
      this.callbacks.onSettingsChange?.(this.settings, key);
      this._refreshDerived();
    };

    num('mm-in-area', 'areaM2', metricsSetting('areaM2'));
    num('mm-in-eta', 'efficiency', metricsSetting('efficiency'));
    // Mast height is shown in every category that depends on the horizon; the copies stay in sync
    for (const id of MAST_INPUT_IDS) num(id, 'mastHeightM', metricsSetting('mastHeightM'));
    num('mm-in-freq', 'frequencyGHz', metricsSetting('frequencyHz'), ghzToHz);
    // Battery inputs only change the derived battery numbers, not the cached geometry
    const batterySetting = (key) => (value) => { this.settings[key] = value; this._refreshDerived(); };
    num('mm-in-pbase', 'pBaseW', batterySetting('pBaseW'));
    num('mm-in-pheater', 'pHeaterW', batterySetting('pHeaterW'));
    num('mm-in-dod', 'depthOfDischarge', batterySetting('depthOfDischarge'));
    num('mm-in-batt', 'batteryCapacityWh', batterySetting('batteryCapacityWh'));

    const manualSetting = (key) => (value) => {
      this.settings.manual[key] = value;
      this._manualChanged();
    };
    num('mm-in-tilt', 'tiltDeg', manualSetting('tiltDeg'));
    num('mm-in-az', 'azimuthDeg', manualSetting('azimuthDeg'));

    this.$('mm-manual-switch')?.addEventListener('click', () => this.setManual(!this.settings.manual.on));
    this.$('mission-metrics-card')?.querySelectorAll('.mm-reset').forEach((b) => b.addEventListener('click', () => this.resetDefaults()));
  }

  /** The message element lives in the same Advanced section as the input. */
  _errorEl(inputEl) {
    return inputEl?.closest('details')?.querySelector('.mm-error') || this.$('mm-error');
  }

  _showError(message, inputEl) {
    const err = this._errorEl(inputEl);
    if (err) { err.textContent = message; err.classList.remove('hidden'); }
    inputEl?.classList.add('border-rose-500');
  }

  _clearError(inputEl) {
    this._errorEl(inputEl)?.classList.add('hidden');
    inputEl?.classList.remove('border-rose-500');
  }

  _renderSettingsIntoInputs() {
    const s = this.settings;
    const set = (id, v) => { const el = this.$(id); if (el) { el.value = String(v); el.classList.remove('border-rose-500'); } };
    set('mm-in-area', s.areaM2);
    set('mm-in-eta', s.efficiency);
    for (const id of MAST_INPUT_IDS) set(id, s.mastHeightM);
    set('mm-in-freq', hzToGhz(s.frequencyHz));
    set('mm-in-pbase', s.pBaseW);
    set('mm-in-pheater', s.pHeaterW);
    set('mm-in-dod', s.depthOfDischarge);
    set('mm-in-batt', s.batteryCapacityWh);
    set('mm-in-tilt', s.manual.tiltDeg);
    set('mm-in-az', s.manual.azimuthDeg);
    this.$('mission-metrics-card')?.querySelectorAll('.mm-error').forEach((e) => e.classList.add('hidden'));
  }

  /** Restores every setting (including Manual OFF) and tells the app to rebuild the metrics. */
  resetDefaults() {
    this.settings = defaultMissionSettings();
    this._renderSettingsIntoInputs();
    this._syncManualUi();
    this.callbacks.onSettingsChange?.(this.settings, 'reset');
    this.callbacks.onManualChange?.(this.getManualPanel());
    this._refreshDerived();
  }

  // ---------------------------------------------------------------------------------------------
  // Manual panel
  // ---------------------------------------------------------------------------------------------
  /** Turning Manual ON pre-fills tilt/azimuth with the current best fixed values. */
  setManual(on) {
    const m = this.settings.manual;
    if (on && !m.on) {
      if (this.metrics) Object.assign(m, manualFromBestFixed(this.metrics.bestFixed));
      else m.on = true;
      this._renderSettingsIntoInputs();
    } else if (!on) {
      m.on = false;
    }
    this._syncManualUi();
    this._manualChanged();
  }

  /** { tiltDeg, azimuthDeg } while Manual is ON, otherwise null (= use the best fixed panel). */
  getManualPanel() {
    const m = this.settings.manual;
    return m.on ? { tiltDeg: m.tiltDeg, azimuthDeg: m.azimuthDeg } : null;
  }

  _syncManualUi() {
    const m = this.settings.manual;
    const sw = this.$('mm-manual-switch');
    if (sw) {
      sw.setAttribute('aria-checked', String(m.on));
      sw.textContent = m.on ? 'ON' : 'OFF';
      sw.className = m.on
        ? 'px-2.5 py-1 rounded-lg border border-emerald-500/60 bg-emerald-950/60 text-emerald-200 text-[10px] font-bold transition-colors'
        : 'px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-800 text-slate-400 text-[10px] font-bold transition-colors';
    }
    for (const id of ['mm-in-tilt', 'mm-in-az']) {
      const el = this.$(id);
      if (el) el.disabled = !m.on;
    }
    this.$('mm-chart-wrap')?.classList.toggle('hidden', !m.on);
    if (m.on) this._ensureChart();
  }

  _manualChanged() {
    this._refreshChartData();
    this._refreshPanelConfigLabel();
    this.callbacks.onManualChange?.(this.getManualPanel());
  }

  _ensureChart() {
    if (this.chart) { this.chart.resize(); return; }
    const canvas = this.$('mm-power-canvas');
    if (!canvas || !canvas.getContext || !canvas.getContext('2d')) return;
    this.chart = new PowerComparisonChart(canvas, {
      onSeek: (days) => this.callbacks.onSeekDays?.(days),
    });
    this._refreshChartData();
  }

  _refreshChartData() {
    if (!this.settings.manual.on || !this.metrics) return;
    const m = this.settings.manual;
    const cmp = compareYourSettingToBest(this.metrics, m.tiltDeg, m.azimuthDeg);
    this._setLegend(cmp);
    if (this.chart) {
      this.chart.setData({
        spanDays: this.metrics.window.days,
        dtHours: this.metrics.window.dtHours,
        yourSeriesW: cmp.yourSeriesW,
        bestSeriesW: cmp.bestSeriesW,
      });
      this.chart.setCursor(this.lastElapsedDays);
    }
  }

  _setLegend(cmp) {
    const el = this.$('mm-chart-legend');
    if (!el) return;
    el.innerHTML = `
      <span class="flex items-center gap-1" style="color:${POWER_CHART_COLORS.yours}"><span class="inline-block w-3 h-[3px]" style="background:${POWER_CHART_COLORS.yours}"></span>Your setting: ${formatEnergy(cmp.yourEnergyWh)}</span>
      <span class="flex items-center gap-1" style="color:${POWER_CHART_COLORS.best}"><span class="inline-block w-3 h-[3px]" style="background:${POWER_CHART_COLORS.best}"></span>Best possible: ${formatEnergy(cmp.bestEnergyWh)}</span>
      <span class="text-slate-300 font-bold">${fmt(cmp.percentOfBest, 1)}%</span>`;
  }

  _refreshPanelConfigLabel() {
    const m = this.settings.manual;
    if (m.on) this._setText('mm-panel-config', `Manual ${m.tiltDeg.toFixed(0)}° / ${m.azimuthDeg.toFixed(0)}°`);
    else if (this.metrics) this._setText('mm-panel-config', `Best fixed ${this.metrics.bestFixed.beta}° / ${this.metrics.bestFixed.az}°`);
    else this._setText('mm-panel-config', 'Best fixed panel');
  }

  // ---------------------------------------------------------------------------------------------
  // Data in
  // ---------------------------------------------------------------------------------------------
  /** Window statistics + best fixed panel + battery sizing. Call only when the cached metrics object changes. */
  setMetrics(metrics) {
    this.metrics = metrics;
    if (!metrics) return;
    const w = metrics.window;
    this._setText('mm-window-label', formatWindowLine(w));
    this._setText('mm-comm-hours', `${fmt(metrics.commHours, 1)} h (${fmt(metrics.commPercent, 1)}%)`);
    this._setText('mm-longest-contact', formatHours(metrics.longestContactHours, metrics.longestContactTouchesStart || metrics.longestContactTouchesEnd));
    this._setText('mm-lit-pct', `${fmt(metrics.litPercent, 1)}%`);
    this._setText('mm-lit-hours', `${fmt(metrics.totalLitHours, 1)} h`);
    this._setText('mm-longest-dark', formatHours(metrics.longestDarkHours, metrics.longestDarkTouchesStart || metrics.longestDarkTouchesEnd));
    this._setText('mm-energy', formatEnergy(metrics.energyWh));
    this._setText('mm-best-panel', `${metrics.bestFixed.beta}° / ${metrics.bestFixed.az}°`);
    this._refreshDerived();
    this._refreshChartData();
    this._refreshPanelConfigLabel();
  }

  /** Battery numbers: depend on the longest dark interval and the battery inputs only. */
  _refreshDerived() {
    const m = this.metrics;
    if (!m) return;
    const s = this.settings;
    const lowerBound = m.longestDarkTouchesStart || m.longestDarkTouchesEnd;
    const req = batteryRequiredCapacityWh(s.pBaseW, s.pHeaterW, m.longestDarkHours, s.depthOfDischarge);
    const surv = batterySurvivalHours(s.batteryCapacityWh, s.depthOfDischarge, s.pBaseW, s.pHeaterW);
    this._setText('mm-batt-required', `${lowerBound ? '≥ ' : ''}${formatEnergy(req)}`);
    this._setText('mm-batt-survival', Number.isFinite(surv) ? `${fmt(surv, 1)} h` : '∞');
    const load = s.pBaseW + s.pHeaterW;
    const covers = Number.isFinite(surv) && surv >= m.longestDarkHours;
    this._setText('mm-batt-note',
      `C = (P_base + P_heater) · longest dark / DoD = ${fmt(load, 0)} W · ${fmt(m.longestDarkHours, 1)} h / ${fmt(s.depthOfDischarge, 2)}. `
      + `A ${fmt(s.batteryCapacityWh, 0)} Wh battery lasts ${Number.isFinite(surv) ? fmt(surv, 1) + ' h' : 'indefinitely'} at ${fmt(load, 0)} W `
      + `(${covers ? 'covers' : 'does NOT cover'} the longest dark interval).`);
  }

  /**
   * Cheap per-tick readout (a few text nodes + one chart cursor redraw).
   * @param {Object} inst result of instantMetrics()
   * @param {number} elapsedDays days since the window start (the sim epoch)
   */
  updateInstant(inst, elapsedDays) {
    this.lastElapsedDays = elapsedDays;
    this._setText('mm-now-label', `T+ ${fmt(elapsedDays, 2)} d`);
    if (inst) {
      this._setText('mm-pgen', fmt(inst.powerW, 0));
      this._setText('mm-cos', fmt(inst.cosIncidence, 3));
      this._setText('mm-solar', fmt(inst.solarIntensityWm2, 0));
      this._setText('mm-dearth', fmt(inst.earthDistanceKm, 0));
      this._setText('mm-fspl', fmt(inst.fsplDb, 1));
      this._setText('mm-lit', inst.illuminated ? 'LIT' : 'DARK');
      const litEl = this.$('mm-lit');
      if (litEl) litEl.className = `${inst.illuminated ? 'text-amber-300' : 'text-slate-400'} font-bold text-[12px] tabular-nums`;
    }
    if (this.chart && this.settings.manual.on) this.chart.setCursor(elapsedDays);
  }
}
