import assert from 'node:assert/strict';
import { cp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test, { after, before } from 'node:test';

import { validateAcceptancePackage } from './completion-gate.mjs';
import { generateAcceptanceReport } from './generate-report.mjs';
import {
  evidenceWebm,
  readResults,
  refreshArtifactMetadata,
  writeResults,
} from './test-support.mjs';
import { readZipEntries, writeStoredZip } from './trace-sanitizer.mjs';

const ROOT = resolve('.');
const GATE = join(ROOT, 'scripts', 'acceptance', 'completion-gate.mjs');
let suiteRoot;
let authenticBase;

before(async () => {
  suiteRoot = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(join(tmpdir(), 'landos-completion-gate-')));
  authenticBase = join(ROOT, '.landos', 'acceptance', `gate-unit-authentic-${process.pid}-${Date.now()}`);
  const run = spawnSync(process.execPath, [
    join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js'),
    'test', 'scripts/acceptance/specs/landos-704-bell.visual.spec.ts', '--config=playwright.config.ts',
  ], {
    encoding: 'utf8',
    cwd: ROOT,
    env: {
      ...process.env,
      LANDOS_ACCEPTANCE_MODE: 'fixture',
      LANDOS_ACCEPTANCE_FIXTURE_PROJECTION_PASS: '1',
      LANDOS_ACCEPTANCE_EXPECT_VERDICT: 'PASS',
      LANDOS_ACCEPTANCE_OUTPUT_DIR: authenticBase,
      LANDOS_ACCEPTANCE_PLAYWRIGHT_OUTPUT_DIR: join(suiteRoot, 'playwright-output'),
    },
    timeout: 120_000,
  });
  assert.equal(run.status, 0, `authentic Playwright fixture failed:\n${run.stdout}\n${run.stderr}`);
});

after(async () => {
  if (suiteRoot) await rm(suiteRoot, { recursive: true, force: true });
  if (authenticBase) await rm(authenticBase, { recursive: true, force: true });
});

async function packageFor(name) {
  const directory = join(suiteRoot, name);
  await cp(authenticBase, directory, { recursive: true, errorOnExist: true });
  return directory;
}

async function mutateResults(directory, mutate) {
  const results = await readResults(directory);
  await mutate(results);
  await writeResults(directory, results);
}

async function mutateTraceObservation(directory, artifact, mutate) {
  const tracePath = join(directory, 'trace.zip');
  const entries = readZipEntries(await readFile(tracePath));
  const trace = entries.find((entry) => entry.name === 'trace.trace');
  const events = trace.data.toString('utf8').split('\n').map((line) => line.trim() ? JSON.parse(line) : null);
  const event = events.find((candidate) => {
    const value = candidate?.result?.value?.s;
    if (typeof value !== 'string' || !value.startsWith('{"marker":"LANDOS_OBSERVATION_V1"')) return false;
    return JSON.parse(value).artifact === artifact;
  });
  assert.ok(event, `missing authentic trace observation for ${artifact}`);
  const observation = JSON.parse(event.result.value.s);
  mutate(observation);
  event.result.value.s = JSON.stringify(observation);
  trace.data = Buffer.from(events.map((candidate) => candidate ? JSON.stringify(candidate) : '').join('\n'));
  await writeFile(tracePath, writeStoredZip(entries));
  await mutateResults(directory, async (results) => { await refreshArtifactMetadata(directory, results, 'trace.zip'); });
}

function assertCliBlocked(directory, expectedPattern) {
  const run = spawnSync(process.execPath, [GATE, directory], { encoding: 'utf8', cwd: ROOT });
  assert.equal(run.status, 1, `gate unexpectedly passed:\n${run.stdout}\n${run.stderr}`);
  assert.match(`${run.stdout}\n${run.stderr}`, expectedPattern);
}

test('a complete internally consistent evidence package passes and report content is generated', async () => {
  const directory = await packageFor('passing-package');
  const result = await validateAcceptancePackage(directory);
  assert.equal(result.ok, true, result.errors.join('\n'));
  const report = await readFile(join(directory, 'acceptance-report.md'), 'utf8');
  assert.match(report, /Verdict: \*\*PASS\*\*/);
  assert.match(report, /704 Bell Rd, Red Creek, NY 13143/);
  const run = spawnSync(process.execPath, [GATE, directory], { encoding: 'utf8', cwd: ROOT });
  assert.equal(run.status, 0, run.stderr);
});

