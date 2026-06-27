import { describe, it, expect } from 'vitest';
import { buildDdChecklist, renderDdChecklistMarkdown, NEEDS_VERIFICATION_LABEL } from './dd-checklist.js';

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

  it('markdown render: Verified rows cite source; gaps show the standard label', () => {
    const md = renderDdChecklistMarkdown(buildDdChecklist({ acres: 5 }, 'Realie.ai'));
    expect(md.some((l) => l === '- **Acreage:** 5 ac — Verified (source: Realie.ai)')).toBe(true);
    expect(md.some((l) => l.includes(`Zoning:** ${NEEDS_VERIFICATION_LABEL}`))).toBe(true);
    expect(md.some((l) => l.includes('Power:**') && l.includes('no connected source'))).toBe(true);
  });
});
