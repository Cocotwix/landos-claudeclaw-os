// LandOS — the canonical Normalized Property Object.
//
// EVERY retrieval lane (Realie/LandPortal, HomeHarvest, browser search, NETR,
// county GIS, LandPortal/Land ID read-only, future providers) returns the SAME
// shape: a NormalizedProperty plus PropertyEvidence rows. The Property Resolution
// Engine merges these and the DD engine + every future LandOS department consumes
// this one object. This file is pure types + deterministic merge helpers: no DB,
// no network, no secrets.
//
// Hard rules carried from the rest of LandOS:
//   - Coordinates are SUPPORTING context only — never parcel identity. A lane may
//     contribute coordinates, but identity (address/APN/owner/propertyId) must
//     come from a named source, never from a point/proximity.
//   - Every contributed value is sourced. Unknown fields are reported in
//     `missing`, never fabricated. Confidence is derived from corroboration, not
//     invented.

import type { DukeVerificationResult } from './duke-verification-bridge.js';
import type { DerivedCounty } from './providers/county-geocode.js';

// ─────────────────────────────────────────────────────────────────────────
// Retrieval lanes
// ─────────────────────────────────────────────────────────────────────────

/** Every retrieval lane that can contribute evidence to a NormalizedProperty.
 *  New lanes append here; the engine and the object never need a rewrite. */
export const RETRIEVAL_LANES = [
  'realie_landportal',     // existing named-source parcel verification (strongest)
  'census_geocode',        // free US Census geocoder (county/FIPS/coords; supporting)
  'address_suggest',       // Smart Address Search (Photon / Census autocomplete)
  'homeharvest',           // open-source listing/land lane
  'listing_provider',      // other listing providers (Zillow/Realtor evidence)
  'browser_search',        // general public web search (find-the-property)
  'netr',                  // NETR Online navigation directory
  'county_gis',            // county GIS / assessor / parcel map / recorder
  'landportal_readonly',   // LandPortal browser lane (STRICT read-only)
  'county_records',        // County Records browser lane (public-record gap-fill)
  'land_id_readonly',      // Land ID browser lane (STRICT read-only)
  'landos_cache',          // previously resolved property in the LandOS cache
] as const;
export type RetrievalLane = (typeof RETRIEVAL_LANES)[number];

/** The identity-bearing fields. Coordinates are deliberately NOT in this list —
 *  a point can never establish identity. */
export const IDENTITY_FIELDS = ['address', 'apn', 'owner', 'propertyId', 'lpUrl'] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];

/** Fields a downstream department generally wants present before it can run a
 *  responsible pre-call workup. Absent ones become `missing` (Confirm Before
 *  Offer), never fabricated. */
export const PRACTICAL_FIELDS = [
  'address', 'county', 'state', 'apn', 'owner', 'acres', 'coordinates',
] as const;
export type PracticalField = (typeof PRACTICAL_FIELDS)[number];

// ─────────────────────────────────────────────────────────────────────────
// Evidence
// ─────────────────────────────────────────────────────────────────────────

/** One sourced fact contributed by one lane. The audit trail behind every field
 *  on a NormalizedProperty. Never holds a secret/token. */
export interface PropertyEvidence {
  lane: RetrievalLane;
  field: string;
  value: string;
  /** Named source label (e.g. 'Realie.ai', 'US Census geocoder', 'Photon'). */
  source: string;
  /** Public URL the evidence was read from, when safe. Never a credentialed URL. */
  sourceUrl?: string;
  /** 0..1 confidence this lane has in this single value. */
  confidence: number;
  /** ISO timestamp the evidence was produced. */
  timestamp: string;
}

// ─────────────────────────────────────────────────────────────────────────
// The Normalized Property Object
// ─────────────────────────────────────────────────────────────────────────

