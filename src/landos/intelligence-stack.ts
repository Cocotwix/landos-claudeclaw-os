// LandOS — the Intelligence Stack orchestrator.
//
// One run produces the four intelligence products over one shared property
// file, using the existing pieces and nothing new: the Research Readiness
// Manifest as the deterministic preflight, the canonical acquisition dossier
// as the evidence package, the base quick-flip screen as the deterministic
// economics, and the Hermes Acquisition Analyst as the single reasoning
// executor in ONE coordinated pass.
//
// Efficiency is structural, not aspirational:
//
//   • Every layer carries a fingerprint of exactly the inputs that feed it.
//     A layer whose inputs have not moved is REUSED, not re-reasoned. When
//     only seller information changes, Property and Market are not re-run;
//     Seller and Deal are.
//   • The preflight backfills ONLY red, intelligence-critical, machine-owned
//     gaps, once, through the existing bounded backfill orchestrator. Yellow
//     never loops, green never reruns, gray is never touched.
//   • Pre-contact Seller Intelligence is deterministic — "Unknown" costs no
//     model call, and it never blocks a PRE-CALL deal read.

import { createHash } from 'node:crypto';

import { dossierFingerprint, type AcquisitionAnalyst, type AnalystRunOutput } from './acquisition-analyst.js';
import {
  buildAcquisitionDossier,
  type AcquisitionDossier,
  type PropertyFileSource,
} from './acquisition-intelligence-dossier.js';
import {
  normalizeAcquisitionIntelligence,
  readsAsNonObservation,
  type AcquisitionIntelligenceResult,
  type AcquisitionIntelligenceRuntime,
} from './acquisition-intelligence-contract.js';
import { propertyFileIsSufficient } from './acquisition-intelligence-capability.js';
import {
  readDerivedSnapshot,
  writeDerivedSnapshot,
} from './derived-intelligence-store.js';
import {
  computeQuickFlipScreen,
  evaluateSellerPrice,
  novationConsiderationGate,
  type QuickFlipScreenResult,
} from './quick-flip-screen.js';
import {
  DEAL_INTELLIGENCE_PRODUCT_TYPE,
  DEAL_PHASE_LABEL,
  INTELLIGENCE_STACK_VERSION,
  MARKET_INTELLIGENCE_PRODUCT_TYPE,
  PROPERTY_INTELLIGENCE_PRODUCT_TYPE,
  SELLER_INTELLIGENCE_PRODUCT_TYPE,
  dealLabelForScore,
  dealPhaseFor,
  intelligenceStackPrompt,
  parseIntelligenceLayers,
  qualityForScore,
  type DealIntelligenceProduct,
  type DealPhase,
  type IntelligenceLayerId,
  type MarketIntelligenceProduct,
  type PropertyIntelligenceProduct,
  type SellerIntelligenceProduct,
} from './intelligence-stack-contract.js';
import type { ResearchReadinessManifest } from './research-readiness.js';
import { activeOperatorGuidance } from './deal-brain-guidance.js';

export const INTELLIGENCE_STACK_ACTOR = 'intelligence-stack';

// ── Fingerprints: exactly the inputs each layer reasons over ──────────────

const hash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);

export function propertyLayerFingerprint(dossier: AcquisitionDossier): string {
  return hash({
    identity: dossier.identity,
    physical: dossier.physical,
    access: dossier.access,
    landUse: dossier.landUse,
    subdivision: dossier.subdivision,
    history: dossier.history,
    utilities: dossier.utilities,
    visuals: dossier.visuals.map((visual) => ({ key: visual.key, capturedAt: visual.capturedAt })),
    // A new grounded vision run is new property evidence: the layer re-reasons.
    visualObservations: dossier.visualObservations,
    // A new (or first) official assessor answer is new property evidence too —
    // this is what makes the bounded reconciliation re-read see it.
    officialAssessorRecord: dossier.officialAssessorRecord,
    conflicts: dossier.conflicts,
  });
}

export function marketLayerFingerprint(dossier: AcquisitionDossier): string {
  return hash({
    acres: dossier.identity.acres,
    valuation: dossier.valuation,
    comps: dossier.comps,
    market: dossier.market,
  });
}

export function sellerLayerFingerprint(dossier: AcquisitionDossier, sellerEstablished: boolean): string {
  return hash({ seller: dossier.seller, sellerEstablished });
}

