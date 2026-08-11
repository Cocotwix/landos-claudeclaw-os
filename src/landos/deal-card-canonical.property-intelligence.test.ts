import { describe, expect, it } from 'vitest';
import { modelVersionForCard, retainedCompRunsFromReport, type ReportCompLanes } from './deal-card-canonical.js';
import { buildCompRegistry } from './comp-registry.js';
import { buildCanonicalDealState, supersedeStaleConclusions } from './deal-card-reconciliation.js';
import { projectCanonicalExecutiveState } from './deal-card-executive-summary.js';
import { compCountsFromRows, isSoldCompRow, summarizeComps } from './deal-card-comp-recompute.js';
import type { CompRow } from './comps.js';
import { summarizeLandScore, type LandScoreFactor, type LandScoreResult } from './land-score.js';
import { presentOwnerAndSeller } from './seller-authority.js';
import { extractOwnerOfRecordCandidate, extractSellerIdentity } from './lead-identity.js';
import type { SnapshotComp } from './property-intelligence-snapshot.js';

describe('Deal Card canonical Property Intelligence provider outcomes', () => {
  it('retains result, no-result, blocked, timeout, failure, and LandPortal outcomes without calling providers', () => {
    const lanes: ReportCompLanes = {
      providers: [
        { providerId: 'Realie', status: 'collected', kept: 1 },
        { providerId: 'Zillow', status: 'no_results', kept: 0 },
        { providerId: 'Redfin', status: 'blocked', kept: 0 },
        { providerId: 'Realtor', status: 'timeout', kept: 0 },
        { providerId: 'Home Harvest', status: 'failed', kept: 0 },
        { providerId: 'Public transfers', status: 'not_authorized', kept: 0 },
      ],
      sold: [{ sourceLabel: 'Realie', addressDesc: '1 Retained Result Rd, Newport, TN', price: 70_000, saleDateIso: '2026-01-15', acres: 7, sourceUrl: 'https://realie.example/1', lat: 35.9, lng: -83.2 }],
      landportalComps: { status: 'no_results', count: 0, note: 'Free visible similar-sales surface returned no rows.', rows: [] },
    };

    const runs = retainedCompRunsFromReport(lanes);
    expect(Object.fromEntries(runs.map((run) => [run.provider, run.status]))).toMatchObject({
      Realie: 'succeeded', Zillow: 'no_result', Redfin: 'blocked', Realtor: 'timeout',
      'Home Harvest': 'failed', 'Public transfers': 'blocked', 'LandPortal visible': 'no_result',
    });
    expect(runs.find((run) => run.provider === 'Realie')?.candidates[0]).toMatchObject({ lat: 35.9, lng: -83.2 });
    expect(runs.find((run) => run.provider === 'LandPortal visible')?.note).toMatch(/Free visible similar-sales surface returned no rows/);
    expect(runs.every((run) => run.elapsedMs === 0 && run.result === null)).toBe(true);
  });

  it('does not advertise a persisted-row reconcile for rejected report-only candidates', () => {
    const reportOnly = buildCompRegistry({ state: 'TN' }, [{
      provider: 'Zillow', lane: 'active', addressDesc: '327 S 3rd St E, Magrath, AB T0K 1J0 ROYAL',
      price: 75_000, priceKind: 'list', sourceUrl: 'https://zillow.example/ca',
    }]);
    expect(modelVersionForCard(null, reportOnly).reasons).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/persisted comp row/i),
    ]));

    const persisted = buildCompRegistry({ state: 'TN' }, [{
      id: 42, provider: 'Zillow', lane: 'active', addressDesc: '327 S 3rd St E, Magrath, AB T0K 1J0 ROYAL',
      price: 75_000, priceKind: 'list', sourceUrl: 'https://zillow.example/ca',
    }]);
    expect(modelVersionForCard(null, persisted).reasons).toEqual(expect.arrayContaining([
      expect.stringMatching(/1 persisted comp row/i),
    ]));
  });
});

