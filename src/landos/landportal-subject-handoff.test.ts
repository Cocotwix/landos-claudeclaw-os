// The identity lane's input is the parcel's own facts, which the direct
// LandPortal API path returns in seconds. It used to wait for the ENTIRE
// capture — imagery, overlays, 3D, county deep record — and reported a
// 300-second handoff timeout for data it had been holding since second 36.
//
// The lane now settles on whichever comes first: the early subject handoff or
// the full capture. The capture itself is unchanged and keeps running.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { _initTestLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { upsertPropertyCard } from './property-card.js';
import { collectParcelIdentity } from './property-intelligence-live.js';
import type { MissionContext } from './property-intelligence-collector-types.js';

function seedCard(): number {
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'LandPortal subject handoff' });
  const { card } = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: '5170 HIGHWAY 60',
    county: 'Hamilton',
    state: 'TN',
    apn: '023 003.02',
    owner: 'CAMERON NATHANIEL JOSEPH',
    acres: 40.5,
    verified: true,
    verificationSource: 'test',
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

  it('still waits for the whole capture when no early handoff is made', async () => {
    const dealCardId = seedCard();
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
    }).then((outcome) => { settled = true; return outcome; });

    // Nothing handed the subject over, so the lane is still waiting.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(settled).toBe(false);
    releaseCapture();
    await expect(pending).resolves.toMatchObject({ status: 'completed' });
    expect(captureFinished).toBe(true);
  });
});
