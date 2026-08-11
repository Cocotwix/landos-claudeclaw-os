#!/usr/bin/env node
// LandOS mission harness — automatic mission authoring. The front door.
//
// The executor was already parallel-first and provider-neutral; the missing
// piece was the entrance. Tyler had to hand-write a mission plan: lanes,
// dependency graph, owned paths, checks. This module removes that step.
//
//   plain-English request (or a pasted multi-paragraph specification)
//     -> parallel read-only reconnaissance of the CURRENT repository
//     -> one authoring worker turns request + findings into a mission plan
//     -> mechanical repair of the usual structural mistakes
//     -> validatePlan, the same gate the executor uses
//     -> the executor runs it
//
// Two properties matter more than sophistication here.
//
// PROVIDER NEUTRALITY. This is plain Node reached through one CLI. Claude Code,
// Codex and a bare terminal all invoke the same entry point, so there is exactly
// one mission author and no per-provider planning system. The workers that do
// the reading and the authoring come from the existing builder registry, so
// whichever agent is installed does the job.
//
// NO INTERROGATION. Anything the harness can determine by looking at LandOS is
// determined by looking at LandOS. Nothing here asks Tyler which file to change,
// which model to use, or which tests to run. A generated plan that fails
// validation is repaired and re-asked automatically; Tyler is never handed JSON
// to fix.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { BUILDERS, CC_READONLY_TOOLS, getBuilder, launchBuilderAsync, probeBuilders } from './builders.mjs';
import { findCycle, overlappingConcurrentLanes, validatePlan } from './mission.mjs';
import { runsRoot } from './run-state.mjs';

export const RECON_TIMEOUT_MS = 8 * 60 * 1000;
export const AUTHOR_TIMEOUT_MS = 8 * 60 * 1000;

// A request long enough to be a written specification is treated as authoritative
// intent rather than a hint. The distinction changes only the authoring prompt:
// a short request is expanded from repository evidence, a specification is
// PRESERVED and translated. Tyler works a feature through ChatGPT and pastes the
// resulting build prompt; losing its explicit requirements would be the failure.
export function isDetailedSpec(text) {
  const source = String(text ?? '').trim();
  const lines = source.split(/\r?\n/).filter((line) => line.trim());
  return source.length >= 400 || lines.length >= 6;
}

export function authoringDir(root, authoringId) {
  return path.join(runsRoot(root), 'authoring', authoringId);
}

export function newAuthoringId(request, now = new Date()) {
  const slug =
    String(request)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'request';
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'z').toLowerCase();
  return `a-${slug}-${stamp}`;
}

// ------------------------------------------------------------ reconnaissance
//
// Three questions that are genuinely independent, so they run at once and cost
// one worker's wall clock instead of three. They are deliberately not "read the
// repository": each one names what it must come back with.

export const RECON_QUESTIONS = [
  {
    id: 'surface',
    question:
      'Which files own the OPERATOR-FACING SURFACE this request is about? Name the exact React/TSX components, ' +
      'routes, templates or dashboard sections, and the exact exported symbols that render the behaviour described. ' +
      'Also name the localhost URL or dashboard route where an operator sees it today.',
  },
  {
    id: 'server',
    question:
      'Which files own the SERVER, DATA AND BUSINESS LOGIC behind this request? Name the exact modules, exported ' +
      'functions, API route handlers, database tables or schema files, and any configuration that controls the ' +
      'behaviour described.',
  },
  {
    id: 'verification',
    question:
      'How is this area TESTED AND VERIFIED today? Name the exact existing test files that cover it, the exact ' +
      'command that runs just those tests (check package.json scripts and how other tests here are run, do not ' +
      'invent one), and anything already asserting the behaviour described.',
  },
];

