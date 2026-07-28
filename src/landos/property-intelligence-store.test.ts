import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb, getLandosDb } from './db.js';
import {
  PropertyIntelligenceStore,
  redactPropertyIntelligence,
  resetPropertyIntelligenceStoreCache,
} from './property-intelligence-store.js';
import { initialSpecialistRecords, type PropertyIntelligenceProgress, type PropertyIntelligenceSnapshot } from './property-intelligence-snapshot.js';

function snapshot(overrides: Partial<PropertyIntelligenceSnapshot> = {}): PropertyIntelligenceSnapshot {
  return {
    snapshotVersion: 1,
    dealCardId: 32,
    runId: 'pi_1',
    sequence: 1,
    isPrimary: true,
    status: 'complete',
    startedAt: '2026-07-25T00:00:00.000Z',
    completedAt: '2026-07-25T00:05:00.000Z',
    durationMs: 300_000,
    identity: {
      state: 'confirmed', normalizedAddress: 'OLD RIDGE RD', county: 'Roane', state_: 'TN',
      apn: '073090 04200', apnVariants: ['073090 04200'], owner: 'SACHAN DILEEP S', ownerMailing: null,
      situs: 'OLD RIDGE RD', acres: 12.28, acreageBasis: 'deeded', coordinates: null,
      hasParcelGeometry: false, sourceConfidence: 'high', conflicts: [], explanation: 'Confirmed.',
    },
    facts: [], governmentRecords: [], dueDiligence: [],
    comps: { policyExplanation: '', landPortalUsable: false, landPortalRowsSeen: 0, caps: { zillow: 5, redfin: 5 }, sold: [], active: [], landHomeOnly: [], rejected: [], duplicatesMerged: 0, summaryLine: '' },
    valuation: { priceable: false, range: null, pricePerAcreRange: null, likelyRetail: null, dispositionRange: null, basis: '', adjustments: [], confidence: 'none', uncertainty: [], materialGaps: [], notPriceableReason: 'No comps.', nextActionToPrice: 'Widen the search.' },
    strategies: [],
    recommendation: { preferredStrategy: null, why: '', whatWouldChangeIt: [], posture: 'undetermined', postureWhy: '' },
    evidence: [], specialists: [],
    headline: { keyOpportunity: '', topRisks: [], confidence: 'low', confidenceWhy: '' },
    blockers: [], missingInformation: [], nextActions: [],
    ...overrides,
  };
}

beforeEach(() => {
  _initTestLandosDb();
  resetPropertyIntelligenceStoreCache();
});

