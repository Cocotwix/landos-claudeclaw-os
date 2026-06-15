// Forge draft promotion scaffold — pure Forge Core.
//
// Deterministic, dependency-free, host-neutral, industry-neutral, text/JSON
// only. Given a saved department-agent profile, this generates a DRAFT scaffold
// that previews the files and configuration a host would need to turn the
// profile into a real department agent later. It is artifact-first and
// reviewable. It activates nothing, registers nothing, connects nothing,
// authorizes no live action, and writes no files itself: the host adapter
// decides whether to persist or render the draft. Promotion stays an
// owner-owned decision behind a separate approval gate.

import {
  assessPromotionReadiness,
  deriveAuthorityModel,
  slugifyAgentName,
  type DepartmentAgentProfile,
} from './agent-profile.js';

/** One proposed draft file in the scaffold. Content is a preview; nothing is
 *  written to disk by the core. Paths are relative to the proposed folder. */
export interface ScaffoldFile {
  /** Path relative to the proposed agent folder. */
  path: string;
  /** One-line statement of what the file is for. */
  purpose: string;
  /** Draft file content (text/JSON). */
  content: string;
}

/** The complete draft promotion scaffold for one saved profile. */
export interface PromotionScaffold {
  /** Stable lower-kebab slug proposed for the agent folder. */
  proposedSlug: string;
  /** Proposed review folder, inside a Forge-owned draft area. NOT an active
   *  agent directory. */
  proposedFolder: string;
  displayName: string;
  department: string;
  /** Clear statements that this scaffold is not live. */
  notActive: string[];
  /** What a host must do before this could ever become a real agent. */
  activationRequirements: string[];
  /** The owner decisions that gate generation and activation. */
  ownerApprovalGates: string[];
  /** Security gates the owner owns. */
  securityGates: string[];
  /** Cost gates the owner owns. */
  costGates: string[];
  /** Live-action gates the owner owns. */
  liveActionGates: string[];
  /** How a generated draft (or future activation) is undone. */
  rollbackPlan: string[];
  /** How the future agent would be tested. */
  testPlan: string[];
  /** How the future agent would appear on the dashboard. */
  dashboardBehavior: string[];
  /** Memory and storage behavior for the future agent. */
  memoryStorageBehavior: string[];
  /** Tool permission plan for the future agent. */
  toolPermissionPlan: string[];
  /** Handoff behavior for the future agent. */
  handoffBehavior: string[];
  /** The pass/fail acceptance test that would prove the agent works. */
  passFailTest: string[];
  /** The proposed draft files with content previews. */
  files: ScaffoldFile[];
  /** True only when the saved profile is complete AND owner-approved. */
  readyForGeneration: boolean;
  /** Plain-language note on readiness/gating. */
  readinessNote: string;
}

export interface PromotionScaffoldInput {
  profile: DepartmentAgentProfile;
  /** Saved profile status, used to gate generation readiness. */
  profileStatus?: string;
  /** Saved owner decision, used to gate generation readiness. */
  ownerDecision?: string;
}

// The Forge-owned draft review area. This is a draft/preview location, never an
// active agent directory. Neutral, host-agnostic.
const DRAFT_ROOT = 'forge/drafts/promotions';

const NOT_ACTIVE = [
  'Not active: this is a draft scaffold; no agent runs from it.',
  'Not registered: nothing here is added to the host agent registry.',
  'Not authorized for live actions: every live action stays gated in sandbox.',
  'Owner review required before any files are generated or activated.',
  'Separate owner approval is required before real activation.',
];

function mdList(items: string[]): string {
  return items.length ? items.map((i) => `- ${i}`).join('\n') : '- (none)';
}

function mdChecklist(items: string[]): string {
  return items.length ? items.map((i) => `- [ ] ${i}`).join('\n') : '- [ ] (none)';
}

// ── Draft file content builders ──────────────────────────────────────────

function agentDocDraft(p: DepartmentAgentProfile): string {
  return `# ${p.displayName} (DRAFT — not active)

**Agent name:** \`${p.agentName}\`
**Department:** ${p.department}
**Status:** draft scaffold. Not active. Not registered. Not authorized for live actions.

## Primary mission
${p.primaryMission}

## Normal owner input
${mdList(p.normalOwnerInput)}

## Automatic actions (safe lane)
${mdList(p.automaticActions)}

## Hard stops (always need an owner decision)
${mdList(p.hardStops)}

## Activation
This agent stays in sandbox until the owner scopes and authorizes live actions.
${p.liveActionAuthority.untilAuthorized}
`;
}

