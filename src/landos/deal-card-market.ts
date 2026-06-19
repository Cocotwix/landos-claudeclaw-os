// Deal Card — Market Research worksheet.
//
// A safe local landing place for the Market Research department leg. Everything
// here is MARKET-LEVEL context, manually entered. This is NOT property-level due
// diligence and is kept separate from the DD/Research worksheet: it never
// verifies parcel identity and never uses coordinates, geocoders, proximity, map
// pins, or imagery to identify a parcel.
//
// Hard rules enforced here:
//   - No comps, actives, solds, days-on-market, demand, pricing, or county
//     growth are computed or fabricated. Every value is a manual note or an
//     honest demand label that defaults to 'not_reviewed'.
//   - A demand lane can only carry a concrete rating (weak/moderate/strong/
//     mixed) when its own note is non-empty; otherwise it is downgraded to
//     'needs_research' with a warning. Conclusions must be manually entered.
//   - source_confidence can only be 'high' when at least one named source link
//     is present; otherwise it is downgraded to 'needs_research' with a warning.
//   - One worksheet row per Deal Card (upsert; never a duplicate).
//   - No network, no .env, no secrets, no paid/LandPortal calls. File-backed
//     SQLite (store/landos.db, gitignored).

import {
  getLandosDb,
  landosAudit,
  type MarketDemandLabel,
  type MarketSourceConfidence,
  MARKET_DEMAND_LABELS,
  MARKET_SOURCE_CONFIDENCE,
} from './db.js';
import { getDealCardRow } from './deal-card.js';
import type { DealCardSourceLink } from './deal-card-dd.js';

const DEMAND_SET = new Set<string>(MARKET_DEMAND_LABELS);
const CONFIDENCE_SET = new Set<string>(MARKET_SOURCE_CONFIDENCE);

// Concrete demand ratings (i.e. an actual market conclusion) that must be backed
// by a manually-entered note for that lane. 'not_reviewed' and 'needs_research'
// are honest non-conclusions and need no basis.
const CONCRETE_DEMAND = new Set<string>([
  'weak_demand',
  'moderate_demand',
  'strong_demand',
  'mixed_uncertain',
]);

/** Validate a demand label, falling back to the safe default. */
function asDemand(v: unknown, fallback: MarketDemandLabel = 'not_reviewed'): MarketDemandLabel {
  return typeof v === 'string' && DEMAND_SET.has(v) ? (v as MarketDemandLabel) : fallback;
}

/** Validate a source-confidence label, falling back to the safe default. */
function asConfidence(v: unknown, fallback: MarketSourceConfidence = 'unknown'): MarketSourceConfidence {
  return typeof v === 'string' && CONFIDENCE_SET.has(v) ? (v as MarketSourceConfidence) : fallback;
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

/** Parse the source_links JSON column into {label,url} entries with a url. */
function parseSourceLinks(s: string | null | undefined): DealCardSourceLink[] {
  try {
    const a = JSON.parse(s ?? '[]');
    if (!Array.isArray(a)) return [];
    return a
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as Record<string, unknown>).url === 'string')
      .map((x) => ({ label: typeof x.label === 'string' ? x.label.trim() : '', url: String(x.url).trim() }))
      .filter((x) => x.url !== '');
  } catch {
    return [];
  }
}

function normalizeSourceLinks(list: DealCardSourceLink[]): DealCardSourceLink[] {
  return (Array.isArray(list) ? list : [])
    .filter((x) => x && typeof x.url === 'string' && x.url.trim() !== '')
    .map((x) => ({ label: typeof x.label === 'string' ? x.label.trim() : '', url: x.url.trim() }));
}

