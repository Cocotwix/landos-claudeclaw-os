import { describe, it, expect } from 'vitest';
import { collectBrowserMarketIntelligence, makeNewsResearchBackend, resolveBrowserModel, summarizeGrowthDrivers, BROWSER_MODEL_ENV, DEFAULT_BROWSER_MODEL, type MarketEvidence } from './browser-market-intelligence.js';

const _gev = (snippet: string) => ({ url: 'u', source: 's', sourceType: 'local_news' as never, snippet, timestamp: 't', confidence: 'medium' as const, supports: snippet, doesNotProve: 'x' });
describe('summarizeGrowthDrivers — operator growth summary (not a headline dump)', () => {
  it('classifies evidence into growth drivers + ends with what-this-means', () => {
    const intel = { status: 'collected' as const, model: 'none' as never, area: 'Anderson County, SC', categories: [], evidence: [_gev('New 200-lot residential subdivision approved'), _gev('Highway 85 interchange expansion funded'), _gev('Distribution center / warehouse breaks ground')], note: '' };
    const g = summarizeGrowthDrivers(intel);
    expect(g.drivers.length).toBeGreaterThanOrEqual(3);
    expect(g.summary).toMatch(/growth themes|signals/i);
    expect(g.whatThisMeans).toMatch(/strengthening|supportive|catalyst/i);
  });
  it('honest when no browser model / no evidence (steady-state, rely on comps)', () => {
    const g = summarizeGrowthDrivers({ status: 'no_browser_model' as const, model: 'none' as never, area: 'x', categories: [], evidence: [], note: '' });
    expect(g.drivers.length).toBe(0);
    expect(g.whatThisMeans).toMatch(/steady-state|verified comp band|rely on/i);
  });
});

describe('news research backend (real evidence over Google News RSS)', () => {
  const rss = `<rss><channel>
    <item><title>GDOT to speed up roundabout project</title><link>https://news.example/a</link><pubDate>Fri, 19 Jun 2026 00:00:00 GMT</pubDate><source url="x">Albany Herald</source></item>
    <item><title>Phoebe hospital $2.5 billion economic impact</title><link>https://news.example/b</link><pubDate>Mon, 02 Mar 2026 00:00:00 GMT</pubDate><source url="x">Albany Herald</source></item>
  </channel></rss>`;
  it('parses RSS items into evidence with provenance + classification', async () => {
    const backend = makeNewsResearchBackend({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => rss }), now: () => 't' });
    const r = await collectBrowserMarketIntelligence({ county: 'Worth', state: 'GA' }, { backend });
    expect(r.status).toBe('collected');
    expect(r.evidence.length).toBe(2);
    expect(r.evidence[0].url).toContain('news.example');
    expect(r.evidence[0].sourceType).toBe('infrastructure'); // roundabout/GDOT
    expect(r.evidence[1].sourceType).toBe('employer'); // hospital
    expect(r.evidence[0].doesNotProve).toMatch(/parcel/i);
  });
  it('backend HTTP failure surfaces as error (no fabrication)', async () => {
    const backend = makeNewsResearchBackend({ fetchImpl: async () => ({ ok: false, status: 503, text: async () => '' }) });
    const r = await collectBrowserMarketIntelligence({ county: 'Worth', state: 'GA' }, { backend });
    expect(r.status).toBe('error');
    expect(r.evidence.length).toBe(0);
  });
});

describe('browser market intelligence (selectable model, honest status)', () => {
  it('defaults to the open-weight model and is selectable via env', () => {
    expect(resolveBrowserModel({})).toBe(DEFAULT_BROWSER_MODEL);
    expect(resolveBrowserModel({ [BROWSER_MODEL_ENV]: 'qwen2.5-vl' })).toBe('qwen2.5-vl');
    expect(resolveBrowserModel({ [BROWSER_MODEL_ENV]: 'nonsense' })).toBe(DEFAULT_BROWSER_MODEL);
  });

  it('no backend wired => honest Needs Research (no fabricated evidence)', async () => {
    const r = await collectBrowserMarketIntelligence({ city: 'Poulan', county: 'Worth', state: 'GA' }, { env: {} });
    expect(r.status).toBe('no_browser_model');
    expect(r.evidence).toHaveLength(0);
    expect(r.area).toContain('Worth County');
    expect(r.categories.length).toBeGreaterThan(0);
    expect(r.note).toMatch(/needs research/i);
  });

  it('no area => no_area', async () => {
    const r = await collectBrowserMarketIntelligence({});
    expect(r.status).toBe('no_area');
  });

  it('with a backend => collects evidence carrying provenance', async () => {
    const ev: MarketEvidence[] = [{ url: 'https://county.gov/plan', source: 'County Planning', sourceType: 'county_planning', snippet: 'New industrial park approved', timestamp: 't', confidence: 'medium', supports: 'growth', doesNotProve: 'parcel facts' }];
    const r = await collectBrowserMarketIntelligence({ city: 'Poulan', state: 'GA' }, { backend: async () => ev });
    expect(r.status).toBe('collected');
    expect(r.evidence[0].url).toContain('county.gov');
    expect(r.evidence[0].doesNotProve).toBeTruthy();
  });
});
