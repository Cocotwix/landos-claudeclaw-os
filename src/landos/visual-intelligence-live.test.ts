import { describe, it, expect } from 'vitest';
import {
  makeLiveVisualCapturers,
  sessionBlocker,
  type LiveVisualDeps,
  type LiveSessionStatus,
} from './visual-intelligence-live.js';
import { runVisualIntelligence, blockedAsset, type VisualCaptureContext, type VisualSourceCapturer } from './visual-intelligence.js';

const TS = '2026-07-09T00:00:00.000Z';
const ctx: VisualCaptureContext = { cardId: 7, address: '50 nelson rd', lat: 32.87, lng: -85.86, landPortalUrl: 'https://landportal.com/p/1' };

function makeDeps(status: LiveSessionStatus, over: Partial<LiveVisualDeps> = {}): { deps: LiveVisualDeps; pages: string[] } {
  const pages: string[] = [];
  const deps: LiveVisualDeps = {
    ensureSession: async () => status,
    landPortalAuthed: async () => true,
    capturePage: async (url, _out) => { pages.push(url); return true; },
    captureLandPortal: async () => ({ parcelShotPath: '/tmp/lp-parcel.png', terrainShotPath: '/tmp/lp-3d.png' }),
    storeCopy: (_src, cardId, source) => `/store/visuals/vi_${cardId}_${source}.png`,
    fileSize: () => 20 * 1024,
    now: () => TS,
    tmpDir: '/tmp',
    ...over,
  };
  return { deps, pages };
}

describe('Visual Intelligence live — capture when a session exists', () => {
  it('captures LandPortal parcel + 3D while canonical Google assets stay on the verified Static API path', async () => {
    const { deps, pages } = makeDeps('live');
    const caps = makeLiveVisualCapturers(deps);
    const r = await runVisualIntelligence(ctx, caps, { now: () => TS });
    const get = (s: string) => r.sources.find((x) => x.source === s)!;
    for (const s of ['landportal', 'landportal_3d']) {
      expect(get(s).state, `${s} should be captured`).toBe('captured');
      expect(get(s).imageRoute).toContain('/api/landos/visual-intelligence/image');
    }
    // Browser-rendered Google Earth / Street View can persist a globe splash or
    // black frame. They are never opened by this live capturer; the merged
    // defaults use association-verified Static API assets instead.
    expect(pages.some((u) => u.includes('earth.google.com'))).toBe(false);
    expect(pages.some((u) => u.includes('map_action=pano'))).toBe(false);
    expect(get('google_earth_overhead').state).not.toBe('captured');
    expect(get('google_earth_3d').state).not.toBe('captured');
    expect(get('street_view').state).not.toBe('captured');
    // Hero must NOT be the static map (a richer live source captured).
    expect(r.hero?.source).not.toBe('static_map');
  });

  it('drives LandPortal only once for parcel + 3D (one navigation pass)', async () => {
    let lpCalls = 0;
    const { deps } = makeDeps('live', { captureLandPortal: async () => { lpCalls++; return { parcelShotPath: '/tmp/p.png', terrainShotPath: '/tmp/3d.png' }; } });
    await runVisualIntelligence(ctx, makeLiveVisualCapturers(deps), { now: () => TS });
    expect(lpCalls).toBe(1);
  });

  it('does not launch browser-rendered Google imagery when lat/lng are absent', async () => {
    const { deps } = makeDeps('live');
    const caps = makeLiveVisualCapturers(deps);
    const noCoords: VisualCaptureContext = { ...ctx, lat: null, lng: null };
    const r = await runVisualIntelligence(noCoords, caps, { now: () => TS });
    expect(r.sources.find((s) => s.source === 'google_earth_3d')?.state).toBe('blocked');
    expect(r.sources.find((s) => s.source === 'street_view')?.state).toBe('blocked');
  });

  it('LandPortal 3D reports control-not-found when the terrain shot is absent', async () => {
    const { deps } = makeDeps('live', { captureLandPortal: async () => ({ parcelShotPath: '/tmp/p.png', terrainShotPath: null }) });
    const r = await runVisualIntelligence(ctx, makeLiveVisualCapturers(deps), { now: () => TS });
    expect(r.sources.find((s) => s.source === 'landportal')?.state).toBe('captured');
    expect(r.sources.find((s) => s.source === 'landportal_3d')?.blocker).toMatch(/control not found/i);
  });

  it('County GIS reports the exact implementation gap', async () => {
    const { deps } = makeDeps('live');
    const r = await runVisualIntelligence(ctx, makeLiveVisualCapturers(deps), { now: () => TS });
    expect(r.sources.find((s) => s.source === 'county_gis')?.blocker).toMatch(/implementation gap.*County GIS/i);
  });
});

describe('Visual Intelligence live — session gating & fallback', () => {
  it('CDP unreachable blocks each source with the exact reason', async () => {
    const { deps } = makeDeps('unreachable');
    const r = await runVisualIntelligence(ctx, makeLiveVisualCapturers(deps), { now: () => TS });
    for (const s of ['landportal']) {
      expect(r.sources.find((x) => x.source === s)?.state).toBe('blocked');
      expect(r.sources.find((x) => x.source === s)?.blocker).toMatch(/CDP unavailable/i);
    }
  });

  it('lets a visible proven parcel tab override a stale auth-needed readiness result', async () => {
    const { deps } = makeDeps('auth_needed', { landPortalAuthed: async () => false });
    const r = await runVisualIntelligence(ctx, makeLiveVisualCapturers(deps), { now: () => TS });
    expect(r.sources.find((s) => s.source === 'google_earth_3d')?.state).toBe('blocked');
    expect(r.sources.find((s) => s.source === 'street_view')?.state).toBe('blocked');
    expect(r.sources.find((s) => s.source === 'landportal')?.state).toBe('captured');
  });

  it('still reports auth missing when readiness fails and no proven parcel capture exists', async () => {
    const { deps } = makeDeps('auth_needed', {
      landPortalAuthed: async () => false,
      captureLandPortal: async () => ({ parcelShotPath: null, terrainShotPath: null }),
    });
    const r = await runVisualIntelligence(ctx, makeLiveVisualCapturers(deps), { now: () => TS });
    expect(r.sources.find((s) => s.source === 'landportal')?.blocker).toMatch(/auth\/session missing/i);
  });

  it('falls back to a persistence capturer when the live attempt is blocked (no regression)', async () => {
    const { deps } = makeDeps('unreachable');
    const fallback: VisualSourceCapturer[] = [{
      source: 'landportal', label: 'LandPortal',
      async capture() { return { source: 'landportal', label: 'LandPortal', state: 'captured', storedPath: '/store/visuals/stored-lp.png', imageRoute: '/api/landos/inspection/image?cardId=7&key=x', timestamp: TS, subject: {} }; },
    }];
    const r = await runVisualIntelligence(ctx, makeLiveVisualCapturers(deps, fallback), { now: () => TS });
    const lp = r.sources.find((s) => s.source === 'landportal')!;
    expect(lp.state).toBe('captured');
    expect(lp.imageRoute).toContain('/inspection/image'); // came from the persistence fallback
  });

  it('sessionBlocker maps every status to an exact operator reason', () => {
    expect(sessionBlocker('disabled')).toMatch(/CDP unavailable.*disabled/i);
    expect(sessionBlocker('unreachable')).toMatch(/CDP unavailable/i);
    expect(sessionBlocker('auth_needed')).toMatch(/auth\/session missing/i);
    expect(sessionBlocker('live')).toBe('');
  });
});
