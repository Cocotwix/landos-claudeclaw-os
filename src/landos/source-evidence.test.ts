import { describe, it, expect } from 'vitest';

import {
  classifySource,
  evaluateFact,
  evaluateComp,
  evaluateZoning,
} from './source-evidence.js';

describe('classifySource', () => {
  it('classifies official, landportal, marketplace, and context sources', () => {
    expect(classifySource({ url: 'https://gis.lexingtonsc.gov/parcel/123' })).toBe('official');
    expect(classifySource({ label: 'County assessor record' })).toBe('official');
    expect(classifySource({ label: 'lp_resolve_property verified:true' })).toBe('landportal');
    expect(classifySource({ url: 'https://www.zillow.com/homedetails/x' })).toBe('marketplace');
    expect(classifySource({ url: 'https://www.countyoffice.org/x' })).toBe('marketplace'); // impostor, not official
    expect(classifySource({ label: 'Local area context: area stats' })).toBe('local_context');
    expect(classifySource({})).toBe('unknown');
  });
});

describe('evaluateFact — Source Evidence Standard', () => {
  it('no source link means not verified and not offer-usable', () => {
    const r = evaluateFact({ fact: 'acreage', value: '5', parcelVerified: true });
    expect(r.hasSourceLink).toBe(false);
    expect(r.usableForOfferLogic).toBe(false);
    expect(r.label).toContain('unverified');
  });

  it('a source link cannot overcome an unverified parcel', () => {
    const r = evaluateFact({ fact: 'zoning', sourceUrl: 'https://county.gov/zoning', parcelVerified: false });
    expect(r.hasSourceLink).toBe(true);
    expect(r.usableForOfferLogic).toBe(false);
  });

  it('official source + verified parcel is offer-usable', () => {
    const r = evaluateFact({ fact: 'zoning', sourceUrl: 'https://planning.county.gov/ord', parcelVerified: true });
    expect(r.sourceType).toBe('official');
    expect(r.usableForOfferLogic).toBe(true);
  });

  it('local context is never offer-usable even with a verified parcel', () => {
    const r = evaluateFact({ fact: 'market', sourceLabel: 'Local area context', parcelVerified: true });
    expect(r.usableForOfferLogic).toBe(false);
  });

  it('an official-LOOKING sourceLabel with no sourceUrl is NOT a source link', () => {
    const r = evaluateFact({ fact: 'zoning', sourceLabel: 'County assessor record', parcelVerified: true });
    expect(r.hasSourceLink).toBe(false);
    expect(r.usableForOfferLogic).toBe(false);
    expect(r.label).toContain('unverified');
  });

  it('a LandPortal sourceLabel alone (no url) does not satisfy the source-link requirement', () => {
    const r = evaluateFact({ fact: 'acreage', sourceLabel: 'lp_property_data', parcelVerified: true });
    expect(r.hasSourceLink).toBe(false);
    expect(r.usableForOfferLogic).toBe(false);
  });

  it('an official sourceUrl + verified parcel IS offer-usable (all rules pass)', () => {
    const r = evaluateFact({ fact: 'zoning', sourceUrl: 'https://gis.county.gov/parcel/1', parcelVerified: true });
    expect(r.hasSourceLink).toBe(true);
    expect(r.usableForOfferLogic).toBe(true);
  });
});

describe('evaluateComp', () => {
  it('flags missing required comp fields', () => {
    const r = evaluateComp({ addressOrLabel: 'Lot 4', parcelVerified: true });
    expect(r.valid).toBe(false);
    expect(r.missing).toEqual(expect.arrayContaining(['price', 'sourceUrl', 'whyComparable']));
    expect(r.usableForOfferLogic).toBe(false);
  });

  it('a complete comp with a source and verified parcel is offer-usable', () => {
    const r = evaluateComp({
      addressOrLabel: '123 Rural Rd',
      price: 42000,
      saleOrListDate: '2025-08-01',
      acres: 5,
      sourceUrl: 'https://www.landwatch.com/x',
      whyComparable: 'Same county, similar acreage, recent sale',
      parcelVerified: true,
    });
    expect(r.valid).toBe(true);
    expect(r.usableForOfferLogic).toBe(true);
  });
});

describe('evaluateZoning', () => {
  it('requires shape fields and an official source for offer use', () => {
    const incomplete = evaluateZoning({ preliminaryAnswer: 'Likely R-1', parcelVerified: true });
    expect(incomplete.valid).toBe(false);

    const marketplace = evaluateZoning({
      preliminaryAnswer: 'Likely splittable',
      sourceUrl: 'https://www.zillow.com/x',
      whatIsVerified: 'listing claims',
      whatNeedsCountyConfirmation: 'minimum lot size',
      parcelVerified: true,
    });
    expect(marketplace.valid).toBe(true);
    expect(marketplace.usableForOfferLogic).toBe(false); // marketplace is not official

    const official = evaluateZoning({
      preliminaryAnswer: 'By-right split allowed at 1ac min',
      sourceUrl: 'https://library.municode.com/sc/lexington_county/ordinances',
      ordinanceRef: 'Sec. 5.2',
      whatIsVerified: 'minimum lot size from ordinance',
      whatNeedsCountyConfirmation: 'frontage and utility easements',
      parcelVerified: true,
    });
    expect(official.valid).toBe(true);
    expect(official.usableForOfferLogic).toBe(true);
  });
});
