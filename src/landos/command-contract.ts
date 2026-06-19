// LandOS Command — normalized request contract, operator output shape, and
// deterministic routing v1.
//
// LandOS Command is the only orchestrator. This module is the operator-FACING
// surface: it takes a normalized request (typed/voice/file/automation/external),
// classifies a lightweight intent deterministically, selects department legs,
// and returns a BUSINESS-FIRST response with technical detail kept separable.
//
// This is intentionally distinct from intake-planner.ts. The intake planner
// produces the deep WorkerDispatchPlan (the technical worker lanes). This module
// produces the thin operator-facing routing/summary on top of the LandOS
// structure. Routing v1 is deterministic keyword/input-shape rules, not an AI
// classifier. No DB, no network, no secrets.

import {
  DEPARTMENT_LEGS,
  getDepartmentLeg,
  THE_ORCHESTRATOR_ID,
  type DepartmentLeg,
} from './landos-structure.js';

// Re-export so callers of the command surface get the single orchestrator id
// without reaching into the structure module.
export { THE_ORCHESTRATOR_ID } from './landos-structure.js';

// ───────────────────────────────────────────────────────────────────────────
// Normalized request contract
// ───────────────────────────────────────────────────────────────────────────

export const INPUT_MODES = ['typed', 'voice', 'uploaded_file', 'automation', 'external_event'] as const;
export type InputMode = (typeof INPUT_MODES)[number];

export const SOURCE_SURFACES = ['dashboard', 'war_room', 'voice', 'telegram', 'api', 'future'] as const;
export type SourceSurface = (typeof SOURCE_SURFACES)[number];

export const RESPONSE_MODES = ['dashboard', 'voice', 'both', 'report', 'draft'] as const;
export type ResponseMode = (typeof RESPONSE_MODES)[number];

export interface LandOSCommandRequest {
  inputText: string;
  inputMode: InputMode;
  sourceSurface: SourceSurface;
  targetDealCardId?: number;
  /** Departments the user explicitly named, if any. */
  requestedDepartments?: string[];
  responseMode?: ResponseMode;
  /** Free-form operator context (display only). */
  operatorContext?: string;
  attachments?: Array<{ name: string; kind: string }>;
  /** Whether this request is already tied to a known deal. */
  currentDealContext?: { dealCardId?: number; address?: string };
}

// ───────────────────────────────────────────────────────────────────────────
// Intent classification (deterministic, lightweight)
// ───────────────────────────────────────────────────────────────────────────

export const COMMAND_INTENTS = [
  'property_intake',
  'seller_follow_up',
  'build_agent',
  'deal_next_step',
  'manufactured_home_market',
  'county_growth_plan',
  'market_question',
  'general',
] as const;
export type CommandIntent = (typeof COMMAND_INTENTS)[number];

const STREET_SUFFIX = /\b(st|street|rd|road|ave|avenue|ln|lane|dr|drive|hwy|highway|blvd|ct|court|way|pl|place|cir|circle|trail|trl|pike|route|rt)\b/i;
const APN_LIKE = /\b\d{2,4}[-\s]?\d{2,4}[-\s]?\d{2,4}([-\s]?\d{1,4})?\b/;
const LP_URL = /landportal|land\s*portal/i;

