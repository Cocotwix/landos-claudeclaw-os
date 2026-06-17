// Sprint 6B/6C tests: Deal Card Memory / Timeline update plan.
// Pure + deterministic. No DB writes (update plan only).

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

import {
  DEAL_CARD_TRUTH_LABELS,
  DEAL_CARD_EVENT_TYPES,
  resolveDealCardMatch,
  buildDealCardUpdatePlan,
} from './deal-card-memory.js';
import { buildDukeVerificationResult } from './duke-verification-bridge.js';
import type { DukePreflightOutcome } from './duke-preflight.js';

function verified(): DukePreflightOutcome {
  const block = [
    '[DUKE PREFLIGHT]',
    '',
    JSON.stringify({ verified: true, apn: '051-012-05', situs_address: '1234 Filter Plant Rd', city: 'Cottageville', state: 'SC', owner: 'Cheryl Sann', match_notes: 'exact', lot_size_acres: '5.2' }, null, 2),
    '[END DUKE PREFLIGHT]',
  ].join('\n');
  return { type: 'verified', parcelBlock: block, filteredMcpAllowlist: [] };
}

describe('truth labels + event types', () => {
  it('includes every required truth label', () => {
    for (const l of ['verified_fact', 'seller_stated', 'market_context', 'needs_verification', 'attempted_lookup', 'agent_recommendation', 'communication_summary', 'script', 'open_question', 'data_gap']) {
      expect((DEAL_CARD_TRUTH_LABELS as readonly string[]).includes(l), l).toBe(true);
    }
  });
  it('includes the core timeline event types', () => {
    for (const e of ['property_added', 'duke_verification_attempted', 'parcel_verified', 'verification_failed_local_area_context', 'seller_stated_price_or_condition', 'market_pulse_summary', 'source_attempt', 'failed_source', 'next_action']) {
      expect((DEAL_CARD_EVENT_TYPES as readonly string[]).includes(e), e).toBe(true);
    }
  });
});

describe('deal-card matching uses exact identity only', () => {
  it('deal card id -> exact_match', () => {
    expect(resolveDealCardMatch({ dealCardId: 7 }).status).toBe('exact_match');
  });
  it('seller tied to one active deal -> exact_match', () => {
    expect(resolveDealCardMatch({ sellerTiedToOneActiveDeal: true }).status).toBe('exact_match');
  });
  it('exact identity (APN/address/owner+county) -> create_new', () => {
    expect(resolveDealCardMatch({ apn: '051-012-05' }).status).toBe('create_new');
    expect(resolveDealCardMatch({ address: '1234 Filter Plant Rd' }).status).toBe('create_new');
  });
  it('nothing exact -> ambiguous, never fuzzy', () => {
    const r = resolveDealCardMatch({});
    expect(r.status).toBe('ambiguous_needs_clarification');
    expect(r.reason.toLowerCase()).toContain('never fuzzy');
  });
});

describe('unverified info is never stored as a verified fact', () => {
  const v = buildDukeVerificationResult({ type: 'blocked', message: 'Parcel not verified.', reason: 'not_verified' }, '1234 Filter Plant Rd, Cottageville, SC');
  const plan = buildDealCardUpdatePlan({ verification: v, intakeText: '1234 Filter Plant Rd, Cottageville, SC' });

  it('has no verified_fact timeline entries when the parcel is unverified', () => {
    expect(plan.timeline.some((t) => t.truthLabel === 'verified_fact')).toBe(false);
  });
  it('records the failure as data_gap and parcel identity as needs_verification', () => {
    expect(plan.timeline.some((t) => t.eventType === 'verification_failed_local_area_context' && t.truthLabel === 'data_gap')).toBe(true);
    expect(plan.memoryEntries.some((m) => m.key === 'parcel_identity' && m.truthLabel === 'needs_verification')).toBe(true);
  });
  it('persists nothing this sprint and flags the required migration', () => {
    expect(plan.persistedNow).toBe(false);
    expect(plan.requiresMigration).toBe(true);
    expect(plan.migrationNote).toMatch(/landos_deal_card_timeline/);
  });
});

describe('verified info becomes verified_fact only with a named source', () => {
  const v = buildDukeVerificationResult(verified(), 'APN: 051-012-05, Colleton County, SC');
  const plan = buildDealCardUpdatePlan({ verification: v, intakeText: 'APN: 051-012-05, Colleton County, SC' });

  it('adds a parcel_verified entry labeled verified_fact carrying the source', () => {
    const entry = plan.timeline.find((t) => t.eventType === 'parcel_verified');
    expect(entry?.truthLabel).toBe('verified_fact');
    expect(entry?.source).toBe('LandPortal exact lookup');
    expect(plan.memoryEntries.some((m) => m.key === 'apn' && m.truthLabel === 'verified_fact' && m.source === 'LandPortal exact lookup')).toBe(true);
  });
});

describe('seller ask + source attempts labeling', () => {
  const v = buildDukeVerificationResult({ type: 'blocked', message: 'Parcel not verified.', reason: 'lp_timeout' }, '1234 Filter Plant Rd, Cottageville, SC');
  const plan = buildDealCardUpdatePlan({ verification: v, intakeText: '1234 Filter Plant Rd, Cottageville, SC', sellerAskUsd: 50000 });

  it('stores seller ask as seller_stated, never a valuation basis', () => {
    const entry = plan.timeline.find((t) => t.eventType === 'seller_stated_price_or_condition');
    expect(entry?.truthLabel).toBe('seller_stated');
    expect(entry?.summary.toLowerCase()).toContain('does not anchor');
    expect(plan.memoryEntries.some((m) => m.key === 'seller_ask_usd' && m.truthLabel === 'seller_stated')).toBe(true);
    // Never verified_fact / never an offer basis.
    expect(plan.memoryEntries.some((m) => m.key === 'seller_ask_usd' && m.truthLabel === 'verified_fact')).toBe(false);
  });

  it('retains source attempts with source + status (+ persist-time timestamp policy)', () => {
    const entry = plan.timeline.find((t) => t.sourceTrace);
    expect(entry?.sourceTrace?.source).toBe('LandPortal exact lookup');
    expect(entry?.sourceTrace?.status).toBeTypeOf('string');
    expect(entry?.sourceTrace?.timestampPolicy).toBe('set_at_persist');
  });
});

describe('no banned identity-source language in the contract', () => {
  const SRC = fs.readFileSync(fileURLToPath(new URL('./deal-card-memory.ts', import.meta.url)), 'utf-8');
  it('uses no geocoder/coordinate-pin/proximity-match parcel-identity language', () => {
    for (const banned of ['geocoder', 'geocode', 'map pin', 'satellite', 'street view', 'nearest parcel', 'road midpoint', 'centroid', 'proximity match']) {
      expect(SRC.toLowerCase().includes(banned), banned).toBe(false);
    }
  });
  it('never calls a paid LandPortal comp tool', () => {
    expect(/lp_comp_report_create\s*\(/.test(SRC)).toBe(false);
    expect(/lp_comp_report_get\s*\(/.test(SRC)).toBe(false);
  });
});