/** Raw DB row. */
interface DealCardMarketRow {
  id: number;
  deal_card_id: number;
  market_review_status: MarketDemandLabel;
  target_area_label: string;
  county_city_region_notes: string;
  buyer_demand_notes: string;
  buyer_demand_label: MarketDemandLabel;
  active_listing_notes: string;
  sold_comp_context_notes: string;
  days_on_market_notes: string;
  manufactured_home_demand_notes: string;
  manufactured_home_demand_label: MarketDemandLabel;
  subdivision_demand_notes: string;
  subdivision_demand_label: MarketDemandLabel;
  infill_lot_demand_notes: string;
  infill_lot_demand_label: MarketDemandLabel;
  rural_acreage_demand_notes: string;
  rural_acreage_demand_label: MarketDemandLabel;
  county_growth_planning_notes: string;
  exit_strategy_support_notes: string;
  source_links: string;
  source_confidence: MarketSourceConfidence;
  data_gaps: string;
  risk_flags: string;
  notes: string;
  updated_by: string;
  created_at: number;
  updated_at: number;
}

/** Normalized worksheet shape returned to the API/UI (lists parsed). When no
 *  worksheet exists yet, exists=false with honest empty defaults. */
export interface DealCardMarketView {
  exists: boolean;
  dealCardId: number;
  marketReviewStatus: MarketDemandLabel;
  targetAreaLabel: string;
  countyCityRegionNotes: string;
  buyerDemandNotes: string;
  buyerDemandLabel: MarketDemandLabel;
  activeListingNotes: string;
  soldCompContextNotes: string;
  daysOnMarketNotes: string;
  manufacturedHomeDemandNotes: string;
  manufacturedHomeDemandLabel: MarketDemandLabel;
  subdivisionDemandNotes: string;
  subdivisionDemandLabel: MarketDemandLabel;
  infillLotDemandNotes: string;
  infillLotDemandLabel: MarketDemandLabel;
  ruralAcreageDemandNotes: string;
  ruralAcreageDemandLabel: MarketDemandLabel;
  countyGrowthPlanningNotes: string;
  exitStrategySupportNotes: string;
  sourceLinks: DealCardSourceLink[];
  sourceConfidence: MarketSourceConfidence;
  dataGaps: string[];
  riskFlags: string[];
  notes: string;
  updatedBy: string;
  updatedAt: number | null;
}

export interface DealCardMarketPatch {
  marketReviewStatus?: MarketDemandLabel;
  targetAreaLabel?: string;
  countyCityRegionNotes?: string;
  buyerDemandNotes?: string;
  buyerDemandLabel?: MarketDemandLabel;
  activeListingNotes?: string;
  soldCompContextNotes?: string;
  daysOnMarketNotes?: string;
  manufacturedHomeDemandNotes?: string;
  manufacturedHomeDemandLabel?: MarketDemandLabel;
  subdivisionDemandNotes?: string;
  subdivisionDemandLabel?: MarketDemandLabel;
  infillLotDemandNotes?: string;
  infillLotDemandLabel?: MarketDemandLabel;
  ruralAcreageDemandNotes?: string;
  ruralAcreageDemandLabel?: MarketDemandLabel;
  countyGrowthPlanningNotes?: string;
  exitStrategySupportNotes?: string;
  sourceLinks?: DealCardSourceLink[];
  sourceConfidence?: MarketSourceConfidence;
  dataGaps?: string[];
  riskFlags?: string[];
  notes?: string;
  updatedBy?: string;
}

export interface DealCardMarketResult {
  market: DealCardMarketView;
  warnings: string[];
}

