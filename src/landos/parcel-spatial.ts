// Planar spatial math for parcel screening, in WGS84 lon/lat with a local
// meters projection. These helpers are the local fallback when a county
// geometry service is unavailable; exact geodesic math from an official
// geometry service always outranks these approximations.

export type LonLat = [number, number];
export type Ring = LonLat[];
export type Rings = Ring[];

const EARTH_RADIUS_M = 6371000;
const SQM_PER_ACRE = 4046.8564224;

/** Local equirectangular projection to meters around a reference latitude. */
export function toMeters(point: LonLat, refLat: number): [number, number] {
  const rad = Math.PI / 180;
  return [point[0] * rad * Math.cos(refLat * rad) * EARTH_RADIUS_M, point[1] * rad * EARTH_RADIUS_M];
}

export function ringCentroid(ring: Ring): LonLat {
  const pts = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
  const sum = pts.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
  return [sum[0] / pts.length, sum[1] / pts.length];
}

export function pointInRing([x, y]: LonLat, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / ((yj - yi) || Number.EPSILON) + xi) inside = !inside;
  }
  return inside;
}

export function pointInRings(point: LonLat, rings: Rings): boolean {
  return rings.some((ring) => pointInRing(point, ring));
}

/** Shoelace area of one ring in acres via local meters projection. */
export function ringAreaAcres(ring: Ring): number {
  if (ring.length < 3) return 0;
  const refLat = ringCentroid(ring)[1];
  const pts = ring.map((p) => toMeters(p, refLat));
  let sum = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    sum += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  }
  return Math.abs(sum / 2) / SQM_PER_ACRE;
}

export function ringsAreaAcres(rings: Rings): number {
  // Largest ring is the shell; holes are ignored at screening precision.
  return rings.reduce((max, ring) => Math.max(max, ringAreaAcres(ring)), 0);
}

/** Evenly spaced interior grid points; grid is n x n over the bbox, filtered to the polygon. */
export function interiorGrid(rings: Rings, n: number): LonLat[] {
  const shell = rings[0] ?? [];
  if (!shell.length) return [];
  const xs = shell.map((p) => p[0]);
  const ys = shell.map((p) => p[1]);
  const [xmin, xmax, ymin, ymax] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const out: LonLat[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const point: LonLat = [xmin + (i + 0.5) / n * (xmax - xmin), ymin + (j + 0.5) / n * (ymax - ymin)];
      if (pointInRings(point, rings)) out.push(point);
    }
  }
  return out;
}

/** Overlap of subject rings with overlay rings as a percent of subject area, via dense grid sampling. */
export function gridOverlapPercent(subject: Rings, overlays: Rings[], gridN = 48): number | null {
  const points = interiorGrid(subject, gridN);
  if (!points.length) return null;
  const hit = points.filter((point) => overlays.some((rings) => pointInRings(point, rings))).length;
  return Math.round(hit / points.length * 10_000) / 100;
}

function distPointToSegmentM(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  const cx = a[0] + t * dx;
  const cy = a[1] + t * dy;
  return Math.hypot(p[0] - cx, p[1] - cy);
}

/** Minimum distance in meters from a point to a polygon boundary. */
export function distanceToRingBoundaryM(point: LonLat, rings: Rings): number {
  const refLat = point[1];
  const pm = toMeters(point, refLat);
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i + 1 < ring.length; i += 1) {
      best = Math.min(best, distPointToSegmentM(pm, toMeters(ring[i], refLat), toMeters(ring[i + 1], refLat)));
    }
  }
  return best;
}

/** Densify a polyline so no segment exceeds stepM meters. */
export function densifyPath(path: LonLat[], stepM: number): LonLat[] {
  if (path.length < 2) return path.slice();
  const refLat = path[0][1];
  const out: LonLat[] = [path[0]];
  for (let i = 0; i + 1 < path.length; i += 1) {
    const a = toMeters(path[i], refLat);
    const b = toMeters(path[i + 1], refLat);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(len / stepM));
    for (let s = 1; s <= steps; s += 1) {
      out.push([
        path[i][0] + (path[i + 1][0] - path[i][0]) * s / steps,
        path[i][1] + (path[i + 1][1] - path[i][1]) * s / steps,
      ]);
    }
  }
  return out;
}

export interface FrontageMeasurement {
  /** Feet of road centerline running within contactThresholdM of the parcel boundary. */
  approximateFrontageFt: number;
  /** Nearest distance in feet from the road centerline to the parcel boundary. */
  nearestDistanceFt: number;
  /** True when the centerline touches or crosses the parcel polygon itself. */
  touchesParcel: boolean;
}

/**
 * Measure apparent frontage: the length of road centerline that stays within
 * `contactThresholdM` of the parcel boundary (default 25 m covers a typical
 * centerline-to-parcel-line offset across a rural right of way).
 */
export function measureFrontage(parcel: Rings, roadPaths: LonLat[][], contactThresholdM = 25): FrontageMeasurement {
  let frontageM = 0;
  let nearestM = Infinity;
  let touches = false;
  for (const path of roadPaths) {
    const dense = densifyPath(path, 5);
    for (let i = 0; i + 1 < dense.length; i += 1) {
      const mid: LonLat = [(dense[i][0] + dense[i + 1][0]) / 2, (dense[i][1] + dense[i + 1][1]) / 2];
      const inParcel = pointInRings(mid, parcel);
      const dist = inParcel ? 0 : distanceToRingBoundaryM(mid, parcel);
      nearestM = Math.min(nearestM, dist);
      if (inParcel) touches = true;
      if (dist <= contactThresholdM) {
        const refLat = mid[1];
        const a = toMeters(dense[i], refLat);
        const b = toMeters(dense[i + 1], refLat);
        frontageM += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
    }
  }
  return {
    approximateFrontageFt: Math.round(frontageM * 3.28084),
    nearestDistanceFt: Number.isFinite(nearestM) ? Math.round(nearestM * 3.28084) : Number.NaN,
    touchesParcel: touches,
  };
}

/** Compass description of where overlay sample hits sit relative to the parcel centroid. */
export function overlapLocationDescription(subject: Rings, overlays: Rings[], gridN = 32): string | null {
  const points = interiorGrid(subject, gridN);
  const hits = points.filter((point) => overlays.some((rings) => pointInRings(point, rings)));
  if (!hits.length) return null;
  const [cx, cy] = ringCentroid(subject[0] ?? []);
  let north = 0, south = 0, east = 0, west = 0;
  for (const [x, y] of hits) {
    if (y > cy) north += 1; else south += 1;
    if (x > cx) east += 1; else west += 1;
  }
  const ns = north === south ? '' : north > south ? 'northern' : 'southern';
  const ew = east === west ? '' : east > west ? 'eastern' : 'western';
  const parts = [ns, ew].filter(Boolean);
  if (!parts.length) return 'spread across the parcel';
  if (hits.length >= points.length * 0.85) return 'across most of the parcel';
  return `concentrated on the ${parts.join(' and ')} portion`;
}
