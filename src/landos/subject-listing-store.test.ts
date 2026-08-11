import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb, getLandosDb } from './db.js';
import { createDealCard } from './deal-card.js';
import { extractListingEvidence, EXACT_ADDRESS_LANE_ID } from './exact-address-web-discovery.js';
import type { CanonicalPropertyInput, PropertyProviderResult } from './property-intelligence-contract.js';
import { PropertyResearchStore, resetPropertyResearchStoreCache } from './property-research-store.js';
import {
  loadSubjectListingDetail,
  parseSubjectListingDetail,
  resetSubjectListingStoreCache,
  saveSubjectListingDetail,
} from './subject-listing-store.js';

let property: CanonicalPropertyInput;

beforeEach(() => {
  _initTestLandosDb();
  resetSubjectListingStoreCache();
  resetPropertyResearchStoreCache();
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Subject listing persistence' });
  const db = getLandosDb();
  const inserted = db.prepare(`
    INSERT INTO landos_property_card (
      entity, active_input_address, address_key, city, state, zip, county
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'TY_LAND_BIZ',
    '9490 Elk Lake Rd, Williamsburg, MI 49690',
    '9490 elk lake rd williamsburg mi 49690',
    'Williamsburg', 'MI', '49690', 'Grand Traverse',
  );
  const propertyCardId = Number(inserted.lastInsertRowid);
  db.prepare('INSERT INTO landos_deal_card_property (deal_card_id, card_id, role) VALUES (?, ?, ?)')
    .run(deal.id, propertyCardId, 'subject');
  property = {
    propertyCardId,
    dealCardId: deal.id,
    normalizedAddress: '9490 elk lake rd williamsburg mi 49690',
    address: '9490 Elk Lake Rd',
    city: 'Williamsburg', county: 'Grand Traverse', state: 'MI', zip: '49690',
    apn: null, fips: null, landPortalPropertyId: null,
  };
});

function staleRedfinPage() {
  return extractListingEvidence({
    url: 'https://www.redfin.com/MI/Williamsburg/9490-Elk-Lake-Rd-49690/home/143868919',
    retrievedAt: '2026-08-12T14:15:00.000Z',
    text: `Listing status: Off market. 9490 Elk Lake Rd. 60 acres. MLS # 80071245.
      This home is no longer available.`,
  });
}

function zillowPage(exposesEngagement = true) {
  return extractListingEvidence({
    url: 'https://www.zillow.com/homedetails/9490-Elk-Lake-Rd-Williamsburg-MI-49690/243126665_zpid/',
    retrievedAt: '2026-08-11T14:15:00.000Z',
    text: `Listing status: Active. Current price: $1,450,000. Original list price: $1,595,000.
      Listed on 07/19/2026. 23 days on Zillow. Single-family home, 4 beds, 3 baths,
      2,750 sqft, built in 2001, on 60 acres. Well, septic, electric and propane.
      Public remarks: Improved rural estate with a house, barn and detached garage.
      Listed by: North Woods Realty. MLS # 1923456.
      ${exposesEngagement ? '8,421 views. 317 saves.' : ''}
      https://photos.zillowstatic.com/fp/primary.jpg
      https://photos.zillowstatic.com/fp/second.webp`,
  });
}

