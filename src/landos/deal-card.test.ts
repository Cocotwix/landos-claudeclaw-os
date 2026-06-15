import { beforeEach, describe, it, expect } from 'vitest';

import { _initTestLandosDb } from './db.js';
import { upsertPropertyCard } from './property-card.js';
import {
  createDealCard,
  listDealCards,
  linkPropertyToDeal,
  getDealCard,
  addPerson,
  linkPerson,
  isOfficialContiguitySource,
  isSourceBackedAuthority,
  leadContactMismatchNote,
  LEAD_OWNER_MISMATCH_NOTE,
} from './deal-card.js';

beforeEach(() => {
  _initTestLandosDb();
});

function card(addr: string, opts: Record<string, unknown> = {}) {
  return upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: addr, ...opts }).card;
}

function verifiedCard(addr: string, apn: string, acres?: number) {
  return upsertPropertyCard({
    entity: 'TY_LAND_BIZ', activeInputAddress: addr, apn, county: 'Lexington', acres,
    verified: true, verificationSource: 'county assessor record (APN + county)',
  }).card;
}

describe('Property Card standalone vs Deal Card', () => {
  it('a property card exists standalone with no deal card', () => {
    const c = card('100 Research Rd, Lexington SC');
    expect(c.id).toBeGreaterThan(0);
    expect(listDealCards({ entity: 'TY_LAND_BIZ' }).length).toBe(0);
  });

  it('a standalone property card can later be linked to a deal card', () => {
    const c = card('101 Later Rd, Lexington SC');
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Smith seller' });
    const link = linkPropertyToDeal({ dealCardId: deal.id, cardId: c.id });
    expect(link.error).toBeUndefined();
    const detail = getDealCard(deal.id)!;
    expect(detail.propertyCards.length).toBe(1);
    expect((detail.propertyCards[0] as any).id).toBe(c.id);
  });

  it('a deal card works in research mode: a property and zero contacts', () => {
    const c = card('103 Research Mode Rd, Lexington SC');
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Research only' });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: c.id });
    const detail = getDealCard(deal.id)!;
    expect(detail.propertyCards.length).toBe(1);
    expect(detail.people.length).toBe(0); // no seller invented
  });

  it('one deal card links one property card', () => {
    const c = verifiedCard('102 One Rd, Lexington SC', 'A102', 5);
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'One parcel deal', askingPrice: 30000 });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: c.id, role: 'subject' });
    const detail = getDealCard(deal.id)!;
    expect(detail.propertyCards.length).toBe(1);
    expect(detail.asking_price).toBe(30000);
  });
});

