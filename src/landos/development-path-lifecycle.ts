// LandOS — the Development Path lifecycle (Stage 5).
//
// `landos-zoning-subdivision-entitlement` is pure over the retained land-use
// products, the Property Story and the accepted subject. This module decides
// WHEN it runs and WHAT it writes:
//
//   TRIGGERED, NOT POLLED   it runs on the Stage 3 completion boundary, ahead
//                           of the Deal Brain so the decision can consume it;
//                           after a land-use capability rerun; and once on
//                           start for settled records that have none. Never
//                           on a read.
//   MATERIAL, NOT NOISY     a path read is superseded only when a MATERIAL
//                           dimension moved: governing authority, district,
//                           a strategy-relevant use, a yield-deciding
//                           standard, a local threshold, a path's
//                           applicability, or the subject screen.
//   EXPLAINED               every refreshed read names its cause and the
//                           before → after of each dimension that moved.
//
// It persists through the shared derived-snapshot seam exactly as Stages 3
// and 4 do: attached to the current identity version, deduped on the input
// hash, superseded rather than overwritten, rejected when the originating run
// lost authority, and correlated to the accepted parcel on read-back.

import { buildAcquisitionDossier, type PropertyFileSource } from './acquisition-intelligence-dossier.js';
import { resolveCanonicalSubjectState, type CanonicalSubjectState } from './canonical-subject-state.js';
import type { ControllingLandUseAuthority } from './controlling-land-use-authority.js';
import type { CurrentZoningDetermination } from './current-zoning-determination.js';
import type { DecisionChange, DecisionRefresh } from './deal-brain-decision.js';
import { getLandosDb } from './db.js';
import { writeDerivedSnapshot, type ParcelCorrelation } from './derived-intelligence-store.js';
import {
  CURRENT_ZONING_SNAPSHOT_TYPE,
  LAND_USE_AUTHORITY_SNAPSHOT_TYPE,
  SUBDIVISION_PROPERTY_READ_SNAPSHOT_TYPE,
  SUBDIVISION_REGULATIONS_SNAPSHOT_TYPE,
  ZONING_STANDARDS_SNAPSHOT_TYPE,
} from './land-use-intelligence-store.js';
import type { PropertyEvidenceSynthesis } from './property-evidence-synthesis.js';
import {
  PROPERTY_EVIDENCE_SYNTHESIS_SNAPSHOT,
  readPropertyEvidenceSynthesis,
  readRetainedReading,
  type RetainedReading,
} from './research-stable-intelligence.js';
import type { PropertySubdivisionRead } from './subdivision-property-read.js';
import type { SubdivisionRegulations } from './subdivision-regulations.js';
import {
  buildZoningDevelopmentIntelligence,
  ZONING_DEVELOPMENT_INTELLIGENCE_VERSION,
  ZONING_DEVELOPMENT_SKILL,
  ZONING_DEVELOPMENT_SNAPSHOT,
  type OperatorPathEstimate,
  type ZoningDevelopmentIntelligence,
} from './zoning-development-intelligence.js';
import type { ZoningStandardsResult } from './zoning-standards-research.js';
import type { ZoningAnalysis } from './zoning-types.js';

/** The zoning slice's retained analysis row; only its official-boundary
 *  jurisdiction read is consumed here. */
export const ZONING_ANALYSIS_SNAPSHOT = 'zoning_land_use_v1';

// ── The persisted read ──────────────────────────────────────────────────────

export interface DevelopmentPathBasedOn {
  authoritySnapshotId: number | null;
  boundarySnapshotId: number | null;
  zoningSnapshotId: number | null;
  standardsSnapshotId: number | null;
  regulationsSnapshotId: number | null;
  subdivisionReadSnapshotId: number | null;
  propertySnapshotId: number | null;
  subjectVersion: string | null;
}

export interface RetainedDevelopmentPath extends ZoningDevelopmentIntelligence {
  basedOn: DevelopmentPathBasedOn;
  /** Which retained land-use products were current and correlated to the
   *  accepted subject when this read formed. A product formed about another
   *  parcel version is history and was not consumed. */
  inputStatus: Record<'authority' | 'boundary' | 'zoning' | 'standards' | 'regulations' | 'subdivisionRead' | 'propertyStory', 'current' | 'historical' | 'pending'>;
  refresh: DecisionRefresh;
}

