// Deal Card — Strategy worksheet.
//
// A safe local landing place for the Strategy department leg. Everything here is
// MANUAL/LOCAL strategy analysis. Strategy is NEVER a verified fact and NEVER a
// final offer: it captures candidates, a current recommendation, the most viable
// exit, blockers, next confirmations, per-strategy notes, and an honest
// offer-readiness label.
//
// Hard rules enforced here:
//   - Distinct exit strategies keep DISTINCT note fields (quick flip, subdivide,
//     land-home package, improved/mobile-home value-add, teardown/land-only,
//     pass). They are never collapsed into one generic offer range.
//   - offer_readiness defaults to 'not_reviewed'. It is only advanced by Tyler or
//     a future strategy workflow; nothing here auto-promotes it.
//   - No offer math, no comps, no EVs are computed. target_profit_note is a
//     free-text note, never a calculated number.
//   - One worksheet row per Deal Card (upsert; never a duplicate).
//   - No network, no .env, no secrets, no paid/LandPortal calls. File-backed
//     SQLite (store/landos.db, gitignored).

import {
  getLandosDb,
  landosAudit,
  type StrategyOfferReadiness,
  STRATEGY_OFFER_READINESS,
} from './db.js';
import { getDealCardRow } from './deal-card.js';

const READINESS_SET = new Set<string>(STRATEGY_OFFER_READINESS);

/** Validate an offer-readiness label, falling back to the safe default. */
function asReadiness(
  v: unknown,
  fallback: StrategyOfferReadiness = 'not_reviewed',
): StrategyOfferReadiness {
  return typeof v === 'string' && READINESS_SET.has(v) ? (v as StrategyOfferReadiness) : fallback;
}

/** Parse a JSON string array column into a clean, trimmed, non-empty list. */
function parseStrArray(s: string | null | undefined): string[] {
  try {
    const a = JSON.parse(s ?? '[]');
    if (!Array.isArray(a)) return [];
    return a.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim());
  } catch {
    return [];
  }
}

function normalizeStrList(list: string[]): string[] {
  return (Array.isArray(list) ? list : [])
    .filter((x) => typeof x === 'string' && x.trim() !== '')
    .map((x) => x.trim());
}

/** Raw DB row. */
interface DealCardStrategyRow {
  id: number;
  deal_card_id: number;
  offer_readiness: StrategyOfferReadiness;
  strategy_candidates: string;
  blockers: string;
  next_confirmations: string;
  current_recommendation: string;
  most_viable_strategy: string;
  pre_call_strategy_notes: string;
  quick_flip_notes: string;
  subdivide_notes: string;
  land_home_package_notes: string;
  improved_value_add_notes: string;
  teardown_land_only_notes: string;
  pass_no_offer_reason: string;
  risk_adjusted_notes: string;
  target_profit_note: string;
  notes: string;
  updated_by: string;
  created_at: number;
  updated_at: number;
}

/** Normalized worksheet shape returned to the API/UI (lists parsed). When no
 *  worksheet exists yet, exists=false with honest empty defaults. */
export interface DealCardStrategyView {
  exists: boolean;
  dealCardId: number;
  offerReadiness: StrategyOfferReadiness;
  strategyCandidates: string[];
  blockers: string[];
  nextConfirmations: string[];
  currentRecommendation: string;
  mostViableStrategy: string;
  preCallStrategyNotes: string;
  quickFlipNotes: string;
  subdivideNotes: string;
  landHomePackageNotes: string;
  improvedValueAddNotes: string;
  teardownLandOnlyNotes: string;
  passNoOfferReason: string;
  riskAdjustedNotes: string;
  targetProfitNote: string;
  notes: string;
  updatedBy: string;
  updatedAt: number | null;
}

export interface DealCardStrategyPatch {
  offerReadiness?: StrategyOfferReadiness;
  strategyCandidates?: string[];
  blockers?: string[];
  nextConfirmations?: string[];
  currentRecommendation?: string;
  mostViableStrategy?: string;
  preCallStrategyNotes?: string;
  quickFlipNotes?: string;
  subdivideNotes?: string;
  landHomePackageNotes?: string;
  improvedValueAddNotes?: string;
  teardownLandOnlyNotes?: string;
  passNoOfferReason?: string;
  riskAdjustedNotes?: string;
  targetProfitNote?: string;
  notes?: string;
  updatedBy?: string;
}

