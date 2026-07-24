import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { _initTestLandosDb, getLandosDb, recomputeZoningArtifactPdfPageCounts } from './db.js';
import { generateGovernmentRecordSnapshot } from './government-records-operator.js';
import { createPropertyIdentityVersion, type PropertyIdentityVersion } from './property-summary-slice.js';
import { upsertPropertyCard } from './property-card.js';
import {
  applyZoningCorrection,
  generateZoningSnapshot,
  getZoningReadModel,
  persistZoningCollector,
  recoverInterruptedZoningCollectors,
  requestZoningCorrection,
  runTrackedZoningCollector,
  synchronizeZoningSlice,
  type TrackedZoningBrowserResource,
  type ZoningClaimInput,
  type ZoningCollectorAdapter,
  type ZoningCollectorInput,
} from './zoning-operator.js';
import type { ZoningDomain } from './zoning-types.js';

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

function confirmedDeal(status: 'confirmed' | 'candidate' = 'confirmed') {
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: '200 Zoning Way', leadType: 'test' });
  const property = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: '200 Zoning Way',
    city: 'Homosassa',
    county: 'Citrus',
    state: 'FL',
    apn: '17E20S36-TEST',
    owner: 'Pat Owner',
    acres: 5,
    verified: true,
    verificationSource: 'Citrus County',
    agentId: 'zoning-test',
  }).card;
  linkPropertyToDeal({ dealCardId: deal.id, cardId: property.id, role: 'subject' });
  const identity = createPropertyIdentityVersion({
    dealCardId: deal.id,
    propertyCardId: property.id,
    status,
    address: '200 Zoning Way',
    city: 'Homosassa',
    county: 'Citrus',
    state: 'FL',
    zip: '34448',
    apn: '17E20S36-TEST',
    owner: 'Pat Owner',
    acreage: 5,
    geometry: { rings: [[[-82.56, 28.69], [-82.55, 28.69], [-82.55, 28.70], [-82.56, 28.69]]] },
    basis: 'Official parcel identity and geometry.',
    confidence: 0.99,
    sourceRefs: ['citrus:17E20S36-TEST'],
    changeReason: 'Test parcel accepted.',
    createdBy: 'zoning-test',
  });
  return { deal, property, identity };
}

function claim(
  domain: ZoningDomain,
  claimKey: string,
  over: Partial<ZoningClaimInput> = {},
): ZoningClaimInput {
  return {
    claimKey,
    exactWording: `${claimKey} official wording`,
    normalizedValue: { key: claimKey },
    domain,
    locatorStatus: 'record_located',
    sourceKind: 'official_gis',
    authorityLevel: 'county',
    authorityName: 'Citrus County',
    sourceName: 'Citrus County official GIS',
    sourceUrl: 'https://gis.citrus.example/zoning',
    sourceJurisdiction: 'Citrus County, FL',
    sourceTier: 'official_county_state',
    confidence: 'high',
    retrievedAt: '2026-07-24T12:00:00.000Z',
    ...over,
  };
}

function jurisdictionDeterminationClaim(): ZoningClaimInput {
  return claim('jurisdiction_authority', 'jurisdiction_determination', {
    sourceKind: 'official_boundary',
    normalizedValue: {
      determination: 'confirmed',
      incorporationStatus: 'unincorporated_county',
      controllingAuthorityName: 'Citrus County',
      controllingAuthorityLevel: 'county',
      officialBoundaryEvidence: true,
      mailingCityDiffersFromAuthority: false,
      candidateAuthoritiesConsidered: [],
      missingInformation: [],
    },
  });
}

function collector(
  identity: PropertyIdentityVersion,
  domain: ZoningDomain,
  claims: ZoningClaimInput[],
  over: Partial<ZoningCollectorInput> = {},
): ZoningCollectorInput {
  return {
    identity,
    domain,
    sourceJurisdiction: 'Citrus County, FL',
    platform: 'arcgis_zoning',
    adapterKey: 'zoning-test-adapter',
    status: 'succeeded',
    claims,
    artifacts: [],
    requestKey: `test:${domain}`,
    ...over,
  };
}

