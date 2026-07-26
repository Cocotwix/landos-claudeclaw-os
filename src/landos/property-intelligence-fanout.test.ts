import { beforeEach, describe, expect, it } from 'vitest';

import { _initTestLandosDb } from './db.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { upsertPropertyCard } from './property-card.js';
import { MissionGraphStore, resetMissionGraphStoreCache } from './mission-graph-store.js';
import { launchFanOutMission, readFanOutMission } from './mission-graph-runner.js';
import { resetPropertyIntelligenceStoreCache } from './property-intelligence-store.js';
import {
  PROPERTY_INTELLIGENCE_FANOUT_CHILDREN,
  PROPERTY_INTELLIGENCE_FANOUT_KIND,
  PROPERTY_INTELLIGENCE_FANOUT_SCOPE,
  propertyIntelligenceFanOutDefinition,
  type DealContextHandback,
  type IdentityHandback,
  type MarketCoverageHandback,
} from './property-intelligence-fanout.js';

const READ_VIEW = {
  kind: PROPERTY_INTELLIGENCE_FANOUT_KIND,
  scope: PROPERTY_INTELLIGENCE_FANOUT_SCOPE,
  label: 'Property Intelligence fan-out',
  children: PROPERTY_INTELLIGENCE_FANOUT_CHILDREN,
};

/** A Deal Card with a linked subject property card, as the operator workflow builds it. */
function seedDeal(input: {
  address: string;
  county?: string;
  state?: string;
  apn?: string;
  owner?: string;
  acres?: number;
  verified?: boolean;
}): number {
  const deal = createDealCard({ entity: 'LAND_ALLY', title: input.address });
  const { card } = upsertPropertyCard({
    entity: 'LAND_ALLY',
    activeInputAddress: input.address,
    county: input.county,
    state: input.state,
    apn: input.apn,
    fips: input.verified ? '47145' : undefined,
    owner: input.owner,
    acres: input.acres,
    verified: input.verified,
    verificationSource: input.verified ? 'Tennessee Comptroller parcel layer' : undefined,
  });
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
  return deal.id;
}

beforeEach(() => {
  _initTestLandosDb();
  resetMissionGraphStoreCache();
  resetPropertyIntelligenceStoreCache();
});

