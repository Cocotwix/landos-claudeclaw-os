// Tools deal-reuse — a Tools run against an EXISTING Deal consumes that Deal's
// canonical Subject State (the same retained identity the Deal Card mission
// uses) and never re-resolves or reinterprets it; a subjectless Deal is a plain
// error, never a silent fallback to raw re-resolution. Cross-caller: the same
// registered capability serves the tools and deal_card callers identically.

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
import { COMPS_VALUATION_CAPABILITY_ID } from './comps-valuation-capability.js';

const TOKEN = 'test-contract-token';
let app: Hono;

beforeEach(() => {
  _initTestDatabase();
  _initTestLandosDb();
  app = buildDashboardApp(undefined) as unknown as Hono;
});

const post = (url: string, body: unknown) => app.request(`${url}?token=${TOKEN}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

function subjectDeal() {
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Highway 60' });
  const { card } = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: '5170 Highway 60, Hamilton County TN',
    apn: '105-016.00-000',
    county: 'Hamilton',
    state: 'TN',
    acres: 21.5,
    verified: true,
    verificationSource: 'Hamilton County Property Assessor',
  });
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
  return { deal, card };
}

describe('Tools deal-reuse subject mode', () => {
  it('runs a property capability against the selected Deal canonical subject without re-resolving identity', async () => {
    const { deal, card } = subjectDeal();
    const response = await post('/api/landos/capabilities/comps-valuation/invoke', { dealCardId: deal.id });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      resolution: unknown;
      result: { canonicalSubject: Record<string, unknown>; capability: { id: string } };
    };
    // No raw re-resolution ran: the Deal's canonical identity IS the subject.
    expect(body.resolution).toBeNull();
    expect(body.result.capability.id).toBe(COMPS_VALUATION_CAPABILITY_ID);
    expect(body.result.canonicalSubject).toMatchObject({
      kind: 'property',
      propertyCardId: card.id,
      dealCardId: deal.id,
      temporary: false,
    });
    const invocation = getLandosDb().prepare(`
      SELECT caller_type, subject_kind, subject_ref, subject_deal_card_id
      FROM landos_capability_invocation WHERE capability_id = ?
    `).get(COMPS_VALUATION_CAPABILITY_ID) as Record<string, unknown>;
    expect(invocation).toMatchObject({
      caller_type: 'tools',
      subject_kind: 'canonical_property',
      subject_ref: String(card.id),
      subject_deal_card_id: deal.id,
    });
  });

  it('a Deal without a subject property card is a plain error, never a silent raw fallback', async () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Empty deal' });
    const response = await post('/api/landos/capabilities/assessor-tax/invoke', { dealCardId: deal.id });
    expect(response.status).toBe(400);
    const body = await response.json() as { error: string };
    expect(body.error).toMatch(/has no subject property card/);
    const count = getLandosDb().prepare('SELECT count(*) AS n FROM landos_capability_invocation').get() as { n: number };
    expect(count.n).toBe(0);
  });

  it('cross-caller: deal_card and tools callers invoke the same implementation with identical result semantics', async () => {
    const { deal, card } = subjectDeal();
    const invoke = (callerType: 'tools' | 'deal_card') => invokeRuntimeCapability({
      capabilityId: COMPS_VALUATION_CAPABILITY_ID,
      caller: { type: callerType, ref: callerType === 'tools' ? 'tools:comps-valuation' : `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
      mode: 'refresh',
      parameters: { lane: 'retained_valuation' },
    });
    const toolsResult = await invoke('tools');
    const dealResult = await invoke('deal_card');
    // Same capability, same contract version, same canonical subject, same
    // outcome semantics — only run identity and timing may differ.
    expect(toolsResult.capability).toEqual(dealResult.capability);
    expect(toolsResult.canonicalSubject).toEqual(dealResult.canonicalSubject);
    expect(toolsResult.status).toBe(dealResult.status);
    expect(toolsResult.subjectResolution).toBe(dealResult.subjectResolution);
    expect(toolsResult.facts).toEqual(dealResult.facts);
    const rows = getLandosDb().prepare(`
      SELECT caller_type FROM landos_capability_invocation WHERE capability_id = ? ORDER BY created_at
    `).all(COMPS_VALUATION_CAPABILITY_ID) as Array<{ caller_type: string }>;
    expect(rows.map((r) => r.caller_type)).toEqual(['tools', 'deal_card']);
  });
});
