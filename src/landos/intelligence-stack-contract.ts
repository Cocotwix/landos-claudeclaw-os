// LandOS — the Intelligence Stack contract.
//
// Four intelligence PRODUCTS over one shared property file, produced by the
// same Hermes Acquisition Analyst in one coordinated reasoning pass:
//
//   PROPERTY   — is this actually a good piece of land, and why?
//   MARKET     — is this a good market and area for this property's exit?
//   SELLER     — what do we actually know about this seller? (honestly
//                Unknown before contact — that is a normal state, never a gap)
//   DEAL       — given everything LandOS knows right now, what do we have,
//                what is the simplest realistic way to make money, and what
//                should the operator do next?
//
// The Deal product EVOLVES the existing Acquisition Intelligence result — it is
// a superset of `AcquisitionIntelligenceResult`, persisted under the same
// snapshot type, so every existing reader keeps working and history is
// preserved.
//
// Information types stay separate throughout: facts and CALCULATIONS (the
// deterministic quick-flip screen, canonical scores) are supplied to the model
// and carried through verbatim; what the model adds is INTERPRETATION; operator
// guidance is deal-specific guidance, never a canonical fact; and nothing here
// promotes one type into another.

import type { AcquisitionDossier } from './acquisition-intelligence-dossier.js';
import type { VisualObservationDraft } from './acquisition-analyst.js';
import {
  extractJsonObject,
  type AcquisitionIntelligenceResult,
  type AcquisitionIntelligenceRuntime,
  type ConstraintSeverity,
} from './acquisition-intelligence-contract.js';
import type { CashDealVerdict, NovationGateResult, QuickFlipScreenResult } from './quick-flip-screen.js';
import { compiledJurisdictionKnowledgeSection, type PropertyCompiledKnowledge } from './property-compiled-knowledge.js';

export const INTELLIGENCE_STACK_VERSION = '2.2.0';

// ── Shared vocabulary ──────────────────────────────────────────────────────

export type IntelligenceQuality = 'Strong' | 'Good' | 'Moderate' | 'Weak' | 'Poor';

export function qualityForScore(score: number | null): IntelligenceQuality | null {
  if (score == null || !Number.isFinite(score)) return null;
  if (score >= 80) return 'Strong';
  if (score >= 65) return 'Good';
  if (score >= 50) return 'Moderate';
  if (score >= 35) return 'Weak';
  return 'Poor';
}

/** The Deal Score's shorthand label. Visual shorthand only — the explanation
 *  always matters more than the number. */
export function dealLabelForScore(score: number | null): string | null {
  if (score == null || !Number.isFinite(score)) return null;
  if (score >= 80) return 'Compelling';
  if (score >= 65) return 'Promising';
  if (score >= 50) return 'Workable';
  if (score >= 35) return 'Marginal';
  return 'Weak';
}

export type ScoreSource = 'canonical' | 'analyst' | 'none';

export type DealPhase = 'pre_call' | 'post_discovery' | 'underwriting' | 'offer' | 'under_contract';

export const DEAL_PHASE_LABEL: Record<DealPhase, string> = {
  pre_call: 'Pre-call',
  post_discovery: 'Post-discovery',
  underwriting: 'Underwriting',
  offer: 'Offer',
  under_contract: 'Under contract',
};

/** Deterministic phase from what actually exists — Seller Intelligence being
 *  absent never blocks PRE-CALL Deal Intelligence. */
export function dealPhaseFor(input: {
  pipelineStage: string | null;
  sellerEstablished: boolean;
  sellerPriceKnown: boolean;
}): DealPhase {
  const stage = (input.pipelineStage ?? '').toLowerCase();
  if (stage === 'under_contract' || stage === 'closed') return 'under_contract';
  if (stage === 'pursuing') return 'offer';
  if (input.sellerPriceKnown) return 'underwriting';
  if (input.sellerEstablished) return 'post_discovery';
  return 'pre_call';
}

export type IntelligenceLayerId = 'property' | 'market' | 'seller' | 'deal';

// ── The four products ──────────────────────────────────────────────────────

interface ProductBase {
  contractVersion: typeof INTELLIGENCE_STACK_VERSION;
  dealCardId: number;
  generatedAt: string;
  runtime: AcquisitionIntelligenceRuntime;
  /** Identity of the exact inputs this layer was formed from. Unchanged
   *  fingerprint means the layer needs no refresh. */
  layerFingerprint: string;
  dossierFingerprint: string;
}

export interface PropertyIntelligenceProduct extends ProductBase {
  score: number | null;
  quality: IntelligenceQuality | null;
  scoreSource: ScoreSource;
  /** The short human answer: is this actually a good parcel? */
  read: string;
  strengths: string[];
  constraints: Array<{ title: string; why: string | null; severity: ConstraintSeverity }>;
  potential: string[];
  unusual: string[];
  externalities: string[];
  developmentPotential: string | null;
  conflicts: Array<{ subject: string; statement: string; resolution: string }>;
  unknowns: Array<{ question: string; whyItMatters: string | null }>;
  nextActions: Array<{ action: string; why: string | null }>;
  visualObservations: Array<{ visual: string; observation: string; basis: string | null }>;
  /** Plausible property configurations from the expert review: what the land
   * could physically/regulatorily become and what controls each path. Status
   * separates physical plausibility, regulatory plausibility, genuinely
   * unresolved paths, and paths the evidence does not support. Property never
   * decides which configuration wins — Market and Deal Brain do. */
  configurations: Array<{
    label: string;
    status: 'physically_plausible' | 'regulatorily_plausible' | 'unresolved' | 'not_supported';
    prerequisites: string[];
  }>;
  /** Stage A output, preserved verbatim. The operational schema above is an
   * extraction from this review; it does not bound what the expert can notice. */
  expertReview: string;
}

export interface MarketIntelligenceProduct extends ProductBase {
  /** Stable fingerprint of the evidence packet supplied before Stage A.
   * Search findings produced by this read are output, not a self-invalidating
   * input. */
  inputFingerprint?: string;
  score: number | null;
  quality: IntelligenceQuality | null;
  scoreSource: ScoreSource;
  read: string;
  /** Value and liquidity are different — this is the liquidity answer. */
  liquidityRead: string | null;
  areaStory: string | null;
  buyerPool: string | null;
  bestSignals: string[];
  risks: string[];
  exitImplications: string[];
  unknowns: Array<{ question: string; whyItMatters: string | null }>;
  subjectBand: {
    band: string | null;
    medianDaysOnMarket: number | null;
    sellThroughRate: number | null;
    monthsOfSupply: number | null;
    medianPricePerAcre: number | null;
  } | null;
  fastestBand: string | null;
  overallMarketQuality: { grade: string | null; read: string | null };
  exitProductFits: Array<{
    product: string;
    grade: 'A' | 'B' | 'C' | 'D' | null;
    expectedDays: number | null;
    confidence: string | null;
    read: string | null;
  }>;
  /** Stage A output, preserved verbatim. The operational schema below is an
   * extraction from this review; it does not bound what the expert can notice. */
  expertReview: string;
  webEvidence: MarketWebEvidence[];
  nextActions: Array<{ action: string; why: string | null }>;
  webEvidenceIds: number[];
}

export interface MarketWebEvidence {
  query: string | null;
  title: string;
  url: string;
  sourceType: 'official_primary' | 'primary' | 'secondary' | 'community';
  retrievedAt: string;
  materialClaim: string;
  evidenceSnippet: string | null;
  confidence: string | null;
}

export type SellerIntelligenceState = 'pre_contact' | 'established';

/** One material seller-trajectory change between the prior versioned read and
 *  the current one. Only meaningful changes are carried; "no material change"
 *  is a valid trajectory. */
export interface SellerMaterialChange {
  dimension: string;
  priorState: string | null;
  currentState: string;
  /** increased | decreased | improved | worsened | stable | new | resolved | unclear */
  direction: string | null;
  evidence: string | null;
  whyItMatters: string | null;
}

/** There is NO numerical Seller Score. The product is a timestamped, versioned
 *  CURRENT SELLER READ plus SELLER TRAJECTORY, both formed by re-reading the
 *  actual communication record — prior reads are historical interpretations,
 *  never evidence. */
export interface SellerIntelligenceProduct extends ProductBase {
  state: SellerIntelligenceState;
  /** Monotonic version. Prior reads are superseded, never overwritten — the
   *  snapshot history is the version chain and this is its ordinal. */
  version: number;
  /** The deal lifecycle phase this read was formed under — the same behavior
   *  means different things at different phases. */
  phase: DealPhase;
  /** CURRENT SELLER READ: what is our read of this seller and transaction
   *  RIGHT NOW, through the latest meaningful interaction. Pre-contact this is
   *  honestly "Pending". Never a permanent psychological profile. */
  read: string;
  /** SELLER TRAJECTORY: what changed vs the prior read, what stayed stable,
   *  and why the changes matter. "No material change" is valid. */
  sellerTrajectory: string | null;
  materialChanges: SellerMaterialChange[];
  motivation: string | null;
  reasonForSelling: string | null;
  priceExpectation: string | null;
  priceMovement: string | null;
  priceFlexibility: string | null;
  timeline: string | null;
  urgency: string | null;
  decisionMakers: string | null;
  objections: string[];
  concerns: string[];
  alternatives: string | null;
  negotiationPosture: string | null;
  communicationStyle: string | null;
  responsiveness: string | null;
  followThrough: string | null;
  termsFlexibility: string | null;
  commitments: string[];
  bestApproach: string | null;
  transactionLikelihood: string | null;
  whatMattersMostNow: string | null;
  nextConversationObjective: string | null;
  /** Confidence carried at one evidence weight: Confirmed | Well supported |
   *  Likely | Possible | Unresolved. */
  evidenceWeight: string | null;
  /** Always attributed — a seller statement never becomes a verified
   *  property fact by appearing here. */
  sellerReportedFacts: Array<{ statement: string; attribution: string }>;
  followUps: string[];
  /** Where the seller's own record disagrees with itself over time. A
   *  contradiction is surfaced, never resolved into a fact. */
  contradictions: Array<{ subject: string; earlier: string | null; later: string | null; interpretation: string | null }>;
  unknowns: Array<{ question: string; whyItMatters: string | null }>;
  /** The single next question most worth asking the seller. */
  nextQuestion: string | null;
  /** Stage A prose, preserved verbatim; empty string pre-contact. */
  expertReview: string;
  /** generatedAt of the immediately prior version, when one exists. */
  priorVersionGeneratedAt: string | null;
}

/** The Deal Brain read. A strict superset of the V1 Acquisition Intelligence
 *  result so every existing consumer keeps working unchanged. */
export interface DealIntelligenceProduct extends AcquisitionIntelligenceResult {
  intelligenceVersion: typeof INTELLIGENCE_STACK_VERSION;
  phase: DealPhase;
  scores: {
    property: { score: number | null; quality: IntelligenceQuality | null; source: ScoreSource };
    market: { score: number | null; quality: IntelligenceQuality | null; source: ScoreSource };
    /** score is retained for old-snapshot shape compatibility and is always
     *  null going forward: the numerical Seller Score is removed. */
    seller: { score: number | null; state: SellerIntelligenceState };
    deal: { score: number | null; label: string | null };
  };
  /** Short per-product reads for the decision area. */
  reads: { property: string | null; market: string | null; seller: string | null };
  /** Deterministic LandOS CALCULATION — carried verbatim, never model math. */
  quickFlip: QuickFlipScreenResult;
  sellerPriceVerdict: CashDealVerdict;
  novationGate: NovationGateResult;
  bestStrategy: { strategy: string; why: string | null } | null;
  bestCurrentStrategy: { strategy: string; why: string | null } | null;
  highestUpsideHypothesis: { strategy: string; why: string | null; prerequisites: string[] } | null;
  /** Upside beyond the base flip, listed only when the juice is worth the
   *  squeeze — the deal never needs these to qualify. */
  additionalUpside: Array<{ title: string; why: string | null; worthIt: string | null }>;
  discoveryCallObjective: string | null;
  negotiationPosture: string | null;
  /** Operator guidance in effect for this read. Deal-specific guidance, never
   *  canonical property facts. */
  guidanceConsidered: string[];
  whatChanged: string[];
  layerFingerprints: { property: string; market: string; seller: string; deal: string };
}

