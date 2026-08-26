import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import type { Hono, Context } from 'hono';
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
import { PROJECT_ROOT } from '../config.js';
import { logger } from '../logger.js';

/**
 * God's Eye View upstream middleware bridge.
 *
 * The vendored upstream keeps its entire data-proxy backend as Connect
 * middlewares registered by Vite plugins inside `vite.config.js`. Rather than
 * rewriting ~7,000 audited lines, this bridge imports the (patched) config
 * factory — whose `vite` import is shimmed to a closed, env-isolated local
 * module — harvests every `server.middlewares.use(route, handler)`
 * registration through a fake server object, filters the result through an
 * explicit security allowlist, and mounts the surviving handlers on the
 * LandOS Hono app at the same `/api/*` paths the GEV client calls.
 *
 * Security posture (see docs/landos/GODS_EYE_VIEW_SECURITY_AUDIT.md):
 * - EXCLUDED_ROUTE_PREFIXES: the OpenAI and Google server endpoints are never
 *   mounted, so no LandOS environment credential (OPENAI_API_KEY,
 *   GOOGLE_MAPS_API_KEY, ...) can ever be spent by this module.
 * - KEY_GUARDS: metered endpoints that would activate on an env key are
 *   refused if such a key unexpectedly exists in the LandOS environment —
 *   keyless honest 503 states are the supported mode.
 * - Everything mounts behind the existing dashboard auth middleware
 *   (session cookie / token) and the server's loopback bind.
 */

type ConnectHandler = (req: unknown, res: unknown, next?: () => void) => unknown;

interface HarvestedRoute {
  route: string;
  handler: ConnectHandler;
  plugin: string;
}

const EXCLUDED_ROUTE_PREFIXES = [
  '/api/realtime', // OpenAI Realtime token broker + voice debug log (voice disabled)
  '/api/openai',   // OpenAI HUD summary (paid)
  '/api/google',   // Google Places / Text Search (paid, server-key pattern)
];

/**
 * Route prefix -> env var that would make it SPEND MONEY if present.
 *
 * Only genuinely metered providers belong here (2026-08 provider-completion
 * doctrine): TomTom bills per tile beyond its trial. Free-key providers —
 * NASA FIRMS (FIRMS_MAP_KEY), AISStream (AISSTREAM_API_KEY), and OpenSky
 * credentials — are deliberately NOT guarded: their keys are free-tier, the
 * routes are wired and mount keyless with honest 503/KEY-REQUIRED states,
 * and they activate the moment the operator configures the free credential.
 */
const KEY_GUARDS: Array<{ prefix: string; env: string }> = [
  { prefix: '/api/tomtom', env: 'TOMTOM_API_KEY' },
];

let harvestPromise: Promise<HarvestedRoute[]> | null = null;

async function harvestUpstreamRoutes(): Promise<HarvestedRoute[]> {
  const cfgPath = path.join(PROJECT_ROOT, 'vendor', 'gods-eye-view', 'upstream', 'vite.config.js');
  if (!fs.existsSync(cfgPath)) {
    logger.warn('[godseye] vendored upstream vite.config.js not found; GEV data proxies unavailable');
    return [];
  }
  const mod = await import(pathToFileURL(cfgPath).href) as { default: unknown };
  const factory = mod.default;
  const config = typeof factory === 'function'
    ? (factory as (env: { mode: string; command: string }) => Record<string, unknown>)({ mode: 'production', command: 'serve' })
    : factory as Record<string, unknown>;

  const routes: HarvestedRoute[] = [];
  let currentPlugin = 'unknown';
  const noop = (): void => undefined;
  const fakeServer = {
    middlewares: {
      use: (a: unknown, b?: unknown) => {
        if (typeof a === 'string' && typeof b === 'function') {
          routes.push({ route: a, handler: b as ConnectHandler, plugin: currentPlugin });
        } else if (typeof a === 'function') {
          // Path-less global middleware: upstream does not use this today; a
          // future upstream change adding one must be reviewed, not mounted.
          logger.warn({ plugin: currentPlugin }, '[godseye] upstream registered a path-less middleware; skipped');
        }
      },
    },
    httpServer: { once: noop, on: noop, off: noop },
    watcher: { on: noop, off: noop },
    ws: { on: noop, off: noop, send: noop },
    config: { logger: { info: noop, warn: noop, error: noop } },
  };

  const plugins = Array.isArray((config as { plugins?: unknown[] }).plugins)
    ? (config as { plugins: unknown[] }).plugins
    : [];
  for (const plugin of plugins) {
    const p = plugin as { name?: string; configureServer?: unknown } | null;
    if (!p || typeof p !== 'object') continue;
    currentPlugin = p.name || 'unnamed';
    const hook = p.configureServer as ((server: unknown) => unknown) | { handler?: (server: unknown) => unknown } | undefined;
    const fn = typeof hook === 'function' ? hook : hook?.handler;
    if (typeof fn !== 'function') continue;
    try {
      const post = await fn.call(p, fakeServer);
      if (typeof post === 'function') post();
    } catch (err) {
      logger.warn({ plugin: currentPlugin, err: err instanceof Error ? err.message : String(err) },
        '[godseye] upstream plugin failed to register; its layer will degrade honestly');
    }
  }
  return routes;
}

