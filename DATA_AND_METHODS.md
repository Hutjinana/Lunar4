# Data & Methods: Artemis Lunar Landing Site Navigator

**Document Audience:** Aerospace Engineers & Planetary Scientists  
**Review Edition:** NASA Space Apps Challenge 2026  
**Date:** October 31, 2026  

This document describes the mathematical formulation, coordinate systems, optical and physical ephemeris algorithms, and topographic ray-marching methods implemented in the Artemis Lunar Landing Site Navigator.

---

## 1. Data Sources & Licensing

| Dataset / Component | Stated Source | Source URL | Declared License | Status / Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Artemis III 9 Candidate Regions** | NASA Headquarters Announcement (Oct 28, 2024) | https://www.nasa.gov/news-release/nasa-identifies-nine-candidate-landing-regions-for-artemis-iii/ | Public Domain (US Gov Work) | Official regional names confirmed; regional dimensions approx. $15 \times 15\text{ km}$ ([NASA Release 22-088](https://www.nasa.gov/news-release/nasa-identifies-candidate-regions-for-additional-artemis-lunar-landings/)). Point coordinates are currently pending official source delivery. |
| **Digital Elevation Model (DEM)** | NASA GSFC PGDA, LOLA south-polar DEM `LDEM_80S_80MPP_ADJ` (Barker et al. 2023, Planet. Sci. J. 4, 183, doi:10.3847/PSJ/acf3e1; data DOI 10.60903/gsfcpgda-lola-spole) | https://pgda.gsfc.nasa.gov/products/90 | Citation requested; no further terms stated on the product page | Resampled 4×4 to 320 m (see Section 6a). If the files fail to load, the app runs on synthetic terrain with the mandatory banner. |
| **Ephemeris & Libration Algorithms** | Astronomy Engine (`astronomy-engine` / Don Cross) | https://github.com/cosinekitty/astronomy | MIT License | Provides Moon-fixed optical and physical libration vector formulation (`Astronomy.Libration`). |
| **Orrery body textures** | Three.js example textures (`earth_atmos_2048`, `earth_specular_2048`, `earth_normal_2048`, `earth_clouds_1024`, `moon_1024`), https://github.com/mrdoob/three.js/tree/r169/examples/textures/planets | https://github.com/mrdoob/three.js | MIT (repository licence); original imagery provenance not independently checked | Decorative surface pictures for the Orrery view only; no number in the app is derived from them. Copies live in `public/textures/`; if they fail to load the Orrery falls back to a procedural Earth and a plain grey Moon. The Sun's photosphere (granulation, spots, limb darkening) is procedural and illustrative. |
| **Three.js 3D Engine** | Three.js Authors (pinned version: `0.174.0`) | https://cdn.jsdelivr.net/npm/three@0.174.0/ | MIT License | 3D WebGL rendering pipeline loaded via native ES module importmap. |

---

## 2. Coordinate Systems & Celestial Vector Derivations

### 2.1 Moon-Fixed Selenographic Reference Frame ($S$)
The Moon-fixed selenographic frame is defined with its origin at the lunar center of mass:
- $+\hat{Z}_M$: Directed along the mean lunar rotational axis toward the North Pole ($+90^\circ\text{N}$).
- $+\hat{X}_M$: Lies in the lunar equatorial plane directed toward the mean sub-Earth point ($0^\circ\text{ lat}, 0^\circ\text{ lon}$).
- $+\hat{Y}_M = \hat{Z}_M \times \hat{X}_M$: Completes the right-handed Cartesian frame directed toward $+90^\circ\text{E}$ longitude.

A surface observer at selenographic latitude $\phi$, longitude $\lambda$, and local terrain elevation $h$ above the mean lunar reference radius ($R_M = 1737.400\text{ km}$) has Moon-centered position:
$$\vec{r}_{\text{obs}} = (R_M + h) \begin{bmatrix} \cos\phi \cos\lambda \\ \cos\phi \sin\lambda \\ \sin\phi \end{bmatrix}$$

