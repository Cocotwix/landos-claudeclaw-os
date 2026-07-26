import { beforeEach, describe, expect, it, vi } from 'vitest';

import { _initTestLandosDb } from './db.js';
import { PropertyIntelligenceStore, resetPropertyIntelligenceStoreCache } from './property-intelligence-store.js';
import {
  launchPropertyIntelligenceMission,
  runPropertyIntelligenceMission,
  type PropertyIntelligenceCollectors,
  type SpecialistOutcome,
} from './property-intelligence-mission.js';
import type { SnapshotIdentity } from './property-intelligence-snapshot.js';
import type { CompRegistryCandidate } from './comp-registry.js';

const CONFIRMED: SnapshotIdentity = {
  state: 'confirmed',
  normalizedAddress: 'OLD RIDGE RD, Roane County, TN',
  county: 'Roane',
  state_: 'TN',
  apn: '073090 04200',
  apnVariants: ['073090 04200', '073-090-042.00'],
  owner: 'SACHAN DILEEP S',
  ownerMailing: null,
  situs: 'OLD RIDGE RD',
  acres: 12.28,
  acreageBasis: 'deeded',
  coordinates: { lat: 35.9, lng: -84.5 },
  hasParcelGeometry: true,
  sourceConfidence: 'high',
  conflicts: [],
  explanation: 'Confirmed on the official Tennessee Comptroller parcel layer.',
};

function ok<T>(data: T, summary = 'ok'): SpecialistOutcome<T> {
  return { status: 'completed', summary, data };
}

function landComp(i: number, overrides: Partial<CompRegistryCandidate> = {}): CompRegistryCandidate {
  return {
    provider: 'LandPortal visible',
    lane: 'sold',
    addressDesc: `${i} Ridge Rd, Kingston, TN 37763`,
    state: 'TN',
    price: 48_000 + i * 3_000,
    priceKind: 'sold',
    saleOrListDate: '2025-04-01',
    acres: 11,
    sourceUrl: `https://landportal.test/${i}`,
    compClass: 'vacant_land',
    ...overrides,
  } as CompRegistryCandidate;
}

function collectors(overrides: Partial<PropertyIntelligenceCollectors> = {}): PropertyIntelligenceCollectors {
  return {
    parcel_identity: async () => ok({
      identity: CONFIRMED,
      facts: [{ key: 'owner', label: 'Owner', value: 'SACHAN DILEEP S', grade: 'confirmed_fact', source: 'TN Comptroller', sourceUrl: 'https://tn.test/1', retrievedAt: '2026-07-25T00:00:00.000Z', note: null }],
      subjectMarket: { state: 'TN', county: 'Roane', acres: 12.28 },
      subjectAcres: 12.28,
      acreageConflict: false,
    }, 'Parcel confirmed on the official layer.'),
    government_records: async () => ok({
      records: [{ key: 'deed', label: 'Deed reference', value: 'Book 1 Page 2', grade: 'confirmed_fact', source: 'Roane Register', sourceUrl: 'https://roane.test/deed', retrievedAt: '2026-07-25T00:00:00.000Z', note: null }],
    }, 'Deed, tax and assessor evidence retained.'),
    zoning_land_use: async () => ok({
      zoning: 'A-1 Agricultural',
      zoningKnown: true,
      items: [{ key: 'zoning', label: 'Zoning', verdict: 'good', headline: 'A-1 Agricultural.', grade: 'likely_indication', detail: null, sourceUrl: null, missing: [] }],
      facts: [],
    }, 'Zoning established.'),
    environmental_terrain: async () => ok({
      items: [
        { key: 'flood', label: 'Floodplain', verdict: 'good', headline: 'No mapped SFHA overlap.', grade: 'likely_indication', detail: null, sourceUrl: null, missing: [] },
        { key: 'wetlands', label: 'Wetlands', verdict: 'good', headline: 'No mapped NWI wetland.', grade: 'likely_indication', detail: null, sourceUrl: null, missing: [] },
        { key: 'septic', label: 'Soils and septic', verdict: 'good', headline: 'Favorable outlook.', grade: 'likely_indication', detail: null, sourceUrl: null, missing: [] },
      ],
      constraints: [],
    }, 'Environmental screening complete.'),
    access_utilities: async () => ok({
      items: [{ key: 'access', label: 'Access', verdict: 'good', headline: 'Mapped public road contact.', grade: 'likely_indication', detail: null, sourceUrl: null, missing: [] }],
      accessStatus: 'public_road_proximity',
      utilitiesKnown: true,
      utilitiesSummary: 'Electric at the road.',
    }, 'Access and utilities established.'),
    comparables: async () => ok({
      candidates: [landComp(1), landComp(2), landComp(3), landComp(4)],
      duplicatesMerged: 0,
    }, 'Four LandPortal closed sales retained.'),
    market_intelligence: async () => ok({ facts: [], summary: 'Market context assembled.' }, 'Market context assembled.'),
    evidence_visuals: async () => ({
      status: 'completed',
      summary: 'Two visuals retained.',
      data: { evidence: [] },
      evidence: [
        { id: 'shot-1', kind: 'screenshot', label: 'LandPortal parcel', sourceType: 'landportal', sourceUrl: 'https://landportal.test/p', viewUrl: '/api/landos/deal-cards/32/visual/shot-1', retrievedAt: '2026-07-25T00:00:00.000Z', confidence: 'high', supports: 'identity', sha256: 'abc', bytes: 1000 },
        { id: 'map-1', kind: 'map', label: 'Comp map', sourceType: 'derived', sourceUrl: null, viewUrl: '/api/landos/deal-cards/32/comp-map', retrievedAt: '2026-07-25T00:00:00.000Z', confidence: 'medium', supports: 'comps', sha256: null, bytes: null },
      ],
    }),
    ...overrides,
  };
}

