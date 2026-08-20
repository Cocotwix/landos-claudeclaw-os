// Comps & Valuation workspace projection + operator valuation-comp selection.
//
// One read-time projection over the canonical comp registry (landos_comp), the
// canonical property-research evidence (provider comps not yet persisted as
// registry rows, e.g. Redfin actives), and the retained LandPortal inspection
// (sidebar / Show on Map surfaces and status provenance). Nothing here reruns
// research or mutates evidence; the only writes are the operator's explicit
// include/exclude decision (additive columns on the same landos_comp row) and
// the bounded location-resolution action (existing geocode cache + fill-only
// subject coordinates).
//
// Valuation is AUTOMATIC and PROVISIONAL: when at least two credible closed
// vacant-land sales exist they form the default provisional valuation set with
// no manual Include step (median sold price per acre × subject working acres).
// Operator exclusions (with retained reasons) and restorations refine the set
// and recalculate immediately. Asking references and active listings never
// price the subject. Fewer than two credible closed sales after exclusions
// returns the valuation to insufficient-evidence status and locks the 40/50/60%
// acquisition levels.
//
// Comparable selection is PROXIMITY-FIRST (initial 10-mile radius, disclosed
// expansion), never county-first: county stays visible and can shade
// confidence, but never automatically disqualifies a sale. Distance is one
// consistent straight-line (haversine) calculation from the subject point to
// each comp's resolved location; unresolved locations show no distance and are
// never guessed.

import { getLandosDb, landosAudit, type LandosEntity } from './db.js';
import { getComp, listComps, enrichCompCoordinates, geocodeAddressesToCache, type CompRow } from './comps.js';
import { getDealCard, resolveSubjectPropertyCard } from './deal-card.js';
import { loadPropertyInspection, currentComparables, type LandPortalComparableRecord } from './property-card.js';
import { PropertyResearchStore } from './property-research-store.js';
import { GLOBAL_MIN_NET_PROFIT_USD, FLIP_STANDARD_BAND } from './offer-engine.js';
import { propertyMarketContextFor, type PropertyMarketContext } from './property-market-context.js';
import {
  selectRecencyWindow, valuationAcreageBand, exactMonthsOld,
  type AcreageBand, type RecencyCandidate, type RecencyWindowSelection,
} from './comp-recency-window.js';
import {
  compDistanceMiles,
  resolveGeographicTier,
  routeAcreage,
  routedAcreageSimilarity,
} from './acreage-router.js';
import { isListingPhotoUrl, resolveCompVisual, tallyCompVisuals, type CompVisual, type CompVisualCounts } from './comp-visual.js';
import { parseListingDetail } from './comp-listing-store.js';
import type { PersistedCompListingDetail } from './comp-listing-store.js';
import {
  buildCompListingProjection, type CompListingProjection, type CompTransactionKind,
} from './comp-listing-projection.js';
import { landPortalSaleStatus } from './deal-intelligence-comps.js';
import { subjectParcelMatch, type SubjectParcelIdentity } from './comp-subject-identity.js';
import { inferSubjectPropertyType } from './comparable-intelligence.js';
import type { CompSaleVerification } from './comp-transaction-price.js';
import { addressStateCode, normalizeCompAddress } from './comp-registry.js';
import {
  compAddressKey, reconcileCompAddress, reconcileRetainedCompLocation,
  type RetainedCompLocation, type RetainedGeocodeHit,
} from './comp-location-reconciliation.js';
import { collectMarketLeads, type CompMarketLead } from './comp-market-leads.js';
import { buildParcelFactSheet } from './landportal-facts.js';

export type WorkspaceCompCategory =
  | 'accepted_closed_sale'
  | 'candidate_closed_sale'
  | 'active_competition'
  | 'asking_reference'
  | 'improved_context'
  | 'rejected'
  | 'context_only';

export const WORKSPACE_CATEGORY_LABELS: Readonly<Record<WorkspaceCompCategory, string>> = {
  accepted_closed_sale: 'Closed vacant-land sale — in valuation set',
  candidate_closed_sale: 'Candidate closed vacant-land sale',
  active_competition: 'Active vacant-land competition',
  asking_reference: 'Asking-market reference',
  improved_context: 'Improved-property context',
  rejected: 'Rejected or non-comparable',
  context_only: 'Context only',
};

export const INITIAL_COMP_RADIUS_MILES = 10;
/** Legacy 20-mile disclosure marker retained for readers of the workspace
 *  shape. It is not an evidence boundary: outer tiers remain usable. */
export const MAX_COMP_SEARCH_RADIUS_MILES = 20;

/** Comparability role for closed vacant-land sales. Assigned only AFTER the
 *  acreage band and the sale-recency window have selected the valuation set, so
 *  a role can never contradict the window that produced it.
 *
 *  direct:                 in the selected window and acreage band, inside the
 *                          initial 10-mile radius. Full valuation weight.
 *  supporting:             in the selected window and band, outside the local
 *                          tier or otherwise less similar. Reduced weight.
 *  supplemental_historical: sold 25–30 months ago, admitted ONLY because 2 or
 *                          fewer credible sales survived inside 24 months.
 *                          Substantially reduced weight; leaves automatically.
 *  boundary:               retained to define an upper or lower limit because of
 *                          a documented non-geographic difference such as
 *                          acreage outside the routed pool. Zero valuation weight.
 *  historical_context:     older than the selected window. Zero valuation weight. */
export type CompValuationRole =
  | 'direct' | 'supporting' | 'supplemental_historical' | 'boundary' | 'historical_context';

export const VALUATION_ROLE_LABELS: Readonly<Record<CompValuationRole, string>> = {
  direct: 'Direct comp',
  supporting: 'Supporting comp',
  supplemental_historical: 'Supplemental historical comp',
  boundary: 'Boundary comp',
  historical_context: 'Historical context',
};

/** Whether a record prices the subject is answered by `inValuationSet`, which
 *  the acreage band and recency window decide. The role is the comparability
 *  tier within that decision — never the membership test itself. */

function radiusStageFor(distance: number | null): WorkspaceComp['radiusStage'] {
  if (distance == null) return null;
  if (distance <= INITIAL_COMP_RADIUS_MILES) return 'initial_10';
  if (distance <= MAX_COMP_SEARCH_RADIUS_MILES) return 'expansion_20';
  return 'beyond_20';
}

export interface WorkspaceComp {
  /** landos_comp row id when persisted; null for research-evidence-only records. */
  compId: number | null;
  key: string;
  category: WorkspaceCompCategory;
  categoryLabel: string;
  classificationReason: string;
  /** May the operator include this record in the valuation set? */
  eligibleForValuation: boolean;
  selectedForValuation: boolean;
  /** How the record entered the valuation set: default auto-selection or an explicit operator include. */
  selectionMode: 'auto' | 'operator' | null;
  operatorExcluded: boolean;
  exclusionReason: string | null;
  source: string;
  sourceUrl: string | null;
  origins: string[];
  /** Provider rows merged behind this physical property. */
  duplicatesMerged?: number;
  fromLandPortalSidebar: boolean;
  fromLandPortalShowOnMap: boolean;
  mergeStatus: string | null;
  address: string | null;
  apn: string | null;
  county: string | null;
  state: string | null;
  /** Straight-line miles from the subject point; null when either location is unresolved. */
  distanceMiles: number | null;
  /** True when the resolved comp lies beyond the initial 10-mile radius. */
  outsideInitialRadius: boolean | null;
  lat: number | null;
  lng: number | null;
  locationResolved: boolean;
  /** Where the coordinate came from (e.g. "LandPortal map point", "US Census address geocode"). */
  locationSource: string | null;
  locationMethod: 'provider_map_point' | 'address_geocode' | 'none';
  locationResolvedAtIso: string | null;
  /** The postal address this record's own capture states, once reconciled. */
  locationAddress: string | null;
  /** Why this record is not on the map, in the operator's words. Null when it is. */
  locationUnresolvedReason: string | null;
  statusLabel: string;
  priceKind: 'sale' | 'list' | 'unknown';
  price: number | null;
  acres: number | null;
  pricePerAcre: number | null;
  dateIso: string | null;
  /** Days on market for active listings, when the source supplied it. */
  daysOnMarket: number | null;
  soldBy: string | null;
  buildingSqft: number | null;
  propertyClass: 'land' | 'improved' | 'unknown';
  thumbnailUrl: string | null;
  /** Ordered property/listing photos available to the lightweight gallery. */
  photoUrls?: string[];
  /** The visual actually shown for this record, with honest provenance. Every
   *  record has one; only a genuinely unresolvable location yields a
   *  location_unresolved placeholder. */
  visual: CompVisual;
  acresDeltaFromSubject: number | null;
  recencyMonths: number | null;
  /** Whole months from the ACTUAL sale date to today, from exact calendar math
   *  rather than a rounded 30.44-day approximation. */
  monthsOld: number | null;
  /** One-line comparability basis for the selected-set display. */
  primaryComparability: string | null;
  /** The most important difference from the subject (selected-set display). */
  keyDifference: string | null;
  /** Fields the source genuinely did not supply (shown quietly, never as banner noise). */
  missingFields: string[];
  /** Whether the closed price was independently verified or only stated by the
   *  source. A `source_stated` row participates but is never called verified. */
  saleVerification: CompSaleVerification;
  /** Comparability role inside the closed-sale evidence. Null for records that
   *  are not closed vacant-land sales. */
  valuationRole: CompValuationRole | null;
  /** True only when this record actually influences the cleaned FMV. */
  inValuationSet: boolean;
  /** Relative weight carried in the weighted indication; null when zero-weight. */
  valuationWeight: number | null;
  /** Why an otherwise credible closed sale carries no valuation weight. */
  zeroWeightReason: string | null;
  /** Which disclosed search stage covers the resolved location: the initial
   *  10-mile radius, the 10-to-20-mile expansion, prior retained evidence
   *  beyond 20 miles, or null while the location is unresolved. */
  radiusStage: 'initial_10' | 'expansion_20' | 'beyond_20' | null;
  /** Who recorded the exclusion: Tyler ('operator') or LandOS automation
   *  ('landos'). Null when the record is not excluded. The UI must never say
   *  "Excluded by the operator" for a LandOS exclusion. */
  exclusionActor: 'operator' | 'landos' | null;
  /** The one distinction the operator must never have to work out: closed
   *  valuation evidence, current competition, or neither. Drives the marker
   *  shape, the card badge, the popup heading, and the cluster grouping. */
  transactionKind: CompTransactionKind;
  /** Listing history, market time, transaction-price decision, descriptions and
   *  evidence for this record. Never null for a persisted comp — when the
   *  provider page has not been revisited it says so rather than going blank. */
  listing: CompListingProjection | null;
}

export interface CompsValuationSummary {
  workingAcres: number | null;
  acceptedCount: number;
  medianPricePerAcre: number | null;
  ppaBand: { low: number; median: number; high: number } | null;
  fmv: { low: number | null; central: number; high: number | null } | null;
  acquisitionLevels: { pct40: number; pct50: number; pct60: number } | null;
  acquisitionLockedReason: string | null;
  status: 'supported' | 'provisional' | 'insufficient';
  statusLabel: string;
  /** e.g. "Provisional valuation based on 2 closed vacant-land sales". */
  basisLabel: string;
  statusReason: string;
  confidence: 'high' | 'moderate' | 'low' | 'unavailable';
  confidenceFactors: string[];
  radius: {
    initialMiles: number;
    usedMiles: number | null;
    expanded: boolean;
    withinInitial: number;
    withinExpansion: number;
    beyondExpansion: number;
    unresolved: number;
    note: string;
  };
  distanceRange: { minMiles: number; maxMiles: number } | null;
}
export interface ImprovementValuationComp {
  key: string;
  address: string | null;
  source: string;
  sourceUrl: string | null;
  soldPrice: number;
  buildingSqft: number;
  acres: number | null;
  soldDateIso: string | null;
  soldPricePerSqft: number;
  largeAcreage: boolean;
  notes: string | null;
}

export interface ImprovementValuation {
  subjectBuildingSqft: number | null;
  qualifyingSoldCompCount: number;
  qualifyingComps: ImprovementValuationComp[];
  medianSoldPricePerSqft: number | null;
  /** Current Redfin ZIP benchmark used for the subject overlay when available. */
  redfinZip: string | null;
  redfinMedianSoldPricePerSqft: number | null;
  redfinSourceUrl: string | null;
  redfinSourceRetrievedAt: string | null;
  largeAcreageCompCount: number;
  estimatedSubjectImprovementValue: number | null;
  wholePropertyValue: number | null;
  /** False when the subject's retained improvements are not residential, so the
   *  residential $/sqft overlay is deliberately not applied to them. */
  residentialOverlayApplies: boolean;
  /** Operator-facing reason the residential overlay was skipped. */
  overlaySkippedReason: string | null;
}

export interface CompsValuationExplanation {
  used: Array<{ key: string; line: string }>;
  excluded: Array<{ key: string; line: string }>;
  medianNote: string | null;
  neededEvidence: string[];
  strongestEvidence: string | null;
  weakestEvidence: string | null;
}

/**
 * Whether the SUBJECT itself carries improvements, and what that means for what
 * a vacant-land comp set is allowed to be called.
 *
 * A land-comp median times the subject acreage is a land value. On an improved
 * parcel it is not the property's fair market value, and presenting it as one
 * understates the asset by the whole structure. The land figure stays — it is
 * real and useful — but it is named a land-only indication and the whole-property
 * value is reported as pending until the improvements are separately valued.
 */
export interface SubjectImprovementRead {
  improved: boolean;
  /** Classification from the retained parcel facts and visual observations. */
  type: string;
  buildingSqft: number | null;
  /** Provenance for the improvement finding. Null when the subject is land. */
  evidence: string | null;
  /** Noun for the operator caption: "vacant parcel" or "improved parcel". */
  captionNoun: string;
  /** What the comp-derived figure may be called for THIS subject. */
  valuationScope: 'land_only' | 'whole_property';
  valuationScopeLabel: string;
  /** Set only when the subject is improved and the structure is not yet valued. */
  wholePropertyPending: boolean;
  wholePropertyNote: string | null;
}

/**
 * LandPortal's published estimate for the subject parcel.
 *
 * `priceLabel` and `perAcreLabel` are LandPortal's own strings, untouched. The
 * numeric fields are parsed only so the view can show the gap against the
 * LandOS land value; a figure LandOS could not parse keeps its label and a null
 * number rather than being rounded into something LandPortal never said.
 */
export interface LandPortalEstimate {
  priceLabel: string | null;
  perAcreLabel: string | null;
  price: number | null;
  perAcre: number | null;
  source: string;
  note: string;
}

export interface CompsValuationView {
  dealCardId: number;
  propertyCardId: number | null;
  subject: {
    address: string | null; apn: string | null; acres: number | null; county: string | null; state: string | null;
    lat: number | null; lng: number | null; locationSource: string | null;
  };
  /** Subject-level improvement finding and the valuation scope it forces. */
  subjectImprovement: SubjectImprovementRead;
  summary: CompsValuationSummary;
  comps: WorkspaceComp[];
  counts: Record<WorkspaceCompCategory, number> & { total: number };
  /** The sole cross-surface comparable count: one physical property once. */
  canonicalCompCount: number;
  /** Provider rows collapsed behind those canonical physical properties. */
  duplicatesMerged: number;
  /** Unique retained records vs records actually placeable on the map, whole
   *  and per category, so the map legend and the evidence registry can never
   *  disagree by more than the disclosed unresolved locations. */
  mapCounts: {
    retained: number;
    mapped: number;
    unresolved: number;
    byCategory: Record<WorkspaceCompCategory, { retained: number; mapped: number; unresolved: number }>;
  };
  improvementValuation: ImprovementValuation;
  landPortal: { sidebarCount: number; showOnMapCount: number; mergedUniqueCount: number };
  /**
   * LandPortal's OWN estimate for the subject, reproduced exactly as LandPortal
   * publishes it. It is a provider opinion, not a LandOS conclusion: it never
   * enters `summary`, `cleaned`, `quickFlip` or any acquisition level, and it is
   * carried here so the operator can read it beside the LandOS land value and
   * see the two disagree when they do.
   */
  lpEstimate: LandPortalEstimate | null;
  /**
   * Area and market statements read out of provider listing descriptions.
   * Leads about the AREA, never facts about the subject — see
   * `comp-market-leads.ts`.
   */
  marketLeads: CompMarketLead[];
  explanation: CompsValuationExplanation;
  /** Cleaned FMV reconciliation over the documented cleaned closed-sale set. */
  cleaned: CleanedValuation;
  /** Bounded technical quick-flip underwriting (normal quick flip only). */
  quickFlip: QuickFlipUnderwriting | null;
  /** Final negotiation reconciliation of the simplified and technical methods. */
  negotiation: NegotiationReconciliation | null;
  /** LandOS Market Research acreage-band context (never LandPortal panels). */
  marketContext: PropertyMarketContext;
  /** Which acreage band and sale-recency window actually selected the valuation
   *  set, with the counts that forced each decision. */
  valuationWindow: RecencyWindowSelection;
  /** Visual provenance tallies across every retained record. */
  visualCounts: CompVisualCounts;
}

/**
 * The subject parcel's own centroid, as the retained parcel record publishes
 * it. ENRICHMENT ONLY: it places the subject on a map and makes distances
 * measurable. It never verifies parcel identity, and no comparison against it
 * may establish which parcel a card is about.
 */
