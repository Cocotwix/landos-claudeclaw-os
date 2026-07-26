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
  | 'failed'
  | 'blocked'
  | 'skipped'
  | 'cancelled';

export type MissionStatusView = 'running' | 'joined' | 'joined_with_gaps' | 'blocked' | 'failed';

export interface MissionChildView {
  key: string;
  label: string;
  purpose: string;
  role: 'required' | 'supporting';
  dependsOn: string[];
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
  failureCategory: string | null;
  reason: string;
}

export interface MissionJoinView {
  status: MissionStatusView;
  contributions: Record<string, unknown>;
  contributed: string[];
  gaps: MissionGapView[];
  requiredGaps: MissionGapView[];
  outstanding: MissionGapView[];
  allTerminal: boolean;
  allRequiredTerminal: boolean;
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
  failed: 'border-rose-500/40 text-rose-400',
  blocked: 'border-orange-500/40 text-orange-400',
  skipped: 'border-zinc-500/40 text-zinc-400',
  cancelled: 'border-zinc-500/40 text-zinc-400',
};

const MISSION_TONE: Record<MissionStatusView, string> = {
  running: 'border-sky-500/40 text-sky-400',
  joined: 'border-emerald-500/40 text-emerald-400',
  joined_with_gaps: 'border-amber-500/40 text-amber-400',
  blocked: 'border-orange-500/40 text-orange-400',
  failed: 'border-rose-500/40 text-rose-400',
};

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
  const join = view?.join ?? null;
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
            <span data-testid="mission-graph-settled">{settled}/{children.length} children settled</span>
            {mission.failureCategory && <Tag tone={CHILD_TONE.failed}>{mission.failureCategory}</Tag>}
          </div>

          {(mission.outcome || join?.outcome) && (
            <div data-testid="mission-graph-outcome" class="mt-2 rounded border border-[var(--color-border)] px-2 py-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
              {mission.outcome ?? join?.outcome}
            </div>
          )}

          <div data-testid="mission-graph-children" class="mt-2 space-y-1">
            {children.map((child) => (
              <div
                key={child.key}
                data-testid={`mission-child-${child.key}`}
                class="rounded border border-[var(--color-border)] px-2 py-1"
              >
                <div class="flex flex-wrap items-start gap-2">
                  <Tag tone={CHILD_TONE[child.status]}>{child.status}</Tag>
                  <span class="text-[11px] font-semibold text-[var(--color-text)]">{child.label}</span>
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
                <div class="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                  {child.failureMessage ?? child.summary}
                </div>
              </div>
            ))}
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
                    {' '}({gap.status}{gap.role === 'supporting' ? ', supporting' : ', required'}): {gap.reason}
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
              {join.contributed.map((key) => (
                <pre
                  key={key}
                  data-testid={`mission-contribution-${key}`}
                  class="mt-1 overflow-x-auto rounded border border-[var(--color-border)] px-2 py-1 text-[10px] leading-relaxed text-[var(--color-text-muted)]"
                >
                  {key}: {JSON.stringify(join.contributions[key], null, 2)}
                </pre>
              ))}
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
