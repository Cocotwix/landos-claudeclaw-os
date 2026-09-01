// LandOS — the production LLM Deal Manager for Subject Understanding.
//
// Stage 2 shipped the bounded loop with the planner INJECTABLE and nothing
// bound to it, so every live run completed with zero reasoning turns: the
// deterministic reading was the only reading. This binds the planner to a model
// path LandOS already owns.
//
// Nothing new is introduced. The transport, the profile, the toolset and the
// model selection are the ones the Intelligence Stack already runs on:
//
//   profile   `landos-property`  — the existing persistent property specialist.
//   toolset   `clarify`          — a no-op question channel. The reasoning turn
//                                  structurally cannot browse, search, run a
//                                  command or write a file. It returns a plan;
//                                  LandOS decides whether to act on it.
//   model     `resolveAnalystModel()` — the same provider/model override every
//                                  other specialist reads. No new credentials.
//
// The model is asked for ONE thing: a plan, as JSON, matching the schema the
// loop already validates. Its output is an untrusted proposal throughout —
// `deriveSubjectCandidates` and `decideSubjectOutcome` remain the only things
// that decide what the subject is.

import {
  ANALYST_JUDGMENT_TIMEOUT_MS,
  ANALYST_TOOLSETS,
  hermesProfileProvisioned,
  invokeHermesCli,
  resolveAnalystModel,
  type HermesAnalystDeps,
} from './acquisition-analyst.js';
import { SPECIALIST_ENGINE, SPECIALIST_PROFILES, SPECIALIST_TRANSPORT, specialistInvocationArgs } from './specialist-intelligence-executor.js';
import {
  SUBJECT_UNDERSTANDING_ALLOWED_CAPABILITIES,
  type SubjectReasoningProvenance,
  type SubjectUnderstandingPlanner,
  type SubjectUnderstandingPlannerInput,
} from './subject-understanding.js';

/** The persistent specialist that owns property identity. Not a new agent. */
export const SUBJECT_UNDERSTANDING_PROFILE = SPECIALIST_PROFILES.property;
export const SUBJECT_UNDERSTANDING_REASONING_TIMEOUT_MS = 10 * 60_000;

const CAPABILITY_NOTES: Record<string, string> = {
  'property-resolution': 'resolve which parcel this lead is, from the identifiers already retained',
  'landportal-research': 'open the LandPortal record for a supplied link or property id',
  'landportal-property-characteristics': 'read the provider parcel characteristics for a known record',
  'assessor-tax': 'read the county assessor / tax record for a stated parcel',
  'property-development-history': 'read the recorded development and permit history for a stated parcel',
};

function factLine(fact: SubjectUnderstandingPlannerInput['evidence'][number]): string {
  const quoted = fact.quoted ? ` quoted as "${fact.quoted.slice(0, 160)}"` : ' (LandOS reading, not quoted)';
  return `- [${fact.factId}] ${fact.field} = ${fact.value.slice(0, 200)} · ${fact.weight} · ${fact.source.label}`
    + `${fact.source.locator ? ` · ${fact.source.locator}` : ''} · scope ${fact.parcelRelationship}${quoted}`;
}

/**
 * The one prompt. It states the job, the retained evidence, the deterministic
 * reading, and the exact JSON the loop will accept — and it says plainly that
 * the deterministic reading governs, because a model told it is the decider
 * behaves like one.
 */
