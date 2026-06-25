// LandOS Executive Agent — primary orchestrator (routing scaffold).
//
// The Executive Agent is the single point of contact: the operator never picks an
// agent; they state intent and the Executive routes it to the right department,
// coordinates, and returns the result. This module is the deterministic routing
// SCAFFOLD — it maps an operator request to a roster agent. It makes NO model
// call and performs NO side effects; the actual execution is delegated to the
// already-wired seams (Property Analysis, duke-router, mission/delegate) which the
// route layer invokes. Pure + testable.

import { AGENT_ROSTER, executiveAgent, getAgentDef, type AgentDef } from './agent-roster.js';

export interface RoutingDecision {
  /** The department agent the Executive routes this request to. */
  agentKey: string;
  agentName: string;
  group: AgentDef['group'];
  status: AgentDef['status'];
  /** Existing wired implementation the route layer should invoke, if any. */
  implAgentId?: string;
  /** Whether this request is property-scoped (drives Deal Card attachment). */
  propertyScoped: boolean;
  reason: string;
  /** Loud flag when the routed agent is not yet built (scaffold/planned). */
  notYetImplemented: boolean;
}

interface Rule { test: RegExp; agentKey: string; propertyScoped: boolean }

// Deterministic intent rules, ordered by specificity. Property-scoped intents
// route into the acquisitions pipeline; business/intel intents route to the
// intelligence group. Coordinates/identity are never used here.
const RULES: Rule[] = [
  { test: /\b(underwrit|approve (the )?offer|final offer|post[- ]?(call|discovery))\b/i, agentKey: 'uw_bot', propertyScoped: true },
  { test: /\b(run (a )?(property|deal) analysis|due diligence|\bdd\b|land score|discovery report|verify (the )?parcel|comps?|deal card)\b/i, agentKey: 'dd_bot', propertyScoped: true },
  { test: /\b(seller|call prep|objection|negotiat|talk to|what (do i|to) say|seller profile|debrief)\b/i, agentKey: 'acquisitions_bot', propertyScoped: true },
  { test: /\b(new lead|intake|lead came in|form submission|triage)\b/i, agentKey: 'lead_bot', propertyScoped: true },
  { test: /\b(title|closing|earnest|contract|escrow|lender update|transaction)\b/i, agentKey: 'tc_bot', propertyScoped: true },
  { test: /\b(listing|disposition|sell the|buyer inquir|land[- ]home package feasibility)\b/i, agentKey: 'dispo_bot', propertyScoped: true },
  { test: /\b(daily brief|who needs|stalled|follow[- ]?up|pipeline (status|health)|at[- ]risk)\b/i, agentKey: 'success_bot', propertyScoped: false },
  { test: /\b(county (scorecard|metrics)|market research|absorption|days on market|price per acre|sales density)\b/i, agentKey: 'market_bot', propertyScoped: false },
  { test: /\b(competitor|spy|ad library|what (are|is) .* (doing|running))\b/i, agentKey: 'spy_bot', propertyScoped: false },
  { test: /\b(ad copy|meta ads|google ads|marketing|budget allocation|campaign)\b/i, agentKey: 'marketing_bot', propertyScoped: false },
  { test: /\b(new model|ai (news|research|landscape)|better (model|tool)|tech stack)\b/i, agentKey: 'ai_bot', propertyScoped: false },
  { test: /\b(strategy library|creative (exit|deal)|unusual parcel|emerging strateg)\b/i, agentKey: 'research_bot', propertyScoped: false },
  { test: /\b(system health|api (down|status)|ollama|tunnel|health check|self[- ]heal)\b/i, agentKey: 'sys_bot', propertyScoped: false },
];

/**
 * Route an operator request to the right department agent. Deterministic. When no
 * specific rule matches, the Executive handles it itself (orchestrator). Returns a
 * decision the route layer uses to invoke the correct wired seam; scaffold/planned
 * agents are flagged notYetImplemented so the UI can say so honestly.
 */
export function routeOperatorRequest(text: string): RoutingDecision {
  const t = (text ?? '').trim();
  const matched = RULES.find((r) => r.test.test(t));
  const def = matched ? getAgentDef(matched.agentKey)! : executiveAgent();
  return {
    agentKey: def.key,
    agentName: def.name,
    group: def.group,
    status: def.status,
    implAgentId: def.implAgentId,
    propertyScoped: matched ? matched.propertyScoped : false,
    reason: matched
      ? `Routed to ${def.name} (${def.key}).`
      : 'No specialized intent matched; the Executive Agent handles coordination directly.',
    notYetImplemented: def.status !== 'active',
  };
}

/** Org chart for the dashboard: Executive at the top, departments grouped. */
export function orgChart(): { executive: AgentDef; groups: Record<AgentDef['group'], AgentDef[]> } {
  const groups = { orchestrator: [], acquisitions: [], operations: [], intelligence: [] } as Record<AgentDef['group'], AgentDef[]>;
  for (const a of AGENT_ROSTER) groups[a.group].push(a);
  return { executive: executiveAgent(), groups };
}
