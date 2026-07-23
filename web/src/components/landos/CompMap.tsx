// Embedded LandOS comp map — interactive, dependency-free slippy map over free
// OSM raster tiles (attribution shown). Renders the FINAL deduplicated comp
// registry payload from GET /deal-cards/:id/comp-map: a distinct subject
// marker, selected primary sold comps, sold/active/context/rejected states,
// zoom/pan/fit/full-screen, filter toggles, cluster badges, and a click-through
// detail card with labeled PPA, selection score, why-selected/excluded, and
// direct provider links (new tab — LandOS state is never lost).
//
// This map is labeled as the final deduplicated set; the raw LandPortal
// "Show on Map" screenshot remains separate provider evidence elsewhere.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { apiGet, apiPost } from '../../lib/api';
import {
  fitView, tilesForView, pointToScreen, osmTileUrl, worldXToLng, worldYToLat,
  project, clusterByScreenDistance, type LatLng,
} from '../../lib/slippy';

export interface CompMapMarkerView {
  key: string | null;
  address: string | null;
  apn: string | null;
  status: 'sold' | 'active' | 'context' | 'duplicate' | 'rejected';
  selected: boolean;
  selectionScore: number | null;
  why: string;
  acres: number | null;
  acresDeltaFromSubject: number | null;
  price: number | null;
  ppa: { label: string; value: number; display: string } | null;
  dateIso: string | null;
  listingDate: string | null;
  daysOnMarket: number | null;
  providers: string[];
  providerLinks: string[];
  thumbnailUrl: string | null;
  sourceConfidence: 'high' | 'medium' | 'low' | null;
  comparability: string | null;
  lat: number | null;
  lng: number | null;
  distanceMiles: number | null;
}

export interface CompMapViewData {
  subject: { address: string | null; apn: string | null; acres: number | null; lat: number | null; lng: number | null; polygon?: Array<{ lat: number; lng: number }> | null };
  markers: CompMapMarkerView[];
  selection: { rationale: string; selectedCount: number; consideredCount: number };
  counts: { sold: number; active: number; context: number; rejected: number; duplicatesMerged: number; plottable: number; tableOnly: number };
  refreshDateIso: string;
  attribution: string;
  summaryLine: string;
}

type FilterKey = 'selected' | 'sold' | 'active' | 'context' | 'rejected';

const MARKER_COLOR: Record<string, string> = {
  subject: '#2563eb', sold: '#16a34a', active: '#f59e0b', context: '#94a3b8', rejected: '#dc2626', duplicate: '#a78bfa',
};

const money = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? `$${Math.round(n).toLocaleString('en-US')}` : '—');
const dateShort = (iso: string | null) => { if (!iso) return '—'; const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : iso; };

type SortKey = 'distance' | 'acresDelta' | 'ppa' | 'date' | 'comparability' | 'score';

const COMPARABILITY_RANK: Record<string, number> = {
  direct_comparable: 0, secondary_local_comparable: 1, small_lot_context: 2, large_acreage_context: 3, weak_context: 4,
};

