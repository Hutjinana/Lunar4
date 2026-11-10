/**
 * Artemis Lunar Landing Site Navigator - UI Shell & Comprehensive Time Controls
 * 
 * Round 3:
 * 1. Bottom Dock Time Controls:
 *    - Play/Pause toggle
 *    - Playback speeds (1×, 5×, 20×, 100×)
 *    - Scrubber over user-selected span up to 365 days (30d, 90d, 180d, 365d)
 *    - Start-epoch picker (default: today, UTC)
 *    - Jump buttons: +1 day, +7 days, next New Moon, next Full Moon (astronomy-engine)
 * 2. Monospaced tabular-nums UTC time display
 * 3. Shared simTime store reactivity
 * 4. Dual view mode controls (Orrery & South Pole 3D)
 */

import { REGIONS, formatRegionCoords, regionKindLabel, regionStatusLabel } from '../regions.js';
import { CONFIG } from '../config.js';
import { timeStore } from './timeStore.js';
import { getElevationAt, computeLocalizedSlopeAt } from './terrain.js';
import { demProvider } from './demLoader.js';
import { GLOBE_FLY_MS } from './globeView.js';
import { parseMarkdown, fetchDataAndMethodsDoc, buildLiveDatasetStatusDOM } from './dataAndMethodsDoc.js';
import {
  computeRegionalComparisonData, rankRegionsByWeights, makeComparisonWindow,
  COMPARISON_DEFAULT_WEIGHTS, COMPARISON_MAST_HEIGHT_M,
} from './comparisonEngine.js';
import { EarthElevationChart } from './earthElevationChart.js';
import { MissionMetricsCard, missionMetricsCardHTML, formatEnergy, formatHours, formatWindowLine } from './missionMetricsCard.js';
import { SunIlluminationChart, sunIlluminationSeries } from './sunIlluminationChart.js';
import { PanelEnergyChart, cumulativeEnergySeriesWh, cumulativeEnergyAtWh } from './panelEnergyChart.js';
import { panelPowerSeriesW } from './missionMetrics.js';
import { validatePickedPointFromForm, validatePickedPoint, makeUserPointRegion, distanceFromPoleKm } from './pickPoint.js';

/**
 * Pole-mode layer toggles shown in the right-hand "Layers & Charts" menu.
 * `available: false` means the feature is not built yet (rendered disabled);
 * flip it to true when the owning phase lands. State lives in LunarNavigatorUI.layers.
 */
const SVG_ATTR = 'class="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
export const POLE_LAYER_DEFS = [
  {
    id: 'earthGlobe', label: 'Earth Globe', available: true, defaultOn: true,
    title: 'Earth globe at the end of the comms ray, along the true Earth direction from the selected site (display size, not to scale).',
    icon: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3.5 3.5 3.5 14.5 0 18M12 3c-3.5 3.5-3.5 14.5 0 18"/>',
  },
  {
    id: 'sun', label: 'Sun & Sun Path', available: true, defaultOn: true,
    title: 'Sun (display size, not to scale) on its azimuth track over one synodic month. The true bearing is kept; the ring and Sun height are exaggerated so the ~1.5° swing stays readable.',
    icon: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  },
  {
    id: 'solarPanel', label: 'Solar Panel (3D)', available: true, defaultOn: true,
    title: 'Mast and fixed solar panel at the selected region, tilted at its best fixed tilt/azimuth. Bright = Sun above the horizon and facing the panel. Mast and panel are drawn larger than true scale (not to scale).',
    icon: '<path d="M4 9l2-5h12l2 5zM4 9v9h16V9M12 4v14M4 13.5h16M12 18v3"/>',
  },
  {
    id: 'commsRay', label: 'Comms Ray', available: true, defaultOn: true,
    title: 'Direct-to-Earth line of sight from the selected region',
    icon: '<circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/><path d="M6.5 17.5l11-11" stroke-dasharray="2.5 2.5"/>',
  },
  {
    id: 'earthChart', label: 'Earth Elevation Chart', available: true, defaultOn: false,
    title: 'Direct-to-Earth elevation and libration chart',
    icon: '<path d="M3 3v18h18M7 15l3-4 3 3 5-7"/>',
  },
  {
    id: 'sunChart', label: 'Sun Illumination Chart', available: true, defaultOn: false,
    title: 'Sun elevation against the local horizon over the mission window; shaded where the Sun is above the horizon (lit). Binary centre-point test.',
    icon: '<circle cx="12" cy="9" r="3.5"/><path d="M3 20h18M5 15h2M17 15h2M12 2v1.5"/>',
  },
  {
    id: 'energyChart', label: 'Solar Energy Chart', available: true, defaultOn: false,
    title: 'Line chart of the power the solar cell produces at each time step (best fixed tilt/azimuth, or your Manual setting).',
    icon: '<path d="M3 3v18h18M7 17l4-5 3 2 5-8"/><path d="M13 3l-2 4h3l-2 4"/>',
  },
];

const LAYER_BTN_BASE = 'flex items-center gap-2 min-h-[44px] px-2.5 py-2 rounded-xl border text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400';
const LAYER_BTN_ON = 'bg-cyan-950/70 border-cyan-400 text-cyan-50 hover:bg-cyan-900/70';
const LAYER_BTN_OFF = 'bg-slate-900 border-slate-600 text-slate-400 hover:bg-slate-800 hover:text-slate-200';
const LAYER_BTN_DISABLED = 'bg-slate-900/60 border-slate-800 text-slate-500 cursor-not-allowed opacity-60';
const LAYER_PILL_BASE = 'ml-auto shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold tabular-nums';
const LAYER_PILL_ON = 'bg-cyan-400 text-slate-950';
const LAYER_PILL_OFF = 'bg-slate-700 text-slate-300';
const LAYER_PILL_DISABLED = 'bg-slate-800 text-slate-500';

/** Shared markup of the Phase 11 chart drawers (title bar with close button, canvas, stats row, hint). */
function chartPanelHTML({ id, canvasId, closeId, title, border, dot, stats, hint }) {
  const statHTML = stats.map(([label, sid]) => `
                <span class="flex items-baseline gap-1"><span class="text-slate-400">${label}</span><span id="${sid}" class="text-white font-bold tabular-nums">--</span></span>`).join('');
  return `
          <div id="${id}" class="hidden w-full shrink-0 pointer-events-auto rounded-2xl bg-[#07090E]/95 backdrop-blur border ${border} shadow-2xl p-3 font-mono text-xs space-y-2">
            <div class="flex items-center justify-between border-b border-[#1E293B] pb-2">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full ${dot}"></span>
                <span class="font-bold text-white uppercase tracking-wider text-[11px]">${title}</span>
              </div>
              <button id="${closeId}" aria-label="Close ${title}" class="text-slate-400 hover:text-white p-1">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div class="w-full relative h-36 bg-[#07090E] rounded-xl overflow-hidden border border-[#1E293B]">
              <canvas id="${canvasId}" class="w-full h-full cursor-crosshair block"></canvas>
            </div>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px]">${statHTML}
            </div>
            <div class="text-slate-400 italic font-sans text-[10px]">${hint}</div>
          </div>
`;
}

export class LunarNavigatorUI {
  constructor(options = {}) {
    this.container = options.container || document.getElementById('root');
    this.regions = REGIONS;
    this.selectedRegion = this.regions[2]; // Default: Malapert Massif
    this.lastRealRegion = this.selectedRegion; // last real (non-user) region, restored by Clear
    this.hasUserPoint = false;
    this.activeTab = 'navigator';
    this.viewMode = 'orrery'; // 'orrery' (opening view) | 'globe' | 'south_pole'
    this.cameraPreset = 'overview';
    this.isDockCollapsed = false;
    this.isRegionListCollapsed = false;
    this.isAnalysisPanelCollapsed = false;
    this.callbacks = options.callbacks || {};
    this.slopeRadiusKm = CONFIG.radii.defaultSlopeRadiusKm || 3.0;

    // Phase 10: three Section 5 criteria weights (0 to 100; normalised when scoring)
    this.weights = { ...COMPARISON_DEFAULT_WEIGHTS };
    this.cachedComparisonData = null;
    this.isComputingComparison = false;
    this._comparisonRerunQueued = false;
    this.sortColumn = 'score';
    this.sortAscending = false;

    // Layers & Charts toggle state (single source of truth, persists across mode switches)
    this.layers = {};
    for (const def of POLE_LAYER_DEFS) this.layers[def.id] = def.defaultOn;

    // Round 9: Earth Elevation Libration Chart instance
    this.earthElevationChart = null;
    // Phase 11: Sun Illumination chart and solar-panel energy graph (fed from the cached Navigator mission metrics)
    this.sunChart = null;
    this.energyChart = null;
    this._analysis = null; // latest { metrics, panel, elapsedDays } pushed by the app
    this._sunChartMetrics = null;
    this._energyChartKey = null;

    // Single source of truth Data & Methods loader (Task 2)
    this._methodsDocLoaded = false;

    this._buildDOM();
    this._bindEvents();
    this._initEarthChart();
    this._initMissionCard();
    this._initAnalysisCharts();
    this._runComparisonCalculation();
    this._populateRegionListPanel();
    this._loadMethodsDoc();
  }

  // Back-compat accessors: older code reads these flags; they mirror this.layers.
  get isCommsRayVisible() { return this.layers.commsRay; }
  set isCommsRayVisible(v) { this.layers.commsRay = Boolean(v); }
  get isEarthChartVisible() { return this.layers.earthChart; }
  set isEarthChartVisible(v) { this.layers.earthChart = Boolean(v); }

  _layerSectionHTML() {
    const buttons = POLE_LAYER_DEFS.map((def) => `
                <button type="button" id="layer-btn-${def.id}" data-layer="${def.id}" role="switch" aria-checked="false" title="${def.title}" class="${LAYER_BTN_BASE} ${LAYER_BTN_OFF}">
                  <svg ${SVG_ATTR}>${def.icon}</svg>
                  <span class="text-[11px] font-semibold leading-tight">${def.label}</span>
                  <span data-layer-pill class="${LAYER_PILL_BASE} ${LAYER_PILL_OFF}">OFF</span>
                </button>`).join('');
    return `
            <!-- Layers & Charts (Pole mode) -->
            <div id="layers-section" class="px-3 py-2.5 border-b border-[#1E293B]/60 shrink-0 font-mono text-xs space-y-2">
              <button type="button" id="btn-back-to-globe" title="Return to the Moon globe to pick another region" class="w-full flex items-center justify-center gap-2 min-h-[44px] px-3 py-2 rounded-xl border border-cyan-500/70 bg-cyan-600/20 text-cyan-100 text-[11px] font-semibold hover:bg-cyan-600/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
                <svg ${SVG_ATTR}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>
                <span>Back to Moon Globe</span>
              </button>
              <div class="font-bold text-white text-[11px]">Layers &amp; Charts</div>
              <div class="grid grid-cols-2 gap-1.5">${buttons}
              </div>
              <button type="button" id="btn-dock-overview" title="Move the camera to the High Polar Overview" class="w-full flex items-center justify-center gap-2 min-h-[44px] px-3 py-2 rounded-xl border border-slate-500 bg-[#0F172A] text-slate-100 text-[11px] font-semibold hover:bg-slate-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
                <svg ${SVG_ATTR}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>
                <span>High Polar Overview</span>
              </button>
              <div class="flex items-center justify-between text-[10px] px-1">
                <span class="flex items-center gap-1 text-cyan-300"><span class="w-2 h-2 rounded-full bg-[#06B6D4]"></span><span>CLEAR</span></span>
                <span class="flex items-center gap-1 text-amber-300"><span class="w-2 h-2 rounded-full bg-[#F59E0B]"></span><span>PARTIAL</span></span>
                <span class="flex items-center gap-1 text-rose-400"><span class="w-2 h-2 rounded-full bg-[#F43F5E]"></span><span>BLOCKED</span></span>
              </div>
            </div>
`;
  }

