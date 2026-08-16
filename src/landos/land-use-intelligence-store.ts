// LandOS — durable controlling authority, current zoning and subdivision rules.
//
// Four derived reads and their supporting evidence, on the two tables LandOS
// already has. No new database, no fifth architecture.
//
// EVIDENCE, append-only, one row per established fact:
//   domain 'land_use_authority'      — who administers zoning / subdivision
//   domain 'current_zoning'          — the district, with its parcel match basis
//   domain 'subdivision_regulation'  — one row per extracted rule, with section
//
// DERIVED READS, one current row each, superseded rather than overwritten:
//   land_use_authority_v1
//   current_zoning_v1
//   subdivision_regulations_v1
//   subdivision_property_read_v1
//
// A conclusion in any of these reads is traceable to an evidence row, and an
// evidence row is traceable to a named source with a URL. Nothing here writes to
// the property card or the identity version, so no generated summary can move
// canonical identity.

import {
  appendDerivedEvidence,
  readDerivedEvidence,
  readDerivedSnapshot,
  readDerivedSnapshotHistory,
  writeDerivedSnapshot,
  type DerivedEvidenceInput,
} from './derived-intelligence-store.js';
import type { ControllingLandUseAuthority } from './controlling-land-use-authority.js';
import type { CurrentZoningDetermination } from './current-zoning-determination.js';
import type { SubdivisionRegulations } from './subdivision-regulations.js';
import type { ZoningStandardsResult } from './zoning-standards-research.js';
import type { PropertySubdivisionRead } from './subdivision-property-read.js';

export const LAND_USE_AUTHORITY_DOMAIN = 'land_use_authority';
export const CURRENT_ZONING_DOMAIN = 'current_zoning';
export const SUBDIVISION_REGULATION_DOMAIN = 'subdivision_regulation';

export const LAND_USE_AUTHORITY_SNAPSHOT_TYPE = 'land_use_authority_v1';
export const CURRENT_ZONING_SNAPSHOT_TYPE = 'current_zoning_v1';
export const SUBDIVISION_REGULATIONS_SNAPSHOT_TYPE = 'subdivision_regulations_v1';
export const SUBDIVISION_PROPERTY_READ_SNAPSHOT_TYPE = 'subdivision_property_read_v1';
export const ZONING_STANDARDS_SNAPSHOT_TYPE = 'zoning_standards_v1';
export const ZONING_STANDARD_DOMAIN = 'zoning_standard';

export const LAND_USE_INTELLIGENCE_COLLECTOR = 'land_use_intelligence';

export interface PersistLandUseResult {
  persisted: boolean;
  snapshotId: number | null;
  reused: boolean;
  evidenceIds: number[];
  skippedReason: string | null;
}

/**
 * Persist the controlling authority.
 *
 * Only an ASSIGNED authority writes an evidence row. An unresolved or ambiguous
 * assignment produces no fact row — there is no fact — while the derived read
 * still records the attempt, the sources seen, and why nothing was assigned.
 */
export function persistControllingAuthority(input: {
  authority: ControllingLandUseAuthority;
  actor?: string;
}): PersistLandUseResult {
  const { authority } = input;
  const rows: DerivedEvidenceInput[] = [];
  for (const [factKey, assignment] of [
    ['zoning_authority', authority.zoningAuthority],
    ['subdivision_authority', authority.subdivisionAuthority],
  ] as const) {
    if (!assignment.name || assignment.determination === 'unresolved' || assignment.determination === 'ambiguous') continue;
    const source = assignment.sources[0];
    rows.push({
      domain: LAND_USE_AUTHORITY_DOMAIN,
      evidenceKind: 'authority_determination',
      factKey,
      raw: { quote: source?.quote ?? '', basis: assignment.basis },
      normalized: { name: assignment.name, level: assignment.level, determination: assignment.determination },
      sourceName: source?.label ?? 'Official government source',
      sourceUrl: source?.url ?? null,
      sourceTier: source?.tier ?? 'official_government_source',
      confidence: assignment.determination,
      retrievedAt: authority.verifiedAt,
      dedupeOn: `${factKey}|${assignment.name}|${source?.url ?? ''}`,
    });
  }

  const evidence = appendDerivedEvidence({
    dealCardId: authority.dealCardId,
    collectorKey: LAND_USE_INTELLIGENCE_COLLECTOR,
    rows,
    actor: input.actor,
  });
  const snapshot = writeDerivedSnapshot({
    dealCardId: authority.dealCardId,
    snapshotType: LAND_USE_AUTHORITY_SNAPSHOT_TYPE,
    payload: authority,
    completeness: {
      zoningAuthority: authority.zoningAuthority.determination,
      subdivisionAuthority: authority.subdivisionAuthority.determination,
      sourceCount: authority.sources.length,
      conflicts: authority.conflicts,
      limitations: authority.limitations,
    },
    evidenceIds: evidence.evidenceIds,
    changeReason: authority.zoningAuthority.name
      ? `Controlling zoning authority established as ${authority.zoningAuthority.name} from an official source.`
      : 'Controlling zoning authority remains unresolved; no official source established who administers it.',
    actor: input.actor ?? LAND_USE_INTELLIGENCE_COLLECTOR,
    auditEvent: 'land_use_authority_persisted',
  });
  return {
    persisted: snapshot.snapshotId != null,
    snapshotId: snapshot.snapshotId,
    reused: snapshot.reused,
    evidenceIds: evidence.evidenceIds,
    skippedReason: snapshot.skippedReason ?? evidence.skippedReason,
  };
}

