// Redesign QA — the Property Board is a PIPELINE OVERVIEW and the Deal Card is
// the single workspace. These are live in-process API checks (Hono app.request,
// fresh in-memory landos.db) proving the board payload carries exactly what the
// concise card needs and that a card click can always reach ONE canonical Deal
// Card via the ensure endpoint — never a second intelligence surface. Env stubs
// mirror dashboard.contract.test.ts so config.ts sees a token at import time.

process.env.DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || 'test-contract-token';
process.env.ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID || '1';

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { _initTestDatabase } from '../db.js';
import { _initTestLandosDb } from './db.js';
import { buildDashboardApp } from '../dashboard.js';
import type { Hono } from 'hono';

const TOKEN = 'test-contract-token';
let app: Hono;

beforeAll(() => { app = buildDashboardApp(undefined) as unknown as Hono; });
beforeEach(() => { _initTestDatabase(); _initTestLandosDb(); });

const get = (p: string) => app.request(p + (p.includes('?') ? '&' : '?') + 'token=' + TOKEN);
const post = (p: string, body: unknown) =>
  app.request(p + (p.includes('?') ? '&' : '?') + 'token=' + TOKEN, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
const jsonOf = (r: Response) => r.json() as Promise<any>;

describe('Property Board redesign — pipeline board opens the one Deal Card', () => {
  it('board cards carry the concise summary fields (deal_card_id, next_action, acres, owner)', async () => {
    await post('/api/landos/property-cards', {
      entity: 'TY_LAND_BIZ', activeInputAddress: '101 Pipeline Rd, Huntsville TN',
      county: 'Scott', state: 'TN', owner: 'EIGHINGER', acres: 5.12,
    });
    const board = await jsonOf(await get('/api/landos/board?entity=TY_LAND_BIZ'));
    const card = Object.values<any>(board.columns).flat()[0];
    expect(card).toBeTruthy();
    // The new board-summary enrichment fields exist on every card.
    expect('deal_card_id' in card).toBe(true);
    expect('next_action' in card).toBe(true);
    // Concise operational info the redesigned card renders.
    expect(card.owner).toBe('EIGHINGER');
    expect(card.acres).toBe(5.12);
    expect(card.county).toBe('Scott');
    expect(card.state).toBe('TN');
  });

  it('a card click always resolves a single canonical Deal Card (ensure endpoint)', async () => {
    const card = (await jsonOf(await post('/api/landos/property-cards', {
      entity: 'TY_LAND_BIZ', activeInputAddress: '9 Deal Rd, Oneida TN',
    }))).card;

    // First click creates+links the Deal Card...
    const first = await get(`/api/landos/property-cards/${card.id}/deal-card`);
    expect(first.status).toBe(200);
    const dealCardId = (await jsonOf(first)).dealCardId;
    expect(typeof dealCardId).toBe('number');

    // ...a second click returns the SAME Deal Card (no duplicate surface).
    const second = await jsonOf(await get(`/api/landos/property-cards/${card.id}/deal-card`));
    expect(second.dealCardId).toBe(dealCardId);

    // And the board now reports that same linked deal_card_id for direct nav.
    const board = await jsonOf(await get('/api/landos/board?entity=TY_LAND_BIZ'));
    const boardCard = Object.values<any>(board.columns).flat().find((c: any) => c.id === card.id);
    expect(boardCard.deal_card_id).toBe(dealCardId);
  });

  it('the ensure endpoint 404s for a missing property card', async () => {
    const res = await get('/api/landos/property-cards/999999/deal-card');
    expect(res.status).toBe(404);
  });
});
