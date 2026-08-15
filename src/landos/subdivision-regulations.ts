// LandOS — the CURRENT subdivision regulations that actually control this parcel.
//
// Reuses the controlling authority already established by
// `controlling-land-use-authority.ts`. It does not rediscover jurisdiction, and
// it does not decide who governs — a rule set is attributed to a government only
// when that government's subdivision authority was established from evidence.
//
// What a rule must carry to be retained:
//
//     the government, the document, the SECTION, the wording, and a date when
//     the document prints one.
//
// A minimum lot size with no section and no source is a number someone typed.
// It cannot be defended to a seller, an engineer, or a planning department, so
// it is not a rule LandOS will carry. Every extraction below cites the passage
// it came from, and the ordinance section when the document prints one nearby.
//
// The distinction the brief is emphatic about — MINOR versus MAJOR — is modeled
// as its own structure rather than as two rules that happen to sit in a list,
// because collapsing them turns "three lots by administrative plat" into
// "three lots, approved", which is a different and much more expensive fact.

import { defaultGovFetchText, extractLinks, htmlToText, type GovFetchText } from './gis-transport.js';
import { loadOfficialPdf } from './official-pdf-identity.js';
import { verifyOfficiality } from './official-source-discovery.js';
import { governmentSourceTier, hostServesSubjectJurisdiction } from './land-use-source-authority.js';
import {
  completeRuleValue,
  flattenOrdinanceText,
  looksLikeTableOfContents,
  matchNumericRuleValue,
  matchRuleValue,
} from './ordinance-text.js';
import { raceRecordOf, type LandUseRaceRecord } from './controlling-land-use-authority.js';
import {
  browserEscalationLane,
  buildLandUseQueries,
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
  type LandUseLane,
  type LandUseLaneRecord,
} from './land-use-source-race.js';
import type { AuthorityAssignment, AuthoritySourceTier } from './controlling-land-use-authority.js';
import type { IdentitySearchProvider } from './hermes-free-search.js';

// ── Vocabulary ──────────────────────────────────────────────────────────────

export const SUBDIVISION_RULE_KEYS = [
  'minor_subdivision_definition',
  'major_subdivision_definition',
  'administrative_split_threshold',
  'max_lots_before_major_review',
  'minimum_lot_size',
  'minimum_frontage',
  'minimum_lot_width',
  'access_requirement',
  'public_private_road_rule',
  'new_road_standard',
  'road_improvement_requirement',
  'cul_de_sac_or_dead_end',
  'utilities_requirement',
  'sewer_requirement',
  'water_requirement',
  'septic_implication',
  'survey_requirement',
  'plat_requirement',
  'plat_sequence',
  'planning_commission_review',
  'administrative_review',
  'governing_body_approval',
  'open_space_requirement',
  'cluster_development',
  'density_rule',
  'flag_lot_rule',
  'shared_driveway_rule',
  'easement_or_access_requirement',
  'stormwater_requirement',
  'recording_requirement',
  'review_fee',
] as const;
export type SubdivisionRuleKey = (typeof SUBDIVISION_RULE_KEYS)[number];

export type RuleConfidence = 'confirmed' | 'well_supported' | 'likely' | 'unresolved';

export interface SubdivisionRule {
  key: SubdivisionRuleKey;
  label: string;
  /** The regulation's own wording, trimmed but never paraphrased. */
  value: string;
  /** The passage the value came from. */
  quote: string;
  /** Ordinance/regulation section, when the document prints one nearby. */
  section: string | null;
  sourceLabel: string;
  sourceUrl: string | null;
  authorityName: string | null;
  effectiveOrAsOf: string | null;
  confidence: RuleConfidence;
  limitations: string[];
}

export interface MinorMajorThresholds {
  /** Kept SEPARATE by construction. A minor definition is never a major one. */
  minorDefinition: SubdivisionRule | null;
  majorDefinition: SubdivisionRule | null;
  administrativeSplitThreshold: SubdivisionRule | null;
  maxLotsBeforeMajorReview: SubdivisionRule | null;
  /** The lot count above which major review applies, when a rule states one. */
  statedMaxMinorLots: number | null;
  basis: string;
}

export interface SubdivisionRegulations {
  dealCardId: number;
  authorityName: string | null;
  authorityDetermination: AuthorityAssignment['determination'] | 'not_supplied';
  documents: Array<{
    label: string;
    url: string | null;
    tier: AuthoritySourceTier;
    adoptedOrAsOf: string | null;
    /** True when the document calls itself PROPOSED or DRAFT. Never current. */
    draftOrProposed: boolean;
    retrievedAt: string;
  }>;
  rules: SubdivisionRule[];
  thresholds: MinorMajorThresholds;
  reviewSequence: string[];
  limitations: string[];
  retrievedAt: string;
  /** Which retrieval methods raced, which won, what was still running. */
  race?: LandUseRaceRecord;
}

