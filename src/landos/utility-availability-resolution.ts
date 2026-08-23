// LandOS — UTILITY AVAILABILITY RESOLUTION.
//
// WHY THIS EXISTS. "Water Authority of Dickson County" is a true sentence that
// answers nothing. The Fairview Gold Run returned a provider name and the
// utility lane counted itself answered, while every question an acquisition
// actually turns on — is there a main on this road, may this parcel connect, is
// there capacity, who pays for the extension — remained untouched.
//
// The repair is to stop treating "utilities" as ONE question. It is six, they
// are answered by different evidence at different strengths, and the distance
// between them is where land deals die:
//
//   PROVIDER            who would serve this parcel if anyone does
//   SERVICE TERRITORY   whether the parcel sits inside that provider's area
//   INFRASTRUCTURE      where pipe physically is, relative to this parcel
//   CONNECTION          whether this parcel may actually be served
//   CAPACITY            whether there is water/flow to give it
//   EXTENSION           what would have to be built first
//
// Each is recorded on its own, with the evidence LEVEL that carried it, and no
// dimension is ever allowed to answer the one below it. That prohibition is the
// entire point of the module and is implemented as callable guards rather than
// as prose someone can drift away from.
//
// This is a SYSTEM-WIDE contract. Nothing here names a city, county, state,
// utility district, layer, or selector; a Fairview answer and a future answer
// three states away travel through the same vocabulary.
//
// Pure. No I/O, no clock, no model, no browser.

import type { ResearchLaneOutcome } from './research-lane-outcome.js';
import {
  UTILITY_ENTITLEMENTS_NOT_ESTABLISHED,
  type UtilityKind,
  type UtilityLineRelationship,
} from './utility-infrastructure-relationship.js';
import {
  readUtilitySitePosition,
  utilityPositionHeadlineFragment,
  type SubjectDevelopmentStatus,
  type UtilityCorridorSetting,
  type UtilityInfrastructureSignal,
  type UtilitySitePosition,
  type UtilitySitePositionReading,
} from './utility-site-position.js';

export type { UtilityKind, UtilityLineRelationship };
export type { SubjectDevelopmentStatus, UtilityCorridorSetting, UtilityInfrastructureSignal, UtilitySitePosition };

// ── Evidence levels ──────────────────────────────────────────────────────────

/**
 * How close a piece of evidence gets to the question the operator asked.
 *
 * The ordering is real and load-bearing. Area evidence is CONTEXT: it says
 * public infrastructure exists somewhere around here. Corridor evidence says a
 * line exists on this road. Subject evidence says THIS parcel may be served. A
 * researcher moves UP this ladder by finding better evidence, never by
 * restating weaker evidence more confidently.
 */
export type UtilityEvidenceLevel =
  /** Level 1 — service exists in the surrounding area. Context only. */
  | 'area_service'
  /** Level 2 — an actual line on or immediately along the subject corridor. */
  | 'corridor_infrastructure'
  /** Level 3 — this parcel can be served, from the party that decides. */
  | 'subject_availability';

const LEVEL_RANK: Readonly<Record<UtilityEvidenceLevel, number>> = {
  area_service: 1,
  corridor_infrastructure: 2,
  subject_availability: 3,
};

export const UTILITY_EVIDENCE_LEVEL_LABEL: Readonly<Record<UtilityEvidenceLevel, string>> = {
  area_service: 'Area service evidence (context)',
  corridor_infrastructure: 'Corridor infrastructure evidence',
  subject_availability: 'Subject availability evidence',
};

/**
 * The one promotion rule.
 *
 * Evidence supports a claim at its own level or below. It never supports a
 * claim above it — no matter how many independent pieces of it there are, and
 * no matter how confident the sentence around it sounds. Thirty houses on
 * public water is thirty pieces of AREA evidence; it is not a main on the
 * subject's road, and it is certainly not a connection.
 */
export function evidenceSupports(held: UtilityEvidenceLevel, claimed: UtilityEvidenceLevel): boolean {
  return LEVEL_RANK[held] >= LEVEL_RANK[claimed];
}

