// Deal Card Strategy worksheet: persistence + readiness/strategy guardrails.
//
// Proves the worksheet round-trips through the LandOS DB (create -> reload ->
// edit -> reload, one row per deal), that offer-readiness is validated, that
// distinct exit strategies stay distinct, and that no offer/comp/EV is invented.

import { beforeEach, describe, it, expect } from 'vitest';

import { _initTestLandosDb, getLandosDb } from './db.js';
import { createDealCard } from './deal-card.js';
import { getDealCardStrategy, upsertDealCardStrategy } from './deal-card-strategy.js';

beforeEach(() => {
  _initTestLandosDb();
});

function newDeal(): number {
  return createDealCard({ entity: 'TY_LAND_BIZ', title: 'Generic strategy test deal' }).id;
}

describe('Deal Card Strategy worksheet — defaults', () => {
  it('returns an honest empty worksheet (exists=false, not_reviewed) when none saved', () => {
    const id = newDeal();
    const s = getDealCardStrategy(id);
    expect(s.exists).toBe(false);
    expect(s.offerReadiness).toBe('not_reviewed');
    expect(s.strategyCandidates).toEqual([]);
    expect(s.blockers).toEqual([]);
    expect(s.nextConfirmations).toEqual([]);
    expect(s.currentRecommendation).toBe('');
    expect(s.quickFlipNotes).toBe('');
    expect(s.targetProfitNote).toBe('');
    expect(s.updatedAt).toBeNull();
  });

  it('upsert on a missing deal card returns null', () => {
    expect(upsertDealCardStrategy(999999, { currentRecommendation: 'x' })).toBeNull();
  });
});

describe('Deal Card Strategy worksheet — create / reload / edit', () => {
  it('creates a worksheet and reads it back from a fresh query', () => {
    const id = newDeal();
    const res = upsertDealCardStrategy(id, {
      offerReadiness: 'needs_confirmation',
      strategyCandidates: ['Quick flip', 'Subdivide'],
      blockers: ['Confirm access'],
      nextConfirmations: ['Confirm zoning with county'],
      currentRecommendation: 'Lean subdivide pending access',
      mostViableStrategy: 'Subdivide',
      quickFlipNotes: 'Thin margin as-is',
      subdivideNotes: 'Two-lot split looks plausible',
      teardownLandOnlyNotes: 'Fallback only',
      passNoOfferReason: '',
      targetProfitNote: 'Aim well above the $10k clear baseline',
    });
    expect(res).not.toBeNull();
    expect(res!.warnings).toEqual([]);

    const s = getDealCardStrategy(id);
    expect(s.exists).toBe(true);
    expect(s.offerReadiness).toBe('needs_confirmation');
    expect(s.strategyCandidates).toEqual(['Quick flip', 'Subdivide']);
    expect(s.blockers).toEqual(['Confirm access']);
    expect(s.nextConfirmations).toEqual(['Confirm zoning with county']);
    expect(s.currentRecommendation).toBe('Lean subdivide pending access');
    expect(s.mostViableStrategy).toBe('Subdivide');
    expect(s.quickFlipNotes).toBe('Thin margin as-is');
    expect(s.subdivideNotes).toBe('Two-lot split looks plausible');
    expect(s.teardownLandOnlyNotes).toBe('Fallback only');
    expect(s.targetProfitNote).toBe('Aim well above the $10k clear baseline');
    expect(s.updatedAt).toBeGreaterThan(0);
  });

  it('keeps ONE row per deal (upsert, never a duplicate)', () => {
    const id = newDeal();
    upsertDealCardStrategy(id, { currentRecommendation: 'A' });
    upsertDealCardStrategy(id, { currentRecommendation: 'B' });
    const n = (getLandosDb().prepare('SELECT COUNT(*) AS n FROM landos_deal_card_strategy WHERE deal_card_id = ?').get(id) as { n: number }).n;
    expect(n).toBe(1);
    expect(getDealCardStrategy(id).currentRecommendation).toBe('B');
  });

  it('partial edits do not clobber untouched fields', () => {
    const id = newDeal();
    upsertDealCardStrategy(id, { quickFlipNotes: 'keep flip', subdivideNotes: 'keep split', strategyCandidates: ['keep me'] });
    upsertDealCardStrategy(id, { blockers: ['new blocker'] });
    const s = getDealCardStrategy(id);
    expect(s.quickFlipNotes).toBe('keep flip');
    expect(s.subdivideNotes).toBe('keep split');
    expect(s.strategyCandidates).toEqual(['keep me']);
    expect(s.blockers).toEqual(['new blocker']);
  });

  it('normalizes/cleans list inputs (trims, drops blanks)', () => {
    const id = newDeal();
    upsertDealCardStrategy(id, { strategyCandidates: ['  a  ', '', '   ', 'b'], blockers: ['', 'r'] });
    const s = getDealCardStrategy(id);
    expect(s.strategyCandidates).toEqual(['a', 'b']);
    expect(s.blockers).toEqual(['r']);
  });

  it('keeps distinct exit strategies in distinct fields (never collapsed)', () => {
    const id = newDeal();
    upsertDealCardStrategy(id, {
      quickFlipNotes: 'qf', subdivideNotes: 'sd', landHomePackageNotes: 'lh',
      improvedValueAddNotes: 'iv', teardownLandOnlyNotes: 'td', passNoOfferReason: 'pass why',
    });
    const s = getDealCardStrategy(id);
    expect(s.quickFlipNotes).toBe('qf');
    expect(s.subdivideNotes).toBe('sd');
    expect(s.landHomePackageNotes).toBe('lh');
    expect(s.improvedValueAddNotes).toBe('iv');
    expect(s.teardownLandOnlyNotes).toBe('td');
    expect(s.passNoOfferReason).toBe('pass why');
    // Each lane is independent — no single combined value.
    const distinct = new Set([s.quickFlipNotes, s.subdivideNotes, s.landHomePackageNotes, s.improvedValueAddNotes, s.teardownLandOnlyNotes]);
    expect(distinct.size).toBe(5);
  });
});

describe('Deal Card Strategy worksheet — readiness guardrails', () => {
  it('accepts every honest readiness label', () => {
    const id = newDeal();
    for (const r of ['not_reviewed', 'needs_confirmation', 'blocked', 'ready_for_offer', 'pass'] as const) {
      const res = upsertDealCardStrategy(id, { offerReadiness: r });
      expect(res!.strategy.offerReadiness).toBe(r);
      expect(res!.warnings).toEqual([]);
    }
  });

  it('ignores an unknown readiness label and keeps the prior value with a warning', () => {
    const id = newDeal();
    upsertDealCardStrategy(id, { offerReadiness: 'blocked' });
    // @ts-expect-error — exercising runtime validation with a bad label.
    const res = upsertDealCardStrategy(id, { offerReadiness: 'offer_now_trust_me' });
    expect(res!.strategy.offerReadiness).toBe('blocked');
    expect(res!.warnings.some((w) => /offer readiness/i.test(w))).toBe(true);
  });

  it('never invents a target-profit number; the note persists verbatim as text', () => {
    const id = newDeal();
    upsertDealCardStrategy(id, { targetProfitNote: 'aim above baseline; no comps yet' });
    expect(getDealCardStrategy(id).targetProfitNote).toBe('aim above baseline; no comps yet');
  });
});
