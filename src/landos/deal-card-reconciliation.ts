// Deal Card reconciliation engine.
//
// One authoritative story for the whole Deal Card. Every tab (Overview, Property,
// Market, Strategy, Seller, Activity) consumes the SAME reconciled outputs so the
// card can never show 17.67 vs 17.93 acres, 610 vs 810 ft frontage, $79k vs $191k
// value, or "comps missing" in Strategy while Activity says they were retrieved.
//
// Rules encoded here (from the sprint):
//  • Official/provider parcel facts OUTRANK vision-derived estimates. A visual
//    observation is NEVER promoted to the authoritative value while an official or
//    provider value exists — it is labeled "visual signal" only.
//  • When two TRUSTED sources disagree materially, BOTH are shown with their source
//    and an explicit conflict explanation — never one silently dropped.
//  • Exactly one primary preliminary valuation. Sold comps outrank asking/active
//    listings and county context. Materially divergent inputs raise a visible
//    "Valuation conflict detected" and flip the next action to tightening comps.
//  • Exactly one comp-state object. Strategy cannot claim comps are missing when the
//    comp state says a provider retrieved them.
//
// Pure + deterministic. No I/O, no secrets, no provider calls. Loose input shapes so
// the engine is testable without constructing the full report view.

// ── Source tiers (higher rank wins for the authoritative value) ──────────────
export type SourceTier = 'official' | 'provider' | 'visual' | 'none';
const TIER_RANK: Record<SourceTier, number> = { official: 3, provider: 2, visual: 1, none: 0 };

export type ReconciledFactField = 'acreage' | 'road_frontage' | 'flood' | 'wetlands' | 'slope';

export interface FactCandidate {
  /** Display value already formatted for the operator (e.g. "17.93 ac", "AE"). */
  value: string;
  /** Numeric form when comparable (acreage, frontage, slope). null for categorical. */
  num: number | null;
  source: string;      // operator-facing provenance ("LandPortal parcel", "USGS", "Visual signal")
  tier: SourceTier;
}

export interface ReconciledFactValue {
  field: ReconciledFactField;
  label: string;                 // operator label ("Acreage", "Road frontage", …)
  primary: string | null;        // the authoritative value the whole card uses
  primarySource: string | null;
  primaryTier: SourceTier;
  /** Other trusted/visual readings, kept for transparency, never silently dropped. */
  alternates: FactCandidate[];
  conflict: boolean;
  conflictNote: string | null;   // human explanation shown when trusted sources disagree
  status: 'reconciled' | 'needs_confirmation' | 'unknown';
}

export interface ReconciledFacts {
  acreage: ReconciledFactValue;
  roadFrontage: ReconciledFactValue;
  flood: ReconciledFactValue;
  wetlands: ReconciledFactValue;
  slope: ReconciledFactValue;
  /** One-line human summary of every conflict, for the Overview/Property banner. */
  conflicts: string[];
}

const LABEL: Record<ReconciledFactField, string> = {
  acreage: 'Acreage',
  road_frontage: 'Road frontage',
  flood: 'FEMA flood',
  wetlands: 'Wetlands',
  slope: 'Slope',
};

/** Relative + absolute thresholds above which two numeric readings are a conflict. */
const NUM_THRESHOLD: Partial<Record<ReconciledFactField, { rel: number; abs: number }>> = {
  acreage: { rel: 0.02, abs: 0.1 },        // >2% or >0.1 ac
  road_frontage: { rel: 0.1, abs: 25 },    // >10% or >25 ft
  slope: { rel: 1, abs: 3 },               // >3 degrees
};

function materiallyDifferent(field: ReconciledFactField, a: FactCandidate, b: FactCandidate): boolean {
  if (a.num != null && b.num != null) {
    const t = NUM_THRESHOLD[field];
    if (!t) return normalizeCat(a.value) !== normalizeCat(b.value);
    const diff = Math.abs(a.num - b.num);
    const rel = diff / Math.max(Math.abs(a.num), Math.abs(b.num), 1e-9);
    // Material if it clears EITHER the absolute or the relative floor — a 0.26 ac
    // gap on an 18 ac parcel matters to an operator even though it is only ~1.5%.
    return diff > t.abs || rel > t.rel;
  }
  // Categorical (flood zone, wetlands present/none): differ if normalized text differs.
  return normalizeCat(a.value) !== normalizeCat(b.value);
}

function normalizeCat(v: string): string {
  return v.trim().toLowerCase().replace(/[.\s]+$/g, '');
}

function compact(xs: Array<FactCandidate | null>): FactCandidate[] {
  return xs.filter((x): x is FactCandidate => x != null);
}

