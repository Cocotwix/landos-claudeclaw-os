#!/usr/bin/env node
// Deterministic offline contract proof for the fresh-session bootstrap.
// This is not an LLM session and must never be reported as one.
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildStatus } from './landos-memory.mjs';

const started = performance.now();
const expected = 'Inspect the current LandOS project state and identify the next system-wide implementation priority. Do not modify code.';
const request = process.argv.slice(2).join(' ');
if (request !== expected) throw new Error('Use the exact isolated acceptance request.');
const root = process.cwd();
const agents = readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
const permanent = readFileSync(path.join(root, '.landos', 'PERMANENT_MEMORY.md'), 'utf8');
const checkpoint = readFileSync(path.join(root, '.landos', 'CHECKPOINT.md'), 'utf8');
const status = buildStatus(root);
const section = (heading) => checkpoint.split('## ' + heading)[1]?.split('\n## ')[0]?.trim() ?? null;
const result = {
  method: 'isolated offline local-process contract proof; not an independent model session',
  request,
  repositoryRecognized: /This is the LandOS repository/.test(agents),
  automaticallyLoadedFiles: status.profiles.codingAgent.files.map((item) => item.file),
  estimatedInitialContextTokens: status.profiles.codingAgent.estimatedTokens,
  permanentRulesAvailable: {
    systemWide: /system-wide/.test(permanent),
    preserveOperatorData: /operator data/.test(permanent),
    stagedBrowserQa: /staged workstreams[\s\S]*independent live browser QA/i.test(permanent),
    approvalGates: /Approval is required/.test(permanent),
  },
  checkpoint: {
    path: '.landos/CHECKPOINT.md',
    unfinishedWork: section('Current unfinished work'),
    pendingTylerDecisions: section('Pending Tyler decisions'),
    nextPriority: section('Next recommended system-wide priority'),
  },
  managedRuntimeAvailable: /landos:status[\s\S]*landos:health/.test(permanent),
  safetyBoundariesAvailable: /Do not commit or push/.test(permanent) && /Preserve unrelated dirty work/.test(permanent),
  relevantReports: [...checkpoint.matchAll(/docs\/landos\/[A-Za-z0-9_.-]+\.md/g)].map((match) => match[0]),
  liveStateOutranksCheckpoint: /override memory-file narrative/.test(permanent),
  requestReadOnly: /Do not modify code\.$/.test(request),
  continueLandosRan: false,
  chromeOrBrowserRan: false,
  unrelatedHistoryLoaded: false,
  onDemandRetrieval: [],
  estimatedAddedContextTokens: 0,
  tylerMustExplainProjectState: false,
  usefulOutputMilliseconds: Math.round(performance.now() - started),
};
console.log(JSON.stringify(result, null, 2));