const RULE_LABELS: Record<SubdivisionRuleKey, string> = {
  minor_subdivision_definition: 'Minor subdivision definition',
  major_subdivision_definition: 'Major subdivision definition',
  administrative_split_threshold: 'Administrative split threshold',
  max_lots_before_major_review: 'Maximum lots before major review',
  minimum_lot_size: 'Minimum lot size',
  minimum_frontage: 'Minimum frontage',
  minimum_lot_width: 'Minimum lot width',
  access_requirement: 'Access requirement',
  public_private_road_rule: 'Public / private road rule',
  new_road_standard: 'New road standard',
  road_improvement_requirement: 'Road improvement requirement',
  cul_de_sac_or_dead_end: 'Cul-de-sac / dead-end rule',
  utilities_requirement: 'Utilities requirement',
  sewer_requirement: 'Sewer requirement',
  water_requirement: 'Water requirement',
  septic_implication: 'Septic implication',
  survey_requirement: 'Survey requirement',
  plat_requirement: 'Plat requirement',
  plat_sequence: 'Concept / preliminary / final plat sequence',
  planning_commission_review: 'Planning commission review',
  administrative_review: 'Staff / administrative review',
  governing_body_approval: 'Governing-body approval',
  open_space_requirement: 'Open space requirement',
  cluster_development: 'Cluster development provision',
  density_rule: 'Density rule',
  flag_lot_rule: 'Flag lot rule',
  shared_driveway_rule: 'Shared driveway rule',
  easement_or_access_requirement: 'Easement / access requirement',
  stormwater_requirement: 'Stormwater requirement',
  recording_requirement: 'Recording requirement',
  review_fee: 'Review fee',
};

interface ExtractionRule {
  key: SubdivisionRuleKey;
  pattern: RegExp;
  /**
   * Tried FIRST. For a rule whose term also appears in cross-references, this
   * is the shape the DEFINITION itself takes. A live run read Fairview's minor
   * subdivision definition as "minor subdivision, or a land partition" — a
   * fragment of a cross-reference elsewhere in the document — and lost the lot
   * threshold that decides the entire review path.
   */
  preferred?: RegExp;
}

/**
 * One pattern per rule, each anchored on the regulation's own vocabulary.
 *
 * These read subdivision REGULATIONS, which are written in a narrow and
 * remarkably consistent register across jurisdictions. The patterns are
 * deliberately conservative: a miss is an unresolved rule the operator can go
 * and read, while a false positive is a number that looks defensible and is not.
 */
