// LandOS — LandPortal Comp Search Capability.
//
// Tool 3 of the LandPortal three-tool split: "Find the best available market
// comps for THIS subject." It uses LandPortal's NEW top-bar Map Search as the
// PRIMARY discovery flow — the old automatic LP-Estimate comp suggestions are
// no longer the search universe, and LandPortal's AI Comp Report is never a
// dependency. LandOS owns discovery, extraction, enrichment, classification
// and the rough valuation.
//
// Default source priority (operator-directed, 2026-08-19):
//   1. LandPortal new map search  = primary discovery (sold + active passes).
//   2. LandPortal candidate detail = primary enrichment: the strongest sold
//      candidates' own parcel pages (Property/MLS details, listing remarks).
//   3. Redfin = followed ONLY through the exact "View on Redfin" link a
//      candidate's LandPortal page exposes — no broad Redfin market search.
//   4. Zillow = independent second discovery/cross-check flow.
//   5. Realtor.com = fallback only, when the above are thin.
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
/** Bounded candidate-detail enrichment: the strongest sold candidates only. */
export const ENRICHMENT_CANDIDATE_CAP = 6;

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
}

export interface SecondarySearchResult {
  status: 'retrieved' | 'blocked' | 'none' | 'error' | 'disabled';
  comps: SecondarySoldComp[];
  note: string;
}

export interface LandPortalCompSearchRuntime extends LandPortalToolSubjectRuntime {
  runMapSearch?: (url: string, plan: LandPortalMapSearchPlan, opts: { timeoutMs: number }) => Promise<LandPortalMapSearchRun>;
  /** Candidate-detail enrichment: the comp's OWN parcel page incl MLS block. */
  readCompRecord?: (url: string, opts: { timeoutMs: number; includeMls?: boolean }) => Promise<LandPortalRecordRead>;
  /** Independent Zillow sold-land flow (route wires fetchZillowLandComps). */
  zillowSearch?: (mode: 'sold' | 'active') => Promise<SecondarySearchResult>;
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

/** One underlying sale across sources: match on address, near-identical
 *  coordinates, or the same price on the same sale month. */
export function sameUnderlyingSale(
  a: { address: string | null; lat?: number | null; lng?: number | null; price: number | null; saleDate?: string | null },
  b: { address: string | null; lat?: number | null; lng?: number | null; price: number | null; saleDate?: string | null },
): boolean {
  const addressA = normalizedAddress(a.address);
  const addressB = normalizedAddress(b.address);
  if (addressA && addressB && addressA === addressB) return true;
  if (a.lat != null && a.lng != null && b.lat != null && b.lng != null) {
    if (Math.abs(a.lat - b.lat) < 0.0025 && Math.abs(a.lng - b.lng) < 0.0025) return true;
  }
  if (a.price != null && b.price != null && a.price === b.price && a.saleDate && b.saleDate
    && a.saleDate.slice(0, 7) === b.saleDate.slice(0, 7)) return true;
  return false;
}

function secondaryToCandidate(row: SecondarySoldComp, source: 'zillow' | 'realtor'): LandPortalMapSearchCandidate {
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
  };
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
    const realtorDiag = emptySourceDiagnostics('realtor');
    diagnostics.push(lpDiag, zillowDiag, redfinDiag, realtorDiag);

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

