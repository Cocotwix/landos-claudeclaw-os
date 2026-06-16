// Duke runtime persistence hook — v1.
//
// Persists structured output of a completed Duke due-diligence run into
// landos.db: property/parcel identity, labeled facts, external file
// references, agent run metadata, and an audit entry. Runs AFTER Duke's
// fast path (CLI / helper call, never inline in the agent loop) so it can
// never slow report delivery.
//
// Hard parcel rule: a parcel may only be persisted as verified when the
// verification source is an authoritative record lookup (LandPortal
// property data, county record, etc.). Coordinates, geocoders, nearest
// parcel lookups, map pins, and visual inference are NEVER acceptable
// verification sources — persistence refuses the whole payload rather
// than downgrade silently.
//
// No network, no .env, no secrets. Input is plain structured metadata;
// raw property work product stays outside the repo (landos.db is
// gitignored, file references must point outside the repo).

import path from 'path';

import {
  FACT_LABELS,
  getLandosDb,
  landosAudit,
  LANDOS_ENTITIES,
  type LandosEntity,
} from './db.js';

export const RUN_STATUSES = ['success', 'failed', 'timeout'] as const;
export type DukeRunStatus = (typeof RUN_STATUSES)[number];

export const REPORT_STATUSES = ['delivered', 'partial', 'failed', 'not_generated'] as const;
export type DukeReportStatus = (typeof REPORT_STATUSES)[number];

/** Verification sources that can never verify a parcel (hard parcel rule). */
const BANNED_VERIFICATION_PATTERNS: RegExp[] = [
  /coordinat/i,
  /geocod/i,
  /nearest[\s_-]*parcel/i,
  /map[\s_-]*pin/i,
  /pin[\s_-]*drop/i,
  /map[\s_-]*click/i,
  /lat[\s_-]*\/?[\s_-]*lon/i,
  /latitude/i,
  /longitude/i,
  /visual/i,
  /satellite/i,
  /aerial/i,
  /street[\s_-]*view/i,
];

export interface DukeParcelInput {
  apn?: string;
  lpPropertyId?: string;
  fips?: string;
  /** LandPortal property URL — only when provided; NEVER fabricated. */
  lpUrl?: string;
  county?: string;
  state?: string;
  city?: string;
  address?: string;
  acres?: number;
  owner?: string;
  verified?: boolean;
  verificationSource?: string;
  /** Shaped LP response reference metadata (NOT raw work product dumps). */
  rawLpJson?: string;
  normalizedJson?: string;
}

export interface DukeFactInput {
  fact: string;
  value?: string;
  label: (typeof FACT_LABELS)[number];
  source?: string;
  sourceType?: string;
  sourceRef?: string;
  dateChecked?: string;
  checkedBy?: string;
  sellerFacingSafe?: boolean;
  requiresOfficialVerification?: boolean;
  affects?: string;
}

export interface DukeFileRefInput {
  kind: string;
  /** Path or URL OUTSIDE the repo (Obsidian note, PDF output, source URL). */
  pathOrRef: string;
  note?: string;
}

export interface DukeRunPayload {
  agentId?: string;
  entity: LandosEntity;
  workflow?: string;
  status: DukeRunStatus;
  summary?: string;
  error?: string;
  /** Unix seconds. */
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  toolCalls?: number;
  reportStatus?: DukeReportStatus;
  parcel?: DukeParcelInput;
  facts?: DukeFactInput[];
  fileRefs?: DukeFileRefInput[];
}

export interface DukePersistResult {
  runId: number;
  propertyId: number | null;
  parcelId: number | null;
  parcelUpdated: boolean;
  factIds: number[];
  fileRefIds: number[];
  auditId: number;
}

function fail(msg: string): never {
  throw new Error(`duke-persist: ${msg}`);
}

/** Parse a JSON payload, tolerating a leading UTF-8 BOM — PowerShell pipes
 *  and some Windows editors add one. */
export function parseDukePayload(text: string): DukeRunPayload {
  return JSON.parse(text.replace(/^\uFEFF/, '')) as DukeRunPayload;
}

