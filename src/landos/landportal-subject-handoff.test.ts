// The identity lane's input is the parcel's own facts, which the direct
// LandPortal API path returns in seconds. It used to wait for the ENTIRE
// capture — imagery, overlays, 3D, county deep record — and reported a
// 300-second handoff timeout for data it had been holding since second 36.
//
// The lane now settles on whichever comes first: the early subject handoff or
// the full capture. The capture itself is unchanged and keeps running.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// PRE-EXISTING BLOCKER, unrelated to the identity lane: `comps.ts` at this
// branch's HEAD imports `./comp-location-reconciliation.js`, which is not
// committed, so this suite could not load at all. The identity lane reads no
// comparable rows; the retained-comp work is out of scope here.
vi.mock('./comps.js', () => ({
  listComps: () => [],
  addComp: () => ({}),
  getComp: () => undefined,
  deleteComp: () => false,
  upsertNormalizedComp: () => ({}),
  retireForkedCompRow: () => undefined,
  enrichCompCoordinates: async () => [],
  geocodeAddressesToCache: async () => [],
  extractListingCoordinates: () => null,
  recommendCompSources: () => [],
  evaluateCompRecency: () => ({ stale: false, note: '' }),
  isPaidCompAllowed: () => false,
  assertPaidCompAllowed: () => undefined,
  PAID_COMP_TOOLS: [],
}));

import { _initTestLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { loadPropertyInspection, promoteRetainedLandPortalParcelUrl, upsertPropertyCard } from './property-card.js';
import { persistPropertyInspection } from './property-inspection.js';
import { collectParcelIdentity } from './property-intelligence-live.js';
import type { MissionContext } from './property-intelligence-collector-types.js';
import { invokeRuntimeCapability } from './capability-registry.js';
import { landPortalSubjectFactsHandoff } from './routes.js';

function seedCard(resolved = true): number {
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'LandPortal subject handoff' });
  const { card } = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: '5170 HIGHWAY 60',
    county: 'Hamilton',
    state: 'TN',
    // An UNRESOLVED lead carries no parcel identifier, which is the state the
    // capture is actually needed in.
    ...(resolved ? { apn: '023 003.02', verified: true, verificationSource: 'test' } : {}),
    owner: 'CAMERON NATHANIEL JOSEPH',
    acres: 40.5,
    agentId: 'test',
  } as Parameters<typeof upsertPropertyCard>[0]);
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' } as Parameters<typeof linkPropertyToDeal>[0]);
  return deal.id;
}

function context(dealCardId: number): MissionContext {
  return {
    dealCardId,
    runId: 'pi_subject_handoff',
    identity: {
      capabilityResolution: 'RESOLVED', capabilityInvocationId: 'cap-test',
      identity: {
        state: 'confirmed', normalizedAddress: '5170 highway 60', county: 'Hamilton', state_: 'TN',
        apn: '023 003.02', apnVariants: ['023 003.02'], owner: 'CAMERON NATHANIEL JOSEPH', ownerMailing: null,
        situs: '5170 HIGHWAY 60', acres: 40.5, acreageBasis: 'deeded', coordinates: null,
        hasParcelGeometry: false, sourceConfidence: 'high', conflicts: [], explanation: 'Confirmed.',
      },
      facts: [],
      subjectMarket: { state: 'TN', county: 'Hamilton', acres: 40.5 },
      subjectAcres: 40.5,
      acreageConflict: false,
    },
    comparables: null,
  };
}

beforeEach(() => { _initTestLandosDb(); });

