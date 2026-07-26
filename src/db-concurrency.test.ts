/**
 * Scheduler / mission SQLite contention regression suite.
 *
 * These tests use a REAL on-disk database. An `:memory:` database is private to
 * its own connection and therefore cannot produce lock contention at all, so
 * the rest of the suite (which uses `_initTestDatabase()`) could never have
 * caught this class of bug.
 *
 * The failure being pinned: `claimNextMissionTask` used a DEFERRED transaction.
 * The SELECT took a read snapshot, and the UPDATE then had to UPGRADE to a
 * write lock. SQLite refuses a stale-snapshot upgrade with SQLITE_BUSY_SNAPSHOT
 * *immediately*, without consulting `busy_timeout`, because waiting could
 * deadlock. Under overlapping writes the poller therefore threw on every tick
 * and the agent's queue stalled — and a completion write that lost the same
 * race left a finished task stuck in 'running' with its output discarded.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  _initTestDatabase,
  _closeTestDatabase,
  withBusyRetry,
  createMissionTask,
  claimNextMissionTask,
  completeMissionTask,
  getMissionTask,
  getMissionTasks,
  createScheduledTask,
  claimScheduledTask,
  getDueTasks,
  getAllScheduledTasks,
  updateTaskAfterRun,
} from './db.js';

let tmpDir: string;
let dbPath: string;

function freshStore(): void {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-db-concurrency-'));
  dbPath = path.join(tmpDir, 'claudeclaw.db');
}

function cleanupStore(): void {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* windows handle lag */ }
}

/** A second, independent connection to the same file — a stand-in for a sibling agent process. */
function openSecondConnection(): Database.Database {
  const other = new Database(dbPath);
  other.pragma('journal_mode = WAL');
  other.pragma('busy_timeout = 5000');
  return other;
}

// ── 1. Root cause, proved directly against SQLite ────────────────────

describe('SQLITE_BUSY root cause: DEFERRED lock upgrade', () => {
  beforeEach(freshStore);
  afterEach(cleanupStore);

  it('a DEFERRED read-then-write transaction fails immediately and does NOT honor busy_timeout', () => {
    const a = openSecondConnection();
    const b = openSecondConnection();
    a.exec(`CREATE TABLE claimable (id INTEGER PRIMARY KEY, status TEXT NOT NULL)`);
    a.prepare('INSERT INTO claimable VALUES (1, ?)').run('queued');
    a.prepare('INSERT INTO claimable VALUES (2, ?)').run('queued');

    // This is exactly the old claim shape: BEGIN (deferred) → SELECT → UPDATE.
    a.exec('BEGIN DEFERRED');
    const row = a.prepare(`SELECT * FROM claimable WHERE status = 'queued' LIMIT 1`).get() as { id: number };

    // A sibling writer commits between our read and our write.
    b.prepare('UPDATE claimable SET status = ? WHERE id = 2').run('running');

    const started = Date.now();
    let thrown: (Error & { code?: string }) | undefined;
    try {
      a.prepare(`UPDATE claimable SET status = 'running' WHERE id = ?`).run(row.id);
    } catch (err) {
      thrown = err as Error & { code?: string };
    }
    const elapsed = Date.now() - started;

    expect(thrown, 'the DEFERRED upgrade must fail — this is the bug').toBeDefined();
    expect(thrown?.code).toMatch(/^SQLITE_BUSY/);
    // The whole point: busy_timeout is 5000ms, yet it gives up instantly.
    expect(elapsed).toBeLessThan(1000);

    try { a.exec('ROLLBACK'); } catch { /* already rolled back */ }
    a.close();
    b.close();
  });

  it('the same sequence under BEGIN IMMEDIATE takes the write lock up front and succeeds', () => {
    const a = openSecondConnection();
    const b = openSecondConnection();
    a.exec(`CREATE TABLE claimable (id INTEGER PRIMARY KEY, status TEXT NOT NULL)`);
    a.prepare('INSERT INTO claimable VALUES (1, ?)').run('queued');
    a.prepare('INSERT INTO claimable VALUES (2, ?)').run('queued');
    b.prepare('UPDATE claimable SET status = ? WHERE id = 2').run('running');

    expect(() => {
      a.exec('BEGIN IMMEDIATE');
      const row = a.prepare(`SELECT * FROM claimable WHERE status = 'queued' LIMIT 1`).get() as { id: number };
      a.prepare(`UPDATE claimable SET status = 'running' WHERE id = ?`).run(row.id);
      a.exec('COMMIT');
    }).not.toThrow();

    a.close();
    b.close();
  });
});

