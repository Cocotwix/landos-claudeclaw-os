import { useState } from 'preact/hooks';
import { Hammer } from 'lucide-preact';
import { PageHeader } from '@/components/PageHeader';
import { Pill } from '@/components/Pill';
import { apiPost, ApiError } from '@/lib/api';
import { renderMarkdown } from '@/lib/markdown';

// Forge engagement panel. Display-only operator surface over the existing
// POST /api/forge/engagement endpoint (Milestone 3). It sends a raw build
// request, shows the SAFE/STOP verdict, the matched stop categories, and the
// rendered engagement artifact. It NEVER executes anything from the artifact:
// no shell, commits, pushes, deploys, installs, paid APIs, secret reads, or
// account connections. The endpoint only generates a document; this page only
// displays it.

interface ForgeLaneHit {
  category: string;
  label: string;
  matchedText: string;
}

interface ForgeLane {
  verdict: 'SAFE' | 'STOP';
  categories: string[];
  hits: ForgeLaneHit[];
  notice: string;
}

interface ForgeEngagementResponse {
  verdict: 'SAFE' | 'STOP';
  title: string;
  lane: ForgeLane;
  decisionsNeeded: string[];
  markdown: string;
}

export function Forge() {
  const [title, setTitle] = useState('');
  const [request, setRequest] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ForgeEngagementResponse | null>(null);

  async function start() {
    const trimmed = request.trim();
    if (!trimmed) {
      setResult(null);
      setError('Enter a build request first.');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const body: { request: string; title?: string; host: string } = {
        request: trimmed,
        host: 'LandOS Mission Control',
      };
      const t = title.trim();
      if (t) body.title = t;
      const resp = await apiPost<ForgeEngagementResponse>('/api/forge/engagement', body);
      setResult(resp);
    } catch (err) {
      if (err instanceof ApiError) {
        const errorMsg =
          err.body && typeof err.body === 'object' && 'error' in err.body
            ? String((err.body as { error: unknown }).error)
            : err.message;
        setError(`${err.status}: ${errorMsg}`);
      } else {
        setError(err instanceof Error ? err.message : 'Request failed.');
      }
    } finally {
      setLoading(false);
    }
  }

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

          <div class="flex items-center gap-3">
            <button
              type="button"
              onClick={start}
              disabled={loading}
              class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? 'Starting…' : 'Start Forge Engagement'}
            </button>
            {loading && <span class="text-[11px] text-[var(--color-text-muted)]">Classifying request…</span>}
          </div>

          {error && (
            <div class="text-[12px] text-[var(--color-status-failed)] bg-[color-mix(in_srgb,var(--color-status-failed)_12%,transparent)] border border-[color-mix(in_srgb,var(--color-status-failed)_30%,transparent)] rounded-md px-3 py-2">
              {error}
            </div>
          )}
        </section>

        {result && (
          <section class="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 space-y-3">
            <div class="flex items-center gap-2">
              <Pill tone={result.verdict === 'SAFE' ? 'done' : 'failed'}>{result.verdict}</Pill>
              <span class="text-[12.5px] text-[var(--color-text)] font-medium truncate">{result.title}</span>
            </div>
            <p class="text-[11.5px] text-[var(--color-text-muted)] leading-relaxed">{result.lane.notice}</p>

            {result.verdict === 'STOP' && result.lane.hits.length > 0 && (
              <div class="space-y-1.5">
                <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">
                  Tyler-owned stop categories
                </div>
                <div class="flex flex-wrap gap-1.5">
                  {result.lane.hits.map((h) => (
                    <Pill tone="failed">
                      {h.label}: {h.matchedText}
                    </Pill>
                  ))}
                </div>
                {result.decisionsNeeded.length > 0 && (
                  <ul class="list-disc pl-5 text-[11.5px] text-[var(--color-text-muted)] space-y-0.5">
                    {result.decisionsNeeded.map((d) => (
                      <li>{d}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)]">Engagement artifact</div>
            <div
              class="chat-md text-[12.5px] text-[var(--color-text)] leading-relaxed break-words"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(result.markdown) }}
            />
          </section>
        )}
      </div>
    </div>
  );
}
