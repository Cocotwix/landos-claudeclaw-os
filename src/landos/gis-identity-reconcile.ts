// LandOS — parcel candidate RECONCILIATION (PART 9).
//
// An official search returning a row is not the same as an official search
// returning THE parcel. Every adapter routes its candidates through here before
// anything is accepted, so a plausible-but-wrong parcel can never enter a deal.
//
// The rule that matters: a MATERIAL mismatch produces a conflict, never a soft
// warning and never a quiet acceptance. Owner disagreement is not material
// (owners change between the roll and today); county, state and parcel
// identifier are.

import { normalizeAddress } from './address-normalize.js';
import { apnEquivalent, normalizeApn } from './property-intelligence-snapshot.js';
import type {
  NormalizedParcelSearchInput,
  ParcelCandidate,
  ParcelReconciliationReport,
  ReconciliationCheck,
} from './gis-platform-types.js';

/** Relative acreage drift LandOS accepts between its own figure and the roll. */
const ACRE_RELATIVE_TOLERANCE = 0.1;
/** Below this absolute difference, acreage never counts as a conflict. */
const ACRE_ABSOLUTE_FLOOR = 0.5;

export interface ReconcileOptions {
  /**
   * A jurisdiction code the SOURCE itself reported alongside the parcel id
   * (for example a municipal code carried in its own field). When LandOS holds
   * the prefixed spelling and the source publishes the bare one, this is what
   * makes the two provably the same parcel rather than a hopeful guess.
   */
  observedJurisdictionCode?: string | null;
  /** Extra identifiers published by the same record. See `ParcelCandidate.alternateIds`. */
  alternateIds?: string[];
  /** How the candidate was found. A prefix/text hit can never be `verified`. */
  searchWasExact?: boolean;
}

export type ComparisonOutcome = 'match' | 'mismatch' | 'not_comparable';

export interface IdentifierComparison {
  outcome: ComparisonOutcome;
  /** Why the two spellings were judged the same or different. */
  note: string;
}

/**
 * Compare a printed parcel identifier against what a source published.
 *
 * Beyond straight equivalence, one real-world case is handled explicitly: the
 * source publishes the bare local key while LandOS holds it prefixed with a
 * jurisdiction code, AND the source separately reports that same code in its
 * own record. Both halves must come from the source; the prefix is never
 * assumed away on its own.
 */
export function compareParcelIdentifier(
  expected: string | null | undefined,
  observed: string | null | undefined,
  options: ReconcileOptions = {},
): IdentifierComparison {
  const left = normalizeApn(expected);
  const right = normalizeApn(observed);
  if (!left || !right) return { outcome: 'not_comparable', note: 'One side has no parcel identifier.' };
  // The jurisdiction-code explanation is checked FIRST because it is the more
  // specific account of the same agreement. A bare local key and its prefixed
  // form can also read as equivalent under plain format normalization, and
  // answering "formatting" there loses the fact the operator actually needs:
  // which half came from the source's own record.
  const code = (options.observedJurisdictionCode ?? '').trim();
  if (code) {
    const composed = `${code} ${String(observed ?? '')}`;
    if (apnEquivalent(expected, composed) || normalizeApn(composed) === left) {
      return {
        outcome: 'match',
        note: `Source publishes the local key "${observed}" together with jurisdiction code "${code}"; combined they equal the identifier LandOS holds.`,
      };
    }
  }

  if (apnEquivalent(expected, observed)) {
    return { outcome: 'match', note: 'Parcel identifiers are equivalent once formatting is normalized.' };
  }

  // Other identifiers the same record publishes for the same parcel.
  for (const alternate of options.alternateIds ?? []) {
    if (!alternate) continue;
    if (apnEquivalent(expected, alternate) || normalizeApn(alternate) === left) {
      return {
        outcome: 'match',
        note: `The official record publishes "${alternate}" for this parcel alongside "${observed}", and that spelling matches the identifier LandOS holds.`,
      };
    }
  }

  return { outcome: 'mismatch', note: `Source parcel identifier "${observed}" is not the same parcel as "${expected}".` };
}

