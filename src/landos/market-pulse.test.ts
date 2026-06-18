// Market Pulse v1 tests. Pure + deterministic (injected timestamp). No network,
// no fabricated market numbers, no scraping, no coordinates.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { buildMarketPulseV1 } from './market-pulse.js';

const NOW = '2026-06-17T00:00:00.000Z';

describe('eligibility + labeling', () => {
  it('city + state is eligible and labeled Local Area Context when unverified', () => {
    const mp = buildMarketPulseV1({ city: 'Fayetteville', state: 'NC', parcelVerified: false, nowIso: NOW });
    expect(mp.eligible).toBe(true);
    expect(mp.label).toBe('Local Area Context, Not Parcel Verified');
    expect(mp.disclaimer.toLowerCase()).toContain('does not verify the parcel');
    expect(mp.generatedAt).toBe(NOW);
  });

  it('county + state is eligible', () => {
    const mp = buildMarketPulseV1({ county: 'Cumberland', state: 'NC', parcelVerified: false, nowIso: NOW });
    expect(mp.eligible).toBe(true);
  });

  it('no city/county + state is not eligible and produces no signals', () => {
    const mp = buildMarketPulseV1({ parcelVerified: false, nowIso: NOW });
    expect(mp.eligible).toBe(false);
    expect(mp.signals.length).toBe(0);
  });

  it('a verified parcel flips the label (still local-area context)', () => {
    const mp = buildMarketPulseV1({ city: 'Fayetteville', state: 'NC', parcelVerified: true, nowIso: NOW });
    expect(mp.label).toBe('Parcel Verified');
  });

  it('uses verified county/state as local area (propertyid+FIPS unknown-area regression)', () => {
    // A propertyid+FIPS input has no area words; the route passes the verified
    // LandPortal county/state. Market Pulse must resolve Coffee County, TN — not
    // "unknown area".
    const mp = buildMarketPulseV1({ county: 'Coffee', state: 'TN', parcelVerified: true, nowIso: NOW });
    expect(mp.eligible).toBe(true);
    expect(mp.localArea.descriptor).toBe('Coffee County, TN');
    expect(mp.localArea.descriptor).not.toMatch(/unknown area/);
  });
});

describe('safe sources + no fabrication', () => {
  const mp = buildMarketPulseV1({ city: 'Fayetteville', state: 'NC', parcelVerified: false, nowIso: NOW });

  it('population/growth has a real official on-demand source reference (no invented number)', () => {
    const pop = mp.signals.find((s) => s.signal === 'population_growth_direction')!;
    expect(pop.status).toBe('source_available');
    expect(pop.sourceName).toMatch(/Census/i);
    expect(pop.sourceUrl).toMatch(/^https:\/\/data\.census\.gov\//);
    expect(pop.note.toLowerCase()).toContain('not fabricated');
  });

  it('listing/market metrics stay not_connected with the exact approval needed and never a number', () => {
    for (const sig of ['active_sold_land_activity', 'median_range_price_per_acre', 'days_on_market', 'buyer_demand_signal', 'relevant_acreage_bands']) {
      const s = mp.signals.find((x) => x.signal === sig)!;
      expect(s.status, sig).toBe('not_connected');
      expect(s.approvalNeeded, sig).toBeTypeOf('string');
      // No fabricated figure anywhere in the entry.
      const blob = JSON.stringify(s);
      expect(/\$\s?\d|\bper acre\b\s*\d|\b\d+\s*(days|acres|listings|sold)\b/i.test(blob), sig).toBe(false);
    }
  });

  it('planning / comprehensive-plan signals are data_gap with the exact source needed', () => {
    for (const sig of ['planning_zoning_development_signals', 'comprehensive_plan_future_land_use', 'permit_subdivision_infrastructure_activity']) {
      const s = mp.signals.find((x) => x.signal === sig)!;
      expect(s.status, sig).toBe('data_gap');
      expect(s.approvalNeeded, sig).toMatch(/URL/);
    }
  });

  it('uses no scraping / coordinate / marketplace language', () => {
    const blob = JSON.stringify(mp).toLowerCase();
    for (const banned of ['zillow', 'redfin', 'realtor', 'landwatch', 'geocode', 'coordinate', 'map pin', 'scrape', 'nearest parcel']) {
      expect(blob.includes(banned), banned).toBe(false);
    }
  });
});

describe('source-scan: contract is safe', () => {
  const SRC = fs.readFileSync(fileURLToPath(new URL('./market-pulse.ts', import.meta.url)), 'utf-8');
  it('never calls a paid LandPortal comp tool', () => {
    expect(/lp_comp_report_create\s*\(/.test(SRC)).toBe(false);
    expect(/lp_comp_report_get\s*\(/.test(SRC)).toBe(false);
  });
  it('makes no network call itself (pure builder)', () => {
    expect(/\bfetch\s*\(/.test(SRC)).toBe(false);
  });
});
