import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { _initTestLandosDb, getLandosDb } from './db.js';
import { addPerson, createDealCard, getDealCard, linkPerson, linkPropertyToDeal } from './deal-card.js';
import { upsertPropertyCard } from './property-card.js';
import { ensureOpportunityForLegacyDealCard } from './opportunity.js';
import {
  analyzeLeadCardIntake,
  listLeadCardIntake,
  listPublicRecordOutcomes,
  listResourceContacts,
  namesReconcile,
  ownerFacingPersonName,
  persistLeadCardIntake,
  publicRecordSearchHierarchy,
  reconcileDealPersonIdentity,
  upsertPublicRecordOutcome,
  upsertResourceContact,
} from './lead-card-intake.js';

beforeEach(() => _initTestLandosDb());

function seedDeal() {
  const card = upsertPropertyCard({
    entity: 'TY_LAND_BIZ', activeInputAddress: 'TALLEY RD', city: 'Newport', county: 'Cocke', state: 'TN',
    apn: '015 027 04512 000 2026', owner: 'JOINES TRAVIS', acres: 5.82,
    verified: true, verificationSource: 'Tennessee Comptroller parcel layer',
  }).card;
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Talley Rd lead' });
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
  const personId = addPerson({ entity: 'TY_LAND_BIZ', name: 'Travis Jones', phone: '423-555-0100', email: 'travis@example.test' });
  linkPerson({ personId, dealCardId: deal.id, role: 'seller' });
  return { card, deal, personId };
}

describe('Deal Card identity reconciliation', () => {
  it('reconciles the corrected lead and official reversed owner format into one person without losing contact or history', () => {
    const { card, deal, personId } = seedDeal();
    getLandosDb().prepare(`INSERT INTO landos_card_activity (card_id,agent_id,kind,summary,ref) VALUES (?,'operator','note','Original Travis Jones intake retained','prior')`).run(card.id);
    const opportunity = ensureOpportunityForLegacyDealCard(deal.id);
    const pkg = { schemaVersion: 3, opportunityId: opportunity.id, contentHash: 'old', identity: { contacts: [{ name: 'Travis Jones', phone: '423-555-0100' }], apparentRecordOwners: ['JOINES TRAVIS'], rawInput: 'Original JOINES TRAVIS source text' } };
    getLandosDb().prepare(`INSERT INTO landos_opportunity_discovery_package (opportunity_id,package_version,content_hash,package_json,source_updated_at) VALUES (?,3,'old',?,1)`).run(opportunity.id, JSON.stringify(pkg));

    const result = reconcileDealPersonIdentity({
      dealCardId: deal.id, canonicalName: 'Travis Joines', officialName: 'JOINES TRAVIS', knownIncorrectNames: ['Travis Jones'],
    });

    expect(result.personId).toBe(personId);
    expect(namesReconcile('JOINES TRAVIS', 'Travis Joines')).toBe(true);
    expect(ownerFacingPersonName('JOINES TRAVIS', deal.id)).toBe('Travis Joines');
    const detail = getDealCard(deal.id)!;
    expect(detail.people).toHaveLength(1);
    expect(detail.people[0]).toMatchObject({ name: 'Travis Joines', phone: '423-555-0100', email: 'travis@example.test' });
    expect((detail.people[0] as { roles: string[] }).roles).toEqual(expect.arrayContaining(['seller', 'lead_contact', 'record_owner']));
    expect((detail.propertyCards[0] as { owner: string }).owner).toBe('Travis Joines');
    expect((getLandosDb().prepare('SELECT COUNT(*) AS n FROM landos_person').get() as { n: number }).n).toBe(1);
    expect((getLandosDb().prepare('SELECT COUNT(*) AS n FROM landos_person_alias WHERE person_id=?').get(personId) as { n: number }).n).toBeGreaterThanOrEqual(3);
    const activity = getLandosDb().prepare('SELECT summary FROM landos_card_activity WHERE card_id=? ORDER BY id').all(card.id) as Array<{ summary: string }>;
    expect(activity.map((row) => row.summary)).toEqual(expect.arrayContaining(['Original Travis Jones intake retained']));
    expect(activity.some((row) => /official formatting JOINES TRAVIS is retained/i.test(row.summary))).toBe(true);
    const stored = getLandosDb().prepare('SELECT content_hash,package_json FROM landos_opportunity_discovery_package WHERE opportunity_id=?').get(opportunity.id) as { content_hash: string; package_json: string };
    const refreshed = JSON.parse(stored.package_json);
    expect(refreshed.identity.contacts[0].name).toBe('Travis Joines');
    expect(refreshed.identity.apparentRecordOwners).toEqual(['Travis Joines']);
    expect(refreshed.identity.rawInput).toBe('Original JOINES TRAVIS source text');
    expect(stored.content_hash).not.toBe('old');
  });
});

