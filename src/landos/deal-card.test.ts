import { beforeEach, describe, it, expect } from 'vitest';

import { _initTestLandosDb, getLandosDb } from './db.js';
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
  upsertDealCardFromDukeRun,
  upsertDealCardFromMultiParcelDukeRun,
  sanitizeUnverifiedSummary,
} from './deal-card.js';
import { getPropertyCard } from './property-card.js';

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

describe('Unverified summary sanitizer + bridge', () => {
  it('sanitizeUnverifiedSummary replaces score/value/offer language, keeps neutral text', () => {
    expect(sanitizeUnverifiedSummary('Duke could not verify the parcel. Confirm APN.'))
      .toBe('Duke could not verify the parcel. Confirm APN.');
    for (const bad of [
      'Likely parcel worth around $42,000, offer range $12,000 to $18,000',
      'Land Score 72/100',
      'EV approx 40k; recommend MAO 15k',
      'comp-supported value suggests strong margin',
    ]) {
      expect(sanitizeUnverifiedSummary(bad)).toMatch(/not definitively verified/i);
      // No value/offer DATA survives (dollar figures, score, EV/MAO/ARV). The
      // instructional words "scoring/valuing/offer guidance" are allowed.
      expect(sanitizeUnverifiedSummary(bad)).not.toMatch(/\$\s?\d|\d+\s*\/\s*100|\bEV\b|\bMAO\b|\bARV\b/i);
    }
  });

  it('an unverified bridge writeback does not persist score/value/offer summary', () => {
    const res = upsertDealCardFromDukeRun({
      entity: 'TY_LAND_BIZ',
      activeInputAddress: '70 Unverified Rd, Lexington SC',
      county: 'Lexington', state: 'SC', verified: false,
      summary: 'Likely worth around $42,000; recommend offer range $12,000-$18,000. Land Score 60/100.',
    })!;
    expect(res.verificationStatus).not.toBe('verified_property');
    const detail = getPropertyCard(res.cardId)!;
    expect(detail.summary).not.toMatch(/\$\s?\d|\d+\s*\/\s*100|\bEV\b|\bMAO\b|\bARV\b/i);
    expect(detail.summary).toMatch(/not definitively verified/i);
  });

  it('a verified bridge writeback keeps valuation/offer summary', () => {
    const res = upsertDealCardFromDukeRun({
      entity: 'TY_LAND_BIZ',
      activeInputAddress: '71 Verified Rd, Lexington SC',
      apn: 'V71', county: 'Lexington', fips: '45063', verified: true,
      verificationSource: 'lp_resolve_property address filter, verified:true',
      summary: 'Land Score 78/100. EV $55,000; offer range $24,000-$30,000.',
    })!;
    expect(res.verificationStatus).toBe('verified_property');
    const detail = getPropertyCard(res.cardId)!;
    expect(detail.summary).toMatch(/offer range/i); // preserved when verified
  });
});

