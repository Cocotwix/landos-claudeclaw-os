// Tests for the Forge host-adapter store. In-memory DB per test, mirroring the
// host db test convention (a fresh in-memory database per test).

import { beforeEach, describe, expect, it } from 'vitest';

import {
  _initTestForgeDb,
  saveEngagement,
  listEngagements,
  getEngagement,
  updateEngagement,
  saveAgentProfile,
  listAgentProfiles,
  getAgentProfile,
  updateAgentProfile,
  savePromotionScaffold,
  listPromotionScaffolds,
  getPromotionScaffold,
  updatePromotionScaffold,
  saveAgentRetrofit,
  listAgentRetrofits,
  getAgentRetrofit,
  updateAgentRetrofit,
  FORGE_STATUSES,
  FORGE_PROFILE_STATUSES,
  FORGE_PROFILE_SCHEMA_VERSION,
  FORGE_SCAFFOLD_STATUSES,
  FORGE_SCAFFOLD_SCHEMA_VERSION,
  FORGE_RETROFIT_STATUSES,
  FORGE_RETROFIT_SCHEMA_VERSION,
  type SaveForgeEngagementInput,
  type SaveAgentProfileInput,
  type SavePromotionScaffoldInput,
  type SaveAgentRetrofitInput,
} from './host-store.js';
import {
  buildAgentProfile,
  deriveAuthorityModel,
  generateAgentBuildPacket,
} from './agent-profile.js';
import {
  generatePromotionScaffold,
  renderPromotionScaffoldMarkdown,
} from './promotion-scaffold.js';
import {
  buildSnapshotFromFiles,
  reconstructAgentProfile,
  analyzeRetrofitGaps,
  assessRetrofitReadiness,
  generateRetrofitUpgradePlan,
  renderRetrofitReviewPacketMarkdown,
} from './agent-retrofit.js';

beforeEach(() => {
  _initTestForgeDb();
});

function sample(overrides: Partial<SaveForgeEngagementInput> = {}): SaveForgeEngagementInput {
  return {
    title: 'Add a date helper',
    rawRequest: 'Add a date helper to src/utils with a test.',
    host: 'Mission Control',
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

  it('defaults ownerDecision to pending and round-trips an update', () => {
    const saved = saveEngagement(sample());
    expect(saved.ownerDecision).toBe('pending');
    const updated = updateEngagement(saved.id, { ownerDecision: 'approved' });
    expect(updated!.ownerDecision).toBe('approved');
  });

  it('ignores an invalid ownerDecision on update', () => {
    const saved = saveEngagement(sample());
    const updated = updateEngagement(saved.id, { ownerDecision: 'bogus' as never });
    expect(updated!.ownerDecision).toBe('pending');
  });
});

function sampleProfile(
  overrides: Partial<SaveAgentProfileInput> = {},
): SaveAgentProfileInput {
  const profile = buildAgentProfile({
    rawRequest: 'an agent that drafts and organizes status updates',
    displayName: 'Reporter',
    department: 'Reporting',
    createdAt: '2026-06-15T00:00:00.000Z',
  });
  return {
    displayName: profile.displayName,
    department: profile.department,
    request: 'an agent that drafts and organizes status updates',
    profile,
    buildPacket: generateAgentBuildPacket(profile),
    interview: '# Define a department agent: Reporter\n',
    authoritySummary: deriveAuthorityModel(profile).summary,
    activationMode: profile.activationMode,
    ...overrides,
  };
}

describe('Forge saved department-agent profiles', () => {
  it('saves and reads back a profile with parsed JSON', () => {
    const saved = saveAgentProfile(sampleProfile());
    expect(saved.id).toMatch(/^[0-9a-f]{8}$/);
    expect(saved.status).toBe('draft');
    expect(saved.ownerDecision).toBe('pending');
    expect(saved.activationMode).toBe('sandbox');
    expect(saved.schemaVersion).toBe(FORGE_PROFILE_SCHEMA_VERSION);
    expect(saved.profile.displayName).toBe('Reporter');
    expect(saved.profile.hardStops.length).toBeGreaterThan(0);
    expect(saved.buildPacket).toContain('# Forge Agent Build Packet');

    const fetched = getAgentProfile(saved.id);
    expect(fetched).toBeDefined();
    expect(fetched!.department).toBe('Reporting');
    expect(fetched!.profile.agentName).toBe('reporter');
  });

  it('lists profiles newest-first and filters by status', () => {
    saveAgentProfile(sampleProfile());
    const second = saveAgentProfile(sampleProfile({ status: 'review_ready' }));

    const all = listAgentProfiles();
    expect(all.length).toBe(2);
    expect(all[0].id).toBe(second.id);

    const filtered = listAgentProfiles({ status: 'review_ready' });
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe(second.id);
  });

  it('updates status, owner decision, notes, and display name', () => {
    const saved = saveAgentProfile(sampleProfile());
    const updated = updateAgentProfile(saved.id, {
      status: 'approved',
      ownerDecision: 'approved',
      notes: 'looks good',
      displayName: 'Status Reporter',
    });
    expect(updated).toBeDefined();
    expect(updated!.status).toBe('approved');
    expect(updated!.ownerDecision).toBe('approved');
    expect(updated!.notes).toBe('looks good');
    expect(updated!.displayName).toBe('Status Reporter');
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(saved.createdAt);
  });

  it('ignores an invalid status/decision on update and returns undefined for unknown id', () => {
    const saved = saveAgentProfile(sampleProfile());
    const updated = updateAgentProfile(saved.id, {
      status: 'not_a_status' as never,
      ownerDecision: 'bogus' as never,
    });
    expect(updated!.status).toBe('draft'); // unchanged
    expect(updated!.ownerDecision).toBe('pending'); // unchanged
    expect(updateAgentProfile('deadbeef', { status: 'promoted' })).toBeUndefined();
  });

  it('exposes the full profile status vocabulary', () => {
    expect(FORGE_PROFILE_STATUSES).toContain('draft');
    expect(FORGE_PROFILE_STATUSES).toContain('review_ready');
    expect(FORGE_PROFILE_STATUSES).toContain('approved');
    expect(FORGE_PROFILE_STATUSES).toContain('needs_revision');
    expect(FORGE_PROFILE_STATUSES).toContain('held');
    expect(FORGE_PROFILE_STATUSES).toContain('rejected');
    expect(FORGE_PROFILE_STATUSES).toContain('promoted');
  });
});

