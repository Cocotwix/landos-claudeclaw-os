// LandOS — Visual Intelligence for Deal Cards.
//
// Operator-grade visual workflow. The Deal Card must NOT lean on a Google Static
// Map. Instead, this orchestrator attempts every operator-relevant visual source
// in priority order, labels each capture by source, records an EXACT blocker when
// a source cannot be captured, selects the best available hero, and feeds the
// captured imagery to the vision analyzer for land-investor observations.
//
// Doctrine (Tyler's rules, enforced here):
//  - Static Map is a FALLBACK only — never the primary source and never the hero
//    when any richer source captured. `staticMapFallbackOnly` is always true.
//  - Never fabricate a visual. A source that cannot be captured is reported as
//    `blocked` (a wiring/auth/login gap we can fix) or `unavailable` (the source
//    genuinely has no imagery here) with the exact reason — never a fake image.
//  - No paid LandPortal slope report is ever requested.
//  - Visuals are SUPPORTING CONTEXT / VISUAL SIGNALS — never parcel verification.
//
// Pure orchestration (runVisualIntelligence) is injectable so tests need no
// browser, no network, and no DB. A card driver (runVisualIntelligenceForCard)
// binds it to persistence + the existing vision analyzer + card activity store.

import { sanitizeVisualConclusion } from './evidence-language.js';
import {
  analyzeScreenshots,
  type VisionAnalysis,
  type VisionSourceImage,
  type VisualObservation,
} from './browser-vision.js';

// Status-panel order (requirement: GE, GE 3D, Street View, LandPortal, LP 3D,
// County GIS) plus the static-map fallback pinned last.
export type VisualSourceKind =
  | 'google_earth_overhead'
  | 'google_earth_3d'
  | 'street_view'
  | 'landportal'
  | 'landportal_3d'
  | 'landportal_comps'
  | 'county_gis'
  | 'static_map';

export type VisualCaptureState = 'captured' | 'unavailable' | 'blocked';

export const VISUAL_SOURCE_ORDER: VisualSourceKind[] = [
  'google_earth_overhead',
  'google_earth_3d',
  'street_view',
  'landportal',
  'landportal_3d',
  'landportal_comps',
  'county_gis',
  'static_map',
];

// Hero preference — PARCEL-SPECIFIC imagery first (visual-association doctrine):
//   1. APN-specific LandPortal parcel imagery
//   2. Official county GIS parcel imagery
//   3. Verified parcel-coordinate Google Earth / satellite imagery
//   4. Verified frontage Street View
//   5. No image (never generic city / nearby-business imagery)
export const HERO_PRIORITY: VisualSourceKind[] = [
  'landportal',
  'county_gis',
  'google_earth_3d',
  'google_earth_overhead',
  'static_map',
  'street_view',
];

export const VISUAL_SOURCE_LABEL: Record<VisualSourceKind, string> = {
  google_earth_overhead: 'Google Earth (overhead)',
  google_earth_3d: 'Google Earth 3D / tilted terrain',
  street_view: 'Street View',
  landportal: 'LandPortal',
  landportal_3d: 'LandPortal 3D',
  landportal_comps: 'LandPortal comps map',
  county_gis: 'County GIS',
  static_map: 'Static map (fallback)',
};

export interface VisualSubject {
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
}

// Persisted metadata for one visual (requirement: path/URL, source, timestamp,
// subject coords/address, blocker notes).
export interface VisualAssetMeta {
  source: VisualSourceKind;
  label: string;
  state: VisualCaptureState;
  /** Server-side file path when captured to disk (gitignored store/visuals). */
  storedPath?: string;
  /** Dashboard-safe route the browser can fetch the stored image from. */
  imageRoute?: string;
  /** A source that is a live URL/deep-link rather than a stored image. */
  url?: string;
  timestamp: string;
  subject: VisualSubject;
  /** Exact reason when state is unavailable/blocked. Never empty in that case. */
  blocker?: string;
  /** True only for the static-map fallback source. */
  fallback?: boolean;
}

