// Token + chatId come from the URL query string (set by the Telegram deep link
// or a saved bookmark). sessionStorage keeps a tab working across navigations.
//
// Cross-tab persistence (deliberate, scoped, safe): the dashboard token is ALSO
// mirrored to localStorage, but ONLY on a local dashboard origin (localhost /
// 127.0.0.1 / [::1]), so a fresh local tab stays authenticated without re-adding
// ?token=. Hard rules:
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

function withToken(path: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}token=${encodeURIComponent(dashboardToken)}`;
}

export class ApiError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message);
  }
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(withToken(path), { method: 'GET' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body, `GET ${path} failed: ${res.status}`);
  }
  return res.json();
}

export async function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(withToken(path), {
    method: 'POST',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new ApiError(res.status, errBody, `POST ${path} failed: ${res.status}`);
  }
  return res.json();
}

export async function apiPatch<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(withToken(path), {
    method: 'PATCH',
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
  const res = await fetch(withToken(path), {
    method: 'PUT',
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
  const res = await fetch(withToken(path), { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body, `DELETE ${path} failed: ${res.status}`);
  }
  return res.json();
}

export function tokenizedSseUrl(path: string): string {
  return withToken(path);
}

// Vite dev runs on :5173 and proxies /api/* and /warroom/text to the
// backend on :3141. The legacy voice room at /warroom?mode=voice can't
// be proxied (it shares a path prefix with the v2 SPA route), so links
// that go to legacy pages must point at the backend origin in dev.
const BACKEND_ORIGIN = (import.meta as any).env?.DEV ? 'http://localhost:3141' : '';

export function legacyUrl(path: string): string {
  return BACKEND_ORIGIN + path;
}
