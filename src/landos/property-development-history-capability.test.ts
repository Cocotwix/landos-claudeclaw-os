import { beforeEach, describe, expect, it } from 'vitest';

import type { CapabilityResult, JsonObject } from './capability-contract.js';
import { invokeRuntimeCapability, listRuntimeCapabilities } from './capability-registry.js';
import { _initTestLandosDb, getLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import type { DocumentIntelligenceReadModel } from './official-document-intelligence-store.js';
import type { PropertyBackstory, PropertyBackstoryEvent } from './property-backstory.js';
import {
  NO_MATERIAL_HISTORY_STATEMENT,
  PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY,
  PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY_ID,
  type PropertyDevelopmentHistoryFacts,
  type PropertyDevelopmentHistoryRuntime,
} from './property-development-history-capability.js';
import { upsertPropertyCard } from './property-card.js';

beforeEach(() => { _initTestLandosDb(); });

const NOW = '2026-08-18T12:00:00.000Z';
const PACKET_URL = 'https://www.fairview-tn.org/planning/packet-2024-12.pdf';
const MINUTES_URL = 'https://www.fairview-tn.org/planning/minutes-2025-01.pdf';

/** A canonical subject the way Property Resolution leaves it on a Deal Card. */
function canonicalSubject(overrides: { apn?: string; address?: string; title?: string } = {}) {
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: overrides.title ?? 'Map 042 Parcel 123' });
  const { card } = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: overrides.address ?? 'Map 042 Parcel 123, Fairview, TN',
    apn: overrides.apn ?? '042 123.00',
    county: 'Williamson',
    state: 'TN',
    acres: 61.5,
    verified: true,
    verificationSource: 'Williamson County Property Assessor',
  });
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
  return { deal, card };
}

function event(overrides: Partial<PropertyBackstoryEvent> = {}): PropertyBackstoryEvent {
  return {
    key: 'packet-2024-12:4:subdivision_application',
    eventDate: 'December 10, 2024',
    dateBasis: 'document_stated_date',
    eventType: 'subdivision_application',
    governingBody: 'Fairview Municipal Planning Commission',
    subjectOrProject: 'Kingwood Subdivision',
    status: 'proposed',
    summary: 'A 119-lot residential subdivision was presented for the parcel.',
    apn: '042 123.00',
    parcelNotation: 'Map 042 Parcel 123',
    owner: 'Landsouth Holdings LLC',
    applicant: 'Kingwood Development Partners',
    materialNumbers: { acres: 61.5, lots: 119, units: null, statedAs: ['119 lots'] },
    sourceUrl: PACKET_URL,
    evidence: [{
      evidenceId: 11, sourceUrl: PACKET_URL, sourceTitle: 'Planning Commission Packet, December 2024',
      page: 4, pageBasis: 'approximate_content_stream_order',
      quote: 'The applicant proposes a 119-lot subdivision known as Kingwood.',
      sourceClassification: 'official_government_document', retrievedAt: NOW,
    }],
    retrievedAt: NOW,
    confidence: 'confirmed',
    limitations: [],
    ...overrides,
  };
}

function backstory(overrides: Partial<PropertyBackstory> = {}): PropertyBackstory {
  return {
    dealCardId: 1,
    subject: {
      dealCardId: 1, apn: '042 123.00', parcelNotation: 'Map 042 Parcel 123',
      owner: 'Landsouth Holdings LLC', address: 'Map 042 Parcel 123', city: 'Fairview',
      county: 'Williamson County', state: 'TN', acres: 61.5, projectName: 'Kingwood Subdivision',
    },
    events: [event()],
    zoningReferences: [{
      kind: 'requested', value: 'SR (Suburban Residential)', asOf: 'December 10, 2024',
      sourceUrl: PACKET_URL, page: 4, quote: 'The applicant requests rezoning to SR.',
      neverEstablishesCurrentZoning: true,
    }],
    summary: {
      narrative: 'In December 2024 a 119-lot subdivision was presented to the Planning Commission for this parcel.',
      highlights: ['Dec 2024 — Kingwood Subdivision, 119 lots proposed'],
      openQuestions: ['Whether the Planning Commission ever took final action on the plan.'],
      limitations: [],
    },
    documentsReused: [{ documentKey: 'packet-2024-12', sourceUrl: PACKET_URL, sourceTitle: 'Planning Commission Packet, December 2024', findingCount: 6 }],
    documentsRetrieved: [],
    sourcesConsulted: [{ url: PACKET_URL, title: 'Planning Commission Packet, December 2024', used: true, note: 'Answered from storage.' }],
    limitations: [],
    generatedAt: NOW,
    ...overrides,
  };
}

