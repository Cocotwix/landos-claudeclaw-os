process.env.DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || 'test-contract-token';
process.env.ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID || '1';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { _initTestDatabase } from '../db.js';
import { buildDashboardApp } from '../dashboard.js';
import { _initTestLandosDb } from './db.js';

const TOKEN = 'test-contract-token';
let app: Hono;
beforeAll(() => { app = buildDashboardApp(undefined) as unknown as Hono; });
beforeEach(() => { _initTestDatabase(); _initTestLandosDb(); });
const q = (path: string) => `${path}${path.includes('?') ? '&' : '?'}token=${TOKEN}`;
const get = (path: string) => app.request(q(path));
const post = (path: string, body: unknown) => app.request(q(path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const patch = (path: string, body: unknown) => app.request(q(path), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const del = (path: string) => app.request(q(path), { method: 'DELETE' });

async function createLead(rawInput: string) {
  const response = await post('/api/landos/leads/manual', { entity: 'TY_LAND_BIZ', rawInput });
  expect(response.status).toBe(201);
  return response.json() as Promise<any>;
}

async function boardCards(): Promise<any[]> {
  const response = await get('/api/landos/board?entity=TY_LAND_BIZ');
  expect(response.status).toBe(200);
  const board = await response.json() as any;
  return Object.values<any[]>(board.columns).flat();
}

describe('canonical opportunity Acquisitions board', () => {
  it('renders one active card per opportunity and keeps research on that card', async () => {
    const lead = await createLead('Seller Jane, 10 acres at 123 Pine Road, Rowan County, NC. APN 123-45-678.');
    const cards = await boardCards();
    expect(cards.filter((card) => card.id === lead.opportunityId)).toHaveLength(1);
    expect(cards.find((card) => card.id === lead.opportunityId)).toMatchObject({ dealCardId: lead.dealCardId, pipelineStage: 'researching' });
  });

  it('moves the same opportunity to Pursuing without copying a card', async () => {
    const lead = await createLead('Seller Alex, parcel APN 987-65-432 in Rowan County, NC.');
    const moved = await patch(`/api/landos/opportunities/${lead.opportunityId}/pipeline-stage`, { stage: 'pursuing' });
    expect(moved.status).toBe(200);
    const cards = await boardCards();
    const matches = cards.filter((card) => card.id === lead.opportunityId);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ lifecycle: 'deal', pipelineStage: 'pursuing', dealCardId: lead.dealCardId });
  });

  it('removes a trashed lead from the active board and restores the same card', async () => {
    const lead = await createLead('QA Trash seller, APN 333-22-111 in Rowan County, NC.');
    expect((await boardCards()).some((card) => card.id === lead.opportunityId)).toBe(true);
    expect((await del(`/api/landos/deal-cards/${lead.dealCardId}`)).status).toBe(200);
    expect((await boardCards()).some((card) => card.id === lead.opportunityId)).toBe(false);
    expect((await post(`/api/landos/deal-cards/${lead.dealCardId}/restore`, {})).status).toBe(200);
    expect((await boardCards()).filter((card) => card.id === lead.opportunityId)).toHaveLength(1);
  });
});
