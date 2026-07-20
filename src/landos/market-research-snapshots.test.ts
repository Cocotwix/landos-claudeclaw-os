// Market Research quarterly snapshot store — regression contract.
//
// Covers the retained-research guarantees: State→County→ZIP hierarchy,
// snapshot/filter isolation, immutability (no overwrite by later collections),
// idempotent/no-duplicate writes, no fabricated zeros, quarter-over-quarter
// comparison rules, the audited correction flow, and the baseline import from
// the already-retained Market Matrix LandPortal rows.

import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestLandosDb, getLandosDb } from './db.js';
import {
  fixedInitialFilters, marketFilterKey, quarterForDate,
  ensureMrGeography, getOrCreateMrSnapshot, recordMrMetrics, listMrRows,
  listMrSnapshots, priorMrSnapshot, getMrGeoSummary, correctMrMetric,
  importMatrixBaseline, validateMrGeography,
  type MrMetricInput, type MarketResearchFilters,
} from './market-research-snapshots.js';
import { ingestMarketSnapshots } from './market-matrix-store.js';
import { computeMrGaps, mapAjaxItem, mapWideDump, pendingZipCountyFips, zipShortfalls, type WideDump } from './market-research-collector.js';
import { backfillMrStructureCounts, fillMissingMrMetrics, recordMrZipMembership } from './market-research-snapshots.js';

const PROVIDER = 'LandPortal Market Research (Drill Deep)';
const SRC = 'https://landportal.com/market-research/';

function input(partial: Partial<MrMetricInput> & { geography: MrMetricInput['geography'] }): MrMetricInput {
  return { metrics: {}, provider: PROVIDER, sourceRef: SRC, observedAt: '2026-07-19T00:00:00.000Z', ...partial };
}

beforeEach(() => { _initTestLandosDb(); });

describe('geography hierarchy', () => {
  it('links State → County → ZIP through stable parent keys and canonical FIPS state', () => {
    const st = ensureMrGeography({ level: 'state', state: 'GA', name: 'Georgia' })!;
    const co = ensureMrGeography({ level: 'county', state: 'SC', fips: '13113', name: 'Fayette County' })!; // border grouping: FIPS wins
    const zp = ensureMrGeography({ level: 'zip', state: 'GA', zip: '30214', fips: '13113' })!;
    expect(st.parentKey).toBe('us');
    expect(co.state).toBe('GA');                 // canonical state from FIPS prefix, not the grouping
    expect(co.parentKey).toBe('state:GA');
    expect(zp.parentKey).toBe('county:13113');
  });

  it('rejects broken identity instead of fabricating it', () => {
    expect(validateMrGeography({ level: 'county', state: 'GA', fips: '13' })).toBeNull();
    expect(validateMrGeography({ level: 'zip', state: 'GA', zip: 'ABCDE' })).toBeNull();
    expect(validateMrGeography({ level: 'state', state: 'ZZ' })).toBeNull();
  });
});

