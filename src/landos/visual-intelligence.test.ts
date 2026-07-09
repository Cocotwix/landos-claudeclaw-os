import { describe, it, expect } from 'vitest';
import {
  runVisualIntelligence,
  runVisualIntelligenceForCard,
  defaultCapturers,
  mergeLiveCapturers,
  blockedAsset,
  isViewable,
  LIVE_BROWSER_BLOCKER,
  VISUAL_SOURCE_ORDER,
  HERO_PRIORITY,
  type VisualSourceCapturer,
  type VisualSourceKind,
  type VisualAssetMeta,
  type VisualCaptureContext,
} from './visual-intelligence.js';
import type { VisionAnalysis, VisionSourceImage } from './browser-vision.js';

const TS = '2026-07-09T00:00:00.000Z';
const now = () => TS;
const ctx: VisualCaptureContext = { cardId: 42, address: '123 Rural Rd', lat: 36.1, lng: -84.5, landPortalUrl: 'https://landportal.example/parcel/1' };

function capturedCapturer(source: VisualSourceKind): VisualSourceCapturer {
  return {
    source,
    label: source,
    async capture(): Promise<VisualAssetMeta> {
      return { source, label: source, state: 'captured', storedPath: `/store/visuals/${source}.png`, imageRoute: `/img/${source}`, timestamp: TS, subject: {} };
    },
  };
}
function blockedCapturer(source: VisualSourceKind, reason = 'blocked'): VisualSourceCapturer {
  return { source, label: source, async capture() { return blockedAsset(source, 'blocked', reason, {}, TS); } };
}

describe('Visual Intelligence — hero priority & static-map fallback doctrine', () => {
  it('never selects static map as hero when a richer source captured', async () => {
    const caps = [capturedCapturer('static_map'), capturedCapturer('landportal'), capturedCapturer('street_view')];
    const r = await runVisualIntelligence(ctx, caps, { now });
    expect(r.hero?.source).toBe('landportal'); // landportal outranks street_view + static_map
    expect(r.hero?.source).not.toBe('static_map');
    const staticRow = r.sources.find((s) => s.source === 'static_map');
    expect(staticRow?.fallback).toBe(true);
    expect(r.staticMapFallbackOnly).toBe(true);
  });

  it('honors the full hero priority order (GE3D > GE overhead > LandPortal > Street View > static)', async () => {
    const caps = HERO_PRIORITY.map((s) => capturedCapturer(s));
    const r = await runVisualIntelligence(ctx, caps, { now });
    expect(r.hero?.source).toBe('google_earth_3d');
    // Remove GE3D → GE overhead wins, and so on down the chain.
    const r2 = await runVisualIntelligence(ctx, caps.filter((c) => c.source !== 'google_earth_3d'), { now });
    expect(r2.hero?.source).toBe('google_earth_overhead');
    const r3 = await runVisualIntelligence(ctx, [capturedCapturer('street_view'), capturedCapturer('static_map')], { now });
    expect(r3.hero?.source).toBe('street_view');
  });

  it('uses static map as hero ONLY when it is the sole captured source, and says so', async () => {
    const caps = [capturedCapturer('static_map'), blockedCapturer('landportal'), blockedCapturer('google_earth_3d')];
    const r = await runVisualIntelligence(ctx, caps, { now });
    expect(r.hero?.source).toBe('static_map');
    expect(r.heroReason).toMatch(/fallback of last resort/i);
  });

  it('reports one status row per source in status-panel order, hero first in gallery', async () => {
    const caps = [capturedCapturer('landportal'), capturedCapturer('street_view')];
    const r = await runVisualIntelligence(ctx, caps, { now });
    expect(r.sources.map((s) => s.source)).toEqual(VISUAL_SOURCE_ORDER);
    expect(r.gallery[0].source).toBe('landportal'); // hero first
    expect(r.gallery.every(isViewable)).toBe(true);
  });

  it('a source with no capturer is reported blocked with an explicit reason (never omitted)', async () => {
    const r = await runVisualIntelligence(ctx, [capturedCapturer('landportal')], { now });
    const ge3d = r.sources.find((s) => s.source === 'google_earth_3d');
    expect(ge3d?.state).toBe('blocked');
    expect(ge3d?.blocker).toMatch(/no capturer wired/i);
  });

  it('captures nothing → no hero, honest note', async () => {
    const r = await runVisualIntelligence(ctx, [blockedCapturer('landportal'), blockedCapturer('static_map')], { now });
    expect(r.hero).toBeNull();
    expect(r.note).toMatch(/No visual captured/i);
  });
});

