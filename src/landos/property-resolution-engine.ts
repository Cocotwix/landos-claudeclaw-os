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
  patchFromDukeVerification, patchFromCensus, corroboratingParcelLevelLanes,
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

/** A hard APN identifier conflict — the requested parcel and the resolved parcel
 *  are not the same parcel. */
export interface ApnConflict {
  /** APN the operator asked for (display form). */
  requestedApn: string;
  /** APN the resolving lane actually returned (a DIFFERENT parcel). */
  resolvedApn: string;
  /** Which lane/source resolved the mismatching parcel. */
  source: string;
  /** Resolved owner/address context when known — helps the operator see the
   *  wrong parcel it landed on (never treated as the subject). */
  resolvedContext?: string;
}

/** Compact an APN/parcel id for identity comparison: lowercase, alphanumerics
 *  only. "R300 018 000 0085 0000" and "R300-018-000-0085-0000" compare equal. */
function compactParcelId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * PURE: detect a hard APN conflict. Returns a conflict ONLY when the operator
 * supplied at least one usable APN variant AND at least one parcel-level lane
 * resolved an APN, AND NONE of the resolved APNs match ANY requested variant. If
 * any resolved APN matches a requested variant, identity is corroborated (no
 * conflict) — a different FORMAT of the same parcel is not a conflict. No
 * requested APN, or no resolved APN, means we cannot judge a conflict (null).
 */
export function detectApnConflict(
  requested: { apn?: string; apnAlternates?: string[] },
  resolved: Array<{ apn?: string; source: string; context?: string }>,
): ApnConflict | null {
  const reqRaw = [requested.apn, ...(requested.apnAlternates ?? [])]
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  const reqVariants = reqRaw.map(compactParcelId).filter((x) => x.length >= 4);
  if (reqVariants.length === 0) return null;
  const resolvedApns = resolved
    .map((r) => ({ compact: r.apn ? compactParcelId(r.apn) : '', apn: r.apn, source: r.source, context: r.context }))
    .filter((r) => r.compact.length >= 4);
  if (resolvedApns.length === 0) return null;
  // Any resolved APN matching a requested variant confirms the same parcel.
  if (resolvedApns.some((r) => reqVariants.includes(r.compact))) return null;
  const first = resolvedApns[0];
  return {
    requestedApn: reqRaw[0],
    resolvedApn: first.apn as string,
    source: first.source,
    resolvedContext: first.context,
  };
}

/** Compact a jurisdiction name for comparison: lowercase letters only, with a
 *  trailing "county" word dropped ("Washington County" ⇢ "washington"). */
function normCounty(s?: string): string {
  return (s ?? '').toLowerCase().replace(/\bcounty\b/g, '').replace(/[^a-z]/g, '');
}
const STATE_ABBR: Record<string, string> = {
  alabama: 'al', alaska: 'ak', arizona: 'az', arkansas: 'ar', california: 'ca', colorado: 'co', connecticut: 'ct',
  delaware: 'de', florida: 'fl', georgia: 'ga', hawaii: 'hi', idaho: 'id', illinois: 'il', indiana: 'in', iowa: 'ia',
  kansas: 'ks', kentucky: 'ky', louisiana: 'la', maine: 'me', maryland: 'md', massachusetts: 'ma', michigan: 'mi',
  minnesota: 'mn', mississippi: 'ms', missouri: 'mo', montana: 'mt', nebraska: 'ne', nevada: 'nv', newhampshire: 'nh',
  newjersey: 'nj', newmexico: 'nm', newyork: 'ny', northcarolina: 'nc', northdakota: 'nd', ohio: 'oh', oklahoma: 'ok',
  oregon: 'or', pennsylvania: 'pa', rhodeisland: 'ri', southcarolina: 'sc', southdakota: 'sd', tennessee: 'tn',
  texas: 'tx', utah: 'ut', vermont: 'vt', virginia: 'va', washington: 'wa', westvirginia: 'wv', wisconsin: 'wi', wyoming: 'wy',
};
function normState(s?: string): string {
  const t = (s ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!t) return '';
  return t.length === 2 ? t : (STATE_ABBR[t] ?? t);
}

