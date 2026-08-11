import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDealCard, linkPropertyToDeal } from '../deal-card.js';
import { _initTestLandosDb } from '../db.js';
import {
  fixedInitialFilters,
  getOrCreateMrSnapshot,
  recordMrMetrics,
} from '../market-research-snapshots.js';
import { upsertPropertyCard } from '../property-card.js';
import { initialSpecialistRecords } from '../property-intelligence-snapshot.js';
import {
  PropertyIntelligenceStore,
  resetPropertyIntelligenceStoreCache,
} from '../property-intelligence-store.js';
import { resetPropertyResearchStoreCache } from '../property-research-store.js';
import { executeLandosBridgeOperation } from './mcp-bridge.js';

const ADDRESS = '704 Bell Rd, Red Creek, NY 13143';
const APN = '056400 37.00-1-33';
const PROPERTY_ID = '89520173';
const NOW = '2026-08-03T02:00:00.000Z';
const ACCEPTANCE_FIXTURE = path.resolve('.landos/acceptance/2026-08-03T01-47-47-731Z-governed-multi-agent-os-known-defect-proof');
const ACCEPTANCE_CONTRACT = path.resolve('config/acceptance/704-bell-known-defect.contract.json');
const CAPTURE_ARTIFACTS = [
  'new-lead.png',
  'deal-card-loaded.png',
  'changed-section.png',
  'relevant-tab-or-panel.png',
  'after-refresh.png',
  'after-restart.png',
  'trace.zip',
  'video.webm',
  'console.json',
  'network-failures.json',
] as const;

function object(value: unknown): Record<string, unknown> {
  expect(value).toBeTruthy();
  expect(typeof value).toBe('object');
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}

function seedProperty(): { propertyCardId: number; dealCardId: number } {
  // The operating record intentionally stores only the street in the primary
  // address column. The bridge must compose the exact canonical display
  // address from the separate city/state/ZIP fields without fuzzy matching.
  const { card } = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: '704 Bell Rd',
    city: 'Red Creek',
    county: 'Wayne County',
    state: 'NY',
    zip: '13143',
    apn: APN,
    lpPropertyId: PROPERTY_ID,
    fips: '36117',
    verified: true,
    verificationSource: 'official Wayne County assessor record',
  });
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: '704 Bell governed bridge proof', leadType: 'test' });
  expect(linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' }).error).toBeUndefined();
  return { propertyCardId: card.id, dealCardId: deal.id };
}

function identity(propertyCardId: number) {
  return { property_card_id: propertyCardId, address: ADDRESS, apn: APN, property_id: PROPERTY_ID };
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
}

async function copyCaptures(destination: string): Promise<void> {
  await Promise.all(CAPTURE_ARTIFACTS.map((name) => copyFile(path.join(ACCEPTANCE_FIXTURE, name), path.join(destination, name))));
}

function retimeReport(report: Record<string, unknown>, startedAt: unknown): void {
  const start = String(startedAt);
  const timestamp = new Date(Date.parse(start) + 30_000).toISOString();
  report.startedAt = start;
  report.completedAt = new Date(Date.parse(start) + 60_000).toISOString();
  for (const item of report.claims as Array<Record<string, unknown>>) item.timestamp = timestamp;
  for (const item of report.counts as Array<Record<string, unknown>>) item.timestamp = timestamp;
  for (const item of report.artifacts as Array<Record<string, unknown>>) item.capturedAt = timestamp;
  object(report.lifecycle).verifiedAt = timestamp;
  object(report.refresh).timestamp = timestamp;
  object(report.restart).timestamp = timestamp;
  object(report.contamination).timestamp = timestamp;
  object(report.console).timestamp = timestamp;
  object(report.network).timestamp = timestamp;
}

