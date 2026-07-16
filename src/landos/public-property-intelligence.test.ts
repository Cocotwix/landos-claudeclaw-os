import { describe, expect, it } from 'vitest';

import {
  PUBLIC_INTELLIGENCE_TASKS,
  SCREENING_DISCLAIMERS,
  canonicalizeSsurgosepticRating,
  evaluatePublicIntelligenceGate,
  reconcileEvidenceFact,
  runPublicPropertyIntelligence,
  slopeBandFor,
  summarizeSlopeBands,
  type EvidenceBackedFact,
  type PublicEvidence,
  type PublicIntelligenceAdapter,
  type PublicIntelligenceAdapterResult,
  type PublicIntelligenceSubject,
  type PublicIntelligenceTaskKind,
} from './public-property-intelligence.js';
import {
  PUBLIC_INTELLIGENCE_FIXTURE_EVIDENCE,
  PUBLIC_INTELLIGENCE_FIXTURE_FINDINGS,
  PUBLIC_INTELLIGENCE_FIXTURE_SUBJECT,
} from './fixtures/public-intelligence-contract.fixture.js';

const FIXED_NOW = () => '2026-01-15T12:00:00.000Z';

function fixtureAdapter(
  task: PublicIntelligenceTaskKind,
  overrides: Partial<PublicIntelligenceAdapterResult> = {},
): PublicIntelligenceAdapter {
  return {
    task,
    adapterId: `fixture_${task}`,
    async run() {
      return {
        status: 'succeeded',
        finding: PUBLIC_INTELLIGENCE_FIXTURE_FINDINGS[task],
        evidence: PUBLIC_INTELLIGENCE_FIXTURE_EVIDENCE[task],
        confidence: 'high',
        retryEligible: false,
        ...overrides,
      };
    },
  };
}

function allFixtureAdapters(): PublicIntelligenceAdapter[] {
  return PUBLIC_INTELLIGENCE_TASKS.map((task) => fixtureAdapter(task));
}

describe('parcel identity gate', () => {
  it('hard-stops every downstream task when requested and resolved APNs differ', async () => {
    let calls = 0;
    const adapter = fixtureAdapter('wetlands');
    const run = await runPublicPropertyIntelligence({
      ...PUBLIC_INTELLIGENCE_FIXTURE_SUBJECT,
      requestedApn: '094-020.08',
      resolvedApn: '094-020.09',
    }, {
      adapters: [{ ...adapter, run: async (...args) => { calls++; return adapter.run(...args); } }],
      captureMode: 'fixture',
      now: FIXED_NOW,
    });

    expect(run.status).toBe('blocked_identity');
    expect(run.downstreamAllowed).toBe(false);
    expect(run.gate.reasonCode).toBe('apn_hard_conflict');
    expect(calls).toBe(0);
    expect(run.tasks).toHaveLength(11);
    expect(run.tasks.every((task) => task.status === 'skipped_identity_gate')).toBe(true);
  });

  it('treats punctuation variants as the same APN and allows confirmed address-only subjects', () => {
    expect(evaluatePublicIntelligenceGate({
      ...PUBLIC_INTELLIGENCE_FIXTURE_SUBJECT,
      requestedApn: 'R300-018-000-0085-0000',
      resolvedApn: 'R300 018 000 0085 0000',
    }).allowed).toBe(true);
    expect(evaluatePublicIntelligenceGate({
      ...PUBLIC_INTELLIGENCE_FIXTURE_SUBJECT,
      requestedApn: undefined,
      requestedApnAlternates: undefined,
      resolvedApn: undefined,
      resolutionStatus: 'confirmed',
    }).allowed).toBe(true);
  });

  it('does not run when a requested APN has not been resolved or status is provisional', () => {
    expect(evaluatePublicIntelligenceGate({
      ...PUBLIC_INTELLIGENCE_FIXTURE_SUBJECT,
      resolvedApn: undefined,
    }).reasonCode).toBe('requested_apn_not_resolved');
    expect(evaluatePublicIntelligenceGate({
      ...PUBLIC_INTELLIGENCE_FIXTURE_SUBJECT,
      requestedApn: undefined,
      resolvedApn: undefined,
      resolutionStatus: 'provisional',
    }).reasonCode).toBe('parcel_not_confirmed');
  });
});

