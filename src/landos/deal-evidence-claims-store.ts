// Load the evidence a Deal already retained, and interpret it.
//
// This is the only I/O half of `deal-evidence-claims`. It reads rows LandOS
// already wrote — the immutable `landos_intake_artifact` extractions and the
// current confirmed identity version — and hands them to the pure reconciler.
// It writes nothing and retrieves nothing: re-running it re-reads retained
// state, never the operator's files and never a model.

import { getLandosDb } from './db.js';
import {
  interpretDealEvidence,
  type DealEvidenceInterpretation,
  type DealWorkingState,
  type RetainedEvidenceArtifact,
} from './deal-evidence-claims.js';

/** The artifacts this Deal has already had interpreted. No bytes are touched. */
export function loadRetainedEvidenceArtifacts(dealCardId: number): RetainedEvidenceArtifact[] {
  const rows = getLandosDb().prepare(`
    SELECT id, document_upload_id, original_file_name, extraction_status,
           exact_extracted_text, extraction_json, captured_at
      FROM landos_intake_artifact
     WHERE deal_card_id = ?
     ORDER BY captured_at ASC, id ASC
  `).all(dealCardId) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    let candidates: Record<string, string> = {};
    try {
      const parsed = JSON.parse(String(row.extraction_json ?? '{}')) as { candidates?: unknown };
      if (parsed.candidates && typeof parsed.candidates === 'object') {
        candidates = Object.fromEntries(
          Object.entries(parsed.candidates as Record<string, unknown>)
            .map(([key, value]) => [key, String(value ?? '')]),
        );
      }
    } catch { /* An unparseable extraction is not a claim; it stays empty. */ }
    return {
      artifactId: Number(row.id),
      uploadId: row.document_upload_id == null ? null : Number(row.document_upload_id),
      fileName: String(row.original_file_name ?? 'upload'),
      extractionStatus: String(row.extraction_status ?? 'unavailable'),
      exactText: String(row.exact_extracted_text ?? ''),
      candidates,
      capturedAt: Number(row.captured_at ?? 0),
    };
  });
}

/**
 * The Deal's current working conclusion, from the identity version the spine
 * marked current. This is what claims are compared against; it is read only.
 */
export function loadDealWorkingState(dealCardId: number): DealWorkingState & { acreageBasis: string | null } {
  const row = getLandosDb().prepare(`
    SELECT apn, owner, acreage, address, county, basis
      FROM landos_property_identity_version
     WHERE deal_card_id = ? AND is_current = 1
     ORDER BY version DESC
     LIMIT 1
  `).get(dealCardId) as Record<string, unknown> | undefined;
  if (!row) return { apn: null, owner: null, acreage: null, roadName: null, county: null, acreageBasis: null };
  const address = String(row.address ?? '');
  // The road the parcel fronts, as the address states it. Physical evidence
  // only; it says nothing about a legal right of access.
  const road = address.match(/\b((?:N\.?W\.?|N\.?E\.?|S\.?W\.?|S\.?E\.?)\s*[0-9]+(?:ST|ND|RD|TH)\s+\w+)/i)?.[1] ?? null;
  return {
    apn: row.apn == null ? null : String(row.apn),
    owner: row.owner == null ? null : String(row.owner),
    acreage: row.acreage == null ? null : Number(row.acreage),
    roadName: road,
    county: row.county == null ? null : String(row.county),
    acreageBasis: row.basis == null ? null : String(row.basis),
  };
}

/**
 * The Deal's provider/GIS acreage, when a parcel record carries one that the
 * identity version's own figure did not come from. Kept separate so the
 * acreage reconciler can name what each number measures.
 */
