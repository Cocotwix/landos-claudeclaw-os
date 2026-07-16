// LandOS Sprint System — Repeated-Failure Root-Cause Gate.
//
// When the same failure pattern occurs twice, the system requires a shared
// root-cause review instead of permitting another isolated patch. The
// registry is compact and practical: one entry per stable pattern key, a list
// of occurrences, and (once required) a completed review with permanent
// regression coverage. Workstream acceptance is refused while a triggered
// review is outstanding for any of its findings' patterns.

import fs from 'fs';
import path from 'path';

export const RECURRENCE_PATH = path.join('.landos', 'qa', 'recurrence.json');

export interface RecurrenceOccurrence {
  sprintId: string;
  findingId: string;
  at: string;
  summary: string;
}

export interface RootCauseReview {
  completedAt: string;
  /** How many recorded occurrences this review covers. */
  coversOccurrences: number;
  failurePattern: string;
  sharedRootCause: string;
  whyAutomatedTestsMissedIt: string;
  whyBrowserQaMissedIt: string;
  missingInvariant: string;
  missingAcceptanceJourney: string;
  sharedRepair: string;
  newRegressionTest: string;
  newBrowserAssertion: string;
  affectedCapabilities: string[];
  reopenAcceptedCapability: boolean;
}

export interface RecurrenceRegistry {
  schema: 1;
  patterns: Record<string, { occurrences: RecurrenceOccurrence[]; review: RootCauseReview | null }>;
}

export function emptyRegistry(): RecurrenceRegistry {
  return { schema: 1, patterns: {} };
}

export function loadRecurrenceRegistry(root: string): RecurrenceRegistry {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(root, RECURRENCE_PATH), 'utf8'));
    return value?.schema === 1 ? (value as RecurrenceRegistry) : emptyRegistry();
  } catch {
    return emptyRegistry();
  }
}

export function saveRecurrenceRegistry(root: string, registry: RecurrenceRegistry): string {
  const file = path.join(root, RECURRENCE_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  return file;
}

/** Record a failure occurrence. Returns whether a root-cause review is now required. */
export function recordOccurrence(
  registry: RecurrenceRegistry,
  patternKey: string,
  occurrence: RecurrenceOccurrence,
): { occurrences: number; reviewRequired: boolean } {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(patternKey)) {
    throw new Error(`pattern key must be kebab-case: ${patternKey}`);
  }
  const entry = registry.patterns[patternKey] ?? { occurrences: [], review: null };
  registry.patterns[patternKey] = entry;
  if (!entry.occurrences.some((o) => o.sprintId === occurrence.sprintId && o.findingId === occurrence.findingId)) {
    entry.occurrences.push(occurrence);
  }
  return { occurrences: entry.occurrences.length, reviewRequired: reviewRequired(registry, patternKey) };
}

export function reviewRequired(registry: RecurrenceRegistry, patternKey: string): boolean {
  const entry = registry.patterns[patternKey];
  if (!entry) return false;
  if (entry.occurrences.length < 2) return false;
  return !entry.review || entry.review.coversOccurrences < entry.occurrences.length;
}

/** Pattern keys whose triggered root-cause review is still outstanding. */
export function patternsAwaitingRootCause(registry: RecurrenceRegistry): string[] {
  return Object.keys(registry.patterns).filter((key) => reviewRequired(registry, key));
}

const REVIEW_TEXT_FIELDS: (keyof Omit<RootCauseReview, 'completedAt' | 'coversOccurrences'>)[] = [
  'failurePattern',
  'sharedRootCause',
  'whyAutomatedTestsMissedIt',
  'whyBrowserQaMissedIt',
  'missingInvariant',
  'missingAcceptanceJourney',
  'sharedRepair',
  'newRegressionTest',
  'newBrowserAssertion',
];

export function completeRootCauseReview(
  registry: RecurrenceRegistry,
  patternKey: string,
  review: Omit<RootCauseReview, 'completedAt' | 'coversOccurrences'>,
  now: () => string = () => new Date().toISOString(),
): RootCauseReview {
  const entry = registry.patterns[patternKey];
  if (!entry) throw new Error(`unknown failure pattern ${patternKey}`);
  const problems = REVIEW_TEXT_FIELDS.filter((field) => !String(review[field] ?? '').trim());
  if (problems.length) {
    throw new Error(`root-cause review for ${patternKey} is incomplete: missing ${problems.join(', ')}`);
  }
  const completed: RootCauseReview = {
    ...review,
    completedAt: now(),
    coversOccurrences: entry.occurrences.length,
  };
  entry.review = completed;
  return completed;
}

/** Prior occurrences of a pattern, for the review record and QA briefs. */
export function priorOccurrences(registry: RecurrenceRegistry, patternKey: string): RecurrenceOccurrence[] {
  return registry.patterns[patternKey]?.occurrences ?? [];
}

/** Compact one-line summaries of known patterns, injected into QA briefs. */
export function knownFailurePatternSummaries(registry: RecurrenceRegistry): string[] {
  return Object.entries(registry.patterns).map(([key, entry]) => {
    const state = reviewRequired(registry, key)
      ? 'ROOT-CAUSE REVIEW OUTSTANDING'
      : entry.review
        ? 'reviewed'
        : 'single occurrence';
    return `${key}: ${entry.occurrences.length} occurrence(s) (${state})`;
  });
}
