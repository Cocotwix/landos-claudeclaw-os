// LandOS — Smart Intake supervisor.
//
// The conversational front door on an EXISTING Deal Card. The operator talks in
// their own words ("they own three adjoining parcels, the home is on the middle
// one, we are buying the vacant one on the left, use the LandPortal link I gave
// you"); this module hands the model that message together with the REAL
// structured state of the run, and gets back two things:
//
//   1. a plain-English account of what actually happened, and
//   2. which EXISTING capability steps should run next.
//
// What this module deliberately is NOT:
//   • It is not an agent framework. It composes `buildSmartIntake` (deterministic
//     parsing), the persisted Property Resolution facts, and the existing model
//     helper. It owns no workflow of its own.
//   • It never creates canonical property facts. The operator's message is stored
//     as guidance through the existing Deal Brain guidance store, whose whole
//     doctrine is that guidance is an input and never evidence. The model is
//     given the failure data and asked to EXPLAIN it, never to assert it.
//   • It never invents a workflow. The plan it may return is closed: a step the
//     model names that is not an existing registered capability is dropped, and
//     an empty plan is a valid, honest answer.
//
// The value is that a failed run stops being "UNRESOLVED / 0 of 18" and becomes
// a sentence the operator can act on, plus the smallest set of already-built
// steps that would actually move the run forward.

import { generateContent } from '../gemini.js';
import { buildSmartIntake, type SmartIntake } from './smart-intake.js';
import { appendDealBrainGuidance, listDealBrainGuidance, type DealBrainGuidanceEntry } from './deal-brain-guidance.js';
import { CapabilityInvocationStore } from './capability-store.js';
import { PROPERTY_RESOLUTION_CAPABILITY_ID } from './property-resolution-capability.js';
import { LANDPORTAL_RESEARCH_CAPABILITY_ID } from './landportal-research-capability.js';
import { LANDPORTAL_PROPERTY_CHARACTERISTICS_CAPABILITY_ID } from './landportal-property-characteristics-capability.js';
import { LANDPORTAL_VISUAL_CAPTURE_CAPABILITY_ID } from './landportal-visual-capture-capability.js';
import { COMPS_VALUATION_CAPABILITY_ID } from './comps-valuation-capability.js';
import { ZONING_SUBDIVISION_CAPABILITY_ID } from './zoning-subdivision-capability.js';
import { operatorLandPortalEntryUrl, isVerifiedLandPortalSubjectUrl } from './landportal-operating-rules.js';
import { getPropertyCardRow } from './property-card.js';
import { listIntakeLinks, recordIntakeLinks, type IntakeLinkRecord } from './intake-links.js';
import { listLeadCardIntake } from './lead-card-intake.js';
import { logger } from '../logger.js';

/**
 * The ONLY steps the supervisor may schedule. Every entry is a capability that
 * already exists and already carries its own verification. The model chooses
 * among these; it cannot name anything else, and it cannot invent parameters.
 */
export const SUPERVISOR_STEPS = [
  PROPERTY_RESOLUTION_CAPABILITY_ID,
  LANDPORTAL_RESEARCH_CAPABILITY_ID,
  LANDPORTAL_PROPERTY_CHARACTERISTICS_CAPABILITY_ID,
  LANDPORTAL_VISUAL_CAPTURE_CAPABILITY_ID,
  COMPS_VALUATION_CAPABILITY_ID,
  ZONING_SUBDIVISION_CAPABILITY_ID,
] as const;
export type SupervisorStep = (typeof SUPERVISOR_STEPS)[number];

const STEP_SET: ReadonlySet<string> = new Set<string>(SUPERVISOR_STEPS);

/**
 * The model this lane talks to.
 *
 * `generateContent`'s own default is still the retired `gemini-2.0-flash`, which
 * now answers 404 ("no longer available"). Every other live lane here already
 * pins the probed replacement behind its own env override rather than changing
 * that shared default, so this follows the same shape: an operator can repoint
 * one lane without touching the others.
 */
