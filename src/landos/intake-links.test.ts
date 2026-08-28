// Operator-supplied links are intake evidence.
//
// The live failure these hold the line on (Deal 90): the operator pasted their
// own LandPortal saved-map link with the lead, it was written into the property
// card's `lp_url` column, a failed research run then persisted the bare site
// root over it, and the strongest thing LandOS had been told about the property
// stopped existing. Every rerun searched by address and landed on the
// neighbouring parcel.

import { beforeEach, describe, expect, it } from 'vitest';

import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { _initTestLandosDb, getLandosDb } from './db.js';
import { getPropertyCardRow, upsertPropertyCard } from './property-card.js';
import { LANDPORTAL_RESEARCH_CAPABILITY_ID } from './landportal-research-capability.js';
import { PROPERTY_RESOLUTION_CAPABILITY_ID } from './property-resolution-capability.js';
import { COMPS_VALUATION_CAPABILITY_ID } from './comps-valuation-capability.js';
import { ZONING_SUBDIVISION_CAPABILITY_ID } from './zoning-subdivision-capability.js';
import {
  INTAKE_LINK_CAPABILITY_IDS,
  classifyIntakeUrl,
  extractIntakeUrls,
  listIntakeLinks,
  operatorLandPortalEntryUrlForDeal,
  recordIntakeLinks,
} from './intake-links.js';

const MAP_URL = 'https://landportal.com/?map=c40db262-40b0-4de4-b5a9-b1d4c3b1ad00';
const PARCEL_TOKEN = Buffer.from('fips=12007&apn=00083-A-03400&propertyid=987654').toString('base64');
const PARCEL_URL = `https://landportal.com/?property=${PARCEL_TOKEN}`;

beforeEach(() => _initTestLandosDb());

function seedDeal(rawIntake: string) {
  const card = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: '19554 NW 137th Ln',
    city: 'Lake Butler',
    state: 'FL',
    summary: rawIntake,
    verified: false,
  }).card;
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Intake links', sellerNotes: rawIntake });
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
  return { deal, card };
}

describe('reading links out of operator text', () => {
  it('keeps every URL exactly as supplied, in order', () => {
    const urls = extractIntakeUrls(
      `${MAP_URL}\nAlso see https://qpublic.schneidercorp.com/Application.aspx?AppID=907 and https://example.county.gov/zoning`,
    );
    expect(urls).toEqual([
      MAP_URL,
      'https://qpublic.schneidercorp.com/Application.aspx?AppID=907',
      'https://example.county.gov/zoning',
    ]);
  });

  it('does not swallow the sentence punctuation that follows a link', () => {
    expect(extractIntakeUrls('The parcel is at https://landportal.com/?map=abc123ef.')).toEqual([
      'https://landportal.com/?map=abc123ef',
    ]);
  });

  it('reads nothing out of text that carries no link', () => {
    expect(extractIntakeUrls('HILL EUGENE W, 19554 NW 137TH LN, asking $28k')).toEqual([]);
  });
});

describe('routing a supplied link to an existing path', () => {
  it('names only capability ids that actually exist', () => {
    expect(INTAKE_LINK_CAPABILITY_IDS).toEqual([
      LANDPORTAL_RESEARCH_CAPABILITY_ID,
      PROPERTY_RESOLUTION_CAPABILITY_ID,
      COMPS_VALUATION_CAPABILITY_ID,
      ZONING_SUBDIVISION_CAPABILITY_ID,
    ]);
  });

  it('separates a canonical parcel link from a saved-map link', () => {
    expect(classifyIntakeUrl(PARCEL_URL).classification).toBe('landportal_parcel');
    expect(classifyIntakeUrl(MAP_URL).classification).toBe('landportal_map');
    // Both go to LandPortal; only the first one carries identity, and the note
    // says so rather than implying the map link names a parcel.
    expect(classifyIntakeUrl(MAP_URL).capability).toBe(LANDPORTAL_RESEARCH_CAPABILITY_ID);
    expect(classifyIntakeUrl(MAP_URL).note).toMatch(/not a parcel/i);
  });

  it('routes an assessor/GIS link, a listing and a zoning ordinance to their own paths', () => {
    expect(classifyIntakeUrl('https://qpublic.schneidercorp.com/Application.aspx?AppID=907').capability)
      .toBe(PROPERTY_RESOLUTION_CAPABILITY_ID);
    expect(classifyIntakeUrl('https://www.zillow.com/homedetails/19554-NW-137th-Ln/1234_zpid/').capability)
      .toBe(COMPS_VALUATION_CAPABILITY_ID);
    expect(classifyIntakeUrl('https://bradfordcountyfl.gov/planning/zoning-ordinance').capability)
      .toBe(ZONING_SUBDIVISION_CAPABILITY_ID);
  });

  it('accepts an unknown domain as general browser work instead of rejecting it', () => {
    const route = classifyIntakeUrl('https://some-unfamiliar-site.example/parcel-notes');
    expect(route.classification).toBe('web');
    // No specialized path is not the same as no path.
    expect(route.capability).toBe('');
    expect(route.note).toMatch(/general browser/i);
  });
});

