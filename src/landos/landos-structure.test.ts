// Tests for the LandOS-wide structure spine. Pure config: no DB/network/secrets.

import { describe, it, expect } from 'vitest';

import {
  DEPARTMENT_LEGS,
  SHARED_SURFACES,
  SHARED_RECORDS,
  INTERFACE_LAYERS,
  ALL_SHARED_NODES,
  REQUIRED_DEPARTMENT_LEG_IDS,
  WAR_ROOM_PRESERVED_CARDS,
  WAR_ROOM_ROUTING_CONTRACT,
  THE_ORCHESTRATOR_ID,
  getDepartmentLeg,
  getSharedNode,
  theOnlyOrchestrator,
  orchestratorNodeIds,
  assertNoCenterOfGravity,
  landosStructureSummary,
  warRoomPreservation,
} from './landos-structure.js';
import { REQUIRED_DEPARTMENT_IDS } from './department-registry.js';

describe('LandOS structure — department legs', () => {
  it('contains every required department leg', () => {
    for (const id of REQUIRED_DEPARTMENT_LEG_IDS) {
      expect(getDepartmentLeg(id), `missing leg ${id}`).toBeTruthy();
    }
    expect(DEPARTMENT_LEGS.length).toBe(REQUIRED_DEPARTMENT_LEG_IDS.length);
  });

  it('every leg carries the required registry fields', () => {
    for (const l of DEPARTMENT_LEGS) {
      expect(l.id).toBeTruthy();
      expect(l.displayName).toBeTruthy();
      expect(l.category).toBe('department_leg');
      expect(l.purpose.length).toBeGreaterThan(0);
      expect(Array.isArray(l.normalTylerInputs)).toBe(true);
      expect(Array.isArray(l.automaticActions)).toBe(true);
      expect(Array.isArray(l.onDemandActions)).toBe(true);
      expect(Array.isArray(l.hardNoGoRules)).toBe(true);
      expect(Array.isArray(l.outputContract)).toBe(true);
      expect(typeof l.canRunParallel).toBe('boolean');
      expect(Array.isArray(l.requiresHumanApprovalFor)).toBe(true);
      expect(['active', 'shell', 'planned']).toContain(l.status);
      expect(l.summaryMetricLabel).toBeTruthy();
      expect(Array.isArray(l.alertTypes)).toBe(true);
      expect(Array.isArray(l.dealCardWritePermissions)).toBe(true);
    }
  });

  it('reuses existing department-registry ids via registryRef (no duplicate registry)', () => {
    for (const l of DEPARTMENT_LEGS) {
      if (l.registryRef === null) continue;
      expect(REQUIRED_DEPARTMENT_IDS, `${l.id} registryRef ${l.registryRef} unknown`).toContain(l.registryRef);
    }
    // market-research is the one genuinely new leg with no existing registry entry.
    expect(getDepartmentLeg('market-research')!.registryRef).toBeNull();
  });
});

describe('LandOS structure — categories are separate', () => {
  it('shared surfaces, records, and interface layers are categorized separately from legs', () => {
    for (const n of SHARED_SURFACES) expect(n.category).toBe('shared_surface');
    for (const n of SHARED_RECORDS) expect(n.category).toBe('shared_record');
    for (const n of INTERFACE_LAYERS) expect(n.category).toBe('interface_layer');
    // None of the shared nodes are department legs.
    const legIds = new Set(DEPARTMENT_LEGS.map((l) => l.id));
    for (const n of ALL_SHARED_NODES) expect(legIds.has(n.id)).toBe(false);
  });

  it('war-room and deal-cards and voice-layer are NOT department legs', () => {
    expect(getDepartmentLeg('war-room')).toBeUndefined();
    expect(getDepartmentLeg('deal-cards')).toBeUndefined();
    expect(getDepartmentLeg('voice-layer')).toBeUndefined();
    expect(getSharedNode('war-room')!.category).toBe('shared_surface');
    expect(getSharedNode('deal-cards')!.category).toBe('shared_record');
    expect(getSharedNode('voice-layer')!.category).toBe('interface_layer');
  });
});

