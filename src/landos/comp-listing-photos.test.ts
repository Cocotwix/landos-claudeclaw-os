// The comparable photo SET: selection, reconciliation, persistence, projection.
//
// The single-hero behaviour was already proven; what is new is that a page which
// published twelve photographs of a parcel now yields twelve pieces of
// comparability evidence instead of one. The risk that comes with that is
// contamination at scale: a gallery walk that loosens the rules would pull in a
// "similar homes" carousel and hand the operator photographs of somebody else's
// land. So every one of these tests exists to prove the SET passes exactly the
// same gates the single hero passed — CDN host, own-media region, and a capture
// that reconciled to this exact comparable.

import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb } from './db.js';
import { createDealCard } from './deal-card.js';
import { addComp, listComps } from './comps.js';
import { saveCompListingDetail, loadCompListingDetail } from './comp-listing-store.js';
import {
  selectListingImage, selectListingImages, photoIdentityKey,
  type RawListingCapture,
} from './comp-listing-detail.js';
import { buildCompListingProjection } from './comp-listing-projection.js';
import { buildSourceDescription, decodeHtmlEntities, detectMarketingClaims } from './comp-listing-summary.js';

const ZG = 'https://photos.zillowstatic.com/fp';
const RF = 'https://ssl.cdn-redfin.com/photo/45/mbphoto/599/genMid.73205599';

function capture(images: RawListingCapture['images'], over: Partial<RawListingCapture> = {}): RawListingCapture {
  return {
    provider: 'Zillow',
    sourceUrl: 'https://www.zillow.com/homedetails/0-McGibbon-Rd-Martville-NY-13111/450537090_zpid/',
    capturedAtIso: '2026-08-06T12:00:00.000Z',
    images,
    priceHistory: [],
    description: null,
    status: null,
    address: '0 McGibbon Rd, Martville, NY 13111',
    acresText: '8.2 acres',
    priceText: '$54,000',
    domText: null,
    apn: null,
    lat: 43.32,
    lng: -76.68,
    limitation: null,
    ...over,
  };
}

describe('the photo set walks the whole gallery, not just the hero', () => {
  it('keeps every genuine own-media photograph in page order', () => {
    const photos = selectListingImages(capture([
      { url: `${ZG}/hero-p_e.jpg`, context: 'hero' },
      { url: `${ZG}/second-p_e.jpg`, context: 'gallery' },
      { url: `${ZG}/third-p_e.jpg`, context: 'gallery' },
      { url: `${ZG}/fourth-p_e.jpg`, context: 'gallery' },
    ]));
    expect(photos.map((p) => p.url)).toEqual([
      `${ZG}/hero-p_e.jpg`, `${ZG}/second-p_e.jpg`, `${ZG}/third-p_e.jpg`, `${ZG}/fourth-p_e.jpg`,
    ]);
    expect(photos.map((p) => p.sequence)).toEqual([1, 2, 3, 4]);
    expect(photos.every((p) => p.isOriginalListingImage)).toBe(true);
    expect(photos.every((p) => p.label === 'Zillow listing photo')).toBe(true);
  });

  it('pulls the page-declared hero to the front and leaves the rest in order', () => {
    const photos = selectListingImages(capture([
      { url: `${ZG}/a-p_e.jpg`, context: 'gallery' },
      { url: `${ZG}/b-p_e.jpg`, context: 'gallery' },
      { url: `${ZG}/theHero-p_e.jpg`, context: 'hero' },
    ]));
    expect(photos[0].url).toBe(`${ZG}/theHero-p_e.jpg`);
    expect(photos[0].context).toBe('hero');
    expect(photos.slice(1).map((p) => p.url)).toEqual([`${ZG}/a-p_e.jpg`, `${ZG}/b-p_e.jpg`]);
  });

  it('agrees with the single-image selection about which photograph is primary', () => {
    const c = capture([
      { url: `${ZG}/g1-p_e.jpg`, context: 'gallery' },
      { url: `${ZG}/hero-p_e.jpg`, context: 'hero' },
    ]);
    expect(selectListingImages(c)[0].url).toBe(selectListingImage(c)!.url);
  });
});

