// Property Intelligence — the operator read.
//
// One launch control, live specialist progress, and the joined snapshot split
// across the Deal Card tabs it belongs to. Every surface here reads the SAME
// snapshot, so two tabs can never tell different stories.
//
// Honesty rules enforced in this component:
//   • A section with no data says so plainly; it never renders as "complete".
//   • A failed or skipped specialist is always visible, with its category.
//   • A stale failure disappears the moment a newer run produces a snapshot.
//   • No value is shown when the snapshot says the property is not priceable.

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { apiGet, apiPost } from '../lib/api';
import { DealImageGallery } from '@/components/DealImageGallery';

/** Same-origin API asset URLs need the dashboard token appended for <img>/<a>. */
function tokenized(url: string | null): string | null {
  if (!url) return null;
  return url;
}

// ── View types (mirror src/landos/property-intelligence-snapshot.ts) ─────────

export type EvidenceGradeView =
  | 'confirmed_fact'
  | 'likely_indication'
  | 'unresolved_question'
  | 'unavailable_public_record'
  | 'post_contract_verification';

export interface PiFact {
  key: string;
  label: string;
  value: string | null;
  grade: EvidenceGradeView;
  source: string | null;
  sourceUrl: string | null;
  retrievedAt: string | null;
  note: string | null;
}

export interface PiDueDiligenceItem {
  key: string;
  label: string;
  verdict: 'good' | 'caution' | 'risk' | 'unknown';
  headline: string;
  grade: EvidenceGradeView;
  detail: string | null;
  sourceUrl: string | null;
  missing: string[];
}

export interface PiComp {
  key: string;
  /** The comp's assessor parcel number, exactly as the source stated it. */
  apn?: string | null;
  address: string | null;
  lane: 'sold' | 'active';
  source: string;
  sourceUrl: string | null;
  status: string;
  dateIso: string | null;
  price: number | null;
  acres: number | null;
  pricePerAcre: number | null;
  distanceMiles: number | null;
  originalListingDate?: string | null;
  collectionDate?: string | null;
  daysOnMarket?: number | null;
  priceChanges?: Array<{ at: string | null; price: number | null; note: string }>;
  views?: number | null;
  saves?: number | null;
  engagement?: 'strong' | 'weak' | 'inconclusive';
  thumbnailUrl?: string | null;
  photoUrls?: string[];
  whyUseful: string;
  similarities: string[];
  differences: string[];
  weight?: number;
  weightLabel?: 'strong' | 'moderate' | 'limited';
  materialDifferences?: string[];
  homeType?: string | null;
  yearBuilt?: number | null;
  homeSizeSqft?: number | null;
}

function cleanJurisdiction(value: string | null | undefined): string | null {
  return value?.replace(/\b(County|Parish|Borough)(\s+\1)+\b/gi, '$1') ?? null;
}

export interface PiOperatorScore {
  score: number | null;
  rating: string;
  explanation: string;
  strongestPositiveFactors: string[];
  mainDeductions: string[];
  materiallyChangeWith: string[];
  evidenceKeys: string[];
}

export interface PiOperatorResearchAttempt {
  key: string;
  label: string;
  category: string;
  source: string;
  url: string | null;
  attemptCount: number;
  status: 'retrieved' | 'useful_indication' | 'attempted_inconclusive' | 'source_unavailable' | 'not_found' | 'not_run' | 'not_run_system_failure';
  result: string;
  artifactIds: string[];
  attemptedAt: string | null;
}

export interface PiOperatorAnalysis {
  version: number;
  generatedAt: string;
  scores: { property: PiOperatorScore; market: PiOperatorScore; seller: PiOperatorScore };
  overall: {
    posture: string;
    recommendation: string;
    bestCurrentStrategy: string | null;
    mainOpportunity: string;
    mainRisks: string[];
    unansweredQuestions: string[];
    nextBestActions: string[];
    whatCouldMateriallyChangeConclusion: string[];
  };
  values: {
    expectedMarketValue: { low: number; high: number; label: string; basis: string } | null;
    retailAskingRange: { low: number; high: number; label: string; basis: string } | null;
    quickSaleDispositionRange: { low: number; high: number; label: string; basis: string } | null;
    workingUnderwritingValue: number | null;
    openingPosition: number | null;
    targetAcquisitionRange: { low: number; high: number; label: string; basis: string } | null;
    practicalMaximumAcquisitionPrice: number | null;
    walkAwayLevel: number | null;
    explanation: string;
    scenarios: Array<{ name: string; resalePrice: number; acquisitionPrice: number; estimatedCosts: number; estimatedProfit: number; assumption: string }>;
  };
  rankedStrategies: Array<{
    rank: number;
    strategy: string;
    currentFit: string;
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
    financialScenarios: Array<{ name: string; resalePrice: number; acquisitionPrice: number; estimatedCosts: number; estimatedProfit: number; assumption: string }>;
  }>;
  market: {
    strength: string;
    buyerDemand: string;
    resaleDifficulty: string;
    likelyMarketingTime: string;
    expectedBulkMarketingTime?: string;
    expectedSmallerLotMarketingTime?: string;
    internalMetrics: Array<{ label: string; value: string; source: string }>;
    acreageAndPriceBands: string[];
    acreageBands?: Array<{
      label: string;
      soldCount: number;
      activeCount: number;
      medianSalePrice: number | null;
      medianSoldPricePerAcre: number | null;
      medianDaysOnMarket: number | null;
      sellThroughRate: number | null;
      absorptionRate: number | null;
      monthsOfSupply: number | null;
      population: number | null;
      populationDensity: number | null;
      populationGrowth: number | null;
      likelyResaleTime: string;
      movementRank: number | null;
      snapshotPeriod: string | null;
      confidence: string;
      coverage: string;
      source: string;
    }>;
    bestMovingAcreageBands?: string[];
    developmentAndInfrastructure: Array<{ name: string; location: string | null; distanceMiles: number | null; status: string; timeline?: string | null; scale?: string | null; likelyEffect: string; downside: string | null; sourceUrl: string | null }>;
    dataCenters: {
      searchedWithinMiles: number;
      status: string;
      summary: string;
      sourceUrl?: string | null;
      screenshotUrl?: string | null;
      attemptedAt?: string | null;
      items: Array<{ name: string; operatorOrDeveloper?: string | null; location: string | null; distanceMiles: number | null; status: string; likelyEffect: string; downside?: string | null; sourceUrl: string | null }>;
    };
    conclusion: string;
    strategyImplications: string[];
    limitations: string[];
  };
  subdivision: {
    status: string;
    governingJurisdiction: string | null;
    minimumLotSize: string | null;
    minimumFrontage: string | null;
    observedFrontageFeet?: number | null;
    minorSubdivisionThreshold: string | null;
    automaticFirstLook?: boolean;
    signalExplanation?: string;
    simplestPracticalLotCount: number | null;
    appearsAllowedByRight: boolean | null;
    roadRequirements?: string | null;
    surveyAndPlatRequirements?: string | null;
    septicAndUtilityConditions?: string | null;
    approvalPath: string[];
    estimatedTimeline: string;
    mainRisks: string[];
    nextChecks: string[];
    scenarios: Array<{
      lots: number;
      approximateAcresPerLot: number | null;
      lotMix?: Array<{ lotCount: number; approximateAcresEach: number; acreageBand: string }>;
      configurationRationale?: string;
      feasibility: string;
      grossValue: { low: number; high: number } | null;
      estimatedCosts: {
        low: number;
        high: number;
        includesAcquisition?: boolean;
        categories?: string[];
        items?: Array<{ label: string; low: number; high: number; basis: string }>;
      } | null;
      estimatedNetProfit?: { low: number; high: number } | null;
      likelyNetOpportunity: { low: number; high: number } | null;
      note: string;
    }>;
  };
  researchAttempts: PiOperatorResearchAttempt[];
  seller: {
    negotiationPosture: string;
    importantFacts: string[];
    discoveryCallQuestions: string[];
    nextContactAction: string;
  };
  changeNotes: string[];
  evidenceNotes: string[];
}

export interface PiSnapshot {
  snapshotVersion: number;
  dealCardId: number;
  runId: string;
  sequence: number;
  isPrimary: boolean;
  status: 'running' | 'complete' | 'complete_with_gaps' | 'blocked_identity' | 'failed';
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  identity: {
    state: 'confirmed' | 'provisional' | 'conflicted' | 'unresolved';
    normalizedAddress: string | null;
    county: string | null;
    state_: string | null;
    apn: string | null;
    apnVariants: string[];
    owner: string | null;
    ownerMailing: string | null;
    situs: string | null;
    /** Operator-accepted full display address when the retained lead input
     * extends the confirmed situs street. View-enriched by the server read. */
    displayAddress?: string | null;
    /** Canonical LandPortal property identifier retained on the subject card. */
    lpPropertyId?: string | null;
    acres: number | null;
    acreageBasis: string | null;
    coordinates: { lat: number; lng: number } | null;
    hasParcelGeometry: boolean;
    sourceConfidence: 'high' | 'medium' | 'low' | 'none';
    /** True when consistent parcel evidence supports discovery-stage work even
     * though the practical official source is unavailable. */
    discoveryUsable?: boolean;
    discoveryBasis?: string | null;
    conflicts: string[];
    explanation: string;
  };
  facts: PiFact[];
  governmentRecords: PiFact[];
  dueDiligence: PiDueDiligenceItem[];
  comps: {
    policyExplanation: string;
    landPortalUsable: boolean;
    landPortalRowsSeen?: number;
    caps: { zillow: number; redfin: number };
    sold: PiComp[];
    active: PiComp[];
    landHomeOnly: PiComp[];
    rejected: Array<{ address: string | null; source: string; price: number | null; reason: string }>;
    duplicatesMerged: number;
    summaryLine: string;
    /** Priced rows whose publisher never stated whether they closed. */
    askingReferences?: PiComp[];
    /** Held-back rows as counts + one reason each, never one line per row. */
    evidenceBuckets?: Array<{ reason: string; count: number; sources: string[] }>;
    totalCollected?: number;
    conclusion?: 'sold_supported' | 'asking_indication' | 'not_priceable';
    landHomeSearchProof?: {
      status: 'completed' | 'blocked' | 'unavailable' | 'not_run';
      radiusMiles: number;
      timePeriodMonths: number;
      sourcesSearched: string[];
      routesAttempted: string[];
      candidatesReviewed: number;
      qualifyingResults: number;
      exclusionReasons: Array<{ reason: string; count: number }>;
    } | null;
  };
  valuation: {
    priceable: boolean;
    range: { low: number; high: number } | null;
    pricePerAcreRange: { low: number; high: number } | null;
    likelyRetail: { low: number; high: number } | null;
    dispositionRange: { low: number; high: number } | null;
    basis: string;
    adjustments: string[];
    confidence: 'high' | 'medium' | 'low' | 'none';
    uncertainty: string[];
    materialGaps: string[];
    notPriceableReason: string | null;
    nextActionToPrice: string | null;
    /** The one number to work from inside the supported range. */
    workingValue?: number | null;
    /** One line naming the comps the conclusion actually rests on. */
    primaryBasis?: string | null;
  };
  strategies: Array<{
    strategy: string;
    applicability: 'applicable' | 'conditional' | 'blocked' | 'not_applicable';
    supportingFacts: string[];
    blockers: string[];
    effort: string;
    timeline: string;
    valueCreationPath: string;
    risk: string;
    nextVerificationStep: string;
  }>;
  recommendation: {
    preferredStrategy: string | null;
    why: string;
    whatWouldChangeIt: string[];
    posture: 'pursue' | 'hold' | 'renegotiate' | 'reject' | 'undetermined';
    postureWhy: string;
    shouldPursue?: 'yes' | 'with_conditions' | 'no' | 'undetermined';
    worth?: { low: number; high: number; workingValue: number } | null;
    targetBuyRange?: { low: number; high: number; basis: string } | null;
    bestExit?: string | null;
    dealKillers?: string[];
    nextConfirmations?: string[];
    juiceWorthSqueeze?: {
      answer: 'yes' | 'conditional' | 'no' | 'undetermined';
      why: string;
    };
  };
  evidence: Array<{
    id: string;
    kind: 'screenshot' | 'document' | 'map' | 'overlay' | 'source_link' | 'record';
    label: string;
    sourceType: string;
    sourceUrl: string | null;
    viewUrl: string | null;
    retrievedAt: string | null;
    confidence: 'high' | 'medium' | 'low';
    supports: string;
    sha256: string | null;
    bytes: number | null;
    pageCount?: number | null;
    capturedPageCount?: number | null;
    pageViewUrls?: string[];
  }>;
  specialists: PiSpecialist[];
  headline: {
    keyOpportunity: string;
    topRisks: string[];
    confidence: 'high' | 'medium' | 'low' | 'none';
    confidenceWhy: string;
  };
  blockers: string[];
  missingInformation: string[];
  nextActions: string[];
  /** The parent mission this snapshot was assembled from. */
  missionId?: string | null;
  /** What the run did with the browser pages it opened. */
  browserCleanup?: { before: number; after: number; closed: number; note: string } | null;
  /** True only on the in-flight progressive assembly. Never on a promoted snapshot. */
  preliminary?: boolean;
  /** Owner-facing synthesis produced after the evidence lanes join. */
  operatorAnalysis?: PiOperatorAnalysis;
  subjectParcelUrl?: string | null;
  threeDCapture?: { decision: 'eligible' | 'not_applicable' | 'unknown'; averageSlopePercent: number | null; areaAboveTenSlopePercent: number | null; reason: string } | null;
}

/** In-flight progressive content: the partial assembly built as children settle. */
export interface PiProgressive {
  preliminary: true;
  runId: string;
  dealCardId: number;
  sequence: number;
  updatedAt: string;
  settled: string[];
  outstanding: string[];
  snapshot: PiSnapshot;
}

export interface PiSpecialist {
  id: string;
  label: string;
  role: 'required' | 'supporting';
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'blocked' | 'skipped';
  summary: string;
  failureCategory: string | null;
  failureMessage: string | null;
  retryable: boolean;
  evidenceCount: number;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
}