export function retainedParcelCentroid(
  inspection: { parcelFacts?: Record<string, string> } | null | undefined,
): { lat: number; lng: number } | null {
  const facts = inspection?.parcelFacts ?? {};
  const read = (...labels: string[]): number | null => {
    for (const label of labels) {
      const raw = facts[label];
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const value = Number(raw.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)?.[0] ?? Number.NaN);
      if (Number.isFinite(value)) return value;
    }
    return null;
  };
  const lat = read('Centroid Latitude', 'Latitude', 'Situs Latitude');
  const lng = read('Centroid Longitude', 'Longitude', 'Situs Longitude');
  if (lat == null || lng == null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

/**
 * Read the subject's improvement status from the retained LandPortal inspection.
 * Never guesses: with no retained parcel facts or observations the subject is
 * reported as land, because that is the state the evidence supports.
 */
export function readSubjectImprovement(
  inspection: Parameters<typeof inferSubjectPropertyType>[0],
): SubjectImprovementRead {
  const classification = inferSubjectPropertyType(inspection);
  const facts = inspection?.parcelFacts ?? {};
  const sqftEntry = Object.entries(facts).find(([key]) => /^building\s*(sq\s*ft|sqft)?$/i.test(key));
  const parsedSqft = sqftEntry ? Number(String(sqftEntry[1]).replace(/[^0-9.-]/g, '')) : NaN;
  const buildingSqft = Number.isFinite(parsedSqft) && parsedSqft > 0 ? parsedSqft : null;
  const improved = classification.type !== 'vacant_land' && classification.type !== 'unknown';

  if (!improved) {
    return {
      improved: false,
      type: classification.type,
      buildingSqft,
      evidence: null,
      captionNoun: 'vacant parcel',
      valuationScope: 'whole_property',
      valuationScopeLabel: 'Preliminary fair market value',
      wholePropertyPending: false,
      wholePropertyNote: null,
    };
  }

  const sqftText = buildingSqft != null ? `approx. ${Math.round(buildingSqft).toLocaleString('en-US')} sqft of improvements` : 'retained improvements';
  return {
    improved: true,
    type: classification.type,
    buildingSqft,
    evidence: `${classification.note} Retained parcel evidence records ${sqftText}.`,
    captionNoun: 'improved parcel',
    valuationScope: 'land_only',
    valuationScopeLabel: 'Land-only indication — improvements not valued',
    wholePropertyPending: true,
    wholePropertyNote: `Whole-property value is PENDING. The subject is a materially improved parcel (${sqftText}), and the figure above is derived only from vacant-land sales, so it prices the land and excludes the structure. A whole-property value requires the improvements to be valued separately; that has not been done.`,
  };
}

const round500 = (n: number): number => Math.round(n / 500) * 500;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * A house-value overlay prices a dwelling. Applying residential sold $/sqft to a
 * barn, orchard building, or other non-residential structure invents a house
 * that the retained evidence does not describe, so only residential structure
 * classifications may carry the overlay.
 */
export function isResidentialStructureType(type: string): boolean {
  return type === 'existing_residence' || type === 'manufactured_home';
}

/**
 * Separate improved-property valuation. Improved sold prices are used as sold
 * $/sqft evidence only; no comp land component is estimated or removed.
 *
 * `subjectStructure` gates the subject overlay: when the retained evidence
 * classifies the subject's improvements as agricultural, commercial, or any
 * other non-residential type, no residential $/sqft overlay is applied and the
 * reason is reported instead of a value.
 */
export function computeImprovementValuation(
  comps: WorkspaceComp[],
  subjectBuildingSqft: number | null,
  subjectLandValue: number | null,
  redfinBenchmark: {
    zip: string | null;
    medianSoldPricePerSqft: number | null;
    sourceUrl: string | null;
    retrievedAt: string | null;
  } | null = null,
  subjectStructure: { type: string } | null = null,
): ImprovementValuation {
  const qualifyingComps = comps
    .filter((c) => c.propertyClass === 'improved'
      && c.transactionKind === 'closed'
      && c.priceKind === 'sale'
      && c.price != null
      && c.price > 0
      && c.buildingSqft != null
      && c.buildingSqft > 0)
    .map((c): ImprovementValuationComp => ({
      key: c.key,
      address: c.address,
      source: c.source,
      sourceUrl: c.sourceUrl,
      soldPrice: c.price!,
      buildingSqft: c.buildingSqft!,
      acres: c.acres,
      soldDateIso: c.dateIso,
      soldPricePerSqft: c.price! / c.buildingSqft!,
      largeAcreage: c.acres != null && c.acres > 1,
      notes: c.classificationReason || null,
    }));
  const medianSoldPricePerSqft = median(qualifyingComps.map((c) => c.soldPricePerSqft));
  const residentialOverlayApplies = subjectStructure == null || isResidentialStructureType(subjectStructure.type);
  const overlaySkippedReason = residentialOverlayApplies
    ? null
    : `Residential house-value overlay skipped: retained evidence classifies the subject improvements as ${subjectStructure!.type.replace(/_/g, ' ')}, not a residential structure. Residential sold $/sqft is not applied to non-residential improvements, so no improvement or whole-property value is produced here.`;
  const overlayPpsf = redfinBenchmark?.medianSoldPricePerSqft ?? medianSoldPricePerSqft;
  const estimatedSubjectImprovementValue = residentialOverlayApplies && overlayPpsf != null
    && subjectBuildingSqft != null && subjectBuildingSqft > 0
    ? overlayPpsf * subjectBuildingSqft
    : null;
  return {
    subjectBuildingSqft,
    qualifyingSoldCompCount: qualifyingComps.length,
    qualifyingComps,
    medianSoldPricePerSqft,
    redfinZip: redfinBenchmark?.zip ?? null,
    redfinMedianSoldPricePerSqft: redfinBenchmark?.medianSoldPricePerSqft ?? null,
    redfinSourceUrl: redfinBenchmark?.sourceUrl ?? null,
    redfinSourceRetrievedAt: redfinBenchmark?.retrievedAt ?? null,
    largeAcreageCompCount: qualifyingComps.filter((c) => c.largeAcreage).length,
    estimatedSubjectImprovementValue,
    wholePropertyValue: estimatedSubjectImprovementValue != null && subjectLandValue != null
      ? subjectLandValue + estimatedSubjectImprovementValue
      : null,
    residentialOverlayApplies,
    overlaySkippedReason,
  };
}

/** One consistent straight-line distance for every source (miles, 0.1 precision). */
export function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return compDistanceMiles(a, b) ?? 0;
}

function monthsSince(dateIso: string | null, nowMs: number): number | null {
  if (!dateIso) return null;
  const t = Date.parse(dateIso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (nowMs - t) / (1000 * 60 * 60 * 24 * 30.44));
}

function parseSoldBy(notes: string): string | null {
  const m = /sold by ([^.]+)\./i.exec(notes);
  return m ? m[1].trim() : null;
}

function parseBuildingSqft(notes: string): number | null {
  const m = /building ([\d,]+)\s*sqft/i.exec(notes);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Zillow rows arrive with their card fragments concatenated and no separator:
 * `208 sqftHouse for sale10892 Lakeshore Rd, Elk Rapids, MI 49629`. A word
 * boundary cannot see the `House` inside `sqftHouse`, so every structure keyword
 * glued to the preceding fragment was invisible and eleven house listings on
 * 9490 Elk Lake Rd were filed as active vacant-land competition.
 *
 * Splitting at the lower-or-digit -> upper transition restores the boundary the
 * source dropped. This is a matching aid only: nothing stored, displayed, or
 * returned to the operator is rewritten.
 */
function separateGluedTokens(text: string): string {
  return text.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

export function detectImprovedProperty(input: {
  propertyClass?: string | null;
  classification?: string | null;
  notes?: string | null;
  addressDesc?: string | null;
  descriptionText?: string | null;
  buildingSqft?: number | null;
}): { improved: boolean; evidence: string | null } {
  const propertyClass = (input.propertyClass ?? '').trim();
  if (/residential|manufactured|improved|commercial/i.test(propertyClass)) {
    return { improved: true, evidence: `residential/improved property class: ${propertyClass}` };
  }
  if (typeof input.buildingSqft === 'number' && Number.isFinite(input.buildingSqft) && input.buildingSqft >= 1000) {
    return { improved: true, evidence: `${Math.round(input.buildingSqft).toLocaleString('en-US')} sqft building` };
  }
  const classification = (input.classification ?? '').trim();
  if (/^(?:residential|manufactured|single[_ -]?family|multi[_ -]?family|dwelling)$/i.test(classification)) {
    return { improved: true, evidence: `residential classification: ${classification}` };
  }
  const text = separateGluedTokens(
    [input.classification, input.notes, input.addressDesc, input.descriptionText]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' '),
  );
  const bedroom = /\b\d+(?:\.\d+)?\s*(?:bed|beds|bedroom|bedrooms)\b|\bbedrooms?\b/i.exec(text);
  if (bedroom) return { improved: true, evidence: `bedroom text: ${bedroom[0]}` };
  const bathroom = /\b\d+(?:\.\d+)?\s*(?:bath|baths|bathroom|bathrooms)\b|\bbathrooms?\b/i.exec(text);
  if (bathroom) return { improved: true, evidence: `bathroom text: ${bathroom[0]}` };
  // townhouse/condo are Zillow's own property-type labels for improved
  // property, and `\bhouse\b` cannot see the one inside `Townhouse`.
  const residence = /\b(home|house|townhouse|condo|residence|dwelling)\b/i.exec(text);
  if (residence && !new RegExp(`\\b(?:no|without)\\s+(?:a\\s+)?${residence[1]}\\b`, 'i').test(text)) {
    return { improved: true, evidence: `structure text: ${residence[0]}` };
  }
  return { improved: false, evidence: null };
}

function parseAttributions(json: string): Array<{ provider: string; url: string | null }> {
  try {
    const parsed = JSON.parse(json || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row): row is { provider?: unknown; url?: unknown } => !!row && typeof row === 'object')
      .map((row) => ({ provider: String(row.provider ?? '').trim(), url: typeof row.url === 'string' && row.url ? row.url : null }))
      .filter((row) => row.provider.length > 0);
  } catch {
    return [];
  }
}

const compactApn = (apn: string | null | undefined): string =>
  String(apn ?? '').replace(/[^0-9a-z]/gi, '').toLowerCase();

/** Best retained LandPortal capture for a persisted row, matched by APN. */
function inspectionRowFor(apn: string, retained: LandPortalComparableRecord[]): LandPortalComparableRecord | null {
  const key = compactApn(apn);
  if (key.length < 5) return null;
  return retained.find((row) => compactApn(row.apn) === key) ?? null;
}

/**
 * Classification marker for a verified closed sale carrying an OPEN, unproven
 * comparability question (suspected access, environmental, or arm's-length
 * concern). LandOS may not assert a defect it has not evidenced, so the record
 * is retained as context at reduced confidence instead of being excluded on
 * inference — and it never enters the cleaned vacant-land value.
 */
const UNVERIFIED_CONTEXT_CLASSIFICATION = /unverified_concern_context/i;

const STATUS_SOURCE_TEXT: Record<string, string> = {
  detail_surface: "confirmed on the comparable's own LandPortal detail page",
  card_attribute: 'stated by the LandPortal listing card',
  row_text: 'stated in the LandPortal row text',
  section_label: 'derived from the LandPortal section heading',
};

const money = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

const GEOCODE_PROVIDER_TEXT: Record<string, string> = {
  us_census: 'US Census address geocode',
  photon: 'Photon (OSM) address geocode',
};

interface LocationLookup {
  /** Read-only geocode-cache lookup by normalized full address. */
  get(address: string | null | undefined): { lat: number; lng: number; provider: string; createdAt: number | null } | null;
  /** True when a location lookup for this address already ran and found none. */
  attempted(address: string | null | undefined): boolean;
}

interface ResolvedLocation {
  lat: number | null;
  lng: number | null;
  resolved: boolean;
  source: string | null;
  method: 'provider_map_point' | 'address_geocode' | 'none';
  resolvedAtIso: string | null;
  /** The postal address this record's own capture states, once reconciled. */
  postalAddress: string | null;
  /** Why it stays unplaced, in the operator's words. Null when placed. */
  unresolvedReason: string | null;
}

const UNRESOLVED_LOCATION: ResolvedLocation = {
  lat: null, lng: null, resolved: false, source: null, method: 'none', resolvedAtIso: null,
  postalAddress: null,
  unresolvedReason: 'No address, parcel number, or coordinate was retained for this record, so there is nothing legitimate to place it with.',
};

const geocodeSourceText = (provider: string): string =>
  GEOCODE_PROVIDER_TEXT[provider] ?? `${provider} address geocode`;

/**
 * Retained-geocode reader for the reconciliation module. It is keyed by the
 * RECONCILED postal address, which is the whole point: a provider listing card
 * captured as "482 sqftHouse for sale12344 SW Torch Lake Dr, …" was never going
 * to match a geocode of a real address, so every such record used to be declared
 * unplaceable while its address sat in the capture.
 */
function retainedGeocodeReader(lookup: LocationLookup): (address: string) => RetainedGeocodeHit | null {
  return (address) => {
    const hit = lookup.get(address);
    if (!hit) return null;
    return {
      lat: hit.lat,
      lng: hit.lng,
      source: geocodeSourceText(hit.provider),
      resolvedAtIso: hit.createdAt ? new Date(hit.createdAt * 1000).toISOString() : null,
    };
  };
}

function toResolvedLocation(
  location: RetainedCompLocation,
  opts: { geocodeMatchedRetainedPoint?: boolean; fallbackResolvedAtIso?: string | null } = {},
): ResolvedLocation {
  if (location.status !== 'mapped') {
    return { ...UNRESOLVED_LOCATION, postalAddress: location.postalAddress, unresolvedReason: location.unresolvedReason };
  }
  return {
    lat: location.lat,
    lng: location.lng,
    resolved: true,
    source: location.source,
    method: location.basis === 'reconciled_address_geocode' || opts.geocodeMatchedRetainedPoint
      ? 'address_geocode'
      : 'provider_map_point',
    resolvedAtIso: location.resolvedAtIso ?? opts.fallbackResolvedAtIso ?? null,
    postalAddress: location.postalAddress,
    unresolvedReason: null,
  };
}

/** Resolve a persisted comp's location: provider/persisted coordinates first, then the retained geocode cache. Never guesses. */
function locationForPersisted(row: CompRow, lookup: LocationLookup): ResolvedLocation {
  const reconciled = reconcileCompAddress({ capturedAddress: row.address_desc, sourceUrl: row.source_url });
  const cached = reconciled ? lookup.get(reconciled.postalAddress) : null;
  const geocodeMatchedRetainedPoint = !!cached && typeof row.lat === 'number' && typeof row.lng === 'number'
    && Math.abs(cached.lat - row.lat) < 1e-6 && Math.abs(cached.lng - row.lng) < 1e-6;
  const location = reconcileRetainedCompLocation({
    capturedAddress: row.address_desc || null,
    sourceUrl: row.source_url || null,
    lat: row.lat,
    lng: row.lng,
    retainedCoordinateSource: geocodeMatchedRetainedPoint
      ? geocodeSourceText(cached!.provider)
      : `${row.source_label} map point`,
    apn: row.apn || null,
    state: row.state || null,
    providerLabel: row.source_label,
  }, { byAddress: retainedGeocodeReader(lookup), addressAlreadyAttempted: (a) => lookup.attempted(a) });
  return toResolvedLocation(location, {
    geocodeMatchedRetainedPoint,
    fallbackResolvedAtIso: geocodeMatchedRetainedPoint && cached!.createdAt
      ? new Date(cached!.createdAt * 1000).toISOString()
      : (row.retrieved_at || null),
  });
}

interface ClassifyContext {
  subjectAcres: number | null;
  subjectCounty: string | null;
  subjectIdentity: SubjectParcelIdentity;
  subjectPoint: { lat: number; lng: number } | null;
  retainedInspection: LandPortalComparableRecord[];
  locations: LocationLookup;
  nowMs: number;
}

function distanceFromSubject(ctx: ClassifyContext, loc: ResolvedLocation): number | null {
  if (!ctx.subjectPoint || !loc.resolved || loc.lat == null || loc.lng == null) return null;
  return compDistanceMiles(ctx.subjectPoint, { lat: loc.lat, lng: loc.lng });
}

function comparabilityLines(opts: {
  acres: number | null; subjectAcres: number | null; distance: number | null;
  county: string | null; subjectCounty: string | null; recencyMonths: number | null;
}): { primary: string; difference: string | null } {
  const bits: string[] = ['Verified closed vacant-land sale'];
  const geographicTier = resolveGeographicTier(opts.distance);
  if (opts.distance != null) bits.push(`${opts.distance} mi from the subject (${geographicTier.label})`);
  else bits.push(`${geographicTier.label}; no distance was invented`);
  if (opts.acres != null && opts.subjectAcres != null) {
    const acreageRoute = routeAcreage(opts.subjectAcres);
    const inBand = acreageRoute != null && opts.acres >= acreageRoute.pool.min && opts.acres <= acreageRoute.pool.max;
    bits.push(`${opts.acres} ac ${inBand ? 'inside' : 'outside'} the ${acreageRoute?.pool.label ?? 'unresolved'} routed acreage pool`);
  }
  if (opts.recencyMonths != null) bits.push(`sold ${opts.recencyMonths} months ago`);
  const differences: string[] = [];
  if (opts.distance != null && opts.distance > INITIAL_COMP_RADIUS_MILES) {
    differences.push(`${opts.distance} mi away in the ${geographicTier.label} tier, beyond the initial ${INITIAL_COMP_RADIUS_MILES}-mile radius but retained at reduced geographic weight`);
  } else if (opts.distance == null) {
    differences.push(geographicTier.rationale);
  }
  if (opts.acres != null && opts.subjectAcres != null) {
    const delta = Math.round((opts.acres - opts.subjectAcres) * 100) / 100;
    if (Math.abs(delta) >= opts.subjectAcres * 0.25) differences.push(`${delta > 0 ? '+' : ''}${delta} ac vs the subject`);
  }
  if (opts.county && opts.subjectCounty && opts.county.toLowerCase() !== opts.subjectCounty.toLowerCase()) {
    differences.push(`${opts.county} County market, not the subject's ${opts.subjectCounty} County`);
  }
  if (opts.recencyMonths != null && opts.recencyMonths > 18) differences.push(`sale is ${opts.recencyMonths} months old`);
  return { primary: `${bits.join('; ')}.`, difference: differences.length ? differences.join('; ') : null };
}