describe('a gallery never becomes a way in for another property', () => {
  it('refuses similar-homes and recently-sold carousel images at any position', () => {
    const photos = selectListingImages(capture([
      { url: `${ZG}/ours-p_e.jpg`, context: 'hero' },
      { url: `${ZG}/neighbour-p_e.jpg`, context: 'other_property_card', container: 'similar-homes' },
      { url: `${ZG}/alsoTheirs-p_e.jpg`, context: 'other_property_card', container: 'recently-sold' },
    ]));
    expect(photos).toHaveLength(1);
    expect(photos[0].url).toBe(`${ZG}/ours-p_e.jpg`);
  });

  it('refuses page furniture and any image whose page position is unknown', () => {
    const photos = selectListingImages(capture([
      { url: `${ZG}/ours-p_e.jpg`, context: 'gallery' },
      { url: 'https://photos.zillowstatic.com/static/logo.svg', context: 'page_furniture' },
      { url: `${ZG}/mystery-p_e.jpg`, context: 'unknown' },
    ]));
    expect(photos.map((p) => p.url)).toEqual([`${ZG}/ours-p_e.jpg`]);
  });

  it('refuses a real photograph served off a host that is not a provider photo CDN', () => {
    const photos = selectListingImages(capture([
      { url: 'https://example.com/genuine-looking-land.jpg', context: 'gallery' },
    ]));
    expect(photos).toEqual([]);
  });

  it('never invents a photograph for a page that published none', () => {
    expect(selectListingImages(capture([]))).toEqual([]);
  });
});

describe('renditions of one photograph collapse to one gallery slot', () => {
  it('treats provider size variants as the same photograph and keeps the largest', () => {
    const photos = selectListingImages(capture([
      { url: `${ZG}/abc-cc_ft_384.webp`, context: 'gallery' },
      { url: `${ZG}/abc-cc_ft_1536.webp`, context: 'gallery' },
      { url: `${ZG}/abc-p_e.jpg`, context: 'gallery' },
      { url: `${ZG}/def-cc_ft_768.webp`, context: 'gallery' },
    ]));
    expect(photos).toHaveLength(2);
    expect(photos[0].url).toBe(`${ZG}/abc-cc_ft_1536.webp`);
  });

  it('groups Redfin and Realtor renditions by identity too', () => {
    expect(photoIdentityKey(`${RF}_3_0.jpg`)).toBe(photoIdentityKey(`${RF}_3_0.jpg`.replace('genMid', 'genLd')));
    // Redfin's whole rendition-directory family names one photograph. Missing a
    // member put the same picture in slots 1 and 2 of a live 20-photo gallery.
    expect(photoIdentityKey('https://ssl.cdn-redfin.com/photo/189/mbpaddedwide/312/genMid.S1645312_21.jpg'))
      .toBe(photoIdentityKey('https://ssl.cdn-redfin.com/photo/189/bigphoto/312/S1645312_21.jpg'));
    expect(photoIdentityKey('https://ssl.cdn-redfin.com/photo/189/mbphotov3/312/genMid.S1645312_4_21.jpg'))
      .not.toBe(photoIdentityKey('https://ssl.cdn-redfin.com/photo/189/bigphoto/312/S1645312_21.jpg'));
    expect(photoIdentityKey('https://ap.rdcpix.com/x-m123od-w480_h360_x2.webp'))
      .toBe(photoIdentityKey('https://ap.rdcpix.com/x-m123od-w1024_h768.webp'));
    // Different photographs must NOT collapse together.
    expect(photoIdentityKey(`${ZG}/abc-p_e.jpg`)).not.toBe(photoIdentityKey(`${ZG}/def-p_e.jpg`));
  });

  it('caps a pathological page rather than writing an unbounded row', () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ url: `${ZG}/p${i}-p_e.jpg`, context: 'gallery' as const }));
    expect(selectListingImages(capture(many)).length).toBeLessThanOrEqual(40);
  });
});

