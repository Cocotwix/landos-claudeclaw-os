// LandOS — the governed seam between an intelligence product and the
// capability layer.
//
// The intelligence layer decides WHAT QUESTION MATTERS: a persisted specialist
// product already carries the material conflicts it could not reconcile, each
// with the one bounded verification the analyst recommended. LandOS decides
// HOW that question is safely investigated: this module turns an unresolved
// material conflict into a STRUCTURED CAPABILITY REQUEST, validates it against
// a deny-by-default allowlist, executes the one existing governed capability at
// most once, performs one targeted re-read of the affected layer, reconciles
// the conclusion, and STOPS.
//
// The loop is bounded structurally, not aspirationally: the orchestrator has
// no loop construct — one optional capability invocation, one optional re-read,
// then a persisted record. Remaining uncertainty is persisted as unresolved
// with the recommended next action; it is never chased automatically. A refused
// request is refused with its reason on the record — never substituted with an
// uncontrolled search.
//
// Nothing here runs on a page load. The single entry point is invoked only by
// an explicit operator action, and every read path is a SELECT.

import type { CapabilityInvocationRequest, CapabilityResult } from './capability-contract.js';
import type { PropertyIntelligenceProduct } from './intelligence-stack-contract.js';

export const INTELLIGENCE_RECONCILIATION_SNAPSHOT_TYPE = 'intelligence_reconciliation_v1';
export const INTELLIGENCE_RECONCILIATION_VERSION = '1.0.0';

/** Official evidence older than this no longer suppresses a rerun. */
export const FRESH_EVIDENCE_DAYS = 45;

// ── The structured request contract ────────────────────────────────────────

export type IntelligenceIssueType =
  | 'current_improvement_conflict'
  | 'acreage_conflict'
  | 'ownership_conflict';

export interface IntelligenceCapabilityRequest {
  contractVersion: typeof INTELLIGENCE_RECONCILIATION_VERSION;
  intelligenceLayer: 'property';
  dealCardId: number;
  issueType: IntelligenceIssueType;
  /** The material question, in the intelligence product's own words. */
  question: string;
  requestedCapability: string;
  /** Why this matters — the conflict statement carrying both sides. */
  reasonMaterial: string;
  /** The persisted conflict subjects this request was derived from. */
  evidenceConflictRefs: string[];
  expectedResolution: string;
}

// ── Allowlist / governance ─────────────────────────────────────────────────

/**
 * Deny by default: an intelligence layer may request only the capabilities
 * listed for its issue type. Everything else is refused with a reason, and a
 * refusal is never substituted with another search path.
 */
export const INTELLIGENCE_CAPABILITY_ALLOWLIST: Record<
  'property',
  Record<IntelligenceIssueType, string[]>
> = {
  property: {
    // The current official assessor / property record is the bounded first
    // resolution rung for all three: improvement status, recorded acreage and
    // owner of record are exactly what that record states.
    current_improvement_conflict: ['assessor-tax'],
    acreage_conflict: ['assessor-tax'],
    ownership_conflict: ['assessor-tax'],
  },
};

// ── Deriving the request from the persisted product ────────────────────────

interface PersistedConflict {
  subject: string;
  statement: string;
  resolution: string;
}

const conflictIsOpen = (conflict: PersistedConflict): boolean =>
  /unresolved|recommended verification/i.test(conflict.resolution ?? '')
  || !conflict.resolution;

function classifyIssue(conflict: PersistedConflict): IntelligenceIssueType | null {
  const haystack = `${conflict.subject} ${conflict.statement}`;
  if (/improvement|structure|dwelling|building|manufactured home/i.test(haystack)) {
    return 'current_improvement_conflict';
  }
  if (/acreage|acres differ|parcel area/i.test(haystack)) return 'acreage_conflict';
  if (/owner(?:ship)? (?:conflict|differ|discrepan|mismatch)/i.test(haystack)) return 'ownership_conflict';
  return null;
}

const EXPECTED_RESOLUTION: Record<IntelligenceIssueType, string> = {
  current_improvement_conflict: 'Current official assessor improvement status for the subject parcel.',
  acreage_conflict: 'Current official assessed acreage for the subject parcel. Conflicting acreages are never averaged and a marketplace value is never arbitrarily chosen.',
  ownership_conflict: 'Current owner of record from the official assessor record.',
};