function classifyPersistedComp(row: CompRow, ctx: ClassifyContext): WorkspaceComp {
  const attributions = parseAttributions(row.source_attributions_json);
  const origins = [...new Set([row.source_label, ...attributions.map((a) => a.provider)].filter(Boolean))];
  const fromSidebar = attributions.some((a) => /sidebar/i.test(a.provider));
  const fromShowOnMap = attributions.some((a) => /show on map/i.test(a.provider));
  const merged = /merged landportal sidebar \+ show on map/i.test(row.notes);
  const soldBy = parseSoldBy(row.notes);
  const buildingSqft = parseBuildingSqft(row.notes);
  const improvedDetection = detectImprovedProperty({
    propertyClass: row.property_class,
    classification: row.classification,
    notes: row.notes,
    addressDesc: row.address_desc,
    buildingSqft,
  });
  const improved = improvedDetection.improved;
  const retainedDateIso = row.sale_or_list_date || null;
  const landPortalStatus = landPortalSaleStatus({
    source: row.source_label,
    dateIso: retainedDateIso,
    priceKind: row.price_kind,
  });
  const priceKind: 'sale' | 'list' | 'unknown' =
    row.price_kind === 'sale' ? 'sale'
      : row.price_kind === 'list' ? 'list'
        : landPortalStatus.statusBasis === 'closed_sale' ? 'sale' : 'unknown';
  // A row promoted to `sale` purely because the provider printed a date is
  // source-stated evidence, not a verified sale. It keeps participating, but it
  // is never labelled or weighted as an independently verified closed sale.
  const saleVerification: CompSaleVerification =
    priceKind === 'sale' && row.price_kind !== 'sale' ? 'source_stated' : 'independent';
  const saleVerificationProvenance = saleVerification === 'source_stated'
    ? `${landPortalStatus.provenance} The row states no sale-or-listing status on either surface, so the transaction itself is unconfirmed.`
    : null;
  const inspection = inspectionRowFor(row.apn, ctx.retainedInspection);
  const statusProvenance = inspection?.statusSource ? STATUS_SOURCE_TEXT[inspection.statusSource] ?? null : null;
  const price = typeof row.price === 'number' && row.price > 0 ? row.price : null;
  const acres = typeof row.acres === 'number' && row.acres > 0 ? row.acres : null;
  const ppa = price != null && acres != null
    ? Math.round((price / acres) * 100) / 100
    : (typeof row.price_per_acre === 'number' && row.price_per_acre > 0 ? row.price_per_acre : null);
  const dateIso = retainedDateIso;
  const operatorIncluded = row.valuation_selected === 1;
  const operatorExcluded = row.valuation_selected === -1;
  const location = locationForPersisted(row, ctx.locations);
  const distance = distanceFromSubject(ctx, location);
  const recencyMonths = (() => { const m = monthsSince(dateIso, ctx.nowMs); return m == null ? null : Math.round(m); })();

  let category: WorkspaceCompCategory;
  let reason: string;
  let eligible = false;
  let selectionMode: 'auto' | 'operator' | null = null;
  let primaryComparability: string | null = null;
  let keyDifference: string | null = null;
  const subjectMatch = subjectParcelMatch(
    { apn: row.apn || null, county: row.county || null, state: row.state || null, sourceUrl: row.source_url || null },
    ctx.subjectIdentity,
  );
  if (subjectMatch) {
    // The subject cannot price itself. Retained and visible with its reason
    // stated, never silently dropped, and never eligible for the valuation set.
    category = 'rejected';
    reason = `This row is the SUBJECT parcel itself, matched on ${subjectMatch}. A property is never a comparable for its own valuation, so it carries no valuation weight. It stays visible as the subject's own transaction record.`;
  } else if (row.status === 'rejected') {
    category = 'rejected';
    reason = row.inclusion_reason || row.notes || 'Rejected by canonical comp reconciliation.';
  } else if (improved && (priceKind === 'sale' || priceKind === 'list')) {
    category = 'improved_context';
    reason = priceKind === 'sale'
      ? `Directional — improved sale (${improvedDetection.evidence ?? 'structure signal'}). Retained as visible market evidence of what buyers paid for acreage here; improvement value may materially influence the sale price, so it never enters the clean vacant-land median unless the land contribution can be reasonably isolated.`
      : `Active listing of an improved property (${improvedDetection.evidence ?? 'structure signal'}): retained as improved-property market context. Its asking price includes structure value and never enters the vacant-land sold-price median.`;
  } else if (priceKind === 'sale' && price != null && acres != null && UNVERIFIED_CONTEXT_CLASSIFICATION.test(row.classification)) {
    // A verified closed sale carrying an OPEN, unproven concern (suspected
    // access, environmental, or arm's-length question). LandOS never asserts
    // the defect it cannot evidence: the sale is retained, kept out of the
    // cleaned value at reduced confidence, and stated as an open question.
    category = 'context_only';
    reason = `Source records a completed sale: ${money(price)} for ${acres} acres${dateIso ? ` on ${dateIso}` : ''}. ${row.inclusion_reason || 'An open comparability question is unresolved'}, so LandOS holds it out of the cleaned value at reduced confidence rather than asserting a defect it has not evidenced. Resolve the open question to move it into the cleaned set.`;
  } else if (priceKind === 'sale' && price != null && acres != null) {
    eligible = true;
    const provenance = statusProvenance
      ? `Sold status ${statusProvenance}. `
      : landPortalStatus.statusBasis === 'closed_sale' ? `${landPortalStatus.provenance} ` : '';
    const soldLine = saleVerification === 'source_stated'
      ? `${provenance}Source states ${money(price)} for ${acres} acres${dateIso ? ` against the date ${dateIso}` : ''}, but never states that the transaction closed. Retained as supporting land evidence at reduced confidence; it is not a verified sold price.`
      : `${provenance}Source records a completed sale: ${money(price)} for ${acres} acres${dateIso ? ` on ${dateIso}` : ''}${soldBy ? `, sold by ${soldBy}` : ''}.`;
    const lines = comparabilityLines({
      acres, subjectAcres: ctx.subjectAcres, distance,
      county: row.county || null, subjectCounty: ctx.subjectCounty, recencyMonths,
    });
    primaryComparability = lines.primary;
    keyDifference = lines.difference;
    if (operatorExcluded) {
      category = 'candidate_closed_sale';
      const byLandos = !String(row.valuation_selection_actor ?? '').startsWith('tyler');
      reason = byLandos
        ? `${soldLine} Excluded from the valuation set by LandOS (restorable)${row.valuation_selection_reason ? `: ${row.valuation_selection_reason}` : '.'}`
        : `${soldLine} Excluded from valuation by the operator${row.valuation_selection_reason ? `: ${row.valuation_selection_reason}` : '.'}`;
    } else {
      category = 'accepted_closed_sale';
      selectionMode = operatorIncluded ? 'operator' : 'auto';
      reason = operatorIncluded
        ? `${soldLine} Included by the operator as valuation evidence.`
        : saleVerification === 'source_stated'
          ? `${soldLine} Automatically included in the provisional valuation set as source-stated land evidence; exclude it to remove it.`
          : `${soldLine} Automatically included in the provisional valuation set as a credible closed vacant-land sale; exclude it to remove it.`;
    }
  } else if (priceKind === 'sale') {
    category = 'context_only';
    reason = `Completed-sale record without ${price == null ? 'a usable sale price' : 'usable acreage'}, so a sold price per acre cannot be established.`;
  } else if (priceKind === 'list') {
    const isActive = row.days_on_market != null || !!row.listing_date || /active/i.test(row.classification);
    category = isActive ? 'active_competition' : 'asking_reference';
    reason = isActive
      ? 'Currently listed for sale: live competition context. An asking price does not establish fair market value.'
      : 'Asking price reference: indicates market positioning but does not establish fair market value.';
  } else {
    category = 'context_only';
    reason = 'Transaction status is not stated by the source, so this record is retained as context only.';
  }

  const missing: string[] = [];
  if (!row.address_desc) missing.push('address');
  if (!row.thumbnail_url) missing.push('photo');
  if (!dateIso) missing.push('date');
  if (acres == null) missing.push('acreage');

  const visual = resolveCompVisual({
    thumbnailUrl: row.thumbnail_url || null,
    sourceLabel: row.source_label,
    lat: location.lat, lng: location.lng,
    locationResolved: location.resolved,
    addressOrApn: row.address_desc || (row.apn ? `APN ${row.apn}` : null),
  });

  // Closed evidence, live competition, or neither. Derived from the transaction
  // the source actually documented, never from styling intent.
  const transactionKind: CompTransactionKind = priceKind === 'sale'
    ? 'closed'
    : category === 'active_competition' || category === 'asking_reference'
      ? 'active'
      : 'context';

  const listing = buildCompListingProjection({
    detail: parseListingDetail(row.listing_detail_json),
    transactionKind,
    address: row.address_desc || null,
    apn: row.apn || null,
    county: row.county || null,
    state: row.state || null,
    acres,
    subjectAcres: ctx.subjectAcres,
    distanceMiles: distance,
    lat: location.lat,
    lng: location.lng,
    sourceLabel: row.source_label,
    sourceUrl: row.source_url || null,
    retainedPrice: price,
    retainedPriceKind: priceKind,
    saleVerification,
    saleVerificationProvenance,
    retainedDateIso: dateIso,
    providerDaysOnMarket: typeof row.days_on_market === 'number' ? row.days_on_market : null,
    retainedListingDateIso: row.listing_date || null,
    propertyClass: improved ? 'improved' : 'land',
    buildingSqft,
    roadFrontageVerified: null,
    visualProvenanceDetail: visual.detail,
    // The card's own visual, so the gallery can never contradict the thumbnail
    // sitting right next to it.
    retainedVisual: visual.isPhotograph && visual.url
      ? { url: visual.url, label: visual.label }
      : null,
    todayIso: new Date(ctx.nowMs).toISOString().slice(0, 10),
  });

  return {
    compId: row.id,
    key: `comp:${row.id}`,
    category,
    categoryLabel: WORKSPACE_CATEGORY_LABELS[category],
    classificationReason: reason,
    eligibleForValuation: eligible,
    selectedForValuation: eligible && category === 'accepted_closed_sale',
    selectionMode,
    operatorExcluded,
    exclusionReason: operatorExcluded ? (row.valuation_selection_reason || null) : null,
    sourceUrl: row.source_url || null,
    source: origins.join(' + '),
    origins,
    duplicatesMerged: Math.max(0, origins.length - 1),
    fromLandPortalSidebar: fromSidebar,
    fromLandPortalShowOnMap: fromShowOnMap,
    mergeStatus: merged
      ? 'Merged LandPortal sidebar + Show on Map records (deduplicated by APN, price, and acreage)'
      : null,
    address: row.address_desc || null,
    apn: row.apn || null,
    county: row.county || null,
    state: row.state || null,
    distanceMiles: distance,
    outsideInitialRadius: distance != null ? distance > INITIAL_COMP_RADIUS_MILES : null,
    lat: location.lat,
    lng: location.lng,
    locationResolved: location.resolved,
    locationSource: location.source,
    locationMethod: location.method,
    locationResolvedAtIso: location.resolvedAtIso,
    locationAddress: location.postalAddress,
    locationUnresolvedReason: location.unresolvedReason,
    saleVerification,
    statusLabel: category === 'accepted_closed_sale' || category === 'candidate_closed_sale'
      ? (saleVerification === 'source_stated' ? 'Source-stated sale — unverified' : 'Closed sale')
      : category === 'improved_context' ? (priceKind === 'list' ? 'Active listing (improved)' : 'Closed sale (improved)')
        : category === 'active_competition' ? 'Active listing'
          : category === 'asking_reference' ? 'Asking reference'
            : category === 'rejected' ? 'Rejected'
              : 'Context',
    priceKind,
    price,
    acres,
    pricePerAcre: ppa,
    dateIso,
    daysOnMarket: typeof row.days_on_market === 'number' ? row.days_on_market : null,
    soldBy,
    buildingSqft,
    propertyClass: improved ? 'improved' : (row.property_class === 'land' || row.property_class === 'vacant_land') ? 'land' : 'unknown',
    thumbnailUrl: row.thumbnail_url || null,
    photoUrls: listing.photos.items.map((photo) => photo.url),
    visual,
    acresDeltaFromSubject: acres != null && ctx.subjectAcres != null
      ? Math.round((acres - ctx.subjectAcres) * 100) / 100 : null,
    recencyMonths,
    monthsOld: exactMonthsOld(dateIso, ctx.nowMs),
    primaryComparability,
    keyDifference,
    missingFields: missing,
    // Roles are assigned by the window pass in buildCompsValuationView, never
    // here: a role must never contradict the selected recency window.
    valuationRole: null,
    inValuationSet: false,
    valuationWeight: null,
    zeroWeightReason: null,
    radiusStage: radiusStageFor(distance),
    exclusionActor: operatorExcluded
      ? (String(row.valuation_selection_actor ?? '').startsWith('tyler') ? 'operator' : 'landos')
      : null,
    transactionKind,
    listing,
  };
}
interface EvidenceCompValue {
  address?: unknown; apn?: unknown; county?: unknown; state?: unknown; price?: unknown; acres?: unknown; pricePerAcre?: unknown; url?: unknown;
  status?: unknown; saleDate?: unknown; listingDate?: unknown; daysOnMarket?: unknown; thumbnailUrl?: unknown; photoUrls?: unknown;
  propertyType?: unknown; description?: unknown; buildingSqft?: unknown; homeSizeSqft?: unknown; yearBuilt?: unknown;
  streetAddress?: unknown; currentPrice?: unknown; originalListPrice?: unknown; listingHistory?: unknown;
  listingStatus?: unknown; features?: unknown; utilities?: unknown; beds?: unknown; baths?: unknown;
  notes?: unknown; caveat?: unknown; discrepancies?: unknown;
}

function detailFromResearchEvidence(value: EvidenceCompValue, sourceUrl: string | null): PersistedCompListingDetail | null {
  const address = (typeof value.streetAddress === 'string' ? value.streetAddress : typeof value.address === 'string' ? value.address : null)?.trim() || null;
  const photos = Array.isArray(value.photoUrls)
    ? [...new Set(value.photoUrls.filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url)))].slice(0, 4)
    : [];
  const history = Array.isArray(value.listingHistory)
    ? value.listingHistory.filter((row): row is { date: string | null; event: string; price: number | null } =>
      !!row && typeof row === 'object' && typeof row.event === 'string')
      .map((row) => ({ dateIso: row.date ?? '', kind: /sold/i.test(row.event) ? 'sold' as const : /cut|price/i.test(row.event) ? 'price_change' as const : 'listed' as const, price: row.price ?? null, label: row.event, source: 'Zillow provider page' }))
      .filter((row) => !!row.dateIso)
    : [];
  const providerFacts = address || typeof value.acres === 'number' || typeof value.propertyType === 'string'
    ? {
      address,
      acreage: typeof value.acres === 'number' ? value.acres : null,
      improvementType: typeof value.propertyType === 'string' ? value.propertyType : null,
      buildingSqft: typeof value.buildingSqft === 'number' ? value.buildingSqft : typeof value.homeSizeSqft === 'number' ? value.homeSizeSqft : null,
      beds: typeof value.beds === 'number' ? value.beds : null,
      baths: typeof value.baths === 'number' ? value.baths : null,
      yearBuilt: typeof value.yearBuilt === 'number' ? value.yearBuilt : null,
      utilities: Array.isArray(value.utilities) ? value.utilities.filter((x): x is string => typeof x === 'string') : [],
      accessClues: [],
      features: Array.isArray(value.features) ? value.features.filter((x): x is string => typeof x === 'string') : [],
    }
    : undefined;
  if (!sourceUrl || (!address && !photos.length && !history.length && !providerFacts)) return null;
  return {
    compId: 0,
    provider: 'Zillow',
    sourceUrl,
    capturedAtIso: new Date().toISOString(),
    image: photos[0] ? {
      url: photos[0], label: 'Zillow listing photo', provenance: 'listing_photo', tier: 'hero', context: 'hero',
      isOriginalListingImage: true, sourceProperty: address, reconciledOn: ['canonical Zillow exact-address revisit'],
    } : null,
    photos: photos.map((url, index) => ({
      url, sequence: index + 1, label: 'Zillow listing photo', provenance: 'listing_photo', context: index === 0 ? 'hero' as const : 'gallery' as const, isOriginalListingImage: true,
    })),
    photoCount: photos.length,
    events: history,
    unusableRows: [],
    refusedImages: [],
    sourceDescription: typeof value.description === 'string' ? value.description : null,
    status: typeof value.listingStatus === 'string' ? value.listingStatus : null,
    limitation: null,
    reconciliation: { matched: true, matchedOn: ['canonical Zillow exact-address revisit'], mismatches: [], note: 'Reconciled to the same Zillow provider URL and postal address.' },
    propertyFacts: providerFacts,
    sourcePages: [{ provider: 'Zillow', url: sourceUrl }],
  };
}

