import { useEffect, useState } from 'preact/hooks';
import { Bot, Play, ShieldCheck, ScrollText, MapPin, Compass } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { PageState } from '@/components/PageState';
import { apiGet, apiPost } from '@/lib/api';

// ── Types (mirror the Browser Agent API) ────────────────────────────────
type RunStatus = 'not_configured' | 'configured' | 'running' | 'succeeded' | 'failed' | 'awaiting_authentication';

interface AgentRun {
  agentRunId: string; playbookId: string; playbookLabel: string; provider: string; status: RunStatus;
  scopeVisited: string[]; sourcePage: string; rowsCaptured: number; rowsAccepted: number; rowsFlagged: number;
  rowsUnknown: number; rowsRejected: number; reviewQueued: number; durationMs: number; screenshots: string[]; note: string; createdAt: number;
}
interface PlaybookInfo {
  id: string; label: string; provider: string; allowedScope: string[]; description: string;
  configured: boolean; status: RunStatus; lastRun: AgentRun | null;
  acreageBands: Array<{ band: string; uiLabel: string | null; supported: boolean }>;
  pageState: { status: string; data: string; time: string; acreage: string };
}
interface AgentSummary {
  employee: { id: string; name: string; role: string };
  liveVisualNavigation: string; liveVisualNote: string;
  playbooks: PlaybookInfo[];
  totals: { runs: number; lastRunAt: number | null };
  recentRuns: AgentRun[];
}
interface NavCapability { how: string | null; via: string[] }
interface NavModel {
  platform: string; version: number; classification: string;
  searchFunctions: string[]; searchModes: string[]; supportedIdentifiers: string[];
  requiredSelectors: string[]; mandatoryFields: string[]; fieldOrder: string[];
  resultAccess: NavCapability; detailAccess: NavCapability; tabs: string[]; filters: string[];
  layers: string[]; mapTools: string[]; documentAccess: NavCapability; exportAccess: NavCapability;
  navigationDependencies: string[]; successSignals: string[]; failureSignals: string[];
  authRequired: boolean; timesReused: number; updatedAt: number;
}
interface NavModelsResponse { navigationModels: NavModel[]; taskPlaybooks: Array<{ platform: string; taskType: string; version: number; timesReused: number; updatedAt: number }> }
interface DataQuality { total: number; accepted: number; flagged: number; unknown: number; rejected: number; samples: { flagged: Array<{ label?: string; reasons: string[] }>; rejected: Array<{ label?: string; reasons: string[] }>; unknown: Array<{ label?: string; reasons: string[] }> } }
interface Diagnostics { rowsByLevel: { state: number; county: number; zip: number }; duplicatesDropped: number; headersVerified: boolean; countiesExpanded: number; retries: number; stageMs?: Record<string, number>; notes: string[] }
interface RunResult { run: AgentRun; allowedScope: string[]; note: string; diagnostics: Diagnostics | null; dataQuality: DataQuality | null; ingest: { accepted: number; rejected: number } | null; coverage: { snapshotCount: number; countyWithDataCount: number; flaggedSnapshotCount?: number } }

const STATUS_LABEL: Record<RunStatus, string> = {
  not_configured: 'Not Configured', configured: 'Configured', running: 'Running',
  succeeded: 'Succeeded', failed: 'Failed', awaiting_authentication: 'Awaiting Authentication',
};
const STATUS_TONE: Record<RunStatus, string> = {
  succeeded: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
  configured: 'text-sky-400 border-sky-500/40 bg-sky-500/10',
  running: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
  awaiting_authentication: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
  failed: 'text-red-400 border-red-500/40 bg-red-500/10',
  not_configured: 'text-[var(--color-text-muted)] border-[var(--color-border)] bg-[var(--color-elevated)]',
};

