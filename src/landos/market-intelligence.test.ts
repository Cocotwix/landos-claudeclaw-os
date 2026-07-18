import { describe, expect, it } from 'vitest';
import { buildComparableIntelligence } from './comparable-intelligence.js';
import { buildMarketIntelligence } from './market-intelligence.js';
import type { DealCardReportView } from './deal-card-report.js';

function report(over: Partial<DealCardReportView>): DealCardReportView {
  return {
    parcelVerified: true,
    ddFactChecklist: [{ key: 'acres', label: 'Acres', value: '10 ac', status: 'verified', source: 'LandPortal', note: '' }],
    landportalInspection: {
      parcelUrl: 'x',
      comparablesUrl: 'x',
      parcelFacts: { Acres: '10', 'Land Use': 'Vacant land' },
      assets: [],
      overlays: [],
      visualObservations: [],
      comparables: [
        { rawText: 'A Sold $100,000 10 ac vacant', sourceUrl: 'x', acres: 10, price: 100000, pricePerAcre: 10000, status: 'sold', improvement: 'vacant', confidence: 'medium' },
        { rawText: 'B Sold $120,000 10 ac vacant', sourceUrl: 'x', acres: 10, price: 120000, pricePerAcre: 12000, status: 'sold', improvement: 'vacant', confidence: 'medium' },
      ],
      sources: [],
      evidence: [],
      discoveryQuestions: [],
      missingInformation: [],
    },
    marketComps: {
      sold: [],
      active: [{ price: 150000, saleDateIso: '', acres: 10, pricePerAcre: 15000, sourceUrl: 'z', sourceLabel: 'zillow', addressDesc: 'Active land' }],
      supplementalSold: [],
      metrics: { soldMedianPpa: 11000, ppaMin: 10000, ppaMax: 12000, domMedian: 90 },
      providers: [{ providerId: 'zillow', status: 'connected', kept: 1 }],
      soldCount: 2,
      activeCount: 1,
      source: 'multi-provider',
    },
    sourceTable: [{ source: 'LandPortal', kind: 'parcel_exact', status: 'used_non_credit', detail: 'Parcel verified.', compCreditUsed: false }],
    demographics: {},
    ...over,
  } as unknown as DealCardReportView;
}

describe('market intelligence capability', () => {
  it('builds a reusable market pulse with labeled estimated facts and sources', () => {
    const r = report({});
    const comps = buildComparableIntelligence(r);
    const mi = buildMarketIntelligence(r, comps);
    expect(mi.capability).toBe('market_intelligence');
    expect(mi.label).toBe('Parcel Verified Market Intelligence');
    expect(mi.marketPulse).toMatch(/\$11,000\/acre/);
    expect(mi.facts.find((f) => f.label === 'Sell-through rate')?.status).toBe('estimated');
    expect(mi.sources.some((s) => s.source === 'zillow')).toBe(true);
  });

  it('labels unverified parcel market intelligence as local area context', () => {
    const r = report({ parcelVerified: false });
    const mi = buildMarketIntelligence(r, buildComparableIntelligence(r));
    expect(mi.label).toBe('Local Area Market Intelligence, Not Parcel Verified');
    expect(mi.risks.join(' ')).toMatch(/not verified/i);
  });

  it('creates the concise owner-facing sections and only attaches retained source evidence', () => {
    const mi = buildMarketIntelligence(report({}), buildComparableIntelligence(report({})), {
      browserIntel: {
        status: 'collected', model: 'qwen3-vl', area: 'Fayetteville, Fayette County, GA', categories: [], note: '',
        evidence: [
          { url: 'https://example.test/development', source: 'Fayette Development Authority', sourceType: 'development', snippet: 'Major industrial project approved near Fayetteville.', timestamp: '2026-07-18', confidence: 'medium', supports: 'Industrial development.', doesNotProve: 'Parcel use.' },
          { url: 'https://example.test/road', source: 'GDOT', sourceType: 'infrastructure', snippet: 'Fayetteville road interchange expansion advances.', timestamp: '2026-07-18', confidence: 'medium', supports: 'Infrastructure.', doesNotProve: 'Parcel access.' },
          { url: 'https://example.test/zoning', source: 'Fayette County', sourceType: 'county_planning', snippet: 'Fayette County commission considers rezoning request.', timestamp: '2026-07-18', confidence: 'medium', supports: 'Planning.', doesNotProve: 'Subject zoning.' },
          { url: 'https://example.test/noise', source: 'Statewide outlet', sourceType: 'development', snippet: 'Atlanta official faces unrelated fraud charges.', timestamp: '2026-07-18', confidence: 'low', supports: 'Development query result.', doesNotProve: 'Parcel use.' },
        ],
      },
    });
    expect(mi.sections.map((section) => section.heading)).toEqual([
      'Property Movement', 'Most Active Property Type', 'Population Direction', 'Major Development Activity',
      'Infrastructure Expansion', 'Planning and Government Activity', 'Restrictions or Moratoriums', 'Deal Impact',
    ]);
    expect(mi.sections.find((section) => section.key === 'major_development_activity')?.sources[0]?.url).toBe('https://example.test/development');
    expect(mi.sections.find((section) => section.key === 'infrastructure_expansion')?.finding).toMatch(/interchange/i);
    expect(mi.sections.find((section) => section.key === 'planning_and_government_activity')?.finding).toMatch(/rezoning/i);
    expect(mi.sections.find((section) => section.key === 'major_development_activity')?.finding).not.toMatch(/fraud/i);
  });
});