describe('Multi-APN one Deal Card writeback', () => {
  it('links multiple distinct property records to ONE Deal Card; never merges APNs', () => {
    const res = upsertDealCardFromMultiParcelDukeRun({
      entity: 'TY_LAND_BIZ',
      agentId: 'duke-due-diligence',
      dealContext: { title: 'Three parcels from one seller' },
      parcels: [
        { activeInputAddress: '1 Pkg Rd, Lexington SC', apn: 'MA-1', county: 'Lexington', fips: '45063', acres: 5, verified: true, verificationSource: 'county assessor record (APN + county)', recordOwnerName: 'Jane Owner' },
        { activeInputAddress: '3 Pkg Rd, Lexington SC', apn: 'MA-2', county: 'Lexington', fips: '45063', acres: 6, verified: true, verificationSource: 'lp_resolve_property address filter, verified:true', lpPropertyId: 'LP2', lpUrl: 'https://landportal.example/p/2' },
        { activeInputAddress: '5 Pkg Rd, Swansea SC', county: 'Lexington', state: 'SC', verified: false, summary: 'zero candidates; likely worth $30,000 offer $9,000' },
      ],
    })!;
    expect(res.createdDeal).toBe(true);
    expect(res.properties.length).toBe(3);
    // Distinct cards, APNs not merged.
    expect(new Set(res.properties.map((p) => p.cardId)).size).toBe(3);
    const detail = getDealCard(res.dealCardId)!;
    expect(detail.propertyCount).toBe(3);
    expect((detail.propertyCards as any[]).map((p) => p.apn).filter(Boolean).sort()).toEqual(['MA-1', 'MA-2']);
  });

  it('verified and unverified properties coexist; unverified gets no value/score/offer', () => {
    const res = upsertDealCardFromMultiParcelDukeRun({
      entity: 'TY_LAND_BIZ',
      parcels: [
        { activeInputAddress: '10 Mix Rd, Lexington SC', apn: 'MIX-1', county: 'Lexington', verified: true, verificationSource: 'county assessor record' },
        { activeInputAddress: '12 Mix Rd, Lexington SC', verified: false, summary: 'Likely worth $42,000; recommend offer $12,000. Score 60/100.' },
      ],
    })!;
    const verified = res.properties.find((p) => p.verificationStatus === 'verified_property')!;
    const unverified = res.properties.find((p) => p.verificationStatus !== 'verified_property')!;
    expect(verified).toBeTruthy();
    expect(unverified).toBeTruthy();
    const u = getPropertyCard(unverified.cardId)!;
    expect(u.summary).not.toMatch(/\$\s?\d|\d+\s*\/\s*100|\boffer\b\s*\$|\bMAO\b/i);
    expect(u.summary).toMatch(/not definitively verified/i);
  });

  it('same owner across parcels does NOT create contiguity', () => {
    const res = upsertDealCardFromMultiParcelDukeRun({
      entity: 'TY_LAND_BIZ',
      parcels: [
        { activeInputAddress: '20 Same Rd, Lexington SC', apn: 'SO-1', county: 'Lexington', owner: 'Same Owner', verified: true, verificationSource: 'county assessor record' },
        { activeInputAddress: '22 Same Rd, Lexington SC', apn: 'SO-2', county: 'Lexington', owner: 'Same Owner', verified: true, verificationSource: 'county assessor record' },
      ],
    })!;
    const detail = getDealCard(res.dealCardId)!;
    // No link is marked source_confirmed just because the owner matches.
    expect((detail.propertyCards as any[]).every((p) => p.contiguity_status !== 'source_confirmed')).toBe(true);
  });

  it('LandPortal URL passes through only when provided per property, never fabricated', () => {
    const res = upsertDealCardFromMultiParcelDukeRun({
      entity: 'TY_LAND_BIZ',
      parcels: [
        { activeInputAddress: '30 Url Rd, Lexington SC', apn: 'U-1', county: 'Lexington', fips: '45063', verified: true, verificationSource: 'lp', lpPropertyId: 'LPX', lpUrl: 'https://landportal.example/p/x' },
        { activeInputAddress: '32 NoUrl Rd, Lexington SC', apn: 'U-2', county: 'Lexington', verified: true, verificationSource: 'county assessor record' },
      ],
    })!;
    const cards = res.properties.map((p) => getPropertyCard(p.cardId)!);
    const withUrl = cards.find((c) => c.apn === 'U-1')!;
    const without = cards.find((c) => c.apn === 'U-2')!;
    expect(withUrl.lp_url).toBe('https://landportal.example/p/x');
    expect(without.lp_url).toBe('');
  });

  it('the Deal Card package notes state multiple properties/APNs are attached', () => {
    const res = upsertDealCardFromMultiParcelDukeRun({
      entity: 'TY_LAND_BIZ',
      parcels: [
        { activeInputAddress: '40 Note Rd, Lexington SC', apn: 'N-1', county: 'Lexington', verified: true, verificationSource: 'county assessor record' },
        { activeInputAddress: '42 Note Rd, Lexington SC', apn: 'N-2', county: 'Lexington', verified: true, verificationSource: 'county assessor record' },
      ],
    })!;
    const detail = getDealCard(res.dealCardId)!;
    expect(detail.package_notes).toMatch(/2 properties\/APNs attached/i);
    expect(detail.package_notes).toMatch(/contiguity is not assumed/i);
  });

  it('returns null for fewer than one usable parcel', () => {
    expect(upsertDealCardFromMultiParcelDukeRun({ entity: 'TY_LAND_BIZ', parcels: [] })).toBeNull();
  });
});

