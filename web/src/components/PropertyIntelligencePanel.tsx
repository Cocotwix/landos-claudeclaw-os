// Property Intelligence — the operator read.
//
// One launch control, live specialist progress, and the joined snapshot split
// across the Deal Card tabs it belongs to. Every surface here reads the SAME
// snapshot, so two tabs can never tell different stories.
//
// Honesty rules enforced in this component:
//   • A section with no data says so plainly; it never renders as "complete".
//   • A failed or skipped specialist is always visible, with its category.
//   • A stale failure disappears the moment a newer run produces a snapshot.
//   • No value is shown when the snapshot says the property is not priceable.

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { apiGet, apiPost, dashboardToken } from '../lib/api';

/** Same-origin API asset URLs need the dashboard token appended for <img>/<a>. */
function tokenized(url: string | null): string | null {
  if (!url) return null;
  if (!url.startsWith('/api/')) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${encodeURIComponent(dashboardToken)}`;
}

// ── View types (mirror src/landos/property-intelligence-snapshot.ts) ─────────

export type EvidenceGradeView =
  | 'confirmed_fact'
  | 'likely_indication'
  | 'unresolved_question'
  | 'unavailable_public_record'
  | 'post_contract_verification';

export interface PiFact {
  key: string;
  label: string;
  value: string | null;
  grade: EvidenceGradeView;
  source: string | null;
  sourceUrl: string | null;
  retrievedAt: string | null;
  note: string | null;
}

export interface PiDueDiligenceItem {
  key: string;
  label: string;
  verdict: 'good' | 'caution' | 'risk' | 'unknown';
  headline: string;
  grade: EvidenceGradeView;
  detail: string | null;
  sourceUrl: string | null;
  missing: string[];
}

export interface PiComp {
  key: string;
  address: string | null;
  lane: 'sold' | 'active';
  source: string;
  sourceUrl: string | null;
  status: string;
  dateIso: string | null;
  price: number | null;
  acres: number | null;
  pricePerAcre: number | null;
  distanceMiles: number | null;
  whyUseful: string;
  similarities: string[];
  differences: string[];
}

export interface PiSnapshot {
  snapshotVersion: number;
  dealCardId: number;
  runId: string;
  sequence: number;
  isPrimary: boolean;
  status: 'running' | 'complete' | 'complete_with_gaps' | 'blocked_identity' | 'failed';
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  identity: {
    state: 'confirmed' | 'provisional' | 'conflicted' | 'unresolved';
    normalizedAddress: string | null;
    county: string | null;
    state_: string | null;
    apn: string | null;
    apnVariants: string[];
    owner: string | null;
    ownerMailing: string | null;
    situs: string | null;
    acres: number | null;
    acreageBasis: string | null;
    coordinates: { lat: number; lng: number } | null;
    hasParcelGeometry: boolean;
    sourceConfidence: 'high' | 'medium' | 'low' | 'none';
    conflicts: string[];
    explanation: string;
  };
  facts: PiFact[];
  governmentRecords: PiFact[];
  dueDiligence: PiDueDiligenceItem[];
  comps: {
    policyExplanation: string;
    landPortalUsable: boolean;
    landPortalRowsSeen?: number;
    caps: { zillow: number; redfin: number };
    sold: PiComp[];
    active: PiComp[];
    landHomeOnly: PiComp[];
    rejected: Array<{ address: string | null; source: string; price: number | null; reason: string }>;
    duplicatesMerged: number;
    summaryLine: string;
  };
  valuation: {
    priceable: boolean;
    range: { low: number; high: number } | null;
    pricePerAcreRange: { low: number; high: number } | null;
    likelyRetail: { low: number; high: number } | null;
    dispositionRange: { low: number; high: number } | null;
    basis: string;
    adjustments: string[];
    confidence: 'high' | 'medium' | 'low' | 'none';
    uncertainty: string[];
    materialGaps: string[];
    notPriceableReason: string | null;
    nextActionToPrice: string | null;
  };
  strategies: Array<{
    strategy: string;
    applicability: 'applicable' | 'conditional' | 'blocked' | 'not_applicable';
    supportingFacts: string[];
    blockers: string[];
    effort: string;
    timeline: string;
    valueCreationPath: string;
    risk: string;
    nextVerificationStep: string;
  }>;
  recommendation: {
    preferredStrategy: string | null;
    why: string;
    whatWouldChangeIt: string[];
    posture: 'pursue' | 'hold' | 'renegotiate' | 'reject' | 'undetermined';
    postureWhy: string;
  };
  evidence: Array<{
    id: string;
    kind: 'screenshot' | 'document' | 'map' | 'overlay' | 'source_link' | 'record';
    label: string;
    sourceType: string;
    sourceUrl: string | null;
    viewUrl: string | null;
    retrievedAt: string | null;
    confidence: 'high' | 'medium' | 'low';
    supports: string;
    sha256: string | null;
    bytes: number | null;
  }>;
  specialists: PiSpecialist[];
  headline: {
    keyOpportunity: string;
    topRisks: string[];
    confidence: 'high' | 'medium' | 'low' | 'none';
    confidenceWhy: string;
  };
  blockers: string[];
  missingInformation: string[];
  nextActions: string[];
}

export interface PiSpecialist {
  id: string;
  label: string;
  role: 'required' | 'supporting';
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'blocked' | 'skipped';
  summary: string;
  failureCategory: string | null;
  failureMessage: string | null;
  retryable: boolean;
  evidenceCount: number;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
}

export interface PiRun {
  runId: string;
  sequence: number;
  status: string;
  trigger: string;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  failureCategory: string | null;
  isPrimary: boolean;
}

export interface PropertyIntelligenceView {
  snapshot: PiSnapshot | null;
  run: PiRun | null;
  specialists: PiSpecialist[];
  history: Array<{ runId: string; sequence: number; status: string; startedAt: string; completedAt: string | null; isPrimary: boolean }>;
}

// ── Data hook ───────────────────────────────────────────────────────────────

export interface PropertyIntelligenceState {
  view: PropertyIntelligenceView | null;
  loading: boolean;
  launching: boolean;
  error: string | null;
  running: boolean;
  launch: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function usePropertyIntelligence(dealId: number | null | undefined): PropertyIntelligenceState {
  const [view, setView] = useState<PropertyIntelligenceView | null>(null);
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!dealId) return;
    setLoading(true);
    try {
      const response = await apiGet<{ propertyIntelligence: PropertyIntelligenceView }>(`/api/landos/deal-cards/${dealId}/property-intelligence`);
      setView(response.propertyIntelligence);
      setError(null);
    } catch (err) {
      setError((err as Error)?.message ?? 'Could not load Property Intelligence.');
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const running = view?.run?.status === 'running';

  // Poll while a mission is in flight so the operator watches real progress.
  useEffect(() => {
    if (!dealId || !running) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    pollRef.current = setInterval(() => { void refresh(); }, 3000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [dealId, running, refresh]);

  const launch = useCallback(async () => {
    if (!dealId) return;
    setLaunching(true);
    setError(null);
    try {
      const response = await apiPost<{ propertyIntelligence: PropertyIntelligenceView }>(`/api/landos/deal-cards/${dealId}/property-intelligence/run`, {});
      setView(response.propertyIntelligence);
    } catch (err) {
      setError((err as Error)?.message ?? 'Property Intelligence could not start.');
    } finally {
      setLaunching(false);
    }
  }, [dealId]);

  return { view, loading, launching, error, running, launch, refresh };
}

// ── Presentation helpers ────────────────────────────────────────────────────

const GRADE_LABEL: Record<EvidenceGradeView, string> = {
  confirmed_fact: 'Confirmed fact',
  likely_indication: 'Likely indication',
  unresolved_question: 'Unresolved',
  unavailable_public_record: 'No public record',
  post_contract_verification: 'Post-contract legal check',
};

const GRADE_TONE: Record<EvidenceGradeView, string> = {
  confirmed_fact: 'border-emerald-500/40 text-emerald-400',
  likely_indication: 'border-sky-500/40 text-sky-400',
  unresolved_question: 'border-amber-500/40 text-amber-400',
  unavailable_public_record: 'border-zinc-500/40 text-zinc-400',
  post_contract_verification: 'border-violet-500/40 text-violet-400',
};

const STATUS_TONE: Record<PiSpecialist['status'], string> = {
  queued: 'border-zinc-500/40 text-zinc-400',
  running: 'border-sky-500/40 text-sky-400',
  completed: 'border-emerald-500/40 text-emerald-400',
  partial: 'border-amber-500/40 text-amber-400',
  failed: 'border-rose-500/40 text-rose-400',
  blocked: 'border-orange-500/40 text-orange-400',
  skipped: 'border-zinc-500/40 text-zinc-400',
};

const VERDICT_TONE: Record<PiDueDiligenceItem['verdict'], string> = {
  good: 'border-emerald-500/40 text-emerald-400',
  caution: 'border-amber-500/40 text-amber-400',
  risk: 'border-rose-500/40 text-rose-400',
  unknown: 'border-zinc-500/40 text-zinc-400',
};

const APPLICABILITY_TONE: Record<string, string> = {
  applicable: 'border-emerald-500/40 text-emerald-400',
  conditional: 'border-amber-500/40 text-amber-400',
  blocked: 'border-rose-500/40 text-rose-400',
  not_applicable: 'border-zinc-500/40 text-zinc-400',
};

function Tag({ tone, children }: { tone: string; children: any }) {
  return <span class={`inline-flex shrink-0 items-center rounded border px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wide ${tone}`}>{children}</span>;
}

function Card({ title, right, children }: { title: string; right?: any; children: any }) {
  return (
    <div class="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text)]">{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div class="text-[11px] leading-relaxed text-[var(--color-text-faint)]">{text}</div>;
}

function Bullets({ rows, tone }: { rows: string[]; tone?: string }) {
  if (!rows.length) return null;
  return (
    <ul class="space-y-1">
      {rows.map((row, index) => (
        <li key={index} class={`relative pl-3 text-[11px] leading-relaxed ${tone ?? 'text-[var(--color-text-muted)]'}`}>
          <span class="absolute left-0 top-[7px] h-1 w-1 rounded-full bg-[var(--color-text-faint)]" />
          {row}
        </li>
      ))}
    </ul>
  );
}

const money = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? `$${Math.round(value).toLocaleString()}` : '—';

const range = (band: { low: number; high: number } | null): string =>
  band ? `${money(band.low)} – ${money(band.high)}` : '—';

function NoSnapshot({ label }: { label: string }) {
  return (
    <Empty text={`No Property Intelligence snapshot exists for this Deal Card yet, so nothing is asserted about ${label}. Run Property Intelligence from the Overview tab to build it.`} />
  );
}

// ── Launch + progress ───────────────────────────────────────────────────────

export function PropertyIntelligenceLaunch({ state }: { state: PropertyIntelligenceState }) {
  const { view, running, launching, error, launch } = state;
  const run = view?.run ?? null;
  const specialists = view?.specialists ?? [];
  const done = specialists.filter((s) => s.status !== 'queued' && s.status !== 'running').length;

  return (
    <div data-testid="pi-launch" class="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-[12px] font-semibold text-[var(--color-text)]">Property Intelligence</div>
          <div class="text-[11px] leading-relaxed text-[var(--color-text-muted)]">
            One action runs the full parcel workflow: identity, government records, zoning, environmental,
            access and utilities, comparables, valuation and the five approved strategies.
          </div>
        </div>
        <button
          type="button"
          data-testid="pi-run-button"
          disabled={running || launching}
          onClick={() => { void launch(); }}
          class="shrink-0 rounded border border-[var(--color-accent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-accent)] disabled:opacity-50"
        >
          {running ? 'Running…' : launching ? 'Starting…' : view?.snapshot ? 'Re-run Property Intelligence' : 'Run Property Intelligence'}
        </button>
      </div>

      {error && <div data-testid="pi-error" class="mt-2 rounded border border-rose-500/40 px-2 py-1 text-[11px] text-rose-400">{error}</div>}

      {run && (
        <div class="mt-3">
          <div class="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
            <Tag tone={run.status === 'running' ? STATUS_TONE.running : run.status === 'failed' ? STATUS_TONE.failed : run.status === 'complete' ? STATUS_TONE.completed : STATUS_TONE.partial}>
              {run.status.replace(/_/g, ' ')}
            </Tag>
            <span>Run #{run.sequence}</span>
            <span>{done}/{specialists.length} specialists settled</span>
            {run.failureCategory && <Tag tone={STATUS_TONE.failed}>{run.failureCategory}</Tag>}
          </div>
          {run.error && <div class="mt-1 text-[11px] text-rose-400">{run.error}</div>}

          <div data-testid="pi-specialists" class="mt-2 space-y-1">
            {specialists.map((specialist) => (
              <div key={specialist.id} data-testid={`pi-specialist-${specialist.id}`} class="flex flex-wrap items-start gap-2 rounded border border-[var(--color-border)] px-2 py-1">
                <Tag tone={STATUS_TONE[specialist.status]}>{specialist.status}</Tag>
                <span class="text-[11px] font-semibold text-[var(--color-text)]">{specialist.label}</span>
                {specialist.role === 'supporting' && <Tag tone="border-zinc-500/40 text-zinc-400">supporting</Tag>}
                {specialist.failureCategory && <Tag tone={STATUS_TONE.failed}>{specialist.failureCategory}</Tag>}
                <span class="min-w-0 flex-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                  {specialist.failureMessage ?? specialist.summary}
                </span>
                {specialist.durationMs != null && (
                  <span class="shrink-0 text-[10px] text-[var(--color-text-faint)]">{(specialist.durationMs / 1000).toFixed(1)}s</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {!run && !running && (
        <div class="mt-2 text-[11px] text-[var(--color-text-faint)]">
          Not run yet for this Deal Card. Nothing is asserted until it runs.
        </div>
      )}
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────

export function PropertyIntelligenceOverview({ snapshot }: { snapshot: PiSnapshot | null }) {
  if (!snapshot) return <NoSnapshot label="this property" />;
  const { identity, headline, recommendation, valuation } = snapshot;
  return (
    <div data-testid="pi-overview" class="space-y-3">
      <Card
        title="Property Intelligence"
        right={
          <div class="flex flex-wrap items-center gap-1.5">
            <Tag tone={snapshot.status === 'complete' ? STATUS_TONE.completed : snapshot.status === 'failed' ? STATUS_TONE.failed : STATUS_TONE.partial}>
              {snapshot.status.replace(/_/g, ' ')}
            </Tag>
            <Tag tone={headline.confidence === 'high' ? STATUS_TONE.completed : headline.confidence === 'none' ? STATUS_TONE.failed : STATUS_TONE.partial}>
              {headline.confidence} confidence
            </Tag>
            <Tag tone="border-zinc-500/40 text-zinc-400">run #{snapshot.sequence}</Tag>
          </div>
        }
      >
        <dl class="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          <Field label="Identity" value={identity.state} tone={identity.state === 'confirmed' ? VERDICT_TONE.good : VERDICT_TONE.risk} />
          <Field label="APN" value={identity.apn ?? '—'} />
          <Field label="Owner" value={identity.owner ?? '—'} />
          <Field label="Acreage" value={identity.acres == null ? '—' : `${identity.acres.toFixed(2)} ac`} />
          <Field label="County" value={[identity.county, identity.state_].filter(Boolean).join(', ') || '—'} />
          <Field label="Value band" value={valuation.priceable ? range(valuation.range) : 'Not priceable'} />
        </dl>
        <div class="mt-2 text-[11px] leading-relaxed text-[var(--color-text-muted)]">{headline.confidenceWhy}</div>
      </Card>

      <Card title="Key opportunity">
        <div class="text-[11px] leading-relaxed text-[var(--color-text)]">{headline.keyOpportunity}</div>
        {recommendation.preferredStrategy && (
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <Tag tone={APPLICABILITY_TONE.applicable}>{recommendation.preferredStrategy}</Tag>
            <Tag tone={recommendation.posture === 'pursue' ? STATUS_TONE.completed : STATUS_TONE.partial}>{recommendation.posture}</Tag>
            <span class="min-w-0 flex-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">{recommendation.postureWhy}</span>
          </div>
        )}
      </Card>

      <div class="grid gap-3 lg:grid-cols-3">
        <Card title="Top risks">
          {snapshot.headline.topRisks.length ? <Bullets rows={snapshot.headline.topRisks} tone="text-rose-300" /> : <Empty text="No mapped risk was found in the lanes that were screened. Unscreened lanes are listed under missing information." />}
        </Card>
        <Card title="Blockers">
          {snapshot.blockers.length ? <Bullets rows={snapshot.blockers} tone="text-amber-300" /> : <Empty text="No blocker is open." />}
        </Card>
        <Card title="Next actions">
          {snapshot.nextActions.length ? <Bullets rows={snapshot.nextActions} /> : <Empty text="No next action is outstanding." />}
        </Card>
      </div>

      {snapshot.missingInformation.length > 0 && (
        <Card title="Missing information" right={<Tag tone={STATUS_TONE.partial}>{snapshot.missingInformation.length}</Tag>}>
          <Bullets rows={snapshot.missingInformation} tone="text-amber-300" />
        </Card>
      )}
    </div>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div class="min-w-0">
      <dt class="text-[9px] uppercase tracking-wide text-[var(--color-text-faint)]">{label}</dt>
      <dd class={`truncate text-[11px] font-semibold ${tone ? tone.split(' ').filter((c) => c.startsWith('text-')).join(' ') : 'text-[var(--color-text)]'}`}>{value}</dd>
    </div>
  );
}

// ── Property ────────────────────────────────────────────────────────────────

export function PropertyIntelligenceProperty({ snapshot }: { snapshot: PiSnapshot | null }) {
  if (!snapshot) return <NoSnapshot label="the parcel record" />;
  const { identity } = snapshot;
  return (
    <div data-testid="pi-property" class="space-y-3">
      <Card
        title="Parcel identity"
        right={<Tag tone={identity.state === 'confirmed' ? VERDICT_TONE.good : identity.state === 'provisional' ? VERDICT_TONE.caution : VERDICT_TONE.risk}>{identity.state}</Tag>}
      >
        <div class="text-[11px] leading-relaxed text-[var(--color-text-muted)]">{identity.explanation}</div>
        {identity.apnVariants.length > 1 && (
          <div class="mt-2 text-[11px] text-amber-300">
            {identity.apnVariants.length} distinct parcel identifiers are attached: {identity.apnVariants.join(' · ')}.
          </div>
        )}
        {identity.conflicts.length > 0 && (
          <div class="mt-2">
            <div class="text-[10px] font-semibold uppercase tracking-wide text-rose-400">Unresolved conflicts</div>
            <Bullets rows={identity.conflicts} tone="text-rose-300" />
          </div>
        )}
      </Card>

      <Card title="Reconciled parcel facts">
        {snapshot.facts.length ? <FactTable facts={snapshot.facts} /> : <Empty text="No reconciled parcel fact was retained by this run." />}
      </Card>

      <Card title="Government records" right={<Tag tone="border-zinc-500/40 text-zinc-400">{snapshot.governmentRecords.length}</Tag>}>
        {snapshot.governmentRecords.length
          ? <FactTable facts={snapshot.governmentRecords} />
          : <Empty text="No recorded-government evidence has been retrieved for this parcel. Deed, tax and ownership records remain unretrieved rather than assumed." />}
      </Card>
    </div>
  );
}

function FactTable({ facts }: { facts: PiFact[] }) {
  return (
    <div class="overflow-x-auto">
      <table class="w-full min-w-[520px] border-collapse text-[11px]">
        <tbody>
          {facts.map((fact) => (
            <tr key={fact.key} class="border-b border-[var(--color-border)] last:border-0 align-top">
              <td class="w-[30%] py-1.5 pr-2 text-[var(--color-text-faint)]">{fact.label}</td>
              <td class="py-1.5 pr-2 text-[var(--color-text)]">
                {fact.value ?? '—'}
                {fact.note && <div class="text-[10px] leading-relaxed text-[var(--color-text-faint)]">{fact.note}</div>}
              </td>
              <td class="w-[1%] whitespace-nowrap py-1.5 pr-2"><Tag tone={GRADE_TONE[fact.grade]}>{GRADE_LABEL[fact.grade]}</Tag></td>
              <td class="w-[1%] whitespace-nowrap py-1.5 text-[10px] text-[var(--color-text-faint)]">
                {fact.sourceUrl
                  ? <a href={fact.sourceUrl} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">{fact.source ?? 'source'}</a>
                  : (fact.source ?? '')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Due diligence ───────────────────────────────────────────────────────────

export function PropertyIntelligenceDueDiligence({ snapshot }: { snapshot: PiSnapshot | null }) {
  if (!snapshot) return <NoSnapshot label="due diligence" />;
  if (!snapshot.dueDiligence.length) {
    return <Empty text="No due-diligence lane produced a finding in this run. Nothing is claimed as screened." />;
  }
  return (
    <div data-testid="pi-diligence" class="space-y-2">
      {snapshot.dueDiligence.map((item) => (
        <div key={item.key} data-testid={`pi-dd-${item.key}`} class="rounded-md border border-[var(--color-border)] p-3">
          <div class="flex flex-wrap items-center gap-2">
            <Tag tone={VERDICT_TONE[item.verdict]}>{item.verdict}</Tag>
            <span class="text-[11px] font-semibold text-[var(--color-text)]">{item.label}</span>
            <Tag tone={GRADE_TONE[item.grade]}>{GRADE_LABEL[item.grade]}</Tag>
            {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" class="text-[10px] text-[var(--color-accent)] underline">source</a>}
          </div>
          <div class="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">{item.headline}</div>
          {item.detail && <div class="mt-1 text-[10px] leading-relaxed text-[var(--color-text-faint)]">{item.detail}</div>}
          {item.missing.length > 0 && (
            <div class="mt-1.5">
              <div class="text-[9px] font-semibold uppercase tracking-wide text-amber-400">Still open</div>
              <Bullets rows={item.missing} tone="text-amber-300" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Market ──────────────────────────────────────────────────────────────────

export function PropertyIntelligenceMarket({ snapshot }: { snapshot: PiSnapshot | null }) {
  if (!snapshot) return <NoSnapshot label="the comparable set or value" />;
  const { comps, valuation } = snapshot;
  return (
    <div data-testid="pi-market" class="space-y-3">
      <Card
        title="Comp source policy"
        right={
          <Tag tone={comps.landPortalUsable ? STATUS_TONE.completed : (comps.landPortalRowsSeen ?? 0) > 0 ? STATUS_TONE.partial : STATUS_TONE.failed}>
            {comps.landPortalUsable
              ? 'LandPortal primary'
              : (comps.landPortalRowsSeen ?? 0) > 0
                // LandPortal ANSWERED. "empty" would be a false current-state
                // claim about a source that was read successfully.
                ? `LandPortal read · ${comps.landPortalRowsSeen} row(s), none priceable`
                : 'LandPortal returned nothing'}
          </Tag>
        }
      >
        <div class="text-[11px] leading-relaxed text-[var(--color-text-muted)]">{comps.policyExplanation}</div>
        <div class="mt-1 text-[11px] text-[var(--color-text-faint)]">{comps.summaryLine}</div>
      </Card>

      <Card title="Valuation" right={<Tag tone={valuation.priceable ? STATUS_TONE.completed : STATUS_TONE.failed}>{valuation.priceable ? `${valuation.confidence} confidence` : 'not priceable'}</Tag>}>
        {valuation.priceable ? (
          <div class="space-y-2">
            <dl class="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
              <Field label="Value band" value={range(valuation.range)} />
              <Field label="Per acre" value={range(valuation.pricePerAcreRange)} />
              <Field label="Likely retail" value={range(valuation.likelyRetail)} />
              <Field label="Disposition" value={range(valuation.dispositionRange)} />
            </dl>
            <div class="text-[11px] leading-relaxed text-[var(--color-text-muted)]">{valuation.basis}</div>
            {valuation.adjustments.length > 0 && (
              <div><div class="text-[9px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Adjustments</div><Bullets rows={valuation.adjustments} /></div>
            )}
            {valuation.uncertainty.length > 0 && (
              <div><div class="text-[9px] font-semibold uppercase tracking-wide text-amber-400">Uncertainty</div><Bullets rows={valuation.uncertainty} tone="text-amber-300" /></div>
            )}
          </div>
        ) : (
          <div class="space-y-1.5">
            <div data-testid="pi-not-priceable" class="text-[11px] leading-relaxed text-rose-300">{valuation.notPriceableReason}</div>
            {valuation.nextActionToPrice && <div class="text-[11px] leading-relaxed text-[var(--color-text-muted)]">Next action: {valuation.nextActionToPrice}</div>}
          </div>
        )}
      </Card>

      <Card title="Accepted sold comps" right={<Tag tone="border-zinc-500/40 text-zinc-400">{comps.sold.length}</Tag>}>
        {comps.sold.length ? <CompTable rows={comps.sold} /> : <Empty text="No closed sale survived the comp source policy, so no comp is presented as a value basis." />}
      </Card>

      <Card title="Active competition" right={<Tag tone="border-zinc-500/40 text-zinc-400">{comps.active.length}</Tag>}>
        {comps.active.length
          ? <CompTable rows={comps.active} />
          : <Empty text="No active vacant-land listing was found in the subject market." />}
      </Card>

      {comps.landHomeOnly.length > 0 && (
        <Card title="Improved sales (Land-Home Package only)" right={<Tag tone={STATUS_TONE.partial}>{comps.landHomeOnly.length}</Tag>}>
          <div class="mb-1.5 text-[10px] leading-relaxed text-amber-300">
            These improved or manufactured-home sales never establish vacant-land fair market value. They inform the Land-Home Package strategy only.
          </div>
          <CompTable rows={comps.landHomeOnly} />
        </Card>
      )}

      {comps.rejected.length > 0 && (
        <Card title="Excluded candidates" right={<Tag tone="border-zinc-500/40 text-zinc-400">{comps.rejected.length}</Tag>}>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[520px] border-collapse text-[11px]">
              <tbody>
                {comps.rejected.map((row, index) => (
                  <tr key={index} class="border-b border-[var(--color-border)] last:border-0 align-top">
                    <td class="w-[28%] py-1.5 pr-2 text-[var(--color-text)]">{row.address ?? '—'}</td>
                    <td class="w-[14%] py-1.5 pr-2 text-[var(--color-text-faint)]">{row.source}</td>
                    <td class="w-[12%] py-1.5 pr-2 text-[var(--color-text-faint)]">{money(row.price)}</td>
                    <td class="py-1.5 text-[var(--color-text-muted)]">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function CompTable({ rows }: { rows: PiComp[] }) {
  return (
    <div class="overflow-x-auto">
      <table class="w-full min-w-[640px] border-collapse text-[11px]">
        <thead>
          <tr class="border-b border-[var(--color-border)] text-[9px] uppercase tracking-wide text-[var(--color-text-faint)]">
            <th class="py-1 pr-2 text-left font-semibold">Property</th>
            <th class="py-1 pr-2 text-left font-semibold">Status</th>
            <th class="py-1 pr-2 text-left font-semibold">Date</th>
            <th class="py-1 pr-2 text-right font-semibold">Price</th>
            <th class="py-1 pr-2 text-right font-semibold">Acres</th>
            <th class="py-1 pr-2 text-right font-semibold">$/ac</th>
            <th class="py-1 pr-2 text-left font-semibold">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} class="border-b border-[var(--color-border)] last:border-0 align-top">
              <td class="py-1.5 pr-2 text-[var(--color-text)]">
                {row.address ?? '—'}
                <div class="text-[10px] leading-relaxed text-[var(--color-text-faint)]">{row.whyUseful}</div>
                {row.differences.length > 0 && <div class="text-[10px] leading-relaxed text-amber-400/80">{row.differences.join(' ')}</div>}
              </td>
              <td class="py-1.5 pr-2 text-[var(--color-text-muted)]">{row.status}</td>
              <td class="py-1.5 pr-2 text-[var(--color-text-muted)]">{row.dateIso ? row.dateIso.slice(0, 10) : '—'}</td>
              <td class="py-1.5 pr-2 text-right text-[var(--color-text)]">{money(row.price)}</td>
              <td class="py-1.5 pr-2 text-right text-[var(--color-text-muted)]">{row.acres == null ? '—' : row.acres.toFixed(2)}</td>
              <td class="py-1.5 pr-2 text-right text-[var(--color-text-muted)]">{money(row.pricePerAcre)}</td>
              <td class="py-1.5 pr-2 text-[var(--color-text-faint)]">
                {row.sourceUrl ? <a href={row.sourceUrl} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">{row.source}</a> : row.source}
                {row.distanceMiles != null && <div class="text-[10px]">{row.distanceMiles.toFixed(1)} mi</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Strategy ────────────────────────────────────────────────────────────────

export function PropertyIntelligenceStrategy({ snapshot }: { snapshot: PiSnapshot | null }) {
  if (!snapshot) return <NoSnapshot label="strategy" />;
  const { recommendation, strategies } = snapshot;
  return (
    <div data-testid="pi-strategy" class="space-y-3">
      <Card
        title="Recommended path"
        right={<Tag tone={recommendation.posture === 'pursue' ? STATUS_TONE.completed : recommendation.posture === 'reject' ? STATUS_TONE.failed : STATUS_TONE.partial}>{recommendation.posture}</Tag>}
      >
        {recommendation.preferredStrategy ? (
          <div class="space-y-1.5">
            <div class="text-[12px] font-semibold text-[var(--color-accent)]">{recommendation.preferredStrategy}</div>
            <div class="text-[11px] leading-relaxed text-[var(--color-text-muted)]">{recommendation.why}</div>
            <div class="text-[11px] leading-relaxed text-[var(--color-text-muted)]">{recommendation.postureWhy}</div>
          </div>
        ) : (
          <div data-testid="pi-no-recommendation" class="text-[11px] leading-relaxed text-amber-300">{recommendation.why}</div>
        )}
        {recommendation.whatWouldChangeIt.length > 0 && (
          <div class="mt-2">
            <div class="text-[9px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">What would change this</div>
            <Bullets rows={recommendation.whatWouldChangeIt} />
          </div>
        )}
      </Card>

      {strategies.length ? strategies.map((strategy) => (
        <div key={strategy.strategy} data-testid={`pi-strategy-${strategy.strategy.replace(/\s+/g, '-').toLowerCase()}`} class="rounded-md border border-[var(--color-border)] p-3">
          <div class="flex flex-wrap items-center gap-2">
            <Tag tone={APPLICABILITY_TONE[strategy.applicability] ?? APPLICABILITY_TONE.not_applicable}>{strategy.applicability.replace(/_/g, ' ')}</Tag>
            <span class="text-[11px] font-semibold text-[var(--color-text)]">{strategy.strategy}</span>
            {strategy.strategy === recommendation.preferredStrategy && <Tag tone={STATUS_TONE.completed}>recommended</Tag>}
          </div>
          <div class="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">{strategy.valueCreationPath}</div>
          <dl class="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            <Field label="Effort" value={strategy.effort} />
            <Field label="Timeline" value={strategy.timeline} />
          </dl>
          {strategy.supportingFacts.length > 0 && (
            <div class="mt-1.5"><div class="text-[9px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Supporting facts</div><Bullets rows={strategy.supportingFacts} /></div>
          )}
          {strategy.blockers.length > 0 && (
            <div class="mt-1.5"><div class="text-[9px] font-semibold uppercase tracking-wide text-rose-400">Blockers</div><Bullets rows={strategy.blockers} tone="text-rose-300" /></div>
          )}
          <div class="mt-1.5 text-[11px] leading-relaxed text-[var(--color-text-muted)]"><span class="text-[var(--color-text-faint)]">Risk:</span> {strategy.risk}</div>
          <div class="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]"><span class="text-[var(--color-text-faint)]">Next verification:</span> {strategy.nextVerificationStep}</div>
        </div>
      )) : <Empty text="No strategy evaluation exists for this run." />}
    </div>
  );
}

// ── Visuals ─────────────────────────────────────────────────────────────────

export function PropertyIntelligenceVisuals({ snapshot }: { snapshot: PiSnapshot | null }) {
  if (!snapshot) return <NoSnapshot label="retained imagery" />;
  const visuals = snapshot.evidence.filter((item) => item.kind === 'screenshot' || item.kind === 'map' || item.kind === 'overlay');
  const links = snapshot.evidence.filter((item) => item.kind === 'source_link');
  return (
    <div data-testid="pi-visuals" class="space-y-3">
      <Card title="Retained imagery" right={<Tag tone="border-zinc-500/40 text-zinc-400">{visuals.length}</Tag>}>
        {visuals.length ? (
          <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {visuals.map((item) => (
              <figure key={item.id} class="overflow-hidden rounded border border-[var(--color-border)]">
                {item.viewUrl
                  ? <img src={tokenized(item.viewUrl)!} alt={item.label} loading="lazy" class="h-36 w-full object-cover" />
                  : <div class="flex h-36 w-full items-center justify-center text-[10px] text-[var(--color-text-faint)]">No retained image file</div>}
                <figcaption class="px-2 py-1.5 text-[10px] leading-relaxed text-[var(--color-text-muted)]">
                  {item.label}
                  {item.sourceUrl && <> · <a href={item.sourceUrl} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">source</a></>}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <Empty text="No parcel image, map or overlay was retained by this run." />
        )}
      </Card>

      <Card title="Source links" right={<Tag tone="border-zinc-500/40 text-zinc-400">{links.length}</Tag>}>
        {links.length ? (
          <ul class="space-y-1">
            {links.map((item) => (
              <li key={item.id} class="flex flex-wrap items-center gap-2 text-[11px]">
                <Tag tone={item.confidence === 'high' ? STATUS_TONE.completed : STATUS_TONE.partial}>{item.sourceType}</Tag>
                <a href={item.sourceUrl ?? '#'} target="_blank" rel="noreferrer" class="min-w-0 flex-1 truncate text-[var(--color-accent)] underline">{item.label}</a>
                <span class="shrink-0 text-[10px] text-[var(--color-text-faint)]">{item.supports}</span>
              </li>
            ))}
          </ul>
        ) : <Empty text="No retrievable source link was retained by this run." />}
      </Card>
    </div>
  );
}

// ── Documents and evidence ──────────────────────────────────────────────────

export function PropertyIntelligenceEvidence({ snapshot }: { snapshot: PiSnapshot | null }) {
  if (!snapshot) return <NoSnapshot label="retained evidence" />;
  const documents = snapshot.evidence.filter((item) => item.kind === 'document' || item.kind === 'record');
  return (
    <div data-testid="pi-evidence" class="space-y-3">
      <Card title="Retained records and documents" right={<Tag tone="border-zinc-500/40 text-zinc-400">{documents.length}</Tag>}>
        {documents.length ? (
          <div class="overflow-x-auto">
            <table class="w-full min-w-[560px] border-collapse text-[11px]">
              <thead>
                <tr class="border-b border-[var(--color-border)] text-[9px] uppercase tracking-wide text-[var(--color-text-faint)]">
                  <th class="py-1 pr-2 text-left font-semibold">Document</th>
                  <th class="py-1 pr-2 text-left font-semibold">Source type</th>
                  <th class="py-1 pr-2 text-left font-semibold">Retrieved</th>
                  <th class="py-1 pr-2 text-left font-semibold">Supports</th>
                  <th class="py-1 text-left font-semibold">Open</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((item) => (
                  <tr key={item.id} class="border-b border-[var(--color-border)] last:border-0 align-top">
                    <td class="py-1.5 pr-2 text-[var(--color-text)]">{item.label}</td>
                    <td class="py-1.5 pr-2 text-[var(--color-text-muted)]">{item.sourceType}</td>
                    <td class="py-1.5 pr-2 text-[var(--color-text-faint)]">{item.retrievedAt ? item.retrievedAt.slice(0, 10) : '—'}</td>
                    <td class="py-1.5 pr-2 text-[var(--color-text-faint)]">{item.supports}</td>
                    <td class="py-1.5 text-[var(--color-text-faint)]">
                      {item.viewUrl && <a href={tokenized(item.viewUrl)!} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">view</a>}
                      {item.viewUrl && item.sourceUrl && ' · '}
                      {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" class="text-[var(--color-accent)] underline">source</a>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty text="No official record or document has been retained for this parcel yet." />}
      </Card>

      <Card title="Specialist contributions" right={<Tag tone="border-zinc-500/40 text-zinc-400">run #{snapshot.sequence}</Tag>}>
        <div class="space-y-1">
          {snapshot.specialists.map((specialist) => (
            <div key={specialist.id} class="flex flex-wrap items-start gap-2 text-[11px]">
              <Tag tone={STATUS_TONE[specialist.status]}>{specialist.status}</Tag>
              <span class="font-semibold text-[var(--color-text)]">{specialist.label}</span>
              <span class="min-w-0 flex-1 leading-relaxed text-[var(--color-text-muted)]">{specialist.failureMessage ?? specialist.summary}</span>
              {specialist.evidenceCount > 0 && <span class="shrink-0 text-[10px] text-[var(--color-text-faint)]">{specialist.evidenceCount} item(s)</span>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