export function composeReconPrompt(request, question, { detailed } = {}) {
  return [
    'You are a READ-ONLY reconnaissance worker for the LandOS development harness.',
    'You have no write tools. Do not attempt to edit anything. You are one of several workers running RIGHT NOW,',
    'each answering a different question about this repository. Answer only YOUR question.',
    '',
    detailed ? 'OPERATOR REQUEST (a full specification, read all of it):' : 'OPERATOR REQUEST:',
    request,
    '',
    'YOUR QUESTION:',
    question,
    '',
    'HOW TO WORK: search first, read narrowly. Use Grep and Glob to locate candidates, then read only the parts of',
    'the files that answer the question. Do not read whole subsystems. Stop as soon as you can answer precisely.',
    'You are being timed: a good answer in two minutes beats a perfect one in fifteen.',
    '',
    'OUTPUT. Your entire value is what you found. Report it as DISCOVERY lines, one finding per line:',
    '',
    '  DISCOVERY: <kind> <subject> — <one line finding>',
    '',
    'kind is one of file, symbol, test, route, config, shared.',
    'Example: DISCOVERY: file src/landos/comps.ts — owns the comp cap calculation in selectComps()',
    'Example: DISCOVERY: route /dashboard/deals/:id — the operator page that renders the comps section',
    'Example: DISCOVERY: test src/landos/comps.test.ts — 4 cases covering cap behaviour, run with npx vitest run <file>',
    '',
    'Every path you name must be a real repository-relative path you actually saw. A guessed path is worse than',
    'no answer: the mission plan will be built from these lines and will assign work against them.',
    'If the area genuinely does not exist yet, say so in a DISCOVERY line and name the closest existing place it',
    'would belong.',
    '',
    'End your final message with ATTEMPT_COMPLETE.',
  ].join('\n');
}

// ------------------------------------------------------------------ authoring

const PLAN_CONTRACT = `{
  "request":            string, the operator's request, preserved
  "operatorOutcome":    string, what must be visibly true for the operator when this is done
  "acceptanceCriteria": string[], the concrete conditions that decide acceptance
  "lanes": [
    {
      "id":         lowercase-kebab-case, unique
      "kind":       "recon" | "build"
      "title":      short label
      "brief":      the standalone instruction for the worker on this lane. It receives ONLY this text
                    plus the shared discoveries, so it must be self-contained and specific.
      "dependsOn":  string[] of lane ids that must finish first (omit or [] to start immediately)
      "ownedPaths": string[] of repository-relative paths this lane may edit. REQUIRED for kind "build".
                    A recon lane must not have any.
      "builderId":  optional, one of the available builder ids below
    }
  ],
  "focusedChecks":    [{ "id": kebab-case, "command": shell command, "requirement": one line }],
  "validationChecks": [{ "id": kebab-case, "command": shell command, "requirement": one line }],
  "browserCheck":     { "commands": string[], "url": string, "expectText": string[] }  // or omit
}`;

