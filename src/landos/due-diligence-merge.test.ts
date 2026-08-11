// An unresolved diligence tile must still be able to improve between runs.
//
// `mergeDueDiligence` protects a resolved finding from being erased by a later
// lane that established nothing. That guard is right, but it also froze
// still-unresolved tiles forever: the zoning item stays `unknown` while the
// district is unread, so no rerun could replace it even when the newer item
// carried the accepted governing authority. That is what kept deal 83's Zoning
// tile reading "No jurisdiction determination has been collected." while the
// specialist was already emitting "Whitewater township administers zoning".

import { describe, expect, it } from 'vitest';

import {
  joinPropertyIntelligence,
  reconcilePropertyIntelligenceSnapshot,
  type PropertyIntelligenceSnapshot,
  type SnapshotDueDiligenceItem,
} from './property-intelligence-snapshot.js';

/** Minimal snapshot for one Deal Card, varying only its diligence items. */
function snapshotWith(dueDiligence: SnapshotDueDiligenceItem[], sequence: number): PropertyIntelligenceSnapshot {
  return joinPropertyIntelligence({
    dealCardId: 83,
    runId: `pi_dd_${sequence}`,
    sequence,
    startedAt: '2026-08-08T00:00:00.000Z',
    completedAt: '2026-08-08T00:05:00.000Z',
    identity: {
      state: 'confirmed',
      normalizedAddress: '9490 Elk Lake Rd',
      county: 'Grand Traverse',
      state_: 'MI',
      apn: '13-116-015-01',
      apnVariants: ['13-116-015-01'],
      owner: 'WELLS MICHAEL C',
      ownerMailing: null,
      situs: '9490 Elk Lake Rd',
      acres: 60,
      acreageBasis: 'assessed',
      coordinates: { lat: 44.8224, lng: -85.4048 },
      hasParcelGeometry: true,
      sourceConfidence: 'high',
      conflicts: [],
      explanation: 'Confirmed.',
    },
    facts: [],
    governmentRecords: [],
    dueDiligence,
    comps: {
      policyExplanation: 'LandPortal primary.',
      landPortalUsable: true,
      landPortalRowsSeen: 0,
      caps: { zillow: 2, redfin: 2 },
      sold: [], active: [], landHomeOnly: [], rejected: [],
      duplicatesMerged: 0,
      summaryLine: '',
    },
    valuation: {
      priceable: false,
      range: null,
      pricePerAcreRange: null,
      likelyRetail: null,
      dispositionRange: null,
      basis: 'No closed sale.',
      adjustments: [],
      confidence: 'low',
      uncertainty: [],
      materialGaps: [],
      notPriceableReason: 'No accepted closed sale.',
      nextActionToPrice: 'Confirm one in-band closed sale.',
    },
    strategies: [],
    recommendation: {
      preferredStrategy: null,
      why: 'Strategy selection is pending valuation evidence.',
      whatWouldChangeIt: [],
      posture: 'hold',
      postureWhy: 'No value basis yet.',
    },
    evidence: [],
    specialists: [],
    extraBlockers: [],
  } as unknown as Parameters<typeof joinPropertyIntelligence>[0]);
}

function zoningItem(over: Partial<SnapshotDueDiligenceItem> = {}): SnapshotDueDiligenceItem {
  return {
    key: 'zoning',
    label: 'Zoning',
    verdict: 'unknown',
    headline: 'Zoning district has not been established.',
    grade: 'unresolved_question',
    detail: 'No jurisdiction determination has been collected.',
    sourceUrl: null,
    missing: [],
    ...over,
  } as SnapshotDueDiligenceItem;
}

const zoningOf = (snapshot: PropertyIntelligenceSnapshot) =>
  snapshot.dueDiligence.find((entry) => entry.key === 'zoning')!;

describe('due-diligence merge — unresolved tiles can still improve', () => {
  it('a fresher unknown replaces a retained unknown', () => {
    const retained = snapshotWith([zoningItem()], 1);
    const incoming = snapshotWith([zoningItem({
      headline: 'District unresolved — Whitewater township administers zoning',
      detail: 'Whitewater township administers zoning for this parcel.',
      sourceUrl: 'https://www.whitewatertownshipmi.gov/',
    })], 2);

    const reconciled = reconcilePropertyIntelligenceSnapshot(retained, incoming);
    expect(reconciled.promotable).toBe(true);
    const zoning = zoningOf(reconciled.snapshot);
    expect(zoning.headline).toContain('Whitewater township');
    expect(zoning.sourceUrl).toBe('https://www.whitewatertownshipmi.gov/');
  });

  it('an unknown still never erases a resolved finding', () => {
    const retained = snapshotWith([zoningItem({
      verdict: 'good',
      grade: 'confirmed_fact',
      headline: 'AG-1 (officially confirmed)',
    })], 1);
    const incoming = snapshotWith([zoningItem()], 2);

    const zoning = zoningOf(reconcilePropertyIntelligenceSnapshot(retained, incoming).snapshot);
    expect(zoning.headline).toBe('AG-1 (officially confirmed)');
    expect(zoning.verdict).toBe('good');
  });

  it('a resolved finding still replaces a retained unknown', () => {
    const retained = snapshotWith([zoningItem()], 1);
    const incoming = snapshotWith([zoningItem({
      verdict: 'good',
      grade: 'confirmed_fact',
      headline: 'AG-1 (officially confirmed)',
    })], 2);

    expect(zoningOf(reconcilePropertyIntelligenceSnapshot(retained, incoming).snapshot).verdict).toBe('good');
  });

  it('an item absent from the incoming run is retained, not dropped', () => {
    const retained = snapshotWith([zoningItem({ key: 'wetlands', label: 'Wetlands' })], 1);
    const incoming = snapshotWith([zoningItem()], 2);

    const merged = reconcilePropertyIntelligenceSnapshot(retained, incoming).snapshot;
    expect(merged.dueDiligence.map((entry) => entry.key)).toEqual(
      expect.arrayContaining(['wetlands', 'zoning']),
    );
  });
});
