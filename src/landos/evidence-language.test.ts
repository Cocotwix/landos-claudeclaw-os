import { describe, expect, it } from 'vitest';
import {
  sanitizeAccessLanguage,
  sanitizePublicIntelligenceRun,
  sanitizeVisualConclusion,
  sanitizeVisualObservation,
} from './evidence-language.js';
import type { FrontageFinding, PublicIntelligenceRun, SlopeFinding } from './public-property-intelligence.js';

describe('access language sanitizer', () => {
  it('never lets the proximity measurement be called frontage', () => {
    const out = sanitizeAccessLanguage('Seaside Rd: ~241 ft mapped frontage; apparent public frontage confirmed.');
    expect(out).not.toMatch(/frontage/i);
    expect(out).toMatch(/within 25 m/);
  });

  it('never asserts an unknown-ownership road is private or that recorded rights are required (ws2-r5)', () => {
    const out = sanitizeAccessLanguage('Unnamed road is mapped as a private road; recorded access rights over it are required and are not confirmed by GIS.');
    expect(out).not.toMatch(/is mapped as a private road/i);
    expect(out).toMatch(/ownership is unverified/i);
    // The recorded-rights claim must be conditional, never an unconditional requirement.
    expect(out).toMatch(/would be required only if it is confirmed private/i);
    expect(out).not.toMatch(/rights over it are required and are not confirmed/i);
  });
});

describe('visual-conclusion sanitizer', () => {
  it('rewrites every unsafe visual claim to its safe form', () => {
    const cases: Array<[string, RegExp]> = [
      ['The parcel fronts a paved road', /contact unresolved/i],
      ['Power lines run along the property frontage', /parcel service unconfirmed/i],
      ['The lot is partially cleared and ready for use', /attribution unresolved/i],
      ['Structure is on the parcel near the road', /attribution unresolved/i],
      ['Excellent paved access from the highway', /access unresolved/i],
      ['Existing utility hookups at the site', /service unconfirmed/i],
    ];
    for (const [input, expected] of cases) {
      const { text, rewritten } = sanitizeVisualConclusion(input);
      expect(rewritten, input).toBe(true);
      expect(text, input).toMatch(expected);
    }
  });

  it('attaches the three-part confidence and keeps attribution unresolved without proof', () => {
    const obs = sanitizeVisualObservation({ label: 'Access', detail: 'Parcel fronts a paved road', confidence: 'high', evidence: 'street view frame' });
    expect(obs.detail).toMatch(/contact unresolved/i);
    expect(obs.confidences.featureDetection).toBe('high');
    expect(obs.confidences.parcelAttribution).toBe('unresolved');
    expect(obs.confidences.underwritingSignificance).toBe('unresolved');
  });

  it('neutralizes analyzer wording that asserts direct frontage', () => {
    const { text } = sanitizeVisualConclusion('The parcel has approximately 218 feet of direct frontage along the paved Talley Road.');
    expect(text).toMatch(/218 ft of paved Talley Road centerline is visible near the mapped parcel/i);
    expect(text).toMatch(/contact and access remain unresolved/i);
    expect(text).not.toMatch(/direct frontage/i);
  });

  it('keeps a qualified driveway observation grammatical while removing the frontage claim', () => {
    const { text } = sanitizeVisualConclusion('While the parcel fronts a paved road, there is no visible driveway due to the steep grade.');
    expect(text).toBe('A paved road is visible nearby, but direct parcel–road contact and access remain unresolved; there is no visible driveway due to the steep grade.');
  });

  it('removes an imagery-based direct physical access assertion', () => {
    const { text } = sanitizeVisualConclusion('The parcel has direct physical access to a paved two-lane road (Talley Rd).');
    expect(text).toMatch(/paved two-lane road.*visible near the mapped parcel/i);
    expect(text).toMatch(/physical or legal access remain unresolved/i);
    expect(text).not.toMatch(/has direct physical access/i);
  });

  it('neutralizes stale frontage and access assertions, including multiple claims in one string', () => {
    const { text, rewritten } = sanitizeVisualConclusion(
      'The parcel features approximately 218 feet of direct road proximity along Talley Rd. Confirmed road frontage means access is not an issue.',
    );
    expect(rewritten).toBe(true);
    expect(text).toMatch(/218 ft of Talley Rd centerline is visible near the mapped parcel/i);
    expect(text).toMatch(/direct parcel.*road contact and access remain unresolved/i);
    expect(text).toMatch(/physical and legal access remain unresolved/i);
    expect(text).not.toMatch(/confirmed road frontage|access is not an issue|features approximately/i);
  });
});

