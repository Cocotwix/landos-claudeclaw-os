// LandOS — LandPortal top-bar Map Search: control contract + pure planning,
// parsing, classification and rough valuation.
//
// PROVEN LIVE 2026-08-19 against the authenticated LandPortal map workspace
// (version 4.0.5) on the Fairview subject (Williamson County, TN). Every
// selector below was read from the real DOM; the search flow (Sold + 1 year +
// Type Land + 20 acre minimum) returned real sold results on the live map and
// List View. This is the NEW canonical LandPortal comp-discovery method; the
// old automatic LP-Estimate comparable suggestions are no longer the search
// universe (they may persist only as supplemental evidence).
//
// Split of responsibilities:
//   - This module: selector contract + PURE logic (plan, parse, classify,
//     valuation, diagnostics). Unit-testable without a browser.
//   - browser-session.ts `runLandPortalMapSearch`: drives the live controls.
//   - landportal-comp-search-capability.ts: the registered capability.
//
// Key live behaviors the driver must honor (all observed):
//   - The quick-filter panels are `.mls_quick__block` dropdowns opened from the
//     top bar; each closes through its own `button.btn_main` "Done".
//   - The date/lot-size selects are select2-hidden native <select>s: set them
//     with jQuery `.val(x).trigger('change')` (native change alone is ignored).
//   - Results are VIEWPORT-BOUND: after filters apply, the map stays parcel-
//     tight and shows "No properties found" until the map is zoomed out. Zoom
//     with real mouse clicks on the Zoom out control, only until results
//     appear — never unnecessarily far.
//   - List View rows are `.property-info-visible-row`, each carrying the full
//     identity in data attributes (data-propertyid/-fips/-apn/-mlsuuid,
//     data-situslatitude/-longitude, data-property-address/-city/-state/-zip).
//   - Clicking a row PANS THE MAP to that property and re-filters the list to
//     the new viewport. The driver must therefore read rows without clicking
//     them; candidate enrichment goes through the comp's own canonical parcel
//     page (/?property=base64(fips&apn&propertyid)), which exposes the full
//     parcel record, the MLS Details block (remarks, listing status/price,
//     MLS ID, DOM, sold date, agent/broker, MLS lot acres) and, when present,
//     the exact "View on Redfin" link for the same sale.

import { routeAcreage, type AcreageRoute } from './acreage-router.js';
import { apnIdentifiersEquivalent } from './landportal-capability.js';
import { landPortalParcelUrl } from './landportal-api.js';

// ── Live control contract (proven 2026-08-19) ───────────────────────────────
export const LP_MAP_SEARCH = {
  /** Top quick-filter bar; its innerText carries the applied-filter pills
   *  (e.g. "Sold, 1 yea… x", "20 acres x", "Type (1) x"). */
  bar: '.search-container',
  /** Dropdown openers are bare <span>s in the top bar: Status/Price/Details/
   *  Type; Filters is `button.mls_quick__more`. Open with a REAL mouse click
   *  at the span's box center. */
  openerLabels: ['Status', 'Price', 'Details', 'Type'] as const,
  filtersButton: 'button.mls_quick__more',
  panel: '.mls_quick__block',
  done: 'button.btn_main',
  clearAll: 'button.clear_all',
  status: {
    forSaleCheckbox: '#quick_mls_for_sale',
    soldCheckbox: '#quick_mls_sold',
    /** Both selects share data-filter=mls_statuschangingdate; disambiguate on
     *  aria-anchor. Option values are day counts: 7/14/30/90/180/365/730/1095/1825. */
    daysActiveSelect: 'select[aria-anchor="mls_days_active"]',
    daysSoldSelect: 'select[aria-anchor="mls_days_sold"]',
  },
  details: {
    lotSizeMinSelect: 'select#lot_size_min',
    lotSizeMaxSelect: 'select#lot_size_max',
  },
  type: {
    /** Checkbox inputs by ID — the inputs carry NO name attribute (proven
     *  live: `input[name="mls_land"]` matches nothing; `#mls_land` does). */
    land: 'input#mls_land',
    house: 'input#mls_house',
    mobile: 'input#mls_mobile',
  },
  /** Map/List toggle, top-right of the workspace. */
  viewToggleLabels: { map: 'Map', list: 'List' } as const,
  zoomOut: 'button[aria-label="Zoom out"], .mapboxgl-ctrl-zoom-out',
  noResultsText: /No properties found/i,
  /** "N properties" badge on the map; "N Properties" header in List View. */
  resultCountText: /(\d+)\s+propert(?:y|ies)/i,
  listRow: '.property-info-visible-row',
  listRowAttrs: [
    'data-propertyid', 'data-fips', 'data-apn', 'data-mlsuuid', 'data-mlsurl',
    'data-situslatitude', 'data-situslongitude',
    'data-property-address', 'data-property-city', 'data-property-state', 'data-property-zip',
  ] as const,
  listPagingText: /Showing\s+1\s+to\s+(\d+)\s+of\s+(\d+)\s+entr/i,
} as const;

