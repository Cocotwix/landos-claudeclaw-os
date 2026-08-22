// Acquisition Workspace V2 — Property Intelligence section.
//
// A usable property-research workspace rendered from the latest accepted
// canonical records. The workspace page loads them once (snapshot,
// marketContext, retained soil details) and passes them down, so switching
// sections reuses the already-loaded record instead of refetching.
// Values missing from the canonical data render as honestly missing; nothing
// is fabricated. Market context is labeled as LandOS Market Research and is
// never sourced from LandPortal market panels (SOP 10B).
import { useEffect, useRef, useState } from 'preact/hooks';
import { ChevronLeft, ChevronRight, Maximize2, X, ZoomIn, ZoomOut } from 'lucide-preact';
import { dashboardToken } from '@/lib/api';
import { AcquisitionWorkspaceV2CompPhotoGallery, type CvCompPhoto } from './AcquisitionWorkspaceV2CompPhotoGallery';
import { AssessorTaxRun } from './AcquisitionWorkspaceV2AssessorTax';
import {
  Conclusion, ConflictBanner, Disclosure, MetricRow, StillNeeded, WhatItMeans,
  type DxMetric,
} from './AcquisitionWorkspaceV2Diligence';
import {
  AcquisitionIntelligenceSection,
  type AcquisitionIntelligenceView,
  type AcquisitionIntelligenceReadiness,
  type AcquisitionIntelligenceRuntimeStatus,
} from './AcquisitionWorkspaceV2AcquisitionIntelligence';
import { diligencePriorities } from '../lib/acquisition-intelligence-digest';
import { LandPortalResearchRun } from './AcquisitionWorkspaceV2LandPortalResearch';
import { OfficialParcelGisPanel, type OfficialParcelGisView } from './AcquisitionWorkspaceV2OfficialParcelGis';
import { LandUsePanel, type LandUseView, type RetainedLandUseIntelligenceView } from './AcquisitionWorkspaceV2LandUse';
import { ZoningSubdivisionCapabilityRun } from './AcquisitionWorkspaceV2ZoningSubdivision';
import { PropertyDevelopmentHistoryPanel } from './AcquisitionWorkspaceV2PropertyDevelopmentHistory';
import type { CvSummary } from './AcquisitionWorkspaceV2CompsValuation';
import { DevelopmentIntelligencePanel, type DevelopmentIntelligenceView } from './AcquisitionWorkspaceV2DevelopmentIntelligence';
import '../styles/workspace-v2-property-intelligence.css';

// ── View types (structural; every field optional and defensive) ────────

export interface PiFact { key: string; value: string; grade: string; label?: string; source?: string; note?: string }
export interface PiDdItem { key: string; label: string; verdict: string; headline: string; detail?: string; missing?: string[] }
export interface PiEvidenceItem { id: string; label: string; viewUrl: string; kind?: string; sourceType?: string; sourceUrl?: string | null }
export interface PiCompRow {
  key?: string; apn?: string | null; address?: string | null; lane?: string; source?: string;
  sourceUrl?: string | null; status?: string; dateIso?: string | null; price?: number | null;
  acres?: number | null; pricePerAcre?: number | null; thumbnailUrl?: string | null;
}
export interface PiComps {
  conclusion?: string; summaryLine?: string;
  sold?: PiCompRow[]; active?: PiCompRow[]; askingReferences?: PiCompRow[];
  landPortalRowsSeen?: number; totalCollected?: number; duplicatesMerged?: number;
}
export interface PiSnapshot {
  status?: string;
  identity?: {
    displayAddress?: string; normalizedAddress?: string; owner?: string | null;
    ownerMailing?: string | null; county?: string; state_?: string; apn?: string;
    acres?: number | null; acreageBasis?: string; lpPropertyId?: string | null;
    zip?: string | null; city?: string | null;
    conflicts?: string[]; sourceConfidence?: string; hasParcelGeometry?: boolean;
  };
  facts?: PiFact[];
  dueDiligence?: PiDdItem[];
  evidence?: PiEvidenceItem[];
  comps?: PiComps;
  researchStatus?: ResearchStatusView;
  missingInformation?: unknown[];
  subjectParcelUrl?: string | null;
}

export interface MarketContextMetricsView {
  soldCount: number | null; activeCount: number | null; medianDaysOnMarket: number | null;
  sellThroughRate: number | null; absorptionRate: number | null; monthsOfSupply: number | null;
  medianPrice: number | null; medianPricePerAcre: number | null;
  population: number | null; populationGrowth: number | null;
}
export interface MarketContextRecordView {
  scope: string; label: string; available: boolean;
  acreageBand: string | null; acreageBandLabel: string | null;
  period: string | null; snapshotDate: string | null; provider: string | null;
  metrics: MarketContextMetricsView | null; note: string;
}
export interface MarketContextView {
  source: string;
  geography: { county: string | null; fips: string | null; state: string | null; zip: string | null; acres: number | null; subjectBand: string | null };
  county: MarketContextRecordView; zip: MarketContextRecordView;
  subjectBand: MarketContextRecordView; fastestBand: MarketContextRecordView;
  interpretation: string;
  read?: {
    headline?: string | null; summary?: string | null; resolvedVia?: string | null;
    exactSubjectBand?: boolean; note?: string | null;
  } | null;
  liquidity?: {
    headline?: string | null; summary?: string | null; resolvedVia?: string | null;
    competition?: number | null; note?: string | null;
  } | null;
}

export interface SoilDetail { symbol?: string; name?: string; fields?: Record<string, string> }
export interface BrowseruseResp { soilDetails?: SoilDetail[] }

export interface StreetViewObservationView {
  label: string; detail: string; confidence?: string; evidence?: string;
}
export interface StreetViewView { available: boolean; observations: StreetViewObservationView[] }

export interface MissingDiligenceItemView {
  key: string; label: string; currentFinding: string;
  stillUnresolved: string; whyItMatters: string; nextSource: string;
  shortStatus?: string; shortNext?: string; urgent?: boolean;
}
export interface MissingDiligenceView {
  items: MissingDiligenceItemView[];
  evidenceGaps: string[];
  passthrough: string[];
}

export interface AccessPresentationView {
  established: boolean;
  providerSignal?: 'mapped_frontage_not_landlocked' | 'landlocked_flag' | 'unresolved';
  developmentIntelligence?: DevelopmentIntelligenceView | null;
  road: string | null;
  legalAccess: string | null;
  frontageFt: number | null;
  apparentEntrance: string;
  apparentEntranceConfirmed: boolean;
  apparentEntranceObservation: string | null;
  evidence?: {
    items: AccessEvidenceView[];
    byTier: Record<'parcel_flag' | 'apparent_physical' | 'reported_legal' | 'verified_legal', AccessEvidenceView[]>;
    parcelFlagged: boolean;
    apparentPhysicalAccess: boolean;
    reportedLegalAccess: boolean;
    verifiedLegalAccess: boolean;
    operatorConclusion: string;
    outstanding: string[];
    conclusionWeight: string;
    rungs?: Array<{
      tier: 'parcel_flag' | 'apparent_physical' | 'reported_legal' | 'verified_legal';
      statement: string; sourceLabel?: string; basis?: string; weight?: string;
      sourceUrl?: string | null;
    }>;
  };
}
export interface AccessEvidenceView {
  tier: 'parcel_flag' | 'apparent_physical' | 'reported_legal' | 'verified_legal';
  statement: string; sourceLabel: string; sourceKind: string; basis: string; weight: string;
  sourceUrl?: string | null; observedAt?: string | null;
}

export interface SoilsSepticUnitView {
  name: string; symbol?: string | null; slopeRange?: string | null;
  drainageClass?: string | null; hydrologicGroup?: string | null;
  waterTableDepthCm?: number | null; bedrockDepthCm?: number | null;
  floodingFrequency?: string | null; pondingFrequency?: string | null;
  septicRating?: string | null; limitationReasons?: string[];
  parcelSharePct?: number | null;
}
export interface SoilsSepticView {
  category: string; categoryLabel: string; conclusion: string;
  supportingFactors: string[]; limitations: string[];
  bestTestingAreas: string | null; confidence: string; confidenceWhy: string;
  nextStep: string; parcelShareNote: string; units: SoilsSepticUnitView[];
  source: string; screenedAt: string | null;
}

export interface VisualBuyerNarrativeView {
  sections: Array<{ title: string; body: string }>;
  overviewMarketLine: string | null;
}

export interface ResearchStatusView {
  delivered: number; total: number; headline: string;
  questionsResolved?: number; questionsTotal?: number; unresolvedQuestions?: number;
  areas: Array<{ id: string; label: string; delivered: boolean; status: string; reason: string | null; nextAction: string | null }>;
  incomplete: Array<{ id: string; label: string; delivered: boolean; status: string; reason: string | null; nextAction: string | null }>;
}

/**
 * The canonical retained LandPortal parcel fact sheet, exactly as the API
 * projects it. This is the record of what the provider actually published for
 * this parcel; the snapshot's `lp_sidebar_*` facts are a discovery-stage subset
 * and never the authority on what was retained.
 */
export interface ParcelFactSheetView {
  access?: { label?: string | null; landLocked?: string | null; roadFrontage?: string | null; roadFrontageFt?: number | null } | null;
  buildability?: { label?: string | null; pct?: string | null; acres?: string | null } | null;
  terrain?: {
    slopeAvgPct?: string | null; slopeUnder10Pct?: string | null;
    elevationAvg?: string | null; elevationMin?: string | null; elevationMax?: string | null; label?: string | null;
  } | null;
  /** Provider figures held back from decisions, still reported as observations. */
  terrainQuarantine?: {
    reason: string;
    observations: Array<{ label: string; value: string }>;
    slopeAvgPct: string | null; buildabilityPct: string | null; buildableAcres: string | null;
  } | null;
  environment?: { femaFloodZone?: string | null; femaFloodZoneDescription?: string | null; femaCoveragePct?: string | null; wetlandsPct?: string | null; label?: string | null } | null;
  water?: { present?: boolean; type?: string | null; label?: string | null } | null;
  soils?: { type?: string | null; description?: string | null; label?: string | null } | null;
  improvement?: { buildingSqft?: string | null; yearBuilt?: string | null; improvementValue?: string | null; improved?: boolean | null; label?: string | null } | null;
  parcelContext?: { landUse?: string | null; landUseCode?: string | null; zoning?: string | null; parcelSqft?: string | null; subdivision?: string | null; label?: string | null } | null;
  valuation?: {
    lastSalePriceLabel?: string | null; lastSaleDate?: string | null;
    assessedValue?: string | null; totalMarketValue?: string | null; taxAmount?: string | null;
    lpEstimatePrice?: string | null; lpEstimatePpa?: string | null;
  } | null;
  retention?: { retained?: string[]; notSupplied?: string[] } | null;
}

/**
 * Property-tax payment status, as the collecting office publishes it.
 *
 * `standing` is only ever `current` or `delinquent` when a labeled public field
 * said so. Otherwise it is `unresolved` and `statement` names the exact sources
 * attempted and the blocker — never a bare "not screened".
 */
export interface TaxStatusView {
  standing: 'current' | 'delinquent' | 'unresolved';
  standingLabel: string;
  paymentStatus: string | null;
  amountOwed: string | null;
  unpaidYears: string | null;
  delinquencySince: string | null;
  penaltiesInterest: string | null;
  taxSaleStatus: string | null;
  attempts: Array<{ source: string; url: string | null; outcome: string; reached: boolean }>;
  sourceLabel: string | null;
  sourceUrl: string | null;
  authorityOffice: string | null;
  authoritySearchUrl: string | null;
  statement: string;
}

/** The six listing states LandOS recognises. `unknown` is never read as active. */
export type ListingStatusCodeView = 'active' | 'pending' | 'contingent' | 'sold' | 'off_market' | 'unknown';
export type EngagementAvailabilityView = 'available' | 'unavailable';

/**
 * One provider's published engagement in that provider's own terms. Every
 * measure carries its own availability, so an absent count renders as
 * unavailable and NEVER as zero.
 */
export interface ListingEngagementSignalView {
  provider: string;
  sourceLabel: string;
  sourceUrl: string;
  views: number | null;
  saves: number | null;
  viewsAvailability: EngagementAvailabilityView;
  savesAvailability: EngagementAvailabilityView;
  listingAgeDays: number | null;
  listingAgeAvailability: EngagementAvailabilityView;
  photoCount: number | null;
  photoCountAvailability: EngagementAvailabilityView;
  priceChangeCount: number | null;
  priceChangeAvailability: EngagementAvailabilityView;
  retrievedAt: string | null;
}

