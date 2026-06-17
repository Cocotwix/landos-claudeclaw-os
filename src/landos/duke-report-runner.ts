// Duke Report mission-task runner bridge.
//
// Closes the gap between a dashboard-queued "Run Duke Report" mission task and
// Duke's REAL verification + standardized-writeback flow (the same pieces the
// war-room/chat path uses): runDukePreflight -> Duke execution ->
// persistDukeRunPostDelivery. No Duke logic is duplicated here; this composes
// the existing functions and is dependency-injected so it can be unit-tested
// without live LandPortal/agent calls.
//
// Hard rules enforced:
//   - Preflight runs FIRST. Parcel-specific evaluation/strategy/offer and the
//     standardized writeback happen ONLY when preflight verifies identity.
//   - Unverified/blocked => no parcel-specific writeback; only Local Area
//     Context, Not Parcel Verified is allowed.
//   - Comp credit is NEVER spent here. The runner only carries the comp mode +
//     approval through; the LandPortal comp-guard remains the spend gate. A
//     comp-credit approval is honored only when compMode === 'landportal_credit'
//     AND the dashboard explicitly approved it for THIS run.
//   - No coordinate/proximity/geocoder identification anywhere.

import type { DukePreflightOutcome } from './duke-preflight.js';
import type { DukeDashboardRunInfo } from './duke-persist-adapter.js';
import {
  buildDukeReportLanes,
  LANDPORTAL_VERIFICATION_TIMEOUT_MS,
  type DukeReportLanes,
  type LandPortalLaneInput,
} from './duke-report-lanes.js';

export type CompMode = 'redfin_zillow' | 'landportal_credit';

export interface DukeReportTaskMeta {
  type: 'duke_report';
  compMode: CompMode;
  cardId: number | null;
  /** True ONLY for an explicit LandPortal Comps selection (one run). */
  lpCompCreditApproval: boolean;
  source: string;
}

/** Deterministic, machine-readable task sentinel (we control both ends), e.g.:
 *  [[duke_report v1 compMode=redfin_zillow cardId=123 lpCompCreditApproval=false source=dashboard]] */
const SENTINEL_RE = /\[\[duke_report v1 ([^\]]*)\]\]/;

/** Parse the Duke Report sentinel from a mission prompt. Returns null when the
 *  prompt is not a Duke Report task. Never throws. */
export function parseDukeReportTask(prompt: string | null | undefined): DukeReportTaskMeta | null {
  const m = (prompt ?? '').match(SENTINEL_RE);
  if (!m) return null;
  const kv: Record<string, string> = {};
  for (const pair of m[1].trim().split(/\s+/)) {
    const i = pair.indexOf('=');
    if (i > 0) kv[pair.slice(0, i)] = pair.slice(i + 1);
  }
  const compMode: CompMode = kv.compMode === 'landportal_credit' ? 'landportal_credit' : 'redfin_zillow';
  return {
    type: 'duke_report',
    compMode,
    cardId: kv.cardId && /^\d+$/.test(kv.cardId) ? Number(kv.cardId) : null,
    // Approval is honored ONLY on the explicit LandPortal Comps path. Redfin/
    // Zillow can never approve a comp credit, regardless of the flag value.
    lpCompCreditApproval: compMode === 'landportal_credit' && kv.lpCompCreditApproval === 'true',
    source: kv.source ?? 'dashboard',
  };
}

/** True when a claimed mission task is a dashboard Duke Report run for Duke. */
export function isDukeReportTask(task: { assigned_agent?: string | null; prompt?: string | null }): boolean {
  return task.assigned_agent === 'duke-due-diligence' && parseDukeReportTask(task.prompt) != null;
}

/** Strip the sentinel so Duke's preflight/agent see clean operator text. */
export function stripSentinel(prompt: string | null | undefined): string {
  return (prompt ?? '').replace(SENTINEL_RE, '').trim();
}

