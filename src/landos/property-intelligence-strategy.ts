// Property Intelligence strategy synthesis — five approved strategies, one call.
//
// Exactly five strategies are approved. Wholesaling is NOT one of them and is
// never emitted. "Pass" is a decision on the opportunity, not a sixth strategy.
//
// The output is a decision, not five essays: each strategy carries applicability,
// the facts that support it, its blockers, effort, timeline, the value-creation
// path, risk, and the next verification step. Then exactly one recommendation is
// produced, with what would change it and the posture to take today.
//
// Pure + deterministic. No I/O.

import { APPROVED_STRATEGIES, type ApprovedStrategy } from './strategy-readiness.js';
import type {
  IdentityState,
  OpportunityPosture,
  SnapshotDueDiligenceItem,
  SnapshotRecommendation,
  SnapshotStrategy,
  SnapshotValuation,
  StrategyApplicability,
} from './property-intelligence-snapshot.js';

export interface StrategySynthesisInput {
  identityState: IdentityState;
  /** See ValuationInput.discoveryIdentityUsable. Never true for a conflict. */
  discoveryIdentityUsable?: boolean;
  /** Plain source disclosure for conditional discovery-stage underwriting. */
  identityBasis?: string | null;
  subjectAcres: number | null;
  valuation: SnapshotValuation;
  dueDiligence: SnapshotDueDiligenceItem[];
  /** Zoning district text when known. */
  zoning: string | null;
  /** True when zoning evidence was actually retrieved. */
  zoningKnown: boolean;
  /** Utilities availability was established. */
  utilitiesKnown: boolean;
  utilitiesSummary: string | null;
  /** Access verdict from the access specialist. */
  accessStatus: 'public_road_proximity' | 'private_road_only' | 'no_mapped_contact' | 'unknown';
  /** Improved / manufactured comparables retained for the Land-Home lane. */
  landHomeCompCount: number;
  landHomeSearchProof?: {
    status: 'completed' | 'blocked' | 'unavailable' | 'not_run';
    radiusMiles: number;
    timePeriodMonths: number;
    sourcesSearched: string[];
    candidatesReviewed: number;
    exclusionReasons: Array<{ reason: string; count: number }>;
  } | null;
  /** Count of accepted closed sales backing the value basis. */
  acceptedSoldCount: number;
  /** Active competition count. */
  activeListingCount: number;
  /** Blockers already known at mission level (identity, evidence, provider). */
  missionBlockers: string[];
  /** Optional evidence-backed split concepts. When absent, subdivision remains
   * a hypothesis and no lot count or net profit is invented. */
  subdivisionEvidence?: SubdivisionEvidenceInput | null;
}

export type SubdivisionCostCategory =
  | 'acquisition'
  | 'survey_engineering'
  | 'plat_approval'
  | 'soil_testing'
  | 'access_road'
  | 'utilities'
  | 'holding'
  | 'sales_marketing'
  | 'contingency';

export interface SubdivisionCostInput {
  category: SubdivisionCostCategory;
  label: string;
  low: number;
  high: number;
  basis: string;
}

export interface SubdivisionConceptInput {
  name: string;
  lotSizesAcres: number[];
  accessConfiguration: string;
  geometryBasis: string;
  ordinancePath: string;
  marketBand: string;
  grossValue: { low: number; high: number };
  costs: SubdivisionCostInput[];
  timeline: string;
  mainRisk: string;
}

export interface SubdivisionEvidenceInput {
  governingJurisdiction: string | null;
  minimumLotSize: string | null;
  minimumFrontage: string | null;
  minorSubdivisionThreshold: string | null;
  flagLotRules: string | null;
  sharedAccessRules: string | null;
  privateRoadStandards: string | null;
  legalMultiLotAccess: boolean | null;
  physicalMultiLotAccess: boolean | null;
  observedRoadNeckFeet?: number | null;
  concepts: SubdivisionConceptInput[];
}

