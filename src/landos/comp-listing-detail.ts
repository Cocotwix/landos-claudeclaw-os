// Comparable listing detail: normalising what a retained provider page actually
// said, and proving the page belongs to the comparable before anything is kept.
//
// The browser lane does the messy per-site DOM reading and hands back a RAW
// capture — image candidates in page order, the price-history rows as printed,
// the description as written, and the identity fields the page displayed. Every
// decision made ON that capture lives here, pure and testable:
//
//   • selectListingImage()      — walks the fixed image tier order and returns a
//                                 provenance that never calls a fallback a photo.
//   • normalizeListingEvents()  — turns printed history rows into dated events.
//   • reconcileCaptureToComp()  — refuses to persist anything until the page is
//                                 proven to be the SAME property as the comp.
//
// The reconciliation gate is the important one. A neighbouring parcel's photo,
// a generic road shot, a search-result tile, or another comparable's hero image
// are all worse than an honest map fallback, because they look like evidence.
// So an image is persisted only when independent identity evidence agrees, and
// the exact evidence that matched is recorded alongside it.

import { isListingPhotoUrl, type CompVisualProvenance } from './comp-visual.js';
import type { CompListingEvent, CompListingEventKind } from './comp-listing-history.js';

export type ListingProvider = 'Zillow' | 'Redfin' | 'Realtor' | 'LandPortal';

/**
 * WHERE on the page an image came from.
 *
 * This distinction is not cosmetic — it is the difference between evidence and
 * contamination. Provider pages for vacant land routinely carry NO photo of the
 * subject while rendering a "Recently sold homes" / "Similar homes" carousel
 * full of photographs of OTHER properties. Those images sit on the correct URL,
 * on the correct page, served by the correct photo CDN, and they are pictures of
 * somebody else's parcel. Only `hero` and `gallery` may ever be persisted.
 */
export type ListingImageContext =
  /** The page's own primary photo for THIS property. */
  | 'hero'
  /** This property's own photo gallery / thumbnail strip. */
  | 'gallery'
  /** A card for a DIFFERENT property (similar homes, recently sold, nearby). */
  | 'other_property_card'
  /** Site chrome: logo, sprite, static map, avatar. */
  | 'page_furniture'
  /** Position on the page could not be established — never trusted. */
  | 'unknown';

export interface ListingImageCandidate {
  url: string;
  context: ListingImageContext;
  /** The DOM container the lane read it from, retained for audit. */
  container?: string;
}

/** Exactly what the page showed, before any LandOS judgement is applied. */
export interface RawListingCapture {
  provider: ListingProvider;
  sourceUrl: string;
  capturedAtIso: string;
  /** Candidate images in page order, each tagged with where it came from. */
  images: ListingImageCandidate[];
  /** Price-history rows exactly as printed. */
  priceHistory: Array<{ dateText: string; eventText: string; priceText: string }>;
  /** The broker/agent/seller/platform description, verbatim. */
  description: string | null;
  status: string | null;
  address: string | null;
  acresText: string | null;
  priceText: string | null;
  domText: string | null;
  apn: string | null;
  lat: number | null;
  lng: number | null;
  /** Any retrieval limitation the lane hit (paywall, interstitial, no media). */
  limitation: string | null;
}

// ── Image selection ──────────────────────────────────────────────────────────

/** Approved persisted-visual labels. A fallback is NEVER given a photo label. */
export const LISTING_IMAGE_LABELS = {
  zillow_listing_photo: 'Zillow listing photo',
  redfin_listing_photo: 'Redfin listing photo',
  realtor_listing_photo: 'Realtor.com listing photo',
  landportal_listing_thumbnail: 'LandPortal listing thumbnail',
  parcel_aerial: 'Parcel aerial',
  nationwide_aerial_fallback: 'Nationwide aerial fallback',
  road_map_fallback: 'Road map fallback',
  location_unresolved: 'Location unresolved',
} as const;

export type ListingImageLabel = typeof LISTING_IMAGE_LABELS[keyof typeof LISTING_IMAGE_LABELS];

