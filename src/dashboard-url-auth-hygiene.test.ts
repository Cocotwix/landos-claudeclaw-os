import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';

import { buildDashboardApp } from './dashboard.js';
import { _initTestDatabase } from './db.js';

const TOKEN = process.env.DASHBOARD_TOKEN as string;

function sourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    return entry.isDirectory() ? sourceFiles(full) : /\.(?:ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe('dashboard URL auth hygiene', () => {
  let app: Hono;

  beforeEach(() => {
    _initTestDatabase();
    app = buildDashboardApp(undefined) as unknown as Hono;
  });

  it('exchanges the loopback bootstrap header for an HttpOnly session without putting a credential in a URL', async () => {
    const created = await app.request('http://localhost/api/dashboard/browser-pairings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-landos-bootstrap-token': TOKEN },
      body: JSON.stringify({ returnTo: '/dept/acquisitions?deal=89&section=overview' }),
    });
    expect(created.status).toBe(201);
    const pairing = await created.json() as { pairingUrl: string };
    const pairingUrl = new URL(pairing.pairingUrl);
    expect(pairingUrl.searchParams.has('token')).toBe(false);
    expect(pairingUrl.hash.length).toBeGreaterThan(1);

    const claimed = await app.request('http://localhost/api/dashboard/browser-pairings/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: pairingUrl.hash.slice(1) }),
    });
    expect(claimed.status).toBe(201);
    const cookie = claimed.headers.get('set-cookie') || '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');

    const authenticated = await app.request('http://localhost/api/health', {
      headers: { cookie: cookie.split(';')[0] },
    });
    expect(authenticated.status).toBe(200);
  });

  it('keeps normal frontend navigation, API, artifact and source URLs free of token query parameters', () => {
    const webRoot = fileURLToPath(new URL('../web/src', import.meta.url));
    const offenders = sourceFiles(webRoot).filter((file) => /[?&]token=/.test(fs.readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);

    const botSource = fs.readFileSync(fileURLToPath(new URL('./bot.ts', import.meta.url)), 'utf8');
    expect(botSource).not.toContain('?token=');
    expect(botSource).toContain("'x-landos-bootstrap-token': DASHBOARD_TOKEN");
  });
});