// ── ONE canonical current state, consumed by all three pages ─────────────────
//
// Overview, Property Intelligence and Comps & Valuation each used to derive
// their own comp counts, valuation verdict, blockers and missing-information
// list. This is the single derivation they now share, so the three pages cannot
// disagree about the same evidence.

const snapshotComp = (overrides: Partial<SnapshotComp> & { key: string }): SnapshotComp => ({
  address: `${overrides.key} Comp Rd`,
  lane: 'sold',
  source: 'LandPortal',
  sourceUrl: null,
  status: 'Source-stated sale',
  dateIso: '2026-01-15',
  price: 400_000,
  acres: 40,
  pricePerAcre: 10_000,
  distanceMiles: 4,
  whyUseful: 'Acreage-band sale.',
  similarities: [],
  differences: [],
  ...overrides,
});

/** 9490-shaped: materially improved subject, land priced, improvements not. */
function elkLakeState() {
  return buildCanonicalDealState({
    comps: {
      sold: [
        snapshotComp({ key: 's1', providerAttributions: ['LandPortal', 'Zillow'] }),
        snapshotComp({ key: 's2', providerAttributions: ['LandPortal', 'Redfin'] }),
        snapshotComp({ key: 's3' }),
      ],
      active: [snapshotComp({ key: 'a1', lane: 'active', status: 'Active listing', source: 'Zillow' })],
      askingReferences: [snapshotComp({ key: 'k1', lane: 'active', status: 'Asking reference' })],
      totalCollected: 11,
      duplicatesMerged: 6,
    },
    valuation: {
      priceable: true,
      basis: 'Three accepted source-stated sales in the acreage band.',
      notPriceableReason: null,
      nextActionToPrice: null,
      materialGaps: ['No usable comp survived the acreage-band filter.'],
    },
    subject: { improved: true, improvementBasis: 'house and outbuildings', improvementsValued: false },
    ownerSeller: {
      ownerOfRecord: 'WELLS MICHAEL C',
      ownerSource: 'Grand Traverse County assessor',
      ownerVerified: true,
      sellerName: null,
      sellerIntakeCollected: false,
    },
    rawBlockers: ['Recorded legal access is not established.'],
    rawMissingInformation: ['Another closed sale is still required.', 'Surveyed frontage'],
  });
}

