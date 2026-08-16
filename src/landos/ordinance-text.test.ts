// Ordinance text: a rule value must be a COMPLETE rule.
//
// Every case here is a real truncation a live Fairview run produced. The cause
// was always the same: an ordinance is full of periods that do not end a
// sentence — "four (4) acres", "Subsection 2-101.1", "Sec. 4.1", "1. Single-
// family dwellings" — and an extractor that stops at the first dot cuts the
// number off the rule it belongs to.

import { describe, expect, it, vi } from 'vitest';

// Pre-existing, unrelated: `comps.ts` at HEAD imports an uncommitted module.
vi.mock('./comps.js', () => ({
  listComps: () => [], addComp: () => ({}), getComp: () => undefined, deleteComp: () => false,
  upsertNormalizedComp: () => ({}), retireForkedCompRow: () => undefined,
  enrichCompCoordinates: async () => [], geocodeAddressesToCache: async () => [],
  extractListingCoordinates: () => null, recommendCompSources: () => [],
  evaluateCompRecency: () => ({ stale: false, note: '' }), isPaidCompAllowed: () => false,
  assertPaidCompAllowed: () => undefined, PAID_COMP_TOOLS: [],
}));

import {
  completeRuleValue,
  endsSentenceAt,
  flattenOrdinanceText,
  looksLikeTableOfContents,
  sectionCitationBefore,
  sectionCitationIn,
  statesMeasurement,
} from './ordinance-text.js';
import { readZoningStandards } from './current-zoning-determination.js';
import { readAllowedUses } from './zoning-standards-research.js';
import { extractSubdivisionRules, readMinorMajorThresholds } from './subdivision-regulations.js';

describe('sentence detection', () => {
  it('treats a period as a sentence end only before a capital or the end of the text', () => {
    expect(endsSentenceAt('four (4) acres. Minimum lot width', 14)).toBe(true);
    expect(endsSentenceAt('one (1) acre.', 12)).toBe(true);
    // The period inside a section number, an abbreviation, or a numbered list.
    expect(endsSentenceAt('Subsection 2 - 101. 1, are not met', 18)).toBe(false);
    expect(endsSentenceAt('Sec. 4.1 applies', 4)).toBe(false);
    expect(endsSentenceAt('shall be four (4.5) acres', 17)).toBe(false);
  });

  it('extends a truncated match to the end of its sentence', () => {
    const text = 'Minimum lot size shall be one (1) acre where public sewer is not available. Minimum lot width shall be 100 feet.';
    // What a `[^.]`-terminated pattern would have captured.
    const truncated = 'Minimum lot size shall be one (1) acre where public sewer is not available';
    expect(completeRuleValue(text, 0, truncated)).toBe(truncated);

    const wrapped = 'Minor Subdivision means a division of land as set out in Subsection 2 - 101. 1, that does not require a new street. Major Subdivision means any other division.';
    const cut = 'Minor Subdivision means a division of land as set out in Subsection 2 - 101';
    const completed = completeRuleValue(wrapped, 0, cut);
    expect(completed).toMatch(/does not require a new street/);
    expect(completed).not.toMatch(/Major Subdivision/);
  });

  it('stops at a section number, so one definition never swallows the next', () => {
    // Verbatim from a live Fairview run: the extension crossed "2 - 101.201"
    // and returned the minor AND major definitions as one value.
    const text = 'A land partition is exempt from major subdivision, or a land partition. '
      + '2 - 101.201 Major Subdivision A division of land into two (2) or more lots.';
    const cut = 'A land partition is exempt from major subdivision, or a land partition';
    expect(completeRuleValue(text, 0, cut)).toBe(cut);
    expect(endsSentenceAt(text, cut.length)).toBe(true);
    // But a subsection reference mid-sentence still is not a boundary.
    expect(endsSentenceAt('as set out in Subsection 2 - 101. 1, that does not', 32)).toBe(false);
  });

  it('never runs past a real sentence boundary, and is bounded', () => {
    const text = 'Minimum lot size shall be one (1) acre. Something else entirely. And more.';
    expect(completeRuleValue(text, 0, 'Minimum lot size shall be one (1) acre'))
      .toBe('Minimum lot size shall be one (1) acre');
    const runaway = `Minimum lot size shall be 1 acre${'. 2'.repeat(400)}`;
    expect(completeRuleValue(runaway, 0, 'Minimum lot size shall be 1 acre').length).toBeLessThan(400);
  });

  it('stops at a newline even when the period is not a sentence end', () => {
    const text = 'Minimum lot size shall be one (1) acre\nSection 4.2 Other district';
    expect(completeRuleValue(text, 0, 'Minimum lot size shall be one (1) acre'))
      .toBe('Minimum lot size shall be one (1) acre');
  });
});

// ── The three extractors, on wrapped PDF text ───────────────────────────────