/**
 * PURE: detect a CROSS-COUNTY APN COLLISION — the same parcel number resolving in
 * a DIFFERENT county than the operator requested. APNs are only unique within a
 * county, so "094-020.08" can exist in Scott AND Washington County TN; an unscoped
 * search can land on the wrong one. detectApnConflict passes it (the APN string
 * matches), so this second guard compares JURISDICTION. Fires ONLY when the
 * operator supplied a county AND a requested APN, and a parcel-level lane resolved
 * that SAME APN in a materially different county — a wrong-parcel hard-stop.
 * Conservative: no requested county, no requested APN, no resolved county, or a
 * matching county all return null (cannot / need not judge a conflict).
 */
export function detectJurisdictionConflict(
  requested: { county?: string; state?: string; apn?: string; apnAlternates?: string[] },
  resolved: Array<{ apn?: string; county?: string; state?: string; source: string; context?: string }>,
): ApnConflict | null {
  const reqCounty = normCounty(requested.county);
  if (!reqCounty) return null;
  const reqApnVariants = [requested.apn, ...(requested.apnAlternates ?? [])]
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map(compactParcelId)
    .filter((x) => x.length >= 4);
  if (reqApnVariants.length === 0) return null;
  for (const r of resolved) {
    const rc = normCounty(r.county);
    if (!rc || rc === reqCounty) continue;
    const rApn = r.apn ? compactParcelId(r.apn) : '';
    if (!rApn || !reqApnVariants.includes(rApn)) continue; // must be the SAME parcel number
    const reqState = normState(requested.state);
    const rs = normState(r.state);
    // State agreement is not required, but include it in the display when known.
    const reqJ = [requested.county && `${requested.county.replace(/\s*county$/i, '')} County`, requested.state].filter(Boolean).join(', ');
    const resJ = [r.county && `${r.county.replace(/\s*county$/i, '')} County`, r.state || (rs && reqState && rs !== reqState ? r.state : undefined)].filter(Boolean).join(', ');
    return {
      requestedApn: `${requested.apn ?? r.apn} in ${reqJ || 'the requested county'}`,
      resolvedApn: `${r.apn} in ${resJ || 'a different county'}`,
      source: r.source,
      resolvedContext: r.context,
    };
  }
  return null;
}

/** Recover a street/locality hint from raw intake when structured parsing dropped
 *  them (a house-number-less road resolves to county+state only). Pure; only fills
 *  what `fields` is missing, so a normal parsed address is never overridden. */