export interface SubdivisionConceptEconomics extends SubdivisionConceptInput {
  totalCosts: { low: number; high: number } | null;
  estimatedNetProfit: { low: number; high: number } | null;
  missingCostCategories: SubdivisionCostCategory[];
  fullyModeled: boolean;
}

export interface SubdivisionEconomics {
  status: 'viable' | 'hypothesis' | 'insufficient';
  highestUpsideHypothesis: 'Subdivision';
  immediateGatingIssue: string;
  fallbackStrategy: 'Quick Flip';
  ruleAndAccessGaps: string[];
  concepts: SubdivisionConceptEconomics[];
}

const REQUIRED_SUBDIVISION_COSTS: readonly SubdivisionCostCategory[] = [
  'acquisition',
  'survey_engineering',
  'plat_approval',
  'soil_testing',
  'access_road',
  'utilities',
  'holding',
  'sales_marketing',
  'contingency',
];

/** Cost and gate validator. "Net profit" is emitted only when every required
 * cost category is present and the gross/cost ranges are internally valid. */
export function buildSubdivisionEconomics(input: SubdivisionEvidenceInput | null | undefined): SubdivisionEconomics {
  const accessQuestion = 'Can the road connection legally and physically serve multiple lots?';
  if (!input) {
    return {
      status: 'insufficient',
      highestUpsideHypothesis: 'Subdivision',
      immediateGatingIssue: accessQuestion,
      fallbackStrategy: 'Quick Flip',
      ruleAndAccessGaps: ['No ordinance, access, geometry, market-band or cost concept was supplied.'],
      concepts: [],
    };
  }

  const gaps: string[] = [];
  if (!input.governingJurisdiction) gaps.push('Governing jurisdiction is unresolved.');
  if (!input.minimumLotSize) gaps.push('Minimum lot size is unresolved.');
  if (!input.minimumFrontage) gaps.push('Minimum frontage is unresolved.');
  if (!input.minorSubdivisionThreshold) gaps.push('Minor-subdivision threshold is unresolved.');
  if (!input.flagLotRules) gaps.push('Flag-lot rules are unresolved.');
  if (!input.sharedAccessRules) gaps.push('Shared-access rules are unresolved.');
  if (!input.privateRoadStandards) gaps.push('Private-road standards are unresolved.');
  if (input.legalMultiLotAccess !== true) gaps.push('Legal multi-lot access is not established.');
  if (input.physicalMultiLotAccess !== true) gaps.push('Physical multi-lot access is not established.');

  const concepts = input.concepts.map((concept): SubdivisionConceptEconomics => {
    const present = new Set(concept.costs.map((cost) => cost.category));
    const missingCostCategories = REQUIRED_SUBDIVISION_COSTS.filter((category) => !present.has(category));
    const validRanges = concept.grossValue.low >= 0
      && concept.grossValue.high >= concept.grossValue.low
      && concept.costs.every((cost) =>
        cost.low >= 0 && cost.high >= cost.low && cost.basis.trim().length > 0);
    const totalCosts = missingCostCategories.length === 0 && validRanges
      ? {
          low: concept.costs.reduce((sum, cost) => sum + cost.low, 0),
          high: concept.costs.reduce((sum, cost) => sum + cost.high, 0),
        }
      : null;
    return {
      ...concept,
      totalCosts,
      estimatedNetProfit: totalCosts
        ? {
            low: concept.grossValue.low - totalCosts.high,
            high: concept.grossValue.high - totalCosts.low,
          }
        : null,
      missingCostCategories,
      fullyModeled: totalCosts != null,
    };
  });

  const fullyModeled = concepts.filter((concept) => concept.fullyModeled);
  const gatesClear = gaps.length === 0;
  return {
    status: gatesClear && fullyModeled.length > 0
      ? 'viable'
      : concepts.length > 0
        ? 'hypothesis'
        : 'insufficient',
    highestUpsideHypothesis: 'Subdivision',
    immediateGatingIssue: input.legalMultiLotAccess !== true || input.physicalMultiLotAccess !== true
      ? `${accessQuestion}${input.observedRoadNeckFeet != null ? ` Observed road neck: approximately ${input.observedRoadNeckFeet} feet.` : ''}`
      : 'Access is supported; confirm final ordinance interpretation and engineered layout before entitlement spend.',
    fallbackStrategy: 'Quick Flip',
    ruleAndAccessGaps: gaps,
    concepts,
  };
}

