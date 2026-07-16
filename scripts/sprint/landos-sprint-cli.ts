#!/usr/bin/env tsx
// LandOS Sprint System CLI — requirement ledger + staged orchestrator gates.
//
// Canonical commands (run with: npm run landos:sprint -- <command> ...):
//   create --file <plan.json>                 create a sprint ledger from a decomposition plan
//   status [--sprint <id>]                    ledger summary with gate state
//   validate [--sprint <id>]                  validate ledger; nonzero exit on problems
//   report [--sprint <id>]                    render report.md from ledger evidence
//   start <wsId>                              begin a workstream (refuses out-of-order starts)
//   evidence <wsId> --kind <k> --summary <s> [--path <p>] [--url <u>]
//   phase <wsId> <phase> <pass|fail> --detail <d> [--evidence <ids>]
//   qa-brief <wsId> --url <liveUrl>           write the independent browser-QA packet
//   qa-result <wsId> <pass|fail> --report <path> [--evidence <ids>] [--findings <file>] [--recheck]
//   repair <findingId> --summary <s> --regression <coverage>
//   retest <findingId> <pass|fail> --evidence <id>
//   verify <wsId> <reqId> --evidence <ids>
//   accept <wsId>                             workstream acceptance gate (ten refusal conditions)
//   block <wsId> --justification <j> --approved-by <who>
//   final-regression <pass|fail> --detail <d> --evidence <ids>
//   final-review <pass|fail> --detail <d> --evidence <ids> --reviewer <name>
//   complete                                  complete the sprint (refuses without proof)
//   claims-lint [--file <report.md>] [--sprint <id>]
//   recurrence list | recurrence review <patternKey> --file <review.json>
//   capability list | capability freeze --file <spec.json> | capability touched --paths <p1,p2>
//   capability check-reopen <id> --reason <r> --justification <j> [--approved-by <who>]

import fs from 'fs';
import path from 'path';
import process from 'process';
import {
  addEvidence,
  createSprint,
  getCurrentSprintId,
  ledgerPath,
  loadLedger,
  openFindings,
  renderLedgerReport,
  saveLedger,
  setCurrentSprint,
  validateLedger,
  writeReport,
  type EvidenceKind,
  type SprintLedger,
} from '../../src/landos/sprint-system/ledger.js';
import {
  acceptWorkstream,
  beginRepair,
  completeSprint,
  completeSprintRefusals,
  markExternallyBlocked,
  recordBrowserQaResult,
  recordFinalRegression,
  recordFinalReview,
  recordPhase,
  recordRepair,
  retestFinding,
  startWorkstream,
  startWorkstreamProblems,
  verifyRequirement,
  workstreamAcceptanceRefusals,
  type LifecyclePhase,
  type NewFinding,
} from '../../src/landos/sprint-system/orchestrator.js';
import { buildQaBrief, renderQaBrief } from '../../src/landos/sprint-system/qa-brief.js';
import { unsupportedClaims } from '../../src/landos/sprint-system/claims.js';
import {
  completeRootCauseReview,
  knownFailurePatternSummaries,
  loadRecurrenceRegistry,
  patternsAwaitingRootCause,
  recordOccurrence,
  saveRecurrenceRegistry,
} from '../../src/landos/sprint-system/recurrence.js';
import {
  capabilitiesTouchedBy,
  freezeCapability,
  loadCapabilityRegistry,
  reopenProblems,
  saveCapabilityRegistry,
  type FreezeSpec,
  type ReopenReason,
} from '../../src/landos/sprint-system/capabilities.js';
import { LIFECYCLE_PHASES } from '../../src/landos/sprint-system/ledger.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');

function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else flags[key] = true;
    } else positional.push(arg);
  }
  return { positional, flags };
}

function flagString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === 'string' ? value : undefined;
}

function requireFlag(flags: Record<string, string | boolean>, key: string): string {
  const value = flagString(flags, key);
  if (!value) throw new Error(`--${key} is required`);
  return value;
}

function resolveSprintId(flags: Record<string, string | boolean>): string {
  const explicit = flagString(flags, 'sprint');
  if (explicit) return explicit;
  const current = getCurrentSprintId(ROOT);
  if (!current) throw new Error('no active sprint; pass --sprint <id> or run create first');
  return current;
}

function withLedger(flags: Record<string, string | boolean>, fn: (ledger: SprintLedger) => void): void {
  const sprintId = resolveSprintId(flags);
  const ledger = loadLedger(ROOT, sprintId);
  fn(ledger);
  saveLedger(ROOT, ledger);
  writeReport(ROOT, ledger);
}