/**
 * Every capability request the persisted Property Intelligence product
 * supports right now. Derived deterministically from the product's own
 * unresolved material conflicts — the analyst identified the question and the
 * bounded verification; this only gives that identification the structured
 * shape LandOS validates.
 */
export function derivePropertyCapabilityRequests(
  product: Pick<PropertyIntelligenceProduct, 'conflicts'>,
  dealCardId: number,
): IntelligenceCapabilityRequest[] {
  const requests: IntelligenceCapabilityRequest[] = [];
  for (const conflict of product.conflicts ?? []) {
    if (!conflict?.subject || !conflictIsOpen(conflict)) continue;
    const issueType = classifyIssue(conflict);
    if (!issueType) continue;
    const allowed = INTELLIGENCE_CAPABILITY_ALLOWLIST.property[issueType];
    if (!allowed?.length) continue;
    const verification = /Recommended verification:\s*([^]*)$/i.exec(conflict.resolution ?? '')?.[1]?.trim();
    requests.push({
      contractVersion: INTELLIGENCE_RECONCILIATION_VERSION,
      intelligenceLayer: 'property',
      dealCardId,
      issueType,
      question: verification || `Resolve the unresolved ${conflict.subject} conflict against the current official property record.`,
      requestedCapability: allowed[0],
      reasonMaterial: conflict.statement,
      evidenceConflictRefs: [conflict.subject],
      expectedResolution: EXPECTED_RESOLUTION[issueType],
    });
  }
  return requests;
}

// ── Validation ─────────────────────────────────────────────────────────────

export interface CapabilityRequestValidationContext {
  /** The deal this reconciliation run is explicitly scoped to. */
  dealCardId: number;
  /** Subjects of the unresolved conflicts the CURRENT persisted product carries. */
  openConflictSubjects: string[];
  /** Registry membership — production wires `runtimeCapability(id) != null`. */
  capabilityExists: (capabilityId: string) => boolean;
  /** The latest persisted result of this capability for this deal's subject. */
  latestResult: (capabilityId: string) => CapabilityResult | null;
  now?: () => Date;
}

export type CapabilityRequestValidation =
  | { ok: true; decision: 'execute'; mode: 'refresh' }
  | { ok: true; decision: 'reuse_evidence'; existingInvocationId: string }
  | { ok: false; decision: 'refused'; refusalReason: string };

/** Does an existing result actually answer an official-record question? */
export function resultAnswersOfficially(result: CapabilityResult | null): boolean {
  if (!result || result.status !== 'SUCCEEDED') return false;
  return (result.facts as { recordStatus?: unknown }).recordStatus === 'official_record_retrieved';
}

