import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hono } from 'hono';

const PROVIDER = vi.hoisted(() => ({ resolve: vi.fn() }));

vi.mock('./landportal-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./landportal-client.js')>();
  return { ...actual, lpResolveForPreflight: PROVIDER.resolve };
});

import { buildDashboardApp } from '../dashboard.js';
import { _initTestDatabase } from '../db.js';
import { _initTestLandosDb } from './db.js';

const TOKEN = 'test-contract-token';
const APN_A = '042-123.00-000';
const APN_B = '042-999.00-000';
let app: Hono;

beforeEach(() => {
  _initTestDatabase();
  _initTestLandosDb();
  app = buildDashboardApp(undefined) as unknown as Hono;
  PROVIDER.resolve.mockReset();
  PROVIDER.resolve.mockResolvedValue({
    verified: true,
    status: 'verified',
    propertyid: 'provider-parcel-b',
    fips: '47187',
    apn: APN_B,
    situs_address: '99 Conflicting Provider Road',
    city: 'Testville',
    state: 'TN',
    owner: 'Provider Owner',
    match_notes: 'Provider exact match for APN B.',
    candidates: [],
  });
});

describe('Intake Property Resolution capability gate', () => {
  it('keeps Intake gated when input APN A conflicts with provider APN B', async () => {
    const response = await app.request(`/api/landos/intake/duke-verification?token=${TOKEN}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `APN: ${APN_A}, FIPS: 47187` }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.capability.subjectResolution).toBe('AMBIGUOUS');
    expect(body.verification.parcelVerified).toBe(false);
    expect(body.verification.propertyData).toBeUndefined();
    expect(body.verification.sourceAttempts[0]).toMatchObject({ status: 'not_verified', truthLabel: 'attempted_lookup' });
    expect(body.verification.strategyUnderwritingBlocked).toBe(true);
    expect(body.dukeAnalysis.strategyStatus).toBe('blocked_unverified_parcel');
    expect(body.acePrep.status).toBe('preliminary');
    expect(body.landScore).toBeNull();
  });
});
