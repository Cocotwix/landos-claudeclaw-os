#!/usr/bin/env node
/**
 * LandOS Mission CLI
 *
 * Used by Claude assistants to create and manage one-shot mission tasks
 * that are picked up and executed by the target agent's scheduler.
 *
 * Usage:
 *   node dist/mission-cli.js create --agent research --title "Label" "Full prompt"
 *   node dist/mission-cli.js list [--status queued]
 *   node dist/mission-cli.js result <id>
 *   node dist/mission-cli.js cancel <id>
 *   node dist/mission-cli.js help
 *
 * Argument parsing lives in mission-cli-args.ts and runs BEFORE initDatabase(),
 * so an invalid command line can never create, mutate or execute anything.
 */

import { randomBytes } from 'crypto';

import {
  initDatabase,
  createMissionTask,
  getMissionTasks,
  getMissionTask,
  cancelMissionTask,
} from './db.js';
import { parseMissionArgs, USAGE } from './mission-cli-args.js';

// ── Parse first. No database, no side effects, until the args are valid. ──
const parsed = parseMissionArgs(process.argv.slice(2));
if (!parsed.ok) {
  for (const line of parsed.failure.errors) console.error(line);
  process.exit(parsed.failure.exitCode);
}
const { command, positionals, agent: targetAgent, title: titleArg, status: statusFilter, priority: priorityArg } = parsed.args;

if (command === 'help') {
  console.log(USAGE);
  process.exit(0);
}

// Who created this task
const createdBy = process.env.CLAUDECLAW_AGENT_ID ?? 'main';

initDatabase();

function formatDate(unix: number | null): string {
  if (!unix) return '-';
  return new Date(unix * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

switch (command) {
  case 'create': {
    const prompt = positionals[0];
    if (!prompt) {
      console.error('Usage: mission-cli create --agent <id> --title "Label" "Full prompt text"');
      process.exit(1);
    }
    const title = titleArg || prompt.slice(0, 60);
    const id = randomBytes(4).toString('hex');
    createMissionTask(id, title, prompt, targetAgent ?? null, createdBy, priorityArg);

    console.log(`Mission task created: ${id}`);
    console.log(`  Title:    ${title}`);
    console.log(`  Agent:    ${targetAgent || 'unassigned (use dashboard to assign)'}`);
    console.log(`  Priority: ${priorityArg}`);
    console.log(`  Prompt:   ${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}`);
    break;
  }

  case 'list': {
    const tasks = getMissionTasks(undefined, statusFilter);
    if (tasks.length === 0) {
      console.log('No mission tasks' + (statusFilter ? ` with status "${statusFilter}"` : '') + '.');
      break;
    }
    console.log(`${tasks.length} mission task${tasks.length === 1 ? '' : 's'}:\n`);
    for (const t of tasks) {
      console.log(`${t.id} [${t.status}] @${t.assigned_agent}`);
      console.log(`  Title:   ${t.title}`);
      console.log(`  Created: ${formatDate(t.created_at)}`);
      if (t.completed_at) console.log(`  Done:    ${formatDate(t.completed_at)}`);
      if (t.failure_category) console.log(`  Failure: ${t.failure_category}`);
      console.log();
    }
    break;
  }

  case 'result': {
    const id = positionals[0];
    if (!id) { console.error('Usage: mission-cli result <id>'); process.exit(1); }
    const task = getMissionTask(id);
    if (!task) { console.error(`Task not found: ${id}`); process.exit(1); }
    console.log(`Task:   ${task.id} [${task.status}]`);
    console.log(`Title:  ${task.title}`);
    console.log(`Agent:  ${task.assigned_agent}`);
    // The category names WHY it failed: a provider auth problem reads very
    // differently from a genuine process crash.
    if (task.failure_category) console.log(`Failure: ${task.failure_category}`);
    if (task.result) {
      console.log(`\nResult:\n${task.result}`);
    } else if (task.error) {
      console.log(`\nError: ${task.error}`);
    } else {
      console.log('\nNo result yet.');
    }
    break;
  }

  case 'cancel': {
    const id = positionals[0];
    if (!id) { console.error('Usage: mission-cli cancel <id>'); process.exit(1); }
    const ok = cancelMissionTask(id);
    console.log(ok ? `Cancelled task: ${id}` : `Could not cancel (may already be completed): ${id}`);
    break;
  }
}
