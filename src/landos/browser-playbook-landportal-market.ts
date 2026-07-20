// LandOS — Browser Playbook #1: LandPortal Market Research.
//
// A Browser Playbook knows WHAT website to operate and HOW to read it. This is
// the FIRST playbook: LandPortal's Market Research → Drill Deep workspace, whose
// job is ONLY market research. It is executed BY the Browser Agent (which knows
// how to run playbooks but never permanently knows LandPortal). Market
// Intelligence delegates to the Browser Agent: "run the LandPortal Market
// Research playbook"; the returned MarketSnapshotPayload[] flow through the
// IDENTICAL ingestion pipeline the fixture path uses.
//
// Strict navigation contract (allowedScope): Market Research → Drill Deep ONLY.
// The playbook never browses billing, account, saved searches, or any other
// LandPortal module. Page state for v1: Status=Sold, Data=Land, Time=1 Year,
// Acreage=2–5. The acreage band is a lookup so future bands (All, 5–10, 10–20,
// 20–50, 50+) drop in without a redesign.
//
// Extraction rule: read ONLY explicit table cell values. Never estimate from
// colors/graphs, never infer. Headers are discovered dynamically (alias map), so
// a column reorder or a renamed header does not silently mis-map a metric.

import {
  type BrowserPlaybook, type PlaybookBackend, type PlaybookExtraction, type PlaybookRunHooks,
  type PlaybookProvenance, isScopeAllowed,
} from './browser-agent.js';
import {
  isPeriod, isMarketSide, isAcreageBand, STATE_FIPS,
  type MarketSnapshotPayload, type MarketMetric, type MarketSide, type AcreageBand, type Confidence, type Geography,
} from './market-matrix.js';

// ─────────────────────────────────────────────────────────────────────────
// Page state (Drill Deep configuration)
// ─────────────────────────────────────────────────────────────────────────

/**
 * ACREAGE BAND CONFIG — the single place that governs which acreage bands the
 * playbook supports and HOW each maps onto LandPortal's Drill Deep acreage select
 * (`#acre_range`). Adding a band is a CONFIG change here (flip `supported` and set
 * `optionMatch`), NOT a code rewrite: the live backend selects the acreage option
 * by this matcher, and the UI/roadmap reads `uiLabel` + `supported`.
 *
 * LandPortal `#acre_range` options (observed): All, 0-1 acre, 1-2 acres, 2-5 acres,
 * 5-10 acres, 10-20 acres, 20-50 acres, 50-70 acres, 70-100 acres, 100-150 acres,
 * 150+ acres. `optionMatch` is a regex (case-insensitive) matched against option
 * text. `null` optionMatch = no direct single LandPortal option (needs composition
 * later, e.g. "50+").
 */
export interface AcreageBandConfig {
  uiLabel: string;              // display label
  supported: boolean;          // is this band enabled in the playbook yet?
  optionMatch: string | null;  // regex matching the #acre_range <option> text
}
// Current live `#acre_range` options (probed 2026-07-19): Custom range…, All,
// 0-1 acre, 1-2 acres, 2-5 acres, 5-10 acres, 10-20 acres, 20-50 acres,
// 50-100 acres, 100+ acres.
export const DRILL_DEEP_ACREAGE: Record<AcreageBand, AcreageBandConfig> = {
  '2-5':    { uiLabel: '2–5 Acres',    supported: true, optionMatch: '2\\s*-\\s*5' },
  all:      { uiLabel: 'All acreage',  supported: true, optionMatch: '^All$' },
  '0-1':    { uiLabel: '0–1 Acre',     supported: true, optionMatch: '0\\s*-\\s*1' },
  '1-2':    { uiLabel: '1–2 Acres',    supported: true, optionMatch: '1\\s*-\\s*2' },
  '5-10':   { uiLabel: '5–10 Acres',   supported: true, optionMatch: '5\\s*-\\s*10' },
  '10-20':  { uiLabel: '10–20 Acres',  supported: true, optionMatch: '10\\s*-\\s*20' },
  '20-50':  { uiLabel: '20–50 Acres',  supported: true, optionMatch: '20\\s*-\\s*50' },
  '50-100': { uiLabel: '50–100 Acres', supported: true, optionMatch: '50\\s*-\\s*100' },
  '100+':   { uiLabel: '100+ Acres',   supported: true, optionMatch: '100\\s*\\+' },
  '50+':    { uiLabel: '50+ Acres',    supported: false, optionMatch: null }, // no native option; LandPortal splits 50-100 / 100+ (both collected)
};

