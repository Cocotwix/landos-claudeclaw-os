#!/usr/bin/env node
// Provider-neutral worker registry for the LandOS build runner.
//
// A builder is an interchangeable coding agent. Adding another (DeepSeek,
// Hermes, anything else) means adding one descriptor here. Nothing else moves.
//
// Workers get a shell. The previous harness deliberately withheld it and told
// every worker "do not run tests or builds: the harness runs them itself".
// That single line is what produced the 9490 repair spiral: four blind repair
// rounds, three mission-level FAILs on an exhausted repair budget, and ~56
// minutes of dead air waiting for a human to resume. A capable agent that can
// run the one test it just broke fixes it in the same turn, for free.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

// Read, edit, and verify. A worker that cannot run its own test cannot know it
// is done, and every unverified claim becomes the outer loop's problem.
export const WORKER_TOOLS = 'Read,Write,Edit,Glob,Grep,Bash';
export const READONLY_TOOLS = 'Read,Glob,Grep';

function quote(value) {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

// Worktrees are gone, but the runner still shells out to git inside the repo
// root from a spawned process tree. Pinning safe.directory keeps that read
// working on Windows without touching the user's global git config.
function envWithSafeGitDirectory(cwd) {
  const env = { ...process.env };
  const parsed = Number.parseInt(env.GIT_CONFIG_COUNT ?? '0', 10);
  const index = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  env.GIT_CONFIG_COUNT = String(index + 1);
  env[`GIT_CONFIG_KEY_${index}`] = 'safe.directory';
  env[`GIT_CONFIG_VALUE_${index}`] = path.resolve(cwd);
  return env;
}

// Some builders echo the prompt, and the prompt names both tokens. Only the
// last occurrence can be the worker's own sign-off.
function claimFromText(text) {
  const complete = String(text).lastIndexOf('WORK_COMPLETE');
  const blocked = String(text).lastIndexOf('WORK_BLOCKED');
  if (complete === -1 && blocked === -1) return 'UNKNOWN';
  return complete > blocked ? 'COMPLETE' : 'BLOCKED';
}

export const BUILDERS = [
  {
    id: 'cc',
    label: 'Claude Code',
    command: 'claude',
    version: ['--version'],
    invoke({ promptText, tools }) {
      return {
        args: [
          '-p',
          '--permission-mode',
          'acceptEdits',
          '--allowedTools',
          tools ?? WORKER_TOOLS,
          '--output-format',
          'text',
        ],
        stdin: promptText,
      };
    },
    claimFrom: (stdout, stderr) => claimFromText(`${stdout}\n${stderr}`),
  },
  {
    id: 'codex',
    label: 'OpenAI Codex',
    command: 'codex',
    version: ['--version'],
    invoke({ cwd, attemptDir }) {
      return {
        args: ['exec', '--cd', cwd, '-s', 'danger-full-access', '-o', path.join(attemptDir, 'final.txt'), '-'],
        stdin: null,
        finalMessageFile: 'final.txt',
      };
    },
    claimFrom: (stdout, stderr) => claimFromText(`${stdout}\n${stderr}`),
  },
];

// Windows only creates a console window for a launch that actually needs a
// console. A builder run through a shell gets a cmd.exe wrapper, and that
// wrapper owns a console: windowsHide suppresses the wrapper's own window, but
// a console/TUI builder underneath it (codex exec) materializes that console
// anyway, and Windows 11 hands the materialized console to the default
// terminal, which opens a real, focus-stealing window in the middle of a
// sprint. Launching the builder image directly leaves no wrapper console to
// materialize. Builders that only ship a .cmd/.bat shim cannot run without a
// shell, so those keep the wrapper rather than failing to launch at all.
const DIRECT_WINDOWS_EXTENSIONS = ['.exe', '.com'];

export function resolveLaunch(
  command,
  { platform = process.platform, env = process.env, exists = existsSync } = {},
) {
  if (platform !== 'win32') return { command, shell: false };

  const direct = (value) => DIRECT_WINDOWS_EXTENSIONS.includes(path.extname(value).toLowerCase());
  if (path.isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    return { command, shell: !direct(command) };
  }

  const named = path.extname(command) !== '';
  const candidates = named ? [command] : DIRECT_WINDOWS_EXTENSIONS.map((ext) => `${command}${ext}`);
  const dirs = String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const candidate of candidates) {
      const full = path.join(dir, candidate);
      if (exists(full) && direct(full)) return { command: full, shell: false };
    }
  }
  return { command, shell: true };
}

export function getBuilder(id, registry = BUILDERS) {
  const builder = registry.find((entry) => entry.id === id);
  if (!builder) throw new Error(`Unknown builder "${id}". Known: ${registry.map((e) => e.id).join(', ')}`);
  return builder;
}

export function detectBuilder(builder, { run = spawnSync, resolveFn = resolveLaunch } = {}) {
  const launch = resolveFn(builder.command);
  const result = run(launch.command, builder.version, {
    shell: launch.shell,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { id: builder.id, label: builder.label, available: !result.error && result.status === 0 };
}

export function availableBuilderIds(registry = BUILDERS, deps = {}) {
  return registry.filter((builder) => detectBuilder(builder, deps).available).map((builder) => builder.id);
}

// Round-robin over whoever is actually up. A provider going down mid-run costs
// the next lane's builder choice, never a mission rebuild.
export function nextBuilderId(currentId, available) {
  const pool = available.filter(Boolean);
  if (!pool.length) return currentId;
  const index = pool.indexOf(currentId);
  return index === -1 ? pool[0] : pool[(index + 1) % pool.length];
}

// The child is the builder itself, or a cmd.exe wrapper when only a shim was
// resolvable. On Windows a SIGTERM to cmd.exe leaves the real process holding
// the stdio pipes open and 'close' never fires, and a builder spawns children
// of its own either way. Killing the tree is what makes a timeout real.
export function killTree(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  } catch {
    // The close handler still resolves the promise.
  }
}

export function launchWorker(
  builder,
  { cwd, promptText, attemptDir, tools, timeoutMs = DEFAULT_TIMEOUT_MS },
  { spawnFn = spawn, resolveFn = resolveLaunch } = {},
) {
  const plan = builder.invoke({ cwd, promptText, attemptDir, tools });
  const launch = resolveFn(builder.command);
  // Node joins argv into one command string for a shell launch and quotes
  // nothing; without a shell it quotes each argument itself, and a
  // pre-quoted argument would reach the builder with literal quotes in it.
  const args = launch.shell ? plan.args.map(quote) : plan.args;
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFn(launch.command, args, {
        cwd,
        shell: launch.shell,
        windowsHide: true,
        env: envWithSafeGitDirectory(cwd),
      });
    } catch (error) {
      resolve({
        builderId: builder.id,
        exitCode: null,
        timedOut: false,
        durationMs: 0,
        stdout: '',
        stderr: String(error?.message ?? error),
        claim: 'UNKNOWN',
        error: String(error?.message ?? error),
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const cap = 8 * 1024 * 1024;

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
    child.stdin?.end(plan.stdin ?? promptText);
  });
}
