// Acquisition Workspace V2 — cross-page canonical valuation contract.
//
// This is deliberately a node-safe source-text test.  Vitest's LandOS setup
// does not provide a DOM; operator-visible interaction remains browser QA.
// The regression protected here is structural: Overview, Property
// Intelligence, and Comps & Valuation must not independently count comparable
// rows or infer valuation status from different projections.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const PAGE_SRC = read('web/src/pages/AcquisitionWorkspaceV2.tsx');
const PI_SRC = read('web/src/components/AcquisitionWorkspaceV2PropertyIntelligence.tsx');
const CV_SRC = read('web/src/components/AcquisitionWorkspaceV2CompsValuation.tsx');

// Overview is currently rendered inline by AcquisitionWorkspaceV2.  Keep the
// optional component in the contract so extracting it later cannot silently
// drop the same guarantees.
const overviewPath = path.join(process.cwd(), 'web/src/components/AcquisitionWorkspaceV2Overview.tsx');
const OVERVIEW_SRC = fs.existsSync(overviewPath) ? fs.readFileSync(overviewPath, 'utf8') : PAGE_SRC;

const localCompCountPatterns = [
  /\.comps\?\.sold\?\.length/,
  /\.comps\.sold\.length/,
  /\.sold\?\.length\s*\?\?/,
  /\.sold\.filter\([^\n]*\)\.length/,
  /counts\?\.accepted_closed_sale/,
  /counts\.accepted_closed_sale/,
  /filter\([^\n]*(?:accepted_closed_sale|inValuationSet)[^\n]*\)\.length/,
];

describe('Workspace V2 shares one canonical comp and valuation summary', () => {
  it('loads the canonical summary once at the workspace boundary', () => {
    expect(PAGE_SRC).toMatch(/const\s+(?:cvSummary|canonicalValuationSummary)\s*=\s*compsValuation\?\.summary\s*\?\?\s*null/);
  });

  it('Overview reads accepted count and status from that summary', () => {
    expect(OVERVIEW_SRC).toMatch(/(?:cvSummary|canonicalValuationSummary)\?*\.acceptedCount/);
    expect(OVERVIEW_SRC).toMatch(/(?:cvSummary|canonicalValuationSummary)\?*\.status/);
  });

  it('passes the same summary into Property Intelligence and reads both canonical fields there', () => {
    const mount = PAGE_SRC.match(/<PropertyIntelligenceSection[\s\S]{0,1800}?\/>/)?.[0] ?? '';
    const sharedProp = mount.match(/([A-Za-z_$][\w$]*(?:Summary|State))=\{(?:cvSummary|canonicalValuationSummary)\}/)?.[1];

    expect(sharedProp, 'Property Intelligence must receive the workspace canonical summary').toBeTruthy();
    const prop = sharedProp as string;
    expect(PI_SRC).toMatch(new RegExp(`${prop}\\?*\\.acceptedCount`));
    expect(PI_SRC).toMatch(new RegExp(`${prop}\\?*\\.status`));
  });

  it('Comps & Valuation reads accepted count and status from view.summary', () => {
    expect(CV_SRC).toMatch(/const\s+summary\s*=\s*view\?*\.summary\s*\?\?\s*null/);
    expect(CV_SRC).toMatch(/summary\.acceptedCount/);
    expect(CV_SRC).toMatch(/summary\.status/);
  });

  it('contains no second local computation of the accepted comparable count', () => {
    // PAGE_SRC remains explicit even if Overview is later extracted: the
    // workspace boundary itself must not pre-compute a competing count.
    for (const source of [...new Set([PAGE_SRC, OVERVIEW_SRC, PI_SRC, CV_SRC])]) {
      for (const pattern of localCompCountPatterns) expect(source).not.toMatch(pattern);
    }
  });
});

describe('land-basis figures cannot read as whole-property recommendations', () => {
  it('labels the Overview land indication and pending whole-property value explicitly', () => {
    expect(OVERVIEW_SRC).toMatch(/Land-only indication|land-basis (?:reference|figure)|valuationScopeLabel/);
    expect(OVERVIEW_SRC).toMatch(/Whole-property value[\s\S]{0,300}Pending/);
    expect(OVERVIEW_SRC).toMatch(/(?:Acquisition levels|Opening|Target|Ceiling)[\s\S]{0,1200}(?:land value|land-basis)/i);
  });

  it('labels Comps & Valuation figures as land-basis when the subject is improved', () => {
    expect(CV_SRC).toMatch(/data-testid="cv-land-only-scope"/);
    expect(CV_SRC).toMatch(/Land-only indication/);
    expect(CV_SRC).toMatch(/data-testid="cv-whole-property-pending"/);
    expect(CV_SRC).toMatch(/Whole-property value[\s\S]{0,200}Pending/);
    expect(CV_SRC).toMatch(/(?:Recommended opening|Recommended target|Hard ceiling)[\s\S]{0,1800}(?:land value|land-basis)/i);
  });
});