export interface VisualCaptureContext {
  cardId: number;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  landPortalUrl?: string | null;
}

/** A source capturer. The DEFAULT set derives from already-persisted captures
 *  (no browser/network). A live authenticated-browser backend injects real
 *  capturers for Google Earth 3D / Street View / LandPortal 3D / County GIS. */
export interface VisualSourceCapturer {
  source: VisualSourceKind;
  label: string;
  capture(ctx: VisualCaptureContext): Promise<VisualAssetMeta>;
}

export interface VisualIntelligenceRecord {
  cardId: number;
  generatedAt: string;
  subject: VisualSubject;
  /** One entry per source, in VISUAL_SOURCE_ORDER — powers the status panel. */
  sources: VisualAssetMeta[];
  /** Captured + viewable assets in gallery order (hero first). */
  gallery: VisualAssetMeta[];
  hero: VisualAssetMeta | null;
  heroReason: string;
  observations: VisualObservation[];
  observationSummary: string;
  /** Always true — encodes the doctrine that static map is fallback only. */
  staticMapFallbackOnly: true;
  note: string;
}

const MIN_USEFUL_BYTES = 8 * 1024;

function nowIso(now?: () => string): string {
  return (now ?? (() => new Date().toISOString()))();
}

export function blockedAsset(
  source: VisualSourceKind,
  state: Exclude<VisualCaptureState, 'captured'>,
  blocker: string,
  subject: VisualSubject,
  ts: string,
): VisualAssetMeta {
  return {
    source,
    label: VISUAL_SOURCE_LABEL[source],
    state,
    timestamp: ts,
    subject,
    blocker,
    fallback: source === 'static_map' ? true : undefined,
  };
}

/** A viewable asset is captured AND has something the UI can render. */
export function isViewable(a: VisualAssetMeta): boolean {
  return a.state === 'captured' && (!!a.imageRoute || !!a.storedPath || !!a.url);
}

/**
 * PURE orchestration: run every capturer, assemble one status entry per source
 * (in status-panel order), pick the hero by priority (static map last), and
 * return the assembled sources + gallery + hero. Observations are attached by the
 * card driver. No DB, no browser here — capturers are injected.
 */
export async function runVisualIntelligence(
  ctx: VisualCaptureContext,
  capturers: VisualSourceCapturer[],
  opts: { now?: () => string } = {},
): Promise<Omit<VisualIntelligenceRecord, 'observations' | 'observationSummary' | 'cardId'>> {
  const ts = nowIso(opts.now);
  const subject: VisualSubject = { address: ctx.address ?? null, lat: ctx.lat ?? null, lng: ctx.lng ?? null };

  const bySource = new Map<VisualSourceKind, VisualAssetMeta>();
  for (const c of capturers) {
    let asset: VisualAssetMeta;
    try {
      asset = await c.capture(ctx);
    } catch (err) {
      asset = blockedAsset(c.source, 'blocked', `capture threw: ${(err as Error)?.message ?? 'unknown error'}`, subject, ts);
    }
    // A capturer must not silently drop the fallback flag / label.
    asset.label = asset.label || VISUAL_SOURCE_LABEL[c.source];
    if (c.source === 'static_map') asset.fallback = true;
    bySource.set(c.source, asset);
  }

  // One row per known source, in status-panel order. A source with no capturer
  // is reported blocked with an explicit reason (never omitted silently).
  const sources: VisualAssetMeta[] = VISUAL_SOURCE_ORDER.map(
    (s) => bySource.get(s) ?? blockedAsset(s, 'blocked', 'no capturer wired for this source', subject, ts),
  );

  const captured = sources.filter(isViewable);
  const richestCaptured = captured.filter((a) => a.source !== 'static_map');

  // Hero: first captured source by HERO_PRIORITY. Static map only wins when it is
  // the ONLY captured source — enforcing static-map-as-fallback-only.
  let hero: VisualAssetMeta | null = null;
  for (const kind of HERO_PRIORITY) {
    const found = captured.find((a) => a.source === kind);
    if (found) { hero = found; break; }
  }
  const heroReason = !hero
    ? 'No source captured a viewable image; no hero.'
    : hero.source === 'static_map'
      ? 'Static map used as hero only because no richer source captured (fallback of last resort).'
      : `${hero.label} is the highest-priority captured source.`;

  // Gallery: hero first, then remaining captured in status-panel order.
  const gallery = hero
    ? [hero, ...captured.filter((a) => a !== hero)]
    : [...captured];

  const note = captured.length === 0
    ? 'No visual captured from any source. See per-source blockers. Static map is fallback only.'
    : `${richestCaptured.length} richer-than-static source(s) captured; ${captured.length} viewable total. Visual signals only — never parcel verification.`;

  return { generatedAt: ts, subject, sources, gallery, hero, heroReason, staticMapFallbackOnly: true, note };
}

