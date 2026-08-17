import { useState } from 'preact/hooks';
import { Search, Wrench } from 'lucide-preact';

import { apiPost } from '@/lib/api';

interface ResolutionResult {
  invocationId: string;
  status: 'SUCCEEDED' | 'NEEDS_INPUT' | 'FAILED';
  subjectResolution: 'RESOLVED' | 'AMBIGUOUS' | 'UNRESOLVED' | 'ERROR';
  canonicalSubject: { kind: 'property' | 'research_session'; id: string; temporary: boolean; propertyCardId?: number } | null;
  facts: {
    identityBasis?: string;
    canonicalIdentity?: Record<string, unknown>;
    candidates?: Array<Record<string, unknown>>;
  };
  evidence: Array<{ id?: string; source: string; sourceUrl?: string | null; sourceType?: string | null; retrievedAt: string }>;
  warnings: string[];
  missingInformation: string[];
  execution: { mode: 'reuse' | 'refresh'; reused: boolean; durationMs: number };
}

function value(value: unknown): string {
  if (value == null || value === '') return 'Not established';
  if (Array.isArray(value)) return value.join(', ') || 'Not established';
  return String(value);
}

export function Tools() {
  const [rawInput, setRawInput] = useState('');
  const [result, setResult] = useState<ResolutionResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (refresh = false) => {
    if (!rawInput.trim() || running) return;
    setRunning(true);
    setError(null);
    try {
      const response = await apiPost<{ result: ResolutionResult }>('/api/landos/capabilities/property-resolution/invoke', {
        rawInput: rawInput.trim(),
        entity: 'TY_LAND_BIZ',
        refresh,
      });
      setResult(response.result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(false);
    }
  };

  const identity = result?.facts.canonicalIdentity ?? {};
  return (
    <div class="h-full overflow-y-auto bg-[var(--color-bg)] px-5 py-6 md:px-8" data-testid="tools-page">
      <div class="mx-auto max-w-5xl space-y-5">
        <header>
          <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
            <Wrench size={15} /> Tools
          </div>
          <h1 class="mt-2 text-3xl font-semibold text-[var(--color-text)]">Property Research</h1>
          <p class="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-text-muted)]">
            Resolve a property reference without creating a lead. LandOS keeps the result in a temporary research session unless it matches an existing canonical property.
          </p>
        </header>

        <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5" data-testid="property-resolver-tool">
          <div class="flex items-center gap-2 font-semibold"><Search size={17} /> Property Resolver</div>
          <label class="mt-4 block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]" for="property-resolver-input">
            Raw property reference
          </label>
          <textarea
            id="property-resolver-input"
            data-testid="property-resolver-input"
            value={rawInput}
            onInput={(event) => setRawInput(event.currentTarget.value)}
            rows={5}
            class="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-3 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
            placeholder={'Address, APN, owner + county, coordinates, or a messy reference such as “Map 042 Parcel 123, Fairview, Tennessee”'}
          />
          <div class="mt-3 flex flex-wrap gap-2">
            <button type="button" data-testid="property-resolver-run" disabled={running || !rawInput.trim()} onClick={() => void run(false)} class="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">
              {running ? 'Resolving…' : 'Resolve property'}
            </button>
            {result && <button type="button" disabled={running} onClick={() => void run(true)} class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold disabled:opacity-50">Refresh sources</button>}
          </div>
          {error && <div class="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300" role="alert">{error}</div>}
        </section>

        {result && (
          <section class="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5" data-testid="property-resolver-result">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Resolution result</div>
                <div class="mt-1 text-2xl font-semibold" data-testid="property-resolution-status">{result.subjectResolution.replace('_', ' ')}</div>
              </div>
              <div class="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-text-muted)]">
                {result.execution.reused ? 'Reused persisted result' : `${result.execution.mode} · ${result.execution.durationMs} ms`}
              </div>
            </div>

            <p class="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">{result.facts.identityBasis || 'LandOS did not establish one exact parcel.'}</p>
            <dl class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['Address', identity.address], ['APN / Parcel', identity.apn], ['County', identity.county],
                ['State', identity.state], ['Owner', identity.owner], ['Acres', identity.acres],
                ['FIPS', identity.fips], ['LandPortal property ID', identity.landPortalPropertyId], ['Aliases', identity.parcelNotations],
              ].map(([label, item]) => (
                <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                  <dt class="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</dt>
                  <dd class="mt-1 break-words text-sm">{value(item)}</dd>
                </div>
              ))}
            </dl>

            {result.facts.candidates && result.facts.candidates.length > 0 && (
              <div class="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <div class="font-semibold text-amber-200">Multiple credible candidates remain</div>
                {result.facts.candidates.map((candidate) => <div class="mt-2 text-sm">{value(candidate.apn)} · {value(candidate.county)}, {value(candidate.state)}</div>)}
              </div>
            )}

            {result.missingInformation.length > 0 && <div class="mt-4 text-sm"><b>Needed next:</b> {result.missingInformation.join('; ')}</div>}
            <div class="mt-5">
              <div class="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Evidence and provenance</div>
              {result.evidence.length === 0
                ? <div class="mt-2 text-sm text-[var(--color-text-muted)]">No source established the parcel. The result remains unresolved.</div>
                : <ul class="mt-2 space-y-2">{result.evidence.map((item) => <li class="text-sm"><b>{item.source}</b>{item.sourceType ? ` · ${item.sourceType.replace('_', ' ')}` : ''}<span class="text-[var(--color-text-muted)]"> · {item.retrievedAt}</span></li>)}</ul>}
            </div>
            <div class="mt-4 text-xs text-[var(--color-text-muted)]">Research session: {result.canonicalSubject?.id ?? 'not created'} · Invocation: {result.invocationId}</div>
          </section>
        )}
      </div>
    </div>
  );
}
