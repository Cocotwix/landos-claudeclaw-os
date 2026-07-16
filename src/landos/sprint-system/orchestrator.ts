// LandOS Sprint System — Staged Build Orchestrator.
//
// Enforces the mandatory lifecycle for every major workstream:
// implementation → targeted tests → integration tests → typecheck →
// production build → managed runtime verification → independent browser QA →
// repair loop → browser-QA recheck → workstream acceptance → permission to
// proceed. A long prompt containing several projects is never one indivisible
// implementation phase followed by one final QA phase: only one workstream may
// be in flight, and a later workstream cannot begin while an earlier required
// one is failed, repairing, or unverified.
//
// All functions are pure over the SprintLedger; persistence and process
// execution live in the CLI and the operator-QA runner.

import {
  DEPENDENCY_SATISFIED_STATUSES,
  LIFECYCLE_PHASES,
  type LifecyclePhase,
  type QaFinding,
  type SprintLedger,
  type Workstream,
  type WorkstreamStatus,
  findWorkstream,
  openFindings,
  redactUrl,
  validateLedger,
} from './ledger.js';

const IN_FLIGHT_STATUSES: readonly WorkstreamStatus[] = [
  'implementing',
  'automated_checks_running',
  'awaiting_browser_qa',
  'browser_qa_failed',
  'repairing',
];

function nowIso(now?: () => string): string {
  return (now ?? (() => new Date().toISOString()))();
}

function log(ledger: SprintLedger, event: string, detail?: string, now?: () => string): void {
  ledger.log.push({ at: nowIso(now), event, ...(detail ? { detail } : {}) });
}

// ─────────────────────────────────────────────────────────────────────────
// Starting a workstream
// ─────────────────────────────────────────────────────────────────────────

export function startWorkstreamProblems(ledger: SprintLedger, workstreamId: string): string[] {
  const ws = findWorkstream(ledger, workstreamId);
  const problems: string[] = [];
  if (ws.status !== 'planned') problems.push(`${ws.id} is ${ws.status}, not planned`);
  for (const depId of ws.dependsOn) {
    const dep = findWorkstream(ledger, depId);
    if (!DEPENDENCY_SATISFIED_STATUSES.includes(dep.status)) {
      problems.push(`dependency ${dep.id} is ${dep.status}; it must pass browser QA before ${ws.id} begins`);
    }
    if (openFindings(ledger, dep.id).length) {
      problems.push(`dependency ${dep.id} still has unresolved QA findings`);
    }
  }
  const inFlight = ledger.workstreams.filter((w) => w.id !== ws.id && IN_FLIGHT_STATUSES.includes(w.status));
  for (const other of inFlight) {
    problems.push(`workstream ${other.id} is still ${other.status}; finish its build-and-QA cycle first`);
  }
  return problems;
}

export function startWorkstream(ledger: SprintLedger, workstreamId: string, now?: () => string): void {
  const problems = startWorkstreamProblems(ledger, workstreamId);
  if (problems.length) throw new Error(`cannot start ${workstreamId}: ${problems.join('; ')}`);
  const ws = findWorkstream(ledger, workstreamId);
  ws.status = 'implementing';
  log(ledger, 'workstream_started', workstreamId, now);
}

// ─────────────────────────────────────────────────────────────────────────
// Phase recording with enforced order
// ─────────────────────────────────────────────────────────────────────────

export function latestPhase(ws: Workstream, phase: LifecyclePhase) {
  for (let i = ws.phases.length - 1; i >= 0; i -= 1) {
    if (ws.phases[i].phase === phase) return ws.phases[i];
  }
  return null;
}

function phaseApplies(ws: Workstream, phase: LifecyclePhase): boolean {
  if (phase === 'integration_tests') return ws.applicable.integrationTests;
  if (phase === 'typecheck') return ws.applicable.typecheck;
  if (phase === 'production_build') return ws.applicable.build;
  return true;
}

export function requiredPhasesBefore(ws: Workstream, phase: LifecyclePhase): LifecyclePhase[] {
  const index = LIFECYCLE_PHASES.indexOf(phase);
  if (index < 0) throw new Error(`unknown lifecycle phase ${phase}`);
  return LIFECYCLE_PHASES.slice(0, index).filter((p) => phaseApplies(ws, p) && p !== 'browser_qa_recheck');
}

