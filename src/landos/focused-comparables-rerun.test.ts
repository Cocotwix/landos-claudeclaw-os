import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { _initTestLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { upsertPropertyCard } from './property-card.js';
import { PropertyResearchStore } from './property-research-store.js';
import { collectComparables, focusedLaneScope, type LiveCollectorDeps } from './property-intelligence-live.js';
import { normalizeRedfinListings, redfinLandFilterUrl } from './redfin-land-comps.js';
import { retainedLocalitiesForSubject } from './manufactured-home-enrichment.js';

beforeEach(() => { _initTestLandosDb(); });

function subjectDeal(): { id: number; cardId: number } {
  const { card } = upsertPropertyCard({
    entity: 'TY_LAND_BIZ', activeInputAddress: '100 QA Focused Ln', city: 'Lake Butler', state: 'FL', zip: '32054',
    county: 'Bradford', apn: 'QA-FOCUSED-1', acres: 1.5, lat: 30.0015, lng: -82.2721, verified: true, verificationSource: 'test', agentId: 'test',
  } as Parameters<typeof upsertPropertyCard>[0]);
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'QA focused rerun subject' });
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' } as Parameters<typeof linkPropertyToDeal>[0]);
  return { id: deal.id, cardId: card.id };
}

const SALE_URL = 'https://www.redfin.com/FL/Lake-Butler/100-QA-Sale-Ln-32054/home/1';

/** Fake providers that count their calls; the persistence dep is the REAL research-record writer. */
function fakeDeps(): { deps: LiveCollectorDeps; calls: Record<string, number> } {
  const calls: Record<string, number> = { zillow: 0, redfin: 0, realtor: 0, manufactured: 0 };
  const store = new PropertyResearchStore();
  const marketplace = (name: string) => async () => {
    calls[name] += 1;
    return { status: 'none' as const, note: `${name} fake`, sold: [], active: [] };
  };
  const deps = {
    persistProviderResult: (result: unknown) => store.persistProviderResult(result as never),
    captureZillowComps: marketplace('zillow'),
    captureRedfinComps: marketplace('redfin'),
    captureRealtorComps: marketplace('realtor'),
    captureManufacturedHomeComps: async () => {
      calls.manufactured += 1;
      return {
        status: 'retrieved' as const,
        note: 'Zillow: blocked (0 sold). Redfin: retrieved (1 sold). Realtor.com: blocked (0 sold). 1 unique manufactured-home sale(s) within the five-mile screen after address dedup.',
        active: [],
        sold: [{
          source: 'Redfin', address: '100 QA Sale Ln, Lake Butler, FL 32054', price: 290_000, acres: 1.5, pricePerAcre: 193_333, url: SALE_URL,
          status: 'sold', saleDate: '2025-08-06', collectedAt: '2026-09-02T00:00:00.000Z', lat: 30.0008, lng: -82.2708, distanceMiles: 0.1,
          homeType: 'mobile/manufactured home', yearBuilt: 1998, homeSizeSqft: 2280, beds: 4, baths: 2, lineage: 'page',
        }],
      };
    },
  } as unknown as LiveCollectorDeps;
  return { deps, calls };
}

describe('focused lane scope', () => {
  it('reads the operator scope and refuses to invent one', () => {
    expect(focusedLaneScope(undefined)).toBeNull();
    expect(focusedLaneScope('everything')).toBeNull();
    expect(focusedLaneScope('comparables')).toEqual({ vacantLand: true, manufacturedHomes: true });
    expect(focusedLaneScope('manufactured_home')).toEqual({ vacantLand: false, manufacturedHomes: true });
    expect(focusedLaneScope({ lanes: ['vacant-land'] })).toEqual({ vacantLand: true, manufacturedHomes: false });
    expect(focusedLaneScope({ lanes: ['manufactured homes', 'vacant_land'] })).toEqual({ vacantLand: true, manufacturedHomes: true });
  });
});

