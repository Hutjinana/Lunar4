/**
 * Artemis III candidate regions (9).
 *
 * COORDINATE PROVENANCE (checked 2026-11-06 against each Orrery Space page, 4-decimal "Facts" value):
 * status "sourced" = a source is cited and the value was transcribed and re-checked. It does NOT mean
 * "verified against NASA". Do not change any lat/lon without a cited source.
 *
 * kind:
 *  - "region_centre"  : LROC mosaic centre of the candidate region (NAC ROI)
 *  - "candidate_site" : specific candidate landing site from Wueller et al. 2026 (Zenodo 17084058).
 *                       Orrery Space states this is NOT a region centre.
 * The UI must always show the kind next to the coordinates.
 *
 * Order is significant (tests use REGIONS[2] = Malapert Massif). Do not reorder.
 */

const ORRERY = 'https://orreryspace.com/landing-sites/';
const LOLA = 'https://pds-geosciences.wustl.edu/missions/lro/lola.htm';
const ZENODO = 'https://zenodo.org/records/17084058';
const LROC = 'https://data.lroc.im-ldi.com/lroc/view_rdr/';

export const REGIONS = [
  {
    id: 'peak-near-cabeus-b', name: 'Peak near Cabeus B',
    lat: -83.6, lon: -68.8, kind: 'region_centre',
    source: 'LROC NAC ROI mosaic centre (via Orrery Space)',
    source_url: LROC + 'NAC_ROI_CABEUSPKLOB',
    reference_url: ORRERY + 'cabeus-b-peak/', status: 'sourced'
  },
{
  id: 'haworth', name: 'Haworth',
  lat: -86.7, lon: -23.7, kind: 'region_centre',
  source: 'LROC NAC ROI mosaic centre (via Orrery Space)',
  source_url: LROC + 'NAC_ROI_HAWORTH_LO1',
  reference_url: ORRERY + 'haworth/', status: 'sourced'
},
{
  id: 'malapert-massif', name: 'Malapert Massif',
  lat: -86.0, lon: 0.3, kind: 'region_centre',
  source: 'LROC NAC ROI mosaic centre (via Orrery Space)',
  source_url: LROC + 'NAC_ROI_MALAPERTLO1',
  reference_url: ORRERY + 'malapert-massif/', status: 'sourced'
},
{
  id: 'mons-mouton-plateau', name: 'Mons Mouton Plateau',
  lat: -84.3, lon: 30.6, kind: 'region_centre',
  source: 'LROC NAC ROI mosaic centre (via Orrery Space)',
  source_url: LROC + 'NAC_ROI_MOUTNPLTLOA',
  reference_url: ORRERY + 'mons-mouton-plateau/', status: 'sourced'
},
{
  id: 'mons-mouton', name: 'Mons Mouton (MMO01)',
  lat: -85.416, lon: 31.8506, kind: 'candidate_site',
  source: 'Wueller et al. 2026, site MMO01 (via Orrery Space)',
  source_url: ZENODO,
  reference_url: ORRERY + 'mons-mouton/', status: 'sourced'
},
{
  id: 'nobile-rim-1', name: 'Nobile Rim 1 (NR101)',
  lat: -85.295, lon: 36.9168, kind: 'candidate_site',
  source: 'Wueller et al. 2026, site NR101 (via Orrery Space)',
  source_url: ZENODO,
  reference_url: ORRERY + 'nobile-rim-1/', status: 'sourced'
},
{
  id: 'nobile-rim-2', name: 'Nobile Rim 2',
  lat: -83.9, lon: 58.7, kind: 'region_centre',
  source: 'LROC NAC ROI mosaic centre (via Orrery Space)',
  source_url: LROC + 'NAC_ROI_NOBILE02LOC',
  reference_url: ORRERY + 'nobile-rim-2/', status: 'sourced'
},
{
  id: 'de-gerlache-rim-2', name: 'de Gerlache Rim 2 (dGR2_K2023)',
  lat: -88.45, lon: -67.8591, kind: 'candidate_site',
  source: 'Wueller et al. 2026, site dGR2_K2023 (via Orrery Space)',
  source_url: ZENODO,
  reference_url: ORRERY + 'de-gerlache-rim-2/', status: 'sourced'
},
{
  id: 'slater-plain', name: 'Slater Plain (SP07)',
  lat: -87.1306, lon: 127.857, kind: 'candidate_site',
  source: 'Wueller et al. 2026, site SP07 (via Orrery Space)',
  source_url: ZENODO,
  reference_url: ORRERY + 'slater-plain/', status: 'sourced'
}
];

export const LOLA_REFERENCE_URL = LOLA;

/** "86.7000°S, 23.7000°W" */
export function formatRegionCoords(r) {
  const ns = r.lat < 0 ? 'S' : 'N';
  const ew = r.lon < 0 ? 'W' : 'E';
  return `${Math.abs(r.lat).toFixed(4)}°${ns}, ${Math.abs(r.lon).toFixed(4)}°${ew}`;
}

/** Label shown beside coordinates; must never be hidden. */
export function regionKindLabel(r) {
  if (r.kind === 'user_point') return 'User-picked point (not a candidate region)';
  return r.kind === 'region_centre' ? 'Region centre (LROC mosaic)' : 'Candidate site (not region centre)';
}

/** "sourced" is not "verified". */
export function regionStatusLabel(r) {
  if (r.status === 'user_defined') return 'User-defined';
  return r.status === 'sourced' ? 'Sourced – not NASA-verified' : 'Pending';
}
