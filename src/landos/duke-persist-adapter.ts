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
import {
  upsertDealCardFromDukeRun,
  upsertDealCardFromMultiParcelDukeRun,
  type DukeParcelWriteback,
  type MultiParcelDukeWritebackInput,
} from './deal-card.js';

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

/** A parcel entry inside a multi-parcel landos-persist block. Each carries its
 *  own identity + per-parcel writeback extras; APNs are never merged. */
type LandosPersistParcel = DukeParcelInput & {
  summary?: string;
  leadName?: string;
  recordOwnerName?: string;
  risks?: string[];
  nextActions?: string[];
  sourceLinks?: Array<{ fact?: string; url?: string }>;
};

/** Optional structured block Duke may embed in its response. */
interface LandosPersistBlock {
  entity?: LandosEntity;
  parcel?: DukeParcelInput;
  /** Multiple parcels/APNs from one run context (same seller/call). When
   *  present with >1 entry, all link to ONE Deal Card as distinct properties. */
  parcels?: LandosPersistParcel[];
  facts?: DukeFactInput[];
  fileRefs?: DukeFileRefInput[];
  reportStatus?: DukeReportStatus;
  summary?: string;
  /** Deal Card writeback extras (all optional). */
  leadName?: string;
  recordOwnerName?: string;
  risks?: string[];
  nextActions?: string[];
  sourceLinks?: Array<{ fact?: string; url?: string }>;
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

// Deal Card writeback default. A successful dashboard Duke run is a PARTIAL
// report by default (no comp credit). 'delivered' is reserved for an explicit
// Full Report (comp-credit approved) or an explicit reportStatus override.
// Non-success statuses map the same as the parcel-persist default.
function defaultDealReportStatus(status: DukeRunStatus): DukeReportStatus {
  if (status === 'success') return 'partial';
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
 * Build the Deal Card writeback input from a completed run. Pure. Returns null
 * when there is no usable identity/address to anchor a card on. Strong-identity
 * verification is enforced downstream by the property-card layer — this only
 * passes through what the run reported (and never fabricates a LandPortal URL).
 */
export function buildDealWritebackInput(info: DukeDashboardRunInfo): import('./deal-card.js').DukeDealWritebackInput | null {
  const text = info.responseText ?? '';
  const { block } = extractPersistBlock(text);
  const parcel = block?.parcel;
  const entity = block?.entity ?? info.entity ?? 'TY_LAND_BIZ';
  const address = (parcel?.address ?? '').trim();
  const hasIdentity = !!(parcel?.apn || parcel?.lpPropertyId);
  if (!address && !hasIdentity) return null;

  const sourceLinks = (block?.sourceLinks ?? [])
    .filter((s) => s && typeof s.url === 'string' && s.url.trim() && !isInsideRepo(s.url))
    .map((s) => ({ fact: s.fact ?? 'source', url: s.url as string }));

  return {
    entity,
    agentId: info.agentId ?? 'duke-due-diligence',
    activeInputAddress: address,
    apn: parcel?.apn,
    lpPropertyId: parcel?.lpPropertyId,
    fips: parcel?.fips,
    lpUrl: parcel?.lpUrl, // only when provided; never fabricated
    county: parcel?.county,
    state: parcel?.state,
    city: parcel?.city,
    owner: parcel?.owner,
    acres: parcel?.acres,
    verified: parcel?.verified,
    verificationSource: parcel?.verificationSource,
    summary: block?.summary,
    leadName: block?.leadName,
    recordOwnerName: block?.recordOwnerName,
    risks: block?.risks,
    nextActions: block?.nextActions,
    sourceLinks,
    reportStatus: block?.reportStatus ?? defaultDealReportStatus(info.status),
  };
}

/**
 * Build a MULTI-parcel Deal Card writeback input when a run carries >1 parcel
 * in its landos-persist block. Returns null when fewer than 2 usable parcels
 * exist (the single-parcel path handles those). Pure; never fabricates URLs.
 */
export function buildMultiDealWritebackInput(info: DukeDashboardRunInfo): MultiParcelDukeWritebackInput | null {
  const text = info.responseText ?? '';
  const { block } = extractPersistBlock(text);
  const raw = block?.parcels ?? [];
  const entity = block?.entity ?? info.entity ?? 'TY_LAND_BIZ';
  const parcels: DukeParcelWriteback[] = raw
    .filter((p) => p && ((p.address ?? '').trim() || p.apn || p.lpPropertyId))
    .map((p) => ({
      activeInputAddress: (p.address ?? '').trim(),
      apn: p.apn,
      lpPropertyId: p.lpPropertyId,
      fips: p.fips,
      lpUrl: p.lpUrl, // only when provided; never fabricated
      county: p.county,
      state: p.state,
      city: p.city,
      owner: p.owner,
      acres: p.acres,
      verified: p.verified,
      verificationSource: p.verificationSource,
      summary: p.summary,
      leadName: p.leadName ?? block?.leadName,
      recordOwnerName: p.recordOwnerName ?? block?.recordOwnerName,
      risks: p.risks,
      nextActions: p.nextActions,
      reportStatus: block?.reportStatus ?? defaultDealReportStatus(info.status),
      sourceLinks: (p.sourceLinks ?? [])
        .filter((s) => s && typeof s.url === 'string' && s.url.trim() && !isInsideRepo(s.url))
        .map((s) => ({ fact: s.fact ?? 'source', url: s.url as string })),
    }));
  if (parcels.length < 2) return null;
  return {
    entity,
    agentId: info.agentId ?? 'duke-due-diligence',
    parcels,
    dealContext: { summary: block?.summary },
  };
}

/**
 * Persist a completed Duke dashboard run AND bridge it into the Deal Card
 * system. Never throws: any failure (including a hard-parcel-rule refusal) is
 * reported through onError and the function returns null — report delivery has
 * already happened and must stand. The Deal Card writeback is best-effort and
 * its failure never affects the parcel persistence result. A run carrying >1
 * parcel links multiple distinct property records to ONE Deal Card.
 */
export function persistDukeRunPostDelivery(
  info: DukeDashboardRunInfo,
  onError?: (message: string, err: unknown) => void,
): DukePersistResult | null {
  let result: DukePersistResult | null = null;
  try {
    result = persistDukeRun(buildDukePersistPayload(info));
  } catch (err) {
    try {
      onError?.('Duke persistence failed (nonfatal — report delivery unaffected)', err);
    } catch { /* even a broken logger must not break delivery */ }
  }
  // Deal Card writeback bridge: separate try so it can never undo the parcel
  // persistence above or affect the delivered report.
  try {
    const multi = buildMultiDealWritebackInput(info);
    if (multi) {
      upsertDealCardFromMultiParcelDukeRun(multi);
    } else {
      const writeback = buildDealWritebackInput(info);
      if (writeback) upsertDealCardFromDukeRun(writeback);
    }
  } catch (err) {
    try {
      onError?.('Duke Deal Card writeback failed (nonfatal — report delivery unaffected)', err);
    } catch { /* ignore */ }
  }
  return result;
}