describe('one canonical comp/valuation state', () => {
  it('produces exactly one comp tally that every surface reads', () => {
    const state = elkLakeState();
    expect(state.comps.sold).toBe(3);
    expect(state.comps.active).toBe(1);
    expect(state.comps.asking).toBe(1);
    expect(state.comps.duplicatesMerged).toBe(6);
    expect(state.comps.totalCollected).toBe(11);
    // A corroborating marketplace is a SOURCE on one comp, never a second comp.
    expect(state.comps.sources).toEqual(['LandPortal', 'Zillow', 'Redfin']);
    expect(state.comps.summaryLine).toContain('3 accepted sold comp(s)');
    expect(state.comps.summaryLine).toContain('6 duplicate(s) merged');
    expect(state.comps.conclusion).toBe('sold_supported');

    // The Overview mirror reproduces the SAME numbers, never its own.
    const overview = projectCanonicalExecutiveState(state);
    expect(overview.compCounts).toEqual({
      sold: 3, active: 1, asking: 1, duplicatesMerged: 6, sources: ['LandPortal', 'Zillow', 'Redfin'],
    });
    expect(overview.compSummaryLine).toBe(state.comps.summaryLine);
    expect(overview.valuation.status).toBe(state.valuation.status);
    expect(overview.decisionSummary).toBe(state.decisionSummary);
    expect(overview.blockers).toEqual(state.blockers);
    expect(overview.missingInformation).toEqual(state.missingInformation);
  });

  it('removes only the conclusions the accepted records contradict', () => {
    const state = elkLakeState();
    const dropped = state.supersededStatements.map((entry) => entry.statement);
    expect(dropped).toContain('Another closed sale is still required.');
    expect(dropped).toContain('No usable comp survived the acreage-band filter.');
    // Genuine, unrelated uncertainty survives untouched.
    expect(state.blockers).toContain('Recorded legal access is not established.');
    expect(state.missingInformation).toContain('Surveyed frontage');
    expect(JSON.stringify({ b: state.blockers, m: state.missingInformation }))
      .not.toMatch(/still required|no usable comp/i);
    for (const entry of state.supersededStatements) {
      expect(entry.supersededBy).toMatch(/accepted closed sale\(s\)/);
    }
  });

  it('supersedes every wording of the empty-working-set claim', () => {
    const state = { comps: elkLakeState().comps, priceable: true };
    const { kept, superseded } = supersedeStaleConclusions([
      'No usable comps found after searching Zillow and Redfin for the 40-60 ac band.',
      'No usable comparables retrieved yet.',
      'No usable comparable survived the selection filters.',
      'Another closed sale is still required.',
      'Recorded legal access is not established.',
    ], state);
    expect(kept).toEqual(['Recorded legal access is not established.']);
    expect(superseded).toHaveLength(4);
  });

  it('never supersedes a statement the current records cannot disprove', () => {
    const { kept, superseded } = supersedeStaleConclusions(
      ['No usable comp survived the filter.', 'Recorded legal access is not established.'],
      { comps: { ...elkLakeState().comps, sold: 0, conclusion: 'not_priceable' }, priceable: false },
    );
    expect(superseded).toEqual([]);
    expect(kept).toHaveLength(2);
  });

  it('keeps land-basis figures unmistakably separate from a whole-property value', () => {
    const state = elkLakeState();
    expect(state.valuation.scope.figureKind).toBe('land_basis_reference');
    expect(state.valuation.scope.wholeProperty.state).toBe('pending');
    expect(state.valuation.blockers.join(' ')).toMatch(/improvements have not been separately valued/i);
    expect(state.decisionSummary).toMatch(/Whole-property value remains pending/);
    expect(state.nextActions).toContain('Value the improvements separately before stating any whole-property number.');
  });

  it('keeps owner of record strictly distinct from seller/lead', () => {
    const state = elkLakeState();
    expect(state.ownerSeller.ownerOfRecord).toBe('WELLS MICHAEL C');
    expect(state.ownerSeller.ownerVerified).toBe(true);
    // "Not collected" is the CORRECT state for a subject entered without intake.
    expect(state.ownerSeller.sellerName).toBeNull();
    expect(state.ownerSeller.sellerLabel).toBe('Not collected');
    expect(state.ownerSeller.distinctionNote).toMatch(/no seller intake has happened/i);
  });
});

describe('owner of record is never backfilled into the seller field', () => {
  it('presents the two as independent facts', () => {
    const view = presentOwnerAndSeller({
      ownerOfRecord: 'WELLS MICHAEL C',
      ownerSource: 'Grand Traverse County assessor',
      ownerFromOfficialSource: true,
      sellerName: null,
      sellerIntakeCollected: false,
    });
    expect(view.ownerOfRecord.status).toBe('verified');
    expect(view.seller.value).toBeNull();
    expect(view.seller.label).toBe('Not collected');
    expect(view.seller.collected).toBe(false);
    expect(view.sameParty).toBe(false);
  });

  it('does not promote the owner even when it is the only name available', () => {
    const view = presentOwnerAndSeller({ ownerOfRecord: 'WELLS MICHAEL C', sellerName: 'WELLS MICHAEL C' });
    // No intake happened, so no seller exists however well the owner is known.
    expect(view.seller.label).toBe('Not collected');
    expect(view.seller.collected).toBe(false);
  });

  it('reads an owner-of-record mention on its own channel, not as the seller', () => {
    const text = 'Owner of record: WELLS MICHAEL C. No seller contact yet.';
    expect(extractSellerIdentity(text)).toBeNull();
    expect(extractOwnerOfRecordCandidate(text)?.name).toBe('WELLS MICHAEL C');
    expect(extractOwnerOfRecordCandidate(text)?.basis).toMatch(/not a seller or lead/i);
  });

  it('still reads a genuinely labeled seller', () => {
    expect(extractSellerIdentity('Seller: Davan Smith')?.name).toBe('Davan Smith');
  });
});

