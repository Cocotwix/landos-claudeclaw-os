import fs from 'node:fs';
import { APPROVED_STRATEGIES, type ApprovedStrategy } from './strategy-readiness.js';
import type { DealIntelligenceInputPackage } from './deal-intelligence-assembly.js';
import { dedupeImages, type VisionSourceImage } from './browser-vision.js';
import { resolveValuationScope } from './property-intelligence-snapshot.js';
import type {
  OpportunityPosture,
  PropertyIntelligenceSnapshot,
  SnapshotDueDiligenceItem,
  SnapshotStrategy,
  SnapshotValuation,
  ValuationScopeState,
} from './property-intelligence-snapshot.js';
import type { CanonicalDealState } from './deal-card-reconciliation.js';

export type OperatorRating = 'Excellent' | 'Strong' | 'Moderate' | 'Weak' | 'Very weak' | 'Pending';

export interface OperatorScore {
  /** Null is intentional for Seller Score when no substantive seller evidence
   *  exists. Missing evidence is not a weak seller. */
  score: number | null;
  rating: OperatorRating;
  explanation: string;
  strongestPositiveFactors: string[];
  mainDeductions: string[];
  materiallyChangeWith: string[];
  evidenceKeys: string[];
}

export type ResearchAttemptStatus =
  | 'retrieved'
  | 'useful_indication'
  | 'attempted_inconclusive'
  | 'source_unavailable'
  | 'not_found'
  | 'not_run'
  | 'not_run_system_failure';

export interface OperatorResearchAttempt {
  key: string;
  label: string;
  category: string;
  source: string;
  url: string | null;
  attemptCount: number;
  status: ResearchAttemptStatus;
  result: string;
  artifactIds: string[];
  attemptedAt: string | null;
}

export interface OperatorSellerContext {
  name: string | null;
  phone: string | null;
  email: string | null;
  notes: string[];
  askingPrice: number | null;
  timeline: string | null;
  responsiveness: string | null;
  flexibility: string | null;
  decisionAuthority: string | null;
  ownershipContext: string | null;
  followUpDate: string | null;
  offerHistory: string[];
  communications: Array<{ kind: string; at: string | null; summary: string }>;
  tasks: Array<{ label: string; dueAt: string | null; status: string }>;
}

export interface OperatorVisualContext {
  ok: boolean;
  model: string | null;
  summary: string;
  analyzed: Array<{ label: string; kind: string }>;
  observations: Array<{
    category: string;
    observation: string;
    signal: 'positive' | 'concern' | 'neutral';
    confidence: 'high' | 'medium' | 'low';
    sourceImage: string;
  }>;
  note: string | null;
}

export interface DealOperatorContext {
  seller: OperatorSellerContext;
  researchAttempts: OperatorResearchAttempt[];
  /** The existing combined live market scan, including Data Center Watch. */
  marketScan: unknown | null;
  /** Existing manually retained market-research notes and source links. */
  marketWorksheet: unknown | null;
  /** Output of the real retained-image vision pass, when it ran. */
  visualAnalysis: OperatorVisualContext | null;
}

export function emptyDealOperatorContext(): DealOperatorContext {
  return {
    seller: {
      name: null, phone: null, email: null, notes: [], askingPrice: null,
      timeline: null, responsiveness: null, flexibility: null,
      decisionAuthority: null, ownershipContext: null, followUpDate: null,
      offerHistory: [], communications: [], tasks: [],
    },
    researchAttempts: [],
    marketScan: null,
    marketWorksheet: null,
    visualAnalysis: null,
  };
}

export interface OperatorValueBand {
  low: number;
  high: number;
  label: string;
  basis: string;
}

export interface OperatorAcquisitionScenario {
  name: 'Conservative' | 'Expected' | 'Stronger';
  resalePrice: number;
  acquisitionPrice: number;
  estimatedCosts: number;
  estimatedProfit: number;
  assumption: string;
}

export interface OperatorStrategyEvaluation {
  rank: number;
  strategy: ApprovedStrategy;
  currentFit: 'Strong' | 'Moderate' | 'Conditional' | 'Weak';
  expectedBuyer: string;
  capitalRequired: string;
  effort: string;
  timeline: string;
  expectedUpside: string;
  mainRisk: string;
  evidenceSupport: string[];
  couldChangeRanking: string[];
  sellerFit: string;
  nextUsefulCheck: string;
  financialScenarios: OperatorAcquisitionScenario[];
}

export interface OperatorSubdivisionScenario {
  lots: number;
  approximateAcresPerLot: number | null;
  lotMix: Array<{ lotCount: number; approximateAcresEach: number; acreageBand: string }>;
  configurationRationale: string;
  feasibility: 'Plausible' | 'Worth testing' | 'Unattractive' | 'Not supported';
  grossValue: { low: number; high: number } | null;
  estimatedCosts: {
    low: number;
    high: number;
    includesAcquisition: boolean;
    categories: string[];
    items: Array<{
      label: string;
      low: number;
      high: number;
      basis: string;
    }>;
  } | null;
  estimatedNetProfit: { low: number; high: number } | null;
  /** Backward-compatible alias. When present it is identical to
   *  estimatedNetProfit and includes acquisition plus the complete modeled
   *  project cost basis. */
  likelyNetOpportunity: { low: number; high: number } | null;
  note: string;
}

export interface OperatorSubdivisionAnalysis {
  status: 'Promising' | 'Worth investigating' | 'Needs confirmation' | 'Unattractive' | 'Not supported' | 'Confirmed obstacle';
  governingJurisdiction: string | null;
  minimumLotSize: string | null;
  minimumFrontage: string | null;
  observedFrontageFeet: number | null;
  minorSubdivisionThreshold: string | null;
  automaticFirstLook: boolean;
  signalExplanation: string;
  simplestPracticalLotCount: number | null;
  appearsAllowedByRight: boolean | null;
  roadRequirements: string | null;
  surveyAndPlatRequirements: string | null;
  septicAndUtilityConditions: string | null;
  approvalPath: string[];
  scenarios: OperatorSubdivisionScenario[];
  estimatedTimeline: string;
  mainRisks: string[];
  nextChecks: string[];
  evidenceKeys: string[];
}

export interface OperatorComparableQuality {
  key: string;
  lane: 'sold' | 'active';
  similarity: 'Strong' | 'Moderate' | 'Context only';
  relativeWeight: number;
  explanation: string;
  materialDifferences: string[];
}

export interface OperatorAcreageBand {
  label: '50+ acres' | '20–50 acres' | '10–20 acres' | '5–10 acres' | '2–5 acres' | '1–2 acres' | '0–1 acres';
  soldCount: number;
  activeCount: number;
  medianSalePrice: number | null;
  medianSoldPricePerAcre: number | null;
  medianActivePricePerAcre: number | null;
  medianDaysOnMarket: number | null;
  sellThroughRate: number | null;
  absorptionRate: number | null;
  absorptionPerMonth: number | null;
  monthsOfSupply: number | null;
  population: number | null;
  populationDensity: number | null;
  populationGrowth: number | null;
  priceTrend: { direction: 'up' | 'down' | 'flat' | 'insufficient'; percent: number | null };
  likelyResaleTime: string;
  movementRank: number | null;
  snapshotPeriod: string | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  coverage: string;
  source: string;
  evidenceStrength: 'usable' | 'thin' | 'none';
}

export interface OperatorMarketAnalysis {
  strength: 'Strong' | 'Moderate' | 'Weak' | 'Uncertain';
  buyerDemand: string;
  resaleDifficulty: string;
  likelyMarketingTime: string;
  expectedBulkMarketingTime: string;
  expectedSmallerLotMarketingTime: string;
  internalMetrics: Array<{ label: string; value: string; source: string }>;
  acreageAndPriceBands: string[];
  acreageBands: OperatorAcreageBand[];
  bestMovingAcreageBands: string[];
  bulkVersusSplit: {
    bulkBand: OperatorAcreageBand | null;
    smallerLotBands: OperatorAcreageBand[];
    conclusion: string;
  };
  developmentAndInfrastructure: Array<{
    name: string;
    location: string | null;
    distanceMiles: number | null;
    status: string;
    timeline: string | null;
    scale: string | null;
    likelyEffect: string;
    downside: string | null;
    sourceUrl: string | null;
  }>;
  /**
   * Sourced web evidence on the county land market at the subject's acreage
   * range. The retained Market Research store carries a single quarter for most
   * counties, so it states levels but cannot state DIRECTION; this carries the
   * published claims about direction, attributed, next to those numbers. Never
   * a LandOS measurement.
   */
  landMarketWeb: {
    status: 'found' | 'none_found' | 'not_run' | 'unavailable';
    acreageFocus: string | null;
    summary: string;
    items: Array<{ title: string; summary: string; url: string | null; year: number | null }>;
  };
  dataCenters: {
    searchedWithinMiles: 20;
    status: 'found' | 'none_found' | 'not_run' | 'unavailable';
    summary: string;
    /** The explicit one-line answer, including a clean "nothing within 20 miles". */
    verdict: string;
    /** Every retrieval route attempted, so a negative reads as searched, not skipped. */
    routesAttempted: string[];
    sourceUrl: string | null;
    screenshotUrl: string | null;
    attemptedAt: string | null;
    items: Array<{
      name: string;
      operatorOrDeveloper: string | null;
      location: string | null;
      distanceMiles: number | null;
      status: string;
      timeline: string | null;
      scale: string | null;
      likelyEffect: string;
      downside: string | null;
      sourceUrl: string | null;
    }>;
  };
  conclusion: string;
  strategyImplications: string[];
  limitations: string[];
}

export interface OperatorSellerAnalysis {
  snapshot: OperatorSellerContext;
  negotiationPosture: string;
  importantFacts: string[];
  discoveryCallQuestions: string[];
  nextContactAction: string;
}

export interface DealOperatorAnalysis {
  version: 1;
  generatedAt: string;
  analyst: {
    engine: 'landos-deal-analyst-v1';
    mode: 'evidence_synthesis' | 'multimodal_llm_assisted';
    model: string | null;
    reviewedEvidenceIds: string[];
    reviewedImages: string[];
    visualSummary: string | null;
    groundingNote: string;
  };
  scores: {
    property: OperatorScore;
    market: OperatorScore;
    seller: OperatorScore;
  };
  overall: {
    posture: OpportunityPosture;
    recommendation: string;
    bestCurrentStrategy: ApprovedStrategy | null;
    mainOpportunity: string;
    mainRisks: string[];
    unansweredQuestions: string[];
    nextBestActions: string[];
    whatCouldMateriallyChangeConclusion: string[];
  };
  values: {
    expectedMarketValue: OperatorValueBand | null;
    retailAskingRange: OperatorValueBand | null;
    quickSaleDispositionRange: OperatorValueBand | null;
    workingUnderwritingValue: number | null;
    openingPosition: number | null;
    targetAcquisitionRange: OperatorValueBand | null;
    practicalMaximumAcquisitionPrice: number | null;
    walkAwayLevel: number | null;
    offerBasis: 'whole_tract_resale_only';
    subdivisionUpsideIncluded: false;
    explanation: string;
    scenarios: OperatorAcquisitionScenario[];
    /**
     * What every figure above actually IS. On a materially improved subject
     * whose improvements are not separately valued, Opening / Target / Ceiling
     * are LAND-BASIS references and must be labelled as such — never as a
     * completed whole-property offer recommendation.
     */
    valuationScope: ValuationScopeState;
    figureKind: ValuationScopeState['figureKind'];
    figureLabel: string;
    wholePropertyValue: ValuationScopeState['wholeProperty'];
  };
  comps: {
    soldSelectionTarget: 5;
    activeSelectionTarget: 4;
    soldShown: number;
    activeShown: number;
    selectionExplanation: string;
    soldQuality: OperatorComparableQuality[];
    activeQuality: OperatorComparableQuality[];
    manufacturedHomeLane: {
      searchedWithinMiles: 5;
      status: 'completed' | 'blocked' | 'unavailable' | 'not_run';
      searchPeriodMonths: number;
      sourcesSearched: string[];
      routesAttempted: string[];
      candidatesReviewed: number;
      exclusionReasons: Array<{ reason: string; count: number }>;
      qualifyingSales: number;
      conclusion: string;
    };
    marketplaceSearchProof: Array<{
      source: 'Zillow' | 'Redfin';
      status: 'retained' | 'attempted_no_qualifying_result' | 'no_attempt_evidence';
      soldRetained: number;
      activeRetained: number;
      result: string;
    }>;
  };
  rankedStrategies: OperatorStrategyEvaluation[];
  market: OperatorMarketAnalysis;
  subdivision: OperatorSubdivisionAnalysis;
  seller: OperatorSellerAnalysis;
  researchAttempts: OperatorResearchAttempt[];
  changeNotes: string[];
  evidenceNotes: string[];
  /**
   * The one canonical current state this analysis was reconciled against, when
   * the caller supplied it. Comp counts, valuation status, blockers, missing
   * information, decision summary and next actions are read from HERE by every
   * page, so Overview, Property Intelligence and Comps & Valuation cannot
   * disagree about the same evidence.
   */
  canonicalState: CanonicalDealState | null;
}

export type WholeCardVisionGenerator = (
  prompt: string,
  images: Array<{ data: string; mimeType: string }>,
  model?: string,
) => Promise<string>;

interface WholeCardModelReview {
  propertyScore?: Partial<OperatorScore>;
  marketScore?: Partial<OperatorScore>;
  sellerScore?: Partial<OperatorScore>;
  posture?: OpportunityPosture;
  recommendation?: string;
  bestStrategy?: ApprovedStrategy | null;
  mainOpportunity?: string;
  mainRisks?: string[];
  unansweredQuestions?: string[];
  nextBestActions?: string[];
  whatCouldMateriallyChangeConclusion?: string[];
  visualSummary?: string;
  visualObservations?: OperatorVisualContext['observations'];
  marketConclusion?: string;
  subdivisionStatus?: OperatorSubdivisionAnalysis['status'];
  evidenceNotes?: string[];
}

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

function rating(score: number): OperatorRating {
  if (score >= 85) return 'Excellent';
  if (score >= 70) return 'Strong';
  if (score >= 50) return 'Moderate';
  if (score >= 30) return 'Weak';
  return 'Very weak';
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim() ?? '').filter(Boolean))];
}

function firstText(values: Array<string | null | undefined>): string | null {
  return values.find((value) => value?.trim())?.trim() ?? null;
}

