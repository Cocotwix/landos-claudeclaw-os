// Doctrine tests for specialist intelligence outlook state.
//
// Two things are locked here and must stay locked:
//
//   1. AGE ALONE NEVER MAKES INTELLIGENCE STALE. Property, Market, Seller and
//      Deal Brain answer from their persisted read three days, three weeks or
//      three months later while their material inputs are unchanged. No day
//      counter, no age-triggered model call, no age-triggered research.
//   2. OUTLOOK CHANGE IS SEMANTIC. A rewritten opinion is UNCHANGED unless the
//      specialist itself says its judgment moved.
//
// The Knowledge Compiler is deliberately out of scope: its 90/180-day
// jurisdiction verification windows are reusable-reference knowledge freshness,
// a different system, and this suite must never be read as governing it.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  outlookComparisonPrompt,
  parseOutlookVerdict,
  pendingOutlook,
  resolveOutlook,
  outlookIsUpdated,
  type IntelligenceOutlook,
} from './intelligence-outlook.js';
import { sellerOutlookFrom } from './intelligence-stack.js';
import { backfillCurrentReads, parseCurrentRead, currentReadSynthesisPrompt } from './current-read-backfill.js';

const NOW = () => new Date('2026-08-26T12:00:00.000Z');
const READ_A = 'The tract is worth pursuing.\n\nAccess is the controlling unknown.';
const READ_A_REWORDED = 'This tract is worth pursuing.\n\nThe controlling unknown remains access.';
const READ_B = 'The tract no longer clears the bar: the survey shows the usable area is half what the record claims, and the two-lot split is dead.';

const priorOutlook = (overrides: Partial<IntelligenceOutlook> = {}): IntelligenceOutlook => ({
  status: 'INITIAL', readVersion: 1, previousReadVersion: null, changedAt: null, changeSummary: null, changeDrivers: [], ...overrides,
});

describe('outlook state machine', () => {
  it('C. a new read reaching the same conclusion is UNCHANGED', () => {
    const outlook = resolveOutlook({
      prior: priorOutlook(),
      priorRead: READ_A,
      nextRead: READ_B,
      verdict: { materiallyChanged: false, changeSummary: null, changeDrivers: [] },
      now: NOW,
    });
    expect(outlook.status).toBe('UNCHANGED');
    expect(outlook.previousReadVersion).toBe(1);
    expect(outlook.readVersion).toBe(2);
    expect(outlookIsUpdated(outlook)).toBe(false);
  });

  it('D. a materially changed conclusion is UPDATED and carries its metadata', () => {
    const outlook = resolveOutlook({
      prior: priorOutlook(),
      priorRead: READ_A,
      nextRead: READ_B,
      verdict: {
        materiallyChanged: true,
        changeSummary: 'The split thesis is dead; the deal is now a hold-or-pass on usable area.',
        changeDrivers: ['recorded survey', 'usable acreage'],
      },
      now: NOW,
    });
    expect(outlook.status).toBe('UPDATED');
    expect(outlook.changedAt).toBe('2026-08-26T12:00:00.000Z');
    expect(outlook.changeSummary).toContain('split thesis is dead');
    expect(outlook.changeDrivers).toEqual(['recorded survey', 'usable acreage']);
    expect(outlookIsUpdated(outlook)).toBe(true);
  });

  it('E. mere rewording never qualifies as UPDATED, even if a verdict claims otherwise', () => {
    const outlook = resolveOutlook({
      prior: priorOutlook(),
      priorRead: READ_A,
      nextRead: READ_A_REWORDED,
      verdict: { materiallyChanged: false, changeSummary: null, changeDrivers: [] },
      now: NOW,
    });
    expect(outlook.status).toBe('UNCHANGED');
  });

  it('identical prose is UNCHANGED without any verdict at all', () => {
    const outlook = resolveOutlook({ prior: priorOutlook(), priorRead: READ_A, nextRead: READ_A, now: NOW });
    expect(outlook.status).toBe('UNCHANGED');
    expect(outlook.changedAt).toBeNull();
  });

  it('an unusable comparison reply holds UNCHANGED rather than inventing a change', () => {
    expect(parseOutlookVerdict('the model refused')).toBeNull();
    const outlook = resolveOutlook({ prior: priorOutlook(), priorRead: READ_A, nextRead: READ_B, verdict: null, now: NOW });
    expect(outlook.status).toBe('UNCHANGED');
  });

  it('the first read ever is INITIAL and does not glow', () => {
    const outlook = resolveOutlook({ prior: null, priorRead: null, nextRead: READ_A, now: NOW });
    expect(outlook.status).toBe('INITIAL');
    expect(outlook.previousReadVersion).toBeNull();
    expect(outlook.readVersion).toBe(1);
    expect(outlookIsUpdated(outlook)).toBe(false);
  });

  it('holds a prior change stamp while the outlook stays UNCHANGED', () => {
    const outlook = resolveOutlook({
      prior: priorOutlook({ status: 'UPDATED', readVersion: 4, changedAt: '2026-05-01T00:00:00.000Z' }),
      priorRead: READ_A,
      nextRead: READ_B,
      verdict: { materiallyChanged: false, changeSummary: null, changeDrivers: [] },
      now: NOW,
    });
    expect(outlook.status).toBe('UNCHANGED');
    expect(outlook.changedAt).toBe('2026-05-01T00:00:00.000Z');
    expect(outlook.readVersion).toBe(5);
  });

  it('parses both snake_case and camelCase verdicts', () => {
    expect(parseOutlookVerdict('{"materially_changed":true,"change_summary":"x","change_drivers":["a"]}'))
      .toEqual({ materiallyChanged: true, changeSummary: 'x', changeDrivers: ['a'] });
    expect(parseOutlookVerdict('noise {"materiallyChanged":false} trailing')?.materiallyChanged).toBe(false);
  });

  it('the comparison prompt tells the specialist that time is never a change', () => {
    const prompt = outlookComparisonPrompt({ layerLabel: 'Property Intelligence', priorRead: READ_A, nextRead: READ_B });
    expect(prompt).toContain('Time passing is never a change');
    expect(prompt).toContain('materially change');
    expect(prompt).toContain('schema, or interface was reshaped');
  });
});