// ── Dependencies ────────────────────────────────────────────────────────────

/** A land-use product read with its correlation and row id. */
export type LandUseReading<T> = RetainedReading<T> | null;

export interface DevelopmentPathDeps {
  readPropertyFile: (dealCardId: number) => PropertyFileSource | null;
  readSubject?: (dealCardId: number) => CanonicalSubjectState;
  readPropertyStory?: (dealCardId: number) => RetainedReading<PropertyEvidenceSynthesis> | null;
  readAuthority?: (dealCardId: number) => LandUseReading<ControllingLandUseAuthority>;
  readBoundary?: (dealCardId: number) => LandUseReading<{ analysis?: ZoningAnalysis }>;
  readZoning?: (dealCardId: number) => LandUseReading<CurrentZoningDetermination>;
  readStandards?: (dealCardId: number) => LandUseReading<ZoningStandardsResult>;
  readRegulations?: (dealCardId: number) => LandUseReading<SubdivisionRegulations>;
  readSubdivisionRead?: (dealCardId: number) => LandUseReading<PropertySubdivisionRead>;
  readOperatorEstimates?: (dealCardId: number) => OperatorPathEstimate[];
  readCurrent?: (dealCardId: number) => RetainedReading<RetainedDevelopmentPath> | null;
  writeSnapshot?: typeof writeDerivedSnapshot;
  /** A Property Story the caller has just formed, so the completion boundary
   *  does not re-read what it wrote a moment ago. */
  propertyStory?: { property: PropertyEvidenceSynthesis; propertySnapshotId: number | null } | null;
  cause: string;
  actor?: string;
  runId?: string | null;
}

export interface DevelopmentPathResult {
  outcome: 'produced' | 'unchanged' | 'no_property_file';
  reason: string | null;
  developmentPath: RetainedDevelopmentPath | null;
  persistence: { snapshotId: number | null; written: boolean; skippedReason: string | null };
  changes: DecisionChange[];
}

function diff(prior: Record<string, string> | null | undefined, next: Record<string, string>): DecisionChange[] {
  const changes: DecisionChange[] = [];
  for (const [dimension, after] of Object.entries(next)) {
    const before = prior?.[dimension] ?? null;
    if (before !== after) changes.push({ dimension, before, after });
  }
  return changes;
}

const current = <T,>(reading: LandUseReading<T>): T | null => (reading?.correlation === 'equivalent' ? reading.value : null);
const statusOf = <T,>(reading: LandUseReading<T>): 'current' | 'historical' | 'pending' =>
  !reading ? 'pending' : reading.correlation === 'equivalent' ? 'current' : 'historical';

// ── Producing the read ──────────────────────────────────────────────────────

/**
 * Form and persist the Development Path for a Deal Card.
 *
 * Safe on any trigger: unchanged land-use products write nothing, an
 * immaterial change writes nothing, and only a moved material dimension
 * supersedes the current read — with the change recorded on the new version.
 * Runs even when no land-use product is retained: the honest "not
 * established" read, with its decisive verification, is the product then.
 */
