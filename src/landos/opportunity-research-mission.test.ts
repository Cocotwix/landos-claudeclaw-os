import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb, getLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { ensureOpportunityForLegacyDealCard } from './opportunity.js';
import {
  apnSearchVariants,
  buildInvestigativePathPlan,
  claimResearchMission,
  createResearchMission,
  latestResearchMission,
  listQuarantinedResearchEvidence,
  quarantineMismatchedPropertyInspections,
  restoreMatchingPropertyInspections,
  recoverableResearchMissionIds,
  researchConstraintsFor,
  verifyInspectionIdentity,
} from './opportunity-research-mission.js';
import { loadPropertyInspection, savePropertyInspection, upsertPropertyCard } from './property-card.js';

beforeEach(() => _initTestLandosDb());

const emptyInspection = {
  parcelUrl: 'https://landportal.example/property', comparablesUrl: null,
  assets: [], overlays: [], visualObservations: [], comparables: [],
};

describe('durable opportunity research mission', () => {
  it('does not treat provider placeholder dashes as a conflicting address', () => {
    const verification = verifyInspectionIdentity(
      { address: '2510 State Highway 153', city: 'Winters', county: 'Runnels', state: 'TX', apn: 'R000020383', source: 'manual_input' },
      { parcelUrl: 'https://landportal.example/parcel', parcelFacts: { 'Parcel Address': '-', 'Parcel Address City': '-', 'Parcel Address State': 'TX', 'Parcel Address County': 'Runnels County', 'Parcel ID': 'R000020383' } },
    );
    expect(verification.accepted).toBe(true);
    expect(verification.observed.address).toBeNull();
    expect(verification.observed.city).toBeNull();
  });

  it('accepts an exact APN and street when the provider uses a locality variant within the same county', () => {
    const verification = verifyInspectionIdentity(
      { address: '473 Seaside Rd', city: 'Beaufort', county: 'Beaufort', state: 'SC', apn: 'R300 018 000 0085 0000', source: 'manual_input' },
      { parcelUrl: 'https://landportal.example/parcel', parcelFacts: { 'Parcel Address': '473 SEASIDE RD', 'Parcel Address City': 'SAINT HELENA ISLAND', 'Parcel Address County': 'Beaufort County', 'Parcel Address State': 'SC', 'Parcel ID': 'R300 018 000 0085 0000' } },
    );
    expect(verification.accepted).toBe(true);
    expect(verification.reasons).toEqual([]);
  });

  it('generates safe APN formatting variants without changing any supplied digit', () => {
    const variants = apnSearchVariants('094-020.08 (094 02008 000)');
    const digits = '0940200809402008000';
    expect(variants.length).toBeGreaterThan(1);
    expect(variants.every((candidate) => (candidate.match(/\d/g) ?? []).join('') === digits)).toBe(true);
  });

  it('persists a non-terminal multi-path plan including browser and public sources', () => {
    const plan = buildInvestigativePathPlan({ address: null, city: null, county: 'Rowan', state: 'NC', apn: '123-45-678', source: 'manual_input' });
    expect(plan.map((step) => step.provider)).toEqual([
      'operator_input', 'apn_variants', 'landportal_browser', 'county_gis', 'county_assessor',
      'county_recorder', 'web_search', 'zillow', 'redfin',
    ]);
    expect(plan.find((step) => step.provider === 'landportal_browser')?.note).toMatch(/no API\/MCP.*paid/i);
  });
  it('keeps the operator jurisdiction immutable for a two-part street, City ST title', () => {
    const opportunity = {
      id: 1, title: '272 McAlister Road, Kingstree SC', rawInput: '',
    } as Parameters<typeof researchConstraintsFor>[0];

    const constraints = researchConstraintsFor(opportunity, {
      active_input_address: '272 McAlister Road', city: 'Lincolnton', state: 'NC', apn: '52394',
    });

    expect(constraints).toMatchObject({
      address: '272 McAlister Road', city: 'Kingstree', state: 'SC', source: 'opportunity_title',
    });
    expect(constraints.county).toBeNull();
    expect(constraints.apn).toBeNull();
  });

  it('uses a matching corrected card county without importing its mutable address or APN', () => {
    const opportunity = {
      id: 1, title: '272 McAlister Road, Kingstree SC', rawInput: '',
    } as Parameters<typeof researchConstraintsFor>[0];

    const constraints = researchConstraintsFor(opportunity, {
      active_input_address: '272 McAllister Road', city: 'Kingstree', county: 'Williamsburg', state: 'SC', apn: 'unverified-apn',
    });

    expect(constraints).toMatchObject({
      address: '272 McAlister Road', city: 'Kingstree', county: 'Williamsburg', state: 'SC', source: 'opportunity_title',
    });
    expect(constraints.apn).toBeNull();
  });

  it('uses an owner-confirmed official parcel reconciliation over stale raw intake on retry', () => {
    const opportunity = {
      id: 1, title: '272 McAlister Road, Kingstree SC',
      rawInput: JSON.stringify({ address: '272 McAlister Road', city: 'Kingstree', county: 'Williamsburg', state: 'SC', apn: '45-177-182.B' }),
    } as Parameters<typeof researchConstraintsFor>[0];

    const constraints = researchConstraintsFor(opportunity, {
      active_input_address: '272 Mcallister Rd', city: 'Kingstree', county: 'Williamsburg County', state: 'SC', apn: '45-177-182',
      verification_source: 'Owner-confirmed official parcel record — Williamsburg County official parcel map: https://williamsburgsc.wthgis.com/',
    });

    expect(constraints).toEqual({
      address: '272 Mcallister Rd', city: 'Kingstree', county: 'Williamsburg County', state: 'SC', apn: '45-177-182', source: 'property_fallback',
    });
  });

  it('accepts a one-character street-spelling correction only when the rest of the parcel identity matches', () => {
    const expected = {
      address: '272 McAlister Road', city: 'Kingstree', county: 'Williamsburg', state: 'SC', apn: null,
      source: 'opportunity_title' as const,
    };
    const verification = verifyInspectionIdentity(expected, {
      ...emptyInspection,
      parcelFacts: {
        'Parcel Address': '272 MCALLISTER RD', 'Parcel Address City': 'KINGSTREE',
        'Parcel Address County': 'Williamsburg County', 'Parcel Address State': 'SC', 'Parcel ID': '45-177-182.B',
      },
    });

    expect(verification.accepted).toBe(true);
    expect(verification.verdict).toBe('matched');
  });

  it('rejects a wrong-state parcel before its facts can be associated', () => {
    const expected = {
      address: '272 McAlister Road', city: 'Kingstree', county: 'Williamsburg', state: 'SC', apn: null,
      source: 'manual_input' as const,
    };
    const verification = verifyInspectionIdentity(expected, {
      ...emptyInspection,
      parcelFacts: {
        'Parcel Address': '272 McAlister Rd', 'Parcel Address City': 'Lincolnton',
        'Parcel Address County': 'Lincoln', 'Parcel Address State': 'NC', 'Parcel ID': '52394',
      },
    });

    expect(verification.accepted).toBe(false);
    expect(verification.verdict).toBe('jurisdiction_mismatch');
    expect(verification.reasons.join(' ')).toMatch(/state mismatch.*county mismatch.*city mismatch/i);
  });

  it('persists, deduplicates, claims, and exposes a recoverable mission', () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Durable mission lead' });
    const opportunity = ensureOpportunityForLegacyDealCard(deal.id);
    const constraints = {
      address: '10 Main Street', city: 'Kingstree', county: 'Williamsburg', state: 'SC', apn: null,
      source: 'manual_input' as const,
    };
    const created = createResearchMission(opportunity, constraints, 'automatic_manual_intake');
    const duplicate = createResearchMission(opportunity, constraints, 'duplicate_click');

    expect(duplicate.id).toBe(created.id);
    expect(created.toolTrace.map((step) => step.provider)).toContain('county_recorder');
    expect(recoverableResearchMissionIds()).toContain(created.id);
    expect(claimResearchMission(created.id)).toMatchObject({ status: 'running', attempt: 1 });
    expect(latestResearchMission(opportunity.id)).toMatchObject({ id: created.id, status: 'running' });
  });

  it('recovers a stale running mission after restart without exceeding the retry ceiling', () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Restart recovery lead' });
    const opportunity = ensureOpportunityForLegacyDealCard(deal.id);
    const mission = createResearchMission(opportunity, {
      address: '10 Main Street', city: 'Kingstree', county: 'Williamsburg', state: 'SC', apn: null,
      source: 'manual_input',
    }, 'automatic_manual_intake');

    expect(claimResearchMission(mission.id)).toMatchObject({ status: 'running', attempt: 1 });
    getLandosDb().prepare(`UPDATE landos_opportunity_research_mission SET updated_at = unixepoch() - 120 WHERE id = ?`).run(mission.id);
    expect(recoverableResearchMissionIds()).toContain(mission.id);

    getLandosDb().prepare(`UPDATE landos_opportunity_research_mission SET attempt = 3, updated_at = unixepoch() - 120 WHERE id = ?`).run(mission.id);
    expect(recoverableResearchMissionIds()).not.toContain(mission.id);
  });

  it('retains wrong-property evidence for audit while excluding it from canonical readers', () => {
    const property = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '272 McAlister Road', city: 'Kingstree',
      county: 'Williamsburg', state: 'SC', verified: false,
    }).card;
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: '272 McAlister Road, Kingstree SC' });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: property.id, role: 'subject' });
    const opportunity = ensureOpportunityForLegacyDealCard(deal.id);
    savePropertyInspection(property.id, {
      ...emptyInspection,
      parcelFacts: {
        'Parcel Address': '272 McAlister Road', 'Parcel Address City': 'Lincolnton',
        'Parcel Address County': 'Lincoln', 'Parcel Address State': 'NC', 'Parcel ID': '52394',
      },
    });
    expect(loadPropertyInspection(property.id)?.parcelFacts['Parcel Address State']).toBe('NC');

    const quarantined = quarantineMismatchedPropertyInspections(opportunity.id, property.id, {
      address: '272 McAlister Road', city: 'Kingstree', county: 'Williamsburg', state: 'SC', apn: null,
      source: 'opportunity_title',
    });

    expect(quarantined).toHaveLength(1);
    expect(loadPropertyInspection(property.id)).toBeNull();
    expect(listQuarantinedResearchEvidence(opportunity.id)[0]).toMatchObject({
      activityId: quarantined[0].activityId,
      verification: { accepted: false, verdict: 'jurisdiction_mismatch' },
    });
    expect(getLandosDb().prepare('SELECT COUNT(*) AS n FROM landos_card_activity WHERE id = ?').get(quarantined[0].activityId)).toEqual({ n: 1 });
  });

  it('accepts a parcel as candidate when APN, county, and state match exactly but the displayed address differs', () => {
    const expected = {
      address: '1023 Baysinger Rd', city: 'Newport', county: 'Cocke', state: 'TN', apn: '027 04512',
      source: 'manual_input' as const,
    };
    const verification = verifyInspectionIdentity(expected, {
      ...emptyInspection,
      parcelFacts: {
        'Parcel Address': 'TALLEY RD', 'Parcel Address City': '',
        'Parcel Address County': 'Cocke', 'Parcel Address State': 'TN', 'Parcel ID': '027 04512',
        'Owner Name': 'JOINES TRAVIS',
      },
    });

    expect(verification.accepted).toBe(true);
    expect(verification.identityState).toBe('candidate');
    expect(verification.verdict).toBe('address_mismatch');
    expect(verification.reasons).toEqual([]);
    expect(verification.warnings.join(' ')).toMatch(/address mismatch.*APN \+ county \+ state match exactly/i);
  });

  it('restores a retained county-ID inspection when the official statewide APN and street corroborate it', () => {
    const property = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: '1023 Baysinger Rd', city: 'Newport',
      county: 'Cocke', state: 'TN', verified: false,
    }).card;
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: '1023 Baysinger Rd, Newport TN' });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: property.id, role: 'subject' });
    const opportunity = ensureOpportunityForLegacyDealCard(deal.id);
    savePropertyInspection(property.id, {
      ...emptyInspection,
      parcelFacts: {
        'Parcel Address': 'TALLEY RD', 'Parcel Address City': '',
        'Parcel Address County': 'Cocke', 'Parcel Address State': 'TN', 'Parcel ID': '027 04512',
      },
    });
    expect(quarantineMismatchedPropertyInspections(opportunity.id, property.id, {
      address: '1023 Baysinger Rd', city: 'Newport', county: 'Cocke', state: 'TN', apn: 'wrong-apn',
      source: 'manual_input',
    })).toHaveLength(1);
    expect(loadPropertyInspection(property.id)).toBeNull();

    const constraints = {
      address: 'TALLEY RD, Newport, TN 37843', city: 'Newport', county: 'Cocke', state: 'TN',
      apn: '015 027 04512 000 2026', source: 'property_fallback' as const,
    };
    expect(verifyInspectionIdentity(constraints, {
      ...emptyInspection,
      parcelFacts: {
        'Parcel Address': 'TALLEY RD', 'Parcel Address City': '',
        'Parcel Address County': 'Cocke', 'Parcel Address State': 'TN', 'Parcel ID': '027 04512',
      },
    })).toMatchObject({ accepted: true, identityState: 'confirmed', verdict: 'matched' });
    expect(restoreMatchingPropertyInspections(opportunity.id, property.id, constraints)).toHaveLength(1);
    expect(loadPropertyInspection(property.id)?.parcelFacts['Parcel ID']).toBe('027 04512');
    expect(listQuarantinedResearchEvidence(opportunity.id)).toHaveLength(0);
  });

  it('keeps a conflicting APN fatal even when the rest of the parcel matches', () => {
    const expected = {
      address: '1023 Baysinger Rd', city: 'Newport', county: 'Cocke', state: 'TN', apn: '027 04512',
      source: 'manual_input' as const,
    };
    const verification = verifyInspectionIdentity(expected, {
      ...emptyInspection,
      parcelFacts: {
        'Parcel Address': 'TALLEY RD', 'Parcel Address City': 'Newport',
        'Parcel Address County': 'Cocke', 'Parcel Address State': 'TN', 'Parcel ID': '027 04513',
      },
    });

    expect(verification.accepted).toBe(false);
    expect(verification.identityState).toBe('conflicted');
    expect(verification.verdict).toBe('apn_mismatch');
    expect(verification.reasons.join(' ')).toMatch(/APN mismatch/);
  });

  it('preserves city mismatch forgiveness when APN, address, county, and state all match', () => {
    const expected = {
      address: '473 Seaside Rd', city: 'Beaufort', county: 'Beaufort', state: 'SC', apn: 'R300 018 000 0085 0000',
      source: 'manual_input' as const,
    };
    const verification = verifyInspectionIdentity(expected, {
      ...emptyInspection,
      parcelFacts: {
        'Parcel Address': '473 SEASIDE RD', 'Parcel Address City': 'SAINT HELENA ISLAND',
        'Parcel Address County': 'Beaufort County', 'Parcel Address State': 'SC', 'Parcel ID': 'R300 018 000 0085 0000',
      },
    });

    expect(verification.accepted).toBe(true);
    expect(verification.identityState).toBe('confirmed');
    expect(verification.verdict).toBe('matched');
    expect(verification.reasons).toEqual([]);
  });
});