describe('PropertyIntelligenceStore snapshot precedence', () => {
  const open = (store: PropertyIntelligenceStore, runId: string) =>
    store.createRun({ runId, dealCardId: 32, trigger: 'operator', startedAt: '2026-07-25T00:00:00.000Z', specialists: initialSpecialistRecords() });

  it('an OLDER attempt that finishes last never overrides the newer snapshot', () => {
    // Two runs can genuinely overlap: a slow one started first, a re-run finished
    // first. Without a precedence guard the straggler would demote the newer
    // result purely by finishing last, and the operator would silently lose the
    // more recent read.
    const store = new PropertyIntelligenceStore();
    const older = open(store, 'pi_older');
    const newer = open(store, 'pi_newer');
    expect(older.sequence).toBe(1);
    expect(newer.sequence).toBe(2);

    store.completeRun({ runId: 'pi_newer', dealCardId: 32, status: 'complete', completedAt: '2026-07-25T00:05:00.000Z', snapshot: snapshot({ runId: 'pi_newer', sequence: 2 }) });
    store.completeRun({ runId: 'pi_older', dealCardId: 32, status: 'complete', completedAt: '2026-07-25T00:09:00.000Z', snapshot: snapshot({ runId: 'pi_older', sequence: 1 }) });

    const primary = store.primaryRun(32)!;
    expect(primary.runId).toBe('pi_newer');
    expect(primary.sequence).toBe(2);
    // The late straggler is still stored in full, simply not the current read.
    const stored = store.getRun('pi_older')!;
    expect(stored.isPrimary).toBe(false);
    expect(stored.snapshot).toBeTruthy();
  });

  it('a newer attempt DOES take over from an older one', () => {
    const store = new PropertyIntelligenceStore();
    open(store, 'pi_1');
    store.completeRun({ runId: 'pi_1', dealCardId: 32, status: 'complete', completedAt: '2026-07-25T00:05:00.000Z', snapshot: snapshot({ runId: 'pi_1', sequence: 1 }) });
    open(store, 'pi_2');
    store.completeRun({ runId: 'pi_2', dealCardId: 32, status: 'complete_with_gaps', completedAt: '2026-07-25T00:15:00.000Z', snapshot: snapshot({ runId: 'pi_2', sequence: 2 }) });

    expect(store.primaryRun(32)!.runId).toBe('pi_2');
    expect(store.getRun('pi_1')!.isPrimary).toBe(false);
  });

  it('a failed attempt never demotes the current snapshot', () => {
    const store = new PropertyIntelligenceStore();
    open(store, 'pi_good');
    store.completeRun({ runId: 'pi_good', dealCardId: 32, status: 'complete', completedAt: '2026-07-25T00:05:00.000Z', snapshot: snapshot({ runId: 'pi_good', sequence: 1 }) });
    open(store, 'pi_bad');
    store.completeRun({ runId: 'pi_bad', dealCardId: 32, status: 'failed', completedAt: '2026-07-25T00:15:00.000Z', snapshot: null, error: 'LandPortal unreachable', failureCategory: 'network' });

    expect(store.primaryRun(32)!.runId).toBe('pi_good');
    expect(store.latestRun(32)!.runId).toBe('pi_bad');
  });

  it('keeps precedence per Deal Card, never across cards', () => {
    const store = new PropertyIntelligenceStore();
    store.createRun({ runId: 'pi_32', dealCardId: 32, trigger: 'operator', startedAt: '2026-07-25T00:00:00.000Z', specialists: initialSpecialistRecords() });
    store.createRun({ runId: 'pi_47', dealCardId: 47, trigger: 'operator', startedAt: '2026-07-25T00:00:00.000Z', specialists: initialSpecialistRecords() });
    store.completeRun({ runId: 'pi_47', dealCardId: 47, status: 'complete', completedAt: '2026-07-25T00:05:00.000Z', snapshot: snapshot({ dealCardId: 47, runId: 'pi_47', sequence: 1 }) });
    store.completeRun({ runId: 'pi_32', dealCardId: 32, status: 'complete', completedAt: '2026-07-25T00:09:00.000Z', snapshot: snapshot({ dealCardId: 32, runId: 'pi_32', sequence: 1 }) });

    expect(store.primaryRun(32)!.runId).toBe('pi_32');
    expect(store.primaryRun(47)!.runId).toBe('pi_47');
  });
});

