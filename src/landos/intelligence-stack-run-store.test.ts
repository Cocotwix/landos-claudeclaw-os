import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb } from './db.js';
import { cancelRunProgress, startRunProgress } from './intelligence-run-progress.js';
import { IntelligenceStackRunStore, resetIntelligenceStackRunStoreCache } from './intelligence-stack-run-store.js';

beforeEach(() => {
  _initTestLandosDb();
  resetIntelligenceStackRunStoreCache();
});

describe('IntelligenceStackRunStore authority', () => {
  it('supersedes an older run before the newer run becomes authoritative', () => {
    const store = new IntelligenceStackRunStore();
    store.create({ runId: 'run_1', dealCardId: 93, startedAt: '2026-08-30T12:00:00.000Z', progress: startRunProgress('run_1', '2026-08-30T12:00:00.000Z') });
    store.create({ runId: 'run_2', dealCardId: 93, startedAt: '2026-08-30T12:01:00.000Z', progress: startRunProgress('run_2', '2026-08-30T12:01:00.000Z') });

    expect(store.get('run_1')).toMatchObject({ status: 'superseded', authoritative: false });
    expect(store.active(93)?.runId).toBe('run_2');
    expect(store.isAuthoritative('run_1', 93)).toBe(false);
    expect(store.isAuthoritative('run_2', 93)).toBe(true);
  });

  it('revokes authority before a cancelled run can update progress or finish', () => {
    const store = new IntelligenceStackRunStore();
    const startedAt = '2026-08-30T12:00:00.000Z';
    const opened = store.create({ runId: 'run_cancel', dealCardId: 92, startedAt, progress: startRunProgress('run_cancel', startedAt) });
    const cancelled = cancelRunProgress(opened.progress, '2026-08-30T12:02:00.000Z');

    expect(store.cancel('run_cancel', 92, cancelled)).toBe(true);
    expect(store.isAuthoritative('run_cancel', 92)).toBe(false);
    expect(store.updateProgress('run_cancel', 92, opened.progress)).toBe(false);
    expect(store.finish({ runId: 'run_cancel', dealCardId: 92, status: 'complete', progress: opened.progress })).toBe(false);
    expect(store.latest(92)).toMatchObject({ status: 'cancelled', cancelRequested: true, authoritative: false });
  });

  it('reclaims a run whose owning process predates this process', () => {
    const store = new IntelligenceStackRunStore();
    const startedAt = '2026-08-30T12:00:00.000Z';
    store.create({ runId: 'run_orphan', dealCardId: 91, startedAt, progress: startRunProgress('run_orphan', startedAt) });

    expect(store.reclaimAbandoned(20 * 60_000, Date.parse('2026-08-30T12:01:00.000Z'), '2026-08-30T12:00:30.000Z')).toBe(1);
    expect(store.latest(91)).toMatchObject({ status: 'failed', authoritative: false, progress: { status: 'failed' } });
  });
});