// ── Search plan ─────────────────────────────────────────────────────────────

export type LandPortalMapSearchLane = 'sold_land' | 'active_land' | 'sold_mobile' | 'active_mobile';

export interface LandPortalMapSearchPlan {
  lane: LandPortalMapSearchLane;
  status: 'sold' | 'for_sale';
  /** Sold-in-the-last window in days (select option value). Null means the
   *  select stays at its default (no period constraint) — required for the
   *  active lane, where Days on Market must NOT be a filter. */
  periodDays: 365 | 730 | null;
  /** lot_size select OPTION VALUES ('20' = 20 acres, '10890' = 1/4 acre);
   *  null leaves No Min / No Max. Mobile lanes never constrain lot size. */
  lotSizeMinValue: string | null;
  lotSizeMaxValue: string | null;
  /** Type checkbox selectors to enable. */
  typeSelectors: string[];
  /** Zoom-out bounds after the search applies: at least minSteps so returned
   *  comps become spatially visible, never more than maxSteps. */
  zoom: { minSteps: number; maxSteps: number };
  broadened: boolean;
  description: string;
}

/** The discrete lot-size options LandPortal's Details panel actually renders,
 *  smallest→largest, as {selectValue, acres}. Sqft options are the sub-acre
 *  rungs; whole-acre options use the acre count as the value. */
export const LOT_SIZE_OPTIONS: ReadonlyArray<{ value: string; acres: number }> = [
  { value: '10890', acres: 0.25 },
  { value: '21780', acres: 0.5 },
  { value: '1', acres: 1 },
  { value: '2', acres: 2 },
  { value: '5', acres: 5 },
  { value: '10', acres: 10 },
  { value: '20', acres: 20 },
  { value: '50', acres: 50 },
  { value: '100', acres: 100 },
];

/** Largest option ≤ target (No Min when the target sits below every rung). */
function snapLotSizeDown(targetAcres: number): string | null {
  let chosen: string | null = null;
  for (const option of LOT_SIZE_OPTIONS) {
    if (option.acres <= targetAcres) chosen = option.value;
  }
  return chosen;
}

/** Smallest option ≥ target (No Max when the target exceeds every rung). */
function snapLotSizeUp(targetAcres: number): string | null {
  for (const option of LOT_SIZE_OPTIONS) {
    if (option.acres >= targetAcres) return option.value;
  }
  return null;
}

/**
 * Subject-relative first-pass search plan. Acreage bounds come from the
 * existing acreage-router pool (e.g. a ~76-acre subject routes 0.35×–2.5× →
 * snapped to "20 acres minimum, no maximum"; a 6-acre subject routes 3–12 →
 * "2 acre minimum, 20 acre maximum"). Never one hardcoded universal range.
 */
