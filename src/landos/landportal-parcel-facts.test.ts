import { describe, it, expect } from 'vitest';
import { normalizeLandPortalParcelFacts } from './landportal-parcel-facts.js';

// The parcel panel exactly as it was retained on the Deal 90 inspection.
const PANEL: Record<string, string> = {
  'Property Details': 'MLS Details',
  'Owner Name': 'HILL EUGENE W',
  'Parcel ID': '00083-A-03400',
  'Parcel Address': '19554 NW 137TH LN',
  Acres: '1.500',
  'MLS Acres': '-',
  'Calc Acres': '1.84',
  'Building SqFt': '0',
  'Parcel SqFt': '65340',
  'Land Locked': 'No',
  'Road Frontage': '157.40 ft',
  'Water Feature': 'Yes',
  'Water Feature type(s)': 'River, Swamp / Marsh',
  'Legal Description': '2 6S 20 LOT 34 OF RIVER OAK PLANTATION S/D. MISC MAP BK 1 PG 18.',
};

describe('the LandPortal parcel panel becomes normalized evidence', () => {
  const facts = normalizeLandPortalParcelFacts(PANEL);
  const value = (key: string) => facts.find((f) => f.factKey === key)?.normalizedValue;

  it('keeps the reported acreage and the calculated area as different facts', () => {
    // The pair that was collapsing into one wrong header number. A parcel
    // record reporting 1.500 and a polygon computing 1.84 measure different
    // things, so they stay two facts with two keys.
    expect(value('Parcel-record acreage')).toBe(1.5);
    expect(value('LandPortal calculated acreage')).toBe(1.84);
  });

  it('reads road frontage as feet, not as the string the panel prints', () => {
    expect(value('LandPortal road frontage')).toBe(157.4);
  });

  it('reads the land-locked and water flags as booleans', () => {
    expect(value('LandPortal land locked flag')).toBe(false);
    expect(value('LandPortal water feature present')).toBe(true);
    expect(value('LandPortal water feature types')).toBe('River, Swamp / Marsh');
  });

  it('keeps a zero building area, which is what makes the subject vacant', () => {
    // 0 is a fact, not a missing value; dropping it would lose the evidence
    // that there is nothing built on this parcel.
    expect(value('Building square feet')).toBe(0);
    expect(value('Parcel square feet')).toBe(65340);
  });

  it('retains the provider parcel id without promoting it to identity', () => {
    expect(value('LandPortal parcel identifier')).toBe('00083-A-03400');
    expect(facts.every((f) => f.factKey !== 'APN')).toBe(true);
  });

  it('treats a panel dash as the panel having nothing to say', () => {
    expect(facts.some((f) => f.rawValue === '-')).toBe(false);
    expect(normalizeLandPortalParcelFacts({ Acres: '-' })).toEqual([]);
  });

  it('preserves the exact string the panel printed alongside the parsed value', () => {
    expect(facts.find((f) => f.factKey === 'LandPortal road frontage')?.rawValue).toBe('157.40 ft');
  });
});

describe('only the current panel is normalized', () => {
  it('reads one capture, not every historical inspection', () => {
    // Deal 90 held 21 retained inspections. Normalizing all of them wrote a
    // near-identical fact set per capture and put a superseded panel's numbers
    // beside the current one. Only the newest panel carrying parcel facts is
    // current provider state.
    const panels = [
      { 'Parcel ID': '00083-A-03400', Acres: '1.500' },
      { 'Parcel ID': '00083-A-03400', Acres: '1.500' },
    ];
    const perPanel = panels.map((p) => normalizeLandPortalParcelFacts(p));
    expect(perPanel[0]).toEqual(perPanel[1]);
    // Identical panels produce identical facts, so the idempotency key that
    // includes the capture is what keeps replay from duplicating them.
    expect(perPanel[0].length).toBe(2);
  });

  it('never lets another parcel panel supply subject numbers', () => {
    // A neighbouring parcel's panel normalizes to the same keys. What makes it
    // safe is that it carries its OWN parcel identifier, so a subject-scoped
    // read can tell the two apart instead of taking the newest row.
    const neighbour = normalizeLandPortalParcelFacts({
      'Parcel ID': '00083-8-02600', 'Road Frontage': '405.17 ft',
    });
    const subject = normalizeLandPortalParcelFacts({
      'Parcel ID': '00083-A-03400', 'Road Frontage': '157.40 ft',
    });
    const idOf = (f: ReturnType<typeof normalizeLandPortalParcelFacts>) =>
      f.find((x) => x.factKey === 'LandPortal parcel identifier')?.normalizedValue;
    expect(idOf(neighbour)).toBe('00083-8-02600');
    expect(idOf(subject)).toBe('00083-A-03400');
    expect(neighbour.find((x) => x.factKey === 'LandPortal road frontage')?.normalizedValue).toBe(405.17);
    expect(subject.find((x) => x.factKey === 'LandPortal road frontage')?.normalizedValue).toBe(157.4);
  });
});
