// Discovery-stage subject identity reconciliation.
//
// Legal-grade proof is intentionally not the discovery bar. A full operator
// APN + jurisdiction that agrees with an authenticated LandPortal parcel panel
// is usable for discovery research even when the official county source cannot
// answer. Official evidence remains stronger, every limitation stays visible,
// and a genuine APN/jurisdiction disagreement is always a hard stop.

import { addressVariantsCompatible } from './instruction-consistency.js';
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
}

export interface DiscoveryLandPortalEvidence {
  parcelUrl?: string | null;
  parcelFacts?: Record<string, string> | null;
  assetCount?: number;
  sourceLabel?: string;
  sourceNote?: string | null;
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

function isLandPortalParcelUrl(value: string | null | undefined): value is string {
  try {
    const url = new URL(String(value ?? ''));
    return /(^|\.)landportal\.com$/i.test(url.hostname)
      && (url.searchParams.has('property') || /\/property\//i.test(url.pathname));
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
  const result = { ...fallback, ...primary };
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
  const landPortalExact = !!lpUrl
    && !!requestedApn
    && compactApn(lpPatch.apn) === requestedApn
    && !!countyKey(operatorPatch.county)
    && countyKey(lpPatch.county) === countyKey(operatorPatch.county)
    && !!stateKey(operatorPatch.state)
    && stateKey(lpPatch.state) === stateKey(operatorPatch.state);

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
      retainedLandPortalFacts: curatedFacts(lpFacts),
      visualSourceUrl: lpUrl,
      visualAssetCount: Math.max(0, input.landPortal?.assetCount ?? 0),
      limitations,
      conflicts,
    };
  }

  if (officialExact) {
    const patch = mergePatch(officialPatch, mergePatch(lpPatch, operatorPatch));
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
      retainedLandPortalFacts: curatedFacts(lpFacts),
      visualSourceUrl: lpUrl,
      visualAssetCount: Math.max(0, input.landPortal?.assetCount ?? 0),
      limitations,
      conflicts,
    };
  }

  if (landPortalExact) {
    const jurisdiction = [operatorPatch.county && `${operatorPatch.county} County`, operatorPatch.state].filter(Boolean).join(', ');
    const patch = mergePatch(lpPatch, operatorPatch);
    return {
      state: 'provisional',
      discoveryUsable: true,
      discoveryBasis: `Discovery-stage subject established: the full supplied APN ${operatorPatch.apn} in ${jurisdiction} agrees exactly with the authenticated LandPortal parcel panel. Official coverage did not independently confirm the parcel, so confidence is medium and the source limitation remains disclosed; this is not closing-grade proof.`,
      discoverySources: [...sources],
      confidence: 'medium',
      patch,
      evidence: [
        ...evidenceFor(operatorPatch, 'Operator input', null, 'medium', 'operator_input'),
        ...evidenceFor(lpPatch, lpSource, lpUrl, 'medium', 'marketplace_parcel_panel'),
      ],
      retainedLandPortalFacts: curatedFacts(lpFacts),
      visualSourceUrl: lpUrl,
      visualAssetCount: Math.max(0, input.landPortal?.assetCount ?? 0),
      limitations,
      conflicts,
    };
  }

  const named = !!(operatorPatch.apn || operatorPatch.address);
  return {
    state: named ? 'provisional' : 'unresolved',
    discoveryUsable: false,
    discoveryBasis: named
      ? 'A subject was supplied, but no exact parcel-level source agreed on its APN and jurisdiction.'
      : 'No subject parcel identifier is available.',
    discoverySources: [...sources],
    confidence: named ? 'low' : 'none',
    patch: mergePatch(lpPatch, operatorPatch),
    evidence: [
      ...evidenceFor(operatorPatch, 'Operator input', null, 'medium', 'operator_input'),
      ...evidenceFor(lpPatch, lpSource, lpUrl, 'low', 'marketplace_parcel_panel'),
    ],
    retainedLandPortalFacts: curatedFacts(lpFacts),
    visualSourceUrl: lpUrl,
    visualAssetCount: Math.max(0, input.landPortal?.assetCount ?? 0),
    limitations,
    conflicts,
  };
}