describe('public property intelligence fixture contract', () => {
  it('returns decision-shaped wetlands, flood, SSURGO, slope, frontage, imagery, county, marketplace, and optional cross-check output', async () => {
    const run = await runPublicPropertyIntelligence(PUBLIC_INTELLIGENCE_FIXTURE_SUBJECT, {
      adapters: allFixtureAdapters(),
      captureMode: 'fixture',
      now: FIXED_NOW,
    });

    expect(run.status).toBe('complete');
    expect(run.downstreamAllowed).toBe(true);
    expect(run.tasks.map((task) => task.task)).toEqual(PUBLIC_INTELLIGENCE_TASKS);
    expect(run.tasks.every((task) => task.status === 'succeeded' && task.blocking === false)).toBe(true);
    expect(run.tasks.flatMap((task) => task.evidence).every((row) => row.captureMode === 'fixture' && row.decisionUsable === false)).toBe(true);

    const wetlands = run.tasks.find((task) => task.task === 'wetlands')?.finding;
    expect(wetlands?.kind).toBe('wetlands');
    if (wetlands?.kind === 'wetlands') {
      expect(wetlands.approximateParcelPercentage).toBe(12);
      expect(wetlands.limitation).toMatch(/not a jurisdictional/i);
    }

    const flood = run.tasks.find((task) => task.task === 'fema_flood')?.finding;
    expect(flood?.kind).toBe('fema_flood');
    if (flood?.kind === 'fema_flood') expect(flood.zones.map((zone) => zone.zone)).toEqual(['X', 'AE']);

    const soils = run.tasks.find((task) => task.task === 'soils_septic')?.finding;
    expect(soils?.kind).toBe('soils_septic');
    if (soils?.kind === 'soils_septic') {
      expect(soils.mapUnits[0].components[0]).toMatchObject({
        septicLimitation: 'somewhat_limited',
        seasonalSaturationDepthIn: 30,
        restrictiveLayerDepthIn: 60,
        hydrologicSoilGroup: 'B',
      });
      expect(soils.limitation).not.toMatch(/will pass/i);
    }

    const slope = run.tasks.find((task) => task.task === 'slope_topography')?.finding;
    expect(slope?.kind).toBe('slope_topography');
    if (slope?.kind === 'slope_topography') {
      expect(slope.bands.map((band) => band.band)).toEqual(['0_to_5', '5_to_10', '10_to_15', '15_to_25', 'above_25']);
      expect(slope).toMatchObject({ minimumElevationFt: 810, maximumElevationFt: 875, totalReliefFt: 65 });
    }

    const frontageTask = run.tasks.find((task) => task.task === 'road_frontage');
    expect(frontageTask?.confidence).toBe('high');
    expect(frontageTask?.finding?.limitation).toMatch(/not a frontage measurement/i);

    const imagery = run.tasks.find((task) => task.task === 'imagery')?.finding;
    expect(imagery?.kind).toBe('imagery');
    if (imagery?.kind === 'imagery') expect(imagery.acquisitionDate).toBe('2024-08-15');

    const marketplace = run.tasks.find((task) => task.task === 'marketplace_confirmation')?.finding;
    expect(marketplace?.kind).toBe('marketplace_confirmation');
    if (marketplace?.kind === 'marketplace_confirmation') expect(marketplace.identityUse).toBe('supporting_only');

    const landPortalTask = run.tasks.find((task) => task.task === 'land_portal');
    expect(landPortalTask?.role).toBe('optional_cross_check');
    expect(landPortalTask?.finding?.kind).toBe('land_portal');
  });

  it('uses fixture markers rather than presenting deterministic data as live evidence', async () => {
    const run = await runPublicPropertyIntelligence(PUBLIC_INTELLIGENCE_FIXTURE_SUBJECT, {
      adapters: [fixtureAdapter('wetlands')],
      captureMode: 'live',
      now: FIXED_NOW,
    });
    const task = run.tasks.find((row) => row.task === 'wetlands');
    expect(task?.status).toBe('partial');
    expect(task?.failureReason).toMatch(/Fixture evidence cannot be presented as live/i);
    expect(task?.evidence[0]).toMatchObject({ captureMode: 'fixture', decisionUsable: false });
  });
});

