// Discovery-stage subject identity reconciliation.
//
// Legal-grade proof is intentionally not the discovery bar. A full operator
// APN + jurisdiction that agrees with an authenticated LandPortal parcel panel
// is usable for discovery research even when the official county source cannot
// answer. Official evidence remains stronger, every limitation stays visible,
// and a genuine APN/jurisdiction disagreement is always a hard stop.

import { addressVariantsCompatible } from './instruction-consistency.js';
import { decodeLandPortalCanonicalIdentity } from './landportal-canonical-identity.js';
import { operatorLandPortalEntryUrl } from './landportal-operating-rules.js';
import type { PropertyPatch } from './normalized-property.js';

export type DiscoveryIdentityState = 'confirmed' | 'provisional' | 'conflicted' | 'unresolved';
export type DiscoveryIdentityConfidence = 'high' | 'medium' | 'low' | 'none';

export interface DiscoverySubjectInput {
  address?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  zip?: string | null;
  apn?: string | null;
  owner?: string | null;
  acres?: number | null;
  /** 5-digit county FIPS retained on the subject record, when one is known. */
  fips?: string | null;
}

export interface DiscoveryLandPortalEvidence {
  parcelUrl?: string | null;
  parcelFacts?: Record<string, string> | null;
  assetCount?: number;
  sourceLabel?: string;
  sourceNote?: string | null;
  /** Explicit subject association proof from the retained canonical URL record. */
  verifiedSubject?: boolean;
}

export interface DiscoveryOfficialParcelEvidence {
  status: 'matched' | 'no_match' | 'unavailable';
  source?: string | null;
  sourceUrl?: string | null;
  note?: string | null;
  parcel?: DiscoverySubjectInput | null;
}

export interface DiscoveryIdentityEvidence {
  field: string;
  value: string;
  source: string;
  sourceUrl: string | null;
  confidence: DiscoveryIdentityConfidence;
  classification: 'official_record' | 'marketplace_parcel_panel' | 'operator_input';
}

export interface DiscoveryIdentityDecision {
  state: DiscoveryIdentityState;
  /** Discovery research, comps and conditional analysis may use this subject. */
  discoveryUsable: boolean;
  discoveryBasis: string;
  discoverySources: string[];
  confidence: DiscoveryIdentityConfidence;
  /** Identity/parcel facts to merge without claiming official verification. */
  patch: PropertyPatch;
  evidence: DiscoveryIdentityEvidence[];
  /** Curated LandPortal facts retained for downstream evidence/detail views. */
  retainedLandPortalFacts: Record<string, string>;
  /** The subject parcel URL that retained visuals belong to. */
  visualSourceUrl: string | null;
  visualAssetCount: number;
  limitations: string[];
  conflicts: string[];
}

function text(value: unknown): string | null {
  const result = String(value ?? '').trim();
  return result && result !== '-' && result.toLowerCase() !== 'null' ? result : null;
}

