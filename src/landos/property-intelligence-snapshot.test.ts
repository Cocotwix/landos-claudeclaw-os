import { describe, expect, it } from 'vitest';
import {
  apnEquivalent,
  distinctApnIdentities,
  distinctNumericValues,
  formatCanonicalNumber,
  initialSpecialistRecords,
  joinPropertyIntelligence,
  normalizeApn,
  numericallyEquivalent,
  presentPropertyIntelligenceSnapshot,
  reconcilePropertyIntelligenceSnapshot,
  resolveCanonicalAcreage,
  resolveValuationScope,
  type SnapshotIdentity,
  type SnapshotJoinInput,
  type SnapshotSpecialistRecord,
} from './property-intelligence-snapshot.js';
import { PROPERTY_INTELLIGENCE_SPECIALISTS, specialistWaves } from './property-intelligence-specialists.js';

const CONFIRMED_IDENTITY: SnapshotIdentity = {
  state: 'confirmed',
  normalizedAddress: 'OLD RIDGE RD, Roane County, TN',
  county: 'Roane',
  state_: 'TN',
  apn: '073090 04200',
  apnVariants: ['073090 04200'],
  owner: 'SACHAN DILEEP S',
  ownerMailing: null,
  situs: 'OLD RIDGE RD',
  acres: 12.28,
  acreageBasis: 'deeded',
  coordinates: { lat: 35.9, lng: -84.5 },
  hasParcelGeometry: true,
  sourceConfidence: 'high',
  conflicts: [],
  explanation: 'Confirmed on the official Tennessee Comptroller parcel layer.',
};

function specialists(overrides: Partial<Record<string, Partial<SnapshotSpecialistRecord>>> = {}): SnapshotSpecialistRecord[] {
  return initialSpecialistRecords().map((record) => ({
    ...record,
    status: 'completed',
    startedAt: '2026-07-25T00:00:00.000Z',
    completedAt: '2026-07-25T00:01:00.000Z',
    durationMs: 60_000,
    summary: `${record.label} delivered.`,
    ...(overrides[record.id] ?? {}),
  })) as SnapshotSpecialistRecord[];
}

function joinInput(overrides: Partial<SnapshotJoinInput> = {}): SnapshotJoinInput {
  return {
    dealCardId: 32,
    runId: 'pi_test_1',
    sequence: 1,
    startedAt: '2026-07-25T00:00:00.000Z',
    completedAt: '2026-07-25T00:05:00.000Z',
    identity: CONFIRMED_IDENTITY,
    facts: [],
    governmentRecords: [],
    dueDiligence: [],
    comps: {
      policyExplanation: 'LandPortal primary.',
      landPortalUsable: true,
      landPortalRowsSeen: 0,
      caps: { zillow: 2, redfin: 2 },
      sold: [], active: [], landHomeOnly: [], rejected: [],
      duplicatesMerged: 0,
      summaryLine: '',
    },
    valuation: {
      priceable: true,
      range: { low: 40_000, high: 60_000 },
      pricePerAcreRange: { low: 3_000, high: 5_000 },
      likelyRetail: { low: 55_000, high: 65_000 },
      dispositionRange: { low: 35_000, high: 45_000 },
      basis: 'Four accepted LandPortal closed sales.',
      adjustments: [],
      confidence: 'medium',
      uncertainty: [],
      materialGaps: [],
      notPriceableReason: null,
      nextActionToPrice: null,
    },
    strategies: [],
    recommendation: {
      preferredStrategy: 'Quick Flip',
      why: 'Priced band supports a quick resale.',
      whatWouldChangeIt: [],
      posture: 'pursue',
      postureWhy: 'Value basis exists and no hard blocker was found.',
    },
    evidence: [],
    specialists: specialists(),
    ...overrides,
  };
}

describe('normalizeApn / apnEquivalent', () => {
  it('collapses spaces, dashes and leading zeros', () => {
    expect(normalizeApn('073090 04200')).toBe('7309004200');
    expect(normalizeApn('073-090-042.00')).toBe('7309004200');
    expect(normalizeApn('  07309004200  ')).toBe('7309004200');
  });

  it('treats formatting-only differences as the same parcel', () => {
    expect(apnEquivalent('073090 04200', '073-090 042.00')).toBe(true);
    expect(apnEquivalent('073090 04200', '73090 04200')).toBe(true);
  });

  it('still separates genuinely different identifiers', () => {
    expect(apnEquivalent('073090 04200', '073090 04201')).toBe(false);
    expect(apnEquivalent('073090 04200', null)).toBe(false);
    expect(apnEquivalent('', '')).toBe(false);
  });

  it('reduces a spelling set to distinct identities', () => {
    expect(distinctApnIdentities(['073090 04200', '073-090-042.00', '73090 04200'])).toHaveLength(1);
    expect(distinctApnIdentities(['073090 04200', '073090 04201'])).toHaveLength(2);
    expect(distinctApnIdentities([null, '', '  '])).toEqual([]);
  });
});