describe('subject listing detail persistence', () => {
  it('stores first-class subject evidence on the existing canonical Property Card', () => {
    const write = saveSubjectListingDetail({
      propertyCardId: property.propertyCardId,
      dealCardId: property.dealCardId,
      canonicalAddress: '9490 Elk Lake Rd, Williamsburg, MI 49690',
      completedAtIso: '2026-08-11T14:15:01.000Z',
      result: {
        status: 'retrieved',
        queries: ['9490 Elk Lake Rd, Williamsburg, MI 49690'],
        pages: [zillowPage()],
        note: 'The property-specific page was opened and read.',
      },
    });
    expect(write).toMatchObject({ attempted: true, persisted: true, retainedSourceCount: 1, newlyStoredSourceCount: 1 });

    const stored = loadSubjectListingDetail(property.propertyCardId)!;
    expect(stored.propertyCardId).toBe(property.propertyCardId);
    expect(stored.projection.subjectRead?.improved).toBe(true);
    expect(stored.projection.listingCard).toMatchObject({
      active: true,
      currentPrice: 1_450_000,
      primaryPhotoUrl: 'https://photos.zillowstatic.com/fp/primary.jpg',
      additionalPhotoUrls: ['https://photos.zillowstatic.com/fp/second.webp'],
      zillowEngagement: {
        views: 8421, saves: 317, retrievedAt: '2026-08-11T14:15:00.000Z',
      },
      evidenceLabel: 'Listing-reported',
    });
    expect(getLandosDb().prepare('SELECT count(*) AS n FROM landos_property_card').get()).toMatchObject({ n: 1 });
  });

  it('persists unavailable Zillow counts as null with the retrieval timestamp, never zero', () => {
    saveSubjectListingDetail({
      propertyCardId: property.propertyCardId,
      dealCardId: property.dealCardId,
      canonicalAddress: '9490 Elk Lake Rd, Williamsburg, MI 49690',
      completedAtIso: '2026-08-11T14:15:01.000Z',
      result: { status: 'retrieved', queries: ['9490 Elk Lake Rd, Williamsburg, MI 49690'], pages: [zillowPage(false)], note: 'Read.' },
    });
    const signal = loadSubjectListingDetail(property.propertyCardId)?.projection.listingCard?.zillowEngagement;
    expect(signal).toEqual({
      provider: 'zillow',
      sourceLabel: 'zillow.com',
      sourceUrl: 'https://www.zillow.com/homedetails/9490-Elk-Lake-Rd-Williamsburg-MI-49690/243126665_zpid/',
      views: null, saves: null,
      viewsAvailability: 'unavailable', savesAvailability: 'unavailable',
      listingAgeDays: 23, listingAgeAvailability: 'available',
      photoCount: 2, photoCountAvailability: 'available',
      priceChangeCount: null, priceChangeAvailability: 'unavailable',
      retrievedAt: '2026-08-11T14:15:00.000Z',
    });
    expect(signal?.views).not.toBe(0);
    expect(signal?.saves).not.toBe(0);
    expect(signal?.priceChangeCount).not.toBe(0);
  });

  it('records a blocked revisit without erasing previously retained listing facts or photos', () => {
    saveSubjectListingDetail({
      propertyCardId: property.propertyCardId, dealCardId: property.dealCardId,
      canonicalAddress: property.address, completedAtIso: '2026-08-11T14:15:01.000Z',
      result: { status: 'retrieved', queries: [property.address], pages: [zillowPage()], note: 'Read.' },
    });
    const write = saveSubjectListingDetail({
      propertyCardId: property.propertyCardId, dealCardId: property.dealCardId,
      canonicalAddress: property.address, completedAtIso: '2026-08-12T14:15:01.000Z',
      result: { status: 'blocked', queries: [property.address], pages: [], note: 'Provider blocked the revisit.' },
    });
    expect(write).toMatchObject({ persisted: true, retainedSourceCount: 1, newlyStoredSourceCount: 0 });
    const stored = loadSubjectListingDetail(property.propertyCardId)!;
    expect(stored.latestAttempt.status).toBe('blocked');
    expect(stored.projection.listingCard?.primaryPhotoUrl).toContain('primary.jpg');
    expect(stored.projection.note).toMatch(/previously retained listing evidence remains/i);
  });

  it('merges a revisit by record identity instead of replacing the retained set', () => {
    saveSubjectListingDetail({
      propertyCardId: property.propertyCardId, dealCardId: property.dealCardId,
      canonicalAddress: property.address, completedAtIso: '2026-08-11T14:15:01.000Z',
      result: { status: 'retrieved', queries: [property.address], pages: [zillowPage()], note: 'Read.' },
    });
    // The revisit returns ONLY the stale off-market duplicate for the same property.
    const write = saveSubjectListingDetail({
      propertyCardId: property.propertyCardId, dealCardId: property.dealCardId,
      canonicalAddress: property.address, completedAtIso: '2026-08-12T14:15:01.000Z',
      result: { status: 'retrieved', queries: [property.address], pages: [staleRedfinPage()], note: 'Read.' },
    });
    expect(write).toMatchObject({ persisted: true, retainedSourceCount: 2, newlyStoredSourceCount: 1 });

    const stored = loadSubjectListingDetail(property.propertyCardId)!;
    expect(stored.retainedPages).toHaveLength(2);
    expect(stored.retention).toMatchObject({ mergedRecordCount: 2, newRecordCount: 1, preservedRecordCount: 1 });
    // The good current evidence survives the thinner revisit and stays current.
    expect(stored.projection.listingCard?.primaryPhotoUrl).toContain('primary.jpg');
    expect(stored.projection.listingCard?.currentPrice).toBe(1_450_000);
    expect(stored.projection.reconciliation?.canonical.recordCount).toBe(2);
    expect(stored.projection.reconciliation?.currentRecord?.sourceUrl).toContain('zillow.com');
    expect(stored.projection.reconciliation?.supersededRecords[0]).toMatchObject({ listingStatusCode: 'off_market' });
    expect(getLandosDb().prepare('SELECT count(*) AS n FROM landos_property_card').get()).toMatchObject({ n: 1 });
  });

  it('refreshes the same record in place without losing facts the revisit dropped', () => {
    saveSubjectListingDetail({
      propertyCardId: property.propertyCardId, dealCardId: property.dealCardId,
      canonicalAddress: property.address, completedAtIso: '2026-08-11T14:15:01.000Z',
      result: { status: 'retrieved', queries: [property.address], pages: [zillowPage()], note: 'Read.' },
    });
    const thinner = extractListingEvidence({
      url: 'https://www.zillow.com/homedetails/9490-Elk-Lake-Rd-Williamsburg-MI-49690/243126665_zpid/',
      retrievedAt: '2026-08-12T14:15:00.000Z',
      text: 'Listing status: Active. 9490 Elk Lake Rd.',
    });
    const write = saveSubjectListingDetail({
      propertyCardId: property.propertyCardId, dealCardId: property.dealCardId,
      canonicalAddress: property.address, completedAtIso: '2026-08-12T14:15:01.000Z',
      result: { status: 'retrieved', queries: [property.address], pages: [thinner], note: 'Read.' },
    });
    expect(write).toMatchObject({ retainedSourceCount: 1, newlyStoredSourceCount: 1 });
    const stored = loadSubjectListingDetail(property.propertyCardId)!;
    expect(stored.retention).toMatchObject({ mergedRecordCount: 1, newRecordCount: 0, refreshedRecordCount: 1 });
    expect(stored.retainedPages[0]).toMatchObject({ retrievedAt: '2026-08-12T14:15:00.000Z', yearBuilt: 2001, beds: 4 });
    expect(stored.projection.listingCard?.primaryPhotoUrl).toContain('primary.jpg');
  });

  // A stored value re-enters the operator's read through the retention merge,
  // with a current retrieval time, so it is re-tested on the way in.
  it('drops a retained value that could not be captured today and falls through to the next-best record', () => {
    const STORED_JUNK_BROKERAGE = 'services , Consumer protection notice California DRE #01937601 Contact '
      + 'Homes.com Brokerage About Us Advertise Terms of Use Builder Terms of Use Privacy Notice E';
    const homesUrl = 'https://www.homes.com/property/9490-elk-lake-rd-williamsburg-mi/123/';
    const homesRecord = {
      ...extractListingEvidence({
        url: homesUrl,
        retrievedAt: '2026-08-12T14:15:00.000Z',
        text: 'Listing status: Active. 9490 Elk Lake Rd. Current price: $1,450,000. Single-family home, 60 acres.',
      }),
      // Stored by an earlier visit, before these fields were tested at all.
      brokerage: STORED_JUNK_BROKERAGE,
      mls: 'Data',
    };
    const redfinRecord = extractListingEvidence({
      url: 'https://www.redfin.com/MI/Williamsburg/9490-Elk-Lake-Rd-49690/home/143868919',
      retrievedAt: '2026-08-11T14:15:00.000Z',
      text: `Listing status: Active. 9490 Elk Lake Rd. Current price: $1,450,000. Single-family home, 60 acres.
        Listed by: Kathy Wittbrodt. MLS # 80071245.`,
    });

    saveSubjectListingDetail({
      propertyCardId: property.propertyCardId, dealCardId: property.dealCardId,
      canonicalAddress: property.address, completedAtIso: '2026-08-12T14:15:01.000Z',
      result: { status: 'retrieved', queries: [property.address], pages: [homesRecord, redfinRecord], note: 'Read.' },
    });

    const stored = loadSubjectListingDetail(property.propertyCardId)!;
    const homes = stored.retainedPages.find((page) => page.sourceUrl === homesUrl)!;
    expect(homes.brokerage).toBeNull();
    expect(homes.mls).toBeNull();
    expect(JSON.stringify(stored.retainedPages)).not.toContain('Terms of Use');
    // The card source is the freshest record; the brokerage falls through.
    expect(stored.projection.listingCard).toMatchObject({
      sourceLabel: 'homes.com',
      brokerage: 'Kathy Wittbrodt',
      mls: '80071245',
    });
    expect(stored.projection.listingCard?.fieldSources.brokerage).toMatchObject({
      sourceLabel: 'redfin.com', fromCardSource: false,
    });
  });

  it('refuses to create listing evidence for a missing canonical property/deal link', () => {
    const write = saveSubjectListingDetail({
      propertyCardId: 999999, dealCardId: property.dealCardId,
      canonicalAddress: property.address, completedAtIso: '2026-08-11T14:15:01.000Z',
      result: { status: 'retrieved', queries: [property.address], pages: [zillowPage()], note: 'Read.' },
    });
    expect(write).toMatchObject({ attempted: true, persisted: false });
    expect(write.reason).toMatch(/canonical property\/deal link not found/i);
  });

  it('is null-safe for missing and corrupt stored payloads', () => {
    expect(parseSubjectListingDetail(null)).toBeNull();
    expect(parseSubjectListingDetail('')).toBeNull();
    expect(parseSubjectListingDetail('{not json')).toBeNull();
  });
});

