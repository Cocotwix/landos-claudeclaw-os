// Staged hybrid LandPortal pilot — contract tests.
//
// Covers: per-stage persistence (a later model failure never discards earlier
// stage data), deterministic fact extraction with an injected fake driver,
// model-failure honesty, synthesis persistence through the existing validated
// slot, stage loader newest-run grouping, and cross-card isolation.

import { beforeEach, describe, it, expect } from 'vitest';

import { _initTestLandosDb } from './db.js';
import { upsertPropertyCard, getCardActivity } from './property-card.js';
import { createDealCard, linkPropertyToDeal } from './deal-card.js';
import { attachCardActivity } from './property-card.js';
import {
  runLandPortalStagedPilot,
  loadStagedRun,
  persistStage,
  STAGED_ACTIVITY_KIND,
  STAGE_IDS,
  type InterpretationModel,
  type StageRecord,
} from './landportal-staged-pilot.js';
import { loadBrowserUseRun, _resetBrowserUseRunState } from './landportal-browseruse.js';
import type { LandPortalReadiness } from './browser-session.js';
import type { BrowserDriver } from './browser-intelligence.js';

beforeEach(() => {
  _initTestLandosDb();
  _resetBrowserUseRunState();
});

const ADDRESS = '499 Campground Road';

function subjectCard() {
  const card = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: ADDRESS, county: 'Pickens', state: 'SC' }).card;
  const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'Staged pilot' });
  linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
  // The staged pilot requires the deterministic lane's resolved parcel URL.
  attachCardActivity({
    cardId: card.id,
    agentId: 'test',
    kind: 'property_inspection',
    summary: 'seed inspection',
    ref: JSON.stringify({
      parcelUrl: 'https://landportal.com/?property=abc',
      comparablesUrl: null, parcelFacts: {}, assets: [], overlays: [],
      visualObservations: [], comparables: [], sources: [], evidence: [],
      discoveryQuestions: [], missingInformation: [],
    }),
  });
  return { card, deal };
}

const authOk = {
  phase: 'authenticated', ready: true, sessionStatus: 'live', authenticated: true,
  reason: null, missingEnv: [], attempted: false, note: '',
} as LandPortalReadiness;

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpShots = fs.mkdtempSync(path.join(os.tmpdir(), 'staged-pilot-'));
// A minimal valid 1x1 PNG so screenshot-dependent stages exercise model paths.
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const seededShot = path.join(tmpShots, 'seed-parcel.png');
fs.writeFileSync(seededShot, PNG_1PX);

const testConfig = {
  enabled: true, cdpUrl: 'http://127.0.0.1:9224', screenshotDir: tmpShots, profileDir: 'x',
} as ReturnType<typeof import('./browser-session.js').readSessionConfig>;

function fakeDriver(over: Partial<Record<string, unknown>> = {}): BrowserDriver {
  return {
    captureLandPortalVisuals: async () => ({
      fields: {
        'Address': '499 Campground Rd', 'County': 'Pickens', 'APN': '4088-09-25-3503',
        'Acres': '12.21', 'Owner': 'EXAMPLE OWNER', 'Property Type': 'Vacant land',
      },
      parcelShotPath: seededShot,
      compsMapShotPath: seededShot,
      compRows: ['123 Example Ln — Sold $95,000 · 10.1 ac'],
      compCards: [], compDetails: [], mapRows: [], mapReached: true,
      capturedAtIso: '2026-07-30T10:00:00Z',
      overlayShots: [], overlayMisses: [], terrainShotPath: null,
    }),
    screenshot: async () => ({ path: '', capturedAtIso: '', purpose: '' }),
    evaluate: async () => 'absent',
    ...over,
  } as unknown as BrowserDriver;
}

function fakeModel(responses: Record<string, unknown> = {}): InterpretationModel {
  return {
    name: 'fake:model',
    async call({ prompt }) {
      for (const [needle, json] of Object.entries(responses)) {
        if (prompt.includes(needle)) return { text: JSON.stringify(json), json, ms: 5 };
      }
      return { text: '{}', json: {}, ms: 5 };
    },
  };
}

const goodModel = fakeModel({
  'verifying a land parcel': { match: 'confirmed', reasoning: 'Address and county agree.' },
  'aerial views': { parcel_shape: 'rectangular', apparent_road_frontage: 'road frontage on the south side', apparent_access: 'south access', surroundings: 'rural', conflicts: [] },
  'Judge each visible': { judgments: [{ index: 0, relevant: true, reason: 'similar acreage' }] },
  'Rate overall confidence': { confidence: 'medium', reasoning: 'Most stages completed.' },
});

