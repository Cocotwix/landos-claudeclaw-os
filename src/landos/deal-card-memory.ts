// Deal Card Memory / Timeline Foundation — Sprint 6B/6C.
//
// Deal cards are the source of truth for each property/deal. Every event and
// finding is stored with a TRUTH/SOURCE/STATUS label. Unverified data is NEVER
// stored as a verified fact. This module is the typed contract + deterministic
// "update plan" builder. It does NOT write to the DB this sprint: persisting a
// timeline needs a new table/migration (flagged in the plan), and the sprint
// favors a safe local contract + update plan over aggressive writes.
//
// Hard rules:
//   - Unverified info -> needs_verification / attempted_lookup / data_gap, never
//     verified_fact.
//   - Verified facts require a named source.
//   - Seller asking price is seller_stated negotiation context only; it never
//     anchors a calculated offer range.
//   - Deal-card matching uses EXACT identity only (address / APN / owner+county
//     /state / deal card id / seller tied to one active deal). Ambiguous ->
//     require clarification. No fuzzy parcel identity, no coordinates/proximity.

import type { DukeVerificationResult } from './duke-verification-bridge.js';

// ─────────────────────────────────────────────────────────────────────────
// Labels + event types
// ─────────────────────────────────────────────────────────────────────────

export const DEAL_CARD_TRUTH_LABELS = [
  'verified_fact',
  'seller_stated',
  'market_context',
  'needs_verification',
  'attempted_lookup',
  'agent_recommendation',
  'communication_summary',
  'script',
  'open_question',
  'data_gap',
] as const;
export type DealCardTruthLabel = (typeof DEAL_CARD_TRUTH_LABELS)[number];

export const DEAL_CARD_EVENT_TYPES = [
  'property_added',
  'duke_verification_attempted',
  'parcel_verified',
  'verification_failed_local_area_context',
  'seller_stated_price_or_condition',
  'call_summary',
  'generated_script',
  'market_pulse_summary',
  'underwriting_snapshot',
  'strategy_recommendation',
  'source_attempt',
  'failed_source',
  'next_action',
] as const;
export type DealCardEventType = (typeof DEAL_CARD_EVENT_TYPES)[number];

// ─────────────────────────────────────────────────────────────────────────
// Contract interfaces
// ─────────────────────────────────────────────────────────────────────────

export interface DealCardSourceTrace {
  source: string;
  url?: string;
  status: 'verified' | 'not_verified' | 'timeout' | 'data_gap' | 'skipped';
  truthLabel: DealCardTruthLabel;
  /** Timestamp is set at PERSIST time (kept out of the deterministic plan). */
  timestampPolicy: 'set_at_persist';
}

export interface DealCardMemoryEntry {
  key: string;
  truthLabel: DealCardTruthLabel;
  value?: string;
  source?: string;
  note?: string;
}

export interface DealCardTimelineEntry {
  eventType: DealCardEventType;
  label: string;
  truthLabel: DealCardTruthLabel;
  summary: string;
  source?: string;
  /** Source attempts retained with status + (persist-time) timestamp labels. */
  sourceTrace?: DealCardSourceTrace;
  /** Set at persist time, not in the deterministic plan. */
  timestampPolicy: 'set_at_persist';
}

/** Exact identity reference for deal-card matching. NEVER fuzzy/coordinate. */
export interface DealCardIdentityReference {
  address?: string;
  apn?: string;
  ownerCountyState?: string;
  dealCardId?: number;
  /** True only when a seller is tied to exactly ONE known active deal. */
  sellerTiedToOneActiveDeal?: boolean;
}

export type DealCardMatchStatus = 'exact_match' | 'create_new' | 'ambiguous_needs_clarification';

export interface DealCardStorageIntent {
  willStoreNow: false;
  asLabels: DealCardTruthLabel[];
  reason: string;
}

export interface DealCardUpdatePlan {
  identityReference: DealCardIdentityReference;
  matchStatus: DealCardMatchStatus;
  matchReason: string;
  timeline: DealCardTimelineEntry[];
  memoryEntries: DealCardMemoryEntry[];
  storageIntent: DealCardStorageIntent;
  /** No DB write happens this sprint. */
  persistedNow: false;
  requiresMigration: boolean;
  migrationNote?: string;
  rule: string;
}

const PERSISTENCE_RULE =
  'Deal cards are the source of truth. Unverified/failed/unvalidated info is stored only as needs_verification, ' +
  'attempted_lookup, or data_gap — never as a verified_fact. Verified facts require a named source. Seller ask is ' +
  'seller_stated negotiation context and never anchors the calculated offer range.';

