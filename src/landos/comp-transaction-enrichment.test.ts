import { describe, it, expect } from 'vitest';
import {
  compTransactionUpdate,
  extractLandWatchTransactionEvidence,
  extractRedfinTransactionEvidence,
  landWatchListingId,
  parseUsLongDate,
  rankCompsForTransactionEnrichment,
  reconcileTransactionEvidence,
  redfinListingId,
  transactionEnrichmentProvider,
  type DetailPageCapture,
} from './comp-transaction-enrichment.js';
import type { CompRow } from './comps.js';

function comp(overrides: Partial<CompRow> = {}): CompRow {
  return {
    id: 1, entity: 'tyler', deal_card_id: 89, card_id: 79,
    source_label: 'LandWatch', source_url: '', address_desc: '', apn: '',
    county: 'Williamson', state: 'TN', price: 1_000_000, price_kind: 'sale',
    sale_or_list_date: '', acres: 70, price_per_acre: 14_285.71, notes: '',
    added_by: '', status: 'market_reference', created_at: 0, lat: null, lng: null,
    canonical_source: '', city: '', zip: '', distance_miles: null, listing_date: '',
    days_on_market: null, property_class: 'vacant_land', classification: 'core',
    thumbnail_url: '', retrieved_at: '', radius_miles: null, date_window_months: null,
    inclusion_reason: '', source_attributions_json: '[]', canonical_key: '',
    updated_at: 0, pricing_basis: '', valuation_selected: 0,
    valuation_selection_reason: '', valuation_selection_updated_at: 0,
    valuation_selection_actor: '', listing_detail_json: '',
    ...overrides,
  } as CompRow;
}

const LW_URL = 'https://www.landwatch.com/williamson-county-tennessee-farms-and-ranches-for-sale/pid/425446862';
const RF_URL = 'https://www.redfin.com/TN/Fairview/1-Ivey-Rd-37062/home/190880583';

/** Shaped exactly as LandWatch streams it: escaped JSON inside <script> text. */
function landWatchCapture(overrides: Partial<DetailPageCapture> = {}): DetailPageCapture {
  const payload = [
    '{\\"facebookDareJavascript\\":\\"{\\"availability\\":\\"recently_sold\\"}\\",',
    '\\"h1\\":\\"Camwood Farms\\",',
    '\\"listingEvents\\":[{\\"date\\":\\"2026-08-12T00:00:00\\",\\"price\\":8415000,\\"priceDelta\\":-6.44,\\"acres\\":75.37,\\"acresDelta\\":0,\\"eventTitle\\":\\"Sold\\"},',
    '{\\"date\\":\\"2026-01-15T00:00:00\\",\\"price\\":8995000,\\"priceDelta\\":null,\\"acres\\":75.37,\\"acresDelta\\":null,\\"eventTitle\\":\\"Listed for Sale\\"}],',
    '\\"listingId\\":26042367}',
    // The listing's own record, plus a NEIGHBOURING listing that must be ignored.
    '{\\"acres\\":80.51,\\"isResidence\\":true,\\"siteListingId\\":423204239}',
    '{\\"acres\\":75.37,\\"isResidence\\":false,\\"listingDate\\":\\"2026-01-15\\",\\"siteListingId\\":425446862}',
  ].join('');
  return {
    url: LW_URL,
    // LandWatch appends its own chrome after the address.
    title: '1100 Camwood Way, Franklin, TN 37064 | MLS: 3111094 | LandWatch',
    text: 'Sold\n$8,995,000\n1100 Camwood Way , Franklin, TN 37064\n(Williamson County)\nSize:\n75.37 Acres\n',
    scriptText: payload,
    ...overrides,
  };
}

