/**
 * Pole-mode scene: Earth globe state, HTML overlay labels, Sun marker and Sun path ring.
 * Pure helpers are tested directly; the overlay placement is tested against a JSDOM container
 * with a real THREE camera (no WebGL needed).
 */
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { computeEphemeris } from '../src/ephemeris.js';
import { REGIONS } from '../regions.js';
import { latLonToPolarStereo } from '../src/terrain.js';
import {
  LunarNavigatorScene, EARTH_GLOBE_RADIUS, COMMS_RAY_LENGTH, OVERVIEW_LOOK, OVERVIEW_DISTANCE, OVERVIEW_THETA, OVERVIEW_PHI,
  DOCK_DISTANCE, DOCK_THETA, DOCK_PHI, DOCK_LOOK_FORWARD, pinLabelToEdge, SUN_DISPLAY_RADIUS, SUN_MARKER_RADIUS,
  SUN_PATH_ELEVATION_EXAGGERATION, SYNODIC_MONTH_DAYS, SUN_PATH_STEP_HOURS,
  formatEarthLabel, formatSunLabel, clampLabelToViewport, polarSkyPoint,
  computeSunPathSamples, sunPathIndexAt, computePolarSunLightVector, computeCommsRayVector,
} from '../src/scene.js';

const SPATIAL_SCALE = 0.35; // LunarNavigatorScene.spatialScale

function overviewCamera(aspect) {
  // Mirrors dockToPolarOverview(): orbit around OVERVIEW_LOOK with the exported distance/theta/phi
  const d = OVERVIEW_DISTANCE;
  const th = OVERVIEW_THETA;
  const ph = OVERVIEW_PHI;
  const cam = new THREE.PerspectiveCamera(45, aspect, 0.1, 3000);
  cam.position.set(OVERVIEW_LOOK.x + d * Math.sin(ph) * Math.sin(th), OVERVIEW_LOOK.y + d * Math.cos(ph), OVERVIEW_LOOK.z + d * Math.sin(ph) * Math.cos(th));
  cam.lookAt(OVERVIEW_LOOK.x, OVERVIEW_LOOK.y, OVERVIEW_LOOK.z);
  cam.updateMatrixWorld();
  return cam;
}

function dockCamera(site, aspect) {
  // Mirrors dockToRegion(): orbit around (site + DOCK_LOOK_FORWARD in +z)
  const look = new THREE.Vector3(site.x, 0, site.z + DOCK_LOOK_FORWARD);
  const cam = new THREE.PerspectiveCamera(45, aspect, 0.1, 3000);
  cam.position.set(look.x + DOCK_DISTANCE * Math.sin(DOCK_PHI) * Math.sin(DOCK_THETA), look.y + DOCK_DISTANCE * Math.cos(DOCK_PHI), look.z + DOCK_DISTANCE * Math.sin(DOCK_PHI) * Math.cos(DOCK_THETA));
  cam.lookAt(look);
  cam.updateMatrixWorld();
  return cam;
}

