// Lead Workspace presentation model — PURE helpers (no DOM, no fetch) so the
// operator-facing classification and formatting logic is unit-testable under
// the node vitest environment. The LeadWorkspace component stays a thin
// renderer over these.
//
// Honesty taxonomy (system-wide): every value the workspace shows is one of
//   confirmed  — verified fact backed by an authoritative source
//   screening  — automated screening result (public sources; not a verified fact)
//   observed   — inferred/visual observation (never a fact)
//   unavailable— honestly not retrieved / not known
//   unresolved — an open question that blocks work
// Nothing may upgrade itself: fabricating a value for any of these is a defect.

export type RecordValue = Record<string, unknown>;

export const asRecord = (value: unknown): RecordValue =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {};
export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;
export const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

// ── Formatting ────────────────────────────────────────────────────────────

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** "$99,000" or null when the value is honestly unavailable. */
export function fmtMoney(value: unknown): string | null {
  const n = asNumber(value);
  return n === null ? null : money.format(n);
}

/** "$29,494/ac" or null when no normalized price-per-acre exists. */
export function fmtPpa(value: unknown): string | null {
  const n = asNumber(value);
  return n === null ? null : `${money.format(n)}/ac`;
}

/** "1.32 ac" or null. */
export function fmtAcres(value: unknown): string | null {
  const n = asNumber(value);
  return n === null ? null : `${n} ac`;
}

// ── Resolution status chip ────────────────────────────────────────────────

export type Tone = 'good' | 'caution' | 'risk' | 'unknown';

export interface StatusChip {
  label: string;
  tone: Tone;
  detail: string | null;
}

/**
 * The ONE resolution chip derivation: verified / conflict / candidate /
 * unresolved / not-run, in that precedence. A genuine identity conflict
 * outranks everything — the lead is blocked, full stop.
 */
export function resolutionChip(property: RecordValue): StatusChip {
  const resolution = asRecord(property.resolution);
  const conflict = asRecord(resolution.identityConflict);
  if (asString(conflict.requestedApn) || asString(conflict.resolvedApn)) {
    return {
      label: 'BLOCKED - WRONG PARCEL',
      tone: 'risk',
      detail: `Requested APN ${asString(conflict.requestedApn) ?? 'unknown'} but ${asString(conflict.source) ?? 'a parcel-level source'} resolved APN ${asString(conflict.resolvedApn) ?? 'unknown'}.`,
    };
  }
  const stateRaw = (asString(property.resolutionState) ?? '').toLowerCase();
  if (stateRaw.includes('verified')) {
    return { label: 'Verified parcel', tone: 'good', detail: asString(property.resolutionState) };
  }
  const attempted = resolution.attempted === true;
  const state = (asString(resolution.state) ?? stateRaw ?? '').toLowerCase();
  if (state === 'confirmed') return { label: 'Verified parcel', tone: 'good', detail: asString(resolution.basis) };
  if (state === 'candidate') {
    return { label: 'Candidate - not confirmed', tone: 'caution', detail: asString(resolution.basis) };
  }
  if (attempted || state === 'unresolved') {
    return { label: 'Unresolved', tone: 'caution', detail: asString(resolution.basis) };
  }
  return { label: 'Resolution not run', tone: 'unknown', detail: null };
}

// ── Comparable rows ───────────────────────────────────────────────────────

export interface CompRow {
  address: string;
  kind: string;
  acres: string | null;
  price: string | null;
  ppa: string | null;
  providers: string;
  confidence: string | null;
  comparability: string | null;
}

function compRowFrom(raw: unknown): CompRow | null {
  const comp = asRecord(raw);
  const primary = asRecord(comp.primary);
  const address = asString(comp.address);
  if (!address) return null;
  const providersDisplay = asArray(comp.providersDisplay).filter((p): p is string => typeof p === 'string');
  return {
    address,
    kind: asString(primary.kind) ?? 'unknown',
    acres: fmtAcres(comp.acresDisplay ?? comp.acres),
    price: fmtMoney(primary.price),
    ppa: fmtPpa(primary.pricePerAcre),
    providers: providersDisplay.length ? providersDisplay.join(', ') : (asArray(comp.providers).join(', ') || 'unknown source'),
    confidence: asString(comp.sourceConfidence),
    comparability: asString(comp.comparabilityWhy) ?? asString(comp.comparability),
  };
}

/**
 * Top validated comps for the operator, capped PER LANE so validated active
 * listings are always reachable alongside the sold value basis (a sold-first
 * combined cap once hid every active row — QA finding W2-F4). Rows keep
 * honest nulls — a missing normalized price-per-acre renders as unavailable,
 * never invented.
 */
