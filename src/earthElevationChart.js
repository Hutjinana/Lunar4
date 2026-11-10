/**
 * Artemis Lunar Landing Site Navigator - Earth Elevation & Libration Line Chart
 * 
 * Round 9 Scientific Implementation:
 * 1. Pure HTML5 Canvas line chart with zero external charting dependencies.
 * 2. Visualizes topocentric Earth elevation θ⊕(t) and local terrain horizon elevation θmask,⊕(t)
 *    for the selected candidate region across the chosen simulation span [0, spanDays].
 * 3. Highlights the ~27.2–27.5-day draconic / nodical libration cycle of Earth's apparent elevation.
 * 4. Displays shaded band where Earth is directly visible (θ⊕ > θmask,⊕, unblocked fraction f⊕ > 0).
 * 5. Interactive seeking: clicking or dragging on the canvas immediately seeks simulation time.
 * 6. Synchronized vertical cursor with live telemetry readouts.
 */

import { computeEphemeris, computeTopocentricHorizon } from './ephemeris.js';
import { getRegionHorizonProfile, sampleHorizonMask, DEFAULT_HORIZON_RANGE_KM, DEFAULT_MAST_HEIGHT_M } from './horizon.js';
import { getElevationAt } from './terrain.js';
import { CONFIG } from '../config.js';

export class EarthElevationChart {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.onSeek = options.onSeek || null;

    this.region = null;
    this.baseEpoch = new Date();
    this.spanDays = 30;
    this.elapsedDays = 0;
    this.mastHeightM = DEFAULT_MAST_HEIGHT_M; // Navigator mast height (Advanced setting); Comparison is unaffected

    this.samples = []; // [{ day, date, earthElevDeg, earthMaskDeg, earthAzimDeg, isVisible }]
    this.isDragging = false;
    this.hoverPos = null;

    // Chart Layout Margins
    this.margin = {
      top: 32,
      right: 36,
      bottom: 34,
      left: 48,
    };

    this._bindEvents();
    this.resize();
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement ? this.canvas.parentElement.getBoundingClientRect() : this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const displayWidth = Math.max(300, rect.width || 600);
    const displayHeight = Math.max(160, rect.height || 220);

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

  _bindEvents() {
    const getChartXToDay = (clientX) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = clientX - rect.left;
      const plotLeft = this.margin.left;
      const plotWidth = this.width - this.margin.left - this.margin.right;

      const frac = Math.max(0, Math.min(1, (mouseX - plotLeft) / plotWidth));
      return frac * this.spanDays;
    };

    const handlePointerDown = (e) => {
      this.isDragging = true;
      const day = getChartXToDay(e.clientX);
      if (this.onSeek) {
        this.onSeek(day);
      }
      this.setCursor(day);
    };