export function deriveLocalityHints(rawText: string | undefined, fields: ParsedIntakeFields): { address?: string; city?: string } {
  if (!rawText) return {};
  const firstLine = rawText.split(/\r?\n/)[0] ?? '';
  const segs = firstLine.split(',').map((s) => s.trim()).filter(Boolean);
  const countyC = normCounty(fields.county);
  const stateC = normState(fields.state);
  const ROAD = /\b(rd|road|st|street|ave|avenue|dr|drive|ln|lane|ct|court|hwy|highway|blvd|trl|trail|pkwy|cir|pl|place|way)\b/i;
  const leftover = segs.filter((s) => {
    if (/parcel|\bapn\b|\bid\b|\bacre/i.test(s)) return false;
    const sc = normCounty(s);
    if (countyC && sc === countyC) return false;            // the county segment
    if (stateC && normState(s) === stateC) return false;    // the state segment
    return true;
  });
  const roadLike = leftover.find((s) => ROAD.test(s));
  const locality = leftover.find((s) => s !== roadLike && !ROAD.test(s));
  return { address: fields.address ?? roadLike, city: fields.city ?? locality };
}

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
  /** HARD IDENTIFIER CONFLICT. Set ONLY when the operator supplied an APN and a
   *  parcel-level lane resolved a DIFFERENT parcel (its APN matches none of the
   *  requested variants). When present the resolution is forced to
   *  needs_clarification and identityEstablished is false — nothing downstream
   *  runs. This is the wrong-parcel hard-stop (e.g. requested ...0085, resolved
   *  ...0084). Undefined when there is no conflict. */
  identityConflict?: ApnConflict;
  /** Read-only: the engine resolves identity; it never writes a card itself. */
  executionMode: 'property_resolution';
  /** The full named-source verification result when a `verify` lane confirmed the
   *  parcel — captured so the caller can REUSE it (land facts, valuation,
   *  coordinates) instead of re-verifying the same parcel with a second provider
   *  call. Undefined when no named-source verification succeeded. */
  verifiedData?: DukeVerificationResult;
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
  // Capture the full verification result whenever a named source confirms the
  // parcel, so the caller can reuse its land facts instead of re-verifying.
  let verifiedData: DukeVerificationResult | undefined;
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
      if (v.parcelVerified) verifiedData = v;
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
              if (v2.parcelVerified) verifiedData = v2;
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
          if (va.parcelVerified) verifiedData = va;
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
  // When structured intake dropped the street/locality — a house-number-less road
  // like "Henson Lane, Oneida/Helenwood, Scott County, TN" parses to county+state
  // only — recover them from the raw text. Without a locality hint, an APN that
  // collides across counties (Henson Ln in Scott vs Green Ln in Washington, both
  // APN 094-020.08) has NO signal to disambiguate and the browser picks the first
  // match; the recovered road/locality lets candidate scoring choose the right one.
  const locality = deriveLocalityHints(input.rawText, fields);
  const searchKey: BrowserSearchKey = { address: fields.address ?? locality.address, apn: fields.apn, apnAlternates: fields.apnAlternates, owner: fields.owner, city: fields.city ?? locality.city, county: fields.county, state: fields.state, zip: fields.zip };
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

  // ── HARD APN CONFLICT (wrong-parcel hard-stop) ──────────────────────────
  // If the operator supplied an APN but a parcel-level lane resolved a DIFFERENT
  // parcel (Beaufort: requested ...0085, resolved ...0084 owner BUSH LISA), that
  // is not a match — it is the resolver landing on the wrong parcel. Do NOT
  // confirm, do NOT run downstream. Collect every resolved parcel-level APN and
  // compare against the requested variants.
  const resolvedApnCandidates: Array<{ apn?: string; county?: string; state?: string; source: string; context?: string }> = [];
  if (verifiedData?.identity?.apn) {
    const id = verifiedData.identity;
    const ctx = [id.owner, id.situsAddress].filter(Boolean).join(' — ') || undefined;
    resolvedApnCandidates.push({ apn: id.apn, county: id.county, state: id.state, source: verifiedData.verificationSource ?? 'a named parcel source', context: ctx });
  }
  for (const ev of browserEvidence) {
    if (ev.status !== 'retrieved' && ev.status !== 'partial') continue;
    const a = ev.patch?.apn as string | undefined;
    if (!a) continue;
    const owner = ev.patch?.owner as string | undefined;
    const addr = ev.patch?.address as string | undefined;
    const ctx = [owner, addr].filter(Boolean).join(' — ') || undefined;
    resolvedApnCandidates.push({ apn: a, county: ev.patch?.county as string | undefined, state: ev.patch?.state as string | undefined, source: browserServiceLabel(ev.service), context: ctx });
  }
  // Two-tier wrong-parcel hard-stop: (1) a DIFFERENT APN resolved, or (2) the SAME
  // APN resolved in a DIFFERENT county (a cross-county APN collision — APNs are
  // only unique within a county). Either is a wrong parcel; do not confirm.
  const identityConflict = (
    detectApnConflict({ apn: fields.apn, apnAlternates: fields.apnAlternates }, resolvedApnCandidates)
    ?? detectJurisdictionConflict({ apn: fields.apn, apnAlternates: fields.apnAlternates, county: fields.county, state: fields.state }, resolvedApnCandidates)
  ) ?? undefined;

  if (identityConflict) {
    const ctx = identityConflict.resolvedContext ? ` (${identityConflict.resolvedContext})` : '';
    const conflictMsg = `The resolved parcel does not match the requested parcel. You entered APN ${identityConflict.requestedApn}, but ${identityConflict.source} resolved a DIFFERENT parcel — APN ${identityConflict.resolvedApn}${ctx}. This is a hard identifier conflict: the parcel is NOT confirmed. No Property Intelligence, Land Score, valuation, offer range, strategy, or seller brief will run. Re-check the APN, or provide a corrected parcel identifier (APN + county) to resolve which parcel is the subject.`;
    return {
      status: 'needs_clarification',
      property,
      confidence: property.confidence,
      matchedReason: conflictMsg,
      guidance: conflictMsg,
      missing: property.missing,
      lanesAttempted: lanes,
      browserEvidence,
      missingFieldAnalysis,
      identityEstablished: false,
      identityBasis: conflictMsg,
      identityConflict,
      executionMode: 'property_resolution',
      verifiedData,
    };
  }

  const identity = parcelIdentityEstablished(property, browserEvidence);
  // A CONFIRMED parcel identity IS a match. The mandatory identity gate is
  // deliberately strict (a named source, a parcel-level browser page returning
  // APN + jurisdiction + a real parcel URL, or ≥2 corroborating parcel-level
  // sources). When it establishes, we must NOT fall through to needs_clarification
  // just because the numeric confidence sits below the match threshold — the
  // parcel is confirmed. Without this, a parcel the Browser Agent CONFIRMED on the
  // authenticated LandPortal parcel panel was returned as "unresolved" and its
  // verified owner / acres / parcel URL never reached the Deal Card.
  const matched = property.parcelVerified || identity.established || (property.confidence >= matchConfidence && hasSubject);

  if (matched) {
    return {
      status: 'matched',
      property,
      confidence: property.confidence,
      matchedReason: property.parcelVerified
        ? `Parcel identity verified by ${property.verificationSource ?? 'a named source'}.`
        : identity.established
          ? identity.basis
          : `Credible evidence from ${property.sources.length} source(s) resolves the intended property (confidence ${property.confidence.toFixed(2)}). Unknown fields become Confirm Before Offer.`,
      guidance: undefined,
      missing: property.missing,
      lanesAttempted: lanes,
      browserEvidence,
      missingFieldAnalysis,
      identityEstablished: identity.established,
      identityBasis: identity.basis,
      executionMode: 'property_resolution',
      verifiedData,
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
    verifiedData,
  };
}