beforeEach(() => {
  _initTestLandosDb();
  resetPropertyIntelligenceStoreCache();
});

describe('Property Intelligence parent mission', () => {
  it('runs one coordinated mission that joins every specialist into one snapshot', async () => {
    const store = new PropertyIntelligenceStore();
    const snapshot = await runPropertyIntelligenceMission({ dealCardId: 32, collectors: collectors(), store });

    expect(snapshot).toBeTruthy();
    expect(snapshot!.status).toBe('complete');
    expect(snapshot!.specialists).toHaveLength(10);
    expect(snapshot!.specialists.every((s) => s.status === 'completed')).toBe(true);
    expect(snapshot!.identity.state).toBe('confirmed');
    expect(snapshot!.governmentRecords).toHaveLength(1);
    expect(snapshot!.comps.sold.length).toBeGreaterThan(0);
    expect(snapshot!.strategies).toHaveLength(5);
    expect(snapshot!.recommendation.preferredStrategy).toBeTruthy();
    expect(snapshot!.evidence).toHaveLength(2);
    expect(snapshot!.valuation.priceable).toBe(true);

    // Persisted to the correct Deal Card and primary.
    const primary = store.primaryRun(32)!;
    expect(primary.runId).toBe(snapshot!.runId);
    expect(primary.snapshot?.identity.apn).toBe('073090 04200');
    expect(store.primaryRun(33)).toBeNull();
  });

  it('records live specialist progress while the mission runs', async () => {
    const store = new PropertyIntelligenceStore();
    const seen: Array<{ id: string; status: string }> = [];
    await runPropertyIntelligenceMission({
      dealCardId: 4,
      collectors: collectors(),
      store,
      onProgress: (record) => seen.push({ id: record.id, status: record.status }),
    });
    expect(seen.some((s) => s.id === 'parcel_identity' && s.status === 'running')).toBe(true);
    expect(seen.some((s) => s.id === 'comparables' && s.status === 'completed')).toBe(true);
    expect(seen.some((s) => s.id === 'synthesis_review' && s.status === 'completed')).toBe(true);
  });

  it('never starts a second mission for a Deal Card already running', () => {
    const store = new PropertyIntelligenceStore();
    const slow = collectors({ parcel_identity: () => new Promise(() => {}) as never });
    const first = launchPropertyIntelligenceMission({ dealCardId: 12, collectors: slow, store });
    const second = launchPropertyIntelligenceMission({ dealCardId: 12, collectors: slow, store });
    expect(second.launch.alreadyRunning).toBe(true);
    expect(second.launch.runId).toBe(first.launch.runId);
  });

  it('survives a partial specialist failure without fabricating completeness', async () => {
    const store = new PropertyIntelligenceStore();
    const snapshot = await runPropertyIntelligenceMission({
      dealCardId: 55,
      store,
      collectors: collectors({
        government_records: async () => { throw new Error('503 Service Unavailable from the county record host'); },
      }),
    });
    expect(snapshot!.status).toBe('complete_with_gaps');
    const gov = snapshot!.specialists.find((s) => s.id === 'government_records')!;
    expect(gov.status).toBe('failed');
    expect(gov.failureCategory).toBe('provider_unavailable');
    expect(snapshot!.missingInformation.join(' ')).toMatch(/Government records: failed/);
    const review = snapshot!.specialists.find((s) => s.id === 'synthesis_review')!;
    expect(review.status).toBe('partial');
    expect(review.summary).toMatch(/Government records/);
    // The rest of the mission still produced results.
    expect(snapshot!.valuation.priceable).toBe(true);
  });

  it('distinguishes an authentication failure from a provider outage', async () => {
    const store = new PropertyIntelligenceStore();
    const snapshot = await runPropertyIntelligenceMission({
      dealCardId: 56,
      store,
      collectors: collectors({
        comparables: async () => { throw new Error('401 Unauthorized: the LandPortal session has expired'); },
      }),
    });
    const comps = snapshot!.specialists.find((s) => s.id === 'comparables')!;
    expect(comps.failureCategory).toBe('auth');
    expect(comps.retryable).toBe(false);
    expect(snapshot!.nextActions.join(' ')).toMatch(/needs operator action/);
  });

  it('classifies a specialist timeout separately from a crash', async () => {
    vi.useFakeTimers();
    try {
      const store = new PropertyIntelligenceStore();
      const promise = runPropertyIntelligenceMission({
        dealCardId: 57,
        store,
        timeoutMsOverride: 50,
        collectors: collectors({ market_intelligence: () => new Promise(() => {}) as never }),
      });
      await vi.advanceTimersByTimeAsync(500);
      const snapshot = await promise;
      const market = snapshot!.specialists.find((s) => s.id === 'market_intelligence')!;
      expect(market.status).toBe('failed');
      expect(market.failureCategory).toBe('timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips parcel-specific specialists on an unresolved parcel and refuses to price', async () => {
    const store = new PropertyIntelligenceStore();
    const snapshot = await runPropertyIntelligenceMission({
      dealCardId: 88,
      store,
      collectors: collectors({
        parcel_identity: async () => ok({
          identity: { ...CONFIRMED, state: 'unresolved', apn: null, conflicts: [], explanation: 'No official parcel record matched the intake address.' },
          facts: [],
          subjectMarket: { state: 'TN', county: 'Roane' },
          subjectAcres: null,
          acreageConflict: false,
        }, 'No official parcel matched.'),
      }),
    });
    expect(snapshot!.status).toBe('blocked_identity');
    for (const id of ['government_records', 'zoning_land_use', 'environmental_terrain', 'access_utilities']) {
      const record = snapshot!.specialists.find((s) => s.id === id)!;
      expect(record.status).toBe('skipped');
      expect(record.summary).toMatch(/parcel identity is unresolved/);
    }
    expect(snapshot!.valuation.priceable).toBe(false);
    expect(snapshot!.recommendation.preferredStrategy).toBeNull();
    expect(snapshot!.headline.confidence).toBe('none');
  });

  it('keeps a genuinely conflicted parcel unresolved and blocked', async () => {
    const store = new PropertyIntelligenceStore();
    const snapshot = await runPropertyIntelligenceMission({
      dealCardId: 89,
      store,
      collectors: collectors({
        parcel_identity: async () => ok({
          identity: {
            ...CONFIRMED,
            state: 'conflicted',
            conflicts: ['Two distinct APNs match this address: 073090 04200 and 041020 01100.'],
            explanation: 'Two official records disagree about the subject parcel.',
          },
          facts: [], subjectMarket: { state: 'TN', county: 'Roane', acres: 12 }, subjectAcres: 12, acreageConflict: false,
        }, 'Conflicting official records.'),
      }),
    });
    expect(snapshot!.status).toBe('blocked_identity');
    expect(snapshot!.blockers.join(' ')).toMatch(/041020 01100/);
    expect(snapshot!.valuation.priceable).toBe(false);
  });

  it('applies the comp source policy: LandPortal primary, capped supplements, no Realie FMV', async () => {
    const store = new PropertyIntelligenceStore();
    const snapshot = await runPropertyIntelligenceMission({
      dealCardId: 90,
      store,
      collectors: collectors({
        comparables: async () => ok({
          candidates: [
            landComp(1), landComp(2),
            ...Array.from({ length: 4 }, (_, i) => landComp(10 + i, { provider: 'Zillow' })),
            ...Array.from({ length: 4 }, (_, i) => landComp(20 + i, { provider: 'Redfin' })),
            landComp(30, { provider: 'Realie' }),
            landComp(31, { provider: 'homeharvest' }),
            landComp(40, { provider: 'Zillow', compClass: 'residential' }),
            landComp(50, { provider: 'Zillow', lane: 'active', priceKind: 'list' }),
          ],
          duplicatesMerged: 1,
        }, 'Mixed provider set.'),
      }),
    });
    const comps = snapshot!.comps;
    expect(comps.landPortalUsable).toBe(true);
    expect(comps.caps).toEqual({ zillow: 2, redfin: 2 });
    expect(comps.sold.filter((c) => /zillow/i.test(c.source))).toHaveLength(2);
    expect(comps.sold.filter((c) => /redfin/i.test(c.source))).toHaveLength(2);
    expect(comps.sold.some((c) => /realie|homeharvest/i.test(c.source))).toBe(false);
    expect(comps.active).toHaveLength(1);
    expect(comps.landHomeOnly).toHaveLength(1);
    expect(comps.rejected.some((r) => /excluded from the accepted vacant-land valuation workflow/.test(r.reason))).toBe(true);
    expect(comps.duplicatesMerged).toBe(1);
  });

  it('refuses to price when no comps survive the policy', async () => {
    const store = new PropertyIntelligenceStore();
    const snapshot = await runPropertyIntelligenceMission({
      dealCardId: 91,
      store,
      collectors: collectors({
        comparables: async () => ({ status: 'partial', summary: 'No usable vacant-land comps were found.', data: { candidates: [], duplicatesMerged: 0 } }),
      }),
    });
    expect(snapshot!.valuation.priceable).toBe(false);
    expect(snapshot!.valuation.range).toBeNull();
    expect(snapshot!.valuation.nextActionToPrice).toBeTruthy();
    expect(snapshot!.recommendation.posture).toBe('hold');
    const valuation = snapshot!.specialists.find((s) => s.id === 'valuation_strategy')!;
    expect(valuation.status).toBe('partial');
    expect(valuation.summary).toMatch(/Not priceable/);
  });

  it('a rerun updates the primary snapshot without duplicating or corrupting the prior one', async () => {
    const store = new PropertyIntelligenceStore();
    const first = await runPropertyIntelligenceMission({ dealCardId: 77, collectors: collectors(), store });
    const second = await runPropertyIntelligenceMission({
      dealCardId: 77,
      store,
      collectors: collectors({
        comparables: async () => ok({ candidates: [landComp(1), landComp(2), landComp(3), landComp(4), landComp(5), landComp(6)], duplicatesMerged: 0 }, 'Six closed sales retained.'),
      }),
    });
    expect(second!.runId).not.toBe(first!.runId);
    expect(second!.sequence).toBe(2);
    expect(store.primaryRun(77)!.runId).toBe(second!.runId);

    const history = store.history(77);
    expect(history).toHaveLength(2);
    expect(history[1].snapshot!.runId).toBe(first!.runId);
    expect(history[1].snapshot!.comps.sold).toHaveLength(4);
    expect(second!.comps.sold).toHaveLength(6);
  });

  it('clears a prior failure after a successful rerun', async () => {
    const store = new PropertyIntelligenceStore();
    const failed = await runPropertyIntelligenceMission({
      dealCardId: 78,
      store,
      collectors: collectors({ government_records: async () => { throw new Error('503 Service Unavailable'); } }),
    });
    expect(failed!.missingInformation.join(' ')).toMatch(/Government records: failed/);

    const healed = await runPropertyIntelligenceMission({ dealCardId: 78, collectors: collectors(), store });
    expect(healed!.status).toBe('complete');
    // The stale failure is gone from the primary read; only genuine evidence
    // gaps remain, and no specialist still reports a failure.
    expect(healed!.missingInformation.join(' ')).not.toMatch(/failed/);
    expect(healed!.specialists.every((s) => s.status === 'completed')).toBe(true);
    expect(store.primaryRun(78)!.snapshot!.missingInformation.join(' ')).not.toMatch(/Government records: failed/);
    expect(store.primaryRun(78)!.snapshot!.runId).toBe(healed!.runId);
  });

  it('does not cross-contaminate another Deal Card', async () => {
    const store = new PropertyIntelligenceStore();
    await runPropertyIntelligenceMission({ dealCardId: 100, collectors: collectors(), store });
    await runPropertyIntelligenceMission({
      dealCardId: 101,
      store,
      collectors: collectors({
        parcel_identity: async () => ok({
          identity: { ...CONFIRMED, apn: '999999 00001', owner: 'OTHER OWNER' },
          facts: [], subjectMarket: { state: 'TN', county: 'Roane', acres: 5 }, subjectAcres: 5, acreageConflict: false,
        }, 'Different parcel.'),
      }),
    });
    expect(store.primaryRun(100)!.snapshot!.identity.apn).toBe('073090 04200');
    expect(store.primaryRun(101)!.snapshot!.identity.apn).toBe('999999 00001');
    expect(store.listSpecialists(store.primaryRun(100)!.runId).every((s) => s.dealCardId === 100)).toBe(true);
  });

  it('records a blocked specialist as blocked rather than failed', async () => {
    const store = new PropertyIntelligenceStore();
    const snapshot = await runPropertyIntelligenceMission({
      dealCardId: 102,
      store,
      collectors: collectors({
        evidence_visuals: async () => ({ status: 'blocked', summary: 'LandPortal screenshots require an authenticated session that is not available.', data: null }),
      }),
    });
    const visuals = snapshot!.specialists.find((s) => s.id === 'evidence_visuals')!;
    expect(visuals.status).toBe('blocked');
    expect(visuals.failureCategory).toBeNull();
    expect(snapshot!.missingInformation.join(' ')).toMatch(/Evidence and visuals: blocked/);
  });
});
