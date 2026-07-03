import { describe, expect, it } from 'vitest';
import { buildComparableIntelligence, inferSubjectPropertyType } from './comparable-intelligence.js';
import type { DealCardReportView } from './deal-card-report.js';

function report(over: Partial<DealCardReportView>): DealCardReportView {
  return {
    parcelVerified: true,
    ddFactChecklist: [{ key: 'acres', label: 'Acres', value: '10 ac', status: 'verified', source: 'LandPortal' }],
    landportalInspection: null,
    marketComps: { sold: [], active: [], supplementalSold: [], metrics: {}, providers: [], soldCount: 0, activeCount: 0, source: 'test' },
    sourceTable: [],
    ...over,
  } as unknown as DealCardReportView;
}

describe('comparable intelligence', () => {
  it('classifies subject property from visual and parcel evidence', () => {
    const cls = inferSubjectPropertyType({
      parcelUrl: 'x',
      comparablesUrl: null,
      parcelFacts: { 'Building SqFt': '1240', Acres: '10' },
      assets: [],
      overlays: [],
      visualObservations: [{ label: 'Existing improvement', detail: 'Home visible near road.', confidence: 'medium', evidence: 'Satellite' }],
      comparables: [],
      sources: [],
      evidence: [],
      discoveryQuestions: [],
      missingInformation: [],
    });
    expect(cls.type).toBe('existing_residence');
    expect(cls.confidence).not.toBe('low');
  });

  it('deduplicates LandPortal rows and corrects obvious price-per-acre errors', () => {
    const r = report({
      landportalInspection: {
        parcelUrl: 'https://landportal/p',
        comparablesUrl: 'https://landportal/c',
        parcelFacts: { Acres: '10', 'Land Use': 'Vacant land' },
        assets: [],
        overlays: [],
        visualObservations: [{ label: 'Vacant land', detail: 'No structures observed.', confidence: 'medium', evidence: 'Satellite' }],
        comparables: [
          { rawText: '123 County Rd Sold $100,000 10 ac $50,000/ac 01/02/2026 vacant land', sourceUrl: 'https://landportal/c', saleDate: '01/02/2026', acres: 10, price: 100000, pricePerAcre: 50000, status: 'sold', improvement: 'vacant', confidence: 'medium' },
          { rawText: '123 County Rd Sold $100,000 10 ac $50,000/ac 01/02/2026 vacant land', sourceUrl: 'https://landportal/c', saleDate: '01/02/2026', acres: 10, price: 100000, pricePerAcre: 50000, status: 'sold', improvement: 'vacant', confidence: 'medium' },
        ],
        sources: [],
        evidence: [],
        discoveryQuestions: [],
        missingInformation: [],
      },
    });
    const ci = buildComparableIntelligence(r);
    expect(ci.comparables).toHaveLength(1);
    expect(ci.comparables[0].pricePerAcre).toBe(10000);
    expect(ci.comparables[0].parsingErrors[0]).toMatch(/differs materially/i);
    expect(ci.estimatedMarketValue?.mid).toBe(100000);
  });

  it('does not select a fifty-five-acre comp for a five-acre subject when band evidence exists', () => {
    const r = report({
      ddFactChecklist: [{ key: 'acres', label: 'Acres', value: '5 ac', status: 'verified', source: 'LandPortal' }],
      landportalInspection: {
        parcelUrl: 'x',
        comparablesUrl: 'x',
        parcelFacts: { Acres: '5', 'Land Use': 'Vacant land' },
        assets: [],
        overlays: [],
        visualObservations: [],
        comparables: [
          { rawText: 'Small lot Sold $50,000 5 ac vacant', sourceUrl: 'x', acres: 5, price: 50000, pricePerAcre: 10000, status: 'sold', improvement: 'vacant', confidence: 'medium' },
          { rawText: 'Large tract Sold $220,000 55 ac vacant', sourceUrl: 'x', acres: 55, price: 220000, pricePerAcre: 4000, status: 'sold', improvement: 'vacant', confidence: 'medium' },
        ],
        sources: [],
        evidence: [],
        discoveryQuestions: [],
        missingInformation: [],
      },
    });
    const ci = buildComparableIntelligence(r);
    expect(ci.selectedComparables).toHaveLength(1);
    expect(ci.selectedComparables[0].acreage).toBe(5);
    expect(ci.rejectedComparables[0].reason).toMatch(/acreage band/i);
  });

  it('falls back to asking/listed LandPortal comps when sold comps are unavailable', () => {
    const r = report({
      ddFactChecklist: [{ key: 'acres', label: 'Acres', value: '0.25 ac', status: 'verified', source: 'LandPortal' }],
      landportalInspection: {
        parcelUrl: 'x',
        comparablesUrl: 'x',
        parcelFacts: { Acres: '0.25', 'Land Use': 'Vacant land' },
        assets: [],
        overlays: [],
        visualObservations: [{ label: 'Vacant land', detail: 'No structures observed.', confidence: 'medium', evidence: 'Satellite' }],
        comparables: [
          { rawText: '$18,000 Acres: 0.25 | APN: 02-44-26-L4-08068.0040', sourceUrl: 'x', acres: 0.25, price: 18000, pricePerAcre: 72000, status: 'listed', improvement: 'vacant', confidence: 'medium' },
          { rawText: '$16,500 Acres: 0.25 | APN: 11-44-26-L1-05039.0090', sourceUrl: 'x', acres: 0.25, price: 16500, pricePerAcre: 66000, status: 'listed', improvement: 'vacant', confidence: 'medium' },
        ],
        sources: [],
        evidence: [],
        discoveryQuestions: [],
        missingInformation: [],
      },
    });
    const ci = buildComparableIntelligence(r);
    expect(ci.selectedComparables).toHaveLength(2);
    expect(ci.estimatedPricePerAcre.mid).toBe(69000);
    expect(ci.estimatedMarketValue?.mid).toBe(17250);
    expect(ci.confidence).toBe('low');
    expect(ci.evidenceUsed[0]).toMatch(/asking\/listed/i);
  });
});
