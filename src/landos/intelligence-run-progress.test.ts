import { describe, expect, it } from 'vitest';

import {
  applyRunEvent,
  finishRunProgress,
  startRunProgress,
} from './intelligence-run-progress.js';

// The operator contract: a run that legitimately takes minutes must publish
// which stage it is on, which have settled, and when it is over — and must
// never be left reading "running" once it is not.

const T0 = '2026-08-30T04:00:00.000Z';
const at = (seconds: number) => new Date(Date.parse(T0) + seconds * 1000).toISOString();

describe('intelligence run progress', () => {
  it('opens on preparation before the layer plan is known', () => {
    const progress = startRunProgress('run_1', T0);
    expect(progress.status).toBe('running');
    expect(progress.currentStage).toBe('preparing');
    // The plan is decided from the evidence, so it cannot be claimed up front.
    expect(progress.layersPlanned).toBe(0);
  });

  it('publishes only the layers this run will actually re-reason', () => {
    let progress = startRunProgress('run_1', T0);
    progress = applyRunEvent(progress, { kind: 'plan', layers: ['property', 'market', 'deal'] }, at(2));
    expect(progress.stages.map((stage) => stage.id))
      .toEqual(['preparing', 'property', 'market', 'deal', 'finalizing']);
    // Seller is reused, not re-reasoned: showing it pending would read as stuck.
    expect(progress.layersPlanned).toBe(3);
    expect(progress.layersComplete).toBe(0);
  });

  it('advances the current stage as execution moves between layers', () => {
    let progress = startRunProgress('run_1', T0);
    progress = applyRunEvent(progress, { kind: 'plan', layers: ['property', 'market', 'deal'] }, at(2));
    progress = applyRunEvent(progress, { kind: 'stage', id: 'preparing', state: 'complete' }, at(30));
    progress = applyRunEvent(progress, { kind: 'stage', id: 'property', state: 'running' }, at(31));
    expect(progress.currentStage).toBe('property');

    progress = applyRunEvent(progress, { kind: 'stage', id: 'property', state: 'complete' }, at(90));
    progress = applyRunEvent(progress, { kind: 'stage', id: 'market', state: 'running' }, at(91));
    expect(progress.currentStage).toBe('market');
    expect(progress.layersComplete).toBe(1);
    expect(progress.stages.find((stage) => stage.id === 'property')?.completedAt).toBe(at(90));
  });

  it('counts a deterministically skipped layer as settled, never as stuck', () => {
    let progress = startRunProgress('run_1', T0);
    progress = applyRunEvent(progress, { kind: 'plan', layers: ['property', 'seller'] }, at(1));
    progress = applyRunEvent(progress, { kind: 'stage', id: 'seller', state: 'skipped', note: 'Pre-contact needs no specialist.' }, at(2));
    expect(progress.layersComplete).toBe(1);
    expect(progress.stages.find((stage) => stage.id === 'seller')?.note).toContain('Pre-contact');
  });

  it('terminates cleanly on success so nothing is left reading running', () => {
    let progress = startRunProgress('run_1', T0);
    progress = applyRunEvent(progress, { kind: 'plan', layers: ['property', 'deal'] }, at(1));
    progress = applyRunEvent(progress, { kind: 'stage', id: 'property', state: 'complete' }, at(60));
    progress = finishRunProgress(progress, { error: null }, at(300));

    expect(progress.status).toBe('complete');
    expect(progress.finishedAt).toBe(at(300));
    expect(progress.currentStage).toBeNull();
    expect(progress.stages.every((stage) => stage.state === 'complete')).toBe(true);
  });

  it('names the stage that stopped when a run fails, and settles the rest', () => {
    let progress = startRunProgress('run_1', T0);
    progress = applyRunEvent(progress, { kind: 'plan', layers: ['property', 'market', 'deal'] }, at(1));
    progress = applyRunEvent(progress, { kind: 'stage', id: 'preparing', state: 'complete' }, at(20));
    progress = applyRunEvent(progress, { kind: 'stage', id: 'property', state: 'complete' }, at(80));
    progress = applyRunEvent(progress, { kind: 'stage', id: 'market', state: 'running' }, at(81));
    progress = finishRunProgress(progress, { error: 'The Market specialist exceeded its limit.' }, at(400));

    expect(progress.status).toBe('failed');
    expect(progress.error).toContain('Market specialist');
    expect(progress.stages.find((stage) => stage.id === 'market')?.state).toBe('failed');
    // A stage the run never reached is honestly skipped, not failed.
    expect(progress.stages.find((stage) => stage.id === 'deal')?.state).toBe('skipped');
    expect(progress.stages.some((stage) => stage.state === 'running')).toBe(false);
    expect(progress.currentStage).toBeNull();
  });

  it('ignores late transitions once the run has terminated', () => {
    let progress = startRunProgress('run_1', T0);
    progress = finishRunProgress(progress, { error: null }, at(100));
    const after = applyRunEvent(progress, { kind: 'stage', id: 'deal', state: 'running' }, at(200));
    expect(after).toEqual(progress);
  });
});
