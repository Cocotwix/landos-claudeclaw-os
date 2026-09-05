// A slow but healthy Intelligence run must not be reclaimed as ownerless.
//
// The defect this pins: `reclaimAbandoned` used a 20-minute idle cutoff while a
// single specialist call is allowed up to `ANALYST_JUDGMENT_TIMEOUT_MS`, which
// is also 20 minutes. A run only touches `updated_at` when a STAGE changes, so
// a run sitting inside one slow market review looked idle at exactly the moment
// it was still working, and was failed with "no longer has an active owner".
// Controlled QA Card 128 died that way and its decision artifact could never be
// produced.
//
// The idle cutoff is now derived from the work timeout, so the two cannot drift
// back into that race. The genuine no-owner test — a run that started before
// this process did — is unchanged.

import { describe, expect, it } from 'vitest';

import { ANALYST_JUDGMENT_TIMEOUT_MS } from './acquisition-analyst.js';
import { getLandosDb, _initTestLandosDb } from './db.js';
import { ABANDONED_RUN_IDLE_MS, processOwnsIntelligenceRuns } from './intelligence-stack-run-store.js';

// The second way a healthy run was failed as ownerless: a process that is NOT
// the runtime registered the routes against the operating store and ran the
// reclaim with its own start time, so every run the runtime was still working
// on "started before this process" and was revoked. Two coverage runs died
// that way at 20:48:36 on 2026-09-04 when a vitest process started, and the
// Deal Brain decision one of them was about to write was rejected as late.
describe('who may reclaim Intelligence runs', () => {
  it('the managed runtime, launched with its runtime id, owns its runs', () => {
    expect(processOwnsIntelligenceRuns(['node', 'dist/index.js', '--landos-runtime-id=abc', '--landos-runtime-root=C:/x'], {})).toBe(true);
  });

  it('a test runner or an isolated QA store may reclaim (nothing the runtime owns lives there)', () => {
    expect(processOwnsIntelligenceRuns(['node', 'vitest'], { NODE_ENV: 'test' })).toBe(true);
    expect(processOwnsIntelligenceRuns(['node', 'tsx', 'release-cli.ts'], { LANDOS_STORAGE_MODE: 'qa' })).toBe(true);
  });

  it('any other process against the operating store never reclaims', () => {
    expect(processOwnsIntelligenceRuns(['node', 'tsx', 'some-script.mts'], { NODE_ENV: 'production' })).toBe(false);
    expect(processOwnsIntelligenceRuns(['node', 'dist/index.js'], {})).toBe(false);
  });
});

describe('a test process never opens the operating store', () => {
  it('gets an in-memory database from the lazy open, not the operating file', () => {
    // Fresh lazy open in this test process: must not be a file.
    _initTestLandosDb();
    const list = getLandosDb().pragma('database_list') as Array<{ name: string; file: string }>;
    expect(list.find((row) => row.name === 'main')?.file ?? '').toBe('');
  });
});

describe('the abandoned-run idle cutoff', () => {
  it('exceeds the longest single specialist call it supervises', () => {
    expect(ABANDONED_RUN_IDLE_MS).toBeGreaterThan(ANALYST_JUDGMENT_TIMEOUT_MS);
  });

  it('leaves real slack rather than sitting on the boundary', () => {
    // A cutoff equal to the work timeout is a coin flip on every slow run.
    expect(ABANDONED_RUN_IDLE_MS - ANALYST_JUDGMENT_TIMEOUT_MS).toBeGreaterThanOrEqual(5 * 60_000);
  });

  it('is derived from the timeout, so the two cannot silently drift apart', () => {
    // Asserted as a relationship, not a magic number: raising the specialist
    // timeout must raise this with it.
    expect(ABANDONED_RUN_IDLE_MS).toBe(ANALYST_JUDGMENT_TIMEOUT_MS + 10 * 60_000);
  });
});