// ── Snapshot types on the shared derived-intelligence seam ────────────────

export const PROPERTY_INTELLIGENCE_PRODUCT_TYPE = 'intelligence_property_v1';
export const MARKET_INTELLIGENCE_PRODUCT_TYPE = 'intelligence_market_v1';
export const SELLER_INTELLIGENCE_PRODUCT_TYPE = 'intelligence_seller_v1';
// The Deal product deliberately keeps the V1 snapshot type: it IS the evolved
// Acquisition Intelligence, and its history stays one unbroken chain.
export const DEAL_INTELLIGENCE_PRODUCT_TYPE = 'acquisition_intelligence_v1';

// ── The coordinated prompt ─────────────────────────────────────────────────

export interface IntelligencePassContext {
  layers: IntelligenceLayerId[];
  phase: DealPhase;
  quickFlip: QuickFlipScreenResult;
  sellerPriceVerdict: CashDealVerdict;
  canonicalScores: { property: number | null; market: number | null; seller: number | null };
  sellerEstablished: boolean;
  guidance: string[];
  readinessHeadline: string | null;
  knownUnresolved: string[];
  /** Retained reads for layers NOT being refreshed, for coherence. */
  retainedReads: Partial<Record<'property' | 'market' | 'seller', string>>;
}

const LAYER_SCHEMAS: Record<Exclude<IntelligenceLayerId, 'deal'>, string> = {
  property: '"property":{"score":0,"read":"","strengths":[],"constraints":[{"title":"","why":"","severity":"high|medium|low"}],"potential":[],"unusual":[],"externalities":[],"development_potential":"","configurations":[{"label":"","status":"physically_plausible|regulatorily_plausible|unresolved|not_supported","prerequisites":[]}],"conflicts":[{"subject":"","record_claim":"","grounded_visual":"","interpretation":"","recommended_verification":""}],"unknowns":[{"question":"","why_it_matters":""}],"next_actions":[{"action":"","why":""}]}',
  market: '"market":{"score":0,"read":"","overall_market_quality":{"grade":null,"read":""},"exit_product_fits":[{"product":"","grade":"A|B|C|D","expected_days":null,"confidence":"","read":""}],"liquidity_read":"","area_story":"","buyer_pool":"","best_signals":[],"risks":[],"exit_implications":[],"unknowns":[{"question":"","why_it_matters":""}],"next_actions":[{"action":"","why":""}],"web_evidence":[{"query":"","title":"","url":"https://...","source_type":"official_primary|primary|secondary|community","material_claim":"","evidence_snippet":"","confidence":""}]}',
  seller: '"seller":{"current_seller_read":"","seller_trajectory":"","material_changes":[{"dimension":"","prior_state":"","current_state":"","direction":"increased|decreased|improved|worsened|stable|new|resolved|unclear","evidence":"","why_it_matters":""}],"motivation":"","reason_for_selling":"","price_expectation":"","price_movement":"","price_flexibility":"","timeline":"","urgency":"","decision_makers":"","objections":[],"concerns":[],"alternatives":"","negotiation_posture":"","communication_style":"","responsiveness":"","follow_through":"","terms_flexibility":"","commitments":[],"transaction_likelihood":"","what_matters_most_now":"","best_approach":"","next_conversation_objective":"","seller_reported_facts":[{"statement":"","attribution":""}],"follow_ups":[],"contradictions":[{"subject":"","earlier":"","later":"","interpretation":""}],"unknowns":[{"question":"","why_it_matters":""}],"next_question":"","evidence_weight":"Confirmed|Well supported|Likely|Possible|Unresolved"}',
};

const DEAL_SCHEMA = '"deal":{"deal_read":{"headline":"","judgment":"","confidence":"Confirmed|Well supported|Likely|Unresolved"},'
  + '"property_story":[],"market_story":[],'
  + '"opportunities":[{"title":"","why":"","what_would_confirm":""}],'
  + '"constraints":[{"title":"","why":"","severity":"high|medium|low"}],'
  + '"strategies":[{"strategy":"","fit":"strong|possible|weak|rejected","why_it_fits":"","value_creation":"","what_weakens_it":"","what_to_confirm":""}],'
  + '"visual_observations":[{"visual":"","observation":"","basis":""}],'
  + '"conflicts":[{"subject":"","statement":"","resolution":""}],'
  + '"unknowns":[{"question":"","why_it_matters":""}],'
  + '"next_actions":[{"action":"","why":""}],'
  + '"best_current_executable_strategy":{"strategy":"","why":""},'
  + '"highest_upside_hypothesis":{"strategy":"","why":"","prerequisites":[]},'
  + '"additional_upside":[{"title":"","why":"","worth_it":""}],'
  + '"discovery_call_objective":"","negotiation_posture":"","reads":{"property":"","market":"","seller":""}}';

// Shared doctrine sections. The coordinated single-pass prompt and the
// per-specialist prompts must carry the SAME doctrine — extracting it here is
// what prevents the two executors' rules from drifting apart.

function groundedObservationsSection(observations: VisualObservationDraft[]): string {
  return observations.length
    ? [
      '=== GROUNDED VISUAL OBSERVATIONS (a vision model actually received the image pixels; you did not) ===',
      ...observations.map((observation) => `[${observation.visual}] ${observation.observation}${observation.basis ? ` (${observation.basis})` : ''}`),
      '=== END GROUNDED VISUAL OBSERVATIONS ===',
      '',
      'These observations are EVIDENCE from the retained imagery, never canonical facts, and imagery may be stale',
      '(where a capture date is unknown, say "retained imagery", never "current"). Ask of each: does what the',
      'imagery shows agree with what the records claim? Where a record claim and a grounded observation materially',
      'disagree — an improvement the record carries that no imagery shows, access the record asserts that the',
      'imagery contradicts, a structure visible on land recorded vacant — report it in the property layer\'s',
      '"conflicts" with the record claim, the grounded observation, the plausible explanations (stale record,',
      'removed structure, stale/obscured/incomplete imagery), and ONE bounded verification that would settle it',
      '(for example the current official assessor improvement record). Do not chase permits: a demolition permit',
      'found while reading relevant records may support an explanation, but the ABSENCE of one proves nothing.',
      'Never rewrite a record fact because of imagery, and where the imagery is genuinely ambiguous say so',
      'rather than forcing a conclusion.',
    ].join('\n')
    : 'No pixel-grounded visual observation is available for this run. Do not describe or characterize the imagery yourself: you have not seen it. Reason from the structured facts, and leave the property layer\'s "conflicts" empty unless the structured file itself conflicts.';
}

function assessorDoctrineSection(dossier: AcquisitionDossier): string {
  return dossier.officialAssessorRecord
    ? [
      'OFFICIAL ASSESSOR RECORD DOCTRINE. The property file carries an "officialAssessorRecord" section:',
      'the latest bounded Assessor & Tax capability answer for this subject. Where its recordStatus is',
      '"official_record_retrieved", treat it as the CURRENT official record for improvement status, assessed',
      'acreage and owner of record, and reconcile record-vs-imagery conflicts against it — an older provider',
      'claim it contradicts is plausibly historical or stale, but it stays retained as source evidence and is',
      'never erased or rewritten. Where the record could not be retrieved ("not_retrieved"), say that plainly:',
      'the conflict remains unresolved, the official record may itself be unavailable, and the absence of a',
      'record (or of a demolition permit) proves nothing about the structure either way. Never average',
      'conflicting acreages, and never prefer a marketplace value over an official record arbitrarily.',
    ].join('\n')
    : '';
}

function sellerDoctrineSection(dossier: AcquisitionDossier): string {
  return (dossier.seller.communications.length || dossier.seller.discovery.length || dossier.seller.sellerReportedFacts.length)
    ? [
      'SELLER EVIDENCE DOCTRINE. The property file\'s "seller" section is the canonical seller communication',
      'record for this deal: profile, chronological communications, discovery extractions and SELLER-REPORTED',
      'statements with provenance. Rules:',
      '- Where a communication carries a verbatim "body" (call transcript, message text, email body, or full',
      '  note), that primary content IS the evidence — read it in full. The "summary" field is CRM display',
      '  convenience and never overrides or replaces the body; where only a summary exists, treat it as a',
      '  summary, not as the seller\'s verbatim words.',
      '- Each communication\'s "attribution" labels its source deterministically: SELLER STATEMENT, OPERATOR',
      '  STATEMENT, OPERATOR NOTE (operator-authored, never seller speech), or CALL TRANSCRIPT (speaker labels',
      '  inside the body). Never attribute operator words to the seller.',
      '- A SELLER-REPORTED statement is evidence attributed to the seller, never a canonical property fact.',
      '  "The seller says the property is raw land" never becomes "no structure exists".',
      '- In the seller layer, keep the information types separate: a RECORDED EVENT (a call happened on a date),',
      '  a SELLER-REPORTED statement, your INTERPRETATION, a HYPOTHESIS, a CONFLICT, an UNKNOWN, and the NEXT',
      '  QUESTION worth asking. Never promote a negotiation hypothesis into a fact.',
      '- Read the record chronologically: where the seller\'s own statements changed or contradict over time',
      '  (price, timing, motivation, authority), report it under "contradictions" with both statements. Where',
      '  observed behavior (responsiveness, follow-through) differs from stated urgency, say so as interpretation.',
      '- Every seller_reported_facts entry must carry its attribution: who said it, when, in which record.',
      '- CROSS-DOMAIN REFERENCE: another layer may CITE a seller-reported statement as supporting evidence —',
      '  for example, a seller-reported description that independently supports a record-vs-imagery conflict in',
      '  the property layer — but it must stay labeled seller-reported, and no record fact is ever rewritten',
      '  because of it. The seller layer likewise never mutates property facts.',
    ].join('\n')
    : '';
}

/**
 * One coordinated reasoning pass returning only the requested structured
 * layers. The dossier is the complete world; the deterministic quick-flip
 * screen and canonical scores are CALCULATIONS the model must carry, never
 * recompute; operator guidance is guidance, never fact.
 */
