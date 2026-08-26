/**
 * Run-status projection for the Deal Overview run panel.
 *
 * The recorded research run and the Property Resolution record are two
 * independent truths read from two independent endpoints. This merges one
 * poll's outcomes into the panel state so that:
 *
 *  - a failure in one read never erases or blocks the other,
 *  - a later transient failure preserves the last known good value, and
 *  - a value that has never loaded is reported as unavailable, never as
 *    "NOT RUN" / "no research run has been recorded" — those are claims about
 *    the record, and a failed request is not evidence about the record.
 */

export interface RunStatusSlice<T> {
  value: T | null;
  /** True only once a read of this record has actually succeeded. */
  loaded: boolean;
}

export interface RunStatusState<Run, Resolution> {
  run: RunStatusSlice<Run>;
  resolution: RunStatusSlice<Resolution>;
}

export function emptyRunStatusState<Run, Resolution>(): RunStatusState<Run, Resolution> {
  return { run: { value: null, loaded: false }, resolution: { value: null, loaded: false } };
}

function mergeSlice<T>(prev: RunStatusSlice<T>, result: PromiseSettledResult<T | null>): RunStatusSlice<T> {
  if (result.status !== 'fulfilled') return prev;
  return { value: result.value ?? null, loaded: true };
}

export function mergeRunStatus<Run, Resolution>(
  prev: RunStatusState<Run, Resolution>,
  results: {
    run: PromiseSettledResult<Run | null>;
    resolution: PromiseSettledResult<Resolution | null>;
  },
): RunStatusState<Run, Resolution> {
  return {
    run: mergeSlice(prev.run, results.run),
    resolution: mergeSlice(prev.resolution, results.resolution),
  };
}

/** The honest headline for the run record. */
export function runStatusLabel(
  status: string | null | undefined,
  loaded: boolean,
  word: (status: string) => string,
): string {
  if (status) return word(status);
  return loaded
    ? 'No research run has been recorded for this lead'
    : 'Run status could not be loaded — the recorded run state is unavailable right now';
}

/** The honest value for the Property Resolution line. */
export function resolutionLabel(subjectResolution: string | null | undefined, loaded: boolean): string {
  return subjectResolution ?? (loaded ? 'NOT RUN' : 'UNAVAILABLE');
}
