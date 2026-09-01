// A legacy Telegram link or bookmark may still arrive with the master token in
// its query string. It is consumed once, removed from the visible URL before
// any navigation or request, and exchanged through the existing loopback-only
// pairing header for the existing HttpOnly browser-session cookie.
//
// Cross-tab persistence (deliberate, scoped, safe): the dashboard token is ALSO
// mirrored to localStorage, but ONLY on a local dashboard origin (localhost /
// 127.0.0.1 / [::1]), so a fresh local tab stays authenticated without re-adding
// query credential. Hard rules:
//   - Only the dashboard token is persisted. NEVER LandPortal credentials,
//     cookies, CDP data, or any browser-session secret — none of those ever
//     touch the frontend.
//   - The token is never logged and never rendered in the UI.
//   - localStorage is used ONLY on a local origin; on any non-local host we fall
//     back to sessionStorage-only (no cross-session persistence off localhost).
//   - sessionStorage remains the per-tab source of truth and fallback.
//   - clearDashboardToken() wipes it from both stores (logout / clear path).

const TOKEN_KEY = 'claudeclaw.token';
const CHATID_KEY = 'claudeclaw.chatId';

const url = new URL(window.location.href);

/** Cross-tab token persistence is allowed only on a local dashboard origin. */
function isLocalDashboard(): boolean {
  const h = url.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}
const ssGet = (k: string): string => { try { return sessionStorage.getItem(k) || ''; } catch { return ''; } };
const ssSet = (k: string, v: string): void => { try { sessionStorage.setItem(k, v); } catch {} };
const lsGet = (k: string): string => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const lsSet = (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch {} };

let cachedToken = url.searchParams.get('token') || '';
const tokenArrivedInUrl = cachedToken.length > 0;
if (cachedToken) {
  // URL token wins and updates both stores (localStorage local-origin only).
  ssSet(TOKEN_KEY, cachedToken);
  if (isLocalDashboard()) lsSet(TOKEN_KEY, cachedToken);
} else {
  // No URL token: per-tab sessionStorage first, then cross-tab localStorage
  // (local origin only). When hydrated from localStorage, mirror into this tab.
  cachedToken = ssGet(TOKEN_KEY);
  if (!cachedToken && isLocalDashboard()) {
    cachedToken = lsGet(TOKEN_KEY);
    if (cachedToken) ssSet(TOKEN_KEY, cachedToken);
  }
}

if (tokenArrivedInUrl) {
  const clean = new URL(window.location.href);
  clean.searchParams.delete('token');
  window.history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
}

let cachedChatId = url.searchParams.get('chatId') || '';
if (cachedChatId) {
  ssSet(CHATID_KEY, cachedChatId);
} else {
  cachedChatId = ssGet(CHATID_KEY);
}

export const dashboardToken = cachedToken;
export const chatId = cachedChatId;

/** Clear the persisted dashboard token from BOTH stores (logout / clear path).
 *  Touches nothing else; never logs the token. */
export function clearDashboardToken(): void {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
}

/** Same-origin URLs authenticate with the HttpOnly browser-session cookie. */
export function authenticatedUrl(path: string): string { return path; }

let sessionBootstrap: Promise<void> | null = null;
function ensureDashboardSession(): Promise<void> {
  if (sessionBootstrap) return sessionBootstrap;
  if (!cachedToken || !isLocalDashboard()) return Promise.resolve();
  sessionBootstrap = (async () => {
    try {
      const returnTo = window.location.pathname + window.location.search;
      const created = await fetch('/api/dashboard/browser-pairings', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'x-landos-bootstrap-token': cachedToken,
        },
        body: JSON.stringify({ returnTo }),
      });
      if (!created.ok) return;
      const pairing = await created.json() as { pairingUrl?: string };
      const code = pairing.pairingUrl ? new URL(pairing.pairingUrl).hash.slice(1) : '';
      if (!code) return;
      const claimed = await fetch('/api/dashboard/browser-pairings/claim', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (claimed.ok) clearDashboardToken();
    } catch {
      // The ordinary API request below supplies the user-visible 401/connect
      // behavior. Never log the credential or the failed request object.
    }
  })();
  return sessionBootstrap;
}