export const SUPERVISOR_MODEL = process.env.SMART_INTAKE_MODEL || 'gemini-3-flash-preview';

/** What the run actually looks like right now. Every field is READ from what the
 *  system already persisted; nothing here is inferred or asserted. */
export interface SupervisorEvidence {
  dealCardId: number;
  propertyCardId: number | null;
  /** Persisted Property Resolution outcome, or null when it never ran. */
  resolution: {
    status: string;
    identityState: string | null;
    identityBasis: string | null;
    canonicalApn: string | null;
    candidates: Array<Record<string, unknown>>;
    lanes: Array<Record<string, unknown>>;
    warnings: string[];
    missingInformation: string[];
  } | null;
  /** The subject hint the operator supplied, and whether it carries identity. */
  landPortal: {
    url: string | null;
    openable: boolean;
    carriesParcelIdentity: boolean;
  };
  /** Deterministic reading of everything the operator has said on this deal. */
  smartIntake: SmartIntake;
  /** The operator conversation so far, oldest first. */
  thread: DealBrainGuidanceEntry[];
  /**
   * Everything the operator ATTACHED, as opposed to typed: links and files.
   *
   * These are read from the immutable intake record, so the supervisor can
   * account for a supplied artifact even when no lane has managed to use it yet.
   * "You gave me a link and nothing opened it" is a true and useful answer; the
   * failure mode this replaces was staying silent about it entirely.
   */
  artifacts: {
    links: IntakeLinkRecord[];
    files: Array<{ name: string; mimeType: string; extractionStatus: string; note: string }>;
  };
}

/** The supervisor's answer. `steps` may be empty: "I need something from you
 *  first" is a complete and correct plan. */
export interface SupervisorPlan {
  /** Plain-English account of what happened, grounded in the evidence given. */
  explanation: string;
  /** What the operator could supply that would unblock the run. */
  needFromOperator: string[];
  /** Existing capability steps to run next, in order. Always a subset of
   *  SUPERVISOR_STEPS; anything else the model named is dropped. */
  steps: SupervisorStep[];
  /** Why those steps and not a full rerun. */
  reasoning: string;
  /** Steps the model named that do not exist. Kept for honesty in the log. */
  rejectedSteps: string[];
}

function str(value: unknown): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  return s.length ? s : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => str(v)).filter((v): v is string => v !== null).slice(0, 12);
}

/**
 * Read the real state of the run. Pure reads against what the system already
 * stored: the persisted capability result, the property card, and the operator
 * conversation. No provider is called and nothing is recomputed.
 */
