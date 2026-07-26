#!/usr/bin/env node
/**
 * LandOS Hive CLI — the store-aware accessor for the agent/mission system.
 *
 * WHY THIS EXISTS (load-bearing): the store path is resolved by config.ts as
 *   process.env.CLAUDECLAW_STORE_DIR || envConfig.CLAUDECLAW_STORE_DIR (.env)
 *                                    || PROJECT_ROOT/store
 * The `.env` branch is invisible to a shell `sqlite3` or `find` — only a Node
 * process that loads config.ts can honor it. A raw shell command against
 * $PROJECT_ROOT/store can therefore silently hit the WRONG database when the
 * store has been relocated. This CLI always resolves through config.ts, so it
 * reads whatever store the running LandOS process is actually using.
 *
 * Raw `sqlite3` writes against the store are also unsafe for a second reason:
 * they bypass the WAL/busy-timeout/IMMEDIATE-transaction handling in db.ts and
 * make the scheduler contention this phase fixed measurably worse. Use this CLI.
 *
 * Read-only by default. `log` is the single, explicitly-named writer and only
 * appends one hive_mind row.
 *
 * Invocation (these are NOT bare PATH commands):
 *   node "$(git rev-parse --show-toplevel)/dist/hive-cli.js" <command>
 *   npm run landos:hive -- <command>
 */

import path from 'path';
import fs from 'fs';

// ── Bootstrap ────────────────────────────────────────────────────────
// `--store <path>` has to be applied BEFORE config.ts is evaluated, because
// STORE_DIR is resolved at module-load time. Everything below is therefore
// behind a dynamic import. CLAUDECLAW_STORE_DIR is the same variable the
// runtime itself honors, so the override uses the existing convention rather
// than inventing a second path mechanism.

const rawArgv = process.argv.slice(2);

function takeFlagValue(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  if (idx === -1) return undefined;
  const value = argv[idx + 1];
  argv.splice(idx, value === undefined ? 1 : 2);
  return value;
}

function takeBooleanFlag(argv: string[], ...names: string[]): boolean {
  let found = false;
  for (const name of names) {
    const idx = argv.indexOf(name);
    if (idx !== -1) { argv.splice(idx, 1); found = true; }
  }
  return found;
}

const storeOverride = takeFlagValue(rawArgv, '--store');
const asJson = takeBooleanFlag(rawArgv, '--json');
const wantsHelp = takeBooleanFlag(rawArgv, '--help', '-h');

if (storeOverride !== undefined) {
  if (!storeOverride.trim()) {
    console.error('--store requires a directory path.');
    process.exit(1);
  }
  process.env.CLAUDECLAW_STORE_DIR = path.resolve(storeOverride);
}

const USAGE = `LandOS Hive CLI — inspect the active LandOS agent and mission store.

Usage:
  hive-cli <command> [options]

Read commands:
  path                       Print the resolved store directory and database path.
  status                     Runtime identity, store location, and a live count summary.
  agents                     Configured agents, with whether each one is running.
  missions [filters]         Mission tasks, newest-relevant first.
  task <id>                  One mission task in full, including its originator.
  failures [filters]         Mission tasks that ended failed or cancelled.
  scheduled [--agent <id>]   Scheduled (cron) tasks and their last run.
  hive [--limit N]           Recent hive_mind entries.

Write command (the only one — append-only):
  log --action <a> --summary <s> [--agent <id>]

Filters:
  --agent <id>       Restrict to one agent.
  --status <s>       queued | running | completed | failed | cancelled
  --created-by <id>  Restrict to tasks an agent originated (mission_tasks has no
                     explicit parent/child column; created_by is the relationship
                     that actually exists).
  --limit N          Cap the number of rows. Default 20.

Global options:
  --store <dir>      Read a different store directory. Defaults to the one the
                     running LandOS resolves (CLAUDECLAW_STORE_DIR, else .env,
                     else <repo>/store).
  --json             Emit machine-readable JSON instead of formatted text.
  --help, -h         Show this help.

Exit codes:
  0 success   1 usage error   2 not found   3 store/runtime error

Never run raw sqlite3 against the store: it bypasses the WAL and busy-timeout
handling in db.ts and reintroduces the scheduler lock contention.`;

