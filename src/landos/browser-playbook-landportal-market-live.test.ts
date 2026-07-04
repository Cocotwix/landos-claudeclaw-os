import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestLandosDb } from './db.js';
import { buildRawTableFromDump, type RawRowDump } from './browser-playbook-landportal-market-live.js';
import { extractMarketPayloads, verifyMetricHeaders } from './browser-playbook-landportal-market.js';
import { ingestMarketSnapshots, getCountyDrilldown, listReviewQueue, listFlaggedSnapshots } from './market-matrix-store.js';
import { validateMarketSnapshot } from './market-matrix.js';
import type { PlaybookProvenance } from './browser-agent.js';

// Real row shapes captured from a LIVE LandPortal Drill Deep extraction (SC,
// Sold/Land/1yr/2–5). The trailing 10 cells are [Count,DOM,STR,AR,MoS,Population,
// Density,Growth,MP,PPA]; identity comes from LandPortal's data-* attributes.
// The Barnwell row carries STR 122.95% — LandPortal reports sell-through that can
// exceed 100%, which the Market Matrix validator (0–100) must REJECT with a reason
// (never silently repaired). This locks in the real extraction shape.
const DUMP: { headers: string[]; rows: RawRowDump[] } = {
  headers: ['Count', 'DOM', 'STR', 'AR', 'MoS', 'Population', 'Density', 'Growth', 'MP', 'PPA'],
  rows: [
    { level: 'states', state: 'SC', fips: '', county: '', zip: '', metrics: ['1,719', '91', '89.62%', '47.26%', '13.58', '5,296,225', '165.4', '4.28%', '$85,056', '$27,008'] },
    { level: 'counties', state: 'SC', fips: '45001', county: 'Abbeville', zip: '', metrics: ['19', '142', '79.17%', '44.19%', '15.37', '24,420', '47.7', '0.19%', '$45,016', '$13,412'] },
    { level: 'zips', state: 'SC', fips: '45001', county: '', zip: '29620', metrics: ['6', '69', '100%', '50%', '12.17', '11,612', '44.5', '-7.20%', '$28,008', '$11,204'] },
    { level: 'counties', state: 'SC', fips: '45011', county: 'Barnwell', zip: '', metrics: ['31', '70', '122.95%', '55%', '10', '50,000', '80', '1%', '$40,000', '$12,000'] },
    // a row for a different state must be dropped by the state filter
    { level: 'states', state: 'GA', fips: '', county: '', zip: '', metrics: ['100', '80', '40%', '12%', '6', '10,000,000', '190', '3%', '$60,000', '$20,000'] },
  ],
};

const META = { state: 'SC', side: 'sold' as const, acreageBand: '2-5' as const, period: '2026-Q3', sourcePage: 'https://landportal.com/market-research/', scopeVisited: ['Market Research', 'Drill Deep'], screenshots: [] };
const PROV: PlaybookProvenance = { provider: 'browser_agent:landportal', playbookId: 'landportal_market_research', sourcePage: META.sourcePage, extractionTimestamp: '2026-07-04T00:00:00Z', agentRunId: 'live-1' };