describe('Smart intake and transcript routing', () => {
  it('retains the original, routes useful sections, labels statements, and preserves accepted facts on conflict', async () => {
    const { deal } = seedDeal();
    const original = 'Seller stated acreage is 8 acres. APN: 015 027 04512 000 2026. Confirm road access and septic. Follow-up: call planning.';
    const saved = await persistLeadCardIntake({ dealCardId: deal.id, text: original, submissionType: 'general', source: 'test' });
    expect(saved.originalText).toBe(original);
    expect(saved.sections).toEqual(expect.arrayContaining(['seller_contact', 'property', 'due_diligence', 'utilities_septic_access', 'activity']));
    expect(saved.transcript).toBeNull();
    expect(saved.followUps).toContain('call planning.');
    const intake = listLeadCardIntake(deal.id);
    expect(intake[0].originalText).toBe(original);
    expect((intake[0].facts as Array<Record<string, unknown>>).some((fact) => fact.fact_key === 'acreage' && fact.fact_status === 'conflict' && /5.82/.test(String(fact.conflictNote)))).toBe(true);
    expect((getDealCard(deal.id)!.propertyCards[0] as { acres: number }).acres).toBe(5.82);
  });

  it('extracts a concise transcript result and creates a deduplicated resource contact plus follow-up work', async () => {
    const { card, deal } = seedDeal();
    const transcript = [
      'Call date: 2026-07-22', 'Spoke with Ashley Shelton', 'Organization: Cocke County', 'Department: Zoning Department',
      'Phone: 423-237-7600', 'Property discussed: TALLEY RD, APN 015 027 04512 000 2026',
      'Confirmed: A zoning permit is required before development.', 'Contact stated: Staff must confirm the parcel zoning district.',
      'Restriction: Septic approval is required when applicable.', 'Question: What district covers the APN?',
      'Follow-up: Confirm parcel zoning and minor-split feasibility.',
    ].join('\n');
    const analyzed = await analyzeLeadCardIntake({ text: transcript, submissionType: 'transcript' });
    expect(analyzed.transcript).toMatchObject({ person: 'Ashley Shelton', organization: 'Cocke County', department: 'Zoning Department', phone: '423-237-7600', callDate: '2026-07-22' });
    expect(analyzed.transcript?.confirmedFacts).toContain('A zoning permit is required before development.');
    expect(analyzed.transcript?.contactStatedFacts).toContain('Staff must confirm the parcel zoning district.');
    expect(analyzed.transcript?.unresolvedQuestions).toEqual(['What district covers the APN?']);
    await persistLeadCardIntake({ dealCardId: deal.id, text: transcript, submissionType: 'transcript', source: 'test' });
    await persistLeadCardIntake({ dealCardId: deal.id, text: transcript, submissionType: 'transcript', source: 'test' });
    expect(listResourceContacts(deal.id)).toHaveLength(1);
    const actions = getLandosDb().prepare('SELECT action FROM landos_card_next_action WHERE card_id=?').all(card.id) as Array<{ action: string }>;
    expect(actions.some((row) => /minor-split feasibility/i.test(row.action))).toBe(true);
    expect(listLeadCardIntake(deal.id)[0].originalText).toBe(transcript);
    const newest = getLandosDb().prepare('SELECT id,extracted_json FROM landos_intake_submission WHERE deal_card_id=? ORDER BY id DESC LIMIT 1').get(deal.id) as { id: number; extracted_json: string };
    const legacyExtracted = JSON.parse(newest.extracted_json);
    legacyExtracted.transcript.unresolvedQuestions = ['What district covers the APN?', 'Question: What district covers the APN?'];
    getLandosDb().prepare('UPDATE landos_intake_submission SET extracted_json=? WHERE id=?').run(JSON.stringify(legacyExtracted), newest.id);
    expect(((listLeadCardIntake(deal.id)[0].extracted as { transcript: { unresolvedQuestions: string[] } }).transcript.unresolvedQuestions)).toEqual(['What district covers the APN?']);
  });
});

