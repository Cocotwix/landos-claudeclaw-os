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
  appendDerivedEvidence,
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
  dealPhaseFor,
  intelligenceStackPrompt,
  marketExpertReviewPrompt,
  marketStructuredExtractionPrompt,
  propertyExpertReviewPrompt,
  sellerExpertReviewPrompt,
  sellerStructuredExtractionPrompt,
  propertyStructuredExtractionPrompt,
  parseIntelligenceLayers,
  qualityForScore,
  specialistDealPrompt,
  specialistLayerPrompt,
  type DealIntelligenceProduct,
  type DealPhase,
  type IntelligenceLayerId,
  type MarketIntelligenceProduct,
  type MarketWebEvidence,
  type PropertyIntelligenceProduct,
  type SellerIntelligenceProduct,
} from './intelligence-stack-contract.js';
import type { ResearchReadinessManifest } from './research-readiness.js';
import { activeOperatorGuidance } from './deal-brain-guidance.js';
import { readPropertyCompiledKnowledge } from './property-compiled-knowledge.js';
import {
  outlookComparisonPrompt,
  parseOutlookVerdict,
  resolveOutlook,
  type IntelligenceOutlook,
} from './intelligence-outlook.js';

export const INTELLIGENCE_STACK_ACTOR = 'intelligence-stack';

/**
 * Seller outlook, mapped from the Seller layer's OWN existing change record.
 *
 * No new model call and no new Seller architecture: a first established read is
 * INITIAL, a read the specialist itself reports material changes for is
 * UPDATED, and a re-reasoned read with no material change is UNCHANGED. Age is
 * not an input; a pre-contact deal never reaches here at all.
 */
export function sellerOutlookFrom(
  prior: { outlook?: IntelligenceOutlook | null; version?: number } | null | undefined,
  layer: {
    sellerTrajectory?: string | null;
    materialChanges?: Array<{ dimension?: string; direction?: string | null }>;
  },
  now: () => Date = () => new Date(),
): IntelligenceOutlook {
  const priorVersion = prior?.outlook?.readVersion ?? prior?.version ?? 0;
  if (!priorVersion) {
    return { status: 'INITIAL', readVersion: 1, previousReadVersion: null, changedAt: null, changeSummary: null, changeDrivers: [] };
  }
  const changes = (layer.materialChanges ?? []).filter((change) => {
    const direction = (change.direction ?? '').toLowerCase();
    return !!change.dimension && direction !== 'stable' && direction !== 'unclear';
  });
  if (!changes.length) {
    return {
      status: 'UNCHANGED',
      readVersion: priorVersion + 1,
      previousReadVersion: priorVersion,
      changedAt: prior?.outlook?.changedAt ?? null,
      changeSummary: null,
      changeDrivers: [],
    };
  }
  return {
    status: 'UPDATED',
    readVersion: priorVersion + 1,
    previousReadVersion: priorVersion,
    changedAt: now().toISOString(),
    changeSummary: layer.sellerTrajectory ?? null,
    changeDrivers: changes.map((change) => change.dimension as string).slice(0, 6),
  };
}

// ── Fingerprints: exactly the inputs each layer reasons over ──────────────

const hash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);