describe('independent bounded provider orchestration', () => {
  it('starts every task in parallel', async () => {
    let started = 0;
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const adapters = PUBLIC_INTELLIGENCE_TASKS.map((task): PublicIntelligenceAdapter => ({
      task,
      adapterId: `parallel_${task}`,
      timeoutMs: 1_000,
      async run() {
        started++;
        await wait;
        return {
          status: 'succeeded',
          finding: PUBLIC_INTELLIGENCE_FIXTURE_FINDINGS[task],
          evidence: PUBLIC_INTELLIGENCE_FIXTURE_EVIDENCE[task],
          confidence: 'high',
          retryEligible: false,
        };
      },
    }));
    const pending = runPublicPropertyIntelligence(PUBLIC_INTELLIGENCE_FIXTURE_SUBJECT, {
      adapters,
      captureMode: 'fixture',
      now: FIXED_NOW,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(started).toBe(11);
    release();
    expect((await pending).status).toBe('complete');
  });

  it('isolates provider failure, timeout, missing adapters, and optional Land Portal blocking', async () => {
    const wetlands = fixtureAdapter('wetlands');
    const county = fixtureAdapter('county_records');
    const fema: PublicIntelligenceAdapter = {
      task: 'fema_flood', adapterId: 'fema_error',
      async run() { throw new Error('simulated FEMA outage'); },
    };
    const soils: PublicIntelligenceAdapter = {
      task: 'soils_septic', adapterId: 'soil_timeout', timeoutMs: 1_000,
      async run() { return await new Promise<PublicIntelligenceAdapterResult>(() => undefined); },
    };
    const landPortal = fixtureAdapter('land_portal', {
      status: 'blocked', finding: undefined, evidence: [], confidence: 'none', retryEligible: true,
      failureReason: 'Optional authentication unavailable.',
    });
    const run = await runPublicPropertyIntelligence(PUBLIC_INTELLIGENCE_FIXTURE_SUBJECT, {
      adapters: [wetlands, fema, soils, county, landPortal],
      captureMode: 'fixture',
      defaultTimeoutMs: 20,
      maxTimeoutMs: 5,
      now: FIXED_NOW,
    });

    expect(run.status).toBe('complete_with_gaps');
    expect(run.downstreamAllowed).toBe(true);
    expect(run.tasks.find((task) => task.task === 'wetlands')?.status).toBe('succeeded');
    expect(run.tasks.find((task) => task.task === 'county_records')?.status).toBe('succeeded');
    expect(run.tasks.find((task) => task.task === 'fema_flood')).toMatchObject({ status: 'failed', retryEligible: true });
    expect(run.tasks.find((task) => task.task === 'soils_septic')).toMatchObject({ status: 'timed_out', timeoutMs: 5, retryEligible: true });
    expect(run.tasks.find((task) => task.task === 'land_portal')).toMatchObject({ status: 'blocked', blocking: false });
    expect(run.tasks.find((task) => task.task === 'imagery')).toMatchObject({ status: 'unavailable', blocking: false });
  });

  it('downgrades a claimed success with no source evidence', async () => {
    const run = await runPublicPropertyIntelligence(PUBLIC_INTELLIGENCE_FIXTURE_SUBJECT, {
      adapters: [fixtureAdapter('wetlands', { evidence: [] })],
      captureMode: 'live',
      now: FIXED_NOW,
    });
    expect(run.tasks[0]).toMatchObject({ status: 'partial', confidence: 'low', retryEligible: true });
    expect(run.tasks[0].failureReason).toMatch(/without source evidence/i);
  });
});

function source(
  evidenceId: string,
  sourceTier: PublicEvidence['sourceTier'],
  verification: PublicEvidence['verification'],
  confidence: PublicEvidence['confidence'] = 'high',
): PublicEvidence {
  return {
    evidenceId,
    sourceName: evidenceId,
    sourceUrl: `https://evidence.example/${evidenceId}`,
    sourceTier,
    verification,
    retrievedAt: '2026-01-15T12:00:00.000Z',
    confidence,
    supports: ['test fact'],
    captureMode: 'live',
  };
}

function fact(field: string, value: EvidenceBackedFact['value'], evidence: PublicEvidence): EvidenceBackedFact {
  return { field, value, evidence };
}

describe('evidence precedence and screening-versus-legal classification', () => {
  it('recorded survey frontage beats GIS and cannot be overwritten by Land Portal', () => {
    const gis = fact('frontage_ft', 420, source('county-gis', 'official_county_state', 'screening', 'medium'));
    const survey = fact('frontage_ft', 398, source('recorded-survey', 'recorded_or_approved_legal', 'recorded_instrument'));
    const promoted = reconcileEvidenceFact(gis, survey);
    expect(promoted).toMatchObject({ status: 'replaced_with_stronger', current: { value: 398 } });
    expect(promoted.conflictingCandidates[0].value).toBe(420);

    const portal = fact('frontage_ft', 425, source('land-portal', 'land_portal', 'supporting_context'));
    const retained = reconcileEvidenceFact(promoted.current, portal);
    expect(retained).toMatchObject({ status: 'kept_stronger', current: { value: 398 } });
  });

  it('onsite septic approval beats SSURGO and a jurisdictional determination beats NWI', () => {
    const ssurgo = fact('septic', 'very limited', source('ssurgo', 'authoritative_federal', 'screening'));
    const onsite = fact('septic', 'approved for 3 bedrooms', source('health-department', 'recorded_or_approved_legal', 'approved_onsite_determination'));
    expect(reconcileEvidenceFact(ssurgo, onsite)).toMatchObject({
      status: 'replaced_with_stronger', current: { value: 'approved for 3 bedrooms' },
    });

    const nwi = fact('wetlands_acres', 1.2, source('nwi', 'authoritative_federal', 'screening'));
    const jurisdictional = fact('wetlands_acres', 0.8, source('jurisdictional', 'recorded_or_approved_legal', 'jurisdictional_determination'));
    expect(reconcileEvidenceFact(nwi, jurisdictional)).toMatchObject({
      status: 'replaced_with_stronger', current: { value: 0.8 },
    });
  });

  it('county zoning beats listing text and a human override remains explicit', () => {
    const county = fact('zoning', 'A-1', source('county-zoning', 'official_county_state', 'official_record'));
    const listing = fact('zoning', 'Residential', source('listing', 'marketplace', 'supporting_context'));
    expect(reconcileEvidenceFact(county, listing)).toMatchObject({ status: 'kept_stronger', current: { value: 'A-1' } });

    const override: EvidenceBackedFact = { ...county, value: 'A-2', humanOverride: true, overrideReason: 'Operator reviewed ordinance amendment.' };
    const result = reconcileEvidenceFact(override, listing);
    expect(result).toMatchObject({ status: 'human_override_preserved', current: { value: 'A-2', humanOverride: true } });
    expect(result.explanation).toMatch(/override remains/i);
  });
});

describe('deterministic SSURGO and slope helpers', () => {
  it('normalizes current and legacy SSURGO septic ratings without claiming a perc result', () => {
    expect(canonicalizeSsurgosepticRating('Not limited')).toBe('not_limited');
    expect(canonicalizeSsurgosepticRating('Moderate')).toBe('somewhat_limited');
    expect(canonicalizeSsurgosepticRating('Severe')).toBe('very_limited');
    expect(canonicalizeSsurgosepticRating('')).toBe('unknown');
    expect(SCREENING_DISCLAIMERS.soilsSeptic).toMatch(/does not predict a passing perc test/i);
  });

  it('assigns exact percentage boundaries and returns all five slope bands', () => {
    expect([0, 4.999, 5, 9.999, 10, 14.999, 15, 24.999, 25].map(slopeBandFor)).toEqual([
      '0_to_5', '0_to_5', '5_to_10', '5_to_10', '10_to_15', '10_to_15', '15_to_25', '15_to_25', 'above_25',
    ]);
    const bands = summarizeSlopeBands([
      { slopePercent: 2, areaAcres: 2 },
      { slopePercent: 7, areaAcres: 1 },
      { slopePercent: 12, areaAcres: 1 },
      { slopePercent: 20, areaAcres: 1 },
      { slopePercent: 30, areaAcres: 1 },
      { slopePercent: Number.NaN, areaAcres: 99 },
    ]);
    expect(bands.map((band) => band.band)).toEqual(['0_to_5', '5_to_10', '10_to_15', '15_to_25', 'above_25']);
    expect(bands[0]).toMatchObject({ approximateAcres: 2, parcelPercentage: 33.33 });
    expect(bands.slice(1).every((band) => band.approximateAcres === 1)).toBe(true);
  });
});