/** The strongest level actually held, or `null` when nothing was established. */
export function strongestEvidenceLevel(
  levels: readonly UtilityEvidenceLevel[],
): UtilityEvidenceLevel | null {
  let best: UtilityEvidenceLevel | null = null;
  for (const level of levels) {
    if (!best || LEVEL_RANK[level] > LEVEL_RANK[best]) best = level;
  }
  return best;
}

// ── The prohibitions, as callable guards ─────────────────────────────────────
//
// Each returns `false` unconditionally, and each is correct to do so. They
// exist so the rule can be asserted in a test and called at a decision point
// instead of living in a comment above the code that violates it.

/** Being inside a service territory does not put a pipe in the ground. */
export function serviceTerritoryEstablishesInfrastructure(): false {
  return false;
}

/** Public service somewhere in the area is not a line on this road. */
export function areaServiceEstablishesCorridorInfrastructure(): false {
  return false;
}

/** A line at the frontage is not permission to tap it. */
export function corridorInfrastructureEstablishesConnection(): false {
  return false;
}

/** Permission to connect is not water in the pipe or flow at the hydrant. */
export function connectionEstablishesCapacity(): false {
  return false;
}

/** How the neighbours are served is not how the subject may be served. */
export function neighborhoodPatternEstablishesSubjectConnection(): false {
  return false;
}

/** What a previous developer PLANNED is not what exists or is allowed today. */
export function historicalPlanEstablishesCurrentAvailability(): false {
  return false;
}

// ── Dimension vocabularies ───────────────────────────────────────────────────

export type UtilityProviderState = 'identified' | 'unresolved';

export type UtilityServiceTerritoryState =
  /** The parcel falls inside the provider's mapped service area. */
  | 'inside'
  /** The parcel falls outside it. */
  | 'outside'
  /** The provider publishes no territory the screen could read. */
  | 'not_mapped'
  | 'unresolved';

export type UtilityConnectionState =
  | 'available'
  | 'conditionally_available'
  | 'written_confirmation_required'
  | 'not_available'
  | 'unresolved';

export type UtilityCapacityState =
  | 'confirmed'
  | 'limited'
  | 'not_confirmed'
  | 'written_confirmation_required';

export type UtilityExtensionState =
  | 'not_indicated'
  | 'likely_required'
  | 'confirmed_required'
  | 'unresolved';

/** Sewer only: what kind of collection the evidence actually showed. */
export type SewerLineType = 'gravity' | 'force_main' | 'other' | 'unknown';

/** One dimension of the answer, with the level of evidence that carried it. */
export interface UtilityDimension<TState extends string> {
  state: TState;
  /** Null when nothing was established — an honest empty, not a weak claim. */
  basis: UtilityEvidenceLevel | null;
  /** What the operator reads. Always says what the evidence does NOT settle. */
  statement: string;
  /** The sources that carried it, named so the operator can reopen them. */
  sources: string[];
}

// ── Inputs ───────────────────────────────────────────────────────────────────

/** One named source behind an observation. */
export interface UtilityObservationSource {
  label: string;
  url?: string | null;
  /** Set when the observation was established visually on a map. */
  screenshotPath?: string | null;
  retrievedAt?: string | null;
}

export interface UtilityProviderObservation {
  name: string;
  /** Municipal, county, regional authority, district, private — verbatim. */
  providerType: string | null;
  /**
   * Being inside a city NEVER implies the city supplies the utility. This flag
   * records that the basis was an actual utility record rather than an
   * inference from a municipal boundary.
   */
  basisIsUtilityRecord: boolean;
  source: UtilityObservationSource;
}

export interface UtilityTerritoryObservation {
  state: Exclude<UtilityServiceTerritoryState, 'unresolved'>;
  source: UtilityObservationSource;
}