describe('Deal Card review rollups', () => {
  it('exposes property count, risks, next actions, comp count, and verification mix', () => {
    const res = upsertDealCardFromMultiParcelDukeRun({
      entity: 'TY_LAND_BIZ',
      parcels: [
        { activeInputAddress: '50 Rev Rd, Lexington SC', apn: 'R-1', county: 'Lexington', verified: true, verificationSource: 'county assessor record', risks: ['No LP valuation'], nextActions: ['Pull county checklist'] },
        { activeInputAddress: '52 Rev Rd, Lexington SC', verified: false },
      ],
    })!;
    const detail = getDealCard(res.dealCardId)!;
    expect(detail.propertyCount).toBe(2);
    expect(detail.hasVerifiedProperty).toBe(true);
    expect(detail.hasUnverifiedProperty).toBe(true);
    expect(detail.risks).toContain('No LP valuation');
    expect(detail.nextActions.some((n: any) => /county checklist/i.test(n.action))).toBe(true);
    expect(typeof detail.compCount).toBe('number');
    expect(detail.latestWriteback).toBeTruthy();
  });
});

describe('Duke report status surfacing (Partial default, no comp)', () => {
  it('persists and surfaces a Partial report status on the deal card', () => {
    const res = upsertDealCardFromDukeRun({
      entity: 'TY_LAND_BIZ',
      activeInputAddress: '12 Partial Way, Lexington SC',
      apn: 'P-1',
      county: 'Lexington',
      verified: true,
      verificationSource: 'county assessor record',
      reportStatus: 'partial',
    })!;
    const detail = getDealCard(res.dealCardId)!;
    expect(detail.latestReportStatus).toBe('partial');
  });

  it('surfaces null report status when none was recorded (legacy/empty ref)', () => {
    const res = upsertDealCardFromDukeRun({
      entity: 'TY_LAND_BIZ',
      activeInputAddress: '14 NoStatus Rd, Lexington SC',
      apn: 'P-2',
      county: 'Lexington',
      verified: true,
      verificationSource: 'county assessor record',
    })!;
    const detail = getDealCard(res.dealCardId)!;
    expect(detail.latestReportStatus).toBeNull();
  });

  it('ignores an unrecognized ref value rather than surfacing it as a status', () => {
    const res = upsertDealCardFromDukeRun({
      entity: 'TY_LAND_BIZ',
      activeInputAddress: '16 Bogus Rd, Lexington SC',
      apn: 'P-3',
      county: 'Lexington',
      verified: true,
      verificationSource: 'county assessor record',
      // @ts-expect-error intentionally invalid to prove read-side validation
      reportStatus: 'not_a_real_status',
    })!;
    const detail = getDealCard(res.dealCardId)!;
    expect(detail.latestReportStatus).toBeNull();
  });
});