export function topComps(comparables: RecordValue, maxPerLane: number): CompRow[] {
  const sold = asArray(comparables.validatedSold).map(compRowFrom).filter((r): r is CompRow => r !== null);
  const active = asArray(comparables.validatedActive).map(compRowFrom).filter((r): r is CompRow => r !== null);
  return [...sold.slice(0, maxPerLane), ...active.slice(0, maxPerLane)];
}

/** Validated-registry counts line, honest about zero. */
export function compCountsLine(comparables: RecordValue): string {
  const counts = asRecord(comparables.counts);
  const sold = asNumber(counts.validatedSold) ?? asArray(comparables.validatedSold).length;
  const active = asNumber(counts.validatedActive) ?? asArray(comparables.validatedActive).length;
  if (sold === 0 && active === 0) return 'No validated comparable records.';
  return `${sold} validated sold, ${active} validated active (unique registry).`;
}

/** Honest visibility line: exactly how many of the validated records render. */
export function compsShowingLine(comparables: RecordValue, shownRows: number): string {
  const counts = asRecord(comparables.counts);
  const sold = asNumber(counts.validatedSold) ?? asArray(comparables.validatedSold).length;
  const active = asNumber(counts.validatedActive) ?? asArray(comparables.validatedActive).length;
  const total = sold + active;
  if (total <= shownRows) return `Showing all ${total} validated records.`;
  return `Showing ${shownRows} of ${total} validated records (top sold and top active by registry order); the full set stays in the validated registry.`;
}

// ── Readiness records ─────────────────────────────────────────────────────

export interface ReadinessRow {
  key: string;
  label: string;
  stateLabel: string;
  tone: Tone;
  why: string | null;
  blockers: string[];
}

const TONES: Tone[] = ['good', 'caution', 'risk', 'unknown'];

/** Flatten the unified readiness record into displayable rows, order preserved. */
export function readinessRows(readiness: RecordValue): ReadinessRow[] {
  const rows: ReadinessRow[] = [];
  for (const [key, value] of Object.entries(readiness)) {
    const record = asRecord(value);
    const label = asString(record.label);
    if (!label) continue;
    const tone = (asString(record.tone) ?? 'unknown') as Tone;
    rows.push({
      key,
      label,
      stateLabel: asString(record.stateLabel) ?? asString(record.state) ?? 'Unknown',
      tone: TONES.includes(tone) ? tone : 'unknown',
      why: asString(record.why),
      blockers: asArray(record.blockers).filter((b): b is string => typeof b === 'string'),
    });
  }
  return rows;
}

// ── Blockers ──────────────────────────────────────────────────────────────

/** Dedupe blocker lines while preserving order (readiness lanes repeat them). */
export function dedupeLines(lines: unknown): string[] {
  return [...new Set(asArray(lines).filter((b): b is string => typeof b === 'string' && b.trim().length > 0))];
}

// ── Acreage basis rows ────────────────────────────────────────────────────

export interface AcreageEntryRow {
  kind: string;
  value: string;
  source: string;
  confidence: string | null;
  disputed: boolean;
  limitation: string | null;
}

export function acreageEntries(basis: RecordValue): AcreageEntryRow[] {
  return asArray(basis.entries)
    .map((raw) => {
      const entry = asRecord(raw);
      const kind = asString(entry.kind);
      if (!kind) return null;
      return {
        kind,
        value: fmtAcres(entry.value) ?? 'Unavailable',
        source: asString(entry.source) ?? 'Unknown source',
        confidence: asString(entry.confidence),
        disputed: entry.disputed === true,
        limitation: asString(entry.limitation),
      };
    })
    .filter((r): r is AcreageEntryRow => r !== null);
}

// ── Strategy rows ─────────────────────────────────────────────────────────

export interface StrategyRow {
  strategy: string;
  status: string;
  tone: Tone;
  why: string | null;
  blockers: string[];
  requiredEvidence: string[];
}

const STRATEGY_TONES: Record<string, Tone> = {
  viable: 'good',
  provisional: 'caution',
  weak: 'caution',
  blocked: 'caution',
  not_viable: 'risk',
};

export function strategyRows(entries: unknown): StrategyRow[] {
  return asArray(entries)
    .map((raw) => {
      const entry = asRecord(raw);
      const strategy = asString(entry.strategy);
      if (!strategy) return null;
      const status = asString(entry.status) ?? 'unknown';
      return {
        strategy,
        status,
        tone: STRATEGY_TONES[status] ?? 'unknown',
        why: asString(entry.why),
        blockers: dedupeLines(entry.blockers),
        requiredEvidence: dedupeLines(entry.requiredEvidence),
      };
    })
    .filter((r): r is StrategyRow => r !== null);
}
