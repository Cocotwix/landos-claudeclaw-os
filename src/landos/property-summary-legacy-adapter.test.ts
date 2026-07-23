import { beforeEach, describe, expect, it } from 'vitest';

import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { _initTestLandosDb } from './db.js';
import { writeParcelIdentity } from './parcel-identity.js';
import { upsertPropertyCard } from './property-card.js';
import { synchronizePropertySummaryForDeal } from './property-summary-legacy-adapter.js';
import { PublicIntelligenceStore } from './public-intelligence-store.js';
import type { PublicIntelligenceRun } from './public-property-intelligence.js';

beforeEach(() => {
  _initTestLandosDb();
});

function createLead(state: 'unresolved' | 'candidate' | 'confirmed') {
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Legacy adapter lead', leadType: 'test' });
  const card = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: '388 Gilstrap Rd, Cleveland, GA 30528',
    city: 'Cleveland',
    county: 'White',
    state: 'GA',
    apn: state === 'confirmed' ? '001-002-003' : undefined,
    owner: state === 'confirmed' ? 'Accepted Owner' : undefined,
    acres: state === 'confirmed' ? 12.5 : undefined,
    verified: state === 'confirmed',
    verificationSource: state === 'confirmed' ? 'Accepted official source' : undefined,
    addressMatched: state !== 'confirmed',
    agentId: 'legacy-test',
  }).card;
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
  writeParcelIdentity(deal.id, {
    subjectCardId: card.id,
    state,
    basis: state === 'confirmed' ? 'Accepted official source.' : 'Legacy resolution has not confirmed this parcel.',
    confidence: state === 'confirmed' ? 0.95 : state === 'candidate' ? 0.4 : 0,
    evidenceRefs: state === 'confirmed' ? ['accepted-official'] : [],
  }, 'legacy-test');
  return { deal, card };
}

function officialRun(): PublicIntelligenceRun {
  const evidence = {
    evidenceId: 'official-001',
    sourceName: 'White County Assessor',
    sourceUrl: 'https://whitecounty.example/001',
    sourceTier: 'official_county_state' as const,
    verification: 'official_record' as const,
    retrievedAt: '2026-07-23T12:00:00.000Z',
    confidence: 'high' as const,
    supports: ['APN', 'Owner of record', 'Assessed acreage'],
    captureMode: 'fixture' as const,
    decisionUsable: false,
  };
  return {
    status: 'complete',
    downstreamAllowed: true,
    gate: { allowed: true, blocking: true, reasonCode: 'parcel_confirmed', explanation: 'Official match.' },
    captureMode: 'fixture',
    tasks: [{
      task: 'county_records',
      label: 'Official county records',
      role: 'official_records',
      status: 'succeeded',
      startedAt: '2026-07-23T11:59:00.000Z',
      completedAt: '2026-07-23T12:00:00.000Z',
      durationMs: 60_000,
      timeoutMs: 60_000,
      finding: {
        kind: 'county_records',
        jurisdiction: 'White County, GA',
        facts: [
          { field: 'APN', value: '001-002-003', sourceEvidenceId: evidence.evidenceId, classification: 'official_record' },
          { field: 'Owner of record', value: 'Official Owner', sourceEvidenceId: evidence.evidenceId, classification: 'official_record' },
          { field: 'Assessed acreage', value: 12.5, sourceEvidenceId: evidence.evidenceId, classification: 'official_record' },
          { field: 'Situs address', value: '388 Gilstrap Rd, Cleveland, GA 30528', sourceEvidenceId: evidence.evidenceId, classification: 'official_record' },
        ],
        accessState: 'public',
        summary: 'Official record captured.',
        whyItMatters: 'Supports identity.',
        limitation: 'Not title.',
        classification: 'official_record',
      },
      evidence: [evidence],
      retryEligible: false,
      confidence: 'high',
      blocking: false,
      diagnostics: { adapterId: 'official-fixture' },
    }],
    nonBlockingGaps: [],
    startedAt: '2026-07-23T11:59:00.000Z',
    completedAt: '2026-07-23T12:00:00.000Z',
  };
}

describe('legacy-to-versioned Property Summary adapter', () => {
  it('uses the accepted confirmed verdict and official run as one current identity', () => {
    const { deal } = createLead('confirmed');
    new PublicIntelligenceStore().save(deal.id, '001-002-003', officialRun(), null);
    const result = synchronizePropertySummaryForDeal({
      dealCardId: deal.id,
      actor: 'legacy-test',
      changeReason: 'Backfill accepted identity',
    });
    expect(result.identity.status).toBe('confirmed');
    expect(result.identity.apn).toBe('001-002-003');
    expect(result.identity.owner).toBe('Accepted Owner');
    expect(result.snapshot?.summary.parcelSpecificAllowed).toBe(true);
  });

  it('turns candidate-versus-official disagreement into one disputed state with no parcel output', () => {
    const { deal } = createLead('candidate');
    new PublicIntelligenceStore().save(deal.id, '001-002-003', officialRun(), null);
    const result = synchronizePropertySummaryForDeal({
      dealCardId: deal.id,
      actor: 'legacy-test',
      changeReason: 'Expose disagreement',
    });
    expect(result.identity.status).toBe('disputed');
    expect(result.identity.apn).toBeNull();
    expect(result.identity.owner).toBeNull();
    expect(result.snapshot?.summary.parcelSpecificAllowed).toBe(false);
    expect(result.snapshot?.summary.property).toBeNull();
  });

  it('preserves accepted confirmation when a newer blocked retry is stored', () => {
    const { deal } = createLead('confirmed');
    const store = new PublicIntelligenceStore();
    store.save(deal.id, '001-002-003', officialRun(), null);
    const blocked: PublicIntelligenceRun = {
      status: 'blocked_identity',
      downstreamAllowed: false,
      gate: {
        allowed: false,
        blocking: true,
        reasonCode: 'parcel_not_confirmed',
        explanation: 'Retry could not resolve the parcel.',
      },
      captureMode: 'fixture',
      tasks: [],
      nonBlockingGaps: [],
      startedAt: '2026-07-23T13:00:00.000Z',
      completedAt: '2026-07-23T13:00:01.000Z',
    };
    store.save(deal.id, 'unresolved:retry', blocked, null);
    const result = synchronizePropertySummaryForDeal({
      dealCardId: deal.id,
      actor: 'legacy-test',
      changeReason: 'Retry retained accepted identity',
    });
    expect(result.identity.status).toBe('confirmed');
    expect(result.identity.apn).toBe('001-002-003');
    expect(result.assessorGisJob?.status).toBe('succeeded');
  });
});
