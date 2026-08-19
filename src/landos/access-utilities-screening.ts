// LandOS — access, frontage and site-service screening (pure, deterministic).
//
// Six property facts that were previously collapsed into two checklist lines,
// separated here because they are answered by different evidence, at different
// stages, and a single label over any pair of them is dishonest:
//
//   ACCESS          Does the property have an established way in at the
//                   acquisition-screening stage?
//   ROAD FRONTAGE   How much frontage does the subject actually have?
//   PUBLIC WATER    Does public water appear available to this parcel?
//   PUBLIC SEWER    Does public sewer appear available to this parcel?
//   WELL OUTLOOK    Only when public water is not established: does a well look
//                   generally easy, moderate, difficult, or unknown here?
//   SEPTIC OUTLOOK  Only when public sewer is not established: how promising
//                   does an onsite system look on the RETAINED subject soils?
//
// Access and frontage are structurally independent. A parcel that plainly
// fronts a recognized road has discovery-stage access even while the exact
// frontage figure is disputed, and a parcel reached by a recorded easement or
// private drive can have access with little or no direct public-road frontage.
// Nothing here collapses them back together.
//
// Everything below is a screen, never a determination. The well outlook is not
// a yield study, and the septic outlook is not a perc test and never predicts
// one passing. Where the retained evidence does not support an answer, the
// answer is UNKNOWN and no further search is implied.
//
// Pure + deterministic: no I/O, no clock, no model, no browser.

// ── Access and frontage ──────────────────────────────────────────────────────

/** One retained frontage reading, with the provider that carried it. */
export interface RetainedFrontageReading {
  /** Raw retained text, e.g. "22.94 ft". */
  raw: string;
  feet: number | null;
  source: string;
}

export type AccessState = 'established' | 'not_established' | 'unknown';
export type FrontageState = 'established' | 'approximate' | 'conflicting' | 'unresolved';

export interface AccessRead {
  state: AccessState;
  /** True only for discovery-stage established access. */
  established: boolean;
  landlocked: boolean | null;
  statement: string;
}

export interface FrontageRead {
  state: FrontageState;
  /** The single agreed figure, when the retained readings agree. */
  feet: number | null;
  readings: RetainedFrontageReading[];
  statement: string;
}

const LANDLOCKED_AFFIRMATIVE = /^(?:yes|true|1|land\s*locked|affirmative)$/i;
const LANDLOCKED_NEGATIVE = /^(?:no|false|0|none)$/i;

