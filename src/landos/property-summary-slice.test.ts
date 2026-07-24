import { beforeEach, describe, expect, it } from 'vitest';

import { createDealCard, hardDeleteDealCard, linkPropertyToDeal, softDeleteDealCard } from './deal-card.js';
import { _initTestLandosDb, getLandosDb } from './db.js';
import { upsertPropertyCard } from './property-card.js';
import type { PublicIntelligenceRun } from './public-property-intelligence.js';
import {
  createPropertyIdentityVersion,
  getPropertySummaryReadModel,
  synchronizePropertySummarySlice,
} from './property-summary-slice.js';

beforeEach(() => {
  _initTestLandosDb();
});

function dealWithProperty(input: { verified: boolean; title: string }) {
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: input.title, leadType: 'test' });
  const result = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: input.title,
    city: 'Cleveland',
    county: 'White',
    state: 'GA',
    apn: input.verified ? '001-002-003' : undefined,
    owner: input.verified ? 'Owner One' : undefined,
    acres: input.verified ? 12.5 : undefined,
    verified: input.verified,
    verificationSource: input.verified ? 'White County Assessor' : undefined,
    addressMatched: !input.verified,
    agentId: 'test',
  });
  linkPropertyToDeal({ dealCardId: deal.id, cardId: result.card.id, role: 'subject' });
  return { deal, card: result.card };
}

function countyRun(input: { status?: 'succeeded' | 'partial' | 'failed'; owner?: string } = {}): PublicIntelligenceRun {
  const status = input.status ?? 'succeeded';
  const evidence = {
    evidenceId: 'white-county-001',
    sourceName: 'White County Assessor',
    sourceUrl: 'https://whitecounty.example/parcel/001-002-003',
    sourceTier: 'official_county_state' as const,
    verification: 'official_record' as const,
    retrievedAt: '2026-07-23T12:00:00.000Z',
    confidence: 'high' as const,
    supports: ['APN', 'Owner of record', 'Assessed acreage'],
    captureMode: 'fixture' as const,
    decisionUsable: false,
  };
  return {
    status: status === 'succeeded' ? 'complete' : 'complete_with_gaps',
    downstreamAllowed: true,
    gate: {
      allowed: true,
      blocking: true,
      reasonCode: 'parcel_confirmed',
      explanation: 'Official parcel identity is confirmed.',
    },
    captureMode: 'fixture',
    tasks: [{
      task: 'county_records',
      label: 'Official county records',
      role: 'official_records',
      status,
      startedAt: '2026-07-23T11:59:59.000Z',
      completedAt: '2026-07-23T12:00:00.000Z',
      durationMs: 1000,
      timeoutMs: 30_000,
      finding: status === 'failed' ? undefined : {
        kind: 'county_records',
        jurisdiction: 'White County, GA',
        facts: [
          { field: 'APN', value: '001-002-003', sourceEvidenceId: evidence.evidenceId, classification: 'official_record' },
          { field: 'Owner of record', value: input.owner ?? 'Owner One', sourceEvidenceId: evidence.evidenceId, classification: 'official_record' },
          { field: 'Assessed acreage', value: 12.5, sourceEvidenceId: evidence.evidenceId, classification: 'official_record' },
        ],
        accessState: 'public',
        summary: 'Official assessor facts were captured.',
        whyItMatters: 'Establishes the assessor/GIS property summary.',
        limitation: 'Not a title commitment or survey.',
        classification: 'official_record',
      },
      evidence: status === 'failed' ? [] : [evidence],
      failureReason: status === 'failed' ? 'Assessor endpoint unavailable.' : undefined,
      retryEligible: status !== 'succeeded',
      confidence: status === 'failed' ? 'none' : 'high',
      blocking: false,
      diagnostics: { adapterId: 'fixture-white-county' },
    }],
    nonBlockingGaps: status === 'succeeded' ? [] : ['county_records'],
    startedAt: '2026-07-23T11:59:59.000Z',
    completedAt: '2026-07-23T12:00:00.000Z',
  };
}

function confirmedIdentity(dealCardId: number, propertyCardId: number, reason = 'Official parcel accepted') {
  return {
    dealCardId,
    propertyCardId,
    status: 'confirmed' as const,
    address: '388 Gilstrap Rd',
    city: 'Cleveland',
    county: 'White',
    state: 'GA',
    zip: '30528',
    apn: '001-002-003',
    owner: 'Owner One',
    acreage: 12.5,
    geometry: { type: 'Polygon', rings: [[[-83.7, 34.5], [-83.6, 34.5], [-83.7, 34.5]]] },
    basis: 'White County official assessor and GIS record.',
    confidence: 0.98,
    sourceRefs: ['White County Assessor:white-county-001'],
    changeReason: reason,
    createdBy: 'test-harness',
  };
}

