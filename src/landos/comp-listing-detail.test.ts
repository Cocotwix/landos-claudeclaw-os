// Provider-page capture: image selection, history normalisation, and the
// reconciliation gate.
//
// The gate is the important part. A neighbouring parcel's photo, a generic road
// shot, a map screenshot or another comparable's hero image are all WORSE than
// an honest map fallback, because they look like evidence. So nothing is
// accepted until independent identity signals agree, and a fallback never
// borrows a listing-photo label.

import { describe, expect, it } from 'vitest';

import {
  selectListingImage, isGenuineListingImageUrl, normalizeListingEvents, unusableHistoryRows,
  reconcileCaptureToComp, classifyListingEventText, parseListingDateText, parseListingPriceText,
  parseAcresText, roadIdentifier, rejectedImages, LISTING_IMAGE_LABELS,
  type RawListingCapture, type ListingImageCandidate, type ListingImageContext,
} from './comp-listing-detail.js';

const img = (url: string, context: ListingImageContext = 'hero'): ListingImageCandidate => ({ url, context });

const capture = (over: Partial<RawListingCapture> = {}): RawListingCapture => ({
  provider: 'Zillow',
  sourceUrl: 'https://www.zillow.com/homedetails/0-McGibbon-Rd-Martville-NY-13111/450537090_zpid/',
  capturedAtIso: '2026-08-06T12:00:00.000Z',
  images: [],
  priceHistory: [],
  description: null,
  status: null,
  address: '0 McGibbon Rd, Martville, NY 13111',
  acresText: '8.2 acres',
  priceText: '$54,000',
  domText: null,
  apn: null,
  lat: 43.3,
  lng: -76.6,
  limitation: null,
  ...over,
});

const comp = {
  address: '0 McGibbon Rd, Martville, NY 13111',
  apn: null,
  acres: 8.2,
  price: 54000,
  lat: 43.3,
  lng: -76.6,
  sourceUrl: 'https://www.zillow.com/homedetails/0-McGibbon-Rd-Martville-NY-13111/450537090_zpid/',
};

describe('genuine listing image detection', () => {
  it('accepts provider photo-CDN images', () => {
    expect(isGenuineListingImageUrl('https://photos.zillowstatic.com/fp/abc_d.jpg')).toBe(true);
    expect(isGenuineListingImageUrl('https://ssl.cdn-redfin.com/photo/189/bcsphoto/830/genBcs.jpg')).toBe(true);
    expect(isGenuineListingImageUrl('https://ap.rdcpix.com/abc/x.jpg')).toBe(true);
    expect(isGenuineListingImageUrl('https://images.thelandportal.com/images/xyz')).toBe(true);
  });

  it('rejects page furniture, map tiles and static maps', () => {
    for (const url of [
      'https://photos.zillowstatic.com/static/sprite.png',
      'https://photos.zillowstatic.com/logo.svg',
      'https://maps.googleapis.com/maps/api/staticmap?center=43,-76',
      'https://tile.openstreetmap.org/12/1/1.png',
      'https://example.com/some-photo.jpg',
      'http://photos.zillowstatic.com/insecure.jpg',
    ]) {
      expect(isGenuineListingImageUrl(url)).toBe(false);
    }
    expect(isGenuineListingImageUrl(null)).toBe(false);
  });
});

