// LandOS — RULE EXTRACTION from adopted law.
//
// Every function here turns retrieved ordinance or statute text into evidenced
// values. They share three non-negotiable properties:
//
//   1. A value is produced ONLY when the text says it. There is no default, no
//      "counties usually", and no completion from a similar jurisdiction.
//   2. Every value carries the verbatim excerpt and the section it came from,
//      so an operator can check the conclusion against the source in one click.
//   3. Absence produces an explicit unresolved reason naming what was searched.
//
// The extractors are pure: text in, evidenced values out. That is what lets
// them be tested against real captured provisions without any network.

import {
  buildCitation,
  findProvisions,
  boundExcerpt,
  type ProvisionMatch,
} from './land-use-evidence.js';
import type { OrdinanceDocument, OrdinanceTopic } from './land-use-ordinance.js';
import {
  evidencedValue,
  provisionalValue,
  unresolvedValue,
  type DimensionalStandard,
  type DimensionalStandardKind,
  type EvidencedValue,
  type LegalSourceCitation,
  type ObjectiveCondition,
  type ObjectiveConditionKind,
  type SourceAuthorityTier,
  type StructureType,
  type SubdivisionPath,
  type SubdivisionPathKind,
  type UseLegalStatus,
} from './land-use-types.js';

/* ─────────────────────────── shared plumbing ─────────────────────────── */

export interface ProvisionHit {
  document: OrdinanceDocument;
  match: ProvisionMatch;
}

/**
 * The exact clause a pattern matched inside a windowed excerpt.
 *
 * `findProvisions` deliberately returns a WINDOW around each match so an
 * operator reads the provision in context. That window is the wrong input for
 * parsing, and getting this wrong produced two real defects during this
 * sprint's tests: a lot-width clause parsed the acreage from the neighbouring
 * sentence, and a permission clause for one structure type picked up the
 * prohibition attached to a different one. Parsing therefore always runs on the
 * narrow clause; the window is for the human.
 */
export function narrowClause(excerpt: string, pattern: RegExp): string {
  const rx = new RegExp(pattern.source, pattern.flags.replace(/g/g, ''));
  const match = rx.exec(excerpt);
  if (!match) return excerpt;
  const start = match.index;
  // Run to the end of the sentence the match starts in, so a full requirement
  // survives while the neighbouring one does not bleed in.
  const rest = excerpt.slice(start);
  const end = rest.search(/[.;](?:\s|$)/);
  return end === -1 ? rest : rest.slice(0, end + 1);
}

/** Search a document set, best-topic first, and return matches with provenance. */
export function searchProvisions(
  documents: readonly OrdinanceDocument[],
  pattern: RegExp,
  options: { topics?: readonly OrdinanceTopic[]; maxPerDoc?: number; maxTotal?: number } = {},
): ProvisionHit[] {
  const scoped = options.topics?.length
    ? documents.filter((doc) => options.topics!.includes(doc.topic))
    : documents;
  const hits: ProvisionHit[] = [];
  for (const document of scoped) {
    for (const match of findProvisions(document.text, pattern, { maxMatches: options.maxPerDoc ?? 3 })) {
      hits.push({ document, match });
      if (hits.length >= (options.maxTotal ?? 8)) return hits;
    }
  }
  return hits;
}

export function citationFor(hit: ProvisionHit, retrievedAt: string, tierHint?: SourceAuthorityTier, effectiveDate?: string | null): LegalSourceCitation {
  return buildCitation({
    url: hit.document.url,
    label: hit.document.title,
    citation: hit.match.section ?? hit.document.section,
    excerpt: hit.match.excerpt,
    format: 'html',
    effectiveDate: effectiveDate ?? null,
    tierHint,
    retrievedAt,
  });
}

/* ───────────────────────────── number parsing ────────────────────────── */

const WORD_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, twentyfive: 25,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventyfive: 75, hundred: 100,
};

/**
 * Read a count from legal prose.
 *
 * Ordinances write numbers three ways in the same sentence — "four (4) lots",
 * "4 lots", "four lots" — and the parenthesized digit is authoritative when
 * both appear, because that is the drafting convention the digit exists for.
 */
export function parseLegalNumber(text: string): number | null {
  const parenthesized = text.match(/\b([a-z]+)\s*\((\d+(?:\.\d+)?)\)/i);
  if (parenthesized) return Number(parenthesized[2]);
  const digits = text.match(/\b(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\b/);
  if (digits) return Number(digits[1].replace(/,/g, ''));
  const word = text.toLowerCase().match(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty)\b/);
  if (word) return WORD_NUMBERS[word[1]] ?? null;
  return null;
}

export interface MeasuredValue {
  numeric: number | null;
  unit: DimensionalStandard['unit'];
  stated: string;
}

