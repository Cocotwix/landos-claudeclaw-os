// LandOS Sprint System — Requirement Ledger.
//
// Every substantial LandOS sprint starts by converting the operator's prompt
// into explicit workstreams with machine-checkable acceptance requirements.
// The ledger is the shared structured record that the staged orchestrator,
// the independent browser-QA role, the repair loop, and the final reviewer
// all read and write. Sprint reports are generated FROM ledger evidence,
// never from a builder's narrative memory.
//
// Storage: .landos/sprints/<sprintId>/ledger.json (structured data, tracked)
//          .landos/sprints/<sprintId>/report.md   (rendered operator report)
//          .landos/sprints/current.json           (active sprint pointer)
// Binary proof artifacts (screenshots, browser output) belong under
// .runtime/landos/qa/ and are referenced from the ledger by path only.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const SPRINTS_DIR = path.join('.landos', 'sprints');
export const CURRENT_POINTER = path.join(SPRINTS_DIR, 'current.json');

// ─────────────────────────────────────────────────────────────────────────
// Statuses and phases
// ─────────────────────────────────────────────────────────────────────────

export const WORKSTREAM_STATUSES = [
  'planned',
  'implementing',
  'automated_checks_running',
  'awaiting_browser_qa',
  'browser_qa_failed',
  'repairing',
  'browser_qa_passed',
  'final_regression_pending',
  'accepted',
  'externally_blocked',
] as const;
export type WorkstreamStatus = (typeof WORKSTREAM_STATUSES)[number];

/** Statuses of an earlier workstream that allow a dependent one to begin. */
export const DEPENDENCY_SATISFIED_STATUSES: readonly WorkstreamStatus[] = [
  'browser_qa_passed',
  'final_regression_pending',
  'accepted',
];

export const LIFECYCLE_PHASES = [
  'implementation',
  'targeted_tests',
  'integration_tests',
  'typecheck',
  'production_build',
  'runtime_verification',
  'browser_qa',
  'browser_qa_recheck',
] as const;
export type LifecyclePhase = (typeof LIFECYCLE_PHASES)[number];

