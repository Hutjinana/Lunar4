# Specification & Implementation Plan Change Log

**Project:** Artemis Lunar Landing Site Navigator  
**Auditor:** Technical Editor & Aerospace Data Reviewer  
**Audit Date:** October 31, 2026  

This change log documents all modifications made across the original product specification and `implementation_plan.md` to ensure empirical rigor, honest labeling, and strict data traceability.

| Original Text / Draft Feature | Revised Text | Scientific & Factual Reason |
| :--- | :--- | :--- |
| **"Candidate landing sites / landing sites"** | **"Candidate landing regions (each containing multiple prospective landing sites)"** | NASA officially designated broad $15 \times 15\text{ km}$ candidate regions (October 2024), not pinpoint touchdown locations. |
| **"Verified NASA data" (claiming all metrics are official NASA numbers)** | **"Computed dynamically by the application from terrain and ephemeris models, or labeled illustrative"** | NASA announced regional names and spatial boundaries, not real-time telemetry metrics. Hand-written numbers were unverified. |
| **"Peak near Cabeus B: 83.6° S, 48.0° W" / "Corrected to 68.8° W"** | **"Lat: -83.6, Lon: -68.8 (status: pending, awaiting official source)"** | Rule 0: No coordinates may be corrected or guessed from memory. Must be marked pending until official catalog publication. Flagged copy-paste red flag with de Gerlache Rim 2. |
| **"Nobel crater rim 1 & 2"** | **"Nobile Rim 1 & Nobile Rim 2"** | Corrected typographic spelling. Named after Arctic explorer Umberto Nobile (IAU designated), not Alfred Nobel. |
| **"Peak near Cabeus B and de Gerlache Rim 2 coordinates listed independently"** | **"Flagged red flag: Peak near Cabeus B and de Gerlache Rim 2 share identical 68.8° W longitude"** | Coincidental identical longitudes across two distinct polar formations indicate a copy-paste error in draft source materials. |
| **"In-app Revised Spec & Science Audit tab (showing changelog, verification table, checklist)"** | **"In-app Data & Methods tab displaying DATA_AND_METHODS.md; CHANGELOG, verification table and checklist stay as repository files"** | Product UI should focus on scientific transparency (data, models, methods, limitations); audit changelogs and verification tables are engineering repository artifacts. |
| **"Point-source illumination and binary line-of-sight toggle"** | **"Extended disc modeling for Sun (~0.5° angular diameter) and Earth (~2.0° angular diameter)"** | At polar grazing angles, the Sun and Earth are frequently partially eclipsed by crater rims. Illumination and visibility must be computed as unblocked disc fractions ($0.0$ to $1.0$). |
| **"Earth hovers permanently within 0°–8° of the horizon" (hardcoded assertion)** | **"The application computes topocentric Earth elevation dynamically from libration and terrain, displaying the observed numerical range"** | Physical elevation varies depending on exact selenographic position, monthly libration ($\pm 6.7^\circ$ lat, $\pm 8.0^\circ$ lon), and local topographic obstruction. It should be computed, not asserted as a static fact. |
| **"Three.js loading via classic bundle or r160+"** | **"ES modules with `<script type="importmap">` mapping 'three' and 'three/addons/' to exact pinned version 0.174.0 on cdn.jsdelivr.net/npm"** | Recent Three.js releases no longer provide a classic UMD script bundle. Native ES module importmap guarantees clean browser resolution with zero console errors. |
| **"~15 × 15 km region size (unsourced)"** | **"Region size cited: NASA Press Release 22-088: 'Each region is approximately 15 by 15 kilometers (about 9.3 by 9.3 miles)'"** | Unsourced claim replaced with verified agency citation: [NASA Release 22-088](https://www.nasa.gov/news-release/nasa-identifies-candidate-regions-for-additional-artemis-lunar-landings/). |
| **"Tier 2 disclaimer citing South Pole-Aitken basin impact melt age"** | **"NASA candidate region selection also weighs science objectives and launch-window flight dynamics, which this geometric tool does not model."** | Replaced speculative geology claim with standard, honest engineering disclaimer regarding unmodeled launch-window and science constraints. |
| **"Slope evaluated at static 3 km radius reporting max slope"** | **"Slope evaluated at user-adjustable radius (default 3 km, range 0.5–15 km) using central differences, reporting mean and 95th percentile (P95)"** | Landing safety is localized to prospective touchdown zones; whole-region averaging dilutes steep hazards, while $P_{95}$ is robust against single-pixel altimeter noise spikes. |
| **"Decision 2 stating ±6.7° and ±8.0° libration numbers without context"** | **"Labeled ±6.7° and ±8.0° as typical maximum libration amplitudes for context only; the app computes libration from the ephemeris and does not use these values as inputs"** | Clarified mathematical role of libration amplitudes to prevent readers from assuming hardcoded orbital parameters. |
| **"Sub-solar vector listed ambiguously in both Tier 1 and Tier 3"** | **"Disambiguated: Tier 1 = directional line/arrow in Orrery view; Tier 3 = instantaneous sub-solar point surface marker on the lunar globe"** | Resolved feature overlap across tiers by separating global 3D vector graphics from surface cartographic markers. |
| **"No formal validation criteria in plan"** | **"Added formal 'Validation tests to write' section covering pole coordinate invariance, sub-solar obliquity limit (≤1.6°), disc fraction boundary values, and libration periodicity"** | Establishes objective computational verification tests the application's math engine must pass before release. |
| **"Contradictory DEM claim: 100% procedural vs real LOLA DEM embedded"** | **"Strict DEM classification: either real LOLA DEM file exists with verified metadata, or app runs on synthetic terrain with persistent 'Illustrative terrain – not real LOLA data' banner"** | Eliminates contradictory claims. Added explicit verification query to `NEEDS_HUMAN_VERIFICATION.md`. |
| **"Late 2026 / 2027 Artemis mission windows" (uncited claim)** | **"User-selectable simulation start epoch (e.g. October 2026 review date or future planning epoch)"** | Removed speculative mission launch window dates that lacked formal NASA mission timeline citations. |
| **"Complies with NASA Space Apps academic integrity"** | **[Removed entirely]** | Decorative promotional boilerplate removed; academic integrity is demonstrated through verifiable math and honest data labeling, not self-declaratory claims. |

---

## Scientific Computing & Architecture Cleanup Pass (November 2026)

### 1. Extended-Disc Fraction Integrator Fixes (src/horizon.js)

#### computeUnblockedDiscFraction (Task 1)
- **Root Cause:** Evaluated 21 trapezoid strips across the diameter and divided by analytic $\pi R^2$. Because endpoint strips have zero chord height, numerical area was systematically ~1.2% low, and partial occlusions exhibited ~1% underestimation.
- **Fix:** Implemented a 64-strip midpoint rule ($M=64$) with consistent quadrature (both numerator unblocked chords and denominator total chords evaluated on the identical midpoint grid). Azimuth-offset convergence correction ($x / \cos(\theta_c)$) preserved. Clamped to $[0, 1]$ without artificial `toFixed()` truncation.
- **Before & After Measured Values:**
  * **Sun fully clear** ($R=0.265^\circ$, elevation $+30^\circ$, mask $-5^\circ$):  
    *Before:* `0.9882` (1.2% deficit) $\longrightarrow$ *After:* `1.000000` (Exact, $\Delta = 0.000000$)
  * **Earth fully clear** ($R=1.000^\circ$, elevation $+30^\circ$, mask $-5^\circ$):  
    *Before:* `0.9882` (1.2% deficit) $\longrightarrow$ *After:* `1.000000` (Exact, $\Delta = 0.000000$)
  * **Flat mask partial grazing** ($R=0.50^\circ$, mask $0^\circ$, elevation $+0.25^\circ$):  
    *Before:* `0.7924` (Expected: 0.8045) $\longrightarrow$ *After:* `0.8046` (Expected: 0.8045, $\Delta = 0.0001$)
  * **Flat mask bisection** ($R=0.50^\circ$, mask $0^\circ$, elevation $0.00^\circ$):  
    *Before:* `0.4941` $\longrightarrow$ *After:* `0.5000` (Expected: 0.5000, $\Delta = 0.0000$)
  * **Sloped mask** ($\text{mask}(\psi) = 0.3\sin(\psi)$, $\psi=270^\circ$, elevation $+0.25^\circ$):  
    *Before:* `0.9882` $\longrightarrow$ *After:* `1.0000` (Expected: 1.0000, $\Delta = 0.0000$)
  * **Sloped mask** ($\text{mask}(\psi) = 0.3\sin(\psi)$, $\psi=45^\circ$, elevation $+0.25^\circ$):  
    *Before:* `0.5399` $\longrightarrow$ *After:* `0.5482` (Expected: 0.5482, $\Delta = 0.0000$)
- **Performance Benchmark:**
  * Single call: **3.49 µs** (0.00349 ms) in V8.
  * 9 regions $\times$ 365 days comparison (3,285 disc quadrature evaluations): **351.9 ms**.
  * Full regional comparison engine (ephemeris, topocentric parallax, slope statistics, 365-day timeseries): **439.8 ms**.

#### computeExtendedDiscFraction (Task 2)
- **Root Cause:** Inverted formula. The circular segment formula $\frac{\arccos(\xi) - \xi\sqrt{1-\xi^2}}{\pi}$ represents the *visible* unblocked fraction above the mask line $y = \xi R$. The original code assigned this to `blockedFraction` and returned `1 - that`, completely inverting partial occlusion values.
- **Fix:** Directly returned the visible fraction with documented geometric derivation.
- **Before & After Measured Comparison ($R=0.50^\circ$, mask $=0^\circ$):**
  | Elevation ($\theta$) | Brute-Force Reference | Before Fix | After Fix | Status |
  | :--- | :--- | :--- | :--- | :--- |
  | $+0.40^\circ$ | 0.9480 | 0.0520 (inverted) | **0.9480** | PASS ($\Delta = 0.0000$) |
  | $+0.25^\circ$ | 0.8045 | 0.1955 (inverted) | **0.8045** | PASS ($\Delta = 0.0000$) |
  | $+0.10^\circ$ | 0.6265 | 0.3735 (inverted) | **0.6265** | PASS ($\Delta = 0.0000$) |
  | $0.00^\circ$ | 0.5000 | 0.5000 | **0.5000** | PASS ($\Delta = 0.0000$) |
  | $-0.10^\circ$ | 0.3735 | 0.6265 (inverted) | **0.3735** | PASS ($\Delta = 0.0000$) |
  | $-0.25^\circ$ | 0.1955 | 0.8045 (inverted) | **0.1955** | PASS ($\Delta = 0.0000$) |
  | $-0.40^\circ$ | 0.0520 | 0.9480 (inverted) | **0.0520** | PASS ($\Delta = 0.0000$) |
- **Monotonicity:**
  * Before: FAILED with violation (fraction increased as elevation decreased).
  * After: PASSED across 200 sequential elevation steps.

---

### 2. Test Suite Modernization (Task 3)
- Created shared test definition module `tests/suite.js` with pure-JS $1000 \times 1000$ 2D brute-force grid numerical integration reference.
- Built headless CLI runner `tests/run.mjs` (`npm test`) outputting full measured vs expected comparison tables and exiting with code 1 on failure.
- Updated `tests.html` to import `tests/suite.js`, guaranteeing zero discrepancies between headless CLI and browser UI.
- All 10 acceptance tests pass consistently.

---

### 3. Repository Cleanup & Standalone Architecture (Task 4)
- Removed unused React/TypeScript codebase: `src/main.tsx`, `src/App.tsx`, `src/components/*.tsx`, `src/data/*.ts`, `src/math/astronomy.ts`, `tsconfig.json`.
- Converted `src/index.css` from `@import "tailwindcss";` to a lightweight handcrafted standalone CSS file preserving visual design tokens (`#07090E`, `#0F172A`, `#1E293B`, `#06B6D4`, `#F59E0B`, `#F43F5E`).
- Replaced bulky development dependencies with clean, exact pinned packages in `package.json` (`astronomy-engine: 2.1.19`, `three: 0.169.0`, `vite: 8.3.0`).
- Added standalone static server `serve.js` (`npm run serve`) listening on port 3000 with zero external server dependencies.

---

### 4. Data Honesty & Provenance Alignment (Task 5)
- Audited repo for ungrounded claims. Corrected `metadata.json` and `index.html` description to explicitly declare `"with synthetic placeholder terrain (real LOLA DEM pending)"`.
- Persistent banner *“Illustrative terrain – not real LOLA data”* preserved across all views.
- Expanded `NEEDS_HUMAN_VERIFICATION.md` with complete technical checklist.
- Unified `DATA_AND_METHODS.md` with in-app documentation.

---

## Audit Cleanup & Provenance Verification Pass (November 2026)

### Task 1 – DEM Provenance Labels & Grounding (src/demLoader.js)
- **Problem:** `getMetadata()` labeled any real DEM as `'NASA LRO LOLA Altimetry (Verified)'` and defaulted missing licenses to `'NASA Open Data / Public Domain'`.
- **Fix:** Switched to honest fallbacks: `source: this.realMetadata.source || 'LOLA-derived (provenance to be confirmed)'` and `license: this.realMetadata.license || 'To be confirmed'`. Explicit metadata fields pass through unchanged; speculative claims of "Verified" or unverified public domain status removed.
- **Verification:** Added Test 8 in `tests/suite.js` asserting fallback strings and pass-through behavior.

### Task 2 – Single Source of Truth for Data & Methods (DATA_AND_METHODS.md)
- **Problem:** `DATA_AND_METHODS.md` and `src/dataAndMethodsDoc.js` maintained two separate, drift-prone copies of documentation text.
- **Fix:** Removed the duplicated 140-line `RAW_DATA_AND_METHODS_MD` template string. The Data & Methods tab now dynamically fetches `/DATA_AND_METHODS.md` at runtime via `fetch('/DATA_AND_METHODS.md')` with graceful error handling. Dynamic dataset metadata is cleanly appended by the UI viewer.
- **Documentation Updates:** Updated Section 4 in `DATA_AND_METHODS.md` to document the 64-strip midpoint consistent quadrature, exact measured accuracy numbers ($\Delta_{\max} = 0.0003$ on flat mask, $0.0001$ on sloped mask), and explicit synthetic terrain disclaimer.
- **Verification:** Added Test 9 in `tests/suite.js` asserting markdown text consistency with code constants (Sun radius 0.265°, Earth radius 1.00°, 64 strips).

### Task 3 – Repository Leftovers & Dependency Hygiene
- **Cleanup:** Removed unused `bun.lock` and `.env.example`. Removed unused `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` capability from `metadata.json`. Checked `.gitignore`.
- **Vite Retention Rationale:** Kept Vite (`"dev": "vite --port=3000 --host=0.0.0.0"`) and dependencies `astronomy-engine` (2.1.19) and `three` (0.169.0) matching the importmap because the platform dev server environment and `compile_applet` build validation require Vite, while `serve.js` (`npm run serve`) provides a zero-dependency production/local alternative.

### Task 4 – Multi-Criteria Ranking Permutation Verification (Test 5 Part 2)
- **Strengthened Test 5:** Retained Part 1 mock test (r1–r3). Added Part 2 evaluating `computeRegionalComparisonData` over all 9 candidate regions for a 30-day window on synthetic terrain.
- **Verification Assertions:** All composite scores in [0, 100], no `NaN` values, ranks form a complete 1..9 permutation, and shifting weights to (0, 100, 0) re-orders candidates. Outputs a fully formatted table labeled `SYNTHETIC TERRAIN – illustrative numbers, not real landing-site recommendations`.

---

## Layout Bug & CSS Utility Completeness Fix (November 2026)

### 1. The Bug & Root Cause
- **Symptom:** On initial page load, a huge amount of text from the Data & Methods specification and Region Comparison tabs filled the entire screen and could not be closed or toggled.
- **Root Cause:** When Tailwind was replaced with the handcrafted standalone stylesheet `src/index.css`, approximately 185 utility classes used across `src/ui.js`, `src/dataAndMethodsDoc.js`, and `index.html` were omitted. Crucially, `.hidden { display: none; }`, `.block`, `lg:hidden`, `lg:flex`, `opacity-0`, `group-hover:opacity-100`, `-translate-x-1/2`, `bottom-28`, `max-h-[70vh]`, `divide-y`, and `list-disc` were completely undefined. Because `.hidden` did not exist in CSS, elements authored with `class="hidden ..."` (`#comparison-tab`, `#methods-tab`, `#pole-region-panel`, `#pin-tooltip`, `#earth-chart-panel`) remained displayed simultaneously, stacked on top of the 3D viewport.

### 2. Measured Scope
- **Total classes used in code:** 349 (348 after invalid utility cleanup)
- **Number undefined before fix:** 177 classes (captured in `tests/classAudit.js` initial failure run)
- **Number defined after fix:** 418 classes across `src/tailwind.generated.css` and `src/index.css`
- **Undefined classes after fix:** 0 (all classes defined or accounted for in the 13 allow-listed JS hooks)

### 3. Applied Fixes
- **Invalid Utility Replacement (Task 2):** In `src/ui.js`, replaced `bg-[#07090E]/98` with standard opacity `bg-[#07090E]/95` (lines 517 and 768), and replaced `py-0.2` with standard spacing `py-px` (lines 1421 and 1857).
- **Static Stylesheet Compilation (Task 1):**
  * Pinned `tailwindcss@3.4.17` devDependency.
  * Added `tailwind.config.cjs` with `content: ['./index.html', './src/**/*.js']` and `corePlugins.preflight: false` (to preserve the custom reset in `src/index.css`).
  * Created `src/tailwind.input.css` containing `@tailwind base; @tailwind utilities;`.
  * Generated minified static stylesheet `src/tailwind.generated.css` (22 KB) via npm script `"build:css"`.
  * Linked `/src/tailwind.generated.css` before `/src/index.css` in `index.html` and `tests.html`.
- **CSS Completeness Regression Test (Task 3):** Created `tests/classAudit.js` (Test 10 in `tests/suite.js`) to extract all class tokens, parse combined CSS, maintain the 13 documented JS-hook allow-list entries, assert zero undefined classes, and verify `.hidden`, `lg:hidden`, and `lg:flex` rules.
- **JSDOM Panel Visibility & Shell State Logic Test (Task 4):** Created `tests/panelVisibility.js` (Test 11 in `tests/suite.js`) using `jsdom@26.0.0` to verify:
  * Initial tab state: exactly `#navigator-tab` is visible; `#comparison-tab` and `#methods-tab` have `hidden`.
  * Tab switching: clicking `#nav-btn-comparison`, `#nav-btn-methods`, `#nav-btn-navigator` maintains strict mutual exclusivity.
  * View mode switching: clicking `#mode-btn-pole` and `#mode-btn-orrery` correctly toggles control boxes and telemetry panels.
  * Persistent disclaimer banner: exactly one `.persistent-disclaimer-banner` element exists with `aria-label="Dataset status"`.
  * Initial closed state: `#pin-tooltip`, `#earth-chart-panel`, `#pole-controls-box`, `#pole-region-panel`, and `#icon-pause` all possess `hidden`.
- **Static Cleanup (Task 5):** Removed `vite.config.js` and `metadata.json`. Removed Vite from `package.json` dependencies and cleaned scripts down to `"serve"`, `"test"`, and `"build:css"`.

---

## Azimuth-to-Map Direction Transformation & 3D Earth Globe Pass (November 2026)

### 1. Azimuth-to-Map Direction Alignment (Part A)
- **Root Cause:** Topocentric azimuth $\psi$ is measured clockwise from Local North (directed radially outward from the South Pole along the observer's local meridian $\lambda$). The south polar stereographic projection defines map $(x, y) = (\rho \sin\lambda, -\rho \cos\lambda)$, corresponding to scene $(X, Z) = (\rho \sin\lambda, \rho \cos\lambda)$. Local North points along $(\sin\lambda, \cos\lambda)$ and Local East points along $(\cos\lambda, -\sin\lambda)$. Three locations in the codebase previously assumed North was $-Z$ or ignored longitude:
  1. `src/horizon.js` (`computeHorizonProfile`): marched along $(\sin\psi, -\cos\psi)$ ignoring $\lambda$.
  2. `src/scene.js` (`updateCommsRay`): computed direction $(\sin(\text{az})\cos(\text{el}), -\cos(\text{az})\cos(\text{el}))$ ignoring $\lambda$.
  3. `src/scene.js` (`polarSunLight`): used arbitrary $+1.2^\circ$ elevation offset and $-Z$ north.
- **Fix:**
  - Implemented single pure shared function `azimuthToMapDirection(azimuthDeg, lonDeg)` in `src/mapGeometry.js` computing map $(x, y) = (\sin(\psi+\lambda), -\cos(\psi+\lambda))$ and scene $(X, Z) = (\sin(\psi+\lambda), \cos(\psi+\lambda))$.
  - Integrated `azimuthToMapDirection` into `computeHorizonMarchDirection` in `src/horizon.js`.
  - Updated `src/scene.js` `computeCommsRayVector` using horizontal $(\sin(\text{az}+\lambda), \cos(\text{az}+\lambda))$ and vertical $\sin(\text{el})$.
  - Updated `computePolarSunLightVector` using pole $\lambda=0^\circ$ and true solar elevation without $+1.2^\circ$ offset.
  - Invalidated legacy horizon cache in `src/horizon.js` by incorporating `lat`, `lon`, and `_v2` into cache key.

### 2. Independent Ground Truth Tests (Part B)
- **Test Implementation (`tests/geometry.js` / Test 12 in `tests/suite.js`):**
  - Independent spherical great-circle formulation: at epoch `2026-11-03T00:00:00Z`, constructed horizontal vector $\vec{t} = \cos(\text{az})\hat{N} + \sin(\text{az})\hat{E}$, stepped $\epsilon = 0.002\text{ rad}$ along great circle, projected new coordinate to stereographic map, and measured scene-plane direction $\operatorname{atan2}(\Delta x, -\Delta y)$.
  - **Failing Output Before Fix:** Malapert Massif off by $172.32^\circ$, Cabeus B off by $100.41^\circ$, ray spread across 9 regions was $180.30^\circ$ (FAIL), Sun light off by $29.26^\circ$ azimuth and $1.20^\circ$ elevation, synthetic DEM wall peaks failed for all regions.
  - **Passing Output After Fix:** Horizon ray-march and Comms ray match ground truth with $\Delta = 0.00^\circ$ for all 9 candidate regions. Earth rays parallel with spread $0.22^\circ \le 0.50^\circ$. Sun light matches ground truth with $\Delta = 0.00^\circ$ (no offset). Synthetic DEM wall test peaks at $(40^\circ - \lambda) \pmod{360^\circ}$ within $\le 0.2^\circ$.

### 3. Textured Earth Globe & Dynamic Comms Ray (Part C)
- **Shared Procedural Texture:** Refactored procedural Earth canvas generation into shared top-level function `createProceduralEarthTexture()`.
- **Textured Globe Mesh:** Replaced cyan beacon with dynamic Earth sphere mesh at ray end ($L = 55\text{ km}$) with true lunar-sky apparent radius $r = 55 \cdot \tan(1.0^\circ) \approx 0.960$ scene units (subtending $\approx 2^\circ$ diameter).
- **Physical Features:** Applied $23.44^\circ$ axial tilt, ephemeris diurnal rotation, and scene solar illumination for natural lunar-sky Earth phases.
- **Occlusion & Sub-Horizon Feedback:** Comms ray renders as solid line when $f_{\oplus} \ge 0.95$ and dashed line when $f_{\oplus} < 0.95$ with continuous cyan-to-coral color interpolation. Globe dims to $35\%$ opacity when $\text{el} < 0^\circ$ and displays `"BELOW HORIZON"`. Floating billboard label displays real-time elevation, visibility percentage, and link status.
- **HUD Legend:** Added `#pole-comms-legend-card` in South Pole view with exact note: `"Earth drawn at its true angular size from the surface (≈2°); terrain scale is exaggerated"`.

---

## Sourced Region Coordinates & Kind Classification Pass (November 2026)
- **Sourced Coordinates & Provenance:** Replaced placeholder region coordinates with sourced values from LROC NAC ROI mosaics (5 region centres) and Wueller et al. 2026 (4 candidate sites) with status `"sourced"`.
- **UI & Verification Updates:** Added visible kind labels (`region_centre` vs. `candidate_site`) wherever coordinates appear in inspector, tooltips, list, and comparison table; added `tests/regions.js` (Test 13) enforcing data integrity and bounds.


## Full 80°S–90°S Terrain Domain (November 2026)
- **Terrain domain:** `radii.polarDomainSpanKm` 100 → 305 km, mesh grid 321 (`radii.polarMeshGridSize`); all 9 region pins now sit on terrain. Camera overview/zoom limits scale with the span; shadow bounds sized to the mesh; graticule extended to 80°S (rings every 2°, meridians 80–90°S).
- **Docs & tests:** Data & Methods span/triangle count computed from config (unmeasured FPS claim removed); added `tests/domain.js` (Test 14).

## Procedural Lunar Surface Detail (November 2026)
- **Terrain:** Synthetic DEM now adds ~900 seeded generic craters (power-law sizes, fresh-to-degraded depths, raised rims + ejecta), 14 broad hills and multi-octave rolling noise across the whole ±305 km domain. Named craters/massifs and all region coordinates are unchanged; the added features are generic and illustrative (banner stays).
- **Tests & docs:** added `tests/terrainRealism.js` (Test 15); Data & Methods notes the procedural surface detail.

## Pick Your Own Point (November 2026)
- **Feature:** analyse any point in 80–90 °S via a Lat/Lon form (Enter submits) or a terrain click (< 4 px movement, pins keep priority); shown as a "User-picked point" pseudo-region with one violet/white pin and a Clear button; excluded from the comparison, ranking and 9-region counts.
- **Support:** `src/pickPoint.js` (validation, click mapping), horizon cache capped at 50 user entries, label branches in `regions.js`, Earth-elevation chart now refreshes when the selected region changes; Data & Methods section 7a; `tests/pickPoint.js` (Test 16).

## Real LOLA Terrain (November 2026)
- **Terrain:** the app now loads NASA PGDA `LDEM_80S_80MPP_ADJ` (Barker et al. 2023) block-averaged 4×4 to 320 m (1900², ±303.84 km, 14.4 MB) from `public/data/`; `scripts/convert_lola_dem.py` regenerates it. DEM loads before UI/mesh/horizons (`loadConfiguredDem`, async bootstrap); failure falls back to synthetic terrain and its banner. Banner and status panel now follow `demProvider.isSynthetic`; outside-raster samples hold the edge value instead of 0.
- **Orientation:** the GeoTIFF's y axis is the negative of the app's map y axis, so the raster needs no flip; guarded by `tests/lolaDem.js` (Test 17: SHA-256, units, Shoemaker/Haworth/Malapert landmarks, edges, provenance, fallback). Measured vs the native 80 m grid: slopes ≤0.3° (mean) / ≤0.7° (P95), horizons 0.13° mean and up to 1.1° worst bin (Data & Methods 6a); 160 m is a one-argument rerun of the script (58 MB).
- **Terrain/picture alignment fix:** the terrain mesh was mirrored in z relative to the pins and graticule (e.g. the Malapert pin floated 2.8 scene units above the ground); mesh rows are now ordered to match (`orientHeightsForMesh`). The random noise floor texture is replaced by a single terrain-derived albedo texture (slope + elevation, no baked shading; `generateTerrainAlbedo`), and the mesh grid goes 321 → 513 (≈1.2 km cells). Added `tests/terrainMesh.js` (Test 18).

## Orrery Realism & Earth Orbit (November 2026)
- **Textures:** Earth (day map, specular, normal, clouds, atmosphere rim) and Moon now use image maps from `public/textures/` (procedural fallbacks if loading fails); Sun is a procedural photosphere with limb darkening. Moon near side now faces Earth (texture lon 0 rotated to +z, libration applied).
- **Earth's orbit:** new ring around the Sun (e = 0.0167, Sun at ephemeris AU distance), new "Orbit" camera preset. Orrery axes made right-handed (z = -sin λ) so Earth's spin, axial tilt direction and Moon/Sun texture sides are physically oriented. Sources noted in Data & Methods §1, §8.3.


## Mission Metrics Module – Phase 6 (November 2026)
- **New `src/missionMetrics.js` (pure, no DOM):** incidence angle, S(t), binary centre-point I(t)/C(t), P_gen, ΔT_comm + longest contact, dark-period stats (edge runs flagged), FSPL (km→m), energy, and a best-fixed tilt/azimuth optimiser; Sun/Earth series sampled once per window (30 min step, default one synodic month) and cached per region/mast/window.
- **Found while testing:** `computeEphemeris().sunEcliptic.distAu` is always `undefined` (`Astronomy.Ecliptic()` has no `.dist`; `scene.js` masks it with `|| 1.0`); the new module takes the Sun distance from `GeoVector` instead and `ephemeris.js` is untouched. Added `tests/missionMetrics.js` (Test 23).

## Mast Height in the Horizon – Phase 7 (November 2026)
- **`src/horizon.js`:** `computeHorizonProfile`, `getRegionHorizonProfile`, `prewarmRegionHorizonProfiles` and `evaluateRegionCelestialOcclusion` take an observer mast height (default `DEFAULT_MAST_HEIGHT_M` = 10 m): `theta = atan((z − (h_site + mast))/ρ) − ρ/2R`, curvature kept. Cache key = region + lat/lon + range + mast rounded to 0.1 m (`v3`); user-pick cap unchanged. All existing callers (Navigator, Comparison, charts) now use 10 m.
- **UI/tests:** one-line "320 m DEM, smaller obstacles not resolved" note in the region panel; mast-height tests added to Test 23 (analytic flat-terrain check, cache keys, monotonic effect on real DEM).

## 3D Solar Panel on a Mast – Phase 8 (November 2026)
- **New `src/solarPanel3d.js` + `scene.js`/`app.js` hooks:** mast and panel at the selected region (incl. user-picked points), Pole mode only, toggled by the now-enabled "Solar Panel (3D)" layer. Panel uses the region's best fixed tilt/azimuth (cached, 10 m mast); `app.manualPanel = {tiltDeg, azimuthDeg}` is the hook for Phase 9 Manual mode. Bright emissive ∝ cos θ when I(t)=1 and cos θ > 0, dim grey otherwise.
- **Exaggeration:** mast drawn at 0.3 scene units per metre (10 m → 3 units); orientation and lit state are true. Optional Sun→panel arrow not built. `panelVisibility.js` now expects the Solar Panel button enabled; added Test 24.

| **Comparison scored on sun fraction, Earth fraction, slope flatness (40/40/20)** | **Phase 10: Comparison scored on exactly three Section 5 criteria: best-fixed-panel energy (Wh), longest dark interval (h, inverted), DTE coverage (%); default weights 33/33/34; no slope; mast fixed at 10 m; window = time selector** | Implements architecture PDF Section 5 with the binary centre-point I(t)/C(t) of `missionMetrics.js`; slope stays in the region inspector. |

## Sun Illumination Chart & Solar Energy Graph – Phase 11 (November 2026)
- **New `src/sunIlluminationChart.js`, `src/panelEnergyChart.js` + `ui.js`/`app.js` hooks:** two new toggles in the Layers & Charts menu. Sun chart plots α_sun(t) against θ_horizon(az_sun(t)) with shaded lit intervals and a stats row (lit %, lit hours, longest dark); energy graph plots cumulative E(t) = Σ P_gen·dt (Wh) with P_gen(t) underneath for the active panel (best fixed, or Manual with the best fixed curve as reference). Both click/drag to seek, draw only cached mission-metrics arrays (no per-frame ephemeris/horizon work) and stack above the Earth chart without overlap.
- **Tests:** added `tests/analysisCharts.js` (Test 26); `panelVisibility.js` now expects 7 layer toggles.
- **Follow-up:** Sun Illumination and energy charts now follow the scrub span (30/90/180/365 d, Comparison step per span; built only while a chart is open). Themed thin scrollbars (`.nice-scroll`) on drawers/panels/tabs and a styled simulation-time slider (`.sim-range`).

## Mission Metrics regrouped, line-chart solar graph – Phase 11 follow-up (November 2026)
- **`missionMetricsCard.js`:** the single "Mission Metrics" card is removed; its values are now three main categories — Sun & Power, Darkness & Battery, Communication with Earth — each with its own Advanced section holding only the inputs that feed it (A_panel/η/Manual panel; P_base/P_heater/DoD/Battery; Frequency; Mast height in all three because it changes the horizon). Element ids unchanged except extra mast/error/reset copies.
- **`panelEnergyChart.js` / `ui.js`:** the solar energy graph is now a line chart of P_gen(t) per time step (dashed Best line while Manual is ON); E so far / E window stay as text readouts.

## Separate Select Region / Analysis & Charts panels – Phase 11 follow-up (November 2026)
- **`ui.js`:** the right panel is split into two floating, collapsible panels: **Select Region** (left: 9-region list + Pick a point) and **Analysis & Charts** (right: Layers & Charts, region inspector, the three categories, slope). Both show only in South Pole mode; Hide/Show buttons collapse each to its header.

## Phase 13: Moon globe landing view (November 2026)
- App now opens on a spherical Moon (LROC colour mosaic `public/textures/moon_lroc_color_4k.jpg`, orientation only, not to scale) with the nine region pins from `regions.js`; click a pin to zoom in and open South Pole 3D with that region selected. New `src/globeView.js`; globe code in `scene.js`/`ui.js`/`app.js`.
- Added Moon Globe button to the mode switcher, "Back to Moon Globe" in the right menu, "Focus South Pole" preset, `tests/globeView.js` (Test 27); initial-mode assertion in `tests/panelVisibility.js` now expects the globe first, then Orrery.

## Moon globe: upside-down view centred on the south pole (November 2026)
- Moon Globe view is now flipped (camera up = -y) so the south pole is at the top of the screen; drag axes inverted to keep grab-and-rotate natural. Other views keep the normal up vector.
- Landing view starts centred on the south pole (camera on the axis below it, distance 22) and orbits freely from there. Tests updated in `tests/globeView.js`.
- Moon Globe camera is now locked to the south: camera latitude can't go north of -20° (`GLOBE_MAX_CAMERA_LAT_DEG` in `src/globeView.js`); orbit/zoom otherwise unchanged. Tests in `tests/globeView.js` updated.
- Moon Globe landing view is now side-on (camera on the equator plane, lon 0°): upside-down globe with the south pole on the top rim and the pins standing up out of it. Camera may now go from the equator down to the pole (`GLOBE_MAX_CAMERA_LAT_DEG = 0`). Pin picking uses line of sight to the pin head (`isGlobeHeadVisible`) so pins past the limb stay clickable. Returning from South Pole mode reuses the side-on view at the region's longitude.
- Moon Globe camera now looks at and orbits a point on the rotation axis at the 70°S circle height (`GLOBE_ORBIT_TARGET`, ~0.6 units from the south pole) instead of the globe centre, so the south polar region stays at the screen centre. Distance/phi are measured from that target; `clampGlobeOrbit` keeps the camera outside the sphere (>= 11.5 from the globe centre) and at or south of the equator plane. Focus South Pole preset distance adjusted (4.6 from the target, ~14 from the centre as before). Tests in `tests/globeView.js` updated (screen centre = target in every view).
- Mode switcher order is now Orrery, Moon Globe, South Pole 3D, and the app opens on the Orrery (UI and scene both start in `orrery`; the Moon Globe is one click away). `tests/panelVisibility.js` and `tests/globeView.js` updated for the new opening view and button order.

## Moon globe: select a point, then "View in South Pole 3D" (November 2026)
- Clicking the Moon Globe now only selects: a pin selects its region, bare surface selects that lat/lon (white ring marker). A card appears with the name, coordinates + coordinate-kind label and a **View in South Pole 3D** button (pin -> same fly-in/selection path as before; point -> analysed as a user-picked point like the Pick-a-point form). The button is disabled outside 80–90 °S (never clamped); × or a click on empty space clears the selection.
- `globeView.js` `globePositionToLatLon`; `scene.js` `_pickGlobeSurface`/`setGlobeSelection`, callback `onGlobePinPick` replaced by `onGlobeSelect`; `ui.js` selection card; `tests/globeView.js` (Test 27) updated and extended.

## Moon globe: real Sun, Earth, libration path, Sun orbit ring, pin readability – Phases G1–G7 (November 2026)
- **`src/globeView.js` / `src/scene.js`:** the globe is lit from the true sub-solar direction (ambient + earthshine fill); a textured Earth (23.44° tilt, real-time rotation, day/night from the Sun, always-bright rim, hidden by the Moon, fades near the camera); Earth libration path (27.55 d, past dim / future bright); emissive Sun (`GLOBE_SUN_DISTANCE` 100, `GLOBE_SUN_RADIUS` 2.5) with a one-synodic-month orbit ring. Paths are rebuilt only when time moves more than a day. No toggles and no HTML labels; the camera settings are unchanged; the pole-mode Sun layer is unchanged.
- **Pin readability (G7):** pins shrink to a clamped minimum as the camera nears the globe (`globePinScale`), hit targets keep at least 60 % of their normal size, and picking chooses the pin closest to the pointer ray. New tests in `tests/globeView.js`.

## Finalisation for GitHub Pages – Phase G8 (November 2026)
- **Relative URLs:** `index.html`, `tests.html`, `config.js` (DEM paths), `src/scene.js` (texture base), `src/dataAndMethodsDoc.js` and the test helpers now use `./...` URLs, so the app works from a sub-path (verified with `python3 -m http.server` from the parent folder). New `tests/relativeUrls.js` fails on any string literal starting with `/src/`, `/public/` or `/DATA_AND_METHODS`, checks import/asset file names for exact letter case, and checks `.nojekyll`.
- **Loading state:** a loading screen (with the 14.4 MB download note) is shown until the DEM has loaded and the app has started; a start-up failure shows an error message instead of a blank page.
- **Cleanup:** removed the unused `@import "tailwindcss"` line from `src/index.css` (it produced a 404 and a console error on every load; all styles come from `tailwind.generated.css`).
- **Repository:** added `.nojekyll`; `src/tailwind.generated.css` rebuilt; no Git LFS for the `.bin` file.
- **Docs:** README documents the Moon Globe, Mission Metrics, Comparison, known limits, data attribution, the "Live demo" placeholder and sub-path hosting. `DATA_AND_METHODS.md` is unchanged, so the numbers checked by its consistency test are unchanged.

