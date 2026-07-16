import { describe, expect, it } from 'vitest';
import { _initTestLandosDb } from './db.js';
import { PublicIntelligenceStore, redactPublicIntelligencePersistence } from './public-intelligence-store.js';
import type { PublicIntelligenceRun } from './public-property-intelligence.js';

const run = (): PublicIntelligenceRun => ({ status: 'complete', downstreamAllowed: true, captureMode: 'live', startedAt: '2026-07-13T00:00:00.000Z', completedAt: '2026-07-13T00:01:00.000Z', nonBlockingGaps: [], gate: { allowed: true, blocking: true, reasonCode: 'parcel_confirmed', explanation: 'confirmed' }, tasks: [] });

describe('public intelligence persistence (unit)', () => {
  it('reuses one Deal Card/parcel record and redacts secret-shaped values', () => {
    _initTestLandosDb();
    const store = new PublicIntelligenceStore();
    store.save(88, 'APN-1', run());
    store.save(88, 'APN-1', { ...run(), status: 'complete_with_gaps' });
    expect(store.load(88, 'APN-1')?.run.status).toBe('complete_with_gaps');
    expect(JSON.stringify(redactPublicIntelligencePersistence({ password: 'nope', url: 'https://public.example/?token=nope' }))).not.toContain('nope');
  });
});