export function buildSupervisorEvidence(
  dealCardId: number,
  propertyCardId: number | null,
  operatorText: string,
  deps: {
    store?: CapabilityInvocationStore;
    readCard?: typeof getPropertyCardRow;
    readThread?: typeof listDealBrainGuidance;
  } = {},
): SupervisorEvidence {
  const store = deps.store ?? new CapabilityInvocationStore();
  const readCard = deps.readCard ?? getPropertyCardRow;
  const readThread = deps.readThread ?? listDealBrainGuidance;

  const thread = (() => {
    try { return readThread(dealCardId); } catch { return []; }
  })();

  // Everything the operator has ever said on this deal, plus what they just
  // said, read deterministically. The latest message never erases earlier ones.
  const combined = [...thread.filter((t) => t.role === 'operator').map((t) => t.text), operatorText]
    .filter((t) => typeof t === 'string' && t.trim().length > 0)
    .join('\n');
  const smartIntake = buildSmartIntake(combined);

  const latest = propertyCardId == null
    ? null
    : (() => {
        try { return store.latestForProperty(propertyCardId, dealCardId); } catch { return null; }
      })();

  const facts = (latest?.facts ?? {}) as Record<string, unknown>;
  const resolution = latest
    ? {
        status: String(latest.status ?? 'UNKNOWN'),
        identityState: str(facts.identityState),
        identityBasis: str(facts.identityBasis),
        canonicalApn: str((facts.canonicalIdentity as Record<string, unknown> | undefined)?.apn),
        candidates: Array.isArray(facts.candidates) ? (facts.candidates as Array<Record<string, unknown>>).slice(0, 8) : [],
        lanes: Array.isArray(facts.lanes) ? (facts.lanes as Array<Record<string, unknown>>).slice(0, 16) : [],
        warnings: stringList(latest.warnings),
        missingInformation: stringList(latest.missingInformation),
      }
    : null;

  const cardUrl = propertyCardId == null ? null : str(readCard(propertyCardId)?.lp_url);
  // The immutable intake record answers "what did the operator give us" even
  // after a research lane has overwritten the card's own link column.
  const links = (() => {
    try { return listIntakeLinks(dealCardId); } catch { return [] as IntakeLinkRecord[]; }
  })();
  const suppliedLandPortalLink = [...links].reverse()
    .find((link) => operatorLandPortalEntryUrl(link.url) !== null)?.url ?? null;
  const supplied = suppliedLandPortalLink ?? cardUrl ?? smartIntake.fields.lpUrl ?? null;

  const files = (() => {
    try {
      return listLeadCardIntake(dealCardId).flatMap((submission) =>
        ((submission.artifacts as Array<Record<string, unknown>>) ?? []).map((artifact) => ({
          name: String(artifact.originalFileName ?? 'attachment'),
          mimeType: String(artifact.mimeType ?? 'unknown'),
          extractionStatus: String(artifact.extractionStatus ?? 'unavailable'),
          note: String(artifact.exactExtractedText ?? '').slice(0, 400),
        })));
    } catch { return []; }
  })();

  return {
    dealCardId,
    propertyCardId,
    resolution,
    landPortal: {
      url: supplied,
      openable: operatorLandPortalEntryUrl(supplied) !== null,
      carriesParcelIdentity: isVerifiedLandPortalSubjectUrl(supplied),
    },
    smartIntake,
    thread,
    artifacts: { links, files },
  };
}

/**
 * The prompt. It hands over the real failure data and constrains the model to
 * explaining it. The two hard rules exist because this model output is shown to
 * the operator next to verified data: it may not assert a property fact, and it
 * may not name a workflow that does not exist.
 */
