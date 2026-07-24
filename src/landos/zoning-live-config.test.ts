import zlib from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { countPdfPages, extractPdfText, pdfTextIncludes } from './pdf-text.js';
import {
  findZoningJurisdictionConfig,
  NATIONAL_BOUNDARY_SOURCES,
  ZONING_JURISDICTION_CONFIGS,
} from './zoning-adapters.js';

function syntheticPdf(text: string): Buffer {
  const content = `BT /F1 12 Tf (${text.replace(/([\\()])/g, '\\$1')}) Tj ET`;
  const deflated = zlib.deflateSync(Buffer.from(content, 'latin1'));
  return Buffer.concat([
    Buffer.from('%PDF-1.7\n1 0 obj <</Filter/FlateDecode>>\nstream\n', 'latin1'),
    deflated,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
  ]);
}

describe('pdf text probing', () => {
  it('extracts literal text-operator strings from flate streams', () => {
    const text = extractPdfText(syntheticPdf('2403. COASTAL AND LAKES RESIDENTIAL DISTRICT (CLR)'));
    expect(pdfTextIncludes(text, '2403. COASTAL AND LAKES RESIDENTIAL DISTRICT (CLR)')).toBe(true);
  });

  it('returns empty text for undecodable bytes so callers can report an honest gap', () => {
    expect(extractPdfText(Buffer.from('not a pdf at all'))).toBe('');
  });

  it('pdfTextIncludes is whitespace- and case-insensitive', () => {
    expect(pdfTextIncludes('MAXIMUM   Lot\nCoverage', 'maximum lot coverage')).toBe(true);
    expect(pdfTextIncludes('unrelated', 'maximum lot coverage')).toBe(false);
  });

  it('counts PDF pages honestly from the page tree (regression: artifact-metadata-page-count-wrong)', () => {
    const multiPage = Buffer.from(
      '%PDF-1.7\n1 0 obj <</Type /Pages /Count 51>> endobj\n'
      + Array.from({ length: 51 }, (_, i) => `${i + 2} 0 obj <</Type /Page>> endobj`).join('\n')
      + '\n%%EOF',
      'latin1',
    );
    expect(countPdfPages(multiPage)).toBe(51);
    expect(countPdfPages(Buffer.from('%PDF-1.4\n1 0 obj <</Type /Page>> endobj\n%%EOF', 'latin1'))).toBe(1);
    expect(countPdfPages(Buffer.from('not a pdf'))).toBeNull();
  });
});

describe('Citrus County zoning jurisdiction configuration', () => {
  const config = findZoningJurisdictionConfig('Citrus', 'FL')!;

  it('matches Citrus County FL and only official county endpoints are configured', () => {
    expect(config).toBeTruthy();
    expect(findZoningJurisdictionConfig('Citrus', 'Florida')).toBe(config);
    expect(findZoningJurisdictionConfig('Roane', 'TN')).toBeNull();
    expect(config.zoningGis!.layerUrl).toContain('maps.citrusbocc.com');
    expect(config.ordinance!.documents[0].url).toContain('citrusfl');
    for (const source of config.extraBoundarySources ?? []) {
      expect(source.url).toContain('maps.citrusbocc.com');
    }
  });

  it('national boundary defaults are the official US Census TIGERweb layers', () => {
    expect(NATIONAL_BOUNDARY_SOURCES.incorporatedPlaces.url).toContain('tigerweb.geo.census.gov');
    expect(NATIONAL_BOUNDARY_SOURCES.countySubdivisions.url).toContain('tigerweb.geo.census.gov');
  });

  it('emits CLR use and dimensional claims only when the anchors exist in the retrieved ordinance text', () => {
    const text = [
      'CHAPTER TWO LAND USE DISTRICTS',
      '2403. COASTAL AND LAKES RESIDENTIAL DISTRICT (CLR)',
      'Single Family P Group Home C',
      'Accessory Structure P',
      'Houses of Worship C',
      'Maximum Lot Coverage 40%',
      'Floor Area Ratio (non-residential uses only) 0.2',
      'cannot be further subdivided',
      '0.5 acre per unit',
      'minimum 100 feet for residential',
      'at least 40 feet on a street',
    ].join('\n');
    const result = config.ordinance!.extract!({ documentKey: 'ldc-chapter-2-land-use-districts', text, districtCode: 'CLR MH' });
    const useNames = (result.useClaims ?? []).map((claim) => claim.useName);
    expect(useNames).toContain('Single Family');
    expect(useNames).toContain('Group Home');
    expect(useNames).toContain('Houses of Worship');
    // Anchors absent from this text are NOT emitted (no fabrication).
    expect(useNames.join(' ')).not.toMatch(/Golf Course|Nursing Homes|Wellfields/);
    const byRight = (result.useClaims ?? []).filter((claim) => claim.useCategory === 'permitted_by_right');
    const conditional = (result.useClaims ?? []).filter((claim) => claim.useCategory === 'conditional_or_special');
    expect(byRight.map((claim) => claim.useName)).toContain('Single Family');
    expect(conditional.map((claim) => claim.useName)).toContain('Group Home');
    // Every emitted claim cites the ordinance section.
    for (const claim of [...(result.useClaims ?? []), ...(result.dimensionalClaims ?? [])]) {
      expect(claim.citation?.ordinanceTitle).toContain('Citrus County Land Development Code');
      expect(claim.citation?.section).toBeTruthy();
    }
    const standards = (result.dimensionalClaims ?? []).map((claim) => claim.standardName);
    expect(standards).toContain('Maximum lot coverage');
    expect(standards).toContain('Minimum lot area (no central water and sewer)');
    expect(standards.join(' ')).not.toMatch(/right-of-way centerline/); // anchor absent above
  });

  it('a non-CLR district receives only the ordinance evidence, never another district\'s table', () => {
    const text = 'CHAPTER TWO LAND USE DISTRICTS\n2403. COASTAL AND LAKES RESIDENTIAL DISTRICT (CLR)\nSingle Family P';
    const result = config.ordinance!.extract!({ documentKey: 'ldc-chapter-2-land-use-districts', text, districtCode: 'GNC' });
    expect(result.useClaims ?? []).toHaveLength(0);
    expect(result.dimensionalClaims ?? []).toHaveLength(0);
    expect(result.ordinanceEvidence?.exactWording).toContain('Chapter Two');
  });

  it('an empty or changed document yields no claims at all', () => {
    expect(config.ordinance!.extract!({ documentKey: 'ldc-chapter-2-land-use-districts', text: '', districtCode: 'CLR' })).toEqual({});
    const changed = config.ordinance!.extract!({ documentKey: 'ldc-chapter-2-land-use-districts', text: 'SOMETHING ELSE ENTIRELY', districtCode: 'CLR' });
    expect(changed.useClaims ?? []).toHaveLength(0);
  });

  it('registry entries stay platform-reusable: every config exposes match(), never adapter code', () => {
    for (const entry of ZONING_JURISDICTION_CONFIGS) {
      expect(typeof entry.match).toBe('function');
      expect(entry.authorityConfigs.length).toBeGreaterThan(0);
    }
  });
});
