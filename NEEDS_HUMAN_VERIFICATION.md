# Needs Human Verification Checklist

**Project:** Artemis Lunar Landing Site Navigator  
**Auditor:** Senior Front-End & Scientific-Computing Engineer  
**Audit Date:** November 2026 (Bug-Fix & Scientific Cleanup Pass)  

This checklist documents all claims, data sources, assumptions, and features that require human verification or official NASA agency data ingestion before operational flight-planning use.

---

### 1. Digital Elevation Model (DEM) & Topography Provenance
- [ ] **Item 1.1a: Real LOLA DEM Ingested (320 m resample)**
  - *Status:* Loaded from `public/data/lola_south_pole_320m.{bin,json}` (NASA PGDA `LDEM_80S_80MPP_ADJ`, SHA-256 in the JSON, checked by Test 17). Orientation checked against Shoemaker, Haworth and Malapert.
  - *Human Action Required:* confirm the file against the original download (hash of the source file, vertical datum, any terms on the product page beyond the citation request), look at the rendered terrain once in a browser, and decide whether 320 m is acceptable: horizons differ from the native 80 m grid by 0.13° on average (up to 1.1° in one direction), comparable to the Sun's 0.265° radius; 160 m cuts that to 0.044° mean at 58 MB.

- [x] **Item 1.1: Clarified Synthetic Placeholder Terrain Active** (historical; applies only when the DEM fails to load)
  - *Current Status:* **VERIFIED SYNTHETIC** (fallback only).
  - *Audit Finding:* No real 300+ MB LOLA GeoTIFF/binary is packaged in the repository. The application runs on a deterministic, seeded procedural synthetic terrain generator (`src/demLoader.js`).
  - *Mitigation Implemented:*
    * Updated app metadata (`metadata.json`) and HTML meta tags to explicitly state: `"with synthetic placeholder terrain (real LOLA DEM pending)"`.
    * Persistent undismissible banner `"Illustrative terrain – not real LOLA data"` remains rendered at all times.
    * Removed misleading claims of "real LOLA DEM telemetry".
  - *Human Action Required:* When an official NASA PDS LOLA South Polar Stereographic DEM raster (e.g. `LDEM_80S_120M.IMG`) is ingested into `public/data/`, verify file size, hash, vertical datum (km above 1737.4 km reference sphere), and update `config.js`.

- [ ] **Item 1.2: Micro-Topography and Shadow Boundary Ground-Truthing**
  - *Status:* **DOCUMENTED LIMITATION**.
  - *Detail:* The synthetic terrain and nominal 120m/px raster grids cannot model sub-50m boulders, crater rim micro-notches, or regolith slope slippage. True surface illumination at grazing solar elevation angles (< 1.5°) depends heavily on fine micro-relief.

---

### 2. Ephemeris Accuracy & Planetary Ground-Truthing
- [x] **Item 2.1: Automated Mathematical Verification Suite**
  - *Status:* **ALL 15 TESTS PASSING**.
  - *Detail:* 15 automated test suites in `tests/suite.js` (and runnable headless via `node tests/run.mjs` / `npm test`) verify:
    1. South Pole coordinate invariance within 0.27° observer parallax tolerance.
    2. Sub-solar latitude variation bounded by lunar obliquity (1.5424°).
    3. Extended disc circular segment formula vs 2D brute-force integration (tolerance 0.003).
    4. 64-strip consistent midpoint quadrature vs 2D brute-force integration (tolerance 0.005).
    5. Clean 1.000000 clear and 0.000000 blocked limits.
    6. Monotonicity across 200 sequential elevation steps.
    7. Draconic libration periodicity (~27.2 days, 5 zero crossings in 60 days).
    8. Multi-criteria weighted ranking score bounds [0, 100].
    9. Comms ray occlusion color continuous interpolation.
    10. Earth elevation oscillation amplitude at landing candidates.
    11. DEM provenance label fallback and explicit metadata pass-through.
    12. DATA_AND_METHODS.md key constants consistency.
    13. CSS utility class completeness (0 undefined classes, display rules present).
    14. JSDOM panel visibility and shell state logic mutual exclusivity.
    15. Map geometry & azimuth ground truth:
        * Horizon ray-march direction matches independent spherical great-circle ground truth within 0.5° across all 9 regions.
        * Comms-ray direction matches ground truth within 0.5° across all 9 regions.
        * Earth rays parallelism across all 9 regions has spread $\le 0.50^\circ$ (measured: $0.22^\circ$).
        * Polar Sun light direction matches true solar vector without $+1.2^\circ$ offset.
        * Synthetic DEM wall horizon peak aligns with $(40^\circ - \lambda) \pmod{360^\circ}$ within $\le 0.2^\circ$.
- [ ] **Item 2.2: Cross-Verification against NASA JPL Horizons Web Service**
  - *Status:* **NEEDS HUMAN CROSS-CHECK**.
  - *Detail:* While `astronomy-engine` provides high-precision semi-analytical planetary positions (lunar libration, topocentric parallax, sub-solar/sub-Earth coordinates), a human reviewer should spot-check topocentric Sun and Earth azimuth/elevation against NASA JPL Horizons vectors for specific mission epochs (e.g. 2026-11-01T00:00:00Z).

---

### 3. Artemis III Candidate Landing Regions
- [ ] **Item 3.1: Official Coordinate Catalog & Boundary Polygons**
  - *Status:* **PENDING – awaiting official source delivery**.
  - *Detail:* All 9 candidate regions in `regions.js` maintain `status: "pending"`. Region centers are approximate representative centroids. NASA Headquarters has announced region names and approximate 15 × 15 km dimensions, but official shapefiles/polygons must be ingested when released.
- [ ] **Item 3.2: Duplicate Longitude Flag (68.8° W)**
  - *Status:* **CONFIRMED FLAGGED**.
  - *Detail:* `Peak near Cabeus B` (83.6° S, 68.8° W) and `de Gerlache Rim 2` (88.3° S, 68.8° W) share an identical placeholder longitude in draft notes. Retained as pending with explicit flag in documentation.

---

### 4. Codebase Architecture & Dependency Purity
- [x] **Item 4.1: Removal of React/TypeScript Residue**
  - *Status:* **COMPLETED**.
  - *Detail:* Deleted unused files `src/main.tsx`, `src/App.tsx`, `src/components/`, `src/data/`, `src/math/astronomy.ts`, `tsconfig.json`, and `vite.config.ts`.
  - *Result:* Clean vanilla ES modules architecture loading `src/app.js` with zero build dependencies, pure handcrafted CSS (`src/index.css`), exact pinned versions in `package.json`, and headless test runner `tests/run.mjs`.
