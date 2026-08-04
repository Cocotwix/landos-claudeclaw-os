// Multi-view Visual Buyer Analysis.
//
// One structured, buyer-oriented visual read of the subject property,
// grounded in the combined ACCEPTED visual evidence (satellite, frontage,
// aerial, context, 3D, Street View, overlays, buildability) plus accepted
// structured facts — never a single aerial alone. The analysis distinguishes
// direct observation from interpretation, reconciles conflicting views
// (stronger evidence supersedes), and never states legal conclusions or
// guarantees. It persists through the existing canonical property-research
// path and is projected read-time into the V2 Overview (concise summary) and
// Property Intelligence (full analysis).

import { normalizeAddressKey } from './property-card.js';
import type { CanonicalPropertyInput, NormalizedPropertyEvidence, PropertyProviderResult } from './property-intelligence-contract.js';
import { PropertyResearchStore } from './property-research-store.js';

export const VISUAL_BUYER_ANALYSIS_FIELD = 'visual_buyer_analysis';
export const VISUAL_BUYER_ANALYSIS_LANE = 'visual_buyer_analysis';
export const VISUAL_BUYER_ANALYSIS_PROVIDER = 'landos_visual_analysis';

export interface VisualBuyerObservation {
  label: string;
  detail: string;
  /** Which accepted views support this line. */
  views: string[];
  basis: 'direct_observation' | 'reasonable_interpretation' | 'unconfirmed';
}

export interface VisualBuyerAnalysis {
  generatedAt: string;
  subjectLabel: string;
  /** Accepted evidence the analysis is grounded in (categories, not one aerial). */
  basedOn: string[];
  /** A. Directly observed property features. */
  observedFeatures: VisualBuyerObservation[];
  /** B. Buyer-oriented interpretation. */
  buyerInterpretation: VisualBuyerObservation[];
  /** C. Unresolved diligence. */
  unresolvedDiligence: string[];
  /** D. Potential buyer perspective. */
  buyerPerspective: {
    strongestAdvantages: string[];
    importantConcerns: string[];
    bestFitBuyers: string[];
    weakerFitBuyers: string[];
    preliminaryImpression: string;
    materialToValueOrStrategy: string[];
  };
  /** E. Confidence and evidence reconciliation. */
  evidenceReconciliation: {
    supportingViews: string[];
    supersededConclusions: Array<{ prior: string; reconciled: string; strongerEvidence: string }>;
    remainingUncertain: string[];
    overallConfidence: 'high' | 'moderate' | 'low';
    confidenceWhy: string;
  };
  /** Concise Overview projection: scannable before a discovery call. */
  overviewSummary: {
    physicalCharacter: string;
    mainBuyerAppeal: string;
    topConcern: string;
  };
}

// Claims the analysis must never state as established facts.
const PROHIBITED_CLAIMS =
  /guaranteed\s+buildab|legal\s+access\s+is\s+(?:confirmed|established|guaranteed)|septic\s+(?:is\s+)?approv|surveyed\s+boundar(?:y|ies)\s+(?:are\s+)?confirmed|jurisdictional\s+wetlands?\s+(?:finding|determination)\s+(?:is|was)\s+(?:made|confirmed)|is\s+an\s+active\s+railroad|is\s+a\s+public\s+trail/i;

export function validateVisualBuyerAnalysis(analysis: VisualBuyerAnalysis): string[] {
  const problems: string[] = [];
  if (analysis.basedOn.length < 3) problems.push('analysis must be grounded in multiple views, never one aerial alone');
  if (!analysis.observedFeatures.length) problems.push('section A (observed features) is empty');
  if (!analysis.buyerInterpretation.length) problems.push('section B (buyer interpretation) is empty');
  if (!analysis.unresolvedDiligence.length) problems.push('section C (unresolved diligence) is empty');
  if (!analysis.buyerPerspective.strongestAdvantages.length || !analysis.buyerPerspective.importantConcerns.length) {
    problems.push('section D (buyer perspective) is incomplete');
  }
  if (!analysis.evidenceReconciliation.supportingViews.length) problems.push('section E (reconciliation) is empty');
  if (!analysis.overviewSummary.physicalCharacter || !analysis.overviewSummary.mainBuyerAppeal || !analysis.overviewSummary.topConcern) {
    problems.push('overview summary must state physical character, main appeal, and top concern');
  }
  const text = JSON.stringify(analysis);
  if (PROHIBITED_CLAIMS.test(text)) problems.push('analysis states a prohibited legal or guaranteed conclusion');
  for (const item of [...analysis.observedFeatures, ...analysis.buyerInterpretation]) {
    if (!item.views.length) problems.push(`"${item.label}" cites no supporting views`);
  }
  return problems;
}

