// LandOS — WHAT A MAPPED UTILITY LINE'S POSITION MEANS FOR UNDEVELOPED LAND.
//
// WHY THIS EXISTS. The utility model carried an implicit assumption that is
// wrong for the asset class LandOS underwrites: that a main CROSSING the
// subject parcel is the strong outcome, and that a main stopping short of it is
// an extension problem. Read that way, the Fairview subject — a 2025 public
// water main thirteen feet off its north boundary with a hydrant at the same
// distance — came out sounding like a deficiency.
//
// It is the opposite. A public water or sewer authority does not build its
// public main into an undeveloped private parcel because the parcel is vacant.
// Public infrastructure lives in the road right-of-way, along the frontage, in
// a utility easement, or inside the adjoining development, and the buyer or
// developer connects to it from there. Frontage and property edge are not the
// consolation prize for undeveloped land; they are the ideal normal condition.
//
// So "the main does not cross the subject parcel" is not, on its own, negative,
// and it is never scored as one here. The question this module answers is the
// one an acquisition actually turns on:
//
//     HOW PRACTICALLY CLOSE IS SERVING INFRASTRUCTURE
//     TO A VIABLE CONNECTION POINT ON THIS PARCEL?
//
// WHAT THIS MODULE DOES NOT DO. Position is one question of seven, and the
// other six are decisions a utility authority makes: connection approval,
// capacity, fire flow, the tap or lateral or extension requirement, the
// easement or right-of-way mechanics, and the cost. A very strong position
// establishes NONE of them, and the guards below say so as callable functions
// rather than as prose. Thirteen feet is a strong site, not a will-serve letter.
//
// Pure. No I/O, no clock, no model, no browser. Nothing here names a city,
// county, provider, layer or parcel.

import type { UtilityKind, UtilityLineRelationship } from './utility-infrastructure-relationship.js';

/**
 * Whether the subject carries improvements today.
 *
 * It matters in exactly one place — how to read a line drawn ACROSS the parcel
 * — and nowhere else. The positive reading of frontage, right-of-way and
 * property-edge infrastructure is not conditioned on it, because a public main
 * sits in the right-of-way for improved and undeveloped parcels alike.
 */
export type SubjectDevelopmentStatus = 'vacant' | 'improved' | 'unknown';

/**
 * Where the mapped line physically sits relative to a viable connection point.
 *
 * `crosses_site` is deliberately not the top of this list. A drawn line inside
 * a parcel boundary is not worth more than a main at the frontage, and on
 * undeveloped land it is frequently not a public main at all — see
 * `crossingLineCaution`.
 */
export type UtilitySitePosition =
  /** A line is drawn across the parcel itself. */
  | 'crosses_site'
  /** Along the frontage, in the adjoining right-of-way, or at the boundary. */
  | 'at_site_edge'
  /** Immediately adjacent, or inside a directly connected development. */
  | 'adjoining_site'
  /** Same road or corridor, at a distance that implies a short extension. */
  | 'same_corridor'
  /** Present in the vicinity but on another road or corridor. */
  | 'off_corridor'
  /** Nothing serviceable was found within reach of this parcel. */
  | 'no_practical_infrastructure'
  | 'unestablished';

/** The acquisition weight of a position. Not a probability of service. */
export type UtilityInfrastructureSignal =
  | 'very_strong_positive'
  | 'strong_positive'
  | 'positive'
  | 'context_only'
  | 'material_negative'
  | 'unestablished';

/** Where the mapped line sits, as read off the layer. Language, and one rule. */
export type UtilityCorridorSetting =
  /** Public road right-of-way — the normal home of a public main. */
  | 'public_row'
  /** A recorded or platted utility easement. */
  | 'utility_easement'
  /** Inside a neighbouring subdivision or project, not in public right-of-way. */
  | 'adjoining_development'
  /** Drawn inside the subject's own boundary. */
  | 'within_subject'
  | 'unknown';

/**
 * The distance below which infrastructure is at the property edge.
 *
 * Chosen to match how a connection is actually built: within a few tens of
 * feet, the work is a service lateral or a tap, not a main extension project.
 */
export const SITE_EDGE_FEET = 25;

/**
 * The distance below which infrastructure is still a near-site position.
 *
 * Beyond it the conversation becomes a main extension with a route, a length
 * and a price, which is a different underwriting question — real, and still
 * not a negative on its own.
 */
export const NEAR_SITE_FEET = 200;

