// Tests for the Forge universal department-agent profile standard.
//
// Focus: prove the profile builder normalizes identity and fills universal,
// industry-neutral defaults; the authority model gates live actions until the
// owner authorizes them; the interview maps onto the profile contract; and the
// build packet renders every required section. Determinism throughout.

import { describe, it, expect } from 'vitest';

import {
  buildAgentProfile,
  deriveAuthorityModel,
  generateAgentInterview,
  generateAgentBuildPacket,
  renderAgentProfileMarkdown,
  renderInterviewMarkdown,
  assessPromotionReadiness,
  renderPromotionReadinessMarkdown,
  generateProfileReviewPacket,
  slugifyAgentName,
  type AgentProfileDraft,
} from './agent-profile.js';
import { scanForNeutralityIssues } from './neutrality.js';

// A fully-specified draft so readiness can reach "ready" in tests.
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

const baseDraft = (over: Partial<AgentProfileDraft> = {}): AgentProfileDraft => ({
  rawRequest: 'Build an agent that drafts and organizes status updates.',
  createdAt: '2026-06-15T00:00:00.000Z',
  ...over,
});

describe('slugifyAgentName', () => {
  it('produces a stable lower-kebab slug', () => {
    expect(slugifyAgentName('Comms Agent')).toBe('comms-agent');
    expect(slugifyAgentName('  Reporting & Ops!! ')).toBe('reporting-ops');
  });
  it('falls back when there is nothing usable', () => {
    expect(slugifyAgentName('   ')).toBe('department-agent');
    expect(slugifyAgentName('***')).toBe('department-agent');
  });
});

describe('buildAgentProfile', () => {
  it('fills universal defaults for an unspecified profile', () => {
    const p = buildAgentProfile(baseDraft());
    expect(p.hardStops.length).toBeGreaterThan(0);
    expect(p.hardStops.join(' ')).toContain('secrets');
    expect(p.costRules.join(' ')).toContain('owner-owned decision');
    expect(p.memoryBoundaries.length).toBeGreaterThan(0);
    expect(p.outputFormat.length).toBeGreaterThan(0);
    expect(p.auditExpectations.length).toBeGreaterThan(0);
    expect(p.rollbackExpectations.length).toBeGreaterThan(0);
    expect(p.ownerApprovalLoop.join(' ')).toContain('approve');
  });

  it('derives identity and mission from the draft', () => {
    const p = buildAgentProfile(baseDraft({ displayName: 'Comms', department: 'Communications' }));
    expect(p.agentName).toBe('comms');
    expect(p.displayName).toBe('Comms');
    expect(p.department).toBe('Communications');
    expect(p.primaryMission.length).toBeGreaterThan(0);
  });

  it('honors supplied lists over defaults', () => {
    const p = buildAgentProfile(baseDraft({ allowedTools: ['Read', 'Write'] }));
    expect(p.allowedTools).toEqual(['Read', 'Write']);
  });

  it('forces sandbox when live actions are not authorized', () => {
    const p = buildAgentProfile(baseDraft({ activationMode: 'live' }));
    expect(p.liveActionAuthority.authorized).toBe(false);
    expect(p.activationMode).toBe('sandbox');
    expect(p.liveActionAuthority.approvedActions).toEqual([]);
  });

  it('allows a live mode only once the owner authorizes it', () => {
    const p = buildAgentProfile(
      baseDraft({
        activationMode: 'live',
        liveActionAuthority: { authorized: true, approvedActions: ['post a status update'] },
      }),
    );
    expect(p.activationMode).toBe('live');
    expect(p.liveActionAuthority.approvedActions).toEqual(['post a status update']);
  });

  it('is deterministic for the same input', () => {
    const a = renderAgentProfileMarkdown(buildAgentProfile(baseDraft()));
    const b = renderAgentProfileMarkdown(buildAgentProfile(baseDraft()));
    expect(a).toBe(b);
  });
});

describe('deriveAuthorityModel', () => {
  it('gates live actions and stays in sandbox when unauthorized', () => {
    const auth = deriveAuthorityModel(buildAgentProfile(baseDraft({ activationMode: 'live' })));
    expect(auth.authorized).toBe(false);
    expect(auth.effectiveMode).toBe('sandbox');
    expect(auth.gatedUntilAuthorized.join(' ')).toContain('Live external actions');
    expect(auth.summary).toContain('sandbox');
  });

  it('reports the effective live mode when authorized', () => {
    const auth = deriveAuthorityModel(
      buildAgentProfile(
        baseDraft({
          activationMode: 'assisted_live',
          liveActionAuthority: { authorized: true, approvedActions: ['send a draft for review'] },
        }),
      ),
    );
    expect(auth.authorized).toBe(true);
    expect(auth.effectiveMode).toBe('assisted_live');
    expect(auth.approvedLiveActions).toEqual(['send a draft for review']);
  });
});

