import { describe, it, expect } from 'vitest';
import { buildCompMapView, type CoordsLookup } from './comp-map.js';
import { buildCompRegistry } from './comp-registry.js';

const subject = { address: '200 Sid Edens Rd, Pickens, SC', apn: '5105-00-44-0497', acres: 1.15, lat: 34.9942, lng: -82.6561 };
const subjectMarket = { state: 'SC', county: 'Pickens', acres: 1.15 };

const cand = (over: Record<string, unknown>) => ({
  provider: 'Zillow', lane: 'sold' as const, addressDesc: '1 Ridge Rd, Pickens, SC', state: 'SC',
  price: 60_000, priceKind: 'sold', saleOrListDate: '2026-02-01', acres: 1.2,
  sourceUrl: 'https://zillow.example/1', ...over,
});

const coordsFor = (m: Record<string, { lat: number; lng: number }>): CoordsLookup => ({
  get: (a) => m[(a ?? '').replace(/\s+/g, ' ').trim().toLowerCase()] ?? null,
});

describe('buildCompMapView', () => {
  it('assembles subject + sold/active markers with labeled PPA, providers, and links', () => {
    const registry = buildCompRegistry(subjectMarket, [
      cand({}),
      cand({ addressDesc: '2 Ridge Rd, Pickens, SC', lane: 'active', priceKind: 'list', price: 80_000, acres: 1.0, sourceUrl: 'https://redfin.example/2', provider: 'Redfin' }),
    ]);
    const view = buildCompMapView({
      subject, registry,
      coords: coordsFor({ '1 ridge rd, pickens, sc': { lat: 34.99, lng: -82.65 } }),
    });
    const sold = view.markers.find((m) => m.status === 'sold')!;
    expect(sold.ppa?.label).toBe('Sold PPA');
    expect(sold.providers).toContain('Zillow');
    expect(sold.providerLinks[0]).toContain('zillow.example');
    expect(sold.lat).toBeCloseTo(34.99, 2);
    expect(sold.distanceMiles).toBeGreaterThan(0);
    const active = view.markers.find((m) => m.status === 'active')!;
    expect(active.ppa?.label).toBe('Asking PPA');
    expect(active.lat).toBeNull(); // no coords → table only, never fabricated
    expect(view.counts.plottable).toBe(1);
    expect(view.counts.tableOnly).toBe(view.markers.length - 1);
    expect(view.mapKind).toBe('landos_final_deduplicated_registry');
  });

  it('marks the selected top comps and keeps non-selected reasons visible', () => {
    const candidates = Array.from({ length: 7 }, (_, i) => cand({
      addressDesc: `${i + 1} Ridge Rd, Pickens, SC`,
      acres: 1.0 + i * 0.1,
      price: 50_000 + i * 1_000,
      sourceUrl: `https://zillow.example/${i + 1}`,
    }));
    const registry = buildCompRegistry(subjectMarket, candidates);
    const view = buildCompMapView({ subject, registry, coords: coordsFor({}) });
    const selected = view.markers.filter((m) => m.selected);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.length).toBeLessThanOrEqual(5);
    expect(selected.every((m) => m.selectionScore != null && m.why.length > 3)).toBe(true);
    const notSelected = view.markers.filter((m) => m.status === 'sold' && !m.selected);
    expect(notSelected.every((m) => m.why.length > 3)).toBe(true); // exclusion reason visible
    expect(view.selection.selectedCount).toBe(selected.length);
  });

  it('keeps rejected candidates visible as rejected markers with the exact reason', () => {
    const registry = buildCompRegistry(subjectMarket, [
      cand({}),
      cand({ addressDesc: '9 Far Ln, Austin, TX', state: 'TX', sourceUrl: 'https://z.example/tx' }),
    ]);
    const view = buildCompMapView({ subject, registry, coords: coordsFor({}) });
    const rejected = view.markers.filter((m) => m.status === 'rejected');
    expect(rejected.length).toBe(1);
    expect(rejected[0].why.length).toBeGreaterThan(5);
    expect(rejected[0].lat).toBeNull(); // rejected evidence is never plotted as usable
  });

  it('a duplicate across providers counts once with both providers attached', () => {
    const registry = buildCompRegistry(subjectMarket, [
      cand({}),
      cand({ provider: 'Redfin', sourceUrl: 'https://redfin.example/1' }),
    ]);
    const view = buildCompMapView({ subject, registry, coords: coordsFor({}) });
    const sold = view.markers.filter((m) => m.status === 'sold');
    expect(sold.length).toBe(1);
    expect(sold[0].providers).toEqual(expect.arrayContaining(['Zillow', 'Redfin']));
    expect(view.counts.duplicatesMerged).toBeGreaterThan(0);
  });

  it('shows OSM attribution and a refresh date', () => {
    const view = buildCompMapView({ subject, registry: buildCompRegistry(subjectMarket, []), coords: coordsFor({}), now: () => new Date('2026-07-14T12:00:00Z') });
    expect(view.attribution).toMatch(/OpenStreetMap/);
    expect(view.refreshDateIso).toBe('2026-07-14T12:00:00.000Z');
  });
});