describe('PropertyIntelligenceStore run lifecycle', () => {
  it('creates a run with every specialist queued', () => {
    const store = new PropertyIntelligenceStore();
    const run = store.createRun({ runId: 'pi_a', dealCardId: 32, trigger: 'operator', startedAt: '2026-07-25T00:00:00.000Z', specialists: initialSpecialistRecords() });
    expect(run.sequence).toBe(1);
    expect(run.status).toBe('running');
    expect(run.isPrimary).toBe(false);

    const specialists = store.listSpecialists('pi_a');
    expect(specialists).toHaveLength(initialSpecialistRecords().length);
    expect(specialists.every((s) => s.status === 'queued')).toBe(true);
    expect(specialists.every((s) => s.dealCardId === 32)).toBe(true);
  });

  it('rejects a run without a valid Deal Card', () => {
    const store = new PropertyIntelligenceStore();
    expect(() => store.createRun({ runId: 'bad', dealCardId: 0, trigger: 'operator', startedAt: 'now', specialists: [] }))
      .toThrow(/valid Deal Card/);
  });

  it('records specialist progress and classified failures', () => {
    const store = new PropertyIntelligenceStore();
    store.createRun({ runId: 'pi_b', dealCardId: 7, trigger: 'operator', startedAt: 'now', specialists: initialSpecialistRecords() });
    store.updateSpecialist({ runId: 'pi_b', specialistId: 'parcel_identity', status: 'running', startedAt: '2026-07-25T00:00:01.000Z' });
    store.updateSpecialist({
      runId: 'pi_b', specialistId: 'government_records', status: 'failed',
      summary: 'County host refused the request.', failureCategory: 'provider_unavailable',
      failureMessage: 'HTTP 503 from the county record host.', retryable: true,
      completedAt: '2026-07-25T00:00:20.000Z', durationMs: 19_000,
    });
    const rows = store.listSpecialists('pi_b');
    const identity = rows.find((r) => r.id === 'parcel_identity')!;
    const gov = rows.find((r) => r.id === 'government_records')!;
    expect(identity.status).toBe('running');
    expect(gov.status).toBe('failed');
    expect(gov.failureCategory).toBe('provider_unavailable');
    expect(gov.retryable).toBe(true);
    expect(gov.durationMs).toBe(19_000);
  });

  it('promotes the completed run to primary for its Deal Card only', () => {
    const store = new PropertyIntelligenceStore();
    store.createRun({ runId: 'pi_c1', dealCardId: 10, trigger: 'operator', startedAt: 'now', specialists: initialSpecialistRecords() });
    store.completeRun({ runId: 'pi_c1', dealCardId: 10, status: 'complete', completedAt: 'later', snapshot: snapshot({ dealCardId: 10, runId: 'pi_c1' }) });

    store.createRun({ runId: 'pi_other', dealCardId: 11, trigger: 'operator', startedAt: 'now', specialists: initialSpecialistRecords() });
    store.completeRun({ runId: 'pi_other', dealCardId: 11, status: 'complete', completedAt: 'later', snapshot: snapshot({ dealCardId: 11, runId: 'pi_other' }) });

    expect(store.primaryRun(10)?.runId).toBe('pi_c1');
    expect(store.primaryRun(11)?.runId).toBe('pi_other');
  });

  it('a rerun creates a new sequence and demotes only the prior snapshot for that card', () => {
    const store = new PropertyIntelligenceStore();
    store.createRun({ runId: 'pi_d1', dealCardId: 32, trigger: 'operator', startedAt: 'now', specialists: initialSpecialistRecords() });
    store.completeRun({ runId: 'pi_d1', dealCardId: 32, status: 'complete', completedAt: 'later', snapshot: snapshot({ runId: 'pi_d1', sequence: 1 }) });
    const second = store.createRun({ runId: 'pi_d2', dealCardId: 32, trigger: 'operator', startedAt: 'now', specialists: initialSpecialistRecords() });
    expect(second.sequence).toBe(2);
    // While the rerun is in flight the previous snapshot stays primary.
    expect(store.primaryRun(32)?.runId).toBe('pi_d1');

    store.completeRun({ runId: 'pi_d2', dealCardId: 32, status: 'complete_with_gaps', completedAt: 'later', snapshot: snapshot({ runId: 'pi_d2', sequence: 2, status: 'complete_with_gaps' }) });
    expect(store.primaryRun(32)?.runId).toBe('pi_d2');

    const history = store.history(32);
    expect(history.map((r) => r.runId)).toEqual(['pi_d2', 'pi_d1']);
    // The prior snapshot is retained, not overwritten.
    expect(history[1].snapshot?.runId).toBe('pi_d1');
  });

  it('a failed rerun never displaces the last good snapshot', () => {
    const store = new PropertyIntelligenceStore();
    store.createRun({ runId: 'pi_e1', dealCardId: 5, trigger: 'operator', startedAt: 'now', specialists: initialSpecialistRecords() });
    store.completeRun({ runId: 'pi_e1', dealCardId: 5, status: 'complete', completedAt: 'later', snapshot: snapshot({ dealCardId: 5, runId: 'pi_e1' }) });
    store.createRun({ runId: 'pi_e2', dealCardId: 5, trigger: 'operator', startedAt: 'now', specialists: initialSpecialistRecords() });
    store.completeRun({ runId: 'pi_e2', dealCardId: 5, status: 'failed', completedAt: 'later', snapshot: null, error: 'boom', failureCategory: 'crash' });

    expect(store.primaryRun(5)?.runId).toBe('pi_e1');
    expect(store.latestRun(5)?.runId).toBe('pi_e2');
    expect(store.latestRun(5)?.failureCategory).toBe('crash');
  });

  it('tracks the in-flight run and clears it on completion', () => {
    const store = new PropertyIntelligenceStore();
    store.createRun({ runId: 'pi_f', dealCardId: 3, trigger: 'operator', startedAt: 'now', specialists: initialSpecialistRecords() });
    expect(store.activeRun(3)?.runId).toBe('pi_f');
    store.completeRun({ runId: 'pi_f', dealCardId: 3, status: 'complete', completedAt: 'later', snapshot: snapshot({ dealCardId: 3, runId: 'pi_f' }) });
    expect(store.activeRun(3)).toBeNull();
  });

  /** Age a run's rows so they model a process that died rather than one still working. */
  function ageRun(runId: string, stampIso: string): void {
    const db = getLandosDb();
    db.prepare('UPDATE landos_property_intelligence_run SET updated_at = ? WHERE run_id = ?').run(stampIso, runId);
    db.prepare('UPDATE landos_property_intelligence_specialist SET updated_at = ? WHERE run_id = ?').run(stampIso, runId);
  }

  it('reclaims runs stranded by a restart', () => {
    const store = new PropertyIntelligenceStore();
    store.createRun({ runId: 'pi_g', dealCardId: 9, trigger: 'operator', startedAt: '2020-01-01T00:00:00.000Z', specialists: initialSpecialistRecords() });
    // A dead process stops touching its rows. That, not elapsed time, is what
    // makes a run stranded.
    ageRun('pi_g', '2020-01-01T00:00:00.000Z');
    const reclaimed = store.reclaimStaleRuns(60_000, Date.parse('2026-07-25T00:00:00.000Z'), '2019-01-01T00:00:00.000Z');
    expect(reclaimed).toBe(1);
    const run = store.getRun('pi_g')!;
    expect(run.status).toBe('failed');
    expect(run.failureCategory).toBe('crash');
    expect(store.listSpecialists('pi_g').every((s) => s.status === 'failed')).toBe(true);
  });

  it('reclaims a run orphaned by a restart at once, without waiting out the window', () => {
    // Until it does, the Deal Card refuses a new launch for up to half an hour
    // against a mission that nothing is executing.
    const store = new PropertyIntelligenceStore();
    store.createRun({ runId: 'pi_orphan', dealCardId: 12, trigger: 'operator', startedAt: '2026-07-27T00:00:00.000Z', specialists: initialSpecialistRecords() });
    store.updateSpecialist({ runId: 'pi_orphan', specialistId: 'parcel_identity', status: 'running' });
    expect(store.activeRun(12)?.runId).toBe('pi_orphan');

    // The process restarted one second later: nothing here can still be running.
    const reclaimed = store.reclaimStaleRuns(30 * 60_000, Date.parse('2026-07-27T00:00:05.000Z'), '2026-07-27T00:00:01.000Z');
    expect(reclaimed).toBe(1);
    expect(store.activeRun(12)).toBeNull();
    expect(store.getRun('pi_orphan')!.status).toBe('failed');
  });

  it('never reclaims a long-running mission whose specialists are still settling', () => {
    // A subject-research lane that reuses the full LandPortal/county research
    // system legitimately runs for many minutes. The reclaimer is consulted on
    // every operator poll, so aborting on elapsed time alone would reliably kill
    // a healthy mission mid-flight.
    const store = new PropertyIntelligenceStore();
    // Started inside THIS process, so it is not orphaned — only its run row is
    // old, because the run row is written once and the specialists carry progress.
    const startedAt = new Date().toISOString();
    store.createRun({ runId: 'pi_long', dealCardId: 11, trigger: 'operator', startedAt, specialists: initialSpecialistRecords() });
    ageRun('pi_long', '2020-01-01T00:00:00.000Z');
    // One specialist reports progress right now.
    store.updateSpecialist({ runId: 'pi_long', specialistId: 'parcel_identity', status: 'running', summary: 'Reading the LandPortal parcel page.' });

    const reclaimed = store.reclaimStaleRuns(60_000, Date.now(), '2019-01-01T00:00:00.000Z');
    expect(reclaimed).toBe(0);
    expect(store.getRun('pi_long')!.status).toBe('running');
    expect(store.activeRun(11)?.runId).toBe('pi_long');
  });

  it('never leaks a snapshot onto another Deal Card', () => {
    const store = new PropertyIntelligenceStore();
    store.createRun({ runId: 'pi_h', dealCardId: 20, trigger: 'operator', startedAt: 'now', specialists: initialSpecialistRecords() });
    store.completeRun({ runId: 'pi_h', dealCardId: 20, status: 'complete', completedAt: 'later', snapshot: snapshot({ dealCardId: 20, runId: 'pi_h' }) });
    expect(store.primaryRun(21)).toBeNull();
    expect(store.latestRun(21)).toBeNull();
    expect(store.listSpecialists('pi_h').every((s) => s.dealCardId === 20)).toBe(true);
  });

  it('deletes only the target card when acceptance data is cleaned up', () => {
    const store = new PropertyIntelligenceStore();
    store.createRun({ runId: 'pi_i', dealCardId: 40, trigger: 'operator', startedAt: 'now', specialists: initialSpecialistRecords() });
    store.createRun({ runId: 'pi_j', dealCardId: 41, trigger: 'operator', startedAt: 'now', specialists: initialSpecialistRecords() });
    store.deleteForDealCard(40);
    expect(store.latestRun(40)).toBeNull();
    expect(store.latestRun(41)?.runId).toBe('pi_j');
    expect(store.listSpecialists('pi_i')).toHaveLength(0);
    expect(store.listSpecialists('pi_j').length).toBeGreaterThan(0);
  });
});

