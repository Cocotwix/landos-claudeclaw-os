// Phase 3 Comparable-Sales Source Policy — canonical, system-wide.
//
// THE PROBLEM THIS SOLVES:
//   Vacant-land fair market value was previously anchored by whichever provider
//   answered first. Realie.ai comps and the HomeHarvest/Realtor.com extraction
//   lane are broad residential-market feeds; they routinely return improved and
//   manufactured-home sales, and they carry no vacant-land intent. Anchoring a
//   land FMV on them produces a confident number that is simply wrong.
//
// THE POLICY (operator-approved, not negotiable by an individual agent):
//   Primary source .......... LandPortal visible vacant-land comparable rows.
//   LandPortal HAS usable ... retain the strongest LandPortal comps, then
//                             supplement with at most 2 Zillow and 2 Redfin.
//   LandPortal has NONE ..... search up to 5 Zillow and up to 5 Redfin.
//   Realie / HomeHarvest .... NEVER establish vacant-land FMV. Realie may still
//                             resolve parcels and supply non-comp facts.
//   Improved / manufactured . retained for the Land-Home Package strategy only;
//                             never inside the vacant-land FMV set.
//
// Sold and active rows stay in separate lanes: an asking price is competition,
// never a closed-sale value basis.
//
// Pure + deterministic. No I/O, no provider calls, no fabrication. The caller
// supplies candidates; this module decides what may price the subject and
// records a plain reason for every acceptance and every rejection.

import { classifyComp, isRawLandClass, type CompClass } from './comp-classification.js';
import { addressStateCode, type CompRegistryCandidate, type SubjectMarket } from './comp-registry.js';
import {
  buildCompLaneAccountability,
  type CompLaneAccountability,
  type CompLaneInput,
} from './comp-lane-accountability.js';

/** Source families the policy reasons about. */
export type CompSourceFamily = 'landportal' | 'zillow' | 'redfin' | 'realie' | 'homeharvest' | 'county' | 'other';

/** Why a candidate may or may not touch vacant-land FMV. */
export type CompPolicyRole =
  /** LandPortal primary vacant-land comparable. */
  | 'primary'
  /** Capped Zillow/Redfin supplement. */
  | 'supplement'
  /** Retained as market context but excluded from FMV. */
  | 'context_only'
  /** Improved/manufactured — Land-Home Package input only. */
  | 'land_home_only'
  /**
   * A disabled aggregator row (Realie / HomeHarvest-Realtor.com). Retained as
   * stored historical evidence and NEVER part of the current working comp set:
   * not an accepted sale, not active competition, not a map pin, not a count.
   *
   * Distinct from `context_only`, which still surfaces as current market
   * context. Collapsing the two is what previously let a residential-feed row
   * appear in "active competition" for a vacant-land subject.
   */
  | 'legacy_evidence'
  /** Rejected outright. */
  | 'rejected';

export interface CompPolicyDecision {
  candidate: CompRegistryCandidate;
  family: CompSourceFamily;
  role: CompPolicyRole;
  lane: 'sold' | 'active';
  /** True only when this row may enter the vacant-land FMV calculation. */
  fmvEligible: boolean;
  compClass: CompClass;
  /** Operator-readable justification. Always populated. */
  reason: string;
}

export interface CompSourcePolicyPlan {
  /** True when LandPortal returned at least one usable vacant-land comp. */
  landPortalUsable: boolean;
  landPortalUsableCount: number;
  /**
   * Rows LandPortal actually returned, usable or not. Distinguishes "LandPortal
   * was never reached / returned nothing" from "LandPortal was read and returned
   * rows that cannot establish a closed-sale value". Reporting the second as the
   * first is a false current-state claim about a source that did answer.
   */
  landPortalRowsSeen: number;
  /** Per-source cap actually applied this run. */
  caps: { zillow: number; redfin: number };
  /** Plain sentence describing which branch of the policy ran. */
  explanation: string;
}