const SOURCE = {
  sourceLabel: 'Fairview Zoning Ordinance',
  sourceUrl: 'https://www.fairview-tn.org/zoning.pdf',
  retrievedAt: '2026-08-15T00:00:00.000Z',
};

// ── Passage selection: a wrong rule is worse than no rule ──────────────────
//
// Both cases below are verbatim from a live Fairview run, and both were
// returned as this jurisdiction's controlling regulation.

describe('rejecting passages that are not rules', () => {
  it('recognises a table of contents', () => {
    expect(looksLikeTableOfContents(
      'Private Streets 4-109 Blocks 4-110 Lot Requirements 4-111 Open Space Requirements 4-112 '
      + 'Reservations and Easements 4-113 Drainage Storm Sewers, and Erosion Prevention 4-114',
    )).toBe(true);
    expect(looksLikeTableOfContents('Article 4 Design Standards .......... 17')).toBe(true);
    // A real rule that happens to cite one section is not a contents page.
    expect(looksLikeTableOfContents(
      'Each lot shall have frontage on a public street, as required by Section 4-102.2.',
    )).toBe(false);
    expect(looksLikeTableOfContents(
      'Minimum lot size shall be one (1) acre where public sewer is not available.',
    )).toBe(false);
  });

  it('distinguishes a measurement from an incidental digit', () => {
    expect(statesMeasurement('shall be one (1) acre where public sewer is not available')).toBe(true);
    expect(statesMeasurement('shall be fifteen thousand (15,000) square feet')).toBe(true);
    expect(statesMeasurement('at least two hundred (200) feet along rural arterial highways')).toBe(true);
    expect(statesMeasurement('into not more than three (3) lots')).toBe(true);
    expect(statesMeasurement('not more than three lots fronting an existing road')).toBe(true);
    expect(statesMeasurement('shall not exceed 1,000 feet in length')).toBe(true);
    // The live failure: digits, and no measurement anywhere in it.
    expect(statesMeasurement(
      'minimum lot area required for such lots. 2. Within developments subject to the provisions '
      + 'of Article VI of these regulations, such land may be included as open space',
    )).toBe(false);
    expect(statesMeasurement('street frontage')).toBe(false);
    expect(statesMeasurement('DENSITY REGULATIONS 1.')).toBe(false);
  });

  it('returns UNKNOWN rather than a contents line or a cross-reference', () => {
    const document = flattenOrdinanceText(
      'SUBDIVISION REGULATIONS OF FAIRVIEW, TENNESSEE. Adopted March 4, 2019.\n'
      + 'TABLE OF CONTENTS\n'
      + 'Private Streets 4-109 Blocks 4-110 Lot Requirements 4-111 Open Space Requirements 4-112 '
      + 'Reservations and Easements 4-113 Drainage Storm Sewers 4-114 Water Facilities 4-115\n'
      + 'SECTION 3-101 Land dedicated for open space shall not be counted toward the '
      + 'minimum lot area required for such lots. 2. Within developments subject to the provisions '
      + 'of Article VI of these regulations, such land may be included as open space.',
    );
    const rules = extractSubdivisionRules({
      text: document,
      sourceLabel: 'Fairview Subdivision Regulations',
      sourceUrl: 'https://www.fairview-tn.org/subdivision.pdf',
      sourceTier: 'official_government_source',
      authorityName: 'Fairview',
      retrievedAt: '2026-08-15T00:00:00.000Z',
    });

    // The document states neither rule. Both must be absent, not approximated.
    expect(rules.find((rule) => rule.key === 'minimum_lot_size')).toBeUndefined();
    expect(rules.find((rule) => rule.key === 'public_private_road_rule')).toBeUndefined();
  });

  it('still finds the real rule when the contents page precedes it', () => {
    const document = flattenOrdinanceText(
      'TABLE OF CONTENTS\n'
      + 'Lot Requirements 4-111 Open Space 4-112 Easements 4-113 Water Facilities 4-115\n'
      + 'SECTION 4-111 Minimum lot size shall be one (1) acre where public sewer is not available.\n'
      + 'SECTION 4-109 Private streets shall be constructed to the same standard as public streets.',
    );
    const rules = extractSubdivisionRules({
      text: document,
      sourceLabel: 'Fairview Subdivision Regulations',
      sourceUrl: 'https://www.fairview-tn.org/subdivision.pdf',
      sourceTier: 'official_government_source',
      authorityName: 'Fairview',
      retrievedAt: '2026-08-15T00:00:00.000Z',
    });

    expect(rules.find((rule) => rule.key === 'minimum_lot_size')?.value)
      .toMatch(/one \(1\) acre where public sewer is not available/);
    expect(rules.find((rule) => rule.key === 'public_private_road_rule')?.value)
      .toMatch(/constructed to the same standard as public streets/);
  });

  it('drops a dimensional standard that states no measurement', () => {
    // "street frontage" with no number was released live as a frontage rule.
    const ordinance = 'Section 4-101 RS-15 District. Lots shall have street frontage. '
      + 'Minimum lot size shall be fifteen thousand (15,000) square feet.';
    const standards = readZoningStandards({ text: ordinance, districtCode: 'RS-15', ...SOURCE });
    expect(standards.minimumLotSize).toMatch(/15,000/);
    expect(standards.frontage).toBeNull();
  });
});


