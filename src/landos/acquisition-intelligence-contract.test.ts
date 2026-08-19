import { describe, expect, it } from 'vitest';

import {
  extractJsonObject,
  normalizeAcquisitionIntelligence,
  type AcquisitionIntelligenceRuntime,
} from './acquisition-intelligence-contract.js';

// The contract is the ONLY place a model's output becomes LandOS data, so these
// tests are about two things: surviving whatever a replaceable reasoning engine
// emits, and refusing what would mislead an operator.

const runtime: AcquisitionIntelligenceRuntime = {
  engine: 'hermes',
  agentProfile: 'landos-acquisition-analyst',
  provider: 'ollama',
  model: 'gemma4:12b',
  modelSource: 'default',
  durationMs: 1_000,
};

const base = {
  dealCardId: 89,
  runtime,
  dossierFingerprint: 'abc123',
  allowedVisualKeys: ['close_parcel_aerial', 'surrounding_area_aerial'],
  landosConflicts: [],
  coveragePresent: ['Property identity'],
  coverageAbsent: ['Current zoning'],
  now: () => new Date('2026-08-18T00:00:00.000Z'),
};

const minimal = {
  deal_read: { headline: 'A 75 acre tract worth pursuing', judgment: 'Large, wooded, and cheap per acre.', confidence: 'Likely' },
  strategies: [{ strategy: 'Frontage subdivision', fit: 'strong', why_it_fits: 'Wide frontage.' }],
};

describe('extractJsonObject', () => {
  it('reads a bare object, a fenced block, and JSON buried in prose', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(extractJsonObject('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJsonObject('Here is my read:\n{"a":3}\nHope that helps.')).toEqual({ a: 3 });
  });

  it('skips a false start and finds the object that actually parses', () => {
    expect(extractJsonObject('note {not json} then {"a":4}')).toEqual({ a: 4 });
  });

  it('returns null for output with no object at all', () => {
    expect(extractJsonObject('I am ready. Please provide the dossier path.')).toBeNull();
    expect(extractJsonObject('')).toBeNull();
  });
});

describe('refusing a read that is not one', () => {
  it('rejects unparsable output instead of showing an empty judgment', () => {
    const outcome = normalizeAcquisitionIntelligence({ ...base, raw: 'I am ready to begin.' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/no parsable JSON/i);
  });

  it('rejects valid JSON that carries no headline, judgment or strategy', () => {
    const outcome = normalizeAcquisitionIntelligence({ ...base, raw: '{"property_story":["big"],"unknowns":[]}' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/no deal read and no strategies/i);
  });
});

describe('absorbing engine-specific phrasing', () => {
  it('accepts snake_case keys and normalizes the weight and fit vocabularies', () => {
    const outcome = normalizeAcquisitionIntelligence({ ...base, raw: JSON.stringify(minimal) });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.dealRead.headline).toBe('A 75 acre tract worth pursuing');
    expect(outcome.result.dealRead.confidence).toBe('Likely');
    expect(outcome.result.strategies[0]).toMatchObject({ strategy: 'Frontage subdivision', fit: 'strong' });
  });

  it('maps loose confidence and fit wording onto the fixed vocabularies', () => {
    const outcome = normalizeAcquisitionIntelligence({
      ...base,
      raw: JSON.stringify({
        deal_read: { headline: 'h', judgment: 'j', confidence: 'well-supported by the record' },
        strategies: [
          { strategy: 'Entitlement', fit: 'not applicable here' },
          { strategy: 'Quick flip', fit: 'the strongest option' },
        ],
      }),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.dealRead.confidence).toBe('Well supported');
    // Ranked strongest-first: a rejection never outranks a fit.
    expect(outcome.result.strategies.map((strategy) => strategy.fit)).toEqual(['strong', 'rejected']);
    expect(outcome.result.strategies[0].strategy).toBe('Quick flip');
  });

  it('defaults an unknown confidence to Unresolved rather than something confident', () => {
    const outcome = normalizeAcquisitionIntelligence({
      ...base,
      raw: JSON.stringify({ ...minimal, deal_read: { headline: 'h', judgment: 'j', confidence: 'pretty sure' } }),
    });
    expect(outcome.ok && outcome.result.dealRead.confidence).toBe('Unresolved');
  });
});

describe('preventing fabricated evidence', () => {
  it('drops a visual observation citing an image this property does not have', () => {
    const outcome = normalizeAcquisitionIntelligence({
      ...base,
      raw: JSON.stringify({
        ...minimal,
        visual_observations: [
          { visual: 'close_parcel_aerial', observation: 'The tract narrows at the road.' },
          { visual: 'street_view_9', observation: 'A paved cul-de-sac ends at the boundary.' },
        ],
      }),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.visualObservations.map((observation) => observation.visual)).toEqual(['close_parcel_aerial']);
    expect(outcome.result.warnings.join(' ')).toMatch(/not in this property's retained evidence/i);
  });

  it('warns when imagery was available and the analyst reported nothing from it', () => {
    const outcome = normalizeAcquisitionIntelligence({ ...base, raw: JSON.stringify(minimal) });
    expect(outcome.ok && outcome.result.warnings.join(' ')).toMatch(/no visual observation/i);
  });
});

describe('conflicts', () => {
  it('carries every LandOS conflict and lets the analyst add but never subtract', () => {
    const outcome = normalizeAcquisitionIntelligence({
      ...base,
      landosConflicts: [{ subject: 'frontage', statement: 'Frontage conflicts at 22.94-50 ft.', resolution: 'Unresolved.' }],
      raw: JSON.stringify({ ...minimal, conflicts: [{ subject: 'access', statement: 'Legal access is not recorded.', resolution: 'Unresolved.' }] }),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.conflicts.map((conflict) => conflict.subject)).toEqual(['frontage', 'access']);
  });

  it('keeps the LandOS conflict even when the analyst omits it entirely', () => {
    const outcome = normalizeAcquisitionIntelligence({
      ...base,
      landosConflicts: [{ subject: 'frontage', statement: 'Frontage conflicts at 22.94-50 ft.', resolution: 'Unresolved.' }],
      raw: JSON.stringify(minimal),
    });
    expect(outcome.ok && outcome.result.conflicts).toHaveLength(1);
  });

  it('does not duplicate a conflict the analyst restated verbatim', () => {
    const statement = 'Frontage conflicts at 22.94-50 ft.';
    const outcome = normalizeAcquisitionIntelligence({
      ...base,
      landosConflicts: [{ subject: 'frontage', statement, resolution: 'Unresolved.' }],
      raw: JSON.stringify({ ...minimal, conflicts: [{ subject: 'frontage', statement, resolution: 'Unresolved.' }] }),
    });
    expect(outcome.ok && outcome.result.conflicts).toHaveLength(1);
  });
});

describe('attribution', () => {
  it('records which agent and which model produced the read', () => {
    const outcome = normalizeAcquisitionIntelligence({ ...base, raw: JSON.stringify(minimal) });
    expect(outcome.ok && outcome.result.runtime).toMatchObject({
      engine: 'hermes',
      agentProfile: 'landos-acquisition-analyst',
      model: 'gemma4:12b',
    });
    expect(outcome.ok && outcome.result.dossierFingerprint).toBe('abc123');
    expect(outcome.ok && outcome.result.basis.coverageAbsent).toEqual(['Current zoning']);
  });
});