/** Persist the current zoning determination. Unresolved writes no fact row. */
export function persistCurrentZoning(input: {
  zoning: CurrentZoningDetermination;
  actor?: string;
}): PersistLandUseResult {
  const { zoning } = input;
  const rows: DerivedEvidenceInput[] = [];
  if (zoning.established && zoning.districtCode) {
    rows.push({
      domain: CURRENT_ZONING_DOMAIN,
      evidenceKind: 'zoning_determination',
      factKey: 'current_zoning_district',
      raw: { parcelMatchBasis: zoning.parcelMatchBasis, evidenceKind: zoning.evidenceKind },
      normalized: {
        districtCode: zoning.districtCode,
        districtName: zoning.districtName,
        overlays: zoning.overlays,
        authorityName: zoning.authorityName,
        effectiveOrAsOf: zoning.effectiveOrAsOf,
      },
      sourceName: zoning.sourceLabel ?? 'Official zoning source',
      sourceUrl: zoning.sourceUrl,
      sourceTier: 'official_government_source',
      confidence: zoning.confidence,
      retrievedAt: zoning.verifiedAt,
      dedupeOn: `current_zoning|${zoning.districtCode}|${zoning.sourceUrl ?? ''}`,
    });
  }
  const evidence = appendDerivedEvidence({
    dealCardId: zoning.dealCardId,
    collectorKey: LAND_USE_INTELLIGENCE_COLLECTOR,
    rows,
    actor: input.actor,
  });
  const snapshot = writeDerivedSnapshot({
    dealCardId: zoning.dealCardId,
    snapshotType: CURRENT_ZONING_SNAPSHOT_TYPE,
    payload: zoning,
    completeness: {
      established: zoning.established,
      evidenceKind: zoning.evidenceKind,
      conflicts: zoning.conflicts,
      historicalReferenceCount: zoning.historicalReferences.length,
      limitations: zoning.limitations,
    },
    evidenceIds: evidence.evidenceIds,
    changeReason: zoning.established
      ? `Current zoning established as ${zoning.districtCode} from ${zoning.evidenceKind?.replace(/_/g, ' ')}.`
      : 'Current zoning remains unresolved; no current parcel-specific official source established the district.',
    actor: input.actor ?? LAND_USE_INTELLIGENCE_COLLECTOR,
    auditEvent: 'current_zoning_persisted',
  });
  return {
    persisted: snapshot.snapshotId != null,
    snapshotId: snapshot.snapshotId,
    reused: snapshot.reused,
    evidenceIds: evidence.evidenceIds,
    skippedReason: snapshot.skippedReason ?? evidence.skippedReason,
  };
}