const SIGNAL_BY_POSITION: Readonly<Record<UtilitySitePosition, UtilityInfrastructureSignal>> = {
  // Equal to `at_site_edge`, never greater. Geometry inside a boundary is not
  // a better acquisition fact than a main at the frontage.
  crosses_site: 'very_strong_positive',
  at_site_edge: 'very_strong_positive',
  adjoining_site: 'strong_positive',
  same_corridor: 'positive',
  off_corridor: 'context_only',
  no_practical_infrastructure: 'material_negative',
  unestablished: 'unestablished',
};

const SIGNAL_RANK: Readonly<Record<UtilityInfrastructureSignal, number>> = {
  unestablished: 0,
  material_negative: 1,
  context_only: 2,
  positive: 3,
  strong_positive: 4,
  very_strong_positive: 5,
};

export const UTILITY_SITE_POSITION_LABEL: Readonly<Record<UtilitySitePosition, string>> = {
  crosses_site: 'Line crosses the parcel',
  at_site_edge: 'Infrastructure at the property edge',
  adjoining_site: 'Infrastructure adjoining the site',
  same_corridor: 'Same corridor, short extension',
  off_corridor: 'Different corridor — context only',
  no_practical_infrastructure: 'No serving infrastructure found in reach',
  unestablished: 'Position unestablished',
};

export const UTILITY_INFRASTRUCTURE_SIGNAL_LABEL: Readonly<Record<UtilityInfrastructureSignal, string>> = {
  very_strong_positive: 'Very strong positive',
  strong_positive: 'Strong positive',
  positive: 'Positive',
  context_only: 'Context only',
  material_negative: 'Material negative',
  unestablished: 'Not established',
};

export function utilityInfrastructureSignal(position: UtilitySitePosition): UtilityInfrastructureSignal {
  return SIGNAL_BY_POSITION[position];
}

export function utilityInfrastructureSignalRank(signal: UtilityInfrastructureSignal): number {
  return SIGNAL_RANK[signal];
}

/** True when the position is a favourable acquisition fact rather than a risk. */
export function isFavorableInfrastructurePosition(position: UtilitySitePosition): boolean {
  return SIGNAL_RANK[SIGNAL_BY_POSITION[position]] >= SIGNAL_RANK.positive;
}

// ── The prohibitions, as callable guards ─────────────────────────────────────
//
// Each returns a constant, and each is correct to. They exist so the rule can
// be asserted in a test and called at a decision point rather than living in a
// comment above the code that drifts away from it.

/**
 * A main that does not cross a parcel is not thereby a deficiency.
 *
 * This is the correction. A public provider does not run its main into private
 * undeveloped ground; it runs it in the right-of-way and the developer connects
 * from there. Scoring the absence of a crossing main as a problem penalises the
 * normal, healthy condition of well-served vacant land.
 */
export function absentCrossingMainIsDeficiency(_subject: SubjectDevelopmentStatus): false {
  return false;
}

/**
 * A line crossing the parcel does not outrank a line at the frontage.
 *
 * Rewarding geometry for its own sake is what produced the inverted reading
 * this module replaces.
 */
export function crossingSiteOutranksSiteEdge(): false {
  return false;
}

/** However close the pipe is, position is not permission to connect to it. */
export function infrastructurePositionEstablishesConnection(_position: UtilitySitePosition): false {
  return false;
}

/** Nor is it water in the main, flow at the hydrant, or room at the plant. */
export function infrastructurePositionEstablishesCapacity(_position: UtilitySitePosition): false {
  return false;
}

/** Straight-line nearness on another corridor is not a serving position. */
export function straightLineProximityEstablishesPosition(): false {
  return false;
}

// ── Reading a position ───────────────────────────────────────────────────────

export interface UtilitySitePositionInput {
  kind: UtilityKind;
  relationship: UtilityLineRelationship;
  /**
   * Measured distance from the mapped line to the subject boundary.
   *
   * Null is honest and common: many layers are read without a measurement. It
   * never degrades the reading below what the relationship alone supports.
   */
  distanceToBoundaryFeet?: number | null;
  setting?: UtilityCorridorSetting;
  subjectDevelopment?: SubjectDevelopmentStatus;
  mainSizeInches?: number | null;
}

export interface UtilitySitePositionReading {
  position: UtilitySitePosition;
  signal: UtilityInfrastructureSignal;
  /** Short operator-facing name for the position, distance included. */
  label: string;
  /** The acquisition reading. Says what is favourable and what is still open. */
  statement: string;
  /** The connection work the position implies. Never a feasibility verdict. */
  connectionPath: string;
  /** Set only where the geometry could mislead. Usually null. */
  caution: string | null;
  /** What a strong position still does not settle. Always populated. */
  stillOpen: readonly string[];
}

