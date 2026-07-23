import { useEffect, useState } from 'preact/hooks';
import { PageState } from '@/components/PageState';
import { ModelControl } from '@/components/ModelControl';
import { apiGet, apiPost, apiPatch, apiPut, apiDelete, dashboardToken } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { ResolutionView, type ResolutionSnapshotView, type ParcelIdentityView } from '@/components/ResolutionView';
import {
  OperatorCrmHeader, DecisionCardRail, RisksUnknownsPanel,
  SellerQuestionsPanel, FeasibilityStrip, type OperatorRecordView,
} from '@/components/OperatorRecordView';
import {
  DocumentRegistryPanel,
  type CompRegistryView, type DocumentRegistryView,
} from '@/components/CanonicalPanels';
import {
  ReconciledLandScorePanel, OfficialRecordsPanel, DocumentUploadPanel,
} from '@/components/DealCardPanels';
import { TrashCardButton } from '@/components/TrashCardButton';
import { CompMap } from '@/components/landos/CompMap';
import { PublicRecordsPanel, ResourcesContactsPanel, SmartIntakePanel } from '@/components/LeadCardIntake';
import {
  PropertySummarySnapshotPanel,
  type PropertySummaryReadModelView,
} from '@/components/PropertySummarySnapshotPanel';

// The Resolution view payload — shown instead of a half-populated Deal Card until
// the parcel is confirmed.
interface ResolutionData {
  parcelIdentity: ParcelIdentityView | null;
  snapshot: ResolutionSnapshotView | null;
  confirmed: boolean;
}

interface DealResearchOpportunity {
  id: number;
  researchStatus: 'not_started' | 'queued' | 'running' | 'partial' | 'complete' | 'failed';
  discoveryStatus: string;
  pipelineStage: string;
}

interface DealResearchMission {
  id: number;
  status: 'queued' | 'running' | 'partial' | 'complete' | 'failed' | 'quarantined';
  attempt: number;
  summary: string;
  safeNextAction: string;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  updatedAt: number;
  verification?: { accepted?: boolean; identityState?: string } | null;
}

interface DealResearchProgress {
  opportunity: DealResearchOpportunity;
  mission: DealResearchMission | null;
}

const ACTIVE_RESEARCH_STATUSES = new Set(['queued', 'running']);

function DealResearchProgressPanel({ progress, retrying, actionError, onRetry }: { progress: DealResearchProgress; retrying: boolean; actionError: string; onRetry: () => void }) {
  const mission = progress.mission;
  if (!mission) return null;
  const running = ACTIVE_RESEARCH_STATUSES.has(mission.status);
  const verified = mission.verification?.accepted === true || mission.verification?.identityState === 'confirmed';
  const title = running
    ? 'Automatic property research is running'
    : mission.status === 'complete'
      ? 'Automatic property research complete'
      : mission.status === 'partial' && verified
        ? 'Property research updated this card'
        : mission.status === 'quarantined'
          ? 'Research needs parcel confirmation'
          : mission.status === 'failed'
            ? 'Automatic research needs a retry'
            : 'Property research finished with gaps';
  const detail = running
    ? 'Keep this Deal Card open. LandOS checks for new evidence every few seconds and refreshes the facts, visuals, comps, and summary when the run finishes.'
    : mission.summary || (verified ? 'Verified parcel evidence was saved to this Deal Card.' : 'The run finished without enough evidence to confirm the parcel.');
  const tone = running ? 'border-sky-500/50 bg-sky-500/10' : verified ? 'border-emerald-500/45 bg-emerald-500/10' : 'border-amber-500/50 bg-amber-500/10';
  return (
    <section data-testid="deal-card-research-progress" class={`rounded-lg border p-3 ${tone}`}>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="flex items-center gap-2 text-[12.5px] font-semibold text-[var(--color-text)]">
            {running && <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-500" />}
            {title}
          </div>
          <div class="mt-1 text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">{detail}</div>
          {!running && mission.safeNextAction && <div class="mt-1 text-[11px] text-[var(--color-text-muted)]"><span class="font-medium text-[var(--color-text)]">Next:</span> {mission.safeNextAction}</div>}
          {mission.error && <div class="mt-1 text-[11px] text-[var(--color-status-failed)]">{mission.error}</div>}
          {actionError && <div class="mt-1 text-[11px] text-[var(--color-status-failed)]">{actionError}</div>}
        </div>
        {!running && mission.status !== 'complete' && (
          <button type="button" data-testid="deal-card-research-retry" disabled={retrying} onClick={onRetry} class="shrink-0 rounded-md border border-[var(--color-accent)] px-3 py-1.5 text-[11.5px] font-semibold text-[var(--color-accent)] disabled:opacity-45">
            {retrying ? 'Starting…' : 'Re-run research'}
          </button>
        )}
      </div>
    </section>
  );
}

type EntityFilter = 'all' | 'LAND_ALLY' | 'TY_LAND_BIZ';

// Land Score (100-pt rubric) + supporting imagery, computed on demand.
interface LandScoreFactorView { id: string; label: string; maxPoints: number; points: number; dataGap: boolean; basis: string; }
interface LandScoreView { score: number; maxScore: number; verdict: string; factors: LandScoreFactorView[]; dataGaps: string[]; flags: string[]; confidence: string; note: string; }

// Deal Card panel — a usable list/open/create/edit/save/reload flow over the
// deal-level fields. Data comes from /api/landos/deal-cards (list) and
// /api/landos/deal-cards/:id (detail); writes go to POST /api/landos/deal-cards
// (create) and PATCH /api/landos/deal-cards/:id (update). After any write we
// re-load the same id from the API (proves persistence + keeps us on one record,
// no duplicate) AND refresh the list so a saved card is visible to open again.
//
// Deal-level fields only live here (title, stage, seller notes, asking price,
// strategy, package notes). Parcel identity/verification is never edited here.
// Fields the data model does not yet carry render an explicit "not captured yet"
// placeholder rather than fabricated values. No external CRM/GHL mutation, no
// fake sync, and imagery never drives parcel identity (exact-source only).

// Deal Card stages (mirrors DEAL_CARD_STATUSES in src/landos/db.ts). The backend
// re-validates, so this is just the picker surface.
const DEAL_STAGES = [
  'new', 'researching', 'discovery', 'underwriting', 'offer_ready',
  'offer_sent', 'follow_up', 'under_contract', 'closed', 'dead', 'archived',
] as const;

interface DealForm {
  entity: 'LAND_ALLY' | 'TY_LAND_BIZ';
  title: string;
  status: string;
  sellerNotes: string;
  askingPrice: string;
  combinedStrategy: string;
  packageNotes: string;
}

const EMPTY_FORM: DealForm = {
  entity: 'TY_LAND_BIZ', title: '', status: 'new', sellerNotes: '',
  askingPrice: '', combinedStrategy: '', packageNotes: '',
};

// DD/Research worksheet confidence labels + identity statuses (mirror
// DD_FIELD_LABELS / DD_PARCEL_IDENTITY_STATUSES in src/landos/db.ts; the backend
// re-validates and enforces the "Verified needs a source" guardrail).
const DD_FIELD_LABELS = [
  'Verified', 'Seller stated', 'Assumed', 'Unknown', 'Needs verification',
  'Local Area Context, Not Parcel Verified',
] as const;
const DD_IDENTITY_STATUSES = [
  'local_area_context_not_verified', 'seller_stated', 'address_only',
  'apn_provided', 'source_verified', 'unknown',
] as const;

interface DdSourceLink { label: string; url: string }

interface DdView {
  exists: boolean;
  parcelIdentityStatus: string;
  apn: string; apnLabel: string;
  county: string; state: string; locationLabel: string;
  acreage: number | null; acreageLabel: string;
  zoning: string; zoningLabel: string;
  accessStatus: string; accessLabel: string;
  utilitiesStatus: string; utilitiesLabel: string;
  floodStatus: string; floodLabel: string;
  wetlandsStatus: string; wetlandsLabel: string;
  roadFrontageNotes: string;
  sourceLinks: DdSourceLink[];
  dataGaps: string[]; riskFlags: string[];
  notes: string; updatedBy: string; updatedAt: number | null;
}

interface DdForm {
  parcelIdentityStatus: string;
  apn: string; apnLabel: string;
  county: string; state: string; locationLabel: string;
  acreage: string; acreageLabel: string;
  zoning: string; zoningLabel: string;
  accessStatus: string; accessLabel: string;
  utilitiesStatus: string; utilitiesLabel: string;
  floodStatus: string; floodLabel: string;
  wetlandsStatus: string; wetlandsLabel: string;
  roadFrontageNotes: string;
  sourceLinksText: string;
  dataGapsText: string;
  riskFlagsText: string;
  notes: string;
}

// Strategy worksheet offer-readiness labels (mirror STRATEGY_OFFER_READINESS in
// src/landos/db.ts; the backend re-validates). Strategy defaults to 'not_reviewed'
// and is never auto-advanced.
const STRATEGY_READINESS = [
  'not_reviewed', 'needs_confirmation', 'blocked', 'ready_for_offer', 'pass',
] as const;

interface StrategyView {
  exists: boolean;
  offerReadiness: string;
  strategyCandidates: string[];
  blockers: string[];
  nextConfirmations: string[];
  currentRecommendation: string;
  mostViableStrategy: string;
  preCallStrategyNotes: string;
  quickFlipNotes: string;
  subdivideNotes: string;
  landHomePackageNotes: string;
  improvedValueAddNotes: string;
  teardownLandOnlyNotes: string;
  passNoOfferReason: string;
  riskAdjustedNotes: string;
  targetProfitNote: string;
  notes: string;
  updatedBy: string;
  updatedAt: number | null;
}

interface StrategyForm {
  offerReadiness: string;
  strategyCandidatesText: string;
  blockersText: string;
  nextConfirmationsText: string;
  currentRecommendation: string;
  mostViableStrategy: string;
  preCallStrategyNotes: string;
  quickFlipNotes: string;
  subdivideNotes: string;
  landHomePackageNotes: string;
  improvedValueAddNotes: string;
  teardownLandOnlyNotes: string;
  passNoOfferReason: string;
  riskAdjustedNotes: string;
  targetProfitNote: string;
  notes: string;
}

// Market Research demand labels + source-confidence labels (mirror
// MARKET_DEMAND_LABELS / MARKET_SOURCE_CONFIDENCE in src/landos/db.ts; the
// backend re-validates and enforces the honest-conclusion guardrails). Demand
// defaults to 'not_reviewed' and is never auto-advanced.
const MARKET_DEMAND_LABELS = [
  'not_reviewed', 'needs_research', 'weak_demand', 'moderate_demand',
  'strong_demand', 'mixed_uncertain',
] as const;
const MARKET_SOURCE_CONFIDENCE = [
  'unknown', 'low', 'medium', 'high', 'needs_research',
] as const;

interface MarketView {
  exists: boolean;
  marketReviewStatus: string;
  targetAreaLabel: string;
  countyCityRegionNotes: string;
  buyerDemandNotes: string; buyerDemandLabel: string;
  activeListingNotes: string;
  soldCompContextNotes: string;
  daysOnMarketNotes: string;
  manufacturedHomeDemandNotes: string; manufacturedHomeDemandLabel: string;
  subdivisionDemandNotes: string; subdivisionDemandLabel: string;
  infillLotDemandNotes: string; infillLotDemandLabel: string;
  ruralAcreageDemandNotes: string; ruralAcreageDemandLabel: string;
  countyGrowthPlanningNotes: string;
  exitStrategySupportNotes: string;
  sourceLinks: DdSourceLink[];
  sourceConfidence: string;
  dataGaps: string[]; riskFlags: string[];
  notes: string; updatedBy: string; updatedAt: number | null;
}

interface MarketForm {
  marketReviewStatus: string;
  targetAreaLabel: string;
  countyCityRegionNotes: string;
  buyerDemandNotes: string; buyerDemandLabel: string;
  activeListingNotes: string;
  soldCompContextNotes: string;
  daysOnMarketNotes: string;
  manufacturedHomeDemandNotes: string; manufacturedHomeDemandLabel: string;
  subdivisionDemandNotes: string; subdivisionDemandLabel: string;
  infillLotDemandNotes: string; infillLotDemandLabel: string;
  ruralAcreageDemandNotes: string; ruralAcreageDemandLabel: string;
  countyGrowthPlanningNotes: string;
  exitStrategySupportNotes: string;
  sourceLinksText: string;
  sourceConfidence: string;
  dataGapsText: string;
  riskFlagsText: string;
  notes: string;
}

// DD + Market + Strategy operational report (mirrors DealCardReportView in
// src/landos/deal-card-report.ts). Read-only here: it is produced by the backend
// workflow that runs the safe non-credit parcel resolve, structures Market
// Research source targets, applies Strategy logic, and updates the worksheets.
interface ReportSourceRow {
  source: string;
  kind: 'parcel_exact' | 'market_pulse';
  status: string;
  detail: string;
  compCreditUsed: boolean;
}

interface ReportView {
  exists: boolean;
  reportStatus: string;
  parcelVerificationStatus: string;
  parcelVerified: boolean;
  ddSummary: string;
  marketSummary: string;
  strategySummary: string;
  mostViableStrategy: string;
  offerReadiness: string;
  sourceTable: ReportSourceRow[];
  dataGaps: string[];
  riskFlags: string[];
  countyVerificationChecklist: string[];
  marketFollowUpChecklist: string[];
  strategyBlockers: string[];
  nextConfirmations: string[];
  preCallStrategyNotes: string;
  creditUsage: { landportalNonCreditUsed: boolean; compCreditUsed: boolean; note: string };
  ddFactChecklist?: DdChecklistRowView[];
  ddCompleteness?: { total: number; verified: number; needsVerification: number; percentComplete: number; label: string };
  visualContext?: VisualContextView;
  marketComps?: MarketCompsView;
  /** LandOS 100-point Land Score computed inline with the report from the same
   *  verified property data. Null when the parcel is not source-verified. */
  landScore?: LandScoreView | null;
  /** Reconciled facts / valuation hierarchy / comp state — the single source of
   *  truth every tab reads so the card never contradicts itself. */
  reconciliation?: ReconciledFactsView;
  valuation?: ValuationHierarchyView;
  compState?: CompStateView;
  /** The 3-5 best comparables for the memo — ranked shortlist with per-comp why. */
  bestComps?: BestCompsView;
  /** Browser Intelligence evidence (LandPortal-first, then County gap-fill).
   *  Surfaced as a clean status block — never raw logs or workflow internals. */
  browserEvidence?: BrowserEvidenceView[];
  landportalInspection?: DiscoveryReportView['landportalInspection'];
  generatedAt: number | null;
  updatedBy: string;
}

// ── Reconciliation view mirrors (server: deal-card-reconciliation.ts) ─────────
interface FactCandidateView { value: string; num: number | null; source: string; tier: 'official' | 'provider' | 'visual' | 'none' }
interface ReconciledFactValueView {
  field: string; label: string; primary: string | null; primarySource: string | null;
  primaryTier: 'official' | 'provider' | 'visual' | 'none';
  alternates: FactCandidateView[]; conflict: boolean; conflictNote: string | null;
  status: 'reconciled' | 'needs_confirmation' | 'unknown';
}
interface ReconciledFactsView {
  acreage: ReconciledFactValueView; roadFrontage: ReconciledFactValueView;
  flood: ReconciledFactValueView; wetlands: ReconciledFactValueView; slope: ReconciledFactValueView;
  conflicts: string[];
}
interface ValuationBasisView { id: string; label: string; value: number | null; ppa: number | null; kind: string; rank: number; note: string }
interface ValuationHierarchyView {
  primary: ValuationBasisView | null; supporting: ValuationBasisView[];
  confidence: 'low' | 'medium' | 'high'; conflict: boolean; conflictNote: string | null;
  valueRange: { low: number; high: number; basisId: string } | null; nextAction: string | null;
}
interface CompSourceStatusView { source: string; label: string; status: 'retrieved' | 'none' | 'not_run' | 'unavailable'; count: number; note: string }
interface CompStateView {
  soldCount: number; activeCount: number; landportalVisibleCount: number; fallbackCount: number;
  totalUsable: number; anyRetrieved: boolean; sources: CompSourceStatusView[]; summaryLine: string; strategyLine: string;
}
interface SelectedCompView {
  price: number | null; pricePerAcre: number | null; acres: number | null; saleDateIso: string | null;
  distanceMiles: number | null; source: string; sourceUrl: string | null; addressDesc: string | null;
  lane: string; confidence: 'high' | 'medium' | 'low'; why: string;
  score?: number;
  scoreComponents?: { acreageSimilarity: number; recency: number; laneStrength: number; distance: number };
  distanceMethod?: 'straight_line' | 'provider' | null;
}
interface BestCompsView {
  comps: SelectedCompView[]; rationale: string; consideredCount: number; subjectAcres: number | null;
}

interface BrowserEvidenceView {
  service: 'landportal' | 'county_records';
  status: 'retrieved' | 'partial' | 'no_match' | 'parked' | 'blocked' | 'error';
  screenshotAvailable: boolean;
  /** Short, operator-facing items (e.g. "Property retrieved", "Last deed retrieved",
   *  "GIS verified", "Tax status retrieved"). Never a log dump. */
  items: string[];
}

interface MarketCompRowView { price: number; saleDateIso: string; acres: number | null; pricePerAcre: number | null; sourceUrl: string; sourceLabel: string; addressDesc?: string }
interface MarketCompsView {
  status: string;
  primaryProvider: string;
  providerChain: string[];
  soldCount: number;
  activeCount: number;
  sold: MarketCompRowView[];
  active: MarketCompRowView[];
  supplementalSold: MarketCompRowView[];
  valuation: MarketCompRowView[];
  metrics: { soldAvgPrice: number | null; soldAvgPpa: number | null; soldMedianPpa: number | null; ppaMin: number | null; ppaMax: number | null; activeAvgPrice: number | null; domMedian: number | null };
  sparseExplanation: string | null;
  providers: Array<{ providerId: string; status: string; kept: number }>;
  source: string;
  timestamp: string | null;
  note: string;
  research?: CompResearchView | null;
  landportalComps?: { status: string; count: number; note: string; rows: MarketCompRowView[] };
}

// Zillow/Redfin read-only browser comp research: the exact search path + honest
// per-source outcomes, so an actor failure never reads as a total comp failure.
interface CompResearchAttemptView {
  source: string; geoLevel: string; acreageScope: string; url: string | null;
  outcome: string; visibleResultCount: number | null; screenshotPath: string | null; compCount: number; note: string;
}
interface CompResearchView {
  attempts: CompResearchAttemptView[];
  searchPath: string[];
  acreageBand: string | null;
  acreageExpanded: boolean;
  geographyExpanded: boolean;
  filtersUsed: string[];
  strength: 'strong' | 'thin' | 'unavailable';
  summary: string;
}

interface DdChecklistRowView {
  key: string;
  label: string;
  value: string | null;
  status: 'verified' | 'needs_verification';
  source: string | null;
  noConnectedSource?: boolean;
}

// Pre-Call Intelligence (identity tier + property type + readiness).
interface PropertyTypeView {
  propertyType: string; vacantOrImproved: string; context: string; likelyBuyer: string;
  viableExits: string[]; poorFitExits: string[]; dealKillers: string[]; opportunities: string[]; risks: string[]; postDiscoveryVerifications: string[];
}
interface PreCallView {
  identityTier: string; identityTierLabel: string; status: string; statusLabel: string; score: number;
  retrieved: string[]; verified: string[]; candidateEvidence: string[]; unknown: string[]; note: string;
}

function PreCallIntelligenceSection({ pci, pt }: { pci?: PreCallView | null; pt?: PropertyTypeView | null }) {
  if (!pci) return null;
  const tierTone = pci.identityTier === 'verified_parcel' ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]'
    : pci.identityTier === 'candidate_parcel' ? 'text-[var(--color-accent)] border-[var(--color-accent)]'
    : 'text-[var(--color-text-faint)] border-[var(--color-border)]';
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-2">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">Pre-Call Intelligence</span>
        <span class={`text-[11px] px-2 py-0.5 rounded-full border ${tierTone}`}>{pci.identityTierLabel}</span>
        <span class="ml-auto text-[11px] px-2 py-0.5 rounded-full border border-[var(--color-border)] tabular-nums">Status: {pci.statusLabel} ({pci.score}%)</span>
      </div>
      <div class="text-[11px] text-[var(--color-text-muted)]">{pci.note}</div>
      {pt && (
        <div class="text-[11px] grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
          <div><span class="text-[var(--color-text-faint)]">Inferred type:</span> {pt.propertyType} <span class="text-[10px] text-[var(--color-text-faint)]">({pt.vacantOrImproved}/{pt.context})</span></div>
          <div><span class="text-[var(--color-text-faint)]">Likely buyer:</span> {pt.likelyBuyer}</div>
          {pt.viableExits.length > 0 && <div class="md:col-span-2"><span class="text-[var(--color-text-faint)]">Viable exits:</span> {pt.viableExits.join(', ')}</div>}
          {pt.opportunities.length > 0 && <div class="md:col-span-2"><span class="text-[var(--color-text-faint)]">Opportunities:</span> {pt.opportunities.join('; ')}</div>}
        </div>
      )}
      <div class="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
        <div><div class="text-[var(--color-status-done)]">Retrieved / Verified</div>{[...pci.verified, ...pci.retrieved.filter((r) => !pci.verified.includes(r))].slice(0, 6).map((x, i) => <div key={i}>• {x}</div>)}</div>
        <div><div class="text-[var(--color-accent)]">Candidate evidence</div>{pci.candidateEvidence.length ? pci.candidateEvidence.map((x, i) => <div key={i}>• {x}</div>) : <div class="text-[var(--color-text-faint)]">—</div>}</div>
        <div><div class="text-[var(--color-text-faint)]">Unknown / Needs Verification</div>{pci.unknown.slice(0, 6).map((x, i) => <div key={i}>• {x}</div>)}</div>
      </div>
    </div>
  );
}

// Discovery Call Preparation briefing (operator-facing).
interface BriefingView {
  knownFacts: string[];
  biggestUnknowns: string[];
  questionsToAsk: string[];
  warnings: string[];
  risks: string[];
  followUpPriorities: string[];
}

// Acquisitions department panel (CRM-independent seller-strategy brain). Loads
// per-deal seller memory; supports paste-discovery, manual comm log, follow-up
// DRAFTS (never sent), call prep, next-best-action, stage. Source = Deal Card.
interface AcqView {
  acquisition: { stage: string; profile: Record<string, unknown>; commLog: Array<Record<string, unknown>>; discovery: Array<Record<string, unknown>> };
  stageLabel: string;
  nextAction: { action: string; label: string; reason: string };
  strategy: { situation: string; motivation: string; likelyLeverage: string; recommendedTone: string; nextMove: string; missingInfo: string; offerCallReady: boolean };
  callPrep: { openingFrame: string; whatWeKnow: string[]; whatToLearn: string[]; keyQuestions: string[]; likelyObjections: string[]; doNotSay: string[]; desiredOutcome: string };
  playbook: { status: string; toneRules: string[] };
  trainingReadiness: { backend: string; r2Configured: boolean; ingestionImplemented: boolean; note: string };
}
const ACQ_STAGES = ['new_lead', 'needs_discovery', 'discovery_complete', 'needs_follow_up', 'ready_for_offer_prep', 'offer_sent', 'stalled', 'paused', 'pass'];

function AcquisitionsPanel({ dealId }: { dealId: number }) {
  const [v, setV] = useState<AcqView | null>(null);
  const [notes, setNotes] = useState('');
  const [followFmt, setFollowFmt] = useState<'sms' | 'email' | 'call_script'>('sms');
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function load() { try { setV(await apiGet<AcqView>(`/api/landos/deal-cards/${dealId}/acquisition`)); } catch (e: any) { setMsg(e?.message || String(e)); } }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [dealId]);
  async function addDiscovery() { if (!notes.trim()) return; setBusy(true); try { await apiPost(`/api/landos/deal-cards/${dealId}/acquisition/discovery`, { notes: notes.trim() }); setNotes(''); await load(); } catch (e: any) { setMsg(e?.message || String(e)); } finally { setBusy(false); } }
  async function genFollowup() { setBusy(true); try { const r = await apiPost<{ draft: { draft: string } }>(`/api/landos/deal-cards/${dealId}/acquisition/followup`, { format: followFmt }); setDraft(r.draft.draft); } catch (e: any) { setMsg(e?.message || String(e)); } finally { setBusy(false); } }
  async function setStage(stage: string) { setBusy(true); try { await apiPost(`/api/landos/deal-cards/${dealId}/acquisition/stage`, { stage }); await load(); } catch (e: any) { setMsg(e?.message || String(e)); } finally { setBusy(false); } }
  if (!v) return null;
  const p = v.acquisition.profile as Record<string, string | string[] | undefined>;
  const d0 = v.acquisition.discovery[0] as Record<string, unknown> | undefined;
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-3">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">Acquisitions</span>
        <select class="text-[11px] rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5" value={v.acquisition.stage} disabled={busy} onChange={(e) => void setStage((e.target as HTMLSelectElement).value)}>
          {ACQ_STAGES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <span class={`ml-auto text-[11px] px-2 py-0.5 rounded-full border ${v.strategy.offerCallReady ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]' : 'text-[var(--color-accent)] border-[var(--color-accent)]'}`}>Next: {v.nextAction.label}</span>
      </div>
      <div class="text-[11px] text-[var(--color-text-muted)]">{v.nextAction.reason}</div>

      {/* Seller profile summary */}
      <div class="text-[11px] grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-0.5">
        <div><span class="text-[var(--color-text-faint)]">Seller:</span> {(p.name as string) || '—'} {p.phone ? `· ${p.phone}` : ''}</div>
        <div><span class="text-[var(--color-text-faint)]">Motivation:</span> {(p.motivation as string) || '—'}</div>
        <div><span class="text-[var(--color-text-faint)]">Timeline:</span> {(p.timeline as string) || '—'}</div>
        <div><span class="text-[var(--color-text-faint)]">Asking (seller-stated):</span> {(p.askingPrice as string) || '—'}</div>
        <div><span class="text-[var(--color-text-faint)]">Last contact:</span> {(p.lastContactDate as string) || '—'}</div>
        <div><span class="text-[var(--color-text-faint)]">Next follow-up:</span> {(p.nextFollowUpDate as string) || '—'}</div>
        {Array.isArray(p.objections) && (p.objections as string[]).length > 0 && <div class="md:col-span-2"><span class="text-[var(--color-status-failed)]">Objections:</span> {(p.objections as string[]).join('; ')}</div>}
        {Array.isArray(p.sellerStatedFacts) && (p.sellerStatedFacts as string[]).length > 0 && <div class="md:col-span-2"><span class="text-[var(--color-text-faint)]">Seller-stated facts (not verified):</span> {(p.sellerStatedFacts as string[]).slice(0, 4).join('; ')}</div>}
      </div>

      {/* Discovery notes input */}
      <div>
        <div class="text-[11px] text-[var(--color-text-muted)] mb-1">Paste discovery / call notes (auto-extracts motivation, timeline, price, decision-makers, objections — facts stored Seller-stated)</div>
        <textarea class="w-full text-[11px] rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1" rows={2} value={notes} placeholder="Paste what the seller said…" onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)} />
        <button type="button" disabled={busy || !notes.trim()} onClick={addDiscovery} class="mt-1 text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40">Extract &amp; save discovery</button>
      </div>

      {/* Call prep */}
      <div class="text-[11px]">
        <div class="font-semibold text-[var(--color-text-faint)]">Call prep</div>
        <div><span class="text-[var(--color-text-faint)]">Open:</span> {v.callPrep.openingFrame}</div>
        {v.callPrep.keyQuestions.length > 0 && <div><span class="text-[var(--color-text-faint)]">Ask:</span> {v.callPrep.keyQuestions.slice(0, 4).join(' · ')}</div>}
        <div><span class="text-[var(--color-status-failed)]">Do not say:</span> {v.callPrep.doNotSay.slice(0, 2).join(' · ')}</div>
      </div>

      {/* Follow-up draft (never sent) */}
      <div>
        <div class="flex items-center gap-1.5">
          <span class="text-[11px] text-[var(--color-text-muted)]">Follow-up draft (not sent):</span>
          <select class="text-[11px] rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5" value={followFmt} onChange={(e) => setFollowFmt((e.target as HTMLSelectElement).value as never)}>
            <option value="sms">SMS</option><option value="email">Email</option><option value="call_script">Call script</option>
          </select>
          <button type="button" disabled={busy} onClick={genFollowup} class="text-[11px] px-2 py-0.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40">Generate</button>
        </div>
        {draft && <pre class="mt-1 text-[11px] whitespace-pre-wrap bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md p-2">{draft}<div class="text-[10px] text-[var(--color-text-faint)] mt-1">Draft only — nothing sent.</div></pre>}
      </div>

      {/* Comm log + discovery summary */}
      {v.acquisition.commLog.length > 0 && (
        <div class="text-[11px]"><div class="text-[var(--color-text-faint)]">Communication log ({v.acquisition.commLog.length})</div>
          {v.acquisition.commLog.slice(0, 3).map((e, i) => <div key={i}>• {(e.at as string || '').slice(0, 10)} {String(e.channel)}/{String(e.direction)}: {String(e.summary)}</div>)}
        </div>
      )}
      {d0 && <div class="text-[11px]"><span class="text-[var(--color-text-faint)]">Latest discovery:</span> tone {String(d0.emotionalTone)} · urgency {String(d0.urgency)}</div>}

      {msg && <div class="text-[11px] text-[var(--color-text-muted)]">{msg}</div>}
    </div>
  );
}

// Executive Summary — the operator-ready pre-call brief at the top of the file.
interface ExecSummaryView {
  headline: string; whatItIs: string; whyInteresting: string;
  marketPulse: { realieSoldCount: number; zillowActiveCount: number; pricePerAcre: { median: number | null; p25: number | null; p75: number | null }; confidence: string; interpretation: string; whatThisMeans: string; growthDrivers: { available: boolean; summary: string; whatThisMeans: string; drivers: Array<{ category: string; count: number }> } };
  preliminaryAcquisitionRange: { available: boolean; acres: number | null; estMidValue: number | null; acquisition40: number | null; acquisition60: number | null; recommendedRange: [number, number] | null; confidence: string; assumptions: string[]; increaseValueIf: string[]; decreaseValueIf: string[]; note: string };
  strongestStrategy: { strategy: string; why: string };
  strategyRanking: Array<{ strategy: string; viability: string; reason: string; risk: string; confidence: string; mustVerify: string }>;
  dealEconomics: { available: boolean; estValueLow: number | null; estValueMid: number | null; estValueHigh: number | null; acquisitionRange: [number, number] | null; roughSpread: [number, number] | null; confidence: string; missingCostItems: string[]; whyUnderwritingLater: string };
  topRisks: string[]; sellerQuestions: string[]; verifyBeforeOffer: string[]; nextSteps: string[]; confidence: string;
  /** Mirror of the shared unified readiness record — the executive review shows
   *  the same readiness every tab shows. */
  readiness?: { summaryLine: string; offer: { state: string; why: string }; value: { state: string; why: string }; strategyActionability: { stateLabel: string; why: string } } | null;
}
// Discovery Call Intelligence Report (Acquisition Specialist v1) — mirrors
// DiscoveryCallReport in src/landos/discovery-call-report.ts.
// Master Market Matrix section (single source of truth; Property Card + Discovery
// Report both render this). Mirrors MarketMatrixReportSection.
interface MarketMatrixView {
  available: boolean;
  coverageLevel: string;
  coverageLabel: string;
  acreageBandUsed: string | null;
  period: string | null;
  snapshotDate: string | null;
  staleness: string;
  isStale: boolean;
  confidence: string | null;
  source: string | null;
  fields: Array<{ label: string; value: string | null; unknown: boolean }>;
  talkingPoints: string[];
  note: string;
}
interface ParcelFactSheetView {
  apn: string | null;
  owner: string | null;
  acres: number | null;
  centroid: { lat: number | null; lng: number | null };
  access: { roadFrontageFt: number | null; roadName: string | null; landLocked: boolean | null; note: string | null };
  buildability: { pct: number | null; acres: number | null; note: string | null };
  environment: { wetlandsPct: string | null; femaCoveragePct: string | null; floodZone: string | null; slope: string | null };
  valuation: { lastSalePrice: string | null; lastSaleDate: string | null; assessedValue: string | null; totalMarketValue: string | null; lpEstimatePrice: string | null; lpEstimatePpa: string | null };
}
interface DiscoveryReportView {
  marketMatrix?: MarketMatrixView;
  available: boolean;
  parcelVerified: boolean;
  contextLabel: string;
  headline: string;
  disclaimer: string;
  confidence: string;
  smartInput: {
    rawInput: string; interpretedAs: string;
    resolvedFields: Array<{ label: string; value: string }>;
    resolutionPath: string; parcelStatus: string; parcelVerified: boolean; note: string;
  };
  landportalInspection?: null | {
    parcelUrl: string | null;
    comparablesUrl: string | null;
    parcelFacts: Record<string, string>;
    assets: Array<{ key: string; label: string; kind: string; url: string; timestamp: string; overlay?: string; note?: string }>;
    overlays: Array<{ overlay: string; status: string; note: string; confidence: string; screenshotUrl?: string | null }>;
    visualObservations: Array<{ label: string; detail: string; confidence: string; evidence: string }>;
    comparables: Array<{ rawText: string; sourceUrl: string; apn?: string | null; address?: string | null; saleDate?: string; acres?: number | null; price?: number | null; pricePerAcre?: number | null; distanceMiles?: number | null; status: string; saleListIndicator?: string; improvement: string; confidence: string }>;
    sources: Array<{ provider: string; stage: string; status: string; confidence: string; url?: string | null; note: string }>;
    evidence: Array<{ label: string; status: string; detail: string; confidence: string; source?: string | null; url?: string | null }>;
    discoveryQuestions: string[];
    missingInformation: string[];
    factSheet?: ParcelFactSheetView;
  };
  comparableIntelligence?: {
    subjectClassification: { type: string; confidence: string; evidence: string[]; note: string };
    acreageBand: string | null;
    comparables: Array<{ address: string | null; acreage: number | null; salePrice: number | null; pricePerAcre: number | null; saleDate: string | null; status: string; propertyType: string; source: string; sourceUrl: string | null; confidence: string; notes: string[]; parsingErrors: string[] }>;
    selectedComparables: Array<{ address: string | null; acreage: number | null; salePrice: number | null; pricePerAcre: number | null; saleDate: string | null; status: string; propertyType: string; source: string; sourceUrl: string | null; confidence: string; notes: string[]; parsingErrors: string[] }>;
    estimatedPricePerAcre: { low: number | null; mid: number | null; high: number | null };
    estimatedMarketValue: { low: number | null; mid: number | null; high: number | null } | null;
    confidence: string;
    evidenceUsed: string[];
    evidenceMissing: string[];
    factorsAffectingValue: string[];
  };
  marketIntelligence?: {
    label: string;
    confidence: string;
    facts: Array<{ label: string; status: string; value: string | null; confidence: string; source: string | null; note: string }>;
    marketPulse: string;
    opportunities: string[];
    risks: string[];
    sources: Array<{ source: string; url?: string | null; status: string; note: string }>;
    missingInformation: string[];
  };
  strategyEvaluation: Array<{ strategy: string; verdict: string; reason: string; pricingLogic: string; mainRisk: string }>;
  roughOfferRange: {
    basis: string; available: boolean; acres: number | null;
    pricePerAcre: { low: number | null; mid: number | null; high: number | null };
    marketValue: { low: number | null; mid: number | null; high: number | null } | null;
    acquisition: { low: number | null; high: number | null } | null;
    perAcreAcquisition: { low: number | null; high: number | null } | null;
    confidence: string; whatCouldChange: string[]; note: string;
  };
}
interface OwnerMarketMetricView {
  salesCount: number | null; daysOnMarket: number | null; sellThroughRate: number | null;
  absorptionRate: number | null; monthsOfSupply: number | null; population: number | null;
  populationDensity: number | null; populationGrowth: number | null;
  medianPrice: number | null; medianPricePerAcre: number | null;
}
interface OwnerMarketRowView { area: string; level: 'county' | 'zip'; metrics: OwnerMarketMetricView }
interface OwnerAnalysisView {
  market: {
    available: boolean; band: string; bandLabel: string; period: string | null; source: string | null;
    county: OwnerMarketRowView | null; zip: OwnerMarketRowView | null; pulse: string[];
  };
  grades: Array<{ name: string; grade: string; explanation: string; sourceNote: string | null }>;
  valuation: {
    available: boolean;
    comps: Array<{ address: string; salePrice: number; acres: number; pricePerAcre: number; saleDate: string; source: string; sourceUrl: string | null; distanceMiles: number | null; why: string | null; statusLabel?: string | null }>;
    averagePricePerAcre: number | null; subjectAcres: number | null; roughFairMarketValue: number | null;
    acquisitionBand: { low: number; high: number } | null; note: string;
  };
  strategies: Array<{ strategy: string; suitability: string; why: string; mainRisk: string }>;
  recommendation: string;
}
const usd = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`);
// ── Discovery Call Intelligence Report (Acquisition Specialist v1) ────────────
// The cohesive, operator-facing pre-call report: six labeled sections in the
// exact order Tyler runs a lead against. Pulls Smart Input, the five strategy
// evaluations, and the offer range from the backend discovery report; Parcel
// Intelligence / Comps / Market Pulse render from the report + executive summary.
function verdictTone(v: string): string {
  return v === 'viable' ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]'
    : /not[_ ]viable/.test(v) ? 'text-[var(--color-status-failed)] border-[var(--color-status-failed)]'
    : v === 'blocked' ? 'text-[var(--color-status-running)] border-[var(--color-status-running)]'
    : 'text-[var(--color-accent)] border-[var(--color-accent)]';
}
// Master Market Matrix intelligence panel — rendered on the Property Card AND in
// the Discovery Call Report from the SAME resolved section (one source of truth).
function MarketMatrixPanel({ mm, compact = false }: { mm?: MarketMatrixView | null; compact?: boolean }) {
  if (!mm) return null;
  if (!mm.available) {
    return (
      <div class="rounded-md border border-dashed border-[var(--color-border)] p-2.5 text-[11px] text-[var(--color-text-faint)]">
        Market Matrix: no snapshot for this geography/acreage yet ({mm.coverageLabel}). A Browser Agent ingestion candidate — nothing fabricated.
      </div>
    );
  }
  return (
    <div class="rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-card)] p-2.5 space-y-1.5">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-accent)]">Market Matrix</span>
        <span class="text-[9px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">{mm.coverageLabel}</span>
        {mm.acreageBandUsed && <span class="text-[9px] text-[var(--color-text-faint)]">{mm.acreageBandUsed}</span>}
        <span class="ml-auto text-[9px] text-[var(--color-text-faint)]">{mm.period ?? '—'} · confidence {mm.confidence ?? '—'}{mm.isStale ? ' · stale' : ''}</span>
      </div>
      <div class={`grid ${compact ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-4'} gap-x-3 gap-y-0.5`}>
        {mm.fields.map((f, i) => (
          <div key={i} class="text-[10px] text-[var(--color-text-muted)]">{f.label}: <span class={f.unknown ? 'text-[var(--color-text-faint)] italic' : 'text-[var(--color-text)]'}>{f.value ?? 'Unknown'}</span></div>
        ))}
      </div>
      {!compact && mm.talkingPoints.length > 0 && (
        <div class="pt-0.5 space-y-0.5">
          {mm.talkingPoints.slice(0, 3).map((t, i) => <div key={i} class="text-[10px] text-[var(--color-text-faint)]">• {t}</div>)}
        </div>
      )}
      <div class="text-[9px] text-[var(--color-text-faint)]">Source: {mm.source ?? 'Market Matrix'} · {mm.staleness}</div>
    </div>
  );
}

