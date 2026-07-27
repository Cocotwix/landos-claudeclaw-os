// Mission graph — the operator read of one parent mission and its children.
//
// What this panel must always show honestly:
//   • The parent NEVER reads as finished while a child is still outstanding.
//   • Every child is listed with its own state, even when it failed, blocked or
//     was skipped. A missing contribution is never hidden behind the successes.
//   • The parent outcome sentence names exactly what is missing and why.

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { apiGet, apiPost } from '../lib/api';

export type MissionChildStatusView =
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial'
  | 'rejected'
  | 'failed'
  | 'blocked'
  | 'skipped'
  | 'cancelled';

export type MissionStatusView = 'running' | 'joined' | 'joined_with_gaps' | 'blocked' | 'failed';

export type MissionAcceptanceStateView =
  | 'accepted'
  | 'incomplete'
  | 'blocked'
  | 'rejected'
  | 'failed'
  | 'not_evaluated';

export interface MissionAcceptanceCheckView {
  id: string;
  requirement: string;
  severity: 'required' | 'expected';
  passed: boolean;
  detail: string;
}

export interface MissionAcceptanceView {
  state: MissionAcceptanceStateView;
  reason: string;
  checks: MissionAcceptanceCheckView[];
}

export interface MissionProviderView {
  mode: 'deterministic' | 'model_routed';
  providerId: string | null;
  providerLabel: string | null;
  modelId: string | null;
  environmentId: string | null;
  source: string;
  available: boolean;
  liveRouting: boolean;
  reason: string;
}

export interface MissionChildView {
  key: string;
  label: string;
  purpose: string;
  role: 'required' | 'supporting';
  dependsOn: string[];
  /** The parent mission this child belongs to. */
  missionId: string;
  group: string;
  assignedRole: string;
  agentKey: string | null;
  agentName: string;
  agentGroup: string | null;
  agentRole: string | null;
  implAgentId: string | null;
  /** Where this child's handback belongs on the parent. */
  contributionSlot: string;
  acceptance: MissionAcceptanceView | null;
  provider: MissionProviderView | null;
  status: MissionChildStatusView;
  summary: string;
  failureCategory: string | null;
  failureMessage: string | null;
  retryable: boolean;
  result: unknown;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  attempt: number;
}

export interface MissionGapView {
  key: string;
  label: string;
  role: 'required' | 'supporting';
  status: MissionChildStatusView;
  acceptanceState: MissionAcceptanceStateView;
  group: string;
  agentName: string;
  failureCategory: string | null;
  reason: string;
}

export interface MissionRouteView {
  childKey: string;
  childLabel: string;
  group: string;
  assignedRole: string;
  agentKey: string | null;
  agentName: string;
  slot: string;
  acceptanceState: MissionAcceptanceStateView;
  routed: boolean;
  note: string;
}

export interface MissionJoinView {
  status: MissionStatusView;
  contributions: Record<string, unknown>;
  contributionsBySlot: Record<string, unknown>;
  routing: MissionRouteView[];
  contributed: string[];
  accepted: string[];
  incomplete: string[];
  gaps: MissionGapView[];
  requiredGaps: MissionGapView[];
  outstanding: MissionGapView[];
  allTerminal: boolean;
  allRequiredTerminal: boolean;
  allRequiredAccepted: boolean;
  outcome: string;
}

export interface MissionGraphView {
  label: string;
  kind: string;
  mission: {
    missionId: string;
    sequence: number;
    status: MissionStatusView;
    trigger: string;
    outcome: string | null;
    startedAt: string;
    completedAt: string | null;
    error: string | null;
    failureCategory: string | null;
  } | null;
  children: MissionChildView[];
  join: MissionJoinView | null;
  history: Array<{ missionId: string; sequence: number; status: string; startedAt: string; completedAt: string | null }>;
}

const CHILD_TONE: Record<MissionChildStatusView, string> = {
  queued: 'border-zinc-500/40 text-zinc-400',
  running: 'border-sky-500/40 text-sky-400',
  completed: 'border-emerald-500/40 text-emerald-400',
  partial: 'border-amber-500/40 text-amber-400',
  // Ran, but the result was not acceptable. Deliberately NOT the same tone as a
  // pass: a rejected lane must never read as a success at a glance.
  rejected: 'border-rose-500/40 text-rose-400',
  failed: 'border-rose-500/40 text-rose-400',
  blocked: 'border-orange-500/40 text-orange-400',
  skipped: 'border-zinc-500/40 text-zinc-400',
  cancelled: 'border-zinc-500/40 text-zinc-400',
};

