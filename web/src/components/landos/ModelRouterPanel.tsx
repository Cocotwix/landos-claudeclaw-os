import { useEffect, useState } from 'preact/hooks';
import { apiGet, apiPost } from '@/lib/api';
import { PageState } from '@/components/PageState';

// Read-only model-router visibility: safe-mode flag, provider presence (booleans
// only — no secrets), and the Execution Environment -> Provider -> Model tree with
// live status. Override controls are exposed via the API (/model-router/override).

interface ProviderStatus { installed: boolean; configured: boolean; reachable: boolean; healthy: boolean; enabled: boolean; authStatus: string }
interface ProviderNode {
  descriptor: { id: string; kind: string; label: string; execution: string; servesModels: string[] };
  status: ProviderStatus;
  models: Array<{ modelId: string; runtime: string | null; openSource: boolean | null }>;
}
interface EnvNode { environment: { id: string; label: string; kind: string; execution: string }; providers: ProviderNode[] }
interface RouterStatus {
  liveRouting: boolean;
  liveRoutingSource?: string;
  safeMode: boolean;
  highStakesDefault: string;
  providerPresence: Record<string, boolean>;
  ollamaHostConfigured?: boolean;
  ollamaHostSource?: string;
  environments: EnvNode[];
  helpers?: Array<{ id: string; label: string }>;
}

function dot(ok: boolean) {
  return <span class={ok ? 'text-[var(--color-status-done)]' : 'text-[var(--color-text-faint)]'}>{ok ? '●' : '○'}</span>;
}

export function ModelRouterPanel() {
  const [s, setS] = useState<RouterStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const r = await apiGet<RouterStatus>('/api/landos/model-router/status');
    setS(r);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try { const r = await apiGet<RouterStatus>('/api/landos/model-router/status'); if (alive) setS(r); }
      catch (e: any) { if (alive) setError(e?.message || String(e)); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  async function toggleLive() {
    if (!s) return;
    setBusy(true);
    try { await apiPost('/api/landos/model-router/live-routing', { enabled: !s.liveRouting }); await refresh(); }
    catch (e: any) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  }

  if (error) return <PageState error={error} />;
  if (loading && !s) return <PageState loading />;
  if (!s) return null;

  return (
    <div class="flex-1 overflow-y-auto px-6 py-4 space-y-6">
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <div class="flex items-center gap-3">
          <div class="flex-1">
            <div class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">Model Router</div>
            <div class="text-[14px] font-semibold mt-0.5">
              {s.liveRouting ? 'Live multi-provider routing: ON' : 'Safe mode (Claude-only): ON'}
            </div>
            <div class="text-[11px] text-[var(--color-text-muted)] mt-1">
              High-stakes default: <span class="font-mono">{s.highStakesDefault}</span> · low-risk grunt-work routes to the best available model when live routing is enabled.
              {s.liveRoutingSource && <span class="text-[var(--color-text-faint)]"> · source: {s.liveRoutingSource}</span>}
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={toggleLive}
            class="shrink-0 px-3 py-1.5 rounded-md text-[12px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40"
          >
            {s.liveRouting ? 'Switch to Safe Mode' : 'Enable Live Routing'}
          </button>
        </div>
        <div class="text-[10px] text-[var(--color-text-faint)] mt-2">
          Ollama host: {s.ollamaHostConfigured ? `configured (${s.ollamaHostSource})` : 'not configured'} — set it via POST /api/landos/model-router/ollama-host. High-stakes always stays on Claude regardless of this toggle.
        </div>
      </div>

      <div>
        <h2 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">Provider presence</h2>
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
          {Object.entries(s.providerPresence).map(([k, v]) => (
            <span key={k}>{dot(v)} {k}</span>
          ))}
        </div>
      </div>

      {s.helpers && s.helpers.length > 0 && (
        <div>
          <h2 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">
            Router-enabled helpers <span class="text-[10px] normal-case">(draft output{s.liveRouting ? '' : ' — deterministic in safe mode'})</span>
          </h2>
          <div class="flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
            {s.helpers.map((h) => <span key={h.id}>{dot(s.liveRouting)} {h.label}</span>)}
          </div>
        </div>
      )}

      {s.environments.map((env) => (
        <div key={env.environment.id}>
          <h2 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">
            {env.environment.label} <span class="text-[10px] text-[var(--color-text-faint)]">({env.environment.execution})</span>
          </h2>
          <div class="space-y-2">
            {env.providers.map((p) => (
              <div key={p.descriptor.id} class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
                <div class="flex items-center gap-2 flex-wrap text-[12px]">
                  <span class="font-medium">{p.descriptor.label}</span>
                  <span class="ml-auto text-[10px] text-[var(--color-text-faint)] flex gap-2">
                    <span>{dot(p.status.installed)} installed</span>
                    <span>{dot(p.status.configured)} configured</span>
                    <span>{dot(p.status.healthy)} healthy</span>
                    <span>{dot(p.status.enabled)} enabled</span>
                  </span>
                </div>
                <div class="text-[10px] text-[var(--color-text-faint)] mt-1">
                  models: {p.models.map((m) => `${m.modelId}${m.openSource ? ' (open)' : ''}`).join(', ')} · auth: {p.status.authStatus}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
