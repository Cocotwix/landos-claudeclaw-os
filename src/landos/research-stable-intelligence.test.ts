import { describe, expect, it, vi } from 'vitest';

import { type PropertyFileSource } from './acquisition-intelligence-dossier.js';
import type { CanonicalSubjectState } from './canonical-subject-state.js';
import type { MarketMatrixResolution } from './market-matrix-read.js';
import {
  assessResearchStability,
  ensureResearchStableIntelligence,
  resolveMarketInputs,
  MARKET_RESEARCH_PULSE_SNAPSHOT,
  PROPERTY_EVIDENCE_SYNTHESIS_SNAPSHOT,
  type StabilityInput,
} from './research-stable-intelligence.js';
import type { SubjectUnderstandingResult } from './subject-understanding.js';

// Stage 0's finding, restated as a test suite: research completing must produce
// an operator outcome. Deal 115 held nine research snapshots and zero
// intelligence products because every path to one needed a button. The trigger
// here is a state, and incomplete valuation, zoning, access or seller evidence
// must never be what withholds it.

const now = () => new Date('2026-09-01T00:00:00.000Z');

function file(overrides: Partial<PropertyFileSource> = {}): PropertyFileSource {
  return {
    dealCardId: 501,
    propertyCardId: 401,
    now,
    canonicalIdentity: { status: 'confirmed', confirmed: true },
    propertyIntelligence: {
      snapshot: {
        identity: {
          state: 'confirmed', displayAddress: '19 Sample Rd', apn: 'AAA-111-000',
          county: 'Example', city: 'Example', state_: 'ZZ', owner: 'SAMPLE HOLDINGS LLC',
          acres: 1.5, acreageBasis: 'operator_accepted', hasParcelGeometry: true,
        },
      },
      landPortalFacts: {
        acres: 1.5,
        buildability: { pct: '88%', acres: '1.32 ac' },
        terrain: { slopeAvgPct: '3%' },
        environment: { femaFloodZone: 'X', wetlandsPct: '4%' },
        access: { landLocked: 'No', roadFrontageFt: 150 },
      },
      access: { established: true, frontageFt: 150, road: 'Sample Ln', evidence: { rungs: [], outstanding: [] } },
      // Deliberately incomplete: no zoning, no valuation, no comps, no seller.
      landUseIntelligence: { currentZoning: { established: false, statement: 'Unresolved.', references: [] } },
      compsValuation: { summary: { statusLabel: 'Not priceable', acceptedCount: 0 }, counts: {} },
    },
    dealCard: { people: [], asking_price: null },
    visuals: [],
    ...overrides,
  };
}

function subject(overrides: Partial<CanonicalSubjectState> = {}): CanonicalSubjectState {
  return {
    dealCardId: 501, propertyCardId: 401, subjectResolved: true, officiallyVerified: false,
    officialVerificationSource: null, status: 'confirmed', source: 'identity_version',
    apn: 'AAA-111-000', apnNormalized: 'aaa111000', address: '19 Sample Rd', city: 'Example',
    county: 'Example', state: 'ZZ', fips: '99001', zip: '00000', owner: null,
    subjectVersion: 'iv:137:v2', subjectVersionId: 137,
    governingAcreage: { value: 1.5, kind: 'operator_accepted', source: 'Operator acceptance' },
    ...overrides,
  } as unknown as CanonicalSubjectState;
}

const understanding = (
  outcome: SubjectUnderstandingResult['outcome'] = 'research_ready',
): SubjectUnderstandingResult => ({
  dealCardId: 501,
  outcome,
  subject: outcome === 'research_ready'
    ? ({
      apn: 'AAA-111-000', apnNormalized: 'aaa111000', apnDisplayVariants: ['AAA-111-000'],
      address: '19 Sample Rd', city: 'Example', county: 'Example', state: 'ZZ', zip: '00000',
      fips: null, owner: null, lpPropertyId: null, lpUrl: null, legalDescription: null, acres: 1.5,
      interest: { form: 'whole_parcel', statement: 'The whole parcel is being conveyed.', excluded: [] },
      provenance: {},
      verification: { researchGrade: true, officiallyVerified: false, officialVerificationSource: null, outstanding: [] },
    } as unknown as SubjectUnderstandingResult['subject'])
    : null,
  candidates: [], conflicts: [], question: null, evidence: [], excludedParcels: [],
  confidence: 0.9, persistable: true,
  audit: { actionsUsed: 0, stopReason: 'research_ready' } as unknown as SubjectUnderstandingResult['audit'],
});

