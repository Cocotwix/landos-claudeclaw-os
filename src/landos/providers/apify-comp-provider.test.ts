import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  extractComp,
  isFullComp,
  makeRedfinTwoStageProvider,
  REDFIN_PROPERTY_TYPE,
  type ApifyRunner,
} from './apify-comp-provider.js';
import type { CompQuery } from '../comp-retrieval.js';

// Tests read ONLY the sanitized, committed fixture at the canonical path. It is
// fully synthetic (no real property identifiers) but preserves the exact nested
// shape + behaviors the extractor depends on.
const FIXTURE_PATH = fileURLToPath(new URL('./__fixtures__/tri-angle-redfin-detail.sample.json', import.meta.url));
const FIXTURE: unknown[] = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
const REC_PRICED = FIXTURE[0]; // Active list, previously SOLD (the list-vs-sold proof)
const REC_ABSENT = FIXTURE[1]; // land, NO sold price/date (verify-in-underwriting case)

// Synthetic fixture values (all three price signals are distinct on purpose).
const SOLD_PRICE = 240_000; // historicalData.saleHistory[0].salePrice == avmInfo.lastSoldPrice
const LIST_PRICE = 199_000; // addressSectionInfo.priceInfo.amount (current list — must be IGNORED)
const PREDICTED_AVM = 183_500; // avmInfo.predictedValue (AVM — must be IGNORED)
const SALE_DATE_MS = 1_739_232_000_000;
const LOT_SQFT = 217_800; // = 5.0 acres
const APN = 'SANITIZED-APN-0001';

const OPTS = { timeoutMs: 30_000 };