// ── 2. The repaired claim path, on a real file store ─────────────────

describe('claimNextMissionTask under concurrent writers', () => {
  beforeEach(() => {
    freshStore();
    _initTestDatabase(dbPath);
  });
  afterEach(() => {
    _closeTestDatabase();
    cleanupStore();
  });

  it('claims successfully while a sibling connection is committing writes', () => {
    createMissionTask('m1', 'first', 'do the thing', 'research', 'main', 5);
    createMissionTask('m2', 'second', 'do the other thing', 'research', 'main', 1);

    const sibling = openSecondConnection();
    // Sibling commits between ticks, exactly the interleaving that used to
    // invalidate the claimer's read snapshot.
    sibling.prepare(`UPDATE mission_tasks SET title = ? WHERE id = 'm2'`).run('touched');

    const claimed = claimNextMissionTask('research');
    expect(claimed).not.toBeNull();
    expect(claimed?.id).toBe('m1'); // higher priority first
    expect(claimed?.status).toBe('running');
    expect(getMissionTask('m1')?.status).toBe('running');

    sibling.close();
  });

  it('before/after: the old DEFERRED claim shape throws on mission_tasks where the repaired one succeeds', () => {
    createMissionTask('m1', 'first', 'p', 'research', 'main', 5);
    createMissionTask('m2', 'second', 'p', 'research', 'main', 1);

    const claimer = openSecondConnection();
    const sibling = openSecondConnection();

    // ── BEFORE: verbatim reconstruction of the pre-fix claim transaction.
    claimer.exec('BEGIN DEFERRED');
    const row = claimer
      .prepare(`SELECT * FROM mission_tasks WHERE assigned_agent = ? AND status = 'queued'
                ORDER BY priority DESC, created_at ASC LIMIT 1`)
      .get('research') as { id: string };
    sibling.prepare(`UPDATE mission_tasks SET title = ? WHERE id = 'm2'`).run('sibling wrote');

    let thrown: (Error & { code?: string }) | undefined;
    try {
      claimer.prepare(`UPDATE mission_tasks SET status = 'running', started_at = ? WHERE id = ?`)
        .run(1, row.id);
    } catch (err) {
      thrown = err as Error & { code?: string };
    }
    expect(thrown, 'the pre-fix claim must fail under this interleaving').toBeDefined();
    expect(thrown?.code).toMatch(/^SQLITE_BUSY/);
    try { claimer.exec('ROLLBACK'); } catch { /* already rolled back */ }
    claimer.close();

    // Nothing was claimed by the broken path — the task is still queued, which
    // is exactly the stall operators saw: every tick threw, forever.
    expect(getMissionTask('m1')?.status).toBe('queued');

    // ── AFTER: the shipped function, same interleaving.
    sibling.prepare(`UPDATE mission_tasks SET title = ? WHERE id = 'm2'`).run('sibling wrote again');
    const claimed = claimNextMissionTask('research');
    expect(claimed?.id).toBe('m1');
    expect(getMissionTask('m1')?.status).toBe('running');

    sibling.close();
  });

  it('holds at most one running task per agent (no duplicate execution)', () => {
    createMissionTask('m1', 'first', 'p', 'research', 'main', 5);
    createMissionTask('m2', 'second', 'p', 'research', 'main', 5);

    expect(claimNextMissionTask('research')?.id).toBe('m1');
    // A later scheduler tick must NOT pick up a second task while one runs.
    expect(claimNextMissionTask('research')).toBeNull();

    const running = getMissionTasks('research', 'running');
    expect(running).toHaveLength(1);
  });

  it('releases the claim slot once the running task completes', () => {
    createMissionTask('m1', 'first', 'p', 'research', 'main', 5);
    createMissionTask('m2', 'second', 'p', 'research', 'main', 5);

    expect(claimNextMissionTask('research')?.id).toBe('m1');
    completeMissionTask('m1', 'output text', 'completed');
    expect(claimNextMissionTask('research')?.id).toBe('m2');
  });

  it('one agent running does not block a different agent', () => {
    createMissionTask('m1', 'research task', 'p', 'research', 'main', 5);
    createMissionTask('m2', 'comms task', 'p', 'comms', 'main', 5);

    expect(claimNextMissionTask('research')?.id).toBe('m1');
    expect(claimNextMissionTask('comms')?.id).toBe('m2');
  });

  it('never returns the same task to two independent connections', async () => {
    createMissionTask('solo', 'only one', 'p', 'ops', 'main', 5);

    // Two separate module instances = two separate better-sqlite3 connections
    // against the same file, which is what two agent processes actually are.
    vi.resetModules();
    const dbA = await import('./db.js');
    dbA._initTestDatabase(dbPath);
    vi.resetModules();
    const dbB = await import('./db.js');
    dbB._initTestDatabase(dbPath);

    const first = dbA.claimNextMissionTask('ops');
    const second = dbB.claimNextMissionTask('ops');

    const claims = [first, second].filter((t) => t !== null);
    expect(claims, 'exactly one connection may win the claim').toHaveLength(1);
    expect(claims[0]?.id).toBe('solo');

    dbA._closeTestDatabase();
    dbB._closeTestDatabase();
  });

  it('preserves a completed task\'s output and marks completed_at', () => {
    createMissionTask('m1', 'first', 'p', 'research', 'main', 5);
    claimNextMissionTask('research');

    const sibling = openSecondConnection();
    sibling.prepare(`INSERT INTO mission_tasks (id, title, prompt, assigned_agent, status, created_by, priority, created_at)
                     VALUES ('noise', 't', 'p', 'other', 'queued', 'main', 0, 1)`).run();

    completeMissionTask('m1', 'the real answer', 'completed');

    const done = getMissionTask('m1');
    expect(done?.status).toBe('completed');
    expect(done?.result).toBe('the real answer');
    expect(done?.completed_at).toBeGreaterThan(0);
    sibling.close();
  });

  it('records a failure category alongside the error', () => {
    createMissionTask('m1', 'first', 'p', 'research', 'main', 5);
    claimNextMissionTask('research');
    completeMissionTask('m1', null, 'failed', '[auth] provider rejected the credential', 'auth');

    const done = getMissionTask('m1');
    expect(done?.status).toBe('failed');
    expect(done?.failure_category).toBe('auth');
  });
});

