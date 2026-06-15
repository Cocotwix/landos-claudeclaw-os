// Tests for the Forge draft promotion scaffold generator.
//
// Focus: prove the scaffold is artifact-first and reviewable, carries every
// required section and proposed file, gates generation behind completeness +
// owner approval, never claims to be active, and stays universal/neutral.

import { describe, it, expect } from 'vitest';

import {
  generatePromotionScaffold,
  renderPromotionScaffoldMarkdown,
  type PromotionScaffoldInput,
} from './promotion-scaffold.js';
import { buildAgentProfile, type AgentProfileDraft } from './agent-profile.js';
import { scanForNeutralityIssues } from './neutrality.js';

// A fully-specified draft so readiness can reach "ready".
const completeDraft = (over: Partial<AgentProfileDraft> = {}): AgentProfileDraft => ({
  rawRequest: 'an agent that drafts and organizes status updates',
  displayName: 'Reporter',
  department: 'Reporting',
  primaryMission: 'Draft and organize status updates for the owner.',
  normalOwnerInput: ['Draft a weekly status update.'],
  automaticActions: ['Assemble a draft from provided notes.'],
  allowedTools: ['Read', 'Write'],
  passFailTest: ['Given notes, it returns a complete draft for owner review.'],
  createdAt: '2026-06-15T00:00:00.000Z',
  ...over,
});

function scaffoldOf(over: Partial<PromotionScaffoldInput> = {}) {
  return generatePromotionScaffold({
    profile: buildAgentProfile(completeDraft()),
    ...over,
  });
}

describe('generatePromotionScaffold', () => {
  it('proposes a slug, a draft review folder, and the standard files', () => {
    const s = scaffoldOf();
    expect(s.proposedSlug).toBe('reporter');
    expect(s.proposedFolder).toBe('forge/drafts/promotions/reporter');
    const paths = s.files.map((f) => f.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'CLAUDE.md',
        'agent-profile.json',
        'dashboard-card.md',
        'tool-permissions.md',
        'activation-checklist.md',
        'test-plan.md',
        'handoff.md',
      ]),
    );
    expect(s.files.every((f) => f.content.length > 0)).toBe(true);
  });

  it('carries every required scaffold section', () => {
    const s = scaffoldOf();
    expect(s.activationRequirements.length).toBeGreaterThan(0);
    expect(s.ownerApprovalGates.length).toBeGreaterThan(0);
    expect(s.securityGates.length).toBeGreaterThan(0);
    expect(s.costGates.length).toBeGreaterThan(0);
    expect(s.liveActionGates.length).toBeGreaterThan(0);
    expect(s.rollbackPlan.length).toBeGreaterThan(0);
    expect(s.testPlan.length).toBeGreaterThan(0);
    expect(s.dashboardBehavior.length).toBeGreaterThan(0);
    expect(s.memoryStorageBehavior.length).toBeGreaterThan(0);
    expect(s.toolPermissionPlan.length).toBeGreaterThan(0);
    expect(s.handoffBehavior.length).toBeGreaterThan(0);
    expect(s.passFailTest.length).toBeGreaterThan(0);
  });

  it('always states it is not active / not registered', () => {
    const s = scaffoldOf();
    const blob = s.notActive.join(' ');
    expect(blob).toContain('Not active');
    expect(blob).toContain('Not registered');
    expect(blob).toContain('Not authorized for live actions');
  });

  it('marks generation ready only when complete AND owner-approved', () => {
    expect(scaffoldOf().readyForGeneration).toBe(false); // pending decision
    expect(scaffoldOf({ ownerDecision: 'approved' }).readyForGeneration).toBe(true);
    expect(scaffoldOf({ profileStatus: 'approved' }).readyForGeneration).toBe(true);
  });

  it('blocks generation for an incomplete profile even if approved', () => {
    const s = generatePromotionScaffold({
      profile: buildAgentProfile({ rawRequest: 'an agent', createdAt: 'x' }),
      ownerDecision: 'approved',
    });
    expect(s.readyForGeneration).toBe(false);
    expect(s.readinessNote).toContain('Blocked');
  });

  it('is deterministic for the same input', () => {
    const a = renderPromotionScaffoldMarkdown(scaffoldOf());
    const b = renderPromotionScaffoldMarkdown(scaffoldOf());
    expect(a).toBe(b);
  });
});

describe('renderPromotionScaffoldMarkdown', () => {
  it('renders a copy-ready packet with the not-active banner and files', () => {
    const md = renderPromotionScaffoldMarkdown(scaffoldOf());
    expect(md).toContain('# Draft Promotion Scaffold — Reporter');
    expect(md).toContain('**Proposed slug:** `reporter`');
    expect(md).toContain('Not active');
    expect(md).toContain('## Activation requirements');
    expect(md).toContain('## Proposed draft files');
    expect(md).toContain('`forge/drafts/promotions/reporter/CLAUDE.md`');
  });

  it('stays universal and industry-neutral', () => {
    expect(scanForNeutralityIssues(renderPromotionScaffoldMarkdown(scaffoldOf()))).toEqual([]);
  });
});
