# Artemis Lunar Landing Site Navigator

**NASA Space Apps Challenge 2026**  
**Architecture:** Vanilla JavaScript ES Modules, Three.js WebGL, Astronomy Engine, HTML5 Canvas 2D.  
**Live demo:** https://<user>.github.io/<repo>/  *(placeholder until the GitHub Pages URL is known)*  
**First load:** the app downloads a **14.4 MB** terrain file (`public/data/lola_south_pole_320m.bin`); a loading screen is shown until it is ready.  
**Terrain Status:** Real LOLA DEM (NASA PGDA `LDEM_80S_80MPP_ADJ`, resampled to 320 m); synthetic procedural terrain is the automatic fallback if the files fail to load.

---

## 1. Overview

The **Artemis Lunar Landing Site Navigator** is an interactive 3D WebGL and scientific computing tool modeling the Sun-Earth-Moon orbital system and lunar south-polar terrain. It is designed to perform geometry-grounded evaluations of NASA’s nine candidate Artemis III landing regions (announced October 2024).

### Key Technical Capabilities:
- **Zero-Build Vanilla ES Modules**: Runs natively in any standard modern web browser using standard `<script type="importmap">` mapping to pinned ES modules on `cdn.jsdelivr.net/npm`.
- **Three.js Orrery, Moon Globe & Polar Terrain**: Three view modes (the app opens on the Orrery):
  1. Sun-Earth-Moon orbital orrery with realistic axial tilts, orbit paths, and sub-solar vector lines.
  2. **Moon Globe**: textured Moon with the nine region pins, used to pick a region or a point (see Section 5).
  3. South-polar terrain mesh (80°S–90°S, real LOLA DEM) with dynamic real-time solar shading.
- **Topocentric Ephemeris Engine**:
  * Sun & Earth directions in the Moon-fixed selenographic frame using `astronomy-engine`.
  * Topocentric surface parallax correction: $\vec{d}_{\oplus} = D_{\oplus}\hat{r}_{\oplus} - \vec{r}_{\text{obs}}$ (shifts apparent Earth elevation by up to $\sim 0.268^\circ$).
- **Topographic Horizon Ray-Marching**:
  * 720 azimuth bins (0.5° angular resolution) computed over terrain heightfield accounting for lunar spherical curvature.
  * Cached in-memory per region for zero per-frame overhead.
- **Extended-Disc Occlusion Quadrature**:
  * 64-strip midpoint consistent quadrature integrating Sun (0.53° dia) and Earth (2.0° dia) discs against terrain horizon masks.
  * Analytical circular segment formula for boundary verification.
- **Direct Line-of-Sight Comms Ray**: 3D vector directed from selected landing site toward Earth, dynamically color-coded by unblocked Earth fraction ($f_{\oplus} \ge 0.95$ Cyan, $f_{\oplus} \le 0.0$ Coral, linear interpolation for partial occultation).
- **Libration Elevation Chart**: Pure Canvas 2D time-series plot depicting Earth's $\sim 27.2$-day draconic oscillation and terrain occultation threshold across the selected time span.
- **Multi-Criteria Region Ranking**: Configurable weighted trade-study slider scoring solar illumination, Earth visibility, and terrain slope flatness.
- **Automated Verification Suite**: Unified test suite runnable in browser (`tests.html`) and headless in Node.js (`tests/run.mjs` / `npm test`).

---

## 2. Running Locally

The application is a pure static site utilizing native browser ES modules and pre-compiled static stylesheets.

### Option A: Static HTTP Server (Recommended)
```bash
npm run serve
```
Serves on `http://localhost:3000` using Node's built-in HTTP server (`serve.js`).

### Option B: Build Static Stylesheet (Tailwind CSS v3 CLI)
```bash
npm run build:css
```
Compiles and minifies `src/tailwind.input.css` into `src/tailwind.generated.css` using the pinned `tailwindcss@3.4.17` CLI. (Pre-compiled in the repository; no build step required to run the site).

### Option C: Automated Verification Test Suite
```bash
npm test
```
Runs the headless test runner (`tests/run.mjs`): the whole suite (29 tests at the time of writing) covering the disc-fraction integrator against brute-force integration, ephemeris and geometry ground truth, the LOLA DEM integrity, Mission Metrics, Comparison, the Moon Globe, a CSS class completeness audit, JSDOM panel/UI logic, and a guard that no asset URL is root-absolute (see "Hosting" below).

