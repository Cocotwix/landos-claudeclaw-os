// Item 16 — mission acceptance. A child must not pass because its process exited.

import { describe, expect, it } from 'vitest';

import {
  acceptanceContributes,
  anyFieldPresentCheck,
  evaluateMissionAcceptance,
  fieldEqualsCheck,
  isHandbackValuePresent,
  isUsableHandback,
  readHandbackPath,
  scopeIntegrityCheck,
  type MissionAcceptanceContract,
  type MissionDelivery,
} from './mission-acceptance.js';
import { missionChildStatusForAcceptance } from './mission-graph.js';

const ctx = { scope: 'deal_card', scopeId: 32, childKey: 'parcel_identity', childLabel: 'Parcel identity' };

const CONTRACT: MissionAcceptanceContract = {
  requiredFields: ['apn'],
  expectedFields: ['county'],
  checks: [scopeIntegrityCheck('dealCardId')],
};

const returned = (
  reported: 'completed' | 'partial' | 'blocked',
  result: unknown,
  summary = 'lane summary',
): MissionDelivery => ({ kind: 'returned', reported, summary, result });

describe('handback field reading', () => {
  it('reads dot paths and refuses to traverse a non-object', () => {
    expect(readHandbackPath({ a: { b: 7 } }, 'a.b')).toBe(7);
    expect(readHandbackPath({ a: 1 }, 'a.b')).toBeUndefined();
    expect(readHandbackPath(null, 'a')).toBeUndefined();
  });

  it('treats a blank string as absent but an empty array as a real answer', () => {
    expect(isHandbackValuePresent('   ')).toBe(false);
    expect(isHandbackValuePresent('073090 04200')).toBe(true);
    // A lane that honestly found zero rows delivered a result.
    expect(isHandbackValuePresent([])).toBe(true);
    expect(isHandbackValuePresent(0)).toBe(true);
    expect(isHandbackValuePresent(Number.NaN)).toBe(false);
    expect(isHandbackValuePresent(null)).toBe(false);
  });

  it('only counts a plain object as a joinable handback', () => {
    expect(isUsableHandback({ apn: '1' })).toBe(true);
    expect(isUsableHandback([1, 2])).toBe(false);
    expect(isUsableHandback('text')).toBe(false);
    expect(isUsableHandback(null)).toBe(false);
  });
});

describe('a clean exit is not a pass', () => {
  it('REJECTS a lane that reported completed but handed back nothing', () => {
    const verdict = evaluateMissionAcceptance(CONTRACT, returned('completed', null), ctx);
    expect(verdict.state).toBe('rejected');
    expect(verdict.reason).toMatch(/handed back no structured result/i);
    expect(acceptanceContributes(verdict.state)).toBe(false);
  });

  it('REJECTS a lane that handed back something the parent cannot join', () => {
    expect(evaluateMissionAcceptance(CONTRACT, returned('completed', 'just a string'), ctx).state).toBe('rejected');
    expect(evaluateMissionAcceptance(CONTRACT, returned('completed', [1, 2]), ctx).state).toBe('rejected');
  });

  it('REJECTS a lane whose result is missing a required field, and names the term', () => {
    const verdict = evaluateMissionAcceptance(CONTRACT, returned('completed', { county: 'Roane', dealCardId: 32 }), ctx);
    expect(verdict.state).toBe('rejected');
    expect(verdict.reason).toMatch(/apn/);
    expect(verdict.checks.find((check) => check.id === 'field:apn')!.passed).toBe(false);
  });

  it('ACCEPTS a valid result and states every check that passed', () => {
    const verdict = evaluateMissionAcceptance(
      CONTRACT,
      returned('completed', { apn: '073090 04200', county: 'Roane', dealCardId: 32 }),
      ctx,
    );
    expect(verdict.state).toBe('accepted');
    expect(verdict.checks.every((check) => check.passed)).toBe(true);
    expect(acceptanceContributes(verdict.state)).toBe(true);
  });
});

describe('incomplete is distinguished from unacceptable', () => {
  it('reports INCOMPLETE when only an expected term is missing', () => {
    const verdict = evaluateMissionAcceptance(CONTRACT, returned('completed', { apn: '073090 04200', dealCardId: 32 }), ctx);
    expect(verdict.state).toBe('incomplete');
    expect(verdict.reason).toMatch(/county/);
    // It still contributes: an incomplete result is useful, just not full.
    expect(acceptanceContributes(verdict.state)).toBe(true);
  });

  it('never upgrades a lane that honestly reported itself partial', () => {
    const verdict = evaluateMissionAcceptance(
      CONTRACT,
      returned('partial', { apn: '073090 04200', county: 'Roane', dealCardId: 32 }, 'only half the record was readable'),
      ctx,
    );
    expect(verdict.state).toBe('incomplete');
    expect(verdict.reason).toMatch(/reported its own result as partial/i);
  });
});

