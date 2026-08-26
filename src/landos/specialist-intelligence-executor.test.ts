import { describe, expect, it } from 'vitest';

import {
  createIntelligenceExecutor,
  createSpecialistIntelligenceExecutor,
  intelligenceExecutorRuntimeStatus,
  resolveIntelligenceExecutor,
  specialistInvocationArgs,
  INTELLIGENCE_EXECUTOR_KEY,
  SPECIALIST_PROFILES,
} from './specialist-intelligence-executor.js';
import type { SettingsReader, SpecialistExecutionPlan } from './acquisition-analyst.js';
import { buildAcquisitionDossier, type AcquisitionDossier, type PropertyFileSource } from './acquisition-intelligence-dossier.js';
import {
  parseIntelligenceLayers,
  marketExpertReviewPrompt,
  marketStructuredExtractionPrompt,
  propertyExpertReviewPrompt,
  propertyStructuredExtractionPrompt,
  specialistDealPrompt,
  specialistLayerPrompt,
  type IntelligencePassContext,
} from './intelligence-stack-contract.js';
import { computeQuickFlipScreen, evaluateSellerPrice } from './quick-flip-screen.js';

// The Slice 6 promise: the four products keep their contracts while each
// layer's reasoning runs on its own PERSISTENT Hermes profile — persistent
// specialist identity, fresh bounded deal context, never persistent deal
// facts. These tests pin the routing, the parallelism, the ordering, the
// isolation, the least-privilege transport, the refusal of malformed output
// and the governed rollback boundary.

function settings(values: Record<string, string> = {}): SettingsReader {
  const store = { ...values };
  return {
    getDashboardSetting: (key) => store[key] ?? null,
    setDashboardSetting: (key, value) => { store[key] = value; },
  };
}

function dossierFor(input: { address: string; apn: string; acres: number }): AcquisitionDossier {
  const source: PropertyFileSource = {
    dealCardId: 89,
    now: () => new Date('2026-08-21T00:00:00.000Z'),
    propertyIntelligence: {
      snapshot: {
        identity: { state: 'confirmed', displayAddress: input.address, apn: input.apn, county: 'Williamson', stateCode: 'TN', acres: input.acres },
      },
    },
  } as unknown as PropertyFileSource;
  return buildAcquisitionDossier(source);
}

const FAIRVIEW = { address: '0 Kingwood Blvd, Fairview, TN 37062', apn: '042-123.00-000', acres: 51.11 };
const OTHER_DEAL = { address: '450 Cedar Hollow Ln, Dickson, TN 37055', apn: '099-045.00-000', acres: 12.4 };

function passContext(dossier: AcquisitionDossier, layers: IntelligencePassContext['layers']): IntelligencePassContext {
  const quickFlip = computeQuickFlipScreen({ supportedFmv: null, fmvBasis: null, acceptedCompCount: 0, expectedResaleDays: null });
  return {
    layers,
    phase: 'pre_call',
    quickFlip,
    sellerPriceVerdict: evaluateSellerPrice(quickFlip, null),
    canonicalScores: { property: 82, market: 76, seller: null },
    sellerEstablished: false,
    guidance: [],
    readinessHeadline: null,
    knownUnresolved: [],
    retainedReads: {},
  };
}

const LAYER_REPLIES: Record<string, string> = {
  [SPECIALIST_PROFILES.property]: JSON.stringify({ property: { score: 60, read: 'Property read.', strengths: [], constraints: [], potential: [], conflicts: [], unknowns: [], next_actions: [] } }),
  [SPECIALIST_PROFILES.market]: JSON.stringify({ market: { score: 55, read: 'Market read.', liquidity_read: 'Slow band.', best_signals: [], risks: [], exit_implications: [], unknowns: [] } }),
  [SPECIALIST_PROFILES.seller]: JSON.stringify({ seller: { score: 50, read: 'Seller read.', objections: [], seller_reported_facts: [], follow_ups: [], contradictions: [], unknowns: [] } }),
  [SPECIALIST_PROFILES.deal]: JSON.stringify({
    deal: {
      score: 70,
      deal_read: { headline: 'Chair synthesis.', judgment: 'Synthesized from fresh products.', confidence: 'Likely' },
      property_story: [], market_story: [], opportunities: [], constraints: [],
      strategies: [{ strategy: 'Quick flip', fit: 'possible', why_it_fits: 'simple' }],
      visual_observations: [], conflicts: [], unknowns: [], next_actions: [],
      reads: { property: 'p', market: 'm', seller: 's' },
    },
  }),
};

