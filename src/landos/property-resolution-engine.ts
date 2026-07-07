// LandOS — Property Resolution Engine (property-first).
//
// ONE responsibility: resolve the intended property. It runs practical retrieval
// lanes until the property is confidently identified (Matched) or every
// reasonable lane is exhausted (Needs Clarification). It is provider-agnostic and
// never stops because a single provider failed. This is PRE-CALL Due Diligence:
// the bar is "enough credible evidence to identify the intended property for an
// informed seller conversation," NOT legal-grade title verification.
//
// Returns exactly two outcomes:
//   • Matched              — run the report; unknown fields become Confirm Before Offer.
//   • Needs Clarification  — no practical match; show the smallest next identifier.
//
// Every lane returns the SAME NormalizedProperty patch. All I/O is injected, so
// the engine is pure + deterministic in tests and the route wires the live
// adapters (Realie/LandPortal, Census, Photon, HomeHarvest, browser lanes).

import {
  emptyNormalizedProperty, mergeNormalized, missingFields, deriveConfidence,
  patchFromDukeVerification, patchFromCensus, corroboratingIdentityLanes,
  type NormalizedProperty, type RetrievalLane,
} from './normalized-property.js';
import type { ParsedIntakeFields } from './intake-router.js';
import { classifySmartIntake } from './intake-router.js';
import { smallestNextIdentifier, type IntakeFields } from './resolver-planner.js';
import type { DukeVerificationResult } from './duke-verification-bridge.js';
import type { DerivedCounty } from './providers/county-geocode.js';
import type { SuggestResult } from './address-suggest.js';
import type { BrowserRetrievalLane, BrowserLaneInput } from './browser-retrieval.js';
import type { PropertyPatch } from './normalized-property.js';
import type { BrowserService, BrowserEvidence, BrowserSearchKey } from './browser-intelligence.js';
import { analyzeMissingFields, type MissingFieldAnalysis } from './missing-field-analysis.js';

export type ResolutionStatus = 'matched' | 'needs_clarification';

export interface ResolutionLaneRecord {
  lane: RetrievalLane;
  ran: boolean;
  contributed: boolean;
  status: string;
  note: string;
}

export interface PropertyResolution {
  status: ResolutionStatus;
  property: NormalizedProperty;
  confidence: number;
  /** Why it matched (or why not). Deterministic, human-readable. */
  matchedReason: string;
  /** Practical guidance when Needs Clarification (smallest next identifier). */
  guidance?: string;
  /** Practical fields still unknown — surfaced downstream as Confirm Before Offer. */
  missing: NormalizedProperty['missing'];
  lanesAttempted: ResolutionLaneRecord[];
  /** Browser Intelligence evidence (LandPortal-first, then County gap-fill).
   *  Feeds the DD engine + Deal Card; never generates the Deal Card directly. */
  browserEvidence: BrowserEvidence[];
  /** Structured missing-field analysis after LandPortal (drives county gap-fill). */
  missingFieldAnalysis?: MissingFieldAnalysis;
  /** TRUE only when the intended parcel has actually been CONFIRMED — by a named
   *  source (parcelVerified), by the Browser Agent reading it on LandPortal, or by
   *  ≥2 independent corroborating sources. This is the MANDATORY GATE: downstream
   *  departments (Property Intelligence, comps, Market Pulse, Strategy, Discovery)
   *  must NOT run until this is true. A property can be `matched` (credible) without
   *  being identity-established (e.g. only the operator's own pasted identifiers back
   *  it and no source has confirmed the parcel yet). */
  identityEstablished: boolean;
  /** Human-readable reason the identity is (or is not) established. */
  identityBasis: string;
  /** Read-only: the engine resolves identity; it never writes a card itself. */
  executionMode: 'property_resolution';
}

export interface ResolutionInput {
  /** Raw operator text (optional when fields are supplied directly). */
  rawText?: string;
  /** Pre-parsed fields (e.g. from the Smart Intake classifier or a selected suggestion). */
  fields?: ParsedIntakeFields;
}

