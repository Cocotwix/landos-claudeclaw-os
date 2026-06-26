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
import { extractPropertyArgs, looksLikePropertyInput } from './duke-preflight.js';
import type { LpResolveArgs, LpResolveResult } from './landportal-client.js';
import { extractAreaSignals, buildLocalAreaContext, marketPulseEligibility } from './source-adapters.js';
import { normalizeFromLpSummary, type DukePropertyData } from './duke-property-data.js';

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
  /** Full normalized LandPortal non-comp property data — present when verified. */
  propertyData?: DukePropertyData;
  sourceAttempts: DukeVerificationSourceAttempt[];
  dataGaps: string[];
  /** Human "what to provide / do next" derived from the data gap. */
  nextAction?: string;
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

export type DukeActionStage = 'clicked' | 'requesting' | 'empty_input';

/**
 * The SYNCHRONOUS pre-async outcome of pressing "Run Duke parcel verification".
 * A click is always registered (`clicked: true`) before any network call, and
 * the stage advances to `requesting` only when there is input to send, or
 * `empty_input` when there is nothing. The UI mirrors this so a stuck click can
 * be localized without a browser. Pure + deterministic.
 */
export function beginDukeAction(
  planText: string | null | undefined,
  liveText: string | null | undefined,
): { clicked: true; input: string; willRequest: boolean; stage: DukeActionStage; error?: string } {
  const { input, error } = resolveDukeVerificationInput(planText, liveText);
  if (error) return { clicked: true, input: '', willRequest: false, stage: 'empty_input', error };
  return { clicked: true, input, willRequest: true, stage: 'requesting' };
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

// ─────────────────────────────────────────────────────────────────────────
// Resolve-based verification (Sprint: DD execution).
//
// The lossy preflight `skip` outcome conflated "no parcel identifier" with
// "address parsed but LandPortal needs county/FIPS (ambiguous_fips)". A full
// street address IS a valid parcel identifier input, so it must NOT report
// `no_parcel_identifier_in_input`. This path maps the ACTUAL LandPortal resolver
// status truthfully. Dependency-injected so tests never make a live call.
// ─────────────────────────────────────────────────────────────────────────

function numFrom(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Human "what to provide / do next" for a given data gap. */
function nextActionFor(dataGap: string): string {
  switch (dataGap) {
    case 'no_parcel_identifier_in_input':
      return 'Provide a property identifier: address + county/state, APN + county/state, owner + county/state, or LandPortal property id + FIPS.';
    case 'needs_county_or_fips':
      return 'Provide the county (or FIPS) so LandPortal can run an exact address lookup. Coordinates are never used.';
    case 'multiple_candidates':
      return 'Provide an APN, FIPS, or LandPortal property id to pick the exact parcel.';
    case 'landportal_lookup_timeout':
      return 'LandPortal did not respond in time — retry, or provide APN + county for a direct lookup.';
    case 'landportal_unavailable':
      return 'LandPortal lookup is unavailable (configuration/connectivity). Retry shortly.';
    case 'landportal_error':
      return 'LandPortal returned an error — retry, or provide APN + county / property id + FIPS.';
    default:
      return 'Provide a stronger exact identifier (APN + county/state, or property id + FIPS).';
  }
}

interface ResolveMapInput {
  text: string;
  /** True when the input contains a usable parcel identifier (address/APN/owner). */
  hasIdentifierInput: boolean;
  /** The LandPortal resolver result, or null when not attempted/unavailable. */
  resolve: LpResolveResult | null;
  /** True when the lookup could not run (e.g. LandPortal not configured/unreachable). */
  unavailable: boolean;
}

/**
 * Map an actual LandPortal resolve result into a DukeVerificationResult. Pure.
 * Truthful per status: verified, not_verified, ambiguous_fips (needs county/FIPS
 * — NOT "no identifier"), multiple_candidates, lookup_timeout, error, or
 * unavailable. Coordinates are never used for identity.
 */
export function mapResolveToVerification(input: ResolveMapInput): DukeVerificationResult {
  const area = extractAreaSignals(input.text);
  const localArea = buildLocalAreaContext(area);
  const hasArea = localArea.hasCityState || localArea.hasCountyState;
  const marketPulseEligible = marketPulseEligibility(area).eligible;
  const localAreaContextLabel = hasArea ? 'Local Area Context, Not Parcel Verified' : undefined;

  // Truly no parcel identifier in the input — the only case that is "no identifier".
  if (!input.hasIdentifierInput) {
    return {
      status: hasArea ? 'local_area_context_not_parcel_verified' : 'skipped_no_identity',
      parcelVerified: false,
      sourceAttempts: [
        { source: LANDPORTAL_SOURCE, status: 'skipped', reason: 'No parcel identifier (address/APN/owner+county/state) in the input.', truthLabel: 'attempted_lookup' },
      ],
      dataGaps: ['no_parcel_identifier_in_input'],
      nextAction: nextActionFor('no_parcel_identifier_in_input'),
      localAreaContextLabel,
      marketPulseEligible,
      strategyUnderwritingBlocked: true,
      summary: hasArea
        ? 'No parcel identity in the input. Local Area Context, Not Parcel Verified.'
        : 'No parcel identifier found. Provide an address, APN + county/state, or owner + county/state.',
      executionMode: 'duke_verification_read_only',
    };
  }

  // Identifier present but the lookup could not run. Attempted, not skipped.
  if (input.unavailable || !input.resolve) {
    return {
      status: hasArea ? 'local_area_context_not_parcel_verified' : 'unverified',
      parcelVerified: false,
      sourceAttempts: [
        { source: LANDPORTAL_SOURCE, status: 'data_gap', reason: 'A parcel identifier was provided and a LandPortal exact lookup was attempted, but LandPortal is unavailable (not configured or unreachable).', truthLabel: 'attempted_lookup' },
      ],
      dataGaps: ['landportal_unavailable'],
      nextAction: nextActionFor('landportal_unavailable'),
      localAreaContextLabel,
      marketPulseEligible,
      strategyUnderwritingBlocked: true,
      summary: 'Parcel identifier provided, but LandPortal exact lookup is unavailable. Strategy and Underwriting remain blocked.',
      executionMode: 'duke_verification_read_only',
    };
  }

  const r = input.resolve;

  // Verified — only with named source + a real identity field.
  if (r.status === 'verified' && r.verified) {
    const ps = r.property_summary;
    const identity: DukeVerificationIdentity = {
      apn: str(r.apn),
      fips: str(r.fips),
      propertyId: str(r.propertyid),
      situsAddress: str(r.situs_address),
      city: str(r.city),
      state: str(r.state),
      owner: str(r.owner),
      county: ps ? str(ps.county) : undefined,
      acres: ps ? (numFrom(ps.lot_size_acres) ?? numFrom(ps.calc_acres)) : undefined,
    };
    const hasNamedIdentity = !!(identity.apn || identity.propertyId || identity.situsAddress || identity.owner);
    if (hasNamedIdentity) {
      const propertyData = ps ? normalizeFromLpSummary(ps, { fips: str(r.fips) }) : undefined;
      // Provider provenance: use the resolver's reported source (e.g. 'Realie.ai',
      // 'Persisted verified Property Card') and fall back to the LandPortal label.
      const verificationSource = str(r.source) ?? LANDPORTAL_SOURCE;
      return {
        status: 'parcel_verified',
        parcelVerified: true,
        verificationSource,
        identity,
        propertyData,
        sourceAttempts: [
          { source: verificationSource, status: 'verified', reason: str(r.match_notes) ?? 'Verified exact match.', truthLabel: 'verified_fact' },
        ],
        dataGaps: propertyData ? propertyData.dataGaps : [],
        marketPulseEligible,
        strategyUnderwritingBlocked: false,
        summary: `Parcel verified via ${LANDPORTAL_SOURCE}.`,
        executionMode: 'duke_verification_read_only',
      };
    }
  }

  // Non-verified resolver statuses, mapped truthfully (attempted, not skipped).
  let attemptStatus: DukeVerificationSourceAttempt['status'];
  let dataGap: string;
  let detail: string;
  switch (r.status) {
    case 'ambiguous_fips':
      attemptStatus = 'not_verified';
      dataGap = 'needs_county_or_fips';
      detail = 'Full address parsed and a LandPortal lookup was attempted; an exact address lookup needs the county or FIPS. Provide county or FIPS (never coordinates).';
      break;
    case 'multiple_candidates':
      attemptStatus = 'not_verified';
      dataGap = 'multiple_candidates';
      detail = 'Multiple parcels matched. Provide APN, FIPS, or property ID to disambiguate.';
      break;
    case 'lookup_timeout':
      attemptStatus = 'timeout';
      dataGap = 'landportal_lookup_timeout';
      detail = 'LandPortal exact lookup timed out.';
      break;
    case 'error':
      attemptStatus = 'data_gap';
      dataGap = 'landportal_error';
      detail = 'LandPortal exact lookup returned an error.';
      break;
    case 'point_candidate':
      // Coordinates/points are never accepted as final parcel identity.
      attemptStatus = 'not_verified';
      dataGap = 'parcel_identity_not_verified';
      detail = 'Parcel not verified (point candidates are never accepted as identity).';
      break;
    default:
      attemptStatus = 'not_verified';
      dataGap = 'parcel_identity_not_verified';
      detail = str(r.match_notes) ?? 'Parcel not verified.';
      break;
  }

  return {
    status: hasArea ? 'local_area_context_not_parcel_verified' : 'unverified',
    parcelVerified: false,
    sourceAttempts: [
      { source: LANDPORTAL_SOURCE, status: attemptStatus, reason: str(r.match_notes) ?? detail, truthLabel: 'attempted_lookup' },
    ],
    dataGaps: [dataGap],
    nextAction: nextActionFor(dataGap),
    localAreaContextLabel,
    marketPulseEligible,
    strategyUnderwritingBlocked: true,
    summary: `${hasArea ? 'Local Area Context, Not Parcel Verified. ' : ''}${detail} Strategy and Underwriting remain blocked.`,
    executionMode: 'duke_verification_read_only',
  };
}

export interface DukeVerificationDeps {
  /** The bounded LandPortal exact resolver (never a comp tool/credit). */
  resolve: (args: LpResolveArgs, timeoutMs: number) => Promise<LpResolveResult>;
  timeoutMs: number;
}

/**
 * Run Duke parcel verification for free-text input. Parses a parcel identifier,
 * attempts the bounded LandPortal exact lookup (injected), and maps the real
 * status. A full street address is a valid identifier and is NEVER reported as
 * `no_parcel_identifier_in_input`. No coordinate/proximity identity; no comp
 * credit. The resolver is injected so tests run without any live call.
 */
export async function runDukeVerification(text: string, deps: DukeVerificationDeps): Promise<DukeVerificationResult> {
  const args = extractPropertyArgs(text);
  const looksLikeProp = looksLikePropertyInput(text);
  const hasIdentifierInput = !!args || looksLikeProp;

  if (!hasIdentifierInput) {
    return mapResolveToVerification({ text, hasIdentifierInput: false, resolve: null, unavailable: false });
  }

  // Address-shaped but missing county/FIPS to call LP exactly: attempted, needs
  // county/FIPS — NOT "no identifier".
  if (!args) {
    return mapResolveToVerification({
      text,
      hasIdentifierInput: true,
      resolve: {
        verified: false, status: 'ambiguous_fips', propertyid: null, fips: null,
        apn: null, situs_address: null, owner: null,
        match_notes: 'Address recognized but missing county/FIPS for an exact LandPortal lookup. Provide county or FIPS (never coordinates).',
        candidates: [],
      },
      unavailable: false,
    });
  }

  try {
    const resolve = await deps.resolve(args, deps.timeoutMs);
    return mapResolveToVerification({ text, hasIdentifierInput: true, resolve, unavailable: false });
  } catch {
    // Never leak token/secret details from the error; report unavailable.
    return mapResolveToVerification({ text, hasIdentifierInput: true, resolve: null, unavailable: true });
  }
}
