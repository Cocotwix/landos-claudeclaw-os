// Duke Execution Bridge — Sprint 6B/6C.
//
// Maps the result of Duke's existing, tested, SAFE parcel-verification path
// (runDukePreflight: a bounded LandPortal exact resolve — NOT a comp credit, NOT
// the full agent, NOT GIS scraping) into a structured result the Intake Planner
// UI can render. This module is PURE: it makes no network/agent/DB call. The
// route wires the real runDukePreflight; tests inject mock preflight outcomes.
//
// Hard rules:
//   - A full address/APN/owner is enough to START verification, never enough to
//     treat the parcel as verified. Verified requires a named source.
//   - If exact identity cannot be verified: Local Area Context, Not Parcel
//     Verified. Strategy/Underwriting stay blocked.
//   - Parcel identity never comes from coordinates or a proximity search.
//   - No comp credit / paid comp tool is ever called from here.

import type { DukePreflightOutcome } from './duke-preflight.js';
import { extractAreaSignals, buildLocalAreaContext, marketPulseEligibility } from './source-adapters.js';

export type DukeVerificationStatus =
  | 'parcel_verified'
  | 'local_area_context_not_parcel_verified'
  | 'unverified'
  | 'skipped_no_identity';

/** Identity fields populated ONLY when the parcel is verified by a named source.
 *  None of these are ever derived from coordinates or proximity. */
export interface DukeVerificationIdentity {
  apn?: string;
  fips?: string;
  propertyId?: string;
  situsAddress?: string;
  city?: string;
  county?: string;
  state?: string;
  owner?: string;
  acres?: number;
  lpUrl?: string;
}

export interface DukeVerificationSourceAttempt {
  source: string;
  status: 'verified' | 'not_verified' | 'timeout' | 'data_gap' | 'skipped';
  reason: string;
  /** Truth label this attempt would carry on the deal-card timeline. */
  truthLabel: 'verified_fact' | 'attempted_lookup' | 'data_gap';
}

export interface DukeVerificationResult {
  status: DukeVerificationStatus;
  parcelVerified: boolean;
  /** Present ONLY when verified — the named source that verified identity. */
  verificationSource?: string;
  /** Present ONLY when verified, and only with named source fields. */
  identity?: DukeVerificationIdentity;
  sourceAttempts: DukeVerificationSourceAttempt[];
  dataGaps: string[];
  /** Set when the input has city/county + state but no verified parcel. */
  localAreaContextLabel?: string;
  /** Market Pulse can be eligible as local area context even when unverified. */
  marketPulseEligible: boolean;
  /** Hard gate echo: unverified parcels keep Strategy/Underwriting blocked. */
  strategyUnderwritingBlocked: boolean;
  summary: string;
  /** Always read-only: this bridge runs the verification path, never writes. */
  executionMode: 'duke_verification_read_only';
}

const LANDPORTAL_SOURCE = 'LandPortal exact lookup';

/**
 * Resolve the text the "Run Duke parcel verification" button should send. The
 * Duke section is shown only once a read-only plan exists, so the action must
 * use the SAME input that produced that plan (`planText`), falling back to the
 * live textarea only if needed. It NEVER silently no-ops: an empty input returns
 * an explicit error message so the UI can show it instead of doing nothing.
 *
 * Pure + deterministic so the regression is unit-testable without a browser.
 */
export function resolveDukeVerificationInput(
  planText: string | null | undefined,
  liveText: string | null | undefined,
): { input: string; error?: string } {
  const fromPlan = (planText ?? '').trim();
  const fromLive = (liveText ?? '').trim();
  const input = fromPlan || fromLive;
  if (!input) {
    return { input: '', error: 'Run an intake plan first, then run Duke parcel verification.' };
  }
  return { input };
}