describe('versioned Property Summary vertical slice', () => {
  it('builds an existing verified property from immutable evidence and remains idempotent', () => {
    const { deal, card } = dealWithProperty({ verified: true, title: '388 Gilstrap Rd' });
    const first = synchronizePropertySummarySlice({
      identity: confirmedIdentity(deal.id, card.id),
      publicRun: countyRun(),
    });
    expect(first.identity.status).toBe('confirmed');
    expect(first.snapshot?.summary.parcelSpecificAllowed).toBe(true);
    expect(first.snapshot?.summary.property?.apn).toBe('001-002-003');
    expect(first.snapshot?.summary.facts.map((fact) => fact.key)).toEqual([
      'APN',
      'Assessed acreage',
      'Owner of record',
    ]);
    expect(first.assessorGisJob?.status).toBe('succeeded');

    const before = {
      identities: (getLandosDb().prepare('SELECT COUNT(*) AS count FROM landos_property_identity_version').get() as { count: number }).count,
      evidence: (getLandosDb().prepare('SELECT COUNT(*) AS count FROM landos_property_evidence_item').get() as { count: number }).count,
      jobs: (getLandosDb().prepare('SELECT COUNT(*) AS count FROM landos_property_collector_job').get() as { count: number }).count,
      snapshots: (getLandosDb().prepare('SELECT COUNT(*) AS count FROM landos_deal_intelligence_snapshot').get() as { count: number }).count,
    };
    const second = synchronizePropertySummarySlice({
      identity: confirmedIdentity(deal.id, card.id),
      publicRun: countyRun(),
    });
    expect(second.identity.version).toBe(first.identity.version);
    expect(second.snapshot?.version).toBe(first.snapshot?.version);
    expect({
      identities: (getLandosDb().prepare('SELECT COUNT(*) AS count FROM landos_property_identity_version').get() as { count: number }).count,
      evidence: (getLandosDb().prepare('SELECT COUNT(*) AS count FROM landos_property_evidence_item').get() as { count: number }).count,
      jobs: (getLandosDb().prepare('SELECT COUNT(*) AS count FROM landos_property_collector_job').get() as { count: number }).count,
      snapshots: (getLandosDb().prepare('SELECT COUNT(*) AS count FROM landos_deal_intelligence_snapshot').get() as { count: number }).count,
    }).toEqual(before);
  });

  it('builds an existing unresolved property without parcel-specific conclusions', () => {
    const { deal, card } = dealWithProperty({ verified: false, title: 'Unknown tract near Cleveland' });
    const result = synchronizePropertySummarySlice({
      identity: {
        dealCardId: deal.id,
        propertyCardId: card.id,
        status: 'unresolved',
        address: 'Unknown tract near Cleveland',
        county: 'White',
        state: 'GA',
        basis: 'No official parcel match.',
        confidence: 0,
        sourceRefs: [],
        changeReason: 'Initial unresolved intake',
        createdBy: 'test-harness',
      },
      publicRun: null,
    });
    expect(result.assessorGisJob?.status).toBe('blocked');
    expect(result.snapshot?.summary.state).toBe('resolution_required');
    expect(result.snapshot?.summary.parcelSpecificAllowed).toBe(false);
    expect(result.snapshot?.summary.property).toBeNull();
    expect(result.snapshot?.summary.facts).toEqual([]);
    expect(result.evidenceCount).toBe(0);
  });

  it('supports a brand-new property that resolves and versions an operator correction', () => {
    const { deal, card } = dealWithProperty({ verified: false, title: '388 Gilstrap Rd' });
    const resolved = synchronizePropertySummarySlice({
      identity: confirmedIdentity(deal.id, card.id, 'Brand-new lead resolved from official records'),
      publicRun: countyRun(),
    });
    expect(resolved.identity.version).toBe(1);
    expect(resolved.snapshot?.summary.state).toBe('ready');

    const corrected = synchronizePropertySummarySlice({
      identity: {
        ...confirmedIdentity(deal.id, card.id, 'Operator corrected accepted owner from stronger evidence'),
        owner: 'Owner Two',
        createdBy: 'operator',
        allowAcceptedSupersession: true,
      },
      publicRun: countyRun({ owner: 'Owner Two' }),
    });
    expect(corrected.identity.version).toBe(2);
    expect(corrected.identity.owner).toBe('Owner Two');
    expect(corrected.snapshot?.version).toBe(2);
    expect(corrected.snapshot?.priorSnapshotId).toBe(resolved.snapshot?.id);
    expect(corrected.snapshot?.changeReason).toContain('Operator corrected');
  });

  it('supports a brand-new property that remains unresolved across a safe retry', () => {
    const { deal, card } = dealWithProperty({ verified: false, title: 'Vacant land, White County' });
    const first = synchronizePropertySummarySlice({
      identity: {
        dealCardId: deal.id,
        propertyCardId: card.id,
        status: 'unresolved',
        address: 'Vacant land, White County',
        county: 'White',
        state: 'GA',
        basis: 'Insufficient identifier.',
        confidence: 0,
        sourceRefs: [],
        changeReason: 'Initial attempt',
        createdBy: 'test-harness',
      },
      publicRun: null,
    });
    const second = synchronizePropertySummarySlice({
      identity: {
        dealCardId: deal.id,
        propertyCardId: card.id,
        status: 'candidate',
        address: 'Vacant land, White County',
        county: 'White',
        state: 'GA',
        basis: 'Address candidate only; no parcel key.',
        confidence: 0.35,
        sourceRefs: ['address-candidate'],
        changeReason: 'Safe retry found only a candidate',
        createdBy: 'test-harness',
      },
      publicRun: null,
    });
    expect(first.snapshot?.summary.parcelSpecificAllowed).toBe(false);
    expect(second.identity.version).toBe(2);
    expect(second.identity.status).toBe('candidate');
    expect(second.snapshot?.summary.property).toBeNull();
    expect(second.assessorGisJob?.status).toBe('blocked');
  });

  it('does not let weaker automation overwrite an accepted confirmed identity', () => {
    const { deal, card } = dealWithProperty({ verified: true, title: '388 Gilstrap Rd' });
    const accepted = createPropertyIdentityVersion(confirmedIdentity(deal.id, card.id));
    const attempted = createPropertyIdentityVersion({
      dealCardId: deal.id,
      propertyCardId: card.id,
      status: 'candidate',
      address: 'Nearby road pin',
      county: 'White',
      state: 'GA',
      basis: 'Automated proximity candidate.',
      confidence: 0.4,
      sourceRefs: ['map-pin'],
      changeReason: 'Automated rerun',
      createdBy: 'automation',
    });
    expect(attempted.id).toBe(accepted.id);
    expect(attempted.status).toBe('confirmed');
    expect(attempted.apn).toBe('001-002-003');
  });

  it('does not let automation replace accepted facts merely by labelling its result confirmed', () => {
    const { deal, card } = dealWithProperty({ verified: true, title: '388 Gilstrap Rd' });
    const accepted = createPropertyIdentityVersion(confirmedIdentity(deal.id, card.id));
    const attempted = createPropertyIdentityVersion({
      ...confirmedIdentity(deal.id, card.id, 'Automated official refresh'),
      owner: 'Different Automated Owner',
      acreage: 99,
      basis: 'Later automated source result.',
      sourceRefs: ['later-automation'],
      createdBy: 'automation',
    });
    expect(attempted.id).toBe(accepted.id);
    expect(attempted.owner).toBe('Owner One');
    expect(attempted.acreage).toBe(12.5);
    expect(attempted.sourceRefs).toEqual(['White County Assessor:white-county-001']);
  });

  it('keeps collector failure isolated and leaves an honest resumable snapshot', () => {
    const { deal, card } = dealWithProperty({ verified: true, title: '388 Gilstrap Rd' });
    const result = synchronizePropertySummarySlice({
      identity: confirmedIdentity(deal.id, card.id),
      publicRun: countyRun({ status: 'failed' }),
    });
    expect(result.identity.status).toBe('confirmed');
    expect(result.assessorGisJob?.status).toBe('failed');
    expect(result.assessorGisJob?.lastError).toContain('unavailable');
    expect(result.snapshot?.summary.state).toBe('partial');
    expect(result.snapshot?.summary.parcelSpecificAllowed).toBe(true);
    expect(result.snapshot?.completeness.missing).toContain('Complete assessor/GIS evidence');
  });

  it('resumes a stranded running collector after restart without duplicating evidence', () => {
    const { deal, card } = dealWithProperty({ verified: true, title: '388 Gilstrap Rd' });
    const first = synchronizePropertySummarySlice({
      identity: confirmedIdentity(deal.id, card.id),
      publicRun: countyRun(),
    });
    const jobId = first.assessorGisJob!.id;
    const now = Math.floor(Date.now() / 1000);
    getLandosDb().prepare(`
      UPDATE landos_property_collector_job
      SET status='running', attempt_count=2, finished_at=NULL, updated_at=?
      WHERE id=?
    `).run(now, jobId);
    getLandosDb().prepare(`
      INSERT INTO landos_property_collector_attempt (job_id, attempt_number, status, started_at)
      VALUES (?, 2, 'running', ?)
    `).run(jobId, now);
    const evidenceBefore = first.evidenceCount;

    const resumed = synchronizePropertySummarySlice({
      identity: confirmedIdentity(deal.id, card.id),
      publicRun: countyRun(),
    });
    expect(resumed.assessorGisJob?.status).toBe('succeeded');
    expect(resumed.assessorGisJob?.attemptCount).toBe(3);
    expect(resumed.evidenceCount).toBe(evidenceBefore);
    const attempts = getLandosDb().prepare(`
      SELECT attempt_number, status, error FROM landos_property_collector_attempt
      WHERE job_id=? ORDER BY attempt_number
    `).all(jobId) as Array<{ attempt_number: number; status: string; error: string | null }>;
    expect(attempts).toHaveLength(3);
    expect(attempts[1]).toMatchObject({
      attempt_number: 2,
      status: 'failed',
      error: 'Interrupted before completion; resumed after restart.',
    });
    expect(attempts[2]).toMatchObject({ attempt_number: 3, status: 'succeeded' });
  });

  it('makes evidence append-only and keeps read operations write-free', () => {
    const { deal, card } = dealWithProperty({ verified: true, title: '388 Gilstrap Rd' });
    synchronizePropertySummarySlice({
      identity: confirmedIdentity(deal.id, card.id),
      publicRun: countyRun(),
    });
    const evidence = getLandosDb().prepare('SELECT id FROM landos_property_evidence_item ORDER BY id LIMIT 1').get() as { id: number };
    expect(() => getLandosDb().prepare(
      'UPDATE landos_property_evidence_item SET source_name=? WHERE id=?',
    ).run('Changed', evidence.id)).toThrow(/append-only/);
    expect(() => getLandosDb().prepare(
      'DELETE FROM landos_property_evidence_item WHERE id=?',
    ).run(evidence.id)).toThrow(/append-only/);

    const before = (getLandosDb().prepare(`
      SELECT
        (SELECT COUNT(*) FROM landos_property_identity_version) AS identities,
        (SELECT COUNT(*) FROM landos_property_evidence_item) AS evidence,
        (SELECT COUNT(*) FROM landos_property_collector_job) AS jobs,
        (SELECT COUNT(*) FROM landos_deal_intelligence_snapshot) AS snapshots
    `).get() as Record<string, number>);
    expect(getPropertySummaryReadModel(deal.id)?.snapshot?.summary.property?.apn).toBe('001-002-003');
    expect(getPropertySummaryReadModel(deal.id)?.snapshot?.summary.property?.apn).toBe('001-002-003');
    const after = getLandosDb().prepare(`
      SELECT
        (SELECT COUNT(*) FROM landos_property_identity_version) AS identities,
        (SELECT COUNT(*) FROM landos_property_evidence_item) AS evidence,
        (SELECT COUNT(*) FROM landos_property_collector_job) AS jobs,
        (SELECT COUNT(*) FROM landos_deal_intelligence_snapshot) AS snapshots
    `).get() as Record<string, number>;
    expect(after).toEqual(before);
  });

  it('allows the explicit Trash-to-permanent-delete workflow to purge the complete slice', () => {
    const { deal, card } = dealWithProperty({ verified: true, title: '388 Gilstrap Rd' });
    synchronizePropertySummarySlice({
      identity: confirmedIdentity(deal.id, card.id),
      publicRun: countyRun(),
    });
    expect(softDeleteDealCard(deal.id)?.deleted_at).not.toBeNull();
    expect(hardDeleteDealCard(deal.id)).toBe(true);
    expect((getLandosDb().prepare(
      'SELECT COUNT(*) AS count FROM landos_property_identity_version WHERE deal_card_id=?',
    ).get(deal.id) as { count: number }).count).toBe(0);
    expect((getLandosDb().prepare(
      'SELECT COUNT(*) AS count FROM landos_property_evidence_item WHERE deal_card_id=?',
    ).get(deal.id) as { count: number }).count).toBe(0);
    expect((getLandosDb().prepare(
      'SELECT COUNT(*) AS count FROM landos_deal_intelligence_snapshot WHERE deal_card_id=?',
    ).get(deal.id) as { count: number }).count).toBe(0);
  });
});