describe('PropertyIntelligenceStore progressive content', () => {
  function progressFor(runId: string, dealCardId: number): PropertyIntelligenceProgress {
    return {
      preliminary: true,
      runId,
      dealCardId,
      sequence: 1,
      updatedAt: '2026-07-27T00:00:10.000Z',
      settled: ['parcel_identity'],
      outstanding: ['comparables', 'valuation'],
      snapshot: {
        ...snapshot({ dealCardId, runId, status: 'running', completedAt: null, isPrimary: false }),
        preliminary: true,
      },
    };
  }

  it('stores progressive content on a running run WITHOUT touching promotion', () => {
    const store = new PropertyIntelligenceStore();
    store.createRun({ runId: 'pi_prog', dealCardId: 60, trigger: 'operator', startedAt: 'now', specialists: initialSpecialistRecords() });

    const wrote = store.updateProgress({ runId: 'pi_prog', dealCardId: 60, progress: progressFor('pi_prog', 60) });
    expect(wrote).toBe(true);

    const run = store.getRun('pi_prog')!;
    expect(run.progress).toBeTruthy();
    expect(run.progress!.preliminary).toBe(true);
    expect(run.progress!.settled).toEqual(['parcel_identity']);
    expect(run.progress!.snapshot.preliminary).toBe(true);
    expect(run.progress!.snapshot.isPrimary).toBe(false);
    // The run itself is unchanged: still running, no snapshot, never promoted.
    expect(run.status).toBe('running');
    expect(run.isPrimary).toBe(false);
    expect(run.snapshot).toBeNull();
    expect(store.primaryRun(60)).toBeNull();
  });

  it('preliminary content never displaces the prior promoted snapshot', () => {
    const store = new PropertyIntelligenceStore();
    store.createRun({ runId: 'pi_prog_a', dealCardId: 61, trigger: 'operator', startedAt: 'now', specialists: initialSpecialistRecords() });
    store.completeRun({ runId: 'pi_prog_a', dealCardId: 61, status: 'complete', completedAt: 'later', snapshot: snapshot({ dealCardId: 61, runId: 'pi_prog_a' }) });

    store.createRun({ runId: 'pi_prog_b', dealCardId: 61, trigger: 'operator', startedAt: 'now', specialists: initialSpecialistRecords() });
    store.updateProgress({ runId: 'pi_prog_b', dealCardId: 61, progress: progressFor('pi_prog_b', 61) });

    // The promoted read is untouched by any number of progressive writes.
    expect(store.primaryRun(61)!.runId).toBe('pi_prog_a');
    expect(store.primaryRun(61)!.snapshot).toBeTruthy();
    expect(store.activeRun(61)!.progress!.runId).toBe('pi_prog_b');
  });

  it('refuses progressive content on a run that is no longer running', () => {
    const store = new PropertyIntelligenceStore();
    store.createRun({ runId: 'pi_prog_done', dealCardId: 62, trigger: 'operator', startedAt: 'now', specialists: initialSpecialistRecords() });
    store.completeRun({ runId: 'pi_prog_done', dealCardId: 62, status: 'complete', completedAt: 'later', snapshot: snapshot({ dealCardId: 62, runId: 'pi_prog_done' }) });

    const wrote = store.updateProgress({ runId: 'pi_prog_done', dealCardId: 62, progress: progressFor('pi_prog_done', 62) });
    expect(wrote).toBe(false);
    expect(store.getRun('pi_prog_done')!.progress).toBeNull();
  });

  it('completion clears progressive content so a finished run never serves stale mid-flight data', () => {
    const store = new PropertyIntelligenceStore();
    store.createRun({ runId: 'pi_prog_clear', dealCardId: 63, trigger: 'operator', startedAt: 'now', specialists: initialSpecialistRecords() });
    store.updateProgress({ runId: 'pi_prog_clear', dealCardId: 63, progress: progressFor('pi_prog_clear', 63) });
    expect(store.getRun('pi_prog_clear')!.progress).toBeTruthy();

    store.completeRun({ runId: 'pi_prog_clear', dealCardId: 63, status: 'complete', completedAt: 'later', snapshot: snapshot({ dealCardId: 63, runId: 'pi_prog_clear' }) });
    const run = store.getRun('pi_prog_clear')!;
    expect(run.progress).toBeNull();
    expect(run.snapshot).toBeTruthy();
    expect(run.isPrimary).toBe(true);
  });

  it('a reclaimed (crashed) run loses its progressive content too', () => {
    const store = new PropertyIntelligenceStore();
    store.createRun({ runId: 'pi_prog_crash', dealCardId: 64, trigger: 'operator', startedAt: '2020-01-01T00:00:00.000Z', specialists: initialSpecialistRecords() });
    store.updateProgress({ runId: 'pi_prog_crash', dealCardId: 64, progress: progressFor('pi_prog_crash', 64) });

    const reclaimed = store.reclaimStaleRuns(60_000, Date.parse('2026-07-25T00:00:00.000Z'), '2021-01-01T00:00:00.000Z');
    expect(reclaimed).toBe(1);
    const run = store.getRun('pi_prog_crash')!;
    expect(run.status).toBe('failed');
    expect(run.progress).toBeNull();
  });

  it('redacts secrets inside progressive content before it is stored', () => {
    const store = new PropertyIntelligenceStore();
    store.createRun({ runId: 'pi_prog_redact', dealCardId: 65, trigger: 'operator', startedAt: 'now', specialists: initialSpecialistRecords() });
    const progress = progressFor('pi_prog_redact', 65);
    (progress.snapshot as unknown as Record<string, unknown>).apiKey = 'REDACTION-FIXTURE-NOT-A-CREDENTIAL';
    store.updateProgress({ runId: 'pi_prog_redact', dealCardId: 65, progress });
    const stored = store.getRun('pi_prog_redact')!.progress!;
    expect((stored.snapshot as unknown as Record<string, unknown>).apiKey).toBe('[redacted]');
  });
});

