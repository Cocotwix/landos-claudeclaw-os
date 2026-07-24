import { distanceMilesFromSubject } from './comp-orchestrator.js';

export const COMP_RADIUS_LADDER_MILES = [5, 10, 15, 20] as const;
export const COMP_SOLD_WINDOW_MONTHS = [12, 24] as const;

export interface CanonicalCompSubject {
  lat: number | null;
  lng: number | null;
  zip: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  apn: string | null;
  address: string | null;
  acres: number | null;
  valid: boolean;
  identityBasis: string;
}

type SubjectSource = {
  lat?: number | null; lng?: number | null; zip?: string | null; city?: string | null;
  county?: string | null; state?: string | null; apn?: string | null;
  address?: string | null; active_input_address?: string | null; acres?: number | null;
};

const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const zipFrom = (value: string | null): string | null => value?.match(/\b\d{5}(?:-\d{4})?\b/)?.[0].slice(0, 5) ?? null;

/** Build the one comp-search identity packet. The reconciled Property Card is
 * authoritative; retained provider facts only fill blanks and can never replace
 * it with a stale intake title or a lead mailing address. Road-only vacant-land
 * subjects are valid when parcel/location identity is otherwise established. */
export function buildCanonicalCompSubject(property: SubjectSource, retained: SubjectSource = {}): CanonicalCompSubject {
  const address = text(property.active_input_address) ?? text(property.address) ?? text(retained.active_input_address) ?? text(retained.address);
  const state = (text(property.state) ?? text(retained.state))?.toUpperCase() ?? null;
  const county = (text(property.county) ?? text(retained.county))?.replace(/\s+county$/i, '') ?? null;
  const city = text(property.city) ?? text(retained.city);
  const zip = text(property.zip) ?? zipFrom(address) ?? text(retained.zip) ?? zipFrom(text(retained.address));
  const apn = text(property.apn) ?? text(retained.apn);
  const lat = number(property.lat) ?? number(retained.lat);
  const lng = number(property.lng) ?? number(retained.lng);
  const acres = number(property.acres) ?? number(retained.acres);
  const point = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const parcelIdentity = !!apn && !!state && (!!county || !!city || !!zip);
  const valid = !!state && (point || parcelIdentity || (!!address && (!!city || !!county || !!zip)));
  const identityBasis = point
    ? 'verified subject coordinates with reconciled parcel locality'
    : parcelIdentity
      ? 'reconciled APN with parcel locality (road-only address accepted)'
      : valid ? 'reconciled property address with locality' : 'subject location is incomplete';
  return { lat, lng, zip, city, county, state, apn, address, acres, valid, identityBasis };
}

export interface ResolvedSearchGeography {
  lat?: number | null; lng?: number | null; zip?: string | null; city?: string | null;
  county?: string | null; state?: string | null; text?: string | null;
}

const norm = (value: string | null | undefined) => (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Geography safeguard applies to the SEARCH CENTER only. It never rejects a
 * nearby comp merely for crossing a county or ZIP boundary. */
export function verifySearchGeography(subject: CanonicalCompSubject, resolved: ResolvedSearchGeography): { valid: boolean; reason: string } {
  const resolvedState = text(resolved.state)?.toUpperCase() ?? null;
  if (subject.state && resolvedState && resolvedState !== subject.state) return { valid: false, reason: `resolved state ${resolvedState} does not match ${subject.state}` };
  const distance = subject.lat != null && subject.lng != null && number(resolved.lat) != null && number(resolved.lng) != null
    ? distanceMilesFromSubject(subject, { lat: number(resolved.lat), lng: number(resolved.lng) }) : null;
  if (distance != null && distance > 25) return { valid: false, reason: `resolved map center is ${distance} miles from the subject` };
  const haystack = norm([resolved.text, resolved.city, resolved.county, resolved.zip, resolved.state].filter(Boolean).join(' '));
  const localityMatch = [subject.zip, subject.city, subject.county].filter(Boolean).some((value) => haystack.includes(norm(value)));
  if (distance != null && distance <= 20) return { valid: true, reason: 'resolved map center is local to the subject' };
  if (localityMatch && (!subject.state || haystack.includes(norm(subject.state)))) return { valid: true, reason: 'resolved locality matches the canonical subject' };
  return { valid: false, reason: 'resolved page does not match the subject coordinates, ZIP, city, or county' };
}

export function soldWindowForDate(nowIso: string, months = 12): { from: string; to: string } {
  const to = new Date(nowIso);
  const from = new Date(to);
  from.setUTCMonth(from.getUTCMonth() - months);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function daysOnMarket(listingDate: string | null | undefined, soldDate: string | null | undefined): number | null {
  const start = listingDate ? Date.parse(listingDate) : NaN;
  const end = soldDate ? Date.parse(soldDate) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 86_400_000);
}
