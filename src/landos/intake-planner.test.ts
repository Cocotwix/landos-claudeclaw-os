// Tests for the LandOS Intake / Main Orchestrator planner. Pure + deterministic:
// no DB, no network, no LandPortal/comp calls, no secrets, no fake market data.

import { describe, it, expect } from 'vitest';

import { planLandosIntake, resolveStrategyFeedback } from './intake-planner.js';
import type { LandOSIntake, StrategyCandidate, UnderwritingResult } from './intake-types.js';

function intake(text: string, over: Partial<LandOSIntake> = {}): LandOSIntake {
  return { transport: 'dashboard_text', text, ...over };
}

const FULL_ADDRESS = '1234 Filter Plant Rd, Cottageville, SC';
const APN_COUNTY = 'APN: 051-012-05, Colleton County, SC';
const OWNER_COUNTY = 'Owner: Cheryl Sann, Colleton County, SC';
const STREET_ONLY = 'Bub Wise Rd, Swansea SC';
const MARKET_Q = "what's land worth per acre for 5-10 acre vacant tracts in this market";

describe('classification and dispatch lanes', () => {
  it('full address plans Duke + Market Research', () => {
    const p = planLandosIntake(intake(FULL_ADDRESS));
    expect(p.classification.classification).toBe('parcel_level');
    expect(p.dukeParcelVerification.status).toBe('planned');
    expect(p.marketResearch.lane).toBe('Market Research');
  });

  it('APN + county plans Duke + Market Research + Deal Card Persistence', () => {
    const p = planLandosIntake(intake(APN_COUNTY));
    expect(p.classification.parcelIdentity).toBe('apn_county');
    expect(p.dukeParcelVerification.status).toBe('planned');
    expect(p.dealCardPersistence.status).toBe('planned');
  });

  it('owner + county plans a Duke owner search + Market Research', () => {
    const p = planLandosIntake(intake(OWNER_COUNTY));
    expect(p.classification.parcelIdentity).toBe('owner_county');
    expect(p.dukeParcelVerification.status).toBe('planned');
    expect(p.dukeParcelVerification.reason.toLowerCase()).toContain('owner');
  });

  it('street/city/state only plans area-only Market Research + Ace missing-info, no property valuation', () => {
    const p = planLandosIntake(intake(STREET_ONLY));
    expect(p.classification.classification).toBe('area_only_market');
    expect(p.dukeParcelVerification.status).toBe('not_applicable');
    expect(p.aceDiscoveryPrep.status).toBe('planned');
    expect(p.strategy.status).not.toBe('planned');
    expect(p.underwriting.status).not.toBe('planned');
  });

  it('local market question plans Market Research only (no Ace, no Duke)', () => {
    const p = planLandosIntake(intake(MARKET_Q));
    expect(p.classification.classification).toBe('area_only_market');
    expect(p.dukeParcelVerification.status).toBe('not_applicable');
    expect(p.aceDiscoveryPrep.status).toBe('not_applicable');
  });

  it('seller call prep plans Ace', () => {
    const p = planLandosIntake(intake('prep me for a seller call with these discovery questions'));
    expect(p.classification.classification).toBe('seller_discovery');
    expect(p.aceDiscoveryPrep.status).toBe('planned');
  });

  it('"Forge, fix this" plans Forge Repair, not Duke', () => {
    const p = planLandosIntake(intake('Forge, fix this'));
    expect(p.classification.classification).toBe('forge_repair');
    expect(p.forgeRepair.status).toBe('planned');
    expect(p.dukeParcelVerification.status).toBe('not_applicable');
  });

  it('"Forge, build me a CRM manager" plans Forge Build/Interview', () => {
    const p = planLandosIntake(intake('Forge, build me a CRM manager agent'));
    expect(p.classification.classification).toBe('forge_build_interview');
    expect(p.forgeBuildInterview.status).toBe('planned');
  });

  it('"Open War Room with Duke and Strategy" is a War Room classification, not hidden collaboration', () => {
    const p = planLandosIntake(intake('Open War Room with Duke, Strategy, and Underwriting'));
    expect(p.classification.classification).toBe('war_room');
    expect(p.interAgentCollaboration.status).toBe('not_applicable');
  });

  it('normal property intake does NOT route through War Room', () => {
    const p = planLandosIntake(intake(FULL_ADDRESS));
    expect(p.classification.classification).not.toBe('war_room');
    expect(p.interAgentCollaboration.status).toBe('planned');
  });

  it('"Add a new Marketing department later" is a future department capability request', () => {
    const p = planLandosIntake(intake('Add a new Marketing department later'));
    expect(p.classification.classification).toBe('future_department_route');
    expect(p.futureDepartmentCapability.status).toBe('supported');
  });
});

