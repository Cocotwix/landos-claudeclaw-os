import { describe, expect, it } from 'vitest';

import {
  contributedMissionResult,
  dependencyBlock,
  gatherMissionChildren,
  initialMissionChildren,
  isTerminalMissionChildStatus,
  joinMissionChildren,
  planMissionWaves,
  upstreamContributions,
  type MissionChildSpec,
  type MissionChildState,
  type MissionChildStatus,
} from './mission-graph.js';

const SPECS: MissionChildSpec[] = [
  { key: 'a', label: 'A', purpose: 'root', role: 'required', dependsOn: [], timeoutMs: 1000 },
  { key: 'b', label: 'B', purpose: 'needs a', role: 'required', dependsOn: ['a'], timeoutMs: 1000 },
  { key: 'c', label: 'C', purpose: 'needs a', role: 'supporting', dependsOn: ['a'], timeoutMs: 1000 },
];

function child(key: string, status: MissionChildStatus, extras: Partial<MissionChildState> = {}): MissionChildState {
  const spec = SPECS.find((s) => s.key === key)!;
  return {
    key,
    label: spec.label,
    purpose: spec.purpose,
    role: spec.role,
    dependsOn: spec.dependsOn,
    status,
    summary: `${key} ${status}`,
    failureCategory: null,
    failureMessage: null,
    retryable: false,
    result: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    attempt: 1,
    ...extras,
  };
}

describe('planMissionWaves', () => {
  it('lays independent children into one wave and dependants into the next', () => {
    expect(planMissionWaves(SPECS)).toEqual([['a'], ['b', 'c']]);
  });

  it('rejects an empty definition', () => {
    expect(() => planMissionWaves([])).toThrow(/at least one child/i);
  });

  it('rejects a duplicate key', () => {
    expect(() => planMissionWaves([SPECS[0], SPECS[0]])).toThrow(/Duplicate mission child key: a/);
  });

  it('rejects an unknown dependency instead of stranding the child in queued', () => {
    const broken: MissionChildSpec[] = [
      { key: 'a', label: 'A', purpose: '', role: 'required', dependsOn: ['ghost'], timeoutMs: 1 },
    ];
    expect(() => planMissionWaves(broken)).toThrow(/depends on unknown child "ghost"/);
  });

  it('rejects a dependency cycle', () => {
    const cyclic: MissionChildSpec[] = [
      { key: 'a', label: 'A', purpose: '', role: 'required', dependsOn: ['b'], timeoutMs: 1 },
      { key: 'b', label: 'B', purpose: '', role: 'required', dependsOn: ['a'], timeoutMs: 1 },
    ];
    expect(() => planMissionWaves(cyclic)).toThrow(/dependency cycle/i);
  });

  it('rejects a self-dependency', () => {
    const selfDep: MissionChildSpec[] = [
      { key: 'a', label: 'A', purpose: '', role: 'required', dependsOn: ['a'], timeoutMs: 1 },
    ];
    expect(() => planMissionWaves(selfDep)).toThrow(/depends on itself/);
  });
});

describe('terminal + contribution rules', () => {
  it('treats every settled state as terminal and queued/running as not', () => {
    for (const status of ['completed', 'partial', 'failed', 'blocked', 'skipped', 'cancelled'] as const) {
      expect(isTerminalMissionChildStatus(status)).toBe(true);
    }
    expect(isTerminalMissionChildStatus('queued')).toBe(false);
    expect(isTerminalMissionChildStatus('running')).toBe(false);
  });

  it('counts only completed and partial as a usable contribution', () => {
    expect(contributedMissionResult('completed')).toBe(true);
    expect(contributedMissionResult('partial')).toBe(true);
    for (const status of ['failed', 'blocked', 'skipped', 'cancelled', 'queued', 'running'] as const) {
      expect(contributedMissionResult(status)).toBe(false);
    }
  });
});

describe('dependencyBlock', () => {
  it('returns null when every dependency contributed', () => {
    const children = new Map([['a', child('a', 'completed')]]);
    expect(dependencyBlock(SPECS[1], children)).toBeNull();
  });

  it('names the missing upstream contribution so the skip reason is explicit', () => {
    const children = new Map([['a', child('a', 'blocked')]]);
    const reason = dependencyBlock(SPECS[1], children);
    expect(reason).toMatch(/Skipped because an upstream contribution/);
    expect(reason).toContain('A (blocked)');
  });

  it('treats a partial upstream result as a real contribution', () => {
    const children = new Map([['a', child('a', 'partial')]]);
    expect(dependencyBlock(SPECS[1], children)).toBeNull();
  });
});

describe('upstreamContributions', () => {
  it('passes only contributing dependency handbacks to the child', () => {
    const children = new Map([['a', child('a', 'completed', { result: { apn: '073090 04200' } })]]);
    expect(upstreamContributions(SPECS[1], children)).toEqual({ a: { apn: '073090 04200' } });
  });

  it('passes nothing from a failed dependency', () => {
    const children = new Map([['a', child('a', 'failed', { result: { apn: 'x' } })]]);
    expect(upstreamContributions(SPECS[1], children)).toEqual({});
  });
});

