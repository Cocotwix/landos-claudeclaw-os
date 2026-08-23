// Form-based codes state the same numbers a different way.
//
// A conventional ordinance writes "the minimum lot area shall be four (4)
// acres". A character-district code publishes a table whose rows are a label
// and a measurement, and none of those rows contains the word "minimum" — so
// every prose pattern misses them and a district reads as having no standards
// at all. Fixture text is the real CD-3L table from the Fairview Development
// Code adopted 2 April 2026, flattened the way the PDF reader delivers it.

import { describe, expect, it } from 'vitest';

import {
  readFormBasedDistrictStandards,
  readZoningStandards,
} from './current-zoning-determination.js';

const CODE_URL = 'https://www.fairview-tn.org/content/uploads/docs/FAIRVIEW-DEVELOPMENT-CODE.pdf';

/** Real CD-3L Table 4.3.1-D text, including the prose that precedes it. */
const CD_3L_TABLE = [
  'CD-3L Table 4.3.1-D District Standards Neighborhood Large Character District CD-3L Neighborhood Large',
  'The CD-3L Neighborhood Large Character District consists of primarily a low density single-family detached',
  'Residential area in which Houses are the predominant Building Type. It has large lots, medium to deep front',
  'Setbacks and medium to wide side Setbacks.',
  'Block Size* *Applicable only to Development Sites. Block Perimeter 3200 ft. max.',
  'Permitted Uses See Table 4.3.9.A-1 (Building, Lot & Building Site Principal Uses).',
  'Number of Buildings Per Lot or Building Site Principal Building 1 max. Accessory Buildings 1 max.',
  'LEGEND The following notations are utilized in this table. P Permitted NP Not Permitted NA Not Applicable',
  'Density* *Applicable only to Development Sites. 2 dwelling units per acre max. 4',
  'Lot Occupation Lot / Building Site Width 100 ft. min., 150 ft. max. Frontage Buildout 40% min.',
  'Lot / Building Site Area NR Impervious Surface Coverage 60% max.',
  'Lot / Building Site Enfrontment Must Enfront a vehicular Thoroughfare.',
  'Setbacks / Yards Front Setback / Yard, Principal Frontage 40 ft. min. A Side Setback / Yard, each side 20 ft. min. C',
  'Rear Setback 30 ft. min. D',
  'Building Standards Building Height Principal Building 2 Stories max',
].join(' ');

describe('reading a form-based district table', () => {
  const standards = readFormBasedDistrictStandards({
    text: CD_3L_TABLE,
    sourceLabel: 'Fairview Development Code (adopted April 2, 2026)',
    sourceUrl: CODE_URL,
  });

  it('reads the density that binds a form-based site', () => {
    expect(standards.density).toBe('2 dwelling units per acre max.');
  });

  it('reads a lot width that carries BOTH a minimum and a maximum', () => {
    // The maximum is the unusual half and the one a subdivision layout has to
    // respect; dropping it would leave the reader thinking only 100 ft binds.
    expect(standards.lotWidth).toBe('100 ft. min., 150 ft. max.');
  });

  it('preserves "not regulated" as a finding rather than dropping the row', () => {
    // On a form-based site this is often THE finding: lot area is unregulated,
    // so density is what constrains yield.
    expect(standards.minimumLotSize).toBe('Not regulated by the district table');
  });

  it('reads frontage buildout, setbacks and coverage', () => {
    expect(standards.frontage).toBe('40% min.');
    expect(standards.setbacks).toBe('40 ft. min.');
    expect(standards.heightOrCoverage).toBe('60% max.');
  });

  it('is not fooled by the label appearing in the district prose first', () => {
    // "a low DENSITY single-family detached Residential area" precedes the
    // Density ROW. Reading the first match would report the description.
    expect(standards.density).not.toMatch(/single-family detached/);
  });

  it('trims the page number and diagram key off a row value', () => {
    // The source rows literally end "2 dwelling units per acre max. 4" and
    // "40 ft. min. A" — a page number and an illustration key.
    expect(standards.density).not.toMatch(/\s4$/);
    expect(standards.setbacks).not.toMatch(/\sA$/);
  });

  it('cites the code behind every value it read', () => {
    expect(standards.sources.length).toBeGreaterThanOrEqual(6);
    for (const source of standards.sources) {
      expect(source.url).toBe(CODE_URL);
      expect(source.quote.length).toBeGreaterThan(0);
    }
  });

  it('reports nothing from a document that carries no district table', () => {
    const empty = readFormBasedDistrictStandards({
      text: 'This page describes the comprehensive plan vision and contains no district standards.',
      sourceLabel: 'x', sourceUrl: null,
    });
    expect(empty.density).toBeNull();
    expect(empty.lotWidth).toBeNull();
    expect(empty.sources).toHaveLength(0);
  });
});

describe('the standards reader spans both code styles', () => {
  it('falls back to the table reader when the prose rules find nothing', () => {
    const standards = readZoningStandards({
      text: CD_3L_TABLE,
      districtCode: 'CD-3L',
      sourceLabel: 'Fairview Development Code (adopted April 2, 2026)',
      sourceUrl: CODE_URL,
    });
    expect(standards.density).toBe('2 dwelling units per acre max.');
    expect(standards.lotWidth).toBe('100 ft. min., 150 ft. max.');
  });

  it('still reads a conventional Euclidean ordinance by its prose', () => {
    const standards = readZoningStandards({
      text: 'Section 4-102. In the R-20 district the minimum lot area shall be twenty thousand (20,000) square feet and the minimum lot width shall be one hundred (100) feet.',
      districtCode: 'R-20',
      sourceLabel: 'Zoning Ordinance',
      sourceUrl: 'https://example.gov/zoning.pdf',
    });
    expect(standards.minimumLotSize).toMatch(/20,000|twenty thousand/i);
    expect(standards.lotWidth).toMatch(/100|one hundred/i);
    // The prose value is kept, not overwritten by a table pass.
    expect(standards.minimumLotSize).not.toBe('Not regulated by the district table');
  });
});
