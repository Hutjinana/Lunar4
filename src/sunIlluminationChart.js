/**
 * Phase 11 - Sun Illumination chart: alpha_sun(t) against the local horizon mask theta_horizon(az_sun(t)).
 *
 * Same visual style as EarthElevationChart (Canvas 2D, dark background, slate grid, JetBrains Mono labels, amber time
 * cursor, click/drag to seek simTime). It only draws data it is handed: the per-sample Sun elevation/azimuth and the
 * binary centre-point illumination I(t) already cached by missionMetrics.js, so it never touches the ephemeris and
 * can be redrawn on every time tick.
 *
 * Lit rule (identical to missionMetrics.sunIlluminated): I(t) = 1 when alpha_sun > theta_horizon(az_sun).
 */

import { sampleHorizonMask } from './horizon.js';
import { chartXToDay } from './powerChart.js';

export const SUN_CHART_COLORS = {
  sun: '#FDE047', // alpha_sun(t)
  mask: '#94A3B8', // theta_horizon(az_sun(t))
  lit: 'rgba(250, 204, 21, 0.16)', // shaded lit intervals
  dark: 'rgba(15, 23, 42, 0.0)',
};

/**
 * Per-sample series for the chart, derived from cached geometry (no ephemeris, no horizon rebuild).
 * @param {{n:number, sunEl:ArrayLike<number>, sunAz:ArrayLike<number>, illum:ArrayLike<number>, horizonProfile:ArrayLike<number>}} geom
 * @returns {{sunEl:Float64Array, maskDeg:Float64Array, lit:Uint8Array}} lit[i] = 1 where alpha_sun > mask (= I(t))
 */
export function sunIlluminationSeries(geom) {
  const n = geom.n;
  const sunEl = new Float64Array(n);
  const maskDeg = new Float64Array(n);
  const lit = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    sunEl[i] = geom.sunEl[i];
    maskDeg[i] = sampleHorizonMask(geom.horizonProfile, geom.sunAz[i]);
    lit[i] = sunEl[i] > maskDeg[i] ? 1 : 0;
  }
  return { sunEl, maskDeg, lit };
}

/** Runs of consecutive lit samples as [startIndex, endIndexExclusive) pairs (used to shade the chart). */
export function litIntervals(lit) {
  const runs = [];
  let start = -1;
  for (let i = 0; i < lit.length; i++) {
    if (lit[i] && start < 0) start = i;
    else if (!lit[i] && start >= 0) { runs.push([start, i]); start = -1; }
  }
  if (start >= 0) runs.push([start, lit.length]);
  return runs;
}

export class SunIlluminationChart {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.onSeek = options.onSeek || null;

    this.spanDays = 29.530588;
    this.series = null; // { sunEl, maskDeg, lit }
    this.regionName = '';
    this.elapsedDays = 0;
    this.isDragging = false;

    this.margin = { top: 26, right: 14, bottom: 26, left: 44 };
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

  /** @param {{spanDays:number, series:{sunEl:ArrayLike<number>, maskDeg:ArrayLike<number>, lit:ArrayLike<number>}, regionName?:string}} data */
  setData(data) {
    this.spanDays = data.spanDays;
    this.series = data.series;
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

    const s = this.series;
    const plotX = m.left, plotY = m.top;
    const plotW = w - m.left - m.right, plotH = h - m.top - m.bottom;
    if (plotW <= 0 || plotH <= 0 || !s || s.sunEl.length < 2) return;
    const n = s.sunEl.length;

    // Y range: always show 0 deg, auto-expand to the data (Sun swings about +/-1.5 deg, mask can be several deg)
    let minEl = -3, maxEl = 4;
    for (let i = 0; i < n; i++) {
      minEl = Math.min(minEl, Math.floor(s.sunEl[i] - 0.5), Math.floor(s.maskDeg[i] - 0.5));
      maxEl = Math.max(maxEl, Math.ceil(s.sunEl[i] + 0.5), Math.ceil(s.maskDeg[i] + 0.5));
    }
    const range = maxEl - minEl || 1;
    const getX = (day) => plotX + (day / this.spanDays) * plotW;
    const getXi = (i) => plotX + ((i + 0.5) / n) * plotW;
    const getY = (deg) => plotY + plotH - ((deg - minEl) / range) * plotH;

    // Horizontal grid + degree labels
    const step = range > 14 ? 4 : range > 8 ? 2 : 1;
    ctx.lineWidth = 1;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let el = Math.ceil(minEl / step) * step; el <= maxEl; el += step) {
      const y = getY(el);
      const isZero = el === 0;
      ctx.strokeStyle = isZero ? '#475569' : '#1E293B';
      ctx.beginPath(); ctx.moveTo(plotX, y); ctx.lineTo(plotX + plotW, y); ctx.stroke();
      ctx.fillStyle = isZero ? '#94A3B8' : '#64748B';
      ctx.fillText(`${el >= 0 ? '+' : ''}${el}°`, plotX - 5, y);
    }

    // Vertical day grid
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

    // Shaded lit intervals (I(t) = 1), full plot height
    ctx.fillStyle = SUN_CHART_COLORS.lit;
    for (const [a, b] of litIntervals(s.lit)) {
      const x0 = plotX + (a / n) * plotW;
      const x1 = plotX + (b / n) * plotW;
      ctx.fillRect(x0, plotY, Math.max(1, x1 - x0), plotH);
    }

    // theta_horizon(az_sun(t)) dashed, alpha_sun(t) solid
    const stroke = (arr, color, width, dash) => {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round';
      ctx.setLineDash(dash);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = getXi(i), y = getY(arr[i]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };
    stroke(s.maskDeg, SUN_CHART_COLORS.mask, 1.5, [4, 3]);
    stroke(s.sunEl, SUN_CHART_COLORS.sun, 2.25, []);
    ctx.restore();

    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 1;
    ctx.strokeRect(plotX, plotY, plotW, plotH);

    // Current simTime cursor
    if (this.elapsedDays >= 0 && this.elapsedDays <= this.spanDays) {
      const cx = getX(this.elapsedDays);
      const idx = Math.min(n - 1, Math.max(0, Math.floor((this.elapsedDays / this.spanDays) * n)));
      const isLit = s.lit[idx] === 1;
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cx, plotY); ctx.lineTo(cx, plotY + plotH); ctx.stroke();
      ctx.fillStyle = isLit ? SUN_CHART_COLORS.sun : '#F43F5E';
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, getY(s.sunEl[idx]), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }

    // Title + legend
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.font = 'bold 11px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(`${this.regionName || 'Selected region'} · Sun vs horizon`, plotX, plotY - 8);

    ctx.font = '10px "JetBrains Mono", monospace';
    const lx = plotX + plotW - 218;
    ctx.fillStyle = SUN_CHART_COLORS.sun; ctx.fillRect(lx, plotY - 15, 12, 3);
    ctx.fillStyle = '#94A3B8'; ctx.fillText('α☉ (Sun)', lx + 16, plotY - 8);
    ctx.fillStyle = SUN_CHART_COLORS.mask; ctx.fillRect(lx + 82, plotY - 15, 12, 3);
    ctx.fillStyle = '#94A3B8'; ctx.fillText('θhorizon(az☉)', lx + 98, plotY - 8);
  }
}
