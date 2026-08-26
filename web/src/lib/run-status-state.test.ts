import { describe, expect, it } from 'vitest';

import {
  emptyRunStatusState,
  mergeRunStatus,
  resolutionLabel,
  runStatusLabel,
} from './run-status-state.js';

// Deal 89 showed both "No research run has been recorded for this lead" and
// "Property Resolution: NOT RUN" while the server held a complete run and a
// RESOLVED subject. One shared catch across two independent reads was enough
// to assert, in the operator's face, that records which exist do not.

const ok = <T>(value: T): PromiseSettledResult<T> => ({ status: 'fulfilled', value });
const fail = <T>(): PromiseSettledResult<T> => ({ status: 'rejected', reason: new Error('network') });

const RUN = { status: 'complete' as const };
const RESOLUTION = { subjectResolution: 'RESOLVED' as const };
const word = (status: string) => (status === 'complete' ? 'Research run complete' : status);

describe('run status merge', () => {
  it('A. keeps the resolution truthful when only the progress read fails', () => {
    const next = mergeRunStatus(emptyRunStatusState<typeof RUN, typeof RESOLUTION>(), {
      run: fail(),
      resolution: ok(RESOLUTION),
    });
    expect(next.resolution.value).toEqual(RESOLUTION);
    expect(next.resolution.loaded).toBe(true);
    expect(resolutionLabel(next.resolution.value?.subjectResolution, next.resolution.loaded)).toBe('RESOLVED');
    // And the read it could not make is reported as unavailable, not as absent.
    expect(next.run.loaded).toBe(false);
    expect(runStatusLabel(next.run.value?.status, next.run.loaded, word)).not.toContain('No research run has been recorded');
  });

  it('B. keeps the run truthful when only the resolution read fails', () => {
    const next = mergeRunStatus(emptyRunStatusState<typeof RUN, typeof RESOLUTION>(), {
      run: ok(RUN),
      resolution: fail(),
    });
    expect(runStatusLabel(next.run.value?.status, next.run.loaded, word)).toBe('Research run complete');
    expect(resolutionLabel(next.resolution.value?.subjectResolution, next.resolution.loaded)).toBe('UNAVAILABLE');
  });

  it('C. preserves the last known good values when a later poll fails', () => {
    const loaded = mergeRunStatus(emptyRunStatusState<typeof RUN, typeof RESOLUTION>(), {
      run: ok(RUN),
      resolution: ok(RESOLUTION),
    });
    const afterTransientFailure = mergeRunStatus(loaded, { run: fail(), resolution: fail() });
    expect(afterTransientFailure.run.value).toEqual(RUN);
    expect(afterTransientFailure.resolution.value).toEqual(RESOLUTION);
    expect(runStatusLabel(afterTransientFailure.run.value?.status, afterTransientFailure.run.loaded, word))
      .toBe('Research run complete');
    expect(resolutionLabel(afterTransientFailure.resolution.value?.subjectResolution, afterTransientFailure.resolution.loaded))
      .toBe('RESOLVED');
  });

  it('D. never claims NOT RUN or "no research run" when the first load failed', () => {
    const next = mergeRunStatus(emptyRunStatusState<typeof RUN, typeof RESOLUTION>(), {
      run: fail(),
      resolution: fail(),
    });
    expect(runStatusLabel(next.run.value?.status, next.run.loaded, word))
      .toBe('Run status could not be loaded — the recorded run state is unavailable right now');
    expect(resolutionLabel(next.resolution.value?.subjectResolution, next.resolution.loaded)).toBe('UNAVAILABLE');
  });

  it('still states plainly that nothing ran once the read actually succeeds and is empty', () => {
    const next = mergeRunStatus(emptyRunStatusState<typeof RUN, typeof RESOLUTION>(), {
      run: ok(null),
      resolution: ok(null),
    });
    expect(runStatusLabel(next.run.value?.status, next.run.loaded, word))
      .toBe('No research run has been recorded for this lead');
    expect(resolutionLabel(next.resolution.value?.subjectResolution, next.resolution.loaded)).toBe('NOT RUN');
  });
});