/** Browser services that reach an actual PARCEL PAGE (not a search/directory).
 *  Both current services are parcel-level: LandPortal parcel page and official
 *  County Records (GIS/assessor/tax/recorder). A marketplace browser service
 *  (Zillow/Redfin/Realtor property page) would append here once wired. */
const PARCEL_LEVEL_BROWSER_SERVICES: readonly BrowserService['id'][] = ['landportal', 'county_records'];
function browserServiceLabel(id: BrowserService['id']): string {
  return id === 'landportal' ? 'LandPortal' : 'County Records';
}

/**
 * THE MANDATORY IDENTITY GATE. Decide whether the intended PARCEL has actually
 * been CONFIRMED — meaning we know WHICH exact parcel, not merely WHERE an address
 * is. Only when this returns `established: true` may downstream departments run.
 * Deterministic + explainable.
 *
 * Guiding principle: a geocoder proves LOCATION; a parcel-level source proves
 * IDENTITY. A geocoded street address is therefore a Candidate, never Confirmed.
 *
 * CONFIRMED when ANY of:
 *   1. A named parcel source verified the parcel (`parcelVerified`) — Realie/
 *      LandPortal resolve, official county assessor/tax/recorder.
 *   2. The Browser Agent reached the exact PARCEL PAGE on a parcel-level service
 *      (LandPortal or official County Records) and returned an APN + a
 *      jurisdiction (county/state/FIPS) + a real source URL — the parcel panel,
 *      not a search page. (Marketplace property pages qualify once wired.)
 *   3. ≥2 INDEPENDENT PARCEL-LEVEL sources resolve to the SAME parcel (agree on an
 *      identity-bearing value). Geocoders/search/directories never count here.
 *
 * Everything weaker (geocoded address, coordinates, county + road name, seller/
 * CRM data, an unverified APN, a single parcel-level source, browser search
 * without a parcel page) is a CANDIDATE — a strong hypothesis, not confirmed
 * identity.
 */