function matchIntent(text: string): { intent: CommandIntent; matched: string[] } {
  const t = text.toLowerCase();
  const matched: string[] = [];
  const has = (re: RegExp, tag: string) => {
    if (re.test(text)) { matched.push(tag); return true; }
    return false;
  };

  // Build-agent first: explicit builder/repair language.
  if (/\b(build|create)\b.*\b(agent|workflow|leg|department)\b/i.test(text) ||
      /\bforge\b/i.test(text) ||
      /\b(fix|debug|repair)\b.*\b(bug|agent|workflow|error)\b/i.test(text)) {
    matched.push('build_agent_language');
    return { intent: 'build_agent', matched };
  }

  // Manufactured/mobile home market question (a market sub-intent).
  if (/\b(manufactured|mobile)\s*home(s)?\b/i.test(text) && /\b(market|demand|sell|buyer)/i.test(text)) {
    matched.push('manufactured_home_market');
    return { intent: 'manufactured_home_market', matched };
  }

  // County growth-plan strategy question (a market sub-intent).
  if (/\bgrowth\s*plan(s)?\b/i.test(text) || (/\bcounty\b/i.test(text) && /\b(growth|develop|zoning\s*plan|comprehensive\s*plan)\b/i.test(text))) {
    matched.push('county_growth_plan');
    return { intent: 'county_growth_plan', matched };
  }

  // Seller follow-up.
  if (/\bseller\b/i.test(text) && /\b(follow\s*up|call\s*back|callback|next\s*step|said|offer|respond|reply)\b/i.test(text)) {
    matched.push('seller_follow_up');
    return { intent: 'seller_follow_up', matched };
  }

  // Property intake: parcel identity shape.
  if (has(LP_URL, 'landportal_url') || has(APN_LIKE, 'apn_like') ||
      (STREET_SUFFIX.test(text) && /\d/.test(text)) ||
      /\bparcel\b|\bapn\b|\bdue\s*diligence\b/i.test(text)) {
    if (STREET_SUFFIX.test(text)) matched.push('street_suffix');
    matched.push('property_identity_shape');
    return { intent: 'property_intake', matched };
  }

  // Deal next-step.
  if (/\bnext\s*step\b|\bwhat\s*(should|do)\s*we\s*do\b|\bwhat'?s\s*next\b/i.test(text) &&
      /\bdeal\b|\bthis\s*(one|property|lot|parcel)\b/i.test(text)) {
    matched.push('deal_next_step');
    return { intent: 'deal_next_step', matched };
  }

  // General market question.
  if (/\bmarket\b|\bdemand\b|\bbuyer(s)?\b/i.test(t)) {
    matched.push('market_question');
    return { intent: 'market_question', matched };
  }

  matched.push('no_specific_signal');
  return { intent: 'general', matched };
}

// ───────────────────────────────────────────────────────────────────────────
// Operator output shape (business-first; technical detail separable)
// ───────────────────────────────────────────────────────────────────────────

export interface DepartmentSelection {
  department: string;
  reason: string;
}

export interface LandOSCommandResponse {
  requestSummary: string;
  detectedIntent: CommandIntent;
  /** Department leg ids selected. */
  selectedDepartments: string[];
  /** Shared records/surfaces also targeted (e.g. deal-cards, landos-command). */
  sharedTargets: string[];
  /** Convenience: every target touched (legs + shared). */
  allTargets: string[];
  whyEachDepartmentWasSelected: DepartmentSelection[];
  /** Legs that can run at the same time, grouped. */
  parallelGroups: string[][];
  sequencingNotes: string;
  blockedOrApprovalNeededItems: string[];
  operatorNextAction: string;
  operatorFacingSummary: string;
  /** Developer/trace detail — collapsible, never the main surface. */
  technicalDetails: {
    matchedSignals: string[];
    inputMode: InputMode;
    sourceSurface: SourceSurface;
    responseMode: ResponseMode;
    routedThrough: typeof THE_ORCHESTRATOR_ID;
    legStatuses: Array<{ id: string; status: DepartmentLeg['status'] }>;
  };
}

// Intent -> (legs, shared targets). deal-cards is a shared record; landos-command
// is the shared orchestrator surface. These mirror the sprint's example routes.
const INTENT_ROUTES: Record<CommandIntent, { legs: string[]; shared: string[] }> = {
  property_intake:          { legs: ['due-diligence-research', 'market-research', 'strategy'], shared: ['deal-cards'] },
  seller_follow_up:         { legs: ['crm-acquisition-ghl', 'strategy'],                       shared: ['deal-cards'] },
  build_agent:              { legs: ['forge'],                                                  shared: [THE_ORCHESTRATOR_ID] },
  deal_next_step:           { legs: ['strategy', 'due-diligence-research'],                     shared: ['deal-cards'] },
  manufactured_home_market: { legs: ['market-research', 'strategy'],                            shared: [] },
  county_growth_plan:       { legs: ['market-research', 'strategy', 'due-diligence-research'],  shared: [] },
  market_question:          { legs: ['market-research', 'strategy'],                            shared: [] },
  general:                  { legs: [],                                                         shared: [THE_ORCHESTRATOR_ID] },
};

