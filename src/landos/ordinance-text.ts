// LandOS — reading a rule out of ordinance text without cutting it in half.
//
// Every land-use extractor matches a rule with a pattern that runs to the end
// of the sentence, and every one of them expressed "end of the sentence" as
// `[^.\n]` — stop at the first period. Ordinances are full of periods that end
// nothing:
//
//     "the minimum lot area shall be four (4) acres"   → cut at "four (4)"
//     "as set out in Subsection 2 - 101. 1, which…"    → cut at "2 - 101"
//     "measured as required by Sec. 3.4"               → cut at "Sec"
//     "1. Single-family dwellings. 2. Public parks."   → cut at "1"
//
// Each of those live truncations dropped the number the rule exists to carry,
// which is the difference between a citable regulation and a fragment.
//
// The fix is one rule in one place rather than a fourth variation of the same
// character class in a fourth regex table: match as before, then EXTEND the
// match forward across any period that does not actually end a sentence.
// Keeping the patterns unchanged is deliberate — they are tuned, they are
// tested, and rewriting six regex literals to express this would reintroduce
// the drift that caused the bug.

/** Undo a PDF text layer's line wrapping before reading rules out of it. */
export function flattenOrdinanceText(text: string): string {
  return text.replace(/\r/g, '').replace(/\s*\n\s*/g, ' ').replace(/[ \t]{2,}/g, ' ');
}

/**
 * Does the period at `index` end a sentence?
 *
 * A sentence ends when the period is followed by whitespace and a capital, or
 * by the end of the text. Everything else — a decimal, a section number, an
 * abbreviation, a numbered list item — is punctuation inside the rule.
 *
 * Deliberately conservative in one direction: a sentence that genuinely starts
 * with a lowercase word or a digit will be joined to the previous one. That
 * costs a slightly long value. The opposite error costs the number.
 */
export function endsSentenceAt(text: string, index: number): boolean {
  if (text[index] !== '.') return false;
  const rest = text.slice(index + 1);
  if (/^\s*$/.test(rest)) return true;
  // A bare SECTION NUMBER starts a new clause. Without this the extension
  // walked out of the minor-subdivision definition, through "2 - 101.201", and
  // into the major-subdivision definition — one value containing both.
  //
  // Unless the period belongs to the abbreviation in front of it: "required by
  // Sec. 3.4 of these regulations" is a cross-reference inside the rule, not
  // the start of a new one.
  if (/^\s+\d{1,4}\s*[-.]\s*\d/.test(rest)) {
    return !/\b(?:sec|art|ch|no|subsec|para|fig|div|art)$/i.test(text.slice(Math.max(0, index - 8), index));
  }
  if (!/^\s+[A-Z]/.test(rest)) return false;
  // "…shall be: 1. Single-family dwellings. 2. Public parks." An enumerated
  // list item looks exactly like a sentence boundary — a short ordinal, a
  // period, a space, a capital — and treating it as one keeps the first item
  // and throws the rest of the permitted-use list away.
  return !isListMarkerBefore(text, index);
}

/** Is the token immediately before this period a list ordinal, like "1" or "a"? */
function isListMarkerBefore(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 4), index);
  return /(?:^|[\s(:;])(?:\d{1,2}|[a-zA-Z])$/.test(before);
}

/** How far past its match a value may be extended. Bounds a runaway document. */
const MAX_EXTENSION = 320;

/**
 * Extend a matched rule value to the end of the sentence it belongs to.
 *
 * Walks forward from where the pattern stopped, stepping over each period that
 * `endsSentenceAt` rejects, and halts at the first real sentence end, at a
 * newline, or at the extension bound.
 */
export function completeRuleValue(text: string, start: number, matched: string): string {
  let at = start + matched.length;
  const limit = Math.min(text.length, at + MAX_EXTENSION);

  while (at < limit) {
    // The pattern stopped here for a reason: either a period or a newline.
    if (text[at] !== '.') break;
    if (endsSentenceAt(text, at)) break;
    at += 1;
    // Consume up to the next period or newline, exactly as the pattern would.
    while (at < limit && text[at] !== '.' && text[at] !== '\n') at += 1;
  }
  return text.slice(start, at);
}