describe('F/G. seller change state reuses the existing seller architecture', () => {
  it('F. a pre-contact deal is INITIAL/Pending and never a fabricated update', () => {
    const pending = pendingOutlook();
    expect(pending.status).toBe('INITIAL');
    expect(outlookIsUpdated(pending)).toBe(false);
    expect(pending.changeSummary).toBeNull();
  });

  it('the first established seller read is INITIAL, not UPDATED', () => {
    const outlook = sellerOutlookFrom(null, { sellerTrajectory: 'First contact made.', materialChanges: [] }, NOW);
    expect(outlook.status).toBe('INITIAL');
  });

  it('G. a genuine seller event maps the existing material changes onto UPDATED', () => {
    const outlook = sellerOutlookFrom(
      { version: 2, outlook: priorOutlook({ readVersion: 2 }) },
      {
        sellerTrajectory: 'The seller moved off list price and named a closing deadline.',
        materialChanges: [
          { dimension: 'price expectation', direction: 'decreased' },
          { dimension: 'urgency', direction: 'increased' },
        ],
      },
      NOW,
    );
    expect(outlook.status).toBe('UPDATED');
    expect(outlook.changeDrivers).toEqual(['price expectation', 'urgency']);
    expect(outlook.changeSummary).toContain('off list price');
  });

  it('a re-reasoned seller read with only stable dimensions stays UNCHANGED', () => {
    const outlook = sellerOutlookFrom(
      { version: 3, outlook: priorOutlook({ readVersion: 3 }) },
      { sellerTrajectory: 'Nothing material moved.', materialChanges: [{ dimension: 'urgency', direction: 'stable' }] },
      NOW,
    );
    expect(outlook.status).toBe('UNCHANGED');
  });
});

