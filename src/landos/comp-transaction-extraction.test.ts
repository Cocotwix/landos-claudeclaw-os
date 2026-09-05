// Redfin record-page extraction, against the page shapes actually published.
//
// The defect these pin: sixteen retained Bradford County land candidates stayed
// permanently undated — and the whole non-LandPortal lane therefore looked like
// an empty market — because extraction demanded a heading Redfin does not print
// on a record page, and never read the record's own SOLD banner.

import { describe, expect, it } from 'vitest';

import {
  extractRedfinTransactionEvidence,
  readOwnSoldBanner,
  rankCompsForTransactionEnrichment,
  compEvidenceSupportsAdmission,
} from './comp-transaction-enrichment.js';
import type { CompRow } from './comps.js';

/**
 * The real shape of the Redfin record page for `0 County Rd 241, Lake Butler`
 * (home 194963699): a "SOLD JUN 10, 2026" banner, a "Recently sold homes" strip
 * carrying OTHER parcels' sales, and a "Sale History" heading with no "for".
 */
const RECORD_PAGE = `0 County Rd 241, Lake Butler, FL 32054
SOLD JUN 10, 2026
Street View
SOLD ON JUN 2026
$30,000
1.31
acres (lot)
Beautiful cleared 1.3 acre lot adorned with fruit trees and ready for your new home. Includes a new 30x60 manufactured home pad. New survey on file.
Vacant land
Property Type
1.31 acres
Lot Size
$22,901
Price/Acres
Recently sold homes
SOLD JUL 10, 2026
$226,000
SOLD JUN 29, 2026
$47,500
SOLD JUL 17, 2026
$39,900
Sale History
Jun 10, 2026
Sold
$30,000
`;

function row(over: Partial<CompRow> = {}): CompRow {
  return {
    id: 1, deal_card_id: 90, address_desc: '0 County Rd 241, Lake Butler, FL 32054',
    source_label: 'Redfin', canonical_source: 'Redfin',
    source_url: 'https://www.redfin.com/FL/Lake-Butler/NW-County-Road-241-32054/home/194963699',
    price: 30_000, price_kind: 'sale', acres: 1.31, sale_or_list_date: '',
    status: 'market_reference', classification: '', property_class: '',
    lat: null, lng: null, distance_miles: null, geo_precision: '',
    county: 'Bradford', state: 'FL', zip: '32054',
    ...over,
  } as unknown as CompRow;
}

describe('a Redfin record page states its own sale', () => {
  it('reads the SOLD banner and the "Sale History" heading without the word "for"', () => {
    const evidence = extractRedfinTransactionEvidence({
      url: 'https://www.redfin.com/FL/Lake-Butler/NW-County-Road-241-32054/home/194963699',
      title: '0 County Rd 241, Lake Butler, FL 32054 | Redfin',
      text: RECORD_PAGE,
      scriptText: '',
    } as never);

    expect(evidence.closedSale).toBe(true);
    expect(evidence.soldDateIso).toBe('2026-06-10');
    expect(evidence.soldPrice).toBe(30_000);
    expect(evidence.acres).toBe(1.31);
    // Redfin's own Property Type is the improvement statement, and a cleared
    // lot with a manufactured-home pad is NOT a building.
    expect(evidence.improved).toBe(false);
    expect(evidence.limitation).toBeNull();
  });

  it('never attributes a neighbour sale from the "Recently sold homes" strip', () => {
    const banner = readOwnSoldBanner(RECORD_PAGE);
    expect(banner).not.toBeNull();
    // The strip's own rows are JUL 10 / JUN 29 / JUL 17 and must never win.
    expect(banner!.dateIso).toBe('2026-06-10');
    expect(banner!.price).toBe(30_000);
  });

  it('returns nothing when the only SOLD rows belong to the comparison strip', () => {
    const neighboursOnly = 'Some Lot, Lake Butler\nRecently sold homes\nSOLD JUL 10, 2026\n$226,000\n';
    expect(readOwnSoldBanner(neighboursOnly)).toBeNull();
  });
});

describe('the enrichment sufficiency guard counts only admissible evidence', () => {
  const nowMs = Date.parse('2026-09-04T00:00:00Z');
  const band = { min: 0.6, max: 2.625 };

  it('refuses to call a recent, priced, UNLOCATED record sufficient', () => {
    // This is exactly comp 1016: recent, in band, priced — and located only by
    // a ZIP-area centroid, so it can never be admitted.
    const centroidOnly = row({ id: 1016, sale_or_list_date: '2025-12-20', acres: 2.48, price: 55_900 });
    const verdict = compEvidenceSupportsAdmission(centroidOnly, { nowMs, band });
    expect(verdict.admissible).toBe(false);
    expect(verdict.missing).toContain('parcel coordinates');
    expect(verdict.missing).toContain('distance from the subject');
  });

  it('one unusable record cannot suppress enrichment of the remaining candidates', () => {
    const rows: CompRow[] = [
      // The unusable "sufficient-looking" record.
      row({ id: 1016, sale_or_list_date: '2025-12-20', acres: 2.48, price: 55_900,
        source_url: 'https://www.redfin.com/FL/Lake-Butler/9249-W-State-Road-100-32054/home/142696573' }),
      // Undated, unlocated, in band — exactly the candidates that were skipped.
      row({ id: 1022, acres: 1.31, price: 30_000 }),
      row({ id: 1023, acres: 1, price: 47_500,
        source_url: 'https://www.redfin.com/FL/Lake-Butler/9535-NW-147th-Ter-32054/home/196408203' }),
      row({ id: 1024, acres: 1.6, price: 65_000,
        source_url: 'https://www.redfin.com/FL/Lake-Butler/4727-SW-109th-Rd-32054/home/200309998' }),
    ];
    const ranked = rankCompsForTransactionEnrichment(rows, 1.5, 8, { nowMs });
    const ids = ranked.map((c) => c.row.id);
    expect(ids).toContain(1022);
    expect(ids).toContain(1023);
    expect(ids).toContain(1024);
    // 1016 is dated but UNLOCATED, so it is selectable too — for its parcel
    // point, not its date. What matters is that it no longer suppresses the
    // others: before the fix it alone declared the evidence sufficient and the
    // three undated candidates were never revisited.
    const withoutSuppression = rankCompsForTransactionEnrichment(rows, 1.5, 8, { nowMs });
    expect(withoutSuppression.length).toBeGreaterThanOrEqual(4);
  });

  it('selects undated, unlocated candidates inside the acreage band', () => {
    const ranked = rankCompsForTransactionEnrichment(
      [row({ id: 1022, acres: 1.31, price: 30_000 })], 1.5, 8, { nowMs },
    );
    expect(ranked.map((c) => c.row.id)).toEqual([1022]);
  });

  it('accepts month-level precision as a supported sale date', () => {
    const dated = row({ id: 2000, sale_or_list_date: '2026-06', acres: 1.31, price: 30_000,
      lat: 30.02, lng: -82.3, distance_miles: 4.1 });
    const verdict = compEvidenceSupportsAdmission(dated, { nowMs, band });
    expect(verdict.missing).not.toContain('sale date');
  });
});
