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

const q = (path: string) => `${path}${path.includes('?') ? '&' : '?'}token=${TOKEN}`;
const get = (path: string) => app.request(q(path));
const post = (path: string, body: unknown = {}) => app.request(q(path), {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

function unresolvedDeal(): number {
  const deal = createDealCard({
    entity: 'TY_LAND_BIZ',
    title: 'Unresolved White County tract',
    leadType: 'test',
  });
  const property = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: 'Unresolved White County tract',
    county: 'White',
    state: 'GA',
    addressMatched: true,
    agentId: 'route-test',
  }).card;
  linkPropertyToDeal({ dealCardId: deal.id, cardId: property.id, role: 'subject' });
  writeParcelIdentity(deal.id, {
    subjectCardId: property.id,
    state: 'unresolved',
    basis: 'No exact parcel identifier was supplied.',
    confidence: 0,
    evidenceRefs: [],
  }, 'route-test');
  return deal.id;
}

function verticalSliceCounts(): Record<string, number> {
  return getLandosDb().prepare(`
    SELECT
      (SELECT COUNT(*) FROM landos_property_identity_version) AS identities,
      (SELECT COUNT(*) FROM landos_property_evidence_item) AS evidence,
      (SELECT COUNT(*) FROM landos_property_collector_job) AS jobs,
      (SELECT COUNT(*) FROM landos_property_collector_attempt) AS attempts,
      (SELECT COUNT(*) FROM landos_deal_intelligence_snapshot) AS snapshots
  `).get() as Record<string, number>;
}

describe('Property Summary command/query boundary', () => {
  it('GET returns null before a command and performs no writes', async () => {
    const id = unresolvedDeal();
    const before = verticalSliceCounts();
    const first = await get(`/api/landos/deal-cards/${id}/property-summary`);
    const second = await get(`/api/landos/deal-cards/${id}/property-summary`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await first.json()) as unknown).toEqual({ propertySummary: null });
    expect((await second.json()) as unknown).toEqual({ propertySummary: null });
    expect(verticalSliceCounts()).toEqual(before);
  });

  it('POST rebuild creates an unresolved-safe snapshot and subsequent GET remains read-only', async () => {
    const id = unresolvedDeal();
    const command = await post(`/api/landos/deal-cards/${id}/property-summary/rebuild`);
    expect(command.status).toBe(200);
    const body = (await command.json()) as any;
    expect(body.propertySummary.identity.status).toBe('unresolved');
    expect(body.propertySummary.assessorGisJob.status).toBe('blocked');
    expect(body.propertySummary.snapshot.summary.parcelSpecificAllowed).toBe(false);
    expect(body.propertySummary.snapshot.summary.property).toBeNull();

    const afterCommand = verticalSliceCounts();
    const query = await get(`/api/landos/deal-cards/${id}/property-summary`);
    expect(query.status).toBe(200);
    expect(((await query.json()) as any).propertySummary.snapshot.summary.state).toBe('resolution_required');
    expect(verticalSliceCounts()).toEqual(afterCommand);
  });

  it('validates ids and missing Deal Cards at both boundaries', async () => {
    expect((await get('/api/landos/deal-cards/nope/property-summary')).status).toBe(400);
    expect((await post('/api/landos/deal-cards/nope/property-summary/rebuild')).status).toBe(400);
    expect((await get('/api/landos/deal-cards/999/property-summary')).status).toBe(404);
    expect((await post('/api/landos/deal-cards/999/property-summary/rebuild')).status).toBe(404);
  });
});