export function validateIntelligenceCapabilityRequest(
  request: IntelligenceCapabilityRequest,
  ctx: CapabilityRequestValidationContext,
): CapabilityRequestValidation {
  const refuse = (refusalReason: string): CapabilityRequestValidation =>
    ({ ok: false, decision: 'refused', refusalReason });

  // 1. Deal identity: a request is always scoped to the deal the operator
  //    acted on. Deal A can never invoke against Deal B.
  if (!Number.isInteger(request.dealCardId) || request.dealCardId < 1) {
    return refuse('The capability request carries no valid deal identity.');
  }
  if (request.dealCardId !== ctx.dealCardId) {
    return refuse(`The capability request is scoped to deal ${request.dealCardId}, but this reconciliation run is for deal ${ctx.dealCardId}. Cross-deal invocation is refused.`);
  }

  // 2. The requested capability must exist in the registry.
  if (!ctx.capabilityExists(request.requestedCapability)) {
    return refuse(`"${request.requestedCapability}" is not a registered LandOS capability.`);
  }

  // 3. Deny-by-default allowlist for this layer and issue.
  const allowed = INTELLIGENCE_CAPABILITY_ALLOWLIST[request.intelligenceLayer]?.[request.issueType] ?? [];
  if (!allowed.includes(request.requestedCapability)) {
    return refuse(`"${request.requestedCapability}" is not allowlisted for ${request.intelligenceLayer} intelligence issue "${request.issueType}". Allowed: ${allowed.join(', ') || 'none'}.`);
  }

  // 4. Material relevance: the request must trace to a persisted unresolved
  //    conflict on the current product, not to a free-floating curiosity.
  const refs = request.evidenceConflictRefs.filter((ref) => !!ref?.trim());
  const open = ctx.openConflictSubjects.map((subject) => subject.toLowerCase());
  if (!refs.length || !refs.some((ref) => open.includes(ref.toLowerCase()))) {
    return refuse('The request does not reference an unresolved material conflict on the current intelligence product, so it is not materially relevant.');
  }

  // 5. Freshness: sufficiently fresh official evidence suppresses a rerun.
  //    The intelligence layer never re-asks a question because it dislikes the
  //    retained answer.
  const latest = ctx.latestResult(request.requestedCapability);
  if (resultAnswersOfficially(latest)) {
    const completedAt = Date.parse(latest!.timestamps.completedAt);
    const ageMs = (ctx.now?.() ?? new Date()).getTime() - completedAt;
    if (Number.isFinite(completedAt) && ageMs <= FRESH_EVIDENCE_DAYS * 86_400_000) {
      return { ok: true, decision: 'reuse_evidence', existingInvocationId: latest!.invocationId };
    }
  }

  return { ok: true, decision: 'execute', mode: 'refresh' };
}

// ── The persisted reconciliation record ────────────────────────────────────

export type ReconciliationStatus = 'resolved' | 'partially_resolved' | 'unresolved' | 'refused' | 'no_material_request';

export interface IntelligenceReconciliationRecord {
  contractVersion: typeof INTELLIGENCE_RECONCILIATION_VERSION;
  dealCardId: number;
  trigger: 'operator_reconcile';
  startedAt: string;
  completedAt: string;
  request: IntelligenceCapabilityRequest | null;
  validation: {
    decision: 'execute' | 'reuse_evidence' | 'refused' | 'no_material_request';
    refusalReason: string | null;
  };
  execution: {
    /** Hard bound: this run's capability executions. Never above 1. */
    executionCount: number;
    capabilityId: string | null;
    invocationId: string | null;
    reusedExistingEvidence: boolean;
    status: string | null;
    recordStatus: string | null;
    summary: string | null;
    /** Provenance of what actually returned, verbatim from the ledger. */
    evidence: Array<{ source: string; sourceUrl: string | null; retrievedAt: string }>;
    attemptNote: string | null;
  };
  reread: {
    /** Hard bound: targeted re-reads after evidence returned. Never above 1. */
    rereadCount: number;
    layers: string[];
    outcome: string | null;
  };
  /** OLD EVIDENCE and CURRENT CONCLUSION, side by side. Provenance survives:
   *  the superseded product history and the capability ledger retain the rest. */
  before: { conflictStatement: string | null; conflictResolution: string | null; read: string | null };
  after: { conflictStatement: string | null; conflictResolution: string | null; read: string | null };
  status: ReconciliationStatus;
  statusReason: string;
  /** Research-readiness semantics: green = usable answer; yellow = a proper
   *  bounded attempt completed but the question stays unresolved/partial. A
   *  completed bounded attempt is never recorded red. */
  readiness: 'green' | 'yellow';
  recommendedNextAction: string | null;
}

// ── The bounded orchestrator ───────────────────────────────────────────────

export interface ReconciliationDeps {
  readPropertyProduct: () => Pick<PropertyIntelligenceProduct, 'conflicts' | 'read'> | null;
  validate: (request: IntelligenceCapabilityRequest, openConflictSubjects: string[]) => CapabilityRequestValidation;
  invokeCapability: (request: IntelligenceCapabilityRequest) => Promise<CapabilityResult>;
  /** The targeted re-read: refresh ONLY the requesting layer (the stack's own
   *  dependency rule may fold the dependent deal synthesis into the same
   *  single pass; market and seller are never re-run here). */
  rereadIntelligence: () => Promise<{ outcome: string; refreshedLayers: string[] }>;
  persistRecord: (record: IntelligenceReconciliationRecord) => void;
  now?: () => Date;
}