/** Back-compat label map (null = unsupported) derived from the config. */
export const DRILL_DEEP_ACREAGE_LABEL: Record<AcreageBand, string | null> = Object.fromEntries(
  (Object.keys(DRILL_DEEP_ACREAGE) as AcreageBand[]).map((b) => [b, DRILL_DEEP_ACREAGE[b].supported ? DRILL_DEEP_ACREAGE[b].uiLabel : null]),
) as Record<AcreageBand, string | null>;

export function isSupportedBand(band: AcreageBand): boolean {
  const c = DRILL_DEEP_ACREAGE[band];
  return !!c && c.supported && c.optionMatch !== null;
}

export interface DrillDeepPageState {
  status: 'Sold';           // Status filter
  data: 'Land';             // Data filter
  time: '1 Year';           // Time window
  acreageLabel: string;     // LandPortal acreage UI label (display)
  acreageOptionMatch: string; // regex the live backend uses to pick the #acre_range option
}

export function drillDeepPageState(band: AcreageBand): DrillDeepPageState {
  const c = DRILL_DEEP_ACREAGE[band];
  if (!c || !c.supported || !c.optionMatch) {
    throw new Error(`Acreage band "${band}" is not supported by the LandPortal Market Research playbook yet (config-gated; v1 supports 2–5).`);
  }
  return { status: 'Sold', data: 'Land', time: '1 Year', acreageLabel: c.uiLabel, acreageOptionMatch: c.optionMatch };
}

// ─────────────────────────────────────────────────────────────────────────
// Raw table shape (what the backend reads off the page) + dynamic header map
// ─────────────────────────────────────────────────────────────────────────

export type MarketRowLevel = 'state' | 'county' | 'zip';

export interface RawMarketRow {
  level: MarketRowLevel;
  /** Row identity as read from the page. */
  state: string;                // USPS abbreviation
  county?: string;              // display name (county/zip rows)
  fips?: string;                // 5-digit county FIPS (county rows; zip rows carry resolved county FIPS)
  zip?: string;                 // 5-digit ZIP (zip rows)
  /** Discovered-header → raw cell text, exactly as read (e.g. "$118,000", "41%"). */
  cells: Record<string, string>;
  confidence?: Confidence;
}

export interface RawMarketTable {
  /** Headers discovered on the page, in visual order (for provenance + audit). */
  headers: string[];
  rows: RawMarketRow[];
  period: string;               // YYYY-Qn the snapshot represents
  side: MarketSide;             // 'sold' for the v1 page state
  acreageBand: AcreageBand;
  state: string;                // the one state expanded in this trial
  sourcePage: string;           // workspace URL / reference
  scopeVisited: string[];       // navigation surfaces actually touched
  screenshots: string[];        // safe screenshot refs
  authRequired?: boolean;
  diagnostics?: ExtractionDiagnostics;
}

/** Header alias → canonical MarketMetric. Keys are NORMALIZED (lowercased,
 *  non-alphanumerics stripped) so "DOM", "Days on Market", "days_on_market" and
 *  "PPA", "$/Acre", "Median $/Acre" all resolve to one metric. 'count' is side-
 *  aware (sold→salesCount, for_sale→listingCount) and handled separately. */
const HEADER_METRIC_ALIASES: Record<string, MarketMetric> = {
  dom: 'daysOnMarket', daysonmarket: 'daysOnMarket',
  str: 'sellThroughRate', sellthrough: 'sellThroughRate', sellthroughrate: 'sellThroughRate',
  ar: 'absorptionRate', absorption: 'absorptionRate', absorptionrate: 'absorptionRate',
  mos: 'monthsOfSupply', monthsofsupply: 'monthsOfSupply',
  population: 'population', pop: 'population',
  density: 'populationDensity', popdensity: 'populationDensity', populationdensity: 'populationDensity',
  growth: 'populationGrowth', popgrowth: 'populationGrowth', populationgrowth: 'populationGrowth',
  mp: 'medianPrice', medianprice: 'medianPrice',
  ppa: 'medianPricePerAcre', peracre: 'medianPricePerAcre', acre: 'medianPricePerAcre', medianacre: 'medianPricePerAcre',
};

