// The representative Property Intelligence fan-out mission.
//
// This is the PROOF of the native mission graph, not the full research
// workflow. One operator action creates one parent mission which fans out to
// three specialist child missions, then joins their handbacks:
//
//   parcel_identity   (required)     → the accepted subject parcel identity
//        ├── deal_context      (required, consumes identity)
//        └── market_coverage   (supporting, consumes identity)
//
// Every child READS already-accepted LandOS data. No child calls a provider,
// opens a browser, spends a credit, or writes to a property, seller, evidence
// or Activity record. Running this mission cannot change accepted operator
// information.
//
// The full Property Intelligence workflow (ten specialists, live collectors)
// remains untouched in property-intelligence-mission.ts and is unaffected by
// this module.

import { getDealCard } from './deal-card.js';
import { getPropertyCard } from './property-card.js';
import { SEED_COUNTY_REF, SEEDED_REF_STATES } from './market-county-ref.js';
import type { MissionChildSpec } from './mission-graph.js';
import type { FanOutMissionDefinition, MissionChildContext, MissionChildOutcome } from './mission-graph-runner.js';

export const PROPERTY_INTELLIGENCE_FANOUT_KIND = 'property_intelligence_fanout';
export const PROPERTY_INTELLIGENCE_FANOUT_SCOPE = 'deal_card';

export const PROPERTY_INTELLIGENCE_FANOUT_CHILDREN: MissionChildSpec[] = [
  {
    key: 'parcel_identity',
    label: 'Parcel identity',
    purpose: 'Read the accepted subject parcel identity for this Deal Card: address, county, state, APN, owner and acreage.',
    role: 'required',
    dependsOn: [],
    timeoutMs: 30_000,
  },
  {
    key: 'deal_context',
    label: 'Deal context',
    purpose: 'Read the Deal Card rollups the identity belongs to: linked parcels, verification state, open risks, next actions and comps.',
    role: 'required',
    dependsOn: ['parcel_identity'],
    timeoutMs: 30_000,
  },
  {
    key: 'market_coverage',
    label: 'Market reference coverage',
    purpose: 'Report whether LandOS has seeded county market reference coverage for the subject county.',
    role: 'supporting',
    dependsOn: ['parcel_identity'],
    timeoutMs: 30_000,
  },
];

// ── Child handback shapes ───────────────────────────────────────────────────

export interface IdentityHandback {
  dealCardId: number;
  subjectCardId: number;
  identityState: 'confirmed' | 'provisional' | 'unresolved';
  verificationStatus: string;
  address: string | null;
  county: string | null;
  state: string | null;
  city: string | null;
  apn: string | null;
  owner: string | null;
  acres: number | null;
}

export interface DealContextHandback {
  dealCardId: number;
  title: string | null;
  propertyCount: number;
  hasVerifiedProperty: boolean;
  hasUnverifiedProperty: boolean;
  combinedAcres: number | null;
  combinedAcreageLabel: string | null;
  openRiskCount: number;
  openRisks: string[];
  nextActionCount: number;
  compCount: number;
  retainedEvidenceCount: number;
  offerUsableEvidenceCount: number;
}

