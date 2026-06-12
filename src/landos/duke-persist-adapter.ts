// Duke post-delivery persistence adapter.
//
// Bridges a completed dashboard Duke run to persistDukeRun(). Called by
// bot.ts AFTER the report has been emitted to the dashboard, so it can
// never block or slow Duke's fast path, and it must never throw — a
// persistence failure is logged by the caller and the delivered report
// stands.
//
// The adapter persists only what the host runtime definitively knows
// (status, timing, tool calls, report file references). Parcel identity
// and labeled facts are persisted only when Duke embeds an explicit
// machine-readable block in its response:
//
//   ```landos-persist
//   { "parcel": { ... }, "facts": [ ... ] }
//   ```
//
// Free-form report text is never scraped for parcel identity — that keeps
// the hard parcel rule intact (persistDukeRun additionally refuses any
// parcel "verified" via coordinates, geocoders, map pins, or visuals).

import path from 'path';

import { type LandosEntity } from './db.js';
import {
  persistDukeRun,
  type DukeFactInput,
  type DukeFileRefInput,
  type DukeParcelInput,
  type DukePersistResult,
  type DukeReportStatus,
  type DukeRunPayload,
  type DukeRunStatus,
} from './duke-persist.js';

export interface DukeDashboardRunInfo {
  agentId?: string;
  entity?: LandosEntity;
  status: DukeRunStatus;
  elapsedMs?: number;
  toolCalls?: number;
  /** Full response text as delivered (or partial text on timeout). */
  responseText?: string | null;
  error?: string;
}

/** Optional structured block Duke may embed in its response. */
interface LandosPersistBlock {
  entity?: LandosEntity;
  parcel?: DukeParcelInput;
  facts?: DukeFactInput[];
  fileRefs?: DukeFileRefInput[];
  reportStatus?: DukeReportStatus;
  summary?: string;
}

const PERSIST_BLOCK_RE = /```landos-persist\s*\n([\s\S]*?)```/;
const PDF_LINK_RE = /\(\/api\/files\/report\?path=([^)\s]+)\)/g;

function extractPersistBlock(text: string): { block: LandosPersistBlock | null; parseError: string | null } {
  const match = PERSIST_BLOCK_RE.exec(text);
  if (!match) return { block: null, parseError: null };
  try {
    return { block: JSON.parse(match[1]) as LandosPersistBlock, parseError: null };
  } catch (err) {
    return { block: null, parseError: `landos-persist block is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function isInsideRepo(p: string): boolean {
  if (!path.isAbsolute(p)) return false;
  const resolved = path.resolve(p);
  const repoRoot = path.resolve(process.cwd());
  return resolved === repoRoot || resolved.startsWith(repoRoot + path.sep);
}

function extractPdfRefs(text: string): DukeFileRefInput[] {
  const refs: DukeFileRefInput[] = [];
  for (const match of text.matchAll(PDF_LINK_RE)) {
    try {
      const decoded = decodeURIComponent(match[1]);
      if (!isInsideRepo(decoded)) {
        refs.push({ kind: 'pdf', pathOrRef: decoded, note: 'Duke report PDF' });
      }
    } catch { /* malformed encoding — skip the ref, keep the run */ }
  }
  return refs;
}

function defaultReportStatus(status: DukeRunStatus): DukeReportStatus {
  if (status === 'success') return 'delivered';
  if (status === 'timeout') return 'not_generated';
  return 'failed';
}

function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim().length > 0) ?? '';
  return line.trim().slice(0, 200);
}

/** Build a DukeRunPayload from what the dashboard runtime knows. Pure. */
export function buildDukePersistPayload(info: DukeDashboardRunInfo): DukeRunPayload {
  const text = info.responseText ?? '';
  const { block, parseError } = extractPersistBlock(text);

  const fileRefs = [
    ...extractPdfRefs(text),
    ...(block?.fileRefs ?? []).filter((r) => r.pathOrRef && !isInsideRepo(r.pathOrRef)),
  ];

  const errorParts = [info.error ?? '', parseError ?? ''].filter(Boolean);

  return {
    agentId: info.agentId ?? 'duke-due-diligence',
    entity: block?.entity ?? info.entity ?? 'TY_LAND_BIZ',
    workflow: 'default_duke_report',
    status: info.status,
    summary: block?.summary ?? firstLine(text),
    error: errorParts.join(' | '),
    durationMs: info.elapsedMs,
    toolCalls: info.toolCalls,
    reportStatus: block?.reportStatus ?? defaultReportStatus(info.status),
    parcel: block?.parcel,
    facts: block?.facts,
    fileRefs: fileRefs.length > 0 ? fileRefs : undefined,
  };
}

/**
 * Persist a completed Duke dashboard run. Never throws: any failure
 * (including a hard-parcel-rule refusal) is reported through onError and
 * the function returns null — report delivery has already happened and
 * must stand.
 */
export function persistDukeRunPostDelivery(
  info: DukeDashboardRunInfo,
  onError?: (message: string, err: unknown) => void,
): DukePersistResult | null {
  try {
    return persistDukeRun(buildDukePersistPayload(info));
  } catch (err) {
    try {
      onError?.('Duke persistence failed (nonfatal — report delivery unaffected)', err);
    } catch { /* even a broken logger must not break delivery */ }
    return null;
  }
}