/** Reconcile a single field from ordered candidates (any order; nulls pre-filtered). */
function reconcileField(field: ReconciledFactField, candidatesIn: FactCandidate[]): ReconciledFactValue {
  const candidates = candidatesIn.filter((c) => c && c.value != null && String(c.value).trim() !== '');
  const base: ReconciledFactValue = {
    field, label: LABEL[field], primary: null, primarySource: null, primaryTier: 'none',
    alternates: [], conflict: false, conflictNote: null, status: 'unknown',
  };
  if (candidates.length === 0) return base;

  // Authoritative = highest tier; ties broken by input order (first wins).
  const sorted = [...candidates].sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier]);
  const primary = sorted[0];
  const alternates = sorted.slice(1);

  // Conflict only counts among TRUSTED sources (official/provider). A visual
  // reading that differs is expected signal, not a data conflict — it is labeled,
  // not escalated. But if the ONLY disagreement is visual-vs-trusted we still note it.
  const trusted = candidates.filter((c) => c.tier === 'official' || c.tier === 'provider');
  let conflict = false;
  let conflictNote: string | null = null;
  if (trusted.length >= 2) {
    for (let i = 0; i < trusted.length; i++) {
      for (let j = i + 1; j < trusted.length; j++) {
        if (materiallyDifferent(field, trusted[i], trusted[j])) {
          conflict = true;
          conflictNote = `${LABEL[field]} sources disagree: ${trusted[i].source} says ${trusted[i].value}, ${trusted[j].source} says ${trusted[j].value}. Using ${primary.value} (${primary.source}); confirm against the official parcel record.`;
        }
      }
    }
  }
  // A visual reading that materially differs from the trusted primary → soft note.
  if (!conflict) {
    const visualDiff = alternates.find((c) => c.tier === 'visual' && materiallyDifferent(field, primary, c));
    if (visualDiff) {
      conflictNote = `Visual signal (${visualDiff.value}) differs from ${primary.source} (${primary.value}). The parcel record governs; the visual read is context only.`;
    }
  }

  return {
    ...base,
    primary: primary.value,
    primarySource: primary.source,
    primaryTier: primary.tier,
    alternates,
    conflict,
    conflictNote,
    status: primary.tier === 'official' || primary.tier === 'provider' ? 'reconciled' : 'needs_confirmation',
  };
}

// ── Fact reconciliation inputs (loose shapes; caller maps the report into these) ──
export interface FactReconciliationInputs {
  /** LandPortal parcel fact sheet (official provider record). */
  factSheet?: {
    acres?: number | null;
    access?: { roadFrontageFt?: number | null } | null;
    environment?: { femaFloodZone?: string | null; wetlandsPct?: string | null } | null;
  } | null;
  /** Provider verification land facts (Realie/county-derived). */
  landFacts?: { acres?: number | null; roadFrontageFt?: number | null } | null;
  /** Live government DD (FEMA flood / NWI wetlands / USGS slope) — authoritative. */
  govDd?: {
    flood?: { status?: string; zone?: string | null } | null;
    wetlands?: { status?: string; type?: string | null } | null;
    slope?: { status?: string; slopeDeg?: number | null } | null;
  } | null;
  /** Vision-derived observations — visual signal ONLY, never authoritative. */
  visualObservations?: Array<{ label?: string; detail?: string }> | null;
}

function firstMatch(re: RegExp, texts: string[]): number | null {
  for (const t of texts) {
    const m = (t || '').match(re);
    if (m) { const n = Number(m[1].replace(/,/g, '')); if (Number.isFinite(n)) return n; }
  }
  return null;
}

/** Pull a visual acreage / frontage estimate out of free-text observations. */
function visualNumbers(obs: Array<{ label?: string; detail?: string }>): { acres: number | null; frontageFt: number | null } {
  const texts = obs.flatMap((o) => [o.label ?? '', o.detail ?? '']);
  const acres = firstMatch(/(?:approx(?:imately)?\.?\s*|~\s*|about\s*)?(\d+(?:\.\d+)?)\s*(?:ac\b|acres?)/i, texts);
  const frontageFt = firstMatch(/(\d{2,5})\s*(?:ft|feet|')\s*(?:of\s*)?(?:road\s*)?frontage|frontage[^0-9]{0,12}(\d{2,5})\s*(?:ft|feet|')/i, texts);
  return { acres, frontageFt };
}

export function reconcileFacts(inputs: FactReconciliationInputs): ReconciledFacts {
  const fs = inputs.factSheet ?? null;
  const lf = inputs.landFacts ?? null;
  const gov = inputs.govDd ?? null;
  const vis = visualNumbers(inputs.visualObservations ?? []);

  // Acreage: LandPortal parcel record (official) + provider verification + visual.
  const acreage = reconcileField('acreage', compact([
    fs?.acres != null ? { value: `${fs.acres} ac`, num: fs.acres, source: 'LandPortal parcel', tier: 'official' as SourceTier } : null,
    lf?.acres != null ? { value: `${lf.acres} ac`, num: lf.acres, source: 'Provider verification', tier: 'provider' as SourceTier } : null,
    vis.acres != null ? { value: `~${vis.acres} ac`, num: vis.acres, source: 'Visual signal', tier: 'visual' as SourceTier } : null,
  ]));

  // Road frontage: LandPortal parcel record (official) + provider + visual.
  const roadFrontage = reconcileField('road_frontage', compact([
    fs?.access?.roadFrontageFt != null ? { value: `${fs.access.roadFrontageFt} ft`, num: fs.access.roadFrontageFt, source: 'LandPortal parcel', tier: 'official' as SourceTier } : null,
    lf?.roadFrontageFt != null ? { value: `${lf.roadFrontageFt} ft`, num: lf.roadFrontageFt, source: 'Provider verification', tier: 'provider' as SourceTier } : null,
    vis.frontageFt != null ? { value: `~${vis.frontageFt} ft`, num: vis.frontageFt, source: 'Visual signal', tier: 'visual' as SourceTier } : null,
  ]));

  // Flood: USGS/FEMA gov (official) outranks the LandPortal snapshot zone.
  const floodGov = gov?.flood && (gov.flood.status === 'live' || gov.flood.status === 'verified') && gov.flood.zone;
  const flood = reconcileField('flood', compact([
    floodGov ? { value: String(gov!.flood!.zone), num: null, source: 'FEMA (live)', tier: 'official' as SourceTier } : null,
    fs?.environment?.femaFloodZone ? { value: String(fs.environment.femaFloodZone), num: null, source: 'LandPortal parcel', tier: 'provider' as SourceTier } : null,
  ]));

  const wetGov = gov?.wetlands && (gov.wetlands.status === 'live' || gov.wetlands.status === 'verified') && gov.wetlands.type;
  const wetlands = reconcileField('wetlands', compact([
    wetGov ? { value: String(gov!.wetlands!.type), num: null, source: 'NWI (live)', tier: 'official' as SourceTier } : null,
    fs?.environment?.wetlandsPct ? { value: `${fs.environment.wetlandsPct} coverage`, num: null, source: 'LandPortal parcel', tier: 'provider' as SourceTier } : null,
  ]));

  const slopeGov = gov?.slope && (gov.slope.status === 'live' || gov.slope.status === 'verified') && gov.slope.slopeDeg != null;
  const slope = reconcileField('slope', compact([
    slopeGov ? { value: `${gov!.slope!.slopeDeg}°`, num: gov!.slope!.slopeDeg!, source: 'USGS (live)', tier: 'official' as SourceTier } : null,
  ]));

  const conflicts: string[] = [];
  for (const f of [acreage, roadFrontage, flood, wetlands, slope]) {
    if (f.conflict && f.conflictNote) conflicts.push(f.conflictNote);
  }

  return { acreage, roadFrontage, flood, wetlands, slope, conflicts };
}