describe('persisted-run sanitizer', () => {
  const frontage: FrontageFinding = {
    kind: 'road_frontage',
    adjoiningRoads: [{ name: 'Seaside Rd (County, Paved)', status: 'public', approximateMappedFrontageFt: 241, apparentRightOfWayContact: true }],
    approximateMappedFrontageFt: 241,
    measurementMethod: 'centerline within 25 m',
    legalAccessStatus: 'unknown',
    geometrySource: 'county',
    accessConcerns: ['Mapped centerline frontage is approximate'],
    summary: 'Seaside Rd (county, paved): ~241 ft mapped frontage.',
    whyItMatters: 'access',
    limitation: 'GIS screening',
    classification: 'screening',
  };
  const slope: SlopeFinding = {
    kind: 'slope_topography',
    minimumElevationFt: 3.9, maximumElevationFt: 13, totalReliefFt: 9.1,
    meanSlopePct: 0.9, medianSlopePct: 0.9, maximumSlopePct: 2.8,
    bands: [
      { band: '0_to_5', approximateAcres: 7.5, parcelPercentage: 100 },
      { band: '5_to_10', approximateAcres: 0, parcelPercentage: 0 },
      { band: '10_to_15', approximateAcres: 0, parcelPercentage: 0 },
      { band: '15_to_25', approximateAcres: 0, parcelPercentage: 0 },
      { band: 'above_25', approximateAcres: 0, parcelPercentage: 0 },
    ],
    summary: '0 to 5: 7.5 acres, 100%.',
    whyItMatters: 'grading', limitation: 'grid', classification: 'screening',
  };
  const run: PublicIntelligenceRun = {
    status: 'complete', downstreamAllowed: true, captureMode: 'live',
    gate: { allowed: true, blocking: true, reasonCode: 'parcel_confirmed', explanation: 'ok' },
    tasks: [
      { task: 'road_frontage', label: 'x', role: 'public_core', status: 'succeeded', startedAt: '', completedAt: '', durationMs: 1, timeoutMs: 1, finding: frontage, evidence: [], retryEligible: true, confidence: 'medium', blocking: false, diagnostics: {} },
      { task: 'slope_topography', label: 'x', role: 'public_core', status: 'succeeded', startedAt: '', completedAt: '', durationMs: 1, timeoutMs: 1, finding: slope, evidence: [], retryEligible: true, confidence: 'medium', blocking: false, diagnostics: {} },
    ],
    nonBlockingGaps: [], startedAt: '', completedAt: '',
  };

  it('rewrites persisted frontage summaries to proximity language with unresolved items', () => {
    const clean = sanitizePublicIntelligenceRun(run);
    const f = clean.tasks[0].finding as FrontageFinding;
    expect(f.summary).toMatch(/falls within 25 meters/);
    // "mapped frontage" may only appear as an UNRESOLVED item, never as a measurement claim.
    expect(f.summary).not.toMatch(/ft mapped frontage/i);
    expect(f.summary).toMatch(/mapped frontage[^.]*unresolved/i);
    expect(f.summary).toMatch(/legal access[^.]*unresolved/i);
    expect(f.legalAccessStatus).toBe('unconfirmed');
  });

  it('removes parcel-wide slope-band acreage derived from point samples', () => {
    const clean = sanitizePublicIntelligenceRun(run);
    const sl = clean.tasks[1].finding as SlopeFinding;
    expect(sl.bands.every((b) => b.approximateAcres === 0)).toBe(true);
    expect(sl.summary).toMatch(/All sampled interior points fell within the 0% to 5% slope range/);
    expect(sl.summary).toMatch(/has not been calculated/);
    expect(sl.summary).not.toMatch(/7\.5 acres/);
  });
});
