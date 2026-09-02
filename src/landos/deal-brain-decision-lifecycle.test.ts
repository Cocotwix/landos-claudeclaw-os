// Stage 4 LIFECYCLE BEHAVIOUR.
//
// The Deal Brain is the automatic decision layer above the Property Story, the
// Market Story and whatever the seller has actually said. This suite pins the
// behaviour the operator relies on:
//
//   FORMS      a settled research run produces a preliminary decision, never a
//              blank, even with no value and no seller.
//   HOLDS      an unchanged record writes nothing; an IMMATERIAL story change
//              writes nothing; only a moved material dimension supersedes.
//   EXPLAINS   a refreshed decision names the cause and the before → after of
//              every dimension that moved.
//   GROUNDS    seller claims come only from retained communications the seller
//              was actually in; operator messages and notes are refused.
//   ISOLATES   a seller interaction enriches the decision without moving one
//              property or market fact.
//
// Everything runs against an in-memory stand-in for the derived-snapshot seam
// that reproduces its two rules exactly: dedupe on the input hash, supersede
// rather than overwrite.

import { describe, expect, it } from 'vitest';

import type { PropertyFileSource } from './acquisition-intelligence-dossier.js';
import type { AcquisitionState, CommLogEntry } from './acquisitions.js';
import type { CanonicalSubjectState } from './canonical-subject-state.js';
import {
  ensureDealBrainDecision,
  diffMaterialDimensions,
  type DealBrainDecisionDeps,
  type RetainedDealDecision,
} from './deal-brain-decision.js';
import { DEAL_DECISION_SNAPSHOT, type IdentityEvidenceInput } from './deal-decision-synthesis.js';
import type { MarketMatrixResolution } from './market-matrix-read.js';
import type { MarketResearchAndPulse } from './market-research-and-pulse.js';
import type { PropertyEvidenceSynthesis } from './property-evidence-synthesis.js';
import {
  ensureResearchStableIntelligence,
  stage3ArtifactStatus,
  type ResearchStableIntelligenceDeps,
  type RetainedReading,
} from './research-stable-intelligence.js';
import { SELLER_DISCOVERY_SNAPSHOT, sellerReadStatusFor, type SellerDiscoverySynthesis } from './seller-discovery.js';
import type { SubjectUnderstandingResult } from './subject-understanding.js';

const now = () => new Date('2026-09-01T00:00:00.000Z');

// ── The retained record, as a fixture ──────────────────────────────────────

interface FileOptions {
  zoningEstablished?: boolean;
  recordedAccess?: boolean;
  supportedValue?: number;
  askingPrice?: number | null;
  /** An immaterial change: another retained capture. */
  extraVisual?: boolean;
  /** The subdivision read carries only a "Not researched." placeholder. */
  subdivisionPlaceholder?: boolean;
}

function file(options: FileOptions = {}): PropertyFileSource {
  return {
    dealCardId: 115,
    propertyCardId: 401,
    now,
    canonicalIdentity: { status: 'confirmed', confirmed: true },
    propertyIntelligence: {
      snapshot: {
        identity: {
          state: 'confirmed',
          displayAddress: '19554 NW 137th Ln', apn: '00083A03400',
          county: 'Bradford', city: 'Lake Butler', state_: 'FL', owner: 'HILL EUGENE W',
          acres: 1.5, acreageBasis: 'operator_accepted', hasParcelGeometry: true,
        },
      },
      landPortalFacts: {
        acres: 1.5,
        buildability: { pct: '56.09%', acres: '0.84 ac' },
        terrain: { slopeAvgPct: '1%' },
        environment: { femaFloodZone: 'X', wetlandsPct: '50.14%' },
        access: { landLocked: 'No', roadFrontageFt: 157.4 },
        valuation: { assessedValue: '$12,000.00', totalMarketValue: '$12,000.00', taxAmount: '$210.00' },
      },
      access: {
        established: true, frontageFt: 157.4, road: 'NW 137th Lane',
        recordedLegalAccess: options.recordedAccess ? 'Recorded 30 ft ingress/egress easement, OR Book 412 Page 88.' : undefined,
        evidence: { rungs: [], outstanding: [] },
      },
      landUseIntelligence: options.zoningEstablished
        ? { currentZoning: { established: true, statement: 'Zoned A-1 Agricultural.', districtCode: 'A-1', authorityName: 'Bradford County', references: [] } }
        : { currentZoning: { established: false, statement: 'Unresolved.', references: [] } },
      landUse: options.subdivisionPlaceholder
        ? { subdivision: { minimumLotArea: { value: null, unresolved: 'Not researched.' } } }
        : undefined,
      compsValuation: options.supportedValue
        ? { summary: { statusLabel: 'Supported', acceptedCount: 3, fmv: { low: options.supportedValue * 0.9, central: options.supportedValue, high: options.supportedValue * 1.1 }, basisLabel: 'Accepted closed sales' }, counts: {} }
        : { summary: { statusLabel: 'Not priceable', acceptedCount: 0 }, counts: {} },
    },
    dealCard: { people: [], asking_price: options.askingPrice ?? null },
    visuals: options.extraVisual ? [{ key: 'v2', label: 'Context capture', purpose: 'context', capturedAt: '2026-08-30T00:00:00.000Z', filePath: null }] : [],
  };
}

function subject(overrides: Partial<CanonicalSubjectState> = {}): CanonicalSubjectState {
  return {
    dealCardId: 115, propertyCardId: 401, subjectResolved: true, officiallyVerified: true,
    officialVerificationSource: 'Florida DEP statewide property-appraiser parcel layer', status: 'confirmed', source: 'identity_version',
    apn: '00083A03400', apnNormalized: '00083a03400', address: '19554 NW 137th Ln', city: 'Lake Butler',
    county: 'Bradford', state: 'FL', fips: '12007', zip: '32054', owner: 'HILL EUGENE W',
    subjectVersion: 'iv:137:v2#ac:1.5:operator_accepted', subjectVersionId: 137,
    governingAcreage: { value: 1.5, kind: 'operator_accepted', source: 'Operator-accepted governing acreage — Signed boundary survey held by the operator (document not yet supplied to LandOS)' },
    ...overrides,
  } as unknown as CanonicalSubjectState;
}