describe('the source description reads as the source wrote it', () => {
  it('decodes the HTML entities providers embed in their own payload', () => {
    // Live defect: Redfin's description arrived entity-escaped and the operator
    // was shown "Don&rsquo;t be deceived by the charming two-car garage in
    // Martville&mdash;hidden behind it..." — neither the source's wording nor
    // readable English.
    const d = buildSourceDescription(
      'Don&rsquo;t be deceived by the charming two-car garage in Martville&mdash;hidden behind it lies a breathtaking 7&#45;acre wooded lot.',
      'Redfin',
    )!;
    expect(d.text).toContain('Don’t be deceived');
    expect(d.text).toContain('Martville—hidden');
    expect(d.text).not.toMatch(/&[a-z]+;/i);
    expect(d.attribution).toBe('Redfin listing description');
    expect(d.isMarketingCopy).toBe(true);
  });

  it('leaves ordinary text and unknown entities untouched', () => {
    expect(decodeHtmlEntities('11.46 acres & road frontage')).toBe('11.46 acres & road frontage');
    expect(decodeHtmlEntities('&notarealentity;')).toContain('&notarealentity;');
  });

  it('decodes before claim detection, so an escaped claim is still caught', () => {
    const escaped = detectMarketingClaims(decodeHtmlEntities('Parcel is perc approved &amp; ready to build.'));
    expect(escaped.map((c) => c.claim)).toEqual(expect.arrayContaining(['perc approved', 'ready to build']));
    // Still a CLAIM, never promoted by having been decoded.
    expect(escaped.every((c) => c.status === 'unverified_marketing_claim')).toBe(true);
  });
});

// ── Persistence ─────────────────────────────────────────────────────────────