export function composeAuthorPrompt({ request, detailed, reconReports = [], builderIds = ['cc'], issues = [], previousPlan = null }) {
  const findings = reconReports
    .filter((entry) => entry.text?.trim())
    .map((entry) => `--- findings from the "${entry.id}" reconnaissance worker ---\n${entry.text.trim()}`)
    .join('\n\n');

  return [
    'You are the MISSION AUTHOR for the LandOS parallel development harness.',
    'You do not write any code. You produce ONE mission plan as JSON, and the harness executes it.',
    '',
    detailed
      ? [
          'OPERATOR REQUEST — this is a full written specification. It is AUTHORITATIVE.',
          'Preserve its requirements, its constraints, its explicit exclusions and its acceptance criteria.',
          'Do NOT summarise it into something vaguer, and do NOT drop a requirement because it seemed minor.',
          'Every explicit requirement in it must appear in some lane brief or acceptance criterion.',
        ].join('\n')
      : [
          'OPERATOR REQUEST — this is a short request. The operator has deliberately not specified the',
          'implementation. Infer it from the reconnaissance below and from normal engineering judgement.',
          'Do not ask questions. Decide.',
        ].join('\n'),
    '',
    request,
    '',
    findings
      ? [
          'RECONNAISSANCE OF THE CURRENT REPOSITORY (gathered concurrently, just now, by read-only workers):',
          '',
          findings,
          '',
          'These name real files that were actually read. Build the plan against them. Do not invent paths that',
          'contradict them, and do not send a worker to rediscover what is already stated here.',
        ].join('\n')
      : 'RECONNAISSANCE: none available. Be conservative: prefer one recon lane in wave 1 over guessing paths.',
    '',
    'PLAN CONTRACT — emit exactly this shape:',
    '```json',
    PLAN_CONTRACT,
    '```',
    '',
    'RULES THE HARNESS ENFORCES, so a plan that breaks them is rejected:',
    '  1. Two lanes that can run at the same time must own DISJOINT paths. If two pieces of work touch the same',
    '     file, either put them in one lane or make one dependsOn the other. Concurrency is the default; a',
    '     dependency edge is a cost, so only add one where output genuinely feeds input.',
    '  2. Every "build" lane must declare ownedPaths. A recon lane must not.',
    '  3. No dependency cycles.',
    '  4. Lane ids are lowercase kebab-case and unique.',
    '',
    'HOW TO BUILD A GOOD GRAPH:',
    '  - Split the work by what can proceed independently: surface vs server vs tests is usually the real seam.',
    '  - Do NOT manufacture lanes to look parallel. Two real lanes beat five artificial ones.',
    '  - Do NOT add a recon lane for something the reconnaissance above already answered.',
    '  - A lane brief must be executable by a worker that cannot ask questions. Name the file, the symbol, and the',
    '    behaviour required. "Improve the layout" is not a brief.',
    '',
    'CHECKS:',
    '  - focusedChecks are CHEAP and SPECIFIC: the one or two test files that cover this change, or a typecheck.',
    '    They run first and disprove a wrong candidate in seconds, and a failure is fed to a repair worker.',
    '  - validationChecks are the proportional certification (for example `npm run typecheck`, or the full suite',
    '    when the change is broad). Do not put the full suite in focusedChecks.',
    '  - THIS REPOSITORY HAS TWO TEST RUNNERS AND THEY ARE NOT INTERCHANGEABLE. Vitest only collects',
    '    `src/**/*.test.ts` and `web/src/**/*.test.ts`. Everything under `scripts/` is a `node:test` file and is',
    '    invisible to vitest, which exits 1 with "No test files found" rather than failing usefully. So:',
    '      application test file  ->  npx vitest run src/landos/thing.test.ts',
    '      script/harness test    ->  node --test scripts/devloop/thing.test.mjs',
    '      the whole harness suite->  npm run landos:build:test',
    '    `npm run typecheck` runs tsc --noEmit; `npm test` runs the full vitest suite (slow, validation only).',
    '  - A check command that cannot execute is worse than no check: it fails identically whether the work is',
    '    right or wrong, and the harness will spend its whole repair budget on it.',
    '  - If the change is operator-facing, include a browserCheck that restarts the managed runtime',
    '    (`npm run landos:restart`) and asserts the real page. Without one the harness will honestly report that',
    '    nothing operator-facing was verified.',
    '',
    `AVAILABLE BUILDERS: ${builderIds.join(', ')}. Leave builderId unset unless a lane has a specific reason to`,
    'prefer one. Reasonable reasons: heavier architectural reasoning, or spreading two long independent lanes',
    'across two different agents so they truly run at once.',
    '',
    issues.length
      ? [
          'YOUR PREVIOUS PLAN WAS REJECTED BY THE VALIDATOR. Fix exactly these problems and emit a corrected plan:',
          ...issues.map((issue) => `  - ${issue}`),
          '',
          'Your previous plan, for reference:',
          '```json',
          JSON.stringify(previousPlan, null, 2),
          '```',
        ].join('\n')
      : '',
    '',
    'OUTPUT: exactly one fenced ```json block containing the plan, and nothing after it. No commentary inside the',
    'JSON, no comments, no trailing text. End your final message with ATTEMPT_COMPLETE.',
  ]
    .filter((part) => part !== '')
    .join('\n');
}

/** Pull the plan out of a worker's prose. The last valid JSON object wins. */
export function extractPlan(text) {
  const source = String(text ?? '');
  const candidates = [...source.matchAll(/```(?:json)?\s*\r?\n([\s\S]*?)```/g)].map((match) => match[1]).reverse();
  const first = source.indexOf('{');
  const last = source.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(source.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.lanes)) return parsed;
    } catch {
      // Try the next candidate; prose around the block is expected.
    }
  }
  return null;
}

function slug(value, fallback) {
  const out = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return out || fallback;
}

/**
 * Repair the structural mistakes an authoring worker actually makes, rather than
 * handing them back to Tyler. Every repair here is mechanical and preserves the
 * author's intent: it never invents work and never deletes a lane.
 *
 * What it cannot fix — a build lane with no ownedPaths, an empty plan — is left
 * for the validator, which drives one automatic re-ask of the author.
 */
