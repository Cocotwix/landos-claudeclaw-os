import { describe, expect, it } from 'vitest';
import { detectAccessRequirement, mergeAuthDetections } from './public-record-auth-detection.js';

const page = (body: string, over: Partial<{ status: number; url: string; contentType: string; blocked: boolean }> = {}) => ({
  status: 200, url: 'https://records.example-county.gov/search', contentType: 'text/html', body, ...over,
});

const PUBLIC_SEARCH = `
  <html><body><h1>Parcel Search</h1>
  <form><input name="parcelId" /><button>Search</button></form>
  </body></html>`;

const LOGIN_WALL = `
  <html><body><h2>Sign In</h2>
  <p>You must be logged in to search property records.</p>
  <form><input type="password" name="pw" /></form>
  <a href="/register">Create an account</a>
  </body></html>`;

describe('auth-not-required detection', () => {
  it('treats a structured service answer as proof no account is needed', () => {
    const detection = detectAccessRequirement(page('{"features":[{"attributes":{}}]}', { contentType: 'application/json' }));
    expect(detection).toMatchObject({ requirement: 'auth_not_required', registration: 'not_applicable' });
  });

  it('reads an open public search as open', () => {
    const detection = detectAccessRequirement(page(PUBLIC_SEARCH));
    expect(detection.requirement).toBe('auth_not_required');
    expect(detection.registration).toBe('not_applicable');
  });

  it('does not turn a header sign-in link into a wall when search is public', () => {
    const detection = detectAccessRequirement(page(`<a href="/login">Log in</a>${PUBLIC_SEARCH}`));
    expect(detection.requirement).toBe('auth_optional');
    expect(detection.loginUrl).toBe('https://records.example-county.gov/login');
  });
});

describe('auth-required detection', () => {
  it('reads an explicit login wall', () => {
    const detection = detectAccessRequirement(page(LOGIN_WALL));
    expect(detection.requirement).toBe('auth_required');
    expect(detection.registrationUrl).toBe('https://records.example-county.gov/register');
  });

  it('reads a 401 and a redirect to a login path', () => {
    expect(detectAccessRequirement(page('<html>no</html>', { status: 401 })).requirement).toBe('auth_required');
    expect(detectAccessRequirement(page('<html>hi</html>', { url: 'https://x.gov/account/login' })).requirement).toBe('auth_required');
  });

  it('reports an edge refusal as unknown rather than inventing a login wall', () => {
    const detection = detectAccessRequirement(page('Just a moment...', { status: 403, blocked: true }));
    expect(detection.requirement).toBe('unknown');
    expect(detection.registration).toBe('not_applicable');
  });

  it('names an auth wall with no registration path as unsupported', () => {
    const detection = detectAccessRequirement(page('<p>Registered users only.</p>'));
    expect(detection).toMatchObject({ requirement: 'auth_required', registration: 'unsupported_registration' });
  });
});

describe('free-registration detection', () => {
  it('confirms free only when the source says so', () => {
    const stated = detectAccessRequirement(page(`${LOGIN_WALL}<p>Create a free account to continue.</p>`));
    expect(stated.registration).toBe('free_registration_supported');
    // A registration link alone proves a path exists, not that it costs nothing.
    expect(detectAccessRequirement(page(LOGIN_WALL)).registration).toBe('free_registration_unproven');
  });

  it('reports a closed registration', () => {
    const detection = detectAccessRequirement(page(`${LOGIN_WALL}<p>Registration is currently closed.</p>`));
    expect(detection.registration).toBe('registration_closed');
  });
});

describe('paid-access detection', () => {
  it.each([
    'A subscription is required to search these records.',
    'Please purchase credits to continue.',
    'A payment method is required.',
    'Access is $25.00 per report.',
    'Start your free trial today.',
  ])('stops on %s', (marker) => {
    const detection = detectAccessRequirement(page(`${LOGIN_WALL}<p>${marker}</p>`));
    expect(detection.registration).toBe('paid_access_required');
  });

  it('separates paid DOCUMENTS behind a free login from paid ACCESS', () => {
    const detection = detectAccessRequirement(page(`${LOGIN_WALL}<p>Create a free account.</p><p>Purchase this document. Add to cart.</p>`));
    expect(detection.registration).toBe('free_registration_supported');
    expect(detection.paidRecordsObserved).toBe(true);
  });
});

describe('merging repeated observations', () => {
  it('lets proven open access outrank a later gate, and never downgrades paid', () => {
    const open = detectAccessRequirement(page('{"features":[]}', { contentType: 'application/json' }));
    const gate = detectAccessRequirement(page(LOGIN_WALL));
    expect(mergeAuthDetections(gate, open).requirement).toBe('auth_not_required');
    expect(mergeAuthDetections(open, gate).requirement).toBe('auth_not_required');

    const paid = detectAccessRequirement(page(`${LOGIN_WALL}<p>A subscription is required.</p>`));
    const free = detectAccessRequirement(page(`${LOGIN_WALL}<p>Create a free account.</p>`));
    expect(mergeAuthDetections(paid, free).registration).toBe('paid_access_required');
    expect(mergeAuthDetections(free, paid).registration).toBe('paid_access_required');
  });
});
