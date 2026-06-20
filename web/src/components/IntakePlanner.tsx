import { useState } from 'preact/hooks';
import { Send, RotateCcw, Search } from 'lucide-preact';
import { apiPost } from '@/lib/api';

// LandOS Intake / Orchestration panel. The dashboard-first entry into the
// read-only intake planner (/api/landos/intake). Manual dashboard text today;
// the SAME planner backs future voice transcript, Telegram text/voice, and CRM
// leads. This panel renders the returned WorkerDispatchPlan in an operator
// format — NOT raw giant JSON. It runs no agent, writes no DB row, calls no
// LandPortal/comp tool, and never fabricates market data. Auth comes only from
// the shared apiPost helper (which appends the dashboard session credential);
// this panel adds no custom auth logic.

// ── Plan contract (mirrors src/landos/intake-types.ts WorkerDispatchPlan) ──
interface Lane {
  lane: string;
  status: string;
  reason: string;
  route?: string;
  modelRouting?: { route: string; availability: string };
}
interface PersistenceTarget {
  key: string;
  label: string;
  source?: string;
  note?: string;
}
interface Plan {
  classification: {
    classification: string;
    parcelIdentity: string;
    reason: string;
    matched: string[];
  };
  dukeParcelVerification: Lane;
  marketResearch: Lane;
  strategy: Lane;
  underwriting: Lane;
  aceDiscoveryPrep: Lane;
  dealCardPersistence: Lane;
  voiceResponse: Lane;
  forgeRepair: Lane;
  forgeBuildInterview: Lane;
  agentKnowledgeRetrieval: Lane;
  interAgentCollaboration: Lane;
  futureDepartmentCapability: Lane;
  modelRouting: Lane;
  responseModePlan: {
    responseMode: string;
    voiceStatus: string;
    sttProviderStatus: string;
    ttsProviderStatus: string;
    voiceAdapter: string;
  };
  dealCardPersistencePlan: {
    dealCardPersistence: string;
    persistenceTargets: PersistenceTarget[];
    rule: string;
  };
  strategyUnderwritingPlan: {
    strategyStatus: string;
    underwritingStatus: string;
    finalStrategyStatus: string;
    missingFactsBlockingDecision: string[];
    feedbackLoopNote: string;
  };
  interAgentCollaborationPlan: {
    status: string;
    collaborationParticipants: string[];
    collaborationPurpose: string;
    allowedHandoffs: Array<{ from: string; to: string; passes: string }>;
    maxRounds: number;
    collaborationSummaryRequired: boolean;
    outputOwner: string;
  };
  dueDiligenceCapability: {
    operational: boolean;
    dukeActive: boolean;
    marketResearch: string;
    marketResearchReason: string;
  };
  departmentRegistrySummary: Array<{
    id: string;
    label: string;
    lifecycle: string;
    operational: boolean;
  }>;
  extensibilityNote: string;
  sourceAdapter: SourceAdapterPlan;
  executionMode: string;
}

// Sprint 6A: source-adapter registry + Market Pulse contract (read-only).
interface SourceAdapterPlan {
  onDemandScope: { allowed: string[]; bulkDatasetsForbidden: boolean; rule: string };
  adapterReadiness: Array<{
    id: string;
    label: string;
    kind: string;
    availability: string;
    canVerifyParcelIdentity: boolean;
    canProduceMarketPulse: boolean;
  }>;
  parcelFallbackLadder: Array<{ rank: number; adapterId: string; availability: string; role: string }>;
  landportalFailureFallbackPlan: Array<{ adapterId: string; status: string; reason: string; truthLabel: string }>;
  gisCutoff: { rule: string; conditions: string[]; preferAssessorOverGis: boolean };
  marketPulse: {
    eligible: boolean;
    status: string;
    areaScope: string;
    signalsCatalog: string[];
    truthLabel: string;
    reason: string;
    localAreaContextLabel?: string;
  };
  parcelVerification: {
    verificationStatus: string;
    parcelVerified: boolean;
    truthLabel: string;
    localAreaContextLabel?: string;
    dataGaps: string[];
  };
  sellerAsk: { sellerAskUsd?: number; label: string; usableForOfferRange: boolean; note: string };
  thirdPartySecurity: {
    thirdPartyCodeInstalled: boolean;
    thirdPartyCodeExecuted: boolean;
    thirdPartyCodeImportedOrVendored: boolean;
    policy: string;
    candidates: Array<{ name: string; purpose: string }>;
    securityReviewItems: string[];
  };
  note: string;
}

// Duke due diligence result contract.
interface DukePropertyData {
  sourceName: string;
  generatedAt: string;
  identity: {
    propertyId?: string; fips?: string; apn?: string; county?: string; state?: string;
    situsAddress?: string; owner?: string; mailingAddress?: string;
  };
  landFacts: {
    acres?: number; roadFrontageFt?: number; landLocked?: string; nearWater?: string;
    wetlandsPct?: number; femaPct?: number; buildabilityPct?: number; buildableAcres?: number;
    slopeAvgDeg?: number; buildingAreaSqft?: number; landUse?: string;
  };
  valuation: {
    assessedTotal?: number; assessedLand?: number; marketTotal?: number; marketLand?: number;
    tlpEstimate?: number; tlpPpa?: number; priceAcreCounty?: number;
  };
  similars: { count?: number; ppaMin?: number; ppaMax?: number; ppaMedian?: number; mostRecentYear?: string };
  similarSales: Array<{
    saleYear?: string; salePrice?: number; acres?: number; pricePerAcre?: number;
    apn?: string; propertyId?: string; addressOrCounty?: string;
  }>;
  similarRowsAvailable: boolean;
  dataGaps: string[];
  note: string;
}

