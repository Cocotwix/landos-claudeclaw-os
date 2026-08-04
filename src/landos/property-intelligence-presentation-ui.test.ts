// V2 presentation source contract for the touch-up sprint: concise Visual
// Buyer narrative by default with supporting evidence collapsed; compact
// collapsed Missing Diligence rows; the Soils & Preliminary Septic Outlook
// section; approved access terminology with no driveway-approval language.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const PI_SRC = fs.readFileSync(
  path.join(process.cwd(), 'web/src/components/AcquisitionWorkspaceV2PropertyIntelligence.tsx'),
  'utf8',
);
const PAGE_SRC = fs.readFileSync(
  path.join(process.cwd(), 'web/src/pages/AcquisitionWorkspaceV2.tsx'),
  'utf8',
);
const CSS_SRC = fs.readFileSync(path.join(process.cwd(), 'web/src/styles/workspace-v2.css'), 'utf8');

describe('Visual Buyer Analysis presentation', () => {
  it('renders the concise narrative by default and collapses the detailed A–E analysis', () => {
    expect(PI_SRC).toMatch(/narrative\.sections\.map/);
    expect(PI_SRC).toMatch(/<details class="awv2-collapse awv2-vba-details">/);
    expect(PI_SRC).toMatch(/<summary>View supporting observations and evidence<\/summary>/);
    // The detailed material is preserved inside the collapsed section.
    expect(PI_SRC).toContain('A · Directly observed features');
    expect(PI_SRC).toContain('E · Confidence &amp; evidence reconciliation');
    expect(PI_SRC).toContain('Superseded:');
  });

  it('keeps the Overview summary compact with one market line', () => {
    expect(PAGE_SRC).toMatch(/narrative\?\.overviewMarketLine/);
  });
});

describe('Missing Diligence presentation', () => {
  it('renders compact rows collapsed by default with status and short next action', () => {
    expect(PI_SRC).toMatch(/<details class=\{`awv2-md-row\$\{item\.urgent \? ' urgent' : ''\}`\}>/);
    expect(PI_SRC).toMatch(/\{item\.shortStatus \|\| item\.currentFinding\.slice\(0, 64\)\}/);
    expect(PI_SRC).toMatch(/item\.shortNext \? `Next: \$\{item\.shortNext\}` : ''/);
    // The full reconciled record stays available on expansion.
    for (const marker of ['Current finding', 'Still unresolved', 'Why it matters', 'Next source']) {
      expect(PI_SRC).toContain(marker);
    }
  });

  it('styles collapsed rows and urgent prominence', () => {
    expect(CSS_SRC).toMatch(/\.awv2-md-row \{/);
    expect(CSS_SRC).toMatch(/\.awv2-md-row\.urgent \{/);
  });
});

describe('Soils & Preliminary Septic Outlook', () => {
  it('has the dedicated section with honest empties and the required next step', () => {
    expect(PI_SRC).toMatch(/id="soils-septic"/);
    expect(PI_SRC).toContain('Soils &amp; Preliminary Septic Outlook');
    expect(PI_SRC).toMatch(/Preliminary Septic Outlook:/);
    expect(PI_SRC).toContain('No official rating retained');
    expect(PI_SRC).toMatch(/Required next step:/);
  });

  it('surfaces the compact septic outlook on Overview', () => {
    expect(PAGE_SRC).toMatch(/Septic outlook/);
    expect(PAGE_SRC).toMatch(/Field testing remains required\./);
    expect(PAGE_SRC).toMatch(/soils-septic/);
  });
});

describe('access terminology', () => {
  it('shows Legal access and Apparent entrance rows from the server projection', () => {
    expect(PI_SRC).toMatch(/k="Legal access"/);
    expect(PI_SRC).toMatch(/k="Apparent entrance"/);
    expect(PI_SRC).toMatch(/Not confirmed from retained imagery/);
  });

  it('never shows driveway-approval or permit language in the V2 surfaces', () => {
    for (const src of [PI_SRC, PAGE_SRC]) {
      expect(src).not.toMatch(/driveway approval/i);
      expect(src).not.toMatch(/driveway permit/i);
      expect(src).not.toMatch(/entrance permit/i);
      expect(src).not.toMatch(/highway permit/i);
    }
  });

  it('the hero caption states access from evidence instead of a blanket unresolved claim', () => {
    expect(PAGE_SRC).toMatch(/accessView\?\.established/);
    expect(PAGE_SRC).toMatch(/Legal access: \$\{accessView\.legalAccess\}/);
  });
});