describe('joinMissionChildren', () => {
  it('joins every handback and reports joined when nothing is missing', () => {
    const join = joinMissionChildren({
      specs: SPECS,
      children: [
        child('a', 'completed', { result: { v: 1 } }),
        child('b', 'completed', { result: { v: 2 } }),
        child('c', 'completed', { result: { v: 3 } }),
      ],
    });
    expect(join.status).toBe('joined');
    expect(join.contributions).toEqual({ a: { v: 1 }, b: { v: 2 }, c: { v: 3 } });
    expect(join.gaps).toEqual([]);
    expect(join.allTerminal).toBe(true);
    expect(join.outcome).toContain('Every child mission contributed');
  });

  it('stays running and refuses to complete while any child is non-terminal', () => {
    const join = joinMissionChildren({
      specs: SPECS,
      children: [child('a', 'completed'), child('b', 'running'), child('c', 'completed')],
    });
    expect(join.status).toBe('running');
    expect(join.allTerminal).toBe(false);
    expect(join.allRequiredTerminal).toBe(false);
    expect(join.outstanding.map((g) => g.key)).toEqual(['b']);
    expect(join.outcome).toMatch(/cannot complete yet/i);
    expect(join.outcome).toContain('B (running)');
  });

  it('reports failed and names a failed required child rather than ignoring it', () => {
    const join = joinMissionChildren({
      specs: SPECS,
      children: [
        child('a', 'completed', { result: { v: 1 } }),
        child('b', 'failed', { failureCategory: 'provider_unavailable', failureMessage: 'Provider refused the request.' }),
        child('c', 'completed'),
      ],
    });
    expect(join.status).toBe('failed');
    expect(join.requiredGaps.map((g) => g.key)).toEqual(['b']);
    expect(join.requiredGaps[0].reason).toBe('Provider refused the request.');
    expect(join.outcome).toContain('B (failed: provider_unavailable)');
    expect(join.outcome).toMatch(/did NOT complete/);
    // The successful sibling is still joined — one failure never discards the rest.
    expect(join.contributions).toHaveProperty('a');
  });

  it('reports blocked from the ROOT cause, not diluted by the children it stranded', () => {
    // `a` is blocked; `b` and `c` were skipped BECAUSE of it. A skipped child is
    // a consequence, so the parent must still read as blocked.
    const join = joinMissionChildren({
      specs: SPECS,
      children: [child('a', 'blocked'), child('b', 'skipped'), child('c', 'skipped')],
    });
    expect(join.status).toBe('blocked');
    expect(join.outcome).toMatch(/LandOS coverage or input gap, not evidence/);
    expect(join.outcome).toContain('A (blocked)');
    expect(join.outcome).toMatch(/never ran because their upstream contribution was missing/);
    // The stranded children are still listed as gaps — nothing is hidden.
    expect(join.gaps.map((g) => g.key)).toEqual(['a', 'b', 'c']);
  });

  it('reports failed from the root cause when a required child threw', () => {
    const join = joinMissionChildren({
      specs: SPECS,
      children: [child('a', 'failed', { failureCategory: 'network' }), child('b', 'skipped'), child('c', 'skipped')],
    });
    expect(join.status).toBe('failed');
    expect(join.outcome).toContain('A (failed: network)');
    expect(join.outcome).toMatch(/never ran because/);
  });

  it('reports joined_with_gaps when a required child was skipped by a supporting gap', () => {
    const supportingRoot: MissionChildSpec[] = [
      { key: 'a', label: 'A', purpose: '', role: 'supporting', dependsOn: [], timeoutMs: 1 },
      { key: 'b', label: 'B', purpose: '', role: 'required', dependsOn: ['a'], timeoutMs: 1 },
    ];
    const join = joinMissionChildren({
      specs: supportingRoot,
      children: [
        { ...child('a', 'blocked'), role: 'supporting' as const },
        { ...child('b', 'skipped'), role: 'required' as const, dependsOn: ['a'] },
      ],
    });
    expect(join.status).toBe('joined_with_gaps');
  });

  it('reports joined_with_gaps when only a supporting child is missing', () => {
    const join = joinMissionChildren({
      specs: SPECS,
      children: [child('a', 'completed'), child('b', 'completed'), child('c', 'blocked')],
    });
    expect(join.status).toBe('joined_with_gaps');
    expect(join.requiredGaps).toEqual([]);
    expect(join.gaps.map((g) => g.key)).toEqual(['c']);
    expect(join.outcome).toContain('Every required contribution is present');
    expect(join.outcome).toContain('C (blocked)');
  });

  it('never reports success over a declared child that has no record at all', () => {
    const join = joinMissionChildren({
      specs: SPECS,
      children: [child('a', 'completed'), child('b', 'completed')],
    });
    expect(join.status).toBe('running');
    expect(join.gaps.map((g) => g.key)).toContain('c');
    expect(join.gaps.find((g) => g.key === 'c')?.reason).toMatch(/No child mission record exists/);
  });

  it('orders contributions by definition order, not settle order', () => {
    const join = joinMissionChildren({
      specs: SPECS,
      children: [child('c', 'completed'), child('b', 'completed'), child('a', 'completed')],
    });
    expect(join.contributed).toEqual(['a', 'b', 'c']);
  });
});

describe('gatherMissionChildren + initialMissionChildren', () => {
  it('seeds every declared child as queued with its purpose as the summary', () => {
    const seeded = initialMissionChildren(SPECS);
    expect(seeded).toHaveLength(3);
    expect(seeded.every((c) => c.status === 'queued' && c.result === null && c.attempt === 0)).toBe(true);
    expect(seeded[1].summary).toBe('needs a');
  });

  it('gathers by definition order and drops rows for undeclared keys', () => {
    const gathered = gatherMissionChildren(SPECS, [
      child('b', 'completed'),
      child('a', 'completed'),
      { ...child('a', 'completed'), key: 'stray' },
    ]);
    expect([...gathered.keys()]).toEqual(['a', 'b']);
  });
});