export function intelligenceStackPrompt(
  dossier: AcquisitionDossier,
  observations: VisualObservationDraft[],
  context: IntelligencePassContext,
): string {
  const subject = dossier.identity.displayAddress ?? dossier.identity.apn ?? 'the subject parcel';
  const visualKeys = [...new Set([...dossier.visuals.map((visual) => visual.key), ...observations.map((observation) => observation.visual)])];
  const inlined: AcquisitionDossier = {
    ...dossier,
    visuals: dossier.visuals.map(({ filePath: _filePath, ...visual }) => ({ ...visual, filePath: null })),
  };
  const schemas = [
    ...context.layers.filter((layer): layer is Exclude<IntelligenceLayerId, 'deal'> => layer !== 'deal').map((layer) => LAYER_SCHEMAS[layer]),
    ...(context.layers.includes('deal') ? [DEAL_SCHEMA] : []),
  ];
  const canonicalScoreLine = (label: string, score: number | null) =>
    `${label}: ${score != null ? `${score}/100 (authoritative LandOS score — carry it, do not re-score)` : 'not yet established (you may propose one from the file)'}`;

  return [
    `You are producing the LandOS Intelligence Stack read for ${subject}. Phase: ${DEAL_PHASE_LABEL[context.phase]}.`,
    '',
    'Follow the landos-acquisition-analysis skill. The PROPERTY FILE below is the complete world for this run:',
    'do not research, do not browse, and do not assert any fact it does not carry. Where it says something is',
    'not established, it is not established.',
    '',
    'Keep information types separate: a sourced FACT, a deterministic LandOS CALCULATION, your INTERPRETATION,',
    'a temporary ASSUMPTION, and OPERATOR GUIDANCE are different things — never promote one into another.',
    'A visual observation (a road approaching a boundary) is an observation; "that may be an opportunity" is',
    'interpretation; neither becomes "legal access exists".',
    '',
    '=== PROPERTY FILE (JSON) ===',
    JSON.stringify(inlined),
    '=== END PROPERTY FILE ===',
    '',
    groundedObservationsSection(observations),
    '',
    assessorDoctrineSection(dossier),
    '',
    sellerDoctrineSection(dossier),
    '',
    '=== LANDOS DETERMINISTIC QUICK-FLIP SCREEN (CALCULATION — carry these numbers verbatim, never recompute or invent economics) ===',
    JSON.stringify({ quickFlip: context.quickFlip, sellerPriceVerdict: context.sellerPriceVerdict }),
    '=== END CALCULATION ===',
    '',
    '=== CANONICAL LANDOS SCORES ===',
    canonicalScoreLine('Property score', context.canonicalScores.property),
    canonicalScoreLine('Market score', context.canonicalScores.market),
    context.sellerEstablished
      ? 'Seller: there is NO numerical seller score. Produce the CURRENT SELLER READ and SELLER TRAJECTORY from the communication record.'
      : 'Seller: PRE-CONTACT — no seller communication yet. That is normal pre-call; never fabricate motivation from ownership records.',
    '=== END SCORES ===',
    context.readinessHeadline ? `Research readiness: ${context.readinessHeadline}.` : '',
    context.knownUnresolved.length
      ? `Properly attempted but still unresolved (treat as key unknowns, do not assume answers): ${context.knownUnresolved.join('; ')}.`
      : '',
    context.guidance.length
      ? [
        '=== OPERATOR GUIDANCE (deal-specific guidance from the operator — weigh it, respond to it, but it is NOT a canonical property fact) ===',
        ...context.guidance.map((item) => `- ${item}`),
        '=== END OPERATOR GUIDANCE ===',
      ].join('\n')
      : '',
    Object.keys(context.retainedReads).length
      ? `Retained reads not being refreshed this pass (stay coherent with them): ${JSON.stringify(context.retainedReads)}`
      : '',
    '',
    'Strategy rules for the deal layer:',
    '- The deterministic quick-flip screen is one required strategy test, not the default recommendation.',
    '- State one Best Current Executable Strategy supported now and one Highest-Upside Hypothesis whose unresolved prerequisites are explicit.',
    '- For materially large acreage, test realistic product transformation. Recommend the SIMPLEST, FASTEST, REALISTIC profitable strategy; added net must justify time, capital, approvals and risk.',
    '- Consider intact quick/patient resale, simple/minor/frontage split, major subdivision/entitlement, phased sell-down, land-home, improvement then resale, novation, double close, and supported creative terms; reject inapplicable paths explicitly.',
    '- Novation/double close may only be considered when the calculation block says the gate is open — never as a pre-call strategy.',
    '- Market value and liquidity are different: connect the subject to its actual acreage band and say which bands are liquid.',
    context.phase === 'pre_call'
      ? '- This is PRE-CALL: also state the discovery-call objective — exactly what to learn from the seller.'
      : '- Seller communication exists: state the negotiation posture.',
    '',
    'Every "score" field is YOUR integer judgment from 0 to 100 — replace the placeholder, never echo 0.',
    'Do not create or return a generic Deal Score. Deal Brain gives the overall judgment in words and strategy.',
    'Think across the whole file rather than section by section. Say what the combinations mean.',
    'Rank only the strategies THIS property actually supports and mark the ones it does not as rejected.',
    'Carry every conflict in the file, with both values.',
    visualKeys.length
      ? `Cite images only by these exact keys: ${visualKeys.join(', ')}.`
      : 'There are no image keys to cite.',
    '',
    `Reply with ONE JSON object and nothing else, containing exactly these top-level keys: ${context.layers.map((layer) => `"${layer}"`).join(', ')}.`,
    'Use exactly these shapes:',
    `{${schemas.join(',')}}`,
  ].filter(Boolean).join('\n');
}

// ── Per-specialist prompts (persistent Hermes specialist executor) ─────────
//
// The same four products, produced by four persistent profiles instead of one
// combined pass. Each specialist receives a BOUNDED view of the dossier — the
// sections its layer actually reasons over, aligned with that layer's
// fingerprint inputs — plus an authoritative CURRENT DEAL CONTEXT envelope.
// The envelope is the anti-contamination rule made explicit: a persistent
// profile's memory may shape HOW it reasons, never WHAT is currently true.

export interface SpecialistPromptEnvelope {
  dealCardId: number;
  generatedAt: string;
  /** The dossier fingerprint of the exact evidence this run reasons over. */
  contextFingerprint: string;
}

function subjectLine(dossier: AcquisitionDossier): string {
  const identity = dossier.identity;
  return [
    identity.displayAddress,
    identity.apn ? `APN ${identity.apn}` : null,
    [identity.county ? `${identity.county} County` : null, identity.stateCode ?? identity.state].filter(Boolean).join(', ') || null,
  ].filter(Boolean).join(' · ') || 'Subject identity pending';
}

function canonicalAcreageLine(dossier: AcquisitionDossier): string {
  if (dossier.acreage) {
    const core = `${dossier.acreage.canonicalAcres} acres (${[dossier.acreage.source, dossier.acreage.confidence].filter(Boolean).join(', ')})`;
    return dossier.acreage.extentExplanation ? `${core} — ${dossier.acreage.extentExplanation}` : core;
  }
  return dossier.identity.acres != null
    ? `${dossier.identity.acres} acres (${dossier.identity.acreageBasis ?? 'basis unstated'})`
    : 'not established';
}

export function specialistContextEnvelope(
  dossier: AcquisitionDossier,
  context: IntelligencePassContext,
  envelope: SpecialistPromptEnvelope,
): string {
  return specialistContextEnvelopeForPhase(dossier, context.phase, envelope);
}

/** Same authoritative envelope for callers (the deal-scoped War Room) that
 *  have the deal phase but no full IntelligencePassContext — the doctrine text
 *  must be ONE string, never a drifting copy. */
export function specialistContextEnvelopeForPhase(
  dossier: AcquisitionDossier,
  phase: DealPhase,
  envelope: SpecialistPromptEnvelope,
): string {
  return [
    '=== LANDOS CURRENT DEAL CONTEXT (AUTHORITATIVE) ===',
    `Deal Card: #${envelope.dealCardId}`,
    `Subject: ${subjectLine(dossier)}`,
    `Canonical acreage: ${canonicalAcreageLine(dossier)}`,
    `Deal phase: ${DEAL_PHASE_LABEL[phase]}`,
    `Context generated at: ${envelope.generatedAt}`,
    `Evidence fingerprint: ${envelope.contextFingerprint}`,
    'This block and the FILE below are authoritative for every CURRENT fact about this deal. Your persistent',
    'profile memory may shape HOW you reason — method, patterns, discipline — never WHAT is currently true here.',
    'Where anything you remember about this or any other property disagrees with this context, this context wins.',
    'Never carry a fact from another deal into this read, and never treat this deal\'s facts as durable memory:',
    'deal facts belong to LandOS, not to your profile.',
    '=== END LANDOS CURRENT DEAL CONTEXT ===',
  ].join('\n');
}

const stripVisualPaths = (dossier: AcquisitionDossier): AcquisitionDossier['visuals'] =>
  dossier.visuals.map(({ filePath: _filePath, ...visual }) => ({ ...visual, filePath: null }));

/** The property specialist's world: property evidence, never the comp universe
 *  or seller negotiation history. The seller's PROPERTY statements travel as
 *  labeled seller-reported evidence. Exported so the deal-scoped War Room
 *  seats receive the SAME bounded view their intelligence runs use. */
export function propertyDossierView(dossier: AcquisitionDossier): Record<string, unknown> {
  const { valuation: _valuation, comps: _comps, market: _market, seller, ...rest } = dossier;
  return {
    ...rest,
    visuals: stripVisualPaths(dossier),
    sellerReportedPropertyStatements: seller.sellerReportedFacts,
  };
}

/** The market specialist's world: subject basics, canonical acreage, the comp
 *  and valuation projection, the market read, and the land-use context that
 *  bounds development potential. */
export function marketDossierView(dossier: AcquisitionDossier): Record<string, unknown> {
  return {
    dossierVersion: dossier.dossierVersion,
    dealCardId: dossier.dealCardId,
    assembledAt: dossier.assembledAt,
    identity: dossier.identity,
    acreage: dossier.acreage,
    physical: dossier.physical,
    access: dossier.access,
    subdivision: dossier.subdivision,
    utilities: dossier.utilities,
    history: dossier.history,
    valuation: dossier.valuation,
    comps: dossier.comps,
    market: dossier.market,
    landUse: dossier.landUse,
    coverage: dossier.coverage,
  };
}

/** The seller specialist's world: the canonical seller evidence record, plus
 *  only the subject identity needed to interpret it. */
export function sellerDossierView(dossier: AcquisitionDossier): Record<string, unknown> {
  return {
    dossierVersion: dossier.dossierVersion,
    dealCardId: dossier.dealCardId,
    assembledAt: dossier.assembledAt,
    identity: dossier.identity,
    acreage: dossier.acreage,
    seller: dossier.seller,
    coverage: dossier.coverage,
  };
}

const SPECIALIST_ROLE: Record<Exclude<IntelligenceLayerId, 'deal'>, string> = {
  property: 'the persistent LandOS Property Intelligence specialist',
  market: 'the persistent LandOS Market + Area Intelligence specialist',
  seller: 'the persistent LandOS Seller Intelligence specialist',
};

const NO_RESEARCH_RULE = [
  'The FILE below is the complete world for this run: do not research, do not browse, and do not assert any',
  'fact it does not carry. Where it says something is not established, it is not established. Where a material',
  'question needs verification, NAME the bounded check — never attempt it yourself.',
].join('\n');

const SCORE_RULE = 'Every "score" field is YOUR integer judgment from 0 to 100 — replace the placeholder, never echo 0.';

function contextLines(context: IntelligencePassContext): string[] {
  return [
    context.readinessHeadline ? `Research readiness: ${context.readinessHeadline}.` : '',
    context.knownUnresolved.length
      ? `Properly attempted but still unresolved (treat as key unknowns, do not assume answers): ${context.knownUnresolved.join('; ')}.`
      : '',
    context.guidance.length
      ? [
        '=== OPERATOR GUIDANCE (deal-specific guidance from the operator — weigh it, respond to it, but it is NOT a canonical property fact) ===',
        ...context.guidance.map((item) => `- ${item}`),
        '=== END OPERATOR GUIDANCE ===',
      ].join('\n')
      : '',
  ];
}

const canonicalScoreLineFor = (label: string, score: number | null): string =>
  `${label}: ${score != null ? `${score}/100 (authoritative LandOS score — carry it, do not re-score)` : 'not yet established (you may propose one from the file)'}`;

/**
 * One bounded specialist pass producing exactly one non-deal layer.
 */
