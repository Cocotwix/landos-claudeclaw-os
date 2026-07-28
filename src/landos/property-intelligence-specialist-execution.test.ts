import { describe, expect, it } from 'vitest';

import {
  ACCESS_UTILITY_TASKS,
  ENVIRONMENTAL_TASKS,
  countyRecordFactsFromPublicRun,
  publicLaneExecution,
  publicTaskExecution,
  snapshotEvidenceFromPublicTasks,
} from './property-intelligence-specialist-execution.js';
import {
  runPublicPropertyIntelligence,
  type PublicIntelligenceRun,
  type PublicIntelligenceTaskRecord,
} from './public-property-intelligence.js';

const AT = '2026-07-28T00:00:00.000Z';

function confirmedSubject() {
  return {
    rawInput: '1488 Liberty Hwy, Six Mile, SC',
    normalizedAddress: '1488 Liberty Hwy',
    county: 'Pickens',
    state: 'SC',
    requestedApn: '4068-00-37-1227',
    resolvedApn: '4068-00-37-1227',
    resolutionStatus: 'confirmed' as const,
    resolutionExplanation: 'Discovery-stage parcel evidence agrees.',
  };
}

function task(overrides: Partial<PublicIntelligenceTaskRecord>): PublicIntelligenceTaskRecord {
  return {
    task: 'county_records',
    label: 'Official county records',
    role: 'official_records',
    status: 'succeeded',
    startedAt: AT,
    completedAt: AT,
    durationMs: 1,
    timeoutMs: 30_000,
    evidence: [],
    retryEligible: false,
    confidence: 'high',
    blocking: false,
    diagnostics: { adapterId: 'official_county_records' },
    attempts: 1,
    providerOutcomes: [{
      providerId: 'official_county_records',
      status: 'succeeded',
      attemptCount: 1,
      evidenceCount: 0,
      note: 'Official source responded.',
    }],
    ...overrides,
  };
}

function run(tasks: PublicIntelligenceTaskRecord[]): PublicIntelligenceRun {
  return {
    status: 'complete_with_gaps',
    downstreamAllowed: true,
    gate: { allowed: true, blocking: true, reasonCode: 'parcel_confirmed', explanation: 'Subject established.' },
    captureMode: 'live',
    tasks,
    nonBlockingGaps: [],
    startedAt: AT,
    completedAt: AT,
  };
}

describe('specialist public-source execution truth', () => {
  it('does not count identity-gated placeholder tasks as environmental screening', () => {
    const blocked: PublicIntelligenceRun = {
      ...run([]),
      status: 'blocked_identity',
      downstreamAllowed: false,
      gate: {
        allowed: false,
        blocking: true,
        reasonCode: 'requested_apn_not_resolved',
        explanation: 'The requested APN has not been confirmed by a parcel source.',
      },
      tasks: ENVIRONMENTAL_TASKS.map((kind) => task({
        task: kind,
        label: kind,
        role: 'public_core',
        status: 'skipped_identity_gate',
        diagnostics: {},
        attempts: 0,
        providerOutcomes: [{
          providerId: `provider_${kind}`,
          status: 'skipped_identity_gate',
          attemptCount: 0,
          evidenceCount: 0,
          note: 'The requested APN has not been confirmed by a parcel source.',
        }],
        failureReason: 'The requested APN has not been confirmed by a parcel source.',
      })),
    };

    const lane = publicLaneExecution(blocked, ENVIRONMENTAL_TASKS);
    expect(lane.attemptedCount).toBe(0);
    expect(lane.retrievedCount).toBe(0);
    expect(lane.summary).toMatch(/^No source collector ran/);
    expect(lane.limitations.join(' ')).toMatch(/requested APN has not been confirmed/i);
  });

  it('records zero attempts for tasks with no connected adapter', async () => {
    const result = await runPublicPropertyIntelligence(confirmedSubject(), {
      adapters: [],
      captureMode: 'live',
      now: () => AT,
      clockMs: () => 1,
    });
    expect(result.tasks.every((item) => item.status === 'unavailable')).toBe(true);
    expect(result.tasks.every((item) => item.attempts === 0)).toBe(true);
    expect(result.tasks.every((item) => item.providerOutcomes?.[0]?.attemptCount === 0)).toBe(true);
    expect(publicLaneExecution(result, ACCESS_UTILITY_TASKS).attemptedCount).toBe(0);
    expect(publicTaskExecution(result, 'utilities').limitation).toMatch(/not connected/i);
  });

  it('counts a collector that actually reached a source even when that source returns a scoped block', () => {
    const result = run([task({
      task: 'utilities',
      label: 'Utilities',
      role: 'public_core',
      status: 'blocked',
      confidence: 'none',
      failureReason: 'The utility authority lookup denied anonymous access.',
      providerOutcomes: [{
        providerId: 'utility_authority_lookup',
        status: 'blocked',
        attemptCount: 1,
        evidenceCount: 0,
        note: 'The utility authority lookup denied anonymous access.',
      }],
    })]);
    const execution = publicTaskExecution(result, 'utilities');
    expect(execution.attempted).toBe(true);
    expect(execution.retrieved).toBe(false);
    expect(execution.limitation).toMatch(/denied anonymous access/i);
  });

  it('projects subject-only county facts and evidence from the collector that ran', () => {
    const result = run([task({
      evidence: [{
        evidenceId: 'pickens-parcel',
        sourceName: 'Pickens County official parcel source',
        sourceUrl: 'https://official.example/pickens/parcel',
        sourceTier: 'official_county_state',
        verification: 'official_record',
        retrievedAt: AT,
        confidence: 'high',
        supports: ['subject parcel'],
        captureMode: 'live',
        decisionUsable: true,
      }],
      finding: {
        kind: 'county_records',
        jurisdiction: 'Pickens County, SC',
        accessState: 'public',
        summary: 'Subject parcel record retrieved.',
        whyItMatters: 'Discovery-stage subject identity.',
        limitation: 'The parcel source is not a title commitment.',
        classification: 'official_record',
        facts: [
          { field: 'APN', value: '4068-00-37-1227', sourceEvidenceId: 'pickens-parcel', classification: 'official_record' },
          { field: 'Assessed acreage', value: 10.3, sourceEvidenceId: 'pickens-parcel', classification: 'official_record' },
        ],
      },
    })]);

    expect(countyRecordFactsFromPublicRun(result)).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'APN', value: '4068-00-37-1227' }),
      expect.objectContaining({ label: 'Assessed acreage', value: '10.3' }),
    ]));
    expect(snapshotEvidenceFromPublicTasks(result, ['county_records'])).toEqual([
      expect.objectContaining({
        kind: 'source_link',
        sourceType: 'official_county_state',
        sourceUrl: 'https://official.example/pickens/parcel',
        supports: 'county_records',
      }),
    ]);
  });
});
