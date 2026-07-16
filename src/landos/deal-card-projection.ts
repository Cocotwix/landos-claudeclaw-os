// Deal Card read-time projection — the shared repairs every read surface applies
// after the canonical records (unique comp registry, pricing gate, research
// completeness) are built.
//
// The persisted report is a snapshot; the registry and gates are current. These
// projections keep the DISPLAYED story aligned with the canonical records:
//   • valuation recomputed from the validated unique registry (never a stale
//     lane count like "Sold land comps (24)" beside a 55-comp registry),
//   • the shared pricing gate suppresses any unsupported valuation while
//     preserving the observations for operator review,
//   • market/strategy narratives regenerate from the current comp state instead
//     of contradicting it, and
//   • report readiness is classified honestly (a finished generator run is not
//     completed research).
//
// Pure + deterministic. No I/O.

import type { CompRegistry, UniqueComp } from './comp-registry.js';
import { buildValuationHierarchy, selectBestComps, type BestCompsSelection, type CompCandidate, type ValuationHierarchy } from './deal-card-reconciliation.js';
import type { PricingGate } from './strategy-readiness.js';
import { providerDisplayName } from './comp-providers.js';
import { formatCountyLabel, sanitizeGeographySuffixes } from './fact-format.js';

function ppaOf(c: UniqueComp): number | null {
  if (typeof c.primary.pricePerAcre === 'number' && c.primary.pricePerAcre > 0) return c.primary.pricePerAcre;
  if (typeof c.primary.price === 'number' && c.primary.price > 0 && typeof c.acres === 'number' && c.acres > 0) {
    return Math.round(c.primary.price / c.acres);
  }
  return null;
}