export interface PiRun {
  runId: string;
  sequence: number;
  status: string;
  trigger: string;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  failureCategory: string | null;
  isPrimary: boolean;
}

/** One child mission of the parent Deal Intelligence mission. */
export interface PiMissionChild {
  key: string;
  label: string;
  role: 'required' | 'supporting';
  group: string;
  assignedRole: string;
  agentName: string;
  agentKey: string | null;
  contributionSlot: string;
  status: string;
  summary: string;
  dependsOn: string[];
  awaits?: string[];
  acceptance: { state: string; reason: string } | null;
  provider: { mode: string; providerLabel: string | null; reason: string } | null;
  failureCategory: string | null;
  durationMs: number | null;
}

export interface PiMissionView {
  label: string;
  kind: string;
  mission: {
    missionId: string;
    sequence: number;
    status: string;
    trigger: string;
    outcome: string | null;
    startedAt: string;
    completedAt: string | null;
    error: string | null;
    failureCategory: string | null;
  };
  children: PiMissionChild[];
  join: {
    status: string;
    outcome: string;
    contributed: string[];
    accepted: string[];
    incomplete: string[];
    requiredGaps: Array<{ key: string; label: string; status: string; reason: string }>;
    allTerminal: boolean;
  } | null;
  history: Array<{ missionId: string; sequence: number; status: string; startedAt: string; completedAt: string | null }>;
}

export interface PropertyIntelligenceView {
  snapshot: PiSnapshot | null;
  hermesLandPortal?: {
    runId: string;
    dealCardId: number;
    propertyCardId: number;
    address: string;
    status: 'running' | 'exact_match' | 'context_only' | 'no_match' | 'failed';
    startedAt: string;
    completedAt: string | null;
    note: string;
    workUnits: Array<{
      workUnitId: string;
      specialist: 'subject' | 'comps' | 'visuals';
      label: string;
      status: 'running' | 'exact_match' | 'context_only' | 'no_match' | 'failed';
      startedAt: string;
      completedAt: string | null;
      runtimeMs: number | null;
      note: string;
      persistedCategory: {
        category: 'subject' | 'comps' | 'visuals';
        persistedAt: string;
        itemCount: number;
        rejectedItemCount: number;
        error: string | null;
      } | null;
    }>;
    persistedCategories: Array<{
      category: 'subject' | 'comps' | 'visuals';
      persistedAt: string;
      itemCount: number;
      rejectedItemCount: number;
      error: string | null;
    }>;
  } | null;
  subjectParcel?: {
    url: string;
    source: string;
    capturedAt: string;
    propertyCardId: number;
    dealCardId: number;
    verifiedSubject: boolean;
    apn: string | null;
    threeDCapture?: { decision: 'eligible' | 'not_applicable' | 'unknown'; averageSlopePercent: number | null; areaAboveTenSlopePercent: number | null; reason: string } | null;
  } | null;
  /** In-flight progressive content while a run is running; null otherwise. */
  progressive?: PiProgressive | null;
  providerResearch?: {
    contractVersion: string;
    propertyCardId: number;
    updatedAt: string;
    lanes: Array<{
      laneId: string;
      providerId: string;
      retainedStatus: string;
      latestAttemptStatus: string;
      latestAttemptAt: string;
      latestFailureReason: string | null;
      durationMs: number;
    }>;
    acceptedEvidenceCount: number;
    acceptedEvidence?: Array<{
      id: string;
      field: string;
      value: unknown;
      kind: 'fact' | 'visual' | 'comp' | 'estimate' | 'status';
      subjectClassification: 'verified_subject' | 'context_only' | 'no_match';
      sourceUrl: string | null;
      retrievedAt: string;
    }>;
    rejectedEvidenceCount: number;
    rejectedEvidence: Array<{ evidenceId: string; laneId: string; providerId: string; reason: string }>;
  } | null;
  /** The parent mission behind the snapshot and the run in flight. */
  mission: PiMissionView | null;
  run: PiRun | null;
  specialists: PiSpecialist[];
  history: Array<{ runId: string; sequence: number; status: string; startedAt: string; completedAt: string | null; isPrimary: boolean }>;
}

// ── Data hook ───────────────────────────────────────────────────────────────