const EXTRACTION_RULES: ExtractionRule[] = [
  {
    key: 'minor_subdivision_definition',
    preferred: /\bminor\s+subdivision\b\s*(?:means|is|shall\s+mean|:|[-–])?\s*(?:a\s+division\s+of\s+land|the\s+division\s+of\s+land|any\s+(?:subdivision|division))[^.\n]{0,320}/i,
    pattern: /\bminor\s+subdivision\b\s*(?:means|is|shall\s+mean|:)?[^.\n]{0,320}/i,
  },
  {
    key: 'major_subdivision_definition',
    preferred: /\bmajor\s+subdivision\b\s*(?:means|is|shall\s+mean|:|[-–])?\s*(?:a\s+division\s+of\s+land|the\s+division\s+of\s+land|any\s+(?:subdivision|division))[^.\n]{0,320}/i,
    pattern: /\bmajor\s+subdivision\b\s*(?:means|is|shall\s+mean|:)?[^.\n]{0,320}/i,
  },
  { key: 'administrative_split_threshold', pattern: /\b(?:administrative(?:ly)?|staff)\s+(?:approv\w+|review\w*|plat)\b[^.\n]{0,260}/i },
  { key: 'max_lots_before_major_review', pattern: /\b(?:not\s+more\s+than|no\s+more\s+than|fewer\s+than|up\s+to|maximum\s+of)\s+(?:\w+|\d{1,3})\s+lots?\b[^.\n]{0,200}/i },
  { key: 'minimum_lot_size', pattern: /\bminimum\s+lot\s+(?:size|area)\b[^.\n]{0,220}/i },
  { key: 'minimum_frontage', pattern: /\bminimum\s+(?:lot\s+)?(?:road\s+|street\s+)?frontage\b[^.\n]{0,220}/i },
  { key: 'minimum_lot_width', pattern: /\bminimum\s+lot\s+width\b[^.\n]{0,220}/i },
  { key: 'access_requirement', pattern: /\b(?:every|each)\s+lot\s+shall\s+(?:have|abut|front)\b[^.\n]{0,240}/i },
  { key: 'public_private_road_rule', pattern: /\bprivate\s+(?:road|street|drive)s?\b[^.\n]{0,240}/i },
  { key: 'new_road_standard', pattern: /\b(?:new\s+)?(?:street|road)s?\s+shall\s+(?:be|conform|comply|meet)\b[^.\n]{0,240}/i },
  { key: 'road_improvement_requirement', pattern: /\b(?:road|street)\s+improvements?\b[^.\n]{0,240}/i },
  { key: 'cul_de_sac_or_dead_end', pattern: /\bcul[- ]de[- ]sac\b[^.\n]{0,220}|\bdead[- ]end\s+(?:street|road)\b[^.\n]{0,220}/i },
  { key: 'utilities_requirement', pattern: /\butilit(?:y|ies)\b[^.\n]{0,60}\b(?:shall|must|required)\b[^.\n]{0,200}/i },
  { key: 'sewer_requirement', pattern: /\b(?:sanitary\s+)?sewer\b[^.\n]{0,60}\b(?:shall|must|required|available)\b[^.\n]{0,200}/i },
  { key: 'water_requirement', pattern: /\b(?:public\s+)?water\s+(?:supply|system|service|main)\b[^.\n]{0,220}/i },
  { key: 'septic_implication', pattern: /\b(?:septic|subsurface\s+sewage|on[- ]site\s+sewage)\b[^.\n]{0,240}/i },
  { key: 'survey_requirement', pattern: /\b(?:registered|licensed)\s+(?:land\s+)?surveyor\b[^.\n]{0,220}|\bsurvey\s+shall\s+be\b[^.\n]{0,200}/i },
  { key: 'plat_requirement', pattern: /\bplat\s+shall\s+(?:be|show|contain|include)\b[^.\n]{0,240}/i },
  { key: 'plat_sequence', pattern: /\b(?:concept\s+plan|sketch\s+plat|preliminary\s+plat)\b[^.\n]{0,60}\b(?:final\s+plat|preliminary\s+plat)\b[^.\n]{0,200}|\b(?:preliminary|final)\s+plat\s+(?:shall|must|process|procedure)\b[^.\n]{0,220}/i },
  { key: 'planning_commission_review', pattern: /\bplanning\s+commission\s+(?:shall|must|may|review|approve)\b[^.\n]{0,240}/i },
  { key: 'administrative_review', pattern: /\b(?:secretary|staff|planning\s+director|zoning\s+administrator)\s+(?:shall|may)\s+(?:approve|review|sign)\b[^.\n]{0,240}/i },
  { key: 'governing_body_approval', pattern: /\b(?:board\s+of\s+(?:mayor\s+and\s+)?(?:aldermen|commissioners)|city\s+council|county\s+commission)\s+(?:shall|must|may|approve)\b[^.\n]{0,240}/i },
  { key: 'open_space_requirement', pattern: /\bopen\s+space\b[^.\n]{0,60}\b(?:shall|must|percent|%|required)\b[^.\n]{0,200}/i },
  { key: 'cluster_development', pattern: /\bcluster\s+(?:development|subdivision|lot)\b[^.\n]{0,240}/i },
  { key: 'density_rule', pattern: /\b(?:maximum\s+)?(?:gross\s+|net\s+)?density\b[^.\n]{0,220}|\b\d+(?:\.\d+)?\s*(?:dwelling\s+)?units?\s+per\s+acre\b[^.\n]{0,160}/i },
  { key: 'flag_lot_rule', pattern: /\bflag\s+lot\b[^.\n]{0,240}/i },
  { key: 'shared_driveway_rule', pattern: /\bshared\s+(?:driveway|access|drive)\b[^.\n]{0,240}/i },
  { key: 'easement_or_access_requirement', pattern: /\baccess\s+easement\b[^.\n]{0,240}|\beasement\s+shall\b[^.\n]{0,220}/i },
  { key: 'stormwater_requirement', pattern: /\bstorm\s*water\b[^.\n]{0,60}\b(?:shall|must|management|detention|required)\b[^.\n]{0,200}/i },
  { key: 'recording_requirement', pattern: /\b(?:recorded|record(?:ing)?)\s+(?:with|in|by)\s+the\s+(?:register|recorder|county\s+clerk)\b[^.\n]{0,220}/i },
  { key: 'review_fee', pattern: /\b(?:review|application|filing)\s+fee\b[^.\n]{0,200}/i },
];

/**
 * A section reference, tolerant of how a PDF text layer renders one.
 *
 * Real regulations print "SECTION 1-101" and the extractor sees "SECTION 1 -
 * 101", because the glyphs wrapped. Requiring the separator to be tight made
 * every rule in the real Fairview document cite no section at all.
 */
const SECTION_NEAR = /(?:§|\bSection\b|\bSec\.|\bArticle\b|\bArt\.|\bChapter\b|\bCh\.)\s*([0-9]+(?:\s*[.\-]\s*[0-9A-Za-z]+)*)/i;

const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();

/**
 * Undo a PDF text layer's line wrapping before reading rules out of it.
 *
 * A regulation sentence is a sentence; where the glyphs happened to wrap is an
 * artifact of the page, not of the rule. Left in, it splits "minimum lot
 * frontage shall be two hundred (200) feet" across three lines and the
 * extraction reads none of it.
 */
export const flattenRegulationText = flattenOrdinanceText;

/** Rules whose whole point is a NUMBER. A match without one is not the rule. */
const NUMERIC_RULE_KEYS: ReadonlySet<SubdivisionRuleKey> = new Set([
  'minimum_lot_size',
  'minimum_frontage',
  'minimum_lot_width',
  'max_lots_before_major_review',
  'cul_de_sac_or_dead_end',
  'density_rule',
]);

/** Numbers the regulations spell out. Real ordinances mix both forms. */
const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, twentyfive: 25,
};