export function planLandPortalMapSearch(
  subjectAcres: number | null,
  lane: LandPortalMapSearchLane,
): LandPortalMapSearchPlan {
  const sold = lane === 'sold_land' || lane === 'sold_mobile';
  const mobile = lane === 'sold_mobile' || lane === 'active_mobile';
  const route: AcreageRoute | null = mobile ? null : routeAcreage(subjectAcres);
  const lotSizeMinValue = route ? snapLotSizeDown(route.pool.min) : null;
  const lotSizeMaxValue = route ? snapLotSizeUp(route.pool.max) : null;
  const typeSelectors = [mobile ? LP_MAP_SEARCH.type.mobile : LP_MAP_SEARCH.type.land];
  const bandText = route
    ? `${lotSizeMinValue ? `${LOT_SIZE_OPTIONS.find((o) => o.value === lotSizeMinValue)?.acres} ac min` : 'no min'}, ${lotSizeMaxValue ? `${LOT_SIZE_OPTIONS.find((o) => o.value === lotSizeMaxValue)?.acres} ac max` : 'no max'}`
    : 'no lot-size constraint';
  return {
    lane,
    status: sold ? 'sold' : 'for_sale',
    periodDays: sold ? 365 : null,
    lotSizeMinValue,
    lotSizeMaxValue,
    typeSelectors,
    zoom: { minSteps: 3, maxSteps: 8 },
    broadened: false,
    description: `${sold ? 'Sold (last 1 year)' : 'For Sale (any days on market)'}, type ${mobile ? 'Mobile' : 'Land'}, ${bandText}`,
  };
}

/**
 * ONE bounded broadening pass when sold evidence is too thin: drop the upper
 * bound and step the minimum down one rung. Never loops — a plan already
 * broadened returns null.
 */
export function broadenLandPortalMapSearch(plan: LandPortalMapSearchPlan): LandPortalMapSearchPlan | null {
  if (plan.broadened) return null;
  const currentIndex = plan.lotSizeMinValue
    ? LOT_SIZE_OPTIONS.findIndex((option) => option.value === plan.lotSizeMinValue)
    : -1;
  const lotSizeMinValue = currentIndex > 0 ? LOT_SIZE_OPTIONS[currentIndex - 1].value : plan.lotSizeMinValue;
  if (lotSizeMinValue === plan.lotSizeMinValue && plan.lotSizeMaxValue == null) return null;
  return {
    ...plan,
    lotSizeMinValue,
    lotSizeMaxValue: null,
    periodDays: plan.status === 'sold' ? 730 : plan.periodDays,
    // The broadening pass exists for discovery breadth, so its camera starts
    // wider: the proven live frame that reveals the relevant 20+ acre sales
    // around a large subject needs at least six steps out from the parcel fit.
    zoom: { minSteps: 6, maxSteps: 8 },
    broadened: true,
    description: `${plan.description} → broadened (min one rung down, no max${plan.status === 'sold' ? ', 2 year sold window' : ''}, wider camera)`,
  };
}

// ── List-row parsing ────────────────────────────────────────────────────────

export interface LandPortalMapSearchCandidate {
  /** Which discovery flow produced this candidate. LandPortal's new top-bar
   *  map search is the primary; zillow is the independent second flow; realtor
   *  is fallback-only. The classifier is source-agnostic. */
  source: 'landportal_map_search' | 'zillow' | 'realtor';
  propertyId: string | null;
  fips: string | null;
  apn: string | null;
  mlsUuid: string | null;
  mlsUrl: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  price: number | null;
  status: 'sold' | 'for_sale' | 'unknown';
  /** MLS-reported acreage from the result card. LISTING-REPORTED, not the
   *  assessor parcel acreage — the two can differ materially (live case: a
   *  40.20 MLS-acre sale whose deeded parcel is 1.75 acres). */
  mlsAcres: number | null;
  lotSqft: number | null;
  buildingSqft: number | null;
  baths: number | null;
  /** MM-DD-YYYY from the card, normalized to ISO yyyy-mm-dd. */
  saleDate: string | null;
  soldBy: string | null;
  pricePerAcre: number | null;
  rawText: string;
}

