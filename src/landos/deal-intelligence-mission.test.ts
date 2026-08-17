import { describe, expect, it } from 'vitest';

import {
  APPROVED_STRATEGY_NAMES,
  DEAL_INTELLIGENCE_CHILDREN,
  DEAL_INTELLIGENCE_KIND,
  dealIntelligenceChildSpec,
  dealIntelligenceExecutors,
  dealIntelligenceMissionDefinition,
  type ComparablesHandback,
  type DealIntelligenceCapabilities,
  type StrategyHandback,
  type SubjectResearchHandback,
  type ValuationHandback,
} from './deal-intelligence-mission.js';
import { evaluateMissionAcceptance } from './mission-acceptance.js';
import { missionChildIdentity, planMissionWaves, upstreamContributions, type MissionChildState } from './mission-graph.js';
import type { MissionChildContext } from './mission-graph-runner.js';
import type { PropertyIntelligenceCollectors, SpecialistOutcome } from './property-intelligence-collector-types.js';
import type { SnapshotIdentity } from './property-intelligence-snapshot.js';

const AT = '2026-07-28T00:00:00.000Z';

const CONFIRMED_IDENTITY: SnapshotIdentity = {
  state: 'confirmed',
  normalizedAddress: 'OLD RIDGE RD',
  county: 'Roane',
  state_: 'TN',
  apn: '073090 04200',
  apnVariants: ['073090 04200'],
  owner: 'SACHAN DILEEP S',
  ownerMailing: null,
  situs: 'OLD RIDGE RD',
  acres: 12.28,
  acreageBasis: 'deeded',
  coordinates: null,
  hasParcelGeometry: false,
  sourceConfidence: 'high',
  conflicts: [],
  explanation: 'Confirmed against the official parcel record.',
};

function ctx(overrides: Partial<MissionChildContext> = {}): MissionChildContext {
  return {
    missionId: 'di_test',
    scope: 'deal_card',
    scopeId: 32,
    upstream: {},
    provider: { mode: 'deterministic', providerId: null, providerLabel: null, modelId: null, environmentId: null, source: 'deterministic', available: true, liveRouting: false, reason: 'deterministic' },
    ...overrides,
  };
}

function outcome<T>(status: SpecialistOutcome<T>['status'], data: T, summary = 'ok'): SpecialistOutcome<T> {
  return { status, summary, data };
}

function collectors(overrides: Partial<PropertyIntelligenceCollectors> = {}): PropertyIntelligenceCollectors {
  return {
    parcel_identity: async () => outcome('completed', {
      capabilityResolution: 'RESOLVED', capabilityInvocationId: 'cap-test',
      identity: CONFIRMED_IDENTITY,
      facts: [],
      subjectMarket: { state: 'TN', county: 'Roane', acres: 12.28 },
      subjectAcres: 12.28,
      acreageConflict: false,
    }),
    government_records: async () => outcome('completed', { records: [] }),
    zoning_land_use: async () => outcome('completed', { zoning: 'A-1', zoningKnown: true, items: [], facts: [] }),
    environmental_terrain: async () => outcome('completed', { items: [], constraints: [] }),
    access_utilities: async () => outcome('completed', { items: [], accessStatus: 'public_road_proximity', utilitiesKnown: true, utilitiesSummary: 'Power at the road.' }),
    comparables: async () => outcome('completed', { candidates: [], duplicatesMerged: 0 }),
    market_intelligence: async () => outcome('completed', { facts: [], summary: '' }),
    evidence_visuals: async () => ({ status: 'completed', summary: '', data: { evidence: [] }, evidence: [] }),
    ...overrides,
  };
}

const caps = (overrides: Partial<DealIntelligenceCapabilities> = {}): DealIntelligenceCapabilities => ({
  collectors: collectors(),
  ...overrides,
});

