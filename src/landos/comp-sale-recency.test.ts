import { describe, expect, it } from 'vitest';
import {
  classifySaleRecency,
  nextSoldSearchWindow,
  recentSoldEvidenceSufficient,
  MAX_SOLD_SEARCH_WINDOW_MONTHS,
  RECENT_SALE_WINDOW_MONTHS,
  SOLD_SEARCH_WINDOW_STEPS,
} from './comp-sale-recency.js';
import { redfinLandFilterUrl } from './redfin-land-comps.js';
import { zillowSearchRoutes, zillowZipFilteredUrl } from './zillow-land-comps.js';
import { landWatchSearchUrl, normalizeLandWatchListings } from './landwatch-land-comps.js';
import { planLandPortalMapSearch, broadenLandPortalMapSearch } from './landportal-map-search.js';
import { selectRecencyWindow } from './comp-recency-window.js';
import {
  rankCompsForTransactionEnrichment,
  transactionEnrichmentRecencyVerdict,
} from './comp-transaction-enrichment.js';
import type { CompRow } from './comps.js';

// Fixed clock: the whole suite reasons about ages, never about "today".
const NOW = Date.parse('2026-08-20T00:00:00Z');
const monthsAgo = (months: number): string => {
  const d = new Date(NOW);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
};

describe('sold-comp discovery is 12-month-first, everywhere it can express a period', () => {
  it('opens on the trailing 12 months and never offers a window past 24', () => {
    expect(SOLD_SEARCH_WINDOW_STEPS).toEqual([12, 24]);
    expect(RECENT_SALE_WINDOW_MONTHS).toBe(12);
    expect(MAX_SOLD_SEARCH_WINDOW_MONTHS).toBe(24);
    expect(nextSoldSearchWindow(null, 0).nextWindowMonths).toBe(12);
  });

  it('Redfin: the default sold filter is the 1-year board, 2-year only on deliberate expansion', () => {
    expect(redfinLandFilterUrl('/city/1/TN/Franklin', { sold: true })).toContain('include=sold-1yr');
    expect(redfinLandFilterUrl('/city/1/TN/Franklin', { sold: true, dateWindowMonths: 12 })).toContain('include=sold-1yr');
    expect(redfinLandFilterUrl('/city/1/TN/Franklin', { sold: true, dateWindowMonths: 24 })).toContain('include=sold-2yr');
  });

  it('Zillow: the sold search is constructed on the 12-month board by default', () => {
    const subject = { zip: '37062', state: 'TN', city: 'Fairview', lat: 35.98, lng: -87.12, mode: 'sold' as const };
    // Both surfaces that carry a filterState: the coordinates route and the
    // resolved-ZIP filtered URL the fetch loop follows up with.
    const coordinates = decodeURIComponent(zillowSearchRoutes(subject).find((r) => r.kind === 'coordinates')!.url);
    expect(coordinates).toContain('"doz":{"value":"12m"}');
    expect(coordinates).not.toContain('24m');
    expect(decodeURIComponent(zillowZipFilteredUrl('/homes/37062', subject))).toContain('"doz":{"value":"12m"}');

    const expanded = decodeURIComponent(
      zillowSearchRoutes({ ...subject, dateWindowMonths: 24 }).find((r) => r.kind === 'coordinates')!.url,
    );
    expect(expanded).toContain('"doz":{"value":"24m"}');
  });

  it('LandPortal: the sold map search asks for one year first and broadens to two', () => {
    const plan = planLandPortalMapSearch(75.91, 'sold_land');
    expect(plan.periodDays).toBe(365);
    const wider = broadenLandPortalMapSearch(plan);
    expect(wider?.periodDays).toBe(730);
    // There is no third, deeper step for normal current-FMV discovery.
    expect(wider && broadenLandPortalMapSearch(wider)).toBeNull();
  });

  it('never applies a price filter, in any source, in any pass', () => {
    const redfin = redfinLandFilterUrl('/city/1/TN/Franklin', { sold: true, dateWindowMonths: 24 });
    expect(redfin).not.toMatch(/price|min-price|max-price/i);
    const landwatch = landWatchSearchUrl('TN', 'Williamson', { acreageSegment: 'acres-51-100', sold: true });
    expect(landwatch).not.toMatch(/price/i);
    const zillow = zillowSearchRoutes({ zip: '37062', state: 'TN', city: 'Fairview', lat: 35.98, lng: -87.12, mode: 'sold' })
      .map((r) => decodeURIComponent(r.url)).join(' ');
    expect(zillow).not.toMatch(/"price"|monthlyPayment|"mp"\s*:/);
  });
});