// ── Canonical acreage basis → reconciled acreage fact ────────────────────────
// The reconciliation engine's acreage field is derived from the SHARED canonical
// acreage basis (operatorRecord.identity.acreageBasis) so the Property-tab
// reconciled facts can never show a single "reconciled" acreage while the header,
// the acreage-basis panel, and the audit all report a conflict. When the basis is
// disputed this returns a conflicted fact preserving BOTH bases.
import type { AcreageReconciliation } from './acreage-basis.js';

export function acreageFactFromBasis(basis: AcreageReconciliation | null | undefined): ReconciledFactValue | null {
  if (!basis) return null;
  const entryFor = (kind: string) => basis.entries.find((e) => e.kind === kind && e.value != null);
  const gis = entryFor('gis_geometry');
  const assessed = entryFor('assessed');
  const accepted = entryFor('operator_accepted');
  // Display basis governs the primary; overlays are pinned to GIS separately.
  const primaryEntry = accepted ?? gis ?? assessed ?? basis.entries.find((e) => e.value != null) ?? null;
  if (!primaryEntry || primaryEntry.value == null) return null;
  const toCandidate = (e: { value: number | null; source: string | null }): FactCandidate => ({
    value: `${e.value} ac`, num: e.value, source: e.source ?? 'Parcel record', tier: 'official',
  });
  const alternates: FactCandidate[] = basis.entries
    .filter((e) => e !== primaryEntry && e.value != null && (e.kind === 'assessed' || e.kind === 'gis_geometry' || e.kind === 'operator_accepted' || e.kind === 'deeded' || e.kind === 'surveyed'))
    .map(toCandidate);
  return {
    field: 'acreage',
    label: 'Acreage',
    primary: `${primaryEntry.value} ac`,
    primarySource: primaryEntry.source ?? 'Parcel record',
    primaryTier: 'official',
    alternates,
    conflict: basis.disputed,
    conflictNote: basis.disputed ? (basis.explanation || basis.decision) : null,
    status: basis.disputed ? 'needs_confirmation' : 'reconciled',
  };
}

// ── Valuation hierarchy ──────────────────────────────────────────────────────
export type ValuationKind = 'comp_sold' | 'comp_active_asking' | 'lp_estimate' | 'assessed' | 'county_context';

export interface ValuationBasis {
  id: string;
  label: string;
  value: number | null;   // total dollars
  ppa: number | null;     // dollars per acre when known
  kind: ValuationKind;
  rank: number;           // 1 = strongest basis
  note: string;
}

export interface ValuationHierarchy {
  primary: ValuationBasis | null;
  supporting: ValuationBasis[];
  confidence: 'low' | 'medium' | 'high';
  conflict: boolean;
  conflictNote: string | null;
  /** Preliminary value range derived ONLY from the chosen primary basis. */
  valueRange: { low: number; high: number; basisId: string } | null;
  /** Overridden next action when a valuation conflict exists. */
  nextAction: string | null;
}

const KIND_RANK: Record<ValuationKind, number> = {
  comp_sold: 1,
  comp_active_asking: 2,
  lp_estimate: 3,
  assessed: 4,
  county_context: 5,
};

export interface ValuationInputs {
  /** Subject acreage (for ppa ↔ total conversions). */
  acres?: number | null;
  /** Sold-comp market metrics (parcel-specific, strongest). */
  soldComps?: { count: number; medianPpa: number | null; ppaMin: number | null; ppaMax: number | null } | null;
  /** Active / asking listings — never treated the same as sold. */
  activeComps?: { count: number; avgPpa: number | null } | null;
  /** LandPortal estimate (lpEstimatePrice / lpEstimatePpa). */
  lpEstimate?: { price: number | null; ppa: number | null } | null;
  /** Assessed / total market value from the parcel record. */
  assessed?: { value: number | null } | null;
  /** County / area context $/acre (weakest; cannot override parcel comps). */
  countyContext?: { ppa: number | null; note?: string } | null;
}

function usd(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}
function totalFrom(ppa: number | null, acres: number | null | undefined): number | null {
  if (ppa == null || acres == null || !Number.isFinite(acres) || acres <= 0) return null;
  return Math.round(ppa * acres);
}