function redfinCapture(overrides: Partial<DetailPageCapture> = {}): DetailPageCapture {
  const text = [
    'OFF MARKET JAN 2025 FOR $405K',
    '$436,308', '—', 'bd', '•', '— ba', '•', '12.92', 'acres (lot)',
    '1 Ivey Rd, Fairview, TN 37062',
    'Vacant land', 'Property Type', '12.92 acres', 'Lot Size',
    // Another property's sold strip — must never be read as this record's sale.
    'Recently sold homes',
    'SOLD JUN 2, 2026', '$675,000', 'A', 'Land', '21 Fox Vale Ln, Nashville, TN 37221',
    'Sale history for 1 Ivey Rd',
    'Date', 'Event', 'Price',
    'Jan 17, 2025', 'Sold', '$405,000',
    'Dec 17, 2024', 'Contingent', '—',
    'Dec 12, 2024', 'Listed', '$425,000',
    'Nov 1, 2024', 'Listing Removed', '—',
    'May 22, 2024', 'Listed', '$465,000',
  ].join('\n');
  return { url: RF_URL, title: '1 Ivey Rd, Fairview, TN 37062 | Redfin', text, scriptText: '', ...overrides };
}

describe('listing identity', () => {
  it('reads the provider listing id out of a retained URL', () => {
    expect(landWatchListingId(LW_URL)).toBe('425446862');
    expect(redfinListingId(RF_URL)).toBe('190880583');
    expect(landWatchListingId('https://www.landwatch.com/tennessee-land-for-sale')).toBeNull();
  });

  it('only claims rows whose retained URL is a revisitable detail page', () => {
    expect(transactionEnrichmentProvider(comp({ source_url: LW_URL }))).toBe('LandWatch');
    expect(transactionEnrichmentProvider(comp({ source_url: RF_URL }))).toBe('Redfin');
    expect(transactionEnrichmentProvider(comp({ source_url: 'https://landportal.com/?property=abc' }))).toBeNull();
    expect(transactionEnrichmentProvider(comp({ source_url: '' }))).toBeNull();
  });
});

describe('LandWatch transaction extraction', () => {
  it('reads the dated Sold event, its closed price, and the acreage it covered', () => {
    const e = extractLandWatchTransactionEvidence(landWatchCapture());
    expect(e.closedSale).toBe(true);
    expect(e.soldDateIso).toBe('2026-08-12');
    // The card headline was the ASKING price; the closed price is what wins.
    expect(e.soldPrice).toBe(8_415_000);
    expect(e.acres).toBe(75.37);
    expect(e.limitation).toBeNull();
  });

  it('keeps the prior listing history newest-first', () => {
    const e = extractLandWatchTransactionEvidence(landWatchCapture());
    expect(e.events.map((x) => `${x.dateIso} ${x.event}`)).toEqual([
      '2026-08-12 Sold',
      '2026-01-15 Listed for Sale',
    ]);
  });

  it("reads improvement status from THIS listing's record, not a neighbouring one", () => {
    const e = extractLandWatchTransactionEvidence(landWatchCapture());
    expect(e.improved).toBe(false);
    expect(e.improvementStatement).toMatch(/not a residence/i);
  });

  it('states a limitation instead of a date when a sold listing publishes no dated event', () => {
    const e = extractLandWatchTransactionEvidence(landWatchCapture({
      scriptText: '{\\"availability\\":\\"recently_sold\\",\\"siteListingId\\":425446862}',
    }));
    expect(e.closedSale).toBe(false);
    expect(e.soldDateIso).toBeNull();
    expect(e.limitation).toMatch(/no dated Sold event/i);
  });
});

