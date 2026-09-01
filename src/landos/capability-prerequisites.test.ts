// Declared capability prerequisites — capabilities and readiness items declare
// the minimum context THEY require; there is no global parcel gate.
//
// The defect class: one slow/unresolved Property Resolution froze unrelated
// county/ZIP market work and seller work, and the mission graph skipped the
// county-scoped market lane because every child hard-depended on
// parcel_identity. Prerequisites are declared per capability/item/lane and
// evaluated against the Canonical Subject State.

import { describe, it, expect, beforeEach } from 'vitest';

import { capabilityPrerequisites, listRuntimeCapabilities } from './capability-registry.js';
import {
  resolveCanonicalSubjectState,
  subjectMeetsPrerequisite,
  unmetPrerequisites,
  type CanonicalSubjectState,
} from './canonical-subject-state.js';
import {
  RESEARCH_READINESS_ITEMS,
  buildResearchReadinessManifest,
  researchItemPrerequisites,
} from './research-readiness.js';
import { planResearchCoverage } from './research-coverage-cycle.js';
import { dealIntelligenceChildrenForSubject, DEAL_INTELLIGENCE_CHILDREN } from './deal-intelligence-mission.js';
import { reconcileResearchReadiness, isReconcileError } from './research-readiness-reconcile.js';
import { _initTestLandosDb, getLandosDb } from './db.js';

function subjectWith(overrides: Partial<CanonicalSubjectState>): CanonicalSubjectState {
  return {
    dealCardId: 1, propertyCardId: null, subjectResolved: false, officiallyVerified: false,
    status: 'unresolved', source: 'none', apn: null, apnNormalized: null, address: null,
    city: null, county: null, state: null, fips: null, zip: null, owner: null,
    subjectVersion: 'unresolved:1:unresolved', subjectVersionId: null,
    governingAcreage: { value: null, kind: null, source: null, disputed: false, observedAt: null },
    supersededAcreage: [],
    sellerCommunicationsAvailable: false, basis: '', confidence: 0, sourceRefs: [], confirmedAt: null,
    ...overrides,
  };
}

describe('capability declarations', () => {
  it('every registered capability declares its minimum context', () => {
    for (const metadata of listRuntimeCapabilities()) {
      expect(metadata.prerequisites, metadata.id).toBeDefined();
    }
  });

  it('property-resolution requires nothing — it establishes the subject', () => {
    expect(capabilityPrerequisites('property-resolution')).toEqual([]);
  });

  it('parcel-specific capabilities wait on an established subject, not official verification', () => {
    const subject = subjectWith({ subjectResolved: true, officiallyVerified: false });
    for (const id of ['assessor-tax', 'comps-valuation', 'zoning-subdivision', 'landportal-research']) {
      expect(unmetPrerequisites(subject, capabilityPrerequisites(id)), id).toEqual([]);
    }
    const unresolved = subjectWith({ county: 'Iredell', state: 'NC' });
    for (const id of ['assessor-tax', 'comps-valuation']) {
      expect(unmetPrerequisites(unresolved, capabilityPrerequisites(id)), id).toEqual(['parcel']);
    }
  });

  it('an undeclared capability id conservatively requires an established subject', () => {
    expect(capabilityPrerequisites('some-future-capability')).toEqual(['parcel']);
  });
});

describe('subject prerequisite evaluation', () => {
  it('county is satisfied by county+state or by FIPS alone', () => {
    expect(subjectMeetsPrerequisite(subjectWith({ county: 'Iredell', state: 'NC' }), 'county')).toBe(true);
    expect(subjectMeetsPrerequisite(subjectWith({ fips: '37097' }), 'county')).toBe(true);
    expect(subjectMeetsPrerequisite(subjectWith({ county: 'Iredell' }), 'county')).toBe(false);
  });

  it('an any-of clause is satisfied by either alternative (county OR zip)', () => {
    const clause = [['county', 'zip']] as const;
    expect(unmetPrerequisites(subjectWith({ zip: '28625' }), clause as never)).toEqual([]);
    expect(unmetPrerequisites(subjectWith({ county: 'Iredell', state: 'NC' }), clause as never)).toEqual([]);
    expect(unmetPrerequisites(subjectWith({}), clause as never)).toEqual(['county']);
  });
});

