import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';

import { _initTestDatabase } from '../db.js';
import { buildDashboardApp } from '../dashboard.js';
import { _initTestLandosDb, getLandosDb } from './db.js';
import { loadPropertyInspection } from './property-card.js';

const TOKEN = 'test-contract-token';
const RAW_INPUT = '3401 62nd St W, Lehigh Acres FL';

let app: Hono;

beforeAll(() => {
  app = buildDashboardApp(undefined) as unknown as Hono;
});

beforeEach(() => {
  _initTestDatabase();
  _initTestLandosDb();
});

async function get(path: string) {
  return app.request(path + (path.includes('?') ? '&' : '?') + 'token=' + TOKEN);
}

async function post(path: string, body?: unknown) {
  return app.request(path + (path.includes('?') ? '&' : '?') + 'token=' + TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('LandOS operator acceptance (live browser/session path)', () => {
  it('runs the Florida operator workflow and summarizes the first real downstream blocker', async () => {
    const startRes = await post('/api/landos/browser/start', {});
    expect(startRes.status).toBe(200);
    const startBody = (await startRes.json()) as any;

    let landportalBody: any = null;
    if (startBody.start?.status === 'live' || startBody.start?.status === 'auth_needed') {
      const lpRes = await post('/api/landos/browser/open-landportal', {});
      expect(lpRes.status).toBe(200);
      landportalBody = (await lpRes.json()) as any;
    }

    const acquireRes = await post('/api/landos/acquire/run', {
      text: RAW_INPUT,
      rawInput: RAW_INPUT,
      entity: 'TY_LAND_BIZ',
    });
    expect([200, 201]).toContain(acquireRes.status);
    const acquireBody = (await acquireRes.json()) as any;
    expect(acquireBody.pipeline).toBe('property_resolution');

    const dealCardId = Number(acquireBody.dealCardId);
    expect(Number.isInteger(dealCardId)).toBe(true);

    const row = getLandosDb().prepare(
      `SELECT pc.id, pc.active_input_address, pc.city, pc.county, pc.state, pc.apn, pc.fips, pc.lp_property_id, pc.verification_status
         FROM landos_property_card pc
         JOIN landos_deal_card_property dp ON dp.card_id = pc.id
        WHERE dp.deal_card_id = ?`,
    ).get(dealCardId) as any;
    expect(row.active_input_address).toBe(RAW_INPUT);

    const inspection = loadPropertyInspection(Number(row.id));
    const reportRes = await get(`/api/landos/deal-cards/${dealCardId}/report`);
    expect(reportRes.status).toBe(200);
    const reportBody = (await reportRes.json()) as any;

    const discovery = reportBody.discoveryReport ?? {};
    const comparableIntelligence = discovery.comparableIntelligence ?? {};
    const marketIntelligence = discovery.marketIntelligence ?? {};
    const comparables = comparableIntelligence.comparables ?? comparableIntelligence.selectedComparables ?? [];
    const marketValue = comparableIntelligence.estimatedMarketValue ?? discovery.roughOfferRange?.estimatedMarketValue ?? null;

    // eslint-disable-next-line no-console
    console.log('\n=== LIVE OPERATOR ACCEPTANCE: 3401 62nd St W, Lehigh Acres FL ===\n' + JSON.stringify({
      browserStart: {
        status: startBody.start?.status,
        launched: startBody.start?.launched,
        reused: startBody.start?.reused,
        error: startBody.start?.error ?? null,
      },
      landportalSession: landportalBody ? {
        status: landportalBody.landportal?.status,
        authenticated: landportalBody.landportal?.authenticated,
        note: landportalBody.landportal?.note,
      } : null,
      acquire: {
        status: acquireRes.status,
        ok: acquireBody.ok,
        matched: acquireBody.matched,
        parcelVerified: acquireBody.parcelVerified,
        browserSessionStatus: acquireBody.browserSessionStatus,
        browserEscalated: acquireBody.browserEscalated,
        reportStatus: acquireBody.reportStatus,
      },
      resolvedProperty: {
        activeInputAddress: row.active_input_address,
        city: row.city,
        county: row.county,
        state: row.state,
        apn: row.apn,
        fips: row.fips,
        lpPropertyId: row.lp_property_id,
        verificationStatus: row.verification_status,
      },
      propertyInspection: inspection ? {
        persisted: true,
        parcelUrl: inspection.parcelUrl,
        comparablesUrl: inspection.comparablesUrl,
        assetCount: inspection.assets.length,
        overlayCount: inspection.overlays.length,
        comparableCount: inspection.comparables.length,
        comparableSamples: inspection.comparables.slice(0, 5),
        missingInformation: inspection.missingInformation,
      } : { persisted: false },
      discoveryCall: {
        available: discovery.available,
        contextLabel: discovery.contextLabel,
        confidence: discovery.confidence,
        headline: discovery.headline,
        roughOfferRange: discovery.roughOfferRange ?? null,
      },
      comparableIntelligence: {
        comparableCount: Array.isArray(comparables) ? comparables.length : 0,
        comparableSamples: Array.isArray(comparables) ? comparables.slice(0, 5) : [],
        selectedSamples: Array.isArray(comparableIntelligence.selectedComparables) ? comparableIntelligence.selectedComparables.slice(0, 5) : [],
        estimatedMarketValue: marketValue,
        estimatedPricePerAcre: comparableIntelligence.estimatedPricePerAcre ?? null,
        confidence: comparableIntelligence.confidence ?? null,
      },
      marketIntelligence: {
        confidence: marketIntelligence.confidence ?? null,
        pulse: marketIntelligence.marketPulse ?? marketIntelligence.summary ?? null,
      },
    }, null, 2));
  }, 180000);
});