describe('snapshot isolation + immutability', () => {
  const filters = fixedInitialFilters('2-5');

  it('keeps snapshots isolated by quarter and exact filter set', () => {
    const q3 = getOrCreateMrSnapshot({ quarter: '2026-Q3', filters, provider: PROVIDER });
    const q3again = getOrCreateMrSnapshot({ quarter: '2026-Q3', filters, provider: PROVIDER });
    const q4 = getOrCreateMrSnapshot({ quarter: '2026-Q4', filters, provider: PROVIDER });
    const otherBand = getOrCreateMrSnapshot({ quarter: '2026-Q3', filters: fixedInitialFilters('5-10'), provider: PROVIDER });
    expect(q3again.id).toBe(q3.id);
    expect(q4.id).not.toBe(q3.id);
    expect(otherBand.id).not.toBe(q3.id);
    expect(marketFilterKey(filters)).not.toBe(marketFilterKey(fixedInitialFilters('5-10')));
  });

  it('never overwrites a retained metric and never duplicates a geography (idempotent resume)', () => {
    const snap = getOrCreateMrSnapshot({ quarter: '2026-Q3', filters, provider: PROVIDER });
    const first = recordMrMetrics(snap.id, [input({
      geography: { level: 'state', state: 'GA' }, metrics: { salesCount: 100, daysOnMarket: 90 },
    })]);
    expect(first.written).toBe(1);

    // A resumed/repeat collection returns a DIFFERENT value — retained row wins.
    const second = recordMrMetrics(snap.id, [input({
      geography: { level: 'state', state: 'GA' }, metrics: { salesCount: 999 },
    })]);
    expect(second.written).toBe(0);
    expect(second.preserved).toBe(1);

    const rows = listMrRows(snap.id, 'state');
    expect(rows).toHaveLength(1);
    expect(rows[0].metrics.salesCount).toBe(100);
  });

  it('skips rows with no returned values — an uncollected geography is absent, never zero', () => {
    const snap = getOrCreateMrSnapshot({ quarter: '2026-Q3', filters, provider: PROVIDER });
    const res = recordMrMetrics(snap.id, [input({ geography: { level: 'state', state: 'TX' }, metrics: {} })]);
    expect(res.skipped).toBe(1);
    expect(listMrRows(snap.id, 'state')).toHaveLength(0);
  });

  it('allows changes only through the audited correction flow', () => {
    const snap = getOrCreateMrSnapshot({ quarter: '2026-Q3', filters, provider: PROVIDER });
    recordMrMetrics(snap.id, [input({ geography: { level: 'state', state: 'GA' }, metrics: { salesCount: 100 } })]);
    expect(() => correctMrMetric({ snapshotId: snap.id, geoKey: 'state:GA', metrics: { salesCount: 101 }, reason: '  ', correctedBy: 'tyler' })).toThrow();
    const ok = correctMrMetric({ snapshotId: snap.id, geoKey: 'state:GA', metrics: { salesCount: 101 }, reason: 'provider display was re-verified', correctedBy: 'tyler' });
    expect(ok).toBe(true);
    expect(listMrRows(snap.id, 'state')[0].metrics.salesCount).toBe(101);
    const audit = getLandosDb().prepare('SELECT COUNT(*) n FROM landos_mr_correction').get() as { n: number };
    expect(audit.n).toBe(1);
  });
});

describe('quarter-over-quarter comparison', () => {
  const filters = fixedInitialFilters('2-5');

  it('compares only snapshots with the same exact filter set, labeling the prior quarter', () => {
    const q2 = getOrCreateMrSnapshot({ quarter: '2026-Q2', filters, provider: PROVIDER, collectedAt: '2026-04-05T00:00:00Z' });
    recordMrMetrics(q2.id, [input({ geography: { level: 'state', state: 'GA' }, metrics: { salesCount: 90, daysOnMarket: 100 } })]);
    // A DIFFERENT band in an earlier quarter must never become the comparison.
    const q2other = getOrCreateMrSnapshot({ quarter: '2026-Q2', filters: fixedInitialFilters('5-10'), provider: PROVIDER });
    recordMrMetrics(q2other.id, [input({ geography: { level: 'state', state: 'GA' }, metrics: { salesCount: 5 } })]);

    const q3 = getOrCreateMrSnapshot({ quarter: '2026-Q3', filters, provider: PROVIDER });
    recordMrMetrics(q3.id, [input({ geography: { level: 'state', state: 'GA' }, metrics: { salesCount: 120 } })]);

    const prior = priorMrSnapshot(q3);
    expect(prior?.id).toBe(q2.id);
    const row = listMrRows(q3.id, 'state')[0];
    expect(row.prior?.quarter).toBe('2026-Q2');
    expect(row.prior?.metrics.salesCount).toBe(90);
  });

  it('shows no trend when no matching prior snapshot exists', () => {
    const q3 = getOrCreateMrSnapshot({ quarter: '2026-Q3', filters, provider: PROVIDER });
    recordMrMetrics(q3.id, [input({ geography: { level: 'state', state: 'GA' }, metrics: { salesCount: 120 } })]);
    expect(priorMrSnapshot(q3)).toBeNull();
    expect(listMrRows(q3.id, 'state')[0].prior).toBeNull();

    const summary = getMrGeoSummary(q3.id, 'state:GA');
    expect(summary?.priorSnapshot).toBeNull();
    expect(summary?.row.prior).toBeNull();
  });
});

