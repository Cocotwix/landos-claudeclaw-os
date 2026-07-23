// Strategy Readiness — ONE shared record for the five approved strategies.
//
// Every tab (Overview, Strategy, Seller, reports) consumes this record so
// strategy states can never differ between tabs. Exactly five approved
// strategies exist; "Pass" is a DECISION, not a strategy; "Hold" is not an
// acquisition strategy. Missing evidence means BLOCKED (research continues),
// never automatically "not viable".
//
// The pricing gate lives here: no winner, runner-up, pursue recommendation,
// offer range, preliminary value, or strategy economics may be shown until
// pricingAllowed is true (at least one usable validated sold comp + confirmed
// parcel + a stable acreage basis). Asking listings never gate sold-comp FMV.
//
// Pure + deterministic. No I/O.

export const APPROVED_STRATEGIES = [
  'Cash Flip',
  'Novation or Double Close',
  'Subdivide or Minor Split',
  'Land-Home Package',
  'Improvement Then Flip',
] as const;

export type ApprovedStrategy = (typeof APPROVED_STRATEGIES)[number];
export type StrategyStatus = 'blocked' | 'provisional' | 'viable' | 'weak' | 'not_viable';

export interface StrategyReadinessEntry {
  strategy: ApprovedStrategy;
  status: StrategyStatus;
  why: string;
  blockers: string[];
  requiredEvidence: string[];
}

export type OperatorDecision = 'continue_research' | 'tyler_review' | 'archive';

export interface StrategyReadinessRecord {
  strategies: StrategyReadinessEntry[];
  /** True only when a defensible value basis exists — gates ALL pricing UI. */
  pricingAllowed: boolean;
  pricingBlockers: string[];
  /** The useful decision today (Pass/archive is a decision, not a strategy). */
  decision: OperatorDecision;
  decisionWhy: string;
  summaryLine: string;
}

export interface StrategyReadinessInputs {
  parcelVerified: boolean;
  /** From the unique comp registry — the ONLY comp counts that matter. */
  validatedSoldComps: number;
  /** Count in the governing LandPortal FMV set. */
  valuationCompCount?: number;
  valuationReady: boolean;
  valuationConflict: boolean;
  acres: number | null;
  acreageConflict: boolean;
  /** Physical screen verdicts from the reconciled operator record. */
  wetlandsPct: number | null;
  floodSfhaPct: number | null;
  septicOutlook: 'favorable' | 'mixed' | 'poor' | 'unknown';
  accessStatus: 'public_road_proximity' | 'private_road_only' | 'no_mapped_contact' | 'unknown';
  legalAccessConfirmed: boolean;
  zoningKnown: boolean;
  utilitiesKnown: boolean;
  /** Improvement present on the parcel (building area / land-use)? */
  improved: boolean;
  hardRisks?: string[] | null;
  /** Trust/estate ownership with unresolved selling authority. */
  trustAuthorityUnresolved?: boolean;
  /** Legal acreage disputed (assessed vs mapped) — survey/plat required. */
  legalAcreageUnresolved?: boolean;
  /** True when a supported thin-market local acreage cluster provides an adequate closed-sale basis. */
  thinMarketClusterSupported?: boolean;
  /** A gate the caller already computed (e.g. the operator record's) — used
   *  verbatim so two surfaces can never disagree about whether pricing is open. */
  prebuiltGate?: PricingGate | null;
}

function entry(strategy: ApprovedStrategy, status: StrategyStatus, why: string, blockers: string[], requiredEvidence: string[]): StrategyReadinessEntry {
  // One fact, one blocker: the record itself never carries the same fact in
  // variant wordings (every renderer — tabs, downloads, RAG — prints this
  // array verbatim).
  return { strategy, status, why, blockers: [...new Set(blockers)], requiredEvidence };
}

// ── The ONE pricing gate ──────────────────────────────────────────────────────
// Every surface that decides whether a dollar figure may exist (strategy
// readiness, the operator record's Value/Strategy/Offer cards, the valuation
// projection, the executive summary range) consumes THIS computation. Two
// surfaces computing their own gate is how "Value Readiness OK" coexisted with
// "all 5 strategies blocked".

export interface PricingGateInputs {
  parcelVerified: boolean;
  validatedSoldComps: number;
  /** Usable comps in the governing valuation source (LandPortal in LandOS). */
  valuationCompCount?: number;
  /** Registry confirms at least one validated sold comp has usable $/acre. */
  valuationReady: boolean;
  valuationConflict: boolean;
  acreageConflict: boolean;
  thinMarketClusterSupported?: boolean;
}

