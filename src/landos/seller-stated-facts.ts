// LandOS — post-discovery seller-stated facts.
//
// After a discovery call, Tyler records what the seller SAID. These are labeled
// "Seller stated" — NEVER Verified. They are stored on the deal's SUBJECT
// property card via landos_card_activity (kind='seller_stated_fact') so no schema
// migration is needed, and they feed the Deal Card's missing-facts, risk flags,
// completeness context, next-best-action, and underwriting readiness — without
// ever masquerading as verified facts.

import { getLandosDb } from './db.js';
import { attachCardActivity } from './property-card.js';

const ACTIVITY_KIND = 'seller_stated_fact';

export const SELLER_FACT_KINDS = [
  'access', 'easement', 'utilities', 'road_maintenance', 'survey', 'perc_septic',
  'liens', 'taxes_owed', 'family_decision_makers', 'price_expectation', 'timeline',
  'property_history', 'known_restrictions', 'improvements', 'structures_mobile_homes',
] as const;
export type SellerFactKind = (typeof SELLER_FACT_KINDS)[number];

export interface SellerStatedFact {
  kind: SellerFactKind;
  value: string;
  note?: string;
  recordedAt: number;
  recordedBy: string;
}

/** Kinds that, when present, raise a DD risk flag to confirm officially. */
const RISK_KINDS: Partial<Record<SellerFactKind, string>> = {
  liens: 'Seller stated possible lien(s) — confirm via county/title (Seller-stated, not verified).',
  taxes_owed: 'Seller stated taxes owed — confirm county tax status (Seller-stated, not verified).',
  easement: 'Seller stated an easement — confirm recorded easement/access (Seller-stated, not verified).',
  known_restrictions: 'Seller stated restrictions — confirm zoning/deed restrictions (Seller-stated, not verified).',
  access: 'Seller stated access details — confirm legal/recorded access (Seller-stated, not verified).',
  perc_septic: 'Seller stated perc/septic info — confirm with county health/perc test (Seller-stated, not verified).',
};

export function isSellerFactKind(v: string): v is SellerFactKind {
  return (SELLER_FACT_KINDS as readonly string[]).includes(v);
}

/** Record a seller-stated fact on the deal's subject property card. Labeled
 *  Seller stated. Returns the stored fact. Never marks anything Verified. */
export function addSellerStatedFact(cardId: number, input: { kind: SellerFactKind; value: string; note?: string; recordedBy?: string }): SellerStatedFact {
  const fact: SellerStatedFact = {
    kind: input.kind,
    value: input.value.trim(),
    note: input.note?.trim() || undefined,
    recordedAt: Math.floor(Date.now() / 1000),
    recordedBy: (input.recordedBy ?? 'tyler').trim() || 'tyler',
  };
  attachCardActivity({ cardId, agentId: fact.recordedBy, kind: ACTIVITY_KIND, summary: `Seller stated: ${fact.kind}`, ref: JSON.stringify(fact) });
  return fact;
}

/** Load all seller-stated facts for a subject card (newest first). */
export function loadSellerStatedFacts(cardId: number): SellerStatedFact[] {
  const rows = getLandosDb()
    .prepare(`SELECT ref FROM landos_card_activity WHERE card_id = ? AND kind = ? ORDER BY created_at DESC, id DESC`)
    .all(cardId, ACTIVITY_KIND) as Array<{ ref: string }>;
  const out: SellerStatedFact[] = [];
  for (const r of rows) {
    try {
      const f = JSON.parse(r.ref) as SellerStatedFact;
      if (f && isSellerFactKind(f.kind)) out.push(f);
    } catch { /* skip malformed */ }
  }
  return out;
}

export interface SellerFactsSummary {
  count: number;
  /** Distinct kinds present (most recent value per kind). */
  kinds: SellerFactKind[];
  /** Risk flags implied by seller-stated facts (each clearly Seller-stated). */
  riskFlags: string[];
  /** True once at least one seller-stated fact exists (discovery happened). */
  discoveryCaptured: boolean;
}

/** Summarize seller facts for readiness/underwriting. Pure over the loaded list. */
export function summarizeSellerFacts(facts: SellerStatedFact[]): SellerFactsSummary {
  const kinds = [...new Set(facts.map((f) => f.kind))];
  const riskFlags: string[] = [];
  for (const k of kinds) {
    const flag = RISK_KINDS[k];
    if (flag) riskFlags.push(flag);
  }
  return { count: facts.length, kinds, riskFlags, discoveryCaptured: facts.length > 0 };
}