const understanding = (): SubjectUnderstandingResult => ({
  dealCardId: 115,
  outcome: 'research_ready',
  subject: {
    apn: '00083A03400', apnNormalized: '00083a03400', apnDisplayVariants: ['00083A03400'],
    address: '19554 NW 137th Ln', city: 'Lake Butler', county: 'Bradford', state: 'FL', zip: '32054',
    fips: null, owner: 'HILL EUGENE W', lpPropertyId: null, lpUrl: null, legalDescription: null, acres: 1.5,
    interest: { form: 'proposed_split', statement: 'A proposed split out of the seller\'s larger holding. Only the portion being conveyed is the subject.', excluded: [] },
    provenance: {},
    verification: { researchGrade: true, officiallyVerified: true, officialVerificationSource: 'Florida DEP parcel layer', outstanding: [] },
  } as unknown as SubjectUnderstandingResult['subject'],
  candidates: [], conflicts: [], question: null, evidence: [], excludedParcels: [],
  confidence: 0.95, persistable: true,
  audit: { actionsUsed: 0, stopReason: 'research_ready' } as unknown as SubjectUnderstandingResult['audit'],
});

const emptyMetrics = () => ({
  salesCount: null, listingCount: null, medianPrice: null, medianPricePerAcre: null,
  daysOnMarket: null, sellThroughRate: null, absorptionRate: null, monthsOfSupply: null,
  population: null, populationDensity: null, populationGrowth: null, salesDensity: null,
});

function marketResolver(input: { acreageBand?: string }): MarketMatrixResolution {
  const band = input.acreageBand ?? 'all';
  const carried = band === '1-2' || band === '10-20';
  return {
    matchLevel: carried ? 'county' : 'unavailable',
    available: carried,
    geography: { state: 'FL', county: 'Bradford', fips: '12007' },
    resolvedKey: carried ? 'county:12007' : null,
    resolvedKeyLabel: carried ? `Bradford County (${band} acres)` : null,
    acreageBandRequested: band as MarketMatrixResolution['acreageBandRequested'],
    acreageBandUsed: carried ? (band as MarketMatrixResolution['acreageBandUsed']) : null,
    bandFallback: null,
    side: 'sold',
    period: carried ? '2026-Q3' : null,
    confidence: carried ? 'high' : null,
    source: carried ? 'LandPortal Market Research' : null,
    provider: carried ? 'LandPortal' : null,
    staleness: { label: carried ? 'Current quarter' : 'No snapshot', quartersOld: carried ? 0 : null, isStale: false },
    facts: { pricePerAcre: null, daysOnMarket: null, sellThroughRate: null, populationGrowth: null, liquidity: null },
    metrics: carried
      ? { ...emptyMetrics(), salesCount: band === '1-2' ? 20 : 21, medianPricePerAcre: band === '1-2' ? 28008 : 14526, daysOnMarket: 37, sellThroughRate: 71.43, monthsOfSupply: 17.03 }
      : null,
    talkingPoints: [],
    note: carried ? 'Resolved via County match.' : 'No Market Matrix snapshot for this band.',
  };
}

// ── A stand-in for the derived-snapshot seam ───────────────────────────────

interface StoredSnapshot {
  id: number;
  version: number;
  snapshotType: string;
  identityVersionId: number;
  inputHash: string;
  status: 'current' | 'superseded';
  payload: unknown;
}

function seam() {
  const rows: StoredSnapshot[] = [];
  const identity = { current: 137 };
  let nextId = 1;
  let nextVersion = 1;
  const writeSnapshot: ResearchStableIntelligenceDeps['writeSnapshot'] = (input) => {
    const identityVersionId = identity.current;
    const inputHash = JSON.stringify({ identityVersionId, snapshotType: input.snapshotType, payload: input.payload });
    const existing = rows.find((row) => row.inputHash === inputHash);
    if (existing?.status === 'current') return { snapshotId: existing.id, reused: true, propertyIdentityVersionId: identityVersionId, skippedReason: null };
    if (existing) {
      // Mirrors the seam: an identical, superseded reading is reinstated when
      // the record returns to that state.
      const current = rows.find((row) => row.snapshotType === input.snapshotType && row.status === 'current');
      if (current && current !== existing) current.status = 'superseded';
      existing.status = 'current';
      return { snapshotId: existing.id, reused: true, reinstated: true, propertyIdentityVersionId: identityVersionId, skippedReason: null };
    }
    const prior = rows.find((row) => row.snapshotType === input.snapshotType && row.status === 'current');
    if (prior) prior.status = 'superseded';
    const row: StoredSnapshot = { id: nextId++, version: nextVersion++, snapshotType: input.snapshotType, identityVersionId, inputHash, status: 'current', payload: input.payload };
    rows.push(row);
    return { snapshotId: row.id, reused: false, propertyIdentityVersionId: identityVersionId, skippedReason: null };
  };
  const currentOf = (snapshotType: string) => rows.find((row) => row.snapshotType === snapshotType && row.status === 'current') ?? null;
  const reading = <T,>(snapshotType: string): RetainedReading<T> | null => {
    const row = currentOf(snapshotType);
    if (!row) return null;
    return {
      value: row.payload as T,
      correlation: row.identityVersionId === identity.current ? 'equivalent' : 'uncorrelated',
      retainedAt: '2026-09-01T00:00:00.000Z',
      snapshotId: row.id,
    };
  };
  return {
    rows, identity, writeSnapshot, currentOf, reading,
    versionsOf: (snapshotType: string) => rows.filter((row) => row.snapshotType === snapshotType).length,
  };
}

// ── The harness ────────────────────────────────────────────────────────────

/** The retained record behind Deal 115's identity: the Florida DEP parcel
 *  layer behind the verified card, with the source-evidence row that supports
 *  the parcel identity. */
