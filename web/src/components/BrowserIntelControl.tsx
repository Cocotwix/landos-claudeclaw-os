import { useState, useEffect } from 'preact/hooks';
import { apiGet, apiPost } from '@/lib/api';

// Browser Intelligence operator control. Start / connect the persistent Google
// Chrome session, open LandPortal for a one-time manual login, and refresh
// status — without remembering PowerShell commands. Read-only; never shows
// cookies/tokens (the backend never returns them).

interface SessionHealth {
  healthy: boolean;
  status: 'live' | 'disabled' | 'unreachable' | 'auth_needed';
  cdpUrl: string;
  connectedAtIso: string | null;
  lastCheckIso: string | null;
  screenshotDir: string;
  landportalAuthenticated: boolean | null;
  landportalAuthCheckedIso: string | null;
  note: string;
}
interface StartResult { status: string; launched: boolean; reused: boolean; chromePath: string | null; profileDir: string; error: string | null; health: SessionHealth }

const STATUS_LABEL: Record<SessionHealth['status'], string> = {
  live: 'Connected', disabled: 'Disabled', unreachable: 'Not running', auth_needed: 'Login needed',
};
function tone(s: SessionHealth['status']): string {
  if (s === 'live') return 'text-[var(--color-status-done)] border-[var(--color-status-done)]';
  if (s === 'auth_needed') return 'text-[var(--color-accent)] border-[var(--color-accent)]';
  if (s === 'unreachable') return 'text-[var(--color-status-failed)] border-[var(--color-status-failed)]';
  return 'text-[var(--color-text-faint)] border-[var(--color-border)]';
}
function timeShort(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString(); } catch { return '—'; }
}

export function BrowserIntelControl() {
  const [health, setHealth] = useState<SessionHealth | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setBusy('refresh'); setError(null);
    try { const r = await apiGet<{ session: SessionHealth }>('/api/landos/browser/session'); setHealth(r.session); }
    catch (e: any) { setError(e?.message || String(e)); }
    finally { setBusy(null); }
  }
  async function start() {
    setBusy('start'); setError(null); setMsg(null);
    try {
      const r = await apiPost<{ start: StartResult }>('/api/landos/browser/start', {});
      setHealth(r.start.health);
      if (r.start.error) setError(r.start.error);
      else setMsg(r.start.reused ? 'Reused the running Chrome session.' : r.start.launched ? `Launched Chrome (${r.start.chromePath}).` : 'Connected.');
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setBusy(null); }
  }
  async function openLandPortal() {
    setBusy('open'); setError(null); setMsg(null);
    try {
      const r = await apiPost<{ landportal: { authenticated: boolean; note: string; health: SessionHealth } }>('/api/landos/browser/open-landportal', {});
      setHealth(r.landportal.health);
      setMsg(r.landportal.note);
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setBusy(null); }
  }

  useEffect(() => { void refresh(); }, []);

  const status = health?.status ?? 'disabled';
  const connected = status === 'live' || status === 'auth_needed';

  return (
    <details class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
      <summary class="cursor-pointer px-4 py-2.5 flex items-center gap-2 flex-wrap">
        <span class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Browser Intelligence</span>
        <span class={`text-[10px] px-2 py-0.5 rounded-full border ${tone(status)}`}>{STATUS_LABEL[status]}</span>
        {health?.landportalAuthenticated === true && <span class="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-status-done)] text-[var(--color-status-done)]">LandPortal: signed in</span>}
        {health?.landportalAuthenticated === false && <span class="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-accent)] text-[var(--color-accent)]">LandPortal: login needed</span>}
      </summary>
      <div class="px-4 pb-4 space-y-3">
        <div class="text-[11px] text-[var(--color-text-muted)]">{health?.note ?? 'Checking session…'}</div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1">
          <Field label="Browser Intelligence" value={STATUS_LABEL[status]} />
          <Field label="Chrome session" value={status === 'live' || status === 'auth_needed' ? `connected (${health?.cdpUrl})` : status === 'unreachable' ? 'not running' : 'disabled'} />
          <Field label="LandPortal login" value={health?.landportalAuthenticated == null ? 'not checked' : health.landportalAuthenticated ? 'signed in' : 'login needed'} />
          <Field label="Last health check" value={timeShort(health?.lastCheckIso ?? null)} />
        </div>
        {health?.screenshotDir && <div class="text-[10px] text-[var(--color-text-faint)] break-all">Screenshots: {health.screenshotDir}</div>}

        <div class="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => void start()} disabled={!!busy}
            class="px-3 py-1.5 rounded-md text-[12px] font-semibold border border-[var(--color-accent)] bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-40">
            {busy === 'start' ? 'Starting…' : connected ? 'Reconnect' : 'Start Browser Intelligence'}
          </button>
          <button type="button" onClick={() => void refresh()} disabled={!!busy}
            class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40">
            {busy === 'refresh' ? 'Refreshing…' : 'Refresh status'}
          </button>
          {connected && (
            <button type="button" onClick={() => void openLandPortal()} disabled={!!busy}
              class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40">
              {busy === 'open' ? 'Opening…' : 'Open LandPortal'}
            </button>
          )}
        </div>

        {msg && <div class="text-[11px] text-[var(--color-text-muted)]">{msg}</div>}
        {error && <div class="text-[11px] text-[var(--color-status-failed)] border border-[var(--color-status-failed)] rounded-md p-2">{error}</div>}
        <div class="text-[10px] text-[var(--color-text-faint)]">
          Uses Google Chrome with the dedicated LandOS profile (not Edge), reused across every lead — one login, no relogin per property. Read-only: no billing, paid reports, credits, settings, or writes. Credentials/cookies are never stored or shown.
        </div>
      </div>
    </details>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div class="min-w-0">
      <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">{label}</div>
      <div class="text-[12px] text-[var(--color-text)] truncate">{value || '—'}</div>
    </div>
  );
}