describe('image selection walks hero → gallery thumbnail → other listing media', () => {
  it('labels a Zillow hero as a Zillow listing photo', () => {
    const picked = selectListingImage(capture({ images: [img('https://photos.zillowstatic.com/fp/hero_d.jpg', 'hero')] }));
    expect(picked?.tier).toBe('hero');
    expect(picked?.context).toBe('hero');
    expect(picked?.label).toBe(LISTING_IMAGE_LABELS.zillow_listing_photo);
    expect(picked?.provenance).toBe('listing_photo');
    expect(picked?.isOriginalListingImage).toBe(true);
  });

  it('names each provider in its own label', () => {
    expect(selectListingImage(capture({ provider: 'Redfin', images: [img('https://ssl.cdn-redfin.com/photo/1/a.jpg')] }))?.label)
      .toBe(LISTING_IMAGE_LABELS.redfin_listing_photo);
    expect(selectListingImage(capture({ provider: 'Realtor', images: [img('https://ap.rdcpix.com/a/b.jpg')] }))?.label)
      .toBe(LISTING_IMAGE_LABELS.realtor_listing_photo);
    // LandPortal retains a thumbnail, so it is never overclaimed as a photograph.
    const lp = selectListingImage(capture({ provider: 'LandPortal', images: [img('https://images.thelandportal.com/images/x')] }));
    expect(lp?.label).toBe(LISTING_IMAGE_LABELS.landportal_listing_thumbnail);
    expect(lp?.provenance).toBe('provider_thumbnail');
  });

  it('prefers the hero over a gallery thumbnail regardless of page order', () => {
    const picked = selectListingImage(capture({
      images: [
        img('https://photos.zillowstatic.com/fp/thumb1_d.jpg', 'gallery'),
        img('https://photos.zillowstatic.com/fp/hero_d.jpg', 'hero'),
      ],
    }));
    expect(picked?.url).toBe('https://photos.zillowstatic.com/fp/hero_d.jpg');
    expect(picked?.tier).toBe('hero');
  });

  it('falls to the gallery when the page declares no hero photograph', () => {
    const picked = selectListingImage(capture({
      images: [img('https://photos.zillowstatic.com/fp/g1_d.jpg', 'gallery')],
    }));
    expect(picked?.tier).toBe('thumbnail');
    expect(picked?.context).toBe('gallery');
  });

  it('skips junk and takes the first genuine image after it', () => {
    const picked = selectListingImage(capture({
      images: [
        img('https://photos.zillowstatic.com/static/logo.svg', 'hero'),
        img('https://maps.googleapis.com/maps/api/staticmap?x=1', 'hero'),
        img('https://photos.zillowstatic.com/fp/real_d.jpg', 'gallery'),
      ],
    }));
    expect(picked?.url).toBe('https://photos.zillowstatic.com/fp/real_d.jpg');
  });

  it('returns null rather than dressing something else up as a photo', () => {
    expect(selectListingImage(capture({ images: [] }))).toBeNull();
    expect(selectListingImage(capture({ images: [img('https://tile.openstreetmap.org/12/1/1.png')] }))).toBeNull();
  });
});

describe('another property\'s photo on the right page is still contamination', () => {
  // The live defect this pins: a Redfin vacant-land page carried NO photo of the
  // subject, but its "recently sold homes" carousel was full of real house
  // photographs on Redfin's own photo CDN. Correct URL, correct page, correct
  // CDN, wrong parcel — and it briefly reached the workspace as a listing photo.
  const contaminated = capture({
    provider: 'Redfin',
    sourceUrl: 'https://www.redfin.com/NY/Sterling/Laxton-Rd-13156/home/162843304',
    address: 'Laxton Rd, Sterling, NY 13156',
    acresText: '9 acres',
    images: [
      { url: 'https://ssl.cdn-redfin.com/photo/189/bcsphoto/830/genBcs.S1673830_1Z.jpg', context: 'other_property_card', container: 'bp-Homecard__Photo--image' },
      { url: 'https://ssl.cdn-redfin.com/photo/189/bcsphoto/794/genBcs.S1670794_2N.jpg', context: 'other_property_card', container: 'bp-Homecard__Photo--image' },
    ],
  });

  it('refuses every image that came from another property\'s card', () => {
    expect(selectListingImage(contaminated)).toBeNull();
  });

  it('refuses site chrome such as the provider logo served as og:image', () => {
    const logo = capture({
      provider: 'Redfin',
      images: [{ url: 'https://ssl.cdn-redfin.com/vLATEST/images/logos/redfin-rocket-logo-red-bg-1200x1200.png', context: 'page_furniture' }],
    });
    expect(selectListingImage(logo)).toBeNull();
  });

  it('refuses an image whose position on the page could not be established', () => {
    // An unplaceable image cannot be bound to this property, so it is not used —
    // an honest map fallback beats a photograph of an unknown parcel.
    expect(selectListingImage(capture({ images: [img('https://photos.zillowstatic.com/fp/x_d.jpg', 'unknown')] }))).toBeNull();
  });

  it('records exactly why each refused image was refused', () => {
    const why = rejectedImages(contaminated);
    expect(why).toHaveLength(2);
    expect(why[0].why).toContain('belongs to a different property shown on the same page');
    const chrome = rejectedImages(capture({ images: [{ url: 'https://ssl.cdn-redfin.com/logo.png', context: 'page_furniture' }] }));
    expect(chrome[0].why).toContain('site chrome');
    const unplaced = rejectedImages(capture({ images: [img('https://photos.zillowstatic.com/fp/x_d.jpg', 'unknown')] }));
    expect(unplaced[0].why).toContain('position on the page could not be established');
  });

  it('still accepts the subject\'s own gallery on the same page', () => {
    const mixed = capture({
      provider: 'Redfin',
      images: [
        { url: 'https://ssl.cdn-redfin.com/photo/189/bcsphoto/830/genBcs.OTHER.jpg', context: 'other_property_card' },
        { url: 'https://ssl.cdn-redfin.com/photo/189/mine/subject_1.jpg', context: 'gallery' },
      ],
    });
    expect(selectListingImage(mixed)?.url).toBe('https://ssl.cdn-redfin.com/photo/189/mine/subject_1.jpg');
  });
});

