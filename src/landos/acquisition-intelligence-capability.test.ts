import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACQUISITION_INTELLIGENCE_CAPABILITY,
  ACQUISITION_INTELLIGENCE_CAPABILITY_ID,
  propertyFileIsSufficient,
  type AcquisitionIntelligenceFacts,
  type AcquisitionIntelligenceRuntimeDeps,
} from './acquisition-intelligence-capability.js';
import { buildAcquisitionDossier } from './acquisition-intelligence-dossier.js';
import type { CapabilityInvocationRequest } from './capability-contract.js';
import type { PropertyFileSource } from './acquisition-intelligence-dossier.js';
import type { AnalystRunOutput } from './acquisition-analyst.js';

// The capability owns the QUESTION, not the plumbing. These tests pin the
// behaviours an operator depends on: opening a card never reasons, a refresh
// does, the analyst can never establish a property fact, and a thin file is
// refused rather than guessed at.

const persisted = new Map<number, unknown>();
const written: Array<{ dealCardId: number; result: unknown }> = [];

vi.mock('./acquisition-intelligence-store.js', () => ({
  ACQUISITION_INTELLIGENCE_SNAPSHOT_TYPE: 'acquisition_intelligence_v1',
  readAcquisitionIntelligence: (dealCardId: number) => persisted.get(dealCardId) ?? null,
  persistAcquisitionIntelligence: (input: { dealCardId: number; result: unknown }) => {
    written.push(input);
    persisted.set(input.dealCardId, input.result);
    return { persisted: true, snapshotId: written.length, reused: false, skippedReason: null };
  },
}));

vi.mock('./deal-card.js', () => ({ getDealCardIdForPropertyCard: () => 89 }));

const request: CapabilityInvocationRequest = {
  capabilityId: ACQUISITION_INTELLIGENCE_CAPABILITY_ID,
  caller: { type: 'deal_card', ref: 'deal:89' },
  subject: { kind: 'canonical_property', entity: 'TY_LAND_BIZ', propertyCardId: 79, dealCardId: 89 },
};

const environment = { invocationId: 'cap_test', researchSessionId: null, startedAt: '2026-08-18T00:00:00.000Z' };

function propertyFile(): PropertyFileSource {
  return {
    dealCardId: 89,
    propertyCardId: 79,
    propertyIntelligence: {
      snapshot: { identity: { state: 'confirmed', displayAddress: '1 Test Rd', apn: '1-1', acres: 6 } },
      landPortalFacts: { acres: 6, buildability: { pct: '90%' }, access: { landLocked: 'No', roadFrontageFt: 400 } },
      access: { frontageFt: 250, road: 'Test Rd', evidence: { rungs: [{ label: 'Parcel / landlocked flag', status: 'evidenced' }] } },
      compsValuation: { summary: { fmv: 120_000, acceptedCount: 4 }, counts: { accepted_closed_sale: 4 } },
    },
    marketContext: { read: { headline: 'Small parcels clear fast.' } },
    visuals: [{ key: 'close_parcel_aerial', label: 'close parcel aerial', filePath: 'C:/store/close.png' }],
  };
}

const goodJson = JSON.stringify({
  deal_read: { headline: 'A clean 6-acre frontage split', judgment: 'Wide frontage, small-lot market.', confidence: 'Likely' },
  property_story: ['Six acres with long frontage.'],
  strategies: [{ strategy: 'Frontage subdivision', fit: 'strong', why_it_fits: 'Frontage supports three lots.' }],
  next_actions: [{ action: 'Confirm the minimum lot width.', why: 'It sets the yield.' }],
  unknowns: [{ question: 'What is the current district?', why_it_matters: 'It sets minimum lot area.' }],
});

function deps(overrides: Partial<AcquisitionIntelligenceRuntimeDeps> = {}): AcquisitionIntelligenceRuntimeDeps {
  return {
    readPropertyFile: () => propertyFile(),
    analyst: {
      run: async (): Promise<AnalystRunOutput> => ({
        raw: goodJson,
        observations: [{ visual: 'close_parcel_aerial', observation: 'The tract fronts the road along its full width.', basis: 'Retained close parcel aerial capture' }],
        warnings: [],
        runtime: { engine: 'hermes', agentProfile: 'landos-acquisition-analyst', provider: 'ollama', model: 'gemma4:12b', modelSource: 'default', durationMs: 10 },
      }),
    },
    now: () => new Date('2026-08-18T00:00:00.000Z'),
    ...overrides,
  };
}

const run = (deps_: AcquisitionIntelligenceRuntimeDeps, mode?: 'reuse' | 'refresh') =>
  ACQUISITION_INTELLIGENCE_CAPABILITY.execute({ ...request, mode }, deps_, environment);

beforeEach(() => { persisted.clear(); written.length = 0; });

describe('sufficiency', () => {
  it('refuses a read on an unidentified parcel', () => {
    const dossier = buildAcquisitionDossier({ dealCardId: 1 });
    expect(propertyFileIsSufficient(dossier).ok).toBe(false);
    expect(propertyFileIsSufficient(dossier).reason).toMatch(/identity is not confirmed/i);
  });

  it('refuses a read on a confirmed parcel with nothing researched yet', () => {
    const dossier = buildAcquisitionDossier({
      dealCardId: 1,
      propertyIntelligence: { snapshot: { identity: { state: 'confirmed' } } },
    });
    expect(propertyFileIsSufficient(dossier).ok).toBe(false);
    expect(propertyFileIsSufficient(dossier).reason).toMatch(/Almost nothing has been established/i);
  });

  it('accepts a partial but real property file — an operator asks early', () => {
    expect(propertyFileIsSufficient(buildAcquisitionDossier(propertyFile())).ok).toBe(true);
  });
});