export function recordPhaseProblems(
  ledger: SprintLedger,
  workstreamId: string,
  phase: LifecyclePhase,
): string[] {
  const ws = findWorkstream(ledger, workstreamId);
  const problems: string[] = [];
  if (ws.status === 'planned') problems.push(`${ws.id} has not been started`);
  if (ws.status === 'accepted' || ws.status === 'browser_qa_passed' || ws.status === 'final_regression_pending') {
    problems.push(`${ws.id} already passed browser QA; reopen requires a new sprint decision`);
  }
  if (!phaseApplies(ws, phase)) problems.push(`${phase} is marked not applicable for ${ws.id}`);
  if (phase === 'browser_qa_recheck' && ws.status !== 'repairing' && ws.status !== 'browser_qa_failed') {
    problems.push(`browser_qa_recheck only applies after a failed browser QA and repairs`);
  }
  if (phase !== 'browser_qa_recheck') {
    for (const required of requiredPhasesBefore(ws, phase)) {
      if (required === 'browser_qa') continue;
      const latest = latestPhase(ws, required);
      if (!latest) problems.push(`${required} has not run for ${ws.id}`);
      else if (latest.status !== 'pass') problems.push(`${required} last failed for ${ws.id}; repair it first`);
    }
  }
  if ((phase === 'browser_qa' || phase === 'browser_qa_recheck') && !latestPhase(ws, 'runtime_verification')) {
    problems.push(`managed runtime verification must run before browser QA for ${ws.id}`);
  }
  return problems;
}

export function recordPhase(
  ledger: SprintLedger,
  workstreamId: string,
  phase: LifecyclePhase,
  result: { status: 'pass' | 'fail'; detail: string; evidenceIds?: string[] },
  now?: () => string,
): void {
  const problems = recordPhaseProblems(ledger, workstreamId, phase);
  if (problems.length) throw new Error(`cannot record ${phase} for ${workstreamId}: ${problems.join('; ')}`);
  const ws = findWorkstream(ledger, workstreamId);
  for (const id of result.evidenceIds ?? []) {
    if (!ledger.evidence.some((e) => e.id === id)) throw new Error(`unknown evidence ${id}`);
  }
  ws.phases.push({
    phase,
    status: result.status,
    at: nowIso(now),
    detail: result.detail,
    evidenceIds: result.evidenceIds ?? [],
  });
  if (phase === 'implementation' && result.status === 'pass') ws.status = 'automated_checks_running';
  if (phase === 'runtime_verification' && result.status === 'pass') ws.status = 'awaiting_browser_qa';
  log(ledger, 'phase_recorded', `${workstreamId}:${phase}:${result.status}`, now);
}

// ─────────────────────────────────────────────────────────────────────────
// Independent browser-QA result intake
// ─────────────────────────────────────────────────────────────────────────

export interface NewFinding {
  requirementId?: string | null;
  liveUrl: string;
  steps: string[];
  expected: string;
  actual: string;
  evidencePaths: string[];
  apiOrDbEvidence?: string | null;
  severity: QaFinding['severity'];
  suspectedSubsystem: string;
  disposition: QaFinding['disposition'];
  externalJustification?: string;
  externalApprovedBy?: string;
  patternKey: string;
}