describe('transport-agnostic + manual/CRM parity', () => {
  it('dashboard text and CRM lead produce the same dispatch logic', () => {
    const a = planLandosIntake(intake(APN_COUNTY, { transport: 'dashboard_text' }));
    const b = planLandosIntake(intake(APN_COUNTY, { transport: 'crm_lead' }));
    expect(b.dukeParcelVerification.status).toBe(a.dukeParcelVerification.status);
    expect(b.marketResearch.status).toBe(a.marketResearch.status);
    expect(b.dealCardPersistence.status).toBe(a.dealCardPersistence.status);
  });

  it('dashboard voice transcript and telegram voice transcript use the same intake type', () => {
    const a = planLandosIntake(intake(APN_COUNTY, { transport: 'dashboard_voice_transcript', voiceTranscriptSource: 'dashboard_mic' }));
    const b = planLandosIntake(intake(APN_COUNTY, { transport: 'telegram_voice_transcript', voiceTranscriptSource: 'telegram_voice' }));
    expect(a.classification.classification).toBe(b.classification.classification);
    expect(a.dukeParcelVerification.status).toBe(b.dukeParcelVerification.status);
  });

  it('can classify a voice transcript without requiring STT to be implemented', () => {
    const p = planLandosIntake(intake(FULL_ADDRESS, { transport: 'telegram_voice_transcript' }));
    expect(p.responseModePlan.sttProviderStatus).toBe('not_connected');
    expect(p.classification.classification).toBe('parcel_level');
  });
});

describe('voice response intent (no fake TTS)', () => {
  it('voice can be requested while TTS remains not_available', () => {
    const p = planLandosIntake(intake(FULL_ADDRESS, { requestedResponseMode: 'voice_briefing_requested' }));
    expect(p.responseModePlan.responseMode).toBe('voice_briefing_requested');
    expect(p.voiceResponse.status).toBe('not_available');
    expect(p.responseModePlan.ttsProviderStatus).toBe('not_connected');
  });

  it('defaults to text_only with voice not_requested', () => {
    const p = planLandosIntake(intake(FULL_ADDRESS));
    expect(p.responseModePlan.responseMode).toBe('text_only');
    expect(p.voiceResponse.status).toBe('not_requested');
  });
});

describe('parcel verification gating (Strategy / Underwriting)', () => {
  it('unverified parcel blocks Strategy and Underwriting from property-specific work', () => {
    const p = planLandosIntake(intake(FULL_ADDRESS));
    expect(p.strategy.status).toBe('blocked');
    expect(p.underwriting.status).toBe('blocked');
    expect(p.strategyUnderwritingPlan.missingFactsBlockingDecision).toContain('verified_parcel_identity');
  });

  it('verified parcel context can plan Strategy + Underwriting', () => {
    const p = planLandosIntake(intake('what should we do with this?', {
      context: { parcelVerified: true, verifiedFacts: [{ fact: 'acres', value: '5', source: 'county GIS' }] },
    }));
    expect(p.classification.classification).toBe('parcel_level');
    expect(p.strategy.status).toBe('planned');
    expect(p.underwriting.status).toBe('planned');
  });

  it('unverified parcel does not allow expensive strategy reasoning tier', () => {
    const p = planLandosIntake(intake(FULL_ADDRESS));
    expect(p.strategy.modelRouting!.tier).not.toBe('strong_reasoning');
  });

  it('verified parcel uses strong reasoning for strategy', () => {
    const p = planLandosIntake(intake('what should we do with this?', { context: { parcelVerified: true } }));
    expect(p.strategy.modelRouting!.tier).toBe('strong_reasoning');
  });
});

