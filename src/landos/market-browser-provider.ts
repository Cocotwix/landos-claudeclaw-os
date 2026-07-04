// LandOS — Market data provider abstraction (Market Intelligence department).
//
// The Market Intelligence department consumes validated MarketSnapshotPayload
// objects, NEVER raw provider output. Providers sit behind this contract and are
// interchangeable: the Browser Agent is the Phase-1 provider IMPLEMENTATION, not
// the architecture. Tomorrow a Market Research API (or a different browser
// backend) plugs into the same MarketDataProvider contract and the same
// ingestion pipeline. LandPortal is today's provider, never hardcoded as the
// architecture.

import {
  isAcreageBand, isMarketSide, isPeriod, isConfidence,
  type MarketSnapshotPayload, type Geography,
} from './market-matrix.js';
import { MARKET_SNAPSHOT_FIXTURE, type MarketFixture, type MarketFixtureRow } from './fixtures/market-snapshot-fixture.js';
import { executeBrowserPlaybook, type BrowserAgentRun, type PlaybookExtraction } from './browser-agent.js';
import {
  landportalMarketResearchPlaybook, makeReplayMarketResearchBackend,
  type MarketResearchBackend, type MarketResearchRequest,
} from './browser-playbook-landportal-market.js';
import { makeLiveMarketResearchBackend } from './browser-playbook-landportal-market-live.js';
import { ensureBrowserSession } from './browser-session.js';
import { drillDeepTableForState } from './fixtures/landportal-drill-deep-ga.js';
import { ingestMarketSnapshots, type IngestResult } from './market-matrix-store.js';

export interface MarketExtractionRequest {
  state?: string;
  counties?: string[];   // FIPS
  acreageBand?: string;
  side?: string;
  period?: string;
}

export type ExtractionStatus = 'collected' | 'not_configured' | 'error';

export interface MarketExtraction {
  provider: string;
  status: ExtractionStatus;
  /** Validated-shape payloads ready for the ingestion pipeline. */
  snapshots: MarketSnapshotPayload[];
  note: string;
}

/** The provider contract every market-data source implements. */
export interface MarketDataProvider {
  id: string;
  describe(): string;
  extract(request?: MarketExtractionRequest): Promise<MarketExtraction>;
}

/**
 * Convert a captured browser-extraction fixture into MarketSnapshotPayload
 * objects. Provenance is assembled from the fixture header + each row. Rows are
 * shaped as county-level payloads; the ingestion validator is the single gate
 * that accepts or rejects them (this never pre-validates or repairs).
 */
export function fixtureToPayloads(fixture: MarketFixture): MarketSnapshotPayload[] {
  return fixture.rows.map((row: MarketFixtureRow) => {
    const geography: Geography = {
      level: 'county',
      state: row.state,
      fips: row.fips,
      county: row.county,
    };
    return {
      geography,
      acreageBand: (isAcreageBand(row.acreageBand) ? row.acreageBand : row.acreageBand) as MarketSnapshotPayload['acreageBand'],
      side: (isMarketSide(row.side) ? row.side : row.side) as MarketSnapshotPayload['side'],
      period: isPeriod(row.period) ? row.period : row.period,
      confidence: (isConfidence(row.confidence) ? row.confidence : row.confidence) as MarketSnapshotPayload['confidence'],
      metrics: row.metrics,
      provenance: {
        provider: fixture.provider,
        sourceRef: fixture.sourceRef,
        extractionTimestamp: fixture.extractionTimestamp,
        agentRunId: fixture.agentRunId,
      },
    } as MarketSnapshotPayload;
  });
}

/**
 * The fixture-backed Browser Agent provider. This is the captured real browser
 * extraction (6 counties across GA/SC/TN) used for development, tests, and
 * dashboard verification. It produces the same MarketSnapshotPayload shape a
 * live extraction would.
 */
export function makeFixtureMarketProvider(fixture: MarketFixture = MARKET_SNAPSHOT_FIXTURE): MarketDataProvider {
  return {
    id: 'browser_agent_fixture',
    describe: () => `Browser Agent fixture provider (${fixture.provider}); ${fixture.rows.length} rows from ${fixture.sourceRef}`,
    async extract(): Promise<MarketExtraction> {
      const snapshots = fixtureToPayloads(fixture);
      return {
        provider: fixture.provider,
        status: 'collected',
        snapshots,
        note: fixture.note,
      };
    },
  };
}

/**
 * The live Browser Agent provider. Preserves the provider abstraction: it takes
 * an injectable extraction driver so a real visual/browser backend can be wired
 * without changing the ingestion contract. Until a backend is provided it is
 * honestly not_configured (never fabricates market rows).
 */
