// LandOS — the shared durable seam for DERIVED post-resolution intelligence.
//
// Property Backstory, controlling land-use authority, current zoning and
// subdivision regulations are all the same shape of thing:
//
//   • append-only EVIDENCE about an identified property, and
//   • ONE current DERIVED read composed from that evidence, superseded rather
//     than overwritten when the evidence changes.
//
// LandOS already has both tables, and `official-document-intelligence-store.ts`
// already proved the pattern on official documents. This module is that pattern
// extracted so three more capabilities can reach it without a fourth copy of
// the SQL, and without a second intelligence database — which the sprint brief
// forbids and which would immediately drift from the evidence model.
//
//   evidence  →  landos_property_evidence_item
//                domain: caller's, evidence_kind: caller's
//                append-only by trigger; UNIQUE(idempotency_key) is the dedup
//
//   read      →  landos_deal_intelligence_snapshot
//                snapshot_type: caller's
//                UNIQUE(deal_card_id, input_hash) is the dedup; one `current`
//                row per type, priors superseded and retained
//
// Nothing here can move canonical identity. It reads the current property
// identity version to attach evidence to, and writes only to these two tables.

import { createHash } from 'node:crypto';

import { getLandosDb, landosAudit } from './db.js';
import { IntelligenceStackRunStore } from './intelligence-stack-run-store.js';
import { readCurrentPropertyIdentity } from './property-summary-slice.js';
import { apnIdentifiersCorroborate } from './apn-identity.js';

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
export const stableJson = (value: unknown): string => JSON.stringify(value ?? null);

export interface DerivedEvidenceInput {
  /** Free-text domain, e.g. 'land_use_authority'. */
  domain: string;
  evidenceKind: string;
  /** The fact this row carries, e.g. 'zoning_authority'. */
  factKey: string;
  raw: unknown;
  normalized: unknown;
  sourceName: string;
  sourceUrl: string | null;
  /** How the source speaks: 'official_government_source', 'reputable_secondary', … */
  sourceTier: string;
  confidence: string;
  retrievedAt: string;
  /** What makes this row distinct. Hashed into the idempotency key. */
  dedupeOn: string;
  /** Retained page/document/screenshot that carried this fact, when present. */
  artifactRef?: string | null;
}

export interface DerivedEvidenceResult {
  evidenceIds: number[];
  duplicates: number;
  propertyIdentityVersionId: number | null;
  skippedReason: string | null;
}

export type EvidenceWeight = 'confirmed' | 'well_supported' | 'likely' | 'unresolved';
export type EvidenceVerificationStatus = EvidenceWeight | 'retained_not_identity_verifying';

/** One vocabulary at the admission boundary, including older collector terms. */
export function normalizeEvidenceWeight(value: unknown): EvidenceWeight {
  const key = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['confirmed', 'verified', 'official', 'high'].includes(key)) return 'confirmed';
  if (['well_supported', 'supported', 'medium_high'].includes(key)) return 'well_supported';
  if (['likely', 'medium', 'probable'].includes(key)) return 'likely';
  return 'unresolved';
}

export interface EvidenceAdmissionInput {
  dealCardId: number;
  capabilityId: string;
  collectorKey: string;
  rows: readonly DerivedEvidenceInput[];
  runId?: string | null;
  actor?: string;
}

function runStillAuthoritative(runId: string | null | undefined, dealCardId: number): boolean {
  return !runId || new IntelligenceStackRunStore().isAuthoritative(runId, dealCardId);
}

/**
 * Append evidence rows for an identified property.
 *
 * Requires a current identity version: evidence in LandOS is always evidence
 * ABOUT an identified parcel, and that FK is what stops a zoning finding from
 * floating free of the property it describes. Without one nothing is written
 * and the reason is returned rather than swallowed.
 */
