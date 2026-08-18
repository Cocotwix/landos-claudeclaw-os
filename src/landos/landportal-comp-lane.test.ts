// LandPortal is the PRIMARY comparable lane.
//
// Live finding on Deal 32: the report path passed `landPortalBrowser: undefined`,
// so the parcel page was never read, no comparable rows were ever persisted, and
// the comp policy silently ran its "LandPortal empty" branch on every card. The
// lane now reads the authenticated parcel page itself and consumes LandPortal's
// STRUCTURED rows (status, sale/list indicator, improvement, distance) rather
// than re-parsing raw text.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { _initTestLandosDb } from './db.js';
import { createDealCard } from './deal-card.js';
import { upsertPropertyCard, savePropertyInspection, loadPropertyInspection, getPropertyCardRow } from './property-card.js';
import { linkPropertyToDeal } from './deal-card.js';
import { collectComparables, collectParcelIdentity } from './property-intelligence-live.js';
import { applyCompSourcePolicy } from './comp-source-policy.js';
import { addComp, listComps } from './comps.js';
import type { MissionContext } from './property-intelligence-collector-types.js';

function seedCard(): { dealCardId: number; cardId: number } {
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'LandPortal comp lane' });
  const { card } = upsertPropertyCard({
    entity: 'TY_LAND_BIZ',
    activeInputAddress: 'OLD RIDGE RD',
    county: 'Roane',
    state: 'TN',
    apn: '073090 04200',
    owner: 'SACHAN DILEEP S',
    acres: 12.28,
    verified: true,
    verificationSource: 'Tennessee Comptroller public parcel layer',
    agentId: 'test',
  } as Parameters<typeof upsertPropertyCard>[0]);
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' } as Parameters<typeof linkPropertyToDeal>[0]);
  return { dealCardId: deal.id, cardId: card.id };
}

function context(dealCardId: number): MissionContext {
  return {
    dealCardId,
    runId: 'pi_test',
    identity: {
      capabilityResolution: 'RESOLVED', capabilityInvocationId: 'cap-test',
      identity: {
        state: 'confirmed', normalizedAddress: 'OLD RIDGE RD', county: 'Roane', state_: 'TN',
        apn: '073090 04200', apnVariants: ['073090 04200'], owner: 'SACHAN DILEEP S', ownerMailing: null,
        situs: 'OLD RIDGE RD', acres: 12.28, acreageBasis: 'deeded', coordinates: null,
        hasParcelGeometry: false, sourceConfidence: 'high', conflicts: [], explanation: 'Confirmed.',
      },
      facts: [],
      subjectMarket: { state: 'TN', county: 'Roane', acres: 12.28 },
      subjectAcres: 12.28,
      acreageConflict: false,
    },
    comparables: null,
  };
}

const SOLD_ROW = {
  rawText: '$62,000 Acres: 10.5 · 120 Ridge Rd, Kingston, TN 37763',
  sourceUrl: 'https://landportal.test/comp/1',
  address: '120 Ridge Rd, Kingston, TN 37763',
  apn: '073090 04100',
  saleDate: '2025-03-14',
  acres: 10.5,
  price: 62_000,
  pricePerAcre: 5905,
  distanceMiles: 1.4,
  status: 'sold' as const,
  saleListIndicator: 'sale' as const,
  improvement: 'vacant' as const,
  confidence: 'high' as const,
  // Rows carry the capture generation that produced them. An unstamped row
  // predates the two-surface read and is deliberately NOT treated as usable.
  capturedAtIso: '2026-07-27T12:00:00.000Z',
};

const ACTIVE_ROW = {
  ...SOLD_ROW,
  rawText: '$79,900 Acres: 11.0 · 300 Ridge Rd, Kingston, TN 37763',
  sourceUrl: 'https://landportal.test/comp/2',
  address: '300 Ridge Rd, Kingston, TN 37763',
  price: 79_900,
  acres: 11,
  status: 'active' as const,
  saleListIndicator: 'list' as const,
};

const IMPROVED_ROW = {
  ...SOLD_ROW,
  rawText: '$210,000 Acres: 9.8 · 500 Ridge Rd, Kingston, TN 37763',
  sourceUrl: 'https://landportal.test/comp/3',
  address: '500 Ridge Rd, Kingston, TN 37763',
  price: 210_000,
  acres: 9.8,
  improvement: 'improved' as const,
};