function reconcileHardenedReport(report: Record<string, unknown>, contract: Record<string, unknown>): void {
  const property = object(contract.property);
  const policy = object(contract.runPolicy);
  const priorClaims = new Map((report.claims as Array<Record<string, unknown>>).map((claim) => [String(claim.claimId), claim]));
  report.contractId = contract.contractId;
  report.sprintName = contract.sprintName;
  report.mode = policy.mode;
  report.propertyAddress = property.normalizedAddress;
  object(report.freshness).required = policy.freshnessRequired;
  report.claims = (contract.claims as Array<Record<string, unknown>>).map((expected) => {
    const prior = priorClaims.get(String(expected.id));
    const visibleValue = expected.id === 'property-id-visible' ? '' : expected.expectedValue;
    return {
      ...(prior ?? {}),
      claimId: expected.id,
      operatorSection: expected.operatorSection,
      propertyAddress: property.normalizedAddress,
      claim: expected.claim,
      expectedValue: expected.expectedValue,
      visibleValue: prior?.visibleValue ?? visibleValue,
      status: prior?.status ?? (expected.id === 'property-id-visible' ? 'FAIL' : 'PASS'),
      evidencePath: prior?.evidencePath ?? (expected.evidenceArtifacts as string[])[0],
      timestamp: prior?.timestamp ?? NOW,
      refreshResult: prior?.refreshResult ?? 'PASS',
      restartResult: prior?.restartResult ?? 'PASS',
      contaminationResult: prior?.contaminationResult ?? 'PASS',
    };
  });
  for (const artifact of report.artifacts as Array<Record<string, unknown>>) {
    const content = object(artifact.contentValidation);
    delete content.operatorSection;
    delete content.locator;
    delete content.visibleText;
  }
}