function dashboardCardDraft(p: DepartmentAgentProfile): string {
  return `# Dashboard card draft — ${p.displayName}

${mdList(p.dashboardBehavior)}
`;
}

function toolPermissionsDraft(p: DepartmentAgentProfile): string {
  return `# Tool permission plan draft — ${p.displayName}

## Allowed tools
${mdList(p.allowedTools)}

## Cost rules
${mdList(p.costRules)}
`;
}

function activationChecklistDraft(p: DepartmentAgentProfile): string {
  return `# Activation checklist draft — ${p.displayName}

This is a draft. The agent is not active and not registered. Complete and
approve every item before any real activation.

- [ ] Owner reviews and approves this scaffold.
- [ ] Owner confirms the profile is complete and correct.
- [ ] Owner scopes the live actions to authorize (if any).
- [ ] Owner supplies any owner-owned setup, kept off shared source control.
- [ ] Pass/fail test runs clean in sandbox with test data.
- [ ] Owner reviews the rollback path for every live-capable action.
- [ ] Owner gives separate, explicit approval to register and activate.
`;
}

function testPlanDraft(p: DepartmentAgentProfile): string {
  return `# Test plan draft — ${p.displayName}

## Verification rules
${mdList(p.verificationRules)}

## Pass / fail acceptance test
${mdList(p.passFailTest)}
`;
}

function handoffDraft(p: DepartmentAgentProfile): string {
  return `# Handoff behavior draft — ${p.displayName}

${mdList(p.handoffRules)}
`;
}

function memoryStorageDraft(p: DepartmentAgentProfile): string {
  return `# Memory and storage draft — ${p.displayName}

## Memory boundaries
${mdList(p.memoryBoundaries)}

## Storage behavior
${mdList(p.storageBehavior)}

## Output format
${mdList(p.outputFormat)}
`;
}

/**
 * Generate the draft promotion scaffold for a saved profile. Pure and
 * deterministic. Produces an artifact set only; it activates nothing and writes
 * no files. Generation readiness is true only when the profile is complete and
 * owner-approved; otherwise the scaffold is still produced as a blocked
 * preview so the owner can review what is missing.
 */