// ── The section a rule is printed under ────────────────────────────────────
//
// Both failures below are on the live Fairview card. A citation nobody can
// look up is worse than none: it sends a buyer to a section that says
// something else, and it says it with the confidence of a quoted regulation.

describe('citing the section a passage is actually printed under', () => {
  const cite = (text: string, needle: string): string | null =>
    sectionCitationBefore(flattenOrdinanceText(text), flattenOrdinanceText(text).indexOf(needle));

  it('reads a bare numbered heading as the heading it is', () => {
    // Fairview Article IV, verbatim. The lot-area rule is printed under
    // "4-110.2 Lot Dimensions", which carries no keyword — so the old parser
    // fell back to a cross-reference from an earlier sentence and cited a
    // section about critical lots.
    const text = 'Section 4-102.2 Critical Lots shall be designated on the face of the plat. '
      + '4-110.2 Lot Dimensions Lot area shall comply with the minimum standards of the Zoning Ordinance.';
    expect(cite(text, 'Lot area shall comply')).toBe('4-110.2');
  });

  it('keeps citing a normal headed section, including the spacing a PDF produces', () => {
    expect(cite('SECTION 1 - 112 VARIANCES. Minimum lot frontage shall be two hundred (200) feet.', 'Minimum lot frontage'))
      .toBe('SECTION 1 - 112');
    expect(cite('Section 4.1 Minimum lot size shall be one (1) acre.', 'Minimum lot size')).toBe('Section 4.1');
    expect(cite('Sec. 8-40. - Definitions. Minor subdivision means four lots.', 'Minor subdivision means')).toBe('Sec. 8-40');
  });

  it('never promotes a cross-reference over the heading the rule sits under', () => {
    const text = '4-110 Lot Requirements Each lot shall have frontage on a public street, '
      + 'as required by Section 4-102.2. Minimum lot size shall be one (1) acre.';
    expect(cite(text, 'Minimum lot size')).toBe('4-110');
  });

  it('rejoins a heading number the PDF text layer split', () => {
    // Fairview's adopted regulations print "2-101.203"; the text layer renders
    // it "2 - 10 1.203". Reading from the space cites "1.203", which is not a
    // section of anything.
    const text = '2 - 101.202 Minor Subdivision A division of land where the conditions for major subdivision '
      + 'review, as set out in Subsection 2 - 101.201, are not present. '
      + '2 - 10 1.203 Partition A division of land creating not more than two lots.';
    expect(cite(text, 'not more than two lots')).toBe('2 - 101.203');
  });

  it('never reads a PDF running footer as a section', () => {
    const text = 'Fairview Subdivision Regulations Article 1 - Page 7 '
      + 'Minimum lot size shall be one (1) acre where public sewer is not available.';
    expect(cite(text, 'Minimum lot size')).toBeNull();
    expect(cite('Article IV Page 3 of 41 Minimum lot size shall be one (1) acre.', 'Minimum lot size')).toBeNull();
  });

  it('never reads a quantity, a date or a list ordinal as a bare heading', () => {
    expect(cite('Cul-de-sac streets shall not exceed 1,000 feet. Minimum lot size shall be one (1) acre.', 'Minimum lot size'))
      .toBeNull();
    expect(cite('Adopted March 4, 2019. Minimum lot size shall be one (1) acre.', 'Minimum lot size')).toBeNull();
    expect(cite('Permitted uses shall be: 1. Single-family dwellings. Minimum lot size shall be one (1) acre.', 'Minimum lot size'))
      .toBeNull();
  });

  it('falls back to a reference only when the document prints no heading in range', () => {
    // Honest and usable: the regulations say where the rule lives even though
    // this page never prints a heading. It is a fallback, never a preference.
    expect(cite('as provided in Section 3-101, the plat shall be recorded with the register of deeds.', 'the plat shall be recorded'))
      .toBe('Section 3-101');
    expect(cite('Minimum lot size shall be one (1) acre.', 'Minimum lot size')).toBeNull();
  });

  it('opens a district block at the heading that introduces it', () => {
    expect(sectionCitationIn('Section 4.1 RS-15 Residential Suburban District. Minimum lot size shall be 15,000 square feet.'))
      .toBe('Section 4.1');
    expect(sectionCitationIn('Minimum lot size shall be one (1) acre.')).toBeNull();
  });
});


