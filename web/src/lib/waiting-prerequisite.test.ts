// Stage 2 closeout — a prerequisite wait is not an error.
//
// Every Tools call site used to render `POST /api/landos/... failed: 409` when
// the subject was still being confirmed. That is a developer's string, not
// something an operator can act on, and the wait is a normal moment in the New
// Lead flow now that acceptance happens after the bounded review.
//
// One shared seam formats every tool failure, so this pins both halves: the
// wait reads as a wait, and every other failure keeps the server's own words.

import { describe, expect, it } from 'vitest';

// `api.ts` reads `window.location.href` once at module load for the dashboard
// token, and this repository's vitest runs in node with no DOM environment. The
// module is imported dynamically after the one global it needs exists, so the
// formatter under test is exercised as shipped rather than re-implemented.
const store = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
};
Object.assign(globalThis, {
  window: { location: { href: 'http://localhost:3141/dept/acquisitions' }, history: { replaceState: () => {} } },
  sessionStorage: store(),
  localStorage: store(),
});

const { ApiError, WAITING_FOR_SUBJECT_MESSAGE, isWaitingForPrerequisite, operatorErrorMessage } = await import('./api');

const waiting = (body: unknown) =>
  new ApiError(409, body, 'POST /api/landos/deal-cards/42/zoning-subdivision/capability failed: 409');

describe('a structured waiting_prerequisite 409 renders as a wait', () => {
  it('recognises the `error` spelling the capability route returns', () => {
    const caught = waiting({ error: 'waiting_prerequisite', unmetPrerequisites: ['parcel'] });
    expect(isWaitingForPrerequisite(caught)).toBe(true);
    expect(operatorErrorMessage(caught)).toBe(WAITING_FOR_SUBJECT_MESSAGE);
  });

  it('recognises the `outcome` spelling the same route also carries', () => {
    const caught = waiting({ outcome: 'waiting_prerequisite', capabilityId: 'zoning-subdivision' });
    expect(isWaitingForPrerequisite(caught)).toBe(true);
    expect(operatorErrorMessage(caught)).toBe(WAITING_FOR_SUBJECT_MESSAGE);
  });

  it('never leaks the endpoint or the status code to the operator', () => {
    const message = operatorErrorMessage(waiting({ error: 'waiting_prerequisite' }));
    expect(message).not.toMatch(/failed: 409/);
    expect(message).not.toMatch(/\/api\/landos/);
    expect(message).toContain('Waiting for LandOS to confirm the acquisition subject');
  });
});

describe('ordinary failures keep ordinary handling', () => {
  it('an unrelated 409 is still an error, in the server’s own words', () => {
    const caught = new ApiError(409, { error: 'This Deal Card already has a run in flight.' }, 'POST /x failed: 409');
    expect(isWaitingForPrerequisite(caught)).toBe(false);
    expect(operatorErrorMessage(caught)).toBe('This Deal Card already has a run in flight.');
  });

  it('a 409 with no structured body is not mistaken for a wait', () => {
    const caught = new ApiError(409, {}, 'POST /x failed: 409');
    expect(isWaitingForPrerequisite(caught)).toBe(false);
    expect(operatorErrorMessage(caught)).toBe('POST /x failed: 409');
  });

  it('the same marker on a non-409 status is not a wait', () => {
    const caught = new ApiError(500, { error: 'waiting_prerequisite' }, 'POST /x failed: 500');
    expect(isWaitingForPrerequisite(caught)).toBe(false);
    expect(operatorErrorMessage(caught)).toBe('waiting_prerequisite');
  });

  it('a server message beats the developer-style wrapper', () => {
    const caught = new ApiError(400, { error: 'An address or APN is required.' }, 'POST /x failed: 400');
    expect(operatorErrorMessage(caught)).toBe('An address or APN is required.');
  });

  it('a transport failure reads as a transport failure', () => {
    expect(operatorErrorMessage(new TypeError('Failed to fetch'))).toContain('did not reach LandOS');
  });

  it('a plain Error and a non-Error both survive formatting', () => {
    expect(operatorErrorMessage(new Error('boom'))).toBe('boom');
    expect(operatorErrorMessage('boom')).toBe('boom');
  });
});
