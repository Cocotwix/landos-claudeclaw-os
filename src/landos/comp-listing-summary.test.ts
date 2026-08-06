// Source description vs LandOS summary.
//
// The failure mode under test: a broker writes "perc approved, utilities at the
// road, ready to build", LandOS folds it into its own summary, and an offer gets
// underwritten on someone else's sales copy. The two blocks must never blend,
// and a marketing claim must appear AS a claim.

import { describe, expect, it } from 'vitest';

import {
  buildSourceDescription, detectMarketingClaims, detectDescribedFeatures,
  buildLandosFactualSummary,
} from './comp-listing-summary.js';

describe('source description', () => {
  it('preserves the wording verbatim and attributes it to the platform', () => {
    const text = '  Beautiful   wooded 9.85 acre parcel.\nPerc approved and ready to build!  ';
    const d = buildSourceDescription(text, 'Zillow');
    expect(d?.text).toBe('Beautiful wooded 9.85 acre parcel. Perc approved and ready to build!');
    expect(d?.attribution).toBe('Zillow listing description');
    expect(d?.isMarketingCopy).toBe(true);
    expect(d?.note).toContain('does not treat it as verified fact');
  });

  it('never strengthens the claim, and returns null for an empty description', () => {
    const d = buildSourceDescription('Possible building site.', 'Redfin');
    expect(d?.text).toBe('Possible building site.');
    expect(buildSourceDescription(null, 'Redfin')).toBeNull();
    expect(buildSourceDescription('   ', 'Redfin')).toBeNull();
  });
});

describe('marketing-claim detection', () => {
  it('finds fact-sounding claims and marks them unverified with their sentence', () => {
    const claims = detectMarketingClaims('Wooded acreage. Perc approved in 2024. Utilities are at the road. Unrestricted!');
    const names = claims.map((c) => c.claim);
    expect(names).toEqual(expect.arrayContaining(['perc approved', 'utilities available', 'unrestricted']));
    expect(claims.every((c) => c.status === 'unverified_marketing_claim')).toBe(true);
    expect(claims.find((c) => c.claim === 'perc approved')?.excerpt).toBe('Perc approved in 2024.');
  });

  it('promotes a claim only when it was independently confirmed', () => {
    const claims = detectMarketingClaims('Perc approved. Ready to build.', ['perc approved']);
    expect(claims.find((c) => c.claim === 'perc approved')?.status).toBe('independently_confirmed');
    expect(claims.find((c) => c.claim === 'ready to build')?.status).toBe('unverified_marketing_claim');
  });

  it('reads described physical features without asserting them', () => {
    expect(detectDescribedFeatures('Wooded parcel with a creek running through and rolling terrain.'))
      .toEqual(expect.arrayContaining(['wooded', 'water feature', 'sloped or rolling terrain']));
  });
});

describe('LandOS factual summary', () => {
  const base = {
    address: '0 State Route 34, Cato, NY 13033',
    acres: 9.85,
    subjectAcres: 11.46,
    distanceMiles: 12.4,
    county: 'Cayuga',
    state: 'NY',
    transactionKind: 'closed' as const,
    verifiedFacts: ['verified closed sale of $49,900 on 2025-11-18'],
  };

  it('states structural facts and keeps marketing claims out of the narrative', () => {
    const s = buildLandosFactualSummary({
      ...base,
      sourceDescription: 'Wooded 9.85 acre rural parcel. Perc approved and ready to build. Utilities available at the road.',
    });
    // The narrative describes; it does not assert the claims.
    expect(s.text).toContain('9.85 acre');
    expect(s.text).toContain('Listing claims not independently confirmed');
    expect(s.sourceClaims.map((c) => c.claim)).toEqual(expect.arrayContaining(['perc approved', 'ready to build', 'utilities available']));
    expect(s.sourceClaims.every((c) => c.status === 'unverified_marketing_claim')).toBe(true);
    expect(s.note).toContain('never treated as verified facts');
  });

  it('separates verified facts, claims, unresolved items and comparability', () => {
    const s = buildLandosFactualSummary({ ...base, sourceDescription: 'Nice wooded lot.' });
    expect(s.verified).toEqual(expect.arrayContaining(['verified closed sale of $49,900 on 2025-11-18', '9.85 acres', 'Cayuga, NY']));
    expect(s.unresolved.join(' ')).toContain('no verified well, septic, driveway, or utility improvement');
    expect(s.comparability.join(' ')).toContain('1.61 acres smaller than the 11.46-acre subject');
    expect(s.comparability.join(' ')).toContain('12.4 miles from the subject');
  });

  it('says road frontage is unestablished unless retained evidence proves it', () => {
    const unknown = buildLandosFactualSummary({ ...base, sourceDescription: null });
    expect(unknown.unresolved.join(' ')).toContain('road frontage is not independently established');
    expect(unknown.text).not.toContain('road frontage');

    const verified = buildLandosFactualSummary({ ...base, sourceDescription: null, roadFrontageVerified: true });
    expect(verified.verified.join(' ')).toContain('public road frontage established by retained evidence');
    expect(verified.text).toContain('verified public road frontage');
  });

  it('states that an improved comparable cannot price vacant land', () => {
    const s = buildLandosFactualSummary({
      ...base, propertyClass: 'improved', buildingSqft: 1680, sourceDescription: null,
    });
    expect(s.comparability.join(' ')).toContain('cannot price vacant land directly');
    expect(s.verified.join(' ')).toContain('1,680 sqft structure');
  });

  it('reports distance as unavailable rather than inventing one', () => {
    const s = buildLandosFactualSummary({ ...base, distanceMiles: null, sourceDescription: null });
    expect(s.comparability.join(' ')).toContain('Distance from the subject is unavailable');
  });
});
