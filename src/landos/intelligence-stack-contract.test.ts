import { describe, expect, it } from 'vitest';

import type { AcquisitionDossier } from './acquisition-intelligence-dossier.js';
import {
  marketExpertReviewPrompt,
  propertyStructuredExtractionPrompt,
  marketStructuredExtractionPrompt,
  parseIntelligenceLayers,
  type IntelligencePassContext,
} from './intelligence-stack-contract.js';

describe('market exit-product parsing', () => {
  it('preserves an unknown resale duration as null rather than zero days', () => {
    const parsed = parseIntelligenceLayers(JSON.stringify({
      market: {
        score: 40,
        exitProductFits: [{
          product: 'Conditional two-lot partition',
          grade: 'C',
          expectedDays: null,
          confidence: 'Unresolved',
          read: 'Configuration-specific resale timing is not established.',
        }],
      },
    }));
    expect(parsed?.market?.exitProductFits[0]?.expectedDays).toBeNull();
  });

  it('rejects zero as a resale-duration estimate', () => {
    const parsed = parseIntelligenceLayers(JSON.stringify({
      market: { exitProductFits: [{ product: 'Unproven transformed product', expectedDays: 0 }] },
    }));
    expect(parsed?.market?.exitProductFits[0]?.expectedDays).toBeNull();
  });

  it('validates and preserves sourced web claims for evidence persistence', () => {
    const parsed = parseIntelligenceLayers(JSON.stringify({
      market: {
        nextActions: [{ action: 'Verify subdivision phase inventory', why: 'Changes absorption read' }],
        webEvidence: [
          { query: 'Fairview TN subdivision', title: 'Planning agenda', url: 'https://fairview-tn.org/agenda', sourceType: 'official_primary', materialClaim: 'A residential phase was approved.', evidenceSnippet: 'Phase 4 approval', confidence: 'high' },
          { title: 'Bad source', url: 'javascript:alert(1)', materialClaim: 'Nope' },
        ],
      },
    }));
    expect(parsed?.market?.webEvidence).toEqual([expect.objectContaining({
      title: 'Planning agenda', url: 'https://fairview-tn.org/agenda', sourceType: 'official_primary',
    })]);
    expect(parsed?.market?.nextActions[0]?.action).toBe('Verify subdivision phase inventory');
  });
});

describe('two-stage Market expert doctrine', () => {
  const dossier = {
    dealCardId: 89,
    identity: { displayAddress: '0 Kingwood Blvd, Fairview, TN', apn: '042', county: 'Williamson', stateCode: 'TN', state: 'confirmed' },
    acreage: { canonicalAcres: 51.11, source: 'Assessor', confidence: 'high', extentExplanation: null },
    market: { research: { rows: [{ acreageBand: '0-1' }, { acreageBand: '5-10' }, { acreageBand: '50-100' }] }, marketPulse: { neighboringDevelopment: 'sub-one-acre lots' } },
    comps: { acceptedSold: [{ key: 'sold' }], activeCompetition: [{ key: 'active' }] },
    physical: {}, access: {}, subdivision: {}, utilities: {}, history: {}, valuation: {}, landUse: {}, coverage: { present: [], absent: [] },
  } as unknown as AcquisitionDossier;
  const context = { phase: 'pre_call' } as IntelligencePassContext;
  const envelope = { dealCardId: 89, generatedAt: '2026-08-25T00:00:00.000Z', contextFingerprint: 'fp' };

  it('lets Stage A freely read all bands and Property-supported products with bounded search and no Quick Flip anchor', () => {
    const prompt = marketExpertReviewPrompt(dossier, { read: 'Sub-one-acre lots may be physically plausible.', potential: ['finished lots'] }, context, envelope);
    expect(prompt).toContain('"acreageBand":"0-1"');
    expect(prompt).toContain('Sub-one-acre lots may be physically plausible');
    expect(prompt).toContain('MAY use your web-search tool');
    expect(prompt).toContain('Think freely within your market domain');
    expect(prompt).toContain('Market Research acreage bands are observed transaction evidence, not the outer boundary');
    expect(prompt).toContain('Quick Flip is not automatically preferred');
    expect(prompt).not.toContain('Begin with quick as-is resale');
    expect(prompt).not.toContain('Do not research. No browsing');
  });

  it('keeps Market authority bounded while teaching question-driven residential product research', () => {
    const prompt = marketExpertReviewPrompt(dossier, { read: 'Sub-one-acre lots may be physically plausible.', potential: ['finished lots'] }, context, envelope);
    expect(prompt).toContain('title the concluding decision-useful section MARKET IMPLICATIONS');
    expect(prompt).toContain('Do not issue a final buy/pass judgment');
    expect(prompt).toContain('do not stop at "builders are active."');
    expect(prompt).toContain('actual closings or sales');
    expect(prompt).toContain('approved/proposed competing units');
    expect(prompt).toContain('make a reasonable direct investigation of that product market');
    expect(prompt).toContain('A builder announcement or marketing page establishes commitment');
    expect(prompt).toContain('Search is question-driven, never query-count-driven');
    expect(prompt).toContain('official government sources; planning, development, utility, and transportation records');
    expect(prompt).toContain('do not declare final highest and best use');
    expect(prompt).toContain('Establish each controlling caveat clearly once');
    expect(prompt).not.toContain('Reply with ONE JSON object');
  });

  it('makes Stage B extract from the exact completed review without browsing or rewriting it', () => {
    const review = 'Free expert review with overlooked development implications.\n\nSOURCE LEDGER\n- NONE';
    const prompt = marketStructuredExtractionPrompt(dossier, { read: 'Property read.' }, review, context, envelope);
    expect(prompt).toContain(review);
    expect(prompt).toContain('Do not browse or search in this pass');
    expect(prompt).toContain('schema is operational and does not replace it');
    expect(prompt).toContain('It is NOT the score for the intact subject tract');
    expect(prompt).toContain('Do not browse or search in this pass');
    expect(prompt).toContain('use grade null and expected_days null');
    expect(prompt).toContain('must not issue the final buy/pass decision');
    expect(prompt).toContain('market and data-quality risks or contradictions in risks');
  });

  it('preserves Unresolved for an uncreated product instead of forcing D liquidity', () => {
    const parsed = parseIntelligenceLayers(JSON.stringify({
      market: {
        overall_market_quality: { grade: 'B', read: 'Good broader residential market.' },
        exit_product_fits: [{
          product: 'Hypothetical entitled builder tract',
          grade: null,
          expected_days: null,
          confidence: 'Unresolved',
          read: 'The product has not been created and post-entitlement resale timing is not supported.',
        }],
      },
    }));
    expect(parsed?.market?.overallMarketQuality.grade).toBe('B');
    expect(parsed?.market?.exitProductFits[0]).toMatchObject({ grade: null, expectedDays: null });
  });
});

