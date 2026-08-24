// LandOS — Deal Brain guidance.
//
// The operator's deal-specific hypotheses, priorities and questions ("I think
// the rear road matters", "focus on the quick flip unless subdivision adds at
// least $30K"), plus the Deal Brain's replies to them.
//
// Guidance is an INPUT the Deal Intelligence weighs and responds to. It is
// never a canonical property fact, it establishes no evidence, and nothing in
// this module can write to a property record. Promoting a guidance statement
// into a fact is a separate, explicit operator action that does not exist here.

import { getLandosDb } from './db.js';

export type DealBrainGuidanceRole = 'operator' | 'deal_brain';

export interface DealBrainGuidanceEntry {
  id: number;
  dealCardId: number;
  role: DealBrainGuidanceRole;
  text: string;
  createdAt: number;
}

export interface DealBrainCurrentTruth {
  acceptedCompCount: number;
  supportedFmv: number | null;
}

export interface DealBrainGuidanceProjection {
  thread: DealBrainGuidanceEntry[];
  staleReplies: Array<DealBrainGuidanceEntry & { staleReason: string }>;
}

const MAX_GUIDANCE_TEXT = 4_000;

export function appendDealBrainGuidance(
  dealCardId: number,
  role: DealBrainGuidanceRole,
  text: string,
): DealBrainGuidanceEntry {
  const trimmed = text.replace(/\s+/g, ' ').trim().slice(0, MAX_GUIDANCE_TEXT);
  if (!trimmed) throw new Error('Guidance text is empty.');
  const db = getLandosDb();
  const result = db.prepare(
    'INSERT INTO landos_deal_brain_guidance (deal_card_id, role, text) VALUES (?, ?, ?)',
  ).run(dealCardId, role, trimmed);
  const row = db.prepare('SELECT id, deal_card_id, role, text, created_at FROM landos_deal_brain_guidance WHERE id=?')
    .get(result.lastInsertRowid) as { id: number; deal_card_id: number; role: DealBrainGuidanceRole; text: string; created_at: number };
  return { id: row.id, dealCardId: row.deal_card_id, role: row.role, text: row.text, createdAt: row.created_at };
}

/** The conversation, oldest first. A pure SELECT. */
export function listDealBrainGuidance(dealCardId: number, limit = 60): DealBrainGuidanceEntry[] {
  const rows = getLandosDb().prepare(`
    SELECT id, deal_card_id, role, text, created_at FROM landos_deal_brain_guidance
    WHERE deal_card_id=? AND status='active' ORDER BY id DESC LIMIT ?
  `).all(dealCardId, limit) as Array<{ id: number; deal_card_id: number; role: DealBrainGuidanceRole; text: string; created_at: number }>;
  return rows.reverse().map((row) => ({
    id: row.id,
    dealCardId: row.deal_card_id,
    role: row.role,
    text: row.text,
    createdAt: row.created_at,
  }));
}

/**
 * Select the conversation that is still compatible with current canonical
 * valuation truth. Deal Brain replies are retained guidance, not facts, and
 * older rows historically had no freshness metadata. A reply that explicitly
 * denies evidence the current accepted record now carries is therefore stale:
 * retain it for audit, but never project it as the current answer.
 */
export function projectCurrentDealBrainGuidance(
  entries: DealBrainGuidanceEntry[],
  truth: DealBrainCurrentTruth,
): DealBrainGuidanceProjection {
  const thread: DealBrainGuidanceEntry[] = [];
  const staleReplies: DealBrainGuidanceProjection['staleReplies'] = [];
  for (const entry of entries) {
    if (entry.role !== 'deal_brain') {
      thread.push(entry);
      continue;
    }
    const deniesAcceptedSales = truth.acceptedCompCount > 0 && (
      /no\s+(?:accepted\s+|usable\s+)?closed(?:-sale|\s+sale)?[^.]*\b(?:comp|sale|evidence)/i.test(entry.text)
      || /accepted(?:-sale|\s+closed-sale|\s+closed sale)[^.]*\b(?:does not exist|doesn't exist|unavailable|not available)/i.test(entry.text)
    );
    const deniesSupportedFmv = truth.supportedFmv != null && (
      /no\s+supported\s+(?:fmv|fair market value|valuation)/i.test(entry.text)
      || /supported\s+(?:fmv|fair market value|valuation)[^.]*\b(?:does not exist|doesn't exist|unavailable|not available)/i.test(entry.text)
    );
    if (deniesAcceptedSales || deniesSupportedFmv) {
      const current = [
        truth.acceptedCompCount > 0 ? `${truth.acceptedCompCount} accepted closed sale(s)` : null,
        truth.supportedFmv != null ? `supported FMV $${Math.round(truth.supportedFmv).toLocaleString('en-US')}` : null,
      ].filter(Boolean).join(' and ');
      staleReplies.push({ ...entry, staleReason: `Current canonical truth carries ${current}.` });
    } else {
      thread.push(entry);
    }
  }
  return { thread, staleReplies };
}

/** Retire only the stale Deal Brain replies a successful current-truth refresh
 * superseded. Operator guidance remains active and every retired reply remains
 * persisted for audit/history. */
export function retireDealBrainReplies(dealCardId: number, replyIds: number[]): number {
  const ids = [...new Set(replyIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const result = getLandosDb().prepare(`
    UPDATE landos_deal_brain_guidance SET status='retired'
    WHERE deal_card_id=? AND role='deal_brain' AND status='active' AND id IN (${placeholders})
  `).run(dealCardId, ...ids);
  return result.changes;
}

/** The operator guidance currently in effect for a Deal Intelligence read:
 *  the most recent operator statements, oldest first. */
export function activeOperatorGuidance(dealCardId: number, limit = 8): string[] {
  const rows = getLandosDb().prepare(`
    SELECT text FROM landos_deal_brain_guidance
    WHERE deal_card_id=? AND role='operator' AND status='active'
    ORDER BY id DESC LIMIT ?
  `).all(dealCardId, limit) as Array<{ text: string }>;
  return rows.reverse().map((row) => row.text);
}
