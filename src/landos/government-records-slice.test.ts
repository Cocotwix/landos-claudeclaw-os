import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addPerson, createDealCard, linkPerson, linkPropertyToDeal } from './deal-card.js';
import { _initTestLandosDb, decideApproval, getLandosDb } from './db.js';
import {
  applyApprovedPropertyIdentityCorrection,
  generateGovernmentRecordSnapshot,
  getGovernmentRecordReadModel,
  persistGovernmentRecordCollector,
  recoverInterruptedGovernmentRecordCollectors,
  requestPropertyIdentityCorrection,
  runBrowserResourceJanitor,
  runTrackedGovernmentRecordCollector,
  synchronizeGovernmentRecordSlice,
  type GovernmentRecordArtifactInput,
  type GovernmentRecordClaimInput,
  type GovernmentRecordCollectorInput,
  type TrackedBrowserResource,
} from './government-records-operator.js';
import type { GovernmentRecordDomain } from './government-records-types.js';
import { createPropertyIdentityVersion, type PropertyIdentityVersion } from './property-summary-slice.js';
import { upsertPropertyCard } from './property-card.js';

let tempRoots: string[] = [];

beforeEach(() => {
  _initTestLandosDb();
});

afterEach(() => {
  for (const root of tempRoots) {
    const resolved = path.resolve(root);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && fs.existsSync(resolved)) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
  tempRoots = [];
});

function confirmedDeal(owner = 'Alex Owner') {
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: '100 Record Ln', leadType: 'test' });
  const property = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: '100 Record Ln',
    city: 'Cleveland',
    county: 'White',
    state: 'GA',
    apn: '001-002-003',
    owner,
    acres: 10,
    verified: true,
    verificationSource: 'White County',
    agentId: 'government-record-test',
  }).card;
  linkPropertyToDeal({ dealCardId: deal.id, cardId: property.id, role: 'subject' });
  const identity = createPropertyIdentityVersion({
    dealCardId: deal.id,
    propertyCardId: property.id,
    status: 'confirmed',
    address: '100 Record Ln',
    city: 'Cleveland',
    county: 'White',
    state: 'GA',
    zip: '30528',
    apn: '001-002-003',
    owner,
    acreage: 10,
    geometry: { type: 'Polygon', coordinates: [[[-83, 34], [-82.9, 34], [-83, 34]]] },
    basis: 'Official parcel identity and geometry.',
    confidence: 0.99,
    sourceRefs: ['white:001-002-003'],
    changeReason: 'Test parcel accepted.',
    createdBy: 'government-record-test',
  });
  return { deal, property, identity };
}

function addLeadContact(dealId: number, cardId: number, name: string, role: 'lead_contact' | 'wholesaler' = 'lead_contact') {
  const personId = addPerson({ entity: 'TY_LAND_BIZ', name });
  linkPerson({ personId, dealCardId: dealId, cardId, role });
}

function claim(
  domain: GovernmentRecordDomain,
  claimKey: string,
  exactWording: string,
  normalizedValue: unknown,
  over: Partial<GovernmentRecordClaimInput> = {},
): GovernmentRecordClaimInput {
  return {
    claimKey,
    exactWording,
    normalizedValue,
    domain,
    association: 'subject_property_direct',
    locatorStatus: 'record_located',
    sourceName: 'White County Clerk / Recorder',
    sourceUrl: 'https://records.whitecounty.example/instrument/1',
    sourceJurisdiction: 'White County, GA',
    sourceTier: 'official_county_state',
    confidence: 'high',
    retrievedAt: '2026-07-23T12:00:00.000Z',
    ...over,
  };
}

