// Market Research — choropleth heat map (US states → state counties → county ZIPs).
//
// Renders LandOS-retained snapshot values only. Sequential single-hue ramp for
// magnitude; geographies with no retained result render the neutral surface
// (absent, never zero). us-atlas states/counties TopoJSON is pre-projected
// (AlbersUsa, 975×610) so US/state views draw with an identity fit; ZIP (ZCTA)
// polygons arrive as WGS84 GeoJSON and are fitted with a Mercator projection.

import { useMemo, useState } from 'preact/hooks';
import { geoPath, geoIdentity, geoMercator, geoArea } from 'd3-geo';

// TIGERweb/RFC-7946 GeoJSON winds exterior rings clockwise; d3 treats such a
// ring as enclosing the REST of the sphere and fills the whole viewport.
// Rewind any ring whose spherical area exceeds a hemisphere.
function rewindRing(ring: number[][]): number[][] {
  const area = geoArea({ type: 'Polygon', coordinates: [ring] } as never);
  return area > Math.PI ? [...ring].reverse() : ring;
}
export function rewindGeometry(geometry: unknown): unknown {
  const g = geometry as { type?: string; coordinates?: unknown };
  if (g?.type === 'Polygon') {
    return { type: 'Polygon', coordinates: (g.coordinates as number[][][]).map(rewindRing) };
  }
  if (g?.type === 'MultiPolygon') {
    return { type: 'MultiPolygon', coordinates: (g.coordinates as number[][][][]).map((poly) => poly.map(rewindRing)) };
  }
  return geometry;
}

export interface MapFeature {
  key: string;                // stable geo key for the row lookup (abbr/fips/zip)
  name: string;
  feature: GeoJSON.Feature | { type: 'Feature'; geometry: unknown; properties?: unknown };
}

export interface HeatMapProps {
  features: MapFeature[];
  /** Pre-projected planar coordinates (us-atlas) vs raw WGS84 (ZCTA). */
  projection: 'albers-prebaked' | 'mercator-fit';
  valueByKey: Map<string, number | null>;
  formatValue: (v: number) => string;
  metricLabel: string;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** Zoom the identity fit to these features only (state/county drill). */
  fitToData?: boolean;
}

const W = 960;
const H = 600;

// Sequential ramp — one hue (teal), dark→bright against the dark surface.
export function heatColor(t: number): string {
  const light = 20 + t * 44;          // 20% → 64%
  const sat = 42 + t * 26;            // 42% → 68%
  return `hsl(174 ${sat.toFixed(0)}% ${light.toFixed(0)}%)`;
}
const NO_DATA_FILL = 'var(--color-elevated)';

export function MarketHeatMap({ features, projection, valueByKey, formatValue, metricLabel, selectedKey, onSelect }: HeatMapProps) {
  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null);

  const { paths, min, max } = useMemo(() => {
    const values = features
      .map((f) => valueByKey.get(f.key))
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const mn = values.length ? Math.min(...values) : null;
    const mx = values.length ? Math.max(...values) : null;

    const drawFeatures = projection === 'mercator-fit'
      ? features.map((f) => ({ ...f, feature: { ...(f.feature as object), geometry: rewindGeometry((f.feature as { geometry: unknown }).geometry) } }))
      : features;
    const collection = { type: 'FeatureCollection', features: drawFeatures.map((f) => f.feature) } as never;
    const proj = projection === 'mercator-fit'
      ? geoMercator().fitExtent([[8, 8], [W - 8, H - 8]], collection)
      : geoIdentity().fitExtent([[8, 8], [W - 8, H - 8]], collection);
    const path = geoPath(proj as never);

    const paths = drawFeatures.map((f) => ({
      key: f.key,
      name: f.name,
      d: path(f.feature as never) ?? '',
    }));
    return { paths, min: mn, max: mx };
  }, [features, projection, valueByKey]);

  const fillFor = (key: string): string => {
    const v = valueByKey.get(key);
    if (v === null || v === undefined || min === null || max === null) return NO_DATA_FILL;
    const t = max === min ? 0.65 : (v - min) / (max - min);
    return heatColor(t);
  };

  const hoverRow = hover ? features.find((f) => f.key === hover.key) : null;
  const hoverValue = hover ? valueByKey.get(hover.key) : undefined;

  return (
    <div class="relative">
      <svg viewBox={`0 0 ${W} ${H}`} class="w-full h-auto block select-none" role="img" aria-label={`${metricLabel} heat map`}>
        {paths.map((p) => (
          <path
            key={p.key}
            data-geo={p.key}
            d={p.d}
            fill={fillFor(p.key)}
            stroke={selectedKey === p.key ? 'var(--color-text)' : 'var(--color-bg)'}
            stroke-width={selectedKey === p.key ? 2 : 0.7}
            class="cursor-pointer transition-opacity"
            opacity={hover && hover.key !== p.key ? 0.75 : 1}
            onMouseMove={(e) => {
              const rect = (e.currentTarget as SVGPathElement).ownerSVGElement!.getBoundingClientRect();
              setHover({ key: p.key, x: e.clientX - rect.left, y: e.clientY - rect.top });
            }}
            onMouseLeave={() => setHover(null)}
            onClick={() => onSelect(p.key)}
          >
          </path>
        ))}
        {/* Selected outline re-drawn last so it sits above neighbors. */}
        {selectedKey && (() => {
          const sel = paths.find((p) => p.key === selectedKey);
          return sel ? <path d={sel.d} fill="none" stroke="var(--color-text)" stroke-width={2} pointer-events="none" /> : null;
        })()}
      </svg>

      {hover && hoverRow && (
        <div
          class="pointer-events-none absolute z-10 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-card)] px-2.5 py-1.5 shadow-lg"
          style={{ left: `min(${(hover.x / W) * 100}%, calc(100% - 180px))`, top: `max(0px, calc(${(hover.y / H) * 100}% - 52px))` }}
        >
          <div class="text-[12px] font-medium text-[var(--color-text)]">{hoverRow.name}</div>
          <div class="text-[11px] text-[var(--color-text-muted)] tabular-nums">
            {typeof hoverValue === 'number'
              ? <>{metricLabel}: <span class="text-[var(--color-text)]">{formatValue(hoverValue)}</span></>
              : 'No retained result'}
          </div>
        </div>
      )}

      <div class="mt-2 flex items-center gap-2 text-[10px] text-[var(--color-text-faint)]">
        {min !== null && max !== null ? (
          <>
            <span class="tabular-nums">{formatValue(min)}</span>
            <div class="h-2 w-36 rounded" style={{ background: `linear-gradient(90deg, ${heatColor(0)}, ${heatColor(0.5)}, ${heatColor(1)})` }} />
            <span class="tabular-nums">{formatValue(max)}</span>
            <span class="ml-1 text-[var(--color-text-faint)]">{metricLabel}</span>
          </>
        ) : (
          <span>No retained values for {metricLabel} at this level yet.</span>
        )}
        <span class="ml-3 inline-flex items-center gap-1.5">
          <span class="h-3 w-3 rounded border border-[var(--color-border)]" style={{ background: NO_DATA_FILL }} />
          Not collected (never shown as zero)
        </span>
      </div>
    </div>
  );
}