// ── Default capturers: derive honestly from already-persisted captures ───────
// These make NO browser call and NO network call. They read what prior workflows
// already captured (Google visual store + LandPortal inspection screenshots) and
// report the interactive/live-only sources as blocked with the exact wiring gap.
// A live authenticated-browser backend replaces these via injected capturers.

export interface PersistedVisualReaders {
  loadGoogleVisuals: (cardId: number) => Record<string, { storedPath: string; timestamp: string }>;
  loadInspectionAssets: (cardId: number) => Array<{ key: string; label: string; kind: string; storedPath: string; timestamp?: string }>;
  fileSize: (p: string) => number;
  now?: () => string;
}

/** Exact, actionable blocker for sources that require a live authenticated
 *  browser session that is not wired in this environment. */
export const LIVE_BROWSER_BLOCKER =
  'No authenticated live-browser backend connected. Requires Chrome CDP on :9222 + BROWSER_INTEL_LIVE=1 + a signed-in LandPortal session, then a server restart. No visual was fabricated.';

function classifyGoogleService(service: string): VisualSourceKind | null {
  const s = service.toLowerCase();
  if (/street/.test(s)) return 'street_view';
  if (/static|maps_static|^map$|aerial|satellite/.test(s)) return 'static_map';
  if (/earth/.test(s)) return 'google_earth_overhead';
  return null;
}

