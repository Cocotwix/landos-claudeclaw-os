import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestLandosDb } from './db.js';
import {
  saveDraftPlaybook,
  decidePlaybook,
  listTrainingExecutions,
  type TrainingPlaybook,
} from './browser-training-db.js';
import { listBrowserFacts } from './browser-fact-store.js';
import { runTrainedPlaybook, type TrainedBackend } from './trained-playbook-runner.js';
import type { PageLike } from './browser-session.js';

beforeEach(() => { _initTestLandosDb(); });

// ── A scriptable fake page that records what the runner did ──────────
interface FakeLog { gotos: string[]; clicks: number; types: Array<{ sel: string; val: string }>; screenshots: string[] }
function makeFakePage(fieldValues: Record<string, string> = {}): { page: PageLike; log: FakeLog } {
  const log: FakeLog = { gotos: [], clicks: 0, types: [], screenshots: [] };
  let current = 'about:blank';
  const page: PageLike = {
    goto: async (url: string) => { log.gotos.push(url); current = url; return {}; },
    url: () => current,
    evaluate: (async (fn: any) => {
      const src = String(fn);
      if (src.includes('.textContent')) {
        // extraction: find which selector was requested
        for (const [sel, val] of Object.entries(fieldValues)) {
          if (src.includes(JSON.stringify(sel))) return val;
        }
        return '';
      }
      if (src.includes('.click')) { log.clicks++; return undefined; }
      if (src.includes('querySelector')) return true; // element present
      return undefined;
    }) as PageLike['evaluate'],
    type: async (sel: string, val: string) => { log.types.push({ sel, val }); },
    screenshot: async ({ path }: { path: string }) => { log.screenshots.push(path); return {}; },
  };
  return { page, log };
}

function fakeBackend(page: PageLike): TrainedBackend {
  return { id: 'trained:test', configured: () => true, getPage: async () => page, screenshotDir: 'shots' };
}

function approvedPlaybook(body: Record<string, unknown>): TrainingPlaybook {
  const draft = saveDraftPlaybook({ sessionId: null, slug: 'lp_map_search', name: 'LandPortal Map Search', website: 'https://landportal.com/', body });
  return decidePlaybook(draft.id, 'approved', 'Tyler');
}

const LP_STEPS = {
  website: 'https://landportal.com/',
  steps: [
    { action: 'Navigate to map', url: 'https://landportal.com/map?q={{query}}' },
    { action: 'Click parcel', selector: '#parcel-1' },
    { action: 'Enter search', selector: '#search', note: 'value: {{query}}' },
    { action: 'Capture screenshot: sidebar', note: 'sidebar' },
  ],
  fieldSelectors: { owner: '#owner', apn: '#apn' },
};

describe('approved-only execution', () => {
  it('refuses to execute a draft playbook (no browser action, no result row)', async () => {
    const draft = saveDraftPlaybook({ sessionId: null, slug: 'lp', name: 'LP', website: 'https://landportal.com/', body: LP_STEPS });
    const { page } = makeFakePage();
    const res = await runTrainedPlaybook(draft.id, { mode: 'dry_run', backend: fakeBackend(page) });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/approved/);
    expect(listTrainingExecutions(draft.id)).toHaveLength(0);
  });

  it('executes an approved playbook', async () => {
    const pb = approvedPlaybook(LP_STEPS);
    const { page } = makeFakePage({ '#owner': 'Jane Doe', '#apn': '123-45' });
    const res = await runTrainedPlaybook(pb.id, { mode: 'dry_run', vars: { query: 'GA' }, backend: fakeBackend(page) });
    expect(res.ok).toBe(true);
    expect(res.execution!.status).toBe('succeeded');
  });
});

describe('paid-action guard during execution', () => {
  it('stops immediately as prohibited, no approval and no fields written', async () => {
    const pb = approvedPlaybook({
      website: 'https://landportal.com/',
      steps: [
        { action: 'Navigate to map', url: 'https://landportal.com/map' },
        { action: 'Click Buy Report', selector: '#buy' },
        { action: 'Capture screenshot', note: 'after' },
      ],
      fieldSelectors: { owner: '#owner' },
    });
    const { page, log } = makeFakePage({ '#owner': 'Jane' });
    const res = await runTrainedPlaybook(pb.id, { mode: 'live', dealCardId: 77, backend: fakeBackend(page) });
    expect(res.ok).toBe(true);
    const exec = res.execution!;
    expect(exec.status).toBe('blocked');
    expect(exec.approvalRequired).toBe(false);
    expect(exec.blockedActions.length).toBe(1);
    expect(exec.blockedActions[0].reason).toMatch(/prohibited and cannot be approved/i);
    // stopped before the screenshot step and before any extraction/writeback
    expect(log.screenshots.length).toBe(0);
    expect(exec.fieldsWritten).toBe(0);
    expect(listBrowserFacts(77)).toHaveLength(0);
  });

  it('blocks a paid URL step even in dry-run', async () => {
    const pb = approvedPlaybook({
      website: 'https://landportal.com/',
      steps: [{ action: 'Open checkout', url: 'https://landportal.com/checkout' }],
    });
    const { page } = makeFakePage();
    const res = await runTrainedPlaybook(pb.id, { mode: 'dry_run', backend: fakeBackend(page) });
    expect(res.execution!.status).toBe('blocked');
    expect(res.execution!.approvalRequired).toBe(false);
  });
});

