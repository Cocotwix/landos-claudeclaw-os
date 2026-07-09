// LandOS — Visual Intelligence LIVE capturers.
//
// Wires the Visual Intelligence spine (visual-intelligence.ts) to the EXISTING
// persistent Browser Intelligence session (browser-session.ts) so that, WHEN an
// authenticated Chrome/CDP session is available, the Deal Card actually captures
// Google Earth (overhead), Google Earth 3D, Street View, LandPortal parcel,
// LandPortal 3D/terrain, and (best-effort) County GIS visuals — instead of only
// reporting "no live-browser backend connected".
//
// Doctrine preserved:
//  - Read-only: navigate + screenshot only. Never a paid/comp/slope/billing click.
//  - No fabrication: a source that cannot be captured returns `blocked` /
//    `unavailable` with the EXACT reason (CDP unavailable, auth/session missing,
//    coordinates missing, page failed, control not found, view unavailable, site
//    blocked, implementation gap).
//  - Live-first, persistence-fallback: when a live attempt yields nothing but a
//    prior stored capture exists, the injected fallback capturer is used so the
//    Deal Card never regresses (LandPortal stays captured, static map stays
//    fallback only).
//
// Fully injectable so tests exercise the wiring with a fake session/page and the
// build never launches or connects to a browser.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

import {
  blockedAsset,
  isViewable,
  VISUAL_SOURCE_LABEL,
  type VisualSourceKind,
  type VisualSourceCapturer,
  type VisualCaptureContext,
  type VisualAssetMeta,
  type VisualSubject,
} from './visual-intelligence.js';

export type LiveSessionStatus = 'live' | 'auth_needed' | 'unreachable' | 'disabled';

/** Map a session status to the exact operator-facing blocker. */
export function sessionBlocker(status: LiveSessionStatus): string {
  switch (status) {
    case 'disabled': return 'CDP unavailable — live browser is disabled. Set BROWSER_INTEL_LIVE=1 and Start Browser Intelligence.';
    case 'unreachable': return 'CDP unavailable — no Chrome answering on the debugging port (:9222). Start Browser Intelligence.';
    case 'auth_needed': return 'auth/session missing — connected, but LandPortal is not logged in. Open LandPortal in the session, sign in, then retry.';
    default: return '';
  }
}

export interface LandPortalLiveShots {
  parcelShotPath: string | null;
  terrainShotPath: string | null;
}

/** Injectable seam so tests need no Chrome. Defaults wire to browser-session. */
export interface LiveVisualDeps {
  ensureSession: () => Promise<LiveSessionStatus>;
  /** LandPortal authentication (null = unknown → attempt; false = needs login). */
  landPortalAuthed: () => Promise<boolean | null>;
  /** Open a URL in the session and screenshot it to outPath. Returns true on a
   *  real (non-blank) capture, false on page/screenshot failure. */
  capturePage: (url: string, outPath: string, opts: { timeoutMs: number; settleMs: number }) => Promise<boolean>;
  /** Drive LandPortal once: parcel screenshot + (best-effort) 3D/terrain shot. */
  captureLandPortal: (url: string, opts: { timeoutMs: number }) => Promise<LandPortalLiveShots>;
  /** Copy a captured temp screenshot into store/visuals (web-servable). */
  storeCopy: (srcPath: string, cardId: number, source: VisualSourceKind) => string;
  fileSize: (p: string) => number;
  now: () => string;
  tmpDir: string;
}

const MIN_USEFUL_BYTES = 8 * 1024;

function subjectOf(ctx: VisualCaptureContext): VisualSubject {
  return { address: ctx.address ?? null, lat: ctx.lat ?? null, lng: ctx.lng ?? null };
}