function sampleScaffold(
  overrides: Partial<SavePromotionScaffoldInput> = {},
): SavePromotionScaffoldInput {
  const profile = buildAgentProfile({
    rawRequest: 'an agent that drafts and organizes status updates',
    displayName: 'Reporter',
    department: 'Reporting',
    createdAt: '2026-06-15T00:00:00.000Z',
  });
  const scaffold = generatePromotionScaffold({ profile });
  return {
    savedProfileId: 'abc12345',
    displayName: scaffold.displayName,
    department: scaffold.department,
    proposedSlug: scaffold.proposedSlug,
    scaffold,
    markdown: renderPromotionScaffoldMarkdown(scaffold),
    ...overrides,
  };
}

describe('Forge draft promotion scaffolds', () => {
  it('saves and reads back a scaffold with parsed JSON', () => {
    const saved = savePromotionScaffold(sampleScaffold());
    expect(saved.id).toMatch(/^[0-9a-f]{8}$/);
    expect(saved.status).toBe('draft');
    expect(saved.ownerDecision).toBe('pending');
    expect(saved.schemaVersion).toBe(FORGE_SCAFFOLD_SCHEMA_VERSION);
    expect(saved.proposedSlug).toBe('reporter');
    expect(saved.scaffold.files.length).toBeGreaterThan(0);
    expect(saved.scaffold.notActive.join(' ')).toContain('Not active');

    const fetched = getPromotionScaffold(saved.id);
    expect(fetched).toBeDefined();
    expect(fetched!.savedProfileId).toBe('abc12345');
    expect(fetched!.scaffold.proposedFolder).toBe('forge/drafts/promotions/reporter');
  });

  it('lists scaffolds newest-first and filters by status and profile id', () => {
    savePromotionScaffold(sampleScaffold({ savedProfileId: 'p1' }));
    const second = savePromotionScaffold(
      sampleScaffold({ savedProfileId: 'p2', status: 'review_ready' }),
    );
    const all = listPromotionScaffolds();
    expect(all.length).toBe(2);
    expect(all[0].id).toBe(second.id);

    expect(listPromotionScaffolds({ status: 'review_ready' }).length).toBe(1);
    expect(listPromotionScaffolds({ savedProfileId: 'p1' }).length).toBe(1);
    expect(listPromotionScaffolds({ savedProfileId: 'p1' })[0].savedProfileId).toBe('p1');
  });

  it('updates status, owner decision, and notes', () => {
    const saved = savePromotionScaffold(sampleScaffold());
    const updated = updatePromotionScaffold(saved.id, {
      status: 'approved_for_generation',
      ownerDecision: 'approved',
      notes: 'go',
    });
    expect(updated!.status).toBe('approved_for_generation');
    expect(updated!.ownerDecision).toBe('approved');
    expect(updated!.notes).toBe('go');
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(saved.createdAt);
  });

  it('ignores invalid status/decision and returns undefined for unknown id', () => {
    const saved = savePromotionScaffold(sampleScaffold());
    const updated = updatePromotionScaffold(saved.id, {
      status: 'nope' as never,
      ownerDecision: 'bogus' as never,
    });
    expect(updated!.status).toBe('draft');
    expect(updated!.ownerDecision).toBe('pending');
    expect(updatePromotionScaffold('deadbeef', { status: 'held' })).toBeUndefined();
  });

  it('exposes the full scaffold status vocabulary', () => {
    expect(FORGE_SCAFFOLD_STATUSES).toContain('draft');
    expect(FORGE_SCAFFOLD_STATUSES).toContain('review_ready');
    expect(FORGE_SCAFFOLD_STATUSES).toContain('approved_for_generation');
    expect(FORGE_SCAFFOLD_STATUSES).toContain('needs_revision');
    expect(FORGE_SCAFFOLD_STATUSES).toContain('held');
    expect(FORGE_SCAFFOLD_STATUSES).toContain('rejected');
    expect(FORGE_SCAFFOLD_STATUSES).toContain('generated_draft_files');
  });
});

