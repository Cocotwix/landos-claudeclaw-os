/**
 * Dashboard cross-origin policy.
 *
 * LandOS authenticates the dashboard with hashed browser sessions: a pairing
 * code is exchanged for an opaque token held in an HttpOnly, SameSite=Strict
 * cookie, and only its hash is stored server-side. That model is stronger than
 * a static bearer token pasted into every URL — a SameSite=Strict cookie is
 * never attached to a cross-site request in the first place.
 *
 * These tests pin BOTH halves of the resulting contract:
 *   - the origin allowlist is closed by default and no longer answers '*';
 *   - the session model is untouched by that change — an allowed origin still
 *     buys a caller nothing without a credential.
 *
 * Every token here is SYNTHETIC (supplied by src/test-env-setup.ts).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';

import { _initTestDatabase } from './db.js';
import { buildDashboardApp, resolveCorsOrigin } from './dashboard.js';

const TOKEN = process.env.DASHBOARD_TOKEN as string;

let app: Hono;

beforeAll(() => {
  _initTestDatabase();
  app = buildDashboardApp(undefined) as unknown as Hono;
});

/** Access-Control-Allow-Origin for a request carrying `origin`, or null. */
async function acao(origin?: string, path = '/api/health'): Promise<string | null> {
  const headers: Record<string, string> = {};
  if (origin) headers.Origin = origin;
  const res = await app.request(`${path}?token=${TOKEN}`, { headers });
  return res.headers.get('Access-Control-Allow-Origin');
}

// ── The policy function ──────────────────────────────────────────────

describe('resolveCorsOrigin', () => {
  it('never answers with a wildcard', () => {
    const inputs = [
      undefined,
      'http://localhost:3141',
      'https://evil.example.com',
      'null',
      'not a url',
    ];
    for (const input of inputs) {
      expect(resolveCorsOrigin(input, [], '')).not.toBe('*');
    }
  });

  it('allows loopback origins on any port and scheme', () => {
    for (const origin of [
      'http://localhost:3141',
      'http://localhost:5173',
      'https://localhost:3141',
      'http://127.0.0.1:3141',
      'http://[::1]:3141',
      'http://0.0.0.0:3141',
    ]) {
      expect(resolveCorsOrigin(origin, [], '')).toBe(origin);
    }
  });

  it('allows the configured DASHBOARD_URL origin', () => {
    expect(resolveCorsOrigin('https://landos.example.com', [], 'landos.example.com'))
      .toBe('https://landos.example.com');
  });

  it('allows an origin named explicitly in DASHBOARD_CORS_ORIGINS', () => {
    expect(resolveCorsOrigin('https://ops.example.com', ['https://ops.example.com'], ''))
      .toBe('https://ops.example.com');
  });

  it('denies an unapproved cross-origin request', () => {
    expect(resolveCorsOrigin('https://evil.example.com', [], 'landos.example.com')).toBeNull();
  });

  it('denies a lookalike of the configured host', () => {
    // Suffix matching is how allowlists get bypassed; this must be exact.
    for (const origin of [
      'https://landos.example.com.evil.test',
      'https://evil-landos.example.com.attacker.test',
      'https://notlandos.example.com',
    ]) {
      expect(resolveCorsOrigin(origin, [], 'landos.example.com')).toBeNull();
    }
  });

  it('denies a lookalike of a loopback host', () => {
    for (const origin of [
      'https://localhost.evil.test',
      'https://127.0.0.1.evil.test',
      'https://mylocalhost.test',
    ]) {
      expect(resolveCorsOrigin(origin, [], '')).toBeNull();
    }
  });

  it('denies a malformed or opaque Origin', () => {
    for (const origin of ['not a url', 'null', '', '://']) {
      expect(resolveCorsOrigin(origin, [], '')).toBeNull();
    }
  });

  it('omits the header entirely when there is no Origin', () => {
    // Same-origin fetches, curl, the health probe and the managed runtime all
    // arrive without an Origin and must be unaffected.
    expect(resolveCorsOrigin(undefined, ['https://ops.example.com'], 'x.test')).toBeNull();
  });

  it('matches allowlist entries exactly, not by prefix', () => {
    expect(resolveCorsOrigin('https://ops.example.com.evil.test', ['https://ops.example.com'], ''))
      .toBeNull();
  });
});

// ── The live app ─────────────────────────────────────────────────────

describe('dashboard CORS headers', () => {
  it('echoes a loopback origin rather than a wildcard', async () => {
    expect(await acao('http://localhost:3141')).toBe('http://localhost:3141');
  });

  it('serves the local dashboard normally', async () => {
    const res = await app.request(`/api/health?token=${TOKEN}`, {
      headers: { Origin: 'http://localhost:3141' },
    });
    expect(res.status).toBe(200);
  });

  it('refuses to advertise access to an unapproved origin', async () => {
    expect(await acao('https://evil.example.com')).toBeNull();
  });

  it('sends no Access-Control-Allow-Origin when no Origin is present', async () => {
    expect(await acao(undefined)).toBeNull();
  });

  it('still answers requests that carry no Origin', async () => {
    const res = await app.request(`/api/health?token=${TOKEN}`);
    expect(res.status).toBe(200);
  });

  it('sets Vary: Origin so a cache cannot cross-serve responses', async () => {
    const res = await app.request(`/api/health?token=${TOKEN}`, {
      headers: { Origin: 'http://localhost:3141' },
    });
    expect(res.headers.get('Vary')).toContain('Origin');
  });

  it('never sends Access-Control-Allow-Credentials', async () => {
    // Its absence is load-bearing: it is what stops a browser handing a
    // credentialed response to a foreign page.
    const res = await app.request(`/api/health?token=${TOKEN}`, {
      headers: { Origin: 'http://localhost:3141' },
    });
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });

  it('denies the preflight for an unapproved origin', async () => {
    const res = await app.request('/api/health', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('allows the preflight for a loopback origin', async () => {
    const res = await app.request('/api/health', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:3141' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3141');
  });
});

// ── The session model is unchanged ───────────────────────────────────

describe('session authentication is unaffected by the origin policy', () => {
  it('still rejects an unauthenticated API request from an allowed origin', async () => {
    // An allowed Origin is not a credential. This is the check that proves the
    // CORS change did not become a way in.
    const res = await app.request('/api/health', {
      headers: { Origin: 'http://localhost:3141' },
    });
    expect(res.status).toBe(401);
  });

  it('still rejects an unauthenticated API request with no Origin', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(401);
  });

  it('still rejects a bad token', async () => {
    const res = await app.request('/api/health?token=not-the-token', {
      headers: { Origin: 'http://localhost:3141' },
    });
    expect(res.status).toBe(401);
  });

  it('still rejects a state-changing request from a foreign origin', async () => {
    // The pre-existing CSRF middleware, untouched by this change.
    const res = await app.request(`/api/kill-switches?token=${TOKEN}`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });
});