export function parcelIdentityEstablished(
  property: NormalizedProperty,
  browserEvidence: BrowserEvidence[] = [],
): { established: boolean; basis: string } {
  if (property.parcelVerified) {
    return { established: true, basis: `Parcel identity verified by ${property.verificationSource ?? 'a named parcel source'}.` };
  }
  const parcelPage = browserEvidence.find(
    (ev) => PARCEL_LEVEL_BROWSER_SERVICES.includes(ev.service) && ev.status === 'retrieved',
  );
  if (parcelPage) {
    const apn = (parcelPage.patch?.apn as string | undefined) ?? property.apn;
    const juris = (parcelPage.patch?.county as string | undefined) ?? property.county
      ?? (parcelPage.patch?.state as string | undefined) ?? property.state
      ?? (parcelPage.patch?.fips as string | undefined) ?? property.fips;
    const url = (parcelPage.sourceUrls ?? []).find((u) => /^https?:\/\//i.test(u));
    if (apn && juris && url) {
      return { established: true, basis: `Browser Agent reached the exact parcel page on ${browserServiceLabel(parcelPage.service)} (APN + jurisdiction confirmed from the parcel panel).` };
    }
  }
  const lanes = corroboratingParcelLevelLanes(property);
  if (lanes.length >= 2) {
    return { established: true, basis: `Parcel identity corroborated by ${lanes.length} independent parcel-level sources resolving to the same parcel (${lanes.join(', ')}).` };
  }
  // A geocoded street address / coordinates / a single parcel-level source is a
  // resolved LOCATION or a strong hypothesis — a Candidate, never a Confirmed
  // parcel. Downstream stays on hold until a parcel-level source confirms which
  // exact parcel this is.
  return {
    established: false,
    basis: lanes.length >= 1
      ? `Not yet confirmed — one parcel-level source (${lanes[0]}) points here, but a single source is a strong hypothesis, not confirmed identity. Confirm the exact parcel on a second parcel-level source (LandPortal/county GIS/assessor/tax/recorder or a marketplace property page), have the Browser Agent open the parcel page, or verify via a named source before downstream intelligence runs.`
      : 'Parcel not yet confirmed — only a geocoded location and/or operator-supplied identifiers support it. A geocoder proves where an address is, not which parcel it is. Confirm the exact parcel on a parcel-level source (LandPortal/county/assessor/tax/recorder or a marketplace property page) or via a named source before downstream intelligence runs.',
  };
}

/** Merge a patch and report whether it actually contributed a new field/evidence. */
function mergeAndReport(p: NormalizedProperty, lane: RetrievalLane, source: string, patch: PropertyPatch, ts: string, confidence: number, sourceUrl?: string): boolean {
  const before = p.evidence.length;
  mergeNormalized(p, lane, source, patch, { timestamp: ts, confidence, sourceUrl });
  return p.evidence.length > before;
}