export function specialistLayerPrompt(
  layer: Exclude<IntelligenceLayerId, 'deal'>,
  dossier: AcquisitionDossier,
  observations: VisualObservationDraft[],
  context: IntelligencePassContext,
  envelope: SpecialistPromptEnvelope,
): string {
  const subject = dossier.identity.displayAddress ?? dossier.identity.apn ?? 'the subject parcel';
  const view = layer === 'property' ? propertyDossierView(dossier)
    : layer === 'market' ? marketDossierView(dossier)
      : sellerDossierView(dossier);

  const layerSections: string[] = layer === 'property'
    ? [
      groundedObservationsSection(observations),
      '',
      assessorDoctrineSection(dossier),
      '',
      dossier.seller.sellerReportedFacts.length
        ? 'The file\'s "sellerReportedPropertyStatements" are SELLER-REPORTED evidence with attribution — they may support or contradict a record claim, but they never become canonical property facts.'
        : '',
      '',
      '=== CANONICAL LANDOS SCORES ===',
      canonicalScoreLineFor('Property score', context.canonicalScores.property),
      '=== END SCORES ===',
      '',
      'Observe, then model one coherent reality: surface contradictions with both values rather than averaging',
      'them, weight every finding honestly, and name the ONE bounded verification for anything material and',
      'unresolved — then stop.',
      '',
      'Act as a specialist multimodal land buyer, not a summarizer. Interpret the retained LandPortal facts, GIS,',
      'parcel geometry, grounded aerial/3D/street observations, buildability, flood, wetlands, streams, soils,',
      'topography, frontage, utilities, zoning, subdivision rules, documents, development history, neighboring',
      'uses and surrounding development. State what is materially good, bad, unusual, opportunistic, constraining,',
      'and externally important; explain plausible development/subdivision potential and the single next property',
      'action. Never claim a visual observation unless it is carried as pixel-grounded evidence.',
      'ACCESS DOCTRINE: when the file says the parcel fronts/abuts a serving road and is Not Landlocked, normal',
      'acquisition-screening access is Established. Recorded deed/easement/title confirmation remains later',
      'diligence and must not downgrade the current screening conclusion to Unresolved.',
    ]
    : layer === 'market'
      ? [
        '=== LANDOS DETERMINISTIC QUICK-FLIP SCREEN (CALCULATION — carry these numbers verbatim, never recompute or invent economics) ===',
        JSON.stringify({ quickFlip: context.quickFlip, sellerPriceVerdict: context.sellerPriceVerdict }),
        '=== END CALCULATION ===',
        '',
        '=== CANONICAL LANDOS SCORES ===',
        canonicalScoreLineFor('Market score', context.canonicalScores.market),
        '=== END SCORES ===',
        '',
        'Keep CURRENT raw-land FMV, DEVELOPMENT POTENTIAL, and BROADER MARKET CONTEXT strictly distinct — a',
        'county-wide statistic is not the subject\'s value, and hypothetical development value is never current',
        'FMV. Market value and liquidity are different: connect the subject to its actual acreage band and say',
        'which bands are liquid. Time-sensitive claims (a moratorium, a pending project) hold only as long as',
        'their evidence is current — say how current the evidence is.',
        '',
        'Answer TWO separate questions: (1) overall neighborhood/immediate-area/ZIP/city/county market quality,',
        'and (2) exit/product market fit for every plausible supported product. The operator wants resale within',
        '150 days. Liquidity grades are A <=90 days, B 91-150, C 151-210, D >210, but the grade must also weigh',
        'closed sales, active competition, sell-through, absorption, months of supply, buyer depth, positioning,',
        'trajectory, product type, confidence and sample size; never grade mechanically from DOM alone.',
        'STRICT SEPARATION: overallMarketQuality grades only the broader place—neighborhood, immediate area, ZIP,',
        'city and county—from growth, housing, employment, infrastructure and general trajectory evidence. Do NOT',
        'grade it from the subject acreage band or call it the quality of "this specific product." If the file lacks',
        'enough broader-place evidence, return grade null and say that broader quality is not established. Put every',
        'subject-product liquidity grade, including intact acreage, only in exitProductFits.',
        'For materially large acreage, compare intact resale against realistic transformed products supported by',
        'Property Intelligence and governing rules. Ask what sellable product the tract should become; never assume',
        'subdivision or invent yield/economics. Use only material Market Pulse signals and explain the subject impact.',
        'Ignore provider names, routes attempted, collector paths and search narration.',
      ]
      : [
        sellerDoctrineSection(dossier),
        'Act as an experienced acquisitions negotiator and human-behavior specialist. Ground every inference in',
        'recorded calls, transcripts, texts, emails, forms, notes, offers, response timing, contradictions or',
        'follow-through. There is NO numerical seller score: produce the CURRENT SELLER READ (what is our read of',
        'this seller and transaction right now, through the latest meaningful interaction) and the SELLER',
        'TRAJECTORY (what changed, what stayed stable, why it matters - "no material change" is valid). Interpret',
        'behavior in the current deal phase: the same behavior means different things at different phases. Assess',
        'motivation, expectations, flexibility, decision control, objections, trust, leverage, communication style',
        'and the next conversation objective. Never manufacture psychology from public records.',
      ];

  return [
    `You are ${SPECIALIST_ROLE[layer]}. You are producing the ${layer} layer of the LandOS Intelligence Stack read for ${subject}. Phase: ${DEAL_PHASE_LABEL[context.phase]}.`,
    '',
    specialistContextEnvelope(dossier, context, envelope),
    '',
    NO_RESEARCH_RULE,
    '',
    'Keep information types separate: a sourced FACT, a deterministic LandOS CALCULATION, your INTERPRETATION,',
    'a temporary ASSUMPTION, and OPERATOR GUIDANCE are different things — never promote one into another.',
    '',
    `=== ${layer.toUpperCase()} FILE (JSON) ===`,
    JSON.stringify(view),
    `=== END ${layer.toUpperCase()} FILE ===`,
    '',
    ...layerSections,
    ...contextLines(context),
    '',
    SCORE_RULE,
    '',
    `Reply with ONE JSON object and nothing else, containing exactly this top-level key: "${layer}".`,
    'Use exactly this shape:',
    `{${LAYER_SCHEMAS[layer]}}`,
  ].filter(Boolean).join('\n');
}

/** Property Stage A: a genuine free expert review over the complete current
 * Property file plus every grounded visual/spatial observation. No research
 * and no rigid schema — the specialist thinks like a senior land expert, and
 * the prose is preserved verbatim. Extraction happens separately in Stage B. */
export function propertyExpertReviewPrompt(
  dossier: AcquisitionDossier,
  observations: VisualObservationDraft[],
  context: IntelligencePassContext,
  envelope: SpecialistPromptEnvelope,
  compiledKnowledge: PropertyCompiledKnowledge | null = null,
): string {
  const subject = dossier.identity.displayAddress ?? dossier.identity.apn ?? 'the subject parcel';
  return [
    `You are LandOS Property Intelligence — a senior land investor, land developer, site evaluator, and property acquisitions expert. Review ${subject}. Phase: ${DEAL_PHASE_LABEL[context.phase]}.`,
    '',
    specialistContextEnvelope(dossier, context, envelope),
    '',
    NO_RESEARCH_RULE,
    '',
    '=== COMPLETE CURRENT PROPERTY FILE (JSON) ===',
    JSON.stringify(propertyDossierView(dossier)),
    '=== END PROPERTY FILE ===',
    '',
    groundedObservationsSection(observations),
    '',
    compiledKnowledge ? compiledJurisdictionKnowledgeSection(compiledKnowledge) : '',
    '',
    assessorDoctrineSection(dossier),
    '',
    dossier.seller.sellerReportedFacts.length
      ? 'The file\'s "sellerReportedPropertyStatements" are SELLER-REPORTED evidence with attribution — they may support or contradict a record claim, but they never become canonical property facts.'
      : '',
    '',
    'All currently available Property evidence has now been assembled. Do not simply summarize fields. Understand the land. Tell the acquisitions team what this property actually is, how it lays, how it functions, what stands out, what helps it, what hurts it, what appears easier or harder than it first looks, what the visual and spatial evidence changes, what relationships matter, what could plausibly be created, what contradictions exist, what may be easy to miss, and what still needs to be proven.',
    '',
    'Connect parcel geometry, imagery and grounded spatial observations, terrain, slope, drainage, streams, flood, wetlands, soils, frontage, practical access, usable/buildable acreage and its CONTIGUITY and physical location, utilities, environmental conditions, surrounding uses and development, parcel history and splits, deeds, surveys, plats, easements, zoning and dimensional standards, subdivision rules, historic development and engineering work, and prior observations. Relationships matter more than fields: shape with frontage and practical entrance; terrain with usable acreage and its continuity; slope with drainage and road entry; soils with septic feasibility; streams/flood/wetlands with lot configuration; zoning and frontage standards with plausible configurations; utilities with development burden; neighboring uses with desirability and WHICH portion of the property each externality actually affects; historic split with what frontage, corridors, drainage areas, terrain, or engineered work was retained or lost; historic plans with whether they still fit the CURRENT parcel. Notice material things nobody asked about.',
    '',
    'OBSERVATION VS FACT — HARD RULE. Imagery and spatial views establish OBSERVATIONS, never legal or regulatory truth. An apparent driveway is not legal access. A road terminating near the boundary is not a right to connect. Wet ground is not a jurisdictional wetland. A visible pole, hydrant, or manhole is not confirmed service or capacity. A cleared corridor is not a recorded right-of-way. Keep FACT, DETERMINISTIC CALCULATION, OBSERVATION, INTERPRETATION, HYPOTHESIS/ASSUMPTION, and UNKNOWN strictly separate and label them as you reason. Never silently promote a visual observation into an authoritative fact. Where a material question cannot be settled from this file, NAME the one bounded authoritative verification that would settle it (recorded easement, survey, plat, zoning determination, utility will-serve, FEMA/NWI determination, assessor record) — never attempt it yourself.',
    'ACCESS DOCTRINE: when the file says the parcel fronts/abuts a serving road and is Not Landlocked, normal acquisition-screening access is Established. Recorded deed/easement/title confirmation remains later diligence and must not downgrade the current screening conclusion to Unresolved.',
    '',
    'Identify the plausible property configurations the physical and regulatory evidence actually supports (intact tract, simple split, minor/major subdivision, estate lots, land-home, improvement, conservation, or property-specific paths), and for each name the controlling prerequisites and whether it is currently PHYSICALLY PLAUSIBLE, REGULATORILY PLAUSIBLE, UNRESOLVED, or NOT SUPPORTED. Do not decide which configuration wins.',
    '',
    'KEEP PROPERTY AUTHORITY IN LANE. You answer: what is this land, how does it actually function, what can it plausibly become, and what physical or regulatory facts control that. Do not issue the final buy/pass judgment, an acquisition recommendation, an offer or walk-away price, or the final investment strategy — Deal Brain owns that synthesis after Market, Seller, and deterministic economics.',
    ...contextLines(context),
    '',
    'Think freely within the Property domain. Produce a complete natural-language expert review, not JSON and not a field-by-field recap. Do not manufacture facts. Establish each controlling caveat clearly once; carry it forward and repeat it only when its implication materially changes. Every paragraph should add evidence, interpretation, or a new connection. Use enough length to preserve useful reasoning (normally 1,200-3,500 words; never exceed 5,000).',
  ].filter(Boolean).join('\n');
}

/** Property Stage B: operational extraction only. It cannot rewrite Stage A. */
export function propertyStructuredExtractionPrompt(
  dossier: AcquisitionDossier,
  observations: VisualObservationDraft[],
  expertReview: string,
  context: IntelligencePassContext,
  envelope: SpecialistPromptEnvelope,
  compiledKnowledge: PropertyCompiledKnowledge | null = null,
): string {
  return [
    'You are LandOS Property Intelligence performing STRUCTURED EXTRACTION from your completed expert review. Do not research and do not add a new fact, observation, conclusion, or configuration. Preserve the meaning of the review; the schema is operational and does not replace it.',
    '',
    specialistContextEnvelope(dossier, context, envelope),
    '',
    '=== COMPLETE CURRENT PROPERTY FILE (JSON) ===',
    JSON.stringify(propertyDossierView(dossier)),
    '=== END PROPERTY FILE ===',
    '',
    groundedObservationsSection(observations),
    '',
    compiledKnowledge ? compiledJurisdictionKnowledgeSection(compiledKnowledge) : '',
    '',
    '=== COMPLETED FREE EXPERT PROPERTY REVIEW (VERBATIM) ===',
    expertReview,
    '=== END EXPERT REVIEW ===',
    '',
    'Extract Property Score as PROPERTY QUALITY only: usable land and its continuity, parcel shape, frontage and practical access, terrain and slope, utility position, environmental burden, development flexibility, externalities, physical marketability, and unresolved intrinsic Property risk. It is NOT the Market, Seller, or Deal score; never score market conditions, seller behavior, or the final investment judgment here.',
    'Preserve the strongest stable operator conclusions from the review: the concise thesis in read, what helps in strengths, what binds in constraints with honest severity, upside in potential, easy-to-miss findings in unusual, surrounding-use burdens in externalities, the development story in development_potential, each plausible configuration with its status and controlling prerequisites in configurations, record-vs-observation contradictions in conflicts with the ONE bounded verification each, evidence gaps in unknowns, and the next material Property actions in next_actions. Do not add a new conclusion merely to fill a field, and do not invent a configuration the review did not support.',
    'Keep observation-vs-fact discipline during extraction: a visual observation stays an observation; recommended verifications stay named, not performed.',
    '=== CANONICAL LANDOS SCORES ===',
    canonicalScoreLineFor('Property score', context.canonicalScores.property),
    '=== END SCORES ===',
    SCORE_RULE,
    '',
    'Reply with ONE JSON object and nothing else, containing exactly this top-level key: "property".',
    'Use exactly this shape:',
    `{${LAYER_SCHEMAS.property}}`,
  ].join('\n');
}