function validate(payload: DukeRunPayload): void {
  if (!payload || typeof payload !== 'object') fail('payload must be an object');
  if (!LANDOS_ENTITIES.includes(payload.entity)) {
    fail(`entity must be one of ${LANDOS_ENTITIES.join(', ')} (got ${String(payload.entity)})`);
  }
  if (!RUN_STATUSES.includes(payload.status)) {
    fail(`status must be one of ${RUN_STATUSES.join(', ')} (got ${String(payload.status)})`);
  }
  if (payload.reportStatus !== undefined && !REPORT_STATUSES.includes(payload.reportStatus)) {
    fail(`reportStatus must be one of ${REPORT_STATUSES.join(', ')} (got ${String(payload.reportStatus)})`);
  }
  for (const fact of payload.facts ?? []) {
    if (!fact.fact) fail('every fact needs a non-empty "fact" name');
    if (!FACT_LABELS.includes(fact.label)) {
      fail(`fact "${fact.fact}" has invalid label "${String(fact.label)}" (allowed: ${FACT_LABELS.join(', ')})`);
    }
  }
  for (const ref of payload.fileRefs ?? []) {
    if (!ref.pathOrRef) fail('every fileRef needs a non-empty "pathOrRef"');
    if (path.isAbsolute(ref.pathOrRef)) {
      const resolved = path.resolve(ref.pathOrRef);
      const repoRoot = path.resolve(process.cwd());
      if (resolved === repoRoot || resolved.startsWith(repoRoot + path.sep)) {
        fail(`fileRef "${ref.pathOrRef}" points inside the repo — property work product must live outside the repo`);
      }
    }
  }
  const parcel = payload.parcel;
  if (parcel?.verified) {
    const source = (parcel.verificationSource ?? '').trim();
    if (!source) {
      fail('verified parcel requires a verificationSource (authoritative record lookup)');
    }
    for (const pattern of BANNED_VERIFICATION_PATTERNS) {
      if (pattern.test(source)) {
        fail(
          `hard parcel rule: verificationSource "${source}" is not an acceptable ` +
          'verification method — coordinates, geocoders, nearest-parcel lookups, ' +
          'map pins, and visual inference can never verify a parcel',
        );
      }
    }
  }
}

/**
 * Persist one completed Duke run. Atomic: either everything lands
 * (property, parcel, facts, file refs, run, audit) or nothing does.
 */
