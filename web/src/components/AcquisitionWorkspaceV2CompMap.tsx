// Acquisition Workspace V2 — the ONE combined comparable map.
//
// A single interactive slippy map (existing lib/slippy + free raster tiles) over
// the Comps & Valuation workspace projection. It renders EXACTLY the record set
// the comps workspace is filtered to, so the list and the map can never disagree
// about what is on screen.
//
// Interaction contract:
//   • HOVER over a marker shows a TEMPORARY preview — thumbnail, address, closed
//     or active label, role, distance, acreage, price, $/acre, date, market time,
//     source, and one comparability line. It disappears when the pointer leaves,
//     unless that record has been clicked and pinned. It is the ONLY thing hover
//     produces: markers carry no `title`, because the browser's native tooltip
//     rendered a second white strip across the map underneath the real preview.
//   • CLICK a marker opens a PERSISTENT pinned popup carrying the full record.
//     It survives the pointer moving away and closes only on the close control,
//     another record, another card, or a filter that removes it.
//   • CLICK a numbered cluster opens a persistent cluster popup that IDENTIFIES
//     every record inside it, separated into closed comps, active competitors,
//     zero-weight sales, improved context and other context. Selecting one opens
//     its full pinned popup and highlights its marker and its card.
//   • EXPAND opens the same map — same records, same selection, same basemap,
//     same overlays — in a large inspection view, with closed/active/both
//     filtering. It is a second VIEW, never a second data source.
//   • Selection and hover are bidirectional with the comp list, and the current
//     filter survives opening a record from the map.
//
// Closed valuation evidence and live competition never share a visual identity:
// shape, colour and badge all come from CompRecordIdentity, so a green circle
// (closed sale) can never be misread as an orange square (active competitor).
//
// Records without a resolved location are NEVER placed at a guessed point; they
// are listed honestly below the map and stay reachable through the filters.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { ExternalLink, Maximize2, X } from 'lucide-preact';
import {
  fitView, tilesForView, pointToScreen, basemapTileUrl, worldXToLng, worldYToLat,
  project, clusterByScreenDistance, BASEMAPS, basemapAttribution, type BasemapId, type LatLng,
} from '../lib/slippy';
import {
  BOUNDARY_LAYERS, fetchBoundaryLayer, ringToSvgPath,
  type BoundaryFetchResult, type BoundaryLayerId,
} from '../lib/boundaries';
import { CompVisualThumb } from './CompVisualThumb';
import {
  identityFor, MarkerGlyph, CompKindBadge, CompProvenanceBadges, COMP_IDENTITIES,
  type CompRecordIdentity,
} from './CompRecordIdentity';
import { compProviders } from '@/lib/comp-provenance';
import type { CvComp, CvSubject } from './AcquisitionWorkspaceV2CompsValuation';

const usd = (n: number | null) => (typeof n === 'number' && Number.isFinite(n) ? `$${Math.round(n).toLocaleString('en-US')}` : '—');
const nameOf = (c: CvComp) => c.address ?? (c.apn ? `APN ${c.apn}` : 'Unnamed parcel');
const idOf = (c: CvComp): CompRecordIdentity => identityFor(c);

/** Approximate preview box, used only to keep it inside the map canvas. */
const PREVIEW_W = 320;
/** Must match the max-height in .awv2-cv-hoverpreview, or the clamp under-reads
 *  the box and the last line falls off the canvas. */
const PREVIEW_H = 315;
const PREVIEW_GAP = 16;

/**
 * Which transaction kinds the expanded map is showing.
 *
 * This is a VIEW filter over the records the workspace already handed down, not
 * a second query. "Closed" answers "what has actually sold around here"; "Active"
 * answers "what am I bidding against"; those are two different questions and
 * looking at both at once is how a live asking price gets mistaken for evidence.
 */
export type TransactionMode = 'closed' | 'active' | 'both';

const TRANSACTION_MODES: Array<{ id: TransactionMode; label: string; hint: string }> = [
  { id: 'closed', label: 'Closed sales', hint: 'Subject plus closed-sale records only.' },
  { id: 'active', label: 'Active listings', hint: 'Subject plus live competition only.' },
  { id: 'both', label: 'Both', hint: 'Subject plus closed-sale and active records.' },
];

/** The transaction filter for the expanded map. The subject is never filtered. */
function matchesTransactionMode(c: CvComp, mode: TransactionMode): boolean {
  if (mode === 'both') return true;
  if (mode === 'closed') return c.transactionKind === 'closed';
  return c.transactionKind === 'active';
}

/**
 * Keep a hover preview fully inside the map canvas.
 *
 * A preview that renders off an edge is worse than no preview: the operator sees
 * a half-cut panel and cannot read the record they are pointing at. So the box
 * flips below the marker when there is no room above it, and both axes are then
 * clamped so the whole panel stays on the canvas — including the last line,
 * which is the comparability sentence that explains the record.
 */