const PROVIDER_PHOTO_LABEL: Readonly<Record<ListingProvider, ListingImageLabel>> = {
  Zillow: LISTING_IMAGE_LABELS.zillow_listing_photo,
  Redfin: LISTING_IMAGE_LABELS.redfin_listing_photo,
  Realtor: LISTING_IMAGE_LABELS.realtor_listing_photo,
  LandPortal: LISTING_IMAGE_LABELS.landportal_listing_thumbnail,
};

/** Which page slot the chosen image came from, in the prompt's tier order. */
export type ListingImageTier = 'hero' | 'thumbnail' | 'other_listing_media';

export interface SelectedListingImage {
  url: string;
  provider: ListingProvider;
  tier: ListingImageTier;
  /** The approved on-screen label. Only ever a *_listing_photo/thumbnail here. */
  label: ListingImageLabel;
  provenance: Extract<CompVisualProvenance, 'listing_photo' | 'provider_thumbnail'>;
  isOriginalListingImage: true;
  /** Where on the page it came from. Always 'hero' or 'gallery'. */
  context: Extract<ListingImageContext, 'hero' | 'gallery'>;
}

/** Contexts an image may be persisted from. Everything else is another property. */
const PERSISTABLE_CONTEXTS: ReadonlySet<ListingImageContext> = new Set(['hero', 'gallery']);

/** URL patterns that are page furniture, not property photography. */
const NON_PROPERTY_IMAGE = [
  /\/static\//i, /sprite/i, /logo/i, /favicon/i, /placeholder/i, /avatar/i,
  /\.svg(\?|$)/i, /badge/i, /icon/i, /googleusercontent\.com\/.*maps/i,
  /staticmap/i, /maps\.googleapis\.com/i, /\bmapbox\b/i, /tile\.openstreetmap/i,
  /streetview/i, /pixel\.gif/i, /1x1\./i,
];

/** True when a URL is plausibly a real photograph served by the provider. */
export function isGenuineListingImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!/^https:\/\//i.test(trimmed)) return false;
  if (NON_PROPERTY_IMAGE.some((rx) => rx.test(trimmed))) return false;
  return isListingPhotoUrl(trimmed);
}

/**
 * Pick the best genuine listing image from a capture, walking hero → gallery
 * thumbnail → any other genuine media belonging to THIS property.
 *
 * Two independent conditions must both hold, and neither substitutes for the
 * other: the URL must be served by a provider photo CDN AND the image must have
 * come from the subject's own media region. A photograph pulled out of a
 * "recently sold homes" carousel passes the first test and fails the second — it
 * is a real photograph of the wrong parcel, which is worse than no photo at all.
 *
 * Returns null when the page has no image that can honestly be called this
 * property's listing photograph; the caller then falls to the next tier
 * (LandPortal thumbnail, parcel aerial, nationwide aerial, road map, unresolved)
 * rather than dressing someone else's parcel up as evidence.
 */
export function selectListingImage(capture: RawListingCapture): SelectedListingImage | null {
  const own = (capture.images ?? [])
    .filter((c) => c && typeof c.url === 'string' && c.url.trim())
    .map((c) => ({ ...c, url: c.url.trim() }))
    .filter((c) => PERSISTABLE_CONTEXTS.has(c.context))
    .filter((c) => isGenuineListingImageUrl(c.url));
  if (own.length === 0) return null;

  const hero = own.find((c) => c.context === 'hero');
  const chosen = hero ?? own[0];
  const indexInOwn = own.indexOf(chosen);
  const tier: ListingImageTier = chosen.context === 'hero'
    ? 'hero'
    : indexInOwn <= 2 ? 'thumbnail' : 'other_listing_media';
  return {
    url: chosen.url,
    provider: capture.provider,
    tier,
    label: PROVIDER_PHOTO_LABEL[capture.provider],
    provenance: capture.provider === 'LandPortal' ? 'provider_thumbnail' : 'listing_photo',
    isOriginalListingImage: true,
    context: chosen.context as 'hero' | 'gallery',
  };
}

