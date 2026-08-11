import { describe, expect, it } from 'vitest';
import {
  buildExactAddressQueries,
  classifyDiscoveryResult,
  EXACT_ADDRESS_LANE_ID,
  extractListingEvidence,
  listingAccessEvidenceItems,
  listingRecordIdentityKey,
  listingWordingExcerpt,
  mergeRetainedListingRecords,
  normalizeListingStatus,
  projectExactAddressListingEvidence,
  type ExtractedListingEvidence,
} from './exact-address-web-discovery.js';

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
      provider: 'zillow',
      sourceLabel: 'zillow.com',
      sourceUrl: 'https://www.zillow.com/homedetails/a/1_zpid/',
      views: null, saves: null,
      viewsAvailability: 'unavailable', savesAvailability: 'unavailable',
      listingAgeDays: null, listingAgeAvailability: 'unavailable',
      photoCount: null, photoCountAvailability: 'unavailable',
      priceChangeCount: null, priceChangeAvailability: 'unavailable',
      retrievedAt: '2026-08-11T15:00:00.000Z',
    });
    expect(result.engagement?.views).not.toBe(0);
    expect(result.engagement?.saves).not.toBe(0);
    expect(result.engagement?.photoCount).not.toBe(0);
    expect(result.engagement?.priceChangeCount).not.toBe(0);
  });

  it('retains another provider\'s engagement in its own terms instead of the Zillow shape', () => {
    const result = extractListingEvidence({
      url: 'https://www.realtor.com/realestateandhomes-detail/9490-Elk-Lake-Rd_Williamsburg_MI_49690',
      retrievedAt: '2026-08-11T16:00:00.000Z',
      text: `Status: Active. 1,204 views. 41 days on market. Price cut to $1,450,000 on 08/01/2026.
        https://ap.rdcpix.com/one.jpg https://ap.rdcpix.com/two.jpg`,
    });
    expect(result.engagement).toMatchObject({
      provider: 'realtor',
      sourceUrl: expect.stringContaining('realtor.com'),
      views: 1204, viewsAvailability: 'available',
      saves: null, savesAvailability: 'unavailable',
      listingAgeDays: 41, listingAgeAvailability: 'available',
      photoCount: 2, photoCountAvailability: 'available',
      priceChangeCount: 1, priceChangeAvailability: 'available',
    });
    expect(result.engagement?.saves).not.toBe(0);
  });

  it('records no engagement at all for a provider that published none', () => {
    const result = extractListingEvidence({
      url: 'https://www.landwatch.com/property/60-acres',
      text: 'Rural acreage offered for sale.',
      retrievedAt: '2026-08-11T16:00:00.000Z',
    });
    expect(result.engagement).toBeNull();
  });
});