describe('execution result storage', () => {
  it('persists status, screenshots, extracted fields, errors and QA notes', async () => {
    const pb = approvedPlaybook(LP_STEPS);
    const { page } = makeFakePage({ '#owner': 'Jane Doe', '#apn': '123-45' });
    const res = await runTrainedPlaybook(pb.id, { mode: 'dry_run', vars: { query: 'GA' }, backend: fakeBackend(page) });
    const exec = res.execution!;
    expect(exec.extractedFields.map((f) => f.field).sort()).toEqual(['apn', 'owner']);
    expect(exec.extractedFields.find((f) => f.field === 'owner')!.value).toBe('Jane Doe');
    expect(exec.screenshots.length).toBe(1);
    expect(exec.qaNotes).toMatch(/Dry-run/);
    // and it's retrievable from the store
    const stored = listTrainingExecutions(pb.id);
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(exec.id);
  });
});

describe('dry-run is non-mutating', () => {
  it('does not click or type in dry-run, but does in live', async () => {
    const pb = approvedPlaybook(LP_STEPS);
    const dry = makeFakePage({ '#owner': 'J', '#apn': '1' });
    await runTrainedPlaybook(pb.id, { mode: 'dry_run', vars: { query: 'GA' }, backend: fakeBackend(dry.page) });
    expect(dry.log.clicks).toBe(0);
    expect(dry.log.types).toHaveLength(0);
    expect(dry.log.gotos.length).toBe(1); // navigation still happens (read-only)

    const live = makeFakePage({ '#owner': 'J', '#apn': '1' });
    await runTrainedPlaybook(pb.id, { mode: 'live', vars: { query: 'GA' }, backend: fakeBackend(live.page) });
    expect(live.log.clicks).toBe(1);
    expect(live.log.types).toEqual([{ sel: '#search', val: 'GA' }]);
  });
});

describe('Deal Card writeback', () => {
  it('writes captured facts to the Deal Card in live mode', async () => {
    const pb = approvedPlaybook(LP_STEPS);
    const { page } = makeFakePage({ '#owner': 'Jane Doe', '#apn': '123-45' });
    const res = await runTrainedPlaybook(pb.id, { mode: 'live', vars: { query: 'GA' }, dealCardId: 42, backend: fakeBackend(page) });
    expect(res.execution!.fieldsWritten).toBe(2);
    const facts = listBrowserFacts(42);
    expect(facts.map((f) => f.key).sort()).toEqual(['apn', 'owner']);
    expect(facts.find((f) => f.key === 'owner')!.value).toBe('Jane Doe');
    expect(facts.find((f) => f.key === 'owner')!.extractionMethod).toMatch(/trained playbook/);
  });

  it('does NOT write to the Deal Card in dry-run', async () => {
    const pb = approvedPlaybook(LP_STEPS);
    const { page } = makeFakePage({ '#owner': 'Jane Doe', '#apn': '123-45' });
    const res = await runTrainedPlaybook(pb.id, { mode: 'dry_run', vars: { query: 'GA' }, dealCardId: 43, backend: fakeBackend(page) });
    expect(res.execution!.fieldsWritten).toBe(0);
    expect(listBrowserFacts(43)).toHaveLength(0);
  });
});

describe('scope audit', () => {
  it('stops when a step navigates off the playbook host', async () => {
    const pb = approvedPlaybook({
      website: 'https://landportal.com/',
      steps: [
        { action: 'Navigate to map', url: 'https://landportal.com/map' },
        { action: 'Navigate away', url: 'https://evil.example.com/steal' },
        { action: 'Capture screenshot', note: 'x' },
      ],
    });
    const { page, log } = makeFakePage();
    const res = await runTrainedPlaybook(pb.id, { mode: 'dry_run', backend: fakeBackend(page) });
    // off-scope host stops before navigating there and before the screenshot
    expect(log.gotos).toEqual(['https://landportal.com/map']);
    expect(log.screenshots.length).toBe(0);
    expect(res.execution!.errors.join(' ')).toMatch(/off-scope/);
  });
});