const matchingConflict = (
  product: Pick<PropertyIntelligenceProduct, 'conflicts'> | null,
  refs: string[],
): PersistedConflict | null => {
  const wanted = refs.map((ref) => ref.toLowerCase());
  return (product?.conflicts ?? []).find((conflict) =>
    wanted.includes((conflict.subject ?? '').toLowerCase())) ?? null;
};

/**
 * One bounded reconciliation run for one deal:
 *
 *   material conflict → structured request → validation → at most ONE
 *   capability execution → at most ONE targeted re-read → reconciled record →
 *   STOP.
 *
 * There is no loop in this function on purpose. If the re-read still finds
 * uncertainty, the record says so with the recommended next action, and
 * nothing chases it.
 */
export async function runIntelligenceReconciliation(
  input: { dealCardId: number; conflictSubject?: string | null },
  deps: ReconciliationDeps,
): Promise<IntelligenceReconciliationRecord> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now().toISOString();

  const base = (): IntelligenceReconciliationRecord => ({
    contractVersion: INTELLIGENCE_RECONCILIATION_VERSION,
    dealCardId: input.dealCardId,
    trigger: 'operator_reconcile',
    startedAt,
    completedAt: now().toISOString(),
    request: null,
    validation: { decision: 'no_material_request', refusalReason: null },
    execution: {
      executionCount: 0,
      capabilityId: null,
      invocationId: null,
      reusedExistingEvidence: false,
      status: null,
      recordStatus: null,
      summary: null,
      evidence: [],
      attemptNote: null,
    },
    reread: { rereadCount: 0, layers: [], outcome: null },
    before: { conflictStatement: null, conflictResolution: null, read: null },
    after: { conflictStatement: null, conflictResolution: null, read: null },
    status: 'no_material_request',
    statusReason: 'The current Property Intelligence product carries no unresolved material conflict this seam supports.',
    readiness: 'yellow',
    recommendedNextAction: null,
  });

  const finish = (record: IntelligenceReconciliationRecord): IntelligenceReconciliationRecord => {
    record.completedAt = now().toISOString();
    deps.persistRecord(record);
    return record;
  };

  const before = deps.readPropertyProduct();
  const record = base();
  if (!before) {
    record.statusReason = 'No Property Intelligence product has been produced for this deal yet, so there is no conclusion to reconcile.';
    return finish(record);
  }

  const candidates = derivePropertyCapabilityRequests(before, input.dealCardId);
  const request = input.conflictSubject
    ? candidates.find((candidate) =>
      candidate.evidenceConflictRefs.some((ref) => ref.toLowerCase() === input.conflictSubject!.toLowerCase())) ?? null
    : candidates[0] ?? null;
  if (!request) return finish(record);

  record.request = request;
  const beforeConflict = matchingConflict(before, request.evidenceConflictRefs);
  record.before = {
    conflictStatement: beforeConflict?.statement ?? null,
    conflictResolution: beforeConflict?.resolution ?? null,
    read: before.read ?? null,
  };

  const openSubjects = (before.conflicts ?? [])
    .filter((conflict) => conflictIsOpen(conflict))
    .map((conflict) => conflict.subject);
  const validation = deps.validate(request, openSubjects);

  if (!validation.ok) {
    record.validation = { decision: 'refused', refusalReason: validation.refusalReason };
    record.status = 'refused';
    record.statusReason = `The capability request was refused: ${validation.refusalReason} No substitute research was run.`;
    record.readiness = 'yellow';
    record.recommendedNextAction = 'Review the refusal reason; the conflict remains recorded on the Property Intelligence product.';
    return finish(record);
  }

  record.validation = { decision: validation.decision, refusalReason: null };
  record.execution.capabilityId = request.requestedCapability;

  // ── At most ONE capability execution ─────────────────────────────────────
  let result: CapabilityResult | null = null;
  let executionFailure: string | null = null;
  if (validation.decision === 'execute') {
    try {
      result = await deps.invokeCapability(request);
      record.execution.executionCount = 1;
      record.execution.invocationId = result.invocationId;
      record.execution.status = result.status;
      record.execution.recordStatus = String((result.facts as { recordStatus?: unknown }).recordStatus ?? '') || null;
      record.execution.summary = typeof (result.facts as { summary?: unknown }).summary === 'string'
        ? (result.facts as { summary: string }).summary
        : null;
      record.execution.evidence = (result.evidence ?? []).slice(0, 6).map((item) => ({
        source: item.source,
        sourceUrl: item.sourceUrl ?? null,
        retrievedAt: item.retrievedAt,
      }));
      record.execution.attemptNote = result.warnings[0] ?? null;
    } catch (error) {
      record.execution.executionCount = 1;
      executionFailure = error instanceof Error ? error.message : String(error);
      record.execution.status = 'FAILED';
      record.execution.attemptNote = executionFailure;
    }
  } else {
    record.execution.reusedExistingEvidence = true;
    record.execution.invocationId = validation.existingInvocationId;
    record.execution.summary = 'Sufficiently fresh official evidence already answers this question; the capability was not re-run.';
  }

  // ── At most ONE targeted re-read ─────────────────────────────────────────
  try {
    const reread = await deps.rereadIntelligence();
    record.reread = { rereadCount: 1, layers: reread.refreshedLayers, outcome: reread.outcome };
  } catch (error) {
    record.reread = {
      rereadCount: 1,
      layers: [],
      outcome: `failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // ── Reconcile honestly, then STOP ────────────────────────────────────────
  const after = deps.readPropertyProduct();
  const afterConflict = matchingConflict(after, request.evidenceConflictRefs);
  record.after = {
    conflictStatement: afterConflict?.statement ?? null,
    conflictResolution: afterConflict?.resolution ?? null,
    read: after?.read ?? null,
  };

  const officialAnswer = record.execution.reusedExistingEvidence
    || (result != null && resultAnswersOfficially(result));
  const rereadOk = record.reread.outcome === 'produced' || record.reread.outcome === 'reused';

  if (officialAnswer && rereadOk && !afterConflict) {
    record.status = 'resolved';
    record.statusReason = 'The official record answered the question and the reconciled Property Intelligence read no longer carries this conflict. The prior evidence remains retained in the superseded product history and the capability ledger.';
    record.readiness = 'green';
  } else if (officialAnswer && rereadOk) {
    record.status = 'partially_resolved';
    record.statusReason = 'Official evidence was obtained and the Property Intelligence read was reconciled, but the conflict is not fully settled. Both sides of the evidence remain retained.';
    record.readiness = 'yellow';
    record.recommendedNextAction = afterConflict?.resolution ?? null;
  } else {
    record.status = 'unresolved';
    record.statusReason = executionFailure
      ? `The bounded capability attempt failed (${executionFailure.split('\n')[0]}). The conflict remains honestly unresolved; no substitute research was run.`
      : !officialAnswer
        ? 'The bounded official-record attempt completed without retrieving a current official record, so the conflict remains honestly unresolved. Absence of a record is never treated as proof either way.'
        : 'The targeted re-read did not complete, so the prior conclusion stands unreconciled.';
    record.readiness = 'yellow';
    record.recommendedNextAction = afterConflict?.resolution
      ?? beforeConflict?.resolution
      ?? 'Confirm the disputed fact through seller discovery or a site inspection.';
  }

  return finish(record);
}

/** Build the envelope the runtime capability registry actually executes. */
export function capabilityInvocationFor(
  request: IntelligenceCapabilityRequest,
  subject: { entity: 'LAND_ALLY' | 'TY_LAND_BIZ'; propertyCardId: number },
): CapabilityInvocationRequest {
  return {
    capabilityId: request.requestedCapability,
    caller: { type: 'deal_card', ref: `deal:${request.dealCardId}:intelligence-reconcile` },
    subject: {
      kind: 'canonical_property',
      entity: subject.entity,
      propertyCardId: subject.propertyCardId,
      dealCardId: request.dealCardId,
    },
    mode: 'refresh',
    context: {
      surface: 'intelligence_reconciliation',
      intelligenceLayer: request.intelligenceLayer,
      issueType: request.issueType,
      dealCardId: request.dealCardId,
    },
  };
}