beforeEach(() => { _initTestLandosDb(); });

describe('LandPortal primary comparable lane', () => {
  it('starts LandPortal subject capture and the public-source refresh concurrently', async () => {
    const { dealCardId } = seedCard();
    let releaseCapture!: () => void;
    let releasePublic!: () => void;
    const captureGate = new Promise<void>((resolve) => { releaseCapture = resolve; });
    const publicGate = new Promise<void>((resolve) => { releasePublic = resolve; });
    let captureStarted = false;
    let publicStarted = false;

    const pending = collectParcelIdentity(context(dealCardId), {
      captureLandPortalInspection: async () => {
        captureStarted = true;
        await captureGate;
        return { ok: true, note: 'captured', comparableCount: 0 };
      },
      runPublicIntelligence: async () => {
        publicStarted = true;
        await publicGate;
        return { ok: true };
      },
    });

    await vi.waitFor(() => {
      expect(captureStarted).toBe(true);
      expect(publicStarted).toBe(true);
    });
    releaseCapture();
    releasePublic();
    await expect(pending).resolves.toMatchObject({ status: 'completed' });
  });

  it('starts LandPortal, Zillow, and Redfin comp retrieval together after identity', async () => {
    const { dealCardId } = seedCard();
    let releaseLandPortal!: () => void;
    let releaseZillow!: () => void;
    let releaseRedfin!: () => void;
    const landPortalGate = new Promise<void>((resolve) => { releaseLandPortal = resolve; });
    const zillowGate = new Promise<void>((resolve) => { releaseZillow = resolve; });
    const redfinGate = new Promise<void>((resolve) => { releaseRedfin = resolve; });
    let landPortalStarted = false;
    let zillowStarted = false;
    let redfinStarted = false;

    const pending = collectComparables(context(dealCardId), {
      runPublicIntelligence: async () => ({ ok: true }),
      captureLandPortalInspection: async () => {
        landPortalStarted = true;
        await landPortalGate;
        return { ok: true, note: 'captured', comparableCount: 0 };
      },
      captureZillowComps: async () => {
        zillowStarted = true;
        await zillowGate;
        return { status: 'none', note: 'no Zillow rows', sold: [], active: [] };
      },
      captureRedfinComps: async () => {
        redfinStarted = true;
        await redfinGate;
        return { status: 'none', note: 'no Redfin rows', sold: [], active: [] };
      },
    });

    await vi.waitFor(() => {
      expect(landPortalStarted).toBe(true);
      expect(zillowStarted).toBe(true);
      expect(redfinStarted).toBe(true);
    });
    releaseLandPortal();
    releaseZillow();
    releaseRedfin();
    await expect(pending).resolves.toMatchObject({ status: 'partial' });
  });

  it('hands back an established identity when the independent public refresh exceeds its wait window', async () => {
    const { dealCardId } = seedCard();
    const outcome = await collectParcelIdentity(context(dealCardId), {
      publicRefreshWaitMs: 5,
      captureLandPortalInspection: async () => ({ ok: true, note: 'captured', comparableCount: 0 }),
      runPublicIntelligence: () => new Promise(() => {}),
    });
    expect(outcome.status).toBe('completed');
    expect(outcome.data?.identity.explanation).toContain('Confirmed');
  });

  it('hands back retained identity without blocking on an authenticated LandPortal capture that never lands', async () => {
    const { dealCardId } = seedCard();
    const outcome = await collectParcelIdentity(context(dealCardId), {
      landPortalCaptureWaitMs: 5,
      publicRefreshWaitMs: 5,
      captureLandPortalInspection: () => new Promise(() => {}),
      runPublicIntelligence: async () => ({ ok: true }),
    });
    expect(outcome.status).toBe('completed');
    // The subject here is ALREADY confirmed, so Universal Property Resolution
    // releases on the retained canonical record immediately and the capture is
    // still in flight when the handback is written. That is reported as what it
    // is — released early — rather than as an overrun the capture has not yet
    // committed: at the moment this line is written the window has not expired.
    expect(outcome.data?.identity.explanation).toContain('continues independently');
  });

  // ── The cold-lead identity race (cards 75, 76 and 77) ────────────────────
  // The handoff window was 90s while a COLD parcel lookup — one searching from a
  // bare street address with no APN, county or ZIP — routinely costs more. Card
  // 77 (5170 Hwy 60) resolved its parcel at 220s: complete, correct, and 130s
  // after the run had already recorded the subject as unresolved and gated off
  // every screening lane. Three consecutive single-run leads died this way.
  //
  // These two tests pin the boundary from both sides so the window can never be
  // quietly returned to a value below what the work actually costs.
  it('does not abandon a cold LandPortal capture that runs longer than the old 90-second ceiling', async () => {
    vi.useFakeTimers();
    try {
      const { dealCardId } = seedCard();
      const pending = collectParcelIdentity(context(dealCardId), {
        // No landPortalCaptureWaitMs: this asserts the SHIPPED default.
        captureLandPortalInspection: () => new Promise((resolve) => {
          setTimeout(() => resolve({ ok: true, note: 'captured', comparableCount: 0 }), 220_000);
        }),
        runPublicIntelligence: async () => ({ ok: true }),
      });
      await vi.advanceTimersByTimeAsync(220_001);
      const outcome = await pending;
      expect(outcome.status).toBe('completed');
      expect(outcome.data?.identity.explanation).not.toContain('LandPortal subject capture exceeded');
    } finally {
      vi.useRealTimers();
    }
  });

  // The other side of the boundary. Shrinking the window back down must not
  // reintroduce blocking: once the subject is established the handback is
  // written from the retained record, and the configured window no longer gates
  // it either way. A regression that made the run wait on the window again
  // would fail here on the 220-second capture, not merely change the wording.
  it('does not let a small configured window gate the handback once the subject is established', async () => {
    vi.useFakeTimers();
    try {
      const { dealCardId } = seedCard();
      const pending = collectParcelIdentity(context(dealCardId), {
        landPortalCaptureWaitMs: 90_000,
        captureLandPortalInspection: () => new Promise((resolve) => {
          setTimeout(() => resolve({ ok: true, note: 'captured', comparableCount: 0 }), 220_000);
        }),
        runPublicIntelligence: async () => ({ ok: true }),
      });
      await vi.advanceTimersByTimeAsync(220_001);
      const outcome = await pending;
      expect(outcome.status).toBe('completed');
      expect(outcome.data?.identity.explanation).toContain('without waiting for the LandPortal subject capture');
    } finally {
      vi.useRealTimers();
    }
  });

  // The straggler's evidence must not be stranded. When a capture DOES overrun,
  // whatever parcel identity it eventually lands is reconciled onto the property
  // card every research lane reads from — the step whose absence left card 77
  // with a fully retrieved APN, FIPS, county and acreage that no lane could see.
  it('retains a late capture without silently replacing the released subject', async () => {
    // Reconciliation cross-checks jurisdiction against the federal address file.
    // That is correct in production and wrong in a test, so the lookup is failed
    // fast here: the promotion under test comes from the provider's own
    // canonical parcel key, which is exactly the offline path this must prove.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error('network disabled in test'))) as typeof fetch;
    try {
    const { dealCardId, cardId } = seedCard();
    // A cold lead: no jurisdiction and no parcel identifier on the card.
    upsertPropertyCard({
      entity: 'TY_LAND_BIZ', cardId, activeInputAddress: '5170 Hwy 60',
      apn: '', county: '', state: 'TN', agentId: 'test',
    } as Parameters<typeof upsertPropertyCard>[0]);

    // The canonical LandPortal parcel key, exactly as the live capture returns
    // it: base64 of `fips=…&apn=…&propertyid=…`.
    const token = Buffer.from('fips=47065&apn=023+003.02&propertyid=172954755').toString('base64');
    let releaseCapture: () => void = () => {};
    const captureGate = new Promise<void>((resolve) => { releaseCapture = resolve; });

    const outcome = await collectParcelIdentity(context(dealCardId), {
      landPortalCaptureWaitMs: 5,
      publicRefreshWaitMs: 5,
      captureLandPortalInspection: async () => {
        await captureGate;
        savePropertyInspection(cardId, {
          parcelUrl: `https://landportal.com/?property=${token}`,
          parcelUrlRecord: {
            url: `https://landportal.com/?property=${token}`,
            source: 'test', capturedAt: new Date().toISOString(),
            propertyCardId: cardId, dealCardId, verifiedSubject: true,
            apn: '023 003.02', fips: '47065', propertyId: '172954755',
          },
          comparablesUrl: null,
          parcelFacts: { 'Parcel ID': '023 003.02', 'Owner Name': 'CAMERON NATHANIEL JOSEPH', Acres: '40.500' },
          assets: [], overlays: [], visualObservations: [], comparables: [],
        } as Parameters<typeof savePropertyInspection>[1]);
        return { ok: true, note: 'captured late', comparableCount: 0 };
      },
      runPublicIntelligence: async () => ({ ok: true }),
    });
    // The run handed back on the retained identity, as it must, and said so.
    expect(outcome.status).toBe('completed');

    // Now the straggler lands. Its identity is reconciled onto the card without
    // any further operator action or rerun.
    releaseCapture();
    await vi.waitFor(() => {
      expect(loadPropertyInspection(cardId)?.parcelUrlRecord?.verifiedSubject).toBe(true);
    }, { timeout: 5000 });
    expect(getPropertyCardRow(cardId)!.apn).toBe('073090 04200');
    expect(getPropertyCardRow(cardId)!.fips).toBe('');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('preserves historical disabled-provider rows in SQLite but never emits them in the current handback', async () => {
    const { dealCardId, cardId } = seedCard();
    addComp({
      entity: 'TY_LAND_BIZ', dealCardId, cardId, sourceLabel: 'Other',
      canonicalSource: 'Realie.ai', addressDesc: '1 Legacy Rd', state: 'TN',
      price: 80_000, priceKind: 'sale', acres: 10, propertyClass: 'vacant_land',
    });
    addComp({
      entity: 'TY_LAND_BIZ', dealCardId, cardId, sourceLabel: 'Zillow',
      canonicalSource: 'Zillow', addressDesc: '2 Current Rd, Kingston, TN 37763', state: 'TN',
      price: 90_000, priceKind: 'sale', acres: 11, propertyClass: 'vacant_land',
    });

    const outcome = await collectComparables(context(dealCardId), { runPublicIntelligence: async () => ({ ok: true }) });
    expect(listComps({ dealCardId }).map((row) => row.canonical_source)).toContain('Realie.ai');
    expect(outcome.data!.candidates.map((candidate) => candidate.provider)).toContain('Zillow');
    expect(outcome.data!.candidates.some((candidate) => /realie|homeharvest|realtor/i.test(candidate.provider))).toBe(false);
    expect(outcome.summary).not.toMatch(/realie|homeharvest|realtor/i);
  });

  it('reads the parcel page when no comparable rows are persisted yet', async () => {
    const { dealCardId, cardId } = seedCard();
    const seen: Array<{ cardId: number; searchKey: { apn: string | null } }> = [];
    const capture = vi.fn(async (input: { cardId: number; searchKey: { apn: string | null } }) => {
      seen.push(input);
      savePropertyInspection(cardId, {
        parcelUrl: 'https://landportal.test/parcel/073090-04200',
        comparablesUrl: null, parcelFacts: {}, assets: [], overlays: [], visualObservations: [],
        comparables: [SOLD_ROW], sources: [], evidence: [], discoveryQuestions: [], missingInformation: [],
      });
      return { ok: true, note: 'LandPortal inspection captured.', comparableCount: 1 };
    });

    const outcome = await collectComparables(context(dealCardId), {
      runPublicIntelligence: async () => ({ ok: true }),
      captureLandPortalInspection: capture,
    });

    expect(capture).toHaveBeenCalledTimes(1);
    expect(seen[0].searchKey.apn).toBe('073090 04200');
    const landPortal = outcome.data!.candidates.filter((c) => /landportal/i.test(c.provider));
    expect(landPortal).toHaveLength(1);
    expect(outcome.summary).toMatch(/paid comp report was never requested/);
  });

  it('does not re-read the parcel page when rows are already persisted', async () => {
    const { dealCardId, cardId } = seedCard();
    savePropertyInspection(cardId, {
      parcelUrl: 'https://landportal.test/parcel/1', comparablesUrl: null, parcelFacts: {}, assets: [],
      overlays: [], visualObservations: [], comparables: [SOLD_ROW], sources: [], evidence: [],
      discoveryQuestions: [], missingInformation: [],
    });
    const capture = vi.fn(async () => ({ ok: true, note: 'should not run', comparableCount: 0 }));
    await collectComparables(context(dealCardId), {
      runPublicIntelligence: async () => ({ ok: true }),
      captureLandPortalInspection: capture,
    });
    expect(capture).not.toHaveBeenCalled();
  });

  it('DOES re-read when the retained rows predate the two-surface capture', async () => {
    // A pre-fix row states a status but carries no capture generation, no comp-
    // page enrichment and no status source. Treating it as usable satisfied the
    // very gate that would refresh it, so superseded rows stayed in front of the
    // operator indefinitely. One re-read per card retires them.
    const { dealCardId, cardId } = seedCard();
    const { capturedAtIso, ...unstamped } = SOLD_ROW;
    void capturedAtIso;
    savePropertyInspection(cardId, {
      parcelUrl: 'https://landportal.test/parcel/1', comparablesUrl: null, parcelFacts: {}, assets: [],
      overlays: [], visualObservations: [], comparables: [unstamped], sources: [], evidence: [],
      discoveryQuestions: [], missingInformation: [],
    });
    const capture = vi.fn(async () => ({ ok: true, note: 're-read', comparableCount: 0 }));
    await collectComparables(context(dealCardId), {
      runPublicIntelligence: async () => ({ ok: true }),
      captureLandPortalInspection: capture,
    });
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('makes LandPortal the primary basis and routes its rows by structured status', async () => {
    const { dealCardId, cardId } = seedCard();
    savePropertyInspection(cardId, {
      parcelUrl: 'https://landportal.test/parcel/1', comparablesUrl: null, parcelFacts: {}, assets: [],
      overlays: [], visualObservations: [], comparables: [SOLD_ROW, ACTIVE_ROW, IMPROVED_ROW],
      sources: [], evidence: [], discoveryQuestions: [], missingInformation: [],
    });
    const outcome = await collectComparables(context(dealCardId), { runPublicIntelligence: async () => ({ ok: true }) });
    const policy = applyCompSourcePolicy({ state: 'TN', county: 'Roane', acres: 12.28 }, outcome.data!.candidates);

    expect(policy.plan.landPortalUsable).toBe(true);
    expect(policy.plan.caps).toEqual({ zillow: 5, redfin: 5 });
    // The vacant closed sale prices the subject; the listing is competition; the
    // improved row is held for Land-Home only.
    expect(policy.acceptedSold.map((d) => d.candidate.addressDesc)).toEqual(['120 Ridge Rd, Kingston, TN 37763']);
    expect(policy.acceptedSold[0].role).toBe('primary');
    expect(policy.acceptedActive.map((d) => d.candidate.addressDesc)).toEqual(['300 Ridge Rd, Kingston, TN 37763']);
    expect(policy.landHomeOnly.map((d) => d.candidate.addressDesc)).toEqual(['500 Ridge Rd, Kingston, TN 37763']);
  });

  it('repairs a retained material-building row into the Land-Home lane', async () => {
    const { dealCardId, cardId } = seedCard();
    savePropertyInspection(cardId, {
      parcelUrl: 'https://landportal.test/parcel/1', comparablesUrl: null, parcelFacts: {}, assets: [],
      overlays: [], visualObservations: [], comparables: [{
        ...SOLD_ROW,
        apn: '4099-05-18-8064',
        address: '526 Country Club Rd',
        acres: 67.27,
        price: 685_000,
        buildingSqft: 2052,
        improvement: 'vacant' as const,
      }],
      sources: [], evidence: [], discoveryQuestions: [], missingInformation: [],
    });
    const outcome = await collectComparables(context(dealCardId), { runPublicIntelligence: async () => ({ ok: true }) });
    const policy = applyCompSourcePolicy({ state: 'TN', county: 'Roane', acres: 12.28 }, outcome.data!.candidates);
    expect(policy.acceptedSold).toHaveLength(0);
    expect(policy.landHomeOnly.map((d) => d.candidate.addressDesc)).toEqual(['526 Country Club Rd']);
  });

  it('carries the structured distance and sale date through to the candidate', async () => {
    const { dealCardId, cardId } = seedCard();
    savePropertyInspection(cardId, {
      parcelUrl: null, comparablesUrl: null, parcelFacts: {}, assets: [], overlays: [], visualObservations: [],
      comparables: [SOLD_ROW], sources: [], evidence: [], discoveryQuestions: [], missingInformation: [],
    });
    const outcome = await collectComparables(context(dealCardId), { runPublicIntelligence: async () => ({ ok: true }) });
    const row = outcome.data!.candidates.find((c) => /landportal/i.test(c.provider))!;
    expect(row.distanceMiles).toBe(1.4);
    expect(row.saleOrListDate).toBe('2025-03-14');
    expect(row.apn).toBe('073090 04100');
    expect(row.sourceUrl).toBe('https://landportal.test/comp/1');
  });

  it('falls back to the raw-text parser when a row loses its structured price', async () => {
    const { dealCardId, cardId } = seedCard();
    savePropertyInspection(cardId, {
      parcelUrl: null, comparablesUrl: null, parcelFacts: {}, assets: [], overlays: [], visualObservations: [],
      comparables: [{ ...SOLD_ROW, price: null, acres: null, pricePerAcre: null }],
      sources: [], evidence: [], discoveryQuestions: [], missingInformation: [],
    });
    const outcome = await collectComparables(context(dealCardId), { runPublicIntelligence: async () => ({ ok: true }) });
    const row = outcome.data!.candidates.find((c) => /landportal/i.test(c.provider))!;
    expect(row.price).toBe(62_000);
    expect(row.acres).toBe(10.5);
  });

  it('reports an unavailable LandPortal session honestly instead of silently widening', async () => {
    const { dealCardId } = seedCard();
    const outcome = await collectComparables(context(dealCardId), {
      runPublicIntelligence: async () => ({ ok: true }),
      captureLandPortalInspection: async () => ({
        ok: false,
        note: 'LandPortal session is not_running (No reachable Chrome on the CDP endpoint). Start Browser Intelligence so the parcel page can be read.',
        comparableCount: 0,
      }),
    });
    expect(outcome.summary).toMatch(/LandPortal primary lane unavailable/);
    expect(outcome.summary).toMatch(/Start Browser Intelligence/);
    expect(outcome.data!.candidates.filter((c) => /landportal/i.test(c.provider))).toHaveLength(0);
  });

  it('says so plainly when no LandPortal reader is wired into the run', async () => {
    const { dealCardId } = seedCard();
    const outcome = await collectComparables(context(dealCardId), { runPublicIntelligence: async () => ({ ok: true }) });
    expect(outcome.summary).toMatch(/no LandPortal reader is wired into this run/);
  });

  it('persists the captured inspection so a rerun reuses it', async () => {
    const { dealCardId, cardId } = seedCard();
    await collectComparables(context(dealCardId), {
      runPublicIntelligence: async () => ({ ok: true }),
      captureLandPortalInspection: async () => {
        savePropertyInspection(cardId, {
          parcelUrl: 'https://landportal.test/parcel/1', comparablesUrl: null, parcelFacts: {}, assets: [],
          overlays: [], visualObservations: [], comparables: [SOLD_ROW], sources: [], evidence: [],
          discoveryQuestions: [], missingInformation: [],
        });
        return { ok: true, note: 'captured', comparableCount: 1 };
      },
    });
    expect((loadPropertyInspection(cardId)?.comparables ?? []).length).toBe(1);
  });
});

// ── Status must never be invented ───────────────────────────────────────────
// Live finding on Deal 32: LandPortal's parcel panel returns rows like
// "$153,500 Acres: 13.10 | APN: 115 02100" with no sale/list word. The extractor
// stamped them 'listed', which is a FABRICATED listing status — and that status
// alone decides whether a row prices the subject or merely competes with it.

const UNSTATED_ROW = {
  rawText: '$153,500 Acres: 13.10 | APN: 115 02100',
  sourceUrl: 'https://landportal.test/parcel/1',
  address: null,
  apn: '115 02100',
  acres: 13.1,
  price: 153_500,
  pricePerAcre: 11_718,
  distanceMiles: null,
  status: 'unknown' as const,
  saleListIndicator: 'unknown' as const,
  improvement: 'unknown' as const,
  confidence: 'medium' as const,
};

describe('a LandPortal row with no stated transaction type', () => {
  it('never prices the subject and never counts as competition', async () => {
    const { dealCardId, cardId } = seedCard();
    savePropertyInspection(cardId, {
      parcelUrl: 'https://landportal.test/parcel/1', comparablesUrl: null, parcelFacts: {}, assets: [],
      overlays: [], visualObservations: [], comparables: [UNSTATED_ROW], sources: [], evidence: [],
      discoveryQuestions: [], missingInformation: [],
    });
    const outcome = await collectComparables(context(dealCardId), { runPublicIntelligence: async () => ({ ok: true }) });
    const policy = applyCompSourcePolicy({ state: 'TN', county: 'Roane', acres: 12.28 }, outcome.data!.candidates);

    expect(policy.acceptedSold).toHaveLength(0);
    expect(policy.acceptedActive).toHaveLength(0);
    expect(policy.plan.landPortalUsable).toBe(false);
    const decision = policy.decisions.find((d) => d.family === 'landportal')!;
    expect(decision.role).toBe('context_only');
    expect(decision.fmvEligible).toBe(false);
    expect(decision.reason).toMatch(/never says whether it is a closed sale or an asking price/);
  });

  it('counts the unstated rows in the operator-visible summary', async () => {
    const { dealCardId, cardId } = seedCard();
    savePropertyInspection(cardId, {
      parcelUrl: 'https://landportal.test/parcel/1', comparablesUrl: null, parcelFacts: {}, assets: [],
      overlays: [], visualObservations: [], comparables: [UNSTATED_ROW, { ...UNSTATED_ROW, rawText: '$84,500 Acres: 9.61 | APN: 071 03100', apn: '071 03100', price: 84_500, acres: 9.61 }], sources: [], evidence: [],
      discoveryQuestions: [], missingInformation: [],
    });
    const outcome = await collectComparables(context(dealCardId), { runPublicIntelligence: async () => ({ ok: true }) });
    expect(outcome.summary).toMatch(/2 row\(s\) carry a price and acreage but no sale-or-listing status anywhere on either surface/);
    // Both surfaces are always accounted for, even when one returns nothing.
    expect(outcome.summary).toMatch(/Parcel sidebar returned 2 row\(s\)/);
    expect(outcome.summary).toMatch(/"Show on Map" expanded view returned 0 row\(s\)/);
  });

  it('still accepts a row once LandPortal states it is a closed sale', async () => {
    const { dealCardId, cardId } = seedCard();
    savePropertyInspection(cardId, {
      parcelUrl: 'https://landportal.test/parcel/1', comparablesUrl: null, parcelFacts: {}, assets: [],
      overlays: [], visualObservations: [], comparables: [{ ...UNSTATED_ROW, status: 'sold' as const, saleListIndicator: 'sale' as const, improvement: 'vacant' as const }],
      sources: [], evidence: [], discoveryQuestions: [], missingInformation: [],
    });
    const outcome = await collectComparables(context(dealCardId), { runPublicIntelligence: async () => ({ ok: true }) });
    const policy = applyCompSourcePolicy({ state: 'TN', county: 'Roane', acres: 12.28 }, outcome.data!.candidates);
    expect(policy.acceptedSold).toHaveLength(1);
    expect(policy.acceptedSold[0].role).toBe('primary');
  });
});

describe('stale LandPortal rows are re-read, not trusted forever', () => {
  it('re-reads the parcel page when every retained row lacks a stated status', async () => {
    const { dealCardId, cardId } = seedCard();
    savePropertyInspection(cardId, {
      parcelUrl: 'https://landportal.test/parcel/1', comparablesUrl: null, parcelFacts: {}, assets: [],
      overlays: [], visualObservations: [], comparables: [UNSTATED_ROW], sources: [], evidence: [],
      discoveryQuestions: [], missingInformation: [],
    });
    const capture = vi.fn(async () => ({ ok: true, note: 're-read', comparableCount: 0 }));
    await collectComparables(context(dealCardId), {
      runPublicIntelligence: async () => ({ ok: true }),
      captureLandPortalInspection: capture,
    });
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('does not re-read once at least one row states a usable status', async () => {
    const { dealCardId, cardId } = seedCard();
    savePropertyInspection(cardId, {
      parcelUrl: 'https://landportal.test/parcel/1', comparablesUrl: null, parcelFacts: {}, assets: [],
      overlays: [], visualObservations: [], comparables: [UNSTATED_ROW, SOLD_ROW], sources: [], evidence: [],
      discoveryQuestions: [], missingInformation: [],
    });
    const capture = vi.fn(async () => ({ ok: true, note: 'should not run', comparableCount: 0 }));
    await collectComparables(context(dealCardId), {
      runPublicIntelligence: async () => ({ ok: true }),
      captureLandPortalInspection: capture,
    });
    expect(capture).not.toHaveBeenCalled();
  });
});