export function recordBrowserQaResult(
  ledger: SprintLedger,
  workstreamId: string,
  input: {
    result: 'pass' | 'fail';
    reportPath: string;
    evidenceIds: string[];
    findings: NewFinding[];
    recheck?: boolean;
  },
  now?: () => string,
): QaFinding[] {
  const phase: LifecyclePhase = input.recheck ? 'browser_qa_recheck' : 'browser_qa';
  const ws = findWorkstream(ledger, workstreamId);
  if (input.result === 'fail' && input.findings.length === 0) {
    throw new Error('a failing browser QA must include at least one structured finding');
  }
  if (input.result === 'pass' && input.findings.length > 0) {
    throw new Error('a passing browser QA cannot carry new findings; report them as a failure');
  }
  if (input.result === 'pass' && openFindings(ledger, workstreamId).length) {
    throw new Error('browser QA cannot pass while earlier findings are unresolved or awaiting retest');
  }
  recordPhase(
    ledger,
    workstreamId,
    phase,
    { status: input.result, detail: `independent browser QA (${input.reportPath})`, evidenceIds: input.evidenceIds },
    now,
  );
  const created: QaFinding[] = [];
  for (const finding of input.findings) {
    const record: QaFinding = {
      id: `F${ledger.findings.length + 1}`,
      workstreamId,
      requirementId: finding.requirementId ?? null,
      liveUrl: redactUrl(finding.liveUrl),
      steps: finding.steps,
      expected: finding.expected,
      actual: finding.actual,
      evidencePaths: finding.evidencePaths,
      apiOrDbEvidence: finding.apiOrDbEvidence ?? null,
      severity: finding.severity,
      suspectedSubsystem: finding.suspectedSubsystem,
      disposition: finding.disposition,
      ...(finding.externalJustification ? { externalJustification: finding.externalJustification } : {}),
      ...(finding.externalApprovedBy ? { externalApprovedBy: finding.externalApprovedBy } : {}),
      patternKey: finding.patternKey,
      status: 'open',
      openedAt: nowIso(now),
      history: [{ at: nowIso(now), event: 'opened' }],
    };
    ledger.findings.push(record);
    created.push(record);
  }
  ws.browserQaResult = {
    result: input.result,
    at: nowIso(now),
    reportPath: input.reportPath,
    evidenceIds: input.evidenceIds,
  };
  ws.status = input.result === 'pass' ? ws.status : 'browser_qa_failed';
  log(ledger, 'browser_qa_recorded', `${workstreamId}:${input.result}`, now);
  return created;
}

// ─────────────────────────────────────────────────────────────────────────
// Repair loop: QA findings return to the builder; retest is mandatory
// ─────────────────────────────────────────────────────────────────────────

export function findFinding(ledger: SprintLedger, findingId: string): QaFinding {
  const finding = ledger.findings.find((f) => f.id === findingId);
  if (!finding) throw new Error(`unknown finding ${findingId}`);
  return finding;
}

export function beginRepair(ledger: SprintLedger, workstreamId: string, now?: () => string): void {
  const ws = findWorkstream(ledger, workstreamId);
  if (ws.status !== 'browser_qa_failed' && ws.status !== 'repairing') {
    throw new Error(`${workstreamId} is ${ws.status}; repairs only follow a failed browser QA`);
  }
  ws.status = 'repairing';
  log(ledger, 'repair_started', workstreamId, now);
}

export function recordRepair(
  ledger: SprintLedger,
  findingId: string,
  input: { summary: string; regressionCoverage: string },
  now?: () => string,
): void {
  const finding = findFinding(ledger, findingId);
  if (finding.status === 'closed_retested' || finding.status === 'closed_external') {
    throw new Error(`finding ${findingId} is already closed`);
  }
  if (!input.regressionCoverage.trim()) {
    throw new Error(`repair for ${findingId} must name its regression coverage`);
  }
  const ws = findWorkstream(ledger, finding.workstreamId);
  beginRepairIfNeeded(ledger, ws, now);
  finding.status = 'repaired_awaiting_retest';
  finding.history.push({ at: nowIso(now), event: 'repaired', detail: input.summary });
  ws.repairHistory.push({
    findingId,
    repairedAt: nowIso(now),
    summary: input.summary,
    regressionCoverage: input.regressionCoverage,
  });
  log(ledger, 'finding_repaired', findingId, now);
}

function beginRepairIfNeeded(ledger: SprintLedger, ws: Workstream, now?: () => string): void {
  if (ws.status === 'browser_qa_failed') {
    ws.status = 'repairing';
    log(ledger, 'repair_started', ws.id, now);
  }
}

/** The ONLY way a finding closes as fixed: a retest through the same journey. */
export function retestFinding(
  ledger: SprintLedger,
  findingId: string,
  input: { result: 'pass' | 'fail'; evidenceId: string },
  now?: () => string,
): void {
  const finding = findFinding(ledger, findingId);
  if (finding.status !== 'repaired_awaiting_retest') {
    throw new Error(`finding ${findingId} is ${finding.status}; a repair must be recorded before a retest closes it`);
  }
  if (!ledger.evidence.some((e) => e.id === input.evidenceId)) {
    throw new Error(`retest for ${findingId} requires linked evidence`);
  }
  if (input.result === 'pass') {
    finding.status = 'closed_retested';
    finding.history.push({ at: nowIso(now), event: 'retest_passed', detail: input.evidenceId });
  } else {
    finding.status = 'open';
    finding.history.push({ at: nowIso(now), event: 'retest_failed', detail: input.evidenceId });
  }
  log(ledger, 'finding_retested', `${findingId}:${input.result}`, now);
}