export interface ListingEventView { date: string | null; event: string; price: number | null }

/** Mirrors ListingEvidenceSourceView in src/landos/exact-address-web-discovery.ts. */
export interface ExactAddressListingSourceView {
  evidenceLabel?: 'Listing-reported';
  sourceLabel: string;
  family: string;
  sourceUrl: string;
  retrievedAt: string | null;
  propertyType: string | null;
  buildingSqft: number | null;
  acres: number | null;
  streetAddress?: string | null;
  normalizedStreetAddress?: string | null;
  apn?: string | null;
  listingStatus: string | null;
  listingStatusCode?: ListingStatusCodeView;
  listingStatusLabel?: string;
  listingStatusDate: string | null;
  price: number | null;
  originalListPrice?: number | null;
  listingDate?: string | null;
  daysOnMarket?: number | null;
  beds?: number | null;
  baths?: number | null;
  yearBuilt?: number | null;
  utilities: string[];
  well: boolean | null;
  septic: boolean | null;
  structures?: string[];
  description?: string | null;
  features?: string[];
  brokerage?: string | null;
  listingAgent?: string | null;
  mls?: string | null;
  listingHistory?: ListingEventView[];
  photoUrls?: string[];
  engagement?: ListingEngagementSignalView | null;
  accessStatements: string[];
  drivewayStatements: string[];
  directionsStatements?: string[];
  accessLanguageNote: string;
  provenanceNote: string;
}

/** One retained record's place in the reconciliation, and why it holds it. */
export interface ReconciledRecordRefView {
  sourceUrl: string;
  sourceLabel: string;
  family: string;
  listingStatusCode: ListingStatusCodeView;
  listingStatusLabel: string;
  retrievedAt: string | null;
  mls: string | null;
  reason: string;
}

/** Which retained records are one physical subject, and which one is current. */
export interface SubjectReconciliationViewData {
  subjectCount: number;
  canonical: {
    recordCount: number;
    sourceUrls: string[];
    matchedOn: string[];
    normalizedStreetAddress: string | null;
    apn: string | null;
    mlsNumbers: string[];
    identityNote: string;
  };
  currentRecord: ReconciledRecordRefView | null;
  supersededRecords: ReconciledRecordRefView[];
  otherRecords: ReconciledRecordRefView[];
  statement: string;
}

/** The reconciled subject's current public listing. Mirrors `listingCard`. */
export interface ListingCardView {
  active: boolean;
  onMarket: boolean;
  statusCode: ListingStatusCodeView;
  statusLabel: string;
  status: string | null;
  statusNote: string;
  currentPrice: number | null;
  originalListPrice: number | null;
  listingDate: string | null;
  daysOnMarket: number | null;
  listingAgeDays: number | null;
  listingAgeBasis: 'reported' | 'derived_from_listing_date' | 'unavailable';
  priceChanges: ListingEventView[];
  priceHistory: ListingEventView[];
  acres: number | null;
  mls: string | null;
  mlsNumbers: string[];
  brokerage: string | null;
  listingAgent: string | null;
  description: string | null;
  features: string[];
  drivewayStatements: string[];
  directionsStatements: string[];
  listingUrl: string;
  sourceLabel: string;
  additionalSourceUrls: string[];
  primaryPhotoUrl: string | null;
  additionalPhotoUrls: string[];
  photoCount: number | null;
  improvementFacts: {
    propertyType: string | null;
    buildingSqft: number | null;
    beds: number | null;
    baths: number | null;
    yearBuilt: number | null;
    structures: string[];
    utilities: string[];
    well: boolean | null;
    septic: boolean | null;
  };
  zillowEngagement: ListingEngagementSignalView | null;
  engagementByProvider: ListingEngagementSignalView[];
  engagementNote: string;
  supplementedFrom: string[];
  evidenceLabel: 'Listing-reported';
}

/** Mirrors ExactAddressListingEvidenceView in src/landos/exact-address-web-discovery.ts. */
export interface ExactAddressListingsView {
  status: string;
  note: string;
  queries: string[];
  retrievedAtIso: string | null;
  sources: ExactAddressListingSourceView[];
  /** Absent on projections persisted before subject reconciliation existed. */
  reconciliation?: SubjectReconciliationViewData | null;
  listingCard?: ListingCardView | null;
  subjectRead: { improved: boolean; buildingSqft: number | null; acres: number | null; statement: string } | null;
  disclaimer: string;
}

export interface VbaObservationView {
  label: string; detail: string; views?: string[]; basis?: string;
}
export interface VisualBuyerAnalysisView {
  generatedAt?: string;
  basedOn?: string[];
  observedFeatures?: VbaObservationView[];
  buyerInterpretation?: VbaObservationView[];
  unresolvedDiligence?: string[];
  buyerPerspective?: {
    strongestAdvantages?: string[]; importantConcerns?: string[];
    bestFitBuyers?: string[]; weakerFitBuyers?: string[];
    preliminaryImpression?: string; materialToValueOrStrategy?: string[];
  };
  evidenceReconciliation?: {
    supportingViews?: string[];
    supersededConclusions?: Array<{ prior: string; reconciled: string; strongerEvidence: string }>;
    remainingUncertain?: string[];
    overallConfidence?: string; confidenceWhy?: string;
  };
  overviewSummary?: { physicalCharacter?: string; mainBuyerAppeal?: string; topConcern?: string };
}

// ── Helpers ────────────────────────────────────────────────────────────

const tok = (u: string) => `${u}${u.includes('?') ? '&' : '?'}token=${encodeURIComponent(dashboardToken)}`;
const num = (s: string | null | undefined, re: RegExp): string | null => {
  const m = s ? s.match(re) : null;
  return m ? m[1] : null;
};
const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

/** A measure the provider never published is unavailable, and NEVER zero. */
const engagementMeasure = (
  value: number | null | undefined,
  availability: EngagementAvailabilityView | undefined,
): string => (availability === 'available' && value != null
  ? value.toLocaleString('en-US')
  : 'Not collected (never shown as zero)');

const listingEventLine = (event: ListingEventView): string =>
  [event.date, event.event, event.price != null ? usd(event.price) : null].filter(Boolean).join(' · ');

/** A listing that did not report a feature is unreported, not a denial. */
const listingReported = (value: boolean | null | undefined): string | null =>
  (value === true ? 'Reported present' : value === false ? 'Reported absent' : null);

/**
 * Structures captured from an unpunctuated marketplace page can be the whole
 * document, navigation included. A retained value that long is not concise
 * property evidence, so it is omitted here rather than shown to the operator:
 * "No additional structure published" is the honest read of a value LandOS
 * cannot present. Newly captured, clause-bounded values pass through untouched.
 */
const STRUCTURE_MAX_WORDS = 30;
const STRUCTURE_MAX_CHARS = 240;
const conciseStructures = (structures: string[]): string[] => {
  const kept = structures.filter((structure) => structure.trim().split(/\s+/).length <= STRUCTURE_MAX_WORDS);
  // Many short fragments still add up to a page dump once joined, so the whole
  // value is dropped unless it reads as concise structure evidence.
  return kept.join(', ').length <= STRUCTURE_MAX_CHARS ? kept : [];
};

const ACCESS_TIER_LABEL = {
  parcel_flag: 'LandPortal parcel flag',
  apparent_physical: 'Apparent physical route',
  reported_legal: 'Reported legal / easement access',
  verified_legal: 'Verified recorded legal access',
} as const;

/**
 * The same four rungs, read as the two different questions they answer. What
 * can be seen never migrates into what is legally held.
 */
const ACCESS_GROUPS = [
  {
    key: 'physical',
    title: 'Physical access evidence — what the retained evidence shows, never legal proof',
    tiers: ['parcel_flag', 'apparent_physical'] as Array<keyof typeof ACCESS_TIER_LABEL>,
  },
  {
    key: 'legal',
    title: 'Legal access status — only what a source reports or a recorded instrument proves',
    tiers: ['reported_legal', 'verified_legal'] as Array<keyof typeof ACCESS_TIER_LABEL>,
  },
] as const;

function fmtMetric(key: keyof MarketContextMetricsView, v: number | null): string | null {
  if (v === null) return null;
  if (key === 'medianPrice' || key === 'medianPricePerAcre') return usd(v);
  if (key === 'sellThroughRate' || key === 'absorptionRate' || key === 'populationGrowth') return `${v}%`;
  if (key === 'medianDaysOnMarket') return `${Math.round(v)} days`;
  if (key === 'monthsOfSupply') return `${v} mo`;
  return Math.round(v).toLocaleString('en-US');
}

/** missingInformation entries arrive as strings or labeled objects. */
function missingLabel(entry: unknown): string | null {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    const o = entry as Record<string, unknown>;
    for (const k of ['label', 'area', 'summary', 'detail', 'reason']) {
      if (typeof o[k] === 'string' && (o[k] as string).trim()) return o[k] as string;
    }
  }
  return null;
}

const GALLERY_ORDER = [
  'inspection-close_parcel_aerial', 'inspection-road_frontage_aerial', 'inspection-parcel_context',
  'inspection-default_3d', 'inspection-front_side_3d', 'inspection-rear_side_3d',
  'inspection-street_view', 'inspection-street_view_2', 'inspection-street_view_3',
  'inspection-street_view_4', 'inspection-street_view_5',
  'inspection-buildability', 'inspection-wetlands_overlay',
  'inspection-fema_flood_overlay', 'inspection-soil_overlay', 'inspection-contour_terrain_view',
  'inspection-comps_map',
];

function Kv({ k, v, empty }: { k: string; v: string | null | undefined; empty?: string }) {
  return (
    <>
      <span class="k">{k}</span>
      {v ? <span class="v">{v}</span> : <span class="v empty">{empty || 'Not supplied by retained sources'}</span>}
    </>
  );
}

function MarketCard({ rec }: { rec: MarketContextRecordView }) {
  const rows: Array<[string, keyof MarketContextMetricsView]> = [
    ['Sold', 'soldCount'], ['Active', 'activeCount'], ['Median DOM', 'medianDaysOnMarket'],
    ['Sell-through', 'sellThroughRate'], ['Absorption', 'absorptionRate'], ['Months of supply', 'monthsOfSupply'],
    ['Median price', 'medianPrice'], ['Median $/acre', 'medianPricePerAcre'],
    ['Population', 'population'], ['Pop. growth', 'populationGrowth'],
  ];
  return (
    <div class={`awv2-mkt-card${rec.available ? '' : ' unavailable'}`}>
      <div class="h">{rec.label}</div>
      <div class="p">{rec.period ? `Period ${rec.period}` : 'No period'}{rec.snapshotDate ? ` · captured ${rec.snapshotDate.slice(0, 10)}` : ''}</div>
      {rec.available && rec.metrics ? (
        <div class="rows">
          {rows.map(([label, key]) => {
            const v = fmtMetric(key, rec.metrics ? rec.metrics[key] : null);
            return (
              <>
                <span class="k">{label}</span>
                {v ? <span class="v">{v}</span> : <span class="v empty">Unknown</span>}
              </>
            );
          })}
        </div>
      ) : (
        <div class="miss">{rec.note}</div>
      )}
    </div>
  );
}

// ── Section ────────────────────────────────────────────────────────────