/** Pull a measurement and its unit out of a clause, keeping the stated form. */
export function parseMeasurement(clause: string): MeasuredValue | null {
  const acres = clause.match(/(\d+(?:\.\d+)?|\b[a-z]+\s*\(\d+(?:\.\d+)?\))\s*(?:-|\s)?acres?\b/i);
  if (acres) {
    const numeric = parseLegalNumber(acres[0]);
    return { numeric, unit: 'acres', stated: acres[0].replace(/\s+/g, ' ').trim() };
  }
  const sqft = clause.match(/(\d{1,3}(?:,\d{3})*|\d+)\s*(?:square\s*feet|sq\.?\s*ft\.?|sf)\b/i);
  if (sqft) {
    return { numeric: Number(sqft[1].replace(/,/g, '')), unit: 'square_feet', stated: sqft[0].replace(/\s+/g, ' ').trim() };
  }
  // Ordinances write "one hundred (100) feet", so the closing parenthesis sits
  // between the authoritative digit and its unit.
  const feet = clause.match(/(\d{1,4}(?:\.\d+)?)\s*\)?\s*(?:linear\s*)?(?:feet|foot|ft\.?)\b/i);
  if (feet) {
    return { numeric: Number(feet[1]), unit: 'feet', stated: feet[0].replace(/\s+/g, ' ').trim() };
  }
  const percent = clause.match(/(\d{1,3}(?:\.\d+)?)\s*(?:percent|%)/i);
  if (percent) {
    return { numeric: Number(percent[1]), unit: 'percent', stated: percent[0].replace(/\s+/g, ' ').trim() };
  }
  return null;
}

/* ────────────────────────── zoning presence ──────────────────────────── */

/**
 * Statements that a jurisdiction does NOT zone.
 *
 * This is not a fallback for "we found no zoning chapter". It matches an
 * affirmative official statement, because the two are completely different
 * facts: "the county says it has no zoning" is a verified conclusion, while
 * "LandOS did not find a zoning chapter" is an unresolved search.
 */
const NO_ZONING_PATTERN =
  /\b(?:has|have|there\s+(?:is|are))\s+no\s+(?:county[- ]?wide\s+|countywide\s+)?zoning\b|\bno\s+zoning\s+(?:regulations?|ordinance|districts?|requirements?)\b|\b(?:is|are)\s+not\s+zoned\b|\bunzoned\b|\bdoes\s+not\s+(?:have|enforce|administer)\s+(?:a\s+)?zoning\b/i;

export interface ZoningPresenceFinding {
  /** True only for an affirmative official statement of no zoning. */
  statesNoZoning: boolean;
  /** True when a real zoning chapter with districts was located. */
  statesZoning: boolean;
  hits: ProvisionHit[];
}

/**
 * The apparatus a jurisdiction that zones necessarily publishes.
 *
 * Requiring the district-establishing clause alone is too narrow in practice:
 * a township's zoning ordinance is routinely a linked PDF while its website
 * plainly shows a zoning administrator, a zoning board of appeals and a zoning
 * permit process. That is the jurisdiction's own official evidence that it
 * zones, and it answers WHO zones. It deliberately does NOT establish the
 * parcel's district — that stays unverified until a zoning map or ordinance
 * says so, which is the distinction the whole engine turns on.
 */
const ZONING_APPARATUS_PATTERN =
  /\bzoning\s+(?:administrator|ordinance|board\s+of\s+appeals|commission|permit|map|enforcement\s+officer|department)\b|\bboard\s+of\s+zoning\s+appeals\b|\bzoning\s+district\b/i;

export function extractZoningPresence(documents: readonly OrdinanceDocument[]): ZoningPresenceFinding {
  const noZoning = searchProvisions(documents, NO_ZONING_PATTERN, { maxTotal: 4 });
  const districts = searchProvisions(
    documents,
    /\bzoning\s+districts?\s+(?:are\s+)?(?:hereby\s+)?(?:established|created|classified)\b|\bthe\s+following\s+zoning\s+districts?\b/i,
    { topics: ['zoning'], maxTotal: 3 },
  );
  const apparatus = districts.length
    ? []
    : searchProvisions(documents, ZONING_APPARATUS_PATTERN, { maxTotal: 3 });

  // An affirmative statement of NO zoning always wins. A jurisdiction that says
  // it does not zone is not made a zoning jurisdiction by the word "zoning"
  // appearing on the page that says so.
  return {
    statesNoZoning: noZoning.length > 0,
    statesZoning: noZoning.length === 0 && (districts.length > 0 || apparatus.length > 0),
    hits: [...noZoning, ...districts, ...apparatus],
  };
}

/* ──────────────────────── dimensional standards ──────────────────────── */