describe('dimensional standards keep the number attached to the rule', () => {
  it('retains the unit after a parenthesised numeral', () => {
    // Exactly the live truncation: "minimum lot area shall be four (4)".
    const ordinance = flattenOrdinanceText(
      'Section 4-201 R-20 Residential District.\n'
      + 'The minimum lot area shall be four (4) acres per dwelling unit.\n'
      + 'Minimum lot width shall be two hundred (200) feet at the building setback line.\n'
      + 'Section 4-301 R-40 Residential District. The minimum lot area shall be forty thousand (40,000) square feet.',
    );
    const standards = readZoningStandards({ text: ordinance, districtCode: 'R-20', ...SOURCE });

    expect(standards.minimumLotSize).toBe('minimum lot area shall be four (4) acres per dwelling unit');
    expect(standards.lotWidth).toBe('Minimum lot width shall be two hundred (200) feet at the building setback line');
    // The next district's number must still not leak in.
    expect(JSON.stringify(standards)).not.toMatch(/40,000/);
  });

  it('retains a rule that cites a section mid-sentence', () => {
    const ordinance = 'Section 5-101 RS-15 District. Minimum lot frontage shall be one hundred (100) feet, measured as required by Sec. 3.4 of these regulations.';
    const standards = readZoningStandards({ text: ordinance, districtCode: 'RS-15', ...SOURCE });
    expect(standards.frontage).toMatch(/one hundred \(100\) feet/);
    expect(standards.frontage).toMatch(/Sec\. 3\.4 of these regulations$/);
  });
});

describe('subdivision rules keep the whole rule', () => {
  const REGULATIONS = flattenOrdinanceText(
    'SUBDIVISION REGULATIONS OF FAIRVIEW, TENNESSEE. Adopted March 4, 2019.\n'
    + 'SECTION 2 - 110 DEFINITIONS.\n'
    + 'Minor Subdivision A division of land into not more than three (3) lots, as set out in Subsection 2 - 101. 1, '
    + 'which fronts on an existing public road and requires no new street.\n'
    + 'Major Subdivision A division of land into four (4) or more lots, or any division requiring a new street.\n'
    + 'SECTION 4 - 101 Minimum lot size shall be one (1) acre where public sewer is not available.\n'
    + 'SECTION 4 - 102 Minimum lot frontage shall be two hundred (200) feet on a public road.',
  );

  it('retains the lot count that decides the review path', () => {
    const rules = extractSubdivisionRules({
      text: REGULATIONS,
      sourceLabel: 'Fairview Subdivision Regulations',
      sourceUrl: 'https://www.fairview-tn.org/subdivision.pdf',
      sourceTier: 'official_government_source',
      authorityName: 'Fairview',
      retrievedAt: '2026-08-15T00:00:00.000Z',
    });

    const minor = rules.find((rule) => rule.key === 'minor_subdivision_definition');
    // The live failure stopped at "Subsection 2 - 101" and lost everything after.
    expect(minor?.value).toMatch(/not more than three \(3\) lots/);
    expect(minor?.value).toMatch(/requires no new street$/);
    expect(minor?.value).not.toMatch(/Major Subdivision/);
    expect(readMinorMajorThresholds(rules).statedMaxMinorLots).toBe(3);

    expect(rules.find((rule) => rule.key === 'minimum_lot_size')?.value)
      .toBe('Minimum lot size shall be one (1) acre where public sewer is not available');
    expect(rules.find((rule) => rule.key === 'minimum_frontage')?.value)
      .toBe('Minimum lot frontage shall be two hundred (200) feet on a public road');
  });
});

describe('allowed uses keep the whole list', () => {
  it('retains a numbered use list past its item periods', () => {
    const ordinance = flattenOrdinanceText(
      'Section 4-101 RS-15 Residential Suburban District.\n'
      + 'Permitted uses in the RS-15 district shall be: 1. Single-family dwellings. 2. Public parks. 3. Agriculture, '
      + 'subject to Sec. 5.2 of this ordinance.\n'
      + 'Section 4-201 R-20 Residential District. Permitted uses shall be single-family dwellings only.',
    );
    const uses = readAllowedUses({
      text: ordinance,
      districtCode: 'RS-15',
      sourceLabel: 'Fairview Zoning Ordinance',
      sourceUrl: 'https://www.fairview-tn.org/zoning.pdf',
    });

    const permitted = uses.find((use) => use.status === 'permitted');
    expect(permitted?.use).toMatch(/Single-family dwellings/);
    expect(permitted?.use).toMatch(/Public parks/);
    expect(permitted?.use).toMatch(/Agriculture/);
    // And still nothing from the neighbouring district.
    expect(permitted?.use).not.toMatch(/R-20/);
  });
});