export function persistDukeRun(payload: DukeRunPayload): DukePersistResult {
  validate(payload);
  const db = getLandosDb();

  const run = db.transaction((): DukePersistResult => {
    const agentId = payload.agentId ?? 'duke-due-diligence';
    const workflow = payload.workflow ?? 'default_duke_report';
    const parcel = payload.parcel;

    // Property row only when there is address-level identity to record.
    let propertyId: number | null = null;
    if (parcel?.address) {
      propertyId = db.prepare(
        `INSERT INTO landos_property (entity, address, city, state, county, fips)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        payload.entity,
        parcel.address,
        parcel.city ?? '',
        parcel.state ?? '',
        parcel.county ?? '',
        parcel.fips ?? '',
      ).lastInsertRowid as number;
    }

    // Parcel: upsert by (lp_property_id, fips) when both are known so a
    // re-run of the same parcel updates rather than duplicates.
    let parcelId: number | null = null;
    let parcelUpdated = false;
    if (parcel) {
      const now = Math.floor(Date.now() / 1000);
      const existing = parcel.lpPropertyId && parcel.fips
        ? db.prepare(
            `SELECT id FROM landos_parcel WHERE entity = ? AND lp_property_id = ? AND fips = ?`,
          ).get(payload.entity, parcel.lpPropertyId, parcel.fips) as { id: number } | undefined
        : undefined;

      if (existing) {
        db.prepare(
          `UPDATE landos_parcel SET
             property_id = COALESCE(?, property_id),
             apn = CASE WHEN ? != '' THEN ? ELSE apn END,
             county = CASE WHEN ? != '' THEN ? ELSE county END,
             state = CASE WHEN ? != '' THEN ? ELSE state END,
             acres = COALESCE(?, acres),
             verified = ?,
             verification_source = ?,
             verified_at = ?,
             raw_lp_json = CASE WHEN ? != '' THEN ? ELSE raw_lp_json END,
             normalized_json = CASE WHEN ? != '' THEN ? ELSE normalized_json END,
             updated_at = ?
           WHERE id = ?`,
        ).run(
          propertyId,
          parcel.apn ?? '', parcel.apn ?? '',
          parcel.county ?? '', parcel.county ?? '',
          parcel.state ?? '', parcel.state ?? '',
          parcel.acres ?? null,
          parcel.verified ? 1 : 0,
          parcel.verified ? (parcel.verificationSource ?? '') : '',
          parcel.verified ? now : null,
          parcel.rawLpJson ?? '', parcel.rawLpJson ?? '',
          parcel.normalizedJson ?? '', parcel.normalizedJson ?? '',
          now,
          existing.id,
        );
        parcelId = existing.id;
        parcelUpdated = true;
      } else {
        parcelId = db.prepare(
          `INSERT INTO landos_parcel
             (entity, property_id, apn, lp_property_id, fips, county, state, acres,
              verified, verification_source, verified_at, raw_lp_json, normalized_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          payload.entity,
          propertyId,
          parcel.apn ?? '',
          parcel.lpPropertyId ?? '',
          parcel.fips ?? '',
          parcel.county ?? '',
          parcel.state ?? '',
          parcel.acres ?? null,
          parcel.verified ? 1 : 0,
          parcel.verified ? (parcel.verificationSource ?? '') : '',
          parcel.verified ? now : null,
          parcel.rawLpJson ?? '',
          parcel.normalizedJson ?? '',
        ).lastInsertRowid as number;
      }
    }

    const factStmt = db.prepare(
      `INSERT INTO landos_fact
         (entity, parcel_id, fact, value, label, source, source_type, source_ref,
          date_checked, checked_by, seller_facing_safe, requires_official_verification, affects)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const factIds: number[] = [];
    for (const fact of payload.facts ?? []) {
      factIds.push(factStmt.run(
        payload.entity,
        parcelId,
        fact.fact,
        fact.value ?? '',
        fact.label,
        fact.source ?? '',
        fact.sourceType ?? '',
        fact.sourceRef ?? '',
        fact.dateChecked ?? '',
        fact.checkedBy ?? agentId,
        fact.sellerFacingSafe ? 1 : 0,
        fact.requiresOfficialVerification ? 1 : 0,
        fact.affects ?? '',
      ).lastInsertRowid as number);
    }

    const refStmt = db.prepare(
      `INSERT INTO landos_file_ref (entity, kind, path_or_ref, note) VALUES (?, ?, ?, ?)`,
    );
    const fileRefIds: number[] = [];
    for (const ref of payload.fileRefs ?? []) {
      fileRefIds.push(refStmt.run(
        payload.entity,
        ref.kind ?? '',
        ref.pathOrRef,
        ref.note ?? '',
      ).lastInsertRowid as number);
    }

    // Completed run recorded directly (the run already happened — this hook
    // fires after delivery, so there is no live running -> finished phase).
    const finishedAt = payload.finishedAt ?? Math.floor(Date.now() / 1000);
    const startedAt = payload.startedAt
      ?? (payload.durationMs !== undefined
        ? finishedAt - Math.round(payload.durationMs / 1000)
        : finishedAt);
    const durationMs = payload.durationMs ?? (finishedAt - startedAt) * 1000;
    const summaryParts = [payload.summary ?? ''];
    if (payload.reportStatus) summaryParts.push(`[report_status=${payload.reportStatus}]`);
    if (payload.toolCalls !== undefined) summaryParts.push(`[tool_calls=${payload.toolCalls}]`);
    const runId = db.prepare(
      `INSERT INTO landos_agent_run
         (agent_id, entity, workflow, status, started_at, finished_at, duration_ms, summary, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      agentId,
      payload.entity,
      workflow,
      payload.status,
      startedAt,
      finishedAt,
      durationMs,
      summaryParts.filter(Boolean).join(' '),
      payload.error ?? '',
    ).lastInsertRowid as number;

    const auditId = landosAudit(agentId, 'duke_run_persisted', JSON.stringify({
      runId,
      propertyId,
      parcelId,
      parcelUpdated,
      parcelVerified: parcel?.verified ?? false,
      factCount: factIds.length,
      fileRefCount: fileRefIds.length,
      reportStatus: payload.reportStatus ?? null,
      toolCalls: payload.toolCalls ?? null,
      durationMs,
      workflow,
      status: payload.status,
    }), {
      entity: payload.entity,
      refTable: 'landos_agent_run',
      refId: runId,
    });

    return { runId, propertyId, parcelId, parcelUpdated, factIds, fileRefIds, auditId };
  });

  return run();
}