describe('baseline import from retained Market Matrix rows', () => {
  it('attaches sold 2–5 LandPortal rows as quarterly snapshots, idempotently, without touching the matrix', () => {
    // Retained matrix data (the SINGLE validated matrix pipeline).
    const res = ingestMarketSnapshots([
      {
        geography: { level: 'state', state: 'GA' }, acreageBand: '2-5', side: 'sold', period: '2026-Q3',
        confidence: 'high', metrics: { salesCount: 2000, daysOnMarket: 120 },
        provenance: { provider: 'browser_agent:landportal', sourceRef: SRC, extractionTimestamp: '2026-07-18T07:59:53.595Z', agentRunId: 'r1' },
      },
      {
        geography: { level: 'county', state: 'GA', fips: '13113', county: 'Fayette' }, acreageBand: '2-5', side: 'sold', period: '2026-Q3',
        confidence: 'high', metrics: { salesCount: 17, medianPricePerAcre: 90000 },
        provenance: { provider: 'browser_agent:landportal', sourceRef: SRC, extractionTimestamp: '2026-07-18T07:59:53.595Z', agentRunId: 'r1' },
      },
      { // for_sale row must NOT be imported (filter mismatch with Sold research)
        geography: { level: 'county', state: 'GA', fips: '13089', county: 'DeKalb' }, acreageBand: '2-5', side: 'for_sale', period: '2026-Q3',
        confidence: 'high', metrics: { listingCount: 40 },
        provenance: { provider: 'browser_agent:landportal', sourceRef: SRC, extractionTimestamp: '2026-07-18T07:59:53.595Z', agentRunId: 'r1' },
      },
    ]);
    expect(res.accepted).toBe(3);

    const imported = importMatrixBaseline();
    expect(imported.written).toBe(2);

    const snaps = listMrSnapshots();
    expect(snaps).toHaveLength(1);
    expect(snaps[0].quarter).toBe('2026-Q3');
    expect(snaps[0].counts).toEqual({ state: 1, county: 1, zip: 0 });
    expect(snaps[0].collectedAt).toBe('2026-07-18T07:59:53.595Z');

    // Idempotent: a second import writes nothing new.
    expect(importMatrixBaseline().written).toBe(0);
    // Source matrix untouched.
    const matrixCount = getLandosDb().prepare('SELECT COUNT(*) n FROM landos_market_snapshot').get() as { n: number };
    expect(matrixCount.n).toBe(3);

    const county = listMrRows(snaps[0].id, 'county', 'state:GA');
    expect(county).toHaveLength(1);
    expect(county[0].name).toBe('Fayette County');
    expect(county[0].sourceRef).toBe(SRC);
    expect(county[0].observedAt).toBe('2026-07-18T07:59:53.595Z');
  });
});

