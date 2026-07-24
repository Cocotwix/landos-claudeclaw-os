import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';

import { buildDashboardApp } from '../dashboard.js';
import { _initTestDatabase } from '../db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { _initTestLandosDb, getLandosDb } from './db.js';
import { writeParcelIdentity } from './parcel-identity.js';
import { upsertPropertyCard } from './property-card.js';

const TOKEN = 'test-contract-token';
let app: Hono;

beforeAll(() => {
  app = buildDashboardApp(undefined) as unknown as Hono;
});

beforeEach(() => {
  _initTestDatabase();
  _initTestLandosDb();
});

const q = (url: string) => `${url}${url.includes('?') ? '&' : '?'}token=${TOKEN}`;
const get = (url: string) => app.request(q(url));
const post = (url: string) => app.request(q(url), {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
});

function unresolvedDeal(): number {
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Unresolved zoning fixture', leadType: 'test' });
  const property = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: 'Unresolved zoning fixture',
    county: 'Citrus',
    state: 'FL',
    addressMatched: true,
    agentId: 'zoning-route-test',
  }).card;
  linkPropertyToDeal({ dealCardId: deal.id, cardId: property.id, role: 'subject' });
  writeParcelIdentity(deal.id, {
    subjectCardId: property.id,
    state: 'unresolved',
    basis: 'No exact parcel identifier.',
    confidence: 0,
    evidenceRefs: [],
  }, 'zoning-route-test');
  return deal.id;
}

function counts() {
  return getLandosDb().prepare(`
    SELECT
      (SELECT COUNT(*) FROM landos_property_identity_version) identities,
      (SELECT COUNT(*) FROM landos_property_evidence_item) evidence,
      (SELECT COUNT(*) FROM landos_property_collector_job) jobs,
      (SELECT COUNT(*) FROM landos_property_collector_attempt) attempts,
      (SELECT COUNT(*) FROM landos_property_zoning_artifact) artifacts,
      (SELECT COUNT(*) FROM landos_deal_intelligence_snapshot) snapshots
  `).get();
}

describe('Zoning / land-use command-query boundary', () => {
  it('18. GET and Deal Card loading remain read-only: no research, no jobs, no snapshot writes', async () => {
    const id = unresolvedDeal();
    const before = counts();
    const first = await get(`/api/landos/deal-cards/${id}/zoning-land-use`);
    const second = await get(`/api/landos/deal-cards/${id}/zoning-land-use`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await first.json()) as unknown).toEqual({ zoningLandUse: null });
    expect((await second.json()) as unknown).toEqual({ zoningLandUse: null });
    expect(counts()).toEqual(before);
  });

  it('explicit POST on an unresolved identity persists honestly blocked domains and stays repeat-safe', async () => {
    const id = unresolvedDeal();
    const response = await post(`/api/landos/deal-cards/${id}/zoning-land-use/rebuild`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.zoningLandUse.jobs).toHaveLength(5);
    expect(body.zoningLandUse.jobs.every((job: any) => job.status === 'blocked')).toBe(true);
    expect(body.zoningLandUse.snapshot.completeness.identity).toBe('needs_resolution');
    expect(body.zoningLandUse.snapshot.analysis.jurisdiction.determination).toBe('undetermined');
    const after = counts();
    const query = await get(`/api/landos/deal-cards/${id}/zoning-land-use`);
    expect(query.status).toBe(200);
    expect(((await query.json()) as any).zoningLandUse.snapshot.id).toBe(body.zoningLandUse.snapshot.id);
    expect(counts()).toEqual(after);
  });

  it('validates ids and missing Deal Cards on every zoning route', async () => {
    expect((await get('/api/landos/deal-cards/nope/zoning-land-use')).status).toBe(400);
    expect((await post('/api/landos/deal-cards/nope/zoning-land-use/rebuild')).status).toBe(400);
    expect((await get('/api/landos/deal-cards/999/zoning-land-use')).status).toBe(404);
    expect((await post('/api/landos/deal-cards/999/zoning-land-use/rebuild')).status).toBe(404);
    expect((await get('/api/landos/deal-cards/999/zoning-land-use/artifacts/1/page/1')).status).toBe(404);
    expect((await get('/api/landos/deal-cards/1/zoning-land-use/artifacts/nope/page/1')).status).toBe(400);
  });
});
