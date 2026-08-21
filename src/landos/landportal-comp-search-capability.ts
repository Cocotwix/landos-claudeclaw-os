// LandOS — LandPortal Comp Search Capability.
//
// Tool 3 of the LandPortal three-tool split: "Find the best available market
// comps for THIS subject." It uses LandPortal's NEW top-bar Map Search as the
// PRIMARY discovery flow — the old automatic LP-Estimate comp suggestions are
// no longer the search universe, and LandPortal's AI Comp Report is never a
// dependency. LandOS owns discovery, extraction, enrichment, classification
// and the rough valuation.
//
// Default source priority (operator-directed, 2026-08-20):
//   1. LandPortal new map search  = primary discovery (sold + active passes).
//   2. LandPortal candidate detail = primary enrichment: the strongest sold
//      candidates' own parcel pages (Property/MLS details, listing remarks),
//      plus the exact Redfin listing page a candidate exposes or came from.
//   3. Redfin = independent second discovery flow (broad sold-land search).
//   4. Zillow = independent second discovery/cross-check flow.
//   5. LandWatch = LARGE-ACREAGE FALLBACK only: 30+ acre subjects whose
//      primary sold evidence is still materially thin.
//   6. Realtor.com = broad fallback only, when everything above is thin.
// One underlying sale seen through several sources stays ONE comp with
// multiple source attributions.
//
// SOLD comps are the FMV evidence; ACTIVES are competition context only.
// Rough land value stays MEDIAN ACCEPTED SOLD $/ACRE × SUBJECT ACREAGE.
// Listing remarks are stored as LISTING-REPORTED evidence, never verified
// truth. Nothing here may change the canonical subject.

import type {
  CapabilityEvidenceReference,
  CapabilityExecutionEnvironment,
  CapabilityExecutionOutcome,
  CapabilityInvocationRequest,
  JsonObject,
  LandosCapability,
} from './capability-contract.js';
import {
  broadenLandPortalMapSearch,
  candidateParcelUrl,
  candidatesFromListRows,
  classifyMapSearchCandidates,
  emptySourceDiagnostics,
  landPortalCompSearchValuation,
  planLandPortalMapSearch,
  IMPROVED_BUILDING_SQFT_FLOOR,
  type ClassifiedLandPortalComp,
  type CompSourceDiagnostics,
  type LandPortalCompSearchValuation,
  type LandPortalMapSearchCandidate,
  type LandPortalMapSearchPlan,
  type LandPortalMapSearchRow,
} from './landportal-map-search.js';
import { apnIdentifiersEquivalent } from './landportal-capability.js';
import { nextSoldSearchWindow, RECENT_SALE_WINDOW_MONTHS, type SoldSearchWindowMonths } from './comp-sale-recency.js';
import {
  assertNoCallerAssertions,
  resolveLandPortalToolSubject,
  subjectCanonicalParcelUrl,
  type LandPortalToolSubjectRuntime,
} from './landportal-tool-subject.js';
import type { LandPortalRecordRead } from './landportal-property-characteristics-capability.js';
import { upsertNormalizedComp, type AddCompInput } from './comps.js';
import type { LandosEntity } from './db.js';

export const LANDPORTAL_COMP_SEARCH_CAPABILITY_ID = 'landportal-comp-search';

const DEFAULT_SEARCH_TIMEOUT_MS = 180_000;
const DEFAULT_ENRICH_TIMEOUT_MS = 60_000;
/** Hard budget for each secondary discovery lane (Zillow, Realtor fallback):
 *  a hung disposable-browser fetch must never stall the whole comp search. */
const SECONDARY_LANE_BUDGET_MS = 240_000;

