import fs from 'fs';
import path from 'path';
import type { Hono } from 'hono';
import { PROJECT_ROOT } from '../config.js';
import { logger } from '../logger.js';
import {
  getGevConfig,
  setGevConfig,
  getGevUsage,
  requestGevSession,
  maskGevKey,
  GEV_DEFAULT_MONTHLY_SESSION_LIMIT,
} from './config.js';
import { mountGevUpstreamRoutes } from './upstream-bridge.js';
import { getGevProviderStates } from './providers.js';
import { gevGeocode } from './geocode.js';

/**
 * God's Eye View department routes:
 * - /api/gev/config + /api/gev/usage — host configuration and the local
 *   Google 3D Tiles session safeguard (non-secret values only).
 * - /gev-static/* — Cesium runtime assets and upstream static files, served
 *   directly from the vendored tree (nothing is copied into dist/web).
 * - Root-path upstream assets the vendored client references absolutely
 *   (/models/*.glb, a handful of SVGs).
 * - The audited upstream data proxies via the env-isolated bridge.
 *
 * Registered inside buildDashboardApp AFTER the auth middleware, so every
 * /api route inherits the dashboard session gating, and the server keeps its
 * loopback-only bind.
 */

const VENDOR_ROOT = path.join(PROJECT_ROOT, 'vendor', 'gods-eye-view');
const CESIUM_ROOT = path.join(VENDOR_ROOT, 'libs', 'cesium', 'Build', 'Cesium');
const UPSTREAM_ROOT = path.join(VENDOR_ROOT, 'upstream');
const UPSTREAM_PUBLIC = path.join(UPSTREAM_ROOT, 'public');

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.geojson': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.xml': 'application/xml',
  '.woff2': 'font/woff2',
  '.ktx2': 'image/ktx2',
  '.terrain': 'application/octet-stream',
  '.pbf': 'application/octet-stream',
  '.bin': 'application/octet-stream',
};

function serveFrom(root: string, rel: string, cache = 'public, max-age=86400'): Response | null {
  const filePath = path.join(root, rel);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(root) + path.sep) && resolved !== path.resolve(root)) return null;
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
  const ext = path.extname(resolved).toLowerCase();
  const ctype = CONTENT_TYPES[ext] || 'application/octet-stream';
  const data = fs.readFileSync(resolved);
  return new Response(new Uint8Array(data), {
    headers: { 'Content-Type': ctype, 'Cache-Control': cache },
  });
}

/** Root-path upstream public assets the GEV client references absolutely. */
const ROOT_ASSET_ALLOWLIST = new Set([
  'logo.svg', 'mic.svg', 'pin.svg', 'location.svg', 'visual-presets.svg',
]);

