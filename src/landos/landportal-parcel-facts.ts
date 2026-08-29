// LandOS — the LandPortal parcel panel becomes evidence.
//
// THE DEFECT THIS REPAIRS.
//
// LandPortal was reached, the parcel panel was read, and the capture was
// retained verbatim on the property-inspection activity as `parcelFacts`. Then
// it stopped there. Nothing promoted those fields into the normalized evidence
// the rest of LandOS actually reads, so a Deal holding a verified provider
// record showing `Acres 1.500` and `Road Frontage 157.40 ft` still resolved its
// header acreage from a Florida DEP GIS polygon and reported no frontage at all.
// The retrieval was never the problem; the fields simply had nowhere to land.
//
// So this reads what is ALREADY retained and writes it into the existing
// normalized-fact path with LandPortal provenance. It re-opens nothing, calls
// no provider, and runs no research.
//
// What this deliberately is NOT:
//   • Not a second evidence model. It writes `normalized_fact` rows on
//     `landos_property_evidence_item`, the same table and shape every other
//     collector uses, keyed idempotently so replay is free.
//   • Not identity. `PERMANENT_MEMORY.md` invariants 2-4 stand: a provider
//     panel does not establish parcel identity, so the parcel id is retained as
//     a provider-stated fact and promotes nothing.
//   • Not a merge. A provider's reported acreage and the area it calculated
//     from its own polygon are different measurements and stay different facts,
//     exactly as the surveyed boundary stays separate from both.

import { getLandosDb } from './db.js';

/** One LandPortal panel field, and what it actually measures. */
interface LandPortalFactSpec {
  /** The label exactly as the LandPortal parcel panel prints it. */
  panelLabel: string;
  /** The normalized fact key downstream reads consume. */
  factKey: string;
  /** Numeric facts are stored as numbers; the rest keep their exact string. */
  parse?: (raw: string) => number | string | boolean | null;
}