interface DukeVerification {
  status: string;
  parcelVerified: boolean;
  verificationSource?: string;
  identity?: {
    apn?: string;
    fips?: string;
    propertyId?: string;
    situsAddress?: string;
    city?: string;
    county?: string;
    state?: string;
    owner?: string;
    acres?: number;
  };
  propertyData?: DukePropertyData;
  sourceAttempts: Array<{ source: string; status: string; reason: string; truthLabel: string }>;
  dataGaps: string[];
  nextAction?: string;
  localAreaContextLabel?: string;
  marketPulseEligible: boolean;
  strategyUnderwritingBlocked: boolean;
  summary: string;
}

interface DukeAnalysis {
  parcelVerified: boolean;
  strategyStatus: string;
  greenFlags: string[];
  redFlags: string[];
  anomalyFlags: string[];
  dataGaps: string[];
  strategyCandidates: Array<{ strategy: string; rationale: string }>;
  offerReadiness: { status: string; formulaSource: string; minNetProfitBaselineUsd: number; note: string };
  note: string;
}

interface AcePrep {
  status: string;
  questions: Array<{ category: string; question: string }>;
  note: string;
}

interface DealCardUpdatePlan {
  identityReference: { address?: string; apn?: string; ownerCountyState?: string; dealCardId?: number };
  matchStatus: string;
  matchReason: string;
  timeline: Array<{ eventType: string; label: string; truthLabel: string; summary: string; source?: string }>;
  memoryEntries: Array<{ key: string; truthLabel: string; value?: string; source?: string; note?: string }>;
  storageIntent: { willStoreNow: boolean; asLabels: string[]; reason: string };
  persistedNow: boolean;
  requiresMigration: boolean;
  migrationNote?: string;
  rule: string;
}

interface MarketPulseV1 {
  eligible: boolean;
  localArea: { city?: string; county?: string; state?: string; descriptor: string };
  parcelVerified: boolean;
  label: string;
  signals: Array<{
    signal: string;
    status: string;
    sourceName?: string;
    sourceUrl?: string;
    note: string;
    approvalNeeded?: string;
  }>;
  generatedAt: string;
  reason: string;
  disclaimer: string;
}

interface DukeVerificationResponse {
  verification: DukeVerification;
  dukeAnalysis: DukeAnalysis;
  acePrep: AcePrep;
  marketPulse: MarketPulseV1;
  dealCardUpdatePlan: DealCardUpdatePlan;
}

// Status label -> color treatment. Covers planned/blocked/not_available/
// not_applicable/supported/available plus the other contract statuses.
function statusClass(status: string): string {
  switch (status) {
    case 'planned':
    case 'supported':
    case 'available':
    case 'connected':
    case 'recommended':
    case 'verified_fact':
    case 'parcel_verified':
    case 'exact_match':
    case 'source_available':
    case 'ready_for_preliminary_review':
    case 'ready':
      return 'text-[var(--color-status-done)] border-[var(--color-status-done)]';
    case 'blocked':
    case 'unverified':
    case 'not_verified':
    case 'blocked_unverified_parcel':
      return 'text-[var(--color-status-failed)] border-[var(--color-status-failed)]';
    case 'not_available':
    case 'unsupported':
    case 'not_connected':
    case 'pass_no_offer':
    case 'data_gap':
    case 'timeout':
    case 'local_area_context_not_parcel_verified':
    case 'ambiguous_needs_clarification':
      return 'text-[var(--color-status-failed)] border-[color-mix(in_srgb,var(--color-status-failed)_40%,transparent)]';
    case 'requested':
    case 'pending':
    case 'seller_stated':
    case 'attempted_lookup':
    case 'needs_verification':
    case 'market_context':
    case 'create_new':
    case 'blocked_needs_more_data':
    case 'preliminary':
      return 'text-[var(--color-text)] border-[var(--color-border)]';
    case 'not_applicable':
    case 'not_requested':
    default: // not_applicable, not_requested, none, etc. — neutral
      return 'text-[var(--color-text-faint)] border-[var(--color-border)]';
  }
}

