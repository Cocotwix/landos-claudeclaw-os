// Structural checks on the failure-category surfaces added by the reliability
// phase. The web app runs in a browser (no jsdom here), so we source-scan the
// .tsx like the other LandOS UI tests.
//
// The defect these pin was found by visual inspection, not by the suite: the
// Scheduled page renders tasks in TWO views, and only the card view showed the
// category. In the list view an expired provider login and an unreachable
// provider were both just `failed` — the exact ambiguity the taxonomy exists to
// remove. Any surface that shows a task's status must also be able to show WHY
// it failed.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const read = (rel: string) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');

const SCHEDULED = read('../../web/src/pages/Scheduled.tsx');
const MISSION = read('../../web/src/pages/MissionControl.tsx');

/**
 * Count conditional render sites for a field: `{task.<field> && (` / `{t.<field> && (`.
 * Counting the guard rather than every mention avoids miscounting the
 * tone-selection ternaries, which reference the field several times per view.
 */
function renderSites(source: string, field: string): number {
  return (source.match(new RegExp(`\\{(?:task|t)\\.${field} && \\(`, 'g')) ?? []).length;
}

describe('Scheduled page failure-category surfaces', () => {
  it('declares last_failure_category on the task model', () => {
    expect(SCHEDULED).toMatch(/last_failure_category\??: string \| null/);
  });

  it('renders the category in EVERY view that renders last_status', () => {
    // Card view and list view both show last_status; both must show the
    // category too, or the two views disagree about the same task.
    const statusSites = renderSites(SCHEDULED, 'last_status');
    const categorySites = renderSites(SCHEDULED, 'last_failure_category');
    expect(statusSites).toBeGreaterThanOrEqual(2);
    expect(
      categorySites,
      'every view rendering last_status must also render last_failure_category',
    ).toBeGreaterThanOrEqual(statusSites);
  });

  it('renders the category conditionally, so a task without one shows no pill', () => {
    expect(SCHEDULED).toMatch(/\{task\.last_failure_category && \(/);
  });

  it('lets the list-view status pills wrap instead of widening the table', () => {
    // A long category (`provider_unavailable`) in a whitespace-nowrap cell
    // pushes the table into a horizontal scroll.
    expect(SCHEDULED).toMatch(/flex flex-wrap items-center gap-1/);
  });
});

describe('Mission Control failure-category surfaces', () => {
  it('declares failure_category on the task model', () => {
    expect(MISSION).toMatch(/failure_category\??: string \| null/);
  });

  it('renders the category on the task card and in task history', () => {
    // Two surfaces: the delegation-column card and the history drawer row.
    expect(renderSites(MISSION, 'failure_category')).toBeGreaterThanOrEqual(2);
  });

  it('renders the category conditionally on both surfaces', () => {
    expect(MISSION).toMatch(/\{task\.failure_category && \(/);
    expect(MISSION).toMatch(/\{t\.failure_category && \(/);
  });

  it('never renders a category for a task that has none', () => {
    // Guard against a future `?? 'unknown'` fallback: a successful or queued
    // task must show no failure badge at all.
    expect(MISSION).not.toMatch(/failure_category \?\?/);
    expect(SCHEDULED).not.toMatch(/last_failure_category \?\?/);
  });
});