export interface DukeReportRunDeps {
  runDukePreflight: (text: string, allowlist: string[] | undefined, timeoutMs: number) => Promise<DukePreflightOutcome>;
  /** Runs Duke's agent on the composed prompt with the EFFECTIVE MCP allowlist.
   *  For a verified run this is the preflight-filtered allowlist (LandPortal MCP
   *  excluded), never the original unfiltered allowlist. */
  runAgent: (prompt: string, allowlist: string[] | undefined) => Promise<{ text?: string | null; aborted?: boolean }>;
  /** Standardized Duke writeback adapter (best-effort; persists from run text). */
  persistDukeRunPostDelivery: (info: DukeDashboardRunInfo) => void;
  /** Incoming MCP allowlist passed to preflight (preflight filters LandPortal). */
  mcpAllowlist?: string[];
  timeoutMs?: number;
}

export interface DukeReportRunResult {
  status: 'completed' | 'failed';
  verified: boolean;
  blocked: boolean;
  reportStatus: 'partial' | 'blocked' | 'failed';
  compMode: CompMode;
  lpCompCreditApproval: boolean;
  /** True only when the run actually spent an LP comp credit (never set here;
   *  the agent/comp-guard owns the actual spend). */
  compCreditUsed: boolean;
  summary: string;
  error?: string;
  /** Default Duke Report source lanes (verification + downstream gating). */
  lanes?: DukeReportLanes;
}

/** Parse verified acreage from the preflight parcel block (lot_size_acres), if present. */
function acresFromParcelBlock(parcelBlock: string): number | null {
  const m = parcelBlock.match(/"lot_size_acres"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Parse a compact identity summary (APN/FIPS) from the parcel block, if present. */
function identityFromParcelBlock(parcelBlock: string): string | null {
  const apn = parcelBlock.match(/"apn"\s*:\s*"([^"]+)"/)?.[1];
  const fips = parcelBlock.match(/"fips"\s*:\s*"([^"]+)"/)?.[1];
  const bits = [apn ? `APN ${apn}` : '', fips ? `FIPS ${fips}` : ''].filter(Boolean);
  return bits.length ? bits.join(', ') : null;
}

/**
 * Execute a dashboard Duke Report mission task through Duke's real flow.
 * Pure orchestration over injected deps — no direct network/agent imports.
 */