describe('Multi-parcel deals without merging', () => {
  it('multiple APNs are separate property cards linked under one deal', () => {
    const a = verifiedCard('200 Pkg Rd, Lexington SC', 'APN-A', 7);
    const b = verifiedCard('202 Pkg Rd, Lexington SC', 'APN-B', 6);
    const cc = verifiedCard('204 Pkg Rd, Lexington SC', 'APN-C', 7);
    // Distinct cards — never merged.
    expect(new Set([a.id, b.id, cc.id]).size).toBe(3);
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: '20-acre package', combinedStrategy: 'package flip' });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: a.id, role: 'subject' });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: b.id, role: 'package_member' });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: cc.id, role: 'package_member' });
    const detail = getDealCard(deal.id)!;
    expect(detail.propertyCards.length).toBe(3);
    // Each parcel keeps its own identity.
    expect((detail.propertyCards as any[]).map((p) => p.apn).sort()).toEqual(['APN-A', 'APN-B', 'APN-C']);
  });

  it('combined acreage is verified only when every parcel is verified', () => {
    const a = verifiedCard('210 Mix Rd, Lexington SC', 'APN-D', 5);
    const weak = card('212 Mix Rd, Lexington SC'); // unverified, no acreage
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Mixed package' });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: a.id });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: weak.id });
    const detail = getDealCard(deal.id)!;
    expect(detail.combinedAcreage.verified).toBe(false);
    expect(detail.combinedAcreage.label).toMatch(/PRELIMINARY/);

    const allVerified = createDealCard({ entity: 'TY_LAND_BIZ', title: 'All verified' });
    const b = verifiedCard('214 Mix Rd, Lexington SC', 'APN-E', 8);
    linkPropertyToDeal({ dealCardId: allVerified.id, cardId: a.id });
    linkPropertyToDeal({ dealCardId: allVerified.id, cardId: b.id });
    const detail2 = getDealCard(allVerified.id)!;
    expect(detail2.combinedAcreage.verified).toBe(true);
    expect(detail2.combinedAcreage.acres).toBe(13);
  });

  it('seller-stated contiguity is stored as context only', () => {
    const a = verifiedCard('220 Touch Rd, Lexington SC', 'APN-F', 5);
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Contiguous?' });
    const sellerStated = linkPropertyToDeal({
      dealCardId: deal.id, cardId: a.id, contiguityStatus: 'seller_stated', note: 'seller says these touch',
    });
    expect(sellerStated.error).toBeUndefined();
    expect(sellerStated.contiguityStatus).toBe('seller_stated');
    const detail = getDealCard(deal.id)!;
    expect((detail.propertyCards[0] as any).contiguity_status).toBe('seller_stated');
  });

  it('source_confirmed contiguity is downgraded unless backed by OFFICIAL evidence', () => {
    const a = verifiedCard('221 Touch Rd, Lexington SC', 'APN-F2', 5);
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Contiguous2?' });

    // blank source -> downgraded to seller_stated with a warning.
    const blank = linkPropertyToDeal({ dealCardId: deal.id, cardId: a.id, contiguityStatus: 'source_confirmed' });
    expect(blank.contiguityStatus).toBe('seller_stated');
    expect(blank.warning).toMatch(/official/i);

    // "seller says they touch" is not official.
    const seller = linkPropertyToDeal({
      dealCardId: deal.id, cardId: a.id, contiguityStatus: 'source_confirmed', contiguitySource: 'seller says they touch',
    });
    expect(seller.contiguityStatus).toBe('seller_stated');

    // generic note is not official.
    const generic = linkPropertyToDeal({
      dealCardId: deal.id, cardId: a.id, contiguityStatus: 'source_confirmed', contiguitySource: 'a note I wrote',
    });
    expect(generic.contiguityStatus).toBe('seller_stated');

    // marketplace pages are not official.
    for (const url of ['https://www.zillow.com/x', 'https://www.redfin.com/x', 'https://www.countyoffice.org/x']) {
      const mk = linkPropertyToDeal({ dealCardId: deal.id, cardId: a.id, contiguityStatus: 'source_confirmed', contiguitySource: url });
      expect(mk.contiguityStatus).toBe('seller_stated');
    }
  });

  it('source_confirmed contiguity is accepted with official GIS/assessor/plat/deed/survey evidence', () => {
    const a = verifiedCard('222 Touch Rd, Lexington SC', 'APN-F3', 5);
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Contiguous3?' });
    for (const src of [
      'https://gis.lexingtoncounty.gov/parcel/123',
      'county assessor parcel map',
      'recorded plat 2024-117',
      'recorded deed legal description confirms adjoining parcels',
      'official survey by licensed surveyor',
    ]) {
      const res = linkPropertyToDeal({
        dealCardId: deal.id, cardId: a.id, contiguityStatus: 'source_confirmed', contiguitySource: src,
      });
      expect(res.contiguityStatus, src).toBe('source_confirmed');
      expect(res.warning).toBeUndefined();
    }
    // Accepting contiguity never merges parcels or alters parcel identity.
    const detail = getDealCard(deal.id)!;
    expect((detail.propertyCards[0] as any).apn).toBe('APN-F3');
  });

  it('a generic/unrelated .gov source does NOT confirm contiguity', () => {
    const a = verifiedCard('223 Gov Rd, Lexington SC', 'APN-G1', 5);
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Gov contiguity?' });
    for (const src of ['https://www.irs.gov/forms', 'https://lexingtoncounty.gov', 'https://www.epa.gov/page', 'county tax office']) {
      const res = linkPropertyToDeal({ dealCardId: deal.id, cardId: a.id, contiguityStatus: 'source_confirmed', contiguitySource: src });
      expect(res.contiguityStatus, src).toBe('seller_stated');
      expect(res.warning).toBeTruthy();
    }
    expect(isOfficialContiguitySource('https://www.irs.gov/forms')).toBe(false);
    expect(isOfficialContiguitySource('https://lexingtoncounty.gov')).toBe(false);
  });

  it('a county GIS / parcel-viewer source confirms contiguity (parcel-boundary specific)', () => {
    expect(isOfficialContiguitySource('https://gismaps.lexingtoncounty.gov/parcelviewer')).toBe(true);
    expect(isOfficialContiguitySource('county parcel viewer (city planning)')).toBe(true);
    expect(isOfficialContiguitySource('county assessor parcel map')).toBe(true);
    const a = verifiedCard('224 Gov Rd, Lexington SC', 'APN-G2', 5);
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'GIS contiguity' });
    const res = linkPropertyToDeal({
      dealCardId: deal.id, cardId: a.id, contiguityStatus: 'source_confirmed',
      contiguitySource: 'https://gismaps.lexingtoncounty.gov/parcelviewer',
    });
    expect(res.contiguityStatus).toBe('source_confirmed');
    expect(res.warning).toBeUndefined();
  });

  it('same owner/county alone does not merge property cards', () => {
    const a = card('230 Owner Rd, Lexington SC', { owner: 'Jane Smith', county: 'Lexington' });
    const b = card('232 Owner Rd, Lexington SC', { owner: 'Jane Smith', county: 'Lexington' });
    expect(a.id).not.toBe(b.id);
  });
});

