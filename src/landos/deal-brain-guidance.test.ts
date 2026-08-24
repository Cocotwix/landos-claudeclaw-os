import { describe, expect, it } from 'vitest';

import { createDealCard } from './deal-card.js';
import {
  appendDealBrainGuidance,
  listDealBrainGuidance,
  projectCurrentDealBrainGuidance,
  retireDealBrainReplies,
  type DealBrainGuidanceEntry,
} from './deal-brain-guidance.js';
import { _initTestLandosDb, getLandosDb } from './db.js';

const entry = (id: number, role: DealBrainGuidanceEntry['role'], text: string): DealBrainGuidanceEntry => ({
  id,
  dealCardId: 89,
  role,
  text,
  createdAt: 1_787_168_500 + id,
});

describe('Deal Brain current-truth projection', () => {
  it('withholds a retained reply that denies accepted sales and supported FMV now present', () => {
    const operator = entry(1, 'operator', 'Focus on the simple quick flip.');
    const stale = entry(
      2,
      'deal_brain',
      'The quick flip remains pending because no supported FMV or accepted closed-sale comp evidence exists.',
    );

    const projected = projectCurrentDealBrainGuidance([operator, stale], {
      acceptedCompCount: 3,
      supportedFmv: 3_084_000,
    });

    expect(projected.thread).toEqual([operator]);
    expect(projected.staleReplies).toHaveLength(1);
    expect(projected.staleReplies[0].staleReason).toContain('3 accepted closed sale(s)');
    expect(projected.staleReplies[0].staleReason).toContain('supported FMV $3,084,000');
  });

  it('does not suppress the same honest limitation while current evidence is still absent', () => {
    const reply = entry(2, 'deal_brain', 'No supported FMV or accepted closed-sale comp evidence exists yet.');
    const projected = projectCurrentDealBrainGuidance([reply], {
      acceptedCompCount: 0,
      supportedFmv: null,
    });
    expect(projected.thread).toEqual([reply]);
    expect(projected.staleReplies).toEqual([]);
  });

  it('retires only superseded replies while retaining operator guidance and the historical row', () => {
    _initTestLandosDb();
    const dealId = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Current-truth test' }).id;
    const operator = appendDealBrainGuidance(dealId, 'operator', 'Use the current accepted evidence.');
    const reply = appendDealBrainGuidance(dealId, 'deal_brain', 'No supported FMV exists.');

    expect(retireDealBrainReplies(dealId, [reply.id])).toBe(1);
    expect(listDealBrainGuidance(dealId)).toEqual([operator]);
    expect(getLandosDb().prepare(
      'SELECT status FROM landos_deal_brain_guidance WHERE id=?',
    ).get(reply.id)).toEqual({ status: 'retired' });
  });
});
