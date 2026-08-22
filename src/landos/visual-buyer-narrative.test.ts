// Concise Visual Buyer narrative contract: five compact sections composed
// from the retained structured analysis; corrected access terminology; the
// corridor stays a former-grade conclusion; the visible structure is never
// upgraded to a house; market commentary is one closing sentence.

import { describe, expect, it } from 'vitest';

import { buildVisualBuyerNarrative } from './visual-buyer-narrative.js';
import type { VisualBuyerAnalysis } from './visual-buyer-analysis.js';

const ANALYSIS: VisualBuyerAnalysis = {
  generatedAt: '2026-08-04T00:00:00.000Z',
  subjectLabel: 'Test subject',
  basedOn: ['aerials', 'street view', 'overlays'],
  observedFeatures: [
    { label: 'Open areas', detail: 'Cleared meadow occupies the southern parcel.', views: ['aerials'], basis: 'direct_observation' },
    { label: 'Structures', detail: 'A small light-roofed outbuilding or shed sits near the center of the open meadow; its condition and status are not established.', views: ['aerials', '3D'], basis: 'direct_observation' },
  ],
  buyerInterpretation: [
    { label: 'Likely buyer appeal', detail: 'Reads as a classic rural homesite tract.', views: ['aerials'], basis: 'reasonable_interpretation' },
  ],
  unresolvedDiligence: ['Recorded legal access (instrument review)', 'Corridor rights'],
  buyerPerspective: {
    strongestAdvantages: ['Paved-road frontage with utilities at the road', 'Majority-buildable open meadow', 'Creek and woodland character'],
    importantConcerns: ['Corridor bisects the parcel and its rights are unresolved', 'Legal access not yet established by recorded instrument', 'Unknown status of the existing shed'],
    bestFitBuyers: ['Rural homesite builders', 'Recreational land buyers'],
    weakerFitBuyers: ['Commercial users', 'Buyers requiring immediate documented legal access'],
    preliminaryImpression: 'An attractive discovery-stage rural tract; corridor rights and value basis are the gating questions.',
    materialToValueOrStrategy: ['Resolution of corridor ownership'],
  },
  evidenceReconciliation: {
    supportingViews: ['close parcel aerial', 'street view scenes'],
    supersededConclusions: [{
      prior: 'From aerials alone, the diagonal corridor could have been an active railroad.',
      reconciled: 'The corridor is a cleared former-grade-style strip; it is not operating as an active railroad. Its current use and rights remain unconfirmed.',
      strongerEvidence: 'Street View corridor-crossing scene',
    }],
    remainingUncertain: ['Corridor ownership, use, and rights'],
    overallConfidence: 'moderate',
    confidenceWhy: 'Multi-view agreement with unresolved corridor rights.',
  },
  overviewSummary: {
    physicalCharacter: '11.46 wooded-and-meadow acres on paved Onionville Rd, split by the cleared Ontario Branch corridor.',
    mainBuyerAppeal: 'Private rural homesite or recreational tract with paved frontage and creek.',
    topConcern: 'The corridor bisecting the parcel has unresolved ownership and rights.',
  },
};

const CONTEXT = {
  legalAccessDisplay: 'Yes, via Onionville Road',
  apparentEntranceDisplay: 'Not confirmed from retained imagery',
  marketInterpretation: 'The subject 10 to 20 acre band shows strong sell-through with a median of 40 days on market. The fastest band is 5 to 10 acres.',
};

describe('concise narrative composition', () => {
  it('produces at most five compact sections with the expected titles', () => {
    const narrative = buildVisualBuyerNarrative(ANALYSIS, CONTEXT)!;
    expect(narrative.sections.length).toBeLessThanOrEqual(5);
    expect(narrative.sections.map((s) => s.title)).toEqual([
      'Property appearance', 'Buyer reaction', 'Strengths and concerns', 'Buyer fit', 'Property and market conclusion',
    ]);
    for (const section of narrative.sections) {
      expect(section.body.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(4);
    }
  });

  it('uses the approved access terminology and drops unresolved-access phrasing', () => {
    const text = JSON.stringify(buildVisualBuyerNarrative(ANALYSIS, CONTEXT));
    expect(text).toMatch(/Recorded legal access: Yes, via Onionville Road/);
    expect(text).toMatch(/apparent entrance: not confirmed from retained imagery/i);
    expect(text).not.toMatch(/not yet established by recorded instrument/i);
    expect(text).not.toMatch(/driveway (?:approval|permit)/i);
    expect(text).not.toMatch(/requiring immediate documented legal access/i);
  });

  it('keeps market commentary to one closing sentence from LandOS Market Research', () => {
    const narrative = buildVisualBuyerNarrative(ANALYSIS, CONTEXT)!;
    const conclusion = narrative.sections.find((s) => s.title === 'Property and market conclusion')!;
    expect(conclusion.body).toMatch(/strong sell-through/);
    expect(conclusion.body).not.toMatch(/fastest band/i);
    expect(narrative.overviewMarketLine).toMatch(/strong sell-through/);
  });

  it('never calls the visible structure a house and keeps the shed honestly unresolved', () => {
    const text = JSON.stringify(buildVisualBuyerNarrative(ANALYSIS, CONTEXT));
    expect(text).not.toMatch(/\bhouse\b|\bresidence\b|\bdwelling\b/i);
  });

  it('returns null without a retained analysis', () => {
    expect(buildVisualBuyerNarrative(null, CONTEXT)).toBeNull();
  });
});