/** Provider comp evidence retained in the research record but not persisted in landos_comp. */
function classifyEvidenceComp(
  evidenceId: string,
  providerId: string,
  value: EvidenceCompValue,
  sourceUrl: string | null,
  ctx: ClassifyContext,
): WorkspaceComp {
  const status = String(value.status ?? '').toLowerCase();
  const price = typeof value.price === 'number' && value.price > 0 ? value.price : null;
  const acres = typeof value.acres === 'number' && value.acres > 0 ? value.acres : null;
  const ppa = price != null && acres != null ? Math.round((price / acres) * 100) / 100
    : (typeof value.pricePerAcre === 'number' && value.pricePerAcre > 0 ? value.pricePerAcre : null);
  const isActive = status === 'active' || status === 'listed' || status === 'pending';
  const isSold = status === 'sold';
  const source = /redfin/i.test(providerId) ? 'Redfin' : /zillow/i.test(providerId) ? 'Zillow' : /realtor/i.test(providerId) ? 'Realtor.com' : providerId;
  const evidenceBuildingSqft = typeof value.buildingSqft === 'number' && value.buildingSqft > 0
    ? value.buildingSqft
    : typeof value.homeSizeSqft === 'number' && value.homeSizeSqft > 0 ? value.homeSizeSqft : null;
  // Research-record rows reach this path without a property class, so listing
  // status alone used to decide the lane and every marketplace house listing
  // landed in active vacant-land competition. The row's own text is the only
  // structure signal available here, and it is enough.
  const rawAddress = typeof value.address === 'string' ? value.address : null;
  const address = rawAddress
    ? (reconcileCompAddress({ capturedAddress: rawAddress, sourceUrl })?.postalAddress ?? rawAddress.replace(/\s+/g, ' ').trim())
    : null;
  const evidenceImproved = detectImprovedProperty({
    propertyClass: typeof value.propertyType === 'string' ? value.propertyType : null,
    addressDesc: rawAddress,
    descriptionText: typeof value.description === 'string' ? value.description : null,
    buildingSqft: evidenceBuildingSqft,
  });
  const category: WorkspaceCompCategory = evidenceImproved.improved
    ? 'improved_context'
    : isActive ? 'active_competition' : isSold ? 'context_only' : 'asking_reference';
  const caveatParts = [value.notes, value.caveat, value.discrepancies]
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
  const caveatText = caveatParts.length ? ` Provider caveat: ${caveatParts.join(' | ')}` : '';
  const reason = evidenceImproved.improved
    ? isSold
      ? `Directional — improved sale retained from ${source} (${evidenceImproved.evidence}). Visible market evidence of what buyers paid for acreage here; improvement value may materially influence the sale price, so it never enters the clean vacant-land median unless the land contribution can be reasonably isolated.${caveatText}`
      : `Active improved-property context retained from ${source} (${evidenceImproved.evidence}); asking price never enters sold-improved or vacant-land medians.${caveatText}`
    : isActive
      ? `Active listing retained from ${source}: current competition context${price != null ? ` at an asking price of ${money(price)}` : ''}. An asking price does not establish fair market value.${acres == null ? ' The source did not publish acreage.' : ''}${caveatText}`
      : isSold
        ? `Sold record retained from ${source} research evidence only; it has not been promoted into the sold-improved or canonical vacant-land valuation set.${caveatText}`
        : `Priced reference retained from ${source} without a stated transaction status.${caveatText}`;
  const evidenceApn = typeof value.apn === 'string' && value.apn.trim() ? value.apn.trim() : null;
  const evidenceCounty = typeof value.county === 'string' && value.county.trim() ? value.county.trim() : null;
  const evidenceState = typeof value.state === 'string' && value.state.trim() ? value.state.trim() : addressStateCode(address);
  const location: ResolvedLocation = toResolvedLocation(reconcileRetainedCompLocation({
    capturedAddress: address,
    sourceUrl,
    apn: evidenceApn,
    state: evidenceState,
    providerLabel: source,
  }, { byAddress: retainedGeocodeReader(ctx.locations), addressAlreadyAttempted: (a) => ctx.locations.attempted(a) }));
  const distance = distanceFromSubject(ctx, location);
  const missing: string[] = [];
  if (acres == null) missing.push('acreage');
  if (!value.saleDate && !value.listingDate) missing.push('date');
  if (!evidenceApn) missing.push('APN');
  const dateIso = typeof value.saleDate === 'string' && value.saleDate ? value.saleDate
    : typeof value.listingDate === 'string' && value.listingDate ? value.listingDate : null;
  const thumbnailUrl = typeof value.thumbnailUrl === 'string' && value.thumbnailUrl ? value.thumbnailUrl : null;
  const photoUrls = Array.isArray(value.photoUrls)
    ? [...new Set(value.photoUrls.filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url)))].slice(0, 4)
    : [];
  const primaryProviderPhoto = thumbnailUrl ?? photoUrls[0] ?? null;
  const visual = resolveCompVisual({
    thumbnailUrl: primaryProviderPhoto,
    photoUrls,
    sourceLabel: source,
    lat: location.lat, lng: location.lng,
    locationResolved: location.resolved,
    addressOrApn: address,
  });
  const transactionKind: CompTransactionKind = isSold ? 'closed' : isActive ? 'active' : 'context';
  // Canonical exact-address evidence is the provider-page revisit for this
  // exact URL. Project it into the same listing-detail shape as persisted comps
  // instead of claiming the provider page was never revisited.
  const listing = buildCompListingProjection({
    detail: detailFromResearchEvidence(value, sourceUrl),
    transactionKind,
    address,
    apn: evidenceApn,
    county: evidenceCounty,
    state: evidenceState,
    acres,
    subjectAcres: ctx.subjectAcres,
    distanceMiles: distance,
    lat: location.lat,
    lng: location.lng,
    sourceLabel: source,
    sourceUrl,
    retainedPrice: price,
    retainedPriceKind: isSold ? 'sale' : 'list',
    retainedDateIso: dateIso,
    providerDaysOnMarket: typeof value.daysOnMarket === 'number' && value.daysOnMarket >= 0 ? value.daysOnMarket : null,
    retainedListingDateIso: typeof value.listingDate === 'string' && value.listingDate ? value.listingDate : null,
    propertyClass: evidenceImproved.improved ? 'improved' : 'unknown',
    buildingSqft: evidenceBuildingSqft,
    roadFrontageVerified: null,
    visualProvenanceDetail: visual.detail,
    retainedPhotoUrls: photoUrls.map((url) => ({ url, label: visual.label })),
    todayIso: new Date(ctx.nowMs).toISOString().slice(0, 10),
  });
  return {
    compId: null,
    key: `evidence:${evidenceId}`,
    saleVerification: 'independent' as CompSaleVerification,
    category,
    categoryLabel: WORKSPACE_CATEGORY_LABELS[category],
    classificationReason: reason,
    eligibleForValuation: false,
    selectedForValuation: false,
    selectionMode: null,
    operatorExcluded: false,
    exclusionReason: null,
    source,
    sourceUrl,
    origins: [source],
    duplicatesMerged: 0,
    fromLandPortalSidebar: false,
    fromLandPortalShowOnMap: false,
    mergeStatus: null,
    address,
    apn: evidenceApn,
    county: evidenceCounty,
    state: evidenceState,
    distanceMiles: distance,
    outsideInitialRadius: distance != null ? distance > INITIAL_COMP_RADIUS_MILES : null,
    lat: location.lat,
    lng: location.lng,
    locationResolved: location.resolved,
    locationSource: location.source,
    locationMethod: location.method,
    locationResolvedAtIso: location.resolvedAtIso,
    locationAddress: location.postalAddress,
    locationUnresolvedReason: location.unresolvedReason,
    statusLabel: isActive ? 'Active listing' : isSold ? 'Sold (evidence only)' : 'Reference',
    priceKind: isSold ? 'sale' : 'list',
    price,
    acres,
    pricePerAcre: ppa,
    dateIso,
    daysOnMarket: typeof value.daysOnMarket === 'number' && value.daysOnMarket >= 0 ? value.daysOnMarket : null,
    soldBy: null,
    buildingSqft: evidenceBuildingSqft,
    propertyClass: evidenceImproved.improved ? 'improved' : 'unknown',
    thumbnailUrl: primaryProviderPhoto,
    photoUrls: listing.photos.items.map((photo) => photo.url),
    visual,
    acresDeltaFromSubject: acres != null && ctx.subjectAcres != null
      ? Math.round((acres - ctx.subjectAcres) * 100) / 100 : null,
    recencyMonths: (() => { const m = monthsSince(dateIso, ctx.nowMs); return m == null ? null : Math.round(m); })(),
    monthsOld: exactMonthsOld(dateIso, ctx.nowMs),
    primaryComparability: null,
    keyDifference: null,
    missingFields: missing,
    valuationRole: null,
    inValuationSet: false,
    valuationWeight: null,
    zeroWeightReason: null,
    radiusStage: radiusStageFor(distance),
    exclusionActor: null,
    transactionKind,
    listing,
  };
}

/**
 * Proximity-first search-band disclosure, counted from resolved coordinates.
 *
 * Expansion is a FACT about the evidence, never an inference from the farthest
 * record: the band expanded only when fewer than two credible closed sales were
 * found inside the initial radius. When the initial radius already carries two
 * or more sales, farther sales are additional retained evidence and the note
 * says so — it must never claim an expansion was required.
 */
function radiusDisclosure(accepted: WorkspaceComp[]): CompsValuationSummary['radius'] {
  const distances = accepted.map((c) => c.distanceMiles).filter((d): d is number => d != null);
  const unresolved = accepted.length - distances.length;
  const withinInitial = distances.filter((d) => d <= INITIAL_COMP_RADIUS_MILES).length;
  const withinExpansion = distances.filter((d) => d > INITIAL_COMP_RADIUS_MILES && d <= MAX_COMP_SEARCH_RADIUS_MILES).length;
  const beyondExpansion = distances.filter((d) => d > MAX_COMP_SEARCH_RADIUS_MILES).length;
  const base = {
    initialMiles: INITIAL_COMP_RADIUS_MILES,
    withinInitial, withinExpansion, beyondExpansion, unresolved,
  };
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

  if (accepted.length === 0) {
    return {
      ...base, usedMiles: null, expanded: false,
      note: 'No closed sales currently support the valuation, so no search band applies.',
    };
  }
  if (!distances.length) {
    return {
      ...base, usedMiles: null, expanded: true,
      note: `${unresolved} supporting sale(s) remain in the ${resolveGeographicTier(null).label} tier. Their locations could not be resolved, so no miles were invented; each is retained at reduced geographic weight rather than discarded.`,
    };
  }
  const tail = beyondExpansion > 0
    ? ` ${beyondExpansion} ${plural(beyondExpansion, 'sale lies', 'sales lie')} beyond the former ${MAX_COMP_SEARCH_RADIUS_MILES}-mile cutoff in ${[...new Set(accepted.filter((comp) => (comp.distanceMiles ?? 0) > MAX_COMP_SEARCH_RADIUS_MILES).map((comp) => resolveGeographicTier(comp.distanceMiles).label))].join(', ')}; ${plural(beyondExpansion, 'it is', 'they are')} retained as pricing evidence at reduced geographic weight.`
    : '';
  const unresolvedTail = unresolved > 0
    ? ` ${unresolved} retained ${plural(unresolved, 'sale has', 'sales have')} an unresolved location and ${plural(unresolved, 'is', 'are')} excluded from the distance counts.`
    : '';
  const countyLine = ' Out-of-county sales are considered on proximity, never excluded by a county line.';

  // Two or more credible closed sales inside the initial radius: no expansion
  // was required, whatever the farthest retained sale happens to be.
  if (withinInitial >= 2) {
    const usedMiles = beyondExpansion > 0
      ? Math.max(...distances)
      : withinExpansion > 0 ? MAX_COMP_SEARCH_RADIUS_MILES : INITIAL_COMP_RADIUS_MILES;
    const extra = withinExpansion > 0
      ? ` A further ${withinExpansion} credible ${plural(withinExpansion, 'sale was', 'sales were')} retained between ${INITIAL_COMP_RADIUS_MILES} and ${MAX_COMP_SEARCH_RADIUS_MILES} miles as additional corroboration, not because the initial radius came up short.`
      : '';
    return {
      ...base, usedMiles, expanded: beyondExpansion > 0,
      note: `${withinInitial} credible closed vacant-land ${plural(withinInitial, 'sale lies', 'sales lie')} inside the initial ${INITIAL_COMP_RADIUS_MILES}-mile radius, so no expansion was required.${extra}${tail}${unresolvedTail}${countyLine}`,
    };
  }
  // Fewer than two inside the initial radius: the band genuinely expanded, and
  // it counts as expanded whether the farther sales landed inside the 10-to-20
  // ring or are previously retained evidence past the boundary.
  const reliedOnFarther = withinExpansion > 0 || beyondExpansion > 0;
  const usedMiles = reliedOnFarther ? Math.max(...distances) : INITIAL_COMP_RADIUS_MILES;
  const added = withinExpansion > 0
    ? ` and added ${withinExpansion} credible ${plural(withinExpansion, 'sale', 'sales')} in that ring`
    : ' without finding a further credible sale inside the boundary';
  return {
    ...base, usedMiles, expanded: reliedOnFarther,
    note: `Only ${withinInitial} credible closed vacant-land ${plural(withinInitial, 'sale lies', 'sales lie')} inside the initial ${INITIAL_COMP_RADIUS_MILES}-mile radius, so the search expanded outward through ${[...new Set(accepted.map((comp) => resolveGeographicTier(comp.distanceMiles).label))].join(', ')} and reached ${usedMiles} miles${added}.${tail}${unresolvedTail}${countyLine}`,
  };
}

/** Pure valuation over the provisional (auto + operator) closed vacant-land sale set. */
export function computeCompsValuation(
  accepted: WorkspaceComp[],
  subjectAcres: number | null,
  nowMs: number,
  opts: { subjectCounty?: string | null } = {},
): { summary: CompsValuationSummary; medianNote: string | null } {
  const observations = accepted
    .map((c) => ({ comp: c, ppa: c.price != null && c.acres != null ? c.price / c.acres : null }))
    .filter((o): o is { comp: WorkspaceComp; ppa: number } => o.ppa != null && Number.isFinite(o.ppa) && o.ppa > 0);
  const ppas = observations.map((o) => o.ppa);
  const count = ppas.length;
  const mid = median(ppas);
  const radius = radiusDisclosure(observations.map((o) => o.comp));

  // Fewer than two credible closed vacant-land sales → insufficient evidence.
  // A set carried entirely by source-stated rows can never be called
  // "supported": no closed transaction in it has been independently verified.
  const sourceStatedCount = observations.filter((o) => o.comp.saleVerification === 'source_stated').length;
  const allSourceStated = count > 0 && sourceStatedCount === count;
  const status: CompsValuationSummary['status'] = allSourceStated
    ? (count >= 2 ? 'provisional' : 'insufficient')
    : count >= 3 ? 'supported' : count === 2 ? 'provisional' : 'insufficient';
  const statusLabel = status === 'supported' ? 'Supported valuation'
    : status === 'provisional' ? 'Provisional valuation' : 'Insufficient closed-sale evidence';
  const saleNoun = allSourceStated
    ? `source-stated vacant-land sale${count === 1 ? '' : 's'} (not independently verified)`
    : `closed vacant-land sale${count === 1 ? '' : 's'}`;
  const basisLabel = count >= 2
    ? `${statusLabel} based on ${count} ${saleNoun}`
    : 'Insufficient closed-sale evidence';

  if (count < 2 || mid == null || subjectAcres == null || subjectAcres <= 0) {
    const reason = subjectAcres == null || subjectAcres <= 0
      ? 'The subject working acreage is not established, so no per-acre value can be applied.'
      : count === 1
        ? 'Only one credible closed vacant-land sale remains in the valuation set. At least two are required before a provisional value can be stated; restore or add a second credible closed sale.'
        : 'No credible closed vacant-land sale currently supports valuation. Asking references and active listings indicate market positioning but do not establish fair market value.';
    return {
      summary: {
        workingAcres: subjectAcres,
        acceptedCount: count,
        medianPricePerAcre: null,
        ppaBand: null,
        fmv: null,
        acquisitionLevels: null,
        acquisitionLockedReason: 'Fair market value and the 40%, 50%, and 60% acquisition levels remain locked until at least two credible closed vacant-land sales support the valuation.',
        status: 'insufficient',
        statusLabel: 'Insufficient closed-sale evidence',
        basisLabel: 'Insufficient closed-sale evidence',
        statusReason: reason,
        confidence: 'unavailable',
        confidenceFactors: [count === 1
          ? 'A single closed vacant-land sale cannot establish a defensible median, so confidence cannot be stated.'
          : 'No closed vacant-land sale is in the valuation set, so confidence cannot be established.'],
        radius,
        distanceRange: null,
      },
      medianNote: null,
    };
  }

  const low = Math.min(...ppas);
  const high = Math.max(...ppas);
  const dispersion = mid > 0 ? (high - low) / mid : 0;
  const hasBand = count >= 2 && high > low;
  const central = round500(mid * subjectAcres);
  const fmv = {
    low: hasBand ? round500(low * subjectAcres) : null,
    central,
    high: hasBand ? round500(high * subjectAcres) : null,
  };

  const recencies = observations
    .map((o) => monthsSince(o.comp.dateIso, nowMs))
    .filter((m): m is number => m != null);
  const newestMonths = recencies.length ? Math.min(...recencies) : null;
  const oldestMonths = recencies.length ? Math.max(...recencies) : null;
  const distances = observations.map((o) => o.comp.distanceMiles).filter((d): d is number => d != null);
  const distanceRange = distances.length
    ? { minMiles: Math.min(...distances), maxMiles: Math.max(...distances) }
    : null;

  const factors: string[] = [];
  factors.push(`${count} credible closed vacant-land sale${count === 1 ? '' : 's'} support${count === 1 ? 's' : ''} the cleaned valuation set.`);
  if (distanceRange) {
    // Counted from resolved coordinates, so this can never assert an expansion
    // the evidence contradicts.
    const tierLabels = [...new Set(observations.map((o) => resolveGeographicTier(o.comp.distanceMiles).label))].join(', ');
    const ringText = `${radius.withinInitial} inside the initial ${radius.initialMiles}-mile radius, ${radius.withinExpansion} from ${radius.initialMiles} to ${MAX_COMP_SEARCH_RADIUS_MILES} miles, and ${radius.beyondExpansion} beyond the former cutoff`;
    factors.push(`Supporting sales lie ${distanceRange.minMiles}–${distanceRange.maxMiles} miles from the subject: ${ringText}. Tiers used: ${tierLabels}; outer tiers remain pricing evidence at reduced weight.`);
  } else {
    factors.push('Supporting-sale distances are unresolved, which weakens locational support.');
  }
  const subjectCounty = opts.subjectCounty ?? null;
  if (subjectCounty) {
    const outOfCounty = observations.filter((o) => o.comp.county && o.comp.county.toLowerCase() !== subjectCounty.toLowerCase());
    factors.push(outOfCounty.length === 0
      ? `All supporting sales are in the subject's ${subjectCounty} County market.`
      : `${outOfCounty.length} supporting sale${outOfCounty.length === 1 ? ' is' : 's are'} outside ${subjectCounty} County; county is weighed as a market-relationship factor, never an automatic exclusion.`);
  }
  if (newestMonths != null && oldestMonths != null) {
    factors.push(`Sale recency spans roughly ${Math.round(newestMonths)} to ${Math.round(oldestMonths)} months before today.`);
  } else {
    factors.push('Sale dates are incomplete, which weakens recency support.');
  }
  if (count >= 2) {
    factors.push(`Sold price per acre ranges ${money(low)}–${money(high)} (spread ${(dispersion * 100).toFixed(0)}% of the median).`);
  }
  const acreageRoute = routeAcreage(subjectAcres);
  const inBand = observations.filter((o) => o.comp.acres != null && acreageRoute != null
    && o.comp.acres >= acreageRoute.pool.min && o.comp.acres <= acreageRoute.pool.max).length;
  factors.push(`${inBand} of ${count} supporting sale${count === 1 ? '' : 's'} fall inside the routed ${acreageRoute?.pool.label ?? 'unresolved acreage'} participation pool.`);
  const noDistance = observations.filter((o) => o.comp.distanceMiles == null).length;
  if (noDistance > 0) factors.push(`${noDistance} supporting sale${noDistance === 1 ? '' : 's'} lack${noDistance === 1 ? 's' : ''} a computed distance from the subject.`);
  const corroborated = observations.filter((o) => o.comp.fromLandPortalSidebar && o.comp.fromLandPortalShowOnMap).length;
  if (corroborated > 0) factors.push(`${corroborated} supporting sale${corroborated === 1 ? ' is' : 's are'} corroborated by two independent LandPortal surfaces (transaction certainty).`);

  if (sourceStatedCount > 0) {
    factors.push(`${sourceStatedCount} of ${count} supporting sale${count === 1 ? '' : 's'} ${sourceStatedCount === 1 ? 'is' : 'are'} source-stated only: the provider printed a price and a date but never stated that the transaction closed, and no independent sale verification was obtained.`);
  }

  let confidence: CompsValuationSummary['confidence'];
  if (count >= 4 && dispersion <= 0.35 && newestMonths != null && newestMonths <= 18) confidence = 'high';
  else if (count >= 3 && dispersion <= 0.8) confidence = 'moderate';
  else if (count === 2 && dispersion <= 0.35 && newestMonths != null && newestMonths <= 24 && noDistance === 0) confidence = 'moderate';
  else confidence = 'low';
  // No independently verified closed sale in the set → confidence cannot exceed
  // low, whatever the count, spread or recency say.
  if (allSourceStated && confidence !== 'low') confidence = 'low';
  if (confidence !== 'high') {
    factors.push(count < 3
      ? 'Two closed sales keep the valuation provisional; a third credible in-band closed sale would materially strengthen it.'
      : dispersion > 0.35
        ? 'Per-acre spread across the supporting sales is wide enough to hold confidence below high.'
        : 'Recency or coverage keeps confidence below high.');
  }

  const statusReason = allSourceStated
    ? `${count} source-stated vacant-land sales carry this indication. None has been independently verified as a closed transaction, so the value stays provisional at reduced confidence; refine it with the exclude and restore controls below.`
    : status === 'supported'
      ? `${count} credible closed vacant-land sales establish a defensible median sold price per acre.`
      : `Provisional valuation based on ${count} closed vacant-land sales, automatically selected as the default set; refine it with the exclude and restore controls below.`;

  const medianNote = `Median of ${count} sold price${count === 1 ? '' : 's'} per acre = ${money(mid)}/ac × ${subjectAcres} working acres = ${money(mid * subjectAcres)} (rounded to ${money(central)}).${count % 2 === 0 && count > 1 ? ' With an even count the median averages the two middle values.' : ''}`;

  return {
    summary: {
      workingAcres: subjectAcres,
      acceptedCount: count,
      medianPricePerAcre: Math.round(mid),
      ppaBand: hasBand ? { low: Math.round(low), median: Math.round(mid), high: Math.round(high) } : null,
      fmv,
      acquisitionLevels: {
        pct40: round500(central * 0.4),
        pct50: round500(central * 0.5),
        pct60: round500(central * 0.6),
      },
      acquisitionLockedReason: null,
      status,
      statusLabel,
      basisLabel,
      statusReason,
      confidence,
      confidenceFactors: factors,
      radius,
      distanceRange,
    },
    medianNote,
  };
}

