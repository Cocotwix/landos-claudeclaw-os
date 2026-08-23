// LandOS — CURRENT zoning for THIS parcel, from a current authoritative source.
//
// Runs after `controlling-land-use-authority.ts` has established whose zoning
// it is. Two rules decide everything here.
//
// RULE 1 — A HISTORICAL DOCUMENT NEVER ESTABLISHES CURRENT ZONING.
// A 2024 planning packet that prints "Current Zoning: R-20" is evidence that
// the packet said R-20 in 2024. Districts get amended, parcels get rezoned, and
// packets get superseded. Such a statement is retained as a dated historical
// reference and is REFUSED as a current determination — `selectCurrentZoning`
// will not accept it, whatever else is missing. Reporting "unresolved" is the
// correct answer when only history is available.
//
// RULE 2 — PARCEL-SPECIFIC EVIDENCE OUTRANKS JURISDICTION-WIDE EVIDENCE.
// A zoning layer that returns the district for THIS parcel's geometry or APN is
// stronger than a zoning map image, which is stronger than a planning record,
// which is stronger than the ordinance text. The ordinance says what R-20 MEANS;
// it does not say this parcel is R-20.
//
// Direct retrieval first: an ArcGIS REST zoning layer answers in one request and
// needs no browser. Browser navigation is escalation for when no direct route
// exists, and it is the caller's to supply.

import { arcgisJson, type ArcgisDiscoveryDeps } from './arcgis-service-discovery.js';
import { defaultGovFetchText, htmlToText, type GovFetchText } from './gis-transport.js';
import { verifyOfficiality } from './official-source-discovery.js';
import { governmentSourceTier, raceRecordOf } from './controlling-land-use-authority.js';
import type { AuthorityAssignment, AuthoritySourceTier, LandUseRaceRecord } from './controlling-land-use-authority.js';
import {
  browserEscalationLane,
  buildLandUseQueries,
  directApiLane,
  directSourceLane,
  indexedWebSearchLane,
  retainedEvidenceLane,
  type BrowserSourceReader,
  type EvidenceReader,
  type LaneJurisdiction,
  type RetrievalTransports,
  type SubjectQueryFacts,
} from './land-use-lanes.js';
import {
  raceLandUseSources,
  type LandUseEvidence,
  type LandUseLane,
  type LandUseLaneRecord,
} from './land-use-source-race.js';
import {
  completeRuleValue,
  flattenOrdinanceText,
  looksLikeTableOfContents,
  matchNumericRuleValue,
  scopeToDistrictBlock,
} from './ordinance-text.js';
import type { BackstoryZoningReference } from './property-backstory.js';
import type { IdentitySearchProvider } from './hermes-free-search.js';

// ── Vocabulary ──────────────────────────────────────────────────────────────

/** Strongest first. The order IS the policy. */
export const ZONING_EVIDENCE_KINDS = [
  'parcel_zoning_gis',
  'official_zoning_map',
  'planning_or_property_record',
  'current_official_ordinance',
  'other_official_parcel_specific',
  /** Retained, never selected. Present so history is visible, not usable. */
  'historical_planning_document',
] as const;
export type ZoningEvidenceKind = (typeof ZONING_EVIDENCE_KINDS)[number];

const SELECTABLE_KINDS: readonly ZoningEvidenceKind[] = [
  'parcel_zoning_gis',
  'official_zoning_map',
  'planning_or_property_record',
  'current_official_ordinance',
  'other_official_parcel_specific',
];

export const ZONING_KIND_RANK: Record<ZoningEvidenceKind, number> = {
  parcel_zoning_gis: 0,
  official_zoning_map: 1,
  planning_or_property_record: 2,
  current_official_ordinance: 3,
  other_official_parcel_specific: 4,
  historical_planning_document: 99,
};

export type ZoningConfidence = 'confirmed' | 'well_supported' | 'likely' | 'unresolved';

export interface ZoningEvidenceCandidate {
  kind: ZoningEvidenceKind;
  districtCode: string | null;
  districtName: string | null;
  overlays: string[];
  /** How this evidence was tied to THIS parcel. Never "the parcel is nearby". */
  parcelMatchBasis: string;
  sourceLabel: string;
  sourceUrl: string | null;
  sourceTier: AuthoritySourceTier;
  /** The date the SOURCE carries, when it carries one. */
  effectiveOrAsOf: string | null;
  quote: string;
  retrievedAt: string;
}

export interface ZoningStandards {
  minimumLotSize: string | null;
  density: string | null;
  principalUses: string[];
  residentialEligible: boolean | null;
  manufacturedHomeEligible: boolean | null;
  setbacks: string | null;
  frontage: string | null;
  lotWidth: string | null;
  heightOrCoverage: string | null;
  specialConditions: string[];
  /** Every standard above traces to one of these. */
  sources: Array<{ label: string; url: string | null; section: string | null; quote: string }>;
}