function pageArtifact(domain: GovernmentRecordDomain, key = `${domain}-artifact`): GovernmentRecordArtifactInput {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-government-record-'));
  tempRoots.push(root);
  const page = path.join(root, `${key}.png`);
  fs.writeFileSync(page, Buffer.from(`official page capture for ${key}`));
  return {
    artifactKey: key,
    domain,
    sourceJurisdiction: 'White County, GA',
    sourceName: 'White County Clerk / Recorder',
    sourceUrl: 'https://records.whitecounty.example/instrument/1',
    portalReference: `portal:${key}`,
    instrumentNumber: `INST-${key}`,
    parcelReference: '001-002-003',
    recordingFilingDate: '2020-01-02',
    documentType: domain === 'surveys_plats' ? 'Recorded plat' : 'Warranty deed',
    mimeType: 'image/png',
    displayName: `${key}.png`,
    retrievedAt: '2026-07-23T12:00:00.000Z',
    pageCount: 1,
    pageSourcePaths: [page],
  };
}

function collector(
  identity: PropertyIdentityVersion,
  domain: GovernmentRecordDomain,
  claims: GovernmentRecordClaimInput[] = [],
  artifacts: GovernmentRecordArtifactInput[] = [],
  over: Partial<GovernmentRecordCollectorInput> = {},
): GovernmentRecordCollectorInput {
  return {
    identity,
    domain,
    sourceJurisdiction: 'White County, GA',
    platform: 'fixture-recorder',
    adapterKey: 'fixture-adapter-v1',
    status: 'succeeded',
    claims,
    artifacts,
    requestKey: JSON.stringify({ domain, claims, artifacts: artifacts.map((artifact) => artifact.artifactKey) }),
    ...over,
  };
}

function allCollectors(
  identity: PropertyIdentityVersion,
  overrides: Partial<Record<GovernmentRecordDomain, { claims: GovernmentRecordClaimInput[]; artifacts?: GovernmentRecordArtifactInput[] }>>,
): GovernmentRecordCollectorInput[] {
  const domains: GovernmentRecordDomain[] = ['deed_ownership', 'surveys_plats', 'recorded_encumbrances', 'property_tax', 'lien_judgment'];
  return domains.map((domain) => {
    const custom = overrides[domain];
    return collector(identity, domain, custom?.claims ?? [
      claim(domain, `${domain}_official_search`, 'No matching record found in the official sources searched.', null, {
        association: 'not_applicable',
        locatorStatus: 'no_matching_record_found',
      }),
    ], custom?.artifacts ?? []);
  });
}

function build(identity: PropertyIdentityVersion, overrides: Parameters<typeof allCollectors>[1]) {
  return synchronizeGovernmentRecordSlice({
    identity,
    collectors: allCollectors(identity, overrides),
    changeReason: 'Government record fixture rebuilt.',
    generatedBy: 'government-record-test',
  });
}

