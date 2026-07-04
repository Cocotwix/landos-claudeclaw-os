// LandOS — Browser Agent (its own employee; owns browser automation).
//
// The Browser Agent is a first-class LandOS employee. It owns ONE capability:
// operating browsers. It does NOT own market intelligence, due diligence, or any
// business domain — it EXECUTES Browser Playbooks and returns validated-shape
// structured output to whichever department delegated the work. Market
// Intelligence delegates market collection here; a future department will
// delegate county GIS / FEMA / assessor / zoning collection here too, each as a
// new Browser Playbook. The Browser Agent NEVER permanently knows any website.
//
// Responsibilities that live HERE (site-agnostic):
//   - the generic BrowserPlaybook contract (metadata + a run() the agent drives),
//   - enforcing the playbook's allowed navigation SCOPE (a playbook that reports
//     visiting a surface outside its declared allowedScope FAILS the run),
//   - honest operational STATUS (configured / running / succeeded / failed /
//     awaiting_authentication / not_configured), timing, and a durable run log,
//   - optional hand-off of returned items to a caller-supplied ingestion sink so
//     the run record carries accepted / rejected / review-queued counts.
//
// What does NOT live here: any site selectors, page-state config, table parsing,
// or provider identity. That is a Browser Playbook's job (see the LandPortal
// Market Research playbook, Browser Playbook #1).

import { getLandosDb } from './db.js';

// ─────────────────────────────────────────────────────────────────────────
// Status model
// ─────────────────────────────────────────────────────────────────────────

export type BrowserAgentStatus =
  | 'not_configured'
  | 'configured'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'awaiting_authentication';

export const BROWSER_AGENT_STATUS_LABEL: Record<BrowserAgentStatus, string> = {
  not_configured: 'Not Configured',
  configured: 'Configured',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  awaiting_authentication: 'Awaiting Authentication',
};

/** What a playbook reports back to the agent. `outcome` is the playbook's honest
 *  self-assessment; the agent maps it to a run STATUS (and can still fail a
 *  'collected' run if the playbook strayed outside its allowed scope). */
export type PlaybookOutcome = 'collected' | 'awaiting_authentication' | 'not_configured' | 'error';

export interface PlaybookProvenance {
  provider: string;              // e.g. 'browser_agent:landportal'
  playbookId: string;
  sourcePage: string;            // the workspace/URL the rows were read from
  extractionTimestamp: string;   // ISO
  agentRunId: string;            // correlation id (also this run's key)
}

export interface PlaybookExtraction<TItem> {
  outcome: PlaybookOutcome;
  /** The structured output (e.g. MarketSnapshotPayload[]) — validated-SHAPE, not
   *  yet ingested. The agent never repairs or invents items. */
  items: TItem[];
  /** Raw rows the playbook actually READ from the site (before shaping). */
  rowsCaptured: number;
  /** The navigation surfaces the playbook actually visited (for scope audit +
   *  provenance/evidence). Must stay within the playbook's allowedScope. */
  scopeVisited: string[];
  /** Safe screenshot references (paths/keys only — never cookies/credentials). */
  screenshots: string[];
  provenance: PlaybookProvenance;
  note: string;
  /** Optional structured extraction diagnostics (rows by level, dedup, header
   *  verification, retries, per-stage timings) — surfaced, never hidden. */
  diagnostics?: Record<string, unknown>;
}

export function emptyExtraction<TItem>(prov: PlaybookProvenance, outcome: PlaybookOutcome, note: string): PlaybookExtraction<TItem> {
  return { outcome, items: [], rowsCaptured: 0, scopeVisited: [], screenshots: [], provenance: prov, note };
}

// ─────────────────────────────────────────────────────────────────────────
// The generic Browser Playbook contract
// ─────────────────────────────────────────────────────────────────────────

/** The minimum every playbook backend exposes so the Browser Agent can detect an
 *  unconfigured / unauthenticated session BEFORE attempting to run it. The rich,
 *  site-specific capabilities are declared by each playbook's own backend type. */
export interface PlaybookBackend {
  id: string;
  /** True only when a real session + browser stack are available and enabled. */
  configured(): boolean;
}

