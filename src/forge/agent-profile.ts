// Forge universal department-agent profile standard — pure Forge Core.
//
// Deterministic, dependency-free, host-neutral, industry-neutral. Everything
// here is text/JSON generation: it interviews the owner about a department
// agent, builds a normalized agent profile, derives the agent's authority
// model, and renders an owner-reviewable build packet. It NEVER executes,
// connects, deploys, subscribes, pushes, reads env, or touches secrets. It
// describes an agent; it does not run one.
//
// Core concept: Forge builds department agents. A department agent belongs to a
// host operating system. Each agent needs a profile before it becomes active.
// A profile is the operating contract for that agent: its mission, the input
// it takes, the actions it may perform automatically, the actions that need
// owner authority, its tools, its memory and storage boundaries, how it is
// verified, how it hands off, how it shows up on the dashboard, how it is
// activated, audited, and rolled back, and how the owner approves its work.
//
// The profile stays universal. It carries positive, industry-neutral defaults
// that apply to a department agent in any business operating system. Concrete,
// business-specific detail is supplied by the operator through the interview;
// it is never baked into the core.

/** How live a department agent is allowed to run. */
export type ActivationMode = 'sandbox' | 'assisted_live' | 'live';

export const ACTIVATION_MODES: readonly ActivationMode[] = [
  'sandbox',
  'assisted_live',
  'live',
];

/** Whether the owner has explicitly scoped and authorized live external
 *  actions for this agent. Until authorized, the agent stays in sandbox and
 *  every live action is gated. */
export interface LiveActionAuthority {
  /** True only when the owner explicitly scoped & approved live actions. */
  authorized: boolean;
  /** The concrete live actions the owner approved. Empty until authorized. */
  approvedActions: string[];
  /** What the agent does while live actions remain unauthorized. */
  untilAuthorized: string;
}

/** The universal department-agent profile: the operating contract for one
 *  agent inside a host operating system. */
export interface DepartmentAgentProfile {
  /** Stable slug identity, lower-kebab. */
  agentName: string;
  /** Human-facing name shown on the dashboard. */
  displayName: string;
  /** The department this agent owns. */
  department: string;
  /** One-line statement of what the agent is for. */
  primaryMission: string;
  /** The everyday requests the owner gives this agent. */
  normalOwnerInput: string[];
  /** What the agent may do automatically inside the safe lane. */
  automaticActions: string[];
  /** The agent's live-action authority (owner-scoped). */
  liveActionAuthority: LiveActionAuthority;
  /** Actions the agent never takes without an explicit owner decision. */
  hardStops: string[];
  /** The exact tools the agent may use. */
  allowedTools: string[];
  /** How the agent treats cost and paid capability. */
  costRules: string[];
  /** What the agent may remember and what it must not. */
  memoryBoundaries: string[];
  /** How the agent formats what it returns. */
  outputFormat: string[];
  /** Where and how the agent is allowed to write. */
  storageBehavior: string[];
  /** How the agent proves its own work before reporting done. */
  verificationRules: string[];
  /** How the agent passes work to another department agent. */
  handoffRules: string[];
  /** How the agent appears and behaves on the host dashboard. */
  dashboardBehavior: string[];
  /** The mode the agent is requested to run in. */
  activationMode: ActivationMode;
  /** What the agent records for audit. */
  auditExpectations: string[];
  /** How the agent's actions can be undone. */
  rollbackExpectations: string[];
  /** The concrete pass/fail check that proves the agent works. */
  passFailTest: string[];
  /** How the owner approves, tweaks, rejects, or holds the agent's work. */
  ownerApprovalLoop: string[];
  /** The host operating system this agent belongs to. */
  host: string;
  /** ISO timestamp supplied by the caller so the core stays deterministic. */
  createdAt: string;
}

/** What the operator/owner supplies to build a profile. Everything is
 *  optional except that a useful profile wants at least a request or mission;
 *  unset fields fall back to universal, industry-neutral defaults. */