// Renders "label: value" or, when the source returned nothing, a dim data gap.
function Field({ label, value }: { label: string; value: string | number | undefined | null }) {
  const has = value !== undefined && value !== null && value !== '';
  return (
    <div class="text-[11px]">
      <span class="text-[var(--color-text-faint)]">{label}: </span>
      {has ? (
        <span class="text-[var(--color-text)]">{value}</span>
      ) : (
        <span class="text-[var(--color-text-faint)] italic">data gap</span>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span class={`text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap ${statusClass(status)}`}>
      {status}
    </span>
  );
}

// One worker lane row. Shows lane name, status badge, reason, optional route
// and intended task route (cost shown, not spent).
function LaneRow({ lane }: { lane: Lane }) {
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
      <div class="flex items-center gap-2">
        <span class="text-[12px] font-medium text-[var(--color-text)]">{lane.lane}</span>
        <span class="ml-auto"><StatusBadge status={lane.status} /></span>
      </div>
      <div class="text-[11px] text-[var(--color-text-muted)] mt-1">{lane.reason}</div>
      {(lane.route || lane.modelRouting) && (
        <div class="text-[10px] text-[var(--color-text-faint)] mt-1.5 font-mono flex flex-wrap gap-x-3 gap-y-0.5">
          {lane.route && <span>route: {lane.route}</span>}
          {lane.modelRouting && (
            <span>model: {lane.modelRouting.route} · {lane.modelRouting.availability}</span>
          )}
        </div>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: any }) {
  return (
    <h3 class="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">
      {children}
    </h3>
  );
}

export function IntakePlanner() {
  const [text, setText] = useState('');
  const [parcelVerified, setParcelVerified] = useState(false);
  const [showRegistry, setShowRegistry] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  // The exact text that produced the current plan. The Duke verification button
  // must act on THIS input (what the displayed plan represents), not whatever is
  // currently in the textarea — otherwise an edited/cleared textarea makes the
  // button silently do nothing.
  const [planText, setPlanText] = useState('');
  const [dukeLoading, setDukeLoading] = useState(false);
  const [dukeError, setDukeError] = useState<string | null>(null);
  const [duke, setDuke] = useState<DukeVerificationResponse | null>(null);

  async function run() {
    const trimmed = text.trim();
    if (!trimmed) {
      setError('Type a request first.');
      return;
    }
    try {
      setLoading(true);
      setError(null);
      // dashboard_text transport. Optional verified-parcel context lets the
      // operator see the Strategy/Underwriting gate flip. Never fabricated:
      // the checkbox sets a single boolean the planner reads.
      const body: Record<string, unknown> = { text: trimmed, transport: 'dashboard_text' };
      if (parcelVerified) body.context = { parcelVerified: true };
      const res = await apiPost<{ plan: Plan }>('/api/landos/intake', body);
      setPlan(res.plan);
      // Remember the input this plan was built from so the Duke button uses it.
      setPlanText(trimmed);
      // A fresh plan invalidates any prior Duke verification result.
      setDuke(null);
      setDukeError(null);
    } catch (err: any) {
      setError(err?.message || String(err));
      setPlan(null);
    } finally {
      setLoading(false);
    }
  }

  async function runDuke() {
    // Act on the text that produced the displayed plan; fall back to the live
    // textarea. Never silently no-op: an empty input shows a clear error.
    const input = (planText || text).trim();
    if (!input) {
      setDukeError('Run an intake plan first, then run Duke parcel verification.');
      setDuke(null);
      return;
    }
    try {
      setDukeLoading(true);
      setDukeError(null);
      const res = await apiPost<DukeVerificationResponse>('/api/landos/intake/duke-verification', { text: input });
      setDuke(res);
    } catch (err: any) {
      setDukeError(err?.message || String(err));
      setDuke(null);
    } finally {
      setDukeLoading(false);
    }
  }

  function reset() {
    setText('');
    setParcelVerified(false);
    setPlan(null);
    setPlanText('');
    setError(null);
    setDuke(null);
    setDukeError(null);
  }

  // Hard business rules surfaced as banners (the planner enforces them; the UI
  // makes them impossible to miss).
  const su = plan?.strategyUnderwritingPlan;
  const strategyBlocked = su?.strategyStatus === 'blocked' || su?.underwritingStatus === 'blocked';
  const marketUnavailable = plan?.marketResearch.status === 'not_available';

  return (
    <div class="flex-1 overflow-y-auto px-6 py-4 space-y-5">
      {/* ── Input ──────────────────────────────────────────────── */}
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4 space-y-3">
        <div class="text-[12px] text-[var(--color-text-muted)]">
          Type a normal LandOS request (address, APN + county, owner + county, a market question,
          a seller-prep ask, a Forge command, etc.). Returns the read-only orchestration plan only —
          no agent runs, no DB writes, no paid calls.
        </div>
        <textarea
          value={text}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          placeholder="e.g. Run due diligence on 123 Oak Rd, Lexington County SC"
          rows={3}
          class="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[13px] text-[var(--color-text)] resize-y focus:outline-none focus:border-[var(--color-text-faint)]"
        />
        <div class="flex items-center gap-3 flex-wrap">
          <label class="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] cursor-pointer">
            <input
              type="checkbox"
              checked={parcelVerified}
              onChange={(e) => setParcelVerified((e.target as HTMLInputElement).checked)}
            />
            Parcel identity already verified (prior Duke run)
          </label>
          <div class="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={reset}
              class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] text-[var(--color-text-muted)] border border-[var(--color-border)] hover:bg-[var(--color-elevated)]"
            >
              <RotateCcw size={12} /> Reset
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={run}
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium text-[var(--color-text)] border border-[var(--color-border)] bg-[var(--color-elevated)] hover:opacity-90 disabled:opacity-40"
            >
              <Send size={12} /> {loading ? 'Planning…' : 'Run intake plan'}
            </button>
          </div>
        </div>
      </div>

      {/* ── States ─────────────────────────────────────────────── */}
      {error && (
        <div class="border border-[color-mix(in_srgb,var(--color-status-failed)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-status-failed)_8%,transparent)] rounded-lg px-4 py-3">
          <div class="text-[var(--color-status-failed)] text-[12px] font-medium mb-0.5">Intake failed</div>
          <div class="text-[var(--color-text-muted)] text-[12px] font-mono">{error}</div>
        </div>
      )}

      {plan && (
        <div class="space-y-5">
          {/* When a Duke execution result exists, it is the current source of
              truth — make clear it supersedes the read-only plan status below. */}
          {duke && (
            <div class={`rounded-lg px-4 py-2.5 border ${
              duke.verification.parcelVerified
                ? 'border-[var(--color-status-done)] bg-[color-mix(in_srgb,var(--color-status-done)_8%,transparent)]'
                : 'border-[var(--color-border)] bg-[var(--color-elevated)]'
            }`}>
              <div class={`text-[12px] font-medium ${duke.verification.parcelVerified ? 'text-[var(--color-status-done)]' : 'text-[var(--color-text)]'}`}>
                {duke.verification.parcelVerified
                  ? 'Duke execution verified this parcel — the verified result below supersedes the read-only plan status.'
                  : 'Read-only plan shown. The Duke execution result below is the current result.'}
              </div>
            </div>
          )}

          {/* Guard banners — hard business rules from the READ-ONLY plan. Once a
              Duke execution result verifies the parcel, the stale "unverified"
              banner is suppressed so it cannot contradict the verified result. */}
          {strategyBlocked && !duke?.verification.parcelVerified && (
            <div class="border border-[color-mix(in_srgb,var(--color-status-failed)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-status-failed)_8%,transparent)] rounded-lg px-4 py-2.5">
              <div class="text-[var(--color-status-failed)] text-[12px] font-medium">
                Parcel unverified — Strategy and Underwriting are blocked
              </div>
              <div class="text-[var(--color-text-muted)] text-[11px] mt-0.5">
                No property-specific valuation, offer, or recommendation until parcel identity is verified by a named source.
                {su?.missingFactsBlockingDecision?.length ? ` Missing: ${su.missingFactsBlockingDecision.join(', ')}.` : ''}
              </div>
            </div>
          )}
          {marketUnavailable && (
            <div class="border border-[color-mix(in_srgb,var(--color-status-failed)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-status-failed)_8%,transparent)] rounded-lg px-4 py-2.5">
              <div class="text-[var(--color-status-failed)] text-[12px] font-medium">
                Market Research not_available
              </div>
              <div class="text-[var(--color-text-muted)] text-[11px] mt-0.5">{plan.marketResearch.reason}</div>
            </div>
          )}

          {/* Classification */}
          <div>
            <SectionTitle>Classification</SectionTitle>
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-[13px] font-semibold text-[var(--color-text)]">{plan.classification.classification}</span>
                <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)]">
                  parcel identity: {plan.classification.parcelIdentity}
                </span>
              </div>
              <div class="text-[11px] text-[var(--color-text-muted)] mt-1">{plan.classification.reason}</div>
              {plan.classification.matched.length > 0 && (
                <div class="text-[10px] text-[var(--color-text-faint)] mt-1 font-mono">
                  matched: {plan.classification.matched.join(', ')}
                </div>
              )}
            </div>
          </div>

          {/* Worker lanes */}
          <div>
            <SectionTitle>Worker lanes</SectionTitle>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              <LaneRow lane={plan.dukeParcelVerification} />
              <LaneRow lane={plan.marketResearch} />
              <LaneRow lane={plan.strategy} />
              <LaneRow lane={plan.underwriting} />
              <LaneRow lane={plan.aceDiscoveryPrep} />
              <LaneRow lane={plan.dealCardPersistence} />
              <LaneRow lane={plan.voiceResponse} />
              <LaneRow lane={plan.forgeRepair} />
              <LaneRow lane={plan.forgeBuildInterview} />
              <LaneRow lane={plan.agentKnowledgeRetrieval} />
              <LaneRow lane={plan.interAgentCollaboration} />
              <LaneRow lane={plan.modelRouting} />
            </div>
          </div>

          {/* Deal Card Persistence detail */}
          <div>
            <SectionTitle>Deal Card Persistence</SectionTitle>
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-2">
              <div class="flex items-center gap-2">
                <span class="text-[12px] text-[var(--color-text)]">status</span>
                <span class="ml-auto"><StatusBadge status={plan.dealCardPersistencePlan.dealCardPersistence} /></span>
              </div>
              {plan.dealCardPersistencePlan.persistenceTargets.length > 0 && (
                <div class="space-y-1.5">
                  {plan.dealCardPersistencePlan.persistenceTargets.map((t) => (
                    <div key={t.key} class="flex items-start gap-2 text-[11px]">
                      <span class="font-mono text-[var(--color-text-muted)] min-w-0 break-all">{t.key}</span>
                      <span class="ml-auto"><StatusBadge status={t.label} /></span>
                    </div>
                  ))}
                </div>
              )}
              <div class="text-[10px] text-[var(--color-text-faint)] border-t border-[var(--color-border)] pt-2">
                {plan.dealCardPersistencePlan.rule}
              </div>
            </div>
          </div>

          {/* Strategy / Underwriting feedback loop */}
          <div>
            <SectionTitle>Strategy ⇄ Underwriting</SectionTitle>
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-1.5">
              <div class="flex items-center gap-2 flex-wrap text-[11px]">
                <span>Strategy</span><StatusBadge status={su!.strategyStatus} />
                <span class="ml-2">Underwriting</span><StatusBadge status={su!.underwritingStatus} />
                <span class="ml-2">Final</span><StatusBadge status={su!.finalStrategyStatus} />
              </div>
              <div class="text-[10px] text-[var(--color-text-faint)]">{su!.feedbackLoopNote}</div>
            </div>
          </div>

          {/* Voice + Forge + Collaboration + Model + DD capability */}
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
              <SectionTitle>Voice Response</SectionTitle>
              <div class="flex items-center gap-2 text-[11px]">
                <span>mode: {plan.responseModePlan.responseMode}</span>
                <span class="ml-auto"><StatusBadge status={plan.voiceResponse.status} /></span>
              </div>
              <div class="text-[10px] text-[var(--color-text-faint)] mt-1 font-mono">
                STT: {plan.responseModePlan.sttProviderStatus} · TTS: {plan.responseModePlan.ttsProviderStatus}
              </div>
            </div>

            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
              <SectionTitle>Forge</SectionTitle>
              <div class="flex items-center gap-2 text-[11px]">
                <span>Repair</span><StatusBadge status={plan.forgeRepair.status} />
                <span class="ml-2">Build/Interview</span><StatusBadge status={plan.forgeBuildInterview.status} />
              </div>
            </div>

            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
              <SectionTitle>Inter-Agent Collaboration</SectionTitle>
              <div class="flex items-center gap-2 text-[11px]">
                <span>status</span>
                <span class="ml-auto"><StatusBadge status={plan.interAgentCollaborationPlan.status} /></span>
              </div>
              {plan.interAgentCollaborationPlan.collaborationParticipants.length > 0 && (
                <div class="text-[10px] text-[var(--color-text-faint)] mt-1">
                  {plan.interAgentCollaborationPlan.collaborationParticipants.join(' · ')}
                  {` · max ${plan.interAgentCollaborationPlan.maxRounds} rounds · owner ${plan.interAgentCollaborationPlan.outputOwner}`}
                </div>
              )}
            </div>

            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
              <SectionTitle>Model Routing</SectionTitle>
              <div class="text-[11px] text-[var(--color-text-muted)]">{plan.modelRouting.reason}</div>
              {plan.modelRouting.modelRouting && (
                <div class="text-[10px] text-[var(--color-text-faint)] mt-1 font-mono">
                  routing route: {plan.modelRouting.modelRouting.route} · {plan.modelRouting.modelRouting.availability}
                </div>
              )}
            </div>
          </div>

          {/* Source Adapters / Market Pulse (Sprint 6A) */}
          <div>
            <SectionTitle>Source Adapters / Market Pulse</SectionTitle>
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-3">
              {/* On-demand scope */}
              <div class="text-[10px] text-[var(--color-text-faint)]">
                On-demand only · {plan.sourceAdapter.onDemandScope.allowed.join(' · ')} · no bulk datasets / parcel warehouse
              </div>

              {/* Adapter readiness */}
              <div>
                <div class="text-[11px] font-medium text-[var(--color-text)] mb-1.5">Adapter readiness</div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                  {plan.sourceAdapter.adapterReadiness.map((a) => (
                    <div key={a.id} class="flex items-center gap-2 text-[11px]">
                      <span class="text-[var(--color-text-muted)] truncate">{a.label}</span>
                      <span class="ml-auto"><StatusBadge status={a.availability} /></span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Parcel verification fallback ladder */}
              <div>
                <div class="text-[11px] font-medium text-[var(--color-text)] mb-1.5">Parcel verification fallback ladder</div>
                <ol class="space-y-1">
                  {plan.sourceAdapter.parcelFallbackLadder.map((l) => (
                    <li key={l.adapterId} class="flex items-center gap-2 text-[11px]">
                      <span class="font-mono text-[var(--color-text-faint)]">{l.rank}.</span>
                      <span class="text-[var(--color-text-muted)]">{l.role}</span>
                      <span class="ml-auto"><StatusBadge status={l.availability} /></span>
                    </li>
                  ))}
                </ol>
                <div class="text-[10px] text-[var(--color-text-faint)] mt-1.5">
                  LandPortal fails → {plan.sourceAdapter.landportalFailureFallbackPlan.map((s) => s.adapterId).join(' → ')} → stop if still unverified.
                </div>
              </div>

              {/* Parcel verification status / label */}
              <div class="flex items-center gap-2 text-[11px] flex-wrap">
                <span class="text-[var(--color-text)]">Parcel verification</span>
                <StatusBadge status={plan.sourceAdapter.parcelVerification.verificationStatus} />
                {plan.sourceAdapter.parcelVerification.localAreaContextLabel && (
                  <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[color-mix(in_srgb,var(--color-status-failed)_40%,transparent)] text-[var(--color-status-failed)]">
                    {plan.sourceAdapter.parcelVerification.localAreaContextLabel}
                  </span>
                )}
              </div>

              {/* GIS cutoff */}
              <div class="border-t border-[var(--color-border)] pt-2">
                <div class="text-[11px] font-medium text-[var(--color-text)]">GIS cutoff rule</div>
                <div class="text-[10px] text-[var(--color-text-faint)] mt-0.5">{plan.sourceAdapter.gisCutoff.rule}</div>
              </div>

              {/* Market Pulse */}
              <div class="border-t border-[var(--color-border)] pt-2">
                <div class="flex items-center gap-2 text-[11px]">
                  <span class="text-[var(--color-text)]">Market Pulse</span>
                  <span class="text-[var(--color-text-faint)]">({plan.sourceAdapter.marketPulse.areaScope})</span>
                  <span class="ml-auto"><StatusBadge status={plan.sourceAdapter.marketPulse.status} /></span>
                </div>
                <div class="text-[10px] text-[var(--color-text-faint)] mt-0.5">{plan.sourceAdapter.marketPulse.reason}</div>
                {plan.sourceAdapter.marketPulse.localAreaContextLabel && (
                  <div class="text-[10px] text-[var(--color-status-failed)] mt-0.5">
                    {plan.sourceAdapter.marketPulse.localAreaContextLabel} · separate from parcel verification
                  </div>
                )}
                <div class="text-[10px] text-[var(--color-text-faint)] mt-1 font-mono break-words">
                  signals: {plan.sourceAdapter.marketPulse.signalsCatalog.join(', ')}
                </div>
              </div>

              {/* Seller ask */}
              <div class="border-t border-[var(--color-border)] pt-2">
                <div class="flex items-center gap-2 text-[11px]">
                  <span class="text-[var(--color-text)]">Seller ask</span>
                  <StatusBadge status={plan.sourceAdapter.sellerAsk.label} />
                  <span class="text-[10px] text-[var(--color-text-faint)]">never anchors the calculated offer range</span>
                </div>
              </div>

              {/* Open-source / third-party security */}
              <div class="border-t border-[var(--color-border)] pt-2">
                <div class="flex items-center gap-2 text-[11px]">
                  <span class="text-[var(--color-text)]">Third-party / open-source</span>
                  <span class="ml-auto">
                    <StatusBadge status={plan.sourceAdapter.thirdPartySecurity.thirdPartyCodeInstalled ? 'blocked' : 'not_connected'} />
                  </span>
                </div>
                <div class="text-[10px] text-[var(--color-text-faint)] mt-0.5">
                  No third-party code installed or executed. Candidates are report-only and require Tyler approval + security review.
                </div>
                {plan.sourceAdapter.thirdPartySecurity.candidates.length > 0 && (
                  <div class="text-[10px] text-[var(--color-text-faint)] mt-1">
                    candidates: {plan.sourceAdapter.thirdPartySecurity.candidates.map((c) => c.name).join(' · ')}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Department registry summary — expandable */}
          <div>
            <SectionTitle>Department Registry</SectionTitle>
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
              <button
                type="button"
                onClick={() => setShowRegistry((v) => !v)}
                class="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                {showRegistry ? 'Hide' : 'Show'} {plan.departmentRegistrySummary.length} departments
              </button>
              {showRegistry && (
                <div class="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                  {plan.departmentRegistrySummary.map((d) => (
                    <div key={d.id} class="flex items-center gap-2 text-[11px]">
                      <span class="text-[var(--color-text)]">{d.label}</span>
                      <span class="ml-auto"><StatusBadge status={d.operational ? 'available' : d.lifecycle} /></span>
                    </div>
                  ))}
                </div>
              )}
              <div class="text-[10px] text-[var(--color-text-faint)] mt-2 border-t border-[var(--color-border)] pt-2">
                {plan.extensibilityNote}
              </div>
            </div>
          </div>

          {/* Execution mode */}
          <div class="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
            <span>Execution mode</span>
            <StatusBadge status={plan.executionMode} />
            <span class="text-[var(--color-text-faint)]">read-only plan — nothing executed, stored, or charged.</span>
          </div>

          {/* ── Duke Execution Bridge (Sprint 6B/6C) ───────────────────── */}
          <div class="border-t border-[var(--color-border)] pt-4">
            <div class="flex items-center gap-3 flex-wrap">
              <SectionTitle>Duke Parcel Verification</SectionTitle>
              <button
                type="button"
                disabled={dukeLoading}
                onClick={() => void runDuke()}
                class="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium text-[var(--color-text)] border border-[var(--color-border)] bg-[var(--color-elevated)] hover:opacity-90 disabled:opacity-40"
              >
                <Search size={12} /> {dukeLoading ? 'Verifying…' : 'Run Duke parcel verification'}
              </button>
            </div>
            <div class="text-[10px] text-[var(--color-text-faint)] mb-2">
              Runs the safe Duke verification path only (bounded LandPortal exact lookup). No comp credit, no GIS scraping, no CRM writes.
            </div>

            {dukeLoading && (
              <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-2.5 text-[12px] text-[var(--color-text-muted)]">
                Running Duke parcel verification… bounded LandPortal exact lookup, this can take a moment.
              </div>
            )}

            {dukeError && !dukeLoading && (
              <div class="border border-[color-mix(in_srgb,var(--color-status-failed)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-status-failed)_8%,transparent)] rounded-lg px-4 py-2.5">
                <div class="text-[var(--color-status-failed)] text-[12px] font-medium mb-0.5">Verification failed</div>
                <div class="text-[var(--color-text-muted)] text-[12px] font-mono">{dukeError}</div>
              </div>
            )}

            {duke && !dukeLoading && (
              <div class="space-y-3">
                {/* Verification header */}
                <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-2">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-[12px] font-semibold text-[var(--color-text)]">Duke Due Diligence Result</span>
                    <StatusBadge status={duke.verification.status} />
                    {duke.verification.localAreaContextLabel && (
                      <span class="text-[10px] px-1.5 py-0.5 rounded-full border border-[color-mix(in_srgb,var(--color-status-failed)_40%,transparent)] text-[var(--color-status-failed)]">
                        {duke.verification.localAreaContextLabel}
                      </span>
                    )}
                  </div>
                  <div class="text-[11px] text-[var(--color-text-muted)]">{duke.verification.summary}</div>

                  {/* Next required identifier / action when not verified */}
                  {!duke.verification.parcelVerified && duke.verification.nextAction && (
                    <div class="text-[11px] text-[var(--color-text)] border-t border-[var(--color-border)] pt-2">
                      <span class="text-[var(--color-text-faint)]">Next: </span>{duke.verification.nextAction}
                    </div>
                  )}

                  {/* Gate echo */}
                  {duke.verification.strategyUnderwritingBlocked && (
                    <div class="text-[10px] text-[var(--color-status-failed)] border-t border-[var(--color-border)] pt-2">
                      Strategy and Underwriting blocked — no valuation, scoring, or offer until parcel identity is verified by a named source.
                    </div>
                  )}

                  {/* Source attempts */}
                  {duke.verification.sourceAttempts.length > 0 && (
                    <div class="border-t border-[var(--color-border)] pt-2">
                      <div class="text-[10px] text-[var(--color-text-faint)] mb-1">Source attempts</div>
                      {duke.verification.sourceAttempts.map((a, i) => (
                        <div key={i} class="flex items-start gap-2 text-[11px]">
                          <div class="flex-1 min-w-0">
                            <span class="text-[var(--color-text-muted)]">{a.source}</span>
                            <div class="text-[10px] text-[var(--color-text-faint)]">{a.reason}</div>
                          </div>
                          <span class="ml-auto"><StatusBadge status={a.status} /></span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ── Verified property data (LandPortal, non-comp) ───────── */}
                {duke.verification.parcelVerified && duke.verification.propertyData && (
                  <>
                    {/* Identity & owner */}
                    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-2">
                      <div class="flex items-center gap-2">
                        <span class="text-[12px] font-semibold text-[var(--color-text)]">Identity &amp; Owner</span>
                        <span class="ml-auto text-[10px] text-[var(--color-text-faint)]">
                          Source: {duke.verification.propertyData.sourceName} · {duke.verification.propertyData.generatedAt}
                        </span>
                      </div>
                      <div class="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-0.5">
                        <Field label="Property ID" value={duke.verification.propertyData.identity.propertyId} />
                        <Field label="FIPS" value={duke.verification.propertyData.identity.fips} />
                        <Field label="APN" value={duke.verification.propertyData.identity.apn} />
                        <Field label="County" value={duke.verification.propertyData.identity.county} />
                        <Field label="State" value={duke.verification.propertyData.identity.state} />
                        <Field label="Situs" value={duke.verification.propertyData.identity.situsAddress} />
                        <Field label="Owner" value={duke.verification.propertyData.identity.owner} />
                        <Field label="Mailing" value={duke.verification.propertyData.identity.mailingAddress} />
                      </div>
                    </div>

                    {/* Property facts */}
                    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-2">
                      <span class="text-[12px] font-semibold text-[var(--color-text)]">Property Facts</span>
                      <div class="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-0.5">
                        <Field label="Acres" value={duke.verification.propertyData.landFacts.acres} />
                        <Field label="Road frontage (ft)" value={duke.verification.propertyData.landFacts.roadFrontageFt} />
                        <Field label="Landlocked" value={duke.verification.propertyData.landFacts.landLocked} />
                        <Field label="Near water" value={duke.verification.propertyData.landFacts.nearWater} />
                        <Field label="Wetlands %" value={duke.verification.propertyData.landFacts.wetlandsPct} />
                        <Field label="FEMA %" value={duke.verification.propertyData.landFacts.femaPct} />
                        <Field label="Buildability %" value={duke.verification.propertyData.landFacts.buildabilityPct} />
                        <Field label="Buildable acres" value={duke.verification.propertyData.landFacts.buildableAcres} />
                        <Field label="Slope avg (°)" value={duke.verification.propertyData.landFacts.slopeAvgDeg} />
                        <Field label="Structures (sqft)" value={duke.verification.propertyData.landFacts.buildingAreaSqft} />
                        <Field label="Land use" value={duke.verification.propertyData.landFacts.landUse} />
                      </div>
                    </div>

                    {/* Valuation */}
                    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-2">
                      <span class="text-[12px] font-semibold text-[var(--color-text)]">Valuation (LandPortal)</span>
                      <div class="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-0.5">
                        <Field label="Assessed total" value={duke.verification.propertyData.valuation.assessedTotal} />
                        <Field label="Assessed land" value={duke.verification.propertyData.valuation.assessedLand} />
                        <Field label="Market total" value={duke.verification.propertyData.valuation.marketTotal} />
                        <Field label="Market land" value={duke.verification.propertyData.valuation.marketLand} />
                        <Field label="TLP estimate" value={duke.verification.propertyData.valuation.tlpEstimate} />
                        <Field label="TLP $/acre" value={duke.verification.propertyData.valuation.tlpPpa} />
                        <Field label="County $/acre" value={duke.verification.propertyData.valuation.priceAcreCounty} />
                      </div>
                      <div class="text-[10px] text-[var(--color-text-faint)] border-t border-[var(--color-border)] pt-2">
                        Valuation fields are as returned by LandPortal. Not an offer; offer math requires a selected strategy + costs/risk.
                      </div>
                    </div>

                    {/* Embedded similar sales (no comp credit) */}
                    {((typeof duke.verification.propertyData.similars.count === 'number' && duke.verification.propertyData.similars.count > 0) || duke.verification.propertyData.similarRowsAvailable) && (
                      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-2">
                        <span class="text-[12px] font-semibold text-[var(--color-text)]">Similar Sales / Embedded Comps (no comp credit)</span>
                        <div class="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-0.5">
                          <Field label="Count" value={duke.verification.propertyData.similars.count} />
                          <Field label="$/acre min" value={duke.verification.propertyData.similars.ppaMin} />
                          <Field label="$/acre median" value={duke.verification.propertyData.similars.ppaMedian} />
                          <Field label="$/acre max" value={duke.verification.propertyData.similars.ppaMax} />
                          <Field label="Most recent year" value={duke.verification.propertyData.similars.mostRecentYear} />
                        </div>

                        {duke.verification.propertyData.similarRowsAvailable ? (
                          <div class="border-t border-[var(--color-border)] pt-2 space-y-1">
                            <div class="text-[10px] text-[var(--color-text-faint)]">Individual rows · source: LandPortal property_data embedded similar sales</div>
                            {/* Header row */}
                            <div class="grid grid-cols-6 gap-x-2 text-[9px] text-[var(--color-text-faint)] uppercase tracking-wide">
                              <span>Year</span><span>Price</span><span>$/acre</span><span>Acres</span><span>APN</span><span>Prop ID</span>
                            </div>
                            {duke.verification.propertyData.similarSales.map((row, i) => (
                              <div key={i} class="grid grid-cols-6 gap-x-2 text-[11px] text-[var(--color-text)]">
                                <span>{row.saleYear ?? '—'}</span>
                                <span>{typeof row.salePrice === 'number' ? `$${row.salePrice.toLocaleString()}` : '—'}</span>
                                <span>{typeof row.pricePerAcre === 'number' ? `$${Math.round(row.pricePerAcre).toLocaleString()}` : '—'}</span>
                                <span>{row.acres ?? '—'}</span>
                                <span class="truncate">{row.apn ?? '—'}</span>
                                <span class="truncate">{row.propertyId ?? '—'}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div class="text-[10px] text-[var(--color-text-faint)] border-t border-[var(--color-border)] pt-2">
                            Only aggregate embedded similar-sales stats were returned by non-comp LandPortal property_data. Individual comp rows require an approved comp report credit or another approved source.
                          </div>
                        )}
                      </div>
                    )}

                    {/* Data gaps from the source */}
                    {duke.verification.propertyData.dataGaps.length > 0 && (
                      <div class="text-[10px] text-[var(--color-text-faint)] font-mono">
                        data gaps: {duke.verification.propertyData.dataGaps.join(', ')}
                      </div>
                    )}
                  </>
                )}

                {/* ── Duke analysis (flags + strategy readiness) ─────────── */}
                <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-2">
                  <div class="flex items-center gap-2">
                    <span class="text-[12px] font-semibold text-[var(--color-text)]">Strategy / Underwriting Readiness</span>
                    <span class="ml-auto"><StatusBadge status={duke.dukeAnalysis.strategyStatus} /></span>
                  </div>
                  {duke.dukeAnalysis.greenFlags.length > 0 && (
                    <div class="text-[11px]"><span class="text-[var(--color-status-done)]">Green flags:</span> {duke.dukeAnalysis.greenFlags.join(' · ')}</div>
                  )}
                  {duke.dukeAnalysis.redFlags.length > 0 && (
                    <div class="text-[11px]"><span class="text-[var(--color-status-failed)]">Red flags:</span> {duke.dukeAnalysis.redFlags.join(' · ')}</div>
                  )}
                  {duke.dukeAnalysis.anomalyFlags.length > 0 && (
                    <div class="text-[11px] text-[var(--color-text-muted)]">Anomalies: {duke.dukeAnalysis.anomalyFlags.join(' · ')}</div>
                  )}
                  {duke.dukeAnalysis.strategyCandidates.length > 0 && (
                    <div class="border-t border-[var(--color-border)] pt-2">
                      <div class="text-[10px] text-[var(--color-text-faint)] mb-1">Likely strategy candidates</div>
                      <div class="space-y-1">
                        {duke.dukeAnalysis.strategyCandidates.map((s, i) => (
                          <div key={i} class="text-[11px]">
                            <span class="text-[var(--color-text)]">{s.strategy}</span>
                            <span class="text-[var(--color-text-faint)]"> — {s.rationale}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div class="text-[10px] text-[var(--color-text-faint)] border-t border-[var(--color-border)] pt-2">
                    Offer readiness: {duke.dukeAnalysis.offerReadiness.status} · min net profit baseline ${duke.dukeAnalysis.offerReadiness.minNetProfitBaselineUsd.toLocaleString()}. {duke.dukeAnalysis.offerReadiness.note}
                  </div>
                  <div class="text-[10px] text-[var(--color-text-muted)]">{duke.dukeAnalysis.note}</div>
                </div>

                {/* ── Ace seller discovery prep ──────────────────────────── */}
                <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-2">
                  <div class="flex items-center gap-2">
                    <span class="text-[12px] font-semibold text-[var(--color-text)]">Ace Seller Discovery Prep</span>
                    <span class="ml-auto"><StatusBadge status={duke.acePrep.status} /></span>
                  </div>
                  <div class="space-y-1">
                    {duke.acePrep.questions.map((q, i) => (
                      <div key={i} class="text-[11px]">
                        <span class="text-[var(--color-text-faint)]">{q.category}: </span>
                        <span class="text-[var(--color-text)]">{q.question}</span>
                      </div>
                    ))}
                  </div>
                  <div class="text-[10px] text-[var(--color-text-faint)] border-t border-[var(--color-border)] pt-2">{duke.acePrep.note}</div>
                </div>

                {/* Deal Card Update / Timeline Plan */}
                <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-2">
                  <div class="flex items-center gap-2">
                    <span class="text-[12px] font-semibold text-[var(--color-text)]">Deal Card Update Plan</span>
                    <span class="ml-auto"><StatusBadge status={duke.dealCardUpdatePlan.matchStatus} /></span>
                  </div>
                  <div class="text-[10px] text-[var(--color-text-faint)]">{duke.dealCardUpdatePlan.matchReason}</div>

                  <div class="space-y-1.5">
                    {duke.dealCardUpdatePlan.timeline.map((t, i) => (
                      <div key={i} class="flex items-start gap-2 text-[11px]">
                        <span class="text-[var(--color-text-muted)] flex-1 min-w-0">{t.label}</span>
                        <span class="ml-auto"><StatusBadge status={t.truthLabel} /></span>
                      </div>
                    ))}
                  </div>

                  <div class="text-[10px] text-[var(--color-text-faint)] border-t border-[var(--color-border)] pt-2">
                    {duke.dealCardUpdatePlan.rule}
                  </div>
                  {duke.dealCardUpdatePlan.requiresMigration && (
                    <div class="text-[10px] text-[var(--color-text-faint)]">
                      Not persisted this sprint. {duke.dealCardUpdatePlan.migrationNote}
                    </div>
                  )}
                </div>

                {/* Market Pulse v1 — separate local-area panel. Never verifies
                    the parcel; never fabricates market numbers. */}
                <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 space-y-2">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-[12px] font-semibold text-[var(--color-text)]">Market Pulse v1</span>
                    {duke.marketPulse.localArea.descriptor && (
                      <span class="text-[var(--color-text-faint)] text-[11px]">({duke.marketPulse.localArea.descriptor})</span>
                    )}
                    <span class="ml-auto text-[10px] px-1.5 py-0.5 rounded-full border border-[color-mix(in_srgb,var(--color-status-failed)_40%,transparent)] text-[var(--color-status-failed)]">
                      {duke.marketPulse.label}
                    </span>
                  </div>
                  <div class="text-[10px] text-[var(--color-text-faint)]">{duke.marketPulse.reason}</div>

                  {!duke.marketPulse.eligible ? (
                    <div class="text-[11px] text-[var(--color-text-muted)]">
                      Not eligible: provide city + state or county + state for local-area context.
                    </div>
                  ) : (
                    <div class="space-y-1.5">
                      {duke.marketPulse.signals.map((s, i) => (
                        <div key={i} class="flex items-start gap-2 text-[11px]">
                          <div class="flex-1 min-w-0">
                            <div class="text-[var(--color-text-muted)]">{s.signal}</div>
                            {s.sourceUrl ? (
                              <a
                                href={s.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                class="text-[10px] text-[var(--color-text-faint)] underline break-all"
                              >
                                {s.sourceName || s.sourceUrl}
                              </a>
                            ) : (
                              <div class="text-[10px] text-[var(--color-text-faint)]">
                                {s.approvalNeeded || s.note}
                              </div>
                            )}
                          </div>
                          <span class="ml-auto"><StatusBadge status={s.status} /></span>
                        </div>
                      ))}
                    </div>
                  )}

                  {duke.marketPulse.disclaimer && (
                    <div class="text-[10px] text-[var(--color-text-faint)] border-t border-[var(--color-border)] pt-2">
                      {duke.marketPulse.disclaimer}
                    </div>
                  )}
                  <div class="text-[9px] text-[var(--color-text-faint)] font-mono">
                    generated {duke.marketPulse.generatedAt}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