describe('redactPropertyIntelligence', () => {
  it('strips secret-bearing keys and query parameters', () => {
    const redacted = redactPropertyIntelligence({
      password: 'REDACTION-FIXTURE-NOT-A-CREDENTIAL',
      apiKey: 'abc',
      nested: { authorization: 'Bearer x', url: 'https://x.test/a?token=zzz&ok=1' },
      safe: 'kept',
    }) as Record<string, unknown>;
    expect(redacted.password).toBe('[redacted]');
    expect(redacted.apiKey).toBe('[redacted]');
    const nested = redacted.nested as Record<string, unknown>;
    expect(nested.authorization).toBe('[redacted]');
    expect(nested.url).toBe('https://x.test/a?token=[redacted]&ok=1');
    expect(redacted.safe).toBe('kept');
  });

  it('redacts specialist results before they reach the store', () => {
    const store = new PropertyIntelligenceStore();
    store.createRun({ runId: 'pi_k', dealCardId: 2, trigger: 'operator', startedAt: 'now', specialists: initialSpecialistRecords() });
    store.updateSpecialist({ runId: 'pi_k', specialistId: 'parcel_identity', status: 'completed', result: { password: 'REDACTION-FIXTURE-NOT-A-CREDENTIAL', apn: '073090 04200' } });
    const row = store.listSpecialists('pi_k').find((r) => r.id === 'parcel_identity')!;
    expect((row.result as Record<string, unknown>).password).toBe('[redacted]');
    expect((row.result as Record<string, unknown>).apn).toBe('073090 04200');
  });
});