export function propertyLayerFingerprint(dossier: AcquisitionDossier): string {
  return hash({
    identity: dossier.identity,
    // The canonical acreage/extent DECISION is property evidence: an adoption
    // must move this fingerprint. The dependent-product resolution bookkeeping
    // (staleProducts / dependentResolution) is deliberately excluded — it
    // records that downstream products caught up, which is not new property
    // evidence, and hashing it would make each resolver pass re-invalidate
    // the layer it just reconciled.
    acreage: dossier.acreage == null ? null : {
      canonicalAcres: dossier.acreage.canonicalAcres,
      source: dossier.acreage.source,
      confidence: dossier.acreage.confidence,
      parcelExtent: dossier.acreage.parcelExtent,
      extentExplanation: dossier.acreage.extentExplanation,
      retainedFigures: dossier.acreage.retainedFigures,
    },
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

export function marketLayerInputFingerprint(
  dossier: AcquisitionDossier,
  propertyFingerprint: string | null = null,
  propertyProduct: PropertyIntelligenceProduct | null = null,
): string {
  return hash({
    identity: dossier.identity,
    acreage: dossier.acreage,
    physical: dossier.physical,
    access: dossier.access,
    landUse: dossier.landUse,
    subdivision: dossier.subdivision,
    utilities: dossier.utilities,
    history: dossier.history,
    valuation: dossier.valuation,
    comps: dossier.comps,
    market: dossier.market,
    coverage: dossier.coverage,
    propertyFingerprint,
    propertyProduct: propertyProduct == null ? null : {
      score: propertyProduct.score,
      quality: propertyProduct.quality,
      read: propertyProduct.read,
      strengths: propertyProduct.strengths,
      constraints: propertyProduct.constraints,
      potential: propertyProduct.potential,
      unusual: propertyProduct.unusual,
      externalities: propertyProduct.externalities,
      developmentPotential: propertyProduct.developmentPotential,
      conflicts: propertyProduct.conflicts,
      unknowns: propertyProduct.unknowns,
      nextActions: propertyProduct.nextActions,
      // The Stage A prose and plausible configurations are Market inputs too:
      // Market's Stage A consumes the full Property product projection, so a
      // materially new Property expert read must invalidate the Market read.
      // Spread-when-present keeps pre-upgrade products hashing identically —
      // adding these fields must not flag every existing Market read stale.
      ...((propertyProduct as Partial<PropertyIntelligenceProduct>).configurations !== undefined
        ? { configurations: (propertyProduct as Partial<PropertyIntelligenceProduct>).configurations }
        : {}),
      ...((propertyProduct as Partial<PropertyIntelligenceProduct>).expertReview !== undefined
        ? { expertReview: (propertyProduct as Partial<PropertyIntelligenceProduct>).expertReview }
        : {}),
    },
  });
}

export function marketLayerFingerprint(
  dossier: AcquisitionDossier,
  propertyFingerprint: string | null = null,
  webEvidence: readonly MarketWebEvidence[] = [],
  propertyProduct: PropertyIntelligenceProduct | null = null,
): string {
  return hash({
    inputFingerprint: marketLayerInputFingerprint(dossier, propertyFingerprint, propertyProduct),
    webEvidence,
  });
}

export function sellerLayerFingerprint(dossier: AcquisitionDossier, sellerEstablished: boolean, phase: DealPhase): string {
  // Material inputs only: the persisted seller evidence record (profile,
  // communications, discovery, seller-reported facts, asking price, people),
  // whether contact is established, and the material lifecycle phase. No
  // read-time timestamps — a meaningful new seller event invalidates the
  // current read; rendering it never does.
  return hash({ seller: dossier.seller, sellerEstablished, phase });
}

/**
 * Is the retained Seller product still a truthful current read?
 *
 * Normally that is fingerprint equality. The one semantic exception is the
 * deterministic PRE-CONTACT product: it asserts exactly one thing — that no
 * meaningful seller communication has been recorded yet — and every field it
 * carries is null/empty except `phase`. Its truth therefore depends on the
 * material seller state, not on the internal shape of `dossier.seller`. When a
 * later build adds, renames or reshapes fields inside that slice (attribution
 * labels, subject lines, temporal wrappers), the seller reality has not moved
 * and the honest "Pending" read must not blink out of the operator's Overview.
 *
 * This is NOT "pre-contact can never go stale". Contact being established
 * (`sellerEstablished`, which covers persisted communications, discovery and a
 * present seller with a stated asking price), a lifecycle phase change, or
 * substantive seller-reported information all still invalidate it.
 */
export function sellerLayerCurrent(input: {
  product: SellerIntelligenceProduct | null;
  dossier: AcquisitionDossier;
  sellerEstablished: boolean;
  phase: DealPhase;
  fingerprint: string;
}): boolean {
  const { product } = input;
  if (!product) return false;
  if (product.layerFingerprint === input.fingerprint) return true;
  // A pre-contact product written before `phase` was carried on the contract
  // recorded no phase claim at all. It is accepted only while the deal is still
  // in the phase such a read is written for, so any material lifecycle move
  // away from pre-call still stales it.
  const phaseUnchanged = product.phase == null ? input.phase === 'pre_call' : product.phase === input.phase;
  return product.state === 'pre_contact'
    && !input.sellerEstablished
    && phaseUnchanged
    && input.dossier.seller.sellerReportedFacts.length === 0;
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
  /** Bounded, question-driven God's Eye View spatial investigation. Runs only
   *  when the Property layer is about to re-reason. Best-effort by design: a
   *  missing browser, missing coordinates, or vision failure degrades to a
   *  warning and the read proceeds on retained visual evidence. The
   *  investigator persists its grounded observations through the existing
   *  vision lane; a positive observationCount tells the stack to rebuild the
   *  evidence package so prompt, fingerprint, and product stay consistent. */
  investigateSpatial?: (dealCardId: number, dossier: AcquisitionDossier) => Promise<{ observationCount: number; warnings: string[] }>;
  /** Ask a layer's own specialist whether its OUTLOOK materially moved between
   *  its prior and new current read. Runs ONLY when an evidence-driven refresh
   *  already produced a genuinely new read — never on a read, never on a timer,
   *  never because a product is old. When absent the outlook stays UNCHANGED:
   *  LandOS never asserts a changed opinion it did not verify. */
  compareOutlook?: (layer: IntelligenceLayerId, prompt: string) => Promise<string>;
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

/** A "patient quick flip" is a semantic contradiction under the 150-day
 * LandOS resale doctrine. Enforce the term contract at the product boundary so
 * a model cannot make slow intact resale look like a passing quick flip. */
function normalizeStrategyTerms(value: string): string {
  return value
    .replace(/\bpatient(?:,)?\s+intact\s+quick\s+flip\b/gi, 'patient intact resale')
    .replace(/\bpatient\s+quick\s+flip\b/gi, 'patient resale');
}

function readProducts(dealCardId: number): IntelligenceStackProducts {
  const property = readDerivedSnapshot<PropertyIntelligenceProduct>(dealCardId, PROPERTY_INTELLIGENCE_PRODUCT_TYPE);
  const market = readDerivedSnapshot<MarketIntelligenceProduct>(dealCardId, MARKET_INTELLIGENCE_PRODUCT_TYPE);
  return {
    property: property ? { ...property, read: normalizeStrategyTerms(property.read) } : null,
    // Zero is not a resale-duration estimate. Older model output sometimes
    // serialized an unresolved/null duration as 0; keep that retained record,
    // but never project it as a current operator claim or feed it downstream.
    market: market ? {
      ...market,
      exitProductFits: market.exitProductFits.map((fit) => ({
        ...fit,
        expectedDays: typeof fit.expectedDays === 'number' && fit.expectedDays > 0 ? fit.expectedDays : null,
        read: fit.expectedDays == null || fit.expectedDays <= 0
          ? fit.read?.replace(/^Expected days are not established; 0 denotes (?:unavailable(?: rather than an immediate sale)?|unavailable)\.\s*/i, 'Expected resale timing is not established. ') ?? null
          : fit.read,
      })),
    } : null,
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
  const propertyFingerprint = propertyLayerFingerprint(dossier);
  const marketInputFingerprint = marketLayerInputFingerprint(dossier, propertyFingerprint, products.property);
  const legacyMarketFingerprint = marketLayerFingerprint(
    dossier,
    propertyFingerprint,
    products.market?.webEvidence ?? [],
  );
  const marketCurrent = products.market != null && (
    products.market.inputFingerprint != null
      ? products.market.inputFingerprint === marketInputFingerprint
      : products.market.layerFingerprint === legacyMarketFingerprint
  );
  const quickFlip = quickFlipFrom(dossier);
  const phase = dealPhaseFor({
    pipelineStage: deps.readPipelineStage?.(dealCardId) ?? null,
    sellerEstablished,
    sellerPriceKnown: dossier.seller.askingPrice != null,
  });
  const sellerInputFingerprint = sellerLayerFingerprint(dossier, sellerEstablished, phase);
  const sellerCurrent = sellerLayerCurrent({
    product: products.seller,
    dossier,
    sellerEstablished,
    phase,
    fingerprint: sellerInputFingerprint,
  });
  const fingerprints = {
    property: propertyFingerprint,
    // A current Market read keeps the identity of its complete output,
    // including the governed web evidence it produced. Search results are not
    // part of the pre-run input packet and therefore cannot self-invalidate it.
    market: marketCurrent ? products.market!.layerFingerprint : legacyMarketFingerprint,
    // Same rule for a current Seller read: the Deal layer's seller dependency
    // is the identity of the seller read it actually consumed, so a Seller
    // product that is still truthful cannot cascade a false Deal staleness.
    seller: sellerCurrent ? products.seller!.layerFingerprint : sellerInputFingerprint,
  };
  const dealFingerprint = dealLayerFingerprint(fingerprints, quickFlip, phase, dealCardId);
  return {
    products,
    stale: {
      property: !products.property || products.property.layerFingerprint !== fingerprints.property,
      market: !marketCurrent,
      seller: !sellerCurrent,
      deal: !marketCurrent || !sellerCurrent || !products.deal || products.deal.layerFingerprints?.deal !== dealFingerprint,
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
  phase: DealPhase;
  prior: SellerIntelligenceProduct | null;
}): SellerIntelligenceProduct {
  return {
    contractVersion: INTELLIGENCE_STACK_VERSION,
    dealCardId: input.dealCardId,
    generatedAt: input.generatedAt,
    runtime: DETERMINISTIC_RUNTIME,
    layerFingerprint: input.layerFingerprint,
    dossierFingerprint: input.dossierFp,
    state: 'pre_contact',
    version: (input.prior?.version ?? 0) + 1,
    phase: input.phase,
    read: 'Pending — no meaningful seller communication has been recorded for this deal yet. Motivation, flexibility, negotiation posture, and transaction likelihood are honestly Unknown; nothing is inferred from ownership records.',
    sellerTrajectory: 'Not established.',
    materialChanges: [],
    motivation: null,
    reasonForSelling: null,
    priceExpectation: null,
    priceMovement: null,
    priceFlexibility: null,
    timeline: null,
    urgency: null,
    decisionMakers: null,
    objections: [],
    concerns: [],
    alternatives: null,
    negotiationPosture: null,
    communicationStyle: null,
    responsiveness: null,
    followThrough: null,
    termsFlexibility: null,
    commitments: [],
    bestApproach: null,
    transactionLikelihood: null,
    whatMattersMostNow: null,
    nextConversationObjective: null,
    evidenceWeight: null,
    sellerReportedFacts: [],
    followUps: [],
    contradictions: [],
    unknowns: [],
    nextQuestion: null,
    expertReview: '',
    priorVersionGeneratedAt: input.prior?.generatedAt ?? null,
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
  let dossier = buildAcquisitionDossier({ ...source, dealCardId: input.dealCardId, now: deps.now });
  const sufficiency = propertyFileIsSufficient(dossier);
  if (!sufficiency.ok) return failed(sufficiency.reason ?? 'The property file is not sufficient for an intelligence read.', 'insufficient');
  let dossierFp = dossierFingerprint(dossier);

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
  const retained = readProducts(input.dealCardId);
  const propertyFingerprint = propertyLayerFingerprint(dossier);
  let marketInputFingerprint = marketLayerInputFingerprint(dossier, propertyFingerprint, retained.property);
  const legacyMarketFingerprint = marketLayerFingerprint(
    dossier,
    propertyFingerprint,
    retained.market?.webEvidence ?? [],
  );
  const marketCurrent = retained.market != null && (
    retained.market.inputFingerprint != null
      ? retained.market.inputFingerprint === marketInputFingerprint
      : retained.market.layerFingerprint === legacyMarketFingerprint
  );
  const sellerInputFingerprint = sellerLayerFingerprint(dossier, sellerEstablished, phase);
  const sellerCurrent = sellerLayerCurrent({
    product: retained.seller,
    dossier,
    sellerEstablished,
    phase,
    fingerprint: sellerInputFingerprint,
  });
  const fingerprints = {
    property: propertyFingerprint,
    market: marketCurrent ? retained.market!.layerFingerprint : legacyMarketFingerprint,
    seller: sellerCurrent ? retained.seller!.layerFingerprint : sellerInputFingerprint,
  };
  const guidance = activeOperatorGuidance(input.dealCardId);
  let dealFp = dealLayerFingerprint(fingerprints, quickFlip, phase, input.dealCardId);

  // 4. Dependency-aware refresh: a layer runs only when its inputs moved,
  //    it was explicitly requested, or it has never been produced.
  const requested = new Set(input.layers ?? []);
  const wants = (layer: IntelligenceLayerId, stale: boolean): boolean =>
    input.force === true || requested.has(layer) || (requested.size === 0 && stale);
  const propertyStale = !retained.property || retained.property.layerFingerprint !== fingerprints.property;
  let refreshProperty = wants('property', propertyStale);
  let refreshMarket = wants('market', !marketCurrent);
  // Market consumes Property Intelligence. A Market refresh cannot read a
  // stale Property product, and any new Property read must invalidate Market.
  if (refreshMarket && propertyStale) refreshProperty = true;
  if (refreshProperty) refreshMarket = true;
  const sellerStale = !sellerCurrent
    || (sellerEstablished && retained.seller!.state === 'pre_contact');
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

  // 4b. Property spatial investigation (bounded, question-driven): when the
  // Property layer is about to re-reason and a God's Eye View investigator is
  // wired, capture the material spatial views and ground them through the
  // vision lane FIRST, then rebuild the evidence package so the prompt, the
  // fingerprint, and the persisted product all see the same observations.
  if (refreshProperty && deps.investigateSpatial) {
    try {
      const spatial = await deps.investigateSpatial(input.dealCardId, dossier);
      warnings.push(...spatial.warnings);
      if (spatial.observationCount > 0) {
        const refreshedSource = deps.readPropertyFile(input.dealCardId);
        if (refreshedSource) {
          dossier = buildAcquisitionDossier({ ...refreshedSource, dealCardId: input.dealCardId, now: deps.now });
          dossierFp = dossierFingerprint(dossier);
          fingerprints.property = propertyLayerFingerprint(dossier);
          marketInputFingerprint = marketLayerInputFingerprint(dossier, fingerprints.property, retained.property);
          fingerprints.market = marketCurrent
            ? retained.market!.layerFingerprint
            : marketLayerFingerprint(dossier, fingerprints.property, retained.market?.webEvidence ?? []);
          dealFp = dealLayerFingerprint(fingerprints, quickFlip, phase, input.dealCardId);
        }
      }
    } catch (error) {
      warnings.push(`God's Eye View spatial investigation did not complete: ${error instanceof Error ? error.message.split(/\r?\n/, 1)[0] : String(error)}. The read proceeds on retained visual evidence.`);
    }
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
      phase,
      prior: retained.seller,
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
    const passContext = {
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
    };
    const envelope = { dealCardId: input.dealCardId, generatedAt, contextFingerprint: dossierFp };
    // Cross-department reuse: already-verified compiled jurisdiction knowledge
    // is read once, deterministically, and handed to Property as reusable
    // evidence. No compile, no research decision, no write happens here.
    const compiledKnowledge = modelLayers.includes('property')
      ? readPropertyCompiledKnowledge(input.dealCardId)
      : null;
    try {
      run = await deps.analyst.run({
        dossier,
        requestedProvider: input.requestedProvider ?? null,
        requestedModel: input.requestedModel ?? null,
        judgmentPromptBuilder: (currentDossier, observations) => intelligenceStackPrompt(currentDossier, observations, passContext),
        // The per-layer plan for the persistent-specialist executor. The
        // legacy analyst ignores it; carrying both on the same input is what
        // keeps the executor swappable behind a setting.
        specialistPlan: {
          dealCardId: input.dealCardId,
          layers: modelLayers,
          layerPrompt: (layer, currentDossier, observations) =>
            specialistLayerPrompt(layer, currentDossier, observations, passContext, envelope),
          propertyReviewPrompt: (currentDossier, observations) =>
            propertyExpertReviewPrompt(currentDossier, observations, passContext, envelope, compiledKnowledge),
          propertyExtractionPrompt: (expertReview, currentDossier, observations) =>
            propertyStructuredExtractionPrompt(currentDossier, observations, expertReview, passContext, envelope, compiledKnowledge),
          marketReviewPrompt: (freshProperty, currentDossier) =>
            marketExpertReviewPrompt(
              currentDossier,
              freshProperty ?? retained.property,
              passContext,
              envelope,
            ),
          marketExtractionPrompt: (freshProperty, expertReview, currentDossier) =>
            marketStructuredExtractionPrompt(
              currentDossier,
              freshProperty ?? retained.property,
              expertReview,
              passContext,
              envelope,
            ),
          sellerReviewPrompt: (currentDossier) =>
            sellerExpertReviewPrompt(currentDossier, retained.seller, passContext, envelope),
          sellerExtractionPrompt: (expertReview, currentDossier) =>
            sellerStructuredExtractionPrompt(currentDossier, expertReview, retained.seller, passContext, envelope),
          dealPrompt: (freshLayers, currentDossier, observations) =>
            specialistDealPrompt(currentDossier, observations, passContext, envelope, {
              freshLayers,
              retainedProducts: {
                ...(refreshProperty || !retained.property || retained.property.layerFingerprint !== fingerprints.property ? {} : { property: retained.property }),
                ...(refreshMarket || !marketCurrent ? {} : { market: retained.market }),
                ...(refreshSeller
                  ? (sellerEstablished || !sellerProduct ? {} : { seller: sellerProduct })
                  : (retained.seller?.layerFingerprint === fingerprints.seller ? { seller: retained.seller } : {})),
              },
            }),
        },
      });
    } catch (error) {
      return failed(`The Acquisition Analyst could not complete this read: ${error instanceof Error ? error.message.split(/\r?\n/, 1)[0] : String(error)}`);
    }
    warnings.push(...run.warnings);
  }

  const layers = run ? parseIntelligenceLayers(run.raw) : null;
  if (run && !layers) return failed('The analyst returned no parsable layered JSON result.');

  const runtime = run?.runtime ?? DETERMINISTIC_RUNTIME;
  // Per-layer execution provenance: the specialist executor reports which
  // profile produced each layer; the legacy single-pass analyst reports one
  // runtime for all of them.
  const runtimeFor = (layer: IntelligenceLayerId): AcquisitionIntelligenceRuntime =>
    run?.layerRuntimes?.[layer] ?? runtime;
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

  // The semantic OUTLOOK state for a layer whose read was just re-produced.
  //
  // Age is not an input here and never will be: this runs only because an
  // evidence-driven refresh already decided the layer's material inputs moved.
  // A first read is INITIAL; identical prose is UNCHANGED without a call; and
  // a genuinely rewritten read is UPDATED only when the layer's own specialist
  // says its judgment moved. Without a comparator, or on any comparator
  // failure, the answer stays UNCHANGED — LandOS never claims an opinion
  // changed on evidence it does not have.
  const outlookFor = async (
    layer: IntelligenceLayerId,
    layerLabel: string,
    prior: { outlook?: IntelligenceOutlook | null } | null | undefined,
    priorRead: string | null | undefined,
    nextRead: string | null | undefined,
  ): Promise<IntelligenceOutlook | null> => {
    if (!nextRead?.trim()) return prior?.outlook ?? null;
    const priorProse = (priorRead ?? '').trim();
    let verdict = null;
    if (priorProse && deps.compareOutlook && priorProse.replace(/\s+/g, ' ') !== nextRead.trim().replace(/\s+/g, ' ')) {
      try {
        verdict = parseOutlookVerdict(await deps.compareOutlook(
          layer,
          outlookComparisonPrompt({ layerLabel, priorRead: priorProse, nextRead }),
        ));
      } catch {
        verdict = null;
      }
    }
    return resolveOutlook({ prior: prior?.outlook ?? null, priorRead: priorProse || null, nextRead, verdict, now });
  };

  let propertyProduct = retained.property;
  if (refreshProperty) {
    if (!layers?.property) return failed('The analyst response carried no property layer.');
    if (!run?.propertyExpertReview) return failed('The Property specialist returned no free expert review before extraction.');
    const score = canonicalScores.property ?? layers.property.score;
    propertyProduct = {
      contractVersion: INTELLIGENCE_STACK_VERSION,
      dealCardId: input.dealCardId,
      generatedAt,
      runtime: runtimeFor('property'),
      layerFingerprint: fingerprints.property,
      dossierFingerprint: dossierFp,
      score,
      quality: qualityForScore(score),
      scoreSource: canonicalScores.property != null ? 'canonical' : layers.property.score != null ? 'analyst' : 'none',
      read: normalizeStrategyTerms(layers.property.read ?? 'The analyst returned no property read.'),
      currentExpertRead: layers.property.currentExpertRead,
      outlook: await outlookFor('property', 'Property Intelligence', retained.property, retained.property?.currentExpertRead, layers.property.currentExpertRead),
      strengths: layers.property.strengths,
      constraints: layers.property.constraints,
      potential: layers.property.potential,
      unusual: layers.property.unusual,
      externalities: layers.property.externalities,
      developmentPotential: layers.property.developmentPotential,
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
      configurations: layers.property.configurations,
      // Stage A prose, verbatim and uncapped — the schema above is an
      // extraction from it, never a bound on it.
      expertReview: run.propertyExpertReview,
    };
    writeDerivedSnapshot({
      dealCardId: input.dealCardId,
      snapshotType: PROPERTY_INTELLIGENCE_PRODUCT_TYPE,
      payload: propertyProduct,
      completeness: { strengths: propertyProduct.strengths.length, constraints: propertyProduct.constraints.length, unknowns: propertyProduct.unknowns.length, configurations: propertyProduct.configurations.length, expertReview: propertyProduct.expertReview.length },
      changeReason: `Property Intelligence read by ${runtimeFor('property').agentProfile} on ${runtimeFor('property').model}.`,
      actor: INTELLIGENCE_STACK_ACTOR,
      auditEvent: 'property_intelligence_read',
    });
  }

  let marketProduct = retained.market;
  if (refreshMarket) {
    if (!layers?.market) return failed('The analyst response carried no market layer.');
    if (!run?.marketExpertReview) return failed('The Market specialist returned no free expert review before extraction.');
    const webEvidence: MarketWebEvidence[] = layers.market.webEvidence
      // Stage B may only extract a URL actually carried by the verbatim Stage A
      // ledger. This deterministic gate prevents an extraction hallucination
      // from entering the Evidence Store.
      .filter((item) => run.marketExpertReview!.includes(item.url))
      .map((item) => ({ ...item, retrievedAt: generatedAt }));
    if (webEvidence.length !== layers.market.webEvidence.length) {
      warnings.push(`${layers.market.webEvidence.length - webEvidence.length} Market web citation(s) were rejected because their URL was absent from the Stage A SOURCE LEDGER.`);
    }
    const evidenceResult = appendDerivedEvidence({
      dealCardId: input.dealCardId,
      collectorKey: 'market-intelligence-web',
      actor: INTELLIGENCE_STACK_ACTOR,
      rows: webEvidence.map((item) => ({
        domain: 'market_intelligence_web',
        evidenceKind: 'web_market_claim',
        factKey: 'market_signal',
        raw: {
          query: item.query,
          title: item.title,
          evidenceSnippet: item.evidenceSnippet,
        },
        normalized: {
          title: item.title,
          materialClaim: item.materialClaim,
          sourceType: item.sourceType,
          confidence: item.confidence,
        },
        sourceName: item.title,
        sourceUrl: item.url,
        sourceTier: item.sourceType,
        confidence: item.confidence ?? 'medium',
        retrievedAt: item.retrievedAt,
        dedupeOn: `${item.url}|${item.materialClaim}`,
      })),
    });
    if (evidenceResult.skippedReason && webEvidence.length) warnings.push(`Market web evidence was not attached: ${evidenceResult.skippedReason}`);
    // Stage A owns governed live search, and its accepted citations are
    // persisted before the Market snapshot. That evidence can legitimately
    // change the retained Property-file projection (for example, development
    // signals or coverage). Fingerprint the post-persistence file so a Market
    // product cannot invalidate itself on the first SELECT immediately after
    // the run. This is a read only; it does not run research or another model.
    const persistedMarketSource = deps.readPropertyFile(input.dealCardId);
    const persistedMarketDossier = persistedMarketSource
      ? buildAcquisitionDossier({ ...persistedMarketSource, dealCardId: input.dealCardId, now: deps.now })
      : dossier;
    const score = layers.market.score;
    marketInputFingerprint = marketLayerInputFingerprint(persistedMarketDossier, fingerprints.property, propertyProduct);
    fingerprints.market = marketLayerFingerprint(persistedMarketDossier, fingerprints.property, webEvidence, propertyProduct);
    dealFp = dealLayerFingerprint(fingerprints, quickFlip, phase, input.dealCardId);
    marketProduct = {
      contractVersion: INTELLIGENCE_STACK_VERSION,
      dealCardId: input.dealCardId,
      generatedAt,
      runtime: runtimeFor('market'),
      layerFingerprint: fingerprints.market,
      inputFingerprint: marketInputFingerprint,
      dossierFingerprint: dossierFp,
      score,
      quality: qualityForScore(score),
      scoreSource: layers.market.score != null ? 'analyst' : 'none',
      read: layers.market.read ?? 'The analyst returned no market read.',
      currentExpertRead: layers.market.currentExpertRead,
      outlook: await outlookFor('market', 'Market Intelligence', retained.market, retained.market?.currentExpertRead, layers.market.currentExpertRead),
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
      overallMarketQuality: layers.market.overallMarketQuality,
      exitProductFits: layers.market.exitProductFits,
      expertReview: run.marketExpertReview,
      webEvidence,
      nextActions: layers.market.nextActions,
      webEvidenceIds: evidenceResult.evidenceIds,
    };
    writeDerivedSnapshot({
      dealCardId: input.dealCardId,
      snapshotType: MARKET_INTELLIGENCE_PRODUCT_TYPE,
      payload: marketProduct,
      completeness: {
        expertReview: marketProduct.expertReview.length,
        signals: marketProduct.bestSignals.length,
        risks: marketProduct.risks.length,
        unknowns: marketProduct.unknowns.length,
        webEvidence: marketProduct.webEvidence.length,
      },
      changeReason: `Market Intelligence read by ${runtimeFor('market').agentProfile} on ${runtimeFor('market').model}.`,
      actor: INTELLIGENCE_STACK_ACTOR,
      auditEvent: 'market_intelligence_read',
    });
  }

  if (refreshSeller && sellerEstablished) {
    if (!layers?.seller) return failed('The analyst response carried no seller layer.');
    if (!run?.sellerExpertReview) return failed('The Seller specialist returned no free expert review before extraction.');
    sellerProduct = {
      contractVersion: INTELLIGENCE_STACK_VERSION,
      dealCardId: input.dealCardId,
      generatedAt,
      runtime: runtimeFor('seller'),
      layerFingerprint: fingerprints.seller,
      dossierFingerprint: dossierFp,
      state: 'established',
      // Prior reads are superseded, never overwritten: the snapshot history is
      // the version chain and this ordinal orders it.
      version: (retained.seller?.version ?? 0) + 1,
      phase,
      read: layers.seller.read ?? 'The analyst returned no current seller read.',
      // Seller already owns a semantic change record — its trajectory and its
      // material changes. Mapping that onto the common outlook state gives the
      // Overview one visual language across all four layers without a second
      // model call and without rebuilding Seller Intelligence.
      outlook: sellerOutlookFrom(retained.seller, layers.seller, now),
      sellerTrajectory: layers.seller.sellerTrajectory,
      materialChanges: layers.seller.materialChanges,
      motivation: layers.seller.motivation,
      reasonForSelling: layers.seller.reasonForSelling,
      priceExpectation: layers.seller.priceExpectation,
      priceMovement: layers.seller.priceMovement,
      priceFlexibility: layers.seller.priceFlexibility,
      timeline: layers.seller.timeline,
      urgency: layers.seller.urgency,
      decisionMakers: layers.seller.decisionMakers,
      objections: layers.seller.objections,
      concerns: layers.seller.concerns,
      alternatives: layers.seller.alternatives,
      negotiationPosture: layers.seller.negotiationPosture,
      communicationStyle: layers.seller.communicationStyle,
      responsiveness: layers.seller.responsiveness,
      followThrough: layers.seller.followThrough,
      termsFlexibility: layers.seller.termsFlexibility,
      commitments: layers.seller.commitments,
      bestApproach: layers.seller.bestApproach,
      transactionLikelihood: layers.seller.transactionLikelihood,
      whatMattersMostNow: layers.seller.whatMattersMostNow,
      nextConversationObjective: layers.seller.nextConversationObjective,
      evidenceWeight: layers.seller.evidenceWeight,
      sellerReportedFacts: layers.seller.sellerReportedFacts,
      followUps: layers.seller.followUps,
      contradictions: layers.seller.contradictions,
      unknowns: layers.seller.unknowns,
      nextQuestion: layers.seller.nextQuestion,
      // Stage A prose, verbatim and uncapped — the schema above is an
      // extraction from it, never a bound on it.
      expertReview: run.sellerExpertReview,
      priorVersionGeneratedAt: retained.seller?.generatedAt ?? null,
    };
  }
  if (refreshSeller && sellerProduct) {
    writeDerivedSnapshot({
      dealCardId: input.dealCardId,
      snapshotType: SELLER_INTELLIGENCE_PRODUCT_TYPE,
      payload: sellerProduct,
      completeness: { state: sellerProduct.state, version: sellerProduct.version, reportedFacts: sellerProduct.sellerReportedFacts.length, materialChanges: sellerProduct.materialChanges.length, expertReview: sellerProduct.expertReview.length },
      changeReason: sellerProduct.state === 'pre_contact'
        ? 'Seller Intelligence recorded as pre-contact: honestly unknown.'
        : `Seller Intelligence read by ${runtimeFor('seller').agentProfile} on ${runtimeFor('seller').model}.`,
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
      runtime: runtimeFor('deal'),
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
      currentDealRead: layers.dealExtras.currentDealRead,
      outlook: await outlookFor('deal', 'Deal Brain', retained.deal, retained.deal?.currentDealRead, layers.dealExtras.currentDealRead),
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
          // The numerical Seller Score is removed; the field stays null for
          // old-snapshot shape compatibility.
          score: null,
          state: sellerProduct?.state ?? (sellerEstablished ? 'established' : 'pre_contact'),
        },
        deal: { score: null, label: null },
      },
      reads: {
        property: layers.dealExtras.reads.property ?? propertyProduct?.read ?? null,
        // Market owns the Market read. Deal Brain receives and reasons over
        // the complete specialist product, but its redundant summary must not
        // replace the current specialist truth with an older canonical score
        // or a narrower intact-product interpretation.
        market: marketProduct?.read ?? layers.dealExtras.reads.market ?? null,
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
      bestCurrentStrategy: layers.dealExtras.bestStrategy
        ?? (base.strategies[0] ? { strategy: base.strategies[0].strategy, why: base.strategies[0].whyItFits } : null),
      highestUpsideHypothesis: layers.dealExtras.highestUpsideHypothesis,
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
      changeReason: whatChanged.join(' ').slice(0, 600) || `Deal Intelligence read by ${runtimeFor('deal').agentProfile} on ${runtimeFor('deal').model}.`,
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
