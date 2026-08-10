#!/usr/bin/env node
// Instruction composition for the LandOS Development Improvement Loop.
//
// Every attempt gets ONE full standalone prompt, never a patch fragment and
// never a "see the previous session" reference: builders are stateless to each
// other, and a run can hand attempt 2 to a different agent than attempt 1.
// The loop, not the builder, owns what the next attempt is told.

export function applyCorrections(run, corrections) {
  if (!corrections) return run;
  run.corrections = [...(run.corrections ?? []), corrections];
  return run;
}

function bullet(lines) {
  return lines.map((line) => `- ${line}`).join('\n');
}

export function composeInstructions({ run, criteria, attemptNumber, builderId }) {
  const sections = [];

  sections.push(
    [
      `# LandOS Development Improvement Loop — run ${run.runId}, attempt ${attemptNumber}`,
      '',
      `You are the builder for this attempt. Your builder id is \`${builderId}\`.`,
      'You are interchangeable: a different coding agent may have made an earlier attempt,',
      'and a different one may make the next. Everything you need is in this prompt.',
    ].join('\n'),
  );

  sections.push(['## Task', '', run.task].join('\n'));
  sections.push(['## Operator outcome that must become true', '', criteria.operatorOutcome].join('\n'));

  sections.push(
    [
      '## Where you are',
      '',
      bullet([
        'Your working directory is an isolated git worktree created for this run, checked out detached at the repository HEAD.',
        'It is not the owner\'s working checkout. Uncommitted work in progress elsewhere is deliberately absent, and you cannot reach it.',
        'Work from what is here. Do not go looking for another copy of the repository, and never write to a path outside this working directory.',
        'Earlier attempts on this run, including attempts by a different builder, left their work in this same worktree. Build on it.',
      ]),
    ].join('\n'),
  );

  sections.push(
    [
      '## Hard boundary',
      '',
      bullet([
        `Create and edit files only under: ${criteria.allowedPaths.join(', ')}`,
        'Any change outside those paths fails acceptance outright, even inside this worktree.',
        'Do not run git commands. Do not stage, commit, push, stash, clean or revert anything.',
        'Do not read, write or print .env, secrets, credentials or tokens.',
        'Do not modify .landos/PERMANENT_MEMORY.md, .landos/CODING_SESSION_PROTOCOL.md, .landos/CHECKPOINT.md, CLAUDE.md or AGENTS.md.',
        'Do not modify anything under scripts/devloop/. That is the loop that is running you.',
      ]),
    ].join('\n'),
  );

  sections.push(['## What to build', '', run.currentBrief].join('\n'));

  const priorAttempts = (run.attempts ?? []).filter((attempt) => attempt.attemptNumber < attemptNumber);
  if (priorAttempts.length) {
    sections.push(
      [
        '## Attempt history on this run',
        '',
        bullet(
          priorAttempts.map(
            (attempt) =>
              `attempt ${attempt.attemptNumber} by builder \`${attempt.builderId}\` claimed ${attempt.claim} and the independent evaluator returned ${attempt.verdict}` +
              (attempt.failedCheckIds?.length ? ` on: ${attempt.failedCheckIds.join(', ')}` : ''),
          ),
        ),
      ].join('\n'),
    );
  }

  const corrections = run.corrections ?? [];
  if (corrections.length) {
    const blocks = corrections.map((correction) => {
      const items = correction.items
        .map((item) => `  - ${item.instruction}\n    Observed after attempt ${correction.afterAttempt}: ${item.observed}`)
        .join('\n');
      return `After attempt ${correction.afterAttempt} (builder \`${correction.byBuilder}\`):\n${items}`;
    });
    sections.push(
      [
        '## Corrections required by the independent evaluator',
        '',
        'These are not suggestions. Each one is an acceptance criterion that was measured and found false.',
        'Every correction below must be true when you finish, in addition to everything above.',
        '',
        blocks.join('\n\n'),
      ].join('\n'),
    );
  }

  sections.push(
    [
      '## How this attempt is judged',
      '',
      bullet([
        'An independent evaluator, not you, decides PASS or FAIL.',
        'It runs against acceptance criteria that were frozen when the run was created and cannot be edited.',
        'It runs its own probes; passing tests you wrote yourself is necessary but never sufficient.',
        'Your own completion claim is recorded as evidence about you. Claiming completion while a criterion is false counts against you and can hand the task to a different builder.',
      ]),
    ].join('\n'),
  );

  sections.push(
    [
      '## Finish',
      '',
      bullet([
        'Implement the work, then stop. Do not run the loop, do not evaluate yourself, do not start unrelated work.',
        'End your final message with exactly `ATTEMPT_COMPLETE` if you believe the work is done, or `ATTEMPT_BLOCKED` followed by the one blocking reason if it is not.',
      ]),
    ].join('\n'),
  );

  return `${sections.join('\n\n')}\n`;
}