describe('redaction must not break legitimate asset URLs', () => {
  it('keeps a non-secret `key=` parameter intact', () => {
    // Live finding on Deal 32: every retained LandPortal screenshot 404'd
    // because the stored viewUrl had been rewritten to key=[redacted].
    const redacted = redactPropertyIntelligence({
      viewUrl: '/api/landos/inspection/image?cardId=32&key=parcel_page',
    }) as Record<string, string>;
    expect(redacted.viewUrl).toBe('/api/landos/inspection/image?cardId=32&key=parcel_page');
  });

  it('still redacts secret-shaped key parameters', () => {
    const redacted = redactPropertyIntelligence({
      a: 'https://x.test/a?api_key=abc123',
      b: 'https://x.test/b?apiKey=abc123',
      c: 'https://x.test/c?access_key=abc123',
      d: 'https://x.test/d?token=abc123',
      e: 'https://x.test/e?secret_key=abc123',
    }) as Record<string, string>;
    expect(redacted.a).toBe('https://x.test/a?api_key=[redacted]');
    expect(redacted.b).toBe('https://x.test/b?apiKey=[redacted]');
    expect(redacted.c).toBe('https://x.test/c?access_key=[redacted]');
    expect(redacted.d).toBe('https://x.test/d?token=[redacted]');
    expect(redacted.e).toBe('https://x.test/e?secret_key=[redacted]');
  });
});
