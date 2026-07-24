import { describe, expect, it } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { verificationFromStoredPublicIntelligence } from './routes.js';
import type { StoredPublicIntelligenceRun } from './public-intelligence-store.js';

const ROUTES = fs.readFileSync(fileURLToPath(new URL('./routes.ts', import.meta.url)), 'utf8');

function storedOfficial(): StoredPublicIntelligenceRun {
  return {
    dealCardId: 30,
    parcelKey: '015 027 04512 000 2026',
    updatedAt: '2026-07-21T19:39:47.000Z',
    run: {
      status: 'complete_with_gaps', downstreamAllowed: true, captureMode: 'live', nonBlockingGaps: ['zoning_landuse'],
      startedAt: '2026-07-21T19:39:38.000Z', completedAt: '2026-07-21T19:39:47.000Z',
      gate: { allowed: true, blocking: true, reasonCode: 'parcel_confirmed', explanation: 'Official parcel record matched.' },
      tasks: [{
        task: 'county_records', label: 'Official county records', role: 'official_records', status: 'succeeded',
        startedAt: '2026-07-21T19:39:38.000Z', completedAt: '2026-07-21T19:39:39.000Z', durationMs: 1000,
        timeoutMs: 30_000, retryEligible: false, confidence: 'high', blocking: false, diagnostics: {},
        evidence: [{
          evidenceId: 'official-parcel', sourceName: 'Tennessee Comptroller public parcel layer',
          sourceUrl: 'https://official.example/parcel', sourceTier: 'official_county_state', verification: 'official_record',
          retrievedAt: '2026-07-21T19:39:38.000Z', confidence: 'high', supports: ['parcel identity'], captureMode: 'live', decisionUsable: true,
        }],
        finding: {
          kind: 'county_records', jurisdiction: 'Cocke County, TN', accessState: 'public', classification: 'official_record',
          summary: 'Official parcel record retrieved.', whyItMatters: 'Identity baseline.', limitation: 'GIS is not a deed.',
          facts: [
            { field: 'APN', value: '015 027 04512 000 2026', sourceEvidenceId: 'official-parcel', classification: 'official_record' },
            { field: 'Situs address', value: 'TALLEY RD', sourceEvidenceId: 'official-parcel', classification: 'official_record' },
            { field: 'Owner of record', value: 'JOINES TRAVIS', sourceEvidenceId: 'official-parcel', classification: 'official_record' },
            { field: 'Assessed acreage', value: 5.82, sourceEvidenceId: 'official-parcel', classification: 'official_record' },
          ],
        },
      }],
    },
    orchestration: {
      status: 'complete_with_gaps', contractVersion: '1.0.0', propertyIntelligence: null, compRuns: [], registry: null,
      compReconciliation: null, stages: [], validation: { valid: true, violations: [] }, firstUsefulResultMs: 0,
      deadlineMs: 600_000, startedAt: '2026-07-21T19:39:38.000Z', completedAt: '2026-07-21T19:39:47.000Z', durationMs: 9000,
      nonBlockingGaps: [], downstreamAllowed: true,
      subjectGeometry: { rings: [[[-83.11, 36.02], [-83.10, 36.02], [-83.10, 36.03], [-83.11, 36.02]]] },
    },
  };
}

describe('official public identity handoff into Deal Card report orchestration', () => {
  it('converts only persisted official county evidence into a verified report identity', () => {
    const verification = verificationFromStoredPublicIntelligence(storedOfficial());
    expect(verification).toMatchObject({
      status: 'parcel_verified', parcelVerified: true, verificationSource: 'Tennessee Comptroller public parcel layer',
      identity: { apn: '015 027 04512 000 2026', county: 'Cocke', state: 'TN', owner: 'JOINES TRAVIS', acres: 5.82 },
      strategyUnderwritingBlocked: false,
    });
    expect(verification?.coordinates?.lat).toBeCloseTo(36.0225, 4);
  });

  it('never promotes a provisional key and wires the retained official match into /report/run', () => {
    expect(verificationFromStoredPublicIntelligence({ ...storedOfficial(), parcelKey: 'unresolved:02704512' })).toBeUndefined();
    expect(ROUTES).toMatch(/prefetchedVerification:[\s\S]*loadLatestResolved\(id\)/);
    expect(ROUTES).toMatch(/if \(retainedResolved && retainedVerification\?\.identity\)/);
    expect(ROUTES).toMatch(/agentId: 'public-property-intelligence'[\s\S]*verified: true|verified: true[\s\S]*agentId: 'public-property-intelligence'/);
  });

  it('does not promote a broader Census county subdivision as the parcel city', () => {
    const stored = storedOfficial();
    const task = stored.run.tasks[0]!;
    if (task.finding?.kind !== 'county_records') throw new Error('county fixture missing');
    const situs = task.finding.facts.find((row) => row.field === 'Situs address');
    if (!situs) throw new Error('situs fixture missing');
    situs.value = '7868 W DEBRA LN, HOMOSASSA, FL, 34448';
    task.finding.facts.push({
      field: 'Situs locality (Census county subdivision)', value: 'Crystal River',
      sourceEvidenceId: 'official-parcel', classification: 'official_record',
    });
    expect(verificationFromStoredPublicIntelligence(stored)?.identity?.city).toBe('HOMOSASSA');
    expect(ROUTES).toMatch(/city:\s*str\(prop0\.city\)/);
  });
});