describe('specialist graph', () => {
  it('orders every specialist into dependency-respecting waves', () => {
    const waves = specialistWaves();
    const seen = new Set<string>();
    for (const wave of waves) {
      for (const id of wave) {
        for (const dep of PROPERTY_INTELLIGENCE_SPECIALISTS.find((s) => s.id === id)!.dependsOn) {
          expect(seen.has(dep)).toBe(true);
        }
      }
      for (const id of wave) seen.add(id);
    }
    expect(seen.size).toBe(PROPERTY_INTELLIGENCE_SPECIALISTS.length);
  });

  it('starts every specialist queued', () => {
    const records = initialSpecialistRecords();
    expect(records).toHaveLength(PROPERTY_INTELLIGENCE_SPECIALISTS.length);
    expect(records.every((r) => r.status === 'queued')).toBe(true);
  });
});

describe('joinPropertyIntelligence', () => {
  it('reports complete only when every required specialist contributed', () => {
    const snapshot = joinPropertyIntelligence(joinInput());
    expect(snapshot.status).toBe('complete');
    expect(snapshot.headline.confidence).toBe('high');
    expect(snapshot.missingInformation).toEqual([]);
  });

  it('keeps discovery-usable provisional identity actionable without overstating official confirmation', () => {
    const snapshot = joinPropertyIntelligence(joinInput({
      identity: {
        ...CONFIRMED_IDENTITY,
        state: 'provisional',
        discoveryUsable: true,
        discoveryBasis:
          'Supplied APN and authenticated LandPortal parcel evidence consistently identify the subject.',
        sourceConfidence: 'medium',
        explanation:
          'Discovery-stage identity is usable, while official county confirmation remains outstanding.',
      },
    }));

    expect(snapshot.headline.keyOpportunity).toContain('Quick Flip');
    expect(snapshot.headline.keyOpportunity).not.toContain('No opportunity');
    expect(snapshot.nextActions).toEqual(
      expect.arrayContaining([expect.stringContaining('binding offer or closing')]),
    );
    expect(snapshot.nextActions.join(' ')).not.toContain(
      'before relying on any parcel-specific conclusion',
    );
  });

  it('presents a persisted snapshot through the current join policy without changing run evidence', () => {
    const current = joinPropertyIntelligence(joinInput({
      identity: {
        ...CONFIRMED_IDENTITY,
        state: 'provisional',
        discoveryUsable: true,
        sourceConfidence: 'medium',
      },
    }));
    const stored = {
      ...current,
      missionId: 'mission_history_1',
      browserCleanup: { before: 4, after: 3, closed: 1, note: 'Owned page closed.' },
      headline: {
        ...current.headline,
        keyOpportunity: 'No opportunity can be stated until the subject parcel is identified against an official record.',
      },
      nextActions: [
        'Resolve parcel identity against the official county/state parcel layer before relying on any parcel-specific conclusion.',
      ],
    };

    const presented = presentPropertyIntelligenceSnapshot(stored);

    expect(presented.headline.keyOpportunity).toContain('Quick Flip');
    expect(presented.nextActions.join(' ')).toContain('binding offer or closing');
    expect(presented.runId).toBe(stored.runId);
    expect(presented.evidence).toBe(stored.evidence);
    expect(presented.missionId).toBe('mission_history_1');
    expect(presented.browserCleanup).toEqual(stored.browserCleanup);
  });

  it('never claims completeness when a required specialist failed', () => {
    const snapshot = joinPropertyIntelligence(joinInput({
      specialists: specialists({
        government_records: {
          status: 'failed',
          failureCategory: 'provider_unavailable',
          failureMessage: 'County record host returned 503.',
          retryable: true,
          summary: 'County record host returned 503.',
        },
      }),
    }));
    expect(snapshot.status).toBe('complete_with_gaps');
    expect(snapshot.missingInformation.join(' ')).toMatch(/Government records: failed \(provider_unavailable\)/);
    expect(snapshot.nextActions.join(' ')).toMatch(/Re-run Property Intelligence to retry Government records/);
  });

  it('keeps an unresolved parcel blocked and confidenceless', () => {
    const snapshot = joinPropertyIntelligence(joinInput({
      identity: {
        ...CONFIRMED_IDENTITY,
        state: 'unresolved',
        apn: null,
        explanation: 'No official parcel record matched the intake address.',
      },
    }));
    expect(snapshot.status).toBe('blocked_identity');
    expect(snapshot.headline.confidence).toBe('none');
    expect(snapshot.blockers.join(' ')).toMatch(/has not been identified against an official record/);
    expect(snapshot.nextActions.join(' ')).toMatch(/Resolve parcel identity/);
  });

  it('keeps a conflicted parcel visible as a blocker', () => {
    const snapshot = joinPropertyIntelligence(joinInput({
      identity: {
        ...CONFIRMED_IDENTITY,
        state: 'conflicted',
        conflicts: ['Two distinct APNs match the address: 073090 04200 and 073090 04201.'],
        explanation: 'Two official records disagree.',
      },
    }));
    expect(snapshot.status).toBe('blocked_identity');
    expect(snapshot.blockers.join(' ')).toMatch(/conflicted and must be resolved/);
    expect(snapshot.blockers.join(' ')).toMatch(/073090 04201/);
  });

  it('surfaces the not-priceable reason and its next action', () => {
    const snapshot = joinPropertyIntelligence(joinInput({
      valuation: {
        ...joinInput().valuation,
        priceable: false,
        range: null,
        pricePerAcreRange: null,
        likelyRetail: null,
        dispositionRange: null,
        confidence: 'none',
        notPriceableReason: 'No accepted vacant-land closed sale exists for this market.',
        nextActionToPrice: 'Widen the LandPortal comp radius and re-run Property Intelligence.',
      },
    }));
    expect(snapshot.blockers.join(' ')).toMatch(/No accepted vacant-land closed sale/);
    expect(snapshot.nextActions.join(' ')).toMatch(/Widen the LandPortal comp radius/);
    expect(snapshot.headline.keyOpportunity).toMatch(/no priced opportunity can be stated/);
  });

  it('names a skipped specialist rather than hiding it', () => {
    const snapshot = joinPropertyIntelligence(joinInput({
      specialists: specialists({
        zoning_land_use: { status: 'skipped', summary: 'Skipped because parcel identity is not confirmed.' },
      }),
    }));
    expect(snapshot.missingInformation.join(' ')).toMatch(/Zoning and land use: skipped/);
    expect(snapshot.status).toBe('complete_with_gaps');
  });

  it('marks the run running while any specialist is unsettled', () => {
    const snapshot = joinPropertyIntelligence(joinInput({
      completedAt: null,
      specialists: specialists({ comparables: { status: 'running' } }),
    }));
    expect(snapshot.status).toBe('running');
    expect(snapshot.durationMs).toBeNull();
  });

  it('does not lower confidence for a missing supporting specialist alone', () => {
    const snapshot = joinPropertyIntelligence(joinInput({
      specialists: specialists({ market_intelligence: { status: 'failed', failureCategory: 'network', failureMessage: 'DNS failure.', retryable: true } }),
    }));
    expect(snapshot.headline.confidence).toBe('high');
    expect(snapshot.status).toBe('complete');
    expect(snapshot.missingInformation.join(' ')).toMatch(/Market intelligence: failed \(network\)/);
  });

  it('deduplicates repeated blockers and next actions', () => {
    const snapshot = joinPropertyIntelligence(joinInput({
      extraBlockers: ['Parcel identity is conflicted and must be resolved before any parcel-specific conclusion is used. Two official records disagree.'],
      identity: { ...CONFIRMED_IDENTITY, state: 'conflicted', explanation: 'Two official records disagree.' },
    }));
    const occurrences = snapshot.blockers.filter((b) => b.startsWith('Parcel identity is conflicted'));
    expect(occurrences).toHaveLength(1);
  });
});

