import { signal } from '@preact/signals';
import { apiGet, apiPost } from '@/lib/api';
import { pushToast } from '@/lib/toasts';
import { applyPendingSpatialContext } from './spatial-platform';
import { applyFreeLayerDefaults } from './free-layer-defaults';

/**
 * God's Eye View host adapter.
 *
 * Owns the whole lifecycle of the vendored upstream app inside the LandOS
 * SPA — no iframe. Design:
 *
 * - The GEV DOM lives in a host-owned `#gev-root` element. On route mount it
 *   is appended into the page; on route unmount it is detached (kept alive)
 *   and the app is SUSPENDED: render loop stopped, every data layer disabled
 *   (which clears their poll timers and stops radio audio), keyboard handlers
 *   gated off, body/document mode classes lifted. After a grace period with
 *   no return, the app is fully DESTROYED (viewer + workers + WebGL context,
 *   recorded listeners/timers, injected stylesheets).
 * - Suspend-instead-of-immediate-destroy exists for exactly one reason: a
 *   quick route bounce must not create a new billable Google 3D Tiles root
 *   tileset session. Refresh or grace-period expiry still tears everything
 *   down for real.
 * - The Google session safeguard: before the root tileset is created the app
 *   asks `/api/gev/usage/session-request`, which atomically counts against
 *   the local monthly limit and refuses at the cap.
 * - Voice is never initialized (enableVoice is not passed): no voice UI, no
 *   microphone permission path, no realtime endpoints (which the server does
 *   not mount anyway).
 */

export type GevPhase = 'idle' | 'loading' | 'ready' | 'suspended' | 'error';

export const gevPhase = signal<GevPhase>('idle');
export const gevGoogleState = signal<'unknown' | 'active' | 'no-key' | 'limit-blocked' | 'failed'>('unknown');

interface GevRuntimeKeyResponse {
  googleMapsBrowserKey: string;
  cesiumIonToken?: string;
}

const DESTROY_GRACE_MS = 5 * 60_000;
const SAVED_LAYERS_KEY = 'landos.gev.savedLayers';
const GEV_BODY_CLASSES = ['cockpit-mode', 'ui-clean-view', 'recording-mode', 'scene-playback-mode'];

type Recorded = {
  listeners: Array<{ target: EventTarget; type: string; fn: EventListenerOrEventListenerObject; opts?: AddEventListenerOptions | boolean }>;
  intervals: number[];
  timeouts: number[];
};

let gevRoot: HTMLDivElement | null = null;
let injectedHeadNodes: HTMLElement[] = [];
let mainModule: typeof import('@gev-upstream/src/main.js') | null = null;
let app: import('@gev-upstream/src/main.js').GevApp | null = null;
let destroyTimer: number | null = null;
let savedBodyClasses: string[] = [];
let recorded: Recorded = { listeners: [], intervals: [], timeouts: [] };
let mounting: Promise<void> | null = null;

declare global {
  interface Window {
    __GEV_HOSTED__?: boolean;
    __GEV_ACTIVE__?: boolean;
    CESIUM_BASE_URL?: string;
  }
}

function injectHeadLink(rel: string, href: string, attrs: Record<string, string> = {}): void {
  const link = document.createElement('link');
  link.rel = rel;
  link.href = href;
  for (const [k, v] of Object.entries(attrs)) link.setAttribute(k, v);
  document.head.appendChild(link);
  injectedHeadNodes.push(link);
}

/**
 * Record-and-guard instrumentation, installed only while the upstream app is
 * initializing. Everything GEV registers on document/window in that window is
 * recorded for teardown; its keyboard handlers are additionally wrapped so
 * they no-op while the route is suspended (LandOS pages keep their hotkeys).
 */