describe('reconciliation gate', () => {
  it('accepts a page proven by two or more independent identity signals', () => {
    const r = reconcileCaptureToComp(capture(), comp);
    expect(r.matched).toBe(true);
    expect(r.matchedOn).toEqual(expect.arrayContaining(['retained source page URL', 'address', 'acreage', 'coordinates']));
    expect(r.mismatches).toEqual([]);
  });

  it('refuses a neighbouring parcel: the address disagrees', () => {
    const r = reconcileCaptureToComp(capture({ address: '0 Peat Bed Rd, Hannibal, NY 13074' }), comp);
    expect(r.matched).toBe(false);
    expect(r.note).toContain('Capture refused');
  });

  it('refuses a page whose coordinates are far from the retained location', () => {
    const r = reconcileCaptureToComp(capture({ lat: 44.9, lng: -75.1 }), comp);
    expect(r.matched).toBe(false);
    expect(r.mismatches.join(' ')).toMatch(/mi from the comparable/);
  });

  it('refuses a page redirected away from the retained source URL', () => {
    const r = reconcileCaptureToComp(capture({ sourceUrl: 'https://www.zillow.com/homes/for_sale/' }), comp);
    expect(r.matched).toBe(false);
    expect(r.mismatches.join(' ')).toContain('is not the retained source page');
  });

  it('refuses an APN that contradicts the comparable', () => {
    const r = reconcileCaptureToComp(capture({ apn: '999999 99.99-9-99' }), { ...comp, apn: '055689 10.00-1-64.22' });
    expect(r.matched).toBe(false);
  });

  it('refuses a block or error page even on the right URL', () => {
    const r = reconcileCaptureToComp(
      capture({ address: 'Press & Hold to confirm you are a human', acresText: null, lat: null, lng: null }),
      comp,
    );
    expect(r.matched).toBe(false);
  });

  it('needs two independent signals, not just a matching URL', () => {
    const r = reconcileCaptureToComp(
      capture({ address: null, acresText: null, priceText: null, lat: null, lng: null }),
      comp,
    );
    expect(r.matched).toBe(false);
    expect(r.note).toContain('two independent signals are required');
  });

  it('accepts provider acreage rounding but not a different parcel size', () => {
    expect(reconcileCaptureToComp(capture({ acresText: '8.2 acres' }), comp).matchedOn).toContain('acreage');
    expect(reconcileCaptureToComp(capture({ acresText: '8.25 acres' }), comp).matchedOn).toContain('acreage');
    expect(reconcileCaptureToComp(capture({ acresText: '12.7 acres' }), comp).matched).toBe(false);
  });

  it('does not treat a differing page price as a contradiction', () => {
    // The page may show a current ask while the comp holds the closed price.
    const r = reconcileCaptureToComp(capture({ priceText: '$61,975' }), comp);
    expect(r.matched).toBe(true);
    expect(r.matchedOn).not.toContain('sale or listing price');
  });

  it('matches on a road identifier when the street numbers differ', () => {
    expect(roadIdentifier('0 McGibbon Rd, Martville, NY 13111')).toBe('mcgibbon rd');
    const r = reconcileCaptureToComp(capture({ address: 'McGibbon Rd, Martville, NY 13111' }), comp);
    expect(r.matchedOn).toContain('road identifier');
  });
});