describe('monotonic snapshot promotion', () => {
  it('keeps confirmed facts and priceable valuation when a same-property rerun is weaker', () => {
    const retained = joinPropertyIntelligence(joinInput({
      facts: [{
        key: 'owner', label: 'Owner', value: 'Dileep Sachan', grade: 'confirmed_fact',
        source: 'County assessor', sourceUrl: 'https://county.example/parcel',
        retrievedAt: '2026-08-01T10:00:00.000Z', note: null,
      }],
    }));
    const incoming = joinPropertyIntelligence(joinInput({
      runId: 'pi_test_2', sequence: 2,
      identity: { ...CONFIRMED_IDENTITY, state: 'provisional', discoveryUsable: true },
      facts: [{
        key: 'owner', label: 'Owner', value: '', grade: 'likely_indication',
        source: 'Context provider', sourceUrl: null,
        retrievedAt: '2026-08-01T11:00:00.000Z', note: null,
      }],
      valuation: {
        ...joinInput().valuation, priceable: false, range: null, pricePerAcreRange: null,
        likelyRetail: null, dispositionRange: null, confidence: 'none',
        notPriceableReason: 'Provider timed out.', nextActionToPrice: 'Retry provider.',
      },
    }));

    const reconciled = reconcilePropertyIntelligenceSnapshot(retained, incoming);
    expect(reconciled.promotable).toBe(true);
    expect(reconciled.snapshot.identity.state).toBe('confirmed');
    expect(reconciled.snapshot.facts.find((fact) => fact.key === 'owner')?.value).toBe('Dileep Sachan');
    expect(reconciled.snapshot.valuation.priceable).toBe(true);
    expect(reconciled.snapshot.runId).toBe('pi_test_2');
  });

  it('refuses to promote a rerun for a conflicting parcel', () => {
    const retained = joinPropertyIntelligence(joinInput());
    const incoming = joinPropertyIntelligence(joinInput({
      runId: 'pi_wrong', sequence: 2,
      identity: { ...CONFIRMED_IDENTITY, apn: '073090 99999', apnVariants: ['073090 99999'] },
    }));
    const reconciled = reconcilePropertyIntelligenceSnapshot(retained, incoming);
    expect(reconciled.promotable).toBe(false);
    expect(reconciled.reason).toMatch(/conflicts with the retained canonical property/);
  });
});

