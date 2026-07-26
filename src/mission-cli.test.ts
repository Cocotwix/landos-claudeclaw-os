/**
 * Mission CLI process-level regression suite.
 *
 * mission-cli-args.test.ts proves the parser's decisions. This file proves the
 * decisions reach the process boundary: a rejected command line exits non-zero
 * and writes nothing to the store, and valid commands still work.
 *
 * Each test points CLAUDECLAW_STORE_DIR at a fresh temp directory, so the live
 * LandOS store is never touched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');
const CLI_SRC = path.join(__dirname, 'mission-cli.ts');
const TSX = path.join(PROJECT_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');

// The CLI loads real config, which requires a DB_ENCRYPTION_KEY of >= 32 hex
// chars. A throwaway key keeps these tests hermetic and independent of .env.
const TEST_DB_KEY = 'a'.repeat(64);

let tmpRoot: string;
let storeDir: string;

interface RunResult { status: number; stdout: string; stderr: string; }

function run(args: string[]): RunResult {
  const res = spawnSync(process.execPath, [TSX, CLI_SRC, ...args], {
    cwd: PROJECT_DIR,
    env: {
      ...process.env,
      DB_ENCRYPTION_KEY: TEST_DB_KEY,
      CLAUDECLAW_STORE_DIR: storeDir,
      CLAUDECLAW_AGENT_ID: 'main',
    },
    encoding: 'utf-8',
    windowsHide: true,
  });
  return { status: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-mission-cli-'));
  storeDir = path.join(tmpRoot, 'store');
  fs.mkdirSync(storeDir, { recursive: true });
});

afterEach(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* windows handle lag */ }
});

describe('mission-cli rejects unknown flags before any mutation', () => {
  it('exits non-zero, names the flag, and creates nothing', () => {
    const rejected = run(['create', '--agent', 'main', '--title', 'X', '--body', 'oops', 'real prompt']);
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain('Unknown flag: --body');
    expect(rejected.stderr).toContain('No mission task was created or modified.');
    expect(rejected.stdout).not.toContain('Mission task created');

    // Nothing was written — the store is still empty.
    const listed = run(['list']);
    expect(listed.status).toBe(0);
    expect(listed.stdout).toContain('No mission tasks');
  });

  it('does not even create the database file when parsing fails', () => {
    const dbPath = path.join(storeDir, 'claudeclaw.db');
    expect(fs.existsSync(dbPath)).toBe(false);

    const rejected = run(['create', '--agent', 'main', '--body', 'oops', 'p']);
    expect(rejected.status).not.toBe(0);
    // Parsing runs before initDatabase(), so the rejected run touched nothing.
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it('rejects an unknown short flag', () => {
    const rejected = run(['create', '-a', 'main', 'the prompt']);
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain('-a');
  });

  it('rejects an unsupported --status value on list', () => {
    const rejected = run(['list', '--status', 'quued']);
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain('Unsupported --status value');
  });

  it('rejects an unquoted multi-word prompt', () => {
    const rejected = run(['create', '--agent', 'main', 'these', 'are', 'four', 'words']);
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain('positional argument');
    expect(run(['list']).stdout).toContain('No mission tasks');
  });
});

describe('valid mission-cli commands still work', () => {
  it('creates, lists, reads and cancels a task', () => {
    const created = run(['create', '--agent', 'research', '--title', 'Label', '--priority', '7', 'the real prompt']);
    expect(created.status).toBe(0);
    expect(created.stdout).toContain('Mission task created');
    expect(created.stdout).toContain('Label');
    expect(created.stdout).toContain('research');
    expect(created.stdout).toContain('the real prompt');

    const id = /Mission task created: ([0-9a-f]+)/.exec(created.stdout)?.[1];
    expect(id).toBeDefined();

    const listed = run(['list']);
    expect(listed.status).toBe(0);
    expect(listed.stdout).toContain(id!);
    expect(listed.stdout).toContain('Label');

    const filtered = run(['list', '--status', 'queued']);
    expect(filtered.status).toBe(0);
    expect(filtered.stdout).toContain(id!);

    const result = run(['result', id!]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No result yet.');

    const cancelled = run(['cancel', id!]);
    expect(cancelled.status).toBe(0);
    expect(cancelled.stdout).toContain('Cancelled task');
  });

  it('creates an unassigned task when --agent is omitted', () => {
    const created = run(['create', 'a prompt with no agent']);
    expect(created.status).toBe(0);
    expect(created.stdout).toContain('unassigned');
  });

  it('prints usage for help and exits zero', () => {
    const helped = run(['help']);
    expect(helped.status).toBe(0);
    expect(helped.stdout).toContain('LandOS mission CLI');
    expect(run(['--help']).status).toBe(0);
  });

  it('accepts a dash-leading prompt after `--`', () => {
    const created = run(['create', '--agent', 'main', '--', '--this really is the prompt']);
    expect(created.status).toBe(0);
    expect(created.stdout).toContain('--this really is the prompt');
  });
}, 60_000);
