import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hono } from 'hono';

const CONTROL = vi.hoisted(() => ({
  calls: 0,
  gate: Promise.resolve(),
  release: (() => undefined) as () => void,
  started: Promise.resolve(),
  signalStarted: (() => undefined) as () => void,
  skipCapability: false,
  mockStatus: 'blocked' as 'completed' | 'blocked',
  mockSummary: 'pre-seeded capability result',
}));

vi.mock('./property-intelligence-live.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./property-intelligence-live.js')>();
  return {
    ...actual,
    makeLivePropertyIntelligenceCollectors: () => ({
      parcel_identity: async (ctx: { dealCardId: number; runId: string }) => {
        CONTROL.calls += 1;
        CONTROL.signalStarted();
        await CONTROL.gate;
        if (CONTROL.skipCapability) return { status: CONTROL.mockStatus, summary: CONTROL.mockSummary, data: null };
        const { getDealCard, resolveSubjectPropertyCard } = await import('./deal-card.js');
        const { invokeRuntimeCapability } = await import('./capability-registry.js');
        const deal = getDealCard(ctx.dealCardId)!;
        const propertyCardId = resolveSubjectPropertyCard(deal).cardId!;
        const result = await invokeRuntimeCapability({
          capabilityId: 'property-resolution',
          caller: { type: 'deal_card', ref: `deal:${ctx.dealCardId}` },
          subject: { kind: 'canonical_property', entity: deal.entity as 'LAND_ALLY' | 'TY_LAND_BIZ', propertyCardId, dealCardId: ctx.dealCardId },
          mode: 'refresh',
          context: { workflow: 'standalone_resolution_test', runId: ctx.runId },
        });
        return { status: result.subjectResolution === 'RESOLVED' ? 'completed' : 'blocked', summary: result.subjectResolution, data: null };
      },
    }),
  };
});

vi.mock('./browser-session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./browser-session.js')>();
  return { ...actual, adoptAutomationControlPage: async () => false };
});

import { buildDashboardApp } from '../dashboard.js';
import { _initTestDatabase } from '../db.js';
import { _initTestLandosDb, getLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal, unlinkPropertyFromDeal } from './deal-card.js';
import { upsertPropertyCard } from './property-card.js';
import { invokeRuntimeCapability } from './capability-registry.js';

const TOKEN = 'test-contract-token';
let app: Hono;

beforeEach(() => {
  _initTestDatabase();
  _initTestLandosDb();
  app = buildDashboardApp(undefined) as unknown as Hono;
  CONTROL.calls = 0;
  CONTROL.gate = new Promise<void>((resolve) => { CONTROL.release = resolve; });
  CONTROL.started = new Promise<void>((resolve) => { CONTROL.signalStarted = resolve; });
  CONTROL.skipCapability = false;
  CONTROL.mockStatus = 'blocked';
  CONTROL.mockSummary = 'pre-seeded capability result';
});

