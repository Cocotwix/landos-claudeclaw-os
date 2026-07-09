// LandOS — Resolution Snapshot.
//
// Captures the Property Resolution trace for a Deal Card whose parcel is NOT yet
// confirmed (candidate/unresolved), so the dedicated Resolution view can show the
// operator exactly what LandOS understood, which sources were searched, which
// candidates were found and why each was accepted/rejected, what is missing, and
// the single smallest next identifier needed to confirm the parcel.
//
// Pure builder (buildResolutionSnapshot) + thin SQLite adapter. No network, no
// secrets, no property work product beyond the operator's own intake + source
// provenance. One row per Deal Card; overwritten on re-resolve.

import { getLandosDb } from './db.js';
import { computeParcelState, type ParcelState } from './parcel-identity.js';
import { smallestNextIdentifier } from './resolver-planner.js';
import type { PropertyResolution, ApnConflict } from './property-resolution-engine.js';
import type { ParsedIntakeFields } from './intake-router.js';

/** One retrieval lane the resolver ran, with its outcome + human reason. */
export interface ResolutionLaneView {
  lane: string;
  status: string;
  ran: boolean;
  contributed: boolean;
  note: string;
}

/** One browser-intelligence service attempt (LandPortal / County Records). */
export interface ResolutionBrowserView {
  service: string;
  status: string;
  note: string;
  factCount: number;
}

/** What LandOS parsed from the raw intake (never fabricated). */
export interface ResolutionParsed {
  address?: string;
  city?: string;
  county?: string;
  state?: string;
  zip?: string;
  apn?: string;
  apnAlternates?: string[];
  owner?: string;
  fips?: string;
}

export interface ResolutionSnapshot {
  rawInput: string;
  parsed: ResolutionParsed;
  /** unresolved | candidate | confirmed — mirrors the ParcelIdentity state. */
  state: ParcelState;
  confidence: number;
  basis: string;
  matchedReason: string;
  /** Every source searched, with accept/reject reason. */
  lanes: ResolutionLaneView[];
  /** Browser Intelligence attempts (LandPortal-first, then County Records). */
  browser: ResolutionBrowserView[];
  /** Named sources that actually contributed identity evidence (the "candidates"). */
  acceptedSources: string[];
  /** Practical fields still unknown. */
  missing: string[];
  /** The single smallest next identifier that would confirm the parcel. */
  smallestNextIdentifier: string;
  guidance?: string;
  /** HARD wrong-parcel conflict: the operator asked for one APN but a parcel-level
   *  source resolved a DIFFERENT parcel. When present the Resolution view shows a
   *  loud hard-stop banner and NOTHING downstream runs. */
  identityConflict?: ApnConflict;
  capturedAt: string;
}

/**
 * PURE: build the resolution snapshot from a Property Resolution result + the
 * parsed intake fields. Deterministic; no DB, no network.
 */
export function buildResolutionSnapshot(
  rawInput: string,
  fields: ParsedIntakeFields,
  resolution: PropertyResolution,
  now = new Date().toISOString(),
): ResolutionSnapshot {
  const p = resolution.property;
  return {
    rawInput,
    parsed: {
      address: fields.address,
      city: fields.city,
      county: fields.county ?? p.county,
      state: fields.state ?? p.state,
      zip: fields.zip ?? p.zip,
      apn: fields.apn ?? p.apn,
      apnAlternates: fields.apnAlternates,
      owner: fields.owner ?? p.owner,
      fips: fields.fips ?? p.fips,
    },
    state: computeParcelState(resolution),
    confidence: resolution.confidence,
    basis: resolution.identityBasis,
    matchedReason: resolution.matchedReason,
    lanes: (resolution.lanesAttempted ?? []).map((l) => ({
      lane: l.lane, status: l.status, ran: l.ran, contributed: l.contributed, note: l.note,
    })),
    browser: (resolution.browserEvidence ?? []).map((b) => ({
      service: b.service, status: b.status, note: b.note, factCount: b.facts?.length ?? 0,
    })),
    acceptedSources: [...(p.sources ?? [])],
    missing: [...(resolution.missing ?? [])],
    smallestNextIdentifier: smallestNextIdentifier({
      address: fields.address, city: fields.city, state: fields.state, zip: fields.zip,
      county: fields.county, fips: fields.fips, apn: fields.apn, owner: fields.owner, propertyId: fields.propertyId,
    }),
    guidance: resolution.guidance,
    identityConflict: resolution.identityConflict,
    capturedAt: now,
  };
}

interface SnapshotRow { deal_card_id: number; snapshot_json: string; updated_at: number }

/** Persist (upsert) the resolution snapshot for a Deal Card. Idempotent. */
export function writeResolutionSnapshot(dealCardId: number, snapshot: ResolutionSnapshot): void {
  const now = Math.floor(Date.now() / 1000);
  getLandosDb().prepare(
    `INSERT INTO landos_resolution_snapshot (deal_card_id, snapshot_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(deal_card_id) DO UPDATE SET snapshot_json=excluded.snapshot_json, updated_at=excluded.updated_at`,
  ).run(dealCardId, JSON.stringify(snapshot), now);
}

/** Read the resolution snapshot for a Deal Card (null when none). */
export function readResolutionSnapshot(dealCardId: number): ResolutionSnapshot | null {
  const row = getLandosDb()
    .prepare('SELECT * FROM landos_resolution_snapshot WHERE deal_card_id = ?')
    .get(dealCardId) as SnapshotRow | undefined;
  if (!row) return null;
  try { return JSON.parse(row.snapshot_json) as ResolutionSnapshot; } catch { return null; }
}