  _buildDOM() {
    // Default today UTC formatted as YYYY-MM-DD
    const todayStr = timeStore.baseEpoch.toISOString().substring(0, 10);

    // Live dataset provenance and status block (Round 6)
    const liveDataStatusHtml = buildLiveDatasetStatusDOM();

    this.container.innerHTML = `
      <!-- Persistent Undismissible Banner (Rule 3) -->
      <aside aria-label="Dataset status" class="persistent-disclaimer-banner select-none flex items-center justify-center gap-2 px-4 py-2 bg-amber-950/90 border-b border-amber-600/70 text-amber-200 text-xs font-mono font-medium z-50 relative shrink-0 shadow-sm">
        <svg class="w-3.5 h-3.5 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <span>${demProvider.isSynthetic ? CONFIG.dem.bannerText : CONFIG.dem.realBannerText}</span>
        <span class="hidden md:inline text-amber-400/70 text-[11px] font-sans">| ${demProvider.isSynthetic ? CONFIG.dem.subBannerText : CONFIG.dem.realSubBannerText}</span>
      </aside>

      <!-- App Header Bar -->
      <header class="app-header flex items-center justify-between gap-4 px-6 py-3 border-b border-[#1E293B] bg-[#07090E]/95 backdrop-blur z-40 shrink-0 select-none">
        <!-- Brand Wordmark -->
        <div class="flex items-center gap-3">
          <div class="w-7 h-7 rounded bg-[#06B6D4]/90 border border-[#06B6D4]/40 flex items-center justify-center text-white font-bold text-xs shadow-sm">
            A3
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h1 class="text-sm sm:text-base font-bold tracking-tight text-white uppercase font-sans">
                Artemis Lunar Navigator
              </h1>
              <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 border border-slate-700">
                Round 3
              </span>
            </div>
            <p class="text-[11px] text-slate-400 font-sans hidden sm:block">
              NASA Space Apps Challenge 2026 · Time Control & Orrery
            </p>
          </div>
        </div>

        <!-- Navigation Tabs -->
        <nav class="flex items-center gap-1 sm:gap-2 text-xs font-medium">
          <button id="nav-btn-navigator" class="nav-tab active flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cyan-500/40 bg-cyan-950/40 text-cyan-300 font-semibold transition-colors">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A2 2 0 013 15.485V5.515a2 2 0 011.053-1.761L9 1m0 19l6-3m-6 3V1m6 16l5.447 2.724A2 2 0 0021 17.985V8.015a2 2 0 00-1.053-1.761L15 3.5m0 13.5V3.5m0 0L9 1" />
            </svg>
            <span class="hidden md:inline">3D Viewport</span>
            <span class="md:hidden">3D</span>
          </button>

          <button id="nav-btn-comparison" class="nav-tab flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-transparent transition-colors text-slate-400 hover:text-white">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <span class="hidden md:inline">Region Comparison</span>
            <span class="md:hidden">Comparison</span>
          </button>

          <button id="nav-btn-methods" class="nav-tab flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-transparent transition-colors text-slate-400 hover:text-white">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <span class="hidden md:inline">Data & Methods</span>
            <span class="md:hidden">Methods</span>
          </button>
        </nav>

        <!-- Right View Mode Switcher -->
        <div class="flex items-center gap-2">
          <div class="flex items-center p-1 rounded-xl bg-[#0F172A] border border-[#1E293B] text-xs font-mono">
            <button id="mode-btn-orrery" class="px-3 py-1 rounded-lg bg-cyan-600 text-white font-semibold transition-all">
              Orrery
            </button>
            <button id="mode-btn-globe" class="px-3 py-1 rounded-lg text-slate-400 hover:text-white transition-all">
              Moon Globe
            </button>
            <button id="mode-btn-pole" class="px-3 py-1 rounded-lg text-slate-400 hover:text-white transition-all">
              South Pole 3D
            </button>
          </div>
        </div>
      </header>

      <!-- Main Stage Container -->
      <main id="app-stage" class="relative flex-1 w-full h-full overflow-hidden bg-[#07090E]">
        <div id="navigator-tab" class="absolute inset-0 w-full h-full">
          <div id="canvas-container" class="w-full h-full"></div>
          <!-- Short black fade used when switching between the Moon globe and the other views -->
          <div id="view-fade" aria-hidden="true" class="pointer-events-none absolute inset-0 z-30 bg-black" style="opacity:0"></div>

          <!-- Dynamic Pin Hover Tooltip -->
          <div id="pin-tooltip" class="hidden pointer-events-none fixed z-50 p-2.5 rounded-xl bg-[#07090E]/95 backdrop-blur border border-cyan-500/60 shadow-2xl text-xs font-mono transform -translate-x-1/2 -translate-y-full mb-3 space-y-1">
            <div id="tooltip-title" class="font-bold text-white text-sm">Region Name</div>
            <div id="tooltip-coords" class="text-cyan-300 text-[11px]">Coordinates</div>
            <div id="tooltip-elevation" class="text-amber-300 text-[11px]">Elevation: -- km</div>
            <div id="tooltip-hint" class="text-[10px] text-slate-400">Click pin to dock camera</div>
          </div>

          <!-- Moon globe selection card: appears after a pin or a point on the globe is clicked -->
          <div id="globe-select-card" class="hidden absolute top-28 sm:top-4 left-1/2 -translate-x-1/2 z-20 w-[calc(100%-2rem)] max-w-sm p-3 rounded-xl bg-[#07090E]/95 backdrop-blur border border-cyan-500/60 shadow-2xl text-xs font-mono space-y-2">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div id="globe-select-title" class="font-bold text-white text-sm truncate">Selected point</div>
                <div id="globe-select-coords" class="text-cyan-300 text-[11px]">Coordinates</div>
              </div>
              <button type="button" id="btn-globe-select-clear" aria-label="Clear selection" title="Clear selection" class="shrink-0 w-7 h-7 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">&times;</button>
            </div>
            <button type="button" id="btn-globe-view-pole" class="w-full flex items-center justify-center gap-2 min-h-[44px] px-3 py-2 rounded-xl border border-cyan-500/70 bg-cyan-600/20 text-cyan-100 text-[11px] font-semibold hover:bg-cyan-600/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-cyan-600/20">
              <span>View in South Pole 3D</span>
            </button>
            <div id="globe-select-note" class="hidden text-[10px] text-amber-300"></div>
          </div>

          <!-- Left Floating Controls -->
          <div class="absolute top-4 left-4 z-20 space-y-2">
            <!-- Mode 0: Moon Globe controls (shown after switching to the Moon Globe) -->
            <div id="globe-controls-box" class="hidden space-y-2">
              <div id="globe-scale-badge" title="Earth and Sun are display-size markers, not to scale; only their directions are real. The Sun ring is the Sun's real track around the Moon over one synodic month, with its small latitude swing (about ±1.5°) doubled so the ring is not perfectly flat. The Earth path is its libration loop (about ±7°)." class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#07090E]/90 backdrop-blur border border-amber-500/40 text-xs font-mono shadow-lg">
                <span class="w-2 h-2 rounded-full bg-amber-400"></span>
                <span class="font-bold text-amber-300">[NOT TO SCALE]</span>
                <span class="text-slate-400 text-[11px] hidden sm:inline">Orientation only</span>
              </div>
              <button type="button" id="btn-globe-focus-south" title="Frame the nine polar region pins from above the south pole" class="flex items-center gap-2 min-h-[44px] px-3 py-2 rounded-xl border border-slate-500 bg-[#07090E]/90 backdrop-blur text-slate-100 text-[11px] font-mono font-semibold shadow-lg hover:bg-slate-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/></svg>
                <span>Focus South Pole</span>
              </button>
            </div>

            <!-- Mode 1: Orrery Controls (opening view) -->
            <div id="orrery-controls-box" class="space-y-2">
              <div class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#07090E]/90 backdrop-blur border border-amber-500/40 text-xs font-mono shadow-lg">
                <span class="w-2 h-2 rounded-full bg-amber-400"></span>
                <span class="font-bold text-amber-300">[NOT TO SCALE]</span>
                <span class="text-slate-400 text-[11px] hidden sm:inline">Exaggerated planetary scale</span>
              </div>

              <!-- Camera Presets -->
              <div class="flex items-center p-1 rounded-xl bg-[#07090E]/90 backdrop-blur border border-[#1E293B] shadow-lg text-xs font-mono">
                <span class="px-2.5 text-[11px] text-slate-400 uppercase tracking-wider">Camera:</span>
                <button id="cam-preset-overview" class="px-2.5 py-1 rounded-lg bg-cyan-600 text-white font-semibold transition-all">
                  Overview
                </button>
                <button id="cam-preset-earth" class="px-2.5 py-1 rounded-lg text-slate-400 hover:text-white transition-all">
                  Earth
                </button>
                <button id="cam-preset-moon" class="px-2.5 py-1 rounded-lg text-slate-400 hover:text-white transition-all">
                  Moon
                </button>
                <button id="cam-preset-sun" class="px-2.5 py-1 rounded-lg text-slate-400 hover:text-white transition-all">
                  Sun
                </button>
                <button id="cam-preset-system" class="px-2.5 py-1 rounded-lg text-slate-400 hover:text-white transition-all">
                  Orbit
                </button>
              </div>
            </div>

            <!-- Mode 2: South Pole view. Intentionally empty: all Pole controls live in the right-hand Layers & Charts menu. -->
            <div id="pole-controls-box" class="hidden"></div>
          </div>

          <!-- Round 9: Direct-to-Earth Elevation Libration Chart Floating Drawer -->
          <!-- Phase 11: chart drawers stack upwards from the dock (Earth chart at the bottom), so they never overlap -->
          <div id="chart-drawer-stack" class="absolute bottom-28 left-4 right-4 sm:right-auto sm:w-[38rem] z-30 flex flex-col-reverse gap-2 max-h-[calc(100%-8rem)] overflow-y-auto nice-scroll pointer-events-none">
          <div id="earth-chart-panel" class="hidden w-full shrink-0 pointer-events-auto rounded-2xl bg-[#07090E]/95 backdrop-blur border border-cyan-500/50 shadow-2xl p-3 font-mono text-xs space-y-2">
            <div class="flex items-center justify-between border-b border-[#1E293B] pb-2">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-cyan-400"></span>
                <span class="font-bold text-white uppercase tracking-wider text-[11px]">Direct-to-Earth Elevation & Libration Chart</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-[10px] text-cyan-300 hidden sm:inline">Scrub / Seek Enabled</span>
                <button id="btn-close-earth-chart" class="text-slate-400 hover:text-white p-1">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <!-- Canvas Element for Pure HTML5 Rendering (No Chart Library) -->
            <div class="w-full relative h-48 bg-[#07090E] rounded-xl overflow-hidden border border-[#1E293B]">
              <canvas id="earth-elevation-canvas" class="w-full h-full cursor-crosshair block"></canvas>
            </div>

            <div class="flex flex-wrap items-center justify-between text-[10px] text-slate-400 gap-2 pt-0.5">
              <div class="flex items-center gap-3">
                <span class="flex items-center gap-1 text-cyan-300">
                  <span class="w-2.5 h-0.5 bg-cyan-400 inline-block"></span>
                  <span>θ⊕ (Earth elevation)</span>
                </span>
                <span class="flex items-center gap-1 text-amber-300">
                  <span class="w-2.5 h-0.5 bg-amber-400 border-b border-dashed inline-block"></span>
                  <span>θmask,⊕ (Horizon profile)</span>
                </span>
                <span class="flex items-center gap-1 text-slate-300">
                  <span class="w-2 h-2 rounded-sm bg-cyan-500/30 border border-cyan-500/50 inline-block"></span>
                  <span>Direct LoS Band</span>
                </span>
              </div>
              <div class="text-slate-400 italic font-sans text-[10px]">
                Click or drag on chart to seek simulation time (simTime).
              </div>
            </div>
          </div>

          ${chartPanelHTML({
            id: 'sun-chart-panel', canvasId: 'sun-illumination-canvas', closeId: 'btn-close-sun-chart',
            title: 'Sun Illumination Chart', border: 'border-amber-400/50', dot: 'bg-amber-300',
            stats: [['Lit now', 'sc-now'], ['Lit', 'sc-lit-pct'], ['Lit hours', 'sc-lit-hours'], ['Longest dark', 'sc-longest-dark']],
            hint: 'Lit (shaded) when the Sun is above the horizon at its azimuth. Click or drag to seek simTime.',
          })}
          ${chartPanelHTML({
            id: 'energy-chart-panel', canvasId: 'energy-chart-canvas', closeId: 'btn-close-energy-chart',
            title: 'Solar Cell Output Chart', border: 'border-emerald-500/50', dot: 'bg-emerald-400',
            stats: [['Panel', 'ec-config'], ['P now', 'ec-pnow'], ['E so far', 'ec-sofar'], ['E window', 'ec-total']],
            hint: 'Line = P_gen(t), the power the solar cell produces at each time step (E = Σ P_gen · dt). Click or drag to seek simTime.',
          })}
          </div>

          <!-- Top-Right Floating Panel: Orrery Telemetry OR South Pole Regions List -->
          <aside id="orrery-telemetry-hud" aria-label="Orbital Telemetry" class="absolute top-4 right-4 z-20 w-72 sm:w-80 rounded-2xl bg-[#07090E]/90 backdrop-blur border border-[#1E293B] shadow-2xl p-4 text-xs font-mono space-y-3">
            <div class="flex items-center justify-between border-b border-[#1E293B] pb-2">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-cyan-400"></span>
                <span class="font-bold uppercase tracking-wider text-white">System Telemetry</span>
              </div>
              <span class="text-[10px] text-slate-400">Orrery Mode</span>
            </div>

            <div class="space-y-1">
              <span class="text-slate-400 block text-[10px]">Simulation Time (UTC):</span>
              <div id="readout-utc-time" class="text-white font-semibold text-sm font-mono tabular-nums">
                2026-11-01 00:00:00 UTC
              </div>
              <div id="readout-elapsed-days" class="text-cyan-300 text-[11px] font-mono tabular-nums">
                Epoch Offset: T+ 0.00 days
              </div>
            </div>

            <div class="p-2.5 rounded-xl bg-[#0F172A] border border-[#1E293B] space-y-1">
              <div class="flex items-center justify-between">
                <span class="text-slate-400 text-[10px]">Earth–Moon Distance:</span>
                <span id="readout-earth-moon-dist" class="text-cyan-300 font-bold text-sm font-mono tabular-nums">384,400 km</span>
              </div>
            </div>

            <div class="p-2.5 rounded-xl bg-[#0F172A] border border-[#1E293B] space-y-1.5">
              <div class="flex items-center justify-between">
                <span class="text-slate-400 text-[10px]">Moon Phase & Illumination:</span>
                <span id="readout-phase-illum" class="text-amber-300 font-bold text-sm font-mono tabular-nums">--%</span>
              </div>
              <div id="readout-phase-name" class="text-white font-semibold text-xs">
                Waxing Gibbous
              </div>
            </div>
          </aside>

          <!-- Left floating panel: region selection + Pick a point (collapsible) -->
          <aside id="pole-select-panel" aria-label="Region Selection" class="hidden absolute top-4 left-4 z-20 w-80 sm:w-[22rem] max-h-[calc(100vh-8.5rem)] rounded-2xl bg-[#07090E]/95 backdrop-blur border border-[#1E293B] shadow-2xl flex flex-col overflow-hidden transition-all duration-200">
            <div class="flex items-center justify-between px-4 py-2.5 bg-[#0F172A] border-b border-[#1E293B] shrink-0">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-cyan-400"></span>
                <span class="font-bold text-xs font-mono uppercase tracking-wider text-white">Select Region (9)</span>
              </div>
              <button id="btn-toggle-region-list" aria-expanded="true" class="text-slate-400 hover:text-white p-1 text-[11px] font-mono flex items-center gap-1">
                <span id="region-list-toggle-label">Hide</span>
                <svg id="region-list-chevron" class="w-3.5 h-3.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
            <div id="select-panel-body" class="flex-1 min-h-0 overflow-y-auto nice-scroll">
            <!-- Region list -->
            <div id="region-list-content" class="p-2 space-y-1 shrink-0 border-b border-[#1E293B]/60"></div>

            <!-- Pick a point (user-defined pseudo-region) -->
            <div id="pick-point-form" class="px-3 py-2 border-b border-[#1E293B]/60 shrink-0 font-mono text-[11px] space-y-1.5">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-slate-400 uppercase tracking-wider text-[10px]">Pick a point</span>
                <label class="flex items-center gap-1 text-slate-300">
                  <span>Lat (°S)</span>
                  <input id="pick-lat-input" type="text" inputmode="decimal" autocomplete="off" placeholder="80–90" class="w-16 px-1.5 py-1 rounded-lg bg-[#07090E] border border-[#1E293B] text-slate-200 tabular-nums focus:outline-none focus:border-cyan-500" />
                </label>
                <label class="flex items-center gap-1 text-slate-300">
                  <span>Lon (°E)</span>
                  <input id="pick-lon-input" type="text" inputmode="decimal" autocomplete="off" placeholder="−180–180" class="w-20 px-1.5 py-1 rounded-lg bg-[#07090E] border border-[#1E293B] text-slate-200 tabular-nums focus:outline-none focus:border-cyan-500" />
                </label>
                <button id="btn-pick-analyse" class="px-2.5 py-1 rounded-lg bg-cyan-600 text-white font-semibold transition-all">Analyse</button>
                <button id="btn-pick-clear" class="hidden px-2.5 py-1 rounded-lg text-slate-400 hover:text-white transition-all">Clear</button>
              </div>
              <div id="pick-point-msg" class="hidden text-rose-300 text-[11px]"></div>
            </div>

            </div>
          </aside>

          <!-- South Pole Candidate Region Selection & Regional Metrics HUD Panel -->
          <aside id="pole-region-panel" aria-label="Analysis &amp; Charts" class="hidden absolute top-4 right-4 z-20 w-80 sm:w-[26rem] max-h-[calc(100vh-8.5rem)] rounded-2xl bg-[#07090E]/95 backdrop-blur border border-[#1E293B] shadow-2xl flex flex-col overflow-hidden transition-all duration-200">
            <!-- Header -->
            <div class="flex items-center justify-between px-4 py-2.5 bg-[#0F172A] border-b border-[#1E293B] shrink-0">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span class="font-bold text-xs font-mono uppercase tracking-wider text-white">Analysis &amp; Charts</span>
              </div>
              <button id="btn-toggle-analysis-panel" aria-expanded="true" class="text-slate-400 hover:text-white p-1 text-[11px] font-mono flex items-center gap-1">
                <span id="analysis-panel-toggle-label">Hide</span>
                <svg id="analysis-panel-chevron" class="w-3.5 h-3.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>

            <!-- Scrollable body: layers & charts and the inspector scroll together (collapsible) -->
            <div id="analysis-panel-body" class="flex-1 min-h-0 overflow-y-auto nice-scroll">
            ${this._layerSectionHTML()}
            <!-- Live Regional Telemetry Inspector (Round 4) -->
            <div class="p-3.5 space-y-3 font-mono text-xs">
              <!-- Region Identity & Topography -->
              <div class="flex items-center justify-between pb-2 border-b border-[#1E293B]">
                <div>
                  <div class="text-slate-400 text-[10px] uppercase tracking-wider">Active Target Region</div>
                  <div id="inspector-region-name" class="font-bold text-sm text-cyan-300">Malapert Massif</div>
                  <div id="inspector-region-coords" class="text-slate-300 text-[11px] tabular-nums">${formatRegionCoords(this.selectedRegion)} · ${regionKindLabel(this.selectedRegion)}</div>
                </div>
                <div class="text-right">
                  <div class="text-slate-400 text-[10px] uppercase tracking-wider">Surface Elevation</div>
                  <div id="inspector-region-elev" class="text-amber-300 font-bold text-sm tabular-nums">+4.82 km</div>
                  <div id="inspector-region-status" class="text-[10px] text-amber-400/90 uppercase font-semibold">${regionStatusLabel(this.selectedRegion)}</div>
                  <div id="inspector-region-pole-dist" class="hidden text-[10px] text-slate-400 tabular-nums"></div>
                </div>
              </div>

              <!-- Metrics Block 1: Solar Illumination & Extended-Disc Occlusion -->
              <div class="p-2.5 rounded-xl bg-[#0F172A] border border-[#1E293B] space-y-2">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-1.5 font-bold text-white text-[11px]">
                    <span class="w-2 h-2 rounded-full bg-amber-400"></span>
                    <span>Solar Illumination (f☉)</span>
                  </div>
                  <span id="solar-status-badge" class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Direct Sun
                  </span>
                </div>

                <!-- Unblocked Progress Bar -->
                <div class="space-y-1">
                  <div class="flex items-center justify-between text-[11px] tabular-nums">
                    <span class="text-slate-400">Unblocked Disc Area:</span>
                    <span id="solar-fraction-pct" class="text-amber-300 font-bold text-xs">100.0%</span>
                  </div>
                  <div class="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div id="solar-fraction-bar" class="h-full bg-amber-400 rounded-full transition-all duration-150" style="width: 100%;"></div>
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-2 text-[10px] text-slate-400 tabular-nums pt-1 border-t border-[#1E293B]/60">
                  <div>
                    <span>Sun Elevation: </span>
                    <span id="solar-elev-val" class="text-white font-semibold">+1.42°</span>
                  </div>
                  <div>
                    <span>Horizon Mask: </span>
                    <span id="solar-mask-val" class="text-slate-300 font-semibold">-0.15°</span>
                  </div>
                  <div>
                    <span>Sun Azimuth: </span>
                    <span id="solar-azim-val" class="text-white font-semibold">184.2°</span>
                  </div>
                  <div>
                    <span>Angular Radius: </span>
                    <span class="text-slate-300">0.265° (0.53°⌀)</span>
                  </div>
                </div>
              </div>

              <!-- Metrics Block 2: Earth Visibility & Direct-to-Earth Comm (f⊕) (Round 8 & 9) -->
              <div class="p-2.5 rounded-xl bg-[#0F172A] border border-[#1E293B] space-y-2">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-1.5 font-bold text-white text-[11px]">
                    <span class="w-2 h-2 rounded-full bg-cyan-400"></span>
                    <span>Direct-to-Earth Comm (f⊕)</span>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <span id="earth-status-badge" class="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                      Direct LoS
                    </span>
                  </div>
                </div>

                <!-- Unblocked Earth Bar -->
                <div class="space-y-1">
                  <div class="flex items-center justify-between text-[11px] tabular-nums">
                    <span class="text-slate-400">Unblocked Earth Disc:</span>
                    <span id="earth-fraction-pct" class="text-cyan-300 font-bold text-xs">100.0%</span>
                  </div>
                  <div class="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div id="earth-fraction-bar" class="h-full bg-cyan-400 rounded-full transition-all duration-150" style="width: 100%;"></div>
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-2 text-[10px] text-slate-400 tabular-nums pt-1 border-t border-[#1E293B]/60">
                  <div>
                    <span>Earth Elevation (θ⊕): </span>
                    <span id="earth-elev-val" class="text-white font-semibold">+4.10°</span>
                  </div>
                  <div>
                    <span>Horizon Mask (θmask): </span>
                    <span id="earth-mask-val" class="text-slate-300 font-semibold">+0.22°</span>
                  </div>
                  <div>
                    <span>Clearance Margin (Δθ): </span>
                    <span id="earth-margin-val" class="text-cyan-300 font-bold">+3.88°</span>
                  </div>
                  <div>
                    <span>Earth Azimuth: </span>
                    <span id="earth-azim-val" class="text-white font-semibold">002.8°</span>
                  </div>
                </div>

                <p id="horizon-resolution-note" class="text-[10px] text-slate-400">Horizon is computed from the mast tip on a 320 m DEM; obstacles smaller than 320 m are not resolved.</p>

                <!-- Round 8: Comms Ray 3D Legend & Controls -->
                <div class="pt-1.5 border-t border-[#1E293B]/60 space-y-1.5">
                  <div class="flex items-center justify-between text-[10px]">
                    <span class="text-slate-400">Comms Ray (3D):</span>
                    <div class="flex items-center gap-1">
                      <button id="btn-hud-toggle-ray" class="px-2 py-0.5 rounded bg-cyan-950/70 border border-cyan-500/50 text-cyan-200 text-[10px] font-bold hover:bg-cyan-900/60 transition-colors">
                        Ray: ON
                      </button>
                      <button id="btn-hud-open-chart" class="px-2 py-0.5 rounded bg-amber-950/50 border border-amber-600/40 text-amber-300 text-[10px] font-bold hover:bg-amber-900/60 transition-colors">
                        Open Chart ↗
                      </button>
                    </div>
                  </div>

                  <!-- Legend Swatches -->
                  <div class="flex items-center justify-between text-[9px] font-mono px-1.5 py-1 rounded-lg bg-[#07090E] border border-[#1E293B]">
                    <span class="flex items-center gap-1 text-cyan-300">
                      <span class="w-2 h-2 rounded-full bg-[#06B6D4]"></span>
                      <span>Clear (f⊕≥0.95)</span>
                    </span>
                    <span class="flex items-center gap-1 text-amber-300">
                      <span class="w-2 h-2 rounded-full bg-[#F59E0B]"></span>
                      <span>Limb (Partial)</span>
                    </span>
                    <span class="flex items-center gap-1 text-rose-400">
                      <span class="w-2 h-2 rounded-full bg-[#F43F5E]"></span>
                      <span>Blocked (f⊕=0)</span>
                    </span>
                  </div>
                </div>
              </div>

${missionMetricsCardHTML()}

              <!-- Metrics Block 3: Slope Statistics with Adjustable Radius -->
              <div class="p-2.5 rounded-xl bg-[#0F172A] border border-[#1E293B] space-y-2">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-1.5 font-bold text-white text-[11px]">
                    <span class="w-2 h-2 rounded-full bg-rose-400"></span>
                    <span>Landing Slope Statistics</span>
                  </div>
                  <span id="slope-radius-badge" class="text-[10px] font-bold text-cyan-300 font-mono">
                    r = 3.0 km
                  </span>
                </div>

                <!-- Radius Slider & Quick Preset Buttons -->
                <div class="space-y-1.5 pt-0.5">
                  <div class="flex items-center justify-between text-[10px]">
                    <span class="text-slate-400">Evaluation Radius:</span>
                    <div class="flex items-center gap-1">
                      <button class="slope-rad-btn px-1.5 py-0.5 rounded text-[10px] bg-[#1E293B] text-slate-300 hover:text-white" data-radius="1">1 km</button>
                      <button class="slope-rad-btn px-1.5 py-0.5 rounded text-[10px] bg-cyan-600 text-white font-bold" data-radius="3">3 km</button>
                      <button class="slope-rad-btn px-1.5 py-0.5 rounded text-[10px] bg-[#1E293B] text-slate-300 hover:text-white" data-radius="5">5 km</button>
                      <button class="slope-rad-btn px-1.5 py-0.5 rounded text-[10px] bg-[#1E293B] text-slate-300 hover:text-white" data-radius="10">10 km</button>
                    </div>
                  </div>
                  <input
                    type="range"
                    id="slope-radius-slider"
                    min="0.5"
                    max="15.0"
                    step="0.5"
                    value="3.0"
                    class="w-full accent-cyan-400 cursor-pointer h-1 bg-slate-800 rounded-lg"
                  />
                </div>

                <!-- Mean and P95 Readouts -->
                <div class="grid grid-cols-2 gap-2 text-center pt-1">
                  <div class="p-1.5 rounded-lg bg-[#07090E] border border-[#1E293B]">
                    <div class="text-[9px] text-slate-400 uppercase">Mean Slope (μ)</div>
                    <div id="slope-mean-val" class="text-cyan-300 font-bold text-sm tabular-nums">4.2°</div>
                  </div>
                  <div class="p-1.5 rounded-lg bg-[#07090E] border border-[#1E293B]">
                    <div class="text-[9px] text-slate-400 uppercase">95th Percentile (P95)</div>
                    <div id="slope-p95-val" class="text-amber-300 font-bold text-sm tabular-nums">9.8°</div>
                  </div>
                </div>

                <!-- Note explaining why radius is chosen -->
                <p class="text-[9.5px] text-slate-400 leading-snug font-sans pt-1">
                  Slope is computed within a chosen radius instead of over the whole region because landing systems evaluate terrain hazards within specific touchdown ellipses.
                </p>
              </div>

              <!-- Acceptance Tests Link Button -->
              <div class="pt-1">
                <a
                  href="/tests.html"
                  target="_blank"
                  rel="noopener"
                  class="w-full py-2 px-3 rounded-xl bg-cyan-950/60 hover:bg-cyan-900/80 border border-cyan-500/50 text-cyan-200 text-xs font-semibold flex items-center justify-between transition-colors shadow-sm"
                >
                  <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
                    <span>Ephemeris & Geometry Tests (tests.html)</span>
                  </div>
                  <span class="text-[10px] text-cyan-400 font-mono">Open ↗</span>
                </a>
              </div>
            </div>
            </div>
          </aside>
        </div>

        <!-- Tab 2: Region Comparison Tab (Round 5 & Round 7) -->
        <section id="comparison-tab" class="hidden absolute inset-0 z-30 bg-[#07090E]/95 backdrop-blur-md overflow-y-auto nice-scroll p-4 sm:p-8">
          <div class="max-w-7xl mx-auto space-y-6 pb-24">
            <!-- Header Bar -->
            <div class="flex flex-wrap items-center justify-between gap-4 border-b border-[#1E293B] pb-4">
              <div>
                <div class="flex items-center gap-2">
                  <h2 class="text-xl sm:text-2xl font-bold text-white tracking-tight">
                    Artemis III Candidate Landing Region Trade Study
                  </h2>
                  <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                    Weighted Multi-Criteria Ranking
                  </span>
                </div>
                <p class="text-xs text-slate-400 mt-1 font-sans">
                  Nine candidate regions ranked on three mission criteria (solar energy, longest dark interval, DTE coverage) over the chosen mission window. Mast fixed at 10 m; each region uses its own best fixed panel.
                </p>
                <p id="comparison-window-line" class="text-[11px] text-cyan-300 mt-1 font-mono tabular-nums">Window: --</p>
              </div>
              <div class="flex items-center gap-3">
                <button id="btn-recompute-comparison" class="px-3.5 py-1.5 rounded-lg bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-200 text-xs font-semibold font-mono transition-colors flex items-center gap-1.5 shadow">
                  <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>Re-sample Span</span>
                </button>
                <button id="btn-back-to-nav-1" class="px-3.5 py-1.5 rounded-lg bg-[#0F172A] hover:bg-[#1E293B] text-slate-200 text-xs font-semibold border border-[#1E293B] transition-colors">
                  Back to 3D Viewport
                </button>
              </div>
            </div>

            <!-- Mandatory Reviewer Disclaimer (Exact Specified Text) -->
            <div class="p-4 rounded-xl bg-amber-950/40 border border-amber-600/50 text-amber-200 text-xs font-sans leading-relaxed shadow-sm">
              <strong class="font-semibold text-amber-300">Mandatory Reviewer Disclaimer:</strong>
              “NASA candidate region selection also weighs science objectives and launch-window flight dynamics, which this geometric tool does not model.”
            </div>

            <!-- Red Flag Copy Error Notice -->
            <div class="p-3.5 rounded-xl bg-[#0F172A] border border-amber-500/40 text-xs font-mono text-amber-300 flex items-center gap-3">
              <svg class="w-5 h-5 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span><strong>Draft Data Audit Flag:</strong> “Peak near Cabeus B” and “de Gerlache Rim 2” share an identical draft longitude (68.8°W), indicating a copy-paste error in draft materials.</span>
            </div>

            <!-- Round 7: Weighted Ranking Criteria Controller & Sliders -->
            <div class="p-5 rounded-2xl bg-[#0F172A]/80 border border-[#1E293B] backdrop-blur shadow-xl space-y-4 font-mono text-xs">
              <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[#1E293B] pb-3">
                <div class="flex items-center gap-2">
                  <span class="w-2.5 h-2.5 rounded-full bg-cyan-400"></span>
                  <span class="font-bold text-white uppercase tracking-wider text-sm">
                    Multi-Criteria Weighted Ranking Model
                  </span>
                </div>
                <!-- Explicit Weights Sum Readout -->
                <div class="flex items-center gap-2">
                  <span class="text-slate-400 text-[11px]">Weights Sum:</span>
                  <span id="weights-total-badge" class="px-2.5 py-0.5 rounded-lg bg-cyan-950 text-cyan-300 border border-cyan-800 font-bold tabular-nums">
                    100% (Normalized)
                  </span>
                </div>
              </div>

              <!-- Quick Preset Buttons -->
              <div class="flex flex-wrap items-center gap-2 pt-0.5">
                <span class="text-slate-400 text-[11px] uppercase tracking-wider">Presets:</span>
                <button class="rank-preset-btn px-2.5 py-1 rounded-lg bg-cyan-600 text-white font-bold transition-all" data-preset="balanced">
                  Balanced (33 / 33 / 34)
                </button>
                <button class="rank-preset-btn px-2.5 py-1 rounded-lg bg-[#07090E] border border-[#1E293B] text-slate-300 hover:text-white transition-all" data-preset="energy">
                  Energy Priority (60 / 20 / 20)
                </button>
                <button class="rank-preset-btn px-2.5 py-1 rounded-lg bg-[#07090E] border border-[#1E293B] text-slate-300 hover:text-white transition-all" data-preset="dark">
                  Short Darkness Priority (20 / 60 / 20)
                </button>
                <button class="rank-preset-btn px-2.5 py-1 rounded-lg bg-[#07090E] border border-[#1E293B] text-slate-300 hover:text-white transition-all" data-preset="comm">
                  DTE Priority (20 / 20 / 60)
                </button>
              </div>

              <!-- Three Criteria Weight Sliders -->
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                <div class="p-3.5 rounded-xl bg-[#07090E] border border-[#1E293B] space-y-2">
                  <div class="flex items-center justify-between">
                    <span class="flex items-center gap-1.5 font-bold text-amber-300 text-[11px]">
                      <span class="w-2 h-2 rounded-full bg-amber-400"></span>
                      <span>Solar Energy (w1)</span>
                    </span>
                    <span id="weight-label-energy" class="text-white font-bold tabular-nums">33% (33.0%)</span>
                  </div>
                  <input type="range" id="slider-weight-energy" min="0" max="100" value="33" step="1" class="w-full accent-amber-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg" />
                  <div class="text-[10px] text-slate-400 font-sans">
                    Cumulative energy of the region's best fixed panel over the window (Wh). Higher is better.
                  </div>
                </div>

                <div class="p-3.5 rounded-xl bg-[#07090E] border border-[#1E293B] space-y-2">
                  <div class="flex items-center justify-between">
                    <span class="flex items-center gap-1.5 font-bold text-slate-200 text-[11px]">
                      <span class="w-2 h-2 rounded-full bg-slate-300"></span>
                      <span>Shortest Dark Interval (w2)</span>
                    </span>
                    <span id="weight-label-dark" class="text-white font-bold tabular-nums">33% (33.0%)</span>
                  </div>
                  <input type="range" id="slider-weight-dark" min="0" max="100" value="33" step="1" class="w-full accent-slate-300 cursor-pointer h-1.5 bg-slate-800 rounded-lg" />
                  <div class="text-[10px] text-slate-400 font-sans">
                    Longest continuous run without direct Sun (hours). Lower is better.
                  </div>
                </div>

                <div class="p-3.5 rounded-xl bg-[#07090E] border border-[#1E293B] space-y-2">
                  <div class="flex items-center justify-between">
                    <span class="flex items-center gap-1.5 font-bold text-cyan-300 text-[11px]">
                      <span class="w-2 h-2 rounded-full bg-cyan-400"></span>
                      <span>DTE Coverage (w3)</span>
                    </span>
                    <span id="weight-label-comm" class="text-white font-bold tabular-nums">34% (34.0%)</span>
                  </div>
                  <input type="range" id="slider-weight-comm" min="0" max="100" value="34" step="1" class="w-full accent-cyan-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg" />
                  <div class="text-[10px] text-slate-400 font-sans">
                    Share of the window with the Earth centre above the horizon (direct-to-Earth). Higher is better.
                  </div>
                </div>
              </div>

              <!-- Sampling Step Information & Asynchronous Progress Indicator (Round 5) -->
              <div class="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#1E293B]/60 text-[11px] text-slate-400">
                <div class="flex items-center gap-2">
                  <span class="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                  <span id="calc-step-note">
                    Mission window and sampling step are set by the time selector.
                  </span>
                </div>
                <div id="calc-progress-container" class="hidden flex items-center gap-2">
                  <span id="calc-progress-label" class="text-cyan-300 font-bold tabular-nums">Computing: 100%</span>
                  <div class="w-24 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div id="calc-progress-bar" class="h-full bg-cyan-400 rounded-full transition-all duration-150" style="width: 100%;"></div>
                  </div>
                </div>
              </div>

              <!-- Scoring formulation (Collapsible) -->
              <details class="rounded-xl bg-[#07090E] border border-[#1E293B] p-3 text-[11px]">
                <summary class="cursor-pointer font-bold text-cyan-300 flex items-center gap-2 select-none">
                  <span>Scoring formulation</span>
                  <span class="text-[10px] text-slate-500 font-mono font-normal">Click to expand</span>
                </summary>
                <div class="pt-2.5 space-y-2 text-slate-300 font-sans leading-relaxed border-t border-[#1E293B] mt-2 text-xs">
                  <p>
                    Each criterion is min-max normalised across the nine regions, the dark interval inverted, then combined with the weights normalised to 100 %:
                  </p>
                  <ul class="list-disc pl-5 space-y-1 font-mono text-[11px] text-slate-300">
                    <li><code>S_energy = (E − E_min) / (E_max − E_min + ε)</code>, E = Σ P_gen·dt of the region's best fixed panel (A = 10 m², η = 0.29)</li>
                    <li><code>S_dark = (D_max − D) / (D_max − D_min + ε)</code>, D = longest run with I(t) = 0</li>
                    <li><code>S_comm = (DTE − DTE_min) / (DTE_max − DTE_min + ε)</code>, DTE = ΔT_comm / window × 100</li>
                    <li><code>Score = 100 · (w1·S_energy + w2·S_dark + w3·S_comm) / (w1 + w2 + w3)</code></li>
                  </ul>
                  <p class="text-[11px] text-slate-400 font-sans">
                    I(t) and C(t) are binary and use the Sun / Earth centre. Mast 10 m; Navigator panel and mast settings never change these values. A dark interval marked "≥" touches the window edge, so its true length is longer.
                  </p>
                </div>
              </details>
            </div>

            <!-- Full Sortable Comparison & Ranking Table (Round 5 & Round 7) -->
            <div class="overflow-x-auto rounded-2xl border border-[#1E293B] bg-[#0F172A]/70 shadow-2xl">
              <table class="w-full text-left text-xs font-mono">
                <thead class="bg-[#0F172A] border-b border-[#1E293B] text-[11px] text-slate-400 uppercase tracking-wider select-none">
                  <tr>
                    <th class="py-3 px-4 sortable-th cursor-pointer hover:text-white" data-sort="rank">
                      <div class="flex items-center gap-1">
                        <span>Rank</span>
                        <span class="sort-icon text-[10px]"></span>
                      </div>
                    </th>
                    <th class="py-3 px-4 sortable-th cursor-pointer hover:text-white" data-sort="name">
                      <div class="flex items-center gap-1">
                        <span>Candidate Region</span>
                        <span class="sort-icon text-[10px]"></span>
                      </div>
                    </th>
                    <th class="py-3 px-4 sortable-th cursor-pointer hover:text-white" data-sort="score">
                      <div class="flex items-center gap-1 text-cyan-300">
                        <span>Score</span>
                        <span class="sort-icon text-[10px]"></span>
                      </div>
                    </th>
                    <th class="py-3 px-4 sortable-th cursor-pointer hover:text-white" data-sort="energyWh">
                      <div class="flex items-center gap-1 text-amber-300">
                        <span>Energy (Wh)</span>
                        <span class="sort-icon text-[10px]"></span>
                      </div>
                    </th>
                    <th class="py-3 px-4 sortable-th cursor-pointer hover:text-white" data-sort="longestDarkHours">
                      <div class="flex items-center gap-1">
                        <span>Longest Dark (h)</span>
                        <span class="sort-icon text-[10px]"></span>
                      </div>
                    </th>
                    <th class="py-3 px-4 sortable-th cursor-pointer hover:text-white" data-sort="commPercent">
                      <div class="flex items-center gap-1 text-cyan-300">
                        <span>DTE Coverage (%)</span>
                        <span class="sort-icon text-[10px]"></span>
                      </div>
                    </th>
                    <th class="py-3 px-4 sortable-th cursor-pointer hover:text-white" data-sort="totalLitHours">
                      <div class="flex items-center gap-1">
                        <span>Lit (h)</span>
                        <span class="sort-icon text-[10px]"></span>
                      </div>
                    </th>
                    <th class="py-3 px-4 sortable-th cursor-pointer hover:text-white" data-sort="longestCommGapHours">
                      <div class="flex items-center gap-1">
                        <span>Longest Comm Gap (h)</span>
                        <span class="sort-icon text-[10px]"></span>
                      </div>
                    </th>
                    <th class="py-3 px-4 sortable-th cursor-pointer hover:text-white" data-sort="bestTiltDeg">
                      <div class="flex items-center gap-1">
                        <span>Best Tilt / Az</span>
                        <span class="sort-icon text-[10px]"></span>
                      </div>
                    </th>
                    <th class="py-3 px-4 text-center">
                      <span>Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody id="regions-table-body" class="divide-y divide-[#1E293B]/60">
                  <!-- Injected dynamically via _renderComparisonRanking() -->
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- Tab 3: Data & Methods Tab (Round 6) -->
        <section id="methods-tab" class="hidden absolute inset-0 z-30 bg-[#07090E]/95 backdrop-blur-md overflow-y-auto nice-scroll p-4 sm:p-8">
          <div class="max-w-7xl mx-auto space-y-6 pb-24">
            <!-- Header Bar -->
            <div class="flex flex-wrap items-center justify-between gap-4 border-b border-[#1E293B] pb-4">
              <div>
                <div class="flex items-center gap-2">
                  <h2 class="text-xl sm:text-2xl font-bold text-white tracking-tight">
                    Data & Methods Scientific Specification
                  </h2>
                  <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                    DATA_AND_METHODS.md
                  </span>
                </div>
                <p class="text-xs text-slate-400 mt-1 font-sans">
                  Mathematical derivations, coordinate reference frames, optical and physical ephemeris algorithms, and topographic ray-marching methods.
                </p>
              </div>
              <div class="flex items-center gap-3">
                <a href="/tests.html" target="_blank" rel="noopener" class="px-3.5 py-1.5 rounded-lg bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-200 text-xs font-semibold transition-colors flex items-center gap-1.5 shadow">
                  <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
                  <span>Validation Test Suite (tests.html) ↗</span>
                </a>
                <button id="btn-back-to-nav-2" class="px-3.5 py-1.5 rounded-lg bg-[#0F172A] hover:bg-[#1E293B] text-slate-200 text-xs font-semibold border border-[#1E293B] transition-colors">
                  Back to 3D Viewport
                </button>
              </div>
            </div>

            <!-- 1. Live Data & Topography Status (Live DEM & Regions Status) -->
            ${liveDataStatusHtml}

            <!-- 2. Interactive Document Layout with In-Page Table of Contents -->
            <div class="lg:flex lg:gap-8 items-start pt-2">
              <!-- Sticky Sidebar Table of Contents (Desktop) & Collapsible Dropdown (Mobile) -->
              <aside class="lg:w-72 shrink-0 mb-6 lg:mb-0 lg:sticky lg:top-4 rounded-2xl bg-[#0F172A]/90 border border-[#1E293B] p-4 shadow-xl backdrop-blur">
                <div class="flex items-center justify-between pb-2 border-b border-[#1E293B] mb-2">
                  <div class="flex items-center gap-2">
                    <svg class="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7" />
                    </svg>
                    <span class="text-xs font-bold font-mono text-white uppercase tracking-wider">Table of Contents</span>
                  </div>
                  <button id="btn-toggle-mobile-toc" class="lg:hidden text-slate-400 hover:text-white p-1 text-xs">
                    <svg id="mobile-toc-chevron" class="w-3.5 h-3.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>

                <div id="toc-nav-container" class="space-y-1 max-h-[70vh] overflow-y-auto nice-scroll font-mono text-xs pr-1">
                  <a href="#live-data-status" class="toc-link block px-2.5 py-1.5 rounded-lg text-slate-300 hover:text-cyan-300 hover:bg-[#1E293B]/60 transition-colors flex items-center gap-2">
                    <span class="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                    <span>0. Live Topography Status</span>
                  </a>
                  <div id="methods-toc-doc-links" class="space-y-1">
                    <span class="text-slate-500 text-[11px] px-2.5 py-1 block">Loading sections...</span>
                  </div>
                </div>
              </aside>

              <!-- Main Document Render Container (Single Source of Truth) -->
              <article id="methods-doc-content" class="flex-1 min-w-0 p-6 sm:p-8 rounded-2xl bg-[#0F172A]/70 border border-[#1E293B] shadow-2xl backdrop-blur space-y-4 font-sans text-slate-300 leading-relaxed text-xs">
                <div class="flex items-center gap-2 text-slate-400 font-mono text-xs p-4">
                  <span class="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse"></span>
                  <span>Loading DATA_AND_METHODS.md from runtime server...</span>
                </div>
              </article>
            </div>
          </div>
        </section>

        <!-- Round 3 Bottom Dock: Complete Time Control Suite -->
        <footer id="bottom-dock" aria-label="Mission Time Controls" class="absolute bottom-0 left-0 right-0 z-30 bg-[#07090E]/95 backdrop-blur border-t border-[#1E293B] shadow-2xl transition-all duration-200">
          <!-- Dock Collapser Handle -->
          <div id="btn-toggle-dock" class="flex items-center justify-between px-6 py-2 bg-[#0F172A]/70 text-xs cursor-pointer select-none border-b border-[#1E293B]/60">
            <div class="flex items-center gap-3">
              <span class="text-[11px] font-mono uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <svg class="w-3.5 h-3.5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Simulation Time Scrubber & Controls
              </span>
              <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                Delta-Time Engine (No Drift)
              </span>
            </div>
            <button class="text-slate-400 hover:text-white flex items-center gap-1.5 text-[11px] font-mono">
              <span id="dock-status-label">Collapse</span>
              <svg id="dock-chevron" class="w-3.5 h-3.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          <!-- Dock Controls Body -->
          <div id="dock-body" class="p-4 sm:p-5 space-y-3.5">
            <!-- Row 1: Time Scrubber & Span Controls -->
            <div class="space-y-1.5">
              <div class="flex flex-wrap items-center justify-between text-xs font-mono gap-2">
                <div class="flex items-center gap-2">
                  <span class="text-slate-400">simTime:</span>
                  <span id="slider-day-label" class="text-cyan-300 font-bold text-sm font-mono tabular-nums">T+ 0.00 days</span>
                  <span class="text-slate-500">|</span>
                  <span id="slider-utc-label" class="text-white font-medium font-mono tabular-nums">2026-11-01 00:00:00 UTC</span>
                </div>

                <!-- Span Selector (up to 365 days) -->
                <div class="flex items-center gap-1.5 text-[11px] font-mono">
                  <span class="text-slate-400">Scrub Span:</span>
                  <div class="flex items-center rounded-lg bg-[#0F172A] border border-[#1E293B] p-0.5">
                    <button class="span-btn px-2 py-0.5 rounded bg-cyan-600 text-white font-bold" data-span="30">30d</button>
                    <button class="span-btn px-2 py-0.5 rounded text-slate-400 hover:text-white" data-span="90">90d</button>
                    <button class="span-btn px-2 py-0.5 rounded text-slate-400 hover:text-white" data-span="180">180d</button>
                    <button class="span-btn px-2 py-0.5 rounded text-slate-400 hover:text-white" data-span="365">365d</button>
                  </div>
                </div>
              </div>

              <!-- Continuous Scrubber Range Slider -->
              <input type="range" id="sim-slider" min="0" max="30" step="0.05" value="0" class="w-full accent-cyan-400 cursor-pointer sim-range" />

              <div class="flex justify-between text-[10px] font-mono text-slate-500 tabular-nums">
                <span>T+ 0.00d</span>
                <span id="span-mid-label">T+ 15.00d</span>
                <span id="span-max-label">T+ 30.00d</span>
              </div>
            </div>

            <!-- Row 2: Playback Controls, Speed, Start-Epoch Picker & Astronomical Jumps -->
            <div class="flex flex-wrap items-center justify-between gap-3 text-xs font-mono pt-1 border-t border-[#1E293B]/60">
              <!-- Left: Play/Pause and Speeds (1×, 5×, 20×, 100×) -->
              <div class="flex items-center gap-2">
                <button id="btn-play-pause" class="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold flex items-center gap-1.5 transition-colors shadow">
                  <svg id="icon-play" class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  <svg id="icon-pause" class="w-3.5 h-3.5 hidden" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                  <span id="play-pause-label">Play</span>
                </button>

                <div class="flex items-center rounded-lg bg-[#0F172A] border border-[#1E293B] p-0.5 text-[11px]">
                  <button class="speed-btn px-2.5 py-1 rounded text-slate-400 hover:text-white" data-speed="1">1×</button>
                  <button class="speed-btn px-2.5 py-1 rounded bg-cyan-600 text-white font-bold" data-speed="5">5×</button>
                  <button class="speed-btn px-2.5 py-1 rounded text-slate-400 hover:text-white" data-speed="20">20×</button>
                  <button class="speed-btn px-2.5 py-1 rounded text-slate-400 hover:text-white" data-speed="100">100×</button>
                </div>
              </div>

              <!-- Center: Start-Epoch Picker (default: today, UTC) -->
              <div class="flex items-center gap-2">
                <label for="epoch-date-picker" class="text-slate-400 text-[11px]">Start Epoch (UTC):</label>
                <input
                  type="date"
                  id="epoch-date-picker"
                  value="${todayStr}"
                  class="px-2.5 py-1 rounded-lg bg-[#0F172A] border border-[#1E293B] text-white text-[11px] font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <!-- Right: Jump Buttons (+1d, +7d, Next New Moon, Next Full Moon) -->
              <div class="flex flex-wrap items-center gap-1.5">
                <button id="jump-reset" class="px-2.5 py-1.5 rounded-lg bg-[#0F172A] border border-[#1E293B] text-slate-300 hover:text-white transition-colors" title="Jump to Day 0">
                  Reset (T+0)
                </button>
                <button id="jump-plus-1d" class="px-2.5 py-1.5 rounded-lg bg-[#0F172A] border border-[#1E293B] text-slate-300 hover:text-white transition-colors" title="Advance by +1 Day">
                  +1 Day
                </button>
                <button id="jump-plus-7d" class="px-2.5 py-1.5 rounded-lg bg-[#0F172A] border border-[#1E293B] text-slate-300 hover:text-white transition-colors" title="Advance by +7 Days (1 Week)">
                  +7 Days
                </button>
                <button id="jump-next-new-moon" class="px-2.5 py-1.5 rounded-lg bg-[#0F172A] border border-[#1E293B] text-amber-300 hover:text-white hover:border-amber-400 transition-colors flex items-center gap-1" title="Jump to Next New Moon (phase 0°)">
                  <span class="w-1.5 h-1.5 rounded-full bg-slate-500"></span>
                  <span>Next New Moon</span>
                </button>
                <button id="jump-next-full-moon" class="px-2.5 py-1.5 rounded-lg bg-[#0F172A] border border-[#1E293B] text-amber-300 hover:text-white hover:border-amber-400 transition-colors flex items-center gap-1" title="Jump to Next Full Moon (phase 180°)">
                  <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                  <span>Next Full Moon</span>
                </button>
              </div>
            </div>
          </div>
        </footer>
      </main>
    `;
  }

