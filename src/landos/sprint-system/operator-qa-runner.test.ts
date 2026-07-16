// Operator-QA runner tests: preflight enforcement, localhost-only safety,
// read-only behavior toward operator data, managed-runtime usage, structured
// pass results, nonzero failure results, and golden-journey integrity.
// All seams are injected — no browser or server is launched here.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { GOLDEN_JOURNEYS, getJourney, validateJourney } from './journeys.js';
import {
  runJourney,
  runOperatorQa,
  runPreflight,
  selectFixtureCard,
  type ManagedRuntime,
  type QaBrowserSession,
  type RunnerDeps,
} from './operator-qa-runner.js';

const tempRoots: string[] = [];
afterAll(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

function fixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-qa-runner-'));
  tempRoots.push(root);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'web', 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dist', 'web'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a = 1;', 'utf8');
  fs.writeFileSync(path.join(root, 'dist', 'index.js'), 'server', 'utf8');
  fs.writeFileSync(
    path.join(root, 'dist', 'web', 'index.html'),
    '<html><head><script src="/assets/index-abc123.js"></script></head><body></body></html>',
    'utf8',
  );
  return root;
}

interface FetchCall {
  url: string;
  method: string;
}

function fakeFetch(routes: Record<string, { status: number; body: string }>, calls: FetchCall[] = []) {
  const impl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET' });
    const key = Object.keys(routes).find((route) => url.split('?')[0].endsWith(route) || url.split('?')[0] === route);
    const match = key ? routes[key] : { status: 404, body: 'not found' };
    return {
      status: match.status,
      text: async () => match.body,
      json: async () => JSON.parse(match.body),
    } as unknown as Response;
  };
  return impl as unknown as typeof fetch;
}

function fakeBrowser(pageTextByUrl: (url: string) => string, log: string[] = [], testIdCounts: Record<string, number> = {}): () => Promise<QaBrowserSession> {
  let currentUrl = '';
  return async () => ({
    mode: 'simulated' as const,
    description: 'fake browser',
    page: {
      async goto(url: string) {
        currentUrl = url;
        log.push(`goto ${url}`);
      },
      async pageText() {
        return pageTextByUrl(currentUrl);
      },
      async testIdCount(testId: string) {
        return testIdCounts[testId] ?? 0;
      },
      async setViewport(width: number, height: number) {
        log.push(`viewport ${width}x${height}`);
      },
      async clickText() {
        return true;
      },
      async screenshot(filePath: string) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, 'png', 'utf8');
      },
      async reload() {
        log.push('reload');
      },
    },
    async dispose() {
      log.push('dispose');
    },
  });
}

const healthyRuntime: ManagedRuntime = {
  async status() {
    return { ok: true, pid: 4242, detail: 'exactly one verified healthy LandOS server (PID 4242)' };
  },
  async restart() {
    return { ok: true, detail: 'managed restart completed' };
  },
};

const SERVED_HTML = '<html><head><script src="/assets/index-abc123.js"></script></head><body></body></html>';

function baseDeps(root: string, overrides: Partial<RunnerDeps> = {}): RunnerDeps {
  return {
    root,
    token: async () => 'test-token',
    managedRuntime: healthyRuntime,
    fetchImpl: fakeFetch({
      'http://localhost:3141': { status: 200, body: SERVED_HTML },
      '/api/health': { status: 200, body: '{"ok":true}' },
      '/api/landos/deal-cards': { status: 200, body: '[{"id":5,"status":"verified"}]' },
    }),
    browserFactory: fakeBrowser(() => 'LandOS Deal Board content'),
    evidenceDir: path.join(root, 'evidence'),
    ...overrides,
  };
}

