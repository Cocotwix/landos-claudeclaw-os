/**
 * Hive CLI regression suite.
 *
 * The property that matters most: the CLI reads the store LandOS actually
 * resolves, never a hardcoded or repo-relative guess. A shell `sqlite3` against
 * $PROJECT_ROOT/store cannot honor a `.env`-relocated CLAUDECLAW_STORE_DIR and
 * will silently read the wrong database; this CLI resolves through config.ts.
 *
 * Every test runs against a throwaway store, so the live LandOS database is
 * never opened.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');
const CLI_SRC = path.join(__dirname, 'hive-cli.ts');
const TSX = path.join(PROJECT_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const TEST_DB_KEY = 'a'.repeat(64);

let tmpRoot: string;
let storeDir: string;
let otherStoreDir: string;

interface RunResult { status: number; stdout: string; stderr: string; }

/**
 * @param cwd  Where to invoke from. Defaults to the repo root; tests override it
 *             to prove the CLI works from other supported invocation contexts.
 */
function run(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): RunResult {
  const res = spawnSync(process.execPath, [TSX, CLI_SRC, ...args], {
    cwd: opts.cwd ?? PROJECT_DIR,
    env: {
      ...process.env,
      DB_ENCRYPTION_KEY: TEST_DB_KEY,
      CLAUDECLAW_STORE_DIR: storeDir,
      CLAUDECLAW_AGENT_ID: 'main',
      ...opts.env,
    },
    encoding: 'utf-8',
    windowsHide: true,
  });
  return { status: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/** Seed a store directly, so the CLI's reads are proved against known rows. */
function seed(dir: string, rows: { missions?: number; failed?: boolean }): void {
  fs.mkdirSync(dir, { recursive: true });
  // Create the schema by letting the CLI itself initialise the store, then
  // insert through a plain connection.
  const before = { ...process.env };
  void before;
  const init = spawnSync(process.execPath, [TSX, CLI_SRC, 'status'], {
    cwd: PROJECT_DIR,
    env: { ...process.env, DB_ENCRYPTION_KEY: TEST_DB_KEY, CLAUDECLAW_STORE_DIR: dir },
    encoding: 'utf-8',
    windowsHide: true,
  });
  expect(init.status, init.stderr).toBe(0);

  const db = new Database(path.join(dir, 'claudeclaw.db'));
  const insert = db.prepare(
    `INSERT INTO mission_tasks (id, title, prompt, assigned_agent, status, result, error, failure_category, created_by, priority, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < (rows.missions ?? 0); i += 1) {
    insert.run(
      `task${i}`, `Title ${i}`, `Prompt ${i}`, 'research',
      rows.failed ? 'failed' : 'queued',
      null,
      rows.failed ? '[auth] provider rejected the credential' : null,
      rows.failed ? 'auth' : null,
      'main', 5, 1_700_000_000 + i, rows.failed ? 1_700_000_100 + i : null,
    );
  }
  db.prepare(
    `INSERT INTO scheduled_tasks (id, prompt, schedule, next_run, status, created_at, agent_id, last_status, last_failure_category)
     VALUES ('sched1', 'daily digest', '0 9 * * *', 1700000000, 'active', 1700000000, 'main', 'failed', 'rate_limit')`,
  ).run();
  db.prepare(
    `INSERT INTO hive_mind (agent_id, chat_id, action, summary, created_at)
     VALUES ('research', 'cli', 'seeded', 'a seeded hive entry', 1700000000)`,
  ).run();
  db.close();
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-hive-cli-'));
  storeDir = path.join(tmpRoot, 'store');
  otherStoreDir = path.join(tmpRoot, 'relocated-store');
  fs.mkdirSync(storeDir, { recursive: true });
});

afterEach(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* windows handle lag */ }
});

describe('store resolution', () => {
  it('resolves the store LandOS resolves, not a repo-relative guess', () => {
    const res = run(['path']);
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe(path.join(storeDir, 'claudeclaw.db'));
    expect(res.stdout).not.toContain(path.join(PROJECT_DIR, 'store'));
  });

  it('answers `path` without opening the database or needing an encryption key', () => {
    const res = run(['path'], { env: { DB_ENCRYPTION_KEY: '' } });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe(path.join(storeDir, 'claudeclaw.db'));
    // Nothing was created just to answer "where is my store?".
    expect(fs.existsSync(path.join(storeDir, 'claudeclaw.db'))).toBe(false);
  });

  it('honors an explicit --store override', () => {
    fs.mkdirSync(otherStoreDir, { recursive: true });
    const res = run(['path', '--store', otherStoreDir]);
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe(path.join(otherStoreDir, 'claudeclaw.db'));
  });

  it('reads rows from the overridden store, not the default one', () => {
    seed(otherStoreDir, { missions: 2 });
    // The default store (CLAUDECLAW_STORE_DIR) is untouched and empty.
    const defaulted = run(['missions']);
    expect(defaulted.stdout).toContain('No mission tasks match.');

    const overridden = run(['missions', '--store', otherStoreDir]);
    expect(overridden.status).toBe(0);
    expect(overridden.stdout).toContain('task0');
    expect(overridden.stdout).toContain('task1');
  });

  it('rejects an empty --store value instead of silently falling back', () => {
    const res = run(['path', '--store', '']);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('--store requires a directory path.');
  });
});

describe('invocation contexts', () => {
  it('works when invoked from the repository root', () => {
    expect(run(['status'], { cwd: PROJECT_DIR }).status).toBe(0);
  });

  it('works when invoked from a subdirectory of the repository', () => {
    const res = run(['status'], { cwd: path.join(PROJECT_DIR, 'src') });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Store dir');
  });

  it('works when invoked from an unrelated directory', () => {
    // The store comes from config.ts, not from process.cwd().
    const res = run(['path'], { cwd: os.tmpdir() });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe(path.join(storeDir, 'claudeclaw.db'));
  });
});

describe('human-readable output', () => {
  beforeEach(() => seed(storeDir, { missions: 2 }));

  it('status reports runtime identity, store location and live counts', () => {
    const res = run(['status']);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Runtime agent : main');
    // The managed LandOS process is reported separately from the sub-agents;
    // in a throwaway store there is no pid file, so it reads "not running".
    expect(res.stdout).toContain('Runtime proc  : not running');
    expect(res.stdout).toContain('Project root  :');
    expect(res.stdout).toContain(storeDir);
    expect(res.stdout).toContain('Mission tasks :');
    expect(res.stdout).toContain('2 queued');
    expect(res.stdout).toContain('Scheduled     : 1');
  });

  it('missions lists tasks with their agent, originator and priority', () => {
    const res = run(['missions']);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('2 mission tasks');
    expect(res.stdout).toContain('[queued]');
    expect(res.stdout).toContain('@research');
    expect(res.stdout).toContain('by main');
  });

  it('missions honors --agent, --status, --created-by and --limit', () => {
    expect(run(['missions', '--agent', 'nobody']).stdout).toContain('No mission tasks match.');
    expect(run(['missions', '--status', 'completed']).stdout).toContain('No mission tasks match.');
    expect(run(['missions', '--created-by', 'someone-else']).stdout).toContain('No mission tasks match.');
    expect(run(['missions', '--limit', '1']).stdout).toContain('1 mission task:');
  });

  it('task shows one task in full plus its originator', () => {
    const res = run(['task', 'task0']);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Task      : task0');
    expect(res.stdout).toContain('Originator: main');
    expect(res.stdout).toContain('Prompt 0');
    expect(res.stdout).toContain('Other tasks from main: task1');
  });

  it('scheduled shows the cron, next run and last failure category', () => {
    const res = run(['scheduled']);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('0 9 * * *');
    expect(res.stdout).toContain('rate_limit');
  });

  it('hive shows recent hive_mind entries', () => {
    const res = run(['hive']);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('@research');
    expect(res.stdout).toContain('a seeded hive entry');
  });

  it('agents lists configured agents without printing any bot token', () => {
    const res = run(['agents']);
    expect(res.status).toBe(0);
    // Names/roles are safe; the agent's telegram token must never appear.
    expect(res.stdout).not.toMatch(/\d{8,}:[A-Za-z0-9_-]{30,}/);
    expect(res.stdout).not.toMatch(/bot_?token/i);
  });
});

describe('failure inspection', () => {
  beforeEach(() => seed(storeDir, { missions: 2, failed: true }));

  it('failures leads with the classification so a provider problem is obvious', () => {
    const res = run(['failures']);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('2 recent failures');
    expect(res.stdout).toContain('[auth]');
    expect(res.stdout).toContain('provider rejected the credential');
  });

  it('failures honors --limit', () => {
    expect(run(['failures', '--limit', '1']).stdout).toContain('1 recent failure:');
  });
});

describe('JSON output', () => {
  beforeEach(() => seed(storeDir, { missions: 2, failed: true }));

  const jsonCommands: string[][] = [
    ['path'], ['status'], ['agents'], ['missions'], ['failures'], ['scheduled'], ['hive'], ['task', 'task0'],
  ];

  for (const cmd of jsonCommands) {
    it(`emits valid JSON for \`${cmd.join(' ')}\``, () => {
      const res = run([...cmd, '--json']);
      expect(res.status, res.stderr).toBe(0);
      expect(() => JSON.parse(res.stdout)).not.toThrow();
    });
  }

  it('missions JSON carries the failure category', () => {
    const rows = JSON.parse(run(['missions', '--json']).stdout) as Array<{ failure_category: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].failure_category).toBe('auth');
  });

  it('status JSON reports the resolved store and whether it was overridden', () => {
    const payload = JSON.parse(run(['status', '--json']).stdout) as { storeDir: string; storeOverridden: boolean };
    expect(payload.storeDir).toBe(storeDir);
    expect(payload.storeOverridden).toBe(false);
    const overridden = JSON.parse(run(['status', '--json', '--store', storeDir]).stdout) as { storeOverridden: boolean };
    expect(overridden.storeOverridden).toBe(true);
  });
});