const profileOf = (args: string[]): string => args[args.indexOf('--profile') + 1];
const promptOf = (args: string[]): string => args[args.indexOf('--oneshot') + 1];

function planFor(dossier: AcquisitionDossier, layers: SpecialistExecutionPlan['layers']): SpecialistExecutionPlan {
  const context = passContext(dossier, layers);
  const envelope = { dealCardId: dossier.dealCardId, generatedAt: '2026-08-21T00:00:00.000Z', contextFingerprint: 'fp-test' };
  return {
    dealCardId: dossier.dealCardId,
    layers,
    layerPrompt: (layer, currentDossier, observations) => specialistLayerPrompt(layer, currentDossier, observations, context, envelope),
    dealPrompt: (freshLayers, currentDossier, observations) =>
      specialistDealPrompt(currentDossier, observations, context, envelope, { freshLayers, retainedProducts: {} }),
  };
}

interface RecordedCall { profile: string; args: string[]; startedInFlight: number }

function recordingInvoke(options: { failProfile?: string; delayMs?: number } = {}) {
  const calls: RecordedCall[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const invoke = async (args: string[]): Promise<string> => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const profile = profileOf(args);
    calls.push({ profile, args, startedInFlight: inFlight });
    await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 5));
    inFlight -= 1;
    if (profile === options.failProfile) return 'I could not produce a structured answer today.';
    if (profile === SPECIALIST_PROFILES.market && args[args.indexOf('-t') + 1] === 'search') {
      return 'This is a substantive free expert market review that connects the complete market evidence to intact and transformed product demand without being constrained by the output schema. '.repeat(3) + '\n\nSOURCE LEDGER\n- NONE';
    }
    return LAYER_REPLIES[profile] ?? '{}';
  };
  return { calls, invoke, maxInFlight: () => maxInFlight };
}

