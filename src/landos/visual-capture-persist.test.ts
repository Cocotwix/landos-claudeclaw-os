import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _initTestLandosDb } from './db.js';
import { upsertCardFromDukeRun, saveCardVisualCapture, loadCardVisualCapture } from './property-card.js';
import { linkPropertyToDeal, createDealCard } from './deal-card.js';
import { runDealCardReport } from './deal-card-report.js';
import { captureAndPersistAcceptedIdentityVisuals, captureAndPersistCardVisuals } from './visual-capture-workflow.js';
import type { LpResolveResult } from './landportal-client.js';
import type { FetchBinary } from './google-visual-capture.js';

beforeEach(() => { _initTestLandosDb(); });

const ASSOC = (cardId: number) => ({
  targetKind: 'parcel' as const, cardId, apn: '00830-054-000',
  sourceCoords: { lat: 31.498296, lng: -83.772086 }, basis: 'verified_parcel_coordinates' as const,
  captureQuery: '31.498296,-83.772086',
});

function verifiedCardFor(deal: number): number {
  const { card } = upsertCardFromDukeRun({
    entity: 'TY_LAND_BIZ', activeInputAddress: '472 WEST RD', city: 'Poulan', county: 'Worth', state: 'GA',
    apn: '00830-054-000', fips: '13321', owner: 'CARROLL MARGARET R', acres: 8.6,
    lat: 31.498296, lng: -83.772086,
    verified: true, verificationSource: 'Realie.ai', summary: 'verified',
  });
  linkPropertyToDeal({ dealCardId: deal, cardId: card.id, role: 'subject' });
  return card.id;
}

describe('visual capture persistence', () => {
  it('saveCardVisualCapture / loadCardVisualCapture round-trips (newest wins)', () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'v' }).id;
    const cardId = verifiedCardFor(deal);
    saveCardVisualCapture(cardId, { maps_static: { storedPath: '/store/visuals/a.png', timestamp: 't1' } }, { provider: 'google' });
    saveCardVisualCapture(cardId, { maps_static: { storedPath: '/store/visuals/b.png', timestamp: 't2' }, street_view_static: { storedPath: '/store/visuals/c.png', timestamp: 't2' } }, { provider: 'google' });
    const loaded = loadCardVisualCapture(cardId);
    expect(loaded.maps_static.storedPath).toBe('/store/visuals/b.png'); // newest
    expect(loaded.street_view_static.storedPath).toBe('/store/visuals/c.png');
  });

  it('captureAndPersistCardVisuals stores via INJECTED fetch (no real Google) and persists metadata', async () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'v' }).id;
    const cardId = verifiedCardFor(deal);
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vis-'));
    const fetchImpl: FetchBinary = async (url: string) => {
      if (/streetview\/metadata/.test(url)) {
        const body = Buffer.from(JSON.stringify({ status: 'OK', location: { lat: 31.49835, lng: -83.772086 } }));
        return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
      }
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer };
    };
    const r = await captureAndPersistCardVisuals(cardId, { env: { GOOGLE_MAPS_API_KEY: 'k' }, fetchImpl, storeDir, usageFile: path.join(storeDir, 'u.json'), now: () => 't' });
    expect(r.ok).toBe(true);
    expect(r.captured).toContain('maps_static');
    const loaded = loadCardVisualCapture(cardId);
    expect(Object.keys(loaded)).toContain('maps_static');
    expect(fs.existsSync(loaded.maps_static.storedPath)).toBe(true);
  });

  it('captures supporting Google context from an exact accepted LandPortal APN match without upgrading parcel verification', async () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'discovery match' }).id;
    const { card } = upsertCardFromDukeRun({
      entity: 'TY_LAND_BIZ',
      activeInputAddress: '6940 Highway 11',
      county: 'Pickens',
      state: 'SC',
      apn: '4165-00-51-3961',
      verified: false,
      verificationSource: '',
      summary: 'discovery lead',
    });
    linkPropertyToDeal({ dealCardId: deal, cardId: card.id, role: 'subject' });
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vis-discovery-'));
    const fetchImpl: FetchBinary = async (url: string) => {
      if (/streetview\/metadata/.test(url)) {
        const body = Buffer.from(JSON.stringify({ status: 'ZERO_RESULTS' }));
        return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
      }
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer };
    };
    const result = await captureAndPersistAcceptedIdentityVisuals({
      cardId: card.id,
      apn: '4165-00-51-3961',
      coordinates: { lat: 34.9867, lng: -82.7858 },
      discoveryUsable: true,
      discoverySources: ['LandPortal authenticated parcel panel'],
    }, { env: { GOOGLE_MAPS_API_KEY: 'k' }, fetchImpl, storeDir, usageFile: path.join(storeDir, 'u.json'), now: () => 't' });
    expect(result.ok).toBe(true);
    expect(loadCardVisualCapture(card.id).maps_static.association).toMatchObject({
      apn: '4165-00-51-3961',
      basis: 'landportal_matched_parcel_coordinates',
    });
  });

  it('report surfaces captured visuals (status=captured + image URL) with NO Google call', async () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'v' }).id;
    const cardId = verifiedCardFor(deal);
    saveCardVisualCapture(cardId, { maps_static: { storedPath: '/store/visuals/a.png', timestamp: 't', association: ASSOC(cardId) } }, { provider: 'google' });

    // throwing resolver proves no provider call (reuse); no Google call in this path.
    const throwing = async (): Promise<LpResolveResult> => { throw new Error('no provider'); };
    const femaFetch = async () => ({ ok: true, status: 200, json: async () => ({ features: [] }) });
    const nwiFetch = async () => ({ ok: true, status: 200, json: async () => ({ features: [] }) });
    const usgsFetch = async () => ({ ok: true, status: 200, json: async () => ({ value: '100' }) });
    const r = (await runDealCardReport(deal, { resolve: throwing, timeoutMs: 1000, googleVisualConfigured: true, femaFetch, nwiFetch, usgsFetch }))!.report;

    const maps = r.visualContext.assets.find((a) => a.service === 'maps_static')!;
    expect(maps.status).toBe('captured');
    expect(maps.imageUrl).toBe(`/api/landos/visual/image?cardId=${cardId}&service=maps_static`);
    expect(r.visualContext.label).toBe('Visual Signal, Not Verified Fact');
  });
});