describe('Visual Intelligence — default (persistence-derived) capturers', () => {
  const bigFile = 20 * 1024;
  const readers = {
    loadGoogleVisuals: () => ({
      street_view_static: { storedPath: '/store/visuals/sv.png', timestamp: TS },
      maps_static: { storedPath: '/store/visuals/map.png', timestamp: TS },
    }),
    loadInspectionAssets: () => [
      { key: 'lp-sat', label: 'LandPortal satellite', kind: 'satellite', storedPath: '/store/visuals/lp.png', timestamp: TS },
    ],
    fileSize: () => bigFile,
    now,
  };

  it('derives Street View + LandPortal captured; static map is fallback; live-only sources blocked with exact reason', async () => {
    const r = await runVisualIntelligence(ctx, defaultCapturers(readers), { now });
    const get = (s: VisualSourceKind) => r.sources.find((x) => x.source === s)!;
    expect(get('street_view').state).toBe('captured');
    expect(get('landportal').state).toBe('captured');
    expect(get('static_map').state).toBe('captured');
    expect(get('static_map').fallback).toBe(true);
    // Interactive/live sources: blocked with the exact wiring blocker (no fabrication, no paid call).
    for (const s of ['google_earth_overhead', 'google_earth_3d', 'landportal_3d', 'county_gis'] as VisualSourceKind[]) {
      expect(get(s).state).toBe('blocked');
      expect(get(s).blocker).toBe(LIVE_BROWSER_BLOCKER);
    }
    // Hero must be LandPortal (richer than street_view/static), never the static map.
    expect(r.hero?.source).toBe('landportal');
  });

  it('marks Street View unavailable (not blocked) when Google has no street asset', async () => {
    const noStreet = { ...readers, loadGoogleVisuals: () => ({ maps_static: { storedPath: '/store/visuals/map.png', timestamp: TS } }) };
    const r = await runVisualIntelligence(ctx, defaultCapturers(noStreet), { now });
    expect(r.sources.find((s) => s.source === 'street_view')?.state).toBe('unavailable');
  });

  it('skips blank/too-small images as not captured', async () => {
    const tiny = { ...readers, fileSize: () => 100 };
    const r = await runVisualIntelligence(ctx, defaultCapturers(tiny), { now });
    expect(r.sources.find((s) => s.source === 'landportal')?.state).toBe('blocked');
    expect(isViewable(r.sources.find((s) => s.source === 'street_view')!)).toBe(false);
  });

  it('never requests a paid LandPortal slope report (live-only blocker names the free wiring path only)', async () => {
    const r = await runVisualIntelligence(ctx, defaultCapturers(readers), { now });
    const lp3d = r.sources.find((s) => s.source === 'landportal_3d')!;
    expect(lp3d.blocker).not.toMatch(/slope report|paid|credit|purchase/i);
    expect(lp3d.blocker).toBe(LIVE_BROWSER_BLOCKER);
  });
});

describe('Visual Intelligence — live capturer merge & card driver', () => {
  it('mergeLiveCapturers replaces the default for a covered source', () => {
    const readers = { loadGoogleVisuals: () => ({}), loadInspectionAssets: () => [], fileSize: () => 0, now };
    const live = [capturedCapturer('google_earth_3d')];
    const merged = mergeLiveCapturers(defaultCapturers(readers), live);
    expect(merged.find((c) => c.source === 'google_earth_3d')).toBe(live[0]);
    expect(merged).toHaveLength(VISUAL_SOURCE_ORDER.length);
  });

  it('card driver analyzes captured imagery, attaches observations, persists, and rewrites cardId in routes', async () => {
    const analyzed: VisionSourceImage[][] = [];
    const analysis: VisionAnalysis = {
      observations: [{ category: 'access', observation: 'Visible driveway touches the parcel', signal: 'positive', confidence: 'medium', sourceImage: 'LandPortal' }],
      summary: 'Parcel has road access and light tree cover.',
      analyzed: [], skipped: [], model: 'test', generatedAt: TS, ok: true,
    };
    let persisted: unknown = null;
    const rec = await runVisualIntelligenceForCard(
      { ...ctx, county: 'Scott', state: 'TN' },
      {
        loadGoogleVisuals: () => ({ street_view_static: { storedPath: '/store/visuals/sv.png', timestamp: TS }, maps_static: { storedPath: '/store/visuals/map.png', timestamp: TS } }),
        loadInspectionAssets: () => [{ key: 'lp-sat', label: 'LandPortal satellite', kind: 'satellite', storedPath: '/store/visuals/lp.png', timestamp: TS }],
        fileSize: () => 20 * 1024,
        analyze: async (images) => { analyzed.push(images); return analysis; },
        persist: (_id, r) => { persisted = r; },
        now,
      },
    );
    expect(rec.observations).toHaveLength(1);
    expect(rec.observationSummary).toMatch(/road access/i);
    expect(rec.hero?.source).toBe('landportal');
    expect(rec.hero?.source).not.toBe('static_map');
    // cardId placeholder resolved in image routes.
    const sv = rec.sources.find((s) => s.source === 'street_view')!;
    expect(sv.imageRoute).toContain('cardId=42');
    expect(sv.imageRoute).not.toContain('cardId=CARD');
    // analyze received the captured stored images (gallery), not blocked ones.
    expect(analyzed[0].length).toBeGreaterThan(0);
    expect(analyzed[0].every((i) => !!i.path)).toBe(true);
    expect(persisted).not.toBeNull();
  });

  it('card driver with no captured imagery does not call analyze and reports honestly', async () => {
    let analyzeCalls = 0;
    const rec = await runVisualIntelligenceForCard(
      { ...ctx, landPortalUrl: null },
      {
        loadGoogleVisuals: () => ({}),
        loadInspectionAssets: () => [],
        fileSize: () => 0,
        analyze: async () => { analyzeCalls++; return { observations: [], summary: '', analyzed: [], skipped: [], model: 't', generatedAt: TS, ok: false }; },
        persist: () => {},
        now,
      },
    );
    expect(analyzeCalls).toBe(0);
    expect(rec.hero).toBeNull();
    expect(rec.observations).toHaveLength(0);
    expect(rec.observationSummary).toMatch(/No captured imagery/i);
  });
});
