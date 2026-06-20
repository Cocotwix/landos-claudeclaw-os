import { describe, it, expect } from 'vitest';
import {
  makeApifyCompProvider,
  extractComp,
  type ApifyRunner,
} from './apify-comp-provider.js';
import type { CompQuery } from '../comp-retrieval.js';

const QUERY: CompQuery = { address: '57 Church Road', county: 'Anne Arundel', state: 'MD', acres: 10 };
const OPTS = { timeoutMs: 30_000 };

/** A runner that returns a fixed dataset, ignoring inputs. */
function fixedRunner(items: unknown[]): ApifyRunner {
  return { async run() { return items; } };
}

const GOOD_REDFIN_ROW = {
  soldPrice: 250_000,
  soldDate: '2026-03-15',
  url: 'https://www.redfin.com/MD/Arnold/57-Church-Rd/home/12345',
  acres: 9.5,
  address: '57 Church Rd, Arnold, MD',
};

describe('extractComp — deterministic critical fields', () => {
  it('extracts price, sale date (ISO), and source URL from a good row', () => {
    const ex = extractComp(GOOD_REDFIN_ROW, 'redfin');
    expect(ex.ok).toBe(true);
    if (!ex.ok) return;
    expect(ex.comp.price).toBe(250_000);
    expect(ex.comp.saleDateIso).toBe(new Date('2026-03-15').toISOString());
    expect(ex.comp.sourceUrl).toBe(GOOD_REDFIN_ROW.url);
    expect(ex.comp.sourceLabel).toBe('redfin');
    expect(ex.comp.acres).toBe(9.5);
  });

  it('parses a "$250,000" string price deterministically (no LLM)', () => {
    const ex = extractComp({ ...GOOD_REDFIN_ROW, soldPrice: '$250,000' }, 'redfin');
    expect(ex.ok).toBe(true);
    if (ex.ok) expect(ex.comp.price).toBe(250_000);
  });

  it('resolves a root-relative Zillow URL against the source domain', () => {
    const ex = extractComp(
      { price: 90_000, soldDate: '2026-01-02', url: '/homedetails/123_zpid/' },
      'zillow',
    );
    expect(ex.ok).toBe(true);
    if (ex.ok) expect(ex.comp.sourceUrl).toBe('https://www.zillow.com/homedetails/123_zpid/');
  });

  it('derives acres from lot square footage when no acre field is present', () => {
    const ex = extractComp(
      { price: 100_000, soldDate: '2026-02-01', url: 'https://www.redfin.com/x', lotSizeSqft: 43_560 },
      'redfin',
    );
    expect(ex.ok).toBe(true);
    if (ex.ok) expect(ex.comp.acres).toBe(1);
  });

  it('drops a row missing the price (never guessed)', () => {
    const { soldPrice, ...noPrice } = GOOD_REDFIN_ROW;
    void soldPrice;
    const ex = extractComp(noPrice, 'redfin');
    expect(ex.ok).toBe(false);
    if (!ex.ok) expect(ex.reason).toMatch(/price/);
  });

  it('drops a row missing the source URL (never shown unsourced)', () => {
    const { url, ...noUrl } = GOOD_REDFIN_ROW;
    void url;
    const ex = extractComp(noUrl, 'redfin');
    expect(ex.ok).toBe(false);
    if (!ex.ok) expect(ex.reason).toMatch(/URL/);
  });

  it('drops a row with an unparseable sale date', () => {
    const ex = extractComp({ ...GOOD_REDFIN_ROW, soldDate: 'sometime last spring' }, 'redfin');
    expect(ex.ok).toBe(false);
    if (!ex.ok) expect(ex.reason).toMatch(/date/);
  });

  it('drops a non-object row', () => {
    expect(extractComp('not a row', 'redfin').ok).toBe(false);
    expect(extractComp(null, 'redfin').ok).toBe(false);
  });
});

describe('makeApifyCompProvider.retrieve', () => {
  it('returns kept comps and counts drops from mixed rows', async () => {
    const provider = makeApifyCompProvider('redfin', {
      actorId: 'acme/redfin',
      runner: fixedRunner([
        GOOD_REDFIN_ROW,
        { ...GOOD_REDFIN_ROW, url: undefined }, // missing URL -> dropped
        { ...GOOD_REDFIN_ROW, soldPrice: undefined }, // missing price -> dropped
        { ...GOOD_REDFIN_ROW, soldDate: '2026-04-01', soldPrice: 300_000 },
      ]),
    });
    const res = await provider.retrieve(QUERY, OPTS);
    expect(res.status).toBe('connected');
    expect(res.comps).toHaveLength(2);
    expect(res.comps.every((c) => /^https:\/\//.test(c.sourceUrl))).toBe(true);
    expect(res.note).toMatch(/2 dropped/);
  });

  it('reports no_comps on an empty dataset (never fabricates)', async () => {
    const provider = makeApifyCompProvider('zillow', { actorId: 'acme/zillow', runner: fixedRunner([]) });
    const res = await provider.retrieve(QUERY, OPTS);
    expect(res.status).toBe('no_comps');
    expect(res.comps).toHaveLength(0);
  });

  it('returns connected with zero comps when every row is unverifiable', async () => {
    const provider = makeApifyCompProvider('redfin', {
      actorId: 'acme/redfin',
      runner: fixedRunner([{ foo: 'bar' }, { url: 'https://www.redfin.com/x' }]),
    });
    const res = await provider.retrieve(QUERY, OPTS);
    expect(res.status).toBe('connected');
    expect(res.comps).toHaveLength(0);
    expect(res.note).toMatch(/dropped/);
    expect(res.note).toMatch(/none invented/);
  });

  it('maps an AbortError/timeout to status timeout (no comps)', async () => {
    const provider = makeApifyCompProvider('redfin', {
      actorId: 'acme/redfin',
      runner: {
        async run() {
          const err = new Error('aborted');
          err.name = 'AbortError';
          throw err;
        },
      },
    });
    const res = await provider.retrieve(QUERY, OPTS);
    expect(res.status).toBe('timeout');
    expect(res.comps).toHaveLength(0);
  });

  it('maps an unexpected throw to status error (no comps, none invented)', async () => {
    const provider = makeApifyCompProvider('zillow', {
      actorId: 'acme/zillow',
      runner: { async run() { throw new Error('actor 500'); } },
    });
    const res = await provider.retrieve(QUERY, OPTS);
    expect(res.status).toBe('error');
    expect(res.comps).toHaveLength(0);
    expect(res.note).toMatch(/none invented/);
  });

  it('treats a malformed (non-array) dataset as an error', async () => {
    const provider = makeApifyCompProvider('redfin', {
      actorId: 'acme/redfin',
      runner: { async run() { return { not: 'an array' } as unknown as unknown[]; } },
    });
    const res = await provider.retrieve(QUERY, OPTS);
    expect(res.status).toBe('error');
    expect(res.comps).toHaveLength(0);
  });

  it('passes the built actor input to the runner', async () => {
    let seen: unknown;
    const provider = makeApifyCompProvider('redfin', {
      actorId: 'acme/redfin',
      runner: {
        async run(_actorId, input) { seen = input; return []; },
      },
    });
    await provider.retrieve(QUERY, OPTS);
    expect(seen).toMatchObject({ search: '57 Church Road, Anne Arundel, MD' });
  });
});
