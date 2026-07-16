import { useState, useEffect } from 'preact/hooks';
import { apiGet, apiPost } from '@/lib/api';

// Browser Intelligence + LandPortal readiness. FULLY AUTOMATIC: on mount it
// starts the dedicated LandOS Chrome session (if needed) and signs into
// LandPortal using the configured env credentials — the operator never starts
// the browser or logs in by hand. Shows the granular phase and, on failure, the
// exact technical reason (or the exact missing credential env var names). Never
// shows or asks for credentials/cookies (the backend never returns them).

type Phase =
  | 'not_running' | 'disabled' | 'browser_live' | 'logging_in'
  | 'authenticated' | 'auth_failed' | 'no_credentials' | 'session_unavailable';

interface Readiness {
  phase: Phase;
  sessionStatus: string;
  ready: boolean;
  landportalAuthenticated: boolean | null;
  credentialsConfigured?: boolean;
  missingEnv: string[];
  reason?: string | null;
  note: string;
}

const PHASE_LABEL: Record<Phase, string> = {
  not_running: 'Not running',
  disabled: 'Disabled',
  browser_live: 'Browser live',
  logging_in: 'LandPortal: logging in…',
  authenticated: 'Ready',
  auth_failed: 'Optional source unavailable',
  no_credentials: 'Optional source not connected',
  session_unavailable: 'Browser unavailable',
};
function tone(p: Phase): string {
  if (p === 'authenticated') return 'text-[var(--color-status-done)] border-[var(--color-status-done)]';
  if (p === 'logging_in' || p === 'browser_live') return 'text-[var(--color-accent)] border-[var(--color-accent)]';
  if (p === 'auth_failed' || p === 'no_credentials' || p === 'session_unavailable') return 'text-[var(--color-status-failed)] border-[var(--color-status-failed)]';
  return 'text-[var(--color-text-faint)] border-[var(--color-border)]';
}

export function BrowserIntelControl() {
  const [r, setR] = useState<Readiness | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<Readiness | null> {
    try { const res = await apiGet<{ readiness: Readiness }>('/api/landos/browser/readiness'); setR(res.readiness); return res.readiness; }
    catch (e: any) { setError(e?.message || String(e)); return null; }
  }
  async function ensure() {
    setBusy(true); setError(null);
    setR((prev) => prev ? { ...prev, phase: 'logging_in', note: 'Starting browser and signing into LandPortal…' } : prev);
    try { const res = await apiPost<{ readiness: Readiness }>('/api/landos/browser/ensure-auth', {}); setR(res.readiness); }
    catch (e: any) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  }

  // Status only. An optional Land Portal connection is never automatic.
  useEffect(() => {
    void refresh();
  }, []);

  const phase: Phase = busy ? 'logging_in' : (r?.phase ?? 'not_running');
  const missing = r?.missingEnv ?? [];

  return (
    <details class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
      <summary class="cursor-pointer px-4 py-2.5 flex items-center gap-2 flex-wrap">
        <span class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)]">Browser Intelligence</span>
        <span class={`text-[10px] px-2 py-0.5 rounded-full border ${tone(phase)}`}>{PHASE_LABEL[phase]}</span>
        {r?.landportalAuthenticated === true && <span class="text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-status-done)] text-[var(--color-status-done)]">LandPortal: signed in</span>}
      </summary>
      <div class="px-4 pb-4 space-y-3">
        <div class="text-[11px] text-[var(--color-text-muted)]">{r?.note ?? 'Checking session…'}</div>

        {/* Exact technical reason on failure — never "log in manually". */}
        {phase === 'auth_failed' && r?.reason && (
          <div class="text-[11px] text-[var(--color-status-failed)] border border-[var(--color-status-failed)] rounded-md p-2">Login failed: {r.reason}</div>
        )}
        {phase === 'session_unavailable' && r?.reason && (
          <div class="text-[11px] text-[var(--color-status-failed)] border border-[var(--color-status-failed)] rounded-md p-2">Browser unavailable: {r.reason}</div>
        )}
        {phase === 'no_credentials' && (
          <div class="text-[11px] text-[var(--color-status-failed)] border border-[var(--color-status-failed)] rounded-md p-2">
            Land Portal is not connected. Public county and government research continues without it.
          </div>
        )}

        <div class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
          <Field label="Browser session" value={r?.sessionStatus === 'live' || r?.sessionStatus === 'auth_needed' ? 'connected' : r?.sessionStatus === 'unreachable' ? 'not running' : r?.sessionStatus ?? '—'} />
          <Field label="LandPortal" value={r?.landportalAuthenticated == null ? (phase === 'logging_in' ? 'logging in…' : 'not checked') : r?.landportalAuthenticated ? 'signed in' : 'not signed in'} />
          <Field label="Credentials" value={r?.credentialsConfigured === false ? 'missing' : 'configured'} />
        </div>

        <div class="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => void ensure()} disabled={busy}
            class="px-3 py-1.5 rounded-md text-[12px] font-semibold border border-[var(--color-accent)] bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-40">
            {busy ? 'Working…' : phase === 'authenticated' ? 'Reconnect' : 'Start & sign in'}
          </button>
          <button type="button" onClick={() => void refresh()} disabled={busy}
            class="px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40">
            Refresh status
          </button>
        </div>

        {error && <div class="text-[11px] text-[var(--color-status-failed)] border border-[var(--color-status-failed)] rounded-md p-2">{error}</div>}
        <div class="text-[10px] text-[var(--color-text-faint)]">
          LandOS starts the dedicated LandOS Chrome (not Edge, not your normal tabs) and signs into LandPortal automatically from the configured environment — one session reused across every lead. Read-only: no billing, paid reports, credits, or writes. Credentials and cookies are never stored or shown.
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
