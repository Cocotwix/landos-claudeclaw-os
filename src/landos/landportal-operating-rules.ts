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
  /** Search scope that the on-screen parcel checkpoint verified. These are
   * provenance for a SPA search result, not fields decoded from `url`. */
  verifiedCounty?: string | null;
  verifiedState?: string | null;
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

/**
 * An operator-supplied LandPortal link that is safe to OPEN as the starting
 * surface, which is a strictly weaker claim than `validateLandPortalSubjectUrl`.
 *
 * A canonical `?property=<token>` link carries decodable parcel identity and is
 * the only shape that may stand in for identity. A saved-map `?map=<uuid>` link
 * does NOT: it names a map view the operator was looking at, not a parcel. It is
 * still the shortest correct ENTRY POINT, because opening it lands on the
 * operator's own selection instead of rediscovering the parcel by address or
 * owner search.
 *
 * So this returns a URL to open, never an identity. Whatever parcel the opened
 * record turns out to be is still confirmed by the existing verification step,
 * and a mismatch still falls back to the existing search path.
 */
export function operatorLandPortalEntryUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  // A canonical parcel link is the strongest entry point; reuse its own guard.
  const canonical = validateLandPortalSubjectUrl(raw);
  if (canonical.valid) return canonical.canonicalUrl;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return null; }
  if (parsed.protocol !== 'https:') return null;
  if (!LP_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  if (REJECTED_PATHS.test(parsed.pathname)) return null;
  // Saved-map links are the shape the operator actually copies out of LandPortal.
  const map = parsed.searchParams.get('map')?.trim();
  if (map && /^[0-9a-f-]{8,}$/i.test(map)) return raw;
  return null;
}

/** True when the link can be opened directly but carries NO parcel identity, so
 *  the opened record must establish which parcel it actually is. */
export function isOperatorEntryOnlyLandPortalUrl(value: unknown): boolean {
  return operatorLandPortalEntryUrl(value) !== null && !isVerifiedLandPortalSubjectUrl(value);
}

export function landPortalIdentityFromUrl(value: unknown): LandPortalParcelIdentity | null {
  return validateLandPortalSubjectUrl(value).identity;
}

function numberFrom(value: unknown): number | null {
  const match = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  const parsed = match ? Number(match[0]) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** Collect slope metrics from both normalized facts and retained provider rows. */
export function slopeMetricsFromRetained(value: unknown): {
  averageSlopePercent: number | null;
  areaAboveTenSlopePercent: number | null;
} {
  let averageSlopePercent: number | null = null;
  let underTenPercent: number | null = null;
  let heavyPercent: number | null = null;
  let extremePercent: number | null = null;
  const applyMetric = (label: string, candidate: unknown): void => {
    if (/^(?:slope\s*avg|average\s*slope|avg\s*slope)$/i.test(label)) averageSlopePercent ??= numberFrom(candidate);
    if (/under\s*10|below\s*10/i.test(label) && /slope/i.test(label)) underTenPercent ??= numberFrom(candidate);
    if (/heavy\s*slope|10\s*[-–]\s*15/i.test(label)) heavyPercent ??= numberFrom(candidate);
    if (/extreme\s*slope|15\s*%?\s*\+/i.test(label)) extremePercent ??= numberFrom(candidate);
  };
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) { for (const child of node) visit(child); return; }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    const label = String(obj.label ?? obj.key ?? obj.name ?? '').trim();
    const candidate = obj.value ?? obj.detail;
    applyMetric(label, candidate);
    for (const [key, child] of Object.entries(obj)) {
      if (typeof child !== 'object') applyMetric(key, child);
      if (key !== 'value' && key !== 'detail') visit(child);
    }
  };
  visit(value);
  const areaAboveTenSlopePercent = heavyPercent != null && extremePercent != null
    ? heavyPercent + extremePercent
    : underTenPercent != null ? Math.max(0, 100 - underTenPercent) : null;
  return { averageSlopePercent, areaAboveTenSlopePercent };
}

/** Exact rule: average slope >=10% OR area strictly greater than 10%. */
export function evaluateThreeDCaptureEligibility(value: unknown): ThreeDCaptureEligibility {
  const metrics = slopeMetricsFromRetained(value);
  if (metrics.averageSlopePercent == null && metrics.areaAboveTenSlopePercent == null) {
    return { ...metrics, decision: 'unknown', reason: 'slope_data_missing' };
  }
  if ((metrics.averageSlopePercent != null && metrics.averageSlopePercent >= 10)
      || (metrics.areaAboveTenSlopePercent != null && metrics.areaAboveTenSlopePercent > 10)) {
    return { ...metrics, decision: 'eligible', reason: 'material_slope_threshold_met' };
  }
  return { ...metrics, decision: 'not_applicable', reason: 'average_below_10_and_area_above_10_not_greater_than_10' };
}

export function sameLandPortalParcel(a: LandPortalParcelIdentity | null, b: LandPortalParcelIdentity | null): boolean {
  if (!a || !b) return false;
  if (a.propertyId && b.propertyId) return a.propertyId === b.propertyId;
  const compact = (v: string | null) => (v ?? '').replace(/[^0-9a-z]/gi, '').toLowerCase();
  return !!a.fips && !!b.fips && !!a.apn && !!b.apn && compact(a.fips) === compact(b.fips) && compact(a.apn) === compact(b.apn);
}
