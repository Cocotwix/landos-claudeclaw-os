// LandOS — Visual eligibility model (parcel-association proof).
//
// A visual may appear on a Deal Card ONLY when LandOS holds evidence that the
// image depicts or directly represents the resolved parcel. A card-scoped
// filename is NOT proof: the De Queen regression captured downtown/McDonald's
// imagery into correctly-named card-15 files because the capture target was the
// raw multi-APN intake string with no coordinates.
//
// This module is the single deterministic decision point. Every layer (capture,
// persistence, report assembly, API routes, UI) consumes the same verdict —
// defense in depth, no single UI filter.
//
// Pure. No I/O, no DB, no network.

export type VisualTargetKind = 'parcel' | 'area' | 'unknown';

/** How the image is associated with the subject. Eligible bases carry evidence;
 *  ineligible bases describe exactly why an image can never be parcel imagery. */
export type VisualAssociationBasis =
  // ── eligible (with required evidence) ──
  | 'verified_parcel_coordinates'
  | 'verified_parcel_centroid'
  | 'verified_parcel_geometry'
  | 'landportal_parcel_page'
  | 'county_gis_parcel_page'
  | 'parcel_google_earth'
  | 'parcel_nearby_street_view'
  | 'frontage_street_view' // legacy unsafe attribution; deliberately ineligible
  | 'apn_visible_in_screenshot'
  // ── never eligible ──
  | 'raw_intake_text'
  | 'multi_apn_string'
  | 'city_centroid'
  | 'county_centroid'
  | 'generic_address_search'
  | 'search_results_page'
  | 'nearby_business'
  | 'downtown_context'
  | 'unresolved_location'
  | 'missing_source_coords'
  | 'inherited_from_other_card'
  | 'stale_unresolved_capture'
  | 'unknown';

export const ELIGIBLE_BASES: ReadonlySet<VisualAssociationBasis> = new Set([
  'verified_parcel_coordinates',
  'verified_parcel_centroid',
  'verified_parcel_geometry',
  'landportal_parcel_page',
  'county_gis_parcel_page',
  'parcel_google_earth',
  'parcel_nearby_street_view',
  'apn_visible_in_screenshot',
]);

/** Street View is nearby context only and must be close to the verified parcel location. */
export const MAX_PARCEL_CONTEXT_DISTANCE_M = 120;

export interface VisualAssociation {
  targetKind: VisualTargetKind;
  cardId?: number | null;
  apn?: string | null;
  sourceCoords?: { lat: number; lng: number } | null;
  sourceUrl?: string | null;
  basis: VisualAssociationBasis;
  /** The exact string/target the capture was generated from (audit trail). */
  captureQuery?: string | null;
  /** Which parcel-location evidence backed the coordinates. */
  parcelBasis?: 'geometry' | 'centroid' | 'coordinates' | null;
  /** Street View pano distance to the verified parcel location, meters. */
  distanceToParcelM?: number | null;
  eligibility?: 'eligible' | 'ineligible' | 'superseded';
  ineligibilityReason?: string | null;
  capturedAt?: string | null;
  sourceService?: string | null;
}

export interface EligibilityVerdict {
  eligible: boolean;
  basis: VisualAssociationBasis;
  /** Operator-facing reason when ineligible; null when eligible. */
  reason: string | null;
}

const APN_TOKEN = /\b\d{1,4}[-. ]\d{3,6}[-. ]\d{1,5}(?:[-. ][A-Za-z0-9]{1,4})?\b/g;

/** True when a capture target string references two or more distinct APN-like
 *  tokens — a raw multi-APN intake string, never a Google imagery target. */
export function isMultiApnString(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  const tokens = t.match(APN_TOKEN) ?? [];
  const distinct = new Set(tokens.map((x) => x.replace(/[-. ]/g, '')));
  return distinct.size >= 2;
}

/** True when a capture target string looks like raw APN/intake text rather than
 *  a resolvable street address. A real street address leads with a house number
 *  and a street name; APN-led or APN-only strings are intake text and must never
 *  be sent to Google imagery. */
export function looksLikeApnIntakeText(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  const tokens = t.match(APN_TOKEN) ?? [];
  if (tokens.length === 0) return false;
  if (/^\s*\d{1,4}[-. ]\d{3,6}[-. ]\d{1,5}/.test(t)) return true; // leads with an APN
  return !/^\s*\d+\s+[A-Za-z]/.test(t); // contains an APN and is not house-number-led
}

const INELIGIBLE_REASON: Partial<Record<VisualAssociationBasis, string>> = {
  raw_intake_text: 'Image excluded because it was generated from raw intake text, not the resolved parcel.',
  multi_apn_string: 'Image excluded because it was generated from an unresolved multi-APN intake string.',
  city_centroid: 'Image excluded because it shows the city area, not the parcel.',
  county_centroid: 'Image excluded because it shows the county area, not the parcel.',
  generic_address_search: 'Image excluded because it came from a generic address search, not the resolved parcel.',
  search_results_page: 'Image excluded because it is a search-results capture, not the parcel.',
  nearby_business: 'Image excluded because it shows a nearby business, not the parcel.',
  downtown_context: 'Image excluded because it shows downtown context, not the parcel.',
  unresolved_location: 'Image excluded because the parcel location was not resolved when it was captured.',
  missing_source_coords: 'Image excluded because no verified parcel coordinates backed the capture.',
  inherited_from_other_card: 'Image excluded because it belongs to a different property card.',
  frontage_street_view: 'Image excluded because legacy metadata attributed nearby Street View imagery to unverified frontage.',
  stale_unresolved_capture: 'Image excluded because it predates parcel resolution for this lead.',
  unknown: 'Image excluded because parcel association could not be confirmed.',
};

