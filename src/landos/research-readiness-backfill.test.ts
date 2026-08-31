// Targeted backfill, end to end against a real Deal Card.
//
// Builds an OLD lead in the test DB — a verified parcel with retained research
// and no capability-registry history — reconciles its manifest from what is on
// disk, then runs the bounded backfill with an injected capability invoker.
//
// What this proves that the pure selection tests cannot: the reconciler really
// does rebuild a checklist from retained evidence without rerunning anything,
// and the runner really does invoke ONLY the capabilities the manifest selected.

import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { savePropertyInspection, upsertPropertyCard } from './property-card.js';
import { reconcileResearchReadiness, isReconcileError } from './research-readiness-reconcile.js';
import { runResearchReadinessBackfill } from './research-readiness-backfill.js';
import type { CapabilityInvocationRequest, CapabilityResult } from './capability-contract.js';

const NOW = '2026-08-19T12:00:00.000Z';

function oldLead(): { dealCardId: number; propertyCardId: number } {
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Retained lead — Map 100 Parcel 7' });
  const { card } = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: 'Map 100 Parcel 7, Example County, TN',
    county: 'Example',
    state: 'TN',
    apn: '100-007.00-000',
    fips: '47999',
    acres: 40,
    verified: true,
    verificationSource: 'Official Example County assessor record',
  });
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
  return { dealCardId: deal.id, propertyCardId: card.id };
}

function fakeResult(request: CapabilityInvocationRequest): CapabilityResult {
  return {
    invocationId: `test_${request.capabilityId}`,
    capability: { id: request.capabilityId, name: request.capabilityId, contractVersion: '1', description: '' },
    status: 'SUCCEEDED',
    subjectResolution: 'RESOLVED',
    canonicalSubject: null,
    facts: {},
    evidence: [],
    warnings: [],
    missingInformation: [],
    timestamps: { startedAt: NOW, completedAt: NOW },
    execution: { mode: 'refresh', durationMs: 1, reused: false },
  };
}

beforeEach(() => {
  _initTestLandosDb();
});

describe('research readiness reconciliation — retained state only', () => {
  it('rebuilds a checklist for an old lead without running anything', () => {
    const { dealCardId, propertyCardId } = oldLead();
    const manifest = reconcileResearchReadiness(dealCardId, NOW);
    if (isReconcileError(manifest)) throw new Error(manifest.error);

    expect(manifest.propertyCardId).toBe(propertyCardId);
    expect(manifest.items).toHaveLength(19);
    // The two facts this card really does hold, read straight off the card.
    expect(manifest.items.find((i) => i.id === 'property_resolution')?.status).toBe('green');
    expect(manifest.items.find((i) => i.id === 'official_parcel_record')?.status).toBe('green');
    // Everything a capability owns and has never run for is honestly red.
    expect(manifest.items.find((i) => i.id === 'assessor_tax')?.status).toBe('red');
    expect(manifest.items.find((i) => i.id === 'current_zoning')?.status).toBe('red');
    // The seller has not been contacted: an expected unknown, never a failure.
    expect(manifest.items.find((i) => i.id === 'seller_information')?.status).toBe('gray');
  });

  it('reports a missing subject Property Card instead of guessing one', () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'No parcel yet' });
    const result = reconcileResearchReadiness(deal.id, NOW);
    expect(isReconcileError(result)).toBe(true);
  });

  it('does not promote a provider-backed parcel match to an official government record', () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Provider-resolved lead' });
    const { card } = upsertPropertyCard({
      entity: 'TY_LAND_BIZ',
      activeInputAddress: 'Parcel 023.003-02',
      county: 'Hamilton',
      state: 'TN',
      apn: '023 003.02',
      acres: 40.5,
      verified: false,
      verificationSource: 'provider:landportal_search_result_verified_on_screen; County sources were attempted',
    });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
    savePropertyInspection(card.id, {
      parcelUrl: 'https://landportal.com/',
      parcelUrlRecord: {
        url: 'https://landportal.com/',
        source: 'provider:landportal_search_result_verified_on_screen',
        capturedAt: NOW,
        propertyCardId: card.id,
        dealCardId: deal.id,
        verifiedSubject: true,
        apn: '023 003.02',
        fips: null,
        propertyId: null,
        verifiedCounty: 'Hamilton',
        verifiedState: 'TN',
      },
      comparablesUrl: null,
      parcelFacts: { 'Parcel ID': '023 003.02', Acres: '40.500' },
      assets: [], overlays: [], visualObservations: [], comparables: [],
      sources: [], evidence: [], discoveryQuestions: [], missingInformation: [],
    });

    const manifest = reconcileResearchReadiness(deal.id, NOW);
    if (isReconcileError(manifest)) throw new Error(manifest.error);

    const official = manifest.items.find((item) => item.id === 'official_parcel_record');
    const provider = manifest.items.find((item) => item.id === 'landportal_research');
    expect(provider?.status).toBe('green');
    expect(provider?.reason).toMatch(/authenticated exact-subject checkpoint/);
    expect(official?.status).toBe('red');
    expect(official?.reason).toBe('No official parcel or GIS record has been retrieved for this parcel.');
  });
});