/** A line read off an official layer or provider map. Geometry only. */
export interface UtilityCorridorObservation {
  relationship: UtilityLineRelationship;
  /** The layer actually toggled on, so the read is reproducible. */
  layerName: string | null;
  /**
   * Measured distance from the mapped line to the subject boundary.
   *
   * The number an acquisition actually turns on: thirteen feet and two hundred
   * feet are both "adjacent" and are not the same deal. Null is honest — the
   * relationship alone still carries the read.
   */
  distanceToBoundaryFeet?: number | null;
  /** Right-of-way, easement, adjoining development. Language, and one rule. */
  setting?: UtilityCorridorSetting;
  mainSizeInches?: number | null;
  pressureZone?: string | null;
  hydrantsObserved?: boolean | null;
  lineType?: SewerLineType;
  liftStationObserved?: boolean | null;
  source: UtilityObservationSource;
}

/** Anything the SERVING PARTY said. The only Level 3 input there is. */
export interface UtilityProviderDetermination {
  connection: Exclude<UtilityConnectionState, 'unresolved'>;
  capacity?: Exclude<UtilityCapacityState, 'written_confirmation_required'> | null;
  extensionRequired?: boolean | null;
  source: UtilityObservationSource;
}

/** Level 1 context, already relevance-gated by `utility-context-leads`. */
export interface UtilityAreaContextObservation {
  /** Short operator-facing sentence, e.g. the neighborhood service pattern. */
  statement: string;
  source: UtilityObservationSource;
}

export interface UtilityResolutionInput {
  kind: UtilityKind;
  /**
   * Whether the subject carries improvements today.
   *
   * Read only where the geometry could mislead — a line drawn inside an
   * undeveloped boundary. It never conditions the favourable reading of
   * frontage or property-edge infrastructure, which is correct for every
   * parcel type. `unknown` is the honest default and changes no score.
   */
  subjectDevelopment?: SubjectDevelopmentStatus;
  provider?: UtilityProviderObservation | null;
  territory?: UtilityTerritoryObservation | null;
  corridor?: UtilityCorridorObservation | null;
  determination?: UtilityProviderDetermination | null;
  /** Level 1 leads that informed the read without establishing anything. */
  areaContext?: UtilityAreaContextObservation[];
  /** A real external wall (login, outage, paywall) rather than a dead end. */
  blocked?: { reason: string } | null;
  /** True when this utility does not materially apply to the subject. */
  notApplicable?: boolean;
}

// ── Resolution ───────────────────────────────────────────────────────────────

export interface UtilityAvailabilityResolution {
  kind: UtilityKind;
  provider: UtilityDimension<UtilityProviderState> & { name: string | null; providerType: string | null };
  territory: UtilityDimension<UtilityServiceTerritoryState>;
  infrastructure: UtilityDimension<UtilityLineRelationship> & {
    layerName: string | null;
    mainSizeInches: number | null;
    pressureZone: string | null;
    lineType: SewerLineType | null;
    liftStationObserved: boolean | null;
    screenshotPath: string | null;
    /**
     * The acquisition read of where that line sits.
     *
     * The relationship above is geometry; this is what the geometry MEANS for
     * a parcel someone is buying to develop. A main at the frontage or the
     * boundary is the normal, favourable condition for undeveloped land, and
     * `signal` says so rather than penalising it for not crossing the parcel.
     */
    position: UtilitySitePosition;
    positionLabel: string;
    signal: UtilityInfrastructureSignal;
    distanceToBoundaryFeet: number | null;
    setting: UtilityCorridorSetting;
    /** The connection work the position implies. Never a feasibility verdict. */
    connectionPath: string;
    /** Set only where the geometry could mislead. Usually null. */
    caution: string | null;
    /** What this position still does not settle. Always populated. */
    stillOpen: readonly string[];
  };
  connection: UtilityDimension<UtilityConnectionState>;
  capacity: UtilityDimension<UtilityCapacityState>;
  extension: UtilityDimension<UtilityExtensionState>;
  /** Level 1 evidence, retained as context and labelled as context. */
  areaContext: Array<{ statement: string; source: string; sourceUrl: string | null }>;
  /** The strongest level anything in this resolution actually reached. */
  highestEvidenceLevel: UtilityEvidenceLevel | null;
  /** What no evidence in this resolution establishes. Always populated. */
  doesNotEstablish: readonly string[];
  /** True when the remaining questions need the serving party, not more search. */
  confirmationRequired: boolean;
  laneOutcome: ResearchLaneOutcome;
  /** One-line operator headline. Never collapses to "utilities unresolved". */
  headline: string;
}

