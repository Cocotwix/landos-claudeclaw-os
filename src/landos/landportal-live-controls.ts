// LandOS — LandPortal live-control catalog (proven 2026-07-30).
//
// Every selector and interaction below was PROVEN LIVE during the two directional
// trials (Deal 66: address search, Morgan County TN; Deal 68: APN search, Cayuga
// County NY) executed against the real authenticated LandPortal site on the
// paired Chrome. Nothing speculative is included. The operational runner that
// exercises these controls end-to-end is scripts/landportal/trial-runner.mjs.
//
// This module is the ONE tracked place recording the working DOM contract so it
// can never again live only in gitignored scratch scripts.

// ── Search widget (proven: Trials 1 + 2) ────────────────────────────────────
export const LP_SEARCH = {
  /** Wrapper carrying the active mode: address | parcelnumb | owner | coords. */
  wrapper: '.search-wr',
  wrapperModeAttr: 'data-searchtype',
  /** Click to open the search-type dropdown. */
  typeDropdownOpener: '.search-wr-dropdown .selected__option',
  /** Type options; select via aria-searchtype, never by visible text. */
  typeOption: 'li.search__option',
  typeOptionModeAttr: 'aria-searchtype',
  modes: { address: 'address', apn: 'parcelnumb', owner: 'owner', coords: 'coords' } as const,
  /** The single main input used by every mode. */
  input: '#main_search_input',
  /** APN/Owner state+county scoping: select2 widgets inside this wrapper, in
   *  order [state, county]. Open → type into .select2-search__field → click the
   *  matching .select2-results__option. (Same contract browser-session.ts uses.) */
  scopeWrapper: '.search-selects-wr',
  /** Result typeahead (address AND apn AND owner modes). Items carry
   *  data-county/data-state (+ data-lat/lng/placetype on address results).
   *  SELECT BY CLICKING the first <li>; pressing Enter is not equivalent. */
  resultsList: 'ul.search-variants',
  resultItem: 'li.search-variant',
  /** A parcel is open when the URL carries ?property=<base64 "fips=..&apn=..&propertyid=..">. */
  parcelUrlMarker: /[?&]property=/,
} as const;

// Proven behavioral facts that are NOT visible in the DOM contract:
export const LP_SEARCH_FACTS = [
  'Typed text alone never triggers the typeahead reliably; type with per-key delay and poll ul.search-variants.',
  'The address geocoder may normalize street names (submitted "Lillie Lane" → suggestion "Lillie Road"); the parcel record itself keeps the county wording.',
  'New York (Cayuga) parcels are indexed as "SWIS printkey" (e.g. "053889 75.00-1-24.11"); a county composite id like 053889-075-000-0001-024-011-0000 returns "Nothing found" until decoded.',
  'Owner search returns multi-parcel result lists; verify each row against the lead before selecting.',
] as const;

// ── Parcel sidebar extraction (proven: Trials 1 + 2, 73-74 rows) ───────────
export const LP_SIDEBAR = {
  /** Every fact row: label in .tab-row__title, value in .tab-row__value. */
  row: 'p.tab-row,.tab-row',
  rowTitle: '.tab-row__title',
  rowValue: '.tab-row__value',
  /** Section headings for grouping (walk previous siblings/ancestors). */
  sectionHeading: /tab-title|section__heading/i,
  /** "MLS Details" tab is disabled ⇒ no active/historical listing. */
  mlsDisabled: '.mls-tab__heading.disabled',
  /** Blank sidebar value sentinel. */
  blankValue: '-',
} as const;

// ── Map controls (proven: Trials 1 + 2) ─────────────────────────────────────
export const LP_MAP = {
  compass: 'button.lp-map-controls__compass',      // aria: Reset map rotation to north
  fit: 'button.lp-map-controls__fit',              // aria: Fit map to selection or reset view
  zoomIn: 'button[aria-label="Zoom in"]',
  zoomOut: 'button[aria-label="Zoom out"]',
  toggle3d: 'button.lp-map-controls__toggle3d',    // aria-pressed reflects state
  basemapsOpener: 'button.lp-map-controls__basemap', // aria: Basemaps and overlays
  canvas: 'canvas',
  /** Keyboard zoom on a focused canvas: '=' in, '-' out (~1 step each). */
  facts: [
    'REAL mouse clicks are required for the map control buttons; synthetic .click() is unreliable.',
    'Bearing rotation: Shift+Arrow keys silently no-op on some tab states; RIGHT-BUTTON horizontal drag always engages (~0.375°/px in 3D, roughly half that in 2D — iterate with visual checks).',
    'Screenshot the map by clipping the largest canvas rect and trimming ~40px of right-edge control rail; hide compact overlay buttons during capture and restore after.',
    'Overlay/3D frames must pass a sha-256 distinctness gate vs the base frame; identical bytes mean the layer never painted.',
  ],
} as const;

// ── Basemaps & Overlays panel (proven: Trials 1 + 2) ────────────────────────
// NOTE: the page ALSO contains a legacy hidden checkbox panel (.map-additional-wr,
// display:none) whose inputs flip without any map effect — driving it is the
// proven dead end. Only the visible lp-overlays panel works.
export const LP_OVERLAYS = {
  panel: '.lp-overlays__panel',
  close: 'button.lp-overlays__close',
  /** Toggle cards, addressed by exact aria-label "Enable X" / "Disable X". */
  card: 'button.lp-overlays__cardTop',
  provenNames: ['Parcel Boundaries', 'City Limits', 'County Boundaries', 'ZIP Boundaries', 'Contour Lines', 'FEMA Floodplain', 'Wetlands', 'Water Features', 'Transmission Lines', 'Soil Type'],
  deadEnd: '.map-additional-wr',
} as const;