const identityEvidence = (overrides: Partial<IdentityEvidenceInput> = {}): IdentityEvidenceInput => ({
  propertyCardId: 401,
  verificationStatus: 'verified_property',
  verificationSource: 'Florida DEP statewide property-appraiser parcel layer (Cadastral 2023)',
  apn: '00083A03400', county: 'Bradford', state: 'FL', fips: null,
  records: [
    { recordId: 'property card 401 · source evidence #108', fact: 'Parcel identity', sourceUrl: 'https://ca.dep.state.fl.us/arcgis/rest/services/Map_Direct/Boundaries/MapServer/16/query', accessedAt: '2026-08-31T17:31:23.049Z', note: 'Official public parcel record; supports parcel identity.' },
    { recordId: 'property card 401 · source evidence #110', fact: 'APN', sourceUrl: 'https://ca.dep.state.fl.us/arcgis/rest/services/Map_Direct/Boundaries/MapServer/16/query', accessedAt: '2026-08-31T17:31:23.049Z', note: 'Official public parcel record; supports apn.' },
  ],
  ...overrides,
});

const emptyAcquisition = (): AcquisitionState => ({ dealCardId: 115, stage: 'new_lead', profile: {}, commLog: [], discovery: [], updatedAt: null });

function harness(options: FileOptions = {}) {
  const store = seam();
  const state = { file: file(options), subject: subject(), acquisition: emptyAcquisition(), identityEvidence: identityEvidence() as IdentityEvidenceInput | null };
  const storyDeps: ResearchStableIntelligenceDeps = {
    readPropertyFile: () => state.file,
    readSubject: () => state.subject,
    readUnderstanding: understanding,
    resolveMarket: marketResolver as never,
    writeSnapshot: store.writeSnapshot,
    now,
  };
  const decisionDeps = (cause: string): DealBrainDecisionDeps => ({
    readPropertyFile: () => state.file,
    readSubject: () => state.subject,
    readAcquisition: () => state.acquisition,
    readSellerStatedFacts: () => [],
    readIdentityEvidence: () => state.identityEvidence,
    readPropertyStory: () => store.reading<PropertyEvidenceSynthesis>('property_evidence_synthesis_v1'),
    readMarketStory: () => store.reading<MarketResearchAndPulse>('market_research_pulse_v1'),
    readCurrentDecision: () => store.reading<RetainedDealDecision>(DEAL_DECISION_SNAPSHOT),
    writeSnapshot: store.writeSnapshot,
    cause,
  });
  return {
    store,
    state,
    /** The Stage 3 completion boundary, now carrying Stage 4 behind it. */
    completion: (trigger = 'coverage:operator') => {
      const stories = ensureResearchStableIntelligence(115, storyDeps);
      if (!stories.property || !stories.market) return { stories, decision: null };
      const decision = ensureDealBrainDecision(115, {
        ...decisionDeps(trigger),
        stories: {
          property: stories.property,
          market: stories.market,
          propertySnapshotId: stories.persistence.property.snapshotId,
          marketSnapshotId: stories.persistence.market.snapshotId,
        },
      });
      return { stories, decision };
    },
    /** A seller-record event. Reads the retained stories; never re-forms them. */
    sellerEvent: (cause = 'seller:communication_added') => ensureDealBrainDecision(115, decisionDeps(cause)),
    currentDecision: () => store.currentOf(DEAL_DECISION_SNAPSHOT)?.payload as RetainedDealDecision | undefined,
    currentDiscovery: () => store.currentOf(SELLER_DISCOVERY_SNAPSHOT)?.payload as SellerDiscoverySynthesis | undefined,
  };
}

const comm = (entry: Partial<CommLogEntry> & Pick<CommLogEntry, 'at' | 'channel' | 'direction' | 'summary'>): CommLogEntry => ({
  createdAt: entry.at, ...entry,
});

// ── 1. A settled run forms a preliminary decision ──────────────────────────