export interface PropertyIntelligenceState {
  view: PropertyIntelligenceView | null;
  loading: boolean;
  launching: boolean;
  error: string | null;
  running: boolean;
  launch: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function usePropertyIntelligence(dealId: number | null | undefined): PropertyIntelligenceState {
  const [view, setView] = useState<PropertyIntelligenceView | null>(null);
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!dealId) return;
    setLoading(true);
    try {
      const response = await apiGet<{ propertyIntelligence: PropertyIntelligenceView }>(`/api/landos/deal-cards/${dealId}/property-intelligence`);
      setView(response.propertyIntelligence);
      setError(null);
    } catch (err) {
      setError((err as Error)?.message ?? 'Could not load Property Intelligence.');
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const running = view?.run?.status === 'running' || view?.hermesLandPortal?.status === 'running';

  // Poll while a mission is in flight so the operator watches real progress.
  useEffect(() => {
    if (!dealId || !running) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = setInterval(() => { void refresh(); }, 3000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [dealId, running, refresh]);

  const launch = useCallback(async () => {
    if (!dealId) return;
    setLaunching(true);
    setError(null);
    try {
      const response = await apiPost<{ propertyIntelligence: PropertyIntelligenceView }>(`/api/landos/deal-cards/${dealId}/property-intelligence/run`, {});
      setView(response.propertyIntelligence);
    } catch (err) {
      setError((err as Error)?.message ?? 'Property Intelligence could not start.');
    } finally {
      setLaunching(false);
    }
  }, [dealId]);

  return { view, loading, launching, error, running, launch, refresh };
}

// ── Presentation helpers ────────────────────────────────────────────────────

const GRADE_LABEL: Record<EvidenceGradeView, string> = {
  confirmed_fact: 'Confirmed fact',
  likely_indication: 'Likely indication',
  unresolved_question: 'Unresolved',
  unavailable_public_record: 'No public record',
  post_contract_verification: 'Post-contract legal check',
};

const GRADE_TONE: Record<EvidenceGradeView, string> = {
  confirmed_fact: 'border-emerald-500/40 text-emerald-400',
  likely_indication: 'border-sky-500/40 text-sky-400',
  unresolved_question: 'border-amber-500/40 text-amber-400',
  unavailable_public_record: 'border-zinc-500/40 text-zinc-400',
  post_contract_verification: 'border-violet-500/40 text-violet-400',
};

const STATUS_TONE: Record<PiSpecialist['status'], string> = {
  queued: 'border-zinc-500/40 text-zinc-400',
  running: 'border-sky-500/40 text-sky-400',
  completed: 'border-emerald-500/40 text-emerald-400',
  partial: 'border-amber-500/40 text-amber-400',
  failed: 'border-rose-500/40 text-rose-400',
  blocked: 'border-orange-500/40 text-orange-400',
  skipped: 'border-zinc-500/40 text-zinc-400',
};

const VERDICT_TONE: Record<PiDueDiligenceItem['verdict'], string> = {
  good: 'border-emerald-500/40 text-emerald-400',
  caution: 'border-amber-500/40 text-amber-400',
  risk: 'border-rose-500/40 text-rose-400',
  unknown: 'border-zinc-500/40 text-zinc-400',
};

const APPLICABILITY_TONE: Record<string, string> = {
  applicable: 'border-emerald-500/40 text-emerald-400',
  conditional: 'border-amber-500/40 text-amber-400',
  blocked: 'border-rose-500/40 text-rose-400',
  not_applicable: 'border-zinc-500/40 text-zinc-400',
};

function Tag({ tone, children }: { tone: string; children: any }) {
  return <span class={`inline-flex shrink-0 items-center rounded border px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wide ${tone}`}>{children}</span>;
}

function Card({ title, right, children }: { title: string; right?: any; children: any }) {
  return (
    <div class="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text)]">{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div class="text-[11px] leading-relaxed text-[var(--color-text-faint)]">{text}</div>;
}

function Bullets({ rows, tone }: { rows: string[]; tone?: string }) {
  if (!rows.length) return null;
  return (
    <ul class="space-y-1">
      {rows.map((row, index) => (
        <li key={index} class={`relative pl-3 text-[11px] leading-relaxed ${tone ?? 'text-[var(--color-text-muted)]'}`}>
          <span class="absolute left-0 top-[7px] h-1 w-1 rounded-full bg-[var(--color-text-faint)]" />
          {row}
        </li>
      ))}
    </ul>
  );
}

function conciseUnique(rows: Array<string | null | undefined>, limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of rows) {
    const value = raw?.trim();
    if (!value) continue;
    const key = value
      .toLowerCase()
      .replace(/^[^:]{1,72}:\s+(?:partial result\s+[—-]\s+|blocked\s+[—-]\s+)?/u, '')
      .replace(/\s+/gu, ' ')
      .replace(/[.?!]+$/gu, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function materialLimitations(snapshot: PiSnapshot): string[] {
  const diligence = snapshot.dueDiligence
    .filter((item) => item.verdict === 'risk' || item.verdict === 'unknown')
    .map((item) => `${item.label}: ${item.headline}`);
  return conciseUnique([
    ...snapshot.headline.topRisks,
    ...snapshot.blockers,
    ...snapshot.valuation.materialGaps,
    ...diligence,
  ], 6);
}

function conciseNextActions(snapshot: PiSnapshot): string[] {
  return conciseUnique([
    ...snapshot.nextActions,
    snapshot.valuation.nextActionToPrice,
    ...(snapshot.recommendation.nextConfirmations ?? []),
  ], 4);
}

const money = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? `$${Math.round(value).toLocaleString()}` : '—';

const range = (band: { low: number; high: number } | null): string =>
  band ? `${money(band.low)} – ${money(band.high)}` : '—';

function NoSnapshot({ label }: { label: string }) {
  return (
    <Empty text={`No Property Intelligence snapshot exists for this Deal Card yet, so nothing is asserted about ${label}. Run Property Intelligence from the Overview tab to build it.`} />
  );
}

/**
 * Preliminary marking for in-flight progressive content. Rendered at the top of
 * every section fed by a partial assembly, so mid-flight data is never mistaken
 * for the joined snapshot.
 */
function PreliminaryNotice({ snapshot }: { snapshot: PiSnapshot }) {
  if (!snapshot.preliminary) return null;
  return (
    <div data-testid="pi-preliminary" class="rounded-md border border-sky-500/40 bg-sky-500/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-sky-300">
      <span class="font-semibold uppercase tracking-wide">Preliminary</span> — the mission is still
      running. Only the specialist lanes that have settled so far are shown; lanes still in flight are
      listed under missing information. The final snapshot replaces this view when the mission joins,
      and nothing shown here is promoted until then.
    </div>
  );
}

// ── Launch + progress ───────────────────────────────────────────────────────

const ACCEPTANCE_TONE: Record<string, string> = {
  accepted: 'border-emerald-500/40 text-emerald-400',
  incomplete: 'border-amber-500/40 text-amber-400',
  blocked: 'border-orange-500/40 text-orange-400',
  rejected: 'border-rose-500/40 text-rose-400',
  failed: 'border-rose-500/40 text-rose-400',
  not_evaluated: 'border-zinc-500/40 text-zinc-400',
};

/**
 * The parent mission behind the snapshot.
 *
 * Shown so the operator can see that Run Property Intelligence started ONE
 * parent mission with named specialist children, and exactly which handback each
 * child routed into the snapshot — rather than having to trust that it did.
 */
function ParentMissionPanel({ mission }: { mission: PiMissionView | null }) {
  if (!mission) {
    return (
      <div data-testid="pi-parent-mission-empty" class="mt-3 text-[11px] text-[var(--color-text-faint)]">
        No parent mission has run for this Deal Card yet, so no child mission has been dispatched.
      </div>
    );
  }
  const { children, join } = mission;
  const settled = children.filter((child) => !['queued', 'running'].includes(child.status)).length;
  return (
    <div data-testid="pi-parent-mission" class="mt-3 rounded border border-[var(--color-border)] p-2">
      <div class="flex flex-wrap items-center gap-2">
        <Tag tone={mission.mission.status === 'joined' ? STATUS_TONE.completed : mission.mission.status === 'failed' ? STATUS_TONE.failed : mission.mission.status === 'running' ? STATUS_TONE.running : STATUS_TONE.partial}>
          {mission.mission.status.replace(/_/g, ' ')}
        </Tag>
        <span class="text-[11px] font-semibold text-[var(--color-text)]">Parent mission #{mission.mission.sequence}</span>
        <span class="font-mono text-[10px] text-[var(--color-text-faint)]">{mission.mission.missionId}</span>
        <span class="text-[10px] text-[var(--color-text-faint)]">{settled}/{children.length} child missions settled</span>
        {join && (
          <span class="text-[10px] text-[var(--color-text-faint)]">
            {join.accepted.length} accepted · {join.incomplete.length} incomplete
          </span>
        )}
      </div>
      {(mission.mission.outcome || join?.outcome) && (
        <div data-testid="pi-mission-outcome" class="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
          {mission.mission.outcome ?? join?.outcome}
        </div>
      )}
      <div data-testid="pi-mission-children" class="mt-2 space-y-1">
        {children.map((child) => (
          <div key={child.key} data-testid={`pi-mission-child-${child.key}`} class="rounded border border-[var(--color-border)] px-2 py-1">
            <div class="flex flex-wrap items-center gap-1.5">
              <Tag tone={STATUS_TONE[child.status as PiSpecialist['status']] ?? STATUS_TONE.queued}>{child.status}</Tag>
              <span class="text-[11px] font-semibold text-[var(--color-text)]">{child.label}</span>
              {child.role === 'supporting' && <Tag tone="border-zinc-500/40 text-zinc-400">supporting</Tag>}
              <Tag tone={ACCEPTANCE_TONE[child.acceptance?.state ?? 'not_evaluated']}>
                {(child.acceptance?.state ?? 'not evaluated').replace(/_/g, ' ')}
              </Tag>
            </div>
            <div class="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--color-text-faint)]">
              <span>group: {child.group}</span>
              <span>specialist: {child.agentName}</span>
              <span>slot: {child.contributionSlot}</span>
              <span>provider: {child.provider?.providerLabel ?? child.provider?.mode ?? 'not resolved'}</span>
              {child.dependsOn.length > 0 && <span>needs: {child.dependsOn.join(', ')}</span>}
              {(child.awaits?.length ?? 0) > 0 && <span>waits for: {child.awaits!.join(', ')}</span>}
              {child.durationMs != null && <span>{(child.durationMs / 1000).toFixed(1)}s</span>}
            </div>
            <div class="mt-0.5 text-[10.5px] leading-relaxed text-[var(--color-text-muted)]">
              {child.acceptance?.state === 'rejected' ? child.acceptance.reason : child.summary}
            </div>
          </div>
        ))}
      </div>
      {join && join.requiredGaps.length > 0 && (
        <div class="mt-2">
          <div class="text-[9px] font-semibold uppercase tracking-wide text-amber-400">Required contributions missing</div>
          <Bullets rows={join.requiredGaps.map((gap) => `${gap.label} (${gap.status}): ${gap.reason}`)} tone="text-amber-300" />
        </div>
      )}
    </div>
  );
}

export function PropertyIntelligenceLaunch({ state }: { state: PropertyIntelligenceState }) {
  const { view, running, launching, error, launch } = state;
  const run = view?.run ?? null;
  const specialists = view?.specialists ?? [];
  const done = specialists.filter((s) => s.status !== 'queued' && s.status !== 'running').length;

  return (
    <div data-testid="pi-launch" class="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-[12px] font-semibold text-[var(--color-text)]">Property Intelligence</div>
          <div class="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
            Refresh parcel, government, zoning, environmental, utility, access, comparable-sale,
            market, visual, valuation, and exit-strategy evidence for this Deal Card.
          </div>
        </div>
        <button
          type="button"
          data-testid="pi-run-button"
          disabled={running || launching}
          onClick={() => { void launch(); }}
          class="shrink-0 rounded border border-[var(--color-accent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-accent)] disabled:opacity-50"
        >
          {running ? 'Running…' : launching ? 'Starting…' : view?.snapshot ? 'Re-run Property Intelligence' : 'Run Property Intelligence'}
        </button>
      </div>

      {error && <div data-testid="pi-error" class="mt-2 rounded border border-rose-500/40 px-2 py-1 text-[11px] text-rose-400">{error}</div>}

      {run && (
        <div class="mt-3">
          <div class="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
            <Tag tone={run.status === 'running' ? STATUS_TONE.running : run.status === 'failed' ? STATUS_TONE.failed : run.status === 'complete' ? STATUS_TONE.completed : STATUS_TONE.partial}>
              {run.status.replace(/_/g, ' ')}
            </Tag>
            <span>{done}/{specialists.length} research areas finished</span>
            {run.failureCategory && <Tag tone={STATUS_TONE.failed}>{run.failureCategory}</Tag>}
          </div>
          {run.error && <div class="mt-1 text-[11px] text-rose-400">{run.error}</div>}

          {(running || launching) ? (
            <div data-testid="pi-specialists" class="mt-2 space-y-1">
              {specialists.map((specialist) => (
                <div key={specialist.id} data-testid={`pi-specialist-${specialist.id}`} class="flex flex-wrap items-start gap-2 rounded border border-[var(--color-border)] px-2 py-1">
                  <Tag tone={STATUS_TONE[specialist.status]}>{specialist.status}</Tag>
                  <span class="text-[11px] font-semibold text-[var(--color-text)]">{specialist.label}</span>
                  {specialist.role === 'supporting' && <Tag tone="border-zinc-500/40 text-zinc-400">supporting</Tag>}
                  {specialist.failureCategory && <Tag tone={STATUS_TONE.failed}>{specialist.failureCategory}</Tag>}
                  <span class="min-w-0 flex-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                    {specialist.failureMessage ?? specialist.summary}
                  </span>
                  {specialist.durationMs != null && (
                    <span class="shrink-0 text-[10px] text-[var(--color-text-faint)]">{(specialist.durationMs / 1000).toFixed(1)}s</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <details data-testid="pi-specialists" class="mt-2 rounded border border-[var(--color-border)] px-2 py-1.5">
              <summary class="cursor-pointer text-[11px] font-semibold text-[var(--color-text-muted)]">
                Research coverage and source limitations
              </summary>
              <div class="mt-2 space-y-1">
                {specialists.map((specialist) => (
                  <div key={specialist.id} data-testid={`pi-specialist-${specialist.id}`} class="flex flex-wrap items-start gap-2 rounded border border-[var(--color-border)] px-2 py-1">
                    <Tag tone={STATUS_TONE[specialist.status]}>{specialist.status}</Tag>
                    <span class="text-[11px] font-semibold text-[var(--color-text)]">{specialist.label}</span>
                    <span class="min-w-0 flex-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                      {specialist.failureMessage ?? specialist.summary}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      {view?.hermesLandPortal && (
        <div data-testid="pi-hermes-incremental-status" class="mt-2 rounded border border-sky-500/30 bg-sky-500/5 px-2.5 py-2 text-[10.5px]">
          <div class="flex flex-wrap items-center gap-1.5">
            <Tag tone={view.hermesLandPortal.status === 'failed' ? STATUS_TONE.failed : view.hermesLandPortal.status === 'running' ? STATUS_TONE.running : STATUS_TONE.completed}>
              {view.hermesLandPortal.status.replace(/_/g, ' ')}
            </Tag>
            <span class="font-semibold text-[var(--color-text)]">Hermes · {view.hermesLandPortal.address}</span>
          </div>
          <div class="mt-1 text-[var(--color-text-muted)]">{view.hermesLandPortal.note}</div>
          {!!view.hermesLandPortal.workUnits?.length && (
            <div class="mt-1.5 grid gap-1 md:grid-cols-3" data-testid="pi-hermes-specialist-work-units">
              {view.hermesLandPortal.workUnits.map((unit) => (
                <div key={unit.workUnitId} data-testid={`pi-hermes-specialist-${unit.specialist}`} class="rounded border border-sky-500/20 px-2 py-1">
                  <div class="flex flex-wrap items-center gap-1">
                    <Tag tone={unit.status === 'failed' ? STATUS_TONE.failed : unit.status === 'running' ? STATUS_TONE.running : unit.status === 'exact_match' ? STATUS_TONE.completed : STATUS_TONE.partial}>
                      {unit.status.replace(/_/g, ' ')}
                    </Tag>
                    <span class="font-semibold text-sky-100">{unit.specialist}</span>
                  </div>
                  <div class="mt-0.5 text-[var(--color-text-muted)]">{unit.note}</div>
                  <div class="mt-0.5 text-[var(--color-text-faint)]">
                    started {new Date(unit.startedAt).toLocaleString()}
                    {unit.completedAt ? ` · completed ${new Date(unit.completedAt).toLocaleString()}` : ''}
                    {unit.persistedCategory ? ` · persisted ${new Date(unit.persistedCategory.persistedAt).toLocaleString()}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
          {!!view.hermesLandPortal.persistedCategories.length && (
            <div class="mt-1 space-y-0.5" data-testid="pi-hermes-persisted-categories">
              {view.hermesLandPortal.persistedCategories.map((result) => (
                <div key={result.category}>
                  <span class="font-semibold text-sky-200">{result.category}</span>
                  {' · '}{result.itemCount} item(s) persisted {new Date(result.persistedAt).toLocaleString()}
                  {result.rejectedItemCount ? ` · ${result.rejectedItemCount} rejected` : ''}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {view?.providerResearch && (
        <details open={!!view.hermesLandPortal || view.providerResearch.lanes.some((lane) => lane.providerId === 'hermes_landportal_import')} data-testid="pi-provider-lanes" class="mt-2 rounded border border-[var(--color-border)] px-2 py-1.5">
          <summary class="cursor-pointer text-[11px] font-semibold text-[var(--color-text-muted)]">
            Provider lanes · {view.providerResearch.lanes.length} · {view.providerResearch.acceptedEvidenceCount} accepted evidence item(s)
          </summary>
          <div class="mt-2 space-y-1">
            {view.providerResearch.lanes.map((lane) => (
              <div key={lane.laneId} class="rounded border border-[var(--color-border)] px-2 py-1 text-[10.5px]">
                <div class="flex flex-wrap items-center gap-1.5">
                  <Tag tone={lane.latestAttemptStatus === 'failed' || lane.latestAttemptStatus === 'unavailable' ? STATUS_TONE.failed : lane.latestAttemptStatus === 'verified' ? STATUS_TONE.completed : STATUS_TONE.partial}>
                    {lane.latestAttemptStatus.replace(/_/g, ' ')}
                  </Tag>
                  <span class="font-semibold text-[var(--color-text)]">{lane.laneId.replace(/_/g, ' ')}</span>
                  <span class="text-[var(--color-text-faint)]">{lane.providerId}</span>
                  <span class="ml-auto text-[var(--color-text-faint)]">persisted {new Date(lane.latestAttemptAt).toLocaleString()} · {(lane.durationMs / 1000).toFixed(1)}s</span>
                </div>
                {lane.retainedStatus !== lane.latestAttemptStatus && (
                  <div class="mt-0.5 text-[var(--color-text-muted)]">Retained stronger result: {lane.retainedStatus.replace(/_/g, ' ')}</div>
                )}
                {lane.latestFailureReason && <div class="mt-0.5 text-rose-400">{lane.latestFailureReason}</div>}
              </div>
            ))}
            {(view.providerResearch.acceptedEvidence?.length ?? 0) > 0 && (
              <div data-testid="pi-provider-accepted-evidence" class="mt-2 space-y-1 border-t border-[var(--color-border)] pt-2">
                <div class="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Persisted provider results</div>
                {(view.providerResearch.acceptedEvidence ?? []).map((item) => {
                  const shown = item.value && typeof item.value === 'object'
                    ? Object.entries(item.value as Record<string, unknown>).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')
                    : String(item.value ?? '');
                  return (
                    <div key={item.id} data-testid={`pi-provider-evidence-${item.kind}`} class="rounded border border-[var(--color-border)] px-2 py-1 text-[10.5px]">
                      <div class="flex flex-wrap items-center gap-1.5">
                        <Tag tone={item.subjectClassification === 'verified_subject' ? STATUS_TONE.completed : STATUS_TONE.partial}>{item.kind}</Tag>
                        <span class="font-semibold text-[var(--color-text)]">{item.field.replace(/[_\.]/g, ' ')}</span>
                        <span class="ml-auto text-[var(--color-text-faint)]">{new Date(item.retrievedAt).toLocaleString()}</span>
                      </div>
                      <div class="mt-0.5 break-words text-[var(--color-text-muted)]">{shown}</div>
                    </div>
                  );
                })}
              </div>
            )}
            {view.providerResearch.rejectedEvidenceCount > 0 && (
              <div class="text-[10px] text-amber-300">
                {view.providerResearch.rejectedEvidenceCount} evidence item(s) rejected by scope, strength, or validation rules.
              </div>
            )}
          </div>
        </details>
      )}
      {!run && !running && (
        <div class="mt-2 text-[11px] text-[var(--color-text-faint)]">
          Not run yet for this Deal Card. Nothing is asserted until it runs.
        </div>
      )}

    </div>
  );
}

export function PropertyIntelligenceHistory({ view }: { view: PropertyIntelligenceView | null }) {
  const rows = view?.history ?? [];
  return (
    <details class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3">
      <summary class="cursor-pointer text-[10.5px] font-semibold text-[var(--color-text-muted)]">
        Research history{rows.length ? ` · ${rows.length} update${rows.length === 1 ? '' : 's'}` : ''}
      </summary>
      <div class="mt-3">
        {rows.length ? (
          <div data-testid="pi-run-history" class="space-y-1">
            {rows.map((row) => (
              <div key={row.runId} class="flex flex-wrap items-center gap-2 rounded border border-[var(--color-border)] px-2 py-1.5 text-[11px]">
                <Tag tone={row.isPrimary ? STATUS_TONE.completed : row.status === 'failed' ? STATUS_TONE.failed : STATUS_TONE.partial}>
                  {row.isPrimary ? 'Current research' : row.status.replace(/_/g, ' ')}
                </Tag>
                <span class="text-[var(--color-text-muted)]">Property research update</span>
                <span class="ml-auto text-[10px] text-[var(--color-text-faint)]">
                  {row.completedAt ? row.completedAt.slice(0, 16).replace('T', ' ') : `Started ${row.startedAt.slice(0, 16).replace('T', ' ')}`}
                </span>
              </div>
            ))}
          </div>
        ) : <Empty text="No property research update has been recorded yet." />}
      </div>
    </details>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────

export function PropertyIntelligenceOverview({ snapshot }: { snapshot: PiSnapshot | null }) {
  if (!snapshot) return <NoSnapshot label="this property" />;
  const { identity, headline, recommendation, valuation } = snapshot;
  const limitations = materialLimitations(snapshot);
  const nextActions = conciseNextActions(snapshot);
  return (
    <div data-testid="pi-overview" class="space-y-3">
      <PreliminaryNotice snapshot={snapshot} />
      <Card
        title="Property Intelligence"
        right={
          <div class="flex flex-wrap items-center gap-1.5">
            <Tag tone={snapshot.status === 'complete' ? STATUS_TONE.completed : snapshot.status === 'failed' ? STATUS_TONE.failed : STATUS_TONE.partial}>
              {snapshot.status.replace(/_/g, ' ')}
            </Tag>
            <Tag tone={headline.confidence === 'high' ? STATUS_TONE.completed : headline.confidence === 'none' ? STATUS_TONE.failed : STATUS_TONE.partial}>
              {headline.confidence} confidence
            </Tag>
            <Tag tone="border-zinc-500/40 text-zinc-400">run #{snapshot.sequence}</Tag>
          </div>
        }
      >
        <dl class="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          <Field label="Identity" value={identity.state} tone={identity.state === 'confirmed' ? VERDICT_TONE.good : VERDICT_TONE.risk} />
          <Field label="APN" value={identity.apn ?? '—'} />
          <Field label="Owner" value={identity.owner ?? '—'} />
          <Field label="Acreage" value={identity.acres == null ? '—' : `${identity.acres.toFixed(2)} ac`} />
          <Field label="County" value={[identity.county, identity.state_].filter(Boolean).join(', ') || '—'} />
          <Field label="Value band" value={valuation.priceable ? range(valuation.range) : 'Not priceable'} />
        </dl>
        <div class="mt-2 text-[11px] leading-relaxed text-[var(--color-text-muted)]">{headline.confidenceWhy}</div>
        {/* Provenance: which parent mission produced the snapshot the card is
            reading. Without it, "the Deal Card reads the current snapshot" is a
            claim the operator has to take on trust. */}
        <div data-testid="pi-snapshot-source" class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--color-text-faint)]">
          <span>{snapshot.preliminary ? 'Preliminary assembly' : 'Current snapshot'} · run #{snapshot.sequence}</span>
          {snapshot.missionId && <span class="font-mono">parent mission {snapshot.missionId}</span>}
          <span>{snapshot.preliminary ? 'in-flight partial — never promoted' : snapshot.isPrimary ? 'primary read for this Deal Card' : 'historical attempt — not the current read'}</span>
          {snapshot.completedAt && <span>completed {snapshot.completedAt.slice(0, 19).replace('T', ' ')}</span>}
        </div>
        {snapshot.browserCleanup && (
          <div data-testid="pi-browser-cleanup" class="mt-1 text-[10px] leading-relaxed text-[var(--color-text-faint)]">
            Browser cleanup: {snapshot.browserCleanup.note}
          </div>
        )}
      </Card>

      <Card title="Mission summary">
        <div data-testid="pi-mission-summary" class="text-[11px] leading-relaxed text-[var(--color-text)]">{headline.keyOpportunity}</div>
        {recommendation.preferredStrategy && (
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <Tag tone={APPLICABILITY_TONE.applicable}>{recommendation.preferredStrategy}</Tag>
            <Tag tone={recommendation.posture === 'pursue' ? STATUS_TONE.completed : STATUS_TONE.partial}>{recommendation.posture}</Tag>
            <span class="min-w-0 flex-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">{recommendation.postureWhy}</span>
          </div>
        )}
      </Card>

      <div class="grid gap-3 lg:grid-cols-2">
        <Card title="Risks and limitations">
          {limitations.length ? <Bullets rows={limitations} tone="text-amber-300" /> : <Empty text="No material risk was found in the lanes that ran. Source-specific details remain available in the evidence drill-down." />}
        </Card>
        <Card title="Next action">
          {nextActions.length ? <Bullets rows={nextActions} /> : <Empty text="No material next action is outstanding." />}
        </Card>
      </div>
    </div>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div class="min-w-0">
      <dt class="text-[9px] uppercase tracking-wide text-[var(--color-text-faint)]">{label}</dt>
      <dd class={`break-words text-[11px] font-semibold leading-relaxed ${tone ? tone.split(' ').filter((c) => c.startsWith('text-')).join(' ') : 'text-[var(--color-text)]'}`}>{value}</dd>
    </div>
  );
}

// ── Property ────────────────────────────────────────────────────────────────

export function PropertyIntelligenceProperty({ snapshot }: { snapshot: PiSnapshot | null }) {
  if (!snapshot) return <NoSnapshot label="the parcel record" />;
  const { identity } = snapshot;
  const governmentAttempts = (snapshot.operatorAnalysis?.researchAttempts ?? [])
    .filter((attempt) => attempt.attemptCount > 0 && attempt.status !== 'not_run');
  const identityLabel = identity.state === 'provisional' && identity.discoveryUsable
    ? 'Discovery match'
    : identity.state.replace(/_/g, ' ');
  return (
    <div data-testid="pi-property" class="space-y-3">
      <PreliminaryNotice snapshot={snapshot} />
      <Card
        title="Parcel identity"
        right={<Tag tone={identity.state === 'confirmed' ? VERDICT_TONE.good : identity.state === 'provisional' ? VERDICT_TONE.caution : VERDICT_TONE.risk}>{identityLabel}</Tag>}
      >
        <div class="text-[11px] leading-relaxed text-[var(--color-text-muted)]">{identity.explanation}</div>
        {identity.apnVariants.length > 1 && (
          <div class="mt-2 text-[11px] text-amber-300">
            {identity.apnVariants.length} distinct parcel identifiers are attached: {identity.apnVariants.join(' · ')}.
          </div>
        )}
        {identity.conflicts.length > 0 && (
          <div class="mt-2">
            <div class="text-[10px] font-semibold uppercase tracking-wide text-rose-400">Unresolved conflicts</div>
            <Bullets rows={identity.conflicts} tone="text-rose-300" />
          </div>
        )}
      </Card>

      <Card title="Reconciled parcel facts">
        {snapshot.facts.length ? <FactTable facts={snapshot.facts} /> : <Empty text="No reconciled parcel fact was retained by this run." />}
      </Card>

      <Card
        title="Government records"
        right={(
          <div class="flex items-center gap-2">
            <AssessorTaxRerun dealCardId={snapshot.dealCardId} />
            <Tag tone="border-zinc-500/40 text-zinc-400">{snapshot.governmentRecords.length}</Tag>
          </div>
        )}
      >
        {snapshot.governmentRecords.length
          ? <FactTable facts={snapshot.governmentRecords} />
          : <Empty text="No recorded-government evidence has been retrieved for this parcel. Deed, tax and ownership records remain unretrieved rather than assumed." />}
      </Card>

      {!snapshot.governmentRecords.length && governmentAttempts.length > 0 && (
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-[10.5px] leading-relaxed text-[var(--color-text-muted)]">
          Government research ran, but no subject-correlated fact was retrieved. Source attempts remain supporting audit history and are not presented as findings.
        </div>
      )}
    </div>
  );
}

/**
 * Rerun Assessor & Tax for the Deal Card's EXISTING canonical subject.
 *
 * This is the same LandOS Capability that Tools and New Lead invoke. It reads
 * the assessor and taxing-jurisdiction record for the subject the Deal Card
 * already has; it never resolves, replaces, or reassigns property identity.
 */
function AssessorTaxRerun({ dealCardId }: { dealCardId: number }) {
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const run = useCallback(async () => {
    if (!dealCardId || running) return;
    setRunning(true);
    setFailed(false);
    setNote(null);
    try {
      const response = await apiPost<{
        result: {
          subjectResolution: string;
          facts: { summary?: string; recordStatus?: string };
        };
      }>(`/api/landos/deal-cards/${dealCardId}/assessor-tax`, { refresh: true });
      setNote(response.result.facts?.summary ?? `Assessor & Tax returned ${response.result.subjectResolution}.`);
    } catch (error) {
      setFailed(true);
      setNote((error as Error)?.message ?? 'Assessor & Tax could not run.');
    } finally {
      setRunning(false);
    }
  }, [dealCardId, running]);

  return (
    <span class="flex items-center gap-2">
      {note && (
        <span
          class={`max-w-[280px] truncate text-[10px] ${failed ? 'text-rose-300' : 'text-[var(--color-text-muted)]'}`}
          data-testid="assessor-tax-rerun-note"
          title={note}
        >
          {note}
        </span>
      )}
      <button
        type="button"
        data-testid="assessor-tax-rerun"
        disabled={running}
        onClick={() => { void run(); }}
        class="rounded-md border border-[var(--color-border)] px-2 py-1 text-[10px] font-semibold text-[var(--color-text)] disabled:opacity-50"
      >
        {running ? 'Reading assessor record…' : 'Rerun Assessor & Tax'}
      </button>
    </span>
  );
}

function FactTable({ facts }: { facts: PiFact[] }) {
  return (
    <div class="overflow-x-auto">
      <table class="w-full min-w-[520px] border-collapse text-[11px]">
        <tbody>
          {facts.map((fact) => (
            <tr key={fact.key} class="border-b border-[var(--color-border)] last:border-0 align-top">
              <td class="w-[30%] py-1.5 pr-2 text-[var(--color-text-faint)]">{fact.label}</td>
              <td class="py-1.5 pr-2 text-[var(--color-text)]">
                {fact.value ?? '—'}
                {fact.note && <div class="text-[10px] leading-relaxed text-[var(--color-text-faint)]">{fact.note}</div>}
              </td>
              <td class="w-[1%] whitespace-nowrap py-1.5 pr-2"><Tag tone={GRADE_TONE[fact.grade]}>{GRADE_LABEL[fact.grade]}</Tag></td>
              <td class="w-[1%] whitespace-nowrap py-1.5 text-[10px] text-[var(--color-text-faint)]">
                {fact.sourceUrl
                  ? <a href={fact.sourceUrl} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">{fact.source ?? 'source'}</a>
                  : (fact.source ?? '')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Due diligence ───────────────────────────────────────────────────────────

export function PropertyIntelligenceDueDiligence({ snapshot }: { snapshot: PiSnapshot | null }) {
  if (!snapshot) return <NoSnapshot label="due diligence" />;
  if (!snapshot.dueDiligence.length) {
    return (
      <div class="space-y-2">
        <PreliminaryNotice snapshot={snapshot} />
        <Empty text={snapshot.preliminary
          ? 'No due-diligence lane has settled with a finding yet. Nothing is claimed as screened while the mission runs.'
          : 'No due-diligence lane produced a finding in this run. Nothing is claimed as screened.'} />
      </div>
    );
  }
  return (
    <div data-testid="pi-diligence" class="space-y-2">
      <PreliminaryNotice snapshot={snapshot} />
      {snapshot.dueDiligence.map((item) => (
        <div key={item.key} data-testid={`pi-dd-${item.key}`} class="rounded-md border border-[var(--color-border)] p-3">
          <div class="flex flex-wrap items-center gap-2">
            <Tag tone={VERDICT_TONE[item.verdict]}>{item.verdict}</Tag>
            <span class="text-[11px] font-semibold text-[var(--color-text)]">{item.label}</span>
            <Tag tone={GRADE_TONE[item.grade]}>{GRADE_LABEL[item.grade]}</Tag>
            {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" class="text-[10px] text-[var(--color-accent)] underline">source</a>}
          </div>
          <div class="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">{item.headline}</div>
          {item.detail && (item.key === 'septic'
            ? <details class="mt-1">
                <summary class="cursor-pointer text-[10px] font-semibold text-[var(--color-accent)]">Supporting soil research</summary>
                <div class="mt-1 text-[10px] leading-relaxed text-[var(--color-text-faint)]">{item.detail}</div>
              </details>
            : <div class="mt-1 text-[10px] leading-relaxed text-[var(--color-text-faint)]">{item.detail}</div>)}
          {item.missing.length > 0 && (
            <div class="mt-1.5">
              <div class="text-[9px] font-semibold uppercase tracking-wide text-amber-400">Still open</div>
              <Bullets rows={item.missing} tone="text-amber-300" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Market ──────────────────────────────────────────────────────────────────

export function PropertyIntelligenceMarket({ snapshot }: { snapshot: PiSnapshot | null }) {
  if (!snapshot) return <NoSnapshot label="the comparable set or value" />;
  const { comps, valuation } = snapshot;
  const operatorMarket = snapshot.operatorAnalysis?.market;
  const marketScore = snapshot.operatorAnalysis?.scores.market;
  const marketStrength = operatorMarket?.strength ?? 'Uncertain';
  return (
    <div data-testid="pi-market" class="space-y-3">
      <PreliminaryNotice snapshot={snapshot} />
      {operatorMarket && (
        <>
          <div class="grid gap-3 lg:grid-cols-[1.2fr_.8fr]">
            <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-[18px] font-bold text-[var(--color-text)]">{marketStrength} market</span>
                {marketScore?.score != null && (
                  <Tag tone={marketStrength === 'Strong' ? STATUS_TONE.completed : marketStrength === 'Weak' ? STATUS_TONE.failed : STATUS_TONE.partial}>
                    Market score {marketScore.score}/100
                  </Tag>
                )}
              </div>
              <p class="mt-2 text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">{operatorMarket.conclusion}</p>
              <dl class="mt-4 grid gap-3 border-t border-[var(--color-border)] pt-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Buyer demand" value={operatorMarket.buyerDemand} />
                <Field label="Resale difficulty" value={operatorMarket.resaleDifficulty} />
                <Field label="Bulk marketing time" value={operatorMarket.expectedBulkMarketingTime ?? operatorMarket.likelyMarketingTime} />
                <Field label="Smaller-lot marketing time" value={operatorMarket.expectedSmallerLotMarketingTime ?? 'Not established'} />
              </dl>
              {marketScore && (
                <div class="mt-4 grid gap-3 border-t border-[var(--color-border)] pt-3 sm:grid-cols-2">
                  <div>
                    <div class="text-[9px] font-bold uppercase tracking-wide text-emerald-400">What supports the score</div>
                    <Bullets rows={marketScore.strongestPositiveFactors} />
                  </div>
                  <div>
                    <div class="text-[9px] font-bold uppercase tracking-wide text-amber-400">What reduces the score</div>
                    <Bullets rows={marketScore.mainDeductions} />
                  </div>
                </div>
              )}
            </div>
            <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
              <div class="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">Data centers within {operatorMarket.dataCenters.searchedWithinMiles} miles</div>
              <div class="mt-1 text-[13px] font-semibold text-[var(--color-text)]">{operatorMarket.dataCenters.status.replace(/_/g, ' ')}</div>
              <p class="mt-2 text-[11px] leading-relaxed text-[var(--color-text-muted)]">{operatorMarket.dataCenters.summary}</p>
              {operatorMarket.dataCenters.screenshotUrl && (
                <div class="mt-3">
                  <DealImageGallery
                    title="Brockovich data-center map"
                    items={[{
                      id: 'brockovich-data-center-map',
                      label: 'Subject and nearby data-center map',
                      sourceType: 'Brockovich Data Center Map',
                      sourceUrl: operatorMarket.dataCenters.sourceUrl ?? null,
                      viewUrl: operatorMarket.dataCenters.screenshotUrl,
                      retrievedAt: operatorMarket.dataCenters.attemptedAt ?? null,
                      supports: `${operatorMarket.dataCenters.searchedWithinMiles}-mile subject screen with map legend`,
                    }]}
                  />
                </div>
              )}
              {operatorMarket.dataCenters.items.length > 0 && (
                <ul class="mt-2 space-y-1.5">
                  {operatorMarket.dataCenters.items.map((item, index) => (
                    <li key={index} class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-2 text-[10.5px] text-[var(--color-text-muted)]">
                      <div>
                        {item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noreferrer" class="font-semibold text-[var(--color-accent)] underline">{item.name}</a> : <strong class="text-[var(--color-text)]">{item.name}</strong>}
                        {item.distanceMiles != null ? ` · ${item.distanceMiles.toFixed(1)} mi` : ''} · {item.status.replace(/_/g, ' ')}
                      </div>
                      {(item.operatorOrDeveloper || item.location) && <div class="mt-1 break-words text-[9.5px] text-[var(--color-text-faint)]">{[item.operatorOrDeveloper, item.location].filter(Boolean).join(' · ')}</div>}
                      {item.likelyEffect && <div class="mt-1 break-words leading-relaxed">{item.likelyEffect}</div>}
                      {item.downside && <div class="mt-1 break-words leading-relaxed text-amber-300">Possible downside: {item.downside}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {(operatorMarket.internalMetrics.length > 0 || operatorMarket.acreageAndPriceBands.length > 0) && (
            <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
              <div>
                <h3 class="text-[13px] font-bold text-[var(--color-text)]">Market activity at a glance</h3>
                <p class="mt-0.5 text-[10.5px] text-[var(--color-text-muted)]">Current demand, inventory, velocity, and the acreage bands buyers are actually choosing.</p>
              </div>
              <div class="mt-3 grid gap-3 xl:grid-cols-[1.1fr_.9fr]">
                <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {operatorMarket.internalMetrics.map((metric, index) => (
                    <div key={index} class="min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                      <div class="break-words text-[9px] uppercase tracking-wide text-[var(--color-text-faint)]">{metric.label}</div>
                      <div class="mt-1 break-words text-[13px] font-semibold text-[var(--color-text)]">{metric.value}</div>
                    </div>
                  ))}
                </div>
                <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                  <div class="text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">Acreage and price bands</div>
                  <Bullets rows={operatorMarket.acreageAndPriceBands} />
                </div>
              </div>
            </section>
          )}
          {(operatorMarket.acreageBands?.length ?? 0) > 0 && (
            <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 class="text-[13px] font-bold text-[var(--color-text)]">County acreage-band comparison</h3>
                  <p class="mt-0.5 text-[10.5px] leading-relaxed text-[var(--color-text-muted)]">Seven retained native LandOS Market Research bands, compared side by side before the deal strategy is ranked.</p>
                </div>
                {(operatorMarket.bestMovingAcreageBands?.length ?? 0) > 0 && <Tag tone={STATUS_TONE.completed}>Fastest: {operatorMarket.bestMovingAcreageBands![0]}</Tag>}
              </div>
              <div class="mt-3 grid min-w-0 gap-2 lg:grid-cols-4 xl:grid-cols-7">
                {operatorMarket.acreageBands!.map((band) => (
                  <article key={band.label} class="min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                    <div class="flex flex-wrap items-start justify-between gap-1">
                      <div class="text-[11px] font-bold text-[var(--color-text)]">{band.label}</div>
                      <span class="text-[9px] text-[var(--color-text-faint)]">{band.movementRank == null ? 'Not ranked' : `#${band.movementRank} movement`}</span>
                    </div>
                    <dl class="mt-2 space-y-1.5">
                      <Field label="Sold / active" value={`${band.soldCount} / ${band.activeCount}`} />
                      <Field label="Median price" value={money(band.medianSalePrice)} />
                      <Field label="Median / acre" value={money(band.medianSoldPricePerAcre)} />
                      <Field label="Median DOM" value={band.medianDaysOnMarket == null ? '—' : String(Math.round(band.medianDaysOnMarket))} />
                      <Field label="Sell-through" value={band.sellThroughRate == null ? '—' : `${band.sellThroughRate.toFixed(1)}%`} />
                      <Field label="Absorption" value={band.absorptionRate == null ? '—' : `${band.absorptionRate.toFixed(1)}%`} />
                      <Field label="Months supply" value={band.monthsOfSupply == null ? '—' : band.monthsOfSupply.toFixed(1)} />
                      <Field label="Population" value={band.population == null ? '—' : Math.round(band.population).toLocaleString()} />
                      <Field label="Density" value={band.populationDensity == null ? '—' : `${band.populationDensity.toLocaleString()}/sq mi`} />
                      <Field label="Growth" value={band.populationGrowth == null ? '—' : `${band.populationGrowth.toFixed(1)}%`} />
                    </dl>
                    <div class="mt-2 break-words border-t border-[var(--color-border)] pt-2 text-[9px] leading-relaxed text-[var(--color-text-faint)]">
                      {band.snapshotPeriod ?? 'No county snapshot'} · {band.confidence} confidence<br />{band.coverage}<br />{band.source}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
          {operatorMarket.developmentAndInfrastructure.length > 0 && (
            <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
              <h3 class="text-[13px] font-bold text-[var(--color-text)]">Growth, development & infrastructure</h3>
              <p class="mt-0.5 text-[10.5px] text-[var(--color-text-muted)]">Material current projects and trends, translated into practical land-demand implications.</p>
              <div class="mt-3 grid gap-2 lg:grid-cols-2">
                {operatorMarket.developmentAndInfrastructure.map((item, index) => (
                  <article key={index} class="min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                    <div class="flex min-w-0 flex-wrap items-start justify-between gap-2">
                      <div class="min-w-0">
                        {item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noreferrer" class="break-words text-[11px] font-semibold text-[var(--color-accent)] underline">{item.name}</a> : <div class="break-words text-[11px] font-semibold text-[var(--color-text)]">{item.name}</div>}
                        <div class="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[9px] text-[var(--color-text-faint)]">
                          {item.location && <span>{item.location}</span>}
                          {item.distanceMiles != null && <span>{item.distanceMiles.toFixed(1)} mi</span>}
                          <span>{item.status.replace(/_/g, ' ')}</span>
                          {item.timeline && <span>{item.timeline}</span>}
                          {item.scale && <span>{item.scale}</span>}
                        </div>
                      </div>
                    </div>
                    <div class="mt-2 break-words text-[10px] leading-relaxed text-[var(--color-text-muted)]">{item.likelyEffect}</div>
                    {item.downside && <div class="mt-1 break-words text-[10px] leading-relaxed text-amber-300">Possible downside: {item.downside}</div>}
                  </article>
                ))}
              </div>
            </section>
          )}
          {snapshot.operatorAnalysis?.subdivision.scenarios.length ? (
            <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 class="text-[13px] font-bold text-[var(--color-text)]">Bulk tract versus likely split</h3>
                  <p class="mt-0.5 text-[10.5px] text-[var(--color-text-muted)]">A direct view of the whole-tract exit and the strongest currently modeled lot concept.</p>
                </div>
                <Tag tone={STATUS_TONE.partial}>Preliminary</Tag>
              </div>
              {(() => {
                const scenario = snapshot.operatorAnalysis!.subdivision.scenarios[0];
                const completeCostBasis = scenario.estimatedCosts?.includesAcquisition === true && Boolean(scenario.estimatedNetProfit);
                return (
                  <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Whole-tract value" value={range(snapshot.operatorAnalysis!.values.expectedMarketValue ?? valuation.range)} />
                    <Field label="Likely split configuration" value={`${scenario.lots} lots${scenario.approximateAcresPerLot ? ` · ~${scenario.approximateAcresPerLot.toFixed(1)} ac average` : ''}`} />
                    <Field label="Combined gross value" value={range(scenario.grossValue)} />
                    <Field label={completeCostBasis ? 'Complete modeled costs' : 'Preliminary project costs'} value={range(scenario.estimatedCosts)} />
                    <Field label={completeCostBasis ? 'Estimated net profit' : 'Preliminary spread'} value={range(scenario.estimatedNetProfit ?? scenario.likelyNetOpportunity)} />
                    <Field label="Indicative timeline" value={snapshot.operatorAnalysis!.subdivision.estimatedTimeline} />
                    <div class="min-w-0 sm:col-span-2"><Field label="Main risk" value={snapshot.operatorAnalysis!.subdivision.mainRisks[0] ?? scenario.note} /></div>
                  </div>
                );
              })()}
              <p class="mt-3 text-[10px] leading-relaxed text-[var(--color-text-faint)]">Combined gross value is not profit. An estimated net is shown only when the scenario confirms acquisition and a complete modeled project-cost basis.</p>
            </section>
          ) : null}
        </>
      )}
      <details class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3">
        <summary class="cursor-pointer text-[10.5px] font-semibold text-[var(--color-text-muted)]">Comp methodology & source coverage</summary>
        <div class="mt-3 text-[11px] leading-relaxed text-[var(--color-text-muted)]">{comps.policyExplanation}</div>
        <div class="mt-1 text-[11px] text-[var(--color-text-faint)]">{comps.summaryLine}</div>
      </details>

      {/* THE valuation. This card is the only place on the Deal Card a value is
          asserted, and it is derived from the comps listed directly below it, so
          the page can never show "not priceable" beside a definitive number. */}
      <Card title="Valuation" right={<Tag tone={valuation.priceable ? STATUS_TONE.completed : STATUS_TONE.failed}>{valuation.priceable ? `${valuation.confidence} confidence` : 'not priceable'}</Tag>}>
        {valuation.priceable ? (
          <div class="space-y-2">
            {valuation.workingValue != null && (
              <div class="flex items-baseline gap-2">
                <span class="text-[9px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Working value</span>
                <span data-testid="pi-working-value" class="text-[18px] font-bold text-[var(--color-text)]">{money(valuation.workingValue)}</span>
              </div>
            )}
            {(() => {
              const total = snapshot.facts.find((fact) => fact.key === 'lpEstimateTotal');
              const perAcre = snapshot.facts.find((fact) => fact.key === 'lpEstimatePerAcre');
              if (!total?.value && !perAcre?.value) return null;
              const capturedAt = total?.retrievedAt ?? perAcre?.retrievedAt;
              return (
                <div data-testid="pi-lp-estimate" class="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
                  <div class="text-[9px] font-semibold uppercase tracking-wide text-sky-300">LandPortal subject estimate</div>
                  <div class="mt-2 grid gap-2 sm:grid-cols-2">
                    {total?.value && <Field label="Estimate price" value={total.value} />}
                    {perAcre?.value && <Field label="Estimate PPA" value={perAcre.value} />}
                  </div>
                  <div class="mt-2 text-[10px] leading-relaxed text-[var(--color-text-faint)]">Source: LandPortal authenticated parcel sidebar{capturedAt ? ` · retained ${capturedAt.slice(0, 10)}` : ''}. Additional indication; LandOS working value remains the comp-based figure above.</div>
                </div>
              );
            })()}
            <dl class="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
              <Field label="Supported range" value={range(valuation.range)} />
              <Field label="Per acre" value={range(valuation.pricePerAcreRange)} />
              <Field label="Likely retail" value={range(valuation.likelyRetail)} />
              <Field label="Disposition" value={range(valuation.dispositionRange)} />
            </dl>
            <div class="text-[11px] leading-relaxed text-[var(--color-text-muted)]">{valuation.basis}</div>
            {valuation.primaryBasis && (
              <div class="text-[10px] leading-relaxed text-[var(--color-text-faint)]">{valuation.primaryBasis}</div>
            )}
            {valuation.adjustments.length > 0 && (
              <div><div class="text-[9px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Adjustments</div><Bullets rows={valuation.adjustments} /></div>
            )}
            {valuation.uncertainty.length > 0 && (
              <div><div class="text-[9px] font-semibold uppercase tracking-wide text-amber-400">Material limitations</div><Bullets rows={valuation.uncertainty} tone="text-amber-300" /></div>
            )}
            {valuation.materialGaps.length > 0 && (
              <div><div class="text-[9px] font-semibold uppercase tracking-wide text-amber-400">Gaps affecting value</div><Bullets rows={valuation.materialGaps} tone="text-amber-300" /></div>
            )}
          </div>
        ) : (
          <div class="space-y-1.5">
            <div data-testid="pi-not-priceable" class="text-[11px] leading-relaxed text-rose-300">{valuation.notPriceableReason}</div>
            {/* An asking-market indication is still shown when one exists — it is
                explicitly NOT a closed-sale value, and is labelled as such. */}
            {valuation.pricePerAcreRange && (
              <div class="space-y-1 rounded border border-amber-500/30 bg-amber-500/5 p-2">
                <div class="text-[9px] font-semibold uppercase tracking-wide text-amber-400">Asking-market indication only</div>
                <Field label="Asking per acre" value={range(valuation.pricePerAcreRange)} />
                <div class="text-[10px] leading-relaxed text-[var(--color-text-muted)]">{valuation.basis}</div>
              </div>
            )}
            {valuation.nextActionToPrice && <div class="text-[11px] leading-relaxed text-[var(--color-text-muted)]">Next action: {valuation.nextActionToPrice}</div>}
          </div>
        )}
      </Card>

      {(() => {
        const soldShown = comps.sold.slice(0, 5);
        const activeShown = comps.active.slice(0, 4);
        const askingShown = comps.askingReferences ?? [];
        const compRecordsShown = soldShown.length + activeShown.length + askingShown.length;
        const acceptanceSubject = acceptanceSubjectFor(snapshot);
        return (
          <section data-acceptance-section="comps" class="space-y-3">
            <div class="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3">
              <div>
                <div class="text-[12px] font-bold text-[var(--color-text)]">Comparable records</div>
                <div class="mt-0.5 text-[10px] text-[var(--color-text-muted)]">Accepted sold, active, and asking-market rows rendered in this workspace.</div>
              </div>
              <span data-visible-count="comps" class="text-[20px] font-black tabular-nums text-[var(--color-text)]">{compRecordsShown}</span>
            </div>

            <Card title="Accepted sold comps" right={<Tag tone="border-zinc-500/40 text-zinc-400">{comps.sold.length}</Tag>}>
              {comps.sold.length
                ? <CompCards rows={soldShown} acceptanceSubject={acceptanceSubject} />
                : compRecordsShown > 0
                  ? <Empty text="No confirmed closed sale is in the accepted set. The records below carry no stated sale status and are never used as a value basis." />
                  : <div data-empty-state="comps"><Empty text="No closed sale survived the comp source policy, so no comp is presented as a value basis." /></div>}
            </Card>

            <Card title="Active competition" right={<Tag tone="border-zinc-500/40 text-zinc-400">{comps.active.length}</Tag>}>
              {comps.active.length
                ? <CompCards rows={activeShown} acceptanceSubject={acceptanceSubject} />
                : <Empty text="No active vacant-land listing was found in the subject market." />}
            </Card>

            {/* Priced rows whose publisher never stated whether they closed. A
                first-class lane, never counted as sold evidence. */}
            {askingShown.length > 0 && (
              <Card title="Asking-market references (status not stated)" right={<Tag tone={STATUS_TONE.partial}>{askingShown.length}</Tag>}>
                <div class="mb-1.5 text-[10px] leading-relaxed text-amber-300">
                  The source published a price and acreage but never said whether these closed. They are shown as asking-market context and are never counted as sold evidence.
                </div>
                <CompCards rows={askingShown} acceptanceSubject={acceptanceSubject} />
              </Card>
            )}
          </section>
        );
      })()}

      {comps.landHomeOnly.length > 0 && (
        <Card title="Manufactured-home sales within the dedicated comp lane" right={<Tag tone={STATUS_TONE.partial}>{comps.landHomeOnly.length}</Tag>}>
          <div class="mb-1 text-[9.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Improved sales (Land-Home Package only)</div>
          <div class="mb-1.5 text-[10px] leading-relaxed text-amber-300">
            These nearby improved or manufactured-home sales never establish vacant-land fair market value. They indicate whether finished land-home packages may have a supported local exit.
          </div>
          <CompCards rows={comps.landHomeOnly} />
          {comps.landHomeSearchProof && <ManufacturedSearchProof proof={comps.landHomeSearchProof} />}
        </Card>
      )}
      {comps.landHomeOnly.length === 0 && snapshot.identity.coordinates && (
        <Card title="Manufactured-home sale lane">
          <Empty text="No qualifying manufactured or mobile-home sale is retained in the dedicated nearby search lane." />
          {comps.landHomeSearchProof && <ManufacturedSearchProof proof={comps.landHomeSearchProof} />}
        </Card>
      )}

      {/* Held-back rows as COUNTS with one reason each. Printing a rejection
          sentence per row is how eighty-nine of them reached the primary view. */}
      {(comps.evidenceBuckets?.length ?? 0) > 0 ? (
        <details class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3">
          <summary class="cursor-pointer text-[10.5px] font-semibold text-[var(--color-text-muted)]">
            Comp exclusions · {comps.evidenceBuckets!.reduce((sum, b) => sum + b.count, 0)} held back
          </summary>
          <div class="space-y-1.5">
            {comps.evidenceBuckets!.map((bucket, index) => (
              <div key={index} class="flex gap-2 border-b border-[var(--color-border)] pb-1.5 last:border-0 last:pb-0">
                <span class="shrink-0 text-[11px] font-semibold tabular-nums text-[var(--color-text)]">{bucket.count}</span>
                <span class="min-w-0 flex-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                  {bucket.reason}
                  {bucket.sources.length > 0 && (
                    <span class="text-[var(--color-text-faint)]"> ({bucket.sources.join(', ')})</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : comps.rejected.length > 0 && (
        <details class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3">
          <summary class="cursor-pointer text-[10.5px] font-semibold text-[var(--color-text-muted)]">Additional LandPortal candidates not used in valuation · {comps.rejected.length}</summary>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[520px] border-collapse text-[11px]">
              <tbody>
                {comps.rejected.map((row, index) => (
                  <tr key={index} class="border-b border-[var(--color-border)] last:border-0 align-top">
                    <td class="w-[28%] py-1.5 pr-2 text-[var(--color-text)]">{row.address ?? '—'}</td>
                    <td class="w-[14%] py-1.5 pr-2 text-[var(--color-text-faint)]">{row.source}</td>
                    <td class="w-[12%] py-1.5 pr-2 text-[var(--color-text-faint)]">{money(row.price)}</td>
                    <td class="py-1.5 text-[var(--color-text-muted)]">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function compWeight(row: PiComp): string {
  if (typeof row.weight === 'number') {
    return `${Math.round(row.weight)} / 100 · ${row.weightLabel ?? 'weighted'}`;
  }
  if (!row.dateIso || row.distanceMiles == null) return 'Context';
  const ageYears = Math.max(0, (Date.now() - new Date(row.dateIso).getTime()) / 31_557_600_000);
  if (row.distanceMiles <= 5 && ageYears <= 2 && row.acres != null) return 'High';
  if (row.distanceMiles <= 15 && ageYears <= 4) return 'Medium';
  return 'Context';
}

function compPhotoItems(row: PiComp) {
  const urls = Array.from(new Set(
    [row.thumbnailUrl, ...(row.photoUrls ?? [])]
      .filter((url): url is string => typeof url === 'string' && (
        /^https?:\/\//i.test(url)
        || /^\/api\/landos\/deal-cards\/\d+\/(?:comp-image|browseruse\/image)\/[A-Za-z0-9_.-]+$/.test(url)
      )),
  ));
  return urls.map((url, index) => ({
    id: `${row.key}-photo-${index + 1}`,
    label: `${row.address ?? 'Comparable property'}${urls.length > 1 ? ` · photo ${index + 1}` : ''}`,
    sourceType: `${row.source} comparable`,
    sourceUrl: row.sourceUrl,
    viewUrl: url,
    retrievedAt: row.collectionDate ?? row.dateIso,
    supports: 'Comparable property context',
  }));
}

/** Subject identity stamped onto each rendered comp/visual evidence row so the
 * independent visual acceptance can verify every visible record belongs to the
 * subject property. Values come from the canonical snapshot identity. */
type AcceptanceSubject = { address: string | null; apn: string | null; propertyId: string | null };

function acceptanceRowAttributes(subject: AcceptanceSubject, kind: 'comp' | 'visual', itemAddress?: string | null) {
  return {
    role: 'listitem',
    'data-acceptance-evidence-kind': kind,
    'data-subject-address': subject.address ?? undefined,
    'data-subject-apn': subject.apn ?? undefined,
    'data-subject-property-id': subject.propertyId ?? undefined,
    'data-item-address': itemAddress ?? undefined,
  } as Record<string, string>;
}

function acceptanceSubjectFor(snapshot: PiSnapshot): AcceptanceSubject {
  return {
    address: snapshot.identity.displayAddress ?? snapshot.identity.situs ?? snapshot.identity.normalizedAddress,
    apn: snapshot.identity.apn,
    propertyId: snapshot.identity.lpPropertyId ?? null,
  };
}

function CompCards({ rows, acceptanceSubject }: { rows: PiComp[]; acceptanceSubject?: AcceptanceSubject }) {
  return (
    <div class="grid min-w-0 gap-3 lg:grid-cols-2" {...(acceptanceSubject ? { 'data-rendered-rows': 'comps' } : {})}>
      {rows.map((row) => {
        const photos = compPhotoItems(row);
        const activity = [
          row.originalListingDate ? `Listed ${row.originalListingDate.slice(0, 10)}` : null,
          row.daysOnMarket != null ? `${row.daysOnMarket} days on market` : null,
          row.views != null ? `${row.views.toLocaleString()} views` : null,
          row.saves != null ? `${row.saves.toLocaleString()} saves` : null,
        ].filter(Boolean);
        return (
          <article key={row.key} {...(acceptanceSubject ? acceptanceRowAttributes(acceptanceSubject, 'comp', row.address) : {})} class="min-w-0 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-sm">
            {photos.length > 0 ? (
              <div class="border-b border-[var(--color-border)]">
                <DealImageGallery items={photos} title={`${row.address ?? 'Comparable'} photos`} mode="gallery" />
              </div>
            ) : (
              <div class="flex h-32 items-center justify-center border-b border-dashed border-[var(--color-border)] bg-[var(--color-elevated)] px-4 text-center">
                <div>
                  <div class="text-[11px] font-semibold text-[var(--color-text)]">Photo not retained</div>
                  <div class="mt-1 text-[9.5px] text-[var(--color-text-faint)]">The comp facts remain linked to their source.</div>
                </div>
              </div>
            )}
            <div class="min-w-0 p-3">
              <div class="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <div class="break-words text-[12px] font-semibold leading-snug text-[var(--color-text)]">{row.address ?? 'Address not retained'}</div>
                  <div class="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[9.5px] text-[var(--color-text-faint)]">
                    <span>{row.status}</span>
                    <span>{row.dateIso ? row.dateIso.slice(0, 10) : 'Date not established'}</span>
                    {row.distanceMiles != null && <span>{row.distanceMiles.toFixed(1)} mi</span>}
                    {row.apn && <span>APN {row.apn}</span>}
                  </div>
                </div>
                <Tag tone="border-[var(--color-accent)]/40 text-[var(--color-accent)]">{compWeight(row)}</Tag>
              </div>
              <dl class="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-[var(--color-elevated)] p-2">
                <Field label="Price" value={money(row.price)} />
                <Field label="Acres" value={row.acres == null ? '—' : row.acres.toFixed(2)} />
                <Field label="Price / acre" value={money(row.pricePerAcre)} />
              </dl>
              {activity.length > 0 && <div class="mt-2 break-words text-[10px] leading-relaxed text-[var(--color-text-muted)]">{activity.join(' · ')}</div>}
              {(row.priceChanges?.length ?? 0) > 0 && (
                <details class="mt-2 rounded-lg border border-[var(--color-border)] p-2">
                  <summary class="cursor-pointer text-[10px] font-semibold text-[var(--color-text)]">{row.priceChanges!.length} retained price change{row.priceChanges!.length === 1 ? '' : 's'}</summary>
                  <ul class="mt-1 space-y-1 text-[9.5px] leading-relaxed text-[var(--color-text-muted)]">
                    {row.priceChanges!.map((change, index) => <li key={index}>{[change.at?.slice(0, 10), money(change.price), change.note].filter(Boolean).join(' · ')}</li>)}
                  </ul>
                </details>
              )}
              <div class="mt-3 space-y-1.5 text-[10px] leading-relaxed">
                <div class="break-words text-[var(--color-text-muted)]">{row.whyUseful}</div>
                {row.similarities.length > 0 && <div class="break-words text-emerald-400/85"><span class="font-semibold">Similar:</span> {row.similarities.join(' · ')}</div>}
                {[...row.differences, ...(row.materialDifferences ?? [])].length > 0 && (
                  <div class="break-words text-amber-300/90"><span class="font-semibold">Material differences:</span> {Array.from(new Set([...row.differences, ...(row.materialDifferences ?? [])])).join(' · ')}</div>
                )}
                {(row.homeType || row.yearBuilt || row.homeSizeSqft) && (
                  <div class="break-words text-[var(--color-text-muted)]">
                    {[row.homeType, row.yearBuilt ? `built ${row.yearBuilt}` : null, row.homeSizeSqft ? `${row.homeSizeSqft.toLocaleString()} sq ft` : null].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
              <div class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-2 text-[9.5px] text-[var(--color-text-faint)]">
                <span>{row.source}{row.collectionDate ? ` · collected ${row.collectionDate.slice(0, 10)}` : ''}{row.engagement ? ` · ${row.engagement} engagement` : ''}</span>
                {row.sourceUrl && <a href={row.sourceUrl} target="_blank" rel="noreferrer" class="font-semibold text-[var(--color-accent)] underline">Open source ↗</a>}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ManufacturedSearchProof({ proof }: { proof: NonNullable<PiSnapshot['comps']['landHomeSearchProof']> }) {
  return (
    <details class="mt-2 rounded border border-[var(--color-border)] p-2 text-[10px] text-[var(--color-text-muted)]">
      <summary class="cursor-pointer font-semibold text-[var(--color-text)]">Search proof · {proof.status}</summary>
      <div class="mt-1.5 space-y-1">
        <p>{proof.radiusMiles}-mile radius · {proof.timePeriodMonths}-month window · {proof.candidatesReviewed} candidates reviewed · {proof.qualifyingResults} qualifying</p>
        <p>Sources: {proof.sourcesSearched.join(', ') || 'None reached'}</p>
        {proof.routesAttempted.length > 0 && <p>Routes: {proof.routesAttempted.join(' · ')}</p>}
        {proof.exclusionReasons.length > 0 && <p>Exclusions: {proof.exclusionReasons.map((item) => `${item.count} ${item.reason}`).join(' · ')}</p>}
      </div>
    </details>
  );
}

function CompTable({ rows }: { rows: PiComp[] }) {
  return (
    <div class="overflow-x-auto">
      <table class="w-full min-w-[760px] border-collapse text-[11px]">
        <thead>
          <tr class="border-b border-[var(--color-border)] text-[9px] uppercase tracking-wide text-[var(--color-text-faint)]">
            <th class="py-1 pr-2 text-left font-semibold">Property</th>
            <th class="py-1 pr-2 text-left font-semibold">Status</th>
            <th class="py-1 pr-2 text-left font-semibold">Date</th>
            <th class="py-1 pr-2 text-right font-semibold">Price</th>
            <th class="py-1 pr-2 text-right font-semibold">Acres</th>
            <th class="py-1 pr-2 text-right font-semibold">$/ac</th>
            <th class="py-1 pr-2 text-left font-semibold">Weight</th>
            <th class="py-1 pr-2 text-left font-semibold">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} class="border-b border-[var(--color-border)] last:border-0 align-top">
              <td class="max-w-[280px] py-2 pr-3 text-[var(--color-text)]">
                {row.address ?? '—'}
                {row.apn && <div class="text-[10px] tabular-nums text-[var(--color-text-muted)]">APN {row.apn}</div>}
                <div class="mt-1 break-words text-[10px] leading-relaxed text-[var(--color-text-faint)]">{row.whyUseful}</div>
                {row.similarities.length > 0 && <div class="mt-1 break-words text-[10px] leading-relaxed text-emerald-400/80">{row.similarities.slice(0, 2).join(' · ')}</div>}
                {row.differences.length > 0 && <div class="text-[10px] leading-relaxed text-amber-400/80">{row.differences.join(' ')}</div>}
                {(row.materialDifferences?.length ?? 0) > 0 && <div class="text-[10px] leading-relaxed text-amber-400/80">Material differences: {row.materialDifferences!.join(' · ')}</div>}
                {(row.homeType || row.yearBuilt || row.homeSizeSqft) && (
                  <div class="text-[10px] leading-relaxed text-[var(--color-text-muted)]">
                    {[row.homeType, row.yearBuilt ? `built ${row.yearBuilt}` : null, row.homeSizeSqft ? `${row.homeSizeSqft.toLocaleString()} sq ft` : null].filter(Boolean).join(' · ')}
                  </div>
                )}
              </td>
              <td class="py-1.5 pr-2 text-[var(--color-text-muted)]">{row.status}</td>
              <td class="py-1.5 pr-2 text-[var(--color-text-muted)]">{row.dateIso ? row.dateIso.slice(0, 10) : '—'}</td>
              <td class="py-1.5 pr-2 text-right text-[var(--color-text)]">{money(row.price)}</td>
              <td class="py-1.5 pr-2 text-right text-[var(--color-text-muted)]">{row.acres == null ? '—' : row.acres.toFixed(2)}</td>
              <td class="py-1.5 pr-2 text-right text-[var(--color-text-muted)]">{money(row.pricePerAcre)}</td>
              <td class="py-1.5 pr-2 text-[var(--color-text-muted)]">{compWeight(row)}</td>
              <td class="py-1.5 pr-2 text-[var(--color-text-faint)]">
                {row.sourceUrl ? <a href={row.sourceUrl} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">{row.source}</a> : row.source}
                {row.distanceMiles != null && <div class="text-[10px]">{row.distanceMiles.toFixed(1)} mi</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Strategy ────────────────────────────────────────────────────────────────

export function PropertyIntelligenceStrategy({ snapshot }: { snapshot: PiSnapshot | null }) {
  if (!snapshot) return <NoSnapshot label="strategy" />;
  const { recommendation, strategies } = snapshot;
  const operator = snapshot.operatorAnalysis;
  const displayedStrategy = operator?.overall.bestCurrentStrategy ?? recommendation.preferredStrategy;
  const displayedRecommendation = operator?.overall.recommendation ?? recommendation.why;
  const displayedChangeFactors = operator?.overall.whatCouldMateriallyChangeConclusion ?? recommendation.whatWouldChangeIt;
  return (
    <div data-testid="pi-strategy" class="space-y-3">
      <PreliminaryNotice snapshot={snapshot} />
      <Card
        title="Operator recommendation"
        right={<Tag tone={recommendation.posture === 'pursue' ? STATUS_TONE.completed : recommendation.posture === 'reject' ? STATUS_TONE.failed : STATUS_TONE.partial}>{recommendation.posture}</Tag>}
      >
        {displayedStrategy ? (
          <div class="space-y-1.5">
            <div class="text-[12px] font-semibold text-[var(--color-accent)]">{displayedStrategy}</div>
            <div class="text-[11px] leading-relaxed text-[var(--color-text-muted)]">{displayedRecommendation}</div>
            <div class="text-[11px] leading-relaxed text-[var(--color-text-muted)]">{recommendation.postureWhy}</div>
          </div>
        ) : (
          <div data-testid="pi-no-recommendation" class="text-[11px] leading-relaxed text-amber-300">{displayedRecommendation}</div>
        )}
        {displayedChangeFactors.length > 0 && (
          <div class="mt-2">
            <div class="text-[9px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">What would change this</div>
            <Bullets rows={displayedChangeFactors} />
          </div>
        )}
        <dl class="mt-3 grid grid-cols-1 gap-2 border-t border-[var(--color-border)] pt-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Should we pursue it?" value={(recommendation.shouldPursue ?? recommendation.posture).replace(/_/g, ' ')} />
          <Field
            label="What is it worth?"
            value={recommendation.worth
              ? `${money(recommendation.worth.low)}–${money(recommendation.worth.high)} · work from ${money(recommendation.worth.workingValue)}`
              : 'Not established'}
          />
          <Field
            label="What should we try to buy it for?"
            value={recommendation.targetBuyRange
              ? `${money(recommendation.targetBuyRange.low)}–${money(recommendation.targetBuyRange.high)}`
              : 'Not established'}
          />
          <Field label="Best exit" value={displayedStrategy ?? recommendation.bestExit ?? 'Not established'} />
          <Field
            label="Is the juice worth the squeeze?"
            value={(recommendation.juiceWorthSqueeze?.answer ?? 'undetermined').replace(/_/g, ' ')}
          />
        </dl>
        {recommendation.targetBuyRange?.basis && (
          <div class="mt-2 text-[10px] leading-relaxed text-[var(--color-text-faint)]">{recommendation.targetBuyRange.basis}</div>
        )}
        {recommendation.juiceWorthSqueeze?.why && (
          <div class="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">{recommendation.juiceWorthSqueeze.why}</div>
        )}
        {(recommendation.dealKillers?.length ?? 0) > 0 && (
          <div class="mt-2">
            <div class="text-[9px] font-semibold uppercase tracking-wide text-rose-400">What could kill the deal</div>
            <Bullets rows={recommendation.dealKillers!} tone="text-rose-300" />
          </div>
        )}
        {(recommendation.nextConfirmations?.length ?? 0) > 0 && (
          <div class="mt-2">
            <div class="text-[9px] font-semibold uppercase tracking-wide text-amber-400">What must be confirmed next</div>
            <Bullets rows={recommendation.nextConfirmations!} tone="text-amber-300" />
          </div>
        )}
      </Card>

      {operator && (
        <>
          <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <div class="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 class="text-[13px] font-bold text-[var(--color-text)]">Ranked acquisition strategies</h3>
                <p class="mt-0.5 text-[10.5px] text-[var(--color-text-muted)]">All five approved paths, ranked against this property, market, and seller.</p>
              </div>
              <Tag tone={STATUS_TONE.completed}>{operator.rankedStrategies.length} evaluated</Tag>
            </div>
            <div class="space-y-2">
              {operator.rankedStrategies.map((strategy) => (
                <details key={strategy.strategy} open={strategy.rank === 1} class={`rounded-xl border p-3 ${strategy.rank === 1 ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5' : 'border-[var(--color-border)] bg-[var(--color-bg)]'}`}>
                  <summary class="cursor-pointer list-none">
                    <div class="flex flex-wrap items-center gap-3">
                      <span class={`flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-black ${strategy.rank === 1 ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-elevated)] text-[var(--color-text)]'}`}>#{strategy.rank}</span>
                      <div class="min-w-[180px] flex-1">
                        <div class="text-[12px] font-bold text-[var(--color-text)]">{strategy.strategy}</div>
                        <div class="text-[10px] text-[var(--color-text-muted)]">{strategy.expectedBuyer}</div>
                      </div>
                      <Tag tone={strategy.currentFit === 'Strong' ? STATUS_TONE.completed : strategy.currentFit === 'Weak' ? STATUS_TONE.failed : STATUS_TONE.partial}>{strategy.currentFit} fit</Tag>
                      <span class="text-[10px] text-[var(--color-text-faint)]">{strategy.timeline} · {strategy.effort} effort</span>
                    </div>
                  </summary>
                  <div class="mt-3 grid gap-3 border-t border-[var(--color-border)] pt-3 lg:grid-cols-3">
                    <div><div class="text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">Upside</div><p class="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">{strategy.expectedUpside}</p></div>
                    <div><div class="text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">Capital & seller fit</div><p class="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">{strategy.capitalRequired}. {strategy.sellerFit}</p></div>
                    <div><div class="text-[9px] font-bold uppercase tracking-wide text-amber-400">Main risk</div><p class="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">{strategy.mainRisk}</p></div>
                  </div>
                  <div class="mt-3 grid gap-3 lg:grid-cols-2">
                    <div><div class="text-[9px] font-bold uppercase tracking-wide text-emerald-400">Evidence supporting it</div><Bullets rows={strategy.evidenceSupport} /></div>
                    <div><div class="text-[9px] font-bold uppercase tracking-wide text-sky-400">What could change the rank</div><Bullets rows={strategy.couldChangeRanking} /></div>
                  </div>
                  <div class="mt-3 rounded-lg border border-[var(--color-border)] px-3 py-2 text-[10.5px] text-[var(--color-text-muted)]"><strong class="text-[var(--color-text)]">Next useful check:</strong> {strategy.nextUsefulCheck}</div>
                  {strategy.financialScenarios.length > 0 && (
                    <div class="mt-3 grid gap-2 sm:grid-cols-3">
                      {strategy.financialScenarios.map((scenario) => (
                        <div key={scenario.name} class="rounded-lg border border-[var(--color-border)] p-2">
                          <div class="text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">{scenario.name}</div>
                          <div class="mt-1 text-[14px] font-bold text-[var(--color-text)]">{money(scenario.estimatedProfit)} est. profit</div>
                          <div class="mt-1 text-[9.5px] leading-relaxed text-[var(--color-text-muted)]">Buy {money(scenario.acquisitionPrice)} · resale {money(scenario.resalePrice)} · costs {money(scenario.estimatedCosts)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </details>
              ))}
            </div>
          </section>

          <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-[13px] font-bold text-[var(--color-text)]">Subdivision opportunity</h3>
              <Tag tone={operator.subdivision.status === 'Promising' ? STATUS_TONE.completed : operator.subdivision.status === 'Not supported' ? STATUS_TONE.failed : STATUS_TONE.partial}>{operator.subdivision.status}</Tag>
            </div>
            <dl class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Jurisdiction" value={cleanJurisdiction(operator.subdivision.governingJurisdiction) ?? 'Needs confirmation'} />
              <Field label="Minimum lot size" value={operator.subdivision.minimumLotSize ?? 'Needs confirmation'} />
              <Field label="Minimum frontage" value={operator.subdivision.minimumFrontage ?? 'Needs confirmation'} />
              <Field label="Simplest lot count" value={operator.subdivision.simplestPracticalLotCount == null ? 'Needs confirmation' : String(operator.subdivision.simplestPracticalLotCount)} />
            </dl>
            {operator.subdivision.scenarios.length > 0 && (
              <div class="mt-4 grid gap-3">
                {operator.subdivision.scenarios.map((scenario) => {
                  const completeCostBasis = scenario.estimatedCosts?.includesAcquisition === true && Boolean(scenario.estimatedNetProfit);
                  const net = scenario.estimatedNetProfit ?? scenario.likelyNetOpportunity;
                  const lotMix = scenario.lotMix?.length
                    ? scenario.lotMix.map((lot) => `${lot.lotCount} × ~${lot.approximateAcresEach.toFixed(1)} ac (${lot.acreageBand})`).join(' · ')
                    : scenario.approximateAcresPerLot
                      ? `${scenario.lots} × ~${scenario.approximateAcresPerLot.toFixed(1)} ac`
                      : `${scenario.lots} lots`;
                  return (
                    <article key={`${scenario.lots}-${lotMix}`} class="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3.5">
                      <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="min-w-0">
                          <div class="text-[12px] font-bold text-[var(--color-text)]">{scenario.lots}-lot concept</div>
                          <div class="mt-1 break-words text-[10.5px] text-[var(--color-text-muted)]">{lotMix}</div>
                        </div>
                        <Tag tone={scenario.feasibility === 'Plausible' ? STATUS_TONE.completed : scenario.feasibility === 'Not supported' || scenario.feasibility === 'Unattractive' ? STATUS_TONE.failed : STATUS_TONE.partial}>{scenario.feasibility}</Tag>
                      </div>
                      <div class="mt-3 grid gap-2 sm:grid-cols-3">
                        <div class="rounded-lg border border-[var(--color-border)] p-2.5">
                          <div class="text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">Combined gross lot value</div>
                          <div class="mt-1 text-[13px] font-bold text-[var(--color-text)]">{range(scenario.grossValue)}</div>
                        </div>
                        <div class="rounded-lg border border-[var(--color-border)] p-2.5">
                          <div class="text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">{completeCostBasis ? 'Complete modeled costs' : 'Stated project costs'}</div>
                          <div class="mt-1 text-[13px] font-bold text-[var(--color-text)]">{range(scenario.estimatedCosts)}</div>
                          <div class="mt-1 text-[9.5px] text-[var(--color-text-faint)]">{scenario.estimatedCosts?.includesAcquisition ? 'Includes acquisition' : 'Acquisition inclusion not confirmed'}</div>
                        </div>
                        <div class="rounded-lg border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/5 p-2.5">
                          <div class="text-[9px] font-bold uppercase tracking-wide text-[var(--color-accent)]">{completeCostBasis ? 'Estimated net profit' : 'Preliminary spread'}</div>
                          <div class="mt-1 text-[13px] font-bold text-[var(--color-accent)]">{range(net)}</div>
                        </div>
                      </div>
                      {scenario.configurationRationale && (
                        <p class="mt-3 break-words text-[10.5px] leading-relaxed text-[var(--color-text-muted)]"><strong class="text-[var(--color-text)]">Why this configuration:</strong> {scenario.configurationRationale}</p>
                      )}
                      {(scenario.estimatedCosts?.items?.length ?? 0) > 0 && (
                        <div class="mt-3 overflow-x-auto rounded-lg border border-[var(--color-border)]">
                          <table class="w-full min-w-[560px] border-collapse text-[10px]">
                            <thead>
                              <tr class="border-b border-[var(--color-border)] text-[9px] uppercase tracking-wide text-[var(--color-text-faint)]">
                                <th class="px-2.5 py-2 text-left font-semibold">Modeled cost</th>
                                <th class="px-2.5 py-2 text-right font-semibold">Conservative</th>
                                <th class="px-2.5 py-2 text-right font-semibold">Stronger</th>
                                <th class="px-2.5 py-2 text-left font-semibold">Basis</th>
                              </tr>
                            </thead>
                            <tbody>
                              {scenario.estimatedCosts!.items!.map((item) => (
                                <tr key={item.label} class="border-b border-[var(--color-border)] last:border-0 align-top">
                                  <td class="px-2.5 py-2 font-semibold text-[var(--color-text)]">{item.label}</td>
                                  <td class="px-2.5 py-2 text-right text-[var(--color-text-muted)]">{money(item.low)}</td>
                                  <td class="px-2.5 py-2 text-right text-[var(--color-text-muted)]">{money(item.high)}</td>
                                  <td class="px-2.5 py-2 leading-relaxed text-[var(--color-text-faint)]">{item.basis}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {(scenario.estimatedCosts?.items?.length ?? 0) === 0 && (scenario.estimatedCosts?.categories?.length ?? 0) > 0 && (
                        <div class="mt-2">
                          <div class="text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">Modeled cost categories</div>
                          <div class="mt-1.5 flex flex-wrap gap-1.5">
                            {scenario.estimatedCosts!.categories!.map((category) => <span key={category} class="rounded-full border border-[var(--color-border)] px-2 py-1 text-[9px] text-[var(--color-text-muted)]">{category}</span>)}
                          </div>
                        </div>
                      )}
                      <p class="mt-2 break-words text-[10px] leading-relaxed text-[var(--color-text-faint)]">{scenario.note}</p>
                      {!completeCostBasis && (
                        <p class="mt-2 text-[9.5px] leading-relaxed text-amber-300">This is not net profit. Confirm acquisition, closing, holding, engineering, survey, approvals, soil work, access/site work, utilities, marketing, sale costs, and contingency.</p>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
            <div class="mt-3 grid gap-3 lg:grid-cols-2">
              <div><div class="text-[9px] font-bold uppercase tracking-wide text-amber-400">Main risks</div><Bullets rows={operator.subdivision.mainRisks} /></div>
              <div><div class="text-[9px] font-bold uppercase tracking-wide text-sky-400">Next checks</div><Bullets rows={operator.subdivision.nextChecks} /></div>
            </div>
          </section>
        </>
      )}

      {!operator && (strategies.length ? strategies.map((strategy) => (
        <div key={strategy.strategy} data-testid={`pi-strategy-${strategy.strategy.replace(/\s+/g, '-').toLowerCase()}`} class="rounded-md border border-[var(--color-border)] p-3">
          <div class="flex flex-wrap items-center gap-2">
            <Tag tone={APPLICABILITY_TONE[strategy.applicability] ?? APPLICABILITY_TONE.not_applicable}>{strategy.applicability.replace(/_/g, ' ')}</Tag>
            <span class="text-[11px] font-semibold text-[var(--color-text)]">{strategy.strategy}</span>
            {strategy.strategy === recommendation.preferredStrategy && <Tag tone={STATUS_TONE.completed}>recommended</Tag>}
          </div>
          <div class="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">{strategy.valueCreationPath}</div>
          <dl class="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            <Field label="Effort" value={strategy.effort} />
            <Field label="Timeline" value={strategy.timeline} />
          </dl>
          {strategy.supportingFacts.length > 0 && (
            <div class="mt-1.5"><div class="text-[9px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Supporting facts</div><Bullets rows={strategy.supportingFacts} /></div>
          )}
          {strategy.blockers.length > 0 && (
            <div class="mt-1.5"><div class="text-[9px] font-semibold uppercase tracking-wide text-rose-400">Blockers</div><Bullets rows={strategy.blockers} tone="text-rose-300" /></div>
          )}
          <div class="mt-1.5 text-[11px] leading-relaxed text-[var(--color-text-muted)]"><span class="text-[var(--color-text-faint)]">Risk:</span> {strategy.risk}</div>
          <div class="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]"><span class="text-[var(--color-text-faint)]">Next verification:</span> {strategy.nextVerificationStep}</div>
        </div>
      )) : <Empty text="No strategy evaluation exists for this run." />)}
    </div>
  );
}

// ── Visuals ─────────────────────────────────────────────────────────────────

export function PropertyIntelligenceVisuals({ snapshot }: { snapshot: PiSnapshot | null }) {
  if (!snapshot) return <NoSnapshot label="retained imagery" />;
  const visuals = snapshot.evidence.filter((item) => item.kind === 'screenshot' || item.kind === 'map' || item.kind === 'overlay');
  const propertyVisuals = visuals.filter((item) =>
    !/data.?center|brockovich|deed|record/i.test(`${item.label} ${item.sourceType}`));
  const primary = propertyVisuals.find((item) =>
    /hero|parcel|boundary|aerial|satellite/i.test(`${item.label} ${item.sourceType}`)) ?? propertyVisuals[0] ?? null;
  const gallery = primary ? propertyVisuals.filter((item) => item.id !== primary.id) : propertyVisuals;
  return (
    <div data-testid="pi-visuals" class="space-y-3">
      <PreliminaryNotice snapshot={snapshot} />
      {snapshot.threeDCapture?.decision === 'not_applicable' && <div data-testid="landportal-3d-not-applicable" class="rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-[10.5px] text-sky-200">Front Side 3D and Rear Side 3D: not applicable — retained slope data does not meet the 10% threshold.</div>}
      <section data-acceptance-section="visuals">
        <Card title="Hero property imagery" right={<Tag tone="border-zinc-500/40 text-zinc-400"><span data-visible-count="visuals">{primary ? 1 : 0}</span></Tag>}>
          {primary ? (
            <div role="list" aria-label="Retained property visuals" data-rendered-rows="visuals">
              <div {...acceptanceRowAttributes(acceptanceSubjectFor(snapshot), 'visual', snapshot.identity.displayAddress ?? snapshot.identity.situs)}>
                <DealImageGallery items={[primary]} title={snapshot.identity.normalizedAddress ?? 'Property'} mode="hero" />
              </div>
            </div>
          ) : (
            <div data-empty-state="visuals"><Empty text="No clean subject-centered parcel or aerial image was retained." /></div>
          )}
        </Card>
      </section>
      <Card title="Property gallery" right={<Tag tone="border-zinc-500/40 text-zinc-400">{gallery.length}</Tag>}>
        {gallery.length
          ? <DealImageGallery items={gallery} title={snapshot.identity.normalizedAddress ?? 'Property'} />
          : <Empty text="No additional property-focused aerial, 3D, terrain, or street-level image was retained." />}
      </Card>
    </div>
  );
}

// ── Documents and evidence ──────────────────────────────────────────────────

export function PropertyIntelligenceEvidence({ snapshot }: { snapshot: PiSnapshot | null }) {
  if (!snapshot) return <NoSnapshot label="retained evidence" />;
  const documents = snapshot.evidence.filter((item) => item.kind === 'document' || item.kind === 'record');
  const visualEvidence = snapshot.evidence.filter((item) => item.kind === 'screenshot' || item.kind === 'map' || item.kind === 'overlay');
  const matches = (item: PiSnapshot['evidence'][number], pattern: RegExp) =>
    pattern.test(`${item.label} ${item.sourceType} ${item.supports}`);
  const section = (label: string, pattern: RegExp, emptyText: string, factPattern?: RegExp) => {
    const rows = documents.filter((item) => matches(item, pattern));
    const facts = factPattern
      ? snapshot.governmentRecords.filter((fact) =>
          fact.value
          && fact.grade === 'confirmed_fact'
          && factPattern.test(`${fact.key} ${fact.label} ${fact.note ?? ''}`))
      : [];
    return (
      <Card title={label} right={<Tag tone="border-zinc-500/40 text-zinc-400">{rows.length}</Tag>}>
        {rows.length ? <DocumentCards documents={rows} address={snapshot.identity.normalizedAddress ?? 'Property'} facts={facts} /> : <Empty text={emptyText} />}
      </Card>
    );
  };
  const knownDocumentPattern = /deed|instrument|recorder|assessor|tax|plat|survey|easement|restriction|covenant|road.?maintenance|zoning|subdivision|ordinance|land use|soil|ssurgo|perc|septic/i;
  const otherGovernment = documents.filter((item) => !matches(item, knownDocumentPattern));
  const soilDocuments = documents.filter((item) => matches(item, /soil|ssurgo|perc|septic/i));
  const soilVisuals = visualEvidence.filter((item) => matches(item, /soil|ssurgo|perc|septic/i));
  return (
    <div data-testid="pi-evidence" class="space-y-3">
      <PreliminaryNotice snapshot={snapshot} />
      {section(
        'Deeds',
        /deed|instrument|recorder/i,
        'No subject-correlated deed has been retained.',
        /official_outcome.*(?:deedRef|recordingDate|recordBookPage|instrumentNumber|recordedPageCount|currentDeed|grantor|grantee|consideration|legalDescription)|deed reference|recording date|recorded book|instrument number|document pages|current deed|grantor|grantee|consideration|legal description/i,
      )}
      {section('Assessor and tax records', /assessor|tax/i, 'No assessor or tax document has been retained.')}
      {section('Plats and surveys', /plat|survey/i, 'No recorded plat or survey has been retained.')}
      {section('Easements and restrictions', /easement|restriction|covenant|road.?maintenance/i, 'No easement, restriction, covenant, or road-maintenance document has been retained.')}
      {section('Zoning and subdivision documents', /zoning|subdivision|ordinance|land use/i, 'No governing zoning or subdivision document has been retained.')}
      <Card title="Soil evidence" right={<Tag tone="border-zinc-500/40 text-zinc-400">{soilVisuals.length + soilDocuments.length}</Tag>}>
        {soilVisuals.length ? <DealImageGallery items={soilVisuals} title={`${snapshot.identity.normalizedAddress ?? 'Property'} soil evidence`} /> : null}
        {soilDocuments.length
          ? <div class={soilVisuals.length ? 'mt-3' : ''}><DocumentCards documents={soilDocuments} address={snapshot.identity.normalizedAddress ?? 'Property'} /></div>
          : !soilVisuals.length && <Empty text="No soil report or inspectable soil overlay has been retained." />}
      </Card>
      <Card title="Other government records" right={<Tag tone="border-zinc-500/40 text-zinc-400">{otherGovernment.length}</Tag>}>
        {otherGovernment.length ? (
          <div class="overflow-x-auto">
            <table class="w-full min-w-[560px] border-collapse text-[11px]">
              <thead>
                <tr class="border-b border-[var(--color-border)] text-[9px] uppercase tracking-wide text-[var(--color-text-faint)]">
                  <th class="py-1 pr-2 text-left font-semibold">Document</th>
                  <th class="py-1 pr-2 text-left font-semibold">Source type</th>
                  <th class="py-1 pr-2 text-left font-semibold">Retrieved</th>
                  <th class="py-1 pr-2 text-left font-semibold">Supports</th>
                  <th class="py-1 text-left font-semibold">Open</th>
                </tr>
              </thead>
              <tbody>
                {otherGovernment.map((item) => (
                  <tr key={item.id} class="border-b border-[var(--color-border)] last:border-0 align-top">
                    <td class="py-1.5 pr-2 text-[var(--color-text)]">{item.label}</td>
                    <td class="py-1.5 pr-2 text-[var(--color-text-muted)]">{item.sourceType}</td>
                    <td class="py-1.5 pr-2 text-[var(--color-text-faint)]">{item.retrievedAt ? item.retrievedAt.slice(0, 10) : '—'}</td>
                    <td class="py-1.5 pr-2 text-[var(--color-text-faint)]">{item.supports}</td>
                    <td class="py-1.5 text-[var(--color-text-faint)]">
                      {item.viewUrl && <a href={tokenized(item.viewUrl)!} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">view</a>}
                      {item.viewUrl && item.sourceUrl && ' · '}
                      {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">source</a>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty text="No official record or document has been retained for this parcel yet." />}
      </Card>

    </div>
  );
}

function DocumentCards({
  documents,
  address,
  facts = [],
}: {
  documents: PiSnapshot['evidence'];
  address: string;
  facts?: PiFact[];
}) {
  return (
    <div class="grid gap-3 lg:grid-cols-2">
      {documents.map((item) => {
        const pageUrls = item.pageViewUrls?.length ? item.pageViewUrls : item.viewUrl ? [item.viewUrl] : [];
        const pageCount = item.pageCount ?? pageUrls.length;
        const capturedPageCount = item.capturedPageCount ?? pageUrls.length;
        return (
          <article key={item.id} class="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-[220px] flex-1">
                <h4 class="break-words text-[12px] font-bold leading-snug text-[var(--color-text)]">{item.label}</h4>
                <div class="mt-1 text-[9.5px] uppercase tracking-wide text-[var(--color-text-faint)]">
                  {item.sourceType}{pageCount ? ` · ${pageCount} official page${pageCount === 1 ? '' : 's'}` : ''}
                  {pageCount > capturedPageCount ? ` · ${capturedPageCount} local viewer capture${capturedPageCount === 1 ? '' : 's'}` : ''}
                </div>
                <p class="mt-2 break-words text-[10.5px] leading-relaxed text-[var(--color-text-muted)]">{item.supports}</p>
                {facts.length > 0 && (
                  <dl class="mt-3 grid gap-2 sm:grid-cols-2">
                    {facts.map((fact) => (
                      <div key={fact.key} class="min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-2.5 py-2">
                        <dt class="text-[8.5px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">{fact.label}</dt>
                        <dd class="mt-0.5 break-words text-[10.5px] leading-relaxed text-[var(--color-text)]">{fact.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
              {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" class="shrink-0 text-[10px] font-semibold text-[var(--color-accent)] underline">{pageCount > capturedPageCount ? 'View full official document' : 'Official source'} ↗</a>}
            </div>
            {pageUrls.length ? (
              <div class="mt-3">
                <DealImageGallery
                  title={`${address} · ${item.label}`}
                  items={pageUrls.map((url, index) => ({
                    id: `${item.id}-page-${index + 1}`,
                    label: `${item.label} · page ${index + 1}`,
                    sourceType: item.sourceType,
                    sourceUrl: item.sourceUrl,
                    viewUrl: url,
                    retrievedAt: item.retrievedAt,
                    supports: item.supports,
                  }))}
                />
              </div>
            ) : (
              <div class="mt-3 text-[10px] text-[var(--color-text-faint)]">A source record is retained, but no local page image is available.</div>
            )}
          </article>
        );
      })}
    </div>
  );
}