/** Build the default (persistence-derived) capturer set for a card. */
export function defaultCapturers(readers: PersistedVisualReaders): VisualSourceCapturer[] {
  const now = readers.now;
  const usable = (p: string): boolean => {
    try { return readers.fileSize(p) >= MIN_USEFUL_BYTES; } catch { return false; }
  };

  const fromGoogle = (source: VisualSourceKind, matchService: (s: string) => boolean, route: (svc: string) => string): VisualSourceCapturer => ({
    source,
    label: VISUAL_SOURCE_LABEL[source],
    async capture(ctx): Promise<VisualAssetMeta> {
      const ts = nowIso(now);
      const subject: VisualSubject = { address: ctx.address ?? null, lat: ctx.lat ?? null, lng: ctx.lng ?? null };
      const visuals = readers.loadGoogleVisuals(ctx.cardId);
      for (const [svc, asset] of Object.entries(visuals)) {
        if (matchService(svc) && asset?.storedPath && usable(asset.storedPath)) {
          return {
            source, label: VISUAL_SOURCE_LABEL[source], state: 'captured',
            storedPath: asset.storedPath, imageRoute: route(svc),
            timestamp: asset.timestamp || ts, subject,
            fallback: source === 'static_map' ? true : undefined,
          };
        }
      }
      // Not yet captured. Street View may simply have no coverage; static map
      // only fails if Google visual was never run.
      const reason = source === 'street_view'
        ? 'Street View not captured yet — run visual capture; if it still fails, Google has no Street View coverage on this road.'
        : 'Static map not captured yet — run visual capture (fallback source).';
      return blockedAsset(source, source === 'street_view' ? 'unavailable' : 'blocked', reason, subject, ts);
    },
  });

  // LandPortal visuals are derived from the persisted inspection assets that
  // acquire/report already capture, KIND-SPECIFICALLY so each source shows the
  // right screenshot (parcel page vs 3D vs comps map) — never the wrong one.
  const fromInspection = (source: VisualSourceKind, pick: (kind: string) => boolean, notYet: string): VisualSourceCapturer => ({
    source,
    label: VISUAL_SOURCE_LABEL[source],
    async capture(ctx): Promise<VisualAssetMeta> {
      const ts = nowIso(now);
      const subject: VisualSubject = { address: ctx.address ?? null, lat: ctx.lat ?? null, lng: ctx.lng ?? null };
      const shot = readers.loadInspectionAssets(ctx.cardId).find((a) => pick(a.kind) && a.storedPath && usable(a.storedPath));
      if (shot) {
        return {
          source, label: VISUAL_SOURCE_LABEL[source], state: 'captured',
          storedPath: shot.storedPath, imageRoute: `/api/landos/inspection/image?cardId=${ctx.cardId}&key=${encodeURIComponent(shot.key)}`,
          url: ctx.landPortalUrl ?? undefined, timestamp: shot.timestamp || ts, subject,
        };
      }
      const reason = ctx.landPortalUrl ? notYet : 'No LandPortal URL on this card — cannot capture this LandPortal visual.';
      return blockedAsset(source, source === 'landportal_3d' ? 'unavailable' : 'blocked', reason, subject, ts);
    },
  });
  const isOverlay = (k: string) => /^overlay/i.test(k);
  const is3d = (k: string) => /parcel_3d|terrain|3d/i.test(k);
  const isComps = (k: string) => /comparables_map|comps/i.test(k);

  // Interactive/live-only sources: honest blocker until a live browser backend
  // is injected. No paid LandPortal slope report is ever requested.
  const liveOnly = (source: VisualSourceKind): VisualSourceCapturer => ({
    source,
    label: VISUAL_SOURCE_LABEL[source],
    async capture(ctx): Promise<VisualAssetMeta> {
      const ts = nowIso(now);
      const subject: VisualSubject = { address: ctx.address ?? null, lat: ctx.lat ?? null, lng: ctx.lng ?? null };
      return blockedAsset(source, 'blocked', LIVE_BROWSER_BLOCKER, subject, ts);
    },
  });

  return [
    liveOnly('google_earth_overhead'),
    liveOnly('google_earth_3d'),
    fromGoogle('street_view', (s) => /street/.test(s.toLowerCase()), (svc) => `/api/landos/visual/image?cardId=CARD&service=${encodeURIComponent(svc)}`),
    fromInspection('landportal', (k) => !is3d(k) && !isComps(k) && !isOverlay(k), 'LandPortal parcel screenshot not captured yet — run Property Intelligence (authenticated session required).'),
    fromInspection('landportal_3d', (k) => is3d(k), 'LandPortal 3D/terrain not captured yet — the 3D control may not exist on this parcel, or Property Intelligence has not run.'),
    fromInspection('landportal_comps', (k) => isComps(k), 'LandPortal comps map not captured yet — run Property Intelligence (free "Show on Map"; never the paid comp report).'),
    liveOnly('county_gis'),
    fromGoogle('static_map', (s) => { const k = classifyGoogleService(s); return k === 'static_map'; }, (svc) => `/api/landos/visual/image?cardId=CARD&service=${encodeURIComponent(svc)}`),
  ];
}

// ── Card driver: bind orchestration to persistence + vision + activity store ──