/** Retained document intelligence, exactly as the resolver left it. */
function intelligence(overrides: Partial<DocumentIntelligenceReadModel> = {}): DocumentIntelligenceReadModel {
  return {
    dealCardId: 1,
    findings: [
      {
        evidenceId: 11, dealCardId: 1, propertyIdentityVersionId: 1, category: 'applicant_or_representative',
        value: 'Kingwood Development Partners', context: 'Applicant: Kingwood Development Partners.',
        sourceUrl: PACKET_URL, sourceTitle: 'Planning Commission Packet, December 2024', page: 4,
        pageBasis: 'approximate_content_stream_order', sourceClassification: 'official_government_document',
        matchedBy: 'parcel notation', confidence: 'high', documentKey: 'packet-2024-12',
        contentHash: 'abc', retrievedAt: NOW, minedAt: NOW,
      },
      {
        evidenceId: 12, dealCardId: 1, propertyIdentityVersionId: 1, category: 'project_name',
        value: 'Kingwood Subdivision', context: 'Kingwood Subdivision, Phase 1.',
        sourceUrl: PACKET_URL, sourceTitle: 'Planning Commission Packet, December 2024', page: 4,
        pageBasis: 'approximate_content_stream_order', sourceClassification: 'official_government_document',
        matchedBy: 'parcel notation', confidence: 'high', documentKey: 'packet-2024-12',
        contentHash: 'abc', retrievedAt: NOW, minedAt: NOW,
      },
    ],
    summaries: [],
    documents: [{ documentKey: 'packet-2024-12', sourceUrl: PACKET_URL, sourceTitle: 'Planning Commission Packet, December 2024', findingCount: 6, retrievedAt: NOW }],
    ...overrides,
  };
}

const facts = (result: CapabilityResult): PropertyDevelopmentHistoryFacts =>
  result.facts as PropertyDevelopmentHistoryFacts;

async function run(
  deal: { id: number },
  card: { id: number },
  runtime: PropertyDevelopmentHistoryRuntime,
  parameters: JsonObject = {},
): Promise<CapabilityResult> {
  return invokeRuntimeCapability({
    capabilityId: PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY_ID,
    caller: { type: 'deal_card', ref: `deal:${deal.id}` },
    subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
    mode: 'refresh',
    parameters,
  }, runtime);
}