/** "22.94 ft" → 22.94. Anything without a number is not a frontage reading. */
export function frontageFeet(raw: string | null | undefined): number | null {
  const match = String(raw ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

/** Two readings agree when they round to the same foot. */
function sameFrontage(a: number, b: number): boolean {
  return Math.round(a) === Math.round(b);
}

export interface AccessFrontageInput {
  /** The parcel record's land-locked flag, verbatim. */
  landlockedStatus?: string | null;
  /** Every retained frontage reading, from every provider that carried one. */
  frontageReadings?: RetainedFrontageReading[];
  /** A recorded easement or private-drive right, when one is actually on record. */
  recordedAccessRight?: string | null;
  /** True when the parcel record itself was read at all. */
  parcelRecordRead?: boolean;
}

/**
 * Discovery-stage access, on the existing LandOS doctrine.
 *
 * A parcel that is not flagged land-locked and credibly fronts a recognized
 * road HAS access at this stage. Deed and easement research is later diligence,
 * not a precondition for ordinary obvious frontage access — and it is required
 * here only when the retained evidence itself says access is doubtful.
 */
export function readAccess(input: AccessFrontageInput): AccessRead {
  const flag = String(input.landlockedStatus ?? '').trim();
  const landlocked = LANDLOCKED_AFFIRMATIVE.test(flag)
    ? true
    : LANDLOCKED_NEGATIVE.test(flag)
      ? false
      : null;
  const readings = input.frontageReadings ?? [];
  const positive = readings.filter((reading) => (reading.feet ?? 0) > 0);
  const recorded = input.recordedAccessRight?.trim() || null;

  if (landlocked === true) {
    return {
      state: 'not_established',
      established: false,
      landlocked: true,
      statement: recorded
        ? `The parcel record flags this parcel land-locked; access rests on ${recorded} and requires recorded confirmation.`
        : 'The parcel record affirmatively flags this parcel land-locked. Access is not established at the screening stage.',
    };
  }
  if (recorded) {
    return {
      state: 'established',
      established: true,
      landlocked,
      statement: `Access established at the discovery stage through ${recorded}, independently of direct public-road frontage.`,
    };
  }
  if (landlocked === false && positive.length > 0) {
    return {
      state: 'established',
      established: true,
      landlocked: false,
      statement: 'Access established at the discovery stage: the parcel record shows road frontage and carries no land-locked flag. Recorded-instrument confirmation remains later diligence.',
    };
  }
  if (landlocked === false && readings.length === 0) {
    return {
      state: 'unknown',
      established: false,
      landlocked: false,
      statement: 'The parcel record carries no land-locked flag, but no frontage or access evidence is retained, so access is not established either way.',
    };
  }
  if (readings.length > 0 && positive.length === 0) {
    return {
      state: 'not_established',
      established: false,
      landlocked,
      statement: 'Every retained frontage reading is zero, so no road abutment is evidenced. Access needs a recorded easement or an official access record.',
    };
  }
  return {
    state: 'unknown',
    established: false,
    landlocked,
    statement: input.parcelRecordRead
      ? 'The parcel record was read and carries no usable access evidence.'
      : 'No access evidence has been retrieved for this parcel.',
  };
}

/**
 * Road frontage, answered independently of access.
 *
 * Retained readings that disagree are reported as a conflict at their real
 * values, never averaged, never silently resolved to whichever provider ran
 * last, and never repaired by running the same providers again.
 */
export function readFrontage(input: AccessFrontageInput): FrontageRead {
  const readings = (input.frontageReadings ?? []).filter((reading) => reading.feet != null);
  if (!readings.length) {
    return {
      state: 'unresolved',
      feet: null,
      readings: [],
      statement: input.parcelRecordRead
        ? 'The parcel record was read and carries no road-frontage figure.'
        : 'No road-frontage figure has been retrieved for this parcel.',
    };
  }
  const values = readings.map((reading) => reading.feet as number);
  const agreed = values.every((value) => sameFrontage(value, values[0]));
  if (!agreed) {
    const sorted = [...readings].sort((a, b) => (a.feet as number) - (b.feet as number));
    return {
      state: 'conflicting',
      feet: null,
      readings,
      statement: `Retained frontage evidence conflicts at ${sorted.map((reading) => `${reading.raw} (${reading.source})`).join(' vs ')}. The exact amount requires confirmation; access is answered separately.`,
    };
  }
  return {
    state: 'established',
    feet: values[0],
    readings,
    statement: `Road frontage retained at ${readings[0].raw}${readings.length > 1 ? ` (${readings.length} sources agree)` : ` (${readings[0].source})`}. Survey-grade confirmation remains ordinary later diligence.`,
  };
}

// ── Public water and sewer ───────────────────────────────────────────────────

/** The availability vocabulary the existing utilities screening already uses. */
export type RetainedUtilityAvailability = 'mapped_available' | 'likely' | 'unlikely' | 'unknown';

export type PublicServiceState = 'available' | 'unresolved' | 'not_screened';

export interface PublicServiceRead {
  state: PublicServiceState;
  statement: string;
  /** The official sources the screen actually opened, for the operator. */
  sourcesChecked: string[];
}

export interface RetainedUtilityScreen {
  publicWater: RetainedUtilityAvailability;
  publicSewer: RetainedUtilityAvailability;
  /** What the screen actually attempted, in its own words. */
  researchAttempted: string[];
  screenedAt: string | null;
}

function publicService(
  label: string,
  availability: RetainedUtilityAvailability,
  screen: RetainedUtilityScreen,
): PublicServiceRead {
  const sourcesChecked = screen.researchAttempted.filter((entry) => entry.trim());
  if (availability === 'mapped_available' || availability === 'likely') {
    return {
      state: 'available',
      statement: availability === 'mapped_available'
        ? `${label} appears available to this parcel on the official source checked.`
        : `${label} appears available to this parcel; the official source identifies service without mapping a line at the parcel.`,
      sourcesChecked,
    };
  }
  return {
    state: 'unresolved',
    statement: availability === 'unlikely'
      ? `${label} was checked against the official sources available for this jurisdiction and does not appear to serve this parcel. Absence of a mapped line is not proof service is unavailable; the utility authority controls.`
      : `${label} was checked against the official sources available for this jurisdiction and availability could not be established.`,
    sourcesChecked,
  };
}

/** No screen has run: the machine-resolvable check is simply outstanding. */
function notScreened(label: string): PublicServiceRead {
  return {
    state: 'not_screened',
    statement: `No official ${label.toLowerCase()} availability check is on record for this parcel.`,
    sourcesChecked: [],
  };
}

export function readPublicWater(screen: RetainedUtilityScreen | null): PublicServiceRead {
  return screen ? publicService('Public water', screen.publicWater, screen) : notScreened('Public water');
}

export function readPublicSewer(screen: RetainedUtilityScreen | null): PublicServiceRead {
  return screen ? publicService('Public sewer', screen.publicSewer, screen) : notScreened('Public sewer');
}

// ── Private well outlook ─────────────────────────────────────────────────────

export type WellOutlookCategory = 'not_needed' | 'favorable' | 'moderate' | 'difficult' | 'unknown';

/**
 * Readily-available local well context. This is a PRELIMINARY acquisition
 * screen: nearby domestic well records or broad local groundwater context when
 * those are already obtainable, and nothing more. LandOS does not engineer a
 * well, predict yield, or keep searching for a depth number.
 */
export interface RetainedWellContext {
  /** How many nearby domestic well records the screen actually read. */
  nearbyRecordCount: number;
  /** Typical completed depth range across those records, in feet. */
  typicalDepthRangeFt: [number, number] | null;
  /** Broad local groundwater / geology note, when one is readily available. */
  groundwaterNote: string | null;
  source: string;
  sourceUrl: string | null;
}

export interface WellOutlookRead {
  category: WellOutlookCategory;
  statement: string;
}

/** Depth bands for a screening-level read, not an engineering threshold. */
const ORDINARY_DEPTH_FT = 400;
const DEEP_DEPTH_FT = 700;

export function readWellOutlook(
  water: PublicServiceRead,
  context: RetainedWellContext | null,
): WellOutlookRead {
  if (water.state === 'available') {
    return {
      category: 'not_needed',
      statement: 'Not needed — public water appears available to this parcel, so no private-well screen is required at this stage.',
    };
  }
  if (!context || context.nearbyRecordCount <= 0) {
    return {
      category: 'unknown',
      statement: context?.groundwaterNote
        ? `The quick public-source review found no nearby domestic well records. ${context.groundwaterNote}`
        : 'No nearby domestic well records or readily available local groundwater context were established by the quick public-source review. This is a screening gap, not evidence that a well is difficult here.',
    };
  }
  const range = context.typicalDepthRangeFt;
  const depthNote = range
    ? ` Nearby domestic wells commonly appear around roughly ${range[0]}–${range[1]} ft.`
    : '';
  const deepest = range ? range[1] : null;
  const category: WellOutlookCategory = deepest == null
    ? 'favorable'
    : deepest >= DEEP_DEPTH_FT
      ? 'difficult'
      : deepest > ORDINARY_DEPTH_FT
        ? 'moderate'
        : 'favorable';
  const lead = category === 'favorable'
    ? 'Private wells appear common and ordinary for this area.'
    : category === 'moderate'
      ? 'Wells appear feasible, and nearby records suggest deeper or potentially more expensive drilling.'
      : 'Nearby records suggest unusually deep well conditions for this area.';
  return {
    category,
    statement: `${lead} ${context.nearbyRecordCount} nearby domestic well record(s) reviewed via ${context.source}.${depthNote}${context.groundwaterNote ? ` ${context.groundwaterNote}` : ''} Screening only — actual yield and depth are decided by drilling.`,
  };
}

// ── Preliminary septic outlook ───────────────────────────────────────────────

export type SepticLimitationRating = 'not_limited' | 'somewhat_limited' | 'very_limited' | 'unknown';
export type SepticOutlookCategory = 'not_needed' | 'favorable' | 'mixed' | 'poor' | 'unknown';

/** One retained soil unit on the subject. Several units are the normal case. */
export interface RetainedSoilUnit {
  symbol: string | null;
  name: string;
  /** Share of the subject this unit covers, when actually retained. */
  parcelPercentage: number | null;
  approximateAcres: number | null;
  /** Official absorption-field ratings across this unit's components. */
  ratings: SepticLimitationRating[];
  drainageClass: string | null;
  limitingFactors: string[];
}

export interface SepticOutlookRead {
  category: SepticOutlookCategory;
  statement: string;
  /** Share of the subject screening more favorably, when shares are retained. */
  favorableSharePct: number | null;
  /** Share screening less favorably, when shares are retained. */
  limitedSharePct: number | null;
}

const RATING_LABEL: Record<SepticLimitationRating, string> = {
  not_limited: 'not limited',
  somewhat_limited: 'somewhat limited',
  very_limited: 'very limited',
  unknown: 'unrated',
};

const SCREENING_ONLY =
  'Screening only — this never predicts a passing perc test and never replaces a soil evaluation or health-department review.';

/**
 * Preliminary septic screening from the RETAINED subject soils.
 *
 * Multiple mapped units contribute: the outlook is favorable only when every
 * rated unit screens favorably, poor only when the limited units dominate, and
 * mixed whenever the parcel carries both better and worse ground — which is a
 * siting question, not a parcel-level answer.
 */
export function readSepticOutlook(
  sewer: PublicServiceRead,
  units: RetainedSoilUnit[],
): SepticOutlookRead {
  if (sewer.state === 'available') {
    return {
      category: 'not_needed',
      statement: 'Not needed — public sewer appears available to this parcel, so no onsite septic screen is required at this stage.',
      favorableSharePct: null,
      limitedSharePct: null,
    };
  }
  if (!units.length) {
    return {
      category: 'unknown',
      statement: 'No subject soil information is retained, so no preliminary septic outlook can be stated. ' + SCREENING_ONLY,
      favorableSharePct: null,
      limitedSharePct: null,
    };
  }

  const classify = (unit: RetainedSoilUnit): SepticLimitationRating => {
    const rated = unit.ratings.filter((rating) => rating !== 'unknown');
    if (!rated.length) return 'unknown';
    if (rated.includes('very_limited')) return 'very_limited';
    if (rated.every((rating) => rating === 'not_limited')) return 'not_limited';
    return 'somewhat_limited';
  };

  const classified = units.map((unit) => ({ unit, rating: classify(unit) }));
  const rated = classified.filter((entry) => entry.rating !== 'unknown');
  if (!rated.length) {
    return {
      category: 'unknown',
      statement: `${units.length} soil unit(s) are mapped on the subject, but none carries a published septic absorption-field interpretation. ${SCREENING_ONLY}`,
      favorableSharePct: null,
      limitedSharePct: null,
    };
  }

  const sharesRetained = units.every((unit) => unit.parcelPercentage != null);
  const share = (entries: typeof classified) => sharesRetained
    ? Math.round(entries.reduce((total, entry) => total + (entry.unit.parcelPercentage ?? 0), 0))
    : null;
  const favorableUnits = classified.filter((entry) => entry.rating === 'not_limited');
  const limitedUnits = classified.filter((entry) => entry.rating === 'very_limited');
  const middleUnits = classified.filter((entry) => entry.rating === 'somewhat_limited');

  const category: SepticOutlookCategory = limitedUnits.length === rated.length
    ? 'poor'
    : favorableUnits.length === rated.length
      ? 'favorable'
      : 'mixed';

  const breakdown = classified
    .map((entry) => `${entry.unit.symbol ? `${entry.unit.symbol} — ` : ''}${entry.unit.name}: ${RATING_LABEL[entry.rating]}${entry.unit.parcelPercentage != null ? ` (~${entry.unit.parcelPercentage}% of the subject)` : entry.unit.approximateAcres != null ? ` (~${entry.unit.approximateAcres} mapped acres)` : ''}`)
    .join('; ');

  const lead = category === 'favorable'
    ? 'Most of the apparent usable area carries soils generally favorable for conventional septic screening.'
    : category === 'poor'
      ? 'Retained soil characteristics suggest meaningful septic limitations across the mapped units.'
      : middleUnits.length === rated.length
        ? 'The retained soils screen as partly limited for conventional absorption fields; some areas may be better candidates than others.'
        : 'The subject carries a mix of more and less favorable soil conditions. Some areas may be better candidates than others.';

  const shareNote = sharesRetained
    ? ''
    : ' Per-unit parcel shares are not retained, so favorable and limited acreage cannot be split; findings are reported per mapped unit.';

  return {
    category,
    statement: `${lead} ${breakdown}.${shareNote} ${SCREENING_ONLY}`,
    favorableSharePct: share(favorableUnits),
    limitedSharePct: share(limitedUnits),
  };
}

// ── Existing installed improvements ──────────────────────────────────────────

/**
 * An existing well or septic system is a SEPARATE fact from the outlook screens
 * above. A seller statement about one stays labeled seller-reported until it is
 * independently verified, and it never overwrites the research history.
 */
export interface ExistingSiteImprovement {
  kind: 'well' | 'septic';
  present: boolean;
  detail: string | null;
  /** Where the statement came from. Seller statements are never verified truth. */
  basis: 'official_record' | 'property_record' | 'seller_reported';
  reportedAt: string | null;
}

export function existingImprovementStatement(improvement: ExistingSiteImprovement): string {
  const noun = improvement.kind === 'well' ? 'Existing well' : 'Existing septic';
  const detail = improvement.detail?.trim() ? ` ${improvement.detail.trim().replace(/\.?$/, '.')}` : '';
  if (improvement.basis === 'seller_reported') {
    return `${noun}: seller reported — not independently verified.${detail}`;
  }
  return `${noun}: ${improvement.basis === 'official_record' ? 'established from an official record' : 'carried on the retained property record'}.${detail}`;
}