function utilityLabel(kind: UtilityKind): string {
  return kind === 'water' ? 'Public water' : 'Public sewer';
}

function authorityLabel(kind: UtilityKind): string {
  return kind === 'water' ? 'water utility' : 'sewer authority';
}

function sourceLine(source: UtilityObservationSource): string {
  return source.url ? `${source.label} (${source.url})` : source.label;
}

/** The relationship values that mean pipe was actually drawn on this corridor. */
export function corridorInfrastructureShown(relationship: UtilityLineRelationship): boolean {
  return relationship === 'AT_SUBJECT'
    || relationship === 'ON_SUBJECT_ROAD'
    || relationship === 'ADJACENT';
}

/**
 * The infrastructure sentence an operator reads.
 *
 * It is the position reading plus the standing separation: however favourable
 * the position, connection and capacity are still the serving party's to
 * decide. The two halves are concatenated rather than blended so neither can be
 * edited away without the other becoming visibly incomplete.
 */
function infrastructureStatement(kind: UtilityKind, reading: UtilitySitePositionReading): string {
  return `${reading.statement} ${reading.connectionPath}`;
}

function connectionStatement(kind: UtilityKind, state: UtilityConnectionState, hasCorridor: boolean): string {
  const utility = utilityLabel(kind);
  const authority = authorityLabel(kind);
  switch (state) {
    case 'available':
      return `${utility}: the ${authority} states this parcel may be served.`;
    case 'conditionally_available':
      return `${utility}: the ${authority} states service is available subject to stated conditions. Read the conditions before underwriting them as met.`;
    case 'not_available':
      return `${utility}: the ${authority} states this parcel cannot presently be served.`;
    case 'written_confirmation_required':
      return hasCorridor
        ? `${utility}: infrastructure is mapped on this corridor, but the right to connect is a determination only the ${authority} makes. A written availability determination is the remaining step.`
        : `${utility}: public evidence did not establish whether this parcel may connect. A written availability determination from the ${authority} is the remaining step.`;
    case 'unresolved':
    default:
      return `${utility}: connection availability is unestablished, and no public source read so far speaks to it.`;
  }
}

function capacityStatement(kind: UtilityKind, state: UtilityCapacityState): string {
  const utility = utilityLabel(kind);
  const authority = authorityLabel(kind);
  const measure = kind === 'water' ? 'capacity and fire flow' : 'collection and treatment capacity';
  switch (state) {
    case 'confirmed':
      return `${utility}: the ${authority} confirms ${measure} for the contemplated use.`;
    case 'limited':
      return `${utility}: the ${authority} reports ${measure} is constrained. Treat the constraint as an underwriting input, not a footnote.`;
    case 'not_confirmed':
      return `${utility}: ${measure} is not confirmed. No map read can confirm it.`;
    case 'written_confirmation_required':
    default:
      return `${utility}: ${measure} requires a written determination from the ${authority}; it is never visible on a map and is not implied by a mapped line.`;
  }
}

/**
 * What connecting to the mapped infrastructure would take.
 *
 * A SEPARATE question from whether the infrastructure position is good, and the
 * language keeps them separate. Bringing a service line in from a main at the
 * boundary is the ordinary way undeveloped land is connected — a cost and
 * mechanics item to price, never evidence that the site is poorly served. The
 * position reading supplies the sentence wherever the map is what answered,
 * because "extension" means something different at thirteen feet than at half
 * a mile and a single sentence for both is how the old reading went wrong.
 */