describe('government-record vertical slice business proof', () => {
  it('1. retains a matching official deed and exact vesting evidence', () => {
    const { identity } = confirmedDeal('Alex Owner');
    const deed = pageArtifact('deed_ownership', 'deed-100');
    const result = build(identity, {
      deed_ownership: {
        claims: [claim('deed_ownership', 'exact_vesting_language', 'to Alex Owner, a single person', { parties: ['Alex Owner'] }, { artifactKey: deed.artifactKey, artifactPage: 1 })],
        artifacts: [deed],
      },
    });
    expect(result.snapshot?.analysis.recordedOwnershipState).toMatchObject({
      namedOwnershipParties: ['Alex Owner'],
      exactVestingLanguage: ['to Alex Owner, a single person'],
      contactMismatchEffect: 'research_continues',
    });
    expect(result.artifacts[0]).toMatchObject({ pageCount: 1, captureCount: 1, instrumentNumber: 'INST-deed-100' });
    expect(result.artifacts[0].artifactHash).toHaveLength(64);
  });

  it('2. continues all research when the lead contact differs from owner of record', () => {
    const { deal, property, identity } = confirmedDeal('Alex Owner');
    addLeadContact(deal.id, property.id, 'Casey Contact');
    const result = build(identity, {
      deed_ownership: { claims: [claim('deed_ownership', 'vesting', 'Alex Owner', { parties: ['Alex Owner'] })] },
    });
    expect(result.jobs).toHaveLength(5);
    expect(result.jobs.every((job) => job.status === 'succeeded')).toBe(true);
    expect(result.snapshot?.analysis.recordedOwnershipState).toMatchObject({
      contactOwnerMismatch: true,
      contactMismatchEffect: 'research_continues',
    });
  });

  it('3. treats a wholesaler contact mismatch as non-gating', () => {
    const { deal, property, identity } = confirmedDeal('Alex Owner');
    addLeadContact(deal.id, property.id, 'Wholesale Buyer LLC', 'wholesaler');
    const result = build(identity, {
      deed_ownership: { claims: [claim('deed_ownership', 'owner_parties', 'Alex Owner', { parties: ['Alex Owner'] })] },
    });
    expect(result.snapshot?.analysis.recordedOwnershipState.contactOwnerMismatch).toBe(true);
    expect(result.snapshot?.completeness.percent).toBe(100);
  });

  it('4. preserves a large multi-party heir ownership set without inferred percentages', () => {
    const { identity } = confirmedDeal();
    const owners = Array.from({ length: 14 }, (_value, index) => `Heir ${index + 1}`);
    const result = build(identity, {
      deed_ownership: {
        claims: [claim('deed_ownership', 'vesting_named_parties', owners.join('; '), { parties: owners })],
      },
    });
    expect(result.snapshot?.analysis.recordedOwnershipState.namedOwnershipParties).toEqual(owners);
    expect(result.snapshot?.analysis.recordedOwnershipState.multipleOwners).toBe(true);
    expect(JSON.stringify(result.snapshot)).not.toMatch(/percentage|ownershipPercent/i);
  });

  it('5. supports deceased-owner and estate evidence without blocking research', () => {
    const { identity } = confirmedDeal();
    const result = build(identity, {
      deed_ownership: {
        claims: [claim('deed_ownership', 'estate_vesting', 'Estate of Morgan Owner, deceased', { parties: ['Estate of Morgan Owner'] })],
      },
    });
    expect(result.snapshot?.analysis.recordedOwnershipState.estateTrustOrEntity).toBe(true);
    expect(result.jobs.every((job) => job.status === 'succeeded')).toBe(true);
  });

  it('6. preserves an official index reference when the document image is unavailable', () => {
    const { identity } = confirmedDeal();
    const result = build(identity, {
      deed_ownership: {
        claims: [claim('deed_ownership', 'deed_index_reference', 'Instrument 2020-123 appears in the official index; image unavailable.', null, {
          locatorStatus: 'record_referenced_document_unavailable',
          instrumentNumber: '2020-123',
          documentType: 'Warranty deed',
        })],
      },
    });
    expect(result.snapshot?.analysis.missingInstruments).toContain('2020-123');
    expect(result.artifacts).toHaveLength(0);
  });

  it('7. preserves conflicting assessor and deed ownership evidence', () => {
    const { identity } = confirmedDeal();
    const result = build(identity, {
      deed_ownership: {
        claims: [
          claim('deed_ownership', 'assessor_owner', 'Assessor lists Alex Owner', 'Alex Owner', { disputeGroup: 'current-owner' }),
          claim('deed_ownership', 'deed_grantee', 'Deed vests in Morgan Owner', 'Morgan Owner', { disputeGroup: 'current-owner' }),
        ],
      },
    });
    expect(result.snapshot?.analysis.ownershipEvidenceConsistency).toBe('conflicting');
    expect(result.snapshot?.analysis.materialConflicts).toContain('Conflicting evidence group: current-owner');
  });

  it('7b. treats multiple findings from one recorded instrument as one ownership source', () => {
    const { identity } = confirmedDeal();
    const result = build(identity, {
      deed_ownership: {
        claims: [
          claim('deed_ownership', 'deed_grantor_grantee', 'Alex Grantor to Morgan Owner, Trustee', { parties: ['Morgan Owner, Trustee'] }, { instrumentNumber: 'D-100' }),
          claim('deed_ownership', 'vesting_deed', 'Warranty Deed D-100 recorded in Book 9, Page 2', { documentType: 'Warranty deed' }, { instrumentNumber: 'D-100' }),
        ],
      },
    });
    expect(result.snapshot?.analysis.ownershipEvidenceConsistency).toBe('single_source');
    expect(result.snapshot?.analysis.materialConflicts).not.toContain('Recorded ownership evidence contains differing owner or vesting statements.');
  });

  it('7c. analyzes only the latest collector evidence while retaining prior append-only rows', () => {
    const { identity } = confirmedDeal();
    build(identity, {
      deed_ownership: {
        claims: [
          claim('deed_ownership', 'assessor_owner', 'Assessor lists Alex Owner', 'Alex Owner', { disputeGroup: 'current-owner' }),
          claim('deed_ownership', 'deed_grantee', 'Deed vests in Morgan Owner', 'Morgan Owner', { disputeGroup: 'current-owner' }),
        ],
      },
    });
    const current = build(identity, {
      deed_ownership: {
        claims: [claim('deed_ownership', 'deed_grantee', 'Deed vests in Morgan Owner', { parties: ['Morgan Owner'] }, { instrumentNumber: 'D-101' })],
      },
    });
    expect(current.snapshot?.analysis.ownershipEvidenceConsistency).toBe('single_source');
    expect(current.snapshot?.analysis.recordedOwnershipState.namedOwnershipParties).toEqual(['Morgan Owner']);
    const retainedRows = getLandosDb().prepare(`
      SELECT COUNT(*) AS count
      FROM landos_property_evidence_item
      WHERE deal_card_id=? AND domain='deed_ownership' AND evidence_kind='normalized_claim'
    `).get(identity.dealCardId) as { count: number };
    expect(retainedRows.count).toBe(3);
  });

  it('8. retains a recorded survey/plat and exposes its visual artifact', () => {
    const { identity } = confirmedDeal();
    const plat = pageArtifact('surveys_plats', 'plat-22');
    const result = build(identity, {
      surveys_plats: {
        claims: [claim('surveys_plats', 'recorded_plat', 'Plat Book 22, Page 9 shows Lot 4 and a 30-foot right of way.', { lot: 4 }, { artifactKey: plat.artifactKey, artifactPage: 1 })],
        artifacts: [plat],
      },
    });
    expect(result.snapshot?.analysis.surveyPlatAvailability.status).toBe('retrieved');
    expect(result.artifacts.find((artifact) => artifact.domain === 'surveys_plats')?.captureCount).toBe(1);
  });

  it('9. reports a deed-cited survey as referenced but not retrievable', () => {
    const { identity } = confirmedDeal();
    const result = build(identity, {
      surveys_plats: {
        claims: [claim('surveys_plats', 'deed_cited_survey', 'Deed cites survey by R. Smith dated 1998; no free image located.', null, {
          association: 'referenced_in_instrument',
          locatorStatus: 'record_referenced_document_unavailable',
          documentType: 'Boundary survey',
        })],
      },
    });
    expect(result.snapshot?.analysis.surveyPlatAvailability.status).toBe('referenced_not_retrieved');
    expect(result.snapshot?.analysis.limitations.join(' ')).toMatch(/not proof/i);
  });

  it('10. links a separately retrieved easement instrument to the subject property', () => {
    const { identity } = confirmedDeal();
    const easement = pageArtifact('recorded_encumbrances', 'easement-7');
    const result = build(identity, {
      recorded_encumbrances: {
        claims: [claim('recorded_encumbrances', 'access_easement', 'Instrument E-7 grants a 20-foot access easement.', { widthFeet: 20 }, {
          artifactKey: easement.artifactKey,
          instrumentNumber: 'E-7',
        })],
        artifacts: [easement],
      },
    });
    expect(result.snapshot?.analysis.recordedEasementRestrictionFindings.join(' ')).toMatch(/20-foot access easement/i);
    expect(result.snapshot?.analysis.evidenceReferences.some((ref) => ref.artifactId != null)).toBe(true);
  });

  it('11. surfaces delinquent years, balances, penalties, sale, and redemption indicators', () => {
    const { identity } = confirmedDeal();
    const result = build(identity, {
      property_tax: {
        claims: [
          claim('property_tax', 'delinquent_years', 'Taxes delinquent for 2023 and 2024.', [2023, 2024]),
          claim('property_tax', 'delinquent_balance_penalties', 'Balance $4,100 including penalties; tax sale pending, redemption open.', { balance: 4100, sale: 'pending', redemption: 'open' }),
        ],
      },
    });
    expect(result.snapshot?.analysis.taxDelinquencyIndicators.join(' ')).toMatch(/2023.*2024.*4,?100|4,?100.*2023/s);
  });

  it('12. distinguishes a direct property lien', () => {
    const { identity } = confirmedDeal();
    const result = build(identity, {
      lien_judgment: {
        claims: [claim('lien_judgment', 'municipal_lien', 'Municipal lien ML-9 is indexed to APN 001-002-003.', { amount: 2200 }, {
          association: 'subject_property_direct',
          instrumentNumber: 'ML-9',
        })],
      },
    });
    expect(result.snapshot?.analysis.lienJudgmentScreeningIndicators[0]).toMatch(/^Direct subject-property record:/);
  });

  it('13. labels an owner-name judgment as a possible match requiring confirmation', () => {
    const { identity } = confirmedDeal();
    const result = build(identity, {
      lien_judgment: {
        claims: [claim('lien_judgment', 'owner_name_judgment', 'Judgment search returned Alex Owner; parcel association not established.', { name: 'Alex Owner' }, {
          association: 'owner_name_possible_match',
          locatorStatus: 'possible_owner_name_match',
        })],
      },
    });
    expect(result.snapshot?.analysis.lienJudgmentScreeningIndicators[0]).toMatch(/Possible owner-name match requiring human confirmation/);
    expect(result.snapshot?.analysis.lienJudgmentScreeningIndicators[0]).not.toMatch(/^Direct/);
  });

  it('15. makes no payment, records the paywall, and retains alternate official sources checked', () => {
    const { identity } = confirmedDeal();
    const job = persistGovernmentRecordCollector(collector(identity, 'deed_ownership', [
      claim('deed_ownership', 'official_index', 'Instrument 2020-77 indexed; image requires payment.', null, {
        locatorStatus: 'official_source_paywalled',
        instrumentNumber: '2020-77',
      }),
    ], [], {
      status: 'blocked',
      outcomeKind: 'blocked',
      error: 'Official image requires payment; no payment was made.',
      alternateOfficialSourcesChecked: ['County clerk index', 'State archives catalog'],
    }));
    const snapshot = generateGovernmentRecordSnapshot({ identity, jobs: [job], changeReason: 'Paywall proof', generatedBy: 'test' });
    expect(snapshot.analysis.limitations.join(' ')).toMatch(/required payment; no payment was made/i);
    const raw = getLandosDb().prepare(`SELECT normalized_value_json FROM landos_property_evidence_item WHERE fact_key='alternate_official_sources_checked' AND evidence_kind='normalized_claim'`).get() as { normalized_value_json: string };
    expect(raw.normalized_value_json).toContain('State archives catalog');
  });

  it('16. preserves unavailable, authenticated, blocked, and changed portal states without false negatives', () => {
    const { identity } = confirmedDeal();
    const statuses = ['official_source_unavailable', 'official_source_authenticated', 'official_source_blocked'] as const;
    const claims = statuses.map((status) => claim('lien_judgment', status, `Official source state: ${status}`, null, { locatorStatus: status }));
    const result = build(identity, { lien_judgment: { claims } });
    expect(result.snapshot?.analysis.limitations.join(' ')).toMatch(/unavailable|authenticated|blocked/i);
    expect(JSON.stringify(result.snapshot)).not.toMatch(/no liens exist|clear title/i);
  });

  it('17. recovers interrupted attempts after restart and preserves resumability', () => {
    const { identity } = confirmedDeal();
    const job = getLandosDb().prepare(`
      INSERT INTO landos_property_collector_job (
        deal_card_id, property_identity_version_id, collector_key, status, input_hash,
        idempotency_key, dependency_json, attempt_count, source_jurisdiction, platform,
        adapter_key, queued_at, started_at, updated_at
      ) VALUES (?, ?, 'deed_ownership', 'running', 'h', 'interrupted-fixture', '[]', 1,
                'White County, GA', 'fixture', 'fixture', 1, 1, 1)
    `).run(identity.dealCardId, identity.id);
    getLandosDb().prepare(`
      INSERT INTO landos_property_collector_attempt (job_id, attempt_number, status, started_at)
      VALUES (?, 1, 'running', 1)
    `).run(job.lastInsertRowid);
    expect(recoverInterruptedGovernmentRecordCollectors()).toEqual({ attemptsRecovered: 1, jobsRequeued: 1 });
    expect(getLandosDb().prepare('SELECT status FROM landos_property_collector_job WHERE id=?').get(job.lastInsertRowid)).toEqual({ status: 'queued' });
  });

  it('18. identical input rebuild is idempotent across jobs, attempts, evidence, artifacts, and snapshots', () => {
    const { identity } = confirmedDeal();
    const deed = pageArtifact('deed_ownership', 'idempotent-deed');
    const collectors = allCollectors(identity, {
      deed_ownership: {
        claims: [claim('deed_ownership', 'vesting', 'Alex Owner', { parties: ['Alex Owner'] }, { artifactKey: deed.artifactKey })],
        artifacts: [deed],
      },
    });
    const first = synchronizeGovernmentRecordSlice({ identity, collectors, changeReason: 'same', generatedBy: 'test' });
    const counts = getLandosDb().prepare(`
      SELECT
        (SELECT COUNT(*) FROM landos_property_collector_job) jobs,
        (SELECT COUNT(*) FROM landos_property_collector_attempt) attempts,
        (SELECT COUNT(*) FROM landos_property_evidence_item) evidence,
        (SELECT COUNT(*) FROM landos_property_record_artifact) artifacts,
        (SELECT COUNT(*) FROM landos_deal_intelligence_snapshot WHERE snapshot_type='government_record_risk_v1') snapshots
    `).get();
    const second = synchronizeGovernmentRecordSlice({ identity, collectors, changeReason: 'same', generatedBy: 'test' });
    expect(second.snapshot?.id).toBe(first.snapshot?.id);
    expect(getLandosDb().prepare(`
      SELECT
        (SELECT COUNT(*) FROM landos_property_collector_job) jobs,
        (SELECT COUNT(*) FROM landos_property_collector_attempt) attempts,
        (SELECT COUNT(*) FROM landos_property_evidence_item) evidence,
        (SELECT COUNT(*) FROM landos_property_record_artifact) artifacts,
        (SELECT COUNT(*) FROM landos_deal_intelligence_snapshot WHERE snapshot_type='government_record_risk_v1') snapshots
    `).get()).toEqual(counts);
  });

  it('19. applies only an approved identity correction and invalidates only declared outputs', () => {
    const { deal, identity } = confirmedDeal();
    const result = build(identity, {});
    expect(result.snapshot).not.toBeNull();
    getLandosDb().prepare(`
      INSERT INTO landos_deal_intelligence_snapshot (
        deal_card_id, version, property_identity_version_id, snapshot_type, status,
        input_hash, completeness_json, summary_json, change_reason, generated_by
      ) VALUES (?, 99, ?, 'unrelated_snapshot_v1', 'current', 'unrelated-hash', '{}', '{}', 'fixture', 'fixture')
    `).run(deal.id, identity.id);
    const requested = requestPropertyIdentityCorrection({
      dealCardId: deal.id,
      replacement: { apn: '001-002-004', basis: 'Corrective official instrument.' },
      evidenceRefs: ['instrument:CORR-1'],
      reason: 'Official corrective instrument changed the parcel suffix.',
      requestedBy: 'operator-test',
      declaredInvalidations: ['government_records'],
    });
    expect(() => applyApprovedPropertyIdentityCorrection({ correctionId: requested.correctionId, actor: 'operator-test' })).toThrow(/approved/i);
    decideApproval(requested.approvalId, 'approved', 'tyler-test', 'Accepted fixture correction.');
    const corrected = applyApprovedPropertyIdentityCorrection({ correctionId: requested.correctionId, actor: 'operator-test' });
    expect(corrected).toMatchObject({ version: 2, apn: '001-002-004' });
    const statuses = getLandosDb().prepare(`SELECT snapshot_type,status FROM landos_deal_intelligence_snapshot WHERE deal_card_id=?`).all(deal.id) as Array<{ snapshot_type: string; status: string }>;
    expect(statuses.find((row) => row.snapshot_type === 'government_record_risk_v1')?.status).toBe('superseded');
    expect(statuses.find((row) => row.snapshot_type === 'unrelated_snapshot_v1')?.status).toBe('current');
  });
});