describe('help, usage and exit codes', () => {
  it('prints help and exits 0 with no arguments', () => {
    const res = run([]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('LandOS Hive CLI');
    expect(res.stdout).toContain('Read commands:');
    expect(res.stdout).toContain('Exit codes:');
  });

  it('prints help for --help and for the help command', () => {
    expect(run(['--help']).status).toBe(0);
    expect(run(['help']).stdout).toContain('LandOS Hive CLI');
  });

  it('warns against raw sqlite3 against the store', () => {
    expect(run(['help']).stdout).toContain('Never run raw sqlite3 against the store');
  });

  it('exits 1 on an unknown command and shows usage', () => {
    const res = run(['frobnicate']);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Unknown command: "frobnicate"');
    expect(res.stderr).toContain('Usage:');
  });

  it('exits 1 on an unknown option', () => {
    const res = run(['missions', '--bogus']);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Unknown option: --bogus');
  });

  it('exits 1 on a non-numeric --limit', () => {
    const res = run(['missions', '--limit', 'many']);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('--limit must be a positive integer');
  });

  it('exits 2 when a task id does not exist', () => {
    seed(storeDir, { missions: 1 });
    const res = run(['task', 'nope']);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('Mission task not found: nope');
  });

  it('exits 1 when `log` is missing its required flags', () => {
    const res = run(['log', '--action', 'did-a-thing']);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Usage: hive-cli log');
  });
});

describe('the single write command', () => {
  it('appends one hive_mind entry and nothing else', () => {
    seed(storeDir, { missions: 1 });
    const before = JSON.parse(run(['hive', '--json']).stdout) as unknown[];

    const logged = run(['log', '--action', 'phase-check', '--summary', 'reliability phase verified', '--agent', 'ops']);
    expect(logged.status).toBe(0);
    expect(logged.stdout).toContain('Logged to hive mind as @ops');

    const after = JSON.parse(run(['hive', '--json']).stdout) as Array<{ agent_id: string; action: string }>;
    expect(after.length).toBe(before.length + 1);
    expect(after[0].agent_id).toBe('ops');
    expect(after[0].action).toBe('phase-check');

    // Mission tasks are untouched — `log` is not a broad mutation surface.
    expect(JSON.parse(run(['missions', '--json']).stdout)).toHaveLength(1);
  });
}, 120_000);