/**
 * The seven questions this module keeps apart.
 *
 * A very strong infrastructure position answers the first and none of the rest.
 * They are listed on every reading, including the strongest, because a favourable
 * position is exactly the moment a reader is tempted to collapse them.
 */
export const UTILITY_POSITION_STILL_OPEN = [
  'connection approval by the serving provider',
  'system capacity for the contemplated use',
  'fire flow, where the use requires it',
  'the tap, lateral or main-extension requirement',
  'easement or right-of-way mechanics for the connection',
  'connection and extension cost',
] as const;

/** "an 8-inch main", "a 6-inch main". Sizes are read aloud, so the article follows the spoken number. */
function indefinite(inches: number): 'a' | 'an' {
  const spoken = String(Math.round(inches));
  return spoken === '8' || spoken.startsWith('8') || spoken === '11' || spoken === '18' ? 'an' : 'a';
}

function distanceLabel(feet: number | null | undefined): string | null {
  if (feet == null || !Number.isFinite(feet) || feet < 0) return null;
  return `~${Math.round(feet)} ft from the boundary`;
}

function settingPhrase(setting: UtilityCorridorSetting): string | null {
  switch (setting) {
    case 'public_row': return 'in the adjoining public right-of-way';
    case 'utility_easement': return 'in a utility easement';
    case 'adjoining_development': return 'inside the adjoining development';
    case 'within_subject': return 'inside the subject boundary';
    case 'unknown':
    default: return null;
  }
}

/**
 * Bucket a measured distance.
 *
 * Applied to the two relationships that describe a line near or along the
 * parcel. A relationship-only default stands in when nothing was measured, so
 * an unmeasured read is never punished for the missing number.
 */
function positionFromDistance(
  feet: number,
  fallback: UtilitySitePosition,
): UtilitySitePosition {
  if (feet <= SITE_EDGE_FEET) return 'at_site_edge';
  if (feet <= NEAR_SITE_FEET) return 'adjoining_site';
  // Beyond near-site the line is still on this corridor; it is an extension
  // conversation, which is a cost question and not a feasibility failure.
  return fallback === 'at_site_edge' || fallback === 'adjoining_site' ? 'same_corridor' : fallback;
}

