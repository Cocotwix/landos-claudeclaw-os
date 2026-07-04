import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestLandosDb } from './db.js';
import {
  executeBrowserPlaybook, listBrowserAgentRuns, getLastBrowserAgentRun, playbookInfo, isScopeAllowed,
  type BrowserPlaybook, type PlaybookBackend, type PlaybookExtraction, type PlaybookProvenance,
} from './browser-agent.js';

// ── A tiny generic playbook + backend to prove the site-agnostic agent ──────
interface FakeBackend extends PlaybookBackend {
  visited: string[];
  fail?: boolean;
  auth?: boolean;
}
function makeFakeBackend(over: Partial<FakeBackend> = {}): FakeBackend {
  return { id: 'fake', configured: () => over.configured?.() ?? true, visited: over.visited ?? ['Allowed'], fail: over.fail, auth: over.auth };
}

const prov: PlaybookProvenance = { provider: 'test:fake', playbookId: 'fake_playbook', sourcePage: 'fake://page', extractionTimestamp: '2026-07-03T00:00:00Z', agentRunId: 'r1' };

const fakePlaybook: BrowserPlaybook<{ n: number }, { v: number }, FakeBackend> = {
  id: 'fake_playbook', label: 'Fake', provider: 'test:fake', allowedScope: ['Allowed', 'AlsoAllowed'],
  describe: () => 'fake',
  async run(backend, request): Promise<PlaybookExtraction<{ v: number }>> {
    if (backend.fail) throw new Error('boom');
    if (backend.auth) return { outcome: 'awaiting_authentication', items: [], rowsCaptured: 0, scopeVisited: backend.visited, screenshots: [], provenance: prov, note: 'auth' };
    const items = Array.from({ length: request.n }, (_, i) => ({ v: i }));
    return { outcome: 'collected', items, rowsCaptured: request.n, scopeVisited: backend.visited, screenshots: ['shot'], provenance: prov, note: 'ok' };
  },
};

describe('Browser Agent (generic playbook execution)', () => {
  beforeEach(() => { _initTestLandosDb(); });

  it('isScopeAllowed matches case-insensitively', () => {
    expect(isScopeAllowed(['Market Research'], 'market research')).toBe(true);
    expect(isScopeAllowed(['Market Research'], 'Billing')).toBe(false);
  });

  it('records an honest not_configured run without touching the backend', async () => {
    const backend = makeFakeBackend({ configured: () => false });
    const { run, extraction } = await executeBrowserPlaybook(fakePlaybook, backend, { n: 3 });
    expect(run.status).toBe('not_configured');
    expect(extraction.outcome).toBe('not_configured');
    expect(run.rowsCaptured).toBe(0);
    expect(getLastBrowserAgentRun('fake_playbook')?.status).toBe('not_configured');
  });

  it('runs a configured playbook, ingests via the sink, and persists row counts', async () => {
    const backend = makeFakeBackend();
    const ingested: Array<{ v: number }> = [];
    const { run, extraction } = await executeBrowserPlaybook(fakePlaybook, backend, { n: 4 }, {
      ingest: (items) => { ingested.push(...items); return { accepted: items.length - 1, flagged: 0, unknown: 0, rejected: 1, reviewQueued: 1 }; },
    });
    expect(run.status).toBe('succeeded');
    expect(extraction.items).toHaveLength(4);
    expect(ingested).toHaveLength(4);
    expect(run.rowsCaptured).toBe(4);
    expect(run.rowsAccepted).toBe(3);
    expect(run.rowsRejected).toBe(1);
    expect(run.reviewQueued).toBe(1);
    expect(run.screenshots).toEqual(['shot']);
    expect(listBrowserAgentRuns('fake_playbook')).toHaveLength(1);
  });

  it('FAILS a run (and discards items) when the playbook strays outside allowedScope', async () => {
    const backend = makeFakeBackend({ visited: ['Allowed', 'Billing'] });
    let ingestCalls = 0;
    const { run, extraction } = await executeBrowserPlaybook(fakePlaybook, backend, { n: 2 }, {
      ingest: () => { ingestCalls++; return { accepted: 2, flagged: 0, unknown: 0, rejected: 0, reviewQueued: 0 }; },
    });
    expect(run.status).toBe('failed');
    expect(run.note).toMatch(/Scope violation/);
    expect(extraction.items).toHaveLength(0);
    expect(ingestCalls).toBe(0); // never ingest an off-scope run
  });

  it('maps awaiting_authentication and thrown errors to honest statuses', async () => {
    const auth = await executeBrowserPlaybook(fakePlaybook, makeFakeBackend({ auth: true }), { n: 0 });
    expect(auth.run.status).toBe('awaiting_authentication');
    const err = await executeBrowserPlaybook(fakePlaybook, makeFakeBackend({ fail: true }), { n: 0 });
    expect(err.run.status).toBe('failed');
    expect(err.run.note).toMatch(/threw/);
  });

  it('playbookInfo reports configured + last-run status', async () => {
    const backend = makeFakeBackend();
    expect(playbookInfo(fakePlaybook, backend).status).toBe('configured'); // no runs yet
    await executeBrowserPlaybook(fakePlaybook, backend, { n: 1 });
    expect(playbookInfo(fakePlaybook, backend).status).toBe('succeeded');
  });
});