const post = (url: string) => app.request(`${url}?token=${TOKEN}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor: 'operator' }),
});

describe('standalone Deal Card Property Resolution single-flight', () => {
  it('never returns the prior subject result when the Deal Card subject changes mid-run', async () => {
    const { card: original } = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: 'Original subject', state: 'TN' });
    const { card: replacement } = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: 'Replacement subject', state: 'TN' });
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Subject transition deal' });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: original.id, role: 'subject' });
    const pending = post(`/api/landos/deal-cards/${deal.id}/parallel-resolve`);
    await CONTROL.started;
    expect(unlinkPropertyFromDeal(deal.id, original.id)).toBe(true);
    linkPropertyToDeal({ dealCardId: deal.id, cardId: replacement.id, role: 'subject' });
    CONTROL.release();
    const response = await pending;
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ expectedPropertyCardId: original.id, currentPropertyCardId: replacement.id });
  });

  it.each(['RESOLVED', 'AMBIGUOUS', 'UNRESOLVED'] as const)('parallel-resolve compatibility returns normalized %s gating from the canonical capability', async (subjectResolution) => {
    const { card } = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: 'Compatibility parcel', state: 'TN' });
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Compatibility deal' });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
    const lanes = subjectResolution === 'RESOLVED'
      ? { official_parcel: async () => ({
          lane: 'official_parcel' as const, status: 'evidence' as const, note: 'official match',
          source: { label: 'County Assessor', url: 'https://county.example.gov/parcel', officiality: 'official' as const },
          patch: { apn: '042-123.00-000', county: 'Williamson', state: 'TN', verified: true, verificationSource: 'County Assessor' },
        }) }
      : subjectResolution === 'AMBIGUOUS'
        ? { official_parcel: async () => ({
            lane: 'official_parcel' as const, status: 'evidence' as const, note: 'two candidates',
            ambiguousCandidates: [
              { apn: '042-123.00-000', county: 'Williamson', state: 'TN' },
              { apn: '042-124.00-000', county: 'Williamson', state: 'TN' },
            ],
          }) }
        : {};
    const seeded = await invokeRuntimeCapability({
      capabilityId: 'property-resolution', caller: { type: 'deal_card', ref: `deal:${deal.id}` },
      subject: { kind: 'raw_property', entity: 'TY_LAND_BIZ', rawInput: 'Map 042 Parcel 123, Fairview TN', target: { dealCardId: deal.id, propertyCardId: card.id } },
      mode: 'refresh',
    }, { universalOptions: { lanes } });
    expect(seeded.subjectResolution).toBe(subjectResolution);
    CONTROL.skipCapability = true;
    CONTROL.mockStatus = subjectResolution === 'RESOLVED' ? 'completed' : 'blocked';
    CONTROL.gate = Promise.resolve();
    const response = await post(`/api/landos/deal-cards/${deal.id}/parallel-resolve`);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.propertyResolution.subjectResolution).toBe(subjectResolution);
    expect(body.promoted).toBe(subjectResolution === 'RESOLVED');
    expect(body.operatorConfirmationRequired).toBe(subjectResolution === 'AMBIGUOUS');
  });

  it('reuses the durable in-flight lock before any second provider workflow starts', async () => {
    const { card } = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: 'Concurrency parcel', apn: '042-123.00-000', county: 'Williamson', state: 'TN',
      verified: true, verificationSource: 'Williamson County Property Assessor',
    });
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Concurrency deal' });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });

    const firstPromise = post(`/api/landos/deal-cards/${deal.id}/property-resolution/run`);
    await CONTROL.started;
    const second = await post(`/api/landos/deal-cards/${deal.id}/property-resolution/run`);
    expect(second.status).toBe(202);
    expect(await second.json()).toMatchObject({ reusedActiveRun: true });
    expect(CONTROL.calls).toBe(1);
    expect((getLandosDb().prepare('SELECT count(*) AS n FROM landos_capability_invocation').get() as { n: number }).n).toBe(0);

    CONTROL.release();
    const first = await firstPromise;
    expect(first.status).toBe(200);
    expect(CONTROL.calls).toBe(1);
    expect((getLandosDb().prepare('SELECT count(*) AS n FROM landos_capability_invocation').get() as { n: number }).n).toBe(1);
  });

  it('does not report a prior resolved result as the outcome of a contended compatibility refresh', async () => {
    const { card } = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: 'Prior resolved parcel', state: 'TN' });
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Contended compatibility deal' });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
    const seeded = await invokeRuntimeCapability({
      capabilityId: 'property-resolution', caller: { type: 'deal_card', ref: `deal:${deal.id}` },
      subject: { kind: 'raw_property', entity: 'TY_LAND_BIZ', rawInput: 'Map 042 Parcel 123, Fairview TN', target: { dealCardId: deal.id, propertyCardId: card.id } },
      mode: 'refresh',
    }, { universalOptions: { lanes: { official_parcel: async () => ({
      lane: 'official_parcel' as const, status: 'evidence' as const, note: 'official match',
      source: { label: 'County Assessor', url: 'https://county.example.gov/parcel', officiality: 'official' as const },
      patch: { apn: '042-123.00-000', county: 'Williamson', state: 'TN', verified: true, verificationSource: 'County Assessor' },
    }) } } });
    expect(seeded.subjectResolution).toBe('RESOLVED');
    CONTROL.skipCapability = true;
    CONTROL.mockStatus = 'blocked';
    CONTROL.mockSummary = 'Property Resolution is already running for this Deal Card.';
    CONTROL.gate = Promise.resolve();

    const response = await post(`/api/landos/deal-cards/${deal.id}/parallel-resolve`);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      reusedActiveRun: true,
      propertyResolution: null,
      promoted: false,
      operatorConfirmationRequired: false,
    });
  });

  it('prevents a full Deal Intelligence launch while standalone resolution owns the subject', async () => {
    const { card } = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: 'Cross-entry parcel', apn: '042-123.00-000', county: 'Williamson', state: 'TN',
      verified: true, verificationSource: 'Williamson County Property Assessor',
    });
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Cross-entry deal' });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });

    const standalone = post(`/api/landos/deal-cards/${deal.id}/property-resolution/run`);
    await CONTROL.started;
    const full = await post(`/api/landos/deal-cards/${deal.id}/property-intelligence/run`);
    expect(full.status).toBe(202);
    expect(await full.json()).toMatchObject({ reusedActiveRun: true, launch: { alreadyRunning: true } });
    expect(CONTROL.calls).toBe(1);
    expect((getLandosDb().prepare('SELECT count(*) AS n FROM landos_property_intelligence_run').get() as { n: number }).n).toBe(0);

    CONTROL.release();
    expect((await standalone).status).toBe(200);
    expect(CONTROL.calls).toBe(1);
    expect((getLandosDb().prepare('SELECT count(*) AS n FROM landos_capability_invocation').get() as { n: number }).n).toBe(1);
  });
});