function sampleRetrofit(
  overrides: Partial<SaveAgentRetrofitInput> = {},
): SaveAgentRetrofitInput {
  const snapshot = buildSnapshotFromFiles({
    agentSlug: 'reporter',
    relativeFolderPath: 'agents/reporter',
    files: [
      { path: 'agent.yaml', content: 'name: Reporter Agent\ndescription: Drafts status updates.\n' },
      { path: 'CLAUDE.md', content: '# Reporter Agent\n\nDrafts status updates. Uses the Read tool. Stops for owner approval.' },
    ],
  });
  const reconstruction = reconstructAgentProfile(snapshot);
  const gaps = analyzeRetrofitGaps(reconstruction);
  const readiness = assessRetrofitReadiness(gaps);
  const plan = generateRetrofitUpgradePlan({ snapshot, reconstruction, gaps, readiness });
  const reviewPacket = renderRetrofitReviewPacketMarkdown({ snapshot, reconstruction, gaps, readiness, plan });
  return {
    agentSlug: 'reporter',
    relativeFolderPath: 'agents/reporter',
    displayName: reconstruction.profile.displayName,
    readinessScore: readiness.score,
    snapshot,
    reconstructedProfile: reconstruction,
    gapAnalysis: gaps,
    upgradePlan: plan,
    reviewPacket,
    ...overrides,
  };
}

describe('Forge existing-agent retrofits', () => {
  it('saves and reads back a retrofit with parsed JSON', () => {
    const saved = saveAgentRetrofit(sampleRetrofit());
    expect(saved.id).toMatch(/^[0-9a-f]{8}$/);
    expect(saved.status).toBe('inspected');
    expect(saved.ownerDecision).toBe('pending');
    expect(saved.schemaVersion).toBe(FORGE_RETROFIT_SCHEMA_VERSION);
    expect(saved.agentSlug).toBe('reporter');
    expect(Array.isArray(saved.gapAnalysis)).toBe(true);
    expect(saved.gapAnalysis.length).toBeGreaterThan(0);
    expect(saved.reconstructedProfile.profile.displayName).toBe('Reporter Agent');

    const fetched = getAgentRetrofit(saved.id);
    expect(fetched).toBeDefined();
    expect(fetched!.snapshot.agentSlug).toBe('reporter');
    expect(fetched!.upgradePlan.blockedActions.length).toBeGreaterThan(0);
  });

  it('lists retrofits newest-first and filters by status and slug', () => {
    saveAgentRetrofit(sampleRetrofit({ agentSlug: 'a1' }));
    const second = saveAgentRetrofit(sampleRetrofit({ agentSlug: 'a2', status: 'review_ready' }));
    const all = listAgentRetrofits();
    expect(all.length).toBe(2);
    expect(all[0].id).toBe(second.id);
    expect(listAgentRetrofits({ status: 'review_ready' }).length).toBe(1);
    expect(listAgentRetrofits({ agentSlug: 'a1' }).length).toBe(1);
  });

  it('updates status, owner decision, and notes', () => {
    const saved = saveAgentRetrofit(sampleRetrofit());
    const updated = updateAgentRetrofit(saved.id, {
      status: 'approved_for_upgrade',
      ownerDecision: 'approved',
      notes: 'go',
    });
    expect(updated!.status).toBe('approved_for_upgrade');
    expect(updated!.ownerDecision).toBe('approved');
    expect(updated!.notes).toBe('go');
  });

  it('ignores invalid status/decision and returns undefined for unknown id', () => {
    const saved = saveAgentRetrofit(sampleRetrofit());
    const updated = updateAgentRetrofit(saved.id, {
      status: 'nope' as never,
      ownerDecision: 'bogus' as never,
    });
    expect(updated!.status).toBe('inspected');
    expect(updated!.ownerDecision).toBe('pending');
    expect(updateAgentRetrofit('deadbeef', { status: 'held' })).toBeUndefined();
  });

  it('exposes the full retrofit status vocabulary', () => {
    expect(FORGE_RETROFIT_STATUSES).toContain('inspected');
    expect(FORGE_RETROFIT_STATUSES).toContain('review_ready');
    expect(FORGE_RETROFIT_STATUSES).toContain('needs_revision');
    expect(FORGE_RETROFIT_STATUSES).toContain('approved_for_upgrade');
    expect(FORGE_RETROFIT_STATUSES).toContain('held');
    expect(FORGE_RETROFIT_STATUSES).toContain('rejected');
    expect(FORGE_RETROFIT_STATUSES).toContain('upgrade_scaffolded');
  });
});
