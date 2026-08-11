// LandOS — persistence for land-use determinations.
//
// ISOLATED storage, exactly like the official-parcel evidence it builds on: one
// property's legal research is scoped to its deal card, cascades with it, and
// is never reused for another property. There is no shared table here, because
// there is nothing in a determination that is reusable — a rule is only ever
// true for the jurisdiction and the parcel it was established for.
//
// Append-only. A later run adds a row; it never rewrites the conclusion an
// operator has already read and acted on.

import { getLandosDb, landosAudit } from './db.js';
import type { LandUseDetermination } from './land-use-types.js';

export interface LandUseDeterminationRecord {
  id: number;
  dealCardId: number;
  determination: LandUseDetermination;
  determinedAt: string;
}

interface Row {
  id: number;
  deal_card_id: number;
  determination_json: string;
  determined_at: string;
}

function toRecord(row: Row): LandUseDeterminationRecord {
  return {
    id: row.id,
    dealCardId: row.deal_card_id,
    determination: JSON.parse(row.determination_json) as LandUseDetermination,
    determinedAt: row.determined_at,
  };
}

/**
 * Persist one determination.
 *
 * The indexed columns are a read convenience only; the determination JSON is
 * the record. They are written from the determination rather than passed in, so
 * an index can never disagree with the conclusion it indexes.
 */
export function saveLandUseDetermination(dealCardId: number, determination: LandUseDetermination): LandUseDeterminationRecord {
  const info = getLandosDb().prepare(`
    INSERT INTO landos_land_use_determination (
      deal_card_id, state, county, local_unit, zoning_presence, zoning_code,
      authority_pattern, legal_yield_status, legal_yield_max_lots,
      determination_json, determined_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    dealCardId,
    determination.subject.state,
    determination.subject.county,
    determination.authority.localUnit.name.value,
    determination.zoning.presence,
    determination.zoning.code.value,
    determination.authority.pattern,
    determination.legalYield.status,
    determination.legalYield.maximumLots,
    JSON.stringify(determination),
    determination.determinedAt,
  );

  landosAudit(
    'land-use',
    'land_use_determination_recorded',
    `deal ${dealCardId}: ${determination.zoning.presence} / ${determination.authority.pattern} / legal yield ${determination.legalYield.status}`,
    { refTable: 'landos_land_use_determination', refId: Number(info.lastInsertRowid) },
  );

  return {
    id: Number(info.lastInsertRowid),
    dealCardId,
    determination,
    determinedAt: determination.determinedAt,
  };
}

/** The current determination for one deal, or null when the lane never ran. */
export function getLandUseDetermination(dealCardId: number): LandUseDeterminationRecord | null {
  const row = getLandosDb().prepare(`
    SELECT id, deal_card_id, determination_json, determined_at
    FROM landos_land_use_determination
    WHERE deal_card_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(dealCardId) as Row | undefined;
  return row ? toRecord(row) : null;
}

/** Prior determinations for one deal, newest first. Read-only history. */
export function listLandUseDeterminations(dealCardId: number, limit = 5): LandUseDeterminationRecord[] {
  const rows = getLandosDb().prepare(`
    SELECT id, deal_card_id, determination_json, determined_at
    FROM landos_land_use_determination
    WHERE deal_card_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(dealCardId, limit) as Row[];
  return rows.map(toRecord);
}