describe('page chrome never becomes a listing field', () => {
  const zillowUrl = 'https://www.zillow.com/homedetails/9490-Elk-Lake-Rd-Williamsburg-MI-49690/243126665_zpid/';
  const read = (text: string, url = zillowUrl) => extractListingEvidence({ url, text, retrievedAt: '2026-08-11T19:00:00.000Z' });

  // R1 — the exact live junk the operator saw on the Overview.
  const FOOTER_JUNK = 'Broker services , Consumer protection notice California DRE #01937601 '
    + 'Contact Homes.com Brokerage About Us Advertise Terms of Use Builder Terms of Use Privacy Notice E';

  it('rejects a site footer captured behind the brokerage label', () => {
    const result = read(`For sale. $1,450,000. 3 beds. ${FOOTER_JUNK}`);
    expect(result.brokerage).toBeNull();
    expect(result.listingAgent).toBeNull();
  });

  it('still keeps a real office name and stops it at the name clause', () => {
    const result = read('For sale. $1,450,000. Listed by: North Woods Realty. MLS # 1923456. 3 beds');
    expect(result.brokerage).toBe('North Woods Realty');
  });

  it('rejects an overlong or boilerplate candidate rather than printing it', () => {
    expect(read('For sale. Listing agent: Terms Of Use. 3 beds').listingAgent).toBeNull();
    expect(read('For sale. Listing agent: Dana Whitfield. 3 beds').listingAgent).toBe('Dana Whitfield');
    const overlong = 'Northern Great Lakes Premier Land And Waterfront Property Group Of Michigan Incorporated';
    expect(read(`For sale. Listed by: ${overlong}. 3 beds`).brokerage).toBeNull();
  });

  it('rejects lowercase site prose that carries no known footer term', () => {
    // Every marketplace invents its own boilerplate, so rejecting a fixed list
    // of footer phrases is not enough: a candidate must also read like a name.
    expect(read('For sale. Listed by: licenses in all 50 states and D.C. 3 beds').brokerage).toBeNull();
    expect(read('For sale. Listed by: data deemed reliable but not guaranteed. 3 beds').brokerage).toBeNull();
  });

  it('keeps a real brand name that opens with a symbol or a lowercase letter', () => {
    expect(read('For sale. Listed by: @properties REMI Christie Real Estate. 3 beds').brokerage)
      .toBe('@properties REMI Christie Real Estate');
    expect(read('For sale. Listed by: eXp Realty. 3 beds').brokerage).toBe('eXp Realty');
  });

  it('never reads a bare agent control label as the listing agent', () => {
    // "Agent" alone is page furniture on most marketplaces; only wording that
    // actually introduces the person may carry a name.
    expect(read('For sale. Agent Appointments Open Find An Agent. 3 beds').listingAgent).toBeNull();
    expect(read('For sale. Contact agent Request A Tour. 3 beds').listingAgent).toBeNull();
    // "Listed by" introduces the office, so it must never seed the agent field
    // with whatever navigation follows it.
    expect(read('For sale. Listed by What Is My Home Worth. 3 beds').listingAgent).toBeNull();
    expect(read('For sale. Listing courtesy of Kathy Wittbrodt. 3 beds').listingAgent).toBe('Kathy Wittbrodt');
  });

  it('prefers a real MLS number over a marketplace-internal id on the card', () => {
    const view = projectExactAddressListingEvidence({
      status: 'retrieved',
      pages: [
        read('MLS #: T062626. For sale. 9490 Elk Lake Rd. $1,450,000. 3 beds',
          'https://www.homes.com/property/9490-elk-lake-rd-williamsburg-mi/xhtr6r3gv88zs/'),
        read('MLS # 80071245. For sale. 9490 Elk Lake Rd. $1,450,000. 3 beds',
          'https://www.redfin.com/MI/Williamsburg/9490-Elk-Lake-Rd-49690/home/143868919'),
      ],
    })!;
    expect(view.listingCard?.mls).toBe('80071245');
    // The marketplace's internal id stays on its own record as evidence, but it
    // is never listed to the operator as an MLS number.
    expect(view.listingCard?.mlsNumbers).toEqual(['80071245']);
    expect(view.sources.map((source) => source.mls)).toContain('T062626');
  });

  it('states a price cut by its amount, never as the new asking price', () => {
    const cut = read('For sale. 9490 Elk Lake Rd. $1,450,000. Price cut: $145K (8/3). 3 beds');
    const event = cut.listingHistory.find((entry) => entry.event === 'Price cut');
    expect(event?.price).toBe(145000);
    expect(event?.isReductionAmount).toBe(true);
    const reducedTo = read('For sale. 9490 Elk Lake Rd. Price reduced to $1,450,000 on 8/3/2026. 3 beds');
    expect(reducedTo.listingHistory.find((entry) => entry.event === 'Price cut')?.isReductionAmount).toBe(false);
  });

  it('keeps Structures a clause, never a copy of the whole page', () => {
    // An unpunctuated marketplace page makes the "sentence" containing the word
    // "home" the entire document, which put the whole site in the operator's
    // Structures field.
    const page = 'Search Open app Feed Favorites Saved searches My homes Sell my home List my home for rent '
      + 'Redfin Premier Buy Popular Searches Homes for sale Condos for sale Mortgage rates Get prequalified '
      + 'Payment calculator Exterior features Porch Greenhouse Shed Cleared rolling hilly and wooded terrain '
      + 'Home design Residential property 1 1/2-story structure Built in 1984 Nearby open houses Schools';
    const result = read(`For sale. $1,450,000. 3 beds. ${page}`);
    for (const structure of result.structures) {
      expect(structure.split(/\s+/).length).toBeLessThanOrEqual(30);
      expect(structure).not.toMatch(/saved searches|payment calculator|get prequalified/i);
    }
  });

  it('never quotes site navigation as apparent-physical access wording', () => {
    const nav = 'Search Condo Building Search New Homes/New Construction Favorites Notes Saved Searches '
      + 'Suggestions Agent and Co-Shopper Advertise $1,450,000 Add a Note Driving Directions Create '
      + 'Valuation Report Claim this Home Copy Link $145K PRICE DROP 9490 Elk Lake Rd Williamsburg MI';
    const result = read(`For sale. $1,450,000. 3 beds. ${nav}`);
    expect(result.directionsStatements).toEqual([]);
    expect(result.drivewayStatements).toEqual([]);
  });

  it('keeps real driveway and directions wording as a readable clause', () => {
    const result = read('For sale. $1,450,000. 3 beds. Directions: From Elk Lake Rd head east on the '
      + 'dirt drive to the home. A gravel drive runs from the road to the house past the greenhouses.');
    expect(result.directionsStatements.join(' ')).toMatch(/head east on the dirt drive/i);
    expect(result.drivewayStatements.join(' ')).toMatch(/gravel drive runs from the road/i);
    for (const statement of [...result.directionsStatements, ...result.drivewayStatements]) {
      expect(statement.split(/\s+/).length).toBeLessThanOrEqual(30);
    }
  });

  it('does not let one record\'s lot size become the subject acreage', () => {
    const view = projectExactAddressListingEvidence({
      status: 'retrieved',
      pages: [
        read('For sale. 9490 Elk Lake Rd. $1,450,000. 3 beds. 40 acres',
          'https://www.trulia.com/home/9490-elk-lake-rd-williamsburg-mi-49690-77785656'),
        read('For sale. 9490 Elk Lake Rd. $1,450,000. 3 beds. 60 acres',
          'https://www.redfin.com/MI/Williamsburg/9490-Elk-Lake-Rd-49690/home/143868919'),
        read('For sale. 9490 Elk Lake Rd. $1,450,000. 3 beds. 60 acres',
          'https://www.homes.com/property/9490-elk-lake-rd-williamsburg-mi/xhtr6r3gv88zs/'),
      ],
    })!;
    expect(view.listingCard?.acres).toBe(60);
  });

  it('reads a legacy retained cut row below the ask as the amount it came down', () => {
    // Records retained before the flag existed carry no indication of which
    // figure the row holds; a cut below the current ask is the discount.
    const page = read('For sale. 9490 Elk Lake Rd. $1,450,000. 3 beds. 60 acres');
    page.listingHistory = [{ date: '8/3', event: 'Price cut', price: 145_000 }];
    const view = projectExactAddressListingEvidence({ status: 'retrieved', pages: [page] })!;
    expect(view.listingCard?.priceChanges[0]?.isReductionAmount).toBe(true);
  });

  it('does not let one record\'s rent figure become the subject asking price', () => {
    // Trulia and other MLS mirrors publish a rent or payment estimate beside
    // the listing, so the corroborated asking price must win over the card
    // source's own outlier.
    const view = projectExactAddressListingEvidence({
      status: 'retrieved',
      pages: [
        read('For sale. 9490 Elk Lake Rd. $1,500. 3 beds. 60 acres',
          'https://www.trulia.com/home/9490-elk-lake-rd-williamsburg-mi-49690-77785656'),
        read('For sale. 9490 Elk Lake Rd. $1,450,000. 3 beds. 60 acres',
          'https://www.redfin.com/MI/Williamsburg/9490-Elk-Lake-Rd-49690/home/143868919'),
        read('For sale. 9490 Elk Lake Rd. $1,450,000. 3 beds. 60 acres',
          'https://www.homes.com/property/9490-elk-lake-rd-williamsburg-mi/xhtr6r3gv88zs/'),
      ],
    })!;
    expect(view.listingCard?.currentPrice).toBe(1450000);
  });

  it('takes the clean brokerage from another record of the same subject', () => {
    const view = projectExactAddressListingEvidence({
      status: 'retrieved',
      pages: [
        read(`For sale. 9490 Elk Lake Rd. $1,450,000. 3 beds. ${FOOTER_JUNK}`,
          'https://www.homes.com/property/9490-elk-lake-rd-williamsburg-mi/xhtr6r3gv88zs/'),
        read('For sale. 9490 Elk Lake Rd. $1,450,000. 3 beds. Listed by: Kathy Wittbrodt.',
          'https://www.redfin.com/MI/Williamsburg/9490-Elk-Lake-Rd-49690/home/143868919'),
      ],
    })!;
    expect(view.listingCard?.brokerage).toBe('Kathy Wittbrodt');
  });

  it('rejects an English word beside the MLS label and keeps the real id', () => {
    const result = read('Source: Data · 80071245 · 1948192. MLS #: 80071245. For sale. 3 beds');
    expect(result.mls).toBe('80071245');
    expect(read('Listing source: Data. For sale. 3 beds').mls).toBeNull();
    expect(read('MLS number: Number. For sale. 3 beds').mls).toBeNull();
  });

  it('retains both MLS ids the one physical subject is published under', () => {
    const view = projectExactAddressListingEvidence({
      status: 'retrieved',
      pages: [
        read('Source: Data. MLS #: 80071245. For sale. 9490 Elk Lake Rd. $1,450,000. 3 beds',
          'https://www.realtor.com/realestateandhomes-detail/9490-Elk-Lake-Rd_Williamsburg_MI_49690'),
        read('MLS # 1948192. For sale. 9490 Elk Lake Rd. $1,450,000. 3 beds'),
      ],
    })!;
    expect(view.reconciliation?.canonical.mlsNumbers).toEqual(['80071245', '1948192']);
    expect(view.listingCard?.mlsNumbers).toEqual(['80071245', '1948192']);
  });

  it('never reads an acreage parcel as a condo because the page prints the word', () => {
    const result = read('For sale. Condo · 2,000 sqft · 3 beds · 2 baths · built 1984 · 60 acres');
    expect(result.propertyType).toBeNull();
    expect(result.acres).toBe(60);
    expect(result.beds).toBe(3);
  });

  it('prefers the type the page labels for the subject over an earlier stray match', () => {
    const result = read('Condo listings nearby. Property type: Single-family home. For sale. 3 beds');
    expect(result.propertyType).toBe('Single-family home');
  });

  it('takes the improvement type the retained records corroborate, not one stray match', () => {
    const base = {
      sourceUrl: 'https://www.redfin.com/MI/Williamsburg/9490-Elk-Lake-Rd-49690/home/1',
      sourceLabel: 'redfin.com', retrievedAt: '2026-08-10T12:00:00.000Z',
      legalAccessStatements: [], drivewayStatements: [], directionsStatements: [],
      streetAddress: '9490 Elk Lake Rd', apn: null, propertyType: 'single-family home',
      buildingSqft: 2000, acres: null, utilities: [], well: null, septic: null, remarks: [],
      listingStatus: 'Active', listingStatusCode: 'active' as const,
      currentPrice: 1_450_000, priorAskingPrice: null, originalListPrice: null,
      listingDate: null, daysOnMarket: 24, beds: 3, baths: 2, yearBuilt: 1984,
      structures: [], description: null, features: [], brokerage: null, listingAgent: null,
      mls: null, listingHistory: [], photoUrls: [], engagement: null,
    };
    const view = projectExactAddressListingEvidence({
      status: 'retrieved',
      pages: [
        { ...base, sourceUrl: 'https://www.zillow.com/homedetails/x/1_zpid/', sourceLabel: 'zillow.com', propertyType: 'condo' },
        { ...base },
        {
          ...base,
          sourceUrl: 'https://www.realtor.com/realestateandhomes-detail/9490-Elk-Lake-Rd_Williamsburg_MI_49690',
          sourceLabel: 'realtor.com',
        },
      ],
    })!;
    expect(view.listingCard?.improvementFacts.propertyType).toBe('single-family home');
  });
});

