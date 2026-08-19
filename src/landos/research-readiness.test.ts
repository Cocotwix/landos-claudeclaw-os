// Research Readiness Manifest — status system, group readiness, and the
// targeted-backfill selection rules.
//
// The old-lead fixture below is the point of the suite. It represents a card
// whose research predates the capability registry: several capabilities
// succeeded, one never ran, one ran properly and resolved nothing, one result
// has aged out, and the seller has not been contacted. Every selection rule is
// proven against it — green untouched, red selected, yellow never looped, blue
// only on request, gray never run.

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  RESEARCH_READINESS_ITEMS,
  buildResearchReadinessManifest,
  deriveResearchReadinessStatus,
  researchReadinessItem,
  selectResearchBackfill,
  type ResearchReadinessManifest,
  type ResearchReadinessProbe,
} from './research-readiness.js';

const NOW = '2026-08-19T12:00:00.000Z';
const RECENT = '2026-08-10T12:00:00.000Z';
/** Older than the 120/180-day market windows. */
const LONG_AGO = '2025-06-01T12:00:00.000Z';

const probe = (over: Partial<ResearchReadinessProbe> & { itemId: string }): ResearchReadinessProbe => ({
  attempted: false,
  technicalSuccess: false,
  usableEvidence: false,
  reason: 'fixture',
  ...over,
});

/**
 * An OLDER lead, reconstructed from retained evidence only.
 *
 *   green  — resolution, LandPortal, official record, subdivision rules,
 *            history, access, area context
 *   red    — Assessor & Tax never ran (machine-resolvable)
 *   red    — soils/septic never ran (NO registered capability owns it)
 *   yellow — zoning ran properly and established no district
 *   yellow — comps ran properly and found no acceptable closed sale
 *   blue   — market statistics are usable but aged out
 *   gray   — seller not contacted
 */
function oldLeadManifest(): ResearchReadinessManifest {
  return buildResearchReadinessManifest({
    dealCardId: 4242,
    propertyCardId: 777,
    now: NOW,
    probes: [
      probe({ itemId: 'property_resolution', attempted: true, technicalSuccess: true, usableEvidence: true, lastSuccessAt: RECENT, reason: 'APN confirmed.' }),
      probe({ itemId: 'landportal_research', attempted: true, technicalSuccess: true, usableEvidence: true, lastSuccessAt: RECENT, reason: 'Parcel record retained.' }),
      // Never ran at all — the machine gap.
      probe({ itemId: 'assessor_tax', reason: 'No Assessor & Tax run is on record.' }),
      probe({ itemId: 'official_parcel_record', attempted: true, technicalSuccess: true, usableEvidence: true, lastSuccessAt: RECENT, reason: 'County GIS parcel matched.' }),
      // Ran correctly, honestly unresolved.
      probe({
        itemId: 'current_zoning',
        attempted: true,
        technicalSuccess: true,
        usableEvidence: false,
        unresolved: true,
        lastAttemptAt: RECENT,
        reason: 'Official sources did not establish the district.',
      }),
      probe({ itemId: 'subdivision_rules', attempted: true, technicalSuccess: true, usableEvidence: true, lastSuccessAt: RECENT, reason: '31 rules retained.' }),
      probe({ itemId: 'property_development_history', attempted: true, technicalSuccess: true, usableEvidence: true, lastSuccessAt: RECENT, reason: 'No material history on record.' }),
      probe({ itemId: 'visual_evidence', attempted: true, technicalSuccess: true, usableEvidence: true, lastSuccessAt: RECENT, reason: 'Parcel imagery retained.' }),
      probe({ itemId: 'access_frontage', attempted: true, technicalSuccess: true, usableEvidence: true, lastSuccessAt: RECENT, reason: 'Frontage retained.' }),
      // Never ran, and no registered capability owns it.
      probe({ itemId: 'utilities_septic', reason: 'No soils screening on record.' }),
      probe({
        itemId: 'comps_collection',
        attempted: true,
        technicalSuccess: true,
        usableEvidence: false,
        unresolved: true,
        lastAttemptAt: RECENT,
        reason: 'No acceptable closed sale exists in the window.',
      }),
      probe({ itemId: 'valuation', attempted: true, technicalSuccess: true, usableEvidence: true, lastSuccessAt: RECENT, reason: 'Value band established.' }),
      // Usable but aged past the 120-day window.
      probe({ itemId: 'market_statistics', attempted: true, technicalSuccess: true, usableEvidence: true, lastSuccessAt: LONG_AGO, reason: 'Band metrics retained.' }),
      probe({ itemId: 'area_market_context', attempted: true, technicalSuccess: true, usableEvidence: true, lastSuccessAt: RECENT, reason: 'Growth measured.' }),
      // Seller never contacted.
      probe({ itemId: 'seller_information', reason: 'No seller contact captured yet.' }),
    ],
  });
}

