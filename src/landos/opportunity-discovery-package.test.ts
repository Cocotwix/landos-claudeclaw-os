import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb, getLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { getDealCardReport } from './deal-card-report.js';
import {
  buildDiscoveryPackage,
  getStoredDiscoveryPackage,
  renderDiscoveryPackageMarkdown,
} from './opportunity-discovery-package.js';
import { getOpportunityByDealCardId } from './opportunity.js';
import { attachCardSourceEvidence, upsertPropertyCard } from './property-card.js';

function lead(input: { verified?: boolean } = {}) {
  const property = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: '101 Test Ridge Road',
    city: 'Exampleville', county: 'Sample', state: 'TN',
    apn: input.verified ? '123-456-789' : undefined,
    verified: input.verified,
    verificationSource: input.verified ? 'Sample County GIS parcel record' : undefined,
    owner: input.verified ? 'Example Owner' : undefined,
    acres: input.verified ? 10 : undefined,
    agentId: 'Property Research Agent',
  }).card;
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Example manual lead', leadType: 'manual' });
  linkPropertyToDeal({ dealCardId: deal.id, cardId: property.id, role: 'subject' });
  const opportunity = getOpportunityByDealCardId(deal.id);
  getLandosDb().prepare(`UPDATE landos_opportunity SET raw_input = ?, source = 'manual' WHERE id = ?`)
    .run('Seller says ten acres near Test Ridge Road.', opportunity.id);
  return { deal, property, opportunity: getOpportunityByDealCardId(deal.id) };
}

function persistDefensibleReport(dealCardId: number): void {
  const base = getDealCardReport(dealCardId);
  const report = {
    ...base,
    parcelVerified: true,
    parcelVerificationStatus: 'Parcel verified by Sample County GIS',
    dataGaps: ['Confirm utility availability'],
    ddFactChecklist: [
      { key: 'acres', label: 'Acreage', value: '10 ac', status: 'verified', source: 'Sample County GIS', url: 'https://sample.gov/gis/parcel/123', timestamp: '2026-07-17', confidence: 'high' },
      { key: 'roadFrontageFt', label: 'Road frontage', value: '300 ft', status: 'verified', source: 'Sample County GIS', url: 'https://sample.gov/gis/parcel/123', timestamp: '2026-07-17', confidence: 'medium' },
      { key: 'zoning', label: 'Zoning', value: null, status: 'needs_verification', source: null, confidence: 'none' },
    ],
    landportalInspection: {
      parcelUrl: 'https://example.test/parcel/123', comparablesUrl: 'https://example.test/comps',
      parcelFacts: { Acres: '10', LandUse: 'Vacant land' },
      assets: [{ key: 'parcel', label: 'Parcel boundary', kind: 'parcel_boundary', url: '/api/visual/parcel.png', timestamp: '2026-07-17T12:00:00Z', note: 'APN visible on parcel page' }],
      overlays: [], visualObservations: [],
      comparables: [
        { rawText: 'Vacant land sold', sourceUrl: 'https://example.test/sold/1', address: '1 Rural Rd', saleDate: '2026-02-01', acres: 9, price: 90000, pricePerAcre: 10000, distanceMiles: 2, status: 'sold', improvement: 'vacant', confidence: 'high' },
        { rawText: 'Vacant land sold', sourceUrl: 'https://example.test/sold/2', address: '2 Rural Rd', saleDate: '2026-01-01', acres: 11, price: 132000, pricePerAcre: 12000, distanceMiles: 3, status: 'sold', improvement: 'vacant', confidence: 'high' },
        { rawText: 'Vacant land sold', sourceUrl: 'https://example.test/sold/3', address: '3 Rural Rd', saleDate: '2025-12-01', acres: 10, price: 110000, pricePerAcre: 11000, distanceMiles: 4, status: 'sold', improvement: 'vacant', confidence: 'high' },
      ],
      sources: [], evidence: [], discoveryQuestions: [], missingInformation: [],
    },
    landScore: {
      score: 72, maxScore: 100, verdict: 'promising', confidence: 'reduced', rubricSource: 'test rubric',
      dataGaps: ['utilities'], flags: [], note: 'One explicit gap.',
      factors: [
        { id: 'access', label: 'Access', maxPoints: 20, points: 18, lowestTier: false, dataGap: false, basis: '300 ft frontage' },
        { id: 'wetlands', label: 'Wetlands', maxPoints: 15, points: 15, lowestTier: false, dataGap: false, basis: 'none mapped' },
        { id: 'fema', label: 'Flood', maxPoints: 15, points: 15, lowestTier: false, dataGap: false, basis: 'zone X' },
        { id: 'slope_buildability', label: 'Slope', maxPoints: 15, points: 12, lowestTier: false, dataGap: false, basis: 'mostly buildable' },
        { id: 'size_usability', label: 'Size', maxPoints: 15, points: 12, lowestTier: false, dataGap: false, basis: '10 acres' },
        { id: 'valuation_confidence', label: 'Valuation', maxPoints: 20, points: 0, lowestTier: true, dataGap: true, basis: 'thin comps' },
      ],
    },
  };
  getLandosDb().prepare(`
    INSERT INTO landos_deal_card_report (
      deal_card_id, report_status, parcel_verification_status, parcel_verified,
      dd_summary, market_summary, strategy_summary, most_viable_strategy,
      offer_readiness, report_json, updated_by
    ) VALUES (?, 'complete_with_gaps', ?, 1, '', '', '', 'Cash Flip', 'needs_confirmation', ?, 'Property Research Agent')
  `).run(dealCardId, report.parcelVerificationStatus, JSON.stringify(report));
}