describe('the live page shape the operator reported', () => {
  // Every field the Overview showed wrong at once, on one page carrying the
  // same chrome, the same stray counter and the same published reduction.
  const zillowPage = extractListingEvidence({
    url: 'https://www.zillow.com/homedetails/9490-Elk-Lake-Rd-Williamsburg-MI-49690/243126665_zpid/',
    retrievedAt: '2026-08-11T19:00:00.000Z',
    text: `Homes you may like: Condo 134 views 11 saves. ${'nearby listing filler. '.repeat(40)}
      For sale. 9490 Elk Lake Rd. $1,450,000. Price cut: $145K (8/3).
      Single-family home, 3 beds, 2 baths, 2,000 sqft, built 1984, 60 acres.
      24 days on Zillow. 1,070 views. 84 saves.
      Broker services , Consumer protection notice California DRE #01937601 Contact Homes.com Brokerage About Us Advertise Terms of Use Builder Terms of Use Privacy Notice E
      Source: Data. MLS #: 80071245.`,
  });
  const homesPage = extractListingEvidence({
    url: 'https://www.homes.com/property/9490-elk-lake-rd-williamsburg-mi/123/',
    retrievedAt: '2026-08-11T19:00:00.000Z',
    text: `For sale. 9490 Elk Lake Rd. $1,450,000. 24 days on market. 1,680 views.
      Single-family home on 60 acres. MLS # 1948192. Listed by: North Woods Realty.`,
  });

  it('reads each field as itself and leaves the footer out of the record', () => {
    expect(zillowPage).toMatchObject({
      brokerage: null,
      mls: '80071245',
      propertyType: 'Single-family home',
      originalListPrice: 1_595_000,
      originalListPriceBasis: 'derived',
    });
    expect(zillowPage.engagement).toMatchObject({ views: 1070, saves: 84, listingAgeDays: 24 });
  });

  it('renders one row per provider and carries the derived original onto the card', () => {
    const view = projectExactAddressListingEvidence({ status: 'retrieved', pages: [zillowPage, homesPage] })!;
    expect(view.listingCard).toMatchObject({
      currentPrice: 1_450_000,
      originalListPrice: 1_595_000,
      originalListPriceBasis: 'derived',
      brokerage: 'North Woods Realty',
      mlsNumbers: ['80071245', '1948192'],
    });
    expect(view.listingCard?.improvementFacts.propertyType).toBe('Single-family home');
    expect(view.listingCard?.engagementByProvider.map((signal) => [signal.sourceLabel, signal.views, signal.saves]))
      .toEqual([['zillow.com', 1070, 84], ['homes.com', 1680, null]]);
  });
});

describe('engagement counts come from the listing\'s own counter', () => {
  const zillowUrl = 'https://www.zillow.com/homedetails/9490-Elk-Lake-Rd-Williamsburg-MI-49690/243126665_zpid/';
  const read = (text: string) => extractListingEvidence({ url: zillowUrl, text, retrievedAt: '2026-08-11T19:00:00.000Z' });

  // R3 — a counter from elsewhere on the page is how 1,070/84 became 134/11.
  it('takes the counts beside the listing age, never an earlier counter on the page', () => {
    const result = read(`Homes you may like: 134 views 11 saves. ${'Nearby listing filler. '.repeat(40)}
      Listing status: Active. 24 days on Zillow. 1,070 views. 84 saves.`);
    expect(result.engagement).toMatchObject({
      views: 1070, saves: 84, listingAgeDays: 24,
      viewsAvailability: 'available', savesAvailability: 'available',
    });
  });

  it('reports the count unavailable when the page states no listing age to anchor it', () => {
    const result = read('Listing status: Active. Trending in this area: 134 views 11 saves. 3 beds');
    expect(result.engagement).toMatchObject({
      views: null, saves: null,
      viewsAvailability: 'unavailable', savesAvailability: 'unavailable',
      listingAgeDays: null, listingAgeAvailability: 'unavailable',
    });
    expect(result.engagement?.views).not.toBe(0);
  });

  it('ignores a counter far from the listing age rather than reporting it', () => {
    const result = read(`Recently viewed: 134 views. ${'Unrelated page furniture. '.repeat(60)}
      Listing status: Active. 24 days on Zillow.`);
    expect(result.engagement?.views).toBeNull();
    expect(result.engagement?.listingAgeDays).toBe(24);
  });

  it('renders one views and one saves tile per provider host', () => {
    const signal = (sourceUrl: string, sourceLabel: string, views: number, saves: number) => ({
      provider: 'zillow' as const, sourceLabel, sourceUrl,
      views, saves,
      viewsAvailability: 'available' as const, savesAvailability: 'available' as const,
      listingAgeDays: 24, listingAgeAvailability: 'available' as const,
      photoCount: null, photoCountAvailability: 'unavailable' as const,
      priceChangeCount: null, priceChangeAvailability: 'unavailable' as const,
      retrievedAt: '2026-08-11T12:00:00.000Z',
    });
    const base = {
      sourceLabel: 'Zillow', retrievedAt: '2026-08-11T12:00:00.000Z',
      legalAccessStatements: [], drivewayStatements: [], directionsStatements: [],
      streetAddress: '9490 Elk Lake Rd', apn: null, propertyType: null,
      buildingSqft: null, acres: 60, utilities: [], well: null, septic: null, remarks: [],
      listingStatus: 'Active', listingStatusCode: 'active' as const,
      currentPrice: 1_450_000, priorAskingPrice: null, originalListPrice: null,
      listingDate: null, daysOnMarket: 24, beds: null, baths: null, yearBuilt: null,
      structures: [], description: null, features: [], brokerage: null, listingAgent: null,
      mls: null, listingHistory: [], photoUrls: [], engagement: null,
    };
    const view = projectExactAddressListingEvidence({
      status: 'retrieved',
      pages: [
        { ...base, sourceUrl: `${zillowUrl}`, engagement: signal(zillowUrl, 'Zillow', 1070, 84) },
        {
          ...base,
          sourceUrl: `${zillowUrl}?view=public`,
          sourceLabel: 'zillow.com',
          engagement: signal(`${zillowUrl}?view=public`, 'zillow.com', 1070, 84),
        },
      ],
    })!;
    expect(view.listingCard?.engagementByProvider).toHaveLength(1);
    expect(view.listingCard?.engagementByProvider[0]).toMatchObject({ views: 1070, saves: 84 });
  });
});