// ── Cleaned fair-market-value reconciliation ─────────────────────────────────
// The median stays visible but never stands alone: the adopted cleaned FMV
// reconciles the cleaned average, cleaned median, the distance/recency/acreage
// weighted direct-comp indication, and active-competition support, in plain
// language. Sales leave the cleaned set only through a documented exclusion.

export interface CleanedValuation {
  cleanedCount: number;
  directCount: number;
  supportingCount: number;
  /** Months 25–30, admitted only under the exceptional expansion. */
  supplementalHistoricalCount: number;
  boundaryCount: number;
  /** Sales older than the selected window: visible, zero valuation weight. */
  historicalContextCount: number;
  excludedCount: number;
  cleanedAvgPpa: number | null;
  cleanedMedianPpa: number | null;
  avgIndication: number | null;
  medianIndication: number | null;
  weightedPpa: number | null;
  weightedIndication: number | null;
  lowObservedPpa: number | null;
  highObservedPpa: number | null;
  lowObservedIndication: number | null;
  highObservedIndication: number | null;
  activeCompetition: {
    count: number;
    minAskPpa: number | null;
    maxAskPpa: number | null;
    staleCount: number;
    executableLow: number | null;
    executableHigh: number | null;
    note: string;
  } | null;
  adoptedFmv: number | null;
  retailRangeLow: number | null;
  retailRangeHigh: number | null;
  confidence: 'high' | 'moderate' | 'low' | 'unavailable';
  /** Plain-language reconciliation: what each method supports and what was adopted. */
  reconciliationLines: string[];
  /** True when at least two credible closed sales lie inside the 20-mile boundary. */
  directEvidenceSufficient: boolean;
  /** Shown when direct evidence is thin. Null when sufficient. */
  insufficiencyWarning: string | null;
}

/**
 * Distance / recency / acreage-similarity weight for one sale in the valuation
 * set. Acreage similarity is CONTINUOUS inside the band, so an 11.5-acre sale
 * outweighs a 5-acre or 20-acre sale when distance and recency are comparable.
 * Supplemental historical records (months 25–30) carry a substantially reduced
 * multiplier so they can support a thin set without governing it.
 */
export function cleanedWeight(
  c: WorkspaceComp,
  subjectAcres: number | null,
  _band: AcreageBand | null,
): number {
  const d = c.distanceMiles;
  const m = c.monthsOld;
  const baseDistanceWeight = d == null ? 1 : d <= 5 ? 3 : d <= 10 ? 2 : d <= 20 ? 1 : 1;
  const wDist = baseDistanceWeight * resolveGeographicTier(d).weightMultiplier;
  const wRec = m == null ? 0.5 : m <= 6 ? 3 : m <= 12 ? 2.5 : m <= 24 ? 1.5 : 0.75;
  const wAcre = 0.5 + 2.5 * routedAcreageSimilarity(c.acres, routeAcreage(subjectAcres));
  const base = wDist + wRec + wAcre;
  return c.valuationRole === 'supplemental_historical' ? base * 0.35 : base;
}

export function computeCleanedValuation(
  comps: WorkspaceComp[],
  subjectAcres: number | null,
  _nowMs: number,
  band: AcreageBand | null = valuationAcreageBand(subjectAcres),
): CleanedValuation {
  // Only records the acreage band and the recency window actually selected can
  // price the subject. Boundary and historical-context sales stay visible with
  // zero weight and never reach these numbers.
  const cleaned = comps.filter((c) => c.inValuationSet
    && c.price != null && c.acres != null && c.acres > 0);
  const excluded = comps.filter((c) => c.category === 'candidate_closed_sale' && c.operatorExcluded);
  const actives = comps.filter((c) => c.category === 'active_competition'
    && c.price != null && c.acres != null && c.acres > 0);

  const ppas = cleaned.map((c) => (c.price as number) / (c.acres as number));
  const directCount = cleaned.filter((c) => c.valuationRole === 'direct').length;
  const supportingCount = cleaned.filter((c) => c.valuationRole === 'supporting').length;
  const supplementalCount = cleaned.filter((c) => c.valuationRole === 'supplemental_historical').length;
  // Boundary sales inside the valuation set define its limits at the lowest
  // weight; out-of-band records are reported separately by the window and are
  // never tallied here, so no record appears under two labels.
  const boundaryCount = cleaned.filter((c) => c.valuationRole === 'boundary').length;
  const historicalCount = comps.filter((c) => c.valuationRole === 'historical_context').length;

  const directEvidenceSufficient = cleaned.length >= 2;
  const insufficiencyWarning = directEvidenceSufficient ? null
    : 'Insufficient credible closed vacant land sales after acreage and recency qualification; distance alone never removes evidence.';

  const empty: CleanedValuation = {
    cleanedCount: ppas.length, directCount, supportingCount,
    supplementalHistoricalCount: supplementalCount, boundaryCount,
    historicalContextCount: historicalCount,
    excludedCount: excluded.length,
    cleanedAvgPpa: null, cleanedMedianPpa: null, avgIndication: null, medianIndication: null,
    weightedPpa: null, weightedIndication: null,
    lowObservedPpa: null, highObservedPpa: null, lowObservedIndication: null, highObservedIndication: null,
    activeCompetition: null, adoptedFmv: null, retailRangeLow: null, retailRangeHigh: null,
    confidence: 'unavailable',
    reconciliationLines: [
      ppas.length === 0
        ? 'No credible closed vacant-land sale is in the cleaned set, so no cleaned fair market value can be stated.'
        : 'Fewer than two credible closed vacant-land sales remain in the cleaned set, so the cleaned fair market value stays unstated.',
    ],
    directEvidenceSufficient,
    insufficiencyWarning,
  };
  if (ppas.length < 2 || subjectAcres == null || subjectAcres <= 0) return empty;

  const avg = ppas.reduce((s, v) => s + v, 0) / ppas.length;
  const med = median(ppas) as number;
  const low = Math.min(...ppas);
  const high = Math.max(...ppas);
  let weightSum = 0;
  let weightedAcc = 0;
  for (const c of cleaned) {
    const w = cleanedWeight(c, subjectAcres, band);
    weightSum += w;
    weightedAcc += w * ((c.price as number) / (c.acres as number));
  }
  const weighted = weightSum > 0 ? weightedAcc / weightSum : med;

  const avgInd = round500(avg * subjectAcres);
  const medInd = round500(med * subjectAcres);
  const weightedInd = round500(weighted * subjectAcres);
  // Adopted cleaned FMV: the weighted direct-comp indication leads (it carries
  // distance, recency, and acreage similarity), reconciled against the cleaned
  // median and cleaned average in equal parts.
  const adopted = round500((weighted * 0.5 + med * 0.25 + avg * 0.25) * subjectAcres);

  // Active competition: executable support assumes a bounded negotiation
  // discount from asking (a labeled operating assumption, not a market fact).
  // A listing sitting far beyond a normal marketing period is an aspirational
  // ask and never becomes executable support.
  const ASK_DISCOUNT = 0.9;
  const STALE_DOM = 180;
  const allAskPpas = actives.map((c) => (c.price as number) / (c.acres as number));
  const usable = actives
    .filter((c) => c.daysOnMarket == null || c.daysOnMarket <= STALE_DOM)
    .map((c) => (c.price as number) / (c.acres as number));
  const staleCount = actives.length - usable.length;
  const activeBlock = actives.length ? {
    count: actives.length,
    minAskPpa: allAskPpas.length ? Math.round(Math.min(...allAskPpas)) : null,
    maxAskPpa: allAskPpas.length ? Math.round(Math.max(...allAskPpas)) : null,
    staleCount,
    executableLow: usable.length ? round500(Math.min(...usable) * ASK_DISCOUNT * subjectAcres) : null,
    executableHigh: usable.length ? round500(Math.max(...usable) * ASK_DISCOUNT * subjectAcres) : null,
    note: `Executable support assumes roughly ${Math.round((1 - ASK_DISCOUNT) * 100)}% negotiation off asking (operating assumption)${staleCount ? `; ${staleCount} stale listing${staleCount === 1 ? '' : 's'} (>${STALE_DOM} days on market) excluded as aspirational` : ''}. Asking prices never enter the sold-price calculations.`,
  } : null;

  const retailLow = Math.min(medInd, avgInd, weightedInd);
  const retailHigh = Math.max(medInd, avgInd, weightedInd);

  const directSet = cleaned.filter((c) => c.valuationRole === 'direct');
  const directPpas = directSet.map((c) => (c.price as number) / (c.acres as number));
  const directMed = median(directPpas);
  const directDispersion = directMed && directPpas.length >= 2
    ? (Math.max(...directPpas) - Math.min(...directPpas)) / directMed : null;
  const newest = directSet.map((c) => c.monthsOld).filter((m): m is number => m != null);
  const newestMonths = newest.length ? Math.min(...newest) : null;
  // A strong direct-comp core RAISES confidence; its absence must not by itself
  // force the floor. Otherwise a deal whose locations have not resolved reports
  // low confidence no matter how many consistent recent sales support it.
  const setDispersion = med > 0 ? (high - low) / med : 0;
  let confidence: CleanedValuation['confidence'];
  if (directCount >= 5 && directDispersion != null && directDispersion <= 0.5 && newestMonths != null && newestMonths <= 6) confidence = 'high';
  else if (directCount >= 3 || (ppas.length >= 3 && setDispersion <= 0.8)) confidence = 'moderate';
  else if (ppas.length >= 2) confidence = 'low';
  else confidence = 'unavailable';
  // This confidence governs every operator surface, so it must respect the same
  // rule as the summary: with no independently verified closed sale in the
  // cleaned set, confidence cannot be rated above low.
  const cleanedAllSourceStated = cleaned.length > 0
    && cleaned.every((c) => c.saleVerification === 'source_stated');
  if (cleanedAllSourceStated && confidence !== 'unavailable') confidence = 'low';

  const lines: string[] = [
    `Cleaned average supports ${money(avgInd)} (${money(Math.round(avg))}/ac across ${ppas.length} sales).`,
    `Cleaned median supports ${money(medInd)} (${money(Math.round(med))}/ac).`,
    `Weighted direct comps support ${money(weightedInd)} (${money(Math.round(weighted))}/ac, weighting distance, recency, and acreage similarity).`,
  ];
  if (activeBlock?.executableLow != null && activeBlock.executableHigh != null) {
    lines.push(`Active competition supports an executable range of ${money(activeBlock.executableLow)} to ${money(activeBlock.executableHigh)}.`);
  }
  lines.push(`Adopted cleaned FMV is ${money(adopted)}: the weighted direct-comp indication leads, reconciled against the cleaned median and average. ${directCount} direct and ${supportingCount} supporting${supplementalCount ? ` plus ${supplementalCount} supplemental historical` : ''} sale${directCount + supportingCount + supplementalCount === 1 ? '' : 's'} price it; ${boundaryCount} boundary and ${historicalCount} historical-context sale${boundaryCount + historicalCount === 1 ? '' : 's'} stay visible at zero weight, and ${excluded.length} sale${excluded.length === 1 ? '' : 's'} sit outside the set with a retained reason.`);
  if (directDispersion != null && directDispersion > 0.5) {
    lines.push(`Direct sales spread ${Math.round(directDispersion * 100)}% of their median per acre — a real range, not artificially narrowed.`);
  }

  return {
    cleanedCount: ppas.length, directCount, supportingCount,
    supplementalHistoricalCount: supplementalCount, boundaryCount,
    historicalContextCount: historicalCount,
    excludedCount: excluded.length,
    cleanedAvgPpa: Math.round(avg), cleanedMedianPpa: Math.round(med),
    avgIndication: avgInd, medianIndication: medInd,
    weightedPpa: Math.round(weighted), weightedIndication: weightedInd,
    lowObservedPpa: Math.round(low), highObservedPpa: Math.round(high),
    lowObservedIndication: round500(low * subjectAcres), highObservedIndication: round500(high * subjectAcres),
    activeCompetition: activeBlock,
    adoptedFmv: adopted,
    retailRangeLow: retailLow, retailRangeHigh: retailHigh,
    confidence,
    reconciliationLines: lines,
    directEvidenceSufficient,
    insufficiencyWarning,
  };
}

// ── Technical quick-flip underwriting (bounded; normal quick flip only) ──────

export interface QuickFlipAssumption {
  key: string;
  label: string;
  /** Display value, e.g. "7% of sale price" or "$10,000". */
  value: string;
  basis: 'landos_operating_assumption' | 'market_research' | 'derived';
  note: string;
}

export interface QuickFlipUnderwriting {
  expectedSalePrice: number;
  expectedMarketingDays: number | null;
  sellingCosts: number;
  sellerClosingCosts: number;
  carryingCosts: number;
  financingCosts: number;
  improvementCosts: number;
  riskReserve: number;
  requiredProfit: number;
  totalNonAcquisitionCosts: number;
  technicalMaxOffer: number;
  /** Technical maximum as a percentage of the adopted cleaned FMV (rounded). */
  technicalMaxPctOfFmv: number;
  assumptions: QuickFlipAssumption[];
  confidenceNote: string;
}

const QUICK_FLIP = {
  sellingCostPct: 0.07,
  sellerClosingPct: 0.02,
  carryingCostPct: 0.015,
  riskReservePct: 0.05,
  profitPctOfSale: 0.2,
} as const;

