// Combined comparable map — interaction contract.
//
// The defect this replaces: markers were hover-only curiosities, a cluster click
// silently zoomed with no record identification, and the map had its own toggle
// set that could disagree with the list's filter.
//
// Contract now:
//   • HOVER shows a TEMPORARY preview that disappears on pointer-out.
//   • CLICK opens a PERSISTENT pinned popup that survives the pointer leaving.
//   • Every cluster is clickable and lists its records BY GROUP (closed comps,
//     active competitors, zero-weight sales, improved and other context), so a
//     numbered circle can never hide what kind of evidence it holds.
//   • Selecting a clustered record opens its full popup and highlights its card.
//   • Selection and hover are bidirectional with the comp list, and the map
//     renders exactly the filtered set the list renders.
//   • Closed valuation evidence and active competition never share an identity.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const MAP_SRC = read('web/src/components/AcquisitionWorkspaceV2CompMap.tsx');
const CV_SRC = read('web/src/components/AcquisitionWorkspaceV2CompsValuation.tsx');
const ID_SRC = read('web/src/components/CompRecordIdentity.tsx');
const CSS_SRC = read('web/src/styles/workspace-v2-comps.css');

describe('every single marker is clickable and opens a persistent popup', () => {
  it('renders each marker as a button that selects the record', () => {
    expect(MAP_SRC).toMatch(/const markerDot = \(c: CvComp\) => \{/);
    expect(MAP_SRC).toMatch(/<button[\s\S]{0,700}onClick=\{\(e\) => \{ e\.stopPropagation\(\); pick\(c\); \}\}/);
    expect(MAP_SRC).toMatch(/aria-label=\{`\$\{identity\.badge\}: \$\{nameOf\(c\)\}\. Click for full comparable details\.`\}/);
    // Hover is an enhancement, never the only way to read a marker.
    expect(MAP_SRC).toMatch(/onPointerEnter=\{\(\) => enterMarker\(c, pos\)\}/);
  });

  it('keeps the pinned popup open until the operator closes it or picks another record', () => {
    // The popup is driven by the parent-owned selection, not by a transient
    // hover state, so panning or moving the pointer cannot dismiss it.
    expect(MAP_SRC).toMatch(/selectedKey: string \| null/);
    expect(MAP_SRC).toMatch(/\{selected && !clusterOpen && \(/);
    expect(MAP_SRC).toMatch(/aria-label="Close marker detail" onClick=\{\(\) => onSelect\(null\)\}/);
    expect(MAP_SRC).toMatch(/awv2-cv-map-detail pinned/);
    // Pointer-out clears ONLY the temporary preview, never the pinned popup.
    expect(MAP_SRC).toMatch(/const leaveMarker = \(\) => \{ onHover\(null\); setPreview\(null\); \}/);
    expect(MAP_SRC).not.toMatch(/onPointerLeave=\{\(\) => onSelect\(null\)/);
  });

  it('carries the required facts, the visual, provenance, and the actions', () => {
    for (const field of ['Role', 'Status', 'Distance', 'Radius stage', 'Acres',
      'Acreage vs subject', '\\$ / acre', 'Source']) {
      expect(MAP_SRC).toMatch(new RegExp(`<i>${field}</i>`));
    }
    expect(MAP_SRC).toMatch(/priceLabelOf\(c\)/);
    expect(MAP_SRC).toMatch(/Listing date' : 'Sale date/);
    expect(MAP_SRC).toMatch(/Cumulative active days' : 'Cumulative DOM/);
    expect(MAP_SRC).toMatch(/<CompVisualThumb visual=\{selected\.visual\}/);
    // The visual's provenance CHIP still rides on the thumbnail, but the long
    // provenance narrative is a retrieval diagnostic and no longer competes with
    // the sold price for the operator's attention inside the popup.
    expect(MAP_SRC).not.toMatch(/selected\.visual\.detail/);
    expect(MAP_SRC).toMatch(/Open full comp details/);
    expect(MAP_SRC).toMatch(/Open original listing/);
    expect(MAP_SRC).toMatch(/actions\?\.onExclude/);
    expect(MAP_SRC).toMatch(/actions\?\.onRestore/);
    expect(MAP_SRC).toMatch(/actions\?\.onInclude/);
    // Distance is never invented for an unresolved record.
    expect(MAP_SRC).toMatch(/Distance unavailable/);
  });

  it('labels an estimated price proxy inside the pinned popup', () => {
    expect(MAP_SRC).toMatch(/estimated_proxy/);
    expect(MAP_SRC).toMatch(/an estimate, not a verified sale price/);
  });
});

describe('hovering a marker shows a temporary preview', () => {
  it('opens a preview on pointer-enter and removes it on pointer-leave', () => {
    expect(MAP_SRC).toMatch(/const \[preview, setPreview\] = useState/);
    expect(MAP_SRC).toMatch(/const enterMarker = \(c: CvComp, pos: \{ left: number; top: number \}\) => \{/);
    expect(MAP_SRC).toMatch(/setPreview\(\{ key: c\.key, \.\.\.clampPreview\(pos, size\) \}\)/);
    expect(MAP_SRC).toMatch(/onPointerLeave=\{leaveMarker\}/);
    expect(MAP_SRC).toMatch(/awv2-cv-hoverpreview/);
    // A pinned record does not also render a hover preview over itself.
    expect(MAP_SRC).toMatch(/previewComp && previewComp\.key !== selectedKey/);
  });

  it('keeps the whole preview on the canvas instead of half-cutting it at an edge', () => {
    // A preview clipped by the map edge is worse than none: the operator sees a
    // truncated panel and cannot read the record they are pointing at.
    expect(MAP_SRC).toMatch(/function clampPreview\(pos: \{ left: number; top: number \}, size: \{ w: number; h: number \}\)/);
    expect(MAP_SRC).toMatch(/const below = pos\.top < PREVIEW_H \+ PREVIEW_GAP/);
    expect(MAP_SRC).toMatch(/preview!\.below \? ' below' : ''/);
    expect(CSS_SRC).toMatch(/\.awv2-cv-hoverpreview\.below \{ transform: translate\(-50%, 16px\); \}/);
    // The clamp trusts a fixed height, so the stylesheet must cap it to match.
    const h = /const PREVIEW_H = (\d+);/.exec(MAP_SRC);
    const css = /\.awv2-cv-hoverpreview \{[\s\S]*?max-height: (\d+)px/.exec(CSS_SRC);
    expect(h).toBeTruthy();
    expect(css).toBeTruthy();
    expect(Number(css![1])).toBe(Number(h![1]));
  });

  it('carries the condensed card hierarchy in the preview', () => {
    expect(MAP_SRC).toMatch(/const previewFacts = \(c: CvComp\) => \(/);
    for (const field of ['Distance', 'Acres', '\\$ / acre', 'Market time', 'Source']) {
      expect(MAP_SRC).toMatch(new RegExp(`<i>${field}</i>`));
    }
    expect(MAP_SRC).toMatch(/<CompVisualThumb visual=\{previewComp\.visual\}/);
    expect(MAP_SRC).toMatch(/<CompKindBadge identity=\{idOf\(previewComp\)\}/);
    expect(MAP_SRC).toMatch(/previewComp\.zeroWeightReason \?\? previewComp\.primaryComparability/);
  });

  it('never lets the preview swallow the click that pins the popup', () => {
    expect(CSS_SRC).toMatch(/\.awv2-cv-hoverpreview \{[\s\S]{0,600}pointer-events: none;/);
  });

  it('previews a cluster with its closed and active counts', () => {
    expect(MAP_SRC).toMatch(/const \[clusterPreview, setClusterPreview\] = useState/);
    expect(MAP_SRC).toMatch(/awv2-cv-hoverpreview cluster/);
    expect(MAP_SRC).toMatch(/records in this area/);
    expect(MAP_SRC).toMatch(/closed comp/);
    expect(MAP_SRC).toMatch(/active competitor/);
  });
});

describe('every cluster is clickable and identifies its records', () => {
  it('opens a cluster popup instead of silently zooming', () => {
    expect(MAP_SRC).toMatch(/setClusterOpen\(\{ lat: cl\.lat, lng: cl\.lng, items: cl\.items \}\)/);
    expect(MAP_SRC).toMatch(/comparables in this area: \$\{closedCount\} closed, \$\{activeCount\} active/);
    expect(MAP_SRC).toMatch(/\{clusterOpen && \(/);
    expect(MAP_SRC).toMatch(/comparables in this area<\/b>/);
    // Zooming is still available, but as an explicit choice inside the popup.
    expect(MAP_SRC).toMatch(/awv2-cv-clusterzoom/);
    expect(MAP_SRC).toMatch(/Zoom in to separate these markers/);
  });

  it('separates closed comps, active competitors and context inside the popup', () => {
    expect(MAP_SRC).toMatch(/const clusterGroups = \(items: CvComp\[\]\) => \{/);
    for (const title of ['Closed valuation comps', 'Active competitors',
      'Historical / zero-weight sales', 'Improved context', 'Other context', 'Excluded records']) {
      expect(MAP_SRC).toContain(title);
    }
    expect(MAP_SRC).toMatch(/clusterGroups\(clusterOpen\.items\)\.map\(\(g\) => \(/);
    expect(MAP_SRC).toMatch(/awv2-cv-clustergroup/);
  });

  it('lists every clustered record with its visual, badge and the required facts', () => {
    expect(MAP_SRC).toMatch(/const clusterRow = \(c: CvComp\) => \(/);
    expect(MAP_SRC).toMatch(/<CompVisualThumb visual=\{c\.visual\}[\s\S]{0,140}width=\{64\}/);
    expect(MAP_SRC).toMatch(/<CompKindBadge identity=\{idOf\(c\)\}/);
    expect(MAP_SRC).toMatch(/ROLE_TEXT\[c\.valuationRole\] : c\.categoryLabel/);
    expect(MAP_SRC).toMatch(/distance unavailable/);
    expect(MAP_SRC).toMatch(/c\.acres \?\? '—'/);
    expect(MAP_SRC).toMatch(/usd\(priceOf\(c\)\)/);
    expect(MAP_SRC).toMatch(/usd\(ppaOf\(c\)\)/);
    expect(MAP_SRC).toMatch(/marketTimeText\(c\)/);
  });

  it('opens the full popup for a record selected inside a cluster', () => {
    expect(MAP_SRC).toMatch(/class="awv2-cv-clusterrow"\s*\n\s*onClick=\{\(\) => pick\(c\)\}/);
    // pick() closes the cluster list and selects the record, which drives both
    // the single-record popup and the matching card highlight.
    expect(MAP_SRC).toMatch(/const pick = \(c: CvComp\) => \{ setClusterOpen\(null\); setPreview\(null\); onSelect\(c\.key\); \}/);
  });
});

describe('closed evidence and active competition never share an identity', () => {
  it('gives every kind its own SHAPE, not just its own colour', () => {
    expect(ID_SRC).toMatch(/subject:[\s\S]{0,120}shape: 'diamond'/);
    expect(ID_SRC).toMatch(/closed:[\s\S]{0,120}shape: 'circle'/);
    expect(ID_SRC).toMatch(/active:[\s\S]{0,120}shape: 'square'/);
    expect(ID_SRC).toMatch(/zeroWeight:[\s\S]{0,120}shape: 'circle'/);
    expect(ID_SRC).toMatch(/improved:[\s\S]{0,120}shape: 'triangle'/);
    expect(ID_SRC).toMatch(/excluded:[\s\S]{0,120}shape: 'cross'/);
    for (const shape of ['circle', 'square', 'diamond', 'triangle', 'cross']) {
      expect(CSS_SRC).toContain(`.awv2-cv-glyph.shape-${shape}`);
    }
  });

  it('badges each kind unmistakably', () => {
    expect(ID_SRC).toMatch(/badge: 'CLOSED SALE'/);
    expect(ID_SRC).toMatch(/badge: 'ACTIVE COMPETITOR'/);
    expect(ID_SRC).toMatch(/badge: 'ZERO-WEIGHT SALE'/);
    expect(ID_SRC).toMatch(/badge: 'EXCLUDED'/);
  });

  it('reads live competition BEFORE valuation membership so it can never be mistaken for evidence', () => {
    expect(ID_SRC).toMatch(/if \(c\.operatorExcluded\) return COMP_IDENTITIES\.excluded;[\s\S]{0,200}transactionKind === 'active'/);
    expect(ID_SRC).toMatch(/if \(c\.inValuationSet\) return COMP_IDENTITIES\.closed;/);
  });

  it('uses the same identity in markers, previews, popups, clusters, cards, filters and legend', () => {
    expect(MAP_SRC).toMatch(/<MarkerGlyph identity=\{identity\} size=\{identity\.size \+ grow\}/); // markers
    expect(MAP_SRC).toMatch(/<CompKindBadge identity=\{idOf\(previewComp\)\}/);                    // hover preview
    expect(MAP_SRC).toMatch(/<CompKindBadge identity=\{idOf\(selected\)\}/);                        // pinned popup
    expect(MAP_SRC).toMatch(/<CompKindBadge identity=\{idOf\(c\)\}/);                               // cluster rows
    expect(MAP_SRC).toMatch(/COMP_IDENTITIES\.closed\.legend/);                                     // legend
    expect(CV_SRC).toMatch(/<CompKindBadge identity=\{identity\}/);                                 // cards
    expect(CV_SRC).toMatch(/f\.identity && <MarkerGlyph identity=\{f\.identity\}/);                 // filters
    expect(CV_SRC).toMatch(/class=\{`awv2-cv-card kind-\$\{identity\.kind\}/);
  });
});

describe('base map layers', () => {
  it('keeps Road as the default and adds a nationwide aerial option', () => {
    const SLIPPY = read('web/src/lib/slippy.ts');
    expect(SLIPPY).toMatch(/id: 'road'/);
    expect(SLIPPY).toMatch(/id: 'aerial'/);
    expect(SLIPPY).toMatch(/basemap\.nationalmap\.gov\/arcgis\/rest\/services\/USGSImageryOnly/);
    // ArcGIS MapServer tile paths are {z}/{row}/{col} — that is {z}/{y}/{x}.
    expect(SLIPPY).toMatch(/MapServer\/tile\/\$\{t\.z\}\/\$\{t\.y\}\/\$\{t\.x\}/);
    // No key, no account, no proxy, no cache: it is requested directly.
    expect(SLIPPY).not.toMatch(/apiKey|api_key|access_token|\/proxy\//);
    expect(MAP_SRC).toMatch(/useState<BasemapId>\('road'\)/);
    expect(MAP_SRC).toMatch(/basemapTileUrl\(t, basemap\)/);
    expect(MAP_SRC).toMatch(/awv2-cv-map-layers/);
  });

  it('attributes whichever layer is displayed', () => {
    expect(MAP_SRC).toMatch(/basemapAttribution\(basemap, v\.zoom\)/);
    const SLIPPY = read('web/src/lib/slippy.ts');
    expect(SLIPPY).toMatch(/© OpenStreetMap contributors/);
    expect(SLIPPY).toMatch(/USGS The National Map \(public domain\)/);
  });

  it('discloses the aerial coverage gap instead of quietly showing a road map', () => {
    // USGS ImageryOnly 404s past z16, so the road tile is drawn there. Leaving
    // the "Aerial" attribution in place would let the operator believe they are
    // looking at imagery of the parcel when they are looking at a road map.
    const SLIPPY = read('web/src/lib/slippy.ts');
    expect(SLIPPY).toMatch(/export const AERIAL_MAX_ZOOM = 16;/);
    expect(SLIPPY).toMatch(/if \(t\.z > AERIAL_MAX_ZOOM\) return osmTileUrl\(t\);/);
    expect(SLIPPY).toMatch(/Aerial imagery ends at zoom \$\{AERIAL_MAX_ZOOM\} — showing the road map at this zoom/);
  });
});

describe('list and map stay synchronized in both directions', () => {
  it('highlights and reveals the matching card when a marker is clicked', () => {
    expect(CV_SRC).toMatch(/const selectFromMap = \(key: string \| null\) => \{/);
    expect(CV_SRC).toMatch(/document\.getElementById\(cardDomId\(key\)\)\?\.scrollIntoView/);
    expect(CV_SRC).toMatch(/onSelect=\{selectFromMap\}/);
    expect(CV_SRC).toMatch(/selectedKey === c\.key \? ' active' : ''/);
    // Opening a record from the map must not reset the working filter.
    expect(CV_SRC).not.toMatch(/selectFromMap[\s\S]{0,200}setFilter\(/);
  });

  it('centres and highlights the matching marker when a card is selected', () => {
    expect(MAP_SRC).toMatch(/\/\/ Card → map/);
    expect(MAP_SRC).toMatch(/useEffect\(\(\) => \{[\s\S]{0,500}\}, \[selectedKey\]\)/);
    expect(MAP_SRC).toMatch(/center: \{ lat: selected\.lat!, lng: selected\.lng! \}/);
    expect(MAP_SRC).toMatch(/isSelected \? 10 : isHover \? 6 : 0/);
  });

  it('opens the pinned popup from a card "Show on map"', () => {
    // Show on map routes through the SAME selection the marker click uses, so
    // the popup that opens is the identical pinned popup.
    expect(CV_SRC).toMatch(/onClick=\{\(e\) => \{ e\.stopPropagation\(\); selectFromMap\(c\.key\); \}\}[\s\S]{0,80}Show on map/);
    expect(MAP_SRC).toMatch(/\{selected && !clusterOpen && \(/);
  });

  it('emphasises the counterpart on hover in both directions', () => {
    expect(CV_SRC).toMatch(/onPointerEnter=\{\(\) => setHoverKey\(c\.key\)\}/);
    expect(CV_SRC).toMatch(/hoverKey === c\.key \? ' hovered' : ''/);
    expect(CV_SRC).toMatch(/onHover=\{setHoverKey\}/);
    expect(MAP_SRC).toMatch(/const isHover = c\.key === hoverKey/);
  });

  it('drops the map-only toggle set so it can never disagree with the filter', () => {
    expect(MAP_SRC).not.toMatch(/TOGGLE_SPEC/);
    expect(MAP_SRC).not.toMatch(/DEFAULT_TOGGLES/);
    expect(MAP_SRC).not.toMatch(/awv2-cv-map-toggle/);
    // It states what it is showing against the filtered set it was handed.
    expect(MAP_SRC).toMatch(/Showing <b>\{plottable\.length\}<\/b> of <b>\{comps\.length\}<\/b> record/);
  });

  it('keeps unresolved records listed, selectable, and never plotted', () => {
    expect(MAP_SRC).toMatch(/const unresolved = useMemo\(\(\) => comps\.filter\(\(c\) => c\.lat == null \|\| c\.lng == null\)/);
    expect(MAP_SRC).toMatch(/const plottable = useMemo\(\(\) => comps\.filter\(\(c\) => c\.lat != null && c\.lng != null\)/);
    expect(MAP_SRC).toMatch(/not placed on the map \(never guessed\)/);
    expect(MAP_SRC).toMatch(/awv2-cv-unresolvedrow" onClick=\{\(\) => onSelect\(c\.key\)\}/);
  });
});
