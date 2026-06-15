// Forge Build Interview Mode — pure Forge Core.
//
// Deterministic, dependency-free, host-neutral, industry-neutral, text/JSON
// only. Forge owns the architecture: Tyler describes a broad build goal in
// plain English, Forge asks only the targeted questions that change the build,
// then turns the answer into a capability spec, an implementation sprint packet,
// and a Codex review checklist. It generates text only — it builds nothing,
// runs nothing, connects nothing, and reads no secrets.

function condense(text: string, max = 200): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : flat.slice(0, max).trimEnd() + '…';
}

export interface BuildInterviewSection {
  heading: string;
  questions: string[];
}

export interface BuildInterview {
  title: string;
  intro: string;
  sections: BuildInterviewSection[];
}

/**
 * Generate the build interview. The questions map onto the capability spec, so
 * the answers can be poured straight into buildCapabilitySpec. Deterministic
 * and universal.
 */
export function generateBuildInterview(input: { goal?: string }): BuildInterview {
  const goal = (input.goal ?? '').trim();
  const sections: BuildInterviewSection[] = [
    {
      heading: 'Outcome',
      questions: [
        'In one line, what should this build let you do that you cannot do today?',
        'Who uses it, and from where (chat, dashboard, batch, scheduled)?',
        'How will you know it worked (the single most important success signal)?',
      ],
    },
    {
      heading: 'Capabilities',
      questions: [
        'What are the core capabilities, in priority order?',
        'What is explicitly out of scope for this build?',
      ],
    },
    {
      heading: 'Inputs & data',
      questions: [
        'What inputs does it take, and what is the source of truth for each?',
        'What data or sources must it read, and which are official vs context?',
      ],
    },
    {
      heading: 'Safety & authority',
      questions: [
        'What must it never do without explicit owner approval?',
        'Are there cost, secret, account, or destructive-action boundaries?',
      ],
    },
    {
      heading: 'Tools & integration',
      questions: [
        'Which exact tools, APIs, or services does it need?',
        'How does it appear and behave on the dashboard?',
      ],
    },
    {
      heading: 'Output & acceptance',
      questions: [
        'What is the output format the owner reviews?',
        'What concrete acceptance test proves it is done?',
      ],
    },
  ];
  return {
    title: 'Forge Build Interview',
    intro: goal
      ? `Goal: "${condense(goal, 200)}". Answer only the questions that change the build; Forge fills the rest with safe defaults.`
      : 'Describe the build goal, then answer only the questions that change the build. Forge owns the architecture and fills the rest with safe defaults.',
    sections,
  };
}

export interface BuildSpecDraft {
  goal: string;
  capabilities?: string[];
  outOfScope?: string[];
  inputs?: string[];
  sourceRequirements?: string[];
  safetyBoundaries?: string[];
  toolRequirements?: string[];
  dashboardBehavior?: string[];
  outputFormat?: string[];
  acceptanceCriteria?: string[];
  assumptions?: string[];
}

export interface CapabilitySpec {
  goal: string;
  capabilities: string[];
  outOfScope: string[];
  inputs: string[];
  sourceRequirements: string[];
  safetyBoundaries: string[];
  toolRequirements: string[];
  dashboardBehavior: string[];
  outputFormat: string[];
  acceptanceCriteria: string[];
  assumptions: string[];
}

const DEFAULT_SAFETY = [
  'No secrets, tokens, or .env values are read, printed, or stored.',
  'No money is spent (paid tools / APIs / subscriptions) without an explicit owner decision.',
  'No destructive actions (delete, overwrite, drop) without an owner decision.',
  'No release outside the safe lane (push, deploy, publish) without owner approval.',
  'No real external communication or live-account mutation without owner approval.',
];

const DEFAULT_OUTPUT = [
  'Plain owner-readable text or structured JSON.',
  'States what it did, what it found, and the recommended next step.',
];

const HINT = (what: string) => `(owner: ${what})`;

function pick(supplied: string[] | undefined, fallback: string[]): string[] {
  return supplied && supplied.length ? supplied : fallback;
}

/** Normalize a draft into a capability spec, filling gaps with safe, universal
 *  defaults. Pure and deterministic. */