export interface AgentProfileDraft {
  rawRequest?: string;
  agentName?: string;
  displayName?: string;
  department?: string;
  primaryMission?: string;
  normalOwnerInput?: string[];
  automaticActions?: string[];
  liveActionAuthority?: Partial<LiveActionAuthority>;
  hardStops?: string[];
  allowedTools?: string[];
  costRules?: string[];
  memoryBoundaries?: string[];
  outputFormat?: string[];
  storageBehavior?: string[];
  verificationRules?: string[];
  handoffRules?: string[];
  dashboardBehavior?: string[];
  activationMode?: ActivationMode;
  auditExpectations?: string[];
  rollbackExpectations?: string[];
  passFailTest?: string[];
  ownerApprovalLoop?: string[];
  host?: string;
  createdAt?: string;
}

const OPERATOR_HINT = (what: string) => `(operator: ${what})`;

// ── Universal, industry-neutral defaults ─────────────────────────────────
// These apply to a department agent in any business operating system. They are
// written in positive language and carry no business-, industry-, or
// customer-type-specific detail. Concrete specifics come from the interview.

const DEFAULT_HARD_STOPS = [
  'Reading, printing, or storing secrets, credentials, tokens, or .env values.',
  'Spending money: paid tools, paid APIs, subscriptions, or billing changes.',
  'Connecting or authenticating a private owner account (OAuth or login).',
  'Destructive actions: deleting, overwriting, wiping, or dropping data.',
  'Releasing outside the safe lane: git push, deploy, or publish.',
  'Sending real external communications or mutating live external records.',
  'Acting on real customer or production data without an owner decision.',
];

const DEFAULT_COST_RULES = [
  'Runs on free, local capability by default.',
  'Any paid tool or paid API is an owner-owned decision made before use.',
  'States the expected cost before any spend.',
];

const DEFAULT_MEMORY_BOUNDARIES = [
  'Remembers only what its mission needs; no unrelated owner data.',
  'Keeps memory scoped to its own department; reads another agent\'s context only through a handoff.',
  'Never persists secrets, credentials, or tokens.',
];

const DEFAULT_OUTPUT_FORMAT = [
  'Returns plain, owner-readable text or structured JSON.',
  'States what it did, what it found, and what it recommends next.',
  'Flags any hard stop it reached and the owner decision it needs.',
];

const DEFAULT_STORAGE_BEHAVIOR = [
  'Writes only to its approved store or work area.',
  'Makes no writes outside host-approved paths.',
  'Keeps sensitive work product out of shared source control unless the owner asks for it.',
];

const DEFAULT_VERIFICATION_RULES = [
  'Checks its own output against the pass/fail test before reporting done.',
  'Runs the host project\'s checks (tests, typecheck, build) whenever it changes code.',
  'Reports failures plainly, with the evidence.',
];

const DEFAULT_HANDOFF_RULES = [
  'Hands work to another department agent through an explicit, logged task.',
  'Passes only the context the receiving agent needs.',
  'Never assumes another agent\'s authority.',
];

const DEFAULT_DASHBOARD_BEHAVIOR = [
  'Appears on the host dashboard with its status and activation mode.',
  'Shows its current engagement, owner decision, and last result.',
  'Exposes owner controls only; the dashboard never auto-runs a live action.',
];

const DEFAULT_AUDIT_EXPECTATIONS = [
  'Records every live-capable action with a timestamp, its input, and its outcome.',
  'Logs each owner decision (approve, tweak, reject, hold) against the engagement.',
  'Keeps sandbox runs distinguishable from live runs in the record.',
];

const DEFAULT_ROLLBACK_EXPECTATIONS = [
  'Ships every change with a documented way to undo it.',
  'Defines a reverse or compensating action for any live action before activation.',
  'Can return to sandbox mode at any time without losing data.',
];

const DEFAULT_OWNER_APPROVAL_LOOP = [
  'Presents completed work with approve / tweak / reject / hold options.',
  'Lets no hard-stop action proceed without an explicit owner decision.',
  'Lets the owner change the agent\'s activation mode and authority at any time.',
];

const DEFAULT_UNTIL_AUTHORIZED =
  'Build the capability, run it in sandbox with test data, and present the activation steps for the owner to approve.';

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function condense(text: string, max = 160): string {
  const flat = collapse(text);
  if (!flat) return '';
  const first = flat.split(/(?<=[.!?])\s/)[0] ?? flat;
  return first.length <= max ? first : flat.slice(0, max).trimEnd() + '…';
}