export interface CompSourcePolicyResult {
  plan: CompSourcePolicyPlan;
  /** Every candidate with its decision, in input order. Nothing is discarded. */
  decisions: CompPolicyDecision[];
  /** Candidates that may price the subject (sold lane, FMV eligible). */
  acceptedSold: CompPolicyDecision[];
  /** Active competition (never a value basis). */
  acceptedActive: CompPolicyDecision[];
  /** Improved / manufactured rows kept for the Land-Home Package strategy. */
  landHomeOnly: CompPolicyDecision[];
  /** Everything excluded, each with its reason. */
  rejected: CompPolicyDecision[];
  /**
   * Disabled aggregator rows (Realie / HomeHarvest-Realtor.com). Stored history,
   * never part of the current working comp set or any current count.
   */
  legacyEvidence: CompPolicyDecision[];
  /** Candidates ready to hand to buildCompRegistry for dedupe + validation. */
  registryCandidates: CompRegistryCandidate[];
  /** Reasons FMV cannot be established from this set, if any. */
  valuationBlockers: string[];
  summaryLine: string;
  /** Honest run/accounting status for every operator-visible source lane. */
  laneAccountability: CompLaneAccountability;
}

/** Supplement caps when LandPortal produced usable vacant-land comps. */
export const SUPPLEMENT_CAP_WITH_LANDPORTAL = 5;
/** Supplement caps when LandPortal produced nothing usable. */
export const SUPPLEMENT_CAP_WITHOUT_LANDPORTAL = 5;

/** Sources whose comps may never establish vacant-land FMV. */
export const FMV_EXCLUDED_FAMILIES: readonly CompSourceFamily[] = ['realie', 'homeharvest'];

const FAMILY_PATTERNS: Array<{ family: CompSourceFamily; re: RegExp }> = [
  { family: 'landportal', re: /land\s*portal|landportal/i },
  { family: 'zillow', re: /zillow/i },
  { family: 'redfin', re: /redfin|apify/i },
  { family: 'realie', re: /realie|really\.?ai/i },
  { family: 'homeharvest', re: /home\s*harvest|homeharvest|realtor/i },
  { family: 'county', re: /county|assessor|recorder/i },
];

export function compSourceFamily(provider: string | null | undefined): CompSourceFamily {
  const value = (provider ?? '').trim();
  if (!value) return 'other';
  for (const entry of FAMILY_PATTERNS) {
    if (entry.re.test(value)) return entry.family;
  }
  return 'other';
}

export function familyDisplayName(family: CompSourceFamily): string {
  switch (family) {
    case 'landportal': return 'LandPortal';
    case 'zillow': return 'Zillow';
    case 'redfin': return 'Redfin';
    case 'realie': return 'Realie.ai';
    case 'homeharvest': return 'Realtor.com (HomeHarvest)';
    case 'county': return 'County records';
    default: return 'Other source';
  }
}

function laneOf(candidate: CompRegistryCandidate): 'sold' | 'active' {
  const kind = (candidate.priceKind ?? '').toLowerCase();
  if (kind === 'list' || kind === 'active') return 'active';
  if (kind === 'sold' || kind === 'sale') return 'sold';
  if (candidate.lane === 'active') return 'active';
  if (candidate.lane === 'landportal' || candidate.lane === 'sold' || candidate.lane === 'supplemental') return 'sold';
  return 'sold';
}

/**
 * True when the source told us whether the event was a CLOSED SALE or an ASKING
 * PRICE. A row that states neither cannot price the subject and cannot be
 * reported as competition — guessing either way invents the fact that decides
 * the whole valuation.
 */
function transactionKindIsStated(candidate: CompRegistryCandidate): boolean {
  const kind = (candidate.priceKind ?? '').toLowerCase();
  if (['sold', 'sale', 'list', 'active'].includes(kind)) return true;
  return candidate.lane === 'sold' || candidate.lane === 'active' || candidate.lane === 'supplemental';
}

