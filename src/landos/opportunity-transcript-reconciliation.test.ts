import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb, getLandosDb } from './db.js';
import { createOpportunity, getOpportunity } from './opportunity.js';
import {
  getLatestOpportunityReconciliation,
  ingestAndReconcileTranscript,
  listOpportunityReconciliations,
  listOpportunityTranscripts,
} from './opportunity-transcript-reconciliation.js';

beforeEach(() => _initTestLandosDb());

function seedPackage(opportunityId: number): void {
  const opportunity = getOpportunity(opportunityId)!;
  const discoveryPackage = {
    schemaVersion: 1, opportunityId, opportunityPublicUid: opportunity.publicUid,
    dealCardId: 1, propertyCardId: null, sourceUpdatedAt: 1, contentHash: 'package-hash',
    identity: {
      leadTitle: opportunity.title, leadSource: 'manual', rawInput: '', contacts: [{ name: 'Jane Seller', role: 'seller', phone: null, email: null, authorityStatus: 'unknown', confidence: 'low' }],
      address: '10 Old Mill Rd', city: 'Pine', county: 'Worth', state: 'GA', apn: 'ABC-100',
      apparentRecordOwners: ['Jane Seller'], resolutionStatus: 'verified_property', resolved: true,
      confidence: 'high', contradictions: [],
    },
    landCharacteristics: [{ key: 'acreage', label: 'Acreage', value: '10', status: 'verified', source: 'County GIS', sourceUrl: 'https://county.example/parcel', observedAt: '2026-07-17', confidence: 'high', parcelAssociated: true, note: '' }],
    callPrep: { knownFacts: [], questions: [], nextResearchActions: [], ready: true, executiveBrief: '', unresolvedIdentityWarning: null },
  };
  getLandosDb().prepare(`INSERT INTO landos_opportunity_discovery_package
    (opportunity_id, package_version, content_hash, package_json, source_updated_at)
    VALUES (?, 1, ?, ?, 1)`).run(opportunityId, 'package-hash', JSON.stringify(discoveryPackage));
}