/** Structural headers that are NOT market metrics (row-shape counts). */
const STRUCTURAL_HEADERS = new Set(['counties', 'zipcodes', 'zips', 'county', 'zip', 'state']);

function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Resolve a discovered header to a MarketMetric, or null if structural/unknown.
 *  Side-aware for the ambiguous "Count" header. */
export function resolveHeaderMetric(header: string, side: MarketSide): MarketMetric | null {
  const n = normHeader(header);
  if (n === 'count' || n === 'sales' || n === 'listings') return side === 'sold' ? 'salesCount' : 'listingCount';
  return HEADER_METRIC_ALIASES[n] ?? null;
}

/** The metric columns LandPortal Drill Deep renders, in fixed visual order. The
 *  live backend reads them POSITIONALLY (the trailing cells), so a silent column
 *  reorder/rename would mis-map metrics — verifyMetricHeaders guards against it. */
export const EXPECTED_METRIC_HEADER_LABELS = ['Count', 'DOM', 'STR', 'AR', 'MoS', 'Population', 'Density', 'Growth', 'MP', 'PPA'] as const;

export interface HeaderVerification {
  verified: boolean;
  mismatches: Array<{ index: number; got: string; expected: string }>;
}

/**
 * Verify the discovered header row still matches the expected column order so a
 * LandPortal DOM/header change can never silently mis-map a metric. Each observed
 * header at position i must resolve to the SAME metric as the expected label at i
 * (via the alias map, so a rename LandPortal makes that we already alias is fine).
 */
export function verifyMetricHeaders(headers: string[], side: MarketSide): HeaderVerification {
  const mismatches: HeaderVerification['mismatches'] = [];
  if (headers.length !== EXPECTED_METRIC_HEADER_LABELS.length) {
    return { verified: false, mismatches: [{ index: -1, got: `${headers.length} headers [${headers.join(', ')}]`, expected: `${EXPECTED_METRIC_HEADER_LABELS.length} metric columns` }] };
  }
  EXPECTED_METRIC_HEADER_LABELS.forEach((label, i) => {
    const want = resolveHeaderMetric(label, side);
    const got = resolveHeaderMetric(headers[i], side);
    if (want !== got) mismatches.push({ index: i, got: headers[i] || '(blank)', expected: label });
  });
  return { verified: mismatches.length === 0, mismatches };
}

/** Extraction diagnostics — surfaced honestly so partial/degraded runs are
 *  visible, never silently trusted. */
export interface ExtractionDiagnostics {
  rowsByLevel: { state: number; county: number; zip: number };
  duplicatesDropped: number;
  headersVerified: boolean;
  headerMismatches: string[];
  countiesExpanded: number;
  countiesTotal: number;
  retries: number;
  stageMs?: Record<string, number>;
  notes: string[];
}

/** Parse a raw cell into a number, or null when the cell is empty/unknown. Reads
 *  the explicit value only; never infers. Handles $, commas, % and negatives. */
