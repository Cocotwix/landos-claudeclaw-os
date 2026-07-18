import { beforeEach, describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { _initTestLandosDb } from './db.js';
import { createDealCard } from './deal-card.js';
import { upsertPropertyCard } from './property-card.js';
import {
  addComp,
  listComps,
  recommendCompSources,
  evaluateCompRecency,
  isPaidCompAllowed,
  assertPaidCompAllowed,
  PAID_COMP_TOOLS,
} from './comps.js';

beforeEach(() => {
  _initTestLandosDb();
});

describe('paid comp-tool guardrail', () => {
  it('prohibits paid comp tools in every workflow', () => {
    for (const mode of ['live_property_workflow', 'build', 'test', 'mock', 'smoke', 'seed', 'debug', 'unknown'] as const) {
      expect(isPaidCompAllowed(mode)).toBe(false);
      expect(() => assertPaidCompAllowed(mode, 'lp_comp_report_create')).toThrow(/blocked/i);
    }
  });

  it('the paid comp tool list is the two LandPortal comp endpoints', () => {
    expect(PAID_COMP_TOOLS).toContain('lp_comp_report_create');
    expect(PAID_COMP_TOOLS).toContain('lp_comp_report_get');
  });

  it('this bridge build never calls the paid comp tools', () => {
    // Static guarantee: the LandOS bridge sources must not invoke the paid
    // LandPortal comp endpoints (only reference them as guarded constants).
    const here = fileURLToPath(new URL('.', import.meta.url));
    const files = ['comps.ts', 'deal-card.ts', 'duke-persist-adapter.ts', 'property-card.ts', 'routes.ts'];
    for (const f of files) {
      const src = fs.readFileSync(here + f, 'utf-8');
      expect(/lp_comp_report_create\s*\(/.test(src), `${f} calls lp_comp_report_create`).toBe(false);
      expect(/lp_comp_report_get\s*\(/.test(src), `${f} calls lp_comp_report_get`).toBe(false);
    }
  });
});

describe('recommendCompSources', () => {
  it('leads with LandPortal only when available and fresh', () => {
    expect(recommendCompSources({ acres: 10, lpAvailable: true, lpStale: false }).order[0]).toBe('LandPortal');
    expect(recommendCompSources({ acres: 10, lpAvailable: true, lpStale: true }).order[0]).toBe('Zillow');
    expect(recommendCompSources({ acres: 10, lpAvailable: false }).order[0]).toBe('Zillow');
  });

  it('always prefers Zillow before Redfin', () => {
    const o = recommendCompSources({ acres: 10 }).order;
    expect(o.indexOf('Zillow')).toBeLessThan(o.indexOf('Redfin'));
  });

  it('<=50 acres prefers Zillow/Redfin and does not lead with land marketplaces', () => {
    const o = recommendCompSources({ acres: 40 }).order;
    expect(o.slice(0, 2)).toEqual(['Zillow', 'Redfin']);
    expect(o).not.toContain('Land.com');
  });

  it('>50 acres / niche adds land marketplaces after Zillow/Redfin', () => {
    const o = recommendCompSources({ acres: 120 }).order;
    expect(o).toEqual(expect.arrayContaining(['Zillow', 'Redfin', 'Land.com', 'LandWatch', 'LandsOfAmerica']));
    expect(o.indexOf('Zillow')).toBeLessThan(o.indexOf('Land.com'));
    expect(recommendCompSources({ acres: 10, niche: true }).order).toContain('LandWatch');
  });
});

describe('evaluateCompRecency', () => {
  it('flags stale LP comps older than 12 months and suggests Zillow then Redfin', () => {
    const r = evaluateCompRecency('2023-01-01', '2026-06-15');
    expect(r.stale).toBe(true);
    expect(r.note).toMatch(/stale/i);
    expect(r.supplement).toEqual(['Zillow', 'Redfin']);
  });

  it('does not flag comps within 12 months', () => {
    const r = evaluateCompRecency('2026-02-01', '2026-06-15');
    expect(r.stale).toBe(false);
    expect(r.supplement).toEqual([]);
  });

  it('treats a missing comp date as needing supplementation', () => {
    expect(evaluateCompRecency(null, '2026-06-15').stale).toBe(true);
  });
});

describe('manual comps', () => {
  function deal() {
    return createDealCard({ entity: 'TY_LAND_BIZ', title: 'Comp deal' }).id;
  }

  it('stores a manual comp with source label, status, and computed price-per-acre', () => {
    const dealId = deal();
    const comp = addComp({
      entity: 'TY_LAND_BIZ', dealCardId: dealId, sourceLabel: 'Zillow',
      sourceUrl: 'https://www.zillow.com/x', addressDesc: '5ac off Rural Rd',
      price: 50000, priceKind: 'sale', saleOrListDate: '2026-03-01', acres: 5, notes: 'good comp',
    });
    expect(comp.source_label).toBe('Zillow');
    expect(comp.status).toBe('manual_unverified'); // never verifies parcel identity
    expect(comp.price_per_acre).toBe(10000);
    expect(comp.added_by).toBeTruthy();
    expect(comp.created_at).toBeGreaterThan(0);
    expect(listComps({ dealCardId: dealId }).length).toBe(1);
  });

  it('can attach a comp to a specific property record', () => {
    const dealId = deal();
    const card = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: '1 Comp Rd, X SC' }).card;
    const comp = addComp({ entity: 'TY_LAND_BIZ', dealCardId: dealId, cardId: card.id, sourceLabel: 'Redfin', price: 30000 });
    expect(comp.card_id).toBe(card.id);
    expect(listComps({ cardId: card.id }).length).toBe(1);
  });

  it('defaults unknown source label to Other and keeps confidence visible', () => {
    const dealId = deal();
    const comp = addComp({ entity: 'TY_LAND_BIZ', dealCardId: dealId, sourceLabel: 'NotAReal' as never, status: 'market_reference' });
    expect(comp.source_label).toBe('Other');
    expect(comp.status).toBe('market_reference');
  });
});