const ownerNumber = (value: number | null | undefined, digits = 0) => value == null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: digits });
const ownerPct = (value: number | null | undefined) => value == null ? '—' : `${ownerNumber(value, 2)}%`;

function MarketResearchStrip({ analysis }: { analysis?: OwnerAnalysisView | null }) {
  const market = analysis?.market;
  if (!market) return null;
  const rows = [market.county, market.zip].filter((row): row is OwnerMarketRowView => !!row);
  return (
    <Section title="Market Research">
      <div class="flex items-center gap-2 flex-wrap mb-2">
        <span class="text-[12px] font-semibold text-[var(--color-text)]">{market.bandLabel}</span>
        <span class="text-[10px] text-[var(--color-text-faint)]">Sold Land · trailing 12 months{market.period ? ` · ${market.period}` : ''}</span>
      </div>
      {rows.length ? (
        <div class="overflow-x-auto rounded-md border border-[var(--color-border)]">
          <table class="w-full min-w-[1080px] text-[11px]">
            <thead class="bg-[var(--color-bg)] text-[var(--color-text-faint)]">
              <tr>{['Area', 'Count', 'DOM', 'STR', 'Absorption', 'Months Supply', 'Population', 'Density', 'Growth', 'Median Price', 'Price/Acre'].map((label) => <th key={label} class="px-2 py-1.5 text-left font-medium whitespace-nowrap">{label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const m = row.metrics;
                return (
                  <tr key={row.level} class="border-t border-[var(--color-border)] text-[var(--color-text)]">
                    <td class="px-2 py-1.5 font-medium whitespace-nowrap">{row.area}</td>
                    <td class="px-2 py-1.5 tabular-nums">{ownerNumber(m.salesCount)}</td>
                    <td class="px-2 py-1.5 tabular-nums whitespace-nowrap">{ownerNumber(m.daysOnMarket)} days</td>
                    <td class="px-2 py-1.5 tabular-nums">{ownerPct(m.sellThroughRate)}</td>
                    <td class="px-2 py-1.5 tabular-nums">{ownerPct(m.absorptionRate)}</td>
                    <td class="px-2 py-1.5 tabular-nums">{ownerNumber(m.monthsOfSupply, 2)}</td>
                    <td class="px-2 py-1.5 tabular-nums">{ownerNumber(m.population)}</td>
                    <td class="px-2 py-1.5 tabular-nums">{ownerNumber(m.populationDensity, 2)}</td>
                    <td class="px-2 py-1.5 tabular-nums">{ownerPct(m.populationGrowth)}</td>
                    <td class="px-2 py-1.5 tabular-nums">{usd(m.medianPrice)}</td>
                    <td class="px-2 py-1.5 tabular-nums">{usd(m.medianPricePerAcre)}</td>
                  </tr>
                );
              })}
              {!market.county && <tr class="border-t border-[var(--color-border)]"><td class="px-2 py-1.5 text-[var(--color-text-faint)]" colSpan={11}>County row unavailable — no substitute used.</td></tr>}
              {!market.zip && <tr class="border-t border-[var(--color-border)]"><td class="px-2 py-1.5 text-[var(--color-text-faint)]" colSpan={11}>ZIP row unavailable — no county substitute used.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : <Placeholder text={`No ${market.bandLabel} Sold Land snapshot is available for the county or ZIP.`} />}
      {market.pulse.length > 0 && (
        <div class="mt-2.5 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] p-2.5">
          <div class="text-[11px] font-semibold text-[var(--color-text)] mb-1">Market Pulse</div>
          <div class="space-y-1">{market.pulse.map((line, i) => <p key={i} class="text-[11px] leading-relaxed text-[var(--color-text-muted)]">{line}</p>)}</div>
        </div>
      )}
    </Section>
  );
}

function PropertyGradesPanel({ analysis }: { analysis?: OwnerAnalysisView | null }) {
  if (!analysis) return null;
  return (
    <Section title="Property grades">
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2">
        {analysis.grades.map((grade) => (
          <div key={grade.name} class="rounded-md border border-[var(--color-border)] p-2.5">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[11px] font-semibold text-[var(--color-text)]">{grade.name}</span>
              <span class={`text-[18px] leading-none font-bold ${grade.grade === 'Pending' ? 'text-[var(--color-text-faint)] text-[12px]' : 'text-[var(--color-accent)]'}`}>{grade.grade}</span>
            </div>
            <div class="text-[10.5px] leading-relaxed text-[var(--color-text-muted)] mt-1.5">{grade.explanation}</div>
            {grade.sourceNote && <div class="text-[9.5px] text-[var(--color-text-faint)] mt-1">{grade.sourceNote}</div>}
          </div>
        ))}
      </div>
    </Section>
  );
}

function SoldCompValuationPanel({ analysis }: { analysis?: OwnerAnalysisView | null }) {
  const valuation = analysis?.valuation;
  if (!valuation) return null;
  return (
    <Section title="LandPortal comp valuation">
      {!valuation.available ? (
        <div class="rounded-md border border-dashed border-[var(--color-border)] p-3 text-[11.5px] text-[var(--color-text-muted)]">{valuation.note}</div>
      ) : (
        <div class="space-y-2.5">
          <div class="space-y-1">
            {valuation.comps.map((comp, i) => (
              <div key={`${comp.address}-${i}`} class="grid grid-cols-[1fr_auto] gap-3 rounded-md border border-[var(--color-border)] p-2 text-[11px]">
                <div class="min-w-0">
                  <div class="font-medium text-[var(--color-text)] truncate">{comp.address}</div>
                  <div class="text-[var(--color-text-faint)]">{comp.statusLabel ?? 'LandPortal comp'}{comp.saleDate ? ` ${comp.saleDate}` : ''} · {comp.distanceMiles == null ? 'distance unavailable' : `${ownerNumber(comp.distanceMiles, 1)} mi`} · {comp.source}{comp.sourceUrl ? <> · <a href={comp.sourceUrl} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">source</a></> : null}</div>
                  {comp.why && <div class="text-[9.5px] text-[var(--color-text-faint)] mt-0.5">Why selected: {comp.why}</div>}
                </div>
                <div class="text-right tabular-nums text-[var(--color-text)] whitespace-nowrap">{usd(comp.salePrice)} ÷ {ownerNumber(comp.acres, 2)} ac = <span class="font-semibold">{usd(comp.pricePerAcre)}/ac</span></div>
              </div>
            ))}
          </div>
          <div class="rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] p-3 space-y-1 text-[12px]">
            <div>Average LandPortal comp price per acre ({valuation.comps.length} closest usable comp{valuation.comps.length === 1 ? '' : 's'}): <span class="font-semibold">{usd(valuation.averagePricePerAcre)}/ac</span></div>
            <div>{usd(valuation.averagePricePerAcre)}/ac × {ownerNumber(valuation.subjectAcres, 2)} subject acres = <span class="font-semibold">{usd(valuation.roughFairMarketValue)} fair market value</span></div>
            <div>Rough offer range (40%–60% of FMV): <span class="font-semibold text-[var(--color-status-done)]">{usd(valuation.acquisitionBand?.low)}–{usd(valuation.acquisitionBand?.high)}</span></div>
          </div>
          <div class="text-[10px] text-[var(--color-text-faint)]">{valuation.note}</div>
        </div>
      )}
    </Section>
  );
}

function OwnerStrategiesPanel({ analysis }: { analysis?: OwnerAnalysisView | null }) {
  if (!analysis) return null;
  return (
    <Section title="Five strategy evaluations">
      <div class="space-y-2">
        {analysis.strategies.map((row, i) => (
          <div key={row.strategy} class="rounded-md border border-[var(--color-border)] p-3">
            <div class="flex items-center gap-2">
              <span class="text-[10px] text-[var(--color-text-faint)] tabular-nums">{i + 1}</span>
              <span class="text-[12.5px] font-semibold text-[var(--color-text)]">{row.strategy}</span>
              <span class={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full border ${row.suitability === 'Strong fit' ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]' : row.suitability === 'Weak fit' ? 'text-[var(--color-status-failed)] border-[var(--color-status-failed)]' : 'text-[var(--color-accent)] border-[var(--color-accent)]'}`}>{row.suitability}</span>
            </div>
            <div class="text-[11.5px] leading-relaxed text-[var(--color-text-muted)] mt-1">{row.why}</div>
            <div class="text-[10.5px] leading-relaxed text-[var(--color-text-faint)] mt-1"><span class="font-medium">Main risk / confirm:</span> {row.mainRisk}</div>
          </div>
        ))}
      </div>
      <div class="mt-2.5 rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-bg)] p-3 text-[11.5px] leading-relaxed text-[var(--color-text)]"><span class="font-semibold">Recommendation:</span> {analysis.recommendation}</div>
    </Section>
  );
}

function DiscoverySection({ n, title, children }: { n: number; title: string; children: any }) {
  return (
    <div class="rounded-md border border-[var(--color-border)] p-3 space-y-1.5">
      <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">{n}. {title}</div>
      {children}
    </div>
  );
}
function inspectionFactValue(facts: Record<string, string> | undefined, ...keys: string[]): string {
  const map = facts ?? {};
  for (const key of keys) {
    const value = map[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return 'Not Found';
}
// (Legacy DiscoveryCallReportSection removed: the Seller tab now consumes the
// shared pricing/strategy gates via SellerReadinessPanel + CallGuardrailsPanel
// in DealCardPanels.tsx — no stale underwriting values, one-point bands, or
// percentage offer formulas can render.)

// Browser Intelligence — LandPortal first, then County Records routed via NETR
// (semantic extraction, no per-county scrapers). The operator clicks Retrieve to
// pull public-record facts; each fact shows source / type / URL / confidence and
// whether it came from LandPortal, an NETR-routed county source, or a search
// fallback. Read-only; never dumps logs or workflow internals.
interface BrowserFactView { key: string; label: string; value: string; sourceName: string; sourceType: string; sourceUrl: string; confidence: string; origin: string; status: string }
interface BrowserSourceView { type: string; url: string; origin: string; confidence: number }
interface BrowserEvView { service: string; status: string; facts: BrowserFactView[]; sourcesUsed: BrowserSourceView[]; screenshotCount: number; note: string }

function originBadge(o: string): string {
  if (o === 'landportal') return 'LandPortal';
  if (o === 'netr_county') return 'NETR→county';
  if (o === 'search_fallback') return 'search fallback';
  return o;
}

interface SellerAuthorityView { nameMatch: boolean; ownerOfRecord?: string; sellerName?: string; parcelIdentityStatus: string; ownerOfRecordStatus: string; sellerRelationshipStatus: string; authorityToSellStatus: string; relationshipGuess: string; verificationTasks: Array<{ task: string; reason: string }>; summary: string }

function BrowserIntelligenceSection({ dealId }: { dealId?: number }) {
  const [data, setData] = useState<{ landportal: BrowserEvView; countyRecords: BrowserEvView; sellerAuthority?: SellerAuthorityView; facts?: BrowserFactView[]; countySourceMap?: any } | null>(null);
  const [autoFacts, setAutoFacts] = useState<BrowserFactView[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Auto-load the facts Browser Intelligence wrote during Property Resolution
  // (LandPortal + County Records after Realie) so they show WITHOUT any manual
  // trigger. Refreshed after an on-demand retrieve.
  function loadAutoFacts() {
    if (!dealId) return;
    apiGet<{ facts: BrowserFactView[] }>(`/api/landos/deal-cards/${dealId}/browser-facts`)
      .then((r) => setAutoFacts(r.facts || []))
      .catch(() => { /* section still usable via retrieve */ });
  }
  useEffect(() => { loadAutoFacts(); }, [dealId]);

  async function retrieve(mode: 'parcel_fact' | 'deep_record') {
    if (!dealId) return;
    setBusy(true); setErr(null);
    try { setData(await apiPost(`/api/landos/deal-cards/${dealId}/browser-intel`, { mode })); loadAutoFacts(); }
    catch (e: any) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  }
  async function stop() {
    if (!dealId) return;
    try { await apiPost(`/api/landos/deal-cards/${dealId}/browser-intel/cancel`, {}); } catch { /* ignore */ }
  }

  const renderEv = (label: string, e?: BrowserEvView) => (
    <div class="text-[12px]">
      <span class="text-[var(--color-text)] font-medium">{label}</span>
      <span class="text-[11px] text-[var(--color-text-faint)]"> · {e ? e.status : 'not run'}</span>
      {e && e.sourcesUsed.length > 0 && (
        <div class="ml-3 mt-0.5 flex flex-wrap gap-1">
          {e.sourcesUsed.map((s, i) => <span key={i} class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">{s.type} · {originBadge(s.origin)}</span>)}
        </div>
      )}
      {e && e.facts.filter((f) => f.status === 'extracted').length > 0 && (
        <ul class="ml-3 mt-1 space-y-0.5">
          {e.facts.filter((f) => f.status === 'extracted').map((f, i) => (
            <li key={i} class="text-[11px] text-[var(--color-text-muted)]">
              <span class="text-[var(--color-status-done)]">✓</span> <span class="text-[var(--color-text)]">{f.label}:</span> {f.value || (f.sourceUrl ? <a href={f.sourceUrl} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">link</a> : '—')}
              <span class="text-[10px] text-[var(--color-text-faint)]"> [{f.sourceName} · {f.confidence} · {originBadge(f.origin)}{(f as any).extractionMethod ? ` · ${(f as any).extractionMethod}` : ''}]</span>
            </li>
          ))}
        </ul>
      )}
      {e && e.note && <div class="ml-3 text-[10px] text-[var(--color-text-faint)] mt-0.5">{e.note}</div>}
    </div>
  );

  const sa = data?.sellerAuthority;
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-2">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Browser Intelligence — public records</div>
        <div class="flex items-center gap-1.5 flex-wrap">
          <button type="button" onClick={() => void retrieve('parcel_fact')} disabled={busy || !dealId}
            class="px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-elevated)] disabled:opacity-40">
            {busy ? 'Retrieving…' : 'Parcel facts'}
          </button>
          <button type="button" onClick={() => void retrieve('deep_record')} disabled={busy || !dealId}
            class="px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40">
            Deep records
          </button>
          {busy && <button type="button" onClick={() => void stop()} class="px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--color-status-failed)] text-[var(--color-status-failed)]">Stop</button>}
        </div>
      </div>
      {!data && !autoFacts.length && !err && <div class="text-[11px] text-[var(--color-text-faint)]">LandPortal first (after your manual login), then County Records routed through NETR Online → official county source → semantic parcel search → facts stream onto the card as found. Read-only; no credentials, no paid actions.</div>}
      {err && <div class="text-[11px] text-[var(--color-status-failed)]">{err}</div>}

      {/* Facts written AUTOMATICALLY during Property Resolution (no manual trigger). */}
      {autoFacts.length > 0 && (
        <div class="rounded-md border border-[var(--color-border)] p-2">
          <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Retrieved automatically after Realie ({autoFacts.length})</div>
          <ul class="space-y-0.5">
            {autoFacts.map((f, i) => (
              <li key={i} class="text-[11px] text-[var(--color-text-muted)]">
                <span class={f.status === 'extracted' ? 'text-[var(--color-status-done)]' : 'text-[var(--color-text-faint)]'}>{f.status === 'extracted' ? '✓' : '⚠'}</span>{' '}
                <span class="text-[var(--color-text)]">{f.label}:</span> {f.value && /^https?:/i.test(f.value) ? <a href={f.value} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">{f.value.slice(0, 48)}</a> : (f.value || '—')}
                <span class="text-[10px] text-[var(--color-text-faint)]"> [{f.sourceName || f.sourceType} · {originBadge(f.origin)}{f.status !== 'extracted' ? ` · ${f.status.replace('_', ' ')}` : ''}]</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {sa && (sa.sellerName || sa.ownerOfRecord) && (
        <div class="rounded-md border border-[var(--color-border)] p-2 text-[11px]">
          <div class="font-medium text-[var(--color-text)]">Owner-of-record vs seller</div>
          <div class="text-[var(--color-text-muted)]">Lead / seller: {sa.sellerName || '—'} · Owner of record: {sa.ownerOfRecord || '—'} {sa.relationshipGuess && sa.relationshipGuess !== 'individual' ? `(${sa.relationshipGuess})` : ''}</div>
          <div class="mt-0.5"><span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-status-done)] text-[var(--color-status-done)]">Parcel: {sa.parcelIdentityStatus}</span> <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-accent)] text-[var(--color-accent)]">Authority to sell: {sa.authorityToSellStatus.replace('_', ' ')}</span></div>
          {!sa.nameMatch && sa.verificationTasks.length > 0 && (
            <ul class="mt-1 ml-3 list-disc space-y-0.5 text-[var(--color-text-muted)]">{sa.verificationTasks.slice(0, 8).map((t, i) => <li key={i}>{t.task}</li>)}</ul>
          )}
          <div class="text-[10px] text-[var(--color-text-faint)] mt-0.5">{sa.summary}</div>
        </div>
      )}

      {data && (
        <div class="space-y-2">
          {renderEv('LandPortal', data.landportal)}
          {renderEv('County Records (NETR-routed)', data.countyRecords)}
        </div>
      )}
    </div>
  );
}

// Confirm Before Offer — the single home for "what must be confirmed before an
// offer." Merges verify-before-offer + next confirmations + strategy blockers
// from the report so these items appear ONCE, not scattered across panels.
function ConfirmBeforeOfferSection({ es, report }: { es?: ExecSummaryView | null; report: ReportView }) {
  const items = Array.from(new Set([
    ...((es?.verifyBeforeOffer ?? [])),
    ...((report.nextConfirmations ?? [])),
    ...((report.strategyBlockers ?? [])),
  ].map((x) => x.trim()).filter(Boolean)));
  if (items.length === 0) return null;
  return (
    <div class="rounded-lg border border-[var(--color-accent)] bg-[var(--color-card)] p-3">
      <div class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-accent)] mb-1">Confirm Before Offer</div>
      <ul class="list-disc pl-4 space-y-0.5 text-[12px] text-[var(--color-text)]">
        {items.slice(0, 8).map((x, i) => <li key={i}>{x}</li>)}
      </ul>
    </div>
  );
}

// Market comps + listings — Realie sold (primary band), Zillow active (asking-
// market evidence, NOT sold), Zillow supplemental sold (separate), provider
// readiness. Active listings never drive the sold-comp valuation band.
function CompRows({ rows, kind }: { rows: MarketCompRowView[]; kind: 'sold' | 'active' }) {
  return (
    <div class="space-y-0.5">
      {rows.slice(0, 8).map((c, i) => (
        <div key={i} class="text-[11px] flex items-center gap-2">
          <span class="tabular-nums">{c.price ? `$${c.price.toLocaleString()}` : '—'}</span>
          <span class="text-[var(--color-text-faint)]">{c.acres != null ? `${c.acres} ac` : '— ac'}{c.pricePerAcre != null ? ` · $${c.pricePerAcre.toLocaleString()}/ac` : ''}</span>
          {c.addressDesc && <span class="text-[var(--color-text-muted)] truncate">{c.addressDesc}</span>}
          {kind === 'sold' && c.saleDateIso && <span class="text-[10px] text-[var(--color-text-faint)]">sold {c.saleDateIso}</span>}
          <span class="ml-auto text-[10px] px-1 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-faint)]">{c.sourceLabel}</span>
          {c.sourceUrl && <a href={c.sourceUrl} target="_blank" rel="noreferrer" class="text-[10px] text-[var(--color-accent)]">link</a>}
        </div>
      ))}
      {rows.length > 8 && <div class="text-[10px] text-[var(--color-text-faint)]">+{rows.length - 8} more</div>}
    </div>
  );
}

// Honest active-listing retrieval state. "Zero active listings" may ONLY be
// stated when active retrieval actually ran and found none; a provider error /
// timeout / not-configured reads as "retrieval incomplete", never "zero".
function activeRetrievalState(mc: MarketCompsView): 'ran' | 'incomplete' | 'not_run' {
  const activeProviders = (mc.providers ?? []).filter((p) => /apify|zillow|realtor/i.test(p.providerId));
  if (mc.status === 'error') return 'incomplete';
  if (activeProviders.some((p) => p.status === 'connected')) return 'ran';
  if (activeProviders.some((p) => p.status === 'error' || p.status === 'timeout' || p.status === 'not_connected')) return 'incomplete';
  if (mc.status === 'not_configured' || mc.status === 'not_run' || mc.status === 'no_area') return 'not_run';
  return mc.status === 'collected' || mc.status === 'no_comps' ? 'ran' : 'incomplete';
}

function MarketCompsSection({ mc }: { mc?: MarketCompsView | null }) {
  if (!mc) return null;
  const m = mc.metrics || {};
  const activeState = activeRetrievalState(mc);
  const band = m.ppaMin != null && m.ppaMax != null ? `$${m.ppaMin.toLocaleString()}–$${m.ppaMax.toLocaleString()}/ac (p25–p75)` : '—';
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-3">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">Market Comps &amp; Listings</span>
        <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">chain: {(mc.providerChain || []).join(' → ') || '—'}</span>
        {/* Provider readiness */}
        <span class="ml-auto flex gap-1">
          {(mc.providers || []).map((p, i) => <span key={i} class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-faint)]">{p.providerId}: {p.status}</span>)}
        </span>
      </div>

      {/* Comparable Sales — retained raw-land sold comps that drive the band
          (multi-provider: Realie + HomeHarvest, classified, acreage-filtered) */}
      <div>
        <div class="text-[13px] font-semibold text-[var(--color-status-done)]">Comparable Sales <span class="text-[11px] text-[var(--color-text-faint)]">(retained raw-land band {band})</span></div>
        {mc.sold && mc.sold.length > 0 ? <CompRows rows={mc.sold} kind="sold" /> : <div class="text-[12px] text-[var(--color-text-faint)]">No retained land sold comps.</div>}
        {mc.sparseExplanation && <div class="text-[11px] text-[var(--color-accent)] mt-1">{mc.sparseExplanation}</div>}
      </div>

      {/* Active Listings — asking-market evidence (multi-provider), NOT sold */}
      <div>
        <div class="text-[13px] font-semibold text-[var(--color-accent)]">Active Listings <span class="text-[11px] text-[var(--color-text-faint)]">(asking-market evidence, not sold comps)</span></div>
        {mc.active && mc.active.length > 0 ? <CompRows rows={mc.active} kind="active" />
          : activeState === 'ran' ? <div class="text-[12px] text-[var(--color-text-faint)]">No active land listings found (retrieval ran).</div>
          : activeState === 'not_run' ? <div class="text-[12px] text-[var(--color-text-faint)]">Active listing retrieval not run for this parcel yet.</div>
          : <div class="text-[12px] text-[var(--color-status-failed)]">Active listing retrieval incomplete (provider error/timeout) — not a confirmed zero.</div>}
      </div>

      {/* Supplemental sold — kept separate, never in the raw-land band */}
      {mc.supplementalSold && mc.supplementalSold.length > 0 && (
        <div>
          <div class="text-[12px] font-semibold text-[var(--color-text-muted)]">Supplemental Sold Listings <span class="text-[11px] text-[var(--color-text-faint)]">(home-centric · excluded from the land band)</span></div>
          <CompRows rows={mc.supplementalSold} kind="sold" />
        </div>
      )}

      {/* LandPortal visible comps — free "similar sales" rows only (never the paid
          comp report). Own source-status + exact reason when unavailable. */}
      <LandPortalCompsPanel lpc={mc.landportalComps} />

      {/* Zillow + Redfin browser research — search path + honest per-source status */}
      <CompResearchPanel research={mc.research} />
    </div>
  );
}

// LandPortal visible comps + source status. Shows parsed free rows (source =
// LandPortal, with status/price/acreage/$/ac/date/URL) or the exact reason none
// are shown. The paid LandPortal comp report is never triggered.
function LandPortalCompsPanel({ lpc }: { lpc?: { status: string; count: number; note: string; rows: MarketCompRowView[] } | null }) {
  if (!lpc || lpc.status === 'not_run') return null;
  const tone = lpc.status === 'retrieved'
    ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]'
    : lpc.status === 'none'
      ? 'text-[var(--color-accent)] border-[var(--color-accent)]'
      : 'text-[var(--color-text-faint)] border-[var(--color-border)]';
  return (
    <div class="rounded-md border border-[var(--color-border)] p-2.5 space-y-1.5">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">LandPortal visible comps</span>
        <span class={`text-[10px] px-1.5 py-0.5 rounded-full border ${tone}`}>{lpc.status} · {lpc.count}</span>
        <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-faint)]">free rows only · no paid report</span>
      </div>
      <div class="text-[11px] text-[var(--color-text-muted)]">{lpc.note}</div>
      {lpc.rows && lpc.rows.length > 0 && <CompRows rows={lpc.rows} kind="sold" />}
    </div>
  );
}

// Renders the read-only Zillow/Redfin browser comp research: which sources were
// attempted, which succeeded/failed and why, how many comps each produced, the
// filters used, whether acreage/geography were expanded, overall strength, and
// the exact search path — so a thin result reads as an honest search, not silence.
function CompResearchPanel({ research }: { research?: CompResearchView | null }) {
  if (!research) return null;
  const strengthTone = research.strength === 'strong'
    ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]'
    : research.strength === 'thin' ? 'text-[var(--color-accent)] border-[var(--color-accent)]'
    : 'text-[var(--color-text-faint)] border-[var(--color-border)]';
  const bySource = (src: string) => research.attempts.filter((a) => a.source === src);
  const srcLine = (src: string) => {
    const a = bySource(src);
    if (a.length === 0) return `${src}: not attempted`;
    const comps = a.reduce((n, x) => n + x.compCount, 0);
    const outcome = a.find((x) => x.outcome === 'collected' || x.outcome === 'partial')?.outcome ?? a[0].outcome;
    const shot = a.find((x) => x.screenshotPath)?.screenshotPath;
    return `${src}: ${comps} comp(s) · ${outcome}${shot ? ' · screenshot captured' : ''}`;
  };
  return (
    <div class="rounded-md border border-[var(--color-border)] p-2.5 space-y-1.5">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">Zillow &amp; Redfin browser research</span>
        <span class={`text-[10px] px-1.5 py-0.5 rounded-full border ${strengthTone}`}>comps: {research.strength}</span>
        {research.acreageExpanded && <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">acreage expanded</span>}
        {research.geographyExpanded && <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">geography expanded</span>}
      </div>
      <div class="text-[12px] text-[var(--color-text-muted)]">{research.summary}</div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] text-[var(--color-text-muted)]">
        <div>Zillow — {srcLine('zillow')}</div>
        <div>Redfin — {srcLine('redfin')}</div>
      </div>
      <div class="text-[10px] text-[var(--color-text-faint)]">
        Filters: {research.filtersUsed.join(' · ')}{research.acreageBand ? ` · band ${research.acreageBand}` : ''}
      </div>
      {research.searchPath.length > 0 && (
        <details class="text-[10px] text-[var(--color-text-faint)]">
          <summary class="cursor-pointer">Search path ({research.searchPath.length} steps)</summary>
          <div class="mt-1 space-y-0.5">
            {research.searchPath.map((s, i) => <div key={i}>• {s}</div>)}
          </div>
        </details>
      )}
    </div>
  );
}

function DiscoveryBriefingSection({ b }: { b?: BriefingView | null }) {
  if (!b) return null;
  const block = (title: string, items: string[], tone?: string) => (
    <div>
      <div class={`text-[11px] font-semibold uppercase tracking-wider mb-1 ${tone ?? 'text-[var(--color-text-faint)]'}`}>{title}</div>
      {items.length ? (
        <ul class="list-disc pl-4 space-y-0.5 text-[12px] text-[var(--color-text)]">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
      ) : <div class="text-[11px] text-[var(--color-text-faint)]">(none)</div>}
    </div>
  );
  return (
    <div class="rounded-lg border border-[var(--color-accent)] bg-[var(--color-card)] p-3 space-y-3">
      <div class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">Discovery Call Preparation</div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        {block('What we already know', b.knownFacts)}
        {block('Biggest unknowns', b.biggestUnknowns)}
        {block('Questions to ask the seller', b.questionsToAsk)}
        {block('Follow-up priorities', b.followUpPriorities)}
        {block('Warnings', b.warnings, 'text-[var(--color-accent)]')}
        {block('Risks', b.risks, 'text-[var(--color-status-failed)]')}
      </div>
    </div>
  );
}

// Deal Card DD readiness (derived from the persisted report).
interface ReadinessView {
  discoveryReportState: 'not_generated' | 'generated' | 'stale' | 'needs_rerun';
  workflowStage: string;
  workflowStageLabel: string;
  nextBestAction: { action: string; label: string; reason: string };
  ddCompleteness: { verified: number; total: number; percentComplete: number; label: string };
  topMissingDdFacts: string[];
  topRiskFlags: string[];
  providerProvenance: { parcelSource: string; parcelStatus: string; parcelVerified: boolean };
  visualsCaptured: number;
  sellerFactCount: number;
}

const DISCOVERY_STATE_LABEL: Record<ReadinessView['discoveryReportState'], string> = {
  not_generated: 'Not generated',
  generated: 'Generated',
  stale: 'Stale (deal changed since last run)',
  needs_rerun: 'Needs rerun',
};

// DD Command Center header — at-a-glance pre-call readiness: next-best action,
// report state, completeness, provenance, top missing facts + risks.
function DealCardCommandCenter({ r }: { r?: ReadinessView | null }) {
  if (!r) return null;
  const pct = r.ddCompleteness.percentComplete;
  const ready = r.nextBestAction.action === 'ready_for_discovery_call';
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-2">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">Due Diligence Command Center</span>
        <span class="text-[11px] px-2 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
          Stage: {r.workflowStageLabel}
        </span>
        <span class={`ml-auto text-[11px] px-2 py-0.5 rounded-full border ${ready ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]' : 'text-[var(--color-accent)] border-[var(--color-accent)]'}`}>
          Next: {r.nextBestAction.label}
        </span>
      </div>
      <div class="text-[11px] text-[var(--color-text-muted)]">{r.nextBestAction.reason}</div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
        <div>
          <div class="text-[var(--color-text-faint)]">DD completeness</div>
          <div class="h-1.5 w-full rounded-full bg-[var(--color-elevated)] overflow-hidden my-1"><div class="h-full bg-[var(--color-status-done)]" style={{ width: `${pct}%` }} /></div>
          <div class="tabular-nums">{r.ddCompleteness.label}</div>
        </div>
        <div>
          <div class="text-[var(--color-text-faint)]">Discovery report</div>
          <div class="mt-1">{DISCOVERY_STATE_LABEL[r.discoveryReportState]}</div>
          <div class="text-[var(--color-text-faint)] mt-1">Visuals captured: {r.visualsCaptured}</div>
        </div>
        <div>
          <div class="text-[var(--color-text-faint)]">Parcel provenance</div>
          <div class="mt-1">{r.providerProvenance.parcelVerified ? 'Verified' : 'Unverified'}</div>
          <div class="text-[var(--color-text-faint)] truncate" title={r.providerProvenance.parcelSource}>{r.providerProvenance.parcelStatus}</div>
        </div>
      </div>
      {r.topMissingDdFacts.length > 0 && (
        <div class="text-[11px]">
          <span class="text-[var(--color-text-faint)]">Top missing DD facts: </span>
          <span>{r.topMissingDdFacts.join(', ')}</span>
        </div>
      )}
      {r.topRiskFlags.length > 0 && (
        <div class="text-[11px]">
          <span class="text-[var(--color-status-failed)]">Top risk flags: </span>
          <span>{r.topRiskFlags.join('; ')}</span>
        </div>
      )}
    </div>
  );
}

// Post-discovery DD panel: seller-stated facts (never Verified), manual county
// verification (browser agent dormant), and underwriting prep state. Loads on
// demand; mutations call back to refresh readiness.
interface SellerFactView { kind: string; value: string; note?: string; recordedAt: number; recordedBy: string }
interface CountyRecordView { task: string; status: string; extractedFact: string | null; officialSourceUrl: string | null; timestamp: string; note: string }
interface UnderwritingPrepView { state: string; verificationRequiredBeforeOffer: string[]; tighterCompRequirement: string; dealKillers: string[]; minimumProfitRules: string[]; offerReadinessNote: string }

function PostDiscoveryPanel({ dealId, onChange }: { dealId: number; onChange: () => void }) {
  const [facts, setFacts] = useState<SellerFactView[]>([]);
  const [factKinds, setFactKinds] = useState<string[]>([]);
  const [county, setCounty] = useState<{ availableTasks: string[]; records: CountyRecordView[] }>({ availableTasks: [], records: [] });
  const [uw, setUw] = useState<UnderwritingPrepView | null>(null);
  const [factKind, setFactKind] = useState('');
  const [factValue, setFactValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function loadAll() {
    try {
      const [sf, cv, up] = await Promise.all([
        apiGet<{ facts: SellerFactView[]; kinds: string[] }>(`/api/landos/deal-cards/${dealId}/seller-facts`),
        apiGet<{ availableTasks: string[]; records: CountyRecordView[] }>(`/api/landos/deal-cards/${dealId}/county-verification`),
        apiGet<{ underwritingPrep: UnderwritingPrepView }>(`/api/landos/deal-cards/${dealId}/underwriting-prep`),
      ]);
      setFacts(sf.facts); setFactKinds(sf.kinds); if (!factKind && sf.kinds[0]) setFactKind(sf.kinds[0]);
      setCounty(cv); setUw(up.underwritingPrep);
    } catch (e: any) { setMsg(e?.message || String(e)); }
  }
  useEffect(() => { void loadAll(); /* eslint-disable-next-line */ }, [dealId]);

  async function addFact() {
    if (!factKind || !factValue.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const r = await apiPost<{ error?: string }>(`/api/landos/deal-cards/${dealId}/seller-facts`, { kind: factKind, value: factValue.trim() });
      if (r.error) setMsg(r.error); else { setFactValue(''); await loadAll(); onChange(); }
    } catch (e: any) { setMsg(e?.message || String(e)); } finally { setBusy(false); }
  }
  async function markCounty(task: string) {
    setBusy(true); setMsg(null);
    try {
      await apiPost(`/api/landos/deal-cards/${dealId}/county-verification/mark`, { task, status: 'needs_human_or_county_call', note: 'County call needed (manual).' });
      await loadAll(); onChange();
    } catch (e: any) { setMsg(e?.message || String(e)); } finally { setBusy(false); }
  }

  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-3">
      <div class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">Post-Discovery Due Diligence</div>

      {uw && (
        <div class="text-[11px]">
          <span class="text-[var(--color-text-faint)]">Underwriting prep: </span>
          <span class="font-medium">{uw.state.replace(/_/g, ' ')}</span>
          <span class="text-[var(--color-text-muted)]"> — {uw.offerReadinessNote}</span>
        </div>
      )}

      {/* Seller-stated facts */}
      <div>
        <div class="text-[11px] text-[var(--color-text-muted)] mb-1">Seller-stated facts <span class="text-[10px] text-[var(--color-text-faint)]">(Seller-stated, not Verified)</span></div>
        <div class="flex gap-1.5 mb-1">
          <select class="text-[11px] rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-1" value={factKind} onChange={(e) => setFactKind((e.target as HTMLSelectElement).value)}>
            {factKinds.map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
          </select>
          <input class="flex-1 text-[11px] rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1" placeholder="What the seller said…" value={factValue} onInput={(e) => setFactValue((e.target as HTMLInputElement).value)} />
          <button type="button" disabled={busy} onClick={addFact} class="text-[11px] px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40">Add</button>
        </div>
        {facts.length === 0 ? <div class="text-[11px] text-[var(--color-text-faint)]">No seller-stated facts yet.</div> : (
          <div class="space-y-0.5">{facts.map((f, i) => <div key={i} class="text-[11px]"><span class="text-[var(--color-text-faint)]">{f.kind.replace(/_/g, ' ')}:</span> {f.value} <span class="text-[10px] text-[var(--color-text-faint)]">· Seller-stated</span></div>)}</div>
        )}
      </div>

      {/* County verification (manual; agent dormant) */}
      <div>
        <div class="text-[11px] text-[var(--color-text-muted)] mb-1">County verification <span class="text-[10px] text-[var(--color-text-faint)]">(official records — agent dormant; manual trigger)</span></div>
        <div class="flex flex-wrap gap-1">
          {county.availableTasks.map((t) => (
            <button key={t} type="button" disabled={busy} onClick={() => markCounty(t)} title="Mark county call needed" class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-elevated)] disabled:opacity-40">
              {t.replace(/^verify_/, '').replace(/_/g, ' ')}
            </button>
          ))}
        </div>
        {county.records.length > 0 && (
          <div class="mt-1 space-y-0.5">{county.records.map((r, i) => <div key={i} class="text-[11px]"><span class="text-[var(--color-text-faint)]">{r.task.replace(/_/g, ' ')}:</span> {r.status.replace(/_/g, ' ')}{r.extractedFact ? ` — ${r.extractedFact}` : ''}</div>)}</div>
        )}
      </div>

      {uw && uw.verificationRequiredBeforeOffer.length > 0 && (
        <div class="text-[11px]"><span class="text-[var(--color-status-failed)]">Verify before offer: </span>{uw.verificationRequiredBeforeOffer.slice(0, 4).join('; ')}</div>
      )}
      {msg && <div class="text-[11px] text-[var(--color-text-muted)]">{msg}</div>}
    </div>
  );
}

// Full DD fact checklist — mirrors the Discovery Call Report. Every standard
// field shows a Verified value (+source) or an explicit Unknown / Needs
// Verification status. Read-only; never fabricated.
function DdFactChecklist({ rows }: { rows?: DdChecklistRowView[] }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div>
      <div class="mb-1">
        <span class="text-[11px] text-[var(--color-text-muted)]">Due Diligence fact checklist</span>
      </div>
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] divide-y divide-[var(--color-border)]">
        {rows.map((r) => (
          <div key={r.key} class="flex items-center gap-2 px-3 py-1.5 text-[12px]">
            <span class="flex-1">{r.label}</span>
            {r.status === 'verified' ? (
              <span class="text-[var(--color-text)]">
                {r.value} {r.source && <span class="text-[10px] text-[var(--color-text-faint)]">· {r.source}</span>}
              </span>
            ) : (
              <span class="text-[10px] px-1.5 py-0.5 rounded-full border text-[var(--color-text-faint)] border-[var(--color-border)]">
                Unknown
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Visual Property Context (Google) — supporting context only, never verification.
interface VisualAssetView {
  service: string;
  imageType: string;
  status: 'captured' | 'not_captured' | 'unavailable';
  imageUrl: string | null;
  deepLink: string | null;
  apiService: string;
  verificationStatus: string;
  note: string;
  association?: { distanceToParcelM?: number | null } | null;
}
interface VisualContextView {
  provider: string;
  configured: boolean;
  label: string;
  generatedAt: string;
  assets: VisualAssetView[];
  links: { maps: string | null; streetView: string | null; earth: string | null };
  note: string;
}

// ── Visual Context — the permanent foundation for the future Interactive
//    Intelligence Map. This section is the FIRST thing on the Deal Card. It
//    renders a large satellite image, a parcel boundary when geometry is
//    available (else an honest marker fallback), Street View, and Maps/Earth
//    links + imagery source/date. The data contract here (assets + links +
//    optional parcelBoundary) is shaped so a MapLibre layer stack (pan/zoom,
//    parcel/flood/wetlands/slope/comp pins, measurement) can slot in later
//    WITHOUT a refactor — see the FUTURE MAP note below.
function isSatellite(a: VisualAssetView): boolean { return /satellite|maps_static|static_?map|aerial/i.test(`${a.service} ${a.imageType} ${a.apiService}`); }
function isStreetView(a: VisualAssetView): boolean { return /street/i.test(`${a.service} ${a.imageType} ${a.apiService}`); }

function VisualContextSection({ ctx, token }: { ctx?: VisualContextView; token: string }) {
  if (!ctx) return null;
  const withToken = (u: string) => appendDashboardToken(u, token);
  const captured = ctx.assets.filter((a) => a.status === 'captured' && a.imageUrl);
  const sat = captured.find(isSatellite);
  const street = captured.find(isStreetView);
  // An asset the backend excluded for missing parcel association carries the
  // exclusion note — surface the operator-facing state, never internal jargon.
  const excluded = ctx.assets.some((a) => /parcel association could not be confirmed/i.test(a.note ?? ''));
  // Parcel geometry is not provided by the connected imagery source (Google
  // Static Maps returns no parcel polygon). When a geometry provider (county
  // GIS / OpenAddresses) is wired, set ctx.parcelBoundary and this renders the
  // outline instead of the marker fallback. Until then: honest marker fallback.
  const hasBoundary = !!(ctx as { parcelBoundary?: unknown }).parcelBoundary;
  const streetUnavailable = ctx.assets.some(isStreetView) && !street;
  // Operator state — replaces internal "Visual Signal" language.
  const stateBadge = captured.length > 0
    ? 'Verified-coordinate imagery'
    : excluded
      ? 'Images excluded — parcel association not confirmed'
      : 'Parcel image unavailable';
  return (
    <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-2">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Visual Context</span>
        <span class={`text-[10px] px-1.5 py-0.5 rounded-full border ${captured.length > 0 ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]' : 'text-[var(--color-text-faint)] border-[var(--color-border)]'}`}>{stateBadge}</span>
      </div>

      {/* Compact: satellite + Street View side-by-side, height-capped so visuals
          stay useful without taking over the screen. */}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {sat ? (
          <figure class="m-0">
            <img src={withToken(sat.imageUrl as string)} alt="satellite" class="w-full h-40 sm:h-44 object-cover rounded-lg border border-[var(--color-border)]" loading="lazy" />
            <figcaption class="text-[10px] text-[var(--color-text-faint)] mt-0.5">Satellite · {hasBoundary ? 'parcel boundary overlaid' : 'parcel marker only'}</figcaption>
          </figure>
        ) : (
          <div class="text-[11px] text-[var(--color-text-muted)] rounded-lg border border-dashed border-[var(--color-border)] p-3 flex items-center">
            {excluded
              ? 'Image excluded because parcel association could not be confirmed. Re-run Capture visuals once the parcel is resolved — nothing misleading is shown instead.'
              : 'Parcel image unavailable — Capture visuals runs from verified parcel coordinates once the parcel is resolved.'}
          </div>
        )}
        {street ? (
          <figure class="m-0">
            <img src={withToken(street.imageUrl as string)} alt="street view" class="w-full h-40 sm:h-44 object-cover rounded-lg border border-[var(--color-border)]" loading="lazy" />
            <figcaption class="text-[10px] text-[var(--color-text-faint)] mt-0.5">Street View · nearest road imagery{typeof street.association?.distanceToParcelM === 'number' ? `, ${Math.round(street.association.distanceToParcelM)} m from the verified parcel point` : ''} · context only, not proof of frontage or access</figcaption>
          </figure>
        ) : streetUnavailable ? (
          <div class="text-[11px] text-[var(--color-text-muted)] rounded-lg border border-dashed border-[var(--color-border)] p-3 flex items-center">Street View unavailable — no imagery within the allowed context distance of the verified parcel location.</div>
        ) : null}
      </div>

      {/* Imagery source + date (honest when the source does not provide a date) */}
      <div class="text-[10px] text-[var(--color-text-faint)]">
        Imagery source: {ctx.provider === 'google' ? 'Google (Static Maps / Street View)' : ctx.provider}. Date: not provided by source. Supporting context only — never parcel identity.
      </div>

      {/* Links */}
      <div class="text-[12px] flex flex-wrap gap-x-4 gap-y-1">
        {ctx.links.maps && <a href={ctx.links.maps} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">Google Maps</a>}
        {ctx.links.streetView && <a href={ctx.links.streetView} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">Street View</a>}
        {ctx.links.earth && <a href={ctx.links.earth} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">Google Earth / 3D</a>}
      </div>
      {/* FUTURE MAP: replace the static figures above with a MapLibre canvas
          consuming { satellite tiles, parcelBoundary, comp pins, listing pins,
          flood/wetlands/slope layers, measurement tools }. The section contract
          (assets + links + optional parcelBoundary) is already shaped for it. */}
    </div>
  );
}

// ── Visual Intelligence — operator-grade multi-source visual workflow ────────
// The full Visuals tab already owns the verified parcel and Google imagery.
// This component adds only concise visual observations there, while the compact
// form supplies a parcel-scoped hero for multi-parcel roster entries.
interface ViSubject { address?: string | null; lat?: number | null; lng?: number | null }
interface ViAsset {
  source: string; label: string; state: 'captured' | 'unavailable' | 'blocked';
  imageRoute?: string; url?: string; storedPath?: string; timestamp: string;
  subject: ViSubject; blocker?: string; fallback?: boolean;
}
interface ViObservation { category: string; observation: string; signal: 'positive' | 'concern' | 'neutral'; confidence: string; sourceImage: string }
interface ViRecord {
  cardId: number; generatedAt: string; subject: ViSubject;
  sources: ViAsset[]; gallery: ViAsset[]; hero: ViAsset | null; heroReason: string;
  observations: ViObservation[]; observationSummary: string; note: string;
}

function VisualIntelligencePanel({ cardId, token, compact }: { cardId: number; token: string; compact?: boolean }) {
  const [rec, setRec] = useState<ViRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const withToken = (u: string) => (u.startsWith('/api/') ? `${u}&token=${encodeURIComponent(token)}` : u);

  async function load() {
    try { const r = await apiGet<{ record: ViRecord | null }>(`/api/landos/property-cards/${cardId}/visual-intelligence`); setRec(r.record); }
    catch (e: any) { setMsg(e?.message || String(e)); }
  }
  async function run() {
    setBusy(true); setMsg(null);
    try { const r = await apiPost<{ record: ViRecord }>(`/api/landos/property-cards/${cardId}/visual-intelligence`, {}); setRec(r.record); }
    catch (e: any) { setMsg(e?.message || String(e)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, [cardId]);

  const hero = rec?.hero ?? null;

  // Compact (Overview): hero image + one-line status roll-up + run button.
  if (compact) {
    const capturedCount = rec?.gallery?.length ?? 0;
    return (
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Visual Intelligence</span>
          <button type="button" onClick={() => void run()} disabled={busy} class="px-2 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40">{busy ? 'Running…' : rec ? 'Re-run' : 'Run'}</button>
        </div>
        {hero?.imageRoute ? (
          <figure class="m-0">
            <img src={withToken(hero.imageRoute)} alt={hero.label} class="w-full h-44 sm:h-52 object-cover rounded-lg border border-[var(--color-border)]" loading="lazy" />
            <figcaption class="text-[10px] text-[var(--color-text-faint)] mt-0.5">Hero · {hero.label} · visual signal only</figcaption>
          </figure>
        ) : (
          <div class="text-[11px] text-[var(--color-text-muted)] rounded-lg border border-dashed border-[var(--color-border)] p-3">
            {rec ? 'No hero image captured yet — open Property → Visuals for per-source blockers.' : 'Not run yet. Click Run to attempt all visual sources.'}
          </div>
        )}
        {rec && <div class="text-[10px] text-[var(--color-text-faint)]">{capturedCount} source(s) captured · {rec.observations.length} observation(s)</div>}
        {msg && <div class="text-[11px] text-rose-600">{msg}</div>}
      </div>
    );
  }

  // Full Visuals view: the verified parcel gallery and Google imagery already
  // render immediately above this panel. Keep this section focused on the
  // operator-facing interpretation instead of duplicating images or exposing
  // provider/session diagnostics.
  return (
    <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-3">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <span class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Visual observations</span>
        <button type="button" onClick={() => void run()} disabled={busy} class="px-2 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40">{busy ? 'Refreshing…' : 'Refresh observations'}</button>
      </div>
      <div class="text-[11px] text-[var(--color-text-muted)]">
        Verified parcel imagery and Google road context are shown above. Imagery supports screening only; it does not prove frontage, access, utilities, or buildability.
      </div>
      {!rec && <div class="text-[11px] text-[var(--color-text-muted)]">No visual observations have been saved yet.</div>}
      {rec && rec.observations.length > 0 && (
        <div class="space-y-1">
          {rec.observations.map((o) => (
            <div class="text-[12px] text-[var(--color-text-muted)]">
              <span class="text-[var(--color-text)]">{o.category.replace(/_/g, ' ')}:</span> {o.observation}
            </div>
          ))}
        </div>
      )}
      {rec && rec.observations.length === 0 && <div class="text-[11px] text-[var(--color-text-muted)]">No reliable visual observations were extracted from the saved imagery.</div>}

      {msg && <div class="text-[11px] text-rose-600">{msg}</div>}
    </div>
  );
}

// ── Activity timeline — real recorded Deal Card events ──────────────────────
// Renders the actual landos_card_activity events (report runs, visual
// intelligence/capture, comp research, inspections, notes, stage moves), newest
// first, with human labels + relative time. Never a fabricated timeline.
interface ActivityEventView { id: number; kind: string; summary: string; agentId: string; createdAt: number }
const ACTIVITY_KIND_LABEL: Record<string, string> = {
  property_inspection: 'Property Intelligence', landportal_inspection: 'LandPortal inspection',
  visual_intelligence: 'Visual Intelligence', visual_capture: 'Visual capture', vision_analysis: 'Vision analysis',
  market_pulse: 'Market Pulse', comparables_map: 'Comp research', market: 'Market update',
  duke_deal_writeback: 'Report writeback', note: 'Note', operator_override: 'Operator edit',
  operator_speech: 'Operator note', guard_block: 'Guard block', next_action: 'Next action',
  redfin_comp_status: 'Redfin comps', zillow_comp_status: 'Zillow comps',
  duke_verified_run: 'Property Intelligence (verified)', duke_unverified_run: 'Property Intelligence (unresolved)',
};
function activityKindLabel(kind: string): string {
  return ACTIVITY_KIND_LABEL[kind] ?? 'Activity';
}
function ActivityTimeline({ dealId }: { dealId: number }) {
  const [events, setEvents] = useState<ActivityEventView[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    apiGet<{ events: ActivityEventView[] }>(`/api/landos/deal-cards/${dealId}/activity`)
      .then((r) => { if (live) setEvents(r.events); })
      .catch((e: any) => { if (live) setMsg(e?.message || String(e)); });
    return () => { live = false; };
  }, [dealId]);
  if (msg) return <div class="text-[11px] text-[var(--color-status-failed)]">{msg}</div>;
  if (!events) return <Placeholder text="Loading activity…" />;
  const visibleEvents = events.filter((event) => !/(orchestrat|provider|contract|evidence|readiness|classified|attempt)/i.test(`${event.kind} ${event.summary}`));
  if (visibleEvents.length === 0) return <Placeholder text="No owner-facing activity recorded yet." />;
  return (
    <ol class="space-y-1.5 m-0 p-0 list-none">
      {visibleEvents.map((e) => (
        <li key={e.id} class="flex items-start gap-2 border-b border-[var(--color-border)]/60 pb-1.5">
          <span class="shrink-0 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-faint)]">{activityKindLabel(e.kind)}</span>
          <div class="min-w-0 flex-1">
            <div class="text-[12px] text-[var(--color-text)] break-words">{e.summary || activityKindLabel(e.kind)}</div>
            <div class="text-[10px] text-[var(--color-text-faint)]">{formatRelativeTime(e.createdAt)}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

// Small labeled value for the header / at-a-glance strips.
function HeaderField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div class="min-w-0">
      <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">{label}</div>
      <div class="text-[13px] text-[var(--color-text)] truncate font-medium">{value || '—'}</div>
    </div>
  );
}

// Property Header — large, readable identity line: seller, address, APN, county,
// state, acreage, verification, entity, stage. Pulls from the DD fact checklist.
function PropertyHeaderSection({ report, entity, stageLabel, seller, marketMatrix }: { report: ReportView; entity: string; stageLabel?: string; seller?: string; marketMatrix?: MarketMatrixView | null }) {
  const fact = (key: string): string | null => (report.ddFactChecklist ?? []).find((r) => r.key === key)?.value ?? null;
  const address = fact('situsAddress') ?? fact('address') ?? null;
  const apn = fact('apn') ?? fact('parcelId') ?? null;
  const county = fact('county') ?? null;
  const state = fact('state') ?? null;
  const acres = fact('acres') ?? null;
  return (
    <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-2">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[18px] font-semibold text-[var(--color-text)]">{address || 'Address pending verification'}</span>
        <span class={`text-[11px] px-2 py-0.5 rounded-full border ${report.parcelVerified ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]' : 'text-[var(--color-text-faint)] border-[var(--color-border)]'}`}>
          {report.parcelVerified ? 'Verified' : 'Needs Verification'}
        </span>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-2">
        <HeaderField label="Seller / Lead" value={seller} />
        <HeaderField label="APN" value={apn} />
        <HeaderField label="County" value={county} />
        <HeaderField label="State" value={state} />
        <HeaderField label="Acreage" value={acres} />
        <HeaderField label="Business entity" value={entity} />
        <HeaderField label="Stage" value={stageLabel} />
      </div>
      {/* Market Matrix intelligence for this property (compact) — same source of
          truth the Discovery Call Report uses. */}
      {marketMatrix && <MarketMatrixPanel mm={marketMatrix} compact />}
    </div>
  );
}

// At-A-Glance — the one-line answer strip directly under the header.
function AtAGlanceStrip({ report, propertyType }: { report: ReportView; propertyType?: PropertyTypeView | null }) {
  const fact = (key: string): string | null => (report.ddFactChecklist ?? []).find((r) => r.key === key)?.value ?? null;
  const g = (report as { govDd?: { flood?: { status: string; zone: string | null }; wetlands?: { status: string; type: string | null }; slope?: { status: string; slopeDeg: number | null } } }).govDd;
  // Single truth: the strip reads the SAME reconciled primaries the Reconciled
  // facts panel shows — it can never say "Present" while reconciliation says
  // "None mapped". Gov-DD is only the fallback when reconciliation has no value.
  const rec = report.reconciliation;
  const floodPrimary = rec?.flood?.primary ?? (g?.flood?.status === 'verified' ? g.flood.zone : null);
  const floodTxt = floodPrimary ? (/^x$/i.test(floodPrimary) ? 'Zone X (min.)' : /zone/i.test(floodPrimary) ? floodPrimary : `Zone ${floodPrimary}`) : 'Unknown';
  const wetPrimary = rec?.wetlands?.primary ?? (g?.wetlands?.status === 'verified' ? g.wetlands.type : null);
  const wetTxt = wetPrimary ? (/none|no wetland|0\s*%/i.test(wetPrimary) ? 'None mapped' : wetPrimary) : 'Unknown';
  const slopePrimary = rec?.slope?.primary ?? (g?.slope?.status === 'verified' && g.slope.slopeDeg != null ? `${g.slope.slopeDeg}°` : null);
  const slopeTxt = slopePrimary ? `~${slopePrimary.replace(/^~/, '')}` : 'Unknown';
  const improved = propertyType?.vacantOrImproved || 'Unknown';
  const cells: Array<{ label: string; value: string }> = [
    { label: 'Verified', value: report.parcelVerified ? 'Yes' : 'No' },
    { label: 'Property type', value: propertyType?.propertyType || (fact('landUse') ?? 'Unknown') },
    { label: 'Land use', value: fact('landUse') ?? 'Unknown' },
    { label: 'Flood', value: floodTxt },
    { label: 'Wetlands', value: wetTxt },
    { label: 'Slope', value: slopeTxt },
    { label: 'Improvement', value: improved },
  ];
  return (
    <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-elevated)] p-3">
      <div class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)] mb-2">At a Glance</div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
        {cells.map((c) => <HeaderField key={c.label} label={c.label} value={c.value} />)}
      </div>
    </div>
  );
}

// Market Pulse — the completed market read. Phase 7 priorities: land $/ac by
// acreage band, overall county $/ac, active land asking prices, and REAL named
// local developments / rezonings / infrastructure — then what it means for buying
// land here. Absorption metrics (DOM / months-of-inventory / sell-through) are
// deprioritized to a secondary line.
interface MarketPulseView {
  soldCount: number; activeCount: number;
  pricePerAcre: { p25: number | null; median: number | null; p75: number | null };
  domMedian: number | null; monthsOfInventory: number | null; sellThroughPct: number | null;
  direction: string; directionPct: number | null;
  supply: string; demand: string; liquidity: string; absorption: string;
  confidence: string; interpretation: string; verdict: string;
  growthDrivers: { available: boolean; summary: string; whatThisMeans: string; drivers: Array<{ category: string; count: number; examples: string[]; whyItMatters?: string }> };
}

function median(xs: number[]): number | null {
  const s = xs.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

// Land $/ac binned by acreage band (computed from the verified sold comps — no
// new provider). Empty bands are dropped.
function ppaByAcreageBand(rows: MarketCompRowView[]): Array<{ band: string; ppa: number; count: number }> {
  const bands: Array<{ band: string; lo: number; hi: number }> = [
    { band: '<2 ac', lo: 0, hi: 2 }, { band: '2–5 ac', lo: 2, hi: 5 }, { band: '5–10 ac', lo: 5, hi: 10 },
    { band: '10–20 ac', lo: 10, hi: 20 }, { band: '20–50 ac', lo: 20, hi: 50 }, { band: '50+ ac', lo: 50, hi: Infinity },
  ];
  return bands.map((b) => {
    const ppas = rows.filter((r) => r.acres != null && r.pricePerAcre != null && r.acres >= b.lo && r.acres < b.hi).map((r) => r.pricePerAcre as number);
    return { band: b.band, ppa: median(ppas) ?? 0, count: ppas.length };
  }).filter((x) => x.count > 0);
}
// Land Score — the deterministic 100-point rubric, rendered inline in the report
// from the SAME verified property data (never a separate re-resolve). Missing
// source fields score 0 as loud data gaps, never inferred. Honest empty state
// when the parcel is not source-verified.
function landScoreVerdictClass(verdict: string, dataLimited: boolean): string {
  // A verdict driven by missing enrichment (severely reduced confidence) is NOT a
  // real pass/fail — never color it red/green, or the operator misreads a
  // data-starved parcel as a confirmed bad deal.
  if (dataLimited) return 'text-[var(--color-text-muted)] border-[var(--color-border)]';
  const v = (verdict || '').toLowerCase();
  if (/pursue|strong|good|buy/.test(v)) return 'text-[var(--color-status-done)] border-[var(--color-status-done)]';
  if (/pass|avoid|poor|weak/.test(v)) return 'text-[var(--color-status-failed)] border-[var(--color-status-failed)]';
  return 'text-[var(--color-text-muted)] border-[var(--color-border)]';
}
function LandScoreSection({ ls, parcelVerified }: { ls?: LandScoreView | null; parcelVerified: boolean }) {
  const gapCount = ls ? ls.factors.filter((f) => f.dataGap).length : 0;
  const dataLimited = !!ls && (ls.confidence === 'severely_reduced' || gapCount >= 3);
  return (
    <Section title="Land Score">
      {!ls && (
        <div class="text-[12px] text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-lg p-3">
          {parcelVerified
            ? 'Land Score pending — re-run the report to compute the 100-point rubric from the verified parcel data.'
            : 'Land Score is only computed once parcel identity is source-verified (never scored from unverified data).'}
        </div>
      )}
      {ls && (
        <div>
          <div class="flex items-center gap-3 flex-wrap mb-3">
            <span class="text-[26px] font-semibold tabular-nums leading-none">
              {ls.score}<span class="text-[15px] text-[var(--color-text-faint)]">/{ls.maxScore}</span>
            </span>
            <span class={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${landScoreVerdictClass(ls.verdict, dataLimited)}`}>
              {dataLimited ? 'Data-limited' : ls.verdict}
            </span>
          </div>
          {dataLimited && (
            <div class="mb-3 rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] px-2.5 py-1.5 text-[11px] text-[var(--color-text-muted)]">
              This score is limited by {gapCount} missing data point{gapCount === 1 ? '' : 's'} (scored 0, never guessed) — it reflects incomplete enrichment, not a confirmed poor property. Verify access, wetlands, flood, slope, and valuation to get a real score.
            </div>
          )}
          <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
            {ls.factors.map((f) => {
              const pct = f.maxPoints > 0 ? Math.round((f.points / f.maxPoints) * 100) : 0;
              return (
                <div key={f.id}>
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-[11px] text-[var(--color-text-muted)]">
                      {f.label}
                      {f.dataGap && <span class="text-[var(--color-status-failed)]"> · data gap</span>}
                    </span>
                    <span class="text-[11px] tabular-nums text-[var(--color-text)]">{f.points}/{f.maxPoints}</span>
                  </div>
                  <div class="h-1.5 rounded-full bg-[var(--color-border)] overflow-hidden mt-0.5">
                    <div
                      class={`h-full rounded-full ${f.dataGap ? 'bg-[var(--color-status-failed)]' : 'bg-[var(--color-accent)]'}`}
                      style={{ width: `${f.dataGap ? 100 : pct}%`, opacity: f.dataGap ? 0.35 : 1 }}
                    />
                  </div>
                  {f.basis && <div class="text-[9.5px] text-[var(--color-text-faint)] mt-0.5">{f.basis}</div>}
                </div>
              );
            })}
          </div>
          {ls.flags.length > 0 && <DdList title="Score flags" items={ls.flags} empty="No flags" />}
        </div>
      )}
    </Section>
  );
}

function MarketPulseSection({ mp, mc, registry }: { mp?: MarketPulseView | null; mc?: MarketCompsView | null; registry?: CompRegistryView | null }) {
  if (!mp) return null;
  const usd = (n: number | null) => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`);
  // One-point honesty: a single validated closed sale is never a median, band,
  // sell-through, or demand read. Statistics render only from ≥3 closed sales.
  const soldBasis = registry?.counts.validatedSold ?? (mc?.soldCount ?? 0);
  const statsSupported = soldBasis >= 3;
  // A softening/mixed read is caution, not failure — amber, never alarm-red.
  const dirTone = mp.direction === 'strengthening' ? 'text-[var(--color-status-done)]' : mp.direction === 'softening' ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--color-text)]';

  // Derive period + named sources + active-retrieval status from existing comp
  // data (no new providers). "Active" is only a real count when retrieval ran.
  const canonicalRows = (rows: CompRegistryView['validatedSold']): MarketCompRowView[] => rows.map((row) => ({
    price: row.primary.price ?? 0,
    saleDateIso: row.primary.dateIso ?? '',
    acres: row.acresDisplay ?? row.acres,
    pricePerAcre: row.primary.pricePerAcre,
    sourceUrl: row.transactions.flatMap((transaction) => transaction.sourceUrls).find(Boolean) ?? '',
    sourceLabel: row.providers.join(', '),
    addressDesc: row.address ?? undefined,
  }));
  const soldRows = registry ? canonicalRows(registry.validatedSold) : (mc?.sold ?? []);
  const soldDates = soldRows.map((r) => r.saleDateIso).filter(Boolean).sort() as string[];
  const period = soldDates.length ? `${soldDates[0]} → ${soldDates[soldDates.length - 1]}` : 'no dated sold comps';
  const uniq = (xs: Array<string | undefined>) => Array.from(new Set(xs.filter(Boolean) as string[]));
  const soldSrc = uniq(soldRows.map((r) => r.sourceLabel)).join(', ') || (mc?.providerChain?.find((c) => /realie|homeharvest/i.test(c)) ?? 'none');
  const activeRows = registry ? canonicalRows(registry.validatedActive) : (mc?.active ?? []);
  const activeSrc = uniq(activeRows.map((r) => r.sourceLabel)).join(', ') || (mc?.providerChain?.find((c) => /apify|zillow|realtor/i.test(c)) ?? 'none');
  const activeState = mc ? activeRetrievalState(mc) : 'not_run';
  const activeBasis = registry?.counts.validatedActive ?? mp.activeCount;
  const activeStatusTxt = registry
    ? `${activeBasis} validated active listing${activeBasis === 1 ? '' : 's'}`
    : activeState === 'ran' ? `ran (${activeBasis} found)` : activeState === 'not_run' ? 'not run yet' : 'incomplete (provider error/timeout)';

  // Land $/ac by acreage band + active land asking prices (from existing comps).
  const bands = ppaByAcreageBand(soldRows);
  const activeAsks = activeRows.map((r) => r.price).filter((p): p is number => p != null);
  const askLo = activeAsks.length ? Math.min(...activeAsks) : null;
  const askMed = median(activeAsks);
  const askHi = activeAsks.length ? Math.max(...activeAsks) : null;

  // Named local signals + whether they help or hurt land demand.
  const drivers = mp.growthDrivers.drivers ?? [];
  const helpHurt = mp.direction === 'strengthening' ? 'Helps land demand'
    : mp.direction === 'softening' ? 'Pressures land demand'
    : drivers.length > 0 ? 'Mildly supportive of land demand' : 'Neutral for land demand';

  return (
    <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-3">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[14px] font-semibold">Market Pulse</span>
        <span class="text-[11px] px-2 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-faint)]">confidence {mp.confidence}</span>
      </div>
      {/* Headline verdict — never claims land-market direction off thin closed-sale evidence. */}
      {statsSupported ? (
        <div class={`text-[14px] font-medium ${dirTone}`}>{mp.verdict}</div>
      ) : (
        <div class="text-[14px] font-medium text-[var(--color-text)]">
          Population growing; land-market direction unresolved.
          <div class="text-[12px] font-normal text-[var(--color-text-muted)] mt-0.5">Population/context signals exist, but only {soldBasis} validated closed sale{soldBasis === 1 ? '' : 's'} — population growth does not prove land-price or buyer-demand growth.</div>
        </div>
      )}

      {/* Land $/ac statistics only render from an adequate closed-sale base —
          a single sale is never a median, band, or acreage-band statistic. */}
      {statsSupported ? (
        <>
          <div>
            <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Land $/ac by acreage band</div>
            {bands.length > 0 ? (
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 mt-1">
                {bands.map((b) => <HeaderField key={b.band} label={`${b.band} (${b.count})`} value={`${usd(b.ppa)}/ac`} />)}
              </div>
            ) : <div class="text-[11px] text-[var(--color-text-faint)] mt-1">Not enough dated sold comps to band by acreage yet.</div>}
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
            <HeaderField label="County median $/ac" value={usd(mp.pricePerAcre.median)} />
            <HeaderField label="County $/ac band" value={`${usd(mp.pricePerAcre.p25)}–${usd(mp.pricePerAcre.p75)}`} />
            <HeaderField label="Active asking (land)" value={activeState === 'ran' && askMed != null ? `${usd(askLo)}–${usd(askHi)}` : activeState === 'ran' ? 'none found' : activeState === 'not_run' ? 'not run' : 'incomplete'} />
            <HeaderField label="Active median ask" value={activeState === 'ran' && askMed != null ? usd(askMed) : '—'} />
          </div>
        </>
      ) : (
        <div class="rounded-md border border-[var(--color-border)] p-2.5 text-[12.5px] leading-relaxed text-[var(--color-text-muted)]">
          Closed-sale statistics unavailable: {soldBasis} validated closed sale{soldBasis === 1 ? '' : 's'} is not a market. No median, $/ac band, acreage-band statistic, sell-through, or absorption is computed from it — see the comp clusters in the unique comparable registry for the honest thin-market read.
        </div>
      )}

      {/* PRIORITY 3 — REAL named local developments / rezonings / infrastructure. */}
      <div class="border-t border-[var(--color-border)] pt-2">
        <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Local developments · rezonings · subdivisions · roads · utilities · employers</div>
        {drivers.length > 0 ? (
          <ul class="mt-1 space-y-0.5">
            {drivers.map((d, i) => (
              <li key={i} class="text-[12px] text-[var(--color-text-muted)]">
                <span class="text-[var(--color-text)]">{d.category}</span> <span class="text-[10px] text-[var(--color-text-faint)]">×{d.count}</span>
                {d.examples && d.examples.length > 0 && <span class="text-[11px] text-[var(--color-text-faint)]"> — {d.examples.join('; ')}</span>}
                {d.whyItMatters && <div class="text-[11px] text-[var(--color-accent)] ml-3">Why it matters: {d.whyItMatters}</div>}
              </li>
            ))}
          </ul>
        ) : (
          <div class="text-[11px] text-[var(--color-text-faint)] mt-1">Growth research incomplete — no signals retrieved yet. This is NOT evidence of neutral demand, no catalysts, or no development activity.</div>
        )}
        {drivers.length > 0 && <div class="text-[12px] text-[var(--color-text-muted)] mt-1">{mp.growthDrivers.summary}</div>}
        {drivers.length > 0 && <div class="text-[11px] text-[var(--color-text)] mt-1"><span class="text-[var(--color-text-faint)]">Effect on land demand:</span> {helpHurt}.</div>}
        {drivers.length > 0 && <div class="text-[12px] text-[var(--color-accent)] mt-1">What this means for buying land here: {mp.growthDrivers.whatThisMeans}</div>}
      </div>

      {/* Context: sources / period / active-retrieval status. */}
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 border-t border-[var(--color-border)] pt-2">
        <HeaderField label="Sold period" value={period} />
        <HeaderField label="Sold source" value={soldSrc} />
        <HeaderField label="Active source" value={activeSrc} />
        <HeaderField label="Active retrieval" value={activeStatusTxt} />
      </div>
      <div class="text-[12px] text-[var(--color-text-muted)]">{mp.interpretation}</div>

      {/* Absorption metrics only from an adequate closed-sale base — a 1-sale
          "100% sell-through" is meaningless and never shown. */}
      {statsSupported && (
        <div class="text-[10px] text-[var(--color-text-faint)]">
          Absorption (secondary): days on market {mp.domMedian != null ? `~${mp.domMedian}` : '—'} · months of inventory {mp.monthsOfInventory != null ? mp.monthsOfInventory : '—'} · sell-through {mp.sellThroughPct != null ? `${mp.sellThroughPct}%` : '—'} · trend {mp.direction}{mp.directionPct != null ? ` (${mp.directionPct > 0 ? '+' : ''}${mp.directionPct}%)` : ''}.
        </div>
      )}
    </div>
  );
}

// Human-readable report status.
function reportStatusText(status?: string): string {
  switch (status) {
    case 'running': return 'Running';
    case 'complete': return 'Complete';
    case 'complete_with_gaps': return 'Complete with gaps';
    case 'blocked': return 'Blocked';
    case 'failed': return 'Failed';
    case 'not_run':
    default: return 'Not run';
  }
}

// Report status badge. Complete reads as accent; blocked/failed as failed;
// everything else neutral so an un-run report never looks finished. When the
// shared report-readiness classification is available it is the operator label
// (a generator finishing is NOT completed research or decision readiness).
function ReportStatusBadge({ status, readiness }: { status?: string; readiness?: { label: string; why: string } | null }) {
  const good = status === 'complete';
  const bad = status === 'blocked' || status === 'failed';
  const cls = good
    ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
    : bad
      ? 'border-[var(--color-status-failed)] text-[var(--color-status-failed)]'
      : 'border-[var(--color-border)] text-[var(--color-text-muted)]';
  if (readiness) {
    return (
      <span class={`text-[10px] px-1.5 py-0.5 rounded-full border ${cls}`} title={readiness.why}>
        {readiness.label}
      </span>
    );
  }
  return (
    <span class={`text-[10px] px-1.5 py-0.5 rounded-full border ${cls}`}>
      Report: {reportStatusText(status)}
    </span>
  );
}

interface PropertyCardLite {
  id: number;
  active_input_address?: string | null;
  apn?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  owner?: string | null;
  acres?: number | null;
  zoning?: string | null;
  verification_status?: string | null;
  open_risks?: string | null;
  lp_url?: string | null;
}

interface PersonLite {
  name?: string | null;
  role?: string | null;
  authority_status?: string | null;
  phone?: string | null;
  email?: string | null;
  mailing_address?: string | null;
}

interface DealCardDetail {
  id: number;
  entity: string | null;
  title: string;
  status: string;
  seller_notes: string;
  asking_price: number | null;
  combined_strategy: string;
  package_notes: string;
  combined_acreage: number | null;
  propertyCards?: PropertyCardLite[];
  people?: PersonLite[];
}

// A row in the saved-cards list (the list route returns the flat deal row).
interface DealCardListItem {
  id: number;
  entity: string | null;
  title: string;
  status: string;
  asking_price: number | null;
  updated_at: number;
  lead_type?: string;
  deleted_at?: number | null;
  reportSummary?: { exists: boolean; reportStatus: string; parcelVerified: boolean; ddPercentComplete: number; generatedAt: number | null };
}

const LEAD_TYPE_LABELS: Record<string, string> = { actual: 'Actual Lead', test: 'TEST LEAD', research: 'Research Lead', imported: 'Imported Lead', manual: 'Manual Lead' };

// Lead-type badge. TEST LEAD is deliberately loud (amber, bordered) so test
// records are never mistaken for real seller leads anywhere in LandOS.
function LeadTypeBadge({ leadType }: { leadType?: string }) {
  const lt = leadType ?? 'actual';
  if (lt === 'actual') return null;
  const tone = lt === 'test'
    ? 'text-[#b45309] border-[#f59e0b] bg-[#fef3c7]'
    : 'text-[var(--color-text-muted)] border-[var(--color-border)]';
  return <span class={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${tone}`}>{LEAD_TYPE_LABELS[lt] ?? lt}</span>;
}

// DD completeness chip for list/board rows.
function DdChip({ s }: { s?: DealCardListItem['reportSummary'] }) {
  if (!s || !s.exists) {
    return <span class="text-[10px] px-1.5 py-0.5 rounded-full border text-[var(--color-text-faint)] border-[var(--color-border)]">DD: not run</span>;
  }
  const pct = s.ddPercentComplete;
  const tone = s.parcelVerified ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]' : 'text-[var(--color-text-faint)] border-[var(--color-border)]';
  return (
    <span class={`text-[10px] px-1.5 py-0.5 rounded-full border tabular-nums ${tone}`} title={`Parcel ${s.parcelVerified ? 'verified' : 'unverified'} · DD ${pct}%`}>
      {s.parcelVerified ? 'DD' : 'DD (unverified)'} {pct}%
    </span>
  );
}

function entityBadge(entity: string | null): string {
  if (entity === 'LAND_ALLY') return 'Land Ally';
  if (entity === 'TY_LAND_BIZ') return 'My Business';
  return 'Unknown';
}

function Placeholder({ text = 'Not captured yet' }: { text?: string }) {
  return <span class="text-[12px] text-[var(--color-text-faint)] italic">{text}</span>;
}

function Section({ title, children }: { title: string; children: any }) {
  return (
    <section class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <h3 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">{title}</h3>
      {children}
    </section>
  );
}

// Collapsible — same chrome as Section but collapsed by default (native <details>).
// Used to demote legacy worksheets, contacts, comms, documents, and call prep out
// of the default DD operator brief without removing them.
function Collapsible({ title, children, defaultOpen = false }: { title: string; children: any; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
      <summary class="cursor-pointer px-4 py-3 text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">{title}</summary>
      <div class="px-4 pb-4">{children}</div>
    </details>
  );
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  const has = value !== undefined && value !== null && value !== '';
  return (
    <div class="flex justify-between gap-3 py-0.5">
      <span class="text-[11px] text-[var(--color-text-muted)]">{label}</span>
      {has ? <span class="text-[12px] text-[var(--color-text)] text-right">{value}</span> : <Placeholder />}
    </div>
  );
}

// Human-readable parcel identity status + the verification color cue.
function identityStatusText(status?: string): string {
  switch (status) {
    case 'source_verified': return 'Source verified';
    case 'apn_provided': return 'APN provided (needs source)';
    case 'address_only': return 'Address only (needs source)';
    case 'seller_stated': return 'Seller stated';
    case 'unknown': return 'Unknown';
    case 'local_area_context_not_verified':
    default: return 'Local Area Context, Not Parcel Verified';
  }
}

function DdIdentityBadge({ status }: { status?: string }) {
  const verified = status === 'source_verified';
  const cls = verified
    ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
    : 'border-[var(--color-border)] text-[var(--color-text-muted)]';
  return (
    <span class={`text-[10px] px-1.5 py-0.5 rounded-full border ${cls}`}>
      Identity: {identityStatusText(status)}
    </span>
  );
}

// A small confidence-label pill. 'Verified' is the only "trusted" cue; every
// other label reads as not-yet-verified so research data never looks verified.
function DdLabelPill({ label }: { label?: string }) {
  if (!label) return null;
  const verified = label === 'Verified';
  const cls = verified
    ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
    : 'border-[var(--color-border)] text-[var(--color-text-faint)]';
  return <span class={`ml-2 text-[9px] px-1 py-0.5 rounded-full border ${cls} whitespace-nowrap`}>{label}</span>;
}

// A DD field row: value (or a missing placeholder) plus its confidence label.
function LabeledField({ label, value, confidence }: { label: string; value?: string | number | null; confidence?: string }) {
  const has = value !== undefined && value !== null && value !== '';
  return (
    <div class="flex justify-between items-center gap-3 py-0.5">
      <span class="text-[11px] text-[var(--color-text-muted)]">{label}</span>
      <span class="flex items-center text-right">
        {has ? <span class="text-[12px] text-[var(--color-text)]">{value}</span> : <Placeholder text="Missing" />}
        <DdLabelPill label={confidence} />
      </span>
    </div>
  );
}

// Human-readable offer-readiness label.
function readinessText(status?: string): string {
  switch (status) {
    case 'ready_for_offer': return 'Ready for offer';
    case 'needs_confirmation': return 'Needs confirmation';
    case 'blocked': return 'Blocked';
    case 'pass': return 'Pass';
    case 'not_reviewed':
    default: return 'Not reviewed';
  }
}

// Legacy offer-readiness badge removed: readiness renders ONLY from the shared
// unified readiness record (UnifiedReadinessStrip) — no private badge logic.

// A read-only strategy note row. Renders an honest placeholder when empty so a
// blank strategy lane never looks analyzed.
function StrategyNote({ label, value }: { label: string; value?: string }) {
  return (
    <div class="mt-2">
      <div class="text-[11px] text-[var(--color-text-muted)] mb-1">{label}</div>
      {value ? <span class="text-[12px] text-[var(--color-text)] whitespace-pre-wrap break-words">{value}</span> : <Placeholder text="Not reviewed" />}
    </div>
  );
}

// Human-readable market demand label.
function demandText(label?: string): string {
  switch (label) {
    case 'weak_demand': return 'Weak demand';
    case 'moderate_demand': return 'Moderate demand';
    case 'strong_demand': return 'Strong demand';
    case 'mixed_uncertain': return 'Mixed / uncertain';
    case 'needs_research': return 'Needs research';
    case 'not_reviewed':
    default: return 'Not reviewed';
  }
}

// Human-readable source-confidence label.
function sourceConfidenceText(label?: string): string {
  switch (label) {
    case 'low': return 'Low';
    case 'medium': return 'Medium';
    case 'high': return 'High';
    case 'needs_research': return 'Needs research';
    case 'unknown':
    default: return 'Unknown';
  }
}

// A demand pill. Only 'strong_demand' reads as an accent (positive) cue; every
// other label reads as neutral so an unreviewed lane never looks like a verified
// market conclusion. Market demand is never a comp, price, or value.
function MarketDemandBadge({ label, prefix }: { label?: string; prefix?: string }) {
  const strong = label === 'strong_demand';
  const cls = strong
    ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
    : 'border-[var(--color-border)] text-[var(--color-text-muted)]';
  return (
    <span class={`text-[10px] px-1.5 py-0.5 rounded-full border ${cls} whitespace-nowrap`}>
      {prefix ? `${prefix}: ` : ''}{demandText(label)}
    </span>
  );
}

// A market demand lane: a note (or honest placeholder) plus its demand label.
function MarketDemandLane({ label, note, demand }: { label: string; note?: string; demand?: string }) {
  return (
    <div class="mt-2">
      <div class="flex items-center justify-between gap-2 mb-1">
        <span class="text-[11px] text-[var(--color-text-muted)]">{label}</span>
        <MarketDemandBadge label={demand} />
      </div>
      {note ? <span class="text-[12px] text-[var(--color-text)] whitespace-pre-wrap break-words">{note}</span> : <Placeholder text="Needs research" />}
    </div>
  );
}

// A read-only market context note row (listing / sold / days-on-market / growth /
// region). Renders an honest placeholder when empty so a blank lane never looks
// like a fabricated market fact.
function MarketNote({ label, value }: { label: string; value?: string }) {
  return (
    <div class="mt-2">
      <div class="text-[11px] text-[var(--color-text-muted)] mb-1">{label}</div>
      {value ? <span class="text-[12px] text-[var(--color-text)] whitespace-pre-wrap break-words">{value}</span> : <Placeholder text="Not reviewed" />}
    </div>
  );
}

function DdList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div class="mt-3">
      <div class="text-[11px] text-[var(--color-text-muted)] mb-1">{title}</div>
      {items.length === 0 ? (
        <Placeholder text={empty} />
      ) : (
        <ul class="list-disc pl-4 space-y-0.5">
          {items.map((it) => <li key={it} class="text-[12px] text-[var(--color-text)] break-words">{it}</li>)}
        </ul>
      )}
    </div>
  );
}

// ── Business Object Spine v1 (canonical projection) ────────────────────────
// The authoritative decision-grade layer. The Deal Card RENDERS these objects
// in plain business language; it is not the database of truth. Shape mirrors
// BusinessObjectBundle in src/landos/business-object-spine.ts.
interface SpineFactSlot { field: string; value: string | number | null; known: boolean; label: string; verified: boolean; evidenceRefs: string[] }
interface SpineSourceEvidence { sourceId: string; classification: string; sourceName: string; sourceUrlOrRef: string; reliability: string; usableForOfferLogic: boolean; cardId?: number; note: string }
interface SpineVerificationTask { taskId: string; criticality: string; question: string; reason: string; recommendedSource: string; ownerDepartment: string; blocking: boolean }
interface SpineCriticalFact { key: string; label: string; state: 'confirmed' | 'needs_evidence' | 'absent'; value?: string; detail: string }
interface SpineHeader {
  stage: string; parcelCompleteness: number; decisionConfidence: string; decisionGrade: boolean;
  decisionGradeReason: string; missingCriticalInfo: string[]; criticalFacts?: SpineCriticalFact[]; blockingVerificationTasks: SpineVerificationTask[];
  nextBestAction: string; nextActionOwner: string;
}
interface SpinePacket {
  owner: SpineFactSlot; apn: SpineFactSlot; county: SpineFactSlot; state: SpineFactSlot;
  location: SpineFactSlot; acreage: SpineFactSlot; parcelIdentityVerified: boolean; parcelIdentityStatus: string;
  parcelCompletenessScore: number; decisionGrade: boolean; decisionGradeReason: string;
  missingCriticalInfo: string[]; sourceEvidence: SpineSourceEvidence[]; verificationTasks: SpineVerificationTask[];
}
interface SpineLeadIntake { provided: Record<string, unknown>; sellerStatedFacts: Array<{ kind: string; value: string }>; intakeConfidence: string }
interface BusinessSpineView {
  header: SpineHeader; propertyIntelligence: SpinePacket;
  opportunity: { nextBestAction: string; nextActionOwner: string; decisionConfidence: string; criticalBlockers: string[] };
  leadIntake: SpineLeadIntake; sourceEvidence: SpineSourceEvidence[]; verificationTasks: SpineVerificationTask[];
}
interface BlockAnswerView {
  decisionGrade: boolean; decisionConfidence: string; answer: string; blockers: string[];
  nextBestAction: string; nextActionOwner: string; blockingTasks: SpineVerificationTask[];
}

function ownerDeptLabel(d: string): string {
  return d === 'due-diligence-research' ? 'Due Diligence' : d === 'strategy' ? 'Strategy' : d.replace(/[-_]/g, ' ');
}

function SpineFact({ label, slot }: { label: string; slot?: SpineFactSlot }) {
  const known = slot?.known;
  const tone = slot?.verified ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]'
    : known ? 'text-[var(--color-accent)] border-[var(--color-accent)]'
    : 'text-[var(--color-text-faint)] border-[var(--color-border)]';
  return (
    <div class="flex items-baseline gap-2 text-[12px]">
      <span class="text-[var(--color-text-faint)] w-28 shrink-0">{label}</span>
      <span class="text-[var(--color-text)] flex-1 break-words">{known ? String(slot!.value) : '—'}</span>
      <span class={`text-[10px] px-1.5 py-0.5 rounded-full border shrink-0 ${tone}`}>{slot?.label ?? 'Not checked'}</span>
    </div>
  );
}

// The FIRST thing on an open Deal Card: what LandOS found, what's missing, the
// evidence, whether it's decision-grade, what's blocking, and the next action —
// all sourced from the canonical Business Object Spine, in plain language.
function BusinessSpineSection({ spine, dealId }: { spine: BusinessSpineView | null; dealId: number }) {
  const [ans, setAns] = useState<BlockAnswerView | null>(null);
  const [busy, setBusy] = useState(false);
  if (!spine) return null;
  const h = spine.header;
  const pkt = spine.propertyIntelligence;
  const dg = h.decisionGrade;
  const frame = dg ? 'border-[var(--color-status-done)]'
    : h.decisionConfidence === 'blocked' ? 'border-[var(--color-status-failed)]'
    : 'border-[var(--color-accent)]';
  const dgTone = dg ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]'
    : 'text-[var(--color-status-failed)] border-[var(--color-status-failed)]';

  async function checkBlockers() {
    setBusy(true);
    try { const r = await apiGet<{ blockers: BlockAnswerView }>(`/api/landos/deal-cards/${dealId}/blockers`); setAns(r.blockers); }
    catch { /* header already shows the blockers */ }
    finally { setBusy(false); }
  }

  return (
    <div class={`rounded-lg border ${frame} bg-[var(--color-card)] p-4 space-y-3`}>
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text)]">Business Intelligence</span>
        <span class={`text-[11px] px-2 py-0.5 rounded-full border ${dgTone}`}>{dg ? 'Decision-grade' : 'Not decision-grade'}</span>
        <span class="text-[11px] px-2 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">Stage: {h.stage}</span>
        <span class="text-[11px] px-2 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">Confidence: {h.decisionConfidence}</span>
        <span class="ml-auto text-[11px] px-2 py-0.5 rounded-full border border-[var(--color-border)] tabular-nums">Parcel completeness: {h.parcelCompleteness}%</span>
      </div>
      <div class="text-[11px] text-[var(--color-text-muted)]">{pkt.decisionGradeReason}</div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
        {/* What LandOS found */}
        <div class="space-y-1">
          <div class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">What LandOS found</div>
          <SpineFact label="Owner" slot={pkt.owner} />
          <SpineFact label="APN / parcel" slot={pkt.apn} />
          <SpineFact label="Acreage" slot={pkt.acreage} />
          <SpineFact label="County" slot={pkt.county} />
          <SpineFact label="State" slot={pkt.state} />
          <SpineFact label="Location" slot={pkt.location} />
          <div class="flex items-baseline gap-2 text-[12px]">
            <span class="text-[var(--color-text-faint)] w-28 shrink-0">Parcel identity</span>
            <span class={`text-[10px] px-1.5 py-0.5 rounded-full border ${pkt.parcelIdentityVerified ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]' : 'text-[var(--color-text-faint)] border-[var(--color-border)]'}`}>
              {pkt.parcelIdentityVerified ? 'Verified' : pkt.parcelIdentityStatus.replace(/_/g, ' ')}
            </span>
          </div>
        </div>

        {/* Critical facts — accurate state per fact. A KNOWN-but-unconfirmed fact
            is NOT "missing": it reads "on record, needs official confirmation".
            Only genuinely-absent facts read as missing. Falls back to the flat
            list if an older backend has no criticalFacts. */}
        <div class="space-y-1">
          <div class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">Critical facts</div>
          {h.criticalFacts && h.criticalFacts.length > 0 ? (
            <ul class="space-y-0.5">
              {h.criticalFacts.map((f) => {
                const tone = f.state === 'confirmed'
                  ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]'
                  : f.state === 'needs_evidence'
                    ? 'text-[var(--color-accent)] border-[var(--color-accent)]'
                    : 'text-[var(--color-status-failed)] border-[var(--color-status-failed)]';
                const chip = f.state === 'confirmed' ? 'Confirmed' : f.state === 'needs_evidence' ? 'On record · needs evidence' : 'Not found';
                return (
                  <li key={f.key} class="text-[12px] flex items-baseline gap-2">
                    <span class={`text-[10px] px-1.5 py-0.5 rounded-full border shrink-0 ${tone}`}>{chip}</span>
                    <span class="text-[var(--color-text)]">{f.label}{f.value ? <span class="text-[var(--color-text-muted)]"> — {f.value}</span> : null}</span>
                  </li>
                );
              })}
            </ul>
          ) : h.missingCriticalInfo.length === 0
            ? <div class="text-[12px] text-[var(--color-status-done)]">Nothing critical missing.</div>
            : <ul class="list-disc pl-4 space-y-0.5 text-[12px] text-[var(--color-status-failed)]">{h.missingCriticalInfo.map((m, i) => <li key={i}>{m}</li>)}</ul>}
        </div>
      </div>

      {/* Evidence supporting the facts */}
      <div>
        <div class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Evidence ({spine.sourceEvidence.length})</div>
        {spine.sourceEvidence.length === 0
          ? <div class="text-[12px] text-[var(--color-text-faint)]">No source evidence attached yet.</div>
          : (
            <ul class="space-y-0.5">
              {spine.sourceEvidence.slice(0, 8).map((e, i) => (
                <li key={i} class="text-[11px] text-[var(--color-text-muted)] flex items-center gap-2">
                  <span class={`text-[10px] px-1.5 py-0.5 rounded-full border ${e.usableForOfferLogic ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]' : 'border-[var(--color-border)] text-[var(--color-text-faint)]'}`}>{e.classification}</span>
                  <span class="text-[var(--color-text)]">{e.sourceName}</span>
                  <span class="text-[10px] text-[var(--color-text-faint)]">· {e.reliability}{e.usableForOfferLogic ? ' · offer-usable' : ''}</span>
                  {e.sourceUrlOrRef && /^https?:/i.test(e.sourceUrlOrRef) && <a href={e.sourceUrlOrRef} target="_blank" rel="noreferrer" class="text-[10px] text-[var(--color-accent)] underline">source</a>}
                </li>
              ))}
            </ul>
          )}
      </div>

      {/* What's blocking this deal? — sourced from the canonical objects. */}
      <div class="rounded-md border border-[var(--color-border)] p-2.5 space-y-1.5">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">What's blocking this deal?</span>
          <button type="button" onClick={() => void checkBlockers()} disabled={busy}
            class="ml-auto text-[11px] px-2 py-0.5 rounded-md border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-elevated)] disabled:opacity-40">
            {busy ? 'Checking…' : 'Check blockers'}
          </button>
        </div>
        {ans && <div class="text-[12px] text-[var(--color-text)]">{ans.answer}</div>}
        {h.blockingVerificationTasks.length === 0
          ? <div class="text-[12px] text-[var(--color-status-done)]">No blocking items — nothing is holding this deal back.</div>
          : (
            <ul class="space-y-1">
              {h.blockingVerificationTasks.map((t) => (
                <li key={t.taskId} class="text-[12px]">
                  <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-status-failed)] text-[var(--color-status-failed)] mr-1">{t.criticality}</span>
                  <span class="text-[var(--color-text)]">{t.question}</span>
                  <div class="text-[10px] text-[var(--color-text-faint)] ml-1">Why: {t.reason} · Try: {t.recommendedSource} · Owner: {ownerDeptLabel(t.ownerDepartment)}</div>
                </li>
              ))}
            </ul>
          )}
        <div class="text-[12px] pt-1 border-t border-[var(--color-border)]">
          <span class="text-[var(--color-accent)] font-semibold">Next action:</span> {h.nextBestAction}
          <span class="text-[var(--color-text-faint)]"> — owner: {ownerDeptLabel(h.nextActionOwner)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Market Pulse v1 (concise real read) ────────────────────────────────────
// Mirrors MarketPulseRead in src/landos/market-pulse-read.ts. Answers: is the
// area growing/stable/declining, what land goes for per acre, growth signals.
interface MPGrowthView { status: string; direction: string; populationRecent: number | null; populationPrior: number | null; pctChange: number | null; years: [number, number] | null; source: string | null; note: string }
interface MPPpaView { status: string; medianPpa: number | null; sampleSize: number; source: string | null; note: string }
interface MarketPulseReadView {
  eligible: boolean; area: { descriptor: string }; parcelVerified: boolean; label: string;
  growth: MPGrowthView; countyPricePerAcre: MPPpaView; zipPricePerAcre: MPPpaView | null;
  developmentSignals: { source: string; note: string }; plainEnglish: string; disclaimer: string;
}

function growthTone(dir: string): string {
  return dir === 'growing' ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]'
    : dir === 'declining' ? 'text-[var(--color-status-failed)] border-[var(--color-status-failed)]'
    : 'text-[var(--color-accent)] border-[var(--color-accent)]';
}

function MarketPulseReadSection({ dealId }: { dealId: number }) {
  const [mp, setMp] = useState<MarketPulseReadView | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true; setBusy(true);
    apiGet<{ marketPulse: MarketPulseReadView }>(`/api/landos/deal-cards/${dealId}/market-pulse`)
      .then((r) => { if (live) setMp(r.marketPulse); })
      .catch(() => { /* section is optional */ })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [dealId]);
  if (!mp) return busy ? <div class="text-[11px] text-[var(--color-text-faint)] px-1">Reading market pulse…</div> : null;
  if (!mp.eligible) return null;
  const g = mp.growth; const cp = mp.countyPricePerAcre; const zp = mp.zipPricePerAcre;
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-2">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text)]">Market Pulse</span>
        <span class="text-[11px] px-2 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">{mp.area.descriptor}</span>
        <span class={`text-[11px] px-2 py-0.5 rounded-full border ${growthTone(g.direction)}`}>{g.direction === 'unknown' ? 'growth: unknown' : g.direction}</span>
      </div>
      <div class="text-[12px] text-[var(--color-text)]">{mp.plainEnglish}</div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
        <div>
          <div class="text-[var(--color-text-faint)]">Population trend</div>
          {g.status === 'measured' && g.pctChange != null
            ? <div class="text-[var(--color-text)]">{g.populationPrior?.toLocaleString()} → {g.populationRecent?.toLocaleString()} ({g.pctChange >= 0 ? '+' : ''}{g.pctChange}%{g.years ? `, ${g.years[0]}–${g.years[1]}` : ''})</div>
            : <div class="text-[var(--color-text-faint)]">{g.note}</div>}
          {g.source && <a href={g.source} target="_blank" rel="noreferrer" class="text-[10px] text-[var(--color-accent)] underline">official source</a>}
        </div>
        <div>
          <div class="text-[var(--color-text-faint)]">County $/acre</div>
          {/* A county price is a MARKET figure — never quoted from fewer than 3 sales. */}
          {cp.status === 'measured' && cp.medianPpa != null && cp.sampleSize >= 3
            ? <div class="text-[var(--color-text)]">~${cp.medianPpa.toLocaleString()}/acre <span class="text-[10px] text-[var(--color-text-faint)]">({cp.sampleSize} comps)</span></div>
            : cp.status === 'measured' && cp.medianPpa != null
              ? <div class="text-[var(--color-text-muted)]">Not established — only {cp.sampleSize} sale(s) on hand; one observation is not a market price.</div>
              : <div class="text-[var(--color-text-faint)]">{cp.note}</div>}
          {zp?.medianPpa != null && zp.sampleSize >= 3 && <div class="text-[var(--color-text)]">ZIP: ~${zp.medianPpa.toLocaleString()}/acre <span class="text-[10px] text-[var(--color-text-faint)]">({zp.sampleSize})</span></div>}
        </div>
        <div>
          <div class="text-[var(--color-text-faint)]">Growth signals</div>
          <div class="text-[var(--color-text-muted)]">{mp.developmentSignals.note}</div>
          {mp.developmentSignals.source && <a href={mp.developmentSignals.source} target="_blank" rel="noreferrer" class="text-[10px] text-[var(--color-accent)] underline">View development source</a>}
        </div>
      </div>
      {mp.disclaimer && <div class="text-[10px] text-[var(--color-text-faint)]">{mp.disclaimer}</div>}
    </div>
  );
}

// ── Public Records Research (unresolved-lead usefulness) ────────────────────
// Mirrors PublicRecordsResearchPlan in src/landos/public-records-research.ts.
interface ResearchTargetView { priority: number; kind: string; label: string; url: string; whatToExtract: string[]; searchBy: string[]; official: boolean; note: string }
interface ResearchPlanView { eligible: boolean; targets: ResearchTargetView[]; missingCriticalFacts: string[]; nextVerificationAction: string; disclaimer: string }

function PublicRecordsResearchSection({ dealId }: { dealId: number }) {
  const [plan, setPlan] = useState<ResearchPlanView | null>(null);
  useEffect(() => {
    let live = true;
    apiGet<{ researchPlan: ResearchPlanView }>(`/api/landos/deal-cards/${dealId}/research-plan`)
      .then((r) => { if (live) setPlan(r.researchPlan); })
      .catch(() => { /* optional */ });
    return () => { live = false; };
  }, [dealId]);
  if (!plan || !plan.eligible || plan.targets.length === 0) return null;
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-2">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text)]">Public Records Research</span>
        {plan.missingCriticalFacts.length > 0 && <span class="text-[11px] px-2 py-0.5 rounded-full border border-[var(--color-accent)] text-[var(--color-accent)]">still need: {plan.missingCriticalFacts.join(', ')}</span>}
      </div>
      <div class="text-[12px] text-[var(--color-text)]"><span class="text-[var(--color-accent)] font-semibold">Next:</span> {plan.nextVerificationAction}</div>
      <div class="space-y-1">
        {plan.targets.map((t, i) => (
          <div key={i} class="text-[11px] flex items-start gap-2">
            <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-faint)] shrink-0">#{t.priority}</span>
            <div class="flex-1">
              <a href={t.url} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">{t.label}</a>
              <span class="text-[10px] text-[var(--color-text-faint)]"> — extract: {t.whatToExtract.slice(0, 3).join(', ')}</span>
            </div>
          </div>
        ))}
      </div>
      <div class="text-[10px] text-[var(--color-text-faint)]">{plan.disclaimer}</div>
    </div>
  );
}

// ── Deal Card tabs ──────────────────────────────────────────────────────────
// The Deal Card is a compact operator dashboard: identity + critical facts + the
// next action stay pinned at the top; the (formerly endless) report/worksheet
// content is split into tabs so the deal is legible in seconds and long reports
// no longer force an endless scroll. Every existing section is preserved — only
// reorganized behind a tab. No data or backend behavior changes.
// Operator-language tabs (LandOS Vision & Architecture: Overview, Property,
// Market, Strategy, Seller, Documents, Activity). Overview is the main working
// surface — the Property Intelligence Report read. The remaining tabs hold the
// deeper, editable detail (property DD + visuals + browser intelligence live
// under Property; report generation + files under Documents; the report/audit
// timeline under Activity).
type DealTab = 'overview' | 'property' | 'diligence' | 'market' | 'strategy' | 'visuals' | 'seller' | 'resources' | 'documents' | 'activity';
const DEAL_TABS: Array<{ id: DealTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'property', label: 'Property' },
  { id: 'diligence', label: 'Due Diligence' },
  { id: 'market', label: 'Market' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'visuals', label: 'Visuals' },
  { id: 'seller', label: 'Seller' },
  { id: 'resources', label: 'Resources' },
  { id: 'documents', label: 'Documents' },
  { id: 'activity', label: 'Activity' },
];

function DealTabBar({ active, onSelect }: { active: DealTab; onSelect: (t: DealTab) => void }) {
  return (
    <div class="flex flex-wrap gap-0.5 -mb-px overflow-x-auto">
      {DEAL_TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onSelect(t.id)}
          class={`px-3 py-1.5 text-[12px] font-medium whitespace-nowrap rounded-t-md border-b-2 ${
            active === t.id
              ? 'border-[var(--color-accent)] text-[var(--color-text)]'
              : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Compact, always-visible critical-facts chips for the pinned header — the same
 *  states the Business Spine renders in full below (confirmed / needs_evidence /
 *  absent). Kept short so the deal reads at a glance. */
function CriticalFactChips({ facts }: { facts?: SpineCriticalFact[] }) {
  if (!facts || facts.length === 0) return null;
  return (
    <div class="flex flex-wrap gap-1">
      {facts.map((f) => {
        const tone = f.state === 'confirmed'
          ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]'
          : f.state === 'needs_evidence'
            ? 'text-[var(--color-accent)] border-[var(--color-accent)]'
            : 'text-[var(--color-status-failed)] border-[var(--color-status-failed)]';
        const mark = f.state === 'confirmed' ? '✓' : f.state === 'needs_evidence' ? '◐' : '○';
        return (
          <span key={f.key} class={`text-[10px] px-1.5 py-0.5 rounded-full border ${tone}`} title={f.detail}>
            {mark} {f.label}
          </span>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// PROPERTY INTELLIGENCE REPORT — the Deal Card Overview.
//
// The Overview is the primary Acquisitions workspace: ONE complete, professional
// read of a single land opportunity. It SYNTHESIZES intelligence that already
// exists (report, executive summary, discovery, comps, visuals, seller) into a
// report hierarchy — hero, executive summary, key facts, what-the-facts-mean,
// risks/unknowns, market, strategy, seller — instead of scattering department
// outputs across tabs. It reuses existing data only. It never fabricates and it
// never makes the buy/no-buy decision — it explains context and leaves the
// decision to the operator. Deeper, editable detail lives in the tabs below.
// ══════════════════════════════════════════════════════════════════════════

type GovDd = {
  flood?: { status: string; zone: string | null };
  wetlands?: { status: string; type: string | null };
  slope?: { status: string; slopeDeg: number | null };
};
function govOf(report: ReportView | null): GovDd | undefined {
  return (report as { govDd?: GovDd } | null)?.govDd;
}
// Pull a fact + its source from the DD checklist (source-labeled by design).
function factOf(report: ReportView | null, ...keys: string[]): { value: string | null; source: string | null } {
  const rows = report?.ddFactChecklist ?? [];
  for (const k of keys) {
    const row = rows.find((r) => r.key === k);
    if (row && row.value) return { value: row.value, source: row.source ?? null };
  }
  return { value: null, source: null };
}
function floodText(g?: GovDd): string {
  if (g?.flood?.status !== 'verified') return 'Unknown';
  return g.flood.zone && !/^x$/i.test(g.flood.zone) ? `Zone ${g.flood.zone}` : 'Zone X (minimal)';
}
function wetlandsText(g?: GovDd): string {
  if (g?.wetlands?.status !== 'verified') return 'Unknown';
  return g.wetlands.type ? 'Present' : 'None mapped';
}
function slopeText(g?: GovDd): string {
  if (g?.slope?.status !== 'verified' || g.slope.slopeDeg == null) return 'Unknown';
  return `~${g.slope.slopeDeg}°`;
}
// Best-effort city from the situs address ("123 Rd, Helenwood, TN 37755" -> "Helenwood").
function cityFromSitus(situs: string | null): string | null {
  if (!situs) return null;
  const parts = situs.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length >= 3 ? parts[parts.length - 2] : null;
}

// Enriched identity grid for the pinned header: seller, address, city, county,
// state, acreage, APN / parcel ID, stage, deal status. Business language only.
function DealIdentityGrid({ report, deal, prop, seller }: {
  report: ReportView | null; deal: DealCardDetail; prop?: PropertyCardLite; seller?: PersonLite;
}) {
  const situs = factOf(report, 'situsAddress', 'address').value ?? prop?.active_input_address ?? null;
  const apn = factOf(report, 'apn', 'parcelId').value ?? prop?.apn ?? null;
  const county = factOf(report, 'county').value ?? prop?.county ?? null;
  const state = factOf(report, 'state').value ?? prop?.state ?? null;
  const ownerOfRecord = factOf(report, 'owner').value ?? report?.landportalInspection?.factSheet?.owner ?? prop?.owner ?? null;
  const city = cityFromSitus(situs);
  const acres = report?.reconciliation?.acreage?.primary
    ?? factOf(report, 'acres').value
    ?? (prop?.acres != null ? `${prop.acres} ac` : null)
    ?? (deal.combined_acreage != null ? `${deal.combined_acreage} ac` : null);
  return (
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1.5">
      <HeaderField label="Seller / Lead" value={seller?.name ?? undefined} />
      <HeaderField label="Owner of record" value={ownerOfRecord} />
      <HeaderField label="Address" value={situs} />
      <HeaderField label="City" value={city} />
      <HeaderField label="County" value={county} />
      <HeaderField label="State" value={state} />
      <HeaderField label="Acreage" value={acres} />
      <HeaderField label="APN / Parcel ID" value={apn} />
      <HeaderField label="Deal status" value={deal.status} />
    </div>
  );
}

// Hero visual — the best PARCEL-SPECIFIC image, in strict priority: APN-specific
// LandPortal parcel imagery → county GIS → verified-coordinate Google satellite →
// nearby verified-parcel Street View context → NO image. Generic city / nearby-business
// imagery never renders; an honest empty state beats a misleading visual.
function HeroVisual({ report, prop, discoveryReport, token }: {
  report: ReportView | null; prop?: PropertyCardLite; discoveryReport: DiscoveryReportView | null; token: string;
}) {
  const ctx = report?.visualContext;
  const withToken = (u: string) => (u.startsWith('/api/') ? `${u}&token=${encodeURIComponent(token)}` : u);
  // 1. LandPortal parcel imagery (APN-page association) — the preferred hero.
  const lpHero = preferredLandPortalHero(report);
  // 2/3. Eligible (association-proven) Google captures — the backend already
  //     excluded anything without verified-parcel-coordinate proof.
  const captured = (ctx?.assets ?? []).filter((a) => a.status === 'captured' && a.imageUrl);
  const gHero = captured.find(isSatellite) ?? captured.find(isStreetView) ?? null;
  const hero = lpHero ? { url: lpHero.url, label: `LandPortal parcel imagery` } : gHero ? { url: gHero.imageUrl as string, label: 'Verified parcel image (Google)' } : null;
  const lpUrl = prop?.lp_url ?? discoveryReport?.landportalInspection?.parcelUrl ?? null;
  const links: Array<{ label: string; href: string }> = [];
  if (ctx?.links?.maps) links.push({ label: 'Google Maps', href: ctx.links.maps });
  if (ctx?.links?.streetView) links.push({ label: 'Street View', href: ctx.links.streetView });
  if (ctx?.links?.earth) links.push({ label: 'Google Earth', href: ctx.links.earth });
  if (lpUrl) links.push({ label: 'LandPortal', href: lpUrl });
  return (
    <div class="rounded-xl overflow-hidden border border-[var(--color-border)] bg-[var(--color-card)]">
      {hero ? (
        <figure class="m-0">
          <img src={withToken(hero.url)} alt="Verified parcel visual" class="w-full h-52 sm:h-64 object-cover" loading="lazy" />
          <figcaption class="text-[10px] text-[var(--color-text-faint)] px-3 py-1">{hero.label}</figcaption>
        </figure>
      ) : (
        <div class="w-full h-36 flex items-center justify-center px-4 text-center bg-[var(--color-elevated)] text-[12px] text-[var(--color-text-faint)]">
          No boundary-verified parcel image is attached here yet. The public aerial screening below is parcel-extent context only until the official boundary is overlaid; it does not establish legal boundaries or access.
        </div>
      )}
      {links.length > 0 && (
        <div class="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 text-[12px] border-t border-[var(--color-border)]">
          {links.map((l) => (
            <a key={l.label} href={l.href} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">{l.label}</a>
          ))}
          <span class="text-[10px] text-[var(--color-text-faint)] ml-auto self-center">Supporting context only — never parcel identity.</span>
        </div>
      )}
    </div>
  );
}

function appendDashboardToken(url: string, token: string): string {
  if (!url.startsWith('/api/')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

function preferredLandPortalHero(report: ReportView | null): NonNullable<NonNullable<ReportView['landportalInspection']>['assets']>[number] | null {
  const assets = (report?.landportalInspection?.assets ?? []).filter((asset) => asset.kind !== 'google' && asset.url);
  return assets.find((asset) => /parcel_page/i.test(asset.kind))
    ?? assets.find((asset) => /parcel_3d/i.test(asset.kind))
    ?? assets.find((asset) => !/overlay|comparables/i.test(asset.kind))
    ?? null;
}

// Executive property summary — synthesized narrative, normal operator language.
// Uses the backend executive summary when present; honest prompt otherwise.
function OverviewSummary({ es, report }: { es: ExecSummaryView | null; report: ReportView | null }) {
  if (es) {
    return (
      <div class="rounded-lg border border-[var(--color-accent)] bg-[var(--color-card)] p-4 space-y-1.5">
        <div>
          <span class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-accent)]">Executive Summary</span>
        </div>
        <div class="text-[14px] font-semibold text-[var(--color-text)]">{es.headline}</div>
        {es.whatItIs && <div class="text-[12.5px] text-[var(--color-text-muted)]">{es.whatItIs}</div>}
        {es.whyInteresting && <div class="text-[12.5px] text-[var(--color-text-muted)]">{es.whyInteresting}</div>}
      </div>
    );
  }
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-[12.5px] text-[var(--color-text-muted)]">
      {report?.exists
        ? 'Property Intelligence has run, but no executive summary is available for this parcel yet.'
        : 'No property summary yet. Run Property Intelligence to build a full report from parcel facts, comps, visuals, and market data. Nothing is fabricated; unknowns stay unknown.'}
    </div>
  );
}

// Prefer the reconciled authoritative value for a field (acreage/frontage/flood/
// wetlands/slope) so the at-a-glance snapshot can NEVER disagree with the
// reconciled facts panel. Falls back to the raw checklist/gov read only when
// reconciliation produced no primary. This is the single-truth rule for the card.
function reconciledFact(report: ReportView | null, key: keyof NonNullable<ReportView['reconciliation']>, fallback: { value: string | null; source: string | null }): { value: string | null; source: string | null } {
  const rec = report?.reconciliation;
  const f = rec && key !== 'conflicts' ? (rec[key] as ReconciledFactValueView | undefined) : undefined;
  if (f && f.primary != null) return { value: f.primary, source: f.primarySource ?? null };
  return fallback;
}

// Key facts — the professional at-a-glance property snapshot, source-labeled.
// Environmental + dimensional facts come from the reconciliation layer (one truth).
function KeyFactsGrid({ report }: { report: ReportView | null }) {
  const g = govOf(report);
  const facts: Array<{ label: string; keyOrValue: { value: string | null; source: string | null } }> = [
    { label: 'Owner of record', keyOrValue: factOf(report, 'owner') },
    { label: 'APN / Parcel ID', keyOrValue: factOf(report, 'apn', 'parcelId') },
    { label: 'Acreage', keyOrValue: reconciledFact(report, 'acreage', factOf(report, 'acres')) },
    { label: 'County', keyOrValue: factOf(report, 'county') },
    { label: 'State', keyOrValue: factOf(report, 'state') },
    { label: 'Land use', keyOrValue: factOf(report, 'landUse') },
    { label: 'Zoning', keyOrValue: factOf(report, 'zoning') },
    { label: 'Utilities', keyOrValue: factOf(report, 'utility_summary') },
    { label: 'Road frontage', keyOrValue: reconciledFact(report, 'roadFrontage', factOf(report, 'roadFrontageFt')) },
    { label: 'Access', keyOrValue: factOf(report, 'landLocked') },
    { label: 'Buildability', keyOrValue: factOf(report, 'buildabilityPct') },
    { label: 'Assessed value', keyOrValue: factOf(report, 'officialAssessedValue', 'assessedValue') },
    { label: 'Market value', keyOrValue: factOf(report, 'officialMarketValue', 'marketValue') },
    { label: 'Last recorded sale', keyOrValue: factOf(report, 'officialSaleInfo', 'lastSale') },
    { label: 'Flood', keyOrValue: reconciledFact(report, 'flood', { value: floodText(g), source: g?.flood?.status === 'verified' ? 'FEMA' : null }) },
    { label: 'Wetlands', keyOrValue: reconciledFact(report, 'wetlands', { value: wetlandsText(g), source: g?.wetlands?.status === 'verified' ? 'USFWS' : null }) },
    { label: 'Slope', keyOrValue: reconciledFact(report, 'slope', { value: slopeText(g), source: g?.slope?.status === 'verified' ? 'USGS' : null }) },
  ];
  return (
    <Section title="Key facts">
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2.5">
        {facts.map((f) => {
          const v = f.keyOrValue.value;
          return (
            <div key={f.label} class="min-w-0">
              <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">{f.label}</div>
              <div class={`text-[12.5px] ${v && v !== 'Unknown' ? 'text-[var(--color-text)]' : 'text-[var(--color-text-faint)] italic'}`}>{v || 'Unknown'}</div>
              {f.keyOrValue.source && <div class="text-[9.5px] text-[var(--color-text-faint)]">{f.keyOrValue.source}</div>}
              {f.label === 'Owner of record' && v && ((v.match(/\(/g)?.length ?? 0) > (v.match(/\)/g)?.length ?? 0)) && <div class="mt-0.5 text-[9.5px] text-amber-700 dark:text-amber-300">Public owner string appears truncated; confirm current owner and mailing address from a current official record.</div>}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// What the facts mean together — the synthesis the brief asks for. Deterministic,
// derived only from present facts. It connects facts into combined context and
// explicitly does NOT make a buy/no-buy call.
function WhatThisMeans({ report, es }: { report: ReportView | null; es: ExecSummaryView | null }) {
  const g = govOf(report);
  const rec = report?.reconciliation;
  const notes: Array<{ tone: 'concern' | 'positive' | 'verify'; text: string }> = [];
  // Derive constraint signals from the SAME reconciled values the facts grid shows,
  // so the interpretation can't contradict the numbers above it. Reconciliation
  // primary wins; gov-DD is the fallback only when reconciliation has no value.
  const floodVal = rec?.flood?.primary ?? (g?.flood?.status === 'verified' ? g.flood.zone : null);
  const floodPresent = !!floodVal && !/^x$|zone x|minimal|not in|none/i.test(floodVal);
  const wetVal = rec?.wetlands?.primary ?? (g?.wetlands?.status === 'verified' ? g.wetlands.type : null);
  const wetPresent = !!wetVal && !/none|no wetland|0%/i.test(wetVal);
  const slopeNum = rec?.slope?.primary ? Number((rec.slope.primary.match(/([\d.]+)/) ?? [])[1]) : (g?.slope?.status === 'verified' ? g.slope.slopeDeg : null);
  const steep = slopeNum != null && Number.isFinite(slopeNum) && slopeNum >= 15;
  const landlocked = /yes|true|landlocked/i.test(factOf(report, 'landLocked').value ?? '');
  const roadFrontage = rec?.roadFrontage?.primary ?? factOf(report, 'roadFrontageFt').value;
  const zoningKnown = !!factOf(report, 'zoning').value;
  const utilitiesKnown = (report?.ddFactChecklist ?? []).some((r) => r.key.startsWith('utility_') && r.status === 'verified');

  const constraints = [floodPresent && 'flood exposure', wetPresent && 'mapped wetlands', steep && 'steep slope', landlocked && 'limited/landlocked access'].filter(Boolean) as string[];
  if (constraints.length >= 2) {
    notes.push({ tone: 'concern', text: `${constraints.join(', ')} together point to a combined development constraint. Treat these as one issue and verify buildable area before finalizing an offer.` });
  }
  if (roadFrontage && !floodPresent && !wetPresent && !landlocked) {
    notes.push({ tone: 'positive', text: `Confirmed road frontage with no mapped flood or wetlands is acquisition-positive context for access and buildability.` });
  }
  if (!zoningKnown && !utilitiesKnown) {
    notes.push({ tone: 'verify', text: `Zoning and utility availability are both unconfirmed — verification needed before offer finalization.` });
  }
  const mp = es?.marketPulse;
  if (mp && mp.pricePerAcre?.median != null && !floodPresent && !wetPresent && roadFrontage) {
    notes.push({ tone: 'positive', text: `Supportive comparable pricing alongside clean parcel facts is acquisition-positive context — confirm comps and costs before an offer.` });
  }
  if (notes.length === 0) return null;
  const dot = (t: string) => t === 'concern' ? 'var(--color-status-failed)' : t === 'positive' ? 'var(--color-status-done)' : 'var(--color-accent)';
  return (
    <Section title="What the facts mean together">
      <div class="space-y-1.5">
        {notes.map((n, i) => (
          <div key={i} class="flex items-start gap-2 text-[12.5px] text-[var(--color-text-muted)]">
            <span class="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: dot(n.tone) }} />
            <span>{n.text}</span>
          </div>
        ))}
        <div class="text-[10px] text-[var(--color-text-faint)] pt-0.5">Context only — LandOS does not decide. The buy/no-buy call is yours.</div>
      </div>
    </Section>
  );
}

// Key risks / unknowns — two honest columns, deduplicated from report + summary.
function KeyRisksUnknowns({ report, es }: { report: ReportView | null; es: ExecSummaryView | null }) {
  const dedupe = (xs: string[]) => Array.from(new Set(xs.map((x) => x.trim()).filter(Boolean)));
  const risks = dedupe([...(report?.riskFlags ?? []), ...(es?.topRisks ?? [])]).slice(0, 8);
  const unknowns = dedupe([...(report?.dataGaps ?? []), ...(es?.verifyBeforeOffer ?? [])]).slice(0, 8);
  if (risks.length === 0 && unknowns.length === 0) return null;
  return (
    <Section title="Key risks & unknowns">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div class="text-[11px] font-semibold text-[var(--color-status-failed)] mb-1">Risks</div>
          {risks.length ? risks.map((r, i) => <div key={i} class="text-[12px] text-[var(--color-text-muted)]">• {r}</div>) : <Placeholder text="None flagged" />}
        </div>
        <div>
          <div class="text-[11px] font-semibold text-[var(--color-accent)] mb-1">Unknowns — verify before offer</div>
          {unknowns.length ? unknowns.map((r, i) => <div key={i} class="text-[12px] text-[var(--color-text-muted)]">• {r}</div>) : <Placeholder text="No open gaps recorded" />}
        </div>
      </div>
    </Section>
  );
}

// Strategy snapshot — property-specific exit evaluation (Acquisitions), compact.
// Neighbor sale is NOT an acquisition strategy and is excluded.
function StrategySnapshot({ dcr, es }: { dcr: DiscoveryReportView | null; es: ExecSummaryView | null }) {
  const excl = /neighbor/i;
  const ownerStrategyName = (name: string) => name === 'Cash Flip' ? 'Quick Flip' : name === 'Novation / Double Close' ? 'Novation or Double Close' : name === 'Subdivide' ? 'Subdivide or Minor Split' : name;
  // A lane held up by INCOMPLETE RESEARCH is "blocked", never "not viable" —
  // not-viable is reserved for a real disqualifier proven by evidence.
  const honest = (suitability: string, reason: string) =>
    /not[_ ]viable/i.test(suitability) && /^blocked[:\s]/i.test(reason.trim()) ? 'blocked' : suitability;
  const fromDcr = (dcr?.strategyEvaluation ?? [])
    .filter((s) => !excl.test(s.strategy))
    .map((s) => ({ strategy: s.strategy, suitability: honest(s.verdict, s.reason), reason: s.reason, blocker: s.mainRisk }));
  const fromEs = (es?.strategyRanking ?? [])
    .filter((s) => !excl.test(s.strategy))
    .map((s) => ({ strategy: s.strategy, suitability: honest(s.viability, s.reason), reason: s.reason, blocker: s.mustVerify || s.risk }));
  const rows = (fromEs.length ? fromEs : fromDcr).slice(0, 5);
  if (rows.length === 0) return null;
  const strongest = es?.strongestStrategy?.strategy;
  return (
    <Section title="Strategy snapshot">
      <div class="space-y-1.5">
        {rows.map((r, i) => (
          <div key={i} class="rounded-md border border-[var(--color-border)] p-2">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-[12.5px] font-medium text-[var(--color-text)]">{ownerStrategyName(r.strategy)}</span>
              <span class={`text-[10px] px-1.5 py-0.5 rounded-full border ${verdictTone(r.suitability)}`}>{r.suitability}</span>
              {strongest && strongest === r.strategy && <span class="text-[10px] text-[var(--color-status-done)]">strongest</span>}
            </div>
            {r.reason && <div class="text-[11.5px] text-[var(--color-text-muted)] mt-0.5">{r.reason}</div>}
            {r.blocker && <div class="text-[11px] text-[var(--color-text-faint)] mt-0.5">Watch: {r.blocker}</div>}
          </div>
        ))}
      </div>
      <div class="text-[10px] text-[var(--color-text-faint)] mt-1.5">Property-specific exit evaluation. Full strategy detail on the Strategy tab.</div>
    </Section>
  );
}

// Seller / discovery snapshot — helps talk to the seller. Full detail on Seller.
function ownerFacingSellerNote(raw: string | null | undefined): string {
  const note = (raw || '').trim();
  if (!note) return '';
  const structuredParcelIntake = /\bowner name\b/i.test(note)
    && /\bparcel (?:id|address)\b/i.test(note)
    && /\bacres?\b/i.test(note);
  return structuredParcelIntake ? '' : note;
}

function SellerSnapshot({ deal, seller, es }: { deal: DealCardDetail; seller?: PersonLite; es: ExecSummaryView | null }) {
  const notes = ownerFacingSellerNote(deal.seller_notes);
  const questions = es?.sellerQuestions ?? [];
  const hasAny = !!seller?.name || deal.asking_price != null || notes || questions.length > 0;
  return (
    <Section title="Seller & discovery">
      {hasAny ? (
        <div class="space-y-2">
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
            <HeaderField label="Seller / Lead" value={seller?.name ?? undefined} />
            <HeaderField label="Phone" value={seller?.phone ?? undefined} />
            <HeaderField label="Asking (seller-stated)" value={deal.asking_price != null ? usd(deal.asking_price) : undefined} />
          </div>
          {notes && <div class="text-[12px] text-[var(--color-text-muted)] whitespace-pre-wrap">{notes}</div>}
          {questions.length > 0 && (
            <div>
              <div class="text-[11px] font-semibold text-[var(--color-text-faint)] mb-0.5">Questions for the seller</div>
              {questions.slice(0, 5).map((q, i) => <div key={i} class="text-[12px] text-[var(--color-text-muted)]">• {q}</div>)}
            </div>
          )}
          <div class="text-[10px] text-[var(--color-text-faint)]">Asking price is negotiation context only, never an offer basis. Full seller workspace on the Seller tab.</div>
        </div>
      ) : (
        <Placeholder text="No seller or discovery info captured yet. Add it on the Seller tab." />
      )}
    </Section>
  );
}

// The full Overview composition — the Property Intelligence Report read.
// ── Reconciliation UI: one authoritative story across every tab ──────────────

const TIER_LABEL: Record<string, string> = {
  official: 'Official record', provider: 'Provider', visual: 'Visual signal', none: '—',
};

function usdShort(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** Loud banner when the card's trusted sources disagree — shown on Overview so the
 *  operator never has to hunt for a hidden contradiction. */
function ContradictionBanner({ report, record }: { report?: ReportView | null; record?: OperatorRecordView | null }) {
  const rec = report?.reconciliation;
  const items: string[] = [];
  if (rec?.conflicts?.length) items.push(...rec.conflicts);
  // The access question belongs in the main conflict banner: proximity is
  // mapped but contact is unproven, and intervening land may exist.
  if (record?.accessStatus?.status === 'public_road_proximity') {
    items.push('Access: apparent intervening land may exist between the parcel geometry and the visible roadway — parcel–road contact, right-of-way contact, physical access, and legal access are unresolved.');
  }
  if (!items.length) return null;
  return (
    <div class="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3.5 space-y-1">
      <div class="text-[13px] font-semibold text-amber-600 dark:text-amber-400">Conflicts and unresolved blockers to resolve before offer</div>
      <ul class="list-disc pl-4 space-y-1">
        {items.map((c, i) => <li key={i} class="text-[12px] leading-relaxed text-[var(--color-text)]">{c}</li>)}
      </ul>
    </div>
  );
}

function ReconciledFactRow({ f }: { f?: ReconciledFactValueView }) {
  if (!f || f.primary == null) return null;
  return (
    <div class="flex items-start justify-between gap-3 py-1.5 border-b border-[var(--color-border)] last:border-0">
      <div class="min-w-0">
        <div class="text-[12px] text-[var(--color-text)]">
          <span class="font-medium">{f.label}:</span> {f.primary}
          {f.conflict && <span class="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">conflict</span>}
        </div>
        {f.conflictNote && <div class="text-[10px] text-[var(--color-text-faint)] mt-0.5">{f.conflictNote}</div>}
        {!f.conflictNote && f.alternates.filter((a) => a.tier === 'visual').map((a, i) => (
          <div key={i} class="text-[10px] text-[var(--color-text-faint)] mt-0.5">Visual signal: {a.value} (context only)</div>
        ))}
      </div>
      <span class="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-faint)]">{f.primarySource ?? TIER_LABEL[f.primaryTier]}</span>
    </div>
  );
}

/** Reconciled property facts — the Property tab's single fact panel. */
function ReconciledFactsPanel({ rec }: { rec?: ReconciledFactsView }) {
  if (!rec) return null;
  const rows = [rec.acreage, rec.roadFrontage, rec.flood, rec.wetlands, rec.slope].filter((f) => f && f.primary != null);
  if (!rows.length) return null;
  return (
    <div class="rounded-lg border border-[var(--color-border)] p-3">
      <div class="text-[12px] font-semibold text-[var(--color-text)] mb-1.5">Reconciled property facts</div>
      <div class="text-[10px] text-[var(--color-text-faint)] mb-2">One authoritative value per field. Official parcel records outrank visual signal; disagreements are shown, never dropped.</div>
      {rows.map((f, i) => <ReconciledFactRow key={i} f={f} />)}
    </div>
  );
}

/** Valuation hierarchy — one primary preliminary value + supporting bases. Shared
 *  by Overview and Market so the primary value never differs between tabs. */
function ValuationPanel({ val }: { val?: ValuationHierarchyView }) {
  if (!val || !val.primary) return null;
  const p = val.primary;
  if (p.kind === 'comp_sold' && !val.valueRange) {
    return (
      <div class="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
        <div class="flex items-center justify-between">
          <div class="text-[12px] font-semibold text-[var(--color-text)]">Preliminary comp indication only</div>
          <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300">insufficient evidence</span>
        </div>
        <div class="text-[12px] font-medium text-amber-800 dark:text-amber-200">Insufficient evidence for a reliable value or offer range.</div>
        <div class="text-[11px] text-[var(--color-text-muted)]">A single closed sale is retained as classified context only; no median, $/acre conclusion, value, or offer range is produced.</div>
        {val.nextAction && <div class="text-[11px] text-[var(--color-text-muted)]">{val.nextAction}</div>}
      </div>
    );
  }
  return (
    <div class="rounded-lg border border-[var(--color-border)] p-3 space-y-2">
      <div class="flex items-center justify-between">
        <div class="text-[12px] font-semibold text-[var(--color-text)]">Preliminary valuation</div>
        <span class={`text-[10px] px-1.5 py-0.5 rounded-full ${val.confidence === 'high' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : val.confidence === 'medium' ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400' : 'bg-[var(--color-border)] text-[var(--color-text-faint)]'}`}>{val.confidence} confidence</span>
      </div>
      <div>
        <div class="text-[18px] font-semibold text-[var(--color-text)]">{usdShort(p.value)}{p.ppa ? <span class="text-[11px] font-normal text-[var(--color-text-faint)]"> · {usdShort(p.ppa)}/ac</span> : null}</div>
        <div class="text-[11px] text-[var(--color-text-muted)]">Basis: {p.label}. {p.note}</div>
        {val.valueRange && <div class="text-[11px] text-[var(--color-text-muted)]">Range (this basis): {usdShort(val.valueRange.low)} – {usdShort(val.valueRange.high)}</div>}
      </div>
      {val.supporting.length > 0 && (
        <div>
          <div class="text-[10px] text-[var(--color-text-faint)] mb-0.5">Supporting values (not the underwriting basis)</div>
          <ul class="space-y-0.5">
            {val.supporting.map((b, i) => (
              <li key={i} class="text-[11px] text-[var(--color-text-muted)] flex justify-between gap-2">
                <span>{b.label}</span><span class="text-[var(--color-text-faint)]">{usdShort(b.value)}{b.ppa ? ` · ${usdShort(b.ppa)}/ac` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const COMP_STATUS_DOT: Record<string, string> = {
  retrieved: 'bg-emerald-500', none: 'bg-[var(--color-text-faint)]', not_run: 'bg-[var(--color-border)]', unavailable: 'bg-amber-500',
};

/** Single comp-state panel — the same object Strategy reads, so status never
 *  contradicts across Market / Strategy / Activity. */
function CompStatePanel({ cs }: { cs?: CompStateView }) {
  if (!cs) return null;
  return (
    <div class="rounded-lg border border-[var(--color-border)] p-3 space-y-2">
      <div class="text-[12px] font-semibold text-[var(--color-text)]">Comp status</div>
      <div class="text-[11px] text-[var(--color-text-muted)]">{cs.summaryLine}</div>
      <div class="grid grid-cols-2 gap-x-4 gap-y-1">
        {cs.sources.map((sx, i) => (
          <div key={i} class="flex items-center gap-1.5 text-[11px]">
            <span class={`w-1.5 h-1.5 rounded-full shrink-0 ${COMP_STATUS_DOT[sx.status] ?? 'bg-[var(--color-border)]'}`} />
            <span class="text-[var(--color-text-muted)]">{sx.label}:</span>
            <span class="text-[var(--color-text-faint)]">{sx.status === 'retrieved' ? sx.count : sx.status.replace('_', ' ')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const COMP_CONF_TONE: Record<string, string> = {
  high: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  medium: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  low: 'bg-[var(--color-border)] text-[var(--color-text-faint)]',
};
function compSaleDate(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/** Best comparables — the memo's shortlist of the 3-5 comps that inform value,
 *  each with distance / acreage / price / $-per-acre / sold date / source /
 *  confidence and the plain reason it was picked. Not twenty comps. */
function BestCompsPanel({ bc }: { bc?: BestCompsView }) {
  if (!bc || !bc.comps.length) return null;
  return (
    <Section title={bc.comps.length === 1 ? 'Validated sold observation (1) — not a comparable set' : `Best comparables (${bc.comps.length})`}>
      <div class="text-[11px] text-[var(--color-text-faint)] mb-2">{bc.rationale}</div>
      <div class="space-y-1.5">
        {bc.comps.map((c, i) => (
          <div key={i} class="rounded-md border border-[var(--color-border)] p-2.5">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-[12.5px] font-medium text-[var(--color-text)]">
                {c.acres != null ? `${c.acres} ac` : 'Acreage n/a'}
                {c.pricePerAcre != null ? <span class="text-[var(--color-text-muted)] font-normal"> · {usdShort(c.pricePerAcre)}/ac</span> : null}
              </span>
              {c.price != null && <span class="text-[11.5px] text-[var(--color-text-muted)]">{usdShort(c.price)}</span>}
              <span class={`text-[10px] px-1.5 py-0.5 rounded-full ml-auto ${COMP_CONF_TONE[c.confidence]}`}>{c.confidence}</span>
            </div>
            <div class="flex items-center gap-x-3 gap-y-0.5 flex-wrap mt-1 text-[11px] text-[var(--color-text-faint)]">
              {compSaleDate(c.saleDateIso) && <span>Sold {compSaleDate(c.saleDateIso)}</span>}
              {c.distanceMiles != null
                ? <span>{c.distanceMiles.toFixed(1)} mi{c.distanceMethod === 'straight_line' ? ' (straight-line)' : ''}</span>
                : <span>distance not calculated</span>}
              <span>{c.source}</span>
              {c.addressDesc && <span class="truncate max-w-[45%]">{c.addressDesc}</span>}
              {c.sourceUrl && <a href={c.sourceUrl} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">view</a>}
            </div>
            <div class="text-[11px] text-[var(--color-text-muted)] mt-1">Why: {c.why}</div>
            {c.scoreComponents && (
              <div class="text-[10px] text-[var(--color-text-faint)] mt-0.5">
                Selection score {c.score ?? '—'}/100 — size {c.scoreComponents.acreageSimilarity}/40 · recency {c.scoreComponents.recency}/25 · sale type {c.scoreComponents.laneStrength}/25 · distance {c.scoreComponents.distance}/10
              </div>
            )}
          </div>
        ))}
      </div>
      <div class="text-[10px] text-[var(--color-text-faint)] mt-1.5">Ranked from {bc.consideredCount} usable comps. Full comp set on the Market tab.</div>
    </Section>
  );
}

// ── Pursuit decision (Strategy's ONE question) — mirrors deal-card-pursuit.ts ─
interface PursuitStrategyView { strategy: string; why: string; suitability: string }
interface PursuitView {
  question: string;
  answer: 'pursue' | 'pursue_with_caution' | 'hold' | 'insufficient_data';
  answerLine: string;
  attractiveAcquisition: { low: number; high: number; basisLabel: string; estMarketValue: number; note: string } | null;
  askingContext: string | null;
  reasons: string[];
  recommended: PursuitStrategyView | null;
  runnerUps: PursuitStrategyView[];
  majorBlockers: string[];
  remainingVerification: string[];
}

const PURSUIT_TONE: Record<PursuitView['answer'], { label: string; cls: string }> = {
  pursue: { label: 'Pursue', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40' },
  pursue_with_caution: { label: 'Pursue with caution', cls: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/40' },
  hold: { label: 'Hold', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40' },
  insufficient_data: { label: 'Not decidable yet', cls: 'bg-[var(--color-border)] text-[var(--color-text-muted)] border-[var(--color-border)]' },
};

/** The Strategy tab's core: should I pursue, and at what price is it attractive. */
function PursuitPanel({ pursuit }: { pursuit?: PursuitView | null }) {
  if (!pursuit) return null;
  const tone = PURSUIT_TONE[pursuit.answer];
  const aa = pursuit.attractiveAcquisition;
  return (
    <div class="rounded-lg border border-[var(--color-accent)] bg-[var(--color-card)] p-4 space-y-2.5">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[13px] font-bold text-[var(--color-text)]">{pursuit.question}</span>
        <span class={`ml-auto text-[11px] font-semibold px-2.5 py-1 rounded-full border ${tone.cls}`}>{tone.label}</span>
      </div>
      <div class="text-[13px] text-[var(--color-text)]">{pursuit.answerLine}</div>
      {aa && (
        <div class="rounded-md border border-[var(--color-border)] p-3">
          <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Attractive acquisition price</div>
          <div class="text-[18px] font-semibold text-[var(--color-status-done)]">{usdShort(aa.low)} – {usdShort(aa.high)}</div>
          <div class="text-[11px] text-[var(--color-text-muted)] mt-0.5">{aa.note}</div>
        </div>
      )}
      {pursuit.askingContext && <div class="text-[11.5px] text-[var(--color-text-muted)]">{pursuit.askingContext}</div>}
      {pursuit.reasons.length > 0 && (
        <div class="space-y-0.5">
          {pursuit.reasons.map((r, i) => <div key={i} class="text-[11.5px] text-[var(--color-text-muted)]">• {r}</div>)}
        </div>
      )}
    </div>
  );
}

/** Recommended + runner-up exits, blockers, and remaining verification — the rest
 *  of the Strategy story, consuming the same pursuit object. */
function StrategyExitsPanel({ pursuit, dcr }: { pursuit?: PursuitView | null; dcr: DiscoveryReportView | null }) {
  if (!pursuit) return null;
  const detail = (name: string) => (dcr?.strategyEvaluation ?? []).find((s) => s.strategy === name) ?? null;
  const rows = [
    ...(pursuit.recommended ? [{ ...pursuit.recommended, tag: 'Recommended' }] : []),
    ...pursuit.runnerUps.map((r) => ({ ...r, tag: 'Runner-up' })),
  ];
  if (!rows.length && !pursuit.majorBlockers.length && !pursuit.remainingVerification.length) return null;
  return (
    <div class="space-y-3">
      {rows.length > 0 && (
        <Section title="Highest & best exit">
          <div class="space-y-1.5">
            {rows.map((r, i) => {
              const d = detail(r.strategy);
              return (
                <div key={i} class={`rounded-md border p-2.5 ${r.tag === 'Recommended' ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'}`}>
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-[12.5px] font-medium text-[var(--color-text)]">{r.strategy}</span>
                    {r.suitability && <span class={`text-[10px] px-1.5 py-0.5 rounded-full border ${verdictTone(r.suitability)}`}>{r.suitability}</span>}
                    <span class={`ml-auto text-[10px] ${r.tag === 'Recommended' ? 'text-[var(--color-accent)] font-semibold' : 'text-[var(--color-text-faint)]'}`}>{r.tag}</span>
                  </div>
                  {r.why && <div class="text-[11.5px] text-[var(--color-text-muted)] mt-0.5">{r.why}</div>}
                  {/* Per-strategy pricing lines are deliberately NOT shown: the ONE
                      attractive band above is the single pricing story. */}
                  {d?.mainRisk && <div class="text-[11px] text-[var(--color-text-faint)]">Risk: {d.mainRisk}</div>}
                </div>
              );
            })}
          </div>
        </Section>
      )}
      {pursuit.majorBlockers.length > 0 && (
        <Section title="Major blockers">
          {pursuit.majorBlockers.map((b, i) => <div key={i} class="text-[12px] text-[var(--color-text-muted)]">• {b}</div>)}
        </Section>
      )}
      {pursuit.remainingVerification.length > 0 && (
        <Section title="Remaining verification">
          {pursuit.remainingVerification.map((v, i) => <div key={i} class="text-[12px] text-[var(--color-text-muted)]">• {v}</div>)}
        </Section>
      )}
    </div>
  );
}

// ── Executive Orchestrator review — mirrors deal-card-audit.ts ───────────────
interface OrchestrationCheckView { id: string; label: string; pass: boolean; detail: string; repairable: boolean }
interface OrchestrationView { passed: boolean; failedCount: number; checks: OrchestrationCheckView[]; summaryLine: string; repairAttempted?: boolean }

/** One quiet line when coherent; a loud, specific banner when the card's tabs
 *  do not tell the same story. */
function OrchestrationBanner({ o }: { o?: OrchestrationView | null }) {
  if (!o) return null;
  if (o.passed) {
    return <div class="text-[10.5px] text-[var(--color-text-faint)] px-1">{o.summaryLine}{o.repairAttempted ? ' (auto-repaired)' : ''}</div>;
  }
  return (
    <div class="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-1">
      <div class="text-[12px] font-semibold text-amber-600 dark:text-amber-400">{o.summaryLine}</div>
      <ul class="list-disc pl-4 space-y-0.5">
        {o.checks.filter((ch) => !ch.pass).map((ch, i) => <li key={i} class="text-[11px] text-[var(--color-text-muted)]">{ch.detail}</li>)}
      </ul>
      <div class="text-[10px] text-[var(--color-text-faint)]">Re-run Property Intelligence to repair; the run re-audits automatically.</div>
    </div>
  );
}

// ── Next operator actions — the memo's closing section ───────────────────────
function NextActionsPanel({ es, spine, pursuit }: { es: ExecSummaryView | null; spine: BusinessSpineView | null; pursuit?: PursuitView | null }) {
  const actions: string[] = [];
  const push = (x?: string | null) => { const v = (x ?? '').trim(); if (v && !actions.includes(v)) actions.push(v); };
  for (const s of es?.nextSteps ?? []) push(s);
  push(spine?.header?.nextBestAction);
  for (const v of (pursuit?.remainingVerification ?? []).slice(0, 3)) push(v);
  if (!actions.length) return null;
  return (
    <Section title="Next operator actions">
      <ol class="space-y-1 list-decimal pl-5">
        {actions.slice(0, 6).map((a, i) => <li key={i} class="text-[12.5px] text-[var(--color-text)]">{a}</li>)}
      </ol>
    </Section>
  );
}

// ── Market Scan: Data Center Watch + land-relevant growth signals ────────────
interface DataCenterItemView { title: string; status: string; summary: string; whyItMatters: string; url: string | null; year: number | null }
interface MarketSignalItemView { title: string; summary: string; category: string; whyItMatters: string; url: string | null; year: number | null }
interface MarketScanView {
  area: { descriptor: string };
  dataCenterWatch: { status: string; items: DataCenterItemView[]; summary: string; whyItMatters: string; note: string };
  growthSignals: { status: string; items: MarketSignalItemView[]; droppedIrrelevant: number; summary: string };
}

const DC_STATUS_LABEL: Record<string, string> = {
  proposed: 'Proposed', approved: 'Approved', under_construction: 'Under construction',
  expansion: 'Expansion', utility_infrastructure: 'Utility buildout', planning_activity: 'Planning activity',
  community_opposition: 'Opposition', mention: 'Signal',
};

/** Auto-runs on Market open (no buttons). Every item shown answers "why does
 *  this matter for buying this land?" — irrelevant items were already dropped. */
function MarketScanSection({ dealId }: { dealId: number }) {
  const [scan, setScan] = useState<MarketScanView | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true; setBusy(true);
    apiGet<{ marketScan: MarketScanView | null }>(`/api/landos/deal-cards/${dealId}/market-scan`)
      .then((r) => { if (live) setScan(r.marketScan); })
      .catch(() => { /* optional section */ })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [dealId]);
  if (!scan) return busy ? <div class="text-[11px] text-[var(--color-text-faint)] px-1">Scanning growth signals & Data Center Watch…</div> : null;
  const dc = scan.dataCenterWatch;
  const gs = scan.growthSignals;
  return (
    <div class="space-y-3">
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-2">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text)]">Data Center Watch</span>
          <span class={`text-[10px] px-2 py-0.5 rounded-full border ${dc.status === 'found' ? 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`}>
            {dc.status === 'found' ? 'Activity found' : dc.status === 'none_found' ? 'None found (2025+)' : dc.status === 'unavailable' ? 'Scan unavailable' : 'Not scanned yet'}
          </span>
        </div>
        <div class="text-[12.5px] text-[var(--color-text)]">{dc.summary}</div>
        {dc.whyItMatters && <div class="text-[11.5px] text-[var(--color-text-muted)]">{dc.whyItMatters}</div>}
        {dc.items.length > 0 && (
          <div class="space-y-1.5">
            {dc.items.map((i, k) => (
              <div key={k} class="rounded-md border border-[var(--color-border)] p-2">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-[12px] font-medium text-[var(--color-text)]">{i.title}</span>
                  <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">{DC_STATUS_LABEL[i.status] ?? i.status}</span>
                  {i.year && <span class="text-[10px] text-[var(--color-text-faint)]">{i.year}</span>}
                  {i.url && <a href={i.url} target="_blank" rel="noreferrer" class="ml-auto text-[10px] text-[var(--color-accent)] underline">source</a>}
                </div>
                {i.summary && <div class="text-[11.5px] text-[var(--color-text-muted)] mt-0.5">{i.summary}</div>}
                <div class="text-[11px] text-[var(--color-text-faint)] mt-0.5">Why this matters: {i.whyItMatters}</div>
              </div>
            ))}
          </div>
        )}
        <div class="text-[10px] text-[var(--color-text-faint)]">{dc.note}</div>
      </div>

      {gs.status !== 'not_run' && (
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-2">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text)]">Growth signals</span>
            <span class="text-[10px] text-[var(--color-text-faint)]">{gs.summary}</span>
          </div>
          {gs.items.length > 0 ? (
            <div class="space-y-1.5">
              {gs.items.map((i, k) => (
                <div key={k} class="rounded-md border border-[var(--color-border)] p-2">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-[12px] font-medium text-[var(--color-text)]">{i.title}</span>
                    <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">{i.category.replace(/_/g, ' ')}</span>
                    {i.url && <a href={i.url} target="_blank" rel="noreferrer" class="ml-auto text-[10px] text-[var(--color-accent)] underline">source</a>}
                  </div>
                  {i.summary && <div class="text-[11.5px] text-[var(--color-text-muted)] mt-0.5">{i.summary}</div>}
                  <div class="text-[11px] text-[var(--color-text-faint)] mt-0.5">Why this matters: {i.whyItMatters}</div>
                </div>
              ))}
            </div>
          ) : (
            <div class="text-[11.5px] text-[var(--color-text-faint)]">No land-relevant signals in this scan — irrelevant local news is filtered out, never shown.</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── LandPortal imagery + observations (Property tab) ─────────────────────────
function RetainedLandPortalPanel({ inspection, token, ownerName }: { inspection?: ReportView['landportalInspection']; token: string; ownerName?: string | null }) {
  if (!inspection) return null;
  const withToken = (url: string) => url.startsWith('/api/')
    ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
    : url;
  const assets = (Array.isArray(inspection.assets) ? inspection.assets : [])
    .filter((asset) => asset?.kind !== 'google' && typeof asset?.url === 'string' && asset.url.length > 0);
  const facts = inspection.factSheet;
  const rows: Array<[string, unknown]> = [
    ['Parcel ID', facts?.apn],
    ['Owner of record', ownerName ?? facts?.owner],
    ['Acres', facts?.acres],
    ['Road frontage', facts?.access?.roadFrontageFt == null ? null : `${facts.access.roadFrontageFt} ft`],
    ['Buildable area', facts?.buildability?.acres == null ? null : /\bac\b/i.test(String(facts.buildability.acres)) ? String(facts.buildability.acres) : `${facts.buildability.acres} ac`],
    ['Wetlands', facts?.environment?.wetlandsPct],
    ['Flood zone', facts?.environment?.floodZone],
    ['Average slope', facts?.environment?.slope],
    ['Last sale price', facts?.valuation?.lastSalePrice],
    ['Last sale date', facts?.valuation?.lastSaleDate],
    ['Assessed value', facts?.valuation?.assessedValue],
    ['Market value', facts?.valuation?.totalMarketValue],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '');
  return (
    <Section title="LandPortal property facts & visuals">
      {inspection.parcelUrl && /landportal/i.test(inspection.parcelUrl) && (
        <a href={inspection.parcelUrl} target="_blank" rel="noreferrer" class="text-[11px] text-[var(--color-accent)] underline">Open LandPortal parcel page</a>
      )}
      {rows.length > 0 && (
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-2" data-testid="landportal-fact-sheet">
          {rows.map(([label, value]) => (
            <div key={label} class="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-2">
              <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">{label}</div>
              <div class="text-[12px] font-medium text-[var(--color-text)] mt-0.5">{String(value)}</div>
            </div>
          ))}
        </div>
      )}
      {assets.length > 0 ? (
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2" data-testid="landportal-visual-gallery">
          {assets.map((asset, index) => {
            const label = String(asset.label || asset.kind || `Parcel visual ${index + 1}`);
            const url = withToken(asset.url);
            return (
              <figure key={`${asset.key || asset.kind || 'visual'}-${index}`} class="m-0" data-visual-kind={asset.kind || 'parcel_visual'}>
                <a href={url} target="_blank" rel="noreferrer" aria-label={`Open ${label}`}>
                  <img src={url} alt={label} class="w-full h-44 object-cover rounded-lg border border-[var(--color-border)]" loading="lazy" />
                </a>
                <figcaption class="text-[10px] text-[var(--color-text-faint)] mt-0.5">{label}</figcaption>
              </figure>
            );
          })}
        </div>
      ) : <Placeholder text="No retained parcel visuals are available yet." />}
    </Section>
  );
}

function LandPortalImageryPanel({ inspection, token }: { inspection?: ReportView['landportalInspection']; token: string }) {
  if (!inspection) return null;
  const withToken = (u: string) => (u.startsWith('/api/') ? `${u}${u.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : u);
  const shots = (inspection.assets ?? []).filter((a) => a.url);
  const facts = inspection.factSheet;
  if (!shots.length && !(inspection.visualObservations ?? []).length && !facts) return null;
  const parcelUrlIsLandPortal = !!inspection.parcelUrl && /landportal/i.test(inspection.parcelUrl);
  const factRows: Array<[string, string | number | null | undefined]> = facts ? [
    ['Parcel ID', facts.apn],
    ['Owner of record', facts.owner],
    ['Acres', facts.acres],
    ['Road frontage', facts.access?.roadFrontageFt == null ? null : `${facts.access.roadFrontageFt.toLocaleString()} ft${facts.access.roadName ? ` on ${facts.access.roadName}` : ''}`],
    ['Buildable area', facts.buildability?.acres == null ? null : `${facts.buildability.acres.toFixed(2)} ac${facts.buildability.pct == null ? '' : ` (${facts.buildability.pct.toFixed(2)}%)`}`],
    ['Wetlands', facts.environment?.wetlandsPct],
    ['Flood zone', [facts.environment.floodZone, facts.environment.femaCoveragePct].filter(Boolean).join(' · ') || null],
    ['Average slope', facts.environment?.slope],
    ['Last sale', [facts.valuation.lastSalePrice, facts.valuation.lastSaleDate].filter(Boolean).join(' · ') || null],
    ['Assessed value', facts.valuation?.assessedValue],
    ['Market value', facts.valuation?.totalMarketValue],
  ] : [];
  return (
    <Section title="LandPortal property facts & visuals">
      {inspection.parcelUrl && (
        <div class="text-[11px] mb-1"><a href={inspection.parcelUrl} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">{parcelUrlIsLandPortal ? 'Open LandPortal parcel page' : 'Open official parcel source'}</a></div>
      )}
      {facts && (
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3" data-testid="landportal-fact-sheet">
          {factRows.filter(([, value]) => value !== null && value !== undefined && value !== '').map(([label, value]) => (
            <div key={label} class="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-2">
              <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">{label}</div>
              <div class="text-[12px] font-medium text-[var(--color-text)] mt-0.5">{String(value)}</div>
            </div>
          ))}
        </div>
      )}
      {shots.length > 0 && (
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2" data-testid="landportal-visual-gallery">
          {shots.map((a) => (
            <figure key={a.key} class="m-0" data-visual-kind={a.kind}>
              <a href={withToken(a.url)} target="_blank" rel="noreferrer" aria-label={`Open ${a.label}`}>
                <img src={withToken(a.url)} alt={a.label} class="w-full h-40 sm:h-44 object-cover rounded-lg border border-[var(--color-border)]" loading="lazy" />
              </a>
              <figcaption class="text-[10px] text-[var(--color-text-faint)] mt-0.5">{a.label}{a.overlay ? ` · ${a.overlay}` : ''}{a.note ? ` — ${a.note}` : ''}</figcaption>
            </figure>
          ))}
        </div>
      )}
      {(inspection.visualObservations ?? []).length > 0 && (
        <div class="space-y-1 pt-2">
          <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Visual observations</div>
          {inspection.visualObservations.map((o, i) => (
            <div key={i} class="text-[11.5px] text-[var(--color-text-muted)]">
              <span class="text-[var(--color-text)]">{o.label}:</span> {o.detail}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ── Multi-parcel roster (Parcel A / Parcel B — never conflated) ──────────────
// Mirrors parcelRosterFor in routes.ts. Each APN renders its own honest state;
// Parcel B never inherits Parcel A's imagery, and no generic image fills a gap.
function LandPortalCompMapEvidence({ inspection, token }: { inspection?: ReportView['landportalInspection']; token: string }) {
  const map = inspection?.assets?.find((asset) => asset.url && /comparables?_map/i.test(asset.kind));
  if (!map) return null;
  const url = map.url.startsWith('/api/') ? `${map.url}&token=${encodeURIComponent(token)}` : map.url;
  return (
    <Section title="LandPortal comparable locations">
      <img
        src={url}
        alt={map.label || 'LandPortal subject and comparable locations'}
        class="w-full max-h-[34rem] object-contain rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]"
        loading="lazy"
      />
      <div class="text-[10.5px] text-[var(--color-text-faint)] mt-1">
        Saved LandPortal view of the subject and nearby asking references.
      </div>
    </Section>
  );
}

function LandPortalComparableTable({ inspection }: { inspection?: ReportView['landportalInspection'] }) {
  const rows = inspection?.comparables ?? [];
  if (!rows.length) return null;
  const pricesPerAcre = rows.map((row) => row.pricePerAcre).filter((value): value is number => typeof value === 'number' && value > 0).sort((a, b) => a - b);
  const midpoint = pricesPerAcre.length ? pricesPerAcre[Math.floor(pricesPerAcre.length / 2)] : null;
  return (
    <Section title="LandPortal asking references">
      <div class="text-[11.5px] text-[var(--color-text-muted)] mb-2">
        {rows.length} saved nearby land references{midpoint != null ? ` center around ${usd(midpoint)} per acre` : ''}. These are asking references, not closed-sale proof.
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-[11px]" data-testid="landportal-comparables">
          <thead><tr class="text-left text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]"><th class="py-1.5 pr-3">Parcel</th><th class="py-1.5 pr-3">Acres</th><th class="py-1.5 pr-3">Ask</th><th class="py-1.5 pr-3">Ask / acre</th><th class="py-1.5">Source</th></tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.apn ?? row.address ?? index}-${row.price ?? ''}`} class="border-t border-[var(--color-border)]">
                <td class="py-2 pr-3 font-medium text-[var(--color-text)]">{row.address ?? (row.apn ? `APN ${row.apn}` : `Reference ${index + 1}`)}</td>
                <td class="py-2 pr-3 tabular-nums">{row.acres == null ? '—' : row.acres.toFixed(2)}</td>
                <td class="py-2 pr-3 tabular-nums">{row.price == null ? '—' : usd(row.price)}</td>
                <td class="py-2 pr-3 tabular-nums">{row.pricePerAcre == null ? '—' : usd(row.pricePerAcre)}</td>
                <td class="py-2">{row.sourceUrl ? <a href={row.sourceUrl} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">Open reference</a> : 'Saved record'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function PropertyIdentityControl({ report, prop, onSaved }: {
  report: ReportView | null; prop: PropertyCardLite; onSaved: () => Promise<void> | void;
}) {
  const situs = factOf(report, 'situsAddress', 'address').value ?? prop.active_input_address ?? '';
  const initialAddress = [situs, prop.city, prop.state].filter(Boolean).join(', ');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    address: initialAddress,
    city: prop.city ?? cityFromSitus(situs) ?? '',
    county: factOf(report, 'county').value ?? prop.county ?? '',
    state: factOf(report, 'state').value ?? prop.state ?? '',
    apn: factOf(report, 'apn', 'parcelId').value ?? prop.apn ?? '',
    owner: factOf(report, 'owner').value ?? report?.landportalInspection?.factSheet?.owner ?? prop.owner ?? '',
    sourceUrl: '',
    sourceLabel: 'Official parcel record',
    confirmed: false,
  });
  useEffect(() => {
    setOpen(false);
    setMessage(null);
    setForm({
      address: initialAddress,
      city: prop.city ?? cityFromSitus(situs) ?? '',
      county: factOf(report, 'county').value ?? prop.county ?? '',
      state: factOf(report, 'state').value ?? prop.state ?? '',
      apn: factOf(report, 'apn', 'parcelId').value ?? prop.apn ?? '',
      owner: factOf(report, 'owner').value ?? report?.landportalInspection?.factSheet?.owner ?? prop.owner ?? '',
      sourceUrl: '',
      sourceLabel: 'Official parcel record',
      confirmed: false,
    });
  }, [prop.id]);
  const setField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  async function saveIdentity() {
    setBusy(true);
    setMessage(null);
    try {
      await apiPost(`/api/landos/property-cards/${prop.id}/verified-parcel-reconciliation`, {
        address: form.address.trim(), city: form.city.trim(), county: form.county.trim(), state: form.state.trim().toUpperCase(),
        apn: form.apn.trim(), owner: form.owner.trim(), sourceUrl: form.sourceUrl.trim(), sourceLabel: form.sourceLabel.trim(),
        confirmAcceptedIdentityReplacement: form.confirmed,
      });
      await onSaved();
      setForm((current) => ({ ...current, confirmed: false }));
      setMessage('Property identity saved. The prior intake address remains in Activity history.');
      setOpen(false);
    } catch (error: any) {
      setMessage(error?.message || String(error));
    } finally {
      setBusy(false);
    }
  }
  const inputClass = 'w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[11.5px]';
  return (
    <Section title="Property identity">
      <div class="flex flex-wrap items-center gap-2">
        <div class="text-[12px] text-[var(--color-text-muted)] flex-1">Correct the property address or official parcel identity without changing the seller or lead contact.</div>
        <button type="button" onClick={() => setOpen((value) => !value)} class="px-2.5 py-1 rounded-md border border-[var(--color-border)] text-[11px] hover:bg-[var(--color-elevated)]">{open ? 'Cancel' : 'Correct property identity'}</button>
      </div>
      {open && (
        <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label class="sm:col-span-2 text-[10.5px] text-[var(--color-text-faint)]">Canonical property address<input class={inputClass} value={form.address} onInput={(e) => setField('address', (e.target as HTMLInputElement).value)} /></label>
          <label class="text-[10.5px] text-[var(--color-text-faint)]">City<input class={inputClass} value={form.city} onInput={(e) => setField('city', (e.target as HTMLInputElement).value)} /></label>
          <label class="text-[10.5px] text-[var(--color-text-faint)]">County<input class={inputClass} value={form.county} onInput={(e) => setField('county', (e.target as HTMLInputElement).value)} /></label>
          <label class="text-[10.5px] text-[var(--color-text-faint)]">State<input class={inputClass} maxLength={2} value={form.state} onInput={(e) => setField('state', (e.target as HTMLInputElement).value)} /></label>
          <label class="text-[10.5px] text-[var(--color-text-faint)]">APN / parcel ID<input class={inputClass} value={form.apn} onInput={(e) => setField('apn', (e.target as HTMLInputElement).value)} /></label>
          <label class="sm:col-span-2 text-[10.5px] text-[var(--color-text-faint)]">Owner of record<input class={inputClass} value={form.owner} onInput={(e) => setField('owner', (e.target as HTMLInputElement).value)} /></label>
          <label class="sm:col-span-2 text-[10.5px] text-[var(--color-text-faint)]">Official source URL<input class={inputClass} type="url" placeholder="https://…" value={form.sourceUrl} onInput={(e) => setField('sourceUrl', (e.target as HTMLInputElement).value)} /></label>
          <label class="sm:col-span-2 text-[10.5px] text-[var(--color-text-faint)]">Source name<input class={inputClass} value={form.sourceLabel} onInput={(e) => setField('sourceLabel', (e.target as HTMLInputElement).value)} /></label>
          <label class="sm:col-span-2 flex items-start gap-2 text-[11px] text-[var(--color-text-muted)]"><input type="checkbox" checked={form.confirmed} onChange={(e) => setField('confirmed', (e.target as HTMLInputElement).checked)} />I verified these values against the linked official parcel record.</label>
          <button type="button" disabled={busy || !form.confirmed} onClick={() => void saveIdentity()} class="sm:col-span-2 px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-white text-[11.5px] font-medium disabled:opacity-40">{busy ? 'Saving…' : 'Save verified property identity'}</button>
        </div>
      )}
      {message && <div class="text-[11px] text-[var(--color-text-muted)] mt-2">{message}</div>}
    </Section>
  );
}

function AddDealContactControl({ dealId, onSaved }: { dealId: number; onSaved: () => Promise<void> | void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<'lead' | 'seller' | 'contact'>('lead');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    setName('');
    setRole('lead');
    setMessage(null);
  }, [dealId]);
  async function addContact() {
    if (!name.trim()) return;
    setBusy(true); setMessage(null);
    try {
      const response = await apiPost<{ created: boolean }>(`/api/landos/deal-cards/${dealId}/people`, { name: name.trim(), role });
      await onSaved();
      setMessage(response.created ? 'Contact saved separately from the owner of record.' : 'That contact is already linked to this Deal Card.');
      setName('');
    } catch (error: any) { setMessage(error?.message || String(error)); }
    finally { setBusy(false); }
  }
  return (
    <div class="rounded-md border border-[var(--color-border)] p-2.5 mb-3">
      <div class="text-[11px] font-medium text-[var(--color-text)] mb-1.5">Add lead or contact</div>
      <div class="flex flex-col sm:flex-row gap-2">
        <input class="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[11.5px]" placeholder="Full name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        <select class="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[11.5px]" value={role} onChange={(e) => setRole((e.target as HTMLSelectElement).value as typeof role)}><option value="lead">Lead</option><option value="seller">Seller</option><option value="contact">Contact</option></select>
        <button type="button" disabled={busy || !name.trim()} onClick={() => void addContact()} class="px-3 py-1.5 rounded-md border border-[var(--color-accent)] text-[var(--color-accent)] text-[11.5px] font-medium disabled:opacity-40">{busy ? 'Saving…' : 'Add contact'}</button>
      </div>
      <div class="text-[10.5px] text-[var(--color-text-faint)] mt-1">Contact identity is separate from the parcel’s owner-of-record field. Phone, email, and authority remain blank unless known.</div>
      {message && <div class="text-[11px] text-[var(--color-text-muted)] mt-1">{message}</div>}
    </div>
  );
}

interface ParcelRosterEntryView {
  apn: string;
  label: string;
  cardId: number | null;
  status: 'resolved_verified_imagery' | 'resolved_no_imagery' | 'unresolved';
  nextAction: string | null;
}

const PARCEL_STATUS_LABEL: Record<ParcelRosterEntryView['status'], { text: string; cls: string }> = {
  resolved_verified_imagery: { text: 'Resolved · verified imagery', cls: 'text-[var(--color-status-done)] border-[var(--color-status-done)]' },
  resolved_no_imagery: { text: 'Resolved · no verified imagery yet', cls: 'text-[var(--color-accent)] border-[var(--color-accent)]' },
  unresolved: { text: 'Unresolved · awaiting parcel resolution', cls: 'text-amber-600 dark:text-amber-400 border-amber-500/50' },
};

function ParcelRosterBlock({ entry, cards, token }: { entry: ParcelRosterEntryView; cards: PropertyCardLite[]; token: string }) {
  const tone = PARCEL_STATUS_LABEL[entry.status];
  const card = entry.cardId != null ? cards.find((c) => c.id === entry.cardId) ?? null : null;
  return (
    <div class={`rounded-lg border ${entry.status === 'unresolved' ? 'border-amber-500/40' : 'border-[var(--color-accent)]/40'} bg-[var(--color-card)] p-3 space-y-2`}>
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[12px] font-bold text-[var(--color-text)]">{entry.label}</span>
        <span class="text-[11px] text-[var(--color-text-muted)]">APN {entry.apn}</span>
        <span class={`ml-auto text-[10px] px-2 py-0.5 rounded-full border ${tone.cls}`}>{tone.text}</span>
      </div>
      {card && (
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5">
          <HeaderField label="County / State" value={[card.county, card.state].filter(Boolean).join(', ') || undefined} />
          <HeaderField label="Acreage" value={card.acres != null ? `${card.acres} ac` : undefined} />
          <HeaderField label="Verification" value={card.verification_status ?? undefined} />
        </div>
      )}
      {/* Card-scoped imagery: THIS parcel's verified visuals only. */}
      {card && entry.status === 'resolved_verified_imagery' && (
        <VisualIntelligencePanel cardId={card.id} token={token} compact />
      )}
      {entry.status !== 'resolved_verified_imagery' && (
        <div class="text-[11.5px] text-[var(--color-text-muted)] rounded-md border border-dashed border-[var(--color-border)] p-2.5">
          {entry.status === 'unresolved'
            ? 'Parcel location not yet resolved — no imagery or facts are shown for this parcel.'
            : 'Parcel image unavailable — resolved, but no imagery has passed parcel-association verification yet.'}
          {entry.nextAction && <div class="mt-1"><span class="text-[var(--color-accent)] font-semibold">Next:</span> {entry.nextAction}</div>}
        </div>
      )}
    </div>
  );
}

// ── OVERVIEW — the executive investment memo ─────────────────────────────────
// Reads top-to-bottom like a memo: executive summary first (the thing Tyler
// reads before calling the seller), then who owns it / what it is (key facts),
// what the facts mean, the biggest risks, what it is probably worth (the ONE
// valuation + the five best comps), the recommended strategy, the seller, and
// the next operator actions. No widget clutter — deep detail lives on its tab.
interface PublicFindingView {
  kind?: string; summary?: string; whyItMatters?: string; limitation?: string; datasetName?: string; datasetDate?: string; acquisitionDate?: string; evidenceRef?: string;
  intersects?: boolean | null; approximateTotalAcres?: number | null; approximateParcelPercentage?: number | null;
  zones?: Array<{ zone: string; approximateAcres: number; parcelPercentage: number; specialFloodHazardArea?: boolean }>;
  mapStatus?: string; panelNumber?: string | null; effectiveDate?: string | null; baseFloodElevation?: string | null; accessOrDevelopmentEffect?: string;
  mapUnits?: Array<{ symbol: string; name: string; approximateAcres?: number; parcelPercentage?: number; components: Array<{ name: string; percentage?: number; septicLimitation: string; limitingFactors: string[]; drainageClass?: string; seasonalSaturationDepthIn?: number | null; restrictiveLayerDepthIn?: number | null; hydrologicSoilGroup?: string; slopeRangePct?: [number, number]; saturatedHydraulicConductivity?: string }> }>;
  apparentInvestigationAreas?: string;
  minimumElevationFt?: number | null; maximumElevationFt?: number | null; totalReliefFt?: number | null; meanSlopePct?: number | null; medianSlopePct?: number | null; maximumSlopePct?: number | null;
  bands?: Array<{ band: string; approximateAcres: number; parcelPercentage: number }>; elevationResolution?: string; largestApparentLowSlopeAreaAcres?: number; slopeNearAccessOrImprovements?: string;
  adjoiningRoads?: Array<{ name: string; status: string; approximateMappedFrontageFt?: number; apparentRightOfWayContact: boolean | null }>; approximateMappedFrontageFt?: number | null; measurementMethod?: string; geometrySource?: string; accessConcerns?: string[];
  parcelOutlineShown?: boolean; imagerySource?: string; resolution?: string; visibleFeatures?: string[];
  facts?: Array<{ field: string; value: string | number }>;
  zoningCode?: string | null; zoningName?: string | null; overlayDistricts?: string[]; futureLandUse?: string | null; existingLandUse?: string | null; jurisdiction?: string;
  minimumLotSize?: string | null; allowedUsesNote?: string | null; subdivisionNote?: string | null; sourceLayerUrls?: string[];
  publicWater?: string; publicSewer?: string; electric?: string; wellLikelyRequired?: boolean | null; septicLikelyRequired?: boolean | null;
  serviceProviders?: Array<{ service: string; provider: string; contact?: string; basis: string }>; researchAttempted?: string[];
  /** Optional, source-labelled screening outputs. These stay absent rather than
      guessing a buildable area from another constraint. */
  apparentBuildableAcres?: number | null; apparentBuildablePercentage?: number | null;
  transmissionLines?: Array<{ note: string; distanceFt?: number | null; source?: string }>;
  waterFeatures?: Array<{ note: string; distanceFt?: number | null; source?: string }>;
  crossChecks?: Array<{ field: string; value: string | number; agreesWithPreferredEvidence: boolean | null }>;
  screenshotRefs?: string[]; highResolutionImageryRefs?: string[];
}
interface PublicScreenTaskView {
  task: string; label: string; status: string; confidence: string; failureReason?: string;
  finding?: PublicFindingView;
  evidence?: Array<{ evidenceId?: string; sourceName: string; sourceUrl?: string; datasetDate?: string; retrievedAt?: string; sourceTier?: string; verification?: string; confidence?: string; captureMode?: string; decisionUsable?: boolean; limitation?: string }>;
  completionState?: string; operatorMessage?: string; contractViolations?: string[]; attempts?: number;
  timeoutMs?: number; durationMs?: number;
  providerOutcomes?: Array<{ providerId: string; status: string; attemptCount: number; evidenceCount: number; note: string }>;
}
interface PublicScreenRunView {
  status: string; captureMode: string; completedAt: string; startedAt?: string; durationMs?: number; downstreamAllowed?: boolean;
  nonBlockingGaps?: string[]; gate?: { allowed: boolean; reasonCode: string; explanation: string }; tasks: PublicScreenTaskView[];
}
interface PropertyIntelligenceStageView {
  stageId: string; label: string; role: 'required' | 'conditional' | 'optional'; completionState: string; operatorMessage: string;
  providerOutcomes: Array<{ providerId: string; status: string; attemptCount: number; evidenceCount: number; candidateCount?: number; note: string }>;
  evidenceCount: number; violations: string[];
}
interface PropertyIntelligenceOrchestrationView {
  status: string; contractVersion: string; deadlineMs: number; startedAt: string; completedAt: string | null; durationMs: number | null;
  firstUsefulResultMs: number | null; nonBlockingGaps: string[]; downstreamAllowed: boolean;
  validation: { valid: boolean; violations: string[] };
  stages: PropertyIntelligenceStageView[];
  compReconciliation?: { rejected: Array<{ provider: string; address?: string | null; reason: string }>; duplicateMerges: unknown[]; valuationBlockers: string[] } | null;
}
interface PublicScreenStoredView { parcelKey: string; updatedAt: string; run: PublicScreenRunView; orchestration?: PropertyIntelligenceOrchestrationView | null; }

const intelligenceTone = (state?: string) => {
  if (/^(complete|succeeded|retrieved)$/i.test(state ?? '')) return 'border-emerald-500/45 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (/^(partial|blocked|unavailable|no_result|complete_with_gaps)$/i.test(state ?? '')) return 'border-amber-500/45 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (/^(failed|timed_out)$/i.test(state ?? '')) return 'border-rose-500/45 bg-rose-500/10 text-rose-700 dark:text-rose-300';
  return 'border-[var(--color-border)] bg-[var(--color-elevated)] text-[var(--color-text-muted)]';
};
const intelligenceLabel = (value?: string | null) => (value ?? 'not attempted').replace(/_/g, ' ');
const durationLabel = (ms?: number | null) => typeof ms === 'number' && Number.isFinite(ms) ? (ms < 1_000 ? `${ms} ms` : `${Math.round(ms / 1_000)} sec`) : null;

function EvidenceProvenance({ evidence }: { evidence: NonNullable<PublicScreenTaskView['evidence']>[number] }) {
  return (
    <div class="rounded border border-[var(--color-border)] bg-[var(--color-elevated)] p-2 text-[10.5px] text-[var(--color-text-muted)]">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        {evidence.sourceUrl
          ? <a class="font-medium text-[var(--color-accent)] hover:underline" href={evidence.sourceUrl} target="_blank" rel="noreferrer">{evidence.sourceName}</a>
          : <span class="font-medium text-[var(--color-text)]">{evidence.sourceName}</span>}
        {evidence.sourceTier && <span>tier: {intelligenceLabel(evidence.sourceTier)}</span>}
        {evidence.verification && <span>basis: {intelligenceLabel(evidence.verification)}</span>}
        {evidence.confidence && <span>confidence: {evidence.confidence}</span>}
        {evidence.captureMode && <span>capture: {evidence.captureMode}</span>}
        {evidence.decisionUsable === false && <span class="text-amber-700 dark:text-amber-300">not decision-usable</span>}
      </div>
      {(evidence.datasetDate || evidence.retrievedAt) && <div class="mt-0.5 text-[var(--color-text-faint)]">{evidence.datasetDate && `dataset ${evidence.datasetDate}`}{evidence.datasetDate && evidence.retrievedAt && ' · '}{evidence.retrievedAt && `retrieved ${evidence.retrievedAt}`}</div>}
      {evidence.limitation && <div class="mt-0.5">Limit: {evidence.limitation}</div>}
    </div>
  );
}

function PropertyIntelligenceOrchestration({ orchestration }: { orchestration?: PropertyIntelligenceOrchestrationView | null }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!orchestration) return null;
  const runTiming = [durationLabel(orchestration.durationMs), `deadline ${durationLabel(orchestration.deadlineMs) ?? 'not recorded'}`, orchestration.firstUsefulResultMs != null ? `first useful result ${durationLabel(orchestration.firstUsefulResultMs)}` : null].filter(Boolean).join(' · ');
  return (
    <div class="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-card)] p-3 space-y-2.5" data-testid="property-intelligence-orchestration">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[12px] font-semibold text-[var(--color-text)]">Canonical research orchestration</span>
        <span class={`text-[10px] border rounded-full px-1.5 py-0.5 ${intelligenceTone(orchestration.status)}`}>{intelligenceLabel(orchestration.status)}</span>
        <span class="text-[10px] text-[var(--color-text-faint)]">Contract {orchestration.contractVersion}</span>
      </div>
      <div class="text-[11.5px] text-[var(--color-text-muted)]">{runTiming || 'Timing was not recorded.'} {orchestration.downstreamAllowed ? 'Parcel gate permits downstream research.' : 'Parcel gate still prevents downstream research.'}</div>
      {orchestration.nonBlockingGaps.length > 0 && <div class="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">Open research gaps: {orchestration.nonBlockingGaps.map(intelligenceLabel).join(' · ')}</div>}
      {!orchestration.validation.valid && orchestration.validation.violations.length > 0 && <div class="rounded border border-rose-500/40 bg-rose-500/10 p-2 text-[11px] text-rose-700 dark:text-rose-300">Validation blockers: {orchestration.validation.violations.join(' · ')}</div>}
      <div class="space-y-1.5">
        {orchestration.stages.map((stage) => {
          const expanded = open === stage.stageId;
          return <div key={stage.stageId} class="rounded border border-[var(--color-border)]">
            <button type="button" class="w-full p-2 text-left" onClick={() => setOpen(expanded ? null : stage.stageId)}>
              <div class="flex flex-wrap items-center gap-1.5"><span class="text-[12px] font-medium text-[var(--color-text)]">{stage.label}</span><span class={`text-[10px] rounded border px-1.5 py-0.5 ${intelligenceTone(stage.completionState)}`}>{intelligenceLabel(stage.completionState)}</span><span class="text-[10px] text-[var(--color-text-faint)]">{stage.role} · {stage.evidenceCount} evidence item{stage.evidenceCount === 1 ? '' : 's'}</span></div>
              <div class="mt-1 text-[11px] text-[var(--color-text-muted)]">{stage.operatorMessage}</div>
            </button>
            {expanded && <div class="border-t border-[var(--color-border)] p-2 space-y-1.5">
              {stage.providerOutcomes.length > 0 ? stage.providerOutcomes.map((provider) => <div key={provider.providerId} class="text-[10.5px] text-[var(--color-text-muted)]"><span class="font-medium text-[var(--color-text)]">{provider.providerId}</span> · {intelligenceLabel(provider.status)} · {provider.attemptCount} attempt{provider.attemptCount === 1 ? '' : 's'} · {provider.evidenceCount} evidence{provider.candidateCount != null ? ` · ${provider.candidateCount} candidate(s)` : ''}<div class="mt-0.5">{provider.note}</div></div>) : <div class="text-[10.5px] text-[var(--color-text-faint)]">No provider outcome was retained for this stage.</div>}
              {stage.violations.length > 0 && <div class="text-[10.5px] text-rose-700 dark:text-rose-300">Evidence / contract issues: {stage.violations.join(' · ')}</div>}
            </div>}
          </div>;
        })}
      </div>
      {orchestration.compReconciliation && <div class="rounded border border-[var(--color-border)] p-2 text-[11px] text-[var(--color-text-muted)]"><span class="font-medium text-[var(--color-text)]">Comparable reconciliation:</span> {orchestration.compReconciliation.duplicateMerges.length} duplicate merge(s), {orchestration.compReconciliation.rejected.length} rejected candidate(s). {orchestration.compReconciliation.valuationBlockers.length ? `Valuation remains blocked: ${orchestration.compReconciliation.valuationBlockers.join(' · ')}` : 'No retained valuation blocker.'}</div>}
    </div>
  );
}

function PublicPropertyIntelligencePanel({ dealId, ownerName, onUpdated }: { dealId: number; ownerName?: string | null; onUpdated?: () => void }) {
function PublicFindingDetails({ task, finding }: { task: string; finding?: PublicFindingView }) {
  if (!finding) return null;
  const amount = (value: number | null | undefined, suffix = '') => value == null ? 'Not available' : `${value}${suffix}`;
  return (
    <div class="mt-2 space-y-1.5 text-[11px] text-[var(--color-text-muted)]">
      {task === 'wetlands' && (
        <div class="rounded border border-amber-500/30 bg-amber-500/5 p-2"><span class="font-medium text-[var(--color-text)]">Wetland screen: </span>{finding.intersects === true ? (finding.approximateTotalAcres == null ? 'Mapped wetland feature intersects the parcel. Reliable affected acreage is not yet available.' : `Mapped intersection: ${amount(finding.approximateTotalAcres, ' ac')} (${amount(finding.approximateParcelPercentage, '%')}).`) : finding.intersects === false ? 'No mapped wetland feature intersects the official parcel polygon.' : 'Intersection state is unavailable.'}</div>
      )}
      {task === 'fema_flood' && (
        <div class="space-y-1"><div class="font-medium text-[var(--color-text)]">Flood zones ({finding.mapStatus?.replace(/_/g, ' ') ?? 'coverage unknown'})</div>{finding.zones?.map((zone) => <div key={zone.zone} class="grid grid-cols-3 gap-2"><span>{zone.zone}{zone.specialFloodHazardArea ? ' - SFHA' : ''}</span><span>{amount(zone.approximateAcres, ' ac')}</span><span>{amount(zone.parcelPercentage, '%')}</span></div>)}<div>{finding.panelNumber ? `Panel ${finding.panelNumber}` : 'Panel number not retrieved'}{finding.effectiveDate ? ` - effective ${finding.effectiveDate}` : ''}{finding.baseFloodElevation ? ` - BFE ${finding.baseFloodElevation}` : ' - base flood elevation not retrieved'}</div></div>
      )}
      {task === 'soils_septic' && (
        <div class="space-y-1"><div class="font-medium text-[var(--color-text)]">Soil map units and septic-screen components</div>{finding.mapUnits?.map((unit) => <div key={unit.symbol} class="rounded border border-[var(--color-border)] p-2"><div class="text-[var(--color-text)]">{unit.symbol} - {unit.name}{unit.approximateAcres != null ? ` - ${unit.approximateAcres} ac (${unit.parcelPercentage}%)` : ' - mapped coverage not calculated'}</div>{unit.components.map((component) => <div key={component.name} class="mt-1">{component.name}{component.percentage != null ? ` (${component.percentage}%)` : ''}: <span class="text-[var(--color-text)]">{component.septicLimitation.replace(/_/g, ' ')}</span>{component.limitingFactors.length ? `; limits: ${component.limitingFactors.join(', ')}` : ''}{component.drainageClass ? `; ${component.drainageClass}` : ''}{component.hydrologicSoilGroup ? `; HSG ${component.hydrologicSoilGroup}` : ''}</div>)}</div>)}{finding.apparentInvestigationAreas && <div><span class="font-medium">First investigation area:</span> {finding.apparentInvestigationAreas}</div>}</div>
      )}
      {task === 'slope_topography' && (
        <div class="space-y-1"><div class="font-medium text-[var(--color-text)]">Terrain screen</div><div>{amount(finding.minimumElevationFt, ' ft')} min - {amount(finding.maximumElevationFt, ' ft')} max - {amount(finding.totalReliefFt, ' ft')} relief</div><div>Mean {amount(finding.meanSlopePct, '%')} - median {amount(finding.medianSlopePct, '%')} - max {amount(finding.maximumSlopePct, '%')}</div>{finding.bands?.map((band) => <span key={band.band} class="inline-block mr-2">{band.band.replace(/_/g, ' ')}: {band.approximateAcres} ac ({band.parcelPercentage}%)</span>)}{finding.elevationResolution && <div>{finding.elevationResolution}</div>}</div>
      )}
      {task === 'road_frontage' && (
        <div class="space-y-1"><div class="font-medium text-[var(--color-text)]">Road proximity and access screen</div>{finding.adjoiningRoads?.map((road) => <div key={road.name}>{road.name}: {road.apparentRightOfWayContact === true ? 'possible boundary/ROW contact - not proven' : road.apparentRightOfWayContact === false ? 'nearby, not adjoining' : 'centerline proximity only'}{road.approximateMappedFrontageFt != null ? `; ~${road.approximateMappedFrontageFt} ft of centerline falls within the screening buffer` : ''}; road class {road.status}</div>)}<div>Frontage footage is not established. {finding.measurementMethod ?? 'The screening method was not reported.'}</div><div>Parcel-road contact, public right-of-way contact, physical/driveway access, legal access, and road maintenance remain unresolved.</div></div>
      )}
      {task === 'zoning_landuse' && <div class="space-y-1"><div class="font-medium text-[var(--color-text)]">Zoning and land-use screen</div><div>{finding.zoningCode ?? 'No zoning code retrieved'}{finding.zoningName ? ` — ${finding.zoningName}` : ''}{finding.jurisdiction ? ` · ${finding.jurisdiction}` : ''}</div>{finding.overlayDistricts?.length ? <div>Overlays: {finding.overlayDistricts.join(', ')}</div> : null}{finding.futureLandUse && <div>Future land use: {finding.futureLandUse}</div>}{finding.existingLandUse && <div>Existing land use: {finding.existingLandUse}</div>}{finding.minimumLotSize && <div>Minimum lot size: {finding.minimumLotSize}</div>}{finding.allowedUsesNote && <div>Allowed-use note: {finding.allowedUsesNote}</div>}</div>}
      {task === 'utilities' && <div class="space-y-1"><div class="font-medium text-[var(--color-text)]">Utilities screen</div><div>Public water: {intelligenceLabel(finding.publicWater)} · Sewer: {intelligenceLabel(finding.publicSewer)} · Electric: {intelligenceLabel(finding.electric)}</div>{finding.wellLikelyRequired != null && <div>Well likely required: {finding.wellLikelyRequired ? 'yes' : 'no'}</div>}{finding.septicLikelyRequired != null && <div>Septic likely required: {finding.septicLikelyRequired ? 'yes' : 'no'}</div>}{finding.serviceProviders?.map((provider) => <div key={`${provider.service}-${provider.provider}`}>{provider.service}: {provider.provider} — {provider.basis}</div>)}</div>}
      {(finding.apparentBuildableAcres != null || finding.apparentBuildablePercentage != null || finding.transmissionLines?.length || finding.waterFeatures?.length) && <div class="rounded border border-amber-500/30 bg-amber-500/5 p-2 space-y-1"><div class="font-medium text-[var(--color-text)]">Buildable-area and corridor screen</div>{finding.apparentBuildableAcres != null || finding.apparentBuildablePercentage != null ? <div>Apparent unconstrained area: {finding.apparentBuildableAcres != null ? `${finding.apparentBuildableAcres} ac` : 'acreage not calculated'}{finding.apparentBuildablePercentage != null ? ` (${finding.apparentBuildablePercentage}%)` : ''}. Screening only — not a surveyed or approvable buildable-acreage conclusion.</div> : null}{finding.transmissionLines?.map((line, i) => <div key={`transmission-${i}`}>Transmission: {line.note}{line.distanceFt != null ? ` · ~${line.distanceFt} ft` : ''}</div>)}{finding.waterFeatures?.map((water, i) => <div key={`water-${i}`}>Water feature: {water.note}{water.distanceFt != null ? ` · ~${water.distanceFt} ft` : ''}</div>)}</div>}
      {task === 'imagery' && (
        <div><span class="font-medium text-[var(--color-text)]">Parcel imagery: </span>{finding.parcelOutlineShown ? 'parcel boundary shown' : 'nearby/parcel-extent imagery only; parcel boundary overlay still needed'}{finding.imagerySource ? ` - ${finding.imagerySource}` : ''}{finding.acquisitionDate ? ` - ${finding.acquisitionDate}` : ''}</div>
      )}
      {task === 'county_records' && finding.facts?.length ? <div>{finding.facts.map((fact) => {
        const value = ownerName && /^owner(?:\s+of\s+record)?$/i.test(fact.field.trim()) ? ownerName : fact.value;
        return <span key={fact.field} class="inline-block mr-3"><span class="text-[var(--color-text-faint)]">{fact.field}:</span> {value}</span>;
      })}</div> : null}
      {task === 'land_portal' && <div class="space-y-1"><div class="font-medium text-[var(--color-text)]">LandPortal property check</div>{finding.crossChecks?.map((check) => <div key={check.field}>{check.field}: {check.value}{check.agreesWithPreferredEvidence === false ? ' · differs from the official parcel record' : ''}</div>)}</div>}
    </div>
  );
}

  const [saved, setSaved] = useState<PublicScreenStoredView | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const load = async () => {
    setLoading(true);
    try { const response = await apiGet<{ publicIntelligence: PublicScreenStoredView | null }>(`/api/landos/deal-cards/${dealId}/public-intelligence`); setSaved(response.publicIntelligence); }
    catch { setMessage('Saved public screening could not be loaded.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [dealId]);
  const run = async () => {
    setRunning(true); setMessage(null);
    try { const response = await apiPost<{ publicIntelligence: PublicScreenStoredView }>(`/api/landos/deal-cards/${dealId}/public-intelligence/run`, {}); setSaved(response.publicIntelligence); onUpdated?.(); }
    catch { setMessage('Public property facts could not be refreshed. Review the property identity and try again.'); }
    finally { setRunning(false); }
  };
  const tasks = saved?.run.tasks ?? [];
  const identityBlocked = saved?.orchestration?.status === 'blocked_identity' || saved?.run.status === 'blocked_identity';
  return <Section title="Public Property Intelligence">
    <div class="space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[12px] text-[var(--color-text-muted)]">{saved ? identityBlocked ? `An official parcel match is required before public property facts can refresh · updated ${formatRelativeTime(saved.updatedAt)}` : `Public property facts for APN ${saved.parcelKey} · updated ${formatRelativeTime(saved.updatedAt)}` : 'No public property facts are saved for this Deal Card.'}</span>
        <button type="button" onClick={run} disabled={running} class="ml-auto px-2.5 py-1.5 rounded-md text-[12px] font-medium bg-[var(--color-accent)] text-white disabled:opacity-40">{running ? 'Running public sources…' : saved ? 'Refresh public screening' : 'Run public screening'}</button>
      </div>
      <div class="text-[11px] text-[var(--color-text-faint)]">Wetlands, flood, soil, terrain, road, and county-record facts use the verified parcel geometry and link to their public sources.</div>
      {message && <div class="rounded-md border border-amber-500/40 p-2 text-[12px] text-amber-700 dark:text-amber-300">{message}</div>}
      {loading && <div class="text-[12px] text-[var(--color-text-muted)]">Loading saved public screening…</div>}
      {!loading && tasks.map((task) => <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-1.5" key={task.task}>
        <div class="text-[13px] font-semibold text-[var(--color-text)]">{task.label}</div>
        <div class="text-[12px] text-[var(--color-text)]">{task.finding?.summary ?? task.failureReason ?? 'No finding was retrieved.'}</div>
        {task.finding?.whyItMatters && <div class="text-[11.5px] text-[var(--color-text-muted)]"><span class="font-medium">Why it matters:</span> {task.finding.whyItMatters}</div>}
        {(task.finding?.datasetName || task.finding?.acquisitionDate) && <div class="text-[11px] text-[var(--color-text-faint)]">{task.finding.datasetName}{task.finding.acquisitionDate ? ` · data/imagery date ${task.finding.acquisitionDate}` : ''}</div>}
        <PublicFindingDetails task={task.task} finding={task.finding} />
        {!!task.evidence?.length && <div class="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px]">{task.evidence.map((source, index) => source.sourceUrl ? <a class="text-[var(--color-accent)] underline" href={source.sourceUrl} target="_blank" rel="noreferrer" key={source.evidenceId ?? `${source.sourceName}-${index}`}>{source.sourceName}</a> : <span class="text-[var(--color-text-faint)]" key={source.evidenceId ?? `${source.sourceName}-${index}`}>{source.sourceName}</span>)}</div>}
        {task.task === 'imagery' && task.finding?.evidenceRef && <img src={task.finding.evidenceRef} alt="Official public aerial imagery for the parcel extent" class="w-full max-h-64 object-cover rounded border border-[var(--color-border)]" />}
        {task.finding?.limitation && <div class="text-[11px] text-[var(--color-text-faint)]">Limit: {task.finding.limitation}</div>}
      </div>)}
    </div>
  </Section>;
}
function OverviewTab({
  report, es, dcr, spine, deal, prop, seller, token, runReport, reportRunning, pursuit, onPublicIntelligenceUpdated, record,
}: {
  report: ReportView | null; es: ExecSummaryView | null; dcr: DiscoveryReportView | null;
  spine: BusinessSpineView | null; deal: DealCardDetail; prop?: PropertyCardLite; seller?: PersonLite;
  token: string; runReport: () => void; reportRunning: boolean;
  pursuit?: PursuitView | null; onPublicIntelligenceUpdated?: () => void;
  record?: OperatorRecordView | null;
}) {
  // Operator-first Overview: the 30-second read. Verdict rail, feasibility,
  // risks, value, strategy, agent work board. Detailed provider material lives
  // on the Due Diligence tab; visuals on the Visuals tab.
  if (record) {
    return (
      <div class="space-y-3">
        <OverviewSummary es={es} report={report} />
        <ContradictionBanner report={report} record={record} />
        <button
          type="button"
          onClick={runReport}
          disabled={reportRunning}
          class="w-full px-3 py-2.5 rounded-lg text-[13px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
        >
          {reportRunning ? 'Running Property Intelligence…' : report?.exists ? 'Re-run Property Intelligence' : 'Run Property Intelligence'}
        </button>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-2 items-start">
          <FeasibilityStrip record={record} />
          <div class="space-y-2">
            {report?.valuation?.primary && <ValuationPanel val={report.valuation} />}
          </div>
        </div>
        <RisksUnknownsPanel record={record} />
        <BestCompsPanel bc={report?.bestComps} />
        <StrategySnapshot dcr={dcr} es={es} />
        <SellerSnapshot deal={deal} seller={seller} es={es} />
      </div>
    );
  }
  return (
    <div class="space-y-4">
      {/* 1. The executive summary — the first thing read before calling the seller. */}
      <OverviewSummary es={es} report={report} />
      <ContradictionBanner report={report} />

      {/* Primary CTA — always available so a newly resolved parcel can refresh
          an older research-progress report without hunting in another tab. */}
      <button
        type="button"
        onClick={runReport}
        disabled={reportRunning}
        class="w-full px-3 py-2.5 rounded-lg text-[13px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
      >
        {reportRunning ? 'Running Property Intelligence…' : report?.exists ? 'Re-run Property Intelligence' : 'Run Property Intelligence'}
      </button>

      {/* 2. What it looks like — one hero visual with links out. */}
      <HeroVisual report={report} prop={prop} discoveryReport={dcr} token={token} />

      {/* 3. Who owns it / what it is — source-labeled key facts. */}
      <KeyFactsGrid report={report} />
      <PublicPropertyIntelligencePanel dealId={deal.id} ownerName={seller?.name ?? prop?.owner} onUpdated={onPublicIntelligenceUpdated} />
      <WhatThisMeans report={report} es={es} />

      {/* 4. The biggest risks. */}
      <KeyRisksUnknowns report={report} es={es} />

      {/* 5. What it is probably worth — the ONE valuation + the five best comps. */}
      {report?.valuation?.primary && <ValuationPanel val={report.valuation} />}
      <BestCompsPanel bc={report?.bestComps} />

      {/* 6. The recommended acquisition strategy. */}
      <StrategySnapshot dcr={dcr} es={es} />

      {/* 7. The seller. */}
      <SellerSnapshot deal={deal} seller={seller} es={es} />

      {/* 8. Next operator actions — the memo's close. */}
      <NextActionsPanel es={es} spine={spine} pursuit={pursuit} />
    </div>
  );
}

export function DealCard({ dealCardId, entity = 'all', onOpenDeal }: { dealCardId?: number; entity?: EntityFilter; onOpenDeal?: (id: number) => void }) {
  const [deal, setDeal] = useState<DealCardDetail | null>(null);
  const [spine, setSpine] = useState<BusinessSpineView | null>(null);
  const [resolution, setResolution] = useState<ResolutionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Active Deal Card tab. Resets to Summary whenever a different card opens so the
  // operator always lands on the 30-second read.
  const [activeTab, setActiveTab] = useState<DealTab>('overview');

  // Saved-cards list state. The list is the primary open flow: fetched on mount
  // (unless we were handed a specific dealCardId) and refreshed after any write.
  const [cards, setCards] = useState<DealCardListItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  // Create/edit state. mode 'view' renders the list + read-only panels; 'create'
  // and 'edit' render the deal-level form. saving/saveError gate the Save button.
  const [mode, setMode] = useState<'view' | 'create' | 'edit'>('view');
  const [form, setForm] = useState<DealForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // DD/Research worksheet state. Loaded alongside the open deal; edited inline
  // via a separate sub-form (independent of the deal-level create/edit form).
  const [dd, setDd] = useState<DdView | null>(null);
  const [ddEditing, setDdEditing] = useState(false);
  const [ddForm, setDdForm] = useState<DdForm | null>(null);
  const [ddSaving, setDdSaving] = useState(false);
  const [ddError, setDdError] = useState<string | null>(null);
  const [ddWarnings, setDdWarnings] = useState<string[]>([]);

  // Strategy worksheet state. Loaded alongside the open deal; edited inline via a
  // separate sub-form (independent of the deal-level and DD forms).
  const [strategy, setStrategy] = useState<StrategyView | null>(null);
  const [strategyEditing, setStrategyEditing] = useState(false);
  const [strategyForm, setStrategyForm] = useState<StrategyForm | null>(null);
  const [strategySaving, setStrategySaving] = useState(false);
  const [strategyError, setStrategyError] = useState<string | null>(null);
  const [strategyWarnings, setStrategyWarnings] = useState<string[]>([]);

  // Market Research worksheet state. Loaded alongside the open deal; edited inline
  // via a separate sub-form (independent of the deal-level, DD, and Strategy forms).
  const [market, setMarket] = useState<MarketView | null>(null);
  const [marketEditing, setMarketEditing] = useState(false);
  const [marketForm, setMarketForm] = useState<MarketForm | null>(null);
  const [marketSaving, setMarketSaving] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [marketWarnings, setMarketWarnings] = useState<string[]>([]);

  // DD + Market + Strategy operational report state. Loaded alongside the open
  // deal; produced by the backend workflow (read-only here).
  const [report, setReport] = useState<ReportView | null>(null);
  // First architecture-recovery slice: an immutable, versioned summary read
  // model. Loading it never starts research or rebuilds legacy projections.
  const [propertySummary, setPropertySummary] = useState<PropertySummaryReadModelView | null>(null);
  const [propertySummaryLoading, setPropertySummaryLoading] = useState(false);
  const [propertySummaryRebuilding, setPropertySummaryRebuilding] = useState(false);
  const [propertySummaryError, setPropertySummaryError] = useState<string | null>(null);
  const [execSummary, setExecSummary] = useState<ExecSummaryView | null>(null);
  const [discoveryReport, setDiscoveryReport] = useState<DiscoveryReportView | null>(null);
  const [propertyType, setPropertyType] = useState<PropertyTypeView | null>(null);
  // Pursuit decision + Executive Orchestrator review — computed server-side from
  // the same reconciled objects every tab reads.
  const [pursuit, setPursuit] = useState<PursuitView | null>(null);
  // Multi-parcel roster — one honest state per APN (never conflated).
  const [parcelRoster, setParcelRoster] = useState<ParcelRosterEntryView[] | null>(null);
  // Reconciled operator record — the ONE decision surface the CRM header,
  // verdict rail, work board, and seller questions render from.
  const [operatorRecord, setOperatorRecord] = useState<OperatorRecordView | null>(null);
  const [ownerAnalysis, setOwnerAnalysis] = useState<OwnerAnalysisView | null>(null);
  const [researchProgress, setResearchProgress] = useState<DealResearchProgress | null>(null);
  const [researchRetrying, setResearchRetrying] = useState(false);
  const [researchActionError, setResearchActionError] = useState('');
  // Recorded-document research rows (deed & easement evidence) for Documents.
  const [recordedEvidence, setRecordedEvidence] = useState<Array<{ fact: string; sourceUrl: string; sourceType: string; dateAccessed: string; note: string }>>([]);
  // Canonical shared records — every tab renders these; no tab re-derives them.
  const [documentRegistry, setDocumentRegistry] = useState<DocumentRegistryView | null>(null);
  const [reportRunning, setReportRunning] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportWarnings, setReportWarnings] = useState<string[]>([]);
  // Visual Property Context capture state (explicit per-property Google capture).
  const [visualCapturing, setVisualCapturing] = useState(false);
  // Reconciled public-screening actions outrank a legacy workflow hint.
  const prioritizedHeaderAction = execSummary?.nextSteps?.[0] ?? spine?.header?.nextBestAction ?? null;
  const [visualCaptureMsg, setVisualCaptureMsg] = useState<string | null>(null);

  async function loadMarket(id: number) {
    try {
      const res = await apiGet<{ market: MarketView }>(`/api/landos/deal-cards/${id}/market`);
      setMarket(res.market);
    } catch {
      setMarket(null);
    }
  }

  async function loadReport(id: number) {
    try {
      const res = await apiGet<{ report: ReportView; executiveSummary?: ExecSummaryView; discoveryReport?: DiscoveryReportView; propertyType?: PropertyTypeView; pursuit?: PursuitView; parcelRoster?: ParcelRosterEntryView[]; operatorRecord?: OperatorRecordView; ownerAnalysis?: OwnerAnalysisView }>(`/api/landos/deal-cards/${id}/report`);
      setReport(res.report);
      setOperatorRecord(res.operatorRecord ?? null);
      setOwnerAnalysis(res.ownerAnalysis ?? null);
      setRecordedEvidence(((res as unknown as { recordedEvidence?: Array<{ fact: string; sourceUrl: string; sourceType: string; dateAccessed: string; note: string }> }).recordedEvidence) ?? []);
      {
        const extra = res as unknown as { documentRegistry?: DocumentRegistryView };
        setDocumentRegistry(extra.documentRegistry ?? null);
      }
      setExecSummary(res.executiveSummary ?? null);
      setDiscoveryReport(res.discoveryReport ?? null);
      setPropertyType(res.propertyType ?? null);
      setPursuit(res.pursuit ?? null);
      setParcelRoster(res.parcelRoster ?? null);
    } catch {
      setReport(null);
      setExecSummary(null);
      setDiscoveryReport(null);
      setPropertyType(null);
      setPursuit(null);
      setOperatorRecord(null);
      setOwnerAnalysis(null);
    }
  }

  // Run the operational report. After it completes, re-load the report AND the
  // three worksheets (the workflow updates them) so the panel shows exactly what
  // persisted. Never spends a comp credit; the backend enforces that.
  async function runReport() {
    if (!deal) return;
    setReportRunning(true);
    setReportError(null);
    setReportWarnings([]);
    try {
      const res = await apiPost<{ report: ReportView; warnings: string[]; executiveSummary?: ExecSummaryView; ownerAnalysis?: OwnerAnalysisView; discoveryReport?: DiscoveryReportView; propertyType?: PropertyTypeView; pursuit?: PursuitView; parcelRoster?: ParcelRosterEntryView[] }>(`/api/landos/deal-cards/${deal.id}/report/run`, {});
      setReport(res.report);
      setExecSummary(res.executiveSummary ?? null);
      setOwnerAnalysis(res.ownerAnalysis ?? null);
      setDiscoveryReport(res.discoveryReport ?? null);
      setPropertyType(res.propertyType ?? null);
      setPursuit(res.pursuit ?? null);
      setParcelRoster(res.parcelRoster ?? null);
      setReportWarnings(Array.isArray(res.warnings) ? res.warnings : []);
      await loadDd(deal.id);
      await loadStrategy(deal.id);
      await loadMarket(deal.id);
      // The run response has no operator record; the GET projection builds it.
      await Promise.all([loadReport(deal.id), loadPropertySummary(deal.id)]);
    } catch (err: any) {
      setReportError(err?.message || String(err));
    } finally {
      setReportRunning(false);
    }
  }

  // Explicit per-property visual capture (one Google call). After capture, reload
  // the report so the freshly-stored images render inline.
  async function captureVisuals(cardId: number) {
    setVisualCapturing(true);
    setVisualCaptureMsg(null);
    try {
      const res = await apiPost<{ ok: boolean; reason: string; captured: string[] }>(`/api/landos/property-cards/${cardId}/visual-capture`, {});
      const labels: Record<string, string> = { maps_static: 'satellite context', street_view_static: 'Street View' };
      setVisualCaptureMsg(res.ok ? `Captured: ${res.captured.map((item) => labels[item] ?? item).join(', ') || 'none'}.` : `Capture failed: ${res.reason}`);
      if (deal) await loadReport(deal.id);
    } catch (err: any) {
      setVisualCaptureMsg(err?.message || String(err));
    } finally {
      setVisualCapturing(false);
    }
  }

  async function loadDd(id: number) {
    try {
      const res = await apiGet<{ dd: DdView }>(`/api/landos/deal-cards/${id}/dd`);
      setDd(res.dd);
    } catch {
      setDd(null);
    }
  }

  async function loadStrategy(id: number) {
    try {
      const res = await apiGet<{ strategy: StrategyView }>(`/api/landos/deal-cards/${id}/strategy`);
      setStrategy(res.strategy);
    } catch {
      setStrategy(null);
    }
  }

  async function load(id: number, resetTab = true) {
    try {
      setLoading(true);
      setError(null);
      if (resetTab) setActiveTab('overview');
      setDdEditing(false);
      setDdWarnings([]);
      setStrategyEditing(false);
      setStrategyWarnings([]);
      setMarketEditing(false);
      setMarketWarnings([]);
      setReportError(null);
      setReportWarnings([]);
      setPropertySummary(null);
      setPropertySummaryError(null);
      const res = await apiGet<{ dealCard: DealCardDetail; businessSpine?: BusinessSpineView | null; opportunity?: DealResearchOpportunity | null; researchMission?: DealResearchMission | null }>(`/api/landos/deal-cards/${id}`);
      setDeal(res.dealCard);
      setSpine(res.businessSpine ?? null);
      setResearchProgress(res.opportunity ? { opportunity: res.opportunity, mission: res.researchMission ?? null } : null);
      // Always hydrate persisted report/worksheet state. Unconfirmed parcels may
      // have an honestly gated report plus retained provider/orchestration context;
      // refresh/restart must not erase that owner-visible work. The backend and
      // shared readiness record keep valuation and downstream actions blocked.
      const rres = await apiGet<ResolutionData>(`/api/landos/deal-cards/${id}/resolution`);
      setResolution(rres);
      await Promise.all([loadDd(id), loadStrategy(id), loadMarket(id), loadReport(id), loadPropertySummary(id)]);
    } catch (err: any) {
      setError(err?.message || String(err));
      setDeal(null);
      setSpine(null);
      setResolution(null);
      setDd(null);
      setStrategy(null);
      setMarket(null);
      setReport(null);
      setPropertySummary(null);
      setResearchProgress(null);
    } finally {
      setLoading(false);
    }
  }

  async function retryResearch() {
    const opportunityId = researchProgress?.opportunity.id;
    if (!opportunityId || researchRetrying) return;
    setResearchRetrying(true); setResearchActionError('');
    try {
      const result = await apiPost<{ opportunity: DealResearchOpportunity; mission: DealResearchMission }>(`/api/landos/opportunities/${opportunityId}/research`, {});
      setResearchProgress({ opportunity: result.opportunity, mission: result.mission });
    } catch (error) {
      setResearchActionError((error as Error).message || 'Research could not be started.');
    } finally {
      setResearchRetrying(false);
    }
  }

  async function loadPropertySummary(id: number) {
    setPropertySummaryLoading(true);
    try {
      const res = await apiGet<{ propertySummary: PropertySummaryReadModelView | null }>(
        `/api/landos/deal-cards/${id}/property-summary`,
      );
      setPropertySummary(res.propertySummary);
      setPropertySummaryError(null);
    } catch (error) {
      setPropertySummary(null);
      setPropertySummaryError((error as Error)?.message ?? 'The saved Property Summary could not be loaded.');
    } finally {
      setPropertySummaryLoading(false);
    }
  }

  async function rebuildPropertySummary() {
    if (!deal || propertySummaryRebuilding) return;
    setPropertySummaryRebuilding(true);
    setPropertySummaryError(null);
    try {
      const res = await apiPost<{ propertySummary: PropertySummaryReadModelView }>(
        `/api/landos/deal-cards/${deal.id}/property-summary/rebuild`,
        {},
      );
      setPropertySummary(res.propertySummary);
      // The versioned identity can move the card into or out of Resolution, so
      // refresh the stored resolution view after the explicit command.
      const resolutionResult = await apiGet<ResolutionData>(`/api/landos/deal-cards/${deal.id}/resolution`);
      setResolution(resolutionResult);
    } catch (error) {
      setPropertySummaryError((error as Error)?.message ?? 'The Property Summary could not be rebuilt.');
    } finally {
      setPropertySummaryRebuilding(false);
    }
  }

  function startDdEdit() {
    const d = dd;
    setDdError(null);
    setDdWarnings([]);
    setDdForm({
      parcelIdentityStatus: d?.parcelIdentityStatus ?? 'local_area_context_not_verified',
      apn: d?.apn ?? '', apnLabel: d?.apnLabel ?? 'Unknown',
      county: d?.county ?? '', state: d?.state ?? '', locationLabel: d?.locationLabel ?? 'Unknown',
      acreage: d?.acreage != null ? String(d.acreage) : '', acreageLabel: d?.acreageLabel ?? 'Unknown',
      zoning: d?.zoning ?? '', zoningLabel: d?.zoningLabel ?? 'Unknown',
      accessStatus: d?.accessStatus ?? '', accessLabel: d?.accessLabel ?? 'Unknown',
      utilitiesStatus: d?.utilitiesStatus ?? '', utilitiesLabel: d?.utilitiesLabel ?? 'Unknown',
      floodStatus: d?.floodStatus ?? '', floodLabel: d?.floodLabel ?? 'Unknown',
      wetlandsStatus: d?.wetlandsStatus ?? '', wetlandsLabel: d?.wetlandsLabel ?? 'Unknown',
      roadFrontageNotes: d?.roadFrontageNotes ?? '',
      sourceLinksText: (d?.sourceLinks ?? []).map((l) => (l.label ? `${l.label} | ${l.url}` : l.url)).join('\n'),
      dataGapsText: (d?.dataGaps ?? []).join('\n'),
      riskFlagsText: (d?.riskFlags ?? []).join('\n'),
      notes: d?.notes ?? '',
    });
    setDdEditing(true);
  }

  function setDdField<K extends keyof DdForm>(key: K, value: DdForm[K]) {
    setDdForm((f) => (f ? { ...f, [key]: value } : f));
  }

  async function saveDd() {
    if (!deal || !ddForm) return;
    setDdSaving(true);
    setDdError(null);
    try {
      const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
      const sourceLinks = lines(ddForm.sourceLinksText).map((line) => {
        const i = line.indexOf('|');
        return i >= 0
          ? { label: line.slice(0, i).trim(), url: line.slice(i + 1).trim() }
          : { label: '', url: line };
      }).filter((l) => l.url);
      const payload = {
        parcelIdentityStatus: ddForm.parcelIdentityStatus,
        apn: ddForm.apn, apnLabel: ddForm.apnLabel,
        county: ddForm.county, state: ddForm.state, locationLabel: ddForm.locationLabel,
        acreage: ddForm.acreage.trim() === '' ? null : Number(ddForm.acreage),
        acreageLabel: ddForm.acreageLabel,
        zoning: ddForm.zoning, zoningLabel: ddForm.zoningLabel,
        accessStatus: ddForm.accessStatus, accessLabel: ddForm.accessLabel,
        utilitiesStatus: ddForm.utilitiesStatus, utilitiesLabel: ddForm.utilitiesLabel,
        floodStatus: ddForm.floodStatus, floodLabel: ddForm.floodLabel,
        wetlandsStatus: ddForm.wetlandsStatus, wetlandsLabel: ddForm.wetlandsLabel,
        roadFrontageNotes: ddForm.roadFrontageNotes,
        sourceLinks,
        dataGaps: lines(ddForm.dataGapsText),
        riskFlags: lines(ddForm.riskFlagsText),
        notes: ddForm.notes,
      };
      const res = await apiPut<{ dd: DdView; warnings: string[] }>(`/api/landos/deal-cards/${deal.id}/dd`, payload);
      // Re-load from the API so what we show is exactly what persisted.
      await loadDd(deal.id);
      setDdWarnings(Array.isArray(res.warnings) ? res.warnings : []);
      setDdEditing(false);
    } catch (err: any) {
      setDdError(err?.message || String(err));
    } finally {
      setDdSaving(false);
    }
  }

  function startStrategyEdit() {
    const s = strategy;
    setStrategyError(null);
    setStrategyWarnings([]);
    setStrategyForm({
      offerReadiness: s?.offerReadiness ?? 'not_reviewed',
      strategyCandidatesText: (s?.strategyCandidates ?? []).join('\n'),
      blockersText: (s?.blockers ?? []).join('\n'),
      nextConfirmationsText: (s?.nextConfirmations ?? []).join('\n'),
      currentRecommendation: s?.currentRecommendation ?? '',
      mostViableStrategy: s?.mostViableStrategy ?? '',
      preCallStrategyNotes: s?.preCallStrategyNotes ?? '',
      quickFlipNotes: s?.quickFlipNotes ?? '',
      subdivideNotes: s?.subdivideNotes ?? '',
      landHomePackageNotes: s?.landHomePackageNotes ?? '',
      improvedValueAddNotes: s?.improvedValueAddNotes ?? '',
      teardownLandOnlyNotes: s?.teardownLandOnlyNotes ?? '',
      passNoOfferReason: s?.passNoOfferReason ?? '',
      riskAdjustedNotes: s?.riskAdjustedNotes ?? '',
      targetProfitNote: s?.targetProfitNote ?? '',
      notes: s?.notes ?? '',
    });
    setStrategyEditing(true);
  }

  function setStrategyFieldFn<K extends keyof StrategyForm>(key: K, value: StrategyForm[K]) {
    setStrategyForm((f) => (f ? { ...f, [key]: value } : f));
  }

  async function saveStrategy() {
    if (!deal || !strategyForm) return;
    setStrategySaving(true);
    setStrategyError(null);
    try {
      const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
      const payload = {
        offerReadiness: strategyForm.offerReadiness,
        strategyCandidates: lines(strategyForm.strategyCandidatesText),
        blockers: lines(strategyForm.blockersText),
        nextConfirmations: lines(strategyForm.nextConfirmationsText),
        currentRecommendation: strategyForm.currentRecommendation,
        mostViableStrategy: strategyForm.mostViableStrategy,
        preCallStrategyNotes: strategyForm.preCallStrategyNotes,
        quickFlipNotes: strategyForm.quickFlipNotes,
        subdivideNotes: strategyForm.subdivideNotes,
        landHomePackageNotes: strategyForm.landHomePackageNotes,
        improvedValueAddNotes: strategyForm.improvedValueAddNotes,
        teardownLandOnlyNotes: strategyForm.teardownLandOnlyNotes,
        passNoOfferReason: strategyForm.passNoOfferReason,
        riskAdjustedNotes: strategyForm.riskAdjustedNotes,
        targetProfitNote: strategyForm.targetProfitNote,
        notes: strategyForm.notes,
      };
      const res = await apiPut<{ strategy: StrategyView; warnings: string[] }>(`/api/landos/deal-cards/${deal.id}/strategy`, payload);
      // Re-load from the API so what we show is exactly what persisted.
      await loadStrategy(deal.id);
      setStrategyWarnings(Array.isArray(res.warnings) ? res.warnings : []);
      setStrategyEditing(false);
    } catch (err: any) {
      setStrategyError(err?.message || String(err));
    } finally {
      setStrategySaving(false);
    }
  }

  function startMarketEdit() {
    const m = market;
    setMarketError(null);
    setMarketWarnings([]);
    setMarketForm({
      marketReviewStatus: m?.marketReviewStatus ?? 'not_reviewed',
      targetAreaLabel: m?.targetAreaLabel ?? '',
      countyCityRegionNotes: m?.countyCityRegionNotes ?? '',
      buyerDemandNotes: m?.buyerDemandNotes ?? '', buyerDemandLabel: m?.buyerDemandLabel ?? 'not_reviewed',
      activeListingNotes: m?.activeListingNotes ?? '',
      soldCompContextNotes: m?.soldCompContextNotes ?? '',
      daysOnMarketNotes: m?.daysOnMarketNotes ?? '',
      manufacturedHomeDemandNotes: m?.manufacturedHomeDemandNotes ?? '', manufacturedHomeDemandLabel: m?.manufacturedHomeDemandLabel ?? 'not_reviewed',
      subdivisionDemandNotes: m?.subdivisionDemandNotes ?? '', subdivisionDemandLabel: m?.subdivisionDemandLabel ?? 'not_reviewed',
      infillLotDemandNotes: m?.infillLotDemandNotes ?? '', infillLotDemandLabel: m?.infillLotDemandLabel ?? 'not_reviewed',
      ruralAcreageDemandNotes: m?.ruralAcreageDemandNotes ?? '', ruralAcreageDemandLabel: m?.ruralAcreageDemandLabel ?? 'not_reviewed',
      countyGrowthPlanningNotes: m?.countyGrowthPlanningNotes ?? '',
      exitStrategySupportNotes: m?.exitStrategySupportNotes ?? '',
      sourceLinksText: (m?.sourceLinks ?? []).map((l) => (l.label ? `${l.label} | ${l.url}` : l.url)).join('\n'),
      sourceConfidence: m?.sourceConfidence ?? 'unknown',
      dataGapsText: (m?.dataGaps ?? []).join('\n'),
      riskFlagsText: (m?.riskFlags ?? []).join('\n'),
      notes: m?.notes ?? '',
    });
    setMarketEditing(true);
  }

  function setMarketFieldFn<K extends keyof MarketForm>(key: K, value: MarketForm[K]) {
    setMarketForm((f) => (f ? { ...f, [key]: value } : f));
  }

  async function saveMarket() {
    if (!deal || !marketForm) return;
    setMarketSaving(true);
    setMarketError(null);
    try {
      const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
      const sourceLinks = lines(marketForm.sourceLinksText).map((line) => {
        const i = line.indexOf('|');
        return i >= 0
          ? { label: line.slice(0, i).trim(), url: line.slice(i + 1).trim() }
          : { label: '', url: line };
      }).filter((l) => l.url);
      const payload = {
        marketReviewStatus: marketForm.marketReviewStatus,
        targetAreaLabel: marketForm.targetAreaLabel,
        countyCityRegionNotes: marketForm.countyCityRegionNotes,
        buyerDemandNotes: marketForm.buyerDemandNotes, buyerDemandLabel: marketForm.buyerDemandLabel,
        activeListingNotes: marketForm.activeListingNotes,
        soldCompContextNotes: marketForm.soldCompContextNotes,
        daysOnMarketNotes: marketForm.daysOnMarketNotes,
        manufacturedHomeDemandNotes: marketForm.manufacturedHomeDemandNotes, manufacturedHomeDemandLabel: marketForm.manufacturedHomeDemandLabel,
        subdivisionDemandNotes: marketForm.subdivisionDemandNotes, subdivisionDemandLabel: marketForm.subdivisionDemandLabel,
        infillLotDemandNotes: marketForm.infillLotDemandNotes, infillLotDemandLabel: marketForm.infillLotDemandLabel,
        ruralAcreageDemandNotes: marketForm.ruralAcreageDemandNotes, ruralAcreageDemandLabel: marketForm.ruralAcreageDemandLabel,
        countyGrowthPlanningNotes: marketForm.countyGrowthPlanningNotes,
        exitStrategySupportNotes: marketForm.exitStrategySupportNotes,
        sourceLinks,
        sourceConfidence: marketForm.sourceConfidence,
        dataGaps: lines(marketForm.dataGapsText),
        riskFlags: lines(marketForm.riskFlagsText),
        notes: marketForm.notes,
      };
      const res = await apiPut<{ market: MarketView; warnings: string[] }>(`/api/landos/deal-cards/${deal.id}/market`, payload);
      // Re-load from the API so what we show is exactly what persisted.
      await loadMarket(deal.id);
      setMarketWarnings(Array.isArray(res.warnings) ? res.warnings : []);
      setMarketEditing(false);
    } catch (err: any) {
      setMarketError(err?.message || String(err));
    } finally {
      setMarketSaving(false);
    }
  }

  // Refresh the saved-cards list. Failures surface as a list error but never
  // block the detail/create flow, and never fabricate rows.
  async function refreshList() {
    try {
      setListError(null);
      const res = await apiGet<{ dealCards: DealCardListItem[] }>('/api/landos/deal-cards');
      setCards(Array.isArray(res.dealCards) ? res.dealCards : []);
    } catch (err: any) {
      setListError(err?.message || String(err));
      setCards([]);
    }
  }

  // ── Trash (soft delete) ──────────────────────────────────────────────────
  const [listView, setListView] = useState<'active' | 'trash'>('active');
  const [trash, setTrash] = useState<DealCardListItem[] | null>(null);
  const [trashBusy, setTrashBusy] = useState<number | null>(null);
  // The card id "armed" for permanent deletion — shows the second, irreversible
  // confirmation inline before the hard delete actually runs.
  const [confirmPurgeId, setConfirmPurgeId] = useState<number | null>(null);

  async function refreshTrash() {
    try {
      const res = await apiGet<{ dealCards: DealCardListItem[] }>('/api/landos/deal-cards/trash');
      setTrash(Array.isArray(res.dealCards) ? res.dealCards : []);
    } catch {
      setTrash([]);
    }
  }

  // Soft delete now lives in the shared TrashCardButton control, which every
  // Deal Card surface uses. Restore / purge below remain Trash-view specific.

  async function restoreCard(id: number) {
    setTrashBusy(id);
    try {
      await apiPost(`/api/landos/deal-cards/${id}/restore`, {});
      await refreshTrash();
      await refreshList();
    } catch (err: any) {
      setListError(err?.message || String(err));
    } finally {
      setTrashBusy(null);
    }
  }

  // Permanent delete — ONLY reached after the inline second confirmation below.
  async function purgeCard(id: number) {
    setTrashBusy(id);
    try {
      await apiDelete(`/api/landos/deal-cards/${id}/permanent`);
      setConfirmPurgeId(null);
      await refreshTrash();
    } catch (err: any) {
      setListError(err?.message || String(err));
    } finally {
      setTrashBusy(null);
    }
  }

  useEffect(() => {
    if (dealCardId) void load(dealCardId);
    else void refreshList();
  }, [dealCardId]);

  // A newly-created Lead Card opens immediately while its durable research
  // mission continues in the background. Keep the owner on the same card and
  // automatically replace the initial empty snapshot when evidence arrives.
  useEffect(() => {
    const opportunityId = researchProgress?.opportunity.id;
    const missionStatus = researchProgress?.mission?.status;
    if (!deal?.id || !opportunityId || !missionStatus || !ACTIVE_RESEARCH_STATUSES.has(missionStatus)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await apiGet<{ mission: DealResearchMission | null }>(`/api/landos/opportunities/${opportunityId}/research-mission`);
        if (cancelled || !result.mission) return;
        setResearchProgress((current) => current ? { ...current, mission: result.mission } : current);
        if (!ACTIVE_RESEARCH_STATUSES.has(result.mission.status)) await load(deal.id, false);
      } catch {
        // A transient poll failure must not discard the saved lead or interrupt
        // the research worker. The next interval retries from durable state.
      }
    };
    const timer = window.setInterval(() => { void poll(); }, 3_000);
    void poll();
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [deal?.id, researchProgress?.opportunity.id, researchProgress?.mission?.status]);

  // Load Trash lazily when the operator switches to the Trash view.
  useEffect(() => {
    if (listView === 'trash') { setConfirmPurgeId(null); void refreshTrash(); }
  }, [listView]);

  function setField<K extends keyof DealForm>(key: K, value: DealForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function startCreate() {
    setSaveError(null);
    setForm(EMPTY_FORM);
    setMode('create');
  }

  function startEdit() {
    if (!deal) return;
    setSaveError(null);
    setForm({
      entity: deal.entity === 'LAND_ALLY' ? 'LAND_ALLY' : 'TY_LAND_BIZ',
      title: deal.title ?? '',
      status: deal.status ?? 'new',
      sellerNotes: deal.seller_notes ?? '',
      askingPrice: deal.asking_price != null ? String(deal.asking_price) : '',
      combinedStrategy: deal.combined_strategy ?? '',
      packageNotes: deal.package_notes ?? '',
    });
    setMode('edit');
  }

  function cancelForm() {
    setSaveError(null);
    setMode('view');
  }

  // Return to the saved-cards list (deselect the open card). Refreshes the list
  // so any just-saved edits to title/stage are reflected in the row.
  function backToList() {
    setDeal(null);
    setError(null);
    setMode('view');
    void refreshList();
  }

  // Build a write payload. Entity is only set on create (immutable after). An
  // empty asking price is omitted, never sent as 0.
  function payloadFromForm(isCreate: boolean): Record<string, unknown> {
    const askingNum = form.askingPrice.trim() === '' ? undefined : Number(form.askingPrice);
    const p: Record<string, unknown> = {
      title: form.title,
      status: form.status,
      sellerNotes: form.sellerNotes,
      combinedStrategy: form.combinedStrategy,
      packageNotes: form.packageNotes,
    };
    if (isCreate) p.entity = form.entity;
    if (askingNum !== undefined && Number.isFinite(askingNum)) p.askingPrice = askingNum;
    return p;
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      if (mode === 'create') {
        const res = await apiPost<{ dealCard: DealCardDetail }>('/api/landos/deal-cards', payloadFromForm(true));
        // Re-load the same id from the API: proves the record persisted and is
        // recoverable, and keeps us on the one record (no duplicate creation).
        await load(res.dealCard.id);
        // Refresh the list so the new card is openable again later.
        await refreshList();
      } else if (mode === 'edit' && deal) {
        await apiPatch<{ dealCard: DealCardDetail }>(`/api/landos/deal-cards/${deal.id}`, payloadFromForm(false));
        await load(deal.id);
        await refreshList();
      }
      setMode('view');
    } catch (err: any) {
      setSaveError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  const prop = deal?.propertyCards?.[0];
  const seller = deal?.people?.find((p) => p.role === 'seller')
    ?? deal?.people?.find((p) => p.role === 'lead' || p.role === 'lead_contact');
  const headerHero = preferredLandPortalHero(report);
  const versionedParcelSpecificAllowed = propertySummary?.snapshot?.summary.parcelSpecificAllowed;
  const headerHeroSrc = versionedParcelSpecificAllowed === false
    ? null
    : headerHero
      ? appendDashboardToken(headerHero.url, dashboardToken)
      : deal ? `/api/landos/deal-cards/${deal.id}/overlay/aerial?token=${encodeURIComponent(dashboardToken)}` : null;
  // Show the dedicated Resolution view (not a half-populated Deal Card) whenever
  // the parcel is NOT confirmed and we captured a resolution snapshot for it.
  const rejectedMismatch = prop?.verification_status === 'rejected_mismatch';
  const archivedParcel = prop?.verification_status === 'archived';
  const terminalParcel = rejectedMismatch || archivedParcel;
  const versionedResolutionRequired = !!propertySummary && propertySummary.identity.status !== 'confirmed';
  const showResolution = terminalParcel
    || versionedResolutionRequired
    || (!!resolution && !resolution.confirmed && !!resolution.snapshot);

  return (
    <div data-testid="deal-card-root" class="flex-1 overflow-y-auto px-6 pt-4 pb-40 space-y-4 dealcard-readable">
      {/* Toolbar: back-to-list (when a card is open) + create a new Deal Card. */}
      <div class="flex flex-wrap items-center gap-2">
        {mode === 'view' && deal && !dealCardId && (
          <button
            type="button"
            onClick={backToList}
            class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)]"
          >
            ← Deal Library
          </button>
        )}
        {mode === 'view' && (
          <>
            <button
              type="button"
              onClick={startCreate}
              class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-elevated)]"
            >
              New Deal Card
            </button>
            {/* Active / Trash toggle — only on the list surface (no card open). */}
            {!dealCardId && !deal && (
              <div class="inline-flex rounded-md border border-[var(--color-border)] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setListView('active')}
                  class={`px-3 py-1.5 text-[12px] font-medium ${listView === 'active' ? 'bg-[var(--color-elevated)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-elevated)]'}`}
                >
                  Active
                </button>
                <button
                  type="button"
                  onClick={() => setListView('trash')}
                  class={`px-3 py-1.5 text-[12px] font-medium border-l border-[var(--color-border)] ${listView === 'trash' ? 'bg-[var(--color-elevated)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-elevated)]'}`}
                >
                  Trash{trash && trash.length > 0 ? ` (${trash.length})` : ''}
                </button>
              </div>
            )}
            {deal && (
              <button
                type="button"
                onClick={startEdit}
                class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)]"
              >
                Edit
              </button>
            )}
            {deal && !dealCardId && (
              <TrashCardButton
                dealCardId={deal.id}
                title={deal.title || `Deal #${deal.id}`}
                variant="labelled"
                onDeleted={() => { backToList(); void refreshTrash(); }}
                onError={setListError}
              />
            )}
          </>
        )}
      </div>

      {/* Create / edit form for the deal-level fields. */}
      {mode !== 'view' && (
        <DealForm
          mode={mode}
          form={form}
          setField={setField}
          onSave={() => void save()}
          onCancel={cancelForm}
          saving={saving}
          saveError={saveError}
        />
      )}

      {/* Deal Library — the saved-deal list + primary open flow. Shown in view mode
          when no specific card is open and we are not embedded against a single id.
          Clicking a row opens that property's actual Deal Card (Property Intelligence
          Report) in place. This list is NOT itself a Deal Card. */}
      {mode === 'view' && !dealCardId && !deal && listView === 'active' && (
        <Section title="Deal Library">
          {listError && <div class="text-[11px] text-[var(--color-status-failed)]">{listError}</div>}
          {cards === null && !listError && <div class="text-[12px] text-[var(--color-text-muted)]">Loading…</div>}
          {cards !== null && cards.length === 0 && (
            <div class="text-[12px] text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-lg p-4">
              No Deal Cards yet. Click <span class="text-[var(--color-accent)]">New Deal Card</span> to create your first one. It saves to the local LandOS store and will show up here.
            </div>
          )}
          {cards !== null && cards.length > 0 && (
            <div class="space-y-1.5">
              {cards.map((c) => (
                <div
                  key={c.id}
                  class={`flex items-center gap-2 rounded-md border pr-2 hover:bg-[var(--color-elevated)] ${
                    deal?.id === c.id ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => { if (onOpenDeal) onOpenDeal(c.id); else void load(c.id); }}
                    class="min-w-0 flex-1 text-left px-3 py-2"
                  >
                    <div class="flex items-center gap-2">
                      <span class="text-[12px] font-medium truncate">{c.title || `Deal #${c.id}`}</span>
                      <LeadTypeBadge leadType={c.lead_type} />
                      <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
                        {entityBadge(c.entity)}
                      </span>
                      <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
                        {c.status}
                      </span>
                      <DdChip s={c.reportSummary} />
                      <span class="ml-auto text-[10px] text-[var(--color-text-faint)]">#{c.id} · {formatRelativeTime(c.updated_at)}</span>
                    </div>
                  </button>
                  <TrashCardButton
                    dealCardId={c.id}
                    title={c.title || `Deal #${c.id}`}
                    onDeleted={() => { void refreshList(); void refreshTrash(); }}
                    onError={setListError}
                  />
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Trash / Deleted Deal Cards view. Soft-deleted cards are restorable, or can
          be permanently deleted after a second, irreversible confirmation. */}
      {mode === 'view' && !dealCardId && !deal && listView === 'trash' && (
        <Section title="Trash — Deleted Deal Cards">
          <div class="text-[11px] text-[var(--color-text-muted)] mb-2">
            Deleted Deal Cards are kept here until you restore them or permanently delete them. Nothing is auto-removed.
          </div>
          {trash === null && <div class="text-[12px] text-[var(--color-text-muted)]">Loading…</div>}
          {trash !== null && trash.length === 0 && (
            <div class="text-[12px] text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-lg p-4">
              Trash is empty. Deleting a Deal Card moves it here.
            </div>
          )}
          {trash !== null && trash.length > 0 && (
            <div class="space-y-1.5">
              {trash.map((c) => (
                <div key={c.id} class="rounded-md border border-[var(--color-border)] px-3 py-2">
                  <div class="flex items-center gap-2">
                    <span class="text-[12px] font-medium truncate">{c.title || `Deal #${c.id}`}</span>
                    <LeadTypeBadge leadType={c.lead_type} />
                    <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
                      {entityBadge(c.entity)}
                    </span>
                    <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
                      {c.status}
                    </span>
                    <span class="ml-auto text-[10px] text-[var(--color-text-faint)]">
                      #{c.id} · deleted {c.deleted_at ? formatRelativeTime(c.deleted_at) : ''}
                    </span>
                  </div>
                  <div class="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void restoreCard(c.id)}
                      disabled={trashBusy === c.id}
                      class="px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
                    >
                      {trashBusy === c.id && confirmPurgeId !== c.id ? 'Restoring…' : 'Restore'}
                    </button>
                    {confirmPurgeId !== c.id ? (
                      <button
                        type="button"
                        onClick={() => setConfirmPurgeId(c.id)}
                        disabled={trashBusy === c.id}
                        class="px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--color-status-failed)] text-[var(--color-status-failed)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
                      >
                        Delete Permanently
                      </button>
                    ) : (
                      <span class="inline-flex items-center gap-2 rounded-md border border-[var(--color-status-failed)] bg-[var(--color-elevated)] px-2 py-1">
                        <span class="text-[11px] text-[var(--color-status-failed)] font-medium">Permanently delete? This cannot be undone.</span>
                        <button
                          type="button"
                          onClick={() => void purgeCard(c.id)}
                          disabled={trashBusy === c.id}
                          class="px-2 py-0.5 rounded text-[11px] font-semibold bg-[var(--color-status-failed)] text-white hover:opacity-90 disabled:opacity-40"
                        >
                          {trashBusy === c.id ? 'Deleting…' : 'Delete forever'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmPurgeId(null)}
                          disabled={trashBusy === c.id}
                          class="px-2 py-0.5 rounded text-[11px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-card)] disabled:opacity-40"
                        >
                          Cancel
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {mode === 'view' && error && <PageState error={error} />}
      {mode === 'view' && loading && !deal && <PageState loading />}

      {mode === 'view' && deal && (
        <PropertySummarySnapshotPanel
          value={propertySummary}
          loading={propertySummaryLoading}
          rebuilding={propertySummaryRebuilding}
          error={propertySummaryError}
          onRebuild={() => void rebuildPropertySummary()}
        />
      )}

      {/* Resolution view — parcel not yet confirmed. Shown INSTEAD of the Deal Card
          so no property-specific intelligence renders before confirmation. */}
      {mode === 'view' && deal && showResolution && (
        <>
          <div class="sticky top-0 z-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-4">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-[14px] font-semibold">
                {prop?.active_input_address || deal.title || 'Untitled Deal'}
              </span>
              <LeadTypeBadge leadType={(deal as { lead_type?: string }).lead_type} />
              <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
                {entityBadge(deal.entity)}
              </span>
              <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-status-warn,var(--color-border))] text-[var(--color-text-muted)]">
                {rejectedMismatch ? 'Rejected mismatch' : archivedParcel ? 'Archived parcel' : 'Resolution pending'}
              </span>
            </div>
          </div>
          {terminalParcel ? (
            <Section title={rejectedMismatch ? 'Rejected parcel mismatch' : 'Archived parcel'}>
              <div class="rounded-lg border border-[var(--color-status-failed)] bg-[var(--color-card)] p-4 space-y-2">
                <div class="text-[13px] font-semibold text-[var(--color-status-failed)]">
                  This candidate is not the requested parcel.
                </div>
                <div class="text-[12px] leading-relaxed text-[var(--color-text-muted)]">
                  No property intelligence, facts, valuation, Land Score, strategy, report, or offer is shown from this rejected record. Rejected evidence remains historical only.
                </div>
              </div>
            </Section>
          ) : resolution?.snapshot ? (
            <ResolutionView snapshot={resolution.snapshot} identity={resolution.parcelIdentity}
              entity={entity} dealCardId={deal.id} onConfirmed={() => void load(deal.id)} />
          ) : (
            <Section title="Property resolution">
              <div class="rounded-lg border border-[var(--color-status-warn,var(--color-border))] bg-[var(--color-card)] p-4 space-y-2">
                <div class="text-[13px] font-semibold">Exact parcel identity is required</div>
                <div class="text-[12px] leading-relaxed text-[var(--color-text-muted)]">
                  The versioned Property Summary has withheld parcel-specific imagery, ranked comparables, value, and strategy until the identity conflict is resolved.
                </div>
              </div>
            </Section>
          )}
        </>
      )}

      {mode === 'view' && deal && !showResolution && (
        <>
          {/* PINNED HEADER — always visible: identity, the critical-facts chips,
              the single critical next action, and the tab bar. The deal is legible
              in seconds and the next action never scrolls away. */}
          {operatorRecord && (
            /* CRM property header — reconciled identity, readiness, hero evidence.
               Scrolls with content; only the tab bar pins. */
            <>
              <OperatorCrmHeader
                record={operatorRecord}
                stage={deal.status}
                sellerLead={seller?.name ?? null}
                heroSrc={headerHeroSrc}
                heroHref={headerHeroSrc}
                badges={
                  <>
                    <LeadTypeBadge leadType={(deal as { lead_type?: string }).lead_type} />
                    <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
                      {entityBadge(deal.entity)}
                    </span>
                  </>
                }
              />
            </>
          )}
          <div class="sticky top-0 z-10 -mx-6 px-6 pt-1 bg-[var(--color-bg)] border-b border-[var(--color-border)] space-y-2">
            {!operatorRecord && (
              <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-3 space-y-2">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-[15px] font-semibold">
                    {prop?.active_input_address || deal.title || 'Untitled Deal'}
                  </span>
                  <LeadTypeBadge leadType={(deal as { lead_type?: string }).lead_type} />
                  <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
                    {entityBadge(deal.entity)}
                  </span>
                  <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
                    Stage: {deal.status}
                  </span>
                </div>
                {/* Full property identity — seller, address, city, county, state, acreage,
                    APN / parcel ID, deal status — the report header line. */}
                <DealIdentityGrid report={report} deal={deal} prop={prop} seller={seller} />
                {/* Critical facts at a glance (full detail in Overview → Source-labeled facts). */}
                <CriticalFactChips facts={spine?.header?.criticalFacts} />
                {/* The single critical next action — always in view. */}
                {prioritizedHeaderAction && (
                  <div class="text-[12px]">
                    <span class="text-[var(--color-accent)] font-semibold">Next action:</span>{' '}
                    <span class="text-[var(--color-text)]">{prioritizedHeaderAction}</span>
                    {prioritizedHeaderAction === spine?.header?.nextBestAction && spine.header.nextActionOwner && (
                      <span class="text-[var(--color-text-faint)]"> — owner: {ownerDeptLabel(spine.header.nextActionOwner)}</span>
                    )}
                  </div>
                )}
              </div>
            )}
            <div class="flex flex-wrap items-center gap-2">
              <div class="min-w-0 flex-1"><DealTabBar active={activeTab} onSelect={setActiveTab} /></div>
              <button
                type="button"
                data-testid="open-smart-intake"
                class="shrink-0 rounded-md border border-[var(--color-accent)] bg-[var(--color-card)] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-accent)] shadow-sm"
                onClick={() => {
                  const panel = document.getElementById('deal-card-smart-intake');
                  panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  window.setTimeout(() => (panel?.querySelector('[aria-label="New Deal Card information"]') as HTMLTextAreaElement | null)?.focus(), 250);
                }}
              >+ Smart Intake</button>
            </div>
          </div>

          {researchProgress && (
            <DealResearchProgressPanel progress={researchProgress} retrying={researchRetrying} actionError={researchActionError} onRetry={() => void retryResearch()} />
          )}

          {/* One general living-record intake for notes, transcripts, contacts,
              public records, documents and screenshots. The original is retained
              and conclusions are routed to their owner-facing sections. */}
          <SmartIntakePanel dealId={deal.id} token={dashboardToken} onChanged={() => void load(deal.id)} />

          {/* ══ OVERVIEW TAB ══ The Property Intelligence Report read: hero,
              executive summary, key facts, what-the-facts-mean, risks/unknowns,
              market + strategy + seller snapshots, source-labeled facts. The one
              complete understanding of the opportunity. */}
          {activeTab === 'overview' && (
            <OverviewTab
              report={report}
              es={execSummary}
              dcr={discoveryReport}
              spine={spine}
              deal={deal}
              prop={prop}
              seller={seller}
              token={dashboardToken}
              runReport={() => void runReport()}
              reportRunning={reportRunning}
              pursuit={pursuit}
              onPublicIntelligenceUpdated={() => void Promise.all([loadReport(deal.id), loadPropertySummary(deal.id)])}
              record={operatorRecord}
            />
          )}

          {/* ══ DUE DILIGENCE TAB ══ The full screening detail: every public
              provider finding with evidence links, plus what remains unknown. */}
          {activeTab === 'diligence' && (
            <div class="space-y-3">
              {operatorRecord && <RisksUnknownsPanel record={operatorRecord} />}
              <PublicRecordsPanel dealId={deal.id} />
              <PublicPropertyIntelligencePanel dealId={deal.id} ownerName={seller?.name ?? prop?.owner} onUpdated={() => void Promise.all([loadReport(deal.id), loadPropertySummary(deal.id)])} />
            </div>
          )}

          {activeTab === 'resources' && (
            <ResourcesContactsPanel dealId={deal.id} people={deal.people ?? []} />
          )}

          {/* ══ VISUALS TAB ══ Every parcel-tied evidence image: official overlay
              maps (exact boundary) + captured live visuals (Street View, 3D,
              LandPortal). */}
          {activeTab === 'visuals' && (
            <div class="space-y-4">
              <RetainedLandPortalPanel inspection={report?.landportalInspection} token={dashboardToken} ownerName={seller?.name ?? prop?.owner} />
              {!report?.landportalInspection && <Placeholder text="No retained parcel visuals are available yet." />}
              {prop?.id && (
                <div class="space-y-2">
                  <div class="flex items-center justify-between gap-3">
                    <div class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Google satellite & Street View</div>
                    <button
                      type="button"
                      data-testid="capture-google-visuals"
                      disabled={visualCapturing}
                      onClick={() => captureVisuals(prop.id)}
                      class="px-2.5 py-1.5 rounded-md text-[11px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
                    >
                      {visualCapturing ? 'Capturing…' : 'Capture / refresh Street View'}
                    </button>
                  </div>
                  {report?.visualContext ? <VisualContextSection ctx={report.visualContext} token={dashboardToken} /> : <Placeholder text="Capture Google imagery to add verified-coordinate satellite and nearest-road Street View context." />}
                  {visualCaptureMsg && <div class="text-[11px] text-[var(--color-text-muted)]">{visualCaptureMsg}</div>}
                  <VisualIntelligencePanel cardId={prop.id} token={dashboardToken} />
                </div>
              )}
            </div>
          )}

          {/* ══ MARKET TAB ══ One question: should I want land here? Market Pulse
              and the growth/Data-Center scan run automatically — no buttons. */}
          {activeTab === 'market' && (
            <div class="space-y-3">
              <div class="text-[14px] font-bold text-[var(--color-text)] px-1">Should I want land here?</div>
              <MarketResearchStrip analysis={ownerAnalysis} />
              <CompMap dealCardId={deal.id} />
              <LandPortalComparableTable inspection={report?.landportalInspection} />
              <SoldCompValuationPanel analysis={ownerAnalysis} />
            </div>
          )}

          {/* ══ PROPERTY TAB ══ The canonical parcel facts page. Multi-parcel
              leads render Parcel A / Parcel B separately from the backend
              parcel roster — each with its OWN honest state and card-scoped
              imagery. Imagery is never reused across parcels, and an unresolved
              parcel shows its next resolution action, never a stand-in image. */}
          {activeTab === 'property' && (parcelRoster?.length ?? 0) > 1 && (
            <div class="space-y-3">
              <div class="text-[12.5px] font-semibold text-[var(--color-text)] px-1">
                This lead covers {parcelRoster!.length} parcels — each shown separately; imagery is never reused across parcels.
              </div>
              {parcelRoster!.map((entry) => (
                <ParcelRosterBlock key={entry.apn} entry={entry} cards={deal.propertyCards ?? []} token={dashboardToken} />
              ))}
            </div>
          )}

          {/* Property Intelligence run controls + status — Documents tab.
              Preserves the Run / Re-run / Download Property Intelligence actions. */}

          {/* Visuals before any report/capture — honest placeholder, not a blank tab. */}
          {/* Report-derived sections, routed to their tabs (unchanged data/props). */}
          {report?.exists && (
              <div class="space-y-3">
                {/* PROPERTY TAB — VISUALS: large satellite + parcel marker/boundary +
                    Street View + Maps/Earth + source/date, and the Capture action. */}
                {/* PROPERTY TAB — parcel details, reconciled facts, at-a-glance, land score. */}
                {activeTab === 'property' && (
                <>
                {prop && <PropertyIdentityControl report={report} prop={prop} onSaved={() => load(deal.id)} />}
                {/* RECONCILED PARCEL FACTS — one authoritative value per field, with
                    source confidence; disagreements shown, never dropped. (The
                    duplicate property header was removed — the CRM header above
                    is the one identity block.) */}
                {report.reconciliation && <ReconciledFactsPanel rec={report.reconciliation} />}
                <KeyFactsGrid report={report} />
                {/* OFFICIAL RECORDS — labeled assessor/recorder fields, deed
                    description separate, nominal transfers flagged. */}
                {operatorRecord && <OfficialRecordsPanel record={operatorRecord} documents={documentRegistry} />}
                {/* AT-A-GLANCE LAND FACTS — flood/wetlands/slope/type. */}
                <AtAGlanceStrip report={report} propertyType={propertyType} />
                <PropertyGradesPanel analysis={ownerAnalysis} />
                {/* LAND SCORE — screening rubric from current accepted evidence; a
                    screening profile, never a pursue/pass verdict. */}
                {operatorRecord
                  ? <ReconciledLandScorePanel ls={operatorRecord.landScore} />
                  : <LandScoreSection ls={report.landScore} parcelVerified={report.parcelVerified} />}
                </>
                )}

                {/* STRATEGY TAB — one question: what is the highest and best exit,
                    and should I pursue it? No duplicated parcel facts, imagery, or
                    valuation panels — Strategy consumes the same reconciled objects. */}
                {activeTab === 'strategy' && (
                <>
                <PursuitPanel pursuit={pursuit} />
                {/* Same reconciled comp state Market/Activity show — never a
                    contradictory "comps missing" here. */}
                {report?.compState && (
                  <div class="rounded-lg border border-[var(--color-border)] p-3">
                    <div class="text-[12px] font-semibold text-[var(--color-text)] mb-1">Comp basis for strategy</div>
                    <div class="text-[11px] text-[var(--color-text-muted)]">{report.compState.strategyLine}</div>
                  </div>
                )}
                <OwnerStrategiesPanel analysis={ownerAnalysis} />
                </>
                )}

                {/* SELLER TAB — readiness + guardrails from the SAME shared gates
                    Strategy/Market read. The legacy call brief (stale pricing,
                    formulas, maybe-verdicts, provider diagnostics) is gone. */}
                {activeTab === 'seller' && (
                <SellerSnapshot deal={deal} seller={seller} es={execSummary} />
                )}

                {/* MARKET TAB — market pulse gated by validated closed-sale counts
                    (no one-point medians/bands/sell-through) + raw rows collapsed. */}
                {activeTab === 'market' && (
                <>
                <LandPortalCompMapEvidence inspection={report.landportalInspection} token={dashboardToken} />
                {/* Embedded LandOS comp map + sortable table — the FINAL deduplicated
                    registry (subject + selected top-5 + classified candidates), never
                    raw provider duplicates. Raw LandPortal map screenshots remain
                    separate provider evidence in the visual gallery. */}
                </>
                )}

                {/* PROPERTY TAB — LandPortal HD imagery / terrain shots + observations. */}
                {/* PROPERTY TAB — source-labeled facts + full business intelligence
                    (moved off Overview; the memo stays clean, the depth stays here). */}
                {activeTab === 'property' && (
                <>
                <Collapsible title="Source-labeled property facts">
                  <DdFactChecklist rows={report.ddFactChecklist} />
                </Collapsible>
                </>
                )}

                {/* Legacy "Detailed Due Diligence & Research" dump removed — the
                    Due Diligence tab + business-status panel own that read. */}
              </div>
          )}

          {/* ── WORKSHEETS + MANUAL SECTIONS — routed to the operator tabs.
              Seller / acquisitions / contacts / comms → Seller; the manual DD /
              Land Data + manual Land Score → Property; Deal Economics / Market
              Research → Market; Exit Strategy / Strategy / Pre-Call Brief →
              Strategy; documents/activity/quick actions → Documents. Same data,
              same handlers. */}
          {/* Seller / Acquisitions — seller profile + next action + call prep → Seller. */}
          {activeTab === 'seller' && operatorRecord && <SellerQuestionsPanel questions={operatorRecord.sellerQuestions} />}
          {activeTab === 'seller' && deal?.id && <AcquisitionsPanel dealId={deal.id} />}

          {/* Manual DD worksheet removed — canonical reconciled facts render above. */}

          {/* 5. Contacts — every person/role on the deal (inherited leads -> heirs) → Seller */}
          {activeTab === 'seller' && (
          <Section title="Contacts">
            {(() => {
              const ownerName = factOf(report, 'owner').value ?? report?.landportalInspection?.factSheet?.owner ?? prop?.owner ?? '';
              const samePerson = !!seller?.name && !!ownerName && seller.name.trim().toLowerCase() === String(ownerName).trim().toLowerCase();
              return samePerson ? (
                <div class="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-2.5 mb-3">
                  <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">Lead / contact and owner of record</div>
                  <div class="text-[12.5px] font-semibold text-[var(--color-text)] mt-0.5">{seller?.name}</div>
                  <div class="text-[10.5px] text-[var(--color-text-faint)] mt-1">One person record. Original official-record formatting remains available in Public Records and Activity.</div>
                </div>
              ) : (
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                  <div class="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-2.5"><div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">Owner of record</div><div class="text-[12.5px] font-semibold text-[var(--color-text)] mt-0.5">{ownerName || 'Not recorded'}</div></div>
                  <div class="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-2.5"><div class="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">Lead / contact</div><div class="text-[12.5px] font-semibold text-[var(--color-text)] mt-0.5">{seller?.name ?? 'Not recorded'}</div></div>
                </div>
              );
            })()}
            <AddDealContactControl dealId={deal.id} onSaved={() => load(deal.id)} />
            {(!deal.people || deal.people.length === 0) ? (
              <Placeholder text="No contacts captured yet" />
            ) : (
              <div class="space-y-2">
                {deal.people.map((p, i) => (
                  <div key={i} class="rounded-md border border-[var(--color-border)] p-2">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="text-[12px] font-medium text-[var(--color-text)]">{p.name || 'Unnamed'}</span>
                      {p.role && <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">{p.role}</span>}
                      {p.authority_status && <span class="text-[10px] text-[var(--color-text-faint)]">{p.authority_status}</span>}
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-x-4 mt-1">
                      <Field label="Phone" value={p.phone ?? undefined} />
                      <Field label="Email" value={p.email ?? undefined} />
                      <Field label="Mailing" value={p.mailing_address ?? undefined} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {seller?.name && (factOf(report, 'owner').value ?? report?.landportalInspection?.factSheet?.owner ?? prop?.owner) && seller.name.trim().toLowerCase() !== String(factOf(report, 'owner').value ?? report?.landportalInspection?.factSheet?.owner ?? prop?.owner).trim().toLowerCase() && (
              <div class="text-[11px] text-[var(--color-text-muted)] mt-2 border-t border-[var(--color-border)] pt-2">
                Lead/contact and owner-of-record names do not currently reconcile; confirm the relationship before contracting.
              </div>
            )}
          </Section>
          )}

          {/* Manual strategy worksheet removed — strategy truth lives in the
              shared strategy-readiness record above. */}

          {/* Manual market worksheet removed — market truth lives in the unique
              comp registry + cluster analysis above. */}

          {/* 8. Documents & quick actions → Documents (report controls above) */}
          {activeTab === 'documents' && (
          <Section title="Reports & Files">
            <div class="text-[11px] text-[var(--color-text-muted)] mb-1">Generated reports</div>
            {report?.exists ? (
              <div class="rounded-md border border-[var(--color-border)] p-2 space-y-1.5">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-[12px] text-[var(--color-text)]">Property Intelligence Report</span>
                  {report.generatedAt && <span class="text-[10px] text-[var(--color-text-faint)]">last run {formatRelativeTime(report.generatedAt)}{report.updatedBy ? ` · ${report.updatedBy}` : ''}</span>}
                </div>
                <div class="flex items-center gap-2 flex-wrap">
                  <a href={`/api/landos/deal-cards/${deal.id}/report/download?format=pdf&token=${encodeURIComponent(dashboardToken)}`} class="px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-elevated)]">Download PDF</a>
                  <a href={`/api/landos/deal-cards/${deal.id}/report/download?format=md&token=${encodeURIComponent(dashboardToken)}`} class="px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-elevated)]">Download Markdown</a>
                </div>
              </div>
            ) : (
              <Placeholder text="No report generated yet — run Property Intelligence (Overview or the report section above) to generate a downloadable report." />
            )}

            {/* Document registry — actual county-sourced pages, findings, and
                open document research; the deed viewer replaces path dumps. */}
            <div class="mt-3">
              <DocumentRegistryPanel registry={documentRegistry} dealId={deal.id} token={dashboardToken} />
            </div>

            {recordedEvidence.length > 0 && (documentRegistry?.documents.length ?? 0) === 0 && (
              <>
                <div class="text-[11px] text-[var(--color-text-muted)] mt-3 mb-1">Recorded document research (deed & easement)</div>
                <div class="space-y-1.5">
                  {recordedEvidence.map((row, i) => (
                    <div key={i} class="rounded-md border border-[var(--color-border)] p-2">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="text-[12px] font-medium text-[var(--color-text)]">{row.fact}</span>
                        {row.sourceUrl && <a href={row.sourceUrl} target="_blank" rel="noreferrer" class="text-[10.5px] text-[var(--color-accent)] underline">official record</a>}
                      </div>
                      {row.note && <div class="text-[11.5px] text-[var(--color-text-muted)] mt-0.5 leading-relaxed">{row.note}</div>}
                    </div>
                  ))}
                </div>
              </>
            )}

            <div class="text-[11px] text-[var(--color-text-muted)] mt-3 mb-1">Deal documents</div>
            <DocumentUploadPanel dealId={deal.id} token={dashboardToken} onUploaded={() => void loadReport(deal.id)} />
          </Section>
          )}

          {activeTab === 'documents' && (
          <Section title="Property Intelligence Report">
            <div class="flex items-center justify-end gap-2 mb-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => void runReport()}
                  disabled={reportRunning}
                  class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
                >
                  {reportRunning ? 'Running Property Intelligence...' : report?.exists ? 'Re-run Property Intelligence' : 'Run Property Intelligence'}
                </button>
                {report?.exists && (
                  <a
                    href={`/api/landos/deal-cards/${deal.id}/report/download?format=pdf&token=${encodeURIComponent(dashboardToken)}`}
                    class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-elevated)]"
                  >
                    Download Report
                  </a>
                )}
            </div>

            {reportError && <div class="text-[11px] text-[var(--color-status-failed)] mb-2">{reportError}</div>}
            {!report?.exists && (
              <div class="text-[12px] text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-lg p-3">
                No report run yet. Click <span class="text-[var(--color-accent)]">Run Property Intelligence</span> to run the safe browser/property due diligence workflow, capture visuals, include Market Pulse and Strategy, and update the Deal Card. It never spends a comp credit and never fabricates parcel facts, comps, demand, pricing, or offers.
              </div>
            )}

            {report?.generatedAt && <div class="text-[10px] text-[var(--color-text-faint)] mt-2">Last updated {formatRelativeTime(report.generatedAt)}.</div>}
          </Section>
          )}

          {activeTab === 'activity' && (
          <Section title="Activity">
            <div class="text-[11px] text-[var(--color-text-muted)] mb-1">Activity log</div>
            <ActivityTimeline dealId={deal.id} />
          </Section>
          )}

        </>
      )}
    </div>
  );
}

// ── Create/edit form for the deal-level fields ──────────────────────────────
// Generic deal-level inputs only. Entity is fixed once a card exists. Parcel
// identity, verification, comps, and any CRM/GHL push are NOT editable here.
function DealForm({
  mode, form, setField, onSave, onCancel, saving, saveError,
}: {
  mode: 'create' | 'edit';
  form: DealForm;
  setField: <K extends keyof DealForm>(key: K, value: DealForm[K]) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  saveError: string | null;
}) {
  const inputCls =
    'w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--color-accent)]';
  return (
    <section class="rounded-lg border border-[var(--color-accent)] bg-[var(--color-card)] p-4 space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">
          {mode === 'create' ? 'New Deal Card' : 'Edit Deal Card'}
        </h3>
        <span class="text-[10px] text-[var(--color-text-faint)]">Deal-level fields only · saved to local LandOS store</span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Entity</span>
          <select
            value={form.entity}
            disabled={mode === 'edit'}
            onChange={(e) => setField('entity', (e.target as HTMLSelectElement).value as DealForm['entity'])}
            class={`${inputCls} ${mode === 'edit' ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            <option value="TY_LAND_BIZ">My Business</option>
            <option value="LAND_ALLY">Land Ally</option>
          </select>
        </label>

        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Stage</span>
          <select
            value={form.status}
            onChange={(e) => setField('status', (e.target as HTMLSelectElement).value)}
            class={inputCls}
          >
            {DEAL_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <label class="block md:col-span-2">
          <span class="text-[11px] text-[var(--color-text-muted)]">Title / label</span>
          <input
            type="text"
            value={form.title}
            placeholder="e.g. Sample seller lead (generic)"
            onInput={(e) => setField('title', (e.target as HTMLInputElement).value)}
            class={inputCls}
          />
        </label>

        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Seller asking (negotiation context only)</span>
          <input
            type="number"
            value={form.askingPrice}
            placeholder="optional"
            onInput={(e) => setField('askingPrice', (e.target as HTMLInputElement).value)}
            class={inputCls}
          />
        </label>

        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Combined / exit strategy</span>
          <input
            type="text"
            value={form.combinedStrategy}
            placeholder="optional"
            onInput={(e) => setField('combinedStrategy', (e.target as HTMLInputElement).value)}
            class={inputCls}
          />
        </label>

        <label class="block md:col-span-2">
          <span class="text-[11px] text-[var(--color-text-muted)]">Seller notes</span>
          <textarea
            value={form.sellerNotes}
            rows={2}
            onInput={(e) => setField('sellerNotes', (e.target as HTMLTextAreaElement).value)}
            class={inputCls}
          />
        </label>

        <label class="block md:col-span-2">
          <span class="text-[11px] text-[var(--color-text-muted)]">Package notes</span>
          <textarea
            value={form.packageNotes}
            rows={2}
            onInput={(e) => setField('packageNotes', (e.target as HTMLTextAreaElement).value)}
            class={inputCls}
          />
        </label>
      </div>

      {saveError && <div class="text-[11px] text-[var(--color-status-failed)]">{saveError}</div>}

      <div class="flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
        >
          Cancel
        </button>
        <span class="text-[10px] text-[var(--color-text-faint)]">CRM / GHL push is not connected and stays approval-gated.</span>
      </div>
    </section>
  );
}

// ── DD/Research worksheet edit form ─────────────────────────────────────────
// Manual/local entry only. Every parcel fact picks a confidence label; the
// backend downgrades any 'Verified' field that has no source link. Parcel
// identity comes from exact-source records only, never imagery. No CRM/GHL.
function DdEditForm({
  form, setField, onSave, onCancel, saving, error,
}: {
  form: DdForm;
  setField: <K extends keyof DdForm>(key: K, value: DdForm[K]) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  const inputCls =
    'w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--color-accent)]';
  const labelCls =
    'bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-1.5 py-1.5 text-[11px] outline-none focus:border-[var(--color-accent)]';

  // A value input paired with its confidence-label picker.
  function FieldWithLabel({
    label, valueKey, labelKey, type = 'text', placeholder,
  }: {
    label: string;
    valueKey: keyof DdForm;
    labelKey: keyof DdForm;
    type?: string;
    placeholder?: string;
  }) {
    return (
      <label class="block">
        <span class="text-[11px] text-[var(--color-text-muted)]">{label}</span>
        <div class="flex gap-1.5">
          <input
            type={type}
            value={form[valueKey] as string}
            placeholder={placeholder}
            onInput={(e) => setField(valueKey, (e.target as HTMLInputElement).value as DdForm[typeof valueKey])}
            class={inputCls}
          />
          <select
            value={form[labelKey] as string}
            onChange={(e) => setField(labelKey, (e.target as HTMLSelectElement).value as DdForm[typeof labelKey])}
            class={labelCls}
            title="Confidence label"
          >
            {DD_FIELD_LABELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
      </label>
    );
  }

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-[11px] text-[var(--color-text-muted)]">Manual DD/Research entry · saved to local LandOS store</span>
      </div>

      <label class="block">
        <span class="text-[11px] text-[var(--color-text-muted)]">Parcel identity status</span>
        <select
          value={form.parcelIdentityStatus}
          onChange={(e) => setField('parcelIdentityStatus', (e.target as HTMLSelectElement).value)}
          class={inputCls}
        >
          {DD_IDENTITY_STATUSES.map((s) => <option key={s} value={s}>{identityStatusText(s)}</option>)}
        </select>
      </label>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FieldWithLabel label="APN / Parcel ID" valueKey="apn" labelKey="apnLabel" placeholder="e.g. 000-000-000" />
        <FieldWithLabel label="County / State" valueKey="county" labelKey="locationLabel" placeholder="county" />
        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">State</span>
          <input
            type="text"
            value={form.state}
            placeholder="ST"
            onInput={(e) => setField('state', (e.target as HTMLInputElement).value)}
            class={inputCls}
          />
        </label>
        <FieldWithLabel label="Acreage" valueKey="acreage" labelKey="acreageLabel" type="number" placeholder="optional" />
        <FieldWithLabel label="Zoning / land use" valueKey="zoning" labelKey="zoningLabel" placeholder="optional" />
        <FieldWithLabel label="Access" valueKey="accessStatus" labelKey="accessLabel" placeholder="e.g. road frontage / easement / unknown" />
        <FieldWithLabel label="Utilities" valueKey="utilitiesStatus" labelKey="utilitiesLabel" placeholder="e.g. power at road / none / unknown" />
        <FieldWithLabel label="Flood" valueKey="floodStatus" labelKey="floodLabel" placeholder="e.g. Zone X / partial / unknown" />
        <FieldWithLabel label="Wetlands" valueKey="wetlandsStatus" labelKey="wetlandsLabel" placeholder="e.g. none mapped / present / unknown" />
      </div>

      <label class="block">
        <span class="text-[11px] text-[var(--color-text-muted)]">Road / frontage notes</span>
        <textarea
          value={form.roadFrontageNotes}
          rows={2}
          onInput={(e) => setField('roadFrontageNotes', (e.target as HTMLTextAreaElement).value)}
          class={inputCls}
        />
      </label>

      <label class="block">
        <span class="text-[11px] text-[var(--color-text-muted)]">Source links (one per line · optional "label | url")</span>
        <textarea
          value={form.sourceLinksText}
          rows={2}
          placeholder={'County GIS | https://...\nAssessor | https://...'}
          onInput={(e) => setField('sourceLinksText', (e.target as HTMLTextAreaElement).value)}
          class={inputCls}
        />
        <span class="text-[10px] text-[var(--color-text-faint)]">A field can only stay "Verified" when at least one source link is present.</span>
      </label>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Data gaps (one per line)</span>
          <textarea
            value={form.dataGapsText}
            rows={3}
            onInput={(e) => setField('dataGapsText', (e.target as HTMLTextAreaElement).value)}
            class={inputCls}
          />
        </label>
        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Risk flags (one per line)</span>
          <textarea
            value={form.riskFlagsText}
            rows={3}
            onInput={(e) => setField('riskFlagsText', (e.target as HTMLTextAreaElement).value)}
            class={inputCls}
          />
        </label>
      </div>

      <label class="block">
        <span class="text-[11px] text-[var(--color-text-muted)]">Notes</span>
        <textarea
          value={form.notes}
          rows={2}
          onInput={(e) => setField('notes', (e.target as HTMLTextAreaElement).value)}
          class={inputCls}
        />
      </label>

      {error && <div class="text-[11px] text-[var(--color-status-failed)]">{error}</div>}

      <div class="flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save DD/Research'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Strategy worksheet edit form ────────────────────────────────────────────
// Manual/local strategy analysis only. Distinct exit strategies keep distinct
// note fields and are never collapsed into one generic offer range. Offer
// readiness is an honest status label, never an offer. No offer/comp/EV math and
// no CRM/GHL.
function StrategyEditForm({
  form, setField, onSave, onCancel, saving, error,
}: {
  form: StrategyForm;
  setField: <K extends keyof StrategyForm>(key: K, value: StrategyForm[K]) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  const inputCls =
    'w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--color-accent)]';

  // A labeled multi-line note field bound to one form key.
  function NoteField({ label, valueKey, placeholder, rows = 2 }: { label: string; valueKey: keyof StrategyForm; placeholder?: string; rows?: number }) {
    return (
      <label class="block">
        <span class="text-[11px] text-[var(--color-text-muted)]">{label}</span>
        <textarea
          value={form[valueKey] as string}
          rows={rows}
          placeholder={placeholder}
          onInput={(e) => setField(valueKey, (e.target as HTMLTextAreaElement).value as StrategyForm[typeof valueKey])}
          class={inputCls}
        />
      </label>
    );
  }

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-[11px] text-[var(--color-text-muted)]">Manual strategy entry · saved to local LandOS store</span>
      </div>

      <label class="block">
        <span class="text-[11px] text-[var(--color-text-muted)]">Offer readiness</span>
        <select
          value={form.offerReadiness}
          onChange={(e) => setField('offerReadiness', (e.target as HTMLSelectElement).value)}
          class={inputCls}
        >
          {STRATEGY_READINESS.map((s) => <option key={s} value={s}>{readinessText(s)}</option>)}
        </select>
        <span class="text-[10px] text-[var(--color-text-faint)]">Strategy is never auto-ready. This is an honest status, not an offer.</span>
      </label>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <NoteField label="Current recommendation" valueKey="currentRecommendation" placeholder="best current read; not a final offer" />
        <NoteField label="Most viable strategy" valueKey="mostViableStrategy" placeholder="single most viable exit" />
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <NoteField label="Strategy candidates (one per line)" valueKey="strategyCandidatesText" rows={3} placeholder={'Quick flip\nSubdivide'} />
        <NoteField label="Blockers (one per line)" valueKey="blockersText" rows={3} />
        <NoteField label="Next confirmations (one per line)" valueKey="nextConfirmationsText" rows={3} />
      </div>

      <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Distinct exit notes</div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <NoteField label="Quick flip notes" valueKey="quickFlipNotes" />
        <NoteField label="Subdivide notes" valueKey="subdivideNotes" />
        <NoteField label="Land-home package notes" valueKey="landHomePackageNotes" />
        <NoteField label="Improved-property / mobile-home value-add notes" valueKey="improvedValueAddNotes" />
        <NoteField label="Teardown / land-only fallback notes" valueKey="teardownLandOnlyNotes" />
        <NoteField label="Pass / no-offer reason" valueKey="passNoOfferReason" />
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <NoteField label="Pre-call strategy notes" valueKey="preCallStrategyNotes" />
        <NoteField label="Risk-adjusted notes" valueKey="riskAdjustedNotes" />
      </div>

      <NoteField label="Target profit note (free-text note, not a calculated offer)" valueKey="targetProfitNote" />
      <NoteField label="Notes" valueKey="notes" />

      {error && <div class="text-[11px] text-[var(--color-status-failed)]">{error}</div>}

      <div class="flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save Strategy'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Market Research worksheet edit form ─────────────────────────────────────
// Manual/local, market-level entry only. This is separate from property-level DD
// and never verifies parcel identity. No comps, actives, solds, days-on-market,
// demand, or pricing are computed or fabricated: demand is a manual label that
// the backend downgrades to needs_research without a supporting note. No CRM/GHL.
function MarketEditForm({
  form, setField, onSave, onCancel, saving, error,
}: {
  form: MarketForm;
  setField: <K extends keyof MarketForm>(key: K, value: MarketForm[K]) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  const inputCls =
    'w-full bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--color-accent)]';

  // A labeled multi-line note field bound to one form key.
  function NoteField({ label, valueKey, placeholder, rows = 2 }: { label: string; valueKey: keyof MarketForm; placeholder?: string; rows?: number }) {
    return (
      <label class="block">
        <span class="text-[11px] text-[var(--color-text-muted)]">{label}</span>
        <textarea
          value={form[valueKey] as string}
          rows={rows}
          placeholder={placeholder}
          onInput={(e) => setField(valueKey, (e.target as HTMLTextAreaElement).value as MarketForm[typeof valueKey])}
          class={inputCls}
        />
      </label>
    );
  }

  // A demand note paired with its honest demand-label picker. The backend
  // downgrades a concrete rating to Needs research when its note is empty.
  function DemandField({ label, noteKey, labelKey, placeholder }: { label: string; noteKey: keyof MarketForm; labelKey: keyof MarketForm; placeholder?: string }) {
    return (
      <label class="block">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[11px] text-[var(--color-text-muted)]">{label}</span>
          <select
            value={form[labelKey] as string}
            onChange={(e) => setField(labelKey, (e.target as HTMLSelectElement).value as MarketForm[typeof labelKey])}
            class="bg-[var(--color-elevated)] border border-[var(--color-border)] rounded px-1.5 py-1 text-[11px] outline-none focus:border-[var(--color-accent)]"
            title="Demand label"
          >
            {MARKET_DEMAND_LABELS.map((l) => <option key={l} value={l}>{demandText(l)}</option>)}
          </select>
        </div>
        <textarea
          value={form[noteKey] as string}
          rows={2}
          placeholder={placeholder}
          onInput={(e) => setField(noteKey, (e.target as HTMLTextAreaElement).value as MarketForm[typeof noteKey])}
          class={inputCls}
        />
      </label>
    );
  }

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-[11px] text-[var(--color-text-muted)]">Manual market-level entry · saved to local LandOS store</span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Market review status</span>
          <select
            value={form.marketReviewStatus}
            onChange={(e) => setField('marketReviewStatus', (e.target as HTMLSelectElement).value)}
            class={inputCls}
          >
            {MARKET_DEMAND_LABELS.map((l) => <option key={l} value={l}>{demandText(l)}</option>)}
          </select>
          <span class="text-[10px] text-[var(--color-text-faint)]">Market context only. Never a comp, price, or value.</span>
        </label>
        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Target market / area label</span>
          <input
            type="text"
            value={form.targetAreaLabel}
            placeholder="e.g. county / submarket label"
            onInput={(e) => setField('targetAreaLabel', (e.target as HTMLInputElement).value)}
            class={inputCls}
          />
        </label>
      </div>

      <NoteField label="County / city / region notes" valueKey="countyCityRegionNotes" />

      <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Demand (manual conclusions only)</div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <DemandField label="Local buyer demand" noteKey="buyerDemandNotes" labelKey="buyerDemandLabel" placeholder="what you actually know; blank stays Needs research" />
        <DemandField label="Manufactured-home demand" noteKey="manufacturedHomeDemandNotes" labelKey="manufacturedHomeDemandLabel" />
        <DemandField label="Subdivision demand" noteKey="subdivisionDemandNotes" labelKey="subdivisionDemandLabel" />
        <DemandField label="Infill-lot demand" noteKey="infillLotDemandNotes" labelKey="infillLotDemandLabel" />
        <DemandField label="Rural acreage demand" noteKey="ruralAcreageDemandNotes" labelKey="ruralAcreageDemandLabel" />
      </div>
      <span class="text-[10px] text-[var(--color-text-faint)]">A demand rating without a note for that lane is downgraded to Needs research. Conclusions are never fabricated.</span>

      <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Listing / sold context (notes only)</div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <NoteField label="Active listing notes" valueKey="activeListingNotes" rows={3} />
        <NoteField label="Sold comp context notes" valueKey="soldCompContextNotes" rows={3} />
        <NoteField label="Days-on-market notes" valueKey="daysOnMarketNotes" rows={3} />
      </div>
      <span class="text-[10px] text-[var(--color-text-faint)]">These are manual notes only. No comps, actives, solds, or days-on-market are computed.</span>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <NoteField label="County growth / planning notes" valueKey="countyGrowthPlanningNotes" />
        <NoteField label="Exit strategy support notes" valueKey="exitStrategySupportNotes" />
      </div>

      <label class="block">
        <span class="text-[11px] text-[var(--color-text-muted)]">Source confidence</span>
        <select
          value={form.sourceConfidence}
          onChange={(e) => setField('sourceConfidence', (e.target as HTMLSelectElement).value)}
          class={inputCls}
        >
          {MARKET_SOURCE_CONFIDENCE.map((l) => <option key={l} value={l}>{sourceConfidenceText(l)}</option>)}
        </select>
        <span class="text-[10px] text-[var(--color-text-faint)]">High confidence requires at least one source link, or it is downgraded to Needs research.</span>
      </label>

      <label class="block">
        <span class="text-[11px] text-[var(--color-text-muted)]">Source links (one per line · optional "label | url")</span>
        <textarea
          value={form.sourceLinksText}
          rows={2}
          placeholder={'County planning | https://...\nMarket report | https://...'}
          onInput={(e) => setField('sourceLinksText', (e.target as HTMLTextAreaElement).value)}
          class={inputCls}
        />
      </label>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Data gaps (one per line)</span>
          <textarea
            value={form.dataGapsText}
            rows={3}
            onInput={(e) => setField('dataGapsText', (e.target as HTMLTextAreaElement).value)}
            class={inputCls}
          />
        </label>
        <label class="block">
          <span class="text-[11px] text-[var(--color-text-muted)]">Risk flags (one per line)</span>
          <textarea
            value={form.riskFlagsText}
            rows={3}
            onInput={(e) => setField('riskFlagsText', (e.target as HTMLTextAreaElement).value)}
            class={inputCls}
          />
        </label>
      </div>

      <NoteField label="Notes" valueKey="notes" />

      {error && <div class="text-[11px] text-[var(--color-status-failed)]">{error}</div>}

      <div class="flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save Market Research'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