export interface ResolutionDeps {
  /** Named-source parcel verification (Realie/LandPortal). The ONLY lane that can
   *  set parcelVerified. Built from fields so the engine can retry with county. */
  verify?: (fields: ParsedIntakeFields, timeoutMs: number) => Promise<DukeVerificationResult>;
  /** Free US Census county/FIPS/coords derivation for a full address. */
  deriveCounty?: (fields: ParsedIntakeFields) => Promise<DerivedCounty | null>;
  /** Smart Address Search corroboration (Photon/Census). */
  suggest?: (query: string) => Promise<SuggestResult>;
  /** Open-source listing/land lane (HomeHarvest) — returns a patch or null. */
  homeHarvest?: (fields: ParsedIntakeFields) => Promise<PropertyPatch | null>;
  /** Browser retrieval lanes (NETR/county GIS/LandPortal/Land ID read-only). */
  browserLanes?: BrowserRetrievalLane[];
  /** Browser Intelligence services (Phase 5): LandPortal-first, then County
   *  gap-fill driven by missing-field analysis. Parked unless a session exists. */
  landPortalBrowser?: BrowserService;
  countyRecordsBrowser?: BrowserService;
  /** Previously resolved property from the LandOS cache. */
  cacheGet?: (fields: ParsedIntakeFields) => NormalizedProperty | null;
  now?: () => string;
  /** Confidence at/above which an unverified property is still Matched. */
  matchConfidence?: number;
  timeoutMs?: number;
}

const DEFAULT_MATCH_CONFIDENCE = 0.7;

function toIntakeFields(f: ParsedIntakeFields): IntakeFields {
  return { address: f.address, city: f.city, state: f.state, zip: f.zip, county: f.county, fips: f.fips, apn: f.apn, owner: f.owner, propertyId: f.propertyId };
}

function suggestQuery(f: ParsedIntakeFields, rawText?: string): string {
  const parts = [f.address, f.city, f.state, f.zip].filter(Boolean).join(', ');
  return parts || (rawText ?? '').trim();
}

/** Seed the operator-supplied subject directly (no evidence — it's the input, not
 *  a corroborating retrieval). Lanes then corroborate/extend it. */
function seedSubject(p: NormalizedProperty, f: ParsedIntakeFields): void {
  if (f.address) p.address = f.address;
  if (f.city) p.city = f.city;
  if (f.state) p.state = f.state;
  if (f.zip) p.zip = f.zip;
  if (f.county) p.county = f.county;
  if (f.fips) p.fips = f.fips;
  if (f.apn) p.apn = f.apn;
  if (f.owner) p.owner = f.owner;
  if (f.propertyId) p.propertyId = f.propertyId;
  if (f.lpUrl) p.lpUrl = f.lpUrl;
  p.missing = missingFields(p);
  p.confidence = deriveConfidence(p);
}

/**
 * Resolve the intended property. Runs lanes in priority order, accumulating
 * sourced evidence, and returns Matched | Needs Clarification with a single
 * NormalizedProperty. Never throws out of the function; a failing lane is
 * recorded and the next lane runs (never stops on one provider).
 */