describe('Deal Intelligence mission definition', () => {
  it('lays out in dependency waves with every Item 19 specialist declared', () => {
    const waves = planMissionWaves(DEAL_INTELLIGENCE_CHILDREN);
    expect(waves[0]).toEqual(['parcel_identity']);
    expect(dealIntelligenceChildSpec('parcel_identity').timeoutMs).toBe(420_000);
    const keys = DEAL_INTELLIGENCE_CHILDREN.map((spec) => spec.key);
    for (const required of [
      'parcel_identity', 'government_records', 'zoning_land_use', 'environmental_terrain',
      'access_utilities', 'comparables', 'market_intelligence', 'evidence_visuals', 'valuation', 'strategy',
    ]) {
      expect(keys).toContain(required);
    }
  });

  it('runs strategy in the LAST wave, after every research lane and the valuation', () => {
    const waves = planMissionWaves(DEAL_INTELLIGENCE_CHILDREN);
    const waveOf = (key: string): number => waves.findIndex((wave) => wave.includes(key));
    const strategyWave = waveOf('strategy');
    expect(strategyWave).toBe(waves.length - 1);
    for (const research of ['government_records', 'zoning_land_use', 'environmental_terrain', 'access_utilities', 'comparables', 'market_intelligence', 'valuation']) {
      expect(waveOf(research)).toBeLessThan(strategyWave);
    }
    // Valuation orders after comparables even though it does not REQUIRE them.
    expect(waveOf('comparables')).toBeLessThan(waveOf('valuation'));
    // Comparables starts with the other identity-dependent research lanes.
    expect(waveOf('comparables')).toBe(waveOf('government_records'));
  });

  it('declares comparables and the constraint lanes as awaited, never required, by valuation and strategy', () => {
    // This is the Phase 5 rule: a missing lane may change a conclusion, it may
    // never cancel one. `dependsOn` skips a child; `awaits` only orders it.
    const valuation = dealIntelligenceChildSpec('valuation');
    expect(valuation.dependsOn).toEqual(['parcel_identity']);
    expect(valuation.awaits).toContain('comparables');
    expect(valuation.awaits).toContain('environmental_terrain');

    const strategy = dealIntelligenceChildSpec('strategy');
    expect(strategy.dependsOn).toEqual(['valuation', 'parcel_identity']);
    expect(strategy.awaits).toEqual(expect.arrayContaining(['zoning_land_use', 'government_records', 'access_utilities']));
    // Strategy awaits ONLY lanes its executor actually reads. Comp evidence
    // reaches it through the valuation handback, and valuation already awaits
    // comparables, so a direct edge would be ordering nothing consumes.
    expect(strategy.awaits ?? []).not.toContain('comparables');
    for (const awaited of strategy.awaits ?? []) {
      expect(['government_records', 'zoning_land_use', 'environmental_terrain', 'access_utilities', 'market_intelligence']).toContain(awaited);
    }
  });

  it('hands an awaited child the handbacks that actually landed', () => {
    const children = new Map<string, MissionChildState>();
    const put = (key: string, status: MissionChildState['status'], result: unknown): void => {
      children.set(key, {
        key, label: key, purpose: '', role: 'required', dependsOn: [],
        identity: missionChildIdentity({ key, label: key, purpose: '', role: 'required', dependsOn: [], timeoutMs: 1 }),
        status, summary: '', acceptance: null, provider: null, failureCategory: null, failureMessage: null,
        retryable: false, result, startedAt: null, completedAt: null, durationMs: null, attempt: 1,
      });
    };
    put('parcel_identity', 'completed', { a: 1 });
    put('comparables', 'completed', { b: 2 });
    put('environmental_terrain', 'blocked', { c: 3 });

    const upstream = upstreamContributions(dealIntelligenceChildSpec('valuation'), children);
    expect(upstream.parcel_identity).toEqual({ a: 1 });
    expect(upstream.comparables).toEqual({ b: 2 });
    // A blocked lane contributed nothing, so it is ABSENT rather than present
    // and empty. Absent means "delivered nothing", which is the honest reading.
    expect(upstream).not.toHaveProperty('environmental_terrain');
  });

  it('assigns every child a roster specialist, a group and a unique contribution slot', () => {
    const slots = new Set<string>();
    for (const spec of DEAL_INTELLIGENCE_CHILDREN) {
      expect(spec.agentKey, `${spec.key} has no specialist`).toBeTruthy();
      expect(spec.group, `${spec.key} has no group`).toBeTruthy();
      const identity = missionChildIdentity(spec, 'm1');
      expect(identity.agentName).not.toBe('Unassigned specialist');
      expect(slots.has(identity.contributionSlot)).toBe(false);
      slots.add(identity.contributionSlot);
    }
  });

  it('declares every lane deterministic, so no lane names a provider or implies spend', () => {
    for (const spec of DEAL_INTELLIGENCE_CHILDREN) {
      expect(spec.provider?.mode, `${spec.key}`).toBe('deterministic');
    }
  });

  it('builds a definition the runner can consume', () => {
    const definition = dealIntelligenceMissionDefinition(caps());
    expect(definition.kind).toBe(DEAL_INTELLIGENCE_KIND);
    for (const spec of DEAL_INTELLIGENCE_CHILDREN) {
      expect(typeof definition.executors[spec.key]).toBe('function');
    }
  });
});

