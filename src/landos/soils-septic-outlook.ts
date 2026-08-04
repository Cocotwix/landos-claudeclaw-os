// Soils & Preliminary Septic Outlook (projection + retained screening).
//
// Builds the operator-facing preliminary septic outlook for a subject from:
//   1. the accepted LandPortal soil-overlay units already retained as
//      property-inspection evidence (name, drainage, farmland, capability);
//   2. an optional retained USDA NRCS SSURGO screening (official map-unit
//      attributes + the "Septic Tank Absorption Fields" interpretation),
//      persisted through the existing card-activity evidence path.
//
// The outlook is a PRELIMINARY category, never a pass/fail claim and never a
// numeric probability. Parcel-share percentages are shown only when actually
// retained; otherwise unit-level findings are reported and confidence is
// lowered honestly. A perc test or professional soil evaluation always
// remains the required next step.

import { attachCardActivity } from './property-card.js';
import { getLandosDb } from './db.js';

export const SOILS_SEPTIC_SCREENING_KIND = 'soils_septic_screening';

export interface SoilsSepticUnitScreening {
  name: string;
  symbol: string | null;
  slopeRange: string | null;
  drainageClass: string | null;
  hydrologicGroup: string | null;
  /** Depth to seasonal high water table, cm (SSURGO wtdepannmin). */
  waterTableDepthCm: number | null;
  /** Depth to bedrock, cm (SSURGO brockdepmin); null = none within profile. */
  bedrockDepthCm: number | null;
  floodingFrequency: string | null;
  pondingFrequency: string | null;
  /** Official NRCS "Septic Tank Absorption Fields" rating (e.g. Very limited). */
  septicRating: string | null;
  limitationReasons: string[];
  /** Parcel share/acreage when genuinely retained; null when unavailable. */
  parcelSharePct: number | null;
}

export interface SoilsSepticScreeningRecord {
  source: string;
  sourceUrl: string | null;
  surveyArea: string | null;
  retrievedAt: string;
  units: SoilsSepticUnitScreening[];
  /** Best apparent field-testing areas grounded in accepted terrain/imagery
   *  evidence, when supported; null otherwise. */
  bestTestingAreasNote: string | null;
}

export function persistSoilsSepticScreening(propertyCardId: number, record: SoilsSepticScreeningRecord): number {
  return attachCardActivity({
    cardId: propertyCardId,
    agentId: 'soils-septic-screening',
    kind: SOILS_SEPTIC_SCREENING_KIND,
    summary: `USDA NRCS SSURGO septic screening retained for ${record.units.length} mapped soil unit(s).`,
    ref: JSON.stringify(record),
  });
}

export function loadSoilsSepticScreening(propertyCardId: number): SoilsSepticScreeningRecord | null {
  const row = getLandosDb()
    .prepare('SELECT ref FROM landos_card_activity WHERE card_id = ? AND kind = ? ORDER BY created_at DESC, id DESC LIMIT 1')
    .get(propertyCardId, SOILS_SEPTIC_SCREENING_KIND) as { ref: string } | undefined;
  if (!row?.ref) return null;
  try {
    const parsed = JSON.parse(row.ref) as SoilsSepticScreeningRecord;
    return Array.isArray(parsed?.units) ? parsed : null;
  } catch {
    return null;
  }
}

export type SepticOutlookCategory = 'high' | 'moderate' | 'low' | 'mixed' | 'insufficient';

export interface SoilsSepticOutlookView {
  category: SepticOutlookCategory;
  categoryLabel: string;
  conclusion: string;
  supportingFactors: string[];
  limitations: string[];
  bestTestingAreas: string | null;
  confidence: 'moderate' | 'low';
  confidenceWhy: string;
  nextStep: string;
  parcelShareNote: string;
  units: SoilsSepticUnitScreening[];
  source: string;
  screenedAt: string | null;
}

