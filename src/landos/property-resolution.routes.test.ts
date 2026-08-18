import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hono } from 'hono';

vi.mock('./hermes-free-search.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hermes-free-search.js')>();
  return { ...actual, createHermesFreeSearch: () => async () => [] };
});

import { buildDashboardApp } from '../dashboard.js';
import { _initTestDatabase } from '../db.js';
import { _initTestLandosDb, getLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { upsertPropertyCard } from './property-card.js';
import { invokeRuntimeCapability } from './capability-registry.js';
import { PROPERTY_RESOLUTION_CAPABILITY_ID } from './property-resolution-capability.js';
import { PropertyIntelligenceStore } from './property-intelligence-store.js';
import { initialDealIntelligenceSpecialists } from './deal-intelligence-run.js';
import { createOpportunity, getOpportunity, updateOpportunityResearchStatus } from './opportunity.js';
import { createResearchMission, getResearchMission, researchConstraintsFor } from './opportunity-research-mission.js';
import { supersedeRecoverableLegacyResearchMissions } from './routes.js';

const TOKEN = 'test-contract-token';
let app: Hono;

beforeEach(() => {
  _initTestDatabase();
  _initTestLandosDb();
  app = buildDashboardApp(undefined) as unknown as Hono;
});

const get = (url: string) => app.request(`${url}${url.includes('?') ? '&' : '?'}token=${TOKEN}`);
const post = (url: string, body: unknown) => app.request(`${url}${url.includes('?') ? '&' : '?'}token=${TOKEN}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('Property Resolution Capability routes', () => {
  it('publishes the capability registry', async () => {
    const response = await get('/api/landos/capabilities');
    expect(response.status).toBe(200);
    const body = await response.json() as { capabilities: Array<{ id: string; name: string; contractVersion: string }> };
    expect(body.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'property-resolution', name: 'Property Resolution', contractVersion: '1.0' }),
    ]));
  });

  it('runs a one-off Tools research session honestly without creating CRM records', async () => {
    const before = {
      leads: (getLandosDb().prepare('SELECT count(*) AS n FROM landos_lead').get() as { n: number }).n,
      deals: (getLandosDb().prepare('SELECT count(*) AS n FROM landos_deal_card').get() as { n: number }).n,
    };
    const rawInput = 'APN 042-123.00-000, Williamson County, TN';
    const response = await post('/api/landos/capabilities/property-resolution/invoke', { rawInput, entity: 'TY_LAND_BIZ' });
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.result).toMatchObject({
      capability: { id: 'property-resolution' },
      status: 'NEEDS_INPUT',
      subjectResolution: 'UNRESOLVED',
      canonicalSubject: { kind: 'research_session', temporary: true },
    });
    const after = {
      leads: (getLandosDb().prepare('SELECT count(*) AS n FROM landos_lead').get() as { n: number }).n,
      deals: (getLandosDb().prepare('SELECT count(*) AS n FROM landos_deal_card').get() as { n: number }).n,
    };
    expect(after).toEqual(before);
    const invocation = getLandosDb().prepare(`
      SELECT caller_type, subject_entity, research_session_id FROM landos_capability_invocation
    `).get() as Record<string, unknown>;
    expect(invocation).toMatchObject({ caller_type: 'tools', subject_entity: 'TY_LAND_BIZ' });
    expect(invocation.research_session_id).toBe(body.result.canonicalSubject.id);

    const compatibility = await post('/api/landos/property/resolve', { text: rawInput, entity: 'TY_LAND_BIZ' });
    expect(compatibility.status).toBe(200);
    const compatibilityBody = await compatibility.json() as any;
    expect(compatibilityBody.resolution.invocationId).toBe(body.result.invocationId);
    expect(compatibilityBody.resolution.execution.reused).toBe(true);
  });

  it('scopes Deal Card resolution reads by both property and deal', async () => {
    const { card } = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: 'Shared parcel', apn: '042-123.00-000', county: 'Williamson', state: 'TN',
      verified: true, verificationSource: 'Williamson County Property Assessor',
    });
    const dealA = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Deal A' });
    const dealB = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Deal B' });
    linkPropertyToDeal({ dealCardId: dealA.id, cardId: card.id, role: 'subject' });
    linkPropertyToDeal({ dealCardId: dealB.id, cardId: card.id, role: 'subject' });
    const invoke = (dealCardId: number) => invokeRuntimeCapability({
      capabilityId: PROPERTY_RESOLUTION_CAPABILITY_ID,
      caller: { type: 'deal_card', ref: `deal:${dealCardId}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId },
      mode: 'refresh',
    });
    const a = await invoke(dealA.id);
    const readA = await (await get(`/api/landos/deal-cards/${dealA.id}/property-resolution`)).json() as any;
    const readBBefore = await (await get(`/api/landos/deal-cards/${dealB.id}/property-resolution`)).json() as any;
    expect(readA.result.invocationId).toBe(a.invocationId);
    expect(readBBefore.result).toBeNull();
    const b = await invoke(dealB.id);
    const readAAfter = await (await get(`/api/landos/deal-cards/${dealA.id}/property-resolution`)).json() as any;
    const readBAfter = await (await get(`/api/landos/deal-cards/${dealB.id}/property-resolution`)).json() as any;
    expect(readAAfter.result.invocationId).toBe(a.invocationId);
    expect(readBAfter.result.invocationId).toBe(b.invocationId);
  });

  it('reuses an active Deal Intelligence run instead of launching a second resolver', async () => {
    const { card } = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: 'Active run parcel', state: 'TN' });
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Active run deal' });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
    new PropertyIntelligenceStore().createRun({
      runId: 'di_active_resolution_guard',
      dealCardId: deal.id,
      trigger: 'test',
      startedAt: new Date().toISOString(),
      specialists: initialDealIntelligenceSpecialists(),
    });
    const before = (getLandosDb().prepare('SELECT count(*) AS n FROM landos_capability_invocation').get() as { n: number }).n;
    const response = await post(`/api/landos/deal-cards/${deal.id}/property-resolution/run`, { actor: 'operator' });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ reusedActiveRun: true, active: { runId: 'di_active_resolution_guard' } });
    const after = (getLandosDb().prepare('SELECT count(*) AS n FROM landos_capability_invocation').get() as { n: number }).n;
    expect(after).toBe(before);
  });

  it('terminally supersedes recoverable legacy startup work without provider fanout', () => {
    const opportunity = createOpportunity({ entity: 'TY_LAND_BIZ', title: 'Legacy recovery', rawInput: 'Map 042 Parcel 123, Fairview TN' });
    const mission = createResearchMission(opportunity, researchConstraintsFor(opportunity), 'legacy-startup');
    const completedOpportunity = createOpportunity({ entity: 'TY_LAND_BIZ', title: 'Completed newer work', rawInput: 'APN 001, Knox County TN' });
    const olderMission = createResearchMission(completedOpportunity, researchConstraintsFor(completedOpportunity), 'legacy-startup');
    updateOpportunityResearchStatus(completedOpportunity.id, 'complete', { actor: 'capability-rooted-test', note: 'Newer capability-rooted run completed.' });
    const superseded = supersedeRecoverableLegacyResearchMissions();
    expect(superseded).toEqual(expect.arrayContaining([mission.id, olderMission.id]));
    expect(getResearchMission(mission.id)).toMatchObject({
      status: 'failed',
      attempt: 0,
      summary: 'Legacy research was safely superseded without running its resolver or providers.',
    });
    expect(getResearchMission(mission.id)?.safeNextAction).toMatch(/Property Resolution/i);
    expect(getResearchMission(olderMission.id)?.status).toBe('failed');
    expect(getOpportunity(completedOpportunity.id)?.researchStatus).toBe('complete');
    expect((getLandosDb().prepare('SELECT count(*) AS n FROM landos_capability_invocation').get() as { n: number }).n).toBe(0);
    expect((getLandosDb().prepare('SELECT count(*) AS n FROM landos_public_record_outcome').get() as { n: number }).n).toBe(0);
  });
});