const MIGRATION_NOTE =
  'Persisting the timeline needs a new local table (e.g. landos_deal_card_timeline: id, deal_card_id, event_type, ' +
  'truth_label, summary, source, source_url, status, created_at) plus a deal-card matcher keyed on exact identity. ' +
  'Not added this sprint (no migration). The contract + update plan are ready to wire when approved.';

// ─────────────────────────────────────────────────────────────────────────
// Deterministic builders
// ─────────────────────────────────────────────────────────────────────────

/**
 * Resolve how this intake maps to a deal card using EXACT identity only.
 *   - dealCardId present -> exact_match.
 *   - APN, address, owner+county/state, or a seller tied to one active deal ->
 *     create_new (a new card from exact identity).
 *   - nothing exact -> ambiguous_needs_clarification (no fuzzy matching).
 */
export function resolveDealCardMatch(ref: DealCardIdentityReference): { status: DealCardMatchStatus; reason: string } {
  if (typeof ref.dealCardId === 'number') {
    return { status: 'exact_match', reason: `Exact match on deal card id ${ref.dealCardId}.` };
  }
  if (ref.sellerTiedToOneActiveDeal === true) {
    return { status: 'exact_match', reason: 'Seller is tied to exactly one known active deal.' };
  }
  if (ref.apn || ref.address || ref.ownerCountyState) {
    const on = [ref.apn ? 'APN' : '', ref.address ? 'address' : '', ref.ownerCountyState ? 'owner+county/state' : '']
      .filter(Boolean)
      .join(', ');
    return { status: 'create_new', reason: `Exact identity present (${on}); create/attach a deal card. No fuzzy matching.` };
  }
  return { status: 'ambiguous_needs_clarification', reason: 'No exact identity (address/APN/owner+county/state/deal id). Require clarification; never fuzzy-match a parcel.' };
}

function identityReferenceFromVerification(v: DukeVerificationResult): DealCardIdentityReference {
  const id = v.identity;
  const ownerCountyState =
    id?.owner && (id?.county || id?.state)
      ? `${id.owner}, ${[id.county, id.state].filter(Boolean).join(' ')}`.trim()
      : undefined;
  return {
    ...(id?.situsAddress ? { address: id.situsAddress } : {}),
    ...(id?.apn ? { apn: id.apn } : {}),
    ...(ownerCountyState ? { ownerCountyState } : {}),
  };
}

/**
 * Convert a Duke verification result (+ optional seller-stated ask) into a safe
 * deal-card update plan: timeline entries and memory entries carrying truth
 * labels. Pure + deterministic (no timestamps, no DB write). Unverified data is
 * labeled needs_verification / attempted_lookup / data_gap — never verified_fact.
 */
