/**
 * Artemis Lunar Landing Site Navigator - CSS Class Audit Regression Test
 * 
 * Extracts every class used across index.html and src/*.js.
 * Verifies that all classes are defined in the stylesheets (src/tailwind.generated.css + src/index.css)
 * or are explicitly documented in the JS-hook allow-list.
 * 
 * Also asserts that critical display and responsive rules exist:
 * - .hidden { display: none; }
 * - lg:hidden
 * - lg:flex
 */

export const ALLOW_LIST = {
  // Navigation tab button hook: tracked by JS to manage active tab highlight
  'active': 'JS state hook for active button styling logic',
  // Header container hook: used by DOM queries to identify main app header
  'app-header': 'Semantic JS DOM query hook for top application header',
  // Regional table row selection button: bound to click handlers in dock comparison
  'btn-dock-table-region': 'Event delegation hook for region selection in dock table',
  // Navigation tab switcher: used to bind click handlers for switching tabs
  'nav-tab': 'Event delegation hook for primary header navigation buttons',
  // Top disclaimer banner: used by JS to position top elements below the fixed banner
  'persistent-disclaimer-banner': 'DOM identifier hook for fixed disclaimer banner height calculation',
  // Preset weight buttons: used for trade study ranking preset quick-selection
  'rank-preset-btn': 'Event hook for trade study ranking preset buttons',
  // Regional list item: used for click selection and camera targeting
  'region-item': 'Event delegation hook for candidate region list items',
  // Slope radius filter button: used to select slope evaluation radius (0.5 - 15 km)
  'slope-rad-btn': 'Event hook for localized terrain slope radius buttons',
  // Sort indicator icon: manipulated by JS to show ascending/descending arrows
  'sort-icon': 'DOM hook for table column sort direction arrows',
  // Sortable table header cell: clicked to trigger column re-sorting
  'sortable-th': 'Event hook for sortable columns in regional comparison table',
  // Time span button: clicked to toggle simulation time window (30d, 90d, 180d, 365d)
  'span-btn': 'Event hook for simulation time span selection buttons',
  // Speed multiplier button: clicked to adjust simulation playback rate (1x, 5x, 20x, 100x)
  'speed-btn': 'Event hook for simulation playback speed buttons',
  // Table of contents link: clicked to scroll methods document to target heading
  'toc-link': 'Event hook for Data & Methods in-page table of contents anchor links',
};

const JS_FILES = [
  'src/app.js',
  'src/comparisonEngine.js',
  'src/config.js',
  'src/dataAndMethodsDoc.js',
  'src/demLoader.js',
  'src/earthElevationChart.js',
  'src/ephemeris.js',
  'src/horizon.js',
  'src/scene.js',
  'src/terrain.js',
  'src/timeStore.js',
  'src/ui.js',
];

/**
 * Extracts class tokens from HTML/JS source code
 */
