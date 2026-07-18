// Parcel overlay visuals: self-contained SVG evidence maps built from the
// OFFICIAL parcel geometry plus official map services (county aerial, county
// wetlands/flood/zoning layers, USDA soils WMS). The server fetches every
// raster, embeds it as a data URI, and draws the exact parcel boundary on
// top — so every visual is tied to the verified parcel, never a nearby
// lookalike. Rendered SVGs are cached on disk per card + kind.

import fs from 'node:fs';
import path from 'node:path';
import { findCountyGis, type CountyGisCapability } from './county-gis-capabilities.js';
import type { Rings } from './parcel-spatial.js';
import { landosArtifactPath } from './storage-profile.js';

export const PARCEL_OVERLAY_KINDS = ['aerial', 'wetlands', 'flood', 'zoning', 'flu', 'soils', 'roads'] as const;
export type ParcelOverlayKind = (typeof PARCEL_OVERLAY_KINDS)[number];

export const PARCEL_OVERLAY_LABELS: Record<ParcelOverlayKind, string> = {
  aerial: 'Aerial imagery with parcel boundary',
  wetlands: 'Wetlands overlay',
  flood: 'FEMA flood overlay',
  zoning: 'Zoning overlay',
  flu: 'Future land use overlay',
  soils: 'Soil map units overlay',
  roads: 'Roads and frontage',
};

const SIZE = 1000;

export interface OverlayBuildInput {
  county: string | undefined;
  state: string | undefined;
  rings: Rings;
  kind: ParcelOverlayKind;
  title: string;
  subtitle: string;
  timeoutMs?: number;
}

interface Bounds { xmin: number; ymin: number; xmax: number; ymax: number }

function squareBounds(rings: Rings, padRatio: number): Bounds {
  const shell = rings[0] ?? [];
  const xs = shell.map((p) => p[0]);
  const ys = shell.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const latRad = cy * Math.PI / 180;
  // Half-extent in degrees, corrected so the box is square in meters.
  const halfLat = Math.max((Math.max(...ys) - Math.min(...ys)) / 2, (Math.max(...xs) - Math.min(...xs)) / 2 * Math.cos(latRad)) * (1 + padRatio);
  const halfLon = halfLat / Math.cos(latRad);
  return { xmin: cx - halfLon, ymin: cy - halfLat, xmax: cx + halfLon, ymax: cy + halfLat };
}

function toPixels(bounds: Bounds, [lon, lat]: [number, number]): [number, number] {
  return [
    (lon - bounds.xmin) / (bounds.xmax - bounds.xmin) * SIZE,
    SIZE - (lat - bounds.ymin) / (bounds.ymax - bounds.ymin) * SIZE,
  ];
}

async function fetchAsDataUri(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const type = response.headers.get('content-type') ?? 'image/png';
    if (!/image\//.test(type)) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 500) return null;
    return `data:${type.split(';')[0]};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function mapServerExport(layerBase: string, bounds: Bounds, transparent: boolean): string {
  // layerBase looks like .../ServiceName/MapServer/<layerId>
  const match = /^(.*\/MapServer)\/(\d+)$/.exec(layerBase);
  const server = match ? match[1] : layerBase;
  const layerId = match ? match[2] : '0';
  const params = new URLSearchParams({
    f: 'image',
    bbox: `${bounds.xmin},${bounds.ymin},${bounds.xmax},${bounds.ymax}`,
    bboxSR: '4326',
    imageSR: '4326',
    size: `${SIZE},${SIZE}`,
    format: 'png32',
    transparent: transparent ? 'true' : 'false',
    layers: `show:${layerId}`,
  });
  return `${server}/export?${params}`;
}

function imageServerExport(imageBase: string, bounds: Bounds): string {
  const params = new URLSearchParams({
    f: 'image',
    bbox: `${bounds.xmin},${bounds.ymin},${bounds.xmax},${bounds.ymax}`,
    bboxSR: '4326',
    imageSR: '4326',
    size: `${SIZE},${SIZE}`,
    format: 'png32',
  });
  return `${imageBase}/exportImage?${params}`;
}

function soilsWms(bounds: Bounds): string {
  const params = new URLSearchParams({
    SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetMap',
    LAYERS: 'mapunitpoly', STYLES: '',
    SRS: 'EPSG:4326',
    BBOX: `${bounds.xmin},${bounds.ymin},${bounds.xmax},${bounds.ymax}`,
    WIDTH: String(SIZE), HEIGHT: String(SIZE),
    FORMAT: 'image/png', TRANSPARENT: 'TRUE',
  });
  return `https://SDMDataAccess.sc.egov.usda.gov/Spatial/SDM.wms?${params}`;
}

function overlaySource(kind: ParcelOverlayKind, capability: CountyGisCapability, bounds: Bounds): string | null {
  switch (kind) {
    case 'wetlands': return capability.layers.wetlands ? mapServerExport(capability.layers.wetlands, bounds, true) : null;
    case 'flood': return capability.layers.floodZones ? mapServerExport(capability.layers.floodZones, bounds, true) : null;
    case 'zoning': return capability.layers.zoning ? mapServerExport(capability.layers.zoning, bounds, true) : null;
    case 'flu': return capability.layers.futureLandUse ? mapServerExport(capability.layers.futureLandUse, bounds, true) : null;
    case 'soils': return soilsWms(bounds);
    case 'roads': return capability.layers.roads ? mapServerExport(capability.layers.roads, bounds, true) : null;
    default: return null;
  }
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]!));
}

