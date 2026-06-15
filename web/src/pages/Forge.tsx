import { useEffect, useState } from 'preact/hooks';
import { Hammer, Copy, RefreshCw } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { Pill } from '@/components/Pill';
import { apiGet, apiPost, apiPatch, ApiError } from '@/lib/api';
import { renderMarkdown } from '@/lib/markdown';

// Forge engagement panel. Display-only operator surface over the Forge host
// endpoints (engagement generate, save/list/get/patch, review packet, command
// plan). It NEVER executes anything from an artifact, review packet, or command
// plan: no shell, commits, pushes, deploys, installs, paid APIs, secret reads,
// or account connections. Everything here generates, saves, or displays text.

const FORGE_STATUSES = [
  'draft',
  'planned',
  'in_progress',
  'needs_review',
  'ready_to_push',
  'pushed',
  'blocked',
] as const;
type ForgeStatus = (typeof FORGE_STATUSES)[number];

interface ForgeHit {
  category: string;
  label: string;
  matchedText: string;
}

interface StoredEngagement {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  rawRequest: string;
  host: string;
  verdict: 'SAFE' | 'STOP';
  categories: string[];
  hits: ForgeHit[];
  notice: string;
  decisionsNeeded: string[];
  markdown: string;
  status: ForgeStatus;
  notes: string;
  source: string;
}

// A unified view model for either a fresh (unsaved) preview or a loaded record.
interface ForgeView {
  id?: string;
  title: string;
  verdict: 'SAFE' | 'STOP';
  categories: string[];
  hits: ForgeHit[];
  notice: string;
  decisionsNeeded: string[];
  markdown: string;
  status?: ForgeStatus;
}

interface GenerateResponse {
  verdict: 'SAFE' | 'STOP';
  title: string;
  lane: { categories: string[]; hits: ForgeHit[]; notice: string };
  decisionsNeeded: string[];
  markdown: string;
}

function storedToView(s: StoredEngagement): ForgeView {
  return {
    id: s.id,
    title: s.title,
    verdict: s.verdict,
    categories: s.categories,
    hits: s.hits,
    notice: s.notice,
    decisionsNeeded: s.decisionsNeeded,
    markdown: s.markdown,
    status: s.status,
  };
}

function errMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const msg =
      err.body && typeof err.body === 'object' && 'error' in err.body
        ? String((err.body as { error: unknown }).error)
        : err.message;
    return `${err.status}: ${msg}`;
  }
  return err instanceof Error ? err.message : 'Request failed.';
}