const numFrom = (text: string | null | undefined): number | null => {
  if (!text) return null;
  const value = Number(String(text).replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
};

/** MM-DD-YYYY → yyyy-mm-dd (null when not that shape). */
export function isoFromCardDate(raw: string | null): string | null {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec((raw ?? '').trim());
  if (!match) return null;
  return `${match[3]}-${match[1]}-${match[2]}`;
}

/** Parse the visible text of one `.property-info-visible-row` result card.
 *  Proven format: `$900,000 Sold BRUSH CREEK RD, TN, 37062 76,230 SqFt lot
 *  40.20 MLS acres 02-02-2026 Padre Pio Prop Llc` (baths/building SqFt appear
 *  on improved rows). */
export function parseMapSearchCardText(text: string): {
  price: number | null;
  status: 'sold' | 'for_sale' | 'unknown';
  mlsAcres: number | null;
  lotSqft: number | null;
  buildingSqft: number | null;
  baths: number | null;
  saleDate: string | null;
  soldBy: string | null;
} {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  const price = numFrom((t.match(/\$([\d,]+)/) ?? [])[1] ?? null);
  const status: 'sold' | 'for_sale' | 'unknown' = /\bSold\b/i.test(t)
    ? 'sold'
    : /\bFor Sale\b|\bActive\b/i.test(t) ? 'for_sale' : 'unknown';
  const mlsAcres = numFrom((t.match(/([\d.,]+)\s*MLS acres/i) ?? [])[1] ?? null);
  const lotSqft = numFrom((t.match(/([\d,]+)\s*SqFt lot/i) ?? [])[1] ?? null);
  // Building SqFt renders as "2,704 SqFt" WITHOUT the "lot" suffix.
  const buildingSqft = numFrom((t.match(/([\d,]+)\s*SqFt\b(?!\s*lot)/i) ?? [])[1] ?? null);
  const baths = numFrom((t.match(/([\d.]+)\s*Bath/i) ?? [])[1] ?? null);
  const dateRaw = (t.match(/\b(\d{2}-\d{2}-\d{4})\b/) ?? [])[1] ?? null;
  const soldBy = (t.match(/\d{2}-\d{2}-\d{4}\s+(.+)$/) ?? [])[1]?.trim() ?? null;
  return { price, status, mlsAcres, lotSqft, buildingSqft, baths, saleDate: isoFromCardDate(dateRaw), soldBy };
}

/** One raw List View row as the driver reads it. */
export interface LandPortalMapSearchRow {
  attrs: Record<string, string>;
  text: string;
}

/** Build deduplicated candidates from raw List View rows. The subject parcel
 *  itself is excluded — a subject is never its own comparable. */
export function candidatesFromListRows(
  rows: LandPortalMapSearchRow[],
  subjectApn: string | null,
): LandPortalMapSearchCandidate[] {
  const out: LandPortalMapSearchCandidate[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const attr = (name: string): string | null => {
      const value = (row.attrs?.[name] ?? '').trim();
      return value && value.toLowerCase() !== 'n/a' ? value : null;
    };
    const parsed = parseMapSearchCardText(row.text);
    const propertyId = attr('data-propertyid');
    const apn = attr('data-apn');
    // Price and sale date stay in the key: an identity attribute inherited
    // from a shared container must never collapse two DIFFERENT sales, while
    // the same sale read twice (map + list surfaces) still deduplicates.
    const key = [
      propertyId ?? apn ?? '',
      parsed.price ?? '',
      parsed.saleDate ?? '',
      propertyId == null && apn == null ? row.text.slice(0, 60) : '',
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    if (subjectApn && apn && apnIdentifiersEquivalent(subjectApn, apn)) continue;
    const acres = parsed.mlsAcres ?? (parsed.lotSqft != null ? Math.round((parsed.lotSqft / 43_560) * 100) / 100 : null);
    out.push({
      source: 'landportal_map_search',
      propertyId,
      fips: attr('data-fips'),
      apn,
      mlsUuid: attr('data-mlsuuid'),
      mlsUrl: attr('data-mlsurl'),
      address: attr('data-property-address'),
      city: attr('data-property-city'),
      state: attr('data-property-state'),
      zip: attr('data-property-zip'),
      lat: numFrom(attr('data-situslatitude')),
      lng: numFrom(attr('data-situslongitude')),
      price: parsed.price,
      status: parsed.status,
      mlsAcres: parsed.mlsAcres,
      lotSqft: parsed.lotSqft,
      buildingSqft: parsed.buildingSqft,
      baths: parsed.baths,
      saleDate: parsed.saleDate,
      soldBy: parsed.soldBy,
      pricePerAcre: parsed.price != null && acres != null && acres > 0
        ? Math.round((parsed.price / acres) * 100) / 100
        : null,
      rawText: row.text.slice(0, 400),
    });
  }
  return out;
}

/** The comp's own deterministic canonical parcel URL (null without the triple). */
export function candidateParcelUrl(candidate: Pick<LandPortalMapSearchCandidate, 'fips' | 'apn' | 'propertyId'>): string | null {
  if (!candidate.fips || !candidate.apn || !candidate.propertyId) return null;
  return landPortalParcelUrl({ fips: candidate.fips, apn: candidate.apn, propertyId: candidate.propertyId });
}

// ── Core / Directional / Excluded classification ────────────────────────────

export type LandPortalCompTier = 'core' | 'directional' | 'excluded';

export interface ClassifiedLandPortalComp {
  candidate: LandPortalMapSearchCandidate;
  tier: LandPortalCompTier;
  reason: string;
  acresUsed: number | null;
  pricePerAcre: number | null;
  distanceMiles: number | null;
}

const EARTH_RADIUS_MILES = 3958.8;
function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h)) * 10) / 10;
}

