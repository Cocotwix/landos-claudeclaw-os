// Parallel property-resolution orchestrator.
//
// Runs the two independent parcel-level evidence lanes CONCURRENTLY:
//   Lane A — Official public record (county GIS / assessor / tax / recorder,
//            structured adapter where one exists, browser-driven official-source
//            research where it does not).
//   Lane B — LandPortal parcel page (approved persistent browser session).
//
// This is Tyler's non-negotiable shape: official public sources and LandPortal
// are PARALLEL PRIMARY evidence lanes — not a sequential primary/fallback. One
// slow or failed lane never blocks the other. A missing county adapter is not a
// final blocker while LandPortal remains; a temporary LandPortal failure is not a
// final blocker while public sources remain.
//
// The orchestrator RECONCILES the two lanes into a single confirmation verdict
// plus a list of visible reconciliation issues, and enforces the wrong-parcel
// hard stop against the operator-requested APN. It never silently chooses one
// lane over the other and never overwrites operator-accepted information — a
// disagreement becomes a surfaced reconciliation issue, not a silent overwrite.
//
// Pure orchestration: the two lane runners are injected, so the whole
// confirm/reconcile/conflict/agreement contract is deterministically unit-tested
// with fake lanes. Live wiring supplies the real official + LandPortal runners.

export type ResolutionLaneId = 'official_public' | 'landportal';

export type LaneStatus =
  | 'confirmed' // reached an exact parcel-level record with its own APN + jurisdiction
  | 'candidate' // partial/approximate evidence only (e.g. geocode, no parcel page)
  | 'unavailable' // no adapter / not authenticated / nothing found — honest, non-fatal
  | 'error' // the lane threw
  | 'skipped'; // the lane was intentionally not run

export interface ParcelFacts {
  address?: string | null;
  apn?: string | null;
  owner?: string | null;
  acres?: number | null;
  county?: string | null;
  state?: string | null;
  zip?: string | null;
  coordinates?: { lat: number; lng: number } | null;
  sourceUrl?: string | null;
  /** Human-readable label of the exact source (e.g. "Pickens County GIS parcel page"). */
  source: string;
}

export interface LaneAttempt {
  source: string;
  status: string;
  note: string;
  url?: string;
}

export interface LaneOutcome {
  lane: ResolutionLaneId;
  status: LaneStatus;
  /** Parcel-level facts when the lane reached an exact parcel page/record. */
  parcel: ParcelFacts | null;
  /** True only for an exact parcel-level identity (own APN + jurisdiction), never a geocode. */
  confirmedIdentity: boolean;
  attempts: LaneAttempt[];
  note: string;
  elapsedMs?: number;
}

export interface ReconciliationIssue {
  field: 'apn' | 'owner' | 'acres' | 'county' | 'state' | 'address' | 'coordinates';
  severity: 'conflict' | 'minor';
  values: Array<{ lane: ResolutionLaneId; source: string; value: string }>;
  note: string;
}

export interface ParcelIdentityConflict {
  requestedApn: string;
  resolvedApn: string;
  lane: ResolutionLaneId;
  source: string;
}

export type LaneAgreement = 'agree' | 'single_lane' | 'conflict' | 'none';

export interface ParallelResolution {
  lanes: LaneOutcome[];
  /** True when the exact parcel is confirmed and no hard conflict blocks it. */
  confirmed: boolean;
  /** The single reconciled parcel the rest of LandOS should use. */
  confirmedParcel: ParcelFacts | null;
  confirmationBasis: string;
  reconciliation: ReconciliationIssue[];
  /** Wrong-parcel hard stop: operator APN disagrees with a resolved parcel APN. */
  identityConflict?: ParcelIdentityConflict;
  laneAgreement: LaneAgreement;
  /** Autonomous downstream continuation is allowed only when confirmed AND no hard conflict. */
  downstreamAllowed: boolean;
}

export interface ParallelResolutionInput {
  fields: {
    address?: string | null;
    apn?: string | null;
    owner?: string | null;
    county?: string | null;
    state?: string | null;
    zip?: string | null;
  };
}

export interface ParallelResolutionDeps {
  officialLane: (input: ParallelResolutionInput) => Promise<LaneOutcome>;
  landPortalLane: (input: ParallelResolutionInput) => Promise<LaneOutcome>;
  now?: () => number;
  /** Hard per-lane time budget. A lane that exceeds it yields a timeout outcome
   *  so the verdict is never held hostage by one hung lane (the other lane's
   *  evidence still counts). Default 4 minutes. */
  laneTimeoutMs?: number;
}