describe('readiness items — per-item prerequisites', () => {
  const countyOnly = subjectWith({ county: 'Iredell', state: 'NC' });

  it('market items need county OR zip, seller needs nothing, parcel items need the subject', () => {
    const byId = new Map(RESEARCH_READINESS_ITEMS.map((d) => [d.id, d]));
    expect(researchItemPrerequisites(byId.get('market_statistics')!)).toEqual([['county', 'zip']]);
    expect(researchItemPrerequisites(byId.get('area_market_context')!)).toEqual([['county', 'zip']]);
    expect(researchItemPrerequisites(byId.get('seller_information')!)).toEqual([]);
    expect(researchItemPrerequisites(byId.get('property_resolution')!)).toEqual([]);
    expect(researchItemPrerequisites(byId.get('assessor_tax')!)).toEqual(['parcel']);
  });

  it('a county-known manifest keeps market/seller items evaluable while parcel items wait', () => {
    const manifest = buildResearchReadinessManifest({
      dealCardId: 1, propertyCardId: 1, probes: [], now: new Date().toISOString(),
      unmetPrerequisitesFor: (clauses) => unmetPrerequisites(countyOnly, clauses),
    });
    const item = (id: string) => manifest.items.find((i) => i.id === id)!;
    expect(item('market_statistics').unmetPrerequisites).toEqual([]);
    expect(item('area_market_context').unmetPrerequisites).toEqual([]);
    expect(item('seller_information').unmetPrerequisites).toEqual([]);
    expect(item('property_resolution').unmetPrerequisites).toEqual([]);
    expect(item('assessor_tax').unmetPrerequisites).toEqual(['parcel']);
    expect(item('current_zoning').unmetPrerequisites).toEqual(['parcel']);
    // Waiting on the subject is not a machine-attemptable red and never blocks
    // the intelligence layer prematurely.
    expect(item('assessor_tax').machineBackfillAllowed).toBe(false);
    expect(item('assessor_tax').blocksIntelligence).toBe(false);
    // Resolution itself stays attemptable — it is the route to the subject.
    expect(item('property_resolution').machineBackfillAllowed).toBe(true);
  });

  it('coverage planning reports waiting_prerequisite, never BLOCKED, for subject-waiting items', () => {
    const manifest = buildResearchReadinessManifest({
      dealCardId: 1, propertyCardId: 1, probes: [], now: new Date().toISOString(),
      unmetPrerequisitesFor: (clauses) => unmetPrerequisites(countyOnly, clauses),
    });
    const plan = planResearchCoverage(manifest);
    const entry = (id: string) => plan.entries.find((e) => e.id === id)!;
    expect(entry('assessor_tax').action).toBe('waiting_prerequisite');
    expect(entry('assessor_tax').state).toBe('NOT_RUN');
    expect(entry('property_resolution').action).toBe('run');
    expect(plan.runItemIds).not.toContain('assessor_tax');
  });

  it('once the subject is established, formerly waiting items become attemptable', () => {
    const established = subjectWith({ subjectResolved: true, county: 'Iredell', state: 'NC' });
    const manifest = buildResearchReadinessManifest({
      dealCardId: 1, propertyCardId: 1, probes: [], now: new Date().toISOString(),
      unmetPrerequisitesFor: (clauses) => unmetPrerequisites(established, clauses),
    });
    const plan = planResearchCoverage(manifest);
    expect(plan.entries.find((e) => e.id === 'assessor_tax')!.action).toBe('run');
  });
});

describe('mission graph — county-known market lane is not held behind parcel resolution', () => {
  it('drops the parcel_identity edge from market_intelligence when its declared context is met', () => {
    const countyKnown = subjectWith({ county: 'Iredell', state: 'NC' });
    const children = dealIntelligenceChildrenForSubject((clauses) => unmetPrerequisites(countyKnown, clauses));
    const market = children.find((c) => c.key === 'market_intelligence')!;
    expect(market.dependsOn).not.toContain('parcel_identity');
    // Every parcel-scoped lane keeps its conservative dependency.
    const zoning = children.find((c) => c.key === 'zoning_land_use')!;
    expect(zoning.dependsOn).toContain('parcel_identity');
  });

  it('keeps the edge when county is unknown — resolution is then the route to the county', () => {
    const unknown = subjectWith({});
    const children = dealIntelligenceChildrenForSubject((clauses) => unmetPrerequisites(unknown, clauses));
    expect(children.find((c) => c.key === 'market_intelligence')!.dependsOn).toContain('parcel_identity');
  });

  it('without an evaluator the definition is byte-for-byte the conservative one', () => {
    expect(dealIntelligenceChildrenForSubject(null)).toBe(DEAL_INTELLIGENCE_CHILDREN);
  });
});

