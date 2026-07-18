import { describe, it, expect } from 'vitest';
import { AGENT_ROSTER, ROSTER_SIZE, getAgentDef, executiveAgent, agentsByGroup, rosterSummary } from './agent-roster.js';

describe('14-agent roster', () => {
  it('has exactly 14 agents', () => {
    expect(ROSTER_SIZE).toBe(14);
  });

  it('has exactly one orchestrator (Executive Agent)', () => {
    expect(AGENT_ROSTER.filter((a) => a.orchestrator)).toHaveLength(1);
    expect(executiveAgent().key).toBe('exec_bot');
    expect(executiveAgent().group).toBe('orchestrator');
  });

  it('positions the hidden legacy worker id behind the Property Research Agent role', () => {
    const dd = getAgentDef('dd_bot');
    expect(dd?.name).toBe('Property Research Agent');
    expect(dd?.implAgentId).toBe('duke-due-diligence');
    expect(dd?.status).toBe('active');
    expect(dd?.group).toBe('acquisitions');
  });

  it('covers the four functional groups', () => {
    expect(agentsByGroup('orchestrator').length).toBe(1);
    expect(agentsByGroup('acquisitions').length).toBe(4); // lead, dd, acquisitions, uw
    expect(agentsByGroup('operations').length).toBe(4);   // success, tc, marketing, dispo
    expect(agentsByGroup('intelligence').length).toBe(5); // market, spy, ai, research, sys
  });

  it('every agent declares role, tier, attachment class, knowledge + memory paths', () => {
    for (const a of AGENT_ROSTER) {
      expect(a.role.length).toBeGreaterThan(10);
      expect(['tier1', 'tier2', 'tier3']).toContain(a.defaultTier);
      expect(['property', 'business', 'conditional']).toContain(a.attachment);
      expect(a.knowledgePath).toMatch(new RegExp(`^agents/${a.key}/knowledge`));
      expect(a.memoryPath).toMatch(new RegExp(`^agents/${a.key}/memory`));
    }
  });

  it('Underwriting is property-class Tier-3; Market Research is business-class', () => {
    expect(getAgentDef('uw_bot')?.defaultTier).toBe('tier3');
    expect(getAgentDef('uw_bot')?.attachment).toBe('property');
    expect(getAgentDef('market_bot')?.attachment).toBe('business');
  });

  it('rosterSummary marks implemented agents and is dashboard-safe', () => {
    const sum = rosterSummary();
    expect(sum).toHaveLength(14);
    expect(sum.find((s) => s.key === 'dd_bot')?.implemented).toBe(true);
    expect(sum.find((s) => s.key === 'uw_bot')?.implemented).toBe(false);
    expect(JSON.stringify(sum)).not.toMatch(/token|secret|key=/i);
  });
});
