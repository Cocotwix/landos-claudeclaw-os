#!/usr/bin/env node
// Legacy task entrypoint. It deliberately has no task lifecycle of its own.

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { openControlStateWriter } from '../control/control-state.mjs';
import { runGovernedExecution } from '../control/builder-adapter.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error('legacy task runner accepts only governed flags');
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`);
    flags[key.slice(2)] = value;
    index += 1;
  }
  for (const key of ['task', 'attempt', 'writer', 'cwd', 'provider', 'context-pack']) {
    if (!flags[key]) throw new Error(`legacy task runner delegates only with --${key}`);
  }
  return {
    taskId: flags.task,
    attemptId: flags.attempt,
    writerId: flags.writer,
    cwd: flags.cwd,
    provider: flags.provider,
    contextPackHash: flags['context-pack'],
    model: flags.model,
    sessionId: flags.session,
    outputPath: flags['output-path'],
    resume: flags.resume === 'true',
    root: flags.root,
  };
}

export async function runTask(options) {
  const root = path.resolve(options.root ?? ROOT);
  const state = openControlStateWriter(root);
  try {
    return await runGovernedExecution(state.db, root, options);
  } finally {
    state.close();
  }
}

async function main() {
  try {
    const result = await runTask(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.state === 'SUBMITTED' ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
