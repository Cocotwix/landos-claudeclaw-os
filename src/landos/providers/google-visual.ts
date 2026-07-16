// LandOS Visual Property Context — Google visual provider (behind a capability).
//
// Visuals are SUPPORTING CONTEXT ONLY. They never verify the subject parcel.
// Every visual carries the label "Visual Signal, Not Verified Fact" plus provider
// provenance + timestamp.
//
// Two clearly separated paths:
//   1. buildVisualPropertyContext(...) — PURE. Builds keyless Google deep links +
//      image placeholders/metadata. Makes NO network call and embeds NO API key.
//      Safe to call in the Deal Card / Discovery Call Report render path, tests,
//      and dashboard. This is what ships by default (links + placeholders).
//   2. capturePropertyVisuals(...) — the EXPLICIT, per-property, gated fetch that
//      actually calls Google Static APIs and stores image bytes locally. It is
//      NEVER called by tests, dashboard startup, or hidden workflows — only by an
//      explicit operator-run capture, and it routes through the usage guard.
//
// The API key is read only inside the capture path (presence-only elsewhere) and
// is NEVER returned to the client, the report, or any deep link.

import { readEnvFile } from '../../env.js';
import type { VisualAssociation } from '../visual-eligibility.js';

const GOOGLE_MAPS_ENV_KEY = 'GOOGLE_MAPS_API_KEY';
export { GOOGLE_MAPS_ENV_KEY };

/** Mandatory label on any visual interpretation. */
export const VISUAL_NOT_VERIFIED_LABEL = 'Visual Signal, Not Verified Fact' as const;
export type VisualVerificationStatus = typeof VISUAL_NOT_VERIFIED_LABEL;

/** The Google visual services LandOS can use (provider-specific names kept here,
 *  behind the capability). */
export const VISUAL_SERVICES = ['maps_static', 'street_view_static', 'map_tiles_terrain', 'aerial_3d'] as const;
export type VisualService = (typeof VISUAL_SERVICES)[number];

export interface VisualServiceStatus {
  service: VisualService;
  apiService: string;
  /** Presence-only: true when GOOGLE_MAPS_API_KEY is configured. */
  configured: boolean;
  /** Static image available via a per-property capture; 'aerial_3d' is link/placeholder only. */
  imageCapable: boolean;
  note: string;
}

export interface Coords { lat: number; lng: number }

export interface VisualAsset {
  service: VisualService;
  imageType: 'satellite_static' | 'street_view' | 'terrain' | 'aerial_3d';
  /** captured = a stored local image exists; not_captured = placeholder (no call
   *  made yet); unavailable = cannot build for this input. */
  status: 'captured' | 'not_captured' | 'unavailable';
  /** Local stored image path when captured (gitignored; never in repo). */
  storedPath: string | null;
  /** Dashboard-safe URL to fetch the captured image (token-gated route). Null
   *  until captured. The web renders this; the raw filesystem path is never
   *  exposed to the browser. */
  imageUrl: string | null;
  /** Keyless Google deep link for this view (always safe to expose). */
  deepLink: string | null;
  provider: 'google';
  apiService: string;
  sourceAddress: string | null;
  sourceCoords: Coords | null;
  association?: VisualAssociation | null;
  timestamp: string;
  /** 'none' for placeholders/links; 'one_request' once an image is captured. */
  costRisk: 'none' | 'one_request';
  verificationStatus: VisualVerificationStatus;
  note: string;
}

export interface VisualPropertyContext {
  provider: 'google';
  configured: boolean;
  label: VisualVerificationStatus;
  generatedAt: string;
  source: { address: string | null; coords: Coords | null };
  assets: VisualAsset[];
  /** Keyless clickable deep links (backup / deep-dive). */
  links: { maps: string | null; streetView: string | null; earth: string | null };
  note: string;
}

// ── Presence / status (value-blind) ──────────────────────────────────────────

export function googleVisualConfigured(env: Record<string, string | undefined> = process.env): boolean {
  const v = env[GOOGLE_MAPS_ENV_KEY];
  return typeof v === 'string' && v.trim().length > 0;
}

/** Presence-only resolver that also consults the .env file (process.env wins),
 *  mirroring how other provider keys resolve. Respects the hermetic test guard.
 *  Never reads/returns the value — boolean only. */
export function googleVisualConfiguredResolved(): boolean {
  if (googleVisualConfigured(process.env)) return true;
  if (process.env.LANDOS_DISABLE_DOTENV_FALLBACK) return false;
  try {
    const v = readEnvFile([GOOGLE_MAPS_ENV_KEY])[GOOGLE_MAPS_ENV_KEY];
    return typeof v === 'string' && v.trim().length > 0;
  } catch {
    return false;
  }
}

/** Resolve an env object carrying the Google key VALUE for the capture path
 *  (process.env wins, else .env). The value is used only to call the Google
 *  Static APIs server-side and is never logged or returned to the client. */