// ── Run input/output ───────────────────────────────────────────────────────

export interface IntelligenceStackDeps {
  readPropertyFile: (dealCardId: number) => PropertyFileSource | null;
  analyst: AcquisitionAnalyst | null;
  /** The existing bounded readiness reconciler. Injected for tests. */
  reconcileReadiness: (dealCardId: number) => ResearchReadinessManifest | { error: string };
  /** The existing bounded backfill: red, machine-owned gaps, once each. The
   *  route wires the real orchestrator; nothing here invents a second one. */
  runBackfill?: (itemIds: string[]) => Promise<ResearchReadinessManifest | null>;
  readPipelineStage?: (dealCardId: number) => string | null;
  now?: () => Date;
}

export interface IntelligenceStackRunInput {
  dealCardId: number;
  /** Explicit layers to refresh; omitted means "whatever is stale". */
  layers?: IntelligenceLayerId[];
  /** Refresh every layer regardless of fingerprints. */
  force?: boolean;
  requestedProvider?: string | null;
  requestedModel?: string | null;
}

export interface IntelligenceStackProducts {
  property: PropertyIntelligenceProduct | null;
  market: MarketIntelligenceProduct | null;
  seller: SellerIntelligenceProduct | null;
  deal: DealIntelligenceProduct | null;
}

export interface IntelligenceStackRunResult {
  outcome: 'produced' | 'reused' | 'insufficient' | 'failed';
  reason: string | null;
  refreshedLayers: IntelligenceLayerId[];
  reusedLayers: IntelligenceLayerId[];
  backfilledItems: string[];
  products: IntelligenceStackProducts;
  quickFlip: QuickFlipScreenResult | null;
  phase: DealPhase | null;
  warnings: string[];
}

const isManifest = (value: ResearchReadinessManifest | { error: string }): value is ResearchReadinessManifest =>
  !('error' in value);

function readProducts(dealCardId: number): IntelligenceStackProducts {
  return {
    property: readDerivedSnapshot<PropertyIntelligenceProduct>(dealCardId, PROPERTY_INTELLIGENCE_PRODUCT_TYPE),
    market: readDerivedSnapshot<MarketIntelligenceProduct>(dealCardId, MARKET_INTELLIGENCE_PRODUCT_TYPE),
    seller: readDerivedSnapshot<SellerIntelligenceProduct>(dealCardId, SELLER_INTELLIGENCE_PRODUCT_TYPE),
    deal: readDerivedSnapshot<DealIntelligenceProduct>(dealCardId, DEAL_INTELLIGENCE_PRODUCT_TYPE),
  };
}

export interface IntelligenceStackState {
  products: IntelligenceStackProducts;
  /** Per-layer: has the layer's input moved since its current product? */
  stale: Record<IntelligenceLayerId, boolean>;
  quickFlip: QuickFlipScreenResult | null;
  phase: DealPhase | null;
  sellerEstablished: boolean;
  sufficiency: { ok: boolean; reason: string | null } | null;
  dossierFingerprint: string | null;
}

function operatorScores(source: PropertyFileSource | null): { property: number | null; market: number | null; seller: number | null } {
  const snapshot = (source?.propertyIntelligence as { snapshot?: { operatorAnalysis?: { scores?: Record<string, { score?: unknown }> } } } | null | undefined)?.snapshot;
  const scores = snapshot?.operatorAnalysis?.scores ?? {};
  const read = (key: string): number | null => {
    const value = scores?.[key]?.score;
    return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
  };
  return { property: read('property'), market: read('market'), seller: read('seller') };
}

function sellerEstablishedFrom(manifest: ResearchReadinessManifest | null, dossier: AcquisitionDossier): boolean {
  // A real communication record IS seller contact: once the deal carries
  // persisted communications or discovery extractions, the seller lane reasons
  // over them regardless of what the readiness checklist has caught up to.
  if (dossier.seller.communications.length > 0 || dossier.seller.discovery.length > 0) return true;
  const item = manifest?.items.find((candidate) => candidate.id === 'seller_information');
  if (item) return item.status === 'green' || item.status === 'blue';
  return dossier.seller.present && dossier.seller.askingPrice != null;
}

function quickFlipFrom(dossier: AcquisitionDossier): QuickFlipScreenResult {
  return computeQuickFlipScreen({
    supportedFmv: dossier.valuation.fairMarketValue,
    fmvBasis: dossier.valuation.basis,
    acceptedCompCount: dossier.valuation.acceptedCompCount,
    expectedResaleDays: dossier.market.medianDaysOnMarket,
  });
}

