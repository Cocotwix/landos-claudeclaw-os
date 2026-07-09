import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { Hono } from 'hono';
import { _initTestDatabase } from '../db.js';
import { buildDashboardApp } from '../dashboard.js';
import { _initTestLandosDb } from './db.js';

// LIVE request-level QA for Deal Card Trash — mounts the REAL dashboard app and
// exercises the exact HTTP path the browser uses (auth middleware → route handler
// → DB), reproducing and pinning the operator flow that was failing live because
// the route did not exist in the stale server build.

const TOKEN = 'test-contract-token';
let app: Hono;
beforeAll(() => { app = buildDashboardApp(undefined) as unknown as Hono; });
beforeEach(() => { _initTestDatabase(); _initTestLandosDb(); });

const q = (path: string) => path + (path.includes('?') ? '&' : '?') + 'token=' + TOKEN;
const get = (path: string) => app.request(q(path));
const del = (path: string) => app.request(q(path), { method: 'DELETE' });
const post = (path: string, body?: unknown) => app.request(q(path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

async function createCard(title = 'Trash route deal'): Promise<number> {
  const res = await post('/api/landos/deal-cards', { entity: 'TY_LAND_BIZ', title });
  expect(res.status).toBe(201);
  return ((await res.json()) as any).dealCard.id as number;
}
async function activeIds(): Promise<number[]> {
  return (((await (await get('/api/landos/deal-cards')).json()) as any).dealCards as any[]).map((d) => d.id);
}
async function trashIds(): Promise<number[]> {
  return (((await (await get('/api/landos/deal-cards/trash')).json()) as any).dealCards as any[]).map((d) => d.id);
}

describe('Deal Card Trash — live HTTP flow', () => {
  it('Delete moves the card to Trash: gone from active, present in Trash, persists across refetch', async () => {
    const id = await createCard();
    expect(await activeIds()).toContain(id);

    // 1) Delete button → DELETE /api/landos/deal-cards/:id
    const res = await del(`/api/landos/deal-cards/${id}`);
    expect(res.status).toBe(200);                                   // 3) response successful
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(typeof body.deletedAt).toBe('number');                  // 2) deleted_at written

    // 4) active list filters it out — immediately AND on a fresh refetch (refresh)
    expect(await activeIds()).not.toContain(id);
    expect(await activeIds()).not.toContain(id);
    // 7) Trash view shows it
    expect(await trashIds()).toContain(id);

    // 5) open-card route still returns the deleted card (for detail/restore)
    const open = await get(`/api/landos/deal-cards/${id}`);
    expect(open.status).toBe(200);
    expect(((await open.json()) as any).dealCard.deleted_at).toBeTypeOf('number');
  });

  it('Restore brings the card back to the active list', async () => {
    const id = await createCard();
    await del(`/api/landos/deal-cards/${id}`);
    const res = await post(`/api/landos/deal-cards/${id}/restore`, {});
    expect(res.status).toBe(200);
    expect(await activeIds()).toContain(id);
    expect(await trashIds()).not.toContain(id);
  });

  it('Permanent delete is REFUSED from the active list (must be in Trash first)', async () => {
    const id = await createCard();
    const res = await del(`/api/landos/deal-cards/${id}/permanent`);
    expect(res.status).toBe(409);
    // still present (not active-deleted, not purged)
    expect(await activeIds()).toContain(id);
  });

  it('Permanent delete works from Trash and removes the card entirely', async () => {
    const id = await createCard();
    await del(`/api/landos/deal-cards/${id}`);           // soft delete → Trash
    expect(await trashIds()).toContain(id);
    const res = await del(`/api/landos/deal-cards/${id}/permanent`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).permanentlyDeleted).toBe(true);
    expect(await trashIds()).not.toContain(id);
    expect(await activeIds()).not.toContain(id);
    expect((await get(`/api/landos/deal-cards/${id}`)).status).toBe(404);
  });

  it('GET /deal-cards/trash is not shadowed by /deal-cards/:id (route ordering)', async () => {
    const res = await get('/api/landos/deal-cards/trash');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.dealCards)).toBe(true); // a real trash payload, not a 404/"not found"
  });
});