describe('specialist routing and ordering', () => {
  it('routes each layer to its own persistent profile, runs the specialists in parallel, and the Deal Brain chair only after they return', async () => {
    const dossier = dossierFor(FAIRVIEW);
    const recorder = recordingInvoke();
    const executor = createSpecialistIntelligenceExecutor({ invoke: recorder.invoke, settings: settings() });

    const run = await executor.run({ dossier, specialistPlan: planFor(dossier, ['property', 'market', 'seller', 'deal']) });

    const profiles = recorder.calls.map((call) => call.profile);
    expect(profiles.slice(0, 3).sort()).toEqual(['landos-market', 'landos-property', 'landos-seller']);
    // The chair is strictly last, and its prompt carries the FRESH products.
    expect(profiles[3]).toBe('landos-deal-brain');
    expect(promptOf(recorder.calls[3].args)).toContain('fresh this pass');
    expect(promptOf(recorder.calls[3].args)).toContain('Property read.');
    expect(promptOf(recorder.calls[3].args)).toContain('Market read.');
    // The three specialists genuinely overlapped.
    expect(recorder.maxInFlight()).toBeGreaterThanOrEqual(2);

    // The merged output satisfies the EXISTING layered contract unchanged.
    const layers = parseIntelligenceLayers(run.raw);
    expect(layers?.property?.read).toBe('Property read.');
    expect(layers?.market?.read).toBe('Market read.');
    expect(layers?.seller?.read).toBe('Seller read.');
    expect(layers?.dealExtras?.score).toBe(70);

    // Per-layer provenance names the producing profile.
    expect(run.layerRuntimes?.property?.agentProfile).toBe('landos-property');
    expect(run.layerRuntimes?.market?.agentProfile).toBe('landos-market');
    expect(run.layerRuntimes?.seller?.agentProfile).toBe('landos-seller');
    expect(run.layerRuntimes?.deal?.agentProfile).toBe('landos-deal-brain');
    expect(run.layerRuntimes?.property?.transport).toBe('hermes-cli-oneshot');
  });

  it('completes Property before Market free review, then extracts structure before handing the full review to Deal Brain', async () => {
    const dossier = dossierFor(FAIRVIEW);
    const context = passContext(dossier, ['property', 'market', 'deal']);
    const envelope = { dealCardId: 89, generatedAt: '2026-08-21T00:00:00.000Z', contextFingerprint: 'fp-test' };
    const plan: SpecialistExecutionPlan = {
      ...planFor(dossier, ['property', 'market', 'deal']),
      marketReviewPrompt: (property, currentDossier) => marketExpertReviewPrompt(currentDossier, property, context, envelope),
      marketExtractionPrompt: (property, review, currentDossier) => marketStructuredExtractionPrompt(currentDossier, property, review, context, envelope),
    };
    const recorder = recordingInvoke();
    const executor = createSpecialistIntelligenceExecutor({ invoke: recorder.invoke, settings: settings() });
    const run = await executor.run({ dossier, specialistPlan: plan });

    expect(recorder.calls.map((call) => `${call.profile}:${call.args[call.args.indexOf('-t') + 1]}`)).toEqual([
      'landos-property:clarify',
      'landos-market:search',
      'landos-market:clarify',
      'landos-deal-brain:clarify',
    ]);
    expect(promptOf(recorder.calls[1].args)).toContain('Property read.');
    expect(promptOf(recorder.calls[1].args)).toContain('Think freely within your market domain');
    expect(promptOf(recorder.calls[2].args)).toContain(run.marketExpertReview);
    expect(promptOf(recorder.calls[3].args)).toContain('"expertReview":"This is a substantive free expert market review');
    expect(promptOf(recorder.calls[3].args)).toContain('SOURCE LEDGER');
    expect(run.marketExpertReview).toContain('SOURCE LEDGER');
    expect(parseIntelligenceLayers(run.raw)?.market?.read).toBe('Market read.');
  });

  it('runs Property Stage A free review before Stage B extraction on clarify, preserves the prose verbatim, and hands it to Market and the chair', async () => {
    const dossier = dossierFor(FAIRVIEW);
    const context = passContext(dossier, ['property', 'market', 'deal']);
    const envelope = { dealCardId: 89, generatedAt: '2026-08-21T00:00:00.000Z', contextFingerprint: 'fp-test' };
    const plan: SpecialistExecutionPlan = {
      ...planFor(dossier, ['property', 'market', 'deal']),
      propertyReviewPrompt: (currentDossier, observations) => propertyExpertReviewPrompt(currentDossier, observations, context, envelope),
      propertyExtractionPrompt: (review, currentDossier, observations) => propertyStructuredExtractionPrompt(currentDossier, observations, review, context, envelope),
      marketReviewPrompt: (property, currentDossier) => marketExpertReviewPrompt(currentDossier, property, context, envelope),
      marketExtractionPrompt: (property, review, currentDossier) => marketStructuredExtractionPrompt(currentDossier, property, review, context, envelope),
    };
    const PROPERTY_REVIEW = 'This is a substantive free expert property review that understands how the land lays, where the usable ground sits, how frontage and terrain interact, and which configurations the physical and regulatory evidence actually supports. '.repeat(2);
    const calls: Array<{ profile: string; toolset: string; prompt: string }> = [];
    const invoke = async (args: string[]): Promise<string> => {
      const profile = profileOf(args);
      const prompt = promptOf(args);
      calls.push({ profile, toolset: args[args.indexOf('-t') + 1], prompt });
      if (profile === SPECIALIST_PROFILES.property) {
        return prompt.includes('STRUCTURED EXTRACTION') ? LAYER_REPLIES[profile] : PROPERTY_REVIEW;
      }
      if (profile === SPECIALIST_PROFILES.market && args[args.indexOf('-t') + 1] === 'search') {
        return 'A substantive free expert market review. '.repeat(10) + '\n\nSOURCE LEDGER\n- NONE';
      }
      return LAYER_REPLIES[profile] ?? '{}';
    };
    const executor = createSpecialistIntelligenceExecutor({ invoke, settings: settings() });
    const run = await executor.run({ dossier, specialistPlan: plan });

    const propertyCalls = calls.filter((call) => call.profile === SPECIALIST_PROFILES.property);
    expect(propertyCalls).toHaveLength(2);
    // Stage A is genuinely free-form (no schema demanded); Stage B extracts
    // over the exact verbatim review. Both stay on clarify — no search.
    expect(propertyCalls[0].toolset).toBe('clarify');
    expect(propertyCalls[0].prompt).toContain('Think freely within the Property domain');
    expect(propertyCalls[0].prompt).not.toContain('"property":{"score"');
    expect(propertyCalls[1].toolset).toBe('clarify');
    expect(propertyCalls[1].prompt).toContain(PROPERTY_REVIEW.trim());
    expect(run.propertyExpertReview).toBe(PROPERTY_REVIEW);
    // The fresh Property product (including the prose) reaches Market Stage A
    // and the Deal Brain chair.
    const marketStageA = calls.find((call) => call.profile === SPECIALIST_PROFILES.market && call.toolset === 'search')!;
    expect(marketStageA.prompt).toContain('substantive free expert property review');
    const chair = calls.find((call) => call.profile === SPECIALIST_PROFILES.deal)!;
    expect(chair.prompt).toContain('substantive free expert property review');
    expect(parseIntelligenceLayers(run.raw)?.property?.read).toBe('Property read.');
  });

  it('never invokes the seller profile when the plan excludes seller (deterministic pre-contact)', async () => {
    const dossier = dossierFor(FAIRVIEW);
    const recorder = recordingInvoke();
    const executor = createSpecialistIntelligenceExecutor({ invoke: recorder.invoke, settings: settings() });
    await executor.run({ dossier, specialistPlan: planFor(dossier, ['property', 'market', 'deal']) });
    expect(recorder.calls.map((call) => call.profile)).not.toContain('landos-seller');
  });

  it('answers the Deal Brain conversation (no plan) on landos-deal-brain', async () => {
    const dossier = dossierFor(FAIRVIEW);
    const recorder = recordingInvoke();
    const executor = createSpecialistIntelligenceExecutor({ invoke: recorder.invoke, settings: settings() });
    const run = await executor.run({ dossier, judgmentPromptBuilder: () => 'Operator question about the deal.' });
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0].profile).toBe('landos-deal-brain');
    expect(run.runtime.agentProfile).toBe('landos-deal-brain');
  });
});