export function parseCell(raw: string | undefined): number | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (!s || /^(—|-|n\/?a|unknown|na)$/i.test(s)) return null;
  const n = Number(s.replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// ─────────────────────────────────────────────────────────────────────────
// Extraction: raw table → MarketSnapshotPayload[]
// ─────────────────────────────────────────────────────────────────────────

function geographyForRow(row: RawMarketRow): Geography | null {
  const state = row.state?.toUpperCase();
  if (!state) return null;
  if (row.level === 'state') return { level: 'state', state };
  if (row.level === 'county') {
    if (!row.fips) return null;
    return { level: 'county', state, fips: row.fips, ...(row.county ? { county: row.county } : {}) };
  }
  // zip
  if (!row.zip) return null;
  return { level: 'zip', state, zip: row.zip, ...(row.fips ? { fips: row.fips } : {}), ...(row.county ? { county: row.county } : {}) };
}

/**
 * Convert a captured/read Drill Deep table into MarketSnapshotPayload objects.
 * Dynamic header discovery maps each column to a metric; only explicit cell
 * values become metrics (a missing/blank cell stays Unknown — never guessed, never
 * zero). Provenance is attached from the run. The ingestion validator downstream
 * is the SINGLE gate that accepts or rejects — this never pre-validates or repairs.
 */
export function extractMarketPayloads(table: RawMarketTable, prov: PlaybookProvenance): MarketSnapshotPayload[] {
  const out: MarketSnapshotPayload[] = [];
  for (const row of table.rows) {
    const geography = geographyForRow(row);
    if (!geography) continue; // broken identity — let it fall out (nothing fabricated)
    const metrics: Partial<Record<MarketMetric, number | null>> = {};
    for (const header of table.headers) {
      if (STRUCTURAL_HEADERS.has(normHeader(header))) continue;
      const metric = resolveHeaderMetric(header, table.side);
      if (!metric) continue;
      const value = parseCell(row.cells[header]);
      if (value !== null) metrics[metric] = value;
    }
    out.push({
      geography,
      acreageBand: table.acreageBand,
      side: table.side,
      period: table.period,
      confidence: row.confidence ?? 'medium',
      metrics,
      provenance: {
        provider: prov.provider,
        sourceRef: prov.sourcePage,
        extractionTimestamp: prov.extractionTimestamp,
        agentRunId: prov.agentRunId,
      },
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// The playbook's backend capability (what a live/replay browser must provide)
// ─────────────────────────────────────────────────────────────────────────

export interface MarketResearchRequest {
  state: string;               // ONE state for the trial (USPS abbreviation)
  acreageBand?: AcreageBand;   // default 2-5
  side?: MarketSide;           // default 'sold' (the v1 page state)
  period?: string;             // default resolved by the backend/capture
}

/** The site capability the LandPortal Market Research playbook needs. A live
 *  visual driver implements this by navigating Market Research → Drill Deep,
 *  applying the page state, expanding State→County→ZIP, and reading the table. A
 *  replay backend implements it from a captured table. A parked backend is
 *  honestly not configured. The playbook itself contains no selectors. */
export interface MarketResearchBackend extends PlaybookBackend {
  collect(input: { pageState: DrillDeepPageState; request: MarketResearchRequest }): Promise<RawMarketTable>;
}

export const LANDPORTAL_MARKET_PLAYBOOK_ID = 'landportal_market_research';
export const LANDPORTAL_MARKET_PROVIDER = 'browser_agent:landportal';
export const LANDPORTAL_MARKET_ALLOWED_SCOPE = ['Market Research', 'Drill Deep'];

/**
 * Browser Playbook #1 — LandPortal Market Research. Executed by the Browser
 * Agent. Applies the Drill Deep page state, asks the backend to collect the
 * State→County→ZIP table (Market Research → Drill Deep ONLY), audits that the
 * backend stayed in scope, then extracts MarketSnapshotPayload[]. Honest about
 * authentication / not-configured; never fabricates rows.
 */
export const landportalMarketResearchPlaybook: BrowserPlaybook<MarketResearchRequest, MarketSnapshotPayload, MarketResearchBackend> = {
  id: LANDPORTAL_MARKET_PLAYBOOK_ID,
  label: 'LandPortal Market Research',
  provider: LANDPORTAL_MARKET_PROVIDER,
  allowedScope: LANDPORTAL_MARKET_ALLOWED_SCOPE,
  describe() {
    return 'Navigates LandPortal Market Research → Drill Deep only, applies Status=Sold / Data=Land / Time=1 Year / Acreage=2–5, expands State→County→ZIP, and reads the explicit market table into MarketSnapshotPayload objects. Market research scope only; never billing/account/other modules.';
  },
  async run(backend, request, hooks: PlaybookRunHooks): Promise<PlaybookExtraction<MarketSnapshotPayload>> {
    const now = () => new Date().toISOString();
    const agentRunId = `${LANDPORTAL_MARKET_PLAYBOOK_ID}-${Date.now()}`;
    const side: MarketSide = isMarketSide(request.side) ? request.side : 'sold';
    const band: AcreageBand = isAcreageBand(request.acreageBand) ? request.acreageBand : '2-5';
    const baseProv: PlaybookProvenance = {
      provider: LANDPORTAL_MARKET_PROVIDER, playbookId: LANDPORTAL_MARKET_PLAYBOOK_ID,
      sourcePage: '', extractionTimestamp: now(), agentRunId,
    };

    if (!isSupportedBand(band)) {
      return { outcome: 'error', items: [], rowsCaptured: 0, scopeVisited: [], screenshots: [], provenance: baseProv,
        note: `Acreage band "${band}" not supported by the playbook yet (v1: 2–5 acres). No navigation attempted.` };
    }

    const pageState = drillDeepPageState(band);
    hooks.onProgress?.(`Navigating LandPortal Market Research → Drill Deep (${pageState.status}/${pageState.data}/${pageState.time}/${pageState.acreageLabel}) for ${request.state}`);

    const table = await backend.collect({ pageState, request: { ...request, side, acreageBand: band } });

    // The backend told us which surfaces it touched. Refuse anything off-scope.
    const offScope = table.scopeVisited.filter((s) => !isScopeAllowed(LANDPORTAL_MARKET_ALLOWED_SCOPE, s));
    const prov: PlaybookProvenance = { ...baseProv, sourcePage: table.sourcePage, extractionTimestamp: now() };

    if (offScope.length > 0) {
      return { outcome: 'error', items: [], rowsCaptured: table.rows.length, scopeVisited: table.scopeVisited,
        screenshots: table.screenshots, provenance: prov,
        note: `Backend navigated outside Market Research scope: [${offScope.join(', ')}]. Refused; nothing ingested.` };
    }
    if (table.authRequired) {
      return { outcome: 'awaiting_authentication', items: [], rowsCaptured: 0, scopeVisited: table.scopeVisited,
        screenshots: table.screenshots, provenance: prov,
        note: 'LandPortal Market Research requires an authenticated session (operator action). No credential stored; nothing fabricated.' };
    }

    // Period sanity: use the table's period if valid, else fail honestly.
    if (!isPeriod(table.period)) {
      return { outcome: 'error', items: [], rowsCaptured: table.rows.length, scopeVisited: table.scopeVisited,
        screenshots: table.screenshots, provenance: prov, note: `Captured table has an invalid period "${table.period}".` };
    }

    const items = extractMarketPayloads(table, prov);
    hooks.onProgress?.(`Extracted ${items.length} MarketSnapshotPayload(s) from ${table.rows.length} row(s)`);
    const d = table.diagnostics;
    const diagNote = d
      ? ` [${d.rowsByLevel.state} state / ${d.rowsByLevel.county} county / ${d.rowsByLevel.zip} zip; headers ${d.headersVerified ? 'verified' : 'MISMATCH'}; ${d.duplicatesDropped} dupes dropped; ${d.retries} retries${d.notes.length ? `; ${d.notes.join('; ')}` : ''}]`
      : '';
    return {
      outcome: 'collected', items, rowsCaptured: table.rows.length,
      scopeVisited: table.scopeVisited, screenshots: table.screenshots, provenance: prov,
      diagnostics: d as unknown as Record<string, unknown> | undefined,
      note: `LandPortal Market Research → Drill Deep: read ${table.rows.length} row(s) (State→County→ZIP) with ${table.headers.length} discovered headers; produced ${items.length} payload(s) for ${request.state} (${side}, ${band}, ${table.period}).${diagNote}`,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Backends: replay (captured table) + parked (honest not-configured)
// ─────────────────────────────────────────────────────────────────────────

/** Replay backend — serves a captured Drill Deep table (representative, not live
 *  market data) through the IDENTICAL playbook path, so the whole pipeline
 *  (navigation plan → extraction → normalization → validation → ingestion) is
 *  provable without a live authenticated visual session. */
export function makeReplayMarketResearchBackend(tableForState: (state: string) => RawMarketTable | null): MarketResearchBackend {
  return {
    id: 'landportal_market_replay',
    configured: () => true,
    async collect({ request }) {
      const table = tableForState(request.state.toUpperCase());
      if (!table) {
        return {
          headers: [], rows: [], period: '', side: request.side ?? 'sold', acreageBand: request.acreageBand ?? '2-5',
          state: request.state.toUpperCase(), sourcePage: 'LandPortal Market Research (replay capture)',
          scopeVisited: ['Market Research', 'Drill Deep'], screenshots: [],
          // No captured table for this state — honest empty (not auth, not fabricated).
        };
      }
      return table;
    },
  };
}

/** Parked backend — no authenticated LandPortal session / no visual browser
 *  stack wired. Honestly not configured; never fabricates. */
export function makeParkedMarketResearchBackend(): MarketResearchBackend {
  return {
    id: 'landportal_market_parked',
    configured: () => false,
    async collect({ request }) {
      return {
        headers: [], rows: [], period: '', side: request.side ?? 'sold', acreageBand: request.acreageBand ?? '2-5',
        state: request.state.toUpperCase(), sourcePage: '', scopeVisited: [], screenshots: [], authRequired: true,
      };
    },
  };
}

export { STATE_FIPS };
