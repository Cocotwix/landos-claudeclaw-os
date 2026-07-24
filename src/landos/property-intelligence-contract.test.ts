import { describe, expect, it } from 'vitest';
import {
  PROPERTY_INTELLIGENCE_CONTRACT,
  evaluateCompletionPredicate,
  evaluateStageCompletion,
  validateStageOutput,
} from './property-intelligence-contract.js';

describe('Property Intelligence declarative completion contract', () => {
  it('evaluates only fixed predicate kinds and requires evidence when declared', () => {
    expect(evaluateCompletionPredicate(
      { kind: 'task_status_in', values: ['succeeded'], requireEvidence: true, findingKind: 'wetlands' },
      { status: 'succeeded', finding: { kind: 'wetlands' }, evidence: [{ evidenceId: 'e1' }] },
    )).toBe(true);
    expect(evaluateCompletionPredicate(
      { kind: 'task_status_in', values: ['succeeded'], requireEvidence: true },
      { status: 'succeeded', evidence: [] },
    )).toBe(false);
  });

  it('uses ordered declarative rules for blocked, complete, and fallback outcomes', () => {
    const stage = PROPERTY_INTELLIGENCE_CONTRACT.stages.find((row) => row.id === 'county_records')!;
    expect(evaluateStageCompletion(stage, { status: 'blocked' })).toBe('blocked');
    expect(evaluateStageCompletion(stage, { status: 'succeeded', evidence: [{}] })).toBe('complete');
    expect(evaluateStageCompletion(stage, { status: 'succeeded', evidence: [] })).toBe('no_result');
  });

  it('validates required finding output plus exact evidence provenance', () => {
    const stage = PROPERTY_INTELLIGENCE_CONTRACT.stages.find((row) => row.id === 'county_records')!;
    const valid = validateStageOutput(stage, {
      status: 'succeeded',
      finding: { facts: [{ field: 'apn', value: 'A-1' }], accessState: 'public' },
      evidence: [{
        sourceUrl: 'https://county.example/parcel/A-1', sourceName: 'County assessor',
        sourceTier: 'official_county_state', captureMode: 'live',
        retrievedAt: '2026-07-21T12:00:00.000Z', confidence: 'high',
      }],
    });
    expect(valid).toEqual({ valid: true, violations: [] });

    const invalid = validateStageOutput(stage, {
      status: 'succeeded', finding: { facts: [], accessState: '' },
      evidence: [{ sourceName: '', sourceTier: 'marketplace', captureMode: '', retrievedAt: '', confidence: '' }],
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.violations.join('\n')).toMatch(/required output "facts"/);
    expect(invalid.violations.join('\n')).toMatch(/missing sourceUrl/);
    expect(invalid.violations.join('\n')).toMatch(/unacceptable source tier/);
    expect(invalid.violations.join('\n')).toMatch(/capture\/timestamp\/confidence/);
  });
});
