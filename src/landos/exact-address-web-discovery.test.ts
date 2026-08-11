import { describe, expect, it } from 'vitest';
import { buildExactAddressQueries, classifyDiscoveryResult, EXACT_ADDRESS_LANE_ID, extractListingEvidence, listingAccessEvidenceItems, projectExactAddressListingEvidence, listingWordingExcerpt, type ExtractedListingEvidence } from './exact-address-web-discovery.js';

describe('exact address queries', () => {
  it('uses the stable lane id', () => expect(EXACT_ADDRESS_LANE_ID).toBe('exact_address_web'));
  it('builds distinct plain-English queries', () => {
    const queries = buildExactAddressQueries({ address: '9490 Elk Lake Rd', city: 'Williamsburg', state: 'MI', zip: '49690', apn: '13-116-015-01' });
    expect(queries[0]).toBe('9490 Elk Lake Rd, Williamsburg, MI 49690');
    expect(new Set(queries).size).toBeGreaterThanOrEqual(4);
    expect(queries.join(' ')).not.toMatch(/site:|inurl:|filetype:/i);
    expect(queries.join(' ')).toMatch(/for sale listing.*listing history.*access easement/i);
  });
});

describe('result classification', () => {
  it('classifies property-specific Zillow pages', () => expect(classifyDiscoveryResult('https://www.zillow.com/homedetails/9490-Elk-Lake-Rd/123_zpid/')).toMatchObject({ family: 'zillow', propertySpecific: true }));
  it('does not call a Zillow region page property-specific', () => expect(classifyDiscoveryResult('https://www.zillow.com/williamsburg-mi/')).toMatchObject({ family: 'zillow', propertySpecific: false }));
  it('classifies Redfin home ids', () => expect(classifyDiscoveryResult('https://www.redfin.com/MI/Williamsburg/X/home/12345')).toMatchObject({ family: 'redfin', propertySpecific: true }));
  it('classifies Realtor detail pages', () => expect(classifyDiscoveryResult('https://www.realtor.com/realestateandhomes-detail/9490-Elk-Lake-Rd')).toMatchObject({ family: 'realtor', propertySpecific: true }));
  it('classifies land listing and auction details', () => {
    expect(classifyDiscoveryResult('https://www.landwatch.com/property/60-acres').family).toBe('land_listing');
    expect(classifyDiscoveryResult('https://www.land.com/property/60-acres/123').propertySpecific).toBe(true);
    expect(classifyDiscoveryResult('https://www.auction.com/details/123')).toMatchObject({ family: 'auction', propertySpecific: true });
    expect(classifyDiscoveryResult('https://www.auction.com/auction-details/123')).toMatchObject({ family: 'auction', propertySpecific: true });
  });
  it('reads a LandWatch region path ending in its own listing id as property-specific', () => {
    expect(classifyDiscoveryResult('https://www.landwatch.com/grand-traverse-county-michigan-land-for-sale/pid/456'))
      .toMatchObject({ family: 'land_listing', propertySpecific: true });
    expect(classifyDiscoveryResult('https://www.landwatch.com/grand-traverse-county-michigan-land-for-sale'))
      .toMatchObject({ family: 'land_listing', propertySpecific: false });
  });
  it('handles malformed URLs without throwing', () => expect(classifyDiscoveryResult('not a url')).toEqual({ host: null, family: 'other', propertySpecific: false }));
});

describe('listing extraction', () => {
  const page = `Vacant land, 60 acres. A recorded easement provides legal access to the parcel. A gravel driveway extends from Elk Lake Road. Existing 1,850 sqft barn. Electric and propane available. Well and septic on site. Listed for $495,000. Price cut to $469,000 on 03/14/2024. Sold 06/02/2024 for $455,000. Photo https://photos.zillowstatic.com/fp/example.jpg`;
  it('extracts stated property facts and never upgrades access', () => {
    const result = extractListingEvidence({ url: 'https://www.zillow.com/homedetails/x/1_zpid/', text: page, retrievedAt: '2024-06-03T00:00:00Z' });
    expect(result).toMatchObject({ buildingSqft: 1850, acres: 60, well: true, septic: true, priorAskingPrice: 495000 });
    expect(result.legalAccessStatements).toHaveLength(1); expect(result.drivewayStatements).toHaveLength(1);
    expect(result.listingHistory).toHaveLength(3); expect(result.photoUrls).toHaveLength(1);
    expect(listingAccessEvidenceItems(result)[0]).toMatchObject({ tier: 'reported_legal', sourceKind: 'listing', basis: 'source_stated', weight: 'likely' });
  });
  it('leaves absent facts null or empty', () => {
    const result = extractListingEvidence({ url: 'bad', text: '' });
    expect(result).toMatchObject({ buildingSqft: null, acres: null, well: null, septic: null, priorAskingPrice: null });
    expect(result.legalAccessStatements).toEqual([]); expect(result.listingHistory).toEqual([]); expect(result.photoUrls).toEqual([]);
  });
});