describe('current expert reads', () => {
  it('parses multi-paragraph current reads verbatim with no truncation cap', () => {
    const paragraphA = `The tract is physically stronger than the slope figure suggests. ${'Evidence detail. '.repeat(160)}`.trim();
    const paragraphB = 'The main open question is septic feasibility, which controls the estate-lot hypothesis.';
    const parsed = parseIntelligenceLayers(JSON.stringify({
      property: { read: 'Short thesis.', current_expert_read: `${paragraphA}\n\n${paragraphB}` },
      market: { read: 'Market thesis.', current_expert_read: 'Liquidity favors smaller products.\n\nThe intact tract is the slow path.' },
      deal: { current_deal_read: 'Taken together, the deal currently hinges on basis.\n\nNext: the discovery call.', reads: {} },
    }));
    // Verbatim paragraphs, joined by blank lines — never sliced to a char cap.
    expect(parsed?.property?.currentExpertRead).toBe(`${paragraphA}\n\n${paragraphB}`);
    expect(parsed?.property?.currentExpertRead?.length).toBeGreaterThan(2_000);
    expect(parsed?.market?.currentExpertRead).toContain('slow path');
    expect(parsed?.dealExtras?.currentDealRead).toContain('discovery call');
  });

  it('keeps old snapshots compatible: a missing current read parses to null', () => {
    const parsed = parseIntelligenceLayers(JSON.stringify({
      property: { read: 'Legacy structured read.' },
      market: { read: 'Legacy market read.' },
      deal: { reads: {} },
    }));
    expect(parsed?.property?.currentExpertRead).toBeNull();
    expect(parsed?.market?.currentExpertRead).toBeNull();
    expect(parsed?.dealExtras?.currentDealRead).toBeNull();
  });

  it('instructs every specialist path to produce a genuine judgment read, never a truncation', () => {
    const dossier = {
      dealCardId: 89,
      identity: { displayAddress: '0 Kingwood Blvd, Fairview, TN', apn: '042', county: 'Williamson', stateCode: 'TN', state: 'confirmed' },
      acreage: { canonicalAcres: 51.11, source: 'Assessor', confidence: 'high', extentExplanation: null },
      visuals: [],
      seller: { sellerReportedFacts: [], communications: [], discovery: [] },
      conflicts: [],
      visualObservations: [],
      market: {}, comps: {}, physical: {}, access: {}, subdivision: {}, utilities: {}, history: {}, valuation: {}, landUse: {},
      coverage: { present: [], absent: [] },
    } as unknown as AcquisitionDossier;
    const context = {
      phase: 'pre_call',
      canonicalScores: { property: null, market: null, seller: null },
      knownUnresolved: [],
      guidance: [],
    } as unknown as IntelligencePassContext;
    const envelope = { dealCardId: 89, generatedAt: '2026-08-25T00:00:00.000Z', contextFingerprint: 'fp' };
    const property = propertyStructuredExtractionPrompt(dossier, [], 'Review.', context, envelope);
    const market = marketStructuredExtractionPrompt(dossier, { read: 'Property read.' }, 'Review.\n\nSOURCE LEDGER\n- NONE', context, envelope);
    for (const prompt of [property, market]) {
      expect(prompt).toContain('"current_expert_read" is the CURRENT EXPERT READ');
      expect(prompt).toContain('NOT an excerpt or truncation of the expert review');
      expect(prompt).toContain('2-4 short paragraphs');
      expect(prompt).toContain('conciseness is subordinate to material completeness');
    }
  });
});