export function buildValuationHierarchy(inputs: ValuationInputs): ValuationHierarchy {
  const acres = usd(inputs.acres);
  const bases: ValuationBasis[] = [];

  // Sold comps (parcel-specific) — strongest.
  if (inputs.soldComps && inputs.soldComps.count > 0 && inputs.soldComps.medianPpa != null) {
    const ppa = usd(inputs.soldComps.medianPpa);
    bases.push({
      id: 'comp_sold', label: `Sold land comps (${inputs.soldComps.count})`, kind: 'comp_sold',
      value: totalFrom(ppa, acres), ppa, rank: KIND_RANK.comp_sold,
      note: `Median $${ppa?.toLocaleString('en-US')}/ac across ${inputs.soldComps.count} sold comp(s).`,
    });
  }
  // Active / asking listings — supporting, explicitly not sold.
  if (inputs.activeComps && inputs.activeComps.count > 0 && inputs.activeComps.avgPpa != null) {
    const ppa = usd(inputs.activeComps.avgPpa);
    bases.push({
      id: 'comp_active_asking', label: `Active / asking listings (${inputs.activeComps.count})`, kind: 'comp_active_asking',
      value: totalFrom(ppa, acres), ppa, rank: KIND_RANK.comp_active_asking,
      note: 'Asking prices, not closed sales — treat as a ceiling, not a comp.',
    });
  }
  // LandPortal estimate.
  if (inputs.lpEstimate && (inputs.lpEstimate.price != null || inputs.lpEstimate.ppa != null)) {
    const ppa = usd(inputs.lpEstimate.ppa);
    const value = usd(inputs.lpEstimate.price) ?? totalFrom(ppa, acres);
    bases.push({
      id: 'lp_estimate', label: 'LandPortal estimate', kind: 'lp_estimate',
      value, ppa: ppa ?? (value != null && acres ? Math.round(value / acres) : null), rank: KIND_RANK.lp_estimate,
      note: 'Automated LandPortal estimate — supporting context.',
    });
  }
  // Assessed / total market value.
  if (inputs.assessed && inputs.assessed.value != null) {
    const value = usd(inputs.assessed.value);
    bases.push({
      id: 'assessed', label: 'Assessed / market value', kind: 'assessed',
      value, ppa: value != null && acres ? Math.round(value / acres) : null, rank: KIND_RANK.assessed,
      note: 'Tax assessment — lags market; supporting only.',
    });
  }
  // County / area context $/acre — weakest, cannot override parcel comps.
  if (inputs.countyContext && inputs.countyContext.ppa != null) {
    const ppa = usd(inputs.countyContext.ppa);
    bases.push({
      id: 'county_context', label: 'County / area context', kind: 'county_context',
      value: totalFrom(ppa, acres), ppa, rank: KIND_RANK.county_context,
      note: inputs.countyContext.note || 'Area-wide $/acre — context, not parcel-specific.',
    });
  }

  if (bases.length === 0) {
    return { primary: null, supporting: [], confidence: 'low', conflict: false, conflictNote: null, valueRange: null, nextAction: null };
  }

  bases.sort((a, b) => a.rank - b.rank);
  const primary = bases[0];
  const supporting = bases.slice(1);

  // Conflict: primary vs the next basis of a DIFFERENT kind that both have a value,
  // diverging by more than 35% of the smaller. County context can never be treated
  // as overriding parcel comps, but a large divergence is still surfaced.
  let conflict = false;
  let conflictNote: string | null = null;
  const primaryVal = primary.value ?? (primary.ppa != null && acres ? totalFrom(primary.ppa, acres) : null);
  for (const b of supporting) {
    const bVal = b.value ?? (b.ppa != null && acres ? totalFrom(b.ppa, acres) : null);
    if (primaryVal != null && bVal != null && primaryVal > 0 && bVal > 0) {
      const ratio = Math.max(primaryVal, bVal) / Math.min(primaryVal, bVal);
      if (ratio >= 1.35) {
        conflict = true;
        conflictNote = `Valuation conflict detected: ${primary.label} implies ~$${Math.round(primaryVal).toLocaleString('en-US')} but ${b.label} implies ~$${Math.round(bVal).toLocaleString('en-US')}. Using ${primary.label} as the underwriting basis; tighten comps before pricing an offer.`;
        break;
      }
    }
  }

  // A single sale is a preliminary indication, never a defensible range or offer basis.
  const soldRangeReady = primary.kind === 'comp_sold'
    && (inputs.soldComps?.count ?? 0) >= 3
    && inputs.soldComps?.ppaMin != null
    && inputs.soldComps?.ppaMax != null
    && (inputs.soldComps?.ppaMax ?? 0) > (inputs.soldComps?.ppaMin ?? 0);

  // Confidence: high only with a non-point sold band; one or two sales remain low.
  let confidence: ValuationHierarchy['confidence'] = 'low';
  if (primary.kind === 'comp_sold') confidence = soldRangeReady ? 'high' : 'low';
  else if (primary.kind === 'lp_estimate' || primary.kind === 'assessed') confidence = 'medium';
  if (conflict && confidence === 'high') confidence = 'medium';

  // Value range from the chosen basis only.
  let valueRange: ValuationHierarchy['valueRange'] = null;
  if (soldRangeReady && inputs.soldComps?.ppaMin != null && inputs.soldComps?.ppaMax != null && acres) {
    valueRange = { low: Math.round(inputs.soldComps.ppaMin * acres), high: Math.round(inputs.soldComps.ppaMax * acres), basisId: primary.id };
  } else if (primaryVal != null) {
    valueRange = { low: Math.round(primaryVal * 0.9), high: Math.round(primaryVal * 1.1), basisId: primary.id };
  }

  const nextAction = conflict ? 'Tighten comps / valuation — divergent value inputs.' : null;

  const offerRangeBlocked = primary.kind === 'comp_sold' && !soldRangeReady;
  const offerGateAction = offerRangeBlocked && !conflict
    ? `Preliminary comp indication only: ${inputs.soldComps?.count ?? 0} sold comp(s) is insufficient for a reliable value or offer range. Expand and validate comparable sales before pricing an offer.`
    : null;
  return { primary, supporting, confidence, conflict, conflictNote, valueRange: offerRangeBlocked ? null : valueRange, nextAction: offerGateAction ?? nextAction };
}

