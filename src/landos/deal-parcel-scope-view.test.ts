import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestDatabase } from '../db.js';
import { _initTestLandosDb } from './db.js';
import { createDealCard } from './deal-card.js';
import { buildDealParcelScopeView, retainedListingFacts, subjectIsVacantLand } from './deal-parcel-scope-view.js';
import { resetPropertyResearchStoreCache } from './property-research-store.js';

beforeEach(() => {
  _initTestDatabase();
  _initTestLandosDb();
  resetPropertyResearchStoreCache();
});

// The parcel scope joins the research store's lane-attempt table, which the
// store creates lazily on its first write. A fresh runtime (or a fresh store)
// reading a Deal Card before any research lane ran used to throw "no such
// table" inside the Deal Card read, and the card silently lost its parcel
// scope. The read must answer on its own.
describe('deal parcel scope on a fresh store', () => {
  it('answers before any research lane has ever written', () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: '4120 Release Harness Rd', sellerNotes: '', leadType: 'test' });
    expect(retainedListingFacts(deal.id)).toBeNull();
    expect(subjectIsVacantLand(deal.id, '0771-00-11-2233')).toBe(false);
    const view = buildDealParcelScopeView({
      dealCardId: deal.id,
      subjectApn: '0771-00-11-2233',
      subjectOwner: null,
      subjectAcres: 12.5,
      subjectIsVacant: false,
    });
    expect(view.subjectApn).toBe('0771-00-11-2233');
    expect(view.neighbors).toEqual([]);
    expect(view.subjectFactGuard.length).toBeGreaterThan(0);
  });
});
