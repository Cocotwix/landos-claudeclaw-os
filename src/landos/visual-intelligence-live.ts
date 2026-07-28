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
import { landosArtifactPath } from './storage-profile.js';
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
import {
  assessParcelVisualCapture,
  fileSha256,
  type ParcelVisualCaptureKind,
} from './parcel-visual-framing.js';

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
  compsMapShotPath?: string | null;
  overlayShots?: Array<{ overlay: string; path: string; purpose: string }>;
  overlayMisses?: Array<{ overlay: string; reason: string }>;
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
  fileSha256?: (p: string) => string;
  now: () => string;
  tmpDir: string;
}

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

  // LandPortal is driven at most once per run. Every promoted frame must come
  // from that same subject-owned pass.
  const landPortalPasses = new Map<string, Promise<LandPortalLiveShots>>();
  const acceptedLandPortalShasBySubject = new Map<string, Set<string>>();
  const emptyLandPortalShots = (): LandPortalLiveShots => ({
    parcelShotPath: null,
    terrainShotPath: null,
    compsMapShotPath: null,
    overlayShots: [],
    overlayMisses: [],
  });
  const getLandPortal = async (subjectKey: string, url: string): Promise<LandPortalLiveShots> => {
    let pass = landPortalPasses.get(subjectKey);
    if (!pass) {
      pass = deps.captureLandPortal(url, { timeoutMs: 30000 })
        .catch(() => emptyLandPortalShots());
      landPortalPasses.set(subjectKey, pass);
    }
    return pass;
  };

  const overlayMatcher = (source: VisualSourceKind): RegExp | null => {
    switch (source) {
      case 'landportal_fema': return /fema|floodplain/i;
      case 'landportal_wetlands': return /wetland/i;
      case 'landportal_soils': return /soil/i;
      case 'landportal_contours': return /contour|terrain/i;
      default: return null;
    }
  };

  const selectLandPortalFrame = (
    source: VisualSourceKind,
    shots: LandPortalLiveShots,
  ): { path: string | null; kind: ParcelVisualCaptureKind; missing: string; state: 'blocked' | 'unavailable' } => {
    if (source === 'landportal') {
      return {
        path: shots.parcelShotPath,
        kind: 'parcel_context',
        missing: 'page failed — LandPortal did not produce a parcel-scale screenshot with the subject boundary, neighboring parcels, and fronting road.',
        state: 'blocked',
      };
    }
    if (source === 'landportal_3d') {
      return {
        path: shots.terrainShotPath,
        kind: 'terrain',
        missing: 'selector/control not found — LandPortal 3D did not produce a painted terrain frame for this parcel.',
        state: 'unavailable',
      };
    }
    if (source === 'landportal_comps') {
      return {
        path: shots.compsMapShotPath ?? null,
        kind: 'comps_map',
        missing: 'LandPortal comps map unavailable — the free “Show on Map” view was not reached or did not produce a painted map.',
        state: 'unavailable',
      };
    }
    const matcher = overlayMatcher(source);
    const shot = matcher
      ? (shots.overlayShots ?? []).find((item) => matcher.test(`${item.overlay} ${item.purpose}`))
      : undefined;
    const miss = matcher
      ? (shots.overlayMisses ?? []).find((item) => matcher.test(item.overlay))
      : undefined;
    return {
      path: shot?.path ?? null,
      kind: 'overlay',
      missing: miss?.reason
        ? `${VISUAL_SOURCE_LABEL[source]} unavailable — ${miss.reason}`
        : `${VISUAL_SOURCE_LABEL[source]} unavailable — the layer control was absent, its tiles did not paint, or no distinct overlay image was produced.`,
      state: 'unavailable',
    };
  };

  const landPortalCapturer = (source: VisualSourceKind): VisualSourceCapturer => ({
    source,
    label: VISUAL_SOURCE_LABEL[source],
    async capture(ctx): Promise<VisualAssetMeta> {
      const ts = deps.now();
      const status = await deps.ensureSession();
      if (status === 'disabled' || status === 'unreachable') return useFallback(source, ctx, blockedAsset(source, 'blocked', sessionBlocker(status), subjectOf(ctx), ts));
      if (!ctx.landPortalUrl) return useFallback(source, ctx, blockedAsset(source, 'blocked', 'LandPortal URL missing on this card — nothing to open.', subjectOf(ctx), ts));
      // A non-LandPortal URL (e.g. a county assessor page recorded on the card)
      // must never be captured AS LandPortal parcel evidence.
      try {
        if (!new URL(ctx.landPortalUrl).hostname.endsWith('landportal.com')) {
          return useFallback(source, ctx, blockedAsset(source, 'blocked', 'card URL is not a LandPortal parcel page — a non-LandPortal page is never captured as LandPortal evidence.', subjectOf(ctx), ts));
        }
      } catch {
        return useFallback(source, ctx, blockedAsset(source, 'blocked', 'card LandPortal URL is malformed.', subjectOf(ctx), ts));
      }
      const authed = await deps.landPortalAuthed();
      // A readiness navigation can fail while an already-open, authenticated
      // parcel tab remains usable. Let the capture driver prove that tab through
      // its visible owner/parcel/property panel before reporting auth missing.
      const subjectKey = `${ctx.cardId}:${ctx.landPortalUrl}`;
      const acceptedLandPortalShas = acceptedLandPortalShasBySubject.get(subjectKey) ?? new Set<string>();
      acceptedLandPortalShasBySubject.set(subjectKey, acceptedLandPortalShas);
      const shots = await getLandPortal(subjectKey, ctx.landPortalUrl);
      const selected = selectLandPortalFrame(source, shots);
      const src = selected.path;
      if (!src) {
        const reason = authed === false ? sessionBlocker('auth_needed') : selected.missing;
        return useFallback(source, ctx, blockedAsset(source, selected.state, reason, subjectOf(ctx), ts));
      }
      let sha: string | null = null;
      let bytes = 0;
      try { sha = (deps.fileSha256 ?? fileSha256)(src); } catch { /* quality verdict remains explicit */ }
      try { bytes = deps.fileSize(src); } catch { /* quality verdict remains explicit */ }
      const quality = assessParcelVisualCapture({
        kind: selected.kind,
        bytes,
        sha256: sha,
        priorSha256s: acceptedLandPortalShas,
      });
      if (!quality.accepted) {
        return useFallback(source, ctx, blockedAsset(source, 'unavailable', quality.reason ?? 'capture rejected by visual quality validation.', subjectOf(ctx), ts));
      }
      if (sha) acceptedLandPortalShas.add(sha);
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
    // Google Earth Web and browser-rendered Street View are intentionally not
    // returned here. Their loading shells can be large enough to pass a byte
    // check while still being a globe splash or black frame. The merged default
    // capturers use the association-verified Google Static Maps / Street View
    // assets instead, which are the canonical owner-facing Google visuals.
    landPortalCapturer('landportal'),
    landPortalCapturer('landportal_3d'),
    landPortalCapturer('landportal_comps'),
    landPortalCapturer('landportal_fema'),
    landPortalCapturer('landportal_wetlands'),
    landPortalCapturer('landportal_soils'),
    landPortalCapturer('landportal_contours'),
    countyGisCapturer,
  ];
}

// ── Default wiring to the real persistent Browser Intelligence session ───────

/** Copy a captured screenshot into store/visuals (the only web-served dir) with
 *  a deterministic per-card/per-source name. Returns the stored path. */
export function storeVisualCopy(srcPath: string, cardId: number, source: VisualSourceKind, storeDir?: string): string {
  const dir = storeDir ?? landosArtifactPath('visuals');
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
    // Do not trust the session's cached/unknown auth bit here. A visual run is
    // expected to be self-sufficient: verify the LandPortal session and use the
    // existing env-backed automatic login path before opening the parcel tab.
    landPortalAuthed: async () => (await session.ensureLandPortalAuthenticated()).ready,
    capturePage: async (url, outPath, opts) => {
      try { fs.mkdirSync(path.dirname(outPath), { recursive: true }); } catch { /* ignore */ }
      const res = await session.withWorkingPage(async (page) => {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs });
        await new Promise((r) => setTimeout(r, opts.settleMs));
        // Activate the tab only inside the LandOS-spawned offscreen window; a
        // visible pre-existing Chrome is never raised over the operator's work.
        if (session.browserSpawnedInBackground()) {
          await (page as { bringToFront?: () => Promise<void> }).bringToFront?.();
        }
        await page.screenshot({ path: outPath });
        try { return fs.existsSync(outPath) && fs.statSync(outPath).size > 0; } catch { return false; }
      });
      return res.ok && res.value === true;
    },
    captureLandPortal: async (url, opts) => {
      const driver = session.makeLiveBrowserDriver('vi-landportal');
      const cap = (driver as unknown as {
        captureLandPortalVisuals?: (u: string, o: { timeoutMs: number }) => Promise<LandPortalLiveShots>;
      }).captureLandPortalVisuals;
      if (!cap) return { parcelShotPath: null, terrainShotPath: null };
      const out = await cap(url, opts);
      return {
        parcelShotPath: out.parcelShotPath ?? null,
        terrainShotPath: out.terrainShotPath ?? null,
        compsMapShotPath: out.compsMapShotPath ?? null,
        overlayShots: out.overlayShots ?? [],
        overlayMisses: out.overlayMisses ?? [],
      };
    },
    storeCopy: (srcPath, cardId, source) => storeVisualCopy(srcPath, cardId, source),
    fileSize: (p) => fs.statSync(p).size,
    fileSha256,
    now,
    tmpDir,
  };
}