describe('a supplied link survives everything a research lane does', () => {
  it('is stored verbatim, deduplicated, and cannot be rewritten or deleted', () => {
    const { deal } = seedDeal('no links here');
    const first = recordIntakeLinks({ dealCardId: deal.id, text: `look at ${MAP_URL}`, source: 'operator:new_lead' });
    expect(first).toHaveLength(1);
    expect(first[0].url).toBe(MAP_URL);

    // The same link supplied again is the same artifact, not a second one.
    recordIntakeLinks({ dealCardId: deal.id, urls: [MAP_URL], source: 'operator:smart_intake_conversation' });
    expect(listIntakeLinks(deal.id)).toHaveLength(1);

    const db = getLandosDb();
    expect(() => db.prepare('UPDATE landos_intake_link SET url = ? WHERE id = ?').run('https://x.test/', first[0].id))
      .toThrow(/immutable/);
    expect(() => db.prepare('DELETE FROM landos_intake_link WHERE id = ?').run(first[0].id)).toThrow(/immutable/);
  });

  it('is still readable after a lane overwrites the property card link column', () => {
    const { deal, card } = seedDeal('lead text');
    recordIntakeLinks({ dealCardId: deal.id, urls: [MAP_URL], source: 'operator:new_lead' });
    upsertPropertyCard({
      entity: 'TY_LAND_BIZ', cardId: card.id, activeInputAddress: '19554 NW 137th Ln',
      lpUrl: PARCEL_URL, verified: false, agentId: 'some-research-lane',
    });
    expect(getPropertyCardRow(card.id)?.lp_url).toBe(PARCEL_URL);
    // The operator's own link is unaffected by what the lane wrote.
    expect(listIntakeLinks(deal.id).map((link) => link.url)).toContain(MAP_URL);
  });

  it('is recovered from retained raw intake for a deal created before links were filed', () => {
    const { deal } = seedDeal(`${MAP_URL}\n\nHILL EUGENE W\n19554 NW 137TH LN, LAKE BUTLER, FL,\n\nAsking $28k`);
    // Nothing was filed at creation; the raw intake still carries the operator's
    // own words, so the link is read back out of them rather than lost.
    const links = listIntakeLinks(deal.id);
    expect(links.map((link) => link.url)).toEqual([MAP_URL]);
    expect(links[0].source).toBe('operator:retained_raw_intake');
    expect(operatorLandPortalEntryUrlForDeal(deal.id)).toBe(MAP_URL);
  });

  it('prefers a canonical parcel link over a saved-map link as the entry point', () => {
    const { deal } = seedDeal('lead text');
    recordIntakeLinks({ dealCardId: deal.id, urls: [MAP_URL, PARCEL_URL], source: 'operator:new_lead' });
    expect(operatorLandPortalEntryUrlForDeal(deal.id)).toBe(PARCEL_URL);
  });

  it('returns no entry point when the operator supplied no openable LandPortal link', () => {
    const { deal } = seedDeal('lead text');
    recordIntakeLinks({ dealCardId: deal.id, urls: ['https://landportal.com/market-research'], source: 'operator:new_lead' });
    // The page is still KEPT — it just cannot be used to enter a parcel record.
    expect(listIntakeLinks(deal.id)).toHaveLength(1);
    expect(operatorLandPortalEntryUrlForDeal(deal.id)).toBeNull();
  });
});

describe('the property card link column stops accepting a link that names no parcel', () => {
  it('drops a bare LandPortal site root instead of overwriting the retained link', () => {
    const { card } = seedDeal('lead text');
    upsertPropertyCard({
      entity: 'TY_LAND_BIZ', cardId: card.id, activeInputAddress: '19554 NW 137th Ln',
      lpUrl: MAP_URL, verified: false,
    });
    expect(getPropertyCardRow(card.id)?.lp_url).toBe(MAP_URL);

    // This is exactly what a failed run persisted on Deal 90.
    const result = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', cardId: card.id, activeInputAddress: '19554 NW 137th Ln',
      lpUrl: 'https://landportal.com/', verified: false, agentId: 'failed-landportal-run',
    });
    expect(getPropertyCardRow(card.id)?.lp_url).toBe(MAP_URL);
    expect(result.warnings.join(' ')).toMatch(/addresses no LandPortal parcel or saved map/i);
  });

  it('still accepts a non-LandPortal parcel URL, which it has no authority to judge', () => {
    const { card } = seedDeal('lead text');
    const countyUrl = 'https://qpublic.schneidercorp.com/Application.aspx?AppID=907&PageID=1&KeyValue=00083-A-03400';
    upsertPropertyCard({
      entity: 'TY_LAND_BIZ', cardId: card.id, activeInputAddress: '19554 NW 137th Ln',
      lpUrl: countyUrl, verified: false,
    });
    expect(getPropertyCardRow(card.id)?.lp_url).toBe(countyUrl);
  });
});
