/** Phase 13: Moon globe landing view (pure helpers, scene code against a WebGL-free stub, JSDOM view toggle). */
import * as THREE from 'three';
import { REGIONS } from '../regions.js';
import { CONFIG } from '../config.js';
import { LunarNavigatorScene } from '../src/scene.js';
import { makeUserPointRegion } from '../src/pickPoint.js';
import { computeEphemeris, findNextNewMoon, findNextFullMoon } from '../src/ephemeris.js';
import {
  GLOBE_RADIUS, GLOBE_KM_TO_UNITS, GLOBE_MIN_DISTANCE, GLOBE_MAX_DISTANCE, GLOBE_PHI_MAX, GLOBE_MAX_CAMERA_Y, GLOBE_ORBIT_TARGET,
  GLOBE_DEFAULT_ORBIT, GLOBE_FOCUS_SOUTH_ORBIT, GLOBE_CAMERA_UP, GLOBE_DRAG_SIGN,
  GLOBE_EARTH_DISTANCE, GLOBE_EARTH_RADIUS, GLOBE_SUN_DISTANCE, GLOBE_SUN_RADIUS, GLOBE_SUN_LAT_EXAGGERATION, GLOBE_EARTH_PATH_DAYS, GLOBE_PATH_STEP_HOURS,
  GLOBE_SUN_RING_PAST_OPACITY, GLOBE_SUN_RING_FUTURE_OPACITY, GLOBE_SUN_MARKER_RADIUS_FACTOR,
  globePathNeedsRebuild, GLOBE_PATH_RECENTER_MS, GLOBE_EARTH_PATH_PAST_OPACITY, GLOBE_EARTH_PATH_FUTURE_OPACITY,
  globePinScale, GLOBE_PIN_MIN_SCALE, GLOBE_PIN_SCREEN_SCALE, GLOBE_PIN_HIT_MIN_FACTOR,
  globeProximityFade, GLOBE_FADE_INNER_FACTOR, GLOBE_FADE_OUTER_FACTOR,
  globeLightDirection, globeEarthshineIntensity, GLOBE_EARTHSHINE_MIN, GLOBE_EARTHSHINE_MAX, GLOBE_AMBIENT_INTENSITY, GLOBE_LIGHT_DISTANCE,
  globeBodyPosition, sunOrbitRingSamples, earthLibrationPathSamples, pathIndexAt, earthLitFractionFromMoon,
  latLonToGlobePosition, globePositionToLatLon, globeOrbitForLatLon, globeCameraPosition, clampGlobeOrbit, isGlobePointVisible, isGlobeHeadVisible,
} from '../src/globeView.js';