export function PropertyIntelligenceSection({ snap, market, soils, streetView, vba, missingDiligence, accessView, soilsSeptic, narrative, dealId, officialParcelGis, landUse, landUseIntelligence, exactAddressListings, researchStatus: researchStatusProp, valuationSummary, landPortalFacts, taxStatus, acquisitionIntelligence, developmentIntelligence }: {
  snap: PiSnapshot;
  /**
   * The persisted Acquisition Intelligence read and its controls.
   *
   * Property & Market is where the evidence lives, so this is where the
   * analyst's interpretation of that evidence belongs: each section shows the
   * few retained insights that are ABOUT its own subject, and the complete
   * structured read stays whole behind one expansion at the end. Rendering
   * never starts a reasoning run.
   */
  acquisitionIntelligence?: {
    read: AcquisitionIntelligenceView | null;
    readiness: AcquisitionIntelligenceReadiness | null;
    runtime: AcquisitionIntelligenceRuntimeStatus | null;
    stale: boolean;
    running: boolean;
    error: string | null;
    onRun: () => void;
  } | null;
  /** Payment status from the collecting office, or the sources attempted. */
  taxStatus?: TaxStatusView | null;
  /**
   * The canonical retained LandPortal parcel fact sheet. The snapshot's
   * `lp_sidebar_*` facts are a sparse DISCOVERY-STAGE subset of it — on a real
   * card they carry two or three fields — so reading only those reported
   * retained terrain, water, improvement, parcel-context and frontage evidence
   * as "not supplied by retained sources" while this sheet held every one.
   */
  landPortalFacts?: ParcelFactSheetView | null;
  market: MarketContextView | null;
  soils: SoilDetail[] | null;
  streetView: StreetViewView | null;
  vba: VisualBuyerAnalysisView | null;
  missingDiligence: MissingDiligenceView | null;
  accessView?: AccessPresentationView | null;
  soilsSeptic?: SoilsSepticView | null;
  narrative?: VisualBuyerNarrativeView | null;
  dealId?: number;
  officialParcelGis?: OfficialParcelGisView | null;
  landUse?: LandUseView | null;
  landUseIntelligence?: RetainedLandUseIntelligenceView | null;
  exactAddressListings?: ExactAddressListingsView | null;
  researchStatus?: ResearchStatusView | null;
  valuationSummary?: CvSummary | null;
  developmentIntelligence?: DevelopmentIntelligenceView | null;
}) {
  // Same-page evidence viewer: index into the ordered gallery, or null.
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const id = snap.identity || {};
  const address = id.displayAddress || '';
  // The reconciled record first; the address string is only a fallback for
  // records that predate identity reconciliation. Parsing the intake string is
  // exactly how a superseded ZIP kept being shown as the subject's ZIP.
  const zip = id.zip || num(address, /\b(\d{5})\s*$/);
  const street = address.split(',')[0]?.trim() || '';
  const roadName = street.replace(/^\d+\s+/, '');

  // Acreage values with source, straight from graded facts.
  const facts = snap.facts || [];
  const fact = (key: string): PiFact | undefined => facts.find((f) => f.key === key);
  // Retained LandPortal sidebar values (discovery-stage source, verbatim).
  const sidebar = (name: string): string | null => fact(`lp_sidebar_${name}`)?.value || null;
  const firstFact = (...keys: string[]): string | null => {
    for (const key of keys) {
      const retained = fact(key)?.value;
      if (retained) return retained;
    }
    return null;
  };
  // ── ONE retained LandPortal record ────────────────────────────────────────
  // The canonical parcel fact sheet answers first; the sparse discovery-stage
  // `lp_sidebar_*` facts remain a fallback for cards captured before the sheet
  // existed. Reading the subset alone is exactly how retained terrain, water,
  // improvement and parcel-context evidence read as "Not supplied".
  const lpf = landPortalFacts ?? null;
  const sheet = (value: string | null | undefined): string | null => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text || /^needs verification$/i.test(text)) return null;
    return text;
  };
  const terrainQuarantine = lpf?.terrainQuarantine ?? null;
  const waterFeature = sheet(lpf?.water?.label) ?? sidebar('water_feature_type');
  const zoningCode = sheet(lpf?.parcelContext?.zoning) ?? sidebar('zoning_code');
  const femaDescription = sheet(lpf?.environment?.femaFloodZoneDescription) ?? sidebar('fema_flood_zone_description');
  const landPortalTerrain = sheet(lpf?.terrain?.label)
    ?? firstFact('lp_sidebar_terrain', 'lp_sidebar_terrain_type', 'lp_sidebar_topography');
  const landPortalSlope = sheet(lpf?.terrain?.slopeAvgPct)
    ?? firstFact('lp_sidebar_slope', 'lp_sidebar_average_slope', 'lp_sidebar_slope_description');
  const landPortalBuildability = sheet(lpf?.buildability?.label)
    ?? firstFact('lp_sidebar_buildability', 'lp_sidebar_buildable_area', 'lp_sidebar_buildability_pct');
  const landPortalWetlands = sheet(lpf?.environment?.wetlandsPct)
    ?? firstFact('lp_sidebar_wetlands', 'lp_sidebar_wetlands_pct', 'lp_sidebar_wetland_type');
  const landPortalSoils = sheet(lpf?.soils?.label)
    ?? firstFact('lp_sidebar_soils', 'lp_sidebar_soil_type', 'lp_sidebar_soil_description');
  const landPortalFrontage = sheet(lpf?.access?.roadFrontage)
    ?? firstFact('lp_sidebar_frontage', 'lp_sidebar_road_frontage');
  const developmentDossier = accessView?.developmentIntelligence ?? developmentIntelligence ?? null;
  const officialNoCurrentBuilding = /no_current_building|no buildings/i.test(developmentDossier?.currentTruth.improvementStatus ?? '');
  const supersededProviderImprovement = sheet(lpf?.improvement?.label)
    ?? firstFact('lp_sidebar_improvements', 'lp_sidebar_improvement_type', 'lp_sidebar_building_sqft');
  const landPortalImprovement = officialNoCurrentBuilding ? null : supersededProviderImprovement;
  const landPortalParcelContext = sheet(lpf?.parcelContext?.label)
    ?? firstFact('lp_sidebar_parcel_context', 'lp_sidebar_land_use', 'lp_sidebar_property_type');
  const landPortalSlopeUnder10 = sheet(lpf?.terrain?.slopeUnder10Pct);
  const landPortalElevation = lpf?.terrain?.elevationAvg && lpf?.terrain?.elevationMin && lpf?.terrain?.elevationMax
    ? `${lpf.terrain.elevationAvg} average (${lpf.terrain.elevationMin} to ${lpf.terrain.elevationMax})`
    : sheet(lpf?.terrain?.elevationAvg);
  const lastSalePrice = sheet(lpf?.valuation?.lastSalePriceLabel) ?? sidebar('last_sale_price');
  const lastSaleDate = sheet(lpf?.valuation?.lastSaleDate) ?? sidebar('last_sale_date');
  const bookNumber = sidebar('book_number');
  const pageNumber = sidebar('page_number');
  const assessedValue = sheet(lpf?.valuation?.assessedValue) ?? sidebar('assessed_value');
  const totalMarketValue = sheet(lpf?.valuation?.totalMarketValue);
  const taxAmount = sheet(lpf?.valuation?.taxAmount);
  const lpEstimatePrice = sheet(lpf?.valuation?.lpEstimatePrice) ?? fact('lpEstimateTotal')?.value ?? null;
  const lpEstimatePpa = sheet(lpf?.valuation?.lpEstimatePpa) ?? fact('lpEstimatePerAcre')?.value ?? null;
  const yearBuilt = sheet(lpf?.improvement?.yearBuilt);
  const lastSalePriceUsd = lastSalePrice && /^[\d,.]+$/.test(lastSalePrice.trim())
    ? usd(Number(lastSalePrice.replace(/,/g, '')))
    : null;
  const acreageFacts: Array<{ label: string; fact: PiFact | undefined }> = [
    { label: 'Official record', fact: fact('discovery_official_record_acres') },
    { label: 'Verified LandPortal import', fact: fact('acres') },
    { label: 'Operator input', fact: fact('discovery_operator_input_acres') },
    { label: 'LandPortal parcel panel', fact: fact('discovery_marketplace_parcel_panel_acres') },
  ].filter((e) => e.fact);
  const acreNumbers = acreageFacts
    .map((e) => Number(num(e.fact?.value ?? '', /([\d.]+)/)))
    .filter((value) => Number.isFinite(value));
  const acreConflict = acreNumbers.some((value) => Math.abs(value - acreNumbers[0]) > 0.01);

  const dd = new Map<string, PiDdItem>((snap.dueDiligence || []).map((x) => [x.key, x]));
  const access = dd.get('access');
  const terrain = dd.get('terrain');
  const wetlands = dd.get('wetlands');
  const flood = dd.get('flood');
  const utilities = dd.get('utilities');
  const zoning = dd.get('zoning');
  const septic = dd.get('septic');

  const frontageFt = num(access?.headline, /([\d.]+)\s*ft frontage/);
  const slopePct = num(terrain?.headline, /([\d.]+)%\s*average slope/);
  const buildPct = num(terrain?.headline, /([\d.]+)%\s*buildability/);
  const wetPct = num(wetlands?.headline, /([\d.]+)%/);
  const floodPct = num(flood?.headline, /(\d+(?:\.\d+)?)/);
  const acres = id.acres ?? null;

  const evidence = (snap.evidence || []).filter((e) => e.viewUrl);
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const gallery = [
    ...GALLERY_ORDER.map((gid) => byId.get(gid)).filter((e): e is PiEvidenceItem => !!e),
    ...evidence.filter((e) => !GALLERY_ORDER.includes(e.id)),
  ];
  const overview = byId.get('inspection-landportal_overview') ?? byId.get('inspection-parcel_context') ?? null;
  const hasDefault3d = byId.has('inspection-default_3d');
  const has3d = hasDefault3d || byId.has('inspection-front_side_3d') || byId.has('inspection-rear_side_3d');
  const hasBuildabilityCapture = byId.has('inspection-buildability');
  const hasStreetViewCapture = byId.has('inspection-street_view');
  const supportedStreetObservations = hasStreetViewCapture
    ? (streetView?.observations ?? []).filter((observation) => !!observation.evidence?.trim() && !/unavailable/i.test(observation.label))
    : [];

  const comps = snap.comps || {};
  const researchStatus = researchStatusProp ?? snap.researchStatus;
  const accessRungs = accessView?.evidence?.rungs ?? ([
    ['parcel_flag', 'LandPortal parcel flag'],
    ['apparent_physical', 'Apparent physical route'],
    ['reported_legal', 'Reported legal / easement access'],
    ['verified_legal', 'Verified recorded legal access'],
  ] as const).map(([tier, label]) => {
    const item = accessView?.evidence?.byTier?.[tier]?.[0];
    return {
      tier,
      statement: item?.statement || `${label}: no evidence retained.`,
      sourceLabel: item?.sourceLabel,
      basis: item?.basis,
      weight: item?.weight,
      sourceUrl: item?.sourceUrl,
    };
  });
  const listingSources = exactAddressListings?.sources ?? [];
  // The reconciled subject decides which record is current. Picking whichever
  // source happened to sort first is exactly how a stale off-market duplicate
  // kept speaking for an actively listed property.
  const reconciliation = exactAddressListings?.reconciliation ?? null;
  const listingCard = exactAddressListings?.listingCard ?? null;
  const currentRecordUrl = reconciliation?.currentRecord?.sourceUrl ?? listingCard?.listingUrl ?? null;
  const primaryListing = listingSources.find((source) => source.sourceUrl === currentRecordUrl)
    ?? listingSources[0]
    ?? null;
  const listingPhotoUrls = [...new Set((listingCard
    ? [listingCard.primaryPhotoUrl, ...(listingCard.additionalPhotoUrls ?? [])]
    : (primaryListing?.photoUrls ?? [])).filter((url): url is string => !!url))];
  const listingPhotos: CvCompPhoto[] = listingPhotoUrls.map((url, index) => ({
    url: url.startsWith('/api/') ? tok(url) : url,
    sequence: index + 1,
    label: index === 0 ? 'Primary listing photograph' : `Listing photograph ${index + 1}`,
    provider: listingCard?.sourceLabel ?? primaryListing?.sourceLabel ?? 'Listing source',
    context: index === 0 ? 'hero' : 'gallery',
  }));
  const engagementSignals = listingCard?.engagementByProvider
    ?? (primaryListing?.engagement ? [primaryListing.engagement] : []);
  const improvementFacts = listingCard?.improvementFacts ?? null;
  // Driveway and directions wording is tier-2 support and is rendered in the
  // access ladder only, so the same sentence never appears in two panels.
  const listingAccessWording = [...new Set([
    ...(listingCard?.drivewayStatements ?? primaryListing?.drivewayStatements ?? []),
    ...(listingCard?.directionsStatements ?? primaryListing?.directionsStatements ?? []),
  ].filter((text) => !!text?.trim()))];
  const listingUtilities = improvementFacts?.utilities ?? primaryListing?.utilities ?? [];
  const canonicalAcres = acres == null ? null : `${Number(acres).toLocaleString('en-US', { maximumFractionDigits: 2 })} AC`;

  // Missing diligence, grouped once, honestly.
  const missing: string[] = [];
  for (const item of [zoning, utilities, septic]) {
    if (item && (item.verdict === 'unknown' || item.verdict === 'unresolved')) missing.push(item.label);
  }
  for (const m of access?.missing || []) missing.push(m);
  for (const entry of snap.missingInformation || []) {
    const label = missingLabel(entry);
    if (label && !missing.includes(label)) missing.push(label);
  }
  if (!waterFeature) missing.push('Water features');
  if (!officialNoCurrentBuilding && !(improvementFacts?.buildingSqft ?? primaryListing?.buildingSqft) && !landPortalImprovement) missing.push('Building information');
  if (!byId.has('inspection-parcel_context')) missing.push('Wider-context aerial');
  if (!hasStreetViewCapture && streetView?.available !== false) missing.push('Street View capture');
  if (!hasBuildabilityCapture && !landPortalBuildability) missing.push('Dedicated buildability capture');

  // ── Diligence-workspace derivations ──────────────────────────────────
  // Conclusions, figures and the analyst's per-topic read. Every one of these
  // reads a value this component already had; none of them fetches, derives a
  // new fact, or reruns anything.
  const aiRead = acquisitionIntelligence?.read ?? null;

  // Two retained sources state this parcel's frontage and they disagree
  // (mapped parcel frontage vs the reconciled access read). Printing both
  // numbers with no explanation is what made the page unreadable; the span is
  // stated once, as a conflict, with what would settle it.
  const accessFrontageFt = accessView?.frontageFt ?? null;
  const sheetFrontageFt = lpf?.access?.roadFrontageFt ?? null;
  const frontageConflict = accessFrontageFt != null && sheetFrontageFt != null
    && Math.abs(accessFrontageFt - sheetFrontageFt) > Math.max(1, 0.05 * Math.max(accessFrontageFt, sheetFrontageFt));
  const frontageSpan = frontageConflict
    ? `~${Math.min(accessFrontageFt!, sheetFrontageFt!).toLocaleString('en-US', { maximumFractionDigits: 2 })}–${Math.max(accessFrontageFt!, sheetFrontageFt!).toLocaleString('en-US', { maximumFractionDigits: 2 })} ft`
    : null;
  const workingFrontage = frontageConflict
    ? frontageSpan!
    : landPortalFrontage
      || (accessFrontageFt != null ? `${accessFrontageFt.toLocaleString('en-US', { maximumFractionDigits: 2 })} ft` : null)
      || (frontageFt ? `${Math.round(Number(frontageFt))} ft` : null);

  const accessMetrics: DxMetric[] = [
    {
      label: 'Provider / physical signal',
      value: accessView?.providerSignal === 'mapped_frontage_not_landlocked' ? 'Mapped frontage; not flagged landlocked' : accessView?.providerSignal === 'landlocked_flag' ? 'Landlocked flag reported' : 'Unresolved',
      sub: accessView?.evidence?.parcelFlagged ? 'parcel flagged landlocked' : lpf?.access?.landLocked ? `landlocked: ${lpf.access.landLocked}` : null,
      tone: accessView?.providerSignal === 'landlocked_flag' ? 'warn' : 'neutral',
    },
    { label: 'Working frontage', value: workingFrontage ?? '', sub: frontageConflict ? 'sources conflict' : landPortalFrontage ? 'mapped parcel frontage' : null, tone: frontageConflict ? 'warn' : 'neutral' },
    { label: 'Road', value: accessView?.road || roadName || '', sub: roadName ? 'situs road' : null },
    { label: 'Recorded legal access', value: accessView?.legalAccess || 'Not verified', sub: 'requires a retained recorded instrument or title confirmation', tone: accessView?.established ? 'good' : 'warn' },
  ];

  const terrainMetrics: DxMetric[] = [
    { label: 'Average slope', value: landPortalSlope || (slopePct ? `${slopePct}%` : ''), sub: 'LandPortal' },
    { label: 'Under 10% slope', value: landPortalSlopeUnder10 || '', sub: 'of the parcel' },
    { label: 'Buildable', value: lpf?.buildability?.pct || landPortalBuildability || (buildPct ? `${buildPct}%` : ''), sub: lpf?.buildability?.acres || null },
    { label: 'FEMA flood', value: lpf?.environment?.femaCoveragePct || (floodPct ? `${floodPct}%` : ''), sub: 'mapped coverage' },
    { label: 'Wetlands', value: lpf?.environment?.wetlandsPct || landPortalWetlands || (wetPct ? `${wetPct}%` : ''), sub: 'mapped coverage' },
    { label: 'Water feature', value: waterFeature || '', sub: 'LandPortal' },
  ];

  const utilityMetrics: DxMetric[] = [
    { label: 'Utilities', value: utilities?.headline || 'Not established', tone: utilities?.headline ? 'neutral' : 'warn' },
    { label: 'Septic outlook', value: soilsSeptic?.categoryLabel || septic?.headline || 'Field testing required', tone: soilsSeptic && /favorable|suitable/i.test(soilsSeptic.categoryLabel) ? 'good' : 'warn' },
    { label: 'Listing-reported', value: listingUtilities.length ? listingUtilities.join(', ') : '', sub: 'listing weight' },
  ];

  // One ranked queue instead of a page of "not established" rows. Everything
  // the reconciled checklist tracks that the queue does not show stays in the
  // Missing diligence panel below it; nothing is dropped here.
  const queue = diligencePriorities(aiRead, missing);

  return (
    <>
      {(developmentIntelligence ?? accessView?.developmentIntelligence) && <DevelopmentIntelligencePanel dossier={(developmentIntelligence ?? accessView?.developmentIntelligence)!} />}
      {/* ── Subject summary ── */}
      <div class="awv2-pi-questions">
        <section data-domain="property" class="awv2-panel awv2-pi-subject" id="pi-subject">
          <div class="awv2-panel-title">Subject</div>
          <div class="awv2-kv">
            <Kv k="Address" v={address} />
            <Kv k="Owner of record" v={id.owner || null} />
            <Kv k="APN" v={id.apn || null} />
            <Kv k="Acreage" v={canonicalAcres} />
            <Kv k="County" v={id.county ? `${id.county} County` : null} />
            <Kv k="Municipality / jurisdiction" v={id.city || null} empty="Not yet resolved" />
            <Kv k="State" v={id.state_ || null} />
            <Kv k="ZIP" v={zip} />
          </div>
          <details class="awv2-collapse awv2-pi-provenance">
            <summary>Identity provenance</summary>
            <div class="awv2-pi-note">
              Acreage basis: {id.acreageBasis || 'not stated'} · {acreageFacts.length} retained source observation(s)
              {acreConflict ? ' · a material conflict remains in source evidence' : ' · numerically equivalent observations reconciled'}.
              {id.lpPropertyId ? ` LandPortal parcel ${id.lpPropertyId}.` : ''}
            </div>
            {(id.conflicts || []).map((c) => <div class="awv2-pi-note">Conflict: {c}</div>)}
          </details>
          {valuationSummary && <p class="awv2-pi-note">Canonical valuation state: {valuationSummary.acceptedCount} accepted comp{valuationSummary.acceptedCount === 1 ? '' : 's'} · {valuationSummary.status}.</p>}
        </section>

        {/* ── Current public listing ──
            One block: the reconciled subject's live market state and the money
            facts attached to it. What the listing SAYS the property is lives in
            the next panel, its photographs in the one after that, and its
            access wording only in the access ladder. Nothing is repeated. */}
        {exactAddressListings ? (
          <section data-domain="evidence" class="awv2-panel awv2-listing-card" id="exact-address-listing-evidence">
            <div class="awv2-panel-title">
              Current public listing
              <span class="awv2-src-tag">Exact-address web discovery · {exactAddressListings.status}</span>
            </div>
            {listingCard ? (
              <>
                <div class={`awv2-listing-status ${listingCard.onMarket ? 'on-market' : 'off-market'}`}>
                  <strong>{listingCard.statusLabel}</strong>
                  <span>{listingCard.currentPrice != null ? usd(listingCard.currentPrice) : 'No asking price published'}</span>
                </div>
                <div class="awv2-pi-note">{listingCard.statusNote}</div>
                <div class="awv2-listing-metrics">
                  <div><span>Current asking price</span><b>{listingCard.currentPrice != null ? usd(listingCard.currentPrice) : 'Unavailable'}</b></div>
                  <div><span>Original list price</span><b>{listingCard.originalListPrice != null ? usd(listingCard.originalListPrice) : 'Unavailable'}</b></div>
                  <div>
                    <span>Listing age</span>
                    <b>{listingCard.listingAgeDays != null ? `${listingCard.listingAgeDays} days` : 'Unavailable'}</b>
                    <small>{listingCard.listingAgeBasis === 'reported'
                      ? 'Days on market as the listing reports it'
                      : listingCard.listingAgeBasis === 'derived_from_listing_date'
                        ? `Derived from the listing date${listingCard.listingDate ? ` ${listingCard.listingDate}` : ''}`
                        : 'Neither days on market nor a listing date was published'}</small>
                  </div>
                  <div><span>Acreage (listing-reported)</span><b>{listingCard.acres != null ? `${listingCard.acres.toLocaleString('en-US', { maximumFractionDigits: 2 })} AC` : 'Unavailable'}</b></div>
                  <div>
                    <span>MLS number</span>
                    <b>{listingCard.mlsNumbers.length ? listingCard.mlsNumbers.join(' · ') : listingCard.mls || 'Unavailable'}</b>
                    {listingCard.mlsNumbers.length > 1 && <small>One physical property published by more than one MLS feed.</small>}
                  </div>
                  {/* One listing routinely publishes the agent as its brokerage
                      line too, so the same name is not printed twice. */}
                  <div><span>Brokerage / listing agent</span><b>{[...new Set([listingCard.brokerage, listingCard.listingAgent].filter(Boolean))].join(' · ') || 'Unavailable'}</b></div>
                </div>
                {listingCard.priceHistory.length > 0 && (
                  <div class="awv2-listing-history">
                    <b>{listingCard.priceChanges.length ? `${listingCard.priceChanges.length} retained price change(s)` : 'Retained listing events'}</b>
                    {listingCard.priceHistory.map((event) => <div class="awv2-sv-basis">{listingEventLine(event)}</div>)}
                  </div>
                )}
                <div class="awv2-listing-engagement">
                  {engagementSignals.length > 0 ? engagementSignals.map((signal) => (
                    <div class="awv2-listing-engagement-row">
                      <b>{signal.sourceLabel} engagement</b>
                      <span>Views: {engagementMeasure(signal.views, signal.viewsAvailability)}</span>
                      <span>Saves: {engagementMeasure(signal.saves, signal.savesAvailability)}</span>
                      <span>Photos: {engagementMeasure(signal.photoCount, signal.photoCountAvailability)}</span>
                      <span>Price changes: {engagementMeasure(signal.priceChangeCount, signal.priceChangeAvailability)}</span>
                      <span class="awv2-sv-basis">Engagement retrieved {signal.retrievedAt || 'time unavailable'} · interest signal, not proof of value.</span>
                    </div>
                  )) : <div class="awv2-pi-note">No provider published engagement for this subject: Not collected (never shown as zero).</div>}
                  <div class="awv2-sv-basis">{listingCard.engagementNote}</div>
                </div>
                <a class="awv2-listing-link" href={listingCard.listingUrl} target="_blank" rel="noreferrer">Open {listingCard.sourceLabel} listing</a>
                {listingCard.additionalSourceUrls.length > 0 && (
                  <div class="awv2-sv-basis">
                    {listingCard.additionalSourceUrls.length} further retained record(s) of the same physical subject:{' '}
                    {listingCard.additionalSourceUrls.map((url, index) => <><a href={url} target="_blank" rel="noreferrer">record {index + 1}</a>{' '}</>)}
                  </div>
                )}
                {listingCard.supplementedFrom.length > 0 && (
                  <div class="awv2-sv-basis">Stable facts were filled from {listingCard.supplementedFrom.join(', ')}; status, price and dates come only from the current record.</div>
                )}
              </>
            ) : (
              <div class="awv2-pi-note">{exactAddressListings.note || 'No property-specific listing page was retained.'}</div>
            )}
            {reconciliation && (
              <details class="awv2-collapse awv2-listing-details">
                <summary>How these records reconciled into one physical subject</summary>
                <div class="awv2-pi-note" data-testid="ea-reconciliation">{reconciliation.statement}</div>
                <div class="awv2-pi-note">{reconciliation.canonical.identityNote}</div>
                {reconciliation.currentRecord && (
                  <div class="awv2-pi-note" data-testid="ea-current-record">
                    <b>Current record — {reconciliation.currentRecord.sourceLabel}</b> ({reconciliation.currentRecord.listingStatusLabel}): {reconciliation.currentRecord.reason}
                  </div>
                )}
                {reconciliation.supersededRecords.map((record) => (
                  <div class="awv2-pi-note" data-testid="ea-superseded-record">
                    <b>{record.sourceLabel}</b> ({record.listingStatusLabel}): {record.reason} <a href={record.sourceUrl} target="_blank" rel="noreferrer">source</a>
                  </div>
                ))}
                {reconciliation.otherRecords.map((record) => (
                  <div class="awv2-pi-note" data-testid="ea-other-record">
                    <b>{record.sourceLabel}</b> ({record.listingStatusLabel}): {record.reason} <a href={record.sourceUrl} target="_blank" rel="noreferrer">source</a>
                  </div>
                ))}
              </details>
            )}
            <details class="awv2-collapse awv2-listing-details">
              <summary>Retained records and source provenance</summary>
              {listingSources.map((source) => (
                <div class="awv2-pi-note" data-testid="ea-listing-source">
                  <b>{source.sourceLabel}</b> · {source.listingStatusLabel || source.listingStatus || 'Status not published'} · {source.provenanceNote} <a href={source.sourceUrl} target="_blank" rel="noreferrer">source</a>
                </div>
              ))}
              <div class="awv2-pi-note">{exactAddressListings.disclaimer}</div>
            </details>
          </section>
        ) : (
          <section data-domain="evidence" class="awv2-panel" id="exact-address-listing-evidence">
            <div class="awv2-panel-title">Current public listing</div>
            <div class="awv2-pi-note">Exact-address discovery has not returned a retained public-property result yet.</div>
          </section>
        )}

        {/* ── Listing-reported property intelligence ──
            What the listing SAYS the property is, kept at listing weight. It is
            never promoted into an assessor, government or recorded fact. */}
        {listingCard && improvementFacts && (
          <section data-domain="evidence" class="awv2-panel" id="listing-reported-intelligence">
            <div class="awv2-panel-title">
              Listing-reported property intelligence
              <span class="awv2-src-tag">{listingCard.evidenceLabel} · never an assessor or recorded fact</span>
            </div>
            {officialNoCurrentBuilding && <div class="awv2-pi-note"><b>Superseded for current-property truth:</b> the official current parcel reconciliation establishes no current building. These listing/provider fields remain visible as conflicting historical evidence only.</div>}
            <div class="awv2-kv">
              <Kv k="Property / improvement type" v={improvementFacts.propertyType} empty="Not published by the listing" />
              <Kv k="Building sqft" v={improvementFacts.buildingSqft != null ? `${improvementFacts.buildingSqft.toLocaleString('en-US')} sqft` : null} empty="Not published by the listing" />
              <Kv k="Beds / baths" v={improvementFacts.beds != null || improvementFacts.baths != null
                ? [improvementFacts.beds != null ? `${improvementFacts.beds} beds` : null, improvementFacts.baths != null ? `${improvementFacts.baths} baths` : null].filter(Boolean).join(' · ')
                : null} empty="Not published by the listing" />
              <Kv k="Year built" v={improvementFacts.yearBuilt != null ? String(improvementFacts.yearBuilt) : null} empty="Not published by the listing" />
              <Kv k="Structures" v={conciseStructures(improvementFacts.structures).join(', ') || null} empty="No additional structure published" />
              <Kv k="Utilities" v={listingUtilities.length ? listingUtilities.join(', ') : null} empty="No utility detail published" />
              <Kv k="Well" v={listingReported(improvementFacts.well)} empty="Not published by the listing" />
              <Kv k="Septic" v={listingReported(improvementFacts.septic)} empty="Not published by the listing" />
            </div>
            {listingCard.features.length > 0 && <div class="awv2-pi-note">Notable listing-reported features: {listingCard.features.join(' · ')}</div>}
            {exactAddressListings?.subjectRead && (
              <div class="awv2-pi-note" data-testid="ea-subject-read"><b>Resolved subject context:</b> {exactAddressListings.subjectRead.statement}</div>
            )}
            {listingCard.description && (
              <details class="awv2-collapse awv2-listing-details">
                <summary>Listing description, verbatim</summary>
                <p>{listingCard.description}</p>
              </details>
            )}
          </section>
        )}

        {/* ── Listing imagery ──
            Subject evidence, not decoration, rendered through the existing
            gallery. An absent photograph stays absent: no substitution. */}
        {listingCard && (
          <section data-domain="evidence" class="awv2-panel" id="listing-imagery">
            <div class="awv2-panel-title">
              Listing imagery
              <span class="awv2-src-tag">{listingCard.evidenceLabel} · {listingPhotos.length} retained photograph{listingPhotos.length === 1 ? '' : 's'}</span>
            </div>
            {listingPhotos.length > 0 ? (
              <>
                <AcquisitionWorkspaceV2CompPhotoGallery
                  photos={listingPhotos}
                  address={address || 'the subject property'}
                  sourcePage={listingCard.listingUrl}
                  provider={listingCard.sourceLabel}
                  fallbackNote={null}
                />
                <div class="awv2-sv-basis">Listing photography supports apparent physical condition and access only. It never establishes a legal, recorded or government fact.</div>
              </>
            ) : (
              <div class="awv2-pi-note">No listing photograph was retained for this subject, so none is shown. LandOS never substitutes another property&apos;s photograph.</div>
            )}
          </section>
        )}

        {/* ── Access & road frontage ──
            Physical evidence and legal status are read as two different
            questions, so an observed entrance can never be mistaken for a
            recorded right. Listing driveway and directions wording appears
            once, as tier-2 support, and nowhere else on this page. */}
        <section data-domain="property" class="awv2-panel" id="access-road-frontage">
          <div class="awv2-panel-title">Access &amp; road frontage</div>
          {/* Conclusion first. Provider proximity, recorded legal access,
              surveyed frontage, and a physical entrance remain separate. */}
          {accessView?.established && !accessView?.evidence?.parcelFlagged ? (
            <Conclusion
              label="Access"
              value="Established"
              tone="good"
              note={`${accessView.legalAccess ?? 'Verified by retained recorded evidence'}. Provider and physical signals are shown separately.`}
              testId="pi-access-established"
            />
          ) : (
            <Conclusion
              label="Access"
              value="Unresolved"
              tone="warn"
              note={accessView?.evidence?.operatorConclusion || 'Physical access evidence remains incomplete for this parcel.'}
            />
          )}
          <MetricRow metrics={accessMetrics} label="Access and frontage figures" />
          {/* Two retained sources state the frontage and they disagree. One
              reconciled span, said once, with what would settle it — never two
              unexplained numbers in two panels. */}
          {frontageConflict && (
            <ConflictBanner
              subject="Mapped frontage"
              span={frontageSpan!}
              resolution="Exact surveyed frontage and recorded legal access require separate confirmation. Narrow or uncertain frontage may materially affect subdivision or development."
            />
          )}
          <WhatItMeans read={aiRead} topic="access" />
          <StillNeeded read={aiRead} topic="access" extra={(access?.missing || []).slice(0, 2)} />
          <Disclosure label="Access evidence ladder and sources" count={accessRungs.length}>
            <div class="awv2-access-ladder" aria-label="Four-part access evidence ladder">
              {ACCESS_GROUPS.map((group) => (
                <div class={`awv2-access-group ${group.key}`}>
                  <div class="awv2-access-group-title">{group.title}</div>
                  {accessRungs.map((rung, index) => (
                    group.tiers.includes(rung.tier) ? (
                      <div class="awv2-access-rung">
                        <span class="step">{index + 1}</span>
                        <div><b>{ACCESS_TIER_LABEL[rung.tier]}</b><p>{rung.statement}</p></div>
                        <span class="weight">{rung.weight || 'Unresolved'}</span>
                      </div>
                    ) : null
                  ))}
                  {group.key === 'physical' && listingAccessWording.length > 0 && listingAccessWording.map((text) => (
                    <div class="awv2-sv-basis">Listing-reported driveway / directions wording, supporting apparent physical access only: “{text}”</div>
                  ))}
                </div>
              ))}
            </div>
            {accessView?.evidence?.operatorConclusion
              && <div class="awv2-pi-note"><b>Reconciled operator read:</b> {accessView.evidence.operatorConclusion}</div>}
            <details class="awv2-collapse awv2-access-details">
              <summary>Access sources and unresolved diligence</summary>
              {accessRungs.map((rung) => <div class="awv2-pi-note">{rung.sourceLabel || 'No source retained'}{rung.basis ? ` · ${rung.basis.replace(/_/g, ' ')}` : ''}{rung.sourceUrl ? <> · <a href={rung.sourceUrl} target="_blank" rel="noreferrer">source</a></> : null}</div>)}
            </details>
            {(access?.missing || []).length > 0 && (
              missingDiligence
                ? <div class="awv2-pi-note">Survey-grade frontage and easement review are tracked under Missing diligence below.</div>
                : <div class="awv2-pi-note">Still required: {(access?.missing || []).slice(0, 4).join('; ')}{(access?.missing || []).length > 4 ? '…' : ''}</div>
            )}
          </Disclosure>
        </section>
      </div>

      {/* ── Terrain + Environmental ── */}
      <div class="awv2-grid cols-3-2">
        <section data-domain="property" class="awv2-panel" id="terrain-buildability">
          <div class="awv2-panel-title">Terrain &amp; usable area</div>
          {/* The figures a land investor prices from, as figures. The full
              retained fact table follows as evidence, unchanged. */}
          <MetricRow metrics={terrainMetrics} label="Terrain and environmental figures" />
          <WhatItMeans read={aiRead} topic="terrain" />
          <StillNeeded read={aiRead} topic="terrain" />
          <div class="awv2-kv">
            <Kv k="Average slope" v={landPortalSlope || (slopePct ? `${slopePct}%` : null)} />
            <Kv k="Land under 10% slope" v={landPortalSlopeUnder10} empty="Not published as a combined figure" />
            <Kv k="Buildability" v={landPortalBuildability || (buildPct ? `${buildPct}% shown` : null)} />
            <Kv k="Buildability view" v={hasBuildabilityCapture ? 'Dedicated yellow-overlay capture retained (gallery below)' : null} empty="No dedicated buildability capture" />
            <Kv k="Elevation" v={landPortalElevation} />
            <Kv k="Terrain" v={landPortalTerrain || terrain?.detail || null} />
            {/* The listing's own read is stated once, in its own panel; this
                points at it rather than reprinting the same sentence. */}
            <Kv k="Current improvement status" v={officialNoCurrentBuilding ? 'No current building established by the official reconciliation' : landPortalImprovement || (listingCard ? 'Stated under Listing-reported property intelligence above, at listing weight.' : null)} empty="No improvement fact supplied" />
            {officialNoCurrentBuilding && supersededProviderImprovement && <Kv k="Superseded provider claim" v={supersededProviderImprovement} empty="None" />}
            <Kv k="Parcel context" v={landPortalParcelContext} empty="No parcel-context fact supplied" />
            <Kv
              k="3D evidence"
              v={has3d
                ? [hasDefault3d ? 'Default 3D view (primary)' : null,
                   byId.has('inspection-front_side_3d') || byId.has('inspection-rear_side_3d') ? 'front/rear 3D views' : null]
                    .filter(Boolean).join(' + ') + ' captured (gallery below)'
                : null}
              empty="No 3D captures"
            />
          </div>
          {/* A held-back provider figure is still intelligence. Stating what the
              provider reported, and why it is not being relied on, is the honest
              read; showing nothing made a reviewed conflict look like a source
              that published nothing. */}
          {terrainQuarantine && (
            <div class="awv2-pi-note" data-testid="pi-terrain-quarantine">
              <b>Held for visual verification:</b> {terrainQuarantine.reason}{' '}
              {[
                terrainQuarantine.slopeAvgPct ? `average slope ${terrainQuarantine.slopeAvgPct}` : null,
                terrainQuarantine.buildabilityPct ? `buildability ${terrainQuarantine.buildabilityPct}` : null,
                terrainQuarantine.buildableAcres ? `buildable area ${terrainQuarantine.buildableAcres}` : null,
              ].filter(Boolean).length > 0
                ? `Provider figures retained for follow-up: ${[
                  terrainQuarantine.slopeAvgPct ? `average slope ${terrainQuarantine.slopeAvgPct}` : null,
                  terrainQuarantine.buildabilityPct ? `buildability ${terrainQuarantine.buildabilityPct}` : null,
                  terrainQuarantine.buildableAcres ? `buildable area ${terrainQuarantine.buildableAcres}` : null,
                ].filter(Boolean).join(', ')}. They are excluded from scoring, valuation, septic conclusions and strategy until an independent terrain read reconciles them.`
                : ''}
            </div>
          )}
        </section>

        <section data-domain="property" class="awv2-panel" id="environmental-soils">
          <div class="awv2-panel-title">Environmental &amp; soils</div>
          {femaDescription && (
            <Conclusion
              label="Mapped environmental coverage"
              value={[
                lpf?.environment?.femaCoveragePct ? `FEMA ${lpf.environment.femaCoveragePct}` : null,
                lpf?.environment?.wetlandsPct ? `wetlands ${lpf.environment.wetlandsPct}` : null,
              ].filter(Boolean).join(' · ') || 'Mapped'}
              tone="neutral"
              note={waterFeature ? `Water feature retained: ${waterFeature}.` : null}
            />
          )}
          <div class="awv2-kv">
            <Kv k="Wetlands" v={landPortalWetlands || (wetPct ? `${wetPct}% — parcel panel` : null)} />
            <Kv k="FEMA flood" v={femaDescription || (floodPct ? `${floodPct}% — parcel panel` : null)} />
            <Kv k="Soils" v={landPortalSoils} empty="See retained soil overlay below" />
            <Kv k="Water feature" v={waterFeature ? `${waterFeature} — LandPortal sidebar` : null} empty="Not supplied by LandPortal" />
            <Kv k="Contours" v={byId.has('inspection-contour_terrain_view') ? 'Contour view captured (gallery below)' : null} empty="No contour capture" />
          </div>
          {femaDescription && (
            <div class="awv2-pi-note"><b>FEMA flood zone description (LandPortal):</b> {femaDescription}</div>
          )}
          {(soils && soils.length > 0) || soilsSeptic ? (
            <div class="awv2-pi-note">Mapped soil units and the preliminary septic outlook are detailed under <b>Soils &amp; Preliminary Septic Outlook</b> below.</div>
          ) : (
            <div class="awv2-pi-note">The retained LandPortal evidence did not supply soil-unit details for this parcel.</div>
          )}
          {wetlands?.detail && <div class="awv2-pi-note">{wetlands.detail}</div>}
        </section>
      </div>

      {/* ── Official Parcel & GIS ──
          Placed directly after the subject/access panels: which government
          source of record answered, and whether the parcel is confirmed, is
          the foundation every later research lane depends on. */}
      {dealId != null && (
        <OfficialParcelGisPanel dealId={dealId} initial={officialParcelGis ?? null} />
      )}

      {/* ── Land Use & Subdivision ──
          Directly after the parcel evidence it is built on: who governs the
          parcel, whether it is zoned, what may be built by right, and what may
          be divided by right. Every downstream valuation scenario depends on
          this being right, so it sits where the operator reads it in order. */}
      {dealId != null && (
        <div id="zoning-land-use">
          <LandUsePanel dealId={dealId} initial={landUse ?? null} retained={landUseIntelligence ?? null} read={aiRead} />
          {/* The shared Zoning & Subdivision Capability, run against the parcel
              this card already has. Same implementation Tools and New Lead
              reach; the rules it returns belong to the JURISDICTION. */}
          <ZoningSubdivisionCapabilityRun dealId={dealId} />
          {/* The separate property question. Shares the search and official
              document infrastructure above; owns none of the same truth. */}
          <PropertyDevelopmentHistoryPanel dealId={dealId} />
        </div>
      )}

      <section data-domain="risk" class="awv2-panel" id="utilities-septic">
        <div class="awv2-panel-title">Utilities &amp; septic</div>
        <MetricRow metrics={utilityMetrics} label="Utility and septic status" />
        <WhatItMeans read={aiRead} topic="utilities" />
        <StillNeeded read={aiRead} topic="utilities" />
        {(utilities?.detail || septic?.detail) && (
          <Disclosure label="Supporting utility and septic evidence">
            <div class="awv2-pi-note">{[utilities?.detail, septic?.detail].filter(Boolean).join(' ')}</div>
            <div class="awv2-pi-question-read">
              <div><span>Utilities</span><b>{utilities?.headline || 'Not yet resolved'}</b></div>
              <div><span>Septic</span><b>{soilsSeptic?.categoryLabel || septic?.headline || 'Field testing required'}</b></div>
              <div><span>Listing-reported context</span><b>{listingUtilities.length ? listingUtilities.join(', ') : 'No utility detail retained from listing'}</b></div>
            </div>
          </Disclosure>
        )}
      </section>

      {/* ── Soils & Preliminary Septic Outlook ── */}
      <section data-domain="risk" class="awv2-panel" id="soils-septic">
        <div class="awv2-panel-title">
          Soils &amp; Preliminary Septic Outlook <span class="awv2-src-tag">{soilsSeptic?.source || 'LandPortal soil overlay'} · screening only</span>
        </div>
        {soilsSeptic ? (
          <>
            <div class={`awv2-septic-headline ${soilsSeptic.category}`}>
              Preliminary Septic Outlook: <b>{soilsSeptic.categoryLabel}</b>
            </div>
            <div class="awv2-pi-note">{soilsSeptic.conclusion}</div>
            <div class="awv2-mkt-grid awv2-soils-grid">
              {soilsSeptic.units.map((u) => (
                <div class="awv2-mkt-card">
                  <div class="h">{[u.symbol, u.name].filter(Boolean).join(' · ')}</div>
                  <div class="rows">
                    <span class="k">Slope</span>
                    {u.slopeRange ? <span class="v">{u.slopeRange}</span> : <span class="v empty">Not supplied</span>}
                    <span class="k">Drainage</span>
                    {u.drainageClass ? <span class="v">{u.drainageClass}</span> : <span class="v empty">Not supplied</span>}
                    <span class="k">Hydrologic group</span>
                    {u.hydrologicGroup ? <span class="v">{u.hydrologicGroup}</span> : <span class="v empty">Not supplied</span>}
                    <span class="k">Seasonal water table</span>
                    {u.waterTableDepthCm != null ? <span class="v">≈{Math.round(u.waterTableDepthCm / 2.54)} in ({u.waterTableDepthCm} cm)</span> : <span class="v empty">Not supplied</span>}
                    <span class="k">Bedrock</span>
                    {u.bedrockDepthCm != null ? <span class="v">{u.bedrockDepthCm} cm</span> : <span class="v">None mapped in profile</span>}
                    <span class="k">Flooding / ponding</span>
                    {u.floodingFrequency ? <span class="v">{u.floodingFrequency}{u.pondingFrequency ? ` / ${u.pondingFrequency}` : ''}</span> : <span class="v empty">Not supplied</span>}
                    <span class="k">Septic field rating</span>
                    {u.septicRating ? <span class="v">{u.septicRating}{u.limitationReasons?.length ? ` — ${u.limitationReasons.join('; ')}` : ''}</span> : <span class="v empty">No official rating retained</span>}
                    <span class="k">Parcel share</span>
                    {u.parcelSharePct != null ? <span class="v">{u.parcelSharePct}%</span> : <span class="v empty">Not supplied</span>}
                  </div>
                </div>
              ))}
            </div>
            {soilsSeptic.supportingFactors.length > 0 && (
              <div class="awv2-pi-note"><b>Supporting factors:</b> {soilsSeptic.supportingFactors.join(' ')}</div>
            )}
            {soilsSeptic.limitations.length > 0 && (
              <div class="awv2-pi-note"><b>Primary possible limitations:</b> {soilsSeptic.limitations.join(' ')}</div>
            )}
            {soilsSeptic.bestTestingAreas && (
              <div class="awv2-pi-note"><b>Best apparent areas for field testing:</b> {soilsSeptic.bestTestingAreas}</div>
            )}
            <div class="awv2-pi-note">
              <b>Confidence:</b> {soilsSeptic.confidence} — {soilsSeptic.confidenceWhy} {soilsSeptic.parcelShareNote}
            </div>
            <div class="awv2-pi-note"><b>Required next step:</b> {soilsSeptic.nextStep}</div>
          </>
        ) : (
          <div class="awv2-pi-note">No soil units are retained for this parcel yet, so no preliminary septic outlook can be stated.</div>
        )}
      </section>

      {/* ── Assessment, taxes and improvements ──
          Public-record money facts are decision inputs, not provenance: what a
          county says a parcel is worth, what it is taxed at, and what stands on
          it are among the first things an operator asks. They were being kept
          inside the collapsed provenance drawer, so a retained assessment, a
          retained market value and a retained annual tax bill all read as
          absent on the page an operator actually works from. */}
      <section data-domain="valuation" class="awv2-panel" id="assessment-tax">
        <div class="awv2-panel-title">
          Assessment, taxes &amp; improvements
          <span class="awv2-src-tag">LandPortal parcel record · county rolls remain the stronger official source</span>
        </div>
        <div class="awv2-kv">
          <Kv k="Assessed value" v={assessedValue} empty="Not published by the retained source" />
          <Kv k="Total market value" v={totalMarketValue} empty="Not published by the retained source" />
          <Kv k="Annual tax" v={taxAmount} empty="Not published by the retained source" />
          {/* The payment question is answered by the COLLECTING office, not the
              assessor. When it resolved, say so and show what the record shows;
              when it did not, the panel names the office and the blocker — a
              bare "not screened" reads as nobody having looked. */}
          <Kv
            k="Tax payment status"
            v={taxStatus && taxStatus.standing !== 'unresolved' ? taxStatus.standingLabel : null}
            empty={taxStatus?.authorityOffice
              ? `Not established — held by the ${taxStatus.authorityOffice}`
              : 'Not established — no collecting office could be named'}
          />
          {taxStatus?.standing === 'delinquent' && (
            <>
              <Kv k="Amount owed" v={taxStatus.amountOwed} empty="Not published by the source" />
              <Kv k="Unpaid years" v={taxStatus.unpaidYears} empty="Not published by the source" />
              <Kv k="Penalties / interest" v={taxStatus.penaltiesInterest} empty="Not published by the source" />
              <Kv k="Tax-sale status" v={taxStatus.taxSaleStatus} empty="Not published by the source" />
            </>
          )}
          {/* Improvements carry their own year built inside the retained label.
              Year built is rendered as a row in exactly one panel — the
              listing-reported one, at listing weight — so the same fact never
              appears twice under two different weights. */}
          <Kv k="Current improvements" v={officialNoCurrentBuilding ? 'No current building established' : landPortalImprovement} empty="No improvement fact supplied" />
          {officialNoCurrentBuilding && supersededProviderImprovement && <Kv k="Superseded provider claim" v={supersededProviderImprovement} empty="None" />}
          <Kv k="Land use" v={sheet(lpf?.parcelContext?.landUse)} empty="Not published by the retained source" />
          <Kv k="Last sale" v={lastSalePrice ? `${lastSalePriceUsd ? `${lastSalePriceUsd} · ` : ''}displayed “${lastSalePrice}”${lastSaleDate ? ` on ${lastSaleDate}` : ''}` : null} empty="Not published by the retained source" />
        </div>
        {lpEstimatePrice && (
          <div class="awv2-pi-note">
            <b>Provider estimate (not a LandOS valuation):</b> LandPortal publishes{' '}
            {lpEstimatePrice}{lpEstimatePpa ? ` (${lpEstimatePpa}/ac)` : ''} for this parcel. It is
            shown exactly as the provider states it and never enters the LandOS land value, the
            cleaned fair market value, or any acquisition level.
          </div>
        )}
        {taxStatus && (
          <div class="awv2-pi-note" data-testid="pi-tax-status">
            <b>Tax payment status:</b> {taxStatus.statement}
            {taxStatus.sourceUrl && (
              <> · <a href={taxStatus.sourceUrl} target="_blank" rel="noreferrer">source record</a></>
            )}
            {taxStatus.standing === 'unresolved' && taxStatus.authoritySearchUrl && (
              <> · <a href={taxStatus.authoritySearchUrl} target="_blank" rel="noreferrer">open the {taxStatus.authorityOffice}</a></>
            )}
          </div>
        )}
        <AssessorTaxRun dealId={dealId} />
        <div class="awv2-pi-note">
          Assessment, market value and tax figures are as displayed on the retained LandPortal
          parcel record. The county assessment roll and the collecting office&apos;s tax record
          remain the stronger official sources, and payment status is only ever stated from one
          of them.
        </div>
        <LandPortalResearchRun dealId={dealId} />
      </section>

      {/* ── Zoning and deed provenance (LandPortal sidebar) ── */}
      <details class="awv2-collapse awv2-pi-diagnostics">
        <summary>LandPortal source facts and provenance</summary>
      <div class="awv2-grid cols-3">
        <section data-domain="property" class="awv2-panel">
          <div class="awv2-panel-title">Zoning &amp; land use <span class="awv2-src-tag">LandPortal · discovery stage</span></div>
          <div class="awv2-kv">
            <Kv k="Zoning code" v={zoningCode} empty="Not supplied" />
            <Kv k="Official zoning" v={zoning && zoning.verdict !== 'unknown' && zoning.verdict !== 'unresolved' ? zoning.headline : null} empty="Not confirmed — official record pending" />
          </div>
          {zoningCode && (
            <div class="awv2-pi-note">
              Displayed LandPortal sidebar value, stored verbatim. Discovery-stage
              data only; it is not an official zoning determination.
            </div>
          )}
        </section>

        <section data-domain="property" class="awv2-panel">
          <div class="awv2-panel-title">Sale &amp; deed history <span class="awv2-src-tag">LandPortal · discovery stage</span></div>
          <div class="awv2-kv">
            <Kv k="Last sale price" v={lastSalePrice ? `${lastSalePriceUsd ? `${lastSalePriceUsd} · ` : ''}displayed “${lastSalePrice}”` : null} empty="Not supplied" />
            <Kv k="Last sale date" v={lastSaleDate} empty="Not supplied" />
            <Kv k="Book number" v={bookNumber} empty="Not supplied" />
            <Kv k="Page number" v={pageNumber} empty="Not supplied" />
          </div>
          {(lastSalePrice || bookNumber) && (
            <div class="awv2-pi-note">
              Values as displayed on the LandPortal sidebar. The recorded deed
              remains the stronger source once retrieved.
            </div>
          )}
        </section>

        <section data-domain="valuation" class="awv2-panel">
          <div class="awv2-panel-title">Value &amp; assessment <span class="awv2-src-tag">LandPortal · discovery stage</span></div>
          <div class="awv2-kv">
            <Kv k="Assessed value" v={assessedValue} empty="Not supplied" />
            <Kv k="Total market value" v={totalMarketValue} empty="Not supplied" />
            <Kv k="Annual tax" v={taxAmount} empty="Not supplied" />
            <Kv k="LandPortal estimate" v={lpEstimatePrice ? `${lpEstimatePrice}${lpEstimatePpa ? ` (${lpEstimatePpa}/ac)` : ''}` : null} empty="Not supplied" />
          </div>
          {assessedValue && (
            <div class="awv2-pi-note">
              Assessed value as displayed on the LandPortal sidebar; county
              assessment rolls remain the stronger official source.
            </div>
          )}
        </section>
      </div>
      </details>

      {/* ── Visual evidence ── */}
      <section data-domain="evidence" class="awv2-panel" id="visual-evidence">
        <div class="awv2-panel-title">Visual evidence <span class="awv2-src-tag">LandPortal · verified subject</span></div>
        {overview && (
          <figure class="awv2-gallery-item" style="margin:0 0 14px">
            <button type="button" class="awv2-gallery-open" onClick={() => setViewerIndex(gallery.indexOf(overview))} title="Open the deliberately framed LandPortal Overview">
              <img src={tok(overview.viewUrl)} alt="LandPortal satellite Overview showing the parcel, nearest road, and apparent access relationship" loading="lazy" />
            </button>
            <figcaption class="cap"><span>LandPortal satellite Overview · parcel and road context</span><span class="tag">Overview</span></figcaption>
          </figure>
        )}
        {gallery.length > 0 ? (
          <div class="awv2-gallery">
            {gallery.map((e, index) => (
              <figure class="awv2-gallery-item" style="margin:0">
                <button
                  type="button"
                  class="awv2-gallery-open"
                  onClick={() => setViewerIndex(index)}
                  title={`Open ${e.label} in the evidence viewer`}
                >
                  <img src={tok(e.viewUrl)} alt={e.label} loading="lazy" />
                </button>
                <figcaption class="cap"><span>{e.label}</span>{e.kind && <span class="tag">{e.kind}</span>}</figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div class="awv2-pi-note">No accepted visual evidence is on file for this parcel.</div>
        )}
      </section>

      {/* ── Street View observations ── */}
      <section data-domain="evidence" class="awv2-panel">
        <div class="awv2-panel-title">
          Street View observations <span class="awv2-src-tag">G Maps Street View via LandPortal</span>
        </div>
        {streetView && streetView.available && hasStreetViewCapture ? (
            <>
              <div class="awv2-pi-note">
                A usable Street View panorama was captured at the investigated public-road connection; the retained screenshot is in the gallery above.
              </div>
              {supportedStreetObservations.map((o) => (
                <div class="awv2-pi-note">
                  <b>{o.label}:</b> {o.detail}
                  {o.evidence && <span class="awv2-sv-basis"> — {o.evidence}</span>}
                </div>
              ))}
              {supportedStreetObservations.length === 0 && <div class="awv2-pi-note">No panorama-backed textual observation is retained; inspect the screenshot directly.</div>}
            </>
        ) : streetView?.available === false ? (
            <div class="awv2-pi-note">
              <b>Usable Street View coverage does not exist for the investigated connection point.</b>{' '}
              {streetView.observations.find((o) => /unavailable/i.test(o.label))?.detail
                || 'No supported visual observation is stated.'}
            </div>
        ) : (
          <div class="awv2-pi-note">No real captured Street View panorama is retained, so no Street View observation is shown.</div>
        )}
      </section>

      {/* ── Visual Buyer Analysis: concise buyer narrative by default; the
             detailed structured analysis stays available, collapsed. ── */}
      <section data-domain="evidence" class="awv2-panel" id="visual-buyer-analysis">
        <div class="awv2-panel-title">
          Visual Buyer Analysis <span class="awv2-src-tag">Multi-view · {vba?.basedOn?.length ?? 0} evidence categories</span>
        </div>
        {narrative && narrative.sections.length > 0 ? (
          <div class="awv2-vbn">
            {narrative.sections.map((s) => (
              <div class="awv2-vbn-section">
                <div class="h">{s.title}</div>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        ) : !vba ? (
          <div class="awv2-pi-note">No multi-view Visual Buyer Analysis has been produced for this subject yet.</div>
        ) : null}
        {vba && (
          <details class="awv2-collapse awv2-vba-details">
            <summary>View supporting observations and evidence</summary>
            <div class="awv2-vba">
              <div class="awv2-vba-col">
                <div class="h brass">A · Directly observed features</div>
                {(vba.observedFeatures || []).map((o) => (
                  <div class="awv2-pi-note"><b>{o.label}:</b> {o.detail}{o.views?.length ? <span class="awv2-sv-basis"> — {o.views.join(', ')}</span> : null}</div>
                ))}
                <div class="h brass" style="margin-top:12px">B · Buyer-oriented interpretation</div>
                {(vba.buyerInterpretation || []).map((o) => (
                  <div class="awv2-pi-note"><b>{o.label}:</b> {o.detail}</div>
                ))}
              </div>
              <div class="awv2-vba-col">
                <div class="h rust">C · Unresolved diligence</div>
                <ul>{(vba.unresolvedDiligence || []).map((d) => <li>{d}</li>)}</ul>
                <div class="h brass" style="margin-top:12px">D · Potential buyer perspective</div>
                <div class="awv2-pi-note"><b>Strongest advantages:</b> {(vba.buyerPerspective?.strongestAdvantages || []).join('; ')}</div>
                <div class="awv2-pi-note"><b>Most important concerns:</b> {(vba.buyerPerspective?.importantConcerns || []).join('; ')}</div>
                <div class="awv2-pi-note"><b>Best-fit buyers:</b> {(vba.buyerPerspective?.bestFitBuyers || []).join('; ')}</div>
                <div class="awv2-pi-note"><b>Weaker-fit buyers:</b> {(vba.buyerPerspective?.weakerFitBuyers || []).join('; ')}</div>
                <div class="awv2-pi-note"><b>Preliminary impression:</b> {vba.buyerPerspective?.preliminaryImpression || '—'}</div>
                <div class="awv2-pi-note"><b>Would materially change value or strategy:</b> {(vba.buyerPerspective?.materialToValueOrStrategy || []).join('; ')}</div>
                <div class="h" style="margin-top:12px">E · Confidence &amp; evidence reconciliation</div>
                <div class="awv2-pi-note"><b>Supported by:</b> {(vba.evidenceReconciliation?.supportingViews || []).join(', ')}</div>
                {(vba.evidenceReconciliation?.supersededConclusions || []).map((s) => (
                  <div class="awv2-pi-note"><b>Superseded:</b> {s.prior} → <b>{s.reconciled}</b> <span class="awv2-sv-basis">({s.strongerEvidence})</span></div>
                ))}
                <div class="awv2-pi-note"><b>Still uncertain:</b> {(vba.evidenceReconciliation?.remainingUncertain || []).join('; ')}</div>
                <div class="awv2-pi-note"><b>Overall confidence:</b> {vba.evidenceReconciliation?.overallConfidence || '—'} — {vba.evidenceReconciliation?.confidenceWhy || ''}</div>
              </div>
            </div>
          </details>
        )}
      </section>

      {/* ── Market context (LandOS Market Research) ── */}
      <section data-domain="market" class="awv2-panel" id="market-intelligence">
        <div class="awv2-panel-title">
          Market Intelligence <span class="awv2-src-tag">{market?.source || 'LandOS Market Research'} — Market Pulse + Market Research, one connected read</span>
        </div>
        {market ? (
          <>
            <div class="awv2-market-read">
              <strong>{market.read?.headline || market.read?.summary || market.interpretation || 'No concise market read is retained.'}</strong>
              {market.read?.resolvedVia && <span>Resolved via {market.read.resolvedVia}</span>}
              {market.read?.note && <span>{market.read.note}</span>}
              <span>Competition: {market.liquidity?.competition != null ? market.liquidity.competition : 'unmeasured'}</span>
            </div>
            {/* The comparison that bears on this parcel: the subject's own
                acreage band beside the fastest-moving one. Four headline
                numbers alone never say whether the subject's band is the
                liquid one. Collector diagnostics stay collapsed below. */}
            <div class="awv2-dx-bands" aria-label="Acreage band comparison">
              {[market.subjectBand, market.fastestBand]
                .filter((record): record is MarketContextRecordView => !!record?.available && !!record.metrics)
                .map((record, index) => (
                  <div class="awv2-dx-band" data-role={index === 0 ? 'subject' : 'liquid'}>
                    <small>{index === 0 ? 'Subject band' : 'Most liquid band'}</small>
                    <b>{record.acreageBandLabel || record.acreageBand || record.label}</b>
                    <MetricRow
                      label={`${record.label} figures`}
                      metrics={[
                        { label: '$ / acre', value: fmtMetric('medianPricePerAcre', record.metrics!.medianPricePerAcre) ?? '' },
                        { label: 'Median DOM', value: fmtMetric('medianDaysOnMarket', record.metrics!.medianDaysOnMarket) ?? '' },
                        { label: 'Sell-through', value: fmtMetric('sellThroughRate', record.metrics!.sellThroughRate) ?? '' },
                        { label: 'Months supply', value: fmtMetric('monthsOfSupply', record.metrics!.monthsOfSupply) ?? '' },
                      ]}
                    />
                  </div>
                ))}
            </div>
            <WhatItMeans read={aiRead} topic="market" heading="What it means for this property" />
            <Disclosure label="Market records, methodology and collector diagnostics">
              <div class="awv2-mkt-grid">
                <MarketCard rec={market.county} />
                <MarketCard rec={market.zip} />
                <MarketCard rec={market.subjectBand} />
                <MarketCard rec={market.fastestBand} />
              </div>
            </Disclosure>
          </>
        ) : (
          <div class="awv2-pi-note">No LandOS Market Research context was returned for this lead.</div>
        )}
      </section>

      {/* ── Comparable research summary ── */}
      <div class="awv2-grid cols-3-2">
        <section data-domain="valuation" class="awv2-panel">
          <div class="awv2-panel-title">Comparable evidence handoff</div>
          {/* The headline is the CANONICAL summary, never the snapshot's
              collection-time prose: the snapshot line can carry a comp count
              from before operator include/exclude actions. */}
          <div class="awv2-pi-note">
            {valuationSummary
              ? `${valuationSummary.acceptedCount} accepted closed sale${valuationSummary.acceptedCount === 1 ? '' : 's'} currently support the ${valuationSummary.status} valuation.`
              : comps.summaryLine || 'Current comparable state is maintained in Comps & Valuation.'}
          </div>
          <div class="awv2-pi-note">Counts and valuation conclusions are not recomputed on this page; Comps &amp; Valuation is the canonical detailed surface.</div>
          <details class="awv2-collapse awv2-pi-diagnostics">
            <summary>Collection diagnostics</summary>
            {valuationSummary && comps.summaryLine && <div>Collection-time note (may predate operator selections): {comps.summaryLine}</div>}
            <div>LandPortal rows seen: {comps.landPortalRowsSeen ?? 'not reported'}</div>
            <div>Total collected: {comps.totalCollected ?? 'not reported'}</div>
            <div>Duplicates merged: {comps.duplicatesMerged ?? 'not reported'}</div>
          </details>
        </section>

        <section data-domain="evidence" class="awv2-panel">
          <div class="awv2-panel-title">Comparables map</div>
          {byId.has('inspection-comps_map') ? (
            <figure class="awv2-gallery-item awv2-comps-map" style="margin:0">
              <button
                type="button"
                class="awv2-gallery-open"
                onClick={() => setViewerIndex(gallery.findIndex((e) => e.id === 'inspection-comps_map'))}
                title="Open the Show on Map capture in the evidence viewer"
              >
                <img src={tok(byId.get('inspection-comps_map')!.viewUrl)} alt="LandPortal Show on Map comparables" />
              </button>
              <figcaption class="cap"><span>Show on Map comparable page</span></figcaption>
            </figure>
          ) : (
            <div class="awv2-pi-note">No Show on Map capture is on file.</div>
          )}
        </section>
      </div>

      {/* Evidence / unresolved diligence: delivery is not the same as resolution. */}
      {researchStatus && (
        <section data-domain="action" class="awv2-panel awv2-research-status" id="research-status">
          <div class="awv2-panel-title">Research status</div>
          <div class="awv2-research-counts">
            <div><span>Research areas delivered</span><b>{researchStatus.delivered} / {researchStatus.total}</b></div>
            <div><span>Diligence questions resolved</span><b>{researchStatus.questionsResolved != null ? `${researchStatus.questionsResolved}${researchStatus.questionsTotal != null ? ` / ${researchStatus.questionsTotal}` : ''}` : 'Tracked separately'}</b></div>
          </div>
          <div class="awv2-pi-note">Completed research means the lane delivered its current evidence; it does not mean every diligence question is resolved.</div>
          <details class="awv2-collapse awv2-pi-diagnostics">
            <summary>Lane delivery details</summary>
            {researchStatus.areas.map((area) => <div class="awv2-pi-note"><b>{area.label}:</b> {area.status}{area.reason ? ` · ${area.reason}` : ''}{area.nextAction ? ` · Next: ${area.nextAction}` : ''}</div>)}
          </details>
        </section>
      )}

      {/* ── Missing diligence: reconciled operator checklist ── */}
      {missingDiligence ? (
        <section data-domain="action" class="awv2-missing">
          <div class="awv2-panel-title">
            Missing diligence <span class="awv2-src-tag">Reconciled against accepted research</span>
          </div>
          <div class="awv2-md-list">
            {/* Compact, collapsed by default: name + status + short next action.
                Expanding a row reveals the full reconciled record. The most
                urgent items are visually prominent but stay collapsed. */}
            {missingDiligence.items.map((rawItem) => {
              // Canonical reconciliation: the closed-sale-evidence row must
              // never say "not priceable" while the canonical valuation state
              // carries accepted sales; the live summary is authoritative.
              const item = valuationSummary && valuationSummary.acceptedCount > 0 && /closed[- ]sale/i.test(rawItem.label)
                ? {
                    ...rawItem,
                    urgent: false,
                    shortStatus: `${valuationSummary.acceptedCount} accepted closed sale${valuationSummary.acceptedCount === 1 ? '' : 's'} · ${valuationSummary.status}`,
                  }
                : rawItem;
              return (
              <details class={`awv2-md-row${item.urgent ? ' urgent' : ''}`}>
                <summary>
                  <span class="t">{item.label}</span>
                  <span class="st">{item.shortStatus || item.currentFinding.slice(0, 64)}</span>
                  <span class="nx">{item.shortNext ? `Next: ${item.shortNext}` : ''}</span>
                </summary>
                <div class="awv2-md-detail">
                  <div class="row"><span class="k">Current finding</span><span class="v">{item.currentFinding}</span></div>
                  <div class="row"><span class="k">Still unresolved</span><span class="v">{item.stillUnresolved}</span></div>
                  <div class="row"><span class="k">Why it matters</span><span class="v">{item.whyItMatters}</span></div>
                  <div class="row"><span class="k">Next source</span><span class="v">{item.nextSource}</span></div>
                </div>
              </details>
              );
            })}
          </div>
          {missingDiligence.evidenceGaps.length > 0 && (
            <div class="awv2-missing-chips" style="margin-top:12px">
              {missingDiligence.evidenceGaps.map((m) => <span class="awv2-chip">{m}</span>)}
            </div>
          )}
          {missingDiligence.passthrough.length > 0 && (
            <ul class="awv2-missing-lines">
              {missingDiligence.passthrough.map((m) => <li>{m}</li>)}
            </ul>
          )}
        </section>
      ) : (() => {
        const uniqueMissing = [...new Set(missing)];
        const shortMissing = uniqueMissing.filter((m) => m.length <= 64);
        const longMissing = uniqueMissing.filter((m) => m.length > 64);
        return (
          <section data-domain="action" class="awv2-missing">
            <div class="awv2-panel-title">Missing diligence</div>
            <div class="awv2-missing-chips">
              {shortMissing.map((m) => <span class="awv2-chip">{m}</span>)}
            </div>
            {longMissing.length > 0 && (
              <ul class="awv2-missing-lines">
                {longMissing.map((m) => <li>{m}</li>)}
              </ul>
            )}
          </section>
        );
      })()}

      {/* ── Remaining diligence ──
          One ranked queue. The reconciled checklist above holds every tracked
          item; this states which few actually decide the deal, so the page
          does not end in twenty interchangeable "not established" rows. */}
      {(queue.high.length > 0 || queue.secondary.length > 0) && (
        <section data-domain="action" class="awv2-panel" id="remaining-diligence">
          <div class="awv2-panel-title">Remaining diligence</div>
          <div class="awv2-dx-queue">
            {queue.high.length > 0 && (
              <div class="awv2-dx-queue-group" data-tier="high">
                <h4>High priority</h4>
                <ol>{queue.high.map((item) => <li><div><b>{item.label}</b>{item.why && <span>{item.why}</span>}</div></li>)}</ol>
              </div>
            )}
            {queue.secondary.length > 0 && (
              <div class="awv2-dx-queue-group" data-tier="secondary">
                <h4>Secondary</h4>
                <ol>{queue.secondary.map((item) => <li><div><b>{item.label}</b>{item.why && <span>{item.why}</span>}</div></li>)}</ol>
              </div>
            )}
          </div>
          <div class="awv2-pi-note">
            Every unresolved item stays tracked under Missing diligence above; this is the priority order, not the whole list.
          </div>
        </section>
      )}

      {/* ── The complete analyst read ──
          Overview shows the Deal Read; each section above shows the few
          insights that are about its own subject. Nothing was discarded to do
          that: the whole structured result is here, unabridged, one control
          away, and rendering it never starts a reasoning run. */}
      {acquisitionIntelligence && (
        <section class="awv2-dx-fullintel" id="full-acquisition-intelligence">
          <Disclosure label="Full Acquisition Intelligence — the complete analyst read">
            <AcquisitionIntelligenceSection
              read={acquisitionIntelligence.read}
              readiness={acquisitionIntelligence.readiness}
              runtime={acquisitionIntelligence.runtime}
              stale={acquisitionIntelligence.stale}
              running={acquisitionIntelligence.running}
              error={acquisitionIntelligence.error}
              onRun={acquisitionIntelligence.onRun}
            />
          </Disclosure>
        </section>
      )}

      {viewerIndex != null && gallery[viewerIndex] && (
        <EvidenceViewer
          items={gallery}
          index={viewerIndex}
          onNavigate={(next) => setViewerIndex(next)}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </>
  );
}

// ── Same-page evidence viewer ──────────────────────────────────────────
//
// A large in-page lightbox over the workspace: largest retained image at
// natural aspect ratio, zoom in/out/reset, wheel zoom, pointer panning,
// previous/next, category + caption + source, close button and Escape.
// No navigation away, no new tab, no external image library.

const VIEWER_MIN_SCALE = 1;
const VIEWER_MAX_SCALE = 8;
const VIEWER_STEP = 1.4;

function EvidenceViewer({ items, index, onNavigate, onClose }: {
  items: PiEvidenceItem[];
  index: number;
  onNavigate: (index: number) => void;
  onClose: () => void;
}) {
  const item = items[index];
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Live index for the once-registered keydown listener: rapid successive
  // presses must never hit a stale closure between effect flushes.
  const indexRef = useRef(index);
  indexRef.current = index;

  const clampScale = (value: number) => Math.min(VIEWER_MAX_SCALE, Math.max(VIEWER_MIN_SCALE, value));
  const resetView = () => { setScale(1); setOffset({ x: 0, y: 0 }); };
  const zoomIn = () => setScale((s) => clampScale(s * VIEWER_STEP));
  const zoomOut = () => setScale((s) => {
    const next = clampScale(s / VIEWER_STEP);
    if (next === VIEWER_MIN_SCALE) setOffset({ x: 0, y: 0 });
    return next;
  });
  const prev = () => { resetView(); onNavigate((indexRef.current - 1 + items.length) % items.length); };
  const next = () => { resetView(); onNavigate((indexRef.current + 1) % items.length); };

  // Keyboard: Escape closes; arrows navigate. Focus starts on the close
  // control so keyboard users are inside the dialog immediately. The page
  // behind the modal stays scroll-locked while the viewer is open.
  useEffect(() => {
    closeRef.current?.focus();
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); }
      else if (e.key === '-') { e.preventDefault(); zoomOut(); }
      else if (e.key === '0') { e.preventDefault(); resetView(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = priorOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) zoomIn(); else zoomOut();
  };
  const onPointerDown = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y };
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!drag.current) return;
    setOffset({
      x: drag.current.baseX + (e.clientX - drag.current.startX),
      y: drag.current.baseY + (e.clientY - drag.current.startY),
    });
  };
  const onPointerUp = () => { drag.current = null; };

  return (
    <div class="awv2-viewer" role="dialog" aria-modal="true" aria-label={`Evidence viewer: ${item.label}`}>
      <div class="awv2-viewer-backdrop" onClick={onClose} />
      <div class="awv2-viewer-body">
        <div
          class={`awv2-viewer-stage${scale > 1 ? ' zoomed' : ''}`}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img
            src={tok(item.viewUrl)}
            alt={item.label}
            draggable={false}
            style={`transform: translate(${offset.x}px, ${offset.y}px) scale(${scale});`}
          />
        </div>

        <div class="awv2-viewer-meta">
          {item.kind && <span class="cat">{item.kind}</span>}
          <span class="cap">{item.label}</span>
          <span class="src">
            {item.sourceType || 'LandPortal · verified subject'}
            {item.sourceUrl ? (
              <>
                {' · '}
                <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">source</a>
              </>
            ) : null}
          </span>
          <span class="pos">{index + 1} / {items.length}</span>
        </div>

        <div class="awv2-viewer-controls" role="toolbar" aria-label="Evidence viewer controls">
          <button type="button" onClick={prev} title="Previous image (←)" aria-label="Previous image"><ChevronLeft size={18} /></button>
          <button type="button" onClick={zoomOut} title="Zoom out (−)" aria-label="Zoom out"><ZoomOut size={18} /></button>
          <button type="button" onClick={resetView} title="Reset to fit (0)" aria-label="Reset to fit"><Maximize2 size={18} /></button>
          <button type="button" onClick={zoomIn} title="Zoom in (+)" aria-label="Zoom in"><ZoomIn size={18} /></button>
          <button type="button" onClick={next} title="Next image (→)" aria-label="Next image"><ChevronRight size={18} /></button>
        </div>

        <button ref={closeRef} type="button" class="awv2-viewer-close" onClick={onClose} title="Close (Esc)" aria-label="Close evidence viewer">
          <X size={20} />
        </button>
      </div>
    </div>
  );
}
