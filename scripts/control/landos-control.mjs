#!/usr/bin/env node
// Canonical CLI for the LandOS Development Control Spine, Vertical Slice 1.

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  addEvidence,
  controlSnapshot,
  createTask,
  failAttempt,
  generateStateFile,
  listFailures,
  liveGitFacts,
  initializeControlState,
  openControlState,
  openControlStateWriter,
  prepareAcceptance,
  reconcileAcceptance,
  recordDecision,
  recordManualReview,
  resolveCommit,
  runVerification,
  setTaskContract,
  startManagedAttempt,
  submitCandidate,
  supersedeAcceptance,
  inspectManagedWorkspace,
  inspectionVerificationPlan,
  releaseManagedWorkspace,
} from './control-state.mjs';
import { runGovernedExecution } from './builder-adapter.mjs';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (!name) throw new Error('empty flag name');
    if (name === 'json') {
      flags.json = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name} requires a value`);
    flags[name] = value;
    index += 1;
  }
  return { positional, flags };
}

function requireFlag(flags, name) {
  const value = String(flags[name] ?? '').trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function optionalFlag(flags, name) {
  const value = flags[name];
  return value === undefined ? undefined : String(value);
}

function jsonListFlag(flags, name) {
  const raw = requireFlag(flags, name);
  let value;
  try { value = JSON.parse(raw); }
  catch {
    // PowerShell may remove the quotes inside a native-command JSON argument.
    // Accept the resulting bracketed comma list without changing the canonical
    // storage format; callers needing commas inside an item must pass JSON.
    if (raw.startsWith('[') && raw.endsWith(']')) {
      const content = raw.slice(1, -1).trim();
      value = content ? content.split(',').map((item) => item.trim()) : [];
    } else {
      throw new Error(`--${name} must be a JSON array`);
    }
  }
  if (!Array.isArray(value)) throw new Error(`--${name} must be a JSON array`);
  return value;
}

function output(value, json) {
  if (json) console.log(JSON.stringify(value, null, 2));
  else if (typeof value === 'string') console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

function taskSummary(task) {
  return `${task.id} [${task.status}] ${task.title}\nnext: ${task.next_action}`;
}

function isReadOnlyOperation(group, action) {
  return group === 'status'
    || group === 'failures'
    || group === 'state'
    || (group === 'verification' && action === 'plan')
    || (group === 'workspace' && (action === 'inspect' || action === undefined));
}

export async function runCli(argv, { root: rootOverride } = {}) {
  const { positional, flags } = parseArgs(argv);
  const root = path.resolve(optionalFlag(flags, 'root') ?? rootOverride ?? DEFAULT_ROOT);
  const dbPath = optionalFlag(flags, 'db');
  const [group = 'status', action] = positional;
  const state = group === 'init'
    ? initializeControlState(root, { dbPath })
    : isReadOnlyOperation(group, action)
      ? openControlState(root, { dbPath })
      : openControlStateWriter(root, { dbPath });
  const refresh = () => generateStateFile(state.db, root);
  try {
    if (group === 'init') {
      const generated = refresh();
      output({ database: state.file, state: generated.path }, flags.json);
      return 0;
    }

    if (group === 'task' && action === 'create') {
      const task = createTask(state.db, {
        id: requireFlag(flags, 'id'),
        title: requireFlag(flags, 'title'),
        outcome: requireFlag(flags, 'outcome'),
        nextAction: requireFlag(flags, 'next-action'),
        blocker: optionalFlag(flags, 'blocker'),
      });
      refresh();
      output(flags.json ? task : taskSummary(task), flags.json);
      return 0;
    }

    if (group === 'task' && action === 'contract') {
      const contract = setTaskContract(state.db, root, {
        taskId: requireFlag(flags, 'task'),
        objective: requireFlag(flags, 'objective'),
        nonGoals: jsonListFlag(flags, 'non-goals'),
        acceptedBaseGitSha: requireFlag(flags, 'accepted-base'),
        workingBaseGitSha: requireFlag(flags, 'working-base'),
        riskPolicy: requireFlag(flags, 'risk-policy'),
        acceptancePolicy: requireFlag(flags, 'acceptance-policy'),
        architectureRefs: jsonListFlag(flags, 'architecture-refs'),
        invariantRefs: jsonListFlag(flags, 'invariant-refs'),
        ownedScope: jsonListFlag(flags, 'owned-scope'),
        ownedInterfaces: jsonListFlag(flags, 'owned-interfaces'),
        verificationObligations: jsonListFlag(flags, 'verification-obligations'),
        verificationPolicyRefs: jsonListFlag(flags, 'verification-policy-refs'),
        runtimeConstraints: jsonListFlag(flags, 'runtime-constraints'),
        resourceConstraints: jsonListFlag(flags, 'resource-constraints'),
        relevantCapabilityIds: jsonListFlag(flags, 'relevant-capabilities'),
        relevantTaskIds: jsonListFlag(flags, 'relevant-tasks'),
        policyGitSha: requireFlag(flags, 'policy-commit'),
      });
      refresh();
      output(contract, flags.json);
      return 0;
    }

    if (group === 'decision' && action === 'add') {
      const decision = recordDecision(state.db, {
        id: optionalFlag(flags, 'id'),
        taskId: optionalFlag(flags, 'task'),
        capabilityId: optionalFlag(flags, 'capability'),
        summary: requireFlag(flags, 'summary'),
        rationale: requireFlag(flags, 'rationale'),
        evidenceReference: optionalFlag(flags, 'evidence-reference'),
      });
      refresh();
      output(decision, flags.json);
      return 0;
    }

    if (group === 'attempt' && action === 'start') {
      const base = optionalFlag(flags, 'base')
        ? resolveCommit(root, flags.base)
        : liveGitFacts(root).head;
      const allocation = startManagedAttempt(state.db, root, {
        id: optionalFlag(flags, 'id'),
        taskId: requireFlag(flags, 'task'),
        worker: requireFlag(flags, 'worker'),
        writerId: requireFlag(flags, 'writer'),
        approach: requireFlag(flags, 'approach'),
        baseGitSha: base,
        workspaceId: optionalFlag(flags, 'workspace-id'),
        workspacePath: requireFlag(flags, 'path'),
        branch: requireFlag(flags, 'branch'),
        nextAction: optionalFlag(flags, 'next-action'),
      });
      refresh();
      output(allocation, flags.json);
      return 0;
    }

    if (group === 'workspace' && (action === 'inspect' || action === undefined)) {
      output(inspectManagedWorkspace(state.db, root, { id: optionalFlag(flags, 'id') }), flags.json);
      return 0;
    }

    if (group === 'workspace' && action === 'release') {
      const workspace = releaseManagedWorkspace(state.db, root, {
        id: requireFlag(flags, 'id'),
        taskId: requireFlag(flags, 'task'),
        attemptId: requireFlag(flags, 'attempt'),
        writerId: requireFlag(flags, 'writer'),
      });
      refresh();
      output(workspace, flags.json);
      return 0;
    }

    if (group === 'execution' && (action === 'run' || action === 'resume')) {
      const execution = await runGovernedExecution(state.db, root, {
        taskId: requireFlag(flags, 'task'), attemptId: requireFlag(flags, 'attempt'),
        writerId: requireFlag(flags, 'writer'), cwd: requireFlag(flags, 'cwd'),
        provider: requireFlag(flags, 'provider'), model: optionalFlag(flags, 'model'),
        contextPackHash: optionalFlag(flags, 'context-pack'),
        sessionId: optionalFlag(flags, 'session'), resume: action === 'resume', outputPath: optionalFlag(flags, 'output-path'),
      });
      refresh();
      output(execution, flags.json);
      return execution.state === 'SUBMITTED' ? 0 : 1;
    }

    if (group === 'attempt' && action === 'fail') {
      const attempt = failAttempt(state.db, {
        attemptId: requireFlag(flags, 'attempt'),
        result: requireFlag(flags, 'result'),
        rootCause: optionalFlag(flags, 'root-cause'),
        limitation: optionalFlag(flags, 'limitation'),
        evidence: optionalFlag(flags, 'evidence'),
        path: optionalFlag(flags, 'path'),
        nextDirection: optionalFlag(flags, 'next-direction'),
      });
      refresh();
      output(attempt, flags.json);
      return 1;
    }

    if (group === 'evidence' && action === 'add') {
      const evidence = addEvidence(state.db, {
        attemptId: requireFlag(flags, 'attempt'),
        kind: requireFlag(flags, 'kind'),
        summary: requireFlag(flags, 'summary'),
        path: optionalFlag(flags, 'path'),
        command: optionalFlag(flags, 'command'),
        exitCode: optionalFlag(flags, 'exit-code'),
      });
      refresh();
      output(evidence, flags.json);
      return 0;
    }

    if (group === 'candidate' && action === 'submit') {
      const attempt = submitCandidate(state.db, root, {
        attemptId: requireFlag(flags, 'attempt'),
        gitSha: requireFlag(flags, 'commit'),
        result: requireFlag(flags, 'result'),
      });
      refresh();
      output(attempt, flags.json);
      return 0;
    }

    if (group === 'verification' && action === 'run') {
      const verification = await runVerification(state.db, root, {
        attemptId: requireFlag(flags, 'attempt'),
        obligationId: requireFlag(flags, 'obligation'),
        summary: optionalFlag(flags, 'summary'),
        rootCause: optionalFlag(flags, 'root-cause'),
        limitation: optionalFlag(flags, 'limitation'),
        nextDirection: optionalFlag(flags, 'next-direction'),
      });
      refresh();
      output(verification, flags.json);
      return verification.outcome === 'PASS' ? 0 : 1;
    }

    if (group === 'verification' && action === 'plan') {
      output(inspectionVerificationPlan(state.db, requireFlag(flags, 'attempt')), flags.json);
      return 0;
    }

    if (group === 'verification' && action === 'review') {
      const outcome = requireFlag(flags, 'outcome').toUpperCase();
      const verification = recordManualReview(state.db, {
        attemptId: requireFlag(flags, 'attempt'),
        obligationId: requireFlag(flags, 'obligation'),
        outcome,
        reviewer: requireFlag(flags, 'reviewer'),
        reviewEvidence: requireFlag(flags, 'review-evidence'),
        summary: requireFlag(flags, 'summary'),
        rootCause: optionalFlag(flags, 'root-cause'),
        limitation: optionalFlag(flags, 'limitation'),
        nextDirection: optionalFlag(flags, 'next-direction'),
      });
      refresh();
      output(verification, flags.json);
      return outcome === 'PASS' ? 0 : 1;
    }

    if (group === 'integration-gate' && action === 'prepare') {
      const operation = prepareAcceptance(state.db, root, {
        id: optionalFlag(flags, 'id'),
        attemptId: requireFlag(flags, 'attempt'),
        authorityRef: optionalFlag(flags, 'authority-ref'),
      });
      refresh();
      output(operation, flags.json);
      return 0;
    }

    if (group === 'integration-gate' && action === 'reconcile') {
      const reconciled = reconcileAcceptance(state.db, root, { id: optionalFlag(flags, 'id') });
      refresh();
      output(reconciled, flags.json);
      return reconciled.every((item) => item.reconciled) ? 0 : 1;
    }

    if (group === 'integration-gate' && action === 'supersede') {
      const superseded = supersedeAcceptance(state.db, {
        id: requireFlag(flags, 'id'),
        reason: requireFlag(flags, 'reason'),
        nextDirection: optionalFlag(flags, 'next-direction'),
      });
      refresh();
      output(superseded, flags.json);
      return 0;
    }

    if (group === 'failures') {
      const failures = listFailures(state.db, optionalFlag(flags, 'task') ?? null);
      output(failures, flags.json);
      return 0;
    }

    if (group === 'state' && (action === 'generate' || action === undefined)) {
      const generated = refresh();
      output(flags.json ? generated : `${generated.changed ? 'Regenerated' : 'Unchanged'} ${generated.path}`, flags.json);
      return 0;
    }

    if (group === 'status') {
      const snapshot = controlSnapshot(state.db);
      const facts = liveGitFacts(root);
      refresh();
      if (flags.json) output({ ...snapshot, git: facts, database: state.file }, true);
      else {
        console.log(`Control DB: ${state.file}`);
        console.log(`Git: ${facts.branch} HEAD ${facts.head ?? 'unresolved'}; main ${facts.authoritySha ?? 'unresolved'}`);
        console.log(snapshot.activeTask ? taskSummary(snapshot.activeTask) : 'No active development task.');
        console.log(`Pending acceptances: ${snapshot.pendingAcceptances.length}`);
        console.log(snapshot.latestAccepted
          ? `Latest accepted: ${snapshot.latestAccepted.id} @ ${snapshot.latestAccepted.accepted_git_sha}`
          : 'Latest accepted: none recorded');
        console.log(snapshot.latestFailure
          ? `Latest failure: ${snapshot.latestFailure.id} -- ${snapshot.latestFailure.result}`
          : 'Latest failure: none recorded');
      }
      return 0;
    }

    throw new Error('unknown command');
  } finally {
    state.close();
  }
}

const USAGE = `LandOS Development Control Spine

  npm run landos:control -- init
  npm run landos:control -- task create --id <id> --title <text> --outcome <text> --next-action <text>
  npm run landos:control -- task contract --task <id> --objective <text> --non-goals <json-array> --accepted-base <sha> --working-base <sha> --risk-policy <low|protected|architecture-critical> --acceptance-policy <text> --architecture-refs <json-array> --invariant-refs <json-array> --owned-scope <json-array> --owned-interfaces <json-array> --verification-obligations <json-array> --verification-policy-refs <json-array> --runtime-constraints <json-array> --resource-constraints <json-array> --relevant-capabilities <json-array> --relevant-tasks <json-array> --policy-commit <sha>
  npm run landos:control -- decision add [--id <id>] [--task <id>] [--capability <id>] --summary <text> --rationale <text> [--evidence-reference <ref>]
  npm run landos:control -- attempt start --task <id> --worker <name> --writer <primary-writer> --path <new-worktree-path> --branch <task-branch> --approach <text> [--id <id>] [--base <sha>]
  npm run landos:control -- workspace inspect [--id <id>]
  npm run landos:control -- workspace release --id <id> --task <task-id> --attempt <attempt-id> --writer <primary-writer>
  npm run landos:control -- execution run --task <task-id> --attempt <attempt-id> --writer <primary-writer> --cwd <managed-worktree> --provider claude|codex|grok [--context-pack <expected-sha256>]
  npm run landos:control -- evidence add --attempt <id> --kind <kind> --summary <text> [--path <path>]
  npm run landos:control -- candidate submit ... # always refused; governed execution owns submission
  npm run landos:control -- verification plan --attempt <id>
  npm run landos:control -- verification run --attempt <id> --obligation <obligation-id> [--next-direction <text>]
  npm run landos:control -- verification review --attempt <id> --obligation <manual-obligation-id> --outcome PASS|FAIL --reviewer <actor> --review-evidence <reference> --summary <text>
  npm run landos:control -- attempt fail --attempt <id> --result <text> [--root-cause <text>] [--next-direction <text>]
  npm run landos:control -- integration-gate prepare --attempt <id> [--authority-ref main]
  npm run landos:control -- integration-gate reconcile [--id <acceptance-id>]
  npm run landos:control -- integration-gate supersede --id <acceptance-id> --reason <text> [--next-direction <text>]
  npm run landos:control -- failures [--task <id>] [--json]
  npm run landos:control -- state generate
  npm run landos:control -- status [--json]

The Integration Gate is the only command path that can write ACCEPTED. A PASS
only makes an exact candidate eligible. Promotion of that exact SHA to main and
gate reconciliation are still required.`;

async function main() {
  try {
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (String(error?.message ?? error) === 'unknown command') console.error(USAGE);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