describe('exact-address lane attempt trail', () => {
  it('reports persistence attempted and completed with the truth of the subject evidence stored', () => {
    const page = zillowPage();
    const result: PropertyProviderResult = {
      contractVersion: 'property-provider-v1',
      runId: 'exact-address-run-1', laneId: EXACT_ADDRESS_LANE_ID, providerId: EXACT_ADDRESS_LANE_ID,
      input: property,
      execution: {
        attempted: true, startedAt: '2026-08-11T14:14:00.000Z', completedAt: '2026-08-11T14:15:01.000Z',
        durationMs: 61_000,
        result: { status: 'retrieved', queries: ['9490 Elk Lake Rd, Williamsburg, MI 49690'], pages: [page], note: 'Read.' },
      },
      validation: { valid: true, subjectClassification: 'context_only', checks: [], rejectedEvidenceIds: [] },
      evidence: [{
        id: `exact-address:0:${page.sourceUrl}`,
        propertyCardId: property.propertyCardId, dealCardId: property.dealCardId,
        providerId: EXACT_ADDRESS_LANE_ID,
        field: 'discovery.exact_address.listing.1', value: page,
        subjectClassification: 'context_only', strength: 'provider_observed',
        sourceUrl: page.sourceUrl, retrievedAt: page.retrievedAt!, confidence: 'medium', kind: 'fact',
        validation: { valid: true, reasons: [] },
      }],
      status: 'context_only',
      persistence: { attempted: false, persisted: false, retainedEvidenceCount: 0, rejectedEvidenceCount: 0, reason: null },
      failureReason: null,
    };

    const persisted = new PropertyResearchStore().persistProviderResult(result);
    expect(persisted.persistence).toMatchObject({ attempted: true, persisted: true, retainedEvidenceCount: 1 });
    expect(persisted.persistence.reason).toMatch(/1 exact-address listing source/i);
    expect(new PropertyResearchStore().listLaneAttempts(property.propertyCardId)[0].persistence)
      .toEqual(persisted.persistence);
    expect(loadSubjectListingDetail(property.propertyCardId)?.retainedPages).toHaveLength(1);
  });
});