// ── Normalization helpers (shared, jurisdiction-agnostic) ─────────────────────

/** Compact an APN/parcel id to compare across formatting variants. */
export function compactApn(value: string | null | undefined): string {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}

/** Owner surname-ish tokens for a fuzzy, format-tolerant compare. */
function ownerTokens(value: string | null | undefined): Set<string> {
  return new Set(
    String(value ?? '')
      .toUpperCase()
      .replace(/[^0-9A-Z ]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !['THE', 'AND', 'LLC', 'INC', 'TRUST', 'TRUSTEE', 'TRUSTEES', 'FAMILY', 'ETAL', 'ET', 'AL'].includes(t)),
  );
}

function stateCode(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase().slice(0, 2);
}

function countyKey(value: string | null | undefined): string {
  return String(value ?? '')
    .toUpperCase()
    .replace(/\s+COUNTY$/i, '')
    .replace(/[^0-9A-Z]/g, '')
    .trim();
}

/** Great-circle distance in meters between two lat/lng points. */
export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ── Lane runner ───────────────────────────────────────────────────────────────

function laneErrorOutcome(lane: ResolutionLaneId, err: unknown): LaneOutcome {
  const message = err instanceof Error ? err.message : String(err ?? 'lane failed');
  return {
    lane,
    status: 'error',
    parcel: null,
    confirmedIdentity: false,
    attempts: [{ source: lane === 'official_public' ? 'Official public parcel lookup' : 'LandPortal', status: 'error', note: message }],
    note: `${lane} lane failed: ${message}`,
  };
}

/**
 * Run both lanes concurrently. A lane that throws is captured as an `error`
 * outcome so the other lane's evidence is never lost. Neither lane blocks the
 * other — this is Promise.allSettled, not a sequential await chain.
 */
export async function runResolutionLanes(
  input: ParallelResolutionInput,
  deps: ParallelResolutionDeps,
): Promise<LaneOutcome[]> {
  const now = deps.now ?? (() => Date.now());
  const budgetMs = deps.laneTimeoutMs ?? 240_000;
  const timed = async (lane: ResolutionLaneId, fn: () => Promise<LaneOutcome>): Promise<LaneOutcome> => {
    const start = now();
    // HARD per-lane budget: a lane that hangs (e.g. a browser workflow that
    // ignores its own timeout) yields a timeout outcome instead of holding the
    // whole verdict hostage. The other lane's evidence still counts.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<LaneOutcome>((resolve) => {
      timer = setTimeout(() => resolve({
        lane, status: 'error', parcel: null, confirmedIdentity: false,
        attempts: [{ source: lane === 'official_public' ? 'Official public parcel lookup' : 'LandPortal', status: 'timeout', note: `Lane exceeded its ${Math.round(budgetMs / 1000)}s budget.` }],
        note: `${lane} lane exceeded its ${Math.round(budgetMs / 1000)}s time budget; the other lane's evidence still counts.`,
      }), budgetMs);
    });
    try {
      const outcome = await Promise.race([fn(), timeout]);
      return { ...outcome, lane, elapsedMs: outcome.elapsedMs ?? now() - start };
    } catch (err) {
      return { ...laneErrorOutcome(lane, err), elapsedMs: now() - start };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const [official, landportal] = await Promise.all([
    timed('official_public', () => deps.officialLane(input)),
    timed('landportal', () => deps.landPortalLane(input)),
  ]);
  return [official, landportal];
}

// ── Reconciliation ──────────────────────────────────────────────────────────

function pushIssue(
  issues: ReconciliationIssue[],
  field: ReconciliationIssue['field'],
  severity: ReconciliationIssue['severity'],
  values: ReconciliationIssue['values'],
  note: string,
): void {
  issues.push({ field, severity, values, note });
}