describe('golden journeys', () => {
  it('defines all thirteen required operator states', () => {
    expect(GOLDEN_JOURNEYS.length).toBeGreaterThanOrEqual(13);
    const ids = GOLDEN_JOURNEYS.map((j) => j.id);
    for (const required of [
      'verified-property-strong-evidence',
      'verified-property-incomplete-research',
      'existing-unresolved-property',
      'new-property-resolves',
      'new-property-honestly-unresolved',
      'genuine-apn-conflict',
      'acreage-conflict-requires-tyler',
      'strong-comp-market',
      'thin-comp-market',
      'provider-failure-fallback',
      'multi-parcel-property',
      'refresh-persistence',
      'managed-restart-persistence',
    ]) {
      expect(ids).toContain(required);
    }
  });

  it('every journey is structurally complete', () => {
    for (const journey of GOLDEN_JOURNEYS) {
      expect(validateJourney(journey)).toEqual([]);
    }
  });
});

describe('preflight', () => {
  it('fails when the production build is stale', async () => {
    const root = fixtureRoot();
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(root, 'src', 'a.ts'), future, future);
    const checks = await runPreflight(baseDeps(root));
    const fresh = checks.find((c) => c.name === 'production_build_fresh');
    expect(fresh?.ok).toBe(false);
    expect(fresh?.detail).toContain('rebuild before QA');
  });

  it('detects a stale served frontend bundle', async () => {
    const root = fixtureRoot();
    const deps = baseDeps(root, {
      fetchImpl: fakeFetch({
        'http://localhost:3141': { status: 200, body: '<script src="/assets/index-OLD999.js"></script>' },
        '/api/health': { status: 200, body: '{"ok":true}' },
      }),
    });
    const checks = await runPreflight(deps);
    const bundle = checks.find((c) => c.name === 'live_frontend_bundle_current');
    expect(bundle?.ok).toBe(false);
    expect(bundle?.detail).toContain('stale frontend payload');
  });

  it('requires exactly one healthy managed server via the managed runtime tool', async () => {
    const root = fixtureRoot();
    const deps = baseDeps(root, {
      managedRuntime: {
        async status() {
          return { ok: false, pid: null, detail: 'landos:status exit 1: multiple processes' };
        },
        async restart() {
          return { ok: false, detail: 'unused' };
        },
      },
    });
    const checks = await runPreflight(deps);
    expect(checks.find((c) => c.name === 'managed_runtime_single_healthy')?.ok).toBe(false);
  });
});