describe('runLandPortalStagedPilot', () => {
  it('persists every stage and lands a validated synthesis in the existing slot', async () => {
    const { card, deal } = subjectCard();
    const outcome = await runLandPortalStagedPilot(deal.id, 'ollama', {
      ensureAuth: async () => authOk, driver: fakeDriver(), model: goodModel, config: testConfig, skipTabHygiene: true,
    });
    expect(outcome.error).toBeNull();
    const stages = loadStagedRun(card.id);
    expect(stages.map((s) => s.stage)).toEqual([...STAGE_IDS]);
    const facts = stages.find((s) => s.stage === 'property_facts')!;
    expect(facts.status).toBe('completed');
    expect((facts.data as { acreage: number }).acreage).toBe(12.21);
    // Synthesis persisted through the SAME validated slot the agent path uses.
    const run = loadBrowserUseRun(card.id);
    expect(run).not.toBeNull();
    expect(run!.result.findings!.subject_identity.parcel_match).toBe('confirmed');
    expect(run!.result.findings!.visual_observations.apparent_road_frontage).toMatch(/road frontage/);
    expect(run!.result.findings!.comp_attempt.candidates[0].relevance).toMatch(/Relevant/);
    expect(outcome.modelCalls).toBeGreaterThanOrEqual(3);
  });

  it('retains requested semantic captures and generic soil popup fields in the imagery stage', async () => {
    const { card, deal } = subjectCard();
    const base = await fakeDriver().captureLandPortalVisuals!('https://landportal.com/?property=abc', { timeoutMs: 1 });
    const outcome = await runLandPortalStagedPilot(deal.id, 'ollama', {
      ensureAuth: async () => authOk,
      driver: fakeDriver({
        captureLandPortalVisuals: async () => ({
          ...base,
          visualShots: [
            { label: 'close_parcel_aerial', path: seededShot, kind: 'parcel_page', purpose: 'Full boundary' },
            {
              label: 'soil_overlay', path: seededShot, kind: 'overlay', purpose: 'Soil overlay', overlay: 'Soil',
              soilDetails: [{ symbol: 'CeB', name: 'Example soil', fields: { 'Map unit symbol': 'CeB', 'Drainage class': 'Well drained' } }],
            },
          ],
        }),
      }),
      model: goodModel, config: testConfig, skipTabHygiene: true,
      captureLabels: ['close_parcel_aerial', 'soil_overlay'],
    });
    expect(outcome.error).toBeNull();
    const imagery = loadStagedRun(card.id).find((stage) => stage.stage === 'imagery')!;
    expect((imagery.data.captures as Array<{ label: string }>).map((capture) => capture.label)).toEqual(['close_parcel_aerial', 'soil_overlay']);
    expect((imagery.data.soilDetails as Array<{ fields: Record<string, string> }>)[0].fields['Drainage class']).toBe('Well drained');
    expect(loadBrowserUseRun(card.id)!.result.captures.map((capture) => capture.label)).toContain('soil_overlay');
  });

  it('keeps earlier stage data when a later model stage fails', async () => {
    const { card, deal } = subjectCard();
    const failingModel: InterpretationModel = {
      name: 'fake:failing',
      async call({ prompt }) {
        if (prompt.includes('verifying a land parcel')) return { text: '{"match":"likely","reasoning":"ok"}', json: { match: 'likely', reasoning: 'ok' }, ms: 5 };
        throw new Error('model exploded');
      },
    };
    const outcome = await runLandPortalStagedPilot(deal.id, 'ollama', {
      ensureAuth: async () => authOk, driver: fakeDriver(), model: failingModel, config: testConfig, skipTabHygiene: true,
    });
    const stages = loadStagedRun(card.id);
    // Deterministic stages survived and persisted.
    expect(stages.find((s) => s.stage === 'property_facts')!.status).toBe('completed');
    expect(stages.find((s) => s.stage === 'comp_rows')!.status).toBe('completed');
    // The model stage failed honestly.
    expect(stages.find((s) => s.stage === 'frontage_access')!.status).toBe('failed');
    // Synthesis still ran from persisted evidence (confidence falls back).
    const run = loadBrowserUseRun(card.id);
    expect(run).not.toBeNull();
    expect(run!.result.findings!.failed_actions.length).toBeGreaterThan(0);
    expect(outcome.ok).toBe(true); // synthesis completed despite a failed stage
  });

  it('fails honestly without a deterministic parcel URL and persists nothing', async () => {
    const card = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: '1 No Inspection Rd' }).card;
    const deal = createDealCard({ entity: 'TY_LAND_BIZ', title: 'No URL' });
    linkPropertyToDeal({ dealCardId: deal.id, cardId: card.id, role: 'subject' });
    const outcome = await runLandPortalStagedPilot(deal.id, 'ollama', {
      ensureAuth: async () => authOk, driver: fakeDriver(), model: goodModel, config: testConfig, skipTabHygiene: true,
    });
    expect(outcome.error).toMatch(/parcel URL/);
    expect(loadStagedRun(card.id)).toEqual([]);
  });

  it('never contaminates another card', async () => {
    const { card, deal } = subjectCard();
    const other = upsertPropertyCard({ entity: 'TY_LAND_BIZ', activeInputAddress: '700 Unrelated Rd' }).card;
    await runLandPortalStagedPilot(deal.id, 'ollama', {
      ensureAuth: async () => authOk, driver: fakeDriver(), model: goodModel, config: testConfig, skipTabHygiene: true,
    });
    expect(loadStagedRun(other.id)).toEqual([]);
    expect(getCardActivity(card.id).some((a) => a.kind === STAGED_ACTIVITY_KIND)).toBe(true);
  });
});

describe('loadStagedRun', () => {
  it('returns only the newest run, newest row per stage, in canonical order', () => {
    const { card } = subjectCard();
    const rec = (runId: string, stage: StageRecord['stage'], status: StageRecord['status']): StageRecord => ({
      runId, stage, status, provider: 'x', startedAt: 't', finishedAt: 't', modelCalls: 0, data: {}, error: null,
    });
    persistStage(card.id, rec('run_a', 'subject_parcel', 'completed'));
    persistStage(card.id, rec('run_b', 'subject_parcel', 'failed'));
    persistStage(card.id, rec('run_b', 'property_facts', 'completed'));
    const stages = loadStagedRun(card.id);
    expect(stages.length).toBe(2);
    expect(stages[0].runId).toBe('run_b');
    expect(stages[0].stage).toBe('subject_parcel');
  });
});
