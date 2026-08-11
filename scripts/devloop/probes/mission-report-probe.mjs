#!/usr/bin/env node
// Acceptance probe for the mission-report lane.
//
// The harness owns this probe, not the builder. It is written against the
// contract the lane brief states, so a lane cannot satisfy acceptance by
// weakening its own test.

import assert from 'node:assert/strict';

const { renderMissionMarkdown } = await import('../mission-report.mjs');

const FIXTURE = {
  missionId: 'm-example-20260101t000000z',
  request: 'make the comps section easier to use',
  operatorOutcome: 'the operator can read the comps table without horizontal scrolling',
  status: 'closed',
  terminalState: 'PASS',
  terminalReason: 'focused, validation and localhost verification all passed',
  createdAt: '2026-01-01T00:00:00.000Z',
  peakConcurrency: 3,
  waves: 2,
  lanes: [
    { id: 'recon', kind: 'recon', status: 'complete', durationMs: 42_000, changedPaths: [], discoveryCount: 4, builderId: 'cc', dependsOn: [] },
    { id: 'ui', kind: 'build', status: 'complete', durationMs: 121_000, changedPaths: ['src/web/comps.tsx'], builderId: 'cc', dependsOn: ['recon'] },
    { id: 'api', kind: 'build', status: 'complete', durationMs: 98_000, changedPaths: ['src/landos/comps.ts'], builderId: 'codex', dependsOn: ['recon'] },
  ],
  integration: { integrated: true, files: ['src/web/comps.tsx', 'src/landos/comps.ts'], lanes: [] },
  focusedResult: { pass: true, results: [{ id: 'comps-unit', pass: true, durationMs: 9000, detail: 'exit 0' }] },
  validationResult: { pass: true, results: [{ id: 'typecheck', pass: true, durationMs: 60_000, detail: 'exit 0' }] },
  repairs: [],
};

function require(condition, message) {
  if (!condition) {
    console.log(`PROBE_FAIL ${message}`);
    process.exit(1);
  }
}

require(typeof renderMissionMarkdown === 'function', 'mission-report.mjs must export renderMissionMarkdown(mission)');

const markdown = renderMissionMarkdown(FIXTURE);
require(typeof markdown === 'string' && markdown.length > 0, 'renderMissionMarkdown must return a non-empty string');

// The report has to answer the questions Tyler actually asks after a sprint.
require(markdown.includes('m-example-20260101t000000z'), 'the report must name the mission id');
require(markdown.includes('PASS'), 'the report must state the terminal state');
require(markdown.includes('make the comps section easier to use'), 'the report must restate the request');
require(/peak.{0,20}concurrency/i.test(markdown), 'the report must state peak concurrency');
// The harness stores `waves` as a count. Rendering it as an em dash because the
// renderer expected a list is the exact defect this line exists to catch.
require(/wave count:\s*2\b/i.test(markdown), 'the report must render the wave count from the numeric mission.waves');
require(markdown.includes('recon') && markdown.includes('ui') && markdown.includes('api'), 'the report must list every lane');
require(markdown.includes('codex') && markdown.includes('cc'), 'the report must attribute each lane to its builder');
require(markdown.includes('src/web/comps.tsx'), 'the report must list the integrated files');
require(/2:01|121|2m/.test(markdown), 'the report must show lane durations');

// A failed mission must not render as if it passed.
const failed = renderMissionMarkdown({
  ...FIXTURE,
  terminalState: 'FAIL',
  terminalReason: 'focused checks still failing',
  focusedResult: { pass: false, results: [{ id: 'comps-unit', pass: false, durationMs: 9000, detail: 'exit 1' }] },
});
require(failed.includes('FAIL'), 'a failed mission must render its FAIL state');
require(!/\bPASS\b/.test(failed.split('\n')[0] ?? ''), 'a failed mission must not headline PASS');

console.log('PROBE_OK mission-report renders a usable sprint summary');
