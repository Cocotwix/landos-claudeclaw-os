// LandPortal exposes comparable rows on TWO surfaces:
//   1. the parcel sidebar block (full APNs, no street addresses)
//   2. the expanded "Show on Map" results (street addresses, page's own status)
//
// The workflow must read both, merge them on the strongest available identifier,
// keep the richer field per property, record provenance, and never count one
// property twice. Truncated APNs are never a dedupe key.

import { describe, expect, it } from 'vitest';
import { mergeLandPortalSurfaces, parseComparableCandidate } from './landportal-browser.js';
import type { LandPortalComparableRecord } from './property-card.js';

const PARCEL_URL = 'https://landportal.com/?property=abc';
/** The live capture joins "<section label>" and "<row text>" with this delimiter. */
const SECTION = '';

function row(overrides: Partial<LandPortalComparableRecord>): LandPortalComparableRecord {
  return {
    rawText: 'row', sourceUrl: PARCEL_URL, apn: null, address: null, acres: null, price: null,
    pricePerAcre: null, distanceMiles: null, status: 'unknown', saleListIndicator: 'unknown',
    improvement: 'unknown', confidence: 'medium', ...overrides,
  };
}

describe('parseComparableCandidate — surfaces and page-supplied status', () => {
  it('stamps the surface it was read from', () => {
    const sidebar = parseComparableCandidate('$153,500 Acres: 13.10 | APN: 115 02100', PARCEL_URL, 'sidebar')!;
    const map = parseComparableCandidate('$153,500 Acres: 13.10 | APN: 115 02100', PARCEL_URL, 'map')!;
    expect(sidebar.surface).toBe('sidebar');
    expect(map.surface).toBe('map');
  });

  it('keeps a full APN containing spaces', () => {
    const parsed = parseComparableCandidate('$153,500 Acres: 13.10 | APN: 115 02100', PARCEL_URL)!;
    expect(parsed.apn).toBe('115 02100');
  });

  it('leaves status unknown when neither the row nor its section says', () => {
    const parsed = parseComparableCandidate('$153,500 Acres: 13.10 | APN: 115 02100', PARCEL_URL)!;
    expect(parsed.status).toBe('unknown');
    expect(parsed.saleListIndicator).toBe('unknown');
  });

  it('reads sold status from the page section heading', () => {
    const parsed = parseComparableCandidate('Recent Comparable Sales$153,500 Acres: 13.10 | APN: 115 02100', PARCEL_URL, 'map')!;
    expect(parsed.status).toBe('sold');
    expect(parsed.saleListIndicator).toBe('sale');
  });

  it('reads active status from the page section heading', () => {
    const parsed = parseComparableCandidate('Active Listings Nearby$99,000 Acres: 8.00 | APN: 115 02101', PARCEL_URL, 'map')!;
    expect(parsed.status).toBe('active');
    expect(parsed.saleListIndicator).toBe('list');
  });

  it('captures the result link the map surface appends', () => {
    const parsed = parseComparableCandidate('$84,500 Acres: 9.61 | APN: 071 03100 | URL: https://landportal.com/p/9', PARCEL_URL, 'map')!;
    expect(parsed.sourceUrl).toBe('https://landportal.com/p/9');
    expect(parsed.rawText).not.toMatch(/URL:/);
  });
});

