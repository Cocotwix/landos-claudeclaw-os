import { useState } from 'preact/hooks';
import { Send, RotateCcw } from 'lucide-preact';
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
  modelRouting?: { tier: string; availability: string };
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

// Status label -> color treatment. Covers planned/blocked/not_available/
// not_applicable/supported/available plus the other contract statuses.
function statusClass(status: string): string {
  switch (status) {
    case 'planned':
    case 'supported':
    case 'available':
    case 'connected':
    case 'recommended':
      return 'text-[var(--color-status-done)] border-[var(--color-status-done)]';
    case 'blocked':
      return 'text-[var(--color-status-failed)] border-[var(--color-status-failed)]';
    case 'not_available':
    case 'unsupported':
    case 'not_connected':
    case 'pass_no_offer':
      return 'text-[var(--color-status-failed)] border-[color-mix(in_srgb,var(--color-status-failed)_40%,transparent)]';
    case 'requested':
    case 'pending':
      return 'text-[var(--color-text)] border-[var(--color-border)]';
    case 'not_applicable':
    case 'not_requested':
    default: // not_applicable, not_requested, none, etc. — neutral
      return 'text-[var(--color-text-faint)] border-[var(--color-border)]';
  }
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span class={`text-[10px] px-1.5 py-0.5 rounded-full border whitespace-nowrap ${statusClass(status)}`}>
      {status}
    </span>
  );
}

// One worker lane row. Shows lane name, status badge, reason, optional route
// and intended model tier (cost shown, not spent).
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
            <span>model: {lane.modelRouting.tier} · {lane.modelRouting.availability}</span>
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
    } catch (err: any) {
      setError(err?.message || String(err));
      setPlan(null);
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setText('');
    setParcelVerified(false);
    setPlan(null);
    setError(null);
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
          {/* Guard banners — hard business rules made visible */}
          {strategyBlocked && (
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
                  routing tier: {plan.modelRouting.modelRouting.tier} · {plan.modelRouting.modelRouting.availability}
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
        </div>
      )}
    </div>
  );
}
