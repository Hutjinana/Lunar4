/**
 * Solar-panel output graph: a line chart of the power P_gen(t) (W) the solar cell produces at each time step of the
 * mission window (the energy produced in a step is P_gen * dt, so the area under the line is the energy E).
 *
 * Same style as the other charts (Canvas 2D, click/drag to seek simTime). It only draws arrays it is handed (the cached
 * best-fixed P_gen series, or the Manual panel series built from the same cached sun geometry), so it never touches the
 * ephemeris or the horizon. The cumulative helpers below stay exported for the "E so far" / "E window" readouts; the
 * final cumulative value equals missionMetrics.integrateEnergyWh().
 */

import { chartXToDay, niceCeil } from './powerChart.js';

export const ENERGY_CHART_COLORS = {
  active: '#10B981', // P_gen(t) line of the active panel (best fixed, or Manual when ON)
  best: '#64748B', // best fixed P_gen(t), drawn as a dashed reference only while Manual is ON
};

/**
 * Cumulative energy in Wh at the END of each sample: cum[i] = dt * sum_{k<=i} P[k].
 * cum[n-1] equals integrateEnergyWh(P, dt).
 */
export function cumulativeEnergySeriesWh(powerSeriesW, dtHours) {
  const out = new Float64Array(powerSeriesW.length);
  let sum = 0;
  for (let i = 0; i < powerSeriesW.length; i++) {
    sum += powerSeriesW[i] * dtHours;
    out[i] = sum;
  }
  return out;
}

/**
 * Energy generated from the window start to `elapsedDays` (Wh), linearly inside the current sample.
 * Samples are dt-wide intervals starting at i * dt (the same convention integrateEnergyWh uses).
 */
export function cumulativeEnergyAtWh(cumWh, powerSeriesW, dtHours, elapsedDays) {
  const n = cumWh.length;
  if (n === 0 || !(elapsedDays > 0)) return 0;
  const pos = (elapsedDays * 24) / dtHours;
  if (pos >= n) return cumWh[n - 1];
  const i = Math.floor(pos);
  const before = i > 0 ? cumWh[i - 1] : 0;
  return before + powerSeriesW[i] * dtHours * (pos - i);
}

export class PanelEnergyChart {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.onSeek = options.onSeek || null;

    this.spanDays = 29.530588;
    this.dtHours = 0.5;
    this.powerW = null; // active panel P_gen(t)
    this.bestPowerW = null; // best fixed P_gen(t), only while Manual is ON
    this.regionName = '';
    this.elapsedDays = 0;
    this.isDragging = false;

    this.margin = { top: 26, right: 16, bottom: 26, left: 52 };
    this._bindEvents();
    this.resize();
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement ? this.canvas.parentElement.getBoundingClientRect() : this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const displayWidth = Math.max(300, rect.width || 600);
    const displayHeight = Math.max(120, rect.height || 150);