    // ── 3. PRIMARY ENRICHMENT: strongest sold candidates' own pages ──────────
    const preliminary = classifyMapSearchCandidates(
      { subjectAcres: subject.acres, subjectApn: subject.apn, subjectLat: subject.lat, subjectLng: subject.lng },
      soldCandidates,
    );
    const details = new Map<LandPortalMapSearchCandidate, EnrichedCandidateDetail>();
    if (runtime.readCompRecord) {
      const strongest = [...preliminary]
        .filter((row) => row.tier !== 'excluded')
        .sort((a, b) => (a.tier === b.tier ? (b.candidate.saleDate ?? '').localeCompare(a.candidate.saleDate ?? '') : a.tier === 'core' ? -1 : 1))
        .slice(0, ENRICHMENT_CANDIDATE_CAP);
      for (const row of strongest) {
        const compUrl = candidateParcelUrl(row.candidate);
        if (!compUrl) continue;
        try {
          const read = await runtime.readCompRecord(compUrl, { timeoutMs: enrichTimeoutMs, includeMls: true });
          if (!read.panelReady) continue;
          lpDiag.detailPagesInspected += 1;
          const detail = detailFromRecord(read, compUrl);
          details.set(row.candidate, detail);
          if (detail.redfinUrl) {
            redfinDiag.searchAttempted = true;
            redfinDiag.searchVerified = true;
            redfinDiag.candidatesDiscovered += 1;
            redfinDiag.notes.push(`Exact Redfin link for ${row.candidate.address ?? row.candidate.apn ?? 'candidate'}: followed from the LandPortal listing block.`);
          }
        } catch { /* one unreachable candidate page never fails the search */ }
      }
    }
    if (!redfinDiag.searchAttempted) {
      redfinDiag.notes.push('By source policy, Redfin runs only through the exact links LandPortal candidate pages expose; no broad Redfin market search was run.');
    }

    // ── 4. INDEPENDENT SECOND FLOW: Zillow sold land ─────────────────────────
    let zillowCandidates: LandPortalMapSearchCandidate[] = [];
    if (runtime.zillowSearch) {
      zillowDiag.searchAttempted = true;
      try {
        const zillow = await boundedLane(() => runtime.zillowSearch!('sold'), 'The Zillow sold-land flow');
        zillowDiag.searchVerified = zillow.status === 'retrieved' || zillow.status === 'none';
        zillowDiag.notes.push(zillow.note);
        zillowCandidates = zillow.comps
          .filter((row) => row.status === 'sold')
          .map((row) => secondaryToCandidate(row, 'zillow'));
        zillowDiag.candidatesDiscovered = zillowCandidates.length;
      } catch (error) {
        zillowDiag.notes.push(`Zillow flow failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      zillowDiag.notes.push('No Zillow flow was available in this environment.');
    }

    // Cross-source dedupe: one underlying sale stays one comp.
    const crossSourceMatches = new Map<LandPortalMapSearchCandidate, string[]>();
    const freshZillow: LandPortalMapSearchCandidate[] = [];
    for (const zillowRow of zillowCandidates) {
      const match = soldCandidates.find((lpRow) => sameUnderlyingSale(lpRow, zillowRow));
      if (match) {
        const urls = crossSourceMatches.get(match) ?? [];
        if (zillowRow.mlsUrl) urls.push(zillowRow.mlsUrl);
        crossSourceMatches.set(match, urls);
        zillowDiag.deduped += 1;
      } else {
        freshZillow.push(zillowRow);
      }
    }

    // ── 5. Classification over the merged sold universe ──────────────────────
    const mergedSold = [...soldCandidates, ...freshZillow];
    let classified: ClassifiedLandPortalComp[] = classifyMapSearchCandidates(
      { subjectAcres: subject.acres, subjectApn: subject.apn, subjectLat: subject.lat, subjectLng: subject.lng },
      mergedSold,
    );
    // Detail-driven correction: a candidate whose own record proves a material
    // structure leaves the vacant-land calculation, whatever its card said.
    classified = classified.map((row) => {
      const detail = details.get(row.candidate);
      if (!detail) return row;
      if (row.tier !== 'excluded' && detail.buildingSqft != null && detail.buildingSqft >= IMPROVED_BUILDING_SQFT_FLOOR) {
        return { ...row, tier: 'excluded' as const, reason: `Candidate's own parcel record shows a ${detail.buildingSqft.toLocaleString()} SqFt structure; the sale price includes improvements and cannot enter the vacant-land $/acre calculation.` };
      }
      return row;
    });