export interface NormalizedProperty {
  /** Best-known street address (raw or normalized). */
  address?: string;
  /** Normalized/standardized address when a geocoder returned one. */
  normalizedAddress?: string;
  county?: string;
  city?: string;
  state?: string;
  zip?: string;
  apn?: string;
  owner?: string;
  acres?: number;
  /** SUPPORTING ONLY — never identity. */
  coordinates?: { lat: number; lng: number };
  /** Parcel identifiers other than APN (legal desc keys, GIS pin, etc.). */
  parcelIds?: string[];
  /** LandPortal/provider property id. */
  propertyId?: string;
  fips?: string;
  lpUrl?: string;
  /** True only when a NAMED source verified parcel identity (Realie/LandPortal).
   *  A property can be credibly Matched WITHOUT this (pre-call intelligence is
   *  not legal-grade title verification); offer-stage work stays gated on it. */
  parcelVerified: boolean;
  /** The named source that verified identity, when parcelVerified. */
  verificationSource?: string;
  /** Full audit trail. */
  evidence: PropertyEvidence[];
  /** Distinct named sources that contributed. */
  sources: string[];
  /** 0..1 overall confidence the intended property is correctly identified. */
  confidence: number;
  /** Practical fields not yet established — surfaced as Confirm Before Offer. */
  missing: PracticalField[];
}

export function emptyNormalizedProperty(): NormalizedProperty {
  return { parcelVerified: false, evidence: [], sources: [], confidence: 0, missing: [...PRACTICAL_FIELDS] };
}

function s(v?: string | null): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
function n(v?: number | null): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

/** Recompute which practical fields are still missing. Pure. */
export function missingFields(p: NormalizedProperty): PracticalField[] {
  return PRACTICAL_FIELDS.filter((f) => {
    if (f === 'coordinates') return !p.coordinates;
    const v = (p as unknown as Record<string, unknown>)[f];
    return v === undefined || v === null || v === '';
  });
}

/** Distinct lanes that contributed at least one identity-bearing field. Used to
 *  judge corroboration (multiple independent lanes agreeing → higher confidence). */
export function corroboratingIdentityLanes(p: NormalizedProperty): RetrievalLane[] {
  const lanes = new Set<RetrievalLane>();
  for (const e of p.evidence) {
    if ((IDENTITY_FIELDS as readonly string[]).includes(e.field)) lanes.add(e.lane);
  }
  return [...lanes];
}

/**
 * Derive overall confidence from the merged evidence. Deterministic, explainable:
 *   - A named-source parcel verification alone is high (>= 0.9).
 *   - Otherwise confidence rises with the number of INDEPENDENT lanes that agree
 *     on identity-bearing fields, plus whether a full street address + locality
 *     (county/state) is established. No magic; bounded to [0,1].
 */
export function deriveConfidence(p: NormalizedProperty): number {
  if (p.parcelVerified) return Math.max(0.9, identityBreadth(p));
  const lanes = corroboratingIdentityLanes(p).length;
  let c = 0;
  if (s(p.address)) c += 0.3;
  if (s(p.county) && s(p.state)) c += 0.2;
  if (s(p.apn)) c += 0.2;
  if (p.coordinates) c += 0.05; // supporting nudge only
  // Independent corroboration is the dominant non-verified signal.
  c += Math.min(lanes, 3) * 0.15;
  return Math.min(1, Number(c.toFixed(3)));
}

/** A small bonus for how complete the identity picture is, used to keep a
 *  verified property's confidence monotone in completeness. */
function identityBreadth(p: NormalizedProperty): number {
  const have = IDENTITY_FIELDS.filter((f) => !!(p as unknown as Record<string, unknown>)[f]).length;
  return 0.9 + Math.min(have, 2) * 0.05;
}

/** Add an evidence row (idempotent on lane+field+value) and keep `sources` in sync. */
export function addEvidence(p: NormalizedProperty, e: PropertyEvidence): void {
  const dup = p.evidence.some((x) => x.lane === e.lane && x.field === e.field && x.value === e.value);
  if (!dup) p.evidence.push(e);
  if (!p.sources.includes(e.source)) p.sources.push(e.source);
}

/** A field patch a lane contributes, paired with the evidence backing it. */
export interface PropertyPatch {
  address?: string;
  normalizedAddress?: string;
  county?: string;
  city?: string;
  state?: string;
  zip?: string;
  apn?: string;
  owner?: string;
  acres?: number;
  coordinates?: { lat: number; lng: number };
  parcelIds?: string[];
  propertyId?: string;
  fips?: string;
  lpUrl?: string;
  parcelVerified?: boolean;
  verificationSource?: string;
}

/**
 * Merge a lane's patch into the property, recording evidence for each populated
 * IDENTITY/PRACTICAL field. A later lane never overwrites a value already set by
 * a verified source; coordinates are merged as supporting context only. Returns
 * the same object (mutated) for ergonomic chaining; pure w.r.t. external state.
 */