const statusOf = (manifest: ResearchReadinessManifest, id: string) =>
  manifest.items.find((item) => item.id === id)?.status;

describe('research readiness — the core rule', () => {
  const zoning = researchReadinessItem('current_zoning')!;
  const seller = researchReadinessItem('seller_information')!;
  const market = researchReadinessItem('market_statistics')!;
  const nowMs = Date.parse(NOW);

  it('separates "the workflow ran" from "we got a usable answer"', () => {
    const ranAndResolved = deriveResearchReadinessStatus(
      zoning,
      probe({ itemId: 'current_zoning', attempted: true, technicalSuccess: true, usableEvidence: true, lastSuccessAt: RECENT }),
      nowMs,
    );
    const ranAndUnresolved = deriveResearchReadinessStatus(
      zoning,
      probe({ itemId: 'current_zoning', attempted: true, technicalSuccess: true, usableEvidence: false, unresolved: true }),
      nowMs,
    );
    expect(ranAndResolved).toBe('green');
    // A technically successful run with no usable answer is NOT green and NOT red.
    expect(ranAndUnresolved).toBe('yellow');
  });

  it('separates an unresolved answer from a run that broke or never happened', () => {
    const neverRan = deriveResearchReadinessStatus(zoning, probe({ itemId: 'current_zoning' }), nowMs);
    const failed = deriveResearchReadinessStatus(
      zoning,
      probe({ itemId: 'current_zoning', attempted: true, technicalSuccess: false }),
      nowMs,
    );
    const laneUnavailable = deriveResearchReadinessStatus(
      zoning,
      probe({ itemId: 'current_zoning', attempted: true, technicalSuccess: true, usableEvidence: false, unresolved: false }),
      nowMs,
    );
    expect([neverRan, failed, laneUnavailable]).toEqual(['red', 'red', 'red']);
  });

  it('treats a usable but aged market result as stale, not missing', () => {
    expect(deriveResearchReadinessStatus(
      market,
      probe({ itemId: 'market_statistics', attempted: true, technicalSuccess: true, usableEvidence: true, lastSuccessAt: LONG_AGO }),
      nowMs,
    )).toBe('blue');
    expect(deriveResearchReadinessStatus(
      market,
      probe({ itemId: 'market_statistics', attempted: true, technicalSuccess: true, usableEvidence: true, lastSuccessAt: RECENT }),
      nowMs,
    )).toBe('green');
  });

  it('never turns an expected human unknown into a failure', () => {
    expect(deriveResearchReadinessStatus(seller, probe({ itemId: 'seller_information' }), nowMs)).toBe('gray');
  });

  it('marks an inapplicable item gray whatever its run history', () => {
    expect(deriveResearchReadinessStatus(
      zoning,
      probe({ itemId: 'current_zoning', applicable: false, attempted: true, technicalSuccess: false }),
      nowMs,
    )).toBe('gray');
  });

  it('items with no probe at all are red, never silently omitted', () => {
    const manifest = buildResearchReadinessManifest({ dealCardId: 1, propertyCardId: 2, probes: [], now: NOW });
    expect(manifest.items).toHaveLength(RESEARCH_READINESS_ITEMS.length);
    expect(manifest.items.filter((item) => item.status === 'red')).toHaveLength(
      RESEARCH_READINESS_ITEMS.filter((item) => !item.humanExpected).length,
    );
  });

  it('gives every item a reason, and every non-ready item a next action', () => {
    const manifest = oldLeadManifest();
    for (const item of manifest.items) {
      expect(item.reason.trim().length).toBeGreaterThan(0);
      if (item.status !== 'green') expect(item.nextAction?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('research readiness — old lead reconstruction', () => {
  it('reconstructs the honest checklist from retained evidence', () => {
    const manifest = oldLeadManifest();
    expect(statusOf(manifest, 'property_resolution')).toBe('green');
    expect(statusOf(manifest, 'assessor_tax')).toBe('red');
    expect(statusOf(manifest, 'utilities_septic')).toBe('red');
    expect(statusOf(manifest, 'current_zoning')).toBe('yellow');
    expect(statusOf(manifest, 'comps_collection')).toBe('yellow');
    expect(statusOf(manifest, 'market_statistics')).toBe('blue');
    expect(statusOf(manifest, 'seller_information')).toBe('gray');
    expect(manifest.counts).toEqual({
      total: 15, ready: 9, needsMachineAttention: 2, unresolved: 2, stale: 1, expectedUnknown: 1,
    });
    expect(manifest.headline).toBe('9 / 15 ready');
  });

  it('only offers machine backfill where a registered capability owns the item', () => {
    const manifest = oldLeadManifest();
    const assessor = manifest.items.find((item) => item.id === 'assessor_tax')!;
    const septic = manifest.items.find((item) => item.id === 'utilities_septic')!;
    expect(assessor.owner.capabilityId).toBe('assessor-tax');
    expect(assessor.machineBackfillAllowed).toBe(true);
    // Red, but nothing registered owns it — the manifest says so instead of inventing a runner.
    expect(septic.owner.kind).toBe('operator_surface');
    expect(septic.machineBackfillAllowed).toBe(false);
    expect(manifest.backfillCandidates).toEqual(['assessor_tax']);
  });
});

describe('research readiness — targeted backfill selection', () => {
  it('selects ONLY red machine-resolvable items by default', () => {
    const { targets } = selectResearchBackfill(oldLeadManifest());
    expect(targets).toHaveLength(1);
    expect(targets[0].capabilityId).toBe('assessor-tax');
    expect(targets[0].itemIds).toEqual(['assessor_tax']);
  });

  it('never reruns a green item', () => {
    const { targets, skipped } = selectResearchBackfill(oldLeadManifest());
    const greenIds = oldLeadManifest().items.filter((i) => i.status === 'green').map((i) => i.id);
    for (const id of greenIds) {
      expect(targets.some((t) => t.itemIds.includes(id))).toBe(false);
      expect(skipped.find((s) => s.itemId === id)?.reason).toMatch(/never reruns a ready item/i);
    }
  });

  it('never loops on a yellow unresolved item, even when explicitly named', () => {
    const manifest = oldLeadManifest();
    const forced = selectResearchBackfill(manifest, { itemIds: ['current_zoning', 'comps_collection'] });
    expect(forced.targets).toHaveLength(0);
    expect(forced.skipped.map((s) => s.itemId).sort()).toEqual(['comps_collection', 'current_zoning']);
    for (const skip of forced.skipped) expect(skip.reason).toMatch(/never loops on an unresolved result/i);
  });

  it('never starts research for a gray human item, even when explicitly named', () => {
    const forced = selectResearchBackfill(oldLeadManifest(), { itemIds: ['seller_information'] });
    expect(forced.targets).toHaveLength(0);
    expect(forced.skipped[0].reason).toMatch(/never starts automated research/i);
  });

  it('leaves a blue item alone by default and refreshes it only on request', () => {
    const manifest = oldLeadManifest();
    expect(selectResearchBackfill(manifest).targets.flatMap((t) => t.itemIds)).not.toContain('market_statistics');
    // Market statistics has no registered capability owner, so even an explicit
    // stale refresh is reported honestly instead of being faked.
    const stale = selectResearchBackfill(manifest, { includeStale: true });
    expect(stale.targets.flatMap((t) => t.itemIds)).not.toContain('market_statistics');
    expect(stale.skipped.find((s) => s.itemId === 'market_statistics')?.reason)
      .toMatch(/No registered capability owns this item/i);
  });

  it('refreshes a capability-owned blue item when asked', () => {
    const manifest = buildResearchReadinessManifest({
      dealCardId: 5, propertyCardId: 6, now: NOW,
      probes: [probe({ itemId: 'comps_collection', attempted: true, technicalSuccess: true, usableEvidence: true, lastSuccessAt: LONG_AGO, reason: 'Aged comps.' })],
    });
    expect(statusOf(manifest, 'comps_collection')).toBe('blue');
    expect(selectResearchBackfill(manifest).targets.flatMap((t) => t.itemIds)).not.toContain('comps_collection');
    const refreshed = selectResearchBackfill(manifest, { includeStale: true });
    expect(refreshed.targets.find((t) => t.capabilityId === 'comps-valuation')?.itemIds).toContain('comps_collection');
  });

  it('invokes one capability once however many checklist items it owns', () => {
    const manifest = buildResearchReadinessManifest({
      dealCardId: 7, propertyCardId: 8, now: NOW,
      // Zoning and subdivision rules share one capability; so do comps and valuation.
      probes: [],
    });
    const { targets } = selectResearchBackfill(manifest);
    const zoningTarget = targets.find((t) => t.capabilityId === 'zoning-subdivision');
    const compTarget = targets.find((t) => t.capabilityId === 'comps-valuation');
    expect(zoningTarget?.itemIds.sort()).toEqual(['current_zoning', 'subdivision_rules']);
    expect(compTarget?.itemIds.sort()).toEqual(['comps_collection', 'valuation']);
    expect(new Set(targets.map((t) => t.capabilityId)).size).toBe(targets.length);
  });
});

describe('research readiness — intelligence-ready groups', () => {
  it('distinguishes a blocking machine gap from a known unresolved input', () => {
    const { groups } = oldLeadManifest();
    // Assessor & Tax is red, critical and machine-owned: a real blocker.
    expect(groups.property.ready).toBe(false);
    expect(groups.property.blockingMachineGaps).toEqual(['Assessor / Tax']);
    // Zoning is unresolved, NOT blocking — the intelligence layer must reason with it.
    expect(groups.property.knownUnresolvedInputs).toContain('Current Zoning');
    expect(groups.property.blockingMachineGaps).not.toContain('Current Zoning');
  });

  it('lets a group be ready with unresolved and expected-unknown inputs', () => {
    const { groups } = oldLeadManifest();
    // Comps is unresolved and market statistics is stale, yet nothing BLOCKS.
    expect(groups.market.ready).toBe(true);
    expect(groups.market.knownUnresolvedInputs).toContain('Comps Collection');
    expect(groups.market.staleInputs).toContain('Market Statistics');
    // Seller readiness is not held hostage by an expected unknown.
    expect(groups.seller.ready).toBe(true);
    expect(groups.seller.expectedUnknowns).toEqual(['Seller Information']);
  });

  it('rolls the whole card up into deal readiness', () => {
    const { groups, items } = oldLeadManifest();
    expect(groups.deal.total).toBe(items.length);
    expect(groups.deal.ready).toBe(false);
    expect(groups.deal.blockingMachineGaps).toEqual(['Assessor / Tax']);
  });

  it('a card with no machine gaps is ready even with unresolved inputs', () => {
    const manifest = buildResearchReadinessManifest({
      dealCardId: 9, propertyCardId: 10, now: NOW,
      probes: RESEARCH_READINESS_ITEMS.map((item) => probe({
        itemId: item.id,
        attempted: true,
        technicalSuccess: true,
        usableEvidence: item.id !== 'current_zoning',
        unresolved: true,
        lastSuccessAt: RECENT,
        reason: 'fixture',
      })),
    });
    expect(statusOf(manifest, 'current_zoning')).toBe('yellow');
    expect(manifest.groups.deal.ready).toBe(true);
    expect(manifest.groups.deal.blockingMachineGaps).toEqual([]);
  });
});

describe('research readiness — no research on page load', () => {
  const RECONCILE_SRC = fs.readFileSync(fileURLToPath(new URL('./research-readiness-reconcile.ts', import.meta.url)), 'utf-8');
  const ROUTES_SRC = fs.readFileSync(fileURLToPath(new URL('./routes.ts', import.meta.url)), 'utf-8');

  it('the reconciler never invokes a capability, a model or a browser', () => {
    // Reading a retained `hermes_*` LANE NAME is fine; importing or calling any
    // of these is not. Matched as imports/calls, not as bare words.
    expect(RECONCILE_SRC).not.toMatch(/invokeRuntimeCapability\s*\(/);
    expect(RECONCILE_SRC).not.toMatch(/from '\.\/(capability-registry|browser-session|browser-intelligence|hermes-[\w-]+|model-[\w-]+)\.js'/);
    expect(RECONCILE_SRC).not.toMatch(/\b(runModel|generateGroundedContent|openBrowser|runVisualIntelligence)\s*\(/);
  });

  it('the read route reconciles and the backfill route is a separate explicit POST', () => {
    expect(ROUTES_SRC).toMatch(/app\.get\('\/api\/landos\/deal-cards\/:id\/research-readiness'/);
    expect(ROUTES_SRC).toMatch(/app\.post\('\/api\/landos\/deal-cards\/:id\/research-readiness\/backfill'/);
    const getBlock = ROUTES_SRC.slice(
      ROUTES_SRC.indexOf("app.get('/api/landos/deal-cards/:id/research-readiness'"),
      ROUTES_SRC.indexOf("app.post('/api/landos/deal-cards/:id/research-readiness/backfill'"),
    );
    expect(getBlock).not.toMatch(/invokeRuntimeCapability|runResearchReadinessBackfill/);
  });

  it('the Deal Card fetches the manifest and never posts a backfill on load', () => {
    const PAGE_SRC = fs.readFileSync(
      fileURLToPath(new URL('../../web/src/pages/AcquisitionWorkspaceV2.tsx', import.meta.url)),
      'utf-8',
    );
    // The load effect GETs the manifest…
    expect(PAGE_SRC).toMatch(/apiGet<\{ manifest\?: ResearchReadinessManifestView \}>\(\s*`\/api\/landos\/deal-cards\/\$\{dealId\}\/research-readiness`/);
    // …and the only POST to the backfill route lives in the operator handler.
    const loadEffect = PAGE_SRC.slice(PAGE_SRC.indexOf('const [d, i, a, act, bu] = await Promise.all'), PAGE_SRC.indexOf('return () => { dead = true; };'));
    expect(loadEffect).not.toMatch(/apiPost/);
    expect(PAGE_SRC).toMatch(/const runResearchBackfill = async[\s\S]{0,600}research-readiness\/backfill/);
  });

  it('the compact strip is rendered on the Deal Card overview', () => {
    const OVERVIEW_SRC = fs.readFileSync(
      fileURLToPath(new URL('../../web/src/components/AcquisitionWorkspaceV2Overview.tsx', import.meta.url)),
      'utf-8',
    );
    expect(OVERVIEW_SRC).toMatch(/<ResearchReadinessStrip/);
    // It sits above the acquisitions Deal Read, i.e. near the top of the card.
    expect(OVERVIEW_SRC.indexOf('<ResearchReadinessStrip')).toBeLessThan(OVERVIEW_SRC.indexOf('<DealReadCard'));
  });
});