/** Normalize an agent name into a stable lower-kebab slug. */
export function slugifyAgentName(input: string): string {
  const slug = collapse(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'department-agent';
}

function titleCase(slug: string): string {
  const words = slug.split('-').filter(Boolean);
  if (!words.length) return 'Department Agent';
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function pick(supplied: string[] | undefined, fallback: string[]): string[] {
  return supplied && supplied.length ? supplied : fallback;
}

function isActivationMode(v: unknown): v is ActivationMode {
  return typeof v === 'string' && (ACTIVATION_MODES as readonly string[]).includes(v);
}

/**
 * Build a normalized, universal department-agent profile from a draft. Pure
 * and deterministic: unset fields fall back to industry-neutral defaults, and
 * the only non-deterministic input (timestamp) is supplied by the caller.
 */
export function buildAgentProfile(draft: AgentProfileDraft): DepartmentAgentProfile {
  const request = collapse(draft.rawRequest ?? '');
  const displayName =
    draft.displayName?.trim() ||
    (draft.agentName ? titleCase(slugifyAgentName(draft.agentName)) : '') ||
    'Department Agent';
  const agentName = slugifyAgentName(draft.agentName?.trim() || displayName);

  const primaryMission =
    draft.primaryMission?.trim() ||
    (request ? condense(request) : OPERATOR_HINT('state the agent\'s one-line primary mission'));

  const liveDraft = draft.liveActionAuthority ?? {};
  const authorized = liveDraft.authorized === true;
  const approvedActions = authorized ? liveDraft.approvedActions ?? [] : [];
  const liveActionAuthority: LiveActionAuthority = {
    authorized,
    approvedActions,
    untilAuthorized: liveDraft.untilAuthorized?.trim() || DEFAULT_UNTIL_AUTHORIZED,
  };

  // An agent can only run in a live mode once the owner authorized live
  // actions. Until then it is forced to sandbox regardless of the requested
  // mode. This is the load-bearing authority rule.
  const requestedMode = isActivationMode(draft.activationMode) ? draft.activationMode : 'sandbox';
  const activationMode: ActivationMode = authorized ? requestedMode : 'sandbox';

  return {
    agentName,
    displayName,
    department:
      draft.department?.trim() || OPERATOR_HINT('name the department this agent owns'),
    primaryMission,
    normalOwnerInput: pick(draft.normalOwnerInput, [
      OPERATOR_HINT('list the everyday requests the owner gives this agent'),
    ]),
    automaticActions: pick(draft.automaticActions, [
      OPERATOR_HINT('list what the agent may do automatically inside the safe lane'),
    ]),
    liveActionAuthority,
    hardStops: pick(draft.hardStops, DEFAULT_HARD_STOPS),
    allowedTools: pick(draft.allowedTools, [
      OPERATOR_HINT('list the exact tools this agent may use'),
    ]),
    costRules: pick(draft.costRules, DEFAULT_COST_RULES),
    memoryBoundaries: pick(draft.memoryBoundaries, DEFAULT_MEMORY_BOUNDARIES),
    outputFormat: pick(draft.outputFormat, DEFAULT_OUTPUT_FORMAT),
    storageBehavior: pick(draft.storageBehavior, DEFAULT_STORAGE_BEHAVIOR),
    verificationRules: pick(draft.verificationRules, DEFAULT_VERIFICATION_RULES),
    handoffRules: pick(draft.handoffRules, DEFAULT_HANDOFF_RULES),
    dashboardBehavior: pick(draft.dashboardBehavior, DEFAULT_DASHBOARD_BEHAVIOR),
    activationMode,
    auditExpectations: pick(draft.auditExpectations, DEFAULT_AUDIT_EXPECTATIONS),
    rollbackExpectations: pick(draft.rollbackExpectations, DEFAULT_ROLLBACK_EXPECTATIONS),
    passFailTest: pick(draft.passFailTest, [
      OPERATOR_HINT('define one concrete check that proves this agent works'),
    ]),
    ownerApprovalLoop: pick(draft.ownerApprovalLoop, DEFAULT_OWNER_APPROVAL_LOOP),
    host: draft.host?.trim() || 'a host operating system',
    createdAt: draft.createdAt?.trim() || 'unset',
  };
}

// ── Authority model ──────────────────────────────────────────────────────

export interface AuthorityModel {
  /** Mode the owner asked for. */
  requestedMode: ActivationMode;
  /** Mode the agent may actually run in given current authority. */
  effectiveMode: ActivationMode;
  /** Whether live external actions are authorized. */
  authorized: boolean;
  /** The live actions the owner approved. */
  approvedLiveActions: string[];
  /** Everything gated behind an owner decision right now. */
  gatedUntilAuthorized: string[];
  /** Plain-language summary for the owner. */
  summary: string;
}

/**
 * Derive the agent's authority model from its profile. Pure. Encodes the rule
 * that live actions are gated until the owner explicitly scopes and authorizes
 * them; until then the agent stays in sandbox and builds + mocks the capability.
 */
export function deriveAuthorityModel(profile: DepartmentAgentProfile): AuthorityModel {
  const authorized = profile.liveActionAuthority.authorized;
  const requestedMode: ActivationMode = authorized ? profile.activationMode : profile.activationMode;
  const effectiveMode: ActivationMode = authorized ? profile.activationMode : 'sandbox';

  const gated = [...profile.hardStops];
  if (!authorized) {
    gated.unshift(
      'Live external actions (this agent has not been scoped & authorized for live mode yet).',
    );
  }

  const summary = authorized
    ? `Owner has authorized live actions. The agent may run in ${effectiveMode} mode for the approved actions; every hard stop still needs an owner decision.`
    : `Live actions are not authorized. The agent runs in sandbox. ${profile.liveActionAuthority.untilAuthorized}`;

  return {
    requestedMode,
    effectiveMode,
    authorized,
    approvedLiveActions: profile.liveActionAuthority.approvedActions,
    gatedUntilAuthorized: gated,
    summary,
  };
}

// ── Interview generator ──────────────────────────────────────────────────

export interface InterviewSection {
  heading: string;
  questions: string[];
}

export interface AgentInterview {
  title: string;
  intro: string;
  sections: InterviewSection[];
}

/**
 * Generate the interview that defines a new department agent. Deterministic
 * and universal: the questions map one-to-one onto the profile contract so the
 * owner's answers can be poured straight into buildAgentProfile.
 */
export function generateAgentInterview(input: {
  rawRequest?: string;
  department?: string;
  displayName?: string;
}): AgentInterview {
  const request = collapse(input.rawRequest ?? '');
  const who = input.displayName?.trim() || 'the new department agent';

  const sections: InterviewSection[] = [
    {
      heading: 'Identity',
      questions: [
        'What is this agent called, and what name should the owner see on the dashboard?',
        'Which department does it own?',
        'In one line, what is its primary mission?',
      ],
    },
    {
      heading: 'Input & actions',
      questions: [
        'What everyday requests will the owner give it?',
        'What may it do automatically inside the safe lane, with no approval?',
        'What live external actions would it eventually need (so we can scope authority)?',
      ],
    },
    {
      heading: 'Authority & activation',
      questions: [
        'Should it start in sandbox, assisted-live, or live?',
        'Which specific live actions, if any, is the owner authorizing now?',
        'What must always stop for an owner decision?',
      ],
    },
    {
      heading: 'Tools & cost',
      questions: [
        'Which exact tools may it use?',
        'Is any paid tool or paid API in scope, and who approves the spend?',
      ],
    },
    {
      heading: 'Memory & storage',
      questions: [
        'What may it remember, and what must it never keep?',
        'Where is it allowed to write, and what stays out of shared source control?',
      ],
    },
    {
      heading: 'Output & verification',
      questions: [
        'How should it format what it returns?',
        'What concrete pass/fail check proves it works?',
        'What checks must it run before reporting done?',
      ],
    },
    {
      heading: 'Handoff, dashboard & audit',
      questions: [
        'How does it hand work to another department agent?',
        'How should it appear and behave on the dashboard?',
        'What must it record for audit, and how is a change rolled back?',
      ],
    },
    {
      heading: 'Owner approval loop',
      questions: [
        'How does the owner approve, tweak, reject, or hold its work?',
      ],
    },
  ];

  return {
    title: `Define a department agent: ${who}`,
    intro: request
      ? `Request: "${condense(request, 200)}". Answer the questions below to turn this into a complete agent profile.`
      : 'Answer the questions below to turn a request into a complete agent profile.',
    sections,
  };
}

// ── Markdown rendering ───────────────────────────────────────────────────

const PLACEHOLDER = '<fill in>';

function mdList(items: string[]): string {
  return items.length ? items.map((i) => `- ${i}`).join('\n') : `- ${PLACEHOLDER}`;
}

function mdChecklist(items: string[]): string {
  return items.length ? items.map((i) => `- [ ] ${i}`).join('\n') : `- [ ] ${PLACEHOLDER}`;
}

/** Render the interview as a copy-ready Markdown questionnaire. */
export function renderInterviewMarkdown(interview: AgentInterview): string {
  const body = interview.sections
    .map((s) => `### ${s.heading}\n${s.questions.map((q) => `- ${q}`).join('\n')}`)
    .join('\n\n');
  return `# ${interview.title}\n\n${interview.intro}\n\n${body}\n`;
}

/** Render the full profile as Markdown (the operating contract document). */
export function renderAgentProfileMarkdown(profile: DepartmentAgentProfile): string {
  const p = profile;
  const auth = deriveAuthorityModel(p);
  return `# Department Agent Profile — ${p.displayName}

**Agent name:** \`${p.agentName}\`
**Department:** ${p.department}
**Host:** ${p.host}
**Activation mode:** ${p.activationMode} (effective: ${auth.effectiveMode})
**Created:** ${p.createdAt}

## Primary mission
${p.primaryMission}

## Normal owner input
${mdList(p.normalOwnerInput)}

## Automatic actions (safe lane)
${mdList(p.automaticActions)}

## Live-action authority
- **Authorized:** ${p.liveActionAuthority.authorized ? 'yes' : 'no'}
- **Approved live actions:** ${p.liveActionAuthority.approvedActions.length ? p.liveActionAuthority.approvedActions.join('; ') : 'none'}
- **Until authorized:** ${p.liveActionAuthority.untilAuthorized}

## Hard stops (always need an owner decision)
${mdList(p.hardStops)}

## Allowed tools
${mdList(p.allowedTools)}

## Cost rules
${mdList(p.costRules)}

## Memory boundaries
${mdList(p.memoryBoundaries)}

## Output format
${mdList(p.outputFormat)}

## Storage behavior
${mdList(p.storageBehavior)}

## Verification rules
${mdList(p.verificationRules)}

## Handoff rules
${mdList(p.handoffRules)}

## Dashboard behavior
${mdList(p.dashboardBehavior)}

## Audit expectations
${mdList(p.auditExpectations)}

## Rollback expectations
${mdList(p.rollbackExpectations)}

## Pass / fail test
${mdList(p.passFailTest)}

## Owner approval loop
${mdList(p.ownerApprovalLoop)}
`;
}

// ── Build packet generator ───────────────────────────────────────────────

/**
 * Generate the complete, owner-reviewable agent build packet. Pure text. It
 * bundles the profile, dashboard behavior, permissions, authority model, tool
 * plan, memory rules, output rules, storage rules, test plan, activation
 * checklist, and owner decision options into one document.
 */
export function generateAgentBuildPacket(profile: DepartmentAgentProfile): string {
  const p = profile;
  const auth = deriveAuthorityModel(p);

  const activationChecklist = [
    'Confirm the profile reads correctly (mission, department, normal input).',
    'Confirm the automatic-action list is exactly what may run without approval.',
    'Scope the live actions the owner is authorizing now (if any).',
    'Supply any owner-owned setup the agent needs (accounts/config), kept off shared source control.',
    'Run the pass/fail test in sandbox with test data.',
    'Review the audit and rollback path for every live-capable action.',
    'Choose the activation mode: sandbox, assisted-live, or live.',
    'Record the owner decision: approve, tweak, reject, or hold.',
  ];

  return `# Forge Agent Build Packet — ${p.displayName}

This packet defines a department agent for ${p.host}. Forge built the profile
and the supporting plan. The agent stays in sandbox until the owner scopes its
authority and approves activation. Nothing here runs, connects, or spends.

## 1. Profile
${renderAgentProfileMarkdown(p).split('\n').slice(1).join('\n').trim()}

## 2. Dashboard behavior
${mdList(p.dashboardBehavior)}

## 3. Permissions
**May do automatically (safe lane):**
${mdList(p.automaticActions)}

**Always needs an owner decision:**
${mdList(p.hardStops)}

## 4. Authority model
- **Requested mode:** ${auth.requestedMode}
- **Effective mode now:** ${auth.effectiveMode}
- **Live actions authorized:** ${auth.authorized ? 'yes' : 'no'}
- **Approved live actions:** ${auth.approvedLiveActions.length ? auth.approvedLiveActions.join('; ') : 'none'}

${auth.summary}

**Gated until authorized:**
${mdList(auth.gatedUntilAuthorized)}

## 5. Tool plan
${mdList(p.allowedTools)}

Cost rules:
${mdList(p.costRules)}

## 6. Memory rules
${mdList(p.memoryBoundaries)}

## 7. Output rules
${mdList(p.outputFormat)}

## 8. Storage rules
${mdList(p.storageBehavior)}

## 9. Test plan
${mdList(p.verificationRules)}

Pass / fail test:
${mdList(p.passFailTest)}

## 10. Activation checklist
${mdChecklist(activationChecklist)}

## 11. Owner decision options
Choose one: approve, tweak, reject, or hold.
- approve: activate the agent in the chosen mode for the scoped actions.
- tweak: keep building with specific changes to this profile.
- reject: do not build this agent.
- hold: pause until the owner decides.

Forge built the profile and plan as far as was safely possible and stopped at
owner-owned authority and activation gates. The owner scopes authority, supplies
setup, and approves activation. Forge will not push, deploy, subscribe, connect
accounts, send communications, or read secrets on the agent's behalf.
`;
}

// ── Profile completeness helpers ─────────────────────────────────────────
// A profile field is "defined" when the operator actually supplied it. Unset
// fields carry an operator hint of the form "(operator: ...)", and identity
// falls back to the generic "Department Agent" / "department-agent". These
// helpers tell a filled field from a placeholder so the readiness checklist
// and review packet can flag what the owner still has to provide.

export function isOperatorHint(value: string): boolean {
  return /^\(operator:/i.test(value.trim());
}

/** True when a string profile field carries a real operator-supplied value
 *  (non-empty and not a placeholder hint). */
export function fieldDefined(value: string): boolean {
  const v = (value ?? '').trim();
  return v.length > 0 && !isOperatorHint(v);
}

/** True when a list profile field has at least one real (non-placeholder) item. */
export function listDefined(items: string[]): boolean {
  return (items ?? []).some((i) => fieldDefined(i));
}

// ── Promotion readiness checklist ────────────────────────────────────────

export interface ReadinessItem {
  /** Short label for the readiness aspect. */
  label: string;
  /** True when this aspect is filled in enough to promote. */
  ready: boolean;
  /** Plain-language note on what passed or what is missing. */
  detail: string;
}

export interface PromotionReadiness {
  /** True only when every readiness item passed. */
  ready: boolean;
  /** Count of items that passed. */
  readyCount: number;
  /** Total items checked. */
  totalCount: number;
  items: ReadinessItem[];
  /** Plain-language summary for the owner. */
  summary: string;
}

/**
 * Assess whether a saved profile is ready to promote into a real
 * department-agent folder. This is a readiness artifact only: it inspects the
 * profile for completeness and does NOT promote, activate, or run anything.
 * Pure and deterministic.
 */
export function assessPromotionReadiness(profile: DepartmentAgentProfile): PromotionReadiness {
  const p = profile;
  const live = p.liveActionAuthority;

  const authorityReady =
    p.activationMode === 'sandbox' || (live.authorized && live.approvedActions.length > 0);

  const items: ReadinessItem[] = [
    {
      label: 'Profile complete',
      ready: fieldDefined(p.displayName) && p.displayName !== 'Department Agent' && p.agentName !== 'department-agent',
      detail:
        p.displayName !== 'Department Agent'
          ? `Identity set: ${p.displayName} (\`${p.agentName}\`).`
          : 'Give the agent a real display name and identity.',
    },
    {
      label: 'Department clear',
      ready: fieldDefined(p.department),
      detail: fieldDefined(p.department) ? p.department : 'Name the department this agent owns.',
    },
    {
      label: 'Mission clear',
      ready: fieldDefined(p.primaryMission),
      detail: fieldDefined(p.primaryMission) ? 'Primary mission stated.' : 'State the one-line primary mission.',
    },
    {
      label: 'Permissions defined',
      ready: listDefined(p.automaticActions) && listDefined(p.hardStops),
      detail: listDefined(p.automaticActions)
        ? 'Automatic actions and hard stops are listed.'
        : 'List what may run automatically inside the safe lane.',
    },
    {
      label: 'Authority mode defined',
      ready: authorityReady,
      detail: authorityReady
        ? `Activation mode ${p.activationMode}; live actions ${live.authorized ? 'authorized' : 'gated to sandbox'}.`
        : 'A live mode was requested without scoped, approved live actions.',
    },
    {
      label: 'Memory rules defined',
      ready: listDefined(p.memoryBoundaries),
      detail: listDefined(p.memoryBoundaries) ? 'Memory boundaries set.' : 'Define what the agent may remember.',
    },
    {
      label: 'Tools defined',
      ready: listDefined(p.allowedTools),
      detail: listDefined(p.allowedTools) ? 'Allowed tools listed.' : 'List the exact tools this agent may use.',
    },
    {
      label: 'Output rules defined',
      ready: listDefined(p.outputFormat),
      detail: listDefined(p.outputFormat) ? 'Output format set.' : 'Define how the agent formats its output.',
    },
    {
      label: 'Storage behavior defined',
      ready: listDefined(p.storageBehavior),
      detail: listDefined(p.storageBehavior) ? 'Storage behavior set.' : 'Define where the agent may write.',
    },
    {
      label: 'Verification rules defined',
      ready: listDefined(p.verificationRules),
      detail: listDefined(p.verificationRules) ? 'Verification rules set.' : 'Define how the agent proves its work.',
    },
    {
      label: 'Handoff rules defined',
      ready: listDefined(p.handoffRules),
      detail: listDefined(p.handoffRules) ? 'Handoff rules set.' : 'Define how the agent hands work off.',
    },
    {
      label: 'Dashboard behavior defined',
      ready: listDefined(p.dashboardBehavior),
      detail: listDefined(p.dashboardBehavior) ? 'Dashboard behavior set.' : 'Define how the agent appears on the dashboard.',
    },
    {
      label: 'Pass/fail test defined',
      ready: listDefined(p.passFailTest),
      detail: listDefined(p.passFailTest) ? 'Pass/fail test defined.' : 'Define one concrete check that proves it works.',
    },
    {
      label: 'Owner approval state clear',
      ready: listDefined(p.ownerApprovalLoop),
      detail: listDefined(p.ownerApprovalLoop) ? 'Owner approval loop defined.' : 'Define the approve/tweak/reject/hold loop.',
    },
    {
      label: 'Activation path clear',
      ready: fieldDefined(live.untilAuthorized),
      detail: fieldDefined(live.untilAuthorized) ? 'Activation path stated.' : 'State the path from sandbox to live.',
    },
    {
      label: 'Security/cost gates identified',
      ready: listDefined(p.hardStops) && listDefined(p.costRules),
      detail: listDefined(p.hardStops) && listDefined(p.costRules)
        ? 'Hard stops and cost rules are identified.'
        : 'Identify the hard stops and cost rules.',
    },
  ];

  const readyCount = items.filter((i) => i.ready).length;
  const totalCount = items.length;
  const ready = readyCount === totalCount;
  const summary = ready
    ? `Ready: all ${totalCount} readiness checks pass. This is a readiness artifact only; the owner still authorizes the actual promotion.`
    : `Not ready: ${readyCount}/${totalCount} checks pass. Fill the items marked not ready before promotion. This is a readiness artifact only; nothing is promoted or activated here.`;

  return { ready, readyCount, totalCount, items, summary };
}

/** Render the promotion readiness checklist as Markdown. */
export function renderPromotionReadinessMarkdown(
  readiness: PromotionReadiness,
  displayName: string,
): string {
  const lines = readiness.items
    .map((i) => `- [${i.ready ? 'x' : ' '}] **${i.label}** — ${i.detail}`)
    .join('\n');
  return `# Promotion Readiness — ${displayName}

${readiness.summary}

**Score:** ${readiness.readyCount}/${readiness.totalCount} checks pass.

${lines}

This checklist verifies completeness only. It does not promote the profile into
a runnable agent, activate anything, connect accounts, or read secrets. Actual
promotion stays an owner-owned decision.
`;
}

// ── Profile review packet ────────────────────────────────────────────────

export interface ProfileReviewInput {
  profile: DepartmentAgentProfile;
  /** The original request that produced the profile, if available. */
  request?: string;
  /** Saved profile status, if any. */
  status?: string;
  /** Saved owner decision, if any. */
  ownerDecision?: string;
  /** Owner/reviewer notes, if any. */
  notes?: string;
}

/**
 * Generate a copy-ready review packet for owner / Codex / QA review of a
 * department-agent profile. Pure text. Surfaces the profile summary, authority
 * model, permissions, rules, risks/open questions, owner decision, and a
 * recommended next step. It runs nothing and reviews no live system.
 */
export function generateProfileReviewPacket(input: ProfileReviewInput): string {
  const p = input.profile;
  const auth = deriveAuthorityModel(p);
  const readiness = assessPromotionReadiness(p);

  // Open questions: every field the operator left as a placeholder, plus an
  // authority caveat when a live mode was requested without authorization.
  const openItems = readiness.items.filter((i) => !i.ready).map((i) => `${i.label}: ${i.detail}`);
  if (!p.liveActionAuthority.authorized) {
    openItems.push('Live actions are not authorized yet; the agent stays in sandbox until the owner scopes them.');
  }

  const status = input.status?.trim() || 'draft';
  const ownerDecision = input.ownerDecision?.trim() || 'pending';

  const recommendedNext = readiness.ready
    ? ownerDecision === 'approved'
      ? 'Profile is complete and approved. Prepare promotion into a department-agent folder as a draft-only artifact for owner sign-off.'
      : 'Profile is complete. Send for owner decision (approve / tweak / reject / hold).'
    : 'Fill the open questions below, then regenerate the profile and rerun this review.';

  const openQuestions = openItems.length
    ? openItems.map((o) => `- ${o}`).join('\n')
    : '- None. Every readiness check passed.';

  return `# Profile Review Packet — ${p.displayName}

Generated for owner / Codex / QA review. Text only: it runs nothing, connects
nothing, and reads no secrets.

## Profile summary
- **Agent name:** \`${p.agentName}\`
- **Display name:** ${p.displayName}
- **Status:** ${status}
- **Owner decision:** ${ownerDecision}
- **Readiness:** ${readiness.readyCount}/${readiness.totalCount} checks pass${readiness.ready ? ' (ready)' : ''}
${input.request?.trim() ? `- **Request:** ${condense(input.request, 200)}` : ''}

## Department
${p.department}

## Mission
${p.primaryMission}

## Authority model
- **Requested mode:** ${auth.requestedMode}
- **Effective mode now:** ${auth.effectiveMode}
- **Live actions authorized:** ${auth.authorized ? 'yes' : 'no'}
- **Approved live actions:** ${auth.approvedLiveActions.length ? auth.approvedLiveActions.join('; ') : 'none'}

${auth.summary}

## Permissions / tool plan
**May do automatically (safe lane):**
${mdList(p.automaticActions)}

**Always needs an owner decision:**
${mdList(p.hardStops)}

**Allowed tools:**
${mdList(p.allowedTools)}

**Cost rules:**
${mdList(p.costRules)}

## Memory / storage rules
**Memory boundaries:**
${mdList(p.memoryBoundaries)}

**Storage behavior:**
${mdList(p.storageBehavior)}

## Outputs
${mdList(p.outputFormat)}

## Verification / pass-fail test
**Verification rules:**
${mdList(p.verificationRules)}

**Pass / fail test:**
${mdList(p.passFailTest)}

## Activation mode
${p.activationMode} (effective: ${auth.effectiveMode})

## Risks / open questions
${openQuestions}

## Owner decision
${ownerDecision}${input.notes?.trim() ? `\n\nNotes: ${input.notes.trim()}` : ''}

## Recommended next step
${recommendedNext}
`;
}
