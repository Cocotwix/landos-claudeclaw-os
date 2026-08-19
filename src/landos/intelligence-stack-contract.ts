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

export const INTELLIGENCE_STACK_VERSION = '2.0.0';

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
  conflicts: Array<{ subject: string; statement: string; resolution: string }>;
  unknowns: Array<{ question: string; whyItMatters: string | null }>;
  nextActions: Array<{ action: string; why: string | null }>;
  visualObservations: Array<{ visual: string; observation: string; basis: string | null }>;
}

export interface MarketIntelligenceProduct extends ProductBase {
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
}

export type SellerIntelligenceState = 'pre_contact' | 'established';

export interface SellerIntelligenceProduct extends ProductBase {
  state: SellerIntelligenceState;
  /** Null is the honest pre-contact answer: "Not established". */
  score: number | null;
  read: string;
  motivation: string | null;
  priceExpectation: string | null;
  timeline: string | null;
  decisionMakers: string | null;
  objections: string[];
  negotiationPosture: string | null;
  bestApproach: string | null;
  /** Always attributed — a seller statement never becomes a verified
   *  property fact by appearing here. */
  sellerReportedFacts: Array<{ statement: string; attribution: string }>;
  followUps: string[];
}

/** The Deal Brain read. A strict superset of the V1 Acquisition Intelligence
 *  result so every existing consumer keeps working unchanged. */
export interface DealIntelligenceProduct extends AcquisitionIntelligenceResult {
  intelligenceVersion: typeof INTELLIGENCE_STACK_VERSION;
  phase: DealPhase;
  scores: {
    property: { score: number | null; quality: IntelligenceQuality | null; source: ScoreSource };
    market: { score: number | null; quality: IntelligenceQuality | null; source: ScoreSource };
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
  property: '"property":{"score":0,"read":"","strengths":[],"constraints":[{"title":"","why":"","severity":"high|medium|low"}],"potential":[],"unknowns":[{"question":"","why_it_matters":""}],"next_actions":[{"action":"","why":""}]}',
  market: '"market":{"score":0,"read":"","liquidity_read":"","area_story":"","buyer_pool":"","best_signals":[],"risks":[],"exit_implications":[],"unknowns":[{"question":"","why_it_matters":""}]}',
  seller: '"seller":{"score":0,"read":"","motivation":"","price_expectation":"","timeline":"","decision_makers":"","objections":[],"negotiation_posture":"","best_approach":"","seller_reported_facts":[{"statement":"","attribution":""}],"follow_ups":[]}',
};

const DEAL_SCHEMA = '"deal":{"score":0,"deal_read":{"headline":"","judgment":"","confidence":"Confirmed|Well supported|Likely|Unresolved"},'
  + '"property_story":[],"market_story":[],'
  + '"opportunities":[{"title":"","why":"","what_would_confirm":""}],'
  + '"constraints":[{"title":"","why":"","severity":"high|medium|low"}],'
  + '"strategies":[{"strategy":"","fit":"strong|possible|weak|rejected","why_it_fits":"","value_creation":"","what_weakens_it":"","what_to_confirm":""}],'
  + '"visual_observations":[{"visual":"","observation":"","basis":""}],'
  + '"conflicts":[{"subject":"","statement":"","resolution":""}],'
  + '"unknowns":[{"question":"","why_it_matters":""}],'
  + '"next_actions":[{"action":"","why":""}],'
  + '"best_strategy":{"strategy":"","why":""},'
  + '"additional_upside":[{"title":"","why":"","worth_it":""}],'
  + '"discovery_call_objective":"","negotiation_posture":"","reads":{"property":"","market":"","seller":""}}';

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
  const visualKeys = dossier.visuals.map((visual) => visual.key);
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
    observations.length
      ? [
        '=== VISUAL OBSERVATIONS (from the retained imagery, already inspected) ===',
        ...observations.map((observation) => `[${observation.visual}] ${observation.observation}`),
        '=== END VISUAL OBSERVATIONS ===',
      ].join('\n')
      : 'No retained image could be inspected for this run; reason from the retained structured observations and facts instead.',
    '',
    '=== LANDOS DETERMINISTIC QUICK-FLIP SCREEN (CALCULATION — carry these numbers verbatim, never recompute or invent economics) ===',
    JSON.stringify({ quickFlip: context.quickFlip, sellerPriceVerdict: context.sellerPriceVerdict }),
    '=== END CALCULATION ===',
    '',
    '=== CANONICAL LANDOS SCORES ===',
    canonicalScoreLine('Property score', context.canonicalScores.property),
    canonicalScoreLine('Market score', context.canonicalScores.market),
    context.sellerEstablished
      ? canonicalScoreLine('Seller score', context.canonicalScores.seller)
      : 'Seller score: NOT ESTABLISHED — no seller contact yet. That is normal pre-call; never fabricate motivation from ownership records.',
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
    '- The FIRST screen is the simple cash quick flip: buy, list as-is, sell. The deterministic screen above is that answer.',
    '- Recommend the SIMPLEST, FASTEST, REALISTIC profitable strategy. Complexity must be earned: added net must justify added time, capital, approvals and risk.',
    '- Value-add strategies (splits, land-home, entitlement) are UPSIDE, never prerequisites. List them under additional_upside only when the juice is worth the squeeze.',
    '- Novation/double close may only be considered when the calculation block says the gate is open — never as a pre-call strategy.',
    '- Market value and liquidity are different: connect the subject to its actual acreage band and say which bands are liquid.',
    context.phase === 'pre_call'
      ? '- This is PRE-CALL: also state the discovery-call objective — exactly what to learn from the seller.'
      : '- Seller communication exists: state the negotiation posture.',
    '',
    'Every "score" field is YOUR integer judgment from 0 to 100 — replace the placeholder, never echo 0.',
    'The deal score reflects property quality, market and liquidity, quick-flip economics, supported value,',
    'seller fit when known, strategy, risks and uncertainty together — never a mere average of the other scores,',
    'and a score below 10 means genuinely worthless and must be justified in the judgment.',
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

export interface ParsedPropertyLayer {
  score: number | null;
  read: string | null;
  strengths: string[];
  constraints: Array<{ title: string; why: string | null; severity: ConstraintSeverity }>;
  potential: string[];
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
}

export interface ParsedSellerLayer {
  score: number | null;
  read: string | null;
  motivation: string | null;
  priceExpectation: string | null;
  timeline: string | null;
  decisionMakers: string | null;
  objections: string[];
  negotiationPosture: string | null;
  bestApproach: string | null;
  sellerReportedFacts: Array<{ statement: string; attribution: string }>;
  followUps: string[];
}

export interface ParsedDealExtras {
  score: number | null;
  bestStrategy: { strategy: string; why: string | null } | null;
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
      read: asLine(pick(propertySource, 'read', 'propertyRead', 'summary'), 1_200),
      strengths: asLines(pick(propertySource, 'strengths'), 8),
      constraints: asConstraints(pick(propertySource, 'constraints')),
      potential: asLines(pick(propertySource, 'potential', 'propertyPotential', 'upside'), 6),
      unknowns: asQuestions(pick(propertySource, 'unknowns', 'materialUnknowns')),
      nextActions: asActions(pick(propertySource, 'nextActions', 'nextPropertyActions')),
    }
    : null;