export interface LiveExtractionDriver {
  configured(): boolean;
  run(request: MarketExtractionRequest): Promise<MarketSnapshotPayload[]>;
}

export function makeLiveBrowserMarketProvider(driver?: LiveExtractionDriver): MarketDataProvider {
  return {
    id: 'browser_agent_live',
    describe: () => 'Live Browser Agent market provider (LandPortal Market Research via the persistent browser session)',
    async extract(request: MarketExtractionRequest = {}): Promise<MarketExtraction> {
      if (!driver || !driver.configured()) {
        return {
          provider: 'browser_agent:landportal',
          status: 'not_configured',
          snapshots: [],
          note: 'Live Browser Agent market extraction is not wired yet (no visual browser backend / LandPortal Market Research has no API). Ingest the captured fixture, or wire a driver; no market data is fabricated.',
        };
      }
      try {
        const snapshots = await driver.run(request);
        return { provider: 'browser_agent:landportal', status: 'collected', snapshots, note: `Live extraction returned ${snapshots.length} payload(s).` };
      } catch (e: unknown) {
        return { provider: 'browser_agent:landportal', status: 'error', snapshots: [], note: `Live extraction error: ${(e as Error)?.message ?? String(e)}` };
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Browser Agent delegation — the Market Intelligence ↔ Browser Agent seam.
//
// Market Intelligence does NOT contain browser automation. It simply asks the
// Browser Agent to "run the LandPortal Market Research playbook" and consumes the
// returned MarketSnapshotPayload[] through the IDENTICAL ingestion pipeline the
// fixture path uses. The Browser Agent owns the run; this module only wires the
// market ingestion sink so the run record carries accepted/rejected counts.
// ─────────────────────────────────────────────────────────────────────────

export type MarketResearchBackendMode = 'operational' | 'live';

/**
 * Pick the backend the Browser Agent runs the LandPortal Market Research playbook
 * against. 'operational' = the captured Drill Deep replay (configured; proves the
 * whole pipeline). 'live' = a real authenticated visual session — none is wired in
 * this environment, so it is honestly parked (not_configured / awaiting auth); it
 * never fabricates rows. When a live visual driver exists it implements
 * MarketResearchBackend and replaces the parked one here.
 */
export interface LiveExtractionOptions {
  maxCountiesForZip?: number;
  skipCountyFips?: string[];
  onProgress?: (m: string) => void;
}

export function pickMarketResearchBackend(mode: MarketResearchBackendMode, live: LiveExtractionOptions = {}): MarketResearchBackend {
  return mode === 'operational'
    ? makeReplayMarketResearchBackend(drillDeepTableForState)
    : makeLiveMarketResearchBackend(live);
}

export interface MarketResearchDelegation {
  run: BrowserAgentRun;
  extraction: PlaybookExtraction<MarketSnapshotPayload>;
  /** The ingestion result when items flowed to the Market Matrix (null otherwise). */
  ingest: IngestResult | null;
}

/**
 * Delegate a market-research collection to the Browser Agent. The agent runs the
 * playbook, audits scope, and (for a clean run) hands the returned payloads to the
 * Market Matrix ingestion pipeline — the SAME `ingestMarketSnapshots` the fixture
 * path uses. Returns the agent run + extraction + ingestion result.
 */
export async function delegateMarketResearchToBrowserAgent(
  request: MarketResearchRequest,
  opts: { mode?: MarketResearchBackendMode; ingest?: boolean; live?: LiveExtractionOptions } = {},
): Promise<MarketResearchDelegation> {
  const mode = opts.mode ?? 'operational';
  // Warm the persistent Chrome session first for a live run so the backend's
  // configured() reflects a real connection (else the agent honestly reports
  // not_configured without touching a browser).
  if (mode === 'live') { try { await ensureBrowserSession(); } catch { /* backend reports honestly */ } }
  const backend = pickMarketResearchBackend(mode, opts.live ?? {});
  let captured: IngestResult | null = null;
  const sink = opts.ingest === false
    ? undefined
    : (items: MarketSnapshotPayload[]) => {
        captured = ingestMarketSnapshots(items);
        return {
          accepted: captured.accepted, flagged: captured.flagged, unknown: captured.unknown,
          rejected: captured.rejected, reviewQueued: captured.rejected,
        };
      };
  const { run, extraction } = await executeBrowserPlaybook(landportalMarketResearchPlaybook, backend, request, { ingest: sink });
  return { run, extraction, ingest: captured };
}