export async function runDukeReportFromTask(
  task: { id?: string; prompt?: string | null; assigned_agent?: string | null },
  deps: DukeReportRunDeps,
): Promise<DukeReportRunResult> {
  const meta = parseDukeReportTask(task.prompt) ?? {
    type: 'duke_report' as const, compMode: 'redfin_zillow' as CompMode, cardId: null, lpCompCreditApproval: false, source: 'dashboard',
  };
  // LandPortal exact search gets up to a 3-minute verification ceiling. A slow
  // LandPortal lane must never collapse the whole report.
  const landPortalTimeoutMs = Math.min(deps.timeoutMs ?? LANDPORTAL_VERIFICATION_TIMEOUT_MS, LANDPORTAL_VERIFICATION_TIMEOUT_MS);
  const dukeText = stripSentinel(task.prompt);
  const localAreaAnchor = localAnchorFromText(dukeText);

  const baseResult = {
    compMode: meta.compMode,
    lpCompCreditApproval: meta.lpCompCreditApproval,
    compCreditUsed: false, // runner never spends; the comp-guard/agent owns spend
  };

  try {
    const started = Date.now();
    const pre = await deps.runDukePreflight(dukeText, deps.mcpAllowlist, landPortalTimeoutMs);
    const durationMs = Date.now() - started;

    if (pre.type === 'verified') {
      // Parcel verified: inject the verified parcel block, run Duke with the
      // PREFLIGHT-FILTERED allowlist (LandPortal MCP excluded — parcel data is
      // injected inline, so Duke must not re-call LP), and persist through the
      // standardized writeback adapter.
      const composed = `${pre.parcelBlock}\n\n${dukeText}`;
      const run = await deps.runAgent(composed, pre.filteredMcpAllowlist);
      const status: DukeDashboardRunInfo['status'] = run.aborted ? 'timeout' : 'success';
      deps.persistDukeRunPostDelivery({
        agentId: 'duke-due-diligence',
        status,
        responseText: run.text ?? '',
      });
      const lanes = buildDukeReportLanes({
        landPortal: { status: 'success', verified: true, durationMs, identitySummary: identityFromParcelBlock(pre.parcelBlock) },
        compMode: meta.compMode,
        localAreaAnchor,
        acres: acresFromParcelBlock(pre.parcelBlock),
      });
      return {
        ...baseResult,
        status: 'completed',
        verified: true,
        blocked: false,
        reportStatus: run.aborted ? 'failed' : 'partial',
        summary: run.aborted
          ? 'Duke Report run aborted/timed out after a verified parcel.'
          : (run.text?.trim().slice(0, 200) || lanes.summary),
        lanes,
      };
    }

    // Not verified (blocked / timeout / skip): NO parcel-specific writeback.
    // Build the source-lane report so a LandPortal timeout never collapses the
    // output — the Local Area Data lane still contributes compact context.
    const lanes = blockedPreflightToLanes(pre, dukeText, meta.compMode, durationMs);
    const lpTimedOut = lanes.lanes.find(l => l.laneId === 'landportal_exact_search')?.status === 'timeout';
    return {
      ...baseResult,
      status: 'completed',
      verified: false,
      blocked: true,
      reportStatus: lpTimedOut ? 'partial' : 'blocked',
      summary: lanes.summary,
      lanes,
    };
  } catch (err) {
    const lanes = buildDukeReportLanes({
      landPortal: { status: 'error', verified: false, reason: (err as Error)?.message ?? 'run error' },
      compMode: meta.compMode,
      localAreaAnchor,
    });
    return {
      ...baseResult,
      status: 'failed',
      verified: false,
      blocked: true,
      reportStatus: 'failed',
      summary: lanes.summary,
      error: (err as Error)?.message ?? String(err),
      lanes,
    };
  }
}

/**
 * Convert a non-verified preflight outcome (blocked timeout / multiple
 * candidates / error / not-verified, or skip) into the Default Duke Report
 * source lanes. Shared by the mission-task runner above AND the live
 * dashboard/chat path so a LandPortal timeout returns Local Area Context, Not
 * Parcel Verified — never the thin one-line TIMEOUT_MESSAGE. Pure: no network,
 * no agent, no comp credit, no coordinate/proximity identification.
 */
export function blockedPreflightToLanes(
  pre: Extract<DukePreflightOutcome, { type: 'blocked' }> | { type: 'skip' },
  dukeText: string,
  compMode: CompMode,
  durationMs?: number,
): DukeReportLanes {
  const lpStatus: LandPortalLaneInput['status'] =
    pre.type === 'blocked' && (pre.reason === 'lp_timeout' || pre.reason === 'preflight_timeout') ? 'timeout'
    : pre.type === 'blocked' && pre.reason === 'multiple_candidates' ? 'multiple_candidates'
    : pre.type === 'blocked' && pre.reason === 'preflight_error' ? 'error'
    : 'not_verified';
  const reason = pre.type === 'blocked' ? pre.message : 'No parcel identifier found in the task.';
  return buildDukeReportLanes({
    landPortal: { status: lpStatus, verified: false, durationMs, reason },
    compMode,
    localAreaAnchor: localAnchorFromText(dukeText),
  });
}

/** Extract a "<County> County, <ST>"-style local anchor from the operator text
 *  for the Local Area Data lane (context only — never used to verify identity). */
function localAnchorFromText(text: string): string | null {
  const county = text.match(/\b([A-Za-z][A-Za-z.'\- ]*?)\s+County\b/i)?.[1]?.trim();
  const state = (text.match(/\b([A-Z]{2})\b/g) ?? []).slice(-1)[0];
  if (county && state) return `${county} County, ${state}`;
  if (county) return `${county} County`;
  if (state) return state;
  return null;
}