const emptyMetrics = () => ({
  salesCount: null, listingCount: null, medianPrice: null, medianPricePerAcre: null,
  daysOnMarket: null, sellThroughRate: null, absorptionRate: null, monthsOfSupply: null,
  population: null, populationDensity: null, populationGrowth: null, salesDensity: null,
});

function marketResolver(input: { acreageBand?: string; zip?: string }): MarketMatrixResolution {
  const band = input.acreageBand ?? 'all';
  // The county carries 1-2 and 10-20 only, so the ladder must contain exactly
  // those and nothing widened into a rung it did not answer for.
  const carried = band === '1-2' || band === '10-20';
  return {
    matchLevel: carried ? 'county' : 'unavailable',
    available: carried,
    geography: { state: 'ZZ', county: 'Example', fips: '99001' },
    resolvedKey: carried ? 'county:99001' : null,
    resolvedKeyLabel: carried ? `Example County (${band} acres)` : null,
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
      ? { ...emptyMetrics(), salesCount: band === '1-2' ? 20 : 21, medianPricePerAcre: band === '1-2' ? 28008 : 14526, daysOnMarket: 37, sellThroughRate: band === '1-2' ? 71.43 : 131.25, monthsOfSupply: 17.03 }
      : null,
    talkingPoints: [],
    note: carried ? 'Resolved via County match.' : 'No Market Matrix snapshot for this band.',
  };
}

function deps(overrides: Partial<Parameters<typeof ensureResearchStableIntelligence>[1]> = {}) {
  const writes: Array<{ snapshotType: string; payload: unknown }> = [];
  const seen = new Map<string, number>();
  return {
    writes,
    deps: {
      readPropertyFile: () => file(),
      readSubject: () => subject(),
      readUnderstanding: () => understanding(),
      resolveMarket: marketResolver as never,
      now,
      writeSnapshot: ((input: { snapshotType: string; payload: unknown }) => {
        writes.push({ snapshotType: input.snapshotType, payload: input.payload });
        const key = `${input.snapshotType}|${JSON.stringify(input.payload)}`;
        const existing = seen.get(key);
        if (existing != null) return { snapshotId: existing, reused: true, propertyIdentityVersionId: 137, skippedReason: null };
        const id = seen.size + 1;
        seen.set(key, id);
        return { snapshotId: id, reused: false, propertyIdentityVersionId: 137, skippedReason: null };
      }) as never,
      ...overrides,
    } as Parameters<typeof ensureResearchStableIntelligence>[1],
  };
}

describe('when research is stable', () => {
  const dossierLike: StabilityInput['dossier'] = {
    coverage: { present: ['Property identity', 'LandPortal parcel facts'], absent: [] },
    identity: { confirmed: true },
    seller: { communications: [], discovery: [] },
  } as unknown as StabilityInput['dossier'];

  it('is stable on a research-ready subject with established research', () => {
    const stability = assessResearchStability({
      subject: { subjectResolved: true },
      understanding: { outcome: 'research_ready' },
      dossier: dossierLike,
    });
    expect(stability.stable).toBe(true);
    expect(stability.sellerIntelligence).toBe('pending_discovery');
    expect(stability.reason).toContain('does not block');
  });

  it('treats an accepted subject with no retained reading as research-ready', () => {
    const stability = assessResearchStability({
      subject: { subjectResolved: true }, understanding: null, dossier: dossierLike,
    });
    expect(stability.stable).toBe(true);
    expect(stability.signals.understandingOutcome).toBe('not_retained');
  });

  it('waits while the parcel itself is unsettled', () => {
    expect(assessResearchStability({
      subject: { subjectResolved: true }, understanding: { outcome: 'candidate_set' }, dossier: dossierLike,
    }).stable).toBe(false);
    expect(assessResearchStability({
      subject: { subjectResolved: false }, understanding: { outcome: 'research_ready' }, dossier: dossierLike,
    }).stable).toBe(false);
  });

  it('waits while nothing at all has been established', () => {
    const stability = assessResearchStability({
      subject: { subjectResolved: true },
      understanding: { outcome: 'research_ready' },
      dossier: { ...dossierLike, coverage: { present: [], absent: ['everything'] } },
    });
    expect(stability.stable).toBe(false);
    expect(stability.reason).toContain('Nothing has been established');
  });

  it('reports established seller communications without changing the gate', () => {
    const stability = assessResearchStability({
      subject: { subjectResolved: true },
      understanding: { outcome: 'research_ready' },
      dossier: { ...dossierLike, seller: { ...dossierLike.seller, communications: [{}] } } as unknown as StabilityInput['dossier'],
    });
    expect(stability.stable).toBe(true);
    expect(stability.sellerIntelligence).toBe('communications_established');
  });
});