/** Persist the subdivision rule set. One evidence row per extracted rule. */
export function persistSubdivisionRegulations(input: {
  regulations: SubdivisionRegulations;
  actor?: string;
}): PersistLandUseResult {
  const { regulations } = input;
  const rows: DerivedEvidenceInput[] = regulations.rules.map((rule) => ({
    domain: SUBDIVISION_REGULATION_DOMAIN,
    evidenceKind: 'subdivision_rule',
    factKey: rule.key,
    raw: { quote: rule.quote, limitations: rule.limitations },
    normalized: {
      label: rule.label,
      value: rule.value,
      section: rule.section,
      authorityName: rule.authorityName,
      effectiveOrAsOf: rule.effectiveOrAsOf,
    },
    sourceName: rule.sourceLabel,
    sourceUrl: rule.sourceUrl,
    sourceTier: rule.confidence === 'likely' ? 'reputable_secondary' : 'official_government_source',
    confidence: rule.confidence,
    retrievedAt: regulations.retrievedAt,
    dedupeOn: `${rule.key}|${rule.section ?? ''}|${rule.value}|${rule.sourceUrl ?? ''}`,
  }));

  const evidence = appendDerivedEvidence({
    dealCardId: regulations.dealCardId,
    collectorKey: LAND_USE_INTELLIGENCE_COLLECTOR,
    rows,
    actor: input.actor,
  });
  const snapshot = writeDerivedSnapshot({
    dealCardId: regulations.dealCardId,
    snapshotType: SUBDIVISION_REGULATIONS_SNAPSHOT_TYPE,
    payload: regulations,
    completeness: {
      ruleCount: regulations.rules.length,
      documentCount: regulations.documents.length,
      statedMaxMinorLots: regulations.thresholds.statedMaxMinorLots,
      limitations: regulations.limitations,
    },
    evidenceIds: evidence.evidenceIds,
    changeReason: regulations.rules.length
      ? `${regulations.rules.length} subdivision rule(s) extracted from ${regulations.documents.length} official document(s).`
      : 'No subdivision rule could be extracted from the retrieved sources.',
    actor: input.actor ?? LAND_USE_INTELLIGENCE_COLLECTOR,
    auditEvent: 'subdivision_regulations_persisted',
  });
  return {
    persisted: snapshot.snapshotId != null,
    snapshotId: snapshot.snapshotId,
    reused: snapshot.reused,
    evidenceIds: evidence.evidenceIds,
    skippedReason: snapshot.skippedReason ?? evidence.skippedReason,
  };
}

/**
 * Persist the property-specific read.
 *
 * Writes NO evidence row. It is a conclusion drawn from evidence already
 * stored, and a derived conclusion must never be able to masquerade as a
 * retrieved fact.
 */
export function persistPropertySubdivisionRead(input: {
  read: PropertySubdivisionRead;
  actor?: string;
}): PersistLandUseResult {
  const snapshot = writeDerivedSnapshot({
    dealCardId: input.read.dealCardId,
    snapshotType: SUBDIVISION_PROPERTY_READ_SNAPSHOT_TYPE,
    payload: input.read,
    completeness: {
      likelyPath: input.read.likelyPath.kind,
      reviewIndication: input.read.reviewIndication,
      theoreticalLotCount: input.read.theoreticalLotCount.value,
      theoreticalIsNotApproved: true,
      constraintCount: input.read.constraints.length,
      limitations: input.read.limitations,
    },
    changeReason: `Property-specific subdivision read: ${input.read.likelyPath.kind.replace(/_/g, ' ')} (${input.read.likelyPath.basis}).`,
    actor: input.actor ?? LAND_USE_INTELLIGENCE_COLLECTOR,
    auditEvent: 'subdivision_property_read_persisted',
  });
  return {
    persisted: snapshot.snapshotId != null,
    snapshotId: snapshot.snapshotId,
    reused: snapshot.reused,
    evidenceIds: [],
    skippedReason: snapshot.skippedReason,
  };
}

/**
 * Persist the allowed uses and dimensional standards for the district.
 *
 * One evidence row per cited standard, so a minimum lot size is traceable to
 * the ordinance section that states it rather than only to a derived read.
 */