function pageArtifact(domain: ZoningDomain, key = `${domain}-artifact`) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-zoning-'));
  tempRoots.push(root);
  const page = path.join(root, `${key}.png`);
  fs.writeFileSync(page, Buffer.from(`official zoning capture for ${key}`));
  return {
    artifactKey: key,
    domain,
    sourceJurisdiction: 'Citrus County, FL',
    authorityName: 'Citrus County',
    sourceName: 'Citrus County official GIS',
    sourceUrl: 'https://gis.citrus.example/zoning-map',
    portalReference: key,
    ordinanceTitle: 'Citrus County Land Development Code',
    ordinanceEffectiveDate: '2025-01-01',
    sectionReference: 'Sec. 2100',
    districtReference: 'RUR',
    documentType: 'official zoning map result',
    mimeType: 'image/png',
    displayName: `Official capture ${key}`,
    retrievedAt: '2026-07-24T12:00:00.000Z',
    pageSourcePaths: [page],
  };
}

function counts() {
  return getLandosDb().prepare(`
    SELECT
      (SELECT COUNT(*) FROM landos_property_evidence_item) evidence,
      (SELECT COUNT(*) FROM landos_property_collector_job) jobs,
      (SELECT COUNT(*) FROM landos_property_collector_attempt) attempts,
      (SELECT COUNT(*) FROM landos_property_zoning_artifact) artifacts,
      (SELECT COUNT(*) FROM landos_deal_intelligence_snapshot) snapshots
  `).get() as Record<string, number>;
}