function extensionStatement(
  kind: UtilityKind,
  state: UtilityExtensionState,
  reading: UtilitySitePositionReading | null,
): string {
  const utility = utilityLabel(kind);
  switch (state) {
    case 'confirmed_required':
      return `${utility}: the serving party states an extension is required to reach this parcel.${reading ? ` ${reading.connectionPath}` : ''}`;
    case 'likely_required':
      return reading
        ? `${utility}: ${reading.connectionPath} Scope, easement or right-of-way mechanics and cost are unestablished; the requirement itself is ordinary for undeveloped land and is not a mark against the site.`
        : `${utility}: connecting this parcel would involve work between the mapped main and the property. Scope, route, easements and cost are unestablished.`;
    case 'not_indicated':
      return reading
        ? `${utility}: serving infrastructure already reaches the property, so no main extension is indicated by the map. ${reading.connectionPath}`
        : `${utility}: no main extension is indicated. The tap, the service line, and any upsizing the ${authorityLabel(kind)} requires are separate.`;
    case 'unresolved':
    default:
      return `${utility}: whether an extension would be required is unestablished, because the physical position of serving infrastructure relative to this parcel was never established.`;
  }
}

/**
 * Resolve one utility into six independent dimensions.
 *
 * The function is deliberately mechanical about what may fill which dimension:
 * only a `determination` — something the serving party actually said — can put
 * `connection` or `capacity` anywhere other than a confirmation-required or
 * unresolved state. Corridor geometry moves `infrastructure` and `extension`
 * and stops there. Area context moves NOTHING; it is retained, labelled, and
 * used to make the eventual provider inquiry smarter.
 */