export function supervisorPrompt(evidence: SupervisorEvidence, operatorText: string): string {
  const r = evidence.resolution;
  return [
    'You are the Smart Intake supervisor for LandOS, a land acquisition system.',
    'The operator is talking to you about one deal that is already in progress.',
    '',
    'YOUR JOB:',
    '1. Explain, in plain English, what the run actually did and why it is where it is.',
    '2. Say what you need from the operator, if anything.',
    '3. Choose which existing steps should run next.',
    '',
    'HARD RULES:',
    '- You do NOT establish property facts. Never state an APN, acreage, owner, or',
    '  boundary as fact. Facts come only from the verification steps below.',
    '- The operator\'s statements are GUIDANCE, not evidence. Say "you told me" when',
    '  you use them. Never promote them to confirmed.',
    '- Explain ONLY from the evidence below. If something is not there, say you do',
    '  not know it. Do not guess at a cause.',
    '- Do not schedule a full rerun of work that already succeeded. Choose the',
    '  smallest set of steps that would move this forward.',
    '',
    `STEPS YOU MAY CHOOSE (exact ids only): ${SUPERVISOR_STEPS.join(', ')}`,
    '',
    '── WHAT THE OPERATOR JUST SAID ──',
    operatorText || '(nothing new)',
    '',
    '── WHAT WE PARSED FROM EVERYTHING THEY HAVE SAID (deterministic) ──',
    `Identity confidence: ${evidence.smartIntake.confidence.label} (${evidence.smartIntake.confidence.percent}%)`,
    `Reasons: ${evidence.smartIntake.confidence.reasons.join(' | ')}`,
    `Parsed fields: ${JSON.stringify(evidence.smartIntake.fields)}`,
    '',
    '── LANDPORTAL LINK THE OPERATOR SUPPLIED ──',
    evidence.landPortal.url
      ? [
          `URL: ${evidence.landPortal.url}`,
          `Can be opened directly as the entry point: ${evidence.landPortal.openable ? 'yes' : 'no'}`,
          `Carries decodable parcel identity on its own: ${evidence.landPortal.carriesParcelIdentity ? 'yes' : 'no'}`,
          evidence.landPortal.openable && !evidence.landPortal.carriesParcelIdentity
            ? 'Meaning: this is a saved map view. We can open it and start there instead of searching, but the parcel it lands on still has to be verified.'
            : '',
        ].filter(Boolean).join('\n')
      : 'None supplied.',
    '',
    '── WHAT THE OPERATOR ATTACHED (kept exactly as supplied) ──',
    evidence.artifacts.links.length || evidence.artifacts.files.length
      ? [
          ...evidence.artifacts.links.map((link) =>
            `LINK ${link.url}\n  read as: ${link.classification}${link.capability ? ` → handled by the ${link.capability} capability` : ' → no specialized path; general browser + your own reading'}\n  ${link.note}`),
          ...evidence.artifacts.files.map((file) =>
            `FILE ${file.name} (${file.mimeType}) — reading: ${file.extractionStatus}${file.note ? `\n  what was read: ${file.note}` : ''}`),
        ].join('\n')
      : 'Nothing attached.',
    'These were supplied for a reason. If one has not been used yet, say so plainly',
    'and say what using it would take. Never treat an attachment as a property fact:',
    'a link is somewhere to look, and a file is something that was read.',
    '',
    '── PROPERTY RESOLUTION: WHAT ACTUALLY HAPPENED ──',
    r
      ? [
          `Outcome: ${r.status}`,
          `Identity state: ${r.identityState ?? 'unknown'}`,
          `System's own stated basis: ${r.identityBasis ?? 'none recorded'}`,
          `Canonical APN reached: ${r.canonicalApn ?? 'none'}`,
          `Candidate parcels considered (${r.candidates.length}): ${JSON.stringify(r.candidates)}`,
          `Retrieval lanes and their status: ${JSON.stringify(r.lanes)}`,
          `Warnings and conflicts: ${r.warnings.length ? r.warnings.join(' | ') : 'none'}`,
          `Information the system says is missing: ${r.missingInformation.length ? r.missingInformation.join(' | ') : 'none recorded'}`,
        ].join('\n')
      : 'Property Resolution has not produced a stored result for this deal yet.',
    '',
    '── CONVERSATION SO FAR ──',
    evidence.thread.length
      ? evidence.thread.map((t) => `${t.role === 'operator' ? 'Operator' : 'LandOS'}: ${t.text}`).join('\n')
      : '(this is the first message)',
    '',
    'Reply with ONLY a JSON object, no markdown fence:',
    '{',
    '  "explanation": "plain English, 2-5 sentences, addressed to the operator as you",',
    '  "needFromOperator": ["specific things that would unblock this"],',
    '  "steps": ["exact capability ids from the allowed list, in run order"],',
    '  "reasoning": "one or two sentences on why those steps and not a full rerun"',
    '}',
  ].join('\n');
}

/**
 * Parse the model's answer into a plan we are willing to act on.
 *
 * Anything the model named that is not a real capability is dropped into
 * `rejectedSteps` rather than silently ignored, so a model that starts inventing
 * workflows is visible in the log instead of quietly shaping the run.
 */
export function parseSupervisorPlan(raw: string): SupervisorPlan {
  const text = String(raw ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let parsed: Record<string, unknown> = {};
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    parsed = start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : {};
  } catch {
    parsed = {};
  }

  const named = stringList(parsed.steps);
  const steps: SupervisorStep[] = [];
  const rejectedSteps: string[] = [];
  for (const step of named) {
    if (STEP_SET.has(step)) {
      if (!steps.includes(step as SupervisorStep)) steps.push(step as SupervisorStep);
    } else {
      rejectedSteps.push(step);
    }
  }

  return {
    explanation: str(parsed.explanation)
      ?? 'I could not put together an explanation for this run. The structured result is on the Deal Card.',
    needFromOperator: stringList(parsed.needFromOperator),
    steps,
    reasoning: str(parsed.reasoning) ?? '',
    rejectedSteps,
  };
}