export function extractClassesFromSource(content) {
  const classes = new Set();

  // 1. class="..." or class='...'
  const classMatches = content.matchAll(/class=([\"'])(.*?)\1/gs);
  for (const m of classMatches) {
    const raw = m[2];
    const withoutInterp = raw.replace(/\$\{(.*?)\}/gs, ' ');
    for (const token of withoutInterp.split(/\s+/)) {
      if (token && !token.includes('${') && !token.includes('}') && !token.includes('"') && !token.includes("'")) {
        classes.add(token);
      }
    }
    const interpMatches = raw.matchAll(/\$\{(.*?)\}/gs);
    for (const im of interpMatches) {
      const expr = im[1];
      const strMatches = expr.matchAll(/['"]([^'"]+)['"]/g);
      for (const sm of strMatches) {
        for (const token of sm[1].split(/\s+/)) {
          if (token && !token.startsWith('$') && !token.includes('{') && !token.includes('}')) {
            classes.add(token);
          }
        }
      }
    }
  }

  // 2. className = '...' or className = "..."
  const classNameMatches = content.matchAll(/className\s*=\s*['"]([^'"]+)['"]/g);
  for (const m of classNameMatches) {
    for (const token of m[1].split(/\s+/)) {
      if (token) classes.add(token);
    }
  }

  // 3. classList.add('...'), classList.remove('...'), etc.
  const classListMatches = content.matchAll(/classList\.(?:add|remove|contains|toggle)\(['"]([^'"]+)['"]\)/g);
  for (const m of classListMatches) {
    for (const token of m[1].split(/\s+/)) {
      if (token) classes.add(token);
    }
  }

  return classes;
}

/**
 * Parses CSS text and returns set of unescaped class names
 */
export function extractDefinedClassesFromCss(cssText) {
  const defined = new Set();
  const clean = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectorMatches = clean.matchAll(/\.((?:\\.|[a-zA-Z0-9_-])+)/g);
  for (const m of selectorMatches) {
    const raw = m[1];
    const unescaped = raw.replace(/\\(.)/g, '$1');
    defined.add(unescaped);
  }
  return defined;
}

/**
 * Loads text file uniformly in Node.js and Browser
 */
async function loadFileContent(filePath) {
  if (typeof fetch === 'function' && typeof window !== 'undefined') {
    try {
      const resp = await fetch('/' + filePath.replace(/^\//, ''));
      if (!resp.ok) return null;
      return await resp.text();
    } catch {
      return null;
    }
  } else {
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const fullPath = path.resolve(process.cwd(), filePath.replace(/^\//, ''));
      if (!fs.existsSync(fullPath)) return null;
      return fs.readFileSync(fullPath, 'utf8');
    } catch {
      return null;
    }
  }
}

/**
 * Executes the complete CSS class audit
 */
export async function runClassAudit() {
  const usedClasses = new Set();

  // Load index.html
  const htmlContent = await loadFileContent('index.html');
  if (htmlContent) {
    for (const cls of extractClassesFromSource(htmlContent)) {
      usedClasses.add(cls);
    }
  }

  // Load all src JS files
  for (const jsFile of JS_FILES) {
    const jsContent = await loadFileContent(jsFile);
    if (jsContent) {
      for (const cls of extractClassesFromSource(jsContent)) {
        usedClasses.add(cls);
      }
    }
  }

  // Load CSS files
  const indexCss = (await loadFileContent('src/index.css')) || '';
  const generatedCss = (await loadFileContent('src/tailwind.generated.css')) || (await loadFileContent('src/utilities.css')) || '';
  const combinedCss = generatedCss + '\n' + indexCss;

  const definedClasses = extractDefinedClassesFromCss(combinedCss);

  // Check critical required rules in CSS
  const hasHiddenClass = definedClasses.has('hidden');
  const hasHiddenDisplayNone = /\.hidden\s*\{[^}]*display\s*:\s*none/i.test(combinedCss) ||
                               /\.hidden\s*\{[^}]*display\s*:\s*none\s*!important/i.test(combinedCss);
  const hasHiddenRule = hasHiddenClass && hasHiddenDisplayNone;

  const hasLgHiddenRule = definedClasses.has('lg:hidden') && /lg\\:hidden/.test(combinedCss);
  const hasLgFlexRule = definedClasses.has('lg:flex') && /lg\\:flex/.test(combinedCss);

  const undefinedClasses = [];
  for (const cls of usedClasses) {
    if (cls in ALLOW_LIST) continue;
    if (!definedClasses.has(cls)) {
      undefinedClasses.push(cls);
    }
  }
  undefinedClasses.sort();

  const passed = undefinedClasses.length === 0 && hasHiddenRule && hasLgHiddenRule && hasLgFlexRule;

  const measurements = [
    `Total Classes Used in Code: ${usedClasses.size}`,
    `Total Classes Defined in CSS: ${definedClasses.size}`,
    `Allow-listed JS Hooks: ${Object.keys(ALLOW_LIST).length}`,
    `Undefined Classes: ${undefinedClasses.length} [${undefinedClasses.length === 0 ? 'PASS' : 'FAIL'}]`,
    `.hidden { display: none } Rule Present: ${hasHiddenRule ? 'YES [PASS]' : 'MISSING [FAIL]'}`,
    `lg:hidden Responsive Rule Present: ${hasLgHiddenRule ? 'YES [PASS]' : 'MISSING [FAIL]'}`,
    `lg:flex Responsive Rule Present: ${hasLgFlexRule ? 'YES [PASS]' : 'MISSING [FAIL]'}`,
  ];

  if (undefinedClasses.length > 0) {
    measurements.push(`UNDEFINED CLASSES LIST (${undefinedClasses.length}):`);
    // Format into columns or comma list
    measurements.push(undefinedClasses.join(', '));
  }

  return {
    passed,
    totalUsed: usedClasses.size,
    totalDefined: definedClasses.size,
    undefinedCount: undefinedClasses.length,
    undefinedClasses,
    hasHiddenRule,
    hasLgHiddenRule,
    hasLgFlexRule,
    measurements,
  };
}