describe('Property Development History Capability', () => {
  it('is registered as its own business capability, separate from Zoning & Subdivision', () => {
    const ids = listRuntimeCapabilities().map((capability) => capability.id);
    expect(ids).toContain(PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY_ID);
    expect(ids).toContain('zoning-subdivision');
    expect(PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY.metadata.name).toBe('Property Development History');
  });

  it('answers from the context LandOS already retained, without launching a search', async () => {
    const { deal, card } = canonicalSubject();
    let searched = 0;
    const result = await run(deal, card, {
      readBackstory: () => backstory(),
      readIntelligence: () => intelligence(),
      readCrmContacts: () => [],
      runHistorySearch: async () => { searched += 1; return backstory(); },
    });

    // The default lane consumes storage and never reaches the search transport.
    expect(searched).toBe(0);
    expect(result.status).toBe('SUCCEEDED');
    const projected = facts(result);
    expect(projected.lane).toBe('retained_history');
    expect(projected.outcome).toBe('history_returned');
    expect(projected.retainedContext.consumedBeforeSearch).toBe(true);
    expect(projected.retainedContext.documentsHeld).toBe(1);
    expect(projected.retainedContext.findingsHeld).toBe(2);
    expect(projected.search.ran).toBe(false);
    expect(projected.search.note).toContain('already retained');
    expect(projected.history.eventCount).toBe(1);
    expect(projected.history.events[0].projectName).toBe('Kingwood Subdivision');

    // Authoritative source URLs survive onto the facts AND the evidence rows.
    expect(projected.sources.map((source) => source.url)).toContain(PACKET_URL);
    expect(projected.sources.find((source) => source.url === PACKET_URL)?.reusedFromStorage).toBe(true);
    expect(result.evidence.map((item) => item.sourceUrl)).toContain(PACKET_URL);
  });

  it('preserves proposal, recommendation and approval as different claims', async () => {
    const { deal, card } = canonicalSubject();
    const projected = facts(await run(deal, card, {
      readBackstory: () => backstory({
        events: [
          event(),
          event({ key: 'minutes:2:governing_body_matter', status: 'recommended', eventType: 'governing_body_matter', eventDate: 'January 14, 2025', sourceUrl: MINUTES_URL }),
          event({ key: 'minutes:3:plat_approval', status: 'approved', eventType: 'plat_approval', eventDate: 'March 11, 2025', sourceUrl: MINUTES_URL, materialNumbers: { acres: 61.5, lots: 87, units: null, statedAs: ['87 lots'] } }),
          // The two records that most easily read as entitlement and are not:
          // a first reading, and an approved rezoning beside a proposed count.
          event({ key: 'minutes:4:rezoning', status: 'adopted', eventType: 'rezoning', eventDate: 'April 8, 2025', sourceUrl: MINUTES_URL }),
          event({ key: 'minutes:5:rezoning_approved', status: 'approved', eventType: 'rezoning', eventDate: 'May 13, 2025', sourceUrl: MINUTES_URL, materialNumbers: { acres: 61.5, lots: 119, units: null, statedAs: ['119 lots'] } }),
        ],
      }),
      readIntelligence: () => intelligence(),
      readCrmContacts: () => [],
    }));

    const [proposal, recommendation, platApproval, firstReading, rezoningApproval] = projected.history.events;

    // A proposal is a proposal. The lot count is PROPOSED.
    expect(proposal.statusClass).toBe('request_or_proposal');
    expect(proposal.proposedLots).toBe(119);
    expect(proposal.entitlementBasis).toContain('not what was granted');

    // A recommendation is not a decision.
    expect(recommendation.statusClass).toBe('recommendation');
    expect(recommendation.entitlementBasis).toContain('not a decision');

    // A recorded action is reported as the action it was. It is NEVER promoted
    // into an entitlement, and no event of any status or type carries one: a
    // plat approval, an ordinance passed on a reading, and an approved
    // rezoning beside a proposed lot count all report the same honest answer.
    expect(platApproval.statusClass).toBe('final_action');
    expect(firstReading.statusClass).toBe('final_action');
    expect(rezoningApproval.statusClass).toBe('final_action');
    for (const row of projected.history.events) {
      expect(row.entitlementEstablished).toBe(false);
      expect(row.entitlementBasis).toBeTruthy();
      expect(row).not.toHaveProperty('entitledLots');
    }
    expect(platApproval.entitlementBasis).toContain('not a final entitlement');
    // The lot count beside an approved rezoning stays a PROPOSED count.
    expect(rezoningApproval.proposedLots).toBe(119);

    // A requested district is never presented as the district in force.
    expect(projected.history.zoningReferences[0]).toMatchObject({
      kind: 'requested', neverEstablishesCurrentZoning: true,
    });
  });

  it('returns an honest no-material-history result after a bounded search', async () => {
    const { deal, card } = canonicalSubject();
    let searched = 0;
    const result = await run(deal, card, {
      readBackstory: () => null,
      readIntelligence: () => intelligence({ findings: [], documents: [] }),
      readCrmContacts: () => [],
      runHistorySearch: async () => {
        searched += 1;
        return backstory({
          events: [], zoningReferences: [], documentsReused: [], documentsRetrieved: [],
          sourcesConsulted: [{ url: 'https://www.fairview-tn.org/planning', title: 'Planning department', used: false, note: 'No parcel-specific matter located.' }],
          summary: { narrative: '', highlights: [], openQuestions: [], limitations: [] },
        });
      },
    }, { lane: 'research' });

    // ONE bounded search. It does not keep broadening because nothing was found.
    expect(searched).toBe(1);
    const projected = facts(result);
    expect(projected.search.ran).toBe(true);
    expect(projected.search.bounded).toBe(true);
    expect(projected.history.established).toBe(false);
    expect(projected.outcome).toBe('no_material_history');
    expect(projected.history.statement).toBe(NO_MATERIAL_HISTORY_STATEMENT);
    // Absence is reported as what LandOS did not establish, never as proof.
    expect(result.missingInformation.join(' ')).toContain('does not mean no history exists');
    expect(result.status).toBe('NEEDS_INPUT');
  });

  it('keeps history property-specific: one parcel\'s record never answers for another', async () => {
    const first = canonicalSubject();
    const second = canonicalSubject({ apn: '042 145.00', address: 'Map 042 Parcel 145, Fairview, TN', title: 'Map 042 Parcel 145' });

    // The store is keyed by deal card, and the capability reads it that way.
    const byDeal = new Map<number, PropertyBackstory>([[first.deal.id, backstory()]]);
    const runtime: PropertyDevelopmentHistoryRuntime = {
      readBackstory: (dealCardId) => byDeal.get(dealCardId) ?? null,
      readIntelligence: (dealCardId) => (dealCardId === first.deal.id ? intelligence() : intelligence({ findings: [], documents: [] })),
      readCrmContacts: () => [],
    };

    const a = facts(await run(first.deal, first.card, runtime));
    const b = facts(await run(second.deal, second.card, runtime));

    expect(a.history.established).toBe(true);
    expect(a.history.events[0].projectName).toBe('Kingwood Subdivision');

    // The neighbouring parcel shares the jurisdiction and shares nothing else.
    expect(b.history.established).toBe(false);
    expect(b.history.events).toEqual([]);
    expect(b.relatedParties).toEqual([]);
    expect(b.history.statement).toBe(NO_MATERIAL_HISTORY_STATEMENT);
  });

  it('labels discovered applicants and owners by role and never overwrites the CRM seller', async () => {
    const { deal, card } = canonicalSubject();
    const db = getLandosDb();
    const person = db.prepare(
      `INSERT INTO landos_person (entity, name, phone) VALUES ('TY_LAND_BIZ', 'Marlene Pratt', '615-555-0142')`,
    ).run();
    db.prepare(
      `INSERT INTO landos_person_link (person_id, deal_card_id, role) VALUES (?, ?, 'seller')`,
    ).run(Number(person.lastInsertRowid), deal.id);

    const sellerBefore = db.prepare('SELECT name, phone FROM landos_person WHERE id = ?').get(Number(person.lastInsertRowid));

    const projected = facts(await run(deal, card, {
      readBackstory: () => backstory(),
      readIntelligence: () => intelligence(),
    }));

    // Each discovered party carries its OWN role, and none of them is a contact.
    const roles = Object.fromEntries(projected.relatedParties.map((party) => [party.name, party.role]));
    expect(roles['Kingwood Development Partners']).toBe('applicant_or_developer');
    expect(roles['Landsouth Holdings LLC']).toBe('owner_of_record_at_the_time');
    expect(roles['Kingwood Subdivision']).toBe('project');
    for (const party of projected.relatedParties) {
      expect(party.crmContact).toBe(false);
      expect(party.overwritesCrmSeller).toBe(false);
    }
    // The applicant is NOT presented as the seller.
    expect(projected.relatedParties.find((party) => party.name === 'Kingwood Development Partners')?.roleLabel)
      .toBe('Applicant / developer');

    // The operator's own contact is read back unchanged, and the CRM row itself
    // is byte-for-byte what it was before the capability ran.
    expect(projected.crmContacts).toEqual([{ name: 'Marlene Pratt', role: 'seller' }]);
    expect(db.prepare('SELECT name, phone FROM landos_person WHERE id = ?').get(Number(person.lastInsertRowid)))
      .toEqual(sellerBefore);
    expect(db.prepare('SELECT COUNT(*) AS n FROM landos_person').get()).toEqual({ n: 1 });
  });

  it('creates no lead, Deal Card or Property Card for a Tools subject LandOS does not hold', async () => {
    const result = await invokeRuntimeCapability({
      capabilityId: PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY_ID,
      caller: { type: 'tools', ref: 'tools:property-development-history' },
      subject: { kind: 'raw_property', entity: 'TY_LAND_BIZ', rawInput: '412 Nowhere Road, Elsewhere County' },
      mode: 'refresh',
    }, {
      resolveSubject: async () => ({
        invocationId: 'stub',
        capability: { id: 'property-resolution', name: 'Property Resolution', contractVersion: '1.0', description: '' },
        status: 'SUCCEEDED',
        subjectResolution: 'RESOLVED',
        canonicalSubject: { kind: 'research_session', id: 'session-1', temporary: true },
        facts: { canonicalIdentity: { address: '412 Nowhere Road', county: 'Elsewhere', state: 'TN' } },
        evidence: [],
        warnings: [],
        missingInformation: [],
        timestamps: { startedAt: NOW, completedAt: NOW },
        execution: { mode: 'refresh', durationMs: 1, reused: false },
      }),
    });

    expect(result.status).toBe('NEEDS_INPUT');
    expect(result.warnings.join(' ')).toContain('Nothing was created.');
    expect(getLandosDb().prepare('SELECT COUNT(*) AS n FROM landos_deal_card').get()).toEqual({ n: 0 });
  });

  it('completes when it forwards evidence a previous invocation already persisted', async () => {
    // Regression: this capability carries Property Resolution's evidence into
    // its own result, and those forwarded items already hold the row id the
    // resolution invocation was written under. Writing them again under that
    // id collided with the row that owns it, and the whole invocation failed to
    // complete. Two runs that forward the SAME evidence id must both persist.
    const { deal, card } = canonicalSubject();
    const forwarded = {
      id: 'evidence_shared_across_invocations',
      source: 'Planning Commission Packet, December 2024',
      sourceUrl: PACKET_URL,
      sourceType: 'official_government_document',
      retrievedAt: NOW,
    };
    const resolution = (): CapabilityResult => ({
      invocationId: 'stub-resolution',
      capability: { id: 'property-resolution', name: 'Property Resolution', contractVersion: '1.0', description: '' },
      status: 'SUCCEEDED',
      subjectResolution: 'RESOLVED',
      canonicalSubject: { kind: 'property', id: String(card.id), propertyCardId: card.id, dealCardId: deal.id, temporary: false },
      facts: { canonicalIdentity: { address: 'Map 042 Parcel 123', county: 'Williamson', state: 'TN' } },
      evidence: [forwarded],
      warnings: [],
      missingInformation: [],
      timestamps: { startedAt: NOW, completedAt: NOW },
      execution: { mode: 'refresh', durationMs: 1, reused: false },
    });

    const runtime: PropertyDevelopmentHistoryRuntime = {
      resolveSubject: async () => resolution(),
      readBackstory: () => backstory(),
      readIntelligence: () => intelligence(),
      readCrmContacts: () => [],
    };
    const invoke = () => invokeRuntimeCapability({
      capabilityId: PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY_ID,
      caller: { type: 'tools', ref: 'tools:property-development-history' },
      subject: { kind: 'raw_property', entity: 'TY_LAND_BIZ', rawInput: 'Map 042 Parcel 123, Fairview, Tennessee' },
      mode: 'refresh',
    }, runtime);

    const first = await invoke();
    const second = await invoke();
    expect(first.status).toBe('SUCCEEDED');
    expect(second.status).toBe('SUCCEEDED');
    // Each invocation owns its own evidence row, and both survived the write.
    expect(first.evidence.map((item) => item.id)).not.toEqual(second.evidence.map((item) => item.id));
    const rows = getLandosDb().prepare(
      'SELECT COUNT(*) AS n FROM landos_capability_evidence WHERE source_url = ?',
    ).get(PACKET_URL) as { n: number };
    expect(rows.n).toBeGreaterThanOrEqual(2);
  });

  it('reclaims an idempotency key an abandoned run left behind', async () => {
    // Regression: an invocation that never reached `complete` left its row
    // `running`, and every later caller with the same key waited the full
    // wait window and then failed. Past that window the row is abandoned, so
    // the key is reclaimed and the run proceeds.
    const { deal, card } = canonicalSubject();
    const runtime: PropertyDevelopmentHistoryRuntime = {
      readBackstory: () => backstory(),
      readIntelligence: () => intelligence(),
      readCrmContacts: () => [],
    };
    const request = {
      capabilityId: PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY_ID,
      caller: { type: 'deal_card' as const, ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property' as const, entity: 'TY_LAND_BIZ' as const, propertyCardId: card.id, dealCardId: deal.id },
    };

    const done = await invokeRuntimeCapability(request, runtime);
    expect(done.status).toBe('SUCCEEDED');

    // Strand the completed row the way a crashed run would have left it.
    const db = getLandosDb();
    db.prepare("UPDATE landos_capability_invocation SET status = 'running', result_json = 'null' WHERE id = ?")
      .run(done.invocationId);
    db.prepare("UPDATE landos_capability_invocation SET started_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 11 * 60_000).toISOString(), done.invocationId);

    const after = await invokeRuntimeCapability(request, runtime);
    expect(after.status).toBe('SUCCEEDED');
    expect(after.invocationId).not.toBe(done.invocationId);
    // The abandoned run is kept as a durable record, not deleted.
    expect(db.prepare('SELECT status FROM landos_capability_invocation WHERE id = ?').get(done.invocationId))
      .toEqual({ status: 'running' });
  });

  it('refuses caller-supplied history or entitlement assertions', () => {
    expect(() => PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY.validate({
      capabilityId: PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY_ID,
      caller: { type: 'tools' },
      subject: { kind: 'raw_property', entity: 'TY_LAND_BIZ', rawInput: 'x' },
      context: { approved: true },
    })).toThrow(/caller-supplied history, entitlement or party assertions/);

    expect(() => PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY.validate({
      capabilityId: PROPERTY_DEVELOPMENT_HISTORY_CAPABILITY_ID,
      caller: { type: 'tools' },
      subject: { kind: 'raw_property', entity: 'TY_LAND_BIZ', rawInput: 'x' },
      parameters: { lots: 119 },
    })).toThrow(/does not accept caller-supplied lots/);
  });
});