describe('published asking price', () => {
  const zillowUrl = 'https://www.zillow.com/homedetails/9490-Elk-Lake-Rd-Williamsburg-MI-49690/243126665_zpid/';
  const read = (text: string, url = zillowUrl) => extractListingEvidence({ url, text, retrievedAt: '2026-08-11T19:00:00.000Z' });

  it('reads the bare headline amount of an on-market page as the asking price', () => {
    const result = read('For sale. Price cut: $145K (8/3). $1,450,000. 3 beds 2 baths 2,000 sqft');
    expect(result).toMatchObject({
      listingStatusCode: 'active',
      currentPrice: 1_450_000,
      originalListPrice: 1_595_000,
      originalListPriceBasis: 'derived',
    });
    expect(result.listingHistory).toContainEqual({ date: '8/3', event: 'Price cut', price: 145_000, isReductionAmount: true });
  });

  it('prefers the amount beside the status and above the beds/baths/sqft block', () => {
    const result = read('Pending. $825,000. 4 beds 3 baths 2,750 sqft. Similar homes nearby sold for $1,900,000.');
    expect(result).toMatchObject({ listingStatusCode: 'pending', currentPrice: 825_000 });
  });

  it('never takes a headline amount from a page that is not on the market', () => {
    const offMarket = read('Off market. Tax assessed value $412,000. 3 beds 2 baths 2,000 sqft');
    expect(offMarket).toMatchObject({ listingStatusCode: 'off_market', currentPrice: null, originalListPrice: null });
    const bare = read('Off market. $412,000. 3 beds');
    expect(bare.currentPrice).toBeNull();
  });

  it('keeps a labeled price ahead of any headline amount', () => {
    const result = read('For sale. $1,600,000. Current price: $1,450,000. 3 beds');
    expect(result.currentPrice).toBe(1_450_000);
  });

  it('parses abbreviated amounts wherever money is read, including listing history', () => {
    const result = read('Listing status: Active. Current price: $1.45M. Listed on 7/19/2026 for $1.6M. Price cut: $150K (8/3).');
    expect(result).toMatchObject({ currentPrice: 1_450_000, priorAskingPrice: 1_600_000, originalListPrice: 1_600_000 });
    expect(result.listingHistory).toContainEqual({ date: '7/19/2026', event: 'Listed', price: 1_600_000 });
    expect(result.listingHistory).toContainEqual({ date: '8/3', event: 'Price cut', price: 150_000, isReductionAmount: true });
    expect(read('For sale. $1.2B. 3 beds').currentPrice).toBe(1_200_000_000);
    expect(read('For sale. $145K. 3 beds').currentPrice).toBe(145_000);
  });

  it('reads punctuated, worded and arrow reductions alike, each with its date', () => {
    expect(read('For sale. Price cut: $145K (8/3). $1,450,000. 3 beds').listingHistory)
      .toContainEqual({ date: '8/3', event: 'Price cut', price: 145_000, isReductionAmount: true });
    expect(read('For sale. Price reduced to $1,450,000 on 8/3/2026. 3 beds').listingHistory)
      .toContainEqual({ date: '8/3/2026', event: 'Price cut', price: 1_450_000, isReductionAmount: false });
    expect(read('For sale. ↓ $145K (8/3). $1,450,000. 3 beds').listingHistory)
      .toContainEqual({ date: '8/3', event: 'Price cut', price: 145_000, isReductionAmount: true });
    expect(read('For sale. ↓ $145K. $1,450,000. 3 beds').listingHistory)
      .toContainEqual({ date: null, event: 'Price cut', price: 145_000, isReductionAmount: true });
  });

  it('reads a reduced-to amount as the current price, never as the amount it came down', () => {
    const result = read('For sale. Price reduced to $1,450,000 on 8/3/2026. 3 beds 2 baths');
    expect(result.currentPrice).toBe(1_450_000);
    expect(result.originalListPrice).toBeNull();
  });

  it('derives the original list price from the current price plus a published reduction', () => {
    const derived = read('For sale. Price cut: $145K (8/3). $1,450,000. 3 beds');
    expect(derived).toMatchObject({ originalListPrice: 1_595_000, originalListPriceBasis: 'derived' });
    const published = read('For sale. Price cut: $145K (8/3). $1,450,000. Original list price: $1,595,000. 3 beds');
    expect(published).toMatchObject({ originalListPrice: 1_595_000, originalListPriceBasis: 'published' });
    const none = read('For sale. $1,450,000. 3 beds');
    expect(none).toMatchObject({ originalListPrice: null, originalListPriceBasis: null });
  });

  it('never mistakes a tax value, an automated valuation, a payment, a rent or a per-unit figure for the ask', () => {
    const result = read(`For sale. $1,450,000. Zestimate $1,462,000. Est. payment: $8,913/mo.
      $2,647 Estimated rent. $725/sqft. HOA $250/mo. Down payment $290,000. Closing costs $12,500.
      Tax assessed value $412,000. 3 beds 2 baths 2,000 sqft`);
    expect(result.currentPrice).toBe(1_450_000);
  });

  it('leaves the price unavailable when a page publishes only figures that are not the ask', () => {
    const result = read(`For sale. Zestimate $1,462,000. Est. payment: $8,913/mo. $2,647 Estimated rent.
      $725/sqft. HOA $250/mo. Down payment $290,000. Closing costs $12,500. Tax assessed value $412,000.
      3 beds 2 baths 2,000 sqft`);
    expect(result).toMatchObject({ listingStatusCode: 'active', currentPrice: null, originalListPrice: null });
  });

  it('leaves an off-market record that published only an assessed value with no price at all', () => {
    const result = read('No longer available. Tax assessed value: $412,000. Estimated market value $455,000. 3 beds');
    expect(result).toMatchObject({ listingStatusCode: 'off_market', currentPrice: null, priorAskingPrice: null, originalListPrice: null });
  });

  it('carries the headline price and the derived original onto the reconciled operator card', () => {
    const view = projectExactAddressListingEvidence({
      status: 'retrieved',
      pages: [read('For sale. Price cut: $145K (8/3). $1,450,000. 3 beds 2 baths 2,000 sqft')],
    })!;
    expect(view.listingCard).toMatchObject({
      onMarket: true,
      currentPrice: 1_450_000,
      originalListPrice: 1_595_000,
      originalListPriceBasis: 'derived',
    });
  });

  // R4 — the live shape: the reduction is published on the record that carries
  // the current state, beside a sibling record for the same subject.
  it('keeps the derived original on the card when a sibling record publishes no original', () => {
    const view = projectExactAddressListingEvidence({
      status: 'retrieved',
      pages: [
        read('For sale. 9490 Elk Lake Rd. Price cut: $145K (8/3). $1,450,000. 24 days on Zillow. 3 beds 2 baths 2,000 sqft'),
        read(
          'For sale. 9490 Elk Lake Rd. $1,450,000. 3 beds 2 baths 2,000 sqft',
          'https://www.realtor.com/realestateandhomes-detail/9490-Elk-Lake-Rd_Williamsburg_MI_49690',
        ),
      ],
    })!;
    expect(view.listingCard?.originalListPrice).toBe(1_595_000);
    expect(view.listingCard?.originalListPriceBasis).toBe('derived');
  });
});