function rowToView(row: DealCardMarketRow): DealCardMarketView {
  return {
    exists: true,
    dealCardId: row.deal_card_id,
    marketReviewStatus: row.market_review_status,
    targetAreaLabel: row.target_area_label,
    countyCityRegionNotes: row.county_city_region_notes,
    buyerDemandNotes: row.buyer_demand_notes,
    buyerDemandLabel: row.buyer_demand_label,
    activeListingNotes: row.active_listing_notes,
    soldCompContextNotes: row.sold_comp_context_notes,
    daysOnMarketNotes: row.days_on_market_notes,
    manufacturedHomeDemandNotes: row.manufactured_home_demand_notes,
    manufacturedHomeDemandLabel: row.manufactured_home_demand_label,
    subdivisionDemandNotes: row.subdivision_demand_notes,
    subdivisionDemandLabel: row.subdivision_demand_label,
    infillLotDemandNotes: row.infill_lot_demand_notes,
    infillLotDemandLabel: row.infill_lot_demand_label,
    ruralAcreageDemandNotes: row.rural_acreage_demand_notes,
    ruralAcreageDemandLabel: row.rural_acreage_demand_label,
    countyGrowthPlanningNotes: row.county_growth_planning_notes,
    exitStrategySupportNotes: row.exit_strategy_support_notes,
    sourceLinks: parseSourceLinks(row.source_links),
    sourceConfidence: row.source_confidence,
    dataGaps: parseStrArray(row.data_gaps),
    riskFlags: parseStrArray(row.risk_flags),
    notes: row.notes,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

/** Honest empty worksheet for a Deal Card that has no Market row yet. */
function emptyView(dealCardId: number): DealCardMarketView {
  return {
    exists: false,
    dealCardId,
    marketReviewStatus: 'not_reviewed',
    targetAreaLabel: '',
    countyCityRegionNotes: '',
    buyerDemandNotes: '',
    buyerDemandLabel: 'not_reviewed',
    activeListingNotes: '',
    soldCompContextNotes: '',
    daysOnMarketNotes: '',
    manufacturedHomeDemandNotes: '',
    manufacturedHomeDemandLabel: 'not_reviewed',
    subdivisionDemandNotes: '',
    subdivisionDemandLabel: 'not_reviewed',
    infillLotDemandNotes: '',
    infillLotDemandLabel: 'not_reviewed',
    ruralAcreageDemandNotes: '',
    ruralAcreageDemandLabel: 'not_reviewed',
    countyGrowthPlanningNotes: '',
    exitStrategySupportNotes: '',
    sourceLinks: [],
    sourceConfidence: 'unknown',
    dataGaps: [],
    riskFlags: [],
    notes: '',
    updatedBy: '',
    updatedAt: null,
  };
}

function getDealCardMarketRow(dealCardId: number): DealCardMarketRow | undefined {
  return getLandosDb()
    .prepare('SELECT * FROM landos_deal_card_market WHERE deal_card_id = ?')
    .get(dealCardId) as DealCardMarketRow | undefined;
}

/** Read the Market Research worksheet for a Deal Card. Returns an honest empty
 *  worksheet (exists=false, every label 'not_reviewed') when none saved. */
export function getDealCardMarket(dealCardId: number): DealCardMarketView {
  const row = getDealCardMarketRow(dealCardId);
  return row ? rowToView(row) : emptyView(dealCardId);
}

/**
 * Create-or-update the Market Research worksheet for a Deal Card (one row per
 * deal). Applies only the provided patch fields over the existing worksheet (or
 * safe defaults), validates every demand/confidence label, normalizes the JSON
 * lists, and enforces the honest-conclusion guardrails:
 *   - a demand lane with a concrete rating (weak/moderate/strong/mixed) but an
 *     EMPTY note for that lane is downgraded to 'needs_research';
 *   - source_confidence 'high' with no named source link is downgraded to
 *     'needs_research'.
 * Computes no comps, actives, solds, days-on-market, demand, or pricing. Returns
 * the normalized worksheet plus any guardrail warnings, or null if the Deal Card
 * does not exist.
 */
export function upsertDealCardMarket(
  dealCardId: number,
  patch: DealCardMarketPatch,
): DealCardMarketResult | null {
  const deal = getDealCardRow(dealCardId);
  if (!deal) return null;

  const db = getLandosDb();
  const existing = getDealCardMarketRow(dealCardId);
  const base: DealCardMarketView = existing ? rowToView(existing) : emptyView(dealCardId);

  // Merge patch over the existing/default worksheet (only provided keys change).
  const pick = <T>(v: T | undefined, cur: T): T => (v === undefined ? cur : v);

  const merged: DealCardMarketView = {
    exists: true,
    dealCardId,
    marketReviewStatus: asDemand(pick(patch.marketReviewStatus, base.marketReviewStatus), base.marketReviewStatus),
    targetAreaLabel: pick(patch.targetAreaLabel, base.targetAreaLabel).trim(),
    countyCityRegionNotes: pick(patch.countyCityRegionNotes, base.countyCityRegionNotes).trim(),
    buyerDemandNotes: pick(patch.buyerDemandNotes, base.buyerDemandNotes).trim(),
    buyerDemandLabel: asDemand(pick(patch.buyerDemandLabel, base.buyerDemandLabel), base.buyerDemandLabel),
    activeListingNotes: pick(patch.activeListingNotes, base.activeListingNotes).trim(),
    soldCompContextNotes: pick(patch.soldCompContextNotes, base.soldCompContextNotes).trim(),
    daysOnMarketNotes: pick(patch.daysOnMarketNotes, base.daysOnMarketNotes).trim(),
    manufacturedHomeDemandNotes: pick(patch.manufacturedHomeDemandNotes, base.manufacturedHomeDemandNotes).trim(),
    manufacturedHomeDemandLabel: asDemand(pick(patch.manufacturedHomeDemandLabel, base.manufacturedHomeDemandLabel), base.manufacturedHomeDemandLabel),
    subdivisionDemandNotes: pick(patch.subdivisionDemandNotes, base.subdivisionDemandNotes).trim(),
    subdivisionDemandLabel: asDemand(pick(patch.subdivisionDemandLabel, base.subdivisionDemandLabel), base.subdivisionDemandLabel),
    infillLotDemandNotes: pick(patch.infillLotDemandNotes, base.infillLotDemandNotes).trim(),
    infillLotDemandLabel: asDemand(pick(patch.infillLotDemandLabel, base.infillLotDemandLabel), base.infillLotDemandLabel),
    ruralAcreageDemandNotes: pick(patch.ruralAcreageDemandNotes, base.ruralAcreageDemandNotes).trim(),
    ruralAcreageDemandLabel: asDemand(pick(patch.ruralAcreageDemandLabel, base.ruralAcreageDemandLabel), base.ruralAcreageDemandLabel),
    countyGrowthPlanningNotes: pick(patch.countyGrowthPlanningNotes, base.countyGrowthPlanningNotes).trim(),
    exitStrategySupportNotes: pick(patch.exitStrategySupportNotes, base.exitStrategySupportNotes).trim(),
    sourceLinks: normalizeSourceLinks(patch.sourceLinks === undefined ? base.sourceLinks : patch.sourceLinks),
    sourceConfidence: asConfidence(pick(patch.sourceConfidence, base.sourceConfidence), base.sourceConfidence),
    dataGaps: normalizeStrList(patch.dataGaps === undefined ? base.dataGaps : patch.dataGaps),
    riskFlags: normalizeStrList(patch.riskFlags === undefined ? base.riskFlags : patch.riskFlags),
    notes: pick(patch.notes, base.notes).trim(),
    updatedBy: (pick(patch.updatedBy, base.updatedBy) || 'tyler/manual').trim(),
    updatedAt: null,
  };

  // ── Honest-conclusion guardrails ──────────────────────────────────────────
  // A concrete demand rating must be backed by a manually-entered note for that
  // SAME lane; otherwise the conclusion has no basis and is downgraded to
  // 'needs_research'. Market conclusions are never fabricated.
  const warnings: string[] = [];
  const demandLanes: Array<{ name: string; labelKey: keyof DealCardMarketView; noteKey: keyof DealCardMarketView }> = [
    { name: 'Local buyer demand', labelKey: 'buyerDemandLabel', noteKey: 'buyerDemandNotes' },
    { name: 'Manufactured-home demand', labelKey: 'manufacturedHomeDemandLabel', noteKey: 'manufacturedHomeDemandNotes' },
    { name: 'Subdivision demand', labelKey: 'subdivisionDemandLabel', noteKey: 'subdivisionDemandNotes' },
    { name: 'Infill-lot demand', labelKey: 'infillLotDemandLabel', noteKey: 'infillLotDemandNotes' },
    { name: 'Rural acreage demand', labelKey: 'ruralAcreageDemandLabel', noteKey: 'ruralAcreageDemandNotes' },
  ];
  for (const lane of demandLanes) {
    const label = merged[lane.labelKey] as MarketDemandLabel;
    const note = String(merged[lane.noteKey] ?? '');
    if (CONCRETE_DEMAND.has(label) && note.trim() === '') {
      (merged[lane.labelKey] as MarketDemandLabel) = 'needs_research';
      warnings.push(`${lane.name} demand downgraded to needs_research: a demand rating requires a manually-entered note for that lane (market conclusions are never fabricated).`);
    }
  }

  // source_confidence 'high' requires at least one named source link; otherwise
  // it is downgraded to 'needs_research'. Confidence is never claimed sourceless.
  if (merged.sourceConfidence === 'high' && merged.sourceLinks.length === 0) {
    merged.sourceConfidence = 'needs_research';
    warnings.push('Source confidence downgraded from high to needs_research: high confidence requires at least one named source link.');
  }

  // ── Persist (upsert) ──────────────────────────────────────────────────────
  const now = Math.floor(Date.now() / 1000);
  const cols = [
    merged.marketReviewStatus,
    merged.targetAreaLabel,
    merged.countyCityRegionNotes,
    merged.buyerDemandNotes, merged.buyerDemandLabel,
    merged.activeListingNotes,
    merged.soldCompContextNotes,
    merged.daysOnMarketNotes,
    merged.manufacturedHomeDemandNotes, merged.manufacturedHomeDemandLabel,
    merged.subdivisionDemandNotes, merged.subdivisionDemandLabel,
    merged.infillLotDemandNotes, merged.infillLotDemandLabel,
    merged.ruralAcreageDemandNotes, merged.ruralAcreageDemandLabel,
    merged.countyGrowthPlanningNotes,
    merged.exitStrategySupportNotes,
    JSON.stringify(merged.sourceLinks),
    merged.sourceConfidence,
    JSON.stringify(merged.dataGaps),
    JSON.stringify(merged.riskFlags),
    merged.notes,
    merged.updatedBy,
  ];

  if (existing) {
    db.prepare(
      `UPDATE landos_deal_card_market SET
         market_review_status = ?,
         target_area_label = ?,
         county_city_region_notes = ?,
         buyer_demand_notes = ?, buyer_demand_label = ?,
         active_listing_notes = ?,
         sold_comp_context_notes = ?,
         days_on_market_notes = ?,
         manufactured_home_demand_notes = ?, manufactured_home_demand_label = ?,
         subdivision_demand_notes = ?, subdivision_demand_label = ?,
         infill_lot_demand_notes = ?, infill_lot_demand_label = ?,
         rural_acreage_demand_notes = ?, rural_acreage_demand_label = ?,
         county_growth_planning_notes = ?,
         exit_strategy_support_notes = ?,
         source_links = ?, source_confidence = ?,
         data_gaps = ?, risk_flags = ?,
         notes = ?, updated_by = ?, updated_at = ?
       WHERE deal_card_id = ?`,
    ).run(...cols, now, dealCardId);
  } else {
    db.prepare(
      `INSERT INTO landos_deal_card_market
         (deal_card_id, market_review_status, target_area_label, county_city_region_notes,
          buyer_demand_notes, buyer_demand_label, active_listing_notes, sold_comp_context_notes,
          days_on_market_notes, manufactured_home_demand_notes, manufactured_home_demand_label,
          subdivision_demand_notes, subdivision_demand_label, infill_lot_demand_notes, infill_lot_demand_label,
          rural_acreage_demand_notes, rural_acreage_demand_label, county_growth_planning_notes,
          exit_strategy_support_notes, source_links, source_confidence, data_gaps, risk_flags,
          notes, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(dealCardId, ...cols, now);
  }

  landosAudit(merged.updatedBy, existing ? 'deal_card_market_updated' : 'deal_card_market_created', `deal ${dealCardId} Market Research worksheet`, {
    entity: deal.entity, refTable: 'landos_deal_card_market', refId: dealCardId,
  });

  return { market: getDealCardMarket(dealCardId), warnings };
}
