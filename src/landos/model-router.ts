// LandOS Model Router and cost-control policy — pure, deterministic.
//
// Picks an abstract model TIER for a task. It does not call any model, does not
// hard-code a vendor, and never overrides a hard safety rule. The whole point
// is to stop every agent/workflow defaulting to the strongest/most expensive
// model: prefer the lowest capable tier, escalate only with a reason, and gate
// paid APIs separately from tier selection.
//
// Deterministic parsing/calculation tasks return tier 'deterministic_code'
// (NO LLM). If a required model/tool is unavailable the decision reports
// availability 'not_available' — it never fakes success.

import type {
  ModelTier,
  ModelAlias,
  ModelRoutingDecision,
  ModelRouterPolicy,
  TokenBudgetClass,
  ModelEscalationRule,
} from './intake-types.js';
import { MODEL_TIERS, MODEL_ALIASES } from './intake-types.js';

export const MODEL_ROUTER_POLICY: ModelRouterPolicy = {
  preferLowestCapableTier: true,
  deterministicUsesCode: true,
  safetyOverridesRouting: true,
  tiers: MODEL_TIERS,
  aliases: MODEL_ALIASES,
};

/** The kind of work a task is. Drives the default tier. */
export type RouterTaskType =
  | 'classification'
  | 'routing'
  | 'status_formatting'
  | 'metadata_extraction'
  | 'deterministic_parse'
  | 'deterministic_calc'
  | 'parcel_verification'
  | 'market_research'
  | 'strategy_reasoning'
  | 'underwriting_math'
  | 'seller_prep'
  | 'negotiation_strategy'
  | 'forge_diagnostics'
  | 'forge_build_planning'
  | 'ai_watcher_monitor'
  | 'finance_calc'
  | 'security_risk_analysis'
  | 'war_room_discussion'
  | 'summarization';

export interface RouterTaskInput {
  taskType: RouterTaskType;
  /** Agent/worker role driving the task (display + escalation logic). */
  role?: string;
  /** Whether the task genuinely needs web/tool browsing. */
  requiresWeb?: boolean;
  /** Whether the task needs a very large context window. */
  requiresLongContext?: boolean;
  /** Risk level of the underlying action. */
  riskLevel?: 'low' | 'medium' | 'high';
  /** Whether escalation to a stronger tier is allowed for this task. */
  escalationAllowed?: boolean;
  /** Only relevant for strategy/underwriting: are parcel facts verified? */
  parcelVerified?: boolean;
  /** Whether a higher-cost model / paid API needs Tyler approval first. */
  requiresApprovalForHigherCost?: boolean;
  /** Whether the needed model/tool is actually available right now. */
  toolAvailable?: boolean;
  /** Optional explicit token budget class. */
  budgetClass?: TokenBudgetClass;
}

const DETERMINISTIC: Set<RouterTaskType> = new Set([
  'deterministic_parse',
  'deterministic_calc',
  'underwriting_math',
  'finance_calc',
]);

const CHEAP_FAST: Set<RouterTaskType> = new Set([
  'classification',
  'routing',
  'status_formatting',
  'metadata_extraction',
  'ai_watcher_monitor',
  'summarization',
]);

function aliasForTier(tier: ModelTier): ModelAlias | undefined {
  switch (tier) {
    case 'cheap_fast':
      return 'cheap_fast';
    case 'standard_reasoning':
      return 'standard_reasoning';
    case 'strong_reasoning':
      return 'strong_reasoning';
    case 'tool_web_capable':
      return 'web_research';
    case 'local_or_open_source':
      return 'local_fallback';
    default:
      return undefined;
  }
}

function budgetForTier(tier: ModelTier): TokenBudgetClass {
  switch (tier) {
    case 'deterministic_code':
      return 'tiny';
    case 'cheap_fast':
      return 'small';
    case 'standard_reasoning':
      return 'medium';
    case 'long_context':
      return 'xlarge';
    case 'strong_reasoning':
    case 'tool_web_capable':
      return 'large';
    default:
      return 'small';
  }
}

const NO_ESCALATION: ModelEscalationRule = { allowed: false, requiresTylerApproval: false };

/**
 * Deterministically select a model routing decision for one task.
 *
 * Rules (in order):
 *   1. Hard safety: paid/higher-cost approval gating is separate and never
 *      overridden by tier selection.
 *   2. Deterministic tasks -> 'deterministic_code' (no LLM).
 *   3. Long-context requirement -> 'long_context'.
 *   4. Web/tool requirement -> 'tool_web_capable' (availability honored).
 *   5. Cheap/fast task types -> 'cheap_fast'.
 *   6. Strategy/underwriting reasoning -> 'strong_reasoning' ONLY when parcel
 *      facts are verified; otherwise 'blocked' (no expensive reasoning on an
 *      unverified parcel).
 *   7. Forge/security -> 'strong_reasoning'.
 *   8. Seller prep -> 'standard_reasoning'; negotiation strategy -> 'strong'.
 *   9. War room -> 'standard_reasoning' default.
 */
