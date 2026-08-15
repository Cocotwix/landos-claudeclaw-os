import { describe, it, expect } from 'vitest';
import { buildCompMapView } from './comp-map.js';
import { buildCompRegistry } from './comp-registry.js';
import { buildRetainedLocationIndex, type RetainedLocationIndex } from './comp-location-reconciliation.js';

const subject = { address: '200 Sid Edens Rd, Pickens, SC', apn: '5105-00-44-0497', acres: 1.15, lat: 34.9942, lng: -82.6561 };
const subjectMarket = { state: 'SC', county: 'Pickens', acres: 1.15 };

const cand = (over: Record<string, unknown>) => ({
  provider: 'Zillow', lane: 'sold' as const, addressDesc: '1 Ridge Rd, Pickens, SC', state: 'SC',
  price: 60_000, priceKind: 'sold', saleOrListDate: '2026-02-01', acres: 1.2,
  sourceUrl: 'https://zillow.example/1', ...over,
});

const coordsFor = (m: Record<string, { lat: number; lng: number }>): RetainedLocationIndex =>
  buildRetainedLocationIndex(Object.entries(m).map(([address, point]) => ({
    address, lat: point.lat, lng: point.lng, source: 'retained comp record',
  })));

describe('buildCompMapView', () => {
  it('assembles subject + sold/active markers with labeled PPA, providers, and links', () => {
    const registry = buildCompRegistry(subjectMarket, [
      cand({ thumbnailUrl: 'https://images.example/1.jpg' }),
      cand({ addressDesc: '2 Ridge Rd, Pickens, SC', lane: 'active', priceKind: 'list', price: 80_000, acres: 1.0, sourceUrl: 'https://redfin.example/2', provider: 'Redfin' }),
    ]);
    const view = buildCompMapView({
      subject, registry,
      locations: coordsFor({ '1 ridge rd, pickens, sc': { lat: 34.99, lng: -82.65 } }),
    });
    const sold = view.markers.find((m) => m.status === 'sold')!;
    expect(sold.ppa?.label).toBe('Sold PPA');
    expect(sold.providers).toContain('Zillow');
    expect(sold.providerLinks[0]).toContain('zillow.example');
    expect(sold.thumbnailUrl).toBe('https://images.example/1.jpg');
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
      distanceMiles: 1 + i * 0.5,
      saleOrListDate: '2026-02-01',
    }));
    const registry = buildCompRegistry(subjectMarket, candidates);
    const locations = coordsFor({ '1 ridge rd, pickens, sc': { lat: 34.99, lng: -82.65 } });
    const view = buildCompMapView({ subject, registry, locations });
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
    const view = buildCompMapView({ subject, registry, locations: coordsFor({}) });
    const rejected = view.markers.filter((m) => m.status === 'rejected');
    expect(rejected.length).toBe(1);
    expect(rejected[0].why.length).toBeGreaterThan(5);
    expect(rejected[0].lat).toBeNull(); // rejected evidence is never plotted as usable
  });

  it('reports plotted and table-only counts for sold/active land, not hidden strategy context', () => {
    const registry = buildCompRegistry(subjectMarket, [
      cand({}),
      cand({ addressDesc: '8 House Rd, Pickens, SC', compClass: 'residential', sourceUrl: 'https://zillow.example/house' }),
    ]);
    const view = buildCompMapView({
      subject,
      registry,
      locations: coordsFor({
        '1 ridge rd, pickens, sc': { lat: 34.99, lng: -82.65 },
        '8 house rd, pickens, sc': { lat: 34.98, lng: -82.64 },
      }),
    });
    expect(view.counts.context).toBe(1);
    expect(view.counts.plottable).toBe(1);
    expect(view.counts.tableOnly).toBe(0);
    // The strategy-context record still has a retained location, so the retained
    // reconciliation counts it as mapped even though the sold/active land count
    // deliberately does not.
    expect(view.counts.retained).toBe(2);
    expect(view.counts.mapped).toBe(2);
    expect(view.counts.unresolved).toBe(0);
    expect(view.summaryLine).toMatch(/2 shown on the map/);
  });

  it('a duplicate across providers counts once with both providers attached', () => {
    const registry = buildCompRegistry(subjectMarket, [
      cand({}),
      cand({ provider: 'Redfin', sourceUrl: 'https://redfin.example/1' }),
    ]);
    const view = buildCompMapView({ subject, registry, locations: coordsFor({}) });
    const sold = view.markers.filter((m) => m.status === 'sold');
    expect(sold.length).toBe(1);
    expect(sold[0].providers).toEqual(expect.arrayContaining(['Zillow', 'Redfin']));
    expect(view.counts.duplicatesMerged).toBeGreaterThan(0);
  });

  // ── Retained-comp location reconciliation ────────────────────────────────

  it('maps a comp identified only by APN from the location evidence LandOS already retains', () => {
    const registry = buildCompRegistry(subjectMarket, [
      cand({ addressDesc: null, apn: '5105-00-44-0497', sourceUrl: 'https://landportal.example/1' }),
    ]);
    const view = buildCompMapView({
      subject,
      registry,
      // A retained persisted row for the SAME parcel carries the point. The old
      // address-keyed join could never reach it, so the comp fell off the map.
      locations: buildRetainedLocationIndex([
        { apn: '5105-00-44-0497', state: 'SC', lat: 34.99, lng: -82.65, source: 'LandPortal map point' },
      ]),
    });
    const marker = view.markers.find((m) => m.apn === '5105-00-44-0497')!;
    expect(marker.locationStatus).toBe('mapped');
    expect(marker.lat).toBeCloseTo(34.99, 2);
    expect(marker.locationEvidence).toContain('APN 5105-00-44-0497');
    expect(marker.locationEvidence).toContain('LandPortal map point');
    expect(marker.locationUnresolvedReason).toBeNull();
    expect(view.counts.mapped).toBe(1);
    expect(view.counts.unresolved).toBe(0);
  });

  it('leaves a comp with no location evidence unresolved AND says why', () => {
    const registry = buildCompRegistry(subjectMarket, [
      cand({ addressDesc: null, apn: '5105-00-44-0497', sourceUrl: 'https://landportal.example/1' }),
    ]);
    const view = buildCompMapView({ subject, registry, locations: coordsFor({}) });
    const marker = view.markers.find((m) => m.apn === '5105-00-44-0497')!;
    expect(marker.locationStatus).toBe('unresolved');
    expect(marker.lat).toBeNull();
    expect(marker.lng).toBeNull();
    expect(marker.locationEvidence).toBeNull();
    expect(marker.locationUnresolvedReason).toContain('5105-00-44-0497');
    expect(marker.locationUnresolvedReason).toMatch(/identity, not a location/i);
  });

  it('reconciles retained, mapped, and unresolved counts over every retained record', () => {
    const registry = buildCompRegistry(subjectMarket, [
      cand({}),
      cand({ addressDesc: '2 Ridge Rd, Pickens, SC', sourceUrl: 'https://zillow.example/2' }),
      cand({ addressDesc: null, apn: '5105-00-44-0497', sourceUrl: 'https://landportal.example/3' }),
    ]);
    const view = buildCompMapView({
      subject, registry,
      locations: coordsFor({ '1 ridge rd, pickens, sc': { lat: 34.99, lng: -82.65 } }),
    });
    const retained = view.markers.filter((m) => m.status !== 'rejected');
    expect(view.counts.retained).toBe(retained.length);
    expect(view.counts.mapped + view.counts.unresolved).toBe(view.counts.retained);
    expect(view.counts.mapped).toBe(1);
    // Every unresolved retained record explains itself; none is a silent blank.
    expect(retained.filter((m) => m.locationStatus === 'unresolved')
      .every((m) => (m.locationUnresolvedReason ?? '').length > 20)).toBe(true);
    expect(view.summaryLine).toMatch(/3 retained comparable records, 1 shown on the map and 2 explicitly unresolved/);
  });

  it('never carries another state’s parcel point onto a comp sharing APN digits', () => {
    const registry = buildCompRegistry(subjectMarket, [
      cand({ addressDesc: null, apn: '5105-00-44-0497', sourceUrl: 'https://landportal.example/1' }),
    ]);
    const view = buildCompMapView({
      subject, registry,
      locations: buildRetainedLocationIndex([
        { apn: '5105-00-44-0497', state: 'TX', lat: 30.2, lng: -97.7, source: 'Other roll map point' },
      ]),
    });
    const marker = view.markers.find((m) => m.apn === '5105-00-44-0497')!;
    expect(marker.locationStatus).toBe('unresolved');
    expect(marker.lat).toBeNull();
  });

  it('shows OSM attribution and a refresh date', () => {
    const view = buildCompMapView({ subject, registry: buildCompRegistry(subjectMarket, []), locations: coordsFor({}), now: () => new Date('2026-07-14T12:00:00Z') });
    expect(view.attribution).toMatch(/OpenStreetMap/);
    expect(view.refreshDateIso).toBe('2026-07-14T12:00:00.000Z');
  });

  it('retains an optional official subject polygon without inventing one', () => {
    const polygon = [{ lat: 34.99, lng: -82.66 }, { lat: 35.0, lng: -82.66 }, { lat: 35.0, lng: -82.65 }];
    const withPolygon = buildCompMapView({ subject: { ...subject, polygon }, registry: buildCompRegistry(subjectMarket, []), locations: coordsFor({}) });
    const withoutPolygon = buildCompMapView({ subject, registry: buildCompRegistry(subjectMarket, []), locations: coordsFor({}) });
    expect(withPolygon.subject.polygon).toEqual(polygon);
    expect(withoutPolygon.subject.polygon).toBeUndefined();
  });
});