/**
 * A TABLE OF CONTENTS, not a rule.
 *
 * "Private Streets 4-109 Blocks 4-110 Lot Requirements 4-111 Open Space
 * Requirements 4-112 …" is a contents listing, and a live run returned it as
 * this jurisdiction's private-road rule. It regulates nothing; it is a list of
 * places where rules live. Three or more section numbers in one passage, or dot
 * leaders, is a contents line and never a citable regulation.
 */
export function looksLikeTableOfContents(value: string): boolean {
  if (/\.{4,}/.test(value)) return true;
  return (value.match(/\b\d{1,2}\s*-\s*\d{2,3}\b/g) ?? []).length >= 3;
}

/** Numbers a regulation spells out, so "three (3) lots" and "three lots" both read. */
const SPELLED = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand';

/**
 * Does this passage state an actual MEASUREMENT?
 *
 * A quantity with a unit — acres, square feet, feet, lots, units — not merely
 * a digit. That distinction is the whole fix for one live failure: "minimum lot
 * area required for such lots. 2. Within developments subject to the provisions
 * of Article VI of these regulations…" contains digits ("2", "VI" aside) and
 * states no minimum lot size at all. It was returned as one.
 */
export function statesMeasurement(value: string): boolean {
  const quantity = `(?:\\b\\d[\\d,]*(?:\\.\\d+)?|\\(\\s*\\d[\\d,]*\\s*\\)|\\b(?:${SPELLED})\\b)`;
  const unit = '(?:acres?|square\\s*(?:feet|foot)|sq\\.?\\s*ft\\.?|sf\\b|feet|foot|ft\\.?\\b|lots?|units?|dwellings?|percent|%|miles?)';
  return new RegExp(`${quantity}\\s*\\)?\\s*(?:${unit})`, 'i').test(value);
}

/**
 * Match a pattern and return the COMPLETE rule value it names.
 *
 * Scans past any candidate that is a contents line rather than a rule, so a
 * document whose only hit is in its own index yields nothing — which is the
 * correct answer. The one call site every extractor should use, so "what counts
 * as the end of a rule" is answered identically for zoning standards, allowed
 * uses and subdivision regulations.
 */
export function matchRuleValue(text: string, pattern: RegExp): { value: string; index: number } | null {
  return scanForRuleValue(text, pattern, (value) => !looksLikeTableOfContents(value));
}

/**
 * The first match that states an actual measurement, completed to its sentence
 * end and not drawn from a contents listing.
 *
 * A rule whose whole point is a number — minimum lot size, frontage, lot width,
 * a lot ceiling — is not that rule without one. Returning nothing is right when
 * the document never states it here: a wrong minimum lot size is underwritten,
 * an absent one is asked about.
 */
export function matchNumericRuleValue(text: string, pattern: RegExp): { value: string; index: number } | null {
  return scanForRuleValue(text, pattern, (value) => statesMeasurement(value) && !looksLikeTableOfContents(value));
}

/** Walk the matches, completing each, until one is citable. Bounded. */
function scanForRuleValue(
  text: string,
  pattern: RegExp,
  citable: (value: string) => boolean,
): { value: string; index: number } | null {
  const scan = new RegExp(pattern.source, `${pattern.flags.replace(/g/g, '')}g`);
  let match: RegExpExecArray | null;
  let scanned = 0;
  while ((match = scan.exec(text)) !== null && scanned < 40) {
    scanned += 1;
    const value = completeRuleValue(text, match.index, match[0]);
    if (citable(value)) return { value, index: match.index };
    if (match.index === scan.lastIndex) scan.lastIndex += 1;
  }
  return null;
}


// ── Scoping to one district's block ─────────────────────────────────────────