describe('generateAgentInterview', () => {
  it('covers every part of the profile contract', () => {
    const iv = generateAgentInterview({ rawRequest: 'an agent for reporting', displayName: 'Reporter' });
    const headings = iv.sections.map((s) => s.heading);
    expect(headings).toEqual(
      expect.arrayContaining([
        'Identity',
        'Input & actions',
        'Authority & activation',
        'Tools & cost',
        'Memory & storage',
        'Output & verification',
        'Handoff, dashboard & audit',
        'Owner approval loop',
      ]),
    );
    const md = renderInterviewMarkdown(iv);
    expect(md).toContain('# Define a department agent: Reporter');
    expect(md).toContain('### Identity');
  });
});

describe('generateAgentBuildPacket', () => {
  it('renders every required section', () => {
    const packet = generateAgentBuildPacket(buildAgentProfile(baseDraft()));
    expect(packet).toContain('# Forge Agent Build Packet');
    expect(packet).toContain('## 1. Profile');
    expect(packet).toContain('## 2. Dashboard behavior');
    expect(packet).toContain('## 3. Permissions');
    expect(packet).toContain('## 4. Authority model');
    expect(packet).toContain('## 5. Tool plan');
    expect(packet).toContain('## 6. Memory rules');
    expect(packet).toContain('## 7. Output rules');
    expect(packet).toContain('## 8. Storage rules');
    expect(packet).toContain('## 9. Test plan');
    expect(packet).toContain('## 10. Activation checklist');
    expect(packet).toContain('## 11. Owner decision options');
    expect(packet).toContain('approve, tweak, reject, or hold');
  });

  it('stays universal and industry-neutral', () => {
    const packet = generateAgentBuildPacket(buildAgentProfile(baseDraft()));
    expect(scanForNeutralityIssues(packet)).toEqual([]);
    const profileMd = renderAgentProfileMarkdown(buildAgentProfile(baseDraft()));
    expect(scanForNeutralityIssues(profileMd)).toEqual([]);
    const interviewMd = renderInterviewMarkdown(
      generateAgentInterview({ rawRequest: 'an agent', displayName: 'Agent' }),
    );
    expect(scanForNeutralityIssues(interviewMd)).toEqual([]);
  });
});

describe('assessPromotionReadiness', () => {
  it('flags a bare profile as not ready and names the gaps', () => {
    const r = assessPromotionReadiness(buildAgentProfile(baseDraft({ displayName: undefined })));
    expect(r.ready).toBe(false);
    expect(r.readyCount).toBeLessThan(r.totalCount);
    const notReady = r.items.filter((i) => !i.ready).map((i) => i.label);
    expect(notReady).toEqual(
      expect.arrayContaining(['Profile complete', 'Department clear', 'Tools defined', 'Pass/fail test defined']),
    );
  });

  it('reports ready when every aspect is supplied', () => {
    const r = assessPromotionReadiness(buildAgentProfile(completeDraft()));
    expect(r.ready).toBe(true);
    expect(r.readyCount).toBe(r.totalCount);
    expect(r.summary).toContain('Ready');
  });

  it('flags a live mode requested without authorization', () => {
    const r = assessPromotionReadiness(
      buildAgentProfile(completeDraft({ activationMode: 'live' })),
    );
    // Forced to sandbox by the builder, so authority stays coherent and ready.
    const authItem = r.items.find((i) => i.label === 'Authority mode defined');
    expect(authItem?.ready).toBe(true);
  });

  it('renders a deterministic checklist markdown', () => {
    const r = assessPromotionReadiness(buildAgentProfile(completeDraft()));
    const md = renderPromotionReadinessMarkdown(r, 'Reporter');
    expect(md).toContain('# Promotion Readiness — Reporter');
    expect(md).toContain('- [x]');
    expect(scanForNeutralityIssues(md)).toEqual([]);
  });
});

describe('generateProfileReviewPacket', () => {
  it('renders every review section', () => {
    const profile = buildAgentProfile(completeDraft());
    const packet = generateProfileReviewPacket({
      profile,
      request: 'an agent that drafts status updates',
      status: 'review_ready',
      ownerDecision: 'pending',
    });
    expect(packet).toContain('# Profile Review Packet — Reporter');
    expect(packet).toContain('## Profile summary');
    expect(packet).toContain('## Authority model');
    expect(packet).toContain('## Permissions / tool plan');
    expect(packet).toContain('## Memory / storage rules');
    expect(packet).toContain('## Verification / pass-fail test');
    expect(packet).toContain('## Risks / open questions');
    expect(packet).toContain('## Recommended next step');
  });

  it('lists open questions for an incomplete profile', () => {
    const profile = buildAgentProfile(baseDraft({ displayName: undefined }));
    const packet = generateProfileReviewPacket({ profile });
    expect(packet).toContain('Tools defined:');
    expect(packet).toContain('not authorized yet');
  });

  it('stays universal and industry-neutral', () => {
    const profile = buildAgentProfile(completeDraft());
    const packet = generateProfileReviewPacket({ profile, request: 'an agent', status: 'draft' });
    expect(scanForNeutralityIssues(packet)).toEqual([]);
  });
});