function capturedAsset(source: VisualSourceKind, storedPath: string, ctx: VisualCaptureContext, ts: string, url?: string): VisualAssetMeta {
  return {
    source,
    label: VISUAL_SOURCE_LABEL[source],
    state: 'captured',
    storedPath,
    imageRoute: `/api/landos/visual-intelligence/image?cardId=CARD&source=${source}`,
    url,
    timestamp: ts,
    subject: subjectOf(ctx),
    fallback: source === 'static_map' ? true : undefined,
  };
}

function hasCoords(ctx: VisualCaptureContext): boolean {
  return typeof ctx.lat === 'number' && Number.isFinite(ctx.lat) && typeof ctx.lng === 'number' && Number.isFinite(ctx.lng);
}

// Google Earth Web deep link. tilt=0 → straight-down overhead; tilt>0 → 3D.
function googleEarthUrl(lat: number, lng: number, tiltDeg: number): string {
  // @lat,lng,ALTITUDEa,RANGEd,HEADINGy,0h,TILTt,0r
  return `https://earth.google.com/web/@${lat},${lng},600a,2500d,35y,0h,${tiltDeg}t,0r`;
}
function streetViewUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
}

/**
 * Build the LIVE visual source capturers. `fallback` (the persistence-derived
 * default capturers) is used when a live attempt captures nothing, so a live
 * session never regresses a source that was previously captured to disk.
 */
