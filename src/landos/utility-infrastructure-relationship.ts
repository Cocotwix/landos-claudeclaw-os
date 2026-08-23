// LandOS — what a mapped utility line does and does not establish.
//
// WHY THIS EXISTS. A water or sewer layer on an official GIS shows PIPE. It is
// genuinely valuable: whether a main runs to the frontage, along the road, or
// nowhere near the parcel changes the deal. But a drawn line is evidence of
// infrastructure geometry and nothing else, and the distance between "there is
// a main at the frontage" and "this parcel can be served" is where land deals
// die. Capacity, tap availability, connection approval, pressure and fire flow
// are decisions the utility authority makes; none of them is visible on a map,
// and no amount of zooming turns one into the other.
//
// So the finding and the entitlement are separated here, in code, rather than
// left to whichever sentence a surface happens to render. A relationship is
// recorded; the four things it cannot establish are attached to it every time.
//
// Pure. No I/O.

/**
 * The physical relationship between a mapped utility line and the subject
 * parcel, as read off an official layer.
 *
 * `NOT_SHOWN` is a statement about the MAP, not about the world: the layer
 * that was opened drew no line here. That is different from `UNKNOWN`, which
 * says no usable layer was read at all.
 */
export type UtilityLineRelationship =
  | 'AT_SUBJECT'
  /**
   * A main runs along the subject's own road corridor without being drawn at
   * the frontage itself. Distinct from ADJACENT on purpose: a line on the road
   * the parcel fronts is the relationship a service extension is priced off,
   * and collapsing it into either "at the parcel" or "nearby" loses the exact
   * fact an operator needs.
   */
  | 'ON_SUBJECT_ROAD'
  | 'ADJACENT'
  | 'NEARBY'
  | 'NOT_SHOWN'
  | 'UNKNOWN';

export type UtilityKind = 'water' | 'sewer';

export const UTILITY_RELATIONSHIP_LABEL: Readonly<Record<UtilityLineRelationship, string>> = {
  AT_SUBJECT: 'Line mapped at the subject parcel',
  ON_SUBJECT_ROAD: 'Line mapped along the subject road corridor',
  ADJACENT: 'Line mapped adjacent to the subject parcel',
  NEARBY: 'Line mapped in the vicinity, not at the parcel',
  NOT_SHOWN: 'No line shown on the layer that was read',
  UNKNOWN: 'No usable utility layer was read',
};

/**
 * The entitlements a mapped line NEVER establishes.
 *
 * This list is the whole point of the module. Every one of these is a utility
 * authority decision; a map is not a party to it.
 */
export const UTILITY_ENTITLEMENTS_NOT_ESTABLISHED = [
  'available capacity',
  'tap availability or tap approval',
  'connection approval',
  'pressure or fire flow',
] as const;

export interface UtilityInfrastructureFinding {
  kind: UtilityKind;
  relationship: UtilityLineRelationship;
  /** The official layer and map this was read from. */
  sourceLabel: string;
  sourceUrl: string | null;
  /** The layer actually toggled on, so the read is reproducible. */
  layerName: string | null;
  /** Screenshot retained for the read, when one was taken. */
  screenshotPath: string | null;
  retrievedAt: string;
  /** What the operator reads. Always carries the separation statement. */
  statement: string;
  /** The four entitlements this finding does not establish. */
  doesNotEstablish: readonly string[];
  /** The next action that WOULD establish service. Never omitted. */
  nextStep: string;
}

/**
 * True only when a line was actually drawn at or beside the parcel.
 *
 * Deliberately narrow, and deliberately not named anything like
 * "serviceAvailable": it answers a geometry question.
 */
export function lineIsMapped(relationship: UtilityLineRelationship): boolean {
  return relationship === 'AT_SUBJECT'
    || relationship === 'ON_SUBJECT_ROAD'
    || relationship === 'ADJACENT';
}

/**
 * The guard. A mapped line never implies service capacity, tap availability,
 * connection approval, pressure or fire flow — for any relationship value,
 * including `AT_SUBJECT`.
 *
 * This function exists so the rule is callable and testable rather than a
 * comment someone can drift away from. It returns `false` unconditionally, and
 * that is correct: no map read can make it true.
 */
export function establishesServiceEntitlement(_relationship: UtilityLineRelationship): false {
  return false;
}

/** A mapped line is not a connection, and an absent line is not a refusal. */
export function relationshipStatement(kind: UtilityKind, relationship: UtilityLineRelationship): string {
  const utility = kind === 'water' ? 'Public water' : 'Public sewer';
  switch (relationship) {
    case 'AT_SUBJECT':
      return `${utility}: a main is mapped at the subject parcel. This is infrastructure geometry only — it does not establish capacity, tap availability, connection approval, or fire flow.`;
    case 'ON_SUBJECT_ROAD':
      return `${utility}: a main is mapped along the subject's road corridor. Infrastructure geometry only — capacity, tap availability, connection approval and fire flow remain the utility authority's determinations.`;
    case 'ADJACENT':
      return `${utility}: a main is mapped adjacent to the subject parcel. Proximity is not service — extension, capacity and connection approval remain open.`;
    case 'NEARBY':
      return `${utility}: a main is mapped in the vicinity but not at the parcel. Any connection would require an extension whose cost and feasibility are unestablished.`;
    case 'NOT_SHOWN':
      return `${utility}: the official layer that was read draws no line at or near this parcel. Absence on a map is not proof that service is unavailable; the utility authority controls.`;
    case 'UNKNOWN':
    default:
      return `${utility}: no usable official utility layer was read for this parcel, so the physical relationship is unestablished.`;
  }
}

function nextStepFor(kind: UtilityKind, relationship: UtilityLineRelationship): string {
  const authority = kind === 'water' ? 'water utility' : 'sewer authority';
  return relationship === 'UNKNOWN'
    ? `Read an official ${kind} layer or provider service map for this parcel.`
    : `Request a written availability and capacity determination from the ${authority} for this parcel.`;
}

/**
 * Build a finding that cannot be rendered without its limits.
 *
 * `doesNotEstablish` and `nextStep` are populated for every relationship,
 * including `AT_SUBJECT` — especially `AT_SUBJECT`, which is the one a reader
 * is most tempted to treat as a yes.
 */
export function buildUtilityInfrastructureFinding(input: {
  kind: UtilityKind;
  relationship: UtilityLineRelationship;
  sourceLabel: string;
  sourceUrl?: string | null;
  layerName?: string | null;
  screenshotPath?: string | null;
  retrievedAt: string;
}): UtilityInfrastructureFinding {
  return {
    kind: input.kind,
    relationship: input.relationship,
    sourceLabel: input.sourceLabel,
    sourceUrl: input.sourceUrl ?? null,
    layerName: input.layerName ?? null,
    screenshotPath: input.screenshotPath ?? null,
    retrievedAt: input.retrievedAt,
    statement: relationshipStatement(input.kind, input.relationship),
    doesNotEstablish: [...UTILITY_ENTITLEMENTS_NOT_ESTABLISHED],
    nextStep: nextStepFor(input.kind, input.relationship),
  };
}