describe('People / contacts without implied authority', () => {
  it('multiple people attach to a deal card; relationship never implies signing authority', () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Inherited property' });
    const heir = addPerson({ entity: 'TY_LAND_BIZ', name: 'Heir One', phone: '555-1111' });
    const sibling = addPerson({ entity: 'TY_LAND_BIZ', name: 'Sibling Two' });
    linkPerson({ personId: heir, dealCardId: deal.id, role: 'heir' });
    linkPerson({ personId: sibling, dealCardId: deal.id, role: 'sibling' });
    const detail = getDealCard(deal.id)!;
    expect(detail.people.length).toBe(2);
    // Defaults to 'unknown' authority — never can_sign just from a role.
    expect((detail.people as any[]).every((p) => p.authority_status === 'unknown')).toBe(true);
    expect((detail.people as any[]).some((p) => p.authority_status === 'can_sign')).toBe(false);
  });

  it('can_sign is downgraded to title_to_confirm without source-backed evidence', () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Unsourced authority' });
    const heir = addPerson({ entity: 'TY_LAND_BIZ', name: 'Heir Claims' });
    const sibling = addPerson({ entity: 'TY_LAND_BIZ', name: 'Sibling Claims' });
    const probate = addPerson({ entity: 'TY_LAND_BIZ', name: 'Probate Person' });

    // can_sign with blank source -> downgraded + warning.
    const blank = linkPerson({ personId: heir, dealCardId: deal.id, role: 'heir', authorityStatus: 'can_sign' });
    expect(blank.authorityStatus).toBe('title_to_confirm');
    expect(blank.warning).toMatch(/source-backed/i);

    // can_sign justified only by "seller said so" -> downgraded.
    const hearsay = linkPerson({
      personId: sibling, dealCardId: deal.id, role: 'sibling',
      authorityStatus: 'can_sign', authoritySource: 'seller said sibling can sign',
    });
    expect(hearsay.authorityStatus).toBe('title_to_confirm');

    // can_sign justified only by relationship -> downgraded.
    const relation = linkPerson({
      personId: probate, dealCardId: deal.id, role: 'probate_contact',
      authorityStatus: 'can_sign', authoritySource: 'he is the heir',
    });
    expect(relation.authorityStatus).toBe('title_to_confirm');
  });

  it('can_sign is accepted with attorney/title/deed/probate source and stores it', () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Sourced authority' });
    for (const src of [
      'deed confirmed by title company',
      'attorney confirmation of authority',
      'probate court letters testamentary, executor',
      'recorded deed shows person as owner',
    ]) {
      const p = addPerson({ entity: 'TY_LAND_BIZ', name: `Signer ${src.slice(0, 6)}` });
      const res = linkPerson({ personId: p, dealCardId: deal.id, role: 'record_owner', authorityStatus: 'can_sign', authoritySource: src });
      expect(res.authorityStatus, src).toBe('can_sign');
      expect(res.warning).toBeUndefined();
    }
    const detail = getDealCard(deal.id)!;
    expect((detail.people as any[]).some((p) => p.authority_status === 'can_sign' && p.authority_source)).toBe(true);
  });

  it('a generic .gov source does NOT grant can_sign; an ownership/deed .gov source does', () => {
    expect(isSourceBackedAuthority('https://www.irs.gov')).toBe(false);
    expect(isSourceBackedAuthority('https://lexingtoncounty.gov')).toBe(false);
    expect(isSourceBackedAuthority('county property search homepage')).toBe(false);
    expect(isSourceBackedAuthority('https://deeds.lexingtoncounty.gov — owner of record')).toBe(true);
    expect(isSourceBackedAuthority('recorded deed shows person as owner')).toBe(true);

    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Gov authority' });
    const p1 = addPerson({ entity: 'TY_LAND_BIZ', name: 'Gov Page Person' });
    const downgraded = linkPerson({ personId: p1, dealCardId: deal.id, role: 'record_owner', authorityStatus: 'can_sign', authoritySource: 'https://www.irs.gov' });
    expect(downgraded.authorityStatus).toBe('title_to_confirm');
    const p2 = addPerson({ entity: 'TY_LAND_BIZ', name: 'Deed Owner' });
    const accepted = linkPerson({ personId: p2, dealCardId: deal.id, role: 'record_owner', authorityStatus: 'can_sign', authoritySource: 'official county ownership record (owner of record)' });
    expect(accepted.authorityStatus).toBe('can_sign');
  });

  it('lead-contact vs record-owner mismatch is a neutral note (no probate/rejection auto-tag)', () => {
    const same = leadContactMismatchNote('Jane Smith', 'Jane Smith');
    expect(same.mismatch).toBe(false);
    expect(same.note).toBe('');
    const diff = leadContactMismatchNote('Bob Wholesaler', 'Jane Smith');
    expect(diff.mismatch).toBe(true);
    expect(diff.note).toBe(LEAD_OWNER_MISMATCH_NOTE);
    expect(diff.note).toContain('Confirm relationship and authority');
    // Neutral: does not assert probate/inheritance as fact.
    expect(diff.note).not.toMatch(/probate confirmed|is an heir|inheritance confirmed/i);
  });

  it('a wholesaler / lead_contact is attached without becoming owner or can_sign', () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Wholesaler lead' });
    const wholesaler = addPerson({ entity: 'TY_LAND_BIZ', name: 'Wendy Wholesaler', phone: '555-9000' });
    const link = linkPerson({ personId: wholesaler, dealCardId: deal.id, role: 'wholesaler' });
    expect(link.error).toBeUndefined();
    const detail = getDealCard(deal.id)!;
    const person: any = detail.people[0];
    expect(person.role).toBe('wholesaler');
    expect(person.authority_status).toBe('unknown'); // never owner, never can_sign by default
  });

  it('people can attach to a property card as well as a deal card', () => {
    const c = verifiedCard('240 Person Rd, Lexington SC', 'APN-P', 4);
    const attorney = addPerson({ entity: 'TY_LAND_BIZ', name: 'Probate Atty' });
    const link = linkPerson({ personId: attorney, cardId: c.id, role: 'probate_contact' });
    expect(link.error).toBeUndefined();
    expect(link.id).toBeGreaterThan(0);
  });

  it('a person link needs at least a deal or a card', () => {
    const p = addPerson({ entity: 'TY_LAND_BIZ', name: 'Floating' });
    expect(linkPerson({ personId: p, role: 'seller' }).error).toBeTruthy();
  });
});
