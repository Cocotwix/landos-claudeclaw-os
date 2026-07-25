// Pass 2 upstream adopt (#51 security hardening, manual reimplementation):
// constant-time dashboard-token comparison + CORS origin allowlist. Verifies the
// auth gate still behaves (right token passes, wrong rejects incl. same-length).
//
// The CORS expectation here was DELIBERATELY changed in the Phase 2 security
// pass. It used to assert the back-compat default of
// `Access-Control-Allow-Origin: *`; that wildcard is now closed by default, so
// the assertion asserts the denial instead. Full origin-policy coverage lives
// in src/dashboard-cors.test.ts.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { Hono } from 'hono';
import { _initTestDatabase } from '../db.js';
import { buildDashboardApp } from '../dashboard.js';
import { _initTestLandosDb } from './db.js';

const TOKEN = 'test-contract-token';
let app: Hono;
beforeAll(() => { app = buildDashboardApp(undefined) as unknown as Hono; });
beforeEach(() => { _initTestDatabase(); _initTestLandosDb(); });

describe('dashboard timing-safe token + CORS (upstream #51 adopt)', () => {
  it('accepts the correct token', async () => {
    const res = await app.request('/api/health?token=' + TOKEN);
    expect(res.status).not.toBe(401);
  });

  it('rejects a wrong token of different length', async () => {
    const res = await app.request('/api/health?token=wrong');
    expect(res.status).toBe(401);
  });

  it('rejects a wrong token of the SAME length (constant-time compare still denies)', async () => {
    const sameLen = 'x'.repeat(TOKEN.length);
    expect(sameLen.length).toBe(TOKEN.length);
    const res = await app.request('/api/health?token=' + sameLen);
    expect(res.status).toBe(401);
  });

  it('no longer answers a foreign origin with a wildcard', async () => {
    const res = await app.request('/api/health?token=' + TOKEN, { headers: { Origin: 'http://example.com' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('still allows the local dashboard origin', async () => {
    const res = await app.request('/api/health?token=' + TOKEN, { headers: { Origin: 'http://localhost:3141' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3141');
    expect(res.status).not.toBe(401);
  });
});
