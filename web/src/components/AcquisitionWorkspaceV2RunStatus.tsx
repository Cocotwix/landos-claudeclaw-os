// Acquisition Workspace V2 — Property Intelligence run status.
//
// What this exists for: submitting a lead started a long, entirely invisible
// piece of work. The mission runs server-side and fire-and-forget, so the
// operator got a saved lead, a mostly empty workspace, and no way to tell
// whether research was still gathering, already finished, or had quietly
// failed. The only honest read was the database.
//
// Everything rendered here is already produced by the backend and was simply
// never surfaced: `/property-intelligence/progress` returns the run row plus one
// row per specialist lane, written live as each lane starts and settles. This
// component polls that endpoint while a run is in flight and stops the moment
// it settles.
//
// It also carries the re-run control. That capability existed on the legacy
// Deal Card panel and was lost in the V2 migration, which is why a lead whose
// research came back empty had no operator path forward at all.
//
// Two deliberate properties:
//   • Polling is read-only and side-effect free. Refreshing the page, closing
//     the tab, or leaving the workspace never touches the mission — it runs in
//     the server process, not the browser.
//   • Nothing here invents progress. A lane with no status reads as queued, and
//     the summary shown is the lane's own text, never a synthesized one.

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { RefreshCw } from 'lucide-preact';
import { apiGet, apiPost } from '@/lib/api';

const POLL_INTERVAL_MS = 2500;

export type RunSpecialistStatus =
  | 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'blocked' | 'skipped';

export interface RunSpecialistView {
  id?: string;
  label?: string;
  role?: string;
  status?: RunSpecialistStatus;
  summary?: string | null;
  evidenceCount?: number;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
}

export interface RunView {
  runId?: string;
  sequence?: number;
  status?: 'running' | 'complete' | 'complete_with_gaps' | 'blocked_identity' | 'failed';
  trigger?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
}

interface ProgressResp {
  run?: RunView | null;
  specialists?: RunSpecialistView[];
  snapshotStatus?: string | null;
}

interface PropertyResolutionView {
  invocationId: string;
  subjectResolution: 'RESOLVED' | 'AMBIGUOUS' | 'UNRESOLVED' | 'ERROR';
  facts?: { canonicalIdentity?: { apn?: string | null; address?: string | null; county?: string | null; state?: string | null }; identityBasis?: string };
  evidence?: Array<{ source: string }>;
  timestamps?: { completedAt?: string };
}

interface PropertyResolutionResp {
  result?: PropertyResolutionView | null;
}

/** Lane status → the dot class that carries its colour. */
const DOT_CLASS: Record<RunSpecialistStatus, string> = {
  running: 'run', queued: 'queued', completed: 'ok', partial: 'partial',
  blocked: 'blocked', failed: 'failed', skipped: 'skipped',
};

const STATUS_WORD: Record<RunSpecialistStatus, string> = {
  running: 'Retrieving', queued: 'Queued', completed: 'Delivered', partial: 'Partial',
  blocked: 'Blocked', failed: 'Failed', skipped: 'Skipped',
};

/** How the whole run reads in one line. */
const RUN_WORD: Record<NonNullable<RunView['status']>, string> = {
  running: 'Gathering property intelligence',
  complete: 'Research run complete',
  complete_with_gaps: 'Research run complete; named underwriting gaps remain',
  blocked_identity: 'Stopped: the subject parcel was never identified',
  failed: 'The research run failed',
};