describe('mergeLandPortalSurfaces', () => {
  it('merges the same parcel from both surfaces into one record', () => {
    const merged = mergeLandPortalSurfaces(
      [row({ apn: '115 02100', price: 153_500, acres: 13.1, pricePerAcre: 11_718, surface: 'sidebar' })],
      [row({ apn: '115 02100', address: '120 Old Ridge Rd, Kingston, TN 37763', status: 'sold', saleListIndicator: 'sale', saleDate: '2025-04-02', surface: 'map' })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].surface).toBe('both');
    // Richer field per property: the map supplies the address and status, the
    // sidebar supplies the full APN and the priced figures.
    expect(merged[0].address).toBe('120 Old Ridge Rd, Kingston, TN 37763');
    expect(merged[0].apn).toBe('115 02100');
    expect(merged[0].price).toBe(153_500);
    expect(merged[0].status).toBe('sold');
    expect(merged[0].saleDate).toBe('2025-04-02');
  });

  // The map surface is opened and read precisely BECAUSE it publishes the
  // detail the sidebar does not: coordinates, locality, the comp's own
  // LandPortal identity and its detail page. Merging only price/status/address
  // discarded every one of those for exactly the rows both surfaces agreed on.
  it('keeps the detail fields only the Show on Map surface publishes', () => {
    const merged = mergeLandPortalSurfaces(
      [row({ apn: '115 02100', price: 153_500, acres: 13.1, surface: 'sidebar' })],
      [row({
        apn: '115 02100', address: '120 Old Ridge Rd, Kingston, TN 37763', status: 'sold',
        lat: 35.8721, lng: -84.5088, city: 'Kingston', county: 'Roane', state: 'TN',
        landPortalPropertyId: '172954755', fips: '47145', mlsPropertyId: 'MLS-88',
        detailUrl: 'https://landportal.com/p/9', parcelAcres: 13.1, buildingSqft: 0,
        improvementValue: 0, useDescription: 'Vacant residential land',
        landMarketValue: 150_000, totalMarketValue: 150_000, surface: 'map',
      })],
    );
    expect(merged).toHaveLength(1);
    const only = merged[0];
    expect(only.surface).toBe('both');
    expect(only.lat).toBe(35.8721);
    expect(only.lng).toBe(-84.5088);
    expect(only.city).toBe('Kingston');
    expect(only.county).toBe('Roane');
    expect(only.state).toBe('TN');
    expect(only.landPortalPropertyId).toBe('172954755');
    expect(only.fips).toBe('47145');
    expect(only.mlsPropertyId).toBe('MLS-88');
    expect(only.detailUrl).toBe('https://landportal.com/p/9');
    expect(only.useDescription).toBe('Vacant residential land');
    expect(only.landMarketValue).toBe(150_000);
    // The sidebar's own priced pair still governs; enrichment never overwrites.
    expect(only.price).toBe(153_500);
    expect(only.acres).toBe(13.1);
  });

  it('never lets the map surface overwrite a value the sidebar already established', () => {
    const merged = mergeLandPortalSurfaces(
      [row({ apn: '115 02100', price: 153_500, acres: 13.1, county: 'Roane', state: 'TN', lat: 35.1, lng: -84.1 })],
      [row({ apn: '115 02100', county: 'Knox', state: 'KY', lat: 99, lng: 99 })],
    );
    expect(merged[0].county).toBe('Roane');
    expect(merged[0].state).toBe('TN');
    expect(merged[0].lat).toBe(35.1);
    expect(merged[0].lng).toBe(-84.1);
  });

  it('treats an acreage conflict seen on either surface as a conflict', () => {
    const merged = mergeLandPortalSurfaces(
      [row({ apn: '115 02100', price: 1, acres: 17.75 })],
      [row({ apn: '115 02100', acreageConflict: true, parcelAcres: 574 })],
    );
    expect(merged[0].acreageConflict).toBe(true);
    expect(merged[0].parcelAcres).toBe(574);
  });

  it('matches across surfaces even when APN spacing differs', () => {
    const merged = mergeLandPortalSurfaces(
      [row({ apn: '115 02100', price: 153_500, acres: 13.1 })],
      [row({ apn: '11502100', address: '120 Old Ridge Rd', status: 'sold' })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].surface).toBe('both');
  });

  it('matches on street address when the map row carries no APN', () => {
    const merged = mergeLandPortalSurfaces(
      [row({ address: '120 Old Ridge Rd', price: 153_500, acres: 13.1 })],
      [row({ address: '120 OLD RIDGE RD', status: 'sold', saleDate: '2025-04-02' })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe('sold');
  });

  it('matches on price + acreage + date when neither APN nor address is available', () => {
    const merged = mergeLandPortalSurfaces(
      [row({ price: 84_500, acres: 9.61, saleDate: '2025-03-01' })],
      [row({ price: 84_500, acres: 9.61, saleDate: '2025-03-01', address: '9 Ridge Rd', status: 'sold' })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].address).toBe('9 Ridge Rd');
  });

  it('never dedupes on a truncated APN', () => {
    // "115" is the truncation bug's output. Two different parcels share it, so
    // it must never collapse them.
    const merged = mergeLandPortalSurfaces(
      [row({ apn: '115 02100', price: 153_500, acres: 13.1 })],
      [row({ apn: '115 09999', price: 60_000, acres: 4, address: '9 Other Rd' })],
    );
    expect(merged).toHaveLength(2);
  });

  it('keeps a genuinely different map property as its own record', () => {
    const merged = mergeLandPortalSurfaces(
      [row({ apn: '115 02100', price: 153_500, acres: 13.1 })],
      [row({ apn: '071 03100', price: 84_500, acres: 9.61, address: '9 Ridge Rd' })],
    );
    expect(merged).toHaveLength(2);
    expect(merged.map((r) => r.surface)).toEqual(['sidebar', 'map']);
  });

  it('never lets a stated value lose to an unknown one', () => {
    const merged = mergeLandPortalSurfaces(
      [row({ apn: '115 02100', status: 'sold', improvement: 'vacant', price: 153_500, acres: 13.1 })],
      [row({ apn: '115 02100', status: 'unknown', improvement: 'unknown' })],
    );
    expect(merged[0].status).toBe('sold');
    expect(merged[0].improvement).toBe('vacant');
  });

  it('returns the sidebar set unchanged when the map surface is empty', () => {
    const merged = mergeLandPortalSurfaces([row({ apn: '115 02100', price: 1, acres: 1 })], []);
    expect(merged).toHaveLength(1);
    expect(merged[0].surface).toBe('sidebar');
  });

  it('returns map-only rows when the sidebar block is empty', () => {
    const merged = mergeLandPortalSurfaces([], [row({ apn: '115 02100', address: '1 A Rd' })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].surface).toBe('map');
  });
});