describe('extractComp — nested tri_angle/redfin-detail shape (state-agnostic)', () => {
  it('reads SOLD price from saleHistory/lastSoldPrice and IGNORES list price + AVM (all three distinct)', () => {
    // The fixture deliberately makes sold, current list, and AVM three different numbers.
    expect(SOLD_PRICE).not.toBe(LIST_PRICE);
    expect(SOLD_PRICE).not.toBe(PREDICTED_AVM);
    expect(LIST_PRICE).not.toBe(PREDICTED_AVM);

    const ex = extractComp(REC_PRICED, 'redfin');
    expect(ex.ok).toBe(true);
    if (!ex.ok) return;
    const c = ex.comp;
    // Sold price is the historical sale, not the current list, not the AVM.
    expect(c.soldPriceUsd).toBe(SOLD_PRICE);
    expect(c.listPriceUsd).toBe(LIST_PRICE);
    expect(c.soldPriceUsd).not.toBe(c.listPriceUsd); // list-vs-sold distinction baked in
    expect(c.soldPriceUsd).not.toBe(PREDICTED_AVM); // AVM never used as sold
  });

  it('converts the epoch-ms sale date to ISO', () => {
    const ex = extractComp(REC_PRICED, 'redfin');
    if (!ex.ok) throw new Error('expected ok');
    expect(ex.comp.soldDateIso).toBe(new Date(SALE_DATE_MS).toISOString());
  });

  it('derives acres from lotSize square feet (lotSize / 43560)', () => {
    const ex = extractComp(REC_PRICED, 'redfin');
    if (!ex.ok) throw new Error('expected ok');
    expect(ex.comp.lotSizeSqft).toBe(LOT_SQFT);
    expect(ex.comp.acres).toBe(5); // 217800 / 43560
  });

  it('reads propertyType 8 = Land and the identity/geo fields', () => {
    const ex = extractComp(REC_PRICED, 'redfin');
    if (!ex.ok) throw new Error('expected ok');
    const c = ex.comp;
    expect(c.propertyTypeCode).toBe(REDFIN_PROPERTY_TYPE.LAND);
    expect(c.apn).toBe(APN);
    expect(c.state).toBe('ST');
    expect(c.daysOnMarket).toBe(78);
    expect(typeof c.latitude).toBe('number');
    expect(typeof c.longitude).toBe('number');
  });

  it('resolves the relative addressSectionInfo.url to an absolute Redfin URL', () => {
    const ex = extractComp(REC_PRICED, 'redfin');
    if (!ex.ok) throw new Error('expected ok');
    expect(ex.comp.sourceUrl).toMatch(/^https:\/\/www\.redfin\.com\/ST\/Sampletown\//);
  });

  it('a complete sold comp carries NO verify tags and is a full comp', () => {
    const ex = extractComp(REC_PRICED, 'redfin');
    if (!ex.ok) throw new Error('expected ok');
    expect(ex.comp.verifyTags).toEqual([]);
    expect(isFullComp(ex.comp)).toBe(true);
  });

  it('price absent -> KEPT and tagged "verify in underwriting" (never dropped, no state names)', () => {
    const ex = extractComp(REC_ABSENT, 'redfin');
    expect(ex.ok).toBe(true); // kept, not dropped
    if (!ex.ok) return;
    const c = ex.comp;
    expect(c.soldPriceUsd).toBeNull();
    expect(c.soldDateIso).toBeNull();
    expect(isFullComp(c)).toBe(false);
    expect(c.verifyTags.join(' ')).toMatch(/sold price absent — verify in underwriting/);
    // Still a real land parcel with identity, just unverified on price.
    expect(c.propertyTypeCode).toBe(REDFIN_PROPERTY_TYPE.LAND);
  });

  it('URL absent (no url / scraperInput / mainHouseInfo.url) -> kept but tagged, sourceUrl empty', () => {
    const noUrl = JSON.parse(JSON.stringify(REC_PRICED));
    delete noUrl.addressSectionInfo.url;
    delete noUrl.scraperInput;
    delete noUrl.mainHouseInfo.url;
    const ex = extractComp(noUrl, 'redfin');
    expect(ex.ok).toBe(true);
    if (!ex.ok) return;
    expect(ex.comp.sourceUrl).toBe('');
    expect(isFullComp(ex.comp)).toBe(false);
    expect(ex.comp.verifyTags.join(' ')).toMatch(/source URL absent — verify in underwriting/);
  });

  it('drops a non-object row (the only hard failure)', () => {
    expect(extractComp('nope', 'redfin').ok).toBe(false);
    expect(extractComp(null, 'redfin').ok).toBe(false);
  });
});

// ── Two-stage provider ──────────────────────────────────────────────────────

const CENTROID = { lat: 40.0, lng: -90.0 }; // matches REC_PRICED latLong
const QUERY: CompQuery = { apn: APN, county: 'Sample', state: 'ST', acres: 5, centroid: CENTROID, centroidTier: 'A' };

/** Runner that branches by actor id: search -> url rows, detail -> given records. */
function twoStageRunner(searchActorId: string, urls: string[], detailRecords: unknown[]): ApifyRunner {
  let searchCalls = 0;
  return {
    async run(actorId) {
      if (actorId === searchActorId) {
        searchCalls++;
        // Only the first radius yields URLs; wider radii add nothing (dedup).
        return searchCalls === 1 ? urls.map((u) => ({ url: u })) : [];
      }
      return detailRecords;
    },
  };
}

describe('makeRedfinTwoStageProvider', () => {
  it('runs search -> detail, extracts comps, computes distance, logs spend per actor', async () => {
    const urls = ['/ST/a/home/1', '/ST/b/home/2', '/ST/c/home/3', '/ST/d/home/4', '/ST/e/home/5'];
    const spends: Array<{ actorId: string; stage: string; rows: number }> = [];
    const provider = makeRedfinTwoStageProvider({
      searchActorId: 'tri_angle/redfin-search',
      detailActorId: 'tri_angle/redfin-detail',
      runner: twoStageRunner('tri_angle/redfin-search', urls, [REC_PRICED, REC_PRICED, REC_PRICED, REC_PRICED, REC_PRICED]),
      onSpend: (ev) => spends.push(ev),
    });
    const res = await provider.retrieve(QUERY, OPTS);
    expect(res.status).toBe('connected');
    expect(res.comps.length).toBe(5);
    expect(res.comps[0].price).toBe(SOLD_PRICE);
    expect(typeof res.comps[0].distanceMiles).toBe('number');
    // Spend logged with the ACTUAL actor ids (search + detail), never a credential.
    expect(spends.some((s) => s.actorId === 'tri_angle/redfin-search' && s.stage === 'search')).toBe(true);
    expect(spends.some((s) => s.actorId === 'tri_angle/redfin-detail' && s.stage === 'detail')).toBe(true);
  });

  it('no trusted centroid -> graceful no_comps (never invents a location)', async () => {
    const provider = makeRedfinTwoStageProvider({
      searchActorId: 's', detailActorId: 'd',
      runner: { async run() { throw new Error('should not run without a centroid'); } },
    });
    const res = await provider.retrieve({ apn: APN }, OPTS);
    expect(res.status).toBe('no_comps');
    expect(res.comps).toHaveLength(0);
  });

  it('a sold-price-absent detail row is KEPT in needsVerification, not in comps', async () => {
    const provider = makeRedfinTwoStageProvider({
      searchActorId: 's', detailActorId: 'd',
      runner: twoStageRunner('s', ['/ST/x/home/9'], [REC_ABSENT]),
    });
    const res = await provider.retrieve(QUERY, OPTS);
    expect(res.comps).toHaveLength(0);
    expect(res.needsVerification && res.needsVerification.length).toBe(1);
    expect((res.needsVerification ?? [])[0].verifyTags.join(' ')).toMatch(/verify in underwriting/);
  });

  it('Tier B (area-level) comps inherit the area-level caveat', async () => {
    const provider = makeRedfinTwoStageProvider({
      searchActorId: 's', detailActorId: 'd',
      runner: twoStageRunner('s', ['/ST/x/home/1'], [REC_PRICED]),
    });
    const res = await provider.retrieve({ ...QUERY, centroidTier: 'B' }, OPTS);
    expect(res.comps).toHaveLength(1);
    // A full comp carrying soft caveats is mirrored onto needsVerification.
    expect((res.needsVerification ?? []).some((c) => c.verifyTags.some((t) => /area-level/.test(t)))).toBe(true);
  });

  it('maps a search-actor timeout to status timeout (no comps, none invented)', async () => {
    const provider = makeRedfinTwoStageProvider({
      searchActorId: 's', detailActorId: 'd',
      runner: { async run() { const e = new Error('aborted'); e.name = 'AbortError'; throw e; } },
    });
    const res = await provider.retrieve(QUERY, OPTS);
    expect(res.status).toBe('timeout');
    expect(res.comps).toHaveLength(0);
  });

  it('maps an unexpected throw to status error (none invented)', async () => {
    const provider = makeRedfinTwoStageProvider({
      searchActorId: 's', detailActorId: 'd',
      runner: { async run() { throw new Error('actor 500'); } },
    });
    const res = await provider.retrieve(QUERY, OPTS);
    expect(res.status).toBe('error');
    expect(res.note).toMatch(/none invented/);
  });
});