function median(ns: number[]): number | null {
  if (!ns.length) return null;
  const s = [...ns].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export interface RegistryValuationStats {
  soldCount: number;
  soldMedianPpa: number | null;
  ppaMin: number | null;
  ppaMax: number | null;
  activeCount: number;
  activeAvgPpa: number | null;
}

function quartile(ns: number[], q: number): number | null {
  if (!ns.length) return null;
  const s = [...ns].sort((a, b) => a - b);
  const idx = (s.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return Math.round(s[lo] + (s[hi] - s[lo]) * (idx - lo));
}

/** $/acre statistics over the VALIDATED UNIQUE registry sets — the only stats a
 *  displayed valuation may cite. Sold and active are never mixed, and the band
 *  is the INTERQUARTILE range: raw min/max over a mixed rural comp set produces
 *  absurd ranges driven by outliers/improved sales and is never displayed. */
export function registryValuationStats(registry: CompRegistry): RegistryValuationStats {
  const soldPpas = registry.validatedSold.map(ppaOf).filter((v): v is number => v != null);
  const activePpas = registry.validatedActive.map(ppaOf).filter((v): v is number => v != null);
  return {
    soldCount: registry.counts.validatedSold,
    soldMedianPpa: median(soldPpas),
    ppaMin: quartile(soldPpas, 0.25),
    ppaMax: quartile(soldPpas, 0.75),
    activeCount: registry.counts.validatedActive,
    activeAvgPpa: activePpas.length ? Math.round(activePpas.reduce((a, b) => a + b, 0) / activePpas.length) : null,
  };
}

/**
 * Recompute the valuation hierarchy from the validated unique registry, keeping
 * the persisted non-comp bases (LandPortal estimate / assessed value) as
 * supporting context. The basis label count now always matches the registry.
 */
export function valuationFromRegistry(
  registry: CompRegistry,
  acres: number | null,
  persisted: ValuationHierarchy | null | undefined,
): ValuationHierarchy {
  const stats = registryValuationStats(registry);
  const keepBasis = (id: string) => {
    const all = [persisted?.primary, ...(persisted?.supporting ?? [])].filter((b): b is NonNullable<typeof b> => b != null);
    return all.find((b) => b.id === id) ?? null;
  };
  const lp = keepBasis('lp_estimate');
  const assessed = keepBasis('assessed');
  return buildValuationHierarchy({
    acres,
    soldComps: stats.soldCount > 0 && stats.soldMedianPpa != null
      ? { count: stats.soldCount, medianPpa: stats.soldMedianPpa, ppaMin: stats.ppaMin, ppaMax: stats.ppaMax }
      : null,
    activeComps: stats.activeCount > 0 && stats.activeAvgPpa != null
      ? { count: stats.activeCount, avgPpa: stats.activeAvgPpa }
      : null,
    lpEstimate: lp ? { price: lp.value, ppa: lp.ppa } : null,
    assessed: assessed ? { value: assessed.value } : null,
  });
}

/**
 * Apply the SHARED pricing gate to a valuation hierarchy. Gate closed →
 * the primary basis and value range are suppressed; the bases remain visible as
 * observations (never deleted); the next action states exactly what is missing.
 */
export function applyPricingGate(valuation: ValuationHierarchy, gate: PricingGate): ValuationHierarchy {
  if (gate.pricingAllowed) return valuation;
  const observations = [valuation.primary, ...valuation.supporting].filter((b): b is NonNullable<typeof b> => b != null);
  return {
    ...valuation,
    primary: null,
    supporting: observations,
    valueRange: null,
    confidence: 'low',
    nextAction: `Pricing blocked: ${gate.pricingBlockers.join(' ')} Comp observations are preserved below for review; no value or offer number exists until the gate opens.`,
  };
}

export type ReportReadinessLevel =
  | 'research_progress_report'
  | 'preliminary_intelligence_report'
  | 'desktop_underwriting_report'
  | 'decision_ready_report';

export interface ReportReadiness {
  level: ReportReadinessLevel;
  label: string;
  why: string;
}

/** Honest report classification: a generator finishing is not research
 *  completeness, and neither implies decision readiness. */
export function classifyReportReadiness(input: {
  parcelVerified: boolean;
  researchComplete: boolean;
  researchMissing: string[];
  pricingAllowed: boolean;
}): ReportReadiness {
  if (!input.parcelVerified) {
    return {
      level: 'research_progress_report',
      label: 'Research progress report',
      why: 'Parcel identity is not confirmed — everything here is area context and resolution progress.',
    };
  }
  if (!input.researchComplete) {
    return {
      level: 'research_progress_report',
      label: 'Research progress report',
      why: `Downstream research is incomplete (${input.researchMissing.join(', ') || 'stages pending'}). This report shows progress, not completed underwriting.`,
    };
  }
  if (!input.pricingAllowed) {
    return {
      level: 'preliminary_intelligence_report',
      label: 'Preliminary intelligence report',
      why: 'Screening lanes are evidenced but no defensible value basis exists yet — not an underwriting report.',
    };
  }
  return {
    level: 'desktop_underwriting_report',
    label: 'Desktop underwriting report',
    why: 'Screening evidence and a defensible comp basis exist. Recorded-instrument confirmations (title, legal access, survey) still gate a decision-ready report.',
  };
}

/**
 * Regenerate the market summary from the CURRENT comp state so it can never
 * claim "no comps computed / no adapter connected" while the registry holds
 * validated comps. Geography renders through the shared county formatter.
 */
export function refreshMarketSummary(input: {
  county: string | null | undefined;
  state: string | null | undefined;
  compSummaryLine: string;
  anyRetrieved: boolean;
  persistedSummary: string;
}): string {
  const areaLabel = [formatCountyLabel(input.county), (input.state ?? '').trim() || null].filter(Boolean).join(', ');
  if (!input.anyRetrieved) {
    // No comps — keep the persisted narrative (it already explains manual entry),
    // repaired for geography formatting.
    return sanitizeGeographySuffixes(input.persistedSummary);
  }
  return [
    areaLabel ? `Target area: ${areaLabel}.` : '',
    input.compSummaryLine,
    'Counts are validated unique comps from the shared registry (provider attempts and duplicates are audited separately). No demand or pricing is invented.',
  ].filter(Boolean).join(' ');
}

// ── Registry-driven best comparables ─────────────────────────────────────────

const EARTH_RADIUS_MI = 3958.8;

/** Straight-line (haversine) distance in miles, rounded to 0.1. */
export function straightLineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h)) * 10) / 10;
}