export function ensureDevelopmentPath(dealCardId: number, deps: DevelopmentPathDeps): DevelopmentPathResult {
  const source = deps.readPropertyFile(dealCardId);
  if (!source) {
    return { outcome: 'no_property_file', reason: 'No canonical property file exists for this Deal Card.', developmentPath: null, persistence: { snapshotId: null, written: false, skippedReason: null }, changes: [] };
  }
  const dossier = buildAcquisitionDossier(source);
  const subject = (deps.readSubject ?? resolveCanonicalSubjectState)(dealCardId);

  let propertyReading: RetainedReading<PropertyEvidenceSynthesis> | null;
  if (deps.propertyStory) {
    propertyReading = { value: deps.propertyStory.property, correlation: 'equivalent', retainedAt: null, snapshotId: deps.propertyStory.propertySnapshotId };
  } else {
    propertyReading = (deps.readPropertyStory ?? readPropertyEvidenceSynthesis)(dealCardId);
  }
  const authority = (deps.readAuthority ?? ((id: number) => readRetainedReading<ControllingLandUseAuthority>(id, LAND_USE_AUTHORITY_SNAPSHOT_TYPE)))(dealCardId);
  const boundary = (deps.readBoundary ?? ((id: number) => readRetainedReading<{ analysis?: ZoningAnalysis }>(id, ZONING_ANALYSIS_SNAPSHOT)))(dealCardId);
  const zoning = (deps.readZoning ?? ((id: number) => readRetainedReading<CurrentZoningDetermination>(id, CURRENT_ZONING_SNAPSHOT_TYPE)))(dealCardId);
  const standards = (deps.readStandards ?? ((id: number) => readRetainedReading<ZoningStandardsResult>(id, ZONING_STANDARDS_SNAPSHOT_TYPE)))(dealCardId);
  const regulations = (deps.readRegulations ?? ((id: number) => readRetainedReading<SubdivisionRegulations>(id, SUBDIVISION_REGULATIONS_SNAPSHOT_TYPE)))(dealCardId);
  const subdivisionRead = (deps.readSubdivisionRead ?? ((id: number) => readRetainedReading<PropertySubdivisionRead>(id, SUBDIVISION_PROPERTY_READ_SNAPSHOT_TYPE)))(dealCardId);
  const estimates = deps.readOperatorEstimates?.(dealCardId) ?? [];

  const synthesis = buildZoningDevelopmentIntelligence({
    dealCardId,
    dossier,
    subject,
    property: current(propertyReading),
    authority: current(authority),
    boundary: current(boundary)?.analysis?.jurisdiction ?? null,
    zoning: current(zoning),
    standards: current(standards),
    regulations: current(regulations),
    subdivisionRead: current(subdivisionRead),
    operatorEstimates: estimates,
  });

  const prior = (deps.readCurrent ?? readDevelopmentPath)(dealCardId);
  const priorStands = prior?.correlation === 'equivalent';
  const priorContractCurrent = prior?.value.contractVersion === ZONING_DEVELOPMENT_INTELLIGENCE_VERSION;
  const changes = priorStands ? diff(prior!.value.materialDimensions, synthesis.materialDimensions) : [];
  if (priorStands && priorContractCurrent && prior!.value.materialFingerprint === synthesis.materialFingerprint) {
    return {
      outcome: 'unchanged',
      reason: 'No material authority, district, use, standard, threshold, path-applicability or subject-screen evidence changed; the current Development Path stands.',
      developmentPath: prior!.value,
      persistence: { snapshotId: prior!.snapshotId, written: false, skippedReason: 'no material change' },
      changes: [],
    };
  }

  const developmentPath: RetainedDevelopmentPath = {
    ...synthesis,
    basedOn: {
      authoritySnapshotId: authority?.correlation === 'equivalent' ? authority.snapshotId : null,
      boundarySnapshotId: boundary?.correlation === 'equivalent' ? boundary.snapshotId : null,
      zoningSnapshotId: zoning?.correlation === 'equivalent' ? zoning.snapshotId : null,
      standardsSnapshotId: standards?.correlation === 'equivalent' ? standards.snapshotId : null,
      regulationsSnapshotId: regulations?.correlation === 'equivalent' ? regulations.snapshotId : null,
      subdivisionReadSnapshotId: subdivisionRead?.correlation === 'equivalent' ? subdivisionRead.snapshotId : null,
      propertySnapshotId: propertyReading?.correlation === 'equivalent' ? propertyReading.snapshotId : null,
      subjectVersion: subject.subjectVersion,
    },
    inputStatus: {
      authority: statusOf(authority),
      boundary: statusOf(boundary),
      zoning: statusOf(zoning),
      standards: statusOf(standards),
      regulations: statusOf(regulations),
      subdivisionRead: statusOf(subdivisionRead),
      propertyStory: statusOf(propertyReading),
    },
    refresh: {
      cause: deps.cause,
      changes,
      priorSnapshotId: priorStands ? prior!.snapshotId : null,
      kind: !priorStands ? 'initial' : changes.length ? 'material' : 'contract',
    },
  };

  const write = deps.writeSnapshot ?? writeDerivedSnapshot;
  const result = write({
    dealCardId,
    snapshotType: ZONING_DEVELOPMENT_SNAPSHOT,
    payload: developmentPath,
    completeness: {
      authority: developmentPath.authority.zoning.name,
      authorityConflict: !!developmentPath.authority.conflict,
      district: developmentPath.zoning.districtCode,
      districtEstablished: developmentPath.zoning.established,
      paths: Object.fromEntries(developmentPath.paths.map((path) => [path.kind, path.applicability])),
      criticalGates: developmentPath.criticalGates.length,
      unknowns: developmentPath.unknowns.length,
      sources: developmentPath.sourceLineage.length,
      confidence: developmentPath.confidence,
      changes: changes.length,
    },
    changeReason: `Development Path (${developmentPath.refresh.kind}, ${deps.cause}): ${developmentPath.paths.map((path) => `${path.kind.replace(/_/g, ' ')} ${path.applicability.replace(/_/g, ' ')}`).join('; ')}`,
    actor: deps.actor ?? 'capability:zoning-development-intelligence',
    auditEvent: 'landos.development_path.write',
    capabilityId: ZONING_DEVELOPMENT_SKILL,
    runId: deps.runId ?? null,
  });
  const written = result.snapshotId != null && (!result.reused || result.reinstated === true);
  return {
    outcome: written ? 'produced' : 'unchanged',
    reason: written ? null : result.skippedReason ?? 'An identical Development Path is already retained.',
    developmentPath,
    persistence: { snapshotId: result.snapshotId, written, skippedReason: result.skippedReason },
    changes,
  };
}