const FEET = (raw: string): number | null => {
  const n = Number.parseFloat(raw.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const NUMBER = (raw: string): number | null => {
  const n = Number.parseFloat(raw.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const YESNO = (raw: string): boolean | null => {
  if (/^\s*yes\s*$/i.test(raw)) return true;
  if (/^\s*no\s*$/i.test(raw)) return false;
  return null;
};

/**
 * The panel fields worth carrying, and the concept each one is.
 *
 * `Acres` and `Calc Acres` are the pair that matters most: the first is the
 * acreage the parcel record reports, the second is the area LandPortal computed
 * from its own mapped geometry. A digitized polygon commonly reaches a road
 * centerline the deeded parcel does not own, which is exactly why they differ
 * here and exactly why collapsing them would be wrong.
 */
export const LANDPORTAL_PARCEL_FACTS: readonly LandPortalFactSpec[] = [
  { panelLabel: 'Parcel ID', factKey: 'LandPortal parcel identifier' },
  { panelLabel: 'Owner Name', factKey: 'Owner shown on LandPortal parcel record' },
  { panelLabel: 'Acres', factKey: 'Parcel-record acreage', parse: NUMBER },
  { panelLabel: 'Calc Acres', factKey: 'LandPortal calculated acreage', parse: NUMBER },
  { panelLabel: 'Parcel SqFt', factKey: 'Parcel square feet', parse: NUMBER },
  { panelLabel: 'Building SqFt', factKey: 'Building square feet', parse: NUMBER },
  { panelLabel: 'Road Frontage', factKey: 'LandPortal road frontage', parse: FEET },
  { panelLabel: 'Land Locked', factKey: 'LandPortal land locked flag', parse: YESNO },
  { panelLabel: 'Water Feature', factKey: 'LandPortal water feature present', parse: YESNO },
  { panelLabel: 'Water Feature type(s)', factKey: 'LandPortal water feature types' },
  { panelLabel: 'Legal Description', factKey: 'Legal description (LandPortal parcel record)' },
  { panelLabel: 'Parcel Address', factKey: 'Parcel address (LandPortal parcel record)' },
];

export interface RetainedLandPortalCapture {
  /** The activity row the capture was retained on. */
  activityId: number;
  propertyCardId: number;
  parcelFacts: Record<string, string>;
  /** The operator-openable LandPortal entry this was read from. */
  parcelUrl: string | null;
  capturedAt: string | null;
}

/**
 * Read the LandPortal parcel panels already retained for a Deal.
 *
 * Every verified property-inspection capture is eligible, which is what makes
 * this general: any Deal whose inspection retained a parcel panel normalizes
 * the same way, with no per-Deal wiring.
 */
export function readRetainedLandPortalCaptures(dealCardId: number): RetainedLandPortalCapture[] {
  // A Deal reaches its property cards through the membership table, which is
  // also what keeps a neighbouring parcel's own card out of this Deal's facts.
  const rows = getLandosDb().prepare(`
    SELECT a.id, a.card_id, a.ref, a.created_at
      FROM landos_card_activity a
      JOIN landos_deal_card_property dp ON dp.card_id = a.card_id
     WHERE dp.deal_card_id = ?
       AND a.kind = 'property_inspection'
     ORDER BY a.id DESC
  `).all(dealCardId) as Array<Record<string, unknown>>;
  // Only the most recent panel that actually carried parcel facts is current
  // provider state. Every earlier inspection is a superseded read of the same
  // parcel, and normalizing all of them would write one near-identical fact set
  // per historical capture — 21 copies on this Deal — for no added evidence.
  const out: RetainedLandPortalCapture[] = [];
  for (const row of rows) {
    let ref: Record<string, unknown>;
    try {
      ref = JSON.parse(String(row.ref ?? '{}')) as Record<string, unknown>;
    } catch {
      continue;
    }
    const facts = ref.parcelFacts;
    if (!facts || typeof facts !== 'object' || Array.isArray(facts)) continue;
    const parcelFacts: Record<string, string> = {};
    for (const [key, value] of Object.entries(facts as Record<string, unknown>)) {
      if (typeof value === 'string') parcelFacts[key] = value;
    }
    if (!Object.keys(parcelFacts).length) continue;
    if (out.length >= 1) break;
    out.push({
      activityId: Number(row.id),
      propertyCardId: Number(row.card_id),
      parcelFacts,
      parcelUrl: typeof ref.parcelUrl === 'string' ? ref.parcelUrl : null,
      capturedAt: typeof ref.comparablesCapturedAt === 'string'
        ? ref.comparablesCapturedAt
        : (row.created_at == null ? null : String(row.created_at)),
    });
  }
  return out;
}

/** A field read off the panel, before it is written. */
export interface NormalizedLandPortalFact {
  factKey: string;
  rawValue: string;
  normalizedValue: number | string | boolean | null;
}

/**
 * Turn one retained panel into normalized facts.
 *
 * A panel value LandPortal prints as `-` is the panel saying it has nothing,
 * not a value; it is skipped rather than stored as an empty fact.
 */
export function normalizeLandPortalParcelFacts(
  parcelFacts: Record<string, string>,
): NormalizedLandPortalFact[] {
  const out: NormalizedLandPortalFact[] = [];
  for (const spec of LANDPORTAL_PARCEL_FACTS) {
    const raw = parcelFacts[spec.panelLabel];
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '-') continue;
    const normalized = spec.parse ? spec.parse(trimmed) : trimmed;
    if (normalized === null) continue;
    out.push({ factKey: spec.factKey, rawValue: trimmed, normalizedValue: normalized });
  }
  return out;
}

function currentIdentityVersionId(dealCardId: number): number | null {
  const row = getLandosDb().prepare(`
    SELECT id FROM landos_property_identity_version
     WHERE deal_card_id = ? ORDER BY id DESC LIMIT 1
  `).get(dealCardId) as { id: number } | undefined;
  return row?.id ?? null;
}

/**
 * Normalize from the property card the inspection was captured on.
 *
 * The capture seam knows the property card; the evidence store is Deal-scoped.
 * This resolves one to the other so the seam does not have to, and so there is
 * exactly one normalizer rather than a second one that drifts.
 */
export function persistRetainedLandPortalParcelFactsForCard(
  propertyCardId: number,
): LandPortalNormalizationResult {
  const row = getLandosDb().prepare(
    'SELECT deal_card_id FROM landos_deal_card_property WHERE card_id = ? ORDER BY id DESC LIMIT 1',
  ).get(propertyCardId) as { deal_card_id: number | null } | undefined;
  if (row?.deal_card_id == null) return { captures: 0, factsWritten: 0, factKeys: [] };
  return persistRetainedLandPortalParcelFacts(row.deal_card_id);
}

/**
 * Bring already-retained inspections up to date, once.
 *
 * Deals whose parcel panel was captured before this normalizer existed hold
 * the evidence but not the facts. This is a backfill, not a read-path
 * mutation: ordinary GETs must not write, so the repair runs deliberately and
 * is safe to repeat because every write is keyed on its capture.
 */
export function backfillRetainedLandPortalParcelFacts(): Array<{ dealCardId: number } & LandPortalNormalizationResult> {
  const rows = getLandosDb().prepare(`
    SELECT DISTINCT dp.deal_card_id AS dealCardId
      FROM landos_card_activity a
      JOIN landos_deal_card_property dp ON dp.card_id = a.card_id
     WHERE a.kind = 'property_inspection'
     ORDER BY dp.deal_card_id
  `).all() as Array<{ dealCardId: number }>;
  return rows.map((row) => ({
    dealCardId: row.dealCardId,
    ...persistRetainedLandPortalParcelFacts(row.dealCardId),
  }));
}

export interface LandPortalNormalizationResult {
  captures: number;
  factsWritten: number;
  factKeys: string[];
}

/**
 * Persist the retained LandPortal panel as normalized evidence.
 *
 * Idempotent by construction: the idempotency key is the activity the capture
 * came from plus the fact key, so replaying this on every read costs nothing
 * and can never duplicate or drift. Nothing is overwritten — a later capture
 * writes its own rows under its own activity, and the reader takes the newest.
 */
export function persistRetainedLandPortalParcelFacts(dealCardId: number): LandPortalNormalizationResult {
  const identityVersionId = currentIdentityVersionId(dealCardId);
  if (identityVersionId == null) return { captures: 0, factsWritten: 0, factKeys: [] };
  const db = getLandosDb();
  const captures = readRetainedLandPortalCaptures(dealCardId);
  const factKeys: string[] = [];
  let factsWritten = 0;
  for (const capture of captures) {
    const facts = normalizeLandPortalParcelFacts(capture.parcelFacts);
    for (const fact of facts) {
      const result = db.prepare(`
        INSERT OR IGNORE INTO landos_property_evidence_item (
          deal_card_id, property_identity_version_id, domain, evidence_kind, fact_key,
          raw_value_json, normalized_value_json, source_name, source_url, source_tier,
          verification_status, confidence, collector_key, retrieved_at, effective_at,
          artifact_ref, idempotency_key
        ) VALUES (?, ?, 'assessor_gis', 'normalized_fact', ?, ?, ?, ?, ?, 'provider_record',
                  'verified', 'high', 'landportal_parcel_panel', ?, NULL, ?, ?)
      `).run(
        dealCardId,
        identityVersionId,
        fact.factKey,
        JSON.stringify(fact.rawValue),
        JSON.stringify(fact.normalizedValue),
        'LandPortal parcel record',
        capture.parcelUrl,
        capture.capturedAt ?? new Date(0).toISOString(),
        `landos_card_activity:${capture.activityId}`,
        `landportal-parcel-fact:${capture.activityId}:${fact.factKey}`,
      );
      if (result.changes > 0) factsWritten += 1;
      if (!factKeys.includes(fact.factKey)) factKeys.push(fact.factKey);
    }
  }
  return { captures: captures.length, factsWritten, factKeys };
}
