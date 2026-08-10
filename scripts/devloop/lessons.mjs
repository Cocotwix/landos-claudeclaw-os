#!/usr/bin/env node
// Candidate permanent lessons for the LandOS Development Improvement Loop.
//
// The loop may notice that the same failure keeps recurring across runs and
// propose a lesson. It may never promote one. The canonical governing files are
// written by Tyler, and a proposal that rewrote them automatically would let a
// loop edit the rules that bound the loop. Every candidate lands in one review
// file with status "candidate" and nothing else happens.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CANDIDATE_LESSONS_PATH } from './run-state.mjs';

// Files the loop is structurally forbidden to write, whatever a lesson says.
export const PROTECTED_DOCTRINE = [
  '.landos/PERMANENT_MEMORY.md',
  '.landos/CODING_SESSION_PROTOCOL.md',
  '.landos/CHECKPOINT.md',
  '.landos/CONTINUITY_PROTOCOL.md',
  'CLAUDE.md',
  'AGENTS.md',
];

export function assertNotDoctrine(relativePath) {
  const normalised = String(relativePath).replace(/\\/g, '/').replace(/^\.\//, '');
  if (PROTECTED_DOCTRINE.some((entry) => entry.toLowerCase() === normalised.toLowerCase())) {
    throw new Error(
      `The development loop never writes canonical governance (${normalised}). ` +
        'Record a candidate lesson for review instead.',
    );
  }
  return normalised;
}

export function loadCandidateLessons(root) {
  const file = path.join(root, CANDIDATE_LESSONS_PATH);
  if (!existsSync(file)) return { lessons: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return { lessons: Array.isArray(parsed?.lessons) ? parsed.lessons : [] };
  } catch {
    return { lessons: [] };
  }
}

export function recordCandidateLesson(root, lesson, { now = new Date() } = {}) {
  assertNotDoctrine(lesson.proposedTarget ?? CANDIDATE_LESSONS_PATH);
  const file = path.join(root, CANDIDATE_LESSONS_PATH);
  const store = loadCandidateLessons(root);
  const key = `${lesson.runId}:${lesson.pattern}`;
  const existing = store.lessons.find((entry) => `${entry.runId}:${entry.pattern}` === key);
  if (existing) {
    existing.occurrences += 1;
    existing.lastSeen = now.toISOString();
  } else {
    store.lessons.push({
      recordedAt: now.toISOString(),
      lastSeen: now.toISOString(),
      status: 'candidate',
      appliedAutomatically: false,
      occurrences: 1,
      ...lesson,
    });
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        note:
          'Candidate lessons proposed by the development improvement loop. Nothing here is in force. ' +
          'Tyler promotes a lesson by editing the canonical governance by hand; the loop never does.',
        lessons: store.lessons,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return store.lessons.length;
}

// A lesson is only worth proposing when a pattern repeats. One failed attempt is
// a bug; the same check failing across attempts is a lesson about how the loop
// briefs builders.
export function deriveCandidateLessons(run, criteria) {
  const counts = new Map();
  for (const attempt of run.attempts ?? []) {
    for (const id of attempt.failedCheckIds ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const lessons = [];
  for (const [checkId, occurrences] of counts) {
    if (occurrences < 2) continue;
    const check = criteria.checks.find((entry) => entry.id === checkId);
    lessons.push({
      runId: run.runId,
      pattern: `repeated-failure:${checkId}`,
      statement:
        `Builders repeatedly failed "${checkId}" on run ${run.runId}. ` +
        `State this requirement in the initial brief instead of letting the evaluator discover it: ${check?.requirement ?? checkId}`,
      evidence: `failed on ${occurrences} attempts across builders ${[...new Set((run.attempts ?? []).map((a) => a.builderId))].join(', ')}`,
      proposedTarget: 'operator brief template',
    });
  }
  return lessons;
}
