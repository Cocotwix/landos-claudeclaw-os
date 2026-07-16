import { describe, expect, it } from 'vitest';
import { buildOperatorPropertyRecord, computeAccessStatus, computeSepticOutlook, type OperatorRecordContext } from './operator-property-record.js';
import type {
  FrontageFinding,
  PublicIntelligenceRun,
  PublicIntelligenceTaskRecord,
  SoilsSepticFinding,
} from './public-property-intelligence.js';

function taskRecord(task: PublicIntelligenceTaskRecord['task'], finding: PublicIntelligenceTaskRecord['finding']): PublicIntelligenceTaskRecord {
  return {
    task,
    label: task,
    role: 'public_core',
    status: 'succeeded',
    startedAt: '2026-07-13T00:00:00.000Z',
    completedAt: '2026-07-13T00:00:01.000Z',
    durationMs: 1000,
    timeoutMs: 30_000,
    finding,
    evidence: [],
    retryEligible: false,
    confidence: 'high',
    blocking: false,
    diagnostics: {},
  };
}

const soilsPoor: SoilsSepticFinding = {
  kind: 'soils_septic',
  mapUnits: [
    { symbol: 'CE', name: 'Capers association', components: [{ name: 'Capers', septicLimitation: 'very_limited', limitingFactors: [], drainageClass: 'Very poorly drained' }] },
    { symbol: 'Wd', name: 'Wando fine sand', components: [{ name: 'Wando', septicLimitation: 'very_limited', limitingFactors: [] }] },
  ],
  datasetName: 'USDA NRCS SSURGO',
  summary: 'summary',
  whyItMatters: 'why',
  limitation: 'limit',
  classification: 'screening',
};

const frontageBoth: FrontageFinding = {
  kind: 'road_frontage',
  adjoiningRoads: [
    { name: 'Seaside Rd (State, Paved)', status: 'public', approximateMappedFrontageFt: 241, apparentRightOfWayContact: false },
    { name: 'Crown Heights Ln (Private, Unpaved)', status: 'private', approximateMappedFrontageFt: 1862, apparentRightOfWayContact: false },
  ],
  approximateMappedFrontageFt: 2103,
  measurementMethod: 'centerline-near-boundary length',
  legalAccessStatus: 'unconfirmed',
  geometrySource: 'county',
  accessConcerns: ['Crown Heights Ln is mapped as a private road.'],
  summary: 'Seaside Rd ~241 ft; Crown Heights Ln ~1862 ft.',
  whyItMatters: 'why',
  limitation: 'limit',
  classification: 'screening',
};

function makeRun(tasks: PublicIntelligenceTaskRecord[]): PublicIntelligenceRun {
  return {
    status: 'complete_with_gaps',
    downstreamAllowed: true,
    gate: { allowed: true, blocking: true, reasonCode: 'parcel_confirmed', explanation: 'ok' },
    captureMode: 'live',
    tasks,
    nonBlockingGaps: [],
    startedAt: '2026-07-13T00:00:00.000Z',
    completedAt: '2026-07-13T00:00:10.000Z',
  };
}

const baseContext: OperatorRecordContext = {
  situsAddress: '473 SEASIDE RD',
  county: 'Beaufort',
  state: 'SC',
  apn: 'R300 018 000 0085 0000',
  owner: 'COLEMAN BARBARA COAXUM MATILDA TRUSTEES (HARRY COLEMAN FAMILY',
  assessedAcres: 7.5,
  coordinates: { lat: 32.37, lng: -80.53 },
  parcelVerified: true,
  verificationSource: 'Beaufort County public archival parcel layer (2024)',
  compCount: 1,
  valuationReady: false,
  marketPulseAvailable: false,
  visualsCaptured: 0,
  landPortalCaptured: false,
  deedRetrieved: false,
};

describe('septic outlook verdict', () => {
  it('is poor when every rated component is very limited, with a plain-English why', () => {
    const outlook = computeSepticOutlook(soilsPoor, null);
    expect(outlook.outlook).toBe('poor');
    expect(outlook.why).toMatch(/very limited/i);
    expect(outlook.why).toMatch(/engineered|alternative/i);
  });

  it('is mixed when ratings are split', () => {
    const soilsMixed: SoilsSepticFinding = {
      ...soilsPoor,
      mapUnits: [
        { symbol: 'A', name: 'A', components: [{ name: 'a', septicLimitation: 'very_limited', limitingFactors: [] }] },
        { symbol: 'B', name: 'B', components: [{ name: 'b', septicLimitation: 'not_limited', limitingFactors: [] }] },
      ],
    };
    expect(computeSepticOutlook(soilsMixed, null).outlook).toBe('mixed');
  });

  it('is unknown without soil data', () => {
    expect(computeSepticOutlook(null, null).outlook).toBe('unknown');
  });
});