export function buildDealCardUpdatePlan(input: {
  verification: DukeVerificationResult;
  intakeText: string;
  /** Optional seller-stated asking price (negotiation context only). */
  sellerAskUsd?: number;
}): DealCardUpdatePlan {
  const v = input.verification;
  const timeline: DealCardTimelineEntry[] = [];
  const memoryEntries: DealCardMemoryEntry[] = [];
  const asLabels = new Set<DealCardTruthLabel>();

  const push = (e: DealCardTimelineEntry) => {
    timeline.push(e);
    asLabels.add(e.truthLabel);
  };

  // Property added — an event, labeled by current verification state.
  push({
    eventType: 'property_added',
    label: 'Property added',
    truthLabel: v.parcelVerified ? 'verified_fact' : 'needs_verification',
    summary: v.parcelVerified ? 'Property added with a verified parcel identity.' : 'Property added; parcel identity not yet verified.',
    timestampPolicy: 'set_at_persist',
  });

  // Duke verification attempted — always an attempted_lookup event.
  push({
    eventType: 'duke_verification_attempted',
    label: 'Duke verification attempted',
    truthLabel: 'attempted_lookup',
    summary: v.summary,
    timestampPolicy: 'set_at_persist',
  });

  if (v.parcelVerified && v.identity) {
    // Verified -> verified_fact, but ONLY because it carries a named source.
    const id = v.identity;
    const fields = [
      id.apn ? `APN ${id.apn}` : '',
      id.situsAddress ?? '',
      id.owner ? `owner ${id.owner}` : '',
      id.fips ? `FIPS ${id.fips}` : '',
      typeof id.acres === 'number' ? `${id.acres} ac` : '',
    ].filter(Boolean).join(' · ');
    push({
      eventType: 'parcel_verified',
      label: 'Parcel verified',
      truthLabel: 'verified_fact',
      summary: `Parcel verified${fields ? `: ${fields}` : ''}.`,
      source: v.verificationSource,
      sourceTrace: { source: v.verificationSource ?? 'named source', status: 'verified', truthLabel: 'verified_fact', timestampPolicy: 'set_at_persist' },
      timestampPolicy: 'set_at_persist',
    });
    if (id.apn) memoryEntries.push({ key: 'apn', truthLabel: 'verified_fact', value: id.apn, source: v.verificationSource });
    if (id.situsAddress) memoryEntries.push({ key: 'situs_address', truthLabel: 'verified_fact', value: id.situsAddress, source: v.verificationSource });
    if (id.owner) memoryEntries.push({ key: 'owner', truthLabel: 'verified_fact', value: id.owner, source: v.verificationSource });
    if (typeof id.acres === 'number') memoryEntries.push({ key: 'acres', truthLabel: 'verified_fact', value: String(id.acres), source: v.verificationSource });
  } else {
    // Not verified -> data_gap event carrying the Local Area Context label.
    push({
      eventType: 'verification_failed_local_area_context',
      label: v.localAreaContextLabel ?? 'Verification not completed',
      truthLabel: 'data_gap',
      summary: v.localAreaContextLabel
        ? 'Local Area Context, Not Parcel Verified. Strategy and Underwriting remain blocked.'
        : 'Parcel identity not verified. Strategy and Underwriting remain blocked.',
      timestampPolicy: 'set_at_persist',
    });
    memoryEntries.push({ key: 'parcel_identity', truthLabel: 'needs_verification', note: 'Verify via exact source before any scoring/valuation/offer.' });
  }

  // Source attempts -> retained with source/status labels (and persist-time ts).
  for (const a of v.sourceAttempts) {
    const isFail = a.status !== 'verified';
    push({
      eventType: isFail ? 'failed_source' : 'source_attempt',
      label: isFail ? `Source attempt failed: ${a.source}` : `Source attempt: ${a.source}`,
      truthLabel: a.truthLabel,
      summary: a.reason,
      source: a.source,
      sourceTrace: { source: a.source, status: a.status, truthLabel: a.truthLabel, timestampPolicy: 'set_at_persist' },
      timestampPolicy: 'set_at_persist',
    });
  }

  // Data gaps -> explicit data_gap entries.
  for (const g of v.dataGaps) {
    push({
      eventType: 'source_attempt',
      label: `Data gap: ${g}`,
      truthLabel: 'data_gap',
      summary: `Open data gap recorded: ${g}.`,
      timestampPolicy: 'set_at_persist',
    });
  }

  // Seller-stated ask -> seller_stated only; never a valuation/offer basis.
  if (typeof input.sellerAskUsd === 'number' && Number.isFinite(input.sellerAskUsd)) {
    push({
      eventType: 'seller_stated_price_or_condition',
      label: 'Seller-stated asking price',
      truthLabel: 'seller_stated',
      summary: `Seller stated an asking price of $${input.sellerAskUsd}. Negotiation context only — it does not anchor the calculated offer range.`,
      timestampPolicy: 'set_at_persist',
    });
    memoryEntries.push({ key: 'seller_ask_usd', truthLabel: 'seller_stated', value: String(input.sellerAskUsd), note: 'Negotiation context only; never a valuation basis.' });
  }

  // Market Pulse eligibility -> market_context note (no data invented).
  if (v.marketPulseEligible) {
    push({
      eventType: 'market_pulse_summary',
      label: 'Market Pulse eligible (local area context)',
      truthLabel: 'market_context',
      summary: 'Local area context is eligible for Market Pulse, separate from parcel verification. No approved market adapter connected yet; no data invented.',
      timestampPolicy: 'set_at_persist',
    });
  }

  const identityReference = identityReferenceFromVerification(v);
  const match = resolveDealCardMatch(identityReference);

  return {
    identityReference,
    matchStatus: match.status,
    matchReason: match.reason,
    timeline,
    memoryEntries,
    storageIntent: {
      willStoreNow: false,
      asLabels: [...asLabels],
      reason: 'Update plan only this sprint. Persisting requires the timeline table/migration below.',
    },
    persistedNow: false,
    requiresMigration: true,
    migrationNote: MIGRATION_NOTE,
    rule: PERSISTENCE_RULE,
  };
}