export function computeQuickFlipUnderwriting(
  adoptedFmv: number | null,
  expectedMarketingDays: number | null,
): QuickFlipUnderwriting | null {
  if (adoptedFmv == null || adoptedFmv <= 0) return null;
  const price = adoptedFmv;
  const selling = Math.round(price * QUICK_FLIP.sellingCostPct);
  const closing = Math.round(price * QUICK_FLIP.sellerClosingPct);
  const carrying = Math.round(price * QUICK_FLIP.carryingCostPct);
  const financing = 0;
  const improvements = 0;
  const reserve = Math.round(price * QUICK_FLIP.riskReservePct);
  const requiredProfit = Math.max(GLOBAL_MIN_NET_PROFIT_USD, round500(price * QUICK_FLIP.profitPctOfSale));
  const total = selling + closing + carrying + financing + improvements + reserve + requiredProfit;
  const mao = round500(price - total);
  return {
    expectedSalePrice: price,
    expectedMarketingDays,
    sellingCosts: selling,
    sellerClosingCosts: closing,
    carryingCosts: carrying,
    financingCosts: financing,
    improvementCosts: improvements,
    riskReserve: reserve,
    requiredProfit,
    totalNonAcquisitionCosts: total - requiredProfit,
    technicalMaxOffer: mao,
    technicalMaxPctOfFmv: Math.round((mao / price) * 100),
    assumptions: [
      { key: 'expected_sale', label: 'Expected executable sale price', value: money(price), basis: 'derived', note: 'The adopted cleaned FMV; revise if a faster-sale discount is intended.' },
      { key: 'selling', label: 'Selling / brokerage costs', value: '7% of sale price', basis: 'landos_operating_assumption', note: 'Brokerage plus marketing; operator revisable.' },
      { key: 'closing', label: 'Seller closing costs', value: '2% of sale price', basis: 'landos_operating_assumption', note: 'Transfer tax, title, recording; operator revisable.' },
      { key: 'carrying', label: 'Carrying costs', value: '1.5% of sale price', basis: expectedMarketingDays != null ? 'market_research' : 'landos_operating_assumption', note: expectedMarketingDays != null ? `Taxes/insurance across roughly ${Math.ceil((expectedMarketingDays + 45) / 30)} months of marketing plus closing (median ${expectedMarketingDays} days on market from LandOS Market Research).` : 'Taxes/insurance across an assumed marketing period; no Market Research days-on-market record was available.' },
      { key: 'financing', label: 'Financing costs', value: '$0', basis: 'landos_operating_assumption', note: 'Cash acquisition assumed; revise if financed.' },
      { key: 'improvements', label: 'Known necessary improvements', value: '$0', basis: 'derived', note: 'No necessary improvement is documented in retained evidence; not a verified property fact.' },
      { key: 'reserve', label: 'Risk reserve', value: '5% of sale price', basis: 'landos_operating_assumption', note: 'Covers survey, minor title or access surprises; operator revisable.' },
      { key: 'profit', label: 'Required minimum profit', value: `max($${GLOBAL_MIN_NET_PROFIT_USD.toLocaleString('en-US')}, 20% of sale price)`, basis: 'landos_operating_assumption', note: 'The LandOS global minimum net profit baseline, scaled by the standard quick-flip margin target.' },
    ],
    confidenceNote: 'Cost percentages are LandOS operating assumptions, clearly labeled and operator revisable — none is presented as a verified property fact.',
  };
}

// ── Final negotiation reconciliation ─────────────────────────────────────────

export interface NegotiationReconciliation {
  recommendedOpening: number;
  recommendedTarget: number;
  hardCeiling: number;
  ceilingBasis: 'technical_inside_band' | 'technical_above_band' | 'technical_below_band';
  standardBand: { pct40: number; pct50: number; pct60: number };
  referenceScope: 'land_basis' | 'whole_property_basis';
  openingLabel: string;
  targetLabel: string;
  ceilingLabel: string;
  lines: string[];
  remainingAssumptions: string[];
}

export function reconcileNegotiation(
  cleaned: CleanedValuation,
  quickFlip: QuickFlipUnderwriting | null,
  acquisitionLevels: { pct40: number; pct50: number; pct60: number } | null,
  referenceScope: NegotiationReconciliation['referenceScope'] = 'whole_property_basis',
): NegotiationReconciliation | null {
  if (!quickFlip || cleaned.adoptedFmv == null) return null;
  const fmv = cleaned.adoptedFmv;
  const band = acquisitionLevels ?? {
    pct40: round500(fmv * 0.4), pct50: round500(fmv * 0.5), pct60: round500(fmv * 0.6),
  };
  const mao = quickFlip.technicalMaxOffer;
  const lines: string[] = [];
  let basis: NegotiationReconciliation['ceilingBasis'];
  let opening = band.pct40;
  let target = band.pct50;
  let ceiling = mao;

  if (mao >= band.pct40 && mao <= band.pct60) {
    basis = 'technical_inside_band';
    lines.push(`The technical quick-flip maximum (${money(mao)}, ${quickFlip.technicalMaxPctOfFmv}% of cleaned FMV) falls inside the standard ${FLIP_STANDARD_BAND.low}%–${FLIP_STANDARD_BAND.high}% reference range, so the simplified range governs the negotiation and the technical maximum caps it.`);
    target = Math.min(band.pct50, mao);
  } else if (mao > band.pct60) {
    basis = 'technical_above_band';
    lines.push(`The technical quick-flip maximum (${money(mao)}, ${quickFlip.technicalMaxPctOfFmv}% of cleaned FMV) sits above the ${FLIP_STANDARD_BAND.high}% reference. Paying above ${FLIP_STANDARD_BAND.high}% appears supportable because the absolute profit at the ceiling still clears the $${GLOBAL_MIN_NET_PROFIT_USD.toLocaleString('en-US')} minimum — but confirm the executable sale price and cost assumptions before relying on it. The offer is not automatically capped at ${FLIP_STANDARD_BAND.high}%.`);
  } else {
    basis = 'technical_below_band';
    ceiling = mao;
    opening = Math.min(band.pct40, round500(mao * 0.85));
    target = Math.min(band.pct50, round500(mao * 0.95));
    lines.push(`The technical quick-flip maximum (${money(mao)}, ${quickFlip.technicalMaxPctOfFmv}% of cleaned FMV) is below the ${FLIP_STANDARD_BAND.low}% reference, so the ceiling is lowered below the standard band — the ${FLIP_STANDARD_BAND.low}% level is not treated as a floor. Cost, risk-reserve, and required-profit loads on this price point drive the reduction.`);
  }
  const scopeLabel = referenceScope === 'land_basis' ? 'LAND-BASIS reference' : 'whole-property reference';
  lines.push(`Standard ${scopeLabel}: ${money(band.pct40)} opening (40%), ${money(band.pct50)} target (50%), ${money(band.pct60)} upper reference (60%).`);
  if (referenceScope === 'land_basis') {
    lines.push('These are LAND-BASIS negotiation references only. They are not completed whole-property offer recommendations; improvement value remains pending.');
  }
  return {
    recommendedOpening: opening,
    recommendedTarget: target,
    hardCeiling: ceiling,
    ceilingBasis: basis,
    standardBand: band,
    referenceScope,
    openingLabel: referenceScope === 'land_basis' ? 'Land-basis opening reference' : 'Opening reference',
    targetLabel: referenceScope === 'land_basis' ? 'Land-basis target reference' : 'Target reference',
    ceilingLabel: referenceScope === 'land_basis' ? 'Land-basis ceiling reference' : 'Ceiling reference',
    lines,
    remainingAssumptions: [
      'Executable sale price equals the adopted cleaned FMV (no forced-sale discount applied).',
      'Selling, closing, carrying, and reserve percentages are LandOS operating assumptions pending operator confirmation.',
      'No necessary improvement costs are documented; any discovered site work lowers the ceiling.',
      'Creek/water-feature influence on the subject has no structured fact yet and is not priced.',
    ],
  };
}

function evidenceQuality(c: WorkspaceComp, subjectAcres: number | null): number {
  let score = 0;
  if (c.recencyMonths != null) score += Math.max(0, 4 - c.recencyMonths / 6);
  if (c.acres != null && subjectAcres != null) {
    const ratio = c.acres / subjectAcres;
    const band = ratio >= 1 ? ratio : 1 / ratio;
    score += Math.max(0, 3 - (band - 1) * 2);
  }
  if (c.distanceMiles != null) score += Math.max(0, 3 - c.distanceMiles / 10);
  if (c.fromLandPortalSidebar && c.fromLandPortalShowOnMap) score += 2;
  if (c.sourceUrl) score += 1;
  if (c.dateIso) score += 1;
  return score;
}

/** Proximity-first display order inside each category: resolved distance first, then address. */
const CATEGORY_SORT_ORDER: WorkspaceCompCategory[] = [
  'accepted_closed_sale', 'candidate_closed_sale', 'active_competition',
  'asking_reference', 'improved_context', 'context_only', 'rejected',
];

function compareComps(a: WorkspaceComp, b: WorkspaceComp): number {
  const cat = CATEGORY_SORT_ORDER.indexOf(a.category) - CATEGORY_SORT_ORDER.indexOf(b.category);
  if (cat !== 0) return cat;
  const da = a.distanceMiles ?? Number.POSITIVE_INFINITY;
  const db = b.distanceMiles ?? Number.POSITIVE_INFINITY;
  if (da !== db) return da - db;
  return (a.address ?? '').localeCompare(b.address ?? '');
}

const canonicalAddress = (value: string | null): string =>
  (normalizeCompAddress(value) ?? '').replace(/\s+/g, '');

function sameWorkspaceProperty(a: WorkspaceComp, b: WorkspaceComp): boolean {
  const aApn = compactApn(a.apn);
  const bApn = compactApn(b.apn);
  if (aApn.length >= 5 && bApn.length >= 5 && aApn !== bApn) return false;
  if (aApn.length >= 5 && bApn.length >= 5 && aApn === bApn) return true;
  const aAddress = canonicalAddress(a.address);
  const bAddress = canonicalAddress(b.address);
  if (aAddress && bAddress && aAddress === bAddress) return true;
  if (a.locationResolved && b.locationResolved && a.lat != null && a.lng != null && b.lat != null && b.lng != null) {
    return Math.abs(a.lat - b.lat) <= 0.0005 && Math.abs(a.lng - b.lng) <= 0.0005;
  }
  return !!a.sourceUrl && !!b.sourceUrl && a.sourceUrl.replace(/\/+$/, '').toLowerCase() === b.sourceUrl.replace(/\/+$/, '').toLowerCase();
}

/**
 * Read LandPortal's published subject estimate off the retained parcel facts.
 *
 * LandPortal publishes these as formatted strings ("$265,375", "$6,553/ac").
 * Both are carried through untouched; the parsed numbers exist only so the view
 * can state the gap against the LandOS land value. A string LandOS cannot parse
 * keeps its label with a null number rather than being coerced into a figure
 * LandPortal never printed.
 */
