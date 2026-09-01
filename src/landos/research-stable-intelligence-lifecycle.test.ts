// Stage 3 TRIGGER AND READ-ONLY BEHAVIOUR.
//
// The first Stage 3 build produced the two readings from the workspace GET.
// It worked, and it was wrong: opening a page is not what should make
// intelligence exist, and a read that writes cannot honestly claim it left the
// record alone. This suite pins the corrected shape.
//
//   PRODUCE  only on a real completion or state transition, over a stable
//            accepted subject and a settled retained record.
//   READ     never writes. Not a version, not a row, not a supersede.
//   REFRESH  automatically, when the retained evidence materially moves.
//   ISOLATE  a story formed about one parcel never presents as another's.
//
// Everything below runs against an in-memory stand-in for the derived-snapshot
// seam that reproduces its two governing rules exactly: dedupe on the input
// hash, and supersede-rather-than-overwrite. That is what makes "zero new
// versions" a real assertion rather than a hopeful one.

import { describe, expect, it } from 'vitest';

import { type PropertyFileSource } from './acquisition-intelligence-dossier.js';
import type { CanonicalSubjectState } from './canonical-subject-state.js';
import type { MarketMatrixResolution } from './market-matrix-read.js';
import {
  ensureResearchStableIntelligence,
  readResearchStability,
  MARKET_RESEARCH_PULSE_SNAPSHOT,
  PROPERTY_EVIDENCE_SYNTHESIS_SNAPSHOT,
  type ResearchStableIntelligenceDeps,
} from './research-stable-intelligence.js';
import type { SubjectUnderstandingResult } from './subject-understanding.js';

const now = () => new Date('2026-09-01T00:00:00.000Z');

// ── The retained record, as a fixture ──────────────────────────────────────

interface FileOptions {
  /** Simulates later research landing: a materially different retained file. */
  zoningEstablished?: boolean;
  floodZone?: string;
  apn?: string;
  coverage?: 'full' | 'empty';
}