describe('collector wide-dump mapping (pure)', () => {
  const HEADERS = ['', 'Counties', 'Zip Codes', 'Count', 'DOM', 'STR', 'AR', 'MoS', 'Population', 'Density', 'Growth', 'MP', 'PPA', ''];

  function dump(): WideDump {
    return {
      headers: HEADERS,
      rows: [
        { level: 'states', state: 'GA', fips: '', county: '', zip: '', cells: ['Georgia', '159', '702', '2,143', '133', '84%', '45.51%', '13.19', '11,029,227', '191.6', '0.94%', '$115,000', '$32,270', 'Open'] },
        { level: 'counties', state: 'SC', fips: '13257', county: 'Stephens', zip: '', cells: ['Stephens', '', '5', '17', '142', '70.83%', '41.46%', '17.18', '24,420', '47.7', '0.19%', '$39,896', '$13,212', 'Open'] },
        { level: 'zips', state: 'GA', fips: '13113', county: 'Fayette', zip: '30214', cells: ['30214', '', '', '9', '', '', '', '', '', '', '', '$250,000', '$101,320', 'Open'] },
        // exact duplicate grid row must be dropped
        { level: 'zips', state: 'GA', fips: '13113', county: 'Fayette', zip: '30214', cells: ['30214', '', '', '9', '', '', '', '', '', '', '', '$250,000', '$101,320', 'Open'] },
      ],
    };
  }

  it('maps displayed values faithfully — structural counts by header, metrics by verified trailing columns', () => {
    const mapped = mapWideDump(dump(), { sourceRef: SRC, observedAt: '2026-07-19T00:00:00Z' });
    expect(mapped.headersVerified).toBe(true);
    expect(mapped.duplicatesDropped).toBe(1);
    expect(mapped.inputs).toHaveLength(3);

    const ga = mapped.inputs[0];
    expect(ga.geography).toMatchObject({ level: 'state', state: 'GA' });
    expect(ga.countyCount).toBe(159);
    expect(ga.zipCount).toBe(702);
    expect(ga.metrics.salesCount).toBe(2143);
    expect(ga.metrics.medianPricePerAcre).toBe(32270);

    // Border county shown under SC grouping is attributed to GA via FIPS.
    const stephens = mapped.inputs[1];
    expect(stephens.geography).toMatchObject({ level: 'county', state: 'GA', fips: '13257' });

    // Blank cells stay unknown — never zero.
    const zip = mapped.inputs[2];
    expect(zip.metrics.daysOnMarket).toBeUndefined();
    expect(zip.metrics.salesCount).toBe(9);
    expect(zip.geography).toMatchObject({ level: 'zip', zip: '30214', fips: '13113' });
  });

  it('refuses to map metrics when headers do not verify (no silent mis-mapping)', () => {
    const bad = dump();
    bad.headers = ['', 'Counties', 'Zip Codes', 'DOM', 'Count', 'STR', 'AR', 'MoS', 'Population', 'Density', 'Growth', 'MP', 'PPA', ''];
    const mapped = mapWideDump(bad, { sourceRef: SRC, observedAt: '2026-07-19T00:00:00Z' });
    expect(mapped.headersVerified).toBe(false);
    for (const i of mapped.inputs) expect(Object.keys(i.metrics)).toHaveLength(0);
  });

  it('round-trips into the snapshot store without duplicate geography metrics', () => {
    const snap = getOrCreateMrSnapshot({ quarter: quarterForDate(), filters: fixedInitialFilters('2-5') as MarketResearchFilters, provider: PROVIDER });
    const mapped = mapWideDump(dump(), { sourceRef: SRC, observedAt: '2026-07-19T00:00:00Z' });
    const w1 = recordMrMetrics(snap.id, mapped.inputs);
    expect(w1.written).toBe(3);
    const w2 = recordMrMetrics(snap.id, mapped.inputs);
    expect(w2.written).toBe(0);
    expect(w2.preserved).toBe(3);
    const total = getLandosDb().prepare('SELECT COUNT(*) n FROM landos_mr_metric').get() as { n: number };
    expect(total.n).toBe(3);
  });
});

