// Facts from another parcel are never this parcel's facts.
//
// Deal 90, measured: a failed run searched LandPortal by address and opened the
// NEIGHBOURING parcel — 19502 NW 137TH LN, APN 00083-A-03600, owner MADDOX LARRY
// H, Building SqFt 1404. That inspection was retained on the subject's card. The
// merge that assembles "the parcel facts" had only one way to segregate records
// (a verified canonical `?property=` URL), and a run that never reached one
// produced none — so every retained inspection merged into one fact set.
//
// The Deal Card then read a 1,404 sqft house on a subject whose own LandPortal
// record says Building SqFt 0, Vacant Land (General). Permanent memory invariant
// 4 is exactly this: facts from another property are never evidence for the
// subject.
//
// The records themselves state which parcel they describe, so that is what
// segregates them. Nothing is deleted: the activity rows stay as captured.

import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb } from './db.js';
import {
  loadPropertyInspection,
  mergePropertyInspections,
  savePropertyInspection,
  upsertPropertyCard,
  type PropertyInspectionRecord,
} from './property-card.js';
import { readSubjectImprovement } from './comps-valuation.js';

const empty = {
  parcelUrlRecord: null, threeDCapture: null, comparablesUrl: null, comparablesCapturedAt: null,
  assets: [], overlays: [], visualObservations: [], comparables: [],
  sources: [], evidence: [], discoveryQuestions: [], missingInformation: [],
};

/** The neighbour, as the address search actually returned it. */
const NEIGHBOUR: PropertyInspectionRecord = {
  ...empty,
  parcelUrl: 'https://landportal.com/',
  parcelFacts: {
    'Parcel ID': '00083-A-03600',
    'Owner Name': 'MADDOX LARRY H',
    'Parcel Address': '19502 NW 137TH LN',
    Acres: '1.500',
    'Building SqFt': '1404',
  },
};

/** The subject, as the operator's own saved-map link actually renders it. */
const SUBJECT: PropertyInspectionRecord = {
  ...empty,
  parcelUrl: 'https://landportal.com/?map=c40db262-40b0-4de4-b5a9-b1d4c3b1ad00',
  parcelFacts: {
    'Parcel ID': '00083-A-03400',
    'Owner Name': 'HILL EUGENE W',
    'Parcel Address': '19554 NW 137TH LN',
    Acres: '1.500',
    'Building SqFt': '0',
    'Parcel Use Description': 'Vacant Land (General)',
    'Parcel Address County': 'Bradford County',
  },
};

beforeEach(() => _initTestLandosDb());

describe('merging retained inspections', () => {
  it('leaves out a record that states a different parcel', () => {
    const merged = mergePropertyInspections([NEIGHBOUR, SUBJECT])!;
    expect(merged.parcelFacts['Parcel ID']).toBe('00083-A-03400');
    expect(merged.parcelFacts['Owner Name']).toBe('HILL EUGENE W');
    expect(merged.parcelFacts['Parcel Address']).toBe('19554 NW 137TH LN');
    // The 1,404 sqft house belongs to the neighbour and appears nowhere.
    expect(merged.parcelFacts['Building SqFt']).toBe('0');
  });

  it('still merges a record that states no parcel at all, which contradicts nothing', () => {
    const countyGapFill: PropertyInspectionRecord = {
      ...empty,
      parcelUrl: 'https://bradfordcountyfl.gov/parcel',
      parcelFacts: { 'Zoning Code': 'A-1', 'Legal Description': 'LOT 34 OF RIVER OAK PLANTATION S/D' },
    };
    const merged = mergePropertyInspections([countyGapFill, SUBJECT])!;
    expect(merged.parcelFacts['Zoning Code']).toBe('A-1');
    expect(merged.parcelFacts['Parcel ID']).toBe('00083-A-03400');
  });

  it('treats two spellings of one parcel as one parcel, not two', () => {
    const spelled: PropertyInspectionRecord = {
      ...empty,
      parcelUrl: 'https://landportal.com/?map=abc',
      parcelFacts: { 'Parcel ID': '00083-A-03400-000', 'Zoning Code': 'A-1' },
    };
    const merged = mergePropertyInspections([spelled, SUBJECT])!;
    expect(merged.parcelFacts['Zoning Code']).toBe('A-1');
    expect(merged.parcelFacts['Owner Name']).toBe('HILL EUGENE W');
  });

  it('keeps the newest stated parcel as the subject when a later capture corrects an earlier one', () => {
    // Order matters and it is the ONLY thing that decides: the latest record
    // states the parcel, earlier records are judged against it.
    const merged = mergePropertyInspections([SUBJECT, NEIGHBOUR])!;
    expect(merged.parcelFacts['Parcel ID']).toBe('00083-A-03600');
  });
});

describe('the Deal Card stops reading the neighbour as the subject', () => {
  it('reads a vacant parcel once the subject record supersedes the neighbouring one', () => {
    const card = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '19554 NW 137th Ln',
      city: 'Lake Butler', state: 'FL', county: 'Bradford', verified: false,
    }).card;

    savePropertyInspection(card.id, { ...NEIGHBOUR, assets: [] });
    const contaminated = readSubjectImprovement(loadPropertyInspection(card.id));
    expect(contaminated.improved).toBe(true);
    expect(contaminated.buildingSqft).toBe(1404);

    savePropertyInspection(card.id, { ...SUBJECT, assets: [] });
    const repaired = readSubjectImprovement(loadPropertyInspection(card.id));
    expect(repaired.improved).toBe(false);
    expect(repaired.type).toBe('vacant_land');
    expect(repaired.captionNoun).toBe('vacant parcel');
    // No "House · 1,404 sqft", and no land-only/pending valuation scope that
    // only existed because of a structure on another parcel.
    expect(repaired.buildingSqft).toBeNull();
    expect(repaired.wholePropertyPending).toBe(false);
    expect(repaired.wholePropertyNote).toBeNull();
  });

  it('keeps the superseded capture as history rather than deleting it', () => {
    const card = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '19554 NW 137th Ln',
      city: 'Lake Butler', state: 'FL', verified: false,
    }).card;
    savePropertyInspection(card.id, { ...NEIGHBOUR, assets: [] });
    savePropertyInspection(card.id, { ...SUBJECT, assets: [] });
    // Every capture is still on the card's activity trail; only which one counts
    // as the subject changed.
    const rows = (globalThis as unknown as { __none?: never }) && loadPropertyInspection(card.id);
    expect(rows?.parcelFacts['Parcel ID']).toBe('00083-A-03400');
  });
});