const ACCEPTANCE_TONE: Record<MissionAcceptanceStateView, string> = {
  accepted: 'border-emerald-500/40 text-emerald-400',
  incomplete: 'border-amber-500/40 text-amber-400',
  blocked: 'border-orange-500/40 text-orange-400',
  rejected: 'border-rose-500/40 text-rose-400',
  failed: 'border-rose-500/40 text-rose-400',
  not_evaluated: 'border-zinc-500/40 text-zinc-400',
};

const ACCEPTANCE_LABEL: Record<MissionAcceptanceStateView, string> = {
  accepted: 'accepted',
  incomplete: 'incomplete',
  blocked: 'blocked',
  rejected: 'rejected',
  failed: 'failed',
  not_evaluated: 'not evaluated',
};

const MISSION_TONE: Record<MissionStatusView, string> = {
  running: 'border-sky-500/40 text-sky-400',
  joined: 'border-emerald-500/40 text-emerald-400',
  joined_with_gaps: 'border-amber-500/40 text-amber-400',
  blocked: 'border-orange-500/40 text-orange-400',
  failed: 'border-rose-500/40 text-rose-400',
};

/** Never trust an unrecognized state to index a lookup: an unknown acceptance
 *  state reads as "not evaluated", which is the honest default. */
function acceptanceTone(state: MissionAcceptanceStateView | undefined): string {
  return ACCEPTANCE_TONE[state as MissionAcceptanceStateView] ?? ACCEPTANCE_TONE.not_evaluated;
}
function acceptanceLabel(state: MissionAcceptanceStateView | undefined): string {
  return ACCEPTANCE_LABEL[state as MissionAcceptanceStateView] ?? ACCEPTANCE_LABEL.not_evaluated;
}
function childTone(status: MissionChildStatusView | undefined): string {
  return CHILD_TONE[status as MissionChildStatusView] ?? CHILD_TONE.queued;
}

function Tag({ tone, children }: { tone: string; children: any }) {
  return (
    <span class={`inline-flex shrink-0 items-center rounded border px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wide ${tone}`}>
      {children}
    </span>
  );
}