describe('listing status vocabulary', () => {
  it('normalizes marketplace wording onto the explicit vocabulary', () => {
    expect(normalizeListingStatus('For Sale')).toBe('active');
    expect(normalizeListingStatus('Active')).toBe('active');
    expect(normalizeListingStatus('Active Under Contract')).toBe('contingent');
    expect(normalizeListingStatus('Contingent')).toBe('contingent');
    expect(normalizeListingStatus('Sale Pending')).toBe('pending');
    expect(normalizeListingStatus('Sold')).toBe('sold');
    expect(normalizeListingStatus('Off Market')).toBe('off_market');
    expect(normalizeListingStatus('Withdrawn')).toBe('off_market');
  });

  it('never infers a status from absence of evidence', () => {
    expect(normalizeListingStatus(null)).toBe('unknown');
    expect(normalizeListingStatus('')).toBe('unknown');
    expect(normalizeListingStatus('60 wooded acres with a pole barn')).toBe('unknown');
    expect(extractListingEvidence({ url: 'https://www.zillow.com/homedetails/a/1_zpid/', text: '60 wooded acres.' }).listingStatusCode)
      .toBe('unknown');
  });

  it('reads active status expressed without the words "for sale"', () => {
    const active = extractListingEvidence({
      url: 'https://www.landwatch.com/property/x/pid/1',
      text: 'Just listed. 60 acres on Elk Lake Rd. Asking price: $1,450,000.',
    });
    expect(active.listingStatusCode).toBe('active');
  });

  it('does not let a historical sold row outrank the live state printed above it', () => {
    const page = extractListingEvidence({
      url: 'https://www.zillow.com/homedetails/x/1_zpid/',
      text: 'For sale. 60 acres. Price history: Listed for $1,595,000. Sold 06/02/2014 for $455,000.',
    });
    expect(page.listingStatusCode).toBe('active');
  });

  it('reads a labeled status as decisive over anything later on the page', () => {
    const page = extractListingEvidence({
      url: 'https://www.redfin.com/MI/x/home/1',
      text: 'Homes for sale nearby. Listing status: Pending. 60 acres.',
    });
    expect(page.listingStatusCode).toBe('pending');
  });
});

describe('listing access evidence tiers', () => {
  const listing = () => extractListingEvidence({
    url: 'https://www.zillow.com/homedetails/9490-Elk-Lake-Rd/1_zpid/',
    retrievedAt: '2026-08-11T14:00:00.000Z',
    text: `A recorded easement provides legal access to the parcel. A dirt driveway leaves Elk Lake Rd.
      Directions: from Williamsburg take M-72 east, turn left on Elk Lake Rd.
      https://photos.zillowstatic.com/fp/one.jpg https://photos.zillowstatic.com/fp/two.jpg`,
  });

  it('keeps reported legal wording on tier 3 and never promotes drive or photo evidence above tier 2', () => {
    const items = listingAccessEvidenceItems(listing());
    expect(items[0]).toMatchObject({ tier: 'reported_legal', sourceKind: 'listing', basis: 'source_stated' });
    const physical = items.filter((item) => item.tier === 'apparent_physical');
    expect(physical.length).toBeGreaterThanOrEqual(3);
    expect(physical.every((item) => item.sourceKind === 'listing' && item.basis === 'source_stated')).toBe(true);
    expect(items.some((item) => item.tier === 'verified_legal')).toBe(false);
    expect(physical.map((item) => item.statement).join(' ')).toMatch(/never a legal right/i);
  });

  it('supports tier 2 from driveway wording, published directions and listing photography', () => {
    const physical = listingAccessEvidenceItems(listing()).filter((item) => item.tier === 'apparent_physical');
    expect(physical.some((item) => /dirt driveway/i.test(item.statement))).toBe(true);
    expect(physical.some((item) => /take M-72 east/i.test(item.statement))).toBe(true);
    const photography = physical.find((item) => /listing photograph/i.test(item.statement));
    expect(photography).toMatchObject({ artifactRef: 'https://photos.zillowstatic.com/fp/one.jpg' });
    expect(photography?.statement).toMatch(/2 listing photographs/);
  });

  it('emits no photography observation when no photo was actually retained', () => {
    const items = listingAccessEvidenceItems(extractListingEvidence({
      url: 'https://www.zillow.com/homedetails/x/1_zpid/',
      text: 'A gravel driveway leaves the road. No images were published.',
    }));
    expect(items.some((item) => /listing photograph/i.test(item.statement))).toBe(false);
  });
});

describe('retained record identity and merge', () => {
  const record = (over: { url: string; text: string; retrievedAt: string }): ExtractedListingEvidence =>
    extractListingEvidence({ url: over.url, text: over.text, retrievedAt: over.retrievedAt });

  const zillowUrl = 'https://www.zillow.com/homedetails/9490-Elk-Lake-Rd/1_zpid/';
  const redfinUrl = 'https://www.redfin.com/MI/Williamsburg/9490-Elk-Lake-Rd-49690/home/1';

  it('treats two reads of the same detail page as one record regardless of query string', () => {
    const first = record({ url: zillowUrl, text: 'Listing status: Active. MLS # 1948192.', retrievedAt: '2026-08-10T00:00:00.000Z' });
    const second = record({ url: `${zillowUrl}?utm_source=x`, text: 'Listing status: Active.', retrievedAt: '2026-08-11T00:00:00.000Z' });
    expect(listingRecordIdentityKey(second)).toBe(listingRecordIdentityKey(first));
  });

  it('refreshes a record in place and keeps facts the thinner revisit dropped', () => {
    const first = record({
      url: zillowUrl,
      text: 'Listing status: Active. Current price: $1,450,000. 4 beds 3 baths, 2,750 sqft, built in 2001. MLS # 1948192. https://photos.example/one.jpg',
      retrievedAt: '2026-08-10T00:00:00.000Z',
    });
    const thinner = record({ url: zillowUrl, text: 'Listing status: Active.', retrievedAt: '2026-08-11T00:00:00.000Z' });
    const merged = mergeRetainedListingRecords([first], [thinner]);
    expect(merged.pages).toHaveLength(1);
    expect(merged).toMatchObject({ newRecordCount: 0, refreshedRecordCount: 1, preservedRecordCount: 0 });
    expect(merged.pages[0]).toMatchObject({
      retrievedAt: '2026-08-11T00:00:00.000Z',
      listingStatusCode: 'active',
      yearBuilt: 2001,
      beds: 4,
      currentPrice: 1_450_000,
    });
    expect(merged.pages[0].photoUrls).toEqual(['https://photos.example/one.jpg']);
  });

  it('preserves prior records as secondary when a revisit only returns the stale duplicate', () => {
    const current = record({
      url: zillowUrl,
      text: 'Listing status: Active. Current price: $1,450,000. https://photos.example/one.jpg',
      retrievedAt: '2026-08-10T00:00:00.000Z',
    });
    const staleDuplicate = record({
      url: redfinUrl,
      text: 'Listing status: Off market. 60 acres.',
      retrievedAt: '2026-08-11T00:00:00.000Z',
    });
    const merged = mergeRetainedListingRecords([current], [staleDuplicate]);
    expect(merged.pages).toHaveLength(2);
    expect(merged).toMatchObject({ newRecordCount: 1, refreshedRecordCount: 0, preservedRecordCount: 1 });
    expect(merged.pages.map((page) => page.sourceUrl)).toContain(zillowUrl);
    expect(merged.pages.find((page) => page.sourceUrl === zillowUrl)?.currentPrice).toBe(1_450_000);
  });

  it('is a no-op that keeps every retained record when the revisit returns nothing', () => {
    const current = record({ url: zillowUrl, text: 'Listing status: Active.', retrievedAt: '2026-08-10T00:00:00.000Z' });
    expect(mergeRetainedListingRecords([current], []).pages).toHaveLength(1);
    expect(mergeRetainedListingRecords([], []).pages).toEqual([]);
  });
});

