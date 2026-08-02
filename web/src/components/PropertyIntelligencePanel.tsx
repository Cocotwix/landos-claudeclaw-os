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
  /** The comp's assessor parcel number, exactly as the source stated it. */
  apn?: string | null;
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
    /** True when consistent parcel evidence supports discovery-stage work even
     * though the practical official source is unavailable. */
    discoveryUsable?: boolean;
    discoveryBasis?: string | null;
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
    /** Priced rows whose publisher never stated whether they closed. */
    askingReferences?: PiComp[];
    /** Held-back rows as counts + one reason each, never one line per row. */
    evidenceBuckets?: Array<{ reason: string; count: number; sources: string[] }>;
    totalCollected?: number;
    conclusion?: 'sold_supported' | 'asking_indication' | 'not_priceable';
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
    /** The one number to work from inside the supported range. */
    workingValue?: number | null;
    /** One line naming the comps the conclusion actually rests on. */
    primaryBasis?: string | null;
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
    shouldPursue?: 'yes' | 'with_conditions' | 'no' | 'undetermined';
    worth?: { low: number; high: number; workingValue: number } | null;
    targetBuyRange?: { low: number; high: number; basis: string } | null;
    bestExit?: string | null;
    dealKillers?: string[];
    nextConfirmations?: string[];
    juiceWorthSqueeze?: {
      answer: 'yes' | 'conditional' | 'no' | 'undetermined';
      why: string;
    };
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
  /** The parent mission this snapshot was assembled from. */
  missionId?: string | null;
  /** What the run did with the browser pages it opened. */
  browserCleanup?: { before: number; after: number; closed: number; note: string } | null;
  /** True only on the in-flight progressive assembly. Never on a promoted snapshot. */
  preliminary?: boolean;
}

/** In-flight progressive content: the partial assembly built as children settle. */
export interface PiProgressive {
  preliminary: true;
  runId: string;
  dealCardId: number;
  sequence: number;
  updatedAt: string;
  settled: string[];
  outstanding: string[];
  snapshot: PiSnapshot;
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

/** One child mission of the parent Deal Intelligence mission. */
export interface PiMissionChild {
  key: string;
  label: string;
  role: 'required' | 'supporting';
  group: string;
  assignedRole: string;
  agentName: string;
  agentKey: string | null;
  contributionSlot: string;
  status: string;
  summary: string;
  dependsOn: string[];
  acceptance: { state: string; reason: string } | null;
  provider: { mode: string; providerLabel: string | null; reason: string } | null;
  failureCategory: string | null;
  durationMs: number | null;
}

export interface PiMissionView {
  label: string;
  kind: string;
  mission: {
    missionId: string;
    sequence: number;
    status: string;
    trigger: string;
    outcome: string | null;
    startedAt: string;
    completedAt: string | null;
    error: string | null;
    failureCategory: string | null;
  };
  children: PiMissionChild[];
  join: {
    status: string;
    outcome: string;
    contributed: string[];
    accepted: string[];
    incomplete: string[];
    requiredGaps: Array<{ key: string; label: string; status: string; reason: string }>;
    allTerminal: boolean;
  } | null;
  history: Array<{ missionId: string; sequence: number; status: string; startedAt: string; completedAt: string | null }>;
}

export interface PropertyIntelligenceView {
  snapshot: PiSnapshot | null;
  hermesLandPortal?: {
    runId: string;
    dealCardId: number;
    propertyCardId: number;
    address: string;
    status: 'running' | 'exact_match' | 'context_only' | 'no_match' | 'failed';
    startedAt: string;
    completedAt: string | null;
    note: string;
    persistedCategories: Array<{
      category: 'subject' | 'comps' | 'visuals';
      persistedAt: string;
      itemCount: number;
      rejectedItemCount: number;
      error: string | null;
    }>;
  } | null;
  providerResearch?: {
    contractVersion: string;
    propertyCardId: number;
    updatedAt: string;
    lanes: Array<{
      laneId: string;
      providerId: string;
      retainedStatus: string;
      latestAttemptStatus: string;
      latestAttemptAt: string;
      latestFailureReason: string | null;
      durationMs: number;
    }>;
    acceptedEvidenceCount: number;
    acceptedEvidence?: Array<{
      id: string;
      field: string;
      value: unknown;
      kind: 'fact' | 'visual' | 'comp' | 'estimate' | 'status';
      subjectClassification: 'verified_subject' | 'context_only' | 'no_match';
      sourceUrl: string | null;
      retrievedAt: string;
    }>;
    rejectedEvidenceCount: number;
    rejectedEvidence: Array<{ evidenceId: string; laneId: string; providerId: string; reason: string }>;
  } | null;
  /** In-flight progressive content while a run is running; null otherwise. */
  progressive?: PiProgressive | null;
  /** The parent mission behind the snapshot and the run in flight. */
  mission: PiMissionView | null;
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

