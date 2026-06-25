import { useEffect, useState } from 'preact/hooks';
import { apiGet } from '@/lib/api';
import { PageState } from '@/components/PageState';

// LandOS Knowledge & Data view — read-only operator visibility into the
// knowledge layer backend (local-fs vs R2) and the data-provider config. All
// presence-only: r2.missing names env KEY NAMES, never values; provider
// `configured` is a boolean. No secret value is ever fetched or shown. The
// County Scorecard is business intelligence (never a Deal Card output) and shows
// metrics as unavailable until a market data source is connected.

interface ParcelProvider { id: string; label: string; configured: boolean; active: boolean }
interface KnowledgeStatus {
  knowledgeStore: {
    selected: 'local-fs' | 'r2';
    pref: 'auto' | 'r2' | 'local';
    reason: string;
    r2: { configured: boolean; missing: string[]; endpoint: string | null };
  };
  dataProviders: { config: Record<string, string | undefined>; parcelProviders: ParcelProvider[]; realieEnvKey: string };
}

interface ScorecardEntry { county: string; state: string; score: number | null }
interface ScorecardResponse { backend: string; scorecard: { version: number; counties: ScorecardEntry[]; updatedAt: string } }

function pill(ok: boolean, okText: string, noText: string) {
  return (
    <span
      class={`text-[10px] px-1.5 py-0.5 rounded-full border ${
        ok
          ? 'text-[var(--color-status-done)] border-[var(--color-status-done)]'
          : 'text-[var(--color-text-faint)] border-[var(--color-border)]'
      }`}
    >
      {ok ? okText : noText}
    </span>
  );
}

export function KnowledgePanel() {
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [scorecard, setScorecard] = useState<ScorecardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, sc] = await Promise.all([
          apiGet<KnowledgeStatus>('/api/landos/knowledge/status'),
          apiGet<ScorecardResponse>('/api/landos/market/scorecard'),
        ]);
        if (alive) { setStatus(s); setScorecard(sc); }
      } catch (err: any) {
        if (alive) setError(err?.message || String(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (error) return <PageState error={error} />;
  if (loading && !status) return <PageState loading />;
  if (!status) return null;

  const ks = status.knowledgeStore;

  return (
    <div class="flex-1 overflow-y-auto px-6 py-4 space-y-6">
      {/* Knowledge store backend */}
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
        <div class="flex items-center gap-2">
          <span class="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">Knowledge Store</span>
          <span class="text-[13px] font-semibold ml-1">{ks.selected}</span>
          {pill(ks.r2.configured, 'R2 configured', 'R2 not configured')}
          <span class="ml-auto text-[10px] font-mono text-[var(--color-text-faint)]">pref: {ks.pref}</span>
        </div>
        <div class="text-[11px] text-[var(--color-text-muted)] mt-2">{ks.reason}</div>
        {ks.r2.endpoint && <div class="text-[10px] font-mono text-[var(--color-text-faint)] mt-1">endpoint: {ks.r2.endpoint}</div>}
        {ks.r2.missing.length > 0 && (
          <div class="text-[10px] text-[var(--color-text-faint)] mt-1">missing env keys: {ks.r2.missing.join(', ')}</div>
        )}
      </div>

      {/* Data providers */}
      <div>
        <h2 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">Data Providers (parcel)</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          {status.dataProviders.parcelProviders.map((p) => (
            <div key={p.id} class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-[13px] font-medium">{p.label}</span>
                <span class="text-[10px] font-mono text-[var(--color-text-faint)]">{p.id}</span>
                {p.active && <span class="text-[10px] px-1.5 py-0.5 rounded-full border text-[var(--color-accent)] border-[var(--color-accent)]">active</span>}
                <span class="ml-auto">{pill(p.configured, 'configured', 'not configured')}</span>
              </div>
            </div>
          ))}
        </div>
        <div class="text-[10px] text-[var(--color-text-faint)] mt-2">
          Provider swap is config-driven (no agent/workflow change). Realie.ai goes live when {status.dataProviders.realieEnvKey} is set; until then it fails loud and never fabricates a parcel.
        </div>
      </div>

      {/* County Scorecard (business intelligence, not a Deal Card output) */}
      <div>
        <h2 class="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] mb-2">
          County Scorecard <span class="text-[10px] normal-case text-[var(--color-text-faint)]">· {scorecard?.backend}</span>
        </h2>
        {!scorecard || scorecard.scorecard.counties.length === 0 ? (
          <div class="text-[12px] text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-lg p-4">
            No counties scored yet. Metrics are unavailable until a market-data source is connected — never fabricated.
          </div>
        ) : (
          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {scorecard.scorecard.counties.map((co) => (
              <div key={`${co.county}-${co.state}`} class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3">
                <div class="text-[12px] font-medium">{co.county}, {co.state}</div>
                <div class="text-xl font-semibold tabular-nums mt-1">{co.score == null ? '—' : co.score}</div>
                <div class="text-[10px] text-[var(--color-text-faint)] mt-1">composite (available metrics only)</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