export interface VisualIntelligenceCardDeps {
  loadGoogleVisuals: (cardId: number) => Record<string, { storedPath: string; timestamp: string }>;
  loadInspectionAssets: (cardId: number) => Array<{ key: string; label: string; kind: string; storedPath: string; timestamp?: string }>;
  fileSize: (p: string) => number;
  analyze: (images: VisionSourceImage[], ctx: { address?: string; county?: string; state?: string }) => Promise<VisionAnalysis>;
  persist: (cardId: number, record: VisualIntelligenceRecord) => void;
  /** Live authenticated-browser capturers, when a live backend is connected. */
  liveCapturers?: VisualSourceCapturer[];
  now?: () => string;
}

/**
 * Run the full Visual Intelligence workflow for one card and persist the result.
 * Uses live capturers when injected, otherwise the persistence-derived defaults.
 * Gathers the captured stored images and runs the vision analyzer for land-
 * investor observations. Never fabricates a visual or an observation.
 */
export async function runVisualIntelligenceForCard(
  ctx: VisualCaptureContext & { county?: string | null; state?: string | null },
  deps: VisualIntelligenceCardDeps,
): Promise<VisualIntelligenceRecord> {
  const readers: PersistedVisualReaders = {
    loadGoogleVisuals: deps.loadGoogleVisuals,
    loadInspectionAssets: deps.loadInspectionAssets,
    fileSize: deps.fileSize,
    now: deps.now,
  };
  const capturers = deps.liveCapturers && deps.liveCapturers.length
    ? mergeLiveCapturers(defaultCapturers(readers), deps.liveCapturers)
    : defaultCapturers(readers);

  const base = await runVisualIntelligence(ctx, capturers, { now: deps.now });

  // Fix up the cardId placeholder in google image routes.
  for (const a of base.sources) if (a.imageRoute) a.imageRoute = a.imageRoute.replace('cardId=CARD', `cardId=${ctx.cardId}`);
  for (const a of base.gallery) if (a.imageRoute) a.imageRoute = a.imageRoute.replace('cardId=CARD', `cardId=${ctx.cardId}`);
  if (base.hero?.imageRoute) base.hero.imageRoute = base.hero.imageRoute.replace('cardId=CARD', `cardId=${ctx.cardId}`);

  // Observations from the captured stored imagery (reuses the vision analyzer).
  const images: VisionSourceImage[] = base.gallery
    .filter((a) => a.storedPath)
    .map((a) => ({ label: a.label, kind: a.source, path: a.storedPath as string }));

  let observations: VisualObservation[] = [];
  let observationSummary = 'No captured imagery to analyze for visual observations.';
  if (images.length > 0) {
    const analysis = await deps.analyze(images, {
      address: ctx.address ?? undefined,
      county: ctx.county ?? undefined,
      state: ctx.state ?? undefined,
    });
    observations = analysis.observations;
    observationSummary = analysis.summary;
  }

  const record: VisualIntelligenceRecord = {
    cardId: ctx.cardId,
    ...base,
    observations,
    observationSummary,
  };
  deps.persist(ctx.cardId, record);
  return record;
}

// ── Read-time eligibility sanitizer (defense in depth) ──────────────────────
// A persisted VI record may predate the parcel-association model or reference
// Google captures that were later superseded. On every read, Google-derived
// entries must re-prove association; excluded entries flip to 'unavailable'
// with an operator-facing reason and the hero is recomputed. LandPortal /
// county-GIS entries are APN-page-associated by construction.

const GOOGLE_DERIVED: ReadonlySet<VisualSourceKind> = new Set([
  'google_earth_overhead', 'google_earth_3d', 'street_view', 'static_map',
]);

export interface SanitizeStores {
  /** Card visual store entries that PASS eligibility (association-proven). */
  eligibleGoogle: Record<string, { storedPath: string }>;
  /** ALL card visual store entries (to detect store-backed vs live captures). */
  rawGoogle: Record<string, { storedPath: string }>;
}

