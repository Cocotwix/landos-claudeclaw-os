#!/usr/bin/env node
/**
 * Forge engagement CLI — the runnable operator entry point.
 *
 * Turns a raw build request into a structured Forge engagement Markdown
 * artifact and prints it to stdout. The operator redirects to a file to save
 * it for review. No network, no .env, no secrets, no filesystem writes.
 *
 * Usage:
 *   node dist/forge/engagement-cli.js "raw request text"
 *   node dist/forge/engagement-cli.js --stdin            (request on stdin)
 *   node dist/forge/engagement-cli.js --title "Label" --host "your operating system" "raw request"
 *
 * Dev (no build):
 *   npx tsx src/forge/engagement-cli.ts "add a date helper to src/utils with a test"
 *
 * Save the artifact:
 *   npx tsx src/forge/engagement-cli.ts "..." > forge-engagement.md
 */

import fs from 'fs';

import { startForgeEngagement, renderEngagementMarkdown, type ForgeEngagementRequest } from './engagement.js';

function parseArgs(argv: string[]): { title?: string; host?: string; rawRequest: string } {
  let title: string | undefined;
  let host: string | undefined;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--title') {
      title = argv[++i];
    } else if (a === '--host') {
      host = argv[++i];
    } else if (a === '--stdin') {
      rest.push(fs.readFileSync(0, 'utf8'));
    } else {
      rest.push(a);
    }
  }

  return { title, host, rawRequest: rest.join(' ').trim() };
}

const { title, host, rawRequest } = parseArgs(process.argv.slice(2));

if (!rawRequest) {
  console.error('Usage: forge-engagement-cli [--title "Label"] [--host "Host"] "raw request" | --stdin');
  process.exit(1);
}

const request: ForgeEngagementRequest = {
  title,
  host,
  rawRequest,
  requestedBy: 'owner',
  createdAt: new Date().toISOString(),
};

const engagement = startForgeEngagement(request);
console.log(renderEngagementMarkdown(engagement));

// Non-zero-ish signal for scripts: a STOP verdict exits 0 (the artifact is
// still valid output) but prints a clear stderr note so an operator piping
// output notices the gate fired.
if (engagement.gate.verdict === 'STOP') {
  console.error(`\n[forge] Lane gate: STOP — ${engagement.gate.categories.length} owner-owned decision category(ies) detected.`);
}