describe('LandOS structure — no center of gravity', () => {
  it('LandOS Command is the only orchestrator', () => {
    expect(theOnlyOrchestrator()).toBe(THE_ORCHESTRATOR_ID);
    expect(orchestratorNodeIds()).toEqual([THE_ORCHESTRATOR_ID]);
    expect(getSharedNode('war-room')!.orchestrator).toBe(false);
  });

  it('no department leg orchestrates or is the center of gravity', () => {
    for (const l of DEPARTMENT_LEGS) {
      expect(l.orchestrator).toBe(false);
      expect(l.centerOfGravity).toBe(false);
    }
    expect(() => assertNoCenterOfGravity()).not.toThrow();
  });
});

describe('LandOS structure — War Room preservation', () => {
  it('preserves the existing War Room opening-page cards', () => {
    expect(WAR_ROOM_PRESERVED_CARDS).toEqual([
      'Voice', 'Text', 'Live Meetings', 'Voice config', 'Standup roster', 'Open in classic',
    ]);
    const wr = warRoomPreservation();
    for (const card of ['Voice', 'Text', 'Live Meetings', 'Voice config', 'Standup roster', 'Open in classic']) {
      expect(wr.cards).toContain(card);
    }
  });

  it('preservation rules forbid rebuilding/removing the War Room page', () => {
    const wr = getSharedNode('war-room')!;
    const joined = [...wr.hardNoGoRules, ...wr.preservationRules].join(' ').toLowerCase();
    expect(joined).toContain('do not rebuild');
    expect(joined).toContain('gemini');
    expect(joined).toContain('pipecat');
  });

  it('War Room routing contract is additive and routes only through Command', () => {
    expect(WAR_ROOM_ROUTING_CONTRACT.routesThrough).toBe(THE_ORCHESTRATOR_ID);
    expect(WAR_ROOM_ROUTING_CONTRACT.directLegRouting).toBe(false);
    expect(WAR_ROOM_ROUTING_CONTRACT.preservesExistingPage).toBe(true);
    expect(WAR_ROOM_ROUTING_CONTRACT.connectableLegs.length).toBe(DEPARTMENT_LEGS.length);
  });
});

describe('LandOS structure — leg-specific rules', () => {
  it('Market Research is a separate leg from Due Diligence + Research', () => {
    const mr = getDepartmentLeg('market-research')!;
    const dd = getDepartmentLeg('due-diligence-research')!;
    expect(mr.id).not.toBe(dd.id);
    expect(mr.purpose.toLowerCase()).toContain('market');
    expect(dd.purpose.toLowerCase()).toContain('property-level');
    expect(mr.hardNoGoRules.join(' ').toLowerCase()).toContain('can never verify a parcel');
  });

  it('CRM/Acquisition/GHL is a planned shell with a future contract and does not pretend GHL is connected', () => {
    const crm = getDepartmentLeg('crm-acquisition-ghl')!;
    expect(crm.status).toBe('planned');
    expect(crm.dealCardWritePermissions).toEqual([]);
    const rules = crm.hardNoGoRules.join(' ').toLowerCase();
    expect(rules).toContain('not connected');
    expect(rules).toContain('no external crm writes');
    expect(rules).toContain('never require ghl credentials');
    expect(crm.futureSubareas).toContain('pipeline');
    expect(crm.futureSubareas).toContain('speed-to-lead');
  });

  it('Due Diligence + Research and Strategy can write to the Deal Card contract', () => {
    expect(getDepartmentLeg('due-diligence-research')!.dealCardWritePermissions.length).toBeGreaterThan(0);
    expect(getDepartmentLeg('strategy')!.dealCardWritePermissions).toContain('exit_strategy_analysis');
  });

  it('Voice is an interface layer, not a business-logic department', () => {
    const v = getSharedNode('voice-layer')!;
    expect(v.category).toBe('interface_layer');
    expect(v.hardNoGoRules.join(' ').toLowerCase()).toContain('does not contain business logic');
    expect(v.departmentConnections).toContain(THE_ORCHESTRATOR_ID);
  });
});

describe('LandOS structure — Command home tile summary', () => {
  it('exposes one tile per department leg with status + metric label', () => {
    const tiles = landosStructureSummary();
    expect(tiles.length).toBe(DEPARTMENT_LEGS.length);
    const dd = tiles.find((t) => t.id === 'due-diligence-research')!;
    expect(dd.status).toBe('active');
    expect(dd.summaryMetricLabel).toBeTruthy();
    expect(dd.dashboardRoute).toBeTruthy();
    expect(typeof dd.canAlert).toBe('boolean');
  });
});
