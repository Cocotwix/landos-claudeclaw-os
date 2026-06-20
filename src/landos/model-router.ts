// LandOS model router and cost-control policy — pure, deterministic.
//
// Classifies a task by OBJECTIVE FACTS and returns a neutral ROUTE. Routes are
// neutral peers: 'task_oriented' vs 'reasoning_oriented' is the KIND of work,
// not a quality ladder, and no route implies a "better" model. It makes no live
// model call, hard-codes no vendor, and never overrides a hard safety rule.
//
// The concrete model behind a route is a SUGGESTION the user can override
// (sticky) — see model-providers.ts (suggestModelForOrientation / resolveModel).
//
// Deterministic parsing/calculation returns 'deterministic_code' (NO LLM). If a
// required tool is unavailable the decision reports availability 'not_available'
// — it never fakes success. Paid-API/web gating stays SEPARATE from the route.

import type {
  TaskRoute,
  ModelAlias,
  ModelRoutingDecision,
  ModelRouterPolicy,
  TokenBudgetClass,
  ModelEscalationRule,
} from './intake-types.js';
import { TASK_ROUTES, MODEL_ALIASES } from './intake-types.js';

export const MODEL_ROUTER_POLICY: ModelRouterPolicy = {
  preferLocalOpenSourceForTaskOriented: true,
  deterministicUsesCode: true,
  safetyOverridesRouting: true,
  suggestionsOverridable: true,
  routes: TASK_ROUTES,
  aliases: MODEL_ALIASES,
};

/** The kind of work a task is. Drives the default route. */
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
  /** Whether escalation to a different route is allowed for this task. */
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

const TASK_ORIENTED: Set<RouterTaskType> = new Set([
  'classification',
  'routing',
  'status_formatting',
  'metadata_extraction',
  'ai_watcher_monitor',
  'summarization',
]);

function aliasForRoute(route: TaskRoute, taskType: RouterTaskType): ModelAlias | undefined {
  if (taskType === 'forge_diagnostics' || taskType === 'forge_build_planning') return 'forge_diagnostics';
  switch (route) {
    case 'web_capable':
      return 'web_research';
    case 'task_oriented':
    case 'local_open_source':
      return 'local_open_source';
    default:
      return undefined;
  }
}

function budgetForRoute(route: TaskRoute): TokenBudgetClass {
  switch (route) {
    case 'deterministic_code':
      return 'tiny';
    case 'task_oriented':
    case 'local_open_source':
    case 'approval_required':
      return 'small';
    case 'long_context':
      return 'xlarge';
    case 'reasoning_oriented':
    case 'web_capable':
      return 'large';
    default:
      return 'small';
  }
}

/** A meaningful, neutral escalation terminal that NEVER no-ops into the same
 *  route: reasoning-oriented work escalates to the approval gate; everything
 *  else escalates by changing orientation to reasoning-oriented (which actually
 *  changes the candidate set). */
function escalationTargetFor(base: TaskRoute): TaskRoute {
  return base === 'reasoning_oriented' ? 'approval_required' : 'reasoning_oriented';
}

const NO_ESCALATION: ModelEscalationRule = { allowed: false, requiresTylerApproval: false };