  const running = view?.run?.status === 'running' || view?.hermesLandPortal?.status === 'running';

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

function conciseUnique(rows: Array<string | null | undefined>, limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of rows) {
    const value = raw?.trim();
    if (!value) continue;
    const key = value
      .toLowerCase()
      .replace(/^[^:]{1,72}:\s+(?:partial result\s+[—-]\s+|blocked\s+[—-]\s+)?/u, '')
      .replace(/\s+/gu, ' ')
      .replace(/[.?!]+$/gu, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function materialLimitations(snapshot: PiSnapshot): string[] {
  const diligence = snapshot.dueDiligence
    .filter((item) => item.verdict === 'risk' || item.verdict === 'unknown')
    .map((item) => `${item.label}: ${item.headline}`);
  return conciseUnique([
    ...snapshot.headline.topRisks,
    ...snapshot.blockers,
    ...snapshot.valuation.materialGaps,
    ...diligence,
  ], 6);
}

function conciseNextActions(snapshot: PiSnapshot): string[] {
  return conciseUnique([
    ...snapshot.nextActions,
    snapshot.valuation.nextActionToPrice,
    ...(snapshot.recommendation.nextConfirmations ?? []),
  ], 4);
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

/**
 * Preliminary marking for in-flight progressive content. Rendered at the top of
 * every section fed by a partial assembly, so mid-flight data is never mistaken
 * for the joined snapshot.
 */
function PreliminaryNotice({ snapshot }: { snapshot: PiSnapshot }) {
  if (!snapshot.preliminary) return null;
  return (
    <div data-testid="pi-preliminary" class="rounded-md border border-sky-500/40 bg-sky-500/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-sky-300">
      <span class="font-semibold uppercase tracking-wide">Preliminary</span> — the mission is still
      running. Only the specialist lanes that have settled so far are shown; lanes still in flight are
      listed under missing information. The final snapshot replaces this view when the mission joins,
      and nothing shown here is promoted until then.
    </div>
  );
}

// ── Launch + progress ───────────────────────────────────────────────────────

const ACCEPTANCE_TONE: Record<string, string> = {
  accepted: 'border-emerald-500/40 text-emerald-400',
  incomplete: 'border-amber-500/40 text-amber-400',
  blocked: 'border-orange-500/40 text-orange-400',
  rejected: 'border-rose-500/40 text-rose-400',
  failed: 'border-rose-500/40 text-rose-400',
  not_evaluated: 'border-zinc-500/40 text-zinc-400',
};

/**
 * The parent mission behind the snapshot.
 *
 * Shown so the operator can see that Run Property Intelligence started ONE
 * parent mission with named specialist children, and exactly which handback each
 * child routed into the snapshot — rather than having to trust that it did.
 */
function ParentMissionPanel({ mission }: { mission: PiMissionView | null }) {
  if (!mission) {
    return (
      <div data-testid="pi-parent-mission-empty" class="mt-3 text-[11px] text-[var(--color-text-faint)]">
        No parent mission has run for this Deal Card yet, so no child mission has been dispatched.
      </div>
    );
  }
  const { children, join } = mission;
  const settled = children.filter((child) => !['queued', 'running'].includes(child.status)).length;
  return (
    <div data-testid="pi-parent-mission" class="mt-3 rounded border border-[var(--color-border)] p-2">
      <div class="flex flex-wrap items-center gap-2">
        <Tag tone={mission.mission.status === 'joined' ? STATUS_TONE.completed : mission.mission.status === 'failed' ? STATUS_TONE.failed : mission.mission.status === 'running' ? STATUS_TONE.running : STATUS_TONE.partial}>
          {mission.mission.status.replace(/_/g, ' ')}
        </Tag>
        <span class="text-[11px] font-semibold text-[var(--color-text)]">Parent mission #{mission.mission.sequence}</span>
        <span class="font-mono text-[10px] text-[var(--color-text-faint)]">{mission.mission.missionId}</span>
        <span class="text-[10px] text-[var(--color-text-faint)]">{settled}/{children.length} child missions settled</span>
        {join && (
          <span class="text-[10px] text-[var(--color-text-faint)]">
            {join.accepted.length} accepted · {join.incomplete.length} incomplete
          </span>
        )}
      </div>
      {(mission.mission.outcome || join?.outcome) && (
        <div data-testid="pi-mission-outcome" class="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
          {mission.mission.outcome ?? join?.outcome}
        </div>
      )}
      <div data-testid="pi-mission-children" class="mt-2 space-y-1">
        {children.map((child) => (
          <div key={child.key} data-testid={`pi-mission-child-${child.key}`} class="rounded border border-[var(--color-border)] px-2 py-1">
            <div class="flex flex-wrap items-center gap-1.5">
              <Tag tone={STATUS_TONE[child.status as PiSpecialist['status']] ?? STATUS_TONE.queued}>{child.status}</Tag>
              <span class="text-[11px] font-semibold text-[var(--color-text)]">{child.label}</span>
              {child.role === 'supporting' && <Tag tone="border-zinc-500/40 text-zinc-400">supporting</Tag>}
              <Tag tone={ACCEPTANCE_TONE[child.acceptance?.state ?? 'not_evaluated']}>
                {(child.acceptance?.state ?? 'not evaluated').replace(/_/g, ' ')}
              </Tag>
            </div>
            <div class="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--color-text-faint)]">
              <span>group: {child.group}</span>
              <span>specialist: {child.agentName}</span>
              <span>slot: {child.contributionSlot}</span>
              <span>provider: {child.provider?.providerLabel ?? child.provider?.mode ?? 'not resolved'}</span>
              {child.dependsOn.length > 0 && <span>needs: {child.dependsOn.join(', ')}</span>}
              {child.durationMs != null && <span>{(child.durationMs / 1000).toFixed(1)}s</span>}
            </div>
            <div class="mt-0.5 text-[10.5px] leading-relaxed text-[var(--color-text-muted)]">
              {child.acceptance?.state === 'rejected' ? child.acceptance.reason : child.summary}
            </div>
          </div>
        ))}
      </div>
      {join && join.requiredGaps.length > 0 && (
        <div class="mt-2">
          <div class="text-[9px] font-semibold uppercase tracking-wide text-amber-400">Required contributions missing</div>
          <Bullets rows={join.requiredGaps.map((gap) => `${gap.label} (${gap.status}): ${gap.reason}`)} tone="text-amber-300" />
        </div>
      )}
    </div>
  );
}

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
            One action starts ONE parent mission that dispatches the specialist child missions:
            parcel and LandPortal subject research, government records, zoning, environmental screening,
            utilities and access, comparable sales, Market Pulse, evidence, valuation, and the five
            approved strategies. Their accepted handbacks assemble one current snapshot.
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

          {(running || launching) ? (
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
          ) : (
            <details data-testid="pi-specialists" class="mt-2 rounded border border-[var(--color-border)] px-2 py-1.5">
              <summary class="cursor-pointer text-[11px] font-semibold text-[var(--color-text-muted)]">
                Specialist evidence and source limitations
              </summary>
              <div class="mt-2 space-y-1">
                {specialists.map((specialist) => (
                  <div key={specialist.id} data-testid={`pi-specialist-${specialist.id}`} class="flex flex-wrap items-start gap-2 rounded border border-[var(--color-border)] px-2 py-1">
                    <Tag tone={STATUS_TONE[specialist.status]}>{specialist.status}</Tag>
                    <span class="text-[11px] font-semibold text-[var(--color-text)]">{specialist.label}</span>
                    <span class="min-w-0 flex-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                      {specialist.failureMessage ?? specialist.summary}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      {view?.hermesLandPortal && (
        <div data-testid="pi-hermes-incremental-status" class="mt-2 rounded border border-sky-500/30 bg-sky-500/5 px-2.5 py-2 text-[10.5px]">
          <div class="flex flex-wrap items-center gap-1.5">
            <Tag tone={view.hermesLandPortal.status === 'failed' ? STATUS_TONE.failed : view.hermesLandPortal.status === 'running' ? STATUS_TONE.running : STATUS_TONE.completed}>
              {view.hermesLandPortal.status.replace(/_/g, ' ')}
            </Tag>
            <span class="font-semibold text-[var(--color-text)]">Hermes · {view.hermesLandPortal.address}</span>
          </div>
          <div class="mt-1 text-[var(--color-text-muted)]">{view.hermesLandPortal.note}</div>
          {!!view.hermesLandPortal.persistedCategories.length && (
            <div class="mt-1 space-y-0.5" data-testid="pi-hermes-persisted-categories">
              {view.hermesLandPortal.persistedCategories.map((result) => (
                <div key={result.category}>
                  <span class="font-semibold text-sky-200">{result.category}</span>
                  {' · '}{result.itemCount} item(s) persisted {new Date(result.persistedAt).toLocaleString()}
                  {result.rejectedItemCount ? ` · ${result.rejectedItemCount} rejected` : ''}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {view?.providerResearch && (
        <details open={!!view.hermesLandPortal || view.providerResearch.lanes.some((lane) => lane.providerId === 'hermes_landportal_import')} data-testid="pi-provider-lanes" class="mt-2 rounded border border-[var(--color-border)] px-2 py-1.5">
          <summary class="cursor-pointer text-[11px] font-semibold text-[var(--color-text-muted)]">
            Provider lanes · {view.providerResearch.lanes.length} · {view.providerResearch.acceptedEvidenceCount} accepted evidence item(s)
          </summary>
          <div class="mt-2 space-y-1">
            {view.providerResearch.lanes.map((lane) => (
              <div key={lane.laneId} class="rounded border border-[var(--color-border)] px-2 py-1 text-[10.5px]">
                <div class="flex flex-wrap items-center gap-1.5">
                  <Tag tone={lane.latestAttemptStatus === 'failed' || lane.latestAttemptStatus === 'unavailable' ? STATUS_TONE.failed : lane.latestAttemptStatus === 'verified' ? STATUS_TONE.completed : STATUS_TONE.partial}>
                    {lane.latestAttemptStatus.replace(/_/g, ' ')}
                  </Tag>
                  <span class="font-semibold text-[var(--color-text)]">{lane.laneId.replace(/_/g, ' ')}</span>
                  <span class="text-[var(--color-text-faint)]">{lane.providerId}</span>
                  <span class="ml-auto text-[var(--color-text-faint)]">persisted {new Date(lane.latestAttemptAt).toLocaleString()} · {(lane.durationMs / 1000).toFixed(1)}s</span>
                </div>
                {lane.retainedStatus !== lane.latestAttemptStatus && (
                  <div class="mt-0.5 text-[var(--color-text-muted)]">Retained stronger result: {lane.retainedStatus.replace(/_/g, ' ')}</div>
                )}
                {lane.latestFailureReason && <div class="mt-0.5 text-rose-400">{lane.latestFailureReason}</div>}
              </div>
            ))}
            {(view.providerResearch.acceptedEvidence?.length ?? 0) > 0 && (
              <div data-testid="pi-provider-accepted-evidence" class="mt-2 space-y-1 border-t border-[var(--color-border)] pt-2">
                <div class="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Persisted provider results</div>
                {(view.providerResearch.acceptedEvidence ?? []).map((item) => {
                  const shown = item.value && typeof item.value === 'object'
                    ? Object.entries(item.value as Record<string, unknown>).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')
                    : String(item.value ?? '');
                  return (
                    <div key={item.id} data-testid={`pi-provider-evidence-${item.kind}`} class="rounded border border-[var(--color-border)] px-2 py-1 text-[10.5px]">
                      <div class="flex flex-wrap items-center gap-1.5">
                        <Tag tone={item.subjectClassification === 'verified_subject' ? STATUS_TONE.completed : STATUS_TONE.partial}>{item.kind}</Tag>
                        <span class="font-semibold text-[var(--color-text)]">{item.field.replace(/[_\.]/g, ' ')}</span>
                        <span class="ml-auto text-[var(--color-text-faint)]">{new Date(item.retrievedAt).toLocaleString()}</span>
                      </div>
                      <div class="mt-0.5 break-words text-[var(--color-text-muted)]">{shown}</div>
                    </div>
                  );
                })}
              </div>
            )}
            {view.providerResearch.rejectedEvidenceCount > 0 && (
              <div class="text-[10px] text-amber-300">
                {view.providerResearch.rejectedEvidenceCount} evidence item(s) rejected by scope, strength, or validation rules.
              </div>
            )}
          </div>
        </details>
      )}
      {!run && !running && (
        <div class="mt-2 text-[11px] text-[var(--color-text-faint)]">
          Not run yet for this Deal Card. Nothing is asserted until it runs.
        </div>
      )}

      {(running || launching) ? (
        <ParentMissionPanel mission={view?.mission ?? null} />
      ) : view?.mission ? (
        <details class="mt-2">
          <summary class="cursor-pointer text-[10.5px] text-[var(--color-text-faint)]">Parent mission execution details</summary>
          <ParentMissionPanel mission={view.mission} />
        </details>
      ) : null}
    </div>
  );
}

export function PropertyIntelligenceHistory({ view }: { view: PropertyIntelligenceView | null }) {
  const rows = view?.history ?? [];
  return (
    <Card title="Property Intelligence run history" right={<Tag tone="border-zinc-500/40 text-zinc-400">{rows.length}</Tag>}>
      {rows.length ? (
        <div data-testid="pi-run-history" class="space-y-1">
          {rows.map((row) => (
            <div key={row.runId} class="flex flex-wrap items-center gap-2 rounded border border-[var(--color-border)] px-2 py-1 text-[11px]">
              <Tag tone={row.isPrimary ? STATUS_TONE.completed : row.status === 'failed' ? STATUS_TONE.failed : STATUS_TONE.partial}>
                {row.isPrimary ? 'current' : row.status.replace(/_/g, ' ')}
              </Tag>
              <span class="font-semibold text-[var(--color-text)]">Run #{row.sequence}</span>
              <span class="font-mono text-[10px] text-[var(--color-text-faint)]">{row.runId}</span>
              <span class="ml-auto text-[10px] text-[var(--color-text-faint)]">
                {row.completedAt ? row.completedAt.slice(0, 19).replace('T', ' ') : `started ${row.startedAt.slice(0, 19).replace('T', ' ')}`}
              </span>
            </div>
          ))}
          <div class="text-[10px] leading-relaxed text-[var(--color-text-faint)]">
            Historical attempts remain audit records. Only the row marked current drives the Deal Card.
          </div>
        </div>
      ) : <Empty text="No Property Intelligence run has been recorded for this Deal Card." />}
    </Card>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────

export function PropertyIntelligenceOverview({ snapshot }: { snapshot: PiSnapshot | null }) {
  if (!snapshot) return <NoSnapshot label="this property" />;
  const { identity, headline, recommendation, valuation } = snapshot;
  const limitations = materialLimitations(snapshot);
  const nextActions = conciseNextActions(snapshot);
  return (
    <div data-testid="pi-overview" class="space-y-3">
      <PreliminaryNotice snapshot={snapshot} />
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
        {/* Provenance: which parent mission produced the snapshot the card is
            reading. Without it, "the Deal Card reads the current snapshot" is a
            claim the operator has to take on trust. */}
        <div data-testid="pi-snapshot-source" class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--color-text-faint)]">
          <span>{snapshot.preliminary ? 'Preliminary assembly' : 'Current snapshot'} · run #{snapshot.sequence}</span>
          {snapshot.missionId && <span class="font-mono">parent mission {snapshot.missionId}</span>}
          <span>{snapshot.preliminary ? 'in-flight partial — never promoted' : snapshot.isPrimary ? 'primary read for this Deal Card' : 'historical attempt — not the current read'}</span>
          {snapshot.completedAt && <span>completed {snapshot.completedAt.slice(0, 19).replace('T', ' ')}</span>}
        </div>
        {snapshot.browserCleanup && (
          <div data-testid="pi-browser-cleanup" class="mt-1 text-[10px] leading-relaxed text-[var(--color-text-faint)]">
            Browser cleanup: {snapshot.browserCleanup.note}
          </div>
        )}
      </Card>

      <Card title="Mission summary">
        <div data-testid="pi-mission-summary" class="text-[11px] leading-relaxed text-[var(--color-text)]">{headline.keyOpportunity}</div>
        {recommendation.preferredStrategy && (
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <Tag tone={APPLICABILITY_TONE.applicable}>{recommendation.preferredStrategy}</Tag>
            <Tag tone={recommendation.posture === 'pursue' ? STATUS_TONE.completed : STATUS_TONE.partial}>{recommendation.posture}</Tag>
            <span class="min-w-0 flex-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">{recommendation.postureWhy}</span>
          </div>
        )}
      </Card>

      <div class="grid gap-3 lg:grid-cols-2">
        <Card title="Risks and limitations">
          {limitations.length ? <Bullets rows={limitations} tone="text-amber-300" /> : <Empty text="No material risk was found in the lanes that ran. Source-specific details remain available in the evidence drill-down." />}
        </Card>
        <Card title="Next action">
          {nextActions.length ? <Bullets rows={nextActions} /> : <Empty text="No material next action is outstanding." />}
        </Card>
      </div>
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
      <PreliminaryNotice snapshot={snapshot} />
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
    return (
      <div class="space-y-2">
        <PreliminaryNotice snapshot={snapshot} />
        <Empty text={snapshot.preliminary
          ? 'No due-diligence lane has settled with a finding yet. Nothing is claimed as screened while the mission runs.'
          : 'No due-diligence lane produced a finding in this run. Nothing is claimed as screened.'} />
      </div>
    );
  }
  return (
    <div data-testid="pi-diligence" class="space-y-2">
      <PreliminaryNotice snapshot={snapshot} />
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
      <PreliminaryNotice snapshot={snapshot} />
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

      {/* THE valuation. This card is the only place on the Deal Card a value is
          asserted, and it is derived from the comps listed directly below it, so
          the page can never show "not priceable" beside a definitive number. */}
      <Card title="Valuation" right={<Tag tone={valuation.priceable ? STATUS_TONE.completed : STATUS_TONE.failed}>{valuation.priceable ? `${valuation.confidence} confidence` : 'not priceable'}</Tag>}>
        {valuation.priceable ? (
          <div class="space-y-2">
            {valuation.workingValue != null && (
              <div class="flex items-baseline gap-2">
                <span class="text-[9px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Working value</span>
                <span data-testid="pi-working-value" class="text-[18px] font-bold text-[var(--color-text)]">{money(valuation.workingValue)}</span>
              </div>
            )}
            <dl class="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
              <Field label="Supported range" value={range(valuation.range)} />
              <Field label="Per acre" value={range(valuation.pricePerAcreRange)} />
              <Field label="Likely retail" value={range(valuation.likelyRetail)} />
              <Field label="Disposition" value={range(valuation.dispositionRange)} />
            </dl>
            <div class="text-[11px] leading-relaxed text-[var(--color-text-muted)]">{valuation.basis}</div>
            {valuation.primaryBasis && (
              <div class="text-[10px] leading-relaxed text-[var(--color-text-faint)]">{valuation.primaryBasis}</div>
            )}
            {valuation.adjustments.length > 0 && (
              <div><div class="text-[9px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Adjustments</div><Bullets rows={valuation.adjustments} /></div>
            )}
            {valuation.uncertainty.length > 0 && (
              <div><div class="text-[9px] font-semibold uppercase tracking-wide text-amber-400">Material limitations</div><Bullets rows={valuation.uncertainty} tone="text-amber-300" /></div>
            )}
            {valuation.materialGaps.length > 0 && (
              <div><div class="text-[9px] font-semibold uppercase tracking-wide text-amber-400">Gaps affecting value</div><Bullets rows={valuation.materialGaps} tone="text-amber-300" /></div>
            )}
          </div>
        ) : (
          <div class="space-y-1.5">
            <div data-testid="pi-not-priceable" class="text-[11px] leading-relaxed text-rose-300">{valuation.notPriceableReason}</div>
            {/* An asking-market indication is still shown when one exists — it is
                explicitly NOT a closed-sale value, and is labelled as such. */}
            {valuation.pricePerAcreRange && (
              <div class="space-y-1 rounded border border-amber-500/30 bg-amber-500/5 p-2">
                <div class="text-[9px] font-semibold uppercase tracking-wide text-amber-400">Asking-market indication only</div>
                <Field label="Asking per acre" value={range(valuation.pricePerAcreRange)} />
                <div class="text-[10px] leading-relaxed text-[var(--color-text-muted)]">{valuation.basis}</div>
              </div>
            )}
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

      {/* Priced rows whose publisher never stated whether they closed. A
          first-class lane, never counted as sold evidence. */}
      {(comps.askingReferences?.length ?? 0) > 0 && (
        <Card title="Asking-market references (status not stated)" right={<Tag tone={STATUS_TONE.partial}>{comps.askingReferences!.length}</Tag>}>
          <div class="mb-1.5 text-[10px] leading-relaxed text-amber-300">
            The source published a price and acreage but never said whether these closed. They are shown as asking-market context and are never counted as sold evidence.
          </div>
          <CompTable rows={comps.askingReferences!} />
        </Card>
      )}

      {comps.landHomeOnly.length > 0 && (
        <Card title="Improved sales (Land-Home Package only)" right={<Tag tone={STATUS_TONE.partial}>{comps.landHomeOnly.length}</Tag>}>
          <div class="mb-1.5 text-[10px] leading-relaxed text-amber-300">
            These improved or manufactured-home sales never establish vacant-land fair market value. They inform the Land-Home Package strategy only.
          </div>
          <CompTable rows={comps.landHomeOnly} />
        </Card>
      )}

      {/* Held-back rows as COUNTS with one reason each. Printing a rejection
          sentence per row is how eighty-nine of them reached the primary view. */}
      {(comps.evidenceBuckets?.length ?? 0) > 0 ? (
        <Card
          title="Rows held back as evidence"
          right={<Tag tone="border-zinc-500/40 text-zinc-400">{comps.evidenceBuckets!.reduce((sum, b) => sum + b.count, 0)}</Tag>}
        >
          <div class="space-y-1.5">
            {comps.evidenceBuckets!.map((bucket, index) => (
              <div key={index} class="flex gap-2 border-b border-[var(--color-border)] pb-1.5 last:border-0 last:pb-0">
                <span class="shrink-0 text-[11px] font-semibold tabular-nums text-[var(--color-text)]">{bucket.count}</span>
                <span class="min-w-0 flex-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                  {bucket.reason}
                  {bucket.sources.length > 0 && (
                    <span class="text-[var(--color-text-faint)]"> ({bucket.sources.join(', ')})</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : comps.rejected.length > 0 && (
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
                {row.apn && <div class="text-[10px] tabular-nums text-[var(--color-text-muted)]">APN {row.apn}</div>}
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
      <PreliminaryNotice snapshot={snapshot} />
      <Card
        title="Operator recommendation"
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
        <dl class="mt-3 grid grid-cols-1 gap-2 border-t border-[var(--color-border)] pt-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Should we pursue it?" value={(recommendation.shouldPursue ?? recommendation.posture).replace(/_/g, ' ')} />
          <Field
            label="What is it worth?"
            value={recommendation.worth
              ? `${money(recommendation.worth.low)}–${money(recommendation.worth.high)} · work from ${money(recommendation.worth.workingValue)}`
              : 'Not established'}
          />
          <Field
            label="What should we try to buy it for?"
            value={recommendation.targetBuyRange
              ? `${money(recommendation.targetBuyRange.low)}–${money(recommendation.targetBuyRange.high)}`
              : 'Not established'}
          />
          <Field label="Best exit" value={recommendation.bestExit ?? recommendation.preferredStrategy ?? 'Not established'} />
          <Field
            label="Is the juice worth the squeeze?"
            value={(recommendation.juiceWorthSqueeze?.answer ?? 'undetermined').replace(/_/g, ' ')}
          />
        </dl>
        {recommendation.targetBuyRange?.basis && (
          <div class="mt-2 text-[10px] leading-relaxed text-[var(--color-text-faint)]">{recommendation.targetBuyRange.basis}</div>
        )}
        {recommendation.juiceWorthSqueeze?.why && (
          <div class="mt-1 text-[11px] leading-relaxed text-[var(--color-text-muted)]">{recommendation.juiceWorthSqueeze.why}</div>
        )}
        {(recommendation.dealKillers?.length ?? 0) > 0 && (
          <div class="mt-2">
            <div class="text-[9px] font-semibold uppercase tracking-wide text-rose-400">What could kill the deal</div>
            <Bullets rows={recommendation.dealKillers!} tone="text-rose-300" />
          </div>
        )}
        {(recommendation.nextConfirmations?.length ?? 0) > 0 && (
          <div class="mt-2">
            <div class="text-[9px] font-semibold uppercase tracking-wide text-amber-400">What must be confirmed next</div>
            <Bullets rows={recommendation.nextConfirmations!} tone="text-amber-300" />
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
      <PreliminaryNotice snapshot={snapshot} />
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
      <PreliminaryNotice snapshot={snapshot} />
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
