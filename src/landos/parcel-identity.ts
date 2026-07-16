// LandOS — Parcel Identity (the acquisition-pipeline spine).
//
// ONE persisted verdict per Deal Card answering "has the subject parcel actually
// been confirmed?". The Property Resolution engine computes the verdict ONCE
// (reusing its established-identity rule); this module stores it and every
// downstream consumer READS it. Nothing re-derives identity from raw rows.
//
// State machine:
//   unresolved  — no credible subject yet (resolution = needs_clarification).
//   candidate   — matched/credible, but the parcel is NOT confirmed (only the
//                 operator's own input, or a single weak lane, backs it).
//   confirmed   — the parcel was actually read/verified (named source, Browser
//                 Agent read the parcel panel, >=2 corroborating lanes, or a
//                 geocoded full street address resolved to a point). ONLY this
//                 state unlocks Property Intelligence / Market Pulse / comps /
//                 Strategy / Discovery.
//
// Phase 1 (this module): compute + persist + read. The ConfirmedParcel capability
// type and department enforcement land in a later phase; for now nothing reads
// this state, so persisting it is a pure additive step (no behavior change).
//
// The compute core is pure + DB-free. read/write are the thin SQLite adapter.
// No network, no .env, no secrets, no property work product (identity + the names
// of the sources that established it only).

import { getLandosDb, landosAudit } from './db.js';
import type { PropertyResolution } from './property-resolution-engine.js';

export const PARCEL_STATES = ['unresolved', 'candidate', 'confirmed'] as const;
export type ParcelState = (typeof PARCEL_STATES)[number];

export function isParcelState(v: unknown): v is ParcelState {
  return typeof v === 'string' && (PARCEL_STATES as readonly string[]).includes(v);
}

/** The persisted verdict for a Deal Card's subject parcel. */
export interface ParcelIdentityRecord {
  dealCardId: number;
  subjectCardId: number | null;
  state: ParcelState;
  basis: string;
  confidence: number;
  /** Short provenance refs (source names + retrieved browser services) — never
   *  property work product, just what established the identity. */
  evidenceRefs: string[];
  confirmedAt: number | null;
  confirmedBy: string;
  updatedAt: number | null;
}

/** The verdict derived from a resolution, before persistence. */
export interface ParcelIdentityVerdict {
  state: ParcelState;
  basis: string;
  confidence: number;
  evidenceRefs: string[];
}

/**
 * PURE: map a Property Resolution outcome to the parcel state. `confirmed` wins
 * whenever the engine established identity; a credible-but-unconfirmed match is
 * `candidate`; anything else (needs_clarification) is `unresolved`.
 */
export function computeParcelState(
  r: Pick<PropertyResolution, 'status' | 'identityEstablished'>,
): ParcelState {
  if (r.identityEstablished) return 'confirmed';
  if (r.status === 'matched') return 'candidate';
  return 'unresolved';
}

/** PURE: build the full verdict (state + basis + provenance refs) from a
 *  resolution. Does not touch the database. */
export function parcelIdentityFromResolution(r: PropertyResolution): ParcelIdentityVerdict {
  const refs = new Set<string>();
  for (const s of r.property.sources ?? []) if (s) refs.add(s);
  for (const ev of r.browserEvidence ?? []) {
    if (ev.status === 'retrieved' || ev.status === 'partial') refs.add(`browser:${ev.service}`);
  }
  return {
    state: computeParcelState(r),
    basis: r.identityBasis,
    confidence: r.confidence,
    evidenceRefs: [...refs],
  };
}

interface ParcelIdentityRow {
  deal_card_id: number;
  subject_card_id: number | null;
  state: string;
  basis: string;
  confidence: number;
  evidence_refs_json: string;
  confirmed_at: number | null;
  confirmed_by: string;
  updated_at: number | null;
}

function parseRefs(s: string): string[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; }
  catch { return []; }
}

/** Read the persisted parcel identity for a Deal Card. Null when never written. */
export function readParcelIdentity(dealCardId: number): ParcelIdentityRecord | null {
  const row = getLandosDb()
    .prepare('SELECT * FROM landos_parcel_identity WHERE deal_card_id = ?')
    .get(dealCardId) as ParcelIdentityRow | undefined;
  if (!row) return null;
  return {
    dealCardId: row.deal_card_id,
    subjectCardId: row.subject_card_id,
    state: isParcelState(row.state) ? row.state : 'unresolved',
    basis: row.basis,
    confidence: row.confidence,
    evidenceRefs: parseRefs(row.evidence_refs_json),
    confirmedAt: row.confirmed_at,
    confirmedBy: row.confirmed_by,
    updatedAt: row.updated_at,
  };
}

export interface WriteParcelIdentityInput {
  subjectCardId?: number | null;
  state: ParcelState;
  basis: string;
  confidence: number;
  evidenceRefs?: string[];
  /** Who/what established the identity (e.g. 'acquire', a named source). */
  confirmedBy?: string;
}