describe('least-privilege transport', () => {
  it('every invocation is a profile-scoped one-shot with the clarify toolset only — no skills, no session thread', async () => {
    const dossier = dossierFor(FAIRVIEW);
    const recorder = recordingInvoke();
    const executor = createSpecialistIntelligenceExecutor({ invoke: recorder.invoke, settings: settings() });
    await executor.run({ dossier, specialistPlan: planFor(dossier, ['property', 'market', 'seller', 'deal']) });
    for (const call of recorder.calls) {
      expect(call.args).toContain('--oneshot');
      const toolset = call.args[call.args.indexOf('-t') + 1];
      expect(toolset).toBe('clarify');
      expect(call.args).not.toContain('--skills');
      expect(call.args).not.toContain('chat');
    }
  });

  it('grants adaptive web search only to Market Stage A and keeps Stage B and every other specialist on clarify', async () => {
    const dossier = dossierFor(FAIRVIEW);
    const context = passContext(dossier, ['property', 'market', 'deal']);
    const envelope = { dealCardId: 89, generatedAt: '2026-08-21T00:00:00.000Z', contextFingerprint: 'fp-test' };
    const plan: SpecialistExecutionPlan = {
      ...planFor(dossier, ['property', 'market', 'deal']),
      marketReviewPrompt: (property, currentDossier) => marketExpertReviewPrompt(currentDossier, property, context, envelope),
      marketExtractionPrompt: (property, review, currentDossier) => marketStructuredExtractionPrompt(currentDossier, property, review, context, envelope),
    };
    const recorder = recordingInvoke();
    await createSpecialistIntelligenceExecutor({ invoke: recorder.invoke, settings: settings() }).run({ dossier, specialistPlan: plan });
    const marketCalls = recorder.calls.filter((call) => call.profile === SPECIALIST_PROFILES.market);
    expect(marketCalls.map((call) => call.args[call.args.indexOf('-t') + 1])).toEqual(['search', 'clarify']);
    expect(recorder.calls.filter((call) => call.profile !== SPECIALIST_PROFILES.market)
      .every((call) => call.args[call.args.indexOf('-t') + 1] === 'clarify')).toBe(true);
  });

  it('builds the same argv shape standalone', () => {
    const args = specialistInvocationArgs({
      profile: 'landos-property',
      prompt: 'P',
      model: { provider: 'openai-codex', model: 'gpt-5.6-sol', source: 'default' },
    });
    expect(args).toEqual(['--profile', 'landos-property', '--provider', 'openai-codex', '-m', 'gpt-5.6-sol', '-t', 'clarify', '--oneshot', 'P']);
  });
});