/**
 * The memo shortlist, built from the VALIDATED UNIQUE registry's CLOSED sales —
 * never from raw provider lanes (which double-count merged duplicates) and never
 * padded with active listings or valuation rows to reach five. Distance is
 * calculated straight-line from the subject coordinates when the comp has known
 * coordinates (persisted or cached geocode); otherwise it stays honestly null.
 */
export function bestCompsFromRegistry(
  registry: CompRegistry,
  subjectAcres: number | null,
  opts: {
    subjectCoords?: { lat: number; lng: number } | null;
    coordsByAddress?: Map<string, { lat: number; lng: number }> | null;
  } = {},
): BestCompsSelection {
  const normAddr = (a: string | null | undefined) => (a ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const candidates: CompCandidate[] = registry.validatedSold.map((c: UniqueComp) => {
    const soldTx = c.transactions.find((t) => t.kind === 'sold') ?? c.primary;
    const coords = opts.coordsByAddress?.get(normAddr(c.address)) ?? null;
    const distanceMiles = coords && opts.subjectCoords ? straightLineMiles(opts.subjectCoords, coords) : null;
    return {
      price: soldTx.price,
      pricePerAcre: soldTx.pricePerAcre ?? (soldTx.price != null && c.acres ? Math.round(soldTx.price / c.acres) : null),
      acres: c.acres,
      saleDateIso: soldTx.dateIso,
      sourceUrl: soldTx.sourceUrls[0] ?? null,
      sourceLabel: c.providers.map((p) => providerDisplayName(p)).join(' + ') || null,
      addressDesc: c.address,
      distanceMiles,
      compClass: null,
      lane: 'sold' as const,
    };
  });
  const selection = selectBestComps(subjectAcres, candidates);
  // Calculated distances are straight-line, not provider-reported.
  for (const comp of selection.comps) {
    if (comp.distanceMiles != null) comp.distanceMethod = 'straight_line';
  }
  const withDistance = selection.comps.filter((c) => c.distanceMiles != null).length;
  const noDistance = selection.comps.length - withDistance;
  return {
    ...selection,
    rationale: selection.comps.length
      ? `${selection.rationale} Closed sales only, from the validated unique registry (${registry.counts.validatedSold} available).${noDistance > 0 ? ` Distance is straight-line where coordinates are known; ${noDistance} comp(s) have no calculated distance.` : ' Distances are straight-line.'}`
      : selection.rationale,
  };
}

/** Strategy narrative override while the pricing gate is closed: the legacy
 *  "Most viable: Quick flip" sentence must never contradict five blocked
 *  strategies. */
export function refreshStrategySummary(input: {
  gate: PricingGate;
  strategySummaryLine: string;   // shared strategy-readiness summary
  persistedSummary: string;
  persistedMostViable: string;
}): { strategySummary: string; mostViableStrategy: string } {
  if (input.gate.pricingAllowed) {
    return {
      strategySummary: sanitizeGeographySuffixes(input.persistedSummary),
      mostViableStrategy: input.persistedMostViable,
    };
  }
  return {
    strategySummary: `${input.strategySummaryLine} Offer readiness: pricing gate closed (${input.gate.pricingBlockers.join(' ')}).`,
    // Exactly the executive summary's safe blocked conclusion so the
    // strategy-story audit sees ONE story, not a second phrasing of "blocked".
    mostViableStrategy: 'No acquisition strategy is ready',
  };
}
