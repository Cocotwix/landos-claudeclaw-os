// Tests for the Forge owner-gated writeback proposal core.
//
// Focus: target planning, create/update/skip actions from host metadata, diff
// previews, the backup/rollback/validation plans, the not-applied state, and
// neutrality. All pure: no filesystem.

import { describe, it, expect } from 'vitest';

import {
  planWritebackTargets,
  buildTargetProposals,
  generateWritebackProposal,
  renderWritebackProposalMarkdown,
  type TargetFileMeta,
} from './writeback-proposal.js';
import {
  buildSnapshotFromFiles,
  reconstructAgentProfile,
  analyzeRetrofitGaps,
  type ExistingAgentFile,
} from './agent-retrofit.js';
import { scanForNeutralityIssues } from './neutrality.js';

const files: ExistingAgentFile[] = [
  { path: 'agent.yaml', content: 'name: Reporter Agent\ndescription: Drafts status updates.\n' },
  { path: 'CLAUDE.md', content: '# Reporter Agent\n\nDrafts status updates. Uses the Read tool. Stops for owner approval.' },
];

function retrofit(slug = 'reporter', folder = 'agents/reporter') {
  const snapshot = buildSnapshotFromFiles({ agentSlug: slug, relativeFolderPath: folder, files });
  const reconstruction = reconstructAgentProfile(snapshot);
  const gaps = analyzeRetrofitGaps(reconstruction);
  return { snapshot, reconstruction, gaps };
}

describe('planWritebackTargets', () => {
  it('proposes agent-profile.json and a gaps note when gaps exist', () => {
    const { reconstruction, gaps } = retrofit();
    const targets = planWritebackTargets({ reconstruction, gaps });
    const paths = targets.map((t) => t.relativeTargetPath);
    expect(paths).toContain('agent-profile.json');
    expect(paths).toContain('forge-profile-notes.md');
    expect(targets[0].proposedContent).toContain('"agentName"');
  });
});

describe('buildTargetProposals', () => {
  it('marks create / update / skip from host metadata', () => {
    const { reconstruction, gaps } = retrofit();
    const targets = planWritebackTargets({ reconstruction, gaps });
    const metas: TargetFileMeta[] = [
      { relativeTargetPath: 'agent-profile.json', exists: false, safeToWriteLater: true },
      {
        relativeTargetPath: 'forge-profile-notes.md',
        exists: true,
        currentText: '# old notes\n\nstale content\n',
        safeToWriteLater: true,
      },
    ];
    const proposals = buildTargetProposals(targets, metas);
    const byPath = Object.fromEntries(proposals.map((p) => [p.relativeTargetPath, p]));
    expect(byPath['agent-profile.json'].action).toBe('create');
    expect(byPath['forge-profile-notes.md'].action).toBe('update');
  });

  it('marks skip when a path is not safe to write', () => {
    const targets = planWritebackTargets(retrofit());
    const metas: TargetFileMeta[] = targets.map((t) => ({
      relativeTargetPath: t.relativeTargetPath,
      exists: false,
      safeToWriteLater: false,
      riskFlags: ['Not an allowlisted file.'],
    }));
    const proposals = buildTargetProposals(targets, metas);
    expect(proposals.every((p) => p.action === 'skip')).toBe(true);
    expect(proposals[0].diffPreview).toContain('skipped');
  });

  it('produces a create diff of all added lines', () => {
    const { reconstruction, gaps } = retrofit();
    const targets = planWritebackTargets({ reconstruction, gaps });
    const proposals = buildTargetProposals(targets, [
      { relativeTargetPath: 'agent-profile.json', exists: false, safeToWriteLater: true },
    ]);
    expect(proposals[0].diffPreview.startsWith('+ ')).toBe(true);
  });
});