/**
 * The spellings of a district code worth looking for.
 *
 * A packet's PDF text layer prints "R - 20 POD"; the ordinance heading says
 * "R-20". The overlay suffix is a real part of the district, and it is also a
 * real reason the district's block is never found, so the base code is tried
 * after the full one rather than instead of it.
 */
export function districtCodeVariants(districtCode: string): string[] {
  const trimmed = districtCode.replace(/\s+/g, ' ').trim();
  const variants = [trimmed];
  const withoutOverlay = trimmed.replace(/\s*\b(?:POD|PUD|PD|OD|OVERLAY)\b\s*$/i, '').trim();
  if (withoutOverlay && withoutOverlay !== trimmed) variants.push(withoutOverlay);
  const compact = withoutOverlay.replace(/\s*-\s*/g, '-');
  if (compact && !variants.includes(compact)) variants.push(compact);
  return variants;
}

// ── The section a passage is actually printed under ────────────────────────
//
// Every land-use extractor cites its rules, and each carried its own copy of
// one regex plus "take the last match before the passage". That rule reads a
// document as if the only way to print a section is to write the word. Two
// live failures came straight out of it, both visible on the Fairview card:
//
//   "…on the face of the plat. 4-110.2 Lot Dimensions Lot area shall comply…"
//        → cited Section 4-102.2, a CROSS-REFERENCE printed earlier, because
//          the real heading in front of the rule carries no keyword.
//   "Fairview Subdivision Regulations Article 1 - Page 7"
//        → cited "Article 1 - Page", a running FOOTER read as a section
//          number, because any word was allowed inside the number.
//
// So the citation is chosen the way a reader chooses one: find every thing
// that could be a section reference, decide which are HEADINGS introducing a
// passage and which are references inside a sentence, and prefer the nearest
// heading. A reference is used only when the document prints no heading in
// range — still better than nothing, and it stays honest by never being
// preferred over the heading the rule is actually printed under.

const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();

/**
 * How a document announces a section, tolerant of a PDF text layer.
 *
 * Real regulations print "SECTION 1-101" and the extractor sees "SECTION 1 -
 * 101", because the glyphs wrapped. Requiring the separator to be tight made
 * every rule in the real Fairview document cite no section at all.
 */
const SECTION_KEYWORD = '(?:§|\\bSection\\b|\\bSec\\.|\\bArticle\\b|\\bArt\\.|\\bChapter\\b|\\bCh\\.)';

/**
 * A digit group, tolerating the space a PDF text layer drops inside one.
 *
 * The adopted Fairview regulations print "2-101.203" and the text layer
 * renders it "2 - 10 1.203"; a parser that stops at that space cites "1.203",
 * a section that does not exist. Bounded at four digits so it cannot run into
 * a number standing beside it.
 */
const DIGITS = '[0-9](?:\\s?[0-9]){0,3}(?![0-9])';

/**
 * The FIRST group takes no internal space. It is the one place a section
 * number touches ordinary text, and letting it reach across a space glues a
 * page number onto the article: "Page 14 2 - 108.602" cited as "142-108.602".
 */
const SECTION_HEAD = '[0-9]{1,3}(?![0-9])';

/**
 * What follows the first group: "4-110.2", "1 - 112", "5.1.A".
 *
 * Digits, or a one/two letter subsection suffix. Allowing any word here is
 * exactly how "Article 1 - Page 7" became a citation: "Page" was read as part
 * of the section number.
 */
const SECTION_COMPONENT = `(?:\\s*[.\\-]\\s*(?:${DIGITS}|[A-Za-z]{1,2}(?![A-Za-z])))`;

const KEYWORD_SECTION = new RegExp(`${SECTION_KEYWORD}\\s*${SECTION_HEAD}${SECTION_COMPONENT}*`, 'gi');

/**
 * A section number printed with no keyword in front of it.
 *
 * At least one separator is required, so an ordinary quantity ("three lots",
 * "1,000 feet") can never be mistaken for a section. The lookbehind keeps it
 * out of the middle of a longer number, a date or a dollar figure.
 */