function elapsedLabel(fromIso: string | null | undefined, toIso?: string | null): string | null {
  if (!fromIso) return null;
  const start = Date.parse(fromIso);
  if (!Number.isFinite(start)) return null;
  const end = toIso ? Date.parse(toIso) : Date.now();
  const seconds = Math.max(0, Math.round(((Number.isFinite(end) ? end : Date.now()) - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export function PropertyIntelligenceRunStatus(props: {
  dealId: number;
  /** Called once when a run that was in flight settles, so the workspace can
   *  reload the records the run just rewrote. */
  onRunSettled?: () => void;
}) {
  const { dealId, onRunSettled } = props;
  const [run, setRun] = useState<RunView | null>(null);
  const [lanes, setLanes] = useState<RunSpecialistView[]>([]);
  const [starting, setStarting] = useState(false);
  const [refreshingResolution, setRefreshingResolution] = useState(false);
  const [resolution, setResolution] = useState<PropertyResolutionView | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  // Drives the elapsed clock while a run is in flight without refetching.
  const [, setTick] = useState(0);

  const wasRunning = useRef(false);
  const dead = useRef(false);
  const settledCb = useRef(onRunSettled);
  settledCb.current = onRunSettled;

  const poll = useCallback(async (): Promise<boolean> => {
    try {
      const [data, propertyResolution] = await Promise.all([
        apiGet<ProgressResp>(`/api/landos/deal-cards/${dealId}/property-intelligence/progress`),
        apiGet<PropertyResolutionResp>(`/api/landos/deal-cards/${dealId}/property-resolution`).catch(() => ({ result: null })),
      ]);
      if (dead.current) return false;
      setRun(data?.run ?? null);
      setLanes(Array.isArray(data?.specialists) ? data.specialists : []);
      setResolution(propertyResolution.result ?? null);
      const running = data?.run?.status === 'running';
      // The transition out of `running` is the moment the run's writes are on
      // the record, so that is when the workspace is told to reload.
      if (wasRunning.current && !running) settledCb.current?.();
      wasRunning.current = running;
      return running;
    } catch {
      // A failed poll is not a failed run. Keep the last known state on screen
      // rather than blanking a panel the operator is actively watching.
      return wasRunning.current;
    }
  }, [dealId]);

  useEffect(() => {
    dead.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = async () => {
      const running = await poll();
      if (dead.current) return;
      if (running) timer = setTimeout(loop, POLL_INTERVAL_MS);
    };
    void loop();
    return () => { dead.current = true; if (timer) clearTimeout(timer); };
  }, [poll]);

  // Second-resolution clock, only while something is actually in flight.
  useEffect(() => {
    if (run?.status !== 'running') return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [run?.status]);

  const startRun = useCallback(async () => {
    setStarting(true);
    setActionError(null);
    try {
      await apiPost(`/api/landos/deal-cards/${dealId}/property-intelligence/run`, { actor: 'operator' });
      wasRunning.current = true;
      // Resume the poll loop against the run just launched.
      const loop = async () => {
        const running = await poll();
        if (!dead.current && running) setTimeout(loop, POLL_INTERVAL_MS);
      };
      void loop();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!dead.current) setStarting(false);
    }
  }, [dealId, poll]);

  const refreshResolution = useCallback(async () => {
    setRefreshingResolution(true);
    setActionError(null);
    try {
      const response = await apiPost<PropertyResolutionResp>(`/api/landos/deal-cards/${dealId}/property-resolution/run`, { actor: 'operator' });
      setResolution(response.result ?? null);
      settledCb.current?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!dead.current) setRefreshingResolution(false);
    }
  }, [dealId]);

  const running = run?.status === 'running';
  // Nothing has ever run for this lead and nothing is running now: the panel
  // still appears, because "no research has been run" is itself the status the
  // operator needs, and the control to start it belongs with it.
  const runLabel = run?.status ? RUN_WORD[run.status] : 'No research run has been recorded for this lead';
  const elapsed = elapsedLabel(run?.startedAt, running ? null : run?.completedAt);

  const active = lanes.filter((lane) => lane.status === 'running');
  const settledCount = lanes.filter((lane) => lane.status && lane.status !== 'queued' && lane.status !== 'running').length;
  const currentLine = running
    ? (active.length
      ? `Retrieving: ${active.map((lane) => lane.label).filter(Boolean).join(' · ')}`
      : 'Starting the research lanes…')
    : null;

  return (
    <section class={`awv2-runstatus${running ? ' is-running' : ''}`} aria-live="polite">
      <div class="awv2-runstatus-head">
        <span class={`awv2-runstatus-dot${running ? ' live' : ''} ${run?.status ?? 'none'}`} />
        <div class="awv2-runstatus-head-text">
          <div class="awv2-runstatus-title">
            {runLabel}
            {elapsed && <span class="awv2-runstatus-elapsed">{running ? elapsed : `took ${elapsed}`}</span>}
          </div>
          {currentLine && <div class="awv2-runstatus-current">{currentLine}</div>}
          {!running && lanes.length > 0 && (
            <div class="awv2-runstatus-current">
              {settledCount} of {lanes.length} lanes reported by this research run
            </div>
          )}
          <div class="awv2-runstatus-current" data-testid="deal-card-property-resolution">
            Property Resolution: <b>{resolution?.subjectResolution ?? 'NOT RUN'}</b>
            {resolution?.facts?.canonicalIdentity?.apn ? ` · APN ${resolution.facts.canonicalIdentity.apn}` : ''}
            {resolution?.evidence?.length ? ` · ${resolution.evidence.length} source${resolution.evidence.length === 1 ? '' : 's'}` : ''}
          </div>
          {resolution?.facts?.identityBasis && <div class="awv2-runstatus-current">{resolution.facts.identityBasis}</div>}
          {!running && run?.error && <div class="awv2-runstatus-error">{run.error}</div>}
          {actionError && <div class="awv2-runstatus-error">Could not start the run: {actionError}</div>}
        </div>

        <div class="awv2-runstatus-actions">
          {lanes.length > 0 && (
            <button
              type="button"
              class="awv2-runstatus-toggle"
              onClick={() => setExpanded((open) => !open)}
              aria-expanded={expanded}
            >
              {expanded ? 'Hide lanes' : `${running ? 'Show' : 'Show'} lanes (${lanes.length})`}
            </button>
          )}
          <button
            type="button"
            class="awv2-runstatus-toggle"
            data-testid="deal-card-property-resolution-refresh"
            onClick={() => void refreshResolution()}
            disabled={running || starting || refreshingResolution}
            title="Run the canonical Property Resolution Capability again without changing an accepted subject"
          >
            <RefreshCw size={13} class={refreshingResolution ? 'spin' : undefined} />
            {refreshingResolution ? 'Resolvingâ€¦' : 'Refresh resolution'}
          </button>
          <button
            type="button"
            class="awv2-runstatus-run"
            onClick={() => void startRun()}
            disabled={running || starting || refreshingResolution}
            title={running
              ? 'A research run is already in flight for this lead'
              : 'Run Property Intelligence for this lead again'}
          >
            <RefreshCw size={13} class={starting ? 'spin' : undefined} />
            {running ? 'Running…' : starting ? 'Starting…' : 'Re-run research'}
          </button>
        </div>
      </div>

      {/* The lane list stays mounted-on-demand: it is the detail view, and the
          one-line head above is what an operator glancing at the page reads. */}
      {expanded && lanes.length > 0 && (
        <ul class="awv2-runstatus-lanes">
          {lanes.map((lane) => {
            const status = (lane.status ?? 'queued') as RunSpecialistStatus;
            return (
              <li key={lane.id ?? lane.label} class={`awv2-runstatus-lane ${status}`}>
                <span class={`awv2-runstatus-lanedot ${DOT_CLASS[status] ?? 'queued'}${status === 'running' ? ' live' : ''}`} />
                <div class="awv2-runstatus-lanebody">
                  <div class="awv2-runstatus-lanetop">
                    <span class="awv2-runstatus-lanelabel">{lane.label ?? lane.id}</span>
                    <span class="awv2-runstatus-lanestatus">{STATUS_WORD[status] ?? status}</span>
                    {lane.durationMs != null && lane.durationMs > 0 && (
                      <span class="awv2-runstatus-lanetime">
                        {lane.durationMs < 1000 ? `${lane.durationMs}ms` : `${Math.round(lane.durationMs / 1000)}s`}
                      </span>
                    )}
                  </div>
                  {lane.summary && <div class="awv2-runstatus-lanesummary">{lane.summary}</div>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