    const handlePointerMove = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.hoverPos = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      if (this.isDragging) {
        const day = getChartXToDay(e.clientX);
        if (this.onSeek) {
          this.onSeek(day);
        }
        this.setCursor(day);
      } else {
        this.render();
      }
    };

    const handlePointerUp = () => {
      this.isDragging = false;
    };

    const handlePointerLeave = () => {
      this.isDragging = false;
      this.hoverPos = null;
      this.render();
    };

    this.canvas.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    this.canvas.addEventListener('pointerleave', handlePointerLeave);
  }

  /**
   * Generates or refreshes time-series dataset for active candidate region
   */
  setData(region, baseEpoch, spanDays = 30) {
    if (!region) return;
    this.region = region;
    this.baseEpoch = baseEpoch || new Date();
    this.spanDays = spanDays;

    const elevKm = getElevationAt(region.lat, region.lon);
    const horizon = getRegionHorizonProfile(region.id, region.lat, region.lon, DEFAULT_HORIZON_RANGE_KM, this.mastHeightM);

    // Number of plot sample points (~200 to 300 gives fine curve resolution without delay)
    const numSamples = Math.min(360, Math.max(120, Math.round(spanDays * 3)));
    const dtDays = spanDays / numSamples;
    const startMs = this.baseEpoch.getTime();

    this.samples = [];

    for (let i = 0; i <= numSamples; i++) {
      const day = i * dtDays;
      const tDate = new Date(startMs + day * 86400 * 1000);
      const ephem = computeEphemeris(tDate);

      // Topocentric Earth elevation and azimuth
      const earthTopo = computeTopocentricHorizon(
        region.lat,
        region.lon,
        ephem.subEarthLat,
        ephem.subEarthLon,
        ephem.earthDistanceKm,
        elevKm
      );

      // Horizon mask elevation at that azimuth
      const earthMaskDeg = sampleHorizonMask(horizon, earthTopo.azimuthDeg);
      const isVisible = earthTopo.elevationDeg > earthMaskDeg;

      this.samples.push({
        day,
        date: tDate,
        earthElevDeg: earthTopo.elevationDeg,
        earthMaskDeg,
        earthAzimDeg: earthTopo.azimuthDeg,
        isVisible,
      });
    }

    this.render();
  }

  setCursor(elapsedDays) {
    this.elapsedDays = Math.max(0, Math.min(this.spanDays, elapsedDays));
    this.render();
  }

  render() {
    if (!this.ctx || !this.width || !this.height) return;

    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const m = this.margin;

    ctx.clearRect(0, 0, w, h);

    // 1. Chart Background
    ctx.fillStyle = '#07090E';
    ctx.fillRect(0, 0, w, h);

    const plotX = m.left;
    const plotY = m.top;
    const plotW = w - m.left - m.right;
    const plotH = h - m.top - m.bottom;

    if (plotW <= 0 || plotH <= 0 || this.samples.length < 2) return;

    // 2. Compute Elevation Y Bounds (Auto-range with headroom, always showing zero)
    let minElev = -6.0;
    let maxElev = 8.0;

    this.samples.forEach((s) => {
      if (s.earthElevDeg < minElev) minElev = Math.floor(s.earthElevDeg - 1);
      if (s.earthElevDeg > maxElev) maxElev = Math.ceil(s.earthElevDeg + 1);
      if (s.earthMaskDeg < minElev) minElev = Math.floor(s.earthMaskDeg - 1);
      if (s.earthMaskDeg > maxElev) maxElev = Math.ceil(s.earthMaskDeg + 1);
    });

    const elevRange = maxElev - minElev || 1;

    // Coordinate mapping helpers
    const getX = (day) => plotX + (day / this.spanDays) * plotW;
    const getY = (elevDeg) => plotY + plotH - ((elevDeg - minElev) / elevRange) * plotH;

    // 3. Horizontal Grid Lines & Elevation Labels (every 2° or 4°)
    const elevStep = elevRange > 18 ? 4 : 2;
    const startGridElev = Math.ceil(minElev / elevStep) * elevStep;

    ctx.lineWidth = 1;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let el = startGridElev; el <= maxElev; el += elevStep) {
      const y = getY(el);
      if (y < plotY || y > plotY + plotH) continue;

      const isZero = Math.abs(el) < 0.01;
      ctx.strokeStyle = isZero ? '#475569' : '#1E293B';
      ctx.beginPath();
      ctx.moveTo(plotX, y);
      ctx.lineTo(plotX + plotW, y);
      ctx.stroke();

      ctx.fillStyle = isZero ? '#94A3B8' : '#64748B';
      ctx.fillText(`${el >= 0 ? '+' : ''}${el}°`, plotX - 6, y);
    }

    // 4. Vertical Time Grid Lines (e.g. every 7 days or ~27.3 days)
    const timeStepDays = this.spanDays <= 35 ? 7 : this.spanDays <= 100 ? 14 : 30;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#64748B';
    ctx.strokeStyle = '#1E293B';

    for (let d = 0; d <= this.spanDays; d += timeStepDays) {
      const x = getX(d);
      ctx.beginPath();
      ctx.moveTo(x, plotY);
      ctx.lineTo(x, plotY + plotH);
      ctx.stroke();

      ctx.fillText(`T+${d}d`, x, plotY + plotH + 6);
    }

    // 5. Draw Shaded Visibility Band (where Earth elevation > horizon mask)
    ctx.save();
    ctx.beginPath();
    ctx.rect(plotX, plotY, plotW, plotH);
    ctx.clip();

    for (let i = 0; i < this.samples.length - 1; i++) {
      const s0 = this.samples[i];
      const s1 = this.samples[i + 1];

      // If either point has Earth above horizon, shade trapezoid
      const e0 = s0.earthElevDeg;
      const m0 = s0.earthMaskDeg;
      const e1 = s1.earthElevDeg;
      const m1 = s1.earthMaskDeg;

      if (e0 > m0 || e1 > m1) {
        const x0 = getX(s0.day);
        const x1 = getX(s1.day);
        const yE0 = getY(Math.max(e0, m0));
        const yM0 = getY(m0);
        const yE1 = getY(Math.max(e1, m1));
        const yM1 = getY(m1);

        const grad = ctx.createLinearGradient(0, yE0, 0, yM0);
        grad.addColorStop(0, 'rgba(6, 182, 212, 0.25)');
        grad.addColorStop(1, 'rgba(6, 182, 212, 0.04)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(x0, yM0);
        ctx.lineTo(x0, yE0);
        ctx.lineTo(x1, yE1);
        ctx.lineTo(x1, yM1);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();

    // 6. Draw Local Horizon Profile Line θmask,⊕(t) (Amber / Slate Line)
    ctx.save();
    ctx.beginPath();
    ctx.rect(plotX, plotY, plotW, plotH);
    ctx.clip();

    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    this.samples.forEach((s, idx) => {
      const x = getX(s.day);
      const y = getY(s.earthMaskDeg);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // 7. Draw Earth Elevation Curve θ⊕(t) (Bright Cyan Line, 2.5px)
    ctx.save();
    ctx.beginPath();
    ctx.rect(plotX, plotY, plotW, plotH);
    ctx.clip();

    ctx.strokeStyle = '#06B6D4';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    this.samples.forEach((s, idx) => {
      const x = getX(s.day);
      const y = getY(s.earthElevDeg);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();

    // 8. Outer Plot Border
    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 1;
    ctx.strokeRect(plotX, plotY, plotW, plotH);

    // 9. Current Simulation Time Cursor (Vertical Amber Line & Point Marker)
    const cursorX = getX(this.elapsedDays);
    if (cursorX >= plotX && cursorX <= plotX + plotW) {
      // Find interpolated current sample values
      const curFrac = this.elapsedDays / this.spanDays;
      const sampleIdxFloat = curFrac * (this.samples.length - 1);
      const idx0 = Math.floor(sampleIdxFloat);
      const idx1 = Math.min(this.samples.length - 1, idx0 + 1);
      const f = sampleIdxFloat - idx0;

      const curElev = this.samples[idx0].earthElevDeg * (1 - f) + this.samples[idx1].earthElevDeg * f;
      const curMask = this.samples[idx0].earthMaskDeg * (1 - f) + this.samples[idx1].earthMaskDeg * f;
      const curY = getY(curElev);
      const isCurVisible = curElev > curMask;

      // Vertical cursor line
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cursorX, plotY);
      ctx.lineTo(cursorX, plotY + plotH);
      ctx.stroke();

      // Earth dot marker
      ctx.fillStyle = isCurVisible ? '#06B6D4' : '#F43F5E';
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cursorX, curY, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Top Tag Badge
      const badgeText = `T+${this.elapsedDays.toFixed(1)}d: θ⊕ = ${curElev >= 0 ? '+' : ''}${curElev.toFixed(1)}° (${isCurVisible ? 'CLEAR' : 'BLOCKED'})`;
      ctx.font = '10px "JetBrains Mono", monospace';
      const textW = ctx.measureText(badgeText).width + 12;
      const badgeX = Math.max(plotX + 6, Math.min(plotX + plotW - textW - 6, cursorX - textW / 2));

      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.strokeStyle = isCurVisible ? '#06B6D4' : '#F43F5E';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(badgeX, plotY - 22, textW, 18, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, badgeX + 6, plotY - 13);
    }

    // 10. Title, Legend & Libration Annotation
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.font = 'bold 11px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(`${this.region?.name || 'Selected Region'} · Direct-to-Earth Elevation`, plotX, plotY - 10);

    // Legend
    const legendX = plotX + plotW - 200;
    ctx.font = '10px "JetBrains Mono", monospace';

    // Earth curve legend
    ctx.fillStyle = '#06B6D4';
    ctx.fillRect(legendX, plotY - 16, 12, 3);
    ctx.fillStyle = '#94A3B8';
    ctx.fillText('θ⊕ (Earth)', legendX + 16, plotY - 10);

    // Horizon mask legend
    ctx.fillStyle = '#F59E0B';
    ctx.fillRect(legendX + 90, plotY - 16, 12, 3);
    ctx.fillStyle = '#94A3B8';
    ctx.fillText('θmask (Horizon)', legendX + 106, plotY - 10);

    // Libration notice badge
    ctx.fillStyle = '#64748B';
    ctx.font = '9.5px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText('~27.3d Libration Cycle', plotX + plotW - 4, plotY + plotH - 6);
  }
}