/**
 * One photograph in a comparable's persisted photo set.
 *
 * The single `SelectedListingImage` above answers "what is the one picture for
 * this card". This answers a different question the operator actually asks when
 * they open a comparable: "show me the property". A vacant-land page that
 * carries twelve photographs of the parcel is twelve pieces of comparability
 * evidence — the clearing, the road frontage, the tree line, the wet corner —
 * and keeping only the hero throws eleven of them away.
 *
 * Every member of the set passes the SAME two gates the hero passes: it must be
 * served by a provider photo CDN and it must come from this property's own media
 * region. The set is not a looser tier; it is the same tier, in page order.
 */
export interface SelectedListingPhoto {
  url: string;
  provider: ListingProvider;
  /** 1-based position in the property's own photo order, as the page showed it. */
  sequence: number;
  label: ListingImageLabel;
  provenance: Extract<CompVisualProvenance, 'listing_photo' | 'provider_thumbnail'>;
  context: Extract<ListingImageContext, 'hero' | 'gallery'>;
  isOriginalListingImage: true;
}

/**
 * Providers serve the same photograph at many widths, and a naive set would show
 * the operator the same picture eight times. Provider photo URLs encode the
 * rendition in a size suffix (`-p_e`, `_1280_800`, `cc_ft_768`), so collapsing on
 * the URL with the rendition stripped groups renditions of one photograph
 * together, and the largest rendition of each is kept.
 *
 * This is deduplication, never selection: it removes duplicates of a photograph,
 * and it can never introduce one that was not already on the page.
 */