  _bindEvents() {
    // Navigation Tabs
    const btnNav = document.getElementById('nav-btn-navigator');
    const btnComp = document.getElementById('nav-btn-comparison');
    const btnMeth = document.getElementById('nav-btn-methods');

    const tabNav = document.getElementById('navigator-tab');
    const tabComp = document.getElementById('comparison-tab');
    const tabMeth = document.getElementById('methods-tab');

    const setActiveTab = (tabName) => {
      this.activeTab = tabName;
      [btnNav, btnComp, btnMeth].forEach((btn) => {
        btn.className = 'nav-tab flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-transparent transition-colors text-slate-400 hover:text-white';
      });

      tabNav.classList.add('hidden');
      tabComp.classList.add('hidden');
      tabMeth.classList.add('hidden');

      if (tabName === 'navigator') {
        btnNav.className = 'nav-tab active flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cyan-500/40 bg-cyan-950/40 text-cyan-300 font-semibold';
        tabNav.classList.remove('hidden');
      } else if (tabName === 'comparison') {
        btnComp.className = 'nav-tab active flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cyan-500/40 bg-cyan-950/40 text-cyan-300 font-semibold';
        tabComp.classList.remove('hidden');
      } else if (tabName === 'methods') {
        btnMeth.className = 'nav-tab active flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cyan-500/40 bg-cyan-950/40 text-cyan-300 font-semibold';
        tabMeth.classList.remove('hidden');
        this._loadMethodsDoc();
      }
    };

    btnNav.addEventListener('click', () => setActiveTab('navigator'));
    btnComp.addEventListener('click', () => setActiveTab('comparison'));
    btnMeth.addEventListener('click', () => setActiveTab('methods'));

    document.getElementById('btn-back-to-nav-1').addEventListener('click', () => setActiveTab('navigator'));
    document.getElementById('btn-back-to-nav-2').addEventListener('click', () => setActiveTab('navigator'));

    // Table of Contents Smooth Scroll Navigation (Round 6)
    const methodsTab = document.getElementById('methods-tab');
    if (methodsTab) {
      methodsTab.querySelectorAll('.toc-link').forEach((link) => {
        link.addEventListener('click', (e) => {
          const targetId = link.getAttribute('href').replace('#', '');
          const targetEl = document.getElementById(targetId);
          if (targetEl) {
            e.preventDefault();
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
      });
    }

    // Mobile Table of Contents Collapse Toggle
    const btnToggleMobileToc = document.getElementById('btn-toggle-mobile-toc');
    const tocNavContainer = document.getElementById('toc-nav-container');
    const mobileTocChevron = document.getElementById('mobile-toc-chevron');

    if (btnToggleMobileToc && tocNavContainer) {
      let isMobileTocOpen = true;
      btnToggleMobileToc.addEventListener('click', () => {
        isMobileTocOpen = !isMobileTocOpen;
        if (isMobileTocOpen) {
          tocNavContainer.classList.remove('hidden');
          if (mobileTocChevron) mobileTocChevron.style.transform = 'rotate(0deg)';
        } else {
          tocNavContainer.classList.add('hidden');
          if (mobileTocChevron) mobileTocChevron.style.transform = 'rotate(180deg)';
        }
      });
    }

    // Mode Toggle (Moon Globe / Orrery / South Pole)
    const modeBtnGlobe = document.getElementById('mode-btn-globe');
    const modeBtnOrrery = document.getElementById('mode-btn-orrery');
    const modeBtnPole = document.getElementById('mode-btn-pole');
    const globeControls = document.getElementById('globe-controls-box');
    const orreryControls = document.getElementById('orrery-controls-box');
    const poleControls = document.getElementById('pole-controls-box');
    const orreryHud = document.getElementById('orrery-telemetry-hud');
    const polePanel = document.getElementById('pole-region-panel');
    const selectPanel = document.getElementById('pole-select-panel');

    const MODE_ON = 'px-3 py-1 rounded-lg bg-cyan-600 text-white font-semibold transition-all';
    const MODE_OFF = 'px-3 py-1 rounded-lg text-slate-400 hover:text-white transition-all';

    const setMode = (mode) => {
      const prev = this.viewMode;
      this.viewMode = mode;
      modeBtnGlobe.className = mode === 'globe' ? MODE_ON : MODE_OFF;
      modeBtnOrrery.className = mode === 'orrery' ? MODE_ON : MODE_OFF;
      modeBtnPole.className = mode === 'south_pole' ? MODE_ON : MODE_OFF;
      globeControls.classList.toggle('hidden', mode !== 'globe');
      orreryControls.classList.toggle('hidden', mode !== 'orrery');
      orreryHud.classList.toggle('hidden', mode !== 'orrery');
      poleControls.classList.toggle('hidden', mode !== 'south_pole');
      polePanel.classList.toggle('hidden', mode !== 'south_pole');
      selectPanel.classList.toggle('hidden', mode !== 'south_pole');
      if (mode !== 'globe') this.showPinTooltip({ visible: false });
      this._renderGlobeSelection();
      if (this.callbacks.onSetViewMode) {
        this.callbacks.onSetViewMode(mode);
      }
      // Cutting between the globe and another view: fade in from black
      if (prev !== mode && (prev === 'globe' || mode === 'globe')) this._fadeFromBlack();
    };
    this._setViewMode = setMode;

    modeBtnGlobe.addEventListener('click', () => setMode('globe'));
    modeBtnOrrery.addEventListener('click', () => setMode('orrery'));
    modeBtnPole.addEventListener('click', () => setMode('south_pole'));
    document.getElementById('btn-back-to-globe')?.addEventListener('click', () => setMode('globe'));
    document.getElementById('btn-globe-view-pole')?.addEventListener('click', () => this.viewGlobeSelectionInPole());
    document.getElementById('btn-globe-select-clear')?.addEventListener('click', () => this.setGlobeSelection(null));
    document.getElementById('btn-globe-focus-south')?.addEventListener('click', () => {
      if (this.callbacks.onGlobeFocusSouthPole) this.callbacks.onGlobeFocusSouthPole();
    });

    document.getElementById('btn-dock-overview')?.addEventListener('click', () => {
      if (this.callbacks.onDockPolarOverview) {
        this.callbacks.onDockPolarOverview();
      }
    });

    // Camera Presets
    const presetOverview = document.getElementById('cam-preset-overview');
    const presetEarth = document.getElementById('cam-preset-earth');
    const presetMoon = document.getElementById('cam-preset-moon');
    const presetSun = document.getElementById('cam-preset-sun');
    const presetSystem = document.getElementById('cam-preset-system');
    const presetButtons = [presetOverview, presetEarth, presetMoon, presetSun, presetSystem];

    const applyPreset = (presetName, activeBtn) => {
      this.cameraPreset = presetName;
      presetButtons.forEach(btn => {
        btn.className = 'px-2.5 py-1 rounded-lg text-slate-400 hover:text-white transition-all';
      });
      activeBtn.className = 'px-2.5 py-1 rounded-lg bg-cyan-600 text-white font-semibold transition-all';
      if (this.callbacks.onSetCameraPreset) {
        this.callbacks.onSetCameraPreset(presetName);
      }
    };

    presetOverview.addEventListener('click', () => applyPreset('overview', presetOverview));
    presetEarth.addEventListener('click', () => applyPreset('earth', presetEarth));
    presetMoon.addEventListener('click', () => applyPreset('moon', presetMoon));
    presetSun.addEventListener('click', () => applyPreset('sun', presetSun));
    presetSystem.addEventListener('click', () => applyPreset('system', presetSystem));

    // Collapsible floating panels: Select Region (left) and Analysis & Charts (right)
    const bindCollapse = (btnId, bodyId, chevronId, labelId, stateKey) => {
      const btn = document.getElementById(btnId);
      const body = document.getElementById(bodyId);
      const chevron = document.getElementById(chevronId);
      const label = document.getElementById(labelId);
      btn.addEventListener('click', () => {
        this[stateKey] = !this[stateKey];
        body.classList.toggle('hidden', this[stateKey]);
        chevron.style.transform = this[stateKey] ? 'rotate(180deg)' : 'rotate(0deg)';
        label.textContent = this[stateKey] ? 'Show' : 'Hide';
        btn.setAttribute('aria-expanded', String(!this[stateKey]));
      });
    };
    bindCollapse('btn-toggle-region-list', 'select-panel-body', 'region-list-chevron', 'region-list-toggle-label', 'isRegionListCollapsed');
    bindCollapse('btn-toggle-analysis-panel', 'analysis-panel-body', 'analysis-panel-chevron', 'analysis-panel-toggle-label', 'isAnalysisPanelCollapsed');

    this._bindPickPointForm();

    // Bottom Dock Toggle
    const btnToggleDock = document.getElementById('btn-toggle-dock');
    const dockBody = document.getElementById('dock-body');
    const dockLabel = document.getElementById('dock-status-label');
    const dockChevron = document.getElementById('dock-chevron');

    btnToggleDock.addEventListener('click', () => {
      this.isDockCollapsed = !this.isDockCollapsed;
      if (this.isDockCollapsed) {
        dockBody.classList.add('hidden');
        dockLabel.textContent = 'Expand';
        dockChevron.style.transform = 'rotate(180deg)';
      } else {
        dockBody.classList.remove('hidden');
        dockLabel.textContent = 'Collapse';
        dockChevron.style.transform = 'rotate(0deg)';
      }
    });

    // Timeline Scrubber Slider input
    const simSlider = document.getElementById('sim-slider');
    simSlider.addEventListener('input', (e) => {
      timeStore.setElapsedDays(parseFloat(e.target.value));
    });

    // Span Selector Buttons (30d, 90d, 180d, 365d)
    const spanButtons = document.querySelectorAll('.span-btn');
    spanButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const span = parseInt(btn.dataset.span, 10);
        spanButtons.forEach(b => {
          b.className = 'span-btn px-2 py-0.5 rounded text-slate-400 hover:text-white';
        });
        btn.className = 'span-btn px-2 py-0.5 rounded bg-cyan-600 text-white font-bold';

        timeStore.setMaxDays(span);
        simSlider.max = span.toString();
        document.getElementById('span-max-label').textContent = `T+ ${span.toFixed(2)}d`;
        document.getElementById('span-mid-label').textContent = `T+ ${(span / 2).toFixed(2)}d`;

        // Update Round 9 Earth Elevation Libration Chart
        if (this.earthElevationChart) {
          this.earthElevationChart.setData(this.selectedRegion, timeStore.baseEpoch, span);
        }

        // Re-run Round 5 / 7 Regional Comparison Evaluation
        this._runComparisonCalculation(true);
      });
    });

