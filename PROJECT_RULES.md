# PROJECT_RULES.md — read this first, every session

Project: Artemis Lunar Landing Site Navigator (NASA Space Apps 2026). Static site, vanilla JS ES modules, Three.js 0.169.0, astronomy-engine 2.1.19, Tailwind 3.4.17 (CLI build only). Deadline 14–15 Nov 2026, delivered as a zip.

## Working style (saves tokens)
- Touch ONLY the files named in the task. Do not read, rewrite or reformat other files.
- Output ONLY changed files (or minimal edits). Never print unchanged files. No long explanations.
- After the work, reply with at most 10 lines: files changed + what changed. Do not paste test output.
- Do not refactor, rename, or "improve" anything not asked for. If you see a problem outside scope, mention it in one line and leave it.

## Environment checks (do first, once)
- `index.html` must still load `/src/app.js` and keep the importmap. Do NOT replace it with a React/Vite template.
- `package.json` must keep scripts `serve`, `test`, `build:css`, `type: "module"`, and the pinned versions.
- Do not add Vite, React, bun, or `.aistudio/` files.

## Hard rules
1. Say "region", not "site" (NASA defines regions with several possible landing points).
2. No hand-written telemetry. Every number is computed from ephemeris/terrain or labelled "illustrative".
3. Never change a region's lat/lon/source without a cited source. Status `sourced` means "source cited and transcription re-checked", NEVER write "verified" unless checked against the original.
4. Each coordinate is one of two kinds and the UI must always show which: `region_centre` or `candidate_site`.
5. Do not remove honesty labels: the non-dismissible "Illustrative terrain – not real LOLA data" banner, `[NOT TO SCALE]`, coordinate-kind labels, the "rankings not scientifically meaningful" disclaimer.
6. Do not delete or weaken existing tests. Add tests for new behaviour.
7. Sun and Earth are discs (Sun 0.265°, Earth ~1°), not points. Use real ephemeris, not circular orbits.
8. Map azimuth direction = (sin(az+λ), cos(az+λ)) via `azimuthToMapDirection` in `mapGeometry.js`. Do not change this.
9. Pin every library version exactly. No Tailwind CDN/play script in the final page. If you add a Tailwind class in the UI, run `npm run build:css` (test 10 checks every class).
10. Explanatory text for users lives in Data & Methods (`DATA_AND_METHODS.md`, loaded at runtime by `src/dataAndMethodsDoc.js`). Do not scatter explanations or legends elsewhere in the UI.
11. Do not copy Orrery Space's numbers (sunlit %, Earth-link %) into this repo as our results.

## Before finishing every task
- Run `npm run build:css` (if UI classes changed) and `npm test`. All tests must pass.
- Update `CHANGELOG.md` with 1–3 lines.
