import { getLandosDb, landosAudit } from './db.js';

export type MaterialPropertyAction = 'create' | 'reject' | 'canonicalize' | 'split' | 'merge' | 'suppress' | 'reclassify' | 'archive';

export interface PropertyEvidenceSnapshot {
  cardId: number;
  address: string;
  aliases?: string[];
  apn?: string;
  county?: string;
  state?: string;
  city?: string;
  coordinates?: { lat: number; lng: number } | null;
  parcelGeometryKey?: string | null;
  verificationSource?: string;
}

export interface InstructionConsistencyInput {
  action: MaterialPropertyAction;
  instruction: string;
  incomingAddress?: string;
  incomingApn?: string;
  incomingCounty?: string;
  incomingState?: string;
  incomingCoordinates?: { lat: number; lng: number } | null;
  incomingParcelGeometryKey?: string | null;
  externalNormalizedAddress?: string;
  operatorCorrection?: boolean;
  existing: PropertyEvidenceSnapshot;
}

export interface InstructionConsistencyResult {
  allowed: boolean;
  contradiction: boolean;
  hardConflicts: string[];
  harmlessNormalizations: string[];
  interpretation: string;
  actionTaken: string;
}

const ROAD_WORDS = new Set(['ROAD', 'RD', 'STREET', 'ST', 'AVENUE', 'AVE', 'DRIVE', 'DR', 'LANE', 'LN', 'HIGHWAY', 'HWY', 'ROUTE', 'RT']);

function tokens(value: string): string[] {
  return String(value ?? '').toUpperCase().replace(/\bTENNESSEE\b/g, 'TN').replace(/\bTRL\b/g, 'TRAIL').replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
}

function streetNumber(value: string): string | null {
  // A US house number leads the street line. Scanning the whole string made a
  // trailing ZIP ("OLD RIDGE RD, KINGSTON, TN 37763") read as a house number,
  // which then failed every road-only comparison as "materially different".
  const first = tokens(value)[0];
  return first && /^\d+[A-Z]?$/.test(first) && !/^\d{5}$/.test(first) ? first : null;
}

/** Street line only (before the first comma) — city/state/ZIP never join a
 *  road-name comparison. */
function streetLine(value: string): string {
  return String(value ?? '').split(',')[0] ?? '';
}

/**
 * PURE: do two ROAD NAMES refer to the same road? House numbers are not
 * required — this is the comparator for road-only situs candidates (vacant
 * land). "OLD RIDGE RD" ↔ "Old Ridge Road" agree; "OLD RIDGE RD" ↔
 * "Ridge Trail Road" are materially different and must never corroborate.
 * Same tolerance as addressVariantsCompatible: the shorter token set must be
 * fully contained in the longer, with at most one extra token.
 */
export function roadNamesCompatible(a: string, b: string): boolean {
  const left = coreStreet(streetLine(a));
  const right = coreStreet(streetLine(b));
  if (!left.length || !right.length) return false;
  const short = left.length <= right.length ? left : right;
  const long = left.length <= right.length ? right : left;
  if (!short.every((word) => long.includes(word))) return false;
  return long.length - short.length <= 1;
}

function coreStreet(value: string): string[] {
  const locality = new Set(['TN', 'SC', 'GA', 'NC', 'AL', 'KY', 'VA', 'WV', 'VONORE', 'VENORE', 'MONROE', 'COUNTY']);
  return tokens(value).filter((token) => !/^\d+[A-Z]?$/.test(token) && !/^\d{5}$/.test(token) && !ROAD_WORDS.has(token) && !locality.has(token));
}

function norm(value: string | null | undefined): string {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function localityCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true;
  const left = norm(a);
  const right = norm(b);
  if (left === right) return true;
  return (left === 'VENORE' && right === 'VONORE') || (left === 'VONORE' && right === 'VENORE');
}

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function addressVariantsCompatible(a: string, b: string): boolean {
  const aNumber = streetNumber(a);
  const bNumber = streetNumber(b);
  if (!aNumber || !bNumber || aNumber !== bNumber) return false;
  const left = coreStreet(a);
  const right = coreStreet(b);
  if (!left.length || !right.length) return false;
  const short = left.length <= right.length ? left : right;
  const long = left.length <= right.length ? right : left;
  if (!short.every((word) => long.includes(word))) return false;
  return long.length - short.length <= 1;
}