export interface PlaybookRunHooks {
  onProgress?: (message: string) => void;
  isCancelled?: () => boolean;
}

/**
 * A Browser Playbook knows WHAT website to operate and HOW to read it; the
 * Browser Agent knows how to RUN playbooks. `TBackend` is the site capability the
 * playbook needs (constructed by the caller: a live driver, a replay capture, or
 * a parked stub). The agent stays generic over both the backend and the output.
 */
export interface BrowserPlaybook<TRequest, TItem, TBackend extends PlaybookBackend> {
  id: string;
  label: string;
  provider: string;
  /** The ONLY navigation surfaces this playbook is permitted to touch. The agent
   *  audits scopeVisited against this and fails the run on any violation. */
  allowedScope: string[];
  describe(): string;
  run(backend: TBackend, request: TRequest, hooks: PlaybookRunHooks): Promise<PlaybookExtraction<TItem>>;
}

/** Guard a navigation target against a playbook's allowed scope. Playbooks call
 *  this before touching a surface; the agent re-checks scopeVisited after. */
export function isScopeAllowed(allowedScope: string[], target: string): boolean {
  const t = target.trim().toLowerCase();
  return allowedScope.some((s) => s.trim().toLowerCase() === t);
}

// ─────────────────────────────────────────────────────────────────────────
// Run records
// ─────────────────────────────────────────────────────────────────────────

export interface BrowserAgentRun {
  agentRunId: string;
  playbookId: string;
  playbookLabel: string;
  provider: string;
  status: BrowserAgentStatus;
  request: unknown;
  scopeVisited: string[];
  sourcePage: string;
  rowsCaptured: number;
  rowsAccepted: number;
  rowsFlagged: number;
  rowsUnknown: number;
  rowsRejected: number;
  reviewQueued: number;
  durationMs: number;
  screenshots: string[];
  note: string;
  createdAt: number;
}

/** A caller-supplied ingestion sink. The agent hands the playbook's returned
 *  items to this sink so the run record carries honest accepted/rejected counts,
 *  WITHOUT the agent importing any department's store (it stays site/domain-free).
 *  This is the SAME pipeline the fixture path uses — the sink IS that pipeline. */
export interface IngestionOutcome { accepted: number; flagged: number; unknown: number; rejected: number; reviewQueued: number }
export type IngestionSink<TItem> = (items: TItem[]) => IngestionOutcome;

let runSeq = 0;
function newAgentRunId(playbookId: string): string {
  runSeq += 1;
  return `bagent-${playbookId}-${Date.now()}-${runSeq}`;
}

function persistRun(run: BrowserAgentRun): void {
  getLandosDb().prepare(
    `INSERT INTO landos_browser_agent_run
       (agent_run_id, playbook_id, playbook_label, provider, status, request_json, scope_visited,
        source_page, rows_captured, rows_accepted, rows_flagged, rows_unknown, rows_rejected, review_queued, duration_ms, screenshots_json, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(agent_run_id) DO UPDATE SET
       status = excluded.status, scope_visited = excluded.scope_visited, source_page = excluded.source_page,
       rows_captured = excluded.rows_captured, rows_accepted = excluded.rows_accepted,
       rows_flagged = excluded.rows_flagged, rows_unknown = excluded.rows_unknown,
       rows_rejected = excluded.rows_rejected, review_queued = excluded.review_queued,
       duration_ms = excluded.duration_ms, screenshots_json = excluded.screenshots_json, note = excluded.note`,
  ).run(
    run.agentRunId, run.playbookId, run.playbookLabel, run.provider, run.status,
    JSON.stringify(run.request ?? null), JSON.stringify(run.scopeVisited), run.sourcePage,
    run.rowsCaptured, run.rowsAccepted, run.rowsFlagged, run.rowsUnknown, run.rowsRejected, run.reviewQueued, run.durationMs,
    JSON.stringify(run.screenshots), run.note,
  );
}

function safeJson<T>(s: string, fallback: T): T { try { return JSON.parse(s) as T; } catch { return fallback; } }