const DIMENSIONAL_PATTERNS: Array<{ kind: DimensionalStandardKind; pattern: RegExp; term: string }> = [
  { kind: 'minimum_lot_area', pattern: /minimum\s+(?:lot|parcel|tract)\s+(?:area|size)[^.;]{0,160}/gi, term: 'minimum lot area' },
  { kind: 'minimum_lot_width', pattern: /minimum\s+lot\s+width[^.;]{0,160}/gi, term: 'minimum lot width' },
  { kind: 'minimum_road_frontage', pattern: /minimum\s+(?:road|street|public\s+road|highway)\s+frontage[^.;]{0,160}|frontage\s+of\s+(?:not\s+less\s+than|at\s+least)[^.;]{0,140}/gi, term: 'minimum road frontage' },
  { kind: 'front_setback', pattern: /front\s+(?:yard\s+)?setback[^.;]{0,140}|minimum\s+front\s+yard[^.;]{0,140}/gi, term: 'front setback' },
  { kind: 'side_setback', pattern: /side\s+(?:yard\s+)?setback[^.;]{0,140}|minimum\s+side\s+yard[^.;]{0,140}/gi, term: 'side setback' },
  { kind: 'rear_setback', pattern: /rear\s+(?:yard\s+)?setback[^.;]{0,140}|minimum\s+rear\s+yard[^.;]{0,140}/gi, term: 'rear setback' },
  { kind: 'maximum_density', pattern: /maximum\s+density[^.;]{0,140}|dwelling\s+units?\s+per\s+acre[^.;]{0,120}/gi, term: 'maximum density' },
  { kind: 'maximum_lot_coverage', pattern: /(?:maximum\s+)?lot\s+coverage[^.;]{0,140}/gi, term: 'maximum lot coverage' },
  { kind: 'maximum_height', pattern: /maximum\s+(?:building\s+)?height[^.;]{0,140}|height\s+(?:shall\s+not\s+exceed)[^.;]{0,120}/gi, term: 'maximum height' },
  { kind: 'minimum_dwelling_size', pattern: /minimum\s+(?:dwelling|heated|floor|living)\s+(?:unit\s+)?(?:area|size|space)[^.;]{0,160}/gi, term: 'minimum dwelling size' },
];

/**
 * Pull every dimensional standard the retrieved text actually states.
 *
 * A standard with no parseable measurement is still returned, with
 * `numericValue: null` and the stated text intact. That matters: "minimum lot
 * area shall be determined by the health department" is a real standard, and
 * dropping it because it has no number would tell the operator nothing exists.
 */
