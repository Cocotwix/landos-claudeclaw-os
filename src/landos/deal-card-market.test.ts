// Deal Card Market Research worksheet: persistence + honest-conclusion guards.
//
// Proves the worksheet round-trips through the LandOS DB (create -> reload ->
// edit -> reload, one row per deal), that demand/confidence labels are validated,
// that a demand rating without a supporting note is downgraded to needs_research,
// that source confidence 'high' requires a source link, and that no comp/active/
// sold/days-on-market/demand/price is invented. Generic placeholders only.

import { beforeEach, describe, it, expect } from 'vitest';

import { _initTestLandosDb, getLandosDb } from './db.js';
import { createDealCard } from './deal-card.js';
import { getDealCardMarket, upsertDealCardMarket } from './deal-card-market.js';

beforeEach(() => {
  _initTestLandosDb();
});

function newDeal(): number {
  return createDealCard({ entity: 'TY_LAND_BIZ', title: 'Generic market test deal' }).id;
}

describe('Deal Card Market Research worksheet — defaults', () => {
  it('returns an honest empty worksheet (exists=false, not_reviewed) when none saved', () => {
    const id = newDeal();
    const m = getDealCardMarket(id);
    expect(m.exists).toBe(false);
    expect(m.marketReviewStatus).toBe('not_reviewed');
    expect(m.buyerDemandLabel).toBe('not_reviewed');
    expect(m.manufacturedHomeDemandLabel).toBe('not_reviewed');
    expect(m.subdivisionDemandLabel).toBe('not_reviewed');
    expect(m.infillLotDemandLabel).toBe('not_reviewed');
    expect(m.ruralAcreageDemandLabel).toBe('not_reviewed');
    expect(m.sourceConfidence).toBe('unknown');
    expect(m.sourceLinks).toEqual([]);
    expect(m.dataGaps).toEqual([]);
    expect(m.riskFlags).toEqual([]);
    expect(m.updatedAt).toBeNull();
  });

  it('upsert on a missing deal card returns null', () => {
    expect(upsertDealCardMarket(999999, { targetAreaLabel: 'x' })).toBeNull();
  });
});

describe('Deal Card Market Research worksheet — create / reload / edit', () => {
  it('creates a worksheet and reads it back from a fresh query (persistence)', () => {
    const id = newDeal();
    const res = upsertDealCardMarket(id, {
      marketReviewStatus: 'moderate_demand',
      targetAreaLabel: 'Sample submarket',
      countyCityRegionNotes: 'Generic county notes',
      buyerDemandNotes: 'Local buyers active per manual review',
      buyerDemandLabel: 'strong_demand',
      activeListingNotes: 'A handful of generic active listings',
      soldCompContextNotes: 'Some recent sold context, manual only',
      daysOnMarketNotes: 'Reasonable DOM per manual notes',
      countyGrowthPlanningNotes: 'County planning notes',
      exitStrategySupportNotes: 'Supports a flip exit',
      dataGaps: ['Confirm absorption'],
      riskFlags: ['Thin sold data'],
    });
    expect(res).not.toBeNull();
    expect(res!.warnings).toEqual([]);

    const m = getDealCardMarket(id);
    expect(m.exists).toBe(true);
    expect(m.marketReviewStatus).toBe('moderate_demand');
    expect(m.targetAreaLabel).toBe('Sample submarket');
    expect(m.buyerDemandLabel).toBe('strong_demand');
    expect(m.buyerDemandNotes).toBe('Local buyers active per manual review');
    expect(m.activeListingNotes).toBe('A handful of generic active listings');
    expect(m.dataGaps).toEqual(['Confirm absorption']);
    expect(m.riskFlags).toEqual(['Thin sold data']);
    expect(m.updatedAt).toBeGreaterThan(0);
  });

  it('keeps ONE row per deal (upsert, never a duplicate)', () => {
    const id = newDeal();
    upsertDealCardMarket(id, { targetAreaLabel: 'A' });
    upsertDealCardMarket(id, { targetAreaLabel: 'B' });
    const n = (getLandosDb().prepare('SELECT COUNT(*) AS n FROM landos_deal_card_market WHERE deal_card_id = ?').get(id) as { n: number }).n;
    expect(n).toBe(1);
    expect(getDealCardMarket(id).targetAreaLabel).toBe('B');
  });

  it('partial edits do not clobber untouched fields', () => {
    const id = newDeal();
    upsertDealCardMarket(id, {
      buyerDemandNotes: 'keep buyer', buyerDemandLabel: 'moderate_demand',
      countyGrowthPlanningNotes: 'keep growth',
    });
    upsertDealCardMarket(id, { activeListingNotes: 'new actives' });
    const m = getDealCardMarket(id);
    expect(m.buyerDemandNotes).toBe('keep buyer');
    expect(m.buyerDemandLabel).toBe('moderate_demand');
    expect(m.countyGrowthPlanningNotes).toBe('keep growth');
    expect(m.activeListingNotes).toBe('new actives');
  });

  it('normalizes/cleans list inputs (trims, drops blanks)', () => {
    const id = newDeal();
    upsertDealCardMarket(id, { dataGaps: ['  a  ', '', '   ', 'b'], riskFlags: ['', 'r'] });
    const m = getDealCardMarket(id);
    expect(m.dataGaps).toEqual(['a', 'b']);
    expect(m.riskFlags).toEqual(['r']);
  });

  it('keeps demand lanes distinct (never collapsed into one rating)', () => {
    const id = newDeal();
    upsertDealCardMarket(id, {
      buyerDemandNotes: 'b', buyerDemandLabel: 'strong_demand',
      manufacturedHomeDemandNotes: 'mh', manufacturedHomeDemandLabel: 'weak_demand',
      subdivisionDemandNotes: 'sd', subdivisionDemandLabel: 'moderate_demand',
      infillLotDemandNotes: 'il', infillLotDemandLabel: 'mixed_uncertain',
      ruralAcreageDemandNotes: 'ra', ruralAcreageDemandLabel: 'weak_demand',
    });
    const m = getDealCardMarket(id);
    expect(m.buyerDemandLabel).toBe('strong_demand');
    expect(m.manufacturedHomeDemandLabel).toBe('weak_demand');
    expect(m.subdivisionDemandLabel).toBe('moderate_demand');
    expect(m.infillLotDemandLabel).toBe('mixed_uncertain');
    expect(m.ruralAcreageDemandLabel).toBe('weak_demand');
  });
});