function classOf(candidate: CompRegistryCandidate): CompClass {
  const declared = (candidate.compClass ?? '').trim().toLowerCase();
  if (declared === 'vacant_land' || declared === 'farm' || declared === 'residential'
    || declared === 'manufactured' || declared === 'commercial' || declared === 'exclude') {
    return declared as CompClass;
  }
  return classifyComp({
    sourceLabel: candidate.provider,
    soldPrice: candidate.price,
    acres: candidate.acres,
    pricePerAcre: candidate.pricePerAcre,
    useCode: candidate.compClass,
    addressDesc: candidate.addressDesc,
  }).class;
}

function hasUsablePrice(candidate: CompRegistryCandidate): boolean {
  return (typeof candidate.price === 'number' && candidate.price > 0)
    || (typeof candidate.pricePerAcre === 'number' && candidate.pricePerAcre > 0);
}

/** Strength ordering inside a source family: better evidence survives the cap. */
function candidateStrength(candidate: CompRegistryCandidate, subject: SubjectMarket): number {
  let score = 0;
  if (typeof candidate.price === 'number' && candidate.price > 0) score += 3;
  if (typeof candidate.acres === 'number' && candidate.acres > 0) score += 3;
  if (candidate.sourceUrl && /^https?:\/\//i.test(candidate.sourceUrl)) score += 3;
  if (candidate.saleOrListDate) score += 2;
  if (typeof candidate.lat === 'number' && typeof candidate.lng === 'number') score += 1;
  if (typeof candidate.distanceMiles === 'number' && Number.isFinite(candidate.distanceMiles)) {
    score += Math.max(0, 4 - candidate.distanceMiles / 5);
  }
  const subjectAcres = typeof subject.acres === 'number' && subject.acres > 0 ? subject.acres : null;
  if (subjectAcres && typeof candidate.acres === 'number' && candidate.acres > 0) {
    const ratio = candidate.acres / subjectAcres;
    if (ratio >= 0.5 && ratio <= 2) score += 4;
    else if (ratio >= 0.25 && ratio <= 4) score += 2;
  }
  // Recency: a sale inside the last two years is materially stronger evidence.
  const date = (candidate.saleOrListDate ?? '').slice(0, 4);
  const year = Number(date);
  if (Number.isFinite(year) && year > 1900) score += Math.max(0, 4 - Math.max(0, 2026 - year));
  return score;
}

function wrongMarketReason(candidate: CompRegistryCandidate, subject: SubjectMarket): string | null {
  const subjectState = (subject.state ?? '').trim().toUpperCase();
  const rowState = (candidate.state ?? '').trim().toUpperCase() || addressStateCode(candidate.addressDesc);
  if (subjectState && rowState && rowState !== subjectState) {
    return `Outside the subject market: this row is in ${rowState}, the subject is in ${subjectState}.`;
  }
  return null;
}

/**
 * Apply the Phase 3 comparable-sales source policy.
 *
 * The caller passes every candidate any provider produced. This returns the
 * subset that may price the subject, the separated active competition, the
 * Land-Home-only improved rows, and an explicit reason for every exclusion.
 */
export function applyCompSourcePolicy(
  subject: SubjectMarket,
  candidates: CompRegistryCandidate[],
  laneAttempts?: CompLaneInput[],
): CompSourcePolicyResult {
  const enriched = candidates.map((candidate) => ({
    candidate,
    family: compSourceFamily(candidate.provider),
    lane: laneOf(candidate),
    compClass: classOf(candidate),
    strength: candidateStrength(candidate, subject),
  }));

  // ── Step 1: which LandPortal rows are usable vacant-land comps? ────────────
  const landPortalUsable = enriched.filter((row) => row.family === 'landportal'
    && row.lane === 'sold'
    && isRawLandClass(row.compClass)
    && hasUsablePrice(row.candidate)
    && !wrongMarketReason(row.candidate, subject));
  const hasLandPortal = landPortalUsable.length > 0;
  const cap = hasLandPortal ? SUPPLEMENT_CAP_WITH_LANDPORTAL : SUPPLEMENT_CAP_WITHOUT_LANDPORTAL;

  const landPortalRowsSeen = enriched.filter((row) => row.family === 'landportal').length;
  const plan: CompSourcePolicyPlan = {
    landPortalUsable: hasLandPortal,
    landPortalUsableCount: landPortalUsable.length,
    landPortalRowsSeen,
    caps: { zillow: cap, redfin: cap },
    explanation: hasLandPortal
      ? `LandPortal returned ${landPortalUsable.length} usable vacant-land comparable${landPortalUsable.length === 1 ? '' : 's'}, so it is the primary basis and each marketplace supplement is capped at ${cap}.`
      : landPortalRowsSeen > 0
        // LandPortal ANSWERED. Saying it "returned no comparables" would be a
        // false statement about a source that was read successfully.
        ? `LandPortal was read and returned ${landPortalRowsSeen} comparable row(s), but none qualify as a vacant-land closed sale (see the excluded list for the exact reason on each). The search therefore widened to up to ${cap} Zillow and up to ${cap} Redfin rows.`
        : `LandPortal returned no comparable rows at all, so the search widened to up to ${cap} Zillow and up to ${cap} Redfin rows.`,
  };

  // ── Step 2: rank supplement candidates inside each capped family ──────────
  const supplementRank = new Map<CompRegistryCandidate, number>();
  for (const family of ['zillow', 'redfin'] as const) {
    const eligible = enriched
      .filter((row) => row.family === family
        && row.lane === 'sold'
        && isRawLandClass(row.compClass)
        && hasUsablePrice(row.candidate)
        && !wrongMarketReason(row.candidate, subject))
      .sort((a, b) => b.strength - a.strength);
    eligible.forEach((row, index) => supplementRank.set(row.candidate, index));
  }

  // ── Step 3: decide every candidate ────────────────────────────────────────
  const decisions: CompPolicyDecision[] = enriched.map((row): CompPolicyDecision => {
    const { candidate, family, lane, compClass } = row;
    const displayFamily = familyDisplayName(family);

    // The disabled aggregators are decided FIRST and unconditionally. Their rows
    // are historical evidence only: whatever else is true of the row — land
    // class, price, status, market — it never joins the current working set.
    if (FMV_EXCLUDED_FAMILIES.includes(family)) {
      return {
        candidate, family, role: 'legacy_evidence', lane, fmvEligible: false, compClass,
        reason: `${displayFamily} is disabled for the current comparable workflow. The row is retained as stored historical evidence and never appears in the accepted sales, the active competition, the comp map, the counts, or the valuation.`,
      };
    }

    const marketProblem = wrongMarketReason(candidate, subject);
    if (marketProblem) {
      return { candidate, family, role: 'rejected', lane, fmvEligible: false, compClass, reason: marketProblem };
    }
    if (compClass === 'exclude') {
      return { candidate, family, role: 'rejected', lane, fmvEligible: false, compClass, reason: 'Non-market transfer (nominal price or unusable acreage) — not a comparable sale.' };
    }
    if (!hasUsablePrice(candidate)) {
      return { candidate, family, role: 'rejected', lane, fmvEligible: false, compClass, reason: 'No usable price evidence on the row.' };
    }
    if (compClass === 'commercial') {
      return { candidate, family, role: 'rejected', lane, fmvEligible: false, compClass, reason: 'Commercial property type — irrelevant to a vacant-land value conclusion.' };
    }
    if (compClass === 'residential' || compClass === 'manufactured') {
      return {
        candidate, family, role: 'land_home_only', lane, fmvEligible: false, compClass,
        reason: `Improved ${compClass === 'manufactured' ? 'manufactured-home' : 'residential'} property — retained for the Land-Home Package strategy only. It never establishes vacant-land fair market value.`
          + (FMV_EXCLUDED_FAMILIES.includes(family) ? ` ${displayFamily} comparables are also excluded from the accepted vacant-land valuation workflow.` : ''),
      };
    }
    if (compClass === 'unknown') {
      // For an FMV-excluded source, the policy exclusion is the load-bearing
      // operator fact and is stated first; the unknown type is the secondary
      // reason. Either way the row never reaches the vacant-land conclusion.
      const unstatedNote = transactionKindIsStated(candidate)
        ? ''
        : ' The row also never says whether it is a closed sale or an asking price.';
      return {
        candidate, family, role: 'context_only', lane, fmvEligible: false, compClass,
        reason: (FMV_EXCLUDED_FAMILIES.includes(family)
          ? `${displayFamily} comparables are excluded from the accepted vacant-land valuation workflow by the LandOS comp source policy, and this row's property type could not be established either. It stays visible as market context only.`
          : 'Property type could not be established from the row, so it is kept as market context and never priced into the vacant-land conclusion.') + unstatedNote,
      };
    }

    // Raw land from here down.
    if (!transactionKindIsStated(candidate)) {
      return {
        candidate, family, role: 'context_only', lane, fmvEligible: false, compClass,
        reason: `${displayFamily} row states a price and acreage but never says whether it is a closed sale or an asking price. It is retained as market context; a value basis is never built on an assumed transaction type.`,
      };
    }
    if (lane === 'active') {
      return {
        candidate, family, role: 'context_only', lane, fmvEligible: false, compClass,
        reason: `${displayFamily} active listing — retained as current competition. An asking price is never a closed-sale value basis.`,
      };
    }

    if (FMV_EXCLUDED_FAMILIES.includes(family)) {
      return {
        candidate, family, role: 'context_only', lane, fmvEligible: false, compClass,
        reason: `${displayFamily} comparables are excluded from the accepted vacant-land valuation workflow by the LandOS comp source policy. The row stays visible as market context only.`,
      };
    }

    if (family === 'landportal') {
      return {
        candidate, family, role: 'primary', lane, fmvEligible: true, compClass,
        reason: 'LandPortal visible vacant-land comparable sale — the primary accepted source for land value.',
      };
    }

    if (family === 'zillow' || family === 'redfin') {
      const rank = supplementRank.get(candidate);
      if (rank == null) {
        return { candidate, family, role: 'context_only', lane, fmvEligible: false, compClass, reason: `${displayFamily} row is not a usable vacant-land closed sale — kept as context.` };
      }
      if (rank >= cap) {
        return {
          candidate, family, role: 'context_only', lane, fmvEligible: false, compClass,
          reason: `${displayFamily} supplement cap is ${cap} under the ${hasLandPortal ? 'LandPortal-primary' : 'no-LandPortal'} branch of the comp policy; this row ranked ${rank + 1} on evidence strength and stays as context.`,
        };
      }
      return {
        candidate, family, role: 'supplement', lane, fmvEligible: true, compClass,
        reason: `${displayFamily} vacant-land closed sale accepted as supplement ${rank + 1} of ${cap} (${hasLandPortal
          ? 'LandPortal remains the primary basis'
          : landPortalRowsSeen > 0
            ? `LandPortal returned ${landPortalRowsSeen} row(s) but none usable as a closed sale`
            : 'LandPortal returned no rows'}).`,
      };
    }

    if (family === 'county') {
      return {
        candidate, family, role: 'context_only', lane, fmvEligible: false, compClass,
        reason: 'County transaction research is outside the current comparable workflow. Government-record research applies to the subject property only; this row cannot price a comparable parcel.',
      };
    }

    return {
      candidate, family, role: 'context_only', lane, fmvEligible: false, compClass,
      reason: 'Source is not on the approved vacant-land valuation list — retained as market context only.',
    };
  });

  const acceptedSold = decisions.filter((d) => d.fmvEligible && d.lane === 'sold');
  const acceptedActive = decisions.filter((d) =>
    d.role === 'context_only'
    && d.lane === 'active'
    && isRawLandClass(d.compClass)
    && (d.family === 'landportal' || d.family === 'zillow' || d.family === 'redfin'));
  const landHomeOnly = decisions.filter((d) => d.role === 'land_home_only');
  const rejected = decisions.filter((d) => d.role === 'rejected');
  /** Disabled aggregator rows, kept visible as history and counted separately. */
  const legacyEvidence = decisions.filter((d) => d.role === 'legacy_evidence');

  // Registry candidates keep the accepted FMV set and the active-competition
  // set. Everything else stays out of the deduped registry so it can never
  // reach the valuation math through a later join.
  const registryCandidates = [...acceptedSold, ...acceptedActive].map((decision) => ({
    ...decision.candidate,
    lane: decision.lane === 'active' ? ('active' as const) : ('sold' as const),
    priceKind: decision.lane === 'active' ? 'list' : 'sold',
    inclusionReason: decision.reason,
  }));

  const valuationBlockers: string[] = [];
  if (acceptedSold.length === 0) {
    valuationBlockers.push(hasLandPortal
      ? 'No accepted vacant-land closed sale survived the comp source policy, so no value basis exists yet.'
      : 'LandPortal returned no usable vacant-land comps and no Zillow or Redfin closed land sale was accepted, so no value basis exists yet.');
  }
  const withAcres = acceptedSold.filter((d) => typeof d.candidate.acres === 'number' && d.candidate.acres! > 0);
  if (acceptedSold.length > 0 && withAcres.length === 0) {
    valuationBlockers.push('Accepted closed sales carry no acreage, so a price-per-acre basis cannot be computed.');
  }

  const summaryLine = `${acceptedSold.length} accepted sold comp${acceptedSold.length === 1 ? '' : 's'} `
    + `(${decisions.filter((d) => d.role === 'primary').length} LandPortal primary, ${decisions.filter((d) => d.role === 'supplement').length} supplement), `
    + `${acceptedActive.length} active listing${acceptedActive.length === 1 ? '' : 's'} tracked separately, `
    + `${landHomeOnly.length} improved row${landHomeOnly.length === 1 ? '' : 's'} held for Land-Home only, `
    + `${rejected.length} rejected`
    + (legacyEvidence.length ? `, ${legacyEvidence.length} disabled aggregator row(s) kept as history only` : '')
    + '.';

  const inferredAttempts: CompLaneInput[] = [];
  if (laneAttempts == null) {
    for (const lane of ['landportal', 'zillow', 'redfin'] as const) {
      const laneCandidates = decisions.filter((decision) => decision.family === lane);
      if (!laneCandidates.length) continue;
      const retainedCount = laneCandidates.filter((decision) => decision.role === 'primary'
        || decision.role === 'supplement' || decision.role === 'context_only').length;
      inferredAttempts.push({
        lane,
        attempted: true,
        candidates: laneCandidates.length,
        retained: retainedCount,
        retainedAs: 'current comparable evidence',
        filteredReasons: laneCandidates.filter((decision) => decision.role === 'rejected').map((decision) => decision.reason),
      });
    }
    const realtorRows = decisions.filter((decision) => decision.family === 'homeharvest');
    if (realtorRows.length) {
      inferredAttempts.push({
        lane: 'realtor', attempted: false,
        disabledReason: 'Realtor.com HomeHarvest is excluded from the current vacant-land comparable workflow by FMV_EXCLUDED_FAMILIES.',
      });
    }
  }
  const laneAccountability = buildCompLaneAccountability(laneAttempts ?? inferredAttempts);

  return { plan, decisions, acceptedSold, acceptedActive, landHomeOnly, rejected, legacyEvidence, registryCandidates, valuationBlockers, summaryLine, laneAccountability };
}
