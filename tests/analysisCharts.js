/**
 * Phase 11 tests: Sun Illumination chart and solar-panel energy graph.
 * Pure helpers run everywhere; the drawers and toggles run against the real index.html in JSDOM (Node only).
 */
import { REGIONS } from '../regions.js';
import { getRegionHorizonProfile, AZIMUTH_BIN_COUNT } from '../src/horizon.js';
import { getElevationAt } from '../src/terrain.js';
import {
  computeRegionMissionMetrics, clearMissionMetricsCaches, integrateEnergyWh, panelPowerSeriesW,
} from '../src/missionMetrics.js';
import { comparisonStepMinutesForSpan } from '../src/comparisonEngine.js';
import { sunIlluminationSeries, litIntervals } from '../src/sunIlluminationChart.js';
import { cumulativeEnergySeriesWh, cumulativeEnergyAtWh } from '../src/panelEnergyChart.js';

export async function runAnalysisChartsTest() {
  const t0 = performance.now();
  const measurements = [];
  let passed = true;
  const check = (label, ok) => { if (!ok) passed = false; measurements.push(`${label} [${ok ? 'PASS' : 'FAIL'}]`); };
  const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

  // ---- Pure helpers ---------------------------------------------------------------------------------
  const runs = litIntervals([0, 1, 1, 0, 0, 1, 0, 1, 1]);
  check('litIntervals: runs incl. one touching the window end → [1,3) [5,6) [7,9)',
    JSON.stringify(runs) === '[[1,3],[5,6],[7,9]]' && litIntervals([1, 1, 1]).length === 1 && litIntervals([0, 0]).length === 0);

  const p = [10, 0, 20, 30];
  const cum = cumulativeEnergySeriesWh(p, 0.5);
  check('Cumulative energy: [10,0,20,30] W · 0.5 h → 5, 5, 15, 30 Wh (final = integrateEnergyWh)',
    [5, 5, 15, 30].every((v, i) => near(cum[i], v)) && near(cum[3], integrateEnergyWh(p, 0.5)));
  check('Energy at cursor: 0 d → 0, half-way through sample 2 → 5 + 5 = 10 Wh, past the end → total',
    cumulativeEnergyAtWh(cum, p, 0.5, 0) === 0 && near(cumulativeEnergyAtWh(cum, p, 0.5, 1.25 / 24), 10)
    && near(cumulativeEnergyAtWh(cum, p, 0.5, 99), 30));

  // ---- Real metrics ------------------------------------------------------------------------------------
  clearMissionMetricsCaches();
  const mal = REGIONS[2];
  const metrics = computeRegionMissionMetrics({
    regionId: mal.id, lat: mal.lat, lon: mal.lon, elevationKm: getElevationAt(mal.lat, mal.lon),
    horizonProfile: getRegionHorizonProfile(mal.id, mal.lat, mal.lon), startDate: new Date('2026-11-01T00:00:00Z'),
  });
  const g = metrics.geometry;
  const s = sunIlluminationSeries(g);
  let sameLit = true, litCount = 0;
  for (let i = 0; i < g.n; i++) { if (s.lit[i] !== g.illum[i]) sameLit = false; litCount += s.lit[i]; }
  check(`Sun chart lit flags equal the binary I(t) of missionMetrics at all ${g.n} samples (${litCount} lit)`, sameLit);
  check('Sun chart stats come from the Phase 6 results: lit % = lit samples / samples',
    near(metrics.litPercent, (100 * litCount) / g.n, 1e-9));
  const flat = new Float32Array(AZIMUTH_BIN_COUNT).fill(2);
  const fs2 = sunIlluminationSeries({ n: 3, sunEl: [1.9, 2.1, 5], sunAz: [0, 90, 180], illum: [0, 1, 1], horizonProfile: flat });
  check('Sun chart rule: α_sun > θ_horizon(az) is lit; equal-or-below is dark (flat 2° mask)',
    fs2.lit[0] === 0 && fs2.lit[1] === 1 && fs2.lit[2] === 1 && near(fs2.maskDeg[1], 2));

  const best = metrics.bestFixed;
  const cumBest = cumulativeEnergySeriesWh(best.series, g.dtHours);
  check(`Energy graph ends at the Mission Metrics energy: ${cumBest[cumBest.length - 1].toFixed(0)} Wh = ${metrics.energyWh.toFixed(0)} Wh`,
    near(cumBest[cumBest.length - 1], metrics.energyWh, 1e-6 * Math.max(1, metrics.energyWh)));
  let monotone = true;
  for (let i = 1; i < cumBest.length; i++) if (cumBest[i] < cumBest[i - 1]) monotone = false;
  const flatCum = cumulativeEnergySeriesWh(panelPowerSeriesW(g, 0, 0, 10, 0.29), g.dtHours);
  check('Cumulative energy never decreases; a flat 0°/0° panel ends at or below the best fixed panel',
    monotone && flatCum[flatCum.length - 1] <= cumBest[cumBest.length - 1] + 1e-6);

  // ---- Window follows the scrub span (30/90/180/365 d, Comparison step) ---------------------------------
  for (const span of [90, 365]) {
    const t1 = performance.now();
    const step = comparisonStepMinutesForSpan(span);
    const m = computeRegionMissionMetrics({
      regionId: mal.id, lat: mal.lat, lon: mal.lon, elevationKm: getElevationAt(mal.lat, mal.lon),
      horizonProfile: getRegionHorizonProfile(mal.id, mal.lat, mal.lon), startDate: new Date('2026-11-01T00:00:00Z'),
      windowDays: span, stepMinutes: step,
    });
    const c = cumulativeEnergySeriesWh(m.bestFixed.series, m.geometry.dtHours);
    check(`${span}-day span: ${m.window.samples} samples at ${step} min, window ${m.window.days} d, energy graph ends at ${c[c.length - 1].toFixed(0)} Wh = metrics (${(performance.now() - t1).toFixed(0)} ms)`,
      m.window.days === span && m.window.samples === Math.round((span * 24 * 60) / step) && near(c[c.length - 1], m.energyWh, 1e-6 * Math.max(1, m.energyWh)));
  }

  // ---- Drawers in JSDOM -----------------------------------------------------------------------------------
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { JSDOM } = await import('jsdom');
  const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost:3000' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  dom.window.HTMLCanvasElement.prototype.getContext = function () {
    return new Proxy({}, {
      get: (target, prop) => {
        if (prop === 'measureText') return () => ({ width: 10 });
        if (prop === 'createLinearGradient') return () => ({ addColorStop: () => {} });
        return () => {};
      },
    });
  };
  const { LunarNavigatorUI } = await import('../src/ui.js');
  const ui = new LunarNavigatorUI({ container: dom.window.document.getElementById('root') });
  const $ = (id) => dom.window.document.getElementById(id);

  const sunBtn = $('layer-btn-sunChart'), enBtn = $('layer-btn-energyChart');
  check('Right menu has both new toggles (OFF by default, enabled) and the drawers start hidden',
    !!sunBtn && !!enBtn && !sunBtn.disabled && !enBtn.disabled && sunBtn.getAttribute('aria-checked') === 'false'
    && enBtn.getAttribute('aria-checked') === 'false' && $('sun-chart-panel').classList.contains('hidden') && $('energy-chart-panel').classList.contains('hidden'));

  const stack = $('chart-drawer-stack');
  const order = Array.from(stack.children).map((c) => c.id);
  check('Drawers share one upward-stacking container (Earth chart lowest, Sun chart above it, then energy) so they cannot overlap',
    order.join() === 'earth-chart-panel,sun-chart-panel,energy-chart-panel' && stack.classList.contains('flex-col-reverse'));

  sunBtn.click(); enBtn.click();
  check('Toggles open the drawers and update the state', !$('sun-chart-panel').classList.contains('hidden') && !$('energy-chart-panel').classList.contains('hidden')
    && ui.layers.sunChart === true && ui.layers.energyChart === true && sunBtn.getAttribute('aria-checked') === 'true');

  ui.updateAnalysisCharts(metrics, { tiltDeg: best.beta, azimuthDeg: best.az }, 3.0);
  const energyBest = $('ec-total').textContent;
  check(`Stats row: lit % ${$('sc-lit-pct').textContent}, lit hours ${$('sc-lit-hours').textContent}, longest dark ${$('sc-longest-dark').textContent}`,
    /%$/.test($('sc-lit-pct').textContent) && /h$/.test($('sc-lit-hours').textContent) && /h$/.test($('sc-longest-dark').textContent)
    && ['LIT', 'DARK'].includes($('sc-now').textContent));
  check(`Energy stats: panel "${$('ec-config').textContent}", window ${energyBest}, so far ${$('ec-sofar').textContent}, P now ${$('ec-pnow').textContent}`,
    $('ec-config').textContent.startsWith('Best fixed') && /Wh$/.test(energyBest) && /Wh$/.test($('ec-sofar').textContent) && /W$/.test($('ec-pnow').textContent));

  ui.updateAnalysisCharts(metrics, { tiltDeg: 0, azimuthDeg: 0 }, 3.0);
  check('A different (Manual) panel orientation rebuilds the energy graph and is labelled Manual; the window total drops',
    $('ec-config').textContent.startsWith('Manual 0°/0°') && $('ec-total').textContent !== energyBest);

  $('btn-close-sun-chart').click(); $('btn-close-energy-chart').click();
  check('Close buttons hide the drawers and switch the toggles OFF', $('sun-chart-panel').classList.contains('hidden')
    && $('energy-chart-panel').classList.contains('hidden') && sunBtn.getAttribute('aria-checked') === 'false' && enBtn.getAttribute('aria-checked') === 'false');

  return {
    name: 'Test 26: Sun Illumination Chart & Solar Panel Energy Graph (Phase 11)',
    criteria: 'Lit flags equal I(t), stats from Phase 6, cumulative energy = Σ P·dt, toggles/drawers wired, drawers stacked without overlap',
    passed,
    timeMs: (performance.now() - t0).toFixed(2),
    measurements,
  };
}