// ── Comp state (single object feeding every tab) ─────────────────────────────
export type CompSourceKey = 'sold' | 'active_asking' | 'zillow' | 'redfin' | 'landportal_visible' | 'fallback_valuation' | 'manual';
export interface CompSourceStatus {
  source: CompSourceKey;
  label: string;
  status: 'retrieved' | 'none' | 'not_run' | 'unavailable';
  count: number;
  note: string;
}
export interface CompState {
  soldCount: number;
  activeCount: number;
  landportalVisibleCount: number;
  fallbackCount: number;
  totalUsable: number;         // sold + landportal visible + fallback valuation rows
  anyRetrieved: boolean;       // any source produced at least one comp
  sources: CompSourceStatus[];
  /** One sentence every tab shows, so status never contradicts across tabs. */
  summaryLine: string;
  /** Strategy-facing line — never says "missing" when a source retrieved comps. */
  strategyLine: string;
}

export interface CompStateInputs {
  status?: string;                                   // marketComps.status
  soldCount?: number;
  activeCount?: number;
  valuationRowCount?: number;                        // Realie valuation-only rows (fallback)
  landportalComps?: { status?: string; count?: number } | null;
  research?: {
    attempts?: Array<{ source?: string; retrieved?: number; status?: string }> | null;
  } | null;
  /** Per-provider retrieved counts recorded on Activity (e.g. Zillow 2, Redfin 8). */
  providerCounts?: Array<{ provider: string; count: number; status?: string }> | null;
}

function providerCount(inputs: CompStateInputs, name: RegExp): { count: number; status: 'retrieved' | 'none' | 'not_run' } {
  let count = 0;
  let seen = false;
  for (const p of inputs.providerCounts ?? []) {
    if (name.test(p.provider)) { seen = true; count += Math.max(0, p.count || 0); }
  }
  for (const a of inputs.research?.attempts ?? []) {
    if (a.source && name.test(a.source)) { seen = true; count += Math.max(0, a.retrieved || 0); }
  }
  return { count, status: count > 0 ? 'retrieved' : seen ? 'none' : 'not_run' };
}

export function buildCompState(inputs: CompStateInputs): CompState {
  const soldCount = Math.max(0, inputs.soldCount || 0);
  const activeCount = Math.max(0, inputs.activeCount || 0);
  const fallbackCount = Math.max(0, inputs.valuationRowCount || 0);
  const lpv = inputs.landportalComps;
  const landportalVisibleCount = Math.max(0, lpv?.count || 0);

  const zillow = providerCount(inputs, /zillow/i);
  const redfin = providerCount(inputs, /redfin/i);

  const sources: CompSourceStatus[] = [
    { source: 'sold', label: 'Sold comps', status: soldCount > 0 ? 'retrieved' : inputs.status === 'not_run' ? 'not_run' : 'none', count: soldCount, note: soldCount > 0 ? `${soldCount} closed sale(s) in the band.` : 'No closed sales in the band yet.' },
    { source: 'active_asking', label: 'Active / asking', status: activeCount > 0 ? 'retrieved' : 'none', count: activeCount, note: activeCount > 0 ? `${activeCount} active listing(s) — asking, not sold.` : 'No active listings captured.' },
    { source: 'zillow', label: 'Zillow', status: zillow.status, count: zillow.count, note: zillow.count > 0 ? `Zillow retrieved ${zillow.count}.` : zillow.status === 'none' ? 'Zillow returned none.' : 'Zillow not run.' },
    { source: 'redfin', label: 'Redfin', status: redfin.status, count: redfin.count, note: redfin.count > 0 ? `Redfin retrieved ${redfin.count}.` : redfin.status === 'none' ? 'Redfin returned none.' : 'Redfin not run.' },
    { source: 'landportal_visible', label: 'LandPortal visible', status: (lpv?.status as CompSourceStatus['status']) === 'retrieved' ? 'retrieved' : landportalVisibleCount > 0 ? 'retrieved' : (lpv?.status === 'not_run' || !lpv) ? 'not_run' : lpv?.status === 'unavailable' ? 'unavailable' : 'none', count: landportalVisibleCount, note: landportalVisibleCount > 0 ? `${landportalVisibleCount} free visible LandPortal row(s).` : 'No free visible LandPortal comps.' },
    { source: 'fallback_valuation', label: 'Valuation-only rows', status: fallbackCount > 0 ? 'retrieved' : 'none', count: fallbackCount, note: fallbackCount > 0 ? `${fallbackCount} valuation-only row(s) as fallback.` : 'No valuation-only fallback rows.' },
  ];

  const totalUsable = soldCount + landportalVisibleCount + fallbackCount;
  const anyRetrieved = sources.some((sx) => sx.status === 'retrieved');

  const retrievedBits = sources.filter((sx) => sx.status === 'retrieved').map((sx) => `${sx.label} ${sx.count}`);
  const summaryLine = retrievedBits.length
    ? `Comps: ${retrievedBits.join(', ')}.`
    : inputs.status === 'not_run'
    ? 'Comps not run yet.'
    : 'No comps retrieved yet across sold, active, Zillow, Redfin, or LandPortal.';

  // Strategy must reflect the SAME state — never "checks missing" when retrieved.
  let strategyLine: string;
  if (soldCount > 0) strategyLine = `Sold comps retrieved (${soldCount}) — value on the sold band.`;
  else if (anyRetrieved) strategyLine = `${retrievedBits.join(', ')} retrieved, but no closed sold comps yet — tighten the sold band before pricing.`;
  else strategyLine = 'No comps retrieved yet — run comp research before pricing.';

  return { soldCount, activeCount, landportalVisibleCount, fallbackCount, totalUsable, anyRetrieved, sources, summaryLine, strategyLine };
}

