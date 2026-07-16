import { describe, it, expect } from 'vitest';
import { capturePropertyVisuals, type FetchBinary } from './google-visual-capture.js';
import os from 'os';
import path from 'path';
import fs from 'fs';

// Two DIFFERENT Deal Cards that share the SAME location label must never write
// to the same file — that was the cross-card "wrong photo" bug. Captures now
// also REQUIRE verified parcel coordinates + an association basis (an address
// label alone is refused — the De Queen wrong-imagery fix).
function fetchOk(): FetchBinary {
  const png = Buffer.alloc(16 * 1024, 1);
  return async (url: string) => {
    if (/streetview\/metadata/.test(url)) {
      const body = Buffer.from(JSON.stringify({ status: 'OK', location: { lat: 34.04, lng: -94.3349 } }));
      return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
    }
    return { ok: true, status: 200, arrayBuffer: async () => png.buffer.slice(0, png.length) };
  };
}

const COORDS = { lat: 34.0401, lng: -94.335 };
const ASSOC = { apn: '000-00000-000', basis: 'verified_parcel_coordinates' as const };

describe('visual image association — card-scoped filenames', () => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-vis-assoc-'));
  const env = { GOOGLE_MAPS_API_KEY: 'k' };
  const usageFile = path.join(storeDir, 'usage.jsonl');

  it('two cards with the same label produce DIFFERENT stored files', async () => {
    const a = await capturePropertyVisuals({ propertyLabel: '10 Shared Rd', address: null, coords: COORDS, cardId: 101, association: ASSOC }, { env, fetchImpl: fetchOk(), storeDir, usageFile });
    const b = await capturePropertyVisuals({ propertyLabel: '10 Shared Rd', address: null, coords: COORDS, cardId: 202, association: ASSOC }, { env, fetchImpl: fetchOk(), storeDir, usageFile });
    expect(a.captured).toBe(true);
    expect(b.captured).toBe(true);
    const aMap = a.assets.maps_static?.storedPath;
    const bMap = b.assets.maps_static?.storedPath;
    expect(aMap).toBeTruthy();
    expect(bMap).toBeTruthy();
    expect(aMap).not.toBe(bMap); // different cards → different files (no collision)
    expect(aMap).toContain('c101_');
    expect(bMap).toContain('c202_');
    // Association metadata rides with each asset (filename is not the proof).
    expect(a.assets.maps_static?.association?.cardId).toBe(101);
    expect(b.assets.maps_static?.association?.cardId).toBe(202);
  });

  it('the same card is stable (idempotent filename)', async () => {
    const a = await capturePropertyVisuals({ propertyLabel: 'x', address: null, coords: COORDS, cardId: 303, association: ASSOC }, { env, fetchImpl: fetchOk(), storeDir, usageFile });
    const b = await capturePropertyVisuals({ propertyLabel: 'x', address: null, coords: COORDS, cardId: 303, association: ASSOC }, { env, fetchImpl: fetchOk(), storeDir, usageFile });
    expect(a.assets.maps_static?.storedPath).toBe(b.assets.maps_static?.storedPath);
  });

  it('an address-only capture (no coords) is refused — never a geocoded guess', async () => {
    const r = await capturePropertyVisuals({ propertyLabel: '10 Shared Rd', address: '10 Shared Rd', cardId: 404, association: ASSOC }, { env, fetchImpl: fetchOk(), storeDir, usageFile });
    expect(r.captured).toBe(false);
    expect(r.reason).toMatch(/verified parcel coordinates/i);
  });
});
