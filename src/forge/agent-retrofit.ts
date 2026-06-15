// Forge existing-agent retrofit — pure Forge Core.
//
// Deterministic, dependency-free, host-neutral, industry-neutral, text/JSON
// only. This module supports Retrofit Mode: given the text of an already-started
// agent's files (read by the host adapter, never by the core), it reconstructs a
// best-effort profile, compares it against the Forge universal department-agent
// profile standard, scores readiness, and generates a SAFE upgrade plan and a
// draft retrofit scaffold. It inspects, reconstructs, compares, and proposes
// only. It never writes, overwrites, moves, deletes, activates, or registers an
// agent, and it reads no files itself.

import {
  buildAgentProfile,
  deriveAuthorityModel,
  type AgentProfileDraft,
  type DepartmentAgentProfile,
} from './agent-profile.js';

/** One file's text, supplied by the host adapter. Path is relative to the
 *  agent folder. The core never touches the filesystem. */
export interface ExistingAgentFile {
  path: string;
  content: string;
}

/** A reconstructed view of an existing agent, inferred from its files. */
export interface ExistingAgentSnapshot {
  agentSlug: string;
  relativeFolderPath: string;
  detectedFiles: string[];
  primaryInstructionText?: string;
  profileLikeData?: Record<string, string>;
  dashboardHints: string[];
  toolPermissionHints: string[];
  memoryHints: string[];
  outputFormatHints: string[];
  verificationHints: string[];
  handoffHints: string[];
  riskFlags: string[];
  missingSignals: string[];
}

export interface ReconstructedAgentProfile {
  /** Best-effort draft inferred from the snapshot. */
  draft: AgentProfileDraft;
  /** Normalized profile (defaults fill what could not be inferred). */
  profile: DepartmentAgentProfile;
  /** Which profile fields were inferred from the existing files. */
  inferredFields: string[];
}

export type GapSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface RetrofitGap {
  /** The standard profile field this gap concerns. */
  field: string;
  /** True when the field is present in the reconstructed profile. */
  present: boolean;
  severity: GapSeverity;
  detail: string;
}

export interface RetrofitReadiness {
  /** 0-100, share of standard fields present. */
  score: number;
  presentCount: number;
  totalCount: number;
  /** True when no critical or high gaps remain. */
  ready: boolean;
  /** Counts by severity for gaps that are still missing. */
  missingBySeverity: Record<GapSeverity, number>;
  summary: string;
}

export interface RetrofitUpgradePlan {
  summary: string;
  currentStrengths: string[];
  missingRequiredFields: string[];
  riskFlags: string[];
  recommendedProfilePatches: string[];
  recommendedFiles: string[];
  recommendedDashboardBehavior: string[];
  recommendedTests: string[];
  recommendedOwnerDecisions: string[];
  blockedActions: string[];
  nextSafeStep: string;
}

export interface RetrofitScaffoldFile {
  path: string;
  purpose: string;
  content: string;
}

export interface RetrofitScaffold {
  notActive: string[];
  /** The complete profile a retrofit would converge on, as JSON. */
  proposedProfileJson: string;
  /** Draft files proposed to add later (previews only). */
  proposedFiles: RetrofitScaffoldFile[];
  /** Per-gap proposed patches. */
  proposedPatches: string[];
}

// ── Snapshot extraction ──────────────────────────────────────────────────

const NOT_MODIFYING = [
  'Draft only.',
  'Does not modify the existing agent.',
  'Does not activate the agent.',
  'Does not register the agent.',
  'Owner review required before applying any changes.',
  'Codex/QA review recommended before any writeback.',
];

function isPrimaryInstructionFile(path: string): boolean {
  const base = path.split('/').pop()?.toLowerCase() ?? '';
  return base === 'claude.md' || base === 'agent.md';
}

function isConfigFile(path: string): boolean {
  const base = path.split('/').pop()?.toLowerCase() ?? '';
  return base === 'agent.yaml' || base === 'agent.yml';
}

