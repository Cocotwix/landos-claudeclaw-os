// Tests for the Forge existing-agent retrofit core.
//
// Focus: snapshot extraction from supplied file text, best-effort profile
// reconstruction, gap analysis with severity, readiness scoring, the safe
// upgrade plan, the draft scaffold, and neutrality of the review packet. All
// pure: no filesystem.

import { describe, it, expect } from 'vitest';

import {
  buildSnapshotFromFiles,
  reconstructAgentProfile,
  analyzeRetrofitGaps,
  assessRetrofitReadiness,
  generateRetrofitUpgradePlan,
  generateRetrofitScaffold,
  renderRetrofitReviewPacketMarkdown,
  type ExistingAgentFile,
} from './agent-retrofit.js';
import { scanForNeutralityIssues } from './neutrality.js';

// A small but realistic existing-agent file set (universal wording).
const richFiles: ExistingAgentFile[] = [
  {
    path: 'agent.yaml',
    content: 'name: Reporter Agent\ndescription: Drafts and organizes status updates.\nmodel: claude-sonnet-4-6\n',
  },
  {
    path: 'CLAUDE.md',
    content: [
      '# Reporter Agent',
      '',
      'Drafts and organizes status updates for the owner.',
      '',
      'It appears on the dashboard with its status.',
      'It may use the Read and Write tools only.',
      'It remembers only what the task needs.',
      'It returns plain readable output.',
      'It verifies its work with a self-check before reporting done.',
      'It hands off to another agent through a logged task.',
      'It always stops for owner approval before any release.',
    ].join('\n'),
  },
];

function pipeline(files: ExistingAgentFile[], slug = 'reporter') {
  const snapshot = buildSnapshotFromFiles({ agentSlug: slug, relativeFolderPath: `landos-agents/${slug}`, files });
  const reconstruction = reconstructAgentProfile(snapshot);
  const gaps = analyzeRetrofitGaps(reconstruction);
  const readiness = assessRetrofitReadiness(gaps);
  const plan = generateRetrofitUpgradePlan({ snapshot, reconstruction, gaps, readiness });
  return { snapshot, reconstruction, gaps, readiness, plan };
}

describe('buildSnapshotFromFiles', () => {
  it('extracts primary text, config data, and hints', () => {
    const { snapshot } = pipeline(richFiles);
    expect(snapshot.detectedFiles).toEqual(['agent.yaml', 'CLAUDE.md']);
    expect(snapshot.primaryInstructionText).toContain('Reporter Agent');
    expect(snapshot.profileLikeData?.name).toBe('Reporter Agent');
    expect(snapshot.profileLikeData?.description).toBe('Drafts and organizes status updates.');
    expect(snapshot.dashboardHints.length).toBeGreaterThan(0);
    expect(snapshot.toolPermissionHints.length).toBeGreaterThan(0);
    expect(snapshot.handoffHints.length).toBeGreaterThan(0);
  });

  it('flags risks and missing signals for a thin agent', () => {
    const snap = buildSnapshotFromFiles({
      agentSlug: 'thin',
      relativeFolderPath: 'landos-agents/thin',
      files: [{ path: 'notes.txt', content: 'just some text' }],
    });
    expect(snap.primaryInstructionText).toBeUndefined();
    expect(snap.riskFlags.join(' ')).toContain('No primary instruction file');
    expect(snap.missingSignals).toContain('dashboard behavior');
  });

  it('does not store secret values; flags secret references', () => {
    const snap = buildSnapshotFromFiles({
      agentSlug: 'x',
      relativeFolderPath: 'landos-agents/x',
      files: [{ path: 'CLAUDE.md', content: 'Never read the .env or any api key.' }],
    });
    expect(snap.riskFlags.join(' ')).toContain('secrets');
  });
});