export const EVIDENCE_KINDS = [
  'test_result',
  'api_evidence',
  'db_evidence',
  'live_url',
  'screenshot',
  'browser_journey',
  'refresh_persistence',
  'restart_persistence',
  'independent_browser_qa',
  'final_regression',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

// ─────────────────────────────────────────────────────────────────────────
// Records
// ─────────────────────────────────────────────────────────────────────────

export interface Evidence {
  id: string;
  kind: EvidenceKind;
  /** Human summary, e.g. "vitest sprint-system 42 passed". Never a narrative claim. */
  summary: string;
  /** Repo-relative or absolute artifact path (screenshot, report, log excerpt). */
  path?: string;
  /** Exact live URL (token query params must be redacted before storing). */
  url?: string;
  recordedAt: string;
  workstreamId?: string;
}

export interface Requirement {
  id: string;
  text: string;
  verified: boolean;
  evidenceIds: string[];
}

export interface PhaseRecord {
  phase: LifecyclePhase;
  status: 'pass' | 'fail';
  at: string;
  detail: string;
  evidenceIds: string[];
}

export type FindingStatus =
  | 'open'
  | 'repaired_awaiting_retest'
  | 'closed_retested'
  | 'closed_external';

export interface QaFinding {
  id: string;
  workstreamId: string;
  /** Requirement violated (ledger requirement id) or null for emergent defects. */
  requirementId: string | null;
  liveUrl: string;
  /** Exact operator reproduction steps. */
  steps: string[];
  expected: string;
  actual: string;
  /** Screenshot / evidence artifact paths. */
  evidencePaths: string[];
  apiOrDbEvidence: string | null;
  severity: 'blocker' | 'major' | 'minor';
  suspectedSubsystem: string;
  disposition: 'internally_fixable' | 'external';
  /** Required when disposition is external: must name the external system. */
  externalJustification?: string;
  /** External classification requires explicit non-builder approval. */
  externalApprovedBy?: string;
  /** Stable failure-pattern key for the recurrence gate (kebab-case). */
  patternKey: string;
  status: FindingStatus;
  openedAt: string;
  history: { at: string; event: string; detail?: string }[];
}

export interface Workstream {
  id: string;
  name: string;
  operatorOutcome: string;
  inScope: string[];
  backendServices: string[];
  frontendScreens: string[];
  requiredDataState: string;
  browserJourney: { journeyId?: string; steps: string[] };
  testRequirements: string[];
  persistence: { refresh: boolean; restart: boolean };
  failureConditions: string[];
  requiredProofs: EvidenceKind[];
  dependsOn: string[];
  /** Which optional lifecycle phases apply to this workstream. */
  applicable: { integrationTests: boolean; typecheck: boolean; build: boolean };
  status: WorkstreamStatus;
  builderResult: string | null;
  browserQaResult: {
    result: 'pass' | 'fail';
    at: string;
    reportPath: string;
    evidenceIds: string[];
  } | null;
  repairHistory: {
    findingId: string;
    repairedAt: string;
    summary: string;
    regressionCoverage: string;
  }[];
  independentReviewResult: { result: 'pass' | 'fail'; at: string; notes: string } | null;
  finalAcceptance: 'pending' | 'accepted' | 'externally_blocked';
  requirements: Requirement[];
  phases: PhaseRecord[];
}

export interface StageResult {
  result: 'pass' | 'fail';
  at: string;
  detail: string;
  evidenceIds: string[];
}

export interface SprintLedger {
  schema: 1;
  sprintId: string;
  title: string;
  createdAt: string;
  /** The operator's prompt preserved verbatim — decomposition must not narrow it. */
  originalPrompt: string;
  promptSha256: string;
  workstreams: Workstream[];
  findings: QaFinding[];
  evidence: Evidence[];
  finalRegression: StageResult | null;
  finalReview: StageResult | null;
  sprintStatus: 'active' | 'complete' | 'externally_blocked';
  log: { at: string; event: string; detail?: string }[];
}

// ─────────────────────────────────────────────────────────────────────────
// Construction
// ─────────────────────────────────────────────────────────────────────────

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface WorkstreamSpec {
  id: string;
  name: string;
  operatorOutcome: string;
  inScope: string[];
  backendServices: string[];
  frontendScreens: string[];
  requiredDataState: string;
  browserJourney: { journeyId?: string; steps: string[] };
  testRequirements: string[];
  persistence: { refresh: boolean; restart: boolean };
  failureConditions: string[];
  requiredProofs: EvidenceKind[];
  dependsOn: string[];
  requirements: { id: string; text: string }[];
  applicable?: { integrationTests: boolean; typecheck: boolean; build: boolean };
}

export function createSprint(input: {
  sprintId: string;
  title: string;
  originalPrompt: string;
  workstreams: WorkstreamSpec[];
  now?: () => string;
}): SprintLedger {
  const now = input.now ?? (() => new Date().toISOString());
  if (!input.originalPrompt.trim()) throw new Error('originalPrompt is required and preserved verbatim');
  if (!input.workstreams.length) throw new Error('at least one workstream is required');
  const ledger: SprintLedger = {
    schema: 1,
    sprintId: input.sprintId,
    title: input.title,
    createdAt: now(),
    originalPrompt: input.originalPrompt,
    promptSha256: sha256(input.originalPrompt),
    workstreams: input.workstreams.map((spec) => ({
      ...spec,
      applicable: spec.applicable ?? { integrationTests: true, typecheck: true, build: true },
      status: 'planned' as WorkstreamStatus,
      builderResult: null,
      browserQaResult: null,
      repairHistory: [],
      independentReviewResult: null,
      finalAcceptance: 'pending' as const,
      requirements: spec.requirements.map((r) => ({ ...r, verified: false, evidenceIds: [] })),
      phases: [],
    })),
    findings: [],
    evidence: [],
    finalRegression: null,
    finalReview: null,
    sprintStatus: 'active',
    log: [{ at: now(), event: 'sprint_created', detail: input.title }],
  };
  const problems = validateLedger(ledger);
  if (problems.length) throw new Error(`invalid sprint plan: ${problems.join('; ')}`);
  return ledger;
}

// ─────────────────────────────────────────────────────────────────────────
// Persistence (atomic writes; screenshots stay OUT of the ledger)
// ─────────────────────────────────────────────────────────────────────────

export function ledgerPath(root: string, sprintId: string): string {
  return path.join(root, SPRINTS_DIR, sprintId, 'ledger.json');
}
export function reportPath(root: string, sprintId: string): string {
  return path.join(root, SPRINTS_DIR, sprintId, 'report.md');
}

export function saveLedger(root: string, ledger: SprintLedger): string {
  const file = ledgerPath(root, ledger.sprintId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

export function loadLedger(root: string, sprintId: string): SprintLedger {
  const file = ledgerPath(root, sprintId);
  const ledger = JSON.parse(fs.readFileSync(file, 'utf8')) as SprintLedger;
  if (ledger.schema !== 1) throw new Error(`unsupported ledger schema in ${file}`);
  return ledger;
}

export function setCurrentSprint(root: string, sprintId: string): void {
  const file = path.join(root, CURRENT_POINTER);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ schema: 1, sprintId }, null, 2)}\n`, 'utf8');
}

export function getCurrentSprintId(root: string): string | null {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(root, CURRENT_POINTER), 'utf8'));
    return typeof value?.sprintId === 'string' ? value.sprintId : null;
  } catch {
    return null;
  }
}

export function findWorkstream(ledger: SprintLedger, workstreamId: string): Workstream {
  const ws = ledger.workstreams.find((w) => w.id === workstreamId);
  if (!ws) throw new Error(`unknown workstream ${workstreamId} in sprint ${ledger.sprintId}`);
  return ws;
}

export function addEvidence(
  ledger: SprintLedger,
  evidence: Omit<Evidence, 'id' | 'recordedAt'> & { id?: string },
  now: () => string = () => new Date().toISOString(),
): Evidence {
  const record: Evidence = {
    id: evidence.id ?? `E${ledger.evidence.length + 1}`,
    recordedAt: now(),
    ...evidence,
  };
  if (record.url) record.url = redactUrl(record.url);
  if (ledger.evidence.some((e) => e.id === record.id)) throw new Error(`duplicate evidence id ${record.id}`);
  ledger.evidence.push(record);
  return record;
}

/** Strip credential-bearing query parameters so tokenized URLs never persist. */
export function redactUrl(url: string): string {
  return url.replace(
    /([?&])(token|jwt|key|apikey|api_key|auth|signature|sig|access_token)=[^\s&"')]+/gi,
    '$1$2=REDACTED',
  );
}

export function openFindings(ledger: SprintLedger, workstreamId?: string): QaFinding[] {
  return ledger.findings.filter(
    (f) =>
      (f.status === 'open' || f.status === 'repaired_awaiting_retest') &&
      (!workstreamId || f.workstreamId === workstreamId),
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────

const REQUIRED_WS_TEXT_FIELDS: (keyof WorkstreamSpec)[] = [
  'id',
  'name',
  'operatorOutcome',
  'requiredDataState',
];
const REQUIRED_WS_LIST_FIELDS: (keyof WorkstreamSpec)[] = [
  'inScope',
  'testRequirements',
  'failureConditions',
  'requiredProofs',
];

export function validateLedger(ledger: SprintLedger): string[] {
  const problems: string[] = [];
  if (!ledger.originalPrompt.trim()) problems.push('original prompt missing');
  if (sha256(ledger.originalPrompt) !== ledger.promptSha256) {
    problems.push('original prompt was altered after sprint creation');
  }
  const ids = new Set<string>();
  for (const ws of ledger.workstreams) {
    if (ids.has(ws.id)) problems.push(`duplicate workstream id ${ws.id}`);
    ids.add(ws.id);
    for (const field of REQUIRED_WS_TEXT_FIELDS) {
      if (!String((ws as unknown as Record<string, unknown>)[field] ?? '').trim()) {
        problems.push(`${ws.id || '(no id)'}: missing ${field}`);
      }
    }
    for (const field of REQUIRED_WS_LIST_FIELDS) {
      const value = (ws as unknown as Record<string, unknown>)[field];
      if (!Array.isArray(value) || value.length === 0) problems.push(`${ws.id}: missing ${field}`);
    }
    if (!ws.browserJourney || ws.browserJourney.steps.length === 0) {
      problems.push(`${ws.id}: missing required browser journey`);
    }
    if (!ws.requirements.length) problems.push(`${ws.id}: no acceptance requirements`);
    if (!WORKSTREAM_STATUSES.includes(ws.status)) problems.push(`${ws.id}: invalid status ${ws.status}`);
    for (const kind of ws.requiredProofs) {
      if (!EVIDENCE_KINDS.includes(kind)) problems.push(`${ws.id}: unknown proof kind ${kind}`);
    }
  }
  for (const ws of ledger.workstreams) {
    for (const dep of ws.dependsOn) {
      if (!ids.has(dep)) problems.push(`${ws.id}: depends on unknown workstream ${dep}`);
    }
  }
  problems.push(...dependencyCycleProblems(ledger));
  for (const finding of ledger.findings) {
    if (!ids.has(finding.workstreamId)) problems.push(`finding ${finding.id}: unknown workstream`);
    if (finding.disposition === 'external') {
      if (!finding.externalJustification?.trim()) {
        problems.push(`finding ${finding.id}: external disposition requires a justification naming the external system`);
      }
      if (!finding.externalApprovedBy?.trim()) {
        problems.push(`finding ${finding.id}: external disposition requires explicit non-builder approval`);
      }
    }
    if (/token=(?!REDACTED)[^&\s]+/i.test(finding.liveUrl)) {
      problems.push(`finding ${finding.id}: liveUrl contains an unredacted token`);
    }
  }
  const evidenceIds = new Set(ledger.evidence.map((e) => e.id));
  for (const ws of ledger.workstreams) {
    for (const req of ws.requirements) {
      if (req.verified && req.evidenceIds.length === 0) {
        problems.push(`${ws.id}/${req.id}: verified without linked evidence`);
      }
      for (const id of req.evidenceIds) {
        if (!evidenceIds.has(id)) problems.push(`${ws.id}/${req.id}: unknown evidence ${id}`);
      }
    }
  }
  return problems;
}

function dependencyCycleProblems(ledger: SprintLedger): string[] {
  const visiting = new Set<string>();
  const done = new Set<string>();
  const byId = new Map(ledger.workstreams.map((ws) => [ws.id, ws]));
  const problems: string[] = [];
  const visit = (id: string): void => {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      problems.push(`dependency cycle involving ${id}`);
      return;
    }
    visiting.add(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) visit(dep);
    visiting.delete(id);
    done.add(id);
  };
  for (const ws of ledger.workstreams) visit(ws.id);
  return problems;
}

// ─────────────────────────────────────────────────────────────────────────
// Operator-readable report (generated from ledger evidence only)
// ─────────────────────────────────────────────────────────────────────────

export type CompletionClass =
  | 'implemented_not_qa_verified'
  | 'qa_failed'
  | 'repaired_awaiting_retest'
  | 'independently_verified'
  | 'externally_blocked'
  | 'accepted'
  | 'not_started';

export function classifyWorkstream(ledger: SprintLedger, ws: Workstream): CompletionClass {
  if (ws.finalAcceptance === 'accepted') return 'accepted';
  if (ws.status === 'externally_blocked') return 'externally_blocked';
  if (openFindings(ledger, ws.id).some((f) => f.status === 'repaired_awaiting_retest')) {
    return 'repaired_awaiting_retest';
  }
  if (ws.status === 'browser_qa_failed' || ws.status === 'repairing') return 'qa_failed';
  if (ws.status === 'browser_qa_passed' || ws.status === 'final_regression_pending') {
    return 'independently_verified';
  }
  if (ws.status === 'planned') return 'not_started';
  return 'implemented_not_qa_verified';
}

const CLASS_LABELS: Record<CompletionClass, string> = {
  implemented_not_qa_verified: 'Implemented but not QA-verified',
  qa_failed: 'QA failed',
  repaired_awaiting_retest: 'Repaired and awaiting retest',
  independently_verified: 'Independently verified',
  externally_blocked: 'Truly externally blocked',
  accepted: 'Accepted',
  not_started: 'Not started',
};

export function renderLedgerReport(ledger: SprintLedger): string {
  const refs = (ids: string[] | undefined): string => (ids?.length ? ` ${ids.map((id) => `[E:${id}]`).join('')}` : '');
  const lines: string[] = [
    `# Sprint Report: ${ledger.title}`,
    '',
    `- Sprint: \`${ledger.sprintId}\``,
    `- Created: ${ledger.createdAt}`,
    // A "complete" status is itself a completion claim: link the final
    // regression + review evidence so claims-lint holds the report to the
    // same standard as builder narrative.
    `- Sprint status: ${ledger.sprintStatus}${ledger.sprintStatus === 'complete' ? refs([...(ledger.finalRegression?.evidenceIds ?? []), ...(ledger.finalReview?.evidenceIds ?? [])]) : ''}`,
    `- Final combined regression: ${ledger.finalRegression ? `${ledger.finalRegression.result} at ${ledger.finalRegression.at}${refs(ledger.finalRegression.evidenceIds)}` : 'not run'}`,
    `- Independent final review: ${ledger.finalReview ? `${ledger.finalReview.result} at ${ledger.finalReview.at}${refs(ledger.finalReview.evidenceIds)}` : 'not run'}`,
    '',
    'Every status below is derived from ledger evidence, not builder narrative.',
    '',
  ];
  for (const ws of ledger.workstreams) {
    const findings = ledger.findings.filter((f) => f.workstreamId === ws.id);
    const open = openFindings(ledger, ws.id);
    lines.push(`## ${ws.id}: ${ws.name}`, '');
    lines.push(`- Classification: **${CLASS_LABELS[classifyWorkstream(ledger, ws)]}**${refs(ws.browserQaResult?.evidenceIds)}`);
    lines.push(`- Status: ${ws.status}`);
    lines.push(`- Operator outcome: ${ws.operatorOutcome}`);
    lines.push(`- Depends on: ${ws.dependsOn.join(', ') || 'none'}`);
    lines.push(
      `- Browser QA: ${ws.browserQaResult ? `${ws.browserQaResult.result} at ${ws.browserQaResult.at} (${ws.browserQaResult.reportPath})${refs(ws.browserQaResult.evidenceIds)}` : 'not run'}`,
    );
    lines.push(`- Findings: ${findings.length} total, ${open.length} unresolved`);
    lines.push(`- Repairs: ${ws.repairHistory.length}`);
    lines.push('', '### Requirements', '');
    for (const req of ws.requirements) {
      const evidence = req.evidenceIds
        .map((id) => ledger.evidence.find((e) => e.id === id))
        .filter((e): e is Evidence => Boolean(e))
        .map((e) => `${e.kind}: ${e.summary}${e.path ? ` (${e.path})` : ''}${e.url ? ` (${e.url})` : ''}`);
      lines.push(
        `- [${req.verified ? 'x' : ' '}] ${req.id}: ${req.text}${evidence.length ? ` — evidence:${refs(req.evidenceIds)} ${evidence.join('; ')}` : ' — UNVERIFIED (no linked evidence)'}`,
      );
    }
    if (findings.length) {
      lines.push('', '### Findings', '');
      for (const f of findings) {
          // Blockquoted: finding text quotes raw QA output and is not a
        // completion claim, so the claims lint must not evaluate it.
        lines.push(
          `> ${f.id} [${f.severity}] (${f.status}, ${f.disposition}): ${f.expected} vs ${f.actual} — pattern \`${f.patternKey}\``,
        );
      }
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function writeReport(root: string, ledger: SprintLedger): string {
  const file = reportPath(root, ledger.sprintId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderLedgerReport(ledger), 'utf8');
  return file;
}
