// Expanded map, boundary overlays, the duplicate-tooltip fix, and the gallery.
//
// The defects this locks down:
//   1. Hovering a marker produced TWO panels — the intended dark preview and the
//      browser's own native tooltip, which rendered as a long white strip across
//      the map. The native one came from `title` attributes, so the fix is that
//      no map element carries one, and the assertions here are negative on
//      purpose: a `title` re-added later is exactly the regression.
//   2. There was no way to inspect the map at size, and no way to look at closed
//      evidence and live competition separately.
//   3. There was no jurisdiction context at all — no county, municipality or ZIP
//      outline — so an operator could not see which comps shared the subject's
//      taxing and zoning authority.
//   4. A page publishing twelve photographs of a parcel surfaced one.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const MAP_SRC = read('web/src/components/AcquisitionWorkspaceV2CompMap.tsx');
const BOUND_SRC = read('web/src/lib/boundaries.ts');
const CAROUSEL_SRC = read('web/src/components/CompPhotoCarousel.tsx');
const D_SRC = read('web/src/components/AcquisitionWorkspaceV2CompDetails.tsx');
const CV_SRC = read('web/src/components/AcquisitionWorkspaceV2CompsValuation.tsx');
const THUMB_SRC = read('web/src/components/CompVisualThumb.tsx');
const CSS_SRC = read('web/src/styles/workspace-v2-comps.css');