export interface DealCardStrategyResult {
  strategy: DealCardStrategyView;
  warnings: string[];
}

function rowToView(row: DealCardStrategyRow): DealCardStrategyView {
  return {
    exists: true,
    dealCardId: row.deal_card_id,
    offerReadiness: row.offer_readiness,
    strategyCandidates: parseStrArray(row.strategy_candidates),
    blockers: parseStrArray(row.blockers),
    nextConfirmations: parseStrArray(row.next_confirmations),
    currentRecommendation: row.current_recommendation,
    mostViableStrategy: row.most_viable_strategy,
    preCallStrategyNotes: row.pre_call_strategy_notes,
    quickFlipNotes: row.quick_flip_notes,
    subdivideNotes: row.subdivide_notes,
    landHomePackageNotes: row.land_home_package_notes,
    improvedValueAddNotes: row.improved_value_add_notes,
    teardownLandOnlyNotes: row.teardown_land_only_notes,
    passNoOfferReason: row.pass_no_offer_reason,
    riskAdjustedNotes: row.risk_adjusted_notes,
    targetProfitNote: row.target_profit_note,
    notes: row.notes,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

/** Honest empty worksheet for a Deal Card that has no Strategy row yet. */
function emptyView(dealCardId: number): DealCardStrategyView {
  return {
    exists: false,
    dealCardId,
    offerReadiness: 'not_reviewed',
    strategyCandidates: [],
    blockers: [],
    nextConfirmations: [],
    currentRecommendation: '',
    mostViableStrategy: '',
    preCallStrategyNotes: '',
    quickFlipNotes: '',
    subdivideNotes: '',
    landHomePackageNotes: '',
    improvedValueAddNotes: '',
    teardownLandOnlyNotes: '',
    passNoOfferReason: '',
    riskAdjustedNotes: '',
    targetProfitNote: '',
    notes: '',
    updatedBy: '',
    updatedAt: null,
  };
}

function getDealCardStrategyRow(dealCardId: number): DealCardStrategyRow | undefined {
  return getLandosDb()
    .prepare('SELECT * FROM landos_deal_card_strategy WHERE deal_card_id = ?')
    .get(dealCardId) as DealCardStrategyRow | undefined;
}

/** Read the Strategy worksheet for a Deal Card. Returns an honest empty
 *  worksheet (exists=false, offer_readiness='not_reviewed') when none saved. */
export function getDealCardStrategy(dealCardId: number): DealCardStrategyView {
  const row = getDealCardStrategyRow(dealCardId);
  return row ? rowToView(row) : emptyView(dealCardId);
}

/**
 * Create-or-update the Strategy worksheet for a Deal Card (one row per deal).
 * Applies only the provided patch fields over the existing worksheet (or safe
 * defaults), validates the offer-readiness label, and normalizes the JSON lists.
 * Computes no offer, no comp, no EV; keeps every exit strategy distinct. Returns
 * the normalized worksheet plus any guardrail warnings, or null if the Deal Card
 * does not exist.
 */
export function upsertDealCardStrategy(
  dealCardId: number,
  patch: DealCardStrategyPatch,
): DealCardStrategyResult | null {
  const deal = getDealCardRow(dealCardId);
  if (!deal) return null;

  const db = getLandosDb();
  const existing = getDealCardStrategyRow(dealCardId);
  const base: DealCardStrategyView = existing ? rowToView(existing) : emptyView(dealCardId);

  // Merge patch over the existing/default worksheet (only provided keys change).
  const pick = <T>(v: T | undefined, cur: T): T => (v === undefined ? cur : v);

  const warnings: string[] = [];

  // offer_readiness must be a known label; an unknown value falls back to the
  // current value (or 'not_reviewed') with a warning, never an invented status.
  let offerReadiness = base.offerReadiness;
  if (patch.offerReadiness !== undefined) {
    if (READINESS_SET.has(patch.offerReadiness)) {
      offerReadiness = patch.offerReadiness;
    } else {
      warnings.push(`Unknown offer readiness "${String(patch.offerReadiness)}" ignored; kept "${base.offerReadiness}".`);
      offerReadiness = asReadiness(base.offerReadiness);
    }
  }

  const merged: DealCardStrategyView = {
    exists: true,
    dealCardId,
    offerReadiness,
    strategyCandidates: normalizeStrList(patch.strategyCandidates === undefined ? base.strategyCandidates : patch.strategyCandidates),
    blockers: normalizeStrList(patch.blockers === undefined ? base.blockers : patch.blockers),
    nextConfirmations: normalizeStrList(patch.nextConfirmations === undefined ? base.nextConfirmations : patch.nextConfirmations),
    currentRecommendation: pick(patch.currentRecommendation, base.currentRecommendation).trim(),
    mostViableStrategy: pick(patch.mostViableStrategy, base.mostViableStrategy).trim(),
    preCallStrategyNotes: pick(patch.preCallStrategyNotes, base.preCallStrategyNotes).trim(),
    quickFlipNotes: pick(patch.quickFlipNotes, base.quickFlipNotes).trim(),
    subdivideNotes: pick(patch.subdivideNotes, base.subdivideNotes).trim(),
    landHomePackageNotes: pick(patch.landHomePackageNotes, base.landHomePackageNotes).trim(),
    improvedValueAddNotes: pick(patch.improvedValueAddNotes, base.improvedValueAddNotes).trim(),
    teardownLandOnlyNotes: pick(patch.teardownLandOnlyNotes, base.teardownLandOnlyNotes).trim(),
    passNoOfferReason: pick(patch.passNoOfferReason, base.passNoOfferReason).trim(),
    riskAdjustedNotes: pick(patch.riskAdjustedNotes, base.riskAdjustedNotes).trim(),
    targetProfitNote: pick(patch.targetProfitNote, base.targetProfitNote).trim(),
    notes: pick(patch.notes, base.notes).trim(),
    updatedBy: (pick(patch.updatedBy, base.updatedBy) || 'tyler/manual').trim(),
    updatedAt: null,
  };

  // ── Persist (upsert) ──────────────────────────────────────────────────────
  const now = Math.floor(Date.now() / 1000);
  const cols = [
    merged.offerReadiness,
    JSON.stringify(merged.strategyCandidates),
    JSON.stringify(merged.blockers),
    JSON.stringify(merged.nextConfirmations),
    merged.currentRecommendation,
    merged.mostViableStrategy,
    merged.preCallStrategyNotes,
    merged.quickFlipNotes,
    merged.subdivideNotes,
    merged.landHomePackageNotes,
    merged.improvedValueAddNotes,
    merged.teardownLandOnlyNotes,
    merged.passNoOfferReason,
    merged.riskAdjustedNotes,
    merged.targetProfitNote,
    merged.notes,
    merged.updatedBy,
  ];

  if (existing) {
    db.prepare(
      `UPDATE landos_deal_card_strategy SET
         offer_readiness = ?,
         strategy_candidates = ?, blockers = ?, next_confirmations = ?,
         current_recommendation = ?, most_viable_strategy = ?,
         pre_call_strategy_notes = ?,
         quick_flip_notes = ?, subdivide_notes = ?, land_home_package_notes = ?,
         improved_value_add_notes = ?, teardown_land_only_notes = ?,
         pass_no_offer_reason = ?, risk_adjusted_notes = ?, target_profit_note = ?,
         notes = ?, updated_by = ?, updated_at = ?
       WHERE deal_card_id = ?`,
    ).run(...cols, now, dealCardId);
  } else {
    db.prepare(
      `INSERT INTO landos_deal_card_strategy
         (deal_card_id, offer_readiness, strategy_candidates, blockers, next_confirmations,
          current_recommendation, most_viable_strategy, pre_call_strategy_notes,
          quick_flip_notes, subdivide_notes, land_home_package_notes,
          improved_value_add_notes, teardown_land_only_notes,
          pass_no_offer_reason, risk_adjusted_notes, target_profit_note,
          notes, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(dealCardId, ...cols, now);
  }

  landosAudit(merged.updatedBy, existing ? 'deal_card_strategy_updated' : 'deal_card_strategy_created', `deal ${dealCardId} Strategy worksheet`, {
    entity: deal.entity, refTable: 'landos_deal_card_strategy', refId: dealCardId,
  });

  return { strategy: getDealCardStrategy(dealCardId), warnings };
}