export async function resolveProperty(input: ResolutionInput, deps: ResolutionDeps = {}): Promise<PropertyResolution> {
  const now = deps.now ?? (() => new Date().toISOString());
  const timeoutMs = deps.timeoutMs ?? 12000;
  const matchConfidence = deps.matchConfidence ?? DEFAULT_MATCH_CONFIDENCE;

  // Parse fields (explicit fields win; else classify the raw text).
  let fields: ParsedIntakeFields =
    input.fields ?? (input.rawText ? classifySmartIntake(input.rawText).parsedFields : {});

  const property = emptyNormalizedProperty();
  const lanes: ResolutionLaneRecord[] = [];
  const browserEvidence: BrowserEvidence[] = [];
  let missingFieldAnalysis: MissingFieldAnalysis | undefined;
  const record = (lane: RetrievalLane, ran: boolean, contributed: boolean, status: string, note: string) =>
    lanes.push({ lane, ran, contributed, status, note });

  seedSubject(property, fields);

  // ── Lane 0: LandOS cache ──────────────────────────────────────────────
  if (deps.cacheGet) {
    try {
      const cached = deps.cacheGet(fields);
      if (cached) {
        mergeNormalized(property, 'landos_cache', cached.verificationSource ?? 'LandOS cache',
          {
            address: cached.address, county: cached.county, city: cached.city, state: cached.state,
            zip: cached.zip, apn: cached.apn, owner: cached.owner, acres: cached.acres,
            propertyId: cached.propertyId, fips: cached.fips, lpUrl: cached.lpUrl,
            coordinates: cached.coordinates,
            parcelVerified: cached.parcelVerified, verificationSource: cached.verificationSource,
          }, { confidence: cached.parcelVerified ? 0.95 : 0.7, timestamp: now() });
        record('landos_cache', true, true, cached.parcelVerified ? 'verified_cache' : 'cache_hit', 'Reused a previously resolved property from the LandOS cache.');
      } else {
        record('landos_cache', true, false, 'miss', 'No cached property for this input.');
      }
    } catch { record('landos_cache', true, false, 'error', 'Cache lookup failed; continued.'); }
  }

  // ── Lane 1: Realie/LandPortal named-source verification (strongest) ──────
  if (deps.verify && !property.parcelVerified) {
    try {
      const v = await deps.verify(fields, timeoutMs);
      const contributed = mergeAndReport(property, 'realie_landportal', v.verificationSource ?? 'Realie/LandPortal', patchFromDukeVerification(v), now(), v.parcelVerified ? 0.95 : 0.5);
      record('realie_landportal', true, contributed, v.status, v.summary);
      // ── Lane 2: derive county and RETRY when an exact lookup needs county/FIPS ──
      const needsCounty = !v.parcelVerified && (v.dataGaps.includes('needs_county_or_fips') || (!fields.county && !fields.fips));
      if (needsCounty && deps.deriveCounty && fields.address) {
        try {
          const d = await deps.deriveCounty(fields);
          if (d) {
            const c = mergeAndReport(property, 'census_geocode', 'US Census geocoder', patchFromCensus(d), now(), 0.7);
            record('census_geocode', true, c, 'county_derived', `Derived county ${d.county}${d.fips ? ` (FIPS ${d.fips})` : ''} via the free US Census geocoder.`);
            const retryFields: ParsedIntakeFields = { ...fields, county: fields.county ?? d.county, fips: fields.fips ?? d.fips ?? undefined };
            fields = retryFields;
            if (!property.parcelVerified) {
              const v2 = await deps.verify(retryFields, timeoutMs);
              const c2 = mergeAndReport(property, 'realie_landportal', v2.verificationSource ?? 'Realie/LandPortal', patchFromDukeVerification(v2), now(), v2.parcelVerified ? 0.95 : 0.5);
              record('realie_landportal', true, c2, `retry_${v2.status}`, `County-constrained retry: ${v2.summary}`);
            }
          } else {
            record('census_geocode', true, false, 'no_match', 'Census geocoder returned no county for the address.');
          }
        } catch { record('census_geocode', true, false, 'error', 'Census derivation failed; continued.'); }
      }
      // ── Alternate-APN retry: a county may index the parcel under a different
      // APN format than the operator pasted (e.g. a parenthetical alternate
      // "(094 02008 000)"). Try ONE alternate when the primary did not verify.
      // Bounded to a single extra attempt so provider calls never run away.
      if (!property.parcelVerified && fields.apnAlternates?.length) {
        const altApn = fields.apnAlternates[0];
        try {
          const va = await deps.verify({ ...fields, apn: altApn }, timeoutMs);
          const ca = mergeAndReport(property, 'realie_landportal', va.verificationSource ?? 'Realie/LandPortal', patchFromDukeVerification(va), now(), va.parcelVerified ? 0.95 : 0.5);
          record('realie_landportal', true, ca, `alt_apn_${va.status}`, `Alternate APN (${altApn}) retry: ${va.summary}`);
        } catch { record('realie_landportal', true, false, 'error', 'Alternate APN retry failed; continued.'); }
      }
    } catch { record('realie_landportal', true, false, 'error', 'Parcel verification unavailable; continued with other lanes.'); }
  }

  // ── Lane 3: Smart Address Search corroboration (Photon/Census) ──────────
  if (deps.suggest && !property.parcelVerified) {
    try {
      const q = suggestQuery(fields, input.rawText);
      const sres = await deps.suggest(q);
      const top = sres.suggestions[0];
      if (top) {
        // Some providers return a road/highway SEGMENT without the house number
        // (e.g. "State Highway 153, Winters, TX" for "2510 State Highway 153").
        // Preserve the operator's house number so corroboration never strips it.
        const keepNum = (candidate?: string): string | undefined => {
          if (!candidate) return candidate;
          if (/^\s*\d/.test(candidate)) return candidate;
          const num = fields.address?.trim().match(/^(\d+[A-Za-z]?)\b/)?.[1];
          return num ? `${num} ${candidate}` : candidate;
        };
        const contributed = mergeAndReport(property, 'address_suggest', top.source, {
          address: keepNum(top.line1 ?? top.label), normalizedAddress: keepNum(top.label),
          city: top.city, state: top.state, zip: top.zip, county: top.county, coordinates: top.coordinates,
        }, now(), top.confidence);
        record('address_suggest', true, contributed, 'suggested', `Smart Address Search corroborated: ${top.label} (${top.source}).`);
      } else {
        record('address_suggest', true, false, 'no_suggestion', sres.note ?? 'No address suggestions.');
      }
    } catch { record('address_suggest', true, false, 'error', 'Address suggestion failed; continued.'); }
  }

  // ── Lane 4: Open-source listing/land lane (HomeHarvest) ─────────────────
  if (deps.homeHarvest && !property.parcelVerified) {
    try {
      const patch = await deps.homeHarvest(fields);
      if (patch) {
        const contributed = mergeAndReport(property, 'homeharvest', 'HomeHarvest (open source)', patch, now(), 0.55);
        record('homeharvest', true, contributed, 'listing_evidence', 'HomeHarvest contributed listing/land evidence.');
      } else {
        record('homeharvest', true, false, 'no_match', 'HomeHarvest returned no matching property.');
      }
    } catch { record('homeharvest', true, false, 'error', 'HomeHarvest lane failed; continued.'); }
  }

  // ── Browser Intelligence (Phase 5): LandPortal-first, then County gap-fill ─
  // LandPortal Browser drives (largest property intelligence in one place). A
  // missing-field analysis then decides what County Records must fill, so nothing
  // is collected twice. Parked + honest until an authenticated session is enabled;
  // the structured patch (not the screenshot) is the real contribution.
  const searchKey: BrowserSearchKey = { address: fields.address, apn: fields.apn, apnAlternates: fields.apnAlternates, owner: fields.owner, city: fields.city, county: fields.county, state: fields.state, zip: fields.zip };
  if (deps.landPortalBrowser) {
    try {
      const lp = await deps.landPortalBrowser.runWorkflow({ searchKey }, { timeoutMs });
      browserEvidence.push(lp);
      const contributed = (lp.status === 'retrieved' || lp.status === 'partial')
        ? mergeAndReport(property, 'landportal_readonly', 'LandPortal Browser', lp.patch, now(), 0.7, lp.sourceUrls[0])
        : false;
      record('landportal_readonly', lp.status !== 'parked', contributed, lp.status, lp.note);
      // Missing-field analysis AFTER LandPortal — drives county gap-fill (no dup).
      missingFieldAnalysis = analyzeMissingFields(property, lp);
      if (deps.countyRecordsBrowser) {
        try {
          const cr = await deps.countyRecordsBrowser.runWorkflow({ searchKey, neededFields: missingFieldAnalysis.missing }, { timeoutMs });
          browserEvidence.push(cr);
          const c2 = (cr.status === 'retrieved' || cr.status === 'partial')
            ? mergeAndReport(property, 'county_records', 'County Records Browser', cr.patch, now(), 0.65, cr.sourceUrls[0])
            : false;
          record('county_records', cr.status !== 'parked', c2, cr.status, cr.note);
        } catch { record('county_records', true, false, 'error', 'County Records browser failed; continued.'); }
      }
    } catch { record('landportal_readonly', true, false, 'error', 'LandPortal browser failed; continued.'); }
  } else if (deps.countyRecordsBrowser) {
    try {
      const cr = await deps.countyRecordsBrowser.runWorkflow({ searchKey }, { timeoutMs });
      browserEvidence.push(cr);
      const c2 = (cr.status === 'retrieved' || cr.status === 'partial')
        ? mergeAndReport(property, 'county_records', 'County Records Browser', cr.patch, now(), 0.65, cr.sourceUrls[0])
        : false;
      record('county_records', cr.status !== 'parked', c2, cr.status, cr.note);
    } catch { record('county_records', true, false, 'error', 'County Records browser failed; continued.'); }
  }

  // ── Lane 5: legacy parked browser-retrieval lanes (NETR/GIS/Land ID) ─────
  if (deps.browserLanes?.length && !property.parcelVerified) {
    const bInput: BrowserLaneInput = { address: fields.address, city: fields.city, state: fields.state, county: fields.county, zip: fields.zip, apn: fields.apn, owner: fields.owner };
    for (const lane of deps.browserLanes) {
      if (!lane.configured()) { record(lane.id, false, false, 'parked', `${lane.label}: parked (not configured).`); continue; }
      try {
        const f = await lane.find(bInput, { timeoutMs });
        const contributed = f.status === 'matched' || f.status === 'partial'
          ? mergeAndReport(property, lane.id, f.source, f.patch, now(), f.confidence, f.sourceUrl)
          : false;
        record(lane.id, true, contributed, f.status, f.note);
        if (property.parcelVerified) break;
      } catch { record(lane.id, true, false, 'error', `${lane.label} failed; continued.`); }
    }
  }

  // ── Decision ────────────────────────────────────────────────────────────
  property.missing = missingFields(property);
  property.confidence = deriveConfidence(property);
  const hasSubject = !!property.address && !!property.state;
  const matched = property.parcelVerified || (property.confidence >= matchConfidence && hasSubject);
  const identity = parcelIdentityEstablished(property, browserEvidence);

  if (matched) {
    return {
      status: 'matched',
      property,
      confidence: property.confidence,
      matchedReason: property.parcelVerified
        ? `Parcel identity verified by ${property.verificationSource ?? 'a named source'}.`
        : `Credible evidence from ${property.sources.length} source(s) resolves the intended property (confidence ${property.confidence.toFixed(2)}). Unknown fields become Confirm Before Offer.`,
      guidance: undefined,
      missing: property.missing,
      lanesAttempted: lanes,
      browserEvidence,
      missingFieldAnalysis,
      identityEstablished: identity.established,
      identityBasis: identity.basis,
      executionMode: 'property_resolution',
    };
  }

  return {
    status: 'needs_clarification',
    property,
    confidence: property.confidence,
    matchedReason: 'No practical match could be established from the available lanes.',
    guidance: `Provide a stronger identifier to resolve this property — e.g. ${smallestNextIdentifier(toIntakeFields(fields))}. (APN + county, owner + city/state, or a corrected full address all work.)`,
    missing: property.missing,
    lanesAttempted: lanes,
    browserEvidence,
    missingFieldAnalysis,
    identityEstablished: identity.established,
    identityBasis: identity.basis,
    executionMode: 'property_resolution',
  };
}

