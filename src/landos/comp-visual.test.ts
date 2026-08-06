// Comparable visual resolution and provenance.
//
// Contract: every comparable gets a useful visual, and the visual never lies
// about what it is. An aerial or map fallback is never labeled a listing photo,
// a parcel boundary is never drawn without persisted geometry, and only a
// genuinely unresolvable location may end with no visual at all.

import { describe, expect, it } from 'vitest';

import {
  resolveCompVisual,
  tallyCompVisuals,
  isListingPhotoUrl,
  COMP_VISUAL_LABELS,
  type CompVisualInput,
} from './comp-visual.js';

const AT_LOCATION = { lat: 43.3146, lng: -76.6424, locationResolved: true };

const base = (over: Partial<CompVisualInput> = {}): CompVisualInput => ({
  thumbnailUrl: null,
  sourceLabel: 'Zillow',
  lat: null,
  lng: null,
  locationResolved: false,
  addressOrApn: 'Laxton Rd, Sterling, NY 13156',
  ...over,
});

describe('tier 1 — the original listing photograph', () => {
  it('recognises the provider photo CDNs actually retained by LandOS', () => {
    expect(isListingPhotoUrl('https://photos.zillowstatic.com/fp/abc-d_d.jpg')).toBe(true);
    expect(isListingPhotoUrl('https://ssl.cdn-redfin.com/photo/189/islphoto/312/x.webp')).toBe(true);
    expect(isListingPhotoUrl('https://ap.rdcpix.com/abc/x.jpg')).toBe(true);
    expect(isListingPhotoUrl('https://images.thelandportal.com/images/abc')).toBe(true);
    expect(isListingPhotoUrl('https://example.com/whatever.png')).toBe(false);
    expect(isListingPhotoUrl(null)).toBe(false);
    expect(isListingPhotoUrl('not a url')).toBe(false);
  });

  it('labels a provider photo-CDN image as that PROVIDER\'s listing photo', () => {
    const v = resolveCompVisual(base({ thumbnailUrl: 'https://photos.zillowstatic.com/fp/abc-d_d.jpg' }));
    expect(v.provenance).toBe('listing_photo');
    // Naming the provider tells the operator which page to reopen to check it;
    // a generic "Listing photo" hides that.
    expect(v.label).toBe('Zillow listing photo');
    expect(v.isPhotograph).toBe(true);
    expect(v.url).toContain('zillowstatic');
    expect(v.detail).toContain('Zillow');
  });

  it('shows a listing photo even when the location never resolved', () => {
    const v = resolveCompVisual(base({ thumbnailUrl: 'https://ssl.cdn-redfin.com/photo/x.webp' }));
    expect(v.provenance).toBe('listing_photo');
  });
});

describe('tier 2 — an unrecognised provider thumbnail', () => {
  it('never claims an unrecognised host is the listing photograph', () => {
    const v = resolveCompVisual(base({ thumbnailUrl: 'https://cdn.example.net/thumb.png', sourceLabel: 'Realtor' }));
    expect(v.provenance).toBe('provider_thumbnail');
    expect(v.isPhotograph).toBe(false);
    expect(v.detail).toContain('not asserted to be the listing photograph');
  });
});

describe('tiers 3 and 4 — aerial imagery', () => {
  it('draws a parcel boundary only when persisted geometry exists', () => {
    const withGeometry = resolveCompVisual(base({
      ...AT_LOCATION, aerialUrl: '/api/landos/aerial/9', hasParcelGeometry: true,
    }));
    expect(withGeometry.provenance).toBe('parcel_aerial');
    expect(withGeometry.detail).toContain('never drawn from inference');

    const withoutGeometry = resolveCompVisual(base({
      ...AT_LOCATION, aerialUrl: '/api/landos/aerial/9', hasParcelGeometry: false,
    }));
    expect(withoutGeometry.provenance).toBe('satellite_fallback');
    expect(withoutGeometry.detail).toContain('No parcel boundary is drawn');
  });

  it('never labels an aerial fallback a photograph', () => {
    const v = resolveCompVisual(base({ ...AT_LOCATION, aerialUrl: '/api/landos/aerial/9' }));
    expect(v.isPhotograph).toBe(false);
    expect(v.label).not.toBe(COMP_VISUAL_LABELS.listing_photo);
  });
});

describe('tier 5 — the clearly labeled map fallback', () => {
  it('falls back to a map view at the resolved coordinate, honestly labeled', () => {
    const v = resolveCompVisual(base(AT_LOCATION));
    expect(v.provenance).toBe('map_fallback');
    expect(v.label).toBe('Road map fallback');
    expect(v.isPhotograph).toBe(false);
    expect(v.url).toBeNull();          // drawn from the same tiles as the comp map
    expect(v.lat).toBeCloseTo(43.3146, 4);
    expect(v.lng).toBeCloseTo(-76.6424, 4);
    expect(v.detail).toContain('not a photograph of the property');
  });

  it('replaces the empty "no photo supplied" state for every located record', () => {
    const v = resolveCompVisual(base(AT_LOCATION));
    expect(v.provenance).not.toBe('location_unresolved');
  });
});

describe('tier 6 — location unresolved', () => {
  it('shows a placeholder rather than guessing where the parcel is', () => {
    const v = resolveCompVisual(base());
    expect(v.provenance).toBe('location_unresolved');
    expect(v.url).toBeNull();
    expect(v.lat).toBeNull();
    expect(v.lng).toBeNull();
    expect(v.detail).toContain('without guessing where the parcel is');
  });

  it('treats a resolved flag with missing coordinates as unresolved', () => {
    const v = resolveCompVisual(base({ locationResolved: true, lat: null, lng: null }));
    expect(v.provenance).toBe('location_unresolved');
  });
});

describe('provenance tallies', () => {
  it('counts every provenance and reports records left without a visual', () => {
    const visuals = [
      resolveCompVisual(base({ thumbnailUrl: 'https://photos.zillowstatic.com/fp/a.jpg' })),
      resolveCompVisual(base({ thumbnailUrl: 'https://cdn.example.net/b.png' })),
      resolveCompVisual(base({ ...AT_LOCATION, aerialUrl: '/a/1', hasParcelGeometry: true })),
      resolveCompVisual(base({ ...AT_LOCATION, aerialUrl: '/a/2' })),
      resolveCompVisual(base(AT_LOCATION)),
      resolveCompVisual(base(AT_LOCATION)),
      resolveCompVisual(base()),
    ];
    const counts = tallyCompVisuals(visuals);
    expect(counts).toMatchObject({
      listingPhoto: 1,
      providerThumbnail: 1,
      parcelAerial: 1,
      satelliteFallback: 1,
      mapFallback: 2,
      locationUnresolved: 1,
      total: 7,
      withoutVisual: 1,
    });
  });
});