    // Start-Epoch Date Picker (default: today, UTC)
    const epochPicker = document.getElementById('epoch-date-picker');
    epochPicker.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val) {
        // Construct UTC midnight date
        const [year, month, day] = val.split('-').map(Number);
        const newEpoch = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
        timeStore.setBaseEpoch(newEpoch);

        // Update Round 9 Earth Elevation Libration Chart
        if (this.earthElevationChart) {
          this.earthElevationChart.setData(this.selectedRegion, newEpoch, timeStore.maxDays);
        }

        // Re-run Round 5 / 7 Regional Comparison Evaluation
        this._runComparisonCalculation(true);
      }
    });

    // Play / Pause toggle
    const btnPlayPause = document.getElementById('btn-play-pause');
    btnPlayPause.addEventListener('click', () => {
      timeStore.togglePlay();
    });

    // Speed multiplier buttons
    const speedButtons = document.querySelectorAll('.speed-btn');
    speedButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const speed = parseFloat(btn.dataset.speed);
        speedButtons.forEach(b => {
          b.className = 'speed-btn px-2.5 py-1 rounded text-slate-400 hover:text-white';
        });
        btn.className = 'speed-btn px-2.5 py-1 rounded bg-cyan-600 text-white font-bold';
        timeStore.setPlaybackSpeed(speed);
      });
    });

    // Round 3 Jump Buttons (+1d, +7d, next New Moon, next Full Moon, Reset)
    document.getElementById('jump-reset').addEventListener('click', () => {
      timeStore.setElapsedDays(0.0);
    });

    document.getElementById('jump-plus-1d').addEventListener('click', () => {
      timeStore.addElapsedDays(1.0);
    });

    document.getElementById('jump-plus-7d').addEventListener('click', () => {
      timeStore.addElapsedDays(7.0);
    });

    document.getElementById('jump-next-new-moon').addEventListener('click', () => {
      timeStore.jumpToNextNewMoon();
    });

    document.getElementById('jump-next-full-moon').addEventListener('click', () => {
      timeStore.jumpToNextFullMoon();
    });

    // Slope Radius Evaluation Controls (Round 4)
    const slopeSlider = document.getElementById('slope-radius-slider');
    const slopeRadBadge = document.getElementById('slope-radius-badge');
    const slopeButtons = document.querySelectorAll('.slope-rad-btn');

    const updateSlopeRadius = (radKm) => {
      this.slopeRadiusKm = radKm;
      if (slopeSlider) slopeSlider.value = radKm.toString();
      if (slopeRadBadge) slopeRadBadge.textContent = `r = ${radKm.toFixed(1)} km`;

      slopeButtons.forEach((btn) => {
        const bRad = parseFloat(btn.dataset.radius);
        if (Math.abs(bRad - radKm) < 0.1) {
          btn.className = 'slope-rad-btn px-1.5 py-0.5 rounded text-[10px] bg-cyan-600 text-white font-bold';
        } else {
          btn.className = 'slope-rad-btn px-1.5 py-0.5 rounded text-[10px] bg-[#1E293B] text-slate-300 hover:text-white';
        }
      });

      if (this.callbacks.onSlopeRadiusChange) {
        this.callbacks.onSlopeRadiusChange(radKm);
      }
    };

    if (slopeSlider) {
      slopeSlider.addEventListener('input', (e) => {
        updateSlopeRadius(parseFloat(e.target.value));
      });
    }

    slopeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const rad = parseFloat(btn.dataset.radius);
        updateSlopeRadius(rad);
      });
    });

    // Layers & Charts: one setLayer() drives the right-menu toggles, the HUD buttons and the scene.
    const layerButtons = Array.from(document.querySelectorAll('[data-layer]'));
    const layerDefById = Object.fromEntries(POLE_LAYER_DEFS.map((d) => [d.id, d]));

    const refreshLayerButtons = () => {
      for (const btn of layerButtons) {
        const def = layerDefById[btn.dataset.layer];
        const pill = btn.querySelector('[data-layer-pill]');
        if (!def) continue;
        if (!def.available) {
          btn.disabled = true;
          btn.setAttribute('aria-disabled', 'true');
          btn.setAttribute('aria-checked', 'false');
          btn.className = `${LAYER_BTN_BASE} ${LAYER_BTN_DISABLED}`;
          if (pill) { pill.textContent = 'SOON'; pill.className = `${LAYER_PILL_BASE} ${LAYER_PILL_DISABLED}`; }
          continue;
        }
        const on = Boolean(this.layers[def.id]);
        btn.setAttribute('aria-checked', on ? 'true' : 'false');
        btn.className = `${LAYER_BTN_BASE} ${on ? LAYER_BTN_ON : LAYER_BTN_OFF}`;
        if (pill) { pill.textContent = on ? 'ON' : 'OFF'; pill.className = `${LAYER_PILL_BASE} ${on ? LAYER_PILL_ON : LAYER_PILL_OFF}`; }
      }
      // Small HUD buttons in the inspector stay in sync with the menu.
      const btnHud = document.getElementById('btn-hud-toggle-ray');
      if (btnHud) {
        const on = this.layers.commsRay;
        btnHud.textContent = `Ray: ${on ? 'ON' : 'OFF'}`;
        btnHud.className = on
          ? 'px-2 py-0.5 rounded bg-cyan-950/70 border border-cyan-500/50 text-cyan-200 text-[10px] font-bold hover:bg-cyan-900/60 transition-colors'
          : 'px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 text-[10px] font-bold hover:bg-slate-700 transition-colors';
      }
    };

    const setLayer = (id, on) => {
      const def = layerDefById[id];
      if (!def || !def.available) return;
      const next = Boolean(on);
      this.layers[id] = next;

      if (id === 'earthChart') {
        const chartPanel = document.getElementById('earth-chart-panel');
        if (chartPanel) {
          chartPanel.classList.toggle('hidden', !next);
          if (next && this.earthElevationChart) {
            this.earthElevationChart.setData(this.selectedRegion, timeStore.baseEpoch, timeStore.maxDays);
            this.earthElevationChart.resize();
          }
        }
      } else if (id === 'sunChart' || id === 'energyChart') {
        const panelId = id === 'sunChart' ? 'sun-chart-panel' : 'energy-chart-panel';
        document.getElementById(panelId)?.classList.toggle('hidden', !next);
        if (next) {
          (id === 'sunChart' ? this.sunChart : this.energyChart)?.resize();
          this.callbacks.onRequestUpdate?.();
          this._syncAnalysisCharts();
        }
      } else if (id === 'commsRay') {
        this.callbacks.onToggleCommsRay?.(next);
      } else if (id === 'earthGlobe') {
        this.callbacks.onToggleEarthGlobe?.(next);
      } else {
        this.callbacks.onToggleLayer?.(id, next);
      }
      refreshLayerButtons();
    };

    for (const btn of layerButtons) {
      btn.addEventListener('click', () => setLayer(btn.dataset.layer, !this.layers[btn.dataset.layer]));
    }
    document.getElementById('btn-hud-toggle-ray')?.addEventListener('click', () => setLayer('commsRay', !this.layers.commsRay));
    document.getElementById('btn-hud-open-chart')?.addEventListener('click', () => setLayer('earthChart', true));
    document.getElementById('btn-close-earth-chart')?.addEventListener('click', () => setLayer('earthChart', false));
    document.getElementById('btn-close-sun-chart')?.addEventListener('click', () => setLayer('sunChart', false));
    document.getElementById('btn-close-energy-chart')?.addEventListener('click', () => setLayer('energyChart', false));
    refreshLayerButtons();

    // Phase 10: three-criteria weight sliders & presets
    const sliderEnergy = document.getElementById('slider-weight-energy');
    const sliderDark = document.getElementById('slider-weight-dark');
    const sliderComm = document.getElementById('slider-weight-comm');
    const labelEnergy = document.getElementById('weight-label-energy');
    const labelDark = document.getElementById('weight-label-dark');
    const labelComm = document.getElementById('weight-label-comm');
    const badgeTotal = document.getElementById('weights-total-badge');

    const updateWeights = () => {
      const wE = parseInt(sliderEnergy.value, 10);
      const wD = parseInt(sliderDark.value, 10);
      const wC = parseInt(sliderComm.value, 10);
      this.weights = { energy: wE, dark: wD, comm: wC };

      // Actual (normalised) percentages shown next to the raw slider values
      const total = wE + wD + wC;
      const pct = (w) => (total > 0 ? ((w / total) * 100).toFixed(1) : '0.0');
      if (labelEnergy) labelEnergy.textContent = `${wE} (${pct(wE)}%)`;
      if (labelDark) labelDark.textContent = `${wD} (${pct(wD)}%)`;
      if (labelComm) labelComm.textContent = `${wC} (${pct(wC)}%)`;
      if (badgeTotal) badgeTotal.textContent = total > 0 ? '100% (Normalized)' : 'All weights 0: scores are 0';

      this._renderComparisonRanking();
    };

    if (sliderEnergy && sliderDark && sliderComm) {
      sliderEnergy.addEventListener('input', updateWeights);
      sliderDark.addEventListener('input', updateWeights);
      sliderComm.addEventListener('input', updateWeights);
    }

    const presetWeights = {
      balanced: { ...COMPARISON_DEFAULT_WEIGHTS },
      energy: { energy: 60, dark: 20, comm: 20 },
      dark: { energy: 20, dark: 60, comm: 20 },
      comm: { energy: 20, dark: 20, comm: 60 },
    };

    document.querySelectorAll('.rank-preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = presetWeights[btn.dataset.preset];
        if (target && sliderEnergy && sliderDark && sliderComm) {
          sliderEnergy.value = String(target.energy);
          sliderDark.value = String(target.dark);
          sliderComm.value = String(target.comm);
          document.querySelectorAll('.rank-preset-btn').forEach((b) => {
            b.className = 'rank-preset-btn px-2.5 py-1 rounded-lg bg-[#07090E] border border-[#1E293B] text-slate-300 hover:text-white transition-all';
          });
          btn.className = 'rank-preset-btn px-2.5 py-1 rounded-lg bg-cyan-600 text-white font-bold transition-all';
          updateWeights();
        }
      });
    });
    if (sliderEnergy && sliderDark && sliderComm) updateWeights();

    document.getElementById('btn-recompute-comparison')?.addEventListener('click', () => {
      this._runComparisonCalculation(true);
    });

    // Sortable Column Headers
    document.querySelectorAll('.sortable-th').forEach((th) => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (this.sortColumn === col) {
          this.sortAscending = !this.sortAscending;
        } else {
          this.sortColumn = col;
          this.sortAscending = col === 'name' || col === 'rank' || col === 'longestDarkHours' || col === 'longestCommGapHours';
        }
        this._renderComparisonRanking();
      });
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        timeStore.togglePlay();
      } else if (e.code === 'KeyP') {
        setMode(this.viewMode === 'south_pole' ? 'orrery' : 'south_pole');
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        timeStore.addElapsedDays(1.0);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        timeStore.addElapsedDays(-1.0);
      } else if (e.code === 'Digit1') {
        presetOverview.click();
      } else if (e.code === 'Digit2') {
        presetEarth.click();
      } else if (e.code === 'Digit3') {
        presetMoon.click();
      } else if (e.code === 'Digit4') {
        presetSun.click();
      }
    });
  }

  _populateRegionListPanel() {
    const container = document.getElementById('region-list-content');
    if (!container) return;

    container.innerHTML = this.regions.map((reg) => {
      const isSelected = reg.id === this.selectedRegion.id;
      const elev = getElevationAt(reg.lat, reg.lon);
      const isDuplicateLon = reg.id === 'peak-near-cabeus-b' || reg.id === 'de-gerlache-rim-2';

      return `
        <div class="region-item flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer ${isSelected ? 'bg-cyan-950/50 border-cyan-500 text-white' : 'bg-[#0F172A]/70 border-[#1E293B] hover:bg-[#1E293B]/70 text-slate-300'}" data-region-id="${reg.id}">
          <div class="space-y-0.5">
            <div class="font-bold text-xs flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full ${isSelected ? 'bg-cyan-400' : 'bg-amber-400'}"></span>
              <span>${reg.name}</span>
              ${isDuplicateLon ? '<span class="text-[9px] px-1 py-px rounded bg-amber-950 text-amber-300 border border-amber-600/40">Copy Flag</span>' : ''}
            </div>
            <div class="text-[10px] font-mono tabular-nums text-slate-400">
              ${formatRegionCoords(reg)} · ${regionKindLabel(reg)}
            </div>
          </div>
          <div class="text-right font-mono tabular-nums">
            <div class="text-[11px] font-bold ${elev >= 0 ? 'text-cyan-300' : 'text-slate-400'}">
              ${elev >= 0 ? '+' : ''}${elev.toFixed(2)} km
            </div>
            <div class="text-[9px] text-slate-500 uppercase">
              ${regionStatusLabel(reg)}
            </div>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.region-item').forEach((item) => {
      item.addEventListener('click', () => {
        const regId = item.dataset.regionId;
        const reg = this.regions.find((r) => r.id === regId);
        if (reg) {
          this.selectRegion(reg);
          if (this.callbacks.onSelectRegion) {
            this.callbacks.onSelectRegion(reg);
          }
        }
      });
    });
  }

  selectRegion(region) {
    this.selectedRegion = region;
    if (region.kind !== 'user_point') this.lastRealRegion = region;
    this._populateRegionListPanel();

    const nameEl = document.getElementById('inspector-region-name');
    const coordsEl = document.getElementById('inspector-region-coords');
    const elevEl = document.getElementById('inspector-region-elev');

    if (nameEl) nameEl.textContent = region.name;
    if (coordsEl) coordsEl.textContent = `${formatRegionCoords(region)} · ${regionKindLabel(region)}`;

    const elev = getElevationAt(region.lat, region.lon);
    if (elevEl) elevEl.textContent = `${elev >= 0 ? '+' : ''}${elev.toFixed(2)} km`;
    const statusEl = document.getElementById('inspector-region-status');
    if (statusEl) statusEl.textContent = regionStatusLabel(region);
    this._updatePoleDistance(region);

    if (this.earthElevationChart && this.isEarthChartVisible) {
      this.earthElevationChart.setData(region, timeStore.baseEpoch, timeStore.maxDays);
    }
  }

  /** Distance from the pole is shown for user-picked points only */
  _updatePoleDistance(region) {
    const el = document.getElementById('inspector-region-pole-dist');
    if (!el) return;
    if (region.kind === 'user_point') {
      el.textContent = `Distance from pole: ${distanceFromPoleKm(region.lat, region.lon).toFixed(1)} km`;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  showPickMessage(message) {
    const el = document.getElementById('pick-point-msg');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('hidden', !message);
  }

  _bindPickPointForm() {
    const latEl = document.getElementById('pick-lat-input');
    const lonEl = document.getElementById('pick-lon-input');
    const analyseBtn = document.getElementById('btn-pick-analyse');
    const clearBtn = document.getElementById('btn-pick-clear');
    if (!latEl || !lonEl || !analyseBtn || !clearBtn) return;

    const submit = () => {
      const result = validatePickedPointFromForm(latEl.value, lonEl.value);
      if (!result.ok) {
        this.showPickMessage(result.message);
        return;
      }
      this.showPickMessage('');
      if (this.callbacks.onPickPoint) this.callbacks.onPickPoint(result);
    };

    analyseBtn.addEventListener('click', submit);
    [latEl, lonEl].forEach((el) => {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      });
    });
    clearBtn.addEventListener('click', () => {
      if (this.callbacks.onClearPickedPoint) this.callbacks.onClearPickedPoint();
    });
  }

  /** Called by the app after a point was picked (form or terrain click): fills the form and selects it */
  setUserPoint(region) {
    this.hasUserPoint = true;
    const latEl = document.getElementById('pick-lat-input');
    const lonEl = document.getElementById('pick-lon-input');
    if (latEl) latEl.value = Math.abs(region.lat).toFixed(4);
    if (lonEl) lonEl.value = region.lon.toFixed(4);
    document.getElementById('btn-pick-clear')?.classList.remove('hidden');
    this.showPickMessage('');
    this.selectRegion(region);
  }

  /** Removes the user point from the UI and re-selects the previously selected real region */
  clearUserPoint() {
    this.hasUserPoint = false;
    const latEl = document.getElementById('pick-lat-input');
    const lonEl = document.getElementById('pick-lon-input');
    if (latEl) latEl.value = '';
    if (lonEl) lonEl.value = '';
    document.getElementById('btn-pick-clear')?.classList.add('hidden');
    this.showPickMessage('');
    const prev = this.lastRealRegion || this.regions[2];
    this.selectRegion(prev);
    return prev;
  }

  showPinTooltip(data) {
    const tooltip = document.getElementById('pin-tooltip');
    if (!tooltip) return;

    if (!data.visible || !data.region) {
      tooltip.classList.add('hidden');
      return;
    }

    const reg = data.region;
    const elevEl = document.getElementById('tooltip-elevation');
    const hintEl = document.getElementById('tooltip-hint');

    document.getElementById('tooltip-title').textContent = reg.name;
    document.getElementById('tooltip-coords').textContent = `${formatRegionCoords(reg)} · ${regionKindLabel(reg)}`;
    if (data.globe) {
      // Moon globe: orientation only, so no DEM elevation here
      elevEl.classList.add('hidden');
      hintEl.textContent = 'Click to select · orientation only, not to scale';
    } else {
      const elev = getElevationAt(reg.lat, reg.lon);
      elevEl.classList.remove('hidden');
      elevEl.textContent = `Elevation: ${elev >= 0 ? '+' : ''}${elev.toFixed(2)} km`;
      hintEl.textContent = 'Click pin to dock camera';
    }

    tooltip.style.left = `${data.screenX}px`;
    tooltip.style.top = `${data.screenY}px`;
    tooltip.classList.remove('hidden');
  }

  /**
   * Moon globe selection (pin or surface point). `sel` = {region|null, lat, lon} or null to clear. Shows the selection
   * card with the "View in South Pole 3D" button; the button is disabled outside the 80–90 °S DEM coverage.
   */
  setGlobeSelection(sel) {
    this._globeSel = sel || null;
    if (this.callbacks.onGlobeSelectionMarker) this.callbacks.onGlobeSelectionMarker(this._globeSel);
    this._renderGlobeSelection();
  }

  _renderGlobeSelection() {
    const card = document.getElementById('globe-select-card');
    if (!card) return;
    const sel = this._globeSel;
    if (!sel || this.viewMode !== 'globe') { card.classList.add('hidden'); return; }
    const reg = sel.region || makeUserPointRegion(sel.lat, sel.lon);
    const check = sel.region ? { ok: true } : validatePickedPoint(sel.lat, sel.lon);
    document.getElementById('globe-select-title').textContent = sel.region ? reg.name : 'Selected point';
    document.getElementById('globe-select-coords').textContent = `${formatRegionCoords(reg)} · ${regionKindLabel(reg)}`;
    const btn = document.getElementById('btn-globe-view-pole');
    const note = document.getElementById('globe-select-note');
    btn.disabled = !check.ok;
    note.textContent = check.ok ? '' : 'South Pole 3D covers 80–90 °S only. Select a point closer to the pole.';
    note.classList.toggle('hidden', check.ok);
    card.classList.remove('hidden');
  }

  /** "View in South Pole 3D": opens the selected pin's region, or analyses the selected point as a user-picked point. */
  viewGlobeSelectionInPole() {
    const sel = this._globeSel;
    if (!sel || this.viewMode !== 'globe') return;
    if (sel.region) { this.enterPoleFromGlobe(sel.region); return; }
    const result = validatePickedPoint(sel.lat, sel.lon);
    if (!result.ok) return;
    // Same path as the Pick-a-point form: creates the pseudo-region and selects it
    if (this.callbacks.onPickPoint) this.callbacks.onPickPoint(result);
    const reg = this.selectedRegion && this.selectedRegion.kind === 'user_point' ? this.selectedRegion : makeUserPointRegion(result.lat, result.lon);
    this.enterPoleFromGlobe(reg);
  }

  /** Black overlay snaps to opaque, then fades out (short fade between the globe and the other views). */
  _fadeFromBlack(ms = 450) {
    const el = document.getElementById('view-fade');
    if (!el) return;
    el.style.transition = 'none';
    el.style.opacity = '1';
    void el.offsetWidth; // commit the opaque frame before the transition starts
    el.style.transition = `opacity ${ms}ms ease-out`;
    el.style.opacity = '0';
  }

  /**
   * A pin was clicked on the Moon globe. Zooms the globe camera toward the pin, fades to black, then switches to
   * South Pole mode with that region selected, through the same selection path as a click on the polar map
   * (ui.selectRegion + callbacks.onSelectRegion). `instant` skips the zoom and timers.
   */
  enterPoleFromGlobe(reg, { instant = false } = {}) {
    if (this.viewMode !== 'globe') return;
    if (this._globeEntryTimer) return; // a flight is already running
    const finish = () => {
      this._globeEntryTimer = null;
      this.selectRegion(reg);
      if (this.callbacks.onSelectRegion) this.callbacks.onSelectRegion(reg);
      this._setViewMode('south_pole');
    };
    if (instant) { finish(); return; }
    if (this.callbacks.onGlobeFlyTo) this.callbacks.onGlobeFlyTo(reg);
    const fade = document.getElementById('view-fade');
    this._globeEntryTimer = setTimeout(finish, GLOBE_FLY_MS);
    setTimeout(() => {
      if (!fade || !this._globeEntryTimer) return;
      fade.style.transition = 'opacity 250ms ease-in';
      fade.style.opacity = '1';
    }, Math.max(0, GLOBE_FLY_MS - 250));
  }

  updateTelemetry(ephem) {
    if (!ephem) return;

    // 1. Monospaced Tabular-Nums UTC Time Readout
    const utcEl = document.getElementById('readout-utc-time');
    const elapsedEl = document.getElementById('readout-elapsed-days');
    const sliderUtc = document.getElementById('slider-utc-label');
    const sliderDay = document.getElementById('slider-day-label');
    const simSlider = document.getElementById('sim-slider');

    const formattedUtc = ephem.date.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    if (utcEl) utcEl.textContent = formattedUtc;
    if (sliderUtc) sliderUtc.textContent = formattedUtc;

    const daysText = `T+ ${timeStore.elapsedDays.toFixed(2)} days`;
    if (elapsedEl) elapsedEl.textContent = `Epoch Offset: ${daysText}`;
    if (sliderDay) sliderDay.textContent = daysText;
    if (simSlider && Math.abs(parseFloat(simSlider.value) - timeStore.elapsedDays) > 0.05) {
      simSlider.value = timeStore.elapsedDays.toFixed(2);
    }

    // 2. Earth-Moon Distance
    const distEl = document.getElementById('readout-earth-moon-dist');
    if (distEl) {
      distEl.textContent = `${Math.round(ephem.earthDistanceKm).toLocaleString()} km`;
    }

    // 3. Moon Phase Details
    const phase = ephem.phaseDetails;
    const illumEl = document.getElementById('readout-phase-illum');
    const nameEl = document.getElementById('readout-phase-name');

    if (illumEl) illumEl.textContent = `${phase.illuminationPct}%`;
    if (nameEl) nameEl.textContent = phase.phaseName;

    // 4. Play/Pause State Button
    const playIcon = document.getElementById('icon-play');
    const pauseIcon = document.getElementById('icon-pause');
    const playLabel = document.getElementById('play-pause-label');

    if (timeStore.isPlaying) {
      if (playIcon) playIcon.classList.add('hidden');
      if (pauseIcon) pauseIcon.classList.remove('hidden');
      if (playLabel) playLabel.textContent = 'Pause';
    } else {
      if (playIcon) playIcon.classList.remove('hidden');
      if (pauseIcon) pauseIcon.classList.add('hidden');
      if (playLabel) playLabel.textContent = 'Play';
    }
  }

  updateRegionTelemetry(metrics) {
    if (!metrics || !metrics.region) return;

    // 1. Target Region Identity & Coordinates
    const nameEl = document.getElementById('inspector-region-name');
    const coordsEl = document.getElementById('inspector-region-coords');
    const elevEl = document.getElementById('inspector-region-elev');
    const statusEl = document.getElementById('inspector-region-status');

    if (nameEl) nameEl.textContent = metrics.region.name;
    if (coordsEl) {
      coordsEl.textContent = `${formatRegionCoords(metrics.region)} · ${regionKindLabel(metrics.region)}`;
    }
    if (elevEl) {
      elevEl.textContent = `${metrics.elevKm >= 0 ? '+' : ''}${metrics.elevKm.toFixed(2)} km`;
    }
    if (statusEl) {
      statusEl.textContent = regionStatusLabel(metrics.region);
    }
    this._updatePoleDistance(metrics.region);

    // 2. Solar Illumination & Occlusion
    const fSun = metrics.occlusion ? metrics.occlusion.fSun : 1.0;
    const fSunPct = (fSun * 100).toFixed(1) + '%';
    const sunBadge = document.getElementById('solar-status-badge');
    const sunPctEl = document.getElementById('solar-fraction-pct');
    const sunBarEl = document.getElementById('solar-fraction-bar');
    const sunElVal = document.getElementById('solar-elev-val');
    const sunMaskVal = document.getElementById('solar-mask-val');
    const sunAzimVal = document.getElementById('solar-azim-val');

    if (sunPctEl) sunPctEl.textContent = fSunPct;
    if (sunBarEl) {
      sunBarEl.style.width = fSunPct;
      sunBarEl.className = fSun >= 0.95 ? 'h-full bg-amber-400 rounded-full transition-all duration-150' :
                           fSun > 0.05 ? 'h-full bg-amber-500 rounded-full transition-all duration-150' :
                           'h-full bg-slate-600 rounded-full transition-all duration-150';
    }

    if (sunBadge) {
      if (fSun >= 0.95) {
        sunBadge.textContent = 'Direct Sun';
        sunBadge.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30';
      } else if (fSun > 0.0001) {
        sunBadge.textContent = 'Penumbra';
        sunBadge.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-amber-700/30 text-amber-200 border border-amber-600/40';
      } else {
        sunBadge.textContent = 'Shadow';
        sunBadge.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700';
      }
    }

    if (sunElVal && metrics.sunTopo) {
      sunElVal.textContent = `${metrics.sunTopo.elevationDeg >= 0 ? '+' : ''}${metrics.sunTopo.elevationDeg.toFixed(2)}°`;
    }
    if (sunMaskVal && metrics.occlusion) {
      sunMaskVal.textContent = `${metrics.occlusion.sunMaskDeg >= 0 ? '+' : ''}${metrics.occlusion.sunMaskDeg.toFixed(2)}°`;
    }
    if (sunAzimVal && metrics.sunTopo) {
      sunAzimVal.textContent = `${metrics.sunTopo.azimuthDeg.toFixed(1)}°`;
    }

    // 3. Earth Visibility & Direct-to-Earth Comm
    const fEarth = metrics.occlusion ? metrics.occlusion.fEarth : 1.0;
    const fEarthPct = (fEarth * 100).toFixed(1) + '%';
    const earthBadge = document.getElementById('earth-status-badge');
    const earthPctEl = document.getElementById('earth-fraction-pct');
    const earthBarEl = document.getElementById('earth-fraction-bar');
    const earthElVal = document.getElementById('earth-elev-val');
    const earthMaskVal = document.getElementById('earth-mask-val');
    const earthAzimVal = document.getElementById('earth-azim-val');

    if (earthPctEl) earthPctEl.textContent = fEarthPct;
    if (earthBarEl) {
      earthBarEl.style.width = fEarthPct;
      earthBarEl.className = fEarth >= 0.95 ? 'h-full bg-cyan-400 rounded-full transition-all duration-150' :
                             fEarth > 0.05 ? 'h-full bg-cyan-600 rounded-full transition-all duration-150' :
                             'h-full bg-slate-600 rounded-full transition-all duration-150';
    }

    if (earthBadge) {
      if (fEarth >= 0.95) {
        earthBadge.textContent = 'Direct LoS';
        earthBadge.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30';
      } else if (fEarth > 0.0001) {
        earthBadge.textContent = 'Limb Grazing';
        earthBadge.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-800/40 text-cyan-200 border border-cyan-700/50';
      } else {
        earthBadge.textContent = 'Occluded';
        earthBadge.className = 'px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950/40 text-rose-300 border border-rose-800/50';
      }
    }

    if (earthElVal && metrics.earthTopo) {
      earthElVal.textContent = `${metrics.earthTopo.elevationDeg >= 0 ? '+' : ''}${metrics.earthTopo.elevationDeg.toFixed(2)}°`;
    }
    if (earthMaskVal && metrics.occlusion) {
      earthMaskVal.textContent = `${metrics.occlusion.earthMaskDeg >= 0 ? '+' : ''}${metrics.occlusion.earthMaskDeg.toFixed(2)}°`;
    }
    if (earthAzimVal && metrics.earthTopo) {
      earthAzimVal.textContent = `${metrics.earthTopo.azimuthDeg.toFixed(1)}°`;
    }

    // Round 8: Clearance Margin (Δθ = θ⊕ - θmask) & Real-Time Status
    const marginEl = document.getElementById('earth-margin-val');
    if (marginEl && metrics.earthTopo && metrics.occlusion) {
      const marginDeg = metrics.earthTopo.elevationDeg - metrics.occlusion.earthMaskDeg;
      if (marginDeg >= 0) {
        marginEl.textContent = `+${marginDeg.toFixed(2)}° (CLEAR)`;
        marginEl.className = 'text-cyan-300 font-bold';
      } else {
        marginEl.textContent = `${marginDeg.toFixed(2)}° (OCCLUDED)`;
        marginEl.className = 'text-rose-400 font-bold';
      }
    }

    // 4. Slope Statistics
    if (metrics.slopeStats) {
      const meanEl = document.getElementById('slope-mean-val');
      const p95El = document.getElementById('slope-p95-val');
      const radBadge = document.getElementById('slope-radius-badge');

      if (meanEl) meanEl.textContent = `${metrics.slopeStats.meanSlopeDeg.toFixed(1)}°`;
      if (p95El) p95El.textContent = `${metrics.slopeStats.p95SlopeDeg.toFixed(1)}°`;
      if (radBadge) radBadge.textContent = `r = ${metrics.slopeStats.radiusKm.toFixed(1)} km`;
    }
  }

  /**
   * Loads DATA_AND_METHODS.md at runtime as the single source of truth (Task 2)
   */
  async _loadMethodsDoc() {
    if (this._methodsDocLoaded) return;
    const contentEl = document.getElementById('methods-doc-content');
    const tocDocLinksEl = document.getElementById('methods-toc-doc-links');
    if (!contentEl) return;

    try {
      const markdown = await fetchDataAndMethodsDoc();
      const { html, toc } = parseMarkdown(markdown);
      contentEl.innerHTML = html;
      this._methodsDocLoaded = true;

      if (tocDocLinksEl) {
        tocDocLinksEl.innerHTML = toc.map((item) => `
          <a href="#${item.id}" class="toc-link block px-2.5 py-1.5 rounded-lg transition-colors hover:bg-[#1E293B]/60 ${item.level === 3 ? 'pl-6 text-[11px] text-slate-400 hover:text-amber-300' : 'text-slate-200 hover:text-cyan-300 font-semibold'}">
            ${item.title}
          </a>
        `).join('');

        // Re-bind smooth scrolling on dynamic TOC items
        tocDocLinksEl.querySelectorAll('.toc-link').forEach((link) => {
          link.addEventListener('click', (e) => {
            const targetId = link.getAttribute('href').replace('#', '');
            const targetEl = document.getElementById(targetId);
            if (targetEl) {
              e.preventDefault();
              targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          });
        });
      }
    } catch (err) {
      contentEl.innerHTML = `
        <div class="p-5 rounded-2xl bg-rose-950/40 border border-rose-500/50 text-rose-200 font-mono text-xs space-y-3">
          <div class="flex items-center gap-2 font-bold text-sm text-rose-300">
            <svg class="w-4 h-4 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Failed to load DATA_AND_METHODS.md</span>
          </div>
          <p class="font-sans text-slate-300 leading-relaxed text-xs">
            Unable to fetch <code>/DATA_AND_METHODS.md</code> at runtime. Please verify the server is running and the file is available.
          </p>
          <div class="p-2.5 rounded-lg bg-[#07090E] border border-rose-900/60 text-[11px] text-rose-400">
            Error: ${err.message}
          </div>
        </div>
      `;
      if (tocDocLinksEl) {
        tocDocLinksEl.innerHTML = `<span class="text-rose-400 text-[11px] px-2.5 py-1 block">Failed to load sections</span>`;
      }
    }
  }

  /**
   * Phase 9: Mission Metrics card. Settings live on the card (UI state); the app reacts through callbacks.
   * Chart clicks seek the shared timeStore, exactly like the Earth elevation chart.
   */
  _initMissionCard() {
    this.missionCard = new MissionMetricsCard({
      callbacks: {
        onSettingsChange: (settings, changed) => this.callbacks.onMissionSettingsChange?.(settings, changed),
        onManualChange: (manual) => this.callbacks.onManualPanelChange?.(manual),
        onSeekDays: (days) => timeStore.setElapsedDays(days),
      },
    });
  }

  /** Navigator-only: the Earth elevation chart follows the Advanced mast height (Comparison stays at 10 m). */
  setNavigatorMastHeight(mastHeightM) {
    if (!this.earthElevationChart) return;
    this.earthElevationChart.mastHeightM = mastHeightM;
    if (this.isEarthChartVisible) this.earthElevationChart.setData(this.selectedRegion, timeStore.baseEpoch, timeStore.maxDays);
  }

  /** Current Navigator mission settings (Comparison never reads these). */
  get missionSettings() {
    return this.missionCard ? this.missionCard.settings : null;
  }

  /**
   * Round 9: Initializes the pure HTML5 Canvas Earth Elevation Libration Chart
   */
  _initEarthChart() {
    const canvas = document.getElementById('earth-elevation-canvas');
    if (!canvas) return;

    this.earthElevationChart = new EarthElevationChart(canvas, {
      onSeek: (days) => {
        timeStore.setElapsedDays(days);
      },
    });

    this.earthElevationChart.setData(this.selectedRegion, timeStore.baseEpoch, timeStore.maxDays);
  }

  /** Phase 11: Sun Illumination chart and solar-panel energy graph. They only draw cached mission-metrics arrays. */
  _initAnalysisCharts() {
    const make = (canvasId, Chart) => {
      const canvas = document.getElementById(canvasId);
      if (!canvas || !canvas.getContext || !canvas.getContext('2d')) return null;
      return new Chart(canvas, { onSeek: (days) => timeStore.setElapsedDays(days) });
    };
    this.sunChart = make('sun-illumination-canvas', SunIlluminationChart);
    this.energyChart = make('energy-chart-canvas', PanelEnergyChart);
  }

  /**
   * Called by the app on every tick with the cached Navigator metrics and the active panel orientation. Series are only
   * rebuilt when the metrics object (region/epoch/mast/area/efficiency) or the panel orientation changes; a plain time
   * tick moves the cursors and a few text nodes.
   */
  updateAnalysisCharts(metrics, panel, elapsedDays) {
    this._analysis = { metrics, panel, elapsedDays };
    if (this.layers.sunChart || this.layers.energyChart) this._syncAnalysisCharts();
  }

  _syncAnalysisCharts() {
    const a = this._analysis;
    if (!a || !a.metrics) return;
    const { metrics, panel, elapsedDays } = a;
    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== text) el.textContent = text;
    };
    const name = this.selectedRegion?.name || '';
    const g = metrics.geometry;

    if (this.layers.sunChart && this.sunChart) {
      if (metrics !== this._sunChartMetrics) {
        this._sunChartMetrics = metrics;
        this.sunChart.setData({ spanDays: metrics.window.days, series: sunIlluminationSeries(g), regionName: name });
        setText('sc-lit-pct', `${metrics.litPercent.toFixed(1)}%`);
        setText('sc-lit-hours', `${metrics.totalLitHours.toFixed(1)} h`);
        setText('sc-longest-dark', formatHours(metrics.longestDarkHours, metrics.longestDarkTouchesStart || metrics.longestDarkTouchesEnd));
      }
      this.sunChart.setCursor(elapsedDays);
      const idx = Math.min(g.n - 1, Math.max(0, Math.floor((elapsedDays * 24) / g.dtHours)));
      setText('sc-now', elapsedDays <= metrics.window.days ? (g.illum[idx] ? 'LIT' : 'DARK') : '--');
    }

    if (this.layers.energyChart && this.energyChart) {
      const key = `${name}|${metrics.regionId}|${metrics.lat}|${metrics.lon}|${metrics.window.startMs}|${metrics.params.areaM2}|${metrics.params.efficiency}|${metrics.mastHeightM}|${panel.tiltDeg}|${panel.azimuthDeg}`;
      if (key !== this._energyChartKey || this._energyChartMetrics !== metrics) {
        this._energyChartKey = key;
        this._energyChartMetrics = metrics;
        const { areaM2, efficiency } = metrics.params;
        const best = metrics.bestFixed;
        const isManual = panel.tiltDeg !== best.beta || panel.azimuthDeg !== best.az;
        const powerW = isManual ? panelPowerSeriesW(g, panel.tiltDeg, panel.azimuthDeg, areaM2, efficiency) : best.series;
        const cumWh = cumulativeEnergySeriesWh(powerW, g.dtHours);
        this._energyData = { powerW, cumWh, dtHours: g.dtHours };
        this.energyChart.setData({
          spanDays: metrics.window.days, dtHours: g.dtHours, powerW,
          bestPowerW: isManual ? best.series : null, regionName: name,
        });
        setText('ec-config', `${isManual ? 'Manual' : 'Best fixed'} ${panel.tiltDeg.toFixed(0)}°/${panel.azimuthDeg.toFixed(0)}°`);
        setText('ec-total', formatEnergy(cumWh[cumWh.length - 1]));
      }
      this.energyChart.setCursor(elapsedDays);
      const d = this._energyData;
      const inWindow = elapsedDays <= metrics.window.days;
      const idx = Math.min(g.n - 1, Math.max(0, Math.floor((elapsedDays * 24) / g.dtHours)));
      setText('ec-sofar', formatEnergy(cumulativeEnergyAtWh(d.cumWh, d.powerW, d.dtHours, elapsedDays)));
      setText('ec-pnow', inWindow ? `${Math.round(d.powerW[idx])} W` : '--');
    }
  }

  /**
   * Updates Chart Cursor on timeline tick or manual scrub
   */
  updateChartCursor(elapsedDays) {
    if (this.earthElevationChart && this.isEarthChartVisible) {
      this.earthElevationChart.setCursor(elapsedDays);
    }
  }

  /**
   * Phase 10: computes the three Section 5 criteria for the nine regions over the mission window
   * (time selector: start date + span). Chunked and cached; Navigator panel/mast settings are never read.
   */
  async _runComparisonCalculation(forceRefresh = false) {
    if (this.isComputingComparison) {
      this._comparisonRerunQueued = true; // window changed while computing: rerun afterwards
      return;
    }
    this.isComputingComparison = true;

    const progressContainer = document.getElementById('calc-progress-container');
    const progressBar = document.getElementById('calc-progress-bar');
    const progressLabel = document.getElementById('calc-progress-label');
    const stepNote = document.getElementById('calc-step-note');

    if (progressContainer) progressContainer.classList.remove('hidden');

    const span = timeStore.maxDays;
    const epoch = timeStore.baseEpoch;
    const win = makeComparisonWindow(epoch, span);
    const stepLabel = win.stepMinutes >= 60 ? `${win.stepMinutes / 60} h` : `${win.stepMinutes} min`;
    const windowLine = document.getElementById('comparison-window-line');
    if (windowLine) windowLine.textContent = formatWindowLine({ startMs: epoch.getTime(), days: span, stepMinutes: win.stepMinutes });

    if (stepNote) {
      stepNote.textContent = `Sampling 9 regions over ${span}-day window (step ${stepLabel}, mast ${COMPARISON_MAST_HEIGHT_M} m)...`;
    }

    try {
      this.cachedComparisonData = await computeRegionalComparisonData(win, (pct) => {
        if (progressBar) progressBar.style.width = `${pct}%`;
        if (progressLabel) progressLabel.textContent = `Computing: ${pct}%`;
      });

      if (stepNote) {
        stepNote.textContent = `Mission window: ${span} days from ${epoch.toISOString().substring(0, 10)} UTC (step ${stepLabel}, mast ${COMPARISON_MAST_HEIGHT_M} m, best fixed panel per region).`;
      }

      this._renderComparisonRanking();
    } catch (err) {
      console.error('Failed to compute comparison dataset:', err);
    } finally {
      this.isComputingComparison = false;
      if (progressContainer) {
        setTimeout(() => progressContainer.classList.add('hidden'), 500);
      }
      if (this._comparisonRerunQueued) {
        this._comparisonRerunQueued = false;
        this._runComparisonCalculation(true);
      }
    }
  }

  /**
   * Phase 10: renders the sortable ranking table (rank, region, score, energy, longest dark, DTE coverage,
   * plus unscored info columns). No slope column, no battery flag.
   */
  _renderComparisonRanking() {
    const tbody = document.getElementById('regions-table-body');
    if (!tbody || !this.cachedComparisonData) return;

    const rankedData = rankRegionsByWeights(this.cachedComparisonData, this.weights);

    rankedData.sort((a, b) => {
      const valA = a[this.sortColumn];
      const valB = b[this.sortColumn];
      if (typeof valA === 'string') {
        const cmp = valA.localeCompare(valB);
        return this.sortAscending ? cmp : -cmp;
      }
      return this.sortAscending ? valA - valB : valB - valA;
    });

    document.querySelectorAll('.sortable-th').forEach((th) => {
      const iconEl = th.querySelector('.sort-icon');
      if (iconEl) {
        iconEl.textContent = (th.dataset.sort === this.sortColumn) ? (this.sortAscending ? '▲' : '▼') : '';
      }
    });

    const fmt0 = (v) => Math.round(v).toLocaleString('en-US');

    tbody.innerHTML = rankedData.map((row) => {
      const isSelected = row.id === this.selectedRegion.id;
      const isDuplicateLon = row.id === 'peak-near-cabeus-b' || row.id === 'de-gerlache-rim-2';

      // Rank Medal Styling for Top 3
      let rankBadge = `<span class="font-mono text-slate-400 font-semibold tabular-nums">#${row.rank}</span>`;
      if (row.rank === 1) {
        rankBadge = `<span class="px-2 py-0.5 rounded font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">#1 🥇</span>`;
      } else if (row.rank === 2) {
        rankBadge = `<span class="px-2 py-0.5 rounded font-bold bg-slate-300/20 text-slate-200 border border-slate-400/40">#2 🥈</span>`;
      } else if (row.rank === 3) {
        rankBadge = `<span class="px-2 py-0.5 rounded font-bold bg-amber-800/20 text-amber-500 border border-amber-700/40">#3 🥉</span>`;
      }

      const scorePct = Math.min(100, Math.max(0, row.score));
      const darkEdge = (row.longestDarkTouchesStart || row.longestDarkTouchesEnd) ? '≥ ' : '';

      return `
        <tr class="hover:bg-[#1E293B]/40 transition-colors ${isSelected ? 'bg-cyan-950/20 border-l-2 border-cyan-400' : ''}">
          <td class="py-3 px-4 tabular-nums whitespace-nowrap">${rankBadge}</td>

          <td class="py-3 px-4">
            <div class="font-bold text-white flex items-center gap-1.5">
              <span>${row.name}</span>
              ${isDuplicateLon ? '<span class="px-1 py-px rounded bg-amber-950 text-amber-300 border border-amber-600/50 text-[9px]">Copy Flag</span>' : ''}
            </div>
            <div class="text-[10px] text-slate-400 font-mono tabular-nums">
              ${formatRegionCoords(row)} · ${regionKindLabel(row)} · <span class="uppercase text-amber-400/80">${regionStatusLabel(row)}</span>
            </div>
          </td>

          <td class="py-3 px-4">
            <div class="flex items-center gap-2">
              <span class="text-cyan-300 font-bold text-sm tabular-nums">${row.score.toFixed(1)}</span>
              <div class="w-16 h-1.5 rounded-full bg-slate-800 overflow-hidden hidden sm:block">
                <div class="h-full bg-cyan-400 rounded-full" style="width: ${scorePct}%;"></div>
              </div>
            </div>
            <div class="text-[9px] text-slate-400 font-mono">
              E:${Math.round(row.normEnergyScore * 100)} D:${Math.round(row.normDarkScore * 100)} C:${Math.round(row.normCommScore * 100)}
            </div>
          </td>

          <td class="py-3 px-4 tabular-nums">
            <div class="text-amber-300 font-semibold whitespace-nowrap">${fmt0(row.energyWh)} Wh</div>
          </td>

          <td class="py-3 px-4 tabular-nums">
            <div class="text-white font-semibold whitespace-nowrap">${darkEdge}${row.longestDarkHours.toFixed(1)} h</div>
            <div class="text-[10px] text-slate-400">${(row.longestDarkHours / 24).toFixed(1)} days</div>
          </td>

          <td class="py-3 px-4 tabular-nums">
            <div class="text-cyan-300 font-semibold">${row.commPercent.toFixed(1)}%</div>
            <div class="text-[10px] text-slate-400">${row.commHours.toFixed(0)} h of ${(row.spanDays * 24).toFixed(0)} h</div>
          </td>

          <td class="py-3 px-4 tabular-nums text-slate-200">${row.totalLitHours.toFixed(0)} h <span class="text-[10px] text-slate-400">(${row.litPercent.toFixed(1)}%)</span></td>

          <td class="py-3 px-4 tabular-nums text-slate-200">${row.longestCommGapHours.toFixed(1)} h</td>

          <td class="py-3 px-4 tabular-nums text-slate-200">${row.bestTiltDeg}° / ${row.bestAzimuthDeg}°</td>

          <td class="py-3 px-4 text-center">
            <button
              class="btn-dock-table-region px-2.5 py-1 rounded-lg bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-200 text-[11px] font-semibold transition-colors flex items-center gap-1 mx-auto"
              data-region-id="${row.id}"
            >
              <span>View 3D</span>
              <svg class="w-3 h-3 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    // Attach Click Events to Dock 3D Buttons
    tbody.querySelectorAll('.btn-dock-table-region').forEach((btn) => {
      btn.addEventListener('click', () => {
        const regId = btn.dataset.regionId;
        const reg = this.regions.find((r) => r.id === regId);
        if (reg) {
          // Switch tab to navigator
          const navTabBtn = document.getElementById('nav-btn-navigator');
          if (navTabBtn) navTabBtn.click();

          // Switch view mode to south_pole
          const poleModeBtn = document.getElementById('mode-btn-pole');
          if (poleModeBtn) poleModeBtn.click();

          // Select region
          this.selectRegion(reg);
          if (this.callbacks.onSelectRegion) {
            this.callbacks.onSelectRegion(reg);
          }
        }
      });
    });
  }
}

