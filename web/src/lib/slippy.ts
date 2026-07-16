// Dependency-free Web Mercator (slippy map) math for the embedded LandOS comp
// map. Pure functions only — the CompMap component renders OSM raster tiles and
// absolutely-positioned markers from these projections. No paid map API, no
// external script; tiles come from the free OpenStreetMap raster endpoint with
// required attribution shown by the component.

export const TILE_SIZE = 256;

export interface LatLng { lat: number; lng: number }
export interface WorldPoint { x: number; y: number }

/** Longitude → world pixel X at a zoom level. */
export function lngToWorldX(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * TILE_SIZE * Math.pow(2, zoom);
}

/** Latitude → world pixel Y at a zoom level (Web Mercator). */
export function latToWorldY(lat: number, zoom: number): number {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const r = (clamped * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * TILE_SIZE * Math.pow(2, zoom);
}

export function project(point: LatLng, zoom: number): WorldPoint {
  return { x: lngToWorldX(point.lng, zoom), y: latToWorldY(point.lat, zoom) };
}

/** World pixel X → longitude at a zoom level. */
export function worldXToLng(x: number, zoom: number): number {
  return (x / (TILE_SIZE * Math.pow(2, zoom))) * 360 - 180;
}

/** World pixel Y → latitude at a zoom level. */
export function worldYToLat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / (TILE_SIZE * Math.pow(2, zoom));
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export interface TileRef { x: number; y: number; z: number; left: number; top: number }

/** Enumerate the OSM tiles covering a viewport centered on `center`. */
export function tilesForView(center: LatLng, zoom: number, width: number, height: number): TileRef[] {
  const z = Math.round(zoom);
  const c = project(center, z);
  const worldLeft = c.x - width / 2;
  const worldTop = c.y - height / 2;
  const maxTile = Math.pow(2, z);
  const first = { x: Math.floor(worldLeft / TILE_SIZE), y: Math.floor(worldTop / TILE_SIZE) };
  const last = { x: Math.floor((worldLeft + width) / TILE_SIZE), y: Math.floor((worldTop + height) / TILE_SIZE) };
  const tiles: TileRef[] = [];
  for (let ty = first.y; ty <= last.y; ty++) {
    if (ty < 0 || ty >= maxTile) continue;
    for (let tx = first.x; tx <= last.x; tx++) {
      const wrapped = ((tx % maxTile) + maxTile) % maxTile; // wrap longitude
      tiles.push({ x: wrapped, y: ty, z, left: tx * TILE_SIZE - worldLeft, top: ty * TILE_SIZE - worldTop });
    }
  }
  return tiles;
}

/** Pixel offset of a point from the viewport's top-left for a centered view. */
export function pointToScreen(point: LatLng, center: LatLng, zoom: number, width: number, height: number): { left: number; top: number } {
  const z = Math.round(zoom);
  const c = project(center, z);
  const p = project(point, z);
  return { left: p.x - (c.x - width / 2), top: p.y - (c.y - height / 2) };
}

/** Center + zoom that fits every point with padding (like fitBounds). */
export function fitView(points: LatLng[], width: number, height: number, padding = 48): { center: LatLng; zoom: number } {
  const usable = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!usable.length) return { center: { lat: 39.5, lng: -98.35 }, zoom: 4 }; // continental US
  if (usable.length === 1) return { center: usable[0], zoom: 15 };
  const minLat = Math.min(...usable.map((p) => p.lat));
  const maxLat = Math.max(...usable.map((p) => p.lat));
  const minLng = Math.min(...usable.map((p) => p.lng));
  const maxLng = Math.max(...usable.map((p) => p.lng));
  const center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
  for (let z = 18; z >= 2; z--) {
    const w = Math.abs(lngToWorldX(maxLng, z) - lngToWorldX(minLng, z));
    const h = Math.abs(latToWorldY(minLat, z) - latToWorldY(maxLat, z));
    if (w <= width - padding * 2 && h <= height - padding * 2) return { center, zoom: z };
  }
  return { center, zoom: 2 };
}

export interface ClusterInput<T> { lat: number; lng: number; item: T }
export interface Cluster<T> { lat: number; lng: number; items: T[] }

/** Simple screen-space grid clustering (markers within `radiusPx`). */
export function clusterByScreenDistance<T>(
  inputs: ClusterInput<T>[],
  zoom: number,
  radiusPx = 36,
): Cluster<T>[] {
  const clusters: Array<Cluster<T> & { wx: number; wy: number }> = [];
  for (const input of inputs) {
    const wx = lngToWorldX(input.lng, zoom);
    const wy = latToWorldY(input.lat, zoom);
    const hit = clusters.find((c) => Math.hypot(c.wx - wx, c.wy - wy) <= radiusPx);
    if (hit) {
      hit.items.push(input.item);
      // keep the anchor on the first member (stable, no drift)
    } else {
      clusters.push({ lat: input.lat, lng: input.lng, items: [input.item], wx, wy });
    }
  }
  return clusters.map(({ wx: _wx, wy: _wy, ...c }) => c);
}

/** OSM raster tile URL (free; attribution required and shown by the component). */
export function osmTileUrl(t: TileRef): string {
  return `https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png`;
}