describe('focused comparables rerun through the existing collector', () => {
  it('runs only the requested manufactured-home lane and persists its evidence through the canonical research-record writer', async () => {
    const { id, cardId } = subjectDeal();
    const { deps, calls } = fakeDeps();
    const outcome = await collectComparables({ dealCardId: id, runId: 'focused-test-1', identity: null, comparables: null, laneScope: { vacantLand: false, manufacturedHomes: true } }, deps);
    expect(calls).toEqual({ zillow: 0, redfin: 0, realtor: 0, manufactured: 1 });
    expect(outcome.summary).toMatch(/Focused rerun: manufactured-home market requested/);
    const record = new PropertyResearchStore().loadForProperty(cardId);
    const status = record?.evidence.find((item) => item.field === 'comparables.manufactured_home.attempt_status');
    expect(status?.value).toMatchObject({ status: 'retrieved' });
    const sale = record?.evidence.find((item) => item.kind === 'comp' && item.providerId === 'zillow_manufactured_home');
    expect(sale?.value).toMatchObject({ source: 'Redfin', url: SALE_URL, price: 290_000, saleDate: '2025-08-06', distanceMiles: 0.1, beds: 4, baths: 2, homeSizeSqft: 2280 });
    expect(record?.evidence.some((item) => item.field === 'comparables.zillow.attempt_status')).toBe(false);
    // The manufactured sale is a candidate for the Land Home screen, never a vacant-land sale.
    const candidate = outcome.data?.candidates.find((row) => row.sourceUrl === SALE_URL);
    expect(candidate).toMatchObject({ provider: 'Redfin manufactured-home sold', compClass: 'manufactured' });
  });

  it('runs only the vacant-land lanes when asked, and the identical rerun keeps one record per provider URL', async () => {
    const { id, cardId } = subjectDeal();
    const { deps, calls } = fakeDeps();
    await collectComparables({ dealCardId: id, runId: 'focused-test-2', identity: null, comparables: null, laneScope: { vacantLand: true, manufacturedHomes: false } }, deps);
    expect(calls.manufactured).toBe(0);
    expect(calls.zillow).toBe(1);
    expect(calls.redfin).toBe(1);
    // Manufactured twice: the record dedups on the provider URL, so the second
    // identical rerun changes the evidence count by nothing.
    await collectComparables({ dealCardId: id, runId: 'focused-test-3', identity: null, comparables: null, laneScope: { vacantLand: false, manufacturedHomes: true } }, deps);
    const first = new PropertyResearchStore().loadForProperty(cardId)?.evidence.filter((item) => item.kind === 'comp' && (item.value as { url?: string }).url === SALE_URL).length;
    await collectComparables({ dealCardId: id, runId: 'focused-test-4', identity: null, comparables: null, laneScope: { vacantLand: false, manufacturedHomes: true } }, deps);
    const second = new PropertyResearchStore().loadForProperty(cardId)?.evidence.filter((item) => item.kind === 'comp' && (item.value as { url?: string }).url === SALE_URL).length;
    expect(first).toBe(1);
    expect(second).toBe(1);
  });

  it('is reachable only through the existing Property Intelligence run endpoint, under its lock, and closes through the existing coverage cycle', () => {
    const src = fs.readFileSync(new URL('./routes.ts', import.meta.url), 'utf8');
    const start = src.indexOf("app.post('/api/landos/deal-cards/:id/property-intelligence/run'");
    const fullRun = src.indexOf('launchDealIntelligenceMission({', start);
    const branch = src.slice(start, fullRun);
    expect(start).toBeGreaterThan(0);
    expect(branch).toMatch(/focusedLaneScope\(body\.scope\)/);
    expect(branch).toMatch(/acquireExecutionLock\(PROPERTY_RESOLUTION_CAPABILITY_ID/);
    expect(branch).toMatch(/collectors\.comparables\(\{[^}]*laneScope: focusedScope/);
    expect(branch).toMatch(/runDealCoverageCycle\(id, [^)]*'operator_rerun'\)/);
    expect(branch).not.toMatch(/launchDealIntelligenceMission/);
    // No second run endpoint exists for the focused path.
    expect(src.match(/property-intelligence\/run'/g)?.length).toBe(1);
  });
});

describe('Redfin manufactured board', () => {
  it('uses Redfin\'s real manufactured filter key and never the dropped `mobile` key', () => {
    const url = redfinLandFilterUrl('/zipcode/32054', { sold: true, dateWindowMonths: 24, propertyType: 'manufactured' });
    expect(url).toBe('https://www.redfin.com/zipcode/32054/filter/property-type=manufactured,include=sold-2yr');
    expect(url).not.toMatch(/property-type=mobile/);
    expect(redfinLandFilterUrl('/zipcode/32054', { sold: true })).toContain('property-type=land');
  });

  it('labels a manufactured-board sold card as manufactured housing and keeps it when the card states only "Last sold price"', () => {
    const rows = normalizeRedfinListings([
      { price: 290_000, acres: null, sqftLot: null, address: '19517 NW 137th Ln, Lake Butler, FL 32054', residential: true, url: SALE_URL, status: 'sold', thumbnailUrl: null },
    ] as never, 1.5, 'sold', 'manufactured');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'sold', soldDate: null, url: SALE_URL });
    expect(rows[0].homeType).toMatch(/manufactured/i);
  });
});

describe('retained localities aim the indexed search', () => {
  it('reads the subject street, the retained subdivision and nearby retained streets from the research record', () => {
    const record = {
      facts: { Subdivision: { value: 'RIVER OAK PLANTATION S/D' } },
      evidence: [
        { kind: 'comp', value: { address: '19414 NW 135th Ln, Lake Butler, FL 32054', distanceMiles: 0.3 } },
        { kind: 'comp', value: { address: '2763 Mortimer Way, Starke, FL 32091', distanceMiles: 11.4 } },
        { kind: 'comp', value: { address: '19407 NW 135th Pl, Lake Butler, FL 32054', lat: 30.004, lng: -82.273 } },
        { kind: 'fact', value: { address: '1 Ignored St, Lake Butler, FL 32054', distanceMiles: 0.1 } },
      ],
    };
    expect(retainedLocalitiesForSubject(record, { address: '19554 NW 137th Ln', lat: 30.0015, lng: -82.2721 })).toEqual(['NW 137th Ln', 'River Oak Plantation', 'NW 135th Ln', 'NW 135th Pl']);
    expect(retainedLocalitiesForSubject(null, { address: 'Parcel 023.003-02' })).toEqual([]);
  });
});

describe('Redfin board pagination', () => {
  it('reads the second board page when the board states more homes than it rendered, and keeps a sale that only appears there', async () => {
    const { fetchRedfinLandComps } = await import('./redfin-land-comps.js');
    const page1 = [{ price: 239_900, acres: null, sqftLot: null, address: '19414 NW 135th Ln, Lake Butler, FL 32054', residential: true, url: 'https://www.redfin.com/FL/Lake-Butler/19414/home/1', status: 'sold', thumbnailUrl: null }];
    const page2 = [{ price: 290_000, acres: 1.5, sqftLot: null, address: '19517 NW 137th Ln, Lake Butler, FL 32054', residential: true, url: 'https://www.redfin.com/FL/Lake-Butler/19517/home/2', status: 'sold', thumbnailUrl: null }];
    const visited: string[] = [];
    let current = '';
    const connect = async () => ({
      async newPage() {
        return {
          async setViewport() {},
          async goto(url: string) { visited.push(url); current = url; },
          keyboard: { async press() {} },
          async evaluate(fn: unknown) {
            const src = String(fn);
            if (src.includes('scrollBy')) return undefined as never;
            if (src.includes('search-box-input')) return true as never;
            if (src.includes('press and hold')) return false as never;
            if (src.includes('HomeCardContainer')) return (current.includes('/page-2') ? page2 : current.includes('/zipcode/32054/') ? page1 : []) as never;
            if (src.includes('/city/')) return 'https://www.redfin.com/zipcode/32054' as never;
            if (src.includes('document.title')) return { url: current, text: '32054, FL home for sale & real estate 69 homes 32054' } as never;
            return undefined as never;
          },
        };
      },
      async close() {},
    });
    const result = await fetchRedfinLandComps({ city: 'Lake Butler', state: 'FL', zip: '32054', mode: 'sold', dateWindowMonths: 24, propertyType: 'manufactured' }, { force: true, connect: connect as never, timeoutMs: 10, settleMs: 1, suggestionSettleMs: 1, scrollSettleMs: 1 });
    expect(result.status).toBe('retrieved');
    expect(visited.some((url) => /property-type=manufactured,include=sold-2yr\/page-2$/.test(url))).toBe(true);
    expect(result.comps.map((c) => c.address)).toEqual(['19414 NW 135th Ln, Lake Butler, FL 32054', '19517 NW 137th Ln, Lake Butler, FL 32054']);
    expect(result.comps[1].url).toBe('https://www.redfin.com/FL/Lake-Butler/19517/home/2');
    expect(result.note).toMatch(/across 2 board page\(s\) of 69 stated homes/);
  });
});
