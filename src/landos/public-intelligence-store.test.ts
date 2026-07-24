import { describe, expect, it } from 'vitest';
import { _initTestLandosDb } from './db.js';
import { PublicIntelligenceStore, redactPublicIntelligencePersistence } from './public-intelligence-store.js';
import type { PublicIntelligenceRun } from './public-property-intelligence.js';
import type { OrchestratorRun } from './property-intelligence-orchestrator.js';

const run = (): PublicIntelligenceRun => ({ status: 'complete', downstreamAllowed: true, captureMode: 'live', startedAt: '2026-07-13T00:00:00.000Z', completedAt: '2026-07-13T00:01:00.000Z', nonBlockingGaps: [], gate: { allowed: true, blocking: true, reasonCode: 'parcel_confirmed', explanation: 'confirmed' }, tasks: [] });

describe('public intelligence persistence (unit)', () => {
  it('reuses one Deal Card/parcel record and redacts secret-shaped values', () => {
    _initTestLandosDb();
    const store = new PublicIntelligenceStore();
    store.save(88, 'APN-1', run());
    store.save(88, 'APN-1', { ...run(), status: 'complete_with_gaps' });
    expect(store.load(88, 'APN-1')?.run.status).toBe('complete_with_gaps');
    expect(store.load(88, 'APN-1')?.orchestration).toBeNull();
    expect(JSON.stringify(redactPublicIntelligencePersistence({ password: 'nope', url: 'https://public.example/?token=nope' }))).not.toContain('nope');
  });

  it('persists and reloads the complete canonical orchestration payload', () => {
    _initTestLandosDb();
    const store = new PublicIntelligenceStore();
    const orchestration: OrchestratorRun = {
      status: 'complete_with_gaps', contractVersion: '1.0.0', propertyIntelligence: run(), compRuns: [], registry: null,
      compReconciliation: null, stages: [], validation: { valid: false, violations: ['fixture gap'] }, firstUsefulResultMs: 20,
      deadlineMs: 600_000, startedAt: run().startedAt, completedAt: run().completedAt, durationMs: 60_000,
      nonBlockingGaps: ['wetlands'], downstreamAllowed: true,
      subjectGeometry: { rings: [[[-83.2, 35.9], [-83.19, 35.9], [-83.19, 35.91], [-83.2, 35.9]]] },
    };
    store.save(89, 'APN-2', run(), orchestration);
    const loaded = store.load(89, 'APN-2');
    expect(loaded?.orchestration).toMatchObject({ contractVersion: '1.0.0', nonBlockingGaps: ['wetlands'] });
    expect(loaded?.orchestration?.subjectGeometry?.rings[0]).toHaveLength(4);
    expect(loaded?.orchestration?.propertyIntelligence).toEqual(loaded?.run);
  });

  it('retains the latest resolved parcel when a newer provisional retry is saved', () => {
    _initTestLandosDb();
    const store = new PublicIntelligenceStore();
    store.save(90, '015-027-04512-000-2026', run());
    store.save(90, 'unresolved:02704512', {
      ...run(),
      status: 'blocked_identity',
      downstreamAllowed: false,
      gate: { allowed: false, blocking: true, reasonCode: 'parcel_not_confirmed', explanation: 'retry did not confirm' },
    });

    expect(store.load(90)?.parcelKey).toBe('unresolved:02704512');
    expect(store.loadLatestResolved(90)?.parcelKey).toBe('015-027-04512-000-2026');
    expect(store.loadLatestResolved(90)?.run.status).toBe('complete');
  });
});
