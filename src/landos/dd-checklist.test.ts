import { describe, it, expect } from 'vitest';
import { buildDdChecklist, mergeGovDdRows, renderDdChecklistMarkdown, summarizeDdCompleteness, NEEDS_VERIFICATION_LABEL } from './dd-checklist.js';

describe('mergeGovDdRows — per-field provenance (no mislabeling)', () => {
  it('replaces flood/wetlands/slope rows with their OWN gov source', () => {
    const rows = buildDdChecklist({ acres: 8.6 }, 'Realie.ai');
    const merged = mergeGovDdRows(rows, {
      flood: { status: 'verified', zone: 'X', source: 'https://fema/x', timestamp: 't' },
      wetlands: { status: 'verified', type: 'None mapped', source: 'https://nwi/x', timestamp: 't' },
      slope: { status: 'verified', slopeDeg: 3.1, source: 'https://usgs/x', timestamp: 't' },
    });
    const fema = merged.find((r) => r.key === 'femaPct')!;
    expect(fema.status).toBe('verified'); expect(fema.value).toBe('X'); expect(fema.source).toBe('FEMA NFHL');
    expect(merged.find((r) => r.key === 'wetlandsPct')!.source).toBe('USFWS NWI');
    const slope = merged.find((r) => r.key === 'slopeAvgDeg')!;
    expect(slope.source).toBe('USGS 3DEP'); expect(slope.value).toBe('~3.1°');
    expect(merged.find((r) => r.key === 'acres')!.source).toBe('Realie.ai'); // not overwritten
  });
  it('leaves rows untouched when gov results are not verified', () => {
    const merged = mergeGovDdRows(buildDdChecklist({}, null), { flood: { status: 'not_run', zone: null, source: null, timestamp: null }, wetlands: { status: 'not_run', type: null, source: null, timestamp: null }, slope: { status: 'not_run', slopeDeg: null, source: null, timestamp: null } });
    expect(merged.find((r) => r.key === 'femaPct')!.status).toBe('needs_verification');
  });
});

describe('dd-checklist (shared canonical DD fact set)', () => {
  it('marks present fields Verified with source and absent fields Needs Verification', () => {
    const rows = buildDdChecklist({ acres: 8.6, zoning: 'A-1' }, 'Realie.ai');
    const by = (l: string) => rows.find((r) => r.label === l)!;
    expect(by('Acreage')).toMatchObject({ status: 'verified', value: '8.6 ac', source: 'Realie.ai' });
    expect(by('Zoning')).toMatchObject({ status: 'verified', value: 'A-1' });
    expect(by('FEMA flood zone')).toMatchObject({ status: 'needs_verification', value: null, source: null });
  });

  it('always includes utilities with no connected source', () => {
    const rows = buildDdChecklist({}, null);
    for (const u of ['Power', 'Water', 'Sewer / septic']) {
      expect(rows.find((r) => r.label === u)).toMatchObject({ status: 'needs_verification', noConnectedSource: true });
    }
  });

  it('empty facts => every standard field is Needs Verification (never fabricated)', () => {
    const rows = buildDdChecklist({}, null);
    expect(rows.length).toBeGreaterThan(12);
    expect(rows.every((r) => r.status === 'needs_verification')).toBe(true);
  });

  it('summarizes completeness (X of N verified, percent)', () => {
    const all = buildDdChecklist({}, null);
    const none = summarizeDdCompleteness(all);
    expect(none.verified).toBe(0);
    expect(none.percentComplete).toBe(0);
    expect(none.total).toBe(all.length);
    expect(none.label).toBe(`0 of ${all.length} DD fields verified (0%)`);

    const some = summarizeDdCompleteness(buildDdChecklist({ acres: 8.6, zoning: 'A-1' }, 'Realie.ai'));
    expect(some.verified).toBe(2);
    expect(some.needsVerification).toBe(some.total - 2);
    expect(some.percentComplete).toBe(Math.round((2 / some.total) * 100));
  });

  it('markdown render: Verified rows cite source; gaps show the standard label', () => {
    const md = renderDdChecklistMarkdown(buildDdChecklist({ acres: 5 }, 'Realie.ai'));
    expect(md.some((l) => l === '- **Acreage:** 5 ac — Verified (source: Realie.ai)')).toBe(true);
    expect(md.some((l) => l.includes(`Zoning:** ${NEEDS_VERIFICATION_LABEL}`))).toBe(true);
    expect(md.some((l) => l.includes('Power:**') && l.includes('no connected source'))).toBe(true);
  });
});