/** Sortable table over the SAME final deduplicated registry the map renders. */
export function CompTable({ markers, onSelect, selectedKey }: { markers: CompMapMarkerView[]; onSelect?: (marker: CompMapMarkerView) => void; selectedKey?: string | null }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'distance', dir: 1 });
  const val = (m: CompMapMarkerView, key: SortKey): number => {
    switch (key) {
      case 'distance': return m.distanceMiles ?? Number.POSITIVE_INFINITY;
      case 'acresDelta': return m.acresDeltaFromSubject != null ? Math.abs(m.acresDeltaFromSubject) : Number.POSITIVE_INFINITY;
      case 'ppa': return m.ppa?.value ?? Number.NEGATIVE_INFINITY;
      case 'date': return m.dateIso ? Date.parse(m.dateIso) || 0 : 0;
      case 'comparability': return m.comparability != null ? (COMPARABILITY_RANK[m.comparability] ?? 9) : 9;
      case 'score': return m.selectionScore ?? Number.NEGATIVE_INFINITY;
    }
  };
  const rows = [...markers].sort((a, b) => (val(a, sort.key) - val(b, sort.key)) * sort.dir);
  const header = (key: SortKey, label: string) => (
    <th
      class="px-2 py-1 text-left text-[11px] text-slate-400 cursor-pointer select-none whitespace-nowrap"
      onClick={() => setSort({ key, dir: sort.key === key ? (sort.dir === 1 ? -1 : 1) : sort.dir })}
    >{label}{sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</th>
  );
  return (
    <div class="overflow-x-auto mt-2">
      <table class="min-w-full text-xs">
        <thead>
          <tr class="border-b border-slate-700">
            <th class="px-2 py-1 text-left text-[11px] text-slate-400">Address</th>
            <th class="px-2 py-1 text-left text-[11px] text-slate-400">Preview</th>
            <th class="px-2 py-1 text-left text-[11px] text-slate-400">Status</th>
            {header('distance', 'Distance')}
            <th class="px-2 py-1 text-left text-[11px] text-slate-400">Acres</th>
            {header('acresDelta', 'Δ Acres')}
            <th class="px-2 py-1 text-left text-[11px] text-slate-400">Price</th>
            {header('ppa', 'PPA')}
            {header('date', 'Date')}
            <th class="px-2 py-1 text-left text-[11px] text-slate-400">Providers</th>
            <th class="px-2 py-1 text-left text-[11px] text-slate-400">DOM</th>
            <th class="px-2 py-1 text-left text-[11px] text-slate-400">Links</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={`${m.key}-${m.address}`} onClick={() => onSelect?.(m)} class={`border-b border-slate-800 ${selectedKey === m.key ? 'bg-sky-500/10 ring-1 ring-inset ring-sky-500/30' : m.selected ? 'bg-amber-500/5' : ''} ${onSelect ? 'cursor-pointer' : ''}`}>
              <td class="px-2 py-1 text-slate-200 whitespace-nowrap max-w-[220px] overflow-hidden text-ellipsis" title={m.why}>{m.address ?? '—'}</td>
              <td class="px-2 py-1">{m.thumbnailUrl ? <img src={m.thumbnailUrl} alt="" class="w-8 h-8 rounded object-cover border border-slate-700" loading="lazy" /> : <span class="text-[10px] text-slate-600">none</span>}</td>
              <td class="px-2 py-1 text-slate-300">{m.status}</td>
              <td class="px-2 py-1 text-slate-300">{m.distanceMiles != null ? `${m.distanceMiles} mi` : '—'}</td>
              <td class="px-2 py-1 text-slate-300">{m.acres ?? '—'}</td>
              <td class="px-2 py-1 text-slate-300">{m.acresDeltaFromSubject != null ? `${m.acresDeltaFromSubject > 0 ? '+' : ''}${m.acresDeltaFromSubject}` : '—'}</td>
              <td class="px-2 py-1 text-slate-300">{money(m.price)}</td>
              <td class="px-2 py-1 text-slate-300" title={m.ppa?.label}>{m.ppa ? `${m.ppa.display} (${m.ppa.label})` : '—'}</td>
              <td class="px-2 py-1 text-slate-300">{dateShort(m.dateIso)}</td>
              <td class="px-2 py-1 text-slate-400 whitespace-nowrap">{m.providers.join(', ') || '—'}</td>
              <td class="px-2 py-1 text-slate-300">{m.daysOnMarket != null ? `${m.daysOnMarket} days` : '—'}</td>
              <td class="px-2 py-1">{m.providerLinks.slice(0, 3).map((u) => (
                <a key={u} href={u} target="_blank" rel="noopener noreferrer" class="text-sky-400 underline mr-1.5">↗</a>
              ))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CompMap({ dealCardId }: { dealCardId: number }) {
  const [data, setData] = useState<CompMapViewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<{ center: LatLng; zoom: number } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 640, h: 380 });
  const [filters, setFilters] = useState<Record<FilterKey, boolean>>({ selected: true, sold: true, active: true, context: false, rejected: false });
  const [detail, setDetail] = useState<CompMapMarkerView | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichmentMessage, setEnrichmentMessage] = useState('');
  const [enrichmentRetry, setEnrichmentRetry] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; center: LatLng } | null>(null);
  const enrichmentAttempted = useRef(false);

  const loadMap = () => {
    let alive = true;
    const request = apiGet<{ compMap: CompMapViewData }>(`/api/landos/deal-cards/${dealCardId}/comp-map`)
      .then((r) => { if (alive) { setData(r.compMap); setView(null); } })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return { request, cancel: () => { alive = false; } };
  };

  useEffect(() => {
    enrichmentAttempted.current = false;
    const active = loadMap();
    return active.cancel;
  }, [dealCardId]);

  useEffect(() => {
    if (!data?.counts.tableOnly || enrichmentAttempted.current) return;
    enrichmentAttempted.current = true;
    setEnriching(true);
    setEnrichmentMessage(`Checking ${data.counts.tableOnly} source listing location${data.counts.tableOnly === 1 ? '' : 's'}…`);
    apiPost<{ enrichment: { enriched: number; unresolved: number } }>(`/api/landos/deal-cards/${dealCardId}/comp-map/enrich`)
      .then(async (result) => {
        await loadMap().request;
        setEnrichmentMessage(result.enrichment.enriched > 0
          ? `${result.enrichment.enriched} additional listing location${result.enrichment.enriched === 1 ? '' : 's'} recovered.`
          : 'All currently published listing locations have been checked.');
      })
      .catch(() => setEnrichmentMessage('Location check could not finish. Use Retry locations to run it again.'))
      .finally(() => setEnriching(false));
  }, [data?.counts.tableOnly, dealCardId, enrichmentRetry]);

  const retryLocations = () => {
    enrichmentAttempted.current = false;
    setEnrichmentMessage('');
    setEnrichmentRetry((value) => value + 1);
  };

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth || 640, h: el.clientHeight || 380 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded, data]);

  const plottable = useMemo(() => (data?.markers ?? []).filter((m) => m.lat != null && m.lng != null), [data]);
  const tableOnlyMarkers = useMemo(() => (data?.markers ?? []).filter((m) => (m.status === 'sold' || m.status === 'active') && (m.lat == null || m.lng == null)), [data]);

  const visible = useMemo(() => plottable.filter((m) => {
    if (m.selected) return filters.selected || filters.sold;
    if (m.status === 'sold') return filters.sold;
    if (m.status === 'active') return filters.active;
    if (m.status === 'context' || m.status === 'duplicate') return filters.context;
    if (m.status === 'rejected') return filters.rejected;
    return true;
  }), [plottable, filters]);

  const fitAll = () => {
    if (!data) return;
    const pts: LatLng[] = [...(data.subject.polygon ?? [])];
    if (data.subject.lat != null && data.subject.lng != null) pts.push({ lat: data.subject.lat, lng: data.subject.lng });
    for (const m of visible) pts.push({ lat: m.lat!, lng: m.lng! });
    setView(fitView(pts, size.w, size.h));
  };

  useEffect(() => { if (data && !view && size.w > 0) fitAll(); }, [data, size.w]); // initial fit

  if (error) return <div class="text-sm text-red-400 p-3">Comp map unavailable: {error}</div>;
  if (!data) return <div class="text-sm text-slate-400 p-3">Loading comp map…</div>;
  const v = view ?? fitView([], size.w, size.h);

  const clusters = clusterByScreenDistance(
    visible.map((m) => ({ lat: m.lat!, lng: m.lng!, item: m })),
    Math.round(v.zoom),
    36,
  );

  const pan = (dxPx: number, dyPx: number, from: LatLng) => {
    const z = Math.round(v.zoom);
    const c = project(from, z);
    setView({ center: { lat: worldYToLat(c.y - dyPx, z), lng: worldXToLng(c.x - dxPx, z) }, zoom: v.zoom });
  };
  const zoomBy = (dz: number) => setView({ center: v.center, zoom: Math.max(2, Math.min(19, Math.round(v.zoom + dz))) });

  const markerDot = (m: CompMapMarkerView) => {
    const pos = pointToScreen({ lat: m.lat!, lng: m.lng! }, v.center, v.zoom, size.w, size.h);
    const color = MARKER_COLOR[m.status] ?? '#64748b';
    return (
      <button
        key={`${m.key}-${m.address}`}
        title={m.address ?? undefined}
        aria-label={`${m.selected ? 'Accepted sold comparable' : m.status === 'sold' ? 'Sold comparable' : 'Active comparable'}: ${m.address ?? 'address unavailable'}`}
        onClick={(e) => { e.stopPropagation(); setDetail(m); }}
        onMouseEnter={() => setDetail(m)}
        class="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow"
        style={{
          left: pos.left, top: pos.top,
          width: m.selected ? 18 : 13, height: m.selected ? 18 : 13,
          background: color, borderColor: m.selected ? '#fbbf24' : '#0f172a',
          zIndex: m.selected ? 30 : 20,
        }}
      />
    );
  };

  const subjectPin = data.subject.lat != null && data.subject.lng != null
    ? pointToScreen({ lat: data.subject.lat, lng: data.subject.lng }, v.center, v.zoom, size.w, size.h)
    : null;
  const subjectPolygonPoints = (data.subject.polygon ?? [])
    .map((point) => pointToScreen(point, v.center, v.zoom, size.w, size.h))
    .map((point) => `${point.left},${point.top}`)
    .join(' ');

  const toggle = (k: FilterKey, label: string, count: number) => (
    <button
      onClick={() => setFilters({ ...filters, [k]: !filters[k] })}
      class={`px-2 py-0.5 rounded text-xs border ${filters[k] ? 'bg-slate-700 border-slate-500 text-slate-100' : 'bg-transparent border-slate-700 text-slate-400'}`}
    >{label} ({count})</button>
  );

  return (
    <div class={expanded ? 'fixed inset-4 z-50 bg-slate-900 border border-slate-600 rounded-xl p-3 flex flex-col shadow-2xl' : 'relative'}>
      <div class="flex flex-wrap items-center gap-2 mb-2">
        <span class="text-xs font-semibold text-slate-200">Comparable property map</span>
        {toggle('sold', 'Accepted sold land', data.counts.sold)}
        {toggle('active', 'Active land', data.counts.active)}
        <span class="ml-auto flex gap-1">
          <button aria-label="Zoom in" class="px-2 py-0.5 rounded text-xs border border-slate-600 text-slate-200" onClick={() => zoomBy(1)}>+</button>
          <button aria-label="Zoom out" class="px-2 py-0.5 rounded text-xs border border-slate-600 text-slate-200" onClick={() => zoomBy(-1)}>−</button>
          <button aria-label="Fit all comparable locations" class="px-2 py-0.5 rounded text-xs border border-slate-600 text-slate-200" onClick={fitAll}>Fit</button>
          <button aria-label={expanded ? 'Close expanded comparable map' : 'Expand comparable map'} class="px-2 py-0.5 rounded text-xs border border-slate-600 text-slate-200" onClick={() => setExpanded(!expanded)}>{expanded ? 'Close' : 'Expand'}</button>
        </span>
      </div>
      <div
        ref={boxRef}
        class={`relative overflow-hidden rounded-lg border border-slate-700 bg-slate-800 ${expanded ? 'flex-1' : ''}`}
        style={expanded ? {} : { height: 380 }}
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, center: v.center }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (drag.current) pan(e.clientX - drag.current.x, e.clientY - drag.current.y, drag.current.center); }}
        onPointerUp={() => { drag.current = null; }}
        onWheel={(e) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1 : -1); }}
      >
        {tilesForView(v.center, v.zoom, size.w, size.h).map((t) => (
          <img
            key={`${t.z}/${t.x}/${t.y}`} src={osmTileUrl(t)} alt=""
            class="absolute select-none pointer-events-none"
            style={{ left: t.left, top: t.top, width: 256, height: 256 }}
            loading="lazy"
          />
        ))}
        {subjectPolygonPoints && <svg class="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 15 }} aria-label="Official subject parcel outline"><polygon points={subjectPolygonPoints} fill="rgba(37,99,235,0.16)" stroke="#60a5fa" stroke-width="2" /></svg>}
        {clusters.map((c) => c.items.length > 1 ? (
          <button
            key={`c-${c.lat}-${c.lng}`}
            aria-label={`${c.items.length} comparables in this area. Zoom in to separate them.`}
            title={`${c.items.length} comparables in this area — click to zoom in`}
            onClick={(e) => { e.stopPropagation(); setView({ center: { lat: c.lat, lng: c.lng }, zoom: Math.min(19, Math.round(v.zoom + 2)) }); }}
            class="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-200 text-slate-900 text-xs font-bold border-2 border-slate-900 shadow"
            style={{ ...(() => { const p = pointToScreen({ lat: c.lat, lng: c.lng }, v.center, v.zoom, size.w, size.h); return { left: p.left, top: p.top }; })(), width: 26, height: 26, zIndex: 25 }}
          >{c.items.length}</button>
        ) : markerDot(c.items[0]))}
        {subjectPin && (
          <div class="absolute -translate-x-1/2 -translate-y-full" style={{ left: subjectPin.left, top: subjectPin.top, zIndex: 40 }} title={data.subject.address ?? 'Subject'}>
            <div class="w-5 h-5 rotate-45 border-2 shadow-lg" style={{ background: MARKER_COLOR.subject, borderColor: '#fff' }} />
          </div>
        )}
        {!subjectPin && !subjectPolygonPoints && visible.length === 0 && <div class="absolute inset-0 grid place-items-center p-6 text-center text-xs text-slate-300 bg-slate-900/35">No subject geometry or comp coordinates are retained yet. Records remain available in the table; nothing is fabricated onto the map.</div>}
        <div class="absolute bottom-0 right-0 bg-slate-900/80 text-[10px] text-slate-300 px-1.5 py-0.5 rounded-tl">
          {data.attribution} · refreshed {dateShort(data.refreshDateIso)}
        </div>
        {enriching && (
          <div class="absolute top-0 left-0 bg-slate-900/80 text-[10px] text-amber-300 px-1.5 py-0.5 rounded-br">
            Completing source listing locations…
          </div>
        )}
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
        <span>{data.summaryLine}</span>
        <span class="inline-flex items-center gap-1"><span class="inline-block h-2.5 w-2.5 rotate-45 border border-white bg-blue-600" /> Subject</span>
        <span class="inline-flex items-center gap-1"><span class="inline-block h-2.5 w-2.5 rounded-full bg-green-600" /> Sold</span>
        <span class="inline-flex items-center gap-1"><span class="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" /> Active</span>
        <span>Numbered circles group nearby comparables.</span>
      </div>
      {enrichmentMessage && <div class="mt-1 text-[11px] text-slate-400" role="status">{enrichmentMessage}</div>}
      {tableOnlyMarkers.length > 0 && !enriching && (
        <details class="mt-2 rounded-md border border-slate-700 bg-slate-900/40 px-3 py-2 text-[11px] text-slate-300">
          <summary class="cursor-pointer font-medium">{tableOnlyMarkers.length} source listing{tableOnlyMarkers.length === 1 ? '' : 's'} do not publish a reliable map point</summary>
          <div class="mt-1 text-slate-400">They remain usable in the comp table and valuation where qualified. LandOS will not turn a road name or a bad geocoder match into a fake parcel pin.</div>
          <ul class="mt-1 list-disc pl-5 text-slate-400">{tableOnlyMarkers.map((marker) => <li key={`${marker.key}-${marker.address}`}>{marker.address ?? 'Address unavailable'} ({marker.status})</li>)}</ul>
          <button type="button" class="mt-2 rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-200" onClick={retryLocations}>Retry source locations</button>
        </details>
      )}

      {detail && (
        <div class="mt-2 border border-slate-600 rounded-lg p-3 bg-slate-800/80 text-sm relative">
          <div class="mb-2">{detail.thumbnailUrl ? <img src={detail.thumbnailUrl} alt={`Provider thumbnail for ${detail.address ?? 'comparable'}`} class="w-24 h-20 rounded object-cover border border-slate-600" /> : <div class="w-24 h-20 rounded border border-dashed border-slate-600 grid place-items-center text-[10px] text-slate-500 text-center">No provider thumbnail retained</div>}</div>
          <button class="absolute top-1.5 right-2 text-slate-400 hover:text-slate-200" onClick={() => setDetail(null)}>✕</button>
          <div class="font-semibold text-slate-100">{detail.address ?? '(no address)'}
            {detail.selected && <span class="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">Accepted sold comp</span>}
          </div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 mt-1.5 text-slate-300">
            <div><span class="text-slate-500">APN</span> {detail.apn ?? '—'}</div>
            <div><span class="text-slate-500">Status</span> {detail.status}</div>
            <div><span class="text-slate-500">Acres</span> {detail.acres ?? '—'}{detail.acresDeltaFromSubject != null ? ` (${detail.acresDeltaFromSubject > 0 ? '+' : ''}${detail.acresDeltaFromSubject} vs subject)` : ''}</div>
            <div><span class="text-slate-500">Distance</span> {detail.distanceMiles != null ? `${detail.distanceMiles} mi` : '—'}</div>
            <div><span class="text-slate-500">Price</span> {money(detail.price)}</div>
            <div><span class="text-slate-500">{detail.ppa?.label ?? 'PPA'}</span> {detail.ppa?.display ?? '—'}</div>
            <div><span class="text-slate-500">Date</span> {dateShort(detail.dateIso)}</div>
            <div><span class="text-slate-500">Listed</span> {dateShort(detail.listingDate)}</div>
            <div><span class="text-slate-500">Days on market</span> {detail.daysOnMarket ?? '—'}</div>
          </div>
          <div class="mt-1.5 text-slate-300"><span class="text-slate-500">Basis:</span> {detail.why || '—'}</div>
          <div class="mt-1.5 flex flex-wrap gap-2 items-center">
            <span class="text-slate-500 text-xs">Providers: {detail.providers.join(', ') || '—'}</span>
            {detail.providerLinks.map((u) => (
              <a key={u} href={u} target="_blank" rel="noopener noreferrer" class="text-xs text-sky-400 underline">
                {(() => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'source'; } })()} ↗
              </a>
            ))}
          </div>
        </div>
      )}

      {!expanded && (
        <div class="space-y-4 mt-3">
          <section>
            <div class="text-xs font-semibold text-slate-200">Accepted sold land comps</div>
            <CompTable markers={data.markers.filter((marker) => marker.status === 'sold')} onSelect={setDetail} selectedKey={detail?.key ?? null} />
          </section>
          <section>
            <div class="text-xs font-semibold text-slate-200">Active land listings</div>
            <CompTable markers={data.markers.filter((marker) => marker.status === 'active')} onSelect={setDetail} selectedKey={detail?.key ?? null} />
          </section>
          {data.markers.some((marker) => marker.status === 'context') && (
            <section>
              <div class="text-xs font-semibold text-slate-200">Improved/manufactured-home strategy evidence</div>
              <CompTable markers={data.markers.filter((marker) => marker.status === 'context')} onSelect={setDetail} selectedKey={detail?.key ?? null} />
            </section>
          )}
          <details class="rounded border border-slate-700 p-2">
            <summary class="text-xs text-slate-400 cursor-pointer">Rejected or unusable candidates ({data.markers.filter((marker) => marker.status === 'rejected').length})</summary>
            <CompTable markers={data.markers.filter((marker) => marker.status === 'rejected')} onSelect={setDetail} selectedKey={detail?.key ?? null} />
          </details>
        </div>
      )}
    </div>
  );
}
