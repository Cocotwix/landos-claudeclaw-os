// One comparable's visual, with its provenance always on screen.
//
// The server decides WHICH visual a record gets (listing photo, provider
// thumbnail, parcel aerial, satellite fallback, map fallback, or an honest
// unresolved placeholder). This component only draws it — and it always draws
// the provenance chip with it, so an aerial or map fallback can never be read as
// a photograph of the property.
//
// The map fallback is rendered from the same free OpenStreetMap raster tiles the
// combined comp map already uses: no new provider, no key, no charge, and no
// fabricated parcel boundary.

import { tilesForView, osmTileUrl } from '../lib/slippy';

export type CvVisualProvenance =
  | 'listing_photo' | 'provider_thumbnail' | 'parcel_aerial'
  | 'satellite_fallback' | 'map_fallback' | 'location_unresolved';

export interface CvVisual {
  url: string | null;
  provenance: CvVisualProvenance;
  label: string;
  detail: string;
  lat: number | null;
  lng: number | null;
  isPhotograph: boolean;
}

/** Short provenance chip tone, so a fallback never reads like a photo. */
const TONE: Record<CvVisualProvenance, string> = {
  listing_photo: 'photo',
  provider_thumbnail: 'photo',
  parcel_aerial: 'aerial',
  satellite_fallback: 'aerial',
  map_fallback: 'map',
  location_unresolved: 'none',
};

export function CompVisualThumb({ visual, thumbnailUrl, alt, width = 132, height = 96, zoom = 13 }: {
  visual: CvVisual;
  /** Reconciled listing-source thumbnail projected on the canonical comp. */
  thumbnailUrl?: string | null;
  alt: string;
  width?: number;
  height?: number;
  zoom?: number;
}) {
  // The chip states what the image IS ("Road map fallback"), which is the whole
  // honesty requirement. It carries no `title`: the browser drew that as a wide
  // white strip over the map beneath the real hover preview, and the long
  // provenance sentence is a retrieval diagnostic rather than something the
  // operator needs while comparing parcels.
  const chip = (
    <span class={`awv2-cv-prov ${TONE[visual.provenance]}`}>
      {visual.label}
    </span>
  );

  const displayUrl = thumbnailUrl && (visual.provenance === 'listing_photo' || visual.provenance === 'provider_thumbnail')
    ? thumbnailUrl
    : visual.url;

  if (displayUrl) {
    return (
      <figure class="awv2-cv-visual" style={{ width, height }}>
        <img src={displayUrl} alt={alt} loading="lazy" width={width} height={height} />
        {chip}
      </figure>
    );
  }

  if (visual.provenance === 'map_fallback' && visual.lat != null && visual.lng != null) {
    const center = { lat: visual.lat, lng: visual.lng };
    return (
      <figure class="awv2-cv-visual map" style={{ width, height }}>
        {tilesForView(center, zoom, width, height).map((t) => (
          <img
            key={`${t.z}/${t.x}/${t.y}`}
            src={osmTileUrl(t)}
            alt=""
            class="awv2-cv-visual-tile"
            style={{ left: t.left, top: t.top, width: 256, height: 256 }}
            loading="lazy"
          />
        ))}
        <span class="awv2-cv-visual-pin" aria-hidden="true" />
        <span class="sr-only">{alt} — map location fallback, not a photograph of the property.</span>
        {chip}
      </figure>
    );
  }

  return (
    <figure class="awv2-cv-visual none" style={{ width, height }}>
      <span class="awv2-cv-visual-empty">No location</span>
      {chip}
    </figure>
  );
}