describe('a settled research run forms a preliminary decision', () => {
  it('produces the Deal 115 posture: continue targeted diligence, no offer range, with the missing evidence named', () => {
    const h = harness();
    const { decision } = h.completion();

    expect(decision?.outcome).toBe('produced');
    const read = h.currentDecision()!;
    expect(read.mode).toBe('preliminary_acquisition_posture');
    expect(read.recommendation.kind).toBe('continue_diligence');
    expect(read.recommendation.statement).toBe('Continue targeted diligence; do not establish an offer range yet.');

    // The rationale names the missing qualified sale/value support, the zoning
    // and access needs, and the absent seller price/motivation.
    const rationale = read.recommendation.rationale.join(' ');
    expect(rationale).toMatch(/Qualified sale and value support/);
    expect(rationale).toMatch(/Zoning and permitted use/);
    expect(rationale).toMatch(/Legal access/);
    expect(rationale).toMatch(/Seller price and motivation/);

    // No price, with an explicit rationale rather than silence.
    expect(read.value.status).toBe('withheld');
    expect(read.value.offerGuidance).toBeNull();
    expect(read.value.noPriceRationale).toMatch(/No fair market value is asserted/);

    // Seller: no communications, nothing inferred.
    expect(read.seller.status).toBe('no_communications');
    expect(read.seller.claims).toHaveLength(0);
    expect(read.seller.statement).toMatch(/nothing about them is inferred/);

    // One LandOS action and one operator action, each naming what it unlocks.
    expect(read.nextActions.landos.capabilityId).toBe('comps-valuation');
    expect(read.nextActions.landos.action).toMatch(/closed vacant-land sales/);
    expect(read.nextActions.operator.action).toMatch(/first contact with the seller/i);
    expect(read.nextActions.operator.unlocks).toBeTruthy();

    // Subject, stories, exits, risks and opportunities are all carried.
    expect(read.subject.apn).toBe('00083A03400');
    expect(read.subject.acres).toBe(1.5);
    expect(read.subject.confidence).toBe('confirmed');
    expect(read.subject.caveats.some((caveat) => /survey/i.test(caveat))).toBe(true);
    expect(read.propertyStory?.headline).toContain('1.5 acre');
    expect(read.marketStory?.subjectBand.label).toBe('1–2 acres');
    expect(read.marketStory?.mostLiquidBand?.label).toBe('10–20 acres');
    expect(read.exitStrategies.length).toBeGreaterThanOrEqual(6);
    for (const strategy of read.exitStrategies) {
      expect(strategy.keyRequirement).toBeTruthy();
      expect(strategy.criticalGate).toBeTruthy();
      expect(strategy.economicBasis).toBeTruthy();
    }
    expect(read.exitStrategies.find((strategy) => strategy.id === 'subdivision_minor_split')?.status).toBe('not_supported');
    expect(read.risks[0].magnitude).toBe('high');
    expect(read.risks.map((risk) => risk.rank)).toEqual(read.risks.map((_risk, index) => index + 1));
    expect(read.opportunities.length).toBeGreaterThan(0);
    expect(read.refresh.kind).toBe('initial');
    expect(read.refresh.changes).toEqual([]);
    expect(read.refresh.cause).toBe('coverage:operator');
    expect(read.basedOn.propertySnapshotId).not.toBeNull();
  });

  it('reads a "Not researched." subdivision placeholder as an absence, not a lot size', () => {
    const h = harness({ subdivisionPlaceholder: true });
    h.completion();
    const split = h.currentDecision()!.exitStrategies.find((strategy) => strategy.id === 'subdivision_minor_split')!;
    expect(split.status).toBe('not_supported');
    expect(split.statusWhy).not.toMatch(/Not researched/);
  });

  it('forms a seller discovery brief from the open deal questions, each with the gap that raised it', () => {
    const h = harness();
    h.completion();
    const discovery = h.currentDiscovery()!;
    expect(discovery.status).toBe('no_communications');
    expect(discovery.planning.planned).toBe(false);
    const keys = discovery.brief.questions.map((question) => question.key);
    expect(keys).toEqual(expect.arrayContaining(['motivation', 'price', 'timeline', 'decision_maker', 'access', 'survey', 'split', 'zoning', 'well_septic', 'title']));
    for (const question of discovery.brief.questions) {
      expect(question.basis).toBeTruthy();
      expect(question.why).toBeTruthy();
      expect(question.answeredBy).toEqual([]);
    }
    expect(discovery.brief.doNotAssume.join(' ')).toMatch(/Do not quote a value/);
    expect(discovery.brief.doNotAssume.join(' ')).toMatch(/Do not infer motivation/);
  });

  it('never leaves the Deal Brain blank when value and seller data are incomplete', () => {
    const h = harness();
    const { decision } = h.completion();
    expect(decision?.decision).not.toBeNull();
    expect(decision?.decision?.recommendation.statement.length).toBeGreaterThan(20);
  });

  it('reports awaiting_intelligence, not an error, before a Property Story exists', () => {
    const h = harness();
    const result = h.sellerEvent();
    expect(result.outcome).toBe('awaiting_intelligence');
    expect(result.reason).toMatch(/No current Property Story/);
    expect(h.store.rows).toHaveLength(0);
  });
});

// ── 2. Holding still ───────────────────────────────────────────────────────

describe('the decision holds still unless material evidence moves', () => {
  it('repeating the completion over an unchanged record writes nothing', () => {
    const h = harness();
    h.completion();
    const versions = h.store.rows.length;
    const second = h.completion('coverage:mission');
    expect(second.decision?.outcome).toBe('unchanged');
    expect(h.store.rows.length).toBe(versions);
    expect(h.store.versionsOf(DEAL_DECISION_SNAPSHOT)).toBe(1);
  });

  it('an immaterial story change (a new retained capture) supersedes the story but not the decision', () => {
    const h = harness();
    h.completion();
    const decisionVersions = h.store.versionsOf(DEAL_DECISION_SNAPSHOT);
    h.state.file = file({ extraVisual: true });
    const second = h.completion('coverage:evidence_upload');
    expect(second.stories.outcome).toBe('produced');
    expect(second.decision?.outcome).toBe('unchanged');
    expect(second.decision?.reason).toMatch(/No material/);
    expect(h.store.versionsOf(DEAL_DECISION_SNAPSHOT)).toBe(decisionVersions);
  });

  it('a seller-record event over unchanged communications writes nothing', () => {
    const h = harness();
    h.completion();
    const before = h.store.rows.length;
    const result = h.sellerEvent('seller:profile_updated');
    expect(result.outcome).toBe('unchanged');
    expect(h.store.rows.length).toBe(before);
  });
});

// ── 3. Seller interaction enriches without moving the subject ──────────────