describe('Deal Card Market Research worksheet — honest-conclusion guardrails', () => {
  it('accepts every honest demand label when backed by a note', () => {
    const id = newDeal();
    for (const d of ['not_reviewed', 'needs_research', 'weak_demand', 'moderate_demand', 'strong_demand', 'mixed_uncertain'] as const) {
      const res = upsertDealCardMarket(id, { buyerDemandLabel: d, buyerDemandNotes: 'manual basis' });
      expect(res!.market.buyerDemandLabel).toBe(d);
    }
  });

  it('downgrades a concrete demand rating with no supporting note to needs_research', () => {
    const id = newDeal();
    const res = upsertDealCardMarket(id, { subdivisionDemandLabel: 'strong_demand', subdivisionDemandNotes: '' });
    expect(res!.market.subdivisionDemandLabel).toBe('needs_research');
    expect(res!.warnings.some((w) => /Subdivision demand/i.test(w))).toBe(true);
  });

  it('does NOT downgrade not_reviewed/needs_research without a note (honest non-conclusions)', () => {
    const id = newDeal();
    const res = upsertDealCardMarket(id, { buyerDemandLabel: 'needs_research' });
    expect(res!.market.buyerDemandLabel).toBe('needs_research');
    expect(res!.warnings).toEqual([]);
  });

  it('downgrades source confidence high to needs_research without a source link', () => {
    const id = newDeal();
    const res = upsertDealCardMarket(id, { sourceConfidence: 'high' });
    expect(res!.market.sourceConfidence).toBe('needs_research');
    expect(res!.warnings.some((w) => /confidence/i.test(w))).toBe(true);
  });

  it('keeps source confidence high when a named source link is present', () => {
    const id = newDeal();
    const res = upsertDealCardMarket(id, {
      sourceConfidence: 'high',
      sourceLinks: [{ label: 'County planning', url: 'https://example.gov/planning' }],
    });
    expect(res!.market.sourceConfidence).toBe('high');
    expect(res!.market.sourceLinks.length).toBe(1);
    expect(res!.warnings).toEqual([]);
  });

  it('ignores an unknown demand label and keeps the prior value', () => {
    const id = newDeal();
    upsertDealCardMarket(id, { buyerDemandLabel: 'moderate_demand', buyerDemandNotes: 'basis' });
    // @ts-expect-error — exercising runtime validation with a bad label.
    const res = upsertDealCardMarket(id, { buyerDemandLabel: 'booming_trust_me' });
    expect(res!.market.buyerDemandLabel).toBe('moderate_demand');
  });
});