function clampPreview(pos: { left: number; top: number }, size: { w: number; h: number }) {
  const half = PREVIEW_W / 2;
  const left = Math.max(half + 8, Math.min(Math.max(half + 8, size.w - half - 8), pos.left));
  const below = pos.top < PREVIEW_H + PREVIEW_GAP;
  const top = below
    ? Math.max(8, Math.min(pos.top, size.h - PREVIEW_H - PREVIEW_GAP))
    : Math.max(PREVIEW_H + PREVIEW_GAP, Math.min(pos.top, size.h - 8));
  return { left, top, below };
}

/** The market-time figure that belongs on THIS record, with its own label. */
function marketTimeText(c: CvComp): string {
  const m = c.listing?.marketTime;
  if (!m || m.cumulativeDays == null) {
    return m?.providerDaysOnMarket != null
      ? `Provider DOM ${m.providerDaysOnMarket} d · cumulative unavailable`
      : 'Market time unavailable';
  }
  const label = c.transactionKind === 'active' ? 'cumulative active' : 'cumulative DOM';
  const provider = m.providerDaysOnMarket != null && m.providerDaysOnMarket !== m.cumulativeDays
    ? ` (provider ${m.providerDaysOnMarket} d)`
    : '';
  return `${m.cumulativeDays} d ${label}${provider}`;
}

/** Price label that never lets an asking price read as sold evidence. */
const priceLabelOf = (c: CvComp) => c.listing?.price.amountLabel
  ?? (c.priceKind === 'sale' ? 'Sold price' : 'Asking price');
const priceOf = (c: CvComp) => c.listing?.price.amount ?? c.price;
const ppaOf = (c: CvComp) => c.listing?.price.perAcre ?? c.pricePerAcre;
const photoCountOf = (c: CvComp) => c.listing?.photos?.count ?? 0;

export interface CompMapActions {
  onExclude?: (c: CvComp) => void;
  onRestore?: (c: CvComp) => void;
  onInclude?: (c: CvComp) => void;
  busyKey?: string | null;
}

const ROLE_TEXT: Record<string, string> = {
  direct: 'Direct comp',
  supporting: 'Supporting comp',
  supplemental_historical: 'Supplemental historical comp',
  boundary: 'Boundary comp',
  historical_context: 'Historical context',
};

const RADIUS_TEXT: Record<string, string> = {
  initial_10: 'within 10 mi',
  expansion_20: '10–20 mi',
  beyond_20: 'beyond 20 mi',
  none: 'unresolved',
};

// ── One map surface ──────────────────────────────────────────────────────────
//
// Rendered twice: inline in the workspace, and inside the expanded overlay. Each
// surface owns only its own framing (centre, zoom, canvas size) and its own
// transient popups; everything that must survive expanding — the selected
// record, the hovered record, the basemap, the overlays — is held above and
// passed in. That is what makes the expanded map the SAME map rather than a
// second one that happens to look similar.

interface SurfaceProps {
  subject: CvSubject;
  comps: CvComp[];
  selectedKey: string | null;
  hoverKey: string | null;
  onSelect: (key: string | null) => void;
  onHover: (key: string | null) => void;
  onOpenDetails?: (key: string) => void;
  actions?: CompMapActions;
  basemap: BasemapId;
  setBasemap: (b: BasemapId) => void;
  overlays: Record<BoundaryLayerId, boolean>;
  toggleOverlay: (id: BoundaryLayerId) => void;
  boundaries: Partial<Record<BoundaryLayerId, BoundaryFetchResult | 'loading'>>;
  expanded: boolean;
  /** Rendered into the control bar: Expand, or the transaction modes + Close. */
  controls?: preact.ComponentChildren;
}