/** Market Stage A: a genuine expert review over the complete current market
 * file and the completed Property specialist product. Search is available only
 * on this pass; LandOS remains the authority and stamps/persists provenance. */
export function marketExpertReviewPrompt(
  dossier: AcquisitionDossier,
  propertyProduct: unknown,
  context: IntelligencePassContext,
  envelope: SpecialistPromptEnvelope,
): string {
  const subject = dossier.identity.displayAddress ?? dossier.identity.apn ?? 'the subject parcel';
  return [
    `You are the persistent LandOS Market + Area Intelligence specialist. You are exceptionally skilled at reading and understanding local real-estate and land markets. Review ${subject}. Phase: ${DEAL_PHASE_LABEL[context.phase]}.`,
    '',
    specialistContextEnvelope(dossier, context, envelope),
    '',
    'The complete currently retained Market file and the completed current Property Intelligence product are below. They are authoritative for retained LandOS evidence. Read them first, form the material market questions and hypotheses, then you MAY use your web-search tool for missing or stale evidence that could materially change overall market quality, product fit, pricing, buyer depth, or exit strategy. Follow meaningful leads, challenge retained evidence when credible public evidence conflicts with it, and stop when additional search is unlikely to change the assessment. Search is question-driven, never query-count-driven; if support remains inadequate, say evidence insufficient.',
    'Web findings are public-market evidence only. They never become canonical property, zoning, legal, access, utility, yield, or entitlement facts. Retain the source title, URL, source class, search query, and material claim for every web finding you rely on. Prefer official government sources; planning, development, utility, and transportation records; legitimate MLS/listing evidence; builder/developer primary sources; credible industry sources; credible local reporting; then secondary/community context. Distinguish official_primary, primary, secondary, and community provenance and do not manufacture facts. A builder announcement or marketing page establishes commitment, product, positioning, and stated timing—not closings, sales velocity, cancellations, incentives, absorption, or buyer depth.',
    '',
    'Keep sourced FACT, LandOS CALCULATION, INTERPRETATION, ASSUMPTION, and UNKNOWN separate. Ignore provider routes, collector machinery, backend diagnostics, and filesystem paths.',
    '',
    '=== COMPLETE CURRENT MARKET FILE (JSON) ===',
    JSON.stringify(marketDossierView(dossier)),
    '=== END MARKET FILE ===',
    '',
    '=== CURRENT PROPERTY INTELLIGENCE PRODUCT (JSON) ===',
    JSON.stringify(retainedProductProjection(propertyProduct) ?? propertyProduct ?? null),
    '=== END PROPERTY INTELLIGENCE ===',
    '',
    'All currently available market evidence has now been assembled. Step back and review the complete market file as a senior land and real-estate market expert. Read and understand the market rather than summarizing fields. Connect the sold evidence, actual competitive set, every Market Research acreage band, liquidity, Market Pulse, development patterns, growth, housing activity, infrastructure, neighboring development, and the plausible product configurations identified by Property Intelligence. Tell the acquisitions team what kind of market this is, where it appears to be heading, what buyers want, what products are moving, what products are sitting, what opportunities or risks are easy to miss, and what the evidence implies for each realistic exit product.',
    '',
    'KEEP MARKET AUTHORITY IN LANE. Give a strong market opinion and title the concluding decision-useful section MARKET IMPLICATIONS. Explain market positioning, liquidity, buyer depth, safe market assumptions, unsupported upside, and evidence that could change the read. Do not issue a final buy/pass judgment, offer or walk-away price, or conditional acquisition instruction. Deal Brain owns the final acquisition decision after Market, Property, Seller, and deterministic economics are synthesized.',
    'Answer TWO different questions: Overall Market Quality for the immediate neighborhood, city, ZIP, county and broader local real-estate trajectory; and Subject / Exit Product Market Fit for the intact tract and every physically/regulatorily plausible transformed product. A strong overall market may coexist with a weak intact large-tract product.',
    'Market Research acreage bands are observed transaction evidence, not the outer boundary of possible exits or a proxy for materially different transformed products. For materially large acreage, consider Property-supported intact acreage, intermediate acreage, 5-acre, 1-2-acre, sub-one-acre, finished-lot, builder-lot, entitled-land, phased sell-down, land-home, and builder/developer tract products where relevant. When surrounding development materially uses a different lot or finished product, make a reasonable direct investigation of that product market rather than substituting another acreage band. Do not invent feasibility or yield; Property Intelligence and governing rules bound plausible configurations. Quick Flip is not automatically preferred.',
    'When residential transformation is material, do not stop at "builders are active." Decide which evidence matters and, where reasonably available, investigate actual closings or sales, absorption by product, available/pending/spec inventory, incentives or reductions, cancellations, phase releases, lots delivered or remaining, approved/proposed competing units and delivery timing, product type, lot and house size, price, builder concentration, finished-lot or entitled-land transactions, land acquisitions, takedown/residual clues, and infrastructure responsibility. Use the material subset, not a fixed checklist. State clearly when public evidence cannot establish performance.',
    'The operator resale objective is 150 days. Use A <=90 days, B 91-150, C 151-210, D >210 for an existing product whose resale timing is supportable, but never grade mechanically from DOM. Weigh closed sales, active competition, sell-through, absorption, months of supply, buyer depth, price position, growth/trajectory, product type, confidence, and sample size. A hypothetical product that has not been created is not automatically D: keep entitlement/execution duration separate, and use Unresolved (null grade and expected days in extraction) when post-creation resale timing is not supportable.',
    'Identify the strongest observed market direction, but do not declare final highest and best use while physical feasibility, entitlement feasibility, yield, costs, or economics remain unresolved.',
    '',
    'Think freely within your market domain. Produce a complete natural-language expert review, not JSON and not a field-by-field recap. Establish each controlling caveat clearly once; carry it forward and repeat it only when its implication materially changes. Every paragraph should add evidence, interpretation, or a new connection. Use enough length to preserve useful reasoning (normally 1,200-3,500 words; never exceed 5,000). End with a section titled exactly "SOURCE LEDGER". For each material web source used, include one bullet containing: QUERY | TITLE | URL | SOURCE TYPE (official_primary, primary, secondary, or community) | MATERIAL CLAIM | EVIDENCE SNIPPET | CONFIDENCE. If no new web source was material, write "SOURCE LEDGER\n- NONE". LandOS will stamp the retrieval time.',
  ].filter(Boolean).join('\n');
}

/** Market Stage B: operational extraction only. It cannot rewrite Stage A. */
export function marketStructuredExtractionPrompt(
  dossier: AcquisitionDossier,
  propertyProduct: unknown,
  expertReview: string,
  context: IntelligencePassContext,
  envelope: SpecialistPromptEnvelope,
): string {
  return [
    'You are the persistent LandOS Market + Area Intelligence specialist performing STRUCTURED EXTRACTION from your completed expert review. Do not browse or search in this pass. Do not add a new fact, conclusion, or source. Preserve the meaning of the review; the schema is operational and does not replace it.',
    '',
    specialistContextEnvelope(dossier, context, envelope),
    '',
    '=== COMPLETE CURRENT MARKET FILE (JSON) ===',
    JSON.stringify(marketDossierView(dossier)),
    '=== END MARKET FILE ===',
    '',
    '=== CURRENT PROPERTY INTELLIGENCE PRODUCT (JSON) ===',
    JSON.stringify(retainedProductProjection(propertyProduct) ?? propertyProduct ?? null),
    '=== END PROPERTY INTELLIGENCE ===',
    '',
    '=== COMPLETED FREE EXPERT MARKET REVIEW (VERBATIM) ===',
    expertReview,
    '=== END EXPERT REVIEW ===',
    '',
    'Extract Market Score as the overall market assessment: broader local market quality, real-estate trajectory, demand, development, Market Research, Market Pulse, competition, liquidity conditions, and confidence. It is NOT the score for the intact subject tract. Keep every specific product grade in exit_product_fits.',
    'Preserve the strongest stable operator conclusions from the review: put the overall thesis in read, broader-place quality in overall_market_quality, development trajectory in area_story, buyer/product segmentation in buyer_pool, current-product liquidity in liquidity_read, transformed-product demand and supported timing in exit_product_fits, opportunities in best_signals and exit_implications, market and data-quality risks or contradictions in risks, evidence gaps in unknowns, and the next material market questions in next_actions. Do not add a new conclusion merely to fill a field.',
    'Retain the A/B/C/D timing doctrine and separate Overall Market Quality from Subject / Exit Product Market Fit. Market Research acreage bands do not limit the product universe. For a hypothetical product not yet created, use grade null and expected_days null unless the review actually supports post-creation resale timing; do not use D as a substitute for entitlement duration. Do not privilege Quick Flip.',
    'Keep Market authority in lane during extraction. Market fields may state strong market implications, required positioning, or that hypothetical yield deserves no present market credit. They must not issue the final buy/pass decision, offer or walk-away price, or conditional acquisition instruction; Deal Brain owns that synthesis.',
    'For web_evidence, extract only sources that appear in the review SOURCE LEDGER and require an http(s) URL. Do not fabricate a citation. LandOS supplies retrieved_at after this call.',
    SCORE_RULE,
    '',
    'Reply with ONE JSON object and nothing else, containing exactly this top-level key: "market".',
    'Use exactly this shape:',
    `{${LAYER_SCHEMAS.market}}`,
  ].join('\n');
}

/** A bounded projection of a retained (not refreshed this pass) product for
 *  the Deal Brain: the substance without runtime plumbing. Exported for the
 *  deal-scoped War Room seat contexts. */
export function retainedProductProjection(product: unknown): Record<string, unknown> | null {
  if (!product || typeof product !== 'object') return null;
  const {
    runtime: _runtime,
    layerFingerprint: _layerFingerprint,
    dossierFingerprint: _dossierFingerprint,
    contractVersion: _contractVersion,
    ...rest
  } = product as Record<string, unknown>;
  return rest;
}

/**
 * The Deal Brain chair pass: synthesize the CURRENT specialist products —
 * fresh ones from this run plus retained ones — with the deterministic
 * economics, into the deal layer. The chair consumes products, not raw
 * dossiers, and never manufactures consensus.
 */
