import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _initTestLandosDb } from './db.js';
import { upsertCardFromDukeRun, saveCardVisualCapture, loadCardVisualCapture } from './property-card.js';
import { linkPropertyToDeal, createDealCard } from './deal-card.js';
import { runDealCardReport } from './deal-card-report.js';
import { captureAndPersistCardVisuals } from './visual-capture-workflow.js';
import type { LpResolveResult } from './landportal-client.js';
import type { FetchBinary } from './google-visual-capture.js';

beforeEach(() => { _initTestLandosDb(); });

function verifiedCardFor(deal: number): number {
  const { card } = upsertCardFromDukeRun({
    entity: 'TY_LAND_BIZ', activeInputAddress: '472 WEST RD', city: 'Poulan', county: 'Worth', state: 'GA',
    apn: '00830-054-000', fips: '13321', owner: 'CARROLL MARGARET R', acres: 8.6,
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
    const fetchImpl: FetchBinary = async () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer });
    const r = await captureAndPersistCardVisuals(cardId, { env: { GOOGLE_MAPS_API_KEY: 'k' }, fetchImpl, storeDir, usageFile: path.join(storeDir, 'u.json'), now: () => 't' });
    expect(r.ok).toBe(true);
    expect(r.captured).toContain('maps_static');
    const loaded = loadCardVisualCapture(cardId);
    expect(Object.keys(loaded)).toContain('maps_static');
    expect(fs.existsSync(loaded.maps_static.storedPath)).toBe(true);
  });

  it('report surfaces captured visuals (status=captured + image URL) with NO Google call', async () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'v' }).id;
    const cardId = verifiedCardFor(deal);
    saveCardVisualCapture(cardId, { maps_static: { storedPath: '/store/visuals/a.png', timestamp: 't' } }, { provider: 'google' });

    // throwing resolver proves no provider call (reuse); no Google call in this path.
    const throwing = async (): Promise<LpResolveResult> => { throw new Error('no provider'); };
    const r = (await runDealCardReport(deal, { resolve: throwing, timeoutMs: 1000, googleVisualConfigured: true }))!.report;

    const maps = r.visualContext.assets.find((a) => a.service === 'maps_static')!;
    expect(maps.status).toBe('captured');
    expect(maps.imageUrl).toBe(`/api/landos/visual/image?cardId=${cardId}&service=maps_static`);
    expect(r.visualContext.label).toBe('Visual Signal, Not Verified Fact');
  });
});