describe('the market ladder', () => {
  it('keeps only rungs the county itself answered for the band that was asked', () => {
    const resolved = resolveMarketInputs(
      { county: 'Example', fips: '99001', state: 'ZZ', zip: '00000', acres: 1.5 },
      marketResolver as never,
    );
    expect(resolved.bandLadder.map((entry) => entry.acreageBandUsed)).toEqual(['1-2', '10-20']);
    expect(resolved.subjectBand.acreageBandUsed).toBe('1-2');
  });

  it('refuses to label a county record as the ZIP context', () => {
    // The resolver widens to the county when the ZIP holds nothing with real
    // activity. A county row under a "ZIP context" heading is a population
    // labelled with a geography it does not describe.
    const resolved = resolveMarketInputs(
      { county: 'Example', fips: '99001', state: 'ZZ', zip: '00000', acres: 1.5 },
      marketResolver as never,
    );
    expect(resolved.zipContext?.available).toBe(false);
    expect(resolved.zipContext?.resolvedKeyLabel).toBeNull();
    expect(resolved.zipContext?.note).toContain('ZIP 00000 holds no retained market record');
  });

  it('keeps a record the ZIP itself answered', () => {
    const zipResolver = (input: { zip?: string; acreageBand?: string }): MarketMatrixResolution => ({
      ...marketResolver(input),
      matchLevel: input.zip ? 'zip' : 'county',
      available: true,
      resolvedKey: input.zip ? 'zip:00000' : 'county:99001',
      resolvedKeyLabel: input.zip ? 'ZIP 00000' : 'Example County (1-2 acres)',
    });
    const resolved = resolveMarketInputs(
      { county: 'Example', fips: '99001', state: 'ZZ', zip: '00000', acres: 1.5 },
      zipResolver as never,
    );
    expect(resolved.zipContext?.available).toBe(true);
    expect(resolved.zipContext?.resolvedKeyLabel).toBe('ZIP 00000');
  });

  it('asks for no band at all when the subject size is unknown', () => {
    const resolver = vi.fn(marketResolver as never);
    resolveMarketInputs({ county: 'Example', fips: '99001', state: 'ZZ', zip: null, acres: null }, resolver as never);
    expect((resolver.mock.calls[0][0] as { acreageBand?: string }).acreageBand).toBeUndefined();
  });
});

describe('producing both readings', () => {
  it('produces Property and Market Intelligence with valuation, zoning, access and seller incomplete', () => {
    const { deps: d } = deps();
    const result = ensureResearchStableIntelligence(501, d);
    expect(result.outcome).toBe('produced');
    expect(result.sellerIntelligence).toBe('pending_discovery');
    expect(result.property?.story.headline).toContain('diligence topics established');
    expect(result.market?.subjectBand.bandUsed).toBe('1-2');
    // The very gaps that used to withhold a product are now reported by it.
    expect(result.property?.diligence.find((topic) => topic.key === 'zoning')?.status).not.toBe('established');
    expect(result.property?.guardrails.map((entry) => entry.claimKind)).toContain('Fair market value');
  });

  it('writes both snapshots through the shared derived seam', () => {
    const { deps: d, writes } = deps();
    ensureResearchStableIntelligence(501, d);
    expect(writes.map((entry) => entry.snapshotType)).toEqual([
      PROPERTY_EVIDENCE_SYNTHESIS_SNAPSHOT,
      MARKET_RESEARCH_PULSE_SNAPSHOT,
    ]);
    // No wall-clock time inside the hashed payload, or dedupe cannot work.
    for (const write of writes) expect((write.payload as { generatedAt: unknown }).generatedAt).toBeNull();
  });

  it('writes nothing on a second call over unchanged evidence', () => {
    const { deps: d } = deps();
    expect(ensureResearchStableIntelligence(501, d).outcome).toBe('produced');
    const second = ensureResearchStableIntelligence(501, d);
    expect(second.outcome).toBe('unchanged');
    expect(second.persistence.property.written).toBe(false);
    expect(second.persistence.market.written).toBe(false);
  });

  it('produces nothing, and says why, while the subject is unsettled', () => {
    const { deps: d, writes } = deps({ readUnderstanding: () => understanding('needs_targeted_input') });
    const result = ensureResearchStableIntelligence(501, d);
    expect(result.outcome).toBe('not_stable');
    expect(result.stability?.reason).toContain('targeted operator input');
    expect(writes).toHaveLength(0);
  });

  it('reports an absent property file instead of throwing', () => {
    const { deps: d } = deps({ readPropertyFile: () => null });
    expect(ensureResearchStableIntelligence(501, d).outcome).toBe('no_property_file');
  });
});
