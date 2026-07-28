// Guards that the Zillow/Redfin read-only browser comp research is wired as a
// fallback in the comp chain, threaded from the route, and rendered in the Deal
// Card Market section. Behavior of the researcher itself is covered by
// browser-comp-research.test.ts (search path, acreage/geography expansion, honest
// blockers, never-fabricate). Source-scan style (no jsdom / no heavy runtime).

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

const read = (rel: string) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');
const REPORT = read('./deal-card-report.ts');
const ROUTES = read('./routes.ts');
const DEALCARD = read('../../web/src/components/DealCard.tsx');
const PI_PANEL = read('../../web/src/components/PropertyIntelligencePanel.tsx');

describe('browser comp fallback is wired into the comp chain', () => {
  it('the comp chain runs the Zillow/Redfin researcher when configured providers are thin', () => {
    expect(REPORT).toContain("import { researchBrowserComps");
    expect(REPORT).toMatch(/primaryCount < RESEARCH_TARGET/);
    expect(REPORT).toMatch(/researchBrowserComps\(/);
    // Fallback is independent of actor/API success — actor failure never blocks it.
    expect(REPORT).toMatch(/v\.research = research/);
    expect(REPORT).toMatch(/browser_research:\$\{research\.strength\}/);
  });

  it('merges researched comps by status and records per-source provider rows', () => {
    expect(REPORT).toMatch(/status === 'sold'/);
    expect(REPORT).toMatch(/\$\{src\}_browser/);
  });

  it('threads a live browser driver from runDealCardReport into the chain', () => {
    expect(REPORT).toMatch(/compResearchDriver\?: BrowserDriver/);
    expect(REPORT).toMatch(/researchDriver: deps\.compResearchDriver/);
  });

  it('the report/run route supplies an isolated comp-research driver', () => {
    expect(ROUTES).toMatch(/compResearchDriver: makeLiveBrowserDriver\('comp_research'\)/);
  });
});

describe('Deal Card Market section renders comp-source search status', () => {
  it('renders the canonical comparable snapshot without a legacy research panel', () => {
    expect(DEALCARD).toMatch(/<PropertyIntelligenceMarket snapshot=\{piSnapshot\}/);
    expect(DEALCARD).not.toMatch(/function CompResearchPanel|<CompResearchPanel/);
    expect(PI_PANEL).toMatch(/title="Comp source policy"/);
    expect(PI_PANEL).toMatch(/title="Accepted sold comps"/);
    expect(PI_PANEL).toMatch(/title="Active competition"/);
  });

  it('shows source-linked accepted rows and explicit held-back reasons', () => {
    expect(PI_PANEL).toMatch(/<CompTable rows=\{comps\.sold\}/);
    expect(PI_PANEL).toMatch(/<CompTable rows=\{comps\.active\}/);
    expect(PI_PANEL).toMatch(/row\.sourceUrl \? <a href=\{row\.sourceUrl\}/);
    expect(PI_PANEL).toMatch(/\{row\.source\}/);
    expect(PI_PANEL).toMatch(/title="Rows held back as evidence"/);
    expect(PI_PANEL).toMatch(/\{bucket\.reason\}/);
  });

  it('types the canonical provider caps, deduplicated sets and exclusions', () => {
    expect(PI_PANEL).toMatch(/caps: \{ zillow: number; redfin: number \}/);
    expect(PI_PANEL).toMatch(/sold: PiComp\[\]/);
    expect(PI_PANEL).toMatch(/active: PiComp\[\]/);
    expect(PI_PANEL).toMatch(/duplicatesMerged: number/);
    expect(PI_PANEL).toMatch(/rejected: Array/);
    expect(DEALCARD).not.toMatch(/CompResearchView/);
  });
});