function MapSurface({
  subject, comps, selectedKey, hoverKey, onSelect, onHover, onOpenDetails, actions,
  basemap, setBasemap, overlays, toggleOverlay, boundaries, expanded, controls,
}: SurfaceProps) {
  const [view, setView] = useState<{ center: LatLng; zoom: number } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 640, h: 460 });
  const [clusterOpen, setClusterOpen] = useState<{ lat: number; lng: number; items: CvComp[] } | null>(null);
  // Hover preview is TEMPORARY and lives only here. It is never allowed to
  // dismiss or replace the pinned popup, which is owned by `selectedKey`.
  const [preview, setPreview] = useState<{ key: string; left: number; top: number; below: boolean } | null>(null);
  const [clusterPreview, setClusterPreview] = useState<{ items: CvComp[]; left: number; top: number; below: boolean } | null>(null);
  const [boundaryLabel, setBoundaryLabel] = useState<{ name: string; caption: string } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; center: LatLng; moved: boolean } | null>(null);

  const plottable = useMemo(() => comps.filter((c) => c.lat != null && c.lng != null), [comps]);
  const unresolved = useMemo(() => comps.filter((c) => c.lat == null || c.lng == null), [comps]);
  const selected = useMemo(
    () => comps.find((c) => c.key === selectedKey) ?? null,
    [comps, selectedKey],
  );
  const previewComp = useMemo(
    () => (preview ? comps.find((c) => c.key === preview.key) ?? null : null),
    [comps, preview],
  );

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth || 640, h: el.clientHeight || 460 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitAll = () => {
    const pts: LatLng[] = [];
    if (subject.lat != null && subject.lng != null) pts.push({ lat: subject.lat, lng: subject.lng });
    for (const c of plottable) pts.push({ lat: c.lat!, lng: c.lng! });
    setView(fitView(pts, size.w, size.h));
  };

  // Initial framing: the subject and every displayed property together.
  useEffect(() => {
    if (!view && size.w > 0 && (plottable.length > 0 || subject.lat != null)) fitAll();
  }, [plottable.length, subject.lat, size.w]);

  // Card → map: selecting a card centres and reveals its marker. The zoom is
  // preserved so the operator never loses their frame of reference.
  useEffect(() => {
    if (!selected || selected.lat == null || selected.lng == null) return;
    setClusterOpen(null);
    setPreview(null);
    setView((prev) => ({
      center: { lat: selected.lat!, lng: selected.lng! },
      zoom: prev ? Math.max(prev.zoom, 11) : 12,
    }));
  }, [selectedKey]);

  const v = view ?? fitView([], size.w, size.h);

  const pan = (dxPx: number, dyPx: number, from: LatLng) => {
    const z = Math.round(v.zoom);
    const c = project(from, z);
    setView({ center: { lat: worldYToLat(c.y - dyPx, z), lng: worldXToLng(c.x - dxPx, z) }, zoom: v.zoom });
  };
  const zoomBy = (dz: number) => setView({ center: v.center, zoom: Math.max(2, Math.min(19, Math.round(v.zoom + dz))) });

  // The selected record is lifted OUT of clustering and drawn as its own marker,
  // so "highlight its marker" is always possible. Otherwise a record picked from
  // a cluster popup would vanish back into the same numbered circle it was
  // chosen from, leaving the operator no idea which parcel they just opened.
  const clusters = clusterByScreenDistance(
    plottable.filter((c) => c.key !== selectedKey).map((c) => ({ lat: c.lat!, lng: c.lng!, item: c })),
    Math.round(v.zoom),
    34,
  );

  const pick = (c: CvComp) => { setClusterOpen(null); setPreview(null); onSelect(c.key); };

  const enterMarker = (c: CvComp, pos: { left: number; top: number }) => {
    onHover(c.key);
    setClusterPreview(null);
    setPreview({ key: c.key, ...clampPreview(pos, size) });
  };
  const leaveMarker = () => { onHover(null); setPreview(null); };

  const markerDot = (c: CvComp) => {
    const pos = pointToScreen({ lat: c.lat!, lng: c.lng! }, v.center, v.zoom, size.w, size.h);
    const identity = idOf(c);
    const isSelected = c.key === selectedKey;
    const isHover = c.key === hoverKey;
    const grow = isSelected ? 10 : isHover ? 6 : 0;
    return (
      <button
        key={c.key}
        type="button"
        // NO `title`: the browser renders its own tooltip for one, which drew a
        // second white strip across the map beneath the real preview below.
        aria-label={`${identity.badge}: ${nameOf(c)}. Click for full comparable details.`}
        aria-pressed={isSelected}
        onClick={(e) => { e.stopPropagation(); pick(c); }}
        onPointerEnter={() => enterMarker(c, pos)}
        onPointerLeave={leaveMarker}
        class={`awv2-cv-marker kind-${identity.kind}${isSelected ? ' selected' : ''}${isHover ? ' hovered' : ''}`}
        style={{ left: pos.left, top: pos.top, zIndex: isSelected ? 36 : isHover ? 34 : identity.isClosedEvidence ? 30 : 20 }}
      >
        <MarkerGlyph identity={identity} size={identity.size + grow} selected={isSelected} hovered={isHover} />
      </button>
    );
  };

  const subjectPin = subject.lat != null && subject.lng != null
    ? pointToScreen({ lat: subject.lat, lng: subject.lng }, v.center, v.zoom, size.w, size.h)
    : null;

  /** The condensed fact hierarchy shared by the hover preview and the popup. */
  const previewFacts = (c: CvComp) => (
    <span class="awv2-cv-prevfacts">
      <span><i>Distance</i>{c.distanceMiles != null ? `${c.distanceMiles} mi` : 'unavailable'}</span>
      <span><i>Acres</i>{c.acres ?? '—'}</span>
      <span><i>{priceLabelOf(c)}</i>{usd(priceOf(c))}</span>
      <span><i>$ / acre</i>{usd(ppaOf(c))}</span>
      <span><i>{c.transactionKind === 'active' ? 'Listed' : 'Sold'}</i>{c.transactionKind === 'active' ? (c.listing?.marketTime.originalListingDateIso ?? c.dateIso ?? '—') : (c.listing?.soldDateIso ?? c.dateIso ?? '—')}</span>
      <span><i>Market time</i>{marketTimeText(c)}</span>
      {/* The providers, not the merge history. `c.source` is every reconciled
          observation joined with " + "; printing it verbatim put a 5,347-
          character paragraph in this preview and stretched it to 4,652px, off
          the map canvas. */}
      <span><i>Source</i>{compProviders(c).join(' · ')}</span>
    </span>
  );

  const factRow = (c: CvComp) => (
    <div class="grid">
      <span><i>Role</i>{c.valuationRole ? ROLE_TEXT[c.valuationRole] : c.operatorExcluded ? 'Excluded' : c.categoryLabel}</span>
      <span><i>Status</i>{c.statusLabel}</span>
      <span><i>Distance</i>{c.distanceMiles != null ? `${c.distanceMiles} mi from subject` : 'Distance unavailable'}</span>
      <span><i>Radius stage</i>{RADIUS_TEXT[c.radiusStage ?? 'none']}</span>
      <span><i>Acres</i>{c.acres ?? '—'}</span>
      <span><i>Acreage vs subject</i>{c.acresDeltaFromSubject != null ? `${c.acresDeltaFromSubject > 0 ? '+' : ''}${c.acresDeltaFromSubject} ac` : '—'}</span>
      <span><i>{priceLabelOf(c)}</i>{usd(priceOf(c))}</span>
      <span><i>$ / acre</i>{usd(ppaOf(c))}</span>
      <span><i>{c.transactionKind === 'active' ? 'Listing date' : 'Sale date'}</i>{(c.transactionKind === 'active' ? c.listing?.marketTime.originalListingDateIso : c.listing?.soldDateIso) ?? c.dateIso ?? '—'}{c.monthsOld != null ? ` (${c.monthsOld} mo ago)` : ''}</span>
      <span><i>{c.transactionKind === 'active' ? 'Cumulative active days' : 'Cumulative DOM'}</i>{marketTimeText(c)}</span>
      <span><i>Source</i>{compProviders(c).join(' · ')}</span>
    </div>
  );

  /** Cluster contents, split so closed evidence never blends into competition. */
  const clusterGroups = (items: CvComp[]) => {
    const groups: Array<{ id: string; title: string; rows: CvComp[] }> = [
      { id: 'closed', title: 'Closed valuation comps', rows: items.filter((c) => idOf(c).kind === 'closed') },
      { id: 'active', title: 'Active competitors', rows: items.filter((c) => idOf(c).kind === 'active') },
      { id: 'zero', title: 'Historical / zero-weight sales', rows: items.filter((c) => idOf(c).kind === 'zeroWeight') },
      { id: 'improved', title: 'Improved context', rows: items.filter((c) => idOf(c).kind === 'improved') },
      { id: 'context', title: 'Other context', rows: items.filter((c) => idOf(c).kind === 'context') },
      { id: 'excluded', title: 'Excluded records', rows: items.filter((c) => idOf(c).kind === 'excluded') },
    ];
    return groups.filter((g) => g.rows.length > 0);
  };

  const clusterRow = (c: CvComp) => (
    <li key={`cl-${c.key}`}>
      <button
        type="button"
        class="awv2-cv-clusterrow"
        onClick={() => pick(c)}
        onPointerEnter={() => onHover(c.key)}
        onPointerLeave={() => onHover(null)}
      >
        <CompVisualThumb visual={c.visual} alt={nameOf(c)} width={64} height={50} zoom={12} />
        <span class="body">
          <span class="addr">{nameOf(c)}</span>
          <CompKindBadge identity={idOf(c)} />
          <span class="facts">
            {c.valuationRole ? ROLE_TEXT[c.valuationRole] : c.categoryLabel}
            {' · '}{c.transactionKind === 'active' ? 'Active' : 'Closed'}
            {' · '}{c.distanceMiles != null ? `${c.distanceMiles} mi` : 'distance unavailable'}
            {' · '}{c.acres ?? '—'} ac
            {' · '}{usd(priceOf(c))}
            {' · '}{usd(ppaOf(c))}/ac
            {' · '}{(c.transactionKind === 'active' ? c.listing?.marketTime.originalListingDateIso : c.listing?.soldDateIso) ?? c.dateIso ?? 'undated'}
            {' · '}{marketTimeText(c)}
          </span>
        </span>
      </button>
    </li>
  );

  // ── Boundary overlays: drawn under the markers, never over them ──
  const overlayPaths = BOUNDARY_LAYERS
    .filter((spec) => overlays[spec.id])
    .map((spec) => {
      const loaded = boundaries[spec.id];
      if (!loaded || loaded === 'loading') return null;
      return loaded.features.map((f, fi) => f.rings.map((ring, ri) => {
        const d = ringToSvgPath(ring, v.center, v.zoom, size.w, size.h);
        if (!d) return null;
        return (
          <path
            key={`${spec.id}-${fi}-${ri}`}
            d={d}
            fill="none"
            stroke={spec.stroke}
            stroke-width={spec.width}
            stroke-dasharray={spec.dash || undefined}
            stroke-linejoin="round"
            class="awv2-cv-boundary-path"
            onPointerEnter={() => setBoundaryLabel({ name: f.name, caption: f.caption })}
            onPointerLeave={() => setBoundaryLabel(null)}
            onClick={() => setBoundaryLabel({ name: f.name, caption: f.caption })}
          />
        );
      }));
    });
  const anyOverlayOn = BOUNDARY_LAYERS.some((s) => overlays[s.id]);
  const overlayNotes = BOUNDARY_LAYERS
    .filter((s) => overlays[s.id])
    .map((s) => {
      const loaded = boundaries[s.id];
      if (loaded === 'loading') return { id: s.id, text: `${s.label}: loading the Census boundary…` };
      if (!loaded) return null;
      return loaded.note ? { id: s.id, text: `${s.label}: ${loaded.note}` } : null;
    })
    .filter(Boolean) as Array<{ id: string; text: string }>;

  return (
    <div class={`awv2-cv-map${expanded ? ' expanded' : ''}`}>
      <div class="awv2-cv-map-controls">
        <span class="awv2-cv-map-shown">
          Showing <b>{plottable.length}</b> of <b>{comps.length}</b> record{comps.length === 1 ? '' : 's'}
          {unresolved.length > 0 && <> · <b>{unresolved.length}</b> unresolved (never guessed)</>}
        </span>
        <span class="awv2-cv-map-layers" role="group" aria-label="Base map layer">
          {BASEMAPS.map((b) => (
            <button
              key={b.id}
              type="button"
              class={basemap === b.id ? 'active' : ''}
              aria-pressed={basemap === b.id}
              onClick={() => setBasemap(b.id)}
            >{b.label}</button>
          ))}
        </span>
        <span class="awv2-cv-map-zoom">
          <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1)}>+</button>
          <button type="button" aria-label="Zoom out" onClick={() => zoomBy(-1)}>−</button>
          <button type="button" onClick={fitAll}>{expanded ? 'Fit visible records' : 'Fit'}</button>
        </span>
        {controls}
      </div>

      {/* Boundary overlays are OFF by default and each one names itself. Line
          STYLE, not colour alone, separates them, so the distinction survives
          colour-blind vision and a monochrome screenshot. */}
      <div class="awv2-cv-map-overlays" role="group" aria-label="Jurisdiction boundary overlays">
        <span class="ol">Boundaries</span>
        {BOUNDARY_LAYERS.map((spec) => (
          <button
            key={spec.id}
            type="button"
            class={`awv2-cv-overlaybtn${overlays[spec.id] ? ' active' : ''}`}
            aria-pressed={overlays[spec.id]}
            onClick={() => toggleOverlay(spec.id)}
          >
            <svg width="20" height="8" aria-hidden="true" class="sw">
              <line x1="1" y1="4" x2="19" y2="4" stroke={spec.stroke} stroke-width={spec.width} stroke-dasharray={spec.dash || undefined} />
            </svg>
            {spec.label}
          </button>
        ))}
        {anyOverlayOn && <span class="src">U.S. Census TIGER</span>}
      </div>

      <div
        ref={boxRef}
        class="awv2-cv-map-canvas"
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, center: v.center, moved: false }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          if (Math.abs(e.clientX - drag.current.x) > 3 || Math.abs(e.clientY - drag.current.y) > 3) drag.current.moved = true;
          pan(e.clientX - drag.current.x, e.clientY - drag.current.y, drag.current.center);
        }}
        onPointerUp={() => { drag.current = null; }}
        onWheel={(e) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1 : -1); }}
      >
        {tilesForView(v.center, v.zoom, size.w, size.h).map((t) => (
          <img
            key={`${basemap}-${t.z}/${t.x}/${t.y}`} src={basemapTileUrl(t, basemap)} alt=""
            class="absolute select-none pointer-events-none"
            style={{ left: t.left, top: t.top, width: 256, height: 256 }}
            loading="lazy"
          />
        ))}

        {anyOverlayOn && (
          <svg class="awv2-cv-boundary-svg" width={size.w} height={size.h} aria-hidden="false" role="presentation">
            {overlayPaths}
          </svg>
        )}
        {boundaryLabel && (
          <div class="awv2-cv-boundary-label" role="status">
            <b>{boundaryLabel.name}</b>
            <span>{boundaryLabel.caption}</span>
          </div>
        )}

        {clusters.map((cl) => cl.items.length > 1 ? (() => {
          const p = pointToScreen({ lat: cl.lat, lng: cl.lng }, v.center, v.zoom, size.w, size.h);
          const closedCount = cl.items.filter((i) => idOf(i).kind === 'closed').length;
          const activeCount = cl.items.filter((i) => idOf(i).kind === 'active').length;
          return (
            <button
              key={`c-${cl.lat}-${cl.lng}`}
              type="button"
              // No `title` here either — same duplicate-strip defect.
              aria-label={`${cl.items.length} comparables in this area: ${closedCount} closed, ${activeCount} active. Click to list them.`}
              onClick={(e) => { e.stopPropagation(); onSelect(null); setClusterPreview(null); setPreview(null); setClusterOpen({ lat: cl.lat, lng: cl.lng, items: cl.items }); }}
              onPointerEnter={() => { setPreview(null); setClusterPreview({ items: cl.items, ...clampPreview(p, size) }); }}
              onPointerLeave={() => setClusterPreview(null)}
              class={`awv2-cv-map-cluster${cl.items.some((i) => i.key === selectedKey || i.key === hoverKey) ? ' active' : ''}`}
              style={{ left: p.left, top: p.top, width: 30, height: 30, zIndex: 25 }}
            >{cl.items.length}</button>
          );
        })() : markerDot(cl.items[0]))}
        {selected && selected.lat != null && selected.lng != null && markerDot(selected)}
        {subjectPin && (
          <div
            class="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: subjectPin.left, top: subjectPin.top, zIndex: 40 }}
          >
            <MarkerGlyph identity={COMP_IDENTITIES.subject} size={COMP_IDENTITIES.subject.size} />
          </div>
        )}

        {/* ── Temporary hover preview: identifies the record instantly, and
              vanishes on pointer-out. It NEVER touches the pinned popup. ── */}
        {previewComp && previewComp.key !== selectedKey && (
          <div
            class={`awv2-cv-hoverpreview${preview!.below ? ' below' : ''}`}
            role="tooltip"
            aria-label={`Preview of ${nameOf(previewComp)}`}
            style={{ left: preview!.left, top: preview!.top }}
          >
            <CompVisualThumb visual={previewComp.visual} alt={nameOf(previewComp)} width={96} height={70} zoom={13} />
            <div class="body">
              <span class="addr">{nameOf(previewComp)}</span>
              <CompKindBadge identity={idOf(previewComp)} />
              <span class="role">
                {previewComp.valuationRole ? ROLE_TEXT[previewComp.valuationRole] : previewComp.categoryLabel}
                {photoCountOf(previewComp) > 1 && <> · {photoCountOf(previewComp)} photos</>}
              </span>
              {previewFacts(previewComp)}
              <span class="why">{previewComp.transactionKind === 'active'
                ? (previewComp.listing?.marketTime.freshnessLabel ?? 'Live competition for the same buyer; an asking price is never sold evidence.')
                : (previewComp.zeroWeightReason ?? previewComp.primaryComparability ?? previewComp.classificationReason)}</span>
            </div>
          </div>
        )}

        {/* ── Temporary cluster hover preview ── */}
        {clusterPreview && (
          <div class={`awv2-cv-hoverpreview cluster${clusterPreview.below ? ' below' : ''}`} role="tooltip" style={{ left: clusterPreview.left, top: clusterPreview.top }}>
            <div class="body">
              <span class="addr">{clusterPreview.items.length} records in this area</span>
              <span class="counts">
                <b>{clusterPreview.items.filter((i) => idOf(i).kind === 'closed').length}</b> closed comp
                {' · '}<b>{clusterPreview.items.filter((i) => idOf(i).kind === 'active').length}</b> active competitor
                {' · '}<b>{clusterPreview.items.filter((i) => !['closed', 'active'].includes(idOf(i).kind)).length}</b> other
              </span>
              <ul class="mini">
                {clusterPreview.items.slice(0, 6).map((c) => (
                  <li key={`mini-${c.key}`}>
                    <MarkerGlyph identity={idOf(c)} size={9} />
                    {nameOf(c)} · {usd(priceOf(c))}
                  </li>
                ))}
                {clusterPreview.items.length > 6 && <li class="more">+{clusterPreview.items.length - 6} more — click to list them all</li>}
              </ul>
            </div>
          </div>
        )}

        {!subjectPin && plottable.length === 0 && (
          <div class="awv2-cv-map-empty">
            No resolved locations in this filter. Records stay listed beside the map; nothing is placed at a guessed point.
          </div>
        )}
        <div class="awv2-cv-map-attrib">{basemapAttribution(basemap, v.zoom)}</div>
      </div>

      {overlayNotes.length > 0 && (
        <div class="awv2-cv-map-note" role="status">
          {overlayNotes.map((n) => <div key={n.id}>{n.text}</div>)}
        </div>
      )}

      <div class="awv2-cv-map-legend">
        <span><MarkerGlyph identity={COMP_IDENTITIES.subject} size={12} /> {COMP_IDENTITIES.subject.legend}</span>
        <span><MarkerGlyph identity={COMP_IDENTITIES.closed} size={12} /> {COMP_IDENTITIES.closed.legend}</span>
        <span><MarkerGlyph identity={COMP_IDENTITIES.active} size={12} /> {COMP_IDENTITIES.active.legend}</span>
        <span><MarkerGlyph identity={COMP_IDENTITIES.zeroWeight} size={12} /> {COMP_IDENTITIES.zeroWeight.legend}</span>
        <span><MarkerGlyph identity={COMP_IDENTITIES.improved} size={12} /> {COMP_IDENTITIES.improved.legend}</span>
        <span><MarkerGlyph identity={COMP_IDENTITIES.excluded} size={12} /> {COMP_IDENTITIES.excluded.legend}</span>
        <span class="dim">Numbered circles group nearby records — click one to list them.</span>
      </div>

      {/* ── Cluster popup: every clustered record is identified, never a silent zoom ── */}
      {clusterOpen && (
        <div class="awv2-cv-map-detail cluster" role="dialog" aria-label={`${clusterOpen.items.length} comparables in this area`}>
          <button type="button" class="close" aria-label="Close cluster list" onClick={() => setClusterOpen(null)}>✕</button>
          <div class="head">
            <b>{clusterOpen.items.length} comparables in this area</b>
            <span class="cat">
              {clusterOpen.items.filter((i) => idOf(i).kind === 'closed').length} closed valuation comp
              {' · '}{clusterOpen.items.filter((i) => idOf(i).kind === 'active').length} active competitor
              {' — select one to open its full details'}
            </span>
          </div>
          {clusterGroups(clusterOpen.items).map((g) => (
            <div class="awv2-cv-clustergroup" key={g.id}>
              <div class="gt">{g.title} <span class="n">{g.rows.length}</span></div>
              <ul class="awv2-cv-clusterlist">{g.rows.map(clusterRow)}</ul>
            </div>
          ))}
          <button type="button" class="awv2-cv-clusterzoom" onClick={() => { setView({ center: { lat: clusterOpen.lat, lng: clusterOpen.lng }, zoom: Math.min(19, Math.round(v.zoom + 2)) }); setClusterOpen(null); }}>
            Zoom in to separate these markers
          </button>
        </div>
      )}

      {/* ── Persistent pinned single-record popup ── */}
      {selected && !clusterOpen && (
        <div class={`awv2-cv-map-detail pinned kind-${idOf(selected).kind}`} role="dialog" aria-label={`Pinned comparable detail for ${nameOf(selected)}`}>
          <button type="button" class="close" aria-label="Close marker detail" onClick={() => onSelect(null)}>✕</button>
          <div class="awv2-cv-detailtop">
            <CompVisualThumb visual={selected.visual} alt={nameOf(selected)} width={148} height={108} />
            <div class="head">
              <b>{nameOf(selected)}</b>
              <CompKindBadge identity={idOf(selected)} />
              <span class="cat">{selected.categoryLabel}</span>
              {selected.inValuationSet
                ? <span class="inset">In the cleaned valuation set</span>
                : <span class="outset">Zero valuation weight</span>}
              {photoCountOf(selected) > 1 && <span class="prov">{photoCountOf(selected)} listing photos — open full details for the gallery</span>}
            </div>
          </div>
          {factRow(selected)}
          {/* The reconciliation behind this one marker: every provider that
              described the parcel, which LandPortal surfaces carried it, and
              how many provider rows were merged into it. */}
          <CompProvenanceBadges c={selected} className="awv2-cvd-sourcebadges" />
          {selected.listing?.price.confidence === 'estimated_proxy' && (
            <p class="awv2-cv-proxy" role="note">{selected.listing.price.amountLabel}: this is an estimate, not a verified sale price.</p>
          )}
          <p class="why">{selected.zeroWeightReason ?? selected.primaryComparability ?? selected.classificationReason}</p>
          <div class="awv2-cv-detailactions">
            {onOpenDetails && (
              <button type="button" onClick={() => onOpenDetails(selected.key)}>Open full comp details</button>
            )}
            {selected.sourceUrl && (
              <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={12} /> Open original listing
              </a>
            )}
            {actions?.onExclude && selected.inValuationSet && !selected.operatorExcluded && (
              <button type="button" class="exclude" disabled={actions.busyKey === selected.key} onClick={() => actions.onExclude!(selected)}>
                Exclude…
              </button>
            )}
            {actions?.onRestore && selected.operatorExcluded && (
              <button type="button" disabled={actions.busyKey === selected.key} onClick={() => actions.onRestore!(selected)}>
                Restore to valuation
              </button>
            )}
            {actions?.onInclude && selected.eligibleForValuation && !selected.inValuationSet && !selected.operatorExcluded && (
              <button type="button" disabled={actions.busyKey === selected.key} onClick={() => actions.onInclude!(selected)}>
                Include in valuation
              </button>
            )}
          </div>
        </div>
      )}

      {!expanded && unresolved.length > 0 && (
        <div class="awv2-cv-unresolved">
          <div class="t">Location unresolved — {unresolved.length} record{unresolved.length === 1 ? '' : 's'} not placed on the map (never guessed):</div>
          <ul>
            {unresolved.map((c) => (
              <li key={c.key}>
                <button type="button" class="awv2-cv-unresolvedrow" onClick={() => onSelect(c.key)} onPointerEnter={() => onHover(c.key)} onPointerLeave={() => onHover(null)}>
                  <MarkerGlyph identity={idOf(c)} size={10} />
                  {nameOf(c)} ({c.statusLabel}) — distance unavailable
                </button>
                {/* Every unresolved record says WHY it is unresolved. A missing
                    pin with no explanation reads as a broken map; the reason is
                    what makes "unresolved" an honest answer the operator can
                    act on. */}
                {c.locationUnresolvedReason && (
                  <div class="awv2-cv-unresolvedwhy">{c.locationUnresolvedReason}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── The map, inline and expanded ─────────────────────────────────────────────

export function CombinedCompMap({
  subject, comps, selectedKey, hoverKey, onSelect, onHover, onOpenDetails,
  onResolveLocations, resolving, resolutionNote, actions,
}: {
  subject: CvSubject;
  /** EXACTLY the filtered set the comp list is showing. */
  comps: CvComp[];
  selectedKey: string | null;
  hoverKey: string | null;
  onSelect: (key: string | null) => void;
  onHover: (key: string | null) => void;
  onOpenDetails?: (key: string) => void;
  onResolveLocations?: () => void;
  resolving?: boolean;
  resolutionNote?: string | null;
  actions?: CompMapActions;
}) {
  // Shared across both surfaces, so expanding never loses the operator's place.
  const [basemap, setBasemap] = useState<BasemapId>('road');
  const [overlays, setOverlays] = useState<Record<BoundaryLayerId, boolean>>({
    county: false, municipality: false, zcta: false,
  });
  const [boundaries, setBoundaries] = useState<Partial<Record<BoundaryLayerId, BoundaryFetchResult | 'loading'>>>({});
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<TransactionMode>('both');

  // The point the boundaries are asked about: the subject when LandOS knows
  // where it is, otherwise the first record that has a resolved location. A
  // boundary drawn around a guessed point would be a guessed boundary.
  const anchor: LatLng | null = useMemo(() => {
    if (subject.lat != null && subject.lng != null) return { lat: subject.lat, lng: subject.lng };
    const first = comps.find((c) => c.lat != null && c.lng != null);
    return first ? { lat: first.lat!, lng: first.lng! } : null;
  }, [subject.lat, subject.lng, comps]);

  // Each layer is fetched at most once per session, only after the operator asks
  // for it. Nothing is downloaded for an overlay that stays off.
  useEffect(() => {
    if (!anchor) return;
    for (const spec of BOUNDARY_LAYERS) {
      if (!overlays[spec.id] || boundaries[spec.id]) continue;
      setBoundaries((prev) => ({ ...prev, [spec.id]: 'loading' }));
      void fetchBoundaryLayer(spec.id, anchor).then((result) => {
        setBoundaries((prev) => ({ ...prev, [spec.id]: result }));
      });
    }
  }, [overlays, anchor]);

  const toggleOverlay = (id: BoundaryLayerId) => setOverlays((p) => ({ ...p, [id]: !p[id] }));

  // Escape closes the expanded map — the same key every overlay on the page uses.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const expandedComps = useMemo(() => comps.filter((c) => matchesTransactionMode(c, mode)), [comps, mode]);

  const shared = {
    subject, selectedKey, hoverKey, onSelect, onHover, onOpenDetails, actions,
    basemap, setBasemap, overlays, toggleOverlay, boundaries,
  };

  return (
    <>
      <MapSurface
        {...shared}
        comps={comps}
        expanded={false}
        controls={
          <button type="button" class="awv2-cv-expandbtn" onClick={() => setExpanded(true)}>
            <Maximize2 size={13} /> Expand map
          </button>
        }
      />

      {/* Unresolved records and the resolve action belong to the workspace, not
          to a transient inspection view, so they stay on the inline map only. */}
      {(onResolveLocations || resolutionNote) && (
        <div class="awv2-cv-map-resolve">
          {onResolveLocations && comps.some((c) => c.lat == null || c.lng == null) && (
            <button type="button" disabled={!!resolving} onClick={onResolveLocations}>
              {resolving ? 'Resolving locations…' : 'Resolve locations'}
            </button>
          )}
          {resolutionNote && <span role="status">{resolutionNote}</span>}
        </div>
      )}

      {/* Portalled to <body>. Rendered in place, the overlay stayed a descendant
          of the workspace section and the app's sticky sidebar painted over its
          left edge — a z-index of 200 cannot beat a sidebar of 50 when the two
          are compared inside different subtrees. A portal removes the question
          entirely rather than starting a z-index arms race with the shell. */}
      {expanded && createPortal(
        <div class="awv2 awv2-cv-expandwrap" role="dialog" aria-modal="true" aria-label="Expanded comparable map">
          <div class="awv2-cv-expandpanel">
            <div class="awv2-cv-expandhead">
              <div class="t">
                Expanded comparable map
                <span class="sub">
                  Same records, same selection, same filters as the workspace — {expandedComps.length} of {comps.length} shown
                </span>
              </div>
              <span class="awv2-cv-modes" role="group" aria-label="Transaction filter">
                {TRANSACTION_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    class={mode === m.id ? 'active' : ''}
                    aria-pressed={mode === m.id}
                    onClick={() => setMode(m.id)}
                  >{m.label}</button>
                ))}
              </span>
              <button type="button" class="awv2-cv-expandclose" onClick={() => setExpanded(false)}>
                <X size={14} /> Close expanded map
              </button>
            </div>
            <MapSurface {...shared} comps={expandedComps} expanded />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