describe('the redundant white tooltip is gone from every mapped record', () => {
  it('leaves no native title attribute anywhere on the map surface', () => {
    // One assertion covers closed comps, active listings, historical records,
    // improved context and every other mapped record, because they all render
    // through the same marker and cluster elements.
    expect(MAP_SRC).not.toMatch(/title=\{/);
    expect(MAP_SRC).not.toMatch(/title="/);
  });

  it('removed it from the visual chip the popups and cluster rows also render', () => {
    expect(THUMB_SRC).not.toMatch(/title=\{visual\.detail\}/);
    expect(THUMB_SRC).not.toMatch(/title=/);
  });

  it('keeps the accessible name, which was never the thing on screen', () => {
    expect(MAP_SRC).toMatch(/aria-label=\{`\$\{identity\.badge\}: \$\{nameOf\(c\)\}/);
    expect(MAP_SRC).toMatch(/aria-label=\{`\$\{cl\.items\.length\} comparables in this area/);
  });

  it('still renders the ONE intended hover preview', () => {
    expect(MAP_SRC).toMatch(/awv2-cv-hoverpreview/);
    expect(MAP_SRC).toMatch(/role="tooltip"/);
    expect(MAP_SRC).toMatch(/const leaveMarker = \(\) => \{ onHover\(null\); setPreview\(null\); \}/);
  });
});

describe('expanded map is a second VIEW of the same map, never a second map', () => {
  it('offers an Expand control and a modal that can be closed', () => {
    expect(MAP_SRC).toMatch(/Expand map/);
    expect(MAP_SRC).toMatch(/awv2-cv-expandwrap/);
    expect(MAP_SRC).toMatch(/role="dialog" aria-modal="true"/);
    expect(MAP_SRC).toMatch(/Close expanded map/);
    // Escape is the same dismissal every other overlay on the page uses.
    expect(MAP_SRC).toMatch(/if \(e\.key === 'Escape'\) setExpanded\(false\)/);
    // A modal, not browser fullscreen.
    expect(MAP_SRC).not.toMatch(/requestFullscreen/);
  });

  it('renders both surfaces from the SAME component and the same record set', () => {
    expect(MAP_SRC).toMatch(/function MapSurface\(/);
    expect((MAP_SRC.match(/<MapSurface/g) ?? [])).toHaveLength(2);
    // Selection, hover, basemap and overlays are held ABOVE both surfaces, so
    // expanding cannot lose the operator's place or disagree about a record.
    expect(MAP_SRC).toMatch(/const shared = \{/);
    expect(MAP_SRC).toMatch(/basemap, setBasemap, overlays, toggleOverlay, boundaries,/);
    expect(MAP_SRC).toMatch(/comps=\{expandedComps\}/);
  });

  it('filters closed, active and both without ever hiding the subject', () => {
    expect(MAP_SRC).toMatch(/export type TransactionMode = 'closed' \| 'active' \| 'both'/);
    for (const label of ['Closed sales', 'Active listings', 'Both']) {
      expect(MAP_SRC).toContain(label);
    }
    expect(MAP_SRC).toMatch(/function matchesTransactionMode\(c: CvComp, mode: TransactionMode\): boolean \{/);
    expect(MAP_SRC).toMatch(/if \(mode === 'both'\) return true/);
    expect(MAP_SRC).toMatch(/if \(mode === 'closed'\) return c\.transactionKind === 'closed'/);
    // The subject pin is drawn from `subject`, which the mode filter never touches.
    expect(MAP_SRC).toMatch(/const expandedComps = useMemo\(\(\) => comps\.filter\(\(c\) => matchesTransactionMode\(c, mode\)\)/);
    expect(MAP_SRC).toMatch(/const subjectPin = subject\.lat != null && subject\.lng != null/);
  });

  it('keeps Road and Aerial switching, and it is shared with the inline map', () => {
    expect(MAP_SRC).toMatch(/\{BASEMAPS\.map\(\(b\) => \(/);
    expect(MAP_SRC).toMatch(/onClick=\{\(\) => setBasemap\(b\.id\)\}/);
    expect(MAP_SRC).toMatch(/const \[basemap, setBasemap\] = useState<BasemapId>\('road'\)/);
    // Switching basemap must not disturb selection or filters: it is a separate
    // piece of state from both, so neither can be reset by it.
    expect(MAP_SRC).not.toMatch(/setBasemap\([\s\S]{0,60}onSelect\(null\)/);
  });

  it('gives the expanded surface its own Fit control over the visible records', () => {
    expect(MAP_SRC).toMatch(/\{expanded \? 'Fit visible records' : 'Fit'\}/);
    expect(CSS_SRC).toMatch(/\.awv2-cv-map\.expanded \.awv2-cv-map-canvas/);
  });
});

describe('boundary overlays are optional, honest and off by default', () => {
  it('starts every layer off', () => {
    expect(MAP_SRC).toMatch(/county: false, municipality: false, zcta: false/);
    // Nothing is fetched for a layer the operator did not ask for.
    expect(MAP_SRC).toMatch(/if \(!overlays\[spec\.id\] \|\| boundaries\[spec\.id\]\) continue/);
  });

  it('uses the existing renderer and a nationwide public source, with no new backend', () => {
    expect(BOUND_SRC).toMatch(/tigerweb\.geo\.census\.gov/);
    expect(BOUND_SRC).toMatch(/f: 'geojson'/);
    // Projected through the same slippy math the tiles and markers already use.
    expect(BOUND_SRC).toMatch(/import \{ lngToWorldX, latToWorldY, type LatLng \} from '\.\/slippy'/);
    expect(BOUND_SRC).toMatch(/export function ringToSvgPath\(/);
    // No proxy, no tile cache, no key.
    expect(BOUND_SRC).not.toMatch(/\/api\/landos/);
    expect(BOUND_SRC).not.toMatch(/apiKey|api_key|token=/);
  });

  it('keeps the payload small instead of loading nationwide geometry', () => {
    expect(BOUND_SRC).toMatch(/maxAllowableOffset/);
    expect(BOUND_SRC).toMatch(/const SIMPLIFY_DEGREES = 0\.002/);
    // Asked about ONE point — the subject — not about the viewport at world scale.
    expect(BOUND_SRC).toMatch(/geometryType: 'esriGeometryPoint'/);
  });

  it('distinguishes the layers by line style, not colour alone', () => {
    expect(BOUND_SRC).toMatch(/dash: ''/);
    expect(BOUND_SRC).toMatch(/dash: '10 6'/);
    expect(BOUND_SRC).toMatch(/dash: '3 5'/);
    expect(MAP_SRC).toMatch(/stroke-dasharray=\{spec\.dash \|\| undefined\}/);
  });

  it('labels the ZIP layer as a Census ZCTA and never as a USPS jurisdiction', () => {
    expect(BOUND_SRC).toMatch(/label: 'ZIP area \/ Census ZCTA'/);
    expect(BOUND_SRC).toMatch(/not a USPS jurisdiction boundary/);
    expect(BOUND_SRC).toMatch(/`ZIP area \$\{str\(r\.props\.BASENAME\) \?\? ''\} \/ Census ZCTA`/);
  });

  it('falls back to the governing county subdivision where no incorporated place exists', () => {
    // Most rural parcels sit in no incorporated place; an empty "City" layer
    // would read as a defect rather than as the fact that there is no city.
    expect(BOUND_SRC).toMatch(/countySubdivision:/);
    expect(BOUND_SRC).toMatch(/No incorporated place covers this location, so the Census county subdivision/);
    expect(BOUND_SRC).toMatch(/there is no incorporated place at this location/);
  });

  it('identifies a boundary by name on hover and on click', () => {
    expect(MAP_SRC).toMatch(/onPointerEnter=\{\(\) => setBoundaryLabel\(\{ name: f\.name, caption: f\.caption \}\)\}/);
    expect(MAP_SRC).toMatch(/onClick=\{\(\) => setBoundaryLabel\(\{ name: f\.name, caption: f\.caption \}\)\}/);
    expect(MAP_SRC).toMatch(/awv2-cv-boundary-label/);
  });

  it('draws under the markers so a county outline can never swallow a comp', () => {
    expect(CSS_SRC).toMatch(/\.awv2-cv-boundary-svg \{[^}]*z-index: 10/);
    expect(CSS_SRC).toMatch(/\.awv2-cv-boundary-svg \{[^}]*pointer-events: none/);
    // Only the stroke is interactive, so the polygon interior never eats a click.
    expect(CSS_SRC).toMatch(/\.awv2-cv-boundary-path \{[^}]*pointer-events: stroke/);
  });

  it('says when a layer could not be drawn instead of silently showing nothing', () => {
    expect(BOUND_SRC).toMatch(/Boundary unavailable: /);
    expect(MAP_SRC).toMatch(/loading the Census boundary…/);
    expect(MAP_SRC).toMatch(/const overlayNotes = BOUNDARY_LAYERS/);
  });

  it('is available on both surfaces, because the controls live above them', () => {
    expect(MAP_SRC).toMatch(/awv2-cv-map-overlays/);
    expect(MAP_SRC).toMatch(/overlays: Record<BoundaryLayerId, boolean>/);
    expect(MAP_SRC).toMatch(/toggleOverlay: \(id: BoundaryLayerId\) => void/);
  });
});

describe('geojson rings project to canvas paths', () => {
  it('reads Polygon and MultiPolygon outer rings and ignores anything else', () => {
    expect(BOUND_SRC).toMatch(/export function ringsFromGeoJson\(/);
    expect(BOUND_SRC).toMatch(/if \(g\.type === 'Polygon'\)/);
    expect(BOUND_SRC).toMatch(/if \(g\.type === 'MultiPolygon'\)/);
  });

  it('thins points to whole pixels so a county path stays short', () => {
    expect(BOUND_SRC).toMatch(/if \(x === lastX && y === lastY\) continue/);
  });
});

describe('the photo carousel shows the real gallery and never fakes one', () => {
  it('renders prev, next, an N of M counter and a thumbnail strip', () => {
    expect(CAROUSEL_SRC).toMatch(/aria-label="Previous photo"/);
    expect(CAROUSEL_SRC).toMatch(/aria-label="Next photo"/);
    expect(CAROUSEL_SRC).toMatch(/\$\{index \+ 1\} of \$\{total\}/);
    expect(CAROUSEL_SRC).toMatch(/awv2-cvd-gallerystrip/);
    expect(CAROUSEL_SRC).toMatch(/onClick=\{\(\) => setIndex\(i\)\}/);
  });

  it('names the provider and links the original page from the frame', () => {
    expect(CAROUSEL_SRC).toMatch(/current\.label/);
    expect(CAROUSEL_SRC).toMatch(/Open original listing/);
    expect(CAROUSEL_SRC).toMatch(/href=\{sourcePage\}/);
  });

  it('shows no navigation at all for a single photograph', () => {
    expect(CAROUSEL_SRC).toMatch(/\{total > 1 && \(/);
    expect(CAROUSEL_SRC).toMatch(/total > 1 \? `\$\{index \+ 1\} of \$\{total\}` : '1 photo'/);
  });

  it('states the honest fallback rather than borrowing another parcel photo', () => {
    expect(CAROUSEL_SRC).toMatch(/if \(total === 0\)/);
    expect(CAROUSEL_SRC).toMatch(/\{fallbackNote \?\? 'No genuine listing photograph is retained for this property\.'\}/);
    expect(CAROUSEL_SRC).toMatch(/another property's photo is never substituted/);
  });

  it('is wired into Full details as its own PHOTOS section', () => {
    expect(D_SRC).toMatch(/title="PHOTOS"/);
    expect(D_SRC).toMatch(/<CompPhotoCarousel/);
    expect(D_SRC).toMatch(/photos=\{p\?\.items \?\? \[\]\}/);
  });

  it('badges the collapsed card only when more than one genuine photo exists', () => {
    expect(CV_SRC).toMatch(/\(c\.listing\?\.photos\.count \?\? 0\) > 1/);
    expect(CV_SRC).toMatch(/\{c\.listing!\.photos\.count\} photos/);
    expect(CSS_SRC).toMatch(/\.awv2-cv-photocount/);
  });
});