function ddItem(items: SnapshotDueDiligenceItem[], key: string): SnapshotDueDiligenceItem | null {
  return items.find((item) => item.key === key) ?? null;
}

function unsupportedPhysicalConclusion(item: SnapshotDueDiligenceItem): boolean {
  const text = `${item.key} ${item.label} ${item.headline} ${item.detail ?? ''} ${item.missing.join(' ')}`;
  return /\bterrain|slope|buildab|usable acreage|septic|perc|soil\b/i.test(text)
    && (item.grade === 'unresolved_question'
      || item.grade === 'unavailable_public_record'
      || /\bunsupported|unverified|questionable|not established|insufficient evidence|single (?:point|map unit)|point sample|preliminary only|cannot be relied|missing\b/i.test(text));
}

function hardConstraint(items: SnapshotDueDiligenceItem[]): string[] {
  return items
    .filter((item) => item.verdict === 'risk' && !unsupportedPhysicalConclusion(item))
    .map((item) => `${item.label}: ${item.headline}`);
}

function unknownLanes(items: SnapshotDueDiligenceItem[]): string[] {
  return items.filter((item) => item.verdict === 'unknown').map((item) => item.label);
}

/**
 * Applicability ladder used by every strategy so the five stay consistent:
 *   blocked        — a hard prerequisite is missing or unresolved.
 *   conditional    — plausible, but a named condition must be proven first.
 *   applicable     — the evidence in hand supports pursuing it now.
 *   not_applicable — a retained fact rules it out.
 */
function worst(a: StrategyApplicability, b: StrategyApplicability): StrategyApplicability {
  const order: StrategyApplicability[] = ['not_applicable', 'blocked', 'conditional', 'applicable'];
  return order.indexOf(a) <= order.indexOf(b) ? a : b;
}

