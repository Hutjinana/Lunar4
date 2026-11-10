/**
 * Artemis Lunar Landing Site Navigator - Main App Bootstrap
 * 
 * Round 2 Orchestrator:
 * 1. Synchronizes single authoritative timeStore
 * 2. Drives astronomy-engine ephemeris calculation for every simTime tick
 * 3. Coordinates view mode transitions: Orrery vs South Pole 3D View
 * 4. Connects candidate region selections, pin raycasting, hover tooltips, and camera docking
 */

import { timeStore } from './timeStore.js';
import { computeEphemeris, computeTopocentricHorizon } from './ephemeris.js';
import { evaluateRegionCelestialOcclusion, prewarmRegionHorizonProfiles, getRegionHorizonProfile, normalizeMastHeightM, DEFAULT_MAST_HEIGHT_M } from './horizon.js';
import { computeRegionMissionMetrics, cosIncidence, instantMetrics, sunDistanceAu } from './missionMetrics.js';
import { metricsSettingsKey } from './missionSettings.js';
import { comparisonStepMinutesForSpan } from './comparisonEngine.js';
import { computeLocalizedSlopeAt, getElevationAt } from './terrain.js';
import { REGIONS } from '../regions.js';
import { LunarNavigatorScene } from './scene.js';
import { LunarNavigatorUI } from './ui.js';
import { makeUserPointRegion } from './pickPoint.js';
import { loadConfiguredDem } from './demLoader.js';

export class ArtemisNavigatorApp {
  constructor() {
    this.lastTime = performance.now();
    this.slopeRadiusKm = 3.0;
    this.manualPanel = null; // { tiltDeg, azimuthDeg } while the Mission Metrics Manual switch is ON
    this._metricsMemo = new Map(); // Navigator metrics memo (see _getMissionMetrics)
    this._chartMetricsMemo = new Map(); // metrics for the Sun/energy charts (window = scrub span)
    this._cardMetrics = null; // last metrics object handed to the card

    // Pre-warm horizon cache for all 9 regions in background
    prewarmRegionHorizonProfiles(REGIONS);

    this._init();
  }