describe('Strategy ⇄ Underwriting feedback loop', () => {
  const candidates: StrategyCandidate[] = [
    { strategy: 'subdivide', rationale: 'lot size supports a split' },
    { strategy: 'quick_flip', rationale: 'low basis' },
    { strategy: 'owner_finance', rationale: 'seller flexible' },
  ];

  it('Strategy can propose multiple exit paths', () => {
    const plan = resolveStrategyFeedback(candidates, [], true);
    expect(plan.strategyCandidates.length).toBe(3);
  });

  it('Underwriting can reject a Strategy proposal and Strategy re-evaluates alternatives', () => {
    const uw: UnderwritingResult[] = [
      { strategy: 'subdivide', result: 'fail', reason: 'subdivision cost exceeds margin' },
      { strategy: 'quick_flip', result: 'pass', reason: 'meets minimum net profit' },
      { strategy: 'owner_finance', result: 'pass', reason: 'positive yield' },
    ];
    const plan = resolveStrategyFeedback(candidates, uw, true);
    expect(plan.rejectedStrategies.map((r) => r.strategy)).toContain('subdivide');
    expect(plan.finalStrategyStatus).toBe('recommended');
    // Final recommendation never includes a strategy that failed underwriting.
    expect(plan.recommendedStrategy).not.toBe('subdivide');
    expect(['quick_flip', 'owner_finance']).toContain(plan.recommendedStrategy);
  });

  it('if all strategies fail underwriting, final status is pass/no offer', () => {
    const uw: UnderwritingResult[] = candidates.map((c) => ({ strategy: c.strategy, result: 'fail' as const, reason: 'below minimum profit' }));
    const plan = resolveStrategyFeedback(candidates, uw, true);
    expect(plan.finalStrategyStatus).toBe('pass_no_offer');
    expect(plan.recommendedStrategy).toBeUndefined();
  });

  it('blocks the whole loop when parcel identity is unverified', () => {
    const plan = resolveStrategyFeedback(candidates, [], false);
    expect(plan.finalStrategyStatus).toBe('blocked');
    expect(plan.strategyStatus).toBe('blocked');
    expect(plan.underwritingStatus).toBe('blocked');
  });
});

describe('market research honesty + no fake data', () => {
  it('Market Research returns not_available when no browsing/search adapter exists', () => {
    const p = planLandosIntake(intake(FULL_ADDRESS));
    expect(p.marketResearch.status).toBe('not_available');
    expect(p.marketResearch.reason.toLowerCase()).toContain('no approved browsing');
  });

  it('does not fake active listings / sold counts / median price per acre', () => {
    const p = planLandosIntake(intake(MARKET_Q));
    const blob = JSON.stringify(p.marketResearch);
    expect(blob.toLowerCase()).toContain('not_available');
    // No fabricated decision-grade numbers leak into the plan.
    expect(p.marketResearch.status).not.toBe('planned');
  });

  it('local market data cannot verify parcel identity (DD capability preserves the rule)', () => {
    const p = planLandosIntake(intake(FULL_ADDRESS));
    expect(p.dueDiligenceCapability.preserves).toContain('no_coordinate_parcel_verification');
    expect(p.dueDiligenceCapability.preserves).toContain('unverified_parcel_blocking');
  });

  it('area-only input allows market commentary intent but no property-specific underwriting', () => {
    const p = planLandosIntake(intake(STREET_ONLY));
    expect(p.underwriting.status).toBe('not_applicable');
    expect(p.strategy.status).toBe('not_applicable');
  });
});

describe('deal card persistence truth labels', () => {
  it('never marks unverified data as verified', () => {
    const p = planLandosIntake(intake(FULL_ADDRESS));
    const verifiedTargets = p.dealCardPersistencePlan.persistenceTargets.filter((t) => t.label === 'verified');
    expect(verifiedTargets.length).toBe(0);
    expect(p.dealCardPersistencePlan.persistenceTargets.some((t) => t.label === 'needs_verification')).toBe(true);
  });

  it('only persists caller facts as verified when a named source is present', () => {
    const p = planLandosIntake(intake('what should we do with this?', {
      context: {
        parcelVerified: true,
        verifiedFacts: [
          { fact: 'acres', value: '5', source: 'county GIS' },
          { fact: 'zoning', value: 'RR', source: '' },
        ],
      },
    }));
    const targets = p.dealCardPersistencePlan.persistenceTargets;
    expect(targets.some((t) => t.key === 'verified:acres' && t.label === 'verified' && t.source === 'county GIS')).toBe(true);
    // Unsourced fact cannot become a verified fact.
    expect(targets.some((t) => t.key.startsWith('unsourced:') && t.label === 'needs_verification')).toBe(true);
    expect(targets.some((t) => t.key === 'verified:zoning')).toBe(false);
  });

  it('failed/unvalidated information is not eligible to persist as deal-card fact', () => {
    const p = planLandosIntake(intake(APN_COUNTY));
    expect(p.dealCardPersistencePlan.rule.toLowerCase()).toContain('never stored as a deal-card fact');
  });
});

