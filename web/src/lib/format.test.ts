import { describe, it, expect } from 'vitest';
import { formatRelativeTime, sectionCitationLabel, countyLabel } from './format.js';

describe('formatRelativeTime — never emits NaN', () => {
  const nowSec = Math.floor(Date.now() / 1000);

  it('formats unix seconds', () => {
    expect(formatRelativeTime(nowSec - 5)).toMatch(/s ago$/);
    expect(formatRelativeTime(nowSec - 3700)).toMatch(/h ago$/);
  });

  it('accepts an ISO string (the Activity-tab regression that showed "NaNy ago")', () => {
    const iso = new Date((nowSec - 120) * 1000).toISOString();
    expect(formatRelativeTime(iso)).toMatch(/m ago$/);
    expect(formatRelativeTime(iso)).not.toMatch(/NaN/);
  });

  it('accepts unix milliseconds', () => {
    expect(formatRelativeTime(Date.now() - 5000)).toMatch(/s ago$/);
  });

  it('returns "—" for invalid input instead of "NaN… ago"', () => {
    for (const bad of [NaN, undefined, null, '', 'not-a-date']) {
      const out = formatRelativeTime(bad as never);
      expect(out).not.toMatch(/NaN/);
      expect(out).toBe('—');
    }
  });
});

describe('sectionCitationLabel — the marker is added once, never twice', () => {
  it('adds the marker to a bare numbered citation', () => {
    expect(sectionCitationLabel('4 - 110.2')).toBe('§ 4 - 110.2');
    expect(sectionCitationLabel('2-101.203')).toBe('§ 2-101.203');
  });

  it('leaves a citation that already prints the word alone (the doubled "§ Section" card)', () => {
    expect(sectionCitationLabel('Section 6 - 108')).toBe('Section 6 - 108');
    expect(sectionCitationLabel('section 6 - 108')).toBe('section 6 - 108');
    expect(sectionCitationLabel('Sec. 4-102')).toBe('Sec. 4-102');
    expect(sectionCitationLabel('Article 2')).toBe('Article 2');
    expect(sectionCitationLabel('Chapter 13')).toBe('Chapter 13');
  });

  it('never doubles the sign itself', () => {
    expect(sectionCitationLabel('§ 13-3-401')).toBe('§ 13-3-401');
    expect(sectionCitationLabel('§§ 13-3-401 to 13-3-410')).toBe('§§ 13-3-401 to 13-3-410');
  });

  it('prints nothing for an absent citation, so a caller can fall back to a label', () => {
    for (const empty of [null, undefined, '', '   ']) {
      expect(sectionCitationLabel(empty as never)).toBe('');
    }
  });

  it('does not mistake a number that merely starts with a marker letter', () => {
    expect(sectionCitationLabel('4-110.2 Lot Dimensions')).toBe('§ 4-110.2 Lot Dimensions');
  });
});

describe('countyLabel', () => {
  it('appends the county suffix exactly once', () => {
    expect(countyLabel('Iredell')).toBe('Iredell County');
    expect(countyLabel('Iredell County')).toBe('Iredell County');
    expect(countyLabel('Iredell County County')).toBe('Iredell County');
  });

  it('keeps a parish or borough as filed', () => {
    expect(countyLabel('Orleans Parish')).toBe('Orleans Parish');
    expect(countyLabel('Kenai Peninsula Borough')).toBe('Kenai Peninsula Borough');
  });

  it('never dresses a bare FIPS code as a county name', () => {
    expect(countyLabel('37097')).toBe('FIPS 37097');
    expect(countyLabel('37097', 'Iredell')).toBe('Iredell County');
    expect(countyLabel('37097', 'Iredell County')).toBe('Iredell County');
  });

  it('returns nothing when there is nothing to name', () => {
    expect(countyLabel(null)).toBeNull();
    expect(countyLabel('   ')).toBeNull();
  });
});