export function resolveUtilityAvailability(input: UtilityResolutionInput): UtilityAvailabilityResolution {
  const kind = input.kind;
  const utility = utilityLabel(kind);
  const areaContext = (input.areaContext ?? []).map((entry) => ({
    statement: entry.statement,
    source: entry.source.label,
    sourceUrl: entry.source.url ?? null,
  }));

  // PROVIDER. A name answers the provider question and nothing else.
  const provider = input.provider;
  const providerDimension = {
    state: (provider ? 'identified' : 'unresolved') as UtilityProviderState,
    basis: provider ? ('area_service' as UtilityEvidenceLevel) : null,
    name: provider?.name ?? null,
    providerType: provider?.providerType ?? null,
    statement: provider
      ? `${utility} provider identified as ${provider.name}${provider.providerType ? ` (${provider.providerType})` : ''}${provider.basisIsUtilityRecord ? '' : ', from a source that is not itself a utility record'}. Identifying the provider does not establish that service reaches this parcel.`
      : `No ${kind} provider has been identified for this parcel. Municipal boundary alone never identifies the provider.`,
    sources: provider ? [sourceLine(provider.source)] : [],
  };

  // SERVICE TERRITORY. Inside is meaningful and is still not a pipe.
  const territory = input.territory;
  const territoryDimension: UtilityDimension<UtilityServiceTerritoryState> = {
    state: territory?.state ?? 'unresolved',
    basis: territory ? 'area_service' : null,
    statement: !territory
      ? `Whether this parcel falls inside the ${kind} provider's service territory is unestablished.`
      : territory.state === 'inside'
        ? `The parcel falls inside the mapped ${kind} service territory. A service area is an administrative boundary: it does not establish that a main exists at or near this parcel.`
        : territory.state === 'outside'
          ? `The parcel falls outside the mapped ${kind} service territory. Service would require annexation into the territory or an out-of-district agreement.`
          : `The ${kind} provider publishes no service-territory boundary the screen could read.`,
    sources: territory ? [sourceLine(territory.source)] : [],
  };

  // INFRASTRUCTURE. Geometry, read for what it means to a buyer.
  //
  // The relationship is still the stored fact and still travels unchanged. What
  // changed is the INTERPRETATION laid over it: a main at the frontage, in the
  // adjoining right-of-way, or at the boundary is the normal, favourable way
  // undeveloped land is served, and is scored as the positive it is instead of
  // as an extension problem for failing to cross private ground.
  const corridor = input.corridor;
  const relationship: UtilityLineRelationship = corridor?.relationship ?? 'UNKNOWN';
  const shown = corridorInfrastructureShown(relationship);
  const positionReading = readUtilitySitePosition({
    kind,
    relationship,
    distanceToBoundaryFeet: corridor?.distanceToBoundaryFeet ?? null,
    setting: corridor?.setting ?? 'unknown',
    subjectDevelopment: input.subjectDevelopment ?? 'unknown',
    mainSizeInches: corridor?.mainSizeInches ?? null,
  });
  const infrastructureDimension = {
    state: relationship,
    basis: corridor
      ? (shown ? ('corridor_infrastructure' as UtilityEvidenceLevel) : ('area_service' as UtilityEvidenceLevel))
      : null,
    statement: infrastructureStatement(kind, positionReading),
    sources: corridor ? [sourceLine(corridor.source)] : [],
    layerName: corridor?.layerName ?? null,
    mainSizeInches: corridor?.mainSizeInches ?? null,
    pressureZone: corridor?.pressureZone ?? null,
    lineType: kind === 'sewer' ? (corridor?.lineType ?? 'unknown') : null,
    liftStationObserved: corridor?.liftStationObserved ?? null,
    screenshotPath: corridor?.source.screenshotPath ?? null,
    position: positionReading.position,
    positionLabel: positionReading.label,
    signal: positionReading.signal,
    distanceToBoundaryFeet: corridor?.distanceToBoundaryFeet ?? null,
    setting: corridor?.setting ?? ('unknown' as UtilityCorridorSetting),
    connectionPath: positionReading.connectionPath,
    caution: positionReading.caution,
    stillOpen: positionReading.stillOpen,
  };

  // CONNECTION. Only the serving party settles this.
  const determination = input.determination;
  const connectionState: UtilityConnectionState = determination
    ? determination.connection
    : corridor || provider || territory || areaContext.length
      ? 'written_confirmation_required'
      : 'unresolved';
  const connectionDimension: UtilityDimension<UtilityConnectionState> = {
    state: connectionState,
    basis: determination ? 'subject_availability' : null,
    statement: connectionStatement(kind, connectionState, shown),
    sources: determination ? [sourceLine(determination.source)] : [],
  };

  // CAPACITY. Never inferable, including from a confirmed connection.
  const capacityState: UtilityCapacityState = determination?.capacity
    ?? (determination ? 'not_confirmed' : 'written_confirmation_required');
  const capacityDimension: UtilityDimension<UtilityCapacityState> = {
    state: capacityState,
    basis: determination?.capacity ? 'subject_availability' : null,
    statement: capacityStatement(kind, capacityState),
    sources: determination?.capacity ? [sourceLine(determination.source)] : [],
  };

  // EXTENSION. The map can say "likely"; only the provider says "required".
  //
  // Driven by POSITION rather than by the raw relationship, because "adjacent"
  // covers both a main thirteen feet off the boundary and one four hundred feet
  // away, and those are not the same extension. What has not changed: a main
  // near the parcel is still not a main at it, and the connection work is still
  // named. What has changed is that naming it is a scope-and-cost item rather
  // than a verdict on the site.
  const extensionState: UtilityExtensionState = determination?.extensionRequired === true
    ? 'confirmed_required'
    : determination?.extensionRequired === false
      ? 'not_indicated'
      : !corridor
        ? 'unresolved'
        : positionReading.position === 'crosses_site' || positionReading.position === 'at_site_edge'
          ? 'not_indicated'
          : positionReading.position === 'adjoining_site'
            || positionReading.position === 'same_corridor'
            || positionReading.position === 'off_corridor'
            ? 'likely_required'
            : 'unresolved';
  const extensionDimension: UtilityDimension<UtilityExtensionState> = {
    state: extensionState,
    basis: determination?.extensionRequired != null
      ? 'subject_availability'
      : corridor
        ? 'corridor_infrastructure'
        : null,
    statement: extensionStatement(kind, extensionState, corridor ? positionReading : null),
    sources: determination?.extensionRequired != null
      ? [sourceLine(determination.source)]
      : corridor
        ? [sourceLine(corridor.source)]
        : [],
  };

  const highestEvidenceLevel = strongestEvidenceLevel([
    providerDimension.basis,
    territoryDimension.basis,
    infrastructureDimension.basis,
    connectionDimension.basis,
    capacityDimension.basis,
    extensionDimension.basis,
    ...(areaContext.length ? (['area_service'] as UtilityEvidenceLevel[]) : []),
  ].filter((level): level is UtilityEvidenceLevel => level != null));

  const laneOutcome = utilityLaneOutcome({
    notApplicable: input.notApplicable === true,
    blocked: input.blocked != null,
    connection: connectionState,
    relationship,
    providerIdentified: provider != null,
    territoryKnown: territory != null,
    hasAreaContext: areaContext.length > 0,
  });

  return {
    kind,
    provider: providerDimension,
    territory: territoryDimension,
    infrastructure: infrastructureDimension,
    connection: connectionDimension,
    capacity: capacityDimension,
    extension: extensionDimension,
    areaContext,
    highestEvidenceLevel,
    doesNotEstablish: [...UTILITY_ENTITLEMENTS_NOT_ESTABLISHED],
    confirmationRequired: connectionState === 'written_confirmation_required'
      || capacityState === 'written_confirmation_required',
    laneOutcome,
    headline: utilityHeadline(kind, connectionState, positionReading, provider?.name ?? null, input.blocked?.reason ?? null),
  };
}