function file(options: FileOptions = {}): PropertyFileSource {
  const apn = options.apn ?? 'AAA-111-000';
  const empty = options.coverage === 'empty';
  return {
    dealCardId: 501,
    propertyCardId: 401,
    now,
    canonicalIdentity: { status: empty ? 'candidate' : 'confirmed', confirmed: !empty },
    propertyIntelligence: {
      snapshot: {
        identity: {
          state: empty ? 'candidate' : 'confirmed',
          displayAddress: '19 Sample Rd', apn,
          county: 'Example', city: 'Example', state_: 'ZZ', owner: 'SAMPLE HOLDINGS LLC',
          acres: 1.5, acreageBasis: 'operator_accepted', hasParcelGeometry: true,
        },
      },
      landPortalFacts: empty ? undefined : {
        acres: 1.5,
        buildability: { pct: '88%', acres: '1.32 ac' },
        terrain: { slopeAvgPct: '3%' },
        environment: { femaFloodZone: options.floodZone ?? 'X', wetlandsPct: '4%' },
        access: { landLocked: 'No', roadFrontageFt: 150 },
        valuation: { assessedValue: '$35,000.00', totalMarketValue: '$35,000.00', taxAmount: '$478.66' },
      },
      access: { established: true, frontageFt: 150, road: 'Sample Ln', evidence: { rungs: [], outstanding: [] } },
      // Deliberately incomplete throughout: no valuation, no comps, no seller,
      // and zoning unresolved unless a later research pass established it.
      landUseIntelligence: options.zoningEstablished
        ? {
          currentZoning: {
            established: true, statement: 'Zoned A-1 Agricultural.', districtCode: 'A-1',
            authorityName: 'Example County', references: [],
          },
        }
        : { currentZoning: { established: false, statement: 'Unresolved.', references: [] } },
      compsValuation: { summary: { statusLabel: 'Not priceable', acceptedCount: 0 }, counts: {} },
    },
    dealCard: { people: [], asking_price: null },
    visuals: [],
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
      ? {
        ...emptyMetrics(),
        salesCount: band === '1-2' ? 20 : 21,
        medianPricePerAcre: band === '1-2' ? 28008 : 14526,
        daysOnMarket: 37, sellThroughRate: band === '1-2' ? 71.43 : 131.25, monthsOfSupply: 17.03,
      }
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

/**
 * The two rules the real seam enforces, and nothing else:
 *   • the same (identity version, type, payload) reuses its existing row;
 *   • a genuinely different payload supersedes its predecessor, which stays.
 */
function seam() {
  const rows: StoredSnapshot[] = [];
  let nextId = 1;
  let nextVersion = 1;
  const hash = (identityVersionId: number, snapshotType: string, payload: unknown): string =>
    JSON.stringify({ identityVersionId, snapshotType, payload });

  const writeSnapshot: ResearchStableIntelligenceDeps['writeSnapshot'] = (input) => {
    // The seam attaches every read to the CURRENT property identity version, so
    // a moved subject writes against a different version and cannot reuse the
    // prior parcel's row.
    const identityVersionId = identity.current;
    const inputHash = hash(identityVersionId, input.snapshotType, input.payload);
    const existing = rows.find((row) => row.inputHash === inputHash);
    if (existing) {
      return { snapshotId: existing.id, reused: true, propertyIdentityVersionId: identityVersionId, skippedReason: null };
    }
    const prior = rows.find((row) => row.snapshotType === input.snapshotType && row.status === 'current');
    if (prior) prior.status = 'superseded';
    const row: StoredSnapshot = {
      id: nextId++, version: nextVersion++, snapshotType: input.snapshotType,
      identityVersionId, inputHash, status: 'current', payload: input.payload,
    };
    rows.push(row);
    return { snapshotId: row.id, reused: false, propertyIdentityVersionId: identityVersionId, skippedReason: null };
  };

  const identity = { current: 137 };
  return {
    rows,
    identity,
    writeSnapshot,
    versions: () => rows.length,
    currentOf: (snapshotType: string) => rows.find((row) => row.snapshotType === snapshotType && row.status === 'current') ?? null,
    supersededOf: (snapshotType: string) => rows.filter((row) => row.snapshotType === snapshotType && row.status === 'superseded'),
  };
}

function harness(options: FileOptions = {}) {
  const store = seam();
  const state = { file: file(options), subject: subject(), understanding: understanding() };
  const deps: ResearchStableIntelligenceDeps = {
    readPropertyFile: () => state.file,
    readSubject: () => state.subject,
    readUnderstanding: () => state.understanding,
    resolveMarket: marketResolver as never,
    writeSnapshot: store.writeSnapshot,
    now,
  };
  return {
    store,
    state,
    deps,
    /** One completion of the research lifecycle. */
    completion: () => ensureResearchStableIntelligence(501, deps),
    /** One workspace read. It may only SELECT. */
    read: () => ({
      stability: readResearchStability(501, deps),
      property: store.currentOf(PROPERTY_EVIDENCE_SYNTHESIS_SNAPSHOT),
      market: store.currentOf(MARKET_RESEARCH_PULSE_SNAPSHOT),
    }),
  };
}

// ── 1. Completion produces, with no page load ──────────────────────────────

describe('the completion lifecycle produces the readings', () => {
  it('produces Property and Market Intelligence without the workspace ever being opened', () => {
    const h = harness();
    expect(h.store.versions()).toBe(0);

    const result = h.completion();

    expect(result.outcome).toBe('produced');
    expect(result.property?.story.headline).toContain('diligence topics established');
    expect(result.market?.subjectBand.bandUsed).toBe('1-2');
    expect(h.store.currentOf(PROPERTY_EVIDENCE_SYNTHESIS_SNAPSHOT)).not.toBeNull();
    expect(h.store.currentOf(MARKET_RESEARCH_PULSE_SNAPSHOT)).not.toBeNull();
  });

  it('produces nothing before an accepted subject exists', () => {
    const h = harness();
    h.state.subject = subject({ subjectResolved: false });
    const result = h.completion();
    expect(result.outcome).toBe('not_stable');
    expect(result.stability?.reason).toContain('No accepted Working Acquisition Subject');
    expect(h.store.versions()).toBe(0);
  });

  it('produces nothing before the parcel itself is settled', () => {
    const h = harness();
    h.state.understanding = understanding('candidate_set');
    expect(h.completion().outcome).toBe('not_stable');
    h.state.understanding = understanding('needs_targeted_input');
    expect(h.completion().outcome).toBe('not_stable');
    expect(h.store.versions()).toBe(0);
  });

  it('produces nothing before any research has been established', () => {
    const h = harness({ coverage: 'empty' });
    const result = h.completion();
    expect(result.outcome).toBe('not_stable');
    expect(result.stability?.reason).toContain('Nothing has been established');
    expect(h.store.versions()).toBe(0);
  });
});

// ── 2/3. A read is a read ──────────────────────────────────────────────────

describe('reads never write', () => {
  it('a workspace read performs zero intelligence writes', () => {
    const h = harness();
    const read = h.read();
    // The panel still gets its explanation for the empty state.
    expect(read.stability?.stable).toBe(true);
    expect(read.property).toBeNull();
    expect(read.market).toBeNull();
    expect(h.store.versions()).toBe(0);
  });

  it('repeated reads after a completion create zero new versions', () => {
    const h = harness();
    h.completion();
    const after = h.store.versions();
    expect(after).toBe(2);

    for (let i = 0; i < 5; i += 1) {
      const read = h.read();
      expect(read.property).not.toBeNull();
      expect(read.market).not.toBeNull();
    }
    expect(h.store.versions()).toBe(after);
    expect(h.store.supersededOf(PROPERTY_EVIDENCE_SYNTHESIS_SNAPSHOT)).toHaveLength(0);
  });

  it('explains an absent reading without producing one', () => {
    const h = harness();
    h.state.understanding = understanding('needs_targeted_input');
    const read = h.read();
    expect(read.stability?.stable).toBe(false);
    expect(read.stability?.reason).toContain('targeted operator input');
    expect(h.store.versions()).toBe(0);
  });
});

// ── 4/5. Idempotence and refresh ───────────────────────────────────────────

describe('idempotence and automatic refresh', () => {
  it('repeating the completion over unchanged evidence creates zero new versions', () => {
    const h = harness();
    expect(h.completion().outcome).toBe('produced');
    const after = h.store.versions();

    for (let i = 0; i < 3; i += 1) {
      expect(h.completion().outcome).toBe('unchanged');
    }
    expect(h.store.versions()).toBe(after);
  });

  it('refreshes exactly once when later research materially changes the record', () => {
    const h = harness();
    h.completion();
    const firstProperty = h.store.currentOf(PROPERTY_EVIDENCE_SYNTHESIS_SNAPSHOT);
    expect(h.store.versions()).toBe(2);

    // Later research establishes zoning. The completion lifecycle runs again.
    h.state.file = file({ zoningEstablished: true });
    const refreshed = h.completion();

    expect(refreshed.outcome).toBe('produced');
    expect(refreshed.property?.diligence.find((topic) => topic.key === 'zoning')?.status).toBe('established');
    // One new current version, and exactly one superseded predecessor retained.
    const current = h.store.currentOf(PROPERTY_EVIDENCE_SYNTHESIS_SNAPSHOT);
    expect(current?.id).not.toBe(firstProperty?.id);
    expect(h.store.supersededOf(PROPERTY_EVIDENCE_SYNTHESIS_SNAPSHOT)).toHaveLength(1);
    expect(h.store.supersededOf(PROPERTY_EVIDENCE_SYNTHESIS_SNAPSHOT)[0].id).toBe(firstProperty?.id);
    // Prior history is retained, never overwritten.
    expect(h.store.rows.filter((row) => row.snapshotType === PROPERTY_EVIDENCE_SYNTHESIS_SNAPSHOT)).toHaveLength(2);
  });

  it('settles again after the refresh instead of writing on every cycle', () => {
    const h = harness();
    h.completion();
    h.state.file = file({ zoningEstablished: true });
    h.completion();
    const after = h.store.versions();
    expect(h.completion().outcome).toBe('unchanged');
    expect(h.store.versions()).toBe(after);
  });
});

// ── 6. A moved subject inherits nothing ────────────────────────────────────

describe('subject isolation', () => {
  it('a changed acquisition subject cannot inherit the prior parcel\'s stories', () => {
    const h = harness();
    h.completion();
    const first = h.store.currentOf(PROPERTY_EVIDENCE_SYNTHESIS_SNAPSHOT);
    expect(first?.identityVersionId).toBe(137);

    // The Deal Card is re-accepted onto a different parcel.
    h.store.identity.current = 208;
    h.state.file = file({ apn: 'BBB-222-000' });
    h.state.subject = subject({ apn: 'BBB-222-000', subjectVersion: 'iv:208:v1', subjectVersionId: 208 });
    h.completion();

    const current = h.store.currentOf(PROPERTY_EVIDENCE_SYNTHESIS_SNAPSHOT);
    expect(current?.identityVersionId).toBe(208);
    expect(current?.id).not.toBe(first?.id);
    // The prior parcel's reading survives as history, attached to ITS version.
    const prior = h.store.supersededOf(PROPERTY_EVIDENCE_SYNTHESIS_SNAPSHOT)[0];
    expect(prior.identityVersionId).toBe(137);
    expect((prior.payload as { subject: { apn: string } }).subject.apn).toBe('AAA-111-000');
    expect((current?.payload as { subject: { apn: string } }).subject.apn).toBe('BBB-222-000');
  });
});

// ── 7-11. What the produced readings must contain ──────────────────────────

describe('what a completion produces on an incomplete file', () => {
  it('is useful with valuation, zoning, access and seller communication all incomplete', () => {
    const h = harness();
    const result = h.completion();

    expect(result.sellerIntelligence).toBe('pending_discovery');
    expect(result.stability?.reason).toContain('does not block');

    const property = result.property!;
    expect(property.diligence.find((topic) => topic.key === 'zoning')?.status).not.toBe('established');
    expect(property.diligence.find((topic) => topic.key === 'access')?.status).not.toBe('established');
    // Useful anyway: an outcome, ranked risk, and decisive diligence actions.
    expect(property.story.headline).toBeTruthy();
    expect(property.story.risks.length).toBeGreaterThan(0);
    expect(property.diligence.flatMap((topic) => topic.verificationNeeded).length).toBeGreaterThan(0);
    expect(property.story.economicsDrivers.length).toBeGreaterThan(0);
    expect(result.market!.story.headline).toContain('20 recorded sale(s)');
  });

  it('withholds every guarded claim the evidence does not support', () => {
    const h = harness();
    const guarded = h.completion().property!.guardrails.map((entry) => entry.claimKind);
    expect(guarded).toEqual(expect.arrayContaining([
      'Fair market value', 'Title', 'Legal access', 'Entitlement approval', 'Environmental clearance',
    ]));
  });

  it('never lets the most-liquid comparison band occupy the subject slot', () => {
    const h = harness();
    const market = h.completion().market!;
    expect(market.subjectBand.role).toBe('subject_band');
    expect(market.subjectBand.bandUsed).toBe('1-2');
    expect(market.mostLiquidBand?.role).toBe('most_liquid_band');
    expect(market.mostLiquidBand?.bandUsed).toBe('10-20');
    expect(market.mostLiquidBand?.limitations.join(' ')).toContain('not the subject\'s band');
  });

  it('plans the Market Pulse without executing any of it', () => {
    const h = harness();
    const market = h.completion().market!;
    expect(market.pulsePlan).toHaveLength(7);
    // Stage 3 delivers the PLAN. Nothing may have been researched.
    for (const question of market.pulsePlan) expect(question.status).toBe('planned');
    expect(market.pulseClaims).toHaveLength(0);
    expect(market.story.limitations.join(' ')).toContain('not yet researched');
  });

  it('retains original claims, corroboration, conflicts, sources and dates', () => {
    const h = harness();
    const property = h.completion().property!;
    // Every claim keeps its own source, and the record facts are not merged.
    for (const entry of property.recordFacts) {
      expect(entry.source.name).toBeTruthy();
      expect(entry.claimId).toBeTruthy();
    }
    const taxes = property.diligence.find((topic) => topic.key === 'taxes')!;
    expect(taxes.claims.map((entry) => entry.value)).toEqual(
      expect.arrayContaining(['$478.66', '$35,000.00']),
    );
    for (const entry of taxes.claims) expect(entry.source.name).toBe('LandPortal parcel record');
    // The market read carries its period as the date behind every figure.
    expect(h.completion().market!.subjectBand.period).toBe('2026-Q3');
  });
});