// ── 3. Scheduled-task claiming ───────────────────────────────────────

describe('claimScheduledTask atomicity', () => {
  beforeEach(() => {
    freshStore();
    _initTestDatabase(dbPath);
  });
  afterEach(() => {
    _closeTestDatabase();
    cleanupStore();
  });

  const past = Math.floor(Date.now() / 1000) - 60;
  const future = Math.floor(Date.now() / 1000) + 3600;

  it('the first claimer wins and every later claimer is refused', () => {
    createScheduledTask('t1', 'daily digest', '0 9 * * *', past, 'main');

    expect(claimScheduledTask('t1', future)).toBe(true);
    // Same process ticking again, or a sibling process that read the same
    // getDueTasks() snapshot — both must be refused.
    expect(claimScheduledTask('t1', future)).toBe(false);
    expect(claimScheduledTask('t1', future)).toBe(false);
  });

  it('two independent connections cannot both claim the same due task', async () => {
    createScheduledTask('t1', 'daily digest', '0 9 * * *', past, 'main');

    vi.resetModules();
    const dbA = await import('./db.js');
    dbA._initTestDatabase(dbPath);
    vi.resetModules();
    const dbB = await import('./db.js');
    dbB._initTestDatabase(dbPath);

    // Both schedulers see the task as due — getDueTasks is a plain read.
    expect(dbA.getDueTasks('main')).toHaveLength(1);
    expect(dbB.getDueTasks('main')).toHaveLength(1);

    const wins = [dbA.claimScheduledTask('t1', future), dbB.claimScheduledTask('t1', future)];
    expect(wins.filter(Boolean), 'exactly one scheduler may execute the task').toHaveLength(1);

    dbA._closeTestDatabase();
    dbB._closeTestDatabase();
  });

  it('claiming advances next_run so the task cannot re-fire on the next tick', () => {
    createScheduledTask('t1', 'daily digest', '0 9 * * *', past, 'main');
    claimScheduledTask('t1', future);

    expect(getDueTasks('main')).toHaveLength(0);
    const [task] = getAllScheduledTasks('main');
    expect(task.status).toBe('running');
    expect(task.next_run).toBe(future);
    expect(task.started_at).toBeGreaterThan(0);
  });

  it('persists the failure category of the last run', () => {
    createScheduledTask('t1', 'daily digest', '0 9 * * *', past, 'main');
    claimScheduledTask('t1', future);
    updateTaskAfterRun('t1', future, '[rate_limit] backing off', 'failed', 'rate_limit');

    const [task] = getAllScheduledTasks('main');
    expect(task.last_status).toBe('failed');
    expect(task.last_failure_category).toBe('rate_limit');
  });

  it('a successful run clears the previous failure category', () => {
    createScheduledTask('t1', 'daily digest', '0 9 * * *', past, 'main');
    claimScheduledTask('t1', future);
    updateTaskAfterRun('t1', future, 'boom', 'failed', 'crash');
    claimScheduledTask('t1', future);
    updateTaskAfterRun('t1', future, 'all good', 'success', null);

    const [task] = getAllScheduledTasks('main');
    expect(task.last_status).toBe('success');
    expect(task.last_failure_category).toBeNull();
  });
});

