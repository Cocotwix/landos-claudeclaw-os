// LandOS Deal Card attachment policy.
//
// Deal Cards are the PROPERTY-LEVEL system of record. This module codifies the
// single routing rule for where an agent output goes:
//
//   property-specific output  -> attaches to the parcel's Deal Card
//   business/intelligence output -> R2 knowledge layer, NOT a Deal Card
//   unless the business output is tied to a specific property, in which case it
//   attaches too.
//
// Pure + deterministic. No I/O. Used by the orchestrator/agents to decide output
// routing and by tests to enforce the boundary.

import { getAgentDef, type AttachmentClass } from './agent-roster.js';

export interface AgentOutput {
  /** Roster key of the producing agent (e.g. 'dd_bot', 'market_bot'). */
  agentKey: string;
  /** The parcel this output is about, if any (APN or LandPortal property id). */
  apn?: string | null;
  /** Optional explicit attachment override from the producer (rarely needed). */
  attachmentOverride?: AttachmentClass;
}

export interface AttachmentDecision {
  attachToDealCard: boolean;
  /** Where the output is stored when it does NOT attach to a Deal Card. */
  knowledgeDestination: string | null;
  reason: string;
}

/** Knowledge-layer destination root by agent group/key when an output is not a
 *  Deal Card output. Aligns with the R2 path conventions. */
function knowledgeDestinationFor(agentKey: string): string {
  switch (agentKey) {
    case 'market_bot': return 'markets/';
    case 'spy_bot': return 'intelligence/';
    case 'ai_bot': return 'intelligence/';
    case 'research_bot': return 'research/';
    case 'sys_bot': return 'system/';
    case 'marketing_bot': return 'marketing/';
    default: return `agents/${agentKey}/knowledge/`;
  }
}

/**
 * Decide whether an agent output attaches to a Deal Card. Pure.
 *
 * Rules:
 *  - 'property'    agents always attach (and require an apn to do so).
 *  - 'business'    agents never attach — output lands in the knowledge layer.
 *  - 'conditional' agents attach ONLY when the output names a specific apn.
 *  An explicit attachmentOverride is honored but still requires an apn to attach.
 */
export function decideAttachment(output: AgentOutput): AttachmentDecision {
  const def = getAgentDef(output.agentKey);
  const cls: AttachmentClass = output.attachmentOverride ?? def?.attachment ?? 'business';
  const hasApn = typeof output.apn === 'string' && output.apn.trim().length > 0;

  if (cls === 'property') {
    if (!hasApn) {
      return { attachToDealCard: false, knowledgeDestination: knowledgeDestinationFor(output.agentKey), reason: 'property-class output but no apn supplied — cannot attach to a Deal Card; held in knowledge layer until a parcel is identified.' };
    }
    return { attachToDealCard: true, knowledgeDestination: null, reason: 'property-specific output attaches to the parcel Deal Card.' };
  }

  if (cls === 'conditional') {
    if (hasApn) {
      return { attachToDealCard: true, knowledgeDestination: null, reason: 'business/intel output tied to a specific property attaches to that Deal Card.' };
    }
    return { attachToDealCard: false, knowledgeDestination: knowledgeDestinationFor(output.agentKey), reason: 'business/intel output not tied to a property — stored in the knowledge layer, not a Deal Card.' };
  }

  // 'business'
  return { attachToDealCard: false, knowledgeDestination: knowledgeDestinationFor(output.agentKey), reason: 'business/intelligence/system output is never a Deal Card output (no property scope).' };
}