export function generatePromotionScaffold(input: PromotionScaffoldInput): PromotionScaffold {
  const p = input.profile;
  const auth = deriveAuthorityModel(p);
  const readiness = assessPromotionReadiness(p);

  const slug = slugifyAgentName(p.agentName || p.displayName);
  const proposedFolder = `${DRAFT_ROOT}/${slug}`;

  const approved =
    (input.ownerDecision ?? '').trim() === 'approved' ||
    (input.profileStatus ?? '').trim() === 'approved';
  const readyForGeneration = readiness.ready && approved;

  const readinessNote = readyForGeneration
    ? 'Profile is complete and owner-approved. This draft scaffold is ready for the owner to approve generation. Generation and activation remain separate owner-owned gates.'
    : !readiness.ready
      ? `Blocked: profile is not complete (${readiness.readyCount}/${readiness.totalCount} readiness checks pass). This is a preview only. Fill the gaps and reach owner approval before generation.`
      : 'Blocked: profile is complete but not owner-approved. This is a preview only. The owner must approve the profile before generation.';

  const files: ScaffoldFile[] = [
    { path: 'CLAUDE.md', purpose: 'Draft agent operating doc (persona, mission, rules).', content: agentDocDraft(p) },
    { path: 'agent-profile.json', purpose: 'Draft normalized profile as JSON.', content: JSON.stringify(p, null, 2) },
    { path: 'dashboard-card.md', purpose: 'Draft dashboard card behavior.', content: dashboardCardDraft(p) },
    { path: 'tool-permissions.md', purpose: 'Draft tool permission and cost plan.', content: toolPermissionsDraft(p) },
    { path: 'activation-checklist.md', purpose: 'Draft activation checklist and gates.', content: activationChecklistDraft(p) },
    { path: 'test-plan.md', purpose: 'Draft verification and pass/fail test.', content: testPlanDraft(p) },
    { path: 'handoff.md', purpose: 'Draft handoff behavior.', content: handoffDraft(p) },
    { path: 'memory-storage.md', purpose: 'Draft memory, storage, and output rules.', content: memoryStorageDraft(p) },
  ];

  return {
    proposedSlug: slug,
    proposedFolder,
    displayName: p.displayName,
    department: p.department,
    notActive: [...NOT_ACTIVE],
    activationRequirements: [
      'Owner approves this draft scaffold for generation.',
      'Owner gives separate, explicit approval to register and activate the agent.',
      'Live actions are scoped and authorized by the owner before any live mode.',
      'Owner-owned setup (accounts, config, keys) is supplied by the owner, off shared source control.',
      'Pass/fail acceptance test runs clean in sandbox before activation.',
    ],
    ownerApprovalGates: [
      'Generation gate: the owner must approve before any draft files are generated.',
      'Activation gate: a separate owner approval is required before registration/activation.',
      'Decision loop: approve / tweak / reject / hold applies at each gate.',
    ],
    securityGates: [
      'No secrets, credentials, or tokens are read, printed, or stored.',
      'No destructive actions; nothing is deleted or overwritten without an owner decision.',
      'Release actions (push, deploy, publish) stay outside the safe lane until the owner authorizes them.',
    ],
    costGates: [...p.costRules],
    liveActionGates: [
      `Live actions authorized: ${auth.authorized ? 'yes' : 'no'}.`,
      `Approved live actions: ${auth.approvedLiveActions.length ? auth.approvedLiveActions.join('; ') : 'none'}.`,
      'Every hard stop still needs an owner decision even after live actions are authorized.',
    ],
    rollbackPlan: [
      'This draft writes no active files; discarding the scaffold removes it entirely.',
      'If draft files are later generated to the Forge draft area, deleting that folder is the rollback.',
      ...p.rollbackExpectations,
    ],
    testPlan: [...p.verificationRules, ...p.passFailTest],
    dashboardBehavior: [...p.dashboardBehavior],
    memoryStorageBehavior: [...p.memoryBoundaries, ...p.storageBehavior],
    toolPermissionPlan: [...p.allowedTools],
    handoffBehavior: [...p.handoffRules],
    passFailTest: [...p.passFailTest],
    files,
    readyForGeneration,
    readinessNote,
  };
}

/** Render the full scaffold as a copy-ready Markdown review packet. */
export function renderPromotionScaffoldMarkdown(scaffold: PromotionScaffold): string {
  const s = scaffold;
  const fileSections = s.files
    .map(
      (f) =>
        `### \`${f.path}\`\n${f.purpose}\n\n\`\`\`\n${f.content.trim()}\n\`\`\``,
    )
    .join('\n\n');

  return `# Draft Promotion Scaffold — ${s.displayName}

**Proposed slug:** \`${s.proposedSlug}\`
**Proposed review folder:** \`${s.proposedFolder}\`
**Department:** ${s.department}
**Ready for generation:** ${s.readyForGeneration ? 'yes' : 'no'}

> ${s.notActive.join('\n> ')}

${s.readinessNote}

## Activation requirements
${mdChecklist(s.activationRequirements)}

## Owner approval gates
${mdList(s.ownerApprovalGates)}

## Security gates
${mdList(s.securityGates)}

## Cost gates
${mdList(s.costGates)}

## Live-action gates
${mdList(s.liveActionGates)}

## Rollback plan
${mdList(s.rollbackPlan)}

## Test plan
${mdList(s.testPlan)}

## Dashboard behavior
${mdList(s.dashboardBehavior)}

## Memory / storage behavior
${mdList(s.memoryStorageBehavior)}

## Tool permission plan
${mdList(s.toolPermissionPlan)}

## Handoff behavior
${mdList(s.handoffBehavior)}

## Pass / fail acceptance test
${mdList(s.passFailTest)}

## Proposed draft files
${s.files.map((f) => `- \`${s.proposedFolder}/${f.path}\` — ${f.purpose}`).join('\n')}

${fileSections}

---

This scaffold is a draft preview. It is not active, not registered, and not
authorized for live actions. Generation and activation are separate owner-owned
gates. Forge will not register, activate, push, deploy, connect accounts, send
communications, or read secrets on the agent's behalf.
`;
}