const COMMANDS = new Set([
  'path', 'status', 'agents', 'missions', 'task', 'failures', 'scheduled', 'hive', 'log', 'help',
]);

function fail(message: string, code: number): never {
  console.error(message);
  process.exit(code);
}

function formatDate(unix: number | null | undefined): string {
  if (!unix) return '-';
  return new Date(unix * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function truncate(text: string | null | undefined, max: number): string {
  const value = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return '-';
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function emit(payload: unknown, render: () => void): void {
  if (asJson) console.log(JSON.stringify(payload, null, 2));
  else render();
}

async function main(): Promise<void> {
  const command = rawArgv[0];

  if (wantsHelp || command === undefined || command === 'help') {
    console.log(USAGE);
    process.exit(0);
  }
  if (!COMMANDS.has(command)) {
    console.error(`Unknown command: "${command}"`);
    console.error('');
    console.error(USAGE);
    process.exit(1);
  }

  const args = rawArgv.slice(1);
  const agentFilter = takeFlagValue(args, '--agent');
  const statusFilter = takeFlagValue(args, '--status');
  const createdByFilter = takeFlagValue(args, '--created-by');
  const rawLimit = takeFlagValue(args, '--limit');
  const action = takeFlagValue(args, '--action');
  const summary = takeFlagValue(args, '--summary');

  const leftoverFlags = args.filter((a) => a.startsWith('-') && a !== '-');
  if (leftoverFlags.length > 0) {
    console.error(`Unknown option${leftoverFlags.length === 1 ? '' : 's'}: ${leftoverFlags.join(', ')}`);
    console.error('');
    console.error(USAGE);
    process.exit(1);
  }

  let limit = 20;
  if (rawLimit !== undefined) {
    if (!/^\d+$/.test(rawLimit) || parseInt(rawLimit, 10) === 0) {
      fail(`--limit must be a positive integer, got "${rawLimit}"`, 1);
    }
    limit = Math.min(parseInt(rawLimit, 10), 500);
  }

  // config.ts is imported here, AFTER the --store override has been applied.
  const config = await import('./config.js');
  const storeDir = config.STORE_DIR;
  const dbPath = path.join(storeDir, 'claudeclaw.db');

  // `path` deliberately answers "where is my store?" without opening the
  // database, so it works even without a DB_ENCRYPTION_KEY.
  if (command === 'path') {
    emit({ storeDir, dbPath, exists: fs.existsSync(dbPath), projectRoot: config.PROJECT_ROOT }, () => {
      console.log(dbPath);
    });
    return;
  }

  const db = await import('./db.js');
  try {
    db.initDatabase();
  } catch (err) {
    fail(`Cannot open the LandOS store at ${storeDir}: ${(err as Error).message}`, 3);
  }

  switch (command) {
    case 'status': {
      const { listAgentIds } = await import('./agent-config.js');
      const { liveProcessIds } = await import('./platform.js');
      const agentIds = listAgentIds();
      const pids = new Map<string, number>();
      for (const id of [...agentIds, 'main']) {
        const file = path.join(storeDir, id === 'main' ? 'claudeclaw.pid' : `agent-${id}.pid`);
        if (!fs.existsSync(file)) continue;
        const pid = parseInt(fs.readFileSync(file, 'utf-8').trim(), 10);
        if (Number.isInteger(pid) && pid > 0) pids.set(id, pid);
      }
      const live = liveProcessIds(pids.values());

      const byStatus: Record<string, number> = {};
      for (const task of db.getMissionTasks()) {
        byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
      }
      const scheduled = db.getAllScheduledTasks();
      // The managed LandOS process writes claudeclaw.pid; it is not one of the
      // configured sub-agents, so report it separately rather than omitting it.
      const runtimePid = pids.get('main');
      const payload = {
        // AGENT_ID is 'main' unless CLAUDECLAW_AGENT_ID says otherwise.
        runtimeAgentId: config.AGENT_ID,
        runtimePid: runtimePid !== undefined && live.has(runtimePid) ? runtimePid : null,
        projectRoot: config.PROJECT_ROOT,
        storeDir,
        dbPath,
        dbBytes: fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0,
        storeOverridden: storeOverride !== undefined,
        agents: agentIds.map((id) => ({ id, running: pids.has(id) && live.has(pids.get(id)!) })),
        missionTasksByStatus: byStatus,
        scheduledTasks: scheduled.length,
        hiveEntries: db.getHiveMindEntries(1).length > 0,
      };
      emit(payload, () => {
        console.log(`Runtime agent : ${payload.runtimeAgentId}`);
        console.log(`Runtime proc  : ${payload.runtimePid === null ? 'not running' : `pid ${payload.runtimePid}`}`);
        console.log(`Project root  : ${payload.projectRoot}`);
        console.log(`Store dir     : ${payload.storeDir}${payload.storeOverridden ? '  (overridden via --store)' : ''}`);
        console.log(`Database      : ${payload.dbPath} (${payload.dbBytes.toLocaleString()} bytes)`);
        console.log('');
        console.log(`Agents        : ${payload.agents.length} configured, ${payload.agents.filter((a) => a.running).length} running`);
        const statuses = Object.entries(byStatus);
        console.log(`Mission tasks : ${statuses.length === 0 ? 'none' : statuses.map(([s, n]) => `${n} ${s}`).join(', ')}`);
        console.log(`Scheduled     : ${payload.scheduledTasks}`);
      });
      return;
    }

    case 'agents': {
      const { listAgentIds, getAgentCapabilities } = await import('./agent-config.js');
      const { liveProcessIds } = await import('./platform.js');
      const ids = listAgentIds().sort();
      const pids = new Map<string, number>();
      for (const id of ids) {
        const file = path.join(storeDir, id === 'main' ? 'claudeclaw.pid' : `agent-${id}.pid`);
        if (!fs.existsSync(file)) continue;
        const pid = parseInt(fs.readFileSync(file, 'utf-8').trim(), 10);
        if (Number.isInteger(pid) && pid > 0) pids.set(id, pid);
      }
      const live = liveProcessIds(pids.values());

      // getAgentCapabilities returns name + description only. loadAgentConfig
      // would also carry the agent's bot token, which must never be printed.
      const rows = ids.map((id) => {
        const caps = getAgentCapabilities(id);
        const pid = pids.get(id);
        const running = pid !== undefined && live.has(pid);
        const tasks = db.getMissionTasks(id);
        return {
          id,
          name: caps?.name ?? id,
          description: caps?.description ?? '',
          running,
          pid: running ? pid : null,
          queued: tasks.filter((t) => t.status === 'queued').length,
          running_tasks: tasks.filter((t) => t.status === 'running').length,
        };
      });
      emit(rows, () => {
        if (rows.length === 0) { console.log('No agents configured.'); return; }
        console.log(`${rows.length} agent${rows.length === 1 ? '' : 's'}:\n`);
        for (const r of rows) {
          console.log(`${r.id.padEnd(12)} ${r.running ? `running (pid ${r.pid})` : 'stopped'}`);
          console.log(`  Name      : ${r.name}`);
          if (r.description) console.log(`  Role      : ${truncate(r.description, 100)}`);
          console.log(`  Tasks     : ${r.running_tasks} running, ${r.queued} queued`);
          console.log();
        }
      });
      return;
    }

    case 'missions': {
      let rows = db.getMissionTasks(agentFilter, statusFilter);
      if (createdByFilter) rows = rows.filter((t) => t.created_by === createdByFilter);
      rows = rows.slice(0, limit);
      emit(rows, () => {
        if (rows.length === 0) { console.log('No mission tasks match.'); return; }
        console.log(`${rows.length} mission task${rows.length === 1 ? '' : 's'}:\n`);
        for (const t of rows) {
          console.log(`${t.id}  [${t.status}]  @${t.assigned_agent ?? 'unassigned'}  p${t.priority}`);
          console.log(`  Title    : ${truncate(t.title, 90)}`);
          console.log(`  Created  : ${formatDate(t.created_at)} by ${t.created_by}`);
          if (t.completed_at) console.log(`  Finished : ${formatDate(t.completed_at)}`);
          if (t.failure_category) console.log(`  Failure  : ${t.failure_category}`);
          console.log();
        }
      });
      return;
    }

    case 'failures': {
      const rows = db.getRecentMissionFailures(limit, agentFilter);
      emit(rows, () => {
        if (rows.length === 0) { console.log('No recent mission failures.'); return; }
        console.log(`${rows.length} recent failure${rows.length === 1 ? '' : 's'}:\n`);
        for (const t of rows) {
          // The category is what tells an operator whether this was a provider
          // problem or a real defect. Lead with it.
          console.log(`${t.id}  [${t.failure_category ?? 'uncategorised'}]  ${t.status}  @${t.assigned_agent ?? 'unassigned'}`);
          console.log(`  Title    : ${truncate(t.title, 90)}`);
          console.log(`  Finished : ${formatDate(t.completed_at)}`);
          if (t.error) console.log(`  Error    : ${truncate(t.error, 200)}`);
          console.log();
        }
      });
      return;
    }

    case 'task': {
      const id = args.find((a) => !a.startsWith('-'));
      if (!id) fail('Usage: hive-cli task <id>', 1);
      const task = db.getMissionTask(id);
      if (!task) fail(`Mission task not found: ${id}`, 2);
      // created_by is the only origin relationship mission_tasks records; these
      // are the tasks that share it, i.e. the originator's other work.
      const siblings = db.getMissionTasks().filter((t) => t.created_by === task.created_by && t.id !== task.id);
      emit({ task, originator: task.created_by, siblingsFromSameOriginator: siblings.map((s) => s.id) }, () => {
        console.log(`Task      : ${task.id} [${task.status}]`);
        console.log(`Title     : ${task.title}`);
        console.log(`Agent     : ${task.assigned_agent ?? 'unassigned'}`);
        console.log(`Originator: ${task.created_by}`);
        console.log(`Priority  : ${task.priority}`);
        console.log(`Created   : ${formatDate(task.created_at)}`);
        console.log(`Started   : ${formatDate(task.started_at)}`);
        console.log(`Finished  : ${formatDate(task.completed_at)}`);
        if (task.failure_category) console.log(`Failure   : ${task.failure_category}`);
        console.log(`\nPrompt:\n${task.prompt}`);
        if (task.result) console.log(`\nResult:\n${task.result}`);
        if (task.error) console.log(`\nError:\n${task.error}`);
        if (siblings.length > 0) {
          console.log(`\nOther tasks from ${task.created_by}: ${siblings.map((s) => s.id).join(', ')}`);
        }
      });
      return;
    }

    case 'scheduled': {
      const rows = db.getAllScheduledTasks(agentFilter).slice(0, limit);
      emit(rows, () => {
        if (rows.length === 0) { console.log('No scheduled tasks.'); return; }
        console.log(`${rows.length} scheduled task${rows.length === 1 ? '' : 's'}:\n`);
        for (const t of rows) {
          console.log(`${t.id}  [${t.status}]  @${t.agent_id}  ${t.schedule}`);
          console.log(`  Prompt   : ${truncate(t.prompt, 90)}`);
          console.log(`  Next run : ${formatDate(t.next_run)}`);
          console.log(`  Last run : ${formatDate(t.last_run)}${t.last_status ? ` (${t.last_status})` : ''}`);
          if (t.last_failure_category) console.log(`  Failure  : ${t.last_failure_category}`);
          console.log();
        }
      });
      return;
    }

    case 'hive': {
      const rows = db.getHiveMindEntries(limit, agentFilter);
      emit(rows, () => {
        if (rows.length === 0) { console.log('Hive mind is empty.'); return; }
        console.log(`${rows.length} hive_mind entr${rows.length === 1 ? 'y' : 'ies'}:\n`);
        for (const e of rows) {
          console.log(`[${formatDate(e.created_at)}] @${e.agent_id} — ${e.action}`);
          console.log(`  ${e.summary}`);
          if (e.artifacts) console.log(`  artifacts: ${e.artifacts}`);
          console.log();
        }
      });
      return;
    }

    case 'log': {
      if (!action || !summary) {
        fail('Usage: hive-cli log --action <action> --summary <summary> [--agent <id>]', 1);
      }
      const agentId = agentFilter ?? process.env.CLAUDECLAW_AGENT_ID ?? 'main';
      // chat_id is NOT NULL in the schema; CLI-originated entries use a marker.
      db.logToHiveMind(agentId, 'cli', action, summary);
      emit({ logged: true, agentId, action }, () => {
        console.log(`Logged to hive mind as @${agentId}: ${action}`);
      });
      return;
    }
  }
}

main().catch((err) => {
  console.error(`hive-cli failed: ${(err as Error).message}`);
  process.exit(3);
});