export function buildPropertyIntelligenceStrategies(input: StrategySynthesisInput): {
  strategies: SnapshotStrategy[];
  recommendation: SnapshotRecommendation;
} {
  const identityConfirmed = input.identityState === 'confirmed';
  const conditionalIdentity = input.identityState === 'provisional'
    && input.discoveryIdentityUsable === true;
  const identityUsable = identityConfirmed || conditionalIdentity;
  const priceable = input.valuation.priceable;
  const risks = hardConstraint(input.dueDiligence);
  const unknowns = unknownLanes(input.dueDiligence);
  const access = ddItem(input.dueDiligence, 'access');
  const wetlands = ddItem(input.dueDiligence, 'wetlands');
  const flood = ddItem(input.dueDiligence, 'flood');
  const septic = ddItem(input.dueDiligence, 'septic');

  const identityBlocker = identityUsable
    ? null
    : `Parcel identity is ${input.identityState}; no strategy may be pursued on an unidentified parcel.`;
  const priceBlocker = priceable
    ? null
    : input.valuation.notPriceableReason ?? 'No defensible value basis exists yet.';

  const baseBlockers = [identityBlocker, priceBlocker].filter((v): v is string => v != null);

  const accessOk = input.accessStatus === 'public_road_proximity';
  const accessUnknown = input.accessStatus === 'unknown' || input.accessStatus === 'no_mapped_contact';
  const acres = input.subjectAcres;
  const subdivisionEconomics = buildSubdivisionEconomics(input.subdivisionEvidence);

  const strategies: SnapshotStrategy[] = [];
  const qualifyForIdentity = (applicability: StrategyApplicability): StrategyApplicability =>
    conditionalIdentity && applicability === 'applicable' ? 'conditional' : applicability;

  // ── 1. Quick Flip (buy at a discount, resell as-is) ───────────────────────
  {
    const blockers = [...baseBlockers];
    if (accessUnknown) blockers.push('Legal and physical access is not established; an inaccessible parcel does not resell quickly.');
    let applicability: StrategyApplicability = blockers.length ? 'blocked' : 'applicable';
    if (!blockers.length && input.acceptedSoldCount < 3) applicability = 'conditional';
    if (!blockers.length && risks.length > 0) applicability = worst(applicability, 'conditional');
    strategies.push({
      strategy: 'Quick Flip',
      applicability: qualifyForIdentity(applicability),
      supportingFacts: [
        priceable && input.valuation.dispositionRange
          ? `A disposition band of $${input.valuation.dispositionRange.low.toLocaleString()}–$${input.valuation.dispositionRange.high.toLocaleString()} exists against a retail band of $${input.valuation.likelyRetail!.low.toLocaleString()}–$${input.valuation.likelyRetail!.high.toLocaleString()}.`
          : 'No priced spread is available yet.',
        `${input.acceptedSoldCount} accepted closed sale(s) and ${input.activeListingCount} active listing(s) define the local resale picture.`,
        accessOk ? (access?.headline ?? 'Public road proximity is mapped.') : 'Access is not confirmed.',
      ].filter(Boolean),
      blockers,
      effort: 'Low. No entitlement, construction or subdivision work; the value comes from the acquisition price.',
      timeline: input.activeListingCount >= 5 ? '30–90 days to resell in a market with visible competition.' : '60–180 days; thin visible competition means slower absorption.',
      valueCreationPath: 'Acquire meaningfully below the retail band and resell as-is to a retail land buyer or another investor.',
      risk: risks.length ? `Resale speed is exposed to: ${risks.join('; ')}.` : 'Primary risk is overpaying relative to a thin comp band.',
      nextVerificationStep: identityConfirmed
        ? (priceable ? 'Verify marketable title and confirm the acquisition price sits below the disposition band before offering.' : 'Establish the value basis before any offer is calculated.')
        : identityUsable
          ? 'Use the retained parcel match for discovery and retry the county parcel source during normal offer diligence.'
          : 'Confirm the parcel against the official record before any offer work.',
    });
  }

  // ── 2. Novation or Double Close ──────────────────────────────────────────
  {
    const blockers = [...baseBlockers];
    if (!accessOk && !accessUnknown) blockers.push('Private-road-only access narrows the retail buyer pool a novation depends on.');
    let applicability: StrategyApplicability = blockers.length ? 'blocked' : 'conditional';
    if (!blockers.length && input.activeListingCount >= 3 && input.acceptedSoldCount >= 3) applicability = 'applicable';
    strategies.push({
      strategy: 'Novation or Double Close',
      applicability: qualifyForIdentity(applicability),
      supportingFacts: [
        priceable
          ? `A retail band of $${input.valuation.likelyRetail!.low.toLocaleString()}–$${input.valuation.likelyRetail!.high.toLocaleString()} gives the seller a credible upside story.`
          : 'No retail band exists to anchor a seller conversation.',
        `${input.activeListingCount} active listing(s) indicate ${input.activeListingCount >= 3 ? 'a functioning retail market' : 'limited visible retail demand'}.`,
      ],
      blockers,
      effort: 'Medium. Requires a cooperative seller, a listing or marketing plan, and clean closing mechanics.',
      timeline: '60–150 days from agreement to funded close.',
      valueCreationPath: 'Capture the gap between what the seller will accept and the retail band without a long hold, by selling into the retail market before or at closing.',
      risk: 'Depends entirely on retail absorption. If the parcel does not sell, the structure collapses and the relationship with the seller is damaged.',
      nextVerificationStep: 'Confirm the seller will cooperate with a marketed sale and that title supports a simultaneous or back-to-back close.',
    });
  }

  // ── 3. Subdivide or Minor Split ──────────────────────────────────────────
  {
    const blockers = [...baseBlockers];
    if (!input.zoningKnown) blockers.push('Zoning evidence has not established that a split is allowed.');
    if (acres == null) blockers.push('The governing acreage is unknown.');
    blockers.push(...subdivisionEconomics.ruleAndAccessGaps);
    if (!subdivisionEconomics.concepts.length) {
      blockers.push('No geometry-, access- and market-band-supported lot concept has been modeled.');
    } else if (!subdivisionEconomics.concepts.some((concept) => concept.fullyModeled)) {
      blockers.push('No concept includes acquisition plus every required project-cost category, so net profit is not supportable.');
    }
    let applicability: StrategyApplicability = blockers.length ? 'blocked' : 'conditional';
    if (acres != null && acres < 2) {
      applicability = 'not_applicable';
    } else if (!blockers.length && subdivisionEconomics.status === 'viable') {
      applicability = 'applicable';
    }
    const modeled = subdivisionEconomics.concepts.find((concept) => concept.fullyModeled) ?? null;
    const splitStrategy: SnapshotStrategy & { subdivisionEconomics: SubdivisionEconomics } = {
      strategy: 'Subdivide or Minor Split',
      applicability: qualifyForIdentity(applicability),
      supportingFacts: [
        acres != null ? `${acres.toFixed(2)} governing acres.` : 'Acreage unresolved.',
        input.zoningKnown && input.zoning ? `Zoning: ${input.zoning}.` : 'Zoning not established.',
        septic?.headline ? `Septic outlook: ${septic.headline}` : 'Septic suitability not established.',
        `Highest-upside hypothesis: subdivision. Immediate gate: ${subdivisionEconomics.immediateGatingIssue}`,
        modeled?.estimatedNetProfit
          ? `${modeled.name}: modeled net profit $${modeled.estimatedNetProfit.low.toLocaleString()}–$${modeled.estimatedNetProfit.high.toLocaleString()} after all required project-cost categories.`
          : 'No net-profit figure is stated until acquisition, survey/engineering, approval, soils, access/road, utilities, holding, sales/marketing and contingency are all modeled.',
      ],
      blockers,
      effort: 'High. Survey, county minor-plat process, possible road/utility extension, and per-lot septic suitability.',
      timeline: modeled?.timeline ?? '6–18 months depending on whether the county allows a minor plat or requires full subdivision review.',
      valueCreationPath: 'Convert one larger parcel into multiple smaller lots that each sell at the higher small-parcel price per acre.',
      risk: acres != null && acres < 5
        ? 'The parcel may be too small for the split to clear minimum lot size after setbacks and access.'
        : modeled?.mainRisk ?? 'Approval risk, survey and infrastructure cost, and per-lot septic failure can erase the spread.',
      nextVerificationStep: subdivisionEconomics.immediateGatingIssue,
      subdivisionEconomics,
    };
    strategies.push(splitStrategy);
  }

  // ── 4. Land-Home Package ─────────────────────────────────────────────────
  {
    const blockers = [...baseBlockers];
    if (!input.utilitiesKnown) blockers.push('Utility availability is not established, and a home placement depends on power and water.');
    if (septic?.verdict === 'risk' && !unsupportedPhysicalConclusion(septic)) {
      blockers.push(`Septic suitability is a risk: ${septic.headline}`);
    }
    if (!accessOk) blockers.push('A home package requires established access for delivery, financing and occupancy.');
    let applicability: StrategyApplicability = blockers.length ? 'blocked' : 'conditional';
    if (!blockers.length && input.landHomeCompCount >= 2) applicability = 'applicable';
    strategies.push({
      strategy: 'Land-Home Package',
      applicability: qualifyForIdentity(applicability),
      supportingFacts: [
        `${input.landHomeCompCount} improved or manufactured-home sale(s) retained for this lane only; they never establish vacant-land value.`,
        input.landHomeSearchProof
          ? `Manufactured-home search ${input.landHomeSearchProof.status}: ${input.landHomeSearchProof.radiusMiles}-mile radius, ${input.landHomeSearchProof.timePeriodMonths}-month period, ${input.landHomeSearchProof.sourcesSearched.join(' + ')}, ${input.landHomeSearchProof.candidatesReviewed} candidate(s) reviewed.${input.landHomeSearchProof.exclusionReasons.length ? ` Exclusions: ${input.landHomeSearchProof.exclusionReasons.map((item) => `${item.count} ${item.reason}`).join('; ')}.` : ''}`
          : 'Manufactured-home search proof was not supplied to strategy synthesis.',
        input.utilitiesSummary ?? 'Utility availability not established.',
        septic?.headline ?? 'Septic suitability not established.',
      ],
      blockers,
      effort: 'High. Home sourcing, site work, septic and utility installation, and buyer financing coordination.',
      timeline: '4–12 months from acquisition to a closed land-home sale.',
      valueCreationPath: 'Pair the parcel with a manufactured or modular home so the exit price reflects a finished residence rather than raw land.',
      risk: 'Capital intensive. Septic failure, utility cost, or a buyer financing fallout each strand the investment.',
      nextVerificationStep: 'Obtain a soil/perc evaluation and written utility availability before committing capital to a home.',
    });
  }

  // ── 5. Improvement Then Flip ─────────────────────────────────────────────
  {
    const blockers = [...baseBlockers];
    if (accessUnknown) blockers.push('The improvement that would create value cannot be scoped until access is established.');
    let applicability: StrategyApplicability = blockers.length ? 'blocked' : 'conditional';
    const improvable = [
      accessOk ? null : 'access',
      input.utilitiesKnown ? null : 'utilities',
      wetlands?.verdict === 'caution' || wetlands?.verdict === 'risk' ? 'wetland delineation' : null,
      flood?.verdict === 'caution' || flood?.verdict === 'risk' ? 'flood documentation' : null,
    ].filter((v): v is string => v != null);
    if (!blockers.length && improvable.length > 0) applicability = 'applicable';
    strategies.push({
      strategy: 'Improvement Then Flip',
      applicability: qualifyForIdentity(applicability),
      supportingFacts: [
        improvable.length ? `Discoverable value gaps a buyer would discount for: ${improvable.join(', ')}.` : 'No obvious improvable defect was identified, which limits the upside of this path.',
        priceable ? `Retail band $${input.valuation.likelyRetail!.low.toLocaleString()}–$${input.valuation.likelyRetail!.high.toLocaleString()} sets the ceiling the improvement has to beat.` : 'No retail band to size the improvement against.',
      ],
      blockers,
      effort: 'Medium. Targeted spend such as survey, clearing, a driveway/culvert, a perc test, or an easement cure.',
      timeline: '3–9 months including the resale period.',
      valueCreationPath: 'Spend selectively to remove the specific unknown or defect the market is discounting, then resell into the retail band.',
      risk: 'The improvement can cost more than the discount it removes, especially access and septic work.',
      nextVerificationStep: improvable.length
        ? `Price the specific cure for: ${improvable[0]}. Compare it to the discount the market is applying.`
        : 'Identify a concrete, priceable defect before assuming this path adds value.',
    });
  }

  // Guardrail: exactly the five approved strategies, in the approved order.
  const ordered = APPROVED_STRATEGIES.map((name: ApprovedStrategy) => strategies.find((s) => s.strategy === name)!);

  const recommendation = recommend(ordered, input, baseBlockers, risks, unknowns);
  return { strategies: ordered, recommendation };
}

