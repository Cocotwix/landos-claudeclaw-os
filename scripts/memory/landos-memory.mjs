#!/usr/bin/env node
// Offline LandOS durable-memory status, audit, checkpoint, and retrieval tool.
// It never reads .env, databases, browser state, or network resources.

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const BUDGETS = {
  autoTargetTokens: 10_000,
  autoMaxTokens: 20_000,
  permanentMaxBytes: 4_096,
  checkpointMaxBytes: 8_192,
  checkpointStaleDays: 7,
  retrievalMaxTokens: 2_500,
};
export const PERMANENT_MEMORY_PATH = '.landos/PERMANENT_MEMORY.md';
export const CHECKPOINT_PATH = '.landos/CHECKPOINT.md';
export const VERIFICATION_PATH = '.landos/verification-results.json';
export const ACCEPTANCE_PATH = 'docs/landos/Fresh_Session_Acceptance.md';
export const HISTORY_FILES = [
  '.landos/HANDOVER.md',
  '.landos/OPERATOR_QA.md',
  '.landos/BUSINESS_QA.md',
  '.landos/KNOWN_LIMITATIONS.md',
  '.landos/PROJECT_MEMORY.md',
  '.landos/DECISIONS.md',
  '.landos/CHAT_CONTEXT.md',
  '.landos/CURRENT_SPRINT.md',
  '.landos/OPERATING_STATE.md',
];

export function estimateTokens(text) {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
}
function readIfExists(root, rel) {
  const file = path.isAbsolute(rel) ? rel : path.join(root, rel);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}
