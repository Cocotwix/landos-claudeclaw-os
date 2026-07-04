import { describe, it, expect, beforeEach } from 'vitest';
import { _initTestLandosDb } from './db.js';
import {
  resolveHeaderMetric, parseCell, extractMarketPayloads, drillDeepPageState, isSupportedBand, DRILL_DEEP_ACREAGE,
  landportalMarketResearchPlaybook, makeReplayMarketResearchBackend, makeParkedMarketResearchBackend,
  type RawMarketTable,
} from './browser-playbook-landportal-market.js';
import { DRILL_DEEP_GA_TABLE, drillDeepTableForState } from './fixtures/landportal-drill-deep-ga.js';
import { executeBrowserPlaybook, type PlaybookProvenance } from './browser-agent.js';
import { delegateMarketResearchToBrowserAgent } from './market-browser-provider.js';
import { getMatrixCoverage, getCountyDrilldown } from './market-matrix-store.js';
import { resolveMarketMatrix } from './market-matrix-read.js';
import { validateMarketSnapshot } from './market-matrix.js';

const prov: PlaybookProvenance = { provider: 'browser_agent:landportal', playbookId: 'landportal_market_research', sourcePage: 'src', extractionTimestamp: '2026-07-03T00:00:00Z', agentRunId: 'r1' };

describe('LandPortal Market Research playbook — extraction primitives', () => {
  it('discovers headers dynamically, side-aware for Count', () => {
    expect(resolveHeaderMetric('DOM', 'sold')).toBe('daysOnMarket');
    expect(resolveHeaderMetric('Days on Market', 'sold')).toBe('daysOnMarket');
    expect(resolveHeaderMetric('PPA', 'sold')).toBe('medianPricePerAcre');
    expect(resolveHeaderMetric('MP', 'sold')).toBe('medianPrice');
    expect(resolveHeaderMetric('Count', 'sold')).toBe('salesCount');
    expect(resolveHeaderMetric('Count', 'for_sale')).toBe('listingCount');
    expect(resolveHeaderMetric('# Counties', 'sold')).toBeNull(); // structural, not a metric
  });

  it('parses explicit cells only; blank/unknown stays null (never guessed, never 0)', () => {
    expect(parseCell('$121,500')).toBe(121500);
    expect(parseCell('41%')).toBe(41);
    expect(parseCell('3.1')).toBe(3.1);
    expect(parseCell('')).toBeNull();
    expect(parseCell('—')).toBeNull();
    expect(parseCell('N/A')).toBeNull();
    expect(parseCell(undefined)).toBeNull();
  });

  it('drillDeepPageState is the v1 page state (config-driven acreage); unsupported bands throw', () => {
    const ps = drillDeepPageState('2-5');
    expect(ps.status).toBe('Sold');
    expect(ps.data).toBe('Land');
    expect(ps.time).toBe('1 Year');
    expect(ps.acreageOptionMatch).toBe('2\\s*-\\s*5'); // matcher comes from config, drives the live select
    expect(isSupportedBand('2-5')).toBe(true);
    expect(isSupportedBand('5-10')).toBe(false);
    expect(() => drillDeepPageState('5-10')).toThrow(/not supported/);
  });

  it('acreage architecture supports future bands via CONFIG (enabling is a config flip, not code)', () => {
    // Every band that maps to a single LandPortal option already has its matcher
    // predefined — flipping `supported: true` is all it takes to enable it.
    for (const b of ['5-10', '10-20', '20-50', 'all'] as const) expect(DRILL_DEEP_ACREAGE[b].optionMatch).toBeTruthy();
    expect(DRILL_DEEP_ACREAGE['50+'].optionMatch).toBeNull(); // documented: needs composition (LandPortal splits 50+)
    expect(Object.keys(DRILL_DEEP_ACREAGE).sort()).toEqual(['10-20', '2-5', '20-50', '5-10', '50+', 'all']);
  });

  it('extracts State→County→ZIP payloads; Unknown metric stays absent (Richmond growth)', () => {
    const payloads = extractMarketPayloads(DRILL_DEEP_GA_TABLE, prov);
    const state = payloads.find((p) => p.geography.level === 'state');
    const dekalb = payloads.find((p) => p.geography.level === 'county' && p.geography.fips === '13089');
    const richmond = payloads.find((p) => p.geography.level === 'county' && p.geography.fips === '13245');
    const zip30030 = payloads.find((p) => p.geography.level === 'zip' && p.geography.zip === '30030');

    expect(state?.geography.state).toBe('GA');
    expect(dekalb?.metrics.medianPricePerAcre).toBe(121500);
    expect(dekalb?.metrics.salesCount).toBe(42);
    expect(dekalb?.metrics.populationGrowth).toBe(3.1);
    // Richmond growth cell was blank → metric omitted (Unknown), never 0.
    expect(richmond?.metrics.populationGrowth).toBeUndefined();
    expect(richmond?.metrics.medianPricePerAcre).toBe(28500);
    // ZIP payload carries the resolved county FIPS.
    expect(zip30030?.geography.fips).toBe('13089');
    expect(zip30030?.metrics.medianPricePerAcre).toBe(128000);
  });

  it('every extracted payload passes the SAME validator the fixture path uses', () => {
    const payloads = extractMarketPayloads(DRILL_DEEP_GA_TABLE, prov);
    for (const p of payloads) expect(validateMarketSnapshot(p).valid).toBe(true);
  });
});