// ── Best comparables selection ───────────────────────────────────────────────
// An acquisitions memo shows the FIVE best comps, not twenty. This engine ranks
// every comp the providers returned (across sold / active / supplemental /
// LandPortal-visible / valuation lanes) by how much it actually informs a value
// on THIS subject — acreage similarity, recency, distance (when known), and the
// strength of the lane — then returns the top 3-5 with a plain reason each was
// picked. Pure + deterministic; the caller maps its report rows into candidates.

/** One comp row from any lane, in the loose shape the selector consumes. */
export interface CompCandidate {
  price: number | null;
  pricePerAcre: number | null;
  acres: number | null;
  saleDateIso: string | null;
  sourceUrl?: string | null;
  sourceLabel?: string | null;   // provider ("Realie", "zillow", "LandPortal visible", …)
  addressDesc?: string | null;
  distanceMiles?: number | null;
  /** Cross-provider property identity when the source exposes it. */
  apn?: string | null;
  /** Explicit transaction label for mixed provider lanes such as visible browser rows. */
  priceKind?: 'sold' | 'pending' | 'active' | 'list' | 'unknown' | null;
  /** County-wide rows are opt-in and require a visible expansion reason. */
  geographyScope?: 'local_radius' | 'county_wide' | null;
  countyWideReason?: string | null;
  /** Comp classification from the provider mapping (vacant_land preferred). */
  compClass?: string | null;
  /** Which report lane it came from — drives base confidence. */
  lane: 'sold' | 'active' | 'supplemental' | 'landportal' | 'valuation';
}

export interface SelectedComp {
  price: number | null;
  pricePerAcre: number | null;
  acres: number | null;
  saleDateIso: string | null;
  distanceMiles: number | null;
  source: string;
  sourceUrl: string | null;
  addressDesc: string | null;
  lane: CompCandidate['lane'];
  confidence: 'high' | 'medium' | 'low';
  /** Plain, per-comp reason it made the shortlist. */
  why: string;
  /** Transparent selection score (0-100): acreage similarity + recency + lane strength + distance. */
  score: number;
  /** Exposed score components so the operator can see WHY this comp ranked. */
  scoreComponents: {
    acreageSimilarity: number;   // ≤40
    recency: number;             // ≤25
    laneStrength: number;        // ≤25
    distance: number;            // ≤10 (0 when distance is unknown — never guessed)
  };
  /** How distanceMiles was produced ('straight_line' when calculated; 'provider'
   *  when the source supplied it; null when no distance exists). */
  distanceMethod: 'straight_line' | 'provider' | null;
}

export interface BestCompsSelection {
  comps: SelectedComp[];       // 0-5, strongest first
  /** Asking/pending/active observations are retained here, never in value comps. */
  contextComps: SelectedComp[];
  /** One line explaining how the shortlist was chosen (drivers used). */
  rationale: string;
  consideredCount: number;
  subjectAcres: number | null;
  policy: {
    radiusMiles: 3 | 5 | 10;
    recencyMonths: 12 | 18 | 24;
    countyWideExpanded: boolean;
    disclosure: string;
    exclusions: string[];
    soldSampleCount: number;
    contextSampleCount: number;
    duplicatesRemoved: number;
  };
}

const LANE_LABEL: Record<CompCandidate['lane'], string> = {
  sold: 'Sold comp', active: 'Active listing', supplemental: 'Sold (supplemental)',
  landportal: 'LandPortal visible', valuation: 'Valuation row',
};
// Base confidence by lane: a closed sale informs value far more than an asking
// price or a valuation-only row.
const LANE_CONFIDENCE: Record<CompCandidate['lane'], 'high' | 'medium' | 'low'> = {
  sold: 'high', supplemental: 'medium', landportal: 'medium', active: 'low', valuation: 'low',
};
// Classes that are NOT vacant-land comps and must never sit in a land shortlist.
const EXCLUDE_CLASS = /residential|manufactured|commercial|exclude/i;

function saleAgeMonths(iso: string | null, asOfMs = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const months = (asOfMs - t) / (1000 * 60 * 60 * 24 * 30.4375);
  return months >= 0 ? months : null;
}