export function extractDimensionalStandards(
  documents: readonly OrdinanceDocument[],
  retrievedAt: string,
  effectiveDate: string | null = null,
): DimensionalStandard[] {
  const standards: DimensionalStandard[] = [];
  const seen = new Set<string>();

  for (const spec of DIMENSIONAL_PATTERNS) {
    const hits = searchProvisions(documents, spec.pattern, { topics: ['zoning', 'subdivision', 'buildings_and_development'], maxTotal: 3 });
    for (const hit of hits) {
      // Parse the CLAUSE, not the window. A neighbouring sentence's acreage is
      // not this standard's value.
      const clause = narrowClause(hit.match.excerpt, spec.pattern);
      const measurement = parseMeasurement(clause);
      const key = `${spec.kind}::${measurement?.stated ?? clause.slice(0, 60)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      standards.push({
        kind: spec.kind,
        originalTerm: spec.term,
        statedValue: measurement?.stated ?? boundExcerpt(clause) ?? spec.term,
        numericValue: measurement?.numeric ?? null,
        unit: measurement?.unit ?? null,
        citation: citationFor(hit, retrievedAt, 'zoning_ordinance', effectiveDate),
        qualifier: /unless|except|provided that|where\s+(?:public|community)\s+(?:sewer|water)/i.test(clause)
          ? 'The provision states an exception or condition; read the cited section in full.'
          : null,
      });
    }
  }
  return standards;
}

/* ───────────────────────── subdivision extraction ────────────────────── */

const PATH_PATTERNS: Array<{ kind: SubdivisionPathKind; pattern: RegExp; term: string }> = [
  { kind: 'minor_subdivision', pattern: /minor\s+subdivision[^.;]{0,220}/gi, term: 'minor subdivision' },
  { kind: 'administrative_subdivision', pattern: /administrative\s+(?:subdivision|plat|review|division)[^.;]{0,220}/gi, term: 'administrative subdivision' },
  { kind: 'exempt_split', pattern: /(?:exempt|exemption)\s+(?:from\s+)?(?:the\s+)?(?:subdivision|plat)[^.;]{0,220}|shall\s+not\s+(?:be\s+)?(?:constitute|deemed)\s+a\s+subdivision[^.;]{0,220}/gi, term: 'exempt split' },
  { kind: 'land_division', pattern: /land\s+division[^.;]{0,220}/gi, term: 'land division' },
  { kind: 'lot_line_adjustment', pattern: /lot\s+line\s+(?:adjustment|revision)[^.;]{0,200}/gi, term: 'lot line adjustment' },
  { kind: 'family_division', pattern: /family\s+(?:division|transfer|conveyance)[^.;]{0,200}/gi, term: 'family division' },
  { kind: 'major_subdivision', pattern: /major\s+subdivision[^.;]{0,220}/gi, term: 'major subdivision' },
  { kind: 'resubdivision', pattern: /re-?subdivision[^.;]{0,200}/gi, term: 'resubdivision' },
];

/** Approvals that make a path discretionary. Their presence defeats by-right. */
const DISCRETIONARY_PATTERN =
  /\b(rezon\w+|variance|special\s+(?:use|exception)|conditional\s+use|special\s+permit|discretionary|legislative\s+approval|board\s+of\s+(?:zoning\s+)?appeals)\b/gi;

/**
 * Approvals that are objective. Their presence does NOT defeat by-right —
 * that is the distinction PART 8 turns on, and collapsing it would let a
 * routine plat requirement read as an entitlement risk.
 */
const OBJECTIVE_APPROVAL_PATTERN =
  /\b(plat|survey|surveyor|recording|record(?:ed|ation)|septic\s+permit|health\s+department\s+approval|driveway\s+permit|access\s+permit|administrative\s+review|staff\s+review|erosion\s+control)\b/gi;

function distinctMatches(text: string, pattern: RegExp, cap = 6): string[] {
  const rx = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  const out = new Set<string>();
  for (let m = rx.exec(text); m && out.size < cap; m = rx.exec(text)) {
    out.add(m[0].toLowerCase().replace(/\s+/g, ' ').trim());
    if (rx.lastIndex === m.index) rx.lastIndex += 1;
  }
  return [...out];
}

/**
 * Find the lot cap a procedure states.
 *
 * Only counted when the sentence ties a number to LOTS and to a limiting word.
 * "four or fewer lots" is a cap; "Section 4 lots" is not, and a looser pattern
 * reads the second as the first.
 */
export function extractLotCap(clause: string): number | null {
  const capped = clause.match(
    /\b(?:not\s+more\s+than|no\s+more\s+than|fewer\s+than|less\s+than|maximum\s+of|up\s+to|containing)\s+([a-z]+\s*\(\d+\)|\d+)\s+(?:or\s+fewer\s+)?(?:lots?|parcels?|tracts?|divisions?)/i,
  ) ?? clause.match(/\b([a-z]+\s*\(\d+\)|\d+|[a-z]+)\s+(?:or\s+fewer|or\s+less)\s+(?:lots?|parcels?|tracts?)/i);
  if (!capped) return null;
  return parseLegalNumber(capped[1]);
}

export function extractSubdivisionPaths(
  documents: readonly OrdinanceDocument[],
  retrievedAt: string,
  effectiveDate: string | null = null,
): SubdivisionPath[] {
  const paths: SubdivisionPath[] = [];

  for (const spec of PATH_PATTERNS) {
    const hits = searchProvisions(documents, spec.pattern, { topics: ['subdivision', 'buildings_and_development', 'zoning', 'general'], maxTotal: 3 });
    if (!hits.length) continue;

    const citations = hits.map((hit) => citationFor(hit, retrievedAt, 'subdivision_ordinance', effectiveDate));
    const combined = hits.map((hit) => hit.match.excerpt).join(' ');

    const cap = hits.map((hit) => extractLotCap(hit.match.excerpt)).find((value) => value != null) ?? null;
    const capHit = hits.find((hit) => extractLotCap(hit.match.excerpt) != null);

    const discretionary = distinctMatches(combined, DISCRETIONARY_PATTERN);
    const objective = distinctMatches(combined, OBJECTIVE_APPROVAL_PATTERN);

    // A major subdivision is by definition the discretionary path; nothing
    // else is assumed to be discretionary without the ordinance saying so.
    const isByRight = spec.kind !== 'major_subdivision' && discretionary.length === 0;

    const reviewPath: SubdivisionPath['reviewPath'] =
      /planning\s+commission/i.test(combined) && /administrative|staff/i.test(combined) ? 'combined_administrative_and_commission'
        : /planning\s+commission/i.test(combined) ? 'planning_commission_review'
          : /board\s+of\s+(?:commissioners|supervisors|trustees)|governing\s+(?:body|board)/i.test(combined) ? 'governing_board_review'
            : /administrative|staff\s+review|zoning\s+administrator|county\s+(?:engineer|manager)/i.test(combined) ? 'administrative_staff_review'
              : 'unresolved';

    paths.push({
      kind: spec.kind,
      originalTerm: spec.term,
      definition: evidencedValue(boundExcerpt(hits[0].match.excerpt) ?? spec.term, [citations[0]]),
      maximumLots: cap != null && capHit
        ? evidencedValue(cap, [citationFor(capHit, retrievedAt, 'subdivision_ordinance', effectiveDate)])
        : unresolvedValue(`The ordinance text LandOS read does not state a lot cap for the ${spec.term} procedure.`),
      maximumLotsWithoutNewRoad: /without\s+(?:the\s+)?(?:creation|construction|dedication)\s+of\s+(?:a\s+)?new\s+(?:street|road)/i.test(combined) && cap != null && capHit
        ? provisionalValue(cap, [citationFor(capHit, retrievedAt, 'subdivision_ordinance', effectiveDate)],
          'The cap and the no-new-road condition appear in the same procedure; confirm they attach to one another in the cited section.')
        : unresolvedValue('No separate cap tied to avoiding a new road was stated in the text LandOS read.'),
      acreageThreshold: /(\d+(?:\.\d+)?)\s*acres?/i.test(combined) && parseMeasurement(combined)
        ? provisionalValue(parseMeasurement(combined)!.stated, citations, 'An acreage figure appears in this procedure; confirm it is a threshold rather than a lot minimum.')
        : unresolvedValue('No acreage threshold for this procedure was stated in the text LandOS read.'),
      reviewPath,
      isByRight,
      discretionaryApprovals: discretionary,
      objectiveApprovals: objective,
      citations,
    });
  }
  return paths;
}

/* ─────────────────────────── parent tract rules ──────────────────────── */

export interface ParentTractExtraction {
  applies: boolean;
  hits: ProvisionHit[];
  lookbackClause: string | null;
  parentDefinitionClause: string | null;
  remainderClause: string | null;
}

const PARENT_TRACT_PATTERN =
  /parent\s+(?:tract|parcel|property)[^.;]{0,220}|original\s+tract[^.;]{0,200}|previously\s+(?:divided|subdivided)[^.;]{0,200}|prior\s+division[^.;]{0,200}/gi;
const LOOKBACK_PATTERN =
  /within\s+(?:the\s+)?(?:preceding|previous|last|past)\s+[^.;]{0,120}|(?:in|during)\s+any\s+(?:consecutive\s+)?(?:\d+|[a-z]+)[- ]?(?:year|month)\s+period[^.;]{0,140}|since\s+(?:the\s+)?(?:effective\s+date|[A-Z][a-z]+\s+\d{1,2},?\s+\d{4})[^.;]{0,140}/gi;
const REMAINDER_PATTERN = /remainder\s+(?:parcel|tract|lot)[^.;]{0,200}|residue[^.;]{0,160}/gi;

export function extractParentTract(documents: readonly OrdinanceDocument[]): ParentTractExtraction {
  const hits = searchProvisions(documents, PARENT_TRACT_PATTERN, { maxTotal: 5 });
  const lookback = searchProvisions(documents, LOOKBACK_PATTERN, { topics: ['subdivision', 'buildings_and_development', 'general'], maxTotal: 3 });
  const remainder = searchProvisions(documents, REMAINDER_PATTERN, { maxTotal: 2 });
  return {
    applies: hits.length > 0 || lookback.length > 0,
    hits: [...hits, ...lookback, ...remainder],
    lookbackClause: lookback[0]?.match.excerpt ?? null,
    parentDefinitionClause: hits[0]?.match.excerpt ?? null,
    remainderClause: remainder[0]?.match.excerpt ?? null,
  };
}

/* ──────────────────────── frontage / access rules ────────────────────── */

export interface AccessRuleExtraction {
  frontage: ProvisionHit[];
  publicRoadRequired: ProvisionHit[];
  flagLots: ProvisionHit[];
  sharedDrives: ProvisionHit[];
  privateRoads: ProvisionHit[];
  newRoadTrigger: ProvisionHit[];
}

export function extractAccessRules(documents: readonly OrdinanceDocument[]): AccessRuleExtraction {
  return {
    frontage: searchProvisions(documents, /(?:road|street|highway)\s+frontage[^.;]{0,200}|frontage\s+on\s+(?:a\s+)?(?:public|county|state)[^.;]{0,180}/gi, { maxTotal: 4 }),
    // "fronting on an existing public road" and "frontage ... on a public road"
    // are the same requirement written two ways, so the article and any
    // intervening adjectives are spanned rather than enumerated.
    publicRoadRequired: searchProvisions(documents, /(?:front\w*|abut\w*)[^.;]{0,60}?\b(?:public|county|state|dedicated)\s+(?:road|street|highway)[^.;]{0,160}/gi, { maxTotal: 3 }),
    flagLots: searchProvisions(documents, /flag\s+lots?[^.;]{0,200}|panhandle\s+lots?[^.;]{0,200}|lots?\s+with\s+(?:a\s+)?stem[^.;]{0,160}/gi, { maxTotal: 3 }),
    sharedDrives: searchProvisions(documents, /(?:shared|common|joint)\s+(?:drive(?:way)?|access)[^.;]{0,200}/gi, { maxTotal: 3 }),
    privateRoads: searchProvisions(documents, /private\s+(?:road|street|drive)[^.;]{0,220}/gi, { maxTotal: 4 }),
    newRoadTrigger: searchProvisions(documents, /(?:creation|construction|dedication|extension)\s+of\s+(?:a\s+)?new\s+(?:public\s+)?(?:street|road)[^.;]{0,200}|requires?\s+(?:a\s+)?new\s+(?:street|road)[^.;]{0,180}/gi, { maxTotal: 3 }),
  };
}

/* ──────────────────── manufactured housing extraction ────────────────── */

/**
 * Text patterns for each structure type LandOS evaluates separately.
 *
 * Modular and manufactured are matched by DIFFERENT patterns and never share
 * one, because they are different legal categories: a modular home is built to
 * the state building code and a manufactured home to the federal HUD code, and
 * ordinances routinely permit one while restricting the other.
 */
const STRUCTURE_PATTERNS: Partial<Record<StructureType, RegExp>> = {
  site_built_single_family: /site[- ]built|stick[- ]built|conventional(?:ly)?\s+(?:built|constructed)\s+(?:home|dwelling|residence)|single[- ]family\s+(?:dwelling|residence|detached)/i,
  modular_home: /modular\s+(?:home|dwelling|unit|building)|industrialized\s+building/i,
  manufactured_single_wide: /single[- ]?wide|single[- ]section/i,
  manufactured_double_wide: /double[- ]?wide|doublewide|double[- ]section/i,
  manufactured_multi_section: /multi[- ]?section(?:al)?|triple[- ]?wide/i,
  pre_hud_mobile_home: /(?:prior\s+to|before)\s+(?:june\s+15,?\s*)?1976|pre-?1976|pre-?HUD/i,
  used_manufactured_home: /used\s+(?:manufactured|mobile)\s+home|second[- ]hand\s+(?:manufactured|mobile)\s+home/i,
  new_manufactured_home: /new\s+(?:manufactured|mobile)\s+home/i,
  manufactured_replacement_of_existing: /replace(?:ment)?\s+(?:of\s+)?(?:an?\s+)?(?:existing\s+)?(?:manufactured|mobile)\s+home/i,
  accessory_dwelling_unit: /accessory\s+dwelling\s+unit|\bADU\b|guest\s+(?:house|cottage)/i,
  multifamily: /multi[- ]?family|apartment\s+(?:building|house)|duplex|triplex/i,
  agricultural_use: /agricultur\w+\s+(?:use|purpose|operation)|bona\s+fide\s+(?:farm|agricultur)/i,
};

/** Words that make a provision a prohibition. */
const PROHIBITION_PATTERN = /\b(?:shall\s+not\s+be\s+(?:permitted|allowed|placed|located|erected)|(?:is|are)\s+prohibited|no\s+\w+\s+shall\s+be\s+(?:placed|located|permitted)|not\s+permitted\s+in)\b/i;
/** Words that make a provision a discretionary approval. */
const CONDITIONAL_PATTERN = /\b(?:special\s+(?:use|exception)\s+permit|conditional\s+use\s+permit|special\s+permit|upon\s+approval\s+of\s+the\s+(?:board|commission)|variance\s+required)\b/i;
/** Words that make a provision a by-right permission. */
const PERMISSION_PATTERN = /\b(?:shall\s+be\s+(?:permitted|allowed)|(?:is|are)\s+(?:permitted|allowed)|permitted\s+(?:use|by\s+right)|may\s+be\s+(?:placed|located|erected|permitted))\b/i;
/** Words that make a provision a lawful-nonconforming allowance only. */
const NONCONFORMING_PATTERN = /\b(?:lawful(?:ly)?\s+non-?conforming|existing\s+non-?conforming|grandfather\w*)\b/i;

const CONDITION_PATTERNS: Array<{ kind: ObjectiveConditionKind; pattern: RegExp }> = [
  { kind: 'minimum_lot_area', pattern: /minimum\s+lot\s+(?:area|size)[^.;]{0,140}/i },
  { kind: 'minimum_lot_width', pattern: /minimum\s+lot\s+width[^.;]{0,140}/i },
  { kind: 'minimum_road_frontage', pattern: /(?:road|street)\s+frontage[^.;]{0,140}/i },
  { kind: 'setbacks', pattern: /setback[^.;]{0,140}/i },
  { kind: 'minimum_dwelling_area', pattern: /minimum\s+(?:floor|heated|living)\s+(?:area|space)[^.;]{0,140}/i },
  { kind: 'minimum_unit_width', pattern: /(?:minimum\s+)?width\s+of\s+(?:not\s+less\s+than\s+)?\d+\s*(?:feet|ft)[^.;]{0,120}/i },
  { kind: 'foundation', pattern: /(?:permanent\s+)?foundation[^.;]{0,160}/i },
  { kind: 'permanent_affixation', pattern: /permanently\s+(?:affixed|attached)[^.;]{0,140}/i },
  { kind: 'skirting', pattern: /skirt(?:ing|ed)[^.;]{0,140}/i },
  { kind: 'roof_pitch', pattern: /roof\s+pitch[^.;]{0,140}|pitch\s+of\s+(?:the\s+)?roof[^.;]{0,120}/i },
  { kind: 'exterior_siding_material', pattern: /exterior\s+(?:siding|material|finish|covering)[^.;]{0,160}/i },
  { kind: 'porch', pattern: /porch[^.;]{0,120}/i },
  { kind: 'orientation', pattern: /orient(?:ation|ed)[^.;]{0,140}/i },
  // "the tongue and axles are removed" — the gear list and the verb are
  // routinely separated, so the pattern spans them rather than requiring them
  // to be adjacent.
  { kind: 'removal_of_transport_gear', pattern: /(?:tongue|hitch|axle|wheel)s?[^.;]{0,60}\bremoved\b[^.;]{0,100}|removal\s+of\s+(?:the\s+)?(?:towing|transport)[^.;]{0,140}/i },
  { kind: 'hud_label', pattern: /HUD\s+(?:label|seal|certification|code)[^.;]{0,160}/i },
  { kind: 'age_or_construction_year', pattern: /(?:manufactured|constructed|built)\s+(?:no\s+more\s+than|within|after|less\s+than)[^.;]{0,150}|not\s+(?:more\s+than|older\s+than)\s+\w+\s*\(?\d*\)?\s*years[^.;]{0,120}/i },
  { kind: 'appearance_standards', pattern: /appearance\s+(?:standard|criteria|requirement)[^.;]{0,160}|compatib\w+\s+with\s+(?:surrounding|adjacent)[^.;]{0,140}/i },
  { kind: 'installation_standards', pattern: /install(?:ation|ed)\s+(?:in\s+accordance|standard|requirement)[^.;]{0,160}/i },
  { kind: 'owner_occupancy', pattern: /owner[- ]occup\w+[^.;]{0,140}/i },
  { kind: 'replacement_restriction', pattern: /replace(?:ment|d)?[^.;]{0,30}(?:only|shall|may)[^.;]{0,140}/i },
  { kind: 'manufactured_home_park_distinction', pattern: /(?:manufactured|mobile)\s+home\s+park[^.;]{0,160}/i },
];

export interface StructureFinding {
  structureType: StructureType;
  status: UseLegalStatus;
  hits: ProvisionHit[];
  conditions: ObjectiveCondition[];
  reasoning: string;
}

/**
 * Classify one structure type against the retrieved text.
 *
 * The order of the tests is the whole design. A prohibition is checked before a
 * permission because ordinances routinely permit a category generally and then
 * exclude a subtype, and reading only the general clause would report the
 * excluded subtype as allowed — a false entitlement conclusion, which is the
 * single most expensive mistake this engine can make.
 */
export function classifyStructureStatus(
  structureType: StructureType,
  documents: readonly OrdinanceDocument[],
  retrievedAt: string,
  effectiveDate: string | null = null,
): StructureFinding {
  const pattern = STRUCTURE_PATTERNS[structureType];
  if (!pattern) {
    return { structureType, status: 'unverified', hits: [], conditions: [], reasoning: 'LandOS has no text pattern for this structure type.' };
  }

  const rx = new RegExp(`${pattern.source}[^.;]{0,260}`, 'gi');
  const hits = searchProvisions(documents, rx, {
    topics: ['zoning', 'manufactured_housing', 'buildings_and_development', 'subdivision', 'general'],
    maxTotal: 6,
  });
  if (!hits.length) {
    return {
      structureType,
      status: 'unverified',
      hits: [],
      conditions: [],
      reasoning: 'No provision addressing this structure type was located in the adopted law LandOS read.',
    };
  }

  // Each hit is judged on its OWN clause. Judging the joined window would let a
  // prohibition attached to one structure type decide the status of a different
  // one that merely appears in the same paragraph — which is exactly what a
  // zoning chapter looks like, and exactly the false conclusion that costs most.
  const clauses = hits.map((hit) => ({ hit, clause: narrowClause(hit.match.excerpt, pattern) }));

  const conditions: ObjectiveCondition[] = [];
  const seenConditions = new Set<ObjectiveConditionKind>();
  for (const spec of CONDITION_PATTERNS) {
    for (const { hit, clause } of clauses) {
      const match = clause.match(spec.pattern);
      if (!match || seenConditions.has(spec.kind)) continue;
      seenConditions.add(spec.kind);
      conditions.push({
        kind: spec.kind,
        requirement: boundExcerpt(match[0]) ?? match[0],
        citation: citationFor(hit, retrievedAt, 'zoning_ordinance', effectiveDate),
      });
      break;
    }
  }

  const verdicts = clauses.map(({ clause }) => classifyClause(clause, conditions.length > 0));
  const status = strongestVerdict(verdicts.map((verdict) => verdict.status));
  const reasoning = verdicts.find((verdict) => verdict.status === status)?.reasoning
    ?? 'Provisions mention this structure type but none states whether it is permitted, prohibited or requires discretionary approval.';

  return { structureType, status, hits, conditions, reasoning };
}

/**
 * Classify one clause.
 *
 * The prohibition test runs first and then yields to a conditional route when
 * the same clause supplies one. "Shall not be permitted except upon approval of
 * a special use permit" is a conditional use, not a prohibition, and reading it
 * as a prohibition would tell an operator a deal is dead when it is merely
 * discretionary.
 */
function classifyClause(clause: string, hasConditions: boolean): { status: UseLegalStatus; reasoning: string } {
  const prohibited = PROHIBITION_PATTERN.test(clause);
  const conditional = CONDITIONAL_PATTERN.test(clause);
  const escaped = /\b(?:except|unless|other\s+than)\b/i.test(clause);

  if (prohibited && conditional && escaped) {
    return {
      status: 'conditional_or_special_approval_required',
      reasoning: 'The adopted law bars this structure type except on a discretionary approval, so it is a conditional use rather than a prohibition.',
    };
  }
  if (prohibited) {
    return { status: 'prohibited', reasoning: 'The adopted law states a prohibition for this structure type.' };
  }
  if (conditional) {
    return { status: 'conditional_or_special_approval_required', reasoning: 'The adopted law requires a discretionary approval for this structure type.' };
  }
  if (NONCONFORMING_PATTERN.test(clause) && !PERMISSION_PATTERN.test(clause)) {
    return { status: 'lawful_nonconforming_only', reasoning: 'The adopted law addresses this structure type only as a lawful nonconforming or replacement situation.' };
  }
  if (PERMISSION_PATTERN.test(clause)) {
    return hasConditions
      ? {
          status: 'allowed_by_right_with_objective_conditions',
          reasoning: 'The adopted law permits this structure type subject to objective standards that do not require a discretionary approval.',
        }
      : { status: 'allowed_by_right', reasoning: 'The adopted law permits this structure type without a discretionary approval.' };
  }
  // The clause regulates HOW, not WHETHER. It must not be read either way.
  return {
    status: 'unverified',
    reasoning: 'Provisions mention this structure type but none states whether it is permitted, prohibited or requires discretionary approval.',
  };
}

/**
 * Combine clause verdicts.
 *
 * The most restrictive real determination wins, because a code that permits a
 * category generally and then excludes a subtype means the subtype is excluded.
 * `unverified` is the weakest and never displaces a real finding.
 */
const VERDICT_RANK: Record<UseLegalStatus, number> = {
  prohibited: 5,
  lawful_nonconforming_only: 4,
  conditional_or_special_approval_required: 3,
  allowed_by_right_with_objective_conditions: 2,
  allowed_by_right: 1,
  unverified: 0,
};

export function strongestVerdict(statuses: readonly UseLegalStatus[]): UseLegalStatus {
  if (!statuses.length) return 'unverified';
  return statuses.reduce((best, status) => (VERDICT_RANK[status] > VERDICT_RANK[best] ? status : best), 'unverified' as UseLegalStatus);
}

/* ─────────────────────── septic / health extraction ──────────────────── */

export interface SepticRuleExtraction {
  perLotApproval: ProvisionHit[];
  divisionReview: ProvisionHit[];
  minimumAcreage: ProvisionHit[];
  reserveField: ProvisionHit[];
  wellRules: ProvisionHit[];
}

export function extractSepticRules(documents: readonly OrdinanceDocument[]): SepticRuleExtraction {
  return {
    perLotApproval: searchProvisions(documents, /each\s+(?:lot|parcel)[^.;]{0,160}(?:septic|sewage|on-?site\s+(?:sewage|wastewater))[^.;]{0,160}|(?:septic|sewage)\s+(?:permit|approval)[^.;]{0,180}/gi, { maxTotal: 4 }),
    divisionReview: searchProvisions(documents, /(?:health\s+(?:department|authority|officer))[^.;]{0,200}(?:approv|review|certif)[^.;]{0,140}|(?:approval|review)\s+(?:by|of)\s+the\s+(?:county\s+)?health[^.;]{0,180}/gi, { maxTotal: 4 }),
    minimumAcreage: searchProvisions(documents, /(?:lot|parcel)s?\s+(?:served\s+by|using|with)\s+(?:an?\s+)?(?:on-?site|individual|septic)[^.;]{0,200}/gi, { maxTotal: 3 }),
    reserveField: searchProvisions(documents, /(?:reserve|replacement|secondary)\s+(?:drain\s?field|absorption|field|area)[^.;]{0,180}/gi, { maxTotal: 3 }),
    wellRules: searchProvisions(documents, /(?:individual|private|domestic)\s+wells?[^.;]{0,180}|well\s+(?:setback|separation|distance)[^.;]{0,160}/gi, { maxTotal: 3 }),
  };
}

/* ──────────────────────── plat / survey extraction ───────────────────── */

export interface PlatSurveyExtraction {
  survey: ProvisionHit[];
  preliminaryPlat: ProvisionHit[];
  finalPlat: ProvisionHit[];
  recording: ProvisionHit[];
  fees: ProvisionHit[];
  timeline: ProvisionHit[];
}

export function extractPlatAndSurvey(documents: readonly OrdinanceDocument[]): PlatSurveyExtraction {
  return {
    survey: searchProvisions(documents, /(?:prepared|certified|signed)\s+by\s+(?:a\s+)?(?:registered|licensed)\s+(?:land\s+)?surveyor[^.;]{0,180}|survey\s+(?:shall|must)\s+be[^.;]{0,180}/gi, { maxTotal: 3 }),
    preliminaryPlat: searchProvisions(documents, /preliminary\s+plat[^.;]{0,200}/gi, { maxTotal: 3 }),
    finalPlat: searchProvisions(documents, /final\s+plat[^.;]{0,200}/gi, { maxTotal: 3 }),
    recording: searchProvisions(documents, /record(?:ed|ing)\s+(?:in|with)\s+the\s+(?:office\s+of\s+the\s+)?clerk[^.;]{0,180}|shall\s+be\s+recorded[^.;]{0,180}/gi, { maxTotal: 3 }),
    fees: searchProvisions(documents, /(?:application|filing|review)\s+fee[^.;]{0,160}/gi, { maxTotal: 2 }),
    timeline: searchProvisions(documents, /within\s+\w+\s*\(?\d*\)?\s*(?:business\s+)?days[^.;]{0,160}/gi, { topics: ['subdivision'], maxTotal: 2 }),
  };
}

/* ───────────────────────── evidenced-value helper ────────────────────── */

/**
 * Turn a set of provision hits into an evidenced value, or an honest
 * unresolved when nothing was found. Used everywhere the answer is "what does
 * the ordinance say about X" rather than a parsed number.
 */
export function valueFromHits<T>(
  hits: readonly ProvisionHit[],
  value: T,
  retrievedAt: string,
  unresolvedReason: string,
  tierHint: SourceAuthorityTier = 'subdivision_ordinance',
  effectiveDate: string | null = null,
): EvidencedValue<T> {
  if (!hits.length) return unresolvedValue<T>(unresolvedReason);
  return evidencedValue(value, hits.map((hit) => citationFor(hit, retrievedAt, tierHint, effectiveDate)));
}

/** The first hit's excerpt as the value, when the answer IS the provision text. */
export function excerptValue(
  hits: readonly ProvisionHit[],
  retrievedAt: string,
  unresolvedReason: string,
  tierHint: SourceAuthorityTier = 'subdivision_ordinance',
  effectiveDate: string | null = null,
): EvidencedValue<string> {
  if (!hits.length) return unresolvedValue<string>(unresolvedReason);
  const text = boundExcerpt(hits[0].match.excerpt) ?? '';
  return evidencedValue(text, hits.map((hit) => citationFor(hit, retrievedAt, tierHint, effectiveDate)));
}