describe('current deal context outranks profile memory', () => {
  it('every specialist prompt carries the authoritative CURRENT DEAL CONTEXT envelope with the current canonical facts', async () => {
    const dossier = dossierFor(FAIRVIEW);
    const recorder = recordingInvoke();
    const executor = createSpecialistIntelligenceExecutor({ invoke: recorder.invoke, settings: settings() });
    await executor.run({ dossier, specialistPlan: planFor(dossier, ['property', 'market', 'seller', 'deal']) });
    for (const call of recorder.calls) {
      const prompt = promptOf(call.args);
      expect(prompt).toContain('LANDOS CURRENT DEAL CONTEXT (AUTHORITATIVE)');
      expect(prompt).toContain('0 Kingwood Blvd, Fairview, TN 37062');
      expect(prompt).toContain('51.11');
      expect(prompt).toContain('this context wins');
      expect(prompt).toContain('deal facts belong to LandOS, not to your profile');
      expect(prompt).toContain('Evidence fingerprint: fp-test');
    }
  });

  it('bounds each specialist to its own dossier view: no comp universe for Property, no negotiation history either', () => {
    const dossier = dossierFor(FAIRVIEW);
    const context = passContext(dossier, ['property', 'market', 'seller', 'deal']);
    const envelope = { dealCardId: 89, generatedAt: 'now', contextFingerprint: 'fp' };
    const property = specialistLayerPrompt('property', dossier, [], context, envelope);
    const market = specialistLayerPrompt('market', dossier, [], context, envelope);
    const seller = specialistLayerPrompt('seller', dossier, [], context, envelope);

    expect(property).not.toContain('"valuation"');
    expect(property).not.toContain('"comps"');
    expect(property).toContain('sellerReportedPropertyStatements');
    expect(property).toContain('"physical"');

    expect(market).toContain('"valuation"');
    expect(market).toContain('"comps"');
    expect(market).toContain('"physical"');
    expect(market).toContain('"landUse"');
    expect(market).toContain('"subdivision"');
    expect(market).toContain('overallMarketQuality grades only the broader place');
    expect(market).toContain('subject-product liquidity grade');

    expect(seller).toContain('"seller"');
    expect(seller).not.toContain('"physical"');
    expect(seller).not.toContain('"valuation"');
  });
});

