import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb, getLandosDb } from './db.js';
import { createPropertyIdentityVersion } from './property-summary-slice.js';
import { normalizeEvidenceWeight, writeDerivedSnapshot, writeEvidence } from './derived-intelligence-store.js';
import { promoteBrowserFactsToEvidence, writeBrowserFact } from './browser-fact-store.js';
import { cancelRunProgress, startRunProgress } from './intelligence-run-progress.js';
import { IntelligenceStackRunStore, resetIntelligenceStackRunStoreCache } from './intelligence-stack-run-store.js';
import { researchResultState, type ResearchResultState } from './research-lane-outcome.js';
import { reconcileResearchReadiness } from './research-readiness-reconcile.js';

function seedSubject(dealCardId = 93): void {
  const db = getLandosDb();
  db.prepare("INSERT INTO landos_deal_card (id, entity, title, status) VALUES (?, 'TY_LAND_BIZ', 'Foundation acceptance', 'new')").run(dealCardId);
  db.prepare(`INSERT INTO landos_property_card
    (id, entity, verification_status, active_input_address, address_key, apn, county, state, owner, acres)
    VALUES (?, 'TY_LAND_BIZ', 'verified_property', '100 TEST RD', '100 test rd', '001-002', 'Iredell', 'NC', 'TEST OWNER', 10)`)
    .run(dealCardId);
  db.prepare("INSERT INTO landos_deal_card_property (deal_card_id, card_id, role) VALUES (?, ?, 'subject')").run(dealCardId, dealCardId);
  createPropertyIdentityVersion({
    dealCardId,
    propertyCardId: dealCardId,
    status: 'confirmed',
    address: '100 TEST RD',
    county: 'Iredell',
    state: 'NC',
    apn: '001-002',
    owner: 'TEST OWNER',
    acreage: 10,
    basis: 'Official county record.',
    confidence: 1,
    sourceRefs: ['county-assessor'],
    changeReason: 'test subject',
    createdBy: 'test',
  });
}

beforeEach(() => {
  _initTestLandosDb();
  resetIntelligenceStackRunStoreCache();
  seedSubject();
});

describe('shared evidence admission', () => {
  it('retains subject, capability, run, source, timestamp and normalized weight', () => {
    const runs = new IntelligenceStackRunStore();
    const progress = startRunProgress('evidence_run', '2026-08-30T12:00:00.000Z');
    runs.create({ runId: 'evidence_run', dealCardId: 93, startedAt: progress.startedAt, progress });
    const result = writeEvidence({
      dealCardId: 93,
      capabilityId: 'market-intelligence',
      collectorKey: 'market-intelligence-web',
      runId: 'evidence_run',
      rows: [{
        domain: 'market', evidenceKind: 'web_claim', factKey: 'demand', raw: 'Strong demand', normalized: 'Strong demand',
        sourceName: 'County plan', sourceUrl: 'https://example.gov/plan', sourceTier: 'official', confidence: 'HIGH',
        retrievedAt: '2026-08-30T12:01:00.000Z', dedupeOn: 'demand|county-plan',
      }],
    });
    expect(result.evidenceIds).toHaveLength(1);
    const row = getLandosDb().prepare(`SELECT originating_capability capability, originating_run_id runId,
      confidence, source_name sourceName, retrieved_at retrievedAt, property_identity_version_id identityId
      FROM landos_property_evidence_item WHERE id=?`).get(result.evidenceIds[0]) as Record<string, unknown>;
    expect(row).toMatchObject({ capability: 'market-intelligence', runId: 'evidence_run', confidence: 'confirmed', sourceName: 'County plan', retrievedAt: '2026-08-30T12:01:00.000Z' });
    expect(Number(row.identityId)).toBeGreaterThan(0);
  });

  it('rejects evidence and current reads after cancellation revokes authority', () => {
    const runs = new IntelligenceStackRunStore();
    const progress = startRunProgress('late_run', '2026-08-30T12:00:00.000Z');
    runs.create({ runId: 'late_run', dealCardId: 93, startedAt: progress.startedAt, progress });
    runs.cancel('late_run', 93, cancelRunProgress(progress, '2026-08-30T12:02:00.000Z'));

    const evidence = writeEvidence({
      dealCardId: 93, capabilityId: 'deal-intelligence', collectorKey: 'late', runId: 'late_run',
      rows: [{ domain: 'deal', evidenceKind: 'late', factKey: 'late', raw: 'late', normalized: 'late', sourceName: 'late', sourceUrl: null, sourceTier: 'model', confidence: 'likely', retrievedAt: '2026-08-30T12:03:00.000Z', dedupeOn: 'late' }],
    });
    const snapshot = writeDerivedSnapshot({
      dealCardId: 93, snapshotType: 'late_snapshot', payload: { late: true }, completeness: {}, changeReason: 'late', actor: 'test', runId: 'late_run', capabilityId: 'deal-intelligence',
    });
    expect(evidence.evidenceIds).toEqual([]);
    expect(evidence.skippedReason).toMatch(/no longer authoritative/i);
    expect(snapshot.snapshotId).toBeNull();
    expect(snapshot.skippedReason).toMatch(/no longer authoritative/i);
  });

  it('promotes extracted browser facts but not unanswered staging rows', () => {
    writeBrowserFact(93, { key: 'road_frontage_ft', label: 'Road frontage', value: '310 ft', sourceName: 'Iredell GIS', sourceType: 'county_gis', sourceUrl: 'https://example.gov/gis', origin: 'netr_county', confidence: 'high', status: 'extracted' });
    writeBrowserFact(93, { key: 'water', label: 'Water', value: 'Not found', sourceName: 'Utility', sourceType: 'utility', sourceUrl: 'https://example.gov/water', origin: 'search_fallback', confidence: 'low', status: 'not_found' });
    const promoted = promoteBrowserFactsToEvidence(93);
    expect(promoted.evidenceIds).toHaveLength(1);
    const row = getLandosDb().prepare('SELECT fact_key factKey, originating_capability capability FROM landos_property_evidence_item WHERE id=?').get(promoted.evidenceIds[0]);
    expect(row).toMatchObject({ factKey: 'road_frontage_ft', capability: 'browser-intelligence' });
    const readiness = reconcileResearchReadiness(93);
    expect('error' in readiness).toBe(false);
    if (!('error' in readiness)) {
      expect(readiness.items.find((item) => item.id === 'road_frontage')).toMatchObject({ status: 'green' });
    }
  });
});

describe('shared research result vocabulary', () => {
  it('keeps invocation distinct from an answered output and every terminal state distinct', () => {
    expect(researchResultState({ status: 'completed', attempted: true, answered: false })).toBe('PARTIAL');
    const states: ResearchResultState[] = [
      researchResultState({ status: 'completed', attempted: true, answered: true }),
      researchResultState({ status: 'partial', attempted: true }),
      researchResultState({ status: 'queued', attempted: false }),
      researchResultState({ status: 'blocked', attempted: true }),
      researchResultState({ status: 'skipped', applicable: false }),
      researchResultState({ status: 'blocked', attempted: true, needsOperatorAction: true }),
      researchResultState({ status: 'failed', attempted: true }),
    ];
    expect(states).toEqual(['RETURNED', 'PARTIAL', 'NOT_RUN', 'BLOCKED', 'NOT_APPLICABLE', 'NEEDS_OPERATOR_ACTION', 'FAILED']);
    expect(new Set(states).size).toBe(7);
    expect(normalizeEvidenceWeight('well-supported')).toBe('well_supported');
  });
});