You can also view the test suite in a browser by navigating to `http://localhost:3000/tests.html`.

### Option D: Hosting under a sub-path (GitHub Pages)
All asset URLs are **relative** (`./src/...`, `./public/...`, `./DATA_AND_METHODS.md`), so the app works both at the site root (`npm run serve`) and under a sub-path such as `https://<user>.github.io/<repo>/`. To try a sub-path locally, run a static server from the folder that *contains* the project folder and open the project folder inside it:
```bash
python3 -m http.server 8080     # run in the parent folder
# open http://localhost:8080/<project-folder>/index.html
```
Publishing on GitHub Pages: push to `main`, then Settings → Pages → "Deploy from a branch" → `main` / `(root)`. The repository contains an empty `.nojekyll` file so Pages serves the files as they are. File names are case-sensitive on Pages; a test checks every import and asset name against the real file names. Do **not** put `public/data/*.bin` in Git LFS (Pages would serve the LFS pointer text instead of the data); the file is 14.4 MB, well under GitHub's 100 MB limit. Run `npm run build` before committing so `src/tailwind.generated.css` is current. After pushing changes, hard-refresh the browser (Pages caches for about 10 minutes).

---

## 3. Topography Provenance & Real LOLA Ingestion

The app loads `public/data/lola_south_pole_320m.bin` + `.json` at start-up (paths in `config.js` → `dem`). It is NASA PGDA's `LDEM_80S_80MPP_ADJ` (https://pgda.gsfc.nasa.gov/products/90; cite Barker et al. 2023, PSJ 4, 183), block-averaged 4×4. If the files cannot be fetched or fail validation, the app runs on **synthetic placeholder terrain** and shows the banner *“Illustrative terrain – not real LOLA data”*.

To regenerate or change the resolution (needs `numpy tifffile imagecodecs`):
```bash
python3 scripts/convert_lola_dem.py path/to/LDEM_80S_80MPP_ADJ.tiff 4   # 4 -> 320 m; 2 -> 160 m (58 MB)
```
The script writes the Float32 raster (km above the 1737.4 km sphere), the metadata JSON with SHA-256, and `npm test` (Test 17) re-checks integrity and orientation. Set `dem.fallbackToSynthetic: false` to make a missing DEM a hard error.

---

## 4. Source Architecture

```
.
├── config.js               # Global configuration (radii, design tokens, pinned versions)
├── regions.js              # 9 candidate regions metadata (status: "pending")
├── index.html              # Entry HTML shell with pinned importmap and module loader
├── tests.html              # Browser verification test suite UI
├── serve.js                # Lightweight zero-dependency static server on port 3000
├── package.json            # Pinned dependencies (astronomy-engine, three, tailwindcss, jsdom) & scripts
├── tailwind.config.cjs     # Tailwind CSS v3 CLI configuration (preflight: false)
├── README.md               # Architecture documentation and running instructions
├── DATA_AND_METHODS.md     # Mathematical derivations & physical equations
├── NEEDS_HUMAN_VERIFICATION.md # Audit checklist of items pending human verification
├── CHANGELOG.md            # Version changelog with before/after audit numbers
├── tests/
│   ├── suite.js            # Unified test suite shared between Node and browser (14 tests)
│   ├── run.mjs             # Headless CLI runner (node tests/run.mjs)
│   ├── classAudit.js       # CSS class completeness audit regression test
│   └── panelVisibility.js  # JSDOM panel visibility & UI shell logic test
└── src/
    ├── app.js              # Application bootstrap & coordinator
    ├── ui.js               # UI components, HUD, dock controls, comparison table
    ├── scene.js            # Three.js 3D viewport, terrain mesh, orrery & comms ray
    ├── ephemeris.js        # Moon-fixed celestial vectors & topocentric parallax
    ├── horizon.js          # Ray marching & 64-strip midpoint disc fraction quadrature
    ├── terrain.js          # Polar stereographic coordinates & localized slope engine
    ├── demLoader.js        # DemProvider interface & synthetic polar terrain generator
    ├── comparisonEngine.js # Multi-region annual illumination & weighted ranking
    ├── earthElevationChart.js # HTML5 Canvas 2D libration time-series chart
    ├── timeStore.js        # Central simulation clock with delta-time integration
    ├── dataAndMethodsDoc.js# In-app viewer for DATA_AND_METHODS.md
    ├── tailwind.input.css  # Tailwind input stylesheet (@tailwind base; @tailwind utilities;)
    ├── tailwind.generated.css # Pre-compiled minified utility stylesheet
    └── index.css           # Standalone theme & component CSS stylesheet
```