// Minimal, dependency-free `key: value` reader for a flat config file. It is
// deliberately shallow: it reads top-level scalar keys only and ignores nested
// structures, which is all the reconstruction needs.
function parseFlatConfig(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (!val) continue; // section header / nested block
    val = val.replace(/^["']|["']$/g, '');
    if (out[key] === undefined) out[key] = val;
  }
  return out;
}

function matchingLines(text: string, pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^[#>*\-\s]+/, '').trim();
    if (line && pattern.test(line)) hits.push(line.length > 160 ? line.slice(0, 160) + '…' : line);
    if (hits.length >= 5) break;
  }
  return hits;
}

/**
 * Build a snapshot from an existing agent's files. Pure: the host adapter reads
 * the files and passes their text in. Extracts the primary instruction text,
 * flat config data, and keyword hints for the standard profile aspects.
 */
export function buildSnapshotFromFiles(input: {
  agentSlug: string;
  relativeFolderPath: string;
  files: ExistingAgentFile[];
}): ExistingAgentSnapshot {
  const files = input.files ?? [];
  const detectedFiles = files.map((f) => f.path);

  const primary = files.find((f) => isPrimaryInstructionFile(f.path));
  const config = files.find((f) => isConfigFile(f.path));
  const primaryInstructionText = primary?.content;
  const profileLikeData = config ? parseFlatConfig(config.content) : undefined;

  // Stem-based, deliberately lenient: hint detection should catch plurals and
  // inflections ("tools", "remembers", "verifies", "hands off").
  const text = primaryInstructionText ?? '';
  const dashboardHints = matchingLines(text, /\bdashboard/i);
  const toolPermissionHints = matchingLines(text, /\b(tool|permission|allow)/i);
  const memoryHints = matchingLines(text, /\b(memor|remember|recall)/i);
  const outputFormatHints = matchingLines(text, /\b(output|format|respond|message)/i);
  const verificationHints = matchingLines(text, /\b(verif|qa|self-check|pass\/fail)|\btest/i);
  const handoffHints = matchingLines(text, /\b(handoff|hand|delegate|mission|route)/i);

  const riskFlags: string[] = [];
  if (/secret|token|api[\s_-]?key|\.env/i.test(text)) {
    riskFlags.push('References secrets/keys/.env in instructions; confirm no secret values are stored in files.');
  }
  if (/\b(push|deploy|publish)\b/i.test(text) && !/\bapprov/i.test(text)) {
    riskFlags.push('Mentions release actions (push/deploy/publish) without nearby approval language.');
  }
  if (!/\b(stop|hard stop|never|approval|owner)\b/i.test(text)) {
    riskFlags.push('No explicit owner-approval or hard-stop language detected.');
  }
  if (!primary) {
    riskFlags.push('No primary instruction file (CLAUDE.md / AGENT.md) detected.');
  }

  const missingSignals: string[] = [];
  if (!dashboardHints.length) missingSignals.push('dashboard behavior');
  if (!toolPermissionHints.length) missingSignals.push('tool permissions');
  if (!memoryHints.length) missingSignals.push('memory boundaries');
  if (!outputFormatHints.length) missingSignals.push('output format');
  if (!verificationHints.length) missingSignals.push('verification rules');
  if (!handoffHints.length) missingSignals.push('handoff rules');

  return {
    agentSlug: input.agentSlug,
    relativeFolderPath: input.relativeFolderPath,
    detectedFiles,
    primaryInstructionText,
    profileLikeData,
    dashboardHints,
    toolPermissionHints,
    memoryHints,
    outputFormatHints,
    verificationHints,
    handoffHints,
    riskFlags,
    missingSignals,
  };
}

// ── Reconstruction ─────────────────────────────────────────────────────────

function firstParagraph(text: string): string | undefined {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^#+\s*/, '').trim();
    if (line && !/^[#>*\-]/.test(raw.trim())) return line.length > 200 ? line.slice(0, 200) + '…' : line;
  }
  return undefined;
}

/**
 * Reconstruct a best-effort profile draft from a snapshot, then normalize it.
 * Unknown fields fall back to the universal defaults so the comparison is
 * apples-to-apples against the standard. Pure and deterministic.
 */
export function reconstructAgentProfile(snapshot: ExistingAgentSnapshot): ReconstructedAgentProfile {
  const cfg = snapshot.profileLikeData ?? {};
  const inferred: string[] = [];

  // The slug always gives us a stable agent name.
  if (snapshot.agentSlug) inferred.push('agentName');

  const displayName = cfg.name || cfg.displayName;
  if (displayName) inferred.push('displayName');

  const department = cfg.department;
  if (department) inferred.push('department');

  const mission = cfg.description || (snapshot.primaryInstructionText ? firstParagraph(snapshot.primaryInstructionText) : undefined);
  if (mission) inferred.push('primaryMission');

  if (snapshot.dashboardHints.length) inferred.push('dashboardBehavior');
  if (snapshot.toolPermissionHints.length) inferred.push('allowedTools');
  if (snapshot.memoryHints.length) inferred.push('memoryBoundaries');
  if (snapshot.outputFormatHints.length) inferred.push('outputFormat');
  if (snapshot.verificationHints.length) inferred.push('verificationRules');
  if (snapshot.handoffHints.length) inferred.push('handoffRules');

  const draft: AgentProfileDraft = {
    agentName: snapshot.agentSlug,
    displayName,
    department,
    primaryMission: mission,
    dashboardBehavior: snapshot.dashboardHints.length ? snapshot.dashboardHints : undefined,
    allowedTools: snapshot.toolPermissionHints.length ? snapshot.toolPermissionHints : undefined,
    memoryBoundaries: snapshot.memoryHints.length ? snapshot.memoryHints : undefined,
    outputFormat: snapshot.outputFormatHints.length ? snapshot.outputFormatHints : undefined,
    verificationRules: snapshot.verificationHints.length ? snapshot.verificationHints : undefined,
    handoffRules: snapshot.handoffHints.length ? snapshot.handoffHints : undefined,
    createdAt: 'reconstructed',
  };

  return { draft, profile: buildAgentProfile(draft), inferredFields: inferred };
}

// ── Gap analysis ─────────────────────────────────────────────────────────

// The standard fields, each with the severity of a gap on that field and the
// reconstruction signal that would mark it present. A field is present only when
// that signal was inferred from the agent's OWN files. Fields with no signal can
// never be reconstructed from existing files, so they always surface as gaps
// (universal defaults must never count as "present" during a retrofit). Identity
// and authority/safety carry the heaviest weight.
const GAP_FIELDS: ReadonlyArray<{
  field: string;
  severity: GapSeverity;
  /** The inferred-signal key that marks this field present, if any. */
  inferredKey?: string;
}> = [
  { field: 'agent name', severity: 'critical', inferredKey: 'agentName' },
  { field: 'display name', severity: 'critical', inferredKey: 'displayName' },
  { field: 'department', severity: 'critical', inferredKey: 'department' },
  { field: 'primary mission', severity: 'critical', inferredKey: 'primaryMission' },
  { field: 'normal owner input', severity: 'low' },
  { field: 'automatic actions', severity: 'medium' },
  { field: 'live-action authority', severity: 'high' },
  { field: 'hard stops', severity: 'high' },
  { field: 'allowed tools', severity: 'high', inferredKey: 'allowedTools' },
  { field: 'cost rules', severity: 'medium' },
  { field: 'memory boundaries', severity: 'medium', inferredKey: 'memoryBoundaries' },
  { field: 'output format', severity: 'medium', inferredKey: 'outputFormat' },
  { field: 'file/storage behavior', severity: 'medium' },
  { field: 'verification rules', severity: 'high', inferredKey: 'verificationRules' },
  { field: 'handoff rules', severity: 'low', inferredKey: 'handoffRules' },
  { field: 'dashboard behavior', severity: 'low', inferredKey: 'dashboardBehavior' },
  { field: 'activation mode', severity: 'medium' },
  { field: 'audit expectations', severity: 'medium' },
  { field: 'rollback expectations', severity: 'medium' },
  { field: 'pass/fail test', severity: 'high' },
  { field: 'owner approval loop', severity: 'low' },
];

/**
 * Compare a reconstructed profile against the Forge standard. Returns one gap
 * entry per standard field, marking present/absent and severity. A field counts
 * as present only when it was inferred from the agent's own files; fields filled
 * solely by a universal default are reported as gaps so the owner sees what the
 * existing agent does not yet specify.
 */
export function analyzeRetrofitGaps(
  reconstruction: ReconstructedAgentProfile,
): RetrofitGap[] {
  const inferred = new Set(reconstruction.inferredFields);
  return GAP_FIELDS.map(({ field, severity, inferredKey }) => {
    const isPresent = inferredKey ? inferred.has(inferredKey) : false;
    return {
      field,
      present: isPresent,
      severity,
      detail: isPresent
        ? `Present (reconstructed from the existing agent).`
        : `Missing: the existing agent does not specify "${field}". Severity: ${severity}.`,
    };
  });
}

// ── Readiness ──────────────────────────────────────────────────────────────

/** Score the retrofit from its gaps. Pure. */
export function assessRetrofitReadiness(gaps: RetrofitGap[]): RetrofitReadiness {
  const totalCount = gaps.length;
  const presentCount = gaps.filter((g) => g.present).length;
  const score = totalCount ? Math.round((presentCount / totalCount) * 100) : 0;
  const missingBySeverity: Record<GapSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const g of gaps) if (!g.present) missingBySeverity[g.severity] += 1;
  const ready = missingBySeverity.critical === 0 && missingBySeverity.high === 0;
  const summary = ready
    ? `Retrofit readiness ${score}/100. No critical or high gaps remain; the agent is in good shape to finish against the standard.`
    : `Retrofit readiness ${score}/100. ${missingBySeverity.critical} critical and ${missingBySeverity.high} high gaps remain. Close these before any upgrade is applied.`;
  return { score, presentCount, totalCount, ready, missingBySeverity, summary };
}

// ── Upgrade plan ─────────────────────────────────────────────────────────

/** Generate a safe upgrade plan from the snapshot, reconstruction, gaps, and
 *  readiness. Pure text; proposes changes, applies none. */
export function generateRetrofitUpgradePlan(input: {
  snapshot: ExistingAgentSnapshot;
  reconstruction: ReconstructedAgentProfile;
  gaps: RetrofitGap[];
  readiness: RetrofitReadiness;
}): RetrofitUpgradePlan {
  const { snapshot, reconstruction, gaps, readiness } = input;
  const missing = gaps.filter((g) => !g.present);
  const present = gaps.filter((g) => g.present);

  const requiredMissing = missing
    .filter((g) => g.severity === 'critical' || g.severity === 'high')
    .map((g) => `${g.field} (${g.severity})`);

  return {
    summary: `Retrofit plan for \`${snapshot.agentSlug}\`. ${readiness.summary} ${present.length} of ${gaps.length} standard fields are reconstructed from the existing agent.`,
    currentStrengths: present.length
      ? present.map((g) => `Has ${g.field}.`)
      : ['No standard fields could be reconstructed yet; treat as an early-stage agent.'],
    missingRequiredFields: requiredMissing.length ? requiredMissing : ['None — no critical or high gaps.'],
    riskFlags: snapshot.riskFlags.length ? snapshot.riskFlags : ['No risk flags detected during inspection.'],
    recommendedProfilePatches: missing.map(
      (g) => `Define "${g.field}" for this agent (currently missing, severity ${g.severity}).`,
    ),
    recommendedFiles: [
      'agent-profile.json — a complete profile that satisfies the standard.',
      'A short profile section in the agent doc describing hard stops and owner approval loop.',
      ...(snapshot.detectedFiles.some((f) => /test/i.test(f)) ? [] : ['A test plan / pass-fail acceptance test.']),
    ],
    recommendedDashboardBehavior: reconstruction.profile.dashboardBehavior,
    recommendedTests: [
      'Add a pass/fail acceptance test the agent must meet.',
      'Run the host project checks (tests, typecheck, build) after any later writeback.',
    ],
    recommendedOwnerDecisions: [
      'Approve this retrofit plan as the basis for an upgrade.',
      'Decide which missing fields to fill first.',
      'Scope any live actions before the agent leaves sandbox.',
    ],
    blockedActions: [
      'Writing into the existing agent folder (blocked this sprint).',
      'Overwriting CLAUDE.md / AGENT.md / configs / tools (blocked).',
      'Activating or registering the agent (blocked; separate owner gate).',
    ],
    nextSafeStep: readiness.ready
      ? 'Generate the retrofit review packet, get owner approval, then plan a gated, reviewed writeback in a later sprint.'
      : 'Fill the critical and high gaps in a reconstructed profile, re-inspect, and review again before any writeback.',
  };
}

// ── Retrofit scaffold (draft preview) ──────────────────────────────────────

/** Generate a draft retrofit scaffold previewing proposed changes. Artifact
 *  only: modifies nothing, activates nothing, registers nothing. */
export function generateRetrofitScaffold(input: {
  snapshot: ExistingAgentSnapshot;
  reconstruction: ReconstructedAgentProfile;
  gaps: RetrofitGap[];
}): RetrofitScaffold {
  const { snapshot, reconstruction, gaps } = input;
  const missing = gaps.filter((g) => !g.present);
  return {
    notActive: [...NOT_MODIFYING],
    proposedProfileJson: JSON.stringify(reconstruction.profile, null, 2),
    proposedFiles: [
      {
        path: `${snapshot.relativeFolderPath}/agent-profile.json`,
        purpose: 'Proposed complete profile (draft preview; not written).',
        content: JSON.stringify(reconstruction.profile, null, 2),
      },
    ],
    proposedPatches: missing.map((g) => `Add "${g.field}" (${g.severity}).`),
  };
}

// ── Review packet ─────────────────────────────────────────────────────────

function mdList(items: string[]): string {
  return items.length ? items.map((i) => `- ${i}`).join('\n') : '- (none)';
}

/** Render the retrofit review packet for owner / Codex / QA. Text only. */
export function renderRetrofitReviewPacketMarkdown(input: {
  snapshot: ExistingAgentSnapshot;
  reconstruction: ReconstructedAgentProfile;
  gaps: RetrofitGap[];
  readiness: RetrofitReadiness;
  plan: RetrofitUpgradePlan;
  status?: string;
  ownerDecision?: string;
  notes?: string;
}): string {
  const { snapshot, reconstruction, gaps, readiness, plan } = input;
  const p = reconstruction.profile;
  const auth = deriveAuthorityModel(p);
  const scaffold = generateRetrofitScaffold({ snapshot, reconstruction, gaps });

  const gapRows = gaps
    .map((g) => `| ${g.field} | ${g.present ? 'present' : 'missing'} | ${g.severity} |`)
    .join('\n');

  return `# Existing Agent Retrofit — ${p.displayName}

**Agent slug:** \`${snapshot.agentSlug}\`
**Folder:** \`${snapshot.relativeFolderPath}\`
**Status:** ${input.status?.trim() || 'inspected'}
**Owner decision:** ${input.ownerDecision?.trim() || 'pending'}
**Retrofit readiness:** ${readiness.score}/100${readiness.ready ? ' (ready)' : ''}

> ${scaffold.notActive.join('\n> ')}

## Reconstruction
Inferred fields: ${reconstruction.inferredFields.length ? reconstruction.inferredFields.join(', ') : 'none'}.

- **Mission:** ${p.primaryMission}
- **Department:** ${p.department}
- **Detected files:** ${snapshot.detectedFiles.length ? snapshot.detectedFiles.join(', ') : 'none'}

## Authority model
${auth.summary}

## Gap analysis
| Field | State | Severity |
|---|---|---|
${gapRows}

## Readiness
${readiness.summary}

## Upgrade plan
${plan.summary}

**Current strengths**
${mdList(plan.currentStrengths)}

**Missing required fields**
${mdList(plan.missingRequiredFields)}

**Risk flags**
${mdList(plan.riskFlags)}

**Recommended profile patches**
${mdList(plan.recommendedProfilePatches)}

**Recommended files to add later**
${mdList(plan.recommendedFiles)}

**Recommended tests**
${mdList(plan.recommendedTests)}

**Recommended owner decisions**
${mdList(plan.recommendedOwnerDecisions)}

**Blocked actions**
${mdList(plan.blockedActions)}

**Next safe step**
${plan.nextSafeStep}

${input.notes?.trim() ? `## Notes\n${input.notes.trim()}\n` : ''}---

This packet inspects and proposes only. It does not modify, activate, or
register the existing agent. Any future writeback is a separate, gated,
owner-approved step. Forge reads existing agent files; it never writes into
them, and it never reads secrets.
`;
}
