/**
 * Phase 9 tests: Mission Metrics card, battery sizing, Manual panel, "Your setting vs Best possible" chart.
 * Pure helpers run everywhere; the card itself runs against the real index.html in JSDOM (Node only).
 */
import { REGIONS } from '../regions.js';
import { getRegionHorizonProfile, AZIMUTH_BIN_COUNT } from '../src/horizon.js';
import { getElevationAt } from '../src/terrain.js';
import {
  batteryRequiredCapacityWh, batterySurvivalHours, instantMetrics, compareYourSettingToBest,
  computeRegionMissionMetrics, clearMissionMetricsCaches, DEFAULT_PANEL_AREA_M2, DEFAULT_SOLAR_EFFICIENCY,
} from '../src/missionMetrics.js';
import {
  defaultMissionSettings, validateMissionInput, manualFromBestFixed, ghzToHz, hzToGhz, MISSION_INPUT_RULES,
} from '../src/missionSettings.js';
import { niceCeil, chartXToDay } from '../src/powerChart.js';

export async function runMissionCardTest() {
  const t0 = performance.now();
  const measurements = [];
  let passed = true;
  const check = (label, ok) => { if (!ok) passed = false; measurements.push(`${label} [${ok ? 'PASS' : 'FAIL'}]`); };
  const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

  // ---- Battery sizing -------------------------------------------------------------------------
  check('Battery: C = (40 + 60) W · 337 h / 0.8 = 42,125 Wh', near(batteryRequiredCapacityWh(40, 60, 337, 0.8), 42125));
  check('Battery: survival of 2000 Wh at DoD 0.8 and 100 W = 16 h', near(batterySurvivalHours(2000, 0.8, 40, 60), 16));
  check('Battery: invalid DoD (0 or > 1) → NaN, zero load → Infinity',
    Number.isNaN(batteryRequiredCapacityWh(40, 60, 100, 0)) && Number.isNaN(batterySurvivalHours(2000, 1.2, 40, 60)) && batterySurvivalHours(2000, 0.8, 0, 0) === Infinity);

  // ---- Instantaneous metrics (any time, no window) ----------------------------------------------
  const flat = new Float32Array(AZIMUTH_BIN_COUNT).fill(0);
  const iLit = instantMetrics({ sunElevationDeg: 30, sunAzimuthDeg: 90, earthDistanceKm: 384400, sunDistanceAu: 1, horizonProfile: flat, tiltDeg: 60, panelAzimuthDeg: 90 });
  check(`Instant: Sun 30°, panel normal at the Sun → cos=1, P = 10·0.29·1361 = ${iLit.powerW.toFixed(1)} W`,
    iLit.illuminated === 1 && near(iLit.cosIncidence, 1, 1e-12) && near(iLit.powerW, DEFAULT_PANEL_AREA_M2 * DEFAULT_SOLAR_EFFICIENCY * 1361, 1e-6));
  check(`Instant: FSPL at 384,400 km / 8.4 GHz = ${iLit.fsplDb.toFixed(1)} dB (expect 222.6)`, near(iLit.fsplDb, 222.6, 0.1) && iLit.earthDistanceKm === 384400);
  const iDark = instantMetrics({ sunElevationDeg: -2, sunAzimuthDeg: 90, earthDistanceKm: 384400, sunDistanceAu: 1, horizonProfile: flat, tiltDeg: 90, panelAzimuthDeg: 90 });
  check('Instant: Sun below the horizon → I = 0, P = 0', iDark.illuminated === 0 && iDark.powerW === 0);
  const iFar = instantMetrics({ sunElevationDeg: 30, sunAzimuthDeg: 90, earthDistanceKm: 384400, sunDistanceAu: 1.0167, horizonProfile: flat, tiltDeg: 60, panelAzimuthDeg: 90 });
  check('Instant: S(t) follows the inverse-square law (1.0167 AU → 1,317 W/m²)', near(iFar.solarIntensityWm2, 1361 / (1.0167 * 1.0167), 1e-9));

  // ---- Settings validation ------------------------------------------------------------------------
  check('Validation: η = 0.29 ok, 1.5 and 0 rejected (never clamped)',
    validateMissionInput('efficiency', '0.29').ok && !validateMissionInput('efficiency', '1.5').ok && !validateMissionInput('efficiency', '0').ok);
  check('Validation: tilt 0 and 90 ok, 91 and −1 rejected; azimuth 360 → 0',
    validateMissionInput('tiltDeg', '0').ok && validateMissionInput('tiltDeg', '90').ok && !validateMissionInput('tiltDeg', '91').ok
    && !validateMissionInput('tiltDeg', '-1').ok && validateMissionInput('azimuthDeg', '360').value === 0);
  check('Validation: empty / text rejected, decimal comma accepted ("0,5" → 0.5)',
    !validateMissionInput('mastHeightM', '').ok && !validateMissionInput('mastHeightM', 'abc').ok && validateMissionInput('depthOfDischarge', '0,5').value === 0.5);
  check('Validation: A_panel must be > 0, mast 0 allowed, frequency GHz ↔ Hz round-trips',
    !validateMissionInput('areaM2', '0').ok && validateMissionInput('mastHeightM', '0').ok && near(hzToGhz(ghzToHz(8.4)), 8.4));
  check('Mast limit 0–30 m: 30 accepted, 30.1 and 100 rejected, −0.1 rejected, message names the limit',
    MISSION_INPUT_RULES.mastHeightM.min === 0 && MISSION_INPUT_RULES.mastHeightM.max === 30 &&
    validateMissionInput('mastHeightM', '30').ok && validateMissionInput('mastHeightM', '30').value === 30 &&
    !validateMissionInput('mastHeightM', '30.1').ok && !validateMissionInput('mastHeightM', '100').ok &&
    !validateMissionInput('mastHeightM', '-0.1').ok && validateMissionInput('mastHeightM', '30,0').ok &&
    validateMissionInput('mastHeightM', '100').message === 'Mast height must be 0–30 m.');
  const d = defaultMissionSettings();
  check('Defaults: A = 10 m², η = 0.29, mast 10 m, 8.4 GHz, 40 W + 60 W, DoD 0.8, 2000 Wh, Manual OFF',
    d.areaM2 === 10 && d.efficiency === 0.29 && d.mastHeightM === 10 && d.frequencyHz === 8.4e9 && d.pBaseW === 40 && d.pHeaterW === 60
    && d.depthOfDischarge === 0.8 && d.batteryCapacityWh === 2000 && d.manual.on === false);
  const mf = manualFromBestFixed({ beta: 85, az: 320 });
  check('Manual pre-fill copies the best fixed tilt/azimuth and switches Manual ON', mf.on && mf.tiltDeg === 85 && mf.azimuthDeg === 320);

  // ---- Chart helpers ------------------------------------------------------------------------------
  check('Chart axis: niceCeil(0)=1, 183→200, 1,160→2,000, 2,400→2,500; x→day clamps to [0, span]',
    niceCeil(0) === 1 && niceCeil(183) === 200 && niceCeil(1160) === 2000 && niceCeil(2400) === 2500
    && chartXToDay(-50, 46, 300, 29.5) === 0 && chartXToDay(9999, 46, 300, 29.5) === 29.5 && near(chartXToDay(196, 46, 300, 30), 15));

  // ---- Real metrics: "Your setting vs Best possible" ----------------------------------------------
  clearMissionMetricsCaches();
  const mal = REGIONS[2];
  const start = new Date('2026-11-01T00:00:00Z');
  const metrics = computeRegionMissionMetrics({
    regionId: mal.id, lat: mal.lat, lon: mal.lon, elevationKm: getElevationAt(mal.lat, mal.lon),
    horizonProfile: getRegionHorizonProfile(mal.id, mal.lat, mal.lon), startDate: start,
  });
  const atBest = compareYourSettingToBest(metrics, metrics.bestFixed.beta, metrics.bestFixed.az);
  check(`Your setting = best fixed → 100.0% (${atBest.yourEnergyWh.toFixed(0)} Wh vs ${atBest.bestEnergyWh.toFixed(0)} Wh)`, near(atBest.percentOfBest, 100, 1e-9));
  const flatPanel = compareYourSettingToBest(metrics, 0, 0);
  check(`Flat panel (0°/0°) earns ${flatPanel.percentOfBest.toFixed(1)}% of the best fixed energy (never more)`, flatPanel.percentOfBest < 100 && flatPanel.yourEnergyWh >= 0);
  let neverAbove = true;
  for (const [tilt, az] of [[10, 45], [45, 180], [90, 0], [70, 90], [85, 320]]) {
    if (compareYourSettingToBest(metrics, tilt, az).yourEnergyWh > metrics.bestFixed.energyWh + 1e-6) neverAbove = false;
  }
  check('No manual configuration beats the best fixed one', neverAbove);
  const sameBest = computeRegionMissionMetrics({
    regionId: mal.id, lat: mal.lat, lon: mal.lon, elevationKm: getElevationAt(mal.lat, mal.lon),
    horizonProfile: getRegionHorizonProfile(mal.id, mal.lat, mal.lon), startDate: start,
  });
  check('Manual settings leave the cached best fixed result untouched (same tilt/azimuth/energy)',
    sameBest.bestFixed.beta === metrics.bestFixed.beta && sameBest.bestFixed.az === metrics.bestFixed.az && sameBest.energyWh === metrics.energyWh);

  // ---- Comparison isolation ------------------------------------------------------------------------
  const fs = await import('node:fs');
  const path = await import('node:path');
  const cmpSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/comparisonEngine.js'), 'utf8');
  check('comparisonEngine.js imports no Navigator settings, card or UI code (Manual/mast changes cannot reach it)',
    !/missionSettings|missionMetricsCard|powerChart|from '\.\/ui\.js'|manualPanel/.test(cmpSrc));

  // ---- Card in JSDOM ----------------------------------------------------------------------------------
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
  const events = { settings: [], manual: [], seek: [] };
  const ui = new LunarNavigatorUI({
    container: dom.window.document.getElementById('root'),
    callbacks: {
      onMissionSettingsChange: (s, changed) => events.settings.push(changed),
      onManualPanelChange: (m) => events.manual.push(m),
    },
  });
  const $ = (id) => dom.window.document.getElementById(id);
  const card = ui.missionCard;

  check('Card exists in the region inspector, Advanced is collapsed, Manual chart hidden by default',
    !!$('mission-metrics-card') && $('mission-metrics-card').closest('#pole-region-panel') !== null
    && $('mm-advanced').open === false && $('mm-chart-wrap').classList.contains('hidden') && card.getManualPanel() === null);

  card.setMetrics(metrics);
  card.updateInstant(instantMetrics({
    sunElevationDeg: 1.2, sunAzimuthDeg: 200, earthDistanceKm: 395000, sunDistanceAu: 0.99, horizonProfile: metrics.geometry.horizonProfile,
    tiltDeg: metrics.bestFixed.beta, panelAzimuthDeg: metrics.bestFixed.az,
  }), 12.5);
  const texts = ['mm-pgen', 'mm-cos', 'mm-solar', 'mm-dearth', 'mm-fspl', 'mm-comm-hours', 'mm-longest-contact', 'mm-lit-pct',
    'mm-lit-hours', 'mm-longest-dark', 'mm-energy', 'mm-best-panel', 'mm-batt-required', 'mm-batt-survival'].map((id) => [id, $(id).textContent.trim()]);
  const empty = texts.filter(([, t]) => t === '' || t === '--' || /NaN|undefined/.test(t));
  check(`Default view needs no input: all ${texts.length} Mission Metrics values are filled${empty.length ? ' (empty: ' + empty.map((e) => e[0]).join(', ') + ')' : ''}`, empty.length === 0);
  check(`Best fixed shown = ${metrics.bestFixed.beta}° / ${metrics.bestFixed.az}°; longest dark ${$('mm-longest-dark').textContent}; battery ${$('mm-batt-required').textContent}`,
    $('mm-best-panel').textContent === `${metrics.bestFixed.beta}° / ${metrics.bestFixed.az}°` && $('mm-panel-config').textContent.startsWith('Best fixed'));
  check('Battery survival for the default 2000 Wh battery = 16.0 h', $('mm-batt-survival').textContent.trim() === '16.0 h');

  const fire = (id, value) => { const el = $(id); el.value = value; el.dispatchEvent(new dom.window.Event('change', { bubbles: true })); };

  // Battery inputs update only the derived numbers (no metrics rebuild)
  const nSettings = events.settings.length;
  fire('mm-in-batt', '4000');
  check('Battery input → survival 32.0 h, and no metrics rebuild is requested', $('mm-batt-survival').textContent.trim() === '32.0 h' && events.settings.length === nSettings);

  // Manual panel
  $('mm-manual-switch').click();
  const man = card.getManualPanel();
  check(`Manual ON pre-fills the best fixed values (${man && man.tiltDeg}° / ${man && man.azimuthDeg}°), shows the chart and the 100% legend`,
    man && man.tiltDeg === Math.round(metrics.bestFixed.beta) && man.azimuthDeg === Math.round(metrics.bestFixed.az) % 360
    && $('mm-in-tilt').value === String(man.tiltDeg) && !$('mm-chart-wrap').classList.contains('hidden')
    && /Your setting/.test($('mm-chart-legend').textContent) && /Best possible/.test($('mm-chart-legend').textContent) && /100\.0%/.test($('mm-chart-legend').textContent));
  check('Manual ON notifies the app with the panel orientation; label reads "Manual …"',
    events.manual.length === 1 && events.manual[0].tiltDeg === man.tiltDeg && $('mm-panel-config').textContent.startsWith('Manual'));

  fire('mm-in-tilt', '0');
  const flatCmp = compareYourSettingToBest(metrics, 0, man.azimuthDeg);
  check(`Manual tilt 0° → legend updates live (${flatCmp.percentOfBest.toFixed(1)}%), app notified with tilt 0`,
    events.manual.length === 2 && events.manual[1].tiltDeg === 0 && $('mm-chart-legend').textContent.includes(`${flatCmp.percentOfBest.toFixed(1)}%`));

  const before = events.manual.length;
  fire('mm-in-tilt', '95');
  check('Manual tilt 95° is rejected: error shown, previous value kept, app not notified',
    !$('mm-error').classList.contains('hidden') && /Tilt/.test($('mm-error').textContent) && card.getManualPanel().tiltDeg === 0 && events.manual.length === before);
  fire('mm-in-tilt', '30');
  check('A valid value clears the error', $('mm-error').classList.contains('hidden') && card.getManualPanel().tiltDeg === 30);

  // Metrics-affecting setting
  fire('mm-in-mast', '25');
  check('Mast height 25 m → app asked to rebuild metrics ("mastHeightM"), setting stored', events.settings.includes('mastHeightM') && card.settings.mastHeightM === 25);
  fire('mm-in-freq', '2.2');
  check('Frequency 2.2 GHz stored as 2.2e9 Hz', card.settings.frequencyHz === 2.2e9 && events.settings.includes('frequencyHz'));

  $('mm-manual-switch').click();
  check('Manual OFF hides the chart and returns to the best fixed panel (null)', $('mm-chart-wrap').classList.contains('hidden') && card.getManualPanel() === null && events.manual[events.manual.length - 1] === null);

  $('mm-reset').click();
  check('Reset defaults restores mast 10 m, 8.4 GHz, 2000 Wh and Manual OFF', card.settings.mastHeightM === 10 && card.settings.frequencyHz === 8.4e9
    && card.settings.batteryCapacityWh === 2000 && $('mm-in-mast').value === '10' && events.settings.includes('reset'));

  // Phase 11 follow-up: three main categories, each with its own Advanced section
  const inCard = (cardId, ids) => ids.every((id) => $(cardId) && $(cardId).contains($(id)));
  check('Three main categories (Sun & Power, Darkness & Battery, Communication with Earth), no "Mission Metrics" heading',
    !!$('mm-card-sun') && !!$('mm-card-dark') && !!$('mm-card-comm') && !/Mission Metrics/.test($('mission-metrics-card').textContent)
    && /Sun & Power/.test($('mm-card-sun').textContent) && /Darkness & Battery/.test($('mm-card-dark').textContent) && /Communication with Earth/.test($('mm-card-comm').textContent));
  check('Each value sits in its category, and each category has its own Advanced with the related inputs',
    inCard('mm-card-sun', ['mm-pgen', 'mm-lit-pct', 'mm-energy', 'mm-in-area', 'mm-in-eta', 'mm-in-tilt'])
    && inCard('mm-card-dark', ['mm-longest-dark', 'mm-batt-required', 'mm-in-pbase', 'mm-in-pheater', 'mm-in-dod', 'mm-in-batt'])
    && inCard('mm-card-comm', ['mm-dearth', 'mm-fspl', 'mm-comm-hours', 'mm-in-freq'])
    && !!$('mm-advanced-dark') && !!$('mm-advanced-comm'));
  fire('mm-in-mast-comm', '30');
  check('Mast height copies stay in sync across the three Advanced sections', $('mm-in-mast').value === '30' && $('mm-in-mast-dark').value === '30' && card.settings.mastHeightM === 30);
  const mastIds = ['mm-in-mast', 'mm-in-mast-dark', 'mm-in-mast-comm'];
  check('Mast inputs carry max=30 / min=0 and a one-line hint with the realistic range and the NASA VSAT note (all three copies)',
    mastIds.every((id) => $(id).getAttribute('max') === '30' && $(id).getAttribute('min') === '0' &&
      /Realistic range 0–30 m \(NASA VSAT studies: 10 m or more; some designs about 20–30 m\)\./.test($(id).parentElement.textContent)));
  const settingsEvents = events.settings.length;
  fire('mm-in-mast', '30.1');
  check('Typing 30.1 m is rejected like other inputs: error "Mast height must be 0–30 m.", previous value 30 kept, app not notified',
    !$('mm-error').classList.contains('hidden') && /Mast height must be 0–30 m\./.test($('mm-error').textContent) &&
    card.settings.mastHeightM === 30 && events.settings.length === settingsEvents);
  fire('mm-in-mast', '100');
  check('Typing 100 m is rejected too (previous 30 m kept)', card.settings.mastHeightM === 30 && events.settings.length === settingsEvents);

  return {
    name: 'Test 25: Mission Metrics Card, Manual Panel & Power Chart (Phase 9)',
    criteria: 'Battery sizing, instant metrics, input validation, Your-setting-vs-Best maths, card DOM behaviour, Comparison isolation',
    passed,
    timeMs: (performance.now() - t0).toFixed(2),
    measurements,
  };
}