describe('access status verdict', () => {
  it('reports public-road proximity (never frontage) when a public road is near', () => {
    const access = computeAccessStatus(frontageBoth);
    expect(access.status).toBe('public_road_proximity');
    expect(access.summary).toContain('Seaside Rd');
    expect(access.summary).toMatch(/within 25 meters/i);
    expect(access.summary).not.toMatch(/frontage/i);
    expect(access.unresolved.join(' ')).toMatch(/legal access unresolved/i);
    expect(access.unresolved.join(' ')).toMatch(/boundary contact unresolved/i);
  });

  it('reports non-public proximity as UNKNOWN ownership, never asserting recorded private-road rights are required (ws2-r5)', () => {
    const access = computeAccessStatus({ ...frontageBoth, adjoiningRoads: [frontageBoth.adjoiningRoads[1]] });
    expect(access.status).toBe('private_road_only');
    // A 'private' road-layer tag is a hint, not established ownership.
    expect(access.summary).toMatch(/unknown ownership/i);
    expect(access.summary).not.toMatch(/classified private/i);
    expect(access.summary).not.toMatch(/recorded private-road rights (are|would be) required(?!\s*if)/i);
    expect(access.summary).toMatch(/ownership is not established|unverified/i);
  });

  it('de-duplicates the access concerns list', () => {
    const dup = { ...frontageBoth, adjoiningRoads: [frontageBoth.adjoiningRoads[1]], accessConcerns: ['Same concern.', 'Same concern.', 'Other.'] };
    const access = computeAccessStatus(dup);
    expect(access.concerns.length).toBe(new Set(access.concerns).size);
  });

  it('reports no mapped contact', () => {
    const access = computeAccessStatus({ ...frontageBoth, adjoiningRoads: [] });
    expect(access.status).toBe('no_mapped_contact');
  });
});