function loadProviderAcreage(dealCardId: number): { acres: number | null; label: string | null } {
  try {
    // The GIS figure is already stored as its own labeled evidence fact, from
    // the parcel layer that produced it. Reading it from there rather than from
    // the identity version is what keeps a computed polygon area from ever
    // being mistaken for the subject's working acreage: it arrives already
    // named "GIS mapped acreage", with its own source.
    const row = getLandosDb().prepare(`
      SELECT normalized_value_json, raw_value_json, fact_key, source_name
        FROM landos_property_evidence_item
       WHERE deal_card_id = ?
         AND evidence_kind = 'normalized_fact'
         AND fact_key LIKE '%acreage%'
         AND fact_key LIKE '%GIS%'
       ORDER BY id DESC LIMIT 1
    `).get(dealCardId) as Record<string, unknown> | undefined;
    if (!row) return { acres: null, label: null };
    const raw = String(row.normalized_value_json ?? row.raw_value_json ?? '').replace(/"/g, '');
    const acres = Number.parseFloat(raw);
    if (!Number.isFinite(acres)) return { acres: null, label: null };
    return { acres, label: `${String(row.fact_key)} — ${String(row.source_name ?? 'provider parcel layer')}` };
  } catch {
    return { acres: null, label: null };
  }
}

/**
 * The Deal's provider/mapped road frontage, when a parcel record carries one.
 *
 * Kept on its own read path for the same reason the GIS acreage is: a figure a
 * provider computed from a polygon is a different measurement from a boundary
 * a surveyor ran, and the two must arrive already labeled so neither can be
 * substituted for the other. Absent is reported as absent; nothing is assumed.
 */
function loadProviderFrontage(dealCardId: number): { feet: number | null; label: string | null } {
  try {
    // Subject-scoped, deliberately. A Deal's retained inspections include
    // panels for parcels that are NOT the subject, so a frontage figure is only
    // the subject's when the SAME capture also named the canonical APN.
    // Without that join a neighbouring parcel's 405.17 ft reads as this
    // parcel's frontage — invariant 4, in the provider facts.
    const canonical = String(loadDealWorkingState(dealCardId).apn ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    if (!canonical) return { feet: null, label: null };
    const row = getLandosDb().prepare(`
      SELECT f.normalized_value_json, f.raw_value_json, f.fact_key, f.source_name
        FROM landos_property_evidence_item f
        JOIN landos_property_evidence_item pid
          ON pid.deal_card_id = f.deal_card_id
         AND pid.artifact_ref = f.artifact_ref
         AND pid.fact_key = 'LandPortal parcel identifier'
       WHERE f.deal_card_id = ?
         AND f.evidence_kind = 'normalized_fact'
         AND f.fact_key = 'LandPortal road frontage'
         AND UPPER(REPLACE(REPLACE(REPLACE(pid.normalized_value_json, '"', ''), '-', ''), '.', '')) = ?
       ORDER BY f.id DESC LIMIT 1
    `).get(dealCardId, canonical) as Record<string, unknown> | undefined;
    if (!row) return { feet: null, label: null };
    const raw = String(row.normalized_value_json ?? row.raw_value_json ?? '').replace(/"/g, '');
    const feet = Number.parseFloat(raw);
    if (!Number.isFinite(feet)) return { feet: null, label: null };
    return { feet, label: String(row.source_name ?? 'provider parcel record') };
  } catch {
    return { feet: null, label: null };
  }
}

/**
 * Interpret everything this Deal has retained.
 *
 * Safe to call on every evidence event: it is derived state over immutable
 * artifacts, so it is idempotent and costs no retrieval.
 */
export function interpretRetainedDealEvidence(dealCardId: number): DealEvidenceInterpretation {
  const artifacts = loadRetainedEvidenceArtifacts(dealCardId);
  const state = loadDealWorkingState(dealCardId);
  const provider = loadProviderAcreage(dealCardId);
  const frontage = loadProviderFrontage(dealCardId);
  return interpretDealEvidence({
    artifacts,
    state,
    providerAcres: provider.acres,
    providerAcreageLabel: provider.label,
    providerFrontageFeet: frontage.feet,
    providerFrontageLabel: frontage.label,
  });
}