// ── Settled intelligence without a path ─────────────────────────────────────

/** Deal Cards holding a current Property Story and no current Development
 *  Path under the current contract. Reconciled once on start. A SELECT. */
export function listDealsAwaitingDevelopmentPath(): number[] {
  const rows = getLandosDb().prepare(`
    SELECT DISTINCT s.deal_card_id AS id
    FROM landos_deal_intelligence_snapshot s
    WHERE s.snapshot_type = ? AND s.status = 'current'
      AND NOT EXISTS (
        SELECT 1 FROM landos_deal_intelligence_snapshot d
        WHERE d.deal_card_id = s.deal_card_id AND d.snapshot_type = ? AND d.status = 'current'
          AND json_extract(d.summary_json, '$.contractVersion') = ?
      )
    ORDER BY s.deal_card_id
  `).all(PROPERTY_EVIDENCE_SYNTHESIS_SNAPSHOT, ZONING_DEVELOPMENT_SNAPSHOT, ZONING_DEVELOPMENT_INTELLIGENCE_VERSION) as Array<{ id: number }>;
  return rows.map((row) => row.id);
}

// ── Reading back ────────────────────────────────────────────────────────────

/** The current retained Development Path, with its parcel correlation. A SELECT. */
export function readDevelopmentPath(dealCardId: number): RetainedReading<RetainedDevelopmentPath> | null {
  return readRetainedReading<RetainedDevelopmentPath>(dealCardId, ZONING_DEVELOPMENT_SNAPSHOT);
}

/** Prior reads, newest first, with the refresh record each carried. */
export function readDevelopmentPathHistory(dealCardId: number, limit = 10): Array<{
  snapshotId: number;
  version: number;
  retainedAt: string | null;
  authority: string | null;
  district: string | null;
  paths: Record<string, string>;
  refresh: DecisionRefresh;
}> {
  const rows = getLandosDb().prepare(`
    SELECT id, version, created_at, summary_json FROM landos_deal_intelligence_snapshot
    WHERE deal_card_id=? AND snapshot_type=? AND status='superseded'
    ORDER BY version DESC LIMIT ?
  `).all(dealCardId, ZONING_DEVELOPMENT_SNAPSHOT, limit) as Array<{ id: number; version: number; created_at: number; summary_json: string }>;
  const history: ReturnType<typeof readDevelopmentPathHistory> = [];
  for (const row of rows) {
    try {
      const value = JSON.parse(row.summary_json) as RetainedDevelopmentPath;
      history.push({
        snapshotId: row.id,
        version: row.version,
        retainedAt: row.created_at ? new Date(row.created_at * 1000).toISOString() : null,
        authority: value.authority?.zoning?.name ?? null,
        district: value.zoning?.districtCode ?? null,
        paths: Object.fromEntries((value.paths ?? []).map((path) => [path.kind, path.applicability])),
        refresh: value.refresh,
      });
    } catch { /* an unreadable historical row is skipped, never fatal */ }
  }
  return history;
}

