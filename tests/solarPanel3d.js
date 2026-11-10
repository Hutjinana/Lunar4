/** Phase 8: 3D solar panel on a mast (pure helpers + real scene code against a WebGL-free stub). */
import * as THREE from 'three';
import { REGIONS } from '../regions.js';
import { latLonToPolarStereo, getElevationAt } from '../src/terrain.js';
import { LunarNavigatorScene, DOCK_DISTANCE, DOCK_THETA, DOCK_PHI, DOCK_LOOK_FORWARD } from '../src/scene.js';
import { azimuthToMapDirection } from '../src/mapGeometry.js';
import { mastDisplayHeight, panelNormalScene, panelShading, MAST_DISPLAY_UNITS_PER_M } from '../src/solarPanel3d.js';
import { cosIncidence } from '../src/missionMetrics.js';

export async function runSolarPanel3dTest() {
  const t0 = performance.now();
  const measurements = [];
  let passed = true;
  const check = (label, ok) => { if (!ok) passed = false; measurements.push(`${label} [${ok ? 'PASS' : 'FAIL'}]`); };
  const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

  // Pure helpers
  const flat = panelNormalScene(0, 123, 40);
  check('Tilt 0: normal = straight up', near(flat.x, 0) && near(flat.y, 1) && near(flat.z, 0));
  const lon = 31.85;
  const n = panelNormalScene(60, 200, lon);
  const dir = azimuthToMapDirection(200, lon);
  check('Tilt 60°, az 200°: normal = (dir*sin60, cos60) with the same azimuth→scene mapping as the comms ray',
    near(n.x, dir.x * Math.sin(Math.PI / 3)) && near(n.z, dir.z * Math.sin(Math.PI / 3)) && near(n.y, 0.5) && near(Math.hypot(n.x, n.y, n.z), 1));
  check('Mast display height = 0.3 units/m (10 m → 3.0); 0 m → 0', near(mastDisplayHeight(10), 3) && mastDisplayHeight(0) === 0 && MAST_DISPLAY_UNITS_PER_M === 0.3);
  check('Mast display at the 30 m limit = 9.0 scene units', near(mastDisplayHeight(30), 9));
  {
    // Docked camera (scene.js dockToRegion/_updateCameraFromOrbit) vs the top of a 30 m display mast at the site.
    const look = new THREE.Vector3(0, 0, DOCK_LOOK_FORWARD); // site at origin, flat
    const cam = new THREE.Vector3(
      look.x + DOCK_DISTANCE * Math.sin(DOCK_PHI) * Math.sin(DOCK_THETA),
      look.y + DOCK_DISTANCE * Math.cos(DOCK_PHI),
      look.z + DOCK_DISTANCE * Math.sin(DOCK_PHI) * Math.cos(DOCK_THETA));
    const top = new THREE.Vector3(0, mastDisplayHeight(30) + 1.7, 0); // mast top + panel height
    const dist = cam.distanceTo(top);
    const off = Math.acos(top.clone().sub(cam).normalize().dot(look.clone().sub(cam).normalize())) * 180 / Math.PI;
    check(`30 m mast vs docked camera: camera ${cam.y.toFixed(1)} units up, ${dist.toFixed(1)} units from the panel top (near plane 0.1, no clipping), ${off.toFixed(1)}° off the view axis (vertical half-FOV 22.5°)`,
      cam.y > top.y && dist > 5 && off < 22.5);
  }
  const lit = panelShading(1, 0.6), shadow = panelShading(0, 0.9), away = panelShading(1, -0.2);
  check('Shading: lit ∝ cosθ (0.6); shadowed or facing away → dim', lit.lit && near(lit.intensity, 0.6) && !shadow.lit && shadow.intensity === 0 && !away.lit);

  // Scene code against a stub (no WebGL, no DOM)
  const reg = REGIONS[2];
  const stub = Object.create(LunarNavigatorScene.prototype);
  stub.poleTerrainGroup = new THREE.Group();
  stub.spatialScale = 0.35; stub.verticalScale = 0.40; stub.viewMode = 'south_pole';
  stub._createSolarPanel();
  check('Hidden until first update, and in Orrery mode', stub.solarPanelGroup.visible === false);
  const panel = { tiltDeg: 85, azimuthDeg: 320 };
  const sunEl = 1.2, sunAz = 250;
  const cos = cosIncidence(sunEl, panel.tiltDeg, sunAz, panel.azimuthDeg);
  const shade = stub.updateSolarPanel(reg, panel, 1, cos, 10);
  const { x, y } = latLonToPolarStereo(reg.lat, reg.lon);
  const base = new THREE.Vector3(x * 0.35, getElevationAt(reg.lat, reg.lon) * 0.40, -y * 0.35);
  check(`Mast stands at the region and is ${stub.solarMastMesh.scale.y.toFixed(1)} units tall (10 m, exaggerated)`,
    near(stub.solarMastMesh.position.x, base.x, 1e-6) && near(stub.solarMastMesh.position.z, base.z, 1e-6) && near(stub.solarMastMesh.scale.y, 3, 1e-9));
  const worldNormal = new THREE.Vector3(0, 1, 0).applyQuaternion(stub.solarPanelMesh.quaternion);
  const expect = panelNormalScene(85, 320, reg.lon);
  check('Panel mesh normal follows the best-fixed tilt/azimuth', worldNormal.distanceTo(new THREE.Vector3(expect.x, expect.y, expect.z)) < 1e-6);
  const litIntensity = stub.solarPanelMaterial.emissiveIntensity;
  check(`Lit (I=1, cosθ=${cos.toFixed(2)}): bright emissive ∝ cosθ (${stub.solarPanelMaterial.emissiveIntensity.toFixed(2)})`,
    shade.lit && cos > 0 && stub.solarPanelMaterial.emissiveIntensity > 0.85);
  check('Visible in South Pole mode after an update; toggle hides/shows it', stub.solarPanelGroup.visible === true &&
    (stub.setSolarPanelVisible(false), !stub.solarPanelGroup.visible) && (stub.setSolarPanelVisible(true), stub.solarPanelGroup.visible));
  stub.updateSolarPanel(reg, panel, 0, cos, 10);
    check('Shadowed (I=0): dimmer than lit but still visible (self-lit, never dark)', stub.solarPanelMaterial.emissiveIntensity > 0.5 && stub.solarPanelMaterial.emissiveIntensity < litIntensity);
  stub.updateSolarPanel(reg, { tiltDeg: 85, azimuthDeg: 140 }, 1, cosIncidence(sunEl, 85, sunAz, 140), 10);
  check('Facing away from the Sun (cosθ ≤ 0): dim but still visible', cosIncidence(sunEl, 85, sunAz, 140) <= 0 && stub.solarPanelMaterial.emissiveIntensity > 0.5 && stub.solarPanelMaterial.emissiveIntensity < litIntensity);
  stub.viewMode = 'orrery'; stub._syncSunVisibility();
  check('Hidden in Orrery mode', stub.solarPanelGroup.visible === false);

  return {
    name: 'Test 24: 3D Solar Panel on a Mast (Phase 8)',
    criteria: 'Panel orientation matches tilt/azimuth, mast at the region, lit/dim shading, toggle and Pole-only visibility',
    passed, timeMs: (performance.now() - t0).toFixed(2), measurements,
  };
}