export interface CurrentZoningDetermination {
  dealCardId: number;
  established: boolean;
  districtCode: string | null;
  districtName: string | null;
  overlays: string[];
  /** The government whose zoning this is. Copied from the authority record. */
  authorityName: string | null;
  authorityDetermination: AuthorityAssignment['determination'] | 'not_supplied';
  evidenceKind: ZoningEvidenceKind | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  parcelMatchBasis: string | null;
  effectiveOrAsOf: string | null;
  verifiedAt: string;
  confidence: ZoningConfidence;
  conflicts: string[];
  /** Zoning the historical record stated, with its own dates. Never current. */
  historicalReferences: BackstoryZoningReference[];
  /** Zoning that was asked for. Never an approval. */
  requestedZoning: BackstoryZoningReference[];
  standards: ZoningStandards;
  limitations: string[];
  /** Every candidate considered, selected or refused, with the reason. */
  consideredEvidence: Array<{ candidate: ZoningEvidenceCandidate; selected: boolean; note: string }>;
  /** Which retrieval methods raced, which won, and what was still running. */
  race?: LandUseRaceRecord;
}

export function emptyZoningStandards(): ZoningStandards {
  return {
    minimumLotSize: null,
    density: null,
    principalUses: [],
    residentialEligible: null,
    manufacturedHomeEligible: null,
    setbacks: null,
    frontage: null,
    lotWidth: null,
    heightOrCoverage: null,
    specialConditions: [],
    sources: [],
  };
}

// ── Selection ───────────────────────────────────────────────────────────────

export interface ZoningSelection {
  selected: ZoningEvidenceCandidate | null;
  conflicts: string[];
  considered: CurrentZoningDetermination['consideredEvidence'];
  confidence: ZoningConfidence;
}