// ── One truthful status ─────────────────────────────────────────────────────

export type DevelopmentPathStatus = 'current' | 'partial_current' | 'pending' | 'historical';

export interface DevelopmentPathStatusView {
  product: 'development_path';
  status: DevelopmentPathStatus;
  label: string;
  snapshotId: number | null;
  contractVersion: string | null;
  retainedAt: string | null;
  subjectVersion: string | null;
  correlation: ParcelCorrelation | null;
  coverage: string | null;
  limitation: string | null;
  consumedByDealBrain: boolean;
  link: string;
}

const STATUS_LABEL: Record<DevelopmentPathStatus, string> = {
  current: 'Current',
  partial_current: 'Partial — current',
  pending: 'Pending / No current read',
  historical: 'Historical',
};

/**
 * PURE. Map a retained Development Path to one truthful status, on the same
 * vocabulary the Stage 3 artifacts use so the Deal Brain and the cards agree.
 */
export function developmentPathStatus(
  reading: RetainedReading<RetainedDevelopmentPath> | null,
  options: { dealCardId: number; consumedSnapshotId?: number | null; subjectVersion?: string | null },
): DevelopmentPathStatusView {
  const link = `/dept/acquisitions/v2?deal=${options.dealCardId}&page=overview`;
  if (!reading) {
    return {
      product: 'development_path', status: 'pending', label: STATUS_LABEL.pending,
      snapshotId: null, contractVersion: null, retainedAt: null, subjectVersion: options.subjectVersion ?? null, correlation: null,
      coverage: null, limitation: 'The Development Path is pending: no current subject-equivalent read is retained.', consumedByDealBrain: false, link,
    };
  }
  const value = reading.value;
  const consumedByDealBrain = options.consumedSnapshotId != null && reading.snapshotId === options.consumedSnapshotId;
  if (reading.correlation !== 'equivalent') {
    return {
      product: 'development_path', status: 'historical', label: STATUS_LABEL.historical,
      snapshotId: reading.snapshotId, contractVersion: value.contractVersion ?? null, retainedAt: reading.retainedAt,
      subjectVersion: value.subject?.subjectVersion ?? options.subjectVersion ?? null, correlation: reading.correlation,
      coverage: null, limitation: `Formed about a ${reading.correlation === 'different' ? 'different' : 'uncorrelated'} parcel version; retained as history and excluded from current Deal Brain inputs.`,
      consumedByDealBrain: false, link,
    };
  }
  const established = value.paths.filter((path) => path.applicability !== 'not_established').length;
  const complete = value.zoning.established && !value.authority.conflict && value.paths.every((path) => path.applicability !== 'not_established');
  const status: DevelopmentPathStatus = complete ? 'current' : 'partial_current';
  return {
    product: 'development_path', status, label: STATUS_LABEL[status],
    snapshotId: reading.snapshotId, contractVersion: value.contractVersion ?? null, retainedAt: reading.retainedAt,
    subjectVersion: value.subject?.subjectVersion ?? options.subjectVersion ?? null, correlation: reading.correlation,
    coverage: `${value.authority.zoning.name ?? 'authority unresolved'} · ${value.zoning.established ? `district ${value.zoning.districtCode}` : 'district not established'} · ${established}/${value.paths.length} paths placed · ${value.criticalGates.length} critical gate(s)`,
    limitation: complete ? null : value.criticalGates[0]?.gate ?? value.unknowns[0] ?? null,
    consumedByDealBrain, link,
  };
}
