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
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Unresolved government record fixture', leadType: 'test' });
  const property = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: 'Unresolved government record fixture',
    county: 'White',
    state: 'GA',
    addressMatched: true,
    agentId: 'government-route-test',
  }).card;
  linkPropertyToDeal({ dealCardId: deal.id, cardId: property.id, role: 'subject' });
  writeParcelIdentity(deal.id, {
    subjectCardId: property.id,
    state: 'unresolved',
    basis: 'No exact parcel identifier.',
    confidence: 0,
    evidenceRefs: [],
  }, 'government-route-test');
  return deal.id;
}

function counts() {
  return getLandosDb().prepare(`
    SELECT
      (SELECT COUNT(*) FROM landos_property_identity_version) identities,
      (SELECT COUNT(*) FROM landos_property_evidence_item) evidence,
      (SELECT COUNT(*) FROM landos_property_collector_job) jobs,
      (SELECT COUNT(*) FROM landos_property_collector_attempt) attempts,
      (SELECT COUNT(*) FROM landos_property_record_artifact) artifacts,
      (SELECT COUNT(*) FROM landos_deal_intelligence_snapshot) snapshots
  `).get();
}

describe('Government Records command/query boundary', () => {
  it('24. GET is read-only and never builds research or a snapshot while loading', async () => {
    const id = unresolvedDeal();
    const before = counts();
    const first = await get(`/api/landos/deal-cards/${id}/government-records`);
    const second = await get(`/api/landos/deal-cards/${id}/government-records`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await first.json()) as unknown).toEqual({ governmentRecords: null });
    expect((await second.json()) as unknown).toEqual({ governmentRecords: null });
    expect(counts()).toEqual(before);
  });

  it('explicit POST creates five independently blocked jobs for an unresolved identity', async () => {
    const id = unresolvedDeal();
    const response = await post(`/api/landos/deal-cards/${id}/government-records/rebuild`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.governmentRecords.jobs).toHaveLength(5);
    expect(body.governmentRecords.jobs.every((job: any) => job.status === 'blocked')).toBe(true);
    expect(body.governmentRecords.snapshot.completeness.identity).toBe('needs_resolution');
    const after = counts();
    const query = await get(`/api/landos/deal-cards/${id}/government-records`);
    expect(query.status).toBe(200);
    expect(((await query.json()) as any).governmentRecords.snapshot.id).toBe(body.governmentRecords.snapshot.id);
    expect(counts()).toEqual(after);
  });

  it('validates ids and missing Deal Cards', async () => {
    expect((await get('/api/landos/deal-cards/nope/government-records')).status).toBe(400);
    expect((await post('/api/landos/deal-cards/nope/government-records/rebuild')).status).toBe(400);
    expect((await get('/api/landos/deal-cards/999/government-records')).status).toBe(404);
    expect((await post('/api/landos/deal-cards/999/government-records/rebuild')).status).toBe(404);
  });
});