describe('Deal Intelligence acceptance contracts', () => {
  const accept = (key: string, result: unknown, reported: 'completed' | 'partial' = 'completed') =>
    evaluateMissionAcceptance(
      dealIntelligenceChildSpec(key).acceptance,
      { kind: 'returned', reported, summary: 'x', result },
      { scope: 'deal_card', scopeId: 32, childKey: key, childLabel: key },
    );

  it('REJECTS a comparables handback that reports government-record verification', () => {
    const verdict = accept('comparables', {
      dealCardId: 32, sources: ['Zillow'], candidateCount: 2, candidates: [],
      duplicatesMerged: 0, governmentVerificationPerformed: true, summary: '',
    } as unknown as ComparablesHandback);
    expect(verdict.state).toBe('rejected');
    expect(verdict.reason).toMatch(/out of scope/i);
  });

  it('REJECTS a comparables handback sourced from a government record', () => {
    const verdict = accept('comparables', {
      dealCardId: 32, sources: ['Zillow', 'Roane County Assessor'], candidateCount: 2,
      candidates: [], duplicatesMerged: 0, governmentVerificationPerformed: false, summary: '',
    });
    expect(verdict.state).toBe('rejected');
    expect(verdict.reason).toMatch(/Assessor/);
  });

  it('accepts comparables from the approved marketplaces only', () => {
    const verdict = accept('comparables', {
      dealCardId: 32, sources: ['LandPortal visible', 'Zillow', 'Redfin'], candidateCount: 4,
      candidates: [], duplicatesMerged: 0, governmentVerificationPerformed: false, summary: '',
    });
    expect(verdict.state).toBe('accepted');
  });

  it('does NOT reject the lane over rows previously persisted from another comp provider', () => {
    // Realie/HomeHarvest rows already accepted onto the card are comp data, not
    // government records. Rejecting the lane over them would discard every real
    // comp it collected and leave the property unpriceable.
    const verdict = accept('comparables', {
      dealCardId: 32, sources: ['LandPortal visible', 'Zillow', 'realie', 'homeharvest'],
      candidateCount: 12, candidates: [], duplicatesMerged: 0, governmentVerificationPerformed: false, summary: '',
    });
    expect(verdict.state).toBe('incomplete');
    expect(verdict.reason).toMatch(/previously persisted/i);
    // Still contributes, so the comps and the valuation survive.
    expect(['rejected', 'failed']).not.toContain(verdict.state);
  });

  it('accepts a marketplace comp that carries an APN, county and a county GIS link', () => {
    // Incidental property identifiers on a Zillow/Redfin/LandPortal record are
    // NOT government-record research. The rule reads provider names only, so a
    // usable comp is never rejected for carrying a parcel number or a map link.
    const verdict = accept('comparables', {
      dealCardId: 32,
      sources: ['Zillow', 'Redfin', 'LandPortal visible'],
      candidateCount: 3,
      candidates: [
        { provider: 'Zillow', apn: '073090 04200', state: 'TN', addressDesc: '0 Ellis Rd', sourceUrl: 'https://maps.roanecountytn.gov/gis/parcel?pin=073090' },
        { provider: 'Redfin', apn: '001 003 01205', addressDesc: 'Ridge Circle Rd', sourceUrl: 'https://www.redfin.com/TN/Kingston/x' },
        { provider: 'LandPortal visible', apn: null, addressDesc: 'Old Ridge Rd', sourceUrl: 'https://landportal.com/parcel/123' },
      ],
      duplicatesMerged: 0, governmentVerificationPerformed: false, summary: '',
    });
    expect(verdict.state).toBe('accepted');
  });

  it('is not a completeness gate: comps missing acreage, price or date still contribute', () => {
    // Whether a thin comp can price the subject is the comp source policy's and
    // the valuation lane's decision, not this contract's.
    const verdict = accept('comparables', {
      dealCardId: 32, sources: ['Redfin'], candidateCount: 2,
      candidates: [
        { provider: 'Redfin', addressDesc: '0 Ellis Rd', price: 75000, acres: null, saleOrListDate: null },
        { provider: 'Redfin', addressDesc: 'Melea Ln', price: null, acres: 2.04, saleOrListDate: null },
      ],
      duplicatesMerged: 0, governmentVerificationPerformed: false, summary: '',
    });
    expect(verdict.state).toBe('accepted');
  });

  it('STILL rejects a government source even alongside approved marketplaces', () => {
    const verdict = accept('comparables', {
      dealCardId: 32, sources: ['Zillow', 'realie', 'Roane County Assessor'], candidateCount: 5,
      candidates: [], duplicatesMerged: 0, governmentVerificationPerformed: false, summary: '',
    });
    expect(verdict.state).toBe('rejected');
    expect(verdict.reason).toMatch(/Assessor/);
  });

  it('accepts an empty comparable set as INCOMPLETE, never rejected', () => {
    // A source that honestly returned nothing has still delivered a result.
    const verdict = accept('comparables', {
      dealCardId: 32, sources: [], candidateCount: 0, candidates: [],
      duplicatesMerged: 0, governmentVerificationPerformed: false, summary: '',
    });
    expect(verdict.state).toBe('incomplete');
  });

  it('accepts a zoning lane that honestly states the district is not established', () => {
    const verdict = accept('zoning_land_use', {
      dealCardId: 32, zoningKnown: false, zoning: null,
      items: [{ key: 'zoning', label: 'Zoning', verdict: 'unknown', headline: 'Not established.', grade: 'unresolved_question', detail: null, sourceUrl: null, missing: ['District unknown.'] }],
      facts: [], summary: '',
    });
    expect(verdict.state).toBe('incomplete');
    expect(verdict.reason).toMatch(/not established/i);
  });

  it('REJECTS a zoning lane that states nothing at all', () => {
    const verdict = accept('zoning_land_use', { dealCardId: 32, zoningKnown: false, zoning: null, items: [], facts: [], summary: '' });
    expect(verdict.state).toBe('rejected');
  });

  it('REJECTS a strategy handback that invents a sixth strategy', () => {
    const strategies = [...APPROVED_STRATEGY_NAMES, 'Seller Financing Wrap'].map((strategy) => ({
      strategy, applicability: 'conditional', supportingFacts: [], blockers: [], effort: '', timeline: '',
      valueCreationPath: '', risk: '', nextVerificationStep: '',
    }));
    const verdict = accept('strategy', {
      dealCardId: 32, strategyCount: strategies.length, strategies,
      recommendation: { preferredStrategy: APPROVED_STRATEGY_NAMES[0], why: 'because', whatWouldChangeIt: [], posture: 'pursue', postureWhy: '' },
      informedBy: [], missingInputs: [], summary: '',
    });
    expect(verdict.state).toBe('rejected');
    expect(verdict.reason).toMatch(/Unapproved strategy type/);
  });

  it('REJECTS a valuation that claims priceable with no usable band', () => {
    const verdict = accept('valuation', {
      dealCardId: 32, priceable: true,
      valuation: { priceable: true, range: null, basis: 'b', confidence: 'low' },
      comps: {}, acceptedSoldCount: 0, activeListingCount: 0, landHomeCompCount: 0, summary: '',
    });
    expect(verdict.state).toBe('rejected');
  });

  it('accepts a stated "not priceable" as a real valuation answer', () => {
    const verdict = accept('valuation', {
      dealCardId: 32, priceable: false,
      valuation: { priceable: false, range: null, basis: 'No closed sale survived the policy.', confidence: 'none', notPriceableReason: 'No usable closed sale.' },
      comps: {}, acceptedSoldCount: 0, activeListingCount: 0, landHomeCompCount: 0, summary: '',
    }, 'partial');
    expect(verdict.state).toBe('incomplete');
    expect(['rejected', 'failed']).not.toContain(verdict.state);
  });

  it('REJECTS any handback that names a different Deal Card', () => {
    const verdict = accept('government_records', { dealCardId: 47, appliesTo: 'subject_property', recordCount: 3, records: [], evidence: [], summary: '' });
    expect(verdict.state).toBe('rejected');
    expect(verdict.reason).toMatch(/different record/i);
  });

  it('REJECTS government records that claim a scope beyond the subject property', () => {
    const verdict = accept('government_records', { dealCardId: 32, appliesTo: 'comparables', recordCount: 3, records: [], evidence: [], summary: '' });
    expect(verdict.state).toBe('rejected');
    expect(verdict.reason).toMatch(/subject-property/i);
  });
});