export function verifyRequirement(
  ledger: SprintLedger,
  workstreamId: string,
  requirementId: string,
  evidenceIds: string[],
  now?: () => string,
): void {
  const ws = findWorkstream(ledger, workstreamId);
  const req = ws.requirements.find((r) => r.id === requirementId);
  if (!req) throw new Error(`unknown requirement ${requirementId} in ${workstreamId}`);
  if (!evidenceIds.length) throw new Error(`requirement ${requirementId} cannot be verified without evidence`);
  for (const id of evidenceIds) {
    if (!ledger.evidence.some((e) => e.id === id)) throw new Error(`unknown evidence ${id}`);
  }
  req.evidenceIds = [...new Set([...req.evidenceIds, ...evidenceIds])];
  req.verified = true;
  log(ledger, 'requirement_verified', `${workstreamId}/${requirementId}`, now);
}

// ─────────────────────────────────────────────────────────────────────────
// Workstream acceptance gate — the ten refusal conditions
// ─────────────────────────────────────────────────────────────────────────

export interface RecurrenceGateView {
  /** Pattern keys with a triggered, still-unresolved root-cause review. */
  patternsAwaitingRootCause: string[];
}

export function workstreamAcceptanceRefusals(
  ledger: SprintLedger,
  workstreamId: string,
  recurrence?: RecurrenceGateView,
): string[] {
  const ws = findWorkstream(ledger, workstreamId);
  const refusals: string[] = [];
  const requirePass = (phase: LifecyclePhase, label: string) => {
    const latest = latestPhase(ws, phase);
    if (!latest) refusals.push(`${label} has not run`);
    else if (latest.status !== 'pass') refusals.push(`${label} failed`);
  };
  requirePass('targeted_tests', 'targeted tests');
  if (ws.applicable.integrationTests) requirePass('integration_tests', 'integration tests');
  if (ws.applicable.typecheck) requirePass('typecheck', 'typecheck');
  if (ws.applicable.build) requirePass('production_build', 'production build');
  requirePass('runtime_verification', 'managed runtime verification');

  const qa = ws.browserQaResult;
  if (!qa) refusals.push('independent browser QA has not run');
  else if (qa.result !== 'pass') refusals.push('latest independent browser QA did not pass');
  const open = openFindings(ledger, workstreamId);
  if (open.length) {
    refusals.push(`unresolved QA findings: ${open.map((f) => f.id).join(', ')}`);
  }
  const wsEvidence = ledger.evidence.filter((e) => e.workstreamId === workstreamId);
  for (const kind of ws.requiredProofs) {
    if (!wsEvidence.some((e) => e.kind === kind)) refusals.push(`required proof missing: ${kind}`);
  }
  if (ws.persistence.refresh && !wsEvidence.some((e) => e.kind === 'refresh_persistence')) {
    refusals.push('refresh persistence was required but not tested');
  }
  if (ws.persistence.restart && !wsEvidence.some((e) => e.kind === 'restart_persistence')) {
    refusals.push('managed restart persistence was required but not tested');
  }
  for (const finding of ledger.findings.filter((f) => f.workstreamId === workstreamId)) {
    if (finding.disposition === 'external') {
      if (!finding.externalJustification?.trim() || !finding.externalApprovedBy?.trim()
        || finding.externalApprovedBy.trim().toLowerCase() === 'builder') {
        refusals.push(`finding ${finding.id} is labeled external without independent justification; treat it as internally fixable`);
      }
    }
    if (recurrence?.patternsAwaitingRootCause.includes(finding.patternKey)) {
      refusals.push(`failure pattern ${finding.patternKey} recurred; complete its root-cause review first`);
    }
  }
  for (const req of ws.requirements) {
    if (!req.verified) refusals.push(`requirement ${req.id} is unverified`);
    else if (!req.evidenceIds.length) refusals.push(`requirement ${req.id} lacks linked evidence`);
  }
  refusals.push(...validateLedger(ledger).map((p) => `ledger invalid: ${p}`));
  return refusals;
}

export function acceptWorkstream(
  ledger: SprintLedger,
  workstreamId: string,
  recurrence?: RecurrenceGateView,
  now?: () => string,
): void {
  const refusals = workstreamAcceptanceRefusals(ledger, workstreamId, recurrence);
  if (refusals.length) {
    throw new Error(`refusing to accept ${workstreamId}: ${refusals.join('; ')}`);
  }
  const ws = findWorkstream(ledger, workstreamId);
  ws.status = 'browser_qa_passed';
  log(ledger, 'workstream_passed', workstreamId, now);
}