describe('photo sets persist through the store under the reconciliation gate', () => {
  let compId: number;
  let otherCompId: number;

  beforeEach(() => {
    _initTestLandosDb();
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Comp photo set' });
    addComp({
      entity: 'TY_LAND_BIZ', dealCardId: deal.id, sourceLabel: 'Zillow',
      sourceUrl: 'https://zillow.test/a', addressDesc: '0 McGibbon Rd, Martville, NY 13111',
      price: 54000, priceKind: 'sale', acres: 8.2, saleOrListDate: '2025-07-24',
    });
    addComp({
      entity: 'TY_LAND_BIZ', dealCardId: deal.id, sourceLabel: 'Zillow',
      sourceUrl: 'https://zillow.test/b', addressDesc: '1 Other Rd, Martville, NY 13111',
      price: 40000, priceKind: 'sale', acres: 9, saleOrListDate: '2025-08-01',
    });
    const rows = listComps({ dealCardId: deal.id });
    compId = rows[0].id;
    otherCompId = rows[1].id;
  });

  const detail = (over: Record<string, unknown> = {}) => ({
    compId,
    provider: 'Zillow' as const,
    sourceUrl: 'https://zillow.test/a',
    capturedAtIso: '2026-08-06T12:00:00.000Z',
    image: {
      url: `${ZG}/hero-p_e.jpg`,
      label: 'Zillow listing photo' as const,
      provenance: 'listing_photo' as const,
      tier: 'hero' as const,
      context: 'hero' as const,
      isOriginalListingImage: true,
      sourceProperty: '0 McGibbon Rd',
      reconciledOn: ['retained source page URL', 'address'],
    },
    photos: [
      { url: `${ZG}/hero-p_e.jpg`, sequence: 1, label: 'Zillow listing photo' as const, provenance: 'listing_photo' as const, context: 'hero' as const, isOriginalListingImage: true },
      { url: `${ZG}/two-p_e.jpg`, sequence: 2, label: 'Zillow listing photo' as const, provenance: 'listing_photo' as const, context: 'gallery' as const, isOriginalListingImage: true },
      { url: `${ZG}/three-p_e.jpg`, sequence: 3, label: 'Zillow listing photo' as const, provenance: 'listing_photo' as const, context: 'gallery' as const, isOriginalListingImage: true },
    ],
    events: [],
    unusableRows: [],
    refusedImages: [],
    sourceDescription: 'Wooded 8 acre parcel with road frontage.',
    status: 'SOLD',
    limitation: null,
    reconciliation: {
      matched: true,
      matchedOn: ['retained source page URL', 'address'],
      mismatches: [],
      note: 'Page reconciled to the comparable on retained source page URL, address.',
    },
    ...over,
  });

  it('round-trips the full set with its order and count intact', () => {
    const w = saveCompListingDetail(detail() as never);
    expect(w.persisted).toBe(true);
    const back = loadCompListingDetail(compId)!;
    expect(back.photoCount).toBe(3);
    expect(back.photos!.map((p) => p.sequence)).toEqual([1, 2, 3]);
    expect(back.photos![0].url).toBe(`${ZG}/hero-p_e.jpg`);
  });

  it('promotes the first reconciled gallery photo when enrichment has no separate hero field', () => {
    saveCompListingDetail(detail({
      image: null,
      photos: [
        { url: `${ZG}/detail-first.jpg`, sequence: 1, label: 'Zillow listing photo', provenance: 'listing_photo', context: 'gallery', isOriginalListingImage: true },
        { url: `${ZG}/detail-second.jpg`, sequence: 2, label: 'Zillow listing photo', provenance: 'listing_photo', context: 'gallery', isOriginalListingImage: true },
      ],
      propertyFacts: { address: '0 McGibbon Rd, Martville, NY 13111' },
    }) as never);
    const back = loadCompListingDetail(compId)!;
    expect(back.image?.url).toBe(`${ZG}/detail-first.jpg`);
    expect(listComps({}).find((row) => row.id === compId)?.thumbnail_url).toBe(`${ZG}/detail-first.jpg`);
  });

  it('round-trips structured listing enrichment and provider provenance', () => {
    saveCompListingDetail(detail({
      propertyFacts: {
        address: '0 McGibbon Rd, Martville, NY 13111', acreage: 8.2,
        improvementType: 'cabin', buildingSqft: 900, beds: 2, baths: 1,
        yearBuilt: 1998, utilities: ['electric', 'well'], accessClues: ['gravel drive'], features: ['wooded'],
      },
      sourcePages: [
        { provider: 'LandPortal', url: 'https://landportal.test/a' },
        { provider: 'Zillow', url: 'https://zillow.test/a' },
        { provider: 'Realtor.com', url: 'https://realtor.test/a' },
      ],
    }) as never);
    const back = loadCompListingDetail(compId)!;
    expect(back.propertyFacts).toMatchObject({ improvementType: 'cabin', buildingSqft: 900, utilities: ['electric', 'well'] });
    expect(back.sourcePages?.map((page) => page.provider)).toEqual(['LandPortal', 'Zillow', 'Realtor.com']);
  });

  it('survives a reload, which is what refresh and managed restart both do', () => {
    saveCompListingDetail(detail() as never);
    expect(loadCompListingDetail(compId)!.photos).toHaveLength(3);
    expect(loadCompListingDetail(compId)!.photos).toHaveLength(3);
  });

  it('strips the WHOLE set when the capture did not reconcile', () => {
    saveCompListingDetail(detail({
      compId: otherCompId,
      propertyFacts: { improvementType: 'house', buildingSqft: 1200 },
      sourcePages: [{ provider: 'Realtor.com', url: 'https://realtor.test/wrong' }],
      reconciliation: { matched: false, matchedOn: ['retained source page URL'], mismatches: [], note: 'Capture refused: only 1 identity signal agreed.' },
    }) as never);
    const back = loadCompListingDetail(otherCompId)!;
    expect(back.photos).toEqual([]);
    expect(back.photoCount).toBe(0);
    expect(back.image).toBeNull();
    expect(back.sourceDescription).toBeNull();
    expect(back.propertyFacts).toBeUndefined();
    expect(back.sourcePages).toEqual([]);
  });

  it('never lets a later provider block destroy evidence an earlier capture proved', () => {
    // Found live: re-running the capture hit a Zillow bot interstitial on a comp
    // that had ALREADY given up a reconciled listing photograph, and the refusal
    // was written straight over it. Provider blocking is intermittent, so a
    // refusal must record itself without deleting proven evidence.
    saveCompListingDetail(detail() as never);
    expect(loadCompListingDetail(compId)!.photos).toHaveLength(3);

    const blockedRevisit = saveCompListingDetail(detail({
      photos: [], image: null, sourceDescription: null, events: [],
      limitation: 'Provider served a bot-verification interstitial instead of the property page.',
      reconciliation: { matched: false, matchedOn: ['retained source page URL'], mismatches: [], note: 'Capture refused: only 1 identity signal agreed.' },
    }) as never);

    const after = loadCompListingDetail(compId)!;
    expect(after.photos).toHaveLength(3);
    expect(after.image?.url).toBe(`${ZG}/hero-p_e.jpg`);
    expect(after.sourceDescription).toBe('Wooded 8 acre parcel with road frontage.');
    expect(after.reconciliation.matched).toBe(true);
    // The failed revisit is REPORTED, not hidden.
    expect(blockedRevisit.reason).toMatch(/PRESERVED/);
    expect(after.limitation).toMatch(/bot-verification interstitial/);
    expect(after.limitation).toMatch(/is preserved/);
  });

  it('still refuses a first-ever capture that did not reconcile', () => {
    // Preservation only protects PROVEN evidence; it must not become a loophole
    // that lets an unreconciled capture write an image on a fresh record.
    saveCompListingDetail(detail({
      compId: otherCompId,
      reconciliation: { matched: false, matchedOn: [], mismatches: ['address'], note: 'Capture refused.' },
    }) as never);
    const back = loadCompListingDetail(otherCompId)!;
    expect(back.photos).toEqual([]);
    expect(back.image).toBeNull();
    expect(back.reconciliation.matched).toBe(false);
  });

  it('lifts a legacy single-image capture into a one-photo set rather than losing it', () => {
    const legacy = detail();
    delete (legacy as Record<string, unknown>).photos;
    saveCompListingDetail(legacy as never);
    const back = loadCompListingDetail(compId)!;
    expect(back.photos).toHaveLength(1);
    expect(back.photos![0].url).toBe(`${ZG}/hero-p_e.jpg`);
    expect(back.photos![0].sequence).toBe(1);
  });
});