/** Everything a SELECT can answer about the stack — no model, no research. */
export function readIntelligenceStackState(
  dealCardId: number,
  deps: Pick<IntelligenceStackDeps, 'readPropertyFile' | 'reconcileReadiness' | 'readPipelineStage'>,
): IntelligenceStackState {
  const products = readProducts(dealCardId);
  const source = deps.readPropertyFile(dealCardId);
  if (!source) {
    return {
      products,
      stale: { property: false, market: false, seller: false, deal: false },
      quickFlip: null,
      phase: null,
      sellerEstablished: false,
      sufficiency: null,
      dossierFingerprint: null,
    };
  }
  const dossier = buildAcquisitionDossier(source);
  const manifestOrError = deps.reconcileReadiness(dealCardId);
  const manifest = isManifest(manifestOrError) ? manifestOrError : null;
  const sellerEstablished = sellerEstablishedFrom(manifest, dossier);
  const fingerprints = {
    property: propertyLayerFingerprint(dossier),
    market: marketLayerFingerprint(dossier),
    seller: sellerLayerFingerprint(dossier, sellerEstablished),
  };
  const quickFlip = quickFlipFrom(dossier);
  const phase = dealPhaseFor({
    pipelineStage: deps.readPipelineStage?.(dealCardId) ?? null,
    sellerEstablished,
    sellerPriceKnown: dossier.seller.askingPrice != null,
  });
  const dealFingerprint = dealLayerFingerprint(fingerprints, quickFlip, phase, dealCardId);
  return {
    products,
    stale: {
      property: !products.property || products.property.layerFingerprint !== fingerprints.property,
      market: !products.market || products.market.layerFingerprint !== fingerprints.market,
      seller: !products.seller || products.seller.layerFingerprint !== fingerprints.seller,
      deal: !products.deal || products.deal.layerFingerprints?.deal !== dealFingerprint,
    },
    quickFlip,
    phase,
    sellerEstablished,
    sufficiency: propertyFileIsSufficient(dossier),
    dossierFingerprint: dossierFingerprint(dossier),
  };
}

function dealLayerFingerprint(
  fingerprints: { property: string; market: string; seller: string },
  quickFlip: QuickFlipScreenResult,
  phase: DealPhase,
  dealCardId: number,
): string {
  return hash({
    fingerprints,
    quickFlip: { status: quickFlip.status, cashMao: quickFlip.economics?.cashMao ?? null, fmv: quickFlip.economics?.supportedFmv ?? null },
    phase,
    guidance: activeOperatorGuidance(dealCardId),
  });
}

const DETERMINISTIC_RUNTIME: AcquisitionIntelligenceRuntime = {
  engine: 'landos',
  agentProfile: 'landos-deterministic',
  provider: 'landos',
  model: 'deterministic',
  modelSource: 'default',
  durationMs: 0,
};

function preContactSellerProduct(input: {
  dealCardId: number;
  layerFingerprint: string;
  dossierFp: string;
  generatedAt: string;
}): SellerIntelligenceProduct {
  return {
    contractVersion: INTELLIGENCE_STACK_VERSION,
    dealCardId: input.dealCardId,
    generatedAt: input.generatedAt,
    runtime: DETERMINISTIC_RUNTIME,
    layerFingerprint: input.layerFingerprint,
    dossierFingerprint: input.dossierFp,
    state: 'pre_contact',
    score: null,
    read: 'Unknown — pre-contact. No seller communication has been recorded for this deal yet, and motivation is never fabricated from ownership records.',
    motivation: null,
    priceExpectation: null,
    timeline: null,
    decisionMakers: null,
    objections: [],
    negotiationPosture: null,
    bestApproach: null,
    sellerReportedFacts: [],
    followUps: [],
    contradictions: [],
    unknowns: [],
    nextQuestion: null,
  };
}

// ── What changed since the last read ───────────────────────────────────────