const CATEGORY_LABEL: Record<SepticOutlookCategory, string> = {
  high: 'High preliminary likelihood',
  moderate: 'Moderate preliminary likelihood',
  low: 'Low preliminary likelihood (conventional system)',
  mixed: 'Mixed across the parcel',
  insufficient: 'Insufficient soil data',
};

const cmToInches = (cm: number): number => Math.round(cm / 2.54);

/** Slope range straight out of a map-unit name ("…, 2 to 6 percent slopes"). */
function slopeFromName(name: string): string | null {
  const match = name.match(/(\d+)\s*to\s*(\d+)\s*percent/i);
  return match ? `${match[1]}–${match[2]}%` : null;
}

interface AcceptedSoilDetail { symbol?: string | null; name?: string | null; fields?: Record<string, string> }

/**
 * Merge the accepted overlay units with the retained official screening and
 * derive the parcel-level preliminary outlook. The soil map-unit NAME alone
 * never decides the category — official interpretations govern when
 * retained; otherwise only broad drainage-class screening is used and the
 * confidence drops.
 */
export function buildSoilsSepticOutlook(
  soilDetails: AcceptedSoilDetail[],
  screening: SoilsSepticScreeningRecord | null,
): SoilsSepticOutlookView | null {
  const acceptedNames = soilDetails
    .map((detail) => (detail.name ?? '').trim())
    .filter(Boolean);
  if (!acceptedNames.length && !(screening?.units.length)) return null;

  const screenedByName = new Map<string, SoilsSepticUnitScreening>(
    (screening?.units ?? []).map((unit) => [unit.name.trim().toLowerCase(), unit]),
  );
  const units: SoilsSepticUnitScreening[] = acceptedNames.map((name) => {
    const official = screenedByName.get(name.toLowerCase());
    const detail = soilDetails.find((entry) => (entry.name ?? '').trim() === name);
    return official ?? {
      name,
      symbol: detail?.symbol ?? null,
      slopeRange: slopeFromName(name),
      drainageClass: detail?.fields?.['Drainage Class'] ?? null,
      hydrologicGroup: null,
      waterTableDepthCm: null,
      bedrockDepthCm: null,
      floodingFrequency: null,
      pondingFrequency: null,
      septicRating: null,
      limitationReasons: [],
      parcelSharePct: null,
    };
  });
  // Screened units that the overlay popups did not name are still part of the
  // parcel picture — include them rather than silently dropping them.
  for (const unit of screening?.units ?? []) {
    if (!units.some((existing) => existing.name.toLowerCase() === unit.name.toLowerCase())) units.push(unit);
  }

  const rated = units.filter((unit) => unit.septicRating);
  const veryLimited = rated.filter((unit) => /very limited/i.test(unit.septicRating ?? ''));
  const notLimited = rated.filter((unit) => /not limited|slight/i.test(unit.septicRating ?? ''));

  let category: SepticOutlookCategory;
  let confidence: 'moderate' | 'low';
  let confidenceWhy: string;
  if (!units.length) {
    category = 'insufficient';
    confidence = 'low';
    confidenceWhy = 'No mapped soil unit is retained for this parcel.';
  } else if (rated.length === units.length && units.length > 0) {
    category = veryLimited.length === units.length
      ? 'low'
      : notLimited.length === units.length
        ? 'high'
        : veryLimited.length > 0
          ? 'mixed'
          : 'moderate';
    confidence = 'moderate';
    confidenceWhy = 'Official USDA NRCS septic absorption-field interpretations are retained for every mapped unit, but parcel shares and field conditions are unverified.';
  } else if (units.some((unit) => unit.drainageClass)) {
    const wellDrained = units.every((unit) => /well drained/i.test(unit.drainageClass ?? ''));
    category = wellDrained ? 'moderate' : 'insufficient';
    confidence = 'low';
    confidenceWhy = 'No official septic interpretation is retained; only broad drainage-class screening is available, so this outlook carries low confidence.';
  } else {
    category = 'insufficient';
    confidence = 'low';
    confidenceWhy = 'The retained soil rows carry no usable characteristics for a septic screening.';
  }

  const shares = units.filter((unit) => unit.parcelSharePct != null);
  const parcelShareNote = shares.length === units.length && units.length > 0
    ? 'Parcel shares are retained per unit.'
    : 'Per-unit parcel percentages are not retained, so favorable/unfavorable acreage cannot be split; findings are reported per mapped unit.';

  const supportingFactors: string[] = [];
  const limitations: string[] = [];
  const drainage = [...new Set(units.map((unit) => unit.drainageClass).filter(Boolean))];
  if (drainage.length) supportingFactors.push(`Drainage: ${drainage.join('; ')} across the mapped units.`);
  const slopes = units.map((unit) => unit.slopeRange).filter(Boolean);
  if (slopes.length) supportingFactors.push(`Mapped slope ranges: ${slopes.join(', ')} — workable grades for system placement.`);
  if (units.every((unit) => unit.bedrockDepthCm == null) && rated.length) {
    supportingFactors.push('No shallow bedrock limitation is recorded for these units.');
  }
  if (rated.length && units.every((unit) => !unit.floodingFrequency || /none/i.test(unit.floodingFrequency))) {
    supportingFactors.push('No mapped flooding or ponding frequency on these units.');
  }
  const waterTables = units.map((unit) => unit.waterTableDepthCm).filter((value): value is number => value != null);
  if (waterTables.length) {
    const min = Math.min(...waterTables);
    const max = Math.max(...waterTables);
    limitations.push(`Seasonal high water table mapped at roughly ${cmToInches(min)}–${cmToInches(max)} inches (${min}–${max} cm) — the governing limitation for a conventional absorption field.`);
  }
  const reasonSet = [...new Set(units.flatMap((unit) => unit.limitationReasons))];
  for (const reason of reasonSet) {
    if (!/saturated zone/i.test(reason) || !waterTables.length) limitations.push(`NRCS limitation factor: ${reason}.`);
  }
  const groups = [...new Set(units.map((unit) => unit.hydrologicGroup).filter(Boolean))];
  if (groups.length) limitations.push(`Hydrologic soil group ${groups.join('/')} — slow infiltration when saturated.`);

  const ratingSummary = rated.length
    ? `${veryLimited.length === units.length ? 'Every' : `${veryLimited.length} of ${units.length}`} mapped unit(s) carr${veryLimited.length === 1 ? 'ies' : 'y'} the official USDA NRCS rating "${rated[0].septicRating}" for septic tank absorption fields`
    : null;
  const conclusion = category === 'low'
    ? `${ratingSummary}, driven by the seasonal high water table rather than slope or bedrock. A conventional in-ground absorption field should not be assumed; raised or engineered systems are commonly used on these soils, and actual feasibility is decided by field testing.`
    : category === 'high'
      ? `${ratingSummary ?? 'The mapped units screen favorably'}; no governing limitation is mapped, and field testing remains the deciding step.`
      : category === 'mixed'
        ? `${ratingSummary}; portions of the parcel screen materially better than others, so siting will decide feasibility.`
        : category === 'moderate'
          ? 'The mapped units are moderately well drained with workable slopes, suggesting portions of the parcel may suit an onsite system; official interpretations and field testing remain unconfirmed.'
          : 'Not enough retained soil data exists to state a preliminary septic outlook for this parcel.';

  return {
    category,
    categoryLabel: CATEGORY_LABEL[category],
    conclusion,
    supportingFactors,
    limitations,
    bestTestingAreas: screening?.bestTestingAreasNote ?? null,
    confidence,
    confidenceWhy,
    nextStep: 'Perc test or professional soil evaluation.',
    parcelShareNote,
    units,
    source: screening
      ? `LandPortal soil overlay (accepted) + ${screening.source}`
      : 'LandPortal soil overlay (accepted); no official USDA interpretation retained',
    screenedAt: screening?.retrievedAt ?? null,
  };
}
