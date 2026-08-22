import {
  ExternalLink, ArrowUpRight, ShieldCheck, AlertTriangle, Target,
  FileCheck2, UserRound, MapPin, Ruler, Waves, Mountain,
  Droplets, CheckCircle2, CircleDot,
} from 'lucide-preact';

import type {
  AccessPresentationView,
  ExactAddressListingsView,
  MarketContextRecordView,
  MarketContextView,
  PiDdItem,
  PiEvidenceItem,
  PiFact,
  ParcelFactSheetView,
  ResearchStatusView,
  SoilsSepticView,
  VisualBuyerNarrativeView,
} from './AcquisitionWorkspaceV2PropertyIntelligence';
import type { RetainedLandUseIntelligenceView } from './AcquisitionWorkspaceV2LandUse';
import { OwnerAcquisitionCard } from './AcquisitionWorkspaceV2DevelopmentIntelligence';
import type {
  AcquisitionIntelligenceView,
  AcquisitionIntelligenceReadiness,
  AcquisitionIntelligenceRuntimeStatus,
} from './AcquisitionWorkspaceV2AcquisitionIntelligence';
import { DealReadCard } from './AcquisitionWorkspaceV2DealRead';
import {
  DealBrainAsk,
  IntelligenceScoreStrip,
  type DealBrainThreadEntry,
  type IntelligenceScoresView,
  type QuickFlipScreenView,
} from './AcquisitionWorkspaceV2IntelligenceStack';
import {
  SpecialistReadsPanel,
  type MarketIntelligenceReadView,
  type PropertyIntelligenceReadView,
  type AcreageExtentControls,
  type PropertyReconcileControls,
  type SellerIntelligenceReadView,
  type SpecialistStaleView,
} from './AcquisitionWorkspaceV2SpecialistReads';
import {
  ResearchReadinessStrip,
  type ResearchReadinessManifestView,
} from './AcquisitionWorkspaceV2ResearchReadiness';
import type { CompsValuationViewData } from './AcquisitionWorkspaceV2CompsValuation';
import '../styles/workspace-v2-overview.css';

export interface OverviewScoreView {
  score: number | null;
  rating: string;
  explanation?: string;
  strongestPositiveFactors?: string[];
  mainDeductions?: string[];
  materiallyChangeWith?: string[];
}

interface CanonicalOverviewState {
  decisionSummary?: string;
  blockers?: string[];
  missingInformation?: string[];
  nextActions?: string[];
}

export interface OverviewSnapshotView {
  identity?: {
    displayAddress?: string;
    normalizedAddress?: string;
    owner?: string | null;
    county?: string;
    state_?: string;
    apn?: string;
    acres?: number | null;
    lpPropertyId?: string | null;
    hasParcelGeometry?: boolean;
  };
  facts?: PiFact[];
  dueDiligence?: PiDdItem[];
  evidence?: PiEvidenceItem[];
  subjectParcelUrl?: string | null;
  /**
   * The strategy lane's own output. Every run produces a full read of each
   * exit — what supports it, what blocks it, the effort, the timeline, the
   * value-creation path, the risk, and the next thing to confirm. None of it
   * reached the operator: the workspace printed only the one-line reason the
   * preferred strategy could not yet be chosen, so a lane that had run and
   * delivered looked like a lane that had produced nothing.
   */
  strategies?: OverviewStrategyView[];
  recommendation?: OverviewRecommendationView | null;
  operatorAnalysis?: {
    scores?: { property?: OverviewScoreView; market?: OverviewScoreView; seller?: OverviewScoreView };
    canonical?: CanonicalOverviewState | null;
    overall?: {
      recommendation?: string;
      mainOpportunity?: string;
      mainRisks?: string[];
      unansweredQuestions?: string[];
      nextBestActions?: string[];
    };
    methodology?: { assumptions?: string[]; notes?: string[] } | null;
    market?: {
      dataCenters?: OverviewDataCentersView;
    };
  };
}

/** One exit strategy as the strategy lane assessed it for this subject. */
export interface OverviewStrategyView {
  strategy: string;
  /** 'viable' | 'conditional' | 'blocked' | 'not_applicable', as the lane states it. */
  applicability?: string | null;
  supportingFacts?: string[];
  blockers?: string[];
  effort?: string | null;
  timeline?: string | null;
  valueCreationPath?: string | null;
  risk?: string | null;
  nextVerificationStep?: string | null;
}

/** The strategy lane's reconciled recommendation across those exits. */
export interface OverviewRecommendationView {
  preferredStrategy?: string | null;
  why?: string | null;
  posture?: string | null;
  postureWhy?: string | null;
  shouldPursue?: string | null;
  whatWouldChangeIt?: string[];
  dealKillers?: string[];
  nextConfirmations?: string[];
  juiceWorthSqueeze?: { answer?: string | null; why?: string | null } | null;
}

const STRATEGY_APPLICABILITY_LABEL: Record<string, string> = {
  viable: 'Viable',
  conditional: 'Conditional',
  blocked: 'Blocked',
  not_applicable: 'Not applicable',
};

/** Strongest exits first, so the compact grid shows the ones worth reading. */
const STRATEGY_APPLICABILITY_ORDER: Record<string, number> = {
  viable: 0,
  conditional: 1,
  blocked: 2,
  not_applicable: 3,
};

/** The 20-mile Brockovich data-center screen, as the snapshot carries it. */
export interface OverviewDataCentersView {
  searchedWithinMiles?: number;
  status?: 'found' | 'none_found' | 'not_run' | 'unavailable';
  summary?: string;
  verdict?: string;
  routesAttempted?: string[];
  items?: Array<{
    name?: string;
    operatorOrDeveloper?: string | null;
    location?: string | null;
    distanceMiles?: number | null;
    status?: string;
    sourceUrl?: string | null;
  }>;
}

type ResearchStatusDetail = ResearchStatusView & {
  questionsResolved?: number;
  questionsTotal?: number;
  questionsHeadline?: string;
  /** Reconciled open diligence questions. The API sends objects; a plain
   *  string is accepted for older projections. */
  openQuestions?: Array<string | { label?: string; reason?: string; nextAction?: string }>;
};

interface OverviewSectionProps {
  snap: OverviewSnapshotView;
  address: string;
  zip: string;
  heroSrc: string | null;
  visualCount: number;
  seller: { name?: string; phone?: string; email?: string } | null;
  askingPrice: number | null;
  researchStatus: ResearchStatusView | null;
  accessView: AccessPresentationView | null;
  soilsSeptic: SoilsSepticView | null;
  narrative: VisualBuyerNarrativeView | null;
  visualBuyerSummary: { physicalCharacter?: string; mainBuyerAppeal?: string; topConcern?: string } | null;
  visualBuyerSummaryLabel: string;
  visualBuyerAnalysisLabel: string;
  onOpenVisualBuyerAnalysis: (event: MouseEvent) => void;
  exactAddressListings: ExactAddressListingsView | null;
  market: MarketContextView | null;
  compsValuation: CompsValuationViewData | null;
  valuationBasisLabel: string | null;
  landBasisOpeningReference: string | null;
  openCompsValuationLabel: string;
  openCompsValuation: () => void;
  acquisitionNextAction: { label?: string; reason?: string } | null;
  /** The deterministic Research Readiness Manifest and its bounded controls.
   *  Rendering it runs no research; only the backfill control does. */
  researchReadiness?: {
    manifest: ResearchReadinessManifestView | null;
    loading: boolean;
    error: string | null;
    running: string[] | null;
    onBackfill: (itemIds?: string[]) => void;
  } | null;
  onOpenSection: (slug: 'property-intelligence' | 'comps-valuation') => void;
  formatUsd: (value: number) => string;
  /** The canonical retained LandPortal parcel fact sheet. */
  landPortalFacts?: ParcelFactSheetView | null;
  /** Retained land-use intelligence: authority, current zoning, backstory. */
  landUseIntelligence?: RetainedLandUseIntelligenceView | null;
  /** The persisted Acquisition Intelligence read and its controls. Overview
   *  renders it; it never triggers a reasoning run by rendering. */
  acquisitionIntelligence?: {
    read: AcquisitionIntelligenceView | null;
    readiness: AcquisitionIntelligenceReadiness | null;
    runtime: AcquisitionIntelligenceRuntimeStatus | null;
    stale: boolean;
    running: boolean;
    error: string | null;
    onRun: () => void;
  } | null;
  /** The four intelligence scores and the quick-flip economic status, from
   *  the persisted Deal Intelligence. Rendering runs nothing. */
  intelligence?: {
    scores: IntelligenceScoresView | null;
    quickFlip: QuickFlipScreenView | null;
    cashVerdict: string | null;
    phaseLabel: string | null;
    whatChanged: string[] | null;
  } | null;
  /** The three persisted specialist intelligence products (Property, Market +
   *  Area, Seller) and the per-layer staleness map. Rendering runs nothing. */
  specialistReads?: {
    property: PropertyIntelligenceReadView | null;
    market: MarketIntelligenceReadView | null;
    seller: SellerIntelligenceReadView | null;
    stale: SpecialistStaleView | null;
    /** Explicit official-record verification controls + persisted record. */
    reconcile?: PropertyReconcileControls | null;
    /** Official acreage / parcel-extent reconciliation controls + record. */
    acreage?: AcreageExtentControls | null;
  } | null;
  /** The Deal Brain conversation: operator guidance in, grounded replies out. */
  dealBrain?: {
    thread: DealBrainThreadEntry[];
    running: boolean;
    error: string | null;
    onAsk: (message: string) => void;
  } | null;
}

