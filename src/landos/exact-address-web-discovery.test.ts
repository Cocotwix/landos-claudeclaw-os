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
  it('follows exact parcel, assessor, permit and credible property-detail results beyond listing portals', () => {
    expect(classifyDiscoveryResult('https://gis.examplecounty.gov/parcel/13-116-015-01'))
      .toMatchObject({ family: 'official_property', propertySpecific: true });
    expect(classifyDiscoveryResult('https://planning.example.gov/permits/2024-991'))
      .toMatchObject({ family: 'planning_permit', propertySpecific: true });
    expect(classifyDiscoveryResult('https://credible.example/property/9490-elk-lake-rd'))
      .toMatchObject({ family: 'other', propertySpecific: true });
    expect(classifyDiscoveryResult('https://gis.examplecounty.gov/parcel-search'))
      .toMatchObject({ family: 'official_property', propertySpecific: false });
  });
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
    expect(result).toMatchObject({ buildingSqft: null, acres: null, well: null, septic: null, priorAskingPrice: null, engagement: null });
    expect(result.legalAccessStatements).toEqual([]); expect(result.listingHistory).toEqual([]); expect(result.photoUrls).toEqual([]);
  });

  it('extracts a generic actively marketed improved subject and time-stamped Zillow interest signals', () => {
    const result = extractListingEvidence({
      url: 'https://www.zillow.com/homedetails/9490-Elk-Lake-Rd-Williamsburg-MI-49690/243126665_zpid/',
      retrievedAt: '2026-08-11T14:15:00.000Z',
      text: `Listing status: Active. Current price: $1,450,000. Original list price: $1,595,000.
        Listed on July 19, 2026. 23 days on Zillow. Single-family home on 60 acres.
        4 beds 3 baths, 2,750 sqft, built in 2001. Well and septic. Electric and propane.
        Property features: pole barn; detached garage; wooded trails.
        Public remarks: Improved rural estate with a home, barn, driveway and landscaped grounds.
        Listed by: North Woods Realty. MLS # 1923456. 8,421 views. 317 saves.
        https://photos.zillowstatic.com/fp/primary.jpg https://photos.zillowstatic.com/fp/second.webp`,
    });
    expect(result).toMatchObject({
      listingStatus: 'Active', currentPrice: 1_450_000, originalListPrice: 1_595_000,
      listingDate: 'July 19, 2026', daysOnMarket: 23, propertyType: 'Single-family home',
      buildingSqft: 2750, acres: 60, beds: 4, baths: 3, yearBuilt: 2001,
      engagement: {
        views: 8421, saves: 317, viewsAvailability: 'available', savesAvailability: 'available',
        retrievedAt: '2026-08-11T14:15:00.000Z',
      },
    });
    expect(result.photoUrls).toHaveLength(2);
    expect(result.features).toEqual(expect.arrayContaining(['pole barn', 'detached garage', 'wooded trails.']));
    expect(result.brokerage).toContain('North Woods Realty');
    expect(result.mls).toBe('1923456');
  });

  it('records Zillow engagement as unavailable rather than zero when the page exposes no counts', () => {
    const result = extractListingEvidence({
      url: 'https://www.zillow.com/homedetails/a/1_zpid/',
      text: 'For sale listing. House on 10 acres.',
      retrievedAt: '2026-08-11T15:00:00.000Z',
    });
    expect(result.engagement).toEqual({
      provider: 'zillow', views: null, saves: null,
      viewsAvailability: 'unavailable', savesAvailability: 'unavailable',
      retrievedAt: '2026-08-11T15:00:00.000Z',
    });
    expect(result.engagement?.views).not.toBe(0);
    expect(result.engagement?.saves).not.toBe(0);
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
    listingStatus: 'Active',
    currentPrice: 1_450_000,
    priorAskingPrice: 1_450_000,
    originalListPrice: 1_595_000,
    listingDate: '2026-07-19',
    daysOnMarket: 23,
    beds: 4,
    baths: 3,
    yearBuilt: 2001,
    structures: ['House and pole barn.'],
    description: 'Improved rural estate.',
    features: ['wooded trails'],
    brokerage: 'North Woods Realty',
    mls: '1923456',
    listingHistory: [{ date: '2026-07-19', event: 'Listed for sale', price: 1_595_000 }],
    photoUrls: ['https://photos.example/primary.jpg', 'https://photos.example/second.jpg'],
    engagement: null,
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
    expect(view.sources[0].listingStatus).toBe('Active');
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

  it('projects one concise active-listing card with photos, listing facts and raw Zillow engagement', () => {
    const view = projectExactAddressListingEvidence({
      status: 'retrieved',
      pages: [
        page(),
        page({
          sourceUrl: 'https://www.zillow.com/homedetails/9490-Elk-Lake-Rd-Williamsburg-MI-49690/243126665_zpid/',
          sourceLabel: 'Zillow',
          engagement: {
            provider: 'zillow', views: 8421, saves: 317,
            viewsAvailability: 'available', savesAvailability: 'available',
            retrievedAt: '2026-08-10T22:46:00.000Z',
          },
        }),
      ],
    })!;
    expect(view.listingCard).toMatchObject({
      active: true,
      currentPrice: 1_450_000,
      originalListPrice: 1_595_000,
      daysOnMarket: 23,
      listingUrl: expect.stringContaining('zillow.com/homedetails'),
      primaryPhotoUrl: 'https://photos.example/primary.jpg',
      additionalPhotoUrls: ['https://photos.example/second.jpg'],
      zillowEngagement: { views: 8421, saves: 317, retrievedAt: '2026-08-10T22:46:00.000Z' },
      evidenceLabel: 'Listing-reported',
    });
    expect(view.listingCard?.engagementNote).toMatch(/interest signal, not proof of value/i);
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
