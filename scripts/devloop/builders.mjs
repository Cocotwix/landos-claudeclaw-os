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

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

// Builder tools are deliberately narrow: read and edit only. The loop runs the
// tests and the build itself, so a builder never needs a shell to be accepted.
export const CC_TOOLS = 'Read,Write,Edit,Glob,Grep';

// A reconnaissance lane only reports what it found, so it gets no write tool at
// all. That is what makes it safe to run against the primary worktree with no
// worktree of its own, and it is why several recon lanes can share one tree.
export const CC_READONLY_TOOLS = 'Read,Glob,Grep';

function quote(value) {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function envWithSafeGitDirectory(cwd) {
  const env = { ...process.env };
  const parsed = Number.parseInt(env.GIT_CONFIG_COUNT ?? '0', 10);
  const index = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  env.GIT_CONFIG_COUNT = String(index + 1);
  env[`GIT_CONFIG_KEY_${index}`] = 'safe.directory';
  env[`GIT_CONFIG_VALUE_${index}`] = path.resolve(cwd);
  return env;
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
    invoke({ promptText, tools }) {
      return {
        args: ['-p', '--permission-mode', 'acceptEdits', '--allowedTools', tools ?? CC_TOOLS, '--output-format', 'text'],
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

// Killing a timed-out builder is not as simple as child.kill(). Every builder
// is launched through a shell, so the child is the shell and the builder is its
// grandchild. On Windows a SIGTERM to cmd.exe leaves the real process running,
// holding the stdio pipes open, so 'close' never fires and a hung builder would
// stall its lane indefinitely past the timeout it was given. Killing the whole
// tree is what makes the timeout real.
export function killTree(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      // Negative pid targets the process group created for the shell.
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  } catch {
    // Nothing further to try; the close handler still resolves the promise.
  }
}

// Concurrent lanes are the whole point of the mission harness, and spawnSync
// makes concurrency impossible: the first builder blocks the event loop until
// it exits, so four independent lanes cost four serial builder runs. This is
// the same descriptor contract, awaited instead of blocked on, so a scheduler
// can hold N builders in flight at once. launchBuilder below is unchanged and
// still serves the single-attempt loop.
export function launchBuilderAsync(
  builder,
  { cwd, promptText, attemptDir, tools, timeoutMs = DEFAULT_TIMEOUT_MS },
  { spawnFn = spawn } = {},
) {
  const plan = builder.invoke({ cwd, promptText, attemptDir, tools });
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFn(builder.command, plan.args, {
        cwd,
        shell: true,
        windowsHide: true,
        env: envWithSafeGitDirectory(cwd),
      });
    } catch (error) {
      resolve({
        builderId: builder.id,
        launched: false,
        exitCode: null,
        timedOut: false,
        durationMs: 0,
        stdout: '',
        stderr: String(error?.message ?? error),
        finalMessage: null,
        claim: 'UNKNOWN',
        error: String(error?.message ?? error),
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    // Bounded in memory on purpose: a runaway builder must not exhaust the
    // orchestrator's heap and take every other lane down with it.
    const cap = 32 * 1024 * 1024;
    child.stdout?.on('data', (chunk) => {
      if (stdout.length < cap) stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < cap) stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);

    const finish = (exitCode, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      let finalMessage = null;
      if (plan.finalMessageFile) {
        const file = path.join(attemptDir, plan.finalMessageFile);
        if (existsSync(file)) finalMessage = readFileSync(file, 'utf8');
      }
      resolve({
        builderId: builder.id,
        launched: !error && exitCode === 0,
        exitCode,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
        finalMessage,
        claim: builder.claimFrom(finalMessage ?? stdout, stderr),
        error: error ? String(error) : null,
      });
    };

    child.on('error', (error) => finish(null, error?.message ?? error));
    child.on('close', (code) => finish(code));

    if (plan.stdin !== null || !plan.finalMessageFile) {
      child.stdin?.end(plan.stdin ?? promptText);
    } else {
      child.stdin?.end(promptText);
    }
  });
}

export function launchBuilder(builder, { cwd, promptText, attemptDir, tools, timeoutMs = DEFAULT_TIMEOUT_MS }, { run = spawnSync } = {}) {
  const plan = builder.invoke({ cwd, promptText, attemptDir, tools });
  const startedAt = Date.now();
  const result = run(builder.command, plan.args, {
    cwd,
    shell: true,
    encoding: 'utf8',
    env: envWithSafeGitDirectory(cwd),
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
