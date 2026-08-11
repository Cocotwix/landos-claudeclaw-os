// Comparable visual resolution — every comparable gets a useful visual, and the
// visual always states what it actually is.
//
// An empty "No photo supplied" block is not an acceptable normal state, but
// neither is a fallback that pretends to be something it is not. So the
// resolution walks a strict hierarchy and returns the provenance alongside the
// image, and the UI is required to render that provenance:
//
//   1. listing_photo      — the original listing photograph from the provider's
//                           own photo CDN (Zillow, Redfin, Realtor.com,
//                           LandPortal). This is a real picture of the property.
//   2. provider_thumbnail — a retained provider thumbnail whose host is not a
//                           recognised photo CDN: still supplied by the source,
//                           but not asserted to be the listing photograph.
//   3. parcel_aerial      — retained aerial imagery WITH persisted parcel
//                           geometry drawn over it. Never a fabricated boundary:
//                           this tier only lights up when real geometry exists.
//   4. satellite_fallback — retained satellite imagery centred on the resolved
//                           parcel location, without a boundary.
//   5. map_fallback       — a clearly labeled map view at the resolved
//                           coordinate, rendered from the same free OpenStreetMap
//                           raster tiles the combined comp map already uses. No
//                           new provider, no key, no charge.
//   6. location_unresolved— no reliable location exists, so nothing is drawn and
//                           the record says so plainly.
//
// An aerial or map fallback is NEVER labeled a listing photo, and a parcel
// boundary is never invented to make a tier available.

export type CompVisualProvenance =
  | 'listing_photo'
  | 'provider_thumbnail'
  | 'parcel_aerial'
  | 'satellite_fallback'
  | 'map_fallback'
  | 'location_unresolved';

export const COMP_VISUAL_LABELS: Readonly<Record<CompVisualProvenance, string>> = {
  listing_photo: 'Listing photo',
  provider_thumbnail: 'Provider thumbnail',
  parcel_aerial: 'Parcel aerial',
  satellite_fallback: 'Nationwide aerial fallback',
  map_fallback: 'Road map fallback',
  location_unresolved: 'Location unresolved',
};

/**
 * The approved label for a genuine provider image, named by the provider that
 * published it. The operator should be able to read "Zillow listing photo" and
 * know both that it is a real photograph AND where it came from — a generic
 * "Listing photo" hides which page would have to be reopened to check it.
 *
 * LandPortal is deliberately "listing thumbnail", not "listing photo": what
 * LandPortal retains is a comparable thumbnail, and asserting more than that
 * would be the same overclaim this module exists to prevent.
 */
export function listingPhotoLabelFor(sourceLabel: string): string {
  const s = (sourceLabel ?? '').trim().toLowerCase();
  if (s.startsWith('zillow')) return 'Zillow listing photo';
  if (s.startsWith('redfin')) return 'Redfin listing photo';
  if (s.startsWith('realtor')) return 'Realtor.com listing photo';
  if (s.startsWith('landportal') || s.startsWith('land portal')) return 'LandPortal listing thumbnail';
  return COMP_VISUAL_LABELS.listing_photo;
}

/** Identify the publisher from a recognized photo CDN. This keeps merged-source
 * records honest when the canonical comp's first provenance is LandPortal but
 * the selected photograph actually came from Zillow/Redfin/Realtor.com. */
export function listingPhotoProviderForUrl(url: string | null | undefined): string | null {
  const host = hostOf(url ?? '');
  if (!host) return null;
  if (host === 'photos.zillowstatic.com' || host.endsWith('.zillowstatic.com')) return 'Zillow';
  if (host === 'cdn-redfin.com' || host.endsWith('.cdn-redfin.com')) return 'Redfin';
  if (host === 'rdcpix.com' || host.endsWith('.rdcpix.com') || host === 'media.realtor.com' || host.endsWith('.realtor.com')) return 'Realtor.com';
  if (host === 'images.thelandportal.com' || host.endsWith('.thelandportal.com')) return 'LandPortal';
  return null;
}

export interface CompVisual {
  /** Image URL for the raster tiers. Null for map_fallback (drawn from tiles at
   *  `lat`/`lng`) and for location_unresolved (nothing is drawn). */
  url: string | null;
  provenance: CompVisualProvenance;
  /** Short provenance chip text, e.g. "Listing photo". */
  label: string;
  /** One honest sentence naming exactly what the operator is looking at. */
  detail: string;
  /** Coordinate the client renders the map fallback around. */
  lat: number | null;
  lng: number | null;
  /** True when a real photograph of the property is on screen. */
  isPhotograph: boolean;
}

/** Hosts that serve provider LISTING photography (a real picture of the parcel). */
const LISTING_PHOTO_HOSTS = [
  'photos.zillowstatic.com',
  'maps.zillowstatic.com',
  'ssl.cdn-redfin.com',
  'cdn-redfin.com',
  'ap.rdcpix.com',
  'rdcpix.com',
  'p.rdcpix.com',
  'media.realtor.com',
  'images.realtor.com',
  'images.thelandportal.com',
];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isListingPhotoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const host = hostOf(url);
  if (!host) return false;
  return LISTING_PHOTO_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

