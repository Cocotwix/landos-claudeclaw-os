// LandOS Comp Classification Engine — provider-agnostic, pure, deterministic.
//
// THE PROBLEM THIS SOLVES (engine-wide, not one parcel):
//   A vacant-land price-per-acre band must be built from RAW LAND sales only.
//   When a residential, manufactured, or commercial sale leaks into the band it
//   inflates the per-acre value and every downstream number (acquisition range,
//   strategy, offer). Until now the only protection lived inside realie-comps.ts
//   (Realie path only, and only when yearBuilt was present or there were >=4
//   comps). Redfin/Apify, Zillow, HomeHarvest and any future provider had NO
//   classification at the band seam.
//
// THE FIX:
//   Classify EVERY candidate comp from EVERY provider with whatever signals it
//   carries (provider type codes, year built / building area, use code, listing
//   property-type text, listing description, price-per-acre sanity). Only the
//   raw-land classes (Vacant Land, Farm) may drive vacant-land valuation. Every
//   other class is retained for transparency but excluded from the band, each
//   with a plain, surfaced reason WHY.
//
// HARD RULES:
//   - Pure + deterministic. No network, no model call, no fabrication.
//   - Conservative on ambiguity: an UNKNOWN comp is NOT treated as raw land
//     (it can never silently inflate the band) but is never invented away.
//   - State-agnostic. No jurisdiction lists. Signals only.
//   - Every classification carries the signals that drove it (auditable).

/** Mutually exclusive comp classes. 'exclude' is an explicit non-market row
 *  (nominal transfer, zero acreage, etc.) the caller asked to drop outright. */
export type CompClass =
  | 'vacant_land'
  | 'farm'
  | 'residential'
  | 'manufactured'
  | 'commercial'
  | 'unknown'
  | 'exclude';

export interface CompClassificationInput {
  /** Provider that produced the row (context only; never decides the class). */
  sourceLabel?: string | null;
  soldPrice?: number | null;
  acres?: number | null;
  pricePerAcre?: number | null;
  /** Year a structure was built. > ~1900 is a strong "improved" signal. */
  yearBuilt?: number | null;
  /** Building / living area in square feet. > 0 is a strong "improved" signal. */
  buildingAreaSqft?: number | null;
  /** Redfin propertyType integer (8 = LAND, 6 = single-family). Other ints unknown. */
  redfinPropertyTypeCode?: number | null;
  /** Realie / county land-use code or description string (e.g. "Vacant", "SFR"). */
  useCode?: string | null;
  /** Listing property-type text (HomeHarvest 'land'/'farm'/'single_family', etc.). */
  propertyTypeText?: string | null;
  /** Listing remarks / amenities text scanned for type keywords. */
  descriptionText?: string | null;
  /** Address line (scanned only for "lot"/"unit" hints; weak signal). */
  addressDesc?: string | null;
}

export interface CompClassification {
  class: CompClass;
  /** True ONLY for raw-land classes that may drive vacant-land PPA valuation. */
  isRawLand: boolean;
  confidence: 'high' | 'medium' | 'low';
  /** Plain, surfaced reason this comp got its class (shown in the UI). */
  reason: string;
  /** The signals that actually drove the decision (auditable). */
  signals: string[];
}

/** Below this a sale is a nominal/non-market transfer, not a comp. */
export const NOMINAL_SALE_FLOOR_USD = 1000;
/** A structure built at/after this year is a real "improved" signal. */
export const IMPROVED_YEAR_FLOOR = 1900;

const RAW_LAND_CLASSES: ReadonlySet<CompClass> = new Set(['vacant_land', 'farm']);

export function isRawLandClass(c: CompClass): boolean {
  return RAW_LAND_CLASSES.has(c);
}

// ── Keyword tables (lowercased, word-ish matching) ───────────────────────────

const MANUFACTURED_RE = /\b(manufactured|mobile\s*home|mobile\/?manufactured|single\s*wide|double\s*wide|singlewide|doublewide|trailer|modular)\b/i;
const COMMERCIAL_RE = /\b(commercial|industrial|retail|office|warehouse|distribution|storefront|mixed[\s-]?use|hotel|motel|restaurant)\b/i;
const FARM_RE = /\b(farm|agric\w*|cropland|pasture|ranch|orchard|vineyard|timberland|grazing|dairy)\b/i;
const VACANT_RE = /\b(vacant|raw\s*land|unimproved|buildable\s*lot|build[\s-]?ready|cleared\s*lot|wooded\s*lot|undeveloped|vacant\s*lot|land\s*only|empty\s*lot)\b/i;
const RESIDENTIAL_RE = /\b(single[\s-]?family|sfr|townhome|townhouse|condo|condominium|duplex|triplex|fourplex|multi[\s-]?family|apartment|dwelling|residence|residential|bedroom|bathroom|\d+\s*bd\b|\d+\s*ba\b|sq\s*ft\s*living|living\s*area|house\b|home\b)\b/i;