/** Compare the parcel facts from every lane that produced a parcel. */
export function reconcileLanes(lanes: LaneOutcome[]): ReconciliationIssue[] {
  const withParcel = lanes.filter((l) => l.parcel);
  if (withParcel.length < 2) return [];
  const issues: ReconciliationIssue[] = [];
  const val = (l: LaneOutcome, key: keyof ParcelFacts): string | null => {
    const v = l.parcel?.[key];
    if (v == null || v === '') return null;
    return String(v);
  };

  // APN — the strongest identifier. Disagreement is a hard conflict.
  const apns = withParcel
    .map((l) => ({ lane: l.lane, source: l.parcel!.source, raw: val(l, 'apn'), key: compactApn(val(l, 'apn')) }))
    .filter((x) => x.key);
  if (new Set(apns.map((x) => x.key)).size > 1) {
    pushIssue(issues, 'apn', 'conflict', apns.map((x) => ({ lane: x.lane, source: x.source, value: x.raw! })),
      'Parcel-level sources resolved different APNs. Identity is NOT confirmed until this is reconciled.');
  }

  // County / State.
  for (const field of ['state', 'county'] as const) {
    const keyer = field === 'state' ? stateCode : countyKey;
    const vals = withParcel
      .map((l) => ({ lane: l.lane, source: l.parcel!.source, raw: val(l, field), key: keyer(val(l, field)) }))
      .filter((x) => x.key);
    if (new Set(vals.map((x) => x.key)).size > 1) {
      pushIssue(issues, field, 'conflict', vals.map((x) => ({ lane: x.lane, source: x.source, value: x.raw! })),
        `Lanes disagree on ${field}.`);
    }
  }

  // Acreage — tolerate small assessment/rounding differences.
  const acresVals = withParcel
    .map((l) => ({ lane: l.lane, source: l.parcel!.source, acres: typeof l.parcel!.acres === 'number' ? l.parcel!.acres! : null }))
    .filter((x): x is { lane: ResolutionLaneId; source: string; acres: number } => x.acres != null && x.acres > 0);
  if (acresVals.length >= 2) {
    const min = Math.min(...acresVals.map((x) => x.acres));
    const max = Math.max(...acresVals.map((x) => x.acres));
    const spread = max - min;
    const relative = spread / max;
    if (spread > 0.1 && relative > 0.05) {
      pushIssue(issues, 'acres', relative > 0.2 ? 'conflict' : 'minor',
        acresVals.map((x) => ({ lane: x.lane, source: x.source, value: `${x.acres} ac` })),
        `Lanes report acreage differing by ${spread.toFixed(2)} ac (${(relative * 100).toFixed(0)}%).`);
    }
  }

  // Owner — fuzzy surname-token overlap (formats vary widely between sources).
  const owners = withParcel
    .map((l) => ({ lane: l.lane, source: l.parcel!.source, raw: val(l, 'owner'), tokens: ownerTokens(val(l, 'owner')) }))
    .filter((x) => x.tokens.size);
  if (owners.length >= 2) {
    const [a, b] = owners;
    const overlap = [...a.tokens].some((t) => b.tokens.has(t));
    if (!overlap) {
      pushIssue(issues, 'owner', 'minor', owners.map((x) => ({ lane: x.lane, source: x.source, value: x.raw! })),
        'Lanes report owners with no shared name token; verify current owner of record.');
    }
  }

  // Coordinates — flag only materially distant points (both may be centroid-ish).
  const coords = withParcel
    .map((l) => ({ lane: l.lane, source: l.parcel!.source, c: l.parcel!.coordinates }))
    .filter((x): x is { lane: ResolutionLaneId; source: string; c: { lat: number; lng: number } } => !!x.c && Number.isFinite(x.c.lat) && Number.isFinite(x.c.lng));
  if (coords.length >= 2) {
    const dist = haversineMeters(coords[0].c, coords[1].c);
    if (dist > 300) {
      pushIssue(issues, 'coordinates', dist > 1500 ? 'conflict' : 'minor',
        coords.map((x) => ({ lane: x.lane, source: x.source, value: `${x.c.lat.toFixed(5)},${x.c.lng.toFixed(5)}` })),
        `Lane coordinates are ${Math.round(dist)} m apart.`);
    }
  }

  return issues;
}