function reasonForLeg(intent: CommandIntent, legId: string): string {
  const leg = getDepartmentLeg(legId);
  const name = leg?.displayName ?? legId;
  switch (intent) {
    case 'property_intake':
      if (legId === 'due-diligence-research') return `${name}: property identity present, run parcel research/verification.`;
      if (legId === 'market-research') return `${name}: gather area market context alongside parcel research.`;
      if (legId === 'strategy') return `${name}: prepare strategy once verified facts exist (blocked until verified).`;
      break;
    case 'seller_follow_up':
      if (legId === 'crm-acquisition-ghl') return `${name}: seller communication/follow-up context (GHL not connected; summary from Deal Card only).`;
      if (legId === 'strategy') return `${name}: frame next step / offer readiness for the follow-up.`;
      break;
    case 'build_agent':
      return `${name}: build/repair request handled by the builder leg.`;
    case 'deal_next_step':
      if (legId === 'strategy') return `${name}: determine the recommended next step for the deal.`;
      if (legId === 'due-diligence-research') return `${name}: surface any open data gaps blocking the next step.`;
      break;
    case 'manufactured_home_market':
    case 'market_question':
      if (legId === 'market-research') return `${name}: market-level question, area demand/context.`;
      if (legId === 'strategy') return `${name}: translate market context into strategy implications.`;
      break;
    case 'county_growth_plan':
      if (legId === 'market-research') return `${name}: county growth-plan / area context.`;
      if (legId === 'strategy') return `${name}: strategy implications of growth plans.`;
      if (legId === 'due-diligence-research') return `${name}: confirm parcel-level facts the growth plan affects.`;
      break;
    case 'general':
      break;
  }
  return `${name}: selected for ${intent}.`;
}

/**
 * Deterministic LandOS Command routing v1. Always routes through landos-command
 * (the only orchestrator). Honors explicitly requested departments by adding
 * them. Returns a business-first operator response with separable technical
 * detail. No execution, no DB writes — a routing/summary plan only.
 */
export function routeCommand(req: LandOSCommandRequest): LandOSCommandResponse {
  const text = (req.inputText ?? '').trim();
  const { intent, matched } = matchIntent(text);
  const route = INTENT_ROUTES[intent];

  // Selected legs = intent legs + any explicitly requested valid legs.
  const legSet = new Set<string>(route.legs);
  for (const r of req.requestedDepartments ?? []) {
    if (getDepartmentLeg(r)) legSet.add(r);
  }
  const selectedDepartments = [...legSet];
  const sharedTargets = [...route.shared];
  // Any leg with deal-card write permission implies the deal-cards record is touched.
  if (selectedDepartments.some((id) => (getDepartmentLeg(id)?.dealCardWritePermissions.length ?? 0) > 0) &&
      !sharedTargets.includes('deal-cards')) {
    sharedTargets.push('deal-cards');
  }

  const whyEachDepartmentWasSelected: DepartmentSelection[] = selectedDepartments.map((id) => ({
    department: id,
    reason: reasonForLeg(intent, id),
  }));

  // Parallel grouping: legs that can run in parallel go in one group; deal-card
  // writes are sequenced after the producing legs.
  const parallelLegs = selectedDepartments.filter((id) => getDepartmentLeg(id)?.canRunParallel);
  const serialLegs = selectedDepartments.filter((id) => !getDepartmentLeg(id)?.canRunParallel);
  const parallelGroups: string[][] = [];
  if (parallelLegs.length) parallelGroups.push(parallelLegs);
  for (const s of serialLegs) parallelGroups.push([s]);

  // Blocked / approval-needed items from leg status + approval requirements.
  const blocked: string[] = [];
  for (const id of selectedDepartments) {
    const leg = getDepartmentLeg(id);
    if (!leg) continue;
    if (leg.id === 'crm-acquisition-ghl') blocked.push('CRM/Acquisition/GHL: GHL is not connected; no external CRM action this sprint.');
    else if (leg.status === 'planned') blocked.push(`${leg.displayName}: planned shell — represented, not yet operational.`);
    else if (leg.status === 'shell') blocked.push(`${leg.displayName}: shell leg — limited until built out.`);
    if (leg.id === 'strategy') blocked.push('Strategy: blocked until parcel identity is verified.');
  }

  const responseMode: ResponseMode = req.responseMode ?? (req.inputMode === 'voice' ? 'both' : 'dashboard');

  const requestSummary = summarize(text);
  const operatorFacingSummary = buildOperatorSummary(intent, selectedDepartments, sharedTargets);
  const operatorNextAction = buildNextAction(intent, selectedDepartments);

  const allTargets = [...selectedDepartments, ...sharedTargets];

  return {
    requestSummary,
    detectedIntent: intent,
    selectedDepartments,
    sharedTargets,
    allTargets,
    whyEachDepartmentWasSelected,
    parallelGroups,
    sequencingNotes:
      sharedTargets.includes('deal-cards')
        ? 'Department legs run first (parallel where possible); Deal Card writes are sequenced after their producing legs.'
        : 'Selected legs run in parallel where possible; no Deal Card write sequenced this route.',
    blockedOrApprovalNeededItems: [...new Set(blocked)],
    operatorNextAction,
    operatorFacingSummary,
    technicalDetails: {
      matchedSignals: matched,
      inputMode: req.inputMode,
      sourceSurface: req.sourceSurface,
      responseMode,
      routedThrough: THE_ORCHESTRATOR_ID,
      legStatuses: selectedDepartments.map((id) => ({ id, status: getDepartmentLeg(id)!.status })),
    },
  };
}