async function boundedLane(run: () => Promise<SecondarySearchResult>, label: string): Promise<SecondarySearchResult> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      run(),
      new Promise<SecondarySearchResult>((resolve) => {
        timer = setTimeout(() => resolve({
          status: 'error', comps: [],
          note: `${label} exceeded its ${Math.round(SECONDARY_LANE_BUDGET_MS / 1000)}s budget and was released; treat as a lane failure, not market absence.`,
        }), SECONDARY_LANE_BUDGET_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
/** Bounded candidate-detail enrichment: the strongest sold candidates only
 *  (operator guidance: roughly the strongest 5–8; never deep research). */
export const ENRICHMENT_CANDIDATE_CAP = 8;

/** LandWatch runs only for subjects at or above this acreage AND only when
 *  the primary sold evidence is still materially thin. */
export const LANDWATCH_FALLBACK_MIN_ACRES = 30;

/** Sold evidence that actually supports a vacant-land FMV: accepted rows that
 *  are not improved sales. Improved directional rows stay visible evidence but
 *  never make a thin sold set look sufficient. */
export function usableSoldEvidenceCount(classified: ClassifiedLandPortalComp[]): number {
  return classified.filter((row) => row.tier !== 'excluded' && !row.improved).length;
}

/** The LandWatch gate, exported so fixtures can prove activation behavior
 *  without a browser: 30+ acre subject AND thin primary sold evidence.
 *  Evidence is thin when the accepted vacant sold set is small OR there are
 *  not enough CORE sales to state a defensible median at all — a set that
 *  cannot state a land value is low-confidence however many directional
 *  rows surround it. */
export function shouldRunLandWatchFallback(subjectAcres: number | null, classified: ClassifiedLandPortalComp[]): boolean {
  if (subjectAcres == null || subjectAcres < LANDWATCH_FALLBACK_MIN_ACRES) return false;
  const coreCount = classified.filter((row) => row.tier === 'core').length;
  return coreCount < 2 || usableSoldEvidenceCount(classified) < 3;
}

export interface LandPortalMapSearchRun {
  authenticated: boolean;
  panelApn: string | null;
  applied: boolean;
  pills: string;
  zoomStepsUsed: number;
  noPropertiesFound: boolean | null;
  resultCount: number | null;
  rows: LandPortalMapSearchRow[];
  mapShotPath: string | null;
  listShotPath: string | null;
  dismissedOverlays: number;
  capturedAtIso: string;
}

/** Independent second-flow rows (Zillow) and fallback rows (Realtor),
 *  structurally minimal so the route layer adapts the real fetchers. */
export interface SecondarySoldComp {
  address: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  price: number | null;
  acres: number | null;
  status: 'sold' | 'for_sale' | 'unknown';
  url: string | null;
  soldDate?: string | null;
  lat?: number | null;
  lng?: number | null;
  homeSizeSqft?: number | null;
  /** True when the source card showed positive bed/bath counts (improvement
   *  signal) without exposing building square footage. */
  improvedHint?: boolean;
  /** LISTING-REPORTED card description (never verified fact). */
  remark?: string | null;
}

export interface SecondarySearchResult {
  status: 'retrieved' | 'blocked' | 'none' | 'error' | 'disabled';
  comps: SecondarySoldComp[];
  note: string;
}

/** One listing page's readily available story (Redfin detail read). */
export interface SecondaryListingDetail {
  status: 'retrieved' | 'blocked' | 'error' | 'disabled';
  remarks: string | null;
  yearBuilt: number | null;
  buildingSqft: number | null;
  lotAcres: number | null;
  propertyType: string | null;
  utilityStatements: string[];
  priorEvents: Array<{ date: string | null; event: string; price: number | null }>;
  note: string;
}

export interface LandPortalCompSearchRuntime extends LandPortalToolSubjectRuntime {
  runMapSearch?: (url: string, plan: LandPortalMapSearchPlan, opts: { timeoutMs: number }) => Promise<LandPortalMapSearchRun>;
  /** Candidate-detail enrichment: the comp's OWN parcel page incl MLS block. */
  readCompRecord?: (url: string, opts: { timeoutMs: number; includeMls?: boolean }) => Promise<LandPortalRecordRead>;
  /** Independent Zillow sold-land flow (route wires fetchZillowLandComps).
   *  `dateWindowMonths` is the sold period to ask the source for: 12 on the
   *  first pass, 24 only on a deliberate insufficiency expansion. */
  zillowSearch?: (mode: 'sold' | 'active', dateWindowMonths?: SoldSearchWindowMonths) => Promise<SecondarySearchResult>;
  /** Independent Redfin sold-land flow (route wires fetchRedfinLandComps). */
  redfinSearch?: (mode: 'sold' | 'active', dateWindowMonths?: SoldSearchWindowMonths) => Promise<SecondarySearchResult>;
  /** Exact Redfin listing-page read for comp enrichment. */
  redfinDetail?: (url: string, opts: { timeoutMs: number }) => Promise<SecondaryListingDetail>;
  /** LandWatch large-acreage fallback — 30+ acre subjects, thin evidence only. */
  landwatchSearch?: () => Promise<SecondarySearchResult>;
  /** Realtor.com fallback flow — invoked only when evidence is thin. */
  realtorSearch?: () => Promise<SecondarySearchResult>;
  /** Persistence override for tests. */
  persistComp?: (input: AddCompInput) => void;
  searchTimeoutMs?: number;
  enrichTimeoutMs?: number;
}

export interface EnrichedCandidateDetail {
  parcelUrl: string | null;
  redfinUrl: string | null;
  mlsDescription: string | null;
  listingStatus: string | null;
  mlsId: string | null;
  daysOnMarket: number | null;
  lastSoldDate: string | null;
  parcelAcres: number | null;
  mlsLotAcres: number | null;
  buildingSqft: number | null;
  acreageDivergence: string | null;
  usefulFacts: Record<string, string>;
}

export type LandPortalCompSearchFacts = JsonObject & {
  executed: boolean;
  outcome: 'comps_collected' | 'auth_needed' | 'subject_mismatch' | 'not_available';
  parcelUrl: string | null;
  soldCandidateCount: number;
  activeCandidateCount: number;
  broadened: boolean;
  classified: Array<{
    source: string;
    address: string | null;
    apn: string | null;
    price: number | null;
    acres: number | null;
    pricePerAcre: number | null;
    saleDate: string | null;
    distanceMiles: number | null;
    tier: 'core' | 'directional' | 'excluded';
    improved: boolean;
    reason: string;
    redfinUrl: string | null;
    listingReported: string | null;
    sources: string[];
  }>;
  actives: Array<{ address: string | null; price: number | null; acres: number | null; pricePerAcre: number | null }>;
  valuation: LandPortalCompSearchValuation;
  diagnostics: CompSourceDiagnostics[];
  readiness: { grade: 'green' | 'yellow' | 'red'; reason: string };
  persistedComps: number;
  mapShots: string[];
  summary: string;
};

const normalizedAddress = (value: string | null | undefined): string =>
  (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Street-line identity: house number (a leading "0" is a no-number land
 *  listing, not a number), street tokens, trailing ZIP when present. Sources
 *  format the same sale differently ("BRUSH CREEK RD" vs "0 Brush Creek Rd,
 *  Fairview, TN 37062"), so whole-string equality misses real duplicates. */
function parsedAddress(value: string | null | undefined): { num: string | null; street: string; zip: string | null } | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  const zip = text.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1] ?? null;
  const streetLine = text.split(',')[0].toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const withNumber = streetLine.match(/^(\d+)\s+(.+)$/);
  let num = withNumber ? withNumber[1] : null;
  const street = withNumber ? withNumber[2] : streetLine;
  if (num === '0') num = null;
  return street ? { num, street, zip } : null;
}

/** One underlying sale across sources: match on address, street-line identity,
 *  near-identical coordinates, or the same price on the same sale month. */
export function sameUnderlyingSale(
  a: { address: string | null; lat?: number | null; lng?: number | null; price: number | null; saleDate?: string | null },
  b: { address: string | null; lat?: number | null; lng?: number | null; price: number | null; saleDate?: string | null },
): boolean {
  const addressA = normalizedAddress(a.address);
  const addressB = normalizedAddress(b.address);
  if (addressA && addressB && addressA === addressB) return true;
  const parsedA = parsedAddress(a.address);
  const parsedB = parsedAddress(b.address);
  if (parsedA && parsedB && parsedA.street === parsedB.street
    && (!parsedA.zip || !parsedB.zip || parsedA.zip === parsedB.zip)) {
    // Same numbered street address = same property. Two no-number listings on
    // the same road are only the same sale when the price agrees too.
    if (parsedA.num && parsedB.num && parsedA.num === parsedB.num) return true;
    if ((!parsedA.num || !parsedB.num) && a.price != null && b.price != null && a.price === b.price) return true;
  }
  if (a.lat != null && a.lng != null && b.lat != null && b.lng != null) {
    if (Math.abs(a.lat - b.lat) < 0.0025 && Math.abs(a.lng - b.lng) < 0.0025) return true;
  }
  if (a.price != null && b.price != null && a.price === b.price && a.saleDate && b.saleDate
    && a.saleDate.slice(0, 7) === b.saleDate.slice(0, 7)) return true;
  return false;
}

function secondaryToCandidate(row: SecondarySoldComp, source: 'zillow' | 'redfin' | 'landwatch' | 'realtor'): LandPortalMapSearchCandidate {
  return {
    source,
    propertyId: null,
    fips: null,
    apn: null,
    mlsUuid: null,
    mlsUrl: row.url,
    address: row.address,
    city: row.city ?? null,
    state: row.state ?? null,
    zip: row.zip ?? null,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    price: row.price,
    status: row.status,
    mlsAcres: row.acres,
    lotSqft: null,
    buildingSqft: row.homeSizeSqft ?? null,
    baths: null,
    saleDate: row.soldDate ?? null,
    soldBy: null,
    pricePerAcre: row.price != null && row.acres != null && row.acres > 0
      ? Math.round((row.price / row.acres) * 100) / 100
      : null,
    rawText: `${row.address ?? ''} ${row.price ?? ''} ${row.acres ?? ''} ac (${source})`.trim(),
    improvedHint: row.improvedHint ?? undefined,
    remark: row.remark ?? null,
  };
}

/** Extract the notable, decision-relevant claims a candidate's own record and
 *  listing remarks expose, preserving their LISTING-REPORTED evidence status.
 *  This is what lets the comp table compare property stories, not just
 *  acreage and price. */
export function compStoryHighlights(
  detail: EnrichedCandidateDetail | undefined,
  candidate: LandPortalMapSearchCandidate,
): string | null {
  const notable: string[] = [];
  const facts = detail?.usefulFacts ?? {};
  for (const key of [
    'Road Frontage', 'Land Locked', 'Water Feature', 'Zoning Code', 'Subdivision', 'FEMA Flood Zone',
    'Slope Avg', 'Buildability total (%)', 'Year Built',
    'Utility statements (LISTING-REPORTED)', 'Prior sale/listing history (Redfin)',
    'Last Sale Price', 'Last Sale Date',
  ]) {
    if (facts[key]) notable.push(`${key}: ${facts[key]}`);
  }
  const remark = detail?.mlsDescription ?? candidate.remark ?? null;
  if (remark) {
    const claims = remark.match(
      /[^.!\n]{0,70}\b(public sewer|city sewer|sewer available|septic|city water|public water|well|perc(?:olation)?\s*test\w*|\d{2,4}\s*(?:ft|feet)[^.!\n]{0,20}frontage|road frontage|mostly level|level|rolling|gentl\w+|steep|wooded|cleared|pasture|creek|stream|pond|flood\w*|wetland\w*|develop\w*|subdivi\w*|entitle\w*|approved for [^.!\n]{0,40}|zoned [^.!\n]{0,30}|utilities|electric\w*|natural gas)\b[^.!\n]{0,60}/gi,
    );
    if (claims?.length) {
      notable.push(`LISTING-REPORTED: ${[...new Set(claims.map((claim) => claim.replace(/\s+/g, ' ').trim()))].slice(0, 5).join('; ')}`);
    }
  }
  return notable.length ? `Comp context — ${notable.slice(0, 6).join(' | ')}.` : null;
}

/** Fold an exact Redfin listing-page read into a candidate's enrichment
 *  detail, never overwriting what the LandPortal record already proved. */
function mergeRedfinDetail(
  base: EnrichedCandidateDetail | null,
  url: string,
  read: SecondaryListingDetail,
): EnrichedCandidateDetail {
  const detail: EnrichedCandidateDetail = base ?? {
    parcelUrl: null, redfinUrl: url, mlsDescription: null, listingStatus: null, mlsId: null,
    daysOnMarket: null, lastSoldDate: null, parcelAcres: null, mlsLotAcres: null, buildingSqft: null,
    acreageDivergence: null, usefulFacts: {},
  };
  detail.redfinUrl = detail.redfinUrl ?? url;
  if (!detail.mlsDescription && read.remarks) detail.mlsDescription = read.remarks;
  if (detail.buildingSqft == null && read.buildingSqft != null) detail.buildingSqft = read.buildingSqft;
  if (detail.mlsLotAcres == null && read.lotAcres != null) detail.mlsLotAcres = read.lotAcres;
  if (read.yearBuilt != null && !detail.usefulFacts['Year Built']) detail.usefulFacts['Year Built'] = String(read.yearBuilt);
  if (read.propertyType && !detail.usefulFacts['Redfin Property Type']) detail.usefulFacts['Redfin Property Type'] = read.propertyType;
  if (read.utilityStatements.length && !detail.usefulFacts['Utility statements (LISTING-REPORTED)']) {
    detail.usefulFacts['Utility statements (LISTING-REPORTED)'] = read.utilityStatements.join('; ');
  }
  if (read.priorEvents.length && !detail.usefulFacts['Prior sale/listing history (Redfin)']) {
    detail.usefulFacts['Prior sale/listing history (Redfin)'] = read.priorEvents
      .map((event) => [event.date, event.event, event.price != null ? `$${event.price.toLocaleString()}` : null].filter(Boolean).join(' '))
      .join(' | ');
  }
  return detail;
}

const numFromField = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)?.[0] ?? Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Project the useful listing/property story off a candidate's own record. */
export function detailFromRecord(read: LandPortalRecordRead, parcelUrl: string | null): EnrichedCandidateDetail {
  const merged = { ...read.fields, ...read.mlsFields };
  const parcelAcres = numFromField(merged['Acres']);
  const mlsLotAcres = numFromField(merged['Lot Size Acres'] ?? merged['MLS Acres']);
  const usefulFacts: Record<string, string> = {};
  for (const key of [
    'Road Frontage', 'Land Locked', 'Water Feature', 'Water Feature type(s)', 'Zoning Code',
    'Parcel Use Description', 'Subdivision', 'FEMA Flood Zone', 'Wetlands Coverage (%)',
    'Buildability total (%)', 'Slope Avg', 'Last Sale Price', 'Last Sale Date',
    'Listing Status', 'Listing Price', 'MLS Property Type', 'Agent Name', 'Broker Name',
  ]) {
    if (merged[key]) usefulFacts[key] = merged[key];
  }
  return {
    parcelUrl,
    redfinUrl: read.redfinUrl,
    mlsDescription: merged['MLS Description'] ?? null,
    listingStatus: merged['Listing Status'] ?? null,
    mlsId: merged['MLS ID'] ?? null,
    daysOnMarket: numFromField(merged['Days on Market']),
    lastSoldDate: merged['Last Sold Date'] ?? null,
    parcelAcres,
    mlsLotAcres,
    buildingSqft: numFromField(merged['Building SqFt']),
    acreageDivergence: parcelAcres != null && mlsLotAcres != null && parcelAcres > 0
      && (mlsLotAcres / parcelAcres > 2 || parcelAcres / mlsLotAcres > 2)
      ? `LISTING-REPORTED ${mlsLotAcres} ac vs deeded parcel ${parcelAcres} ac — the sale likely covered more than this parcel; acreage kept as listing-reported evidence.`
      : null,
    usefulFacts,
  };
}

export const LANDPORTAL_COMP_SEARCH_CAPABILITY: LandosCapability<
  LandPortalCompSearchFacts,
  LandPortalCompSearchRuntime
> = {
  metadata: {
    id: LANDPORTAL_COMP_SEARCH_CAPABILITY_ID,
    name: 'LandPortal Comp Search',
    contractVersion: '1.0',
    description: 'Finds market comps for the canonical subject through LandPortal\'s new top-bar Map Search (sold + active land passes, subject-relative acreage band), enriches the strongest sold candidates from their own parcel/MLS pages with exact Redfin links, cross-checks with an independent Zillow flow (Realtor.com as fallback), classifies Core/Directional/Excluded, and computes the median-sold-$/acre land value indication. No LandPortal AI Comp Report dependency.',
  },
  validate(request: CapabilityInvocationRequest): void {
    const allowed = new Set(['timeoutMs', 'lane']);
    const unsupported = Object.keys(request.parameters ?? {}).filter((key) => !allowed.has(key));
    if (unsupported.length) {
      throw new Error(`LandPortal Comp Search does not accept caller-supplied ${unsupported.join(', ')}`);
    }
    const lane = request.parameters?.lane;
    if (lane != null && !['land', 'mobile'].includes(String(lane))) {
      throw new Error(`unknown LandPortal Comp Search lane ${String(lane)}`);
    }
    assertNoCallerAssertions(request.context as Record<string, unknown> | undefined, 'LandPortal Comp Search');
  },
  async execute(
    request: CapabilityInvocationRequest,
    runtime: LandPortalCompSearchRuntime,
    _environment: CapabilityExecutionEnvironment,
  ): Promise<CapabilityExecutionOutcome<LandPortalCompSearchFacts>> {
    const resolved = await resolveLandPortalToolSubject(request, runtime);
    const { subject, canonicalSubject, warnings } = resolved;
    let { subjectResolution } = resolved;
    const evidence: CapabilityEvidenceReference[] = [...resolved.resolutionEvidence];
    const lane = String(request.parameters?.lane ?? 'land') === 'mobile' ? 'mobile' : 'land';
    const diagnostics: CompSourceDiagnostics[] = [];
    const lpDiag = emptySourceDiagnostics('landportal');
    const zillowDiag = emptySourceDiagnostics('zillow');
    const redfinDiag = emptySourceDiagnostics('redfin');
    const landwatchDiag = emptySourceDiagnostics('landwatch');
    const realtorDiag = emptySourceDiagnostics('realtor');
    diagnostics.push(lpDiag, zillowDiag, redfinDiag, landwatchDiag, realtorDiag);

    const emptyFacts = (outcome: LandPortalCompSearchFacts['outcome'], summary: string): LandPortalCompSearchFacts => ({
      executed: false,
      outcome,
      parcelUrl: null,
      soldCandidateCount: 0,
      activeCandidateCount: 0,
      broadened: false,
      classified: [],
      actives: [],
      valuation: landPortalCompSearchValuation(subject.acres, []),
      diagnostics,
      readiness: { grade: 'red', reason: summary },
      persistedComps: 0,
      mapShots: [],
      summary,
    });

    if (subjectResolution !== 'RESOLVED') {
      return {
        status: 'NEEDS_INPUT', subjectResolution, canonicalSubject,
        facts: emptyFacts('not_available', 'Comp Search did not run: no released canonical parcel for this input.'),
        evidence, warnings,
        missingInformation: resolved.missingInformation.length ? resolved.missingInformation : ['One canonical parcel from Property Resolution'],
      };
    }
    const parcelUrl = subjectCanonicalParcelUrl(subject);
    if (!parcelUrl || !runtime.runMapSearch) {
      return {
        status: 'NEEDS_INPUT', subjectResolution, canonicalSubject,
        facts: emptyFacts('not_available', !parcelUrl
          ? 'No canonical LandPortal parcel URL exists for this subject.'
          : 'The LandPortal map-search engine is not available in this environment.'),
        evidence, warnings,
        missingInformation: [!parcelUrl ? 'A retained LandPortal parcel identity for this subject' : 'An authenticated LandPortal browser session'],
      };
    }

    const searchTimeoutMs = runtime.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
    const enrichTimeoutMs = runtime.enrichTimeoutMs ?? DEFAULT_ENRICH_TIMEOUT_MS;
    const mapShots: string[] = [];

    // ── 1. PRIMARY DISCOVERY: LandPortal new top-bar map search, SOLD ────────
    let soldPlan = planLandPortalMapSearch(subject.acres, lane === 'mobile' ? 'sold_mobile' : 'sold_land');
    lpDiag.searchAttempted = true;
    lpDiag.notes.push(`Sold pass: ${soldPlan.description}.`);
    let soldRun = await runtime.runMapSearch(parcelUrl, soldPlan, { timeoutMs: searchTimeoutMs });
    if (!soldRun.authenticated) {
      lpDiag.notes.push('The authenticated LandPortal workspace was unavailable.');
      return {
        status: 'NEEDS_INPUT', subjectResolution, canonicalSubject,
        facts: { ...emptyFacts('auth_needed', 'LandPortal authentication or the subject workspace was unavailable; no comp search ran.'), executed: true, parcelUrl },
        evidence, warnings: [...warnings, 'LandPortal authentication was unavailable for the comp search.'],
        missingInformation: ['An authenticated LandPortal map workspace for this subject'],
      };
    }
    // Subject identity gate before any result is trusted.
    if (subject.apn && soldRun.panelApn && !apnIdentifiersEquivalent(subject.apn, soldRun.panelApn)) {
      subjectResolution = 'AMBIGUOUS';
      return {
        status: 'NEEDS_INPUT', subjectResolution, canonicalSubject,
        facts: { ...emptyFacts('subject_mismatch', `LandPortal rendered APN ${soldRun.panelApn} where the canonical subject is APN ${subject.apn}; no comps were adopted.`), executed: true, parcelUrl },
        evidence, warnings: [...warnings, `LandPortal panel APN ${soldRun.panelApn} conflicts with canonical APN ${subject.apn}.`],
        missingInformation: ['A LandPortal workspace matching this subject\'s canonical APN'],
      };
    }
    lpDiag.searchVerified = soldRun.applied && (soldRun.noPropertiesFound === false || (soldRun.resultCount ?? 0) >= 0);
    if (soldRun.mapShotPath) mapShots.push(soldRun.mapShotPath);
    if (soldRun.listShotPath) mapShots.push(soldRun.listShotPath);
    let soldCandidates = candidatesFromListRows(soldRun.rows, subject.apn).filter((row) => row.status !== 'for_sale');

    // Bounded broadening: sold evidence too thin AND search verified → one
    // wider pass (min one rung down, no max, 2-year window). Never loops.
    let broadened = false;
    if (soldCandidates.length < 2 && soldRun.applied) {
      const wider = broadenLandPortalMapSearch(soldPlan);
      if (wider) {
        broadened = true;
        lpDiag.notes.push(`Sold evidence thin (${soldCandidates.length}); one bounded broadening pass: ${wider.description}.`);
        soldPlan = wider;
        soldRun = await runtime.runMapSearch(parcelUrl, wider, { timeoutMs: searchTimeoutMs });
        if (soldRun.mapShotPath) mapShots.push(soldRun.mapShotPath);
        if (soldRun.listShotPath) mapShots.push(soldRun.listShotPath);
        const widerCandidates = candidatesFromListRows(soldRun.rows, subject.apn).filter((row) => row.status !== 'for_sale');
        const seen = new Set(soldCandidates.map((row) => row.propertyId ?? row.apn ?? row.rawText));
        for (const row of widerCandidates) {
          const key = row.propertyId ?? row.apn ?? row.rawText;
          if (!seen.has(key)) { seen.add(key); soldCandidates.push(row); }
        }
      }
    }
    lpDiag.candidatesDiscovered = soldCandidates.length;

    // ── 2. ACTIVE PASS: current competition regardless of DOM ────────────────
    const activePlan = planLandPortalMapSearch(subject.acres, lane === 'mobile' ? 'active_mobile' : 'active_land');
    lpDiag.notes.push(`Active pass: ${activePlan.description}.`);
    const activeRun = await runtime.runMapSearch(parcelUrl, activePlan, { timeoutMs: searchTimeoutMs });
    if (activeRun.mapShotPath) mapShots.push(activeRun.mapShotPath);
    if (activeRun.listShotPath) mapShots.push(activeRun.listShotPath);
    const activeCandidates = candidatesFromListRows(activeRun.rows, subject.apn)
      .filter((row) => row.status !== 'sold');

    const subjectInput = { subjectAcres: subject.acres, subjectApn: subject.apn, subjectLat: subject.lat, subjectLng: subject.lng };

    // ── 3. INDEPENDENT SECOND FLOWS: Zillow + Redfin sold land ───────────────
    const runSecondary = async (
      diag: CompSourceDiagnostics,
      label: string,
      source: 'zillow' | 'redfin' | 'landwatch' | 'realtor',
      run: () => Promise<SecondarySearchResult>,
    ): Promise<LandPortalMapSearchCandidate[]> => {
      diag.searchAttempted = true;
      try {
        const result = await boundedLane(run, `The ${label} flow`);
        diag.searchVerified = result.status === 'retrieved' || result.status === 'none';
        diag.notes.push(result.note);
        const soldRows = result.comps.filter((row) => row.status === 'sold');
        const contextRows = result.comps.length - soldRows.length;
        if (contextRows > 0) {
          diag.notes.push(`${contextRows} non-sold ${label} row(s) retained as market context only; a listing that does not state a closed sale never enters the FMV comp set.`);
        }
        const candidates = soldRows.map((row) => secondaryToCandidate(row, source));
        diag.candidatesDiscovered = candidates.length;
        return candidates;
      } catch (error) {
        diag.notes.push(`${label} flow failed: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }
    };

    // Cross-source dedupe: one underlying sale stays ONE comp, and the
    // duplicate's improvement/remark/date evidence merges onto the survivor.
    const mergedSold: LandPortalMapSearchCandidate[] = [...soldCandidates];
    const crossSourceMatches = new Map<LandPortalMapSearchCandidate, Array<{ provider: string; url: string | null }>>();
    const absorb = (rows: LandPortalMapSearchCandidate[], diag: CompSourceDiagnostics): LandPortalMapSearchCandidate[] => {
      const fresh: LandPortalMapSearchCandidate[] = [];
      for (const row of rows) {
        const match = mergedSold.find((prior) => sameUnderlyingSale(prior, row));
        if (match) {
          const urls = crossSourceMatches.get(match) ?? [];
          urls.push({ provider: row.source, url: row.mlsUrl });
          crossSourceMatches.set(match, urls);
          diag.deduped += 1;
          if (row.improvedHint && !match.improvedHint) match.improvedHint = true;
          if (row.buildingSqft != null && match.buildingSqft == null) match.buildingSqft = row.buildingSqft;
          if (row.remark && !match.remark) match.remark = row.remark;
          if (row.saleDate && !match.saleDate) match.saleDate = row.saleDate;
        } else {
          mergedSold.push(row);
          fresh.push(row);
        }
      }
      return fresh;
    };

    // ── 3b. Independent secondary sold-land flows — 12 MONTHS FIRST ─────────
    //
    // Every source that can express a sold period is asked for the trailing
    // twelve months on the FIRST pass. The 13-to-24-month pass is a deliberate
    // response to a measured deficiency in that recent set, never the default:
    // asking for two years up front is how 2013, 2020 and 2022 sales entered
    // the candidate workflow and consumed enrichment effort before anything
    // knew how old they were. No pass carries a price bound of any kind.
    lpDiag.notes.push(nextSoldSearchWindow(null, 0).reason);
    if (runtime.zillowSearch) {
      absorb(await runSecondary(zillowDiag, 'Zillow sold-land (0–12 months)', 'zillow', () => runtime.zillowSearch!('sold', RECENT_SALE_WINDOW_MONTHS)), zillowDiag);
    } else {
      zillowDiag.notes.push('No Zillow flow was available in this environment.');
    }
    if (runtime.redfinSearch) {
      absorb(await runSecondary(redfinDiag, 'Redfin sold-land (0–12 months)', 'redfin', () => runtime.redfinSearch!('sold', RECENT_SALE_WINDOW_MONTHS)), redfinDiag);
    } else {
      redfinDiag.notes.push('No independent Redfin search flow was available in this environment; exact Redfin links from candidate pages are still recorded.');
    }

    // Sufficiency is measured on the SAME usable-sold-evidence rule the rest of
    // the lane uses, so collection and valuation cannot disagree about what
    // "enough recent evidence" means.
    const recentUsable = usableSoldEvidenceCount(classifyMapSearchCandidates(subjectInput, mergedSold));
    const expansion = nextSoldSearchWindow(RECENT_SALE_WINDOW_MONTHS, recentUsable);
    lpDiag.notes.push(expansion.reason);
    const expandedWindow = expansion.nextWindowMonths;
    if (expandedWindow != null) {
      if (runtime.zillowSearch) {
        absorb(await runSecondary(zillowDiag, 'Zillow sold-land (13–24 month expansion)', 'zillow', () => runtime.zillowSearch!('sold', expandedWindow)), zillowDiag);
      }
      if (runtime.redfinSearch) {
        absorb(await runSecondary(redfinDiag, 'Redfin sold-land (13–24 month expansion)', 'redfin', () => runtime.redfinSearch!('sold', expandedWindow)), redfinDiag);
      }
    }

    // ── 4. Classification over the merged sold universe ──────────────────────
    let classified: ClassifiedLandPortalComp[] = classifyMapSearchCandidates(subjectInput, mergedSold);

    // ── 5. BOUNDED ENRICHMENT: strongest sold candidates' own pages ──────────
    // LandPortal candidate detail first (Property/MLS block), then the exact
    // Redfin listing page the record exposes — or the candidate's own Redfin
    // page when Redfin discovered it. Never deep research; capped.
    const details = new Map<LandPortalMapSearchCandidate, EnrichedCandidateDetail>();
    if (runtime.readCompRecord || runtime.redfinDetail) {
      const strongest = [...classified]
        .filter((row) => row.tier !== 'excluded')
        .sort((a, b) => (a.tier === b.tier ? (b.candidate.saleDate ?? '').localeCompare(a.candidate.saleDate ?? '') : a.tier === 'core' ? -1 : 1))
        .slice(0, ENRICHMENT_CANDIDATE_CAP);
      for (const row of strongest) {
        let detail: EnrichedCandidateDetail | null = null;
        const compUrl = candidateParcelUrl(row.candidate);
        if (compUrl && runtime.readCompRecord) {
          try {
            const read = await runtime.readCompRecord(compUrl, { timeoutMs: enrichTimeoutMs, includeMls: true });
            if (read.panelReady) {
              lpDiag.detailPagesInspected += 1;
              detail = detailFromRecord(read, compUrl);
            }
          } catch { /* one unreachable candidate page never fails the search */ }
        }
        const redfinTarget = detail?.redfinUrl
          ?? (row.candidate.source === 'redfin' ? row.candidate.mlsUrl : null);
        if (redfinTarget && runtime.redfinDetail) {
          try {
            const redfinRead = await runtime.redfinDetail(redfinTarget, { timeoutMs: enrichTimeoutMs });
            redfinDiag.detailPagesInspected += 1;
            redfinDiag.notes.push(`Exact Redfin listing page for ${row.candidate.address ?? row.candidate.apn ?? 'candidate'}: ${redfinRead.note}`);
            if (redfinRead.status === 'retrieved') detail = mergeRedfinDetail(detail, redfinTarget, redfinRead);
          } catch { /* bounded enrichment never fails the search */ }
        } else if (detail?.redfinUrl && !runtime.redfinSearch) {
          // No independent Redfin flow in this environment: the exact link is
          // still real Redfin evidence and stays visible in the diagnostics.
          redfinDiag.searchAttempted = true;
          redfinDiag.searchVerified = true;
          redfinDiag.candidatesDiscovered += 1;
          redfinDiag.notes.push(`Exact Redfin link for ${row.candidate.address ?? row.candidate.apn ?? 'candidate'}: followed from the LandPortal listing block.`);
        }
        if (detail) details.set(row.candidate, detail);
      }
    }

    // Detail-driven correction: a candidate whose own record proves a material
    // structure becomes a Directional — improved sale, whatever its card said.
    // It stays VISIBLE evidence; it just can never enter the vacant-land median.
    classified = classified.map((row) => {
      const detail = details.get(row.candidate);
      if (!detail) return row;
      if (!row.improved && row.tier !== 'excluded' && detail.buildingSqft != null && detail.buildingSqft >= IMPROVED_BUILDING_SQFT_FLOOR) {
        return {
          ...row,
          tier: 'directional' as const,
          improved: true,
          reason: `Directional — improved sale: the candidate's own record shows a ${detail.buildingSqft.toLocaleString()} SqFt structure, so the full sale price never enters the clean vacant-land median; the large-acreage sale itself remains visible market evidence.`,
        };
      }
      return row;
    });
    // Comparability rationale: fold each enriched candidate's property story
    // (frontage, utilities, terrain, prior sales, LISTING-REPORTED claims)
    // into its classification reason so the comp table compares actual
    // property characteristics, not just acreage and price.
    classified = classified.map((row) => {
      const highlights = compStoryHighlights(details.get(row.candidate), row.candidate);
      return highlights ? { ...row, reason: `${row.reason} ${highlights}` } : row;
    });

    // ── 6a. LARGE-ACREAGE FALLBACK: LandWatch, 30+ acre thin-evidence only ───
    if (runtime.landwatchSearch && shouldRunLandWatchFallback(subject.acres, classified)) {
      landwatchDiag.notes.push(`LandWatch fallback triggered: ${subject.acres} ac subject with ${usableSoldEvidenceCount(classified)} usable sold comp(s) after the primary sources.`);
      const fresh = absorb(await runSecondary(landwatchDiag, 'LandWatch large-acreage fallback', 'landwatch', () => runtime.landwatchSearch!()), landwatchDiag);
      if (fresh.length) classified = [...classified, ...classifyMapSearchCandidates(subjectInput, fresh)];
    } else if (runtime.landwatchSearch || subject.acres != null) {
      landwatchDiag.notes.push(
        subject.acres == null || subject.acres < LANDWATCH_FALLBACK_MIN_ACRES
          ? `LandWatch fallback not triggered: subject ${subject.acres ?? 'unknown'} ac is below the ${LANDWATCH_FALLBACK_MIN_ACRES}-acre large-parcel threshold.`
          : !shouldRunLandWatchFallback(subject.acres, classified)
            ? 'LandWatch fallback not needed: the primary sold evidence is sufficient.'
            : 'No LandWatch flow was available in this environment.',
      );
    }

    // ── 6b. FALLBACK: Realtor.com only when evidence is still thin ───────────
    if (usableSoldEvidenceCount(classified) < 3 && runtime.realtorSearch) {
      const fresh = absorb(await runSecondary(realtorDiag, 'Realtor.com fallback', 'realtor', () => runtime.realtorSearch!()), realtorDiag);
      if (fresh.length) classified = [...classified, ...classifyMapSearchCandidates(subjectInput, fresh)];
    } else if (!realtorDiag.searchAttempted) {
      realtorDiag.notes.push(usableSoldEvidenceCount(classified) >= 3
        ? 'By source policy, Realtor.com is fallback-only; the primary sources supplied sufficient evidence.'
        : 'No Realtor.com flow was available in this environment.');
    }

    // Per-source tier counts for the diagnostics.
    for (const diag of diagnostics) {
      const source = diag.source === 'landportal' ? 'landportal_map_search' : diag.source;
      const rows = classified.filter((row) => row.candidate.source === source);
      diag.normalized = rows.length;
      diag.core = rows.filter((row) => row.tier === 'core').length;
      diag.directional = rows.filter((row) => row.tier === 'directional').length;
      diag.excluded = rows.filter((row) => row.tier === 'excluded').length;
    }
    lpDiag.deduped = Math.max(0, soldRun.rows.length - soldCandidates.length);

    // ── 7. Valuation: median accepted sold $/acre × subject acreage ─────────
    const valuation = landPortalCompSearchValuation(subject.acres, classified);

    // ── 8. Persist onto the Deal Card (one comp, multiple sources) ──────────
    let persistedComps = 0;
    const entity = ((request.subject as { entity?: LandosEntity }).entity ?? 'TY_LAND_BIZ') as LandosEntity;
    const SOURCE_LABELS: Record<string, AddCompInput['sourceLabel']> = {
      landportal_map_search: 'LandPortal', zillow: 'Zillow', redfin: 'Redfin', landwatch: 'LandWatch', realtor: 'Realtor',
    };
    if (subject.dealCardId != null) {
      const persist = runtime.persistComp ?? upsertNormalizedComp;
      for (const row of classified.filter((item) => item.tier !== 'excluded')) {
        const detail = details.get(row.candidate);
        const compUrl = candidateParcelUrl(row.candidate) ?? row.candidate.mlsUrl ?? '';
        const attributions: Array<{ provider: string; url?: string | null }> = [];
        if (row.candidate.source === 'landportal_map_search') attributions.push({ provider: 'landportal', url: compUrl || null });
        else attributions.push({ provider: row.candidate.source, url: row.candidate.mlsUrl });
        if (detail?.redfinUrl) attributions.push({ provider: 'redfin', url: detail.redfinUrl });
        for (const cross of crossSourceMatches.get(row.candidate) ?? []) attributions.push({ provider: cross.provider, url: cross.url });
        const remarkText = detail?.mlsDescription ?? row.candidate.remark ?? null;
        try {
          persist({
            entity,
            dealCardId: subject.dealCardId,
            cardId: subject.propertyCardId ?? undefined,
            sourceLabel: SOURCE_LABELS[row.candidate.source] ?? 'Other',
            sourceUrl: compUrl,
            addressDesc: [row.candidate.address, row.candidate.city, row.candidate.state, row.candidate.zip].filter(Boolean).join(', '),
            apn: row.candidate.apn ?? undefined,
            county: subject.county ?? undefined,
            state: row.candidate.state ?? subject.state ?? undefined,
            price: row.candidate.price ?? undefined,
            priceKind: 'sale',
            saleOrListDate: row.candidate.saleDate ?? detail?.lastSoldDate ?? undefined,
            acres: row.acresUsed ?? undefined,
            pricePerAcre: row.pricePerAcre ?? undefined,
            notes: [
              `Comp search (${row.tier}${row.improved ? ', improved sale' : ''}): ${row.reason}`,
              remarkText ? `LISTING-REPORTED remarks: ${remarkText.slice(0, 600)}` : null,
              detail?.acreageDivergence,
            ].filter(Boolean).join(' | '),
            addedBy: 'landos/landportal-comp-search',
            status: 'market_reference',
            lat: row.candidate.lat,
            lng: row.candidate.lng,
            canonicalSource: row.candidate.source === 'landportal_map_search' ? 'landportal' : row.candidate.source,
            city: row.candidate.city ?? undefined,
            zip: row.candidate.zip ?? undefined,
            distanceMiles: row.distanceMiles,
            daysOnMarket: detail?.daysOnMarket ?? null,
            propertyClass: row.improved ? 'residential' : 'vacant_land',
            classification: row.tier,
            inclusionReason: row.reason,
            sourceAttributions: attributions,
            dateWindowMonths: soldPlan.periodDays != null ? Math.round(soldPlan.periodDays / 30) : null,
          });
          persistedComps += 1;
        } catch { /* one failed row never fails the collection */ }
      }
    }

    // ── 9. Readiness: evidence insufficiency vs collection failure ──────────
    // A blocked provider is recorded as BLOCKED, never as an empty market:
    // a thin retained set with blocked lanes is honestly "partially collected",
    // not "the market has nothing".
    const blockedLanes = diagnostics
      .filter((diag) => diag.searchAttempted && !diag.searchVerified)
      .map((diag) => diag.source);
    const readiness: LandPortalCompSearchFacts['readiness'] = valuation.coreCount >= 2
      ? { grade: 'green', reason: `${valuation.coreCount} core sold sale(s) support the valuation baseline${blockedLanes.length ? ` (${blockedLanes.join(', ')} blocked, recorded as BLOCKED, not zero comps)` : ''}.` }
      : lpDiag.searchVerified
        ? {
            grade: 'yellow',
            reason: `The bounded multi-source comp process ran through a verified LandPortal search${broadened ? ' (including one broadening pass)' : ''} but retained ${valuation.coreCount} core sale(s)${blockedLanes.length
              ? `; ${blockedLanes.join(', ')} ran but ended blocked or unverified (recorded as BLOCKED lane failures — a blocked provider is not an empty market)`
              : '; the market evidence is genuinely thin, not uncollected'}.`,
          }
        : { grade: 'red', reason: 'The LandPortal map search never reached a verified applied-filter state; treat this as a collection failure, not market absence.' };

    evidence.push({
      source: 'LandPortal top-bar map search',
      sourceUrl: parcelUrl,
      sourceType: 'provider_search',
      retrievedAt: soldRun.capturedAtIso,
      details: {
        soldCandidates: soldCandidates.length,
        activeCandidates: activeCandidates.length,
        core: valuation.coreCount,
        directional: valuation.directionalCount,
        excluded: valuation.excludedCount,
        broadened,
      },
    });

    const facts: LandPortalCompSearchFacts = {
      executed: true,
      outcome: 'comps_collected',
      parcelUrl,
      soldCandidateCount: mergedSold.length,
      activeCandidateCount: activeCandidates.length,
      broadened,
      classified: classified.map((row) => ({
        source: row.candidate.source,
        address: [row.candidate.address, row.candidate.city, row.candidate.zip].filter(Boolean).join(', ') || null,
        apn: row.candidate.apn,
        price: row.candidate.price,
        acres: row.acresUsed,
        pricePerAcre: row.pricePerAcre,
        saleDate: row.candidate.saleDate,
        distanceMiles: row.distanceMiles,
        tier: row.tier,
        improved: !!row.improved,
        reason: row.reason,
        redfinUrl: details.get(row.candidate)?.redfinUrl ?? null,
        listingReported: (details.get(row.candidate)?.mlsDescription ?? row.candidate.remark ?? null)?.slice(0, 400) ?? null,
        sources: [...new Set([
          row.candidate.source === 'landportal_map_search' ? 'landportal' : row.candidate.source,
          ...(details.get(row.candidate)?.redfinUrl ? ['redfin'] : []),
          ...(crossSourceMatches.get(row.candidate) ?? []).map((cross) => cross.provider),
        ])],
      })),
      actives: activeCandidates.map((row) => ({
        address: [row.address, row.city, row.zip].filter(Boolean).join(', ') || null,
        price: row.price,
        acres: row.mlsAcres,
        pricePerAcre: row.pricePerAcre,
      })),
      valuation,
      diagnostics,
      readiness,
      persistedComps,
      mapShots,
      summary: `Comp Search discovered ${mergedSold.length} sold candidate(s) across sources (${broadened ? 'after one bounded broadening pass' : 'first pass'}) and ${activeCandidates.length} active listing(s); classification: ${valuation.coreCount} core / ${valuation.directionalCount} directional (${valuation.improvedDirectionalCount} improved) / ${valuation.excludedCount} excluded`
        + (valuation.landValueIndication != null
          ? `; median accepted sold $${valuation.medianSoldPricePerAcre?.toLocaleString()}/ac (core range $${valuation.coreSoldPricePerAcreLow?.toLocaleString()}–$${valuation.coreSoldPricePerAcreHigh?.toLocaleString()}/ac) × ${subject.acres} ac ≈ $${valuation.landValueIndication.toLocaleString()} land value indication.`
          : `; no defensible land value stated (${valuation.caveats[0] ?? 'insufficient core evidence'}).`),
    };

    return {
      status: 'SUCCEEDED',
      subjectResolution,
      canonicalSubject,
      facts,
      evidence,
      warnings,
      missingInformation: valuation.landValueIndication == null ? ['Two or more core sold vacant-land sales for a defensible median'] : [],
    };
  },
};