export interface SupervisorRunResult {
  plan: SupervisorPlan;
  evidence: SupervisorEvidence;
  /** The stored operator turn and the stored supervisor reply. */
  operatorEntry: DealBrainGuidanceEntry | null;
  replyEntry: DealBrainGuidanceEntry | null;
}

/**
 * Run one turn of the supervisor conversation on an existing Deal Card.
 *
 * The operator's message is stored as guidance first, so it survives even if the
 * model call fails. Then the real run state is read, the model explains it, and
 * the reply is stored on the same thread. No workflow is launched from here: the
 * caller decides whether to act on `plan.steps`, which keeps scheduling in the
 * route that already owns capability invocation.
 */
export async function runSmartIntakeSupervisor(input: {
  dealCardId: number;
  propertyCardId: number | null;
  operatorText: string;
  model?: (prompt: string) => Promise<string>;
  appendGuidance?: typeof appendDealBrainGuidance;
}): Promise<SupervisorRunResult> {
  const { dealCardId, propertyCardId, operatorText } = input;
  const model = input.model ?? ((prompt: string) => generateContent(prompt, SUPERVISOR_MODEL));
  const append = input.appendGuidance ?? appendDealBrainGuidance;

  // Store the operator's words BEFORE the model runs. A failed model call must
  // never lose what the operator told us.
  let operatorEntry: DealBrainGuidanceEntry | null = null;
  if (operatorText.trim()) {
    try { operatorEntry = append(dealCardId, 'operator', operatorText); } catch (err) {
      logger.warn({ err, dealCardId }, 'smart_intake_supervisor_guidance_store_failed');
    }
    // A link pasted into the conversation is supplied evidence exactly as one
    // pasted into the form. It is filed here so it survives this turn, whatever
    // the model then does with it.
    try { recordIntakeLinks({ dealCardId, text: operatorText, source: 'operator:smart_intake_conversation' }); } catch (err) {
      logger.warn({ err, dealCardId }, 'smart_intake_supervisor_link_store_failed');
    }
  }

  const evidence = buildSupervisorEvidence(dealCardId, propertyCardId, operatorText);

  let plan: SupervisorPlan;
  try {
    plan = parseSupervisorPlan(await model(supervisorPrompt(evidence, operatorText)));
  } catch (err) {
    logger.warn({ err, dealCardId }, 'smart_intake_supervisor_model_failed');
    // An honest fallback built from the real data, so a model outage still tells
    // the operator something true instead of "FAILED".
    const r = evidence.resolution;
    plan = {
      explanation: r
        ? `I could not reach the language model to write this up, so here is the raw outcome: Property Resolution finished ${r.status}. ${r.identityBasis ?? ''}`.trim()
        : 'I could not reach the language model, and Property Resolution has no stored result for this deal yet.',
      needFromOperator: r?.missingInformation ?? [],
      steps: [],
      reasoning: 'Model unavailable; no steps scheduled without a plan.',
      rejectedSteps: [],
    };
  }

  if (plan.rejectedSteps.length) {
    logger.warn({ dealCardId, rejectedSteps: plan.rejectedSteps }, 'smart_intake_supervisor_rejected_unknown_steps');
  }

  let replyEntry: DealBrainGuidanceEntry | null = null;
  try { replyEntry = append(dealCardId, 'deal_brain', plan.explanation); } catch (err) {
    logger.warn({ err, dealCardId }, 'smart_intake_supervisor_reply_store_failed');
  }

  logger.info({
    dealCardId,
    propertyCardId,
    resolutionStatus: evidence.resolution?.status ?? null,
    landPortalOpenable: evidence.landPortal.openable,
    plannedSteps: plan.steps,
  }, 'smart_intake_supervisor_turn');

  return { plan, evidence, operatorEntry, replyEntry };
}