export function readUtilitySitePosition(input: UtilitySitePositionInput): UtilitySitePositionReading {
  const subject = input.subjectDevelopment ?? 'unknown';
  const setting = input.setting ?? 'unknown';
  const feet = input.distanceToBoundaryFeet ?? null;
  const measured = feet != null && Number.isFinite(feet) && feet >= 0 ? feet : null;

  let position: UtilitySitePosition;
  switch (input.relationship) {
    case 'AT_SUBJECT':
      position = 'crosses_site';
      break;
    case 'ON_SUBJECT_ROAD':
      // A main in the road the parcel fronts is the ideal normal condition for
      // undeveloped land, so frontage is the default rather than something the
      // read has to earn with a measurement.
      position = measured != null ? positionFromDistance(measured, 'at_site_edge') : 'at_site_edge';
      break;
    case 'ADJACENT':
      position = measured != null
        ? positionFromDistance(measured, 'adjoining_site')
        // Right-of-way and easement are where public mains belong; an unmeasured
        // adjacent line in one of them is at the edge, not merely beside it.
        : (setting === 'public_row' || setting === 'utility_easement' ? 'at_site_edge' : 'adjoining_site');
      break;
    case 'NEARBY':
      position = 'off_corridor';
      break;
    case 'NOT_SHOWN':
      position = 'no_practical_infrastructure';
      break;
    case 'UNKNOWN':
    default:
      position = 'unestablished';
      break;
  }

  const signal = SIGNAL_BY_POSITION[position];
  const utility = input.kind === 'water' ? 'Public water' : 'Public sewer';
  const provider = input.kind === 'water' ? 'the water provider' : 'the sewer authority';
  const sized = input.mainSizeInches ? `${indefinite(input.mainSizeInches)} ${input.mainSizeInches}-inch main` : 'a main';
  const where = [settingPhrase(setting), distanceLabel(measured)].filter(Boolean).join(', ');
  const whereSuffix = where ? ` ${where}` : '';

  const label = measured != null
    ? `${UTILITY_SITE_POSITION_LABEL[position]} · ${distanceLabel(measured)}`
    : UTILITY_SITE_POSITION_LABEL[position];

  let statement: string;
  let connectionPath: string;
  let caution: string | null = null;

  switch (position) {
    case 'crosses_site':
      statement = `${utility} infrastructure is drawn across the subject itself: ${sized}${whereSuffix}. A line inside the boundary is a strong position, and it is not a stronger acquisition fact than a public main at the frontage — what matters is a viable connection point, which either provides.`;
      connectionPath = `Establish with ${provider} whether the line inside the boundary is a public main available for connection or a private service, and on what terms.`;
      if (subject === 'vacant') {
        // The reason this case is called out rather than celebrated. A provider
        // does not normally build public main into undeveloped private ground,
        // so a line inside a vacant boundary is often a private lateral or an
        // abandoned service left by a former structure — real evidence, and a
        // different thing from a public main available to a new development.
        caution = 'On undeveloped land a line drawn inside the boundary is frequently a private service lateral or an abandoned connection from a former structure rather than a public main. Historical private service is not the baseline expectation for vacant land and does not by itself indicate a public connection point.';
      }
      break;
    case 'at_site_edge':
      statement = `${utility} infrastructure effectively reaches the property edge: ${sized}${whereSuffix}. For undeveloped land this is the normal and favourable condition — a public provider builds its main in the right-of-way, along the frontage or in the adjoining development, and the buyer connects from there. The main not crossing the parcel is not a deficiency.`;
      connectionPath = `The indicated path is a tap or short service connection from the main already at the boundary. Length is short; ${provider}'s connection terms, any easement or right-of-way mechanics, and cost are still to be established.`;
      break;
    case 'adjoining_site':
      statement = `${utility} infrastructure adjoins the site: ${sized}${whereSuffix}. This is a favourable near-site position — serving infrastructure is present at the property, and reaching it is a connection question rather than a question of whether the public system comes anywhere near this land.`;
      connectionPath = `The indicated path is a short extension or service connection from the adjoining infrastructure. Trace the actual route rather than assuming it; connection rights, route, easements and cost remain with ${provider}.`;
      break;
    case 'same_corridor':
      statement = `${utility} infrastructure is on the subject's own corridor: ${sized}${whereSuffix}. The public system serves this road, and reaching the parcel is an extension of known length along a known route — a cost and mechanics question, not an availability failure.`;
      connectionPath = `Price the extension along the corridor and confirm with ${provider} what it will require: main size, materials, easements, and whether it must be dedicated on completion.`;
      break;
    case 'off_corridor':
      statement = `${utility} infrastructure was found in the vicinity but on a different road or corridor. Straight-line nearness is not a serving position: how another corridor is served says nothing about this parcel's frontage. Carried as context only.`;
      connectionPath = `Establish whether any infrastructure reaches the subject's own corridor before treating this as a connection path.`;
      break;
    case 'no_practical_infrastructure':
      statement = `${utility}: the official layer that was read draws no serving infrastructure within practical reach of this parcel. That is a material negative for a development that needs public service, though absence on a map is not proof of unavailability — ${provider} controls.`;
      connectionPath = `Confirm with ${provider} whether any main exists within reach, and what an extension to this parcel would involve.`;
      break;
    case 'unestablished':
    default:
      statement = `${utility}: no usable official layer was read for this corridor, so the position of serving infrastructure relative to this parcel is unestablished. This is an unanswered question, not a negative finding.`;
      connectionPath = `Read an official ${input.kind} layer or provider service map covering this parcel.`;
      break;
  }

  return {
    position,
    signal,
    label,
    statement,
    connectionPath,
    caution,
    stillOpen: [...UTILITY_POSITION_STILL_OPEN],
  };
}

/**
 * The one-line acquisition read of a position, for headlines and metric rows.
 *
 * Deliberately says what the infrastructure DOES, then what is still pending,
 * in that order. "No main crosses parcel; extension likely required" is the
 * sentence this replaces.
 */
export function utilityPositionHeadlineFragment(reading: UtilitySitePositionReading): string {
  switch (reading.position) {
    case 'crosses_site': return `line drawn across the parcel${reading.caution ? ' (verify public vs private)' : ''}`;
    case 'at_site_edge': return 'main at the property edge';
    case 'adjoining_site': return 'main adjoining the site';
    case 'same_corridor': return 'main on the subject corridor';
    case 'off_corridor': return 'infrastructure on another corridor only';
    case 'no_practical_infrastructure': return 'no serving infrastructure found in reach';
    case 'unestablished':
    default: return 'infrastructure position unestablished';
  }
}