describe('LandPortal subject handoff', () => {
  it('retains a late parcel URL without associating it until the next capability invocation', async () => {
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Late URL association' });
    const { card } = upsertPropertyCard({
      entity: 'TY_LAND_BIZ', activeInputAddress: 'KINGWOOD BLVD', apn: '042-123.00-000', county: 'Williamson', state: 'TN',
      fips: '47187', agentId: 'test',
    } as Parameters<typeof upsertPropertyCard>[0]);
    linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
    const url = `https://landportal.com/?property=${Buffer.from('fips=47187&apn=042-123.00-000&propertyid=987654').toString('base64')}`;
    persistPropertyInspection(card.id, { parcelUrl: url, comparablesUrl: null, parcelFacts: {}, assets: [], overlays: [], visualObservations: [], comparables: [] });
    let handedOff = false;
    const handoff = landPortalSubjectFactsHandoff({ cardId: card.id, dealCardId: deal.id, retainedUrl: url, onSubjectReady: () => { handedOff = true; } });
    handoff?.({ url, fields: { APN: '042-123.00-000', County: 'Williamson', State: 'TN' } });
    expect(handedOff).toBe(true);
    expect(loadPropertyInspection(card.id)?.parcelUrlRecord ?? null).toBeNull();

    const result = await invokeRuntimeCapability({
      capabilityId: 'property-resolution',
      caller: { type: 'internal_workflow', ref: `deal:${deal.id}` },
      subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: card.id, dealCardId: deal.id },
      mode: 'refresh',
    }, {
      beforeResolve: async () => { promoteRetainedLandPortalParcelUrl(card.id, deal.id); },
    });
    expect(result.subjectResolution).toBe('RESOLVED');
    expect(loadPropertyInspection(card.id)?.parcelUrlRecord).toMatchObject({ verifiedSubject: true, dealCardId: deal.id, propertyCardId: card.id });
  });

  it('settles the identity lane on the early subject facts while the capture is still running', async () => {
    const dealCardId = seedCard();
    let releaseCapture!: () => void;
    const captureGate = new Promise<void>((resolve) => { releaseCapture = resolve; });
    let captureFinished = false;
    let handedOff = false;

    const pending = collectParcelIdentity(context(dealCardId), {
      // A long capture that hands the subject over early, exactly as the live
      // one does the moment the direct API read returns.
      landPortalCaptureWaitMs: 300_000,
      captureLandPortalInspection: async ({ onSubjectReady }) => {
        onSubjectReady?.({ ok: true, note: 'Verified subject parcel facts (57 field(s)) read.', comparableCount: 0 });
        handedOff = true;
        await captureGate;
        captureFinished = true;
        return { ok: true, note: 'full capture complete', comparableCount: 7 };
      },
      runPublicIntelligence: async () => ({ ok: true }),
    });

    await vi.waitFor(() => expect(handedOff).toBe(true));
    // The lane answers without the imagery half, and WITHOUT the 300s window.
    await expect(pending).resolves.toMatchObject({ status: 'completed' });
    expect(captureFinished).toBe(false);
    releaseCapture();
  });

  it('still waits for the whole capture when no early handoff is made and the subject is unresolved', async () => {
    const dealCardId = seedCard(false);
    let releaseCapture!: () => void;
    const captureGate = new Promise<void>((resolve) => { releaseCapture = resolve; });
    let captureFinished = false;
    let settled = false;

    const pending = collectParcelIdentity(context(dealCardId), {
      landPortalCaptureWaitMs: 300_000,
      captureLandPortalInspection: async () => {
        await captureGate;
        captureFinished = true;
        return { ok: true, note: 'full capture complete', comparableCount: 7 };
      },
      runPublicIntelligence: async () => ({ ok: true }),
      promoteSubjectIdentity: async () => undefined,
    }).then((outcome) => { settled = true; return outcome; });

    // Nothing handed the subject over and no other lane established the parcel,
    // so the lane is still waiting for the capture that can.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(settled).toBe(false);
    releaseCapture();
    // A completed provider capture is not enough: without one released
    // canonical subject the capability root stays blocked and no dependent
    // property lane may fan out.
    await expect(pending).resolves.toMatchObject({ status: 'blocked' });
    expect(captureFinished).toBe(true);
  });

  it('does NOT wait for the capture when the subject is already resolved', async () => {
    // The Universal Resolver's retained fast path. Re-establishing an identity
    // LandOS already holds is exactly the wait this sprint removed: the capture
    // still runs for its visuals and comp anchor, but nothing gates on it.
    const dealCardId = seedCard();
    let captureFinished = false;
    let capabilityPromotions = 0;
    const outcome = await collectParcelIdentity(context(dealCardId), {
      landPortalCaptureWaitMs: 300_000,
      captureLandPortalInspection: async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
        captureFinished = true;
        return { ok: true, note: 'full capture complete', comparableCount: 7 };
      },
      runPublicIntelligence: async () => ({ ok: true }),
      promoteSubjectIdentity: async () => { capabilityPromotions += 1; },
    });

    expect(captureFinished).toBe(false);
    expect(outcome.status).toBe('completed');
    expect(outcome.summary).toContain('without waiting for the LandPortal subject capture');
    // The capture is still running and lands its evidence afterwards.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(captureFinished).toBe(true);
    // The one promotion is beforeResolve inside the capability. Late completion
    // is retained for a later invocation and never mutates this released run.
    expect(capabilityPromotions).toBe(1);
  });
});