describe('listing-history normalisation', () => {
  it('classifies the labels providers actually print', () => {
    expect(classifyListingEventText('Listed for sale')).toBe('listed');
    expect(classifyListingEventText('Price change')).toBe('price_change');
    expect(classifyListingEventText('Listing removed')).toBe('withdrawn');
    expect(classifyListingEventText('Withdrawn')).toBe('withdrawn');
    expect(classifyListingEventText('Cancelled')).toBe('withdrawn');
    expect(classifyListingEventText('Relisted')).toBe('relisted');
    expect(classifyListingEventText('Pending sale')).toBe('pending');
    expect(classifyListingEventText('Back on market')).toBe('back_on_market');
    expect(classifyListingEventText('Sold')).toBe('sold');
    expect(classifyListingEventText('Something unrelated')).toBeNull();
  });

  it('parses the date formats providers print into exact ISO dates', () => {
    expect(parseListingDateText('11/18/2025')).toBe('2025-11-18');
    expect(parseListingDateText('Nov 18, 2025')).toBe('2025-11-18');
    expect(parseListingDateText('November 18, 2025')).toBe('2025-11-18');
    expect(parseListingDateText('2025-11-18')).toBe('2025-11-18');
    // A month with no day cannot anchor an exact day count.
    expect(parseListingDateText('November 2025')).toBeNull();
  });

  it('parses printed prices and ignores percentage deltas', () => {
    expect(parseListingPriceText('$49,900')).toBe(49900);
    expect(parseListingPriceText('$49,900 (-5.9%)')).toBe(49900);
    expect(parseListingPriceText('--')).toBeNull();
  });

  it('parses acreage in acres and square feet', () => {
    expect(parseAcresText('9.85 acres')).toBe(9.85);
    expect(parseAcresText('8.2 ac')).toBe(8.2);
    expect(parseAcresText('43,560 sq ft')).toBe(1);
  });

  it('turns printed rows into dated events attributed to the provider', () => {
    const events = normalizeListingEvents(capture({
      priceHistory: [
        { dateText: '4/1/2025', eventText: 'Listed for sale', priceText: '$60,000' },
        { dateText: '7/15/2025', eventText: 'Listing removed', priceText: '' },
        { dateText: '7/22/2025', eventText: 'Listed for sale', priceText: '$55,000' },
      ],
    }));
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ dateIso: '2025-04-01', kind: 'listed', price: 60000, source: 'Zillow listing history' });
    expect(events[1].kind).toBe('withdrawn');
    expect(events[2].price).toBe(55000);
  });

  it('surfaces rows it could not use instead of silently dropping them', () => {
    const raw = capture({
      priceHistory: [
        { dateText: 'November 2025', eventText: 'Sold', priceText: '$49,900' },
        { dateText: '4/1/2025', eventText: 'Mortgage recorded', priceText: '' },
      ],
    });
    expect(normalizeListingEvents(raw)).toHaveLength(0);
    const unusable = unusableHistoryRows(raw);
    expect(unusable).toHaveLength(2);
    expect(unusable[0].why).toBe('no exact calendar date');
    expect(unusable[1].why).toBe('event type not recognised');
  });
});
