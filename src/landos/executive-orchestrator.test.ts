import { describe, it, expect } from 'vitest';
import { routeOperatorRequest, orgChart } from './executive-orchestrator.js';

describe('Executive orchestrator routing', () => {
  it('routes a property-analysis request to the DD Specialist (property-scoped, active)', () => {
    const d = routeOperatorRequest('run a property analysis on 472 West Rd');
    expect(d.agentKey).toBe('dd_bot');
    expect(d.propertyScoped).toBe(true);
    expect(d.implAgentId).toBe('duke-due-diligence');
    expect(d.notYetImplemented).toBe(false);
  });

  it('routes post-discovery / approve-offer to the Underwriting Agent', () => {
    expect(routeOperatorRequest('underwrite this and approve the offer').agentKey).toBe('uw_bot');
  });

  it('routes county metrics to Market Research (business-scoped)', () => {
    const d = routeOperatorRequest('build the county scorecard / absorption rate for Worth County');
    expect(d.agentKey).toBe('market_bot');
    expect(d.propertyScoped).toBe(false);
  });

  it('routes seller-handling to the Acquisitions Agent', () => {
    expect(routeOperatorRequest('what do I say to this seller on the call').agentKey).toBe('acquisitions_bot');
  });

  it('flags scaffold/planned agents as notYetImplemented', () => {
    expect(routeOperatorRequest('competitor ad library check').notYetImplemented).toBe(true); // spy_bot planned
  });

  it('unmatched intent stays with the Executive Agent', () => {
    const d = routeOperatorRequest('hello, what is the status');
    expect(d.agentKey).toBe('exec_bot');
    expect(d.group).toBe('orchestrator');
  });

  it('orgChart returns the executive + all four groups', () => {
    const org = orgChart();
    expect(org.executive.key).toBe('exec_bot');
    expect(Object.keys(org.groups).sort()).toEqual(['acquisitions', 'intelligence', 'operations', 'orchestrator']);
    const total = Object.values(org.groups).reduce((n, g) => n + g.length, 0);
    expect(total).toBe(14);
  });
});
