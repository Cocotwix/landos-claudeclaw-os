import { describe, expect, it } from 'vitest';
import {
  densifyPath,
  distanceToRingBoundaryM,
  gridOverlapPercent,
  interiorGrid,
  measureFrontage,
  overlapLocationDescription,
  pointInRing,
  ringAreaAcres,
  type Ring,
} from './parcel-spatial.js';

// ~100 m x ~100 m square near Beaufort SC latitude (32.35N).
// 0.001 deg lon ≈ 94 m at this latitude; 0.0009 deg lat ≈ 100 m.
const LAT = 32.35;
const LON = -80.55;
const DLAT = 0.0009;
const DLON = 0.001;
const square: Ring = [
  [LON, LAT],
  [LON + DLON, LAT],
  [LON + DLON, LAT + DLAT],
  [LON, LAT + DLAT],
  [LON, LAT],
];

describe('parcel-spatial math', () => {
  it('point-in-ring accepts interior and rejects exterior points', () => {
    expect(pointInRing([LON + DLON / 2, LAT + DLAT / 2], square)).toBe(true);
    expect(pointInRing([LON - DLON, LAT], square)).toBe(false);
  });

  it('shoelace area approximates the true square area in acres', () => {
    const acres = ringAreaAcres(square);
    // ~94m x ~100m = ~9400 m2 = ~2.32 acres; allow projection tolerance.
    expect(acres).toBeGreaterThan(2.0);
    expect(acres).toBeLessThan(2.7);
  });

  it('interior grid stays inside the polygon and scales with n', () => {
    const coarse = interiorGrid([square], 4);
    const fine = interiorGrid([square], 16);
    expect(coarse.length).toBe(16);
    expect(fine.length).toBe(256);
    for (const point of coarse) expect(pointInRing(point, square)).toBe(true);
  });

  it('grid overlap percent measures a half-covering overlay near 50%', () => {
    const rightHalf: Ring = [
      [LON + DLON / 2, LAT],
      [LON + DLON, LAT],
      [LON + DLON, LAT + DLAT],
      [LON + DLON / 2, LAT + DLAT],
      [LON + DLON / 2, LAT],
    ];
    const pct = gridOverlapPercent([square], [[rightHalf]], 48);
    expect(pct).not.toBeNull();
    expect(pct!).toBeGreaterThan(44);
    expect(pct!).toBeLessThan(56);
  });

  it('densify keeps endpoints and shortens segments', () => {
    const path = densifyPath([[LON, LAT], [LON + DLON, LAT]], 5);
    expect(path[0]).toEqual([LON, LAT]);
    expect(path.at(-1)![0]).toBeCloseTo(LON + DLON, 10);
    expect(path.length).toBeGreaterThan(10);
  });

  it('distance to boundary is ~0 on the edge and grows inward', () => {
    const onEdge = distanceToRingBoundaryM([LON + DLON / 2, LAT], [square]);
    const center = distanceToRingBoundaryM([LON + DLON / 2, LAT + DLAT / 2], [square]);
    expect(onEdge).toBeLessThan(1);
    expect(center).toBeGreaterThan(30);
  });

  it('measures frontage for a road running along one parcel edge', () => {
    // Road centerline 10 m south of the southern edge, spanning the full width.
    const off = 10 / 111320; // ~10 m in degrees latitude
    const road = [[[LON - DLON / 2, LAT - off], [LON + DLON * 1.5, LAT - off]] as [number, number][]];
    const m = measureFrontage([square], road, 25);
    // Expect roughly the parcel width (~94 m => ~308 ft) of frontage, allowing threshold bleed at corners.
    expect(m.approximateFrontageFt).toBeGreaterThan(250);
    expect(m.approximateFrontageFt).toBeLessThan(480);
    expect(m.nearestDistanceFt).toBeLessThan(60);
    expect(m.touchesParcel).toBe(false);
  });

  it('reports zero frontage for a distant road but a finite nearest distance', () => {
    const far = 200 / 111320; // ~200 m away
    const road = [[[LON, LAT - far], [LON + DLON, LAT - far]] as [number, number][]];
    const m = measureFrontage([square], road, 25);
    expect(m.approximateFrontageFt).toBe(0);
    expect(m.nearestDistanceFt).toBeGreaterThan(500);
  });

  it('describes overlap location relative to the parcel centroid', () => {
    const northHalf: Ring = [
      [LON, LAT + DLAT / 2],
      [LON + DLON, LAT + DLAT / 2],
      [LON + DLON, LAT + DLAT],
      [LON, LAT + DLAT],
      [LON, LAT + DLAT / 2],
    ];
    const description = overlapLocationDescription([square], [[northHalf]]);
    expect(description).toContain('northern');
  });
});