const lc = (v: unknown): string => (typeof v === 'string' ? v.toLowerCase() : '');

// ── Provider type-code / type-text classifiers (highest confidence first) ────

/** Redfin propertyType integer. 8=LAND (vacant), 6=single-family. Others unknown. */
function fromRedfinCode(code: number | null | undefined): CompClass | null {
  if (code === 8) return 'vacant_land';
  if (code === 6) return 'residential';
  return null; // any other / missing int is NOT guessed
}

/** Listing property-type text (HomeHarvest / Realtor style + generic). */
function fromTypeText(text: string): CompClass | null {
  if (!text) return null;
  if (MANUFACTURED_RE.test(text)) return 'manufactured';
  if (FARM_RE.test(text)) return 'farm';
  if (/\b(land|lot|acreage|parcel)\b/.test(text) && !RESIDENTIAL_RE.test(text)) return 'vacant_land';
  if (COMMERCIAL_RE.test(text)) return 'commercial';
  if (RESIDENTIAL_RE.test(text)) return 'residential';
  return null;
}

/** Realie / county use code or description. Strings vary by county, so match on
 *  robust substrings, manufactured/farm/commercial BEFORE generic residential. */
function fromUseCode(code: string): CompClass | null {
  if (!code) return null;
  if (MANUFACTURED_RE.test(code)) return 'manufactured';
  if (FARM_RE.test(code)) return 'farm';
  if (VACANT_RE.test(code) || /\bvac\b/.test(code)) return 'vacant_land';
  if (COMMERCIAL_RE.test(code)) return 'commercial';
  if (RESIDENTIAL_RE.test(code)) return 'residential';
  return null;
}

/** Free-text listing description — weakest of the type signals, used last. */
function fromDescription(text: string): CompClass | null {
  if (!text) return null;
  if (MANUFACTURED_RE.test(text)) return 'manufactured';
  if (COMMERCIAL_RE.test(text)) return 'commercial';
  if (FARM_RE.test(text)) return 'farm';
  if (VACANT_RE.test(text)) return 'vacant_land';
  if (RESIDENTIAL_RE.test(text)) return 'residential';
  return null;
}

/**
 * Classify ONE candidate comp from any provider. Deterministic and conservative:
 *
 *   1. Explicit non-market rows -> 'exclude' (nominal price, no acreage).
 *   2. Strong IMPROVED signal (yearBuilt >= 1900 OR building area > 0): the comp
 *      has a structure -> it is NOT raw land. Sub-type via text/use code
 *      (manufactured / commercial) else 'residential'.
 *   3. Provider type CODE / type TEXT (Redfin int, listing type) -> high/medium.
 *   4. Use code -> medium. Description keywords -> low.
 *   5. Nothing decisive -> 'unknown' (NOT raw land; can never inflate the band).
 *
 * Only 'vacant_land' and 'farm' return isRawLand=true.
 */