/** A structure this large on a sold "Land" listing means the sale price paid
 *  for improvements too; its $/acre can never establish vacant-land FMV. */
export const IMPROVED_BUILDING_SQFT_FLOOR = 600;

/**
 * Classify SOLD candidates for the vacant-land FMV calculation.
 *
 * CORE: strong enough to materially establish FMV (in the subject's acreage
 * pool, sold, no material improvement, priced with usable acreage).
 * DIRECTIONAL: useful $/acre evidence with meaningful differences (outside the
 * pool but within 0.2×–4× of the subject).
 * EXCLUDED: must not influence FMV, each with the concrete reason.
 * Acreage difference ALONE never excludes inside the directional span.
 */
export function classifyMapSearchCandidates(
  input: {
    subjectAcres: number | null;
    subjectApn?: string | null;
    subjectLat?: number | null;
    subjectLng?: number | null;
  },
  candidates: LandPortalMapSearchCandidate[],
): ClassifiedLandPortalComp[] {
  const route = routeAcreage(input.subjectAcres);
  return candidates.map((candidate) => {
    const acresUsed = candidate.mlsAcres
      ?? (candidate.lotSqft != null ? Math.round((candidate.lotSqft / 43_560) * 100) / 100 : null);
    const distanceMiles = input.subjectLat != null && input.subjectLng != null
      && candidate.lat != null && candidate.lng != null
      ? haversineMiles(input.subjectLat, input.subjectLng, candidate.lat, candidate.lng)
      : null;
    const pricePerAcre = candidate.price != null && acresUsed != null && acresUsed > 0
      ? Math.round((candidate.price / acresUsed) * 100) / 100
      : null;
    const done = (tier: LandPortalCompTier, reason: string): ClassifiedLandPortalComp =>
      ({ candidate, tier, reason, acresUsed, pricePerAcre, distanceMiles });

    if (input.subjectApn && candidate.apn && apnIdentifiersEquivalent(input.subjectApn, candidate.apn)) {
      return done('excluded', 'This is the subject parcel itself; a subject is never its own comparable.');
    }
    if (candidate.status !== 'sold') {
      return done('excluded', 'Not a closed sale; active listings are competition context, never FMV evidence.');
    }
    if (candidate.price == null || candidate.price < 1_000) {
      return done('excluded', 'No usable sale price on the result (missing or nominal).');
    }
    if (acresUsed == null || acresUsed <= 0) {
      return done('excluded', 'No usable acreage on the result, so no defensible price per acre exists.');
    }
    if (candidate.buildingSqft != null && candidate.buildingSqft >= IMPROVED_BUILDING_SQFT_FLOOR) {
      return done('excluded', `Improved sale (${candidate.buildingSqft.toLocaleString()} SqFt structure): the price paid for land plus improvements cannot enter the vacant-land $/acre calculation. Belongs to land+home analysis.`);
    }
    if (!route || input.subjectAcres == null) {
      return done('directional', `Sold land at ${acresUsed} ac; the subject acreage is unknown so pool membership cannot be established.`);
    }
    if (acresUsed >= route.pool.min && acresUsed <= route.pool.max) {
      return done('core', `Sold vacant land at ${acresUsed} ac, inside the subject's ${route.pool.label} comparability pool${distanceMiles != null ? `, ~${distanceMiles} mi away` : ''}.`);
    }
    const ratio = acresUsed / input.subjectAcres;
    if (ratio >= 0.2 && ratio <= 4) {
      return done('directional', `Sold vacant land at ${acresUsed} ac — outside the ${route.pool.label} pool but close enough (${ratio < 1 ? 'smaller' : 'larger'}, ${Math.round(ratio * 100) / 100}× the subject) to carry useful $/acre evidence${distanceMiles != null ? `, ~${distanceMiles} mi away` : ''}.`);
    }
    return done('excluded', `Acreage not comparable: ${acresUsed} ac against a ${input.subjectAcres} ac subject (${Math.round(ratio * 100) / 100}×), far outside both the pool and the directional span.`);
  });
}