function recommend(
  strategies: SnapshotStrategy[],
  input: StrategySynthesisInput,
  baseBlockers: string[],
  risks: string[],
  unknowns: string[],
): SnapshotRecommendation {
  const identityConfirmed = input.identityState === 'confirmed';
  const conditionalIdentity = input.identityState === 'provisional'
    && input.discoveryIdentityUsable === true;
  const identityUsable = identityConfirmed || conditionalIdentity;

  if (!identityUsable) {
    const whatWouldChangeIt = ['A confirmed official parcel match (APN, owner, acreage and situs agreeing on the county or state parcel layer).'];
    return withOperatorAnswers({
      preferredStrategy: null,
      why: `Parcel identity is ${input.identityState}. No strategy is recommended on a parcel that has not been identified against an official record.`,
      whatWouldChangeIt,
      posture: 'hold',
      postureWhy: 'Hold. Identity work is the only productive next step; every downstream conclusion inherits this gap.',
    }, input, strategies, risks, unknowns, 'undetermined', 'undetermined');
  }

  if (!input.valuation.priceable) {
    const whatWouldChangeIt = [
      input.valuation.nextActionToPrice ?? 'An accepted vacant-land closed sale in the subject market.',
      'Any local closed land sale the operator can supply directly.',
    ];
    return withOperatorAnswers({
      preferredStrategy: null,
      why: `No strategy can be recommended without a value basis. ${input.valuation.notPriceableReason ?? ''}`.trim(),
      whatWouldChangeIt,
      posture: 'hold',
      postureWhy: 'Hold. The parcel is identified but not priceable, so an offer would be a guess.',
    }, input, strategies, risks, unknowns, 'undetermined', 'undetermined');
  }

  const rank: Record<StrategyApplicability, number> = { applicable: 0, conditional: 1, blocked: 2, not_applicable: 3 };
  const ranked = [...strategies].sort((a, b) => rank[a.applicability] - rank[b.applicability] || a.blockers.length - b.blockers.length);
  const split = strategies.find((strategy) => strategy.strategy === 'Subdivide or Minor Split') as
    | (SnapshotStrategy & { subdivisionEconomics?: SubdivisionEconomics })
    | undefined;
  const splitHasPositiveModeledUpside = split?.subdivisionEconomics?.status === 'viable'
    && split.subdivisionEconomics.concepts.some((concept) =>
      concept.estimatedNetProfit != null && concept.estimatedNetProfit.high > 0);
  // A fully rule/access/cost-gated, profitable split is the supported
  // highest-upside path. A hypothesis with an open gate never outranks Quick
  // Flip merely because division arithmetic looks attractive.
  const winner = split?.applicability === 'applicable' && splitHasPositiveModeledUpside
    ? split
    : ranked[0];

  if (winner.applicability === 'blocked' || winner.applicability === 'not_applicable') {
    const whatWouldChangeIt = [...new Set(strategies.flatMap((s) => s.blockers))].slice(0, 5);
    return withOperatorAnswers({
      preferredStrategy: null,
      why: 'Every approved strategy is currently blocked. The blockers, not the strategy choice, are the work.',
      whatWouldChangeIt,
      posture: 'hold',
      postureWhy: 'Hold. Clear the named blockers before committing to a path.',
    }, input, strategies, risks, unknowns, 'no', 'no');
  }

  const runnerUp = winner.strategy === 'Subdivide or Minor Split'
    ? strategies.find((strategy) => strategy.strategy === 'Quick Flip') ?? ranked[1]
    : ranked.find((strategy) => strategy !== winner) ?? ranked[1];
  const posture: OpportunityPosture = conditionalIdentity || risks.length >= 3
    ? 'renegotiate'
    : winner.applicability === 'applicable' && risks.length === 0
      ? 'pursue'
      : 'renegotiate';

  const postureWhy = conditionalIdentity
    ? 'Renegotiate. The five strategies are usable from the retained discovery-stage parcel match; keep the acquisition price conservative while title, acreage and access are confirmed during normal offer diligence.'
    : posture === 'pursue'
    ? `Pursue. ${winner.strategy} is supported by the retained evidence, no hard risk was found, and the value basis is ${input.valuation.confidence} confidence.`
    : `Renegotiate. ${winner.strategy} is the best available path, but ${risks.length} mapped risk(s) should move the acquisition price before commitment: ${risks.slice(0, 3).join('; ')}.`;

  const whatWouldChangeIt = [
    ...(conditionalIdentity
      ? [`Title, acreage and access diligence would strengthen the retained parcel match${input.identityBasis?.trim() ? ` (${input.identityBasis.trim()})` : ''}.`]
      : []),
    ...winner.blockers,
    ...(runnerUp ? [`${runnerUp.strategy} would become preferred if: ${runnerUp.blockers[0] ?? 'its conditional evidence is proven'}.`] : []),
    ...(unknowns.length ? [`Resolving ${unknowns.slice(0, 3).join(', ')} could change the ranking.`] : []),
    ...(input.valuation.confidence === 'low' ? ['A stronger comp set would raise or lower the value band materially.'] : []),
  ];

  return withOperatorAnswers({
    preferredStrategy: winner.strategy,
    why: `${winner.valueCreationPath} ${winner.supportingFacts[0] ?? ''}`.trim(),
    whatWouldChangeIt: [...new Set(whatWouldChangeIt)].filter(Boolean).slice(0, 6),
    posture,
    postureWhy,
  }, input, strategies, risks, unknowns, posture === 'pursue' ? 'yes' : 'with_conditions',
  posture === 'pursue' && winner.applicability === 'applicable' ? 'yes' : 'conditional');
}