export interface MissionGraphState {
  view: MissionGraphView | null;
  loading: boolean;
  launching: boolean;
  error: string | null;
  running: boolean;
  launch: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useMissionGraph(dealId: number | null | undefined): MissionGraphState {
  const [view, setView] = useState<MissionGraphView | null>(null);
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!dealId) return;
    setLoading(true);
    try {
      const response = await apiGet<{ missionGraph: MissionGraphView }>(`/api/landos/deal-cards/${dealId}/mission-graph`);
      setView(response.missionGraph);
      setError(null);
    } catch (err) {
      setError((err as Error)?.message ?? 'Could not load the mission graph.');
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const running = view?.mission?.status === 'running';

  useEffect(() => {
    if (!dealId || !running) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = setInterval(() => { void refresh(); }, 2000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [dealId, running, refresh]);

  const launch = useCallback(async () => {
    if (!dealId) return;
    setLaunching(true);
    setError(null);
    try {
      const response = await apiPost<{ missionGraph: MissionGraphView }>(`/api/landos/deal-cards/${dealId}/mission-graph/run`, {});
      setView(response.missionGraph);
      // The children settle after the POST returns, so pull once more.
      setTimeout(() => { void refresh(); }, 600);
    } catch (err) {
      setError((err as Error)?.message ?? 'The mission could not start.');
    } finally {
      setLaunching(false);
    }
  }, [dealId, refresh]);

  return { view, loading, launching, error, running, launch, refresh };
}

export function MissionGraphPanel({ dealId }: { dealId: number }) {
  const state = useMissionGraph(dealId);
  const { view, running, launching, error, launch } = state;
  const mission = view?.mission ?? null;
  const children = view?.children ?? [];
  // Defence in depth on top of the server-side normalizer: a payload from an
  // older build must never be able to throw during render and blank the panel.
  const rawJoin = view?.join ?? null;
  const join: MissionJoinView | null = rawJoin
    ? {
        ...rawJoin,
        contributions: rawJoin.contributions ?? {},
        contributionsBySlot: rawJoin.contributionsBySlot ?? {},
        routing: rawJoin.routing ?? [],
        contributed: rawJoin.contributed ?? [],
        accepted: rawJoin.accepted ?? [],
        incomplete: rawJoin.incomplete ?? [],
        gaps: rawJoin.gaps ?? [],
        requiredGaps: rawJoin.requiredGaps ?? [],
        outstanding: rawJoin.outstanding ?? [],
      }
    : null;
  const settled = children.filter((child) => child.status !== 'queued' && child.status !== 'running').length;

  return (
    <div data-testid="mission-graph" class="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-[12px] font-semibold text-[var(--color-text)]">Mission graph</div>
          <div class="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
            One parent mission launches its specialist child missions, waits for every required child to reach a
            terminal state, then joins their results. A child that fails or is blocked is always named here.
          </div>
        </div>
        <button
          type="button"
          data-testid="mission-graph-run"
          disabled={running || launching}
          onClick={() => { void launch(); }}
          class="shrink-0 rounded border border-[var(--color-accent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-accent)] disabled:opacity-50"
        >
          {running ? 'Running…' : launching ? 'Starting…' : mission ? 'Re-run mission' : 'Run mission'}
        </button>
      </div>

      {error && (
        <div data-testid="mission-graph-error" class="mt-2 rounded border border-rose-500/40 px-2 py-1 text-[11px] text-rose-400">
          {error}
        </div>
      )}

      {mission && (
        <div class="mt-3">
          <div class="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
            <Tag tone={MISSION_TONE[mission.status]}>{mission.status.replace(/_/g, ' ')}</Tag>
            <span data-testid="mission-graph-sequence">Mission #{mission.sequence}</span>
            <span data-testid="mission-graph-mission-id" class="font-mono text-[10px]">{mission.missionId}</span>
            <span data-testid="mission-graph-settled">{settled}/{children.length} children settled</span>
            {join && (
              <span data-testid="mission-graph-acceptance">
                {join.accepted.length} accepted
                {join.incomplete.length > 0 ? `, ${join.incomplete.length} incomplete` : ''}
              </span>
            )}
            {mission.failureCategory && <Tag tone={CHILD_TONE.failed}>{mission.failureCategory}</Tag>}
          </div>

          {(mission.outcome || join?.outcome) && (
            <div data-testid="mission-graph-outcome" class="mt-2 rounded border border-[var(--color-border)] px-2 py-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
              {mission.outcome ?? join?.outcome}
            </div>
          )}

          <div data-testid="mission-graph-children" class="mt-2 space-y-1">
            {children.map((child) => {
              const acceptance = child.acceptance;
              const provider = child.provider;
              const failedChecks = (acceptance?.checks ?? []).filter((check) => !check.passed);
              return (
                <div
                  key={child.key}
                  data-testid={`mission-child-${child.key}`}
                  class="rounded border border-[var(--color-border)] px-2 py-1"
                >
                  <div class="flex flex-wrap items-start gap-2">
                    <Tag tone={childTone(child.status)}>{child.status}</Tag>
                    <span class="text-[11px] font-semibold text-[var(--color-text)]">{child.label}</span>
                    {acceptance && (
                      <Tag tone={acceptanceTone(acceptance.state)}>
                        <span data-testid={`mission-child-acceptance-${child.key}`}>
                          {acceptanceLabel(acceptance.state)}
                        </span>
                      </Tag>
                    )}
                    {child.role === 'supporting' && <Tag tone="border-zinc-500/40 text-zinc-400">supporting</Tag>}
                    {child.dependsOn.length > 0 && (
                      <span class="text-[10px] text-[var(--color-text-faint)]">after {child.dependsOn.join(', ')}</span>
                    )}
                    {child.failureCategory && <Tag tone={CHILD_TONE.failed}>{child.failureCategory}</Tag>}
                    {child.durationMs != null && (
                      <span class="ml-auto shrink-0 text-[10px] text-[var(--color-text-faint)]">
                        {(child.durationMs / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>

                  {/* Identity: group, assigned role, the specialist that owns the
                      lane, and where this child's handback belongs. */}
                  <div
                    data-testid={`mission-child-identity-${child.key}`}
                    class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[var(--color-text-faint)]"
                  >
                    <span>group <span class="text-[var(--color-text-muted)]">{child.group}</span></span>
                    <span>·</span>
                    <span>role <span class="text-[var(--color-text-muted)]">{child.assignedRole}</span></span>
                    <span>·</span>
                    <span>
                      agent{' '}
                      <span class="text-[var(--color-text-muted)]">
                        {child.agentName}
                        {child.agentKey ? ` (${child.agentKey})` : ''}
                      </span>
                    </span>
                    <span>·</span>
                    <span>→ contribution <span class="text-[var(--color-text-muted)]">{child.contributionSlot}</span></span>
                    {provider && (
                      <>
                        <span>·</span>
                        <span data-testid={`mission-child-provider-${child.key}`}>
                          provider{' '}
                          <span class="text-[var(--color-text-muted)]">
                            {provider.mode === 'deterministic'
                              ? 'deterministic (no provider, no spend)'
                              : `${provider.providerLabel ?? provider.providerId ?? 'none'}${provider.modelId ? ` / ${provider.modelId}` : ''}${provider.available ? '' : ' — unavailable'}`}
                          </span>
                        </span>
                      </>
                    )}
                  </div>

                  <div class="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                    {child.failureMessage ?? child.summary}
                  </div>

                  {/* Every acceptance term that was NOT met is named. A rejected or
                      incomplete result must never be presented without its reason. */}
                  {failedChecks.length > 0 && (
                    <ul
                      data-testid={`mission-child-acceptance-failures-${child.key}`}
                      class="mt-1 space-y-[2px] border-l border-[var(--color-border)] pl-2"
                    >
                      {failedChecks.map((check) => (
                        <li key={check.id} class="text-[10px] leading-relaxed text-[var(--color-text-faint)]">
                          <span class="font-semibold text-[var(--color-text-muted)]">
                            {check.severity === 'required' ? 'unmet requirement' : 'missing expected term'}
                          </span>
                          : {check.requirement} {check.detail}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          {join && join.gaps.length > 0 && (
            <div data-testid="mission-graph-gaps" class="mt-2 rounded border border-amber-500/40 px-2 py-1">
              <div class="text-[10px] font-semibold uppercase tracking-wide text-amber-400">
                Missing contributions ({join.gaps.length})
              </div>
              <ul class="mt-1 space-y-1">
                {join.gaps.map((gap) => (
                  <li key={gap.key} class="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                    <span class="font-semibold text-[var(--color-text)]">{gap.label}</span>
                    {' '}({gap.status}{gap.role === 'supporting' ? ', supporting' : ', required'};
                    {' '}acceptance {acceptanceLabel(gap.acceptanceState)}; {gap.agentName ?? 'unassigned'}): {gap.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Handback routing: which child's result went to which parent
              contribution, and for the ones that did not, why not. */}
          {join && join.routing.length > 0 && (
            <div data-testid="mission-graph-routing" class="mt-2 rounded border border-[var(--color-border)] px-2 py-1">
              <div class="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
                Handback routing ({join.routing.filter((route) => route.routed).length}/{join.routing.length} routed)
              </div>
              <ul class="mt-1 space-y-[2px]">
                {join.routing.map((route) => (
                  <li
                    key={route.childKey}
                    data-testid={`mission-route-${route.childKey}`}
                    class="text-[10px] leading-relaxed text-[var(--color-text-faint)]"
                  >
                    <span class="font-semibold text-[var(--color-text-muted)]">{route.childLabel}</span>
                    {' '}({route.agentName}, {route.group}){' → '}
                    <span class="font-mono text-[var(--color-text-muted)]">{route.slot}</span>
                    {' '}
                    <Tag tone={acceptanceTone(route.acceptanceState)}>{acceptanceLabel(route.acceptanceState)}</Tag>
                    <div>{route.note}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {join && join.contributed.length > 0 && (
            <div data-testid="mission-graph-contributions" class="mt-2">
              <div class="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
                Joined child results ({join.contributed.length})
              </div>
              {join.contributed.map((key) => {
                const slot = join.routing.find((route) => route.childKey === key)?.slot ?? key;
                return (
                  <pre
                    key={key}
                    data-testid={`mission-contribution-${key}`}
                    class="mt-1 overflow-x-auto rounded border border-[var(--color-border)] px-2 py-1 text-[10px] leading-relaxed text-[var(--color-text-muted)]"
                  >
                    {slot} (from {key}): {JSON.stringify(join.contributionsBySlot[slot] ?? join.contributions[key], null, 2)}
                  </pre>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!mission && (
        <div class="mt-2 text-[11px] text-[var(--color-text-faint)]">
          Not run yet for this Deal Card. Nothing is asserted until it runs.
        </div>
      )}
    </div>
  );
}