function StatusChip({ status }: { status: RunStatus }) {
  return <span class={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}
function fmtWhen(ts: number | null): string {
  if (!ts) return 'never';
  return new Date(ts * 1000).toLocaleString();
}

export function BrowserAgent() {
  const [summary, setSummary] = useState<AgentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<RunResult | null>(null);
  const [state, setState] = useState('GA');
  const [navModels, setNavModels] = useState<NavModel[]>([]);

  async function load() {
    try { setLoading(true); setError(null); setSummary(await apiGet<AgentSummary>('/api/landos/browser-agent/status')); }
    catch (e: any) { setError(e?.message || String(e)); } finally { setLoading(false); }
  }
  async function loadNav() {
    try { const r = await apiGet<NavModelsResponse>('/api/landos/browser/navigation-models'); setNavModels(r.navigationModels || []); }
    catch { /* non-fatal; navigation panel is informational */ }
  }
  useEffect(() => { void load(); void loadNav(); }, []);

  async function runPlaybook(id: string, mode: 'operational' | 'live') {
    setBusy(`${id}:${mode}`);
    try {
      const res = await apiPost<RunResult>(`/api/landos/browser-agent/playbooks/${id}/run`, { state: state.trim().toUpperCase() || 'GA', mode });
      setLastResult(res);
      await load();
    } catch (e: any) { setError(e?.message || String(e)); } finally { setBusy(null); }
  }

  const pb = summary?.playbooks[0];

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title="Browser Agent"
        actions={summary && (
          <span class="text-[11px] text-[var(--color-text-muted)] tabular-nums">
            {summary.totals.runs} run{summary.totals.runs === 1 ? '' : 's'} · last {fmtWhen(summary.totals.lastRunAt)}
          </span>
        )}
      />

      {loading && !summary && <PageState loading />}
      {error && <PageState error={error} />}

      {summary && (
        <div class="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Employee identity */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <div class="flex items-start gap-3">
              <div class="mt-0.5 text-[var(--color-text-muted)]"><Bot size={18} /></div>
              <div class="flex-1">
                <div class="flex items-center gap-2">
                  <span class="text-[14px] font-semibold text-[var(--color-text)]">{summary.employee.name}</span>
                  <span class="text-[11px] text-[var(--color-text-muted)]">· Browser Agent</span>
                </div>
                <p class="mt-1 text-[12px] text-[var(--color-text-muted)] leading-relaxed">{summary.employee.role}. Owns browser automation and executes Browser Playbooks. It never owns a business domain — departments delegate browser collection here.</p>
                <div class="mt-2 flex items-center gap-2 text-[11px] text-amber-400/90">
                  <ShieldCheck size={12} /> Live research session: {summary.liveVisualNavigation.replace('_', ' ')}
                </div>
              </div>
            </div>
          </div>

          {/* Playbook #1 */}
          {pb && (
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="flex items-center gap-2">
                    <MapPin size={14} class="text-[var(--color-text-muted)]" />
                    <span class="text-[13px] font-semibold text-[var(--color-text)]">Browser Playbook #1 · {pb.label}</span>
                    <StatusChip status={pb.status} />
                  </div>
                  <p class="mt-1 text-[12px] text-[var(--color-text-muted)] leading-relaxed max-w-3xl">{pb.description}</p>
                </div>
              </div>

              {/* Page state + allowed scope */}
              <div class="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                <Cell k="Status" v={pb.pageState.status} />
                <Cell k="Data" v={pb.pageState.data} />
                <Cell k="Time" v={pb.pageState.time} />
                <Cell k="Acreage" v={pb.pageState.acreage} />
              </div>
              <div class="mt-2 text-[11px] text-[var(--color-text-muted)]">
                Allowed scope: {pb.allowedScope.map((s) => <span class="inline-block mx-0.5 px-1.5 py-0.5 rounded bg-[var(--color-elevated)] border border-[var(--color-border)]">{s}</span>)}
              </div>

              {/* Acreage band roadmap */}
              <div class="mt-2 text-[11px] text-[var(--color-text-muted)]">
                Acreage bands: {pb.acreageBands.map((b) => (
                  <span class={`inline-block mx-0.5 px-1.5 py-0.5 rounded border ${b.supported ? 'text-emerald-400 border-emerald-500/40' : 'opacity-60 border-[var(--color-border)]'}`}>{b.band}{b.supported ? '' : ' (soon)'}</span>
                ))}
              </div>

              {/* Last-run data-quality fields */}
              <div class="mt-3 grid grid-cols-3 md:grid-cols-6 gap-2">
                <Metric k="Captured" v={pb.lastRun?.rowsCaptured ?? '—'} />
                <Metric k="Accepted" v={pb.lastRun?.rowsAccepted ?? '—'} />
                <Metric k="Flagged" v={pb.lastRun?.rowsFlagged ?? '—'} />
                <Metric k="Unknown" v={pb.lastRun?.rowsUnknown ?? '—'} />
                <Metric k="Rejected" v={pb.lastRun?.rowsRejected ?? '—'} />
                <Metric k="Last Run" v={pb.lastRun ? `${(pb.lastRun.durationMs / 1000).toFixed(1)}s` : 'never'} />
              </div>

              {/* Controls */}
              <div class="mt-3 flex items-center gap-2 flex-wrap">
                <label class="text-[11px] text-[var(--color-text-muted)]">State</label>
                <input value={state} onInput={(e) => setState((e.target as HTMLInputElement).value)}
                  class="w-16 px-2 py-1 rounded-md text-[12px] bg-[var(--color-elevated)] border border-[var(--color-border)] uppercase" />
                <button type="button" disabled={!!busy} onClick={() => runPlaybook(pb.id, 'operational')}
                  class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40">
                  <Play size={12} /> {busy === `${pb.id}:operational` ? 'Running…' : 'Run playbook'}
                </button>
                <button type="button" disabled={!!busy} onClick={() => runPlaybook(pb.id, 'live')}
                  class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)] disabled:opacity-40">
                  <Play size={12} /> {busy === `${pb.id}:live` ? 'Trying…' : 'Try live session'}
                </button>
              </div>

              {lastResult && (
                <div class="mt-3 rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] p-3 text-[12px] space-y-2">
                  <div class="flex items-center gap-2"><StatusChip status={lastResult.run.status} /><span class="text-[var(--color-text-muted)]">{lastResult.run.agentRunId}</span></div>
                  <p class="text-[var(--color-text)] leading-relaxed">{lastResult.note}</p>
                  {lastResult.dataQuality && (
                    <div>
                      <div class="text-[11px] font-medium text-[var(--color-text)] mb-1">Data quality: {lastResult.dataQuality.accepted} accepted · {lastResult.dataQuality.flagged} flagged · {lastResult.dataQuality.unknown} unknown · {lastResult.dataQuality.rejected} rejected</div>
                      {lastResult.dataQuality.samples.flagged.slice(0, 3).map((s) => <div class="text-[11px] text-amber-400/90">⚑ {s.label}: {s.reasons[0]}</div>)}
                      {lastResult.dataQuality.samples.rejected.slice(0, 3).map((s) => <div class="text-[11px] text-red-400/90">✕ {s.label ?? 'record'}: {s.reasons[0]}</div>)}
                    </div>
                  )}
                  {lastResult.diagnostics && (
                    <div class="text-[11px] text-[var(--color-text-muted)]">
                      Rows: {lastResult.diagnostics.rowsByLevel.state} state / {lastResult.diagnostics.rowsByLevel.county} county / {lastResult.diagnostics.rowsByLevel.zip} zip ·
                      headers {lastResult.diagnostics.headersVerified ? '✓ verified' : '✕ mismatch'} · {lastResult.diagnostics.duplicatesDropped} dupes · {lastResult.diagnostics.retries} retries
                      {lastResult.diagnostics.notes.length > 0 && <div class="mt-0.5">{lastResult.diagnostics.notes.join(' · ')}</div>}
                    </div>
                  )}
                  {lastResult.ingest && <p class="text-[var(--color-text-muted)]">Market Matrix now {lastResult.coverage.snapshotCount} snapshots across {lastResult.coverage.countyWithDataCount} counties{typeof lastResult.coverage.flaggedSnapshotCount === 'number' ? `, ${lastResult.coverage.flaggedSnapshotCount} flagged` : ''}.</p>}
                </div>
              )}
            </div>
          )}

          {/* Learned site navigation models — reusable across every department */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <div class="flex items-center gap-2 mb-1"><Compass size={14} class="text-[var(--color-text-muted)]" /><span class="text-[12px] font-semibold text-[var(--color-text)]">Learned site navigation</span></div>
            <p class="text-[11px] text-[var(--color-text-muted)] mb-2 max-w-3xl">How each website is navigated (not its data). Learned once, reused by every department. Grows and relearns automatically as sites change.</p>
            {navModels.length === 0 && <p class="text-[12px] text-[var(--color-text-muted)]">No sites learned yet. Navigation models are captured automatically when Browser Intelligence inspects a site.</p>}
            <div class="space-y-2">
              {navModels.map((m) => (
                <details class="rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] p-2.5">
                  <summary class="cursor-pointer flex items-center gap-2 text-[12px] text-[var(--color-text)]">
                    <span class="font-medium">{m.platform}</span>
                    <span class="text-[10px] px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)]">v{m.version}</span>
                    <span class="text-[10px] text-[var(--color-text-muted)]">{m.classification}</span>
                    {m.authRequired && <span class="text-[10px] text-amber-400/90">auth</span>}
                    <span class="ml-auto text-[10px] text-[var(--color-text-muted)] tabular-nums">reused {m.timesReused}× · {fmtWhen(m.updatedAt)}</span>
                  </summary>
                  <div class="mt-2 grid md:grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                    <NavRow k="Search modes" v={m.searchModes.join(', ')} />
                    <NavRow k="Identifiers" v={m.supportedIdentifiers.join(', ')} />
                    <NavRow k="Required selectors" v={m.requiredSelectors.join(' → ')} />
                    <NavRow k="Field order" v={m.fieldOrder.join(' → ')} />
                    <NavRow k="Open result" v={m.resultAccess.how} />
                    <NavRow k="Reach detail" v={m.detailAccess.how} />
                    <NavRow k="Tabs" v={m.tabs.join(', ')} />
                    <NavRow k="Filters" v={m.filters.join(', ')} />
                    <NavRow k="Layers / overlays" v={m.layers.join(', ')} />
                    <NavRow k="Map tools" v={m.mapTools.join(', ')} />
                    <NavRow k="Documents" v={m.documentAccess.via.join(', ') || m.documentAccess.how} />
                    <NavRow k="Exports" v={m.exportAccess.via.join(', ') || m.exportAccess.how} />
                  </div>
                  {m.navigationDependencies.length > 0 && (
                    <div class="mt-2 text-[11px] text-[var(--color-text-muted)]">
                      <div class="text-[10px] uppercase tracking-wide mb-0.5">Dependencies</div>
                      {m.navigationDependencies.map((d) => <div>• {d}</div>)}
                    </div>
                  )}
                  <div class="mt-2 grid md:grid-cols-2 gap-x-4 text-[11px]">
                    <div><div class="text-[10px] uppercase tracking-wide text-emerald-400/80 mb-0.5">Success signals</div>{m.successSignals.map((s) => <div class="text-[var(--color-text-muted)]">✓ {s}</div>)}</div>
                    <div><div class="text-[10px] uppercase tracking-wide text-red-400/80 mb-0.5">Failure signals</div>{m.failureSignals.map((s) => <div class="text-[var(--color-text-muted)]">✕ {s}</div>)}</div>
                  </div>
                </details>
              ))}
            </div>
          </div>

          {/* Recent runs */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
            <div class="flex items-center gap-2 mb-2"><ScrollText size={14} class="text-[var(--color-text-muted)]" /><span class="text-[12px] font-semibold text-[var(--color-text)]">Run log</span></div>
            {summary.recentRuns.length === 0 && <p class="text-[12px] text-[var(--color-text-muted)]">No runs yet. Run the playbook above.</p>}
            {summary.recentRuns.length > 0 && (
              <table class="w-full text-[11px]">
                <thead class="text-[var(--color-text-muted)] text-left">
                  <tr><th class="py-1 font-medium">When</th><th class="font-medium">Playbook</th><th class="font-medium">Status</th><th class="font-medium text-right">Captured</th><th class="font-medium text-right">Accepted</th><th class="font-medium text-right">Flagged</th><th class="font-medium text-right">Unknown</th><th class="font-medium text-right">Rejected</th></tr>
                </thead>
                <tbody>
                  {summary.recentRuns.map((r) => (
                    <tr class="border-t border-[var(--color-border)]">
                      <td class="py-1 tabular-nums text-[var(--color-text-muted)]">{fmtWhen(r.createdAt)}</td>
                      <td class="text-[var(--color-text)]">{r.playbookLabel}</td>
                      <td><StatusChip status={r.status} /></td>
                      <td class="text-right tabular-nums">{r.rowsCaptured}</td>
                      <td class="text-right tabular-nums">{r.rowsAccepted}</td>
                      <td class="text-right tabular-nums text-amber-400/90">{r.rowsFlagged}</td>
                      <td class="text-right tabular-nums">{r.rowsUnknown}</td>
                      <td class="text-right tabular-nums text-red-400/90">{r.rowsRejected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div class="rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] px-2 py-1.5">
      <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">{k}</div>
      <div class="text-[12px] text-[var(--color-text)] font-medium">{v}</div>
    </div>
  );
}
function NavRow({ k, v }: { k: string; v: string | null }) {
  return (
    <div class="flex gap-1.5">
      <span class="text-[var(--color-text-muted)] shrink-0">{k}:</span>
      <span class="text-[var(--color-text)]">{v || '—'}</span>
    </div>
  );
}
function Metric({ k, v }: { k: string; v: string | number }) {
  return (
    <div class="rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] px-2 py-1.5">
      <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">{k}</div>
      <div class="text-[13px] text-[var(--color-text)] font-semibold tabular-nums">{v}</div>
    </div>
  );
}