/** The operator-facing exclusion line (audit + UI share this wording). */
export const UNVERIFIED_IMAGERY_MESSAGE =
  'Displayed imagery could not be verified as belonging to the subject parcel.';

/**
 * The ONE deterministic eligibility decision. An image is eligible only when its
 * association basis is an allowed kind AND the evidence that basis requires is
 * actually present AND it belongs to the expected card. Anything else —
 * including a missing association record (legacy captures) — is ineligible.
 */
export function assessVisualAssociation(
  assoc: VisualAssociation | null | undefined,
  opts: { expectedCardId?: number | null } = {},
): EligibilityVerdict {
  if (!assoc) {
    return { eligible: false, basis: 'unknown', reason: INELIGIBLE_REASON.unknown! };
  }
  if (assoc.eligibility === 'superseded') {
    return { eligible: false, basis: assoc.basis ?? 'unknown', reason: assoc.ineligibilityReason || 'Image superseded by a corrected capture.' };
  }
  if (assoc.eligibility === 'ineligible') {
    return { eligible: false, basis: assoc.basis ?? 'unknown', reason: assoc.ineligibilityReason || INELIGIBLE_REASON.unknown! };
  }
  // Card ownership: an image recorded for another card can never render here.
  if (
    opts.expectedCardId != null &&
    assoc.cardId != null &&
    assoc.cardId !== opts.expectedCardId
  ) {
    return { eligible: false, basis: 'inherited_from_other_card', reason: INELIGIBLE_REASON.inherited_from_other_card! };
  }
  // A capture generated from a multi-APN string is ineligible regardless of the
  // claimed basis — the query itself proves the target was unresolved intake.
  if (isMultiApnString(assoc.captureQuery)) {
    return { eligible: false, basis: 'multi_apn_string', reason: INELIGIBLE_REASON.multi_apn_string! };
  }

  const basis = assoc.basis ?? 'unknown';
  if (!ELIGIBLE_BASES.has(basis)) {
    return { eligible: false, basis, reason: INELIGIBLE_REASON[basis] ?? INELIGIBLE_REASON.unknown! };
  }

  // Evidence requirements per eligible basis.
  switch (basis) {
    case 'verified_parcel_coordinates':
    case 'verified_parcel_centroid':
    case 'verified_parcel_geometry':
    case 'parcel_google_earth': {
      const c = assoc.sourceCoords;
      if (!c || typeof c.lat !== 'number' || typeof c.lng !== 'number' || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) {
        return { eligible: false, basis: 'missing_source_coords', reason: INELIGIBLE_REASON.missing_source_coords! };
      }
      return { eligible: true, basis, reason: null };
    }
    case 'parcel_nearby_street_view': {
      const c = assoc.sourceCoords;
      if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lng)) {
        return { eligible: false, basis: 'missing_source_coords', reason: INELIGIBLE_REASON.missing_source_coords! };
      }
      const d = assoc.distanceToParcelM;
      if (typeof d !== 'number' || !Number.isFinite(d) || d < 0 || d > MAX_PARCEL_CONTEXT_DISTANCE_M) {
        return {
          eligible: false,
          basis,
          reason: `Image excluded because the Street View position is not within ${MAX_PARCEL_CONTEXT_DISTANCE_M} m of the verified parcel location.`,
        };
      }
      return { eligible: true, basis, reason: null };
    }
    case 'landportal_parcel_page':
    case 'county_gis_parcel_page': {
      if (!(assoc.apn && assoc.apn.trim()) && !(assoc.sourceUrl && assoc.sourceUrl.trim())) {
        return { eligible: false, basis, reason: 'Image excluded because the parcel page it came from is not recorded (no APN or source URL).' };
      }
      return { eligible: true, basis, reason: null };
    }
    case 'apn_visible_in_screenshot': {
      if (!assoc.apn || !assoc.apn.trim()) {
        return { eligible: false, basis, reason: 'Image excluded because no APN is recorded for the screenshot.' };
      }
      return { eligible: true, basis, reason: null };
    }
    default:
      return { eligible: false, basis, reason: INELIGIBLE_REASON.unknown! };
  }
}

// ── Layer helpers ────────────────────────────────────────────────────────────

/** Filter a captured-asset map (service → asset w/ optional association) down to
 *  eligible assets only. Legacy assets with no association are dropped. */
export function filterEligibleAssetMap<T extends { association?: VisualAssociation | null }>(
  assets: Record<string, T>,
  expectedCardId?: number | null,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, a] of Object.entries(assets ?? {})) {
    if (!a) continue;
    if (assessVisualAssociation(a.association ?? null, { expectedCardId }).eligible) out[k] = a;
  }
  return out;
}

/** Derive the association for a LandPortal inspection screenshot. Inspection
 *  assets are captured FROM the APN-resolved LandPortal parcel page, so they are
 *  eligible when that page (URL or APN) is recorded. */
export function landportalInspectionAssociation(input: {
  cardId: number;
  apn?: string | null;
  parcelUrl?: string | null;
  capturedAt?: string | null;
}): VisualAssociation {
  return {
    targetKind: 'parcel',
    cardId: input.cardId,
    apn: input.apn ?? null,
    sourceUrl: input.parcelUrl ?? null,
    basis: 'landportal_parcel_page',
    captureQuery: input.parcelUrl ?? input.apn ?? null,
    eligibility: undefined,
    capturedAt: input.capturedAt ?? null,
    sourceService: 'landportal',
  };
}