export function registerGodsEyeRoutes(app: Hono): void {
  // ---- Config + usage (non-secret) ----
  // The full key never appears in this response: Settings and any other
  // observer see only the masked form. The one consumer of the full value is
  // /api/gev/runtime-key below.
  app.get('/api/gev/config', (c) => {
    const cfg = getGevConfig();
    const usage = getGevUsage();
    return c.json({
      googleMapsBrowserKeyMasked: maskGevKey(cfg.googleMapsBrowserKey),
      googleKeyConfigured: cfg.googleMapsBrowserKey.length > 0,
      cesiumIonTokenMasked: maskGevKey(cfg.cesiumIonToken),
      ionTokenConfigured: cfg.cesiumIonToken.length > 0,
      monthlySessionLimit: cfg.monthlySessionLimit,
      defaultMonthlySessionLimit: GEV_DEFAULT_MONTHLY_SESSION_LIMIT,
      voiceEnabled: false,
      geocodingEnabled: false,
      usage,
      counterDisclaimer: 'Local safeguard only — not Google\'s billing record. Authoritative usage: Google Cloud console → Map Tiles API metrics.',
    });
  });

  // Full key for the mounted God's Eye View module only (it must hand the
  // browser-visible Map Tiles key to Cesium). Same auth domain as every other
  // dashboard route — the protection model is the key's own Google-side
  // restrictions (Map Tiles API + localhost referrers), not secrecy.
  app.get('/api/gev/runtime-key', (c) => {
    const cfg = getGevConfig();
    return c.json({ googleMapsBrowserKey: cfg.googleMapsBrowserKey, cesiumIonToken: cfg.cesiumIonToken });
  });

  // Honest provider matrix: which sources are active, which are free but
  // waiting on a free credential, which are Google-approved, which stay paid
  // and disabled. Key presence only — never values.
  app.get('/api/gev/providers', (c) => {
    return c.json({ providers: getGevProviderStates() });
  });

  // Keyless manual address/place search: LandOS canonical subject first, then
  // the free Nominatim geocoder. No Google, no credentials, honest empties.
  app.get('/api/gev/geocode', async (c) => {
    const query = c.req.query('q') ?? '';
    if (!query.trim()) return c.json({ candidates: [] });
    const result = await gevGeocode(query);
    return c.json(result);
  });

  app.put('/api/gev/config', async (c) => {
    let body: { googleMapsBrowserKey?: unknown; cesiumIonToken?: unknown; monthlySessionLimit?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    // A masked display value round-tripped by a buggy client must never
    // overwrite the stored key. (setGevConfig's shape check also rejects it;
    // this returns the clearer error.)
    if ((typeof body.googleMapsBrowserKey === 'string' && body.googleMapsBrowserKey.includes('•'))
      || (typeof body.cesiumIonToken === 'string' && body.cesiumIonToken.includes('•'))) {
      return c.json({ error: 'That is the masked display value, not a key. Paste the actual key or leave the field empty.' }, 400);
    }
    try {
      const next = setGevConfig(body);
      logger.info('[godseye] config updated (browser key and/or monthly limit)'); // never logs values
      return c.json({ ok: true, googleKeyConfigured: next.googleMapsBrowserKey.length > 0, googleMapsBrowserKeyMasked: maskGevKey(next.googleMapsBrowserKey), ionTokenConfigured: next.cesiumIonToken.length > 0, cesiumIonTokenMasked: maskGevKey(next.cesiumIonToken), monthlySessionLimit: next.monthlySessionLimit });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Invalid config' }, 400);
    }
  });

  app.get('/api/gev/usage', (c) => {
    const cfg = getGevConfig();
    const usage = getGevUsage();
    return c.json({
      ...usage,
      limit: cfg.monthlySessionLimit,
      remaining: Math.max(0, cfg.monthlySessionLimit - usage.sessions),
    });
  });

  // Atomic gate + count for one Google root-tileset session.
  app.post('/api/gev/usage/session-request', (c) => {
    const result = requestGevSession();
    if (!result.allowed) {
      logger.warn({ sessions: result.sessions, limit: result.limit },
        '[godseye] Google 3D Tiles session refused by local monthly safeguard');
    }
    return c.json(result);
  });

  // ---- Static: Cesium runtime + upstream style/public, served from vendor ----
  app.get('/gev-static/cesium/*', (c) => {
    const rel = decodeURIComponent(new URL(c.req.url).pathname.replace('/gev-static/cesium/', ''));
    const res = serveFrom(CESIUM_ROOT, rel, 'public, max-age=604800, immutable');
    return res ?? c.text('', 404);
  });

  app.get('/gev-static/style.css', () => {
    return serveFrom(UPSTREAM_ROOT, 'style.css', 'no-cache') ?? new Response('', { status: 404 });
  });

  app.get('/gev-static/public/*', (c) => {
    const rel = decodeURIComponent(new URL(c.req.url).pathname.replace('/gev-static/public/', ''));
    const res = serveFrom(UPSTREAM_PUBLIC, rel);
    return res ?? c.text('', 404);
  });

  // Root-path assets referenced absolutely by upstream code/CSS.
  // Plain wildcard + handler-side extension check: Hono's param-regex
  // alternation (`{.+\\.(glb|gltf)}`) never matched, so every aircraft model
  // 404'd — latent until the flights layer actually defaulted ON.
  app.get('/models/*', (c, next) => {
    const rel = decodeURIComponent(new URL(c.req.url).pathname.replace('/models/', ''));
    if (!/\.(glb|gltf)$/i.test(rel)) return next();
    const res = serveFrom(path.join(UPSTREAM_PUBLIC, 'models'), rel);
    return res ?? c.text('', 404);
  });
  app.get('/:file{[a-z-]+\\.svg}', (c, next) => {
    const file = c.req.param('file');
    if (!ROOT_ASSET_ALLOWLIST.has(file)) return next();
    const res = serveFrom(UPSTREAM_PUBLIC, file);
    return res ?? c.text('', 404);
  });

  // ---- Audited upstream data proxies (synchronous dispatcher registration;
  // the route table finishes harvesting in the background) ----
  mountGevUpstreamRoutes(app);
}