describe('progressive expansion is a deliberate response to insufficiency', () => {
  it('does not expand to 13–24 months when the recent set is already sufficient', () => {
    const step = nextSoldSearchWindow(12, 5);
    expect(recentSoldEvidenceSufficient(5)).toBe(true);
    expect(step.nextWindowMonths).toBeNull();
    expect(step.reason).toContain('no older window was searched');
  });

  it('expands to 24 months, and states why, when the recent set is thin', () => {
    const step = nextSoldSearchWindow(12, 1);
    expect(step.nextWindowMonths).toBe(24);
    expect(step.reason).toContain('12-month search produced 1 qualifying closed sale');
    expect(step.reason).toContain('Expanded to 24 months');
  });

  it('stops after 24 months however thin the evidence still is', () => {
    const step = nextSoldSearchWindow(24, 0);
    expect(step.nextWindowMonths).toBeNull();
    expect(step.reason).toContain('stops at 24 months');
  });
});

describe('recency classification of a single sale', () => {
  it('separates recent, expanded recency, historical and undated', () => {
    expect(classifySaleRecency(monthsAgo(5), NOW).state).toBe('recent');
    expect(classifySaleRecency(monthsAgo(19), NOW).state).toBe('expanded_recency');
    expect(classifySaleRecency('2013-01-04', NOW).state).toBe('historical');
    expect(classifySaleRecency(null, NOW).state).toBe('unestablished');
  });

  it('never lets a historical or undated sale count as current FMV evidence', () => {
    expect(classifySaleRecency('2013-01-04', NOW).currentFmvEligible).toBe(false);
    expect(classifySaleRecency('2020-06-12', NOW).currentFmvEligible).toBe(false);
    expect(classifySaleRecency(null, NOW).currentFmvEligible).toBe(false);
    expect(classifySaleRecency(monthsAgo(5), NOW).currentFmvEligible).toBe(true);
  });

  it('reads an old sale in years, not in a hundred-and-fifty-month figure', () => {
    const ancient = classifySaleRecency('2013-01-04', NOW);
    expect(ancient.label).toBe('Historical sale — not current FMV');
    expect(ancient.detail).toContain('13.6 years ago');
    expect(classifySaleRecency(monthsAgo(19), NOW).detail).toContain('19 months ago');
  });
});

describe('an undated LandWatch "Sold" card is fallback context, not a current comp', () => {
  it('leaves every normalized LandWatch sold row recency-unqualified', () => {
    const rows = normalizeLandWatchListings([
      { address: 'North Lick Creek Road, Franklin, TN', price: 500_000, acres: 99, soldLabel: true, residential: false, url: 'https://www.landwatch.com/pid/1', remark: null },
    ], 'Williamson');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('sold');
    expect(rows[0].soldDate).toBeNull();
    expect(rows[0].recencyState).toBe('unestablished');
    expect(rows[0].recencyQualified).toBe(false);
  });

  it('gives an undated sale its own bucket, never "sold before the cutoff"', () => {
    const selection = selectRecencyWindow([
      { key: 'undated', dateIso: null, acres: 80, credible: true },
      { key: 'recent', dateIso: monthsAgo(4), acres: 80, credible: true },
      { key: 'ancient', dateIso: '2013-01-04', acres: 80, credible: true },
    ], 75.91, NOW);
    expect(selection.bucketByKey.undated).toBe('recency_unverified');
    expect(selection.bucketByKey.ancient).toBe('historical_context');
    expect(selection.recencyUnverified).toBe(1);
    expect(selection.explanation.join(' ')).toContain('publishes NO sale date');
  });

  it('keeps the undated record out of the strict FMV set entirely', () => {
    const selection = selectRecencyWindow([
      { key: 'undated', dateIso: null, acres: 80, credible: true },
    ], 75.91, NOW);
    expect(selection.valuationSetCount).toBe(0);
  });
});

