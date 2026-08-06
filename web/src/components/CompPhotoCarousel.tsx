// One comparable's property-photo carousel, shown inside Full details.
//
// A vacant-land comp is judged on things a single hero shot cannot show: the
// road frontage, the clearing, the tree line, the wet corner, whether the
// "driveway" in the listing copy is a driveway or a mowed path. When the
// provider published twelve photographs, all twelve are comparability evidence,
// and the operator should be able to walk them without leaving LandOS.
//
// Two rules keep it honest:
//   • A carousel is only ever drawn over GENUINE photographs of THIS property —
//     reconciled to the exact parcel before they were persisted. A fallback
//     aerial or road map is not a gallery, so a single fallback never gets
//     previous/next controls that imply there is more to see.
//   • The provider that published the photographs is named on the frame, and the
//     original page is one click away, so any photo can be checked at source.

import { useEffect, useState } from 'preact/hooks';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-preact';

export interface CarouselPhoto {
  url: string;
  sequence: number;
  label: string;
  provider: string;
  context: 'hero' | 'gallery';
}

export function CompPhotoCarousel({ photos, address, sourcePage, provider, fallbackNote }: {
  photos: CarouselPhoto[];
  address: string;
  sourcePage: string | null;
  provider: string | null;
  fallbackNote: string | null;
}) {
  const [index, setIndex] = useState(0);
  const total = photos.length;

  // A record can be re-projected under the operator while it is open (an
  // include/exclude refetches the whole projection). Clamping here stops the
  // frame from pointing past the end of a shorter set.
  useEffect(() => { if (index >= total) setIndex(0); }, [total]);

  if (total === 0) {
    return (
      <p class="awv2-cvd-note">
        {fallbackNote ?? 'No genuine listing photograph is retained for this property.'}
        {' '}The card shows a clearly labeled location visual instead; another property's photo is never substituted.
      </p>
    );
  }

  const current = photos[Math.min(index, total - 1)];
  const step = (delta: number) => setIndex((i) => (i + delta + total) % total);

  return (
    <div class="awv2-cvd-gallery">
      <div class="awv2-cvd-galleryframe">
        <img
          src={current.url}
          alt={`${address} — listing photograph ${current.sequence} of ${total}, published by ${current.provider}`}
          loading="lazy"
        />
        {total > 1 && (
          <>
            <button type="button" class="nav prev" aria-label="Previous photo" onClick={() => step(-1)}>
              <ChevronLeft size={20} />
            </button>
            <button type="button" class="nav next" aria-label="Next photo" onClick={() => step(1)}>
              <ChevronRight size={20} />
            </button>
          </>
        )}
        <span class="count" role="status">{total > 1 ? `${index + 1} of ${total}` : '1 photo'}</span>
      </div>

      {total > 1 && (
        <div class="awv2-cvd-gallerystrip" role="group" aria-label="Photo thumbnails">
          {photos.map((p, i) => (
            <button
              key={p.url}
              type="button"
              class={`thumb${i === index ? ' active' : ''}`}
              aria-label={`Show photo ${i + 1} of ${total}`}
              aria-pressed={i === index}
              onClick={() => setIndex(i)}
            >
              <img src={p.url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      <div class="awv2-cvd-gallerymeta">
        <span class="prov">{current.label}{provider && !current.label.toLowerCase().includes(provider.toLowerCase()) ? ` — ${provider}` : ''}</span>
        {sourcePage && (
          <a href={sourcePage} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={12} /> Open original listing
          </a>
        )}
      </div>
    </div>
  );
}