// ── 4. Bounded recovery must not conceal a permanent failure ─────────

describe('withBusyRetry is bounded', () => {
  it('retries a transient busy error and then succeeds', () => {
    let calls = 0;
    const result = withBusyRetry(() => {
      calls += 1;
      if (calls < 3) {
        const err = new Error('database is locked') as Error & { code?: string };
        err.code = 'SQLITE_BUSY';
        throw err;
      }
      return 'claimed';
    });
    expect(result).toBe('claimed');
    expect(calls).toBe(3);
  });

  it('gives up after a bounded number of attempts instead of looping forever', () => {
    let calls = 0;
    const alwaysBusy = () => {
      calls += 1;
      const err = new Error('database is locked') as Error & { code?: string };
      err.code = 'SQLITE_BUSY';
      throw err;
    };

    expect(() => withBusyRetry(alwaysBusy)).toThrow(/database is locked/);
    expect(calls).toBe(4); // the default attempt budget — never unlimited
  });

  it('surfaces the original error, so a permanent failure stays actionable', () => {
    const permanent = new Error('UNIQUE constraint failed: mission_tasks.id');
    expect(() => withBusyRetry(() => { throw permanent; })).toThrow(permanent);
  });

  it('does not retry a non-busy error at all', () => {
    let calls = 0;
    expect(() => withBusyRetry(() => {
      calls += 1;
      throw new Error('no such table: mission_tasks');
    })).toThrow(/no such table/);
    expect(calls).toBe(1);
  });
});
