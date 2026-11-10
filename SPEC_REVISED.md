# Artemis Lunar Landing Site Navigator — Revised Technical Specification

**Project:** Artemis Lunar Landing Site Navigator  
**Challenge:** NASA Space Apps Challenge 2026  
**Final Submission Due:** November 14–15, 2026  
**Document Status:** Revised Aerospace Review Edition (Part A & B Audited)

---

## Title & Summary
The Artemis Lunar Landing Site Navigator is an interactive 3D WebGL aerospace visualization and geometric analysis application modeling the Sun-Earth-Moon orbital system (orrery) and lunar south-polar terrain. It enables comparative evaluation of NASA's nine candidate Artemis III landing regions by computing solar disc illumination fractions, direct-to-Earth (DTE) extended disc visibility, terrain shadow occlusion, and local surface slope distributions over a user-scrubbed epoch (up to 365 days).

---

## User Review & Critical Decisions

> [!IMPORTANT]
> **Rule 0 Coordinate Governance**: In accordance with strict aerospace data governance, no coordinates have been estimated or guessed from memory. All nine candidate region coordinates are designated **PENDING – awaiting source** in `/regions.js`. The word "Corrected" is strictly prohibited next to any coordinate. A severe copy-paste red flag is formally noted: `Peak near Cabeus B` and `de Gerlache Rim 2` share an identical placeholder longitude (68.8° W).

- **Three.js ES Module & Importmap Loading Strategy**:
  Modern Three.js releases no longer provide a classic UMD `<script>` build. The loading strategy mandates native browser ES modules (`<script type="module">`) configured via an inline `<script type="importmap">` mapping bare specifiers to exact pinned versions hosted on `cdn.jsdelivr.net/npm`:
  ```html
  <script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.174.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.174.0/examples/jsm/"
    }
  }
  </script>
  ```
  *Acceptance Rule:* The application must load in standard modern browsers with zero console errors and zero HTTP 404 network requests.
- **In-App Scientific Tab**: The application interface includes a dedicated in-app **Data & Methods** tab that renders `DATA_AND_METHODS.md`. Supporting audit artifacts (`CHANGELOG.md`, `REGION_VERIFICATION.md`, and `NEEDS_HUMAN_VERIFICATION.md`) remain repository-level review documents and are not exposed as end-user product tabs.
- **Extended Disc Modeling**: The Sun and Earth are modeled as extended discs rather than dimensionless points. Because the Sun ($\sim 0.53^\circ$ angular diameter) and Earth ($\sim 1.9^\circ\text{–}2.0^\circ$ angular diameter seen from the Moon) hover near the local horizon at the lunar South Pole, partial terrain occlusion (penumbral solar grazing and partial Earth disc masking) is physically common and modeled as an unblocked disc fraction ($0.0$ to $1.0$).
- **Dynamic Earth Elevation**: The static claim that "Earth hovers within 0°–8° of the horizon" has been removed. The application dynamically computes topocentric Earth elevation from lunar libration and local terrain coordinates, displaying the observed numerical range at runtime.
- **DEM Provenance & Synthetic Fallback Rule**: If an official, validated LOLA DEM binary exists in the repository, its filename, byte size, resolution ($\text{m/pixel}$), projection, and verbatim license must be documented. If unverified or absent, the application must run on synthetic procedural terrain accompanied by a persistent, un-dismissible UI banner: `"Illustrative terrain – not real LOLA data"`.

---

## 1. Overview & Core Concept

### 1.1 What It Does
The application models the dynamic solar illumination and Earth line-of-sight communication geometry for the lunar South Pole over an adjustable epoch (up to 365 days). It dynamically evaluates the nine candidate landing regions announced by NASA for Artemis III, computing disc occlusion fractions, line-of-sight obstruction from local crater topography, and slope statistics.