export function buildCapabilitySpec(draft: BuildSpecDraft): CapabilitySpec {
  return {
    goal: draft.goal.trim() || HINT('state the one-line build goal'),
    capabilities: pick(draft.capabilities, [HINT('list the core capabilities in priority order')]),
    outOfScope: pick(draft.outOfScope, [HINT('state what is explicitly out of scope')]),
    inputs: pick(draft.inputs, [HINT('list the inputs and the source of truth for each')]),
    sourceRequirements: pick(draft.sourceRequirements, [HINT('list required sources; mark official vs context')]),
    safetyBoundaries: pick(draft.safetyBoundaries, DEFAULT_SAFETY),
    toolRequirements: pick(draft.toolRequirements, [HINT('list the exact tools/APIs/services needed')]),
    dashboardBehavior: pick(draft.dashboardBehavior, [HINT('describe how it appears and behaves on the dashboard')]),
    outputFormat: pick(draft.outputFormat, DEFAULT_OUTPUT),
    acceptanceCriteria: pick(draft.acceptanceCriteria, [HINT('define one concrete acceptance test that proves it is done')]),
    assumptions: pick(draft.assumptions, ['Defaults above are assumed unless the owner overrides them.']),
  };
}

function mdList(items: string[]): string {
  return items.length ? items.map((i) => `- ${i}`).join('\n') : '- (none)';
}

function mdChecklist(items: string[]): string {
  return items.length ? items.map((i) => `- [ ] ${i}`).join('\n') : '- [ ] (none)';
}

export interface BuildPacket {
  spec: CapabilitySpec;
  interview: BuildInterview;
  markdown: string;
}

/**
 * Generate the full build packet: interview, assumption summary, capability
 * spec, safety boundaries, tool/source requirements, dashboard behavior,
 * output format, acceptance criteria, implementation sprint packet, and a Codex
 * review checklist. Pure text.
 */
export function generateBuildPacket(draft: BuildSpecDraft): BuildPacket {
  const spec = buildCapabilitySpec(draft);
  const interview = generateBuildInterview({ goal: draft.goal });

  const implementationSteps = [
    'Confirm the capability spec and assumptions with the owner.',
    'Implement the core capabilities in priority order behind the safety boundaries.',
    'Wire the inputs and required sources; label official vs context sources.',
    'Add the dashboard behavior and the owner-reviewable output format.',
    'Add tests that encode the acceptance criteria.',
    'Run tests, typecheck, and build; stage exact files; commit once.',
  ];

  const codexChecklist = [
    'Capabilities match the spec and stay in scope.',
    'Every safety boundary is enforced in code, not just documented.',
    'No secrets/.env reads; no unapproved spend, deploy, or destructive action.',
    'Inputs are validated; official vs context sources are distinguished.',
    'Acceptance tests exist and pass; output format matches the spec.',
    'Exact files staged; no unrelated changes; no push.',
  ];

  const interviewMd = interview.sections
    .map((s) => `### ${s.heading}\n${s.questions.map((q) => `- ${q}`).join('\n')}`)
    .join('\n\n');

  const markdown = `# Forge Build Packet

## Goal
${spec.goal}

## Build interview
${interviewMd}

## Assumption summary
${mdList(spec.assumptions)}

## Capability spec
**Capabilities**
${mdList(spec.capabilities)}

**Out of scope**
${mdList(spec.outOfScope)}

## Inputs
${mdList(spec.inputs)}

## Tool / source requirements
**Tools**
${mdList(spec.toolRequirements)}

**Sources**
${mdList(spec.sourceRequirements)}

## Safety boundaries
${mdList(spec.safetyBoundaries)}

## Dashboard behavior
${mdList(spec.dashboardBehavior)}

## Data / output format
${mdList(spec.outputFormat)}

## Tests / acceptance criteria
${mdList(spec.acceptanceCriteria)}

## Implementation sprint packet
${mdChecklist(implementationSteps)}

## Codex review checklist
${mdChecklist(codexChecklist)}

---

Forge owns the architecture: the owner describes the goal in plain words and
Forge produces this packet. Nothing here is built, run, connected, or deployed.
A writeback proposal can be generated separately if the repo has writeback
scaffolding; this packet authorizes nothing on its own.
`;

  return { spec, interview, markdown };
}