  const marketSource = pick(parsed, 'market');
  const market: ParsedMarketLayer | null = isRecord(marketSource)
    ? {
      score: asScore(pick(marketSource, 'score')),
      read: asLine(pick(marketSource, 'read', 'marketRead', 'summary'), 1_200),
      liquidityRead: asLine(pick(marketSource, 'liquidityRead', 'liquidity'), 800),
      areaStory: asLine(pick(marketSource, 'areaStory', 'growthStory', 'area'), 1_000),
      buyerPool: asLine(pick(marketSource, 'buyerPool', 'targetBuyer', 'likelyBuyerPool'), 600),
      bestSignals: asLines(pick(marketSource, 'bestSignals', 'signals'), 6),
      risks: asLines(pick(marketSource, 'risks', 'marketRisks'), 6),
      exitImplications: asLines(pick(marketSource, 'exitImplications', 'exitMarketImplications'), 6),
      unknowns: asQuestions(pick(marketSource, 'unknowns', 'importantMarketUnknowns')),
    }
    : null;

  const sellerSource = pick(parsed, 'seller');
  const seller: ParsedSellerLayer | null = isRecord(sellerSource)
    ? {
      score: asScore(pick(sellerSource, 'score', 'workability')),
      read: asLine(pick(sellerSource, 'read', 'sellerRead', 'summary'), 1_200),
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
    }
    : null;

  const dealSource = pick(parsed, 'deal');
  const dealRecord = isRecord(dealSource) ? dealSource : null;
  const bestStrategySource = dealRecord ? pick(dealRecord, 'bestStrategy') : undefined;
  const dealExtras: ParsedDealExtras | null = dealRecord
    ? {
      score: asScore(pick(dealRecord, 'score', 'dealScore')),
      bestStrategy: isRecord(bestStrategySource)
        ? (() => {
          const strategy = asLine(pick(bestStrategySource, 'strategy', 'name', 'title'), 160);
          return strategy ? { strategy, why: asLine(pick(bestStrategySource, 'why', 'rationale'), 800) } : null;
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
