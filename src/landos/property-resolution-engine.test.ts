import { describe, it, expect } from 'vitest';
import { resolveProperty, parcelIdentityEstablished, type ResolutionDeps } from './property-resolution-engine.js';
import { emptyNormalizedProperty } from './normalized-property.js';
import type { DukeVerificationResult } from './duke-verification-bridge.js';
import type { ParsedIntakeFields } from './intake-router.js';
import type { SuggestResult } from './address-suggest.js';
import type { DerivedCounty } from './providers/county-geocode.js';

const NOW = () => '2026-06-29T00:00:00.000Z';

function verified(fields: ParsedIntakeFields): DukeVerificationResult {
  return {
    status: 'parcel_verified', parcelVerified: true, verificationSource: 'Realie.ai (non-credit)',
    identity: { situsAddress: fields.address ?? '388 Gilstrap Rd', city: 'Cleveland', state: 'GA', county: 'White', apn: '042 123', acres: 5 },
    coordinates: { lat: 34.59, lng: -83.76 },
    sourceAttempts: [], dataGaps: [], marketPulseEligible: true, strategyUnderwritingBlocked: false,
    summary: 'Parcel verified.', executionMode: 'duke_verification_read_only',
  };
}

function needsCounty(): DukeVerificationResult {
  return {
    status: 'unverified', parcelVerified: false,
    sourceAttempts: [], dataGaps: ['needs_county_or_fips'], marketPulseEligible: false,
    strategyUnderwritingBlocked: true, summary: 'Needs county/FIPS.', executionMode: 'duke_verification_read_only',
  };
}

function noIdentity(): DukeVerificationResult {
  return {
    status: 'skipped_no_identity', parcelVerified: false,
    sourceAttempts: [], dataGaps: ['no_parcel_identifier_in_input'], marketPulseEligible: false,
    strategyUnderwritingBlocked: true, summary: 'No identifier.', executionMode: 'duke_verification_read_only',
  };
}

const gilstrapSuggest: SuggestResult = {
  query: '388 Gilstrap Rd, Cleveland, GA 30528',
  suggestions: [{
    label: '388 Gilstrap Rd, Cleveland, GA 30528', line1: '388 Gilstrap Rd', city: 'Cleveland', state: 'GA',
    zip: '30528', county: 'White', coordinates: { lat: 34.59, lng: -83.76 }, source: 'Photon', confidence: 0.8,
  }],
  source: 'Photon', cached: false,
};

const gilstrapCensus: DerivedCounty = { county: 'White', state: 'GA', zip: '30528', fips: '13311', lat: 34.59, lng: -83.76 };