/**
 * Build a self-contained SVG: official aerial base + optional thematic overlay
 * + the exact parcel boundary + caption. Returns null when the base imagery
 * cannot be retrieved (never renders an overlay that lost its base).
 */
export async function buildParcelOverlaySvg(input: OverlayBuildInput): Promise<string | null> {
  const capability = findCountyGis(input.county, input.state);
  if (!capability?.layers.aerialImage) return null;
  const pad = input.kind === 'roads' ? 0.9 : 0.35;
  const bounds = squareBounds(input.rings, pad);
  const timeoutMs = input.timeoutMs ?? 30_000;

  const aerialUri = await fetchAsDataUri(imageServerExport(capability.layers.aerialImage, bounds), timeoutMs);
  if (!aerialUri) return null;

  let overlayUri: string | null = null;
  if (input.kind !== 'aerial') {
    const source = overlaySource(input.kind, capability, bounds);
    overlayUri = source ? await fetchAsDataUri(source, timeoutMs) : null;
    if (!overlayUri) return null;
  }

  const ringsPx = input.rings.map((ring) => ring.map((point) => toPixels(bounds, point as [number, number])));
  const boundaryPath = ringsPx
    .map((ring) => `M ${ring.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ')} Z`)
    .join(' ');

  const overlayOpacity = input.kind === 'soils' ? 0.55 : 0.5;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE + 56}" viewBox="0 0 ${SIZE} ${SIZE + 56}">
  <rect width="${SIZE}" height="${SIZE + 56}" fill="#0b0e14"/>
  <image href="${aerialUri}" x="0" y="0" width="${SIZE}" height="${SIZE}"/>
  ${overlayUri ? `<image href="${overlayUri}" x="0" y="0" width="${SIZE}" height="${SIZE}" opacity="${overlayOpacity}"/>` : ''}
  <path d="${boundaryPath}" fill="none" stroke="#00e5ff" stroke-width="5" stroke-linejoin="round"/>
  <path d="${boundaryPath}" fill="#00e5ff" fill-opacity="0.06" stroke="none"/>
  <rect x="0" y="${SIZE}" width="${SIZE}" height="56" fill="#0b0e14"/>
  <text x="16" y="${SIZE + 24}" font-family="Segoe UI, Arial, sans-serif" font-size="19" font-weight="600" fill="#e8ecf4">${escapeXml(input.title)}</text>
  <text x="16" y="${SIZE + 45}" font-family="Segoe UI, Arial, sans-serif" font-size="14" fill="#8b94a7">${escapeXml(input.subtitle)}</text>
</svg>`;
}

const CACHE_ROOT = landosArtifactPath('visuals', 'parcel-overlays');

export interface OverlayCacheEntry { filePath: string; freshlyBuilt: boolean }

/** Build-and-cache an overlay SVG for a card; reuse the cached file for 7 days. */
export async function getOrBuildParcelOverlay(
  cardKey: string,
  input: OverlayBuildInput,
): Promise<OverlayCacheEntry | null> {
  fs.mkdirSync(CACHE_ROOT, { recursive: true });
  const fileName = `${cardKey.replace(/[^a-z0-9-]/gi, '_')}-${input.kind}.svg`;
  const filePath = path.join(CACHE_ROOT, fileName);
  try {
    const stat = fs.statSync(filePath);
    if (Date.now() - stat.mtimeMs < 7 * 24 * 3600 * 1000 && stat.size > 1000) {
      return { filePath, freshlyBuilt: false };
    }
  } catch {
    // not cached yet
  }
  const svg = await buildParcelOverlaySvg(input);
  if (!svg) return null;
  fs.writeFileSync(filePath, svg, 'utf8');
  return { filePath, freshlyBuilt: true };
}
