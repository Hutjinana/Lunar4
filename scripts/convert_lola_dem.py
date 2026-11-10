#!/usr/bin/env python3
"""
Convert the NASA PGDA LOLA south-polar DEM (LDEM_80S_80MPP_ADJ.TIF) into the
Float32 raster + metadata JSON that src/demLoader.js ingests.

Source : https://pgda.gsfc.nasa.gov/products/90  (Barker et al., 2023, PSJ 4, 183)
Input  : 7600 x 7600 float32, 80 m/pixel, metres above the 1737.4 km sphere,
         south polar stereographic, pixel-is-area, covers x,y = -304..+304 km.
Output : <out>.bin  Float32 little-endian, KILOMETRES, row 0 first as in the TIFF
         <out>.json metadata (see demLoader.js)

Processing: block-mean by FACTOR (default 4 -> 320 m/pixel). Nothing else is changed.

Orientation (verified against Shoemaker, Haworth and Malapert, see tests/lolaDem.js):
the TIFF's y axis is +rho*cos(lon) while the app's map y axis is -rho*cos(lon).
The TIFF's top row (y = +304 km) therefore IS the app's row 0 (y = -304 km), so the raster
is written unflipped.

Requires: numpy, tifffile, imagecodecs   (pip install numpy tifffile imagecodecs)
Usage   : python3 scripts/convert_lola_dem.py LDEM_80S_80MPP_ADJ.tiff [factor]
"""
import hashlib, json, os, sys
import numpy as np
import tifffile

src = sys.argv[1]
factor = int(sys.argv[2]) if len(sys.argv) > 2 else 4
out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data')

a = tifffile.imread(src).astype(np.float32)
assert a.shape == (7600, 7600), f'unexpected shape {a.shape}'
assert not np.isnan(a).any(), 'NaN present'
n = a.shape[0] // factor
assert n * factor == a.shape[0]
b = a.reshape(n, factor, n, factor).mean(axis=(1, 3), dtype=np.float64).astype(np.float32)
km = (b / 1000.0).astype('<f4')

m_per_px = 80.0 * factor
half_span_km = 304.0 - m_per_px / 2000.0          # centre of the outermost pixel
name = f'lola_south_pole_{int(m_per_px)}m'
bin_path = os.path.join(out_dir, name + '.bin')
km.tofile(bin_path)

h = hashlib.sha256()
with open(bin_path, 'rb') as f:
    h.update(f.read())
src_size = os.path.getsize(src)

meta = {
    'format': 'Float32',
    'mPerPixel': m_per_px,
    'width': n,
    'height': n,
    'centerLat': -90.0,
    'centerLon': 0.0,
    'halfSpanKm': half_span_km,
    'verticalScale': 1.0,
    'verticalOffsetKm': 0.0,
    'nodata': None,
    'source': 'NASA GSFC PGDA LOLA south-polar DEM, LDEM_80S_80MPP_ADJ (Barker et al., 2023, PSJ 4, 183, doi:10.3847/PSJ/acf3e1)',
    'license': 'NASA PGDA data usage policy: citation requested (Barker et al. 2023); no further terms stated on the product page',
    'dataDoi': '10.60903/gsfcpgda-lola-spole',
    'productUrl': 'https://pgda.gsfc.nasa.gov/products/90',
    'sourceFile': os.path.basename(src),
    'sourceFileBytes': src_size,
    'processing': f'{factor}x{factor} block mean of the 80 m grid; metres converted to kilometres; no flip; pixel-centre registration',
    'datum': 'kilometres above the 1737.4 km lunar reference sphere',
    'sha256': h.hexdigest(),
    'binBytes': os.path.getsize(bin_path),
    'zMinKm': float(km.min()),
    'zMaxKm': float(km.max()),
}
with open(os.path.join(out_dir, name + '.json'), 'w') as f:
    json.dump(meta, f, indent=2)
print(json.dumps(meta, indent=2))