describe('Multi-APN Deal Card idempotency / reuse on rerun', () => {
  const sameInput = () => ({
    entity: 'TY_LAND_BIZ' as const,
    agentId: 'duke-due-diligence',
    dealContext: { title: 'Seller package' },
    parcels: [
      { activeInputAddress: '1 Re Rd, Lexington SC', apn: 'RE-1', county: 'Lexington', fips: '45063', acres: 5, owner: 'Same Owner', verified: true, verificationSource: 'county assessor record', lpPropertyId: 'LP1', lpUrl: 'https://landportal.example/p/1' },
      { activeInputAddress: '3 Re Rd, Lexington SC', apn: 'RE-2', county: 'Lexington', fips: '45063', acres: 6, owner: 'Same Owner', verified: true, verificationSource: 'county assessor record' },
      { activeInputAddress: '5 Re Rd, Swansea SC', county: 'Lexington', state: 'SC', verified: false, summary: 'zero candidates; likely worth $30,000 offer $9,000' },
    ],
  });

  function counts() {
    const db = getLandosDb();
    return {
      deals: (db.prepare('SELECT COUNT(*) AS n FROM landos_deal_card').get() as any).n,
      cards: (db.prepare('SELECT COUNT(*) AS n FROM landos_property_card').get() as any).n,
      links: (db.prepare('SELECT COUNT(*) AS n FROM landos_deal_card_property').get() as any).n,
    };
  }

  it('running the same multi-APN writeback twice yields exactly one Deal Card', () => {
    const first = upsertDealCardFromMultiParcelDukeRun(sameInput())!;
    const c1 = counts();
    expect(c1.deals).toBe(1);
    expect(c1.cards).toBe(3);
    expect(c1.links).toBe(3);

    const second = upsertDealCardFromMultiParcelDukeRun(sameInput())!;
    expect(second.createdDeal).toBe(false);
    expect(second.dealCardId).toBe(first.dealCardId);

    const c2 = counts();
    expect(c2.deals).toBe(1); // no duplicate Deal Card
    expect(c2.cards).toBe(3); // distinct property records preserved, not merged
    expect(c2.links).toBe(3); // no duplicate property-to-deal links
  });

  it('rerun preserves distinct APNs, mixed verification, sanitized summary, and lp_url passthrough', () => {
    upsertDealCardFromMultiParcelDukeRun(sameInput());
    const res = upsertDealCardFromMultiParcelDukeRun(sameInput())!;
    const detail = getDealCard(res.dealCardId)!;
    expect((detail.propertyCards as any[]).map((p) => p.apn).filter(Boolean).sort()).toEqual(['RE-1', 'RE-2']);
    expect(detail.propertyCount).toBe(3);
    expect(detail.hasVerifiedProperty).toBe(true);
    expect(detail.hasUnverifiedProperty).toBe(true);

    const cards = res.properties.map((p) => getPropertyCard(p.cardId)!);
    const withUrl = cards.find((c) => c.apn === 'RE-1')!;
    const without = cards.find((c) => c.apn === 'RE-2')!;
    expect(withUrl.lp_url).toBe('https://landportal.example/p/1');
    expect(without.lp_url).toBe('');
    const research = cards.find((c) => c.verification_status !== 'verified_property')!;
    expect(research.summary).not.toMatch(/\$\s?\d/);

    // Same owner still does not create contiguity on rerun.
    expect((detail.propertyCards as any[]).every((p) => p.contiguity_status !== 'source_confirmed')).toBe(true);
  });

  it('reuses an existing single-parcel Deal Card when a later multi run includes that parcel', () => {
    const single = upsertDealCardFromDukeRun({
      entity: 'TY_LAND_BIZ', activeInputAddress: '1 Re Rd, Lexington SC', apn: 'RE-1', county: 'Lexington',
      verified: true, verificationSource: 'county assessor record',
    })!;
    const multi = upsertDealCardFromMultiParcelDukeRun({
      entity: 'TY_LAND_BIZ',
      parcels: [
        { activeInputAddress: '1 Re Rd, Lexington SC', apn: 'RE-1', county: 'Lexington', verified: true, verificationSource: 'county assessor record' },
        { activeInputAddress: '3 Re Rd, Lexington SC', apn: 'RE-9', county: 'Lexington', verified: true, verificationSource: 'county assessor record' },
      ],
    })!;
    expect(multi.dealCardId).toBe(single.dealCardId); // reused, not a new deal
    expect(multi.createdDeal).toBe(false);
    expect(counts().deals).toBe(1);
  });
});