export function readLotCount(text: string): number | null {
  // "not more than three (3) lots" is how regulations actually write it: the
  // word and the numeral together. The parenthesised form is checked first
  // because it is unambiguous, and because neither of the older patterns
  // matched it — the word form is interrupted by "(3)" and the digit form is
  // interrupted by the parentheses.
  const parenthesised = /\((\d{1,3})\)\s*(?:or\s+fewer\s+)?lots?\b/i.exec(text);
  if (parenthesised) {
    const value = Number(parenthesised[1]);
    if (Number.isFinite(value) && value > 0 && value < 1000) return value;
  }
  const digits = /\b(\d{1,3})\s+(?:or\s+fewer\s+)?lots?\b/i.exec(text);
  if (digits) {
    const value = Number(digits[1]);
    if (Number.isFinite(value) && value > 0 && value < 1000) return value;
  }
  const words = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\s+(?:or\s+fewer\s+)?lots?\b/i.exec(text);
  if (words) return WORD_NUMBERS[words[1].toLowerCase()] ?? null;
  return null;
}

/**
 * The section printed nearest BEFORE this passage.
 *
 * Strictly before, and that matters: a regulation document prints its sections
 * in order, so a window that also looked forward would attribute a rule to the
 * NEXT section — "Minimum lot size" in Section 4.1 cited as Section 5.1, which
 * is a citation that fails the moment anyone checks it.
 */
function sectionFor(text: string, index: number): string | null {
  // A wide window, because flattening the line wrapping puts a whole page of
  // dense prose between a heading and the rule it introduces.
  const before = text.slice(Math.max(0, index - 1_200), index);
  const matches = [...before.matchAll(new RegExp(SECTION_NEAR.source, 'gi'))];
  const last = matches[matches.length - 1];
  return last ? clean(last[0]) : null;
}


export interface ExtractSubdivisionRulesInput {
  text: string;
  sourceLabel: string;
  sourceUrl: string | null;
  sourceTier: AuthoritySourceTier;
  authorityName: string | null;
  effectiveOrAsOf?: string | null;
  retrievedAt: string;
}

/**
 * Pull the controlling rules out of one regulation document.
 *
 * A rule from a non-official document is retained at `likely` and says so. A
 * rule with no section is retained with `section: null` and a stated
 * limitation, because "the regulations require it, section not printed on this
 * page" is honest and usable, while inventing a section number is not.
 */
export function extractSubdivisionRules(input: ExtractSubdivisionRulesInput): SubdivisionRule[] {
  const text = flattenRegulationText(input.text);
  const out: SubdivisionRule[] = [];
  const seen = new Set<SubdivisionRuleKey>();

  for (const rule of EXTRACTION_RULES) {
    if (seen.has(rule.key)) continue;
    // For a rule that exists to carry a number, keep looking until a match
    // actually carries one. The first textual match is often the definitions
    // page ("the minimum lot area required for such lots"), which states the
    // rule's NAME and none of its content.
    // Preferred wording first, then a numeric match for the rules whose point
    // IS a number, then the plain pattern. Whichever hits, the value is
    // completed to the end of its sentence so the number stays attached to the
    // rule it belongs to.
    const preferred = rule.preferred ? matchRuleValue(text, rule.preferred) : null;
    const found = preferred
      ?? (NUMERIC_RULE_KEYS.has(rule.key)
        // A numeric rule falls back to the plain pattern ONLY if that plain
        // match still states a measurement. Without the guard the fallback is
        // where a wrong value gets in: a live run returned "minimum lot area
        // required for such lots. 2. Within developments subject to Article
        // VI…" as this jurisdiction's minimum lot size.
        ? matchNumericRuleValue(text, rule.pattern)
        : matchRuleValue(text, rule.pattern));
    if (!found) continue;
    const match: RegExpExecArray = Object.assign([found.value], { index: found.index, input: text, groups: undefined }) as RegExpExecArray;
    const value = clean(found.value).slice(0, 400);
    // A definition that matched nothing but its own heading — "Minor
    // Subdivision" off a navigation menu — states no rule. Skipping it here
    // rather than retaining it lets another document supply the real one,
    // instead of a bare heading blocking the rule for the whole run.
    if (rule.preferred && value.length < 40) continue;
    seen.add(rule.key);
    const section = sectionFor(text, match.index);
    out.push({
      key: rule.key,
      label: RULE_LABELS[rule.key],
      value,
      quote: clean(text.slice(Math.max(0, match.index - 120), match.index + match[0].length + 160)).slice(0, 600),
      section,
      sourceLabel: input.sourceLabel,
      sourceUrl: input.sourceUrl,
      authorityName: input.authorityName,
      effectiveOrAsOf: input.effectiveOrAsOf ?? null,
      confidence: input.sourceTier === 'official_government_source'
        ? (section ? 'confirmed' : 'well_supported')
        : 'likely',
      limitations: [
        ...(section ? [] : ['The document does not print an ordinance section near this passage, so the rule is cited to the document rather than to a section.']),
        ...(input.sourceTier === 'official_government_source'
          ? []
          : ['This rule was read from a source that is not an official government document, so it is carried as a pointer rather than as the controlling regulation.']),
      ],
    });
  }
  return out;
}

/**
 * Minor and major, held apart.
 *
 * The lot threshold is read only from the MINOR definition or an explicit
 * "not more than N lots" rule. A count found anywhere else in the document is
 * some other requirement's number and is not promoted into this one.
 */