describe('journey execution', () => {
  it('a successful journey produces a structured pass with screenshots (localhost)', async () => {
    const root = fixtureRoot();
    const result = await runJourney(getJourney('dashboard-shell-health'), baseDeps(root), { runId: 'run1' });
    expect(result.outcome).toBe('pass');
    expect(result.mode).toBe('simulated');
    expect(result.steps.every((s) => s.status !== 'fail')).toBe(true);
    expect(result.screenshots).toHaveLength(1);
    expect(fs.existsSync(result.screenshots[0])).toBe(true);
  });

  it('a visible browser failure produces findings and a failing outcome', async () => {
    const root = fixtureRoot();
    const deps = baseDeps(root, { browserFactory: fakeBrowser(() => 'completely unrelated page') });
    const result = await runJourney(getJourney('dashboard-shell-health'), deps, { runId: 'run2' });
    expect(result.outcome).toBe('fail');
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].patternKey).toBe('frontend-missing-value');
    expect(result.findings[0].disposition).toBe('internally_fixable');
    expect(result.findings[0].liveUrl).not.toContain('test-token');
  });

  it('runs Lead Workspace semantic assertions through the Acquisitions deep link', async () => {
    const root = fixtureRoot();
    const log: string[] = [];
    const deps = baseDeps(root, {
      browserFactory: fakeBrowser(() => 'Acquisitions Lead Workspace', log, {
        'lead-workspace-root': 1,
        'lead-workspace-strategy': 5,
        'deal-card-root': 0,
      }),
      fetchImpl: fakeFetch({
        'http://localhost:3141': { status: 200, body: SERVED_HTML },
        '/api/health': { status: 200, body: '{"ok":true}' },
        '/api/landos/deal-cards': { status: 200, body: '[{"id":5,"status":"verified"}]' },
        '/api/landos/deal-cards/5': { status: 200, body: '{"id":5,"status":"verified"}' },
        '/api/landos/lead-workspace/5': { status: 200, body: '{"contract":{"version":"1.0"}}' },
      }),
    });
    const result = await runJourney(getJourney('lead-workspace-acquisitions-readonly'), deps, { runId: 'lead-workspace' });
    expect(result.outcome).toBe('pass');
    expect(log.some((entry) => entry.includes('/dept/acquisitions?deal=5'))).toBe(true);
    expect(log).toContain('viewport 412x915');
  });

  it('never issues non-GET requests and refuses mutating journeys by default', async () => {
    const root = fixtureRoot();
    const calls: FetchCall[] = [];
    const deps = baseDeps(root, {
      fetchImpl: fakeFetch(
        {
          'http://localhost:3141': { status: 200, body: SERVED_HTML },
          '/api/health': { status: 200, body: '{"ok":true}' },
          '/api/landos/deal-cards': { status: 200, body: '[{"id":5}]' },
        },
        calls,
      ),
    });
    const mutating = await runJourney(getJourney('new-property-resolves'), deps, { runId: 'run3' });
    expect(mutating.outcome).toBe('mutation_refused');
    await runJourney(getJourney('dashboard-shell-health'), deps, { runId: 'run3' });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('managed restart persistence uses only the managed runtime seam', async () => {
    const root = fixtureRoot();
    let restarts = 0;
    const runtime: ManagedRuntime = {
      async status() {
        return { ok: true, pid: 4242, detail: 'healthy' };
      },
      async restart() {
        restarts += 1;
        return { ok: true, detail: 'managed restart completed' };
      },
    };
    const deps = baseDeps(root, {
      managedRuntime: runtime,
      fetchImpl: fakeFetch({
        'http://localhost:3141': { status: 200, body: SERVED_HTML },
        '/api/health': { status: 200, body: '{"ok":true}' },
        '/api/landos/deal-cards': { status: 200, body: '[{"id":5,"status":"verified"}]' },
        '/api/landos/deal-cards/5': { status: 200, body: '{"id":5,"status":"verified"}' },
      }),
    });
    const result = await runJourney(getJourney('managed-restart-persistence'), deps, { runId: 'run4' });
    expect(restarts).toBe(1);
    expect(result.outcome).toBe('pass');
    const restartStep = result.steps.find((s) => s.kind === 'restart_persistence');
    expect(restartStep?.status).toBe('pass');
  });

  it('reports fixture_unavailable honestly instead of fabricating a pass', async () => {
    const root = fixtureRoot();
    const deps = baseDeps(root, {
      fetchImpl: fakeFetch({
        'http://localhost:3141': { status: 200, body: SERVED_HTML },
        '/api/health': { status: 200, body: '{"ok":true}' },
        '/api/landos/deal-cards': { status: 200, body: '[]' },
      }),
    });
    const result = await runJourney(getJourney('refresh-persistence'), deps, { runId: 'run5' });
    expect(result.outcome).toBe('fixture_unavailable');
    expect(result.steps[0].detail).toContain('honestly unavailable');
  });
});