describe('Resources and public-record outcomes', () => {
  it('deduplicates the same representative while allowing multiple people at one department', () => {
    const { deal } = seedDeal();
    const base = { dealCardId: deal.id, category: 'planning_zoning' as const, organization: 'Cocke County', department: 'Zoning Department' };
    upsertResourceContact({ ...base, representative: 'Ashley Shelton', phone: '423-237-7600' });
    upsertResourceContact({ ...base, representative: 'Ashley Shelton', email: 'zoning@example.test' });
    upsertResourceContact({ ...base, representative: 'Second Representative', phone: '423-555-0199' });
    const contacts = listResourceContacts(deal.id);
    expect(contacts).toHaveLength(2);
    expect(contacts.find((row) => row.representative === 'Ashley Shelton')).toMatchObject({ phone: '423-237-7600', email: 'zoning@example.test' });
  });

  it('supports road-only vacant parcels, treats owner names as discovery only, and persists honest retrieved/no-retrieval outcomes', () => {
    const { deal } = seedDeal();
    const hierarchy = publicRecordSearchHierarchy({ county: 'Cocke', state: 'TN', apn: '015 027 04512 000 2026', owner: 'JOINES TRAVIS', address: 'TALLEY RD', acreage: 5.82, lat: 36.0298, lng: -83.1112 });
    expect(hierarchy).toMatchObject({ subjectReady: true, roadOnlyAccepted: true, ownerIsDiscoveryOnly: true });
    expect(hierarchy.authorities.map((row) => row.label).join(' ')).toMatch(/assessor.*tax.*register of deeds.*planning/i);
    upsertPublicRecordOutcome({ dealCardId: deal.id, category: 'assessor_gis', title: 'Assessor parcel facts', jurisdiction: 'Cocke County, TN', authority: 'Tennessee Comptroller', retrievalStatus: 'retrieved_yes', summary: 'Matched by APN, jurisdiction, acreage, situs, and coordinates.', facts: { owner: 'Travis Joines', acres: 5.82 }, sourceUrl: 'https://assessment.cot.tn.gov/TPAD/' });
    upsertPublicRecordOutcome({ dealCardId: deal.id, category: 'deed_title_easement', title: 'Latest deed and easement review', jurisdiction: 'Cocke County, TN', authority: 'Cocke County Register of Deeds', retrievalStatus: 'retrieved_no', summary: 'The public office page has no parcel-level free index or document image; the latest deed and easement contents were not retrieved.', facts: { book_page: '1627/536', multiple_owners: 'Not established', access_easements: 'Not established', restrictions: 'Not established' }, sourceUrl: 'https://county.example/register', screenshotUrl: '/api/example/deed-source.png', nextFollowUp: 'Request the latest deed by APN.' });
    upsertPublicRecordOutcome({ dealCardId: deal.id, category: 'lien_judgment_tax', title: 'Lien, judgment, and tax review', jurisdiction: 'Cocke County, TN', authority: 'Cocke County Register of Deeds / Trustee', retrievalStatus: 'retrieved_no', summary: 'The lien and delinquent-tax index was not accessible; a retained parcel source reports $2.05 without status or tax year.', facts: { reported_tax_amount: '$2.05', tax_year: 'Not retrieved', creditor: 'Not retrieved', status: 'Not retrieved' }, sourceUrl: 'https://county.example/register' });
    upsertPublicRecordOutcome({ dealCardId: deal.id, category: 'planning_zoning_subdivision', title: 'County zoning and subdivision rules', jurisdiction: 'Cocke County, TN', authority: 'Cocke County Planning and Zoning', retrievalStatus: 'retrieved_yes', summary: 'County rules were retrieved; the subject parcel zoning district remains unconfirmed.', facts: { practical_lot_yield: 'Up to five one-acre lots is mathematical only; terrain, access, frontage, septic, and plat review can reduce yield.', manufactured_home_conclusion: 'A-1 permits individual mobile homes, but the parcel district and permits must be confirmed.' } });
    const records = listPublicRecordOutcomes(deal.id);
    expect(records).toHaveLength(4);
    expect(records.find((row) => row.category === 'deed_title_easement')).toMatchObject({ retrieval_status: 'retrieved_no', source_url: 'https://county.example/register', screenshot_url: '/api/example/deed-source.png', facts: { book_page: '1627/536', multiple_owners: 'Not established', access_easements: 'Not established', restrictions: 'Not established' } });
    expect(records.find((row) => row.category === 'lien_judgment_tax')).toMatchObject({ retrieval_status: 'retrieved_no', facts: { reported_tax_amount: '$2.05', tax_year: 'Not retrieved', creditor: 'Not retrieved', status: 'Not retrieved' } });
    expect(JSON.stringify(records)).not.toMatch(/no liens|clear title|no easements/i);
  });

  it('keeps owner-facing intake and record panels free of internal processing language', () => {
    const source = readFileSync(new URL('../../web/src/components/LeadCardIntake.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/routing JSON|raw model output|provider attempts|orchestration|evidence classifications|backend contracts|debug wording/i);
    expect(source).toMatch(/Smart Intake — update this Deal Card/);
    expect(source).toMatch(/id="deal-card-smart-intake"/);
    expect(source).toMatch(/onPaste=\{handlePaste\}/);
    expect(source).toMatch(/clipboard\.items/);
    expect(source).toMatch(/smart-intake-file-preview/);
    expect(source).toMatch(/Pasted property image preview/);
    expect(source).toMatch(/Paste screenshots with Ctrl\+V/);
    expect(source).toMatch(/latest-saved-intake/);
    expect(source).toMatch(/original image/);
    expect(source).toMatch(/Documents-tab access/);
  });
});
