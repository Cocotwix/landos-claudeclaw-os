#!/usr/bin/env node
// Agent-neutral builder adapters for the LandOS Development Improvement Loop.
//
// A builder is an interchangeable coding agent the loop can launch. The loop
// owns the task, the run state, the immutable acceptance criteria, the attempt
// history and the next instructions; a builder only receives one standalone
// prompt and edits files. Adding another agent (DeepSeek, Hermes, anything
// else) means adding one descriptor to BUILDERS. Nothing in the run state, the
// evaluator, the instruction composer or the CLI changes.
//
// Descriptor contract:
//   id            stable identifier used in run state
//   label         human name for reports
//   version       argv that prints a version; used only for availability
//   invoke(ctx)   -> { args, stdin } for the launch, given
//                    { cwd, promptText, attemptDir }
//   claimFrom(stdout, stderr) -> 'COMPLETE' | 'BLOCKED' | 'UNKNOWN'
//   notes         why the launch flags are what they are
//
// The loop never trusts a builder's claim. It is recorded as evidence about the
// builder, and the independent evaluator alone decides PASS or FAIL.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

// Builder tools are deliberately narrow: read and edit only. The loop runs the
// tests and the build itself, so a builder never needs a shell to be accepted.
const CC_TOOLS = 'Read,Write,Edit,Glob,Grep';

function quote(value) {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

// Some builders echo the prompt they were given, and the prompt names both
// tokens. Only the last occurrence can be the builder's own sign-off.
function claimFromText(text) {
  const complete = String(text).lastIndexOf('ATTEMPT_COMPLETE');
  const blocked = String(text).lastIndexOf('ATTEMPT_BLOCKED');
  if (complete === -1 && blocked === -1) return 'UNKNOWN';
  return complete > blocked ? 'COMPLETE' : 'BLOCKED';
}

export const BUILDERS = [
  {
    id: 'cc',
    label: 'Claude Code',
    version: ['--version'],
    command: 'claude',
    notes:
      'Headless print mode. Prompt on stdin. acceptEdits plus a read/edit-only ' +
      'tool list, so the builder can implement but cannot run shell commands.',
    invoke({ promptText }) {
      return {
        args: ['-p', '--permission-mode', 'acceptEdits', '--allowedTools', CC_TOOLS, '--output-format', 'text'],
        stdin: promptText,
      };
    },
    claimFrom: (stdout, stderr) => claimFromText(`${stdout}\n${stderr}`),
  },
  {
    id: 'codex',
    label: 'OpenAI Codex',
    version: ['--version'],
    command: 'codex',
    notes:
      'codex exec with the prompt on stdin. danger-full-access is used because ' +
      "this machine's Windows sandbox helper (codex-windows-sandbox-setup.exe) " +
      'fails to launch under workspace-write; containment is enforced instead by ' +
      'the evaluator scope-containment check against a pre-attempt git snapshot.',
    invoke({ cwd, attemptDir }) {
      return {
        args: [
          'exec',
          '--cd',
          quote(cwd),
          '-s',
          'danger-full-access',
          '-o',
          quote(path.join(attemptDir, 'builder-final-message.txt')),
          '-',
        ],
        stdin: null, // prompt is piped in by launchBuilder
        finalMessageFile: 'builder-final-message.txt',
      };
    },
    claimFrom: (stdout, stderr) => claimFromText(`${stdout}\n${stderr}`),
  },
];

export function listBuilders() {
  return BUILDERS.map((builder) => ({ id: builder.id, label: builder.label, notes: builder.notes }));
}

export function getBuilder(id, registry = BUILDERS) {
  const builder = registry.find((entry) => entry.id === id);
  if (!builder) throw new Error(`Unknown builder "${id}". Known builders: ${registry.map((e) => e.id).join(', ')}`);
  return builder;
}

export function detectBuilder(builder, { run = spawnSync } = {}) {
  const result = run(builder.command, builder.version, { shell: true, encoding: 'utf8', timeout: 60_000 });
  const available = !result.error && result.status === 0;
  return {
    id: builder.id,
    label: builder.label,
    available,
    version: available ? String(result.stdout ?? '').trim().split(/\r?\n/)[0] : null,
    detail: available ? null : String(result.stderr ?? result.error?.message ?? 'no version output').trim(),
  };
}

export function availableBuilderIds(registry = BUILDERS, deps = {}) {
  return registry.filter((builder) => detectBuilder(builder, deps).available).map((builder) => builder.id);
}

// Readiness is established before attempt 1, not discovered halfway through a
// handoff. An unavailable builder is marked and skipped; the run continues on
// whoever is left. One usable builder is enough: the loop still diagnoses and
// improves instructions, it just has nobody to switch to.
export function probeBuilders(registry = BUILDERS, deps = {}) {
  const checkedAt = (deps.now ?? (() => new Date()))().toISOString();
  const builders = registry.map((builder) => ({ ...detectBuilder(builder, deps), checkedAt }));
  const available = builders.filter((entry) => entry.available).map((entry) => entry.id);
  return {
    checkedAt,
    builders,
    available,
    unavailable: builders.filter((entry) => !entry.available).map((entry) => entry.id),
    switchingPossible: available.length > 1,
  };
}

// Rotation is deterministic: the next registered builder that is available and
// is not the one that just failed. The evaluator decides *whether* to switch;
// this only decides *to whom*.
export function nextBuilderId(currentId, available) {
  const pool = available.filter(Boolean);
  if (pool.length === 0) return currentId;
  const index = pool.indexOf(currentId);
  if (index === -1) return pool[0];
  return pool[(index + 1) % pool.length];
}

export function launchBuilder(builder, { cwd, promptText, attemptDir, timeoutMs = DEFAULT_TIMEOUT_MS }, { run = spawnSync } = {}) {
  const plan = builder.invoke({ cwd, promptText, attemptDir });
  const startedAt = Date.now();
  const result = run(builder.command, plan.args, {
    cwd,
    shell: true,
    encoding: 'utf8',
    input: plan.stdin ?? promptText,
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  const durationMs = Date.now() - startedAt;
  const stdout = String(result.stdout ?? '');
  const stderr = String(result.stderr ?? '');
  let finalMessage = null;
  if (plan.finalMessageFile) {
    const file = path.join(attemptDir, plan.finalMessageFile);
    if (existsSync(file)) finalMessage = readFileSync(file, 'utf8');
  }
  const launched = !result.error && result.status === 0;
  return {
    builderId: builder.id,
    launched,
    exitCode: result.status ?? null,
    timedOut: result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM',
    durationMs,
    stdout,
    stderr,
    finalMessage,
    // Recorded as evidence about the builder. It never decides acceptance.
    // A written final message is the builder's own words; stdout may also carry
    // the echoed prompt, so it is only the fallback.
    claim: builder.claimFrom(finalMessage ?? stdout, stderr),
    error: result.error ? String(result.error.message) : null,
  };
}