export function mergeNormalized(
  p: NormalizedProperty,
  lane: RetrievalLane,
  source: string,
  patch: PropertyPatch,
  opts: { confidence?: number; timestamp?: string; sourceUrl?: string } = {},
): NormalizedProperty {
  const ts = opts.timestamp ?? new Date().toISOString();
  const conf = typeof opts.confidence === 'number' ? opts.confidence : 0.6;
  const verifiedAlready = p.parcelVerified;

  const setStr = (key: keyof NormalizedProperty & string, val?: string | null) => {
    const v = s(val);
    if (!v) return;
    // Verified identity is sticky: don't let a weaker lane overwrite it.
    if (verifiedAlready && (IDENTITY_FIELDS as readonly string[]).includes(key) && (p as unknown as Record<string, unknown>)[key]) return;
    if (!(p as unknown as Record<string, unknown>)[key]) (p as unknown as Record<string, unknown>)[key] = v;
    addEvidence(p, { lane, field: key, value: v, source, sourceUrl: opts.sourceUrl, confidence: conf, timestamp: ts });
  };
  const setNum = (key: keyof NormalizedProperty & string, val?: number | null) => {
    const v = n(val);
    if (v === undefined) return;
    if (!(p as unknown as Record<string, unknown>)[key]) (p as unknown as Record<string, unknown>)[key] = v;
    addEvidence(p, { lane, field: key, value: String(v), source, sourceUrl: opts.sourceUrl, confidence: conf, timestamp: ts });
  };

  setStr('address', patch.address);
  setStr('normalizedAddress', patch.normalizedAddress);
  setStr('county', patch.county);
  setStr('city', patch.city);
  setStr('state', patch.state);
  setStr('zip', patch.zip);
  setStr('apn', patch.apn);
  setStr('owner', patch.owner);
  setStr('propertyId', patch.propertyId);
  setStr('fips', patch.fips);
  setStr('lpUrl', patch.lpUrl);
  setNum('acres', patch.acres);

  if (patch.parcelIds?.length) {
    const set = new Set([...(p.parcelIds ?? []), ...patch.parcelIds.map((x) => x.trim()).filter(Boolean)]);
    p.parcelIds = [...set];
    addEvidence(p, { lane, field: 'parcelIds', value: [...set].join(','), source, sourceUrl: opts.sourceUrl, confidence: conf, timestamp: ts });
  }
  if (patch.coordinates && !p.coordinates) {
    const { lat, lng } = patch.coordinates;
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0)) {
      p.coordinates = { lat, lng };
      // coordinates are supporting-only; recorded as evidence but never identity.
      addEvidence(p, { lane, field: 'coordinates', value: `${lat},${lng}`, source, sourceUrl: opts.sourceUrl, confidence: 0.3, timestamp: ts });
    }
  }
  if (patch.parcelVerified) {
    p.parcelVerified = true;
    if (patch.verificationSource) p.verificationSource = patch.verificationSource;
  }

  p.missing = missingFields(p);
  p.confidence = deriveConfidence(p);
  return p;
}

// ─────────────────────────────────────────────────────────────────────────
// Lane adapters → NormalizedProperty patches
// ─────────────────────────────────────────────────────────────────────────

/** Build a patch from the existing Realie/LandPortal verification result. The
 *  ONLY lane that may set parcelVerified=true (named-source identity). */
export function patchFromDukeVerification(v: DukeVerificationResult): PropertyPatch {
  const id = v.identity;
  const ld = v.propertyData?.landFacts;
  return {
    address: id?.situsAddress,
    county: id?.county,
    city: id?.city,
    state: id?.state,
    apn: id?.apn,
    owner: id?.owner,
    acres: id?.acres ?? ld?.acres,
    propertyId: id?.propertyId,
    fips: id?.fips,
    lpUrl: id?.lpUrl,
    coordinates: v.coordinates,
    parcelVerified: v.parcelVerified === true,
    verificationSource: v.parcelVerified ? v.verificationSource : undefined,
  };
}

/** Build a patch from the free US Census geocoder derivation (county/FIPS +
 *  supporting coordinates). Never sets parcelVerified. */
export function patchFromCensus(d: DerivedCounty): PropertyPatch {
  return {
    county: d.county,
    state: d.state,
    zip: d.zip ?? undefined,
    fips: d.fips ?? undefined,
    coordinates: d.lat != null && d.lng != null ? { lat: d.lat, lng: d.lng } : undefined,
  };
}