function describeChanges(input: {
  prior: DealIntelligenceProduct | null;
  refreshed: IntelligenceLayerId[];
  quickFlip: QuickFlipScreenResult;
  phase: DealPhase;
  dossier: AcquisitionDossier;
  guidance: string[];
}): string[] {
  const { prior } = input;
  if (!prior || !prior.layerFingerprints) return ['First Deal Intelligence read for this card.'];
  const changes: string[] = [];
  const priorFlip = prior.quickFlip ?? null;
  if (priorFlip && priorFlip.status !== input.quickFlip.status) {
    changes.push(`Quick-flip status moved from ${priorFlip.statusLabel} to ${input.quickFlip.statusLabel}.`);
  }
  const priorFmv = priorFlip?.economics?.supportedFmv ?? null;
  const fmv = input.quickFlip.economics?.supportedFmv ?? null;
  if (priorFmv !== fmv) {
    changes.push(fmv != null
      ? `Supported FMV is now $${fmv.toLocaleString('en-US')}${priorFmv != null ? ` (was $${priorFmv.toLocaleString('en-US')})` : ' (was not established)'}.`
      : 'The previously supported FMV is no longer established.');
  }
  if (prior.phase !== input.phase) changes.push(`Phase moved from ${DEAL_PHASE_LABEL[prior.phase]} to ${DEAL_PHASE_LABEL[input.phase]}.`);
  const priorAsking = prior.quickFlip ? prior.sellerPriceVerdict?.sellerPriceUsd ?? null : null;
  const asking = input.dossier.seller.askingPrice;
  if (priorAsking == null && asking != null) changes.push(`A seller price of $${asking.toLocaleString('en-US')} was added.`);
  const priorGuidance = prior.guidanceConsidered ?? [];
  const newGuidance = input.guidance.filter((item) => !priorGuidance.includes(item));
  if (newGuidance.length) changes.push(`Operator guidance added: ${newGuidance.map((item) => `"${item.slice(0, 80)}"`).join('; ')}.`);
  for (const layer of input.refreshed) {
    if (layer === 'deal') continue;
    changes.push(`${layer[0].toUpperCase()}${layer.slice(1)} Intelligence was refreshed on new evidence.`);
  }
  return changes.length ? changes : ['Re-read over the same evidence.'];
}

// ── The run ────────────────────────────────────────────────────────────────