    this.canvas.width = displayWidth * dpr;
    this.canvas.height = displayHeight * dpr;
    this.canvas.style.width = `${displayWidth}px`;
    this.canvas.style.height = `${displayHeight}px`;
    this.ctx.resetTransform?.();
    this.ctx.scale(dpr, dpr);
    this.width = displayWidth;
    this.height = displayHeight;
    this.render();
  }

  _plotWidth() {
    return this.width - this.margin.left - this.margin.right;
  }

  _bindEvents() {
    const seekFromEvent = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const day = chartXToDay(e.clientX - rect.left, this.margin.left, this._plotWidth(), this.spanDays);
      this.onSeek?.(day);
      this.setCursor(day);
    };
    this.canvas.addEventListener('pointerdown', (e) => { this.isDragging = true; seekFromEvent(e); });
    window.addEventListener('pointermove', (e) => { if (this.isDragging) seekFromEvent(e); });
    window.addEventListener('pointerup', () => { this.isDragging = false; });
  }

  /**
   * @param {{spanDays:number, dtHours:number, powerW:ArrayLike<number>, bestPowerW?:ArrayLike<number>|null, regionName?:string}} data
   */
  setData(data) {
    this.spanDays = data.spanDays;
    this.dtHours = data.dtHours;
    this.powerW = data.powerW;
    this.bestPowerW = data.bestPowerW || null;
    this.regionName = data.regionName || '';
    this.render();
  }

  setCursor(elapsedDays) {
    if (elapsedDays === this.elapsedDays) return;
    this.elapsedDays = elapsedDays;
    this.render();
  }

  render() {
    if (!this.ctx || !this.width || !this.height) return;
    const ctx = this.ctx;
    const w = this.width, h = this.height, m = this.margin;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#07090E';
    ctx.fillRect(0, 0, w, h);

    const pw = this.powerW;
    const plotX = m.left, plotY = m.top;
    const plotW = w - m.left - m.right, plotH = h - m.top - m.bottom;
    if (plotW <= 0 || plotH <= 0 || !pw || pw.length < 2) return;
    const n = pw.length;

    let maxP = 0;
    for (let i = 0; i < n; i++) if (pw[i] > maxP) maxP = pw[i];
    if (this.bestPowerW) for (let i = 0; i < n; i++) if (this.bestPowerW[i] > maxP) maxP = this.bestPowerW[i];
    const pMax = niceCeil(maxP * 1.05);

    const getX = (day) => plotX + (day / this.spanDays) * plotW;
    const getYP = (p) => plotY + plotH - (p / pMax) * plotH;

    // Grid: left axis = power (W)
    ctx.lineWidth = 1;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textBaseline = 'middle';
    for (let k = 0; k <= 4; k++) {
      const y = plotY + plotH - (k / 4) * plotH;
      ctx.strokeStyle = k === 0 ? '#475569' : '#1E293B';
      ctx.beginPath(); ctx.moveTo(plotX, y); ctx.lineTo(plotX + plotW, y); ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillStyle = '#64748B';
      ctx.fillText(`${Math.round((pMax * k) / 4)} W`, plotX - 5, y);
    }

    const dayStep = this.spanDays <= 35 ? 7 : this.spanDays <= 100 ? 14 : 30;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let d = 0; d <= this.spanDays; d += dayStep) {
      const x = getX(d);
      ctx.strokeStyle = '#1E293B';
      ctx.beginPath(); ctx.moveTo(x, plotY); ctx.lineTo(x, plotY + plotH); ctx.stroke();
      ctx.fillStyle = '#64748B';
      ctx.fillText(`T+${d}d`, x, plotY + plotH + 6);
    }

    ctx.save();
    ctx.beginPath(); ctx.rect(plotX, plotY, plotW, plotH); ctx.clip();

    // P_gen(t) as a line: sample i covers [i, i+1) * dt, drawn at the middle of its interval
    const strokeLine = (arr, color, width, dash) => {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round';
      ctx.setLineDash(dash);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = plotX + ((i + 0.5) / n) * plotW;
        if (i === 0) ctx.moveTo(x, getYP(arr[i])); else ctx.lineTo(x, getYP(arr[i]));
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };
    if (this.bestPowerW) strokeLine(this.bestPowerW, ENERGY_CHART_COLORS.best, 1.5, [4, 3]);
    strokeLine(pw, ENERGY_CHART_COLORS.active, 1.75, []);
    ctx.restore();

    ctx.strokeStyle = '#1E293B';
    ctx.strokeRect(plotX, plotY, plotW, plotH);

    // Current simTime cursor with the P_gen marker
    if (this.elapsedDays >= 0 && this.elapsedDays <= this.spanDays) {
      const cx = getX(this.elapsedDays);
      const idx = Math.min(n - 1, Math.max(0, Math.floor((this.elapsedDays * 24) / this.dtHours)));
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cx, plotY); ctx.lineTo(cx, plotY + plotH); ctx.stroke();
      ctx.fillStyle = ENERGY_CHART_COLORS.active;
      ctx.strokeStyle = '#FFFFFF';
      ctx.beginPath(); ctx.arc(cx, getYP(pw[idx]), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }

    // Title + legend
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.font = 'bold 11px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(`${this.regionName || 'Selected region'} · Solar cell output`, plotX, plotY - 8);

    ctx.font = '10px "JetBrains Mono", monospace';
    let lx = plotX + plotW - (this.bestPowerW ? 190 : 110);
    ctx.fillStyle = ENERGY_CHART_COLORS.active; ctx.fillRect(lx, plotY - 15, 12, 3);
    ctx.fillStyle = '#94A3B8'; ctx.fillText('P_gen(t)', lx + 16, plotY - 8);
    lx += 80;
    if (this.bestPowerW) {
      ctx.fillStyle = ENERGY_CHART_COLORS.best; ctx.fillRect(lx, plotY - 15, 12, 3);
      ctx.fillStyle = '#94A3B8'; ctx.fillText('Best', lx + 16, plotY - 8);
    }
  }
}