describe('operator projection of retained listing evidence', () => {
  const page = (over: Partial<ExtractedListingEvidence> = {}): ExtractedListingEvidence => ({
    sourceUrl: 'https://www.redfin.com/MI/Williamsburg/9490-Elk-Lake-Rd-49690/home/143868919',
    sourceLabel: 'redfin.com',
    retrievedAt: '2026-08-10T22:46:00.000Z',
    legalAccessStatements: [],
    drivewayStatements: [],
    directionsStatements: [],
    streetAddress: '9490 Elk Lake Rd',
    apn: null,
    propertyType: 'house',
    buildingSqft: 2000,
    acres: 60,
    utilities: ['electric'],
    well: true,
    septic: true,
    remarks: [],
    listingStatus: 'Active',
    listingStatusCode: 'active',
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
    listingAgent: null,
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
            provider: 'zillow',
            sourceLabel: 'Zillow',
            sourceUrl: 'https://www.zillow.com/homedetails/9490-Elk-Lake-Rd-Williamsburg-MI-49690/243126665_zpid/',
            views: 8421, saves: 317,
            viewsAvailability: 'available', savesAvailability: 'available',
            listingAgeDays: 23, listingAgeAvailability: 'available',
            photoCount: 2, photoCountAvailability: 'available',
            priceChangeCount: 1, priceChangeAvailability: 'available',
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

  const zillowUrl = 'https://www.zillow.com/homedetails/9490-Elk-Lake-Rd-Williamsburg-MI-49690/243126665_zpid/';
  const realtorUrl = 'https://www.realtor.com/realestateandhomes-detail/9490-Elk-Lake-Rd_Williamsburg_MI_49690';
  const redfinUrl = 'https://www.redfin.com/MI/Williamsburg/9490-Elk-Lake-Rd-49690/home/143868919';

  it('reconciles duplicate provider records published under different MLS numbers into one subject', () => {
    const view = projectExactAddressListingEvidence({
      status: 'retrieved',
      pages: [
        page({
          sourceUrl: zillowUrl, sourceLabel: 'zillow.com', mls: '1948192',
          retrievedAt: '2026-08-11T12:00:00.000Z',
          listingHistory: [
            { date: '2026-07-19', event: 'Listed for sale', price: 1_595_000 },
            { date: '2026-08-05', event: 'Price cut', price: 1_450_000 },
          ],
        }),
        page({
          sourceUrl: realtorUrl, sourceLabel: 'realtor.com', mls: '80071245',
          retrievedAt: '2026-08-10T12:00:00.000Z', currentPrice: 1_595_000,
        }),
        page({
          sourceUrl: 'https://credible.example/property/1200-other-rd-1',
          sourceLabel: 'credible.example', streetAddress: '1200 Other Rd', mls: '55555',
          retrievedAt: '2026-08-10T12:00:00.000Z',
        }),
      ],
    })!;
    expect(view.reconciliation?.subjectCount).toBe(2);
    expect(view.reconciliation?.canonical.recordCount).toBe(2);
    expect(view.reconciliation?.canonical.sourceUrls).toEqual([zillowUrl, realtorUrl]);
    expect(view.reconciliation?.canonical.matchedOn).toContain('normalized street address');
    expect(view.reconciliation?.canonical.mlsNumbers).toEqual(['1948192', '80071245']);
    expect(view.reconciliation?.canonical.identityNote).toMatch(/ONE physical subject/);
    // The record with the later price event carries the current state.
    expect(view.reconciliation?.currentRecord?.sourceUrl).toBe(zillowUrl);
    expect(view.reconciliation?.supersededRecords.map((r) => r.sourceUrl)).toEqual([realtorUrl]);
    expect(view.reconciliation?.supersededRecords[0].reason).toMatch(/retained as secondary evidence/i);
    // A different street address is a different subject, never merged.
    expect(view.reconciliation?.otherRecords.map((r) => r.sourceLabel)).toEqual(['credible.example']);
    expect(view.reconciliation?.otherRecords[0].reason).toMatch(/street address or APN disagrees/i);
    expect(view.listingCard).toMatchObject({
      active: true, statusCode: 'active', currentPrice: 1_450_000, listingUrl: zillowUrl,
      mlsNumbers: ['1948192', '80071245'],
      additionalSourceUrls: [realtorUrl],
    });
  });

  it('resolves a stale sold duplicate against a supported active record for the same subject', () => {
    const view = projectExactAddressListingEvidence({
      status: 'retrieved',
      pages: [
        page({
          sourceUrl: redfinUrl, sourceLabel: 'redfin.com', mls: '9001',
          listingStatus: 'Sold', listingStatusCode: 'sold', currentPrice: 455_000,
          retrievedAt: '2026-08-11T12:00:00.000Z',
          listingDate: '2014-03-01',
          listingHistory: [{ date: '2014-06-02', event: 'Sold', price: 455_000 }],
        }),
        page({
          sourceUrl: zillowUrl, sourceLabel: 'zillow.com', mls: '9002',
          retrievedAt: '2026-08-11T12:00:00.000Z',
          listingHistory: [{ date: '2026-07-19', event: 'Listed for sale', price: 1_595_000 }],
        }),
      ],
    })!;
    expect(view.reconciliation?.currentRecord?.sourceUrl).toBe(zillowUrl);
    expect(view.reconciliation?.supersededRecords[0]).toMatchObject({ sourceUrl: redfinUrl, listingStatusCode: 'sold' });
    expect(view.reconciliation?.supersededRecords[0].reason).toMatch(/stale sold state/i);
    expect(view.listingCard).toMatchObject({ active: true, onMarket: true, statusCode: 'active' });
  });

  it('lets a fresher off-market record supersede an older active record for the same subject', () => {
    const view = projectExactAddressListingEvidence({
      status: 'retrieved',
      pages: [
        page({
          sourceUrl: zillowUrl, sourceLabel: 'zillow.com', mls: '9002',
          retrievedAt: '2026-08-01T12:00:00.000Z',
          listingHistory: [{ date: '2026-07-19', event: 'Listed for sale', price: 1_595_000 }],
        }),
        page({
          sourceUrl: redfinUrl, sourceLabel: 'redfin.com', mls: '9001',
          listingStatus: 'Off market', listingStatusCode: 'off_market',
          retrievedAt: '2026-08-11T12:00:00.000Z',
          listingDate: '2026-08-09',
          listingHistory: [{ date: '2026-08-09', event: 'Listing removed', price: null }],
        }),
      ],
    })!;
    expect(view.reconciliation?.currentRecord?.sourceUrl).toBe(redfinUrl);
    expect(view.reconciliation?.currentRecord?.reason).toMatch(/supersedes the older on-market record/i);
    expect(view.listingCard).toMatchObject({ active: false, onMarket: false, statusCode: 'off_market' });
  });

  // The card source keeps listing IDENTITY and the reconciled status. Every
  // other field falls through to the record of the same subject that actually
  // published it, attributed to that record.
  it('fills a field the card source never published from a sibling record, never the status', () => {
    const view = projectExactAddressListingEvidence({
      status: 'retrieved',
      pages: [
        page({
          sourceUrl: zillowUrl, sourceLabel: 'zillow.com', mls: '9002',
          retrievedAt: '2026-08-11T12:00:00.000Z',
          yearBuilt: null, beds: null, description: null, currentPrice: null, priorAskingPrice: null,
          listingHistory: [{ date: '2026-07-19', event: 'Listed for sale', price: null }],
        }),
        page({
          sourceUrl: realtorUrl, sourceLabel: 'realtor.com', mls: '9003',
          retrievedAt: '2026-08-10T12:00:00.000Z',
          yearBuilt: 1984, beds: 3, description: 'Waterfront acreage with a home.', currentPrice: 999_000,
        }),
      ],
    })!;
    expect(view.listingCard?.improvementFacts).toMatchObject({ yearBuilt: 1984, beds: 3 });
    expect(view.listingCard?.description).toBe('Waterfront acreage with a home.');
    expect(view.listingCard?.supplementedFrom).toContain('realtor.com');
    // The card source published no price at all, so the subject's own published
    // price is shown and attributed to the record that published it.
    expect(view.listingCard?.currentPrice).toBe(999_000);
    expect(view.listingCard?.fieldSources.currentPrice).toMatchObject({
      sourceLabel: 'realtor.com', fromCardSource: false,
    });
    // Status and listing identity still come only from the card source.
    expect(view.listingCard).toMatchObject({ statusCode: 'active', listingUrl: zillowUrl, sourceLabel: 'zillow.com' });
  });

  it('leaves an unstated status unknown and never reads it as active', () => {
    const view = projectExactAddressListingEvidence({
      status: 'retrieved',
      pages: [page({ listingStatus: null, listingStatusCode: 'unknown', listingHistory: [] })],
    })!;
    expect(view.listingCard).toMatchObject({ active: false, onMarket: false, statusCode: 'unknown', statusLabel: 'Unknown' });
    expect(view.listingCard?.statusNote).toMatch(/never read as active/i);
  });

  it('carries every provider\'s engagement with its own provenance and never renders unavailable as zero', () => {
    const view = projectExactAddressListingEvidence({
      status: 'retrieved',
      pages: [
        page({
          sourceUrl: zillowUrl, sourceLabel: 'zillow.com', mls: '9002',
          retrievedAt: '2026-08-11T12:00:00.000Z',
          engagement: {
            provider: 'zillow', sourceLabel: 'zillow.com', sourceUrl: zillowUrl,
            views: null, saves: null,
            viewsAvailability: 'unavailable', savesAvailability: 'unavailable',
            listingAgeDays: null, listingAgeAvailability: 'unavailable',
            photoCount: 2, photoCountAvailability: 'available',
            priceChangeCount: null, priceChangeAvailability: 'unavailable',
            retrievedAt: '2026-08-11T12:00:00.000Z',
          },
        }),
        page({
          sourceUrl: realtorUrl, sourceLabel: 'realtor.com', mls: '9003',
          retrievedAt: '2026-08-10T12:00:00.000Z',
          engagement: {
            provider: 'realtor', sourceLabel: 'realtor.com', sourceUrl: realtorUrl,
            views: 1204, saves: null,
            viewsAvailability: 'available', savesAvailability: 'unavailable',
            listingAgeDays: 41, listingAgeAvailability: 'available',
            photoCount: 2, photoCountAvailability: 'available',
            priceChangeCount: 1, priceChangeAvailability: 'available',
            retrievedAt: '2026-08-10T12:00:00.000Z',
          },
        }),
      ],
    })!;
    expect(view.listingCard?.zillowEngagement).toMatchObject({
      provider: 'zillow', views: null, viewsAvailability: 'unavailable', savesAvailability: 'unavailable',
    });
    expect(view.listingCard?.zillowEngagement?.views).not.toBe(0);
    expect(view.listingCard?.zillowEngagement?.saves).not.toBe(0);
    expect(view.listingCard?.engagementByProvider.map((signal) => signal.provider)).toEqual(['zillow', 'realtor']);
    expect(view.listingCard?.engagementByProvider[1]).toMatchObject({ views: 1204, sourceUrl: realtorUrl });
    expect(view.listingCard?.engagementNote).toMatch(/unavailable, never zero/i);
  });

  it('synthesizes an unavailable Zillow signal for legacy evidence rather than a zero', () => {
    const view = projectExactAddressListingEvidence({
      status: 'retrieved',
      pages: [page({ sourceUrl: zillowUrl, sourceLabel: 'zillow.com', engagement: null })],
    })!;
    expect(view.listingCard?.zillowEngagement).toMatchObject({
      views: null, saves: null, viewsAvailability: 'unavailable', savesAvailability: 'unavailable',
    });
    expect(view.listingCard?.zillowEngagement?.views).not.toBe(0);
  });

  it('returns a null-safe view with no retained pages and no result', () => {
    expect(projectExactAddressListingEvidence(null)).toBeNull();
    const empty = projectExactAddressListingEvidence({ status: 'none', note: 'nothing retained', pages: [] })!;
    expect(empty.sources).toEqual([]);
    expect(empty.subjectRead).toBeNull();
    expect(empty.note).toBe('nothing retained');
  });
});

describe('the reconciled card carries the best field the whole subject published', () => {
  // The exact four-record retained state the operator reported. All four are the
  // same physical property and are already correctly reconciled; the card source
  // happens to be the one record carrying junk where the subject has clean
  // evidence on its siblings.
  const STORED_JUNK_BROKERAGE = 'services , Consumer protection notice California DRE #01937601 Contact '
    + 'Homes.com Brokerage About Us Advertise Terms of Use Builder Terms of Use Privacy Notice E';

  const record = (over: Partial<ExtractedListingEvidence>): ExtractedListingEvidence => ({
    sourceUrl: 'https://example.com/listing/1',
    sourceLabel: 'example.com',
    retrievedAt: '2026-08-11T18:00:00.000Z',
    legalAccessStatements: [], drivewayStatements: [], directionsStatements: [],
    streetAddress: '9490 Elk Lake Rd', apn: null,
    propertyType: null, buildingSqft: 2000, acres: 60,
    utilities: [], well: null, septic: null, remarks: [],
    listingStatus: 'Active', listingStatusCode: 'active',
    currentPrice: 1_450_000, priorAskingPrice: null, originalListPrice: null,
    listingDate: null, daysOnMarket: null,
    beds: 3, baths: 2, yearBuilt: 1984, structures: [], description: null, features: [],
    brokerage: null, listingAgent: null, mls: null,
    listingHistory: [], photoUrls: [], engagement: null,
    ...over,
  });

  const homesUrl = 'https://www.homes.com/property/9490-elk-lake-rd-williamsburg-mi/123/';
  const redfinUrl = 'https://www.redfin.com/MI/Williamsburg/9490-Elk-Lake-Rd-49690/home/143868919';
  const realtorUrl = 'https://www.realtor.com/realestateandhomes-detail/9490-Elk-Lake-Rd_Williamsburg_MI_49690';
  const zillowUrl = 'https://www.zillow.com/homedetails/9490-Elk-Lake-Rd-Williamsburg-MI-49690/243126665_zpid/';

  // homes.com is the freshest read, so it is the card source; its brokerage is
  // the stored footer and it published no original list price.
  const homesRecord = record({
    sourceUrl: homesUrl, sourceLabel: 'homes.com', retrievedAt: '2026-08-11T20:00:00.000Z',
    propertyType: 'Single Family', mls: 'T062626', brokerage: STORED_JUNK_BROKERAGE,
  });
  const retained = (): ExtractedListingEvidence[] => [
    homesRecord,
    record({ sourceUrl: redfinUrl, sourceLabel: 'redfin.com', propertyType: 'house', mls: '80071245', brokerage: 'Kathy Wittbrodt' }),
    record({ sourceUrl: realtorUrl, sourceLabel: 'realtor.com' }),
    record({ sourceUrl: zillowUrl, sourceLabel: 'zillow.com', propertyType: 'Single Family', mls: '1948192', originalListPrice: 1_595_000 }),
  ];

  it('takes the clean brokerage and the published original from the records that published them', () => {
    const view = projectExactAddressListingEvidence({ status: 'retrieved', pages: retained() })!;
    // One subject, and the card source still owns listing identity and status.
    expect(view.reconciliation?.canonical.recordCount).toBe(4);
    expect(view.listingCard).toMatchObject({
      listingUrl: homesUrl, sourceLabel: 'homes.com', statusCode: 'active', active: true,
      brokerage: 'Kathy Wittbrodt',
      originalListPrice: 1_595_000,
      currentPrice: 1_450_000,
    });
    expect(view.listingCard?.brokerage).not.toContain('Terms of Use');
    expect(view.listingCard?.fieldSources.brokerage).toMatchObject({
      sourceLabel: 'redfin.com', sourceUrl: redfinUrl, fromCardSource: false,
    });
    expect(view.listingCard?.fieldSources.originalListPrice).toMatchObject({
      sourceLabel: 'zillow.com', fromCardSource: false,
    });
    // A conflict-free price the card source itself published stays its own.
    expect(view.listingCard?.fieldSources.currentPrice).toMatchObject({
      sourceLabel: 'homes.com', fromCardSource: true,
    });
    expect(view.listingCard?.supplementedFrom).toEqual(expect.arrayContaining(['redfin.com', 'zillow.com']));
  });

  it('resolves a differing asking price in favour of the record carrying the current status', () => {
    const pages = retained();
    pages[3] = { ...pages[3], currentPrice: 1_295_000 };
    const view = projectExactAddressListingEvidence({ status: 'retrieved', pages })!;
    expect(view.listingCard?.currentPrice).toBe(1_450_000);
    expect(view.listingCard?.fieldSources.currentPrice?.fromCardSource).toBe(true);
  });

  it('keeps both real MLS ids and labels the card id as reported by one provider', () => {
    const view = projectExactAddressListingEvidence({ status: 'retrieved', pages: retained() })!;
    expect(view.listingCard?.mlsNumbers).toEqual(expect.arrayContaining(['80071245', '1948192']));
    expect(view.reconciliation?.canonical.mlsNumbers).toEqual(expect.arrayContaining(['80071245', '1948192']));
    expect(view.listingCard?.mlsCorroboration).toBe('single_record');
    expect(view.listingCard?.fieldSources.mls?.note).toMatch(/reported by that one provider/i);
  });

  it('prefers an MLS id more than one record of the subject publishes', () => {
    const pages = retained();
    pages[1] = { ...pages[1], mls: '1948192' };
    const view = projectExactAddressListingEvidence({ status: 'retrieved', pages })!;
    expect(view.listingCard?.mls).toBe('1948192');
    expect(view.listingCard?.mlsCorroboration).toBe('corroborated');
    expect(view.listingCard?.fieldSources.mls?.supportingRecordCount).toBe(2);
  });

  it('rejects the stored footer on the merge path as well as on the fresh page', () => {
    // Fresh path: the same wording read off a page today.
    expect(extractListingEvidence({
      url: homesUrl,
      text: `For sale. 9490 Elk Lake Rd. $1,450,000. 3 beds. Listed by: ${STORED_JUNK_BROKERAGE}`,
      retrievedAt: '2026-08-11T20:00:00.000Z',
    }).brokerage).toBeNull();
    // Merge path: the same wording already stored on a record retrieved today.
    const merged = mergeRetainedListingRecords([homesRecord], []);
    expect(merged.pages[0].brokerage).toBeNull();
    const refreshed = mergeRetainedListingRecords(
      [homesRecord],
      [{ ...homesRecord, retrievedAt: '2026-08-12T20:00:00.000Z', brokerage: null }],
    );
    expect(refreshed.pages).toHaveLength(1);
    expect(refreshed.pages[0].brokerage).toBeNull();
    // And the projection of a record that was stored before the test existed.
    const view = projectExactAddressListingEvidence({ status: 'retrieved', pages: [homesRecord] })!;
    expect(view.sources[0].brokerage).toBeNull();
    expect(view.listingCard?.brokerage).toBeNull();
  });

  it('drops a stored MLS value that is not shaped like an id, keeping the real ones', () => {
    const merged = mergeRetainedListingRecords(
      [
        { ...homesRecord, mls: 'Data' },
        record({ sourceUrl: redfinUrl, sourceLabel: 'redfin.com', mls: '80071245' }),
        record({ sourceUrl: zillowUrl, sourceLabel: 'zillow.com', mls: '1948192' }),
      ],
      [],
    );
    expect(merged.pages.find((page) => page.sourceUrl === homesUrl)?.mls).toBeNull();
    expect(merged.pages.map((page) => page.mls).filter(Boolean).sort())
      .toEqual(['1948192', '80071245']);
  });

  it('never invents a field no record of the subject published', () => {
    const view = projectExactAddressListingEvidence({
      status: 'retrieved',
      pages: retained().map((page) => ({ ...page, brokerage: null, originalListPrice: null, mls: null })),
    })!;
    expect(view.listingCard).toMatchObject({ brokerage: null, originalListPrice: null, mls: null, mlsCorroboration: null });
    expect(view.listingCard?.fieldSources.brokerage).toBeUndefined();
    expect(view.listingCard?.fieldSources.originalListPrice).toBeUndefined();
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