export function readMinorMajorThresholds(rules: readonly SubdivisionRule[]): MinorMajorThresholds {
  const find = (key: SubdivisionRuleKey): SubdivisionRule | null => rules.find((rule) => rule.key === key) ?? null;
  const minor = find('minor_subdivision_definition');
  const major = find('major_subdivision_definition');
  const administrative = find('administrative_split_threshold');
  const maxLots = find('max_lots_before_major_review');

  const stated = minor ? readLotCount(minor.value) : null;
  const fallback = maxLots ? readLotCount(maxLots.value) : null;
  const statedMaxMinorLots = stated ?? fallback;

  const basis = minor
    ? `The minor-subdivision definition states: "${minor.value.slice(0, 220)}"${minor.section ? ` (${minor.section})` : ''}.`
    : maxLots
      ? `No minor-subdivision definition was extracted; a lot ceiling was read from: "${maxLots.value.slice(0, 220)}"${maxLots.section ? ` (${maxLots.section})` : ''}.`
      : 'Neither a minor-subdivision definition nor an explicit lot ceiling was extracted from the retrieved regulations, so the minor/major boundary is unresolved.';

  return {
    minorDefinition: minor,
    majorDefinition: major,
    administrativeSplitThreshold: administrative,
    maxLotsBeforeMajorReview: maxLots,
    statedMaxMinorLots,
    basis,
  };
}

/** The review path a plat actually walks, in the order the document states it. */
export function readReviewSequence(rules: readonly SubdivisionRule[]): string[] {
  const sequence: string[] = [];
  const push = (key: SubdivisionRuleKey, phrase: string): void => {
    const rule = rules.find((row) => row.key === key);
    if (rule) sequence.push(`${phrase}${rule.section ? ` (${rule.section})` : ''}`);
  };
  push('plat_sequence', 'Concept / preliminary / final plat sequence stated in the regulations');
  push('administrative_review', 'Staff or administrative review');
  push('planning_commission_review', 'Planning commission review');
  push('governing_body_approval', 'Governing-body approval');
  push('recording_requirement', 'Recording with the county register');
  return sequence;
}

// ── Retrieval ───────────────────────────────────────────────────────────────

export interface SubdivisionRetrievalSubject {
  dealCardId: number;
  municipality: string | null;
  county: string | null;
  state: string | null;
}

export interface SubdivisionRetrievalDeps {
  search?: IdentitySearchProvider;
  fetchText?: GovFetchText;
  /** Bounded PDF reader. Injectable so a suite needs no network. */
  loadPdf?: RetrievalTransports['loadPdf'];
  /**
   * Hosts already established as this parcel's government — normally the
   * domain the resolver's official documents came from.
   *
   * Used to run site-scoped queries FIRST. A general search for "Fairview TN
   * subdivision regulations" returns a page of other towns' regulations that
   * the jurisdiction gate then throws away one by one; asking the city's own
   * domain returns the city's own regulations.
   */
  preferredHosts?: readonly string[];
  /** Regulation documents the caller already located. */
  knownDocumentUrls?: readonly string[];
  /** Text already in hand, so nothing is fetched twice. */
  suppliedDocuments?: ReadonlyArray<{ label: string; url: string | null; text: string; tier?: AuthoritySourceTier }>;
  maxQueries?: number;
  maxDocuments?: number;
  timeoutMs?: number;
  /** Escalation seam for a JS-rendered code viewer. */
  browser?: BrowserSourceReader | null;
  awaitEnrichment?: boolean;
  deadlineMs?: number;
  /** Everything the confirmed subject can put into a query. */
  queryFacts?: Partial<SubjectQueryFacts>;
  onLaneSettled?: (record: LandUseLaneRecord) => void;
  now?: () => string;
}

export function buildSubdivisionQueries(
  subject: SubdivisionRetrievalSubject,
  authorityName: string | null,
  limit = 3,
  preferredHosts: readonly string[] = [],
): string[] {
  const authority = authorityName ?? subject.municipality ?? (subject.county ? `${subject.county.replace(/\s+county$/i, '')} County` : '');
  const where = [authority, subject.state].filter(Boolean).join(' ');
  // Site-scoped first: the government's own domain answers with the
  // government's own regulations, and everything else is a filtering problem.
  const scoped = preferredHosts.slice(0, 2).flatMap((host) => [
    `subdivision regulations site:${host}`,
    `minor subdivision definition site:${host}`,
  ]);
  return [...new Set([
    ...scoped,
    where ? `${where} subdivision regulations pdf` : '',
    where ? `${where} minor subdivision definition lots planning commission` : '',
    where ? `${where} subdivision regulations minimum lot size frontage` : '',
  ].filter(Boolean))].slice(0, Math.max(1, limit));
}

