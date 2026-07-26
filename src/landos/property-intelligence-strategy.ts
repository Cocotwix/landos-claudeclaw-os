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
  /** Count of accepted closed sales backing the value basis. */
  acceptedSoldCount: number;
  /** Active competition count. */
  activeListingCount: number;
  /** Blockers already known at mission level (identity, evidence, provider). */
  missionBlockers: string[];
}

function ddItem(items: SnapshotDueDiligenceItem[], key: string): SnapshotDueDiligenceItem | null {
  return items.find((item) => item.key === key) ?? null;
}

function hardConstraint(items: SnapshotDueDiligenceItem[]): string[] {
  return items.filter((item) => item.verdict === 'risk').map((item) => `${item.label}: ${item.headline}`);
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
  const priceable = input.valuation.priceable;
  const risks = hardConstraint(input.dueDiligence);
  const unknowns = unknownLanes(input.dueDiligence);
  const access = ddItem(input.dueDiligence, 'access');
  const wetlands = ddItem(input.dueDiligence, 'wetlands');
  const flood = ddItem(input.dueDiligence, 'flood');
  const septic = ddItem(input.dueDiligence, 'septic');

  const identityBlocker = identityConfirmed
    ? null
    : `Parcel identity is ${input.identityState}; no strategy may be pursued on an unidentified parcel.`;
  const priceBlocker = priceable
    ? null
    : input.valuation.notPriceableReason ?? 'No defensible value basis exists yet.';

  const baseBlockers = [identityBlocker, priceBlocker].filter((v): v is string => v != null);

  const accessOk = input.accessStatus === 'public_road_proximity';
  const accessUnknown = input.accessStatus === 'unknown' || input.accessStatus === 'no_mapped_contact';
  const acres = input.subjectAcres;

  const strategies: SnapshotStrategy[] = [];

  // ── 1. Cash Flip (buy at a discount, resell as-is) ────────────────────────
  {
    const blockers = [...baseBlockers];
    if (accessUnknown) blockers.push('Legal and physical access is not established; an inaccessible parcel does not resell quickly.');
    let applicability: StrategyApplicability = blockers.length ? 'blocked' : 'applicable';
    if (!blockers.length && input.acceptedSoldCount < 3) applicability = 'conditional';
    if (!blockers.length && risks.length > 0) applicability = worst(applicability, 'conditional');
    strategies.push({
      strategy: 'Cash Flip',
      applicability,
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
      applicability,
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
    if (!input.zoningKnown) blockers.push('Zoning and the minimum lot size that governs a split are not established.');
    if (acres == null) blockers.push('The governing acreage is unknown, so no split arithmetic is possible.');
    if (!accessOk) blockers.push('A split requires frontage or legal access for each resulting lot; access is not confirmed.');
    let applicability: StrategyApplicability = blockers.length ? 'blocked' : 'conditional';
    if (acres != null && acres < 2) {
      applicability = 'not_applicable';
    } else if (!blockers.length && acres != null && acres >= 5) {
      applicability = 'conditional';
    }
    strategies.push({
      strategy: 'Subdivide or Minor Split',
      applicability,
      supportingFacts: [
        acres != null ? `${acres.toFixed(2)} governing acres.` : 'Acreage unresolved.',
        input.zoningKnown && input.zoning ? `Zoning: ${input.zoning}.` : 'Zoning not established.',
        septic?.headline ? `Septic outlook: ${septic.headline}` : 'Septic suitability not established.',
      ],
      blockers,
      effort: 'High. Survey, county minor-plat process, possible road/utility extension, and per-lot septic suitability.',
      timeline: '6–18 months depending on whether the county allows a minor plat or requires full subdivision review.',
      valueCreationPath: 'Convert one larger parcel into multiple smaller lots that each sell at the higher small-parcel price per acre.',
      risk: acres != null && acres < 5
        ? 'The parcel may be too small for the split to clear minimum lot size after setbacks and access.'
        : 'Approval risk, survey and infrastructure cost, and per-lot septic failure can erase the spread.',
      nextVerificationStep: 'Confirm the minimum lot size, frontage requirement and minor-plat path with the county planning office.',
    });
  }

  // ── 4. Land-Home Package ─────────────────────────────────────────────────
  {
    const blockers = [...baseBlockers];
    if (!input.utilitiesKnown) blockers.push('Utility availability is not established, and a home placement depends on power and water.');
    if (septic?.verdict === 'risk') blockers.push(`Septic suitability is a risk: ${septic.headline}`);
    if (!accessOk) blockers.push('A home package requires established access for delivery, financing and occupancy.');
    let applicability: StrategyApplicability = blockers.length ? 'blocked' : 'conditional';
    if (!blockers.length && input.landHomeCompCount >= 2) applicability = 'applicable';
    strategies.push({
      strategy: 'Land-Home Package',
      applicability,
      supportingFacts: [
        `${input.landHomeCompCount} improved or manufactured-home sale(s) retained for this lane only; they never establish vacant-land value.`,
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
      applicability,
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

  if (!identityConfirmed) {
    return {
      preferredStrategy: null,
      why: `Parcel identity is ${input.identityState}. No strategy is recommended on a parcel that has not been identified against an official record.`,
      whatWouldChangeIt: ['A confirmed official parcel match (APN, owner, acreage and situs agreeing on the county or state parcel layer).'],
      posture: 'hold',
      postureWhy: 'Hold. Identity work is the only productive next step; every downstream conclusion inherits this gap.',
    };
  }

  if (!input.valuation.priceable) {
    return {
      preferredStrategy: null,
      why: `No strategy can be recommended without a value basis. ${input.valuation.notPriceableReason ?? ''}`.trim(),
      whatWouldChangeIt: [
        input.valuation.nextActionToPrice ?? 'An accepted vacant-land closed sale in the subject market.',
        'Any local closed land sale the operator can supply directly.',
      ],
      posture: 'hold',
      postureWhy: 'Hold. The parcel is identified but not priceable, so an offer would be a guess.',
    };
  }

  const rank: Record<StrategyApplicability, number> = { applicable: 0, conditional: 1, blocked: 2, not_applicable: 3 };
  const ranked = [...strategies].sort((a, b) => rank[a.applicability] - rank[b.applicability] || a.blockers.length - b.blockers.length);
  const winner = ranked[0];

  if (winner.applicability === 'blocked' || winner.applicability === 'not_applicable') {
    return {
      preferredStrategy: null,
      why: 'Every approved strategy is currently blocked. The blockers, not the strategy choice, are the work.',
      whatWouldChangeIt: [...new Set(strategies.flatMap((s) => s.blockers))].slice(0, 5),
      posture: 'hold',
      postureWhy: 'Hold. Clear the named blockers before committing to a path.',
    };
  }

  const runnerUp = ranked[1];
  const posture: OpportunityPosture = risks.length >= 3
    ? 'renegotiate'
    : winner.applicability === 'applicable' && risks.length === 0
      ? 'pursue'
      : 'renegotiate';

  const postureWhy = posture === 'pursue'
    ? `Pursue. ${winner.strategy} is supported by the retained evidence, no hard risk was found, and the value basis is ${input.valuation.confidence} confidence.`
    : `Renegotiate. ${winner.strategy} is the best available path, but ${risks.length} mapped risk(s) should move the acquisition price before commitment: ${risks.slice(0, 3).join('; ')}.`;

  const whatWouldChangeIt = [
    ...winner.blockers,
    ...(runnerUp ? [`${runnerUp.strategy} would become preferred if: ${runnerUp.blockers[0] ?? 'its conditional evidence is proven'}.`] : []),
    ...(unknowns.length ? [`Resolving ${unknowns.slice(0, 3).join(', ')} could change the ranking.`] : []),
    ...(input.valuation.confidence === 'low' ? ['A stronger comp set would raise or lower the value band materially.'] : []),
  ];

  return {
    preferredStrategy: winner.strategy,
    why: `${winner.valueCreationPath} ${winner.supportingFacts[0] ?? ''}`.trim(),
    whatWouldChangeIt: [...new Set(whatWouldChangeIt)].filter(Boolean).slice(0, 6),
    posture,
    postureWhy,
  };
}