describe('LandPortal Market Research playbook — via the Browser Agent', () => {
  beforeEach(() => { _initTestLandosDb(); });

  it('parked backend → honest not_configured, no rows, nothing fabricated', async () => {
    const { run, extraction } = await executeBrowserPlaybook(landportalMarketResearchPlaybook, makeParkedMarketResearchBackend(), { state: 'GA' });
    expect(run.status).toBe('not_configured');
    expect(extraction.items).toHaveLength(0);
  });

  it('replay backend → collected, produces payloads within allowed scope', async () => {
    const backend = makeReplayMarketResearchBackend(drillDeepTableForState);
    const { run, extraction } = await executeBrowserPlaybook(landportalMarketResearchPlaybook, backend, { state: 'GA' });
    expect(run.status).toBe('succeeded');
    expect(run.scopeVisited).toEqual(['Market Research', 'Drill Deep']);
    expect(extraction.items.length).toBe(DRILL_DEEP_GA_TABLE.rows.length);
  });

  it('a backend that strays outside Market Research is refused by the playbook', async () => {
    const offScope: RawMarketTable = { ...DRILL_DEEP_GA_TABLE, scopeVisited: ['Market Research', 'Billing'] };
    const backend = makeReplayMarketResearchBackend(() => offScope);
    const { run, extraction } = await executeBrowserPlaybook(landportalMarketResearchPlaybook, backend, { state: 'GA' });
    expect(run.status).toBe('failed');
    expect(extraction.items).toHaveLength(0);
  });

  it('unsupported acreage band fails honestly (no navigation)', async () => {
    const backend = makeReplayMarketResearchBackend(drillDeepTableForState);
    const { run } = await executeBrowserPlaybook(landportalMarketResearchPlaybook, backend, { state: 'GA', acreageBand: '5-10' });
    expect(run.status).toBe('failed');
    expect(run.note).toMatch(/not supported/);
  });
});

describe('LandPortal Market Research — live trial through the full pipeline', () => {
  beforeEach(() => { _initTestLandosDb(); });

  it('delegation → identical ingestion pipeline populates the Market Matrix', async () => {
    const { run, ingest } = await delegateMarketResearchToBrowserAgent({ state: 'GA' }, { mode: 'operational' });
    expect(run.status).toBe('succeeded');
    expect(ingest?.accepted).toBe(DRILL_DEEP_GA_TABLE.rows.length);
    expect(ingest?.rejected).toBe(0);
    expect(run.rowsAccepted).toBe(DRILL_DEEP_GA_TABLE.rows.length);

    const cov = getMatrixCoverage();
    expect(cov.snapshotCount).toBeGreaterThanOrEqual(DRILL_DEEP_GA_TABLE.rows.length);
    expect(cov.periods).toContain('2026-Q2');

    // County drilldown reflects the ingested county snapshot.
    const dekalb = getCountyDrilldown('13089');
    expect(dekalb?.snapshots.some((s) => s.metrics.medianPricePerAcre === 121500)).toBe(true);
  });

  it('Property Card resolver consumes the live-extracted data (ZIP → County fallback)', async () => {
    await delegateMarketResearchToBrowserAgent({ state: 'GA' }, { mode: 'operational' });
    // ZIP match: 30030 was extracted at zip level.
    const zip = resolveMarketMatrix({ state: 'GA', zip: '30030', acreageBand: '2-5', side: 'sold' });
    expect(zip.matchLevel).toBe('zip');
    expect(zip.facts.pricePerAcre).toBe(128000);
    // County match: Fulton has no zip-level in the requested band → county level.
    const county = resolveMarketMatrix({ state: 'GA', county: '13121', acreageBand: '2-5', side: 'sold' });
    expect(county.matchLevel).toBe('county');
    expect(county.facts.pricePerAcre).toBe(205000);
  });

  it('the live (non-replay) path is honestly not configured (no visual session wired)', async () => {
    const { run } = await delegateMarketResearchToBrowserAgent({ state: 'GA' }, { mode: 'live' });
    expect(run.status).toBe('not_configured');
    expect(run.rowsAccepted).toBe(0);
  });
});