describe('suite runner', () => {
  it('refuses non-localhost targets by default', async () => {
    const root = fixtureRoot();
    await expect(
      runOperatorQa({ journeyId: 'dashboard-shell-health' }, baseDeps(root, { baseUrl: 'https://landportal.com' })),
    ).rejects.toThrow(/localhost only/);
  });

  it('produces a structured report with exit 0 on success and exit 1 on failure', async () => {
    const root = fixtureRoot();
    const pass = await runOperatorQa({ journeyId: 'dashboard-shell-health' }, baseDeps(root));
    expect(pass.exitCode).toBe(0);
    expect(pass.journeys[0].outcome).toBe('pass');
    expect(fs.existsSync(pass.reportJsonPath!)).toBe(true);
    expect(fs.existsSync(pass.reportMarkdownPath!)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(pass.reportJsonPath!, 'utf8'));
    expect(parsed.journeys[0].mode).toBe('simulated');

    const fail = await runOperatorQa(
      { journeyId: 'dashboard-shell-health' },
      baseDeps(root, { browserFactory: fakeBrowser(() => 'broken page') }),
    );
    expect(fail.exitCode).toBe(1);
    expect(fail.summary.fail).toBe(1);
  });

  it('preflight failure yields a nonzero exit without running journeys', async () => {
    const root = fixtureRoot();
    const deps = baseDeps(root, {
      fetchImpl: fakeFetch({}),
    });
    const report = await runOperatorQa({ journeyId: 'dashboard-shell-health' }, deps);
    expect(report.preflightOk).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.journeys).toEqual([]);
  });
});

describe('fixture selection', () => {
  it('matches criteria heuristically and returns null when nothing is safe', async () => {
    const fetcher = async (apiPath: string) => {
      if (apiPath === '/api/landos/deal-cards') {
        return { status: 200, json: [{ id: 1 }, { id: 2 }], text: '[{"id":1},{"id":2}]' };
      }
      if (apiPath === '/api/landos/deal-cards/1') {
        return { status: 200, json: { id: 1 }, text: '{"id":1,"resolution":"unresolved","note":"needs review"}' };
      }
      return { status: 200, json: { id: 2 }, text: '{"id":2,"resolution":"verified","evidence":["deed","gis"]}' };
    };
    const unresolved = await selectFixtureCard('unresolved', fetcher);
    expect(unresolved?.dealId).toBe(1);
    const verified = await selectFixtureCard('verified_strong_evidence', fetcher);
    expect(verified?.dealId).toBe(2);
    const empty = await selectFixtureCard('any', async () => ({ status: 200, json: [], text: '[]' }));
    expect(empty).toBeNull();
  });

  // Regression: the genuine-apn-conflict journey once selected a card whose
  // report merely CONTAINED the words "APN" and "mismatch" (an internal
  // provider trace) and then failed against a card with no real conflict.
  // apn_conflict must select only a recorded resolution identityConflict and
  // report fixture-unavailable (null) otherwise.
  it('apn_conflict requires a genuine recorded identityConflict, never a fuzzy text match', async () => {
    const withoutConflict = async (apiPath: string) => {
      if (apiPath === '/api/landos/deal-cards') {
        return { status: 200, json: [{ id: 1 }], text: '[{"id":1}]' };
      }
      if (apiPath === '/api/landos/deal-cards/1/resolution') {
        return { status: 200, json: { snapshot: { state: 'confirmed', identityConflict: null } }, text: '' };
      }
      // Detail/report text littered with trace words that used to false-match.
      return { status: 200, json: { id: 1 }, text: '{"id":1,"trace":"apn:R1 ADDR-MISMATCH conflict"}' };
    };
    expect(await selectFixtureCard('apn_conflict', withoutConflict)).toBeNull();

    const withConflict = async (apiPath: string) => {
      if (apiPath === '/api/landos/deal-cards') {
        return { status: 200, json: [{ id: 1 }, { id: 2 }], text: '[{"id":1},{"id":2}]' };
      }
      if (apiPath === '/api/landos/deal-cards/1/resolution') {
        return { status: 200, json: { snapshot: { identityConflict: null } }, text: '' };
      }
      if (apiPath === '/api/landos/deal-cards/2/resolution') {
        return {
          status: 200,
          json: { snapshot: { identityConflict: { requestedApn: '111-22-333', resolvedApn: '999-88-777', source: 'county records' } } },
          text: '',
        };
      }
      return { status: 200, json: {}, text: '{}' };
    };
    const selected = await selectFixtureCard('apn_conflict', withConflict);
    expect(selected?.dealId).toBe(2);
    expect(selected?.detail).toContain('111-22-333');
  });
});
