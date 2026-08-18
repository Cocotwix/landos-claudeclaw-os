import { beforeEach, describe, expect, it } from 'vitest';

import type { CapabilityResult } from './capability-contract.js';
import { invokeRuntimeCapability, listRuntimeCapabilities } from './capability-registry.js';
import { _initTestLandosDb, getLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import type { LpResolveResult } from './landportal-client.js';
import {
  LANDPORTAL_RESEARCH_CAPABILITY,
  LANDPORTAL_RESEARCH_CAPABILITY_ID,
  type LandPortalResearchFacts,
} from './landportal-research-capability.js';
import { upsertPropertyCard, type PropertyInspectionRecord } from './property-card.js';
import { PROPERTY_RESOLUTION_CAPABILITY_ID } from './property-resolution-capability.js';

beforeEach(() => { _initTestLandosDb(); });

/** The property record LandPortal returns for the verified subject. */
const VERIFIED: LpResolveResult = {
  verified: true,
  status: 'verified',
  propertyid: '55512345',
  fips: '47187',
  apn: '042 123.00 000',
  situs_address: '0 Kingwood Blvd, Fairview, TN 37062',
  city: 'Fairview',
  state: 'TN',
  owner: 'SMITH FAMILY TRUST',
  match_notes: 'Exact parcel identity returned.',
  source: 'LandPortal property record',
  property_summary: {
    propertyid: '55512345',
    apn: '042 123.00 000',
    situs_address: '0 Kingwood Blvd, Fairview, TN 37062',
    city: 'Fairview',
    state: 'TN',
    zip: '37062',
    county: 'Williamson',
    owner: 'SMITH FAMILY TRUST',
    land_use: 'Vacant residential land',
    lot_size_acres: '12.4',
    calc_acres: '12.38',
    lot_size_sqft: '540144',
    road_frontage_ft: '310',
    land_locked: 'No',
    near_water: 'No',
    wetlands_pct: '4.2',
    fema_pct: '0',
    buildability_pct: '81',
    buildability_acres: '10.1',
    slope_avg_deg: '7.4',
    elevation_avg_ft: '905',
    building_area_sqft: '',
    assessed_total: '15250',
    assessed_land: '15250',
    market_total: '61000',
    market_land: '61000',
    tlp_estimate: '',
    tlp_ppa: '',
    price_acre_county: '',
    lat: '35.98',
    lng: '-87.12',
    municipality: 'Fairview',
    mailing_address: 'PO BOX 41',
    mailing_city: 'FAIRVIEW',
    mailing_state: 'TN',
    similars_count: '2',
    similars_ppa_min: '',
    similars_ppa_max: '',
    similars_ppa_median: '',
    similars_most_recent_year: '2025',
    similar_sales: [
      { saleYear: '2025', salePrice: 92_000, acres: 11.2, pricePerAcre: 8_214, apn: '042 118.00 000', addressOrCounty: 'Williamson County, TN' },
      { saleYear: '2024', salePrice: 74_500, acres: 9.9, pricePerAcre: 7_525, apn: '042 097.00 000', addressOrCounty: 'Williamson County, TN' },
    ],
  },
};

/** A canonical subject the way Property Resolution leaves it on a Deal Card. */
function canonicalSubject(overrides: { apn?: string | null } = {}) {
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Kingwood Blvd' });
  const { card } = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: '0 Kingwood Blvd, Fairview TN',
    apn: overrides.apn === undefined ? '042-123.00-000' : overrides.apn ?? undefined,
    county: 'Williamson',
    state: 'TN',
    verified: true,
    verificationSource: 'Williamson County Property Assessor',
  });
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
  return { deal, card };
}

/** Retained authenticated-parcel evidence this Property Card already holds. */
function retainedInspection(): PropertyInspectionRecord {
  return {
    // The provider's own canonical token: fips=47187&apn=042 123.00 000&propertyid=55512345
    parcelUrl: 'https://landportal.com/?property=Zmlwcz00NzE4NyZhcG49MDQyIDEyMy4wMCAwMDAmcHJvcGVydHlpZD01NTUxMjM0NQ==',
    parcelUrlRecord: null,
    threeDCapture: null,
    comparablesUrl: null,
    comparablesCapturedAt: null,
    parcelFacts: { 'Lot Size': '12.4 acres', 'Road Frontage': '310 ft' },
    assets: [],
    overlays: [],
    visualObservations: [],
    comparables: [],
    sources: [{ provider: 'LandPortal', stage: 'parcel', status: 'used', confidence: 'high', url: 'https://landportal.com/property-detail/', note: 'Parcel panel read.' }],
    evidence: [],
    discoveryQuestions: [],
    missingInformation: [],
  };
}