describe('a precise blocker stays distinguishable from an execution failure', () => {
  it('reports BLOCKED with the lane"s own stated reason and runs no checks', () => {
    const verdict = evaluateMissionAcceptance(
      CONTRACT,
      returned('blocked', null, 'No subject property card is linked to this Deal Card.'),
      ctx,
    );
    expect(verdict.state).toBe('blocked');
    expect(verdict.reason).toBe('No subject property card is linked to this Deal Card.');
    expect(verdict.checks).toEqual([]);
  });

  it('reports FAILED for a throw, never re-reading it as an unacceptable result', () => {
    const verdict = evaluateMissionAcceptance(CONTRACT, { kind: 'threw', summary: 'timed out after 30s' }, ctx);
    expect(verdict.state).toBe('failed');
    expect(verdict.reason).toBe('timed out after 30s');
  });

  it('keeps blocked, rejected and failed as three different states', () => {
    const blocked = evaluateMissionAcceptance(CONTRACT, returned('blocked', null, 'no coverage'), ctx).state;
    const rejected = evaluateMissionAcceptance(CONTRACT, returned('completed', null), ctx).state;
    const failed = evaluateMissionAcceptance(CONTRACT, { kind: 'threw', summary: 'boom' }, ctx).state;
    expect(new Set([blocked, rejected, failed]).size).toBe(3);
  });
});

describe('scope integrity', () => {
  it('REJECTS a handback that names another scope row', () => {
    const verdict = evaluateMissionAcceptance(
      CONTRACT,
      returned('completed', { apn: '1', county: 'Roane', dealCardId: 47 }),
      ctx,
    );
    expect(verdict.state).toBe('rejected');
    expect(verdict.reason).toMatch(/Scope mismatch/i);
  });

  it('does not invent a mismatch when the handback names no scope row at all', () => {
    const verdict = evaluateMissionAcceptance(
      { checks: [scopeIntegrityCheck('dealCardId')] },
      returned('completed', { apn: '1' }),
      ctx,
    );
    expect(verdict.state).toBe('accepted');
  });
});

describe('check helpers and safety', () => {
  it('fieldEqualsCheck fails when the value is outside the allowed set', () => {
    const contract: MissionAcceptanceContract = {
      checks: [fieldEqualsCheck({ id: 'confirmed', field: 'identityState', allowed: ['confirmed'], severity: 'expected', requirement: 'confirmed' })],
    };
    expect(evaluateMissionAcceptance(contract, returned('completed', { identityState: 'provisional' }), ctx).state).toBe('incomplete');
    expect(evaluateMissionAcceptance(contract, returned('completed', { identityState: 'confirmed' }), ctx).state).toBe('accepted');
  });

  it('anyFieldPresentCheck passes when at least one path carries a value', () => {
    const contract: MissionAcceptanceContract = {
      checks: [anyFieldPresentCheck({ id: 'named', fields: ['address', 'apn'], severity: 'required', requirement: 'named' })],
    };
    expect(evaluateMissionAcceptance(contract, returned('completed', { apn: '1' }), ctx).state).toBe('accepted');
    expect(evaluateMissionAcceptance(contract, returned('completed', { address: '', apn: null }), ctx).state).toBe('rejected');
  });

  it('a check that throws is a failed requirement, never a silent pass', () => {
    const contract: MissionAcceptanceContract = {
      checks: [{
        id: 'explodes',
        requirement: 'must be evaluable',
        severity: 'expected',
        evaluate: () => { throw new Error('bad check'); },
      }],
    };
    const verdict = evaluateMissionAcceptance(contract, returned('completed', { a: 1 }), ctx);
    expect(verdict.state).toBe('rejected');
    expect(verdict.checks[0].passed).toBe(false);
    expect(verdict.checks[0].severity).toBe('required');
  });

  it('reports NOT_EVALUATED, never accepted, when no contract is declared', () => {
    const verdict = evaluateMissionAcceptance(undefined, returned('completed', { a: 1 }), ctx);
    expect(verdict.state).toBe('not_evaluated');
    expect(verdict.reason).toMatch(/nothing about it is verified/i);
  });
});

describe('acceptance decides the recorded child status', () => {
  it('maps every verdict onto the status the mission records', () => {
    expect(missionChildStatusForAcceptance('accepted', 'completed')).toBe('completed');
    expect(missionChildStatusForAcceptance('incomplete', 'completed')).toBe('partial');
    expect(missionChildStatusForAcceptance('rejected', 'completed')).toBe('rejected');
    expect(missionChildStatusForAcceptance('blocked', 'blocked')).toBe('blocked');
    expect(missionChildStatusForAcceptance('failed', 'completed')).toBe('failed');
  });

  it('cannot promote a self-reported partial to completed', () => {
    expect(missionChildStatusForAcceptance('accepted', 'partial')).toBe('partial');
  });

  it('records what the lane said when nothing was declared to verify', () => {
    expect(missionChildStatusForAcceptance('not_evaluated', 'completed')).toBe('completed');
    expect(missionChildStatusForAcceptance('not_evaluated', 'blocked')).toBe('blocked');
  });
});
