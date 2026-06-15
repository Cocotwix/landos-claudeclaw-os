// Tests for the Forge host-adapter store. In-memory DB per test, mirroring the
// LandOS db test convention (_initTestLandosDb).

import { beforeEach, describe, expect, it } from 'vitest';

import {
  _initTestForgeDb,
  saveEngagement,
  listEngagements,
  getEngagement,
  updateEngagement,
  FORGE_STATUSES,
  type SaveForgeEngagementInput,
} from './host-store.js';

beforeEach(() => {
  _initTestForgeDb();
});

function sample(overrides: Partial<SaveForgeEngagementInput> = {}): SaveForgeEngagementInput {
  return {
    title: 'Add a date helper',
    rawRequest: 'Add a date helper to src/utils with a test.',
    host: 'LandOS Mission Control',
    verdict: 'SAFE',
    categories: [],
    hits: [],
    notice: 'No red-lane trigger detected.',
    decisionsNeeded: ['None required to start safe-lane work.'],
    markdown: '# Forge Engagement\n...',
    ...overrides,
  };
}

describe('Forge host store', () => {
  it('saves and reads back an engagement with parsed arrays', () => {
    const saved = saveEngagement(sample());
    expect(saved.id).toMatch(/^[0-9a-f]{8}$/);
    expect(saved.status).toBe('draft');
    expect(saved.verdict).toBe('SAFE');
    expect(Array.isArray(saved.categories)).toBe(true);
    expect(Array.isArray(saved.hits)).toBe(true);
    expect(saved.createdAt).toBeGreaterThan(0);

    const fetched = getEngagement(saved.id);
    expect(fetched).toBeDefined();
    expect(fetched!.title).toBe('Add a date helper');
    expect(fetched!.decisionsNeeded).toEqual(['None required to start safe-lane work.']);
  });

  it('round-trips STOP lane hits as structured JSON', () => {
    const saved = saveEngagement(
      sample({
        verdict: 'STOP',
        categories: ['git_push_or_deploy', 'secrets_credentials'],
        hits: [
          { category: 'git_push_or_deploy', label: 'Git push / deploy', matchedText: 'git push' },
          { category: 'secrets_credentials', label: 'Secrets / credentials', matchedText: 'API key' },
        ],
        decisionsNeeded: ['Decide / authorize: Git push / deploy.'],
      }),
    );
    const fetched = getEngagement(saved.id)!;
    expect(fetched.verdict).toBe('STOP');
    expect(fetched.categories).toContain('secrets_credentials');
    expect(fetched.hits[0].matchedText).toBe('git push');
  });

  it('lists engagements newest-first and filters by status', () => {
    saveEngagement(sample({ title: 'first' }));
    const second = saveEngagement(sample({ title: 'second', status: 'needs_review' }));

    const all = listEngagements();
    expect(all.length).toBe(2);
    // newest-first: second was inserted last
    expect(all[0].id).toBe(second.id);

    const filtered = listEngagements({ status: 'needs_review' });
    expect(filtered.length).toBe(1);
    expect(filtered[0].title).toBe('second');
  });

  it('updates status, notes, and title and bumps updated_at', () => {
    const saved = saveEngagement(sample());
    const updated = updateEngagement(saved.id, { status: 'ready_to_push', notes: 'looks good', title: 'renamed' });
    expect(updated).toBeDefined();
    expect(updated!.status).toBe('ready_to_push');
    expect(updated!.notes).toBe('looks good');
    expect(updated!.title).toBe('renamed');
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(saved.createdAt);
  });

  it('ignores an invalid status on update and returns undefined for unknown id', () => {
    const saved = saveEngagement(sample());
    const updated = updateEngagement(saved.id, { status: 'not_a_status' as never });
    expect(updated!.status).toBe('draft'); // unchanged
    expect(updateEngagement('deadbeef', { status: 'pushed' })).toBeUndefined();
  });

  it('exposes the full status vocabulary', () => {
    expect(FORGE_STATUSES).toContain('needs_review');
    expect(FORGE_STATUSES).toContain('ready_to_push');
    expect(FORGE_STATUSES).toContain('pushed');
    expect(FORGE_STATUSES).toContain('blocked');
  });
});