function evidenceIds(flags: Record<string, string | boolean>): string[] {
  const raw = flagString(flags, 'evidence');
  return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

function printStatus(ledger: SprintLedger): void {
  console.log(`Sprint ${ledger.sprintId}: ${ledger.title}`);
  console.log(`Status: ${ledger.sprintStatus}`);
  console.log(`Final regression: ${ledger.finalRegression ? `${ledger.finalRegression.result} at ${ledger.finalRegression.at}` : 'not run'}`);
  console.log(`Final review: ${ledger.finalReview ? `${ledger.finalReview.result} at ${ledger.finalReview.at}` : 'not run'}`);
  for (const ws of ledger.workstreams) {
    const open = openFindings(ledger, ws.id).length;
    const verified = ws.requirements.filter((r) => r.verified).length;
    console.log(
      `  ${ws.id} [${ws.status}] ${ws.name} — requirements ${verified}/${ws.requirements.length} verified, ${open} open findings, QA ${ws.browserQaResult ? ws.browserQaResult.result : 'not run'}`,
    );
    const startProblems = ws.status === 'planned' ? startWorkstreamProblems(ledger, ws.id) : [];
    if (startProblems.length) console.log(`    gate: ${startProblems[0]}`);
  }
  const registry = loadRecurrenceRegistry(ROOT);
  const outstanding = patternsAwaitingRootCause(registry);
  if (outstanding.length) console.log(`Root-cause reviews outstanding: ${outstanding.join(', ')}`);
}

function main(): number {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, ...rest] = positional;
  try {
    switch (command) {
      case 'create': {
        const planFile = requireFlag(flags, 'file');
        const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
        if (plan.originalPromptPath && !plan.originalPrompt) {
          plan.originalPrompt = fs.readFileSync(path.resolve(path.dirname(planFile), plan.originalPromptPath), 'utf8');
        }
        const ledger = createSprint(plan);
        saveLedger(ROOT, ledger);
        setCurrentSprint(ROOT, ledger.sprintId);
        writeReport(ROOT, ledger);
        console.log(`Created sprint ${ledger.sprintId} with ${ledger.workstreams.length} workstream(s).`);
        console.log(`Ledger: ${ledgerPath(ROOT, ledger.sprintId)}`);
        return 0;
      }
      case 'status': {
        printStatus(loadLedger(ROOT, resolveSprintId(flags)));
        return 0;
      }
      case 'validate': {
        const ledger = loadLedger(ROOT, resolveSprintId(flags));
        const problems = validateLedger(ledger);
        problems.forEach((p) => console.log(`FAIL: ${p}`));
        console.log(problems.length ? 'LEDGER INVALID' : 'LEDGER VALID');
        return problems.length ? 1 : 0;
      }
      case 'report': {
        const ledger = loadLedger(ROOT, resolveSprintId(flags));
        console.log(writeReport(ROOT, ledger));
        return 0;
      }
      case 'start': {
        withLedger(flags, (ledger) => {
          startWorkstream(ledger, rest[0]);
          console.log(`Workstream ${rest[0]} is now implementing.`);
        });
        return 0;
      }
      case 'evidence': {
        withLedger(flags, (ledger) => {
          const record = addEvidence(ledger, {
            kind: requireFlag(flags, 'kind') as EvidenceKind,
            summary: requireFlag(flags, 'summary'),
            ...(flagString(flags, 'path') ? { path: flagString(flags, 'path') } : {}),
            ...(flagString(flags, 'url') ? { url: flagString(flags, 'url') } : {}),
            workstreamId: rest[0],
          });
          console.log(`Recorded evidence ${record.id} (${record.kind}).`);
        });
        return 0;
      }
      case 'phase': {
        const [wsId, phase, result] = rest;
        if (!LIFECYCLE_PHASES.includes(phase as LifecyclePhase)) {
          throw new Error(`phase must be one of: ${LIFECYCLE_PHASES.join(', ')}`);
        }
        if (result !== 'pass' && result !== 'fail') throw new Error('result must be pass or fail');
        withLedger(flags, (ledger) => {
          recordPhase(ledger, wsId, phase as LifecyclePhase, {
            status: result,
            detail: requireFlag(flags, 'detail'),
            evidenceIds: evidenceIds(flags),
          });
          console.log(`Recorded ${phase}=${result} for ${wsId}.`);
        });
        return 0;
      }
      case 'qa-brief': {
        const sprintId = resolveSprintId(flags);
        const ledger = loadLedger(ROOT, sprintId);
        const registry = loadRecurrenceRegistry(ROOT);
        const brief = buildQaBrief(ROOT, ledger, rest[0], {
          liveUrl: requireFlag(flags, 'url'),
          knownFailurePatterns: knownFailurePatternSummaries(registry),
        });
        const dir = path.join(ROOT, '.landos', 'sprints', sprintId);
        const jsonFile = path.join(dir, `qa-brief-${rest[0]}.json`);
        const mdFile = path.join(dir, `qa-brief-${rest[0]}.md`);
        fs.writeFileSync(jsonFile, `${JSON.stringify(brief, null, 2)}\n`, 'utf8');
        fs.writeFileSync(mdFile, renderQaBrief(brief), 'utf8');
        console.log(`QA brief written: ${mdFile}`);
        return 0;
      }
      case 'qa-result': {
        const [wsId, result] = rest;
        if (result !== 'pass' && result !== 'fail') throw new Error('result must be pass or fail');
        const findingsFile = flagString(flags, 'findings');
        const findings: NewFinding[] = findingsFile ? JSON.parse(fs.readFileSync(findingsFile, 'utf8')) : [];
        withLedger(flags, (ledger) => {
          const created = recordBrowserQaResult(ledger, wsId, {
            result,
            reportPath: requireFlag(flags, 'report'),
            evidenceIds: evidenceIds(flags),
            findings,
            recheck: Boolean(flags.recheck),
          });
          const registry = loadRecurrenceRegistry(ROOT);
          for (const finding of created) {
            const { occurrences, reviewRequired } = recordOccurrence(registry, finding.patternKey, {
              sprintId: ledger.sprintId,
              findingId: finding.id,
              at: finding.openedAt,
              summary: finding.expected,
            });
            if (reviewRequired) {
              console.log(`RECURRENCE: ${finding.patternKey} has ${occurrences} occurrences; root-cause review required before acceptance.`);
            }
          }
          saveRecurrenceRegistry(ROOT, registry);
          console.log(`Browser QA ${result} recorded for ${wsId} with ${created.length} finding(s).`);
        });
        return 0;
      }
      case 'repair': {
        withLedger(flags, (ledger) => {
          const finding = ledger.findings.find((f) => f.id === rest[0]);
          if (finding) beginRepair(ledger, finding.workstreamId);
          recordRepair(ledger, rest[0], {
            summary: requireFlag(flags, 'summary'),
            regressionCoverage: requireFlag(flags, 'regression'),
          });
          console.log(`Finding ${rest[0]} repaired and awaiting retest.`);
        });
        return 0;
      }
      case 'retest': {
        const [findingId, result] = rest;
        if (result !== 'pass' && result !== 'fail') throw new Error('result must be pass or fail');
        withLedger(flags, (ledger) => {
          retestFinding(ledger, findingId, { result, evidenceId: requireFlag(flags, 'evidence') });
          console.log(`Finding ${findingId} retest: ${result}.`);
        });
        return 0;
      }
      case 'verify': {
        withLedger(flags, (ledger) => {
          verifyRequirement(ledger, rest[0], rest[1], evidenceIds(flags));
          console.log(`Requirement ${rest[1]} verified for ${rest[0]}.`);
        });
        return 0;
      }
      case 'accept': {
        const registry = loadRecurrenceRegistry(ROOT);
        withLedger(flags, (ledger) => {
          const refusals = workstreamAcceptanceRefusals(ledger, rest[0], {
            patternsAwaitingRootCause: patternsAwaitingRootCause(registry),
          });
          if (refusals.length) {
            refusals.forEach((r) => console.log(`REFUSED: ${r}`));
            throw new Error(`workstream ${rest[0]} not accepted (${refusals.length} refusal(s))`);
          }
          acceptWorkstream(ledger, rest[0], { patternsAwaitingRootCause: patternsAwaitingRootCause(registry) });
          console.log(`Workstream ${rest[0]} passed browser QA and is accepted for final regression.`);
        });
        return 0;
      }
      case 'block': {
        withLedger(flags, (ledger) => {
          markExternallyBlocked(ledger, rest[0], {
            justification: requireFlag(flags, 'justification'),
            approvedBy: requireFlag(flags, 'approved-by'),
          });
          console.log(`Workstream ${rest[0]} marked externally blocked.`);
        });
        return 0;
      }
      case 'final-regression': {
        const result = rest[0];
        if (result !== 'pass' && result !== 'fail') throw new Error('result must be pass or fail');
        withLedger(flags, (ledger) => {
          recordFinalRegression(ledger, {
            result,
            detail: requireFlag(flags, 'detail'),
            evidenceIds: evidenceIds(flags),
          });
          console.log(`Final combined regression recorded: ${result}.`);
        });
        return 0;
      }
      case 'final-review': {
        const result = rest[0];
        if (result !== 'pass' && result !== 'fail') throw new Error('result must be pass or fail');
        withLedger(flags, (ledger) => {
          recordFinalReview(ledger, {
            result,
            detail: requireFlag(flags, 'detail'),
            evidenceIds: evidenceIds(flags),
            reviewer: requireFlag(flags, 'reviewer'),
          });
          console.log(`Independent final review recorded: ${result}.`);
        });
        return 0;
      }
      case 'complete': {
        withLedger(flags, (ledger) => {
          const refusals = completeSprintRefusals(ledger);
          if (refusals.length) {
            refusals.forEach((r) => console.log(`REFUSED: ${r}`));
            throw new Error('sprint completion refused');
          }
          completeSprint(ledger);
          console.log(`Sprint ${ledger.sprintId} complete.`);
        });
        return 0;
      }
      case 'claims-lint': {
        const ledger = loadLedger(ROOT, resolveSprintId(flags));
        const file = flagString(flags, 'file') ?? path.join(ROOT, '.landos', 'sprints', ledger.sprintId, 'report.md');
        const text = fs.readFileSync(file, 'utf8');
        const problems = unsupportedClaims(text, ledger);
        for (const problem of problems) {
          console.log(`UNVERIFIED CLAIM line ${problem.line}: "${problem.text}" — ${problem.problem}`);
        }
        console.log(problems.length ? `${problems.length} unsupported completion claim(s).` : 'All completion claims are evidence-backed.');
        return problems.length ? 1 : 0;
      }
      case 'recurrence': {
        const registry = loadRecurrenceRegistry(ROOT);
        if (rest[0] === 'list') {
          knownFailurePatternSummaries(registry).forEach((line) => console.log(line));
          const outstanding = patternsAwaitingRootCause(registry);
          console.log(outstanding.length ? `Outstanding reviews: ${outstanding.join(', ')}` : 'No outstanding root-cause reviews.');
          return outstanding.length ? 1 : 0;
        }
        if (rest[0] === 'review') {
          const review = JSON.parse(fs.readFileSync(requireFlag(flags, 'file'), 'utf8'));
          completeRootCauseReview(registry, rest[1], review);
          saveRecurrenceRegistry(ROOT, registry);
          console.log(`Root-cause review recorded for ${rest[1]}.`);
          return 0;
        }
        throw new Error('recurrence subcommand must be list or review');
      }
      case 'capability': {
        const registry = loadCapabilityRegistry(ROOT);
        if (rest[0] === 'list') {
          for (const capability of registry.capabilities) {
            console.log(`${capability.id} (${capability.department}) accepted ${capability.acceptedAt} @ ${capability.acceptedVersion} — journeys: ${capability.goldenJourneyIds.join(', ')}`);
          }
          if (!registry.capabilities.length) console.log('No frozen capabilities yet.');
          return 0;
        }
        if (rest[0] === 'freeze') {
          const spec = JSON.parse(fs.readFileSync(requireFlag(flags, 'file'), 'utf8')) as FreezeSpec;
          const ledger = loadLedger(ROOT, resolveSprintId(flags));
          const capability = freezeCapability(registry, ledger, spec);
          saveCapabilityRegistry(ROOT, registry);
          console.log(`Capability ${capability.id} frozen with regression protection.`);
          return 0;
        }
        if (rest[0] === 'check-reopen') {
          const problems = reopenProblems(registry, rest[1], {
            reason: requireFlag(flags, 'reason') as ReopenReason,
            justification: requireFlag(flags, 'justification'),
            approvedBy: flagString(flags, 'approved-by'),
          });
          problems.forEach((p) => console.log(`REFUSED: ${p}`));
          console.log(problems.length ? 'Reopen refused.' : 'Reopen justified.');
          return problems.length ? 1 : 0;
        }
        if (rest[0] === 'touched') {
          const paths = requireFlag(flags, 'paths').split(',').map((p) => p.trim());
          const touched = capabilitiesTouchedBy(registry, paths);
          for (const { capability, journeyIds } of touched) {
            console.log(`RERUN REQUIRED: ${capability.id} — journeys ${journeyIds.join(', ')}`);
          }
          if (!touched.length) console.log('No frozen capability touched.');
          return 0;
        }
        throw new Error('capability subcommand must be list, freeze, check-reopen, or touched');
      }
      default:
        console.error('Unknown command. See the header of scripts/sprint/landos-sprint-cli.ts for usage.');
        return 2;
    }
  } catch (err) {
    console.error(`landos:sprint error: ${(err as Error).message}`);
    return 1;
  }
}

process.exitCode = main();
