import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACQUISITION_INTELLIGENCE_SNAPSHOT_TYPE,
  persistAcquisitionIntelligence,
  readAcquisitionIntelligence,
  readAcquisitionIntelligenceHistory,
} from './acquisition-intelligence-store.js';
import type { AcquisitionIntelligenceResult } from './acquisition-intelligence-contract.js';

// The persistence contract an operator feels directly: a reload shows the same
// read, a refresh supersedes rather than destroys, and none of it is evidence.

const writes: Array<Record<string, unknown>> = [];
const current = new Map<string, unknown>();
const history: unknown[] = [];

vi.mock('./derived-intelligence-store.js', () => ({
  writeDerivedSnapshot: (input: Record<string, unknown>) => {
    writes.push(input);
    const key = `${input.dealCardId}:${input.snapshotType}`;
    if (current.has(key)) history.push(current.get(key));
    current.set(key, input.payload);
    return { snapshotId: writes.length, reused: false, propertyIdentityVersionId: 1, skippedReason: null };
  },
  readDerivedSnapshot: (dealCardId: number, snapshotType: string) => current.get(`${dealCardId}:${snapshotType}`) ?? null,
  readDerivedSnapshotHistory: () => [...history],
}));

function result(headline: string): AcquisitionIntelligenceResult {
  return {
    contractVersion: '1.0.0',
    dealCardId: 89,
    generatedAt: '2026-08-18T00:00:00.000Z',
    runtime: { engine: 'hermes', agentProfile: 'landos-acquisition-analyst', provider: 'ollama', model: 'gemma4:12b', modelSource: 'default', durationMs: 10 },
    dossierFingerprint: 'fp1',
    dealRead: { headline, judgment: 'j', confidence: 'Likely' },
    propertyStory: [], marketStory: [], opportunities: [],
    constraints: [], strategies: [], visualObservations: [],
    conflicts: [{ subject: 'frontage', statement: 's', resolution: 'Unresolved.' }],
    unknowns: [], nextActions: [],
    basis: { visualsAvailable: ['close_parcel_aerial'], coveragePresent: ['Property identity'], coverageAbsent: ['Current zoning'] },
    warnings: [],
  };
}

beforeEach(() => { writes.length = 0; current.clear(); history.length = 0; });

describe('persisting a read', () => {
  it('stores one current read that a reload returns unchanged', () => {
    persistAcquisitionIntelligence({ dealCardId: 89, result: result('first read') });
    expect(readAcquisitionIntelligence(89)?.dealRead.headline).toBe('first read');
    // Reading again is a SELECT: it must not write anything.
    readAcquisitionIntelligence(89);
    expect(writes).toHaveLength(1);
  });

  it('supersedes rather than destroys the judgment an operator may have acted on', () => {
    persistAcquisitionIntelligence({ dealCardId: 89, result: result('first read') });
    persistAcquisitionIntelligence({ dealCardId: 89, result: result('second read') });
    expect(readAcquisitionIntelligence(89)?.dealRead.headline).toBe('second read');
    expect(readAcquisitionIntelligenceHistory(89).map((entry) => entry.dealRead.headline)).toEqual(['first read']);
  });

  it('writes to its own snapshot type and names the runtime that produced it', () => {
    persistAcquisitionIntelligence({ dealCardId: 89, result: result('a read') });
    expect(writes[0].snapshotType).toBe(ACQUISITION_INTELLIGENCE_SNAPSHOT_TYPE);
    expect(String(writes[0].changeReason)).toMatch(/landos-acquisition-analyst on gemma4:12b/);
    expect(writes[0].actor).toBe('acquisition-intelligence');
  });

  it('records completeness so a bounded read is not mistaken for a full one', () => {
    persistAcquisitionIntelligence({ dealCardId: 89, result: result('a read') });
    expect(writes[0].completeness).toMatchObject({ conflicts: 1, coverageAbsent: ['Current zoning'] });
  });

  it('is a judgment, not evidence: it attaches no evidence rows', () => {
    persistAcquisitionIntelligence({ dealCardId: 89, result: result('a read') });
    expect(writes[0]).not.toHaveProperty('evidenceIds');
  });
});

describe('an unread Deal Card', () => {
  it('returns null rather than an empty judgment', () => {
    expect(readAcquisitionIntelligence(1234)).toBeNull();
  });
});
