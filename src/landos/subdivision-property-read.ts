// LandOS — the PROPERTY-SPECIFIC subdivision read.
//
// The rules say what the jurisdiction allows. This says what THIS tract can
// plausibly do, and — more importantly — what it is not yet known to do.
//
// One rule dominates the design:
//
//     A THEORETICAL LOT COUNT IS NEVER AN APPROVED YIELD.
//
// Acreage divided by minimum lot size is arithmetic. It ignores road frontage,
// topography, floodplain, soils, right-of-way dedication, open-space set-aside,
// utility capacity, and the planning commission. Presenting that number as
// "what you can build" is the single most expensive mistake in land
// acquisition, so every number this module produces carries an explicit basis
// and `approvedYield` is a field that is always false.
//
// Four weights, and they mean different things:
//
//   THEORETICAL  arithmetic from established rules. No site test applied.
//   LIKELY       the established rules plus what LandOS actually knows about
//                this site point the same way.
//   CONFIRMED    a government record says it about THIS parcel.
//   UNKNOWN      an input the conclusion needs is missing. Named, not guessed.
//
// Pure. Everything it consumes was established elsewhere and is cited there.

import { readLotCount, type SubdivisionRegulations, type SubdivisionRule } from './subdivision-regulations.js';
import type { CurrentZoningDetermination } from './current-zoning-determination.js';
import type { PropertyBackstory } from './property-backstory.js';

export type YieldBasis = 'theoretical' | 'likely' | 'confirmed' | 'unknown';

export type SubdivisionPathKind =
  | 'administrative_split'
  | 'minor_subdivision'
  | 'major_subdivision'
  | 'unknown';

export interface SubdivisionConstraintRead {
  kind: 'frontage' | 'acreage' | 'access' | 'environmental' | 'utilities_septic' | 'road_infrastructure' | 'history';
  headline: string;
  detail: string;
  basis: YieldBasis;
  /** Where this came from. Empty means it came from a stated unknown. */
  sources: Array<{ label: string; url: string | null; section: string | null }>;
}

export interface TheoreticalLotCount {
  /** Null whenever an input is missing. Never a placeholder number. */
  value: number | null;
  status: 'theoretical' | 'unknown';
  /** The arithmetic, printed, so the operator can check it. */
  calculation: string;
  /** Always false. Arithmetic is not an entitlement. */
  approvedYield: false;
  inputs: { acres: number | null; minimumLotAcres: number | null; minimumLotSizeStatedAs: string | null };
  caveats: string[];
}

export interface FrontageConstraintRead {
  status: 'binding' | 'not_binding' | 'unknown';
  maxLotsByFrontage: number | null;
  basis: YieldBasis;
  detail: string;
}

export interface PropertySubdivisionRead {
  dealCardId: number;
  likelyPath: { kind: SubdivisionPathKind; basis: YieldBasis; why: string };
  reviewIndication: 'minor' | 'major' | 'both_possible' | 'unknown';
  requiredReviewBody: string | null;
  theoreticalLotCount: TheoreticalLotCount;
  frontageConstraint: FrontageConstraintRead;
  /** The lowest determinable ceiling across every constraint that bound. */
  obviousMaximumLotConstraint: { value: number | null; from: string; basis: YieldBasis };
  constraints: SubdivisionConstraintRead[];
  nextAuthoritativeDiligence: string[];
  limitations: string[];
  generatedAt: string;
}

// ── Parsing the numbers out of a stated rule ────────────────────────────────

const ACRES_PER_SQFT = 1 / 43_560;

/**
 * The minimum lot size a rule states, in ACRES.
 *
 * Handles both registers real ordinances use — "one (1) acre" and "43,560
 * square feet" — and refuses anything it cannot read, because a wrong
 * denominator silently multiplies the lot count.
 */
