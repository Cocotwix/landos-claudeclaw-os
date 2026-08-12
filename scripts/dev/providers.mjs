#!/usr/bin/env node
// Explicit builder selection for LandOS direct development.
//
// A builder is one capable coding agent that owns the whole change. The
// developer names it; this module does not probe, rank, round-robin, or fail
// over. Provider neutrality here means one invocation contract that different
// capable agents can satisfy, not a router that decides for you.
//
// Nothing in this file interprets what the builder said. Whether the work is
// done is decided by deterministic checks in verify.mjs, never by the agent's
// own sign-off.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

// Read, edit, search, and run. A builder that cannot run the test it just broke
// cannot iterate, and every unverified guess becomes the outer loop's problem.
const CLAUDE_TOOLS = 'Read,Write,Edit,Glob,Grep,Bash';

export const ENGINES = {
  claude: {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
    // A session id we choose ourselves makes the repair continuation exact:
    // there is no picker, no "most recent session" guess, no wrong thread.
    start({ sessionId, model }) {
      return {
        args: [
          '-p',
          '--session-id',
          sessionId,
          '--permission-mode',
          'acceptEdits',
          '--allowedTools',
          CLAUDE_TOOLS,
          '--output-format',
          'json',
          ...(model ? ['--model', model] : []),
        ],
        promptVia: 'stdin',
      };
    },
    resume({ sessionId, model }) {
      if (!sessionId) return null;
      return {
        args: [
          '-p',
          '--resume',
          sessionId,
          '--permission-mode',
          'acceptEdits',
          '--allowedTools',
          CLAUDE_TOOLS,
          '--output-format',
          'json',
          ...(model ? ['--model', model] : []),
        ],
        promptVia: 'stdin',
      };
    },
    // `--output-format json` prints one object; take the ids from it.
    read({ stdout }) {
      const parsed = lastJsonObject(stdout);
      return {
        sessionId: parsed?.session_id ?? parsed?.sessionId ?? null,
        model: parsed?.model ?? Object.keys(parsed?.modelUsage ?? {})[0] ?? null,
        finalMessage: typeof parsed?.result === 'string' ? parsed.result : null,
      };
    },
  },

  codex: {
    id: 'codex',
    label: 'OpenAI Codex',
    command: 'codex',
    start({ cwd, model, lastMessageFile }) {
      return {
        args: [
          'exec',
          '--cd',
          cwd,
          '-s',
          'danger-full-access',
          '--json',
          '-o',
          lastMessageFile,
          ...(model ? ['--model', model] : []),
          '-',
        ],
        promptVia: 'stdin',
      };
    },
    // `codex exec resume` takes neither --cd nor -s, so the working directory
    // comes from the spawn and the sandbox mode from a config override. It also
    // binds the first positional to SESSION_ID, so resuming without a captured
    // id would risk continuing somebody else's thread: refuse instead.
    resume({ sessionId, model, lastMessageFile }) {
      if (!sessionId) return null;
      return {
        args: [
          'exec',
          'resume',
          sessionId,
          '-c',
          'sandbox_mode="danger-full-access"',
          '--json',
          '-o',
          lastMessageFile,
          ...(model ? ['--model', model] : []),
          '-',
        ],
        promptVia: 'stdin',
      };
    },
    read({ stdout, lastMessageFile }) {
      let sessionId = null;
      let model = null;
      for (const line of String(stdout).split(/\r?\n/)) {
        if (!line.startsWith('{')) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        sessionId ??= event.thread_id ?? event.session_id ?? event.conversation_id ?? null;
        model ??= typeof event.model === 'string' ? event.model : null;
      }
      const finalMessage =
        lastMessageFile && existsSync(lastMessageFile) ? readFileSync(lastMessageFile, 'utf8') : null;
      return { sessionId, model, finalMessage };
    },
  },
};

export const ENGINE_IDS = Object.keys(ENGINES);

/** Look up an explicitly named engine. There is no default and no fallback. */
export function getEngine(id) {
  const engine = ENGINES[id];
  if (!engine) {
    throw new Error(`Unknown engine "${id ?? ''}". Choose one explicitly: ${ENGINE_IDS.join(', ')}`);
  }
  return engine;
}

function lastJsonObject(text) {
  const lines = String(text).split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line.startsWith('{')) continue;
    try {
      return JSON.parse(line);
    } catch {
      // Not the object we want; keep walking backwards.
    }
  }
  try {
    return JSON.parse(String(text).trim());
  } catch {
    return null;
  }
}

// Every engine launches through a shell, so the child is the shell and the
// agent is its grandchild. On Windows a signal to cmd.exe leaves the real
// process holding the stdio pipes open and 'close' never fires. Killing the
// tree is what makes a timeout real.
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
    // The close handler still settles the promise.
  }
}

/**
 * Run one builder turn. `phase` is 'start' for the task and 'resume' for the
 * single repair continuation, which reuses the same agent context.
 */
export function runEngine(
  engine,
  { cwd, prompt, sessionId, model, runDir, phase = 'start', timeoutMs = DEFAULT_TIMEOUT_MS },
  { spawnFn = spawn } = {},
) {
  const lastMessageFile = path.join(runDir, `${phase}-final.txt`);
  const plan = engine[phase]({ cwd, sessionId, model, lastMessageFile });
  if (!plan) {
    return Promise.resolve({
      engineId: engine.id,
      unsupported: true,
      reason: `${engine.label} cannot resume without a captured session id`,
      exitCode: null,
      durationMs: 0,
      stdout: '',
      stderr: '',
      sessionId,
      model,
      finalMessage: null,
    });
  }

  const startedAt = Date.now();
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFn(engine.command, plan.args, { cwd, shell: true, windowsHide: true });
    } catch (error) {
      resolve({
        engineId: engine.id,
        exitCode: null,
        durationMs: Date.now() - startedAt,
        stdout: '',
        stderr: String(error?.message ?? error),
        sessionId,
        model,
        finalMessage: null,
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
      const read = engine.read({ stdout, stderr, lastMessageFile });
      resolve({
        engineId: engine.id,
        exitCode,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
        sessionId: read.sessionId ?? sessionId ?? null,
        model: model ?? read.model ?? null,
        finalMessage: read.finalMessage,
        error: error ? String(error) : null,
      });
    };

    child.on('error', (error) => finish(null, error?.message ?? error));
    child.on('close', (code) => finish(code));
    child.stdin?.end(prompt);
  });
}