// ── Enrichment-selection guard ─────────────────────────────────────────────

const compRow = (over: Record<string, unknown>): CompRow => ({
  id: 1,
  deal_card_id: 89,
  address_desc: '5956 N Lick Creek Road, Franklin, TN, 37064',
  acres: 100,
  price: 1_395_000,
  price_kind: 'sale',
  price_per_acre: 13_950,
  sale_or_list_date: null,
  source_url: 'https://www.landwatch.com/tennessee/pid/123456',
  classification: 'core',
  property_class: 'vacant_land',
  geo_tier: 'expanded',
  source_attributions_json: '[]',
  ...over,
} as unknown as CompRow);

describe('transaction enrichment never knowingly spends a slot on an ancient sale', () => {
  it('refuses a sale already known to be older than 24 months', () => {
    const verdict = transactionEnrichmentRecencyVerdict(compRow({ sale_or_list_date: '2013-01-04' }), NOW, false);
    expect(verdict.selectable).toBe(false);
    expect(verdict.reason).toContain('older than 24 months');
    expect(verdict.reason).toContain('never selected for current-FMV transaction enrichment');
  });

  it('defers a 13-to-24-month sale while the recent evidence is sufficient', () => {
    const row = compRow({ sale_or_list_date: monthsAgo(19) });
    expect(transactionEnrichmentRecencyVerdict(row, NOW, true).reason).toContain('deferred');
    expect(transactionEnrichmentRecencyVerdict(row, NOW, true).selectable).toBe(false);
  });

  it('attempts an undated candidate only when the current set actually needs evidence', () => {
    const undated = compRow({ sale_or_list_date: null });
    expect(transactionEnrichmentRecencyVerdict(undated, NOW, false).selectable).toBe(true);
    const sufficient = transactionEnrichmentRecencyVerdict(undated, NOW, true);
    expect(sufficient.selectable).toBe(false);
    expect(sufficient.reason).toContain('already sufficient');
  });

  it('ranks only undated candidates, and only against an insufficient recent set', () => {
    const rows = [
      compRow({ id: 1, sale_or_list_date: null }),
      compRow({ id: 2, sale_or_list_date: '2013-01-04', source_url: 'https://www.landwatch.com/tennessee/pid/2' }),
      compRow({ id: 3, sale_or_list_date: monthsAgo(19), source_url: 'https://www.landwatch.com/tennessee/pid/3' }),
    ];
    const picked = rankCompsForTransactionEnrichment(rows, 75.91, 8, { nowMs: NOW, recentEvidenceSufficient: false });
    expect(picked.map((c) => c.row.id)).toEqual([1]);

    const none = rankCompsForTransactionEnrichment(rows, 75.91, 8, { nowMs: NOW, recentEvidenceSufficient: true });
    expect(none).toHaveLength(0);
  });

  it('measures sufficiency from the rows themselves when the caller does not state it', () => {
    const recent = (id: number) => compRow({
      id, sale_or_list_date: monthsAgo(3), source_url: `https://www.landwatch.com/tennessee/pid/${id}`,
    });
    const withThinRecent = [compRow({ id: 1, sale_or_list_date: null }), recent(2)];
    expect(rankCompsForTransactionEnrichment(withThinRecent, 75.91, 8, { nowMs: NOW }).map((c) => c.row.id)).toEqual([1]);

    const withSufficientRecent = [compRow({ id: 1, sale_or_list_date: null }), recent(2), recent(3), recent(4), recent(5), recent(6)];
    expect(rankCompsForTransactionEnrichment(withSufficientRecent, 75.91, 8, { nowMs: NOW })).toHaveLength(0);
  });
});