describe('Redfin transaction extraction', () => {
  it('reads the sale-history Sold row for this property', () => {
    const e = extractRedfinTransactionEvidence(redfinCapture());
    expect(e.closedSale).toBe(true);
    expect(e.soldDateIso).toBe('2025-01-17');
    expect(e.soldPrice).toBe(405_000);
  });

  it("never reads a neighbouring property's sold strip as this record's sale", () => {
    const e = extractRedfinTransactionEvidence(redfinCapture());
    // 21 Fox Vale Ln sold Jun 2 2026 for $675,000 and appears ABOVE the table.
    expect(e.events.some((x) => x.price === 675_000)).toBe(false);
    expect(e.soldPrice).not.toBe(675_000);
  });

  it('reads the stated property type and lot size', () => {
    const e = extractRedfinTransactionEvidence(redfinCapture());
    expect(e.improved).toBe(false);
    expect(e.acres).toBe(12.92);
  });

  it('states a limitation when the page publishes no dated Sold row', () => {
    const e = extractRedfinTransactionEvidence(redfinCapture({
      text: 'OFF MARKET JAN 2025 FOR $405K\nSale history for 1 Ivey Rd\nDate\nEvent\nPrice\nDec 12, 2024\nListed\n$425,000',
    }));
    expect(e.closedSale).toBe(false);
    expect(e.limitation).toMatch(/no dated Sold row/i);
  });

  it('parses the US long-date form the table uses', () => {
    expect(parseUsLongDate('Jan 17, 2025')).toBe('2025-01-17');
    expect(parseUsLongDate('September 3, 2024')).toBe('2024-09-03');
    expect(parseUsLongDate('sometime in 2025')).toBeNull();
  });
});

describe('identity gate', () => {
  it('binds evidence when the retained listing id survives the round trip', () => {
    const row = comp({ source_url: LW_URL, address_desc: '1100 Camwood Way, Franklin, TN, 37064' });
    const verdict = reconcileTransactionEvidence(extractLandWatchTransactionEvidence(landWatchCapture()), row);
    expect(verdict.matched).toBe(true);
    expect(verdict.matchedOn).toContain('LandWatch listing id 425446862');
    expect(verdict.matchedOn).toContain('street address');
  });

  it('reconciles across the provider chrome and postal punctuation in a page title', () => {
    // The stored row writes "TN, 37064"; the page title writes "TN 37064" and
    // then appends "| MLS: … | LandWatch". Neither difference is a mismatch.
    const row = comp({ source_url: LW_URL, address_desc: '1100 Camwood Way, Franklin, TN, 37064' });
    const evidence = extractLandWatchTransactionEvidence(landWatchCapture());
    expect(evidence.address).toBe('1100 Camwood Way, Franklin, TN 37064');
    expect(reconcileTransactionEvidence(evidence, row).matched).toBe(true);
  });

  it('refuses evidence from a different listing after a redirect', () => {
    const row = comp({ source_url: LW_URL });
    const evidence = extractLandWatchTransactionEvidence(landWatchCapture({
      url: 'https://www.landwatch.com/williamson-county-tennessee-farms-and-ranches-for-sale/pid/999999999',
    }));
    const verdict = reconcileTransactionEvidence(evidence, row);
    expect(verdict.matched).toBe(false);
    expect(verdict.reason).toMatch(/never applied/i);
  });

  it('refuses evidence when the page states a different street address', () => {
    // Same Redfin home id, different street: the page is not this comparable.
    const row = comp({ source_url: RF_URL, source_label: 'Redfin', address_desc: '7194 Dice Lampley Rd, Fairview, TN 37062' });
    const verdict = reconcileTransactionEvidence(extractRedfinTransactionEvidence(redfinCapture()), row);
    expect(verdict.matched).toBe(false);
    expect(verdict.reason).toMatch(/do not reconcile/i);
  });
});