/** Parse the JSON payload embedded in a verified preflight parcel block. */
function parseVerifiedParcelBlock(block: string): Record<string, unknown> {
  const start = block.indexOf('{');
  const end = block.lastIndexOf('}');
  if (start < 0 || end <= start) return {};
  try {
    return JSON.parse(block.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function acresFromBlock(block: string): number | undefined {
  const m = block.match(/"lot_size_acres"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)"?/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Build the structured verification result from a preflight outcome. Pure.
 * Verified is set ONLY for a verified outcome WITH a named source and at least
 * one identity field — a bare address/APN/owner never reads as verified.
 */
export function buildDukeVerificationResult(pre: DukePreflightOutcome, intakeText: string): DukeVerificationResult {
  const area = extractAreaSignals(intakeText);
  const localArea = buildLocalAreaContext(area);
  const hasArea = localArea.hasCityState || localArea.hasCountyState;
  const marketPulseEligible = marketPulseEligibility(area).eligible;
  const localAreaContextLabel = hasArea ? 'Local Area Context, Not Parcel Verified' : undefined;

  if (pre.type === 'verified') {
    const payload = parseVerifiedParcelBlock(pre.parcelBlock);
    const identity: DukeVerificationIdentity = {
      apn: str(payload.apn),
      fips: str(payload.fips),
      propertyId: str(payload.propertyid),
      situsAddress: str(payload.situs_address),
      city: str(payload.city),
      state: str(payload.state),
      owner: str(payload.owner),
      acres: acresFromBlock(pre.parcelBlock),
    };
    const hasNamedIdentity = !!(identity.apn || identity.propertyId || identity.situsAddress || identity.owner);
    // Defensive: only call it verified when a named source + a real identity field
    // exist. Otherwise fall through to unverified (never fabricate a verified fact).
    if (hasNamedIdentity) {
      return {
        status: 'parcel_verified',
        parcelVerified: true,
        verificationSource: LANDPORTAL_SOURCE,
        identity,
        sourceAttempts: [
          { source: LANDPORTAL_SOURCE, status: 'verified', reason: str(payload.match_notes) ?? 'LandPortal returned a verified exact match.', truthLabel: 'verified_fact' },
        ],
        dataGaps: [],
        marketPulseEligible,
        strategyUnderwritingBlocked: false,
        summary: `Parcel verified via ${LANDPORTAL_SOURCE}.`,
        executionMode: 'duke_verification_read_only',
      };
    }
  }

  // Skip: no parcel identifier in the input (verification never started).
  if (pre.type === 'skip') {
    return {
      status: hasArea ? 'local_area_context_not_parcel_verified' : 'skipped_no_identity',
      parcelVerified: false,
      sourceAttempts: [
        { source: LANDPORTAL_SOURCE, status: 'skipped', reason: 'No parcel identifier (address/APN/owner+county/state) found in the input.', truthLabel: 'attempted_lookup' },
      ],
      dataGaps: ['no_parcel_identifier_in_input'],
      localAreaContextLabel,
      marketPulseEligible,
      strategyUnderwritingBlocked: true,
      summary: hasArea
        ? 'No parcel identity in the input. Local Area Context, Not Parcel Verified.'
        : 'No parcel identifier found. Provide an address, APN + county/state, or owner + county/state.',
      executionMode: 'duke_verification_read_only',
    };
  }

  // Blocked (timeout / multiple candidates / not verified / error): an exact
  // lookup was attempted but identity is not verified. Use the bounded fallback
  // ladder next (assessor/record/bounded-GIS/exact web), never broad scraping.
  const reason = pre.type === 'blocked' ? pre.reason : 'not_verified';
  const message = pre.type === 'blocked' ? pre.message : 'Parcel not verified.';
  const attemptStatus: DukeVerificationSourceAttempt['status'] =
    reason === 'lp_timeout' || reason === 'preflight_timeout' ? 'timeout' : 'not_verified';
  const dataGaps = ['parcel_identity_not_verified'];
  if (attemptStatus === 'timeout') dataGaps.push('landportal_lookup_timeout');

  return {
    status: hasArea ? 'local_area_context_not_parcel_verified' : 'unverified',
    parcelVerified: false,
    sourceAttempts: [
      { source: LANDPORTAL_SOURCE, status: attemptStatus, reason: message, truthLabel: 'attempted_lookup' },
    ],
    dataGaps,
    localAreaContextLabel,
    marketPulseEligible,
    strategyUnderwritingBlocked: true,
    summary: hasArea
      ? 'Parcel not verified. Local Area Context, Not Parcel Verified. Strategy and Underwriting remain blocked.'
      : 'Parcel not verified. Strategy and Underwriting remain blocked until exact identity is confirmed by a named source.',
    executionMode: 'duke_verification_read_only',
  };
}