export function makeLiveVisualCapturers(deps: LiveVisualDeps, fallback: VisualSourceCapturer[] = []): VisualSourceCapturer[] {
  const fb = new Map(fallback.map((c) => [c.source, c]));
  const useFallback = async (source: VisualSourceKind, ctx: VisualCaptureContext, liveBlocker: VisualAssetMeta): Promise<VisualAssetMeta> => {
    const f = fb.get(source);
    if (!f) return liveBlocker;
    const alt = await f.capture(ctx);
    return isViewable(alt) ? alt : liveBlocker;
  };

  // LandPortal is driven at most once per run (parcel + terrain from one pass).
  let lpShots: LandPortalLiveShots | null = null;
  let lpTried = false;
  const getLandPortal = async (url: string): Promise<LandPortalLiveShots> => {
    if (!lpTried) { lpTried = true; try { lpShots = await deps.captureLandPortal(url, { timeoutMs: 30000 }); } catch { lpShots = { parcelShotPath: null, terrainShotPath: null }; } }
    return lpShots ?? { parcelShotPath: null, terrainShotPath: null };
  };

  const gate = async (source: VisualSourceKind, ctx: VisualCaptureContext): Promise<VisualAssetMeta | null> => {
    const status = await deps.ensureSession();
    if (status === 'live') return null;
    if (status === 'auth_needed' && (source === 'google_earth_overhead' || source === 'google_earth_3d' || source === 'street_view')) return null; // Google needs no login
    // Session down (or LandPortal needs login): blocked with exact reason, then fallback.
    const blk = blockedAsset(source, 'blocked', sessionBlocker(status), subjectOf(ctx), deps.now());
    return useFallback(source, ctx, blk);
  };

  const earthCapturer = (source: 'google_earth_overhead' | 'google_earth_3d', tilt: number): VisualSourceCapturer => ({
    source,
    label: VISUAL_SOURCE_LABEL[source],
    async capture(ctx): Promise<VisualAssetMeta> {
      const gated = await gate(source, ctx);
      if (gated) return gated;
      const ts = deps.now();
      if (!hasCoords(ctx)) return useFallback(source, ctx, blockedAsset(source, 'blocked', 'coordinates missing — Google Earth needs a confirmed lat/lng for this parcel.', subjectOf(ctx), ts));
      const tmp = path.join(deps.tmpDir, `earth-${source}-${ctx.cardId}-${Date.now()}.png`);
      let ok = false;
      try { ok = await deps.capturePage(googleEarthUrl(ctx.lat as number, ctx.lng as number, tilt), tmp, { timeoutMs: 30000, settleMs: 9000 }); }
      catch { ok = false; }
      if (!ok) return useFallback(source, ctx, blockedAsset(source, 'blocked', 'page failed — Google Earth did not render a usable frame (WebGL/load). Retry with the session focused.', subjectOf(ctx), ts));
      let stored: string;
      try { stored = deps.storeCopy(tmp, ctx.cardId, source); } catch { return blockedAsset(source, 'blocked', 'implementation gap — captured image could not be stored.', subjectOf(ctx), ts); }
      if (deps.fileSize(stored) < MIN_USEFUL_BYTES) return useFallback(source, ctx, blockedAsset(source, 'unavailable', 'view unavailable — Google Earth returned a blank/too-small frame.', subjectOf(ctx), ts));
      return capturedAsset(source, stored, ctx, ts);
    },
  });

  const streetViewCapturer: VisualSourceCapturer = {
    source: 'street_view',
    label: VISUAL_SOURCE_LABEL.street_view,
    async capture(ctx): Promise<VisualAssetMeta> {
      const gated = await gate('street_view', ctx);
      if (gated) return gated;
      const ts = deps.now();
      if (!hasCoords(ctx)) return useFallback('street_view', ctx, blockedAsset('street_view', 'blocked', 'coordinates missing — Street View needs a lat/lng viewpoint.', subjectOf(ctx), ts));
      const tmp = path.join(deps.tmpDir, `streetview-${ctx.cardId}-${Date.now()}.png`);
      let ok = false;
      try { ok = await deps.capturePage(streetViewUrl(ctx.lat as number, ctx.lng as number), tmp, { timeoutMs: 25000, settleMs: 6000 }); }
      catch { ok = false; }
      if (!ok) return useFallback('street_view', ctx, blockedAsset('street_view', 'unavailable', 'view unavailable — no Street View pano at this viewpoint, or the page failed to render.', subjectOf(ctx), ts));
      let stored: string;
      try { stored = deps.storeCopy(tmp, ctx.cardId, 'street_view'); } catch { return blockedAsset('street_view', 'blocked', 'implementation gap — captured image could not be stored.', subjectOf(ctx), ts); }
      if (deps.fileSize(stored) < MIN_USEFUL_BYTES) return useFallback('street_view', ctx, blockedAsset('street_view', 'unavailable', 'view unavailable — Street View returned a blank/too-small frame.', subjectOf(ctx), ts));
      return capturedAsset('street_view', stored, ctx, ts);
    },
  };

  const landPortalCapturer = (source: 'landportal' | 'landportal_3d'): VisualSourceCapturer => ({
    source,
    label: VISUAL_SOURCE_LABEL[source],
    async capture(ctx): Promise<VisualAssetMeta> {
      const ts = deps.now();
      const status = await deps.ensureSession();
      if (status === 'disabled' || status === 'unreachable') return useFallback(source, ctx, blockedAsset(source, 'blocked', sessionBlocker(status), subjectOf(ctx), ts));
      if (!ctx.landPortalUrl) return useFallback(source, ctx, blockedAsset(source, 'blocked', 'LandPortal URL missing on this card — nothing to open.', subjectOf(ctx), ts));
      const authed = await deps.landPortalAuthed();
      if (authed === false) return useFallback(source, ctx, blockedAsset(source, 'blocked', sessionBlocker('auth_needed'), subjectOf(ctx), ts));
      const shots = await getLandPortal(ctx.landPortalUrl);
      const src = source === 'landportal' ? shots.parcelShotPath : shots.terrainShotPath;
      if (!src) {
        const reason = source === 'landportal'
          ? 'page failed — LandPortal parcel view did not produce a screenshot (login/slow render).'
          : 'selector/control not found — the LandPortal 3D/terrain control was not present on this parcel view.';
        return useFallback(source, ctx, blockedAsset(source, source === 'landportal_3d' ? 'unavailable' : 'blocked', reason, subjectOf(ctx), ts));
      }
      let stored: string;
      try { stored = deps.storeCopy(src, ctx.cardId, source); } catch { return blockedAsset(source, 'blocked', 'implementation gap — captured image could not be stored.', subjectOf(ctx), ts); }
      return capturedAsset(source, stored, ctx, ts, ctx.landPortalUrl ?? undefined);
    },
  });

  const countyGisCapturer: VisualSourceCapturer = {
    source: 'county_gis',
    label: VISUAL_SOURCE_LABEL.county_gis,
    async capture(ctx): Promise<VisualAssetMeta> {
      // No generic County GIS visual provider/link is wired yet. Report the exact
      // implementation gap rather than fabricating — a per-county GIS deep link or
      // provider is the follow-on that makes this source live.
      return useFallback('county_gis', ctx, blockedAsset('county_gis', 'blocked', 'implementation gap — no County GIS visual provider/deep-link wired for this county yet.', subjectOf(ctx), deps.now()));
    },
  };

  return [
    earthCapturer('google_earth_overhead', 0),
    earthCapturer('google_earth_3d', 60),
    streetViewCapturer,
    landPortalCapturer('landportal'),
    landPortalCapturer('landportal_3d'),
    countyGisCapturer,
  ];
}