export function writeEvidence(input: EvidenceAdmissionInput): DerivedEvidenceResult {
  const identity = readCurrentPropertyIdentity(input.dealCardId);
  if (!identity) {
    return {
      evidenceIds: [],
      duplicates: 0,
      propertyIdentityVersionId: null,
      skippedReason: 'No current property identity version exists for this Deal Card, so derived evidence has nothing to attach to.',
    };
  }
  if (!input.rows.length) {
    return { evidenceIds: [], duplicates: 0, propertyIdentityVersionId: identity.id, skippedReason: null };
  }
  if (!runStillAuthoritative(input.runId, input.dealCardId)) {
    return {
      evidenceIds: [], duplicates: 0, propertyIdentityVersionId: identity.id,
      skippedReason: 'The originating run is no longer authoritative; late evidence was rejected.',
    };
  }

  const db = getLandosDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO landos_property_evidence_item (
      deal_card_id, property_identity_version_id, domain, evidence_kind, fact_key,
      raw_value_json, normalized_value_json, source_name, source_url, source_tier,
      verification_status, confidence, collector_key, retrieved_at, effective_at,
      artifact_ref, originating_capability, originating_run_id, claim, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findExisting = db.prepare('SELECT id FROM landos_property_evidence_item WHERE idempotency_key=?');

  const evidenceIds: number[] = [];
  let duplicates = 0;
  const write = db.transaction((rows: readonly DerivedEvidenceInput[]) => {
    if (!runStillAuthoritative(input.runId, input.dealCardId)) return false;
    for (const row of rows) {
      const idempotencyKey = `${row.domain}:${identity.id}:${row.factKey}:${input.runId ?? 'retained'}:${sha256(row.dedupeOn).slice(0, 24)}`;
      const outcome = insert.run(
        input.dealCardId,
        identity.id,
        row.domain,
        row.evidenceKind,
        row.factKey,
        stableJson(row.raw),
        stableJson(row.normalized),
        row.sourceName.slice(0, 300),
        row.sourceUrl,
        row.sourceTier,
        // Derived intelligence is retained evidence ABOUT an identified
        // property. It never verifies which property this is.
        'retained_not_identity_verifying',
        normalizeEvidenceWeight(row.confidence),
        input.collectorKey,
        row.retrievedAt,
        row.retrievedAt,
        row.artifactRef ?? null,
        input.capabilityId,
        input.runId ?? null,
        typeof row.normalized === 'string' ? row.normalized : stableJson(row.normalized),
        idempotencyKey,
      );
      if (outcome.changes > 0) evidenceIds.push(outcome.lastInsertRowid as number);
      else {
        duplicates += 1;
        const existing = findExisting.get(idempotencyKey) as { id: number } | undefined;
        if (existing) evidenceIds.push(existing.id);
      }
    }
    return true;
  });
  const accepted = write(input.rows);
  if (!accepted) {
    return {
      evidenceIds: [], duplicates: 0, propertyIdentityVersionId: identity.id,
      skippedReason: 'The originating run lost authority before evidence admission; late evidence was rejected.',
    };
  }
  return { evidenceIds, duplicates, propertyIdentityVersionId: identity.id, skippedReason: null };
}

/** Compatibility seam for established collectors; all rows still enter the
 * same authoritative admission function. */
export function appendDerivedEvidence(input: {
  dealCardId: number;
  collectorKey: string;
  rows: readonly DerivedEvidenceInput[];
  capabilityId?: string;
  runId?: string | null;
  actor?: string;
}): DerivedEvidenceResult {
  return writeEvidence({
    ...input,
    capabilityId: input.capabilityId ?? input.collectorKey,
  });
}

export interface DerivedSnapshotResult {
  snapshotId: number | null;
  reused: boolean;
  propertyIdentityVersionId: number | null;
  skippedReason: string | null;
}

/**
 * Write ONE current derived read, superseding the prior one.
 *
 * The same input produces the same `input_hash` and reuses the existing row, so
 * a re-run over unchanged evidence writes nothing and the read keeps its
 * original provenance. A genuinely changed read supersedes its predecessor and
 * the predecessor stays queryable as history.
 */
export function writeDerivedSnapshot(input: {
  dealCardId: number;
  snapshotType: string;
  payload: unknown;
  completeness: unknown;
  evidenceIds?: readonly number[];
  changeReason: string;
  actor: string;
  auditEvent?: string;
  capabilityId?: string;
  runId?: string | null;
}): DerivedSnapshotResult {
  const identity = readCurrentPropertyIdentity(input.dealCardId);
  if (!identity) {
    return {
      snapshotId: null,
      reused: false,
      propertyIdentityVersionId: null,
      skippedReason: 'No current property identity version exists for this Deal Card, so the derived read has nothing to attach to.',
    };
  }
  const db = getLandosDb();
  if (!runStillAuthoritative(input.runId, input.dealCardId)) {
    return {
      snapshotId: null, reused: false, propertyIdentityVersionId: identity.id,
      skippedReason: 'The originating run is no longer authoritative; the late current read was rejected.',
    };
  }
  const inputHash = sha256(stableJson({
    identityVersionId: identity.id,
    snapshotType: input.snapshotType,
    payload: input.payload,
  }));

  const existing = db.prepare(
    'SELECT id FROM landos_deal_intelligence_snapshot WHERE deal_card_id=? AND input_hash=?',
  ).get(input.dealCardId, inputHash) as { id: number } | undefined;
  if (existing) {
    return { snapshotId: existing.id, reused: true, propertyIdentityVersionId: identity.id, skippedReason: null };
  }

  const snapshotId = db.transaction(() => {
    if (!runStillAuthoritative(input.runId, input.dealCardId)) return null;
    const prior = db.prepare(`
      SELECT id FROM landos_deal_intelligence_snapshot
      WHERE deal_card_id=? AND snapshot_type=? AND status='current' LIMIT 1
    `).get(input.dealCardId, input.snapshotType) as { id: number } | undefined;
    const nextVersion = (db.prepare(`
      SELECT COALESCE(MAX(version), 0) + 1 AS version FROM landos_deal_intelligence_snapshot WHERE deal_card_id=?
    `).get(input.dealCardId) as { version: number }).version;
    if (prior) db.prepare("UPDATE landos_deal_intelligence_snapshot SET status='superseded' WHERE id=?").run(prior.id);
    const evidenceIds = input.evidenceIds ?? [];
    const result = db.prepare(`
      INSERT INTO landos_deal_intelligence_snapshot (
        deal_card_id, version, property_identity_version_id, prior_snapshot_id,
        snapshot_type, status, input_hash, evidence_max_id, completeness_json,
        summary_json, change_reason, generated_by, originating_capability, originating_run_id
      ) VALUES (?, ?, ?, ?, ?, 'current', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.dealCardId,
      nextVersion,
      identity.id,
      prior?.id ?? null,
      input.snapshotType,
      inputHash,
      evidenceIds.length ? Math.max(...evidenceIds) : null,
      stableJson(input.completeness),
      stableJson(input.payload),
      input.changeReason,
      input.actor,
      input.capabilityId ?? input.snapshotType,
      input.runId ?? null,
    );
    return result.lastInsertRowid as number;
  })();

  if (snapshotId == null) {
    return {
      snapshotId: null, reused: false, propertyIdentityVersionId: identity.id,
      skippedReason: 'The originating run lost authority before current-read admission; the late write was rejected.',
    };
  }

  if (input.auditEvent) {
    landosAudit(input.actor, input.auditEvent, `deal ${input.dealCardId}: ${input.snapshotType}`, {
      refTable: 'landos_deal_intelligence_snapshot',
      refId: snapshotId,
    });
  }
  return { snapshotId, reused: false, propertyIdentityVersionId: identity.id, skippedReason: null };
}

/** The one CURRENT derived read of this type, or null. A pure SELECT. */
export function readDerivedSnapshot<T>(dealCardId: number, snapshotType: string): T | null {
  const row = getLandosDb().prepare(`
    SELECT summary_json FROM landos_deal_intelligence_snapshot
    WHERE deal_card_id=? AND snapshot_type=? AND status='current' LIMIT 1
  `).get(dealCardId, snapshotType) as { summary_json: string } | undefined;
  if (!row) return null;
  try { return JSON.parse(row.summary_json) as T; } catch { return null; }
}

/**
 * Is a derived read still about the parcel this Deal Card is now about?
 *
 * Three honest answers, because there are three real situations:
 *
 *   equivalent    — the stored and accepted identities are AFFIRMATIVELY proven
 *                   to be one parcel. The read may stand as current.
 *   different     — they affirmatively name different parcels. Withheld from
 *                   every current surface, preserved as history.
 *   uncorrelated  — LandOS cannot prove either way from what it retained. Also
 *                   withheld from current surfaces: parcel-specific zoning,
 *                   subdivision, backstory and record-risk conclusions may only
 *                   be presented as current truth when the parcel is PROVEN, and
 *                   the Stage 1 rule that an absent correlation is uncorrelated
 *                   rather than current is the same rule.
 *
 * Equivalence is never inferred from identity-version row equality: a version
 * bumps for a candidate→confirmed promotion and for APN punctuation
 * normalization, neither of which moves the subject.
 *
 * Jurisdiction is established from the strongest retained evidence available,
 * and an APN is never corroborated across a conflicting one.
 */
export type ParcelCorrelation = 'equivalent' | 'different' | 'uncorrelated';

interface IdentityFacts {
  apn: string | null;
  lpPropertyId: string | null;
  fips: string | null;
  county: string | null;
  state: string | null;
  propertyCardId: number | null;
}

const clean = (value: unknown): string | null => {
  const text = String(value ?? '').trim();
  return text && text !== '-' ? text : null;
};
const lower = (value: string | null): string | null => (value == null ? null : value.toLowerCase());
const countyKey = (value: string | null): string | null =>
  lower(value)?.replace(/\s+county$/, '').replace(/\s+/g, ' ').trim() || null;

/** Identity facts for one version row, enriched from its property card — the
 *  version table carries no FIPS or provider id, and both are stronger
 *  jurisdiction evidence than a county name. */
function identityFactsForVersion(versionId: number): IdentityFacts | null {
  const row = getLandosDb().prepare(`
    SELECT v.apn, v.county, v.state, v.property_card_id, pc.fips, pc.lp_property_id
    FROM landos_property_identity_version v
    LEFT JOIN landos_property_card pc ON pc.id = v.property_card_id
    WHERE v.id = ?
  `).get(versionId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    apn: clean(row.apn),
    lpPropertyId: clean(row.lp_property_id),
    fips: clean(row.fips),
    county: clean(row.county),
    state: clean(row.state),
    propertyCardId: Number.isInteger(Number(row.property_card_id)) ? Number(row.property_card_id) : null,
  };
}

/**
 * Do two identities describe the same jurisdiction?
 *
 * `true` / `false` are affirmative; `null` means the retained evidence does not
 * establish it either way.
 *
 * The version row's OWN county and state lead, because they are what that
 * version actually recorded. County FIPS is the stronger identifier in general,
 * but it lives on the shared property card rather than on the version, so for
 * two versions of one Deal Card it is the SAME value on both sides and can
 * neither confirm nor deny that the subject moved. It is therefore used only
 * where it is genuinely per-side evidence — when the two versions point at
 * different property cards — and otherwise as a fallback when a version states
 * no county or state of its own.
 */
function sameJurisdiction(a: IdentityFacts, b: IdentityFacts): boolean | null {
  const aState = lower(a.state);
  const bState = lower(b.state);
  const aCounty = countyKey(a.county);
  const bCounty = countyKey(b.county);
  if (aState && bState && aCounty && bCounty) return aState === bState && aCounty === bCounty;
  if (aState && bState && aState !== bState) return false;
  // A version that recorded no jurisdiction of its own: fall back to FIPS,
  // which is only informative when the two sides carry different cards.
  if (a.fips && b.fips && a.propertyCardId !== b.propertyCardId) return a.fips === b.fips;
  return null;
}

/** Correlate the identity a derived read answered about against the accepted one. */
export function correlateIdentityVersions(
  wroteAgainstVersionId: number | null,
  dealCardId: number,
): ParcelCorrelation {
  // An absent correlation stamp is uncorrelated, never current.
  if (wroteAgainstVersionId == null) return 'uncorrelated';
  const current = readCurrentPropertyIdentity(dealCardId);
  if (!current) return 'uncorrelated';
  if (wroteAgainstVersionId === current.id) return 'equivalent';

  const wrote = identityFactsForVersion(wroteAgainstVersionId);
  const accepted = identityFactsForVersion(current.id);
  // The historical identity row is gone: nothing left to prove equivalence with.
  if (!wrote || !accepted) return 'uncorrelated';

  const jurisdiction = sameJurisdiction(wrote, accepted);
  if (jurisdiction === false) return 'different';

  // Strongest identifier first: a provider parcel id is exact, so it decides
  // on its own once jurisdiction is not in conflict.
  if (wrote.lpPropertyId && accepted.lpPropertyId) {
    if (wrote.lpPropertyId !== accepted.lpPropertyId) return 'different';
    return jurisdiction === true ? 'equivalent' : 'uncorrelated';
  }

  if (!wrote.apn || !accepted.apn) return 'uncorrelated';
  if (!apnIdentifiersCorroborate(wrote.apn, accepted.apn)) return 'different';
  // Corroborating identifiers still need their jurisdiction proven: the same
  // parcel number exists in many counties.
  return jurisdiction === true ? 'equivalent' : 'uncorrelated';
}

/**
 * The current derived read of this type with its parcel correlation.
 *
 * Returns null when no current read of this type exists at all.
 */
export function readDerivedSnapshotForParcel<T>(
  dealCardId: number,
  snapshotType: string,
): { value: T; correlation: ParcelCorrelation } | null {
  const row = getLandosDb().prepare(`
    SELECT summary_json, property_identity_version_id FROM landos_deal_intelligence_snapshot
    WHERE deal_card_id=? AND snapshot_type=? AND status='current' LIMIT 1
  `).get(dealCardId, snapshotType) as
    { summary_json: string; property_identity_version_id: number | null } | undefined;
  if (!row) return null;
  let value: T;
  try { value = JSON.parse(row.summary_json) as T; } catch { return null; }
  return { value, correlation: correlateIdentityVersions(row.property_identity_version_id, dealCardId) };
}

/** Superseded reads of this type, oldest first. Retained as history. */
export function readDerivedSnapshotHistory<T>(dealCardId: number, snapshotType: string): T[] {
  const rows = getLandosDb().prepare(`
    SELECT summary_json FROM landos_deal_intelligence_snapshot
    WHERE deal_card_id=? AND snapshot_type=? AND status='superseded'
    ORDER BY version
  `).all(dealCardId, snapshotType) as Array<{ summary_json: string }>;
  return rows
    .map((row) => { try { return JSON.parse(row.summary_json) as T; } catch { return null; } })
    .filter((row): row is T => row != null);
}

export interface DerivedEvidenceRow {
  evidenceId: number;
  factKey: string;
  raw: unknown;
  normalized: unknown;
  sourceName: string;
  sourceUrl: string | null;
  sourceTier: string;
  confidence: string;
  retrievedAt: string;
}

/** Every retained evidence row in one domain for this Deal Card. */
export function readDerivedEvidence(dealCardId: number, domain: string, collectorKey?: string): DerivedEvidenceRow[] {
  const db = getLandosDb();
  const rows = collectorKey
    ? db.prepare(`
        SELECT id, fact_key, raw_value_json, normalized_value_json, source_name, source_url,
               source_tier, confidence, retrieved_at
        FROM landos_property_evidence_item
        WHERE deal_card_id=? AND domain=? AND collector_key=? ORDER BY id
      `).all(dealCardId, domain, collectorKey)
    : db.prepare(`
        SELECT id, fact_key, raw_value_json, normalized_value_json, source_name, source_url,
               source_tier, confidence, retrieved_at
        FROM landos_property_evidence_item
        WHERE deal_card_id=? AND domain=? ORDER BY id
      `).all(dealCardId, domain);
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    evidenceId: Number(row.id),
    factKey: String(row.fact_key ?? ''),
    raw: safeParse(String(row.raw_value_json ?? 'null')),
    normalized: safeParse(String(row.normalized_value_json ?? 'null')),
    sourceName: String(row.source_name ?? ''),
    sourceUrl: row.source_url == null ? null : String(row.source_url),
    sourceTier: String(row.source_tier ?? ''),
    confidence: String(row.confidence ?? ''),
    retrievedAt: String(row.retrieved_at ?? ''),
  }));
}

function safeParse(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}