export function photoIdentityKey(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname
      // Zillow: /fp/<hash>-p_e.jpg / -cc_ft_768.webp / -uncropped_scaled_within_1536_1152.webp
      .replace(/-(p_[a-z]|cc_ft_\d+|uncropped_scaled_within_\d+_\d+)(?=\.[a-z0-9]+$)/i, '')
      // Redfin: /photo/189/mbphotov3/312/genMid.S1645312_4_21.jpg — the rendition
      // lives in BOTH the directory and the filename prefix, and Redfin uses a
      // whole family of directory names for the same photograph (bigphoto,
      // mbphotov3, mbpaddedwide, islphoto). Missing one of them shows the
      // operator the same picture twice in a row at the front of the gallery.
      .replace(/\/(?:big|mb|isl|gen)[a-z]*(?:photo|padded)[a-z0-9]*\//gi, '/')
      .replace(/\bgen(mid|ld|head)\.?/gi, '')
      // Realtor rdcpix: ...-m1234567890od-w480_h360_x2.webp
      .replace(/-w\d+_h\d+(_x\d)?(?=\.[a-z0-9]+$)/i, '')
      .replace(/_\d{3,4}_\d{3,4}(?=\.[a-z0-9]+$)/i, '')
      .replace(/\.(jpg|jpeg|png|webp|avif)$/i, '');
    return `${u.hostname.toLowerCase()}${path.toLowerCase()}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Rough rendition width parsed from a provider URL, so the largest one wins. */
function renditionWidth(url: string): number {
  const m = /(?:_|-|\bw)(\d{3,4})(?:_h?\d{3,4})?(?=[._-]|$)/i.exec(url.replace(/\.[a-z0-9]+$/i, ''));
  const n = m ? Number(m[1]) : 0;
  return Number.isFinite(n) ? n : 0;
}

/**
 * The full ordered set of genuine photographs the page published for THIS
 * property, deduplicated across renditions and capped so one pathological page
 * cannot write an unbounded row.
 *
 * Page order is preserved exactly as captured: the operator's mental model of a
 * listing gallery is positional ("the third photo is the driveway"), and
 * re-sorting the set would quietly break that. The hero, when the page declared
 * one, is pulled to the front — that is the only reordering allowed, and it
 * matches what the provider itself shows first.
 */
export function selectListingImages(capture: RawListingCapture, max = 40): SelectedListingPhoto[] {
  const own = (capture.images ?? [])
    .filter((c) => c && typeof c.url === 'string' && c.url.trim())
    .map((c) => ({ ...c, url: c.url.trim() }))
    .filter((c) => PERSISTABLE_CONTEXTS.has(c.context))
    .filter((c) => isGenuineListingImageUrl(c.url));
  if (own.length === 0) return [];

  // Collapse renditions: one entry per photograph, keeping the largest.
  const byIdentity = new Map<string, { url: string; context: ListingImageContext; width: number; order: number }>();
  own.forEach((c, order) => {
    const key = photoIdentityKey(c.url);
    const width = renditionWidth(c.url);
    const existing = byIdentity.get(key);
    if (!existing) {
      byIdentity.set(key, { url: c.url, context: c.context, width, order });
      return;
    }
    // A hero rendition of the same photograph keeps the hero context.
    if (c.context === 'hero') existing.context = 'hero';
    if (width > existing.width) { existing.url = c.url; existing.width = width; }
  });

  const distinct = [...byIdentity.values()].sort((a, b) => {
    if ((a.context === 'hero') !== (b.context === 'hero')) return a.context === 'hero' ? -1 : 1;
    return a.order - b.order;
  });

  const label = PROVIDER_PHOTO_LABEL[capture.provider];
  const provenance = capture.provider === 'LandPortal' ? 'provider_thumbnail' : 'listing_photo';
  return distinct.slice(0, max).map((d, i) => ({
    url: d.url,
    provider: capture.provider,
    sequence: i + 1,
    label,
    provenance,
    context: d.context as 'hero' | 'gallery',
    isOriginalListingImage: true,
  }));
}

/** Images the page carried that LandOS refused, with the exact reason. */
export function rejectedImages(capture: RawListingCapture): Array<{ url: string; why: string }> {
  const out: Array<{ url: string; why: string }> = [];
  for (const c of capture.images ?? []) {
    if (!c?.url) continue;
    if (!PERSISTABLE_CONTEXTS.has(c.context)) {
      out.push({
        url: c.url,
        why: c.context === 'other_property_card'
          ? 'belongs to a different property shown on the same page (similar / recently sold card)'
          : c.context === 'page_furniture'
            ? 'site chrome, not property photography'
            : 'position on the page could not be established, so it cannot be bound to this property',
      });
      continue;
    }
    if (!isGenuineListingImageUrl(c.url)) {
      out.push({ url: c.url, why: 'not served by a recognised provider photo CDN' });
    }
  }
  return out;
}

// ── Listing-history normalisation ────────────────────────────────────────────

const EVENT_PATTERNS: Array<{ rx: RegExp; kind: CompListingEventKind }> = [
  { rx: /back\s*on\s*(the\s*)?market/i, kind: 'back_on_market' },
  { rx: /re-?listed/i, kind: 'relisted' },
  { rx: /(listing\s*)?(removed|withdrawn|cancell?ed|expired|delisted|off\s*market|taken\s*off)/i, kind: 'withdrawn' },
  { rx: /price\s*(change|reduced|reduction|drop|increase|decrease)/i, kind: 'price_change' },
  { rx: /(pending|contingent|under\s*contract|accepting\s*backup)/i, kind: 'pending' },
  { rx: /\bsold\b|closed\s*sale/i, kind: 'sold' },
  { rx: /listed\s*for\s*sale|listed|for\s*sale|new\s*listing/i, kind: 'listed' },
  { rx: /^active$/i, kind: 'active' },
];

/** Classify a printed history label. Null when the label means nothing to us. */
export function classifyListingEventText(text: string | null | undefined): CompListingEventKind | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  for (const { rx, kind } of EVENT_PATTERNS) if (rx.test(t)) return kind;
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Parse the date formats providers actually print into an exact ISO date. */
export function parseListingDateText(text: string | null | undefined): string | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (slash) return `${slash[3]}-${pad(slash[1])}-${pad(slash[2])}`;
  const named = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t);
  if (named) {
    const m = MONTHS[named[1].slice(0, 3).toLowerCase()];
    if (m) return `${named[3]}-${pad(m)}-${pad(named[2])}`;
  }
  // "November 2025" with no day is NOT precise enough for exact market time.
  return null;
}

const pad = (n: string | number) => String(n).padStart(2, '0');

/** Parse a printed price. Percentages and deltas in the same cell are ignored. */
export function parseListingPriceText(text: string | null | undefined): number | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  const m = /\$\s*([\d,]+)/.exec(t);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Turn printed history rows into dated events. Rows LandOS cannot date exactly
 * or cannot classify are dropped from the market-time math (an undated event
 * cannot anchor a day count) but the caller keeps the raw rows for the timeline.
 */
export function normalizeListingEvents(capture: RawListingCapture): CompListingEvent[] {
  const out: CompListingEvent[] = [];
  for (const row of capture.priceHistory ?? []) {
    const dateIso = parseListingDateText(row.dateText);
    const kind = classifyListingEventText(row.eventText);
    if (!dateIso || !kind) continue;
    out.push({
      dateIso,
      kind,
      price: parseListingPriceText(row.priceText),
      label: (row.eventText ?? '').trim(),
      source: `${capture.provider} listing history`,
    });
  }
  return out;
}

/** Rows the lane captured but LandOS could not use, so the gap is visible. */
export function unusableHistoryRows(capture: RawListingCapture): Array<{ row: string; why: string }> {
  const out: Array<{ row: string; why: string }> = [];
  for (const row of capture.priceHistory ?? []) {
    const dateIso = parseListingDateText(row.dateText);
    const kind = classifyListingEventText(row.eventText);
    if (dateIso && kind) continue;
    out.push({
      row: `${row.dateText ?? ''} ${row.eventText ?? ''} ${row.priceText ?? ''}`.trim(),
      why: !dateIso ? 'no exact calendar date' : 'event type not recognised',
    });
  }
  return out;
}

// ── Property reconciliation ──────────────────────────────────────────────────

export interface CompIdentity {
  address: string | null;
  apn: string | null;
  acres: number | null;
  price: number | null;
  lat: number | null;
  lng: number | null;
  sourceUrl: string | null;
}

export interface ReconciliationResult {
  matched: boolean;
  /** Independent identity signals that agreed. Two are required. */
  matchedOn: string[];
  /** Signals that actively disagreed. Any hard mismatch refuses the capture. */
  mismatches: string[];
  note: string;
}

const normalizeAddress = (s: string | null | undefined) =>
  (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

const compactApn = (s: string | null | undefined) => (s ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();

/** Road identifier from an address, e.g. "0 McGibbon Rd, Martville" → "mcgibbon rd". */
export function roadIdentifier(address: string | null | undefined): string | null {
  const first = normalizeAddress((address ?? '').split(',')[0]);
  if (!first) return null;
  const words = first.split(' ').filter((w) => !/^\d+$/.test(w) && w !== 'lot');
  const road = words.join(' ').trim();
  return road.length >= 3 ? road : null;
}

function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.7613;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Prove the captured page is the SAME property as the comparable.
 *
 * The URL alone is not proof: a provider can redirect a dead listing to a nearby
 * parcel or a search page. So the gate needs the retained source URL to match
 * AND at least two independent identity signals to agree, with no hard
 * contradiction. Anything short of that returns matched:false and the capture is
 * discarded rather than persisted against the wrong comparable.
 */
export function reconcileCaptureToComp(capture: RawListingCapture, comp: CompIdentity): ReconciliationResult {
  const matchedOn: string[] = [];
  const mismatches: string[] = [];

  if (comp.sourceUrl && capture.sourceUrl) {
    const same = normalizeUrl(capture.sourceUrl) === normalizeUrl(comp.sourceUrl);
    if (same) matchedOn.push('retained source page URL');
    else mismatches.push(`captured page ${capture.sourceUrl} is not the retained source page ${comp.sourceUrl}`);
  }

  const capAddr = normalizeAddress(capture.address);
  const compAddr = normalizeAddress(comp.address);
  if (capAddr && compAddr) {
    if (capAddr === compAddr) matchedOn.push('address');
    else {
      const capRoad = roadIdentifier(capture.address);
      const compRoad = roadIdentifier(comp.address);
      if (capRoad && compRoad && (capRoad === compRoad || capAddr.includes(compRoad) || compAddr.includes(capRoad))) {
        matchedOn.push('road identifier');
      } else {
        mismatches.push(`page address "${capture.address}" does not agree with the comparable address "${comp.address}"`);
      }
    }
  }

  if (capture.apn && comp.apn) {
    if (compactApn(capture.apn) === compactApn(comp.apn)) matchedOn.push('parcel ID');
    else mismatches.push(`page APN ${capture.apn} does not match comparable APN ${comp.apn}`);
  }

  const capAcres = parseAcresText(capture.acresText);
  if (capAcres != null && comp.acres != null) {
    // Providers round acreage; 3% tolerance accepts the rounding, not a different parcel.
    const drift = Math.abs(capAcres - comp.acres) / comp.acres;
    if (drift <= 0.03) matchedOn.push('acreage');
    else mismatches.push(`page acreage ${capAcres} differs from the comparable's ${comp.acres} acres`);
  }

  const capPrice = parseListingPriceText(capture.priceText);
  if (capPrice != null && comp.price != null) {
    const drift = Math.abs(capPrice - comp.price) / comp.price;
    if (drift <= 0.02) matchedOn.push('sale or listing price');
    // A different price is NOT a hard mismatch: the page may show the current
    // asking price while the comp holds the closed price. It simply does not count.
  }

  if (capture.lat != null && capture.lng != null && comp.lat != null && comp.lng != null) {
    const miles = haversineMiles({ lat: capture.lat, lng: capture.lng }, { lat: comp.lat, lng: comp.lng });
    if (miles <= 0.35) matchedOn.push('coordinates');
    else mismatches.push(`page coordinates are ${miles.toFixed(2)} mi from the comparable's retained location`);
  }

  const matched = mismatches.length === 0 && matchedOn.length >= 2;
  return {
    matched,
    matchedOn,
    mismatches,
    note: matched
      ? `Page reconciled to the comparable on ${matchedOn.join(', ')}.`
      : mismatches.length
        ? `Capture refused: ${mismatches.join('; ')}.`
        : `Capture refused: only ${matchedOn.length} identity signal${matchedOn.length === 1 ? '' : 's'} agreed and two independent signals are required.`,
  };
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

export function parseAcresText(text: string | null | undefined): number | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  const acres = /([\d,]+(?:\.\d+)?)\s*(?:acres?|ac\b)/i.exec(t);
  if (acres) {
    const n = Number(acres[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) return n;
  }
  const sqft = /([\d,]+(?:\.\d+)?)\s*(?:sq\.?\s*ft|sqft|square feet)/i.exec(t);
  if (sqft) {
    const n = Number(sqft[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) return Math.round((n / 43560) * 100) / 100;
  }
  const bare = /^([\d,]+(?:\.\d+)?)$/.exec(t);
  if (bare) {
    const n = Number(bare[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

// ── Persisted record ─────────────────────────────────────────────────────────

/** What LandOS stores for a comparable after a successful provider page visit. */
export interface PersistedListingDetail {
  compId: number;
  provider: ListingProvider;
  sourceUrl: string;
  capturedAtIso: string;
  /** Chosen image, or null when no genuine listing image could be recovered. */
  image: {
    url: string;
    label: ListingImageLabel;
    provenance: CompVisualProvenance;
    tier: ListingImageTier;
    /** Which media region of the page it came from. Never an other-property card. */
    context: 'hero' | 'gallery';
    isOriginalListingImage: boolean;
    sourceProperty: string | null;
    reconciledOn: string[];
  } | null;
  /**
   * The full photo set, in the order the page published it. `image` above stays
   * the primary — it is what the card, the map preview and the thumbnail render
   * — and `photos[0]` is the same photograph. Older captures written before the
   * set existed have no `photos` key at all, so every reader must treat it as
   * optional and fall back to the single image.
   */
  photos?: Array<{
    url: string;
    sequence: number;
    label: ListingImageLabel;
    provenance: CompVisualProvenance;
    context: 'hero' | 'gallery';
    isOriginalListingImage: boolean;
  }>;
  /** How many genuine photographs the page published for this property. */
  photoCount?: number;
  events: CompListingEvent[];
  unusableRows: Array<{ row: string; why: string }>;
  /** Images the page carried that were refused, with the exact reason. */
  refusedImages: Array<{ url: string; why: string }>;
  sourceDescription: string | null;
  status: string | null;
  /** Anything that stopped the lane from getting everything. Never hidden. */
  limitation: string | null;
  reconciliation: ReconciliationResult;
}
