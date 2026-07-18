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

  it('does not mistake a manufactured-home use description for a structure when parcel facts show zero improvements', () => {
    const cls = inferSubjectPropertyType({
      parcelUrl: 'x', comparablesUrl: null,
      parcelFacts: {
        Acres: '0.8', 'Building SqFt': '0', 'Improvement Value': '0',
        'Parcel Use Description': 'Mobile/Manufactured Home (regardless of Land ownership)',
      },
      assets: [], overlays: [], visualObservations: [], comparables: [], sources: [], evidence: [], discoveryQuestions: [], missingInformation: [],
    });
    expect(cls.type).toBe('vacant_land');
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
          { rawText: '123 County Rd Sold $100,000 10 ac $50,000/ac 01/02/2026 vacant land', sourceUrl: 'https://landportal/c', saleDate: '01/02/2026', distanceMiles: 2, acres: 10, price: 100000, pricePerAcre: 50000, status: 'sold', improvement: 'vacant', confidence: 'medium' },
          { rawText: '123 County Rd Sold $100,000 10 ac $50,000/ac 01/02/2026 vacant land', sourceUrl: 'https://landportal/c', saleDate: '01/02/2026', distanceMiles: 2, acres: 10, price: 100000, pricePerAcre: 50000, status: 'sold', improvement: 'vacant', confidence: 'medium' },
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
    expect(ci.estimatedMarketValue).toBeNull();
    expect(ci.rejectedComparables[0].reason).toMatch(/lower-confidence/i);
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
          { rawText: 'Small lot Sold $50,000 5 ac vacant', sourceUrl: 'x', saleDate: '2026-02-01', distanceMiles: 2, acres: 5, price: 50000, pricePerAcre: 10000, status: 'sold', improvement: 'vacant', confidence: 'medium' },
          { rawText: 'Large tract Sold $220,000 55 ac vacant', sourceUrl: 'x', saleDate: '2026-02-01', distanceMiles: 2, acres: 55, price: 220000, pricePerAcre: 4000, status: 'sold', improvement: 'vacant', confidence: 'medium' },
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

  it('keeps sub-two-acre subjects in a real acreage band instead of treating every small parcel as the same null band', () => {
    const r = report({
      ddFactChecklist: [{ key: 'acres', label: 'Acres', value: '0.8 ac', status: 'verified', source: 'LandPortal' }],
      landportalInspection: {
        parcelUrl: 'x', comparablesUrl: 'x', parcelFacts: { Acres: '0.8', 'Land Use': 'Vacant land' },
        assets: [], overlays: [], visualObservations: [], sources: [], evidence: [], discoveryQuestions: [], missingInformation: [],
        comparables: [
          { rawText: 'Nearby small lot', sourceUrl: 'nearby', saleDate: '2026-02-01', distanceMiles: 2, acres: 0.6, price: 12000, pricePerAcre: 20000, status: 'sold', improvement: 'vacant', confidence: 'high' },
          { rawText: 'Oversized tract', sourceUrl: 'oversized', saleDate: '2026-02-01', distanceMiles: 2, acres: 2.5, price: 50000, pricePerAcre: 20000, status: 'sold', improvement: 'vacant', confidence: 'high' },
        ],
      },
    });
    const ci = buildComparableIntelligence(r);
    expect(ci.acreageBand).toBe('under-2');
    expect(ci.selectedComparables.map((comp) => comp.sourceUrl)).toEqual(['nearby']);
    expect(ci.rejectedComparables[0].reason).toMatch(/acreage band/i);
  });

  it('keeps asking/listed LandPortal rows as context when sold comps are unavailable', () => {
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
    expect(ci.selectedComparables).toHaveLength(0);
    expect(ci.contextComparables).toHaveLength(2);
    expect(ci.estimatedPricePerAcre.mid).toBeNull();
    expect(ci.estimatedMarketValue).toBeNull();
    expect(ci.confidence).toBe('low');
    expect(ci.evidenceUsed[0]).toMatch(/context only/i);
  });

  it('rejects sold rows with missing distance, more than ten miles, or more than twenty-four months of age', () => {
    const r = report({
      landportalInspection: {
        parcelUrl: 'x', comparablesUrl: 'x', parcelFacts: { Acres: '10', 'Land Use': 'Vacant land' },
        assets: [], overlays: [], visualObservations: [], sources: [], evidence: [], discoveryQuestions: [], missingInformation: [],
        comparables: [
          { rawText: 'Good sold', sourceUrl: 'good', saleDate: '2026-02-01', distanceMiles: 3, acres: 10, price: 100000, pricePerAcre: 10000, status: 'sold', improvement: 'vacant', confidence: 'high' },
          { rawText: 'Distance missing', sourceUrl: 'missing', saleDate: '2026-02-01', acres: 10, price: 100000, pricePerAcre: 10000, status: 'sold', improvement: 'vacant', confidence: 'high' },
          { rawText: 'Too far', sourceUrl: 'far', saleDate: '2026-02-01', distanceMiles: 11, acres: 10, price: 100000, pricePerAcre: 10000, status: 'sold', improvement: 'vacant', confidence: 'high' },
          { rawText: 'Too old', sourceUrl: 'old', saleDate: '2023-01-01', distanceMiles: 2, acres: 10, price: 100000, pricePerAcre: 10000, status: 'sold', improvement: 'vacant', confidence: 'high' },
        ],
      },
    });
    const ci = buildComparableIntelligence(r);
    expect(ci.selectedComparables.map((comp) => comp.sourceUrl)).toEqual(['good']);
    expect(ci.selectedComparables[0]).toMatchObject({ radiusTier: '3_miles', recencyTier: '12_months' });
    expect(ci.rejectedComparables.map((row) => row.reason).join(' ')).toMatch(/distance is not established.*outside the 10-mile.*older than the 24-month/i);
  });

  it('deduplicates the same sold property across providers and caps the valuation sample at five', () => {
    const sold = Array.from({ length: 7 }, (_, i) => ({
      addressDesc: `${100 + i} Oak Road`, price: 100000 + i * 1000,
      pricePerAcre: 10000 + i * 100, acres: 10, saleDateIso: '2026-03-01',
      sourceLabel: 'Zillow', sourceUrl: `https://zillow/${i}`,
      distanceMiles: i + 1,
    }));
    const r = report({
      landportalInspection: {
        parcelUrl: 'subject', comparablesUrl: null, parcelFacts: { 'Land Use': 'Vacant land', Acres: '10' },
        assets: [], overlays: [], visualObservations: [], comparables: [], sources: [], evidence: [], discoveryQuestions: [], missingInformation: [],
      },
      marketComps: {
        sold: sold.map((row) => ({ ...row, propertyTypeText: 'Vacant land' })),
        supplementalSold: [{ ...sold[0], propertyTypeText: 'Vacant land', sourceLabel: 'Redfin', sourceUrl: 'https://redfin/duplicate' }],
        active: [], metrics: {}, providers: [], soldCount: 8, activeCount: 0, source: 'test',
      } as unknown as DealCardReportView['marketComps'],
    });
    const ci = buildComparableIntelligence(r);
    expect(ci.comparables).toHaveLength(7);
    expect(ci.selectedComparables).toHaveLength(5);
    expect(ci.selectedComparables.every((c) => c.status === 'sold')).toBe(true);
  });

  it('keeps even a close, recent sale as context until both property types are established', () => {
    const r = report({
      ddFactChecklist: [{ key: 'acres', label: 'Acres', value: '1 ac', status: 'verified', source: 'LandPortal' }],
      landportalInspection: {
        parcelUrl: 'x', comparablesUrl: null, parcelFacts: { Acres: '1' }, assets: [], overlays: [], visualObservations: [], sources: [], evidence: [], discoveryQuestions: [], missingInformation: [],
        comparables: [],
      },
      marketComps: {
        sold: [{ addressDesc: '1 Unknown Type Way', price: 20_000, pricePerAcre: 20_000, acres: 1, saleDateIso: '2026-02-01', distanceMiles: 2, sourceLabel: 'Source', sourceUrl: 'https://example.com' }],
        supplementalSold: [], active: [], metrics: {}, providers: [], soldCount: 1, activeCount: 0, source: 'test',
      } as unknown as DealCardReportView['marketComps'],
    });
    const ci = buildComparableIntelligence(r);
    expect(ci.selectedComparables).toEqual([]);
    expect(ci.rejectedComparables[0]?.reason).toMatch(/property type is not established/i);
  });
});