const PDF_LIKE = /\.pdf(?:[?#]|$)/i;

/**
 * The pre-fetch jurisdiction gate now lives in `land-use-source-authority.ts`
 * so every land-use subsystem applies the same one. Re-exported here because
 * callers and tests already import it from this module.
 */
export { hostServesSubjectJurisdiction } from './land-use-source-authority.js';

function adoptedDate(text: string): string | null {
  const match = /\b(?:adopted|effective|amended)\s*(?:on|:)?\s*([A-Z][a-z]+\s+\d{1,2},\s*(?:19|20)\d{2}|\d{1,2}\/\d{1,2}\/(?:19|20)?\d{2})/i.exec(text.slice(0, 12_000));
  return match ? clean(match[1]) : null;
}

/**
 * Is this the REGULATIONS, or just a document that talks about subdivisions?
 *
 * The distinction is not pedantic. A planning-commission packet says the word
 * "subdivision" on every page and contains no rule that governs anything; a
 * live run mined three sentences out of one and presented them as the
 * controlling regulations for the parcel. A regulation document titles itself
 * as one, or is the jurisdiction's adopted code.
 */
export function looksLikeRegulationDocument(input: { url: string; title: string | null; text: string }): boolean {
  const label = `${input.title ?? ''} ${input.url}`;
  if (/packet|minutes|agenda|staff[\s_-]*report|boc-packets/i.test(label)) return false;
  // A ZONING ordinance cites the subdivision regulations constantly. Citing
  // them is not being them, and a live run pulled "rules" out of Fairview's
  // zoning ordinance on the strength of one such reference.
  if (/zoning[\s_-]*(?:ordinance|resolution|map)/i.test(label)
    && !/subdivision[\s_-]*regulations?/i.test(label)) return false;
  if (/subdivision[\s_-]*regulations?|subdivision[\s_-]*ordinance|land[\s_-]*development[\s_-]*(?:code|ordinance)|code[\s_-]*of[\s_-]*ordinances|municipal[\s_-]*code/i.test(label)) return true;
  const head = flattenRegulationText(input.text).slice(0, 4_000);
  if (/(?:PC|BOMA)?\s*Resolution\s+[A-Z0-9-]+|regular\s+meeting|call\s+to\s+order/i.test(head)) return false;
  // The document must TITLE itself as the regulations, not merely cite them.
  return /subdivision\s+regulations?\s+of|these\s+subdivision\s+regulations|subdivision\s+regulations?[^.]{0,60}(?:adopted|shall\s+be\s+known|are\s+adopted)|land\s+development\s+(?:code|ordinance)\s+of/i.test(head);
}

/**
 * Does this document call itself PROPOSED or DRAFT?
 *
 * A live run retrieved Fairview's "PROPOSED SUBDIVISION REGULATIONS" alongside
 * its adopted consolidated regulations. Extracting a lot threshold from the
 * proposed set and presenting it as the controlling rule is the same mistake as
 * treating a 2024 packet's zoning as today's district — a document that has not
 * been adopted governs nothing.
 */
export function looksDraftOrProposed(text: string): boolean {
  const head = flattenRegulationText(text).slice(0, 3_000);
  return /\bPROPOSED\s+(?:SUBDIVISION|ZONING|LAND\s+DEVELOPMENT)\s+(?:REGULATIONS?|ORDINANCE|CODE)\b/i.test(head)
    || /\bDRAFT\s+(?:SUBDIVISION|ZONING)\s+(?:REGULATIONS?|ORDINANCE)\b/i.test(head)
    || /\bFOR\s+(?:PUBLIC\s+)?(?:REVIEW|DISCUSSION)\s+ONLY\b/i.test(head);
}

/**
 * Retrieve and extract the current subdivision regulations for this authority.
 *
 * A supplied document is used as-is — LandOS never re-fetches something it was
 * handed. Discovery is bounded, PDFs are read with the same bounded reader the
 * identity path uses, and an aggregator is never opened.
 */
export async function retrieveSubdivisionRegulations(
  subject: SubdivisionRetrievalSubject,
  authority: AuthorityAssignment | null,
  deps: SubdivisionRetrievalDeps = {},
): Promise<SubdivisionRegulations> {
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const fetchText = deps.fetchText ?? defaultGovFetchText;
  const maxDocuments = Math.max(1, deps.maxDocuments ?? 3);
  const timeoutMs = Math.max(1_000, deps.timeoutMs ?? 25_000);
  const limitations: string[] = [];
  const documents: SubdivisionRegulations['documents'] = [];
  const rules: SubdivisionRule[] = [];

  if (!authority || authority.determination === 'unresolved' || authority.determination === 'ambiguous') {
    limitations.push(
      'Controlling subdivision authority is not established, so any rules below are retained as reference and are NOT attributed to a governing authority for this parcel.',
    );
  }

  // Rules are STAGED per document and merged at the end, so an ADOPTED
  // document always wins a rule over a PROPOSED one — which cannot be decided
  // by fetch order, because a document only reveals that it is a draft once it
  // has been read.
  const staged: Array<{ rules: SubdivisionRule[]; draft: boolean }> = [];

  // A host the identity path already established as this parcel's government
  // publishes government documents. Re-deciding that per file made the town's
  // own Article 2 read as "secondary" because that particular PDF never spells
  // out "City of Fairview".
  const trustedHosts = new Set(
    (deps.preferredHosts ?? []).map((host) => host.toLowerCase().replace(/^www\./, '')),
  );
  const tierFor = (url: string | null, text: string): AuthoritySourceTier => {
    const base = url
      ? governmentSourceTier({ url, pageText: text, municipality: subject.municipality, county: subject.county, state: subject.state })
      : 'reputable_secondary';
    if (base === 'official_government_source' || !url) return base;
    try {
      const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      if (trustedHosts.has(host)) return 'official_government_source';
    } catch { /* not a URL: leave the tier alone */ }
    return base;
  };

  const absorb = (input: ExtractSubdivisionRulesInput & { draftOrProposed: boolean }): void => {
    const extracted = extractSubdivisionRules(input).map((rule) => (input.draftOrProposed
      ? {
          ...rule,
          // A proposed rule is never `confirmed`, whatever its section says.
          confidence: 'likely' as const,
          limitations: [
            ...rule.limitations,
            'Read from a document that calls itself PROPOSED or DRAFT. It has not been shown to be adopted, so it does not control this parcel.',
          ],
        }
      : rule));
    staged.push({ rules: extracted, draft: input.draftOrProposed });
    documents.push({
      label: input.sourceLabel,
      url: input.sourceUrl,
      tier: input.sourceTier,
      adoptedOrAsOf: input.effectiveOrAsOf ?? null,
      draftOrProposed: input.draftOrProposed,
      retrievedAt: input.retrievedAt,
    });
  };

  for (const supplied of deps.suppliedDocuments ?? []) {
    absorb({
      text: supplied.text,
      sourceLabel: supplied.label,
      sourceUrl: supplied.url,
      sourceTier: supplied.tier ?? tierFor(supplied.url, supplied.text),
      authorityName: authority?.name ?? null,
      effectiveOrAsOf: adoptedDate(supplied.text),
      draftOrProposed: looksDraftOrProposed(supplied.text),
      retrievedAt: now,
    });
  }

  // ── THE RACE ──────────────────────────────────────────────────────────────
  //
  // Retained regulation text, the government's own known document URLs and
  // indexed web discovery all run CONCURRENTLY, with browser escalation held
  // behind them. The earlier version searched first and opened second, which
  // meant a card that already had the adopted regulations still paid three
  // search round trips before reading them.
  const jurisdiction: LaneJurisdiction = {
    municipality: subject.municipality,
    county: subject.county,
    state: subject.state,
    controllingAuthorityName: authority?.name ?? null,
  };
  const transports: RetrievalTransports = { fetchText, loadPdf: deps.loadPdf, timeoutMs, now: () => now };

  interface RegulationDocument {
    rules: SubdivisionRule[];
    draft: boolean;
    label: string;
    url: string | null;
    tier: AuthoritySourceTier;
    adoptedOrAsOf: string | null;
    retrievedAt: string;
  }

  const read: EvidenceReader<RegulationDocument> = (document) => {
    if (!/\bsubdivision\b/i.test(document.text)) return [];
    // A planning PACKET mentions subdivision on every page and regulates
    // nothing; a ZONING ordinance references the subdivision regulations
    // without being them. A live run mined three sentences out of the Fairview
    // commission agenda and offered them as the controlling rules.
    if (!looksLikeRegulationDocument({ url: document.url, title: document.title, text: document.text })) return [];
    const tier = tierFor(document.url || null, document.text);
    const draft = looksDraftOrProposed(document.text);
    const rules = extractSubdivisionRules({
      text: document.text,
      sourceLabel: document.title ?? document.url,
      sourceUrl: document.url || null,
      sourceTier: tier,
      authorityName: authority?.name ?? null,
      effectiveOrAsOf: adoptedDate(document.text),
      retrievedAt: document.retrievedAt,
    });
    const value: RegulationDocument = {
      rules,
      draft,
      label: document.title ?? (document.url.split('/').pop() || document.url),
      url: document.url || null,
      tier,
      adoptedOrAsOf: adoptedDate(document.text),
      retrievedAt: document.retrievedAt,
    };
    return [{
      method: 'official_document',
      laneId: 'subdivision',
      value,
      authorityName: authority?.name ?? null,
      sourceLabel: value.label,
      sourceUrl: value.url,
      sourceTier: tier,
      // Subdivision regulations govern the jurisdiction, not one parcel.
      parcelMatchBasis: `published by the government that regulates subdivision for this parcel`,
      currentness: draft ? 'proposed' : 'adopted',
      effectiveOrAsOf: value.adoptedOrAsOf,
      quote: clean(document.text).slice(0, 400),
      retrievedAt: document.retrievedAt,
    }];
  };

  const lanes: Array<LandUseLane<RegulationDocument, LaneJurisdiction>> = [];
  if (deps.knownDocumentUrls?.length) {
    lanes.push(directSourceLane<RegulationDocument>({
      id: 'known_regulations',
      label: 'Known official subdivision-regulation URL',
      urls: deps.knownDocumentUrls,
      jurisdiction,
      read,
      transports,
      maxSources: maxDocuments,
      onNote: (note) => limitations.push(note),
    }));
  }
  if (deps.search) {
    const facts: SubjectQueryFacts = {
      apn: null, parcelNotation: null, owner: null, projectName: null, address: null,
      municipality: subject.municipality,
      county: subject.county,
      state: subject.state,
      officialHosts: deps.preferredHosts,
      ...(deps.queryFacts ?? {}),
    };
    lanes.push(indexedWebSearchLane<RegulationDocument>({
      id: 'subdivision_web',
      label: 'Indexed web discovery (governed keyless search)',
      queries: buildLandUseQueries({
        subject: facts,
        topic: 'subdivision regulations',
        variants: [
          'minor subdivision definition lots',
          'subdivision regulations minimum lot size frontage',
          'subdivision regulations road standards plat',
          'subdivision regulations PDF',
        ],
        limit: Math.max(6, deps.maxQueries ?? 6),
      }),
      jurisdiction,
      search: deps.search,
      read,
      transports,
      maxSources: maxDocuments,
      // A planning-department index page links to every article of the
      // regulations, and following those links is deterministic where a
      // keyless search is not.
      preferUrls: /subdivision[\s_-]*regulation|subdivision[\s_-]*ordinance|planning|codes|\.pdf/i,
      followLinks: /subdivision|regulation|ordinance|article/i,
      onNote: (note) => limitations.push(note),
    }));
  }
  lanes.push(browserEscalationLane<RegulationDocument>({
    id: 'subdivision_browser',
    label: 'Browser escalation (JS-rendered regulations viewer)',
    urls: deps.knownDocumentUrls ?? [],
    purpose: 'read the adopted subdivision regulations',
    jurisdiction,
    read,
    browser: deps.browser ?? null,
    onNote: (note) => limitations.push(note),
    now: () => now,
  }));

  if (lanes.length === 1 && !deps.suppliedDocuments?.length) {
    limitations.push('No retrieval lane other than browser escalation was wired for subdivision regulations.');
  }

  const race = await raceLandUseSources<RegulationDocument, LaneJurisdiction>({
    question: 'subdivision_rules',
    aim: jurisdiction,
    lanes,
    deadlineMs: deps.deadlineMs ?? 60_000,
    gate: (candidate) => {
      if (candidate.sourceTier !== 'official_government_source') {
        return { sufficient: false, reason: `the source is ${candidate.sourceTier.replace(/_/g, ' ')}; a controlling rule must come from the adopted regulations` };
      }
      if (candidate.value.draft) {
        return { sufficient: false, reason: 'the document calls itself proposed or draft, so it does not control today' };
      }
      const thresholds = readMinorMajorThresholds(candidate.value.rules);
      return thresholds.minorDefinition || thresholds.maxLotsBeforeMajorReview || candidate.value.rules.length >= 5
        ? { sufficient: true, reason: `the adopted regulations carry ${candidate.value.rules.length} extractable rule(s)` }
        : { sufficient: false, reason: `only ${candidate.value.rules.length} rule(s) extracted and no minor/major boundary, so this document does not yet answer the question` };
    },
    sameAnswer: (a, b) => a.url === b.url,
    onLaneSettled: (record) => deps.onLaneSettled?.(record),
  });

  const retrieved = [...race.evidence];
  if (deps.awaitEnrichment !== false) {
    const enrichment = await race.enrichment;
    retrieved.push(...enrichment.lateEvidence);
    limitations.push(...enrichment.conflicts);
  }
  limitations.push(...race.notes);

  for (const row of retrieved) {
    if (documents.some((document) => document.url === row.value.url)) continue;
    staged.push({ rules: row.value.draft
      ? row.value.rules.map((rule) => ({
          ...rule,
          confidence: 'likely' as const,
          limitations: [
            ...rule.limitations,
            'Read from a document that calls itself PROPOSED or DRAFT. It has not been shown to be adopted, so it does not control this parcel.',
          ],
        }))
      : row.value.rules, draft: row.value.draft });
    documents.push({
      label: row.value.label,
      url: row.value.url,
      tier: row.value.tier,
      adoptedOrAsOf: row.value.adoptedOrAsOf,
      draftOrProposed: row.value.draft,
      retrievedAt: row.value.retrievedAt,
    });
  }

  // Merge: an ADOPTED document's rule always beats a PROPOSED one's.
  for (const group of [...staged.filter((row) => !row.draft), ...staged.filter((row) => row.draft)]) {
    for (const rule of group.rules) if (!rules.some((existing) => existing.key === rule.key)) rules.push(rule);
  }
  const barren = staged.filter((group) => group.rules.length === 0).length;
  if (barren) {
    limitations.push(`${barren} retrieved document(s) yielded no extractable rule, so nothing from them is asserted.`);
  }
  const draftCount = documents.filter((document) => document.draftOrProposed).length;
  if (draftCount) {
    limitations.push(
      `${draftCount} retrieved document(s) call themselves PROPOSED or DRAFT. Their rules are used only where no adopted document supplied the same rule, and every one of them says so.`,
    );
  }

  if (!documents.length) {
    limitations.push('No current subdivision regulation document was retrieved, so no rule is established for this parcel.');
  }
  const undated = documents.filter((document) => !document.adoptedOrAsOf).length;
  if (undated) limitations.push(`${undated} retrieved regulation document(s) print no adoption or amendment date, so currency could not be confirmed from the document itself.`);

  return {
    dealCardId: subject.dealCardId,
    authorityName: authority?.name ?? null,
    authorityDetermination: authority?.determination ?? 'not_supplied',
    documents,
    rules,
    thresholds: readMinorMajorThresholds(rules),
    reviewSequence: readReviewSequence(rules),
    limitations: [...new Set(limitations)],
    retrievedAt: now,
    race: raceRecordOf(race),
  };
}