function compactMoney(value: number): string {
  return `$${Math.round(value).toLocaleString()}`;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const ACREAGE_BAND_DEFINITIONS: Array<{
  label: OperatorAcreageBand['label'];
  low: number;
  high: number;
}> = [
  { label: '50+ acres', low: 50, high: Number.POSITIVE_INFINITY },
  { label: '20–50 acres', low: 20, high: 50 },
  { label: '10–20 acres', low: 10, high: 20 },
  { label: '5–10 acres', low: 5, high: 10 },
  { label: '2–5 acres', low: 2, high: 5 },
  { label: '1–2 acres', low: 1, high: 2 },
  { label: '0–1 acres', low: 0, high: 1 },
];

function acreageBandLabel(acres: number | null | undefined): OperatorAcreageBand['label'] | null {
  if (acres == null || !Number.isFinite(acres)) return null;
  return ACREAGE_BAND_DEFINITIONS.find((band) => acres >= band.low && acres < band.high)?.label ?? null;
}

function acreageBands(pkg: DealIntelligenceInputPackage): OperatorAcreageBand[] {
  return ACREAGE_BAND_DEFINITIONS.map(({ label }) => {
    const sold = pkg.comps.sold.filter((comp) => acreageBandLabel(comp.acres) === label);
    const active = pkg.comps.active.filter((comp) => acreageBandLabel(comp.acres) === label);
    const soldPpa = sold.map((comp) => comp.pricePerAcre).filter((value): value is number => value != null && value > 0);
    const activePpa = active.map((comp) => comp.pricePerAcre).filter((value): value is number => value != null && value > 0);
    const dom = active.map((comp) => comp.daysOnMarket).filter((value): value is number => value != null && value >= 0);
    return {
      label,
      soldCount: sold.length,
      activeCount: active.length,
      medianSalePrice: median(sold.map((comp) => comp.price).filter((value): value is number => value != null && value > 0)),
      medianSoldPricePerAcre: median(soldPpa),
      medianActivePricePerAcre: median(activePpa),
      medianDaysOnMarket: median(dom),
      sellThroughRate: sold.length + active.length > 0 ? sold.length / (sold.length + active.length) * 100 : null,
      absorptionRate: null,
      absorptionPerMonth: null,
      monthsOfSupply: null,
      population: null,
      populationDensity: null,
      populationGrowth: null,
      priceTrend: { direction: 'insufficient' as const, percent: null },
      likelyResaleTime: median(dom) != null
        ? `${Math.max(1, Math.round(median(dom)! / 30))}–${Math.max(2, Math.round(median(dom)! / 30) + 2)} months based on active DOM`
        : 'Insufficient county Market Research timing evidence',
      movementRank: null,
      snapshotPeriod: null,
      confidence: sold.length >= 3 ? 'medium' as const : sold.length || active.length ? 'low' as const : 'none' as const,
      coverage: 'Selected comp working set only; county Market Research snapshot not connected.',
      source: 'Selected comp working set',
      evidenceStrength: sold.length >= 3 ? 'usable' : sold.length || active.length ? 'thin' : 'none',
    };
  });
}

const PRACTICAL_BAND_KEYS = ['50+', '20-50', '10-20', '5-10', '2-5', '1-2', '0-1'] as const;

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function projectedAcreageBands(
  pkg: DealIntelligenceInputPackage,
  practicalBands: Array<Record<string, unknown>>,
): OperatorAcreageBand[] {
  const fallback = acreageBands(pkg);
  return fallback.map((base, index) => {
    const row = practicalBands.find((candidate) => candidate.band === PRACTICAL_BAND_KEYS[index]);
    if (!row) return base;
    const soldCount = finiteNumber(row.soldVolume) ?? base.soldCount;
    const activeCount = Math.max(finiteNumber(row.activeInventory) ?? 0, base.activeCount);
    const trend = scanObject(row.priceTrend);
    const direction = ['up', 'down', 'flat', 'insufficient'].includes(String(trend.direction))
      ? String(trend.direction) as OperatorAcreageBand['priceTrend']['direction']
      : 'insufficient';
    const confidence = ['high', 'medium', 'low', 'none'].includes(String(row.confidence))
      ? String(row.confidence) as OperatorAcreageBand['confidence']
      : base.confidence;
    return {
      ...base,
      soldCount,
      activeCount,
      medianSalePrice: finiteNumber(row.medianSalePrice) ?? base.medianSalePrice,
      medianSoldPricePerAcre: finiteNumber(row.medianPricePerAcre) ?? base.medianSoldPricePerAcre,
      medianDaysOnMarket: finiteNumber(row.medianDaysOnMarket) ?? base.medianDaysOnMarket,
      sellThroughRate: finiteNumber(row.sellThroughRate) ?? base.sellThroughRate,
      absorptionRate: finiteNumber(row.absorptionRate),
      absorptionPerMonth: finiteNumber(row.absorptionPerMonth),
      monthsOfSupply: finiteNumber(row.monthsOfSupply),
      population: finiteNumber(row.population),
      populationDensity: finiteNumber(row.populationDensity),
      populationGrowth: finiteNumber(row.populationGrowth),
      priceTrend: { direction, percent: finiteNumber(trend.percent) },
      likelyResaleTime: typeof row.likelyResaleTime === 'string' && row.likelyResaleTime.trim()
        ? row.likelyResaleTime : base.likelyResaleTime,
      movementRank: finiteNumber(row.movementRank),
      snapshotPeriod: typeof row.snapshotPeriod === 'string' ? row.snapshotPeriod : null,
      confidence,
      coverage: typeof row.coverage === 'string' ? row.coverage : base.coverage,
      source: typeof row.source === 'string' ? row.source : base.source,
      evidenceStrength: confidence === 'high' || confidence === 'medium'
        ? 'usable'
        : soldCount || activeCount ? 'thin' : 'none',
    };
  });
}

function comparableQuality(
  pkg: DealIntelligenceInputPackage,
  lane: 'sold' | 'active',
): OperatorComparableQuality[] {
  const subjectAcres = pkg.identity.acres;
  return pkg.comps[lane].map((comp) => {
    const ratio = subjectAcres && comp.acres ? Math.max(subjectAcres, comp.acres) / Math.min(subjectAcres, comp.acres) : null;
    const dated = !!comp.dateIso && Number.isFinite(Date.parse(comp.dateIso));
    const recent = dated && Date.now() - Date.parse(comp.dateIso!) <= 36 * 30.4 * 86_400_000;
    const local = comp.distanceMiles != null && comp.distanceMiles <= 15;
    const complete = comp.price != null && comp.acres != null && comp.pricePerAcre != null && !!comp.sourceUrl;
    const similarity: OperatorComparableQuality['similarity'] =
      ratio != null && ratio <= 1.5 && (lane === 'active' || recent) && local && complete
        ? 'Strong'
        : ratio != null && ratio <= 2.5 && (lane === 'active' || dated)
          ? 'Moderate'
          : 'Context only';
    const relativeWeight = similarity === 'Strong' ? 1 : similarity === 'Moderate' ? 0.6 : 0.25;
    return {
      key: comp.key,
      lane,
      similarity,
      relativeWeight,
      explanation: `${comp.whyUseful} ${dated ? `Dated ${comp.dateIso}.` : 'No published date; use as weaker context.'}`,
      materialDifferences: unique([
        ...comp.differences,
        ratio != null && ratio > 1.5 ? `${ratio.toFixed(1)}x acreage-size difference from the subject.` : null,
        lane === 'sold' && !dated ? 'Undated sale; materially reduced weight.' : null,
        comp.distanceMiles == null ? 'Distance from the subject is unavailable.' : null,
      ]),
    };
  });
}

function evidenceText(item: SnapshotDueDiligenceItem): string {
  return `${item.label}: ${item.headline}`;
}

function unsupportedPhysicalConclusion(item: SnapshotDueDiligenceItem): boolean {
  const text = `${item.key} ${item.label} ${item.headline} ${item.detail ?? ''} ${item.missing.join(' ')}`;
  const physicalTopic = /\bterrain|slope|buildab|usable acreage|septic|perc|soil\b/i.test(text);
  const unsupported = item.grade === 'unresolved_question'
    || item.grade === 'unavailable_public_record'
    || /\bunsupported|unverified|questionable|not established|insufficient evidence|single (?:point|map unit)|point sample|preliminary only|cannot be relied|missing\b/i.test(text);
  return physicalTopic && unsupported;
}

/** Percent shares parsed out of a screening headline, when present. */
function screeningNumbers(headline: string): {
  frontageFt: number | null; landlocked: 'yes' | 'no' | null;
  slopePct: number | null; buildabilityPct: number | null; coveragePct: number | null;
} {
  const grab = (re: RegExp): number | null => {
    const m = headline.match(re);
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const landlockedMatch = headline.match(/landlocked flag:\s*(yes|no)/i);
  return {
    frontageFt: grab(/(\d+(?:\.\d+)?)\s*ft frontage/i),
    landlocked: landlockedMatch ? landlockedMatch[1].toLowerCase() as 'yes' | 'no' : null,
    slopePct: grab(/(\d+(?:\.\d+)?)%\s*average slope/i),
    buildabilityPct: grab(/(\d+(?:\.\d+)?)%\s*buildability/i),
    coveragePct: grab(/reports\s+(\d+(?:\.\d+)?)\s*%?/i),
  };
}

/** A stored screening headline may carry a bare percentage ("reports 2.39.").
 *  Display it as the percentage it is without touching the stored record. */
function normalizedScreeningText(item: SnapshotDueDiligenceItem): string {
  const headline = (item.key === 'flood' || item.key === 'wetlands')
    ? item.headline.replace(/reports\s+(\d+(?:\.\d+)?)(?!\s*%)/i, 'reports $1%')
    : item.headline;
  return `${item.label}: ${headline}`;
}

function propertyScore(pkg: DealIntelligenceInputPackage, visual: OperatorVisualContext | null): OperatorScore {
  let score = 58;
  const positives: string[] = [];
  const deductions: string[] = [];
  const change: string[] = [];
  const evidenceKeys: string[] = [];
  const ledger: string[] = [];
  const apply = (delta: number, note: string): void => {
    score += delta;
    if (delta !== 0) ledger.push(`${delta > 0 ? '+' : ''}${delta} ${note}`);
  };
  const acres = pkg.identity.acres;
  const shareAcres = (pct: number): string =>
    acres != null ? ` (≈${(acres * pct / 100).toFixed(2)} of ${acres} ac)` : '';

  if ((acres ?? 0) > 0) {
    apply(4, 'established acreage');
    positives.push(`${acres!.toFixed(2)} acres are established for analysis.`);
    evidenceKeys.push('identity:acres');
  } else {
    apply(-8, 'acreage not established');
    deductions.push('Acreage is not established.');
    change.push('A reliable acreage basis.');
  }

  // Parcel geometry: retained accepted parcel imagery (boundary aerials,
  // overlays, 3D captures) is usable boundary evidence even when no vector
  // coordinates landed. Only a total absence of both is a defect.
  const parcelImagery = pkg.evidence.filter((item) =>
    !!item.viewUrl && /parcel|aerial|frontage|boundar|contour|overlay|3d/i.test(`${item.id} ${item.label} ${item.supports}`));
  if (pkg.identity.hasParcelGeometry) {
    apply(4, 'parcel geometry retained');
    positives.push('Parcel geometry is retained for shape, frontage, and site-context review.');
    evidenceKeys.push('identity:geometry');
  } else if (parcelImagery.length > 0) {
    apply(3, 'parcel boundary imagery retained');
    positives.push(`Parcel boundary and site imagery are retained (${parcelImagery.length} accepted captures).`);
    evidenceKeys.push('evidence:parcel-imagery');
    change.push('A recorded survey or vector parcel geometry to upgrade the imagery-based boundary evidence.');
  } else {
    apply(-4, 'no parcel geometry');
    deductions.push('No usable parcel geometry is retained.');
    change.push('A parcel-boundary map or survey.');
  }

  const weights: Record<SnapshotDueDiligenceItem['verdict'], number> = {
    good: 5, caution: -3, risk: -9, unknown: -2,
  };
  for (const item of pkg.dueDiligence) {
    evidenceKeys.push(`dd:${item.key}`);
    if (unsupportedPhysicalConclusion(item)) {
      change.push(`${item.label}: replace the unsupported physical conclusion with parcel-coverage evidence or field verification.`);
      continue;
    }
    // Metric-aware screening: quantitative evidence in a stored headline
    // (frontage, buildability, coverage shares) governs its own sign. A small
    // mapped share of a constraint is not a whole-parcel impairment, and
    // strong frontage or buildability is not a caution.
    const nums = screeningNumbers(item.headline);
    if (item.key === 'access' && nums.landlocked != null) {
      if (nums.landlocked === 'no' && (nums.frontageFt ?? 0) >= 30) {
        apply(5, 'mapped road frontage without a landlocked flag');
        positives.push(`${Math.round(nums.frontageFt!)} ft of mapped road frontage and no landlocked flag.`);
      } else if (nums.landlocked === 'yes') {
        apply(-9, 'landlocked flag');
        deductions.push(normalizedScreeningText(item));
      } else {
        apply(weights[item.verdict], `${item.label.toLowerCase()} (${item.verdict})`);
        if (item.verdict === 'caution' || item.verdict === 'risk') deductions.push(normalizedScreeningText(item));
      }
      change.push(...item.missing.map((gap) => `${item.label}: ${gap}`));
      continue;
    }
    if (item.key === 'terrain' && nums.buildabilityPct != null) {
      const buildable = nums.buildabilityPct;
      if (buildable >= 60) {
        apply(4, 'majority buildability shown');
        positives.push(`${buildable}% of the parcel is shown buildable${shareAcres(buildable)}${nums.slopePct != null ? ` at ${nums.slopePct}% average slope` : ''} — model indication, not field-verified.`);
      } else if (buildable >= 30) {
        apply(1, 'partial buildability shown');
        positives.push(`${buildable}% of the parcel is shown buildable${shareAcres(buildable)} — model indication, not field-verified.`);
      } else {
        apply(-6, 'low buildability shown');
        deductions.push(normalizedScreeningText(item));
      }
      if (nums.slopePct != null && nums.slopePct > 25) {
        apply(-3, 'steep average slope');
        deductions.push(`Steep average slope (${nums.slopePct}%).`);
      }
      change.push('Terrain and buildability: field verification of the terrain model.');
      change.push(...item.missing.map((gap) => `${item.label}: ${gap}`));
      continue;
    }
    if ((item.key === 'wetlands' || item.key === 'flood') && nums.coveragePct != null) {
      const kind = item.key === 'wetlands' ? 'wetlands' : 'FEMA flood';
      const pct = nums.coveragePct;
      if (pct <= 10) {
        apply(2, `limited mapped ${kind} share`);
        positives.push(`Mapped ${kind} coverage is limited to ${pct}% of the parcel${shareAcres(pct)}.`);
      } else if (pct <= 30) {
        apply(-3, `meaningful mapped ${kind} share`);
        deductions.push(`${normalizedScreeningText(item)} (${pct}% of the parcel${shareAcres(pct)}).`);
      } else {
        apply(-9, `large mapped ${kind} share`);
        deductions.push(`${normalizedScreeningText(item)} (${pct}% of the parcel${shareAcres(pct)}).`);
      }
      change.push(`${item.label}: official determination (screening is a parcel-share indication, not a jurisdictional finding).`);
      change.push(...item.missing.map((gap) => `${item.label}: ${gap}`));
      continue;
    }
    apply(weights[item.verdict], `${item.label.toLowerCase()} (${item.verdict})`);
    if (item.verdict === 'good') positives.push(normalizedScreeningText(item));
    if (item.verdict === 'caution' || item.verdict === 'risk') deductions.push(normalizedScreeningText(item));
    if (item.verdict === 'unknown') change.push(`${item.label} evidence.`);
    change.push(...item.missing.map((gap) => `${item.label}: ${gap}`));
  }

  for (const observation of visual?.observations ?? []) {
    evidenceKeys.push(`visual:${observation.sourceImage}:${observation.category}`);
    if (/\bterrain|slope|buildab|septic|soil\b/i.test(`${observation.category} ${observation.observation}`)
      && /\bunsupported|unverified|questionable|uncertain|cannot determine|not visible\b/i.test(observation.observation)) {
      change.push(`Imagery: verify ${observation.category.replace(/_/g, ' ')} before using it in the score.`);
      continue;
    }
    if (observation.signal === 'positive') {
      apply(observation.confidence === 'high' ? 3 : 2, 'positive imagery observation');
      positives.push(`Imagery: ${observation.observation}`);
    } else if (observation.signal === 'concern') {
      apply(observation.confidence === 'high' ? -6 : -3, 'imagery concern');
      deductions.push(`Imagery: ${observation.observation}`);
    }
  }
  if (!visual?.ok) change.push('A successful multimodal review of the retained parcel imagery.');

  const final = clamp(score);
  return {
    score: final,
    rating: rating(final),
    explanation: `Recalculated from the accepted evidence: base 58${ledger.length ? `, ${ledger.join(', ')}` : ''} = ${final}. `
      + 'Screening shares are parcel-percentage indications from retained evidence; unresolved diligence is listed under what would change this score, not double-counted as a site defect.',
    strongestPositiveFactors: unique(positives).slice(0, 6),
    mainDeductions: unique(deductions).slice(0, 5),
    materiallyChangeWith: unique(change).slice(0, 8),
    evidenceKeys: unique(evidenceKeys),
  };
}

function scanObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function marketAnalysis(pkg: DealIntelligenceInputPackage, context: DealOperatorContext): OperatorMarketAnalysis {
  const matrix = scanObject(pkg.marketIntelligence?.marketMatrix);
  const pulse = scanObject(pkg.marketIntelligence?.marketPulse);
  const scan = scanObject(context.marketScan ?? pkg.marketIntelligence?.marketScan);
  const growth = scanObject(scan.growthSignals);
  const dc = scanObject(scan.dataCenterWatch);
  const landWeb = scanObject(scan.landMarketWeb);
  const practicalMatrix = scanObject(scan.acreageMatrix);
  const practicalBands = Array.isArray(practicalMatrix.bands)
    ? practicalMatrix.bands.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    : [];
  const internalMetrics = pkg.facts
    .filter((fact) => /market|median|supply|inventory|absorption|sell.?through|days|price|sold|acreage.?band/i.test(`${fact.key} ${fact.label}`))
    .map((fact) => ({ label: fact.label, value: fact.value ?? 'No value returned', source: fact.source ?? 'LandOS market research' }))
    .slice(0, 12);
  if (!internalMetrics.length) {
    const summary = firstText([
      typeof matrix.summaryLine === 'string' ? matrix.summaryLine : null,
      typeof matrix.headline === 'string' ? matrix.headline : null,
      typeof pulse.plainEnglish === 'string' ? pulse.plainEnglish : null,
    ]);
    if (summary) internalMetrics.push({ label: 'Combined market read', value: summary, source: 'LandOS Market Pulse and Matrix' });
  }
  for (const band of practicalBands) {
    if (Number(band.soldVolume ?? 0) === 0
      && Number(band.activeInventory ?? 0) === 0
      && typeof band.snapshotPeriod !== 'string') continue;
    const label = String(band.band ?? 'Unknown');
    internalMetrics.push({
      label: `${label} acre band`,
      value: `${Number(band.soldVolume ?? 0)} sold · ${Number(band.activeInventory ?? 0)} active`
        + `${typeof band.medianDaysOnMarket === 'number' ? ` · ${Math.round(band.medianDaysOnMarket)} median DOM` : ''}`
        + `${typeof band.sellThroughRate === 'number' ? ` · ${band.sellThroughRate}% sell-through` : ''}`
        + `${typeof band.absorptionPerMonth === 'number' ? ` · ${band.absorptionPerMonth}/month absorption` : ''}`
        + `${typeof band.monthsOfSupply === 'number' ? ` · ${band.monthsOfSupply} months supply` : ''}`,
      source: 'Selected sold and active market observations',
    });
  }

  for (const band of projectedAcreageBands(pkg, practicalBands)) {
    if (band.soldCount === 0 && band.activeCount === 0 && band.snapshotPeriod == null) continue;
    internalMetrics.push({
      label: `${band.label} county Market Research`,
      value: [
        `${band.soldCount} sold`,
        `${band.activeCount} active`,
        band.medianSalePrice != null ? `${compactMoney(band.medianSalePrice)} median price` : null,
        band.medianSoldPricePerAcre != null ? `${compactMoney(band.medianSoldPricePerAcre)}/acre` : null,
        band.medianDaysOnMarket != null ? `${Math.round(band.medianDaysOnMarket)} median DOM` : null,
        band.sellThroughRate != null ? `${band.sellThroughRate.toFixed(1)}% sell-through` : null,
        band.absorptionRate != null ? `${band.absorptionRate.toFixed(1)}% absorption` : null,
        band.monthsOfSupply != null ? `${band.monthsOfSupply.toFixed(1)} months supply` : null,
        band.population != null ? `population ${Math.round(band.population).toLocaleString()}` : null,
        band.populationDensity != null ? `density ${band.populationDensity.toLocaleString()}/sq mi` : null,
        band.populationGrowth != null ? `growth ${band.populationGrowth.toFixed(1)}%` : null,
        band.snapshotPeriod,
        `${band.confidence} confidence`,
        band.coverage,
      ].filter((value): value is string => value != null).join(' | '),
      source: band.source,
    });
  }

  const growthItems = Array.isArray(growth.items) ? growth.items as Array<Record<string, unknown>> : [];
  const developments = growthItems.map((item) => ({
    name: String(item.title ?? 'Market signal'),
    location: typeof item.location === 'string' ? item.location : null,
    distanceMiles: typeof item.distanceMiles === 'number' ? item.distanceMiles : null,
    status: String(item.status ?? item.category ?? 'reported'),
    timeline: typeof item.timeline === 'string' ? item.timeline : item.year == null ? null : String(item.year),
    scale: typeof item.scale === 'string' ? item.scale : null,
    likelyEffect: String(item.whyItMatters ?? item.summary ?? 'May affect land demand; review the retained source.'),
    downside: typeof item.downside === 'string'
      ? item.downside
      : /closure|opposition|decline|risk/i.test(`${item.category ?? ''} ${item.summary ?? ''}`)
        ? String(item.summary ?? 'Potential downside signal.')
        : null,
    sourceUrl: typeof item.url === 'string' ? item.url : null,
  }));

  const dcItems = (Array.isArray(dc.items) ? dc.items as Array<Record<string, unknown>> : []).map((item) => ({
    name: String(item.title ?? 'Data-center activity'),
    operatorOrDeveloper: typeof item.operatorOrDeveloper === 'string' ? item.operatorOrDeveloper : null,
    location: typeof item.location === 'string' ? item.location : null,
    distanceMiles: typeof item.distanceMiles === 'number' ? item.distanceMiles : null,
    status: String(item.status ?? 'mention'),
    timeline: item.year == null ? null : String(item.year),
    scale: typeof item.scale === 'string' ? item.scale : null,
    likelyEffect: String(item.whyItMatters ?? 'Potential institutional land-demand and infrastructure signal.'),
    downside: String(item.status ?? '').includes('opposition') ? String(item.summary ?? 'Community or approval risk.') : null,
    sourceUrl: typeof item.url === 'string' ? item.url : null,
  }));
  const dcStatus = ['found', 'none_found', 'not_run', 'unavailable'].includes(String(dc.status))
    ? String(dc.status) as OperatorMarketAnalysis['dataCenters']['status']
    : 'not_run';
  const dcMapEvidence = scanObject(dc.browserMapEvidence);
  const sold = pkg.comps.sold.length;
  const active = pkg.comps.active.length;
  const bandRows = projectedAcreageBands(pkg, practicalBands);
  const bulkBandLabel = acreageBandLabel(pkg.identity.acres);
  const bulkBand = bandRows.find((band) => band.label === bulkBandLabel) ?? null;
  const smallerLotBands = bandRows.filter((band) =>
    ['20–50 acres', '10–20 acres', '5–10 acres', '2–5 acres', '1–2 acres', '0–1 acres'].includes(band.label)
    && band.label !== bulkBandLabel);
  const movingBands = smallerLotBands
    .filter((band) => band.soldCount > 0 || band.activeCount > 0)
    .sort((a, b) =>
      (a.movementRank ?? Number.POSITIVE_INFINITY) - (b.movementRank ?? Number.POSITIVE_INFINITY)
      || b.soldCount - a.soldCount
      || (a.medianDaysOnMarket ?? Number.POSITIVE_INFINITY) - (b.medianDaysOnMarket ?? Number.POSITIVE_INFINITY));
  const pricedSmaller = movingBands.filter((band) => band.medianSoldPricePerAcre != null);
  const premium = bulkBand?.medianSoldPricePerAcre && pricedSmaller.length
    ? Math.max(...pricedSmaller.map((band) => band.medianSoldPricePerAcre!)) / bulkBand.medianSoldPricePerAcre
    : null;
  const pulseText = `${String(pulse.plainEnglish ?? '')} ${String(matrix.summaryLine ?? '')} ${String(growth.summary ?? '')}`.toLowerCase();
  const strongSignal = /strong|growing|growth|tight supply|high demand/.test(pulseText) || growthItems.length >= 4;
  const weakSignal = /weak|declin|slow|oversupply|low demand/.test(pulseText);
  const internalCountySold = bandRows
    .filter((band) => band.snapshotPeriod != null)
    .reduce((sum, band) => sum + band.soldCount, 0);
  const internalCountyActive = bandRows
    .filter((band) => band.snapshotPeriod != null)
    .reduce((sum, band) => sum + band.activeCount, 0);
  const strength: OperatorMarketAnalysis['strength'] =
    strongSignal && (sold >= 3 || internalCountySold >= 6) ? 'Strong'
      : weakSignal ? 'Weak'
        : sold >= 2 || active >= 2 || internalCountySold > 0 || internalCountyActive > 0 || internalMetrics.length
          ? 'Moderate' : 'Uncertain';
  const buyerDemand = strength === 'Strong'
    ? 'Buyer demand appears healthy for relevant land when priced near the supported acreage band.'
    : strength === 'Moderate'
      ? 'There is a workable buyer pool, but pricing and marketing quality will matter.'
      : strength === 'Weak'
        ? 'Buyer demand appears thin; underwrite a slower exit and a sharper price.'
        : 'The current evidence does not yet establish buyer depth.';
  const likelyMarketingTime = strength === 'Strong' ? 'About 3–6 months with competitive pricing'
    : strength === 'Moderate' ? 'About 6–12 months'
      : strength === 'Weak' ? 'Likely 12+ months' : 'Not estimated from current evidence';
  const expectedBulkMarketingTime = bulkBand?.likelyResaleTime ?? likelyMarketingTime;
  const expectedSmallerLotMarketingTime = movingBands[0]?.likelyResaleTime
    ?? 'Not estimated until a smaller-acreage county band has DOM or absorption support.';

  return {
    strength,
    buyerDemand,
    resaleDifficulty: strength === 'Strong' ? 'Manageable' : strength === 'Moderate' ? 'Moderate' : strength === 'Weak' ? 'High' : 'Uncertain',
    likelyMarketingTime,
    expectedBulkMarketingTime,
    expectedSmallerLotMarketingTime,
    internalMetrics,
    acreageAndPriceBands: unique([
      pkg.valuation.pricePerAcreRange
        ? `${compactMoney(pkg.valuation.pricePerAcreRange.low)}–${compactMoney(pkg.valuation.pricePerAcreRange.high)} per acre supports the subject's working band.`
        : null,
      pkg.comps.sold.length ? `${pkg.comps.sold.length} selected closed sale(s) in the relevant acreage band.` : null,
      pkg.comps.active.length ? `${pkg.comps.active.length} selected active competitor(s) show current asking competition.` : null,
      ...bandRows.filter((band) => band.soldCount || band.activeCount).map((band) =>
        `${band.label}: ${band.soldCount} sold, ${band.activeCount} active`
        + `${band.medianSoldPricePerAcre != null ? `, median sold ${compactMoney(band.medianSoldPricePerAcre)}/acre` : ''}.`),
      ...practicalBands.map((band) =>
        `${String(band.band ?? 'Unknown')} acres: ${Number(band.soldVolume ?? 0)} sold, ${Number(band.activeInventory ?? 0)} active`
        + `${typeof band.medianPricePerAcre === 'number' ? `, median ${compactMoney(band.medianPricePerAcre)}/acre` : ''}`
        + `${typeof band.medianDaysOnMarket === 'number' ? `, ${Math.round(band.medianDaysOnMarket)} median DOM` : ''}`
        + `${typeof band.movementRank === 'number' ? `, movement rank #${band.movementRank}` : ''}`
        + `; ${String(band.likelyResaleTime ?? 'resale timing not established')}.`),
    ]),
    acreageBands: bandRows,
    bestMovingAcreageBands: practicalBands
      .filter((band) => typeof band.movementRank === 'number')
      .sort((a, b) => Number(a.movementRank) - Number(b.movementRank))
      .slice(0, 3)
      .map((band) => `${String(band.band)} acres (#${Number(band.movementRank)} movement; ${Number(band.soldVolume ?? 0)} sold, ${Number(band.activeInventory ?? 0)} active)`)
      .concat(movingBands.slice(0, 3).map((band) =>
        `${band.label} (${band.soldCount} sold, ${band.activeCount} active${band.medianDaysOnMarket != null ? `, median ${Math.round(band.medianDaysOnMarket)} DOM` : ''})`))
      .slice(0, 3),
    bulkVersusSplit: {
      bulkBand,
      smallerLotBands,
      conclusion: premium != null
        ? `The strongest evidenced smaller-lot band is ${premium.toFixed(2)}x the bulk-band sold price per acre. Apply that premium only to practical lots in the matching band and deduct the complete project cost basis.`
        : typeof practicalMatrix.bulkTractRead === 'string' || typeof practicalMatrix.splitSizeRead === 'string'
          ? `${String(practicalMatrix.bulkTractRead ?? '')} ${String(practicalMatrix.splitSizeRead ?? '')}`.trim()
          : 'The retained set does not yet contain enough sold evidence in both the bulk and likely split acreage bands to quantify acreage-band arbitrage. This is a pricing gap, not evidence against subdivision.',
    },
    developmentAndInfrastructure: developments,
    landMarketWeb: {
      status: ['found', 'none_found', 'not_run', 'unavailable'].includes(String(landWeb.status))
        ? landWeb.status as 'found' | 'none_found' | 'not_run' | 'unavailable'
        : 'not_run',
      acreageFocus: typeof landWeb.acreageFocus === 'string' ? landWeb.acreageFocus : null,
      summary: typeof landWeb.summary === 'string' ? landWeb.summary : 'No land-market web read was retained for this run.',
      items: (Array.isArray(landWeb.items) ? landWeb.items as Array<Record<string, unknown>> : []).map((item) => ({
        title: String(item.title ?? 'Land market source'),
        summary: String(item.summary ?? ''),
        url: typeof item.url === 'string' ? item.url : null,
        year: typeof item.year === 'number' ? item.year : null,
      })),
    },
    dataCenters: {
      searchedWithinMiles: 20,
      status: dcStatus,
      summary: typeof dc.summary === 'string'
        ? dc.summary
        : dcStatus === 'not_run'
          ? 'The required 20-mile data-center search did not return a retained answer in this run.'
          : 'No data-center summary was retained.',
      verdict: typeof dc.verdict === 'string' && dc.verdict.trim()
        ? dc.verdict.trim()
        : dcStatus === 'not_run'
          ? 'The 20-mile data-center screen did not run for this subject, so nothing is claimed either way.'
          : 'No explicit data-center verdict was retained for this run.',
      routesAttempted: Array.isArray(dc.routesAttempted)
        ? (dc.routesAttempted as unknown[]).map((route) => String(route))
        : [],
      sourceUrl: typeof dcMapEvidence.sourceUrl === 'string' ? dcMapEvidence.sourceUrl : null,
      screenshotUrl: typeof dcMapEvidence.screenshotPath === 'string' && dcMapEvidence.screenshotPath
        ? `/api/landos/deal-cards/${pkg.dealCardId}/data-center-map`
        : null,
      attemptedAt: typeof dcMapEvidence.attemptedAt === 'string' ? dcMapEvidence.attemptedAt : null,
      items: dcItems,
    },
    conclusion: `${strength} market. ${buyerDemand} Likely marketing time: ${likelyMarketingTime}.`,
    strategyImplications: unique([
      strength === 'Strong' ? 'Quick Flip and Novation or Double Close receive better support from resale demand.' : null,
      strength === 'Weak' ? 'Favor a lower acquisition basis and avoid capital-heavy work without a committed exit.' : null,
      active >= 4 ? 'Four active competitors provide a useful current-positioning set.' : 'Continue active-listing research until four useful competitors are available when the market supports them.',
      movingBands.length ? `The best evidenced smaller-acreage demand is currently ${movingBands.slice(0, 2).map((band) => band.label).join(' and ')}.` : 'Run the 20–50, 10–20, 5–10, and 2–5 acre Market Research bands before pricing a split exit.',
      dcStatus === 'found' ? 'Data-center activity is a supporting catalyst, not a parcel-specific value adjustment.' : null,
    ]),
    limitations: unique([
      internalMetrics.length ? null : 'No internal Market Pulse or Matrix metrics were retained.',
      dcStatus === 'not_run' ? 'The 20-mile data-center search needs a successful run.' : null,
      pkg.comps.sold.length < 3 ? 'The closed-sale set is thin.' : null,
    ]),
  };
}

/**
 * Canonical comp counts for the market read. The snapshot comp lane applies a
 * provider allowlist, source caps, and a never-downgrade guard, so its counts
 * can lag the canonical Comps & Valuation registry. When the caller supplies
 * the canonical counts, they govern — the Market score must never claim a
 * different number of selected closed sales than Comps & Valuation displays.
 */
export interface CanonicalCompCounts {
  sold: number;
  active: number;
  /** True when no selected sale carries an independently verified closed price. */
  soldAllSourceStated?: boolean;
}

function marketScore(
  pkg: DealIntelligenceInputPackage,
  market: OperatorMarketAnalysis,
  canonicalCounts?: CanonicalCompCounts | null,
): OperatorScore {
  let score = 42;
  const positives: string[] = [];
  const deductions: string[] = [];
  const changes: string[] = [];
  const keys: string[] = [];
  const sold = canonicalCounts ? canonicalCounts.sold : pkg.comps.sold.length;
  const active = canonicalCounts ? canonicalCounts.active : pkg.comps.active.length;
  const countyBands = market.acreageBands.filter((band) => band.snapshotPeriod != null);
  const countySold = countyBands.reduce((sum, band) => sum + band.soldCount, 0);
  const countyActive = countyBands.reduce((sum, band) => sum + band.activeCount, 0);

  score += Math.min(25, sold * 5);
  score += Math.min(12, active * 3);
  score += Math.min(12, countyBands.length * 2 + Math.min(4, countySold / 10));
  // The noun must match what Comps & Valuation calls the same records, or the
  // two surfaces contradict each other about the same evidence.
  const soldNoun = canonicalCounts?.soldAllSourceStated ? 'source-stated sale(s)' : 'closed sale(s)';
  if (sold || countySold) {
    positives.push(`${sold} selected ${soldNoun} and ${countySold} internal county-band sale(s) support the market read.`);
  }
  else {
    deductions.push('No selected closed sale supports local resale behavior.');
    changes.push('Recent closed sales in the subject acreage band.');
  }
  if (active >= 4 || countyActive >= 4) {
    positives.push(`${active} selected active competitor(s) and ${countyActive} internal county-band active listing(s) show today’s asking environment.`);
  }
  else {
    deductions.push(`Only ${active} useful active competitor(s) are retained.`);
    changes.push('Four useful current active listings, including listing age and engagement where available.');
  }
  if (market.strength === 'Strong') { score += 10; positives.push(market.conclusion); }
  if (market.strength === 'Weak') { score -= 12; deductions.push(market.conclusion); }
  if (market.strength === 'Uncertain') { score -= 8; deductions.push('Market direction is not yet well supported.'); }
  if (market.dataCenters.status === 'found') {
    score += 4;
    positives.push(market.dataCenters.summary);
    keys.push('market:data_center_watch');
  } else if (market.dataCenters.status === 'not_run' || market.dataCenters.status === 'unavailable') {
    changes.push('A completed data-center and infrastructure search within 20 miles.');
  }
  if (canonicalCounts) {
    changes.push('Counts shown here are the canonical Comps & Valuation registry counts, so the two sections always agree.');
  }
  keys.push(...pkg.comps.sold.map((comp) => `comp:${comp.key}`), ...pkg.comps.active.map((comp) => `comp:${comp.key}`));
  keys.push(...market.internalMetrics.map((metric) => `market:${metric.label}`));
  const final = clamp(score);
  return {
    score: final,
    rating: rating(final),
    explanation: `${rating(final)} resale environment based on the selected acreage-band comps, active competition, retained internal market research, and live growth signals.`,
    strongestPositiveFactors: unique(positives).slice(0, 5),
    mainDeductions: unique(deductions).slice(0, 5),
    materiallyChangeWith: unique(changes).slice(0, 7),
    evidenceKeys: unique(keys),
  };
}

function hasSubstantiveSellerEvidence(seller: OperatorSellerContext): boolean {
  const notesContainSellerFact = seller.notes.some((note) =>
    /\b(ask(?:ing)? price|price expectation|motivat(?:ed|ion)?|wants? to sell|needs? to sell|inherited|timeline|urgent|asap|flexible|negotiable|open to|counter|owner financ|decision|authority|trustee|respond(?:ed|s|ing)?|cooperat(?:e|ive|ion)|called|texted|emailed|spoke|lives? out of state)\b|\$\s*\d/i.test(note),
  );
  return seller.askingPrice != null
    || !!seller.timeline?.trim()
    || !!seller.responsiveness?.trim()
    || !!seller.flexibility?.trim()
    || !!seller.decisionAuthority?.trim()
    || !!seller.ownershipContext?.trim()
    || notesContainSellerFact
    || seller.communications.some((item) => item.summary.trim().length > 0);
}

function sellerScore(pkg: DealIntelligenceInputPackage, seller: OperatorSellerContext): OperatorScore {
  if (!hasSubstantiveSellerEvidence(seller)) {
    return {
      score: null,
      rating: 'Pending',
      explanation: 'Not enough information. Seller Score remains Pending until asking price, motivation, responsiveness, timeline, authority, flexibility, ownership context, or cooperation evidence is recorded.',
      strongestPositiveFactors: [],
      mainDeductions: [],
      materiallyChangeWith: [
        'Seller asking price or price expectation.',
        'Reason for selling and desired timeline.',
        'Responsiveness, flexibility, and cooperation.',
        'Decision authority and ownership context.',
      ],
      evidenceKeys: [],
    };
  }
  let score = 35;
  const positives: string[] = [];
  const deductions: string[] = [];
  const changes: string[] = [];
  const keys: string[] = [];
  const notes = seller.notes.join(' ');
  const working = pkg.valuation.workingValue ?? null;

  if (seller.name) { positives.push(`Seller/contact identified: ${seller.name}.`); keys.push('seller:name'); }
  else changes.push('Seller identity and relationship to the owner of record.');
  if (seller.phone || seller.email) { score += 4; positives.push('A direct contact channel is available.'); keys.push('seller:contact'); }
  else changes.push('A working phone number or email.');
  if (seller.askingPrice != null && working != null) {
    keys.push('seller:asking_price', 'valuation:working_value');
    const ratio = seller.askingPrice / working;
    if (ratio <= 0.6) { score += 24; positives.push(`Asking price is ${Math.round(ratio * 100)}% of working value, leaving room for a profitable agreement.`); }
    else if (ratio <= 0.85) { score += 10; positives.push('Asking price is below working value, although the spread needs careful underwriting.'); }
    else if (ratio <= 1.05) { score -= 5; deductions.push('Asking price is near working value, so negotiation room is limited.'); }
    else { score -= 18; deductions.push('Asking price is above the current working value.'); }
  } else {
    deductions.push(seller.askingPrice == null ? 'No asking price is recorded.' : 'No working value exists for an asking-price comparison.');
    changes.push('Seller asking price and a supported working value.');
  }
  if (/\b(motivat|need to sell|cash|inherited|tax|moving|timeline|urgent|asap)\b/i.test(notes)) {
    score += 10;
    positives.push('Recorded notes contain a concrete motivation or timing signal.');
    keys.push('seller:notes');
  } else changes.push('A concrete reason for selling and desired timeline.');
  if (/\b(flexible|negotiable|open to|counter|terms|owner financ)\b/i.test(notes + ` ${seller.flexibility ?? ''}`)) {
    score += 7;
    positives.push('Seller flexibility or openness to terms is recorded.');
  } else changes.push('Price and terms flexibility.');
  if (seller.decisionAuthority) { score += 5; positives.push(`Decision authority context: ${seller.decisionAuthority}.`); }
  else changes.push('Who can make and sign the decision.');
  if (seller.communications.length) { score += Math.min(6, seller.communications.length * 2); positives.push(`${seller.communications.length} seller communication event(s) are retained.`); }
  else deductions.push('No seller communication history is retained yet.');

  const final = clamp(score);
  return {
    score: final,
    rating: rating(final),
    explanation: `${rating(final)} acquisition opportunity based only on asking-price position, motivation, contactability, timing, flexibility, cooperation, and decision-authority evidence.`,
    strongestPositiveFactors: unique(positives).slice(0, 5),
    mainDeductions: unique(deductions).slice(0, 5),
    materiallyChangeWith: unique(changes).slice(0, 7),
    evidenceKeys: unique(keys),
  };
}

function valueAnalysis(
  valuation: SnapshotValuation,
  seller: OperatorSellerContext,
  scope: ValuationScopeState,
): DealOperatorAnalysis['values'] {
  const scopeFields = {
    valuationScope: scope,
    figureKind: scope.figureKind,
    figureLabel: scope.figureLabel,
    wholePropertyValue: scope.wholeProperty,
  };
  if (!valuation.priceable || !valuation.range || !valuation.likelyRetail || !valuation.dispositionRange) {
    return {
      expectedMarketValue: null,
      retailAskingRange: null,
      quickSaleDispositionRange: null,
      workingUnderwritingValue: null,
      openingPosition: null,
      targetAcquisitionRange: null,
      practicalMaximumAcquisitionPrice: null,
      walkAwayLevel: null,
      offerBasis: 'whole_tract_resale_only',
      subdivisionUpsideIncluded: false,
      explanation: valuation.notPriceableReason ?? valuation.basis,
      scenarios: [],
      ...scopeFields,
    };
  }
  const working = valuation.workingValue ?? Math.round((valuation.range.low + valuation.range.high) / 2);
  // Acquisition guidance is an underwriting assumption, never a comp fact.
  const openingPct = seller.askingPrice != null && seller.askingPrice <= working * 0.5 ? 0.35 : 0.38;
  const lowPct = 0.42;
  const highPct = 0.52;
  const maximumPct = 0.58;
  const opening = Math.round(working * openingPct / 500) * 500;
  const targetLow = Math.round(working * lowPct / 500) * 500;
  const targetHigh = Math.round(working * highPct / 500) * 500;
  const maximum = Math.round(working * maximumPct / 500) * 500;
  const scenario = (name: OperatorAcquisitionScenario['name'], resale: number, acquisition: number, costPct: number, extra: number): OperatorAcquisitionScenario => {
    const costs = Math.round((resale * costPct + extra) / 500) * 500;
    return {
      name,
      resalePrice: resale,
      acquisitionPrice: acquisition,
      estimatedCosts: costs,
      estimatedProfit: resale - acquisition - costs,
      assumption: `${Math.round(costPct * 100)}% resale/holding/closing allowance plus ${compactMoney(extra)} strategy work; planning math, not a quote.`,
    };
  };
  // Every band label carries the scope, so no figure can be read as a completed
  // whole-property value on a subject whose improvements are not yet valued.
  const bandLabel = (name: string): string => (scope.scope === 'land_only' ? `Land-basis ${name.toLowerCase()}` : name);
  return {
    expectedMarketValue: { ...valuation.range, label: bandLabel('Expected market value'), basis: `${valuation.basis} ${scope.figureLabel}.` },
    retailAskingRange: { ...valuation.likelyRetail, label: bandLabel('Retail asking range'), basis: `Marketed retail positioning from the supported value band and active competition. ${scope.figureLabel}.` },
    quickSaleDispositionRange: { ...valuation.dispositionRange, label: bandLabel('Quick-sale / disposition range'), basis: `Faster-exit planning range derived from the supported retail band. ${scope.figureLabel}.` },
    workingUnderwritingValue: working,
    openingPosition: opening,
    targetAcquisitionRange: {
      low: targetLow,
      high: targetHigh,
      label: bandLabel('Target acquisition range'),
      basis: `Approximately ${Math.round(lowPct * 100)}–${Math.round(highPct * 100)}% of working value, leaving room for selling, holding, closing, and deal-specific work. ${scope.figureLabel}.`,
    },
    practicalMaximumAcquisitionPrice: maximum,
    walkAwayLevel: maximum,
    offerBasis: 'whole_tract_resale_only',
    subdivisionUpsideIncluded: false,
    explanation: `${valuation.basis} Working value is ${compactMoney(working)}. Opening position ${compactMoney(opening)}, target ${compactMoney(targetLow)}–${compactMoney(targetHigh)}, and walk away above ${compactMoney(maximum)} use the whole-tract resale case only. No subdivision upside is included. These are separate investor-planning assumptions, not observed market facts. ${scope.explanation}`,
    scenarios: [
      scenario('Conservative', valuation.dispositionRange.low, opening, 0.12, 5_000),
      scenario('Expected', working, Math.round((targetLow + targetHigh) / 2), 0.10, 7_500),
      scenario('Stronger', valuation.likelyRetail.high, maximum, 0.10, 10_000),
    ],
    ...scopeFields,
  };
}

function strategyFit(strategy: SnapshotStrategy | undefined): OperatorStrategyEvaluation['currentFit'] {
  if (!strategy) return 'Weak';
  if (strategy.applicability === 'applicable') return 'Strong';
  if (strategy.applicability === 'conditional') return 'Conditional';
  if (strategy.applicability === 'not_applicable') return 'Weak';
  return 'Conditional';
}

const STRATEGY_BUYER: Record<ApprovedStrategy, string> = {
  'Quick Flip': 'Local land buyer, builder, neighbor, or small investor seeking a straightforward parcel.',
  'Novation or Double Close': 'Retail end buyer reached through broader marketplace exposure.',
  'Subdivide or Minor Split': 'Builders, homesite buyers, or investors buying smaller, easier-to-finance lots.',
  'Land-Home Package': 'Owner-occupant or manufactured/site-built home buyer.',
  'Improvement Then Flip': 'Retail land buyer paying for solved access, clearing, perc, utilities, or a repositioned improvement.',
};

function strategyEvaluations(
  pkg: DealIntelligenceInputPackage,
  values: DealOperatorAnalysis['values'],
  seller: OperatorSellerContext,
  subdivision: OperatorSubdivisionAnalysis,
): OperatorStrategyEvaluation[] {
  const existing = new Map(pkg.strategies.map((strategy) => [strategy.strategy, strategy]));
  const score = (name: ApprovedStrategy, row: SnapshotStrategy | undefined): number => {
    let value = row?.applicability === 'applicable' ? 80 : row?.applicability === 'conditional' ? 60 : row?.applicability === 'blocked' ? 45 : 30;
    if (name === pkg.recommendation.preferredStrategy) value += 30;
    if (name === 'Subdivide or Minor Split' && subdivision.status === 'Promising') value += 15;
    if (name === 'Subdivide or Minor Split' && subdivision.automaticFirstLook && subdivision.status !== 'Confirmed obstacle') value += 80;
    if (name === 'Quick Flip' && pkg.comps.sold.length >= 3) value += 8;
    if (name === 'Quick Flip' && subdivision.automaticFirstLook) value -= 8;
    if (name === 'Novation or Double Close' && pkg.comps.active.length >= 3) value += 7;
    return value;
  };
  const ranked = APPROVED_STRATEGIES
    .map((name) => ({ name, row: existing.get(name), score: score(name, existing.get(name)) }))
    .sort((a, b) => b.score - a.score || APPROVED_STRATEGIES.indexOf(a.name) - APPROVED_STRATEGIES.indexOf(b.name));
  return ranked.map(({ name, row }, index) => {
    const scenarios = index === 0 && name !== 'Subdivide or Minor Split' ? values.scenarios : [];
    const sellerFit = seller.askingPrice == null
      ? 'Ask the seller for price expectations and openness to terms before choosing the structure.'
      : values.practicalMaximumAcquisitionPrice != null && seller.askingPrice <= values.practicalMaximumAcquisitionPrice
        ? 'The recorded asking price fits within the current acquisition ceiling.'
        : 'The current asking price requires negotiation, terms, or a higher-value exit to make this path work.';
    return {
      rank: index + 1,
      strategy: name,
      currentFit: strategyFit(row),
      expectedBuyer: STRATEGY_BUYER[name],
      capitalRequired: name === 'Quick Flip' ? 'Low to moderate'
        : name === 'Novation or Double Close' ? 'Low to moderate, depending on structure'
          : name === 'Subdivide or Minor Split' ? 'Moderate'
            : name === 'Land-Home Package' ? 'High' : 'Moderate',
      effort: row?.effort ?? (name === 'Quick Flip' ? 'Low' : 'Moderate'),
      timeline: row?.timeline ?? (name === 'Quick Flip' ? '1–6 months' : '3–12+ months'),
      expectedUpside: row?.valueCreationPath ?? 'Upside depends on buying below the supported exit value and executing the stated path.',
      mainRisk: row?.risk ?? 'The evidence is not yet sufficient to quantify this path.',
      evidenceSupport: unique(row?.supportingFacts ?? []),
      couldChangeRanking: unique([
        ...(row?.blockers ?? []),
        row?.nextVerificationStep,
        ...(name === 'Subdivide or Minor Split' ? subdivision.nextChecks : []),
      ]),
      sellerFit,
      nextUsefulCheck: row?.nextVerificationStep ?? 'Confirm the exit buyer, costs, timing, and seller fit.',
      financialScenarios: scenarios,
    };
  });
}

function parseRule(items: SnapshotDueDiligenceItem[], facts: DealIntelligenceInputPackage['facts'], pattern: RegExp): string | null {
  const strings = [
    ...items.map((item) => `${item.label}: ${item.headline}. ${item.detail ?? ''}`),
    ...facts.map((fact) => `${fact.label}: ${fact.value ?? ''}. ${fact.note ?? ''}`),
  ];
  return strings.find((value) => pattern.test(value)) ?? null;
}

function numericFeet(value: string | null): number | null {
  if (!value) return null;
  const explicit = [...value.matchAll(/([\d,.]+)\s*(?:ft|feet|foot)\b/gi)]
    .map((match) => Number(match[1].replace(/,/g, '')))
    .filter((number) => Number.isFinite(number) && number > 0);
  return explicit.length ? Math.max(...explicit) : null;
}

function subdivisionConcepts(acres: number | null): Array<{
  lots: number;
  mix: Array<{ lotCount: number; approximateAcresEach: number; acreageBand: string }>;
  rationale: string;
}> {
  if (acres == null || acres < 2) return [];
  const usable = acres * 0.9;
  const mix = (lots: number, smallLots: number, smallAcres: number, rationale: string) => {
    const remainderLots = lots - smallLots;
    const remainderAcres = remainderLots > 0 ? Math.max(0.75, (usable - smallLots * smallAcres) / remainderLots) : smallAcres;
    const rows = [
      { lotCount: smallLots, approximateAcresEach: Math.round(smallAcres * 10) / 10, acreageBand: acreageBandLabel(smallAcres) ?? 'under 2 acres' },
      ...(remainderLots ? [{
        lotCount: remainderLots,
        approximateAcresEach: Math.round(remainderAcres * 10) / 10,
        acreageBand: acreageBandLabel(remainderAcres) ?? 'under 2 acres',
      }] : []),
    ];
    return { lots, mix: rows.filter((row) => row.lotCount > 0), rationale };
  };
  if (acres >= 50) {
    return [
      mix(4, 2, 15, 'A lower-complexity frontage allocation with two mid-size homesites and two larger remainder tracts.'),
      mix(6, 4, 10, 'A practical minor/major-threshold test aimed at the 10–20 acre buyer band while preserving two flexible remainder lots.'),
      mix(10, 8, 5, 'A higher-yield frontage concept aimed at the 5–10 acre band with two larger remainder lots; use only if frontage, access, soils, and the subdivision threshold support it.'),
    ];
  }
  if (acres >= 20) return [
    mix(3, 2, 7, 'Two smaller market-facing lots plus a larger remainder tract.'),
    mix(5, 4, 5, 'Four 5-acre homesites plus a flexible remainder lot.'),
    mix(7, 6, 3, 'A higher-yield 2–5 acre concept that requires stronger access and septic evidence.'),
  ];
  if (acres >= 10) return [
    mix(2, 1, 5, 'One smaller homesite plus a larger remainder tract.'),
    mix(3, 2, 3, 'Two 2–5 acre homesites plus a larger remainder tract.'),
    mix(4, 3, 2.5, 'Three smaller lots plus a remainder lot, subject to frontage and septic feasibility.'),
  ];
  return [
    mix(2, 1, Math.max(2, usable * 0.4), 'One smaller homesite plus a larger remainder tract.'),
    mix(3, 2, Math.max(1, usable * 0.25), 'Two smaller homesites plus a remainder lot.'),
  ];
}

function subdivisionAnalysis(
  pkg: DealIntelligenceInputPackage,
  values: DealOperatorAnalysis['values'],
  marketBands?: OperatorAcreageBand[],
): OperatorSubdivisionAnalysis {
  const acres = pkg.identity.acres;
  const jurisdiction = firstText([
    pkg.identity.county && pkg.identity.state_ ? `${pkg.identity.county} County, ${pkg.identity.state_}` : null,
    parseRule(pkg.dueDiligence, pkg.facts, /jurisdiction|planning authority/i),
  ]);
  const minLot = parseRule(pkg.dueDiligence, pkg.facts, /minimum lot|min\.? lot|lot size/i);
  const frontage = parseRule(pkg.dueDiligence, pkg.facts, /frontage|lot width/i);
  const observedFrontageFeet = numericFeet(frontage);
  const minor = parseRule(pkg.dueDiligence, pkg.facts, /minor subdivision|minor split|administrative split/i);
  const road = parseRule(pkg.dueDiligence, pkg.facts, /road requirement|road standard|access/i);
  const septic = parseRule(pkg.dueDiligence, pkg.facts, /septic|sewer|utility/i);
  const obstacle = pkg.dueDiligence.find((item) => item.verdict === 'risk' && /cannot subdivide|subdivision prohibited|no legal access/i.test(`${item.headline} ${item.detail ?? ''}`));
  const accessPositive = pkg.dueDiligence.some((item) => item.verdict === 'good' && /access|frontage|road/i.test(item.label));
  const accessEvidenceText = [
    ...pkg.dueDiligence.map((item) => `${item.label} ${item.headline} ${item.detail ?? ''}`),
    ...pkg.facts.map((fact) => `${fact.label} ${fact.value ?? ''} ${fact.note ?? ''}`),
  ].join(' ');
  const narrowAccessGate = !obstacle && acres != null && acres >= 40 && (
    (observedFrontageFeet != null && observedFrontageFeet < 200)
    || /\b(?:narrow|single[- ]lane|constrained|limited)\b.{0,40}\b(?:road|drive|driveway|access|frontage|connection)\b/i.test(accessEvidenceText)
    || /\b(?:road|drive|driveway|access|frontage|connection)\b.{0,40}\b(?:narrow|single[- ]lane|constrained|limited)\b/i.test(accessEvidenceText)
  );
  const automaticFirstLook = !obstacle && acres != null && (
    (acres >= 40 && observedFrontageFeet != null && observedFrontageFeet >= 600)
    || acres >= 50
  );
  let status: OperatorSubdivisionAnalysis['status'] = obstacle ? 'Confirmed obstacle'
    : acres == null ? 'Needs confirmation'
      : acres < 2 ? 'Unattractive'
        : automaticFirstLook && narrowAccessGate ? 'Worth investigating'
          : automaticFirstLook ? 'Promising'
          : acres >= 5 && accessPositive ? 'Promising'
          : acres >= 5 ? 'Worth investigating' : 'Needs confirmation';
  const bands = marketBands ?? acreageBands(pkg);
  const splitStrategy = scanObject(pkg.strategies.find((strategy) => strategy.strategy === 'Subdivide or Minor Split'));
  const retainedEconomics = scanObject(splitStrategy.subdivisionEconomics);
  const retainedConceptRows = Array.isArray(retainedEconomics.concepts)
    ? retainedEconomics.concepts.filter((concept): concept is Record<string, unknown> =>
        !!concept && typeof concept === 'object')
    : [];
  const scenarioConcepts = retainedConceptRows.flatMap((concept) => {
    const lotSizes = Array.isArray(concept.lotSizesAcres)
      ? concept.lotSizesAcres.filter((value): value is number =>
          typeof value === 'number' && Number.isFinite(value) && value > 0)
      : [];
    if (!lotSizes.length) return [];
    const grouped = new Map<number, number>();
    for (const lotSize of lotSizes) {
      const rounded = Math.round(lotSize * 10) / 10;
      grouped.set(rounded, (grouped.get(rounded) ?? 0) + 1);
    }
    return [{
      lots: lotSizes.length,
      mix: [...grouped].map(([approximateAcresEach, lotCount]) => ({
        lotCount,
        approximateAcresEach,
        acreageBand: acreageBandLabel(approximateAcresEach) ?? 'under 2 acres',
      })),
      rationale: unique([
        typeof concept.geometryBasis === 'string' ? concept.geometryBasis : null,
        typeof concept.accessConfiguration === 'string' ? concept.accessConfiguration : null,
        typeof concept.ordinancePath === 'string' ? concept.ordinancePath : null,
      ]).join(' '),
    }];
  });
  if (!obstacle && status === 'Promising' && scenarioConcepts.length === 0) {
    status = 'Worth investigating';
  }
  const scenarios = scenarioConcepts.map((concept): OperatorSubdivisionScenario => {
    const pricedLots = concept.mix.map((lot) => ({
      ...lot,
      band: bands.find((band) => band.label === lot.acreageBand),
    }));
    const allPriced = pricedLots.every((lot) => lot.band?.medianSoldPricePerAcre != null);
    const gross = allPriced ? {
      low: Math.round(pricedLots.reduce((sum, lot) =>
        sum + lot.lotCount * lot.approximateAcresEach * lot.band!.medianSoldPricePerAcre! * 0.9, 0) / 500) * 500,
      high: Math.round(pricedLots.reduce((sum, lot) =>
        sum + lot.lotCount * lot.approximateAcresEach * lot.band!.medianSoldPricePerAcre! * 1.1, 0) / 500) * 500,
    } : null;
    const acquisitionLow = values.openingPosition;
    const acquisitionHigh = values.practicalMaximumAcquisitionPrice;
    const projectCosts = gross && acquisitionLow != null && acquisitionHigh != null ? (() => {
      const round = (value: number) => Math.round(value / 500) * 500;
      const baseItems = [
        { label: 'Acquisition', low: acquisitionLow, high: acquisitionHigh, basis: 'Opening position through practical maximum acquisition.' },
        { label: 'Buyer closing/title', low: acquisitionLow * 0.02, high: acquisitionHigh * 0.04, basis: '2%–4% of acquisition for closing, title, recording, and diligence.' },
        { label: 'Holding/financing', low: gross.low * 0.03, high: gross.high * 0.08, basis: '3%–8% of gross exit value for carrying time and financing.' },
        { label: 'Engineering and survey', low: 12_000 + concept.lots * 2_000, high: 25_000 + concept.lots * 4_000, basis: `Concept, boundary, and lot work scaled to ${concept.lots} proposed lots.` },
        { label: 'Plat and application fees', low: 3_000 + concept.lots * 1_000, high: 10_000 + concept.lots * 2_000, basis: 'Preliminary allowance pending the governing subdivision schedule.' },
        { label: 'Soil/perc testing', low: concept.lots * 1_000, high: concept.lots * 3_000, basis: 'Desktop-to-field allowance for each proposed homesite.' },
        { label: 'Road/driveway work', low: concept.lots * 5_000, high: concept.lots * 20_000, basis: 'Access allowance; no public-road extension is assumed proven.' },
        { label: 'Utility work', low: concept.lots * 2_500, high: concept.lots * 12_000, basis: 'Service/tap allowance pending written provider and field confirmation.' },
        { label: 'Marketing and sale costs', low: gross.low * 0.06, high: gross.high * 0.09, basis: '6%–9% of combined gross exit value.' },
      ].map((item) => ({ ...item, low: round(item.low), high: round(item.high) }));
      const nonAcquisitionLow = baseItems.slice(1).reduce((sum, item) => sum + item.low, 0);
      const nonAcquisitionHigh = baseItems.slice(1).reduce((sum, item) => sum + item.high, 0);
      const items = [
        ...baseItems,
        {
          label: 'Contingency',
          low: round(nonAcquisitionLow * 0.1),
          high: round(nonAcquisitionHigh * 0.15),
          basis: '10%–15% of non-acquisition project costs.',
        },
      ];
      return {
        low: items.reduce((sum, item) => sum + item.low, 0),
        high: items.reduce((sum, item) => sum + item.high, 0),
        includesAcquisition: true,
        categories: items.map((item) => item.label),
        items,
      };
    })() : null;
    const net = gross && projectCosts ? {
      low: gross.low - projectCosts.high,
      high: gross.high - projectCosts.low,
    } : null;
    const approximateAverage = concept.mix.reduce((sum, lot) => sum + lot.lotCount * lot.approximateAcresEach, 0) / concept.lots;
    return {
      lots: concept.lots,
      approximateAcresPerLot: Math.round(approximateAverage * 100) / 100,
      lotMix: concept.mix,
      configurationRationale: concept.rationale,
      feasibility: obstacle ? 'Not supported' : narrowAccessGate ? 'Worth testing' : minLot && frontage ? 'Plausible' : 'Worth testing',
      grossValue: gross,
      estimatedCosts: projectCosts,
      estimatedNetProfit: net,
      likelyNetOpportunity: net,
      note: gross
        ? `${concept.rationale} Gross value uses retained sold $/acre evidence for every proposed acreage band; net profit deducts acquisition and all listed project-cost categories.`
        : `${concept.rationale} No profit is stated because one or more proposed acreage bands lack retained sold pricing. Price those bands before underwriting this concept.`,
    };
  });
  const simplest = narrowAccessGate ? null
    : scenarios.find((scenario) => scenario.feasibility === 'Plausible')?.lots
      ?? scenarios.find((scenario) => scenario.feasibility === 'Worth testing')?.lots
      ?? null;
  return {
    status,
    governingJurisdiction: jurisdiction,
    minimumLotSize: minLot,
    minimumFrontage: frontage,
    observedFrontageFeet,
    minorSubdivisionThreshold: minor,
    automaticFirstLook,
    signalExplanation: automaticFirstLook
      ? narrowAccessGate
        ? `${acres!.toFixed(0)} acres make subdivision the highest-upside hypothesis, but the narrow road connection is the immediate gating issue: confirm that it can legally and physically serve multiple lots before assigning a practical lot count.`
        : `${acres!.toFixed(0)} acres${observedFrontageFeet != null ? ` and approximately ${Math.round(observedFrontageFeet).toLocaleString()} feet of observed frontage` : ''} create a subdivision-first signal. Incomplete ordinance or soil research changes the checks and pricing confidence, not the need to analyze this exit first.`
      : acres != null && acres >= 5
        ? `${acres.toFixed(1)} acres justify testing a practical split, subject to frontage, access, soils, utilities, and governing rules.`
        : 'Current acreage does not create an automatic subdivision signal.',
    simplestPracticalLotCount: simplest,
    appearsAllowedByRight: /by right|administrative approval/i.test(`${minLot ?? ''} ${minor ?? ''}`) ? true
      : /prohibit|not permitted|cannot subdivide/i.test(`${minLot ?? ''} ${minor ?? ''}`) ? false : null,
    roadRequirements: road,
    surveyAndPlatRequirements: parseRule(pkg.dueDiligence, pkg.facts, /survey|plat/i),
    septicAndUtilityConditions: septic,
    approvalPath: unique([
      'Confirm the governing planning jurisdiction and pre-application process.',
      'Have a surveyor test frontage, access, lot geometry, and a concept plat.',
      septic ? 'Confirm septic/utility feasibility for each proposed lot.' : 'Research septic, water, power, and road requirements for each proposed lot.',
      'Price the proposed lots against smaller-lot sold and active comps.',
    ]),
    scenarios,
    estimatedTimeline: status === 'Promising' ? 'About 3–9 months for a simple minor split, subject to survey, health, utility, and planning review.' : 'Timeline needs a planning and surveyor pre-check.',
    mainRisks: unique([
      obstacle ? evidenceText(obstacle) : null,
      narrowAccessGate ? 'The narrow road connection may not legally or physically support multiple lots.' : null,
      minLot ? null : 'Minimum lot size and frontage standards are not established.',
      septic ? null : 'Per-lot septic and utility feasibility is not established.',
      road ? null : 'Road and access standards for new lots are not established.',
    ]),
    nextChecks: unique([
      minLot ? null : 'Retrieve the governing subdivision ordinance and dimensional table.',
      narrowAccessGate ? 'Have county planning and a surveyor confirm whether the narrow road connection can legally and physically serve the proposed lots.' : null,
      frontage ? null : 'Measure usable frontage and test individual-lot road contact.',
      scenarios.length
        ? `Ask county planning which of the ${scenarios.map((scenario) => scenario.lots).join(', ')}-lot retained concepts uses the simplest practical approval path.`
        : 'Create a parcel-geometry, frontage, access, soils and ordinance-backed concept before assigning a lot count.',
      'Get survey/plat, soil/perc, and infrastructure cost ranges.',
    ]),
    evidenceKeys: unique([
      minLot ? 'subdivision:minimum_lot' : null,
      frontage ? 'subdivision:frontage' : null,
      minor ? 'subdivision:minor_threshold' : null,
      road ? 'subdivision:roads' : null,
      septic ? 'subdivision:septic_utilities' : null,
    ]),
  };
}

function sellerAnalysis(
  seller: OperatorSellerContext,
  score: OperatorScore,
  pkg: DealIntelligenceInputPackage,
  values: DealOperatorAnalysis['values'],
): OperatorSellerAnalysis {
  const owner = pkg.identity.owner;
  const subdivisionCandidate = (pkg.identity.acres ?? 0) >= 20;
  const questions = unique([
    seller.askingPrice == null ? 'What price are you hoping to receive, and how did you arrive at it?' : 'How flexible are you on price, timing, and terms?',
    'Why are you considering selling now?',
    'What timeline would work best for you?',
    'Who needs to approve and sign a sale, including every trustee, member, or other decision-maker?',
    owner && seller.name && owner.toLowerCase() !== seller.name.toLowerCase()
      ? `The record owner is ${owner}; what is your relationship to the owner and who has authority to sign?`
      : 'Is anyone else on title or involved in the decision?',
    subdivisionCandidate ? 'Has subdivision, a concept plan, or a prior lot split ever been considered for the property?' : null,
    subdivisionCandidate ? 'Are multiple road entrances possible, and has anyone tested frontage or driveway access for separate lots?' : null,
    'Is electric power or public water available along the road frontage?',
    'Has soil or perc testing been completed, and were any usable septic areas identified?',
    'Are there easements, restrictions or covenants, leases, road-maintenance agreements, timber activity, or improvements that affect the land?',
    'Do you know of access, flooding, wetlands, survey, boundary, or utility issues?',
    'Have you received prior offers, listed the land, or discussed terms with another buyer?',
  ]);
  const posture = score.score == null ? 'Seller Score Pending — run discovery before judging acquisition likelihood.'
    : score.score >= 70 ? 'Engage directly and test for an agreement inside the target range.'
      : score.score >= 50 ? 'Continue discovery; the opportunity is workable but the seller facts need tightening.'
        : 'Build the seller picture before investing heavily in offer work.';
  const task = seller.tasks.find((item) => item.status !== 'completed' && item.status !== 'done');
  return {
    snapshot: seller,
    negotiationPosture: posture,
    importantFacts: unique([
      seller.askingPrice != null ? `Asking price: ${compactMoney(seller.askingPrice)}.` : null,
      values.targetAcquisitionRange ? `Current target: ${compactMoney(values.targetAcquisitionRange.low)}–${compactMoney(values.targetAcquisitionRange.high)}.` : null,
      seller.timeline ? `Timeline: ${seller.timeline}.` : null,
      seller.flexibility ? `Flexibility: ${seller.flexibility}.` : null,
      seller.decisionAuthority ? `Decision authority: ${seller.decisionAuthority}.` : null,
      seller.ownershipContext ? `Ownership context: ${seller.ownershipContext}.` : null,
    ]),
    discoveryCallQuestions: questions,
    nextContactAction: task?.label
      ?? (seller.phone ? `Call ${seller.name ?? 'the seller'} and work through the discovery questions.`
        : seller.email ? `Email ${seller.name ?? 'the seller'} to schedule a discovery call.`
          : 'Add a working phone or email, then schedule the first seller conversation.'),
  };
}

function changeNotes(
  previous: PropertyIntelligenceSnapshot | null | undefined,
  currentScores: DealOperatorAnalysis['scores'],
  recommendation: string,
  pkg: DealIntelligenceInputPackage,
): string[] {
  if (!previous) return ['First operator analysis for this Deal Card.'];
  const notes: string[] = [];
  const prior = previous.operatorAnalysis;
  if (prior) {
    for (const key of ['property', 'market', 'seller'] as const) {
      const before = prior.scores[key].score;
      const after = currentScores[key].score;
      if (before !== after) notes.push(`${key[0].toUpperCase()}${key.slice(1)} Score changed ${before} → ${after} because the retained evidence set changed.`);
    }
    if (prior.overall.recommendation !== recommendation) {
      notes.push(`Recommendation changed from “${prior.overall.recommendation}” to “${recommendation}” based on the current score, value, strategy, and seller evidence.`);
    }
  }
  const beforeIds = new Set(previous.evidence.map((item) => item.id));
  const added = pkg.evidence.filter((item) => !beforeIds.has(item.id));
  if (added.length) notes.push(`${added.length} new retained evidence item(s) entered the analysis: ${added.slice(0, 4).map((item) => item.label).join(', ')}.`);
  return notes.length ? notes : ['No material score or recommendation change from the prior retained analysis.'];
}

function marketplaceSearchProof(
  pkg: DealIntelligenceInputPackage,
  context: DealOperatorContext,
): DealOperatorAnalysis['comps']['marketplaceSearchProof'] {
  return (['Zillow', 'Redfin'] as const).map((source) => {
    const matches = (value: string | null | undefined) =>
      new RegExp(source, 'i').test(value ?? '');
    const soldRetained = pkg.comps.sold.filter((comp) => matches(comp.source)
      || comp.providerAttributions?.some(matches)).length;
    const activeRetained = pkg.comps.active.filter((comp) => matches(comp.source)
      || comp.providerAttributions?.some(matches)).length;
    const rejected = pkg.comps.rejected.filter((comp) => matches(comp.source));
    const bucketCount = (pkg.comps.evidenceBuckets ?? [])
      .filter((bucket) => bucket.sources.some(matches))
      .reduce((sum, bucket) => sum + bucket.count, 0);
    const attempt = context.researchAttempts.find((item) =>
      matches(item.source) || matches(item.label) || matches(item.result));
    const attempted = soldRetained + activeRetained + rejected.length + bucketCount > 0 || !!attempt;
    const status = soldRetained + activeRetained > 0
      ? 'retained' as const
      : attempted ? 'attempted_no_qualifying_result' as const : 'no_attempt_evidence' as const;
    return {
      source,
      status,
      soldRetained,
      activeRetained,
      result: status === 'retained'
        ? `${source} search retained ${soldRetained} sold and ${activeRetained} active comparable(s).`
        : status === 'attempted_no_qualifying_result'
          ? `${source} was actively searched; ${rejected.length + bucketCount} reviewed/held-back row(s) and no qualifying retained comp. ${attempt?.result ?? ''}`.trim()
          : `No retained evidence proves that ${source} was searched in this run.`,
    };
  });
}

export function buildDealOperatorAnalysis(input: {
  pkg: DealIntelligenceInputPackage;
  context: DealOperatorContext;
  previousSnapshot?: PropertyIntelligenceSnapshot | null;
  generatedAt: string;
  /** Canonical Comps & Valuation counts; when supplied they govern the market
   *  score's comp counts so the two operator sections cannot disagree. */
  canonicalCompCounts?: CanonicalCompCounts | null;
  /**
   * The one canonical current state. When supplied it governs comp counts,
   * valuation status, blockers, missing information, decision summary and next
   * actions, and any historical statement it supersedes is dropped here too.
   */
  canonical?: CanonicalDealState | null;
  /** Whether the SUBJECT carries material improvements, and whether those
   *  improvements have been separately valued. Decides whether an
   *  Opening/Target/Ceiling figure is a land-basis reference or a completed
   *  whole-property recommendation. */
  subjectImprovement?: { improved: boolean; basis?: string | null; improvementsValued?: boolean } | null;
}): DealOperatorAnalysis {
  const { pkg, context } = input;
  const canonical = input.canonical ?? null;
  const market = marketAnalysis(pkg, context);
  const property = propertyScore(pkg, context.visualAnalysis);
  // One comp tally. An explicit count still wins, but the canonical state is
  // the next authority — the market score may never count comps for itself.
  const compCounts = input.canonicalCompCounts
    ?? (canonical ? { sold: canonical.comps.sold, active: canonical.comps.active, soldAllSourceStated: canonical.comps.soldAllSourceStated } : null);
  const marketScored = marketScore(pkg, market, compCounts);
  const sellerScored = sellerScore(pkg, context.seller);
  const scores = { property, market: marketScored, seller: sellerScored };
  const scope = canonical?.valuation.scope ?? resolveValuationScope({
    subjectImproved: input.subjectImprovement?.improved === true,
    improvementBasis: input.subjectImprovement?.basis ?? null,
    improvementsValued: input.subjectImprovement?.improvementsValued === true,
    landValuePriceable: pkg.valuation.priceable === true,
  });
  const values = valueAnalysis(pkg.valuation, context.seller, scope);
  // Anything the canonical state superseded is a historical conclusion the
  // current records contradict. It must not resurface as a risk or a question.
  const supersededText = new Set((canonical?.supersededStatements ?? []).map((entry) => entry.statement));
  const currentOnly = (values_: string[]): string[] => values_.filter((value) => !supersededText.has(value.trim()));
  const subdivision = subdivisionAnalysis(pkg, values, market.acreageBands);
  const rankedStrategies = strategyEvaluations(pkg, values, context.seller, subdivision);
  // A ranked internal evaluation is not an operator recommendation. Until a
  // usable closed-comp value basis exists, all acquisition structures remain
  // hypotheses and the card must show strategy selection as pending.
  const best = pkg.valuation.priceable ? rankedStrategies[0]?.strategy ?? null : null;
  const baseRecommendation = best
    ? best === 'Subdivide or Minor Split' && subdivision.automaticFirstLook
      ? `Highest-upside hypothesis: Subdivision. ${subdivision.signalExplanation} Whole-tract Quick Flip is the practical fallback if the gating checks fail or the added complexity does not pay.`
      : `${pkg.recommendation.posture === 'reject' ? 'Do not pursue on current terms' : 'Lead with'} ${best}. ${pkg.recommendation.why}`
    : 'Strategy selection is pending valuation evidence. Continue practical research and the seller conversation before choosing an acquisition path.';
  // The decision line every page shows comes from the canonical state, so the
  // Overview cannot narrate a comp or valuation position the other two pages
  // contradict.
  const recommendation = canonical ? `${baseRecommendation} ${canonical.decisionSummary}` : baseRecommendation;
  const seller = sellerAnalysis(context.seller, sellerScored, pkg, values);
  const unanswered = unique(currentOnly([
    ...property.materiallyChangeWith,
    ...marketScored.materiallyChangeWith,
    ...sellerScored.materiallyChangeWith,
    ...subdivision.nextChecks,
    ...(canonical?.missingInformation ?? []),
  ])).slice(0, 10);
  const actions = unique([
    ...(canonical?.nextActions ?? []),
    subdivision.automaticFirstLook ? 'Retrieve the subdivision rules and determine a practical lot count.' : null,
    subdivision.automaticFirstLook ? 'Test septic, utility, frontage, and access feasibility for the strongest lot concepts.' : null,
    seller.nextContactAction,
    subdivision.automaticFirstLook ? 'Compare whole-tract economics with smaller-band split-lot economics using the complete project cost basis.' : null,
    values.targetAcquisitionRange && !subdivision.automaticFirstLook ? 'Prepare an offer scenario inside the current target acquisition range.' : pkg.valuation.nextActionToPrice,
    !subdivision.automaticFirstLook ? rankedStrategies[0]?.nextUsefulCheck : null,
    context.researchAttempts.find((attempt) => attempt.status === 'source_unavailable' || attempt.status === 'not_run_system_failure')
      ? 'Retry the highest-value public-record source that did not return an answer.'
      : null,
  ]).slice(0, 6);
  const mainRisks = unique(currentOnly([
    ...(canonical?.blockers ?? []),
    ...property.mainDeductions,
    ...sellerScored.mainDeductions,
    ...pkg.dueDiligence
      .filter((item) => item.verdict === 'risk' && !unsupportedPhysicalConclusion(item))
      .map(evidenceText),
  ])).slice(0, 6);
  const mainOpportunity = subdivision.automaticFirstLook && best === 'Subdivide or Minor Split'
    ? `${subdivision.signalExplanation} Whole-tract Quick Flip remains the lower-complexity fallback.`
    : values.workingUnderwritingValue != null && best
    ? `${best} against a ${compactMoney(values.workingUnderwritingValue)} working value, provided the acquisition stays inside the stated target range.`
    : best ? `${best} is the most useful path to test next.` : 'No priced opportunity or primary strategy is established yet.';
  const change = changeNotes(input.previousSnapshot, scores, recommendation, pkg);
  const homeProof = pkg.comps.landHomeSearchProof;

  return {
    version: 1,
    generatedAt: input.generatedAt,
    analyst: {
      engine: 'landos-deal-analyst-v1',
      mode: context.visualAnalysis?.ok ? 'multimodal_llm_assisted' : 'evidence_synthesis',
      model: context.visualAnalysis?.model ?? null,
      reviewedEvidenceIds: pkg.evidence.map((item) => item.id),
      reviewedImages: context.visualAnalysis?.analyzed.map((item) => item.label) ?? [],
      visualSummary: context.visualAnalysis?.summary ?? null,
      groundingNote: context.visualAnalysis?.ok
        ? 'The analysis used the retained multimodal image observations together with canonical facts, diligence, comps, market research, and seller context. Every factor points back to retained evidence.'
        : 'The analysis used canonical facts, diligence, comps, market research, and seller context. Imagery is listed as a material follow-up because no successful multimodal read was available.',
    },
    scores,
    overall: {
      posture: pkg.recommendation.posture,
      recommendation,
      bestCurrentStrategy: best,
      mainOpportunity,
      mainRisks,
      unansweredQuestions: unanswered,
      nextBestActions: actions,
      whatCouldMateriallyChangeConclusion: unique(currentOnly([
        ...property.materiallyChangeWith,
        ...marketScored.materiallyChangeWith,
        ...sellerScored.materiallyChangeWith,
        ...pkg.recommendation.whatWouldChangeIt,
      ])).slice(0, 10),
    },
    values,
    comps: {
      soldSelectionTarget: 5,
      activeSelectionTarget: 4,
      soldShown: pkg.comps.sold.length,
      activeShown: pkg.comps.active.length,
      selectionExplanation: pkg.comps.policyExplanation,
      soldQuality: comparableQuality(pkg, 'sold'),
      activeQuality: comparableQuality(pkg, 'active'),
      manufacturedHomeLane: {
        searchedWithinMiles: 5,
        status: homeProof?.status ?? 'not_run',
        searchPeriodMonths: homeProof?.timePeriodMonths ?? 36,
        sourcesSearched: homeProof?.sourcesSearched ?? [],
        routesAttempted: homeProof?.routesAttempted ?? [],
        candidatesReviewed: homeProof?.candidatesReviewed ?? 0,
        exclusionReasons: homeProof?.exclusionReasons ?? [],
        qualifyingSales: pkg.comps.landHomeOnly.length,
        conclusion: pkg.comps.landHomeOnly.length
          ? `${pkg.comps.landHomeOnly.length} qualifying recent manufactured-home sale(s) above $200,000 were retained within five miles; this supports further Land-Home Package analysis but never prices the vacant land.`
          : homeProof?.status === 'completed'
            ? `The five-mile manufactured-home lane completed across ${homeProof.sourcesSearched.join(', ') || 'the retained source routes'}, reviewed ${homeProof.candidatesReviewed} candidate(s), and retained no qualifying recent sale above $200,000.`
            : 'No qualifying manufactured-home sale was retained, and a completed five-mile search is not proven for this run.',
      },
      marketplaceSearchProof: marketplaceSearchProof(pkg, context),
    },
    rankedStrategies,
    market,
    subdivision,
    seller,
    researchAttempts: context.researchAttempts,
    changeNotes: change,
    evidenceNotes: unique([
      ...pkg.facts.map((fact) => `${fact.label}: ${fact.source ?? 'retained source'}`),
      ...pkg.dueDiligence.map((item) => `${item.label}: ${item.grade}`),
      ...pkg.evidence.map((item) => `${item.label}: ${item.sourceType}`),
    ]),
    canonicalState: canonical,
  };
}

function modelPackage(pkg: DealIntelligenceInputPackage, context: DealOperatorContext): unknown {
  return {
    identity: pkg.identity,
    facts: pkg.facts,
    governmentRecords: pkg.governmentRecords,
    dueDiligence: pkg.dueDiligence,
    comps: {
      sold: pkg.comps.sold,
      active: pkg.comps.active,
      askingReferences: pkg.comps.askingReferences,
      summary: pkg.comps.summaryLine,
    },
    valuation: pkg.valuation,
    strategies: pkg.strategies,
    priorRecommendation: pkg.recommendation,
    marketIntelligence: pkg.marketIntelligence,
    seller: context.seller,
    marketScan: context.marketScan,
    researchAttempts: context.researchAttempts,
    retainedEvidence: pkg.evidence.map((item) => ({
      id: item.id,
      kind: item.kind,
      label: item.label,
      sourceType: item.sourceType,
      supports: item.supports,
    })),
  };
}

function wholeCardPrompt(pkg: DealIntelligenceInputPackage, context: DealOperatorContext, imageLabels: string[]): string {
  const packet = JSON.stringify(modelPackage(pkg, context)).slice(0, 120_000);
  return `You are the LandOS acquisition Analyst. Form a useful, evidence-grounded opinion for an active land investor.

You are receiving the complete current structured Deal Card plus retained images. Inspect every image and use visible parcel shape, road/frontage context, clearing, vegetation, terrain, surrounding development, possible access, and apparent constraints when they are actually visible. Never infer a parcel fact solely from an image. Do not invent a source, metric, seller fact, project, or price.

Required independent scores:
- Property Score: the physical property itself.
- Market Score: resale demand and market velocity.
- Seller Score: the acquisition opportunity and seller situation. If no substantive seller evidence exists, return score null, rating Pending, and "Not enough information"; never infer Weak from missing data.
Do not average them into a fourth score. A missing government source may limit a property conclusion but must not depress unrelated market or seller evidence. Use practical acquisition language; do not use legalistic gating language. When a retained parcel match is usable for discovery, never call it "provisional identity," "not closing-grade," or say official confirmation is required before an offer. Describe an unanswered county source as a county-source gap to retry during normal diligence, not as a deal risk or a reason to withhold valuation.
The recommendation must name and align with bestStrategy. Evaluate and mention only the five approved strategies in the JSON schema below; never introduce "Buy and Hold" or another unranked acquisition strategy. A tract around 50+ acres automatically requires subdivision-first analysis; substantial road frontage strengthens that signal. Incomplete subdivision rules, soils, or utility research means "Worth investigating" or "Needs confirmation", never "blocked". Rank Subdivide or Minor Split first when that signal creates materially greater practical upside, with whole-tract Quick Flip as the simpler fallback.
SSURGO soil-component slope ranges, single elevation samples, and terrain imagery are screening context only. Never restate them as parcel-wide slope, elevation gain, extreme topography, buildable acreage, development cost, or a deduction in either Property Score or Market Score unless the structured packet contains an independently measured parcel-wide terrain result. Market Score must describe demand and velocity, never the subject property's physical constraints.

Retained images in order:
${imageLabels.map((label, index) => `${index + 1}. ${label}`).join('\n') || '(none)'}

Current Deal Card JSON:
${packet}

Return STRICT JSON only:
{
  "propertyScore": {"score":0-100,"rating":"Excellent|Strong|Moderate|Weak|Very weak","explanation":"short","strongestPositiveFactors":["..."],"mainDeductions":["..."],"materiallyChangeWith":["..."],"evidenceKeys":["fact/dd/image ids"]},
  "marketScore": {same shape},
  "sellerScore": {same shape},
  "posture":"pursue|hold|renegotiate|reject|undetermined",
  "recommendation":"plain useful opinion",
  "bestStrategy":"Quick Flip|Novation or Double Close|Subdivide or Minor Split|Land-Home Package|Improvement Then Flip|null",
  "mainOpportunity":"...",
  "mainRisks":["..."],
  "unansweredQuestions":["..."],
  "nextBestActions":["..."],
  "whatCouldMateriallyChangeConclusion":["..."],
  "visualSummary":"what the retained images materially show, or that they are inconclusive",
  "visualObservations":[{"category":"access|road_frontage|parcel_shape|clearing|terrain_slope|neighboring_development|improvements|wetlands_water|other","observation":"one visible signal","signal":"positive|concern|neutral","confidence":"high|medium|low","sourceImage":"exact image label"}],
  "marketConclusion":"...",
  "subdivisionStatus":"Promising|Worth investigating|Needs confirmation|Unattractive|Not supported|Confirmed obstacle",
  "evidenceNotes":["which retained evidence caused the opinion"]
}`;
}

function parseModelJson(raw: string): WholeCardModelReview | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed as WholeCardModelReview : null;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(trimmed.slice(start, end + 1)) as WholeCardModelReview; } catch { return null; }
  }
}

