import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb, getLandosDb } from './db.js';
import { createDealCard, listDealCards } from './deal-card.js';
import {
  backfillLegacyOpportunities,
  createOpportunity,
  getExecutiveOpportunitySnapshot,
  getOpportunity,
  getOpportunityByDealCardId,
  getOpportunityDetail,
  listOpportunities,
  listOpportunityBoardCards,
  ownerDisposeOpportunity,
  ownerPursueOpportunity,
  ownerPursueOpportunityByDealCardId,
  updateOpportunityDiscoveryStatus,
  updateOpportunityResearchStatus,
} from './opportunity.js';

beforeEach(() => {
  _initTestLandosDb();
});

describe('Phase 1 opportunity persistence', () => {
  it('backfills every legacy Deal Card exactly once without changing legacy rows', () => {
    const first = createDealCard({ entity: 'TY_LAND_BIZ', title: 'First legacy lead', sellerNotes: 'preserve me' });
    const second = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Second legacy lead', askingPrice: 12_345 });
    const db = getLandosDb();
    const before = db.prepare('SELECT * FROM landos_deal_card ORDER BY id').all();

    const initial = backfillLegacyOpportunities();
    const repeated = backfillLegacyOpportunities();

    expect(initial).toMatchObject({ legacyDealCards: 2, opportunitiesBefore: 0, opportunitiesAfter: 2, created: 2 });
    expect(repeated).toMatchObject({ legacyDealCards: 2, opportunitiesBefore: 2, opportunitiesAfter: 2, created: 0 });
    expect(db.prepare('SELECT * FROM landos_deal_card ORDER BY id').all()).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) AS n FROM landos_opportunity_legacy_alias WHERE alias_type = 'deal_card'").get()).toEqual({ n: 2 });
    expect(getOpportunityByDealCardId(first.id).legacyDealCardId).toBe(first.id);
    expect(getOpportunityByDealCardId(second.id).legacyDealCardId).toBe(second.id);
    expect(new Set(listOpportunities().map((row) => row.publicUid)).size).toBe(2);
  });

  it('promotes the same opportunity row without copying a Deal Card or opportunity', () => {
    const legacy = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Owner decision lead' });
    const lead = getOpportunityByDealCardId(legacy.id);
    const publicUid = lead.publicUid;

    const deal = ownerPursueOpportunityByDealCardId(legacy.id, { owner: 'owner', note: 'Pursue after discovery.' });

    expect(deal.id).toBe(lead.id);
    expect(deal.publicUid).toBe(publicUid);
    expect(deal.lifecycle).toBe('deal');
    expect(deal.pursuedAt).not.toBeNull();
    expect(deal.pursuedBy).toBe('owner');
    expect(getLandosDb().prepare('SELECT COUNT(*) AS n FROM landos_opportunity').get()).toEqual({ n: 1 });
    expect(getLandosDb().prepare('SELECT COUNT(*) AS n FROM landos_deal_card').get()).toEqual({ n: 1 });
    expect(ownerPursueOpportunity(lead.id, { owner: 'owner' })).toEqual(deal);
  });

  it('reconciles executive counts with the exact drilldown records', () => {
    const lead = createOpportunity({ entity: 'TY_LAND_BIZ', title: 'Lead' });
    const deal = createOpportunity({ entity: 'TY_LAND_BIZ', title: 'Deal' });
    const disposed = createOpportunity({ entity: 'TY_LAND_BIZ', title: 'Disposed' });
    createOpportunity({ entity: 'LAND_ALLY', title: 'Other entity' });
    ownerPursueOpportunity(deal.id, { owner: 'tyler' });
    ownerDisposeOpportunity(disposed.id, { owner: 'owner', disposition: 'duplicate' });

    const snapshot = getExecutiveOpportunitySnapshot('TY_LAND_BIZ');

    expect(snapshot.counts).toMatchObject({ total: 3, active: 2, leads: 1, deals: 1, disposed: 1 });
    expect(snapshot.records.map((row) => row.id).sort((a, b) => a - b)).toEqual([lead.id, deal.id, disposed.id].sort((a, b) => a - b));
    expect(snapshot.counts.leads + snapshot.counts.deals + snapshot.counts.disposed).toBe(snapshot.records.length);
    expect(Object.values(snapshot.counts.research).reduce((a, b) => a + b, 0)).toBe(snapshot.records.length);
    expect(Object.values(snapshot.counts.discovery).reduce((a, b) => a + b, 0)).toBe(snapshot.records.length);
  });

  it('keeps synthetic TEST LEAD records out of operating opportunity surfaces', () => {
    const priorMode = process.env.LANDOS_STORAGE_MODE;
    delete process.env.LANDOS_STORAGE_MODE;
    try {
      const operating = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Operating lead' });
      const synthetic = createDealCard({ entity: 'TY_LAND_BIZ', title: 'QA fixture', leadType: 'test' });
      backfillLegacyOpportunities();

      expect(listDealCards().map((card) => card.id)).toEqual([operating.id]);
      expect(listOpportunities().map((opportunity) => opportunity.legacyDealCardId)).toEqual([operating.id]);
      expect(listOpportunityBoardCards().map((card) => card.dealCardId)).toEqual([operating.id]);
      expect(getExecutiveOpportunitySnapshot().counts.total).toBe(1);
      expect(getOpportunityByDealCardId(synthetic.id).legacyDealCardId).toBe(synthetic.id);
    } finally {
      if (priorMode === undefined) delete process.env.LANDOS_STORAGE_MODE;
      else process.env.LANDOS_STORAGE_MODE = priorMode;
    }
  });

  it('persists research, discovery, owner disposition, and an immutable state history', () => {
    const created = createOpportunity({
      entity: 'TY_LAND_BIZ',
      title: 'Persistent manual lead',
      source: 'manual',
      rawInput: 'seller-provided clues',
    });
    updateOpportunityResearchStatus(created.id, 'running', { actor: 'Property Research Agent' });
    updateOpportunityResearchStatus(created.id, 'partial', { actor: 'Property Research Agent', note: 'County source unavailable.' });
    updateOpportunityDiscoveryStatus(created.id, 'brief_ready', { actor: 'Acquisitions Agent' });
    const disposed = ownerDisposeOpportunity(created.id, { owner: 'owner', disposition: 'nurture', note: 'Owner follow-up decision.' });

    const reread = getOpportunity(created.id);
    const detail = getOpportunityDetail(created.id);
    expect(reread).toMatchObject({
      id: created.id,
      publicUid: created.publicUid,
      lifecycle: 'disposed',
      disposition: 'nurture',
      researchStatus: 'partial',
      discoveryStatus: 'brief_ready',
      rawInput: 'seller-provided clues',
    });
    expect(disposed.pursuedAt).toBeNull();
    expect(detail?.history.map((event) => event.eventType)).toEqual([
      'created',
      'research_status_changed',
      'pipeline_stage_changed',
      'research_status_changed',
      'discovery_status_changed',
      'pipeline_stage_changed',
      'owner_disposed',
    ]);
    expect(() => ownerPursueOpportunity(created.id, { owner: 'Acquisitions Agent' })).toThrow(/only the owner/i);
  });
});
