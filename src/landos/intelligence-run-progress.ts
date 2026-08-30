// LandOS — what the operator can see while an intelligence read is running.
//
// A finalization run legitimately takes minutes: the specialists reason over a
// full property file, one profile at a time where the layers depend on each
// other. Until now the only thing the run published was "started at", so a
// healthy twelve-minute pass and a wedged one looked identical on the Deal
// Card — and a healthy one was read as a hang.
//
// This module is the progress projection and nothing else. It owns no run, it
// starts nothing, and it never touches intelligence semantics: the stack
// reports the transitions it already makes, and these pure reducers shape them
// into the record the Deal Card renders. Honesty rules the shape — LandOS
// publishes which stage is running and which have finished, and never a
// percentage or an ETA it cannot know.

export type IntelligenceRunStageId = 'preparing' | 'property' | 'market' | 'seller' | 'deal' | 'finalizing';

/** `skipped` is an honest state, not a failure: a layer whose inputs have not
 *  moved is reused rather than re-reasoned, and must not look stuck. */
export type IntelligenceRunStageState = 'pending' | 'running' | 'complete' | 'failed' | 'skipped';

export type IntelligenceRunStatus = 'running' | 'complete' | 'failed' | 'cancelled';

export interface IntelligenceRunStage {
  id: IntelligenceRunStageId;
  label: string;
  state: IntelligenceRunStageState;
  startedAt: string | null;
  completedAt: string | null;
  /** One concise operator sentence on a failed or skipped stage. Never a
   *  stack trace, a provider id, or a process name. */
  note: string | null;
}

export interface IntelligenceRunProgress {
  runId: string;
  status: IntelligenceRunStatus;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  /** The stage the operator is waiting on, in canonical order. Property and
   *  Seller genuinely run together, so this names the first one still in
   *  flight rather than pretending the run is single-file. */
  currentStage: IntelligenceRunStageId | null;
  stages: IntelligenceRunStage[];
  /** Model layers only — the honest "2 of 4 complete" the operator reads. */
  layersComplete: number;
  layersPlanned: number;
  error: string | null;
}

export const STAGE_LABEL: Record<IntelligenceRunStageId, string> = {
  preparing: 'Preparing property file',
  property: 'Property Intelligence',
  market: 'Market Intelligence',
  seller: 'Seller Intelligence',
  deal: 'Deal Intelligence',
  finalizing: 'Finalizing current Deal state',
};

const STAGE_ORDER: IntelligenceRunStageId[] = ['preparing', 'property', 'market', 'seller', 'deal', 'finalizing'];
const LAYER_STAGES: IntelligenceRunStageId[] = ['property', 'market', 'seller', 'deal'];

/** The event vocabulary the run reports. Deliberately tiny: the stack already
 *  knows these moments, so publishing them adds no new control flow. */
export type IntelligenceRunEvent =
  | { kind: 'plan'; layers: IntelligenceRunStageId[] }
  | { kind: 'stage'; id: IntelligenceRunStageId; state: IntelligenceRunStageState; note?: string | null };

function stage(id: IntelligenceRunStageId, state: IntelligenceRunStageState, at: string | null): IntelligenceRunStage {
  return { id, label: STAGE_LABEL[id], state, startedAt: state === 'running' ? at : null, completedAt: null, note: null };
}

/** A run that has only just started: preparation is under way and the layer
 *  plan is not known yet, because the stack decides it from the evidence. */
export function startRunProgress(runId: string, startedAt: string): IntelligenceRunProgress {
  return {
    runId,
    status: 'running',
    startedAt,
    updatedAt: startedAt,
    finishedAt: null,
    currentStage: 'preparing',
    stages: [stage('preparing', 'running', startedAt), stage('finalizing', 'pending', null)],
    layersComplete: 0,
    layersPlanned: 0,
    error: null,
  };
}

function recount(progress: IntelligenceRunProgress): IntelligenceRunProgress {
  const layers = progress.stages.filter((entry) => LAYER_STAGES.includes(entry.id));
  const settled = layers.filter((entry) => entry.state === 'complete' || entry.state === 'skipped');
  const running = STAGE_ORDER.find((id) => progress.stages.some((entry) => entry.id === id && entry.state === 'running'));
  return {
    ...progress,
    currentStage: progress.status === 'running' ? running ?? null : null,
    layersComplete: settled.length,
    layersPlanned: layers.length,
  };
}

/** Fold one reported transition into the record. Pure: the caller owns storage. */
export function applyRunEvent(
  progress: IntelligenceRunProgress,
  event: IntelligenceRunEvent,
  at: string,
): IntelligenceRunProgress {
  if (progress.status !== 'running') return progress;
  if (event.kind === 'plan') {
    // The plan lands once the stack knows which layers are actually stale.
    // Preparation keeps whatever state it already reached, and the layers the
    // run will not re-reason simply never appear — a reused layer is not a
    // stage the operator is waiting on.
    const preparing = progress.stages.find((entry) => entry.id === 'preparing')!;
    const finalizing = progress.stages.find((entry) => entry.id === 'finalizing')!;
    const planned = LAYER_STAGES.filter((id) => event.layers.includes(id)).map((id) => stage(id, 'pending', null));
    return recount({ ...progress, updatedAt: at, stages: [preparing, ...planned, finalizing] });
  }
  const stages = progress.stages.map((entry) => (entry.id !== event.id ? entry : {
    ...entry,
    state: event.state,
    startedAt: event.state === 'running' ? at : entry.startedAt,
    completedAt: event.state === 'running' ? null : at,
    note: event.note ?? (event.state === 'failed' || event.state === 'skipped' ? entry.note : null),
  }));
  return recount({ ...progress, updatedAt: at, stages });
}

/** The run finished. Every stage still open is settled so nothing can be left
 *  reading "running" after the run is over. */
export function finishRunProgress(
  progress: IntelligenceRunProgress,
  outcome: { error: string | null; note?: string | null },
  at: string,
): IntelligenceRunProgress {
  const stages = progress.stages.map((entry) => {
    if (entry.state !== 'running' && entry.state !== 'pending') return entry;
    if (!outcome.error) {
      return { ...entry, state: 'complete' as const, completedAt: at, note: entry.note };
    }
    return entry.state === 'running'
      ? { ...entry, state: 'failed' as const, completedAt: at, note: entry.note ?? outcome.note ?? null }
      : { ...entry, state: 'skipped' as const, completedAt: at, note: 'The run ended before this stage began.' };
  });
  return recount({
    ...progress,
    status: outcome.error ? 'failed' : 'complete',
    updatedAt: at,
    finishedAt: at,
    stages,
    error: outcome.error,
  });
}

/** Cancellation is a terminal, operator-intended outcome. It must settle every
 * open stage without misreporting a product failure or leaving a stage alive. */
export function cancelRunProgress(
  progress: IntelligenceRunProgress,
  at: string,
  note = 'Stopped by Operator.',
): IntelligenceRunProgress {
  const stages = progress.stages.map((entry) => {
    if (entry.state !== 'running' && entry.state !== 'pending') return entry;
    return {
      ...entry,
      state: 'skipped' as const,
      completedAt: at,
      note: entry.state === 'running' ? note : 'The run was stopped before this stage began.',
    };
  });
  return recount({
    ...progress,
    status: 'cancelled',
    updatedAt: at,
    finishedAt: at,
    stages,
    error: note,
  });
}