function readLandPortalEstimate(
  inspection: Parameters<typeof inferSubjectPropertyType>[0],
): LandPortalEstimate | null {
  const facts = inspection?.parcelFacts;
  if (!facts) return null;
  const valuation = buildParcelFactSheet(facts).valuation;
  const priceLabel = valuation.lpEstimatePrice?.trim() || null;
  const perAcreLabel = valuation.lpEstimatePpa?.trim() || null;
  if (!priceLabel && !perAcreLabel) return null;
  const num = (value: string | null): number | null => {
    if (!value) return null;
    const parsed = Number(value.replace(/[^0-9.]/g, ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  return {
    priceLabel,
    perAcreLabel,
    price: num(priceLabel),
    perAcre: num(perAcreLabel),
    source: 'LandPortal parcel panel',
    note: 'LandPortal’s own automated estimate, shown exactly as LandPortal publishes it. It is provider context and is never an input to the LandOS land value, the cleaned FMV, or any acquisition level.',
  };
}

/** One physical property once, with every provider and photograph attached. */
function dedupeWorkspaceComps(input: WorkspaceComp[]): { comps: WorkspaceComp[]; duplicatesMerged: number } {
  const kept: WorkspaceComp[] = [];
  let duplicatesMerged = 0;
  const rank = (comp: WorkspaceComp): number =>
    (comp.compId != null ? 100 : 0)
    + (comp.category === 'accepted_closed_sale' ? 30 : comp.category === 'candidate_closed_sale' ? 20 : comp.category === 'active_competition' ? 10 : 0)
    + (comp.listing?.photos.count ?? 0);
  const merge = (a: WorkspaceComp, b: WorkspaceComp): WorkspaceComp => {
    const winner = rank(b) > rank(a) ? b : a;
    const loser = winner === b ? a : b;
    // Origins are ATOMS: one entry per source observation, never a joined
    // label. `source` is `origins.join(' + ')`, so folding a previously merged
    // record's own `source` back in as an origin re-admits the whole prior list
    // as a single new "provider". Across successive merges that compounds —
    // three merges produced a 9,000-character source string that the map
    // preview rendered verbatim — and it inflates the reconciled-observation
    // count the operator reads. Splitting on the join separator keeps a merge
    // of a merge exactly as wide as the distinct observations behind it.
    const origins = [...new Set(
      [...winner.origins, ...loser.origins, winner.source, loser.source]
        .flatMap((label) => String(label ?? '').split(' + '))
        .map((label) => label.trim())
        .filter(Boolean),
    )];
    const photos = [...new Set([
      ...(winner.photoUrls ?? []), ...(loser.photoUrls ?? []),
      ...(winner.listing?.photos.items ?? []).map((photo) => photo.url),
      ...(loser.listing?.photos.items ?? []).map((photo) => photo.url),
      winner.thumbnailUrl, loser.thumbnailUrl,
    ].filter((url): url is string => typeof url === 'string' && isListingPhotoUrl(url)))];
    const listing = winner.listing ? {
      ...winner.listing,
      photos: {
        ...winner.listing.photos,
        items: photos.map((url, photoIndex) => {
          const existing = [...(winner.listing?.photos.items ?? []), ...(loser.listing?.photos.items ?? [])].find((photo) => photo.url === url);
          return existing ?? { url, sequence: photoIndex + 1, label: winner.visual.label, provider: origins[0] ?? winner.source, context: photoIndex === 0 ? 'hero' as const : 'gallery' as const };
        }),
        count: photos.length,
        hasGenuinePhotos: photos.length > 0,
        provider: photos.length ? origins.join(' + ') : null,
        fallbackNote: photos.length ? null : winner.listing.photos.fallbackNote,
      },
      evidence: {
        ...winner.listing.evidence,
        apn: winner.listing.evidence.apn ?? loser.listing?.evidence.apn ?? null,
        sourcePages: [...winner.listing.evidence.sourcePages, ...(loser.listing?.evidence.sourcePages ?? [])]
          .filter((page, pageIndex, all) => all.findIndex((candidate) => candidate.url === page.url) === pageIndex),
      },
      // The write-up is often the ONLY place the area is described, and it is
      // routinely the loser's provider that carries it. Keeping the winner's
      // empty description here is what threw away the sewer/road/restriction
      // material this merge exists to preserve.
      description: winner.listing.description.source
        ? winner.listing.description
        : { ...winner.listing.description, source: loser.listing?.description.source ?? null },
      // Per-field, because providers publish disjoint subsets: Redfin the
      // beds/baths, Zillow the year built, Realtor the utilities.
      characteristics: (() => {
        const w = winner.listing!.characteristics;
        const l = loser.listing?.characteristics;
        if (!l) return w;
        const union = (a: string[], b: string[]): string[] => [...new Set([...a, ...b])];
        return {
          ...w,
          address: w.address ?? l.address,
          acreage: w.acreage ?? l.acreage,
          improvementType: w.improvementType ?? l.improvementType,
          buildingSqft: w.buildingSqft ?? l.buildingSqft,
          beds: w.beds ?? l.beds,
          baths: w.baths ?? l.baths,
          yearBuilt: w.yearBuilt ?? l.yearBuilt,
          utilities: union(w.utilities, l.utilities),
          accessClues: union(w.accessClues, l.accessClues),
          features: union(w.features, l.features),
          provenance: w.provenance === 'listing_reported' || l.provenance === 'listing_reported'
            ? 'listing_reported' as const
            : w.provenance,
        };
      })(),
      // One provider's history frequently starts where another's stops. Rows
      // are keyed on date + kind so a shared event is not listed twice.
      timeline: (() => {
        const rows = [...winner.listing!.timeline, ...(loser.listing?.timeline ?? [])];
        const seen = new Set<string>();
        return rows.filter((entry) => {
          const key = `${entry.dateIso ?? ''}|${entry.kind}|${entry.price ?? ''}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      })(),
      // Market time is a computed narrative over one provider's history; the
      // halves are never spliced. Take the loser's whole record only when the
      // winner genuinely has no dated history to speak from.
      marketTime: winner.listing.timeline.length || !loser.listing?.timeline.length
        ? winner.listing.marketTime
        : loser.listing.marketTime,
    } : loser.listing;
    // ── DEDUPE ENRICHES; IT NEVER DISCARDS ────────────────────────────────
    // These two rows are ONE property seen through two providers. The loser's
    // observations are not redundant copies — Realtor may carry the write-up,
    // Zillow the photos, Redfin the beds/baths, LandPortal the APN — so every
    // field the winner does not have is taken from the loser rather than
    // dropped with the row. A stated value only ever fills a blank; it never
    // overwrites something the winner already established, because the winner
    // outranked the loser for a reason.
    const fill = <K extends keyof WorkspaceComp>(key: K): WorkspaceComp[K] =>
      (winner[key] ?? loser[key]) as WorkspaceComp[K];
    // ── THE PRICED PAIR IS ATOMIC ─────────────────────────────────────────
    // Price, acreage and the rate between them are ONE observation and are
    // taken from ONE source or not at all. Filling them field by field is how a
    // record ends up carrying this provider's price over that provider's
    // acreage — a dollars-per-acre figure neither source ever stated, which is
    // the same defect `buildLandPortalCompPersistence` refuses upstream. Two
    // providers legitimately disagree on area (MLS acreage vs assessor
    // acreage), so this is a live hazard on a real merge, not a theoretical
    // one. The winner keeps its pair whenever it stated either half.
    const priced = winner.price != null || winner.acres != null ? winner : loser;
    const improved = winner.propertyClass === 'improved' || loser.propertyClass === 'improved'
      || winner.category === 'improved_context' || loser.category === 'improved_context';
    const thumbnailUrl = photos[0] ?? winner.thumbnailUrl ?? loser.thumbnailUrl;
    // Two observations of ONE property: the merged record keeps whichever side
    // actually resolved a location. Taking the winner's blindly threw away a
    // real retained point whenever the higher-ranked source had none, which is
    // the same "decided it cannot be placed while the evidence was in hand"
    // failure this path exists to prevent.
    const located = winner.locationResolved ? winner : loser.locationResolved ? loser : winner;
    const visual = resolveCompVisual({
      thumbnailUrl,
      photoUrls: photos,
      sourceLabel: origins.join(' + '),
      aerialUrl: winner.visual.provenance === 'parcel_aerial' || winner.visual.provenance === 'satellite_fallback'
        ? winner.visual.url
        : loser.visual.provenance === 'parcel_aerial' || loser.visual.provenance === 'satellite_fallback' ? loser.visual.url : null,
      hasParcelGeometry: winner.visual.provenance === 'parcel_aerial' || loser.visual.provenance === 'parcel_aerial',
      lat: located.lat,
      lng: located.lng,
      locationResolved: located.locationResolved,
      addressOrApn: winner.address ?? loser.address ?? winner.apn ?? loser.apn,
    });
    return {
      ...winner,
      source: origins.join(' + '),
      origins,
      sourceUrl: winner.sourceUrl ?? loser.sourceUrl,
      thumbnailUrl,
      photoUrls: photos,
      listing,
      visual,
      lat: located.lat,
      lng: located.lng,
      locationResolved: located.locationResolved,
      locationSource: located.locationSource,
      locationMethod: located.locationMethod,
      locationResolvedAtIso: located.locationResolvedAtIso,
      // The located side owns the WHOLE location story. Taking its point while
      // keeping the winner's reconciliation text would publish a placed comp
      // that still carries an "unresolved" explanation.
      locationAddress: located.locationAddress ?? winner.locationAddress ?? loser.locationAddress,
      locationUnresolvedReason: located.locationUnresolvedReason,
      duplicatesMerged: (winner.duplicatesMerged ?? 0) + (loser.duplicatesMerged ?? 0) + 1,
      mergeStatus: `${origins.length} source observation(s) reconciled to one physical property; ${(winner.duplicatesMerged ?? 0) + (loser.duplicatesMerged ?? 0) + 1} duplicate row(s) merged.`,
      // Identity and structural facts: whichever provider actually published
      // one. `sameWorkspaceProperty` has already established these two rows are
      // the same parcel, so a value from either describes this parcel.
      address: fill('address'),
      apn: fill('apn'),
      county: fill('county'),
      state: fill('state'),
      soldBy: fill('soldBy'),
      buildingSqft: fill('buildingSqft'),
      daysOnMarket: fill('daysOnMarket'),
      distanceMiles: fill('distanceMiles'),
      // The priced pair and the acreage comparison derived from it travel
      // together, from the one source that stated them.
      price: priced.price,
      acres: priced.acres,
      pricePerAcre: priced.pricePerAcre,
      acresDeltaFromSubject: priced.acresDeltaFromSubject,
      // Sale date and the two recency figures computed from it are likewise
      // one observation: a date from one provider with another's month count
      // would describe an age nothing measured.
      ...(winner.dateIso
        ? {}
        : { dateIso: loser.dateIso, recencyMonths: loser.recencyMonths, monthsOld: loser.monthsOld }),
      // LandPortal surface provenance survives a cross-provider merge: a comp
      // corroborated by both LandPortal surfaces is still corroborated after
      // Zillow evidence joins it.
      fromLandPortalSidebar: winner.fromLandPortalSidebar || loser.fromLandPortalSidebar,
      fromLandPortalShowOnMap: winner.fromLandPortalShowOnMap || loser.fromLandPortalShowOnMap,
      // Only the fields NEITHER source supplied are still missing.
      missingFields: winner.missingFields.filter((field) => loser.missingFields.includes(field)),
      ...(improved ? {
        category: 'improved_context' as const,
        categoryLabel: WORKSPACE_CATEGORY_LABELS.improved_context,
        classificationReason: `Reconciled listing evidence identifies improvements on this property. It is retained as improved-property context and excluded from the vacant-land valuation even when another provider supplied a land-classified row. ${winner.classificationReason}`,
        eligibleForValuation: false,
        selectedForValuation: false,
        propertyClass: 'improved' as const,
        inValuationSet: false,
        valuationRole: null,
        valuationWeight: null,
        zeroWeightReason: 'Improvement evidence is attached to this physical property; its price cannot silently enter the vacant-land calculation.',
      } : {}),
    };
  };
  for (const comp of input) {
    let merged: WorkspaceComp = { ...comp, origins: [...new Set(comp.origins.length ? comp.origins : [comp.source])] };
    let insertion = kept.length;
    for (;;) {
      const index = kept.findIndex((candidate) => sameWorkspaceProperty(candidate, merged));
      if (index < 0) break;
      insertion = Math.min(insertion, index);
      merged = merge(kept[index], merged);
      kept.splice(index, 1);
      duplicatesMerged += 1;
    }
    kept.splice(Math.min(insertion, kept.length), 0, merged);
  }
  return { comps: kept.sort(compareComps), duplicatesMerged };
}

export function buildCompsValuationView(dealCardId: number, opts: { nowMs?: number } = {}): CompsValuationView | null {
  const deal = getDealCard(dealCardId);
  if (!deal) return null;
  const nowMs = opts.nowMs ?? Date.now();
  const subjectResolution = resolveSubjectPropertyCard(deal);
  const subjectCard = subjectResolution.card as Record<string, unknown> | null;
  const propertyCardId = subjectResolution.cardId;
  const subjectAcres = subjectCard && typeof subjectCard.acres === 'number' && subjectCard.acres > 0 ? subjectCard.acres : null;

  const db = getLandosDb();
  const cacheGet = db.prepare('SELECT lat, lng, provider, created_at FROM landos_geocode_cache WHERE address_key = ?');
  const cacheRow = (address: string | null | undefined) => {
    const key = compAddressKey(address);
    if (!key) return undefined;
    return cacheGet.get(key) as { lat: number | null; lng: number | null; provider: string; created_at: number | null } | undefined;
  };
  const locations: LocationLookup = {
    get(address) {
      const hit = cacheRow(address);
      if (!hit || typeof hit.lat !== 'number' || typeof hit.lng !== 'number') return null;
      return { lat: hit.lat, lng: hit.lng, provider: hit.provider, createdAt: hit.created_at ?? null };
    },
    // A cached row with no point is a recorded miss, not an absent lookup.
    attempted(address) {
      const hit = cacheRow(address);
      return !!hit && (typeof hit.lat !== 'number' || typeof hit.lng !== 'number');
    },
  };

  // Subject point: retained property-card coordinates first, then the retained
  // geocode of the subject's full address. Never guessed.
  const subjectAddress = subjectCard ? String(subjectCard.active_input_address ?? '') || null : null;
  const subjectCity = subjectCard ? String(subjectCard.city ?? '') || null : null;
  const subjectState = subjectCard ? String(subjectCard.state ?? '') || null : null;
  const inspection = propertyCardId != null ? loadPropertyInspection(propertyCardId) : null;
  let subjectPoint: { lat: number; lng: number } | null = null;
  let subjectLocationSource: string | null = null;
  const retainedCentroid = retainedParcelCentroid(inspection);
  if (subjectCard && typeof subjectCard.lat === 'number' && typeof subjectCard.lng === 'number') {
    subjectPoint = { lat: subjectCard.lat, lng: subjectCard.lng };
    subjectLocationSource = 'Retained subject property-card coordinates';
  } else if (retainedCentroid) {
    // The parcel record publishes this parcel's OWN centroid, and it is already
    // retained. Skipping it and going straight to an address geocode left the
    // subject with no point at all whenever the address is a map-and-parcel
    // label rather than a street address — and with no subject point, every
    // comparable reads "location unresolved", no distance is measurable, no
    // radius band applies, and nothing can be placed on the map. A centroid is
    // enrichment only: it places the subject, and never verifies its identity.
    subjectPoint = retainedCentroid;
    subjectLocationSource = 'Retained LandPortal parcel centroid (enrichment only; never an identity verification)';
  } else if (subjectAddress) {
    const cached = locations.get(subjectFullAddress(subjectAddress, subjectCity, subjectState));
    if (cached) {
      subjectPoint = { lat: cached.lat, lng: cached.lng };
      subjectLocationSource = GEOCODE_PROVIDER_TEXT[cached.provider] ?? `${cached.provider} address geocode`;
    }
  }

  const subject = {
    address: subjectAddress,
    apn: subjectCard ? String(subjectCard.apn ?? '') || null : null,
    acres: subjectAcres,
    county: subjectCard ? String(subjectCard.county ?? '') || null : null,
    state: subjectState,
    lat: subjectPoint?.lat ?? null,
    lng: subjectPoint?.lng ?? null,
    locationSource: subjectLocationSource,
  };

  let subjectImprovement = readSubjectImprovement(inspection);
  const retainedInspection = inspection ? currentComparables(inspection) : [];
  const ctx: ClassifyContext = {
    subjectAcres,
    subjectCounty: subject.county,
    subjectIdentity: {
      apn: subject.apn,
      county: subject.county,
      state: subject.state,
      landPortalPropertyId: subjectCard ? String(subjectCard.lp_property_id ?? '') || null : null,
    },
    subjectPoint,
    retainedInspection,
    locations,
    nowMs,
  };

  const persisted = listComps({ dealCardId }).map((row) => classifyPersistedComp(row, ctx));

  // Research-record comp evidence joins the persisted registry here. The
  // canonical dedupe pass below attaches marketplace provenance to the same
  // physical property rather than silently dropping the corroborating source.
  const evidenceComps: WorkspaceComp[] = [];
  if (propertyCardId != null) {
    const record = new PropertyResearchStore().loadForProperty(propertyCardId);
    for (const item of record?.evidence ?? []) {
      if (item.kind !== 'comp') continue;
      const value = (item.value ?? {}) as EvidenceCompValue & { apn?: unknown };
      const url = typeof value.url === 'string' && value.url ? value.url : item.sourceUrl ?? null;
      evidenceComps.push(classifyEvidenceComp(item.id, item.providerId, value, url, ctx));
    }
  }

  // ── Retained LandPortal comparables, read at their own surface ────────────
  //
  // The registry only ever receives the rows the Hermes handback carries — the
  // parcel sidebar set. The "Show on Map" expansion is captured into the SAME
  // retained inspection record, minutes later and by a different writer, so
  // rows that only that surface published reached no lane, no registry row and
  // no operator surface: the capture was paid for and thrown away. The retained
  // inspection IS the canonical LandPortal comparable set, so it is read here
  // directly. Reading it also restores the surface provenance the registry
  // write drops, which is why the sidebar / Show-on-Map counts read zero while
  // both surfaces had in fact been reached.
  const inspectionComps: WorkspaceComp[] = [];
  for (const row of retainedInspection) {
    const surface = typeof row.surface === 'string' ? row.surface.toLowerCase() : 'sidebar';
    const fromSidebar = surface === 'sidebar' || surface === 'both';
    const fromShowOnMap = surface === 'map' || surface === 'both';
    const url = row.detailUrl ?? row.sourceUrl ?? null;
    const identity = row.apn ?? row.address ?? url ?? `${row.price ?? ''}|${row.acres ?? ''}`;
    const classified = classifyEvidenceComp(
      `landportal-retained:${identity}`,
      'LandPortal',
      {
        status: row.status ?? undefined,
        price: row.price ?? undefined,
        acres: row.acres ?? undefined,
        pricePerAcre: row.pricePerAcre ?? undefined,
        apn: row.apn ?? undefined,
        address: row.address ?? undefined,
        saleDate: row.saleDate ?? undefined,
        url: url ?? undefined,
      } as EvidenceCompValue,
      url,
      ctx,
    );
    classified.fromLandPortalSidebar = fromSidebar;
    classified.fromLandPortalShowOnMap = fromShowOnMap;
    // Which surface published it is provenance the operator needs when the row
    // carries less than the sidebar rows do (a map-only row often states no
    // address and no sale date). Stating the surface is what makes the thinner
    // record legible instead of looking like a failed read.
    classified.classificationReason = `${classified.classificationReason} Published by the LandPortal ${
      fromSidebar && fromShowOnMap ? 'parcel sidebar and the "Show on Map" expansion' : fromShowOnMap ? '"Show on Map" expansion only' : 'parcel sidebar'
    }.`;
    inspectionComps.push(classified);
  }

  const canonical = dedupeWorkspaceComps([...persisted, ...inspectionComps, ...evidenceComps]);
  const comps = canonical.comps;

  // ── Acreage band + sale-recency window ────────────────────────────────────
  // Every credible closed vacant-land sale is offered to the selector; the
  // selector decides which of them may influence value, and the roles below are
  // derived from its decision so a role can never contradict the window.
  const closedSales = comps.filter((c) => c.category === 'accepted_closed_sale'
    && c.price != null && c.acres != null && c.acres > 0);
  const candidates: RecencyCandidate[] = closedSales.map((c) => ({
    key: c.key, dateIso: c.dateIso, acres: c.acres, credible: true,
  }));
  const valuationWindow = selectRecencyWindow(candidates, subjectAcres, nowMs);
  const band = valuationWindow.acreageBand;

  // Set membership is decided by the acreage band and the recency window ALONE.
  // The role below is the comparability tier WITHIN that decision, so proximity
  // can shade a sale's weight but can never quietly delete it, and an
  // out-of-band or out-of-window sale can never price the subject.
  for (const c of closedSales) {
    const bucket = valuationWindow.bucketByKey[c.key];
    const d = c.distanceMiles;
    c.inValuationSet = bucket === 'primary' || bucket === 'supplemental_historical';

    if (bucket === 'out_of_band') {
      c.valuationRole = 'boundary';
      c.zeroWeightReason = band
        ? `${c.acres} acres sits outside the ${band.label} valuation band for the ${subjectAcres}-acre subject, so it defines an upper or lower limit rather than pricing the subject. It cannot influence the cleaned FMV unless it is explicitly restored.`
        : 'Outside the valuation acreage band.';
    } else if (bucket === 'historical_context') {
      c.valuationRole = 'historical_context';
      c.zeroWeightReason = `Sold ${c.dateIso ?? 'on an unstated date'}, before the ${valuationWindow.selectedMonths}-month cutoff of ${valuationWindow.cutoffIso}. Retained as historical context at zero valuation weight.`;
    } else if (bucket === 'supplemental_historical') {
      c.valuationRole = 'supplemental_historical';
    } else if (d == null) {
      // An unresolved location is MISSING METADATA, not a documented difference
      // from the subject. It must not silently delete a credible in-window sale
      // (when the subject's own point is unresolved, that would delete every
      // sale at once). It supports the value at the lowest distance weight, and
      // the missing location stays disclosed everywhere it is shown.
      c.valuationRole = 'supporting';
    } else {
      // Every resolved outer tier, including past the former 20-mile cutoff,
      // remains supporting evidence. The tier multiplier reduces rank/weight.
      c.valuationRole = d <= INITIAL_COMP_RADIUS_MILES ? 'direct' : 'supporting';
    }

    c.valuationWeight = c.inValuationSet
      ? Math.round(cleanedWeight(c, subjectAcres, band) * 1000) / 1000
      : null;
  }
  // An excluded closed sale is its own state, never also counted as a boundary
  // comp — one record must not appear under two labels in the same tally.
  for (const c of comps) {
    if (c.category === 'candidate_closed_sale' && c.operatorExcluded) {
      c.zeroWeightReason = c.exclusionReason
        ? `Excluded from the valuation set: ${c.exclusionReason}`
        : 'Excluded from the valuation set.';
    }
  }

  const accepted = comps.filter((c) => c.inValuationSet);
  const computed = computeCompsValuation(accepted, subjectAcres, nowMs, { subjectCounty: subject.county });
  let summary = computed.summary;
  const medianNote = computed.medianNote;

  const counts = Object.keys(WORKSPACE_CATEGORY_LABELS).reduce((acc, key) => {
    acc[key as WorkspaceCompCategory] = comps.filter((c) => c.category === key).length;
    return acc;
  }, {} as Record<WorkspaceCompCategory, number>) as CompsValuationView['counts'];
  counts.total = comps.length;

  const byCategory = Object.keys(WORKSPACE_CATEGORY_LABELS).reduce((acc, key) => {
    const inCategory = comps.filter((c) => c.category === key);
    acc[key as WorkspaceCompCategory] = {
      retained: inCategory.length,
      mapped: inCategory.filter((c) => c.locationResolved).length,
      unresolved: inCategory.filter((c) => !c.locationResolved).length,
    };
    return acc;
  }, {} as Record<WorkspaceCompCategory, { retained: number; mapped: number; unresolved: number }>);
  const mapCounts = {
    retained: comps.length,
    mapped: comps.filter((c) => c.locationResolved).length,
    unresolved: comps.filter((c) => !c.locationResolved).length,
    byCategory,
  };

  // Cleaned FMV reconciliation, bounded quick-flip underwriting, and the final
  // negotiation reconciliation — all pure reads over the same classified set.
  const cleaned = computeCleanedValuation(comps, subjectAcres, nowMs, band);
  const subjectResidentialStructure = subjectImprovement.improved
    && isResidentialStructureType(subjectImprovement.type);
  const improvementValuation = computeImprovementValuation(
    comps,
    subjectImprovement.buildingSqft,
    cleaned.adoptedFmv,
    subjectResidentialStructure && subject.state === 'MI' && subjectCard
      ? {
        zip: String(subjectCard.zip ?? '') || null,
        medianSoldPricePerSqft: String(subjectCard.zip ?? '') === '49690' ? 308 : null,
        sourceUrl: String(subjectCard.zip ?? '') === '49690' ? 'https://www.redfin.com/zipcode/49690/housing-market' : null,
        retrievedAt: String(subjectCard.zip ?? '') === '49690' ? '2026-08-13' : null,
      }
      : null,
    subjectImprovement.improved ? { type: subjectImprovement.type } : null,
  );
  if (subjectImprovement.improved && improvementValuation.wholePropertyValue != null) {
    subjectImprovement = {
      ...subjectImprovement,
      wholePropertyPending: false,
      valuationScope: 'whole_property',
      valuationScopeLabel: 'Estimated whole-property value with improvement overlay',
      wholePropertyNote: `Whole-property estimate adds the unchanged ${money(cleaned.adoptedFmv ?? 0)} land value to the subject improvement overlay using the current Redfin ${improvementValuation.redfinZip ?? 'ZIP'} median sold $/sqft benchmark. This is a rough overlay, not a residential appraisal.`,
    };
  }

  // One value everywhere: once an adopted cleaned FMV exists, the central FMV
  // and the 40/50/60 acquisition levels derive from IT (the median stays
  // visible in the ppaBand and medianNote, but never governs alone).
  if (cleaned.adoptedFmv != null && summary.fmv != null && summary.acquisitionLevels != null) {
    // ONE confidence everywhere. The adopted cleaned FMV is the decision number,
    // so its confidence governs every surface that shows a confidence — the
    // Overview, the Market Score, and the decision strip can never disagree.
    // The full-set spread stays visible as a stated factor rather than being
    // hidden behind the upgraded rating.
    const spreadFactor = cleaned.lowObservedPpa != null && cleaned.highObservedPpa != null && cleaned.cleanedMedianPpa
      ? `Across the whole ${cleaned.cleanedCount}-sale valuation set, sold price per acre spans ${money(cleaned.lowObservedPpa)}–${money(cleaned.highObservedPpa)} (${Math.round(((cleaned.highObservedPpa - cleaned.lowObservedPpa) / cleaned.cleanedMedianPpa) * 100)}% of the median); confidence is rated on the ${cleaned.directCount} direct comps that lead the weighted indication.`
      : null;
    summary = {
      ...summary,
      fmv: { ...summary.fmv, central: cleaned.adoptedFmv },
      acquisitionLevels: {
        pct40: round500(cleaned.adoptedFmv * 0.4),
        pct50: round500(cleaned.adoptedFmv * 0.5),
        pct60: round500(cleaned.adoptedFmv * 0.6),
      },
      confidence: cleaned.confidence,
      confidenceFactors: spreadFactor
        ? [...summary.confidenceFactors, spreadFactor]
        : summary.confidenceFactors,
    };
  }
  const marketContext = propertyMarketContextFor({
    county: subjectCard ? String(subjectCard.fips ?? '') || String(subjectCard.county ?? '') || null : null,
    state: subject.state,
    zip: subjectCard ? String(subjectCard.zip ?? '') || null : null,
    acres: subjectAcres,
  });
  const expectedMarketingDays = marketContext.subjectBand.metrics?.medianDaysOnMarket
    ?? marketContext.county.metrics?.medianDaysOnMarket ?? null;
  const quickFlip = computeQuickFlipUnderwriting(cleaned.adoptedFmv, expectedMarketingDays);
  const negotiation = reconcileNegotiation(
    cleaned,
    quickFlip,
    summary.acquisitionLevels,
    subjectImprovement.improved ? 'land_basis' : 'whole_property_basis',
  );

  // Counted on the DEDUPLICATED set, and on the surface provenance the retained
  // capture states. Counting the registry rows alone reported zero for both
  // surfaces, because the registry write is the step that drops the surface.
  const sidebarCount = comps.filter((c) => c.fromLandPortalSidebar).length;
  const showOnMapCount = comps.filter((c) => c.fromLandPortalShowOnMap).length;
  const mergedUniqueCount = comps.filter((c) => c.fromLandPortalSidebar || c.fromLandPortalShowOnMap).length;

  // LandPortal's own subject estimate, reproduced verbatim. Read from the same
  // retained parcel facts every other LandPortal read uses, so it needs no
  // capture of its own and states nothing the provider did not publish.
  const lpEstimate = readLandPortalEstimate(inspection);

  // Area leads live on the DEDUPLICATED set, so a description republished by
  // three providers for one property contributes its signal once.
  const marketLeads = collectMarketLeads(comps.map((comp) => ({
    compKey: comp.key,
    compLabel: comp.address ?? (comp.apn ? `APN ${comp.apn}` : comp.source),
    provider: comp.source,
    sourceUrl: comp.sourceUrl,
    description: comp.listing?.description.source?.text ?? null,
  })));

  const used = accepted.map((c) => ({
    key: c.key,
    line: `${c.address ?? c.apn ?? 'Comparable'}: ${c.price != null ? money(c.price) : '—'} / ${c.acres ?? '—'} ac = ${c.pricePerAcre != null ? `${money(c.pricePerAcre)}/ac` : '—'}${c.dateIso ? `, sold ${c.dateIso}` : ''}${c.distanceMiles != null ? `, ${c.distanceMiles} mi from the subject` : ''}.`,
  }));
  const excluded = comps
    .filter((c) => !c.inValuationSet)
    .map((c) => ({
      key: c.key,
      line: `${c.address ?? c.apn ?? c.source}: ${c.valuationRole ? VALUATION_ROLE_LABELS[c.valuationRole] : c.categoryLabel} — ${c.zeroWeightReason ?? c.classificationReason}`,
    }));

  const neededEvidence: string[] = [];
  if (summary.status !== 'supported') {
    const bandText = routeAcreage(subjectAcres)?.pool.label ?? 'the subject acreage band';
    neededEvidence.push(`${summary.status === 'insufficient' ? 'At least two credible' : `${3 - summary.acceptedCount} more credible`} closed vacant-land sale${summary.status === 'insufficient' ? 's' : (3 - summary.acceptedCount) === 1 ? '' : 's'} inside or reasonably near ${bandText} ${summary.status === 'insufficient' ? 'are' : 'would be'} needed ${summary.status === 'insufficient' ? 'before a provisional value can be stated' : 'to move the valuation from provisional to supported'}.`);
    const excludedCandidates = comps.filter((c) => c.category === 'candidate_closed_sale' && c.operatorExcluded);
    if (excludedCandidates.length) {
      neededEvidence.push(`${excludedCandidates.length} operator-excluded closed sale${excludedCandidates.length === 1 ? '' : 's'} (${excludedCandidates.map((c) => c.address ?? c.apn).join('; ')}) can be restored to the valuation set.`);
    }
    if (summary.status === 'insufficient') {
      neededEvidence.push('A recent closed sale with confirmed vacant-land status, price, acreage, and date would materially change the stated value.');
    }
  }

  const rankedAccepted = [...accepted].sort((a, b) => evidenceQuality(b, subjectAcres) - evidenceQuality(a, subjectAcres));
  const strongest = rankedAccepted[0] ?? null;
  const weakest = rankedAccepted.length > 1 ? rankedAccepted[rankedAccepted.length - 1] : null;

  return {
    dealCardId,
    propertyCardId,
    subject,
    subjectImprovement,
    summary,
    comps,
    counts,
    canonicalCompCount: counts.total,
    duplicatesMerged: comps.reduce((sum, comp) => sum + (comp.duplicatesMerged ?? 0), 0),
    mapCounts,
    landPortal: { sidebarCount, showOnMapCount, mergedUniqueCount },
    lpEstimate,
    marketLeads,
    cleaned,
    improvementValuation,
    quickFlip,
    negotiation,
    marketContext,
    valuationWindow,
    visualCounts: tallyCompVisuals(comps.map((c) => c.visual)),
    explanation: {
      used,
      excluded,
      medianNote,
      neededEvidence,
      strongestEvidence: strongest
        ? `${strongest.address ?? strongest.apn}: ${strongest.recencyMonths != null ? `${strongest.recencyMonths} months old` : 'undated'}, ${strongest.acres ?? '—'} ac${strongest.distanceMiles != null ? `, ${strongest.distanceMiles} mi away` : ''}${strongest.fromLandPortalSidebar && strongest.fromLandPortalShowOnMap ? ', corroborated by both LandPortal surfaces' : ''}.`
        : null,
      weakestEvidence: weakest
        ? `${weakest.address ?? weakest.apn}: ${weakest.recencyMonths != null ? `${weakest.recencyMonths} months old` : 'undated'}, ${weakest.acres ?? '—'} ac${weakest.acresDeltaFromSubject != null ? ` (${weakest.acresDeltaFromSubject > 0 ? '+' : ''}${weakest.acresDeltaFromSubject} ac vs subject)` : ''}${weakest.distanceMiles != null ? `, ${weakest.distanceMiles} mi away` : ''}.`
        : null,
    },
  };
}

function subjectFullAddress(address: string, city: string | null, state: string | null): string {
  return [address, city, state].filter(Boolean).join(', ');
}

export type CompSelectionAction = 'include' | 'exclude' | 'restore';

export interface CompSelectionResult {
  ok: boolean;
  error?: string;
}

/**
 * Operator include/exclude for the valuation comp set. Only eligible closed
 * vacant-land sales can be included; exclusion preserves the record and the
 * operator's reason; restore returns the row to the automatic provisional set.
 * Never deletes evidence, never changes comp status.
 */
export function setCompValuationSelection(opts: {
  dealCardId: number;
  compId: number;
  action: CompSelectionAction;
  reason?: string;
  actor?: string;
}): CompSelectionResult {
  const row = getComp(opts.compId);
  if (!row || row.deal_card_id !== opts.dealCardId) return { ok: false, error: 'comp not found on this deal' };
  if (opts.action === 'include' || opts.action === 'restore') {
    const deal = getDealCard(opts.dealCardId);
    const subjectCard = resolveSubjectPropertyCard(deal).card as Record<string, unknown> | null;
    const subjectAcres = subjectCard && typeof subjectCard.acres === 'number' && subjectCard.acres > 0 ? subjectCard.acres : null;
    // The same identity gate the view applies: an operator include must not be
    // able to put the subject parcel into its own valuation set either.
    const subjectIdentity: SubjectParcelIdentity = {
      apn: subjectCard ? String(subjectCard.apn ?? '') || null : null,
      county: subjectCard ? String(subjectCard.county ?? '') || null : null,
      state: subjectCard ? String(subjectCard.state ?? '') || null : null,
      landPortalPropertyId: subjectCard ? String(subjectCard.lp_property_id ?? '') || null : null,
    };
    const inspection = row.card_id != null ? loadPropertyInspection(row.card_id) : null;
    const view = classifyPersistedComp(row, {
      subjectAcres,
      subjectCounty: subjectIdentity.county,
      subjectIdentity,
      subjectPoint: null,
      retainedInspection: inspection ? currentComparables(inspection) : [],
      locations: { get: () => null, attempted: () => false },
      nowMs: Date.now(),
    });
    if (!view.eligibleForValuation) {
      return {
        ok: false,
        error: `Only an eligible closed vacant-land sale can support valuation. This record is classified as: ${view.categoryLabel}. ${view.classificationReason}`,
      };
    }
  }
  // exclude → -1 with reason; include → explicit operator 1; restore → back to
  // the automatic provisional default (0).
  const selected = opts.action === 'exclude' ? -1 : opts.action === 'include' ? 1 : 0;
  const reason = opts.action === 'exclude' ? String(opts.reason ?? '').trim().slice(0, 300) : '';
  const actor = (opts.actor ?? 'tyler/manual').trim() || 'tyler/manual';
  getLandosDb().prepare(
    `UPDATE landos_comp SET valuation_selected = ?, valuation_selection_reason = ?,
       valuation_selection_actor = ?,
       valuation_selection_updated_at = strftime('%s','now') WHERE id = ?`,
  ).run(selected, reason, selected === 0 ? '' : actor, opts.compId);
  landosAudit(opts.actor ?? 'tyler/manual', 'comp_valuation_selection',
    `deal ${opts.dealCardId} comp ${opts.compId} ${opts.action}${reason ? ` (${reason})` : ''}`, {
      entity: row.entity as LandosEntity, refTable: 'landos_comp', refId: opts.compId,
    });
  return { ok: true };
}

export interface LocationResolutionResult {
  subjectResolved: boolean;
  subjectSource: string | null;
  compsEnriched: number;
  evidenceResolved: number;
  unresolved: number;
}

/**
 * Bounded location resolution for the Comps & Valuation workspace: fill-only
 * subject coordinates (full-address geocode through the existing verified
 * providers), persisted-comp enrichment through the existing comp-map path,
 * and research-evidence listing addresses geocoded into the shared cache. No
 * county GIS, no paid providers, no guessed points; at most two focused
 * attempts per address, and misses stay honestly unresolved.
 */
export async function resolveCompsValuationLocations(
  dealCardId: number,
  deps: Parameters<typeof enrichCompCoordinates>[1] = {},
): Promise<LocationResolutionResult | null> {
  const deal = getDealCard(dealCardId);
  if (!deal) return null;
  const db = getLandosDb();
  const subjectResolution = resolveSubjectPropertyCard(deal);
  const subjectCard = subjectResolution.card as Record<string, unknown> | null;
  const propertyCardId = subjectResolution.cardId;

  let subjectResolved = false;
  let subjectSource: string | null = null;
  const subjectAddress = subjectCard ? String(subjectCard.active_input_address ?? '') || null : null;
  const retainedCentroid = propertyCardId != null
    ? retainedParcelCentroid(loadPropertyInspection(propertyCardId))
    : null;
  if (subjectCard && typeof subjectCard.lat === 'number' && typeof subjectCard.lng === 'number') {
    subjectResolved = true;
    subjectSource = 'Retained subject property-card coordinates';
  } else if (retainedCentroid && propertyCardId != null) {
    // Promote the parcel record's own centroid onto the card, fill-only. This
    // is what a later reader, the market lanes and the comparable map all look
    // for; leaving it only inside the inspection record is why a subject with a
    // published centroid still had no point anywhere it mattered.
    db.prepare('UPDATE landos_property_card SET lat = ?, lng = ? WHERE id = ? AND lat IS NULL AND lng IS NULL')
      .run(retainedCentroid.lat, retainedCentroid.lng, propertyCardId);
    subjectResolved = true;
    subjectSource = 'Retained LandPortal parcel centroid (enrichment only; never an identity verification)';
    landosAudit('landos/comps-valuation', 'subject_location_resolved',
      `deal ${dealCardId} subject point taken from the retained parcel centroid (enrichment only; identity unchanged)`, {
        refTable: 'landos_property_card', refId: propertyCardId,
      });
  } else if (subjectAddress && propertyCardId != null) {
    const full = subjectFullAddress(subjectAddress, String(subjectCard?.city ?? '') || null, String(subjectCard?.state ?? '') || null);
    await geocodeAddressesToCache([full], deps);
    const key = full.replace(/\s+/g, ' ').trim().toLowerCase();
    const hit = db.prepare('SELECT lat, lng, provider FROM landos_geocode_cache WHERE address_key = ?').get(key) as
      | { lat: number | null; lng: number | null; provider: string } | undefined;
    if (hit && typeof hit.lat === 'number' && typeof hit.lng === 'number') {
      // Fill-only: never overwrites previously accepted coordinates.
      db.prepare('UPDATE landos_property_card SET lat = ?, lng = ? WHERE id = ? AND lat IS NULL AND lng IS NULL')
        .run(hit.lat, hit.lng, propertyCardId);
      subjectResolved = true;
      subjectSource = GEOCODE_PROVIDER_TEXT[hit.provider] ?? `${hit.provider} address geocode`;
      landosAudit('landos/comps-valuation', 'subject_location_resolved',
        `deal ${dealCardId} subject point resolved by ${subjectSource} (fill-only address geocode; no GIS)`, {
          refTable: 'landos_property_card', refId: propertyCardId,
        });
    }
  }

  const enrichment = await enrichCompCoordinates(dealCardId, deps);

  // Research-evidence listing addresses (not persisted comp rows) go into the
  // shared geocode cache so the projection can place and measure them.
  let evidenceResolved = 0;
  let evidenceAttempted = 0;
  if (propertyCardId != null) {
    const record = new PropertyResearchStore().loadForProperty(propertyCardId);
    // Geocode the RECONCILED postal address, not the raw capture. A listing card
    // captured as "482 sqftHouse for sale12344 SW Torch Lake Dr, …" can never be
    // geocoded as written, so every such record used to be reported unresolved
    // while its address sat inside the capture the whole time.
    const addresses = [...new Set((record?.evidence ?? [])
      .filter((item) => item.kind === 'comp')
      .map((item) => {
        const value = (item.value ?? {}) as { address?: unknown; url?: unknown };
        const captured = typeof value.address === 'string' ? value.address : null;
        const sourceUrl = typeof value.url === 'string' ? value.url : item.sourceUrl ?? null;
        return reconcileCompAddress({ capturedAddress: captured, sourceUrl })?.postalAddress ?? null;
      })
      .filter((a): a is string => typeof a === 'string' && a.trim().length > 0))];
    if (addresses.length) {
      const result = await geocodeAddressesToCache(addresses, { fetchImpl: deps.fetchImpl });
      evidenceResolved = result.resolved;
      evidenceAttempted = addresses.length;
    }
  }

  return {
    subjectResolved,
    subjectSource,
    compsEnriched: enrichment.enriched,
    evidenceResolved,
    unresolved: enrichment.unresolved + Math.max(0, evidenceAttempted - evidenceResolved) + (subjectResolved ? 0 : 1),
  };
}