describe('Deal Intelligence executors', () => {
  it('resolves the subject identity in the canonical root lane', async () => {
    const executors = dealIntelligenceExecutors(caps());
    const result = await executors.parcel_identity(ctx());
    const handback = result.result as SubjectResearchHandback;
    expect(handback.apn).toBe('073090 04200');
    expect(handback.dealCardId).toBe(32);
  });

  it.each(['AMBIGUOUS', 'UNRESOLVED', 'ERROR'] as const)('blocks the root handback when Property Resolution returns %s', async (capabilityResolution) => {
    const blockedCollectors = collectors({
      parcel_identity: async () => outcome('partial', {
        capabilityResolution,
        capabilityInvocationId: `cap-${capabilityResolution.toLowerCase()}`,
        // Even a caller that tries to dress the handback up as confirmed cannot
        // bypass the canonical Capability result.
        identity: CONFIRMED_IDENTITY,
        facts: [], subjectMarket: { state: 'TN', county: 'Roane' }, subjectAcres: 12.28, acreageConflict: false,
      }),
    });
    const result = await dealIntelligenceExecutors({ collectors: blockedCollectors }).parcel_identity(ctx());
    expect(result.status).toBe('blocked');
    expect(result.result).toBeUndefined();
  });

  it('keeps government attempts supporting so they cannot block comps or market intelligence', () => {
    const government = dealIntelligenceChildSpec('government_records');
    const comparables = dealIntelligenceChildSpec('comparables');
    const market = dealIntelligenceChildSpec('market_intelligence');
    expect(government.role).toBe('supporting');
    expect(comparables.dependsOn).toEqual(['parcel_identity']);
    expect(market.dependsOn).toEqual(['parcel_identity']);
    expect(comparables.dependsOn).not.toContain('government_records');
    expect(market.dependsOn).not.toContain('government_records');
  });

  it('never claims government verification on comparables', async () => {
    const executors = dealIntelligenceExecutors(caps());
    const result = await executors.comparables(ctx());
    const handback = result.result as ComparablesHandback;
    expect(handback.governmentVerificationPerformed).toBe(false);
  });

  it('does not count government limitation placeholders as retrieved records', async () => {
    const executors = dealIntelligenceExecutors(caps({
      collectors: collectors({
        government_records: async () => outcome('partial', {
          records: [
            {
              key: 'document_completeness', label: 'Recorded document completeness',
              value: 'missing', grade: 'unresolved_question', source: 'County records',
              sourceUrl: null, retrievedAt: AT, note: 'No artifact retained.',
            },
            {
              key: 'survey_plat', label: 'Survey or plat', value: 'not searched',
              grade: 'unavailable_public_record', source: 'County records',
              sourceUrl: null, retrievedAt: AT, note: null,
            },
          ],
        }, 'No official collector returned a subject record.'),
      }),
    }));
    const result = await executors.government_records(ctx());
    expect((result.result as { recordCount: number }).recordCount).toBe(0);
  });

  it('does not count unknown cards as environmental screens when no collector ran', async () => {
    const executors = dealIntelligenceExecutors(caps({
      collectors: collectors({
        environmental_terrain: async () => outcome('partial', {
          items: [{
            key: 'wetlands', label: 'Wetlands', verdict: 'unknown',
            headline: 'Not screened', grade: 'unresolved_question', detail: null,
            sourceUrl: null, missing: ['Collector did not run.'],
          }],
          constraints: [],
        }, 'No environmental collector ran.'),
      }),
    }));
    const result = await executors.environmental_terrain(ctx());
    expect((result.result as { screenedLaneCount: number }).screenedLaneCount).toBe(0);
  });

  it('prices from an empty comp set as a stated "not priceable", not a failure', async () => {
    const executors = dealIntelligenceExecutors(caps());
    const result = await executors.valuation(ctx({
      upstream: {
        parcel_identity: {
          dealCardId: 32, identity: CONFIRMED_IDENTITY, subjectMarket: { state: 'TN', county: 'Roane' },
          subjectAcres: 12.28, acreageConflict: false, facts: [],
        },
      },
    }));
    const handback = result.result as ValuationHandback;
    expect(result.status).toBe('partial');
    expect(handback.priceable).toBe(false);
    expect(handback.valuation.notPriceableReason).toBeTruthy();
  });

  it('evaluates all five approved strategies with missing lanes disclosed, not blocking', async () => {
    const executors = dealIntelligenceExecutors(caps());
    const valuationResult = await executors.valuation(ctx({
      upstream: {
        parcel_identity: { dealCardId: 32, identity: CONFIRMED_IDENTITY, subjectMarket: {}, subjectAcres: 12.28, acreageConflict: false, facts: [] },
      },
    }));
    const result = await executors.strategy(ctx({
      upstream: {
        parcel_identity: { dealCardId: 32, identity: CONFIRMED_IDENTITY, subjectMarket: {}, subjectAcres: 12.28, acreageConflict: false, facts: [] },
        valuation: valuationResult.result,
        // Zoning, environmental, access, government records and market did NOT land.
      },
    }));
    const handback = result.result as StrategyHandback;
    expect(handback.strategies.map((s) => s.strategy)).toEqual([...APPROVED_STRATEGY_NAMES]);
    // The lane still produced an answer; the gaps are disclosed on it.
    expect(result.status).toBe('partial');
    expect(handback.missingInputs.length).toBeGreaterThan(0);
    expect(handback.missingInputs.join(' ')).toMatch(/Zoning/);
  });

  it('reads the CONFIRMED identity, so it never blames identity work on a confirmed parcel', async () => {
    // Regression: strategy listed neither parcel_identity nor its handback, so it
    // fell back to "unresolved" and told the operator to go do identity work on a
    // parcel that was already confirmed against the official record.
    const executors = dealIntelligenceExecutors(caps());
    const identityHandback = {
      dealCardId: 32, identity: CONFIRMED_IDENTITY, subjectMarket: {}, subjectAcres: 12.28,
      acreageConflict: false, facts: [], identityState: 'confirmed' as const,
    };
    const valuationResult = await executors.valuation(ctx({ upstream: { parcel_identity: identityHandback } }));
    const result = await executors.strategy(ctx({
      upstream: { parcel_identity: identityHandback, valuation: valuationResult.result },
    }));
    const handback = result.result as StrategyHandback;
    const text = [handback.recommendation.postureWhy, handback.recommendation.why].join(' ');
    expect(text).not.toMatch(/identity work/i);
    expect(handback.strategies).toHaveLength(5);
  });

  it('blocks strategy honestly when no valuation contributed', async () => {
    const executors = dealIntelligenceExecutors(caps());
    const result = await executors.strategy(ctx({ upstream: {} }));
    expect(result.status).toBe('blocked');
    expect(result.result).toBeUndefined();
    expect(result.summary).toMatch(/valuation lane produced no result/i);
  });

  it('states market coverage honestly when neither matrix nor pulse resolves', async () => {
    const executors = dealIntelligenceExecutors(caps({
      marketPulse: async () => ({ marketMatrix: null, marketPulse: null, facts: [], summary: 'Nothing resolved.' }),
    }));
    const result = await executors.market_intelligence(ctx());
    expect(result.status).toBe('blocked');
    expect((result.result as { marketMatrixAvailable: boolean }).marketMatrixAvailable).toBe(false);
  });

  it('keeps the county Market Research acreage matrix supplied by the live market capability', async () => {
    const retained = {
      bands: [{ band: '2-5', soldVolume: 22, snapshotPeriod: '2026-Q2' }],
      bestMovingBands: ['2-5'],
    };
    const executors = dealIntelligenceExecutors(caps({
      marketPulse: async () => ({
        marketMatrix: { title: 'County matrix' },
        marketPulse: null,
        marketScan: { acreageMatrix: retained },
        facts: [],
        summary: 'County matrix resolved.',
      }),
    }));
    const result = await executors.market_intelligence(ctx());
    const scan = (result.result as { marketScan: { acreageMatrix: unknown } }).marketScan;
    expect(scan.acreageMatrix).toEqual(retained);
  });
});
