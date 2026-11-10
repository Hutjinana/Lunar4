/**
 * Artemis Lunar Landing Site Navigator - Headless Node.js Test Runner
 * 
 * Executes tests/suite.js, prints formatted tables of expected vs measured values,
 * and exits with code 1 on any test failure.
 */

import { runAllTests } from './suite.js';
import { runRegionsTest } from './regions.js';
import { runDomainTest } from './domain.js';
import { runTerrainRealismTest } from './terrainRealism.js';
import { runPickPointTest } from './pickPoint.js';
import { runLolaDemTest } from './lolaDem.js';
import { runTerrainMeshTest } from './terrainMesh.js';
import { runPolarSceneTest } from './polarScene.js';
import { runMissionMetricsTest } from './missionMetrics.js';
import { runSolarPanel3dTest } from './solarPanel3d.js';
import { runMissionCardTest } from './missionCard.js';
import { runComparisonTest } from './comparison.js';
import { runAnalysisChartsTest } from './analysisCharts.js';
import { runGlobeViewTest } from './globeView.js';
import { runRelativeUrlsTest } from './relativeUrls.js';

async function main() {
  console.log('='.repeat(80));
  console.log('ARTEMIS NAVIGATOR - VERIFICATION TEST SUITE (HEADLESS RUNNER)');
  console.log('='.repeat(80));

  const tStart = performance.now();
  const tests = await runAllTests();
  tests.push(await runRegionsTest());
  tests.push(await runDomainTest());
  tests.push(await runTerrainRealismTest());
  tests.push(await runPickPointTest());
  tests.push(await runLolaDemTest());
  tests.push(await runTerrainMeshTest());
  tests.push(await runPolarSceneTest());
  tests.push(await runMissionMetricsTest());
  tests.push(await runSolarPanel3dTest());
  tests.push(await runMissionCardTest());
  tests.push(await runComparisonTest());
  tests.push(await runAnalysisChartsTest());
  tests.push(await runGlobeViewTest());
  tests.push(await runRelativeUrlsTest());
  const totalElapsed = (performance.now() - tStart).toFixed(2);

  let allPassed = true;

  for (const test of tests) {
    const statusTag = test.passed ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
    console.log(`\n${statusTag} ${test.name} (${test.timeMs} ms)`);
    console.log(`       Criteria: ${test.criteria}`);

    for (const m of test.measurements) {
      const isFailLine = m.includes('[FAIL]');
      const color = isFailLine ? '\x1b[31m' : '\x1b[36m';
      console.log(`       ${color}• ${m}\x1b[0m`);
    }

    if (!test.passed) {
      allPassed = false;
    }
  }

  console.log('\n' + '='.repeat(80));
  const passedCount = tests.filter(t => t.passed).length;
  const totalCount = tests.length;

  if (allPassed) {
    console.log(`\x1b[32mSUITE RESULT: ALL ${totalCount} TESTS PASSED in ${totalElapsed} ms\x1b[0m`);
    console.log('='.repeat(80));
    process.exit(0);
  } else {
    console.log(`\x1b[31mSUITE RESULT: ${totalCount - passedCount} OF ${totalCount} TESTS FAILED in ${totalElapsed} ms\x1b[0m`);
    console.log('='.repeat(80));
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