export function evaluatePropertyInstructionConsistency(input: InstructionConsistencyInput): InstructionConsistencyResult {
  const hardConflicts: string[] = [];
  const harmlessNormalizations: string[] = [];
  const existing = input.existing;
  if (input.incomingApn && existing.apn && norm(input.incomingApn) !== norm(existing.apn)) hardConflicts.push('different accepted APN');
  if (!localityCompatible(input.incomingCounty, existing.county)) hardConflicts.push('different county');
  if (!localityCompatible(input.incomingState, existing.state)) hardConflicts.push('different state');
  if (input.incomingAddress && existing.address) {
    const incomingNumber = streetNumber(input.incomingAddress);
    const acceptedNumber = streetNumber(existing.address);
    if (incomingNumber && acceptedNumber && incomingNumber !== acceptedNumber) hardConflicts.push('different street number');
    else if (addressVariantsCompatible(input.incomingAddress, existing.address)) harmlessNormalizations.push('address formatting or one-token public normalization');
    else if (incomingNumber && acceptedNumber) hardConflicts.push('materially different street name');
  }
  if (input.incomingCoordinates && existing.coordinates) {
    const meters = distanceMeters(input.incomingCoordinates, existing.coordinates);
    if (meters > 250) hardConflicts.push(`coordinates differ by ${Math.round(meters)}m`);
    else harmlessNormalizations.push('near-identical accepted coordinates');
  }
  if (input.incomingParcelGeometryKey && existing.parcelGeometryKey && input.incomingParcelGeometryKey !== existing.parcelGeometryKey) hardConflicts.push('different parcel geometry');
  if (input.externalNormalizedAddress && addressVariantsCompatible(input.externalNormalizedAddress, existing.address)) harmlessNormalizations.push('external normalized address agrees with the accepted subject');

  const destructive = ['reject', 'split', 'suppress', 'reclassify', 'archive'].includes(input.action);
  const acceptedIdentity = !!(existing.apn && existing.verificationSource);
  const onlyNormalization = harmlessNormalizations.length > 0 && hardConflicts.length === 0;
  const contradiction = destructive && acceptedIdentity && (onlyNormalization || input.operatorCorrection === true);
  const allowed = hardConflicts.length > 0 || !contradiction;
  return {
    allowed,
    contradiction,
    hardConflicts,
    harmlessNormalizations,
    interpretation: contradiction
      ? `Preserve card ${existing.cardId}: accepted parcel evidence outweighs an instruction based only on harmless address normalization.`
      : hardConflicts.length
        ? `Material parcel conflict requires the existing hard-stop workflow: ${hardConflicts.join(', ')}.`
        : `Instruction is consistent with the accepted property evidence.`,
    actionTaken: contradiction ? 'instruction rejected; accepted property preserved' : hardConflicts.length ? 'hard conflict retained' : 'instruction allowed',
  };
}

export function ensureInstructionConsistencyTables(): void {
  getLandosDb().exec(`
    CREATE TABLE IF NOT EXISTS landos_instruction_contradiction (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL,
      instruction_received TEXT NOT NULL,
      operator_value TEXT NOT NULL DEFAULT '',
      accepted_identifiers_json TEXT NOT NULL DEFAULT '{}',
      external_normalization TEXT NOT NULL DEFAULT '',
      conflict_detected TEXT NOT NULL,
      evidence_supported_interpretation TEXT NOT NULL,
      action_taken TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_instruction_contradiction_card ON landos_instruction_contradiction(card_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS landos_property_correction_link (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      erroneous_card_id INTEGER NOT NULL,
      canonical_card_id INTEGER NOT NULL,
      relationship TEXT NOT NULL DEFAULT 'erroneous_duplicate',
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(erroneous_card_id, canonical_card_id, relationship)
    );
  `);
}

export function recordInstructionContradiction(input: InstructionConsistencyInput, result: InstructionConsistencyResult, actor = 'landos/instruction-consistency'): number {
  ensureInstructionConsistencyTables();
  const existing = getLandosDb().prepare(`SELECT id FROM landos_instruction_contradiction
    WHERE card_id=? AND instruction_received=? AND action_taken=? ORDER BY id DESC LIMIT 1`)
    .get(input.existing.cardId, input.instruction, result.actionTaken) as { id: number } | undefined;
  if (existing) return existing.id;
  const identifiers = { apn: input.existing.apn ?? '', county: input.existing.county ?? '', state: input.existing.state ?? '', coordinates: input.existing.coordinates ?? null, verificationSource: input.existing.verificationSource ?? '' };
  const reason = result.harmlessNormalizations.concat(result.hardConflicts).join('; ') || 'operator correction and accepted parcel history contradict the instruction';
  const row = getLandosDb().prepare(`INSERT INTO landos_instruction_contradiction
    (card_id, instruction_received, operator_value, accepted_identifiers_json, external_normalization, conflict_detected, evidence_supported_interpretation, action_taken, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(input.existing.cardId, input.instruction, input.existing.address, JSON.stringify(identifiers), input.externalNormalizedAddress ?? '', 'material instruction conflicts with stronger accepted evidence', result.interpretation, result.actionTaken, reason);
  getLandosDb().prepare(`INSERT INTO landos_card_activity (card_id, agent_id, kind, summary, ref) VALUES (?, ?, 'instruction_contradiction', ?, ?)`)
    .run(input.existing.cardId, actor, result.interpretation, JSON.stringify({ contradictionId: Number(row.lastInsertRowid), instruction: input.instruction, actionTaken: result.actionTaken }));
  landosAudit(actor, 'property_instruction_overridden', result.interpretation, { refTable: 'landos_property_card', refId: input.existing.cardId, blocked: true });
  return Number(row.lastInsertRowid);
}

export function linkErroneousPropertyRecord(erroneousCardId: number, canonicalCardId: number, note: string): void {
  ensureInstructionConsistencyTables();
  getLandosDb().prepare(`INSERT INTO landos_property_correction_link (erroneous_card_id, canonical_card_id, relationship, note)
    VALUES (?, ?, 'erroneous_duplicate', ?) ON CONFLICT(erroneous_card_id, canonical_card_id, relationship) DO UPDATE SET note=excluded.note`)
    .run(erroneousCardId, canonicalCardId, note);
}
