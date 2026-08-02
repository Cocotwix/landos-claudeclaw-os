/** Permanent, deterministic LandPortal operating rules shared by the direct
 * runner and the persisted inspection/read surfaces. */

export interface LandPortalParcelIdentity {
  fips: string | null;
  apn: string | null;
  propertyId: string | null;
}

export interface LandPortalUrlValidation {
  valid: boolean;
  reason: string;
  canonicalUrl: string | null;
  identity: LandPortalParcelIdentity | null;
}

export interface LandPortalParcelUrlRecord {
  url: string;
  source: string;
  capturedAt: string;
  propertyCardId: number;
  dealCardId: number | null;
  verifiedSubject: boolean;
  apn: string | null;
  fips: string | null;
  propertyId: string | null;
}

export type ThreeDCaptureDecision = 'eligible' | 'not_applicable' | 'unknown';

export interface ThreeDCaptureEligibility {
  decision: ThreeDCaptureDecision;
  averageSlopePercent: number | null;
  areaAboveTenSlopePercent: number | null;
  reason: string;
}

const LP_HOSTS = new Set(['landportal.com', 'www.landportal.com']);
const REJECTED_PATHS = /\/(?:login|signin|search|market[-_]?research|market[-_]?comps|comp[-_]?map|paid|report|account)(?:\/|$)/i;

function decodePropertyToken(value: string): LandPortalParcelIdentity | null {
  try {
    const encoded = decodeURIComponent(value).replace(/-/g, '+').replace(/_/g, '/');
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    if (!decoded || !/(?:^|&)propertyid=/i.test(decoded)) return null;
    const pairs = new URLSearchParams(decoded.replace(/\+/g, ' '));
    const propertyId = pairs.get('propertyid')?.trim() || null;
    const fips = pairs.get('fips')?.trim() || null;
    const apn = pairs.get('apn')?.trim() || null;
    if (!propertyId || (!fips && !apn)) return null;
    return { fips, apn, propertyId };
  } catch {
    return null;
  }
}

/** Validate the exact subject-parcel URL shape LandPortal emits. */
export function validateLandPortalSubjectUrl(value: unknown): LandPortalUrlValidation {
  if (typeof value !== 'string' || !value.trim()) {
    return { valid: false, reason: 'blank_url', canonicalUrl: null, identity: null };
  }
  const raw = value.trim();
  let parsed: URL;
  try { parsed = new URL(raw); } catch {
    return { valid: false, reason: 'malformed_url', canonicalUrl: null, identity: null };
  }
  if (parsed.protocol !== 'https:') return { valid: false, reason: 'https_required', canonicalUrl: null, identity: null };
  if (!LP_HOSTS.has(parsed.hostname.toLowerCase())) return { valid: false, reason: 'wrong_host', canonicalUrl: null, identity: null };
  if (REJECTED_PATHS.test(parsed.pathname)) return { valid: false, reason: 'non_parcel_surface', canonicalUrl: null, identity: null };
  const token = parsed.searchParams.get('property');
  if (!token) return { valid: false, reason: 'parcel_property_query_missing', canonicalUrl: null, identity: null };
  const identity = decodePropertyToken(token);
  if (!identity) return { valid: false, reason: 'parcel_property_query_invalid', canonicalUrl: null, identity: null };
  if (parsed.hash) return { valid: false, reason: 'fragment_not_allowed', canonicalUrl: null, identity: null };
  return { valid: true, reason: 'verified_parcel_url_shape', canonicalUrl: raw, identity };
}

export function isVerifiedLandPortalSubjectUrl(value: unknown): value is string {
  return validateLandPortalSubjectUrl(value).valid;
}

export function landPortalIdentityFromUrl(value: unknown): LandPortalParcelIdentity | null {
  return validateLandPortalSubjectUrl(value).identity;
}