describe('targeted backfill — bounded invocation', () => {
  it('starts prerequisite-safe capability targets concurrently while preserving report order', async () => {
    const { dealCardId } = oldLead();
    const manifest = reconcileResearchReadiness(dealCardId, NOW);
    if (isReconcileError(manifest)) throw new Error(manifest.error);
    const expected = [...new Set(manifest.items
      .filter((item) => item.status === 'red' && item.machineBackfillAllowed)
      .map((item) => item.owner.capabilityId)
      .filter((id): id is string => id != null))];
    const invoked: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const pending = runResearchReadinessBackfill(dealCardId, 'TY_LAND_BIZ', {}, {
      now: () => NOW,
      invoke: async (request) => {
        invoked.push(request.capabilityId);
        await gate;
        return fakeResult(request);
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      expect(invoked).toEqual(expected);
    } finally {
      release?.();
    }
    const report = await pending;
    if ('error' in report) throw new Error(report.error);
    expect(report.ran.map((run) => run.capabilityId)).toEqual(expected);
  });

  it('invokes only the capabilities the manifest selected, once each', async () => {
    const { dealCardId } = oldLead();
    const invoked: string[] = [];
    const report = await runResearchReadinessBackfill(dealCardId, 'TY_LAND_BIZ', {}, {
      now: () => NOW,
      invoke: async (request) => { invoked.push(request.capabilityId); return fakeResult(request); },
    });
    if ('error' in report) throw new Error(report.error);

    const expected = new Set(report.before.items
      .filter((item) => item.status === 'red' && item.machineBackfillAllowed)
      .map((item) => item.owner.capabilityId));
    expect(new Set(invoked)).toEqual(expected);
    // One invocation per capability, however many checklist items it owns.
    expect(invoked.length).toBe(new Set(invoked).size);
    expect(report.ran.every((run) => run.status === 'succeeded')).toBe(true);
  });

  it('never invokes a capability for a green, yellow or gray item', async () => {
    const { dealCardId } = oldLead();
    const invoked: string[] = [];
    const report = await runResearchReadinessBackfill(dealCardId, 'TY_LAND_BIZ', {}, {
      now: () => NOW,
      invoke: async (request) => { invoked.push(request.capabilityId); return fakeResult(request); },
    });
    if ('error' in report) throw new Error(report.error);

    const untouchable = report.before.items.filter((item) => ['green', 'yellow', 'gray'].includes(item.status));
    for (const item of untouchable) {
      const ranForItem = report.ran.some((run) => run.itemIds.includes(item.id));
      expect(ranForItem, `${item.label} (${item.status}) must not be backfilled`).toBe(false);
      expect(report.skipped.some((skip) => skip.itemId === item.id)).toBe(true);
    }
  });

  it('refuses an explicitly named gray item and runs nothing', async () => {
    const { dealCardId } = oldLead();
    const invoked: string[] = [];
    const report = await runResearchReadinessBackfill(dealCardId, 'TY_LAND_BIZ', { itemIds: ['seller_information'] }, {
      now: () => NOW,
      invoke: async (request) => { invoked.push(request.capabilityId); return fakeResult(request); },
    });
    if ('error' in report) throw new Error(report.error);
    expect(invoked).toEqual([]);
    expect(report.nothingToDo).toBe(true);
    expect(report.skipped[0].reason).toMatch(/never starts automated research/i);
  });

  it('runs exactly one capability when one item is named', async () => {
    const { dealCardId } = oldLead();
    const invoked: string[] = [];
    const report = await runResearchReadinessBackfill(dealCardId, 'TY_LAND_BIZ', { itemIds: ['assessor_tax'] }, {
      now: () => NOW,
      invoke: async (request) => { invoked.push(request.capabilityId); return fakeResult(request); },
    });
    if ('error' in report) throw new Error(report.error);
    expect(invoked).toEqual(['assessor-tax']);
    expect(report.ran).toHaveLength(1);
    expect(report.ran[0].itemIds).toEqual(['assessor_tax']);
  });

  it('records a refusing capability as a failed run and keeps going', async () => {
    const { dealCardId } = oldLead();
    const report = await runResearchReadinessBackfill(dealCardId, 'TY_LAND_BIZ', {}, {
      now: () => NOW,
      invoke: async (request) => {
        if (request.capabilityId === 'assessor-tax') throw new Error('adapter unavailable');
        return fakeResult(request);
      },
    });
    if ('error' in report) throw new Error(report.error);
    const assessor = report.ran.find((run) => run.capabilityId === 'assessor-tax');
    expect(assessor?.status).toBe('failed');
    expect(assessor?.summary).toMatch(/adapter unavailable/);
    // The other selected capabilities still ran.
    expect(report.ran.filter((run) => run.status === 'succeeded').length).toBeGreaterThan(0);
  });

  it('returns the manifest before and after so the operator sees what changed', async () => {
    const { dealCardId } = oldLead();
    const report = await runResearchReadinessBackfill(dealCardId, 'TY_LAND_BIZ', {}, {
      now: () => NOW,
      invoke: async (request) => fakeResult(request),
    });
    if ('error' in report) throw new Error(report.error);
    expect(report.before.contractVersion).toBe('research-readiness-manifest-v1');
    expect(report.after.contractVersion).toBe('research-readiness-manifest-v1');
    expect(report.before.dealCardId).toBe(dealCardId);
  });
});