export function readMinimumLotAcres(stated: string | null): { acres: number | null; statedAs: string | null } {
  if (!stated) return { acres: null, statedAs: null };
  const text = stated.replace(/\s+/g, ' ');
  // Ordinances write numbers as "fifteen thousand (15,000) square feet" and
  // "one (1) acre", so the closing parenthesis sits between the digits and the
  // unit. Not allowing for it silently reads every such rule as unstated.
  const sqft = /(\d{1,3}(?:,\d{3})+|\d{4,7})\s*\)?\s*(?:square\s*feet|sq\.?\s*ft\.?|sf)\b/i.exec(text);
  if (sqft) {
    const value = Number(sqft[1].replace(/,/g, '')) * ACRES_PER_SQFT;
    if (Number.isFinite(value) && value > 0) return { acres: Number(value.toFixed(4)), statedAs: sqft[0].trim() };
  }
  const acres = /(\d{1,3}(?:\.\d{1,3})?)\s*\)?\s*(?:\+\/-\s*)?acres?\b/i.exec(text);
  if (acres) {
    const value = Number(acres[1]);
    if (Number.isFinite(value) && value > 0) return { acres: value, statedAs: acres[0].trim() };
  }
  return { acres: null, statedAs: null };
}

/** Linear feet a frontage rule states. */
export function readFrontageFeet(stated: string | null): number | null {
  if (!stated) return null;
  const match = /(\d{2,4})\s*\)?\s*(?:linear\s*)?(?:feet|foot|ft\.?)\b/i.exec(stated.replace(/\s+/g, ' '));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// ── The read ────────────────────────────────────────────────────────────────

export interface PropertySubdivisionReadInput {
  dealCardId: number;
  /** Established subject facts. Anything unknown must arrive as null. */
  acres: number | null;
  roadFrontageFeet: number | null;
  roadFrontageBasis: string | null;
  accessStatus: 'public_road_proximity' | 'private_road_only' | 'no_mapped_contact' | 'unknown' | null;
  environmentalConstraints: readonly string[];
  utilitiesKnown: boolean | null;
  utilitiesSummary: string | null;
  zoning: CurrentZoningDetermination | null;
  regulations: SubdivisionRegulations | null;
  backstory: PropertyBackstory | null;
  now?: () => string;
}

function sourceOf(rule: SubdivisionRule | null): Array<{ label: string; url: string | null; section: string | null }> {
  return rule ? [{ label: rule.sourceLabel, url: rule.sourceUrl, section: rule.section }] : [];
}

/**
 * Produce the property-specific read.
 *
 * Every branch that cannot be answered lands in `nextAuthoritativeDiligence`
 * rather than in a hedged conclusion, because "call the planning department and
 * ask X" is actionable and "possibly around 30 lots" is not.
 */