// ── Comparables (proven: Trials 1 + 2) ──────────────────────────────────────
export const LP_COMPS = {
  /** Sidebar comp cards; identity + status live in data attributes, not text. */
  sidebarCard: '.lp-estimate-comparable-card',
  sidebarCardAttrs: ['data-apn', 'data-mlsstatus', 'data-propertyid', 'data-fips', 'data-mlspropertyid'],
  viewAllToggle: 'button.js-lp-estimate-toggle-comparables',
  /** Opens the market_comps result surface. REAL mouse click required; the
   *  surface may replace the current tab (Trial 1) OR open a NEW tab (Trial 2). */
  showOnMap: 'a.js-lp-estimate-show-on-map',
  resultUrlMarker: 'market_comps=',
  /** Each List View card carries full identity + address in data attributes:
   *  data-apn, data-mlsuuid, data-propertyid, data-fips, data-mlsurl,
   *  data-property-address/-city/-state/-zip. Text adds price, SqFt lot,
   *  MLS acres, sold date, sold-by. Thumbnails: element-screenshot the card
   *  <img> (cross-origin fetch of the image src is CORS-blocked). */
  listCardTextMarker: /MLS acres/i,
  facts: [
    'Sidebar and List View render the SAME APN in different formats ("053289 47.00-1-6" vs "053289A04700000010060000000"); reconcile on data-mlsuuid = sidebar data-mlspropertyid first, then price+acreage.',
    'A comp\'s own parcel page is reachable deterministically at /?property=base64("fips=F&apn=A&propertyid=P") with spaces as "+".',
  ],
} as const;

// ── Market research ─────────────────────────────────────────────────────────
// The browser Drill Deep surface (market-research/?template=drill-deep) froze the
// renderer repeatedly under CDP polling in both trials. Deal-level market
// synthesis therefore uses the NATIVE imported dataset (landos_mr_* tables,
// market-research-snapshots.ts) instead of live browser retrieval. The proven
// drill selectors remain documented in browser-playbook-landportal-market-live.ts
// (LP map) for the quarterly collector, which listens to admin-ajax JSON rather
// than polling the DOM.
export const LP_MARKET_NOTE =
  'Use the native LandOS Market Research dataset for deal synthesis; do not poll the live Drill Deep DOM per deal.' as const;

/** Parse a market_comps List View card's visible text (proven format). */
export function parseMarketCompsCardText(text: string): {
  price: number | null; sqftLot: number | null; mlsAcres: number | null;
  soldDate: string | null; soldBy: string | null; status: 'sold' | 'unknown';
} {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  const price = Number((t.match(/\$([\d,]+)/) ?? [])[1]?.replace(/,/g, '') ?? NaN);
  const sqft = Number((t.match(/([\d,]+)\s*SqFt lot/i) ?? [])[1]?.replace(/,/g, '') ?? NaN);
  const acres = Number((t.match(/([\d.]+)\s*MLS acres/i) ?? [])[1] ?? NaN);
  const soldDate = (t.match(/\b(\d{2}-\d{2}-\d{4})\b/) ?? [])[1] ?? null;
  const soldBy = (t.match(/\d{2}-\d{2}-\d{4}\s+(.+)$/) ?? [])[1]?.trim() ?? null;
  return {
    price: Number.isFinite(price) ? price : null,
    sqftLot: Number.isFinite(sqft) ? sqft : null,
    mlsAcres: Number.isFinite(acres) ? acres : null,
    soldDate, soldBy,
    status: /\bSold\b/i.test(t) ? 'sold' : 'unknown',
  };
}

/** Decode a NY county composite parcel id (SWIS+section+block+lot) into the
 *  "SWIS printkey" format LandPortal indexes, proven live on Cayuga County:
 *  053889-075-000-0001-024-011-0000 → "053889 75.00-1-24.11". Each 3-digit
 *  decimal group drops its leading pad digit ('000'→'00', '011'→'11'); the
 *  section keeps its ".00", a lot's ".00" is omitted ("47.00-1-6"). Returns
 *  null when the id is not the 7-group NY composite shape. */
export function nyCompositeToLandPortalApn(composite: string): string | null {
  const parts = (composite || '').trim().split('-');
  if (parts.length !== 7) return null;
  const [swis, section, sectionDec, block, lot, lotDec, suffix] = parts;
  if (!/^\d{6}$/.test(swis) || suffix !== '0000') return null;
  if (![section, sectionDec, lot, lotDec].every((g) => /^\d{3}$/.test(g)) || !/^\d{4}$/.test(block)) return null;
  const num = (s: string) => String(Number(s));
  const sectionKey = `${num(section)}.${sectionDec.slice(1)}`;
  const lotFrac = lotDec.slice(1);
  const lotKey = lotFrac === '00' ? num(lot) : `${num(lot)}.${lotFrac}`;
  return `${swis} ${sectionKey}-${num(block)}-${lotKey}`;
}