export function persistZoningStandards(input: {
  standards: ZoningStandardsResult;
  actor?: string;
}): PersistLandUseResult {
  const { standards } = input;
  const rows: DerivedEvidenceInput[] = [];
  if (standards.established && standards.districtCode) {
    for (const [factKey, value] of [
      ['minimum_lot_size', standards.standards.minimumLotSize],
      ['minimum_frontage', standards.standards.frontage],
      ['minimum_lot_width', standards.standards.lotWidth],
      ['density', standards.standards.density],
      ['setbacks', standards.standards.setbacks],
      ['height_or_coverage', standards.standards.heightOrCoverage],
    ] as const) {
      if (!value) continue;
      const source = standards.standards.sources.find((row) => row.quote.includes(value.slice(0, 24))) ?? standards.standards.sources[0];
      rows.push({
        domain: ZONING_STANDARD_DOMAIN,
        evidenceKind: 'dimensional_standard',
        factKey,
        raw: { quote: source?.quote ?? value },
        normalized: { districtCode: standards.districtCode, value, section: source?.section ?? null },
        sourceName: source?.label ?? standards.documents[0]?.label ?? 'Adopted zoning ordinance',
        sourceUrl: source?.url ?? standards.documents[0]?.url ?? null,
        sourceTier: 'official_government_source',
        confidence: 'confirmed',
        retrievedAt: standards.retrievedAt,
        dedupeOn: `${factKey}|${standards.districtCode}|${value}`,
      });
    }
    for (const use of standards.allowedUses) {
      rows.push({
        domain: ZONING_STANDARD_DOMAIN,
        evidenceKind: 'allowed_use',
        factKey: `use_${use.status}`,
        raw: { quote: use.quote },
        normalized: { districtCode: standards.districtCode, use: use.use, status: use.status, section: use.section },
        sourceName: use.sourceLabel,
        sourceUrl: use.sourceUrl,
        sourceTier: 'official_government_source',
        confidence: 'confirmed',
        retrievedAt: standards.retrievedAt,
        dedupeOn: `${use.status}|${standards.districtCode}|${use.use.slice(0, 80)}`,
      });
    }
  }

  const evidence = appendDerivedEvidence({
    dealCardId: standards.dealCardId,
    collectorKey: LAND_USE_INTELLIGENCE_COLLECTOR,
    rows,
    actor: input.actor,
  });
  const snapshot = writeDerivedSnapshot({
    dealCardId: standards.dealCardId,
    snapshotType: ZONING_STANDARDS_SNAPSHOT_TYPE,
    payload: standards,
    completeness: {
      districtCode: standards.districtCode,
      established: standards.established,
      allowedUseCount: standards.allowedUses.length,
      documentCount: standards.documents.length,
      conflicts: standards.conflicts,
      limitations: standards.limitations,
    },
    evidenceIds: evidence.evidenceIds,
    changeReason: standards.established
      ? `Allowed uses and dimensional standards established for district ${standards.districtCode} from the adopted code.`
      : `No adopted source established the standards for district ${standards.districtCode ?? 'unknown'}.`,
    actor: input.actor ?? LAND_USE_INTELLIGENCE_COLLECTOR,
    auditEvent: 'zoning_standards_persisted',
  });
  return {
    persisted: snapshot.snapshotId != null,
    snapshotId: snapshot.snapshotId,
    reused: snapshot.reused,
    evidenceIds: evidence.evidenceIds,
    skippedReason: snapshot.skippedReason ?? evidence.skippedReason,
  };
}

// ── Reading it back ─────────────────────────────────────────────────────────

export function readControllingAuthority(dealCardId: number): ControllingLandUseAuthority | null {
  return readDerivedSnapshot<ControllingLandUseAuthority>(dealCardId, LAND_USE_AUTHORITY_SNAPSHOT_TYPE);
}

export function readCurrentZoning(dealCardId: number): CurrentZoningDetermination | null {
  return readDerivedSnapshot<CurrentZoningDetermination>(dealCardId, CURRENT_ZONING_SNAPSHOT_TYPE);
}

export function readZoningStandards(dealCardId: number): ZoningStandardsResult | null {
  return readDerivedSnapshot<ZoningStandardsResult>(dealCardId, ZONING_STANDARDS_SNAPSHOT_TYPE);
}

export function readSubdivisionRegulations(dealCardId: number): SubdivisionRegulations | null {
  return readDerivedSnapshot<SubdivisionRegulations>(dealCardId, SUBDIVISION_REGULATIONS_SNAPSHOT_TYPE);
}

export function readPropertySubdivisionRead(dealCardId: number): PropertySubdivisionRead | null {
  return readDerivedSnapshot<PropertySubdivisionRead>(dealCardId, SUBDIVISION_PROPERTY_READ_SNAPSHOT_TYPE);
}

export function readCurrentZoningHistory(dealCardId: number): CurrentZoningDetermination[] {
  return readDerivedSnapshotHistory<CurrentZoningDetermination>(dealCardId, CURRENT_ZONING_SNAPSHOT_TYPE);
}

/**
 * Every superseded subdivision rule set, oldest first.
 *
 * A run whose retrieval reached nothing writes a current snapshot carrying no
 * document, which is honest about that run and useless as a starting point for
 * the next one. The history is where the documents this jurisdiction is known
 * to publish are still recorded.
 */
export function readSubdivisionRegulationsHistory(dealCardId: number): SubdivisionRegulations[] {
  return readDerivedSnapshotHistory<SubdivisionRegulations>(dealCardId, SUBDIVISION_REGULATIONS_SNAPSHOT_TYPE);
}

/** Every retained subdivision rule row, with its section and source. */
export function readSubdivisionRuleEvidence(dealCardId: number): ReturnType<typeof readDerivedEvidence> {
  return readDerivedEvidence(dealCardId, SUBDIVISION_REGULATION_DOMAIN, LAND_USE_INTELLIGENCE_COLLECTOR);
}

/** Every retained authority determination row. */
export function readAuthorityEvidence(dealCardId: number): ReturnType<typeof readDerivedEvidence> {
  return readDerivedEvidence(dealCardId, LAND_USE_AUTHORITY_DOMAIN, LAND_USE_INTELLIGENCE_COLLECTOR);
}
