import { describe, it, expect } from 'vitest';

import { generateCommandPlan, NEVER_APPROVE_RAILS } from './command-planner.js';

describe('generateCommandPlan', () => {
  it('includes every plan section', () => {
    const out = generateCommandPlan({ title: 'plan', verdict: 'SAFE' });
    expect(out).toContain('## Inspect first');
    expect(out).toContain('## Safe bundled commands');
    expect(out).toContain('## Commands requiring separate approval');
    expect(out).toContain('## Never approve');
    expect(out).toContain('## Tests to run');
    expect(out).toContain('## Exact staging guidance');
    expect(out).toContain('## Commit guidance');
    expect(out).toContain('## Codex review handoff');
  });

  it('always emits the hard safety rails verbatim', () => {
    const out = generateCommandPlan({});
    for (const rail of NEVER_APPROVE_RAILS) {
      expect(out).toContain(rail);
    }
    // spot-check the most important rails are literally present
    expect(out).toContain('git add .');
    expect(out).toContain('git push before Codex');
    expect(out).toContain('.env');
    expect(out).toContain('paid');
  });

  it('warns up front when the lane verdict is STOP', () => {
    const out = generateCommandPlan({ verdict: 'STOP', categories: ['secrets_credentials'] });
    expect(out).toContain('Lane verdict: STOP');
    expect(out).toContain('Resolve the owner-owned decision');
    expect(out).toContain('secrets_credentials');
  });

  it('lists exact staging files when provided', () => {
    const out = generateCommandPlan({ expectedChangedFiles: ['src/forge/host-store.ts'] });
    expect(out).toContain('src/forge/host-store.ts');
    expect(out).toContain('never git add .');
  });

  it('is deterministic for the same input', () => {
    const input = { title: 't', verdict: 'SAFE' as const };
    expect(generateCommandPlan(input)).toBe(generateCommandPlan(input));
  });
});