export function selectModel(input: RouterTaskInput): ModelRoutingDecision {
  const {
    taskType,
    requiresWeb = false,
    requiresLongContext = false,
    riskLevel = 'low',
    escalationAllowed = false,
    parcelVerified = false,
    requiresApprovalForHigherCost = false,
    toolAvailable = true,
  } = input;

  let tier: ModelTier = 'cheap_fast';
  let driver = 'default';
  let detail = 'No specific signal; lowest capable tier.';
  let availability: ModelRoutingDecision['availability'] = 'available';
  let escalation: ModelEscalationRule = NO_ESCALATION;
  // Paid API / web tool use is gated separately from the model tier.
  const paidApiGated = requiresWeb || requiresApprovalForHigherCost;

  if (DETERMINISTIC.has(taskType)) {
    tier = 'deterministic_code';
    driver = 'deterministic';
    detail = 'Deterministic parsing/calculation runs in code, not an LLM.';
  } else if (taskType === 'parcel_verification') {
    // Duke verifies via deterministic tools + exact sources first; an LLM tier
    // is only used to summarize/explain anomalies.
    tier = 'deterministic_code';
    driver = 'deterministic_exact_source';
    detail =
      'Parcel verification uses deterministic tools and exact sources first. ' +
      'LLM reasoning is reserved for summary/anomaly explanation only.';
  } else if (requiresLongContext) {
    tier = 'long_context';
    driver = 'long_context';
    detail = 'Task requires a large context window.';
  } else if (taskType === 'market_research' || requiresWeb) {
    tier = 'tool_web_capable';
    driver = 'web_required';
    detail = 'Task requires web/tool-capable browsing or a source adapter.';
    availability = toolAvailable ? 'available' : 'not_available';
  } else if (CHEAP_FAST.has(taskType)) {
    tier = 'cheap_fast';
    driver = 'cheap_fast_task';
    detail = 'Classification/routing/formatting/monitoring uses the cheap fast tier.';
    if (taskType === 'ai_watcher_monitor' && escalationAllowed) {
      escalation = {
        allowed: true,
        toTier: 'standard_reasoning',
        reason: 'Escalate only when a real failure is detected.',
        requiresTylerApproval: false,
      };
    }
  } else if (taskType === 'strategy_reasoning' || taskType === 'negotiation_strategy') {
    if (!parcelVerified && taskType === 'strategy_reasoning') {
      tier = 'human_approval_required';
      driver = 'blocked_unverified_parcel';
      detail = 'Parcel identity unverified: expensive strategy reasoning is blocked.';
      availability = 'blocked';
    } else {
      tier = 'strong_reasoning';
      driver = taskType === 'negotiation_strategy' ? 'complex_negotiation' : 'verified_strategy';
      detail =
        taskType === 'negotiation_strategy'
          ? 'Complex negotiation strategy warrants strong reasoning.'
          : 'Strategy reasoning on verified parcel facts warrants strong reasoning.';
    }
  } else if (taskType === 'forge_diagnostics' || taskType === 'forge_build_planning') {
    tier = 'strong_reasoning';
    driver = 'forge';
    detail = 'Forge diagnostics/build planning warrants strong reasoning (approval gates still apply).';
  } else if (taskType === 'security_risk_analysis') {
    tier = 'strong_reasoning';
    driver = 'security';
    detail = 'Security risk analysis warrants strong reasoning; secrets/destructive actions stay hard-gated.';
  } else if (taskType === 'seller_prep') {
    tier = 'standard_reasoning';
    driver = 'seller_prep';
    detail = 'Seller prep uses standard reasoning.';
    if (escalationAllowed) {
      escalation = {
        allowed: true,
        toTier: 'strong_reasoning',
        reason: 'Escalate for complex negotiation strategy only.',
        requiresTylerApproval: false,
      };
    }
  } else if (taskType === 'war_room_discussion') {
    tier = 'standard_reasoning';
    driver = 'war_room';
    detail = 'War Room defaults to standard reasoning; stronger only when Tyler opens it or the topic requires it.';
    if (escalationAllowed) {
      escalation = {
        allowed: true,
        toTier: 'strong_reasoning',
        reason: 'High-level decision support when Tyler explicitly escalates.',
        requiresTylerApproval: true,
      };
    }
  } else if (taskType === 'summarization') {
    tier = 'cheap_fast';
    driver = 'summarization';
    detail = 'Summarization uses the cheap fast tier.';
  }

  // High risk with escalation allowed gets a documented escalation path (a
  // reason is always required when escalation is taken).
  if (riskLevel === 'high' && escalationAllowed && !escalation.allowed && tier !== 'deterministic_code') {
    escalation = {
      allowed: true,
      toTier: 'strong_reasoning',
      reason: 'High-risk task: escalate to strong reasoning with a documented reason.',
      requiresTylerApproval: requiresApprovalForHigherCost,
    };
  }

  const budgetClass = input.budgetClass ?? budgetForTier(tier);

  return {
    tier,
    alias: aliasForTier(tier),
    reason: { driver, detail },
    escalation,
    tokenBudget: { budgetClass },
    costBudget: { approvalOverBudget: requiresApprovalForHigherCost },
    usageEstimate: { budgetClass },
    fallback: { fallbackTier: 'local_or_open_source', blockIfUnavailable: true },
    paidApiGated,
    availability,
  };
}