export function resolveGoogleVisualEnv(): Record<string, string | undefined> {
  let v = process.env[GOOGLE_MAPS_ENV_KEY] ?? '';
  if (!v && !process.env.LANDOS_DISABLE_DOTENV_FALLBACK) {
    try { v = readEnvFile([GOOGLE_MAPS_ENV_KEY])[GOOGLE_MAPS_ENV_KEY] ?? ''; } catch { v = ''; }
  }
  return { [GOOGLE_MAPS_ENV_KEY]: v };
}

export function googleVisualStatus(env: Record<string, string | undefined> = process.env): {
  provider: 'google'; configured: boolean; services: VisualServiceStatus[];
} {
  const configured = googleVisualConfigured(env);
  const services: VisualServiceStatus[] = [
    { service: 'maps_static', apiService: 'Maps Static API', configured, imageCapable: true, note: 'Satellite/static map image for the property area (context only).' },
    { service: 'street_view_static', apiService: 'Street View Static API', configured, imageCapable: true, note: 'Street/frontage view where coverage exists (context only).' },
    { service: 'map_tiles_terrain', apiService: 'Map Tiles / Static terrain', configured, imageCapable: true, note: 'Road/access + terrain context.' },
    { service: 'aerial_3d', apiService: 'Aerial / Photorealistic 3D (link)', configured, imageCapable: false, note: 'Deep link / placeholder only — no static image endpoint used.' },
  ];
  return { provider: 'google', configured, services };
}

// ── Keyless deep links (always safe — no API key) ────────────────────────────

function q(s: string): string { return encodeURIComponent(s.trim()); }
function coordStr(c: Coords): string { return `${c.lat},${c.lng}`; }
function target(address: string | null, coords: Coords | null): string | null {
  if (coords) return coordStr(coords);
  if (address && address.trim()) return address.trim();
  return null;
}

export function googleMapsLink(address: string | null, coords: Coords | null): string | null {
  const t = target(address, coords);
  return t ? `https://www.google.com/maps/search/?api=1&query=${q(t)}` : null;
}
export function streetViewLink(address: string | null, coords: Coords | null): string | null {
  if (coords) return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${q(coordStr(coords))}`;
  // No coordinates: a Maps search is the safe entry point to Street View.
  return address && address.trim() ? `https://www.google.com/maps/search/?api=1&query=${q(address)}` : null;
}
export function googleEarthLink(address: string | null, coords: Coords | null): string | null {
  if (coords) return `https://earth.google.com/web/@${coords.lat},${coords.lng},500a,1000d`;
  return address && address.trim() ? `https://earth.google.com/web/search/${q(address)}` : null;
}

// ── Static image URL builders (KEY REQUIRED — capture path only) ──────────────
// These embed the API key and are used ONLY server-side inside capturePropertyVisuals.
// They are never returned to the client/report/deep links.

export interface StaticImageOpts { address: string | null; coords: Coords | null; key: string; size?: string }

export function buildStaticMapUrl(o: StaticImageOpts): string {
  const center = o.coords ? coordStr(o.coords) : (o.address ?? '');
  const p = new URLSearchParams({ center, zoom: '18', size: o.size ?? '640x400', maptype: 'satellite', key: o.key });
  return `https://maps.googleapis.com/maps/api/staticmap?${p.toString()}`;
}

/** PURE: compass bearing in degrees (0=N, 90=E) from one lat/lng to another. Used
 *  to AIM the Street View camera at the subject parcel instead of a default
 *  direction (often meaningless pavement). */