---

## 5. Views and Features

### Moon Globe (orientation and region picking)
- A textured Moon sphere (not to scale with the pole terrain) with the nine region pins from `regions.js`. The camera looks from the south, upside-down so the south pole is at the top; orbit limits and the "Focus South Pole" / "Back to Moon Globe" presets are fixed in `src/globeView.js`. Clicking a pin or a point **selects** it; the card's **View in South Pole 3D** button opens the polar terrain (only for 80°S–90°S).
- **Real-Sun lighting:** the globe is lit from the true sub-solar direction (`astronomy-engine`) with a visible, moving day/night terminator when time is scrubbed or played. A faint ambient and an "earthshine" fill from the Earth direction keep the night side and the pins readable (artistic, not physically scaled).
- **Earth:** real Earth textures, 23.44° axial tilt, real-time rotation, a day/night side from the true Sun direction, and a bright rim that stays visible when the Moon is in front. The Earth body is hidden by the Moon.
- **Libration path:** a thin line showing where the sub-Earth point wanders (about ±7°) over one libration cycle (27.55 d); past part dim, future part bright, with a marker at the current position.
- **Sun and orbit ring:** an emissive Sun and the Sun's track around the Moon over one synodic month (about 29.53 d), past dim, future bright. In the Moon-fixed frame this track is essentially a circle around the equator plane; its latitude swing (±1.54°) is exaggerated 2× so the ring is not perfectly flat.
- Earth, Sun, path and ring are always visible in this view (no toggles), fade out when the camera gets close to them, and carry no HTML labels. A "[NOT TO SCALE] Orientation only" badge is shown. Pins shrink (to a clamped minimum) as the camera approaches the globe so that neighbouring pins do not overlap, while click targets stay large.
- The pole-mode Sun layer and the Orrery are separate and unchanged.

### Mission Metrics (Step 5)
For the selected region (or user-picked point) the Navigator shows three categories: **Sun & Power** (incidence angle, best fixed tilt/azimuth or a Manual panel, generated power and energy), **Darkness & Battery** (dark-period statistics, battery sizing inputs) and **Communication with Earth** (ΔT_comm, longest contact, free-space path loss). The mast height (default 10 m) changes the horizon used by all three.

### Comparison
The nine regions are ranked on exactly three Section 5 criteria: **best-fixed-panel energy** (Wh, higher is better), **longest dark interval** (h, shorter is better, so inverted) and **DTE coverage** (%, higher is better). Default weights are 33 / 33 / 34 (always normalised to 100 %), the mast is fixed at 10 m, and the window follows the time selector (30 / 90 / 180 / 365 days). Navigator panel and mast settings never change the Comparison.

---

## 6. Known Limits
- **320 m DEM:** obstacles smaller than 320 m are not resolved (slopes and horizons are checked against the native 80 m grid in Data & Methods §6a). The synthetic terrain is only a fallback.
- **Two illumination models:** Mission Metrics and Comparison use the binary centre-point `I(t)` / `C(t)` (Sun / Earth centre above or below the horizon); the scene visuals use the extended-disc fraction. Small differences between the two are expected.
- **`astronomy-engine` instead of SPICE / DE440:** the ephemeris is accurate for this geometric tool but is not a mission-grade SPICE kernel solution.
- **Schematic Earth orientation:** Earth's rotation and axial tilt are shown for orientation, not as a calibrated attitude model.
- **Display-only scale:** in the Moon Globe, the Earth and the Sun are drawn much smaller and closer than reality; only their directions come from the ephemeris. The pole-mode terrain exaggerates mast and panel size.
- The tool does not model launch windows or science objectives.

---

## 7. Data and Credits
- **Terrain:** NASA PGDA LOLA `LDEM_80S_80MPP_ADJ` (https://pgda.gsfc.nasa.gov/products/90), Barker et al. 2023, PSJ 4, 183; block-averaged 4×4 to 320 m.
- **Moon colour map:** LROC colour map from the NASA SVS CGI Moon Kit (`public/textures/moon_lroc_color_4k.jpg`). Earth textures are in `public/textures/`; see `DATA_AND_METHODS.md` for sources.
- **Libraries:** Three.js 0.169.0 and `astronomy-engine` 2.1.19 (loaded from `cdn.jsdelivr.net`), Tailwind CSS 3.4.17 (build only), JSDOM (tests only).