describe('a seller interaction enriches and refreshes the same decision', () => {
  const sellerText = comm({
    id: 'c1', type: 'text', at: '2026-09-02T15:00:00.000Z', channel: 'text', direction: 'inbound',
    summary: 'Seller replied by text.',
    body: 'Hi Tyler. We inherited the land from my dad and nobody uses it. We were hoping to get $45,000 for it. My sister has to agree too. No rush, but by spring would be ideal. There is an old easement to the road from the neighbor, I can send the paperwork.',
  });

  it('extracts motivation, price, timeline, decision maker and commitments only from the retained message', () => {
    const h = harness();
    h.completion();
    h.state.acquisition = { ...emptyAcquisition(), commLog: [sellerText] };
    const result = h.sellerEvent('seller:communication_added');

    expect(result.outcome).toBe('produced');
    const discovery = h.currentDiscovery()!;
    expect(discovery.status).toBe('communications_read');
    expect(discovery.extraction.motivation.latest?.statement).toMatch(/inherited/);
    expect(discovery.extraction.price.latest?.statement).toMatch(/\$45,000/);
    expect(discovery.extraction.timeline.latest?.statement).toMatch(/spring/);
    expect(discovery.extraction.decision_maker.latest?.statement).toMatch(/sister/);
    expect(discovery.extraction.commitment.latest?.statement).toMatch(/send the paperwork/);
    expect(discovery.extraction.property_claim.count).toBeGreaterThan(0);
    for (const claim of discovery.claims) {
      expect(claim.source.kind).toBe('seller_message');
      expect(claim.source.attribution).toMatch(/SELLER STATEMENT/);
      expect(claim.standing).toBe('seller_reported');
    }
    // The access question is now answered by the seller's easement remark.
    const access = discovery.brief.questions.find((question) => question.key === 'access')!;
    expect(access.answeredBy.length).toBeGreaterThan(0);
    expect(discovery.unanswered).not.toContain('price');
  });

  it('refreshes the decision, names the cause and the dimensions that moved, and leaves property and market facts untouched', () => {
    const h = harness();
    h.completion();
    const initial = h.currentDecision()!;
    h.state.acquisition = { ...emptyAcquisition(), commLog: [sellerText] };
    const result = h.sellerEvent('seller:communication_added');
    const refreshed = h.currentDecision()!;

    expect(result.outcome).toBe('produced');
    expect(h.store.versionsOf(DEAL_DECISION_SNAPSHOT)).toBe(2);
    expect(refreshed.refresh.kind).toBe('material');
    expect(refreshed.refresh.cause).toBe('seller:communication_added');
    expect(refreshed.refresh.priorSnapshotId).toBe(initial.basedOn.sellerDiscoverySnapshotId! + 1);
    const moved = refreshed.refresh.changes.map((change) => change.dimension);
    expect(moved).toEqual(expect.arrayContaining(['seller', 'seller.motivation', 'seller.price', 'seller.timeline', 'seller.decision_maker']));
    expect(moved).not.toContain('subject');
    expect(moved).not.toContain('zoning');
    expect(moved).not.toContain('access');
    expect(moved).not.toContain('market');
    expect(moved).not.toContain('value');

    // Enriched: the seller status carries the claims, the evidence row moved.
    expect(refreshed.seller.status).toBe('communications_retained');
    expect(refreshed.evidence.find((row) => row.key === 'seller')?.status).toBe('sufficient');
    expect(refreshed.opportunities.some((item) => item.standing === 'seller_reported')).toBe(true);
    // Not moved: the property and market subject facts.
    expect(refreshed.subject).toEqual(initial.subject);
    expect(refreshed.propertyStory).toEqual(initial.propertyStory);
    expect(refreshed.marketStory).toEqual(initial.marketStory);
    expect(refreshed.basedOn.propertySnapshotId).toBe(initial.basedOn.propertySnapshotId);
    // Value is still unsupported, so the posture stays preliminary.
    expect(refreshed.mode).toBe('preliminary_acquisition_posture');
    expect(refreshed.recommendation.kind).toBe('continue_diligence');
    expect(refreshed.value.askingPriceSource).toMatch(/Seller communication only/);
    // The seller's easement remark is a seller-reported claim: it never moves
    // the access evidence row, which only a retained record can establish.
    expect(refreshed.evidence.find((row) => row.key === 'access')?.status).toBe(initial.evidence.find((row) => row.key === 'access')?.status);
    expect(refreshed.evidence.find((row) => row.key === 'access')?.status).not.toBe('sufficient');
    for (const claim of refreshed.seller.claims) {
      expect(claim.speaker).toMatch(/seller \(inbound text\)/);
      expect(['high', 'medium', 'low']).toContain(claim.confidence);
    }
  });

  it('a later communication that moves the price refreshes once more, and removing it refreshes again without deleting history', () => {
    const h = harness();
    h.completion();
    h.state.acquisition = { ...emptyAcquisition(), commLog: [sellerText] };
    h.sellerEvent('seller:communication_added');
    expect(h.currentDecision()!.materialDimensions['seller.price']).toMatch(/\$45,000/);

    // Reprocessing the unchanged record writes nothing.
    const repeat = h.sellerEvent('seller:communication_updated');
    expect(repeat.outcome).toBe('unchanged');
    expect(h.store.versionsOf(DEAL_DECISION_SNAPSHOT)).toBe(2);

    // A material update: the seller withdraws the number and states a new one.
    const correction = comm({
      id: 'c2', type: 'text', at: '2026-09-05T15:00:00.000Z', channel: 'text', direction: 'inbound',
      summary: 'Seller texted again.',
      body: 'Forget the $45,000, we would take $38,000 if it closes before spring.',
    });
    h.state.acquisition = { ...emptyAcquisition(), commLog: [sellerText, correction] };
    const moved = h.sellerEvent('seller:communication_added');
    expect(moved.outcome).toBe('produced');
    expect(h.store.versionsOf(DEAL_DECISION_SNAPSHOT)).toBe(3);
    const third = h.currentDecision()!;
    expect(third.refresh.changes.map((change) => change.dimension)).toContain('seller.price');
    expect(third.materialDimensions['seller.price']).toMatch(/\$38,000/);
    expect(third.seller.historicalClaims).toBeGreaterThan(0);
    const discovery = h.currentDiscovery()!;
    expect(discovery.claims.find((claim) => claim.value === '$45,000')?.status).toBe('historical');
    // Price moved, and so did the timeline ("no rush" → "before spring").
    expect(discovery.conflicts.map((conflict) => conflict.dimension).sort()).toEqual(['price', 'timeline']);
    // The same again writes nothing.
    expect(h.sellerEvent('seller:communication_updated').outcome).toBe('unchanged');
    expect(h.store.versionsOf(DEAL_DECISION_SNAPSHOT)).toBe(3);

    // Removing the correction removes its claims; the decision refreshes with
    // the deletion as its cause, and every prior version remains in the store.
    h.state.acquisition = { ...emptyAcquisition(), commLog: [sellerText] };
    const removed = h.sellerEvent('seller:communication_deleted');
    expect(removed.outcome).toBe('produced');
    expect(h.store.versionsOf(DEAL_DECISION_SNAPSHOT)).toBe(4);
    const fourth = h.currentDecision()!;
    expect(fourth.refresh.cause).toBe('seller:communication_deleted');
    expect(fourth.materialDimensions['seller.price']).toMatch(/\$45,000/);
    expect(h.currentDiscovery()!.claims.some((claim) => claim.value === '$38,000')).toBe(false);
    expect(h.store.rows.filter((row) => row.snapshotType === DEAL_DECISION_SNAPSHOT && row.status === 'superseded')).toHaveLength(3);
    // Property and market facts never moved through any of it.
    expect(fourth.propertyStory).toEqual(third.propertyStory);
    expect(fourth.marketStory).toEqual(third.marketStory);
  });

  it('refuses an outbound operator message and an operator note as claim sources', () => {
    const h = harness();
    h.completion();
    h.state.acquisition = {
      ...emptyAcquisition(),
      commLog: [
        comm({ id: 'o1', type: 'text', at: '2026-09-02T14:00:00.000Z', channel: 'text', direction: 'outbound', summary: 'Sent intro text.', body: 'Hi, I could offer around $30,000 for the land. We inherited it? Let me know.' }),
        comm({ id: 'n1', type: 'note', at: '2026-09-02T14:05:00.000Z', channel: 'other', direction: 'outbound', summary: 'Operator note.', body: 'Owner probably wants $50,000 and is retiring; they want to sell by winter.' }),
      ],
    };
    const result = h.sellerEvent('seller:communication_added');
    const discovery = h.currentDiscovery()!;
    expect(discovery.status).toBe('no_communications');
    expect(discovery.claims).toHaveLength(0);
    expect(discovery.refusals).toHaveLength(2);
    expect(discovery.refusals.map((refusal) => refusal.reason).join(' ')).toMatch(/operator's own words/i);
    expect(discovery.refusals.map((refusal) => refusal.reason).join(' ')).toMatch(/Operator-authored/);
    // Nothing material moved, so the decision stands.
    expect(result.outcome).toBe('unchanged');
    expect(h.store.versionsOf(DEAL_DECISION_SNAPSHOT)).toBe(1);
  });

  it('passes when the seller has said they are not selling', () => {
    const h = harness();
    h.completion();
    h.state.acquisition = {
      ...emptyAcquisition(),
      commLog: [comm({ id: 'c2', type: 'call', at: '2026-09-03T10:00:00.000Z', channel: 'call', direction: 'outbound', summary: 'Spoke with the owner: not interested in selling right now.' })],
    };
    h.sellerEvent();
    const decision = h.currentDecision()!;
    expect(decision.recommendation.kind).toBe('pass');
    expect(decision.recommendation.rationale[0]).toMatch(/not interested in selling/);
  });
});

// ── 4. The offer posture ───────────────────────────────────────────────────

describe('the offer / strategy posture forms only on sufficient source-backed evidence', () => {
  const sellerPrice = (price: number) => comm({
    id: 'c3', type: 'call', at: '2026-09-04T10:00:00.000Z', channel: 'call', direction: 'inbound',
    summary: `Owner called back. They are asking $${price.toLocaleString('en-US')} and want to sell because they moved out of state.`,
  });

  it('stays preliminary while value is supported but zoning, access or seller are not', () => {
    const h = harness({ supportedValue: 40_000 });
    h.completion();
    const decision = h.currentDecision()!;
    expect(decision.value.status).toBe('supported');
    expect(decision.value.offerGuidance).toEqual(expect.objectContaining({ low: 16_000, high: 24_000, confirmed: true }));
    expect(decision.mode).toBe('preliminary_acquisition_posture');
    expect(decision.modeWhy).toMatch(/zoning and permitted use, legal access, seller price and motivation/);
    // Value is supported, so LandOS moves to the next gap it can close itself.
    expect(decision.nextActions.landos.capabilityId).toBe('zoning-subdivision');
  });

  it('recommends an offer inside the confirmed flip band when everything required is sufficient', () => {
    const h = harness({ supportedValue: 40_000, zoningEstablished: true, recordedAccess: true });
    h.completion();
    h.state.acquisition = { ...emptyAcquisition(), commLog: [sellerPrice(20_000)] };
    h.sellerEvent();
    const decision = h.currentDecision()!;
    expect(decision.mode).toBe('offer_strategy_posture');
    expect(decision.recommendation.kind).toBe('make_offer');
    expect(decision.recommendation.statement).toMatch(/\$16,000–\$24,000/);
    expect(decision.exitStrategies.find((strategy) => strategy.id === 'quick_flip')?.status).toBe('supported');
    expect(decision.nextActions.operator.action).toMatch(/Present an offer/);
  });

  it('recommends renegotiation when the asking price on file sits above the supported band', () => {
    const h = harness({ supportedValue: 40_000, zoningEstablished: true, recordedAccess: true, askingPrice: 60_000 });
    h.completion();
    h.state.acquisition = { ...emptyAcquisition(), commLog: [sellerPrice(60_000)] };
    h.sellerEvent();
    const decision = h.currentDecision()!;
    expect(decision.mode).toBe('offer_strategy_posture');
    expect(decision.recommendation.kind).toBe('renegotiate');
    expect(decision.value.askingVsGuidance).toMatch(/above/);
  });

  it('asks for information rather than more research when only the seller side is missing', () => {
    const h = harness({ supportedValue: 40_000, zoningEstablished: true, recordedAccess: true });
    h.completion();
    const decision = h.currentDecision()!;
    expect(decision.mode).toBe('preliminary_acquisition_posture');
    expect(decision.recommendation.kind).toBe('request_information');
    expect(decision.recommendation.statement).toMatch(/first contact with the seller/i);
  });
});

// ── 5. Currentness ─────────────────────────────────────────────────────────

describe('a decision formed about another parcel version is history, not truth', () => {
  it('forms an initial decision again when the accepted subject moved', () => {
    const h = harness();
    h.completion();
    // The subject moves to a new identity version: the retained stories and
    // decision correlate as uncorrelated, and the completion re-forms both.
    h.store.identity.current = 138;
    h.state.subject = subject({ subjectVersion: 'iv:138:v1', subjectVersionId: 138 });
    const { decision } = h.completion('coverage:subject_promotion');
    expect(decision?.outcome).toBe('produced');
    const current = h.currentDecision()!;
    expect(current.refresh.kind).toBe('initial');
    expect(current.refresh.priorSnapshotId).toBeNull();
    expect(current.basedOn.subjectVersion).toBe('iv:138:v1');
    expect(h.store.versionsOf(DEAL_DECISION_SNAPSHOT)).toBe(2);
  });
});

// ── 6. The diff itself ─────────────────────────────────────────────────────

describe('diffMaterialDimensions', () => {
  it('reports every dimension that moved, before and after, and nothing else', () => {
    expect(diffMaterialDimensions({ a: '1', b: '2' }, { a: '1', b: '3', c: '4' })).toEqual([
      { dimension: 'b', before: '2', after: '3' },
      { dimension: 'c', before: null, after: '4' },
    ]);
    expect(diffMaterialDimensions(null, { a: '1' })).toEqual([{ dimension: 'a', before: null, after: '1' }]);
  });
});

// ── 7. Contract changes re-form, and are labelled as such ──────────────────

describe('a decision formed under an older contract is re-formed, not trusted', () => {
  it('supersedes the prior decision with kind `contract` and no material changes', () => {
    const h = harness();
    h.completion();
    const current = h.store.currentOf(DEAL_DECISION_SNAPSHOT)!;
    // Age the retained row: an earlier contract, same material substance.
    current.payload = { ...(current.payload as RetainedDealDecision), contractVersion: '0.9.0' };
    current.inputHash = 'aged';
    const result = h.sellerEvent('startup:settled_intelligence');
    expect(result.outcome).toBe('produced');
    const refreshed = h.currentDecision()!;
    expect(refreshed.refresh.kind).toBe('contract');
    expect(refreshed.refresh.changes).toEqual([]);
    expect(refreshed.refresh.priorSnapshotId).toBe(current.id);
    expect(h.store.versionsOf(DEAL_DECISION_SNAPSHOT)).toBe(2);
  });
});

// ── 6. One status for the Stage 3 inputs, one lineage for the identity ─────

describe('the Overview cards and the Deal Brain read one Stage 3 status', () => {
  it('a current subject-equivalent Property Story and Market Story never render as unknown or pending', () => {
    const h = harness();
    h.completion();
    const decision = h.currentDecision()!;
    const property = h.store.reading<PropertyEvidenceSynthesis>('property_evidence_synthesis_v1');
    const market = h.store.reading<MarketResearchAndPulse>('market_research_pulse_v1');
    const propertyStatus = stage3ArtifactStatus('property_story', property, { dealCardId: 115, consumedSnapshotId: decision.basedOn.propertySnapshotId });
    const marketStatus = stage3ArtifactStatus('market_story', market, { dealCardId: 115, consumedSnapshotId: decision.basedOn.marketSnapshotId });
    for (const status of [propertyStatus, marketStatus]) {
      expect(['current', 'partial_current']).toContain(status.status);
      expect(status.label).not.toMatch(/unknown|pending/i);
      expect(status.snapshotId).not.toBeNull();
      expect(status.contractVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(status.consumedByDealBrain).toBe(true);
      expect(status.link).toMatch(/\/dept\/acquisitions\/v2\?deal=115&page=(property|market)/);
    }
    // Deal 115 carries material gaps, so the Property Story is partial, with the gap named.
    expect(propertyStatus.status).toBe('partial_current');
    expect(propertyStatus.label).toBe('Partial — current');
    expect(propertyStatus.coverage).toMatch(/\d+\/\d+ diligence topics established/);
    expect(propertyStatus.limitation).toMatch(/not established/);
    expect(propertyStatus.subjectVersion).toBe('iv:137:v2#ac:1.5:operator_accepted');
    // The decision recorded the very same rows as its inputs.
    expect(decision.inputs.property.snapshotId).toBe(property!.snapshotId);
    expect(decision.inputs.market.snapshotId).toBe(market!.snapshotId);
    expect(decision.inputs.property.status).toBe(propertyStatus.status);
    expect(decision.inputs.market.status).toBe(marketStatus.status);
  });

  it('a missing artifact is pending and is named as pending, never as a current story', () => {
    const pending = stage3ArtifactStatus('market_story', null, { dealCardId: 115, stabilityReason: 'Research is not stable.' });
    expect(pending.status).toBe('pending');
    expect(pending.label).toBe('Pending / No current read');
    expect(pending.snapshotId).toBeNull();
    expect(pending.consumedByDealBrain).toBe(false);
    expect(pending.limitation).toMatch(/full current Market Story is pending/);
  });

  it('a stale, different-parcel or uncorrelated artifact stays historical and is excluded from the current decision', () => {
    const h = harness();
    h.completion();
    const property = h.store.reading<PropertyEvidenceSynthesis>('property_evidence_synthesis_v1')!;
    for (const correlation of ['different', 'uncorrelated'] as const) {
      const status = stage3ArtifactStatus('property_story', { ...property, correlation }, { dealCardId: 115, consumedSnapshotId: property.snapshotId });
      expect(status.status).toBe('historical');
      expect(status.label).toBe('Historical');
      expect(status.consumedByDealBrain).toBe(false);
      expect(status.limitation).toMatch(/excluded from current Deal Brain inputs/);
    }
    // And the lifecycle itself refuses such a reading as an input.
    h.store.identity.current = 999;
    const result = h.sellerEvent('seller:profile_updated');
    expect(result.outcome).toBe('awaiting_intelligence');
  });
});

describe('the identity wording is source-exact', () => {
  it('names the exact Florida DEP record, its identifier, matched fields, retrieval date and subject version', () => {
    const h = harness();
    h.completion();
    const subject = h.currentDecision()!.subject;
    expect(subject.confidence).toBe('confirmed');
    expect(subject.verification.officiallyVerified).toBe(true);
    expect(subject.verification.statement).not.toMatch(/an official parcel record confirms/i);
    expect(subject.verification.statement).toContain('Florida DEP statewide property-appraiser parcel layer (Cadastral 2023)');
    expect(subject.verification.statement).toContain('property card 401 · source evidence #108');
    expect(subject.verification.statement).toContain('via ca.dep.state.fl.us');
    expect(subject.verification.statement).toContain('retrieved 2026-08-31');
    expect(subject.verification.statement).toContain('APN 00083A03400, Bradford County, FL matched');
    expect(subject.verification.statement).toContain('accepted subject iv:137:v2#ac:1.5:operator_accepted');
    const lineage = subject.verification.lineage;
    expect(lineage.reached).toBe(true);
    expect(lineage.sourceType).toBe('official_parcel_record');
    expect(lineage.observedAt).toBe('2026-08-31T17:31:23.049Z');
    expect(lineage.distinctions.join(' ')).toMatch(/Official-record evidence/);
    expect(lineage.distinctions.join(' ')).toMatch(/Operator acceptance: the governing acreage 1.5 ac is operator-accepted/);
    expect(lineage.distinctions.join(' ')).toMatch(/earlier identity versions are retained as historical evidence/);
  });

  it('states "observation date not recorded" when the record carries no date', () => {
    const h = harness();
    h.state.identityEvidence = identityEvidence({ records: [{ recordId: 'property card 401 · source evidence #108', fact: 'Parcel identity', sourceUrl: null, accessedAt: null, note: null }] });
    h.completion();
    const lineage = h.currentDecision()!.subject.verification.lineage;
    expect(lineage.reached).toBe(true);
    expect(lineage.observedAtStatement).toBe('observation date not recorded');
    expect(h.currentDecision()!.subject.verification.statement).toContain('observation date not recorded');
  });

  it('cannot produce official-confirmation language when the record is not reachable, even though the subject flag says verified', () => {
    const h = harness();
    h.state.identityEvidence = null;
    h.completion();
    const subject = h.currentDecision()!.subject;
    expect(subject.verification.officiallyVerified).toBe(false);
    expect(subject.confidence).toBe('well_supported');
    expect(subject.verification.statement).not.toMatch(/is confirmed by|an official parcel record/i);
    expect(subject.verification.statement).toMatch(/official parcel confirmation is pending/);
    expect(subject.verification.statement).toContain('Florida DEP statewide property-appraiser parcel layer');
    expect(subject.caveats.join(' ')).toMatch(/could not be reached/);
  });

  it('a provider record, a mismatched APN, an unverified card or a missing evidence row never qualifies as official confirmation', () => {
    for (const evidence of [
      identityEvidence({ verificationSource: 'LandPortal authenticated parcel panel' }),
      identityEvidence({ apn: '00083A03401' }),
      identityEvidence({ verificationStatus: 'unverified_lead' }),
      identityEvidence({ records: [] }),
    ]) {
      const h = harness();
      h.state.identityEvidence = evidence;
      h.completion();
      const subject = h.currentDecision()!.subject;
      expect(subject.verification.officiallyVerified).toBe(false);
      expect(subject.verification.statement).not.toMatch(/is confirmed by|an official parcel record/i);
    }
  });
});

describe('the one seller read status', () => {
  const sellerText = comm({
    id: 'c1', type: 'text', at: '2026-09-02T15:00:00.000Z', channel: 'text', direction: 'inbound',
    summary: 'Seller replied by text.',
    body: 'We inherited the land and were hoping to get $45,000 for it. My sister has to agree too. I could close before the end of the year if the survey is fine.',
  });

  it('a qualifying current seller communication is Preliminary — current, never pending, and never Current', () => {
    const h = harness();
    h.completion();
    expect(sellerReadStatusFor(h.currentDiscovery()!).status).toBe('pending');
    h.state.acquisition = { ...emptyAcquisition(), commLog: [sellerText] };
    h.sellerEvent('seller:communication_added');
    const status = sellerReadStatusFor(h.currentDiscovery()!);
    expect(status.status).toBe('preliminary_current');
    expect(status.label).toBe('Preliminary — current');
    expect(status.communicationIds).toEqual(['c1']);
    expect(status.lastCommunicationAt).toBe('2026-09-02T15:00:00.000Z');
    expect(status.currentClaims).toBeGreaterThan(0);
    expect(status.completeness).toMatch(/never reported as Current/);
    expect(status.caveat).toMatch(/seller-reported and not independently verified/);
    for (const claim of h.currentDiscovery()!.claims) {
      expect(claim.speaker.label).toBe('seller (inbound text)');
      expect(claim.source.at).toBe('2026-09-02T15:00:00.000Z');
      expect(claim.source.id).toBe('c1');
      expect(['firm', 'conditional', 'uncertain', 'proposed']).toContain(claim.modality);
      expect(['current', 'historical']).toContain(claim.status);
      expect(claim.standing).toBe('seller_reported');
    }
  });

  it('deleting the only communication returns the read to pending while the earlier discovery and decisions stay as history', () => {
    const h = harness();
    h.completion();
    h.state.acquisition = { ...emptyAcquisition(), commLog: [sellerText] };
    h.sellerEvent('seller:communication_added');
    h.state.acquisition = emptyAcquisition();
    h.sellerEvent('seller:communication_deleted');
    const status = sellerReadStatusFor(h.currentDiscovery()!);
    expect(status.status).toBe('pending');
    expect(status.label).toBe('Pending — no qualifying seller communication');
    expect(h.store.rows.filter((row) => row.snapshotType === SELLER_DISCOVERY_SNAPSHOT)).toHaveLength(2);
    expect(h.store.rows.filter((row) => row.snapshotType === DEAL_DECISION_SNAPSHOT && row.status === 'superseded')).toHaveLength(2);
  });

  it('an outbound message or note alone stays pending with the refusal explained', () => {
    const h = harness();
    h.completion();
    h.state.acquisition = { ...emptyAcquisition(), commLog: [comm({ id: 'o1', type: 'text', at: '2026-09-02T14:00:00.000Z', channel: 'text', direction: 'outbound', summary: 'Sent intro text.', body: 'Would you take $30,000?' })] };
    h.sellerEvent('seller:communication_added');
    const status = sellerReadStatusFor(h.currentDiscovery()!);
    expect(status.status).toBe('pending');
    expect(status.basis).toMatch(/operator messages or notes/);
  });
});