describe('resumable ZIP coverage across page sessions', () => {
  const filters = fixedInitialFilters('2-5');

  it('pendingZipCountyFips reports retained counties not yet ZIP-expanded, per state', () => {
    const snap = getOrCreateMrSnapshot({ quarter: '2026-Q3', filters, provider: PROVIDER });
    recordMrMetrics(snap.id, [
      input({ geography: { level: 'county', state: 'GA', fips: '13001', name: 'Appling County' }, metrics: { salesCount: 4 } }),
      input({ geography: { level: 'county', state: 'GA', fips: '13003', name: 'Atkinson County' }, metrics: { salesCount: 2 } }),
      input({ geography: { level: 'county', state: 'AL', fips: '01001', name: 'Autauga County' }, metrics: { salesCount: 3 } }),
    ]);
    // Retained store (not the live page session) is the source of truth, so a
    // resumed run can finish states whose rows were expanded in an EARLIER run.
    expect(pendingZipCountyFips(snap.id, 'GA', new Set()).sort()).toEqual(['13001', '13003']);
    expect(pendingZipCountyFips(snap.id, 'GA', new Set(['13001']))).toEqual(['13003']);
    expect(pendingZipCountyFips(snap.id, 'GA', new Set(['13001', '13003']))).toEqual([]);
    expect(pendingZipCountyFips(snap.id, 'AL', new Set())).toEqual(['01001']);
    expect(pendingZipCountyFips(snap.id, 'TX', new Set())).toEqual([]);
  });

  it('collector completion requires county AND zip coverage (source contract)', () => {
    const fs = require('fs');
    const src = fs.readFileSync('src/landos/market-research-collector.ts', 'utf8');
    // The run may only complete when no state awaits county expansion AND no
    // retained county awaits ZIP expansion.
    expect(src).toContain('remainingStates === 0 && remainingZipCounties === 0');
    // ZIP phase re-expands the state row so counties from earlier runs' page
    // sessions remain reachable.
    expect(src.indexOf('pendingZipCountyFips(snap.id, st, doneSet)')).toBeGreaterThan(-1);
    // The retry wrapper must delegate to the REAL page.evaluate — a blanket
    // rename once made it call itself and every in-page read stack-overflowed.
    expect(src).toContain('page.evaluate<T>(fn, ...args),');
    expect(src).not.toContain('return await ev<T>(fn, ...args)');
    // ...and each attempt must race a LOCAL timeout: storm-wedged pages hang
    // CDP calls indefinitely without rejecting.
    expect(src).toContain("in-page call hang (>90s)");
  });
});