function jsonIfExists(root, rel) {
  try {
    return JSON.parse((readIfExists(root, rel) ?? 'null').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}
function git(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}
export function gitShortHead(root) {
  return git(root, ['rev-parse', '--short', 'HEAD']);
}
export function gitDirtyCount(root) {
  const output = git(root, ['status', '--short']);
  return output === null ? null : output.split(/\r?\n/).filter(Boolean).length;
}

export const FORBIDDEN_PATTERNS = [
  { name: 'full sprint prompt', re: /\bWORKSTREAM\s+\d+\b/i },
  { name: 'full final-report prompt', re: /^FINAL REPORT\s*$/im },
  { name: 'jwt-like token', re: /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: 'google api key', re: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { name: 'provider api key', re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/ },
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'tokenized url', re: /[?&](?:token|jwt|key|apikey|api_key|auth|signature|sig|access_token)=[^\s&"')]+/i },
  { name: 'bearer credential', re: /\bBearer\s+[A-Za-z0-9_.-]{16,}/ },
  { name: 'environment value', re: /^[A-Z][A-Z0-9_]{4,}=(?!<|\.\.\.|\s*$)\S{8,}/m },
  { name: 'mcp tool output', re: /\bmcp__[a-z][a-z0-9_-]*__(?:result|output|computer|snapshot)\b/i },
  { name: 'tool transcript', re: /<\/?(?:tool_use|tool_result|function_calls|antml:invoke)\b/i },
  { name: 'raw dom dump', re: /<(?:html|body)\b[^>]*>[\s\S]{200,}<\/(?:html|body)>/i },
  { name: 'base64 image', re: /data:image\/[a-z]+;base64,/i },
  { name: 'terminal ansi output', re: /\x1b\[[0-9;]*m/ },
  { name: 'voice transcript', re: /\[Voice transcribed\]:\s*(?!\.\.\.)\S+/i },
];export function scanForbiddenContent(text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (const { name, re } of FORBIDDEN_PATTERNS) {
    if (!re.test(text)) continue;
    const flags = re.flags.replace('m', '').replace('s', '');
    const lineRe = new RegExp(re.source, flags);
    const foundLines = [];
    lines.forEach((line, index) => {
      if (lineRe.test(line)) foundLines.push(index + 1);
    });
    if (foundLines.length) foundLines.forEach((line) => findings.push({ pattern: name, line }));
    else findings.push({ pattern: name, line: 0 });
  }
  return findings;
}

export function findDuplicateLines(fileTexts) {
  const seen = new Map();
  const duplicates = [];
  for (const [file, text] of Object.entries(fileTexts)) {
    const normalized = new Set(text.split(/\r?\n/)
      .map((line) => line.replace(/[\s`*_>#|-]+/g, ' ').trim().toLowerCase())
      .filter((line) => line.length >= 60));
    for (const line of normalized) {
      if (seen.has(line) && seen.get(line) !== file) {
        duplicates.push({ line: line.slice(0, 80), files: [seen.get(line), file] });
      } else seen.set(line, file);
    }
  }
  return duplicates;
}

export function checkStaleness(checkpointText, {
  headHash,
  dirtyCount,
  now = new Date(),
} = {}) {
  const reasons = [];
  const head = checkpointText.match(/\*\*HEAD at generation:\*\*\s*\x60([0-9a-f]{7,40})\x60/i)?.[1];
  const generated = checkpointText.match(/\*\*Generated:\*\*\s*([0-9TZ:+-]+)/i)?.[1];
  const recordedDirty = checkpointText.match(/\*\*Worktree:\*\*\s*(?:DIRTY[^0-9]*([0-9]+)|clean)/i);
  if (!head) reasons.push('checkpoint missing HEAD at generation');
  if (!generated) reasons.push('checkpoint missing Generated timestamp');
  if (head && headHash && !headHash.startsWith(head) && !head.startsWith(headHash)) {
    reasons.push(`checkpoint HEAD ${head} differs from live HEAD ${headHash}; live git state wins`);
  }
  if (generated) {
    const parsed = new Date(generated);
    if (Number.isNaN(parsed.getTime())) reasons.push('checkpoint Generated timestamp is invalid');
    else if ((now.getTime() - parsed.getTime()) / 86_400_000 > BUDGETS.checkpointStaleDays) {
      reasons.push('checkpoint is days old');
    }
  }
  if (recordedDirty && dirtyCount !== undefined && dirtyCount !== null) {
    const recorded = recordedDirty[0].toLowerCase().includes('clean') ? 0 : Number(recordedDirty[1]);
    if (recorded !== dirtyCount) reasons.push(`checkpoint dirty count ${recorded} differs from live count ${dirtyCount}`);
  }
  return { status: reasons.length ? 'stale' : 'fresh', reasons };
}

export function resolveClaudeAutoMemoryPath(root) {
  const projectSlug = path.resolve(root).replace(/[:\\\\/]/g, '-');
  return path.join(homedir(), '.claude', 'projects', projectSlug, 'memory', 'MEMORY.md');
}

export function resolveBootstrapProfiles(root) {
  const claude = readIfExists(root, 'CLAUDE.md') ?? '';
  const claudeFiles = ['CLAUDE.md'];
  for (const match of claude.matchAll(/^@(\.landos\/[A-Za-z0-9_./-]+\.md)\s*$/gm)) {
    claudeFiles.push(match[1]);
  }
  const autoMemory = resolveClaudeAutoMemoryPath(root);
  if (existsSync(autoMemory)) claudeFiles.push(autoMemory);
  const agents = readIfExists(root, 'AGENTS.md') ?? '';
  const codingFiles = ['AGENTS.md'];
  for (const rel of [PERMANENT_MEMORY_PATH, CHECKPOINT_PATH]) {
    if (agents.includes(rel)) codingFiles.push(rel);
  }
  return { claudeCode: [...new Set(claudeFiles)], codingAgent: [...new Set(codingFiles)] };
}
export function resolveAutoLoadedFiles(root) {
  return resolveBootstrapProfiles(root).claudeCode;
}
function statFiles(root, files) {
  return files.map((file) => {
    const text = readIfExists(root, file);
    return {
      file,
      exists: text !== null,
      bytes: text === null ? 0 : Buffer.byteLength(text, 'utf8'),
      estTokens: text === null ? 0 : estimateTokens(text),
    };
  });
}
function readAcceptance(root) {
  const text = readIfExists(root, ACCEPTANCE_PATH);
  if (!text) return { path: ACCEPTANCE_PATH, exists: false, result: 'not run' };
  const result = text.match(/\*\*Result:\*\*\s*(.+)/i)?.[1]?.trim() ?? 'recorded';
  const method = text.match(/\*\*Method:\*\*\s*(.+)/i)?.[1]?.trim() ?? 'unspecified';
  const timestamp = text.match(/\*\*Timestamp:\*\*\s*(.+)/i)?.[1]?.trim() ?? 'unspecified';
  return { path: ACCEPTANCE_PATH, exists: true, result, method, timestamp };
}
export function buildStatus(root) {
  const profilePaths = resolveBootstrapProfiles(root);
  const profiles = Object.fromEntries(Object.entries(profilePaths).map(([name, files]) => {
    const stats = statFiles(root, files);
    return [name, { files: stats, estimatedTokens: stats.reduce((sum, item) => sum + item.estTokens, 0) }];
  }));
  const totalEstimatedTokens = Math.max(...Object.values(profiles).map((p) => p.estimatedTokens));
  const permanent = readIfExists(root, PERMANENT_MEMORY_PATH);
  const checkpoint = readIfExists(root, CHECKPOINT_PATH);
  const head = gitShortHead(root);
  const dirtyCount = gitDirtyCount(root);
  const staleness = checkpoint
    ? checkStaleness(checkpoint, { headHash: head, dirtyCount })
    : { status: 'stale', reasons: ['checkpoint file missing'] };
  const automaticFiles = [...new Set(Object.values(profilePaths).flat())];
  const contentWarnings = [];
  for (const file of automaticFiles) {
    const text = readIfExists(root, file);
    if (!text) continue;
    for (const finding of scanForbiddenContent(text)) contentWarnings.push({ file, ...finding });
  }
  return {
    root,
    profiles,
    autoLoadedFiles: profiles.claudeCode.files,
    totalEstimatedTokens,
    budget: {
      targetTokens: BUDGETS.autoTargetTokens,
      maxTokens: BUDGETS.autoMaxTokens,
      withinTarget: totalEstimatedTokens < BUDGETS.autoTargetTokens,
      withinMax: totalEstimatedTokens < BUDGETS.autoMaxTokens,
    },
    permanentMemory: {
      path: PERMANENT_MEMORY_PATH,
      bytes: permanent ? Buffer.byteLength(permanent, 'utf8') : 0,
      estTokens: permanent ? estimateTokens(permanent) : 0,
      maxBytes: BUDGETS.permanentMaxBytes,
      withinBudget: !!permanent && Buffer.byteLength(permanent, 'utf8') <= BUDGETS.permanentMaxBytes,
      exists: permanent !== null,
    },
    checkpoint: {
      path: CHECKPOINT_PATH,
      bytes: checkpoint ? Buffer.byteLength(checkpoint, 'utf8') : 0,
      estTokens: checkpoint ? estimateTokens(checkpoint) : 0,
      maxBytes: BUDGETS.checkpointMaxBytes,
      withinBudget: !!checkpoint && Buffer.byteLength(checkpoint, 'utf8') <= BUDGETS.checkpointMaxBytes,
      exists: checkpoint !== null,
      staleness,
      latestResult: checkpoint ? `${staleness.status} at ${head ?? 'unknown HEAD'} with ${dirtyCount ?? 'unknown'} dirty paths` : 'missing',
    },
    contentWarnings,
    continueLandosNecessary: false,
    latestFreshSessionAcceptance: readAcceptance(root),
  };
}

export function auditContinueCommand(text) {
  const problems = [];
  const load = text.split(/^## Never load/m)[0];
  for (const rel of HISTORY_FILES) {
    const base = path.basename(rel);
    if (new RegExp('(read|load)[^\\n]*' + base, 'i').test(load)) {
      problems.push('load section references history file ' + base);
    }
  }
  if (/(read|load|inspect)[^\n]*store\/landos\.db/i.test(load)) problems.push('load section references database');
  if (/(read|load|inspect)[^\n]*(entire|all|full)[^\n]*docs/i.test(load)) problems.push('load section sweeps docs');
  if (!/^## Never load/m.test(text)) problems.push('missing Never load guard');
  return problems;
}
function permanentRuleProblems(text) {
  const required = [
    /system-wide[\s\S]{0,100}acceptance example[\s\S]{0,100}implementation scope/i,
    /previously accepted operator information[\s\S]{0,100}Tyler/i,
    /property, seller, CRM, evidence, document, visual,[\s\S]{0,100}operator data/i,
    /landos:status[\s\S]{0,400}landos:health/i,
    /Do not commit or push[\s\S]{0,100}authorization/i,
    /live localhost[\s\S]{0,200}HTTP 200 alone do not establish completion/i,
    /staged workstreams[\s\S]{0,150}independent live browser QA/i,
    /appearing twice[\s\S]{0,100}root-cause[\s\S]{0,100}regression coverage/i,
    /one full standalone implementation prompt,[\s\S]{0,40}never patch[\s\S]{0,20}fragments/i,
    /Approval is required[\s\S]{0,300}deployment/i,
  ];
  const problems = required.flatMap((pattern, index) => pattern.test(text) ? [] : ['permanent rule contract ' + (index + 1) + ' missing']);
  const bannedLabel = ['source', 'of', 'truth'].join(' ');
  if (text.toLowerCase().includes(bannedLabel)) problems.push('permanent memory contains prohibited terminology');
  return problems;
}
export function buildAudit(root) {
  const status = buildStatus(root);
  const issues = [];
  const warnings = [];
  if (!status.permanentMemory.exists) issues.push('permanent memory missing');
  if (!status.checkpoint.exists) issues.push('checkpoint missing');
  if (!status.budget.withinMax) issues.push(`automatic bootstrap ${status.totalEstimatedTokens} exceeds hard max ${BUDGETS.autoMaxTokens}`);
  else if (!status.budget.withinTarget) warnings.push(`automatic bootstrap ${status.totalEstimatedTokens} exceeds soft target ${BUDGETS.autoTargetTokens}`);
  if (!status.permanentMemory.withinBudget) issues.push('permanent memory exceeds byte budget');
  if (!status.checkpoint.withinBudget) issues.push('checkpoint exceeds byte budget');
  if (status.checkpoint.staleness.status === 'stale') warnings.push(...status.checkpoint.staleness.reasons.map((r) => `stale checkpoint: ${r}`));
  for (const finding of status.contentWarnings) {
    issues.push(`forbidden ${finding.pattern} in ${finding.file} line ${finding.line}`);
  }
  const permanent = readIfExists(root, PERMANENT_MEMORY_PATH) ?? '';
  issues.push(...permanentRuleProblems(permanent));
  for (const [profile, value] of Object.entries(status.profiles)) {
    const texts = Object.fromEntries(value.files.map((item) => [item.file, readIfExists(root, item.file) ?? '']));
    warnings.push(...findDuplicateLines(texts).map((dup) => `duplicate content in ${profile}: ${dup.files.join(' + ')}`));
  }
  const command = readIfExists(root, '.claude/commands/continue-landos.md');
  if (!command) warnings.push('continue-landos command missing');
  else issues.push(...auditContinueCommand(command).map((item) => `continue-landos: ${item}`));
  issues.push(...sprintAcceptanceProblems(readActiveSprint(root)).map((item) => `sprint ledger: ${item}`));
  return { ...status, issues, warnings, pass: issues.length === 0 };
}

function verificationLine(label, entry) {
  if (!entry) return `- **Latest ${label}:** not recorded; run verification before completion.`;
  return `- **Latest ${label}:** ${entry.status} at ${entry.timestamp}; ${entry.summary}.`;
}

// ── Sprint-ledger integration (staged lifecycle) ─────────────────────────
// The checkpoint's sprint facts are DERIVED from the requirement ledger, so
// the checkpoint writer cannot call work accepted unless the ledger and the
// independent final QA both say so. Full QA reports, prompts, screenshots,
// and browser logs stay out of automatic memory; only paths are referenced.

export const SPRINT_POINTER_PATH = '.landos/sprints/current.json';
export const CAPABILITIES_PATH = '.landos/capabilities.json';

export function readActiveSprint(root) {
  const pointer = jsonIfExists(root, SPRINT_POINTER_PATH);
  if (!pointer?.sprintId) return null;
  const ledger = jsonIfExists(root, `.landos/sprints/${pointer.sprintId}/ledger.json`);
  return ledger && ledger.schema === 1 ? ledger : null;
}

export function sprintAcceptanceProblems(ledger) {
  if (!ledger) return [];
  const problems = [];
  const finalRegressionPass = ledger.finalRegression?.result === 'pass';
  const finalReviewPass = ledger.finalReview?.result === 'pass';
  if (ledger.sprintStatus !== 'active' && (!finalRegressionPass || !finalReviewPass)) {
    problems.push(`sprint ${ledger.sprintId} is marked ${ledger.sprintStatus} without passing final regression and independent final review`);
  }
  for (const ws of ledger.workstreams ?? []) {
    if (ws.finalAcceptance === 'accepted' && (!finalRegressionPass || !finalReviewPass)) {
      problems.push(`workstream ${ws.id} is marked accepted without independent final QA proof`);
    }
  }
  return problems;
}

export function sprintDerivedLines(root) {
  const ledger = readActiveSprint(root);
  if (!ledger) return ['- **Active sprint:** none recorded in .landos/sprints/current.json.'];
  const workstreams = ledger.workstreams ?? [];
  const accepted = workstreams.filter((ws) => ws.status === 'accepted').length;
  const passed = workstreams.filter((ws) => ['browser_qa_passed', 'final_regression_pending'].includes(ws.status)).length;
  const inFlight = workstreams.find((ws) => ['implementing', 'automated_checks_running', 'awaiting_browser_qa', 'browser_qa_failed', 'repairing'].includes(ws.status));
  const openFindings = (ledger.findings ?? []).filter((f) => f.status === 'open' || f.status === 'repaired_awaiting_retest').length;
  const capabilities = jsonIfExists(root, CAPABILITIES_PATH);
  const frozen = capabilities?.capabilities?.length ?? 0;
  return [
    `- **Active sprint:** ${ledger.sprintId} (${ledger.sprintStatus}); ${accepted}/${workstreams.length} accepted, ${passed} QA-passed; current workstream ${inFlight ? `${inFlight.id} (${inFlight.status})` : 'none in flight'}; ${openFindings} open QA findings.`,
    `- **Sprint ledger:** .landos/sprints/${ledger.sprintId}/ledger.json; proof report .landos/sprints/${ledger.sprintId}/report.md; frozen capabilities: ${frozen} (${CAPABILITIES_PATH}).`,
  ];
}
export function refreshCheckpoint(root, { now = new Date() } = {}) {
  const file = path.join(root, CHECKPOINT_PATH);
  if (!existsSync(file)) throw new Error(`${CHECKPOINT_PATH} missing`);
  const current = readFileSync(file, 'utf8');
  const head = gitShortHead(root) ?? 'unknown';
  const dirtyCount = gitDirtyCount(root);
  const verification = jsonIfExists(root, VERIFICATION_PATH) ?? {};
  const runtime = verification.runtime;
  const activeSprint = readActiveSprint(root);
  const acceptanceProblems = sprintAcceptanceProblems(activeSprint);
  if (acceptanceProblems.length) {
    throw new Error(`refusing checkpoint write; ledger lacks QA proof: ${acceptanceProblems.join('; ')}`);
  }
  const block = [
    '<!-- DERIVED:START -->',
    `- **Generated:** ${now.toISOString()}`,
    `- **HEAD at generation:** \`${head}\``,
    dirtyCount === 0
      ? '- **Worktree:** clean at refresh time.'
      : `- **Worktree:** DIRTY; ${dirtyCount ?? 'unknown'} modified/untracked paths at refresh time. Preserve unrelated changes.`,
    verificationLine('tests', verification.tests),
    verificationLine('typecheck', verification.typecheck),
    verificationLine('production build', verification.build),
    runtime
      ? `- **Managed runtime:** ${runtime.status} at ${runtime.timestamp}; PID ${runtime.pid}; ${runtime.url}.`
      : '- **Managed runtime:** not recorded; inspect with npm run landos:status.',
    ...sprintDerivedLines(root),
    '<!-- DERIVED:END -->',
  ].join('\n');
  const next = current.includes('<!-- DERIVED:START -->')
    ? current.replace(/<!-- DERIVED:START -->[\s\S]*?<!-- DERIVED:END -->/, block)
    : current.replace(/^# [^\n]+\n/, (heading) => heading + '\n' + block + '\n');
  const bytes = Buffer.byteLength(next, 'utf8');
  if (bytes > BUDGETS.checkpointMaxBytes) throw new Error(`refusing checkpoint write: ${bytes} bytes exceeds ${BUDGETS.checkpointMaxBytes}`);
  writeFileSync(file, next, 'utf8');
  return { path: CHECKPOINT_PATH, generated: now.toISOString(), head, dirtyCount, bytes };
}

function walkMarkdown(root, rel, output) {
  const dir = path.join(root, rel);
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = path.posix.join(rel.replace(/\\/g, '/'), entry.name);
    if (entry.isDirectory()) walkMarkdown(root, child, output);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) output.push(child);
  }
}
function sections(text) {
  const lines = text.split(/\r?\n/);
  const result = [];
  let heading = '(document introduction)';
  let body = [];
  const flush = () => {
    if (body.join('\n').trim()) result.push({ heading, text: body.join('\n').trim() });
  };
  for (const line of lines) {
    if (/^#{1,4}\s+/.test(line)) {
      flush();
      heading = line.replace(/^#{1,4}\s+/, '').trim();
      body = [];
    } else body.push(line);
  }
  flush();
  return result;
}export function retrieveKnowledge(root, query) {
  const terms = query.toLowerCase().match(/[a-z0-9-]{2,}/g) ?? [];
  if (!terms.length) throw new Error('retrieval query must contain a specific term');
  const files = [];
  walkMarkdown(root, '.landos', files);
  walkMarkdown(root, 'docs/landos', files);
  const excluded = new Set([PERMANENT_MEMORY_PATH, CHECKPOINT_PATH]);
  const matches = [];
  let sensitiveSectionsOmitted = 0;
  for (const file of files.filter((item) => !excluded.has(item))) {
    const full = path.join(root, file);
    const text = readFileSync(full, 'utf8');
    const superseded = /\b(?:superseded|deprecated|legacy)\b/i.test(text);
    for (const section of sections(text)) {
      const haystack = `${section.heading} ${section.text}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (haystack.split(term).length - 1), 0);
      if (!score) continue;
      const sensitive = scanForbiddenContent(section.text).some((item) =>
        ['jwt-like token', 'google api key', 'provider api key', 'private key block', 'tokenized url', 'bearer credential', 'environment value'].includes(item.pattern));
      if (sensitive) {
        sensitiveSectionsOmitted += 1;
        continue;
      }
      matches.push({
        file,
        heading: section.heading,
        score,
        freshness: statSync(full).mtime.toISOString(),
        status: superseded ? 'possibly superseded; verify against live files' : 'active unless the document says otherwise',
        excerpt: section.text.replace(/\s+/g, ' ').slice(0, 900),
      });
    }
  }
  matches.sort((a, b) => b.score - a.score || b.freshness.localeCompare(a.freshness));
  const selected = [];
  let tokenCount = 0;
  for (const match of matches) {
    const tokens = estimateTokens(JSON.stringify(match));
    if (tokenCount + tokens > BUDGETS.retrievalMaxTokens || selected.length >= 5) continue;
    selected.push(match);
    tokenCount += tokens;
  }
  return { query, matches: selected, approximateAddedTokens: tokenCount, sensitiveSectionsOmitted, searchedFiles: files.length };
}

function printStatus(status) {
  console.log('LandOS memory bootstrap status');
  for (const [name, profile] of Object.entries(status.profiles)) {
    console.log(`${name}: ~${profile.estimatedTokens} tokens`);
    for (const file of profile.files) console.log(`  ${file.file}: ${file.bytes} bytes (~${file.estTokens} tokens)`);
  }
  console.log(`Combined bootstrap estimate (largest profile): ~${status.totalEstimatedTokens} tokens`);
  console.log(`Total estimated bootstrap: ~${status.totalEstimatedTokens} tokens`);
  console.log(`Budget: target < ${BUDGETS.autoTargetTokens}, hard max < ${BUDGETS.autoMaxTokens}`);
  console.log(`Budgets: soft < ${BUDGETS.autoTargetTokens}; hard < ${BUDGETS.autoMaxTokens}; ${status.budget.withinTarget ? 'PASS' : status.budget.withinMax ? 'WARN' : 'FAIL'}`);
  console.log(`Permanent memory: ${status.permanentMemory.path}, ~${status.permanentMemory.estTokens} tokens, ${status.permanentMemory.bytes}/${BUDGETS.permanentMaxBytes} bytes`);
  console.log(`Current checkpoint: ${status.checkpoint.path}, ~${status.checkpoint.estTokens} tokens, ${status.checkpoint.bytes}/${BUDGETS.checkpointMaxBytes} bytes, ${status.checkpoint.staleness.status}`);
  console.log(`Latest checkpoint result: ${status.checkpoint.latestResult}`);
  console.log(`Latest isolated fresh-session acceptance: ${status.latestFreshSessionAcceptance.result} (${status.latestFreshSessionAcceptance.path})`);
  console.log(`Content warnings: ${status.contentWarnings.length}; /continue-landos necessary for normal work: NO`);
}
function main() {
  const args = process.argv.slice(2);
  const command = args.find((arg) => !arg.startsWith('--')) ?? 'status';
  const json = args.includes('--json');
  const rootIndex = args.indexOf('--root');
  const root = rootIndex >= 0 ? path.resolve(args[rootIndex + 1]) : process.cwd();
  if (command === 'status') {
    const result = buildStatus(root);
    json ? console.log(JSON.stringify(result, null, 2)) : printStatus(result);
    return;
  }
  if (command === 'audit') {
    const result = buildAudit(root);
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      printStatus(result);
      result.warnings.forEach((item) => console.log(`WARN: ${item}`));
      result.issues.forEach((item) => console.log(`FAIL: ${item}`));
      console.log(result.pass ? 'AUDIT PASS' : 'AUDIT FAIL');
    }
    process.exitCode = result.pass ? 0 : 1;
    return;
  }
  if (command === 'checkpoint') {
    const result = refreshCheckpoint(root);
    console.log(json ? JSON.stringify(result, null, 2) : `Checkpoint replaced: ${result.generated} @ ${result.head}; ${result.bytes} bytes`);
    return;
  }
  if (command === 'retrieve') {
    const commandIndex = args.indexOf(command);
    const query = args.slice(commandIndex + 1).filter((arg) => arg !== '--json' && arg !== '--root' && arg !== root).join(' ');
    const result = retrieveKnowledge(root, query);
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Task-specific retrieval: "${result.query}"`);
      result.matches.forEach((match) => {
        console.log(`- ${match.file} :: ${match.heading} [${match.status}; modified ${match.freshness}]`);
        console.log(`  ${match.excerpt}`);
      });
      console.log(`Approximate added context: ~${result.approximateAddedTokens} tokens; searched ${result.searchedFiles} files; sensitive sections omitted: ${result.sensitiveSectionsOmitted}`);
    }
    return;
  }
  console.error('Use status | audit | checkpoint | retrieve <specific query>.');
  process.exitCode = 2;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();




