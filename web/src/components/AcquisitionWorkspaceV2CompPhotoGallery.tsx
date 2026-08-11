// Lightweight, dependency-free gallery for photographs reconciled to one comp.
// Aerial and map fallbacks stay on the collapsed card; this gallery only accepts
// the listing photographs projected for the physical property record.

import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';

export interface CvCompPhoto {
  url: string;
  sequence: number;
  label: string;
  provider: string;
  context: 'hero' | 'gallery';
}

export function AcquisitionWorkspaceV2CompPhotoGallery({ photos, address, sourcePage, provider, fallbackNote }: {
  photos: CvCompPhoto[];
  address: string;
  sourcePage: string | null;
  provider: string | null;
  fallbackNote: string | null;
}) {
  const [index, setIndex] = useState(0);
  const total = photos.length;

  useEffect(() => {
    if (index >= total) setIndex(0);
  }, [index, total]);

  if (total === 0) {
    return (
      <p class="awv2-cvd-note">
        {fallbackNote ?? 'No genuine listing photograph is retained for this property.'}
        {' '}The card keeps its clearly labelled parcel/location visual; another property&apos;s photo is never substituted.
      </p>
    );
  }

  const activeIndex = Math.min(index, total - 1);
  const current = photos[activeIndex];
  const step = (delta: number) => setIndex((i) => (i + delta + total) % total);

  return (
    <div class="awv2-cvd-gallery" aria-label={`Listing photos for ${address}`}>
      <div class="awv2-cvd-galleryframe">
        <img
          src={current.url}
          alt={`${address} — listing photograph ${activeIndex + 1} of ${total}, published by ${current.provider}`}
          loading="lazy"
        />
        {total > 1 && (
          <>
            <button type="button" class="nav prev" aria-label="Previous comp photo" onClick={() => step(-1)}>
              <ChevronLeft size={20} />
            </button>
            <button type="button" class="nav next" aria-label="Next comp photo" onClick={() => step(1)}>
              <ChevronRight size={20} />
            </button>
          </>
        )}
        <span class="count" role="status">{total > 1 ? `${activeIndex + 1} of ${total}` : '1 photo'}</span>
      </div>

      {total > 1 && (
        <div class="awv2-cvd-gallerystrip" role="group" aria-label="Comp photo thumbnails">
          {photos.map((photo, photoIndex) => (
            <button
              key={`${photo.url}-${photo.sequence}`}
              type="button"
              class={`thumb${photoIndex === activeIndex ? ' active' : ''}`}
              aria-label={`Show comp photo ${photoIndex + 1} of ${total}`}
              aria-pressed={photoIndex === activeIndex}
              onClick={() => setIndex(photoIndex)}
            >
              <img src={photo.url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      <div class="awv2-cvd-gallerymeta">
        <span class="prov">
          {current.label}{provider && !current.label.toLowerCase().includes(provider.toLowerCase()) ? ` — ${provider}` : ''}
        </span>
        <span class="use">Compare clearing, terrain, road relationship, improvements, water, utilities, and surrounding quality.</span>
        {sourcePage && (
          <a href={sourcePage} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={12} /> Open original listing
          </a>
        )}
      </div>
    </div>
  );
}