/**
 * Deterministically select a model routing decision for one task.
 *
 * Rules (in order):
 *   1. Hard safety: paid/higher-cost approval gating is separate and never
 *      overridden by route selection.
 *   2. Deterministic tasks -> 'deterministic_code' (no LLM).
 *   3. Long-context requirement -> 'long_context'.
 *   4. Web/tool requirement -> 'web_capable' (availability honored).
 *   5. Task-oriented task types -> 'task_oriented' (local/open-source preferred).
 *   6. Strategy/negotiation -> 'reasoning_oriented' ONLY when parcel facts are
 *      verified; unverified strategy -> 'approval_required' (blocked).
 *   7. Forge/security -> 'reasoning_oriented'.
 *   8. Seller prep -> 'task_oriented' (escalates to reasoning for negotiation).
 *   9. War room -> 'reasoning_oriented' default (escalates to approval gate).
 *
 * Escalation, when taken, always carries a reason and a toRoute that DIFFERS
 * from the base route (no no-op). The concrete model behind the chosen route is
 * a facts-based suggestion the user can override.
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

  let route: TaskRoute = 'task_oriented';
  let driver = 'default';
  let detail = 'No specific signal; task-oriented routing (local/open-source preferred).';
  let availability: ModelRoutingDecision['availability'] = 'available';
  let escalation: ModelEscalationRule = NO_ESCALATION;
  // Paid API / web tool use is gated separately from the route.
  const paidApiGated = requiresWeb || requiresApprovalForHigherCost;

  if (DETERMINISTIC.has(taskType)) {
    route = 'deterministic_code';
    driver = 'deterministic';
    detail = 'Deterministic parsing/calculation runs in code, not an LLM.';
  } else if (taskType === 'parcel_verification') {
    // Duke verifies via deterministic tools + exact sources first; a model is
    // only used to summarize/explain anomalies.
    route = 'deterministic_code';
    driver = 'deterministic_exact_source';
    detail =
      'Parcel verification uses deterministic tools and exact sources first. ' +
      'Model reasoning is reserved for summary/anomaly explanation only.';
  } else if (requiresLongContext) {
    route = 'long_context';
    driver = 'long_context';
    detail = 'Task requires a large context window.';
  } else if (taskType === 'market_research' || requiresWeb) {
    route = 'web_capable';
    driver = 'web_required';
    detail = 'Task requires web/tool-capable browsing or a source adapter.';
    availability = toolAvailable ? 'available' : 'not_available';
  } else if (TASK_ORIENTED.has(taskType)) {
    route = 'task_oriented';
    driver = 'task_oriented';
    detail = 'Execution work (classification/routing/formatting/monitoring/summarizing): task-oriented routing, local/open-source preferred.';
    if (taskType === 'ai_watcher_monitor' && escalationAllowed) {
      escalation = {
        allowed: true,
        toRoute: 'reasoning_oriented',
        reason: 'Escalate to reasoning-oriented routing only when a real failure is detected.',
        requiresTylerApproval: false,
      };
    }
  } else if (taskType === 'strategy_reasoning' || taskType === 'negotiation_strategy') {
    if (!parcelVerified && taskType === 'strategy_reasoning') {
      route = 'approval_required';
      driver = 'blocked_unverified_parcel';
      detail = 'Parcel identity unverified: property-specific strategy routing is blocked pending verification/approval.';
      availability = 'blocked';
    } else {
      route = 'reasoning_oriented';
      driver = taskType === 'negotiation_strategy' ? 'complex_negotiation' : 'verified_strategy';
      detail =
        taskType === 'negotiation_strategy'
          ? 'Complex negotiation strategy: reasoning-oriented routing (model chosen later by objective facts).'
          : 'Strategy reasoning on verified parcel facts: reasoning-oriented routing (model chosen later by objective facts).';
    }
  } else if (taskType === 'forge_diagnostics' || taskType === 'forge_build_planning') {
    route = 'reasoning_oriented';
    driver = 'forge';
    detail = 'Forge diagnostics/build planning: reasoning-oriented routing (approval gates still apply).';
  } else if (taskType === 'security_risk_analysis') {
    route = 'reasoning_oriented';
    driver = 'security';
    detail = 'Security risk analysis: reasoning-oriented routing; secrets/destructive actions stay hard-gated.';
  } else if (taskType === 'seller_prep') {
    route = 'task_oriented';
    driver = 'seller_prep';
    detail = 'Seller prep/drafting: task-oriented routing.';
    if (escalationAllowed) {
      escalation = {
        allowed: true,
        toRoute: 'reasoning_oriented',
        reason: 'Escalate to reasoning-oriented routing for complex negotiation strategy only.',
        requiresTylerApproval: false,
      };
    }
  } else if (taskType === 'war_room_discussion') {
    route = 'reasoning_oriented';
    driver = 'war_room';
    detail = 'War Room: reasoning-oriented routing; broader/closed-model capability only when Tyler opens it.';
    if (escalationAllowed) {
      escalation = {
        allowed: true,
        toRoute: 'approval_required',
        reason: 'Higher-cost/closed-model decision support requires Tyler to open it.',
        requiresTylerApproval: true,
      };
    }
  }

  // High risk with escalation allowed gets a documented escalation path with a
  // reason and a route that actually differs from the base (never a no-op).
  if (riskLevel === 'high' && escalationAllowed && !escalation.allowed && route !== 'deterministic_code') {
    escalation = {
      allowed: true,
      toRoute: escalationTargetFor(route),
      reason: 'High-risk task: escalate with a documented reason and an expanded routing requirement.',
      requiresTylerApproval: requiresApprovalForHigherCost,
    };
  }

  const budgetClass = input.budgetClass ?? budgetForRoute(route);

  return {
    route,
    alias: aliasForRoute(route, taskType),
    reason: { driver, detail },
    escalation,
    tokenBudget: { budgetClass },
    costBudget: { approvalOverBudget: requiresApprovalForHigherCost },
    usageEstimate: { budgetClass },
    fallback: { fallbackRoute: 'local_open_source', blockIfUnavailable: true },
    paidApiGated,
    availability,
  };
}