// ── Projection ──────────────────────────────────────────────────────────────

const projectionBase = {
  transactionKind: 'closed' as const,
  address: '0 McGibbon Rd, Martville, NY 13111',
  apn: null,
  county: 'Oswego',
  state: 'NY',
  acres: 8.2,
  subjectAcres: 11.46,
  distanceMiles: 6.4,
  lat: 43.32,
  lng: -76.68,
  sourceLabel: 'Zillow',
  sourceUrl: 'https://zillow.test/a',
  retainedPrice: 54000,
  retainedPriceKind: 'sale' as const,
  retainedDateIso: '2025-07-24',
  providerDaysOnMarket: null,
  retainedListingDateIso: null,
  visualProvenanceDetail: 'Original listing photograph retained from the Zillow property page.',
  todayIso: '2026-08-06',
};

describe('the projection exposes the gallery and hides the diagnostics', () => {
  it('projects the ordered set with its count and provider', () => {
    const p = buildCompListingProjection({
      ...projectionBase,
      detail: {
        compId: 1, provider: 'Zillow', sourceUrl: 'https://zillow.test/a',
        capturedAtIso: '2026-08-06T12:00:00.000Z',
        image: null,
        photos: [
          { url: `${ZG}/a-p_e.jpg`, sequence: 1, label: 'Zillow listing photo', provenance: 'listing_photo', context: 'hero', isOriginalListingImage: true },
          { url: `${ZG}/b-p_e.jpg`, sequence: 2, label: 'Zillow listing photo', provenance: 'listing_photo', context: 'gallery', isOriginalListingImage: true },
        ],
        events: [], unusableRows: [], refusedImages: [],
        sourceDescription: null, status: null, limitation: null,
        reconciliation: { matched: true, matchedOn: ['address', 'acreage'], mismatches: [], note: 'ok' },
      } as never,
    });
    expect(p.photos.count).toBe(2);
    expect(p.photos.hasGenuinePhotos).toBe(true);
    expect(p.photos.provider).toBe('Zillow');
    expect(p.photos.sourcePage).toBe('https://zillow.test/a');
    expect(p.photos.items.map((i) => i.sequence)).toEqual([1, 2]);
    expect(p.photos.fallbackNote).toBeNull();
  });

  it('projects listing-reported enrichment facts and all reconciled source pages', () => {
    const p = buildCompListingProjection({
      ...projectionBase,
      detail: {
        compId: 1, provider: 'Realtor', sourceUrl: 'https://realtor.test/a',
        capturedAtIso: '2026-08-06T12:00:00.000Z', image: null, photos: [],
        events: [], unusableRows: [], refusedImages: [], sourceDescription: 'Wooded acreage with a cabin.',
        status: 'sold', limitation: null,
        reconciliation: { matched: true, matchedOn: ['address', 'acreage'], mismatches: [], note: 'ok' },
        propertyFacts: {
          address: '0 McGibbon Rd, Martville, NY 13111', acreage: 8.2,
          improvementType: 'cabin', buildingSqft: 900, yearBuilt: 1998,
          utilities: ['electric'], accessClues: ['gravel drive'], features: ['wooded'],
        },
        sourcePages: [
          { provider: 'LandPortal', url: 'https://landportal.test/a' },
          { provider: 'Realtor.com', url: 'https://realtor.test/a' },
        ],
      } as never,
    });
    expect(p.characteristics).toMatchObject({
      provenance: 'listing_reported', improvementType: 'cabin', buildingSqft: 900,
      utilities: ['electric'], accessClues: ['gravel drive'], features: ['wooded'],
    });
    expect(p.evidence.sourcePages).toHaveLength(2);
  });

  it('projects an ordered research-evidence photo list before a full capture exists', () => {
    const p = buildCompListingProjection({
      ...projectionBase,
      detail: null,
      retainedPhotoUrls: [
        { url: `${ZG}/hero-p_e.jpg`, label: 'Zillow listing photo' },
        { url: `${ZG}/drive-p_e.jpg`, label: 'Zillow listing photo' },
      ],
    });
    expect(p.photos.items.map((photo) => photo.url)).toEqual([`${ZG}/hero-p_e.jpg`, `${ZG}/drive-p_e.jpg`]);
    expect(p.photos.items.map((photo) => photo.context)).toEqual(['hero', 'gallery']);
  });

  it('does not promote arbitrary research-evidence URLs into a property gallery', () => {
    const p = buildCompListingProjection({
      ...projectionBase,
      detail: null,
      retainedPhotoUrls: [{ url: 'https://example.com/broker-logo.png', label: 'Listing image' }],
    });
    expect(p.photos.items).toEqual([]);
    expect(p.photos.hasGenuinePhotos).toBe(false);
  });

  it('says WHY there is no gallery, because the reasons need different actions', () => {
    const never = buildCompListingProjection({ ...projectionBase, detail: null });
    expect(never.photos.count).toBe(0);
    expect(never.photos.hasGenuinePhotos).toBe(false);
    expect(never.photos.fallbackNote).toMatch(/has not been checked for photographs yet/);

    const blocked = buildCompListingProjection({
      ...projectionBase,
      detail: {
        compId: 1, provider: 'Zillow', sourceUrl: 'https://zillow.test/a',
        capturedAtIso: '2026-08-06T12:00:00.000Z', image: null, photos: [],
        events: [], unusableRows: [], refusedImages: [],
        sourceDescription: null, status: null,
        limitation: 'Provider served a bot-verification interstitial instead of the property page.',
        reconciliation: { matched: false, matchedOn: [], mismatches: [], note: 'refused' },
      } as never,
    });
    expect(blocked.photos.fallbackNote).toMatch(/would not serve this listing page/);

    const noPhotos = buildCompListingProjection({
      ...projectionBase,
      detail: {
        compId: 1, provider: 'Redfin', sourceUrl: 'https://redfin.test/a',
        capturedAtIso: '2026-08-06T12:00:00.000Z', image: null, photos: [],
        events: [], unusableRows: [], refusedImages: [],
        sourceDescription: null, status: null,
        limitation: 'The property page exposed no photograph of THIS property. 29 image(s) were present but belong to other properties on the page, to site chrome, or to an unestablished position.',
        reconciliation: { matched: true, matchedOn: ['address', 'acreage'], mismatches: [], note: 'ok' },
      } as never,
    });
    // The operator gets the fact, not the refused-image tally that belongs to
    // whoever is debugging the capture.
    expect(noPhotos.photos.fallbackNote).toBe('The listing page published no photograph of this property.');
    expect(noPhotos.photos.fallbackNote).not.toMatch(/image\(s\)|unestablished position|site chrome/);
    expect(noPhotos.evidence.diagnostics.limitation).toMatch(/29 image\(s\)/);
  });

  it('falls back to the photograph the row retains, so the gallery cannot contradict the card', () => {
    // Found live: a blocked Zillow revisit emptied the stored capture while the
    // row kept its reconciled listing photo, so the card showed a real photo and
    // Full details said no photograph was retained.
    const p = buildCompListingProjection({
      ...projectionBase,
      detail: null,
      retainedVisual: { url: `${ZG}/retained-cc_ft_1536.jpg`, label: 'Zillow listing photo' },
    });
    expect(p.photos.count).toBe(1);
    expect(p.photos.hasGenuinePhotos).toBe(true);
    expect(p.photos.items[0].url).toBe(`${ZG}/retained-cc_ft_1536.jpg`);
    expect(p.photos.fallbackNote).toBeNull();
  });

  it('does not let the row fallback outrank a real captured photo set', () => {
    const p = buildCompListingProjection({
      ...projectionBase,
      retainedVisual: { url: `${ZG}/thumb-cc_ft_384.jpg`, label: 'Zillow listing photo' },
      detail: {
        compId: 1, provider: 'Zillow', sourceUrl: 'https://zillow.test/a',
        capturedAtIso: '2026-08-06T12:00:00.000Z', image: null,
        photos: [
          { url: `${ZG}/a-p_e.jpg`, sequence: 1, label: 'Zillow listing photo', provenance: 'listing_photo', context: 'hero', isOriginalListingImage: true },
          { url: `${ZG}/b-p_e.jpg`, sequence: 2, label: 'Zillow listing photo', provenance: 'listing_photo', context: 'gallery', isOriginalListingImage: true },
        ],
        events: [], unusableRows: [], refusedImages: [],
        sourceDescription: null, status: null, limitation: null,
        reconciliation: { matched: true, matchedOn: ['address', 'acreage'], mismatches: [], note: 'ok' },
      } as never,
    });
    expect(p.photos.count).toBe(2);
    expect(p.photos.items[0].url).toBe(`${ZG}/a-p_e.jpg`);
  });

  it('keeps retrieval diagnostics off the operator surface and inside the audit block', () => {
    const p = buildCompListingProjection({ ...projectionBase, detail: null });
    // Operator-facing: where it came from and how to re-check it.
    expect(p.evidence.sourcePage).toBe('https://zillow.test/a');
    expect(p.evidence.provider).toBe('Zillow');
    // Audit-only: still retained, just not part of the layout the operator reads.
    expect(p.evidence.diagnostics.imageProvenance).toMatch(/Original listing photograph/);
    expect(p.evidence.diagnostics.lat).toBe(43.32);
    expect(p.evidence.diagnostics.listingHistoryCompleteness).toBeTruthy();
    expect(p.evidence).not.toHaveProperty('imageProvenance');
    expect(p.evidence).not.toHaveProperty('lat');
    expect(p.evidence).not.toHaveProperty('capturedAtIso');
  });
});