describe('reconcile — a county-known lead without parcel identity gets a real manifest', () => {
  beforeEach(() => _initTestLandosDb());

  it('does not invalidate the whole checklist for lack of an exact parcel', () => {
    const db = getLandosDb();
    db.prepare(`INSERT INTO landos_deal_card (id, entity, title, status) VALUES (61, 'TY_LAND_BIZ', 'County-known lead', 'new')`).run();
    db.prepare(`
      INSERT INTO landos_property_card (id, entity, verification_status, active_input_address, address_key, county, state)
      VALUES (61, 'TY_LAND_BIZ', 'unverified_lead', 'Somewhere on Cranfill Rd', 'cranfill rd', 'Iredell', 'NC')
    `).run();
    db.prepare(`INSERT INTO landos_deal_card_property (deal_card_id, card_id, role) VALUES (61, 61, 'subject')`).run();

    const manifest = reconcileResearchReadiness(61);
    expect(isReconcileError(manifest)).toBe(false);
    if (isReconcileError(manifest)) return;
    const market = manifest.items.find((i) => i.id === 'market_statistics')!;
    expect(market.unmetPrerequisites).toEqual([]);
    const assessor = manifest.items.find((i) => i.id === 'assessor_tax')!;
    expect(assessor.unmetPrerequisites).toEqual(['parcel']);
    const plan = planResearchCoverage(manifest);
    expect(plan.entries.find((e) => e.id === 'assessor_tax')!.action).toBe('waiting_prerequisite');
  });
});

// F-WS2 regression (pattern same-label-different-basis): the operator tally
// mapped every red item to "blocked", so 14 items merely waiting on the
// subject prerequisite read as refused. Waiting and blocked are different
// facts and the aggregate must keep them apart.
describe('operator completeness — waiting is not blocked', () => {
  const countyOnly = subjectWith({ county: 'Iredell', state: 'NC' });

  it('projects unmet-prerequisite red items as waiting, never blocked', () => {
    const manifest = buildResearchReadinessManifest({
      dealCardId: 1, propertyCardId: 1, probes: [], now: new Date().toISOString(),
      unmetPrerequisitesFor: (clauses) => unmetPrerequisites(countyOnly, clauses),
    });
    const operator = manifest.operatorCompleteness;
    const assessor = operator.items.find((i) => i.id === 'assessor_tax')!;
    expect(assessor.outcome).toBe('waiting');
    // All fifteen parcel-scoped items wait; only items whose own
    // prerequisites are met (resolution, market with no data yet) may still
    // count toward the blocked tally under the pre-existing red mapping.
    expect(operator.waiting).toBe(15);
    expect(operator.items.filter((i) => i.outcome === 'blocked').map((i) => i.id))
      .not.toContain('assessor_tax');
    // The unattemptable item names what it waits for instead of an
    // instruction it cannot honor.
    const item = manifest.items.find((i) => i.id === 'assessor_tax')!;
    expect(item.nextAction).toMatch(/Waiting on an established subject parcel/);
  });

  it('a genuinely attempted-and-empty red item still counts blocked once the subject exists', () => {
    const established = subjectWith({ subjectResolved: true, county: 'Iredell', state: 'NC' });
    const manifest = buildResearchReadinessManifest({
      dealCardId: 1, propertyCardId: 1, probes: [], now: new Date().toISOString(),
      unmetPrerequisitesFor: (clauses) => unmetPrerequisites(established, clauses),
    });
    expect(manifest.operatorCompleteness.items.find((i) => i.id === 'assessor_tax')!.outcome).toBe('blocked');
    expect(manifest.operatorCompleteness.waiting).toBe(0);
  });
});