const BARE_SECTION = new RegExp(`(?<![\\w.,$-])${SECTION_HEAD}${SECTION_COMPONENT}+`, 'g');

/** A heading names its subject: the number is followed by a capitalised word. */
const HEADING_LABEL = /^\s+[A-Z]/;

/** How far past a passage to read, so the heading in front of it is classifiable. */
const HEADING_LOOKAHEAD = 24;

/**
 * Wording that makes what follows a CROSS-REFERENCE rather than a heading.
 *
 * "as required by Section 4-102.2" points at a section; it does not introduce
 * one, and the rule beside it does not live there.
 */
const CROSS_REFERENCE_CUE =
  /\b(?:by|in|under|per|see|of|to|with|within|from|pursuant\s+to|accordance\s+with|set\s+forth\s+in|provided\s+in|specified\s+in|described\s+in|defined\s+in|required\s+in|comply\s+with|complies\s+with|conform\s+to)\s*$/i;

/** A PDF running footer. It is printed on every page and regulates nothing. */
const FOOTER_AFTER = /^\s*[-–—|]?\s*(?:Page\b|of\s+\d)/i;
const FOOTER_BEFORE = /\bPage\s*$/i;

interface SectionCandidate {
  citation: string;
  start: number;
  end: number;
  heading: boolean;
}

function sectionCandidateAt(text: string, at: number, matched: string): SectionCandidate | null {
  const after = text.slice(at + matched.length, at + matched.length + HEADING_LOOKAHEAD);
  const before = text.slice(Math.max(0, at - 48), at);
  if (FOOTER_AFTER.test(after) || FOOTER_BEFORE.test(before)) return null;
  return {
    // Rejoin only the digits the text layer split. The spacing a document
    // prints around its separators is left exactly as printed, because that is
    // how the section reads on the page anyone will look it up on.
    citation: clean(matched).replace(/([0-9]) +(?=[0-9])/g, '$1'),
    start: at,
    end: at + matched.length,
    heading: HEADING_LABEL.test(after) && !CROSS_REFERENCE_CUE.test(before),
  };
}

/** Every section reference in a passage, in the order the document prints them. */
function sectionCandidates(text: string): SectionCandidate[] {
  const found: SectionCandidate[] = [];
  const keywordSpans: Array<[number, number]> = [];
  for (const match of text.matchAll(KEYWORD_SECTION)) {
    const at = match.index ?? 0;
    keywordSpans.push([at, at + match[0].length]);
    const candidate = sectionCandidateAt(text, at, match[0]);
    if (candidate) found.push(candidate);
  }
  for (const match of text.matchAll(BARE_SECTION)) {
    const at = match.index ?? 0;
    // The number inside "Section 4-110.2" is that same citation, not a second one.
    if (keywordSpans.some(([from, to]) => at >= from && at < to)) continue;
    const candidate = sectionCandidateAt(text, at, match[0]);
    // With no keyword in front of it, only a HEADING is a citation. A bare
    // number in running prose is a quantity, a date or a list ordinal.
    if (candidate?.heading) found.push(candidate);
  }
  return found.sort((a, b) => a.start - b.start);
}

/**
 * The section this passage is printed under.
 *
 * Strictly BEFORE, and that matters: a regulation document prints its sections
 * in order, so a window that also looked forward would attribute a rule to the
 * NEXT section — "Minimum lot size" in Section 4.1 cited as Section 5.1, which
 * is a citation that fails the moment anyone checks it.
 *
 * A wide window by default, because flattening the line wrapping puts a whole
 * page of dense prose between a heading and the rule it introduces.
 */
export function sectionCitationBefore(text: string, index: number, window = 1_200): string | null {
  // Read a little PAST the passage, and keep only what ends before it. What
  // follows a section number is how a heading is told from a cross-reference,
  // and a window cut exactly at the passage hides that from the heading
  // nearest it — the one candidate whose classification matters most.
  const from = Math.max(0, index - window);
  const before = text.slice(from, index + HEADING_LOOKAHEAD);
  const candidates = sectionCandidates(before).filter((candidate) => candidate.end <= index - from);
  const headings = candidates.filter((candidate) => candidate.heading);
  const chosen = headings.length > 0 ? headings[headings.length - 1] : candidates[candidates.length - 1];
  return chosen ? chosen.citation : null;
}

