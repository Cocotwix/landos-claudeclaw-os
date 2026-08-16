import { describe, it, expect } from 'vitest';
import { currentComparables } from './property-card.js';
import type { LandPortalComparableRecord, PropertyInspectionRecord } from './property-card.js';

// LandPortal publishes its comparables on TWO surfaces — the parcel sidebar and
// the "Show on Map" expansion — captured by different writers, minutes apart.
// Treating the retained record as one generation meant the surface written last
// silently deleted the other from every read: rows only the map published were
// captured, retained, and then filtered out of the comp registry, the research
// lanes, the map and the operator's comparable list.

const row = (
  apn: string,
  surface: string,
  capturedAtIso: string,
  extra: Partial<LandPortalComparableRecord> = {},
): LandPortalComparableRecord => ({
  rawText: `${apn} row`,
  apn,
  address: null,
  acres: 2,
  price: 200_000,
  pricePerAcre: 100_000,
  saleDate: null,
  status: 'unknown',
  confidence: 'low',
  sourceUrl: 'https://landportal.example/parcel',
  surface,
  capturedAtIso,
  ...extra,
} as LandPortalComparableRecord);

const inspection = (
  comparables: LandPortalComparableRecord[],
  comparablesCapturedAt: string | null = null,
): PropertyInspectionRecord => ({
  parcelUrl: 'https://landportal.example/parcel',
  parcelUrlRecord: null,
  threeDCapture: null,
  comparablesUrl: 'https://landportal.example/parcel',
  comparablesCapturedAt,
  parcelFacts: {},
  assets: [],
  overlays: [],
  visualObservations: [],
  comparables,
  sources: [],
  evidence: [],
  discoveryQuestions: [],
  missingInformation: [],
} as unknown as PropertyInspectionRecord);

describe('currentComparables keeps one generation per surface', () => {
  it('does not let a later sidebar write erase an earlier Show-on-Map capture', () => {
    const record = inspection([
      row('A-1', 'both', '2026-08-16T16:56:58.715Z'),
      row('A-2', 'both', '2026-08-16T16:56:58.715Z'),
      row('M-1', 'map', '2026-08-16T16:54:59.658Z'),
      row('M-2', 'map', '2026-08-16T16:54:59.658Z'),
    ], '2026-08-16T16:56:58.715Z');

    const current = currentComparables(record);
    expect(current.map((item) => item.apn).sort()).toEqual(['A-1', 'A-2', 'M-1', 'M-2']);
  });

  it('still supersedes an older generation of the SAME surface', () => {
    const record = inspection([
      row('OLD', 'sidebar', '2026-08-01T00:00:00.000Z'),
      row('NEW', 'sidebar', '2026-08-16T00:00:00.000Z'),
    ]);

    expect(currentComparables(record).map((item) => item.apn)).toEqual(['NEW']);
  });

  it('keeps the newest observation when a re-read moves a parcel between surfaces', () => {
    const record = inspection([
      row('P-1', 'map', '2026-08-01T00:00:00.000Z', { price: 100_000 }),
      row('P-1', 'both', '2026-08-16T00:00:00.000Z', { price: 250_000 }),
    ]);

    const current = currentComparables(record);
    expect(current).toHaveLength(1);
    expect(current[0].price).toBe(250_000);
  });

  it('lets a completed zero-result capture supersede every surface', () => {
    // An empty answer is still an answer: the provider now publishes none.
    const record = inspection([
      row('OLD-SIDEBAR', 'sidebar', '2026-08-01T00:00:00.000Z'),
      row('OLD-MAP', 'map', '2026-08-01T00:00:00.000Z'),
    ], '2026-08-16T00:00:00.000Z');

    expect(currentComparables(record)).toEqual([]);
  });

  it('returns every row when nothing carries a capture stamp', () => {
    const record = inspection([
      row('A', 'sidebar', undefined as unknown as string),
      row('B', 'map', undefined as unknown as string),
    ]);

    expect(currentComparables(record)).toHaveLength(2);
  });

  it('lets a completed generation pin only the surface it wrote', () => {
    // A newer but partially written sidebar capture must not supersede the
    // completed one — and must not reach across to the map surface either.
    const record = inspection([
      row('SIDEBAR-COMPLETE', 'sidebar', '2026-08-16T10:00:00.000Z'),
      row('SIDEBAR-PARTIAL', 'sidebar', '2026-08-16T11:00:00.000Z'),
      row('MAP-ONLY', 'map', '2026-08-16T09:00:00.000Z'),
    ], '2026-08-16T10:00:00.000Z');

    expect(currentComparables(record).map((item) => item.apn).sort())
      .toEqual(['MAP-ONLY', 'SIDEBAR-COMPLETE']);
  });
});