export async function runIntelligenceStack(
  input: IntelligenceStackRunInput,
  deps: IntelligenceStackDeps,
): Promise<IntelligenceStackRunResult> {
  const now = deps.now ?? (() => new Date());
  const warnings: string[] = [];
  const failed = (reason: string, outcome: 'insufficient' | 'failed' = 'failed'): IntelligenceStackRunResult => ({
    outcome,
    reason,
    refreshedLayers: [],
    reusedLayers: [],
    backfilledItems: [],
    products: readProducts(input.dealCardId),
    quickFlip: null,
    phase: null,
    warnings,
  });

  // 1. Preflight — the manifest is the deterministic checklist. Only red,
  //    intelligence-critical, machine-owned gaps are backfilled, once each,
  //    through the existing bounded orchestrator. Yellow stays yellow.
  let manifest: ResearchReadinessManifest | null = null;
  const manifestOrError = deps.reconcileReadiness(input.dealCardId);
  const backfilledItems: string[] = [];
  if (isManifest(manifestOrError)) {
    manifest = manifestOrError;
    const criticalGaps = manifest.items
      .filter((item) => item.status === 'red' && item.machineBackfillAllowed && item.blocksIntelligence)
      .map((item) => item.id);
    if (criticalGaps.length && deps.runBackfill) {
      try {
        const after = await deps.runBackfill(criticalGaps);
        if (after) manifest = after;
        backfilledItems.push(...criticalGaps);
      } catch (error) {
        warnings.push(`Readiness backfill did not complete: ${error instanceof Error ? error.message : String(error)}. Intelligence proceeds on the retained file.`);
      }
    }
  } else {
    warnings.push(`Research readiness could not be reconciled: ${manifestOrError.error}. Intelligence proceeds on the retained file.`);
  }

  // 2. The shared evidence package.
  const source = deps.readPropertyFile(input.dealCardId);
  if (!source) return failed('No canonical property file is available for this Deal Card.', 'insufficient');
  const dossier = buildAcquisitionDossier({ ...source, dealCardId: input.dealCardId, now: deps.now });
  const sufficiency = propertyFileIsSufficient(dossier);
  if (!sufficiency.ok) return failed(sufficiency.reason ?? 'The property file is not sufficient for an intelligence read.', 'insufficient');
  const dossierFp = dossierFingerprint(dossier);

  // 3. Deterministic layer: economics, phase, seller state, fingerprints.
  const sellerEstablished = sellerEstablishedFrom(manifest, dossier);
  const quickFlip = quickFlipFrom(dossier);
  const sellerPriceVerdict = evaluateSellerPrice(quickFlip, dossier.seller.askingPrice);
  const canonicalScores = operatorScores(source);
  const phase = dealPhaseFor({
    pipelineStage: deps.readPipelineStage?.(input.dealCardId) ?? null,
    sellerEstablished,
    sellerPriceKnown: dossier.seller.askingPrice != null,
  });
  const fingerprints = {
    property: propertyLayerFingerprint(dossier),
    market: marketLayerFingerprint(dossier),
    seller: sellerLayerFingerprint(dossier, sellerEstablished),
  };
  const guidance = activeOperatorGuidance(input.dealCardId);
  const dealFp = dealLayerFingerprint(fingerprints, quickFlip, phase, input.dealCardId);

  // 4. Dependency-aware refresh: a layer runs only when its inputs moved,
  //    it was explicitly requested, or it has never been produced.
  const retained = readProducts(input.dealCardId);
  const requested = new Set(input.layers ?? []);
  const wants = (layer: IntelligenceLayerId, stale: boolean): boolean =>
    input.force === true || requested.has(layer) || (requested.size === 0 && stale);
  const refreshProperty = wants('property', !retained.property || retained.property.layerFingerprint !== fingerprints.property);
  const refreshMarket = wants('market', !retained.market || retained.market.layerFingerprint !== fingerprints.market);
  const sellerStale = !retained.seller
    || retained.seller.layerFingerprint !== fingerprints.seller
    || (sellerEstablished && retained.seller.state === 'pre_contact');
  const refreshSeller = wants('seller', sellerStale);
  // The Deal read depends on every other layer, the calculation and guidance:
  // it refreshes whenever any of them does, or its own inputs moved.
  const refreshDeal = refreshProperty || refreshMarket || refreshSeller
    || wants('deal', !retained.deal || retained.deal.layerFingerprints?.deal !== dealFp);

  const refreshedLayers: IntelligenceLayerId[] = [
    ...(refreshProperty ? ['property' as const] : []),
    ...(refreshMarket ? ['market' as const] : []),
    ...(refreshSeller ? ['seller' as const] : []),
    ...(refreshDeal ? ['deal' as const] : []),
  ];
  const reusedLayers = (['property', 'market', 'seller', 'deal'] as const).filter((layer) => !refreshedLayers.includes(layer));

  if (!refreshedLayers.length) {
    return {
      outcome: 'reused',
      reason: 'Every intelligence layer is current for the retained evidence — nothing was re-reasoned.',
      refreshedLayers,
      reusedLayers: [...reusedLayers],
      backfilledItems,
      products: retained,
      quickFlip,
      phase,
      warnings,
    };
  }

  // 5. The seller layer pre-contact is deterministic — honest and free.
  const generatedAt = now().toISOString();
  let sellerProduct = retained.seller;
  if (refreshSeller && !sellerEstablished) {
    sellerProduct = preContactSellerProduct({
      dealCardId: input.dealCardId,
      layerFingerprint: fingerprints.seller,
      dossierFp,
      generatedAt,
    });
  }

  // 6. One coordinated reasoning pass for whatever model layers remain.
  const modelLayers: IntelligenceLayerId[] = [
    ...(refreshProperty ? ['property' as const] : []),
    ...(refreshMarket ? ['market' as const] : []),
    ...(refreshSeller && sellerEstablished ? ['seller' as const] : []),
    ...(refreshDeal ? ['deal' as const] : []),
  ];

  let run: AnalystRunOutput | null = null;
  if (modelLayers.length) {
    if (!deps.analyst) return failed('The Acquisition Analyst is not available in this runtime.');
    try {
      run = await deps.analyst.run({
        dossier,
        requestedProvider: input.requestedProvider ?? null,
        requestedModel: input.requestedModel ?? null,
        judgmentPromptBuilder: (currentDossier, observations) => intelligenceStackPrompt(currentDossier, observations, {
          layers: modelLayers,
          phase,
          quickFlip,
          sellerPriceVerdict,
          canonicalScores,
          sellerEstablished,
          guidance,
          readinessHeadline: manifest?.headline ?? null,
          knownUnresolved: manifest
            ? manifest.items.filter((item) => item.status === 'yellow').map((item) => item.label)
            : [],
          retainedReads: {
            ...(refreshProperty || !retained.property ? {} : { property: retained.property.read }),
            ...(refreshMarket || !retained.market ? {} : { market: retained.market.read }),
            ...(refreshSeller || !retained.seller ? {} : { seller: retained.seller.read }),
          },
        }),
      });
    } catch (error) {
      return failed(`The Acquisition Analyst could not complete this read: ${error instanceof Error ? error.message.split(/\r?\n/, 1)[0] : String(error)}`);
    }
    warnings.push(...run.warnings);
  }

  const layers = run ? parseIntelligenceLayers(run.raw) : null;
  if (run && !layers) return failed('The analyst returned no parsable layered JSON result.');

  const runtime = run?.runtime ?? DETERMINISTIC_RUNTIME;
  const observations = run?.observations ?? [];
  // Retained observations are re-screened on every reuse: an earlier run may
  // have persisted refusal chatter under an older, narrower filter, and a
  // fallback must never resurrect it onto an operator surface.
  const usableObservations = (
    items: Array<{ visual: string; observation: string; basis: string | null }> | undefined,
  ) => (items ?? []).filter((item) => !readsAsNonObservation(item.observation));
  const priorVisualObservations = usableObservations(
    retained.property?.visualObservations ?? retained.deal?.visualObservations,
  );

  // 7. Build and persist each refreshed product.
  // Model-detected visual/record conflicts, rendered in the carried triple
  // shape. Composed from the structured fields so the operator sees the record
  // claim, the grounded observation, the plausible reading and the ONE bounded
  // check — and folded into the deal layer's floor so the "Conflicting
  // evidence" surface shows them even if the deal layer's own JSON omits them.
  const propertyVisualConflicts = (layers?.property?.conflicts ?? []).map((conflict) => ({
    subject: conflict.subject,
    statement: [
      conflict.recordClaim ? `Record claim: ${conflict.recordClaim}` : null,
      conflict.groundedVisual ? `Grounded visual observation: ${conflict.groundedVisual}` : null,
    ].filter(Boolean).join(' — '),
    resolution: [
      conflict.interpretation,
      conflict.recommendedVerification ? `Recommended verification: ${conflict.recommendedVerification}` : null,
    ].filter(Boolean).join(' ') || 'Unresolved.',
  }));

  let propertyProduct = retained.property;
  if (refreshProperty) {
    if (!layers?.property) return failed('The analyst response carried no property layer.');
    const score = canonicalScores.property ?? layers.property.score;
    propertyProduct = {
      contractVersion: INTELLIGENCE_STACK_VERSION,
      dealCardId: input.dealCardId,
      generatedAt,
      runtime,
      layerFingerprint: fingerprints.property,
      dossierFingerprint: dossierFp,
      score,
      quality: qualityForScore(score),
      scoreSource: canonicalScores.property != null ? 'canonical' : layers.property.score != null ? 'analyst' : 'none',
      read: layers.property.read ?? 'The analyst returned no property read.',
      strengths: layers.property.strengths,
      constraints: layers.property.constraints,
      potential: layers.property.potential,
      conflicts: [
        ...dossier.conflicts.map((conflict) => ({
          subject: conflict.subject,
          statement: conflict.statement,
          resolution: conflict.resolution === 'resolved' ? conflict.reason : `Unresolved. ${conflict.reason}`.trim(),
        })),
        ...propertyVisualConflicts,
      ],
      unknowns: layers.property.unknowns,
      nextActions: layers.property.nextActions,
      visualObservations: observations.length
        ? observations.map((observation) => ({ visual: observation.visual, observation: observation.observation, basis: observation.basis }))
        : priorVisualObservations,
    };
    writeDerivedSnapshot({
      dealCardId: input.dealCardId,
      snapshotType: PROPERTY_INTELLIGENCE_PRODUCT_TYPE,
      payload: propertyProduct,
      completeness: { strengths: propertyProduct.strengths.length, constraints: propertyProduct.constraints.length, unknowns: propertyProduct.unknowns.length },
      changeReason: `Property Intelligence read by ${runtime.agentProfile} on ${runtime.model}.`,
      actor: INTELLIGENCE_STACK_ACTOR,
      auditEvent: 'property_intelligence_read',
    });
  }

  let marketProduct = retained.market;
  if (refreshMarket) {
    if (!layers?.market) return failed('The analyst response carried no market layer.');
    const score = canonicalScores.market ?? layers.market.score;
    marketProduct = {
      contractVersion: INTELLIGENCE_STACK_VERSION,
      dealCardId: input.dealCardId,
      generatedAt,
      runtime,
      layerFingerprint: fingerprints.market,
      dossierFingerprint: dossierFp,
      score,
      quality: qualityForScore(score),
      scoreSource: canonicalScores.market != null ? 'canonical' : layers.market.score != null ? 'analyst' : 'none',
      read: layers.market.read ?? 'The analyst returned no market read.',
      liquidityRead: layers.market.liquidityRead,
      areaStory: layers.market.areaStory,
      buyerPool: layers.market.buyerPool,
      bestSignals: layers.market.bestSignals,
      risks: layers.market.risks,
      exitImplications: layers.market.exitImplications,
      unknowns: layers.market.unknowns,
      subjectBand: {
        band: dossier.market.acreageBand,
        medianDaysOnMarket: dossier.market.medianDaysOnMarket,
        sellThroughRate: dossier.market.sellThroughRate,
        monthsOfSupply: dossier.market.monthsOfSupply,
        medianPricePerAcre: dossier.market.medianPricePerAcre,
      },
      fastestBand: dossier.market.fastestBand,
    };
    writeDerivedSnapshot({
      dealCardId: input.dealCardId,
      snapshotType: MARKET_INTELLIGENCE_PRODUCT_TYPE,
      payload: marketProduct,
      completeness: { signals: marketProduct.bestSignals.length, risks: marketProduct.risks.length, unknowns: marketProduct.unknowns.length },
      changeReason: `Market Intelligence read by ${runtime.agentProfile} on ${runtime.model}.`,
      actor: INTELLIGENCE_STACK_ACTOR,
      auditEvent: 'market_intelligence_read',
    });
  }

  if (refreshSeller && sellerEstablished) {
    if (!layers?.seller) return failed('The analyst response carried no seller layer.');
    sellerProduct = {
      contractVersion: INTELLIGENCE_STACK_VERSION,
      dealCardId: input.dealCardId,
      generatedAt,
      runtime,
      layerFingerprint: fingerprints.seller,
      dossierFingerprint: dossierFp,
      state: 'established',
      score: layers.seller.score,
      read: layers.seller.read ?? 'The analyst returned no seller read.',
      motivation: layers.seller.motivation,
      priceExpectation: layers.seller.priceExpectation,
      timeline: layers.seller.timeline,
      decisionMakers: layers.seller.decisionMakers,
      objections: layers.seller.objections,
      negotiationPosture: layers.seller.negotiationPosture,
      bestApproach: layers.seller.bestApproach,
      sellerReportedFacts: layers.seller.sellerReportedFacts,
      followUps: layers.seller.followUps,
      contradictions: layers.seller.contradictions,
      unknowns: layers.seller.unknowns,
      nextQuestion: layers.seller.nextQuestion,
    };
  }
  if (refreshSeller && sellerProduct) {
    writeDerivedSnapshot({
      dealCardId: input.dealCardId,
      snapshotType: SELLER_INTELLIGENCE_PRODUCT_TYPE,
      payload: sellerProduct,
      completeness: { state: sellerProduct.state, reportedFacts: sellerProduct.sellerReportedFacts.length },
      changeReason: sellerProduct.state === 'pre_contact'
        ? 'Seller Intelligence recorded as pre-contact: honestly unknown.'
        : `Seller Intelligence read by ${runtime.agentProfile} on ${runtime.model}.`,
      actor: INTELLIGENCE_STACK_ACTOR,
      auditEvent: 'seller_intelligence_read',
    });
  }

  let dealProduct = retained.deal;
  if (refreshDeal) {
    if (!layers?.dealRaw || !layers.dealExtras) return failed('The analyst response carried no deal layer.');
    const normalized = normalizeAcquisitionIntelligence({
      raw: layers.dealRaw,
      dealCardId: input.dealCardId,
      runtime,
      dossierFingerprint: dossierFp,
      allowedVisualKeys: [...new Set([
        ...dossier.visuals.map((visual) => visual.key),
        ...dossier.visualObservations.map((observation) => observation.key),
      ])],
      landosConflicts: [
        ...dossier.conflicts.map((conflict) => ({
          subject: conflict.subject,
          statement: conflict.statement,
          resolution: conflict.resolution === 'resolved' ? conflict.reason : `Unresolved. ${conflict.reason} ${conflict.decisionAtRisk}`.trim(),
        })),
        ...propertyVisualConflicts,
      ],
      coveragePresent: dossier.coverage.present,
      coverageAbsent: dossier.coverage.absent,
      now: deps.now,
    });
    if (!normalized.ok) return failed(normalized.reason);

    const base: AcquisitionIntelligenceResult = {
      ...normalized.result,
      // Every fallback path is re-screened: a retained product persisted under
      // an older filter may itself carry chatter.
      visualObservations: normalized.result.visualObservations.length
        ? normalized.result.visualObservations
        : usableObservations(propertyProduct?.visualObservations ?? priorVisualObservations),
      warnings: [...normalized.result.warnings],
    };
    const dealScore = layers.dealExtras.score;
    if (dealScore == null) warnings.push('The analyst returned no Deal Score; the read is shown without one.');

    const whatChanged = describeChanges({
      prior: retained.deal,
      refreshed: refreshedLayers,
      quickFlip,
      phase,
      dossier,
      guidance,
    });

    dealProduct = {
      ...base,
      intelligenceVersion: INTELLIGENCE_STACK_VERSION,
      phase,
      scores: {
        property: {
          score: propertyProduct?.score ?? canonicalScores.property,
          quality: propertyProduct?.quality ?? qualityForScore(canonicalScores.property),
          source: propertyProduct?.scoreSource ?? (canonicalScores.property != null ? 'canonical' : 'none'),
        },
        market: {
          score: marketProduct?.score ?? canonicalScores.market,
          quality: marketProduct?.quality ?? qualityForScore(canonicalScores.market),
          source: marketProduct?.scoreSource ?? (canonicalScores.market != null ? 'canonical' : 'none'),
        },
        seller: {
          score: sellerProduct?.score ?? null,
          state: sellerProduct?.state ?? (sellerEstablished ? 'established' : 'pre_contact'),
        },
        deal: { score: dealScore, label: dealLabelForScore(dealScore) },
      },
      reads: {
        property: layers.dealExtras.reads.property ?? propertyProduct?.read ?? null,
        market: layers.dealExtras.reads.market ?? marketProduct?.read ?? null,
        seller: layers.dealExtras.reads.seller ?? sellerProduct?.read ?? null,
      },
      quickFlip,
      sellerPriceVerdict,
      novationGate: novationConsiderationGate({
        cashVerdict: sellerPriceVerdict.verdict,
        sellerIntelligenceEstablished: sellerEstablished,
        propertyScore: propertyProduct?.score ?? canonicalScores.property,
        marketScore: marketProduct?.score ?? canonicalScores.market,
      }),
      bestStrategy: layers.dealExtras.bestStrategy
        ?? (base.strategies[0] ? { strategy: base.strategies[0].strategy, why: base.strategies[0].whyItFits } : null),
      additionalUpside: layers.dealExtras.additionalUpside,
      discoveryCallObjective: layers.dealExtras.discoveryCallObjective,
      negotiationPosture: layers.dealExtras.negotiationPosture,
      guidanceConsidered: guidance,
      whatChanged,
      layerFingerprints: { ...fingerprints, deal: dealFp },
    };
    writeDerivedSnapshot({
      dealCardId: input.dealCardId,
      snapshotType: DEAL_INTELLIGENCE_PRODUCT_TYPE,
      payload: dealProduct,
      completeness: {
        strategies: dealProduct.strategies.length,
        conflicts: dealProduct.conflicts.length,
        unknowns: dealProduct.unknowns.length,
        quickFlipStatus: quickFlip.status,
        phase,
      },
      changeReason: whatChanged.join(' ').slice(0, 600) || `Deal Intelligence read by ${runtime.agentProfile} on ${runtime.model}.`,
      actor: INTELLIGENCE_STACK_ACTOR,
      auditEvent: 'deal_intelligence_read',
    });
  }

  return {
    outcome: 'produced',
    reason: null,
    refreshedLayers,
    reusedLayers: [...reusedLayers],
    backfilledItems,
    products: {
      property: propertyProduct,
      market: marketProduct,
      seller: sellerProduct,
      deal: dealProduct,
    },
    quickFlip,
    phase,
    warnings,
  };
}
