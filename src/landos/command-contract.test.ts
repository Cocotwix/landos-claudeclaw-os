// Tests for LandOS Command normalized request, operator output, and routing v1.

import { describe, it, expect } from 'vitest';

import {
  routeCommand,
  THE_ORCHESTRATOR_ID,
  type LandOSCommandRequest,
} from './command-contract.js';
import { THE_ORCHESTRATOR_ID as STRUCTURE_ORCHESTRATOR } from './landos-structure.js';

function req(text: string, over: Partial<LandOSCommandRequest> = {}): LandOSCommandRequest {
  return { inputText: text, inputMode: 'typed', sourceSurface: 'dashboard', ...over };
}

describe('LandOS Command routing v1 — example routes', () => {
  it('typed property/address routes to DD + market + strategy + deal-cards', () => {
    const r = routeCommand(req('Look at 123 County Road 5, Madison County GA'));
    expect(r.detectedIntent).toBe('property_intake');
    for (const t of ['due-diligence-research', 'market-research', 'strategy', 'deal-cards']) {
      expect(r.allTargets).toContain(t);
    }
  });

  it('seller follow-up routes to CRM/Acquisition/GHL + deal-cards + strategy', () => {
    const r = routeCommand(req('Need to follow up with the seller about their next step'));
    expect(r.detectedIntent).toBe('seller_follow_up');
    for (const t of ['crm-acquisition-ghl', 'deal-cards', 'strategy']) {
      expect(r.allTargets).toContain(t);
    }
  });

  it('build-agent input routes to forge + command', () => {
    const r = routeCommand(req('Build an agent that watches the pipeline'));
    expect(r.detectedIntent).toBe('build_agent');
    expect(r.allTargets).toContain('forge');
    expect(r.allTargets).toContain(THE_ORCHESTRATOR_ID);
  });

  it('deal next-step routes to deal-cards + strategy + DD', () => {
    const r = routeCommand(req('What should we do with this deal next'));
    expect(r.detectedIntent).toBe('deal_next_step');
    for (const t of ['strategy', 'due-diligence-research', 'deal-cards']) {
      expect(r.allTargets).toContain(t);
    }
  });

  it('manufactured-home market question routes to market-research + strategy', () => {
    const r = routeCommand(req('Is there demand for manufactured homes in this market'));
    expect(r.detectedIntent).toBe('manufactured_home_market');
    expect(r.allTargets).toContain('market-research');
    expect(r.allTargets).toContain('strategy');
  });

  it('county growth-plan question routes to market-research + strategy + DD', () => {
    const r = routeCommand(req('What are the county growth plans affecting this area'));
    expect(r.detectedIntent).toBe('county_growth_plan');
    for (const t of ['market-research', 'strategy', 'due-diligence-research']) {
      expect(r.allTargets).toContain(t);
    }
  });
});

describe('LandOS Command — request contract + input modes', () => {
  it('supports typed and voice input modes', () => {
    const typed = routeCommand(req('What is the market like here', { inputMode: 'typed' }));
    expect(typed.technicalDetails.inputMode).toBe('typed');
    const voice = routeCommand(req('What is the market like here', { inputMode: 'voice' }));
    expect(voice.technicalDetails.inputMode).toBe('voice');
    // Voice is an I/O layer: it changes response mode, not business routing.
    expect(voice.technicalDetails.responseMode).toBe('both');
    expect(voice.selectedDepartments).toEqual(typed.selectedDepartments);
  });

  it('honors explicitly requested departments', () => {
    const r = routeCommand(req('general question', { requestedDepartments: ['finance'] }));
    expect(r.selectedDepartments).toContain('finance');
  });

  it('always routes through the single orchestrator', () => {
    const r = routeCommand(req('anything'));
    expect(r.technicalDetails.routedThrough).toBe(THE_ORCHESTRATOR_ID);
    expect(THE_ORCHESTRATOR_ID).toBe(STRUCTURE_ORCHESTRATOR);
  });
});

describe('LandOS Command — operator output shape', () => {
  it('separates a business summary from technical details', () => {
    const r = routeCommand(req('Look at 123 County Road 5, Madison County GA'));
    expect(r.operatorFacingSummary.length).toBeGreaterThan(0);
    expect(r.operatorNextAction.length).toBeGreaterThan(0);
    expect(r.requestSummary.length).toBeGreaterThan(0);
    // Technical detail is its own separable object.
    expect(r.technicalDetails).toBeTruthy();
    expect(Array.isArray(r.technicalDetails.matchedSignals)).toBe(true);
    // Business summary should not be a raw signal dump.
    expect(r.operatorFacingSummary).not.toContain('matchedSignals');
  });

  it('explains why each department was selected', () => {
    const r = routeCommand(req('Look at 123 County Road 5, Madison County GA'));
    expect(r.whyEachDepartmentWasSelected.length).toBe(r.selectedDepartments.length);
    for (const w of r.whyEachDepartmentWasSelected) {
      expect(w.reason.length).toBeGreaterThan(0);
    }
  });

  it('surfaces CRM-not-connected and strategy-blocked as approval/blocked items', () => {
    const seller = routeCommand(req('Follow up with the seller on the offer next step'));
    expect(seller.blockedOrApprovalNeededItems.join(' ')).toContain('GHL is not connected');
    const prop = routeCommand(req('Look at 123 County Road 5, Madison County GA'));
    expect(prop.blockedOrApprovalNeededItems.join(' ').toLowerCase()).toContain('verified');
  });

  it('groups parallel-capable legs and sequences deal-card writes after', () => {
    const r = routeCommand(req('Look at 123 County Road 5, Madison County GA'));
    expect(r.parallelGroups.length).toBeGreaterThan(0);
    expect(r.sequencingNotes.toLowerCase()).toContain('deal card');
  });
});
