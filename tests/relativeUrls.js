/** Phase G8: GitHub Pages serves the app from a sub-path, so no asset URL may start with "/" (guard test). */
import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Root-absolute asset URLs: string literals / attributes starting with /src/, /public/ or /DATA_AND_METHODS
const BAD = /(["'`])\/(?:src\/|public\/|DATA_AND_METHODS)/;
// Local import specifiers and asset names, checked for exact upper/lower case (GitHub Pages is case-sensitive)
const REL_IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)(["'])(\.{1,2}\/[^"']+)\1/g;
const ASSET_REF = /(?:src|href)=["'](\.\/[^"']+)["']|["'](\.\/public\/[^"']+)["']/g;

async function exactCaseExists(abs) {
  // Walk each path segment and compare against the real directory listing (works on case-insensitive file systems too)
  const rel = path.relative(ROOT, abs).split(path.sep);
  let dir = ROOT;
  for (const seg of rel) {
    const names = await readdir(dir).catch(() => null);
    if (!names || !names.includes(seg)) return false;
    dir = path.join(dir, seg);
  }
  return true;
}

export async function runRelativeUrlsTest() {
  const t0 = performance.now();
  const measurements = [];
  let passed = true;
  const check = (label, ok) => { if (!ok) passed = false; measurements.push(`${label} [${ok ? 'PASS' : 'FAIL'}]`); };

  const files = ['index.html', 'config.js', 'regions.js'];
  for (const f of await readdir(path.join(ROOT, 'src'))) if (f.endsWith('.js')) files.push(`src/${f}`);

  const offenders = [], caseProblems = [];
  for (const f of files) {
    const text = await readFile(path.join(ROOT, f), 'utf8');
    text.split('\n').forEach((line, i) => { if (BAD.test(line)) offenders.push(`${f}:${i + 1}`); });
    const base = path.dirname(path.join(ROOT, f));
    for (const m of text.matchAll(REL_IMPORT)) {
      const abs = path.resolve(base, m[2]);
      if (!(await exactCaseExists(abs))) caseProblems.push(`${f}: ${m[2]}`);
    }
    for (const m of text.matchAll(ASSET_REF)) {
      const ref = (m[1] || m[2]).split('?')[0];
      if (!(await exactCaseExists(path.resolve(path.dirname(path.join(ROOT, f)), ref)))
        && !(await exactCaseExists(path.resolve(ROOT, ref)))) caseProblems.push(`${f}: ${ref}`);
    }
  }
  check(`No root-absolute asset URL (/src/, /public/, /DATA_AND_METHODS) in ${files.length} files${offenders.length ? ': ' + offenders.join(', ') : ''}`, offenders.length === 0);
  check(`Every relative import / asset reference matches a real file with exact letter case${caseProblems.length ? ': ' + caseProblems.join(', ') : ''}`, caseProblems.length === 0);

  const { CONFIG } = await import('../config.js');
  for (const p of [CONFIG.dem.path, CONFIG.dem.metadataPath]) {
    check(`DEM URL "${p}" is relative and the file exists with exact case`, p.startsWith('./') && await exactCaseExists(path.resolve(ROOT, p)));
  }
  for (const f of ['earth_day.jpg', 'earth_specular.jpg', 'earth_normal.jpg', 'earth_clouds.png', 'moon.jpg', 'moon_lroc_color_4k.jpg']) {
    check(`Texture public/textures/${f} exists with exact case`, await exactCaseExists(path.join(ROOT, 'public', 'textures', f)));
  }
  check('DATA_AND_METHODS.md exists at the root', await exactCaseExists(path.join(ROOT, 'DATA_AND_METHODS.md')));
  await access(path.join(ROOT, '.nojekyll')).then(() => check('.nojekyll exists at the repository root', true), () => check('.nojekyll exists at the repository root', false));

  return {
    id: 'test-relative-urls',
    name: 'Phase G8: relative asset URLs for GitHub Pages sub-path hosting',
    passed,
    timeMs: (performance.now() - t0).toFixed(2),
    description: 'Scans index.html, config.js, regions.js and src/*.js for root-absolute asset URLs; checks exact letter case of imports and assets; .nojekyll present.',
    criteria: 'No string literal starts with /src/, /public/ or /DATA_AND_METHODS; relative imports and assets match real file names exactly (GitHub Pages is case-sensitive)',
    measurements,
  };
}