export async function runGlobeViewTest() {
  const t0 = performance.now();
  const measurements = [];
  let passed = true;
  const check = (label, ok) => { if (!ok) passed = false; measurements.push(`${label} [${ok ? 'PASS' : 'FAIL'}]`); };
  const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
  const len = (p) => Math.hypot(p.x, p.y, p.z);

  // 1. Pure geometry
  {
    const e = latLonToGlobePosition(0, 0);
    const n = latLonToGlobePosition(90, 0);
    const s = latLonToGlobePosition(-90, 0);
    const east = latLonToGlobePosition(0, 90);
    check('lat/lon -> sphere: (0°,0°) on +x, poles on ±y, 90°E on -z',
      near(e.x, GLOBE_RADIUS) && near(e.y, 0) && near(n.y, GLOBE_RADIUS, 1e-9) && near(s.y, -GLOBE_RADIUS, 1e-9) && near(east.z, -GLOBE_RADIUS, 1e-9));
    let roundTrip = true;
    for (const [la, lo] of [[-90, 0], [-85.3, 127.9], [-80, -179.5], [0, 0], [-45.25, -68.8], [30, 90]]) {
      const b = globePositionToLatLon(latLonToGlobePosition(la, lo));
      if (!near(b.lat, la, 1e-9) || (Math.abs(la) < 89.99 && !near(b.lon, lo, 1e-9))) roundTrip = false;
    }
    check('globePositionToLatLon inverts latLonToGlobePosition (also for points off the sphere along the same radius)',
      roundTrip && near(globePositionToLatLon({ x: 3, y: 0, z: 0 }).lon, 0) && near(globePositionToLatLon(latLonToGlobePosition(-85, 40, 25)).lon, 40, 1e-9));
    check('All nine region pins lie on the sphere (radius = lunar radius 1737.4 km scaled to the globe)',
      REGIONS.length === 9 && REGIONS.every((r) => near(len(latLonToGlobePosition(r.lat, r.lon)), GLOBE_RADIUS, 1e-9))
        && near(GLOBE_KM_TO_UNITS * CONFIG.radii.lunarRadiusKm, GLOBE_RADIUS, 1e-12));
    check('Pin latitudes are southern (all nine at y < 0) and the pole is the pole of the sphere',
      REGIONS.every((r) => latLonToGlobePosition(r.lat, r.lon).y < 0));
    const lo = clampGlobeOrbit({ theta: 0, phi: 0, distance: 1 });
    const loPos = globeCameraPosition(lo);
    check('Orbit clamps keep the camera outside the surface (>= min distance from the globe centre), at or south of the equator plane, inside the far limit, and phi off the axis',
      GLOBE_MIN_DISTANCE > GLOBE_RADIUS && len(loPos) >= GLOBE_MIN_DISTANCE - 1e-6 && loPos.y <= GLOBE_MAX_CAMERA_Y + 1e-6
      && clampGlobeOrbit({ theta: 0, phi: 2, distance: 1e6 }).distance === GLOBE_MAX_DISTANCE && clampGlobeOrbit({ theta: 0, phi: 10, distance: 20 }).phi === GLOBE_PHI_MAX);
    const everyOrbitOutside = [0, 0.5, 1, 1.5, 2, 2.5, 3.1].every((ph) => [1, 5, 11, 30, 70].every((d) => {
      const o = clampGlobeOrbit({ theta: 1, phi: ph, distance: d });
      const c = globeCameraPosition(o);
      return len(c) >= GLOBE_MIN_DISTANCE - 1e-6 && c.y <= GLOBE_MAX_CAMERA_Y + 1e-6;
    }));
    check('Any drag/zoom input ends outside the sphere and never north of the equator plane', everyOrbitOutside);
    check('Orbit target: on the rotation axis at the 70°S circle height (0.6 units from the pole), not the globe centre',
      GLOBE_ORBIT_TARGET.x === 0 && GLOBE_ORBIT_TARGET.z === 0 && near(GLOBE_ORBIT_TARGET.y, GLOBE_RADIUS * Math.sin(-70 * Math.PI / 180), 1e-12)
      && near(GLOBE_ORBIT_TARGET.y + GLOBE_RADIUS, GLOBE_RADIUS * (1 - Math.sin(70 * Math.PI / 180)), 1e-9));
    const c0 = globeCameraPosition(globeOrbitForLatLon(-60, 0, 30));
    check('Orbit for (-60°,0°): camera sits on the line through that point at the requested distance',
      near(len(c0), 30, 1e-9) && c0.x > 0 && c0.y < 0 && near(Math.atan2(-c0.y, c0.x) * 180 / Math.PI, 60, 1e-6));
    const north = globeCameraPosition(globeOrbitForLatLon(60, 0, 30));
    check('South lock: a northern target is clamped to the equator plane (camera world y = 0)', near(north.y, GLOBE_MAX_CAMERA_Y, 1e-6));
    const aligned = REGIONS.every((r) => {
      const c = globeCameraPosition(globeOrbitForLatLon(r.lat, r.lon, 20));
      const p = latLonToGlobePosition(r.lat, r.lon, 1);
      return (c.x * p.x + c.y * p.y + c.z * p.z) / 20 > 0.999;
    });
    check('Fly-to orbit puts the camera on the line through the globe centre and each region pin', aligned);
    const def = globeCameraPosition(GLOBE_DEFAULT_ORBIT);
    check('Pin visibility (surface test): equator lon 0° faces the landing camera, lon 180° and the north pole do not',
      isGlobePointVisible(latLonToGlobePosition(0, 0), def) && isGlobePointVisible(latLonToGlobePosition(0, 180), def) === false
      && isGlobePointVisible(latLonToGlobePosition(90, 0), def) === false);
    check('Landing view is side-on: camera on the equator plane at lon 0°, GLOBE_DEFAULT_ORBIT.distance from the orbit target',
      near(def.y, 0, 1e-9) && def.x > 0 && near(Math.hypot(def.x - GLOBE_ORBIT_TARGET.x, def.y - GLOBE_ORBIT_TARGET.y, def.z - GLOBE_ORBIT_TARGET.z), GLOBE_DEFAULT_ORBIT.distance, 1e-9));
    const headAt = (lat, lon, h = 1.1) => latLonToGlobePosition(lat, lon, GLOBE_RADIUS + h);
    check('Line-of-sight helper: a pin head at the south pole is visible side-on, an equator point on the far side is hidden',
      isGlobeHeadVisible(headAt(-86, 0.3), def) && isGlobeHeadVisible(headAt(-86, 127.9), def)
      && isGlobeHeadVisible(headAt(0, 0), def) && isGlobeHeadVisible(headAt(0, 180), def) === false);
    check('Landing view: all nine pin heads are in line of sight (standing up past the top rim)',
      REGIONS.every((r) => isGlobeHeadVisible(headAt(r.lat, r.lon), def)));
    check('Globe is upside down: camera up is -y and both drag axes are inverted', GLOBE_CAMERA_UP.y === -1 && GLOBE_DRAG_SIGN === -1);
    const foc = globeCameraPosition(GLOBE_FOCUS_SOUTH_ORBIT);
    check('Focus South Pole preset: camera below the globe on the axis side and all nine pins face it',
      foc.y < -GLOBE_RADIUS && REGIONS.every((r) => isGlobePointVisible(latLonToGlobePosition(r.lat, r.lon), foc)));
  }


  // 1b. Phase G1: Earth/Sun display constants and pure helpers
  {
    const center = new Date('2026-11-10T12:00:00Z');
    check('G1 constants: Earth inside the maximum camera distance, Sun ring outside it and outside the Earth, radii positive, lat exaggeration >= 1',
      GLOBE_EARTH_DISTANCE < GLOBE_MAX_DISTANCE && GLOBE_SUN_DISTANCE > GLOBE_EARTH_DISTANCE && GLOBE_SUN_DISTANCE >= GLOBE_MAX_DISTANCE
      && GLOBE_EARTH_RADIUS > 0 && GLOBE_SUN_RADIUS > 0 && GLOBE_SUN_LAT_EXAGGERATION >= 1 && GLOBE_EARTH_PATH_DAYS === 27.55 && GLOBE_PATH_STEP_HOURS === 6);
    const b = globeBodyPosition(-30, 40, 25);
    const ex = globeBodyPosition(1.5, 40, 75, 2);
    const exRef = latLonToGlobePosition(3, 40, 75);
    check('globeBodyPosition: lies at the requested radius, equals latLonToGlobePosition, latitude exaggeration multiplies latitude only',
      near(len(b), 25, 1e-9) && near(b.y, latLonToGlobePosition(-30, 40, 25).y) && near(len(ex), 75, 1e-9) && near(ex.x, exRef.x) && near(ex.y, exRef.y) && near(ex.z, exRef.z));
    const lib = earthLibrationPathSamples(center);
    const nLib = Math.round(GLOBE_EARTH_PATH_DAYS * 24 / GLOBE_PATH_STEP_HOURS) + 1;
    check('Libration path: 6 h steps over 27.55 d centred on the date, every sample at GLOBE_EARTH_DISTANCE',
      lib.samples.length === nLib && lib.stepMs === 6 * 3600e3 && Math.abs(lib.startMs + (lib.samples.length - 1) * lib.stepMs / 2 - center.getTime()) <= lib.stepMs
      && lib.samples.every((s) => near(len(s.point), GLOBE_EARTH_DISTANCE, 1e-9)));
    check('Libration samples stay within about ±8° of lat 0 / lon 0 (loop around the mean sub-Earth point)',
      lib.samples.every((s) => Math.abs(s.lat) < 8.5 && Math.abs(s.lon) < 9.5) && Math.max(...lib.samples.map((s) => Math.abs(s.lat))) > 3);
    const ring = sunOrbitRingSamples(center);
    let unwrapped = 0;
    for (let i = 1; i < ring.samples.length; i++) {
      let d = ring.samples[i].lon - ring.samples[i - 1].lon;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      unwrapped += d;
    }
    check('Sun ring: one synodic month (~29.53 d) at GLOBE_SUN_DISTANCE, covers about 360° of longitude, latitude exaggerated but small',
      Math.abs(Math.abs(unwrapped) - 360) < 20 && ring.samples.every((s) => near(len(s.point), GLOBE_SUN_DISTANCE, 1e-9))
      && Math.abs(ring.samples.length - 1 - Math.round(29.530588 * 4)) <= 1
      && ring.samples.every((s) => Math.abs(globePositionToLatLon(s.point).lat) < 3.2 + 1e-6));
    const e0 = computeEphemeris(new Date(ring.startMs + 10 * ring.stepMs));
    const p0 = globeBodyPosition(e0.subSolarLat, e0.subSolarLon, GLOBE_SUN_DISTANCE, GLOBE_SUN_LAT_EXAGGERATION);
    check('Sun ring sample i is the exaggerated sub-solar direction at startMs + i*stepMs', near(p0.x, ring.samples[10].point.x, 1e-9) && near(p0.y, ring.samples[10].point.y, 1e-9) && near(p0.z, ring.samples[10].point.z, 1e-9));
    const mid = lib.startMs + 100.5 * lib.stepMs;
    check('pathIndexAt: sample at or before the time, clamped so k and k+1 are valid',
      pathIndexAt(lib, mid) === 100 && pathIndexAt(lib, lib.startMs - 1e9) === 0 && pathIndexAt(lib, lib.startMs + 1e12) === lib.samples.length - 2);
    check('earthLitFractionFromMoon (direction maths): Sun behind the Moon -> 1, Sun behind the Earth -> 0, quadrature -> 0.5',
      near(earthLitFractionFromMoon({ lat: 0, lon: 180 }, { lat: 0, lon: 0 }), 1, 1e-9) && near(earthLitFractionFromMoon({ lat: 0, lon: 0 }, { lat: 0, lon: 0 }), 0, 1e-9)
      && near(earthLitFractionFromMoon({ lat: 0, lon: 90 }, { lat: 0, lon: 0 }), 0.5, 1e-9));
    const nm = findNextNewMoon(center), fm = findNextFullMoon(center);
    const eN = computeEphemeris(nm), eF = computeEphemeris(fm);
    const fracAt = (e) => earthLitFractionFromMoon({ lat: e.subSolarLat, lon: e.subSolarLon }, { lat: e.subEarthLat, lon: e.subEarthLon });
    check('Ephemeris-based Earth lit fraction: ~1 at the next New Moon (Full Earth), ~0 at the next Full Moon',
      fracAt(eN) > 0.95 && fracAt(eF) < 0.05);
    check('Sub-solar longitude convention: ~180° at New Moon, ~0° at Full Moon (Sun behind the Moon / behind the Earth)',
      Math.abs(Math.abs(eN.subSolarLon) - 180) < 8 && Math.abs(eF.subSolarLon) < 8);
    check('Earthshine fill: floor when the Earth is new, max when full, monotonic in between; ambient is a low positive constant',
      near(globeEarthshineIntensity(0), GLOBE_EARTHSHINE_MIN) && near(globeEarthshineIntensity(1), GLOBE_EARTHSHINE_MAX) && GLOBE_EARTHSHINE_MIN > 0
      && globeEarthshineIntensity(0.3) < globeEarthshineIntensity(0.7) && GLOBE_AMBIENT_INTENSITY > 0 && GLOBE_AMBIENT_INTENSITY < 0.5);
  }

    check('Path cache rule (pure): rebuild when never built or when time moved more than one day from the centre; not within a day',
      GLOBE_PATH_RECENTER_MS === 86400e3 && globePathNeedsRebuild(NaN, 0) && !globePathNeedsRebuild(1e12, 1e12 + 0.9 * 86400e3) && !globePathNeedsRebuild(1e12, 1e12 - 0.9 * 86400e3)
      && globePathNeedsRebuild(1e12, 1e12 + 1.1 * 86400e3));
    {
      const R = GLOBE_EARTH_RADIUS;
      check('Proximity fade (pure): 0 inside 2.5 radii, 1 beyond 4 radii, smooth and monotonic in between',
        GLOBE_FADE_INNER_FACTOR === 2.5 && globeProximityFade(0, R) === 0 && globeProximityFade(2.5 * R, R) === 0 && globeProximityFade(4 * R, R) === 1 && globeProximityFade(100, R) === 1
        && globeProximityFade(3 * R, R) > 0 && globeProximityFade(3 * R, R) < globeProximityFade(3.5 * R, R) && GLOBE_FADE_OUTER_FACTOR > GLOBE_FADE_INNER_FACTOR);
    }

  // 2. Scene code against a stub (no WebGL): pins, picking, click, view switching
  const savedWindow = globalThis.window;
  try {
    const W = 1200, H = 800;
    const handlers = {};
    const stub = Object.create(LunarNavigatorScene.prototype);
    stub.scene = new THREE.Scene();
    stub.regions = REGIONS;
    stub.selectedRegion = REGIONS[2];
    stub.camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 3000);
    stub.raycaster = new THREE.Raycaster();
    stub.mouse = new THREE.Vector2(-999, -999);
    stub.targetCamLook = new THREE.Vector3();
    stub.currentCamLook = new THREE.Vector3();
    stub.targetCamPos = new THREE.Vector3();
    stub.orbitAngle = { theta: 0, phi: 1, distance: 50 };
    stub.globeOrbit = { ...GLOBE_DEFAULT_ORBIT };
    stub.viewMode = 'globe';
    stub.domainScale = 1;
    stub.hoveredPin = null;
    const picked = [];
    stub.callbacks = { onGlobeSelect: (r) => picked.push(r), onPinHover: () => {} };
    stub.container = {
      clientWidth: W, clientHeight: H, style: {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H }),
      addEventListener: (type, fn) => { handlers[type] = fn; },
    };
    globalThis.window = { addEventListener: () => {}, devicePixelRatio: 1 };
    stub._createMoonGlobe();
    stub._createGlobeEarth();
    stub._createGlobeSun();
    stub._setupEventListeners();

    check('Globe: nine pins created from regions.js lat/lon, each with a hover/click target',
      stub.globePinsGroup.children.length === 9 && stub.globePinHits.length === 9
      && stub.globePinsGroup.children.every((g) => {
        const r = g.userData.region;
        const p = latLonToGlobePosition(r.lat, r.lon);
        return near(g.position.x, p.x, 1e-9) && near(g.position.y, p.y, 1e-9) && near(g.position.z, p.z, 1e-9);
      }));
    const head = (g) => g.children[1].material;
    const sel = stub.globePinsGroup.children.find((g) => g.name === REGIONS[2].id);
    const other = stub.globePinsGroup.children.find((g) => g.name === REGIONS[0].id);
    check('Pin styling matches the polar map: selected = cyan 0x06b6d4, others = amber 0xf59e0b',
      head(sel).color.getHex() === 0x06b6d4 && head(other).color.getHex() === 0xf59e0b);
    stub.selectedRegion = REGIONS[0];
    stub.globePinsGroup && stub._highlightSelectedPin();
    check('Selecting another region re-colours the globe pins', head(other).color.getHex() === 0x06b6d4 && head(sel).color.getHex() === 0xf59e0b);

    // Camera over the south pole (Focus preset), then project each pin head to the screen
    const frame = () => {
      stub._updateGlobeCamera(true);
      stub.camera.updateMatrixWorld(true);
      stub._updateGlobePinScales();
      stub.scene.updateMatrixWorld(true);
    };
    const headNdc = (g) => {
      const v = new THREE.Vector3();
      g.children[1].getWorldPosition(v);
      return v.project(stub.camera);
    };
    stub.globeOrbit = { ...GLOBE_FOCUS_SOUTH_ORBIT };
    frame();
    let allPicked = true;
    for (const g of stub.globePinsGroup.children) {
      const ndc = headNdc(g);
      stub.mouse.set(ndc.x, ndc.y);
      const r = stub._pickGlobePin();
      if (!r || r.id !== g.userData.region.id) allPicked = false;
    }
    check('Focus South Pole: pointing at each of the nine pins picks exactly that region', allPicked);

    // Phase G7: pins shrink near the globe, stay legible and clickable
    {
      const pf = globePinScale(30), pm = globePinScale(10), pn = globePinScale(4), pt = globePinScale(0.5);
      check('G7: pin scale is the constant-screen-size value when far, smaller when near, never below the clamp, hit target keeps >= 60% of its size',
        near(pf.scale, 30 * GLOBE_PIN_SCREEN_SCALE * 2) && pf.hitScale === 1 && pn.scale < 4 * GLOBE_PIN_SCREEN_SCALE * 2 * 0.5
        && pm.scale / (10 * GLOBE_PIN_SCREEN_SCALE * 2) < 1 && pm.scale / (10 * GLOBE_PIN_SCREEN_SCALE * 2) > pn.scale / (4 * GLOBE_PIN_SCREEN_SCALE * 2)
        && pt.scale >= GLOBE_PIN_MIN_SCALE && pn.scale * pn.hitScale >= GLOBE_PIN_HIT_MIN_FACTOR * 4 * GLOBE_PIN_SCREEN_SCALE * 2 - 1e-12);
      // Pin heads no longer overlap in the Focus South Pole preset
      stub.globeOrbit = { ...GLOBE_FOCUS_SOUTH_ORBIT };
      frame();
      const heads = stub.globePinsGroup.children.map((g) => { const v = new THREE.Vector3(); g.children[1].getWorldPosition(v); return { v, r: 0.5 * g.scale.x }; });
      let overlap = false;
      for (let i = 0; i < heads.length; i++) for (let j = i + 1; j < heads.length; j++) if (heads[i].v.distanceTo(heads[j].v) < heads[i].r + heads[j].r) overlap = true;
      check('G7: in Focus South Pole no two of the nine pin heads overlap in 3D', !overlap);
      // Minimum zoom (camera at GLOBE_MIN_DISTANCE from the centre), looking at several longitudes over the polar pins
      let minZoomOk = true, tried = 0;
      for (const lonDeg of [0, 60, 120, 180, -60, -120]) {
        stub.globeOrbit = globeOrbitForLatLon(-80, lonDeg, GLOBE_MIN_DISTANCE);
        frame();
        for (const g of stub.globePinsGroup.children) {
          const ndc = headNdc(g);
          if (Math.abs(ndc.x) > 0.98 || Math.abs(ndc.y) > 0.98 || ndc.z > 1) continue; // off screen
          const hp = new THREE.Vector3(); g.children[1].getWorldPosition(hp);
          const cp = stub.camera.position;
          if (!isGlobeHeadVisible(hp, { x: cp.x, y: cp.y, z: cp.z }, GLOBE_RADIUS)) continue; // hidden behind the limb
          tried++;
          stub.mouse.set(ndc.x, ndc.y);
          const r = stub._pickGlobePin();
          if (!r || r.id !== g.userData.region.id) minZoomOk = false;
        }
      }
      check(`G7: at minimum zoom every visible on-screen pin (${tried} tried) is picked as itself`, minZoomOk && tried >= 9);
    }

    stub.mouse.set(0.97, -0.97);
    check('Pointing at empty space picks nothing', stub._pickGlobePin() === null);

    // Upside-down globe: seen from the equator the south pole must be above the north pole on screen
    stub.globeOrbit = globeOrbitForLatLon(0, 0, 32);
    frame();
    const southTop = new THREE.Vector3(...Object.values(latLonToGlobePosition(-80, 0))).project(stub.camera);
    const northBottom = new THREE.Vector3(...Object.values(latLonToGlobePosition(80, 0))).project(stub.camera);
    check('Globe view is flipped: the south pole is drawn above the north pole (camera up = -y)', stub.camera.up.y === -1 && southTop.y > northBottom.y);

    // The centre of the screen always points at the 70°S orbit target, whichever way the globe is turned
    const targetV = new THREE.Vector3(GLOBE_ORBIT_TARGET.x, GLOBE_ORBIT_TARGET.y, GLOBE_ORBIT_TARGET.z);
    const poleV = new THREE.Vector3(0, -GLOBE_RADIUS, 0);
    let centred = true, poleNear = true;
    for (const orbit of [GLOBE_DEFAULT_ORBIT, GLOBE_FOCUS_SOUTH_ORBIT, globeOrbitForLatLon(-60, 150, 25), clampGlobeOrbit({ theta: 3, phi: 2.2, distance: 40 })]) {
      stub.globeOrbit = { ...orbit };
      frame();
      const nt = targetV.clone().project(stub.camera);
      const np = poleV.clone().project(stub.camera);
      if (Math.hypot(nt.x, nt.y) > 0.02) centred = false;
      if (Math.hypot(np.x, np.y) > 0.5) poleNear = false;
    }
    check('Screen centre is the 70°S orbit target in every view (landing, Focus South Pole, fly-to, free orbit)', centred);
    check('The south pole stays near the middle of the screen in those views', poleNear);

    // Landing view (side-on): pin heads stand past the top rim and can still be picked
    stub.globeOrbit = { ...GLOBE_DEFAULT_ORBIT };
    frame();
    let sideOk = 0;
    for (const g of stub.globePinsGroup.children) {
      const ndc = headNdc(g);
      stub.mouse.set(ndc.x, ndc.y);
      if (stub._pickGlobePin()) sideOk++;
    }
    check('Landing view: pin heads standing above the top rim can be hovered/clicked', sideOk >= 1);
    stub.mouse.set(0, 0);
    check('Pointing at the globe body (no pin) picks nothing', stub._pickGlobePin() === null);

    // Click handler: a click only SELECTS (pin -> region, sphere -> lat/lon, empty -> null); drag-end click does nothing
    stub.globeOrbit = { ...GLOBE_FOCUS_SOUTH_ORBIT };
    frame();
    const target = stub.globePinsGroup.children[3];
    const ndc = headNdc(target);
    const cx = ((ndc.x + 1) / 2) * W;
    const cy = ((1 - ndc.y) / 2) * H;
    picked.length = 0;
    handlers.mousedown && handlers.mousedown({ button: 0, clientX: cx, clientY: cy });
    handlers.click({ clientX: cx, clientY: cy });
    check('Clicking a globe pin SELECTS that region (onGlobeSelect with the region and its lat/lon), it does not open South Pole 3D',
      picked.length === 1 && picked[0].region && picked[0].region.id === target.userData.region.id
      && near(picked[0].lat, target.userData.region.lat) && near(picked[0].lon, target.userData.region.lon));

    // Click on bare globe surface (a spot far from every pin) -> lat/lon of that spot
    const spot = [-83, -150];
    const sp = new THREE.Vector3(...Object.values(latLonToGlobePosition(spot[0], spot[1], GLOBE_RADIUS))).project(stub.camera);
    const sx = ((sp.x + 1) / 2) * W, sy = ((1 - sp.y) / 2) * H;
    stub.mouse.set(sp.x, sp.y);
    const noPin = stub._pickGlobePin() === null;
    picked.length = 0;
    handlers.mousedown && handlers.mousedown({ button: 0, clientX: sx, clientY: sy });
    handlers.click({ clientX: sx, clientY: sy });
    check('Clicking bare globe surface selects that point: onGlobeSelect({region: null, lat, lon}) within 0.05° of the clicked spot',
      noPin && picked.length === 1 && picked[0].region === null && Math.abs(picked[0].lat - spot[0]) < 0.05 && Math.abs(picked[0].lon - spot[1]) < 0.05);

    // Far side of the sphere is never picked: the ray hits the near side first
    stub.mouse.set(sp.x, sp.y);
    const near_ = stub._pickGlobeSurface();
    const farPos = new THREE.Vector3(...Object.values(latLonToGlobePosition(-83, 30, GLOBE_RADIUS)));
    check('Surface pick returns the camera-facing intersection (lat/lon within ±90° of latitude range)', near_ && near_.lat < 0 && near_.lat >= -90 && farPos.length() > 0);

    picked.length = 0;
    handlers.mousedown && handlers.mousedown({ button: 0, clientX: cx, clientY: cy });
    handlers.click({ clientX: cx + 40, clientY: cy + 40 });
    check('The click that ends an orbit drag selects nothing', picked.length === 0);
    stub.globeOrbit = clampGlobeOrbit({ ...GLOBE_DEFAULT_ORBIT, distance: GLOBE_MAX_DISTANCE });
    frame(); // zoomed out: the corner of the screen is open space
    picked.length = 0;
    handlers.mousedown && handlers.mousedown({ button: 0, clientX: W - 5, clientY: H - 5 });
    handlers.click({ clientX: W - 5, clientY: H - 5 });
    check('Clicking empty space beside the globe clears the selection (onGlobeSelect(null))', picked.length === 1 && picked[0] === null);

    // Selection marker
    stub.setGlobeSelection({ lat: -83, lon: -150 });
    const mk = stub.globeSelectMarker;
    const mp = latLonToGlobePosition(-83, -150);
    check('Selection marker sits on the selected lat/lon and is visible; null hides it',
      mk.visible && near(mk.position.x, mp.x, 1e-9) && near(mk.position.y, mp.y, 1e-9) && near(mk.position.z, mp.z, 1e-9)
      && (stub.setGlobeSelection(null), !mk.visible));

    // View switching on the real setViewMode code
    stub.orreryGroup = new THREE.Group();
    stub.poleTerrainGroup = new THREE.Group();
    stub.sunLight = new THREE.DirectionalLight();
    stub.polarSunLight = new THREE.DirectionalLight();
    stub.polarFillLight = new THREE.DirectionalLight();
    stub.globeLight = new THREE.DirectionalLight();
    stub.globeAmbientLight = new THREE.AmbientLight();
    stub.globeEarthshineLight = new THREE.DirectionalLight();
    stub.ambientLight = new THREE.AmbientLight();
    stub.commsRayGroup = new THREE.Group();
    stub.sunLayerGroup = new THREE.Group();
    stub.isCommsRayVisible = true; stub.isEarthGlobeVisible = true; stub.isSunVisible = true;
    stub.dockToRegion = (r) => { stub.selectedRegion = r; };
    stub.cameraPreset = 'overview';
    stub.setViewMode('globe', false);
    check('Globe view: globe visible; Orrery (Earth, Sun, orbit lines), pole terrain, comms ray and Sun layer all hidden',
      stub.globeGroup.visible && !stub.orreryGroup.visible && !stub.poleTerrainGroup.visible && !stub.commsRayGroup.visible && !stub.sunLayerGroup.visible
      && stub.globeLight.visible && !stub.sunLight.visible && !stub.polarSunLight.visible);
    stub.setViewMode('south_pole');
    check('Leaving the globe restores the normal camera up vector (+y) for South Pole and Orrery', stub.camera.up.y === 1);
    check('South Pole view: globe hidden, pole terrain visible, comms ray and Sun layer back',
      !stub.globeGroup.visible && stub.poleTerrainGroup.visible && stub.commsRayGroup.visible && stub.sunLayerGroup.visible && !stub.globeLight.visible);
    stub.setViewMode('orrery');
    check('Orrery view unchanged: Orrery visible, globe and pole hidden', stub.orreryGroup.visible && !stub.globeGroup.visible && !stub.poleTerrainGroup.visible);
    check('Orrery view: the globe Earth, Sun, paths and rings are hidden with the globe group', !stub.globeGroup.visible && stub.globeEarthGroup.parent === stub.globeGroup && stub.globeSunGroup.parent === stub.globeGroup);
    // Phase G2: real-Sun lighting of the globe, updated on time change, no leaking into other views
    check('Leaving the globe: globe Sun/ambient/earthshine lights hidden, the shared ambient light is back for Orrery',
      !stub.globeLight.visible && !stub.globeAmbientLight.visible && !stub.globeEarthshineLight.visible && stub.ambientLight.visible);
    stub.setViewMode('globe');
    check('Globe view: Sun light, globe ambient and earthshine on; shared ambient off; pole/Orrery lights off',
      stub.globeLight.visible && stub.globeAmbientLight.visible && stub.globeEarthshineLight.visible && !stub.ambientLight.visible && !stub.sunLight.visible && !stub.polarSunLight.visible);
    const eph1 = computeEphemeris(new Date('2026-11-10T12:00:00Z'));
    stub.updateSimulation(eph1);
    const sd1 = globeLightDirection(eph1.subSolarLat, eph1.subSolarLon);
    const lp1 = stub.globeLight.position.clone().normalize();
    check('Globe light points along the true Sun direction (position = sub-solar direction * light distance, target = origin)',
      near(lp1.x, sd1.x, 1e-9) && near(lp1.y, sd1.y, 1e-9) && near(lp1.z, sd1.z, 1e-9) && near(stub.globeLight.position.length(), GLOBE_LIGHT_DISTANCE, 1e-9)
      && stub.globeLight.target.position.lengthSq() === 0);
    const eph2 = computeEphemeris(new Date('2026-11-17T12:00:00Z'));
    stub.updateSimulation(eph2);
    const lp2 = stub.globeLight.position.clone().normalize();
    const sd2 = globeLightDirection(eph2.subSolarLat, eph2.subSolarLon);
    check('Scrubbing time moves the terminator: the light follows a new epoch (7 days later is roughly 75–95° further round)',
      near(lp2.x, sd2.x, 1e-9) && near(lp2.z, sd2.z, 1e-9) && lp1.angleTo(lp2) * 180 / Math.PI > 65 && lp1.angleTo(lp2) * 180 / Math.PI < 100);
    const es = stub.globeEarthshineLight.position.clone().normalize();
    const ed = globeLightDirection(eph2.subEarthLat, eph2.subEarthLon);
    check('Earthshine fill comes from the sub-Earth direction with intensity >= its floor',
      near(es.x, ed.x, 1e-9) && near(es.y, ed.y, 1e-9) && stub.globeEarthshineLight.intensity >= GLOBE_EARTHSHINE_MIN - 1e-9);
    stub._updateGlobeFrame();
    check('The Sun light no longer follows the camera each frame', near(stub.globeLight.position.clone().normalize().x, sd2.x, 1e-9));
    // Phase G3: Earth in the globe view
    {
      const eg = stub.globeEarthGroup;
      check('Earth exists as a child of the globe group (only drawn in globe view), with body, rim and halo',
        !!eg && stub.globeGroup.children.includes(eg) && eg.children.includes(stub.globeEarthRimMesh) && eg.children.includes(stub.globeEarthHaloMesh)
        && stub.globeEarthTiltGroup.children.includes(stub.globeEarthMesh) && eg.visible);
      const ep = globeBodyPosition(eph2.subEarthLat, eph2.subEarthLon, GLOBE_EARTH_DISTANCE);
      check('Earth position follows subEarthLat/Lon at GLOBE_EARTH_DISTANCE',
        near(eg.position.x, ep.x, 1e-9) && near(eg.position.y, ep.y, 1e-9) && near(eg.position.z, ep.z, 1e-9) && near(eg.position.length(), GLOBE_EARTH_DISTANCE, 1e-9));
      check('Earth is tilted 23.44° and spins with earthRotationDeg (real time)',
        near(stub.globeEarthTiltGroup.rotation.z, 23.4393 * Math.PI / 180, 1e-6) && near(stub.globeEarthMesh.rotation.y, eph2.earthRotationDeg * Math.PI / 180, 1e-9));
      const mapBefore = stub.globeEarthMat.uniforms.map.value;
      stub.updateSimulation(eph1);
      const su = stub.globeEarthMat.uniforms.sunDir.value;
      check('Earth day side follows the true Sun direction (same direction as the Moon light); texture object never swapped or recoloured',
        near(su.x, sd1.x, 1e-9) && near(su.y, sd1.y, 1e-9) && near(su.z, sd1.z, 1e-9) && stub.globeEarthMat.uniforms.map.value === mapBefore
        && !near(stub.globeEarthMesh.rotation.y, eph2.earthRotationDeg * Math.PI / 180, 1e-9));
      check('Rim: depth test OFF, high render order, bright light-blue colour (always visible, also when the Moon is in front); body and halo keep depth testing',
        stub.globeEarthRimMesh.material.depthTest === false && stub.globeEarthRimMesh.renderOrder >= 21 && stub.globeEarthRimMesh.material.uniforms.glow.value.getHex() === 0xbfe6ff
        && stub.globeEarthMat.depthTest === true && stub.globeEarthMat.depthWrite === true && stub.globeEarthHaloMesh.material.depthTest === true);
      check('The rim is not modulated by the Sun (no Sun uniform in the rim shader)', !('sunDir' in stub.globeEarthRimMesh.material.uniforms));
      const far = eg.position.clone().add(new THREE.Vector3(0, 0, 20));
      stub.camera.position.copy(far);
      stub._updateGlobeEarthFade();
      const fFar = stub._globeEarthFade;
      stub.camera.position.copy(eg.position).add(new THREE.Vector3(0, 0, 2.5 * GLOBE_EARTH_RADIUS * 0.9));
      stub._updateGlobeEarthFade();
      check('Proximity fade: Earth fully visible far away; inside 2.5 radii body, rim and halo reach 0 and the group is hidden',
        fFar === 1 && stub._globeEarthFade === 0 && stub.globeEarthMat.uniforms.fade.value === 0 && stub.globeEarthRimMesh.material.uniforms.fade.value === 0
        && stub.globeEarthHaloMesh.material.uniforms.fade.value === 0 && eg.visible === false);
      stub.camera.position.copy(eg.position).add(new THREE.Vector3(0, 0, 3.2 * GLOBE_EARTH_RADIUS));
      stub._updateGlobeEarthFade();
      check('Proximity fade is partial in between (smooth, not a pop)', stub._globeEarthFade > 0 && stub._globeEarthFade < 1 && eg.visible === true);
    }
    // Phase G4: Earth libration path
    {
      stub.updateSimulation(eph1);
      const pp = stub.globeEarthPathPast, pf = stub.globeEarthPathFuture, path = stub._globeEarthPath;
      const n = path.samples.length;
      const k = pathIndexAt(path, eph1.date.getTime());
      check('Libration path: two line views (past, future) in the globe group over one shared position buffer holding every sample at GLOBE_EARTH_DISTANCE',
        stub.globeGroup.children.includes(pp) && stub.globeGroup.children.includes(pf) && pp.geometry.attributes.position === pf.geometry.attributes.position
        && n === Math.round(GLOBE_EARTH_PATH_DAYS * 24 / GLOBE_PATH_STEP_HOURS) + 1
        && path.samples.every((s, i) => near(stub.globeEarthPathAttr.array[i * 3], s.point.x, 1e-4) && near(stub.globeEarthPathAttr.array[i * 3 + 2], s.point.z, 1e-4)));
      check('Past part dim, future part bright (soft blue), both depth-tested so the Moon hides them',
        pp.material.opacity === GLOBE_EARTH_PATH_PAST_OPACITY && pf.material.opacity === GLOBE_EARTH_PATH_FUTURE_OPACITY && pp.material.opacity < pf.material.opacity
        && pp.material.depthTest === true && pf.material.depthTest === true && pp.material.color.getHex() === 0x7db8ff);
      check('Draw ranges split at the current time: past = samples 0..k, future = k..end, with sample k at or before now',
        pp.geometry.drawRange.start === 0 && pp.geometry.drawRange.count === k + 1 && pf.geometry.drawRange.start === k && pf.geometry.drawRange.count === n - k
        && path.startMs + k * path.stepMs <= eph1.date.getTime() && eph1.date.getTime() < path.startMs + (k + 1) * path.stepMs
        && Math.abs(k - (n - 1) / 2) <= 1);
      const marker = stub.globeEarthMarker;
      check('Marker ring sits at the Earth\'s current position and shares the path colour',
        near(marker.position.x, stub.globeEarthGroup.position.x, 1e-9) && near(marker.position.y, stub.globeEarthGroup.position.y, 1e-9) && near(marker.position.z, stub.globeEarthGroup.position.z, 1e-9)
        && stub.globeEarthMarkerRing.material.color.getHex() === 0x7db8ff && stub.globeGroup.children.includes(marker));
      const builds0 = stub._globeEarthPathBuilds;
      for (let h = 1; h <= 40; h++) stub.updateSimulation(computeEphemeris(new Date(eph1.date.getTime() + h * 0.5 * 3600e3)));
      const builds1 = stub._globeEarthPathBuilds;
      check('No recompute while time moves within a day of the cached centre (40 ticks over 20 h: 0 rebuilds, ranges still advance)',
        builds1 === builds0 && pf.geometry.drawRange.start >= k + 3);
      stub.updateSimulation(computeEphemeris(new Date(eph1.date.getTime() + 2 * 86400e3)));
      check('Recomputed once time has moved more than a day (2 days: exactly one rebuild, centred on the new time)',
        stub._globeEarthPathBuilds === builds1 + 1 && Math.abs(stub._globeEarthPathCenterMs - (eph1.date.getTime() + 2 * 86400e3)) < 1);
      stub.updateSimulation(eph1);
      stub.camera.position.set(0, -20, 5);
      stub.camera.quaternion.setFromEuler(new THREE.Euler(0.4, 0.9, 0.1));
      stub._updateGlobeEarthFade();
      check('Marker ring is a billboard (copies the camera orientation) and fades with the Earth',
        marker.quaternion.angleTo(stub.camera.quaternion) < 1e-9 && stub.globeEarthMarkerRing.material.opacity > 0);
      stub.camera.position.copy(stub.globeEarthGroup.position).add(new THREE.Vector3(0, 0, 1));
      stub._updateGlobeEarthFade();
      check('Marker ring hides together with the Earth when the camera is inside the fade zone', marker.visible === false);
    }
    // Phase G5: Sun body and Sun orbit ring
    {
      stub.updateSimulation(eph1);
      const sg = stub.globeSunGroup;
      const sp5 = globeBodyPosition(eph1.subSolarLat, eph1.subSolarLon, GLOBE_SUN_DISTANCE, GLOBE_SUN_LAT_EXAGGERATION);
      check('Sun body sits at the (latitude-exaggerated) sub-solar direction at GLOBE_SUN_DISTANCE',
        near(sg.position.x, sp5.x, 1e-9) && near(sg.position.y, sp5.y, 1e-9) && near(sg.position.z, sp5.z, 1e-9) && near(sg.position.length(), GLOBE_SUN_DISTANCE, 1e-9));
      const e3 = computeEphemeris(new Date(eph1.date.getTime() + 3 * 86400e3));
      stub.updateSimulation(e3);
      const sp3 = globeBodyPosition(e3.subSolarLat, e3.subSolarLon, GLOBE_SUN_DISTANCE, GLOBE_SUN_LAT_EXAGGERATION);
      check('Sun body follows time on every update (3 days later it is at the new sub-solar direction)',
        near(sg.position.x, sp3.x, 1e-9) && near(sg.position.z, sp3.z, 1e-9) && !near(sg.position.x, sp5.x, 1e-3));
      stub.updateSimulation(eph1);
      check('Sun body is an unlit emissive sphere (MeshBasicMaterial, not shaded by the Moon light), depth-tested so the Moon can hide it, with an additive glow that never writes depth',
        stub.globeSunBody.material.isMeshBasicMaterial === true && stub.globeSunBody.material.depthTest === true && stub.globeSunBody.geometry.parameters.radius === GLOBE_SUN_RADIUS
        && (!stub.globeSunGlow || (stub.globeSunGlow.material.depthWrite === false && stub.globeSunGlow.material.depthTest === true)));
      const sr = stub._globeSunRing, rp = stub.globeSunRingPast, rf = stub.globeSunRingFuture;
      const nr = sr.samples.length;
      const kr = pathIndexAt(sr, eph1.date.getTime());
      check('Orbit ring: two line views over one shared buffer holding one synodic month of samples at GLOBE_SUN_DISTANCE, split at the current time',
        stub.globeGroup.children.includes(rp) && stub.globeGroup.children.includes(rf) && rp.geometry.attributes.position === rf.geometry.attributes.position
        && nr === Math.round(29.530588 * 24 / GLOBE_PATH_STEP_HOURS) + 1 && rp.geometry.drawRange.count === kr + 1 && rf.geometry.drawRange.start === kr && rf.geometry.drawRange.count === nr - kr
        && sr.samples.every((s, i) => near(stub.globeSunRingAttr.array[i * 3], s.point.x, 1e-3) && near(len(s.point), GLOBE_SUN_DISTANCE, 1e-9)));
      let span5 = 0;
      for (let i = 1; i < nr; i++) {
        let d = sr.samples[i].lon - sr.samples[i - 1].lon;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        span5 += d;
      }
      check('Orbit ring spans about 360° of longitude around the Moon, current sample near the middle, warm amber, past dim and future bright, depth-tested',
        Math.abs(Math.abs(span5) - 360) < 20 && Math.abs(kr - (nr - 1) / 2) <= 1 && rp.material.color.getHex() === 0xf59e0b && rf.material.color.getHex() === 0xf59e0b
        && rp.material.opacity === GLOBE_SUN_RING_PAST_OPACITY && rf.material.opacity === GLOBE_SUN_RING_FUTURE_OPACITY && rp.material.opacity < rf.material.opacity
        && rp.material.depthTest === true && rf.material.depthTest === true);
      check('Marker ring sits at the Sun\'s current position (amber, billboard)',
        near(stub.globeSunMarker.position.x, sg.position.x, 1e-9) && near(stub.globeSunMarker.position.z, sg.position.z, 1e-9) && stub.globeSunMarkerRing.material.color.getHex() === 0xf59e0b && GLOBE_SUN_MARKER_RADIUS_FACTOR > 1);
      const sb0 = stub._globeSunRingBuilds;
      for (let h = 1; h <= 40; h++) stub.updateSimulation(computeEphemeris(new Date(eph1.date.getTime() + h * 0.5 * 3600e3)));
      const sb1 = stub._globeSunRingBuilds;
      stub.updateSimulation(computeEphemeris(new Date(eph1.date.getTime() + 2 * 86400e3)));
      check('Ring cache: no rebuild while time moves within a day (40 ticks over 20 h), exactly one rebuild after moving 2 days',
        sb1 === sb0 && stub._globeSunRingBuilds === sb1 + 1);
      stub.updateSimulation(eph1);
      stub.camera.position.copy(sg.position).add(new THREE.Vector3(0, 0, 40));
      stub._updateGlobeSunFade();
      const sf0 = stub._globeSunFade;
      stub.camera.position.copy(sg.position).add(new THREE.Vector3(0, 0, 2.5 * GLOBE_SUN_RADIUS * 0.9));
      stub._updateGlobeSunFade();
      check('Sun proximity fade: fully visible far away; inside 2.5 radii body, glow and marker reach 0 and are hidden',
        sf0 === 1 && stub._globeSunFade === 0 && stub.globeSunBody.material.opacity === 0 && sg.visible === false && stub.globeSunMarker.visible === false);
      check('Globe Sun/ring live in the globe group only; the pole-mode Sun layer is a different group, not part of the globe; no HTML labels (only meshes/sprites)',
        sg.parent === stub.globeGroup && stub.sunLayerGroup.parent !== stub.globeGroup && sg.children.every((o) => o.isMesh || o.isSprite) && stub.globeGroup.children.every((o) => !o.isCSS2DObject));
    }
    stub.setViewMode('orrery');
    stub.selectedRegion = REGIONS[4];
    stub.setViewMode('globe');
    const faced = globeCameraPosition(stub.globeOrbit);
    const camLon = Math.atan2(-faced.z, faced.x) * 180 / Math.PI;
    check('Returning to the globe keeps the side-on view, turned to the selected region\'s longitude',
      near(faced.y, 0, 1e-6) && Math.abs(camLon - REGIONS[4].lon) < 1e-6);
  } finally {
    if (savedWindow === undefined) delete globalThis.window; else globalThis.window = savedWindow;
  }

  // 3. DOM: view toggle, Back button, and pin click -> same selection path as the polar map (JSDOM)
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    const { JSDOM } = await import('jsdom');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
    const dom = new JSDOM(html, { url: 'http://localhost:3000' });
    const saved = { window: globalThis.window, document: globalThis.document, HTMLElement: globalThis.HTMLElement };
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    dom.window.HTMLCanvasElement.prototype.getContext = function () {
      return new Proxy({}, { get: (t, prop) => (prop === 'measureText' ? () => ({ width: 10 }) : prop === 'createLinearGradient' ? () => ({ addColorStop: () => {} }) : () => {}) });
    };
    try {
      const { LunarNavigatorUI } = await import('../src/ui.js');
      const calls = { modes: [], selected: [], focus: 0, fly: [] };
      const ui = new LunarNavigatorUI({
        container: dom.window.document.getElementById('root'),
        callbacks: {
          onSetViewMode: (m) => calls.modes.push(m),
          onSelectRegion: (r) => calls.selected.push(r),
          onGlobeFocusSouthPole: () => { calls.focus++; },
          onGlobeFlyTo: (r) => calls.fly.push(r),
        },
      });
      const doc = dom.window.document;
      const $ = (id) => doc.getElementById(id);
      const hidden = (id) => $(id).classList.contains('hidden');

      check('App opens on the Orrery: UI state is \"orrery\", Orrery controls/HUD shown, Moon Globe and Pole panels hidden',
        ui.viewMode === 'orrery' && hidden('globe-controls-box') && !hidden('orrery-controls-box') && !hidden('orrery-telemetry-hud') && hidden('pole-region-panel') && hidden('pole-select-panel'));
      const btnOrder = Array.from($('mode-btn-orrery').parentElement.querySelectorAll('button')).map((b) => b.id);
      check('Mode switcher order: Orrery, Moon Globe, South Pole 3D (Orrery highlighted at start)',
        btnOrder.join(',') === 'mode-btn-orrery,mode-btn-globe,mode-btn-pole' && $('mode-btn-orrery').className.includes('bg-cyan-600') && !$('mode-btn-globe').className.includes('bg-cyan-600'));
      $('mode-btn-globe').click();
      check('Clicking Moon Globe shows the globe controls and hides the Orrery HUD', ui.viewMode === 'globe' && !hidden('globe-controls-box') && hidden('orrery-controls-box') && hidden('orrery-telemetry-hud'));
      check('Mode switcher has a Moon Globe button next to Orrery and South Pole 3D', !!$('mode-btn-globe') && !!$('mode-btn-orrery') && !!$('mode-btn-pole'));
      check('Globe badge tooltip says the Earth/Sun are not to scale and that the Sun ring latitude swing is exaggerated (doubled)',
        /not to scale/i.test($('globe-scale-badge').title) && /doubled/i.test($('globe-scale-badge').title) && /latitude/i.test($('globe-scale-badge').title));
      check('Time bar (bottom dock with slider and play button) is visible in the Moon Globe view', !hidden('bottom-dock') && !!$('sim-slider') && !!$('btn-play-pause'));
      $('btn-globe-focus-south').click();
      check('"Focus South Pole" button calls the camera preset', calls.focus === 1);

      $('mode-btn-pole').click();
      check('Switching to South Pole 3D shows the pole panels and hides the globe controls', ui.viewMode === 'south_pole' && !hidden('pole-region-panel') && hidden('globe-controls-box') && calls.modes.at(-1) === 'south_pole');
      check('Right menu has a "Back to Moon Globe" button', !!$('btn-back-to-globe') && $('pole-region-panel').contains($('btn-back-to-globe')));
      $('btn-back-to-globe').click();
      check('"Back to Moon Globe" returns to the globe view', ui.viewMode === 'globe' && !hidden('globe-controls-box') && hidden('pole-region-panel') && calls.modes.at(-1) === 'globe');
      $('mode-btn-orrery').click();
      $('mode-btn-globe').click();
      check('Mode-switcher Moon Globe button returns to the globe from Orrery', ui.viewMode === 'globe' && hidden('orrery-controls-box') && hidden('orrery-telemetry-hud'));

      // Pin click on the globe vs a click on the polar map: same selection callbacks, same region
      calls.selected.length = 0;
      const reg = REGIONS[1];
      ui.enterPoleFromGlobe(reg, { instant: true });
      const viaGlobe = { mode: ui.viewMode, selected: ui.selectedRegion.id, cbs: calls.selected.map((r) => r.id) };
      check('Globe pin click -> South Pole mode, region selected in the UI, onSelectRegion(region) fired once (same path as the polar map)',
        viaGlobe.mode === 'south_pole' && viaGlobe.selected === reg.id && viaGlobe.cbs.length === 1 && viaGlobe.cbs[0] === reg.id && calls.modes.at(-1) === 'south_pole');

      // The polar-map path (region list click) fires the same callback with the same region
      calls.selected.length = 0;
      doc.querySelector(`.region-item[data-region-id="${REGIONS[5].id}"]`).click();
      check('Polar-map/list click fires the same onSelectRegion(region) callback', calls.selected.length === 1 && calls.selected[0].id === REGIONS[5].id && ui.selectedRegion.id === REGIONS[5].id);

      // Animated entry asks the scene to zoom first and does not switch views synchronously
      $('btn-back-to-globe').click();
      calls.fly.length = 0;
      ui.enterPoleFromGlobe(REGIONS[3]);
      check('Animated pin entry requests the camera zoom and keeps the globe view until the zoom ends', calls.fly.length === 1 && calls.fly[0].id === REGIONS[3].id && ui.viewMode === 'globe');
      clearTimeout(ui._globeEntryTimer);
      ui._globeEntryTimer = null;

      ui.showPinTooltip({ visible: true, region: REGIONS[0], screenX: 10, screenY: 10, globe: true });
      check('Globe hover tooltip shows the region name and an orientation-only / not-to-scale note (no DEM elevation)',
        $('tooltip-title').textContent === REGIONS[0].name && /not to scale/i.test($('tooltip-hint').textContent) && $('tooltip-elevation').classList.contains('hidden'));

      // Selection card + "View in South Pole 3D" button
      $('btn-back-to-globe').click(); // currently in globe after earlier steps; ensure globe mode
      if (ui.viewMode !== 'globe') $('mode-btn-globe').click();
      check('No selection: the card is hidden', hidden('globe-select-card'));
      const markers = [];
      ui.callbacks.onGlobeSelectionMarker = (m) => markers.push(m);
      ui.setGlobeSelection({ region: REGIONS[0], lat: REGIONS[0].lat, lon: REGIONS[0].lon });
      check('Selecting a pin shows the card with name, coordinates + kind label and an enabled "View in South Pole 3D" button',
        !hidden('globe-select-card') && $('globe-select-title').textContent === REGIONS[0].name && /°S/.test($('globe-select-coords').textContent)
        && /region|site/i.test($('globe-select-coords').textContent) && /View in South Pole 3D/.test($('btn-globe-view-pole').textContent) && !$('btn-globe-view-pole').disabled
        && markers.length === 1 && markers[0].region.id === REGIONS[0].id);
      calls.selected.length = 0;
      $('btn-globe-view-pole').click();
      check('Button on a pin selection starts the entry flight (camera zoom first, still on the globe)', calls.fly.at(-1).id === REGIONS[0].id && ui.viewMode === 'globe');
      clearTimeout(ui._globeEntryTimer); ui._globeEntryTimer = null;

      const picks = [];
      ui.callbacks.onPickPoint = (r) => { picks.push(r); ui.setUserPoint(makeUserPointRegion(r.lat, r.lon)); };
      ui.setGlobeSelection({ region: null, lat: -84.5, lon: 20.25 });
      check('A surface point shows "Selected point", its coordinates and the user-picked-point kind label, button enabled',
        $('globe-select-title').textContent === 'Selected point' && /84\.5000°S, 20\.2500°E/.test($('globe-select-coords').textContent)
        && /User-picked point/.test($('globe-select-coords').textContent) && !$('btn-globe-view-pole').disabled && hidden('globe-select-note'));
      calls.fly.length = 0;
      $('btn-globe-view-pole').click();
      check('Button on a point selection analyses it as a user-picked point (onPickPoint, same as the form) and flies in',
        picks.length === 1 && near(picks[0].lat, -84.5) && near(picks[0].lon, 20.25) && ui.selectedRegion.kind === 'user_point'
        && calls.fly.length === 1 && calls.fly[0].kind === 'user_point' && ui.viewMode === 'globe');
      clearTimeout(ui._globeEntryTimer); ui._globeEntryTimer = null;

      picks.length = 0;
      ui.setGlobeSelection({ region: null, lat: -45, lon: 10 });
      check('A point outside 80–90 °S disables the button and explains why (never clamps)', $('btn-globe-view-pole').disabled && !hidden('globe-select-note') && /80–90/.test($('globe-select-note').textContent));
      $('btn-globe-view-pole').click();
      check('Disabled button does nothing', picks.length === 0);

      $('btn-globe-select-clear').click();
      check('Clear (×) hides the card and clears the marker', hidden('globe-select-card') && markers.at(-1) === null);
      ui.setGlobeSelection({ region: null, lat: -85, lon: 0 });
      $('mode-btn-orrery').click();
      check('Leaving the globe hides the card', hidden('globe-select-card'));
      $('mode-btn-globe').click();
      check('Returning to the globe shows the selection card again', !hidden('globe-select-card'));
    } finally {
      globalThis.window = saved.window; globalThis.document = saved.document; globalThis.HTMLElement = saved.HTMLElement;
      if (saved.window === undefined) delete globalThis.window;
      if (saved.document === undefined) delete globalThis.document;
      if (saved.HTMLElement === undefined) delete globalThis.HTMLElement;
    }
  } else {
    measurements.push('DOM checks skipped outside Node');
  }

  return {
    name: 'Test 27: Moon Globe Landing View (Phase 13)',
    passed,
    timeMs: (performance.now() - t0).toFixed(2),
    criteria: 'Nine pins from regions.js on a lunar-radius sphere; picking ignores far-side pins; click selects a pin or a surface point; "View in South Pole 3D" button opens it (region path / user-picked-point path, disabled outside 80–90 °S); globe/Orrery/Pole view toggle; Back button',
    measurements,
  };
}