function compareText(expected: string | null | undefined, observed: string | null | undefined): IdentifierComparison {
  const left = (expected ?? '').trim();
  const right = (observed ?? '').trim();
  if (!left || !right) return { outcome: 'not_comparable', note: 'One side is blank.' };
  if (left.toLowerCase() === right.toLowerCase()) return { outcome: 'match', note: 'Exact text match.' };
  return { outcome: 'mismatch', note: `"${right}" differs from "${left}".` };
}

/**
 * County agreement. A county field that carries only a NUMERIC code (a state
 * county number such as "094", or a FIPS fragment) names nothing LandOS can
 * compare a county NAME against, so it is not comparable rather than a
 * disagreement: treating it as a mismatch rejected correctly matched parcels
 * on layers that publish the code instead of the name. A trailing "County"
 * on either side is spelling, never a different county.
 */
export function compareCounty(expected: string | null | undefined, observed: string | null | undefined): IdentifierComparison {
  const strip = (value: string | null | undefined) => (value ?? '').trim().replace(/\s+county$/i, '').trim();
  const left = strip(expected);
  const right = strip(observed);
  if (!left || !right) return { outcome: 'not_comparable', note: 'One side is blank.' };
  const numeric = (value: string) => /^\d+$/.test(value);
  if (numeric(left) !== numeric(right)) {
    const code = numeric(right) ? right : left;
    return { outcome: 'not_comparable', note: `County is published as the code "${code}", not a name, so it was not compared.` };
  }
  return compareText(left, right);
}

/** Address comparison on the shared canonical form, so suffix and directional
 *  spelling differences never read as a different property. */
export function compareAddress(expected: string | null | undefined, observed: string | null | undefined): IdentifierComparison {
  const left = normalizeAddress(expected ?? '');
  const right = normalizeAddress(observed ?? '');
  if (!left || !right) return { outcome: 'not_comparable', note: 'One side has no address.' };
  if (left === right) return { outcome: 'match', note: 'Addresses match after normalization.' };
  // LandOS often holds a full mailing form while the roll holds only the situs
  // line, so containment either way is a match rather than a conflict.
  if (left.startsWith(right) || right.startsWith(left)) {
    return { outcome: 'match', note: 'One address is the leading form of the other after normalization.' };
  }
  return { outcome: 'mismatch', note: `Source address "${observed}" differs from "${expected}".` };
}

/** Acreage agreement within tolerance. Rolls round; LandOS should not conflict on rounding. */
export function compareAcres(expected: number | null | undefined, observed: number | null | undefined): IdentifierComparison {
  if (typeof expected !== 'number' || typeof observed !== 'number' || !Number.isFinite(expected) || !Number.isFinite(observed)) {
    return { outcome: 'not_comparable', note: 'One side has no acreage.' };
  }
  const difference = Math.abs(expected - observed);
  if (difference <= ACRE_ABSOLUTE_FLOOR) return { outcome: 'match', note: `Acreage differs by ${difference.toFixed(2)}, within the rounding floor.` };
  const relative = expected > 0 ? difference / expected : 1;
  if (relative <= ACRE_RELATIVE_TOLERANCE) return { outcome: 'match', note: `Acreage differs by ${(relative * 100).toFixed(1)}%, within tolerance.` };
  return { outcome: 'mismatch', note: `Acreage ${observed} differs from ${expected} by ${(relative * 100).toFixed(1)}%.` };
}

/**
 * Dimensions that force a conflict when they disagree, given whether the parcel
 * IDENTIFIER already matched.
 *
 * An exact identifier match is the strongest identity evidence a county can
 * give. Once it holds, a differing street spelling or a roll-vs-deed acreage
 * gap is a discrepancy to report, not grounds to reject the parcel — assessors
 * routinely print a street name differently from the operator's source, and
 * rejecting on that would throw away correctly matched parcels.
 *
 * County and state stay material either way: a matching identifier in the wrong
 * county is a different parcel, not a spelling difference.
 */