/** Awaited by API/SSE consumers so direct assets render only after cookie auth. */
export const dashboardSessionReady = ensureDashboardSession();
// A fresh local browser has no dashboard session yet. Take it to the pairing
// screen instead of leaving the current page with a raw API 401.
function redirectUnpairedBrowser(status: number): void {
  if (status !== 401 || window.location.pathname === '/connect') return;
  const returnTo = window.location.pathname + window.location.search;
  const target = new URL('/connect', window.location.origin);
  target.searchParams.set('returnTo', returnTo);
  window.location.replace(target.pathname + target.search);
}

export class ApiError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message);
  }
}

/** The message a prerequisite wait shows. Not an error: LandOS is mid-decision. */
export const WAITING_FOR_SUBJECT_MESSAGE =
  'Waiting for LandOS to confirm the acquisition subject before this tool can run.';

/**
 * True when a failure is the structured `waiting_prerequisite` 409.
 *
 * That response is not a fault — it means the subject is still being confirmed
 * and the tool will run once it is. Every other 409 stays an ordinary error.
 */
export function isWaitingForPrerequisite(caught: unknown): boolean {
  if (!(caught instanceof ApiError) || caught.status !== 409) return false;
  const body = caught.body as { error?: unknown; outcome?: unknown } | null;
  return body?.error === 'waiting_prerequisite' || body?.outcome === 'waiting_prerequisite';
}

/**
 * One operator-facing message for any failed API call.
 *
 * A raw endpoint and `failed: 409` tell an operator nothing they can act on.
 * This is the shared seam every tool call site formats through, so a
 * prerequisite wait reads as a wait everywhere and ordinary failures keep the
 * server's own words.
 */
export function operatorErrorMessage(caught: unknown): string {
  if (isWaitingForPrerequisite(caught)) return WAITING_FOR_SUBJECT_MESSAGE;
  if (caught instanceof ApiError) {
    const body = caught.body as { error?: unknown } | null;
    if (body && typeof body.error === 'string' && body.error.trim()) return body.error;
  }
  // A network-level fetch failure is a transport hiccup, not something the
  // operator can act on as-is.
  if (caught instanceof TypeError) {
    return 'The request did not reach LandOS. Try again; if it keeps happening, check the server.';
  }
  return caught instanceof Error ? caught.message : String(caught);
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  await dashboardSessionReady;
  const res = await fetch(authenticatedUrl(path), { method: 'GET', credentials: 'same-origin' });
  if (!res.ok) {
    redirectUnpairedBrowser(res.status);
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body, `GET ${path} failed: ${res.status}`);
  }
  return res.json();
}

export async function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  await dashboardSessionReady;
  const res = await fetch(authenticatedUrl(path), {
    method: 'POST',
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new ApiError(res.status, errBody, `POST ${path} failed: ${res.status}`);
  }
  return res.json();
}

/** POST browser-native form data while preserving the local dashboard session.
 * The browser supplies the multipart boundary; callers must not set content-type. */
export async function apiPostForm<T = unknown>(path: string, body: FormData): Promise<T> {
  await dashboardSessionReady;
  const res = await fetch(authenticatedUrl(path), { method: 'POST', credentials: 'same-origin', body });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new ApiError(res.status, errBody, `POST ${path} failed: ${res.status}`);
  }
  return res.json();
}

export async function apiPatch<T = unknown>(path: string, body: unknown): Promise<T> {
  await dashboardSessionReady;
  const res = await fetch(authenticatedUrl(path), {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new ApiError(res.status, errBody, `PATCH ${path} failed: ${res.status}`);
  }
  return res.json();
}

export async function apiPut<T = unknown>(path: string, body: unknown): Promise<T> {
  await dashboardSessionReady;
  const res = await fetch(authenticatedUrl(path), {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new ApiError(res.status, errBody, `PUT ${path} failed: ${res.status}`);
  }
  return res.json();
}

export async function apiDelete<T = unknown>(path: string): Promise<T> {
  await dashboardSessionReady;
  const res = await fetch(authenticatedUrl(path), { method: 'DELETE', credentials: 'same-origin' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body, `DELETE ${path} failed: ${res.status}`);
  }
  return res.json();
}

export function tokenizedSseUrl(path: string): string {
  return authenticatedUrl(path);
}

// Vite dev runs on :5173 and proxies /api/* and /warroom/text to the
// backend on :3141. The legacy voice room at /warroom?mode=voice can't
// be proxied (it shares a path prefix with the v2 SPA route), so links
// that go to legacy pages must point at the backend origin in dev.
const BACKEND_ORIGIN = (import.meta as any).env?.DEV ? 'http://localhost:3141' : '';

export function legacyUrl(path: string): string {
  return BACKEND_ORIGIN + path;
}