/** The section a passage OPENS under: the first heading printed inside it. */
export function sectionCitationIn(text: string): string | null {
  const candidates = sectionCandidates(text.slice(0, 4_000));
  return (candidates.find((candidate) => candidate.heading) ?? candidates[0])?.citation ?? null;
}

/** Where the sentence containing `index` begins. Bounded, so a heading-less
 *  wall of text does not drag the whole page into the block. */
function sentenceStartBefore(text: string, index: number, maxBack = 240): number {
  const floor = Math.max(0, index - maxBack);
  for (let at = index - 1; at >= floor; at -= 1) {
    if (endsSentenceAt(text, at)) return at + 1;
  }
  return floor;
}

/** A token that looks like a district code, e.g. "R-20", "RS15", "AG". */
const DISTRICT_CODE = /\b([A-Z]{1,3}-\d{1,3}|[A-Z]{1,2}\d{1,3}|[A-Z]{2,3})\b/g;

const normalizeCode = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Narrow ordinance text to one district's own block.
 *
 * A zoning ordinance carries every district's numbers, and reading the wrong
 * district's minimum lot size is worse than reading none.
 *
 * Two properties this has to get right, and a regex tuned for one shape kept
 * breaking the other:
 *   • It FLATTENS first. The heading, the standards and the use list are
 *     routinely split across PDF line wraps, and a `\n`-anchored scoper reads a
 *     fraction of the block.
 *   • It starts at the SENTENCE containing the district heading, so the
 *     "Section 4.1" that introduces it is inside the block and can be cited.
 *
 * So the boundaries are computed with sentence arithmetic rather than with one
 * elaborate pattern: find the district, walk back to the start of its sentence,
 * and end at the sentence that introduces a DIFFERENT district.
 *
 * Returns null when the document never names this district as a district —
 * the correct contribution from a document that does not regulate it.
 */
export function scopeToDistrictBlock(text: string, districtCode: string): { text: string; section: string | null } | null {
  const flat = flattenOrdinanceText(text);
  const own = normalizeCode(districtCode);

  // EVERY occurrence, not the first. An ordinance names "R-20" in its table of
  // contents and in a dozen cross-references before it reaches the section
  // that regulates it; anchoring on the first hit found a contents line and
  // read nothing. The block is the first occurrence introduced AS a district.
  let at = -1;
  let matched = '';
  for (const variant of districtCodeVariants(districtCode)) {
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    const scan = new RegExp(`\\b${escaped}\\b`, 'gi');
    let found: RegExpExecArray | null;
    while ((found = scan.exec(flat)) !== null) {
      if (!/\b(?:district|zone|zoning)\b/i.test(flat.slice(found.index, found.index + 200))) continue;
      at = found.index;
      matched = found[0];
      break;
    }
    if (at >= 0) break;
  }
  if (at < 0) return null;

  const start = sentenceStartBefore(flat, at);

  // End at the sentence that introduces a different district.
  let end = Math.min(flat.length, start + 14_000);
  DISTRICT_CODE.lastIndex = at + matched.length;
  let candidate: RegExpExecArray | null;
  while ((candidate = DISTRICT_CODE.exec(flat)) !== null) {
    if (candidate.index >= end) break;
    if (normalizeCode(candidate[1]) === own) continue;
    if (!/\b(?:district|zone)\b/i.test(flat.slice(candidate.index, candidate.index + 90))) continue;
    end = sentenceStartBefore(flat, candidate.index);
    break;
  }
  DISTRICT_CODE.lastIndex = 0;

  const block = flat.slice(start, Math.max(end, at + matched.length));
  return { text: block.trim(), section: sectionCitationIn(block) };
}