export function classifyComp(input: CompClassificationInput): CompClassification {
  const signals: string[] = [];
  // Provider type text often uses underscores/dots (e.g. "single_family",
  // "mobile.manufactured") — normalize separators to spaces so word matching works.
  const normSep = (v: string): string => v.replace(/[_./]+/g, ' ');
  const useCode = normSep(lc(input.useCode));
  const typeText = normSep(lc(input.propertyTypeText));
  const desc = lc(input.descriptionText);
  const finalize = (cls: CompClass, confidence: CompClassification['confidence'], reason: string): CompClassification => ({
    class: cls,
    isRawLand: isRawLandClass(cls),
    confidence,
    reason,
    signals,
  });

  // 1. Explicit non-market rows -> exclude outright.
  if (typeof input.soldPrice === 'number' && input.soldPrice > 0 && input.soldPrice < NOMINAL_SALE_FLOOR_USD) {
    signals.push(`soldPrice $${input.soldPrice}`);
    return finalize('exclude', 'high', `Nominal / non-market transfer (sold $${input.soldPrice} < $${NOMINAL_SALE_FLOOR_USD}); excluded from valuation.`);
  }

  // 2. Strong improved signal: a structure exists -> never raw land.
  const builtYear = typeof input.yearBuilt === 'number' && input.yearBuilt > IMPROVED_YEAR_FLOOR ? input.yearBuilt : null;
  const buildingArea = typeof input.buildingAreaSqft === 'number' && input.buildingAreaSqft > 0 ? input.buildingAreaSqft : null;
  if (builtYear || buildingArea) {
    if (builtYear) signals.push(`yearBuilt ${builtYear}`);
    if (buildingArea) signals.push(`building ${buildingArea} sqft`);
    // Sub-type the improved parcel from the strongest available type signal.
    const subType =
      (typeText && (MANUFACTURED_RE.test(typeText) || COMMERCIAL_RE.test(typeText)) ? fromTypeText(typeText) : null) ??
      (useCode && (MANUFACTURED_RE.test(useCode) || COMMERCIAL_RE.test(useCode)) ? fromUseCode(useCode) : null) ??
      (desc && (MANUFACTURED_RE.test(desc) || COMMERCIAL_RE.test(desc)) ? fromDescription(desc) : null);
    if (subType === 'manufactured') return finalize('manufactured', 'high', `Improved parcel with a manufactured/mobile structure (${signals.join(', ')}); excluded from vacant-land band.`);
    if (subType === 'commercial') return finalize('commercial', 'high', `Improved commercial/industrial parcel (${signals.join(', ')}); excluded from vacant-land band.`);
    return finalize('residential', 'high', `Improved parcel — a structure is present (${signals.join(', ')}); a house sale, excluded from vacant-land band.`);
  }

  // 3. Provider type code (highest-confidence structured signal).
  const byCode = fromRedfinCode(input.redfinPropertyTypeCode);
  if (byCode) {
    signals.push(`redfin propertyType ${input.redfinPropertyTypeCode}`);
    return finalize(byCode, 'high', byCode === 'vacant_land'
      ? 'Provider type code = LAND: raw-land comp.'
      : 'Provider type code = single-family residential; excluded from vacant-land band.');
  }

  // 3b. Listing property-type text (HomeHarvest 'land'/'farm'/'single_family').
  const byTypeText = fromTypeText(typeText);
  if (byTypeText) {
    signals.push(`type "${input.propertyTypeText}"`);
    return finalize(byTypeText, 'high', `Listing property type "${input.propertyTypeText}" -> ${byTypeText.replace('_', ' ')}.`);
  }

  // 4. Use code (medium) then description keywords (low).
  const byUse = fromUseCode(useCode);
  if (byUse) {
    signals.push(`useCode "${input.useCode}"`);
    return finalize(byUse, 'medium', `Land-use code "${input.useCode}" -> ${byUse.replace('_', ' ')}.`);
  }
  const byDesc = fromDescription(desc);
  if (byDesc) {
    signals.push('description keywords');
    return finalize(byDesc, 'low', `Listing description indicates ${byDesc.replace('_', ' ')} (keyword match, low confidence).`);
  }

  // 5. Nothing decisive -> unknown. Conservatively NOT raw land: an unclassified
  //    row can never silently inflate the vacant-land band.
  return finalize('unknown', 'low', 'No reliable type signal (no year built, building area, type code, use code, or type keywords). Not counted as raw land; verify before pricing.');
}

export interface CompClassSplit<T> {
  /** Comps classified as raw land (vacant_land | farm) — drive the PPA band. */
  rawLand: Array<{ comp: T; classification: CompClassification }>;
  /** Everything else (residential/manufactured/commercial/unknown/exclude),
   *  kept for transparency with the reason it was withheld from the band. */
  excluded: Array<{ comp: T; classification: CompClassification }>;
}

/**
 * Split a set of comps into raw-land (valuation-eligible) vs excluded, using a
 * caller-supplied signal extractor. Pure. The raw-land set is what a vacant-land
 * PPA band must be computed from; the excluded set is surfaced with reasons and
 * never silently dropped.
 */
export function splitCompsByClass<T>(
  comps: T[],
  toInput: (comp: T) => CompClassificationInput,
): CompClassSplit<T> {
  const rawLand: CompClassSplit<T>['rawLand'] = [];
  const excluded: CompClassSplit<T>['excluded'] = [];
  for (const comp of comps) {
    const classification = classifyComp(toInput(comp));
    if (classification.isRawLand) rawLand.push({ comp, classification });
    else excluded.push({ comp, classification });
  }
  return { rawLand, excluded };
}
