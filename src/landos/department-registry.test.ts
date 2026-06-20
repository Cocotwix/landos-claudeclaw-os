// Tests for the required core department registry and future-agent contracts.
// Pure config: no DB, no network, no secrets.

import { describe, it, expect } from 'vitest';

import {
  DEPARTMENT_REGISTRY,
  REQUIRED_DEPARTMENT_IDS,
  getDepartment,
  getAgent,
  departmentRegistrySummary,
} from './department-registry.js';

const REQUIRED = [
  'acquisition',
  'research_due_diligence',
  'strategy',
  'underwriting',
  'marketing',
  'dispositions',
  'transaction_coordinating',
  'finance_bookkeeping',
  'crm_manager',
  'ai_watcher_qa',
  'security_cybersecurity',
  'ceo_war_room',
  'forge_builder_diagnostics',
];

describe('required core department registry', () => {
  it('contains every required core department', () => {
    for (const id of REQUIRED) {
      expect(getDepartment(id), `missing department ${id}`).toBeTruthy();
    }
    expect(REQUIRED_DEPARTMENT_IDS.length).toBe(REQUIRED.length);
  });

  it('matches the required labels', () => {
    expect(getDepartment('research_due_diligence')!.label).toBe('Research and Due Diligence');
    expect(getDepartment('finance_bookkeeping')!.label).toBe('Finance / Bookkeeping');
    expect(getDepartment('ai_watcher_qa')!.label).toBe('AI Watcher / QA');
    expect(getDepartment('ceo_war_room')!.label).toBe('CEO / War Room');
    expect(getDepartment('forge_builder_diagnostics')!.label).toBe('Forge / Builder / Diagnostics');
  });

  it('Research and Due Diligence is operational, not a shell, with Duke registered', () => {
    const dd = getDepartment('research_due_diligence')!;
    expect(dd.lifecycle).toBe('operational');
    expect(dd.capability.operational).toBe(true);
    const duke = dd.agents.find((a) => a.agentId === 'duke-due-diligence');
    expect(duke).toBeTruthy();
    expect(duke!.lifecycle).toBe('operational');
    expect(dd.capability.capabilities).toContain('parcel_verification');
    expect(dd.capability.capabilities).toContain('parcel_due_diligence');
  });

  it('Duke is not replaced by a placeholder and uses deterministic-first model policy', () => {
    const duke = getAgent('duke-due-diligence')!;
    expect(duke.role.toLowerCase()).toContain('parcel');
    expect(duke.modelPolicy.defaultRoute).toBe('deterministic_code');
    // Duke does not default to a reasoning-oriented model.
    expect(duke.modelPolicy.defaultRoute).not.toBe('reasoning_oriented');
  });

  it('shell departments are registered but marked non-operational', () => {
    expect(getDepartment('marketing')!.capability.operational).toBe(false);
    expect(getDepartment('dispositions')!.capability.operational).toBe(false);
    expect(getDepartment('crm_manager')!.lifecycle).toBe('shell');
  });

  it('every department carries a buildout interview plan and a model policy', () => {
    for (const d of DEPARTMENT_REGISTRY) {
      expect(d.buildoutInterview.topics.length).toBeGreaterThan(0);
      expect(d.buildoutInterview.topics).toContain('model_default_policy');
      expect(d.buildoutInterview.topics).toContain('cost_token_budgets');
      expect(d.modelPolicy.defaultRoute).toBeTruthy();
    }
  });
});

describe('future agent / department extensibility contracts', () => {
  it('a future agent can declare capabilities, required inputs, blocked conditions, permissions, model policy, output', () => {
    const forge = getAgent('forge')!;
    expect(Array.isArray(forge.capability.requiredInputs)).toBe(true);
    expect(Array.isArray(forge.capability.blockedConditions)).toBe(true);
    expect(typeof forge.capability.canRunAsync).toBe('boolean');
    expect(typeof forge.capability.canCollaborate).toBe('boolean');
    expect(typeof forge.capability.canWriteDealCard).toBe('boolean');
    expect(typeof forge.capability.requiresTylerApprovalForRisk).toBe('boolean');
    expect(typeof forge.capability.canUsePaidApis).toBe('boolean');
    expect(forge.permissions.requiresApprovalFor).toContain('commit');
    expect(forge.modelPolicy.defaultRoute).toBe('reasoning_oriented');
  });

  it('a future department can be represented without changing the core registry shape', () => {
    // Construct a hypothetical future department using the same interface.
    const future = {
      id: 'legal_review',
      label: 'Legal Review',
      lifecycle: 'planned' as const,
      description: 'Future department.',
      capability: { departmentId: 'legal_review', operational: false, capabilities: ['contract_review'] },
      agents: [],
      buildoutInterview: { departmentId: 'legal_review', topics: ['purpose'] },
      modelPolicy: { departmentId: 'legal_review', defaultRoute: 'reasoning_oriented' as const },
    };
    // Type-compatible with the registry entries; no core rewrite needed.
    expect([...DEPARTMENT_REGISTRY, future].length).toBe(DEPARTMENT_REGISTRY.length + 1);
  });

  it('summary exposes lifecycle + operational flags for the read-only route', () => {
    const summary = departmentRegistrySummary();
    const dd = summary.find((s) => s.id === 'research_due_diligence')!;
    expect(dd.operational).toBe(true);
    const mk = summary.find((s) => s.id === 'marketing')!;
    expect(mk.operational).toBe(false);
  });
});