const facts = (result: CapabilityResult): LandPortalResearchFacts => result.facts as LandPortalResearchFacts;

const available = { landPortalAvailable: () => true };

describe('LandPortal Research Capability', () => {
  it('is registered on the runtime capability registry', () => {
    const registered = listRuntimeCapabilities().map((capability) => capability.id);
    expect(registered).toContain(LANDPORTAL_RESEARCH_CAPABILITY_ID);
    expect(LANDPORTAL_RESEARCH_CAPABILITY.metadata.name).toBe('LandPortal Research');
  });

  it('reads the LandPortal record for the Deal Card canonical subject and keeps its provenance', async () => {
    const { deal, card } = canonicalSubject();
    const asked: unknown[] = [];
    const result = await invokeRuntimeCapability({
      capabilityId: LANDPORTAL_RESEARCH_CAPABILITY_ID,
      caller: { type: 'deal_card', ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
      mode: 'refresh',
    }, {
      ...available,
      loadInspection: () => retainedInspection(),
      lpResolve: async (args) => { asked.push(args); return VERIFIED; },
    });

    expect(result.status).toBe('SUCCEEDED');
    expect(result.subjectResolution).toBe('RESOLVED');
    expect(result.canonicalSubject).toMatchObject({ kind: 'property', propertyCardId: card.id, dealCardId: deal.id, temporary: false });

    // The retained parcel record is the strongest identity, so the lookup opens
    // that exact record instead of searching for the parcel again.
    expect(asked[0]).toMatchObject({ propertyid: '55512345', fips: '47187' });

    const view = facts(result);
    expect(view.lane).toBe('parcel_facts');
    expect(view.executed).toBe(true);
    expect(view.outcome).toBe('record_returned');
    expect(view.parcel?.apn).toBe('042 123.00 000');
    expect(view.parcel?.acres).toBe(12.4);
    expect(view.parcel?.roadFrontageFeet).toBe(310);
    expect(view.parcel?.landLocked).toBe('No');
    expect(view.parcel?.wetlandsPct).toBe(4.2);
    expect(view.parcel?.femaPct).toBe(0);
    expect(view.parcel?.buildabilityAcres).toBe(10.1);
    expect(view.parcel?.slopeAvgDegrees).toBe(7.4);
    expect(view.comparables).toHaveLength(2);
    expect(view.retained.parcelFactCount).toBe(2);
    expect(result.evidence.map((item) => item.source)).toContain('LandPortal property record');
  });

  it('never fabricates a field LandPortal did not publish', async () => {
    const { deal, card } = canonicalSubject();
    const result = await invokeRuntimeCapability({
      capabilityId: LANDPORTAL_RESEARCH_CAPABILITY_ID,
      caller: { type: 'deal_card', ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
      mode: 'refresh',
    }, { ...available, loadInspection: () => null, lpResolve: async () => VERIFIED });

    // `building_area_sqft` came back blank. It stays null, and nothing else
    // fills it in.
    expect(facts(result).parcel?.buildingAreaSqft).toBeNull();
  });

  it('reports an honest empty result when LandPortal returns no verified record', async () => {
    const { deal, card } = canonicalSubject();
    const result = await invokeRuntimeCapability({
      capabilityId: LANDPORTAL_RESEARCH_CAPABILITY_ID,
      caller: { type: 'deal_card', ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
      mode: 'refresh',
    }, {
      ...available,
      loadInspection: () => null,
      lpResolve: async () => ({
        verified: false, status: 'not_verified', propertyid: null, fips: null, apn: null,
        situs_address: null, owner: null, match_notes: 'No candidate matched the requested parcel.',
      } as LpResolveResult),
    });

    expect(result.status).toBe('NEEDS_INPUT');
    expect(facts(result).parcel).toBeNull();
    expect(facts(result).sourceAttempts[0]).toMatchObject({ status: 'not_verified' });
    expect(result.warnings.join(' ')).toContain('did not return a verified record');
  });

  it('reports honestly when LandPortal is not configured instead of inventing a record', async () => {
    const { deal, card } = canonicalSubject();
    const result = await invokeRuntimeCapability({
      capabilityId: LANDPORTAL_RESEARCH_CAPABILITY_ID,
      caller: { type: 'deal_card', ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
      mode: 'refresh',
    }, {
      landPortalAvailable: () => false,
      loadInspection: () => retainedInspection(),
      lpResolve: async () => { throw new Error('the lookup must not be attempted'); },
    });

    expect(result.status).toBe('NEEDS_INPUT');
    expect(facts(result).executed).toBe(false);
    expect(facts(result).outcome).toBe('retained_only');
    expect(facts(result).retained.parcelFactCount).toBe(2);
  });

  it('a rerun never repoints the canonical property when LandPortal answers with another parcel', async () => {
    const { deal, card } = canonicalSubject();
    const request = {
      capabilityId: LANDPORTAL_RESEARCH_CAPABILITY_ID,
      caller: { type: 'deal_card' as const, ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property' as const, entity: 'TY_LAND_BIZ' as const, propertyCardId: card.id, dealCardId: deal.id },
      mode: 'refresh' as const,
    };
    const before = getLandosDb().prepare('SELECT apn, county, state, verification_status FROM landos_property_card WHERE id = ?').get(card.id);
    const cards = Number((getLandosDb().prepare('SELECT count(*) AS n FROM landos_property_card').get() as { n: number }).n);

    const result = await invokeRuntimeCapability(request, {
      ...available,
      loadInspection: () => null,
      lpResolve: async () => ({ ...VERIFIED, apn: '999 999.00 000', owner: 'SOMEONE ELSE' }),
    });

    expect(result.status).toBe('NEEDS_INPUT');
    expect(result.subjectResolution).toBe('AMBIGUOUS');
    expect(facts(result).parcel).toBeNull();
    expect(result.warnings.join(' ')).toContain('999 999.00 000');
    const after = getLandosDb().prepare('SELECT apn, county, state, verification_status FROM landos_property_card WHERE id = ?').get(card.id);
    expect(after).toEqual(before);
    expect(Number((getLandosDb().prepare('SELECT count(*) AS n FROM landos_property_card').get() as { n: number }).n)).toBe(cards);
  });

  it('runs the existing authenticated parcel inspection through the capability envelope', async () => {
    const { deal, card } = canonicalSubject();
    const asked: unknown[] = [];
    const result = await invokeRuntimeCapability({
      capabilityId: LANDPORTAL_RESEARCH_CAPABILITY_ID,
      caller: { type: 'new_lead', ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
      mode: 'refresh',
      parameters: { lane: 'parcel_inspection' },
    }, {
      loadInspection: () => retainedInspection(),
      runParcelInspection: async (input) => {
        asked.push(input);
        return { ok: true, comparableCount: 6, note: 'LandPortal parcel read completed.' };
      },
      lpResolve: async () => { throw new Error('this lane must not call the property record'); },
    });

    expect(result.status).toBe('SUCCEEDED');
    // The lane is handed the canonical subject, never a caller-supplied one.
    expect(asked[0]).toMatchObject({ propertyCardId: card.id, dealCardId: deal.id, searchKey: { county: 'Williamson', state: 'TN' } });
    expect(facts(result).lane).toBe('parcel_inspection');
    expect(facts(result).inspection).toEqual({ ok: true, comparableCount: 6, note: 'LandPortal parcel read completed.' });
    expect(facts(result).retained.parcelFactCount).toBe(2);
  });

  it('runs the existing specialist lane through the capability envelope', async () => {
    const { deal, card } = canonicalSubject();
    const asked: unknown[] = [];
    const result = await invokeRuntimeCapability({
      capabilityId: LANDPORTAL_RESEARCH_CAPABILITY_ID,
      caller: { type: 'new_lead', ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
      mode: 'refresh',
      parameters: { lane: 'agentic_specialists', runId: 'run-9' },
    }, {
      loadInspection: () => null,
      runAgenticSpecialists: async (input) => {
        asked.push(input);
        return {
          status: 'exact_match',
          runId: input.runId,
          note: 'Subject verified and persisted.',
          persistedCategories: ['subject'],
          workUnits: [{ specialist: 'subject', status: 'exact_match', note: 'Exact subject verified.' }],
        };
      },
    });

    expect(result.status).toBe('SUCCEEDED');
    expect(asked[0]).toMatchObject({ runId: 'run-9', dealCardId: deal.id, propertyCardId: card.id });
    expect(facts(result).agentic?.status).toBe('exact_match');
    expect(facts(result).agentic?.persistedCategories).toEqual(['subject']);
  });

  it('delegates raw Tools input to Property Resolution and never resolves identity itself', async () => {
    const seen: string[] = [];
    const resolution: CapabilityResult = {
      invocationId: 'cap_resolution',
      capability: { id: PROPERTY_RESOLUTION_CAPABILITY_ID, name: 'Property Resolution', contractVersion: '1.0', description: '' },
      status: 'SUCCEEDED',
      subjectResolution: 'RESOLVED',
      canonicalSubject: { kind: 'research_session', id: 'research_abc', temporary: true },
      facts: {
        canonicalIdentity: {
          address: '0 Kingwood Blvd, Fairview, TN 37062',
          apn: '042 123.00 000',
          county: 'Williamson',
          state: 'TN',
          owner: 'SMITH FAMILY TRUST',
        },
      },
      evidence: [],
      warnings: [],
      missingInformation: [],
      timestamps: { startedAt: new Date().toISOString(), completedAt: new Date().toISOString() },
      execution: { mode: 'reuse', durationMs: 1, reused: false },
    };
    const result = await invokeRuntimeCapability({
      capabilityId: LANDPORTAL_RESEARCH_CAPABILITY_ID,
      caller: { type: 'tools', ref: 'tools:landportal-research' },
      subject: { kind: 'raw_property', entity: 'TY_LAND_BIZ', rawInput: 'Map 042 Parcel 123, Fairview, Tennessee' },
    }, {
      ...available,
      resolveSubject: async (request) => { seen.push(request.subject.kind); return resolution; },
      lpResolve: async () => VERIFIED,
    });

    expect(seen).toEqual(['raw_property']);
    // The capability returns EXACTLY the subject Property Resolution established.
    expect(result.canonicalSubject).toEqual(resolution.canonicalSubject);
    expect(facts(result).parcel?.owner).toBe('SMITH FAMILY TRUST');
  });

  it('does not create a lead, Deal Card, or Property Card from a Tools invocation', async () => {
    const counts = () => ({
      deals: Number((getLandosDb().prepare('SELECT count(*) AS n FROM landos_deal_card').get() as { n: number }).n),
      cards: Number((getLandosDb().prepare('SELECT count(*) AS n FROM landos_property_card').get() as { n: number }).n),
    });
    const before = counts();
    const result = await invokeRuntimeCapability({
      capabilityId: LANDPORTAL_RESEARCH_CAPABILITY_ID,
      caller: { type: 'tools', ref: 'tools:landportal-research' },
      subject: { kind: 'raw_property', entity: 'TY_LAND_BIZ', rawInput: '0 Kingwood Blvd, Fairview TN' },
    }, {
      ...available,
      resolveSubject: async () => ({
        invocationId: 'cap_unresolved',
        capability: { id: PROPERTY_RESOLUTION_CAPABILITY_ID, name: 'Property Resolution', contractVersion: '1.0', description: '' },
        status: 'NEEDS_INPUT',
        subjectResolution: 'UNRESOLVED',
        canonicalSubject: null,
        facts: {},
        evidence: [],
        warnings: ['No source established one exact parcel.'],
        missingInformation: ['An APN with its county'],
        timestamps: { startedAt: new Date().toISOString(), completedAt: new Date().toISOString() },
        execution: { mode: 'reuse' as const, durationMs: 1, reused: false },
      }),
      lpResolve: async () => { throw new Error('no research may run without a resolved subject'); },
    });

    expect(result.status).toBe('NEEDS_INPUT');
    expect(facts(result).executed).toBe(false);
    expect(counts()).toEqual(before);
  });

  it('refuses caller-supplied LandPortal facts and unknown lanes', async () => {
    const { deal, card } = canonicalSubject();
    const base = {
      capabilityId: LANDPORTAL_RESEARCH_CAPABILITY_ID,
      caller: { type: 'deal_card' as const, ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property' as const, entity: 'TY_LAND_BIZ' as const, propertyCardId: card.id, dealCardId: deal.id },
    };
    await expect(invokeRuntimeCapability({ ...base, context: { acres: 40 } })).rejects.toThrow(/assertions/);
    await expect(invokeRuntimeCapability({ ...base, parameters: { apn: '1-2-3' } })).rejects.toThrow(/does not accept/);
    await expect(invokeRuntimeCapability({ ...base, parameters: { lane: 'paid_comp_report' } })).rejects.toThrow(/unknown LandPortal Research lane/);
  });
});