// The comp tiles are unioned across runs while the narrative sentence and the
// priceability verdict used to be inherited verbatim from the incoming run.
// That is how the operator read "4 asking" beside "0 asking-market reference(s)"
// and a not_priceable verdict beside a non-empty asking lane.
describe('merged comp counts, sentence and verdict cannot contradict each other', () => {
  const compRow = (key: string) => ({
    key, source: 'LandPortal', sourceUrl: null, address: null, apn: key,
    price: 400_000, acres: 40, pricePerAcre: 10_000, dateIso: '2025-03-21',
    distanceMiles: null, note: null,
  }) as unknown as Parameters<typeof joinPropertyIntelligence>[0]['comps']['sold'][number];

  it('re-derives the summary line and conclusion from the merged rows', () => {
    const retained = joinPropertyIntelligence(joinInput({
      comps: {
        ...joinInput().comps,
        askingReferences: [compRow('a1'), compRow('a2'), compRow('a3'), compRow('a4')],
        totalCollected: 18,
        duplicatesMerged: 6,
        summaryLine: 'stale retained sentence',
        conclusion: 'asking_indication',
      },
    }));
    const incoming = joinPropertyIntelligence(joinInput({
      runId: 'pi_test_2', sequence: 2,
      comps: {
        ...joinInput().comps,
        askingReferences: [],
        totalCollected: 18,
        duplicatesMerged: 0,
        summaryLine: '0 accepted sold comp(s), 0 active competitor(s) and 0 asking-market reference(s) shown from 18 collected row(s); 0 duplicate(s) merged. Remaining rows are retained as evidence with a stated reason.',
        conclusion: 'not_priceable',
      },
    }));

    const merged = reconcilePropertyIntelligenceSnapshot(retained, incoming).snapshot.comps;
    expect(merged.askingReferences).toHaveLength(4);
    // The sentence must state the merged count, not the incoming run's zero.
    expect(merged.summaryLine).toContain('4 asking-market reference(s)');
    expect(merged.summaryLine).not.toContain('0 asking-market reference(s)');
    expect(merged.summaryLine).toContain('6 duplicate(s) merged');
    // A non-empty asking lane can never sit under a not_priceable verdict.
    expect(merged.conclusion).toBe('asking_indication');
  });

  it('keeps not_priceable when the merged rows really are empty', () => {
    const retained = joinPropertyIntelligence(joinInput({
      comps: { ...joinInput().comps, conclusion: 'not_priceable', summaryLine: 'stale' },
    }));
    const incoming = joinPropertyIntelligence(joinInput({
      runId: 'pi_test_3', sequence: 2,
      comps: { ...joinInput().comps, conclusion: 'asking_indication', summaryLine: 'stale' },
    }));
    const merged = reconcilePropertyIntelligenceSnapshot(retained, incoming).snapshot.comps;
    expect(merged.conclusion).toBe('not_priceable');
    expect(merged.summaryLine).toContain('0 asking-market reference(s)');
  });
});