interface RunRow {
  agent_run_id: string; playbook_id: string; playbook_label: string; provider: string; status: string;
  request_json: string; scope_visited: string; source_page: string; rows_captured: number; rows_accepted: number;
  rows_flagged: number; rows_unknown: number; rows_rejected: number; review_queued: number; duration_ms: number;
  screenshots_json: string; note: string; created_at: number;
}
function rowToRun(r: RunRow): BrowserAgentRun {
  return {
    agentRunId: r.agent_run_id, playbookId: r.playbook_id, playbookLabel: r.playbook_label, provider: r.provider,
    status: r.status as BrowserAgentStatus, request: safeJson<unknown>(r.request_json, null),
    scopeVisited: safeJson<string[]>(r.scope_visited, []), sourcePage: r.source_page,
    rowsCaptured: r.rows_captured, rowsAccepted: r.rows_accepted, rowsFlagged: r.rows_flagged ?? 0,
    rowsUnknown: r.rows_unknown ?? 0, rowsRejected: r.rows_rejected,
    reviewQueued: r.review_queued, durationMs: r.duration_ms, screenshots: safeJson<string[]>(r.screenshots_json, []),
    note: r.note, createdAt: r.created_at,
  };
}

export function listBrowserAgentRuns(playbookId?: string, limit = 20): BrowserAgentRun[] {
  const db = getLandosDb();
  const rows = (playbookId
    ? db.prepare(`SELECT * FROM landos_browser_agent_run WHERE playbook_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`).all(playbookId, limit)
    : db.prepare(`SELECT * FROM landos_browser_agent_run ORDER BY created_at DESC, id DESC LIMIT ?`).all(limit)) as RunRow[];
  return rows.map(rowToRun);
}