### 2.2 Local Topocentric Horizon Basis ($\hat{u}, \hat{e}, \hat{n}$)
At the observer location $(\phi, \lambda)$, a local orthonormal topocentric basis is constructed:
- **Up (Zenith) Vector**:
  $$\hat{u} = \begin{bmatrix} \cos\phi \cos\lambda \\ \cos\phi \sin\lambda \\ \sin\phi \end{bmatrix}$$
- **East Vector**:
  $$\hat{e} = \begin{bmatrix} -\sin\lambda \\ \cos\lambda \\ 0 \end{bmatrix}$$
- **North Vector**:
  $$\hat{n} = \hat{u} \times \hat{e} = \begin{bmatrix} -\sin\phi \cos\lambda \\ -\sin\phi \sin\lambda \\ \cos\phi \end{bmatrix}$$

### 2.3 Sun Direction Vector in Moon-Fixed Frame
The Sun's direction vector in the Moon-fixed frame accounts for the Moon's $1.5424^\circ$ obliquity to the ecliptic:
1. Sub-solar longitude $\lambda_{\odot}(t)$ traverses $360^\circ$ over the synodic month ($T_{\text{syn}} \approx 29.530589\text{ days}$).
2. Sub-solar latitude $\phi_{\odot}(t)$ oscillates annually due to lunar axial tilt:
   $$\phi_{\odot}(t) = 1.542^\circ \sin\left(\frac{2\pi (t - t_0)}{365.2422}\right)$$
The geocentric/selenocentric direction vector is:
$$\hat{r}_{\odot} = \begin{bmatrix} \cos\phi_{\odot} \cos\lambda_{\odot} \\ \cos\phi_{\odot} \sin\lambda_{\odot} \\ \sin\phi_{\odot} \end{bmatrix}$$
Because the Sun's distance ($1\text{ AU} \approx 1.496 \times 10^8\text{ km}$) is immense relative to $R_M$, topocentric parallax for the Sun is negligible ($< 0.001^\circ$).

### 2.4 Earth Direction Vector & Topocentric Parallax Correction
Earth's position relative to the Moon's center of mass is governed by optical and physical librations, as formulated in `astronomy-engine`'s `Astronomy.Libration(time)` method:
1. **Libration in Longitude ($l$)** and **Libration in Latitude ($b$)** determine the sub-Earth point $(\phi_{\oplus}, \lambda_{\oplus})$ on the lunar surface.
   * *Typical maximum libration amplitudes are $\pm 6.7^\circ$ in latitude and $\pm 8.0^\circ$ in longitude, for context only; the app computes libration from the ephemeris and does not use these values as inputs.*
2. **Topocentric Correction (Parallax)**:
   Because Earth is located at a finite distance ($D_{\oplus} \approx 384,400\text{ km} \approx 221 R_M$), an observer on the lunar surface is displaced by $\vec{r}_{\text{obs}}$ from the Moon's center. The topocentric vector directed from the surface observer to Earth is:
   $$\vec{d}_{\oplus} = D_{\oplus} \hat{r}_{\oplus,\text{center}} - \vec{r}_{\text{obs}}, \quad \hat{d}_{\oplus} = \frac{\vec{d}_{\oplus}}{\|\vec{d}_{\oplus}\|}$$
   This topocentric correction introduces a parallax shift of up to $\arcsin(R_M / D_{\oplus}) \approx 0.26^\circ$, which is critical when Earth sits near the local horizon.

3. **Topocentric Elevation & Azimuth**:
   $$\theta = \arcsin(\hat{d} \cdot \hat{u})$$
   $$\psi = \operatorname{atan2}(\hat{d} \cdot \hat{e}, \, \hat{d} \cdot \hat{n}) \pmod{360^\circ}$$
   The application computes Earth elevation dynamically from these equations and displays the observed numerical range rather than asserting a hard-coded static interval.