### 1.2 Framing & Region Designation
NASA designated nine candidate landing **REGIONS**, each approximately $15 \times 15\text{ km}$ ([NASA Press Release 22-088](https://www.nasa.gov/news-release/nasa-identifies-candidate-regions-for-additional-artemis-lunar-landings/)), each containing multiple potential landing sites. Specific touchdown locations are selected later based on launch dates and flight dynamics. Map pins indicate approximate region centroids.

### 1.3 Target Audience & Value
Built for aerospace mission designers, planetary science researchers, and NASA Space Apps Challenge reviewers to perform empirical, physics-based geometric trade studies without relying on unverified claims.

---

## 2. User Experience & Visual Design

### 2.1 Workspace Architecture
- **Primary Viewport**: Interactive 3D WebGL stage toggling between `Solar System Orrery` and `Lunar South Pole 3D View`.
- **In-App Data & Methods Tab**: Dedicated full-screen scientific disclosure panel rendering `DATA_AND_METHODS.md`.
- **Region Comparison & Ranking Tab**: Side-by-side tabular comparison of all nine candidate regions with user-adjustable criteria weights.
- **Unified Collapsible Bottom Dock**: Consolidates time scrubbing, playback rates, epoch selection, and camera presets while leaving the 3D viewport unobstructed.

### 2.2 Extended Disc Visual Feedback
- **Sun Illumination**: Evaluated as the fraction of the Sun's $0.53^\circ$ angular disc unobscured by terrain ($0.0 = \text{Full Shadow}$, $0.0 < f < 1.0 = \text{Partial / Penumbra}$, $1.0 = \text{Direct Sunlight}$).
- **Earth Communications Ray**: Vector from observer to Earth ($1.9^\circ\text{–}2.0^\circ$ angular diameter from lunar distance). The comms ray is color-coded by terrain occlusion:
  * Cyan ($f_{\text{Earth}} = 1.0$): Full direct-to-Earth line of sight.
  * Amber ($0.0 < f_{\text{Earth}} < 1.0$): Partial limb occlusion.
  * Coral / Red ($f_{\text{Earth}} = 0.0$): Fully occluded by terrain.

---

## 3. Key Product Decisions & Trade-Offs

### 3.1 Extended Disc Ray-Marching vs. Point-Source Approximation
- *Chosen Approach*: Multi-ray or angular sector integration over extended discs (Sun $\approx 0.5^\circ$, Earth $\approx 2.0^\circ$) against the local DEM horizon elevation profile.
- *Rationale*: At polar latitudes ($>84^\circ\text{S}$), solar and terrestrial elevation angles frequently skim within $1^\circ$ of local crater ridges. Point approximations create false binary toggling when in reality grazing illumination delivers partial power to solar arrays and partial Earth disc visibility.

### 3.2 Ephemeris Modeling & Libration Interpretation
- *Chosen Approach*: Dynamic topocentric coordinate transformation ($1.54^\circ$ lunar axial tilt, ephemeris-driven optical and physical libration).
- *Contextual Libration Bounds*: Typical maximum libration amplitudes are $\pm 6.7^\circ$ in latitude and $\pm 8.0^\circ$ in longitude (for context only; the app computes libration from the ephemeris and does not use these values as inputs).

### 3.3 Localized Slope Evaluation Radius
- *Chosen Approach*: User-adjustable slope evaluation radius (default: $3.0\text{ km}$, range: $0.5\text{ to }15.0\text{ km}$).
- *Rationale*: Slope is evaluated within a localized radial radius around prospective landing targets rather than averaged over an entire candidate region because touchdown safety, tip-over hazards, and surface mobility limits depend on immediate local terrain gradients, whereas whole-region averages dilute steep crater rim walls and localized escarpments.
- *Mathematical Formulation*: Central differences on the DEM grid:
  $$\text{Slope}(x, y) = \arctan\left(\sqrt{\left(\frac{\partial z}{\partial x}\right)^2 + \left(\frac{\partial z}{\partial y}\right)^2}\right)$$
  Reported as **mean slope** and **95th percentile slope** ($P_{95}$, capturing hazardous slopes while remaining robust against single-pixel altimeter noise spikes).

---

## 4. Technical Architecture & Feature Hierarchy

### Feature Tiers & Priorities

#### Tier 1 (Must Ship — Core Delivery)
1. **Solar System Orrery View**: Sun, Earth, Moon orbit plane, sub-solar vector directional line/arrow in the Orrery space; explicitly labeled `[NOT TO SCALE]`.
2. **Lunar South Pole 3D View**: Polar terrain relief mesh with nine candidate region marker pins.
3. **Mission Time Scrubber**: User-selectable epoch with scrub range up to 365 days, play/pause, speed controls ($1\times, 5\times, 20\times, 100\times$), and synodic/draconic jump shortcuts.
4. **Computed Per-Region Metrics**: Sun elevation and unblocked solar disc fraction ($f_{\odot}$), Earth elevation and unblocked Earth disc fraction ($f_{\oplus}$), mean slope, and 95th percentile slope ($P_{95}$) within the user-adjustable radius.
5. **Candidate Region Comparison Table**: Side-by-side tabular view of all nine regions with computed metrics.
6. **Data & Methods Tab**: In-app rendering of `DATA_AND_METHODS.md`.

#### Tier 2 (Enhanced Analysis)
1. **Weighted Multi-Criteria Ranking Engine**: Adjustable weights for Solar Illumination, Earth Visibility, and Slope Flatness.
   * *Mandatory Disclaimer*: *"NASA candidate region selection also weighs science objectives and launch-window flight dynamics, which this geometric tool does not model."*
2. **Terrain-Occluded Comms Ray**: 3D vector from candidate region to Earth, color-coded by unblocked Earth disc fraction.
3. **Earth Elevation Over Time Chart**: Line chart displaying libration-driven Earth elevation variation over a selected timeframe.

#### Tier 3 (Stretch Features)
1. **Sub-solar point surface marker**: Marker placed on the lunar globe surface at the instantaneous sub-solar coordinate.
2. Solar eclipse / shadow-crossing indicators.
3. Rover traverse elevation profile tool between candidate landmarks.
4. Ground-station visibility toggle (Deep Space Network: Goldstone, Madrid, Canberra).
5. Shareable URL hash state encoding.

---

## 5. Candidate Region Dataset Status (`/regions.js`)
All coordinates are unverified placeholders awaiting official source publication:
1. `Peak near Cabeus B`: Lat -83.6°, Lon -68.8° (`status: "pending"`, Red flag: identical longitude to de Gerlache Rim 2).
2. `Haworth`: Lat -87.4°, Lon -5.1° (`status: "pending"`).
3. `Malapert Massif`: Lat -85.9°, Lon +2.9° (`status: "pending"`).
4. `Mons Mouton Plateau`: Lat -84.4°, Lon +31.7° (`status: "pending"`).
5. `Mons Mouton`: Lat -84.6°, Lon +29.5° (`status: "pending"`).
6. `Nobile Rim 1`: Lat -85.2°, Lon +53.3° (`status: "pending"`).
7. `Nobile Rim 2`: Lat -85.5°, Lon +37.8° (`status: "pending"`).
8. `de Gerlache Rim 2`: Lat -88.3°, Lon -68.8° (`status: "pending"`, Red flag: identical longitude to Peak near Cabeus B).
9. `Slater Plain`: Lat -88.1°, Lon +111.4° (`status: "pending"`).

---

## 6. Validation Tests to Write

The application's ephemeris and geometric calculations must pass the following automated test suite before release:
1. **South Pole Coordinate Invariance Test**: At selenographic latitude $-90.0^\circ$, Sun elevation must satisfy $\theta_{\odot} \approx -(\text{sub-solar latitude})$ and Earth elevation must satisfy $\theta_{\oplus} \approx -(\text{sub-Earth latitude}$, i.e., optical libration in latitude) within a tolerance of $0.3^\circ$ (accounting for observer surface parallax).
2. **Sub-Solar Latitude Obliquity Bound Test**: The computed $|\text{sub-solar latitude}|$ must never exceed $1.6^\circ$ throughout a 365-day simulation period.
3. **Extended Disc Horizon Boundary Test**: For a synthetic horizontal plane, the unblocked disc fraction must equal $1.0$ when the body center elevation $\theta_c > +R_{\text{disc}}$, must equal $0.0$ when $\theta_c < -R_{\text{disc}}$, and must equal $0.50 \pm 0.02$ when $\theta_c = 0.0^\circ$.
4. **Libration Periodicity Test**: Earth elevation computed at the South Pole over time must demonstrate an oscillation period matching the lunar draconic/anomalistic libration cycle ($\sim 27.2\text{–}27.5\text{ days}$) with observed peaks and troughs within nominal physical ranges.
