/**
 * Phase 9 - "Your setting vs Best possible" P_gen(t) line chart.
 *
 * Pure HTML5 Canvas 2D, same visual style as EarthElevationChart (dark background, slate grid,
 * JetBrains Mono labels, amber time cursor, click/drag to seek simTime).
 *
 * The chart only draws data it is handed (cached sun/horizon-based power series); it never touches the
 * ephemeris or the horizon, so it can be redrawn on every input change and every time tick.
 */

export const POWER_CHART_COLORS = {
  best: '#10B981', // emerald: Best possible (best fixed tilt/azimuth)
  yours: '#F59E0B', // amber: Your setting (Manual panel)
};

/** Smallest "nice" axis maximum (1, 2, 2.5, 5 x 10^k) that is >= v. Returns 1 for non-positive input. */
export function niceCeil(v) {
  if (!(v > 0)) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const f = v / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * base;
}

/** Maps a pointer x (px, relative to the canvas) to elapsed days inside [0, spanDays]. */
export function chartXToDay(x, plotLeft, plotWidth, spanDays) {
  if (!(plotWidth > 0)) return 0;
  const frac = Math.max(0, Math.min(1, (x - plotLeft) / plotWidth));
  return frac * spanDays;
}

export class PowerComparisonChart {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.onSeek = options.onSeek || null;

    this.spanDays = 29.530588;
    this.dtHours = 0.5;
    this.yourSeriesW = null;
    this.bestSeriesW = null;
    this.elapsedDays = 0;
    this.isDragging = false;

    this.margin = { top: 12, right: 12, bottom: 26, left: 46 };
    this._bindEvents();
    this.resize();
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement ? this.canvas.parentElement.getBoundingClientRect() : this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const displayWidth = Math.max(240, rect.width || 360);
    const displayHeight = Math.max(140, rect.height || 170);

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
    this.canvas.addEventListener('pointerleave', () => { /* keep dragging outside the canvas via window listeners */ });
  }

  /**
   * @param {{spanDays:number, dtHours:number, yourSeriesW:ArrayLike<number>, bestSeriesW:ArrayLike<number>}} data
   */
  setData(data) {
    this.spanDays = data.spanDays;
    this.dtHours = data.dtHours;
    this.yourSeriesW = data.yourSeriesW;
    this.bestSeriesW = data.bestSeriesW;
    this.render();
  }

  setCursor(elapsedDays) {
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

    const plotX = m.left, plotY = m.top;
    const plotW = w - m.left - m.right, plotH = h - m.top - m.bottom;
    const best = this.bestSeriesW, yours = this.yourSeriesW;
    if (plotW <= 0 || plotH <= 0 || !best || !yours || best.length < 2) return;

    let maxP = 0;
    for (let i = 0; i < best.length; i++) {
      if (best[i] > maxP) maxP = best[i];
      if (yours[i] > maxP) maxP = yours[i];
    }
    const yMax = niceCeil(maxP * 1.05);
    const n = best.length;
    const getX = (day) => plotX + (day / this.spanDays) * plotW;
    const getXi = (i) => plotX + ((i + 0.5) / n) * plotW; // sample i covers [i, i+1) * dt
    const getY = (p) => plotY + plotH - (p / yMax) * plotH;

    // Horizontal grid + W labels
    ctx.lineWidth = 1;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let k = 0; k <= 4; k++) {
      const p = (yMax * k) / 4;
      const y = getY(p);
      ctx.strokeStyle = k === 0 ? '#475569' : '#1E293B';
      ctx.beginPath(); ctx.moveTo(plotX, y); ctx.lineTo(plotX + plotW, y); ctx.stroke();
      ctx.fillStyle = '#64748B';
      ctx.fillText(`${Math.round(p)} W`, plotX - 5, y);
    }

    // Vertical day grid (every 7 days)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let d = 0; d <= this.spanDays; d += 7) {
      const x = getX(d);
      ctx.strokeStyle = '#1E293B';
      ctx.beginPath(); ctx.moveTo(x, plotY); ctx.lineTo(x, plotY + plotH); ctx.stroke();
      ctx.fillStyle = '#64748B';
      ctx.fillText(`T+${d}d`, x, plotY + plotH + 6);
    }

    // Best possible: filled area + line, then Your setting on top
    ctx.save();
    ctx.beginPath(); ctx.rect(plotX, plotY, plotW, plotH); ctx.clip();

    ctx.fillStyle = 'rgba(16, 185, 129, 0.10)';
    ctx.beginPath();
    ctx.moveTo(getXi(0), getY(0));
    for (let i = 0; i < n; i++) ctx.lineTo(getXi(i), getY(best[i]));
    ctx.lineTo(getXi(n - 1), getY(0));
    ctx.closePath();
    ctx.fill();

    const stroke = (series, color, width) => {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = getXi(i), y = getY(series[i]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    stroke(best, POWER_CHART_COLORS.best, 1.75);
    stroke(yours, POWER_CHART_COLORS.yours, 1.75);
    ctx.restore();

    ctx.strokeStyle = '#1E293B';
    ctx.strokeRect(plotX, plotY, plotW, plotH);

    // Current simTime cursor (only inside the evaluation window)
    if (this.elapsedDays >= 0 && this.elapsedDays <= this.spanDays) {
      const cx = getX(this.elapsedDays);
      const idx = Math.min(n - 1, Math.max(0, Math.floor((this.elapsedDays / this.spanDays) * n)));
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cx, plotY); ctx.lineTo(cx, plotY + plotH); ctx.stroke();
      const dot = (p, color) => {
        ctx.fillStyle = color; ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cx, getY(p), 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      };
      dot(best[idx], POWER_CHART_COLORS.best);
      dot(yours[idx], POWER_CHART_COLORS.yours);
    }
  }
}