describe('generateWritebackProposal', () => {
  it('carries plans, gates, blocked actions, and a not-applied banner', () => {
    const { snapshot, reconstruction, gaps } = retrofit();
    const metas: TargetFileMeta[] = [
      { relativeTargetPath: 'agent-profile.json', exists: false, safeToWriteLater: true },
      { relativeTargetPath: 'forge-profile-notes.md', exists: false, safeToWriteLater: true },
    ];
    const proposal = generateWritebackProposal({
      agentSlug: snapshot.agentSlug,
      relativeFolderPath: snapshot.relativeFolderPath,
      reconstruction,
      gaps,
      metas,
    });
    expect(proposal.notApplied.join(' ')).toContain('Not applied');
    expect(proposal.backupPlan.length).toBeGreaterThan(0);
    expect(proposal.rollbackPlan.length).toBeGreaterThan(0);
    expect(proposal.validationPlan.length).toBeGreaterThan(0);
    expect(proposal.ownerApprovalGate.length).toBeGreaterThan(0);
    expect(proposal.codexQaGate.length).toBeGreaterThan(0);
    const blocked = proposal.blockedActions.join(' ');
    expect(blocked).toContain('Applying the proposal');
    // Wording must reflect that the apply route is blocked / 501, not absent.
    expect(blocked).toContain('501');
    expect(blocked.toLowerCase()).toContain('not implemented');
    expect(blocked).not.toContain('no apply endpoint exists');
    expect(proposal.targetFiles.length).toBe(2);
  });

  it('is deterministic for the same input', () => {
    const { snapshot, reconstruction, gaps } = retrofit();
    const metas: TargetFileMeta[] = [
      { relativeTargetPath: 'agent-profile.json', exists: false, safeToWriteLater: true },
    ];
    const a = renderWritebackProposalMarkdown(
      generateWritebackProposal({ agentSlug: snapshot.agentSlug, relativeFolderPath: snapshot.relativeFolderPath, reconstruction, gaps, metas, proposedTargets: [{ relativeTargetPath: 'agent-profile.json', proposedContent: 'x', reason: 'r' }] }),
    );
    const b = renderWritebackProposalMarkdown(
      generateWritebackProposal({ agentSlug: snapshot.agentSlug, relativeFolderPath: snapshot.relativeFolderPath, reconstruction, gaps, metas, proposedTargets: [{ relativeTargetPath: 'agent-profile.json', proposedContent: 'x', reason: 'r' }] }),
    );
    expect(a).toBe(b);
  });
});

describe('renderWritebackProposalMarkdown', () => {
  it('renders the packet with a target table, diffs, and not-applied note', () => {
    const { snapshot, reconstruction, gaps } = retrofit();
    const metas: TargetFileMeta[] = [
      { relativeTargetPath: 'agent-profile.json', exists: false, safeToWriteLater: true },
      { relativeTargetPath: 'forge-profile-notes.md', exists: false, safeToWriteLater: true },
    ];
    const md = renderWritebackProposalMarkdown(
      generateWritebackProposal({ agentSlug: snapshot.agentSlug, relativeFolderPath: snapshot.relativeFolderPath, reconstruction, gaps, metas }),
    );
    expect(md).toContain('# Writeback Proposal');
    expect(md).toContain('## Target files');
    expect(md).toContain('## Backup plan');
    expect(md).toContain('## Rollback plan');
    expect(md).toContain('Not applied');
  });

  it('stays universal and industry-neutral', () => {
    const { snapshot, reconstruction, gaps } = retrofit();
    const metas: TargetFileMeta[] = [
      { relativeTargetPath: 'agent-profile.json', exists: false, safeToWriteLater: true },
    ];
    // Use neutral proposed content so the packet carries no named entities.
    const md = renderWritebackProposalMarkdown(
      generateWritebackProposal({
        agentSlug: snapshot.agentSlug,
        relativeFolderPath: snapshot.relativeFolderPath,
        reconstruction,
        gaps,
        metas,
        proposedTargets: [
          { relativeTargetPath: 'agent-profile.json', proposedContent: 'a complete profile', reason: 'add a complete profile' },
        ],
      }),
    );
    expect(scanForNeutralityIssues(md)).toEqual([]);
  });
});