function installRecorder(): () => void {
  const targets: EventTarget[] = [document, window];
  const originals = targets.map((t) => t.addEventListener.bind(t));
  const KEY_EVENTS = new Set(['keydown', 'keyup', 'keypress']);
  targets.forEach((target, i) => {
    const original = originals[i];
    (target as { addEventListener: typeof document.addEventListener }).addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: AddEventListenerOptions | boolean) => {
      let wrapped = fn;
      if (KEY_EVENTS.has(type) && typeof fn === 'function') {
        const inner = fn as EventListener;
        wrapped = ((ev: Event) => {
          if (window.__GEV_ACTIVE__ === false) return;
          inner(ev);
        }) as EventListener;
      }
      recorded.listeners.push({ target, type, fn: wrapped, opts });
      original(type, wrapped, opts);
    }) as typeof document.addEventListener;
  });
  const origSetInterval = window.setInterval.bind(window);
  const origSetTimeout = window.setTimeout.bind(window);
  (window as { setInterval: typeof window.setInterval }).setInterval = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    const id = origSetInterval(fn as never, ms as never, ...(args as never[]));
    recorded.intervals.push(id as unknown as number);
    return id;
  }) as typeof window.setInterval;
  (window as { setTimeout: typeof window.setTimeout }).setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
    const id = origSetTimeout(fn as never, ms as never, ...(args as never[]));
    recorded.timeouts.push(id as unknown as number);
    return id;
  }) as typeof window.setTimeout;
  return () => {
    targets.forEach((target, i) => {
      (target as { addEventListener: typeof document.addEventListener }).addEventListener = originals[i] as typeof document.addEventListener;
    });
    (window as { setInterval: typeof window.setInterval }).setInterval = origSetInterval;
    (window as { setTimeout: typeof window.setTimeout }).setTimeout = origSetTimeout;
  };
}

function clearRecorded(): void {
  for (const { target, type, fn, opts } of recorded.listeners) {
    try { target.removeEventListener(type, fn, opts); } catch { /* best-effort */ }
  }
  for (const id of recorded.intervals) window.clearInterval(id);
  for (const id of recorded.timeouts) window.clearTimeout(id);
  recorded = { listeners: [], intervals: [], timeouts: [] };
}