describe('field patch', () => {
  it('establishes the date and replaces an asking price with the closed price', () => {
    const row = comp({ id: 987, source_url: LW_URL, price: 8_995_000, acres: 75, price_per_acre: 119_933.33 });
    const update = compTransactionUpdate(row, extractLandWatchTransactionEvidence(landWatchCapture()));
    expect(update.patch.saleOrListDate).toBe('2026-08-12');
    expect(update.patch.price).toBe(8_415_000);
    expect(update.patch.acres).toBe(75.37);
    expect(update.patch.pricePerAcre).toBeCloseTo(111_649.2, 0);
    expect(update.refusal).toBeNull();
  });

  it('corrects acreage a search card read out of listing prose', () => {
    const row = comp({ source_url: RF_URL, source_label: 'Redfin', address_desc: '1 Ivey Rd, Fairview, TN 37062', price: 405_000, acres: 190, price_per_acre: 2_131.58 });
    const update = compTransactionUpdate(row, extractRedfinTransactionEvidence(redfinCapture()));
    expect(update.patch.acres).toBe(12.92);
    expect(update.patch.price).toBeUndefined(); // the price was already correct
    expect(update.patch.pricePerAcre).toBeCloseTo(31_346.75, 1);
  });

  it('writes nothing when the source states no dated closed sale', () => {
    const row = comp({ source_url: RF_URL });
    const evidence = extractRedfinTransactionEvidence(redfinCapture({ text: 'no history here' }));
    const update = compTransactionUpdate(row, evidence);
    expect(update.patch).toEqual({});
    expect(update.refusal).toMatch(/no sale-history table/i);
  });

  it('never touches classification or valuation selection', () => {
    const row = comp({ source_url: LW_URL, classification: 'directional', valuation_selected: -1 });
    const update = compTransactionUpdate(row, extractLandWatchTransactionEvidence(landWatchCapture()));
    expect(Object.keys(update.patch)).not.toContain('classification');
    expect(Object.keys(update.patch)).not.toContain('valuationSelected');
  });

  it('corrects property class when the source states the parcel carries a residence', () => {
    // A stored vacant-land class plus a newly established sale date is exactly
    // how an improved sale would reach the clean vacant-land median.
    const improved = landWatchCapture({
      scriptText: landWatchCapture().scriptText.replace(
        '{\\"acres\\":75.37,\\"isResidence\\":false',
        '{\\"acres\\":75.37,\\"isResidence\\":true',
      ),
    });
    const row = comp({ source_url: LW_URL, property_class: 'vacant_land' });
    const update = compTransactionUpdate(row, extractLandWatchTransactionEvidence(improved));
    expect(update.patch.propertyClass).toBe('residential');
    expect(update.changes.join(' ')).toMatch(/is a residence/i);
  });

  it('leaves property class alone when the source does not state residence status', () => {
    const row = comp({ source_url: LW_URL, property_class: 'vacant_land' });
    const evidence = extractLandWatchTransactionEvidence(landWatchCapture({
      scriptText: '\\"listingEvents\\":[{\\"date\\":\\"2026-08-12T00:00:00\\",\\"price\\":8415000,\\"acres\\":75.37,\\"eventTitle\\":\\"Sold\\"}]',
    }));
    expect(evidence.improved).toBeNull();
    expect(compTransactionUpdate(row, evidence).patch.propertyClass).toBeUndefined();
  });
});