describe('Phase 1 opportunity discovery package', () => {
  beforeEach(() => _initTestLandosDb());

  it('persists a useful unresolved call brief without unsupported offer preparation', () => {
    const { deal, opportunity } = lead();
    const first = buildDiscoveryPackage(deal.id);
    const second = buildDiscoveryPackage(deal.id);

    expect(first.contentHash).toBe(second.contentHash);
    expect(first.identity.resolved).toBe(false);
    expect(first.callPrep.ready).toBe(false);
    expect(first.callPrep.status).toBe('incomplete');
    expect(first.callPrep.blockers.length).toBeGreaterThan(0);
    expect(first.callPrep.questions.length).toBeGreaterThanOrEqual(10);
    expect(first.callPrep.unresolvedIdentityWarning).toMatch(/cannot support parcel claims/i);
    expect(first.preliminaryValue.offerPreparationAllowed).toBe(false);
    expect(first.strategyMode).toBe('validation_hypotheses');
    expect(first.strategies).toHaveLength(2);
    expect(new Set(first.strategies.map((strategy) => strategy.name)).size).toBe(2);
    expect(first.deedFindings.disclaimer).toMatch(/not title.*legal/i);
    expect(first.lienReview.status).toBe('not_searched');
    expect(getStoredDiscoveryPackage(opportunity.id)).toEqual(second);
    expect(renderDiscoveryPackageMarkdown(first)).toMatch(/call may proceed/i);
  });

  it('exposes a defensible 40–60% owner-review range, source facts, deed findings, score gaps, and exactly two strategies', () => {
    const { deal, property } = lead({ verified: true });
    attachCardSourceEvidence({
      cardId: property.id,
      fact: 'Vesting deed owner and easement review',
      value: 'Example Owner',
      sourceLabel: 'Sample County Register of Deeds',
      sourceUrl: 'https://sample.gov/deeds/123',
      dateAccessed: '2026-07-17',
      note: 'Example Owner is grantee; no express easement found in this instrument.',
      parcelVerified: true,
    });
    attachCardSourceEvidence({
      cardId: property.id,
      fact: 'Recorded lien review',
      sourceLabel: 'Sample County lien index',
      sourceUrl: 'https://sample.gov/liens',
      dateAccessed: '2026-07-17',
      note: 'Result: No matching lien-index entry was returned for the searched owner. This is not a clear-title or no-lien conclusion. Searched: Example Owner',
      parcelVerified: true,
    });
    persistDefensibleReport(deal.id);

    const pkg = buildDiscoveryPackage(deal.id);
    expect(pkg.identity.resolved).toBe(true);
    const mid = pkg.preliminaryValue.marketValue?.mid;
    expect(mid).toBeTypeOf('number');
    expect(pkg.preliminaryValue.ownerReviewAcquisitionRange40To60Pct).toEqual({ low: Math.round(mid! * 0.4), high: Math.round(mid! * 0.6) });
    expect(pkg.preliminaryValue.offerPreparationAllowed).toBe(false);
    expect(pkg.strategies).toHaveLength(2);
    expect(pkg.callPrep.ready).toBe(true);
    expect(pkg.strategyMode).toBe('ranked');
    expect(pkg.deedFindings.status).toBe('reviewed');
    expect(pkg.deedFindings.findings[0].sourceUrl).toContain('sample.gov');
    expect(pkg.lienReview.status).toBe('reviewed');
    expect(pkg.lienReview.findings[0].value).toMatch(/not a clear-title/i);
    expect(pkg.landScore.subscores).toHaveLength(11);
    expect(pkg.landScore.gaps.length).toBeGreaterThan(0);
    expect(pkg.sources.some((source) => source.url?.includes('sample.gov'))).toBe(true);

    const markdown = renderDiscoveryPackageMarkdown(pkg);
    expect(markdown).toContain(`${Math.round(mid! * 0.4).toLocaleString()} – $${Math.round(mid! * 0.6).toLocaleString()}`);
    expect(markdown).toContain('Two evidence-backed first-look strategies');
    expect(markdown).toContain(pkg.deedFindings.disclaimer);
  });
});