describe('A/B. age alone never makes intelligence stale', () => {
  const sources = ['intelligence-stack.ts', 'intelligence-outlook.ts', 'current-read-backfill.ts']
    .map((file) => ({ file, text: readFileSync(path.join(process.cwd(), 'src', 'landos', file), 'utf-8') }));

  it('A. no specialist layer carries an age or day-count staleness threshold', () => {
    // The Knowledge Compiler's own 90/180-day jurisdiction windows live in its
    // own module and are intentionally untouched by this assertion.
    const ageThreshold = /\b(?:7|14|30|60|90|180)\s*\*\s*24\s*\*|MAX_AGE|maxAgeDays|staleAfterDays|ageDays|DAY_MS|STALE_AFTER/;
    for (const source of sources) {
      expect(source.text, `${source.file} introduced an age-based staleness threshold`).not.toMatch(ageThreshold);
    }
  });

  it('A. staleness is decided by input fingerprints, never by a clock', () => {
    const stack = sources.find((source) => source.file === 'intelligence-stack.ts')!.text;
    // Every staleness decision in the stack compares fingerprints of inputs.
    expect(stack).toMatch(/layerFingerprint/);
    // `now`/generatedAt may only stamp provenance — never gate a refresh.
    expect(stack).not.toMatch(/now\(\)[^\n]*[<>]=?[^\n]*generatedAt/);
    expect(stack).not.toMatch(/generatedAt[^\n]*[<>]=?[^\n]*now\(\)/);
  });

  it('A. the outlook decision never reads a clock to decide status', () => {
    const outlook = sources.find((source) => source.file === 'intelligence-outlook.ts')!.text;
    const machine = outlook.slice(outlook.indexOf('export function resolveOutlook'));
    // The single permitted clock read stamps a change that already happened.
    expect(machine.match(/now\(\)/g) ?? []).toHaveLength(1);
    expect(machine).toContain("changedAt: input.now().toISOString()");
  });

  it('B. only a changed material input can invalidate a layer, and doing so costs no clock', () => {
    const first = resolveOutlook({ prior: null, priorRead: null, nextRead: READ_A, now: NOW });
    // Three months later, the same read against the same inputs: still the
    // same product, no new version, no model call — resolveOutlook is not even
    // consulted, and consulting it with an unchanged read is UNCHANGED.
    const later = resolveOutlook({ prior: first, priorRead: READ_A, nextRead: READ_A, now: () => new Date('2026-11-26T12:00:00.000Z') });
    expect(later.status).toBe('UNCHANGED');
    expect(later.changedAt).toBeNull();
  });
});

describe('current read backfill', () => {
  const propertyProduct = {
    read: 'Short read.',
    expertReview: 'FULL EXPERT REVIEW PROSE. '.repeat(40),
    score: 72,
  };

  it('generates a missing read with exactly one model call and marks it INITIAL', async () => {
    const calls: Array<{ layer: string; prompt: string }> = [];
    const written: Array<Record<string, unknown>> = [];
    const results = await backfillCurrentReads({
      layers: ['property'],
      deps: {
        readProduct: () => ({ ...propertyProduct }),
        writeProduct: (_layer, product) => { written.push(product); },
        invoke: async (layer, prompt) => {
          calls.push({ layer, prompt });
          return JSON.stringify({ current_expert_read: `${READ_A}` });
        },
        now: NOW,
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toContain('FULL EXPERT REVIEW PROSE');
    expect(results[0].status).toBe('generated');
    expect(results[0].outlook?.status).toBe('INITIAL');
    expect(written[0].currentExpertRead).toBe(READ_A);
    // The full expert review is preserved verbatim; nothing is shortened.
    expect(written[0].expertReview).toBe(propertyProduct.expertReview);
    expect(written[0].read).toBe(propertyProduct.read);
  });

  it('costs zero model calls when the product already carries its read', async () => {
    let calls = 0;
    const results = await backfillCurrentReads({
      layers: ['market'],
      deps: {
        readProduct: () => ({ currentExpertRead: READ_A }),
        writeProduct: () => { throw new Error('must not write'); },
        invoke: async () => { calls += 1; return '{}'; },
        now: NOW,
      },
    });
    expect(calls).toBe(0);
    expect(results[0].status).toBe('present');
    expect(results[0].modelCalls).toBe(0);
  });

  it('never writes a product when the specialist returns nothing usable', async () => {
    const results = await backfillCurrentReads({
      layers: ['deal'],
      deps: {
        readProduct: () => ({ read: 'x' }),
        writeProduct: () => { throw new Error('must not write'); },
        invoke: async () => 'sorry',
        now: NOW,
      },
    });
    expect(results[0].status).toBe('failed');
  });

  it('the synthesis prompt forbids new research and forbids a field recap', () => {
    const prompt = currentReadSynthesisPrompt({ layer: 'property', product: propertyProduct, expertReview: 'review' });
    expect(prompt).toContain('You are not being asked to redo it, research anything, or change any conclusion.');
    expect(prompt).toContain('NOT a summary of fields');
    expect(prompt).toContain('Add NO new fact');
    expect(prompt).not.toMatch(/word limit of|at most \d+ words|maximum of \d+ characters/);
  });

  it('preserves paragraph shape and never truncates the read', () => {
    const long = `${'A materially complete paragraph. '.repeat(60)}\n\n${'A second paragraph. '.repeat(60)}`;
    const parsed = parseCurrentRead(JSON.stringify({ current_expert_read: long }), 'property');
    expect(parsed).not.toBeNull();
    expect(parsed!.split('\n\n')).toHaveLength(2);
    expect(parsed!.length).toBeGreaterThan(1_500);
  });
});