describe('browser lifecycle cleanup proof', () => {
  function tracked(key: string, onClose: () => void, fail = false): TrackedBrowserResource {
    return {
      key,
      type: key.includes('context') ? 'context' : 'page',
      async close() {
        onClose();
        if (fail) throw new Error('close failed');
      },
    };
  }

  it('20. successful retrieval closes every LandOS-owned page and context', async () => {
    const { identity } = confirmedDeal();
    const closed: string[] = [];
    const job = await runTrackedGovernmentRecordCollector({
      identity,
      domain: 'deed_ownership',
      sourceJurisdiction: 'White County, GA',
      requestKey: 'success-cleanup',
      timeoutMs: 500,
      adapter: {
        key: 'fixture-browser',
        platform: 'fixture',
        async collect({ track }) {
          track(tracked('context-1', () => closed.push('context')));
          track(tracked('page-1', () => closed.push('page')));
          return { status: 'succeeded', claims: [], artifacts: [] };
        },
      },
    });
    expect(closed).toEqual(['page', 'context']);
    expect(job).toMatchObject({ cleanupStatus: 'succeeded', ownedResourceCount: 2, openResourceCountAfter: 0 });
  });

  it('21. failed retrieval still closes every owned resource', async () => {
    const { identity } = confirmedDeal();
    let closes = 0;
    const job = await runTrackedGovernmentRecordCollector({
      identity,
      domain: 'surveys_plats',
      sourceJurisdiction: 'White County, GA',
      requestKey: 'failure-cleanup',
      timeoutMs: 500,
      adapter: {
        key: 'fixture-browser',
        platform: 'fixture',
        async collect({ track }) {
          track(tracked('context-failure', () => closes++));
          track(tracked('page-failure', () => closes++));
          throw new Error('retrieval failed');
        },
      },
    });
    expect(closes).toBe(2);
    expect(job).toMatchObject({ status: 'failed', cleanupStatus: 'succeeded', openResourceCountAfter: 0 });
  });

  it('22. timed-out retrieval aborts and closes every owned resource', async () => {
    const { identity } = confirmedDeal();
    let closes = 0;
    const job = await runTrackedGovernmentRecordCollector({
      identity,
      domain: 'recorded_encumbrances',
      sourceJurisdiction: 'White County, GA',
      requestKey: 'timeout-cleanup',
      timeoutMs: 50,
      adapter: {
        key: 'fixture-browser',
        platform: 'fixture',
        async collect({ track, signal }) {
          track(tracked('context-timeout', () => closes++));
          track(tracked('page-timeout', () => closes++));
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
          return { status: 'failed', outcomeKind: 'timed_out', claims: [], artifacts: [] };
        },
      },
    });
    expect(closes).toBe(2);
    const attempt = getLandosDb().prepare(`SELECT outcome_kind,cleanup_status,open_resource_count_after FROM landos_property_collector_attempt WHERE job_id=?`).get(job.id);
    expect(attempt).toEqual({ outcome_kind: 'timed_out', cleanup_status: 'succeeded', open_resource_count_after: 0 });
  });

  it('23. repeated retrievals do not grow open page count and record bounded memory evidence', async () => {
    const { identity } = confirmedDeal();
    for (let index = 0; index < 8; index++) {
      await runTrackedGovernmentRecordCollector({
        identity,
        domain: 'property_tax',
        sourceJurisdiction: 'White County, GA',
        requestKey: `repeat-${index}`,
        timeoutMs: 500,
        adapter: {
          key: 'fixture-browser',
          platform: 'fixture',
          async collect({ track }) {
            track(tracked(`context-${index}`, () => undefined));
            track(tracked(`page-${index}`, () => undefined));
            return { status: 'succeeded', claims: [], artifacts: [] };
          },
        },
      });
    }
    const open = getLandosDb().prepare(`SELECT COUNT(*) AS count FROM landos_browser_owned_resource WHERE status IN ('open','cleanup_failed')`).get() as { count: number };
    const attempts = getLandosDb().prepare(`SELECT memory_before_bytes,memory_after_bytes,open_resource_count_after FROM landos_property_collector_attempt`).all() as Array<Record<string, unknown>>;
    expect(open.count).toBe(0);
    expect(attempts.every((attempt) => Number(attempt.open_resource_count_after) === 0)).toBe(true);
    expect(attempts.every((attempt) => Number(attempt.memory_before_bytes) > 0 && Number(attempt.memory_after_bytes) > 0)).toBe(true);
  });

  it('janitor closes only tracked LandOS resources and never an unregistered manual tab', async () => {
    const { identity } = confirmedDeal();
    let jobId = 0;
    await runTrackedGovernmentRecordCollector({
      identity,
      domain: 'lien_judgment',
      sourceJurisdiction: 'White County, GA',
      requestKey: 'janitor-seed',
      timeoutMs: 500,
      adapter: {
        key: 'fixture-browser',
        platform: 'fixture',
        async collect({ track }) {
          track(tracked('owned-page', () => undefined, true));
          return { status: 'failed', claims: [], artifacts: [] };
        },
      },
    }).then((job) => { jobId = job.id; });
    let ownedClosed = 0;
    let manualClosed = 0;
    const result = await runBrowserResourceJanitor({
      abandonedBefore: Math.floor(Date.now() / 1000) + 1,
      activeResources: new Map([
        ['owned-page', tracked('owned-page', () => ownedClosed++)],
        ['manual-tab', tracked('manual-tab', () => manualClosed++)],
      ]),
    });
    expect(jobId).toBeGreaterThan(0);
    expect(result.closed).toBe(1);
    expect(ownedClosed).toBe(1);
    expect(manualClosed).toBe(0);
  });
});

describe('read model boundaries', () => {
  it('returns persisted artifacts and snapshots without changing row counts', () => {
    const { identity } = confirmedDeal();
    build(identity, {});
    const before = getLandosDb().prepare(`
      SELECT
        (SELECT COUNT(*) FROM landos_property_evidence_item) evidence,
        (SELECT COUNT(*) FROM landos_property_collector_job) jobs,
        (SELECT COUNT(*) FROM landos_deal_intelligence_snapshot) snapshots
    `).get();
    expect(getGovernmentRecordReadModel(identity.dealCardId)?.snapshot).not.toBeNull();
    expect(getGovernmentRecordReadModel(identity.dealCardId)?.jobs).toHaveLength(5);
    expect(getLandosDb().prepare(`
      SELECT
        (SELECT COUNT(*) FROM landos_property_evidence_item) evidence,
        (SELECT COUNT(*) FROM landos_property_collector_job) jobs,
        (SELECT COUNT(*) FROM landos_deal_intelligence_snapshot) snapshots
    `).get()).toEqual(before);
  });
});