export function getLastBrowserAgentRun(playbookId?: string): BrowserAgentRun | null {
  return listBrowserAgentRuns(playbookId, 1)[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────
// The Browser Agent
// ─────────────────────────────────────────────────────────────────────────

export interface ExecuteOptions<TItem> {
  /** Optional ingestion sink for the returned items (the identical pipeline the
   *  fixture path uses). When provided, the run records accepted/rejected/queued. */
  ingest?: IngestionSink<TItem>;
  hooks?: PlaybookRunHooks;
  now?: () => number;
}

export interface ExecuteResult<TItem> {
  run: BrowserAgentRun;
  extraction: PlaybookExtraction<TItem>;
}

function outcomeToStatus(outcome: PlaybookOutcome): BrowserAgentStatus {
  switch (outcome) {
    case 'collected': return 'succeeded';
    case 'awaiting_authentication': return 'awaiting_authentication';
    case 'not_configured': return 'not_configured';
    case 'error': return 'failed';
  }
}

/**
 * Execute a Browser Playbook. The agent: checks the backend is configured (else
 * records an honest not_configured run without touching a browser), drives the
 * playbook, audits the scope it visited, maps the outcome to a status, optionally
 * hands the items to the caller's ingestion sink, and persists the run. It never
 * fabricates items and never repairs a value.
 */
export async function executeBrowserPlaybook<TRequest, TItem, TBackend extends PlaybookBackend>(
  playbook: BrowserPlaybook<TRequest, TItem, TBackend>,
  backend: TBackend,
  request: TRequest,
  opts: ExecuteOptions<TItem> = {},
): Promise<ExecuteResult<TItem>> {
  const now = opts.now ?? Date.now;
  const startedAt = now();
  const agentRunId = newAgentRunId(playbook.id);
  const baseRun: BrowserAgentRun = {
    agentRunId, playbookId: playbook.id, playbookLabel: playbook.label, provider: playbook.provider,
    status: 'running', request, scopeVisited: [], sourcePage: '',
    rowsCaptured: 0, rowsAccepted: 0, rowsFlagged: 0, rowsUnknown: 0, rowsRejected: 0, reviewQueued: 0,
    durationMs: 0, screenshots: [], note: '',
    createdAt: Math.floor(startedAt / 1000),
  };

  // Not configured → honest, no browser action.
  if (!backend.configured()) {
    const run: BrowserAgentRun = {
      ...baseRun, status: 'not_configured', durationMs: now() - startedAt,
      note: `Backend "${backend.id}" is not configured (no authenticated session / no browser stack). No navigation attempted; nothing fabricated.`,
    };
    persistRun(run);
    return {
      run,
      extraction: emptyExtraction<TItem>(
        { provider: playbook.provider, playbookId: playbook.id, sourcePage: '', extractionTimestamp: new Date(startedAt).toISOString(), agentRunId },
        'not_configured', run.note,
      ),
    };
  }

  let extraction: PlaybookExtraction<TItem>;
  try {
    extraction = await playbook.run(backend, request, opts.hooks ?? {});
  } catch (e: unknown) {
    const run: BrowserAgentRun = {
      ...baseRun, status: 'failed', durationMs: now() - startedAt,
      note: `Playbook "${playbook.id}" threw: ${(e as Error)?.message ?? String(e)}. No items ingested.`,
    };
    persistRun(run);
    return {
      run,
      extraction: emptyExtraction<TItem>(
        { provider: playbook.provider, playbookId: playbook.id, sourcePage: '', extractionTimestamp: new Date(startedAt).toISOString(), agentRunId },
        'error', run.note,
      ),
    };
  }

  // Scope audit — a playbook that strayed outside its declared allowedScope is a
  // FAILED run even if it returned rows (never trust off-scope collection).
  const offScope = extraction.scopeVisited.filter((s) => !isScopeAllowed(playbook.allowedScope, s));
  let status = outcomeToStatus(extraction.outcome);
  let note = extraction.note;
  if (offScope.length > 0) {
    status = 'failed';
    note = `Scope violation: playbook visited [${offScope.join(', ')}] outside allowedScope [${playbook.allowedScope.join(', ')}]. Run failed; items discarded.`;
  }

  // Ingest through the caller's sink (identical pipeline) only for a clean run.
  let accepted = 0, flagged = 0, unknown = 0, rejected = 0, reviewQueued = 0;
  if (status === 'succeeded' && opts.ingest && extraction.items.length) {
    const r = opts.ingest(extraction.items);
    accepted = r.accepted; flagged = r.flagged; unknown = r.unknown; rejected = r.rejected; reviewQueued = r.reviewQueued;
  }

  const run: BrowserAgentRun = {
    ...baseRun,
    status,
    scopeVisited: extraction.scopeVisited,
    sourcePage: extraction.provenance.sourcePage,
    rowsCaptured: extraction.rowsCaptured,
    rowsAccepted: accepted,
    rowsFlagged: flagged,
    rowsUnknown: unknown,
    rowsRejected: rejected,
    reviewQueued,
    durationMs: now() - startedAt,
    screenshots: extraction.screenshots,
    note,
  };
  persistRun(run);
  return { run, extraction: offScope.length ? { ...extraction, items: [] as TItem[], outcome: 'error', note } : extraction };
}

// ─────────────────────────────────────────────────────────────────────────
// Operational status summary (dashboard-facing)
// ─────────────────────────────────────────────────────────────────────────

export interface BrowserPlaybookInfo {
  id: string;
  label: string;
  provider: string;
  allowedScope: string[];
  description: string;
  configured: boolean;
  status: BrowserAgentStatus;
  lastRun: BrowserAgentRun | null;
}

export interface BrowserAgentSummary {
  employee: { id: string; label: string; role: string };
  playbooks: BrowserPlaybookInfo[];
  totals: { runs: number; lastRunAt: number | null };
}

/** Compute an honest playbook status: last run's status if any, else configured/
 *  not_configured from the backend. */
export function playbookInfo<TRequest, TItem, TBackend extends PlaybookBackend>(
  playbook: BrowserPlaybook<TRequest, TItem, TBackend>,
  backend: TBackend,
): BrowserPlaybookInfo {
  const lastRun = getLastBrowserAgentRun(playbook.id);
  const configured = backend.configured();
  const status: BrowserAgentStatus = lastRun ? lastRun.status : (configured ? 'configured' : 'not_configured');
  return {
    id: playbook.id, label: playbook.label, provider: playbook.provider,
    allowedScope: playbook.allowedScope, description: playbook.describe(),
    configured, status, lastRun,
  };
}
