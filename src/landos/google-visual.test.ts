import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildVisualPropertyContext,
  renderVisualContextMarkdown,
  googleVisualStatus,
  googleVisualConfigured,
  googleMapsLink,
  streetViewLink,
  googleEarthLink,
  VISUAL_NOT_VERIFIED_LABEL,
} from './providers/google-visual.js';
import { loadVisualUsage, recordVisualCapture } from './google-visual-guard.js';
import { capturePropertyVisuals, type FetchBinary } from './google-visual-capture.js';

const FIXED = () => '2026-06-26T00:00:00.000Z';

describe('google-visual: pure context builder (NO network, NO key)', () => {
  it('builds keyless deep links + image placeholders, labeled Not Verified', () => {
    const ctx = buildVisualPropertyContext(
      { address: '472 West Rd', city: 'Poulan', state: 'GA' },
      { configured: true, now: FIXED },
    );
    expect(ctx.label).toBe(VISUAL_NOT_VERIFIED_LABEL);
    expect(ctx.configured).toBe(true);
    // deep links are keyless and present
    expect(ctx.links.maps).toContain('https://www.google.com/maps/search/');
    expect(ctx.links.maps).toContain('472%20West%20Rd');
    expect(ctx.links.earth).toContain('earth.google.com');
    expect(JSON.stringify(ctx)).not.toMatch(/staticmap|streetview\?|key=/i); // no static/keyed URLs leak
    // image assets are placeholders (not captured), cost-free, labeled
    const maps = ctx.assets.find((a) => a.service === 'maps_static')!;
    expect(maps.status).toBe('not_captured');
    expect(maps.costRisk).toBe('none');
    expect(maps.verificationStatus).toBe(VISUAL_NOT_VERIFIED_LABEL);
    expect(maps.deepLink).toBe(ctx.links.maps);
  });

  it('captured assets reflect a prior stored image (one_request cost)', () => {
    const ctx = buildVisualPropertyContext(
      { address: '1 Main', state: 'GA' },
      { configured: true, now: FIXED, captured: { maps_static: { storedPath: '/store/visuals/x.png' } } },
    );
    const maps = ctx.assets.find((a) => a.service === 'maps_static')!;
    expect(maps.status).toBe('captured');
    expect(maps.storedPath).toBe('/store/visuals/x.png');
    expect(maps.costRisk).toBe('one_request');
  });

  it('no address/coords -> assets unavailable, links null, never invents a target', () => {
    const ctx = buildVisualPropertyContext({}, { configured: true, now: FIXED });
    expect(ctx.links.maps).toBeNull();
    expect(ctx.assets.every((a) => a.status === 'unavailable')).toBe(true);
  });

  it('coords build a Street View pano deep link (supporting only, not identity)', () => {
    expect(streetViewLink(null, { lat: 31.5, lng: -83.7 })).toContain('map_action=pano');
    expect(googleMapsLink(null, { lat: 31.5, lng: -83.7 })).toContain('31.5%2C-83.7');
    expect(googleEarthLink(null, { lat: 31.5, lng: -83.7 })).toContain('@31.5,-83.7');
  });

  it('markdown render shows placeholders + links and the Not Verified label', () => {
    const md = renderVisualContextMarkdown(buildVisualPropertyContext({ address: '472 West Rd', state: 'GA' }, { configured: true, now: FIXED }));
    expect(md).toContain('## Visual Property Context');
    expect(md).toContain('Visual Signal, Not Verified Fact');
    expect(md).toContain('image placeholder — not captured yet');
    expect(md).toContain('[Google Maps]');
  });

  it('status lists the four visual services; presence-only', () => {
    const s = googleVisualStatus({ GOOGLE_MAPS_API_KEY: 'present' });
    expect(s.services.map((x) => x.service)).toEqual(['maps_static', 'street_view_static', 'map_tiles_terrain', 'aerial_3d']);
    expect(s.configured).toBe(true);
    expect(googleVisualConfigured({})).toBe(false);
  });
});

describe('google-visual usage guard (local, no network)', () => {
  const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gvis-')), 'usage.json');
  it('records captures and never stores a key', () => {
    const f = tmp();
    expect(loadVisualUsage(f).capturesMade).toBe(0);
    const s = recordVisualCapture({ property: '472 West Rd', service: 'maps_static', success: true, now: FIXED }, f);
    expect(s.capturesMade).toBe(1);
    expect(s.records[0]).toMatchObject({ property: '472 West Rd', service: 'maps_static', success: true });
    expect(fs.readFileSync(f, 'utf-8')).not.toMatch(/api[_-]?key|authorization|key=/i);
  });
});

describe('google-visual capture (gated; injected fetch — no real Google call)', () => {
  it('captures + stores images with an injected fetch, records usage', async () => {
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gvis-store-'));
    const usageFile = path.join(storeDir, 'usage.json');
    const calls: string[] = [];
    const fetchImpl: FetchBinary = async (url) => { calls.push(url); return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }; };
    const r = await capturePropertyVisuals(
      { propertyLabel: '472 West Rd', address: '472 West Rd, Poulan, GA' },
      { env: { GOOGLE_MAPS_API_KEY: 'k' }, fetchImpl, now: FIXED, storeDir, usageFile },
    );
    expect(r.captured).toBe(true);
    expect(calls[0]).toContain('maps.googleapis.com/maps/api/staticmap');
    expect(calls[1]).toContain('maps.googleapis.com/maps/api/streetview');
    expect(r.assets.maps_static?.storedPath && fs.existsSync(r.assets.maps_static.storedPath)).toBe(true);
    expect(loadVisualUsage(usageFile).capturesMade).toBe(2);
  });

  it('makes NO call when unconfigured (no key)', async () => {
    let called = false;
    const fetchImpl: FetchBinary = async () => { called = true; return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }; };
    const r = await capturePropertyVisuals({ propertyLabel: 'x', address: '1 Main' }, { env: {}, fetchImpl });
    expect(called).toBe(false);
    expect(r.captured).toBe(false);
    expect(r.reason).toMatch(/not configured/i);
  });

  it('makes NO call with no address/coordinates (never proximity)', async () => {
    let called = false;
    const fetchImpl: FetchBinary = async () => { called = true; return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }; };
    const r = await capturePropertyVisuals({ propertyLabel: 'x', address: null }, { env: { GOOGLE_MAPS_API_KEY: 'k' }, fetchImpl });
    expect(called).toBe(false);
    expect(r.captured).toBe(false);
  });
});