  _init() {
    const root = document.getElementById('root') || document.body;

    // 1. Initialize UI Shell with callbacks
    this.ui = new LunarNavigatorUI({
      container: root,
      callbacks: {
        onSetViewMode: (mode) => {
          if (this.scene) {
            this.scene.setViewMode(mode);
          }
          this._onTimeUpdate(timeStore.getSimTime());
        },
        onGlobeFocusSouthPole: () => {
          if (this.scene) this.scene.focusGlobeSouthPole();
        },
        onGlobeFlyTo: (reg) => {
          if (this.scene) this.scene.flyGlobeToRegion(reg);
        },
        onGlobeSelectionMarker: (sel) => {
          if (this.scene) this.scene.setGlobeSelection(sel);
        },
        onSetCameraPreset: (preset) => {
          if (this.scene) {
            this.scene.setCameraPreset(preset);
          }
        },
        onSelectRegion: (reg) => {
          if (this.scene) {
            this.scene.selectRegion(reg);
          }
          this._onTimeUpdate(timeStore.getSimTime());
        },
        onDockPolarOverview: () => {
          if (this.scene) {
            this.scene.dockToPolarOverview();
          }
        },
        onSlopeRadiusChange: (radKm) => {
          this.slopeRadiusKm = radKm;
          this._onTimeUpdate(timeStore.getSimTime());
        },
        onToggleCommsRay: (visible) => {
          if (this.scene) {
            this.scene.setCommsRayVisible(visible);
          }
        },
        onToggleEarthGlobe: (visible) => {
          if (this.scene) {
            this.scene.setEarthGlobeVisible(visible);
          }
        },
        onToggleLayer: (id, visible) => {
          if (this.scene && id === 'sun') {
            this.scene.setSunVisible(visible);
          }
          if (this.scene && id === 'solarPanel') {
            this.scene.setSolarPanelVisible(visible);
          }
        },
        onMissionSettingsChange: (settings, changed) => {
          // Mast / area / efficiency / frequency change the Navigator metrics (never Comparison)
          if (changed === 'mastHeightM' || changed === 'reset') this.ui?.setNavigatorMastHeight?.(this._mastHeightM());
          this._onTimeUpdate(timeStore.getSimTime());
        },
        onManualPanelChange: (manual) => {
          this.manualPanel = manual;
          this._onTimeUpdate(timeStore.getSimTime());
        },
        onRequestUpdate: () => this._onTimeUpdate(timeStore.getSimTime()),
        onPickPoint: (result) => this._handlePickedPoint(result),
        onClearPickedPoint: () => this._clearPickedPoint(),
      },
    });

    // 2. Initialize Three.js Scene with callbacks for region pin interactions
    const canvasContainer = document.getElementById('canvas-container');
    if (canvasContainer) {
      this.scene = new LunarNavigatorScene(canvasContainer, {
        onSelectRegion: (reg) => {
          if (this.ui) {
            this.ui.selectRegion(reg);
          }
          this._onTimeUpdate(timeStore.getSimTime());
        },
        // Moon globe click: select a pin or a surface point (null = cleared); the UI offers "View in South Pole 3D"
        onGlobeSelect: (sel) => {
          if (this.ui) this.ui.setGlobeSelection(sel);
        },
        onPinHover: (hoverData) => {
          if (this.ui) {
            this.ui.showPinTooltip(hoverData);
          }
        },
        onPickPoint: (result) => this._handlePickedPoint(result),
      });
    }

    // 3. Subscribe to timeStore: updates Orrery positions and UI telemetry
    this.unsubscribeTimeStore = timeStore.subscribe((simTime) => {
      this._onTimeUpdate(simTime);
    });

    // Initial update for default simTime
    this._onTimeUpdate(timeStore.getSimTime());

    // 4. Start Animation / Physics Tick Loop
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  /** Form entry or terrain click: analyse an arbitrary point as a pseudo-region (never one of the 9) */
  _handlePickedPoint(result) {
    if (!result || !result.ok) {
      if (this.ui) this.ui.showPickMessage(result ? result.message : '');
      return;
    }
    const region = makeUserPointRegion(result.lat, result.lon);
    if (this.scene) {
      this.scene.setUserPin(region);
      this.scene.selectRegion(region);
    }
    if (this.ui) this.ui.setUserPoint(region);
    this._onTimeUpdate(timeStore.getSimTime());
  }

  _clearPickedPoint() {
    if (this.scene) this.scene.clearUserPin();
    const prev = this.ui ? this.ui.clearUserPoint() : null;
    if (this.scene && prev) this.scene.selectRegion(prev);
    this._onTimeUpdate(timeStore.getSimTime());
  }

  _onTimeUpdate(simTime) {
    const validDate = (simTime instanceof Date && !isNaN(simTime.getTime())) ? simTime : timeStore.getSimTime();
    const ephem = computeEphemeris(validDate);

    if (this.scene) {
      this.scene.updateSimulation(ephem);
    }

    if (this.ui) {
      this.ui.updateTelemetry(ephem);

      // Evaluate active region telemetry (Round 4 Metrics Engine)
      const region = this.ui.selectedRegion || REGIONS[2];
      const elevKm = getElevationAt(region.lat, region.lon);

      // Topocentric celestial directions
      const sunTopo = computeTopocentricHorizon(region.lat, region.lon, ephem.subSolarLat, ephem.subSolarLon, 149597870.7, elevKm);
      const earthTopo = computeTopocentricHorizon(region.lat, region.lon, ephem.subEarthLat, ephem.subEarthLon, ephem.earthDistanceKm, elevKm);

      // Horizon masking and extended disc integration (f_sun and f_earth)
      const mastHeightM = this._mastHeightM();
      const occlusion = evaluateRegionCelestialOcclusion(region, sunTopo, earthTopo, mastHeightM);

      // Localized slope statistics within adjustable radius (default 3.0 km)
      const slopeStats = computeLocalizedSlopeAt(region.lat, region.lon, this.slopeRadiusKm);

      // Round 8: Update direct-to-Earth comms ray line in 3D scene
      if (this.scene) {
        this.scene.updateCommsRay(region, earthTopo, occlusion.fEarth);
        this.scene.updateSunReadout(sunTopo, occlusion.fSun);
        this._updateSolarPanel(region, sunTopo, occlusion.sunMaskDeg);
      }

      this._updateMissionMetricsCard(region, elevKm, ephem, sunTopo, earthTopo);

      this.ui.updateRegionTelemetry({
        region,
        elevKm,
        sunTopo,
        earthTopo,
        occlusion,
        slopeStats,
      });

      // Round 9: Update chart cursor position
      this.ui.updateChartCursor(timeStore.elapsedDays);
    }
  }

  /** Navigator mast height in metres (Advanced setting, default 10 m). Comparison always uses 10 m. */
  _mastHeightM() {
    const m = this.ui?.missionSettings?.mastHeightM;
    return normalizeMastHeightM(m === undefined ? DEFAULT_MAST_HEIGHT_M : m);
  }

  /**
   * Cached Navigator mission metrics for `region` under the current settings. The expensive parts (horizon, Sun/Earth
   * series, best fixed optimiser) are cached in horizon.js / missionMetrics.js; this memo additionally keeps the
   * assembled result so scrubbing time does not even re-run the cheap window statistics. Keyed by region, epoch and
   * the settings that change the metrics (mast, area, efficiency, frequency). Panel orientation is NOT part of the key.
   */
  _getMissionMetrics(region, elevKm) {
    const settings = this.ui?.missionSettings;
    const mast = this._mastHeightM();
    const area = settings?.areaM2, eta = settings?.efficiency, freq = settings?.frequencyHz;
    // Same window as Comparison: start = time-selector epoch, span = scrub span, step = Comparison step for that span.
    const span = timeStore.maxDays;
    const step = comparisonStepMinutesForSpan(span);
    const key = `${region.id}|${region.lat}|${region.lon}|${timeStore.baseEpoch.getTime()}|${span}|${step}|${mast}|${metricsSettingsKey(settings || {})}`;
    let metrics = this._metricsMemo.get(key);
    if (!metrics) {
      metrics = computeRegionMissionMetrics({
        regionId: region.id, lat: region.lat, lon: region.lon, elevationKm: elevKm,
        horizonProfile: getRegionHorizonProfile(region.id, region.lat, region.lon, undefined, mast),
        startDate: timeStore.baseEpoch, mastHeightM: mast, windowDays: span, stepMinutes: step,
        ...(area !== undefined ? { areaM2: area, efficiency: eta, frequencyHz: freq } : {}),
      });
      this._metricsMemo.set(key, metrics);
      while (this._metricsMemo.size > 24) this._metricsMemo.delete(this._metricsMemo.keys().next().value);
    }
    return metrics;
  }

  /**
   * Metrics for the Sun Illumination / energy charts: same settings as the Navigator but the window follows the scrub
   * span (30/90/180/365 d) with the Comparison step for that span. Memoised; only built while a chart is open.
   */
  _getChartMetrics(region, elevKm) {
    const settings = this.ui?.missionSettings;
    const mast = this._mastHeightM();
    const span = timeStore.maxDays;
    const step = comparisonStepMinutesForSpan(span);
    const key = `${region.id}|${region.lat}|${region.lon}|${timeStore.baseEpoch.getTime()}|${mast}|${span}|${step}|${metricsSettingsKey(settings || {})}`;
    let m = this._chartMetricsMemo.get(key);
    if (!m) {
      m = computeRegionMissionMetrics({
        regionId: region.id, lat: region.lat, lon: region.lon, elevationKm: elevKm,
        horizonProfile: getRegionHorizonProfile(region.id, region.lat, region.lon, undefined, mast),
        startDate: timeStore.baseEpoch, mastHeightM: mast, windowDays: span, stepMinutes: step,
        ...(settings?.areaM2 !== undefined ? { areaM2: settings.areaM2, efficiency: settings.efficiency, frequencyHz: settings.frequencyHz } : {}),
      });
      this._chartMetricsMemo.set(key, m);
      while (this._chartMetricsMemo.size > 8) this._chartMetricsMemo.delete(this._chartMetricsMemo.keys().next().value);
    }
    return m;
  }

  /** Orientation of the panel: the user's Manual values when ON, otherwise the region's best fixed tilt/azimuth. */
  _activePanel(metrics) {
    return this.manualPanel || { tiltDeg: metrics.bestFixed.beta, azimuthDeg: metrics.bestFixed.az };
  }

  /**
   * Phase 8: the 3D panel follows the active orientation (best fixed, or Manual) and the Navigator mast height. Lit state is
   * the binary centre-point I(t) used by missionMetrics. Nothing here touches the ephemeris per frame.
   */
  _updateSolarPanel(region, sunTopo, sunMaskDeg) {
    if (!this.scene || !region) return;
    const metrics = this._getMissionMetrics(region, getElevationAt(region.lat, region.lon));
    const panel = this._activePanel(metrics);
    const illuminated = sunTopo.elevationDeg > sunMaskDeg ? 1 : 0;
    const cosInc = cosIncidence(sunTopo.elevationDeg, panel.tiltDeg, sunTopo.azimuthDeg, panel.azimuthDeg);
    this.scene.updateSolarPanel(region, panel, illuminated, cosInc, this._mastHeightM());
  }

  /**
   * Phase 9: Mission Metrics card. Window statistics are pushed only when the cached metrics object changes; the
   * per-tick "Now" readout is a closed-form evaluation of the already-computed Sun/Earth directions (one Sun-distance
   * lookup, no horizon rebuild, no series recomputation).
   */
  _updateMissionMetricsCard(region, elevKm, ephem, sunTopo, earthTopo) {
    const card = this.ui?.missionCard;
    if (!card) return;
    const metrics = this._getMissionMetrics(region, elevKm);
    if (metrics !== this._cardMetrics) {
      this._cardMetrics = metrics;
      card.setMetrics(metrics);
    }
    const panel = this._activePanel(metrics);
    const inst = instantMetrics({
      sunElevationDeg: sunTopo.elevationDeg,
      sunAzimuthDeg: sunTopo.azimuthDeg,
      earthDistanceKm: earthTopo.distanceKm,
      sunDistanceAu: sunDistanceAu(ephem.astroTime),
      horizonProfile: metrics.geometry.horizonProfile,
      tiltDeg: panel.tiltDeg,
      panelAzimuthDeg: panel.azimuthDeg,
      areaM2: metrics.params.areaM2,
      efficiency: metrics.params.efficiency,
      frequencyHz: metrics.params.frequencyHz,
    });
    card.updateInstant(inst, timeStore.elapsedDays);
    if (this.ui.layers.sunChart || this.ui.layers.energyChart) {
      const cm = this._getChartMetrics(region, elevKm);
      const cp = this.manualPanel || { tiltDeg: cm.bestFixed.beta, azimuthDeg: cm.bestFixed.az };
      this.ui.updateAnalysisCharts(cm, cp, timeStore.elapsedDays);
    }
  }

  _loop(now) {
    const deltaSeconds = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    // Advance simulation time if playing
    timeStore.tick(deltaSeconds);

    requestAnimationFrame(this._loop);
  }
}

// Global bootstrap: the DEM must be loaded before anything samples terrain (mesh, horizons, slopes, banner)
async function boot() {
  const overlay = document.getElementById('app-loading');
  try {
    await loadConfiguredDem();
    window.artemisApp = new ArtemisNavigatorApp();
    if (overlay) overlay.remove();
  } catch (err) {
    console.error('App failed to start:', err);
    if (overlay) {
      overlay.innerHTML = '<div style="font-size:15px;font-weight:600;color:#fca5a5">The app could not start</div><div style="font-size:12px;color:#94a3b8;max-width:420px;line-height:1.5">' + String(err && err.message || err).replace(/[<>&]/g, '') + '. Check your connection and reload the page.</div>';
    }
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