describe('bounded candidate ranking', () => {
  const rows = [
    comp({ id: 1, source_url: `${LW_URL}`, acres: 75, classification: 'core' }),
    comp({ id: 2, source_url: 'https://www.landwatch.com/x/pid/2', acres: 34, classification: 'core' }),
    comp({ id: 3, source_url: 'https://www.landwatch.com/x/pid/3', acres: 74, classification: 'directional' }),
    comp({ id: 4, source_url: 'https://www.landwatch.com/x/pid/4', acres: 300, classification: 'core' }),
    comp({ id: 5, source_url: 'https://landportal.com/?property=abc', acres: 76, classification: 'core' }),
    comp({ id: 6, source_url: 'https://www.landwatch.com/x/pid/6', acres: 76, classification: 'core', sale_or_list_date: '2026-02-02' }),
    comp({ id: 7, source_url: 'https://www.landwatch.com/x/pid/7', acres: 76, classification: 'core', price_kind: 'list' }),
  ];

  it('takes only revisitable, sold, undated rows', () => {
    const ids = rankCompsForTransactionEnrichment(rows, 75.91, 10).map((c) => c.row.id);
    expect(ids).not.toContain(5); // LandPortal: no revisitable detail page in this lane
    expect(ids).not.toContain(6); // already dated
    expect(ids).not.toContain(7); // an asking price, not a sale
  });

  it('ranks in-band before out-of-band, core before directional, then by acreage closeness', () => {
    expect(rankCompsForTransactionEnrichment(rows, 75.91, 10).map((c) => c.row.id)).toEqual([1, 2, 3, 4]);
  });

  it('respects the bound', () => {
    expect(rankCompsForTransactionEnrichment(rows, 75.91, 2).map((c) => c.row.id)).toEqual([1, 2]);
    expect(rankCompsForTransactionEnrichment(rows, 75.91, 0)).toEqual([]);
  });
});

describe('geographic priority in candidate ranking', () => {
  // Same acreage relevance and same class throughout, so geography is the only
  // thing that can order these.
  const tiered = [
    comp({ id: 11, source_url: 'https://www.landwatch.com/x/pid/11', acres: 70, geo_tier: 'broader' }),
    comp({ id: 12, source_url: 'https://www.landwatch.com/x/pid/12', acres: 70, geo_tier: 'local' }),
    comp({ id: 13, source_url: 'https://www.landwatch.com/x/pid/13', acres: 70, geo_tier: '' }),
    comp({ id: 14, source_url: 'https://www.landwatch.com/x/pid/14', acres: 70, geo_tier: 'expanded' }),
  ];

  it('attempts local, then expanded, then broader, then unresolved geography', () => {
    expect(rankCompsForTransactionEnrichment(tiered, 75.91, 10).map((c) => c.row.id)).toEqual([12, 14, 11, 13]);
  });

  it('never reaches a broader-market candidate while closer ones fill the run', () => {
    const chosen = rankCompsForTransactionEnrichment(tiered, 75.91, 2);
    expect(chosen.map((c) => c.tierId)).toEqual(['local', 'expanded']);
  });

  it('prefers the closer market over the closer acreage match', () => {
    const rowsByAcres = [
      comp({ id: 21, source_url: 'https://www.landwatch.com/x/pid/21', acres: 76, geo_tier: 'broader' }),
      comp({ id: 22, source_url: 'https://www.landwatch.com/x/pid/22', acres: 30, geo_tier: 'local' }),
    ];
    expect(rankCompsForTransactionEnrichment(rowsByAcres, 75.91, 10).map((c) => c.row.id)).toEqual([22, 21]);
  });

  it('keeps geography below whether the candidate can price the subject at all', () => {
    const mixed = [
      // Local, but its own retained evidence already states a residence: it can
      // never enter the clean vacant-land set, so a dated sale would not price
      // the subject.
      comp({ id: 31, source_url: 'https://www.landwatch.com/x/pid/31', acres: 70, geo_tier: 'local', property_class: 'residential', classification: 'directional' }),
      // Local, but far outside the subject's participation band.
      comp({ id: 32, source_url: 'https://www.landwatch.com/x/pid/32', acres: 400, geo_tier: 'local' }),
      // Broader, but a clean in-band vacant-land candidate.
      comp({ id: 33, source_url: 'https://www.landwatch.com/x/pid/33', acres: 70, geo_tier: 'broader' }),
    ];
    expect(rankCompsForTransactionEnrichment(mixed, 75.91, 10).map((c) => c.row.id)).toEqual([33, 31, 32]);
  });

  it('states the tier it attempted on every candidate', () => {
    const [first] = rankCompsForTransactionEnrichment(tiered, 75.91, 1);
    expect(first.tierId).toBe('local');
    expect(first.reason).toContain('Local market');
  });
});