describe('inter-agent collaboration (distinct from War Room)', () => {
  it('plans hidden collaboration without Tyler present, with purpose/participants/maxRounds/outputOwner/summary', () => {
    const p = planLandosIntake(intake(APN_COUNTY));
    const plan = p.interAgentCollaborationPlan;
    expect(plan.status).toBe('planned');
    expect(plan.requiresTylerApproval).toBe(false);
    expect(plan.collaborationParticipants.length).toBeGreaterThan(0);
    expect(plan.collaborationPurpose.length).toBeGreaterThan(0);
    expect(plan.maxRounds).toBeGreaterThan(0);
    expect(plan.maxRounds).toBeLessThanOrEqual(3);
    expect(plan.outputOwner.length).toBeGreaterThan(0);
    expect(plan.collaborationSummaryRequired).toBe(true);
  });

  it('exposes Duke->Ace handoff for missing parcel identity gaps', () => {
    const p = planLandosIntake(intake(OWNER_COUNTY));
    const handoffs = p.interAgentCollaborationPlan.allowedHandoffs;
    expect(handoffs.some((h) => h.from === 'duke-due-diligence' && h.to === 'acquisition-copilot')).toBe(true);
  });
});

describe('agent knowledge retrieval + training boundary', () => {
  it('plans knowledge retrieval but returns not_available when no store is connected', () => {
    const p = planLandosIntake(intake('use the seller call training database to prep me'));
    expect(p.classification.classification).toBe('agent_knowledge_retrieval');
    expect(p.agentKnowledgeRetrieval.status).toBe('not_available');
  });

  it('raw training content is not treated as approved active knowledge', () => {
    const p = planLandosIntake(intake('use the seller call training database'));
    expect(p.agentKnowledgeRetrievalPlan.privateDataBoundary.toLowerCase()).toContain('not active operating truth');
  });

  it('storage plan keeps private/raw training out of the repo', () => {
    const p = planLandosIntake(intake(FULL_ADDRESS));
    expect(p.storagePlan.repoContainsRawTraining).toBe(false);
    expect(p.storagePlan.rawMediaLocation).toBe('onedrive_or_cloud');
  });
});

describe('model routing + extensibility + safety language', () => {
  it('includes a model route in the worker dispatch plan', () => {
    const p = planLandosIntake(intake(APN_COUNTY));
    expect(p.modelRouting.status).toBe('planned');
    expect(p.dukeParcelVerification.modelRouting!.tier).toBe('deterministic_code');
  });

  it('exposes future department/agent support via the registry summary', () => {
    const p = planLandosIntake(intake(FULL_ADDRESS));
    expect(p.departmentRegistrySummary.some((d) => d.id === 'research_due_diligence' && d.operational)).toBe(true);
    expect(p.departmentRegistrySummary.some((d) => d.id === 'marketing' && !d.operational)).toBe(true);
    expect(p.extensibilityNote.length).toBeGreaterThan(0);
  });

  it('uses no coordinate/geocoder/visual/external-portal verification language anywhere in the plan', () => {
    const p = planLandosIntake(intake(FULL_ADDRESS));
    const blob = JSON.stringify(p).toLowerCase();
    // No banned identification sources/visuals.
    for (const banned of ['geocoder', 'geocode', 'street view', 'satellite', 'map pin', 'zillow', 'redfin', 'realtor', 'landwatch']) {
      expect(blob.includes(banned), `plan should not contain "${banned}"`).toBe(false);
    }
    // No raw lat/long coordinate pair leaks into the plan.
    expect(/-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+/.test(blob)).toBe(false);
    // The DD capability explicitly preserves the no-coordinate-verification rule.
    expect(p.dueDiligenceCapability.preserves).toContain('no_coordinate_parcel_verification');
  });

  it('is read-only and deterministic', () => {
    expect(planLandosIntake(intake(APN_COUNTY)).executionMode).toBe('read_only_plan');
    expect(planLandosIntake(intake(APN_COUNTY))).toEqual(planLandosIntake(intake(APN_COUNTY)));
  });
});