describe('audited add-only gap fill', () => {
  const filters = fixedInitialFilters('2-5');

  it('fills only ABSENT metrics, never overwrites, and writes an audit entry', () => {
    const snap = getOrCreateMrSnapshot({ quarter: '2026-Q3', filters, provider: PROVIDER });
    recordMrMetrics(snap.id, [
      input({ geography: { level: 'zip', state: 'SC', zip: '29638', fips: '45001' }, metrics: { salesCount: 2, medianPrice: 33792 } }),
    ]);
    const res = fillMissingMrMetrics({
      snapshotId: snap.id, geoKey: 'zip:29638',
      metrics: { salesCount: 99, daysOnMarket: 54, populationDensity: 54.9 },  // salesCount MUST NOT change
      sourceRef: SRC, observedAt: '2026-07-19T13:00:00.000Z',
    });
    expect(res.filled.sort()).toEqual(['daysOnMarket', 'populationDensity']);
    const rows = listMrRows(snap.id, 'zip', 'county:45001');
    const m = rows.find((r) => r.zip === '29638')!.metrics;
    expect(m.salesCount).toBe(2);            // retained value untouched
    expect(m.medianPrice).toBe(33792);       // retained value untouched
    expect(m.daysOnMarket).toBe(54);         // absent value added
    const db = getLandosDb();
    const audit = db.prepare('SELECT reason, corrected_by FROM landos_mr_correction ORDER BY id DESC LIMIT 1').get() as { reason: string; corrected_by: string };
    expect(audit.corrected_by).toBe('collectMarketGapFill');
    expect(audit.reason).toContain('gap fill');
    expect(audit.reason).toContain('daysOnMarket');
  });

  it('is a no-op (no audit) when nothing is missing or the geo is unknown', () => {
    const snap = getOrCreateMrSnapshot({ quarter: '2026-Q3', filters, provider: PROVIDER });
    recordMrMetrics(snap.id, [
      input({ geography: { level: 'zip', state: 'SC', zip: '29620', fips: '45001' }, metrics: { salesCount: 6 } }),
    ]);
    expect(fillMissingMrMetrics({ snapshotId: snap.id, geoKey: 'zip:29620', metrics: { salesCount: 7 }, sourceRef: SRC, observedAt: 'now' }).filled).toEqual([]);
    expect(fillMissingMrMetrics({ snapshotId: snap.id, geoKey: 'zip:99999', metrics: { salesCount: 7 }, sourceRef: SRC, observedAt: 'now' }).filled).toEqual([]);
    const db = getLandosDb();
    expect((db.prepare('SELECT COUNT(*) n FROM landos_mr_correction').get() as { n: number }).n).toBe(0);
  });

  it('maps LandPortal ajax payload items with display-faithful null/zero rules', () => {
    const meta = { sourceRef: SRC, observedAt: '2026-07-19T18:00:00.000Z' };
    // County item, real sales: full precision retained (rounded to 2dp).
    const county = mapAjaxItem({ state: 'GA', fips: 13001, county: 'Appling', zips: 6, properties: 7, median_price: 27488, median_ppa: 11364, avg_dom: 79.03125, sell_rate: 116.67, month_of_supply: 10.43, absorption: 53.85, population: 18493, population_density: 36.09, population_growth: -0.09 }, meta)!;
    expect(county.geography).toEqual({ level: 'county', state: 'GA', fips: '13001', name: 'Appling County' });
    expect(county.zipCount).toBe(6);
    expect(county.metrics.daysOnMarket).toBe(79.03);
    expect(county.metrics.salesCount).toBe(7);
    // Zero-sale county: provider filler zeros for price/dom must NOT be
    // fabricated into values; explicit nulls stay absent; displayed zeros and
    // population stay.
    const dead = mapAjaxItem({ state: 'DE', fips: 24015, county: 'Cecil', zips: 0, properties: 0, median_price: 0, median_ppa: 0, avg_dom: 0, sell_rate: null, month_of_supply: null, absorption: null, population: 104960, population_density: 251.1, population_growth: 1.54 }, meta)!;
    expect(dead.metrics.salesCount).toBe(0);
    expect(dead.metrics.medianPrice).toBeUndefined();
    expect(dead.metrics.daysOnMarket).toBeUndefined();
    expect(dead.metrics.sellThroughRate).toBeUndefined();   // null → absent
    expect(dead.metrics.population).toBe(104960);
    // Zero-sale ZIP with displayed zero rates: 0 is a DISPLAYED value → kept.
    const zip = mapAjaxItem({ fips: '10005', city_name: 'BETHANY BEACH', state: 'DE', county: 'Sussex', zip: '19930', properties: 0, median_price: null, median_ppa: null, avg_dom: null, sell_rate: 0, month_of_supply: 0, absorption: 0, population: 3014, population_density: 502.33, population_growth: 7.68 }, meta)!;
    expect(zip.geography).toEqual({ level: 'zip', state: 'DE', zip: '19930', fips: '10005' });
    expect(zip.metrics.sellThroughRate).toBe(0);
    expect(zip.metrics.medianPrice).toBeUndefined();
    expect(mapAjaxItem({ county: 'NoState' }, meta)).toBeNull();
  });

  it('backfills structural counts NULL-only and proves ZIP shortfalls from declared counts', () => {
    const snap = getOrCreateMrSnapshot({ quarter: '2026-Q3', filters, provider: PROVIDER });
    recordMrMetrics(snap.id, [
      input({ geography: { level: 'county', state: 'GA', fips: '13257', name: 'Stephens County' }, metrics: { salesCount: 3 } }),
      input({ geography: { level: 'zip', state: 'GA', zip: '30553', fips: '13257' }, metrics: { salesCount: 1 } }),
    ]);
    // Backfill fills only NULL cells...
    expect(backfillMrStructureCounts({ snapshotId: snap.id, geoKey: 'county:13257', zipCount: 4 })).toBe(true);
    // ...and never changes a retained count.
    expect(backfillMrStructureCounts({ snapshotId: snap.id, geoKey: 'county:13257', zipCount: 99 })).toBe(false);
    const row = listMrRows(snap.id, 'county', 'state:GA').find((r) => r.fips === '13257')!;
    expect(row.zipCount).toBe(4);
    // Declared 4 vs 1 retained ZIP row → provable shortfall.
    expect(zipShortfalls(snap.id, 'GA')).toEqual([{ fips: '13257', name: 'Stephens County', declared: 4, retained: 1 }]);
    recordMrMetrics(snap.id, ['30557', '30538', '30577'].map((z) => input({ geography: { level: 'zip', state: 'GA', zip: z, fips: '13257' }, metrics: { salesCount: 0, population: 100 } })));
    expect(zipShortfalls(snap.id, 'GA')).toEqual([]);
  });

  it('renders cross-county ZIPs under every provider-listed county via membership', () => {
    const snap = getOrCreateMrSnapshot({ quarter: '2026-Q3', filters, provider: PROVIDER });
    // 30290 canonically parents to Fayette (13113); LandPortal ALSO lists it
    // under Muscogee-like neighbor 13215. Without membership the neighbor's
    // county page renders nothing — the owner-visible "missing ZIPs" bug.
    recordMrMetrics(snap.id, [
      input({ geography: { level: 'county', state: 'GA', fips: '13215', name: 'Muscogee County' }, metrics: { salesCount: 2 } }),
      input({ geography: { level: 'zip', state: 'GA', zip: '30290', fips: '13113' }, metrics: { salesCount: 1 } }),
    ]);
    backfillMrStructureCounts({ snapshotId: snap.id, geoKey: 'county:13215', zipCount: 1 });
    expect(listMrRows(snap.id, 'zip', 'county:13215')).toHaveLength(0);
    expect(zipShortfalls(snap.id, 'GA')).toEqual([{ fips: '13215', name: 'Muscogee County', declared: 1, retained: 0 }]);
    expect(recordMrZipMembership([{ zip: '30290', fips: '13215' }], 'landportal-payload')).toBe(1);
    expect(recordMrZipMembership([{ zip: '30290', fips: '13215' }], 'landportal-payload')).toBe(0); // idempotent
    const rows = listMrRows(snap.id, 'zip', 'county:13215');
    expect(rows.map((r) => r.zip)).toEqual(['30290']);
    // Canonical parent listing unchanged; shortfall resolved by membership.
    expect(listMrRows(snap.id, 'zip', 'county:13113').map((r) => r.zip)).toEqual(['30290']);
    expect(zipShortfalls(snap.id, 'GA')).toEqual([]);
  });

  it('computeMrGaps reports absent metrics per state with the county rows to open', () => {
    const snap = getOrCreateMrSnapshot({ quarter: '2026-Q3', filters, provider: PROVIDER });
    recordMrMetrics(snap.id, [
      input({ geography: { level: 'state', state: 'SC', name: 'South Carolina' }, metrics: { salesCount: 1719, daysOnMarket: 91, sellThroughRate: 89, absorptionRate: 47, monthsOfSupply: 13, population: 5296225, populationDensity: 165, populationGrowth: 4, medianPrice: 85056, medianPricePerAcre: 27008 } }),
      input({ geography: { level: 'county', state: 'SC', fips: '45001', name: 'Abbeville County' }, metrics: { salesCount: 19 } }),
      input({ geography: { level: 'zip', state: 'SC', zip: '29638', fips: '45001' }, metrics: { salesCount: 2, daysOnMarket: 54 } }),
    ]);
    const gaps = computeMrGaps(snap.id);
    expect(gaps.total).toBe(2);                       // complete state row is NOT a gap
    const sc = gaps.byState.get('SC')!;
    expect(sc.geos.map((g) => g.geoKey).sort()).toEqual(['county:45001', 'zip:29638']);
    expect([...sc.countiesToOpen]).toEqual(['45001']);
    expect(sc.geos.find((g) => g.geoKey === 'zip:29638')!.missing).toContain('monthsOfSupply');
  });
});