// ── Rough valuation (unchanged LandOS baseline) ─────────────────────────────

export type LandPortalCompSearchValuation = {
  coreCount: number;
  directionalCount: number;
  excludedCount: number;
  medianSoldPricePerAcre: number | null;
  subjectAcres: number | null;
  landValueIndication: number | null;
  confidence: 'indicative' | 'insufficient';
  caveats: string[];
};

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * MEDIAN RELEVANT ACCEPTED SOLD $/ACRE × SUBJECT ACREAGE. Core sales only —
 * directional evidence shades the read but never blends into the median, and a
 * single sale cannot establish a defensible median (refused, with the reason).
 */
export function landPortalCompSearchValuation(
  subjectAcres: number | null,
  classified: ClassifiedLandPortalComp[],
): LandPortalCompSearchValuation {
  const core = classified.filter((row) => row.tier === 'core' && row.pricePerAcre != null);
  const directionalCount = classified.filter((row) => row.tier === 'directional').length;
  const excludedCount = classified.filter((row) => row.tier === 'excluded').length;
  const caveats: string[] = [];
  let medianPpa: number | null = null;
  let landValue: number | null = null;
  if (core.length >= 2 && subjectAcres != null && subjectAcres > 0) {
    medianPpa = median(core.map((row) => row.pricePerAcre as number));
    if (medianPpa != null) {
      medianPpa = Math.round(medianPpa * 100) / 100;
      landValue = Math.round(medianPpa * subjectAcres);
      const ppas = core.map((row) => row.pricePerAcre as number).sort((a, b) => a - b);
      if (ppas[ppas.length - 1] / ppas[0] > 3) {
        caveats.push(`Wide $/acre span across core sales (${Math.round(ppas[0]).toLocaleString()}–${Math.round(ppas[ppas.length - 1]).toLocaleString()}); the median is a rough indication, not an appraisal.`);
      }
      if (core.length === 2) caveats.push('Only two core sales; the median is the midpoint of two prices.');
    }
  } else if (core.length === 1) {
    caveats.push('A single closed vacant-land sale cannot establish a defensible median, so no land value is stated.');
  } else if (!core.length) {
    caveats.push('No core sold vacant-land evidence was accepted, so no land value is stated.');
  } else {
    caveats.push('Subject acreage is unknown, so no whole-parcel land value can be computed.');
  }
  return {
    coreCount: core.length,
    directionalCount,
    excludedCount,
    medianSoldPricePerAcre: medianPpa,
    subjectAcres,
    landValueIndication: landValue,
    confidence: landValue != null ? 'indicative' : 'insufficient',
    caveats,
  };
}

// ── Source-level diagnostics ────────────────────────────────────────────────

export type CompSourceDiagnostics = {
  source: 'landportal' | 'zillow' | 'redfin' | 'realtor';
  searchAttempted: boolean;
  searchVerified: boolean;
  candidatesDiscovered: number;
  detailPagesInspected: number;
  normalized: number;
  deduped: number;
  core: number;
  directional: number;
  excluded: number;
  notes: string[];
};

export function emptySourceDiagnostics(source: CompSourceDiagnostics['source']): CompSourceDiagnostics {
  return {
    source,
    searchAttempted: false,
    searchVerified: false,
    candidatesDiscovered: 0,
    detailPagesInspected: 0,
    normalized: 0,
    deduped: 0,
    core: 0,
    directional: 0,
    excluded: 0,
    notes: [],
  };
}