describe('one recomputed comp count on the Deal Card row set', () => {
  const row = (overrides: Partial<CompRow>): CompRow => ({
    price: 100_000, price_kind: 'sale', acres: 10, price_per_acre: 10_000,
    canonical_source: 'LandPortal', source_label: 'LandPortal',
    ...overrides,
  } as CompRow);

  it('uses one predicate for "sold" so no second derivation can disagree', () => {
    const rows = [
      row({ price_kind: 'sale', price: 100_000 }),
      row({ price_kind: 'sale', price: 0 }),          // no price → not a sale
      row({ price_kind: 'sale', price: null }),
      row({ price_kind: 'list', price: 90_000, canonical_source: 'Zillow', source_label: 'Zillow' }),
      row({ price_kind: 'active', price: 95_000, canonical_source: 'Redfin', source_label: 'Redfin' }),
    ];
    const counts = compCountsFromRows(rows);
    expect(counts.sold).toBe(1);
    expect(counts.active).toBe(2);
    expect(counts.sources).toEqual(['LandPortal', 'Zillow', 'Redfin']);
    expect(rows.filter(isSoldCompRow)).toHaveLength(counts.sold);
    // The summary reads the SAME tally rather than counting the rows again.
    const summary = summarizeComps(rows, 10);
    expect(summary.soldCount).toBe(counts.sold);
    expect(summary.activeCount).toBe(counts.active);
    expect(summary.sources).toEqual(counts.sources);
  });
});

describe('land score leads with drivers, not arithmetic', () => {
  const factor = (overrides: Partial<LandScoreFactor> & { id: string }): LandScoreFactor => ({
    label: overrides.id, maxPoints: 20, points: 20, lowestTier: false, dataGap: false,
    basis: `${overrides.id} basis`, ...overrides,
  });
  const scored: Omit<LandScoreResult, 'summary'> = {
    score: 62,
    maxScore: 100,
    verdict: 'PURSUE WITH CAUTION',
    factors: [
      factor({ id: 'access', label: 'Access', points: 20, maxPoints: 20, basis: 'Road frontage 693 ft' }),
      factor({ id: 'size', label: 'Size', points: 16, maxPoints: 20 }),
      factor({ id: 'slope', label: 'Slope', points: 4, maxPoints: 20, lowestTier: true, basis: 'Steep' }),
      factor({ id: 'wetlands', label: 'Wetlands', points: 0, maxPoints: 20, dataGap: true, basis: 'LandPortal returned no wetlands field' }),
    ],
    dataGaps: ['wetlands'],
    flags: [],
    rubricSource: 'rubric',
    confidence: 'reduced',
    note: 'computed',
  };

  it('separates positives, negatives and unresolved from the per-factor math', () => {
    const summary = summarizeLandScore(scored);
    expect(summary.headline).toBe('62 / 100 — PURSUE WITH CAUTION');
    expect(summary.positives.map((d) => d.label)).toEqual(['Access', 'Size']);
    expect(summary.negatives.map((d) => d.label)).toEqual(['Slope']);
    // A data gap is UNRESOLVED, never a negative — 0 points is not a low score.
    expect(summary.unresolved.map((d) => d.label)).toEqual(['Wetlands']);
    expect(summary.note).toMatch(/strongest: access, size; weakest: slope; unresolved: wetlands/);
    // The arithmetic stays available, it just is not what the Overview leads with.
    expect(scored.factors).toHaveLength(4);
  });
});
