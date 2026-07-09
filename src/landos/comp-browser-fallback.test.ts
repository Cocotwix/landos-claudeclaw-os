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
  it('renders the Zillow & Redfin browser research panel', () => {
    expect(DEALCARD).toMatch(/function CompResearchPanel/);
    expect(DEALCARD).toMatch(/<CompResearchPanel research=\{mc\.research\}/);
    expect(DEALCARD).toContain('Zillow &amp; Redfin browser research');
  });

  it('shows sources attempted/succeeded/failed, counts, filters, expansion, strength, and search path', () => {
    expect(DEALCARD).toMatch(/srcLine\('zillow'\)/);
    expect(DEALCARD).toMatch(/srcLine\('redfin'\)/);
    expect(DEALCARD).toMatch(/acreage expanded/);
    expect(DEALCARD).toMatch(/geography expanded/);
    expect(DEALCARD).toMatch(/comps: \{research\.strength\}/);
    expect(DEALCARD).toMatch(/Filters:/);
    expect(DEALCARD).toMatch(/Search path \(/);
    expect(DEALCARD).toMatch(/screenshot captured/);
  });

  it('types the research field on the market comps view', () => {
    expect(DEALCARD).toMatch(/research\?: CompResearchView \| null/);
  });
});
