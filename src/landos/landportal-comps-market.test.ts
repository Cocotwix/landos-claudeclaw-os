import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseLandPortalCompRows } from './comp-extraction.js';

// Verifies the LandPortal visible-comp rows are wired into the Market pipeline,
// with source labels + exact statuses, and never trigger the paid comp report.

describe('LandPortal visible comps → Market pipeline (extraction)', () => {
  it('structures the real LandPortal similar-sales row format with $/ac and sold status', () => {
    const rows = ['$189,500 Acres: 7.67 | APN: 074-078.22', '$168,800 Acres: 10.34 | APN: 072-005.08'];
    const comps = parseLandPortalCompRows(rows, 0.98);
    expect(comps).toHaveLength(2);
    expect(comps.every((c) => c.source === 'LandPortal')).toBe(true);
    expect(comps.every((c) => c.status === 'sold')).toBe(true);
    expect(comps[0].pricePerAcre).toBe(Math.round(189500 / 7.67));
  });
});

describe('LandPortal comps Market wiring (source lock)', () => {
  const REPORT = fs.readFileSync(path.resolve(__dirname, 'deal-card-report.ts'), 'utf8');
  const UI = fs.readFileSync(path.resolve(__dirname, '../../web/src/components/DealCard.tsx'), 'utf8');

  it('report build parses visible LandPortal rows and never runs the paid comp report', () => {
    expect(REPORT).toMatch(/parseLandPortalCompRows/);
    expect(REPORT).toMatch(/landportalComps/);
    // Exact statuses required by the spec.
    for (const s of ['no_url', 'not_run', 'unavailable', 'retrieved', 'none']) {
      expect(REPORT.includes(`'${s}'`), `missing landportal comp status ${s}`).toBe(true);
    }
    expect(REPORT).toMatch(/sourceLabel: 'LandPortal'/);
    // The paid comp-credit tools remain uncalled (creditUsage note preserved).
    expect(REPORT).toMatch(/compCreditUsed: false/);
    expect(REPORT).toMatch(/paid comp report was not run/i);
  });

  it('Market panel renders a LandPortal comps + source-status block', () => {
    expect(UI).toMatch(/function LandPortalCompsPanel/);
    expect(UI).toMatch(/<LandPortalCompsPanel lpc=\{mc\.landportalComps\}/);
    expect(UI).toMatch(/landportalComps\?:/); // present on the view type
    expect(UI).toMatch(/no paid report/i);
  });
});