function practicalOperatorText(value: string): string {
  return value
    .replace(/official county records must still be reconciled with LandPortal data/gi, 'county-source attempts did not return a second parcel match')
    .replace(/verify the official parcel record(?: with [^,.]+)? to resolve the ['"]?provisional['"]? identity status/gi, 'retry the county parcel source during normal offer diligence')
    .replace(/provisional identity status/gi, 'county-source gap')
    .replace(/provisional identity/gi, 'county-source gap')
    .replace(/discovery-stage identity/gi, 'retained parcel match')
    .replace(/not closing-grade proof/gi, 'a discovery-stage source limitation')
    .replace(/official confirmation required before an offer/gi, 'county-source retry during normal offer diligence')
    .trim();
}

function normalizedRecommendation(
  candidate: unknown,
  bestStrategy: ApprovedStrategy | null,
  fallback: string,
): string {
  if (typeof candidate !== 'string' || !candidate.trim()) return fallback;
  const text = practicalOperatorText(candidate);
  // The structured best strategy is validated against APPROVED_STRATEGIES.
  // Prose that omits it or introduces a sixth strategy creates an owner-facing
  // contradiction, so retain the deterministic, evidence-grounded fallback.
  if (bestStrategy && !text.toLowerCase().includes(bestStrategy.toLowerCase())) return fallback;
  if (/\b(buy and hold|hold for appreciation|timber hold|rental hold)\b/i.test(text)) return fallback;
  return text;
}

function marketStrengthForScore(score: OperatorScore): OperatorMarketAnalysis['strength'] {
  if (score.score == null) return 'Uncertain';
  if (score.score >= 70) return 'Strong';
  if (score.score >= 50) return 'Moderate';
  if (score.score >= 30) return 'Weak';
  return 'Weak';
}

function retainPriorMultimodalReview(
  fallback: DealOperatorAnalysis,
  previousVisualSnapshot: PropertyIntelligenceSnapshot | null | undefined,
  currentImageLabels: Set<string>,
): DealOperatorAnalysis {
  const prior = previousVisualSnapshot?.operatorAnalysis;
  if (prior?.analyst.mode !== 'multimodal_llm_assisted') return fallback;
  const reviewed = prior.analyst.reviewedImages;
  const exactSameImageSet = reviewed.length === currentImageLabels.size
    && reviewed.every((label) => currentImageLabels.has(label));
  if (!exactSameImageSet) return fallback;

  return {
    ...fallback,
    analyst: {
      ...fallback.analyst,
      mode: 'multimodal_llm_assisted',
      model: prior.analyst.model,
      reviewedImages: [...reviewed],
      visualSummary: prior.analyst.visualSummary,
      groundingNote: 'Current canonical facts, comps, market, strategy, and seller inputs were refreshed. The most recent successful multimodal review remains attached because the retained image set is unchanged and the current image-provider retry was unavailable.',
    },
    evidenceNotes: unique([
      ...fallback.evidenceNotes,
      ...prior.evidenceNotes.filter((note) => reviewed.some((label) => note.includes(label))),
    ]),
  };
}

function stringArray(value: unknown, maximum = 10): string[] {
  return Array.isArray(value)
    ? unique(value.filter((item): item is string => typeof item === 'string').map(practicalOperatorText)).slice(0, maximum)
    : [];
}

function hasEstablishedParcelTerrain(pkg: DealIntelligenceInputPackage): boolean {
  const factEvidence = pkg.facts.some((fact) => {
    const text = `${fact.key} ${fact.label} ${fact.value ?? ''} ${fact.note ?? ''}`;
    return /\bterrain|topograph|slope|elevation\b/i.test(text)
      && !/\bnot measured|not established|unknown|unverified|verification|quarantined|preliminary|soil|ssurgo|map unit|point sample|single point|provider terrain\b/i.test(text);
  });
  const diligenceEvidence = pkg.dueDiligence.some((item) => {
    const text = `${item.key} ${item.label} ${item.headline} ${item.detail ?? ''}`;
    return item.grade !== 'unresolved_question'
      && item.grade !== 'unavailable_public_record'
      && /\bterrain|topograph|slope|elevation\b/i.test(text)
      && !/\bnot measured|not established|unknown|unverified|verification|quarantined|preliminary|soil|ssurgo|map unit|point sample|single point|provider terrain\b/i.test(text);
  });
  return factEvidence || diligenceEvidence;
}

function modelScoreNarrative(candidate: Partial<OperatorScore> | undefined): string {
  if (!candidate) return '';
  return [
    candidate.explanation,
    ...(candidate.strongestPositiveFactors ?? []),
    ...(candidate.mainDeductions ?? []),
    ...(candidate.materiallyChangeWith ?? []),
  ].filter((value): value is string => typeof value === 'string').join(' ');
}

function unsupportedParcelTerrainClaim(text: string, pkg: DealIntelligenceInputPackage): boolean {
  return !hasEstablishedParcelTerrain(pkg)
    && /\b(?:extreme|severe|steep|very steep)?\s*(?:terrain|topograph\w*|slope\w*|elevation gain|grade\w*)\b/i.test(text)
    && !/\b(?:verify|measure|confirm|unknown|not measured|not established|may|might|appears?|apparent|screening|investigat)\b/i.test(text);
}

function unsupportedParcelTerrainScore(candidate: Partial<OperatorScore> | undefined, pkg: DealIntelligenceInputPackage): boolean {
  if (!candidate) return false;
  // A separate "what would change this" note that asks for a terrain survey
  // cannot legitimize an unsupported terrain assertion in the explanation or
  // deductions. Judge each asserted score statement on its own.
  return [
    candidate.explanation,
    ...(candidate.strongestPositiveFactors ?? []),
    ...(candidate.mainDeductions ?? []),
  ].some((text) => typeof text === 'string' && unsupportedParcelTerrainClaim(text, pkg));
}

function marketScoreUsesPropertyConstraint(candidate: Partial<OperatorScore> | undefined): boolean {
  return /\b(?:terrain|topograph\w*|slope\w*|frontage|access|buildab\w*|septic|wetland\w*|flood\w*)\b/i.test(
    modelScoreNarrative(candidate),
  );
}

function normalizedModelScore(
  candidate: Partial<OperatorScore> | undefined,
  fallback: OperatorScore,
  reject = false,
): OperatorScore {
  if (reject) return fallback;
  if (!candidate || typeof candidate.score !== 'number' || !Number.isFinite(candidate.score)) return fallback;
  const score = clamp(candidate.score);
  return {
    score,
    rating: rating(score),
    explanation: typeof candidate.explanation === 'string' && candidate.explanation.trim()
      ? practicalOperatorText(candidate.explanation) : fallback.explanation,
    strongestPositiveFactors: stringArray(candidate.strongestPositiveFactors).length
      ? stringArray(candidate.strongestPositiveFactors) : fallback.strongestPositiveFactors,
    mainDeductions: stringArray(candidate.mainDeductions).length
      ? stringArray(candidate.mainDeductions) : fallback.mainDeductions,
    materiallyChangeWith: stringArray(candidate.materiallyChangeWith).length
      ? stringArray(candidate.materiallyChangeWith) : fallback.materiallyChangeWith,
    evidenceKeys: stringArray(candidate.evidenceKeys, 30).length
      ? stringArray(candidate.evidenceKeys, 30) : fallback.evidenceKeys,
  };
}

/** Marker for the canonical comp-count sentence the market score must always carry. */
const CANONICAL_COMP_COUNT_MARKER = /selected (?:closed|source-stated) sale\(s\) and .* internal county-band sale\(s\)/i;

/**
 * Re-assert the deterministic canonical comp-count line on a model-reworded
 * market score. The analyst may describe the market; it may not restate how
 * many closed sales LandOS selected, because Comps & Valuation displays that
 * count from the same registry.
 */
function withCanonicalCompCountLine(scored: OperatorScore, deterministic: OperatorScore): OperatorScore {
  const canonicalLine = deterministic.strongestPositiveFactors.find((f) => CANONICAL_COMP_COUNT_MARKER.test(f));
  if (!canonicalLine) return scored;
  const withoutModelCount = scored.strongestPositiveFactors.filter((f) => !CANONICAL_COMP_COUNT_MARKER.test(f));
  return {
    ...scored,
    strongestPositiveFactors: unique([canonicalLine, ...withoutModelCount]).slice(0, 5),
    mainDeductions: scored.mainDeductions.filter((d) => !/no selected closed sale/i.test(d)),
  };
}

function normalizedVisualObservations(
  raw: unknown,
  labels: Set<string>,
): OperatorVisualContext['observations'] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const observation = typeof row.observation === 'string' ? row.observation.trim() : '';
    const sourceImage = typeof row.sourceImage === 'string' && labels.has(row.sourceImage) ? row.sourceImage : '';
    if (!observation || !sourceImage) return [];
    const signal = ['positive', 'concern', 'neutral'].includes(String(row.signal))
      ? String(row.signal) as 'positive' | 'concern' | 'neutral' : 'neutral';
    const confidence = ['high', 'medium', 'low'].includes(String(row.confidence))
      ? String(row.confidence) as 'high' | 'medium' | 'low' : 'low';
    return [{
      category: typeof row.category === 'string' ? row.category : 'other',
      observation,
      signal,
      confidence,
      sourceImage,
    }];
  }).slice(0, 20);
}

