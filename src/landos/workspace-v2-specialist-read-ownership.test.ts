import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(p, 'utf-8');
const READS = read('web/src/components/AcquisitionWorkspaceV2SpecialistReads.tsx');
const PAGE = read('web/src/pages/AcquisitionWorkspaceV2.tsx');

describe('specialist expert reviews are owned by their deal pages', () => {
  it('renders full expert reviews only behind the full flag', () => {
    expect(READS.split('{full && product.expertReview && (').length - 1).toBe(2);
    expect(READS).toContain('data-testid="specialist-property-expert-review"');
    expect(READS).toContain('data-testid="specialist-market-expert-review"');
  });

  it('keeps the Overview strip concise: full={false} with page pointers', () => {
    expect(READS).toMatch(/PropertyReadCard[^/]*full=\{false\} onOpenFull=\{onOpenPropertyPage\}/);
    expect(READS).toMatch(/MarketReadCard[^/]*full=\{false\} onOpenFull=\{onOpenMarketPage\}/);
    expect(READS).toContain('specialist-property-expert-review-pointer');
    expect(READS).toContain('specialist-market-expert-review-pointer');
  });

  it('the Property page renders the full Property specialist read', () => {
    const propertyPage = PAGE.slice(PAGE.indexOf('data-testid="property-page"'), PAGE.indexOf('data-testid="market-page"'));
    expect(propertyPage).toMatch(/<PropertyReadCard product=\{propertyIntelRead\}[^/]*full \/>/);
  });

  it('the Market page renders the full Market specialist read', () => {
    const marketPage = PAGE.slice(PAGE.indexOf('data-testid="market-page"'), PAGE.indexOf('data-testid="comps-page"'));
    expect(marketPage).toMatch(/<MarketReadCard product=\{marketIntelRead\}[^/]*full \/>/);
  });

  it('the market view type carries the persisted expertReview', () => {
    expect(READS).toMatch(/MarketIntelligenceReadView \{[\s\S]*?expertReview\?: string;/);
  });
});