describe('Multi-APN conflicting Deal Card links', () => {
  function links(db: ReturnType<typeof getLandosDb>) {
    return db.prepare('SELECT deal_card_id, card_id FROM landos_deal_card_property ORDER BY id').all() as any[];
  }

  // Parcel A pre-linked to Deal Card 1, Parcel B pre-linked to Deal Card 2.
  function setupConflict() {
    const a = upsertDealCardFromDukeRun({
      entity: 'TY_LAND_BIZ', activeInputAddress: '1 Conf Rd, Lexington SC', apn: 'CFL-A', county: 'Lexington',
      verified: true, verificationSource: 'county assessor record',
    })!;
    const b = upsertDealCardFromDukeRun({
      entity: 'TY_LAND_BIZ', activeInputAddress: '9 Other Rd, Lexington SC', apn: 'CFL-B', county: 'Lexington',
      verified: true, verificationSource: 'county assessor record',
    })!;
    return { deal1: a.dealCardId, deal2: b.dealCardId, cardA: a.cardId, cardB: b.cardId };
  }

  function runMulti() {
    return upsertDealCardFromMultiParcelDukeRun({
      entity: 'TY_LAND_BIZ',
      agentId: 'duke-due-diligence',
      parcels: [
        { activeInputAddress: '1 Conf Rd, Lexington SC', apn: 'CFL-A', county: 'Lexington', verified: true, verificationSource: 'county assessor record' },
        { activeInputAddress: '9 Other Rd, Lexington SC', apn: 'CFL-B', county: 'Lexington', verified: true, verificationSource: 'county assessor record' },
      ],
    })!;
  }

  it('does not silently merge two parcels already linked to different Deal Cards', () => {
    const { deal1, deal2, cardA, cardB } = setupConflict();
    const db = getLandosDb();
    expect((db.prepare('SELECT COUNT(*) AS n FROM landos_deal_card').get() as any).n).toBe(2);

    const res = runMulti();

    // Deterministic target = lowest existing deal id (deal1).
    expect(deal1).toBeLessThan(deal2);
    expect(res.dealCardId).toBe(deal1);
    expect(res.createdDeal).toBe(false);

    // No new/merged Deal Cards: both originals preserved.
    expect((db.prepare('SELECT COUNT(*) AS n FROM landos_deal_card').get() as any).n).toBe(2);

    // Distinct property cards + APNs unchanged.
    expect(getPropertyCard(cardA)!.apn).toBe('CFL-A');
    expect(getPropertyCard(cardB)!.apn).toBe('CFL-B');
    expect(cardA).not.toBe(cardB);

    // The conflict parcel B is NOT cross-linked into the target deal1.
    const all = links(db);
    expect(all.length).toBe(2); // no duplicate property-to-deal links
    expect(all.filter((l) => l.card_id === cardB).map((l) => l.deal_card_id)).toEqual([deal2]);
    expect(all.some((l) => l.card_id === cardB && l.deal_card_id === deal1)).toBe(false);

    // Result flags: A attached to this deal; B left linked elsewhere.
    const pa = res.properties.find((p) => p.apn === 'CFL-A')!;
    const pb = res.properties.find((p) => p.apn === 'CFL-B')!;
    expect(pa.linkedToThisDeal).toBe(true);
    expect(pb.linkedToThisDeal).toBe(false);
    expect(pb.otherActiveDealId).toBe(deal2);

    // Clear conflict warning + next action on the conflict parcel.
    expect(res.warnings.join(' ')).toMatch(/conflicting deal card links/i);
    const na = db.prepare("SELECT * FROM landos_card_next_action WHERE card_id = ? AND action LIKE 'Resolve conflicting Deal Card linkage%'").get(cardB) as any;
    expect(na).toBeTruthy();
  });

  it('package notes distinguish attached properties from conflict properties left linked elsewhere', () => {
    setupConflict();
    const res = runMulti();
    const detail = getDealCard(res.dealCardId)!;
    expect(detail.package_notes).toMatch(/1 property\/APN attached to this Deal Card/i);
    expect(detail.package_notes).toMatch(/CFL-A/);
    expect(detail.package_notes).toMatch(/1 property seen in this run was left linked to another Deal Card/i);
    expect(detail.package_notes).toMatch(/CFL-B/);
    expect(detail.package_notes).toMatch(/NOT merged/i);
  });

  it('rerunning the same conflict scenario stays idempotent (no new deals or links)', () => {
    setupConflict();
    runMulti();
    runMulti();
    const db = getLandosDb();
    expect((db.prepare('SELECT COUNT(*) AS n FROM landos_deal_card').get() as any).n).toBe(2);
    expect((db.prepare('SELECT COUNT(*) AS n FROM landos_deal_card_property').get() as any).n).toBe(2);
    expect((db.prepare('SELECT COUNT(*) AS n FROM landos_property_card').get() as any).n).toBe(2);
  });
});