describe('cross-deal isolation with persistent identity', () => {
  it('the SAME profiles serve Deal A then Deal B, each run session-less and carrying only its own deal facts', async () => {
    const recorder = recordingInvoke();
    const executor = createSpecialistIntelligenceExecutor({ invoke: recorder.invoke, settings: settings() });

    const dealA = dossierFor(FAIRVIEW);
    await executor.run({ dossier: dealA, specialistPlan: planFor(dealA, ['property', 'deal']) });
    const dealB = dossierFor(OTHER_DEAL);
    await executor.run({ dossier: dealB, specialistPlan: planFor(dealB, ['property', 'deal']) });
    const backToA = dossierFor(FAIRVIEW);
    await executor.run({ dossier: backToA, specialistPlan: planFor(backToA, ['property', 'deal']) });

    const propertyCalls = recorder.calls.filter((call) => call.profile === 'landos-property');
    expect(propertyCalls).toHaveLength(3);
    // Persistent identity: the same specialist profile every time.
    expect(new Set(propertyCalls.map((call) => call.profile)).size).toBe(1);
    // Fresh deal context: Deal B's prompt carries ONLY Deal B facts...
    expect(promptOf(propertyCalls[1].args)).toContain('450 Cedar Hollow Ln');
    expect(promptOf(propertyCalls[1].args)).toContain('12.4');
    expect(promptOf(propertyCalls[1].args)).not.toContain('Kingwood');
    expect(promptOf(propertyCalls[1].args)).not.toContain('51.11');
    expect(promptOf(propertyCalls[1].args)).not.toContain('042-123.00-000');
    // ...and returning to Deal A rebuilds Deal A's current context.
    expect(promptOf(propertyCalls[2].args)).toContain('Kingwood');
    expect(promptOf(propertyCalls[2].args)).not.toContain('Cedar Hollow');
    // No session thread exists for facts to leak through.
    for (const call of recorder.calls) expect(call.args).toContain('--oneshot');
  });
});

describe('failure behavior', () => {
  it('a malformed specialist output fails the run, naming the profile — never a fabricated layer', async () => {
    const dossier = dossierFor(FAIRVIEW);
    const recorder = recordingInvoke({ failProfile: 'landos-market' });
    const executor = createSpecialistIntelligenceExecutor({ invoke: recorder.invoke, settings: settings() });
    await expect(
      executor.run({ dossier, specialistPlan: planFor(dossier, ['property', 'market', 'deal']) }),
    ).rejects.toThrow(/landos-market returned no parsable market layer/);
    // The chair never ran on a broken foundation.
    expect(recorder.calls.map((call) => call.profile)).not.toContain('landos-deal-brain');
  });
});

describe('governed rollback boundary', () => {
  it('defaults to the specialist executor and rolls back to the legacy analyst by setting, never a source edit', async () => {
    expect(resolveIntelligenceExecutor(settings())).toBe('specialists');
    expect(resolveIntelligenceExecutor(settings({ [INTELLIGENCE_EXECUTOR_KEY]: 'analyst' }))).toBe('analyst');

    const dossier = dossierFor(FAIRVIEW);
    const calls: string[][] = [];
    const invoke = async (args: string[]): Promise<string> => { calls.push(args); return LAYER_REPLIES[SPECIALIST_PROFILES.deal]; };
    const rollback = createIntelligenceExecutor({ invoke, settings: settings({ [INTELLIGENCE_EXECUTOR_KEY]: 'analyst' }) });
    await rollback.run({ dossier, judgmentPromptBuilder: () => 'combined pass', specialistPlan: planFor(dossier, ['deal']) });
    // The legacy analyst: ONE combined pass on the single analyst profile,
    // ignoring the specialist plan entirely.
    expect(calls).toHaveLength(1);
    expect(profileOf(calls[0])).toBe('landos-acquisition-analyst');
    expect(calls[0]).toContain('--skills');
  });

  it('reports the executor-aware runtime status', () => {
    const specialist = intelligenceExecutorRuntimeStatus(settings());
    expect(specialist.executor).toBe('specialists');
    expect(specialist.agentProfile).toBe('landos-deal-brain');
    const legacy = intelligenceExecutorRuntimeStatus(settings({ [INTELLIGENCE_EXECUTOR_KEY]: 'analyst' }));
    expect(legacy.executor).toBe('analyst');
    expect(legacy.agentProfile).toBe('landos-acquisition-analyst');
  });
});