export interface PersistVisualBuyerAnalysisInput {
  propertyCardId: number;
  dealCardId: number;
  address: string;
  county: string | null;
  state: string | null;
  apn: string | null;
  fips: string | null;
  landPortalPropertyId: string | null;
  sourceUrl: string | null;
  analysis: VisualBuyerAnalysis;
  now?: () => string;
}

/** Persist through the existing canonical property-research path (no new store). */
export function persistVisualBuyerAnalysis(input: PersistVisualBuyerAnalysisInput): { persisted: boolean; reason: string | null } {
  const problems = validateVisualBuyerAnalysis(input.analysis);
  if (problems.length) return { persisted: false, reason: problems.join('; ') };
  const now = input.now ?? (() => new Date().toISOString());
  const at = now();
  const store = new PropertyResearchStore();
  // Reuse the retained canonical identity so the analysis always joins the
  // same record every other lane writes to (identity strings must match the
  // retained record exactly, not a re-derivation of them).
  const retainedIdentity = store.loadForProperty(input.propertyCardId)?.identity ?? null;
  const property: CanonicalPropertyInput = retainedIdentity ?? {
    propertyCardId: input.propertyCardId,
    dealCardId: input.dealCardId,
    normalizedAddress: normalizeAddressKey(input.address),
    address: input.address,
    city: null,
    county: input.county,
    state: input.state,
    zip: null,
    apn: input.apn,
    fips: input.fips,
    landPortalPropertyId: input.landPortalPropertyId,
  };
  const evidence: NormalizedPropertyEvidence = {
    id: `visual-buyer-analysis:${input.propertyCardId}`,
    propertyCardId: property.propertyCardId,
    dealCardId: property.dealCardId,
    providerId: VISUAL_BUYER_ANALYSIS_PROVIDER,
    field: VISUAL_BUYER_ANALYSIS_FIELD,
    value: input.analysis,
    subjectClassification: 'verified_subject',
    strength: 'provider_verified',
    sourceUrl: input.sourceUrl,
    retrievedAt: input.analysis.generatedAt,
    confidence: input.analysis.evidenceReconciliation.overallConfidence === 'high' ? 'high' : 'medium',
    kind: 'fact',
    validation: { valid: true, reasons: [] },
  };
  const result: PropertyProviderResult<VisualBuyerAnalysis> = {
    contractVersion: 'property-provider-v1',
    runId: `visual-buyer-analysis-${input.propertyCardId}-${input.analysis.generatedAt}`,
    laneId: VISUAL_BUYER_ANALYSIS_LANE,
    providerId: VISUAL_BUYER_ANALYSIS_PROVIDER,
    input: property,
    execution: { attempted: true, startedAt: at, completedAt: at, durationMs: 0, result: input.analysis },
    validation: {
      valid: true,
      subjectClassification: 'verified_subject',
      checks: [{ check: 'multi_view_grounding', passed: true, reason: `Grounded in ${input.analysis.basedOn.length} accepted view categories.` }],
      rejectedEvidenceIds: [],
    },
    evidence: [evidence],
    status: 'verified',
    persistence: { attempted: false, persisted: false, retainedEvidenceCount: 0, rejectedEvidenceCount: 0, reason: null },
    failureReason: null,
  };
  const persisted = store.persistProviderResult(result);
  return { persisted: persisted.persistence.persisted, reason: persisted.persistence.reason };
}

/** Read the newest retained analysis from the canonical record. */
export function loadVisualBuyerAnalysis(propertyCardId: number): VisualBuyerAnalysis | null {
  const record = new PropertyResearchStore().loadForProperty(propertyCardId);
  const fact = record?.facts[VISUAL_BUYER_ANALYSIS_FIELD];
  const value = fact?.value as VisualBuyerAnalysis | undefined;
  return value && typeof value === 'object' && Array.isArray(value.observedFeatures) ? value : null;
}