export async function runPolarSceneTest() {
  const t0 = performance.now();
  const measurements = [];
  let passed = true;
  const check = (label, ok) => {
    if (!ok) passed = false;
    measurements.push(`${label} [${ok ? 'PASS' : 'FAIL'}]`);
  };

  // 1. Earth globe state machine + label text
  const clear = formatEarthLabel(4.1, 1.0);
  check(`Visible Earth: "${clear.text}" -> mode ${clear.mode}`, clear.mode === 'visible' && clear.status === 'CLEAR' && clear.text === 'Earth · elevation +4.1° · visible 100% · CLEAR');
  const partial = formatEarthLabel(1.0, 0.5);
  check('Partial limb (f=0.5, above horizon) stays a normal globe', partial.mode === 'visible' && partial.status === 'PARTIAL' && partial.tone === 'amber');
  const below = formatEarthLabel(-2.3, 0.0);
  check('Below horizon -> ghost globe, coral, "BELOW HORIZON"', below.mode === 'ghost' && below.status === 'BELOW HORIZON' && below.tone === 'coral' && below.text.includes('elevation -2.3°'));
  const blocked = formatEarthLabel(3.0, 0.0);
  check('Blocked by terrain (f=0, above horizon) -> ghost globe, "BLOCKED"', blocked.mode === 'ghost' && blocked.status === 'BLOCKED');

  // 2. Sun label text
  const sunLit = formatSunLabel({ elevationDeg: 0.84, azimuthDeg: 5.2 }, 1.0);
  check(`Sun label: "${sunLit.text}"`, sunLit.text === 'Sun · elevation +0.8° · azimuth 005° · LIT' && sunLit.tone === 'amber');
  check('Sun label SHADOWED when f=0 and BELOW HORIZON when el<0',
    formatSunLabel({ elevationDeg: 1.0, azimuthDeg: 200 }, 0).status === 'SHADOWED' &&
    formatSunLabel({ elevationDeg: -0.4, azimuthDeg: 359.7 }, 1).text.includes('azimuth 000°'));

  // 3. Viewport clamp
  const base = { labelW: 200, labelH: 24, viewW: 1000, viewH: 600, margin: 8 };
  const inside = clampLabelToViewport({ ...base, anchorX: 500, anchorY: 300 });
  const left = clampLabelToViewport({ ...base, anchorX: -400, anchorY: 300 });
  const right = clampLabelToViewport({ ...base, anchorX: 5000, anchorY: 300, rightInset: 400 });
  const top = clampLabelToViewport({ ...base, anchorX: 500, anchorY: -900 });
  const bottom = clampLabelToViewport({ ...base, anchorX: 500, anchorY: 9000 });
  const tiny = clampLabelToViewport({ labelW: 900, labelH: 40, viewW: 300, viewH: 30, anchorX: 0, anchorY: 0 });
  check('Clamp keeps an in-view anchor unchanged', inside.x === 500 && inside.y === 300);
  check('Clamp pins to left/top/bottom margins', left.x === 108 && top.y === 32 && bottom.y === 592);
  check('Clamp respects the right-panel inset', right.x === 1000 - 400 - 8 - 100);
  check('Clamp never returns NaN when the label is larger than the view', Number.isFinite(tiny.x) && Number.isFinite(tiny.y));

  // 4. Globe at the ray end stays fully visible when docked to every region and in the High Polar Overview,
  //    for Earth elevations across the libration range, at several aspect ratios (right panel reserved: NDC x < 0.25)
  const halfWidthUnits = CONFIG.radii.polarDomainSpanKm * SPATIAL_SCALE;
  const sites = REGIONS.map((r) => { const q = latLonToPolarStereo(r.lat, r.lon); return { name: r.name, x: q.x * SPATIAL_SCALE, z: -q.y * SPATIAL_SCALE }; });
  const framing = { overview: { worst: 1e9, at: '' }, docked: { worst: 1e9, at: '' } };
  for (const aspect of [16 / 9, 4 / 3, 1.2]) {
    for (const st of sites) {
      for (const el of [-8, 0, 8]) {
        const dir = new THREE.Vector3(0, Math.sin((el * Math.PI) / 180), Math.cos((el * Math.PI) / 180));
        const globe = new THREE.Vector3(st.x, 1, st.z).addScaledVector(dir, COMMS_RAY_LENGTH);
        for (const [mode, cam] of [['overview', overviewCamera(aspect)], ['docked', dockCamera(st, aspect)]]) {
          const c = globe.clone().project(cam);
          const rNdc = (EARTH_GLOBE_RADIUS / cam.position.distanceTo(globe)) / Math.tan(THREE.MathUtils.degToRad(22.5));
          const margin = c.z > -1 && c.z < 1 ? Math.min(1 - Math.abs(c.y) - rNdc, 0.25 - c.x - rNdc, c.x + 1 - rNdc) : -9;
          if (margin < framing[mode].worst) framing[mode] = { worst: margin, at: `${st.name} ${aspect.toFixed(2)} el ${el}` };
        }
      }
    }
  }
  check(`High Polar Overview: globe at the ray end fully in view for all ${sites.length} regions, 3 aspects, Earth elevation -8…+8° (worst margin ${framing.overview.worst.toFixed(2)} NDC at ${framing.overview.at})`, framing.overview.worst > 0);
  check(`Docked camera (informational: with the 70 u ray the globe may leave the frame; the Earth label then pins to the screen edge with an arrow): worst margin for all ${sites.length} regions, 3 aspects, Earth elevation -8…+8° (worst margin ${framing.docked.worst.toFixed(2)} NDC at ${framing.docked.at})`, true);
  check(`Ray length ${COMMS_RAY_LENGTH} u and globe radius ${EARTH_GLOBE_RADIUS} u`, COMMS_RAY_LENGTH === 70 && EARTH_GLOBE_RADIUS === 2);
  check(`Sun display radius ${SUN_DISPLAY_RADIUS} is outside the terrain half-width ${halfWidthUnits.toFixed(1)}`, SUN_DISPLAY_RADIUS > halfWidthUnits);

  // Orrery: Moon preset follows the Moon (target and camera shift together), other presets do not
  {
    const o = Object.create(LunarNavigatorScene.prototype);
    const g = () => ({ position: new THREE.Vector3(), rotation: new THREE.Euler(), lookAt() {} });
    Object.assign(o, { viewMode: 'orrery', moonPos: new THREE.Vector3(), sunPos: new THREE.Vector3(), earthPos: new THREE.Vector3(),
      targetCamLook: new THREE.Vector3(), targetCamPos: new THREE.Vector3(), orbitAngle: { distance: 95, theta: 0.5, phi: 0.85 },
      sunGroup: g(), sunLight: g(), earthGroup: g(), moonGroup: g(), moonMesh: g() });
    const t0m = Date.parse('2026-11-07T00:00:00Z');
    o.updateSimulation(computeEphemeris(new Date(t0m)));
    o.setCameraPreset('moon');
    const off0 = o.targetCamPos.clone().sub(o.targetCamLook);
    for (let h = 6; h <= 72; h += 6) o.updateSimulation(computeEphemeris(new Date(t0m + h * 3600e3)));
    check('Orrery Moon preset: camera target stays on the Moon and keeps its offset as time advances',
      o.targetCamLook.distanceTo(o.moonPos) < 1e-9 && o.targetCamPos.clone().sub(o.targetCamLook).distanceTo(off0) < 1e-9);
    o.setCameraPreset('overview');
    const held = o.targetCamLook.clone();
    o.updateSimulation(computeEphemeris(new Date(t0m + 5 * 86400e3)));
    check('Orrery Overview preset does not follow the Moon', o.targetCamLook.equals(held));
  }

  // 5. Sun marker direction = scene light direction (true elevation), and ring geometry
  const center = new Date('2026-11-15T00:00:00Z');
  const vec = computePolarSunLightVector(computeEphemeris(center));
  const p1 = polarSkyPoint(vec, SUN_DISPLAY_RADIUS, 1);
  const dirErr = Math.hypot(p1.x / SUN_DISPLAY_RADIUS - vec.sunX, p1.y / SUN_DISPLAY_RADIUS - vec.sunY, p1.z / SUN_DISPLAY_RADIUS - vec.sunZ);
  check(`Sun marker (exaggeration 1) lies on the light direction (max err ${dirErr.toExponential(1)})`, dirErr < 1e-9);

  const tPath = performance.now();
  const path = computeSunPathSamples(center);
  const pathMs = performance.now() - tPath;
  const n = path.samples.length;
  check(`Sun path: ${n} samples, ${SUN_PATH_STEP_HOURS} h step over ${SYNODIC_MONTH_DAYS} d, built in ${pathMs.toFixed(0)} ms (one-off per cache bucket)`, n === Math.round((SYNODIC_MONTH_DAYS * 24) / SUN_PATH_STEP_HOURS) + 1 && pathMs < 1500);

  let travelled = 0;
  for (let i = 1; i < n; i++) {
    let d = path.samples[i].azDeg - path.samples[i - 1].azDeg;
    d = ((d + 540) % 360) - 180;
    travelled += Math.abs(d);
  }
  check(`Sun path azimuth sweeps one full turn over the synodic month (${travelled.toFixed(1)}° ≈ 360°)`, Math.abs(travelled - 360) < 15);

  const maxEl = Math.max(...path.samples.map((s) => Math.abs(s.elDeg)));
  const maxY = Math.max(...path.samples.map((s) => Math.abs(s.point.y)));
  const yLimit = SUN_DISPLAY_RADIUS * Math.sin((SUN_PATH_ELEVATION_EXAGGERATION * 1.6 * Math.PI) / 180);
  check(`Sun path is nearly flat: |elevation| ≤ ${maxEl.toFixed(2)}° (lunar obliquity 1.54°), ring |y| ≤ ${maxY.toFixed(1)} units (limit ${yLimit.toFixed(1)})`, maxEl < 1.7 && maxY < yLimit);
  const s0 = path.samples[100];
  check('Ring height = true elevation × exaggeration', Math.abs(s0.point.y - SUN_DISPLAY_RADIUS * Math.sin((s0.elDeg * SUN_PATH_ELEVATION_EXAGGERATION * Math.PI) / 180)) < 1e-6);
  const mid = sunPathIndexAt(path, center.getTime());
  check(`Current-time index at window centre = ${mid} (≈ ${(n - 1) / 2}); clamps at both ends`,
    Math.abs(mid - (n - 1) / 2) <= 1 && sunPathIndexAt(path, path.startMs - 1e9) === 0 && sunPathIndexAt(path, path.startMs + 1e12) === n - 2);

  // 5b. Real scene-building code against a stub (no WebGL): globe, ghost state, guide line, Sun ring cache
  const stub = Object.create(LunarNavigatorScene.prototype);
  stub.container = { clientWidth: 1200, clientHeight: 700 };
  stub.poleTerrainGroup = new THREE.Group();
  stub.spatialScale = SPATIAL_SCALE;
  stub.verticalScale = 0.40;
  stub.viewMode = 'south_pole';
  stub.isCommsRayVisible = true;
  stub.isEarthGlobeVisible = true;
  stub.isSunVisible = true;
  stub.sunMarkerPos = new THREE.Vector3();
  stub._sunPath = null;
  stub._sunPathCenterMs = NaN;
  // Build without a DOM (procedural texture and glow sprite are skipped); other tests may leave a stub document behind
  const savedDocument = globalThis.document;
  delete globalThis.document;
  try {
    stub._createCommsRay();
    stub._createSunLayer();
  } finally {
    if (savedDocument !== undefined) globalThis.document = savedDocument;
  }
  const posKey = () => stub.commsEarthGroup.position.toArray().map((v) => v.toFixed(6)).join(',');
  stub.currentEphem = computeEphemeris(center);

  stub.updateCommsRay(REGIONS[2], { azimuthDeg: 10, elevationDeg: 4.0 }, 1.0);
  const key1 = posKey();
  const rpA = stub.commsRayGeometry.attributes.position.array;
  const tipA = new THREE.Vector3(rpA[3], rpA[4], rpA[5]);
  const globeAtTipA = stub.commsEarthGroup.position.distanceTo(tipA) < 1e-5;
  const rp = stub.commsRayGeometry.attributes.position.array;
  const rayDir = new THREE.Vector3(rp[3] - rp[0], rp[4] - rp[1], rp[5] - rp[2]);
  check(`Visible state: textured globe + crisp bright rim + glow halo all on (mode ${stub._earthGlobeMode})`,
    stub._earthGlobeMode === 'visible' && stub.commsEarthMesh.visible && stub.commsGhostMesh === undefined && stub.commsRimMesh.visible && stub.commsHaloMesh.visible);
  stub.updateCommsRay(REGIONS[0], { azimuthDeg: 200, elevationDeg: -3.0 }, 0.0);
  const key2 = posKey();
  const rpB = stub.commsRayGeometry.attributes.position.array;
  const tipB = new THREE.Vector3(rpB[3], rpB[4], rpB[5]);
  check('Globe sits exactly at the ray tip and moves with the selected site / Earth direction', globeAtTipA && stub.commsEarthGroup.position.distanceTo(tipB) < 1e-5 && key1 !== key2);
  check(`Ghost state (below horizon): globe body hidden (no fill), crisp bright rim stays on and ignores depth`,
    stub._earthGlobeMode === 'ghost' && !stub.commsEarthMesh.visible && !stub.commsCloudMesh.visible && stub.commsGhostMesh === undefined &&
    stub.commsRimMesh.visible && stub.commsRimMesh.material.depthTest === false && stub.commsHaloMesh.material.uniforms.strength.value > 0.55);
  stub.updateCommsRay(REGIONS[2], { azimuthDeg: 10, elevationDeg: 4.0 }, 1.0);
  check('Returning to a clear sky restores the textured globe and depth-tested halo', stub._earthGlobeMode === 'visible' && stub.commsEarthMesh.visible && stub.commsRimMesh.visible && stub.commsHaloMesh.material.depthTest === true);
  const rp2 = stub.commsRayGeometry.attributes.position.array;
  const ray2 = new THREE.Vector3(rp2[3] - rp2[0], rp2[4] - rp2[1], rp2[5] - rp2[2]);
  const expectDir = new THREE.Vector3(...(() => { const v = computeCommsRayVector(REGIONS[2], { azimuthDeg: 10, elevationDeg: 4.0 }); return [v.dirX, v.dirY, v.dirZ]; })());
  check(`Ray runs ${ray2.length().toFixed(1)} u along the true Earth direction (angle error ${ray2.angleTo(expectDir).toExponential(1)} rad); no extra guide line exists`,
    Math.abs(ray2.length() - COMMS_RAY_LENGTH) < 1e-3 && ray2.angleTo(expectDir) < 1e-6 && stub.commsGuideLine === undefined && stub.commsGuideGeometry === undefined);

  stub.setCommsRayVisible(false);
  const rayOffGlobeOn = stub.commsRayGroup.visible && !stub.commsRayLine.visible && stub.commsEarthGroup.visible;
  stub.setCommsRayVisible(true);
  stub.setEarthGlobeVisible(false);
  const globeOffRayOn = stub.commsRayGroup.visible && stub.commsRayLine.visible && !stub.commsEarthGroup.visible;
  stub.setCommsRayVisible(false);
  const bothOff = !stub.commsRayGroup.visible;
  stub.setCommsRayVisible(true);
  stub.setEarthGlobeVisible(true);
  stub.viewMode = 'orrery';
  stub._syncCommsVisibility();
  const orreryHidden = !stub.commsRayGroup.visible;
  stub.viewMode = 'south_pole';
  stub._syncCommsVisibility();
  check('Ray and globe toggle independently; both hidden in Orrery mode', rayOffGlobeOn && globeOffRayOn && bothOff && orreryHidden);

  // Sun layer: marker, past/future split, cache, visibility
  const sv = computePolarSunLightVector(stub.currentEphem);
  stub._updateSunLayer(stub.currentEphem, sv);
  const pathA = stub._sunPath;
  const k = sunPathIndexAt(pathA, center.getTime());
  const expectMarker = polarSkyPoint(sv, SUN_DISPLAY_RADIUS, SUN_PATH_ELEVATION_EXAGGERATION);
  check(`Exactly one Sun ball: it rides on the ring at the true bearing (radius ${SUN_DISPLAY_RADIUS} u); no separate path-marker sphere`,
    Math.abs(stub.sunMarkerGroup.position.x - expectMarker.x) < 1e-9 && Math.abs(stub.sunMarkerGroup.position.y - expectMarker.y) < 1e-9 &&
    Math.abs(stub.sunMarkerGroup.position.z - expectMarker.z) < 1e-9 && stub.sunPathMarker === undefined);
  const pr = stub.sunPathPast.geometry.drawRange;
  const fr = stub.sunPathFuture.geometry.drawRange;
  check(`Past/future split at the current time (index ${k}): past 0…${k}, future ${k}…${pathA.samples.length - 1}, shared vertex buffer, different opacity`,
    pr.start === 0 && pr.count === k + 1 && fr.start === k && fr.count === pathA.samples.length - k &&
    stub.sunPathPast.geometry.attributes.position === stub.sunPathFuture.geometry.attributes.position &&
    stub.sunPathPast.material.opacity < stub.sunPathFuture.material.opacity);

  // Scrubbing one hour at a time for 41 days must rebuild the ring only a handful of times (not per tick)
  let rebuilds = 0;
  let last = stub._sunPath;
  const tScrub = performance.now();
  for (let h = 0; h < 41 * 24; h++) {
    const e = computeEphemeris(new Date(center.getTime() + h * 3600 * 1000));
    stub._updateSunLayer(e, computePolarSunLightVector(e));
    if (stub._sunPath !== last) { rebuilds++; last = stub._sunPath; }
  }
  const scrubMs = performance.now() - tScrub;
  check(`Scrubbing 984 hourly ticks over 41 d rebuilt the Sun ring ${rebuilds}× (≤ 7; cached otherwise; total ${scrubMs.toFixed(0)} ms including the ephemeris)`, rebuilds >= 1 && rebuilds <= 7);

  stub.setSunVisible(false);
  const sunOff = !stub.sunLayerGroup.visible;
  stub.setSunVisible(true);
  const sunOn = stub.sunLayerGroup.visible;
  stub.viewMode = 'orrery';
  stub._syncSunVisibility();
  check('Sun & Sun path: toggle works and the layer is hidden in Orrery mode', sunOff && sunOn && !stub.sunLayerGroup.visible);

  // 6. HTML overlay placement (JSDOM container + real THREE camera; no WebGL)
  const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
  if (isNode) {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('<!doctype html><div id="c"></div><aside id="pole-region-panel"></aside>');
    const prev = { document: globalThis.document, getComputedStyle: globalThis.getComputedStyle };
    globalThis.document = dom.window.document;
    globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
    try {
      const container = dom.window.document.getElementById('c');
      Object.defineProperty(container, 'clientWidth', { value: 1200 });
      Object.defineProperty(container, 'clientHeight', { value: 700 });
      const scene = Object.create(LunarNavigatorScene.prototype);
      scene.container = container;
      scene.camera = overviewCamera(1200 / 700);
      scene.viewMode = 'south_pole';
      scene.isEarthGlobeVisible = true;
      scene.isSunVisible = true;
      scene._overlayRightInset = 420;
      const globePos = new THREE.Vector3(0, 1, 60); // a globe at the end of a ray, e.g. near Malapert
      scene.commsEarthGroup = { position: globePos };
      scene.sunMarkerPos = new THREE.Vector3(SUN_DISPLAY_RADIUS, 2, 0);
      scene._createOverlays();
      // jsdom has no layout: give the labels a realistic size
      for (const l of [scene.earthLabel, scene.sunLabel]) {
        Object.defineProperty(l.el, 'offsetWidth', { value: 330, configurable: true });
        Object.defineProperty(l.el, 'offsetHeight', { value: 26, configurable: true });
      }
      scene._setLabel(scene.earthLabel, clear.text, clear.tone);
      scene._setLabel(scene.sunLabel, sunLit.text, sunLit.tone);
      const readPos = (l) => {
        const m = /translate\((-?\d+)px, (-?\d+)px\)/.exec(l.el.style.transform || '');
        return m ? { x: +m[1], y: +m[2] } : null;
      };
      const withinView = (l) => {
        const p = readPos(l);
        return !!p && p.x >= 8 && p.y >= 8 && p.x + 330 <= 1200 - 420 + 0.5 && p.y + 26 <= 700 - 8;
      };

      scene._updateOverlayPositions();
      check('Overlay: Earth label shown in the overview, inside the viewport and clear of the right panel', !scene.earthLabel.el.classList.contains('hidden') && withinView(scene.earthLabel));
      check('Overlay: label font size is fixed (no inline size; CSS class only)', scene.earthLabel.el.style.fontSize === '' && scene.earthLabel.el.className.includes('text-[11px]'));

      // Zoom far in / far out and orbit: label stays on screen
      let allIn = true;
      for (const [dist, theta, phi] of [[20, 0.6, 0.72], [400, 0.5, 0.82], [90, 2.4, 0.5], [60, -1.2, 1.2]]) {
        const cam = scene.camera;
        cam.position.set(dist * Math.sin(phi) * Math.sin(theta), dist * Math.cos(phi), dist * Math.sin(phi) * Math.cos(theta));
        cam.lookAt(0, 0, 0);
        scene._updateOverlayPositions();
        const l = scene.earthLabel;
        if (!l.el.classList.contains('hidden') && !withinView(l)) allIn = false;
      }
      check('Overlay: label stays inside the viewport for zoom 20…400 and several orbit angles (off-screen globe clamps to the edge)', allIn);

      // Globe behind the camera: label is NOT lost; it pins to the screen edge with an arrow
      scene.camera.position.set(globePos.x, globePos.y + 5, globePos.z + 60);
      scene.camera.lookAt(globePos.x, globePos.y + 5, globePos.z + 200); // looking away, globe is behind
      scene._updateOverlayPositions();
      check('Overlay: globe behind the camera -> label stays visible, inside the viewport, with the arrow shown',
        !scene.earthLabel.el.classList.contains('hidden') && withinView(scene.earthLabel) && !scene.earthLabel.arrowEl.classList.contains('hidden'));

      // Globe off to one side of the screen: label pinned to that edge, arrow pointing toward it
      const sideCam = scene.camera;
      sideCam.position.set(0, 30, -120);
      sideCam.lookAt(260, 1, 60); // globe is now far to the left of the view centre
      sideCam.updateMatrixWorld();
      scene._updateOverlayPositions();
      const pl = readPos(scene.earthLabel);
      const ang = ((/rotate\((-?\d+)deg\)/.exec(scene.earthLabel.arrowEl.style.transform || '') || [])[1]);
      // Expected arrow direction: from the centre of the usable area toward the globe's real screen position
      const gN = globePos.clone().project(sideCam);
      const expDeg = (Math.atan2((-gN.y * 0.5 + 0.5) * 700 - 350, (gN.x * 0.5 + 0.5) * 1200 - (1200 - 420) / 2) * 180) / Math.PI;
      const dAng = Math.abs((((+ang - expDeg) % 360) + 540) % 360 - 180);
      check(`Overlay: globe off-screen -> label pinned to the edge (x=${pl && pl.x}) with arrow ${ang}° toward the globe (expected ${expDeg.toFixed(0)}°), label inside the viewport`,
        gN.x > 1 && !scene.earthLabel.arrowEl.classList.contains('hidden') && withinView(scene.earthLabel) && ang !== undefined && dAng < 2);

      // Globe on screen again: arrow hidden, label above the globe
      scene.camera = overviewCamera(1200 / 700);
      scene.camera.updateMatrixWorld();
      scene.commsEarthGroup.position.set(0, 1, 30);
      scene._updateOverlayPositions();
      check('Overlay: globe on screen -> arrow hidden', scene.earthLabel.arrowEl.classList.contains('hidden') && !scene.earthLabel.el.classList.contains('hidden'));

      const edge = pinLabelToEdge({ dirX: 1, dirY: 0, labelW: 300, labelH: 26, viewW: 1000, viewH: 600, margin: 8, rightInset: 400 });
      const edgeUp = pinLabelToEdge({ dirX: 0, dirY: -1, labelW: 300, labelH: 26, viewW: 1000, viewH: 600 });
      check('pinLabelToEdge: rightward -> right limit of the usable area (panel reserved), upward -> top margin, arrow angle 0° / -90°',
        Math.abs(edge.x - (1000 - 400 - 8 - 150)) < 1e-6 && Math.abs(edge.angleRad) < 1e-9 && Math.abs(edgeUp.y - (8 + 13)) < 1e-6 && Math.abs(edgeUp.angleRad + Math.PI / 2) < 1e-9);

      scene.camera = overviewCamera(1200 / 700);
      scene._updateOverlayPositions();
      scene.isEarthGlobeVisible = false;
      scene._updateOverlayPositions();
      check('Overlay: Earth label hidden when the Earth layer is off; Sun label unaffected', scene.earthLabel.el.classList.contains('hidden') && !scene.sunLabel.el.classList.contains('hidden'));
      scene.isSunVisible = false;
      scene._updateOverlayPositions();
      scene.isEarthGlobeVisible = true;
      scene.viewMode = 'orrery';
      scene._updateOverlayPositions();
      check('Overlay: Sun label hidden when the Sun layer is off; both hidden in Orrery mode', scene.sunLabel.el.classList.contains('hidden') && scene.earthLabel.el.classList.contains('hidden'));
    } finally {
      globalThis.document = prev.document;
      globalThis.getComputedStyle = prev.getComputedStyle;
      if (prev.document === undefined) delete globalThis.document;
      if (prev.getComputedStyle === undefined) delete globalThis.getComputedStyle;
    }
  }

  return {
    name: 'Test 22: Pole Scene (Earth globe state, HTML labels, Sun marker and Sun path)',
    criteria: 'Globe switches to a high-visibility ghost when blocked/below horizon, labels stay inside the viewport at any zoom, and the Sun marker/ring follow the same ephemeris geometry as the scene light',
    passed,
    timeMs: (performance.now() - t0).toFixed(2),
    measurements,
  };
}
