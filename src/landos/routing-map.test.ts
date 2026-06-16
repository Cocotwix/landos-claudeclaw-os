// Unit tests for the kanban_status -> role-lane routing map and the new
// department lanes. Pure config: no DB, no network, no secrets.

import { describe, it, expect } from 'vitest';

import { KANBAN_STATUSES } from './db.js';
import { KANBAN_ROUTING, ROLE_LANES, routingForStatus, ownerForStatus, type RoleLane } from './routing-map.js';
import { DEPARTMENTS } from './departments.js';

const lanes = new Set<string>(ROLE_LANES as readonly string[]);

describe('KANBAN_ROUTING coverage and validity', () => {
  it('has an entry for every kanban_status', () => {
    for (const s of KANBAN_STATUSES) {
      expect(KANBAN_ROUTING[s], `missing routing for ${s}`).toBeTruthy();
    }
  });

  it('uses only valid role lanes for primary and supporting', () => {
    for (const s of KANBAN_STATUSES) {
      const r = KANBAN_ROUTING[s];
      expect(lanes.has(r.primary), `${s} primary "${r.primary}"`).toBe(true);
      for (const sup of r.supporting) {
        expect(lanes.has(sup), `${s} supporting "${sup}"`).toBe(true);
      }
      expect(r.label.length).toBeGreaterThan(0);
    }
  });

  it('safely handles unknown/legacy statuses with a default', () => {
    const r = routingForStatus('some_legacy_status_not_in_enum');
    expect(r.primary).toBe('Command Center');
    expect(r.label).toBe('Unrouted');
    expect(r.blockerEmphasis).toBeFalsy();
  });
});

describe('routing ownership invariants', () => {
  it('Due Diligence owns Parcel Verification and it is flagged as a gate', () => {
    expect(ownerForStatus('needs_parcel_verification')).toBe('Due Diligence');
    expect(KANBAN_ROUTING.needs_parcel_verification.blockerEmphasis).toBe(true);
  });

  it('Valuation / Comps owns underwriting (value)', () => {
    expect(ownerForStatus('underwriting')).toBe('Valuation / Comps');
  });

  it('Command Center owns strategy / offer-ready synthesis', () => {
    expect(ownerForStatus('offer_ready')).toBe('Command Center');
  });

  it('Transaction Coordination owns contract and closing', () => {
    expect(ownerForStatus('under_contract')).toBe('Transaction Coordination');
    expect(ownerForStatus('closed')).toBe('Transaction Coordination');
  });

  it('CRM / GHL Success is a feeder lane only — never a stage owner', () => {
    const primaries = KANBAN_STATUSES.map((s) => KANBAN_ROUTING[s].primary as RoleLane);
    expect(primaries).not.toContain('CRM / GHL Success');
  });

  it('Operations / Systems / Forge is not a default deal-stage owner', () => {
    const primaries = KANBAN_STATUSES.map((s) => KANBAN_ROUTING[s].primary as RoleLane);
    expect(primaries).not.toContain('Operations / Systems / Forge');
  });
});

describe('department lanes', () => {
  const ids = new Set(DEPARTMENTS.map((d) => d.id));

  it('includes a Transaction Coordination lane', () => {
    expect(ids.has('transaction_coordination')).toBe(true);
    const tc = DEPARTMENTS.find((d) => d.id === 'transaction_coordination')!;
    expect(tc.label).toMatch(/transaction coordination/i);
  });

  it('includes a CRM / GHL Success Management lane that does not modify GHL', () => {
    expect(ids.has('crm_ghl_success')).toBe(true);
    const crm = DEPARTMENTS.find((d) => d.id === 'crm_ghl_success')!;
    expect(crm.label).toMatch(/crm|ghl/i);
    expect(crm.description.toLowerCase()).toContain('never modifies ghl');
  });
});