// ── Default wiring to the real persistent Browser Intelligence session ───────

/** Copy a captured screenshot into store/visuals (the only web-served dir) with
 *  a deterministic per-card/per-source name. Returns the stored path. */
export function storeVisualCopy(srcPath: string, cardId: number, source: VisualSourceKind, storeDir?: string): string {
  const dir = storeDir ?? path.join(process.cwd(), 'store', 'visuals');
  fs.mkdirSync(dir, { recursive: true });
  const h = crypto.createHash('sha256').update(`${cardId}:${source}`).digest('hex').slice(0, 8);
  const dest = path.join(dir, `vi_${cardId}_${source}_${h}.png`);
  fs.copyFileSync(srcPath, dest);
  return dest;
}

/** Wire LiveVisualDeps to the real browser-session (prod). Dynamically imported
 *  so tests/build never load puppeteer. */
export async function defaultLiveVisualDeps(): Promise<LiveVisualDeps> {
  const session = await import('./browser-session.js');
  const cfg = session.readSessionConfig();
  const tmpDir = cfg.screenshotDir || path.join(os.tmpdir(), 'landos-browser-shots');
  const now = () => new Date().toISOString();
  return {
    ensureSession: async () => (await session.ensureBrowserSession()) as LiveSessionStatus,
    landPortalAuthed: async () => (await session.browserSessionHealth()).landportalAuthenticated,
    capturePage: async (url, outPath, opts) => {
      try { fs.mkdirSync(path.dirname(outPath), { recursive: true }); } catch { /* ignore */ }
      const res = await session.withWorkingPage(async (page) => {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs });
        await new Promise((r) => setTimeout(r, opts.settleMs));
        await (page as { bringToFront?: () => Promise<void> }).bringToFront?.();
        await page.screenshot({ path: outPath });
        try { return fs.existsSync(outPath) && fs.statSync(outPath).size > 0; } catch { return false; }
      });
      return res.ok && res.value === true;
    },
    captureLandPortal: async (url, opts) => {
      const driver = session.makeLiveBrowserDriver('vi-landportal');
      const cap = (driver as unknown as { captureLandPortalVisuals?: (u: string, o: { timeoutMs: number }) => Promise<{ parcelShotPath: string | null; terrainShotPath: string | null }> }).captureLandPortalVisuals;
      if (!cap) return { parcelShotPath: null, terrainShotPath: null };
      const out = await cap(url, opts);
      return { parcelShotPath: out.parcelShotPath ?? null, terrainShotPath: out.terrainShotPath ?? null };
    },
    storeCopy: (srcPath, cardId, source) => storeVisualCopy(srcPath, cardId, source),
    fileSize: (p) => fs.statSync(p).size,
    now,
    tmpDir,
  };
}