export function markExternallyBlocked(
  ledger: SprintLedger,
  workstreamId: string,
  input: { justification: string; approvedBy: string },
  now?: () => string,
): void {
  if (!input.justification.trim() || !/[a-z]/i.test(input.justification)) {
    throw new Error('an external block requires a justification naming the external system');
  }
  if (!input.approvedBy.trim() || input.approvedBy.trim().toLowerCase() === 'builder') {
    throw new Error('an external block requires non-builder approval (for example Tyler)');
  }
  const ws = findWorkstream(ledger, workstreamId);
  ws.status = 'externally_blocked';
  ws.finalAcceptance = 'externally_blocked';
  log(ledger, 'workstream_externally_blocked', `${workstreamId}: ${input.justification}`, now);
}

// ─────────────────────────────────────────────────────────────────────────
// Sprint-level final regression, final review, completion
// ─────────────────────────────────────────────────────────────────────────

export function finalStageRefusals(ledger: SprintLedger): string[] {
  const refusals: string[] = [];
  for (const ws of ledger.workstreams) {
    if (ws.status !== 'browser_qa_passed' && ws.status !== 'final_regression_pending'
      && ws.status !== 'accepted' && ws.status !== 'externally_blocked') {
      refusals.push(`workstream ${ws.id} is ${ws.status}; every workstream must pass browser QA first`);
    }
  }
  if (openFindings(ledger).length) refusals.push('unresolved findings remain');
  return refusals;
}

export function recordFinalRegression(
  ledger: SprintLedger,
  input: { result: 'pass' | 'fail'; detail: string; evidenceIds: string[] },
  now?: () => string,
): void {
  const refusals = finalStageRefusals(ledger);
  if (refusals.length) throw new Error(`final regression cannot run: ${refusals.join('; ')}`);
  if (!input.evidenceIds.length) throw new Error('final regression requires linked evidence');
  ledger.finalRegression = { result: input.result, at: nowIso(now), detail: input.detail, evidenceIds: input.evidenceIds };
  if (input.result === 'pass') {
    for (const ws of ledger.workstreams) {
      if (ws.status === 'browser_qa_passed') ws.status = 'final_regression_pending';
    }
  }
  log(ledger, 'final_regression', input.result, now);
}

export function recordFinalReview(
  ledger: SprintLedger,
  input: { result: 'pass' | 'fail'; detail: string; evidenceIds: string[]; reviewer: string },
  now?: () => string,
): void {
  if (!ledger.finalRegression || ledger.finalRegression.result !== 'pass') {
    throw new Error('the independent final review requires a passing final combined regression');
  }
  if (!input.reviewer.trim() || input.reviewer.trim().toLowerCase() === 'builder') {
    throw new Error('the final reviewer must be distinct from the builder role');
  }
  if (!input.evidenceIds.length) throw new Error('final review requires linked evidence');
  ledger.finalReview = { result: input.result, at: nowIso(now), detail: `${input.reviewer}: ${input.detail}`, evidenceIds: input.evidenceIds };
  log(ledger, 'final_review', input.result, now);
}

export function completeSprintRefusals(ledger: SprintLedger): string[] {
  const refusals: string[] = [];
  if (!ledger.finalRegression) refusals.push('final combined regression has not run');
  else if (ledger.finalRegression.result !== 'pass') refusals.push('final combined regression failed');
  if (!ledger.finalReview) refusals.push('independent final review has not run');
  else if (ledger.finalReview.result !== 'pass') refusals.push('independent final review failed');
  refusals.push(...finalStageRefusals(ledger));
  return refusals;
}

export function completeSprint(ledger: SprintLedger, now?: () => string): void {
  const refusals = completeSprintRefusals(ledger);
  if (refusals.length) throw new Error(`refusing to complete sprint: ${refusals.join('; ')}`);
  for (const ws of ledger.workstreams) {
    if (ws.status !== 'externally_blocked') {
      ws.status = 'accepted';
      ws.finalAcceptance = 'accepted';
    }
  }
  ledger.sprintStatus = ledger.workstreams.some((ws) => ws.status === 'externally_blocked')
    ? 'externally_blocked'
    : 'complete';
  log(ledger, 'sprint_completed', ledger.sprintStatus, now);
}