/**
 * THE MANDATORY IDENTITY GATE. Decide whether the intended parcel has actually
 * been CONFIRMED (not merely echoed from operator input). Only when this returns
 * `established: true` may downstream departments run. Deterministic + explainable.
 *
 * Established when ANY of:
 *   1. A named source verified the parcel (`parcelVerified`).
 *   2. The Browser Agent read the parcel on LandPortal and returned an APN + a
 *      jurisdiction (county/state/FIPS) + a real source URL — i.e. it reached the
 *      actual parcel panel, not just a search page.
 *   3. ≥2 INDEPENDENT retrieval lanes corroborate identity-bearing fields (the
 *      operator's own seeded input is NOT an evidence lane, so pure echo scores 0).
 */
export function parcelIdentityEstablished(
  property: NormalizedProperty,
  browserEvidence: BrowserEvidence[] = [],
): { established: boolean; basis: string } {
  if (property.parcelVerified) {
    return { established: true, basis: `Parcel identity verified by ${property.verificationSource ?? 'a named source'}.` };
  }
  const lp = browserEvidence.find((ev) => ev.service === 'landportal' && ev.status === 'retrieved');
  if (lp) {
    const apn = (lp.patch?.apn as string | undefined) ?? property.apn;
    const juris = (lp.patch?.county as string | undefined) ?? property.county
      ?? (lp.patch?.state as string | undefined) ?? property.state
      ?? (lp.patch?.fips as string | undefined) ?? property.fips;
    const url = (lp.sourceUrls ?? []).find((u) => /^https?:\/\//i.test(u));
    if (apn && juris && url) {
      return { established: true, basis: 'Browser Agent located and read the parcel on LandPortal (APN + jurisdiction confirmed from the parcel panel).' };
    }
  }
  const lanes = corroboratingIdentityLanes(property);
  if (lanes.length >= 2) {
    return { established: true, basis: `Identity corroborated by ${lanes.length} independent sources (${lanes.join(', ')}).` };
  }
  // A FULL street address (house-numbered) that an external geocoder actually
  // corroborated and resolved to a point, inside a known county/state, is a
  // resolved location — enough for pre-call intelligence. This is the difference
  // between a geocoded street address ("388 Gilstrap Rd", Photon-confirmed with a
  // point) and the failure mode this sprint targets: a bare road name + an echoed
  // APN that NO external source ever confirmed (the geocoder returns nothing for a
  // house-number-less road, so no lane corroborates and there is no point).
  const hasFullStreetAddress = !!property.address && /^\s*\d/.test(property.address);
  const hasLocality = !!property.county && !!property.state;
  if (lanes.length >= 1 && hasFullStreetAddress && property.coordinates && hasLocality) {
    return { established: true, basis: `A full street address corroborated by ${lanes[0]} and resolved to a point in ${property.county}, ${property.state} locates the parcel for pre-call intelligence.` };
  }
  return {
    established: false,
    basis: lanes.length >= 1
      ? `The intended parcel is not yet confirmed — only ${lanes[0]} plus the operator input support it, without a geocoded street address. Confirm the parcel on LandPortal (Browser Agent, needs an authenticated session) or verify via a named source before downstream intelligence runs.`
      : 'No external source has confirmed this parcel yet — only the operator-supplied identifiers. Confirm the parcel on LandPortal (Browser Agent) or verify via a named source before downstream intelligence runs.',
  };
}

/** Merge a patch and report whether it actually contributed a new field/evidence. */
function mergeAndReport(p: NormalizedProperty, lane: RetrievalLane, source: string, patch: PropertyPatch, ts: string, confidence: number, sourceUrl?: string): boolean {
  const before = p.evidence.length;
  mergeNormalized(p, lane, source, patch, { timestamp: ts, confidence, sourceUrl });
  return p.evidence.length > before;
}