export function Forge() {
  const [title, setTitle] = useState('');
  const [request, setRequest] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<ForgeView | null>(null);
  const [history, setHistory] = useState<StoredEngagement[]>([]);
  const [output, setOutput] = useState<{ kind: string; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function loadHistory() {
    try {
      const res = await apiGet<{ engagements: StoredEngagement[] }>('/api/forge/engagements');
      setHistory(res.engagements);
    } catch {
      /* history is best-effort; don't block the page on it */
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function generate() {
    const trimmed = request.trim();
    if (!trimmed) {
      setCurrent(null);
      setOutput(null);
      setError('Enter a build request first.');
      return;
    }
    setLoading(true);
    setError(null);
    setOutput(null);
    try {
      const body: { request: string; title?: string; host: string } = {
        request: trimmed,
        host: 'LandOS Mission Control',
      };
      const t = title.trim();
      if (t) body.title = t;
      const resp = await apiPost<GenerateResponse>('/api/forge/engagement', body);
      setCurrent({
        title: resp.title,
        verdict: resp.verdict,
        categories: resp.lane.categories,
        hits: resp.lane.hits,
        notice: resp.lane.notice,
        decisionsNeeded: resp.decisionsNeeded,
        markdown: resp.markdown,
      });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function saveCurrent() {
    const trimmed = request.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const body: { request: string; title?: string; host: string } = {
        request: trimmed,
        host: 'LandOS Mission Control',
      };
      const t = title.trim();
      if (t) body.title = t;
      const resp = await apiPost<{ engagement: StoredEngagement }>('/api/forge/engagements', body);
      setCurrent(storedToView(resp.engagement));
      await loadHistory();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function reopen(s: StoredEngagement) {
    setCurrent(storedToView(s));
    setOutput(null);
    setError(null);
  }

  async function changeStatus(status: ForgeStatus) {
    if (!current?.id) return;
    setBusy(true);
    try {
      const resp = await apiPatch<{ engagement: StoredEngagement }>(
        `/api/forge/engagements/${current.id}`,
        { status },
      );
      setCurrent(storedToView(resp.engagement));
      await loadHistory();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked; the text is still shown for manual copy */
    }
  }

  async function reviewPacket() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      const text = current.id
        ? (await apiPost<{ packet: string }>(`/api/forge/engagements/${current.id}/review-packet`, {})).packet
        : (
            await apiPost<{ packet: string }>('/api/forge/review-packet', {
              title: current.title,
              verdict: current.verdict,
            })
          ).packet;
      setOutput({ kind: 'Codex review packet', text });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function commandPlan() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await apiPost<{ plan: string }>('/api/forge/command-plan', {
        title: current.title,
        verdict: current.verdict,
        categories: current.categories,
      });
      setOutput({ kind: 'Command plan', text: resp.plan });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const btn =
    'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const btnAccent = `${btn} bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]`;
  const btnGhost = `${btn} bg-[var(--color-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]`;

  return (
    <div class="h-full flex flex-col">
      <PageHeader title="Forge" breadcrumb="Workspace" />
      <div class="flex-1 overflow-y-auto p-6 space-y-5 max-w-3xl">
        <section class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 space-y-3">
          <div class="flex items-center gap-2">
            <Hammer size={14} class="text-[var(--color-accent)]" />
            <h3 class="text-[13px] font-semibold text-[var(--color-text)]">Forge Engagement</h3>
          </div>
          <p class="text-[11.5px] text-[var(--color-text-muted)] leading-relaxed">
            Describe a build in plain words. Forge classifies it SAFE or STOP and returns a structured engagement
            artifact. Display only: nothing here runs, commits, pushes, installs, or touches secrets.
          </p>

          <label class="block">
            <span class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Title (optional)</span>
            <input
              type="text"
              value={title}
              onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
              placeholder="Short label"
              class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-3 py-2 text-[12.5px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
            />
          </label>

          <label class="block">
            <span class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Build request</span>
            <textarea
              value={request}
              onInput={(e) => setRequest((e.target as HTMLTextAreaElement).value)}
              placeholder="e.g. Add a date helper to src/utils with a unit test"
              rows={5}
              class="mt-1 w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-3 py-2 text-[12.5px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] resize-y font-mono"
            />
          </label>

          <div class="flex flex-wrap items-center gap-2">
            <button type="button" onClick={generate} disabled={loading || busy} class={btnAccent}>
              {loading ? 'Starting…' : 'Start Forge Engagement'}
            </button>
            <button type="button" onClick={saveCurrent} disabled={loading || busy || !request.trim()} class={btnGhost}>
              Save to history
            </button>
            {(loading || busy) && <span class="text-[11px] text-[var(--color-text-muted)]">Working…</span>}
          </div>

          {error && (
            <div class="text-[12px] text-[var(--color-status-failed)] bg-[color-mix(in_srgb,var(--color-status-failed)_12%,transparent)] border border-[color-mix(in_srgb,var(--color-status-failed)_30%,transparent)] rounded-md px-3 py-2">
              {error}
            </div>
          )}
        </section>

        {current && (
          <section class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 space-y-3">
            <div class="flex items-center gap-2 flex-wrap">
              <Pill tone={current.verdict === 'SAFE' ? 'done' : 'failed'}>{current.verdict}</Pill>
              <span class="text-[12.5px] text-[var(--color-text)] font-medium truncate">{current.title}</span>
              {current.id ? (
                <span class="text-[10px] text-[var(--color-text-faint)]">saved · {current.id}</span>
              ) : (
                <span class="text-[10px] text-[var(--color-text-faint)]">unsaved preview</span>
              )}
            </div>
            <p class="text-[11.5px] text-[var(--color-text-muted)] leading-relaxed">{current.notice}</p>

            {current.verdict === 'STOP' && current.hits.length > 0 && (
              <div class="space-y-1.5">
                <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">
                  Tyler-owned stop categories
                </div>
                <div class="flex flex-wrap gap-1.5">
                  {current.hits.map((h) => (
                    <Pill tone="failed">
                      {h.label}: {h.matchedText}
                    </Pill>
                  ))}
                </div>
                {current.decisionsNeeded.length > 0 && (
                  <ul class="list-disc pl-5 text-[11.5px] text-[var(--color-text-muted)] space-y-0.5">
                    {current.decisionsNeeded.map((d) => (
                      <li>{d}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div class="flex flex-wrap items-center gap-2 pt-1">
              {current.id && (
                <label class="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                  Status
                  <select
                    value={current.status}
                    disabled={busy}
                    onChange={(e) => changeStatus((e.target as HTMLSelectElement).value as ForgeStatus)}
                    class="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[11.5px] text-[var(--color-text)]"
                  >
                    {FORGE_STATUSES.map((s) => (
                      <option value={s}>{s}</option>
                    ))}
                  </select>
                </label>
              )}
              <button type="button" onClick={reviewPacket} disabled={busy} class={btnGhost}>
                Codex review packet
              </button>
              <button type="button" onClick={commandPlan} disabled={busy} class={btnGhost}>
                Command plan
              </button>
            </div>

            <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Engagement artifact</div>
            <div
              class="chat-md text-[12.5px] text-[var(--color-text)] leading-relaxed break-words"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(current.markdown) }}
            />
          </section>
        )}

        {output && (
          <section class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">{output.kind}</span>
              <button type="button" onClick={() => copyText(output.text)} class={btnGhost}>
                <Copy size={12} /> {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre class="text-[11.5px] text-[var(--color-text)] whitespace-pre-wrap break-words font-mono bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md p-3 max-h-96 overflow-y-auto">
              {output.text}
            </pre>
            <p class="text-[10.5px] text-[var(--color-text-faint)]">
              Copy this text and run it yourself. Forge never executes review packets or command plans.
            </p>
          </section>
        )}

        <section class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-[13px] font-semibold text-[var(--color-text)]">History</h3>
            <button type="button" onClick={loadHistory} class={btnGhost} aria-label="Refresh history">
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
          {history.length === 0 ? (
            <p class="text-[11.5px] text-[var(--color-text-muted)]">No saved engagements yet.</p>
          ) : (
            <ul class="divide-y divide-[var(--color-border)]">
              {history.map((h) => (
                <li>
                  <button
                    type="button"
                    onClick={() => reopen(h)}
                    class="w-full text-left py-2 flex items-center gap-2 hover:bg-[var(--color-elevated)] rounded-md px-1.5 transition-colors"
                  >
                    <Pill tone={h.verdict === 'SAFE' ? 'done' : 'failed'}>{h.verdict}</Pill>
                    <span class="flex-1 min-w-0 text-[12.5px] text-[var(--color-text)] truncate">{h.title}</span>
                    <span class="text-[10px] text-[var(--color-text-faint)]">{h.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