export function specialistDealPrompt(
  dossier: AcquisitionDossier,
  observations: VisualObservationDraft[],
  context: IntelligencePassContext,
  envelope: SpecialistPromptEnvelope,
  inputs: {
    /** Parsed layer objects produced by the specialists THIS pass. */
    freshLayers: Partial<Record<'property' | 'market' | 'seller', unknown>>;
    /** Retained products for layers not refreshed this pass. */
    retainedProducts: Partial<Record<'property' | 'market' | 'seller', unknown>>;
  },
): string {
  const subject = dossier.identity.displayAddress ?? dossier.identity.apn ?? 'the subject parcel';
  const visualKeys = [...new Set([...dossier.visuals.map((visual) => visual.key), ...observations.map((observation) => observation.visual)])];
  const productSection = (layer: 'property' | 'market' | 'seller'): string => {
    const fresh = inputs.freshLayers[layer];
    if (fresh !== undefined) {
      return `=== CURRENT ${layer.toUpperCase()} INTELLIGENCE (fresh this pass, JSON) ===\n${JSON.stringify(fresh)}\n=== END ${layer.toUpperCase()} INTELLIGENCE ===`;
    }
    const retained = retainedProductProjection(inputs.retainedProducts[layer]);
    if (retained) {
      return `=== CURRENT ${layer.toUpperCase()} INTELLIGENCE (retained current product, JSON) ===\n${JSON.stringify(retained)}\n=== END ${layer.toUpperCase()} INTELLIGENCE ===`;
    }
    return `No current ${layer} intelligence product exists yet.`;
  };

  return [
    `You are the persistent LandOS Deal Brain — the executive chair above the specialist reads. You are producing the deal layer of the Intelligence Stack read for ${subject}. Phase: ${DEAL_PHASE_LABEL[context.phase]}.`,
    '',
    specialistContextEnvelope(dossier, context, envelope),
    '',
    NO_RESEARCH_RULE,
    '',
    'You synthesize the CURRENT specialist products below with the deterministic economics. Quote deterministic',
    'numbers verbatim, never recompute. Specialist disagreement is information — never manufacture consensus or',
    'average incompatible positions; carry the disagreement and say what would settle it. Route an open question',
    'back to the specialist layer that owns it via next_actions.',
    '',
    productSection('property'),
    '',
    productSection('market'),
    '',
    productSection('seller'),
    '',
    '=== LANDOS DETERMINISTIC QUICK-FLIP SCREEN (CALCULATION — carry these numbers verbatim, never recompute or invent economics) ===',
    JSON.stringify({ quickFlip: context.quickFlip, sellerPriceVerdict: context.sellerPriceVerdict }),
    '=== END CALCULATION ===',
    '',
    '=== CANONICAL LANDOS SCORES ===',
    canonicalScoreLineFor('Property score', context.canonicalScores.property),
    canonicalScoreLineFor('Market score', context.canonicalScores.market),
    context.sellerEstablished
      ? canonicalScoreLineFor('Seller score', context.canonicalScores.seller)
      : 'Seller score: NOT ESTABLISHED — no seller contact yet. That is normal pre-call; never fabricate motivation from ownership records.',
    '=== END SCORES ===',
    dossier.conflicts.length
      ? `=== LANDOS-DETECTED CONFLICTS (carry every one, with both values) ===\n${JSON.stringify(dossier.conflicts)}\n=== END CONFLICTS ===`
      : '',
    `Evidence coverage — present: ${dossier.coverage.present.join('; ') || 'none listed'}. Absent: ${dossier.coverage.absent.join('; ') || 'none listed'}.`,
    ...contextLines(context),
    '',
    groundedObservationsSection(observations),
    '',
    'Strategy rules for the deal layer:',
    '- The deterministic quick-flip screen is one required strategy test, not the default recommendation.',
    '- State one Best Current Executable Strategy supported now and one Highest-Upside Hypothesis whose unresolved prerequisites are explicit.',
    '- For materially large acreage, test realistic product transformation. Recommend the SIMPLEST, FASTEST, REALISTIC profitable strategy; added net must justify time, capital, approvals and risk.',
    '- Consider intact quick/patient resale, simple/minor/frontage split, major subdivision/entitlement, phased sell-down, land-home, improvement then resale, novation, double close, and supported creative terms; reject inapplicable paths explicitly.',
    '- Novation/double close may only be considered when the calculation block says the gate is open — never as a pre-call strategy.',
    '- Market value and liquidity are different: connect the subject to its actual acreage band and say which bands are liquid.',
    context.phase === 'pre_call'
      ? '- This is PRE-CALL: also state the discovery-call objective — exactly what to learn from the seller.'
      : '- Seller communication exists: state the negotiation posture.',
    '',
    'Do not create or return a generic Deal Score. Deal Brain gives the overall judgment in words and strategy.',
    'Think across the whole file rather than section by section. Say what the combinations mean.',
    'Rank only the strategies THIS property actually supports and mark the ones it does not as rejected.',
    'Carry every conflict in the file, with both values.',
    visualKeys.length
      ? `Cite images only by these exact keys: ${visualKeys.join(', ')}.`
      : 'There are no image keys to cite.',
    '',
    'Reply with ONE JSON object and nothing else, containing exactly this top-level key: "deal".',
    'Use exactly this shape:',
    `{${DEAL_SCHEMA}}`,
  ].filter(Boolean).join('\n');
}

// ── The Deal Brain conversation prompt ─────────────────────────────────────

/**
 * One conversational turn over the CURRENT deal file. The operator's message is
 * deal-specific guidance or a question — never a canonical property fact — and
 * the reply is plain text grounded in what LandOS has already established.
 */
export function dealBrainChatPrompt(input: {
  dossier: AcquisitionDossier;
  deal: DealIntelligenceProduct | null;
  quickFlip: QuickFlipScreenResult | null;
  thread: Array<{ role: 'operator' | 'deal_brain'; text: string }>;
  question: string;
}): string {
  const subject = input.dossier.identity.displayAddress ?? input.dossier.identity.apn ?? 'the subject parcel';
  const inlined: AcquisitionDossier = {
    ...input.dossier,
    visuals: input.dossier.visuals.map(({ filePath: _filePath, ...visual }) => ({ ...visual, filePath: null })),
  };
  return [
    `You are the LandOS Deal Brain answering the operator about ${subject}.`,
    '',
    'Answer ONLY from the deal file below. Do not research, browse, or assert any fact the file does not carry.',
    'The deterministic quick-flip numbers are LandOS CALCULATIONS — carry them verbatim, never recompute.',
    'The operator\'s statements are deal-specific guidance or questions, never canonical property facts.',
    'Where the file does not answer, say so plainly and name what would settle it.',
    '',
    '=== PROPERTY FILE (JSON) ===',
    JSON.stringify(inlined),
    '=== END PROPERTY FILE ===',
    input.deal
      ? [
        '=== CURRENT DEAL INTELLIGENCE (JSON) ===',
        JSON.stringify({
          phase: input.deal.phase,
          dealRead: input.deal.dealRead,
          scores: input.deal.scores,
          bestStrategy: input.deal.bestStrategy,
          additionalUpside: input.deal.additionalUpside,
          unknowns: input.deal.unknowns,
          nextActions: input.deal.nextActions,
        }),
        '=== END DEAL INTELLIGENCE ===',
      ].join('\n')
      : 'No Deal Intelligence read has been produced yet.',
    input.quickFlip
      ? `=== QUICK-FLIP SCREEN (CALCULATION) ===\n${JSON.stringify(input.quickFlip)}\n=== END CALCULATION ===`
      : '',
    input.thread.length
      ? [
        '=== CONVERSATION SO FAR ===',
        ...input.thread.slice(-8).map((turn) => `${turn.role === 'operator' ? 'Operator' : 'Deal Brain'}: ${turn.text}`),
        '=== END CONVERSATION ===',
      ].join('\n')
      : '',
    '',
    `Operator: ${input.question}`,
    '',
    'Reply in plain text, at most one short paragraph plus at most three short bullet lines. No JSON, no preamble.',
  ].filter(Boolean).join('\n');
}

// ── Reading the layered response ───────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Renders the immediate prior versioned Seller Read for trajectory
 * comparison. Prior reads are HISTORICAL INTERPRETATIONS, never evidence:
 * actual communication is ground truth and outranks any prior model read. */
function priorSellerReadSection(prior: Partial<SellerIntelligenceProduct> | null | undefined): string {
  if (!prior || prior.state !== 'established' || !prior.read) {
    return [
      'No prior established Seller Read exists - this is Seller Read v1. The SELLER TRAJECTORY then covers the',
      'evolution visible INSIDE the communication record itself (initial position to current position), or states',
      'plainly that a trajectory is not yet established.',
    ].join('\n');
  }
  return [
    `=== PRIOR SELLER READ (v${prior.version ?? 1}${prior.generatedAt ? `, ${prior.generatedAt}` : ''}${prior.phase ? `, phase ${prior.phase}` : ''}) - HISTORICAL INTERPRETATION, NOT EVIDENCE ===`,
    prior.read,
    prior.sellerTrajectory ? `Prior trajectory: ${prior.sellerTrajectory}` : '',
    '=== END PRIOR SELLER READ ===',
    '',
    'Do NOT merely edit this prior read. Re-read the complete communication record, form a NEW current read from',
    'the evidence through the latest meaningful interaction, and only then compare against this prior read to',
    'produce the SELLER TRAJECTORY: what changed, what remained stable, and why the changes matter. Where the',
    'evidence contradicts the prior read, the evidence wins.',
  ].filter(Boolean).join('\n');
}

/** Seller Stage A: a genuine free expert review over the complete persisted
 * seller communication record, chronologically, in phase context. Natural
 * prose, preserved verbatim; extraction happens separately in Stage B. */
export function sellerExpertReviewPrompt(
  dossier: AcquisitionDossier,
  prior: Partial<SellerIntelligenceProduct> | null | undefined,
  context: IntelligencePassContext,
  envelope: SpecialistPromptEnvelope,
): string {
  const subject = dossier.identity.displayAddress ?? dossier.identity.apn ?? 'the subject parcel';
  return [
    `You are LandOS Seller Intelligence - a senior land-acquisitions negotiator and evidence-grounded human-behavior specialist. Review the seller relationship for ${subject}. Current deal phase: ${DEAL_PHASE_LABEL[context.phase]}.`,
    '',
    specialistContextEnvelope(dossier, context, envelope),
    '',
    NO_RESEARCH_RULE,
    '',
    '=== COMPLETE CURRENT SELLER COMMUNICATION RECORD (JSON) ===',
    JSON.stringify(sellerDossierView(dossier)),
    '=== END SELLER RECORD ===',
    '',
    sellerDoctrineSection(dossier),
    '',
    priorSellerReadSection(prior),
    '',
    'All currently available authorized seller communication evidence has been assembled above. The relationship',
    'may have evolved over days, weeks, or months - read the complete communication history chronologically and',
    'understand the current lifecycle phase. Do not merely summarize messages or fields.',
    '',
    'Form your CURRENT SELLER READ from the complete evidence through the latest meaningful interaction: based on',
    'everything known right now, what is our read of this seller and this transaction? Then compare that current',
    'read against the prior seller state and explain the SELLER TRAJECTORY - what changed, what remained stable,',
    'and why those changes matter. Only material changes belong in the trajectory; "no material change since the',
    'prior read" is a valid answer. Pay attention to price movement, timing, urgency, responsiveness,',
    'follow-through, decision dynamics, objections, terms, commitments, contradictions, and stated versus observed',
    'behavior.',
    '',
    'PHASE CONTEXT MATTERS. The same behavior means different things at different phases: before an offer, slow',
    'replies may indicate low engagement; under contract, low communication may be completely normal; immediately',
    'before closing, unexpected silence may be material. Interpret behavior in phase context - never mechanically',
    'score responsiveness.',
    '',
    'Tell the acquisitions team: what this seller appears to want now, what matters most now, what changed, what',
    'remained stable, how realistic or flexible the current position appears, who currently controls the decision,',
    'what objections actually matter, what transaction risks exist, what remains unknown, what communication',
    'approach best fits the current relationship, and what the next conversation should accomplish.',
    '',
    'HARD EVIDENCE RULES. Ground every interpretation in actual communication or recorded behavior - seller words,',
    'writing, price changes, repeated statements, response timing, follow-through, missed commitments,',
    'contradictions, objections, questions, offer/counter history, actions over time. Keep RECORDED EVENT,',
    'SELLER-REPORTED, FACT, INTERPRETATION, HYPOTHESIS, CONTRADICTION, and UNKNOWN strictly separate and label',
    'them as you reason; never silently promote seller-reported or interpretive material into fact. Do not',
    'manufacture psychology: never infer distress, desperation, vulnerability, impairment, protected',
    'characteristics, or willingness to accept a lower price from public records, demographics, age, ownership',
    'duration, tax records, condition, or location. Carry confidence at one evidence weight: Confirmed, Well',
    'supported, Likely, Possible, or Unresolved.',
    '',
    'KEEP SELLER AUTHORITY IN LANE. You assess motivation, flexibility, expectations, posture, readiness, and',
    'qualitative transaction likelihood; you recommend communication approach, questions, and the next',
    'conversation objective. You do NOT determine buy/pass, the final offer amount, a walk-away amount, the final',
    'acquisition strategy, or contractual commitments - Deal Brain owns that synthesis.',
    ...contextLines(context),
    '',
    'Think freely within the Seller/negotiation domain. Produce a complete natural-language expert review, not',
    'JSON and not a field-by-field recap. Use enough length to preserve useful reasoning (normally 800-2,500',
    'words; never exceed 4,000).',
  ].filter(Boolean).join('\n');
}

