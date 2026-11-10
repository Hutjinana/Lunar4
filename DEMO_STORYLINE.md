# Artemis Lunar Landing Site Navigator — Two-Minute Demo Script

**Target Duration:** 90–120 seconds  
**Subject Comparison:** Malapert Massif (Elevated Ridge) vs. Haworth (Depression / Crater Rim)  
**Rule Compliance:** All quantitative values are formatted as `{placeholders}` to be populated exclusively from real-time application computations.

---

### Segment 1: Orbital Mechanics & Spatial Context (0:00 – 0:25)
- **Visual State:** Solar System Orrery View (`cameraMode: 'system'`)
- **Presenter Action:** 
  1. Click `Solar System Orrery` mode.
  2. Point out the Earth-Moon orbital plane, the sub-solar vector arrow in the Orrery, and the Moon’s $1.54^\circ$ obliquity to the ecliptic.
  3. Drag the mission time scrubber to `{elapsed_days}` days.
- **Spoken Script:**
  > "Welcome to the Artemis Lunar Landing Site Navigator. We begin in the Orrery View, labeled *Not to Scale*. Notice the Moon’s $1.54^\circ$ axial tilt. As we scrub time across `{elapsed_days}` days, observe how the sub-solar vector rotates around the equator, forcing the Sun to hover permanently near the horizon at the lunar South Pole. Because of this grazing geometry, solar illumination and Earth line-of-sight are dictated by local crater topography."

---

### Segment 2: South Polar Terrain & Regional Topography (0:25 – 0:50)
- **Visual State:** Lunar South Pole 3D View (`cameraMode: 'south_pole'`)
- **Presenter Action:**
  1. Click `South Pole 3D Terrain`.
  2. Note the persistent banner: `"{dem_banner_status}"`.
  3. Select **Malapert Massif** pin, then focus on **Haworth** pin.
- **Spoken Script:**
  > "Switching to the South Pole 3D view, we see the nine candidate landing regions announced by NASA, each approximately 15 by 15 kilometers. Notice the extreme topographic contrast: Malapert Massif rises to an elevation of `{malapert_elevation_km} km`, whereas Haworth crater drops into a polar depression at `{haworth_elevation_km} km`. All coordinates are currently tracked as pending official catalog delivery."

---

### Segment 3: Real-Time Computed Telemetry & Extended Disc Occlusion (0:50 – 1:15)
- **Visual State:** Selected Region Telemetry HUD
- **Presenter Action:**
  1. Click **Malapert Massif**. Point out the computed Sun elevation, unblocked solar disc fraction, Earth elevation, and unblocked Earth disc fraction.
  2. Highlight the Direct-to-Earth (DTE) comms ray (Cyan).
  3. Click **Haworth**. Point out the terrain occlusion and comms ray status (Coral/Red).
- **Spoken Script:**
  > "Selecting Malapert Massif at day `{current_epoch_day}`, the app computes a topocentric Sun elevation of `{malapert_sun_elev_deg}°` with an unblocked solar disc fraction of `{malapert_sun_disc_pct}%`. Earth sits at `{malapert_earth_elev_deg}°` elevation with an unblocked Earth disc fraction of `{malapert_earth_disc_pct}%`, yielding an active direct-to-Earth comms ray shown in cyan.
  > Now, selecting Haworth at the exact same epoch: the Sun drops below the local crater rim to `{haworth_sun_elev_deg}°` with `{haworth_sun_disc_pct}%` disc visibility, plunging the site into shadow. Earth elevation drops to `{haworth_earth_elev_deg}°` and is occluded by the rim ridge, turning the comms ray red."

---

### Segment 4: Slope Analysis, Multi-Criteria Trade-Off & Governance (1:15 – 1:45)
- **Visual State:** Region Comparison & Ranking Tab
- **Presenter Action:**
  1. Click `Region Comparison & Ranking` tab.
  2. Adjust the localized slope evaluation radius slider to `{selected_slope_radius_km} km`.
  3. Compare Malapert Massif mean slope (`{malapert_mean_slope}°`, 95th percentile `{malapert_p95_slope}°`) against Haworth (`{haworth_mean_slope}°`, 95th percentile `{haworth_p95_slope}°`).
  4. Adjust the weighting sliders for **Solar Illumination** (`{weight_sun}%`), **Earth Comms** (`{weight_earth}%`), and **Slope Flatness** (`{weight_slope}%`).
  5. Point to the mandatory NASA mission planning disclaimer.
  6. Conclude by highlighting the in-app `Data & Methods` tab.
- **Spoken Script:**
  > "In the Comparison tab, we evaluate the geometric trade-off within a localized `{selected_slope_radius_km} km` landing radius. Malapert Massif yields a 95th percentile slope of `{malapert_p95_slope}°` and scores `{malapert_composite_score}`, while Haworth scores `{haworth_composite_score}`. However, as stated in our NASA mission disclaimer: this tool evaluates geometry—NASA also weighs primary science objectives and launch-window flight dynamics, fully documented in our in-app Data & Methods tab."