describe('representative Property Intelligence fan-out mission', () => {
  it('declares one parent with three specialist children in two waves', () => {
    const definition = propertyIntelligenceFanOutDefinition();
    expect(definition.children.map((c) => c.key)).toEqual(['parcel_identity', 'deal_context', 'market_coverage']);
    expect(definition.children.find((c) => c.key === 'market_coverage')!.role).toBe('supporting');
    expect(definition.children.find((c) => c.key === 'deal_context')!.dependsOn).toEqual(['parcel_identity']);
    // Every declared child has an executor; none can strand in `queued`.
    for (const child of definition.children) {
      expect(typeof definition.executors[child.key]).toBe('function');
    }
  });

  it('fans out from one verified Deal Card and joins all three handbacks', async () => {
    const dealId = seedDeal({
      address: 'OLD RIDGE RD',
      county: 'Knox',
      state: 'TN',
      apn: '073090 04200',
      owner: 'SACHAN DILEEP S',
      acres: 12.28,
      verified: true,
    });
    const store = new MissionGraphStore();
    const { launch, completion } = launchFanOutMission({
      definition: propertyIntelligenceFanOutDefinition(),
      scopeId: dealId,
      store,
    });
    expect(launch.childCount).toBe(3);
    const join = await completion;

    expect(join!.status).toBe('joined');
    expect(join!.allTerminal).toBe(true);
    expect(join!.contributed).toEqual(['parcel_identity', 'deal_context', 'market_coverage']);

    const identity = join!.contributions.parcel_identity as IdentityHandback;
    expect(identity.identityState).toBe('confirmed');
    expect(identity.apn).toBe('073090 04200');
    expect(identity.county).toBe('Knox');
    expect(identity.acres).toBe(12.28);

    const market = join!.contributions.market_coverage as MarketCoverageHandback;
    expect(market.seededCountyCoverage).toBe(true);
    expect(market.fips).toBe('47093');

    const context = join!.contributions.deal_context as DealContextHandback;
    expect(context.propertyCount).toBe(1);
    expect(context.hasVerifiedProperty).toBe(true);
  });

  it('blocks market coverage honestly for a county LandOS has not seeded', async () => {
    // Roane County, TN is a real county with no seeded LandOS market reference.
    const dealId = seedDeal({
      address: 'OLD RIDGE RD',
      county: 'Roane',
      state: 'TN',
      apn: '073090 04200',
      verified: true,
    });
    const join = await launchFanOutMission({
      definition: propertyIntelligenceFanOutDefinition(),
      scopeId: dealId,
      store: new MissionGraphStore(),
    }).completion;

    expect(join!.status).toBe('joined_with_gaps');
    // The required lanes still contributed; only the supporting lane is a gap.
    expect(join!.requiredGaps).toEqual([]);
    expect(join!.gaps.map((g) => g.key)).toEqual(['market_coverage']);
    expect(join!.gaps[0].status).toBe('blocked');
    expect(join!.gaps[0].reason).toMatch(/coverage gap, not evidence that the county has no market/);
    expect(join!.outcome).toContain('Market reference coverage (blocked)');
  });

  it('reports a provisional identity as partial, never as a confirmed parcel', async () => {
    const dealId = seedDeal({ address: '123 UNVERIFIED LN', county: 'Knox', state: 'TN' });
    const join = await launchFanOutMission({
      definition: propertyIntelligenceFanOutDefinition(),
      scopeId: dealId,
      store: new MissionGraphStore(),
    }).completion;

    const identity = join!.contributions.parcel_identity as IdentityHandback;
    expect(identity.identityState).toBe('provisional');
    expect(identity.verificationStatus).not.toBe('verified_property');
    // A partial result is still a contribution, so downstream lanes may run.
    expect(join!.contributions).toHaveProperty('deal_context');
  });

  it('blocks the mission and skips both dependants when no subject parcel is linked', async () => {
    const deal = createDealCard({ entity: 'LAND_ALLY', title: 'Bare lead' });
    const store = new MissionGraphStore();
    const { launch, completion } = launchFanOutMission({
      definition: propertyIntelligenceFanOutDefinition(),
      scopeId: deal.id,
      store,
    });
    const join = await completion;

    expect(join!.status).toBe('blocked');
    expect(join!.outcome).toMatch(/LandOS coverage or input gap/);

    const children = store.listChildren(launch.missionId);
    expect(children.find((c) => c.key === 'parcel_identity')!.status).toBe('blocked');
    expect(children.find((c) => c.key === 'deal_context')!.status).toBe('skipped');
    expect(children.find((c) => c.key === 'market_coverage')!.status).toBe('skipped');
    // Nothing parcel-specific is asserted.
    expect(join!.contributions).toEqual({});
  });

  it('fails the parent honestly when the scope row does not exist', async () => {
    const store = new MissionGraphStore();
    const { launch, completion } = launchFanOutMission({
      definition: propertyIntelligenceFanOutDefinition(),
      scopeId: 999_999,
      store,
    });
    const join = await completion;

    expect(join!.status).toBe('failed');
    expect(store.listChildren(launch.missionId).find((c) => c.key === 'parcel_identity')!.status).toBe('failed');
    expect(store.getMission(launch.missionId)!.status).toBe('failed');
  });

  it('never contaminates a second Deal Card with the first card"s results', async () => {
    const roane = seedDeal({ address: 'OLD RIDGE RD', county: 'Roane', state: 'TN', apn: '073090 04200', verified: true });
    const knox = seedDeal({ address: '4200 SUTHERLAND AVE', county: 'Knox', state: 'TN', apn: 'R1234-567A', verified: true });
    const store = new MissionGraphStore();

    await launchFanOutMission({ definition: propertyIntelligenceFanOutDefinition(), scopeId: roane, store }).completion;
    await launchFanOutMission({ definition: propertyIntelligenceFanOutDefinition(), scopeId: knox, store }).completion;

    const roaneView = readFanOutMission(READ_VIEW, roane, store);
    const knoxView = readFanOutMission(READ_VIEW, knox, store);

    const roaneIdentity = roaneView.join!.contributions.parcel_identity as IdentityHandback;
    const knoxIdentity = knoxView.join!.contributions.parcel_identity as IdentityHandback;
    expect(roaneIdentity.apn).toBe('073090 04200');
    expect(knoxIdentity.apn).toBe('R1234-567A');
    expect(roaneIdentity.dealCardId).toBe(roane);
    expect(knoxIdentity.dealCardId).toBe(knox);
    expect(roaneView.mission!.missionId).not.toBe(knoxView.mission!.missionId);
    // The unseeded county still blocks only on its own card.
    expect(roaneView.join!.status).toBe('joined_with_gaps');
    expect(knoxView.join!.status).toBe('joined');
  });

  it('persists the parent, children and join for a later read', async () => {
    const dealId = seedDeal({ address: 'OLD RIDGE RD', county: 'Knox', state: 'TN', apn: '073090 04200', verified: true });
    const { launch } = launchFanOutMission({
      definition: propertyIntelligenceFanOutDefinition(),
      scopeId: dealId,
      store: new MissionGraphStore(),
    });
    await new Promise((resolve) => setTimeout(resolve, 60));

    // A brand-new store instance, as a later HTTP read or a restart would use.
    const view = readFanOutMission(READ_VIEW, dealId, new MissionGraphStore());
    expect(view.mission!.missionId).toBe(launch.missionId);
    expect(view.mission!.status).toBe('joined');
    expect(view.children).toHaveLength(3);
    // A Deal Card with no retained evidence and no comps yields a PARTIAL
    // context lane — an honest thin read, still a contribution.
    expect(view.children.map((c) => `${c.key}:${c.status}`)).toEqual([
      'parcel_identity:completed',
      'deal_context:partial',
      'market_coverage:completed',
    ]);
    expect(view.join!.contributed).toHaveLength(3);
    expect(view.history).toHaveLength(1);
  });
});