### 2.5 South Polar Stereographic Map Projection & Azimuth Direction Transformation
The application models the lunar south polar region using a polar stereographic projection standard:
- Map coordinates:
  $$x = \rho \sin\lambda, \quad y = -\rho \cos\lambda$$
  where $\rho$ is the radial distance from the South Pole ($+90^\circ\text{S}$) in kilometers, and $\lambda$ is selenographic east longitude.
- Scene coordinates $(X, Z)$ in Three.js correspond to $(x, -y)$:
  $$X = \rho \sin\lambda, \quad Z = \rho \cos\lambda$$

**Local Topocentric Azimuth Transformation:**
Topocentric azimuth $\psi$ is measured clockwise from Local North (directed radially outward from the South Pole along the observer's local meridian).
- Local North unit vector in scene $(X, Z)$:
  $$\hat{N} = (\sin\lambda, \, \cos\lambda)$$
- Local East unit vector in scene $(X, Z)$:
  $$\hat{E} = (\cos\lambda, \, -\sin\lambda)$$

Any horizontal topocentric unit vector with azimuth $\psi$ decomposed into $\cos\psi \hat{N} + \sin\psi \hat{E}$ yields:
$$\begin{aligned}
X &= \cos\psi \sin\lambda + \sin\psi \cos\lambda = \sin(\psi + \lambda) \\
Z &= \cos\psi \cos\lambda - \sin\psi \sin\lambda = \cos(\psi + \lambda)
\end{aligned}$$
In map coordinates $(x, y)$, where $y = -Z$, the direction vector is:
$$\vec{v}_{\text{map}} = (\sin(\psi + \lambda), \, -\cos(\psi + \lambda))$$

This fundamental transformation is implemented in the pure shared module `src/mapGeometry.js` (`azimuthToMapDirection`) and applied consistently across:
1. Topographic Horizon Ray-Marching (`src/horizon.js`).
2. 3D Line-of-Sight Comms Ray & Earth Globe orientation (`src/scene.js`).
3. Polar Sun directional light vector orientation (`src/scene.js`).

---

## 3. Horizon Profile Construction by Ray Marching

Along any azimuth direction $\psi$, the local terrain horizon mask $\theta_{\text{mask}}(\psi)$ is evaluated by marching rays across the Digital Elevation Model (DEM):
1. Radial steps of size $\Delta \rho$ are sampled along the ground track from distance $\rho_{\min}$ to $\rho_{\max}$.
2. At each sample point $k$, the Cartesian coordinate $(x_k, y_k)$ is projected to determine local terrain elevation $z(\rho_k)$.
3. Accounting for lunar spherical curvature, the apparent elevation angle of the terrain element is:
   $$\theta_k(\psi) = \arctan\left(\frac{z(\rho_k) - z_0}{\rho_k}\right) - \frac{\rho_k}{2 R_M}$$
4. The local horizon mask is the maximum angular elevation along the ray:
   $$\theta_{\text{mask}}(\psi) = \max_{k} \theta_k(\psi)$$

---

## 4. Extended-Disc Fraction Integration

### 4.1 Physical Rationale
At polar latitudes ($84^\circ\text{S}$ to $90^\circ\text{S}$), both the Sun and the Earth sit only a few degrees above the local tangent plane. Consequently, partial occlusion by distant crater rims is physically dominant:
- **Solar Disc**: Subtends an angular diameter of approximately $\delta_{\odot} \approx 0.53^\circ$ ($\text{radius } R_{\odot} \approx 0.265^\circ$).
- **Earth Disc**: Subtends an angular diameter of approximately $\delta_{\oplus} \approx 1.90^\circ\text{–}2.05^\circ$ ($\text{radius } R_{\oplus} \approx 1.00^\circ$).

Point-source approximations cause unphysical binary blinking. The 3D scene and its labels therefore evaluate the unblocked area fraction of the extended circular disc (this section). Mission Metrics and Comparison deliberately use a different, binary model; see 4.5.

### 4.2 Analytical Formulation
Let $\theta_c$ denote the topocentric elevation of the body's center, and let $R_{\text{disc}}$ denote its angular radius. The normalized height offset of the horizon mask relative to the disc center is:
$$\xi = \frac{\theta_{\text{mask}} - \theta_c}{R_{\text{disc}}}$$

The unblocked fraction $f \in [0.0, 1.0]$ is computed as:
$$f = \begin{cases}
1.0, & \xi \le -1.0 \quad \text{(Disc fully above horizon mask)} \\
0.0, & \xi \ge +1.0 \quad \text{(Disc fully below horizon mask)} \\
\frac{1}{\pi} \left[ \arccos(\xi) - \xi \sqrt{1 - \xi^2} \right], & -1.0 < \xi < 1.0 \quad \text{(Partial occlusion)}
\end{cases}$$

- **Solar Illumination**: Defined as $f_{\odot} \in [0.0, 1.0]$.
- **Earth Line-of-Sight Visibility**: Defined as $f_{\oplus} \in [0.0, 1.0]$.

### 4.3 Numerical Quadrature: 64-Strip Midpoint Consistent Rule
In runtime evaluation (`src/horizon.js`), `computeUnblockedDiscFraction` evaluates the extended disc against the discrete 720-bin horizon elevation profile $\theta_{\text{mask}}(\psi)$:
1. Discretizes the circular disc width $[-R_{\text{disc}}, +R_{\text{disc}}]$ into $M = 64$ vertical strips of width $\Delta x = 2 R_{\text{disc}} / M$ using a 64-strip midpoint rule.
2. At each strip midpoint $x_i = -R_{\text{disc}} + (i + 0.5) \Delta x$, the geometric chord height is:
   $$y_{\max}(x_i) = \sqrt{R_{\text{disc}}^2 - x_i^2}, \quad \text{chord}_i = 2 y_{\max}(x_i)$$
3. **Azimuth-Offset Convergence Correction**:
   To account for spherical coordinate meridian convergence at elevation $\theta_c$, the azimuth across slice $x_i$ is offset by:
   $$\psi_i = \psi_c + \frac{x_i}{\cos\theta_c}$$
   The local terrain horizon mask $\theta_{\text{mask}}(\psi_i)$ is sampled with linear interpolation from the 720-bin horizon mask.
4. **Consistent Quadrature**:
   Both the unblocked chord height sum and the total disc chord height sum are accumulated across the identical 64-strip midpoint discretization:
   $$\text{unblocked}_i = \operatorname{clamp}\Big((\theta_c + y_{\max}) - \max\big(\theta_{\text{mask}}(\psi_i), \, \theta_c - y_{\max}\big), \, 0, \, 2 y_{\max}\Big)$$
   $$f = \frac{\sum_{i=0}^{M-1} \text{unblocked}_i}{\sum_{i=0}^{M-1} \text{chord}_i}$$
   Because numerator and denominator share the identical discrete grid, a completely unblocked disc evaluates to identically $1.000000$ and a fully occluded disc evaluates to identically $0.000000$ without artificial clamping discontinuities.

### 4.4 Measured Numerical Accuracy
In automated verification tests (`tests/suite.js` / `npm test`), this 64-strip midpoint quadrature is benchmarked directly against a $1000 \times 1000$ (1,000,000-point) 2D brute-force grid numerical integration reference:
- On flat terrain masks ($0.0^\circ$): maximum observed absolute error $\Delta_{\max} = 0.0003$.
- On sloped terrain masks ($\theta_{\text{mask}}(\psi) = 0.3\sin\psi$ across azimuths 0°, 45°, 90°, 180°, 270°): maximum observed absolute error $\Delta_{\max} = 0.0001$.
- Fully clear limit: $1.000000$ ($\Delta = 0.000000$, tolerance $10^{-6}$).
- Fully blocked limit: $0.000000$ ($\Delta = 0.000000$, tolerance $10^{-6}$).
- Monotonicity: Strictly non-increasing across 200 sequential elevation steps descending from $+1.5^\circ$ to $-1.5^\circ$.

The horizon profile is only as accurate as the DEM, and on synthetic terrain the visibility numbers are illustrative.

### 4.5 Two illumination models
The app uses two illumination models on purpose; they answer different questions.
- **Scene visuals and labels** (Earth "visible NN%", Sun lit state, ray colour) use the extended-disc unblocked fraction $f$ from 4.2–4.3, so a rim that is crossing the disc shows as PARTIAL instead of blinking.
- **Mission Metrics and Comparison** (`src/missionMetrics.js`) use the binary centre-point model of the architecture guide: $I(t) = 1$ if $\alpha_{\text{sun}} > \theta_{\text{horizon}}(\text{az}_{\text{sun}})$, else $0$, and $C(t) = 1$ if $\alpha_{\text{earth}} > \theta_{\text{horizon}}(\text{az}_{\text{earth}})$, else $0$. Only the centre of the Sun or Earth is tested against the horizon mask.
- **Size of the difference**: near sunrise and sunset the two models disagree by roughly the time the Sun's disc needs to cross the horizon mask (about 0.53° of elevation change). That is small compared with multi-day dark intervals, and the binary model's errors partly cancel over a window, because an early start and a late end of a lit period are about equally likely. The same reasoning applies to Earth visibility.
- **Consequence**: a label can say PARTIAL while the metrics count that same sample as fully lit (centre above the mask) or fully dark (centre below it). This is expected, not a bug. Energy, longest dark interval and DTE coverage always follow the binary model.

---

## 5. Local Terrain Slope Formulation

### 5.1 Radial Evaluation Rationale
Slope is evaluated within a localized radial radius around prospective landing targets rather than averaged over an entire candidate region because touchdown safety, tip-over hazards, and surface mobility limits depend on immediate local terrain gradients, whereas whole-region averages dilute steep crater rim walls and localized escarpments. The evaluation radius is user-adjustable from $0.5\text{ to }15.0\text{ km}$ (default: $3.0\text{ km}$).

### 5.2 Mathematical Formulation
Slopes are computed using central differences on the DEM grid:
$$\frac{\partial z}{\partial x} \approx \frac{z(i+1, j) - z(i-1, j)}{2 \Delta x}, \quad \frac{\partial z}{\partial y} \approx \frac{z(i, j+1) - z(i, j-1)}{2 \Delta y}$$
$$\text{Slope}(i, j) = \arctan\left(\sqrt{\left(\frac{\partial z}{\partial x}\right)^2 + \left(\frac{\partial z}{\partial y}\right)^2}\right)$$

For all $N$ grid nodes lying within ground distance $r \le R_{\text{eval}}$ from the region center:
1. **Mean Slope ($\mu_{\text{slope}}$)**:
   $$\mu_{\text{slope}} = \frac{1}{N} \sum_{k=1}^N \text{Slope}_k$$
2. **95th Percentile Slope ($P_{95}$)**:
   The slope value below which $95\%$ of sample nodes fall. $P_{95}$ characterizes hazardous steep slopes while rejecting single-pixel altimetry laser noise spikes that corrupt maximum-slope metrics.

---

## 6. Physical Assumptions

1. **Vacuum Propagation**: Lunar atmospheric refraction is identically zero.
2. **Spherical Reference Datum**: Lunar reference radius $R_M = 1737.400\text{ km}$ with radial topographic relief.
3. **Geometric Line-of-Sight**: Direct radio visibility assumes geometric clearance without tropospheric refraction or knife-edge diffraction.
4. **Uniform Disc Radiance**: Sun and Earth discs are modeled with uniform radiance; limb darkening and terrestrial cloud heterogeneity are omitted for geometric analysis.


## 6a. Terrain Data Processing & Limits

- **Source:** LOLA gridded DEM, 80°S–90°S, 80 m/pixel, polar stereographic on a 1737.4 km sphere, heights in metres above that sphere (pixel-is-area, ±304 km).
- **Processing (`scripts/convert_lola_dem.py`):** 4×4 block mean to 320 m (1900×1900 pixels, ±303.84 km to the outer pixel centres), metres converted to kilometres, nothing else altered. The SHA-256 of the result is stored in the metadata and re-checked by the test suite.
- **Orientation:** the file's y axis is $+\rho\cos\lambda$ while the app's map y axis is $-\rho\cos\lambda$, so the raster is used unflipped. Verified with landmarks (Shoemaker and Haworth are deep, Malapert is high).
- **Outside the raster:** the square mesh is slightly larger than the 80°S disc, so samples beyond the raster hold the edge value.
- **Measured effect of the 320 m resample** (9 regions vs the native 80 m grid; 3 km slope radius, 60 km horizon range): region elevations differ by ≤10 m; mean slope by ≤0.3° and P95 slope by ≤0.7°; the horizon elevation differs by 0.13° on average (0.02–0.27° by region) and by up to 1.1° in a single azimuth bin. That is comparable to the Sun's 0.265° angular radius, so solar and Earth disc fractions for grazing geometry are approximate at this resolution. Resampling to 160 m (`convert_lola_dem.py … 2`, 58 MB) reduces these horizon differences to 0.044° mean and 0.45° worst bin.
- **Surface picture:** the colour of the 3D terrain is derived from the DEM itself, not from imagery. Brightness rises with local slope (steep walls expose fresher, brighter regolith) and slightly with elevation (crater floors are a little darker); one 2048² texture (0.30 km per pixel, matching the 320 m DEM) covers the whole mesh. No shadows are baked into it: direct light comes from the live Sun vector and the mesh normals. This is an illustrative visual cue, not a measured albedo.
- **Mesh:** 513×513 nodes (≈1.2 km per cell, 524,288 triangles) over ±305 km. Mesh rows are ordered so that the terrain lines up with the pins and graticule (map y = −span sits at scene z = +span); Test 18 checks this against the rendered geometry.
- **Other limits:** the DEM is a gridded product with its own height errors (see the PGDA `_ERR` product); no uncertainty is propagated here.
---

## 7. Honest Limitations List

1. **DEM Spatial Resolution Limits**:
   - Downsampled DEM grids cannot resolve micro-craters ($<50\text{ m}$), boulder fields, or fine surface roughness that alter grazing illumination and line-of-sight.
2. **Absence of Regolith & Boulder Hazard Modeling**:
   - The tool does not model regolith load-bearing capacity, mechanical compaction, or boulder distributions.
3. **Absence of Landing Vehicle Constraints**:
   - Touchdown gear slope limits ($6^\circ\text{–}12^\circ$), landing plume ground erosion, and propellant thermal boil-off are not modeled.
4. **Absence of Science-Value Modeling**:
   - The ranking engine evaluates geometric suitability only; it does not evaluate volatile concentrations, geologic stratigraphic exposure, or South Pole-Aitken basin ejecta provenance.
5. **Pending Regional Coordinates**:
   - Region centers in `/regions.js` are unverified placeholders awaiting official NASA catalog delivery.
6. **Procedural Surface Detail (synthetic terrain only)**:
   - Besides the named craters and massifs, the synthetic DEM adds seeded generic craters (power-law size distribution, fresh to degraded), broad hills and rolling noise so the surface looks lunar. These features are illustrative and do not correspond to real lunar landforms; local slopes and horizons near them are not real.

---

## 7a. Picking Your Own Point

- **Valid domain:** latitude 80–90 °S and longitude −180 to 180 °E (east positive). Anything else is rejected with an inline message; values are never clamped.
- **Entry:** type Lat (°S) and Lon (°E) in the "Pick a point" form and press Analyse (or Enter), or click the terrain in the South Pole view. A click counts only if the pointer moved less than 4 px since the button was pressed, so orbit-dragging never picks; clicking an existing region pin still selects that region.
- **Click to lat/lon:** the terrain hit is converted to kilometres with the inverse of the pin mapping ($x = k_X \cdot s$, $z = -k_Y \cdot s$) and then to latitude/longitude by the inverse polar stereographic projection. The terrain mesh covers the full ±305 km square, so clicks work over the whole 80–90 °S disc; the square's corners lie beyond 80 °S and are rejected.
- **What it is:** a picked point is a "User-picked point", not a candidate region. It uses the same ephemeris, horizon and Earth-elevation pipeline as the nine regions but never appears in the comparison table, ranking or region counts, and it carries no rank.
- **Terrain:** results for a picked point use whichever terrain is active (the LOLA DEM, or the synthetic fallback with its illustrative-terrain disclaimer) and inherit its limits (Section 6a).

---

## 8. 3D Scene Visualization: Earth Globe & Comms Ray

### 8.1 Apparent Angular Size & Radial Scaling
Viewed from the lunar surface, Earth subtends an angular diameter of $\approx 1.9^\circ\text{–}2.0^\circ$ (apparent angular radius $\alpha_{\oplus} \approx 1.00^\circ$).
To accurately depict Earth's visual disc in the 3D South Pole scene:
- The comms ray originates at the selected region's surface coordinates and extends outward by length $L = 55\text{ km}$ along the topocentric Earth unit vector $(\sin(\psi+\lambda)\cos\theta, \, \sin\theta, \, \cos(\psi+\lambda)\cos\theta)$.
- The textured Earth globe is positioned at the ray terminus with physical radius:
  $$r_{\text{mesh}} = L \tan(1.00^\circ) \approx 55 \times 0.017455 \approx 0.960\text{ scene units}$$
This guarantees that an observer looking down the comms ray observes Earth at its true lunar-sky angular diameter ($\approx 2^\circ$).

### 8.2 Axial Tilt, Diurnal Rotation, and Phasing
1. **Axial Tilt**: Earth is inclined by its obliquity $\epsilon = 23.44^\circ$.
2. **Diurnal Rotation**: Rotates around its polar axis according to UTC ephemeris time.
3. **Phasing**: The globe is illuminated by the polar Sun directional light, accurately reproducing lunar sky Earth phases (e.g., crescent Earth, gibbous Earth).
4. **Occlusion & Sub-Horizon Styling**:
   - When line-of-sight is clear ($f_{\oplus} \ge 0.95$), the ray is drawn as a solid cyan line.
   - When partially or fully occluded ($f_{\oplus} < 0.95$), the ray is drawn as a dashed line with color linearly interpolated between Cyan (`#06B6D4`) and Coral (`#F43F5E`).
   - If Earth's center is below the geometric horizon ($\theta < 0^\circ$), the globe opacity is dimmed to $35\%$ and labeled `"BELOW HORIZON"`.

### 8.3 Orrery: Earth's Orbit Around the Sun

The Orrery draws Earth's heliocentric orbit as an ellipse centred on the Sun, $r(L)=a(1-e^2)/(1+e\cos(L-\varpi))$ with $e=0.0167086$ and $\varpi=102.9472^\circ$ (J2000 ecliptic). The Sun is placed at its ephemeris distance (Astronomy Engine, in AU) scaled by 130 scene units per AU, so Earth sits on the ring. Scene axes: ecliptic longitude $\lambda \mapsto (\cos\lambda,\ \sin\beta,\ -\sin\lambda)$ (right-handed, $+y$ = ecliptic north); Earth's axis is tilted by the obliquity toward $\lambda = 90^\circ$ and spins by GMST. Sizes and the Earth-Moon distance are exaggerated ([NOT TO SCALE]); the "Orbit" camera preset frames the whole ring.