function withOperatorAnswers(
  recommendation: Pick<SnapshotRecommendation, 'preferredStrategy' | 'why' | 'whatWouldChangeIt' | 'posture' | 'postureWhy'>,
  input: StrategySynthesisInput,
  strategies: SnapshotStrategy[],
  risks: string[],
  unknowns: string[],
  shouldPursue: NonNullable<SnapshotRecommendation['shouldPursue']>,
  juiceAnswer: NonNullable<SnapshotRecommendation['juiceWorthSqueeze']>['answer'],
): SnapshotRecommendation {
  const valuation = input.valuation;
  const range = valuation.priceable ? valuation.range : null;
  const workingValue = valuation.priceable && range
    ? Math.round((valuation.workingValue ?? ((range.low + range.high) / 2)) / 500) * 500
    : null;
  const worth = range && workingValue != null
    ? { low: range.low, high: range.high, workingValue }
    : null;
  const targetBuyRange = workingValue != null
    ? {
        low: Math.round((workingValue * 0.4) / 500) * 500,
        high: Math.round((workingValue * 0.6) / 500) * 500,
        basis: `40-60% of the $${workingValue.toLocaleString()} working value. Pre-call acquisition guidance, not an approved offer.`,
      }
    : null;
  const best = recommendation.preferredStrategy
    ? strategies.find((strategy) => strategy.strategy === recommendation.preferredStrategy) ?? null
    : null;
  const dealKillers = [...new Set([...risks, ...input.missionBlockers])].filter(Boolean).slice(0, 8);
  const nextConfirmations = [...new Set([
    ...(best ? [best.nextVerificationStep] : []),
    ...unknowns.map((lane) => `Confirm ${lane.toLowerCase()}.`),
    ...valuation.materialGaps,
    ...recommendation.whatWouldChangeIt,
  ])].filter(Boolean).slice(0, 8);

  const juiceWhy = juiceAnswer === 'yes'
    ? `${best?.strategy ?? 'The preferred exit'} is applicable on the current evidence, a supported value range exists, and no deal-killer-class risk is open.`
    : juiceAnswer === 'conditional'
      ? `${best?.strategy ?? 'The best available exit'} has a measurable value basis, but the named risks and confirmations must clear before the effort is justified.`
      : juiceAnswer === 'no'
        ? 'Every approved exit is blocked or not applicable on the current evidence, so the expected upside does not justify proceeding.'
        : 'The parcel does not yet have enough confirmed value and exit evidence to judge the effort against the likely upside.';

  return {
    ...recommendation,
    shouldPursue,
    worth,
    targetBuyRange,
    bestExit: recommendation.preferredStrategy,
    dealKillers,
    nextConfirmations,
    juiceWorthSqueeze: { answer: juiceAnswer, why: juiceWhy },
  };
}