describe('zoning operator slice', () => {
  it('persists a collector as a durable job with append-only evidence and a hashed artifact', () => {
    const { identity } = confirmedDeal();
    const job = persistZoningCollector(collector(identity, 'zoning_district', [
      claim('zoning_district', 'official_zoning_district_rur', {
        districtCode: 'RUR',
        districtName: 'Rural Residential',
        artifactKey: 'zoning_district-artifact',
      }),
    ], { artifacts: [pageArtifact('zoning_district')] }));
    expect(job.status).toBe('succeeded');
    expect(job.attemptCount).toBe(1);
    const model = getZoningReadModel(identity.dealCardId)!;
    expect(model.artifacts).toHaveLength(1);
    expect(model.artifacts[0].artifactHash).toMatch(/^[0-9a-f]{64}$/);
    expect(model.artifacts[0].ordinanceTitle).toBe('Citrus County Land Development Code');
    expect(model.evidenceCount).toBe(2); // raw + normalized
    const update = () => getLandosDb().prepare(
      `UPDATE landos_property_evidence_item SET source_name='tampered'`,
    ).run();
    expect(update).toThrow(/append-only/);
  });

  it('blocks every collector for an unconfirmed identity (unconfirmed identity blocks zoning analysis)', () => {
    const { identity } = confirmedDeal('candidate');
    const model = synchronizeZoningSlice({
      identity,
      collectors: [collector(identity, 'zoning_district', [claim('zoning_district', 'should_not_persist')])],
      changeReason: 'test',
      generatedBy: 'zoning-test',
    });
    expect(model.jobs).toHaveLength(5);
    expect(model.jobs.every((job) => job.status === 'blocked')).toBe(true);
    expect(model.snapshot!.completeness.identity).toBe('needs_resolution');
    expect(model.snapshot!.completeness.percent).toBe(0);
    expect(Object.values(model.snapshot!.completeness.domains).every((state) => state === 'blocked')).toBe(true);
    // The supplied claim was discarded, not persisted.
    const persisted = getLandosDb().prepare(
      `SELECT COUNT(*) AS count FROM landos_property_evidence_item WHERE fact_key='should_not_persist'`,
    ).get() as { count: number };
    expect(persisted.count).toBe(0);
  });

  it('16. identical inputs rebuild idempotently: same snapshot, no duplicate evidence', () => {
    const { identity } = confirmedDeal();
    const build = () => synchronizeZoningSlice({
      identity,
      collectors: [
        collector(identity, 'jurisdiction_authority', [jurisdictionDeterminationClaim()]),
        collector(identity, 'zoning_district', [
          claim('zoning_district', 'official_zoning_district_rur', { districtCode: 'RUR' }),
        ]),
      ],
      changeReason: 'test rebuild',
      generatedBy: 'zoning-test',
    });
    const first = build();
    const after = counts();
    const second = build();
    expect(second.snapshot!.id).toBe(first.snapshot!.id);
    expect(second.snapshot!.version).toBe(first.snapshot!.version);
    expect(counts()).toEqual(after);
  });

  it('15. an interrupted collection resumes as a new attempt without duplicate evidence', () => {
    const { identity } = confirmedDeal();
    const db = getLandosDb();
    const input = collector(identity, 'zoning_district', [
      claim('zoning_district', 'official_zoning_district_rur', { districtCode: 'RUR' }),
    ]);
    const first = persistZoningCollector(input);
    // Simulate an interruption: force the job back to running mid-flight.
    db.prepare(`UPDATE landos_property_collector_job SET status='running' WHERE id=?`).run(first.id);
    db.prepare(`UPDATE landos_property_collector_attempt SET status='running' WHERE job_id=?`).run(first.id);
    const evidenceBefore = (counts()).evidence;
    const resumed = persistZoningCollector(input);
    expect(resumed.id).toBe(first.id);
    expect(resumed.attemptCount).toBe(2);
    expect(resumed.status).toBe('succeeded');
    expect((counts()).evidence).toBe(evidenceBefore);
    const attempts = db.prepare(
      `SELECT status FROM landos_property_collector_attempt WHERE job_id=? ORDER BY attempt_number`,
    ).all(first.id) as Array<{ status: string }>;
    expect(attempts.map((attempt) => attempt.status)).toEqual(['failed', 'succeeded']);
  });

  it('one failed source never blocks unrelated domains', () => {
    const { identity } = confirmedDeal();
    const model = synchronizeZoningSlice({
      identity,
      collectors: [
        collector(identity, 'jurisdiction_authority', [jurisdictionDeterminationClaim()]),
        collector(identity, 'zoning_district', [], {
          status: 'failed',
          error: 'Official GIS HTTP 500.',
          requestKey: 'test:failed-district',
        }),
      ],
      changeReason: 'test',
      generatedBy: 'zoning-test',
    });
    const byDomain = Object.fromEntries(model.jobs.map((job) => [job.collectorKey, job.status]));
    expect(byDomain.jurisdiction_authority).toBe('succeeded');
    expect(byDomain.zoning_district).toBe('failed');
    expect(model.snapshot!.completeness.domains.jurisdiction_authority).toBe('complete');
    expect(model.snapshot!.completeness.domains.zoning_district).toBe('unavailable');
  });

  it('marks conflicted and manual-review domains in the workflow states', () => {
    const { identity } = confirmedDeal();
    const model = synchronizeZoningSlice({
      identity,
      collectors: [
        collector(identity, 'zoning_district', [
          claim('zoning_district', 'district_a', { districtCode: 'RUR', disputeGroup: 'district_conflict' }),
          claim('zoning_district', 'district_b', { districtCode: 'R-1', disputeGroup: 'district_conflict' }),
        ]),
        collector(identity, 'permitted_uses', [
          claim('permitted_uses', 'ambiguous_use', { needsManualReview: true }),
        ]),
      ],
      changeReason: 'test',
      generatedBy: 'zoning-test',
    });
    expect(model.snapshot!.completeness.domains.zoning_district).toBe('conflicted');
    expect(model.snapshot!.completeness.domains.permitted_uses).toBe('manual_review_needed');
    expect(model.domainStates.zoning_district).toBe('conflicted');
  });

  it('changed inputs supersede the prior snapshot with a new version', () => {
    const { identity } = confirmedDeal();
    const first = synchronizeZoningSlice({
      identity,
      collectors: [collector(identity, 'zoning_district', [claim('zoning_district', 'district_v1', { districtCode: 'RUR' })])],
      changeReason: 'first',
      generatedBy: 'zoning-test',
    });
    const second = synchronizeZoningSlice({
      identity,
      collectors: [collector(identity, 'zoning_district', [
        claim('zoning_district', 'district_v1', { districtCode: 'RUR' }),
        claim('zoning_district', 'overlay_new', { overlayName: 'Flood Overlay' }),
      ], { requestKey: 'test:changed' })],
      changeReason: 'second',
      generatedBy: 'zoning-test',
    });
    expect(second.snapshot!.version).toBeGreaterThan(first.snapshot!.version);
    expect(second.snapshot!.priorSnapshotId).toBe(first.snapshot!.id);
    const statuses = getLandosDb().prepare(`
      SELECT status FROM landos_deal_intelligence_snapshot
      WHERE deal_card_id=? AND snapshot_type='zoning_land_use_v1' ORDER BY id
    `).all(identity.dealCardId) as Array<{ status: string }>;
    expect(statuses.map((row) => row.status)).toEqual(['superseded', 'current']);
  });

  it('17. a zoning correction creates a new snapshot version and invalidates only declared dependents', () => {
    const { identity } = confirmedDeal();
    // Unrelated government-record snapshot + evidence must remain untouched.
    const governmentSnapshot = generateGovernmentRecordSnapshot({
      identity,
      jobs: [],
      changeReason: 'baseline gov snapshot',
      generatedBy: 'zoning-test',
    });
    const before = synchronizeZoningSlice({
      identity,
      collectors: [
        collector(identity, 'jurisdiction_authority', [jurisdictionDeterminationClaim()]),
        collector(identity, 'zoning_district', [
          claim('zoning_district', 'official_zoning_district_rur', { districtCode: 'RUR', districtName: 'Rural Residential' }),
        ]),
      ],
      changeReason: 'initial build',
      generatedBy: 'zoning-test',
    });
    const priorEvidence = (counts()).evidence;
    const { correctionId } = requestZoningCorrection({
      dealCardId: identity.dealCardId,
      domain: 'zoning_district',
      priorValue: { districtCode: 'RUR' },
      replacement: {
        claimKey: 'corrected_zoning_district',
        exactWording: 'Planner-confirmed district is CLR (Coastal Lakes Residential) per official verification letter.',
        normalizedValue: { districtCode: 'CLR' },
        sourceKind: 'official_government_document',
        authorityLevel: 'county',
        authorityName: 'Citrus County',
        sourceName: 'Citrus County planning verification',
        sourceUrl: 'https://citrus.example.gov/verification/1',
        districtCode: 'CLR',
        districtName: 'Coastal Lakes Residential',
      },
      evidenceRefs: ['citrus-verification-letter-1'],
      reason: 'County planner confirmed the GIS layer was stale for this parcel.',
      requestedBy: 'tyler',
      declaredInvalidations: ['zoning_land_use', 'valuation', 'strategy'],
    });
    const model = applyZoningCorrection({ correctionId, actor: 'tyler' });

    // New evidence + a NEW snapshot version — never a silent overwrite.
    expect((counts()).evidence).toBe(priorEvidence + 2);
    expect(model.snapshot!.version).toBeGreaterThan(before.snapshot!.version);
    expect(model.snapshot!.analysis.baseZoning.districtCode).toBe('CLR');
    const correction = model.corrections.find((row) => row.id === correctionId)!;
    expect(correction.status).toBe('applied');
    expect(correction.priorValue).toEqual({ districtCode: 'RUR' });
    expect(correction.reason).toMatch(/stale/);
    expect(correction.requestedBy).toBe('tyler');
    expect(correction.appliedAt).not.toBeNull();
    expect(correction.declaredInvalidations).toEqual(['zoning_land_use', 'valuation', 'strategy']);

    // Only declared dependents were invalidated: the government-record snapshot
    // and its evidence domain remain current and untouched.
    const government = getLandosDb().prepare(
      `SELECT status FROM landos_deal_intelligence_snapshot WHERE id=?`,
    ).get(governmentSnapshot.id) as { status: string };
    expect(government.status).toBe('current');
  });

  it('a pending approval-gated correction cannot apply without an approved, unconsumed approval', () => {
    const { identity } = confirmedDeal();
    synchronizeZoningSlice({
      identity,
      collectors: [collector(identity, 'zoning_district', [claim('zoning_district', 'd', { districtCode: 'RUR' })])],
      changeReason: 'initial',
      generatedBy: 'zoning-test',
    });
    const { correctionId, approvalId } = requestZoningCorrection({
      dealCardId: identity.dealCardId,
      domain: 'zoning_district',
      priorValue: { districtCode: 'RUR' },
      replacement: {
        claimKey: 'corrected', exactWording: 'x', normalizedValue: { districtCode: 'X' },
        sourceKind: 'official_government_document', authorityLevel: 'county',
        sourceName: 'test', sourceUrl: null, districtCode: 'X',
      },
      evidenceRefs: [],
      reason: 'test approval gate',
      requestedBy: 'tyler',
      declaredInvalidations: ['zoning_land_use'],
      requireApproval: true,
    });
    expect(approvalId).not.toBeNull();
    expect(() => applyZoningCorrection({ correctionId, actor: 'tyler' })).toThrow(/approved, unconsumed/i);
  });

  it('19. tracked collectors close every registered browser resource on success, failure, and timeout', async () => {
    const { identity } = confirmedDeal();
    const closed: string[] = [];
    const makeResource = (key: string, failClose = false): TrackedZoningBrowserResource => ({
      key,
      type: 'page',
      safeUrl: 'https://gis.example.gov/map',
      async close() {
        if (failClose) throw new Error('close failed');
        closed.push(key);
      },
    });
    const successAdapter: ZoningCollectorAdapter = {
      key: 'tracked-success',
      platform: 'browser_test',
      async collect({ track }) {
        track(makeResource('page-1'));
        track(makeResource('page-2'));
        return { status: 'succeeded', claims: [claim('zoning_district', 'tracked_district', { districtCode: 'RUR' })], artifacts: [] };
      },
    };
    const success = await runTrackedZoningCollector({
      identity, domain: 'zoning_district', sourceJurisdiction: 'Citrus County, FL',
      adapter: successAdapter, requestKey: 'tracked-success-1', timeoutMs: 5_000,
    });
    expect(success.status).toBe('succeeded');
    expect(success.cleanupStatus).toBe('succeeded');
    expect(success.ownedResourceCount).toBe(2);
    expect(success.openResourceCountAfter).toBe(0);
    expect(closed).toEqual(['page-2', 'page-1']);

    const timeoutAdapter: ZoningCollectorAdapter = {
      key: 'tracked-timeout',
      platform: 'browser_test',
      async collect({ track }) {
        track(makeResource('timeout-page'));
        await new Promise((resolve) => setTimeout(resolve, 60_000));
        return { status: 'succeeded', claims: [], artifacts: [] };
      },
    };
    const timedOut = await runTrackedZoningCollector({
      identity, domain: 'permitted_uses', sourceJurisdiction: 'Citrus County, FL',
      adapter: timeoutAdapter, requestKey: 'tracked-timeout-1', timeoutMs: 100,
    });
    expect(timedOut.status).toBe('failed');
    expect(timedOut.openResourceCountAfter).toBe(0);
    expect(closed).toContain('timeout-page');

    const failingCleanup: ZoningCollectorAdapter = {
      key: 'tracked-badclose',
      platform: 'browser_test',
      async collect({ track }) {
        track(makeResource('stuck-page', true));
        return { status: 'succeeded', claims: [], artifacts: [] };
      },
    };
    const badClose = await runTrackedZoningCollector({
      identity, domain: 'dimensional_standards', sourceJurisdiction: 'Citrus County, FL',
      adapter: failingCleanup, requestKey: 'tracked-badclose-1', timeoutMs: 5_000,
    });
    expect(badClose.cleanupStatus).toBe('failed');
    expect(badClose.openResourceCountAfter).toBe(1);
    expect(badClose.cleanupError).toMatch(/close failed/);
  });

  it('20. repeated tracked runs do not accumulate open browser resources', async () => {
    const { identity } = confirmedDeal();
    const db = getLandosDb();
    for (let run = 0; run < 5; run += 1) {
      const adapter: ZoningCollectorAdapter = {
        key: 'tracked-repeat',
        platform: 'browser_test',
        async collect({ track }) {
          track({ key: `page-${run}`, type: 'page', async close() {} });
          track({ key: `popup-${run}`, type: 'popup', async close() {} });
          return { status: 'succeeded', claims: [], artifacts: [] };
        },
      };
      await runTrackedZoningCollector({
        identity, domain: 'zoning_district', sourceJurisdiction: 'Citrus County, FL',
        adapter, requestKey: `repeat-${run}`, timeoutMs: 5_000,
      });
      const open = db.prepare(`
        SELECT COUNT(*) AS count FROM landos_browser_owned_resource
        WHERE status IN ('open','cleanup_failed')
      `).get() as { count: number };
      expect(open.count).toBe(0);
    }
    const total = db.prepare(`SELECT COUNT(*) AS count FROM landos_browser_owned_resource`).get() as { count: number };
    expect(total.count).toBe(10);
  });

  it('recovers interrupted zoning collectors after a managed restart', () => {
    const { identity } = confirmedDeal();
    const db = getLandosDb();
    const job = persistZoningCollector(collector(identity, 'zoning_ordinance', [
      claim('zoning_ordinance', 'ordinance_doc', { sourceKind: 'official_ordinance' }),
    ]));
    db.prepare(`UPDATE landos_property_collector_job SET status='running' WHERE id=?`).run(job.id);
    db.prepare(`UPDATE landos_property_collector_attempt SET status='running' WHERE job_id=?`).run(job.id);
    expect(recoverInterruptedZoningCollectors()).toEqual({ attemptsRecovered: 1, jobsRequeued: 1 });
    const row = db.prepare(`SELECT status, last_error FROM landos_property_collector_job WHERE id=?`).get(job.id) as { status: string; last_error: string };
    expect(row.status).toBe('queued');
    expect(row.last_error).toMatch(/recovered after managed restart/i);
  });

  it('recomputes honest PDF page counts for retained ordinance artifacts (regression: artifact-metadata-page-count-wrong)', () => {
    const { identity } = confirmedDeal();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'landos-zoning-pdf-'));
    tempRoots.push(root);
    const pdfPath = path.join(root, 'ordinance.pdf');
    fs.writeFileSync(pdfPath, Buffer.from(
      '%PDF-1.7\n1 0 obj <</Type /Pages /Count 51>> endobj\n2 0 obj <</Type /Page>> endobj\n%%EOF',
      'latin1',
    ));
    persistZoningCollector(collector(identity, 'zoning_ordinance', [
      claim('zoning_ordinance', 'ordinance_doc', { sourceKind: 'official_ordinance', artifactKey: 'pdf-artifact' }),
    ], {
      artifacts: [{
        ...pageArtifact('zoning_ordinance', 'pdf-artifact'),
        mimeType: 'application/pdf',
        pageSourcePaths: [pdfPath],
        pageCount: 1, // simulates the pre-fix wrong metadata
      }],
    }));
    const db = getLandosDb();
    const before = db.prepare(`SELECT id, page_count FROM landos_property_zoning_artifact`).get() as { id: number; page_count: number };
    expect(before.page_count).toBe(1);
    expect(recomputeZoningArtifactPdfPageCounts(db)).toBe(1);
    const after = db.prepare(`SELECT page_count FROM landos_property_zoning_artifact WHERE id=?`).get(before.id) as { page_count: number };
    expect(after.page_count).toBe(51);
    // The append-only trigger is restored after the audited correction.
    expect(() => db.prepare(`UPDATE landos_property_zoning_artifact SET display_name='tampered' WHERE id=?`).run(before.id)).toThrow(/append-only/);
    // Idempotent: a second run corrects nothing further.
    expect(recomputeZoningArtifactPdfPageCounts(db)).toBe(0);
  });

  it('snapshot generation is idempotent for identical evidence and read model is null without an identity', () => {
    const { identity } = confirmedDeal();
    const job = persistZoningCollector(collector(identity, 'zoning_district', [
      claim('zoning_district', 'district', { districtCode: 'RUR' }),
    ]));
    const first = generateZoningSnapshot({ identity, jobs: [job], changeReason: 'a', generatedBy: 't' });
    const second = generateZoningSnapshot({ identity, jobs: [job], changeReason: 'b', generatedBy: 't' });
    expect(second.id).toBe(first.id);
    expect(getZoningReadModel(999_999)).toBeNull();
  });
});