export function repairPlan(input) {
  const repairs = [];
  const plan = JSON.parse(JSON.stringify(input ?? {}));
  plan.lanes = Array.isArray(plan.lanes) ? plan.lanes : [];

  // ---- ids first, then rewrite every edge through the rename map
  const renames = new Map();
  const taken = new Set();
  plan.lanes.forEach((lane, index) => {
    const original = lane.id;
    let id = slug(lane.id ?? lane.title, `lane-${index + 1}`);
    if (taken.has(id)) {
      let suffix = 2;
      while (taken.has(`${id}-${suffix}`)) suffix += 1;
      id = `${id}-${suffix}`;
    }
    taken.add(id);
    if (original !== id) {
      repairs.push(`lane id ${JSON.stringify(original ?? null)} -> "${id}"`);
      if (typeof original === 'string') renames.set(original, id);
    }
    lane.id = id;
  });

  for (const lane of plan.lanes) {
    // ---- kind and brief
    if (lane.kind !== 'recon' && lane.kind !== 'build' && lane.kind !== 'repair') {
      const inferred = Array.isArray(lane.ownedPaths) && lane.ownedPaths.length ? 'build' : 'recon';
      repairs.push(`lane "${lane.id}" kind ${JSON.stringify(lane.kind ?? null)} -> "${inferred}"`);
      lane.kind = inferred;
    }
    if (typeof lane.brief !== 'string' || !lane.brief.trim()) {
      lane.brief = String(lane.title ?? lane.id);
      repairs.push(`lane "${lane.id}" had no brief; used its title`);
    }

    // ---- owned paths: normalise separators, drop empties, and strip them from
    // recon lanes, which are read-only by construction.
    const owned = (Array.isArray(lane.ownedPaths) ? lane.ownedPaths : [])
      .map((entry) => String(entry).split('\\').join('/').replace(/^\.\//, '').trim())
      .filter(Boolean);
    if (lane.kind === 'recon' && owned.length) {
      repairs.push(`recon lane "${lane.id}" declared ownedPaths; removed (recon lanes are read-only)`);
      lane.ownedPaths = [];
    } else {
      lane.ownedPaths = [...new Set(owned)];
    }

    // ---- edges: array, no self-edge, no unknown target
    const declared = Array.isArray(lane.dependsOn) ? lane.dependsOn : [];
    const resolved = [];
    for (const raw of declared) {
      const target = renames.get(raw) ?? raw;
      if (target === lane.id) {
        repairs.push(`lane "${lane.id}" depended on itself; edge dropped`);
        continue;
      }
      if (!taken.has(target)) {
        repairs.push(`lane "${lane.id}" depended on unknown lane "${raw}"; edge dropped`);
        continue;
      }
      if (!resolved.includes(target)) resolved.push(target);
    }
    lane.dependsOn = resolved;
  }

  // ---- cycles: break the edge that closes each one
  for (let guard = 0; guard < 32; guard += 1) {
    const cycle = findCycle(plan.lanes);
    if (!cycle) break;
    const from = plan.lanes.find((lane) => lane.id === cycle[cycle.length - 2]);
    const to = cycle[cycle.length - 1];
    if (!from) break;
    from.dependsOn = from.dependsOn.filter((entry) => entry !== to);
    repairs.push(`dependency cycle ${cycle.join(' -> ')}; edge "${from.id}" -> "${to}" dropped`);
  }

  // ---- write collisions: serialise rather than refuse. Two lanes claiming the
  // same file cannot run together, but they can run in order, and the author's
  // decomposition survives.
  for (let guard = 0; guard < 32; guard += 1) {
    const clashes = overlappingConcurrentLanes(plan.lanes);
    if (!clashes.length) break;
    const clash = clashes[0];
    const first = plan.lanes.find((lane) => lane.id === clash.a);
    const second = plan.lanes.find((lane) => lane.id === clash.b);
    second.dependsOn = [...second.dependsOn, first.id];
    if (findCycle(plan.lanes)) {
      second.dependsOn = second.dependsOn.filter((entry) => entry !== first.id);
      second.ownedPaths = second.ownedPaths.filter((entry) => !clash.paths.includes(entry));
      repairs.push(
        `lanes "${clash.a}" and "${clash.b}" both claimed ${clash.paths.join(', ')} and could not be ordered; ` +
          `removed the overlap from "${clash.b}"`,
      );
    } else {
      repairs.push(`lanes "${clash.a}" and "${clash.b}" both claimed ${clash.paths.join(', ')}; "${clash.b}" now waits for "${clash.a}"`);
    }
  }

  return { plan, repairs };
}

const OPERATOR_FACING = /\.(tsx|jsx|css|html)$|^src\/web\/|^public\/|^warroom\//;

// Vitest collects `src/**/*.test.ts` and `web/src/**/*.test.ts` and nothing else.
// Everything under `scripts/` is a node:test file it cannot see, and pointing
// vitest at one does not fail usefully: it exits 1 with "No test files found",
// identically whether the work is right or wrong. A check like that is worse
// than no check, because the harness cannot tell it from a real defect and
// spends its entire repair budget trying to fix code that was never broken.
// That is not hypothetical: it is exactly how one authored mission burned two
// repair attempts and ended FAIL.
const VITEST_COLLECTS = /^(src|web\/src)\//;
const TEST_TARGET = /\.(test|spec)\.[cm]?[jt]sx?$|\.mjs$/;

export function repairCheckCommand(command) {
  const source = String(command ?? '');
  if (!/\bvitest\b/.test(source)) return { command: source, note: null };

  const targets = source.split(/\s+/).filter((token) => TEST_TARGET.test(token));
  if (!targets.length) return { command: source, note: null };

  const reachable = targets.filter((token) => {
    const normalised = token.split('\\').join('/').replace(/^\.\//, '');
    return VITEST_COLLECTS.test(normalised) && !normalised.endsWith('.mjs');
  });
  // Only rewrite when the whole command is unreachable. A command mixing both
  // runners cannot be repaired by swapping one word, so it is left for the
  // validator and the operator to see rather than silently half-fixed.
  if (reachable.length) return { command: source, note: null };

  return {
    command: `node --test ${targets.join(' ')}`,
    note: `check command \`${source}\` cannot run: vitest does not collect ${targets.join(', ')}; rewrote it to node --test`,
  };
}

/**
 * Author-level lint. Separate from validatePlan on purpose: validatePlan decides
 * whether the executor CAN run the graph, this decides whether the mission would
 * actually prove anything. Two gaps are closed automatically because leaving
 * them produces a mission that passes without evidence.
 */
export function lintAuthoredPlan(input, { dashboardUrl = 'http://localhost:3141' } = {}) {
  const plan = JSON.parse(JSON.stringify(input ?? {}));
  const notes = [];

  for (const group of ['focusedChecks', 'validationChecks']) {
    for (const check of Array.isArray(plan[group]) ? plan[group] : []) {
      const repaired = repairCheckCommand(check.command);
      if (!repaired.note) continue;
      check.command = repaired.command;
      notes.push(`${group} "${check.id}": ${repaired.note}`);
    }
  }

  if (!Array.isArray(plan.acceptanceCriteria) || !plan.acceptanceCriteria.length) {
    plan.acceptanceCriteria = [plan.operatorOutcome ?? plan.request].filter(Boolean).map(String);
    notes.push('no acceptanceCriteria were authored; used the operator outcome as the single criterion');
  }

  if (!Array.isArray(plan.focusedChecks) || !plan.focusedChecks.length) {
    // A mission with no focused check cannot be cheaply disproved and cannot
    // drive a targeted repair, so it would "pass" having demonstrated nothing.
    plan.focusedChecks = [
      { id: 'typecheck', command: 'npm run typecheck', requirement: 'the repository typechecks after this change' },
    ];
    notes.push('no focusedChecks were authored; added `npm run typecheck` so the candidate can be cheaply disproved');
  }

  const touchesOperatorSurface = (plan.lanes ?? [])
    .flatMap((lane) => lane.ownedPaths ?? [])
    .some((entry) => OPERATOR_FACING.test(entry));
  if (touchesOperatorSurface && !plan.browserCheck) {
    plan.browserCheck = {
      commands: ['npm run landos:restart'],
      url: dashboardUrl,
      expectText: [],
    };
    notes.push(
      `this plan edits operator-facing files but authored no browserCheck; added a managed restart and an HTTP 200 ` +
        `assertion against ${dashboardUrl} so the running application is actually exercised`,
    );
  }

  return { plan, notes };
}

// ---------------------------------------------------------------- orchestration

function pickWorker(available, preferred) {
  if (preferred) return preferred;
  // Prefer the builder that can be constrained to read-only tools for recon, and
  // that is the same default the executor uses, so authoring and execution agree.
  if (available.includes('cc')) return 'cc';
  return available[0] ?? 'cc';
}

/**
 * Take a request and return a validated, launchable mission plan.
 *
 * Returns { plan, planPath, record }. `record` is the inspectable authoring
 * trail — request, findings, graph, worker assignments, repairs, timings — and
 * is written next to the generated plan. It is evidence, never an approval gate:
 * nothing here waits for a human.
 */
export async function authorMission({
  root,
  request,
  authoringId = newAuthoringId(request),
  reconCount = RECON_QUESTIONS.length,
  workerId = null,
  report = () => {},
  registry = BUILDERS,
  launch = launchBuilderAsync,
  now = () => Date.now(),
} = {}) {
  const startedAt = now();
  const directory = authoringDir(root, authoringId);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'request.txt'), String(request), 'utf8');

  const detailed = isDetailedSpec(request);
  const readiness = probeBuilders(registry);
  if (!readiness.available.length) throw new Error('No builder CLI is callable on this machine; cannot author a mission.');
  const worker = pickWorker(readiness.available, workerId);
  const builder = getBuilder(worker, registry);

  report('author.start', {
    message:
      `authoring a mission from a ${detailed ? 'detailed specification' : 'plain-English request'} ` +
      `(${String(request).length} chars) using ${builder.label}`,
  });

  // ---- wave 1: independent reconnaissance, concurrently
  const questions = RECON_QUESTIONS.slice(0, Math.max(0, reconCount));
  const reconStartedAt = now();
  report('author.recon', {
    message: `reconnaissance: ${questions.length} read-only worker(s) launching concurrently — ${questions.map((entry) => entry.id).join(', ')}`,
    concurrency: questions.length,
  });

  const reconReports = await Promise.all(
    questions.map(async (entry) => {
      const laneDirectory = path.join(directory, 'recon', entry.id);
      mkdirSync(laneDirectory, { recursive: true });
      const prompt = composeReconPrompt(request, entry.question, { detailed });
      writeFileSync(path.join(laneDirectory, 'prompt.md'), prompt, 'utf8');
      const result = await launch(builder, {
        cwd: root,
        promptText: prompt,
        attemptDir: laneDirectory,
        tools: CC_READONLY_TOOLS,
        timeoutMs: RECON_TIMEOUT_MS,
      });
      const text = result.finalMessage ?? result.stdout;
      writeFileSync(path.join(laneDirectory, 'report.txt'), String(text ?? ''), 'utf8');
      report('author.recon.done', {
        message: `  [${result.launched ? 'ok' : 'FAIL'}] recon ${entry.id} in ${Math.round(result.durationMs / 1000)}s`,
      });
      return { id: entry.id, text: String(text ?? ''), durationMs: result.durationMs, builderId: builder.id };
    }),
  );
  const reconMs = now() - reconStartedAt;

  const discoveries = harvestReconDiscoveries(reconReports);
  report('author.discoveries', { message: `reconnaissance produced ${discoveries.length} shared discovery(ies) in ${Math.round(reconMs / 1000)}s` });

  // ---- wave 2: author, then repair and re-ask automatically if rejected
  const authorStartedAt = now();
  let issues = [];
  let plan = null;
  let repairs = [];
  let lintNotes = [];
  let attempts = 0;

  while (attempts < 2) {
    attempts += 1;
    const attemptDirectory = path.join(directory, 'author', `attempt-${attempts}`);
    mkdirSync(attemptDirectory, { recursive: true });
    const prompt = composeAuthorPrompt({
      request,
      detailed,
      reconReports,
      builderIds: readiness.available,
      issues,
      previousPlan: plan,
    });
    writeFileSync(path.join(attemptDirectory, 'prompt.md'), prompt, 'utf8');
    report('author.compose', { message: `mission author attempt ${attempts} launched` });

    const result = await launch(builder, {
      cwd: root,
      promptText: prompt,
      attemptDir: attemptDirectory,
      tools: CC_READONLY_TOOLS,
      timeoutMs: AUTHOR_TIMEOUT_MS,
    });
    const text = result.finalMessage ?? result.stdout;
    writeFileSync(path.join(attemptDirectory, 'response.txt'), String(text ?? ''), 'utf8');

    const extracted = extractPlan(text);
    if (!extracted) {
      issues = ['no JSON mission plan could be extracted from your reply; emit exactly one fenced ```json block'];
      plan = null;
      report('author.reject', { message: `attempt ${attempts}: no plan JSON found in the reply` });
      continue;
    }

    extracted.request = String(request);
    const repaired = repairPlan(extracted);
    const linted = lintAuthoredPlan(repaired.plan);
    plan = linted.plan;
    repairs = repaired.repairs;
    lintNotes = linted.notes;
    for (const line of repairs) report('author.repair', { message: `  auto-repaired: ${line}` });
    for (const line of lintNotes) report('author.lint', { message: `  auto-completed: ${line}` });

    issues = validatePlan(plan);
    if (!issues.length) break;
    report('author.reject', { message: `attempt ${attempts}: plan rejected — ${issues.join('; ')}` });
  }

  const authorMs = now() - authorStartedAt;
  if (issues.length) {
    const error = new Error(`Mission authoring failed after ${attempts} attempt(s):\n- ${issues.join('\n- ')}`);
    error.authoringDir = directory;
    throw error;
  }

  plan.authoring = { authoringId, dir: path.relative(root, directory).split('\\').join('/') };
  const planPath = path.join(directory, 'plan.json');
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');

  const record = {
    authoringId,
    createdAt: new Date().toISOString(),
    request: String(request),
    mode: detailed ? 'specification' : 'short-request',
    worker: { builderId: builder.id, label: builder.label, availableBuilders: readiness.available },
    reconQuestions: questions.map((entry) => entry.id),
    reconReports: reconReports.map((entry) => ({ id: entry.id, durationMs: entry.durationMs, builderId: entry.builderId })),
    discoveries,
    operatorOutcome: plan.operatorOutcome ?? plan.request,
    acceptanceCriteria: plan.acceptanceCriteria ?? [],
    graph: plan.lanes.map((lane) => ({
      id: lane.id,
      kind: lane.kind,
      dependsOn: lane.dependsOn ?? [],
      ownedPaths: lane.ownedPaths ?? [],
      builderId: lane.builderId ?? null,
    })),
    focusedChecks: (plan.focusedChecks ?? []).map((check) => check.id),
    validationChecks: (plan.validationChecks ?? []).map((check) => check.id),
    browserCheck: plan.browserCheck ? { url: plan.browserCheck.url ?? null, commands: plan.browserCheck.commands ?? [] } : null,
    authorAttempts: attempts,
    autoRepairs: repairs,
    autoCompletions: lintNotes,
    timings: { reconMs, authorMs, totalMs: now() - startedAt },
    planPath: path.relative(root, planPath).split('\\').join('/'),
  };
  writeFileSync(path.join(directory, 'authoring.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  report('author.done', {
    message:
      `mission authored in ${Math.round(record.timings.totalMs / 1000)}s: ${plan.lanes.length} lane(s), ` +
      `${discoveries.length} shared discovery(ies), ${repairs.length} auto-repair(s)`,
  });

  return { plan, planPath, record, discoveries };
}

/**
 * Turn the recon workers' DISCOVERY lines into entries the mission can seed, so
 * every build lane inherits what authoring already learned instead of rereading
 * the same files. Same one-line contract the executor's lanes use.
 */
export function harvestReconDiscoveries(reconReports) {
  const entries = [];
  const seen = new Set();
  const pattern = /^\s*DISCOVERY:\s*(\S+)\s+(.+?)\s+(?:—|--|-)\s+(.+)$/gm;
  for (const entry of reconReports) {
    const source = String(entry.text ?? '');
    let match = pattern.exec(source);
    while (match) {
      const record = { kind: match[1].toLowerCase(), subject: match[2].trim(), note: match[3].trim().slice(0, 400) };
      const key = `${record.kind}::${record.subject}::${record.note}`;
      if (!seen.has(key)) {
        seen.add(key);
        entries.push({ ...record, from: entry.id });
      }
      match = pattern.exec(source);
    }
    pattern.lastIndex = 0;
  }
  return entries;
}