describe('reuse versus refresh', () => {
  it('produces and persists ONE read on an explicit refresh', async () => {
    const outcome = await run(deps(), 'refresh');
    const facts = outcome.facts as AcquisitionIntelligenceFacts;
    expect(outcome.status).toBe('SUCCEEDED');
    expect(facts.outcome).toBe('read_produced');
    expect(facts.headline).toBe('A clean 6-acre frontage split');
    expect(written).toHaveLength(1);
  });

  it('returns the retained read on reuse WITHOUT engaging the analyst', async () => {
    await run(deps(), 'refresh');
    const analyst = { run: vi.fn() };
    const outcome = await run(deps({ analyst: analyst as never }), 'reuse');
    const facts = outcome.facts as AcquisitionIntelligenceFacts;
    expect(facts.outcome).toBe('retained_read');
    expect(facts.headline).toBe('A clean 6-acre frontage split');
    expect(analyst.run).not.toHaveBeenCalled();
    expect(written).toHaveLength(1);
  });

  it('flags a retained read as stale once the property file has moved on', async () => {
    await run(deps(), 'refresh');
    const changed = { ...propertyFile() };
    (changed.propertyIntelligence as Record<string, never>).landPortalFacts = { acres: 12 } as never;
    const outcome = await run(deps({ readPropertyFile: () => changed, analyst: { run: vi.fn() } as never }), 'reuse');
    expect((outcome.facts as AcquisitionIntelligenceFacts).stale).toBe(true);
    expect(outcome.warnings?.join(' ')).toMatch(/New property evidence has landed/i);
  });
});

describe('what the read may and may not contain', () => {
  it('carries the conflicts LandOS detected even when the analyst omits them', async () => {
    const outcome = await run(deps(), 'refresh');
    const read = (outcome.facts as AcquisitionIntelligenceFacts).read as { conflicts: Array<{ subject: string }> };
    // The property file above has a 250 ft / 400 ft frontage disagreement.
    expect(read.conflicts.map((conflict) => conflict.subject)).toContain('frontage');
  });

  it('retains what the analyst actually SAW even if the judgment pass cited nothing', async () => {
    const outcome = await run(deps(), 'refresh');
    const read = (outcome.facts as AcquisitionIntelligenceFacts).read as { visualObservations: Array<{ visual: string }> };
    expect(read.visualObservations.map((observation) => observation.visual)).toEqual(['close_parcel_aerial']);
  });

  it('labels its own evidence as a judgment rather than a property fact', async () => {
    const outcome = await run(deps(), 'refresh');
    expect(outcome.evidence?.[0]?.sourceType).toBe('landos_acquisition_judgment');
    expect(String(outcome.evidence?.[0]?.details?.note)).toMatch(/establishes no property fact/i);
  });

  it('surfaces the analyst unknowns as missing information rather than answering them', async () => {
    const outcome = await run(deps(), 'refresh');
    expect(outcome.missingInformation).toEqual(['What is the current district?']);
  });
});

describe('honest failure', () => {
  it('reports a refusal instead of persisting an empty read', async () => {
    const outcome = await run(deps({
      analyst: {
        run: async () => ({
          raw: 'I am ready. Please provide the dossier.',
          observations: [],
          warnings: [],
          runtime: { engine: 'hermes', agentProfile: 'landos-acquisition-analyst', provider: 'ollama', model: 'gemma4:12b', modelSource: 'default' as const, durationMs: 5 },
        }),
      },
    }), 'refresh');
    expect(outcome.status).toBe('FAILED');
    expect(written).toHaveLength(0);
    expect(outcome.warnings?.join(' ')).toMatch(/no parsable JSON/i);
  });

  it('reports an analyst crash as a failure, not as a read', async () => {
    const outcome = await run(deps({ analyst: { run: async () => { throw new Error('the local runtime is not running'); } } }), 'refresh');
    expect(outcome.status).toBe('FAILED');
    expect((outcome.facts as AcquisitionIntelligenceFacts).outcome).toBe('analyst_unavailable');
    expect(outcome.facts.summary).toMatch(/the local runtime is not running/);
    expect(written).toHaveLength(0);
  });

  it('states that no property file exists rather than reasoning over nothing', async () => {
    const outcome = await run(deps({ readPropertyFile: () => null }), 'refresh');
    expect(outcome.status).toBe('NEEDS_INPUT');
    expect((outcome.facts as AcquisitionIntelligenceFacts).outcome).toBe('not_available');
  });

  it('refuses a thin property file rather than guessing at it', async () => {
    const outcome = await run(deps({
      readPropertyFile: () => ({ dealCardId: 89, propertyIntelligence: { snapshot: { identity: { state: 'provisional' } } } }),
    }), 'refresh');
    expect(outcome.status).toBe('NEEDS_INPUT');
    expect((outcome.facts as AcquisitionIntelligenceFacts).outcome).toBe('insufficient_property_file');
    expect(written).toHaveLength(0);
  });
});
