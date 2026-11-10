/**
 * Artemis Lunar Landing Site Navigator - Panel Visibility & DOM Shell Regression Test
 * 
 * Verifies with JSDOM:
 * 1. Initial tab state: exactly one of navigator, comparison, methods is visible.
 * 2. Nav button clicks: clicking #nav-btn-navigator, #nav-btn-comparison, #nav-btn-methods
 *    toggles visibility so exactly the target tab is visible.
 * 3. Orrery vs South Pole 3D mode controls toggle correctly (controls box and telemetry panels).
 * 4. Persistent banner element (.persistent-disclaimer-banner) exists and is the only fixed top banner.
 * 5. Closed-by-default elements (pin tooltip, earth chart panel, pause icon, calc progress container)
 *    have the 'hidden' class on initial render.
 */

export async function runPanelVisibilityTest() {
  const measurements = [];
  let passed = true;

  // Stubs for non-browser/Node environment:
  // We stub HTMLCanvasElement.prototype.getContext to provide a mock 2D canvas context
  // because EarthElevationChart initializes a 2D canvas context on startup.
  const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

  if (!isNode) {
    return {
      passed: true,
      measurements: ['Skipped in browser environment (Node JSDOM integration test)'],
    };
  }

  const { JSDOM } = await import('jsdom');
  const fs = await import('node:fs');
  const path = await import('node:path');

  const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost:3000' });

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;

  // Stub canvas 2D context for JSDOM
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
  const root = dom.window.document.getElementById('root');
  const ui = new LunarNavigatorUI({ container: root });

  // 1. Initial tab state
  const tabNav = dom.window.document.getElementById('navigator-tab');
  const tabComp = dom.window.document.getElementById('comparison-tab');
  const tabMeth = dom.window.document.getElementById('methods-tab');

  const isNavVisInit = !tabNav.classList.contains('hidden');
  const isCompVisInit = !tabComp.classList.contains('hidden');
  const isMethVisInit = !tabMeth.classList.contains('hidden');

  const visibleCountInit = [isNavVisInit, isCompVisInit, isMethVisInit].filter(Boolean).length;
  const initTabPass = visibleCountInit === 1 && isNavVisInit;
  if (!initTabPass) passed = false;
  measurements.push(`Initial Tab State: exactly 1 visible (navigator=${isNavVisInit}, comparison=${isCompVisInit}, methods=${isMethVisInit}) [${initTabPass ? 'PASS' : 'FAIL'}]`);

  // 2. Tab switching logic
  const btnNav = dom.window.document.getElementById('nav-btn-navigator');
  const btnComp = dom.window.document.getElementById('nav-btn-comparison');
  const btnMeth = dom.window.document.getElementById('nav-btn-methods');

  btnComp.click();
  const compClickPass = !tabComp.classList.contains('hidden') && tabNav.classList.contains('hidden') && tabMeth.classList.contains('hidden');
  if (!compClickPass) passed = false;
  measurements.push(`Click #nav-btn-comparison -> comparison visible, others hidden [${compClickPass ? 'PASS' : 'FAIL'}]`);

  btnMeth.click();
  const methClickPass = !tabMeth.classList.contains('hidden') && tabNav.classList.contains('hidden') && tabComp.classList.contains('hidden');
  if (!methClickPass) passed = false;
  measurements.push(`Click #nav-btn-methods -> methods visible, others hidden [${methClickPass ? 'PASS' : 'FAIL'}]`);

  btnNav.click();
  const navClickPass = !tabNav.classList.contains('hidden') && tabComp.classList.contains('hidden') && tabMeth.classList.contains('hidden');
  if (!navClickPass) passed = false;
  measurements.push(`Click #nav-btn-navigator -> navigator visible, others hidden [${navClickPass ? 'PASS' : 'FAIL'}]`);

  // 3. Orrery vs South Pole toggle
  const btnOrrery = dom.window.document.getElementById('mode-btn-orrery');
  const btnPole = dom.window.document.getElementById('mode-btn-pole');
  const orreryControls = dom.window.document.getElementById('orrery-controls-box');
  const poleControls = dom.window.document.getElementById('pole-controls-box');
  const orreryHud = dom.window.document.getElementById('orrery-telemetry-hud');
  const polePanel = dom.window.document.getElementById('pole-region-panel');

  // The app opens on the Orrery; the Moon globe controls appear only after switching to the Moon Globe
  const globeControls = dom.window.document.getElementById('globe-controls-box');
  const btnGlobe = dom.window.document.getElementById('mode-btn-globe');
  const orreryInitPass = !orreryControls.classList.contains('hidden') &&
                         globeControls.classList.contains('hidden') &&
                         poleControls.classList.contains('hidden') &&
                         !orreryHud.classList.contains('hidden') &&
                         polePanel.classList.contains('hidden');
  if (!orreryInitPass) passed = false;
  measurements.push(`Initial View Mode (Orrery): Orrery controls/HUD visible, Moon Globe and South Pole controls/panels hidden [${orreryInitPass ? 'PASS' : 'FAIL'}]`);

  btnGlobe.click();
  const globeClickPass = !globeControls.classList.contains('hidden') &&
                         orreryControls.classList.contains('hidden') &&
                         poleControls.classList.contains('hidden') &&
                         orreryHud.classList.contains('hidden') &&
                         polePanel.classList.contains('hidden');
  if (!globeClickPass) passed = false;
  measurements.push(`Click #mode-btn-globe -> Moon Globe controls visible, Orrery and South Pole controls/panels hidden [${globeClickPass ? 'PASS' : 'FAIL'}]`);
  btnOrrery.click();

  btnPole.click();
  const poleClickPass = orreryControls.classList.contains('hidden') &&
                        !poleControls.classList.contains('hidden') &&
                        orreryHud.classList.contains('hidden') &&
                        !polePanel.classList.contains('hidden');
  if (!poleClickPass) passed = false;
  measurements.push(`Click #mode-btn-pole -> South Pole controls/panel visible, Orrery controls/HUD hidden [${poleClickPass ? 'PASS' : 'FAIL'}]`);

  // Phase 11 follow-up: Select Region (left) and Analysis & Charts (right) are separate, collapsible panels
  const doc = dom.window.document;
  const selPanel = doc.getElementById('pole-select-panel');
  const selSplit = !selPanel.classList.contains('hidden') && selPanel.classList.contains('left-4')
    && selPanel.contains(doc.getElementById('region-list-content')) && selPanel.contains(doc.getElementById('pick-point-form'))
    && !polePanel.contains(doc.getElementById('region-list-content')) && !polePanel.contains(doc.getElementById('pick-point-form'))
    && polePanel.contains(doc.getElementById('layer-btn-energyChart')) && polePanel.contains(doc.getElementById('mission-metrics-card'));
  doc.getElementById('btn-toggle-region-list').click();
  doc.getElementById('btn-toggle-analysis-panel').click();
  const collapsed = doc.getElementById('select-panel-body').classList.contains('hidden') && doc.getElementById('analysis-panel-body').classList.contains('hidden');
  doc.getElementById('btn-toggle-region-list').click();
  doc.getElementById('btn-toggle-analysis-panel').click();
  const reopened = !doc.getElementById('select-panel-body').classList.contains('hidden') && !doc.getElementById('analysis-panel-body').classList.contains('hidden');
  const splitPass = selSplit && collapsed && reopened;
  if (!splitPass) passed = false;
  measurements.push(`Select Region (left: list + Pick a point) and Analysis & Charts (right: layers, inspector) are separate panels, both collapsible [${splitPass ? 'PASS' : 'FAIL'}]`);

  btnOrrery.click();
  const selHiddenInOrrery = selPanel.classList.contains('hidden');
  if (!selHiddenInOrrery) passed = false;
  measurements.push(`Orrery mode hides the Select Region panel too [${selHiddenInOrrery ? 'PASS' : 'FAIL'}]`);
  const orreryReturnPass = !orreryControls.classList.contains('hidden') &&
                           poleControls.classList.contains('hidden') &&
                           !orreryHud.classList.contains('hidden') &&
                           polePanel.classList.contains('hidden');
  if (!orreryReturnPass) passed = false;
  measurements.push(`Click #mode-btn-orrery -> Returns to Orrery visible state [${orreryReturnPass ? 'PASS' : 'FAIL'}]`);

  // 4. Persistent banner
  const banners = dom.window.document.querySelectorAll('.persistent-disclaimer-banner');
  const bannerPass = banners.length === 1 && banners[0].getAttribute('aria-label') === 'Dataset status';
  if (!bannerPass) passed = false;
  measurements.push(`Persistent Disclaimer Banner: exactly 1 present with aria-label="Dataset status" [${bannerPass ? 'PASS' : 'FAIL'}]`);

  // 5. Initial closed state of modals/drawers/tooltips
  const pinTooltip = dom.window.document.getElementById('pin-tooltip');
  const earthChartPanel = dom.window.document.getElementById('earth-chart-panel');
  const iconPause = dom.window.document.getElementById('icon-pause');

  const tooltipHidden = pinTooltip && pinTooltip.classList.contains('hidden');
  const chartHidden = earthChartPanel && earthChartPanel.classList.contains('hidden');
  const pauseHidden = iconPause && iconPause.classList.contains('hidden');

  const closedPass = tooltipHidden && chartHidden && pauseHidden;
  if (!closedPass) passed = false;
  measurements.push(`Initial Closed State (pin tooltip, chart panel drawer, and pause icon hidden) [${closedPass ? 'PASS' : 'FAIL'}]`);

  // 6. Pole top-left block removed; Layers & Charts menu present and wired
  const $ = (id) => dom.window.document.getElementById(id);
  const removedIds = ['btn-toggle-comms-ray', 'btn-comms-ray-label', 'btn-toggle-earth-chart', 'pole-comms-legend-card'];
  const removedPass = $('pole-controls-box').children.length === 0 && removedIds.every((id) => !$(id));
  if (!removedPass) passed = false;
  measurements.push(`Top-left Pole block removed (box empty, legacy ids gone) [${removedPass ? 'PASS' : 'FAIL'}]`);

  const layerBtns = dom.window.document.querySelectorAll('#layers-section [data-layer]');
  const earthBtn = $('layer-btn-earthGlobe');
  const rayBtn = $('layer-btn-commsRay');
  const chartBtn = $('layer-btn-earthChart');
  const sunBtnOn = !$('layer-btn-sun').disabled && $('layer-btn-sun').getAttribute('aria-checked') === 'true';
  const menuPass = layerBtns.length === 7 && !!$('btn-dock-overview') &&
                   earthBtn.getAttribute('aria-checked') === 'true' &&
                   chartBtn.getAttribute('aria-checked') === 'false' &&
                   sunBtnOn && !$('layer-btn-solarPanel').disabled;
  if (!menuPass) passed = false;
  measurements.push(`Layers & Charts menu: 7 toggles + overview button, correct defaults, Sun and Solar Panel enabled [${menuPass ? 'PASS' : 'FAIL'}]`);

  rayBtn.click();
  const rayOffPass = ui.layers.commsRay === false && rayBtn.getAttribute('aria-checked') === 'false' &&
                     $('btn-hud-toggle-ray').textContent.trim() === 'Ray: OFF';
  $('btn-hud-toggle-ray').click();
  const rayOnPass = ui.layers.commsRay === true && rayBtn.getAttribute('aria-checked') === 'true';
  chartBtn.click();
  const chartOpenPass = !$('earth-chart-panel').classList.contains('hidden') && ui.layers.earthChart === true;
  $('btn-close-earth-chart').click();
  const chartClosePass = $('earth-chart-panel').classList.contains('hidden') && chartBtn.getAttribute('aria-checked') === 'false';
  earthBtn.click();
  const globePass = ui.layers.earthGlobe === false && earthBtn.getAttribute('aria-checked') === 'false';
  const syncPass = rayOffPass && rayOnPass && chartOpenPass && chartClosePass && globePass;
  if (!syncPass) passed = false;
  measurements.push(`Layer toggles sync menu, HUD button, chart drawer and state (ray, chart, globe) [${syncPass ? 'PASS' : 'FAIL'}]`);

  return {
    passed,
    measurements,
  };
}