export interface MarketCoverageHandback {
  county: string | null;
  state: string | null;
  fips: string | null;
  seededStateCoverage: boolean;
  seededCountyCoverage: boolean;
  seededCountiesInState: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const text = (value: unknown): string | null => {
  const raw = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
  return raw.length > 0 ? raw : null;
};

const num = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function subjectPropertyCardId(deal: { propertyCards?: unknown[] }): number | null {
  const first = (deal.propertyCards ?? [])[0] as { id?: unknown } | undefined;
  const id = num(first?.id);
  return id != null && Number.isInteger(id) ? id : null;
}

/** The Deal Card is the mission's scope row; a missing one is a hard block. */
function requireDeal(dealCardId: number) {
  const deal = getDealCard(dealCardId);
  if (!deal) throw new Error(`Deal Card ${dealCardId} does not exist.`);
  return deal;
}

// ── Child executors ─────────────────────────────────────────────────────────

/**
 * Parcel identity. Blocked (never failed) when the Deal Card has no subject
 * property card: nothing about a parcel can be asserted without one, and that
 * is an input gap, not a crash.
 */
export async function runIdentityChild(ctx: MissionChildContext): Promise<MissionChildOutcome> {
  const deal = requireDeal(ctx.scopeId);
  const cardId = subjectPropertyCardId(deal);
  if (cardId == null) {
    return {
      status: 'blocked',
      summary: 'No subject property card is linked to this Deal Card, so no parcel identity can be read. Nothing is asserted about a parcel.',
    };
  }
  const card = getPropertyCard(cardId);
  if (!card) {
    return {
      status: 'blocked',
      summary: `Subject property card ${cardId} is linked to this Deal Card but no longer exists, so no parcel identity can be read.`,
    };
  }

  const row = card as unknown as Record<string, unknown>;
  const verificationStatus = String(row.verification_status ?? 'unverified_lead');
  const address = text(row.active_input_address);
  const apn = text(row.apn);
  const identityState: IdentityHandback['identityState'] =
    verificationStatus === 'verified_property' ? 'confirmed' : address || apn ? 'provisional' : 'unresolved';

  const handback: IdentityHandback = {
    dealCardId: ctx.scopeId,
    subjectCardId: cardId,
    identityState,
    verificationStatus,
    address,
    county: text(row.county),
    state: text(row.state),
    city: text(row.city),
    apn,
    owner: text(row.owner),
    acres: num(row.acres),
  };

  if (identityState === 'unresolved') {
    return {
      status: 'blocked',
      summary: 'The subject property card carries neither an address nor an APN, so the parcel is not yet identified. Nothing parcel-specific is asserted.',
      result: handback,
    };
  }

  const label = handback.address ?? handback.apn ?? `card ${cardId}`;
  return {
    status: identityState === 'confirmed' ? 'completed' : 'partial',
    summary:
      identityState === 'confirmed'
        ? `Accepted parcel identity read for ${label}${handback.county ? ` (${handback.county} County${handback.state ? `, ${handback.state}` : ''})` : ''}. Verification status: ${verificationStatus}.`
        : `Provisional identity read for ${label}. The parcel is NOT verified (status: ${verificationStatus}), so parcel-specific conclusions remain unsupported.`,
    result: handback,
  };
}

/**
 * Deal context. Consumes the identity handback; the runner skips this child
 * outright when identity did not contribute.
 */
export async function runDealContextChild(ctx: MissionChildContext): Promise<MissionChildOutcome> {
  const identity = ctx.upstream.parcel_identity as IdentityHandback | undefined;
  const deal = requireDeal(ctx.scopeId) as unknown as Record<string, unknown>;

  const card = identity?.subjectCardId != null ? getPropertyCard(identity.subjectCardId) : undefined;
  const evidence = (card?.sourceEvidence ?? []) as Array<Record<string, unknown>>;
  const openRisks = ((card?.openRisks ?? []) as unknown[])
    .map((risk) => text(risk))
    .filter((risk): risk is string => !!risk);
  const combined = deal.combinedAcreage as { acres?: unknown; label?: unknown } | undefined;

  const handback: DealContextHandback = {
    dealCardId: ctx.scopeId,
    title: text(deal.title),
    propertyCount: num(deal.propertyCount) ?? 0,
    hasVerifiedProperty: deal.hasVerifiedProperty === true,
    hasUnverifiedProperty: deal.hasUnverifiedProperty === true,
    combinedAcres: num(combined?.acres),
    combinedAcreageLabel: text(combined?.label),
    openRiskCount: openRisks.length,
    openRisks,
    nextActionCount: Array.isArray(deal.nextActions) ? deal.nextActions.length : 0,
    compCount: num(deal.compCount) ?? 0,
    retainedEvidenceCount: evidence.length,
    offerUsableEvidenceCount: evidence.filter((row) => Number(row.usable_for_offer_logic) === 1).length,
  };

  // A read that finds no retained evidence is a real, honest result — the lane
  // succeeded, the card is simply thin. It is reported as partial so the parent
  // never presents an empty card as a complete context.
  const thin = handback.retainedEvidenceCount === 0 && handback.compCount === 0;
  return {
    status: thin ? 'partial' : 'completed',
    summary: thin
      ? `Deal context read: ${handback.propertyCount} linked parcel(s), ${handback.openRiskCount} open risk(s). No retained source evidence and no comps exist on this Deal Card yet, so there is little context to join.`
      : `Deal context read: ${handback.propertyCount} linked parcel(s), ${handback.retainedEvidenceCount} retained evidence item(s) (${handback.offerUsableEvidenceCount} offer-usable), ${handback.compCount} comp(s), ${handback.openRiskCount} open risk(s).`,
    result: handback,
  };
}

/**
 * Market reference coverage. Blocks honestly when the subject county has no
 * seeded reference row — a LandOS coverage gap, NOT evidence that the county
 * has no market.
 */
export async function runMarketCoverageChild(ctx: MissionChildContext): Promise<MissionChildOutcome> {
  const identity = ctx.upstream.parcel_identity as IdentityHandback | undefined;
  const county = identity?.county ?? null;
  const state = identity?.state ? identity.state.toUpperCase() : null;

  const norm = (value: string): string => value.replace(/\bcounty\b/i, '').trim().toLowerCase();
  const match = county && state
    ? SEED_COUNTY_REF.find((row) => row.state === state && norm(row.countyName) === norm(county))
    : undefined;
  const seededStateCoverage = !!state && SEEDED_REF_STATES.includes(state);
  const seededCountiesInState = state ? SEED_COUNTY_REF.filter((row) => row.state === state).length : 0;

  const handback: MarketCoverageHandback = {
    county,
    state,
    fips: match?.fips ?? null,
    seededStateCoverage,
    seededCountyCoverage: !!match,
    seededCountiesInState,
  };

  if (!county || !state) {
    return {
      status: 'blocked',
      summary: 'The subject parcel has no accepted county and state, so no market reference coverage can be reported.',
      result: handback,
    };
  }
  if (!match) {
    return {
      status: 'blocked',
      summary: `LandOS has no seeded county market reference for ${county} County, ${state}${seededStateCoverage ? ` (${seededCountiesInState} ${state} county/counties are seeded, this one is not)` : ' (no county in this state is seeded)'}. This is a LandOS coverage gap, not evidence that the county has no market.`,
      result: handback,
    };
  }
  return {
    status: 'completed',
    summary: `Seeded county market reference found for ${match.countyName} County, ${match.state} (FIPS ${match.fips}).`,
    result: handback,
  };
}

/** The mission definition the route layer launches. */
export function propertyIntelligenceFanOutDefinition(): FanOutMissionDefinition {
  return {
    kind: PROPERTY_INTELLIGENCE_FANOUT_KIND,
    label: 'Property Intelligence fan-out',
    scope: PROPERTY_INTELLIGENCE_FANOUT_SCOPE,
    children: PROPERTY_INTELLIGENCE_FANOUT_CHILDREN,
    executors: {
      parcel_identity: runIdentityChild,
      deal_context: runDealContextChild,
      market_coverage: runMarketCoverageChild,
    },
  };
}