function summarize(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'Empty request.';
  return clean.length > 140 ? clean.slice(0, 137) + '...' : clean;
}

function buildOperatorSummary(intent: CommandIntent, legs: string[], shared: string[]): string {
  const names = legs.map((id) => getDepartmentLeg(id)?.displayName ?? id);
  const touchesDeal = shared.includes('deal-cards');
  switch (intent) {
    case 'property_intake':
      return `Looks like a property. I'll route it to ${names.join(', ')}${touchesDeal ? ' and open/attach a Deal Card' : ''}. Strategy stays blocked until the parcel is verified.`;
    case 'seller_follow_up':
      return `Seller follow-up. I'll pull the Deal Card context and frame the next step. GHL isn't connected, so this is summary-only from the Deal Card.`;
    case 'build_agent':
      return `Build/repair request. Routing to Forge through LandOS Command.`;
    case 'deal_next_step':
      return `I'll work out the next step on this deal with ${names.join(', ')} and update the Deal Card.`;
    case 'manufactured_home_market':
    case 'market_question':
      return `Market question. Routing to ${names.join(', ')} for area context and strategy implications.`;
    case 'county_growth_plan':
      return `County growth-plan question. Routing to ${names.join(', ')}.`;
    case 'general':
    default:
      return `No specific deal/department signal detected. Handling at LandOS Command. Tell me a property, a seller, a market, or a build task to route it.`;
  }
}

function buildNextAction(intent: CommandIntent, legs: string[]): string {
  switch (intent) {
    case 'property_intake':
      return 'Confirm parcel identity (address/APN+county/LP id) so Due Diligence can verify before any scoring or offer.';
    case 'seller_follow_up':
      return 'Review the Deal Card communication summary and confirm the follow-up message before anything is sent.';
    case 'build_agent':
      return 'Scope the build/repair task for Forge (approval required before commit/push/delete).';
    case 'deal_next_step':
      return 'Review the recommended next step and any blocking data gaps.';
    case 'manufactured_home_market':
    case 'county_growth_plan':
    case 'market_question':
      return 'Review area market context; note no approved market adapter is connected, so nothing is fabricated.';
    case 'general':
    default:
      return 'Provide a property, seller, market, or build request to route.';
  }
}

/** All department leg ids known to the router (for callers/tests). */
export const ROUTABLE_LEG_IDS: readonly string[] = DEPARTMENT_LEGS.map((l) => l.id);