/**
 * The lane outcome for a utility question.
 *
 * The rule the Gold Run needed: a provider name is not an answer. Only the
 * connection question — the one an acquisition actually turns on — can make
 * this lane RETURNED, and "someone still has to write us a letter" is PARTIAL,
 * honestly and permanently, until that letter exists.
 */
export function utilityLaneOutcome(input: {
  notApplicable: boolean;
  blocked: boolean;
  connection: UtilityConnectionState;
  relationship: UtilityLineRelationship;
  providerIdentified: boolean;
  territoryKnown: boolean;
  hasAreaContext: boolean;
}): ResearchLaneOutcome {
  if (input.notApplicable) return 'NOT_REQUIRED';
  if (input.blocked) return 'BLOCKED';
  // A serving-party determination — in either direction — is the answer.
  if (input.connection === 'available'
    || input.connection === 'conditionally_available'
    || input.connection === 'not_available') return 'RETURNED';
  // Anything genuinely established below Level 3 leaves the lane visibly partial.
  if (corridorInfrastructureShown(input.relationship)
    || input.relationship === 'NEARBY'
    || input.relationship === 'NOT_SHOWN'
    || input.providerIdentified
    || input.territoryKnown
    || input.hasAreaContext) return 'PARTIAL';
  return 'UNRESOLVED';
}

/**
 * The one line an operator reads first.
 *
 * It leads with what the infrastructure DOES — a main at the property edge, a
 * main adjoining the site — and then names what is still pending. The order is
 * the correction: "no main crosses the parcel; extension likely required" led
 * with an absence that is the normal condition of well-served vacant land, and
 * buried the fact that a modern public main reaches the boundary.
 */
function utilityHeadline(
  kind: UtilityKind,
  connection: UtilityConnectionState,
  reading: UtilitySitePositionReading,
  providerName: string | null,
  blockedReason: string | null,
): string {
  const utility = utilityLabel(kind);
  if (blockedReason) return `${utility}: research blocked — ${blockedReason}`;
  switch (connection) {
    case 'available':
      return `${utility}: available to this parcel per the serving authority.`;
    case 'conditionally_available':
      return `${utility}: conditionally available per the serving authority.`;
    case 'not_available':
      return `${utility}: not available to this parcel per the serving authority.`;
    case 'written_confirmation_required': {
      const distance = reading.label.includes('~') ? ` (${reading.label.split('·').pop()?.trim()})` : '';
      return `${utility}: ${providerName ?? 'provider'} — ${utilityPositionHeadlineFragment(reading)}${distance}; connection and capacity require written confirmation.`;
    }
    case 'unresolved':
    default:
      return `${utility}: unresolved — no provider, territory, or infrastructure evidence has been established.`;
  }
}