test('captured console errors remain diagnostic instead of becoming a blanket completion block', async () => {
  const directory = await packageFor('diagnostic-console-error');
  await mutateResults(directory, async (results) => {
    const value = { schemaVersion: '1.0.0', capturedAt: results.completedAt, entries: [{ type: 'error', text: 'projection render failed', timestamp: results.completedAt, location: { urlPath: '/deal', line: 1, column: 1 }, relevant: true }] };
    await writeFile(join(directory, 'console.json'), `${JSON.stringify(value, null, 2)}\n`);
    results.console.relevantErrorCount = 1;
    await refreshArtifactMetadata(directory, results, 'console.json');
  });
  await generateAcceptanceReport(directory);
  const result = await validateAcceptancePackage(directory);
  assert.equal(result.ok, true, result.errors.join('\n'));
});

const cases = [
  {
    name: 'content-invalid-screenshot',
    expected: /changed-section\.png: (?:SHA-256|invalid PNG|too small)/i,
    mutate: async (directory) => { await writeFile(join(directory, 'changed-section.png'), Buffer.from('not visual evidence')); },
  },
  {
    name: 'wrong-visible-count',
    expected: /displayed count 3 differs from 4 rendered rows/i,
    mutate: (directory) => mutateResults(directory, (results) => { results.counts[0].displayed = 3; }),
  },
  {
    name: 'canonical-data-not-visible',
    expected: /canonical accepted records but 0 displayed/i,
    mutate: (directory) => mutateResults(directory, (results) => { results.counts[0].displayed = 0; results.counts[0].renderedRows = 0; }),
  },
  {
    name: 'empty-state-with-canonical',
    expected: /empty state is visible despite accepted canonical records/i,
    mutate: (directory) => mutateResults(directory, (results) => { results.counts[1].emptyStateVisible = true; }),
  },
  {
    name: 'refresh-loss',
    expected: /refresh lost visible acceptance data/i,
    mutate: (directory) => mutateResults(directory, (results) => { results.refresh.status = 'FAIL'; results.refresh.visibleValuesRetained = false; }),
  },
  {
    name: 'restart-loss',
    expected: /restart lost visible acceptance data/i,
    mutate: (directory) => mutateResults(directory, (results) => { results.restart.status = 'FAIL'; results.restart.visibleValuesRetained = false; }),
  },
  {
    name: 'contamination',
    expected: /cross-property contamination was detected/i,
    mutate: (directory) => mutateResults(directory, (results) => { results.contamination.status = 'FAIL'; results.contamination.detectedValues = ['999 Wrong Property Rd']; }),
  },
  {
    name: 'required-network-failure',
    expected: /required contradicts contract-derived classification|required failure count does not match/i,
    mutate: (directory) => mutateResults(directory, async (results) => {
      const value = { schemaVersion: '1.0.0', capturedAt: results.completedAt, failures: [{ method: 'GET', urlPath: '/api/landos/deal-cards/1', failure: 'HTTP 500', resourceType: 'fetch', status: 500, timestamp: results.completedAt, required: true }] };
      await writeFile(join(directory, 'network-failures.json'), `${JSON.stringify(value, null, 2)}\n`);
      results.network.requiredFailureCount = 1;
      await refreshArtifactMetadata(directory, results, 'network-failures.json');
    }),
  },
  {
    name: 'console-error-relabelled-irrelevant',
    expected: /relevant contradicts contract-derived classification|relevant browser console error/i,
    mutate: (directory) => mutateResults(directory, async (results) => {
      const value = { schemaVersion: '1.0.0', capturedAt: results.completedAt, entries: [{ type: 'error', text: 'projection render failed', timestamp: results.completedAt, location: { urlPath: '/deal', line: 1, column: 1 }, relevant: false }] };
      await writeFile(join(directory, 'console.json'), `${JSON.stringify(value, null, 2)}\n`);
      results.console.relevantErrorCount = 0;
      await refreshArtifactMetadata(directory, results, 'console.json');
    }),
  },
  {
    name: 'required-network-failure-relabelled-optional',
    expected: /required contradicts contract-derived classification|required network request\(s\) failed/i,
    mutate: async (directory) => {
      const contract = JSON.parse(await readFile(join(directory, 'acceptance-contract.json'), 'utf8'));
      contract.runPolicy.requiredNetworkPatterns = ['^/api/landos/'];
      await writeFile(join(directory, 'acceptance-contract.json'), `${JSON.stringify(contract, null, 2)}\n`);
      await mutateResults(directory, async (results) => {
        const value = { schemaVersion: '1.0.0', capturedAt: results.completedAt, failures: [{ method: 'GET', urlPath: '/api/landos/deal-cards/1', failure: 'HTTP 500', resourceType: 'fetch', status: 500, timestamp: results.completedAt, required: false }] };
        await writeFile(join(directory, 'network-failures.json'), `${JSON.stringify(value, null, 2)}\n`);
        results.network.requiredFailureCount = 0;
        await refreshArtifactMetadata(directory, results, 'network-failures.json');
      });
    },
  },
  {
    name: 'cross-property-rendered-identity',
    expected: /cross-property contamination in trace-rendered evidence/i,
    mutate: (directory) => mutateTraceObservation(directory, 'deal-card-loaded.png', (observation) => {
      observation.subject.address = '999 Wrong Property Rd, Auburn, NY 13021';
    }),
  },
  {
    name: 'signature-shaped-undecodable-video',
    expected: /FFmpeg could not fully decode video evidence|FFmpeg did not decode/i,
    mutate: (directory) => mutateResults(directory, async (results) => {
      await writeFile(join(directory, 'video.webm'), evidenceWebm());
      await refreshArtifactMetadata(directory, results, 'video.webm');
    }),
  },
  {
    name: 'non-pass-verdict',
    expected: /visual verdict is FAIL, not PASS/i,
    mutate: (directory) => mutateResults(directory, (results) => { results.verdict = 'FAIL'; }),
  },
  {
    name: 'unlinked-claim-evidence',
    expected: /was not predeclared for the claim/i,
    mutate: (directory) => mutateResults(directory, (results) => { results.claims[0].evidencePath = 'relevant-tab-or-panel.png'; }),
  },
  {
    name: 'context-cleanup-incomplete',
    expected: /test context\(s\) remain open|cleanup was not completed/i,
    mutate: (directory) => mutateResults(directory, (results) => { results.lifecycle.contextsClosed = 0; results.lifecycle.cleanupCompleted = false; }),
  },
  {
    name: 'page-cleanup-incomplete',
    expected: /test page\(s\) remain open/i,
    mutate: (directory) => mutateResults(directory, (results) => { results.lifecycle.pagesClosed = 0; }),
  },
  {
    name: 'freshness-required-but-not-fresh',
    expected: /acceptance property is not fresh although freshness is required/i,
    mutate: async (directory) => {
      const contract = JSON.parse(await readFile(join(directory, 'acceptance-contract.json'), 'utf8'));
      contract.runPolicy.freshnessRequired = true;
      await writeFile(join(directory, 'acceptance-contract.json'), `${JSON.stringify(contract, null, 2)}\n`);
      await mutateResults(directory, (results) => { results.freshness.required = true; results.freshness.isFresh = false; });
    },
  },
  {
    name: 'missing-claim-screenshot',
    expected: /changed-section\.png: required artifact is missing/i,
    mutate: async (directory) => { await unlink(join(directory, 'changed-section.png')); },
  },
  {
    name: 'missing-trace',
    expected: /trace\.zip: required artifact is missing/i,
    mutate: async (directory) => { await unlink(join(directory, 'trace.zip')); },
  },
  {
    name: 'missing-video',
    expected: /video\.webm: required artifact is missing/i,
    mutate: async (directory) => { await unlink(join(directory, 'video.webm')); },
  },
  {
    name: 'unsanitized-trace-secret',
    expected: /trace\.trace still contains .* recognized sensitive value/i,
    mutate: (directory) => mutateResults(directory, async (results) => {
      const unsafeTrace = `${JSON.stringify({ headers: [{ name: 'cookie', value: 'unsafe-live-session-canary' }], padding: 'x'.repeat(1_500) })}\n`;
      await writeFile(join(directory, 'trace.zip'), writeStoredZip([{ name: 'trace.trace', data: Buffer.from(unsafeTrace) }]));
      await refreshArtifactMetadata(directory, results, 'trace.zip');
    }),
  },
];

for (const entry of cases) {
  test(`completion gate exits nonzero for ${entry.name}`, async () => {
    const directory = await packageFor(entry.name);
    await entry.mutate(directory);
    assertCliBlocked(directory, entry.expected);
  });
}