describe.sequential('governed LandOS MCP canonical bridge', () => {
  let qaRoot = '';

  beforeEach(async () => {
    _initTestLandosDb();
    resetPropertyResearchStoreCache();
    resetPropertyIntelligenceStoreCache();
    qaRoot = await mkdtemp(path.join(tmpdir(), 'landos-mcp-qa-'));
    process.env.LANDOS_STORAGE_MODE = 'qa';
    process.env.LANDOS_ACCEPTANCE_QA_ROOT = qaRoot;
  });

  afterEach(async () => {
    delete process.env.LANDOS_ACCEPTANCE_QA_ROOT;
    delete process.env.LANDOS_STORAGE_MODE;
    resetPropertyResearchStoreCache();
    resetPropertyIntelligenceStoreCache();
    if (qaRoot) await rm(qaRoot, { recursive: true, force: true });
  });

  it('routes all read and research operations through canonical stores with exact property isolation', async () => {
    const { propertyCardId, dealCardId } = seedProperty();
    const canonicalIdentity = identity(propertyCardId);

    const context = object(await executeLandosBridgeOperation('get_property_context', { property_card_id: propertyCardId }));
    expect(context.identity).toEqual(canonicalIdentity);
    expect(context.deal_card_id).toBe(dealCardId);
    expect(context.canonical).toBe(true);

    const expectation = object(await executeLandosBridgeOperation('get_acceptance_expectations', {
      property_card_id: propertyCardId,
      sprint_name: 'governed-multi-agent-os-known-defect-proof',
    }));
    expect(expectation.contract_id).toBe('landos-704-bell-known-defect-v1');
    expect(expectation.claims).toHaveLength(9);
    expect(expectation.claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ claim_id: 'property-apn-visible', expected_binding: 'property.apn' }),
      expect.objectContaining({ claim_id: 'property-id-visible', expected_binding: 'property.canonicalPropertyId' }),
    ]));

    const sourceRegistry = object(await executeLandosBridgeOperation('get_source_registry_entries', {
      kind: null,
      jurisdiction: null,
      limit: 2,
    }));
    expect(sourceRegistry.entries).toHaveLength(2);
    expect(Number(sourceRegistry.total)).toBeGreaterThanOrEqual(2);

    const snapshot = getOrCreateMrSnapshot({
      quarter: '2026-Q3',
      filters: fixedInitialFilters('2-5'),
      provider: 'LandPortal Market Research (Drill Deep)',
      collectedAt: NOW,
    });
    expect(recordMrMetrics(snapshot.id, [{
      geography: { level: 'state', state: 'NY' },
      metrics: { salesCount: 17, daysOnMarket: 81 },
      provider: 'LandPortal Market Research (Drill Deep)',
      sourceRef: 'https://landportal.com/market-research/',
      observedAt: NOW,
    }]).written).toBe(1);
    const market = object(await executeLandosBridgeOperation('get_market_research_context', {
      property_card_id: propertyCardId,
      scope: 'state',
    }));
    expect(market.scope).toBe('state');
    expect(object(market.metrics).salesCount).toBe(17);
    expect(market.sources).toEqual(['https://landportal.com/market-research/']);

    const fact = {
      identity: canonicalIdentity,
      category: 'subject',
      field: 'parcel.owner',
      value: 'Governed Owner',
      evidence_type: 'fact',
      strength: 'official_record',
      provider_id: 'wayne-county-assessor',
      source_url: 'https://waynecountyny.gov/assessor/704-bell',
      retrieved_at: NOW,
      confidence: 'high',
    };
    const factReceipt = await executeLandosBridgeOperation('save_verified_property_fact', { fact });
    expect(object(factReceipt).accepted).toBe(true);
    expect(await executeLandosBridgeOperation('save_verified_property_fact', { fact })).toEqual(factReceipt);

    const compReceipt = await executeLandosBridgeOperation('save_verified_comp', { comp: {
      identity: canonicalIdentity,
      category: 'comps',
      evidence_type: 'comp',
      provider_id: 'verified-comps-provider',
      price: 75_000,
      acres: 5,
      apn: '056400 37.00-1-44',
      address: '710 Bell Rd, Red Creek, NY 13143',
      price_per_acre: 15_000,
      sale_date: '2026-07-01',
      source_url: 'https://example.gov/comps/710-bell',
      retrieved_at: NOW,
    } });
    expect(object(compReceipt).accepted).toBe(true);

    const visualReceipt = await executeLandosBridgeOperation('save_verified_visual_artifact', { artifact: {
      identity: canonicalIdentity,
      category: 'visuals',
      evidence_type: 'visual',
      provider_id: 'governed-visual-provider',
      key: 'parcel-context',
      label: 'Verified parcel context',
      purpose: 'Subject-centered parcel context for the canonical property.',
      artifact_path: 'visuals/704-bell-parcel.png',
      sha256: 'a'.repeat(64),
      captured_at: NOW,
      requested_view: 'parcel_context',
      active_view: 'parcel_context',
      boundary_required: true,
      boundary_visible: true,
      tiles_loaded: true,
      camera_scale: 'parcel',
      clipped: false,
      obstructions: [],
    } });
    expect(object(visualReceipt).accepted).toBe(true);

    const evidence = object(await executeLandosBridgeOperation('get_accepted_evidence', {
      property_card_id: propertyCardId,
      category: null,
      limit: 20,
    }));
    expect(evidence.total).toBe(3);
    expect(evidence.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'subject', kind: 'fact', property_card_id: propertyCardId }),
      expect.objectContaining({ category: 'comps', kind: 'comp', property_card_id: propertyCardId }),
      expect.objectContaining({ category: 'visuals', kind: 'visual', property_card_id: propertyCardId }),
    ]));

    const intelligence = new PropertyIntelligenceStore();
    intelligence.createRun({
      runId: 'pi-mcp-704-bell',
      dealCardId,
      trigger: 'governed-mcp-test',
      startedAt: NOW,
      specialists: initialSpecialistRecords(),
    });
    const progressReceipt = await executeLandosBridgeOperation('report_specialist_progress', { progress: {
      identity: canonicalIdentity,
      category: 'market',
      provider_id: 'governed-market-provider',
      status: 'running',
      progress_percent: 60,
      note: 'Verified state market metrics retained; county research remains bounded.',
      reported_at: NOW,
    } });
    expect(object(progressReceipt).accepted).toBe(true);

    const terminalResult = {
      identity: canonicalIdentity,
      category: 'market',
      provider_id: 'governed-market-provider',
      outcome: 'complete',
      summary: 'Canonical state market context retained with official source provenance.',
      completed_at: NOW,
      retained_item_count: 1,
    };
    const terminal = await executeLandosBridgeOperation('complete_or_fail_research_category', { result: terminalResult });
    expect(terminal).toEqual({ accepted: true, category: 'market', outcome: 'complete', recorded_at: NOW });
    expect(await executeLandosBridgeOperation('complete_or_fail_research_category', { result: terminalResult })).toEqual(terminal);
    await expect(executeLandosBridgeOperation('complete_or_fail_research_category', { result: {
      ...terminalResult,
      outcome: 'failed',
      summary: 'A conflicting terminal rewrite must not replace the retained result.',
      retained_item_count: 0,
    } })).rejects.toThrow(/immutable terminal result/i);

    const statuses = object(await executeLandosBridgeOperation('get_provider_and_specialist_status', {
      property_card_id: propertyCardId,
    }));
    expect(statuses.specialists).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'market', status: 'verified' }),
    ]));

    await expect(executeLandosBridgeOperation('save_verified_property_fact', { fact: {
      ...fact,
      identity: { ...canonicalIdentity, address: '705 Bell Rd, Red Creek, NY 13143' },
    } })).rejects.toThrow(/does not match/i);
    await expect(executeLandosBridgeOperation('save_verified_property_fact', {
      fact,
      arbitrary_path: '../../outside',
    })).rejects.toThrow(/unrecognized key/i);
    await expect(executeLandosBridgeOperation('arbitrary_sql', { query: 'SELECT * FROM secrets' }))
      .rejects.toThrow(/allowlist/i);
  });

  it('records and submits all eight acceptance operations as an immutable inspected package', async () => {
    const { propertyCardId } = seedProperty();
    const contract = await readJson(ACCEPTANCE_CONTRACT);
    const started = object(await executeLandosBridgeOperation('begin_acceptance_run', { contract }));
    const runId = String(started.run_id);
    const runDirectory = path.join(qaRoot, runId);
    await copyCaptures(runDirectory);

    const report = await readJson(path.join(ACCEPTANCE_FIXTURE, 'results.json'));
    reconcileHardenedReport(report, contract);
    report.runId = runId;
    retimeReport(report, started.started_at);

    const claimReceipts = await Promise.all((report.claims as Array<Record<string, unknown>>).map((claim) =>
      executeLandosBridgeOperation('record_visual_claim', { run_id: runId, claim })));
    expect(claimReceipts.every((receipt) => object(receipt).accepted === true)).toBe(true);
    const artifacts = report.artifacts as Array<Record<string, unknown>>;
    const screenshotReceipts = await Promise.all(CAPTURE_ARTIFACTS.slice(0, 6).map((name) => {
      const artifact = artifacts.find((candidate) => candidate.path === name);
      expect(artifact).toBeTruthy();
      return executeLandosBridgeOperation('record_screenshot_artifact', {
        run_id: runId,
        artifact,
      });
    }));
    expect(screenshotReceipts.every((receipt) => object(receipt).accepted === true)).toBe(true);
    const singletonReceipts = await Promise.all([
      executeLandosBridgeOperation('record_refresh_result', { run_id: runId, result: report.refresh }),
      executeLandosBridgeOperation('record_restart_result', { run_id: runId, result: report.restart }),
      executeLandosBridgeOperation('record_console_result', { run_id: runId, result: report.console }),
      executeLandosBridgeOperation('record_network_result', { run_id: runId, result: report.network }),
    ]);
    expect(singletonReceipts.every((receipt) => object(receipt).accepted === true)).toBe(true);

    const submitted = object(await executeLandosBridgeOperation('submit_pass_or_fail_report', { run_id: runId, report }));
    expect(submitted).toMatchObject({ accepted: true, run_id: runId, verdict: 'FAIL', immutable: true });
    expect(await executeLandosBridgeOperation('submit_pass_or_fail_report', { run_id: runId, report })).toEqual(submitted);
    expect((await readdir(runDirectory)).sort()).toEqual([
      'acceptance-contract.json',
      'acceptance-report.md',
      ...CAPTURE_ARTIFACTS,
      'results.json',
    ].sort());

    const counts = object(await executeLandosBridgeOperation('get_visible_and_canonical_counts', {
      property_card_id: propertyCardId,
    }));
    expect(counts.counts).toEqual(expect.arrayContaining([
      expect.objectContaining({ operator_section: 'Comps & Market', canonical_accepted: 4, visible: 0, rendered_rows: 0 }),
      expect.objectContaining({ operator_section: 'Documents & Visuals', canonical_accepted: 1, visible: 0, rendered_rows: 0 }),
    ]));

    await expect(executeLandosBridgeOperation('record_visual_claim', {
      run_id: runId,
      claim: (report.claims as Array<Record<string, unknown>>)[0],
    })).rejects.toThrow(/immutable/i);
  });

  it('allows corrections before submit while rejecting cross-run, cross-property, and invalid artifact input', async () => {
    seedProperty();
    const contract = await readJson(ACCEPTANCE_CONTRACT);
    const first = object(await executeLandosBridgeOperation('begin_acceptance_run', { contract }));
    const firstRunId = String(first.run_id);
    const report = await readJson(path.join(ACCEPTANCE_FIXTURE, 'results.json'));
    reconcileHardenedReport(report, contract);
    report.runId = firstRunId;
    retimeReport(report, first.started_at);
    const firstClaim = (report.claims as Array<Record<string, unknown>>)[0];

    await expect(executeLandosBridgeOperation('record_visual_claim', {
      run_id: firstRunId,
      claim: { ...firstClaim, propertyAddress: '12 Other Rd, Auburn, NY 13021' },
    })).rejects.toThrow(/contract or property identity/i);
    await executeLandosBridgeOperation('record_visual_claim', { run_id: firstRunId, claim: firstClaim });
    const correctedClaim = { ...firstClaim, visibleValue: 'corrected observation' };
    await expect(executeLandosBridgeOperation('record_visual_claim', {
      run_id: firstRunId,
      claim: correctedClaim,
    })).resolves.toMatchObject({ accepted: true });
    await expect(executeLandosBridgeOperation('record_visual_claim', {
      run_id: '2026-08-03t02-00-00-000z-unknown-governed-run',
      claim: firstClaim,
    })).rejects.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = object(await executeLandosBridgeOperation('begin_acceptance_run', { contract }));
    const secondRunId = String(second.run_id);
    await expect(executeLandosBridgeOperation('submit_pass_or_fail_report', {
      run_id: secondRunId,
      report,
    })).rejects.toThrow(/differs from the immutable run/i);

    await new Promise((resolve) => setTimeout(resolve, 2));
    const third = object(await executeLandosBridgeOperation('begin_acceptance_run', { contract }));
    const thirdRunId = String(third.run_id);
    const thirdDirectory = path.join(qaRoot, thirdRunId);
    const screenshot = (report.artifacts as Array<Record<string, unknown>>).find((artifact) => artifact.path === 'new-lead.png');
    expect(screenshot).toBeTruthy();
    await copyFile(path.join(ACCEPTANCE_FIXTURE, 'new-lead.png'), path.join(thirdDirectory, 'new-lead.png'));
    await writeFile(path.join(thirdDirectory, 'new-lead.png'), Buffer.from('tampered artifact'));
    await expect(executeLandosBridgeOperation('record_screenshot_artifact', {
      run_id: thirdRunId,
      artifact: screenshot,
    })).rejects.toThrow(/byte length differs|sha-256 differs/i);
  });
});
