// Deal Card DD/Research worksheet: persistence + label guardrails.
//
// Proves the worksheet round-trips through the LandOS DB (create -> reload ->
// edit -> reload, one row per deal), that confidence labels are validated, and
// that the verification guardrails hold: a 'Verified' field without a source
// link is downgraded, and 'source_verified' identity requires a source link.

import { beforeEach, describe, it, expect } from 'vitest';

import { _initTestLandosDb, getLandosDb } from './db.js';
import { createDealCard } from './deal-card.js';
import { getDealCardDd, upsertDealCardDd } from './deal-card-dd.js';

beforeEach(() => {
  _initTestLandosDb();
});

function newDeal(): number {
  return createDealCard({ entity: 'TY_LAND_BIZ', title: 'Generic DD test deal' }).id;
}

describe('Deal Card DD worksheet — defaults', () => {
  it('returns an honest empty worksheet (exists=false) when none saved', () => {
    const id = newDeal();
    const dd = getDealCardDd(id);
    expect(dd.exists).toBe(false);
    expect(dd.parcelIdentityStatus).toBe('local_area_context_not_verified');
    expect(dd.apnLabel).toBe('Unknown');
    expect(dd.dataGaps).toEqual([]);
    expect(dd.riskFlags).toEqual([]);
    expect(dd.sourceLinks).toEqual([]);
    expect(dd.acreage).toBeNull();
  });

  it('upsert on a missing deal card returns null', () => {
    expect(upsertDealCardDd(999999, { apn: 'x' })).toBeNull();
  });
});

describe('Deal Card DD worksheet — create / reload / edit', () => {
  it('creates a worksheet and reads it back from a fresh query', () => {
    const id = newDeal();
    const res = upsertDealCardDd(id, {
      apn: '123-456', apnLabel: 'Seller stated',
      county: 'Sample County', state: 'TX', locationLabel: 'Assumed',
      acreage: 40, acreageLabel: 'Seller stated',
      zoning: 'Agricultural', zoningLabel: 'Assumed',
      accessStatus: 'Road frontage', accessLabel: 'Needs verification',
      dataGaps: ['Confirm legal access', 'Confirm flood zone'],
      riskFlags: ['No recorded survey'],
    });
    expect(res).not.toBeNull();
    expect(res!.warnings).toEqual([]);

    const dd = getDealCardDd(id);
    expect(dd.exists).toBe(true);
    expect(dd.apn).toBe('123-456');
    expect(dd.apnLabel).toBe('Seller stated');
    expect(dd.county).toBe('Sample County');
    expect(dd.state).toBe('TX');
    expect(dd.acreage).toBe(40);
    expect(dd.zoning).toBe('Agricultural');
    expect(dd.accessStatus).toBe('Road frontage');
    expect(dd.dataGaps).toEqual(['Confirm legal access', 'Confirm flood zone']);
    expect(dd.riskFlags).toEqual(['No recorded survey']);
    expect(dd.updatedAt).toBeGreaterThan(0);
  });

  it('keeps ONE row per deal (upsert, never a duplicate)', () => {
    const id = newDeal();
    upsertDealCardDd(id, { apn: 'A' });
    upsertDealCardDd(id, { apn: 'B' });
    const n = (getLandosDb().prepare('SELECT COUNT(*) AS n FROM landos_deal_card_dd WHERE deal_card_id = ?').get(id) as { n: number }).n;
    expect(n).toBe(1);
    expect(getDealCardDd(id).apn).toBe('B');
  });

  it('partial edits do not clobber untouched fields', () => {
    const id = newDeal();
    upsertDealCardDd(id, { apn: 'keep', zoning: 'Residential', dataGaps: ['keep gap'] });
    upsertDealCardDd(id, { accessStatus: 'Easement' });
    const dd = getDealCardDd(id);
    expect(dd.apn).toBe('keep');
    expect(dd.zoning).toBe('Residential');
    expect(dd.dataGaps).toEqual(['keep gap']);
    expect(dd.accessStatus).toBe('Easement');
  });

  it('acreage can be explicitly cleared back to null', () => {
    const id = newDeal();
    upsertDealCardDd(id, { acreage: 12.5 });
    expect(getDealCardDd(id).acreage).toBe(12.5);
    upsertDealCardDd(id, { acreage: null });
    expect(getDealCardDd(id).acreage).toBeNull();
  });

  it('normalizes/cleans list inputs (trims, drops blanks)', () => {
    const id = newDeal();
    upsertDealCardDd(id, { dataGaps: ['  a  ', '', '   ', 'b'], riskFlags: ['', 'r'] });
    const dd = getDealCardDd(id);
    expect(dd.dataGaps).toEqual(['a', 'b']);
    expect(dd.riskFlags).toEqual(['r']);
  });

  it('keeps only source links that carry a url', () => {
    const id = newDeal();
    upsertDealCardDd(id, { sourceLinks: [{ label: 'GIS', url: 'https://example.gov/gis' }, { label: 'blank', url: '' }] });
    const dd = getDealCardDd(id);
    expect(dd.sourceLinks).toEqual([{ label: 'GIS', url: 'https://example.gov/gis' }]);
  });
});

describe('Deal Card DD worksheet — verification guardrails', () => {
  it('downgrades a Verified field that has no source link', () => {
    const id = newDeal();
    const res = upsertDealCardDd(id, { apn: '777', apnLabel: 'Verified' });
    expect(res!.dd.apnLabel).toBe('Needs verification');
    expect(res!.warnings.some((w) => /APN/.test(w))).toBe(true);
    expect(getDealCardDd(id).apnLabel).toBe('Needs verification');
  });

  it('keeps a Verified field when a source link is present', () => {
    const id = newDeal();
    const res = upsertDealCardDd(id, {
      acreage: 10, acreageLabel: 'Verified',
      sourceLinks: [{ label: 'County GIS', url: 'https://example.gov/parcel' }],
    });
    expect(res!.dd.acreageLabel).toBe('Verified');
    expect(res!.warnings).toEqual([]);
  });

  it('downgrades source_verified identity without a source link', () => {
    const id = newDeal();
    const res = upsertDealCardDd(id, { parcelIdentityStatus: 'source_verified' });
    expect(res!.dd.parcelIdentityStatus).toBe('local_area_context_not_verified');
    expect(res!.warnings.some((w) => /identity/i.test(w))).toBe(true);
  });

  it('allows source_verified identity with a source link', () => {
    const id = newDeal();
    const res = upsertDealCardDd(id, {
      parcelIdentityStatus: 'source_verified',
      sourceLinks: [{ label: 'Assessor', url: 'https://example.gov/assessor' }],
    });
    expect(res!.dd.parcelIdentityStatus).toBe('source_verified');
    expect(res!.warnings).toEqual([]);
  });

  it('rejects an invalid confidence label, falling back to Unknown', () => {
    const id = newDeal();
    // @ts-expect-error — exercising runtime validation with a bad label.
    const res = upsertDealCardDd(id, { zoningLabel: 'TotallyVerifiedForReal' });
    expect(res!.dd.zoningLabel).toBe('Unknown');
  });
});