/**
 * One grounded whole-card multimodal Analyst call. The deterministic analysis is
 * always built first and is returned unchanged when the image set is empty, the
 * provider is unavailable, or the response fails validation.
 */
export async function runWholeCardOperatorAnalyst(input: {
  pkg: DealIntelligenceInputPackage;
  context: DealOperatorContext;
  previousSnapshot?: PropertyIntelligenceSnapshot | null;
  /** Most recent historical snapshot with a successful image review. It may be
   *  older than `previousSnapshot` when a later provider retry was unavailable. */
  previousVisualSnapshot?: PropertyIntelligenceSnapshot | null;
  generatedAt: string;
  images: VisionSourceImage[];
  generate: WholeCardVisionGenerator;
  model: string;
  canonicalCompCounts?: CanonicalCompCounts | null;
  /** The one canonical current state, forwarded to the deterministic build and
   *  used to reject any model text the current records contradict. */
  canonical?: CanonicalDealState | null;
  subjectImprovement?: { improved: boolean; basis?: string | null; improvementsValued?: boolean } | null;
}): Promise<DealOperatorAnalysis> {
  const fallback = buildDealOperatorAnalysis(input);
  // The Analyst may reword, but it may never resurrect a conclusion the current
  // accepted records already superseded.
  const supersededText = new Set((fallback.canonicalState?.supersededStatements ?? []).map((entry) => entry.statement));
  const currentOnly = (values: string[]): string[] => values.filter((value) => !supersededText.has(value.trim()));
  const { keep } = dedupeImages(input.images);
  if (!keep.length) return fallback;
  const labels = new Set(keep.map((image) => image.label));
  const fallbackWithPriorVisuals = () => retainPriorMultimodalReview(
    fallback,
    input.previousVisualSnapshot ?? input.previousSnapshot,
    labels,
  );
  const encoded = keep.map((image) => ({
    data: fs.readFileSync(image.path).toString('base64'),
    mimeType: image.path.toLowerCase().endsWith('.jpg') || image.path.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' : 'image/png',
  }));
  let parsed: WholeCardModelReview | null = null;
  try {
    parsed = parseModelJson(await input.generate(wholeCardPrompt(input.pkg, input.context, [...labels]), encoded, input.model));
  } catch {
    return fallbackWithPriorVisuals();
  }
  if (!parsed) return fallbackWithPriorVisuals();
  const hasUsableValueBasis = input.pkg.valuation.priceable === true;
  const parsedBestStrategy = parsed.bestStrategy === null || APPROVED_STRATEGIES.includes(parsed.bestStrategy as ApprovedStrategy)
    ? parsed.bestStrategy ?? fallback.overall.bestCurrentStrategy
    : fallback.overall.bestCurrentStrategy;
  const bestStrategy = !hasUsableValueBasis
    ? null
    : fallback.subdivision.automaticFirstLook
    && fallback.subdivision.status !== 'Confirmed obstacle'
    ? 'Subdivide or Minor Split'
    : parsedBestStrategy;
  const posture = ['pursue', 'hold', 'renegotiate', 'reject', 'undetermined'].includes(String(parsed.posture))
    ? parsed.posture as OpportunityPosture : fallback.overall.posture;
  const visualObservations = normalizedVisualObservations(parsed.visualObservations, labels);
  const visualSummary = typeof parsed.visualSummary === 'string' && parsed.visualSummary.trim()
    ? practicalOperatorText(parsed.visualSummary) : 'The retained images were reviewed, but no additional visual conclusion was returned.';
  const scores = {
    property: normalizedModelScore(
      parsed.propertyScore,
      fallback.scores.property,
      unsupportedParcelTerrainScore(parsed.propertyScore, input.pkg),
    ),
    // An analyst may reword the market read but never restate the comp counts:
    // the canonical Comps & Valuation count line from the deterministic score
    // is always re-asserted so the two operator sections cannot disagree.
    market: withCanonicalCompCountLine(
      normalizedModelScore(
        parsed.marketScore,
        fallback.scores.market,
        marketScoreUsesPropertyConstraint(parsed.marketScore),
      ),
      fallback.scores.market,
    ),
    seller: fallback.scores.seller.score == null
      ? fallback.scores.seller
      : normalizedModelScore(parsed.sellerScore, fallback.scores.seller),
  };
  return {
    ...fallback,
    analyst: {
      ...fallback.analyst,
      mode: 'multimodal_llm_assisted',
      model: input.model,
      reviewedImages: [...labels],
      visualSummary,
      groundingNote: 'One whole-card multimodal Analyst call reviewed the retained images together with canonical facts, public-source attempts, diligence, comps, market research, valuation, strategies, and seller context. Output fields were validated and unsupported fields fell back to deterministic synthesis.',
    },
    scores,
    overall: {
      posture,
      recommendation: hasUsableValueBasis
        ? normalizedRecommendation(
          parsed.recommendation,
          bestStrategy,
          fallback.overall.recommendation,
        )
        : fallback.overall.recommendation,
      bestCurrentStrategy: bestStrategy,
      mainOpportunity: !hasUsableValueBasis
        ? fallback.overall.mainOpportunity
        : typeof parsed.mainOpportunity === 'string' && parsed.mainOpportunity.trim()
        ? practicalOperatorText(parsed.mainOpportunity) : fallback.overall.mainOpportunity,
      mainRisks: currentOnly(stringArray(parsed.mainRisks).filter((risk) => !unsupportedParcelTerrainClaim(risk, input.pkg))).length
        ? currentOnly(stringArray(parsed.mainRisks).filter((risk) => !unsupportedParcelTerrainClaim(risk, input.pkg)))
        : fallback.overall.mainRisks,
      unansweredQuestions: currentOnly(stringArray(parsed.unansweredQuestions)).length
        ? currentOnly(stringArray(parsed.unansweredQuestions)) : fallback.overall.unansweredQuestions,
      nextBestActions: stringArray(parsed.nextBestActions).length ? stringArray(parsed.nextBestActions) : fallback.overall.nextBestActions,
      whatCouldMateriallyChangeConclusion: currentOnly(stringArray(parsed.whatCouldMateriallyChangeConclusion)).length
        ? currentOnly(stringArray(parsed.whatCouldMateriallyChangeConclusion)) : fallback.overall.whatCouldMateriallyChangeConclusion,
    },
    market: {
      ...fallback.market,
      strength: marketStrengthForScore(scores.market),
      conclusion: typeof parsed.marketConclusion === 'string' && parsed.marketConclusion.trim()
        ? practicalOperatorText(parsed.marketConclusion) : fallback.market.conclusion,
    },
    subdivision: {
      ...fallback.subdivision,
      status: fallback.subdivision.automaticFirstLook && fallback.subdivision.status !== 'Confirmed obstacle'
        ? fallback.subdivision.status
        : ['Promising', 'Worth investigating', 'Needs confirmation', 'Unattractive', 'Not supported', 'Confirmed obstacle'].includes(String(parsed.subdivisionStatus))
        ? parsed.subdivisionStatus as OperatorSubdivisionAnalysis['status'] : fallback.subdivision.status,
    },
    evidenceNotes: unique([
      ...fallback.evidenceNotes,
      ...stringArray(parsed.evidenceNotes, 30),
      ...visualObservations.map((observation) => `${observation.sourceImage}: ${observation.observation}`),
    ]),
  };
}
