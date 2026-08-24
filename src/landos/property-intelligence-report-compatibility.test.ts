import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb, getLandosDb } from './db.js';
import {
  getDealCardReport,
  projectPropertyIntelligenceSnapshotForReport,
} from './deal-card-report.js';
import type { PropertyIntelligenceSnapshot } from './property-intelligence-snapshot.js';

function snapshot(overrides: Partial<PropertyIntelligenceSnapshot> = {}): PropertyIntelligenceSnapshot {
  return {
    snapshotVersion: 5,
    dealCardId: 89,
    runId: 'current-property-intelligence',
    sequence: 1,
    isPrimary: true,
    status: 'complete',
    startedAt: '2026-08-20T13:00:00.000Z',
    completedAt: '2026-08-20T13:05:00.000Z',
    durationMs: 300_000,
    identity: {
      state: 'confirmed', normalizedAddress: 'KINGWOOD BLVD', county: 'Williamson', state_: 'TN',
      apn: '042-123.00-000', apnVariants: ['042-123.00-000'], owner: 'LANDSOUTH LLC', ownerMailing: null,
      situs: 'KINGWOOD BLVD', acres: 75.91, acreageBasis: 'assessed', coordinates: null,
      hasParcelGeometry: true, sourceConfidence: 'high', conflicts: [], explanation: 'Confirmed by the official parcel record.',
    },
    facts: [{
      key: 'market_pulse', label: 'Market Pulse', value: 'Persisted market context.', grade: 'likely_indication',
      source: 'LandOS Market Pulse', sourceUrl: null, retrievedAt: '2026-08-20T13:04:00.000Z', note: null,
    }],
    governmentRecords: [],
    dueDiligence: [{
      key: 'access', label: 'Legal access and road frontage', verdict: 'good', headline: 'Retained access indication',
      grade: 'likely_indication', detail: 'Persisted evidence only.', sourceUrl: 'https://example.test/access', missing: [],
    }],
    comps: {
      policyExplanation: 'Current accepted-comp policy.', landPortalUsable: true, landPortalRowsSeen: 97,
      caps: { zillow: 5, redfin: 5 }, sold: [], active: [], landHomeOnly: [], rejected: [],
      duplicatesMerged: 0, totalCollected: 97, summaryLine: 'Three current accepted closed sales support valuation.',
    },
    // This retained mission value is intentionally stale. The compatibility
    // adapter must not copy it into the legacy valuation slot; the download
    // route's canonical current-comp projection owns that slot.
    valuation: {
      priceable: true, range: { low: 2_500_000, high: 2_800_000 }, pricePerAcreRange: null,
      likelyRetail: null, dispositionRange: null, basis: 'Historical mission basis.', adjustments: [],
      confidence: 'medium', uncertainty: [], materialGaps: [], notPriceableReason: null,
      nextActionToPrice: null, workingValue: 2_668_000,
    },
    strategies: [],
    recommendation: {
      preferredStrategy: 'Patient resale', why: 'Current strategy handoff.', whatWouldChangeIt: [],
      posture: 'pursue', postureWhy: 'Proceed from current persisted evidence.',
    },
    evidence: [{
      id: 'landportal-subject', kind: 'source_link', label: 'LandPortal subject', sourceType: 'LandPortal',
      sourceUrl: 'https://example.test/parcel', viewUrl: null, retrievedAt: '2026-08-20T13:04:00.000Z',
      confidence: 'high', supports: 'identity', sha256: null, bytes: null,
    }],
    specialists: [],
    headline: { keyOpportunity: 'Current opportunity.', topRisks: ['Retained risk.'], confidence: 'high', confidenceWhy: 'Current specialists delivered.' },
    blockers: [], missingInformation: ['Confirm title.'], nextActions: ['Review title evidence.'],
    ...overrides,
  };
}

beforeEach(() => _initTestLandosDb());

describe('Property Intelligence report compatibility projection', () => {
  it('adapts a promoted V2 snapshot without writing or reviving stale valuation truth', () => {
    const base = getDealCardReport(89);
    expect(base.exists).toBe(false);

    const report = projectPropertyIntelligenceSnapshotForReport(snapshot(), base);

    expect(report).toMatchObject({
      exists: true,
      reportStatus: 'complete',
      parcelVerified: true,
      marketSummary: 'Three current accepted closed sales support valuation.',
      updatedBy: 'property-intelligence-snapshot/compatibility',
    });
    expect(report?.ddFactChecklist).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'apn', value: '042-123.00-000', status: 'verified' }),
      expect.objectContaining({ key: 'acres', value: '75.91 ac', status: 'verified' }),
      expect.objectContaining({ key: 'due_diligence_access', value: expect.stringContaining('Retained access indication') }),
    ]));
    expect(report?.valuation.primary).toBeNull();
    expect(JSON.stringify(report)).not.toContain('2668000');
    expect(report?.creditUsage.note).toMatch(/No provider or research workflow ran/);
    expect((getLandosDb().prepare('SELECT COUNT(*) AS count FROM landos_deal_card_report').get() as { count: number }).count).toBe(0);
  });

  it('refuses in-flight, failed, or non-primary snapshots', () => {
    const base = getDealCardReport(89);
    expect(projectPropertyIntelligenceSnapshotForReport(snapshot({ status: 'running' }), base)).toBeNull();
    expect(projectPropertyIntelligenceSnapshotForReport(snapshot({ status: 'failed' }), base)).toBeNull();
    expect(projectPropertyIntelligenceSnapshotForReport(snapshot({ isPrimary: false }), base)).toBeNull();
    expect(projectPropertyIntelligenceSnapshotForReport(snapshot({ preliminary: true }), base)).toBeNull();
  });
});
