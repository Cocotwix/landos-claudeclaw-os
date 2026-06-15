// Forge command planner / approval batching helper — pure Forge Core.
//
// Deterministic, dependency-free, host-neutral. Turns a Forge engagement into
// a recommended Claude Code execution PLAN as plain text. It outputs text
// only: it never executes commands, never shells out, makes no network calls,
// reads no env, and touches no secrets. The plan is advice for the operator;
// the hard safety rails are always included verbatim regardless of input.

export interface CommandPlanInput {
  title?: string;
  verdict?: 'SAFE' | 'STOP';
  /** Red-lane categories detected by the lane gate, if any. */
  categories?: string[];
  expectedChangedFiles?: string[];
  testsToRun?: string[];
}

const PLACEHOLDER = '<fill in>';

const DEFAULT_TESTS = [
  'npx vitest run src/forge/engagement.test.ts',
  'npx vitest run src/dashboard.contract.test.ts -t "forge"',
  'npm run typecheck',
  'npm run build:web',
];

// The hard safety rails. These are ALWAYS emitted under "Never approve" so the
// planner can never produce a plan that quietly green-lights an owner-owned or
// destructive action.
export const NEVER_APPROVE_RAILS = [
  'git add . (stage exact files by path only)',
  'git push before Codex review passes',
  'reading or printing .env values',
  'printing secrets, tokens, API keys, or JWTs',
  'broad or recursive deletes (rm -rf, deleting files you did not create)',
  'dependency installs (npm install / yarn add) without explicit approval',
  'paid tools or paid APIs without explicit approval',
  'destructive commands (drop table, overwrite, wipe, truncate)',
  'connecting private accounts or external/financial/legal platforms',
];

function mdList(items: string[]): string {
  return items.length ? items.map((i) => `- ${i}`).join('\n') : `- ${PLACEHOLDER}`;
}

/**
 * Build a Claude Code execution plan for an engagement. Pure and
 * deterministic. The "Never approve" rails are constant.
 */
export function generateCommandPlan(input: CommandPlanInput): string {
  const title = input.title?.trim() || 'Forge engagement';
  const verdict = input.verdict ?? 'SAFE';
  const categories = input.categories ?? [];
  const changed = input.expectedChangedFiles ?? [];
  const tests = input.testsToRun && input.testsToRun.length ? input.testsToRun : DEFAULT_TESTS;

  const stopWarning =
    verdict === 'STOP'
      ? `\n> Lane verdict is STOP (${categories.join(', ') || 'owner-owned decision'}). Resolve the owner-owned decision(s) before running ANY build commands below.\n`
      : '';

  return `# Forge Command Plan — ${title}

Lane verdict: ${verdict}
${stopWarning}
## Inspect first
- Read the target files and surrounding conventions with native read-only tools.
- Confirm the exact approved file set before editing.

## Safe bundled commands (no approval drip)
- Read / search / glob source files.
- Run tests, typecheck, and the web build.
- Write approved artifacts inside the approved scope.

## Commands requiring separate approval
- Editing files outside the pre-approved scope.
- Staging files (git add <exact paths>).
- git commit.
- Any newly discovered red-lane action.

## Never approve
${mdList(NEVER_APPROVE_RAILS)}

## Tests to run
${mdList(tests)}

## Exact staging guidance
- Stage only these files, by explicit path (never git add .):
${mdList(changed)}
- Confirm the staged list equals the approved set before committing.

## Commit guidance
- Commit once, with a clear message describing the milestone.
- Do not commit .env, logs, secrets, or unrelated untracked files.

## Codex review handoff
- Generate the review packet, hand it to Codex, and wait.
- Do not push until Codex returns PASS and "Safe to push: Yes".
`;
}
