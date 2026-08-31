import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  PUBLIC_RECORDS_RECOVERY_PROFILE,
  runPublicRecordsRecovery,
  type PublicRecordsRecoveryHandback,
  type PublicRecordsRecoveryInput,
} from './public-records-recovery-specialist.js';
import type { EvidenceAdmissionInput } from './derived-intelligence-store.js';

const input = (overrides: Partial<PublicRecordsRecoveryInput> = {}): PublicRecordsRecoveryInput => ({
  runId: 'intel_22_recovery', dealCardId: 22, propertyCardId: 33,
  subject: { address: '0 Ridge Rd, Franklin TN', county: 'Williamson', state: 'TN', apn: '042-123.00-000', owner: null },
  deterministicFailureReason: 'TN layer: no_match — no row returned',
  attempts: [{ source: 'TN layer', status: 'no_match', note: 'No row returned.' }],
  unresolvedRequirements: ['Owner of record'],
  ...overrides,
});

const handback = (overrides: Partial<PublicRecordsRecoveryHandback> = {}): PublicRecordsRecoveryHandback => ({
  schemaVersion: '1.0', runId: 'intel_22_recovery', dealCardId: 22, propertyCardId: 33,
  status: 'RETURNED', deterministicFailureReason: 'TN layer returned no row', recoveryReason: 'Official county record matched.',
  subjectMatch: 'exact',
  sources: [{ id: 'county', name: 'Williamson County Assessor', url: 'https://example.gov/parcel/042123', sourceType: 'official_county_assessor', retrievedAt: '2026-08-30T12:00:00.000Z', official: true }],
  facts: [{ key: 'owner_of_record', label: 'Owner of record', value: 'RIDGE FAMILY LLC', sourceId: 'county', confidence: 'confirmed' }],
  artifacts: [{ kind: 'html', label: 'Parcel detail', path: 'C:/artifacts/parcel.html', url: null, sourceId: 'county' }],
  unresolvedRequirements: [], exactFailureReason: null, attempts: [{ route: 'county_property_search', status: 'matched' }],
  ...overrides,
});

describe('public-record recovery specialist', () => {
  it('invokes the one governed profile and admits exact-subject sourced facts with artifact provenance', async () => {
    const invoke = vi.fn(async (_args: string[], _timeoutMs: number, _signal?: AbortSignal) => 'done');
    const admit = vi.fn((_value: EvidenceAdmissionInput) => ({ evidenceIds: [81], duplicates: 0, propertyIdentityVersionId: 9, skippedReason: null }));
    const result = await runPublicRecordsRecovery(input(), {
      outputFile: path.join(os.tmpdir(), 'landos-public-record-recovery-test.json'),
      invoke, readFile: () => JSON.stringify(handback()), admit,
    });

    expect(result.status).toBe('RETURNED');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]?.[0]).toEqual(expect.arrayContaining(['--profile', PUBLIC_RECORDS_RECOVERY_PROFILE]));
    expect(admit).toHaveBeenCalledTimes(1);
    expect(admit.mock.calls[0]?.[0]).toMatchObject({ runId: 'intel_22_recovery', dealCardId: 22 });
    expect(admit.mock.calls[0]?.[0].rows[0]).toMatchObject({
      factKey: 'owner_of_record', sourceName: 'Williamson County Assessor',
      artifactRef: 'C:/artifacts/parcel.html',
    });
  });

  it('retains a subject mismatch classification but admits no facts', async () => {
    const admit = vi.fn();
    const mismatch = handback({ subjectMatch: 'mismatch', status: 'PARTIAL', facts: [], exactFailureReason: 'Returned APN differed from the canonical APN.' });
    const result = await runPublicRecordsRecovery(input(), {
      outputFile: path.join(os.tmpdir(), 'landos-public-record-mismatch-test.json'),
      invoke: async () => '', readFile: () => JSON.stringify(mismatch), admit,
    });
    expect(result.status).toBe('PARTIAL');
    expect(result.handback?.subjectMatch).toBe('mismatch');
    expect(admit).not.toHaveBeenCalled();
  });

  it('rejects a non-exact handback that tries to return subject facts', async () => {
    const result = await runPublicRecordsRecovery(input(), {
      outputFile: path.join(os.tmpdir(), 'landos-public-record-invalid-test.json'),
      invoke: async () => '', readFile: () => JSON.stringify(handback({ subjectMatch: 'mismatch' })),
    });
    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('non-exact');
  });

  it('does not invoke the specialist after cancellation', async () => {
    const controller = new AbortController(); controller.abort();
    const invoke = vi.fn(async () => '');
    const result = await runPublicRecordsRecovery(input({ signal: controller.signal }), {
      outputFile: path.join(os.tmpdir(), 'landos-public-record-cancel-test.json'), invoke,
    });
    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('cancelled');
    expect(invoke).not.toHaveBeenCalled();
  });
});