describe('property resolution engine', () => {
  it('Matched immediately when a named source verifies the parcel', async () => {
    const deps: ResolutionDeps = { verify: async (f) => verified(f), now: NOW };
    const r = await resolveProperty({ fields: { address: '388 Gilstrap Rd', city: 'Cleveland', state: 'GA', county: 'White' } }, deps);
    expect(r.status).toBe('matched');
    expect(r.property.parcelVerified).toBe(true);
    expect(r.property.verificationSource).toContain('Realie');
    expect(r.matchedReason).toMatch(/verified/i);
  });

  it('388 Gilstrap: Matched via census county-derivation + retry verify (no empty Deal Card)', async () => {
    let call = 0;
    const deps: ResolutionDeps = {
      verify: async (f) => { call += 1; return call === 1 ? needsCounty() : verified(f); },
      deriveCounty: async () => gilstrapCensus,
      suggest: async () => gilstrapSuggest,
      now: NOW,
    };
    const r = await resolveProperty({ rawText: '388 Gilstrap Rd, Cleveland, GA 30528' }, deps);
    expect(r.status).toBe('matched');
    expect(r.property.parcelVerified).toBe(true);
    expect(r.property.county).toBe('White');
    expect(r.lanesAttempted.some((l) => l.lane === 'census_geocode' && l.contributed)).toBe(true);
  });

  it('HARD APN CONFLICT: requested ...0085 but resolver returns a DIFFERENT parcel ...0084 — no confirm, no downstream (Beaufort regression)', async () => {
    const wrongParcel: DukeVerificationResult = {
      status: 'parcel_verified', parcelVerified: true, verificationSource: 'Realie.ai (non-credit)',
      identity: { situsAddress: '30 CLIFFORD AND MINNIE RD', city: 'Saint Helena Island', state: 'SC', county: 'Beaufort', apn: 'R300 018 000 0084 0000', owner: 'BUSH LISA', acres: 5 },
      coordinates: { lat: 32.37, lng: -80.56 },
      sourceAttempts: [], dataGaps: [], marketPulseEligible: true, strategyUnderwritingBlocked: false,
      summary: 'Parcel verified.', executionMode: 'duke_verification_read_only',
    };
    const deps: ResolutionDeps = { verify: async () => wrongParcel, now: NOW };
    const r = await resolveProperty({ fields: { address: '473 SEASIDE RD', city: 'Saint Helena Island', state: 'SC', zip: '29920', apn: 'R300 018 000 0085 0000' } }, deps);
    expect(r.status).toBe('needs_clarification');
    expect(r.identityEstablished).toBe(false);
    expect(r.identityConflict).toBeDefined();
    expect(r.identityConflict?.requestedApn).toBe('R300 018 000 0085 0000');
    expect(r.identityConflict?.resolvedApn).toBe('R300 018 000 0084 0000');
    expect(r.matchedReason).toMatch(/does not match/i);
  });

  it('APN format difference is NOT a conflict (same parcel, different punctuation)', async () => {
    const sameParcel: DukeVerificationResult = {
      status: 'parcel_verified', parcelVerified: true, verificationSource: 'Realie.ai (non-credit)',
      identity: { situsAddress: '473 SEASIDE RD', city: 'Saint Helena Island', state: 'SC', county: 'Beaufort', apn: 'R300-018-000-0085-0000', owner: 'SUBJECT OWNER', acres: 5 },
      sourceAttempts: [], dataGaps: [], marketPulseEligible: true, strategyUnderwritingBlocked: false,
      summary: 'Parcel verified.', executionMode: 'duke_verification_read_only',
    };
    const deps: ResolutionDeps = { verify: async () => sameParcel, now: NOW };
    const r = await resolveProperty({ fields: { address: '473 SEASIDE RD', state: 'SC', apn: 'R300 018 000 0085 0000' } }, deps);
    expect(r.status).toBe('matched');
    expect(r.identityConflict).toBeUndefined();
    expect(r.identityEstablished).toBe(true);
  });

  it('388 Gilstrap: Matched on credible corroboration even when Realie never verifies', async () => {
    const deps: ResolutionDeps = {
      verify: async () => needsCounty(),
      deriveCounty: async () => gilstrapCensus,
      suggest: async () => gilstrapSuggest,
      now: NOW,
    };
    const r = await resolveProperty({ rawText: '388 Gilstrap Rd, Cleveland, GA 30528' }, deps);
    expect(r.status).toBe('matched');
    expect(r.property.parcelVerified).toBe(false); // not legal-grade — Confirm Before Offer
    expect(r.property.county).toBe('White');
    expect(r.property.coordinates).toBeTruthy();
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
    expect(r.matchedReason).toMatch(/Confirm Before Offer/i);
  });

  it('preserves the operator house number when a suggestion returns only the road segment', async () => {
    // Photon-style highway segment (no house number). The resolved address must
    // keep the "2510" the operator typed — never a house-number-less label.
    const segmentSuggest = {
      query: '2510 State Highway 153', source: 'Photon', cached: false,
      suggestions: [{ label: 'State Highway 153, Winters, TX, 79467', line1: 'State Highway 153', city: 'Winters', state: 'TX', zip: '79467', county: 'Runnels', source: 'Photon', confidence: 0.6 }],
    };
    const deps: ResolutionDeps = {
      verify: async () => needsCounty(),
      deriveCounty: async () => ({ county: 'Runnels', state: 'TX', zip: '79567', fips: '48399', lat: 31.95, lng: -99.96 }),
      suggest: async () => segmentSuggest,
      now: NOW,
    };
    const r = await resolveProperty({ fields: { address: '2510 State Highway 153', city: 'Winters', state: 'TX', zip: '79567' } }, deps);
    expect(r.status).toBe('matched');
    expect(r.property.address).toBe('2510 State Highway 153');           // house number kept
    expect(r.property.normalizedAddress?.startsWith('2510 ')).toBe(true); // segment label got the number back
    expect(r.property.zip).toBe('79567');                                 // operator ZIP not overwritten
  });

  it('Needs Clarification when nothing credible resolves the property', async () => {
    const deps: ResolutionDeps = {
      verify: async () => noIdentity(),
      suggest: async () => ({ query: 'asdf', suggestions: [], source: 'none', cached: false }),
      now: NOW,
    };
    const r = await resolveProperty({ rawText: 'some vacant lot near the lake' }, deps);
    expect(r.status).toBe('needs_clarification');
    expect(r.guidance).toBeTruthy();
    expect(r.property.parcelVerified).toBe(false);
  });

  it('never stops because one provider failed (a throwing lane is recorded, others run)', async () => {
    const deps: ResolutionDeps = {
      verify: async () => { throw new Error('LandPortal down'); },
      deriveCounty: async () => gilstrapCensus,
      suggest: async () => gilstrapSuggest,
      now: NOW,
    };
    const r = await resolveProperty({ rawText: '388 Gilstrap Rd, Cleveland, GA 30528' }, deps);
    expect(r.lanesAttempted.some((l) => l.lane === 'realie_landportal' && l.status === 'error')).toBe(true);
    // Suggest still corroborated the property.
    expect(r.property.address).toContain('Gilstrap');
    expect(r.status).toBe('matched');
  });

  it('uses the LandOS cache when present and short-circuits to verified', async () => {
    const deps: ResolutionDeps = {
      cacheGet: () => ({
        address: '12 Oak Rd', city: 'Athens', state: 'GA', county: 'Clarke', apn: 'X1', parcelVerified: true,
        verificationSource: 'Realie.ai', evidence: [], sources: ['Realie.ai'], confidence: 0.95, missing: [],
      }),
      verify: async () => { throw new Error('should not be called'); },
      now: NOW,
    };
    const r = await resolveProperty({ fields: { address: '12 Oak Rd', state: 'GA' } }, deps);
    expect(r.status).toBe('matched');
    expect(r.property.parcelVerified).toBe(true);
    expect(r.lanesAttempted[0].lane).toBe('landos_cache');
  });

  it('Browser Intelligence: LandPortal-first feeds evidence, county fills only gaps (no duplicate)', async () => {
    const { makeLandPortalBrowser } = await import('./landportal-browser.js');
    const { makeCountyRecordsBrowser } = await import('./county-records-browser.js');
    // Fake LandPortal driver returns a full property; county driver is parked.
    const lpDriver = {
      id: 'lp', configured: () => true,
      open: async () => ({ url: 'https://www.landportal.com', fields: {}, snippets: [] }),
      search: async () => ({ url: 'https://www.landportal.com/property/x', fields: { 'Property Address': '388 Gilstrap Rd', APN: '042 123', Owner: 'TEST', County: 'White', State: 'GA', Acreage: '5 ac' }, snippets: [] }),
      readFields: async () => ({ url: 'https://www.landportal.com/property/x', fields: { 'Property Address': '388 Gilstrap Rd', APN: '042 123', Owner: 'TEST', County: 'White', State: 'GA', Acreage: '5 ac' }, snippets: [] }),
      screenshot: async (purpose: string) => ({ path: '/tmp/x.png', capturedAtIso: NOW(), purpose }),
    };
    const deps: ResolutionDeps = {
      verify: async () => needsCounty(),
      suggest: async () => gilstrapSuggest,
      deriveCounty: async () => gilstrapCensus,
      landPortalBrowser: makeLandPortalBrowser({ driver: lpDriver as any }),
      countyRecordsBrowser: makeCountyRecordsBrowser(), // parked
      now: NOW,
    };
    const r = await resolveProperty({ rawText: '388 Gilstrap Rd, Cleveland, GA 30528' }, deps);
    expect(r.browserEvidence.length).toBe(2); // LandPortal + County
    expect(r.browserEvidence[0].service).toBe('landportal');
    expect(r.browserEvidence[0].screenshots).toHaveLength(1); // one per property
    expect(r.missingFieldAnalysis).toBeTruthy();
    // APN came from LandPortal → not in the county gap list (no duplicate retrieval).
    expect(r.missingFieldAnalysis!.missing).not.toContain('apn');
    expect(r.lanesAttempted.some((l) => l.lane === 'landportal_readonly' && l.contributed)).toBe(true);
    expect(r.lanesAttempted.some((l) => l.lane === 'county_records' && l.status === 'parked')).toBe(true);
  });

  // ── The mandatory identity gate ─────────────────────────────────────────
  it('identity gate: a named-source verified parcel is established (downstream may run)', async () => {
    const deps: ResolutionDeps = { verify: async (f) => verified(f), now: NOW };
    const r = await resolveProperty({ fields: { address: '388 Gilstrap Rd', city: 'Cleveland', state: 'GA', county: 'White' } }, deps);
    expect(r.identityEstablished).toBe(true);
    expect(r.identityBasis).toMatch(/verified/i);
  });

  it('identity gate: a geocoded full street address (Photon + point) is a CANDIDATE, not confirmed', async () => {
    // A geocoder proves WHERE the address is, not WHICH parcel. It resolves to a
    // credible match (Candidate) but must NOT confirm the parcel — downstream is
    // on hold until a parcel-level source identifies the exact parcel.
    const deps: ResolutionDeps = {
      verify: async () => needsCounty(),
      deriveCounty: async () => gilstrapCensus,
      suggest: async () => gilstrapSuggest,
      now: NOW,
    };
    const r = await resolveProperty({ rawText: '388 Gilstrap Rd, Cleveland, GA 30528' }, deps);
    expect(r.status).toBe('matched'); // still a credible match (Candidate)
    expect(r.property.parcelVerified).toBe(false);
    expect(r.identityEstablished).toBe(false); // geocoded location is NOT parcel identity
    expect(r.identityBasis).toMatch(/geocoder proves where|not yet confirmed|not which parcel/i);
  });

  it('identity gate: Scott County road-name + echoed APN is NOT established (downstream on hold)', async () => {
    // The sprint failure mode: county + a bare road name + an APN the operator
    // pasted, which no external source confirmed. The geocoder returns nothing for a
    // house-number-less road, the browser is parked (no auth), so nothing corroborates
    // the parcel. It may look "matched" by echoed fields, but identity is NOT
    // established — downstream Property Intelligence must not run.
    const deps: ResolutionDeps = {
      verify: async () => needsCounty(),           // Realie/LandPortal cannot verify
      deriveCounty: async () => null,               // no geocode for a road name (no house number)
      suggest: async () => ({ query: 'Henson Lane', suggestions: [], source: 'none', cached: false }),
      now: NOW,
    };
    const r = await resolveProperty(
      { fields: { address: 'Henson Lane', county: 'Scott', state: 'TN', apn: '094-020.08', apnAlternates: ['094 02008 000'] } },
      deps,
    );
    expect(r.identityEstablished).toBe(false);
    expect(r.identityBasis).toMatch(/not yet confirmed|no external source/i);
  });

  it('identity gate: two independent PARCEL-LEVEL sources on the same parcel establish identity', () => {
    const p = emptyNormalizedProperty();
    p.apn = 'R-77'; p.county = 'White'; p.state = 'GA';
    // Two DIFFERENT parcel-level lanes agree on the SAME identity value (APN).
    p.evidence.push({ lane: 'homeharvest', field: 'apn', value: 'R-77', source: 'HomeHarvest', confidence: 0.6, timestamp: NOW() });
    p.evidence.push({ lane: 'county_gis', field: 'apn', value: 'R-77', source: 'White County GIS', confidence: 0.8, timestamp: NOW() });
    const g = parcelIdentityEstablished(p, []);
    expect(g.established).toBe(true);
    expect(g.basis).toMatch(/parcel-level sources resolving to the same parcel/i);
  });

  it('identity gate: a geocoder + a single parcel-level source is NOT confirmed (one hypothesis)', () => {
    const p = emptyNormalizedProperty();
    p.address = '10 Pine Rd'; p.county = 'White'; p.state = 'GA';
    // Photon (geocoder — location only) + ONE parcel-level source. Not >=2 parcel-level.
    p.evidence.push({ lane: 'address_suggest', field: 'address', value: '10 Pine Rd', source: 'Photon', confidence: 0.8, timestamp: NOW() });
    p.evidence.push({ lane: 'homeharvest', field: 'address', value: '10 Pine Rd', source: 'HomeHarvest', confidence: 0.6, timestamp: NOW() });
    const g = parcelIdentityEstablished(p, []);
    expect(g.established).toBe(false);
    expect(g.basis).toMatch(/single source is a strong hypothesis|not yet confirmed/i);
  });

  it('identity gate: two GEOCODERS agreeing on an address do NOT confirm the parcel', () => {
    const p = emptyNormalizedProperty();
    p.address = '10 Pine Rd'; p.county = 'White'; p.state = 'GA';
    p.evidence.push({ lane: 'address_suggest', field: 'address', value: '10 Pine Rd', source: 'Photon', confidence: 0.8, timestamp: NOW() });
    p.evidence.push({ lane: 'census_geocode', field: 'address', value: '10 Pine Rd', source: 'US Census', confidence: 0.7, timestamp: NOW() });
    const g = parcelIdentityEstablished(p, []);
    expect(g.established).toBe(false);
  });

  it('identity gate: Browser Agent reaching the County Records parcel page confirms identity', () => {
    const p = emptyNormalizedProperty();
    p.apn = '094-020.08'; p.county = 'Scott'; p.state = 'TN';
    const browserEvidence = [{
      service: 'county_records', mode: 'workflow', status: 'retrieved',
      patch: { apn: '094-020.08', county: 'Scott', state: 'TN' },
      sourceUrls: ['https://scott.tn.gov/gis/parcel/abc123'],
      sourcesUsed: [], facts: [], fields: {}, screenshots: [], note: '', blocked: [],
    }] as any;
    const g = parcelIdentityEstablished(p, browserEvidence);
    expect(g.established).toBe(true);
    expect(g.basis).toMatch(/County Records/i);
  });

  it('identity gate: a browser-confirmed LandPortal parcel (APN + jurisdiction + URL) is established', () => {
    const p = emptyNormalizedProperty();
    p.apn = '094-020.08'; p.county = 'Scott'; p.state = 'TN';
    const browserEvidence = [{
      service: 'landportal', mode: 'workflow', status: 'retrieved',
      patch: { apn: '094-020.08', county: 'Scott', state: 'TN' },
      sourceUrls: ['https://landportal.com/?property=abc123'],
      sourcesUsed: [], facts: [], fields: {}, screenshots: [], note: '', blocked: [],
    }] as any;
    const g = parcelIdentityEstablished(p, browserEvidence);
    expect(g.established).toBe(true);
    expect(g.basis).toMatch(/Browser Agent/i);
  });

  it('records parked browser lanes without contributing', async () => {
    const { defaultBrowserLanes } = await import('./browser-retrieval.js');
    const deps: ResolutionDeps = {
      verify: async () => needsCounty(),
      suggest: async () => ({ query: 'x', suggestions: [], source: 'none', cached: false }),
      browserLanes: defaultBrowserLanes(), // all parked
      now: NOW,
    };
    const r = await resolveProperty({ rawText: '1 Nowhere Rd, Cleveland, GA' }, deps);
    expect(r.lanesAttempted.some((l) => l.lane === 'netr' && l.status === 'parked')).toBe(true);
    expect(r.lanesAttempted.some((l) => l.lane === 'landportal_readonly' && !l.contributed)).toBe(true);
  });
});