const normalizeCode = (value: string | null): string =>
  (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Choose the current district, or refuse to.
 *
 * A `historical_planning_document` candidate is never selectable — that is Rule
 * 1, enforced in code rather than in a comment. Two selectable candidates that
 * disagree on the district produce an explicit conflict and NO selection: the
 * operator gets both, and the district stays unestablished until one is
 * corroborated.
 */
export function selectCurrentZoning(candidates: readonly ZoningEvidenceCandidate[]): ZoningSelection {
  const considered: CurrentZoningDetermination['consideredEvidence'] = [];
  const conflicts: string[] = [];

  const usable = candidates.filter((candidate) => {
    if (!SELECTABLE_KINDS.includes(candidate.kind)) {
      considered.push({
        candidate,
        selected: false,
        note: 'Refused as a CURRENT determination: this is a historical planning document. It states what was true when it was written and is retained as a dated reference only.',
      });
      return false;
    }
    if (!candidate.districtCode && !candidate.districtName) {
      considered.push({ candidate, selected: false, note: 'Carries no district code or name, so it establishes nothing.' });
      return false;
    }
    if (candidate.sourceTier !== 'official_government_source') {
      considered.push({
        candidate,
        selected: false,
        note: `Refused: the source is ${candidate.sourceTier.replace(/_/g, ' ')}. Zoning is a legal determination and an aggregator or search result is never the controlling authority for it.`,
      });
      return false;
    }
    return true;
  });

  if (!usable.length) {
    return {
      selected: null,
      conflicts,
      considered,
      confidence: 'unresolved',
    };
  }

  const sorted = [...usable].sort((a, b) => ZONING_KIND_RANK[a.kind] - ZONING_KIND_RANK[b.kind]);
  const best = sorted[0];
  const disagreeing = sorted.filter((candidate) =>
    normalizeCode(candidate.districtCode ?? candidate.districtName) !== normalizeCode(best.districtCode ?? best.districtName));

  if (disagreeing.length) {
    for (const candidate of sorted) {
      considered.push({
        candidate,
        selected: false,
        note: 'Two or more current official sources disagree on the district, so none is selected and the disagreement is reported.',
      });
    }
    conflicts.push(
      `Conflicting CURRENT zoning evidence: ${[...new Set(sorted.map((row) => `${row.districtCode ?? row.districtName} (${row.kind.replace(/_/g, ' ')}, ${row.sourceUrl ?? 'no url'})`))].join(' vs ')}. `
      + 'The district is not established while official sources disagree.',
    );
    return { selected: null, conflicts, considered, confidence: 'unresolved' };
  }

  for (const candidate of sorted) {
    considered.push({
      candidate,
      selected: candidate === best,
      note: candidate === best
        ? `Selected: strongest available evidence kind (${candidate.kind.replace(/_/g, ' ')}), matched to this parcel by ${candidate.parcelMatchBasis}.`
        : `Corroborates the selected district from a weaker evidence kind (${candidate.kind.replace(/_/g, ' ')}).`,
    });
  }

  // A parcel-specific GIS or map read from the authority is Confirmed. A
  // planning record or ordinance-derived read is strong but one step removed
  // from the authority's own map, so it carries Well supported.
  const confidence: ZoningConfidence =
    best.kind === 'parcel_zoning_gis' || best.kind === 'official_zoning_map'
      ? (sorted.length > 1 ? 'confirmed' : 'confirmed')
      : 'well_supported';

  return { selected: best, conflicts, considered, confidence };
}

// ── Reading a parcel-specific zoning layer ──────────────────────────────────

export interface ZoningGisQuery {
  layerUrl: string;
  layerLabel?: string | null;
  /** Attribute query, when the layer exposes a parcel identifier field. */
  apn?: string | null;
  apnField?: string | null;
  /** Spatial query, when a parcel point is known. Never a ZIP centroid. */
  point?: { lat: number; lng: number } | null;
  /** How the point was obtained, so a weak point never reads as strong. */
  pointBasis?: string | null;
}

const ZONING_CODE_FIELDS = ['ZONING', 'ZONE', 'ZONECODE', 'ZONE_CODE', 'ZONING_COD', 'ZONECLASS', 'ZONE_CLASS', 'ZONING_CODE', 'ZONE_', 'ZONECD'];
const ZONING_NAME_FIELDS = ['ZONEDESC', 'ZONE_DESC', 'ZONING_DES', 'DESCRIPTION', 'ZONENAME', 'ZONE_NAME', 'ZONING_DESCRIPTION', 'LABEL'];
const OVERLAY_FIELDS = ['OVERLAY', 'OVERLAY_DI', 'OVERLAYDISTRICT', 'OVERLAY_NAME'];

function pickAttribute(attributes: Record<string, unknown>, candidates: readonly string[]): string | null {
  const upper = new Map(Object.keys(attributes).map((key) => [key.toUpperCase().replace(/[^A-Z0-9_]/g, ''), key]));
  for (const candidate of candidates) {
    const key = upper.get(candidate);
    if (!key) continue;
    const value = String(attributes[key] ?? '').trim();
    if (value && value.toLowerCase() !== 'null') return value;
  }
  return null;
}

/**
 * Query the authority's zoning layer for THIS parcel.
 *
 * An APN attribute query is preferred: it is exact and needs no geometry. A
 * point query is used only when the caller supplies a point AND says where it
 * came from, because a geocoded address point is not parcel identity
 * (permanent-memory invariant 3) and the basis has to travel with the answer.
 */
export async function readZoningFromGisLayer(
  query: ZoningGisQuery,
  deps: ArcgisDiscoveryDeps & { now?: () => string } = {},
): Promise<ZoningEvidenceCandidate | null> {
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const params: Record<string, string> = { outFields: '*', returnGeometry: 'false', outSR: '4326' };
  let matchBasis: string;

  if (query.apn && query.apnField) {
    params.where = `${query.apnField}='${query.apn.replace(/'/g, "''")}'`;
    matchBasis = `an attribute query on the authority's zoning layer field ${query.apnField} for parcel ${query.apn}`;
  } else if (query.point) {
    params.geometry = JSON.stringify({ x: query.point.lng, y: query.point.lat, spatialReference: { wkid: 4326 } });
    params.geometryType = 'esriGeometryPoint';
    params.inSR = '4326';
    params.spatialRel = 'esriSpatialRelIntersects';
    params.where = '1=1';
    matchBasis = `a point-in-polygon query against the authority's zoning layer using ${query.pointBasis ?? 'a parcel point of unstated origin'}`;
  } else {
    return null;
  }

  let payload: { features?: Array<{ attributes?: Record<string, unknown> }> };
  try {
    payload = await arcgisJson(`${query.layerUrl}/query`, params, deps);
  } catch {
    return null;
  }
  const attributes = payload.features?.[0]?.attributes;
  if (!attributes) return null;

  const code = pickAttribute(attributes, ZONING_CODE_FIELDS);
  const name = pickAttribute(attributes, ZONING_NAME_FIELDS);
  const overlay = pickAttribute(attributes, OVERLAY_FIELDS);
  if (!code && !name) return null;

  return {
    kind: 'parcel_zoning_gis',
    districtCode: code,
    districtName: name,
    overlays: overlay ? [overlay] : [],
    parcelMatchBasis: matchBasis,
    sourceLabel: query.layerLabel ?? `Official zoning layer ${query.layerUrl}`,
    sourceUrl: query.layerUrl,
    sourceTier: 'official_government_source',
    effectiveOrAsOf: null,
    quote: JSON.stringify(
      Object.fromEntries(Object.entries(attributes).slice(0, 12)),
    ).slice(0, 600),
    retrievedAt: now,
  };
}

// ── Reading the standards that matter to a land buyer ───────────────────────

interface StandardRule {
  key: keyof Pick<ZoningStandards, 'minimumLotSize' | 'density' | 'setbacks' | 'frontage' | 'lotWidth' | 'heightOrCoverage'>;
  pattern: RegExp;
}

const STANDARD_RULES: StandardRule[] = [
  // These stop at the first period; `matchNumericRuleValue` then completes the
  // value to the end of its real sentence. Keeping the patterns simple and the
  // sentence rule in one place is what stopped the three extractors drifting.
  { key: 'minimumLotSize', pattern: /\bminimum\s+lot\s+(?:size|area)\b[^.\n]{0,160}/i },
  { key: 'density', pattern: /\b(?:maximum\s+)?density\b[^.\n]{0,160}|\b\d+(?:\.\d+)?\s*(?:dwelling\s+)?units?\s+per\s+acre\b[^.\n]{0,80}/i },
  { key: 'setbacks', pattern: /\b(?:front|rear|side)\s+(?:yard\s+)?setback\b[^.\n]{0,180}/i },
  { key: 'frontage', pattern: /\bminimum\s+(?:lot\s+)?frontage\b[^.\n]{0,160}|\bstreet\s+frontage\b[^.\n]{0,140}/i },
  { key: 'lotWidth', pattern: /\bminimum\s+lot\s+width\b[^.\n]{0,160}/i },
  { key: 'heightOrCoverage', pattern: /\bmaximum\s+(?:building\s+)?height\b[^.\n]{0,140}|\b(?:maximum\s+)?lot\s+coverage\b[^.\n]{0,140}/i },
];

const SECTION_PATTERN = /\b(?:section|sec\.|article|art\.|chapter|ch\.|§)\s*([0-9]+(?:[.\-][0-9A-Za-z]+)*)/i;

/**
 * FORM-BASED CODES STATE THE SAME NUMBERS A DIFFERENT WAY.
 *
 * A conventional Euclidean ordinance writes prose — "the minimum lot area
 * shall be four (4) acres" — and the rules above read it. A form-based code
 * publishes a per-district TABLE whose rows are a label and a measurement:
 *
 *   Density                       2 dwelling units per acre max.
 *   Lot / Building Site Width     100 ft. min., 150 ft. max.
 *   Lot / Building Site Area      NR
 *
 * None of those rows contains the word "minimum", so every prose pattern above
 * misses them and the district reads as having no standards at all. That is
 * not a rare shape: character-district and transect codes are how a growing
 * share of towns now zone, and it is exactly the code type LandOS met on its
 * own acceptance parcel.
 *
 * The rows are read positionally: find the labels, and a row's value is the
 * text up to the next label. `NR` / `NA` are preserved rather than dropped —
 * "lot area is not regulated" is a finding, and on a form-based site it is
 * often the finding, because it means DENSITY is the binding constraint.
 */
interface FormBasedRow {
  key: StandardRule['key'];
  label: RegExp;
}

const FORM_BASED_ROWS: readonly FormBasedRow[] = [
  { key: 'density', label: /\bDensity\b\*?/i },
  { key: 'lotWidth', label: /\bLot(?:\s*\/\s*Building Site)?\s+Width\b/i },
  { key: 'minimumLotSize', label: /\bLot(?:\s*\/\s*Building Site)?\s+Area\b/i },
  { key: 'frontage', label: /\bFrontage Buildout\b/i },
  { key: 'setbacks', label: /\bFront Setback\s*\/\s*Yard,\s*Principal Frontage\b/i },
  { key: 'heightOrCoverage', label: /\bBuilding Height\b|\bImpervious Surface Coverage\b|\bLot Coverage\b/i },
];

/** Every label that can terminate a row's value, so one row cannot swallow the next. */
const ROW_BOUNDARY = new RegExp(
  [
    'Density', 'Lot Occupation', 'Lot\\s*/\\s*Building Site Width', 'Lot\\s*/\\s*Building Site Area',
    'Lot\\s*/\\s*Building Site Enfrontment', 'Lot\\s*/\\s*Building Site Access', 'Frontage Buildout',
    'Impervious Surface Coverage', 'Setbacks\\s*/\\s*Yards', 'Front Setback', 'Side Setback', 'Rear Setback',
    'Building Standards', 'Building Height', 'Ceiling Height', 'Building Composition', 'Block Size',
    'Block Perimeter', 'Permitted Uses', 'Civic Space Types', 'Private Frontage Types', 'Building Types',
    'Number of Buildings', 'LEGEND', 'Vehicular Parking',
  ].join('|'),
  'gi',
);

/** Footnote markers and their explanatory sentence, which are not the value. */
function stripRowFootnote(value: string): string {
  return value
    .replace(/^\*+\s*/, '')
    .replace(/\*\s*Applicable only to [^.]*\./gi, '')
    .replace(/^[\s:.\-–]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    // A district table is laid out around a diagram, so a row's text often
    // ends with the page number or the single-letter key that points at the
    // illustration ("40 ft. min. A"). Neither is part of the rule.
    .replace(/\s+(?:\d{1,3}|[A-Z])$/, '')
    .trim();
}

/** True when a row value actually states something readable. */
function usableRowValue(value: string): boolean {
  if (!value) return false;
  if (/^(NR|NA)\b/i.test(value)) return true;
  return /\d/.test(value);
}

export function readFormBasedDistrictStandards(input: {
  text: string;
  sourceLabel: string;
  sourceUrl: string | null;
}): ZoningStandards {
  const standards = emptyZoningStandards();
  const text = input.text.replace(/\s+/g, ' ');

  // Every boundary label, in document order.
  const boundaries: number[] = [];
  for (const match of text.matchAll(ROW_BOUNDARY)) boundaries.push(match.index ?? 0);
  boundaries.sort((a, b) => a - b);

  for (const row of FORM_BASED_ROWS) {
    if (standards[row.key]) continue;
    // EVERY occurrence, not the first. These labels are ordinary words that
    // also appear in the district's prose description — "a low DENSITY
    // single-family area" precedes the Density ROW by two paragraphs — so
    // stopping at the first match reads the description and reports nothing.
    const label = new RegExp(row.label.source, `${row.label.flags.replace(/g/g, '')}g`);
    for (const found of text.matchAll(label)) {
      const valueStart = (found.index ?? 0) + found[0].length;
      const next = boundaries.find((index) => index > valueStart + 2);
      const raw = text.slice(valueStart, next ?? valueStart + 180);
      const value = stripRowFootnote(raw).slice(0, 180);
      if (!usableRowValue(value)) continue;
      standards[row.key] = /^(NR|NA)\b/i.test(value)
        ? 'Not regulated by the district table'
        : value;
      standards.sources.push({
        label: input.sourceLabel,
        url: input.sourceUrl,
        section: SECTION_PATTERN.exec(text.slice(Math.max(0, (found.index ?? 0) - 200), found.index ?? 0))?.[0] ?? null,
        quote: `${found[0]} ${value}`.slice(0, 400),
      });
      break;
    }
  }
  return standards;
}

/**
 * The handful of standards that actually decide a land deal.
 *
 * Deliberately NOT an encyclopedia of the zoning code. Minimum lot size,
 * density, frontage, lot width, setbacks and whether a home may go on it are
 * what move acquisition, subdivision and resale. Everything else is noise at
 * discovery stage, and mining it would bury the six numbers that matter.
 */
export function readZoningStandards(input: {
  text: string;
  districtCode: string | null;
  sourceLabel: string;
  sourceUrl: string | null;
}): ZoningStandards {
  const standards = emptyZoningStandards();
  // FLATTEN FIRST. A PDF wraps "the minimum lot area shall be four (4) acres"
  // across two lines wherever the glyphs ran out, and a live run read exactly
  // "minimum lot area shall be four (4)" because the match died on the wrap.
  // Where the line broke is a property of the page, not of the rule.
  const text = flattenOrdinanceText(input.text);
  // Scope to the district's own section when the code is known and the document
  // prints it: a whole ordinance carries every district's numbers, and reading
  // the wrong district's minimum lot size is worse than reading none. A call
  // with no district, or a document that never names it, reads the whole text
  // exactly as before.
  const scoped = (input.districtCode ? scopeToDistrictBlock(text, input.districtCode) : null)
    ?? { text, section: null };
  const body = scoped.text;

  const cite = (quote: string): void => {
    const section = SECTION_PATTERN.exec(quote)?.[0] ?? scoped.section;
    standards.sources.push({ label: input.sourceLabel, url: input.sourceUrl, section: section ?? null, quote: quote.slice(0, 400) });
  };

  for (const rule of STANDARD_RULES) {
    // A dimensional standard whose whole point is a number is not a standard
    // without one, and it is not the rule if the number was cut off it.
    // `matchNumericRuleValue` answers both: the first match that states a
    // number, completed to the end of its actual sentence.
    const found = matchNumericRuleValue(body, rule.pattern);
    if (!found) continue;
    standards[rule.key] = found.value.replace(/\s+/g, ' ').trim();
    cite(found.value);
  }

  const uses = [...body.matchAll(/\b(?:permitted|principal)\s+uses?\b[^.\n]{0,200}/gi)].slice(0, 3);
  for (const use of uses) {
    const value = completeRuleValue(body, use.index ?? 0, use[0]);
    standards.principalUses.push(value.replace(/\s+/g, ' ').trim());
    cite(value);
  }

  if (/\bsingle[- ]family\s+(?:dwelling|residence|home)\b/i.test(body)) standards.residentialEligible = true;
  const manufactured = /\bmanufactured\s+home\b|\bmobile\s+home\b/i.exec(body);
  if (manufactured) {
    const window = body.slice(Math.max(0, manufactured.index - 160), manufactured.index + 200);
    standards.manufacturedHomeEligible = !/\b(?:not\s+permitted|prohibited|shall\s+not\s+be\s+(?:permitted|allowed))\b/i.test(window);
    cite(window);
  }
  for (const condition of [...body.matchAll(/\b(?:provided\s+that|subject\s+to|except\s+that)\b[^.\n]{0,180}/gi)].slice(0, 3)) {
    standards.specialConditions.push(condition[0].replace(/\s+/g, ' ').trim());
  }

  // The prose rules read Euclidean ordinances. When the document is a
  // form-based district TABLE they match nothing, because the rows never say
  // "minimum" — so the table reader fills whatever is still unanswered. Prose
  // wins where both speak, since a sentence carries its own qualifiers.
  // District scoping narrows to the district's prose section, which in a
  // form-based code is a different place from its standards TABLE. So the
  // table reader gets the scoped body first and the whole document second.
  let tabular = readFormBasedDistrictStandards({
    text: body, sourceLabel: input.sourceLabel, sourceUrl: input.sourceUrl,
  });
  if (!tabular.sources.length && body !== text) {
    tabular = readFormBasedDistrictStandards({
      text, sourceLabel: input.sourceLabel, sourceUrl: input.sourceUrl,
    });
  }
  for (const key of ['minimumLotSize', 'density', 'setbacks', 'frontage', 'lotWidth', 'heightOrCoverage'] as const) {
    if (!standards[key] && tabular[key]) standards[key] = tabular[key];
  }
  if (tabular.sources.length) standards.sources.push(...tabular.sources);

  return standards;
}


/**
 * A planning PACKET is not a zoning record, whatever it prints.
 *
 * A live run made this urgent: the retained City of Fairview planning packet
 * says "Current Zoning: R-20 POD" beside this parcel's APN, and the reader
 * classified it as a parcel-specific planning record — so the race released a
 * 2024 agenda item as the 2026 district in one millisecond. It was official, it
 * was parcel-matched, and it was wrong, which is the exact failure mode this
 * whole layer exists to prevent.
 *
 * So the document's own identity decides its evidence kind:
 *   • a zoning MAP or a parcel/zoning RECORD speaks for today;
 *   • a packet, agenda, minute book, staff report or resolution is HISTORY,
 *     however recent and however precisely it names the parcel;
 *   • anything else keeps whatever the reader inferred.
 */
export function classifyZoningDocument(document: { url: string; title: string | null; text: string }): ZoningEvidenceKind | null {
  const label = `${document.title ?? ''} ${document.url}`;
  if (/zoning[\s_-]*map/i.test(label)) return 'official_zoning_map';
  if (/property[\s_-]*record|parcel[\s_-]*record|zoning[\s_-]*(?:lookup|verification|certificate)/i.test(label)) {
    return 'planning_or_property_record';
  }
  const head = `${label} ${document.text.slice(0, 1_500)}`;
  if (/packet|minutes|agenda|staff\s+report|planning\s+commission|board\s+of\s+(?:mayor|commissioners)|PC\s*Resolution|boc-packets/i.test(head)) {
    return 'historical_planning_document';
  }
  return null;
}

// ── The runner ──────────────────────────────────────────────────────────────

export interface CurrentZoningSubject {
  dealCardId: number;
  apn: string | null;
  address: string | null;
  municipality: string | null;
  county: string | null;
  state: string | null;
  /** Only a parcel-derived point, with its basis. Never a ZIP centroid. */
  point?: { lat: number; lng: number; basis: string } | null;
  /** Everything the confirmed subject can put into a search query. */
  queryFacts?: Partial<SubjectQueryFacts>;
}

export interface CurrentZoningDeps {
  /** Zoning layers already discovered for this authority. Queried directly. */
  gisQueries?: readonly ZoningGisQuery[];
  arcgis?: ArcgisDiscoveryDeps;
  /** Discovery only. A search result never establishes a district. */
  search?: IdentitySearchProvider;
  fetchText?: GovFetchText;
  /** Extra official pages the caller already knows about. */
  knownSourceUrls?: readonly string[];
  /** Zoning evidence LandOS already persisted for this parcel. */
  retainedSources?: ReadonlyArray<{ url: string | null; title: string | null; text: string }>;
  /** Ordinance text already retrieved, for the standards read. */
  ordinanceText?: { text: string; label: string; url: string | null } | null;
  /** Escalation seam for an interactive zoning viewer. */
  browser?: BrowserSourceReader | null;
  awaitEnrichment?: boolean;
  deadlineMs?: number;
  onLaneSettled?: (record: LandUseLaneRecord) => void;
  maxPages?: number;
  timeoutMs?: number;
  now?: () => string;
}

/**
 * Read a district off an official planning/property page for THIS parcel.
 *
 * Requires the page to name the parcel — by APN or by the exact address — in the
 * same passage as the zoning statement. A district printed on a page that never
 * names this parcel is the jurisdiction's zoning, not this property's.
 */
export function readZoningFromOfficialPage(input: {
  text: string;
  sourceLabel: string;
  sourceUrl: string;
  sourceTier: AuthoritySourceTier;
  apn: string | null;
  address: string | null;
  retrievedAt: string;
}): ZoningEvidenceCandidate | null {
  const body = input.text.replace(/\s+/g, ' ');
  const anchors: Array<{ label: string; pattern: RegExp }> = [];
  if (input.apn) {
    const compact = input.apn.replace(/[^0-9A-Za-z]/g, '');
    if (compact.length >= 5) {
      anchors.push({ label: `APN ${input.apn}`, pattern: new RegExp(compact.split('').join('[^0-9A-Za-z]?'), 'i') });
    }
  }
  if (input.address && input.address.trim().length >= 6) {
    anchors.push({
      label: `address ${input.address}`,
      pattern: new RegExp(input.address.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i'),
    });
  }
  const anchor = anchors.find((row) => row.pattern.test(body));
  if (!anchor) return null;

  const zoning = /\bzoning\s*(?:district|classification|code)?\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9\- /]{0,38})/i.exec(body)
    ?? /\bzoned\s+([A-Za-z]{1,3}-?\d{0,3}[A-Za-z]?)\b/i.exec(body);
  if (!zoning) return null;
  const value = zoning[1].trim().replace(/\s+/g, ' ');
  if (!value || /^(?:district|classification|code|information|map)$/i.test(value)) return null;

  const at = zoning.index;
  return {
    kind: 'planning_or_property_record',
    districtCode: value,
    districtName: null,
    overlays: [],
    parcelMatchBasis: `the page names this parcel by ${anchor.label} in the same record as the zoning statement`,
    sourceLabel: input.sourceLabel,
    sourceUrl: input.sourceUrl,
    sourceTier: input.sourceTier,
    effectiveOrAsOf: null,
    quote: body.slice(Math.max(0, at - 160), at + 220),
    retrievedAt: input.retrievedAt,
  };
}

export function buildZoningDiscoveryQueries(subject: CurrentZoningSubject, limit = 3): string[] {
  const place = [subject.municipality, subject.state].filter(Boolean).join(' ');
  const county = subject.county ? `${subject.county.replace(/\s+county$/i, '')} County ${subject.state ?? ''}`.trim() : '';
  return [...new Set([
    place ? `${place} official zoning map GIS parcel zoning lookup` : '',
    subject.apn && county ? `${county} parcel ${subject.apn} zoning` : '',
    place ? `${place} zoning ordinance district regulations` : '',
    county ? `${county} zoning map GIS` : '',
  ].filter(Boolean))].slice(0, Math.max(1, limit));
}

/**
 * Determine the CURRENT zoning district for this parcel, or report unresolved.
 *
 * Order of work: direct GIS query (cheapest and strongest), then official pages
 * the caller or search surfaced. Historical references are attached but can
 * never be selected. When nothing current and official names this parcel, the
 * determination is honestly `unresolved` rather than a guess from the packets.
 */
export async function determineCurrentZoning(
  subject: CurrentZoningSubject,
  authority: AuthorityAssignment | null,
  deps: CurrentZoningDeps = {},
): Promise<CurrentZoningDetermination> {
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const fetchText = deps.fetchText ?? defaultGovFetchText;
  const maxPages = Math.max(1, deps.maxPages ?? 4);
  const timeoutMs = Math.max(1_000, deps.timeoutMs ?? 20_000);
  const limitations: string[] = [];

  const jurisdiction: LaneJurisdiction = {
    municipality: subject.municipality,
    county: subject.county,
    state: subject.state,
    controllingAuthorityName: authority?.name ?? null,
  };
  const transports: RetrievalTransports = { fetchText, timeoutMs, now: () => now };

  const toEvidence = (candidate: ZoningEvidenceCandidate): LandUseEvidence<ZoningEvidenceCandidate> => ({
    method: 'official_document',
    laneId: 'zoning',
    value: candidate,
    authorityName: authority?.name ?? null,
    sourceLabel: candidate.sourceLabel,
    sourceUrl: candidate.sourceUrl,
    sourceTier: candidate.sourceTier,
    parcelMatchBasis: candidate.parcelMatchBasis,
    currentness: candidate.kind === 'historical_planning_document' ? 'historical' : 'current',
    effectiveOrAsOf: candidate.effectiveOrAsOf,
    quote: candidate.quote,
    retrievedAt: candidate.retrievedAt,
  });

  /** A district read off a document or page that names THIS parcel. */
  const readDocument: EvidenceReader<ZoningEvidenceCandidate> = (document) => {
    const candidate = readZoningFromOfficialPage({
      text: document.text,
      sourceLabel: document.title ?? document.url,
      sourceUrl: document.url,
      sourceTier: document.tier,
      apn: subject.apn,
      address: subject.address,
      retrievedAt: document.retrievedAt,
    });
    if (!candidate) return [];
    return [toEvidence({ ...candidate, kind: classifyZoningDocument(document) ?? candidate.kind })];
  };

  // ── The lanes ─────────────────────────────────────────────────────────────
  const lanes: Array<LandUseLane<ZoningEvidenceCandidate, LaneJurisdiction>> = [];

  if (deps.retainedSources?.length) {
    lanes.push(retainedEvidenceLane<ZoningEvidenceCandidate>({
      id: 'retained_zoning',
      label: 'Retained zoning evidence',
      sources: deps.retainedSources.map((row) => ({ ...row, tier: 'official_government_source' as const })),
      jurisdiction,
      read: readDocument,
      now: () => now,
    }));
  }

  // ALWAYS declared, even with nothing to query. A jurisdiction with no ArcGIS
  // presence must appear in the timing report as a method that was attempted
  // and found nothing, not as a method that silently did not exist.
  lanes.push(directApiLane<ZoningEvidenceCandidate>({
    id: 'zoning_gis',
    label: "The authority's own zoning layer (ArcGIS REST)",
    query: async () => {
      if (!(deps.gisQueries ?? []).length) {
        limitations.push('No parcel-specific zoning GIS layer was discovered for this authority, so that lane had nothing to query. Discovery continued on every other method.');
        return [];
      }
      // Every layer is queried CONCURRENTLY. Serially, a jurisdiction with
      // four services paid four round trips before the web lane even ran.
      const found = await Promise.all((deps.gisQueries ?? []).map((query) =>
        readZoningFromGisLayer(query, { ...(deps.arcgis ?? {}), now: () => now }).catch(() => null)));
      return found.filter((row): row is ZoningEvidenceCandidate => row != null).map(toEvidence);
    },
  }));

  if (deps.knownSourceUrls?.length) {
    lanes.push(directSourceLane<ZoningEvidenceCandidate>({
      id: 'known_zoning_pages',
      label: 'Known official zoning pages and documents',
      urls: deps.knownSourceUrls,
      jurisdiction,
      read: readDocument,
      transports,
      maxSources: maxPages,
    }));
  }

  if (deps.search) {
    const facts: SubjectQueryFacts = {
      apn: subject.apn,
      parcelNotation: null,
      owner: null,
      projectName: null,
      address: subject.address,
      municipality: subject.municipality,
      county: subject.county,
      state: subject.state,
      ...(subject.queryFacts ?? {}),
    };
    lanes.push(indexedWebSearchLane<ZoningEvidenceCandidate>({
      id: 'zoning_web',
      label: 'Indexed web discovery (governed keyless search)',
      queries: buildLandUseQueries({
        subject: facts,
        topic: 'zoning',
        variants: ['zoning map', 'zoning map PDF', 'current zoning map', 'GIS zoning', 'zoning ordinance district'],
      }),
      jurisdiction,
      search: deps.search,
      read: readDocument,
      transports,
      maxSources: maxPages,
      preferUrls: /zoning[\s_-]*map|parcel|property[\s_-]*record|gis|\.pdf/i,
      followLinks: /zoning|map|ordinance/i,
      onNote: (note) => limitations.push(note),
    }));
  } else {
    limitations.push('No search transport was wired, so indexed web discovery did not run for current zoning.');
  }

  lanes.push(browserEscalationLane<ZoningEvidenceCandidate>({
    id: 'zoning_browser',
    label: 'Browser escalation (interactive zoning viewer)',
    urls: deps.knownSourceUrls ?? [],
    purpose: `read the zoning district covering parcel ${subject.apn ?? subject.address ?? 'the subject'}`,
    jurisdiction,
    read: readDocument,
    browser: deps.browser ?? null,
    onNote: (note) => limitations.push(note),
    now: () => now,
  }));

  const race = await raceLandUseSources<ZoningEvidenceCandidate, LaneJurisdiction>({
    question: 'current_zoning',
    aim: jurisdiction,
    lanes,
    instantFastPath: true,
    deadlineMs: deps.deadlineMs ?? 60_000,
    gate: (candidate) => {
      const verdict = selectCurrentZoning([candidate.value]);
      return verdict.selected
        ? { sufficient: true, reason: `established from ${candidate.value.kind.replace(/_/g, ' ')}` }
        : { sufficient: false, reason: verdict.considered[0]?.note ?? 'the candidate did not pass the current-zoning evidence rules' };
    },
    sameAnswer: (a, b) => normalizeCode(a.districtCode ?? a.districtName) === normalizeCode(b.districtCode ?? b.districtName),
    onLaneSettled: (record) => deps.onLaneSettled?.(record),
  });

  const candidates: ZoningEvidenceCandidate[] = race.evidence.map((row) => row.value);
  if (deps.awaitEnrichment !== false) {
    const enrichment = await race.enrichment;
    for (const row of enrichment.lateEvidence) candidates.push(row.value);
    limitations.push(...enrichment.conflicts);
  }
  limitations.push(...race.notes);

  const selection = selectCurrentZoning(candidates);
  const standards = deps.ordinanceText
    ? readZoningStandards({
        text: deps.ordinanceText.text,
        districtCode: selection.selected?.districtCode ?? null,
        sourceLabel: deps.ordinanceText.label,
        sourceUrl: deps.ordinanceText.url,
      })
    : emptyZoningStandards();
  if (!deps.ordinanceText) {
    limitations.push('No current ordinance text was supplied to this call; dimensional standards and allowed uses are researched by their own source race.');
  }

  if (!selection.selected) {
    limitations.push(
      'CURRENT zoning is UNRESOLVED. No current, parcel-specific, official source established the district. '
      + 'Historical planning statements are retained below and are explicitly NOT the current district.',
    );
  }

  return {
    dealCardId: subject.dealCardId,
    established: !!selection.selected,
    districtCode: selection.selected?.districtCode ?? null,
    districtName: selection.selected?.districtName ?? null,
    overlays: selection.selected?.overlays ?? [],
    authorityName: authority?.name ?? null,
    authorityDetermination: authority?.determination ?? 'not_supplied',
    evidenceKind: selection.selected?.kind ?? null,
    sourceLabel: selection.selected?.sourceLabel ?? null,
    sourceUrl: selection.selected?.sourceUrl ?? null,
    parcelMatchBasis: selection.selected?.parcelMatchBasis ?? null,
    effectiveOrAsOf: selection.selected?.effectiveOrAsOf ?? null,
    verifiedAt: now,
    confidence: selection.confidence,
    conflicts: selection.conflicts,
    historicalReferences: [],
    requestedZoning: [],
    standards,
    limitations: [...new Set(limitations)],
    consideredEvidence: selection.considered,
    race: raceRecordOf(race),
  };
}

/**
 * Attach the backstory's dated zoning statements WITHOUT letting them establish
 * anything. Kept as its own step so the separation is visible at the call site.
 */
export function attachHistoricalZoning(
  determination: CurrentZoningDetermination,
  references: readonly BackstoryZoningReference[],
): CurrentZoningDetermination {
  const historical = references.filter((row) => row.kind !== 'requested');
  const requested = references.filter((row) => row.kind === 'requested');
  const limitations = [...determination.limitations];
  if (historical.length && !determination.established) {
    limitations.push(
      `${historical.length} historical zoning statement(s) exist in the planning record and were NOT used to establish current zoning. `
      + 'They state what the document said on its own date.',
    );
  }
  return { ...determination, historicalReferences: historical, requestedZoning: requested, limitations: [...new Set(limitations)] };
}