describe('reconstructAgentProfile', () => {
  it('infers identity, mission, and hint-backed fields', () => {
    const { reconstruction } = pipeline(richFiles);
    expect(reconstruction.profile.displayName).toBe('Reporter Agent');
    expect(reconstruction.profile.primaryMission).toContain('status updates');
    expect(reconstruction.inferredFields).toEqual(
      expect.arrayContaining(['displayName', 'primaryMission', 'dashboardBehavior', 'allowedTools']),
    );
  });
});

describe('analyzeRetrofitGaps + readiness', () => {
  it('marks inferred fields present and uninferred fields as gaps', () => {
    const { gaps } = pipeline(richFiles);
    const byField = Object.fromEntries(gaps.map((g) => [g.field, g]));
    expect(byField['display name'].present).toBe(true);
    expect(byField['primary mission'].present).toBe(true);
    // Hard stops were never inferred from the files, so they remain a gap.
    expect(byField['hard stops'].present).toBe(false);
    expect(byField['hard stops'].severity).toBe('high');
  });

  it('scores a thin agent low with critical/high gaps', () => {
    const { readiness } = pipeline([{ path: 'CLAUDE.md', content: 'hello' }], 'thin');
    expect(readiness.score).toBeLessThan(50);
    expect(readiness.ready).toBe(false);
    expect(readiness.missingBySeverity.critical).toBeGreaterThan(0);
  });

  it('scores a rich agent higher than a thin one', () => {
    const rich = pipeline(richFiles).readiness.score;
    const thin = pipeline([{ path: 'CLAUDE.md', content: 'hello' }], 'thin').readiness.score;
    expect(rich).toBeGreaterThan(thin);
  });
});

describe('generateRetrofitUpgradePlan', () => {
  it('lists strengths, missing required fields, blocked actions, and a next step', () => {
    const { plan } = pipeline(richFiles);
    expect(plan.currentStrengths.length).toBeGreaterThan(0);
    expect(plan.blockedActions.join(' ')).toContain('Writing into the existing agent folder');
    expect(plan.recommendedProfilePatches.length).toBeGreaterThan(0);
    expect(plan.nextSafeStep.length).toBeGreaterThan(0);
  });
});

describe('generateRetrofitScaffold', () => {
  it('is a draft preview that modifies nothing', () => {
    const { snapshot, reconstruction, gaps } = pipeline(richFiles);
    const scaffold = generateRetrofitScaffold({ snapshot, reconstruction, gaps });
    expect(scaffold.notActive.join(' ')).toContain('Does not modify the existing agent');
    expect(scaffold.proposedProfileJson).toContain('"agentName"');
    expect(scaffold.proposedFiles.length).toBeGreaterThan(0);
  });
});

describe('renderRetrofitReviewPacketMarkdown', () => {
  it('renders the full packet with gap table and not-active banner', () => {
    const { snapshot, reconstruction, gaps, readiness, plan } = pipeline(richFiles);
    const md = renderRetrofitReviewPacketMarkdown({ snapshot, reconstruction, gaps, readiness, plan });
    expect(md).toContain('# Existing Agent Retrofit');
    expect(md).toContain('## Gap analysis');
    expect(md).toContain('Does not modify the existing agent');
    expect(md).toContain('## Upgrade plan');
  });

  it('stays universal and industry-neutral', () => {
    // Use a neutral folder path so the packet contains no named entities.
    const snapshot = buildSnapshotFromFiles({
      agentSlug: 'reporter',
      relativeFolderPath: 'agents/reporter',
      files: richFiles,
    });
    const reconstruction = reconstructAgentProfile(snapshot);
    const gaps = analyzeRetrofitGaps(reconstruction);
    const readiness = assessRetrofitReadiness(gaps);
    const plan = generateRetrofitUpgradePlan({ snapshot, reconstruction, gaps, readiness });
    const md = renderRetrofitReviewPacketMarkdown({ snapshot, reconstruction, gaps, readiness, plan });
    expect(scanForNeutralityIssues(md)).toEqual([]);
  });
});