/** Seller Stage B: operational extraction only. It cannot rewrite Stage A. */
export function sellerStructuredExtractionPrompt(
  dossier: AcquisitionDossier,
  expertReview: string,
  prior: Partial<SellerIntelligenceProduct> | null | undefined,
  context: IntelligencePassContext,
  envelope: SpecialistPromptEnvelope,
): string {
  const subject = dossier.identity.displayAddress ?? dossier.identity.apn ?? 'the subject parcel';
  return [
    `You are LandOS Seller Intelligence. You have ALREADY produced your free expert review of the seller relationship for ${subject}. Now extract its operational content into the structured Seller product. Phase: ${DEAL_PHASE_LABEL[context.phase]}.`,
    '',
    specialistContextEnvelope(dossier, context, envelope),
    '',
    '=== YOUR EXPERT REVIEW (verbatim - the source of truth for this extraction) ===',
    expertReview,
    '=== END EXPERT REVIEW ===',
    '',
    priorSellerReadSection(prior),
    '',
    'EXTRACTION RULES. Extract only what the review actually supports - do not add new conclusions, do not soften',
    "or strengthen the review's judgments, and do not resolve what the review left unresolved. There is NO",
    'numerical seller score anywhere. "current_seller_read" is the concise current read; "seller_trajectory"',
    'states what changed, what stayed stable, and why it matters; "material_changes" carries ONLY material',
    'dimension changes (direction one of increased|decreased|improved|worsened|stable|new|resolved|unclear) -',
    'never force every dimension into a change; an empty list with a "no material change" trajectory is valid.',
    'Keep every seller_reported_facts entry attributed. Leave a field empty ("" or []) when the review does not',
    'establish it.',
    '',
    'Reply with ONE JSON object and nothing else, containing exactly this top-level key: "seller".',
    'Use exactly this shape:',
    `{${LAYER_SCHEMAS.seller}}`,
  ].filter(Boolean).join('\n');
}

function pick(source: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (source[name] !== undefined && source[name] !== null) return source[name];
    const snake = name.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
    if (source[snake] !== undefined && source[snake] !== null) return source[snake];
  }
  return undefined;
}

function asLine(value: unknown, max = 800): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function asLines(value: unknown, limit: number, max = 600): string[] {
  const items = Array.isArray(value) ? value : value != null ? [value] : [];
  const out: string[] = [];
  for (const item of items) {
    const rendered = isRecord(item)
      ? asLine(pick(item, 'text', 'statement', 'point', 'title', 'value'), max)
      : asLine(item, max);
    if (rendered && !out.includes(rendered)) out.push(rendered);
    if (out.length >= limit) break;
  }
  return out;
}

function asScore(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function asQuestions(value: unknown, limit = 8): Array<{ question: string; whyItMatters: string | null }> {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const record = isRecord(item) ? item : { question: item };
      const question = asLine(pick(record, 'question', 'unknown', 'text', 'title'), 400);
      return question ? { question, whyItMatters: asLine(pick(record, 'whyItMatters', 'why'), 600) } : null;
    })
    .filter((item): item is NonNullable<typeof item> => !!item)
    .slice(0, limit);
}

function asActions(value: unknown, limit = 6): Array<{ action: string; why: string | null }> {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const record = isRecord(item) ? item : { action: item };
      const action = asLine(pick(record, 'action', 'text', 'title', 'step'), 400);
      return action ? { action, why: asLine(pick(record, 'why', 'rationale'), 600) } : null;
    })
    .filter((item): item is NonNullable<typeof item> => !!item)
    .slice(0, limit);
}

function asConstraints(value: unknown, limit = 8): Array<{ title: string; why: string | null; severity: ConstraintSeverity }> {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const record = isRecord(item) ? item : { title: item };
      const title = asLine(pick(record, 'title', 'constraint', 'risk', 'text'), 240);
      if (!title) return null;
      const raw = (asLine(pick(record, 'severity', 'impact'), 40) ?? '').toLowerCase();
      const severity: ConstraintSeverity = raw.includes('high') || raw.includes('critical') ? 'high'
        : raw.includes('low') || raw.includes('minor') ? 'low' : 'medium';
      return { title, why: asLine(pick(record, 'why', 'rationale', 'detail'), 800), severity };
    })
    .filter((item): item is NonNullable<typeof item> => !!item)
    .slice(0, limit);
}

/** A material disagreement the analyst found between a record claim and a
 *  grounded visual observation. Evidence on both sides, a plausible reading,
 *  and the ONE bounded check that would settle it. */
export interface ParsedVisualConflict {
  subject: string;
  recordClaim: string | null;
  groundedVisual: string | null;
  interpretation: string | null;
  recommendedVerification: string | null;
}

export interface ParsedPropertyLayer {
  score: number | null;
  read: string | null;
  strengths: string[];
  constraints: Array<{ title: string; why: string | null; severity: ConstraintSeverity }>;
  potential: string[];
  unusual: string[];
  externalities: string[];
  developmentPotential: string | null;
  configurations: Array<{
    label: string;
    status: 'physically_plausible' | 'regulatorily_plausible' | 'unresolved' | 'not_supported';
    prerequisites: string[];
  }>;
  conflicts: ParsedVisualConflict[];
  unknowns: Array<{ question: string; whyItMatters: string | null }>;
  nextActions: Array<{ action: string; why: string | null }>;
}

export interface ParsedMarketLayer {
  score: number | null;
  read: string | null;
  liquidityRead: string | null;
  areaStory: string | null;
  buyerPool: string | null;
  bestSignals: string[];
  risks: string[];
  exitImplications: string[];
  unknowns: Array<{ question: string; whyItMatters: string | null }>;
  nextActions: Array<{ action: string; why: string | null }>;
  webEvidence: Array<{
    query: string | null;
    title: string;
    url: string;
    sourceType: MarketWebEvidence['sourceType'];
    materialClaim: string;
    evidenceSnippet: string | null;
    confidence: string | null;
  }>;
  overallMarketQuality: { grade: string | null; read: string | null };
  exitProductFits: Array<{ product: string; grade: 'A' | 'B' | 'C' | 'D' | null; expectedDays: number | null; confidence: string | null; read: string | null }>;
}

export interface ParsedSellerLayer {
  read: string | null;
  sellerTrajectory: string | null;
  materialChanges: SellerMaterialChange[];
  reasonForSelling: string | null;
  priceMovement: string | null;
  priceFlexibility: string | null;
  urgency: string | null;
  concerns: string[];
  alternatives: string | null;
  communicationStyle: string | null;
  responsiveness: string | null;
  followThrough: string | null;
  termsFlexibility: string | null;
  commitments: string[];
  transactionLikelihood: string | null;
  whatMattersMostNow: string | null;
  nextConversationObjective: string | null;
  evidenceWeight: string | null;
  motivation: string | null;
  priceExpectation: string | null;
  timeline: string | null;
  decisionMakers: string | null;
  objections: string[];
  negotiationPosture: string | null;
  bestApproach: string | null;
  sellerReportedFacts: Array<{ statement: string; attribution: string }>;
  followUps: string[];
  contradictions: Array<{ subject: string; earlier: string | null; later: string | null; interpretation: string | null }>;
  unknowns: Array<{ question: string; whyItMatters: string | null }>;
  nextQuestion: string | null;
}

export interface ParsedDealExtras {
  score: number | null;
  bestStrategy: { strategy: string; why: string | null } | null;
  highestUpsideHypothesis: { strategy: string; why: string | null; prerequisites: string[] } | null;
  additionalUpside: Array<{ title: string; why: string | null; worthIt: string | null }>;
  discoveryCallObjective: string | null;
  negotiationPosture: string | null;
  reads: { property: string | null; market: string | null; seller: string | null };
}

export interface ParsedIntelligenceLayers {
  property: ParsedPropertyLayer | null;
  market: ParsedMarketLayer | null;
  seller: ParsedSellerLayer | null;
  /** The deal layer re-serialized for the existing V1 normalizer, plus the
   *  fields V1 does not know about. */
  dealRaw: string | null;
  dealExtras: ParsedDealExtras | null;
}