export const IMAGE_EXCLUDED_NOTE =
  'Image excluded because parcel association could not be confirmed.';

function assetEligible(a: VisualAssetMeta, stores: SanitizeStores): boolean {
  if (a.state !== 'captured') return true; // nothing rendered; keep the honest status
  if (!GOOGLE_DERIVED.has(a.source)) {
    // "LandPortal" assets are APN-page-associated ONLY when they actually came
    // from a LandPortal parcel page. A capture whose URL is some other site
    // (e.g. a county office homepage the workflow landed on) is not parcel
    // evidence and must not render — let alone become the hero.
    if ((a.source === 'landportal' || a.source === 'landportal_3d' || a.source === 'landportal_comps') && a.url) {
      try {
        return new URL(a.url).hostname.endsWith('landportal.com');
      } catch {
        return false;
      }
    }
    return true;
  }
  const inRaw = a.storedPath ? Object.values(stores.rawGoogle).some((x) => x.storedPath === a.storedPath) : false;
  if (inRaw) {
    // Store-backed capture: must ALSO be in the eligible set (association-proven).
    return Object.values(stores.eligibleGoogle).some((x) => x.storedPath === a.storedPath);
  }
  // Live capture (Google Earth / live Street View): eligible only when it was
  // navigated by verified parcel coordinates (subject coords recorded).
  return typeof a.subject?.lat === 'number' && Number.isFinite(a.subject.lat)
    && typeof a.subject?.lng === 'number' && Number.isFinite(a.subject.lng);
}

/** Sanitize a persisted VI record: exclude association-less Google imagery and
 *  recompute the hero from the surviving assets. Pure — returns a new record. */
export function sanitizeVisualIntelligenceRecord(
  record: VisualIntelligenceRecord,
  stores: SanitizeStores,
): VisualIntelligenceRecord {
  const sources = (record.sources ?? []).map((a) => {
    if (assetEligible(a, stores)) return a;
    return {
      ...a,
      state: 'unavailable' as VisualCaptureState,
      storedPath: undefined,
      imageRoute: undefined,
      url: undefined,
      blocker: IMAGE_EXCLUDED_NOTE,
    };
  });
  const captured = sources.filter(isViewable);
  let hero: VisualAssetMeta | null = null;
  for (const kind of HERO_PRIORITY) {
    const found = captured.find((a) => a.source === kind);
    if (found) { hero = found; break; }
  }
  const gallery = hero ? [hero, ...captured.filter((a) => a !== hero)] : [...captured];
  const excludedCount = (record.gallery ?? []).length - gallery.length;
  // Safe visual conclusions: persisted observations may predate the shared
  // safe-language rules ("fronts a paved road", "serves the parcel", ...).
  // Unsafe claims rewrite to attribution-honest text at read time, and a
  // rewritten claim is at most a nearby-feature note - never "positive".
  const observations = (record.observations ?? []).map((obs) => {
    const safe = sanitizeVisualConclusion(obs.observation);
    return { ...obs, observation: safe.text, signal: safe.rewritten && obs.signal === 'positive' ? 'neutral' as const : obs.signal };
  });
  return {
    ...record,
    sources,
    gallery,
    observations,
    hero,
    heroReason: hero
      ? `${hero.label} is the highest-priority verified parcel image.`
      : 'No verified parcel image available — nothing is shown rather than a misleading visual.',
    note: excludedCount > 0
      ? `${record.note ?? ''} ${excludedCount} image(s) excluded because parcel association could not be confirmed.`.trim()
      : record.note,
  };
}

/** Replace any default capturer whose source a live capturer also covers. */
export function mergeLiveCapturers(
  defaults: VisualSourceCapturer[],
  live: VisualSourceCapturer[],
): VisualSourceCapturer[] {
  const liveBySource = new Map(live.map((c) => [c.source, c]));
  return defaults.map((d) => liveBySource.get(d.source) ?? d);
}
