import { useEffect, useState } from 'preact/hooks';
import { PageState } from '@/components/PageState';
import { ModelControl } from '@/components/ModelControl';
import { apiGet, apiPost, apiPatch, apiPut, dashboardToken } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';

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

const MIN_NET_BASELINE_USD = 10_000;

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
  /** Browser Intelligence evidence (LandPortal-first, then County gap-fill).
   *  Surfaced as a clean status block — never raw logs or workflow internals. */
  browserEvidence?: BrowserEvidenceView[];
  generatedAt: number | null;
  updatedBy: string;
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

      {/* Playbook + training readiness */}
      <div class="flex items-center gap-2 flex-wrap text-[10px]">
        <span class="px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-faint)]">Playbook: {v.playbook.status}</span>
        <span class="px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-faint)]">Training storage: {v.trainingReadiness.backend}{v.trainingReadiness.r2Configured ? ' (R2)' : ' (R2-ready)'} · ingestion: future</span>
      </div>
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
const usd = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`);
function ExecutiveSummarySection({ es }: { es?: ExecSummaryView | null }) {
  if (!es) return null;
  const ar = es.preliminaryAcquisitionRange; const mp = es.marketPulse;
  const tone = es.confidence === 'high' ? 'text-[var(--color-status-done)]' : es.confidence === 'low' ? 'text-[var(--color-text-faint)]' : 'text-[var(--color-accent)]';
  return (
    <div class="rounded-lg border border-[var(--color-accent)] bg-[var(--color-card)] p-4 space-y-3">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-accent)]">Executive Summary</span>
        <span class={`ml-auto text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-border)] ${tone}`}>confidence: {es.confidence}</span>
      </div>
      <div class="text-[13px] font-semibold text-[var(--color-text)]">{es.headline}</div>
      <div class="text-[12px] text-[var(--color-text-muted)]">{es.whatItIs}</div>
      <div class="text-[12px] text-[var(--color-text-muted)]">{es.whyInteresting}</div>

      {/* Preliminary acquisition range */}
      {ar.available ? (
        <div class="rounded-md border border-[var(--color-border)] p-2.5 space-y-1">
          <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Preliminary Acquisition Range <span class="normal-case text-[10px]">(pre-call only — not an offer)</span></div>
          <div class="text-[13px] font-semibold text-[var(--color-status-done)]">{usd(ar.acquisition40)} – {usd(ar.acquisition60)}</div>
          <div class="text-[11px] text-[var(--color-text-muted)]">Est. market value ~{usd(ar.estMidValue)} ({ar.acres} ac @ {usd(mp.pricePerAcre.median)}/ac) · 40–60% acquisition band · confidence {ar.confidence}</div>
          <div class="text-[10px] text-[var(--color-text-faint)]">↑ {ar.increaseValueIf.slice(0, 3).join(', ')}</div>
          <div class="text-[10px] text-[var(--color-text-faint)]">↓ {ar.decreaseValueIf.slice(0, 3).join(', ')}</div>
        </div>
      ) : (
        <div class="text-[11px] text-[var(--color-text-faint)] rounded-md border border-dashed border-[var(--color-border)] p-2">{ar.note}</div>
      )}

      {/* Deal economics snapshot */}
      {es.dealEconomics.available && (
        <div class="rounded-md border border-[var(--color-border)] p-2.5 text-[11px]">
          <div class="font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Deal Economics (preliminary)</div>
          <div class="text-[var(--color-text-muted)]">Est. value {usd(es.dealEconomics.estValueLow)} / {usd(es.dealEconomics.estValueMid)} / {usd(es.dealEconomics.estValueHigh)} (low/mid/high) · acquire {usd(es.dealEconomics.acquisitionRange?.[0])}–{usd(es.dealEconomics.acquisitionRange?.[1])} · gross spread {usd(es.dealEconomics.roughSpread?.[0])}–{usd(es.dealEconomics.roughSpread?.[1])} (pre-cost) · conf {es.dealEconomics.confidence}</div>
          <div class="text-[10px] text-[var(--color-text-faint)]">Missing costs: {es.dealEconomics.missingCostItems.join(', ')}. {es.dealEconomics.whyUnderwritingLater}</div>
        </div>
      )}

      {/* Strategy ranking (top lanes) — the first-glance strategy read. Market
          read + local growth live ONLY in Market Pulse (no duplication here).
          Seller-call questions live in Acquisitions, not the DD brief. */}
      <div class="text-[11px]">
        <div class="font-semibold text-[var(--color-text-faint)]">Strategy ranking</div>
        {es.strategyRanking.slice(0, 4).map((s, i) => (
          <div key={i} class="text-[var(--color-text-muted)]">{i + 1}. <span class="text-[var(--color-text)]">{s.strategy}</span> — {s.viability} · {s.reason}</div>
        ))}
      </div>

      <div>
        <div class="text-[11px] font-semibold text-[var(--color-text-faint)]">Strongest strategy</div>
        <div class="text-[11px] text-[var(--color-text-muted)]">{es.strongestStrategy.strategy} — {es.strongestStrategy.why}</div>
        <div class="text-[11px] font-semibold text-[var(--color-status-failed)] mt-1">Top risks / blockers</div>
        {es.topRisks.slice(0, 4).map((r, i) => <div key={i} class="text-[11px] text-[var(--color-text-muted)]">• {r}</div>)}
      </div>
      {es.nextSteps.length > 0 && <div class="text-[11px]"><span class="text-[var(--color-accent)]">Next:</span> {es.nextSteps.join(' → ')}</div>}
    </div>
  );
}

// ── Discovery Call Intelligence Report (Acquisition Specialist v1) ────────────
// The cohesive, operator-facing pre-call report: six labeled sections in the
// exact order Tyler runs a lead against. Pulls Smart Input, the five strategy
// evaluations, and the offer range from the backend discovery report; Parcel
// Intelligence / Comps / Market Pulse render from the report + executive summary.
function verdictTone(v: string): string {
  return v === 'viable' ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]'
    : v === 'not viable' ? 'text-[var(--color-status-failed)] border-[var(--color-status-failed)]'
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
function DiscoveryCallReportSection({ dcr, report, es }: { dcr?: DiscoveryReportView | null; report: ReportView; es?: ExecSummaryView | null }) {
  if (!dcr) return null;
  const token = dashboardToken; // a const value, not a function — calling it threw and crashed the whole report block
  const withToken = (u: string) => (u.startsWith('/api/') ? `${u}&token=${encodeURIComponent(token)}` : u);
  const fact = (key: string): string | null => (report.ddFactChecklist ?? []).find((r) => r.key === key)?.value ?? null;
  const mc = report.marketComps;
  const m = mc?.metrics;
  const or = dcr.roughOfferRange;
  const verifiedTone = dcr.parcelVerified ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]' : 'text-[var(--color-accent)] border-[var(--color-accent)]';
  const parcelFacts: Array<[string, string | null]> = [
    ['Owner', fact('owner')], ['APN', fact('apn')], ['Acreage', fact('acres')],
    ['County', fact('county')], ['Zoning', fact('zoning')], ['Land use', fact('landUse')],
    ['Flood', fact('flood')], ['Wetlands', fact('wetlands')], ['Slope', fact('slope')],
  ];
  const soldExamples = (mc?.sold ?? []).filter((c) => c.pricePerAcre != null).slice(0, 5);
  const inspection = dcr.landportalInspection;
  const fs = inspection?.factSheet; // correctly-parsed LandPortal facts (right keys + % formatting)
  const compIntel = dcr.comparableIntelligence;
  const marketIntel = dcr.marketIntelligence;
  const parcelShots = (inspection?.assets ?? []).filter((a) => a.kind === 'parcel_page' || a.kind === 'parcel_3d');
  const overlayShots = (inspection?.assets ?? []).filter((a) => a.kind === 'overlay');
  const comparablesShot = (inspection?.assets ?? []).find((a) => a.kind === 'comparables_map');
  const operatorFacts: Array<[string, string]> = inspection ? [
    ['APN', inspectionFactValue(inspection.parcelFacts, 'Parcel ID', 'APN')],
    ['Owner', inspectionFactValue(inspection.parcelFacts, 'Owner Name', 'Owner')],
    ['Acreage', inspectionFactValue(inspection.parcelFacts, 'Acres', 'Calc Acres', 'MLS Acres')],
    ['Legal Description', inspectionFactValue(inspection.parcelFacts, 'Legal Description')],
    ['Road Frontage', inspectionFactValue(inspection.parcelFacts, 'Road Frontage')],
    ['Road Type', inspectionFactValue(inspection.parcelFacts, 'Road Type')],
    // Landlocked / access, buildability, FEMA, wetlands, slope come from the
    // PARSED fact sheet (correct LandPortal keys + % formatting) — earlier this
    // read the wrong keys ('Buildability' → Building SqFt = 0) and overlays that
    // don't exist, so it showed 0 / Not Found while the rest of the card had the
    // real values. Fall back to the raw parcel facts with the correct keys.
    ['Landlocked', inspectionFactValue(inspection.parcelFacts, 'Land Locked')],
    ['Utilities', inspectionFactValue(inspection.parcelFacts, 'Utilities', 'Utility Power')],
    ['Buildability', fs?.buildability.pct ?? inspectionFactValue(inspection.parcelFacts, 'Buildability total (%)', 'Buildability total')],
    ['FEMA / Flood', fs?.environment.femaFloodZone
      ? `${fs.environment.femaFloodZone}${fs.environment.femaCoveragePct ? ` · coverage ${fs.environment.femaCoveragePct}` : ''}`
      : inspectionFactValue(inspection.parcelFacts, 'FEMA Flood Zone', 'FEMA Coverage (%)')],
    ['Wetlands', fs?.environment.wetlandsPct ?? inspectionFactValue(inspection.parcelFacts, 'Wetlands Coverage (%)', 'Wetlands Coverage')],
    ['Terrain / Slope', inspectionFactValue(inspection.parcelFacts, 'Slope Avg')],
    ['Water Features', inspectionFactValue(inspection.parcelFacts, 'Water Feature type(s)', 'Water Feature')],
    ['Parcel Shape', inspectionFactValue(inspection.parcelFacts, 'Parcel Shape')],
    ['Zoning', inspectionFactValue(inspection.parcelFacts, 'Zoning')],
    ['HOA', inspectionFactValue(inspection.parcelFacts, 'HOA')],
  ] : [];
  const topStrategy = dcr.strategyEvaluation.find((s) => s.verdict === 'viable') ?? dcr.strategyEvaluation.find((s) => s.verdict === 'maybe') ?? null;
  const nextVerifications = [
    ...(inspection?.missingInformation ?? []),
    ...(compIntel?.evidenceMissing ?? []),
    ...(marketIntel?.missingInformation ?? []),
  ].filter(Boolean).slice(0, 5);
  const promising = [
    ...(inspection?.visualObservations?.map((o) => `${o.label}: ${o.detail}`) ?? []),
    ...(marketIntel?.opportunities ?? []),
  ].slice(0, 4);
  const concerns = [
    ...(marketIntel?.risks ?? []),
    ...(inspection?.missingInformation ?? []).map((x) => `${x} still needs confirmation.`),
  ].slice(0, 4);

  return (
    <div class="rounded-lg border border-[var(--color-accent)] bg-[var(--color-card)] p-4 space-y-3">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[13px] font-bold uppercase tracking-wider text-[var(--color-accent)]">Seller Call Brief</span>
        <span class={`text-[10px] px-2 py-0.5 rounded-full border ${verifiedTone}`}>{dcr.contextLabel}</span>
        <span class="ml-auto text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-faint)]">confidence: {dcr.confidence}</span>
      </div>
      <div class="text-[12px] font-semibold text-[var(--color-text)]">{dcr.headline}</div>
      <div class="text-[10px] text-[var(--color-text-faint)] italic">{dcr.disclaimer}</div>

      <div class="rounded-md border border-[var(--color-border)] p-3 space-y-1.5">
        <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Operator Summary</div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
          <div class="text-[11px] text-[var(--color-text-muted)]"><span class="text-[var(--color-text)]">Can I buy this property?</span> {dcr.parcelVerified ? 'Yes, parcel identity is verified. Use the pricing and market sections as discovery-call guidance only.' : 'Not confidently yet. Resolve the exact parcel before discussing price with conviction.'}</div>
          <div class="text-[11px] text-[var(--color-text-muted)]"><span class="text-[var(--color-text)]">What is the opportunity?</span> {topStrategy ? `${topStrategy.strategy}: ${topStrategy.reason}` : 'No clear path yet.'}</div>
          <div class="text-[11px] text-[var(--color-text-muted)]"><span class="text-[var(--color-text)]">Estimated Market Value</span> {compIntel?.estimatedMarketValue ? `${usd(compIntel.estimatedMarketValue.mid)} (${compIntel.confidence} confidence)` : 'Not supported yet by current evidence.'}</div>
          <div class="text-[11px] text-[var(--color-text-muted)]"><span class="text-[var(--color-text)]">Recommended Next Step</span> {nextVerifications[0] ?? 'Use the discovery questions below to close the remaining gaps.'}</div>
        </div>
        {promising.length > 0 && <div class="text-[10px] text-[var(--color-text-muted)]">What appears promising: {promising.join(' ')}</div>}
        {concerns.length > 0 && <div class="text-[10px] text-[var(--color-text-muted)]">What concerns exist: {concerns.join(' ')}</div>}
      </div>

      {/* 1. Smart Input Interpretation */}
      <DiscoverySection n={1} title="Smart Input Interpretation">
        <div class="text-[11px] text-[var(--color-text-muted)]">You entered: <span class="text-[var(--color-text)]">{dcr.smartInput.rawInput || '—'}</span></div>
        <div class="text-[11px] text-[var(--color-text-muted)]">Interpreted as: {dcr.smartInput.interpretedAs}</div>
        <div class="flex flex-wrap gap-1 pt-0.5">
          {dcr.smartInput.resolvedFields.map((f, i) => (
            <span key={i} class="text-[10px] px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)]">{f.label}: <span class="text-[var(--color-text)]">{f.value}</span></span>
          ))}
        </div>
        <div class="text-[10px] text-[var(--color-text-faint)]">Path: {dcr.smartInput.resolutionPath}</div>
        <div class="text-[10px] text-[var(--color-text-faint)]">{dcr.smartInput.note}</div>
      </DiscoverySection>

      {/* 2. Parcel Intelligence */}
      <DiscoverySection n={2} title="Parcel Intelligence">
        <div class="grid grid-cols-2 gap-x-3 gap-y-0.5">
          {parcelFacts.filter(([, v]) => v).map(([label, v], i) => (
            <div key={i} class="text-[11px] text-[var(--color-text-muted)]">{label}: <span class="text-[var(--color-text)]">{v}</span></div>
          ))}
        </div>
        {parcelFacts.every(([, v]) => !v) && <div class="text-[11px] text-[var(--color-text-faint)]">No verified parcel facts yet — see the Parcel Intelligence map + DD checklist below.</div>}
        {!dcr.parcelVerified && <div class="text-[10px] text-[var(--color-text-faint)]">Local area context — parcel identity not verified. Full detail in the sections below.</div>}
      </DiscoverySection>

      <DiscoverySection n={3} title="Property Snapshot">
        {inspection?.parcelUrl && <div class="text-[10px] text-[var(--color-text-faint)]">Parcel source: <a href={inspection.parcelUrl} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">LandPortal parcel page</a></div>}
        {parcelShots.length > 0 && (
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            {parcelShots.map((asset) => (
              <figure key={asset.key} class="m-0">
                <img src={withToken(asset.url)} alt={asset.label} class="w-full h-40 object-cover rounded-lg border border-[var(--color-border)]" loading="lazy" />
                <figcaption class="text-[10px] text-[var(--color-text-faint)] mt-0.5">{asset.label}</figcaption>
              </figure>
            ))}
          </div>
        )}
        {comparablesShot && (
          <figure class="m-0 pt-1">
            <img src={withToken(comparablesShot.url)} alt={comparablesShot.label} class="w-full h-44 object-cover rounded-lg border border-[var(--color-border)]" loading="lazy" />
            <figcaption class="text-[10px] text-[var(--color-text-faint)] mt-0.5">{comparablesShot.label}</figcaption>
          </figure>
        )}
        {operatorFacts.length > 0 && (
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5 pt-1">
            {operatorFacts.map(([label, value]) => (
              <div key={label} class="text-[10px] text-[var(--color-text-muted)]">{label}: <span class="text-[var(--color-text)]">{value}</span></div>
            ))}
          </div>
        )}
        {inspection && Object.keys(inspection.parcelFacts).length > 0 && (
          <details>
            <summary class="text-[10px] cursor-pointer text-[var(--color-text-faint)]">All captured parcel facts</summary>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5 pt-1">
              {Object.entries(inspection.parcelFacts).map(([label, value]) => (
                <div key={label} class="text-[10px] text-[var(--color-text-muted)]">{label}: <span class="text-[var(--color-text)]">{value}</span></div>
              ))}
            </div>
          </details>
        )}
        {inspection?.visualObservations?.length ? (
          <div class="space-y-1 pt-1">
            <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Visual investor observations</div>
            {inspection.visualObservations.map((item, i) => (
              <div key={i} class="text-[11px] text-[var(--color-text-muted)]">
                <span class="text-[var(--color-text)]">{item.label}:</span> {item.detail}
                <span class="text-[10px] text-[var(--color-text-faint)]"> [Visual Signal | Not Verified Fact | {item.confidence}]</span>
              </div>
            ))}
          </div>
        ) : null}
        {inspection?.overlays?.length ? (
          <div class="space-y-1 pt-1">
            <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Basemaps &amp; overlays</div>
            {inspection.overlays.map((item, i) => (
              <div key={i} class="text-[10px] text-[var(--color-text-muted)]">
                <span class="text-[var(--color-text)]">{item.overlay}:</span> {item.note}
                <span class="text-[var(--color-text-faint)]"> [{item.status} | {item.confidence}]</span>
              </div>
            ))}
            {overlayShots.length > 0 && (
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                {overlayShots.map((asset) => (
                  <figure key={asset.key} class="m-0">
                    <img src={withToken(asset.url)} alt={asset.label} class="w-full h-36 object-cover rounded-lg border border-[var(--color-border)]" loading="lazy" />
                    <figcaption class="text-[10px] text-[var(--color-text-faint)] mt-0.5">{asset.label} | visual signal only</figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>
        ) : null}
        {inspection?.sources?.length ? (
          <div class="space-y-1 pt-1">
            <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Sources</div>
            {inspection.sources.map((src, i) => (
              <div key={i} class="text-[10px] text-[var(--color-text-muted)]">
                <span class="text-[var(--color-text)]">{src.provider}</span> | {src.status} | {src.confidence}
                {src.url ? <> | <a href={src.url} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">source</a></> : null}
                {src.note ? ` | ${src.note}` : ''}
              </div>
            ))}
          </div>
        ) : null}
        {inspection?.evidence?.length ? (
          <div class="space-y-1 pt-1">
            <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Evidence</div>
            {inspection.evidence.slice(0, 12).map((item, i) => (
              <div key={i} class="text-[10px] text-[var(--color-text-muted)]">
                <span class="text-[var(--color-text)]">{item.label}</span> | {item.status} | {item.confidence} | {item.detail}
              </div>
            ))}
          </div>
        ) : null}
        {inspection?.discoveryQuestions?.length ? (
          <div class="space-y-1 pt-1">
            <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Discovery call questions</div>
            {inspection.discoveryQuestions.map((q, i) => <div key={i} class="text-[10px] text-[var(--color-text-muted)]">• {q}</div>)}
          </div>
        ) : null}
        {inspection?.missingInformation?.length ? (
          <div class="space-y-1 pt-1">
            <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Missing information</div>
            {inspection.missingInformation.map((item, i) => <div key={i} class="text-[10px] text-[var(--color-text-muted)]">• {item}</div>)}
          </div>
        ) : null}
      </DiscoverySection>

      {/* 4. Comps / Land Price */}
      <DiscoverySection n={4} title="Market Value Evidence">
        {compIntel && (
          <div class="rounded border border-[var(--color-border)] p-2 mb-2 space-y-1">
            <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Comparable intelligence</div>
            <div class="text-[11px] text-[var(--color-text-muted)]">Subject type: <span class="text-[var(--color-text)]">{compIntel.subjectClassification.type.replace(/_/g, ' ')}</span> ({compIntel.subjectClassification.confidence}){compIntel.acreageBand ? ` | acreage band ${compIntel.acreageBand}` : ''}</div>
            {compIntel.estimatedMarketValue && <div class="text-[11px] text-[var(--color-text-muted)]">Estimated market value: <span class="text-[var(--color-status-done)]">{usd(compIntel.estimatedMarketValue.mid)}</span> ({usd(compIntel.estimatedPricePerAcre.mid)}/ac, conf {compIntel.confidence})</div>}
            {compIntel.evidenceUsed.length > 0 && <div class="text-[10px] text-[var(--color-text-faint)]">Evidence source: {compIntel.evidenceUsed.slice(0, 2).join(' ')}</div>}
            {compIntel.evidenceMissing.length > 0 && <div class="text-[10px] text-[var(--color-text-faint)]">Missing: {compIntel.evidenceMissing.slice(0, 4).join(', ')}</div>}
          </div>
        )}
        {m && m.soldMedianPpa != null ? (
          <>
            <div class="text-[12px] font-semibold text-[var(--color-status-done)]">{usd(m.soldMedianPpa)}/acre <span class="text-[10px] font-normal text-[var(--color-text-faint)]">(band {usd(m.ppaMin)}–{usd(m.ppaMax)})</span></div>
            <div class="text-[11px] text-[var(--color-text-muted)]">{mc?.soldCount ?? 0} sold · {mc?.activeCount ?? 0} active{m.domMedian != null ? ` · ~${m.domMedian} days on market` : ''}{!dcr.parcelVerified ? ' · area-level (weaker)' : ''}</div>
            {soldExamples.length > 0 && (
              <div class="pt-0.5 space-y-0.5">
                {soldExamples.map((c, i) => (
                  <div key={i} class="text-[10px] text-[var(--color-text-faint)]">{c.addressDesc ?? c.sourceLabel}: {usd(c.price)}{c.acres ? ` · ${c.acres} ac` : ''}{c.pricePerAcre ? ` · ${usd(c.pricePerAcre)}/ac` : ''}{c.sourceUrl ? <> · <a href={c.sourceUrl} target="_blank" class="text-[var(--color-accent)] underline">source</a></> : null}</div>
                ))}
              </div>
            )}
            {mc?.sparseExplanation && <div class="text-[10px] text-[var(--color-text-faint)]">{mc.sparseExplanation}</div>}
          </>
        ) : or.pricePerAcre.mid != null ? (
          <>
            <div class="text-[12px] font-semibold text-[var(--color-accent)]">{usd(or.pricePerAcre.mid)}/acre <span class="text-[10px] font-normal text-[var(--color-text-faint)]">(asking — active listings, not sold)</span></div>
            <div class="text-[11px] text-[var(--color-text-muted)]">{mc?.activeCount ?? 0} active land listings nearby · no recent sold comps. Land usually sells at/below asking — treat as weaker area context.</div>
          </>
        ) : (
          <div class="text-[11px] text-[var(--color-text-faint)]">No sold-comp price band yet. {mc?.note ?? 'Widen the comp search or confirm the area.'}</div>
        )}
        {inspection?.comparablesUrl && <div class="text-[10px] text-[var(--color-text-faint)] pt-1">LandPortal comparables: <a href={inspection.comparablesUrl} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">open map</a></div>}
        {((compIntel?.selectedComparables?.length ?? 0) > 0 || (compIntel?.comparables?.length ?? 0) > 0 || inspection?.comparables?.length) ? (
          <div class="pt-1 space-y-1">
            {((compIntel?.selectedComparables?.length ?? 0) > 0 ? compIntel?.selectedComparables : (compIntel?.comparables ?? inspection.comparables)).map((comp: any, i) => (
              <div key={i} class="text-[10px] text-[var(--color-text-muted)]">
                <span class="text-[var(--color-text)]">{comp.status}</span>
                {comp.address ? ` | ${comp.address}` : ''}{comp.apn ? ` | APN ${comp.apn}` : ''}{(comp.saleDate) ? ` | ${comp.saleDate}` : ''}{(comp.acreage ?? comp.acres) != null ? ` | ${comp.acreage ?? comp.acres} ac` : ''}{(comp.salePrice ?? comp.price) != null ? ` | ${usd(comp.salePrice ?? comp.price)}` : ''}{comp.pricePerAcre != null ? ` | ${usd(comp.pricePerAcre)}/ac` : ''}{comp.distanceMiles != null ? ` | ${comp.distanceMiles} mi` : ''}{comp.saleListIndicator && comp.saleListIndicator !== 'unknown' ? ` | ${comp.saleListIndicator}` : ''}{(comp.propertyType ?? comp.improvement) && (comp.propertyType ?? comp.improvement) !== 'unknown' ? ` | ${(comp.propertyType ?? comp.improvement).replace(/_/g, ' ')}` : ''}{comp.confidence ? ` | conf ${comp.confidence}` : ''}
                {comp.sourceUrl ? <> | <a href={comp.sourceUrl} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">source</a></> : null}
                {comp.parsingErrors?.length ? <span class="text-[var(--color-status-failed)]"> | check parse</span> : null}
              </div>
            ))}
          </div>
        ) : null}
      </DiscoverySection>

      {/* 5. Market Pulse */}
      <DiscoverySection n={5} title="Surrounding Market">
        {/* Master Market Matrix (single source of truth) — ZIP→County→State fallback. */}
        <MarketMatrixPanel mm={dcr.marketMatrix} />
        {marketIntel ? (
          <>
            <div class="text-[11px] text-[var(--color-text-muted)]">{marketIntel.marketPulse}</div>
            <div class="text-[10px] text-[var(--color-text-faint)]">{marketIntel.label} | confidence {marketIntel.confidence}</div>
            {marketIntel.opportunities.length > 0 && <div class="text-[10px] text-[var(--color-text-muted)]">Opportunities: {marketIntel.opportunities.slice(0, 3).join(' ')}</div>}
            {marketIntel.risks.length > 0 && <div class="text-[10px] text-[var(--color-text-muted)]">Risks: {marketIntel.risks.slice(0, 3).join(' ')}</div>}
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5 pt-1">
              {marketIntel.facts.filter((f) => f.value).slice(0, 8).map((f, i) => (
                <div key={i} class="text-[10px] text-[var(--color-text-muted)]">{f.label}: <span class="text-[var(--color-text)]">{f.value}</span> <span class="text-[var(--color-text-faint)]">[{f.status}]</span></div>
              ))}
            </div>
          </>
        ) : es ? (
          <>
            <div class="text-[11px] text-[var(--color-text-muted)]">{es.marketPulse.interpretation}</div>
            <div class="text-[11px] text-[var(--color-text-muted)]">{es.marketPulse.whatThisMeans}</div>
            {es.marketPulse.growthDrivers.available && <div class="text-[10px] text-[var(--color-text-faint)]">Growth: {es.marketPulse.growthDrivers.summary}</div>}
          </>
        ) : <div class="text-[11px] text-[var(--color-text-faint)]">Market read pending.</div>}
      </DiscoverySection>

      {/* 5. Initial Strategy Evaluation — exactly five */}
      <DiscoverySection n={6} title="Acquisition Paths">
        <div class="space-y-1.5">
          {dcr.strategyEvaluation.map((s, i) => (
            <div key={i} class="rounded border border-[var(--color-border)] p-2 space-y-0.5">
              <div class="flex items-center gap-2">
                <span class="text-[11px] font-semibold text-[var(--color-text)]">{s.strategy}</span>
                <span class={`text-[9px] px-1.5 py-0.5 rounded-full border ${verdictTone(s.verdict)}`}>{s.verdict}</span>
              </div>
              <div class="text-[10px] text-[var(--color-text-muted)]">{s.reason}</div>
              <div class="text-[10px] text-[var(--color-text-muted)]"><span class="text-[var(--color-text-faint)]">Pricing:</span> {s.pricingLogic}</div>
              <div class="text-[10px] text-[var(--color-text-muted)]"><span class="text-[var(--color-status-failed)]">Risk:</span> {s.mainRisk}</div>
            </div>
          ))}
        </div>
      </DiscoverySection>

      {/* 6. Rough Offer Range */}
      <DiscoverySection n={7} title="Discovery Call Range">
        {or.available ? (
          <>
            {or.acquisition ? (
              <div class="text-[13px] font-semibold text-[var(--color-status-done)]">{usd(or.acquisition.low)} – {usd(or.acquisition.high)} <span class="text-[10px] font-normal text-[var(--color-text-faint)]">(40–60% of ~{usd(or.marketValue?.mid)} market value)</span></div>
            ) : or.perAcreAcquisition ? (
              <div class="text-[13px] font-semibold text-[var(--color-status-done)]">{usd(or.perAcreAcquisition.low)} – {usd(or.perAcreAcquisition.high)} / acre <span class="text-[10px] font-normal text-[var(--color-text-faint)]">(40–60% of ~{usd(or.pricePerAcre.mid)}/ac — provide acreage for a total)</span></div>
            ) : null}
            <div class="text-[11px] text-[var(--color-text-muted)]">{or.note}</div>
            <div class="text-[10px] text-[var(--color-text-faint)]">Confidence: {or.confidence} · basis: {or.basis}{!dcr.parcelVerified ? ' (parcel not verified — weaker)' : ''}</div>
            {or.whatCouldChange.length > 0 && <div class="text-[10px] text-[var(--color-text-faint)]">What could change it: {or.whatCouldChange.slice(0, 6).join('; ')}</div>}
          </>
        ) : (
          <div class="text-[11px] text-[var(--color-text-faint)]">{or.note}</div>
        )}
      </DiscoverySection>
    </div>
  );
}

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
function DdFactChecklist({ rows, completeness }: { rows?: DdChecklistRowView[]; completeness?: ReportView['ddCompleteness'] }) {
  if (!rows || rows.length === 0) return null;
  const pct = completeness?.percentComplete ?? 0;
  return (
    <div>
      <div class="flex items-center justify-between mb-1">
        <span class="text-[11px] text-[var(--color-text-muted)]">Due Diligence fact checklist</span>
        {completeness && (
          <span class="text-[11px] text-[var(--color-text-faint)] tabular-nums">{completeness.label}</span>
        )}
      </div>
      {completeness && (
        <div class="h-1.5 w-full rounded-full bg-[var(--color-elevated)] overflow-hidden mb-2">
          <div class="h-full bg-[var(--color-status-done)]" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] divide-y divide-[var(--color-border)]">
        {rows.map((r) => (
          <div key={r.key} class="flex items-center gap-2 px-3 py-1.5 text-[12px]">
            <span class="flex-1">{r.label}</span>
            {r.status === 'verified' ? (
              <span class="text-[var(--color-text)]">
                {r.value} <span class="text-[10px] text-[var(--color-status-done)]">Verified{r.source ? ` · ${r.source}` : ''}</span>
              </span>
            ) : (
              <span class="text-[10px] px-1.5 py-0.5 rounded-full border text-[var(--color-text-faint)] border-[var(--color-border)]">
                Unknown / Needs Verification{r.noConnectedSource ? ' (no source)' : ''}
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
  const withToken = (u: string) => (u.startsWith('/api/') ? `${u}&token=${encodeURIComponent(token)}` : u);
  const captured = ctx.assets.filter((a) => a.status === 'captured' && a.imageUrl);
  const sat = captured.find(isSatellite);
  const street = captured.find(isStreetView);
  // Parcel geometry is not provided by the connected imagery source (Google
  // Static Maps returns no parcel polygon). When a geometry provider (county
  // GIS / OpenAddresses) is wired, set ctx.parcelBoundary and this renders the
  // outline instead of the marker fallback. Until then: honest marker fallback.
  const hasBoundary = !!(ctx as { parcelBoundary?: unknown }).parcelBoundary;
  const streetUnavailable = ctx.assets.some(isStreetView) && !street;
  return (
    <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-2">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Visual Context</span>
        <span class="text-[10px] px-1.5 py-0.5 rounded-full border text-[var(--color-text-faint)] border-[var(--color-border)]">{ctx.label}</span>
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
            Satellite not captured yet — use "Capture visuals".
          </div>
        )}
        {street ? (
          <figure class="m-0">
            <img src={withToken(street.imageUrl as string)} alt="street view" class="w-full h-40 sm:h-44 object-cover rounded-lg border border-[var(--color-border)]" loading="lazy" />
            <figcaption class="text-[10px] text-[var(--color-text-faint)] mt-0.5">Street View · {street.apiService}</figcaption>
          </figure>
        ) : streetUnavailable ? (
          <div class="text-[11px] text-[var(--color-text-muted)] rounded-lg border border-dashed border-[var(--color-border)] p-3 flex items-center">Street View unavailable — Google has no imagery on this road.</div>
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
  const floodTxt = g?.flood?.status === 'verified' ? (g.flood.zone && !/^x$/i.test(g.flood.zone) ? `Zone ${g.flood.zone}` : 'Zone X (min.)') : 'Unknown';
  const wetTxt = g?.wetlands?.status === 'verified' ? (g.wetlands.type ? 'Present' : 'None mapped') : 'Unknown';
  const slopeTxt = g?.slope?.status === 'verified' && g.slope.slopeDeg != null ? `~${g.slope.slopeDeg}°` : 'Unknown';
  const improved = propertyType?.vacantOrImproved || 'Unknown';
  const cells: Array<{ label: string; value: string }> = [
    { label: 'Verified', value: report.parcelVerified ? 'Yes' : 'No' },
    { label: 'Property type', value: propertyType?.propertyType || (fact('landUse') ?? 'Unknown') },
    { label: 'Land use', value: fact('landUse') ?? 'Unknown' },
    { label: 'Flood', value: floodTxt },
    { label: 'Wetlands', value: wetTxt },
    { label: 'Slope', value: slopeTxt },
    { label: 'Improvement', value: improved },
    { label: 'DD complete', value: report.ddCompleteness ? `${report.ddCompleteness.percentComplete}%` : '—' },
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
            <span class="text-[10px] text-[var(--color-text-faint)]">confidence: {ls.confidence.replace(/_/g, ' ')}</span>
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
          <div class="text-[10px] text-[var(--color-text-faint)] mt-2">{ls.note}</div>
        </div>
      )}
    </Section>
  );
}

function MarketPulseSection({ mp, mc }: { mp?: MarketPulseView | null; mc?: MarketCompsView | null }) {
  if (!mp) return null;
  const usd = (n: number | null) => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`);
  const dirTone = mp.direction === 'strengthening' ? 'text-[var(--color-status-done)]' : mp.direction === 'softening' ? 'text-[var(--color-status-failed)]' : 'text-[var(--color-text-muted)]';

  // Derive period + named sources + active-retrieval status from existing comp
  // data (no new providers). "Active" is only a real count when retrieval ran.
  const soldRows = mc?.sold ?? [];
  const soldDates = soldRows.map((r) => r.saleDateIso).filter(Boolean).sort() as string[];
  const period = soldDates.length ? `${soldDates[0]} → ${soldDates[soldDates.length - 1]}` : 'no dated sold comps';
  const uniq = (xs: Array<string | undefined>) => Array.from(new Set(xs.filter(Boolean) as string[]));
  const soldSrc = uniq(soldRows.map((r) => r.sourceLabel)).join(', ') || (mc?.providerChain?.find((c) => /realie|homeharvest/i.test(c)) ?? 'none');
  const activeSrc = uniq((mc?.active ?? []).map((r) => r.sourceLabel)).join(', ') || (mc?.providerChain?.find((c) => /apify|zillow|realtor/i.test(c)) ?? 'Zillow/Apify');
  const activeState = mc ? activeRetrievalState(mc) : 'not_run';
  const activeStatusTxt = activeState === 'ran' ? `ran (${mp.activeCount} found)` : activeState === 'not_run' ? 'not run yet' : 'incomplete (provider error/timeout)';

  // Land $/ac by acreage band + active land asking prices (from existing comps).
  const bands = ppaByAcreageBand(soldRows);
  const activeRows = mc?.active ?? [];
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
      {/* Headline verdict */}
      <div class={`text-[14px] font-medium ${dirTone}`}>{mp.verdict}</div>

      {/* PRIORITY 1 — land $/ac by acreage band. */}
      <div>
        <div class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Land $/ac by acreage band</div>
        {bands.length > 0 ? (
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 mt-1">
            {bands.map((b) => <HeaderField key={b.band} label={`${b.band} (${b.count})`} value={`${usd(b.ppa)}/ac`} />)}
          </div>
        ) : <div class="text-[11px] text-[var(--color-text-faint)] mt-1">Not enough dated sold comps to band by acreage yet.</div>}
      </div>

      {/* PRIORITY 2 — overall county $/ac + active land asking prices. */}
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
        <HeaderField label="County median $/ac" value={usd(mp.pricePerAcre.median)} />
        <HeaderField label="County $/ac band" value={`${usd(mp.pricePerAcre.p25)}–${usd(mp.pricePerAcre.p75)}`} />
        <HeaderField label="Active asking (land)" value={activeState === 'ran' && askMed != null ? `${usd(askLo)}–${usd(askHi)}` : activeState === 'ran' ? 'none found' : activeState === 'not_run' ? 'not run' : 'incomplete'} />
        <HeaderField label="Active median ask" value={activeState === 'ran' && askMed != null ? usd(askMed) : '—'} />
      </div>

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
          <div class="text-[11px] text-[var(--color-text-faint)] mt-1">No public-web growth/development signals retrieved for this area.</div>
        )}
        <div class="text-[12px] text-[var(--color-text-muted)] mt-1">{mp.growthDrivers.summary}</div>
        <div class="text-[11px] text-[var(--color-text)] mt-1"><span class="text-[var(--color-text-faint)]">Effect on land demand:</span> {helpHurt}.</div>
        <div class="text-[12px] text-[var(--color-accent)] mt-1">What this means for buying land here: {mp.growthDrivers.whatThisMeans}</div>
      </div>

      {/* Context: sources / period / active-retrieval status. */}
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 border-t border-[var(--color-border)] pt-2">
        <HeaderField label="Sold period" value={period} />
        <HeaderField label="Sold source" value={soldSrc} />
        <HeaderField label="Active source" value={activeSrc} />
        <HeaderField label="Active retrieval" value={activeStatusTxt} />
      </div>
      <div class="text-[12px] text-[var(--color-text-muted)]">{mp.interpretation}</div>

      {/* Absorption metrics — deprioritized to a small secondary line. */}
      <div class="text-[10px] text-[var(--color-text-faint)]">
        Absorption (secondary): days on market {mp.domMedian != null ? `~${mp.domMedian}` : '—'} · months of inventory {mp.monthsOfInventory != null ? mp.monthsOfInventory : '—'} · sell-through {mp.sellThroughPct != null ? `${mp.sellThroughPct}%` : '—'} · trend {mp.direction}{mp.directionPct != null ? ` (${mp.directionPct > 0 ? '+' : ''}${mp.directionPct}%)` : ''}.
      </div>
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
// everything else neutral so an un-run report never looks finished.
function ReportStatusBadge({ status }: { status?: string }) {
  const good = status === 'complete';
  const bad = status === 'blocked' || status === 'failed';
  const cls = good
    ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
    : bad
      ? 'border-[var(--color-status-failed)] text-[var(--color-status-failed)]'
      : 'border-[var(--color-border)] text-[var(--color-text-muted)]';
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
  county?: string | null;
  state?: string | null;
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

// Offer-readiness badge. Only 'ready_for_offer' reads as an accent (advanced)
// state; every other label reads as not-yet-ready so strategy never looks
// offer-ready until Tyler advances it.
function StrategyReadinessBadge({ status }: { status?: string }) {
  const ready = status === 'ready_for_offer';
  const blocked = status === 'blocked' || status === 'pass';
  const cls = ready
    ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
    : blocked
      ? 'border-[var(--color-status-failed)] text-[var(--color-status-failed)]'
      : 'border-[var(--color-border)] text-[var(--color-text-muted)]';
  return (
    <span class={`text-[10px] px-1.5 py-0.5 rounded-full border ${cls}`}>
      Offer readiness: {readinessText(status)}
    </span>
  );
}

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
interface SpineHeader {
  stage: string; parcelCompleteness: number; decisionConfidence: string; decisionGrade: boolean;
  decisionGradeReason: string; missingCriticalInfo: string[]; blockingVerificationTasks: SpineVerificationTask[];
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

        {/* What's still missing */}
        <div class="space-y-1">
          <div class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">What's still missing</div>
          {h.missingCriticalInfo.length === 0
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
          {cp.status === 'measured' && cp.medianPpa != null
            ? <div class="text-[var(--color-text)]">~${cp.medianPpa.toLocaleString()}/acre <span class="text-[10px] text-[var(--color-text-faint)]">({cp.sampleSize} comps)</span></div>
            : <div class="text-[var(--color-text-faint)]">{cp.note}</div>}
          {zp?.medianPpa != null && <div class="text-[var(--color-text)]">ZIP: ~${zp.medianPpa.toLocaleString()}/acre <span class="text-[10px] text-[var(--color-text-faint)]">({zp.sampleSize})</span></div>}
        </div>
        <div>
          <div class="text-[var(--color-text-faint)]">Growth signals</div>
          <div class="text-[var(--color-text-muted)]">{mp.developmentSignals.note}</div>
          <a href={mp.developmentSignals.source} target="_blank" rel="noreferrer" class="text-[10px] text-[var(--color-accent)] underline">scan development</a>
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

export function DealCard({ dealCardId, entity = 'all' }: { dealCardId?: number; entity?: EntityFilter }) {
  const [deal, setDeal] = useState<DealCardDetail | null>(null);
  const [spine, setSpine] = useState<BusinessSpineView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const [readiness, setReadiness] = useState<ReadinessView | null>(null);
  const [briefing, setBriefing] = useState<BriefingView | null>(null);
  const [preCall, setPreCall] = useState<PreCallView | null>(null);
  const [execSummary, setExecSummary] = useState<ExecSummaryView | null>(null);
  const [discoveryReport, setDiscoveryReport] = useState<DiscoveryReportView | null>(null);
  const [propertyType, setPropertyType] = useState<PropertyTypeView | null>(null);
  const [reportRunning, setReportRunning] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportWarnings, setReportWarnings] = useState<string[]>([]);
  // Visual Property Context capture state (explicit per-property Google capture).
  const [visualCapturing, setVisualCapturing] = useState(false);
  const [visualCaptureMsg, setVisualCaptureMsg] = useState<string | null>(null);

  // Land Score + supporting imagery — computed ON DEMAND (a Land Score click
  // triggers a bounded NON-CREDIT LandPortal resolve; never scored from
  // unverified data; imagery is supporting context only, never identity).
  const [landScore, setLandScore] = useState<LandScoreView | null>(null);
  const [landScoreNote, setLandScoreNote] = useState('');
  const [landScoreLoading, setLandScoreLoading] = useState(false);

  async function computeLandScore(id: number) {
    setLandScoreLoading(true);
    try {
      const res = await apiGet<{ landScore: LandScoreView | null; note: string }>(`/api/landos/deal-cards/${id}/land-score`);
      setLandScore(res.landScore);
      setLandScoreNote(res.note || '');
    } catch (err: any) {
      setLandScore(null);
      setLandScoreNote(err?.message || String(err));
    } finally {
      setLandScoreLoading(false);
    }
  }

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
      const res = await apiGet<{ report: ReportView; executiveSummary?: ExecSummaryView; discoveryReport?: DiscoveryReportView; readiness?: ReadinessView; briefing?: BriefingView; preCallIntelligence?: PreCallView; propertyType?: PropertyTypeView }>(`/api/landos/deal-cards/${id}/report`);
      setReport(res.report);
      setExecSummary(res.executiveSummary ?? null);
      setDiscoveryReport(res.discoveryReport ?? null);
      setReadiness(res.readiness ?? null);
      setBriefing(res.briefing ?? null);
      setPreCall(res.preCallIntelligence ?? null);
      setPropertyType(res.propertyType ?? null);
    } catch {
      setReport(null);
      setExecSummary(null);
      setDiscoveryReport(null);
      setReadiness(null);
      setBriefing(null);
      setPreCall(null);
      setPropertyType(null);
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
      const res = await apiPost<{ report: ReportView; warnings: string[]; readiness?: ReadinessView; briefing?: BriefingView; preCallIntelligence?: PreCallView; propertyType?: PropertyTypeView }>(`/api/landos/deal-cards/${deal.id}/report/run`, {});
      setReport(res.report);
      setReadiness(res.readiness ?? null);
      setBriefing(res.briefing ?? null);
      setPreCall(res.preCallIntelligence ?? null);
      setPropertyType(res.propertyType ?? null);
      setReportWarnings(Array.isArray(res.warnings) ? res.warnings : []);
      await loadDd(deal.id);
      await loadStrategy(deal.id);
      await loadMarket(deal.id);
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
      setVisualCaptureMsg(res.ok ? `Captured: ${res.captured.join(', ') || 'none'}.` : `Capture failed: ${res.reason}`);
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

  async function load(id: number) {
    try {
      setLoading(true);
      setError(null);
      setDdEditing(false);
      setDdWarnings([]);
      setStrategyEditing(false);
      setStrategyWarnings([]);
      setMarketEditing(false);
      setMarketWarnings([]);
      setReportError(null);
      setReportWarnings([]);
      setLandScore(null);
      setLandScoreNote('');
      const res = await apiGet<{ dealCard: DealCardDetail; businessSpine?: BusinessSpineView | null }>(`/api/landos/deal-cards/${id}`);
      setDeal(res.dealCard);
      setSpine(res.businessSpine ?? null);
      await loadDd(id);
      await loadStrategy(id);
      await loadMarket(id);
      await loadReport(id);
    } catch (err: any) {
      setError(err?.message || String(err));
      setDeal(null);
      setSpine(null);
      setDd(null);
      setStrategy(null);
      setMarket(null);
      setReport(null);
    } finally {
      setLoading(false);
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

  useEffect(() => {
    if (dealCardId) void load(dealCardId);
    else void refreshList();
  }, [dealCardId]);

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
  const owner = deal?.people?.find((p) => p.role === 'owner');
  const seller = deal?.people?.find((p) => p.role === 'seller');

  return (
    <div class="flex-1 overflow-y-auto px-6 py-4 space-y-4">
      {/* Toolbar: back-to-list (when a card is open) + create a new Deal Card. */}
      <div class="flex flex-wrap items-center gap-2">
        {mode === 'view' && deal && !dealCardId && (
          <button
            type="button"
            onClick={backToList}
            class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)]"
          >
            ← Deal Cards
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
            {deal && (
              <button
                type="button"
                onClick={startEdit}
                class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)]"
              >
                Edit
              </button>
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

      {/* Saved Deal Cards list — the primary open flow. Shown in view mode when no
          specific card is open and we are not embedded against a single id. */}
      {mode === 'view' && !dealCardId && !deal && (
        <Section title="Saved Deal Cards">
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
                <button
                  key={c.id}
                  type="button"
                  onClick={() => void load(c.id)}
                  class={`w-full text-left rounded-md border px-3 py-2 hover:bg-[var(--color-elevated)] ${
                    deal?.id === c.id ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'
                  }`}
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
              ))}
            </div>
          )}
        </Section>
      )}

      {mode === 'view' && error && <PageState error={error} />}
      {mode === 'view' && loading && !deal && <PageState loading />}

      {mode === 'view' && deal && (
        <>
          {/* 1. Sticky / header area */}
          <div class="sticky top-0 z-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] p-4">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-[14px] font-semibold">
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
          </div>

          {/* 1a. BUSINESS INTELLIGENCE — canonical Business Object Spine result:
              what LandOS found, what's missing, evidence, decision-grade, what's
              blocking, and the next action. The first business content on the card. */}
          <BusinessSpineSection spine={spine} dealId={deal.id} />

          {/* 1a-ii. MARKET PULSE — is the area growing/stable/declining, county /
              ZIP $/acre, growth signals. Area-level: works even when unverified. */}
          <MarketPulseReadSection dealId={deal.id} />

          {/* 1a-iii. PUBLIC RECORDS RESEARCH — the official county sources to
              check + the next verification action. Sources to check, not facts. */}
          <PublicRecordsResearchSection dealId={deal.id} />

          {/* 1b. DD + Market + Strategy operational report */}
          <Section title="DD + Market + Strategy Report">
            <div class="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <div class="flex items-center gap-2 flex-wrap">
                <ReportStatusBadge status={report?.reportStatus} />
                {report?.exists && (
                  <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
                    {report.parcelVerificationStatus}
                  </span>
                )}
              </div>
              <div class="flex items-center gap-2 flex-wrap">
                {/* Point-of-action model picker: the report run is a model-backed action. */}
                <ModelControl entity={entity} scopeKind="department" scopeKey="research_due_diligence" taskType="strategy_reasoning" orientation="reasoning_oriented" label="Report model" />
                <button
                  type="button"
                  onClick={() => void runReport()}
                  disabled={reportRunning}
                  class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
                >
                  {reportRunning ? 'Running…' : report?.exists ? 'Re-run DD + Market + Strategy Report' : 'Run DD + Market + Strategy Report'}
                </button>
              </div>
            </div>

            {reportError && <div class="text-[11px] text-[var(--color-status-failed)] mb-2">{reportError}</div>}
            {reportWarnings.length > 0 && (
              <div class="mb-2 rounded-md border border-[var(--color-status-failed)] p-2 space-y-0.5">
                {reportWarnings.map((w) => (
                  <div key={w} class="text-[11px] text-[var(--color-status-failed)]">{w}</div>
                ))}
              </div>
            )}

            {!report?.exists && (
              <div class="text-[12px] text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-lg p-3">
                No report run yet. Click <span class="text-[var(--color-accent)]">Run DD + Market + Strategy Report</span> to run the safe non-credit parcel lookup, structure Market Research source targets, apply Strategy logic, and update the three worksheets. It never spends a comp credit and never fabricates parcel facts, comps, demand, pricing, or offers.
              </div>
            )}

            {report?.exists && (
              <div class="space-y-3">
                {/* 1. VISUAL CONTEXT — top of the card (large satellite + parcel
                    marker/boundary + Street View + Maps/Earth + source/date). */}
                {prop?.id && (
                  <div>
                    <div class="flex items-center justify-end mb-1">
                      <button
                        type="button"
                        disabled={visualCapturing}
                        onClick={() => captureVisuals(prop.id)}
                        class="px-2 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
                      >
                        {visualCapturing ? 'Capturing…' : 'Capture visuals'}
                      </button>
                    </div>
                    <VisualContextSection ctx={report.visualContext} token={dashboardToken} />
                    {visualCaptureMsg && <div class="text-[11px] text-[var(--color-text-muted)] mt-1">{visualCaptureMsg}</div>}
                  </div>
                )}

                {/* 1. PROPERTY LOCATION + PARCEL DETAILS — single home for
                    address / APN / county / state / acreage / verification. */}
                <PropertyHeaderSection report={report} entity={entity} stageLabel={readiness?.workflowStageLabel} seller={seller?.name ?? undefined} marketMatrix={discoveryReport?.marketMatrix} />

                {/* 2. AT-A-GLANCE LAND FACTS — single home for flood/wetlands/slope/type. */}
                <AtAGlanceStrip report={report} propertyType={propertyType} />

                {/* 6. LAND SCORE — deterministic 100-pt rubric, computed inline from
                    the verified parcel data (no separate re-resolve / button). */}
                <LandScoreSection ls={report.landScore} parcelVerified={report.parcelVerified} />

                {/* ACQUISITION SPECIALIST v1 — the cohesive Discovery Call
                    Intelligence Report: Smart Input, Parcel Intelligence, Comps,
                    Market Pulse, the five strategy evaluations, and the offer range. */}
                <DiscoveryCallReportSection dcr={discoveryReport} report={report} es={execSummary} />

                {/* 3-5, 7, 8. EXECUTIVE SUMMARY — 40–60% preliminary range, deal
                    economics, best first-glance strategy, top risks/blockers. */}
                <ExecutiveSummarySection es={execSummary} />

                {/* 6. MARKET PULSE — real signals: period, sources, active status,
                    growth trend, named local signals, help/hurt, what it means. */}
                <MarketPulseSection mp={execSummary?.marketPulse as unknown as MarketPulseView} mc={report.marketComps} />

                {/* 9. CONFIRM BEFORE OFFER — the single home for must-confirm items. */}
                <ConfirmBeforeOfferSection es={execSummary} report={report} />

                {/* Browser Intelligence status — LandPortal-first, then County. */}
                <BrowserIntelligenceSection dealId={deal?.id} />

                {/* Raw comparable sales + active listings + provider chain — collapsed. */}
                <Collapsible title="Comparable sales & active listings (raw)">
                  <MarketCompsSection mc={report.marketComps} />
                </Collapsible>

                {/* 13 + 14. DETAILED DUE DILIGENCE — collapsed by default. */}
                <details class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)]">
                  <summary class="cursor-pointer px-4 py-3 text-[13px] font-semibold text-[var(--color-text)]">Detailed Due Diligence &amp; Research</summary>
                  <div class="px-4 pb-4 space-y-3">
                {/* DD Command Center — pre-call readiness. */}
                <DealCardCommandCenter r={readiness} />

                {/* Pre-Call Intelligence — identity tier + inferred type + readiness. */}
                <PreCallIntelligenceSection pci={preCall} pt={propertyType} />

                {/* Discovery Call Preparation — the operator briefing for the call. */}
                <DiscoveryBriefingSection b={briefing} />

                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <div class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Due Diligence + Research</div>
                    <p class="text-[13px] text-[var(--color-text)] whitespace-pre-wrap break-words">{report.ddSummary || '—'}</p>
                  </div>
                  <div>
                    <div class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Market Research</div>
                    <p class="text-[13px] text-[var(--color-text)] whitespace-pre-wrap break-words">{report.marketSummary || '—'}</p>
                  </div>
                  <div>
                    <div class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-1">Strategy</div>
                    <p class="text-[13px] text-[var(--color-text)] whitespace-pre-wrap break-words">{report.strategySummary || '—'}</p>
                    <div class="mt-1 flex flex-wrap items-center gap-2">
                      <StrategyReadinessBadge status={report.offerReadiness} />
                    </div>
                  </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                  <Field label="Most viable strategy" value={report.mostViableStrategy || undefined} />
                  <Field label="Offer readiness" value={readinessText(report.offerReadiness)} />
                </div>

                {/* 13. PROPERTY FACTS — full DD fact checklist + completeness. */}
                <DdFactChecklist rows={report.ddFactChecklist} completeness={report.ddCompleteness} />

                {/* Post-discovery DD: seller-stated facts, county verification, underwriting prep. */}
                {deal?.id && <PostDiscoveryPanel dealId={deal.id} onChange={() => void loadReport(deal.id)} />}

                {/* Source table — every source, its status, and credit usage. */}
                <div>
                  <div class="text-[11px] text-[var(--color-text-muted)] mb-1">Source table</div>
                  {report.sourceTable.length === 0 ? (
                    <Placeholder text="No sources recorded" />
                  ) : (
                    <div class="space-y-1">
                      {report.sourceTable.map((row) => (
                        <div key={row.source} class="flex items-start justify-between gap-2 border border-[var(--color-border)] rounded px-2 py-1">
                          <div class="min-w-0">
                            <div class="text-[12px] text-[var(--color-text)] truncate">{row.source}</div>
                            <div class="text-[10px] text-[var(--color-text-faint)] break-words">{row.detail}</div>
                          </div>
                          <div class="flex flex-col items-end gap-1 shrink-0">
                            <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">{row.status}</span>
                            <span class="text-[9px] text-[var(--color-text-faint)]">{row.compCreditUsed ? 'comp credit' : 'no comp credit'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <DdList title="Data gaps" items={report.dataGaps} empty="No data gaps recorded" />
                <DdList title="Risk flags" items={report.riskFlags} empty="No risk flags recorded" />
                <DdList title="County / manual verification checklist" items={report.countyVerificationChecklist} empty="No verification items" />
                <DdList title="Market follow-up checklist" items={report.marketFollowUpChecklist} empty="No market follow-ups" />
                <DdList title="Strategy blockers" items={report.strategyBlockers} empty="No blockers recorded" />
                <DdList title="Next confirmations" items={report.nextConfirmations} empty="No confirmations recorded" />

                {report.preCallStrategyNotes && (
                  <div>
                    <div class="text-[11px] text-[var(--color-text-muted)] mb-1">Pre-call strategy notes</div>
                    <p class="text-[12px] text-[var(--color-text)] whitespace-pre-wrap break-words">{report.preCallStrategyNotes}</p>
                  </div>
                )}

                <div class="rounded-md border border-[var(--color-border)] p-2">
                  <div class="text-[11px] text-[var(--color-text-muted)] mb-1">Credit usage</div>
                  <div class="text-[12px] text-[var(--color-text)]">
                    LandPortal non-credit tools: {report.creditUsage.landportalNonCreditUsed ? 'used' : 'not used'}.{' '}
                    Comp-credit tools: not used.
                  </div>
                  <div class="text-[10px] text-[var(--color-text-faint)] mt-1">{report.creditUsage.note}</div>
                </div>
                  </div>
                </details>

                <div class="text-[10px] text-[var(--color-text-faint)]">
                  Operational report. Departments stay separate (DD property-level, Market market-level, Strategy decision-level). No parcel fact is Verified without a named source; no comps, demand, pricing, EVs, or offers are fabricated.
                  {report.generatedAt ? <> Last run {formatRelativeTime(report.generatedAt)}{report.updatedBy ? ` by ${report.updatedBy}` : ''}.</> : null}
                </div>
              </div>
            )}
          </Section>

          {/* ── ADVANCED / LEGACY (collapsed by default) ──────────────────────
              Everything below is demoted out of the default DD operator brief:
              seller/acquisitions, legacy worksheets, contacts, communications,
              documents, activity, quick actions, and call prep. The standalone
              "Imagery" panel was removed (it duplicated Visual Context above and
              produced the "visual not captured yet" contradiction when visuals
              already existed). Seller-call questions live here / in Acquisitions,
              never in the default brief. */}
          <details class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
            <summary class="cursor-pointer px-4 py-3 text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Worksheets, seller / acquisitions, contacts, documents &amp; advanced</summary>
            <div class="px-4 pb-4 space-y-4">

          {/* Seller / Acquisitions — seller profile + next action + call prep. */}
          {deal?.id && <AcquisitionsPanel dealId={deal.id} />}

          {/* 2b. Land Score — 100-pt rubric from VERIFIED LandPortal attributes only */}
          <Section title="Land Score">
            <div class="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <span class="text-[10px] text-[var(--color-text-faint)]">Computed on demand from a bounded non-credit LandPortal resolve. Never scored from unverified data.</span>
              <button
                type="button"
                onClick={() => void computeLandScore(deal.id)}
                disabled={landScoreLoading}
                class="px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
              >
                {landScoreLoading ? 'Scoring…' : landScore ? 'Refresh Land Score' : 'Compute Land Score'}
              </button>
            </div>
            {!landScore && landScoreNote && <div class="text-[11px] text-[var(--color-text-muted)]">{landScoreNote}</div>}
            {!landScore && !landScoreNote && <Placeholder text="Not computed yet" />}
            {landScore && (
              <div>
                <div class="flex items-center gap-2 flex-wrap mb-2">
                  <span class="text-[16px] font-semibold tabular-nums">{landScore.score}<span class="text-[var(--color-text-faint)]">/{landScore.maxScore}</span></span>
                  <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">{landScore.verdict}</span>
                  <span class="text-[10px] text-[var(--color-text-faint)]">confidence: {landScore.confidence}</span>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                  {landScore.factors.map((f) => (
                    <div key={f.id} class="flex items-center justify-between gap-2 py-0.5">
                      <span class="text-[11px] text-[var(--color-text-muted)]">{f.label}{f.dataGap && <span class="text-[var(--color-status-failed)]"> · data gap</span>}</span>
                      <span class="text-[11px] tabular-nums text-[var(--color-text)]">{f.points}/{f.maxPoints}</span>
                    </div>
                  ))}
                </div>
                <DdList title="Flags" items={landScore.flags} empty="No flags" />
              </div>
            )}
          </Section>

          {/* 3. Deal Economics */}
          <Section title="Deal Economics">
            <Field label="Estimated value (low)" />
            <Field label="Estimated value (mid)" />
            <Field label="Estimated value (high)" />
            <Field label="Current / last offer" />
            <Field label="Max offer" />
            <Field label="Projected net profit" />
            <Field label="Seller asking (negotiation context only)" value={deal.asking_price ?? undefined} />
            <div class="text-[10px] text-[var(--color-text-faint)] mt-2">
              Target-clear baseline: minimum ${MIN_NET_BASELINE_USD.toLocaleString()} net. Economics stay blocked until parcel is verified.
            </div>
          </Section>

          {/* 4. Land Data / DD Facts */}
          <Section title="Land Data / DD Facts">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6">
              <Field label="Acreage" value={prop?.acres ?? deal.combined_acreage ?? undefined} />
              <Field label="Zoning" value={prop?.zoning ?? undefined} />
              <Field label="Access" />
              <Field label="Utilities" />
              <Field label="Flood" />
              <Field label="Slope / topography" />
              <Field label="Wetlands / environmental" />
              <Field label="Taxes / liens" />
              <Field label="Soil / perc" />
              <Field label="Subdivision potential" />
            </div>
            <div class="mt-2">
              <div class="text-[11px] text-[var(--color-text-muted)] mb-1">Data gaps</div>
              {prop?.open_risks ? <span class="text-[12px] text-[var(--color-text)]">{prop.open_risks}</span> : <Placeholder text="No data gaps recorded yet" />}
            </div>
          </Section>

          {/* 4b. Due Diligence / Research worksheet — manual/local, labeled */}
          <Section title="Due Diligence / Research">
            {!ddEditing && (
              <>
                <div class="flex items-center justify-between mb-2">
                  <DdIdentityBadge status={dd?.parcelIdentityStatus} />
                  <button
                    type="button"
                    onClick={startDdEdit}
                    class="px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)]"
                  >
                    {dd?.exists ? 'Edit DD/Research' : 'Add DD/Research'}
                  </button>
                </div>
                {ddWarnings.length > 0 && (
                  <div class="mb-2 rounded-md border border-[var(--color-status-failed)] p-2 space-y-0.5">
                    {ddWarnings.map((w) => (
                      <div key={w} class="text-[11px] text-[var(--color-status-failed)]">{w}</div>
                    ))}
                  </div>
                )}
                {!dd?.exists && (
                  <div class="text-[12px] text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-lg p-3 mb-2">
                    No DD/Research data captured yet. Click <span class="text-[var(--color-accent)]">Add DD/Research</span> to enter parcel identity, land data, source links, data gaps, and risk flags. Saved to the local LandOS store.
                  </div>
                )}
                <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                  <LabeledField label="APN / Parcel ID" value={dd?.apn} confidence={dd?.apnLabel} />
                  <LabeledField label="County / State" value={[dd?.county, dd?.state].filter(Boolean).join(', ')} confidence={dd?.locationLabel} />
                  <LabeledField label="Acreage" value={dd?.acreage ?? undefined} confidence={dd?.acreageLabel} />
                  <LabeledField label="Zoning / land use" value={dd?.zoning} confidence={dd?.zoningLabel} />
                  <LabeledField label="Access" value={dd?.accessStatus} confidence={dd?.accessLabel} />
                  <LabeledField label="Utilities" value={dd?.utilitiesStatus} confidence={dd?.utilitiesLabel} />
                  <LabeledField label="Flood" value={dd?.floodStatus} confidence={dd?.floodLabel} />
                  <LabeledField label="Wetlands" value={dd?.wetlandsStatus} confidence={dd?.wetlandsLabel} />
                </div>
                <div class="mt-3">
                  <div class="text-[11px] text-[var(--color-text-muted)] mb-1">Road / frontage notes</div>
                  {dd?.roadFrontageNotes ? <span class="text-[12px] text-[var(--color-text)]">{dd.roadFrontageNotes}</span> : <Placeholder />}
                </div>
                <DdList title="Source links" items={(dd?.sourceLinks ?? []).map((l) => (l.label ? `${l.label} — ${l.url}` : l.url))} empty="No source links yet" />
                <DdList title="Data gaps" items={dd?.dataGaps ?? []} empty="No data gaps recorded yet" />
                <DdList title="Risk flags" items={dd?.riskFlags ?? []} empty="No risk flags recorded yet" />
                {dd?.notes && (
                  <div class="mt-3">
                    <div class="text-[11px] text-[var(--color-text-muted)] mb-1">Notes</div>
                    <span class="text-[12px] text-[var(--color-text)]">{dd.notes}</span>
                  </div>
                )}
                <div class="text-[10px] text-[var(--color-text-faint)] mt-3">
                  DD/Research is manual/local. Every fact carries a confidence label and is never shown as verified without a named source. Parcel identity comes from exact-source records only, never from imagery or coordinates.
                  {dd?.exists && dd.updatedAt ? <> Last updated {formatRelativeTime(dd.updatedAt)}{dd.updatedBy ? ` by ${dd.updatedBy}` : ''}.</> : null}
                </div>
              </>
            )}
            {ddEditing && ddForm && (
              <DdEditForm
                form={ddForm}
                setField={setDdField}
                onSave={() => void saveDd()}
                onCancel={() => { setDdEditing(false); setDdError(null); }}
                saving={ddSaving}
                error={ddError}
              />
            )}
          </Section>

          {/* 5. Contacts — every person/role on the deal (inherited leads -> heirs) */}
          <Section title="Contacts">
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
            {owner && seller && owner.name && seller.name && owner.name.trim().toLowerCase() !== seller.name.trim().toLowerCase() && (
              <div class="text-[11px] text-[var(--color-text-muted)] mt-2 border-t border-[var(--color-border)] pt-2">
                Owner on record: {owner.name} / Lead: {seller.name} — do not match (possible inherited/pre-transfer).
              </div>
            )}
            <div class="text-[10px] text-[var(--color-text-faint)] mt-2">
              Multiple names/roles per property are supported (e.g. inherited leads with several heirs). Contact data is local; no external CRM read/write.
            </div>
          </Section>

          {/* 6. Communication Summary — no external CRM mutation; GHL not connected */}
          <Section title="Communication Summary">
            <Field label="Last contact" />
            <Field label="Sentiment" />
            <Field label="Next follow-up" />
            <Field label="Timeline summary" />
            <div class="mt-2">
              <div class="text-[11px] text-[var(--color-text-muted)] mb-1">Key quotes</div>
              <Placeholder text="No quotes captured yet" />
            </div>
            <div class="text-[10px] text-[var(--color-text-faint)] mt-2">
              CRM / GHL link: not connected. No external CRM read or write in this view.
            </div>
          </Section>

          {/* 7. Exit Strategy Analysis */}
          <Section title="Exit Strategy Analysis">
            <Field label="Recommended strategy" value={deal.combined_strategy || undefined} />
            <div class="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
              {['Quick flip', 'Subdivide', 'Land-home package', 'Improved / value-add', 'Pass / no-offer'].map((s) => (
                <div key={s} class="rounded border border-dashed border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-muted)]">{s}</div>
              ))}
            </div>
            <div class="mt-2"><div class="text-[11px] text-[var(--color-text-muted)] mb-1">Blockers</div><Placeholder text="None recorded yet" /></div>
            <div class="mt-2"><div class="text-[11px] text-[var(--color-text-muted)] mb-1">Next confirmations</div><Placeholder /></div>
          </Section>

          {/* 7b. Strategy worksheet — manual/local, honest offer-readiness, distinct exits */}
          <Section title="Strategy">
            {!strategyEditing && (
              <>
                <div class="flex items-center justify-between mb-2">
                  <StrategyReadinessBadge status={strategy?.offerReadiness} />
                  <button
                    type="button"
                    onClick={startStrategyEdit}
                    class="px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)]"
                  >
                    {strategy?.exists ? 'Edit Strategy' : 'Add Strategy'}
                  </button>
                </div>
                {strategyWarnings.length > 0 && (
                  <div class="mb-2 rounded-md border border-[var(--color-status-failed)] p-2 space-y-0.5">
                    {strategyWarnings.map((w) => (
                      <div key={w} class="text-[11px] text-[var(--color-status-failed)]">{w}</div>
                    ))}
                  </div>
                )}
                {!strategy?.exists && (
                  <div class="text-[12px] text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-lg p-3 mb-2">
                    Strategy not reviewed yet. Click <span class="text-[var(--color-accent)]">Add Strategy</span> to capture candidates, a recommendation, the most viable exit, blockers, next confirmations, and per-strategy notes. Saved to the local LandOS store.
                  </div>
                )}
                <StrategyNote label="Current recommendation" value={strategy?.currentRecommendation} />
                <StrategyNote label="Most viable strategy" value={strategy?.mostViableStrategy} />
                <DdList title="Strategy candidates" items={strategy?.strategyCandidates ?? []} empty="No strategy candidates yet" />
                <DdList title="Blockers" items={strategy?.blockers ?? []} empty="No blockers recorded yet" />
                <DdList title="Next confirmations" items={strategy?.nextConfirmations ?? []} empty="No confirmations recorded yet" />
                <div class="mt-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Distinct exit notes</div>
                <StrategyNote label="Quick flip" value={strategy?.quickFlipNotes} />
                <StrategyNote label="Subdivide" value={strategy?.subdivideNotes} />
                <StrategyNote label="Land-home package" value={strategy?.landHomePackageNotes} />
                <StrategyNote label="Improved-property / mobile-home value-add" value={strategy?.improvedValueAddNotes} />
                <StrategyNote label="Teardown / land-only fallback" value={strategy?.teardownLandOnlyNotes} />
                <StrategyNote label="Pass / no-offer reason" value={strategy?.passNoOfferReason} />
                <StrategyNote label="Pre-call strategy notes" value={strategy?.preCallStrategyNotes} />
                <StrategyNote label="Risk-adjusted notes" value={strategy?.riskAdjustedNotes} />
                <StrategyNote label="Target profit note" value={strategy?.targetProfitNote} />
                {strategy?.notes && <StrategyNote label="Notes" value={strategy.notes} />}
                <div class="text-[10px] text-[var(--color-text-faint)] mt-3">
                  Strategy is manual/local analysis, never a verified fact and never a final offer. Exits stay distinct and no offer, comp, or EV is calculated here. Offer readiness defaults to Not reviewed until Tyler or a future strategy workflow advances it.
                  {strategy?.exists && strategy.updatedAt ? <> Last updated {formatRelativeTime(strategy.updatedAt)}{strategy.updatedBy ? ` by ${strategy.updatedBy}` : ''}.</> : null}
                </div>
              </>
            )}
            {strategyEditing && strategyForm && (
              <StrategyEditForm
                form={strategyForm}
                setField={setStrategyFieldFn}
                onSave={() => void saveStrategy()}
                onCancel={() => { setStrategyEditing(false); setStrategyError(null); }}
                saving={strategySaving}
                error={strategyError}
              />
            )}
          </Section>

          {/* 7c. Market Research worksheet — manual/local, market-level only, honest demand */}
          <Section title="Market Research">
            {!marketEditing && (
              <>
                <div class="flex items-center justify-between mb-2 gap-2">
                  <MarketDemandBadge label={market?.marketReviewStatus} prefix="Market review" />
                  <button
                    type="button"
                    onClick={startMarketEdit}
                    class="px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)]"
                  >
                    {market?.exists ? 'Edit Market Research' : 'Add Market Research'}
                  </button>
                </div>
                {marketWarnings.length > 0 && (
                  <div class="mb-2 rounded-md border border-[var(--color-status-failed)] p-2 space-y-0.5">
                    {marketWarnings.map((w) => (
                      <div key={w} class="text-[11px] text-[var(--color-status-failed)]">{w}</div>
                    ))}
                  </div>
                )}
                {!market?.exists && (
                  <div class="text-[12px] text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-lg p-3 mb-2">
                    Market not reviewed yet. Click <span class="text-[var(--color-accent)]">Add Market Research</span> to capture target area, demand notes, active/sold/days-on-market context, county growth notes, source links, data gaps, and risk flags. Market-level context only, saved to the local LandOS store.
                  </div>
                )}
                <MarketNote label="Target market / area" value={market?.targetAreaLabel} />
                <MarketNote label="County / city / region notes" value={market?.countyCityRegionNotes} />

                <div class="mt-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Demand (manual; never a comp or price)</div>
                <MarketDemandLane label="Local buyer demand" note={market?.buyerDemandNotes} demand={market?.buyerDemandLabel} />
                <MarketDemandLane label="Manufactured-home demand" note={market?.manufacturedHomeDemandNotes} demand={market?.manufacturedHomeDemandLabel} />
                <MarketDemandLane label="Subdivision demand" note={market?.subdivisionDemandNotes} demand={market?.subdivisionDemandLabel} />
                <MarketDemandLane label="Infill-lot demand" note={market?.infillLotDemandNotes} demand={market?.infillLotDemandLabel} />
                <MarketDemandLane label="Rural acreage demand" note={market?.ruralAcreageDemandNotes} demand={market?.ruralAcreageDemandLabel} />

                <div class="mt-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Listing / sold context (notes only; no comps computed)</div>
                <MarketNote label="Active listing notes" value={market?.activeListingNotes} />
                <MarketNote label="Sold comp context notes" value={market?.soldCompContextNotes} />
                <MarketNote label="Days-on-market notes" value={market?.daysOnMarketNotes} />

                <div class="mt-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Growth / planning &amp; exit support</div>
                <MarketNote label="County growth / planning notes" value={market?.countyGrowthPlanningNotes} />
                <MarketNote label="Exit strategy support notes" value={market?.exitStrategySupportNotes} />

                <div class="mt-3 flex items-center gap-2">
                  <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
                    Source confidence: {sourceConfidenceText(market?.sourceConfidence)}
                  </span>
                </div>
                <DdList title="Source links" items={(market?.sourceLinks ?? []).map((l) => (l.label ? `${l.label} — ${l.url}` : l.url))} empty="No source links yet" />
                <DdList title="Data gaps" items={market?.dataGaps ?? []} empty="No data gaps recorded yet" />
                <DdList title="Risk flags" items={market?.riskFlags ?? []} empty="No risk flags recorded yet" />
                {market?.notes && <MarketNote label="Notes" value={market.notes} />}
                <div class="text-[10px] text-[var(--color-text-faint)] mt-3">
                  Market Research is manual/local, market-level context only. It is separate from property-level DD and never verifies parcel identity. No comps, actives, solds, days-on-market, demand, or pricing are computed or fabricated; every demand level is a manual conclusion or stays Not reviewed / Needs research.
                  {market?.exists && market.updatedAt ? <> Last updated {formatRelativeTime(market.updatedAt)}{market.updatedBy ? ` by ${market.updatedBy}` : ''}.</> : null}
                </div>
              </>
            )}
            {marketEditing && marketForm && (
              <MarketEditForm
                form={marketForm}
                setField={setMarketFieldFn}
                onSave={() => void saveMarket()}
                onCancel={() => { setMarketEditing(false); setMarketError(null); }}
                saving={marketSaving}
                error={marketError}
              />
            )}
          </Section>

          {/* 8. Documents / Activity / Quick Actions */}
          <Section title="Documents / Activity / Quick Actions">
            <div class="text-[11px] text-[var(--color-text-muted)] mb-1">Documents</div>
            <Placeholder text="No documents attached yet" />
            <div class="text-[11px] text-[var(--color-text-muted)] mt-3 mb-1">Activity log</div>
            <Placeholder text="No activity recorded yet" />
            <div class="text-[11px] text-[var(--color-text-muted)] mt-3 mb-2">Quick actions (approval-gated)</div>
            <div class="flex flex-wrap gap-2">
              {['Make Offer', 'Schedule Follow-Up', 'Run Full Report', 'Change Stage', 'Push to CRM', 'Generate PDF'].map((a) => (
                <button
                  key={a}
                  type="button"
                  disabled
                  title="Approval-gated / not enabled in this view"
                  class="px-2.5 py-1 rounded-md text-[11px] border border-[var(--color-border)] text-[var(--color-text-faint)] opacity-60 cursor-not-allowed"
                >
                  {a}
                </button>
              ))}
            </div>
          </Section>

          {/* 9. Pre-Call Brief */}
          <Section title="Pre-Call Brief">
            <Field label="What the seller wants" />
            <Field label="Current max / walk-away" />
            <Field label="Motivation" />
            <Field label="Last thing the seller said" />
            <Field label="Critical data gaps" />
            <Field label="Best current strategy" value={deal.combined_strategy || undefined} />
            <Field label="Questions to ask next" />
            <Field label="What not to mention yet" />
          </Section>
            </div>
          </details>
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
