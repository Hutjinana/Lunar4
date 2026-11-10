/**
 * Artemis Lunar Landing Site Navigator - Global Configuration
 * 
 * Defines:
 * 1. DEM configuration (path, format metadata, fallback policy, banner)
 * 2. Default operational radii (slope evaluation radius, polar domain span)
 * 3. Exact visual design color palette and typographic standards
 * 4. Pinned external library versions for importmap verification
 */

export const CONFIG = {
  // 1. Digital Elevation Model (DEM) Specification
  dem: {
    // Expected real LOLA dataset paths (set to null if not provisioned)
    path: "./public/data/lola_south_pole_320m.bin",
    metadataPath: "./public/data/lola_south_pole_320m.json",
    fallbackToSynthetic: true, // if the files fail to load, the synthetic terrain and its banner are used
    bannerText: "“Illustrative terrain – not real LOLA data”", // shown ONLY while synthetic terrain is active
    subBannerText: "Synthetic digital elevation model for geometric trade-study demonstration",
    // Shown while the real LOLA DEM is active (text is completed from the DEM metadata)
    realBannerText: "LOLA terrain: LDEM_80S_80MPP_ADJ resampled to 320 m (Barker et al. 2023)",
    realSubBannerText: "Elevations relative to the 1737.4 km reference sphere; see Data & Methods for processing and limits",

    // Documented format standard for real LOLA binary ingestion
    documentedFormat: {
      types: ["Float32", "PNG16"],
      projection: "South Polar Stereographic (center: -90.0° lat, 0.0° lon)",
      referenceRadiusKm: 1737.4,
      nominalMetersPerPixel: 120.0,
      gridDimension: 1667, // ~200 km × 200 km at 120m/px
      halfSpanKm: 100.0,
      verticalUnit: "kilometers",
      nodataValue: -9999.0,
    },
  },

  // 2. Default Geometric Radii & Domain Bounds
  radii: {
    lunarRadiusKm: 1737.4,
    defaultSlopeRadiusKm: 3.0,
    minSlopeRadiusKm: 0.5,
    maxSlopeRadiusKm: 15.0,
    polarMeshGridSize: 513, // terrain mesh nodes per side (≈1.2 km per cell, ~524k triangles); 321 if a GPU struggles
    polarDomainSpanKm: 305.0, // ±305 km square: covers the full 80°S–90°S disc (80°S radius = 304.0 km)
  },

  // 3. Celestial Extended-Disc Angular Sizes (from lunar vantage)
  celestial: {
    sunAngularRadiusDeg: 0.265, // ~0.53° angular diameter
    earthAngularRadiusDeg: 1.00, // ~2.00° angular diameter seen from Moon (~1.90°–2.05°)
    lunarObliquityDeg: 1.5424, // Obliquity of lunar equator to ecliptic
  },

  // 4. Exact Visual Design Tokens (Rule 6)
  colors: {
    background: "#07090E",
    surface: "#0F172A",
    surfaceHover: "#1E293B",
    border: "#1E293B",
    borderSubtle: "#334155",
    accentCyan: "#06B6D4",
    accentAmber: "#F59E0B",
    accentCoral: "#F43F5E",
    accentEarthPath: "#7DB8FF", // Earth libration path in the Moon globe view (soft blue)
    textPrimary: "#E2E8F0",
    textSecondary: "#94A3B8",
    textMuted: "#64748B",
  },

  // 5. Pinned External Dependencies (Rule 1: allowed CDNs only)
  dependencies: {
    three: {
      version: "0.169.0",
      esmUrl: "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js",
      addonsUrl: "https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/",
    },
    astronomyEngine: {
      version: "2.1.19",
      esmUrl: "https://cdn.jsdelivr.net/npm/astronomy-engine@2.1.19/esm/astronomy.js",
    },
  },
};