/** Marketplace listing photography outranks LandPortal's useful but less
 * descriptive listing thumbnail when several providers reconcile to one comp. */
export function listingPhotoPriority(url: string | null | undefined): number {
  const provider = listingPhotoProviderForUrl(url);
  if (provider && provider !== 'LandPortal') return 0;
  if (provider === 'LandPortal') return 1;
  return 2;
}

export interface CompVisualInput {
  /** Whatever thumbnail the source retained for this record. */
  thumbnailUrl: string | null;
  /** Additional provider photos, in provider order. A genuine listing photo in
   * this set outranks a generic thumbnail. */
  photoUrls?: string[];
  sourceLabel: string;
  /** Retained aerial imagery for THIS comparable, if any was ever captured. */
  aerialUrl?: string | null;
  /** True only when persisted parcel geometry exists to draw over the aerial. */
  hasParcelGeometry?: boolean;
  lat: number | null;
  lng: number | null;
  locationResolved: boolean;
  addressOrApn: string | null;
}

/**
 * Resolve one comparable's visual. Pure; never fetches, never fabricates, never
 * mislabels a fallback as a photograph.
 */
export function resolveCompVisual(input: CompVisualInput): CompVisual {
  const where = input.addressOrApn ? ` for ${input.addressOrApn}` : '';
  const candidates = [input.thumbnailUrl, ...(input.photoUrls ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());
  const thumb = candidates.find((url) => isListingPhotoUrl(url)) ?? candidates[0] ?? null;

  if (thumb && isListingPhotoUrl(thumb)) {
    const photoProvider = listingPhotoProviderForUrl(thumb) ?? input.sourceLabel;
    return {
      url: thumb,
      provenance: 'listing_photo',
      label: listingPhotoLabelFor(photoProvider),
      detail: `Original listing photograph retained from the ${photoProvider} property page${where}.`,
      lat: input.lat, lng: input.lng,
      isPhotograph: true,
    };
  }
  if (thumb) {
    return {
      url: thumb,
      provenance: 'provider_thumbnail',
      label: COMP_VISUAL_LABELS.provider_thumbnail,
      detail: `Thumbnail supplied by ${input.sourceLabel}${where}; not asserted to be the listing photograph.`,
      lat: input.lat, lng: input.lng,
      isPhotograph: false,
    };
  }
  if (input.aerialUrl && input.hasParcelGeometry) {
    return {
      url: input.aerialUrl,
      provenance: 'parcel_aerial',
      label: COMP_VISUAL_LABELS.parcel_aerial,
      detail: `Retained aerial imagery with the persisted parcel boundary${where}. The boundary comes from stored geometry and is never drawn from inference.`,
      lat: input.lat, lng: input.lng,
      isPhotograph: false,
    };
  }
  if (input.aerialUrl) {
    return {
      url: input.aerialUrl,
      provenance: 'satellite_fallback',
      label: COMP_VISUAL_LABELS.satellite_fallback,
      detail: `Nationwide aerial imagery centred on the resolved parcel location${where}. No parcel boundary is drawn because no geometry is persisted for this record, and this is aerial imagery rather than a listing photograph.`,
      lat: input.lat, lng: input.lng,
      isPhotograph: false,
    };
  }
  if (input.locationResolved && input.lat != null && input.lng != null) {
    return {
      url: null,
      provenance: 'map_fallback',
      label: COMP_VISUAL_LABELS.map_fallback,
      detail: `No genuine listing image could be recovered from the provider page${where}, so this is a road map view at the resolved location (${input.lat.toFixed(5)}, ${input.lng.toFixed(5)}) — a location fallback, not a photograph of the property.`,
      lat: input.lat, lng: input.lng,
      isPhotograph: false,
    };
  }
  return {
    url: null,
    provenance: 'location_unresolved',
    label: COMP_VISUAL_LABELS.location_unresolved,
    detail: `No provider image was retained${where} and the location is unresolved, so no visual can be shown without guessing where the parcel is.`,
    lat: null, lng: null,
    isPhotograph: false,
  };
}

/** Per-provenance tallies for the workspace header and the sprint report. */
export interface CompVisualCounts {
  listingPhoto: number;
  providerThumbnail: number;
  parcelAerial: number;
  satelliteFallback: number;
  mapFallback: number;
  locationUnresolved: number;
  total: number;
  /** Records with no visual at all — must stay at 0 for resolved locations. */
  withoutVisual: number;
}

export function tallyCompVisuals(visuals: CompVisual[]): CompVisualCounts {
  const count = (p: CompVisualProvenance) => visuals.filter((v) => v.provenance === p).length;
  return {
    listingPhoto: count('listing_photo'),
    providerThumbnail: count('provider_thumbnail'),
    parcelAerial: count('parcel_aerial'),
    satelliteFallback: count('satellite_fallback'),
    mapFallback: count('map_fallback'),
    locationUnresolved: count('location_unresolved'),
    total: visuals.length,
    withoutVisual: count('location_unresolved'),
  };
}
