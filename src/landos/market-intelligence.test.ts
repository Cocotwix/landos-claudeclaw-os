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
});