export function bearingDegrees(from: Coords, to: Coords): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(from.lat), φ2 = toRad(to.lat);
  const Δλ = toRad(to.lng - from.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Street View metadata endpoint (free, no image quota): returns the actual pano
 *  location so the camera heading can be aimed at the parcel. */
export function buildStreetViewMetadataUrl(o: StaticImageOpts): string {
  const location = o.coords ? coordStr(o.coords) : (o.address ?? '');
  const p = new URLSearchParams({ location, key: o.key });
  return `https://maps.googleapis.com/maps/api/streetview/metadata?${p.toString()}`;
}

export function buildStreetViewUrl(o: StaticImageOpts & { heading?: number; pitch?: number; fov?: number }): string {
  const location = o.coords ? coordStr(o.coords) : (o.address ?? '');
  const p = new URLSearchParams({ location, size: o.size ?? '640x400', key: o.key });
  if (typeof o.heading === 'number' && Number.isFinite(o.heading)) p.set('heading', String(Math.round(o.heading)));
  if (typeof o.pitch === 'number' && Number.isFinite(o.pitch)) p.set('pitch', String(Math.round(o.pitch)));
  if (typeof o.fov === 'number' && Number.isFinite(o.fov)) p.set('fov', String(Math.round(o.fov)));
  return `https://maps.googleapis.com/maps/api/streetview?${p.toString()}`;
}

// ── Pure context builder (NO network, NO key) ────────────────────────────────

export interface VisualContextInput {
  address?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  coords?: Coords | null;
}
export interface BuildVisualContextOpts {
  configured?: boolean;
  now?: () => string;
  /** Captured assets keyed by service (from a prior explicit capture). `url` is a
   *  dashboard-safe fetch URL; `storedPath` is the local file (never sent to the browser). */
  captured?: Partial<Record<VisualService, { storedPath: string; timestamp?: string; url?: string; association?: VisualAssociation | null }>>;
}

/** Compose a full address string for visual lookups (NOT for identity). */
function fullAddress(i: VisualContextInput): string | null {
  const parts = [i.address, i.city, i.state].map((x) => (x ?? '').trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/**
 * Build the Visual Property Context: keyless deep links + per-service image
 * assets (captured when a stored path is supplied, else placeholders). Pure and
 * deterministic — makes NO Google call and embeds NO key. Coordinates/address are
 * used only to frame supporting visuals, never to identify or verify the parcel.
 */
export function buildVisualPropertyContext(i: VisualContextInput, opts: BuildVisualContextOpts = {}): VisualPropertyContext {
  const now = (opts.now ?? (() => new Date().toISOString()))();
  const configured = opts.configured ?? false;
  const addr = fullAddress(i);
  const coords = i.coords ?? null;
  const hasTarget = !!(addr || coords);
  const captured = opts.captured ?? {};

  const asset = (
    service: VisualService,
    imageType: VisualAsset['imageType'],
    apiService: string,
    deepLink: string | null,
    imageCapable: boolean,
  ): VisualAsset => {
    const cap = captured[service];
    const status: VisualAsset['status'] = !hasTarget
      ? 'unavailable'
      : cap
        ? 'captured'
        : imageCapable
          ? 'not_captured'
          : 'unavailable';
    return {
      service, imageType, status,
      storedPath: cap?.storedPath ?? null,
      imageUrl: cap?.url ?? null,
      deepLink,
      provider: 'google',
      apiService,
      sourceAddress: addr,
      sourceCoords: cap?.association?.sourceCoords ?? coords,
      association: cap?.association ?? null,
      timestamp: cap?.timestamp ?? now,
      costRisk: status === 'captured' ? 'one_request' : 'none',
      verificationStatus: VISUAL_NOT_VERIFIED_LABEL,
      note: status === 'captured'
        ? `${apiService} image captured. Context only.`
        : status === 'not_captured'
          ? `${apiService} image not captured yet — run the explicit per-property visual capture. Deep link available now.`
          : 'No address/coordinates available to build this visual.',
    };
  };

  const mapsL = googleMapsLink(addr, coords);
  const svL = streetViewLink(addr, coords);
  const earthL = googleEarthLink(addr, coords);

  return {
    provider: 'google',
    configured,
    label: VISUAL_NOT_VERIFIED_LABEL,
    generatedAt: now,
    source: { address: addr, coords },
    assets: [
      asset('maps_static', 'satellite_static', 'Maps Static API', mapsL, true),
      asset('street_view_static', 'street_view', 'Street View Static API', svL, true),
      asset('map_tiles_terrain', 'terrain', 'Map Tiles / terrain', mapsL, true),
      asset('aerial_3d', 'aerial_3d', 'Aerial / 3D (link)', earthL, false),
    ],
    links: { maps: mapsL, streetView: svL, earth: earthL },
    note: hasTarget
      ? 'Visual context for supporting/deep-dive only. Visual Signal, Not Verified Fact — never used to verify the subject parcel.'
      : 'No address or coordinates available yet — visual context will populate once the parcel has an address or coordinates (still never used for verification).',
  };
}

/** Markdown section for the Discovery Call Report. Pure; renders links + image
 *  references/placeholders. No key, no network. */
export function renderVisualContextMarkdown(ctx: VisualPropertyContext): string {
  const lines: string[] = [];
  lines.push('## Visual Property Context');
  lines.push(`_${ctx.label}. Provider: Google. Generated: ${ctx.generatedAt}._`);
  lines.push('');
  for (const a of ctx.assets) {
    if (a.status === 'captured' && (a.imageUrl || a.storedPath)) {
      lines.push(`- **${a.apiService}** (${a.imageType}): ![${a.imageType}](${a.imageUrl ?? a.storedPath}) — ${a.verificationStatus}.`);
    } else if (a.status === 'not_captured') {
      lines.push(`- **${a.apiService}** (${a.imageType}): _[image placeholder — not captured yet]_${a.deepLink ? ` · [open](${a.deepLink})` : ''} — ${a.verificationStatus}.`);
    } else {
      lines.push(`- **${a.apiService}** (${a.imageType}): _unavailable (no address/coordinates)_.`);
    }
  }
  lines.push('');
  lines.push('**Links:** ' + [
    ctx.links.maps ? `[Google Maps](${ctx.links.maps})` : null,
    ctx.links.streetView ? `[Street View](${ctx.links.streetView})` : null,
    ctx.links.earth ? `[Google Earth / 3D](${ctx.links.earth})` : null,
  ].filter(Boolean).join(' · '));
  return lines.join('\n');
}