describe('Phase 1 transcript reconciliation persistence', () => {
  it('preserves pasted raw text immutably and records conflicts, facts, tasks, safety, and reconciled state', () => {
    const opportunity = createOpportunity({ entity: 'TY_LAND_BIZ', title: 'Discovery lead' });
    seedPackage(opportunity.id);
    const content = [
      'Seller: I inherited the property and need to sell quickly because the taxes are behind.',
      'The parcel is APN XYZ-900 and the land is 12 acres with access via County Road.',
      'My asking price is $120,000 and I want to close within 30 days.',
      'The co-owner is John Seller and my brother Mark Seller is an heir.',
    ].join('\n');

    const result = ingestAndReconcileTranscript({ opportunityId: opportunity.id, content, sourceType: 'paste', actor: 'operator' });

    expect(result.transcript.rawText).toBe(content);
    expect(result.transcript.sourceType).toBe('paste');
    expect(result.reconciliation.version).toBe(1);
    expect(result.reconciliation.discoveryPackageHash).toBe('package-hash');
    expect(result.reconciliation.askingPrice).toBe(120_000);
    expect(result.reconciliation.timeline).toMatch(/30 days/i);
    expect(result.reconciliation.motivation.score).toBeGreaterThanOrEqual(7);
    expect(result.reconciliation.parties.map((party) => party.name)).toEqual(expect.arrayContaining(['Jane Seller', 'John Seller', 'Mark Seller']));
    expect(result.reconciliation.contradictions.map((conflict) => conflict.field)).toEqual(expect.arrayContaining(['apn', 'acreage']));
    expect(result.reconciliation.materialConflict).toBe(true);
    expect(result.reconciliation.nextAction).toBe('more_research');
    expect(result.reconciliation.safety).toMatchObject({ outboundAllowed: false, paidActionsAllowed: false, offerOrContractSendingAllowed: false });
    expect(result.opportunity.discoveryStatus).toBe('reconciled');

    const facts = getLandosDb().prepare(`SELECT * FROM landos_opportunity_canonical_fact WHERE opportunity_id = ?`).all(opportunity.id) as Array<Record<string, unknown>>;
    expect(facts.length).toBeGreaterThanOrEqual(5);
    expect(facts.every((fact) => fact.classification === 'seller_stated' && fact.transcript_id === result.transcript.id && fact.reconciliation_id === result.reconciliation.id)).toBe(true);
    expect(facts.find((fact) => fact.field_key === 'apn')?.conflict_status).toBe('material');
    expect((getLandosDb().prepare(`SELECT COUNT(*) AS n FROM landos_opportunity_reconciliation_task WHERE opportunity_id = ?`).get(opportunity.id) as { n: number }).n).toBeGreaterThan(0);
    expect(() => getLandosDb().prepare('UPDATE landos_opportunity_transcript SET raw_text = ? WHERE id = ?').run('changed', result.transcript.id)).toThrow(/immutable/);
    expect(() => getLandosDb().prepare('DELETE FROM landos_opportunity_transcript WHERE id = ?').run(result.transcript.id)).toThrow(/immutable/);
  });

  it('accepts text-upload metadata, versions later calls, and treats identical submissions idempotently', () => {
    const opportunity = createOpportunity({ entity: 'TY_LAND_BIZ', title: 'Upload lead' });
    const first = ingestAndReconcileTranscript({
      opportunityId: opportunity.id, sourceType: 'upload', fileName: 'call-one.txt',
      content: 'Seller wants to sell within 2 months. Asking price is $75,000.',
    });
    const duplicate = ingestAndReconcileTranscript({
      opportunityId: opportunity.id, sourceType: 'upload', fileName: 'renamed.txt',
      content: 'Seller wants to sell within 2 months. Asking price is $75,000.',
    });
    const second = ingestAndReconcileTranscript({
      opportunityId: opportunity.id, sourceType: 'paste',
      content: 'Seller says asking price is $70,000 and wants to sell within 30 days.',
    });

    expect(first.transcript.fileName).toBe('call-one.txt');
    expect(duplicate.transcript.id).toBe(first.transcript.id);
    expect(duplicate.reconciliation.id).toBe(first.reconciliation.id);
    expect(second.reconciliation.version).toBe(2);
    expect(listOpportunityTranscripts(opportunity.id)).toHaveLength(2);
    expect(listOpportunityReconciliations(opportunity.id).map((item) => item.version)).toEqual([2, 1]);
    expect(getLatestOpportunityReconciliation(opportunity.id)?.id).toBe(second.reconciliation.id);
    const askingFacts = getLandosDb().prepare(`SELECT supersedes_fact_id FROM landos_opportunity_canonical_fact WHERE opportunity_id = ? AND field_key = 'asking_price' ORDER BY id`).all(opportunity.id) as Array<{ supersedes_fact_id: number | null }>;
    expect(askingFacts).toHaveLength(2);
    expect(askingFacts[1].supersedes_fact_id).not.toBeNull();
  });

  it('keeps exact text/hash, sanitizes upload names, never supersedes verified facts, and creates callback work', () => {
    const opportunity = createOpportunity({ entity: 'TY_LAND_BIZ', title: 'Provenance lead' });
    getLandosDb().prepare(`INSERT INTO landos_opportunity_canonical_fact
      (opportunity_id, field_key, value_json, classification, conflict_status, recorded_by)
      VALUES (?, 'asking_price', '80000', 'verified', 'none', 'owner')`).run(opportunity.id);
    const exact = '\uFEFF  Seller says asking price is $75,000.\r\nPlease call me back tomorrow afternoon.  \n';
    const result = ingestAndReconcileTranscript({
      opportunityId: opportunity.id, sourceType: 'upload', fileName: '..\\private\\call.txt', content: exact,
    });

    expect(result.transcript.rawText).toBe(exact);
    expect(result.transcript.fileName).toBe('call.txt');
    expect(result.transcript.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.reconciliation.followUpTasks.some((task) => /call me back tomorrow/i.test(task.title))).toBe(true);
    expect(result.reconciliation.motivation.evidence).toEqual(['No explicit motivation signal was identified in the transcript; confirm motivation on follow-up.']);
    const sellerFact = getLandosDb().prepare(`SELECT supersedes_fact_id FROM landos_opportunity_canonical_fact WHERE opportunity_id = ? AND field_key = 'asking_price' AND classification = 'seller_stated'`).get(opportunity.id) as { supersedes_fact_id: number | null };
    expect(sellerFact.supersedes_fact_id).toBeNull();
    expect((getLandosDb().prepare(`SELECT value_json FROM landos_opportunity_canonical_fact WHERE opportunity_id = ? AND field_key = 'asking_price' AND classification = 'verified'`).get(opportunity.id) as { value_json: string }).value_json).toBe('80000');
  });

  it('rejects blank, binary-extension, and oversized transcript inputs', () => {
    const opportunity = createOpportunity({ entity: 'TY_LAND_BIZ', title: 'Invalid transcript lead' });
    expect(() => ingestAndReconcileTranscript({ opportunityId: opportunity.id, sourceType: 'paste', content: '   ' })).toThrow(/required/);
    expect(() => ingestAndReconcileTranscript({ opportunityId: opportunity.id, sourceType: 'upload', fileName: 'call.pdf', content: 'text' })).toThrow(/text files only/);
    expect(() => ingestAndReconcileTranscript({ opportunityId: opportunity.id, sourceType: 'paste', content: 'x'.repeat(2_000_001) })).toThrow(/2 MB/);
  });
});