async function buildDom(container: HTMLElement): Promise<void> {
  const { default: rawHtml } = await import('@gev-upstream/index.html?raw');
  const bodyMatch = rawHtml.match(/<body>([\s\S]*)<\/body>/);
  const bodyHtml = (bodyMatch ? bodyMatch[1] : '')
    .replace(/<script[^>]*src="\/src\/main\.js"[^>]*><\/script>/, '');

  // LandOS serves every page with `Referrer-Policy: no-referrer` (protects the
  // token-in-URL flow). OpenStreetMap's public tile server rejects requests
  // from apps that send no identifying referer (403 "Access blocked" policy
  // tiles). While GEV is mounted, override the DOCUMENT policy to
  // strict-origin-when-cross-origin: cross-origin requests then carry only the
  // bare origin (never a path or query, so the dashboard token still cannot
  // leak), which satisfies OSM's identification requirement. Removed on
  // destroy with the other injected head nodes.
  const referrerMeta = document.createElement('meta');
  referrerMeta.name = 'referrer';
  referrerMeta.content = 'strict-origin-when-cross-origin';
  document.head.appendChild(referrerMeta);
  injectedHeadNodes.push(referrerMeta);

  injectHeadLink('preconnect', 'https://fonts.googleapis.com');
  injectHeadLink('preconnect', 'https://fonts.gstatic.com', { crossorigin: '' });
  injectHeadLink('stylesheet', 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600&display=swap');
  injectHeadLink('stylesheet', 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20,400,0,0');
  injectHeadLink('stylesheet', 'https://fonts.googleapis.com/icon?family=Material+Icons+Round');
  injectHeadLink('stylesheet', '/gev-static/cesium/Widgets/widgets.css');
  injectHeadLink('stylesheet', '/gev-static/style.css');

  gevRoot = document.createElement('div');
  gevRoot.id = 'gev-root';
  gevRoot.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;background:#0a0a0f;';
  gevRoot.innerHTML = bodyHtml;
  container.appendChild(gevRoot);
}

function enabledLayerIds(): string[] {
  const dm = app?.dataManager;
  if (!dm?.layers || !dm.isEnabled) return [];
  return [...dm.layers.keys()].filter((id) => {
    try { return dm.isEnabled!(id as string); } catch { return false; }
  }) as string[];
}

async function requestGoogleSession(): Promise<boolean> {
  try {
    const res = await apiPost<{ allowed: boolean; sessions: number; limit: number }>(
      '/api/gev/usage/session-request', {},
    );
    const pct = res.limit > 0 ? res.sessions / res.limit : 0;
    if (!res.allowed) {
      gevGoogleState.value = 'limit-blocked';
      pushToast({
        tone: 'warn',
        title: 'Google 3D Tiles paused',
        description: `Local safeguard: ${res.sessions}/${res.limit} sessions used this month. Raise the limit in Settings if you accept more usage.`,
        durationMs: 0,
      });
      return false;
    }
    if (pct >= 0.9) {
      pushToast({ tone: 'warn', title: 'Google 3D Tiles: 90% of monthly limit', description: `${res.sessions}/${res.limit} local sessions this month.`, durationMs: 12000 });
    } else if (pct >= 0.75) {
      pushToast({ tone: 'info', title: 'Google 3D Tiles: 75% of monthly limit', description: `${res.sessions}/${res.limit} local sessions this month.`, durationMs: 10000 });
    }
    return true;
  } catch {
    // Counter endpoint unreachable — fail CLOSED (no new billable session).
    gevGoogleState.value = 'limit-blocked';
    pushToast({ tone: 'warn', title: 'Google 3D Tiles paused', description: 'Session safeguard unreachable; not starting a billable session.', durationMs: 8000 });
    return false;
  }
}

/** Mount (or resume) the app into the page container. */
export async function mountGev(container: HTMLElement): Promise<void> {
  if (mounting) await mounting.catch(() => undefined);
  mounting = doMount(container).finally(() => { mounting = null; });
  return mounting;
}

async function doMount(container: HTMLElement): Promise<void> {
  if (destroyTimer !== null) { window.clearTimeout(destroyTimer); destroyTimer = null; }
  document.documentElement.classList.add('gev-active');
  window.__GEV_ACTIVE__ = true;

  if (app && gevRoot) {
    // Resume the suspended instance — same Google session, no re-init.
    container.appendChild(gevRoot);
    const credits = document.getElementById('cesium-credits');
    if (credits) credits.style.display = '';
    for (const cls of savedBodyClasses) document.body.classList.add(cls);
    savedBodyClasses = [];
    if (app.viewer) app.viewer.useDefaultRenderLoop = true;
    const saved = sessionStorage.getItem(SAVED_LAYERS_KEY);
    if (saved && app.dataManager?.restoreEnabledLayerIds) {
      try { await app.dataManager.restoreEnabledLayerIds(JSON.parse(saved) as string[]); } catch { /* best-effort */ }
    }
    sessionStorage.removeItem(SAVED_LAYERS_KEY);
    try { app.requestRender?.('landos-resume'); } catch { /* best-effort */ }
    gevPhase.value = 'ready';
    void applyPendingSpatialContext();
    return;
  }

  gevPhase.value = 'loading';
  try {
    // The full browser key is fetched only here, at GEV mount, from the
    // dedicated runtime endpoint; it is handed straight to the upstream
    // mount and never stored, logged, or rendered by the host.
    let runtimeKey = '';
    let ionToken = '';
    try {
      const res = await apiGet<GevRuntimeKeyResponse>('/api/gev/runtime-key');
      runtimeKey = res.googleMapsBrowserKey || '';
      ionToken = res.cesiumIonToken || '';
    } catch { /* endpoint unreachable → keyless mode */ }

    window.__GEV_HOSTED__ = true;
    window.CESIUM_BASE_URL = '/gev-static/cesium/';

    await buildDom(container);

    const uninstall = installRecorder();
    // Keep the recorder alive briefly past init: the first-run dialog and a
    // few late binders register within ~2s of boot.
    let uninstalled = false;
    const uninstallOnce = (): void => { if (!uninstalled) { uninstalled = true; uninstall(); } };
    window.setTimeout(uninstallOnce, 4000);

    try {
      mainModule = await import('@gev-upstream/src/main.js');
      app = await mainModule.mountGodsEyeView({
        googleMapsKey: runtimeKey || undefined,
        // Free-tier ion token (operator Settings) unlocks the Bing Aerial /
        // Bing Labels / World Terrain stacks the upstream already implements.
        cesiumIonToken: ionToken || undefined,
        // enableGeocoding deliberately NOT passed: Map-Tiles-only key policy.
        beforeGoogleSession: requestGoogleSession,
        onGoogleSessionCreated: () => { gevGoogleState.value = 'active'; },
      });
    } finally {
      // Recorder self-uninstalls on the timer above; nothing else to do here.
    }

    if (!app) throw new Error('God\'s Eye View did not initialize');
    if (!app.host?.googleKeyConfigured) gevGoogleState.value = 'no-key';
    else if (app.host?.googleSessionBlocked) gevGoogleState.value = 'limit-blocked';
    else if (gevGoogleState.value === 'unknown') gevGoogleState.value = 'failed';

    // A prior destroyed instance may have saved the operator's layer set.
    const saved = sessionStorage.getItem(SAVED_LAYERS_KEY);
    if (saved && app.dataManager?.restoreEnabledLayerIds) {
      try { await app.dataManager.restoreEnabledLayerIds(JSON.parse(saved) as string[]); } catch { /* best-effort */ }
      sessionStorage.removeItem(SAVED_LAYERS_KEY);
    }

    gevPhase.value = 'ready';
    void applyPendingSpatialContext();
    // One-time free-layer default migration: pre-upgrade or first-run state
    // gets every eligible keyless layer ON; afterwards the operator's own
    // toggles are authoritative. Runs after 'ready' so it never blocks paint.
    void applyFreeLayerDefaults(app.dataManager);
  } catch (err) {
    console.error('[gev-host] mount failed:', err);
    gevPhase.value = 'error';
    document.documentElement.classList.remove('gev-active');
  }
}

/** Route unmount: suspend now, destroy after the grace period. */
export function releaseGev(): void {
  window.__GEV_ACTIVE__ = false;
  document.documentElement.classList.remove('gev-active');
  if (!app || !gevRoot) {
    if (gevPhase.value !== 'idle') gevPhase.value = 'idle';
    return;
  }

  // Remember + stop the operator's enabled layers (clears their poll timers,
  // stops radio audio, removes entities). The set is restored on resume or on
  // the next fresh mount.
  const ids = enabledLayerIds();
  if (ids.length) sessionStorage.setItem(SAVED_LAYERS_KEY, JSON.stringify(ids));
  try { void app.dataManager?.restoreEnabledLayerIds?.([]); } catch { /* best-effort */ }

  if (app.viewer) app.viewer.useDefaultRenderLoop = false;

  savedBodyClasses = GEV_BODY_CLASSES.filter((c) => document.body.classList.contains(c));
  for (const cls of savedBodyClasses) document.body.classList.remove(cls);

  // Body-appended upstream chrome (Cesium credit line) must not linger on
  // other LandOS pages while the app is suspended.
  const credits = document.getElementById('cesium-credits');
  if (credits) credits.style.display = 'none';

  gevRoot.remove(); // detach, keep alive
  gevPhase.value = 'suspended';

  destroyTimer = window.setTimeout(() => {
    destroyTimer = null;
    void destroyGevNow();
  }, DESTROY_GRACE_MS);
}

/** Full teardown: viewer, workers, listeners, timers, stylesheets. */
export async function destroyGevNow(): Promise<void> {
  if (destroyTimer !== null) { window.clearTimeout(destroyTimer); destroyTimer = null; }
  if (mainModule) {
    try { await mainModule.destroyGodsEyeView(); } catch { /* best-effort */ }
  }
  clearRecorded();
  for (const node of injectedHeadNodes) { try { node.remove(); } catch { /* best-effort */ } }
  injectedHeadNodes = [];
  gevRoot?.remove();
  gevRoot = null;
  app = null;
  savedBodyClasses = [];
  document.documentElement.classList.remove('gev-active');
  GEV_BODY_CLASSES.forEach((c) => document.body.classList.remove(c));
  gevGoogleState.value = 'unknown';
  gevPhase.value = 'idle';
}