// ── Canonical fact-once / agreement rule ─────────────────────────────────────
//
// The operator reads a resolved fact ONCE. Sources that agree become provenance
// underneath a single value, never four rows that read like a dispute. This is
// the numeric analogue of `apnEquivalent` / `distinctApnIdentities`.

describe('canonical fact-once — numeric agreement', () => {
  it('treats 60, 60.0 and 60.00 as one observation, not three', () => {
    const stated = ['60', '60.0', '60.00'].map(Number);
    expect(stated.every((value) => numericallyEquivalent(60, value))).toBe(true);
    expect(distinctNumericValues(stated)).toEqual([60]);
  });

  it('renders the single canonical spelling without trailing-zero noise', () => {
    expect(formatCanonicalNumber(60, 'AC')).toBe('60 AC');
    expect(formatCanonicalNumber(Number('60.00'), 'AC')).toBe('60 AC');
    expect(formatCanonicalNumber(60.25, 'AC')).toBe('60.25 AC');
    expect(formatCanonicalNumber(null, 'AC')).toBeNull();
  });

  it('collapses agreeing sources into one displayed acreage, provenance kept', () => {
    const fact = resolveCanonicalAcreage([
      { value: 60, source: 'LandPortal parcel' },
      { value: Number('60.0'), source: 'Operator intake' },
      { value: 60.002, source: 'Listing research' },
      { value: Number('60.00'), source: 'County assessor roll' },
    ]);
    expect(fact.display).toBe('60 AC');
    expect(fact.agreement).toBe('agreed');
    expect(fact.conflictNote).toBeNull();
    // ONE value displayed; every observation retained underneath.
    expect(fact.distinctValues).toEqual([60]);
    expect(fact.observations).toHaveLength(4);
    expect(fact.sources).toEqual([
      'LandPortal parcel', 'Operator intake', 'Listing research', 'County assessor roll',
    ]);
  });

  it('still reports a GENUINE second measurement as disputed', () => {
    const fact = resolveCanonicalAcreage([
      { value: 60, source: 'County assessor roll' },
      { value: 57.4, source: 'County GIS geometry' },
    ]);
    expect(fact.agreement).toBe('disputed');
    expect(fact.distinctValues).toEqual([60, 57.4]);
    expect(fact.conflictNote).toMatch(/60 AC vs 57.4 AC/);
  });

  it('says unknown rather than inventing a value when no source stated one', () => {
    const fact = resolveCanonicalAcreage([{ value: null, source: 'LandPortal parcel' }]);
    expect(fact.agreement).toBe('unknown');
    expect(fact.value).toBeNull();
    expect(fact.display).toBeNull();
  });
});

// ── Land-basis reference vs completed whole-property value ───────────────────

describe('valuation scope labelling', () => {
  it('9490-style improved subject: land basis only, whole-property pending', () => {
    const scope = resolveValuationScope({
      subjectImproved: true,
      improvementBasis: 'house and outbuildings',
      improvementsValued: false,
      landValuePriceable: true,
    });
    expect(scope.scope).toBe('land_only');
    expect(scope.figureKind).toBe('land_basis_reference');
    expect(scope.figureLabel).toMatch(/not a whole-property offer recommendation/i);
    expect(scope.wholeProperty.state).toBe('pending');
    expect(scope.wholeProperty.why).toMatch(/materially improved/i);
    expect(scope.wholeProperty.why).toMatch(/house and outbuildings/);
  });

  it('vacant subject with a supported land value IS the whole-property value', () => {
    const scope = resolveValuationScope({ subjectImproved: false, landValuePriceable: true });
    expect(scope.figureKind).toBe('whole_property_recommendation');
    expect(scope.wholeProperty.state).toBe('established');
  });

  it('vacant subject with no supported value states no whole-property value', () => {
    const scope = resolveValuationScope({ subjectImproved: false, landValuePriceable: false });
    expect(scope.figureKind).toBe('land_basis_reference');
    expect(scope.wholeProperty.state).toBe('pending');
  });

  it('only separately valued improvements promote the figures to whole-property', () => {
    const scope = resolveValuationScope({
      subjectImproved: true, improvementBasis: 'house', improvementsValued: true, landValuePriceable: true,
    });
    expect(scope.figureKind).toBe('whole_property_recommendation');
    expect(scope.wholeProperty.state).toBe('established');
    expect(scope.landOnlyLabel).toBe('Land-only component');
  });
});