export function subjectUnderstandingPrompt(input: SubjectUnderstandingPlannerInput): string {
  const settled = input.deterministicOutcome === 'research_ready';
  const capabilities = input.allowedCapabilities
    .map((id) => `  - ${id}: ${CAPABILITY_NOTES[id] ?? 'an authorized evidence check'}`)
    .join('\n');
  return [
    'You are the LandOS Deal Manager reviewing one New Lead subject decision.',
    '',
    'The question is only: WHICH PARCEL is this lead about? Not what it is worth,',
    'not what the market does, not how to negotiate it. Those are other seats.',
    '',
    `Deal Card: ${input.dealCardId}`,
    `LandOS deterministic reading of the retained evidence: ${input.deterministicOutcome}`,
    `Evidence checks remaining: ${input.actionsRemaining}`,
    '',
    'Retained evidence:',
    ...input.evidence.slice(0, 80).map(factLine),
    '',
    input.candidates.length > 0
      ? `Candidate parcels: ${input.candidates.map((c) => `${c.candidateId} = ${c.subject.apn ?? c.subject.lpPropertyId ?? 'unnamed'} (${c.distinguishedBy})`).join(' | ')}`
      : 'Candidate parcels: none derived.',
    input.conflicts.length > 0
      ? `Conflicts: ${input.conflicts.map((c) => `${c.field} ${c.material ? '(material)' : ''} ${c.resolution}`).join(' | ')}`
      : 'Conflicts: none.',
    input.excludedParcels.length > 0
      ? `Parcels the evidence names that are NOT the subject: ${input.excludedParcels.map((p) => p.identifier).join(', ')}`
      : 'No excluded parcels.',
    input.checksAlreadyRun.length > 0
      ? `Checks already spent this run: ${input.checksAlreadyRun.map((c) => c.capabilityId).join(', ')}. Do not repeat one.`
      : 'No checks have been spent this run.',
    '',
    'Authorized evidence checks (nothing else exists for you):',
    capabilities,
    '',
    settled
      ? 'The retained evidence already establishes one parcel with its jurisdiction. This is a REVIEW turn: '
        + 'confirm the reading or state your objection. Set nextCheck to null — no evidence check is authorized '
        + 'on a settled reading, and requesting one will be refused and recorded.'
      : 'The retained evidence has not settled the parcel. Ask for at most ONE evidence check that would settle it, '
        + 'or set nextCheck to null and supply exactly one precise question for the operator.',
    '',
    'Rules that are not negotiable:',
    '- An address that geocoded is not a parcel. Coordinates, map pins and proximity never identify one.',
    '- Facts about a neighbouring, parent or retained parcel are never facts about this subject.',
    '- Research-grade identity is not official, title or legal verification. Do not claim one as the other.',
    '- Exactly one question, or none. Never a compound question.',
    '',
    'Reply with JSON only, no prose around it, exactly this shape:',
    '{',
    '  "reading": "one or two sentences on what this evidence establishes",',
    '  "nextCheck": null,',
    '  "proposedOutcome": "research_ready" | "candidate_set" | "needs_targeted_input" | null,',
    '  "question": null',
    '}',
    'To request a check instead, set nextCheck to',
    '{ "capabilityId": "<one of the authorized ids>", "reason": "what it would settle" }.',
    'To ask the operator, set question to',
    '{ "question": "...", "why": "...", "unblocks": "...", "acceptableAnswers": ["..."] }.',
  ].join('\n');
}

export interface SubjectUnderstandingPlannerBinding {
  planner: SubjectUnderstandingPlanner;
  /** Live provenance, updated after each turn. Read at the end of the run. */
  provenance: SubjectReasoningProvenance;
}

export interface SubjectPlannerDeps extends HermesAnalystDeps {
  /** Injected in tests so nothing spawns. */
  invoke?: (args: string[], timeoutMs: number, signal?: AbortSignal) => Promise<string>;
  profile?: string;
  timeoutMs?: number;
}

/**
 * Bind the production planner, or return null when the specialist profile is
 * not provisioned on this machine.
 *
 * Null is not a failure: the loop already runs deterministically without a
 * planner, and the audit records `planner_unavailable` rather than pretending a
 * reasoning turn happened.
 */
export function createSubjectUnderstandingPlanner(
  deps: SubjectPlannerDeps = {},
): SubjectUnderstandingPlannerBinding | null {
  const profile = deps.profile ?? SUBJECT_UNDERSTANDING_PROFILE;
  const invoke = deps.invoke ?? invokeHermesCli;
  if (!deps.invoke && !hermesProfileProvisioned(profile)) return null;

  const model = deps.settings ? resolveAnalystModel(undefined, deps.settings) : resolveAnalystModel();
  const timeoutMs = deps.timeoutMs ?? Math.min(SUBJECT_UNDERSTANDING_REASONING_TIMEOUT_MS, ANALYST_JUDGMENT_TIMEOUT_MS);
  const now = deps.now ?? (() => Date.now());

  const provenance: SubjectReasoningProvenance = {
    bound: true,
    engine: SPECIALIST_ENGINE,
    transport: SPECIALIST_TRANSPORT,
    profile,
    provider: model.provider,
    model: model.model,
    toolsets: ANALYST_TOOLSETS,
    allowedCapabilities: [...SUBJECT_UNDERSTANDING_ALLOWED_CAPABILITIES],
    turns: 0,
    durationMs: 0,
    // The one-shot transport reports no token accounting; saying so beats
    // inventing a number the provider path never produced.
    usage: null,
  };

  const planner: SubjectUnderstandingPlanner = async (input) => {
    const startedAt = now();
    try {
      return await invoke(
        specialistInvocationArgs({ profile, prompt: subjectUnderstandingPrompt(input), model }),
        timeoutMs,
      );
    } finally {
      provenance.turns += 1;
      provenance.durationMs += Math.max(0, now() - startedAt);
    }
  };

  return { planner, provenance };
}