export function parseIntelligenceLayers(raw: string): ParsedIntelligenceLayers | null {
  const parsed = extractJsonObject(raw);
  if (!parsed) return null;

  const propertySource = pick(parsed, 'property');
  const property: ParsedPropertyLayer | null = isRecord(propertySource)
    ? {
      score: asScore(pick(propertySource, 'score')),
      read: asLine(pick(propertySource, 'read', 'propertyRead', 'summary'), 1_800),
      strengths: asLines(pick(propertySource, 'strengths'), 8),
      constraints: asConstraints(pick(propertySource, 'constraints')),
      potential: asLines(pick(propertySource, 'potential', 'propertyPotential', 'upside'), 6),
      unusual: asLines(pick(propertySource, 'unusual', 'unusualFindings'), 6),
      externalities: asLines(pick(propertySource, 'externalities', 'importantExternalities'), 6),
      developmentPotential: asLine(pick(propertySource, 'developmentPotential', 'developmentSubdivisionPotential'), 1_000),
      configurations: (Array.isArray(pick(propertySource, 'configurations', 'plausibleConfigurations')) ? pick(propertySource, 'configurations', 'plausibleConfigurations') as unknown[] : [])
        .map((item) => {
          if (!isRecord(item)) return null;
          const label = asLine(pick(item, 'label', 'configuration', 'title'), 160);
          if (!label) return null;
          const rawStatus = (asLine(pick(item, 'status'), 40) ?? '').toLowerCase().replace(/[\s-]+/g, '_');
          const status = rawStatus === 'physically_plausible' || rawStatus === 'regulatorily_plausible' || rawStatus === 'not_supported'
            ? rawStatus
            : 'unresolved';
          return { label, status, prerequisites: asLines(pick(item, 'prerequisites', 'controllingPrerequisites'), 6) };
        })
        .filter((item): item is ParsedPropertyLayer['configurations'][number] => !!item)
        .slice(0, 10),
      conflicts: (Array.isArray(pick(propertySource, 'conflicts')) ? pick(propertySource, 'conflicts') as unknown[] : [])
        .map((item) => {
          if (!isRecord(item)) return null;
          const subject = asLine(pick(item, 'subject', 'title', 'fact'), 120);
          const recordClaim = asLine(pick(item, 'recordClaim', 'record', 'providerClaim'), 500);
          const groundedVisual = asLine(pick(item, 'groundedVisual', 'visualObservation', 'observed'), 500);
          // A conflict needs both sides to be a conflict at all.
          if (!subject || (!recordClaim && !groundedVisual)) return null;
          return {
            subject,
            recordClaim,
            groundedVisual,
            interpretation: asLine(pick(item, 'interpretation', 'explanation', 'hypothesis'), 600),
            recommendedVerification: asLine(pick(item, 'recommendedVerification', 'verification', 'boundedCheck'), 400),
          };
        })
        .filter((item): item is ParsedVisualConflict => !!item)
        .slice(0, 6),
      unknowns: asQuestions(pick(propertySource, 'unknowns', 'materialUnknowns')),
      nextActions: asActions(pick(propertySource, 'nextActions', 'nextPropertyActions')),
    }
    : null;

  const marketSource = pick(parsed, 'market');
  const market: ParsedMarketLayer | null = isRecord(marketSource)
    ? {
      score: asScore(pick(marketSource, 'score')),
      read: asLine(pick(marketSource, 'read', 'marketRead', 'summary'), 1_800),
      liquidityRead: asLine(pick(marketSource, 'liquidityRead', 'liquidity'), 800),
      areaStory: asLine(pick(marketSource, 'areaStory', 'growthStory', 'area'), 1_000),
      buyerPool: asLine(pick(marketSource, 'buyerPool', 'targetBuyer', 'likelyBuyerPool'), 600),
      bestSignals: asLines(pick(marketSource, 'bestSignals', 'signals'), 6),
      risks: asLines(pick(marketSource, 'risks', 'marketRisks'), 6),
      exitImplications: asLines(pick(marketSource, 'exitImplications', 'exitMarketImplications'), 6),
      unknowns: asQuestions(pick(marketSource, 'unknowns', 'importantMarketUnknowns')),
      nextActions: asActions(pick(marketSource, 'nextActions', 'nextMarketActions')),
      webEvidence: (Array.isArray(pick(marketSource, 'webEvidence')) ? pick(marketSource, 'webEvidence') as unknown[] : [])
        .map((item) => {
          if (!isRecord(item)) return null;
          const title = asLine(pick(item, 'title', 'sourceTitle'), 300);
          const url = asLine(pick(item, 'url', 'sourceUrl'), 1_000);
          const materialClaim = asLine(pick(item, 'materialClaim', 'claim'), 1_200);
          if (!title || !url || !/^https?:\/\//i.test(url) || !materialClaim) return null;
          const rawType = (asLine(pick(item, 'sourceType', 'sourceClass'), 40) ?? '').toLowerCase();
          const sourceType: MarketWebEvidence['sourceType'] = ['official_primary', 'primary', 'secondary', 'community'].includes(rawType)
            ? rawType as MarketWebEvidence['sourceType']
            : 'secondary';
          return {
            query: asLine(pick(item, 'query'), 500),
            title,
            url,
            sourceType,
            materialClaim,
            evidenceSnippet: asLine(pick(item, 'evidenceSnippet', 'snippet'), 1_200),
            confidence: asLine(pick(item, 'confidence'), 80),
          };
        })
        .filter((item): item is NonNullable<typeof item> => !!item)
        .slice(0, 24),
      overallMarketQuality: (() => {
        const source = pick(marketSource, 'overallMarketQuality');
        const record = isRecord(source) ? source : {};
        return {
          grade: asLine(pick(record, 'grade'), 40),
          read: asLine(pick(record, 'read', 'summary'), 1_000),
        };
      })(),
      exitProductFits: (Array.isArray(pick(marketSource, 'exitProductFits')) ? pick(marketSource, 'exitProductFits') as unknown[] : [])
        .map((item) => {
          if (!isRecord(item)) return null;
          const product = asLine(pick(item, 'product', 'name'), 200);
          if (!product) return null;
          const rawGrade = (asLine(pick(item, 'grade'), 10) ?? '').toUpperCase();
          const grade = ['A', 'B', 'C', 'D'].includes(rawGrade) ? rawGrade as 'A' | 'B' | 'C' | 'D' : null;
          const expectedRaw = pick(item, 'expectedDays');
          const expected = expectedRaw == null || expectedRaw === '' ? null : Number(expectedRaw);
          return {
            product,
            grade,
            expectedDays: expected != null && Number.isFinite(expected) && expected > 0 ? expected : null,
            confidence: asLine(pick(item, 'confidence'), 80),
            read: asLine(pick(item, 'read', 'why'), 800),
          };
        })
        .filter((item): item is NonNullable<typeof item> => !!item)
        .slice(0, 8),
    }
    : null;

  const sellerSource = pick(parsed, 'seller');
  const seller: ParsedSellerLayer | null = isRecord(sellerSource)
    ? {
      read: asLine(pick(sellerSource, 'currentSellerRead', 'read', 'sellerRead', 'summary'), 2_400),
      sellerTrajectory: asLine(pick(sellerSource, 'sellerTrajectory', 'trajectory', 'whatChanged'), 2_400),
      materialChanges: (Array.isArray(pick(sellerSource, 'materialChanges')) ? pick(sellerSource, 'materialChanges') as unknown[] : [])
        .map((item) => {
          if (!isRecord(item)) return null;
          const dimension = asLine(pick(item, 'dimension'), 120);
          const currentState = asLine(pick(item, 'currentState', 'current'), 500);
          if (!dimension || !currentState) return null;
          return {
            dimension,
            priorState: asLine(pick(item, 'priorState', 'prior'), 500),
            currentState,
            direction: asLine(pick(item, 'direction'), 40),
            evidence: asLine(pick(item, 'evidence'), 600),
            whyItMatters: asLine(pick(item, 'whyItMatters'), 600),
          };
        })
        .filter((item): item is SellerMaterialChange => !!item)
        .slice(0, 10),
      reasonForSelling: asLine(pick(sellerSource, 'reasonForSelling'), 600),
      priceMovement: asLine(pick(sellerSource, 'priceMovement'), 600),
      priceFlexibility: asLine(pick(sellerSource, 'priceFlexibility', 'currentPriceFlexibility'), 600),
      urgency: asLine(pick(sellerSource, 'urgency', 'currentUrgency'), 600),
      concerns: asLines(pick(sellerSource, 'concerns', 'currentConcerns'), 6),
      alternatives: asLine(pick(sellerSource, 'alternatives', 'currentAlternatives'), 600),
      communicationStyle: asLine(pick(sellerSource, 'communicationStyle'), 400),
      responsiveness: asLine(pick(sellerSource, 'responsiveness'), 500),
      followThrough: asLine(pick(sellerSource, 'followThrough'), 500),
      termsFlexibility: asLine(pick(sellerSource, 'termsFlexibility'), 500),
      commitments: asLines(pick(sellerSource, 'commitments'), 6),
      transactionLikelihood: asLine(pick(sellerSource, 'transactionLikelihood', 'currentTransactionLikelihood'), 600),
      whatMattersMostNow: asLine(pick(sellerSource, 'whatMattersMostNow'), 600),
      nextConversationObjective: asLine(pick(sellerSource, 'nextConversationObjective'), 600),
      evidenceWeight: asLine(pick(sellerSource, 'evidenceWeight', 'confidence'), 80),
      motivation: asLine(pick(sellerSource, 'motivation'), 600),
      priceExpectation: asLine(pick(sellerSource, 'priceExpectation', 'askingPrice'), 400),
      timeline: asLine(pick(sellerSource, 'timeline'), 400),
      decisionMakers: asLine(pick(sellerSource, 'decisionMakers', 'owners'), 400),
      objections: asLines(pick(sellerSource, 'objections', 'blockers'), 6),
      negotiationPosture: asLine(pick(sellerSource, 'negotiationPosture', 'posture'), 600),
      bestApproach: asLine(pick(sellerSource, 'bestApproach', 'bestWayToWorkThisSeller'), 800),
      sellerReportedFacts: (Array.isArray(pick(sellerSource, 'sellerReportedFacts')) ? pick(sellerSource, 'sellerReportedFacts') as unknown[] : [])
        .map((item) => {
          const record = isRecord(item) ? item : { statement: item };
          const statement = asLine(pick(record, 'statement', 'fact', 'text'), 600);
          return statement
            ? { statement, attribution: asLine(pick(record, 'attribution', 'source'), 200) ?? 'Seller-reported; not independently verified.' }
            : null;
        })
        .filter((item): item is NonNullable<typeof item> => !!item)
        .slice(0, 8),
      followUps: asLines(pick(sellerSource, 'followUps', 'unknownFollowUpItems', 'followUpItems'), 6),
      contradictions: (Array.isArray(pick(sellerSource, 'contradictions')) ? pick(sellerSource, 'contradictions') as unknown[] : [])
        .map((item) => {
          if (!isRecord(item)) return null;
          const subject = asLine(pick(item, 'subject', 'title', 'topic'), 160);
          const earlier = asLine(pick(item, 'earlier', 'earlierStatement', 'was'), 500);
          const later = asLine(pick(item, 'later', 'laterStatement', 'now'), 500);
          // A contradiction needs a subject and at least one side to carry.
          if (!subject || (!earlier && !later)) return null;
          return { subject, earlier, later, interpretation: asLine(pick(item, 'interpretation', 'explanation'), 600) };
        })
        .filter((item): item is NonNullable<typeof item> => !!item)
        .slice(0, 6),
      unknowns: asQuestions(pick(sellerSource, 'unknowns', 'unansweredQuestions')),
      nextQuestion: asLine(pick(sellerSource, 'nextQuestion', 'nextSellerQuestion'), 500),
    }
    : null;

  const dealSource = pick(parsed, 'deal');
  const dealRecord = isRecord(dealSource) ? dealSource : null;
  const bestStrategySource = dealRecord ? pick(dealRecord, 'bestCurrentExecutableStrategy', 'bestStrategy') : undefined;
  const highestUpsideSource = dealRecord ? pick(dealRecord, 'highestUpsideHypothesis') : undefined;
  const dealExtras: ParsedDealExtras | null = dealRecord
    ? {
      score: asScore(pick(dealRecord, 'score', 'dealScore')),
      bestStrategy: isRecord(bestStrategySource)
        ? (() => {
          const strategy = asLine(pick(bestStrategySource, 'strategy', 'name', 'title'), 160);
          return strategy ? { strategy, why: asLine(pick(bestStrategySource, 'why', 'rationale'), 800) } : null;
        })()
        : null,
      highestUpsideHypothesis: isRecord(highestUpsideSource)
        ? (() => {
          const strategy = asLine(pick(highestUpsideSource, 'strategy', 'name', 'title'), 160);
          return strategy ? {
            strategy,
            why: asLine(pick(highestUpsideSource, 'why', 'rationale'), 800),
            prerequisites: asLines(pick(highestUpsideSource, 'prerequisites', 'whatToConfirm'), 8),
          } : null;
        })()
        : null,
      additionalUpside: (Array.isArray(pick(dealRecord, 'additionalUpside')) ? pick(dealRecord, 'additionalUpside') as unknown[] : [])
        .map((item) => {
          const record = isRecord(item) ? item : { title: item };
          const title = asLine(pick(record, 'title', 'upside', 'name'), 240);
          return title
            ? { title, why: asLine(pick(record, 'why', 'rationale'), 800), worthIt: asLine(pick(record, 'worthIt', 'worth_it', 'tradeoff'), 600) }
            : null;
        })
        .filter((item): item is NonNullable<typeof item> => !!item)
        .slice(0, 4),
      discoveryCallObjective: asLine(pick(dealRecord, 'discoveryCallObjective'), 800),
      negotiationPosture: asLine(pick(dealRecord, 'negotiationPosture'), 800),
      reads: (() => {
        const readsSource = pick(dealRecord, 'reads');
        const reads = isRecord(readsSource) ? readsSource : {};
        return {
          property: asLine(pick(reads, 'property'), 500),
          market: asLine(pick(reads, 'market'), 500),
          seller: asLine(pick(reads, 'seller'), 500),
        };
      })(),
    }
    : null;

  if (!property && !market && !seller && !dealRecord) return null;
  return {
    property,
    market,
    seller,
    dealRaw: dealRecord ? JSON.stringify(dealRecord) : null,
    dealExtras,
  };
}
