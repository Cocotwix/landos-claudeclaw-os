import { describe, it, expect } from 'vitest';
import {
  evaluateInPark,
  filterInParkComps,
  manufacturedTypeGate,
  deterministicInParkScan,
  type InParkNormalizer,
  type ModelCallLogger,
} from './in-park-filter.js';
import { REDFIN_PROPERTY_TYPE, type DetailComp } from './providers/apify-comp-provider.js';

function makeDetail(over: Partial<DetailComp> = {}): DetailComp {
  return {
    sourceUrl: 'https://www.redfin.com/x',
    sourceLabel: 'redfin',
    soldPriceUsd: 150_000,
    soldDateIso: '2026-01-01T00:00:00.000Z',
    listPriceUsd: null,
    acres: 0.5,
    lotSizeSqft: 21_780,
    apn: '1',
    county: 'X',
    state: 'IL',
    latitude: 39.66,
    longitude: -89.65,
    daysOnMarket: 30,
    propertyTypeCode: REDFIN_PROPERTY_TYPE.LAND,
    descriptionText: '',
    verifyTags: [],
    ...over,
  };
}

describe('manufacturedTypeGate — never guesses the manufactured code', () => {
  it('maps known codes and fails loud on unknown/absent codes', () => {
    expect(manufacturedTypeGate(REDFIN_PROPERTY_TYPE.LAND)).toBe('land');
    expect(manufacturedTypeGate(REDFIN_PROPERTY_TYPE.SINGLE_FAMILY)).toBe('residential');
    expect(manufacturedTypeGate(13)).toBe('unverified_manufactured');
    expect(manufacturedTypeGate(null)).toBe('unverified_manufactured');
  });
});

describe('evaluateInPark — fail loud on unverified type', () => {
  it('an unknown property type fails loud (manual underwriting, never auto-classified)', async () => {
    const r = await evaluateInPark(makeDetail({ propertyTypeCode: 13 }));
    expect(r.decision).toBe('fail_loud_unverified_type');
    expect(r.failLoud).toBe(true);
    expect(r.keep).toBe(false);
    expect(r.reason).toMatch(/UNVERIFIED|never guessed|Manual underwriting/);
  });

  it('an absent property type fails loud', async () => {
    const r = await evaluateInPark(makeDetail({ propertyTypeCode: null }));
    expect(r.decision).toBe('fail_loud_unverified_type');
  });
});

describe('evaluateInPark — text-based in-park decision (state-agnostic)', () => {
  it('HOA / lot-rent language -> EXCLUDE (not owned land)', async () => {
    const r = await evaluateInPark(makeDetail({ descriptionText: 'Cozy home, lot rent $450/mo in a manufactured home community.' }));
    expect(r.decision).toBe('exclude_in_park');
    expect(r.keep).toBe(false);
  });

  it('owned-land language -> KEEP', async () => {
    const r = await evaluateInPark(makeDetail({ descriptionText: 'You own the land, deeded lot, real property.' }));
    expect(r.decision).toBe('keep_owned_land');
    expect(r.keep).toBe(true);
  });

  it('ambiguous text -> EXCLUDE conservatively (never assume owned)', async () => {
    const r = await evaluateInPark(makeDetail({ descriptionText: 'Charming spot close to town and schools.' }));
    expect(r.decision).toBe('exclude_ambiguous');
    expect(r.keep).toBe(false);
  });

  it('lotSize is only a weak signal and does not override ambiguity', async () => {
    const r = await evaluateInPark(makeDetail({ descriptionText: 'Charming spot.', acres: 3 }));
    expect(r.decision).toBe('exclude_ambiguous');
    expect(r.reason).toMatch(/weak hint/);
  });
});

describe('evaluateInPark — Gemma normalizer is normalizer-only, logged, and degrades', () => {
  it('uses the injected Gemma classification and logs the model call', async () => {
    const logs: Array<{ provider: string; model: string; taskClass: string }> = [];
    const normalizer: InParkNormalizer = { async classify() { return { hoaOrLotRent: true, ownedLandAffirmed: false, confidence: 0.9 }; } };
    const logger: ModelCallLogger = { log: (o) => logs.push(o) };
    const r = await evaluateInPark(makeDetail({ descriptionText: 'ambiguous text' }), { normalizer, logger, gemmaModel: 'gemma-4-e4b' });
    expect(r.decision).toBe('exclude_in_park');
    expect(r.signals.usedGemma).toBe(true);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ provider: 'ollama', model: 'gemma-4-e4b', taskClass: 'in_park_normalize' });
  });

  it('a throwing/absent Gemma degrades to the deterministic scan (never blocks, no log)', async () => {
    const logs: unknown[] = [];
    const normalizer: InParkNormalizer = { async classify() { throw new Error('ollama down'); } };
    const logger: ModelCallLogger = { log: (o) => logs.push(o) };
    const r = await evaluateInPark(makeDetail({ descriptionText: 'you own the land' }), { normalizer, logger });
    expect(r.signals.usedGemma).toBe(false);
    expect(r.decision).toBe('keep_owned_land'); // deterministic scan still works
    expect(logs).toHaveLength(0);
  });
});

describe('deterministicInParkScan', () => {
  it('flags lot-rent and owned-land terms', () => {
    expect(deterministicInParkScan('monthly lot rent applies').hoaOrLotRent).toBe(true);
    expect(deterministicInParkScan('deeded land, fee simple').ownedLandAffirmed).toBe(true);
    expect(deterministicInParkScan('no useful text').hoaOrLotRent).toBe(false);
  });
});

describe('filterInParkComps', () => {
  it('splits kept / excluded / failLoud across a set', async () => {
    const set = [
      makeDetail({ descriptionText: 'you own the land' }),                 // keep
      makeDetail({ descriptionText: 'lot rent community' }),                // exclude
      makeDetail({ descriptionText: 'vague' }),                            // exclude ambiguous
      makeDetail({ propertyTypeCode: 99, descriptionText: 'whatever' }),    // fail loud
    ];
    const res = await filterInParkComps(set);
    expect(res.kept).toHaveLength(1);
    expect(res.excluded).toHaveLength(2);
    expect(res.failLoud).toHaveLength(1);
  });
});