describe('operator property record reconciliation', () => {
  const run = makeRun([
    taskRecord('wetlands', {
      kind: 'wetlands', intersects: true,
      areas: [{ classification: 'Estuarine marsh [E2EM1P]', approximateAcres: 0.999, parcelPercentage: 28.5 }],
      approximateTotalAcres: 0.999, approximateParcelPercentage: 28.5,
      overlapState: 'measurable_overlap', datasetName: 'County NWI layer',
      summary: 'Mapped wetlands cover approximately 0.999 ac (28.5%).', whyItMatters: 'w', limitation: 'l', classification: 'screening',
    }),
    taskRecord('fema_flood', {
      kind: 'fema_flood',
      zones: [
        { zone: 'AE', approximateAcres: 2.074, parcelPercentage: 59.1, specialFloodHazardArea: true },
        { zone: '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', approximateAcres: 1.436, parcelPercentage: 40.9, specialFloodHazardArea: false },
      ],
      mapStatus: 'mapped', baseFloodElevation: '10–11 ft (static BFE)', panelNumber: null, effectiveDate: null,
      summary: 'AE 59.1%; 0.2% annual 40.9%.', whyItMatters: 'w', limitation: 'l', classification: 'screening',
    }),
    taskRecord('soils_septic', soilsPoor),
    taskRecord('slope_topography', {
      kind: 'slope_topography', minimumElevationFt: 3.9, maximumElevationFt: 13, totalReliefFt: 9.1,
      meanSlopePct: 0.9, medianSlopePct: 0.8, maximumSlopePct: 2.1,
      bands: [{ band: '0_to_5', approximateAcres: 7.5, parcelPercentage: 100 }],
      summary: 's', whyItMatters: 'w', limitation: 'l', classification: 'screening',
    }),
    taskRecord('road_frontage', frontageBoth),
    taskRecord('zoning_landuse', {
      kind: 'zoning_landuse', zoningCode: 'T2R', zoningName: 'Rural [T2R]', overlayDistricts: ['St Helena Cultural Overlay'],
      futureLandUse: 'Rural', existingLandUse: 'Rural/Undeveloped', jurisdiction: 'Beaufort County, SC',
      sourceLayerUrls: [], summary: 'Zoned Rural [T2R].', whyItMatters: 'w', limitation: 'l', classification: 'screening',
    }),
    taskRecord('county_records', {
      kind: 'county_records', jurisdiction: 'Beaufort County, SC',
      facts: [
        { field: 'APN', value: 'R300 018 000 0085 0000', sourceEvidenceId: 'e', classification: 'official_record' },
        { field: 'GIS mapped acreage', value: 3.51, sourceEvidenceId: 'e', classification: 'official_record' },
        { field: 'Assessed acreage', value: 7.5, sourceEvidenceId: 'e', classification: 'official_record' },
        { field: 'Owner mailing address', value: '320 A VISTA DR, CHATTANOOGA, TN 37411', sourceEvidenceId: 'e', classification: 'official_record' },
        { field: 'Situs locality (Census county subdivision)', value: 'St. Helena Island', sourceEvidenceId: 'e', classification: 'official_record' },
        { field: 'Situs ZIP (Census ZCTA)', value: '29920', sourceEvidenceId: 'e', classification: 'official_record' },
        { field: 'Deed book/page', value: 'Book 967, Page 1165', sourceEvidenceId: 'e', classification: 'recorded_instrument' },
      ],
      accessState: 'public', summary: 'record', whyItMatters: 'w', limitation: 'l', classification: 'official_record',
    }),
  ]);

  const record = buildOperatorPropertyRecord(run, baseContext);

  it('surfaces the acreage conflict instead of silently picking one number', () => {
    expect(record.identity.mappedAcres).toBe(3.51);
    expect(record.identity.assessedAcres).toBe(7.5);
    expect(record.identity.acreageConflict).toBe(true);
    expect(record.usableAcreage.note).toMatch(/survey/i);
  });

  it('fills locality and ZIP from the county record facts', () => {
    expect(record.identity.locality).toBe('St. Helena Island');
    expect(record.identity.zip).toBe('29920');
  });

  it('computes usable acreage as mapped minus wetlands', () => {
    expect(record.usableAcreage.estimateAcres).toBeCloseTo(2.51, 2);
  });

  it('produces decision cards with honest verdicts', () => {
    const byKey = Object.fromEntries(record.decisionCards.map((card) => [card.key, card]));
    expect(byKey.flood.verdict).toBe('risk');
    expect(byKey.septic.verdict).toBe('risk');
    expect(byKey.wetlands.verdict).toBe('risk');
    expect(byKey.access.verdict).toBe('caution');
    expect(byKey.red_flags.verdict).toBe('risk');
    expect(byKey.value.verdict).toBe('caution');
    expect(byKey.strategy.headline).toMatch(/blocked/i);
  });

  it('flags ground below base flood elevation', () => {
    const flood = record.decisionCards.find((card) => card.key === 'flood')!;
    expect(flood.detail).toMatch(/below the .*base flood elevation|below the 10 ft/i);
  });

  it('never assigns LandOS-performable research to Tyler', () => {
    const tylerItems = record.workStatus.filter((item) => item.state === 'tyler_decision');
    for (const item of tylerItems) {
      expect(item.title).not.toMatch(/wetland|FEMA panel|zoning|comps|frontage|overlay|screenshot|deed review/i);
    }
    const researching = record.workStatus.filter((item) => item.state === 'researching').map((item) => item.title).join(' ');
    expect(researching).toMatch(/comp/i);
  });

  it('generates property-specific seller questions', () => {
    const text = record.sellerQuestions.join(' ');
    expect(text).toMatch(/flood/i);
    expect(text).toMatch(/perc|septic/i);
    expect(text).toMatch(/Seaside Rd|Crown Heights/);
    expect(text).toMatch(/trustee/i);
  });

  it('keeps strategy provisional rather than not viable when only valuation is missing', () => {
    const strategy = record.decisionCards.find((card) => card.key === 'strategy')!;
    expect(strategy.verdict).toBe('caution');
    expect(strategy.detail).not.toMatch(/not viable/i);
  });

  it('handles a missing run without crashing', () => {
    const empty = buildOperatorPropertyRecord(null, baseContext);
    expect(empty.septicOutlook.outlook).toBe('unknown');
    expect(empty.decisionCards.length).toBeGreaterThan(5);
  });

  it('derives a clean owner label from malformed trust text, preserves the raw value, and warns', () => {
    expect(record.identity.owner).toBe('Coleman family trustees');
    expect(record.identity.ownerRaw).toBe('COLEMAN BARBARA COAXUM MATILDA TRUSTEES (HARRY COLEMAN FAMILY');
    expect(record.identity.ownerWarnings.join(' ')).toMatch(/truncated or malformed/i);
    expect(record.identity.ownerWarnings.join(' ')).toMatch(/authority to sell/i);
  });

  it('computes the Land Score from accepted evidence with per-factor basis and conflict-capped confidence', () => {
    const ls = record.landScore;
    expect(ls.available).toBe(true);
    expect(ls.factors.find((f) => f.id === 'wetlands')!.points).toBeLessThan(20);
    expect(ls.factors.find((f) => f.id === 'flood')!.points).toBeLessThanOrEqual(4);
    expect(ls.factors.find((f) => f.id === 'septic')!.lowestTier).toBe(true);
    expect(ls.factors.find((f) => f.id === 'size_integrity')!.basis).toMatch(/CONFLICTED/);
    expect(ls.confidence).not.toBe('full');
    expect(ls.flags.join(' ')).toMatch(/acreage conflict/i);
    for (const f of ls.factors) expect(f.basis.length).toBeGreaterThan(0);
  });

  it('marks the Land Score unavailable when no screening evidence exists', () => {
    const empty = buildOperatorPropertyRecord(null, baseContext);
    expect(empty.landScore.available).toBe(false);
    expect(empty.landScore.unavailableReason).toMatch(/incomplete/i);
    const unverified = buildOperatorPropertyRecord(null, { ...baseContext, parcelVerified: false });
    expect(unverified.landScore.available).toBe(false);
    expect(unverified.landScore.unavailableReason).toMatch(/not confirmed/i);
  });
});