export interface PricingGate {
  pricingAllowed: boolean;
  pricingBlockers: string[];
}

export function computePricingGate(i: PricingGateInputs): PricingGate {
  const pricingBlockers: string[] = [];
  const valuationCompCount = i.valuationCompCount ?? i.validatedSoldComps;
  if (!i.parcelVerified) pricingBlockers.push('Parcel identity is not confirmed.');
  if (valuationCompCount < 1 || (!i.valuationReady && !i.thinMarketClusterSupported)) {
    pricingBlockers.push(
      valuationCompCount > 0
        ? `${valuationCompCount} LandPortal comp${valuationCompCount === 1 ? '' : 's'} exist, but none has the complete price-and-acreage evidence required for the FMV calculation.`
        : 'No usable LandPortal comps yet. At least one LandPortal comp with price and acreage is required for FMV; when fewer than five exist, LandOS uses every usable row.',
    );
  }
  if (i.acreageConflict) pricingBlockers.push('Acreage is conflicted (assessed vs mapped) — the value basis is unstable until a survey or recorded plat resolves it.');
  return { pricingAllowed: pricingBlockers.length === 0, pricingBlockers };
}

export function buildStrategyReadiness(i: StrategyReadinessInputs): StrategyReadinessRecord {
  const { pricingAllowed, pricingBlockers } = i.prebuiltGate ?? computePricingGate({
    parcelVerified: i.parcelVerified,
    validatedSoldComps: i.validatedSoldComps,
    valuationCompCount: i.valuationCompCount ?? i.validatedSoldComps,
    valuationReady: i.valuationReady,
    valuationConflict: i.valuationConflict,
    acreageConflict: i.acreageConflict,
    thinMarketClusterSupported: i.thinMarketClusterSupported,
  });

  // Shared blockers every exit strategy inherits — named specifics, never
  // generic "core land facts incomplete".
  const shared: string[] = [];
  if (!i.parcelVerified) shared.push('Parcel identity unconfirmed');
  if (i.legalAcreageUnresolved ?? i.acreageConflict) shared.push('Legal acreage unresolved (survey or recorded plat required)');
  if (!i.legalAccessConfirmed) shared.push('Parcel–road contact and legal access unresolved (recorded instruments control)');
  if (i.trustAuthorityUnresolved) shared.push('Trust authority to sell unresolved (trust instruments + title chain required)');
  if (!pricingAllowed) shared.push('No defensible LandPortal comp value basis yet');

  const wetHeavy = (i.wetlandsPct ?? 0) >= 20;
  const floodHeavy = (i.floodSfhaPct ?? 0) >= 50;

  const strategies: StrategyReadinessEntry[] = [];

  // Not verified → everything blocked; no strategy math on an unconfirmed parcel.
  if (!i.parcelVerified) {
    for (const s of APPROVED_STRATEGIES) {
      strategies.push(entry(s, 'blocked', 'Parcel identity is not confirmed — no strategy can be evaluated.', ['Parcel identity unconfirmed'], ['Independent parcel verification (county record / trusted provider match)']));
    }
    return {
      strategies,
      pricingAllowed: false,
      pricingBlockers,
      decision: 'continue_research',
      decisionWhy: 'Resolve parcel identity first; nothing downstream is trustworthy yet.',
      summaryLine: 'All strategies blocked: parcel identity unconfirmed.',
    };
  }

  // Cash Flip — needs a value basis + marketable parcel.
  strategies.push(entry(
    'Cash Flip',
    pricingAllowed ? (wetHeavy || floodHeavy ? 'weak' : 'viable') : 'blocked',
    pricingAllowed
      ? (wetHeavy || floodHeavy ? 'A value basis exists, but heavy wetland/flood coverage narrows the resale buyer pool.' : 'A validated sold-comp basis exists — buy-low resale spread can be evaluated.')
      : 'Blocked until at least one usable LandPortal comp has price and acreage.',
    pricingAllowed ? shared.filter((b) => !/value basis/.test(b)) : [...shared],
    ['Validated sold-comp band (≥3 unique)', 'Title path', 'Legal access', 'Marketable usable acreage'],
  ));

  // Novation or Double Close — value basis + retail demand.
  strategies.push(entry(
    'Novation or Double Close',
    pricingAllowed ? 'provisional' : 'blocked',
    pricingAllowed
      ? 'Value basis exists; end-buyer demand and title path still need confirmation before structuring.'
      : 'Blocked until valuation evidence exists — the spread cannot be estimated.',
    [...shared],
    ['Validated value basis', 'End-buyer/retail demand evidence', 'Title insurability for back-to-back close'],
  ));

  // Subdivide or Minor Split — needs zoning, acreage certainty, access, septic.
  {
    const blockers = [...shared];
    // The canonical acreage wording — never a second variant of a fact the
    // shared blocker list already carries.
    if (i.acreageConflict && !blockers.some((b) => /legal acreage/i.test(b))) {
      blockers.push('Legal acreage unresolved (survey or recorded plat required)');
    }
    if (!i.zoningKnown) blockers.push('Zoning / minimum lot size unknown');
    if (i.septicOutlook === 'poor') blockers.push('Mapped soils rate poorly for septic');
    if (wetHeavy) blockers.push('Heavy mapped wetland coverage');
    const small = i.acres != null && i.acres < 5;
    strategies.push(entry(
      'Subdivide or Minor Split',
      blockers.length > 0 ? 'blocked' : small ? 'weak' : 'provisional',
      blockers.length > 0
        ? 'Blocked: subdivision cannot be assessed without zoning rules, resolved acreage, access, and septic evidence.'
        : small ? 'Parcel is likely too small to split profitably, pending ordinance rules.' : 'Physically plausible pending ordinance and yield analysis.',
      blockers,
      ['Zoning minimum lot size + subdivision rules', 'Resolved legal acreage (survey/plat)', 'Access for each lot', 'Septic/utility feasibility per lot', 'Validated value per lot'],
    ));
  }

  // Land-Home Package — needs buildable area + septic/utilities.
  {
    const blockers = [...shared];
    if (i.septicOutlook === 'poor') blockers.push('Septic outlook poor (all mapped soils very limited)');
    if (floodHeavy) blockers.push('Majority of parcel in the Special Flood Hazard Area');
    if (!i.utilitiesKnown) blockers.push('Utility service unconfirmed');
    strategies.push(entry(
      'Land-Home Package',
      blockers.length > 0 ? 'blocked' : 'provisional',
      blockers.length > 0
        ? 'Blocked: a home site needs septic (or sewer), buildable ground outside flood constraints, and utility service.'
        : 'A home package can be evaluated once value and siting are confirmed.',
      blockers,
      ['Perc test / septic approval or confirmed sewer', 'Buildable area outside flood/wetland constraints', 'Utility service confirmation', 'Validated land + package value'],
    ));
  }

  // Improvement Then Flip — site work or structure reposition.
  {
    const blockers = [...shared];
    if (!i.improved && (wetHeavy || i.septicOutlook === 'poor')) blockers.push('Site constraints (wetlands/septic) limit the value a site improvement can add');
    strategies.push(entry(
      'Improvement Then Flip',
      blockers.length > 0 ? 'blocked' : i.improved ? 'provisional' : 'weak',
      blockers.length > 0
        ? 'Blocked: cost-to-cure cannot be weighed without a value basis and feasible site improvements.'
        : i.improved ? 'An existing improvement could be repositioned; condition and cost need confirmation.' : 'Raw-land improvement (access/clearing/perc) is possible but unproven here.',
      blockers,
      ['Cost-to-cure estimate', 'Permit path', 'Validated post-improvement resale value'],
    ));
  }

  const hardRisk = (i.hardRisks ?? []).find((r) => /landlocked|no legal access|contamination|title (issue|cloud)/i.test(r)) ?? null;
  let decision: OperatorDecision = 'continue_research';
  let decisionWhy = 'LandOS is still gathering the evidence (comps, deed chain, access) needed to score the strategies.';
  if (hardRisk) {
    decision = 'tyler_review';
    decisionWhy = `A deal-killer-class risk is open (${hardRisk}) — decide whether the upside justifies resolving it.`;
  } else if (pricingAllowed) {
    decision = 'tyler_review';
    decisionWhy = 'Valuation evidence is in place — review the viable strategies and decide whether to pursue.';
  }

  const counts = strategies.reduce((acc, s) => { acc[s.status] = (acc[s.status] ?? 0) + 1; return acc; }, {} as Record<StrategyStatus, number>);
  const summaryLine = `Strategies: ${strategies.map((s) => `${s.strategy} — ${s.status.replace('_', ' ')}`).join('; ')}.`;

  return { strategies, pricingAllowed, pricingBlockers, decision, decisionWhy, summaryLine: counts.blocked === strategies.length ? `All 5 strategies blocked pending evidence. ${summaryLine}` : summaryLine };
}