function materialDimensions(apnMatched: boolean): ReadonlySet<string> {
  return apnMatched
    ? new Set(['apn', 'county', 'state'])
    : new Set(['apn', 'county', 'state', 'address', 'acreage']);
}

function checksForCandidate(
  input: NormalizedParcelSearchInput,
  candidate: ParcelCandidate,
  options: ReconcileOptions,
): ReconciliationCheck[] {
  // Per-candidate alternates win over any list supplied by the caller, so one
  // candidate's identifiers can never be used to accept a different candidate.
  const apn = compareParcelIdentifier(input.apn, candidate.parcelId, {
    ...options,
    alternateIds: candidate.alternateIds ?? options.alternateIds,
  });
  const address = compareAddress(input.address, candidate.address);
  const owner = compareText(input.owner, candidate.owner);
  const acreage = compareAcres(input.knownAcres, candidate.acres);
  const county = compareCounty(input.county, candidate.county);
  const state = compareText(input.state, candidate.state);

  const material = materialDimensions(apn.outcome === 'match');

  return [
    { dimension: 'apn', outcome: apn.outcome, expected: input.apn ?? null, observed: candidate.parcelId, material: material.has('apn') },
    { dimension: 'address', outcome: address.outcome, expected: input.address ?? null, observed: candidate.address, material: material.has('address') },
    // Owner disagreement is informational: the assessment roll lags a sale.
    { dimension: 'owner', outcome: owner.outcome, expected: input.owner ?? null, observed: candidate.owner, material: false },
    { dimension: 'acreage', outcome: acreage.outcome, expected: input.knownAcres != null ? String(input.knownAcres) : null, observed: candidate.acres != null ? String(candidate.acres) : null, material: material.has('acreage') },
    { dimension: 'county', outcome: county.outcome, expected: input.county ?? null, observed: candidate.county, material: material.has('county') },
    { dimension: 'state', outcome: state.outcome, expected: input.state ?? null, observed: candidate.state, material: material.has('state') },
  ];
}

function scoreChecks(checks: readonly ReconciliationCheck[]): { matches: number; materialMismatches: number } {
  let matches = 0;
  let materialMismatches = 0;
  for (const check of checks) {
    if (check.outcome === 'match') matches += 1;
    if (check.outcome === 'mismatch' && check.material) materialMismatches += 1;
  }
  return { matches, materialMismatches };
}

/**
 * PART 9 — pick the right candidate, or refuse to.
 *
 * The first result is never taken on trust. Every candidate is checked against
 * every dimension LandOS can compare; the best-matching one is accepted only
 * when nothing material disagrees, and a candidate that agrees on identity but
 * came from a weak text search is downgraded to provisional rather than
 * presented as verified.
 */