export function buildPropertySubdivisionRead(input: PropertySubdivisionReadInput): PropertySubdivisionRead {
  const generatedAt = (input.now ?? (() => new Date().toISOString()))();
  const rules = input.regulations;
  const constraints: SubdivisionConstraintRead[] = [];
  const diligence: string[] = [];
  const limitations: string[] = [];

  const minLotRule = rules?.rules.find((rule) => rule.key === 'minimum_lot_size') ?? null;
  const frontageRule = rules?.rules.find((rule) => rule.key === 'minimum_frontage') ?? null;
  const zoningMinLot = input.zoning?.standards.minimumLotSize ?? null;

  // The zoning district's own minimum governs the lot; the subdivision
  // regulations' minimum applies where zoning states none. Both are cited.
  const minimum = readMinimumLotAcres(zoningMinLot ?? minLotRule?.value ?? null);
  const minimumSourceLabel = zoningMinLot
    ? (input.zoning?.standards.sources[0]?.label ?? 'the zoning standards')
    : minLotRule?.sourceLabel ?? null;

  // ── Theoretical lot count ────────────────────────────────────────────────
  const theoretical: TheoreticalLotCount = (() => {
    const caveats = [
      'This is arithmetic over the stated minimum lot size. It applies no road frontage test, no topography or floodplain deduction, no right-of-way dedication, no open-space set-aside, and no review-body judgement.',
    ];
    if (input.acres == null || input.acres <= 0) {
      return {
        value: null,
        status: 'unknown' as const,
        calculation: 'Not calculated: the subject acreage is not established.',
        approvedYield: false as const,
        inputs: { acres: null, minimumLotAcres: minimum.acres, minimumLotSizeStatedAs: minimum.statedAs },
        caveats,
      };
    }
    if (minimum.acres == null) {
      return {
        value: null,
        status: 'unknown' as const,
        calculation: 'Not calculated: no minimum lot size was established from the zoning standards or the subdivision regulations.',
        approvedYield: false as const,
        inputs: { acres: input.acres, minimumLotAcres: null, minimumLotSizeStatedAs: null },
        caveats,
      };
    }
    const value = Math.floor(input.acres / minimum.acres);
    return {
      value,
      status: 'theoretical' as const,
      calculation: `${input.acres} acres ÷ ${minimum.acres} acre minimum lot size = ${value} lot(s), before any site or process deduction. Minimum stated as "${minimum.statedAs}"${minimumSourceLabel ? ` per ${minimumSourceLabel}` : ''}.`,
      approvedYield: false as const,
      inputs: { acres: input.acres, minimumLotAcres: minimum.acres, minimumLotSizeStatedAs: minimum.statedAs },
      caveats,
    };
  })();

  if (theoretical.status === 'theoretical') {
    constraints.push({
      kind: 'acreage',
      headline: `Acreage supports up to ${theoretical.value} lot(s) on the stated minimum lot size alone.`,
      detail: theoretical.calculation,
      basis: 'theoretical',
      sources: zoningMinLot
        ? (input.zoning?.standards.sources.slice(0, 1).map((row) => ({ label: row.label, url: row.url, section: row.section })) ?? [])
        : sourceOf(minLotRule),
    });
  } else {
    diligence.push(theoretical.calculation.replace('Not calculated: ', 'Establish: '));
  }

  // ── Frontage ─────────────────────────────────────────────────────────────
  const requiredFrontage = readFrontageFeet(input.zoning?.standards.frontage ?? frontageRule?.value ?? null);
  const frontageConstraint: FrontageConstraintRead = (() => {
    if (requiredFrontage == null) {
      diligence.push('Establish the minimum lot frontage the controlling authority requires; no frontage minimum was extracted from the zoning standards or the subdivision regulations.');
      return {
        status: 'unknown' as const,
        maxLotsByFrontage: null,
        basis: 'unknown' as const,
        detail: 'No minimum frontage was established, so no frontage ceiling can be computed.',
      };
    }
    if (input.roadFrontageFeet == null || input.roadFrontageFeet <= 0) {
      diligence.push(`Measure the tract's actual public road frontage; the controlling minimum is ${requiredFrontage} ft per lot, and without the tract's frontage the lot ceiling it implies cannot be computed.`);
      return {
        status: 'unknown' as const,
        maxLotsByFrontage: null,
        basis: 'unknown' as const,
        detail: `A ${requiredFrontage} ft minimum frontage per lot is established, but the tract's own road frontage is not, so the ceiling it implies is unknown.`,
      };
    }
    const maxLots = Math.floor(input.roadFrontageFeet / requiredFrontage);
    const binding = theoretical.value != null && maxLots < theoretical.value;
    const detail = `${input.roadFrontageFeet} ft of road frontage ÷ ${requiredFrontage} ft minimum per lot = ${maxLots} lot(s) fronting the existing road`
      + `${input.roadFrontageBasis ? ` (frontage per ${input.roadFrontageBasis})` : ''}. `
      + 'Lots served by a new interior road are not limited by this figure; a new road is itself a major-subdivision trigger in most regulations.';
    constraints.push({
      kind: 'frontage',
      headline: binding
        ? `Road frontage limits the tract to ${maxLots} lot(s) without a new road, below the ${theoretical.value} the acreage alone would allow.`
        : `Road frontage supports ${maxLots} lot(s) fronting the existing road.`,
      detail,
      basis: 'theoretical',
      sources: input.zoning?.standards.frontage
        ? (input.zoning.standards.sources.slice(0, 1).map((row) => ({ label: row.label, url: row.url, section: row.section })) ?? [])
        : sourceOf(frontageRule),
    });
    return { status: binding ? 'binding' as const : 'not_binding' as const, maxLotsByFrontage: maxLots, basis: 'theoretical' as const, detail };
  })();

  // ── Site constraints LandOS actually knows about ─────────────────────────
  for (const constraint of input.environmentalConstraints) {
    constraints.push({
      kind: 'environmental',
      headline: constraint,
      detail: 'Established by the environmental screening lane. Any acreage it removes has not been deducted from the theoretical count above.',
      basis: 'likely',
      sources: [],
    });
  }
  if (input.accessStatus && input.accessStatus !== 'public_road_proximity') {
    constraints.push({
      kind: 'access',
      headline: input.accessStatus === 'private_road_only'
        ? 'Access is by private road only.'
        : input.accessStatus === 'no_mapped_contact'
          ? 'No mapped public road contact was found for this tract.'
          : 'Physical and legal access is unknown.',
      detail: 'Subdivision regulations almost always require each lot to abut a public road or an approved private road built to standard. Unresolved access is a gating item, not a discount.',
      basis: input.accessStatus === 'unknown' ? 'unknown' : 'likely',
      sources: sourceOf(rules?.rules.find((rule) => rule.key === 'access_requirement') ?? null),
    });
    if (input.accessStatus === 'unknown') diligence.push('Confirm legal and physical access to a public road, and whether any easement is recorded.');
  }
  if (input.utilitiesKnown !== true) {
    constraints.push({
      kind: 'utilities_septic',
      headline: 'Utility and septic capacity is not established.',
      detail: input.utilitiesSummary
        ?? 'Neither public sewer availability nor on-site sewage suitability has been established. Where sewer is unavailable, soils determine lot yield more often than zoning does.',
      basis: 'unknown',
      sources: sourceOf(rules?.rules.find((rule) => rule.key === 'septic_implication') ?? rules?.rules.find((rule) => rule.key === 'sewer_requirement') ?? null),
    });
    diligence.push('Obtain a soils / subsurface sewage disposal determination from the state or county environmental health office, or written confirmation of public sewer availability and capacity.');
  }
  const roadRule = rules?.rules.find((rule) => rule.key === 'new_road_standard') ?? null;
  if (roadRule) {
    constraints.push({
      kind: 'road_infrastructure',
      headline: 'Any new interior road must be built to the authority\'s road standard.',
      detail: roadRule.value,
      basis: 'confirmed',
      sources: sourceOf(roadRule),
    });
  }

  // ── What the property's own history says ─────────────────────────────────
  const priorLots = input.backstory?.events
    .map((event) => event.materialNumbers.lots)
    .filter((lots): lots is number => lots != null)
    .sort((a, b) => b - a)[0] ?? null;
  if (priorLots != null) {
    const decided = input.backstory?.events.find((event) => event.materialNumbers.lots === priorLots
      && ['approved', 'denied', 'withdrawn', 'deferred'].includes(event.status));
    constraints.push({
      kind: 'history',
      headline: `A ${priorLots}-lot concept for this tract already exists in the public planning record.`,
      detail: decided
        ? `That concept ${decided.status === 'approved' ? 'was approved' : decided.status === 'denied' ? 'was denied' : `was ${decided.status}`} per the retained record${decided.eventDate ? ` on ${decided.eventDate}` : ''}. A prior approval is not a current entitlement unless it is still valid under the authority's own expiry rules.`
        : 'The retained record states no outcome for it, so it is a concept that was put forward and not an approval.',
      basis: decided?.status === 'approved' ? 'confirmed' : 'likely',
      sources: (input.backstory?.events.find((event) => event.materialNumbers.lots === priorLots)?.evidence ?? [])
        .slice(0, 1)
        .map((ref) => ({ label: ref.sourceTitle ?? 'Official planning document', url: ref.sourceUrl, section: ref.page != null ? `approx. p. ${ref.page}` : null })),
    });
    if (decided?.status === 'approved') {
      diligence.push('Confirm with the planning department whether the prior approval is still valid, expired, or superseded, and what re-submittal it would require.');
    }
  }

  // ── The path and the review body ─────────────────────────────────────────
  const thresholds = rules?.thresholds ?? null;
  const ceiling = thresholds?.statedMaxMinorLots ?? null;
  const intended = priorLots ?? theoretical.value;

  const likelyPath: PropertySubdivisionRead['likelyPath'] = (() => {
    if (!rules || !rules.documents.length) {
      return {
        kind: 'unknown' as const,
        basis: 'unknown' as const,
        why: 'No current subdivision regulation document was retrieved for the controlling authority, so the applicable path is not established.',
      };
    }
    if (ceiling == null) {
      return {
        kind: 'unknown' as const,
        basis: 'unknown' as const,
        why: `The retrieved regulations state no lot ceiling separating minor from major review. ${thresholds?.basis ?? ''}`.trim(),
      };
    }
    if (intended == null) {
      return {
        kind: 'unknown' as const,
        basis: 'unknown' as const,
        why: `Minor review applies at ${ceiling} lot(s) or fewer, but the number of lots this tract would be divided into is not established, so the path cannot be indicated.`,
      };
    }
    if (intended <= ceiling) {
      return {
        kind: 'minor_subdivision' as const,
        basis: 'likely' as const,
        why: `The regulations set minor review at ${ceiling} lot(s) or fewer and the tract's indicated ${intended} lot(s) sits at or below it. Frontage, access and utility requirements still apply and can move it to major review.`,
      };
    }
    return {
      kind: 'major_subdivision' as const,
      basis: 'likely' as const,
      why: `The regulations set minor review at ${ceiling} lot(s) or fewer and the tract's indicated ${intended} lot(s) exceeds it, so major subdivision review is the likely path.`,
    };
  })();

  const reviewIndication: PropertySubdivisionRead['reviewIndication'] =
    likelyPath.kind === 'minor_subdivision' ? 'minor'
      : likelyPath.kind === 'major_subdivision' ? 'major'
        : likelyPath.kind === 'administrative_split' ? 'minor'
          : 'unknown';

  const reviewBodyRule = rules?.rules.find((rule) => rule.key === 'planning_commission_review')
    ?? rules?.rules.find((rule) => rule.key === 'governing_body_approval')
    ?? null;
  const requiredReviewBody = reviewIndication === 'major'
    ? (reviewBodyRule ? `${rules?.authorityName ?? 'The controlling authority'} planning commission (${reviewBodyRule.section ?? reviewBodyRule.sourceLabel})` : null)
    : reviewIndication === 'minor'
      ? (rules?.rules.find((rule) => rule.key === 'administrative_review')
        ? `${rules?.authorityName ?? 'The controlling authority'} staff / administrative review`
        : reviewBodyRule ? `${rules?.authorityName ?? 'The controlling authority'} planning commission` : null)
      : null;

  // ── The lowest ceiling anything establishes ──────────────────────────────
  const ceilings: Array<{ value: number; from: string; basis: YieldBasis }> = [];
  if (theoretical.value != null) ceilings.push({ value: theoretical.value, from: 'minimum lot size over the tract acreage', basis: 'theoretical' });
  if (frontageConstraint.maxLotsByFrontage != null) ceilings.push({ value: frontageConstraint.maxLotsByFrontage, from: 'road frontage over the minimum frontage per lot, without a new interior road', basis: 'theoretical' });
  const lowest = ceilings.sort((a, b) => a.value - b.value)[0] ?? null;

  // ── What to actually go and confirm ──────────────────────────────────────
  if (!input.zoning?.established) {
    diligence.unshift('Confirm the CURRENT zoning district with the controlling authority. It is not established, and every dimensional standard below depends on it.');
  }
  if (rules && !rules.documents.length) {
    diligence.push('Obtain the controlling authority\'s current subdivision regulations directly from its planning department.');
  }
  diligence.push('Ask the planning department to confirm, in writing, the review path and lot ceiling that would apply to this specific parcel.');
  if (theoretical.status === 'theoretical') {
    diligence.push('Have a surveyor or civil engineer produce a yield sketch: the theoretical count above applies no road, drainage, or open-space deduction.');
  }

  if (theoretical.value != null) {
    limitations.push('The theoretical lot count is arithmetic, not an approved yield, and it is presented as such everywhere it appears.');
  }
  if (rules?.limitations.length) limitations.push(...rules.limitations);
  if (input.zoning?.limitations.length) limitations.push(...input.zoning.limitations);

  return {
    dealCardId: input.dealCardId,
    likelyPath,
    reviewIndication,
    requiredReviewBody,
    theoreticalLotCount: theoretical,
    frontageConstraint,
    obviousMaximumLotConstraint: lowest
      ? { value: lowest.value, from: lowest.from, basis: lowest.basis }
      : { value: null, from: 'Nothing established a lot ceiling for this tract.', basis: 'unknown' },
    constraints,
    nextAuthoritativeDiligence: [...new Set(diligence)],
    limitations: [...new Set(limitations)],
    generatedAt,
  };
}

/** Convenience for readers that want the ceiling a rule text states. */
export const readSubdivisionLotCount = readLotCount;