    // ── 6. FALLBACK: Realtor.com only when evidence is thin ──────────────────
    let accepted = classified.filter((row) => row.tier !== 'excluded');
    if (accepted.length < 3 && runtime.realtorSearch) {
      realtorDiag.searchAttempted = true;
      try {
        const realtor = await boundedLane(() => runtime.realtorSearch!(), 'The Realtor.com fallback flow');
        realtorDiag.searchVerified = realtor.status === 'retrieved' || realtor.status === 'none';
        realtorDiag.notes.push(realtor.note);
        const fresh = realtor.comps
          .filter((row) => row.status === 'sold')
          .map((row) => secondaryToCandidate(row, 'realtor'))
          .filter((row) => !mergedSold.some((prior) => sameUnderlyingSale(prior, row)));
        realtorDiag.candidatesDiscovered = fresh.length;
        if (fresh.length) {
          const extra = classifyMapSearchCandidates(
            { subjectAcres: subject.acres, subjectApn: subject.apn, subjectLat: subject.lat, subjectLng: subject.lng },
            fresh,
          );
          classified = [...classified, ...extra];
          accepted = classified.filter((row) => row.tier !== 'excluded');
        }
      } catch (error) {
        realtorDiag.notes.push(`Realtor fallback failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (!realtorDiag.searchAttempted) {
      realtorDiag.notes.push(accepted.length >= 3
        ? 'By source policy, Realtor.com is fallback-only; LandPortal + Zillow supplied sufficient evidence.'
        : 'No Realtor.com flow was available in this environment.');
    }

    // Per-source tier counts for the diagnostics.
    for (const diag of [lpDiag, zillowDiag, realtorDiag]) {
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
    if (subject.dealCardId != null) {
      const persist = runtime.persistComp ?? upsertNormalizedComp;
      for (const row of classified.filter((item) => item.tier !== 'excluded')) {
        const detail = details.get(row.candidate);
        const compUrl = candidateParcelUrl(row.candidate) ?? row.candidate.mlsUrl ?? '';
        const attributions: Array<{ provider: string; url?: string | null }> = [];
        if (row.candidate.source === 'landportal_map_search') attributions.push({ provider: 'landportal', url: compUrl || null });
        else attributions.push({ provider: row.candidate.source, url: row.candidate.mlsUrl });
        if (detail?.redfinUrl) attributions.push({ provider: 'redfin', url: detail.redfinUrl });
        for (const url of crossSourceMatches.get(row.candidate) ?? []) attributions.push({ provider: 'zillow', url });
        try {
          persist({
            entity,
            dealCardId: subject.dealCardId,
            cardId: subject.propertyCardId ?? undefined,
            sourceLabel: 'LandPortal',
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
              `LandPortal map-search comp (${row.tier}): ${row.reason}`,
              detail?.mlsDescription ? `LISTING-REPORTED remarks: ${detail.mlsDescription.slice(0, 600)}` : null,
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
            propertyClass: 'vacant_land',
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
    const readiness: LandPortalCompSearchFacts['readiness'] = valuation.coreCount >= 2
      ? { grade: 'green', reason: `${valuation.coreCount} core sold sale(s) support the valuation baseline.` }
      : lpDiag.searchVerified
        ? { grade: 'yellow', reason: `The bounded multi-source comp process ran through a verified LandPortal search${broadened ? ' (including one broadening pass)' : ''} but retained ${valuation.coreCount} core sale(s); the market evidence is genuinely thin, not uncollected.` }
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
      soldCandidateCount: soldCandidates.length + freshZillow.length,
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
        reason: row.reason,
        redfinUrl: details.get(row.candidate)?.redfinUrl ?? null,
        listingReported: details.get(row.candidate)?.mlsDescription?.slice(0, 400) ?? null,
        sources: [
          row.candidate.source === 'landportal_map_search' ? 'landportal' : row.candidate.source,
          ...(details.get(row.candidate)?.redfinUrl ? ['redfin'] : []),
          ...((crossSourceMatches.get(row.candidate) ?? []).length ? ['zillow'] : []),
        ],
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
      summary: `LandPortal Comp Search discovered ${soldCandidates.length} sold candidate(s) (${broadened ? 'after one bounded broadening pass' : 'first pass'}) and ${activeCandidates.length} active listing(s); classification: ${valuation.coreCount} core / ${valuation.directionalCount} directional / ${valuation.excludedCount} excluded`
        + (valuation.landValueIndication != null
          ? `; median sold $${valuation.medianSoldPricePerAcre?.toLocaleString()}/ac × ${subject.acres} ac ≈ $${valuation.landValueIndication.toLocaleString()} land value indication.`
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