function filterRoutes(routes: HarvestedRoute[]): HarvestedRoute[] {
  return routes.filter(({ route }) => {
    if (EXCLUDED_ROUTE_PREFIXES.some((p) => route.startsWith(p))) {
      logger.info({ route }, '[godseye] route excluded by security allowlist');
      return false;
    }
    const guard = KEY_GUARDS.find((g) => route.startsWith(g.prefix) && process.env[g.env]);
    if (guard) {
      logger.warn({ route, env: guard.env },
        '[godseye] metered route NOT mounted: a key with this name exists in the host environment and GEV must not spend it');
      return false;
    }
    return true;
  });
}

/**
 * Mount the allowlisted upstream data proxies on the Hono app.
 *
 * The registration itself is SYNCHRONOUS — one `/api/*` dispatcher middleware
 * added while the dashboard app is still being built. (Adding concrete routes
 * later from an async continuation would lose to the SPA catch-all, which is
 * registered first and wins Hono's in-order dispatch — and would throw
 * "matcher is already built" once a request has been served.) The dispatcher
 * consults the async-harvested route table, longest-prefix-matches the GEV
 * routes, and falls through to `next()` for every other /api path, so all
 * LandOS routes (registered earlier, matched earlier) are untouched.
 *
 * Must be called after the dashboard auth middleware so every proxied route
 * inherits the session gating.
 */
export function mountGevUpstreamRoutes(app: Hono): void {
  if (!harvestPromise) {
    harvestPromise = harvestUpstreamRoutes().then(filterRoutes).catch((err) => {
      logger.error({ err: err instanceof Error ? err.message : String(err) },
        '[godseye] upstream middleware harvest failed; GEV data proxies unavailable');
      return [] as HarvestedRoute[];
    });
    void harvestPromise.then((routes) => {
      logger.info({ mounted: routes.length }, '[godseye] upstream data proxies available');
    });
  }

  app.use('/api/*', async (c: Context, next) => {
    const routes = await harvestPromise!;
    const path = new URL(c.req.url).pathname;
    // Longest-prefix match so /api/opensky-track is not captured by /api/opensky.
    let best: HarvestedRoute | null = null;
    for (const r of routes) {
      if (path === r.route || path.startsWith(`${r.route}/`)) {
        if (!best || r.route.length > best.route.length) best = r;
      }
    }
    if (!best) return next();

    const env = c.env as { incoming?: { url?: string; method?: string }; outgoing?: { headersSent?: boolean; statusCode?: number; setHeader?: (k: string, v: string) => void; end?: (b?: string) => void } };
    const incoming = env.incoming;
    const outgoing = env.outgoing;
    if (!incoming || !outgoing) return c.json({ error: 'Not available' }, 503);
    const url = new URL(c.req.url);
    // Reproduce Connect mount-prefix stripping: handlers parse req.url as
    // the sub-path below their mount point.
    incoming.url = (url.pathname.slice(best.route.length) || '/') + url.search;
    const handler = best.handler;
    const finish = (status: number, body: string): void => {
      if (outgoing.headersSent) return;
      outgoing.statusCode = status;
      outgoing.setHeader?.('Content-Type', 'application/json');
      outgoing.end?.(body);
    };
    try {
      const result = handler(incoming, outgoing, () => finish(404, JSON.stringify({ error: 'not found' })));
      Promise.resolve(result).catch(() => finish(500, JSON.stringify({ error: 'proxy failure' })));
    } catch {
      finish(500, JSON.stringify({ error: 'proxy failure' }));
    }
    // The upstream handler owns the raw response (may stream); tell Hono
    // the response is already being sent.
    return RESPONSE_ALREADY_SENT;
  });
}