function number(value: unknown): number | null {
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function compactApn(value: unknown): string {
  return String(value ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function countyKey(value: unknown): string {
  return String(value ?? '').toUpperCase().replace(/\bCOUNTY\b/g, '').replace(/[^0-9A-Z]/g, '');
}

function stateKey(value: unknown): string {
  const raw = String(value ?? '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (raw === 'SOUTHCAROLINA') return 'SC';
  if (raw === 'TENNESSEE') return 'TN';
  if (raw === 'GEORGIA') return 'GA';
  if (raw === 'FLORIDA') return 'FL';
  return raw;
}

function fact(facts: Record<string, string>, patterns: RegExp[]): string | null {
  for (const [key, value] of Object.entries(facts)) {
    if (patterns.some((pattern) => pattern.test(key.trim()))) {
      const found = text(value);
      if (found) return found;
    }
  }
  return null;
}

/**
 * A LandPortal address the parcel facts may be attributed to.
 *
 * A canonical `?property=` link is one. An operator's saved-map link is the
 * other: it opens the parcel record directly, and the workflow that opened it
 * puts whatever it landed on through the same parcel checkpoint before a fact
 * is read. Refusing that shape here rejected a parcel LandOS had already
 * verified, for want of a URL spelling.
 *
 * This admits the SURFACE, never the identity. Nothing about the map link is
 * treated as a parcel key: `decodeLandPortalCanonicalIdentity` still returns
 * nothing for it, `verifiedSubject` below still has to be true, and the
 * APN/county/state agreement gates are unchanged. The parcel that is admitted
 * is the one the opened record itself stated.
 */
function isLandPortalParcelUrl(value: string | null | undefined): value is string {
  try {
    const url = new URL(String(value ?? ''));
    if (!/(^|\.)landportal\.com$/i.test(url.hostname)) return false;
    if (url.searchParams.has('property') || /\/property\//i.test(url.pathname)) return true;
    return operatorLandPortalEntryUrl(value) !== null;
  } catch {
    return false;
  }
}

const RETAINED_FACT_LABELS = [
  /^owner\s*name$/i,
  /^parcel\s*(id|number|no|#)$/i,
  /^apn$/i,
  /^parcel\s*address(?:\s*(city|county|state|zip(?:\s*code)?))?$/i,
  /^acres$/i,
  /^calc\s*acres$/i,
  /^legal\s*description$/i,
  /^parcel\s*use\s*(code|description)$/i,
  /^land\s*locked$/i,
  /^road\s*frontage$/i,
  /^fema\s*(flood\s*zone|coverage)/i,
  /^wetlands\s*coverage/i,
  /^buildability/i,
  /^lp\s*estimate\s*(price|ppa|value|total)?$/i,
  /^estimate\s*(price|ppa|price\s*per\s*acre|value|total)$/i,
  /^slope\s*(avg|min|max)$/i,
  /^centroid\s*(latitude|longitude)$/i,
] as const;

function curatedFacts(facts: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(facts)) {
    const value = text(raw);
    if (value && RETAINED_FACT_LABELS.some((pattern) => pattern.test(key.trim()))) result[key.trim()] = value;
  }
  return result;
}

function curatedEstimateFacts(facts: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(facts)) {
    const value = text(raw);
    if (value && (/^estimate\s*(price|ppa|price\s*per\s*acre|value|total)$/i.test(key.trim())
      || /^lp\s*estimate\s*(price|ppa|value|total)?$/i.test(key.trim()))) {
      result[key.trim()] = value;
    }
  }
  return result;
}

function landPortalPatch(facts: Record<string, string>): PropertyPatch {
  const latitude = number(fact(facts, [/^centroid\s*latitude$/i, /^latitude$/i]));
  const longitudeRaw = fact(facts, [/^centroid\s*longitude$/i, /^longitude$/i]);
  const longitude = longitudeRaw == null ? null : Number(longitudeRaw.replace(/[^0-9.-]/g, ''));
  const coordinates = latitude != null && longitude != null && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? { lat: latitude, lng: longitude }
    : undefined;
  return {
    address: fact(facts, [/^parcel\s*address$/i, /^(situs|property|site)\s*address$/i]) ?? undefined,
    city: fact(facts, [/^parcel\s*address\s*city$/i, /^city$/i]) ?? undefined,
    county: fact(facts, [/^parcel\s*address\s*county$/i, /^county$/i]) ?? undefined,
    state: fact(facts, [/^parcel\s*address\s*state$/i, /^state$/i]) ?? undefined,
    zip: fact(facts, [/^parcel\s*address\s*zip(?:\s*code)?$/i, /^zip(?:\s*code)?$/i]) ?? undefined,
    apn: fact(facts, [/^parcel\s*(id|number|no|#)$/i, /^apn$/i]) ?? undefined,
    owner: fact(facts, [/^owner\s*name$/i, /^owner$/i]) ?? undefined,
    acres: number(fact(facts, [/^acres$/i, /^assessed\s*acres$/i])) ?? undefined,
    coordinates,
  };
}

function evidenceFor(
  patch: PropertyPatch,
  source: string,
  sourceUrl: string | null,
  confidence: DiscoveryIdentityConfidence,
  classification: DiscoveryIdentityEvidence['classification'],
): DiscoveryIdentityEvidence[] {
  const rows: DiscoveryIdentityEvidence[] = [];
  for (const field of ['address', 'city', 'county', 'state', 'zip', 'apn', 'owner', 'acres'] as const) {
    const value = patch[field];
    if (value != null && String(value).trim()) {
      rows.push({ field, value: String(value), source, sourceUrl, confidence, classification });
    }
  }
  return rows;
}

function mergePatch(primary: PropertyPatch, fallback: PropertyPatch): PropertyPatch {
  // The primary wins only where it HAS a value. A patch built from a source
  // carries every key, most of them undefined, so spreading it wholesale let a
  // sparse parcel panel blank out fields the subject already knew — an
  // address-only lead lost its county to a panel that simply does not print one.
  const present: PropertyPatch = {};
  for (const key of Object.keys(primary) as Array<keyof PropertyPatch>) {
    const value = primary[key];
    if (value != null && value !== '') (present as Record<string, unknown>)[key] = value;
  }
  const result = { ...fallback, ...present };
  for (const key of Object.keys(result) as Array<keyof PropertyPatch>) {
    if (result[key] == null || result[key] === '') delete result[key];
  }
  return result;
}

/**
 * Reconcile the strongest practical discovery-stage subject.
 *
 * `discoveryUsable` does not mean an official record or closing-grade proof
 * exists. It means the exact supplied APN/jurisdiction agrees with a real
 * parcel-level source and no hard identity conflict exists.
 */
export function reconcileDiscoveryIdentity(input: {
  subject: DiscoverySubjectInput;
  landPortal?: DiscoveryLandPortalEvidence | null;
  official?: DiscoveryOfficialParcelEvidence | null;
}): DiscoveryIdentityDecision {
  const operatorPatch: PropertyPatch = {
    address: text(input.subject.address) ?? undefined,
    city: text(input.subject.city) ?? undefined,
    county: text(input.subject.county) ?? undefined,
    state: text(input.subject.state) ?? undefined,
    zip: text(input.subject.zip) ?? undefined,
    apn: text(input.subject.apn) ?? undefined,
    owner: text(input.subject.owner) ?? undefined,
    acres: typeof input.subject.acres === 'number' && input.subject.acres > 0 ? input.subject.acres : undefined,
  };
  const lpFacts = input.landPortal?.parcelFacts ?? {};
  const lpPatch = landPortalPatch(lpFacts);
  const lpUrl = isLandPortalParcelUrl(input.landPortal?.parcelUrl) ? input.landPortal!.parcelUrl! : null;
  // The parcel PANEL publishes APN, owner, acreage and situs address — never a
  // county or a state. The parcel URL does: it addresses the page by county
  // FIPS. Without this the gate below rejected its own verified match for want
  // of a jurisdiction that the URL it was reading already carried, which is
  // what stranded 9490 Elk Lake Rd (deal 83) across twelve reruns.
  const lpCanonical = decodeLandPortalCanonicalIdentity(lpUrl);
  // The state half of a FIPS code is a fixed federal assignment, so deriving it
  // is a decode and not an inference. The county NAME is never invented here;
  // the FIPS itself identifies the county for matching purposes.
  if (lpCanonical?.state && !text(lpPatch.state)) lpPatch.state = lpCanonical.state;
  // A raw retained parcelUrl is not proof that the authenticated page belonged
  // to the supplied subject. The canonical parcel-url record is the only
  // durable association signal; legacy test/fixture callers that do not provide
  // the field retain their previous behavior.
  const landPortalSubjectVerified = input.landPortal?.verifiedSubject !== false;
  const officialPatch: PropertyPatch = input.official?.parcel ? {
    address: text(input.official.parcel.address) ?? undefined,
    city: text(input.official.parcel.city) ?? undefined,
    county: text(input.official.parcel.county) ?? undefined,
    state: text(input.official.parcel.state) ?? undefined,
    zip: text(input.official.parcel.zip) ?? undefined,
    apn: text(input.official.parcel.apn) ?? undefined,
    owner: text(input.official.parcel.owner) ?? undefined,
    acres: typeof input.official.parcel.acres === 'number' && input.official.parcel.acres > 0
      ? input.official.parcel.acres
      : undefined,
  } : {};

  const conflicts: string[] = [];
  const requestedApn = compactApn(operatorPatch.apn);
  const compare = (label: string, expected: string, observed: string, source: string): void => {
    if (expected && observed && expected !== observed) {
      conflicts.push(`${source} ${label} does not match the supplied subject (${String(observed)} vs ${String(expected)}).`);
    }
  };
  compare('APN', requestedApn, compactApn(lpPatch.apn), 'LandPortal');
  compare('county', countyKey(operatorPatch.county), countyKey(lpPatch.county), 'LandPortal');
  compare('state', stateKey(operatorPatch.state), stateKey(lpPatch.state), 'LandPortal');
  compare('APN', requestedApn, compactApn(officialPatch.apn), input.official?.source ?? 'Official parcel source');
  compare('county', countyKey(operatorPatch.county), countyKey(officialPatch.county), input.official?.source ?? 'Official parcel source');
  compare('state', stateKey(operatorPatch.state), stateKey(officialPatch.state), input.official?.source ?? 'Official parcel source');

  const limitations: string[] = [];
  if (input.official?.status !== 'matched') {
    limitations.push(
      input.official?.note?.trim()
        || 'No official parcel source confirmed the subject during this discovery run; official ownership and acreage remain to be checked before closing.',
    );
  }
  if (lpPatch.address && operatorPatch.address && !addressVariantsCompatible(operatorPatch.address, lpPatch.address)) {
    limitations.push(`LandPortal displays "${lpPatch.address}" while intake displays "${operatorPatch.address}"; the exact APN/jurisdiction agreement controls discovery identity and the situs spelling remains disclosed.`);
  }

  const officialExact = input.official?.status === 'matched'
    && !!officialPatch.apn
    && (!requestedApn || compactApn(officialPatch.apn) === requestedApn)
    && !!(officialPatch.county || officialPatch.state);
  // The subject's own retained county FIPS matching the provider's canonical
  // key is the strongest agreement available short of an official record: both
  // sides are naming the same county by the same federal code, and the APNs
  // agree. This is the path a RERUN takes once identity reconciliation has
  // written the resolved jurisdiction onto the subject record.
  const subjectFips = String(input.subject.fips ?? '').replace(/\D/g, '');
  const landPortalFipsMatch = !!requestedApn
    && !!lpCanonical
    && subjectFips.length === 5
    && lpCanonical.fips === subjectFips
    && compactApn(lpCanonical.apn) === requestedApn;
  const landPortalApnMatch = landPortalFipsMatch || (!!requestedApn
    && compactApn(lpPatch.apn) === requestedApn
    && !!countyKey(operatorPatch.county)
    && countyKey(lpPatch.county) === countyKey(operatorPatch.county)
    && !!stateKey(operatorPatch.state)
    && stateKey(lpPatch.state) === stateKey(operatorPatch.state));
  // A normal fresh lead often starts with an address only. The authenticated
  // parcel page then supplies the APN and county during this same mission, so
  // requiring those fields to have existed in the intake creates a circular
  // gate: the evidence that identifies the subject is rejected because it was
  // not known before research ran. A parcel-level URL plus a compatible street
  // address, matching state, and the page's own APN + county is a practical,
  // unambiguous discovery match. Genuine address/APN/jurisdiction conflicts
  // are still rejected above.
  const landPortalAddressMatch = !requestedApn
    && !!operatorPatch.address
    && !!lpPatch.address
    && addressVariantsCompatible(operatorPatch.address, lpPatch.address)
    && !!compactApn(lpPatch.apn)
    // A county FIPS identifies the county exactly. Requiring a county NAME the
    // parcel panel never prints is what made an address-only lead unresolvable.
    && (!!countyKey(lpPatch.county) || !!lpCanonical?.fips)
    && !!stateKey(lpPatch.state)
    && (!stateKey(operatorPatch.state) || stateKey(lpPatch.state) === stateKey(operatorPatch.state));
  const landPortalExact = landPortalSubjectVerified && !!lpUrl && (landPortalApnMatch || landPortalAddressMatch);

  const lpSource = input.landPortal?.sourceLabel?.trim() || 'LandPortal authenticated parcel panel';
  const officialSource = input.official?.source?.trim() || 'Official parcel source';
  const sources = new Set<string>(['Operator-supplied subject']);
  if (Object.keys(lpPatch).length) sources.add(lpSource);
  if (input.official) sources.add(officialSource);

  if (conflicts.length) {
    return {
      state: 'conflicted',
      discoveryUsable: false,
      discoveryBasis: `Subject identity is conflicted: ${conflicts.join(' ')}`,
      discoverySources: [...sources],
      confidence: 'low',
      patch: operatorPatch,
      evidence: evidenceFor(operatorPatch, 'Operator input', null, 'medium', 'operator_input'),
      retainedLandPortalFacts: landPortalSubjectVerified ? curatedFacts(lpFacts) : curatedEstimateFacts(lpFacts),
      visualSourceUrl: lpUrl,
      visualAssetCount: Math.max(0, input.landPortal?.assetCount ?? 0),
      limitations,
      conflicts,
    };
  }

  if (officialExact) {
    const patch = mergePatch(officialPatch, landPortalSubjectVerified ? mergePatch(lpPatch, operatorPatch) : operatorPatch);
    return {
      state: 'confirmed',
      discoveryUsable: true,
      discoveryBasis: `The supplied APN and jurisdiction agree with ${officialSource}. LandPortal subject facts are retained as supporting discovery evidence.`,
      discoverySources: [...sources],
      confidence: 'high',
      patch,
      evidence: [
        ...evidenceFor(officialPatch, officialSource, input.official?.sourceUrl ?? null, 'high', 'official_record'),
        ...evidenceFor(lpPatch, lpSource, lpUrl, 'medium', 'marketplace_parcel_panel'),
      ],
      retainedLandPortalFacts: landPortalSubjectVerified ? curatedFacts(lpFacts) : curatedEstimateFacts(lpFacts),
      visualSourceUrl: lpUrl,
      visualAssetCount: Math.max(0, input.landPortal?.assetCount ?? 0),
      limitations,
      conflicts,
    };
  }

  if (landPortalExact) {
    const jurisdiction = [operatorPatch.county && `${operatorPatch.county} County`, operatorPatch.state].filter(Boolean).join(', ');
    const patch = mergePatch(lpPatch, operatorPatch);
    const matchDescription = requestedApn
      ? `the supplied APN ${operatorPatch.apn}${jurisdiction ? ` in ${jurisdiction}` : ''}`
      : `the supplied address ${operatorPatch.address}`;
    return {
      state: 'provisional',
      discoveryUsable: true,
      // Name the jurisdiction the way it was actually established. When the
      // panel printed no county, the parcel URL's own county FIPS is cited —
      // never a county name that no source supplied.
      discoveryBasis: `Subject established for discovery: ${matchDescription} agrees with the authenticated LandPortal parcel panel for APN ${lpPatch.apn ?? lpCanonical?.apn} in ${
        text(lpPatch.county) ? `${lpPatch.county}, ${lpPatch.state}` : `county FIPS ${lpCanonical?.fips}${lpPatch.state ? ` (${lpPatch.state})` : ''}`
      }. County sources were attempted; their current coverage limitation remains noted while the full analysis proceeds from this parcel match.`,
      discoverySources: [...sources],
      confidence: 'medium',
      patch,
      evidence: [
        ...evidenceFor(operatorPatch, 'Operator input', null, 'medium', 'operator_input'),
        ...evidenceFor(lpPatch, lpSource, lpUrl, 'medium', 'marketplace_parcel_panel'),
      ],
      retainedLandPortalFacts: landPortalSubjectVerified ? curatedFacts(lpFacts) : curatedEstimateFacts(lpFacts),
      visualSourceUrl: lpUrl,
      visualAssetCount: Math.max(0, input.landPortal?.assetCount ?? 0),
      limitations,
      conflicts,
    };
  }

  // A fresh address lead with a supplied state but no APN/county can still
  // enter discovery-stage market research when LandPortal has no exact match.
  // This is deliberately narrower than parcel identity: APN-bearing or
  // county-bearing inputs remain blocked unless an exact source agrees, while
  // Zillow/Redfin and other practical marketplace lanes may continue against
  // the operator-supplied address. No official parcel fact is promoted here.
  const marketplaceDiscoveryFallback = !requestedApn
    && !!operatorPatch.address
    && !!stateKey(operatorPatch.state)
    && !countyKey(operatorPatch.county);
  const named = !!(operatorPatch.apn || operatorPatch.address);
  return {
    state: named ? 'provisional' : 'unresolved',
    discoveryUsable: marketplaceDiscoveryFallback,
    discoveryBasis: named
      ? marketplaceDiscoveryFallback
        ? 'Subject retained for discovery-stage market research from the operator-supplied address and state. LandPortal returned no exact parcel match; practical marketplace sources may continue, but no official parcel identity is claimed.'
        : 'A subject was supplied, but no exact parcel-level source agreed on its APN and jurisdiction.'
      : 'No subject parcel identifier is available.',
    discoverySources: [...sources, ...(marketplaceDiscoveryFallback ? ['Operator address/state discovery fallback'] : [])],
    confidence: named ? 'low' : 'none',
    // Unverified LandPortal results remain context evidence only. They must not
    // populate the subject APN, acreage, coordinates, frontage, access, slope,
    // wetlands, flood, or buildability fields.
    patch: landPortalSubjectVerified ? mergePatch(lpPatch, operatorPatch) : operatorPatch,
    evidence: [
      ...evidenceFor(operatorPatch, 'Operator input', null, 'medium', 'operator_input'),
      ...evidenceFor(lpPatch, lpSource, lpUrl, 'low', 'marketplace_parcel_panel'),
    ],
    retainedLandPortalFacts: landPortalSubjectVerified ? curatedFacts(lpFacts) : curatedEstimateFacts(lpFacts),
    visualSourceUrl: lpUrl,
    visualAssetCount: Math.max(0, input.landPortal?.assetCount ?? 0),
    limitations,
    conflicts,
  };
}