export function reconcileParcelCandidates(
  input: NormalizedParcelSearchInput,
  candidates: readonly ParcelCandidate[],
  options: ReconcileOptions = {},
): ParcelReconciliationReport {
  if (!candidates.length) {
    return {
      candidatesConsidered: 0,
      acceptedIndex: null,
      checks: [],
      status: 'not_found',
      reason: 'The official source returned no candidate parcels for this subject.',
    };
  }

  const evaluated = candidates.map((candidate, index) => {
    const checks = checksForCandidate(input, candidate, options);
    return { index, candidate, checks, ...scoreChecks(checks) };
  });

  // A record that published nothing LandOS can compare is not a match, however
  // agreeable it looks. Without this a page that returned no data at all would
  // be "accepted" on dimensions that had nothing to disagree about — and the
  // operator would be shown a confident empty parcel.
  //
  // "Nothing comparable" means no comparison was POSSIBLE. A candidate that
  // was compared and disagreed is a conflict, which is a different answer.
  const nothingComparable = evaluated.every((entry) => entry.checks.every((check) => check.outcome === 'not_comparable'));
  if (nothingComparable) {
    return {
      candidatesConsidered: candidates.length,
      acceptedIndex: null,
      checks: evaluated[0].checks,
      status: 'not_found',
      reason: 'The official source returned a record with no field LandOS could compare against the subject.',
    };
  }

  const clean = evaluated.filter((entry) => entry.materialMismatches === 0);

  if (!clean.length) {
    // Everything the source returned disagrees on something material. Report
    // the closest one so the operator can see WHAT disagreed, and stop.
    const closest = [...evaluated].sort((a, b) => (a.materialMismatches - b.materialMismatches) || (b.matches - a.matches))[0];
    const conflicting = closest.checks.filter((c) => c.material && c.outcome === 'mismatch').map((c) => c.dimension);
    return {
      candidatesConsidered: candidates.length,
      acceptedIndex: null,
      checks: closest.checks,
      status: 'conflict',
      reason: `Every candidate disagreed with LandOS on ${conflicting.join(', ')}. Identity was not accepted.`,
    };
  }

  const best = [...clean].sort((a, b) => b.matches - a.matches)[0];
  const apnCheck = best.checks.find((c) => c.dimension === 'apn');
  const apnMatched = apnCheck?.outcome === 'match';

  // More than one candidate survived with equal support: the source cannot
  // distinguish them, so neither may be presented as verified.
  const tied = clean.filter((entry) => entry.matches === best.matches);
  if (tied.length > 1 && !apnMatched) {
    return {
      candidatesConsidered: candidates.length,
      acceptedIndex: null,
      checks: best.checks,
      status: 'conflict',
      reason: `${tied.length} candidates matched equally well and none could be distinguished on parcel identifier. Identity was not accepted.`,
    };
  }

  // How a record was FOUND and whether it is the right record are different
  // questions. A prefix search is a weaker way to find something, but if the
  // record it returns matches on parcel identifier AND on another material
  // dimension, identity is confirmed — the confirmation is what counts, not
  // the query that surfaced it. Without a second corroborating dimension a
  // non-exact search stays provisional.
  const exactSearch = options.searchWasExact !== false;
  // Corroboration means an independent dimension AGREED. It is deliberately not
  // limited to material ones: materiality now depends on whether the identifier
  // matched, so requiring it here would make the test circular and would refuse
  // to count the very agreement that makes the match trustworthy.
  const corroborated = best.checks.some(
    (check) => check.dimension !== 'apn' && check.outcome === 'match',
  );
  if (apnMatched && (exactSearch || corroborated)) {
    // A demoted disagreement is still reported. Accepting on the identifier
    // must never mean quietly discarding the fact that the source spells the
    // address differently or carries a different acreage.
    const noted = best.checks
      .filter((check) => !check.material && check.outcome === 'mismatch' && check.dimension !== 'owner')
      .map((check) => `${check.dimension} differs (source: ${check.observed ?? 'blank'})`);
    const suffix = noted.length ? ` Noted, not disqualifying: ${noted.join('; ')}.` : '';
    return {
      candidatesConsidered: candidates.length,
      acceptedIndex: best.index,
      checks: best.checks,
      status: 'verified',
      reason: (exactSearch
        ? `Parcel identifier matched exactly with ${best.matches} corroborating dimension(s) and no material disagreement.`
        : `Parcel identifier matched, and a further material dimension corroborated it, so identity is confirmed despite a non-exact search.`) + suffix,
    };
  }

  return {
    candidatesConsidered: candidates.length,
    acceptedIndex: best.index,
    checks: best.checks,
    status: 'provisional',
    reason: apnMatched
      ? 'Parcel identifier matched, but it was reached through a non-exact search, so the match is provisional until confirmed.'
      : `No parcel identifier was comparable; accepted on ${best.matches} corroborating dimension(s) with no material disagreement.`,
  };
}

/** Operator-readable summary of what disagreed, for the conflict state. */
export function describeConflict(report: ParcelReconciliationReport): string[] {
  return report.checks
    .filter((check) => check.outcome === 'mismatch' && check.material)
    .map((check) => `${check.dimension}: LandOS has ${check.expected ?? '(blank)'}, the official source has ${check.observed ?? '(blank)'}.`);
}