const unique = (items: Array<string | null | undefined>) => Array.from(new Set(items.filter((item): item is string => !!item?.trim())));

const numberIn = (value: string | null | undefined, pattern: RegExp): number | null => {
  const match = value?.match(pattern)?.[1];
  if (match == null) return null;
  const parsed = Number(match.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const structureLabel = (type: string | null | undefined, improved: boolean): string => {
  if (!improved) return type === 'unknown' ? 'Structure pending' : 'Vacant Land';
  if (type === 'existing_residence' || /resid|dwelling|single.family|house/i.test(type ?? '')) return 'House';
  if (type === 'manufactured_home' || /manufactured|mobile home/i.test(type ?? '')) return 'Manufactured Home';
  if (!type || type === 'unknown') return 'Improved Property';
  return type.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
};

function ScoreCard({ view }: { view?: OverviewScoreView }) {
  const score = view?.score ?? null;
  const tone = score == null ? 'pending' : score < 50 ? 'weak' : score < 70 ? 'moderate' : 'strong';
  return (
    <section class="awv2-overview-score" aria-label="Property score">
      <div class="awv2-overview-score-number">
        <span class={tone}>{score ?? 'Pending'}</span>
        <small>{score == null ? 'Property score' : `${view?.rating || 'Unrated'} property score`}</small>
      </div>
      <div class="awv2-overview-score-drivers">
        <div><b>Positives</b>{(view?.strongestPositiveFactors?.length ? view.strongestPositiveFactors : ['No positive driver retained yet']).slice(0, 2).map((item) => <span class="positive">+ {item}</span>)}</div>
        <div><b>Risks</b>{(view?.mainDeductions?.length ? view.mainDeductions : ['No scored negative driver retained']).slice(0, 2).map((item) => <span class="negative">− {item}</span>)}</div>
        <div><b>Could change</b>{(view?.materiallyChangeWith?.length ? view.materiallyChangeWith : ['No additional score driver retained']).slice(0, 2).map((item) => <span>· {item}</span>)}</div>
      </div>
      {view?.explanation && <details class="awv2-overview-details"><summary>Score detail</summary><p>{view.explanation}</p></details>}
    </section>
  );
}

/**
 * One exit, read in four lines: fit, why it fits, the main blocker, the next
 * confirmation. The lane's remaining output — every supporting fact, effort,
 * timeline and risk — stays on the card behind one control rather than being
 * printed as another wall of strategy copy on the Overview.
 */
function StrategyCard({ item }: { item: OverviewStrategyView }) {
  const applicability = (item.applicability || '').toLowerCase();
  const supports = item.supportingFacts ?? [];
  const blockers = item.blockers ?? [];
  const hasDetail = supports.length > 1 || blockers.length > 1 || !!item.effort || !!item.timeline || !!item.risk;
  return (
    <article class="awv2-strategy-card compact" data-applicability={applicability || 'unstated'}>
      <header>
        <b>{item.strategy}</b>
        <em>{STRATEGY_APPLICABILITY_LABEL[applicability] ?? 'Assessed'}</em>
      </header>
      <dl class="awv2-strategy-lines">
        {(item.valueCreationPath || supports[0]) && (
          <><dt>Why it fits</dt><dd>{item.valueCreationPath || supports[0]}</dd></>
        )}
        {blockers[0] && <><dt>Main blocker</dt><dd class="blocker">{blockers[0]}</dd></>}
        {item.nextVerificationStep && <><dt>Next confirmation</dt><dd>{item.nextVerificationStep}</dd></>}
      </dl>
      {hasDetail && (
        <details class="awv2-strategy-detail">
          <summary>Full assessment</summary>
          {supports.length > 0 && <ul class="supports">{supports.map((fact) => <li>{fact}</li>)}</ul>}
          {blockers.length > 0 && <ul class="blocks">{blockers.map((blocker) => <li>{blocker}</li>)}</ul>}
          <dl>
            {item.effort && <><dt>Effort</dt><dd>{item.effort}</dd></>}
            {item.timeline && <><dt>Timeline</dt><dd>{item.timeline}</dd></>}
            {item.risk && <><dt>Risk</dt><dd>{item.risk}</dd></>}
          </dl>
        </details>
      )}
    </article>
  );
}

export function OverviewSection({
  snap,
  address,
  zip,
  heroSrc,
  visualCount,
  seller,
  askingPrice,
  researchStatus,
  accessView,
  soilsSeptic,
  narrative,
  visualBuyerSummary,
  visualBuyerSummaryLabel,
  visualBuyerAnalysisLabel,
  onOpenVisualBuyerAnalysis,
  exactAddressListings,
  market,
  compsValuation,
  valuationBasisLabel,
  landBasisOpeningReference,
  openCompsValuationLabel,
  openCompsValuation,
  acquisitionNextAction,
  onOpenSection,
  formatUsd,
  landPortalFacts,
  landUseIntelligence,
  acquisitionIntelligence,
  intelligence,
  specialistReads,
  dealBrain,
  researchReadiness,
}: OverviewSectionProps) {
  const developmentIntelligence = accessView?.developmentIntelligence ?? null;
  const identity = snap.identity ?? {};
  const operator = snap.operatorAnalysis;
  const canonical = operator?.canonical ?? null;
  const overall = operator?.overall;
  const improvement = compsValuation?.subjectImprovement ?? null;
  const summary = compsValuation?.summary;
  const cvSummary = summary ?? null;
  const usd = formatUsd;
  const status = researchStatus as ResearchStatusDetail | null;

  // Overview never derives a second comp count or valuation requirement. The
  // Comps & Valuation projection is the single authority for both. Server
  // decision prose can bake in the comp count that existed when the snapshot
  // was written; the live accepted count always wins over that prose.
  const decisionSummaryRaw = canonical?.decisionSummary || overall?.recommendation || overall?.mainOpportunity || 'Current decision summary is pending accepted research.';
  const decisionSummary = cvSummary
    ? decisionSummaryRaw.replace(/\d+\s+accepted closed sale\(s\)/g, `${cvSummary.acceptedCount} accepted closed sale(s)`)
    : decisionSummaryRaw;
  const firstDecisionStop = decisionSummary.search(/[.!?](?:\s|$)/);
  const decisionHeadline = firstDecisionStop >= 0
    ? decisionSummary.slice(0, firstDecisionStop + 1)
    : decisionSummary;
  const risks = unique(canonical?.blockers?.length ? canonical.blockers : overall?.mainRisks ?? []);
  const unresolved = unique(canonical?.missingInformation?.length ? canonical.missingInformation : overall?.unansweredQuestions ?? []);
  const canonicalActions = unique(canonical?.nextActions?.length ? canonical.nextActions : overall?.nextBestActions ?? []);
  const nextActions = unique([
    acquisitionNextAction?.label ? `${acquisitionNextAction.label}${acquisitionNextAction.reason ? ` — ${acquisitionNextAction.reason}` : ''}` : null,
    ...canonicalActions,
  ]);

  const dataCenters = snap.operatorAnalysis?.market?.dataCenters ?? null;
  // A radius was only measured when a lane actually ran it AND at least one
  // finding carries a distance. Otherwise the findings are county-scoped.
  const dataCenterMeasuredHits = (dataCenters?.items ?? []).filter((item) => item.distanceMiles != null);
  const dataCenterRadiusMeasured = !!dataCenters
    && (dataCenters.routesAttempted ?? []).some((route) => /brockovich/i.test(route) && !/not_run/i.test(route))
    && dataCenterMeasuredHits.length > 0;
  const dataCenterHits = dataCenters?.items ?? [];
  const marketRecord = [market?.subjectBand, market?.zip, market?.county]
    .find((record) => record?.available && record.metrics) ?? null;
  const marketMetrics = marketRecord?.metrics ?? null;
  const marketTiles = [
    marketMetrics?.sellThroughRate != null ? { label: 'Sell-through', value: `${marketMetrics.sellThroughRate}%`, kind: 'rate' } : null,
    marketMetrics?.medianDaysOnMarket != null ? { label: 'Median DOM', value: `${Math.round(marketMetrics.medianDaysOnMarket)}d`, kind: 'time' } : null,
    marketMetrics?.activeCount != null ? { label: 'Active supply', value: String(marketMetrics.activeCount), kind: 'supply' } : null,
    marketMetrics?.monthsOfSupply != null ? { label: 'Months supply', value: `${marketMetrics.monthsOfSupply} mo`, kind: 'supply' } : null,
    marketMetrics?.medianPricePerAcre != null ? { label: 'Median $/acre', value: usd(marketMetrics.medianPricePerAcre), kind: 'price' } : null,
  ].filter((tile): tile is { label: string; value: string; kind: string } => tile != null);

  // The acreage-band read. Retained on every run and, until now, reachable only
  // by opening Comps & Valuation; the Overview showed four county-or-band
  // numbers with nothing to compare them against.
  const bandRow = (
    record: MarketContextRecordView | null | undefined,
    label: string,
    isSubject: boolean,
  ): { label: string; pricePerAcre: string; dom: string; sellThrough: string; monthsSupply: string; sold: string; isSubject: boolean } | null => {
    const metrics = record?.available ? record.metrics : null;
    if (!metrics) return null;
    return {
      label: record?.acreageBandLabel || label,
      pricePerAcre: metrics.medianPricePerAcre != null ? usd(metrics.medianPricePerAcre) : '—',
      dom: metrics.medianDaysOnMarket != null ? `${Math.round(metrics.medianDaysOnMarket)} d` : '—',
      sellThrough: metrics.sellThroughRate != null ? `${Math.round(metrics.sellThroughRate)}%` : '—',
      monthsSupply: metrics.monthsOfSupply != null ? `${metrics.monthsOfSupply} mo` : '—',
      sold: metrics.soldCount != null ? String(metrics.soldCount) : '—',
      isSubject,
    };
  };
  const marketBandRows = [
    bandRow(market?.subjectBand, 'Subject band', true),
    bandRow(market?.fastestBand, 'Fastest-selling band', false),
    bandRow(market?.county, 'All acreage', false),
  ].filter((row): row is NonNullable<typeof row> => row != null);
  const marketBandNote = market?.subjectBand?.available && market?.fastestBand?.available
    && market.subjectBand.acreageBand !== market.fastestBand.acreageBand
    ? `The subject's own band is not the county's liquid band. Read the ${market.subjectBand.acreageBandLabel} row as this parcel's market; the ${market.fastestBand.acreageBandLabel} row shows where the county's demand actually is, and it does not price this parcel.`
    : null;
  const marketReadHeadline = market?.read?.headline ?? null;

  // The reconciled subject decides whether a public listing exists. Overview no
  // longer re-derives it from whichever retained source sorted first, which is
  // how an actively listed subject was reported as having no listing at all.
  const listing = exactAddressListings?.listingCard ?? null;
  const openListingEvidence = () => {
    onOpenSection('property-intelligence');
    requestAnimationFrame(() => document.getElementById('exact-address-listing-evidence')?.scrollIntoView({ behavior: 'smooth' }));
  };

  // Access is source-separated: provider proximity, apparent entrance,
  // reported rights, and verified recorded rights never imply one another.
  const accessEstablished = !!accessView?.established && !accessView?.evidence?.parcelFlagged;
  const accessTiers = [
    {
      label: 'Parcel / landlocked flag',
      state: accessView?.evidence?.parcelFlagged ? 'Flagged landlocked' : accessView?.providerSignal === 'mapped_frontage_not_landlocked' ? 'Provider reports mapped frontage; not flagged landlocked' : 'Not resolved',
      tone: accessView?.evidence?.parcelFlagged ? 'risk' : accessEstablished ? 'verified' : 'neutral',
      detail: accessView?.evidence?.byTier.parcel_flag?.[0]?.statement,
    },
    {
      label: 'Apparent physical access',
      state: accessView?.evidence?.apparentPhysicalAccess ? 'Apparent route observed' : 'Not confirmed',
      tone: accessView?.evidence?.apparentPhysicalAccess ? 'observed' : 'neutral',
      detail: accessView?.evidence?.byTier.apparent_physical?.[0]?.statement,
    },
    {
      label: 'Reported legal / easement access',
      state: accessView?.evidence?.reportedLegalAccess ? 'Reported' : 'Not reported',
      tone: accessView?.evidence?.reportedLegalAccess ? 'reported' : 'neutral',
      detail: accessView?.evidence?.byTier.reported_legal?.[0]?.statement,
    },
    {
      label: 'Verified recorded legal access',
      state: accessView?.evidence?.verifiedLegalAccess ? 'Verified' : 'Not verified',
      tone: accessView?.evidence?.verifiedLegalAccess ? 'verified' : 'risk',
      detail: accessView?.evidence?.byTier.verified_legal?.[0]?.statement,
    },
  ];
  const accessConclusion = accessEstablished
    ? `${accessView?.legalAccess ?? 'Yes'}${accessView?.frontageFt != null ? ` — ${accessView.frontageFt} ft mapped road frontage` : ''}; not flagged landlocked.`
    : accessView?.evidence?.operatorConclusion
      ?? 'Physical and legal access evidence remains unresolved; zoning, septic and utilities still need confirmation.';

  const methodology = unique([...(operator?.methodology?.assumptions ?? []), ...(operator?.methodology?.notes ?? [])]);

  // ── Valuation display rules ────────────────────────────────────────────
  // "House Value" is the only name for the structure's worth. A residential subject over one
  // acre shows Land Value + House Value + Whole Property Value; at one acre
  // or less it shows a single property value with no breakdown. A house value
  // the backend has not established renders as Pending — never fabricated.
  const improvementValuation = compsValuation?.improvementValuation ?? null;
  const acresForValuation = cvSummary?.workingAcres ?? identity.acres ?? null;
  const officialNoCurrentBuilding = /no_current_building|no buildings/i.test(developmentIntelligence?.currentTruth.improvementStatus ?? '');
  const residentialSubject = !officialNoCurrentBuilding && !!improvement?.improved && /resid|house|dwelling|home/i.test(improvement.type ?? '');
  const showHouseBreakdown = residentialSubject && (acresForValuation ?? 0) > 1;
  const singleResidentialValue = residentialSubject && acresForValuation != null && acresForValuation <= 1;
  const houseValue = improvementValuation?.estimatedSubjectImprovementValue ?? null;
  const wholePropertyValue = improvementValuation?.wholePropertyValue ?? null;

  // Overview and Property & Market both read the retained snapshot. These are
  // presentation-only projections of that canonical record; no property name,
  // deal id or proof-property special case participates in the design.
  const factValue = (...keys: string[]): string | null => snap.facts?.find((item) => keys.includes(item.key))?.value ?? null;
  const diligence = new Map((snap.dueDiligence ?? []).map((item) => [item.key, item]));
  // The canonical retained parcel fact sheet answers first. The due-diligence
  // HEADLINE is a verdict sentence, never a measurement, and using it as the
  // fallback value is what printed a review sentence into the slot where the
  // slope percentage belongs.
  const lpf = landPortalFacts ?? null;
  const sheetValue = (value: string | null | undefined): string | null => {
    const text = typeof value === 'string' ? value.trim() : '';
    return text && !/^needs verification$/i.test(text) ? text : null;
  };
  const terrainQuarantine = lpf?.terrainQuarantine ?? null;
  const slopeRaw = sheetValue(lpf?.terrain?.slopeAvgPct)
    ?? factValue('lp_sidebar_slope', 'lp_sidebar_average_slope', 'lp_sidebar_slope_description');
  const buildabilityRaw = sheetValue(lpf?.buildability?.pct)
    ?? factValue('lp_sidebar_buildability', 'lp_sidebar_buildable_area', 'lp_sidebar_buildability_pct');
  const buildableAcresRaw = sheetValue(lpf?.buildability?.acres);
  const wetlandsRaw = sheetValue(lpf?.environment?.wetlandsPct)
    ?? factValue('lp_sidebar_wetlands', 'lp_sidebar_wetlands_pct', 'lp_sidebar_wetland_type')
    ?? diligence.get('wetlands')?.headline ?? null;
  const femaRaw = sheetValue(lpf?.environment?.femaFloodZoneDescription)
    ?? factValue('lp_sidebar_fema_flood_zone_description', 'lp_sidebar_fema_flood_pct', 'lp_sidebar_flood_zone')
    ?? diligence.get('flood')?.headline ?? null;
  const femaCoverageRaw = sheetValue(lpf?.environment?.femaCoveragePct);
  const waterFeature = sheetValue(lpf?.water?.label)
    ?? factValue('lp_sidebar_water_feature_type', 'lp_sidebar_water_feature', 'lp_sidebar_water_features');
  const slopePct = numberIn(slopeRaw, /([\d.]+)\s*%\s*average slope/i)
    ?? numberIn(slopeRaw, /([\d.]+)\s*%/);
  const buildabilityPct = numberIn(buildabilityRaw, /([\d.]+)\s*%\s*buildability/i)
    ?? numberIn(buildabilityRaw, /([\d.]+)\s*%/);
  const wetlandsPct = numberIn(wetlandsRaw, /([\d.]+)\s*%/);
  const femaPct = /not in (?:a )?flood hazard area|no (?:mapped )?flood/i.test(femaRaw ?? '')
    ? 0
    : numberIn(femaCoverageRaw, /([\d.]+)\s*%/) ?? numberIn(femaRaw, /([\d.]+)\s*%/);
  const affectedAcres = (pct: number | null, raw: string | null): number | null => (
    numberIn(raw, /([\d,.]+)\s*(?:acres?|ac)\b/i)
      ?? (pct != null && identity.acres != null ? identity.acres * pct / 100 : null)
  );
  // Public record. Retained by the parcel read on every run, surfaced nowhere.
  const lpEstimatePrice = sheetValue(lpf?.valuation?.lpEstimatePrice) ?? factValue('lpEstimateTotal');
  const lpEstimatePpa = sheetValue(lpf?.valuation?.lpEstimatePpa) ?? factValue('lpEstimatePerAcre');
  const publicRecordTiles = [
    sheetValue(lpf?.valuation?.assessedValue)
      ? { label: 'Assessed value', value: sheetValue(lpf?.valuation?.assessedValue)!, note: 'County roll is the stronger source' } : null,
    sheetValue(lpf?.valuation?.totalMarketValue)
      ? { label: 'Total market value', value: sheetValue(lpf?.valuation?.totalMarketValue)!, note: 'As the parcel record states it' } : null,
    sheetValue(lpf?.valuation?.taxAmount)
      ? { label: 'Annual tax', value: sheetValue(lpf?.valuation?.taxAmount)!, note: 'Delinquency not screened' } : null,
    !officialNoCurrentBuilding && sheetValue(lpf?.improvement?.label)
      ? { label: 'Improvements', value: sheetValue(lpf?.improvement?.label)!, note: sheetValue(lpf?.improvement?.yearBuilt) ? `Built ${sheetValue(lpf?.improvement?.yearBuilt)}` : 'Year built not published' } : null,
    sheetValue(lpf?.parcelContext?.landUse)
      ? { label: 'Land use', value: sheetValue(lpf?.parcelContext?.landUse)!, note: 'Parcel record classification' } : null,
  ].filter((tile): tile is { label: string; value: string; note: string } => tile != null);
  // Strategy is read straight from the lane that produced it. A lane that ran
  // and delivered five assessed exits must not present as an empty section.
  const strategies = (snap.strategies ?? [])
    .filter((item) => !!item?.strategy)
    .slice()
    .sort((a, b) => (
      (STRATEGY_APPLICABILITY_ORDER[(a.applicability || '').toLowerCase()] ?? 9)
      - (STRATEGY_APPLICABILITY_ORDER[(b.applicability || '').toLowerCase()] ?? 9)
    ));
  const recommendation = snap.recommendation ?? null;
  const backstory = landUseIntelligence?.backstory ?? null;
  const zoningAuthority = (landUseIntelligence?.authority?.roles ?? []).find((role) => /zoning/i.test(role.role ?? ''));
  const subdivisionPath = landUseIntelligence?.subdivision?.likelyPathLabel ?? null;
  const authorityLine = zoningAuthority?.name
    ? `Zoning and subdivision authority: ${zoningAuthority.name} (${zoningAuthority.determinationLabel ?? 'confirmed'}).${
      landUseIntelligence?.currentZoning?.established ? '' : ' Current zoning remains unresolved: no current, parcel-specific official source has established the district.'
    }${subdivisionPath ? ` Likely subdivision path: ${subdivisionPath.replace(/_/g, ' ')}.` : ''}`
    : null;

  const acreageText = (value: number | null): string | null => value == null
    ? null
    : `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} ac`;
  const pctText = (value: number | null, fallback: string | null): string => value == null
    ? fallback || 'Not retained'
    : `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
  const subjectStructure = officialNoCurrentBuilding ? 'Vacant Land' : structureLabel(improvement?.type, !!improvement?.improved);
  // The reconciled canonical acreage governs the subject heading when the
  // official-record reconciliation resolved it; a snapshot generated before
  // the reconciliation must not keep presenting the superseded figure.
  const acreageRecon = specialistReads?.acreage?.record?.decision ?? null;
  const acreageReconResolved = acreageRecon?.status === 'resolved_current_canonical'
    || acreageRecon?.status === 'resolved_current_vs_historical_extent';
  const headingAcres = (acreageReconResolved ? acreageRecon?.canonicalAcres : null) ?? identity.acres ?? null;
  const subjectHeading = `${subjectStructure}${headingAcres != null ? ` • ${headingAcres.toLocaleString('en-US', { maximumFractionDigits: 2 })} AC` : ''}`;

  const questionCards = (status?.openQuestions ?? []).map((question) => {
    if (typeof question !== 'string') return {
      label: question.label || 'Diligence item',
      status: question.reason || 'Pending',
      next: question.nextAction || null,
    };
    const [label, detail] = question.split(/\s+[—-]\s+/, 2);
    return { label: label || 'Diligence item', status: detail || 'Pending', next: null };
  }).filter((item) => item.label.trim()).slice(0, 5);
  const actionCards = (nextActions.length ? nextActions : ['Review current evidence']).map((action) => {
    const [label, detail] = action.split(/\s+[—-]\s+/, 2);
    return { label, detail: detail || null };
  }).slice(0, 3);
  const zoningPending = questionCards.some((item) => /zoning|land use/i.test(item.label));
  const knownRiskPattern = /improv|house|whole.?property|septic|terrain|slope|buildab|zoning|access|landlock/i;
  const riskItems: Array<{ label: string; detail: string; tone: 'blocker' | 'caution' | 'pending' }> = [
    ...(showHouseBreakdown && houseValue == null ? [{ label: 'House value pending', detail: 'Whole-property value cannot be completed yet', tone: 'blocker' as const }] : []),
    ...(accessView?.evidence?.parcelFlagged ? [{ label: 'Access conflict', detail: 'Parcel is flagged landlocked', tone: 'blocker' as const }] : !accessEstablished ? [{ label: 'Access pending', detail: 'Physical access evidence remains incomplete', tone: 'pending' as const }] : []),
    ...(soilsSeptic && !/favorable|suitable/i.test(soilsSeptic.categoryLabel) ? [{ label: `Septic: ${soilsSeptic.categoryLabel}`, detail: 'Field testing remains required', tone: 'caution' as const }] : []),
    ...(slopePct != null ? [{ label: `Terrain: ${pctText(slopePct, null)} average slope`, detail: buildabilityPct != null ? `${pctText(buildabilityPct, null)} buildability` : 'Review terrain evidence', tone: 'caution' as const }] : []),
    ...(zoningPending ? [{ label: 'Zoning: Pending', detail: 'Confirm against the official zoning source', tone: 'pending' as const }] : []),
    ...risks.filter((risk) => !knownRiskPattern.test(risk)).slice(0, 2).map((risk) => ({
      label: risk.split(/[.;(]/, 1)[0].replace(/^The subject (?:is|has)\s+/i, '').trim().slice(0, 72),
      detail: 'Review retained risk evidence',
      tone: /pending|unresolved|not confirmed/i.test(risk) ? 'pending' as const : 'caution' as const,
    })),
  ];
  const blockerCount = riskItems.filter((item) => item.tone === 'blocker').length;

  // Key metrics for the decision band: the numbers the operator prices from,
  // ahead of any narrative.
  const decisionMetrics: Array<{ label: string; value: string; sub?: string; tone?: string }> = [
    {
      label: showHouseBreakdown || (!officialNoCurrentBuilding && improvement?.improved) ? 'Land value' : 'Property value',
      value: cvSummary?.fmv ? usd(cvSummary.fmv.central) : 'Pending',
      sub: cvSummary ? `${cvSummary.acceptedCount} accepted sale${cvSummary.acceptedCount === 1 ? '' : 's'} · ${cvSummary.statusLabel}` : undefined,
      tone: 'valuation',
    },
    ...(showHouseBreakdown ? [{
      label: 'Whole property',
      value: wholePropertyValue != null ? usd(wholePropertyValue) : 'Pending',
      sub: wholePropertyValue == null ? 'needs the house value' : undefined,
      tone: 'valuation',
    }] : []),
    {
      label: 'Property score',
      value: operator?.scores?.property?.score != null ? String(operator.scores.property.score) : 'Pending',
      sub: operator?.scores?.property?.rating,
      tone: 'property',
    },
    {
      label: 'Access',
      value: accessEstablished ? 'Established' : 'Unresolved',
      sub: accessEstablished ? (accessView?.road ?? undefined) : 'evidence pending',
      tone: accessEstablished ? 'good' : 'risk',
    },
    ...(soilsSeptic ? [{ label: 'Septic outlook', value: soilsSeptic.categoryLabel, tone: 'risk' }] : []),
  ];

  return (
    <main class="awv2-main awv2-overview" data-testid="acquisition-overview">
      {developmentIntelligence && <OwnerAcquisitionCard dossier={developmentIntelligence} />}
      {/* ── 1. Decision band: the operator decision and its key metrics lead
             the page; every narrative and evidence surface follows. ── */}
      <section class="awv2-overview-decisionband" data-domain="action" aria-label="Operator decision">
        <div class="awv2-command-head">
          <div><div class="awv2-dom-eyebrow" data-dom="action">Decision</div><h2>{decisionHeadline}</h2></div>
          <span class="awv2-decision-state"><Target size={14} /> Acquisition read</span>
        </div>
        <div class="metrics">
          {decisionMetrics.map((metric) => (
            <div class={`metric tone-${metric.tone ?? 'neutral'}`}>
              <small>{metric.label}</small>
              <b>{metric.value}</b>
              {metric.sub && <span>{metric.sub}</span>}
            </div>
          ))}
        </div>
        <div class="awv2-decision-action">
          <ArrowUpRight size={22} aria-hidden="true" />
          <div><small>Next best action</small><b>{acquisitionNextAction?.label || nextActions[0] || 'Review the current evidence'}</b></div>
        </div>
        {decisionSummary !== decisionHeadline && <details class="awv2-decision-rationale"><summary>Decision rationale</summary><p>{decisionSummary}</p></details>}
      </section>

      {/* ── 1a. The four intelligence scores and the quick-flip status, right
             at the decision area: PROPERTY / MARKET / SELLER / DEAL as compact
             shorthand for the persisted intelligence products, with the
             deterministic quick-flip economic screen beside them. SELLER shows
             honestly Unknown pre-contact. Numbers are shorthand; the reads
             behind them live in the Deal Read and on Page 2. ── */}
      {intelligence && (
        <IntelligenceScoreStrip
          scores={intelligence.scores}
          quickFlip={intelligence.quickFlip}
          cashVerdict={intelligence.cashVerdict}
          phaseLabel={intelligence.phaseLabel}
          whatChanged={intelligence.whatChanged}
        />
      )}

      {/* ── 1a2. The three specialist reads behind those scores: what Property
             thinks, what Market + Area thinks, what Seller thinks — the
             persisted specialist products rendered as compact current
             opinions, not the raw reports. Seller is honestly pre-contact
             until real communication exists. Rendering runs nothing. ── */}
      {specialistReads && (
        <SpecialistReadsPanel
          property={specialistReads.property}
          market={specialistReads.market}
          seller={specialistReads.seller}
          stale={specialistReads.stale}
          reconcile={specialistReads.reconcile ?? null}
          acreage={specialistReads.acreage ?? null}
        />
      )}

      {/* ── 1b. Research readiness: the checklist underneath every judgment
             on this page. It sits directly under the decision band because a
             decision is only as good as the research it stands on, and this
             is the one surface that says plainly what ran, what returned a
             usable answer, what is honestly unresolved, and what is simply
             missing. Compact by default; the full checklist is one control
             away. Rendering it never runs research. ── */}
      {researchReadiness && (
        <ResearchReadinessStrip
          manifest={researchReadiness.manifest}
          loading={researchReadiness.loading}
          error={researchReadiness.error}
          running={researchReadiness.running}
          onBackfill={researchReadiness.onBackfill}
        />
      )}

      {/* ── 2. The acquisitions judgment, compressed to a Deal Read. It sits
             directly under the decision band because its whole job is to make
             the facts below it MEAN something; the overview metrics stay
             exactly where they were.

             It is a SUMMARY, not the report. The analyst's full structured
             result — every property-story point, market point, constraint,
             conflict, visual observation, unknown and next action — is
             persisted and rendered whole on Property & Market. Printing all of
             it here is what buried the acquisition command center. ── */}
      {acquisitionIntelligence && (
        <DealReadCard
          read={acquisitionIntelligence.read}
          readiness={acquisitionIntelligence.readiness}
          runtime={acquisitionIntelligence.runtime}
          stale={acquisitionIntelligence.stale}
          running={acquisitionIntelligence.running}
          error={acquisitionIntelligence.error}
          onRun={acquisitionIntelligence.onRun}
          onOpenFullIntelligence={() => {
            onOpenSection('property-intelligence');
            requestAnimationFrame(() => document.getElementById('full-acquisition-intelligence')?.scrollIntoView({ behavior: 'smooth' }));
          }}
        />
      )}

      {/* ── 2b. Deal Brain: ask LandOS about this deal. Operator input is
             stored as deal-specific guidance — never a canonical property
             fact — and replies come from the current deal file. ── */}
      {dealBrain && (
        <>
          {developmentIntelligence && dealBrain.thread.length > 0 && <div class="awv2-pi-note"><b>Historical / superseded guidance:</b> existing Deal Brain replies predate the recorded-document and development reconciliation shown above. They remain retained as history and must not override current acreage, improvement, access, market, or strategy truth.</div>}
          <DealBrainAsk
            thread={dealBrain.thread}
            running={dealBrain.running}
            error={dealBrain.error}
            onAsk={dealBrain.onAsk}
          />
        </>
      )}

      <section class="awv2-overview-hero" data-domain="property" aria-label="Subject property">
        <div class="awv2-overview-aerial">
          {heroSrc
            ? <img src={heroSrc} alt={`LandPortal parcel and site context for ${address}`} />
            : <div class="empty">Parcel imagery has not been retained yet.</div>}
          {visualCount > 0 && <span class="count">{visualCount} parcel / site visual{visualCount === 1 ? '' : 's'} retained</span>}
        </div>
        <div class="awv2-overview-facts">
          <div class="awv2-dom-eyebrow" data-dom="property">Property</div>
          <h2>{subjectHeading}</h2>
          <div class="awv2-property-chips">
            <span class={accessEstablished ? 'good' : 'warn'}>{accessEstablished ? <ShieldCheck size={13} /> : <AlertTriangle size={13} />}{accessEstablished ? `Access · ${accessView?.road || 'established'}` : 'Access unresolved'}</span>
            <span><FileCheck2 size={13} /> {visualCount} visual{visualCount === 1 ? '' : 's'}</span>
          </div>
          <div class="awv2-property-fact-grid" aria-label="Property operating facts">
            <div class="wide"><MapPin size={15} /><span><small>Road access</small><b>{accessView?.road || 'Not retained'}</b><i>{accessView?.frontageFt != null ? `${accessView.frontageFt.toLocaleString('en-US', { maximumFractionDigits: 2 })} ft frontage` : accessEstablished ? 'Frontage established' : 'Pending'}</i></span></div>
            <div><Droplets size={15} /><span><small>FEMA · LandPortal</small><b>{pctText(femaPct, femaRaw)}</b><i>{acreageText(affectedAcres(femaPct, femaRaw)) || 'Affected acres not retained'}</i></span></div>
            <div><Waves size={15} /><span><small>Wetlands · LandPortal</small><b>{pctText(wetlandsPct, wetlandsRaw)}</b><i>{acreageText(affectedAcres(wetlandsPct, wetlandsRaw)) || 'Affected acres not retained'}</i></span></div>
            <div><CircleDot size={15} /><span><small>Water feature</small><b>{waterFeature || 'Not retained'}</b><i>LandPortal</i></span></div>
            <div><Mountain size={15} /><span><small>Average slope</small><b>{pctText(slopePct, terrainQuarantine?.slopeAvgPct ? `${terrainQuarantine.slopeAvgPct} (held)` : null)}</b><i>{terrainQuarantine && slopePct == null ? 'Provider figure held for verification' : 'LandPortal'}</i></span></div>
            <div class="wide"><Ruler size={15} /><span><small>Buildability</small><b>{pctText(buildabilityPct, terrainQuarantine?.buildabilityPct ? `${terrainQuarantine.buildabilityPct} (held)` : null)}</b><i>{
              buildableAcresRaw ? `${buildableAcresRaw} buildable`
                : acreageText(affectedAcres(buildabilityPct, buildabilityRaw)) ? `${acreageText(affectedAcres(buildabilityPct, buildabilityRaw))} buildable`
                  : terrainQuarantine?.buildableAcres ? `${terrainQuarantine.buildableAcres} reported, held for verification`
                    : 'Buildable acres not retained'
            }</i></span></div>
          </div>
          {/* A held-back terrain figure is stated as such. Blanking it made a
              reviewed conflict indistinguishable from an unread source. */}
          {terrainQuarantine && slopePct == null && (
            <p class="awv2-overview-terrain-hold">{terrainQuarantine.reason} Held out of scoring, valuation and strategy until an independent terrain read reconciles it.</p>
          )}
          <div class="awv2-seller-card">
            <UserRound size={22} aria-hidden="true" />
            <div><small>Seller / lead</small><b>{seller?.name || 'Not collected'}</b><span>{seller?.phone || seller?.email || 'Contact details pending'}</span></div>
          </div>
          <dl>
            {identity.apn && <><dt>APN</dt><dd>{identity.apn}</dd></>}
            {zip && <><dt>ZIP</dt><dd>{zip}</dd></>}
            {improvement?.buildingSqft != null && <><dt>{subjectStructure}</dt><dd>{Math.round(improvement.buildingSqft).toLocaleString('en-US')} sqft</dd></>}
          </dl>
          {snap.subjectParcelUrl && <a href={snap.subjectParcelUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Open parcel evidence</a>}
        </div>
      </section>

      {/* ── 2. Valuation: the decision-relevant figures, House Value naming.
             Deep methodology and the audit ledger live in Comps & Valuation. ── */}
      <section class="awv2-overview-valuation" data-domain="valuation" aria-label="Current valuation">
        <div class="section-heading"><div><span class="awv2-dom-eyebrow" data-dom="valuation">Valuation</span><h2>{showHouseBreakdown ? 'Land + house + whole property' : improvement?.improved ? 'Land value established separately; whole-property value pending' : 'Current property valuation'}</h2></div><button type="button" onClick={openCompsValuation}>{openCompsValuationLabel}</button></div>
        {cvSummary ? (
          <>
            <div class="valuation-grid">
              <div class={`primary status-${cvSummary.status}`} data-accepted-count={summary.acceptedCount} title="Land-only indication"><small>{singleResidentialValue ? 'PROPERTY VALUE' : improvement?.improved ? 'LAND VALUE — LAND-ONLY INDICATION' : valuationBasisLabel ?? cvSummary.basisLabel}</small><b>{singleResidentialValue && wholePropertyValue != null ? formatUsd(wholePropertyValue) : cvSummary.fmv ? formatUsd(cvSummary.fmv.central) : 'Not established'}</b><p>{cvSummary.fmv?.low != null && cvSummary.fmv.high != null ? `${formatUsd(cvSummary.fmv.low)}–${formatUsd(cvSummary.fmv.high)} accepted-sale span · ` : ''}{cvSummary.acceptedCount} accepted closed {improvement?.improved ? 'vacant-land ' : ''}sale{cvSummary.acceptedCount === 1 ? '' : 's'} · {cvSummary.statusLabel}</p></div>
              {showHouseBreakdown && (
                <div class="house" aria-label="House value"><small>+ HOUSE VALUE</small><b>{houseValue != null ? formatUsd(houseValue) : 'Pending'}</b><p>{houseValue != null
                  ? `Approx. ${improvement?.buildingSqft != null ? Math.round(improvement.buildingSqft).toLocaleString('en-US') : '—'} sqft residence, valued from improved-sale evidence.`
                  : 'No qualifying improved-sale evidence yet; the house is not separately valued.'}</p></div>
              )}
              {!singleResidentialValue && (
                <div class="whole" aria-label="Whole-property value Pending"><small>= WHOLE-PROPERTY VALUE</small><b>{wholePropertyValue != null ? formatUsd(wholePropertyValue) : improvement?.wholePropertyPending || improvement?.improved ? 'Pending' : cvSummary.fmv ? formatUsd(cvSummary.fmv.central) : 'Not established'}</b><p>{wholePropertyValue != null ? 'Land value plus house value.' : improvement?.improved ? 'Requires the house value; the land figure never prices the residence.' : cvSummary.statusReason}</p></div>
              )}
            </div>
            {cvSummary?.acquisitionLevels && <div class="land-basis-references"><div><span>Opening reference (40% of land value, rounded)</span><b>{landBasisOpeningReference ?? usd(cvSummary.acquisitionLevels.pct40)}</b></div><div><span>Target reference (50% of land value, rounded)</span><b>{usd(cvSummary.acquisitionLevels.pct50)}</b></div><div><span>Ceiling reference (60% of land value, rounded)</span><b>{usd(cvSummary.acquisitionLevels.pct60)}</b></div><p>Land-basis references derived from land value only, rounded to the nearest $500. They are not completed whole-property offer recommendations.</p></div>}
          </>
        ) : <p class="empty">Canonical Comps &amp; Valuation state has not been produced yet.</p>}
      </section>

      {/* ── 3. Score and risks ── */}
      <section class="awv2-overview-decision" data-domain="risk" aria-label="Score and major risks">
        <div class="summary"><span class="awv2-dom-eyebrow" data-dom="risk">Risk scan</span><div class={`awv2-risk-count ${blockerCount ? 'open' : 'clear'}`}>{blockerCount ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}<b>{blockerCount}</b><span>{blockerCount === 1 ? 'deal blocker' : 'deal blockers'}</span></div></div>
        <ScoreCard view={operator?.scores?.property} />
        <div class="risks">
          <h2>Risk signals</h2>
          <div class="awv2-risk-items">{(riskItems.length ? riskItems : [{ label: 'No material risk retained', detail: 'Continue ordinary diligence', tone: 'pending' as const }]).slice(0, 4).map((item) => (
            <div class={`awv2-risk-item ${item.tone}`}>
              {item.tone === 'blocker' ? <AlertTriangle size={15} /> : item.tone === 'caution' ? <CircleDot size={15} /> : <FileCheck2 size={15} />}
              <span><b>{item.label}</b><small>{item.detail}</small></span>
              <em>{item.tone === 'blocker' ? 'Blocker' : item.tone === 'caution' ? 'Watch' : 'Pending'}</em>
            </div>
          ))}</div>
        </div>
      </section>

      {/* ── 3a. Public record + planning history ──
          Assessment, market value, annual tax and the provider's own estimate
          are decision inputs an operator asks for first, and the retained
          planning record is the story of what has already been attempted on
          this parcel. All of it was retained and none of it reached this page. */}
      {(publicRecordTiles.length > 0 || backstory) && (
        <section class="awv2-overview-record" data-domain="property" aria-label="Public record and planning history">
          <div class="section-heading">
            <div>
              <span class="awv2-dom-eyebrow" data-dom="property">Public record</span>
              <h2>Assessment, tax &amp; planning history</h2>
            </div>
            <button type="button" onClick={() => onOpenSection('property-intelligence')}>Open property evidence →</button>
          </div>
          {publicRecordTiles.length > 0 && (
            <div class="awv2-record-tiles">
              {publicRecordTiles.map((tile) => (
                <div><span>{tile.label}</span><b>{tile.value}</b><i>{tile.note}</i></div>
              ))}
            </div>
          )}
          {lpEstimatePrice && (
            <p class="awv2-record-note">
              <b>LP Estimate {lpEstimatePrice}{lpEstimatePpa ? ` (${lpEstimatePpa}/ac)` : ''}.</b>{' '}
              LandPortal&apos;s own automated estimate, shown exactly as it publishes it. It is
              provider context and never an input to the LandOS land value or any acquisition level.
            </p>
          )}
          {/* Planning history is a headline on the Overview and a timeline on
              Property & Market. Printing the whole narrative, every highlight
              and every open question in both places is the duplication that
              made this section the longest thing on the page. */}
          {backstory && (
            <div class="awv2-record-backstory">
              <h3>Property backstory</h3>
              <p class="lede">{(backstory.highlights ?? [])[0] || backstory.narrative}</p>
              <details class="awv2-overview-details">
                <summary>Full planning narrative{(backstory.openQuestions ?? []).length ? ` · ${(backstory.openQuestions ?? []).length} open question(s)` : ''}</summary>
                <p>{backstory.narrative}</p>
                {(backstory.highlights ?? []).length > 0 && (
                  <ul>{(backstory.highlights ?? []).map((item) => <li>{item}</li>)}</ul>
                )}
                {(backstory.openQuestions ?? []).length > 0 && (
                  <p class="awv2-record-note"><b>Open questions the record raises:</b> {(backstory.openQuestions ?? []).join(' ')}</p>
                )}
              </details>
            </div>
          )}
          {authorityLine && <p class="awv2-record-note">{authorityLine}</p>}
        </section>
      )}

      {/* ── 3b. Exit strategy ──
          The strategy lane's real output. A BLOCKED strategy is a finding, not
          an absence: it names the exit, what already supports it, and the one
          thing standing between the operator and pursuing it. Printing only
          "strategy selection is pending" threw all of that away. */}
      {(strategies.length > 0 || developmentIntelligence?.recommendation) && (
        <section class="awv2-overview-strategy" data-domain="strategy" aria-label="Exit strategy">
          <div class="section-heading">
            <div>
              <span class="awv2-dom-eyebrow" data-dom="strategy">Strategy</span>
              <h2>{developmentIntelligence?.recommendation
                ? `Recommended: ${developmentIntelligence.recommendation.strategy}`
                : recommendation?.preferredStrategy
                ? `Preferred exit: ${recommendation.preferredStrategy}`
                : 'Exit strategies assessed'}</h2>
            </div>
            {recommendation?.posture && <span class="awv2-strategy-posture" data-posture={recommendation.posture}>{recommendation.posture}</span>}
          </div>
          {(developmentIntelligence?.recommendation?.basis || recommendation?.postureWhy || recommendation?.why) && (
            <p class="awv2-strategy-why">{developmentIntelligence?.recommendation?.basis || recommendation?.postureWhy || recommendation?.why}</p>
          )}
          {/* The strongest few exits, each as four scannable lines: fit,
              why it fits, the one thing blocking it, what would confirm it.
              Effort/timeline/risk and the full supporting-fact list are real
              lane output and stay on the card, one control away. Every exit
              the lane assessed beyond the strongest few follows below in the
              same shape — none of them is dropped. */}
          {developmentIntelligence?.recommendation ? (
            <div class="awv2-pi-note"><b>Quick flip:</b> {developmentIntelligence.recommendation.quickFlip}<br /><b>Major development:</b> {developmentIntelligence.recommendation.majorDevelopment}<br /><b>Maximum basis:</b> {developmentIntelligence.recommendation.maximumBasis}</div>
          ) : <div class="awv2-strategy-grid">
            {strategies.slice(0, 3).map((item) => <StrategyCard item={item} />)}
          </div>}
          {!developmentIntelligence?.recommendation && strategies.length > 3 && (
            <details class="awv2-strategy-more">
              <summary>{strategies.length - 3} further exit{strategies.length - 3 === 1 ? '' : 's'} assessed</summary>
              <div class="awv2-strategy-grid">
                {strategies.slice(3).map((item) => <StrategyCard item={item} />)}
              </div>
            </details>
          )}
          {(recommendation?.whatWouldChangeIt ?? []).length > 0 && (
            <div class="awv2-strategy-unlock">
              <h3>What would settle the strategy</h3>
              <ul>{(recommendation?.whatWouldChangeIt ?? []).map((item) => <li>{item}</li>)}</ul>
            </div>
          )}
          {recommendation?.juiceWorthSqueeze?.why && (
            <p class="awv2-strategy-why">
              <b>Worth the effort? {recommendation.juiceWorthSqueeze.answer ?? 'undetermined'}.</b>{' '}
              {recommendation.juiceWorthSqueeze.why}
            </p>
          )}
        </section>
      )}

      {/* ── 4. Market intelligence ── */}
      <section class="awv2-overview-market" data-domain="market" aria-label="Market intelligence">
        <div class="section-heading"><div><span class="awv2-dom-eyebrow" data-dom="market">Market intelligence</span><h2>Local market read</h2></div><button type="button" onClick={() => onOpenSection('property-intelligence')}>Open Market Intelligence →</button></div>
        {marketTiles.length > 0
          ? <div class="awv2-market-tiles">{marketTiles.slice(0, 5).map((tile) => <div data-kind={tile.kind}><span>{tile.label}</span><b>{tile.value}</b><i /></div>)}</div>
          : <div class="awv2-market-empty"><span>No retained market pulse</span><b>Price from subject evidence</b><small>Market context remains compact until a supported record exists.</small></div>}
        {/* The acreage-band read, which is the part of Market Research that
            actually bears on this parcel. Four headline numbers alone say
            nothing about whether the subject's own band is the liquid one; the
            comparison against the county and the fastest-selling band is the
            read an operator uses, and it was retained but never shown here. */}
        {marketBandRows.length > 0 && (
          <div class="awv2-market-bands">
            <table>
              <thead>
                <tr><th>Acreage band</th><th>Median $/ac</th><th>Median DOM</th><th>Sell-through</th><th>Months supply</th><th>Sold</th></tr>
              </thead>
              <tbody>
                {marketBandRows.map((row) => (
                  <tr data-subject={row.isSubject ? 'true' : 'false'}>
                    <td>{row.label}{row.isSubject ? <em> subject band</em> : null}</td>
                    <td>{row.pricePerAcre}</td>
                    <td>{row.dom}</td>
                    <td>{row.sellThrough}</td>
                    <td>{row.monthsSupply}</td>
                    <td>{row.sold}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {marketBandNote && <p class="awv2-market-band-note">{marketBandNote}</p>}
          </div>
        )}
        {marketReadHeadline && <p class="awv2-market-band-note">{marketReadHeadline}</p>}
        {narrative?.overviewMarketLine && <details class="awv2-market-detail"><summary>Market interpretation</summary><p>{narrative.overviewMarketLine}</p></details>}
        {/* The 20-mile data-center screen. Either the nearby project(s) with
            status, distance and source, or an explicit "none found" — never a
            silent absence. */}
        {dataCenters && (
          <details class="awv2-market-detail">
            <summary>
              {/* Only a screen that actually measured the radius may claim a
                  distance. County-scoped search signals whose locations were
                  never established are real findings, but they are not "within
                  20 miles", and saying so states a proximity nothing measured. */}
              {dataCenterRadiusMeasured
                ? `Data centers within ${dataCenters.searchedWithinMiles ?? 20} miles — ${dataCenterMeasuredHits.length} measured${
                  dataCenterHits.length > dataCenterMeasuredHits.length
                    ? ` · ${dataCenterHits.length - dataCenterMeasuredHits.length} further county signal(s), distance not established`
                    : ''}`
                : dataCenterHits.length
                  ? `Data-center activity reported in the county — ${dataCenterHits.length} signal(s), distance from the subject not measured`
                  : `Data-center screen — ${(dataCenters.status ?? 'not run').replace(/_/g, ' ')}`}
            </summary>
            <p>{dataCenters.verdict || dataCenters.summary || 'No data-center result was retained for this subject.'}</p>
            {dataCenterHits.length > 0 && (
              <ul class="awv2-market-dc-list">
                {dataCenterHits.slice(0, 6).map((hit) => (
                  <li>
                    <b>{hit.name || 'Data center project'}</b>
                    {' — '}
                    {[
                      (hit.status ?? '').replace(/_/g, ' ') || null,
                      hit.distanceMiles != null ? `~${hit.distanceMiles} mi` : null,
                      hit.location || null,
                      hit.operatorOrDeveloper || null,
                    ].filter(Boolean).join(' · ')}
                    {hit.sourceUrl && <> · <a href={hit.sourceUrl} target="_blank" rel="noreferrer">source</a></>}
                  </li>
                ))}
              </ul>
            )}
            {!!dataCenters.routesAttempted?.length && (
              <p class="awv2-market-dc-routes">Routes attempted: {dataCenters.routesAttempted.join(' · ')}</p>
            )}
          </details>
        )}
      </section>

      <section class={`awv2-overview-listing awv2-marketing-compact ${listing?.onMarket ? 'active' : 'inactive'}`} data-domain="evidence" aria-label="Public marketing status">
        <div class="awv2-marketing-state">
          <span class="awv2-dom-eyebrow" data-dom="evidence">Public marketing</span>
          <h2>{listing?.onMarket ? listing.statusLabel : 'Off Market'}</h2>
          <p>{listing?.onMarket
            ? [listing.currentPrice != null ? formatUsd(listing.currentPrice) : null, listing.listingAgeDays != null ? `${listing.listingAgeDays} days listed` : null].filter(Boolean).join(' · ') || 'Verified public listing'
            : 'No verified public listing'}</p>
        </div>
        <button type="button" onClick={openListingEvidence}>View listing evidence →</button>
      </section>

      <section class="awv2-overview-access" data-domain="property" aria-label="Access evidence ladder">
        <div class="section-heading"><div><span class="awv2-dom-eyebrow" data-dom="property">Access</span><h2>{accessEstablished ? 'Access established' : 'Physical evidence is not legal proof'}</h2></div><button type="button" onClick={() => onOpenSection('property-intelligence')}>Open property evidence →</button></div>
        <p>{accessConclusion}</p>
        {/* Established access keeps its evidence ladder as collapsed
            provenance; unresolved access shows the ladder open because the
            gap IS the message. */}
        {accessEstablished ? (
          <details class="awv2-overview-details"><summary>Access evidence provenance</summary>
            <div class="ladder">{accessTiers.map((tier, index) => <div class={`rung ${tier.tone}`}><span class="number">{index + 1}</span><div><small>{tier.label}</small><b>{tier.state}</b>{tier.detail && <p>{tier.detail}</p>}</div></div>)}</div>
            <p>Recorded-instrument access remains ordinary closing diligence, not a discovery-stage blocker.</p>
          </details>
        ) : (
          <div class="ladder">{accessTiers.map((tier, index) => <div class={`rung ${tier.tone}`}><span class="number">{index + 1}</span><div><small>{tier.label}</small><b>{tier.state}</b>{tier.detail && <p>{tier.detail}</p>}</div></div>)}</div>
        )}
      </section>

      {visualBuyerSummary && (
        <section class="awv2-overview-access" data-domain="evidence" aria-label="Visual buyer summary">
          <div class="section-heading"><div><span>{visualBuyerSummaryLabel}</span><h2>{visualBuyerSummary.physicalCharacter || 'Physical character not summarized'}</h2></div><button type="button" onClick={onOpenVisualBuyerAnalysis}>{visualBuyerAnalysisLabel}</button></div>
          <p><b>Buyer appeal:</b> {visualBuyerSummary.mainBuyerAppeal || 'Not summarized'} · <b>Top concern:</b> {visualBuyerSummary.topConcern || 'Not summarized'}</p>
        </section>
      )}

      {soilsSeptic && (
        <section class="awv2-overview-access" data-domain="risk" aria-label="Septic outlook">
          <div class="section-heading"><div><span>Septic outlook</span><h2>{soilsSeptic.categoryLabel}</h2></div><button type="button" onClick={() => { onOpenSection('property-intelligence'); requestAnimationFrame(() => document.getElementById('soils-septic')?.scrollIntoView({ behavior: 'smooth' })); }}>Open soils &amp; septic evidence →</button></div>
          <p>{soilsSeptic.conclusion} Field testing remains required.</p>
        </section>
      )}

      <section class="awv2-overview-closeout" data-domain="action" aria-label="Unresolved diligence and next action">
        <div>
          <span>Still unresolved</span>
          <h2>Diligence queue</h2>
          {status?.questionsHeadline && <p class="questions">{status.questionsHeadline}</p>}
          <div class="awv2-diligence-rows">{(questionCards.length ? questionCards : (unresolved.length ? unresolved : ['No unresolved question is listed']).map((item) => ({ label: item.split(/\s+[—-]\s+/, 1)[0], status: 'Pending', next: null }))).slice(0, 5).map((item) => (
            <div class="awv2-diligence-row"><FileCheck2 size={15} /><span><b>{item.label}</b><small>{item.status}</small></span><em>{item.next || 'Review'}</em></div>
          ))}</div>
        </div>
        <div class="next">
          <span>What happens next</span>
          <h2>Operator actions</h2>
          <div class="awv2-action-rows">{actionCards.map((item, index) => (
            <div class="awv2-action-row"><b>{index + 1}</b><span><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</span><ArrowUpRight size={15} /></div>
          ))}</div>
        </div>
      </section>

      {(methodology.length > 0 || askingPrice != null) && <details class="awv2-overview-methodology"><summary>Supporting assumptions and secondary details</summary>{askingPrice != null && <p>Seller-stated asking price: {formatUsd(askingPrice)}.</p>}<ul>{methodology.map((item) => <li>{item}</li>)}</ul></details>}
    </main>
  );
}