/**
 * Upsert the parcel identity verdict for a Deal Card. `confirmed_at` is stamped
 * the first time the state becomes `confirmed` and preserved thereafter (an
 * already-confirmed parcel keeps its original confirmation time). Idempotent.
 */
export function writeParcelIdentity(dealCardId: number, input: WriteParcelIdentityInput, actor = 'acquire'): ParcelIdentityRecord {
  const db = getLandosDb();
  const now = Math.floor(Date.now() / 1000);
  const existing = readParcelIdentity(dealCardId);
  const confirmedAt = input.state === 'confirmed'
    ? (existing?.confirmedAt ?? now)
    : (existing?.confirmedAt ?? null);
  db.prepare(
    `INSERT INTO landos_parcel_identity
       (deal_card_id, subject_card_id, state, basis, confidence, evidence_refs_json, confirmed_at, confirmed_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(deal_card_id) DO UPDATE SET
       subject_card_id=excluded.subject_card_id, state=excluded.state, basis=excluded.basis,
       confidence=excluded.confidence, evidence_refs_json=excluded.evidence_refs_json,
       confirmed_at=excluded.confirmed_at, confirmed_by=excluded.confirmed_by, updated_at=excluded.updated_at`,
  ).run(
    dealCardId,
    input.subjectCardId ?? null,
    input.state,
    input.basis,
    input.confidence,
    JSON.stringify(input.evidenceRefs ?? []),
    confirmedAt,
    input.confirmedBy ?? actor,
    now,
  );
  landosAudit(actor, 'parcel_identity_written', `deal ${dealCardId} -> ${input.state}`, { refTable: 'landos_parcel_identity', refId: dealCardId });
  return readParcelIdentity(dealCardId) as ParcelIdentityRecord;
}

// ─────────────────────────────────────────────────────────────────────────
// ConfirmedParcel capability type (the structural gate)
// ─────────────────────────────────────────────────────────────────────────
//
// A ConfirmedParcel is an OPAQUE token that proves a parcel reached the
// `confirmed` state. Its brand symbol is module-private, so the ONLY way to
// obtain one is `confirmParcel()` below — no caller can fabricate it. Every
// downstream department (Property Intelligence, Market Pulse, comps, Strategy,
// Discovery) takes a ConfirmedParcel, which makes it a COMPILE ERROR to run a
// department on an unconfirmed parcel. The gate stops being a runtime `if` you
// must remember to write and becomes an invariant the type system enforces.

declare const confirmedParcelBrand: unique symbol;

export interface ConfirmedParcel {
  /** Brand — unconstructable outside this module. */
  readonly [confirmedParcelBrand]: true;
  readonly dealCardId: number;
  readonly subjectCardId: number | null;
  /** Why identity is confirmed (carried from the stored verdict). */
  readonly basis: string;
  readonly evidenceRefs: string[];
  readonly confirmedAt: number | null;
}

/**
 * The gate. Returns a ConfirmedParcel ONLY when the stored verdict is
 * `confirmed`; otherwise null. Pure w.r.t. its input (no DB) — pass a record in.
 */
export function confirmParcel(identity: ParcelIdentityRecord | null): ConfirmedParcel | null {
  if (!identity || identity.state !== 'confirmed') return null;
  return {
    dealCardId: identity.dealCardId,
    subjectCardId: identity.subjectCardId,
    basis: identity.basis,
    evidenceRefs: identity.evidenceRefs,
    confirmedAt: identity.confirmedAt,
  } as ConfirmedParcel;
}

/** DB convenience: read the stored verdict for a deal and gate it in one call. */
export function confirmParcelForDeal(dealCardId: number): ConfirmedParcel | null {
  return confirmParcel(readParcelIdentity(dealCardId));
}

/** Convenience: persist the verdict derived from a resolution in one call. */
export function persistParcelIdentityFromResolution(
  dealCardId: number,
  resolution: PropertyResolution,
  opts: { subjectCardId?: number | null; confirmedBy?: string } = {},
  actor = 'acquire',
): ParcelIdentityRecord {
  const v = parcelIdentityFromResolution(resolution);
  // Accepted-identity preservation: a CONFIRMED stored verdict is accepted
  // operator information. A later automated run may never replace its basis,
  // provenance, or confidence (QA finding W2-F2: a re-intake rewrote an
  // accepted LandPortal-browser verification with a different source at a
  // different confidence). Only an explicit operator confirmation
  // (opts.confirmedBy) may supersede it.
  const existing = readParcelIdentity(dealCardId);
  if (existing?.state === 'confirmed' && !opts.confirmedBy) {
    return existing;
  }
  return writeParcelIdentity(dealCardId, {
    subjectCardId: opts.subjectCardId ?? null,
    state: v.state,
    basis: v.basis,
    confidence: v.confidence,
    evidenceRefs: v.evidenceRefs,
    confirmedBy: opts.confirmedBy,
  }, actor);
}