describe('LandPortal live extraction — raw dump → RawMarketTable (regression)', () => {
  it('verifies the metric header row (guards against silent column reorder/rename)', () => {
    expect(verifyMetricHeaders(['Count', 'DOM', 'STR', 'AR', 'MoS', 'Population', 'Density', 'Growth', 'MP', 'PPA'], 'sold').verified).toBe(true);
    // an alias LandPortal might use still verifies
    expect(verifyMetricHeaders(['Count', 'Days on Market', 'Sell Through', 'Absorption', 'MoS', 'Population', 'Density', 'Growth', 'Median Price', 'PPA'], 'sold').verified).toBe(true);
    // a reordered header row is caught
    const bad = verifyMetricHeaders(['DOM', 'Count', 'STR', 'AR', 'MoS', 'Population', 'Density', 'Growth', 'MP', 'PPA'], 'sold');
    expect(bad.verified).toBe(false);
    expect(bad.mismatches.length).toBeGreaterThan(0);
  });

  it('reports header mismatch in diagnostics and falls back to canonical order (never trusts a bad map)', () => {
    const reordered = { headers: ['DOM', 'Count', 'STR', 'AR', 'MoS', 'Population', 'Density', 'Growth', 'MP', 'PPA'], rows: DUMP.rows };
    const table = buildRawTableFromDump(reordered, META);
    expect(table.diagnostics?.headersVerified).toBe(false);
    expect(table.diagnostics?.headerMismatches.length).toBeGreaterThan(0);
  });

  it('drops duplicate rows and records the count in diagnostics', () => {
    const dupDump = { headers: DUMP.headers, rows: [...DUMP.rows, DUMP.rows[1]] }; // duplicate Abbeville county
    const table = buildRawTableFromDump(dupDump, META);
    expect(table.diagnostics?.duplicatesDropped).toBe(1);
    expect(table.rows.filter((r) => r.fips === '45001' && r.level === 'county')).toHaveLength(1);
  });

  it('attributes a BORDER county to its true state via FIPS, not the grouping (root-cause fix)', () => {
    // LandPortal shows Stephens County GA (FIPS 13257) under SC's expansion tagged
    // data-state="SC". The county's canonical state is its FIPS prefix (13 → GA).
    const dump = { headers: DUMP.headers, rows: [
      { level: 'counties', state: 'SC', fips: '13257', county: 'Stephens', zip: '', metrics: ['20', '80', '60%', '40%', '10', '25,000', '50', '1%', '$50,000', '$14,000'] },
    ] };
    const table = buildRawTableFromDump(dump, META);
    const stephens = table.rows.find((r) => r.fips === '13257');
    expect(stephens?.state).toBe('GA'); // NOT 'SC'
    expect(table.diagnostics?.notes.some((n) => /border county/i.test(n))).toBe(true);
    // It now VALIDATES (state matches FIPS) and would ingest as a GA county.
    const v = validateMarketSnapshot(extractMarketPayloads(table, PROV).find((p) => p.geography.fips === '13257'));
    expect(v.valid).toBe(true);
    expect(v.normalized?.geography.state).toBe('GA');
  });

  it('populates rows-by-level diagnostics', () => {
    const d = buildRawTableFromDump(DUMP, META).diagnostics!;
    expect(d.rowsByLevel).toEqual({ state: 1, county: 2, zip: 1 });
    expect(d.headersVerified).toBe(true);
  });

  it('maps data-* identity + trailing metric cells across all three levels', () => {
    const table = buildRawTableFromDump(DUMP, META);
    // GA row filtered out; SC state+county+zip+county kept
    expect(table.rows).toHaveLength(4);
    expect(table.state).toBe('SC');
    const state = table.rows.find((r) => r.level === 'state');
    const county = table.rows.find((r) => r.level === 'county' && r.fips === '45001');
    const zip = table.rows.find((r) => r.level === 'zip');
    expect(state?.cells.PPA).toBe('$27,008');
    expect(county?.county).toBe('Abbeville');
    expect(county?.cells.DOM).toBe('142');
    expect(zip?.zip).toBe('29620');
    expect(zip?.fips).toBe('45001'); // ZIP carries its county FIPS
  });

  it('extracts payloads with real numeric metrics (explicit cells only)', () => {
    const payloads = extractMarketPayloads(buildRawTableFromDump(DUMP, META), PROV);
    const abbeville = payloads.find((p) => p.geography.fips === '45001' && p.geography.level === 'county');
    expect(abbeville?.metrics.medianPricePerAcre).toBe(13412);
    expect(abbeville?.metrics.salesCount).toBe(19);
    expect(abbeville?.metrics.populationGrowth).toBe(0.19);
    const zip = payloads.find((p) => p.geography.level === 'zip');
    expect(zip?.geography.zip).toBe('29620');
    expect(zip?.metrics.populationGrowth).toBe(-7.2); // negatives parsed
  });

  it('STR > 100% is ACCEPTED + FLAGGED per LandPortal semantics (sold ÷ listed), never lost', () => {
    const payloads = extractMarketPayloads(buildRawTableFromDump(DUMP, META), PROV);
    const barnwell = payloads.find((p) => p.geography.fips === '45011');
    const v = validateMarketSnapshot(barnwell);
    expect(v.valid).toBe(true);                       // accepted (not rejected)
    expect(v.normalized?.metrics.sellThroughRate).toBe(122.95); // value preserved
    expect(v.flags.join(' ')).toMatch(/exceeds the usual 0–100%/);
  });

  it('flows through the SAME pipeline with the accept/flag/unknown/reject taxonomy', () => {
    _initTestLandosDb();
    const payloads = extractMarketPayloads(buildRawTableFromDump(DUMP, META), PROV);
    const res = ingestMarketSnapshots(payloads);
    expect(res.accepted).toBe(3); // state + Abbeville county + zip (clean)
    expect(res.flagged).toBe(1);  // Barnwell STR 122.95% → accepted + flagged
    expect(res.rejected).toBe(0);
    expect(res.unknown).toBe(0);
    // Both the clean county AND the flagged county are IN the matrix (flagged not lost).
    expect(getCountyDrilldown('45001')?.snapshots.some((s) => s.metrics.medianPricePerAcre === 13412)).toBe(true);
    expect(getCountyDrilldown('45011')?.snapshots.some((s) => s.metrics.sellThroughRate === 122.95)).toBe(true);
    // Flagged surfaces for review; nothing in the reject queue.
    expect(listFlaggedSnapshots().some((f) => f.fips === '45011')).toBe(true);
    expect(listReviewQueue('open')).toHaveLength(0);
  });
});
