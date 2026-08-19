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