/** Merge confirmed lanes into one parcel, official-record fields winning ties. */
function mergeParcel(primary: LaneOutcome, others: LaneOutcome[]): ParcelFacts {
  const base: ParcelFacts = { ...primary.parcel! };
  const fill = (key: keyof ParcelFacts) => {
    if (base[key] != null && base[key] !== '') return;
    for (const o of others) {
      const v = o.parcel?.[key];
      if (v != null && v !== '') {
        (base as unknown as Record<string, unknown>)[key] = v;
        return;
      }
    }
  };
  (['owner', 'acres', 'coordinates', 'zip', 'address', 'county', 'state', 'apn'] as Array<keyof ParcelFacts>).forEach(fill);
  return base;
}

// ── Top-level orchestration ──────────────────────────────────────────────────

/**
 * Reconcile the two parallel lanes into ONE confirmation verdict. The returned
 * `confirmed` / `downstreamAllowed` is the single gate the rest of LandOS reads.
 */
export function reconcileResolution(
  lanes: LaneOutcome[],
  requestedApn: string | null | undefined,
): ParallelResolution {
  const reconciliation = reconcileLanes(lanes);
  const confirmedLanes = lanes.filter((l) => l.confirmedIdentity && l.parcel);
  const apnConflictIssue = reconciliation.find((i) => i.field === 'apn' && i.severity === 'conflict');

  // Wrong-parcel hard stop: operator supplied an APN and a confirmed lane
  // resolved a DIFFERENT one. Downstream stays blocked until reconciled.
  let identityConflict: ParcelIdentityConflict | undefined;
  const reqKey = compactApn(requestedApn);
  if (reqKey) {
    const disagreeing = confirmedLanes.find((l) => {
      const k = compactApn(l.parcel!.apn);
      return k && k !== reqKey;
    });
    if (disagreeing) {
      identityConflict = {
        requestedApn: String(requestedApn),
        resolvedApn: String(disagreeing.parcel!.apn),
        lane: disagreeing.lane,
        source: disagreeing.parcel!.source,
      };
    }
  }

  let laneAgreement: LaneAgreement = 'none';
  let confirmed = false;
  let confirmedParcel: ParcelFacts | null = null;
  let confirmationBasis = '';

  if (identityConflict) {
    laneAgreement = 'conflict';
    confirmationBasis = `Wrong-parcel hard stop: you supplied APN ${identityConflict.requestedApn} but ${identityConflict.source} resolved APN ${identityConflict.resolvedApn}. No parcel is confirmed and nothing downstream runs until the APN is reconciled.`;
  } else if (apnConflictIssue) {
    laneAgreement = 'conflict';
    confirmationBasis = 'Official public record and LandPortal resolved different parcels. Identity is a visible reconciliation conflict; downstream is on hold until it is resolved.';
  } else if (confirmedLanes.length >= 2) {
    // Both lanes independently confirmed and (no apn conflict) agree.
    laneAgreement = 'agree';
    confirmed = true;
    const official = confirmedLanes.find((l) => l.lane === 'official_public')!;
    const others = confirmedLanes.filter((l) => l !== official);
    confirmedParcel = mergeParcel(official, others);
    confirmationBasis = `Official public record and LandPortal independently confirmed the same parcel (APN ${confirmedParcel.apn ?? 'n/a'}).`;
  } else if (confirmedLanes.length === 1) {
    // A single exact parcel-level source with its own APN + jurisdiction qualifies.
    laneAgreement = 'single_lane';
    confirmed = true;
    confirmedParcel = { ...confirmedLanes[0].parcel! };
    confirmationBasis = `Parcel confirmed by ${confirmedParcel.source} (APN ${confirmedParcel.apn ?? 'n/a'}). The second lane did not independently confirm; its status is recorded.`;
  } else {
    laneAgreement = 'none';
    const reasons = lanes.map((l) => `${l.lane}: ${l.status}`).join(', ');
    confirmationBasis = `No parcel-level source confirmed the exact parcel yet (${reasons}). A geocoder locates an address; it does not confirm a parcel. Continue the approved autonomous paths.`;
  }

  return {
    lanes,
    confirmed,
    confirmedParcel,
    confirmationBasis,
    reconciliation,
    identityConflict,
    laneAgreement,
    downstreamAllowed: confirmed && !identityConflict,
  };
}

/** Run both lanes in parallel and reconcile — the one call the orchestrator uses. */
export async function resolveParcelParallel(
  input: ParallelResolutionInput,
  deps: ParallelResolutionDeps,
): Promise<ParallelResolution> {
  const lanes = await runResolutionLanes(input, deps);
  return reconcileResolution(lanes, input.fields.apn);
}
