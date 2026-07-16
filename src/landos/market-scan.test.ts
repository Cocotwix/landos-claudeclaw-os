import { describe, it, expect } from 'vitest';
import {
  assessLandRelevance,
  buildDataCenterWatch,
  buildMarketSignalScan,
  runMarketScan,
  DATA_CENTER_QUERY,
  type ScanFinding,
} from './market-scan.js';

describe('assessLandRelevance — every shown item must matter for buying land', () => {
  it('keeps land-demand drivers with a why-it-matters answer', () => {
    const cases: Array<[string, string]> = [
      ['County population growth hits 8% over five years', 'population_growth'],
      ['New 400-lot subdivision breaks ground near De Queen', 'subdivision'],
      ['Tyson announces manufacturing plant expansion', 'manufacturing'],
      ['Rural water line extension project funded for the east county', 'water_expansion'],
      ['Highway 71 widening project enters construction', 'highway_project'],
      ['Planning board approves rezoning for mixed-use', 'rezoning'],
      ['Hyperscale data center proposed on 900 acres', 'data_center'],
    ];
    for (const [text, category] of cases) {
      const r = assessLandRelevance(text);
      expect(r.relevant, text).toBe(true);
      expect(r.category, text).toBe(category);
      expect(r.whyItMatters, text).toBeTruthy();
    }
  });

  it('drops irrelevant local news — nothing without a land answer is shown', () => {
    for (const text of [
      'High school football team wins state championship',
      'Local restaurant celebrates 25th anniversary',
      'City council debates library hours',
    ]) {
      expect(assessLandRelevance(text).relevant, text).toBe(false);
    }
  });
});

describe('buildDataCenterWatch — 2025+ existence check, never an investigation', () => {
  const area = { county: 'Sevier', state: 'AR' };

  it('is honestly not_run when no search happened', () => {
    const w = buildDataCenterWatch({ ...area, findings: null });
    expect(w.status).toBe('not_run');
    expect(w.items).toEqual([]);
  });

  it('is unavailable (not fabricated) when the search source failed', () => {
    const w = buildDataCenterWatch({ ...area, findings: null, searchFailed: true });
    expect(w.status).toBe('unavailable');
  });

  it('reports none_found as a real answer when nothing matches', () => {
    const w = buildDataCenterWatch({ ...area, findings: [{ title: 'County fair announced', summary: 'Rides and food.', year: 2025 }] });
    expect(w.status).toBe('none_found');
    expect(w.summary).toMatch(/real answer/i);
  });

  it('classifies found activity and explains why it matters', () => {
    const findings: ScanFinding[] = [
      { title: 'Hyperscale data center approved in the county', summary: 'Rezoning approved for a 1,200-acre campus.', url: 'https://example.com/a', year: 2025 },
      { title: 'Residents voice opposition to data center water use', summary: 'Public hearing drew protest.', url: 'https://example.com/b', year: 2026 },
    ];
    const w = buildDataCenterWatch({ ...area, findings });
    expect(w.status).toBe('found');
    expect(w.items).toHaveLength(2);
    expect(w.items[0].status).toBe('approved');
    expect(w.items[1].status).toBe('community_opposition');
    for (const i of w.items) expect(i.whyItMatters).toBeTruthy();
    expect(w.summary).toMatch(/Data-center \/ AI-campus activity found/);
    expect(w.note).toMatch(/Existence check only/);
  });

  it('excludes pre-2025 findings (2025 and newer only)', () => {
    const w = buildDataCenterWatch({ ...area, findings: [{ title: 'Data center proposed', summary: 'Old news.', year: 2023 }] });
    expect(w.status).toBe('none_found');
  });
});

describe('buildMarketSignalScan — relevance filter with a dropped count', () => {
  it('keeps only land-relevant items and counts the dropped ones', () => {
    const s = buildMarketSignalScan({
      county: 'Sevier', state: 'AR',
      findings: [
        { title: 'New subdivision platted', summary: '60 lots on the west side.', year: 2025 },
        { title: 'Football team wins', summary: 'Great game.', year: 2025 },
      ],
    });
    expect(s.status).toBe('found');
    expect(s.items).toHaveLength(1);
    expect(s.items[0].category).toBe('subdivision');
    expect(s.items[0].whyItMatters).toBeTruthy();
    expect(s.droppedIrrelevant).toBe(1);
  });
});

describe('runMarketScan — bounded, honest live wrapper', () => {
  it('degrades to not_run with no configured search source', async () => {
    const r = await runMarketScan({ county: 'Sevier', state: 'AR', search: null });
    expect(r.dataCenterWatch.status).toBe('not_run');
    expect(r.growthSignals.status).toBe('not_run');
  });

  it('runs exactly two bounded queries and survives one failing', async () => {
    const queries: string[] = [];
    const search = async (q: string): Promise<ScanFinding[]> => {
      queries.push(q);
      if (queries.length === 1) return [{ title: 'Data center under construction nearby', summary: 'Construction has begun.', year: 2025 }];
      throw new Error('search quota');
    };
    const r = await runMarketScan({ county: 'Sevier', state: 'AR', search });
    expect(queries).toHaveLength(2);
    expect(queries[0]).toBe(DATA_CENTER_QUERY('Sevier, AR'));
    expect(r.dataCenterWatch.status).toBe('found');
    expect(r.dataCenterWatch.items[0].status).toBe('under_construction');
    expect(r.growthSignals.status).toBe('unavailable');
  });
});