function saleDateShort(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/**
 * Rank comp candidates and return the best 3-5 for the acquisition memo. Scoring
 * (0-100): acreage similarity (≤40), recency (≤25), lane strength (≤25),
 * distance (≤10 when known). Rows with no usable price/ppa or an excluded
 * (improved) class are dropped. Never fabricates — unknown signals simply do not
 * earn their points instead of guessing.
 */
function compIdentity(c: CompCandidate): string {
  const apn = (c.apn ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (apn.length >= 5) return `apn:${apn}`;
  const address = (c.addressDesc ?? '').toLowerCase()
    .replace(/\b(street|st\.)\b/g, 'st').replace(/\b(road|rd\.)\b/g, 'rd')
    .replace(/\b(avenue|ave\.)\b/g, 'ave').replace(/[^a-z0-9]/g, '');
  if (address) return `address:${address}`;
  return `transaction:${Math.round(c.price ?? 0)}|${c.acres ?? ''}|${(c.saleDateIso ?? '').slice(0, 10)}`;
}

function dedupeCandidates(candidates: CompCandidate[]): { rows: CompCandidate[]; removed: number } {
  const byIdentity = new Map<string, CompCandidate>();
  for (const candidate of candidates) {
    const key = compIdentity(candidate);
    const current = byIdentity.get(key);
    if (!current) { byIdentity.set(key, candidate); continue; }
    const richness = (c: CompCandidate) => [c.apn, c.addressDesc, c.price, c.pricePerAcre, c.acres, c.saleDateIso, c.distanceMiles, c.sourceUrl]
      .filter((value) => value != null && value !== '').length;
    if (richness(candidate) > richness(current)) byIdentity.set(key, candidate);
  }
  return { rows: [...byIdentity.values()], removed: candidates.length - byIdentity.size };
}

export function selectBestComps(subjectAcres: number | null, candidates: CompCandidate[], limit = 5, asOf = new Date()): BestCompsSelection {
  const subj = typeof subjectAcres === 'number' && Number.isFinite(subjectAcres) && subjectAcres > 0 ? subjectAcres : null;

  const priced = candidates.filter((c) => {
    if (c.compClass && EXCLUDE_CLASS.test(c.compClass)) return false;
    const hasValue = (typeof c.price === 'number' && c.price > 0) || (typeof c.pricePerAcre === 'number' && c.pricePerAcre > 0);
    return hasValue;
  });
  const deduped = dedupeCandidates(priced);
  const isSold = (c: CompCandidate) => c.lane === 'sold' || c.lane === 'supplemental' || c.priceKind === 'sold';
  const contextCandidates = deduped.rows.filter((c) => !isSold(c));
  const exclusions: string[] = [];
  const asOfMs = asOf.getTime();
  const datedSold = deduped.rows.filter(isSold).filter((c) => {
    const age = saleAgeMonths(c.saleDateIso, asOfMs);
    if (age == null) { exclusions.push(`${c.addressDesc ?? c.sourceLabel ?? 'Sold row'}: missing or invalid sale date.`); return false; }
    if (age > 24) { exclusions.push(`${c.addressDesc ?? c.sourceLabel ?? 'Sold row'}: sale is older than 24 months.`); return false; }
    // A closed-sale row cannot become a valuation shortlist comp until its
    // relationship to this subject is actually measured.  Leaving a missing
    // distance in the candidate set used to make it look eligible simply
    // because it earned zero distance points; that is not a distance check.
    if (typeof c.distanceMiles !== 'number' || !Number.isFinite(c.distanceMiles) || c.distanceMiles < 0) {
      exclusions.push(`${c.addressDesc ?? c.sourceLabel ?? 'Sold row'}: distance is not established.`); return false;
    }
    if (typeof c.distanceMiles === 'number' && c.distanceMiles > 10 && c.geographyScope !== 'county_wide') {
      exclusions.push(`${c.addressDesc ?? c.sourceLabel ?? 'Sold row'}: outside the 10-mile local ceiling.`); return false;
    }
    if (c.geographyScope === 'county_wide' && !(c.countyWideReason ?? '').trim()) {
      exclusions.push(`${c.addressDesc ?? c.sourceLabel ?? 'Sold row'}: county-wide row lacks an expansion reason.`); return false;
    }
    return true;
  });
  const recencyMonths = ([12, 18, 24] as const).find((months) => datedSold.filter((c) => (saleAgeMonths(c.saleDateIso, asOfMs) ?? Infinity) <= months).length >= 3) ?? 24;
  const recencyEligible = datedSold.filter((c) => (saleAgeMonths(c.saleDateIso, asOfMs) ?? Infinity) <= recencyMonths);
  const localKnown = recencyEligible.filter((c) => typeof c.distanceMiles === 'number' && c.geographyScope !== 'county_wide');
  const radiusMiles = ([3, 5, 10] as const).find((radius) => localKnown.filter((c) => c.distanceMiles! <= radius).length >= 3) ?? 10;
  const usable = recencyEligible.filter((c) => (c.distanceMiles ?? Number.POSITIVE_INFINITY) <= radiusMiles || c.geographyScope === 'county_wide');
  const countyWideRows = usable.filter((c) => c.geographyScope === 'county_wide');

  const scored = usable.map((c) => {
    let score = 0;
    const reasons: string[] = [];
    const components = { acreageSimilarity: 0, recency: 0, laneStrength: 0, distance: 0 };

    // Acreage similarity — the single strongest driver for land comps.
    if (subj != null && typeof c.acres === 'number' && c.acres > 0) {
      const rel = Math.abs(c.acres - subj) / Math.max(subj, c.acres);
      const acrePts = Math.max(0, 40 * (1 - Math.min(rel, 1)));
      components.acreageSimilarity = Math.round(acrePts);
      score += acrePts;
      if (rel <= 0.25) reasons.push(`similar size (${c.acres} ac vs ${subj} ac subject)`);
      else if (rel <= 0.6) reasons.push(`comparable size (${c.acres} ac)`);
    } else if (typeof c.acres === 'number' && c.acres > 0) {
      components.acreageSimilarity = 12;
      score += 12; // known acreage but no subject to compare against
    }

    // Recency — a fresh close is worth far more than a stale one.
    const age = saleAgeMonths(c.saleDateIso, asOfMs);
    if (age != null) {
      const recPts = Math.max(0, 25 * (1 - Math.min(age / 36, 1)));
      components.recency = Math.round(recPts);
      score += recPts;
      const when = saleDateShort(c.saleDateIso);
      if (age <= 12 && when) reasons.push(`recent (${when})`);
      else if (when) reasons.push(`sold ${when}`);
    }

    // Lane strength — closed sales dominate asking/valuation rows.
    const laneConf = LANE_CONFIDENCE[c.lane];
    const lanePts = laneConf === 'high' ? 25 : laneConf === 'medium' ? 16 : 8;
    components.laneStrength = lanePts;
    score += lanePts;
    if (c.lane === 'sold') reasons.push('closed sale');
    else if (c.lane === 'active') reasons.push('active listing (asking)');

    // Distance — only when actually known (provider-supplied or calculated);
    // an unknown distance earns 0 and never produces "closest" language.
    if (typeof c.distanceMiles === 'number' && Number.isFinite(c.distanceMiles) && c.distanceMiles >= 0) {
      const distPts = Math.max(0, 10 * (1 - Math.min(c.distanceMiles / 25, 1)));
      components.distance = Math.round(distPts);
      score += distPts;
      if (c.distanceMiles <= 10) reasons.push(`${c.distanceMiles.toFixed(1)} mi away`);
    }

    const source = (c.sourceLabel && c.sourceLabel.trim()) || LANE_LABEL[c.lane];
    const why = reasons.length ? reasons.join(', ') : `${LANE_LABEL[c.lane].toLowerCase()} in the area`;
    const selected: SelectedComp = {
      price: typeof c.price === 'number' && c.price > 0 ? c.price : null,
      pricePerAcre: typeof c.pricePerAcre === 'number' && c.pricePerAcre > 0 ? c.pricePerAcre : null,
      acres: typeof c.acres === 'number' && c.acres > 0 ? c.acres : null,
      saleDateIso: c.saleDateIso ?? null,
      distanceMiles: typeof c.distanceMiles === 'number' ? c.distanceMiles : null,
      source,
      sourceUrl: (c.sourceUrl && c.sourceUrl.trim()) || null,
      addressDesc: (c.addressDesc && c.addressDesc.trim()) || null,
      lane: c.lane,
      confidence: laneConf,
      why: why.charAt(0).toUpperCase() + why.slice(1),
      score: Math.round(score),
      scoreComponents: components,
      distanceMethod: typeof c.distanceMiles === 'number' && Number.isFinite(c.distanceMiles) ? 'provider' : null,
    };
    return { score, selected };
  });

  // Strongest first; break ties toward closed sales, then higher confidence.
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.min(5, Math.max(1, limit))).map((x) => x.selected);
  // Only surface a shortlist when at least one comp exists.
  const comps = usable.length ? top : [];

  const soldPicked = comps.length;
  let rationale: string;
  if (!comps.length) rationale = 'No usable comparables retrieved yet.';
  else {
    const drivers: string[] = ['acreage similarity'];
    if (comps.some((c) => c.saleDateIso)) drivers.push('recency');
    if (comps.some((c) => c.distanceMiles != null)) drivers.push('distance');
    drivers.push('source strength');
    rationale = `Top ${comps.length} of ${usable.length} eligible sold comps, ranked by ${drivers.join(', ')} (${soldPicked} closed sale${soldPicked === 1 ? '' : 's'}). Active, pending, and asking rows are context only.`;
  }

  const toContext = (c: CompCandidate): SelectedComp => ({
    price: typeof c.price === 'number' && c.price > 0 ? c.price : null,
    pricePerAcre: typeof c.pricePerAcre === 'number' && c.pricePerAcre > 0 ? c.pricePerAcre : null,
    acres: typeof c.acres === 'number' && c.acres > 0 ? c.acres : null,
    saleDateIso: c.saleDateIso ?? null,
    distanceMiles: typeof c.distanceMiles === 'number' ? c.distanceMiles : null,
    source: (c.sourceLabel && c.sourceLabel.trim()) || LANE_LABEL[c.lane],
    sourceUrl: (c.sourceUrl && c.sourceUrl.trim()) || null,
    addressDesc: (c.addressDesc && c.addressDesc.trim()) || null,
    lane: c.lane,
    confidence: 'low',
    why: 'Context only — asking/pending/active evidence never determines preliminary value.',
    score: 0,
    scoreComponents: { acreageSimilarity: 0, recency: 0, laneStrength: 0, distance: 0 },
    distanceMethod: typeof c.distanceMiles === 'number' && Number.isFinite(c.distanceMiles) ? 'provider' : null,
  });
  const countyWideExpanded = countyWideRows.length > 0;
  const disclosure = countyWideExpanded
    ? `COUNTY-WIDE EXPANSION: the local rural market remained thin after ${radiusMiles} miles; ${countyWideRows.map((c) => c.countyWideReason!.trim()).filter((v, i, a) => a.indexOf(v) === i).join(' ')}`
    : `Local sold search: ${radiusMiles}-mile radius, ${recencyMonths}-month window. County-wide expansion was not used.`;
  return {
    comps,
    contextComps: contextCandidates.slice(0, 5).map(toContext),
    rationale,
    consideredCount: usable.length,
    subjectAcres: subj,
    policy: {
      radiusMiles,
      recencyMonths,
      countyWideExpanded,
      disclosure,
      exclusions,
      soldSampleCount: comps.length,
      contextSampleCount: contextCandidates.length,
      duplicatesRemoved: deduped.removed,
    },
  };
}