describe('operator projection of retained listing evidence', () => {
  const page = (over: Partial<ExtractedListingEvidence> = {}): ExtractedListingEvidence => ({
    sourceUrl: 'https://www.redfin.com/MI/Williamsburg/9490-Elk-Lake-Rd-49690/home/143868919',
    sourceLabel: 'redfin.com',
    retrievedAt: '2026-08-10T22:46:00.000Z',
    legalAccessStatements: [],
    drivewayStatements: [],
    propertyType: 'house',
    buildingSqft: 2000,
    acres: 60,
    utilities: ['electric'],
    well: true,
    septic: true,
    remarks: [],
    priorAskingPrice: 1_450_000,
    listingHistory: [{ date: '2026-07-19', event: 'Listed for sale', price: 1_595_000 }],
    photoUrls: [],
    ...over,
  });

  it('projects each provider with its retained facts and provenance', () => {
    const view = projectExactAddressListingEvidence({
      status: 'retrieved',
      note: '3 property-specific result page(s) were read.',
      queries: ['9490 Elk Lake Rd, Williamsburg, MI 49690'],
      pages: [
        page(),
        page({ sourceUrl: 'https://www.zillow.com/homedetails/9490-Elk-Lake-Rd-Williamsburg-MI-49690/243126665_zpid/', sourceLabel: 'zillow.com', propertyType: null, buildingSqft: null }),
      ],
    })!;
    expect(view.status).toBe('retrieved');
    expect(view.sources).toHaveLength(2);
    expect(view.sources.map((s) => s.sourceLabel)).toEqual(['redfin.com', 'zillow.com']);
    expect(view.sources[0].family).toBe('redfin');
    expect(view.sources[1].family).toBe('zillow');
    expect(view.sources[0].buildingSqft).toBe(2000);
    expect(view.sources[0].acres).toBe(60);
    expect(view.sources[0].price).toBe(1_450_000);
    expect(view.sources[0].listingStatus).toBe('Listed for sale');
    expect(view.sources[0].provenanceNote).toContain('redfin.com');
    expect(view.disclaimer).toMatch(/never becomes a verified/i);
  });

  it('states the absence of legal-access wording rather than implying access', () => {
    const view = projectExactAddressListingEvidence({ status: 'retrieved', pages: [page()] })!;
    expect(view.sources[0].accessStatements).toEqual([]);
    expect(view.sources[0].accessLanguageNote).toMatch(/no legal-access or easement wording/i);
  });

  it('retains easement wording verbatim without calling it recorded', () => {
    const view = projectExactAddressListingEvidence({
      status: 'retrieved',
      pages: [page({
        legalAccessStatements: [{
          text: 'Deeded easement access from the county road.',
          tier: 'reported_legal',
          sourceUrl: 'https://example.com/listing',
          sourceLabel: 'example.com',
        }],
      })],
    })!;
    expect(view.sources[0].accessStatements).toEqual(['Deeded easement access from the county road.']);
    expect(view.sources[0].accessLanguageNote).toMatch(/not a recorded instrument/i);
  });

  it('reads an improved subject from the retained listing facts', () => {
    const view = projectExactAddressListingEvidence({ status: 'retrieved', pages: [page()] })!;
    expect(view.subjectRead?.improved).toBe(true);
    expect(view.subjectRead?.buildingSqft).toBe(2000);
    expect(view.subjectRead?.acres).toBe(60);
    expect(view.subjectRead?.statement).toMatch(/improved property/i);
    expect(view.subjectRead?.statement).toMatch(/not an assessor record/i);
  });

  it('does not claim improvements from a vacant-land listing', () => {
    const view = projectExactAddressListingEvidence({
      status: 'retrieved',
      pages: [page({ propertyType: 'vacant land', buildingSqft: null })],
    })!;
    expect(view.subjectRead?.improved).toBe(false);
    expect(view.subjectRead?.statement).not.toMatch(/improved property/i);
  });

  it('returns a null-safe view with no retained pages and no result', () => {
    expect(projectExactAddressListingEvidence(null)).toBeNull();
    const empty = projectExactAddressListingEvidence({ status: 'none', note: 'nothing retained', pages: [] })!;
    expect(empty.sources).toEqual([]);
    expect(empty.subjectRead).toBeNull();
    expect(empty.note).toBe('nothing retained');
  });
});

describe('listing wording excerpts stay readable and honest', () => {
  it('returns a short statement verbatim', () => {
    const text = 'Deeded easement access from the county road.';
    expect(listingWordingExcerpt(text, /easement/i)).toBe(text);
  });

  it('windows a page-sized blob around the matched term and marks it as an excerpt', () => {
    const blob = `${'filler '.repeat(200)}shared driveway maintained by the association ${'more '.repeat(200)}`;
    const out = listingWordingExcerpt(blob, /driveway/i);
    expect(out.length).toBeLessThanOrEqual(322);
    expect(out).toContain('driveway');
    expect(out.startsWith('…')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
  });

  it('truncates from the start when the term is not found', () => {
    const out = listingWordingExcerpt('x'.repeat(1000), /nowhere/i);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(321);
  });
});
