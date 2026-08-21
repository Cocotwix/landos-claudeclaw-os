import { describe, expect, it } from 'vitest';

import {
  analystInvocationArgs,
  createHermesAcquisitionAnalyst,
  groundedObservationDrafts,
  isUsableVisualObservation,
  judgmentPrompt,
  resolveAnalystModel,
  ACQUISITION_ANALYST_PROFILE,
  ACQUISITION_ANALYST_SKILL,
  ACQUISITION_ANALYST_ENGINE,
  ANALYST_RUNTIME_KEYS,
  ANALYST_TOOLSETS,
  DEFAULT_ANALYST_MODEL,
  DEFAULT_ANALYST_PROVIDER,
  type SettingsReader,
} from './acquisition-analyst.js';
import { buildAcquisitionDossier, type AcquisitionDossier, type PropertyFileSource } from './acquisition-intelligence-dossier.js';

// The point of these tests is the durability promise: the ANALYST (persona,
// skill, memory) is fixed and the MODEL is swappable, and no business behaviour
// is written against whichever model is in use today — plus the grounding
// promise: this runtime has no proven image-attachment mechanism, so visual
// evidence enters ONLY as pixel-grounded observations carried on the dossier.

function settings(values: Record<string, string> = {}): SettingsReader {
  const store = { ...values };
  return {
    getDashboardSetting: (key) => store[key] ?? null,
    setDashboardSetting: (key, value) => { store[key] = value; },
  };
}

function dossier(source: Partial<PropertyFileSource> = {}, overrides: Partial<AcquisitionDossier> = {}): AcquisitionDossier {
  return {
    ...buildAcquisitionDossier({
      dealCardId: 89,
      now: () => new Date('2026-08-18T00:00:00.000Z'),
      propertyIntelligence: { snapshot: { identity: { state: 'confirmed', displayAddress: '1 Test Rd', acres: 6 } } },
      visuals: [
        { key: 'close_parcel_aerial', label: 'close parcel aerial', purpose: 'Close aerial', filePath: 'C:/store/visuals/close.png' },
        { key: 'surrounding_area_aerial', label: 'surrounding area aerial', purpose: 'Surrounding aerial', filePath: 'C:/store/visuals/surrounding.png' },
      ],
      ...source,
    }),
    ...overrides,
  };
}

const GROUNDED_OBSERVATION = {
  category: 'improvements',
  observation: 'No dwelling or structure is visible on the parcel; the tract is wooded with a cleared strip along the frontage.',
  signal: 'concern',
  confidence: 'medium',
  sourceImage: 'close parcel aerial',
  model: 'gemini-3-flash-preview',
  analyzedAt: '2026-08-20T00:00:00.000Z',
  capturedAt: null,
  pixelGrounded: true,
};

describe('the model is a setting, the analyst is not', () => {
  it('defaults an ordinary read to GPT-5.6 Sol on the configured openai-codex provider', () => {
    // Stated literally rather than against the constants: this is the assertion
    // that would fail if the shipped default silently moved.
    expect({ provider: DEFAULT_ANALYST_PROVIDER, model: DEFAULT_ANALYST_MODEL })
      .toEqual({ provider: 'openai-codex', model: 'gpt-5.6-sol' });
    expect(resolveAnalystModel(undefined, settings())).toEqual({
      provider: 'openai-codex', model: 'gpt-5.6-sol', source: 'default',
    });
  });

  it('lets an operator setting swap the reasoning model', () => {
    const selection = resolveAnalystModel(undefined, settings({
      [ANALYST_RUNTIME_KEYS.provider]: 'anthropic',
      [ANALYST_RUNTIME_KEYS.model]: 'claude-sonnet-5',
    }));
    expect(selection).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5', source: 'setting' });
  });

  it('lets one invocation pin a model without changing the setting', () => {
    const store = settings({ [ANALYST_RUNTIME_KEYS.model]: 'claude-sonnet-5' });
    expect(resolveAnalystModel({ provider: 'openai', model: 'gpt-5.6-sol' }, store).source).toBe('request');
    expect(resolveAnalystModel(undefined, store).model).toBe('claude-sonnet-5');
  });

  it('still runs the local Gemma runtime when a request or a setting names it', () => {
    // The default moving to Sol must not strand the model it replaced.
    expect(resolveAnalystModel({ provider: 'ollama', model: 'gemma4:12b' }, settings()))
      .toEqual({ provider: 'ollama', model: 'gemma4:12b', source: 'request' });
    expect(resolveAnalystModel(undefined, settings({
      [ANALYST_RUNTIME_KEYS.provider]: 'ollama',
      [ANALYST_RUNTIME_KEYS.model]: 'gemma4:12b',
    }))).toEqual({ provider: 'ollama', model: 'gemma4:12b', source: 'setting' });
  });

  it('keeps the profile, the skill and the toolset fixed across every model', () => {
    for (const model of [
      { provider: 'openai-codex', model: 'gpt-5.6-sol', source: 'default' as const },
      { provider: 'ollama', model: 'gemma4:12b', source: 'setting' as const },
      { provider: 'anthropic', model: 'claude-sonnet-5', source: 'setting' as const },
    ]) {
      const args = analystInvocationArgs({ prompt: 'p', model, toolsets: ANALYST_TOOLSETS, withSkill: true });
      expect(args).toEqual(expect.arrayContaining(['--profile', ACQUISITION_ANALYST_PROFILE]));
      expect(args).toEqual(expect.arrayContaining(['--skills', ACQUISITION_ANALYST_SKILL]));
      expect(args).toEqual(expect.arrayContaining(['--provider', model.provider, '-m', model.model]));
    }
  });

  it('runs with the minimal toolset only, so a read cannot research or write', () => {
    const args = analystInvocationArgs({
      prompt: 'p',
      model: { provider: 'ollama', model: 'gemma4:12b', source: 'default' },
      toolsets: ANALYST_TOOLSETS,
      withSkill: false,
    });
    const toolsets = args[args.indexOf('-t') + 1];
    expect(toolsets).toBe('clarify');
    for (const forbidden of ['web', 'browser', 'terminal', 'file']) expect(toolsets).not.toContain(forbidden);
  });
});

describe('grounded observations are the only visual evidence', () => {
  it('maps pixel-grounded dossier observations into drafts with model and recency provenance', () => {
    const drafts = groundedObservationDrafts(dossier({ visualObservations: [GROUNDED_OBSERVATION] }));
    expect(drafts).toHaveLength(1);
    expect(drafts[0].visual).toBe('vision_improvements');
    expect(drafts[0].observation).toMatch(/No dwelling or structure is visible/);
    expect(drafts[0].basis).toContain('Pixel-grounded gemini-3-flash-preview read of close parcel aerial');
    expect(drafts[0].basis).toContain('capture date unknown');
  });

  it('never lets filename/path-only input masquerade as a grounded observation', () => {
    // The path-only entry is dropped at the dossier gate itself: it is not
    // pixel-grounded, so no draft exists for the analyst to reason over.
    const built = dossier({
      visualObservations: [
        { category: 'improvements', observation: 'store/visuals/landportal_5_close.png', pixelGrounded: false },
        { category: 'access', observation: 'C:/store/visuals/close.png' },
      ],
    });
    expect(built.visualObservations).toEqual([]);
    expect(groundedObservationDrafts(built)).toEqual([]);
    expect(built.truncation.join(' ')).toMatch(/2 entries without proven pixel grounding were excluded/);
  });

  it('screens refusal chatter even when a grounded lane persisted it', () => {
    const built = dossier({
      visualObservations: [{
        ...GROUNDED_OBSERVATION,
        observation: 'I cannot see the image you are referring to; no image was attached to this request.',
      }],
    });
    expect(groundedObservationDrafts(built)).toEqual([]);
  });
});

describe('prompts', () => {
  it('inlines the property file but NEVER an image path in the judgment turn', () => {
    const prompt = judgmentPrompt(dossier(), [{ visual: 'vision_improvements', observation: 'No dwelling visible.', basis: 'Pixel-grounded gemini read' }]);
    expect(prompt).toContain('=== PROPERTY FILE (JSON) ===');
    expect(prompt).not.toContain('C:/store/visuals/close.png');
    expect(prompt).toContain('[vision_improvements] No dwelling visible. (Pixel-grounded gemini read)');
    expect(prompt).toMatch(/a vision model actually received the image pixels; you did not/i);
    // The analyst may cite the retained captures and the grounded observations.
    expect(prompt).toContain('close_parcel_aerial, surrounding_area_aerial, vision_improvements');
    expect(prompt).toMatch(/do not research/i);
  });

  it('carries the contradiction doctrine: observations are evidence, absence of a permit proves nothing', () => {
    const prompt = judgmentPrompt(dossier(), [{ visual: 'vision_improvements', observation: 'No dwelling visible.', basis: 'Pixel-grounded read' }]);
    expect(prompt).toMatch(/does what the imagery shows agree with what the records claim/i);
    expect(prompt).toMatch(/never treat the absence\s+of a record \(for example a demolition permit\) as proof/i);
    expect(prompt).toMatch(/never rewrite a record fact because of imagery/i);
  });

  it('says plainly when no grounded observation exists rather than implying vision happened', () => {
    const prompt = judgmentPrompt(dossier(), []);
    expect(prompt).toMatch(/No pixel-grounded visual observation is available/i);
    expect(prompt).toMatch(/you have not seen it/i);
  });
});

describe('what counts as having looked at the image', () => {
  // A model that did not see the picture still answers. Storing that answer as
  // an observation attributed to a named capture is fabricated visual evidence,
  // which is exactly what the retained imagery is supposed to prevent.
  it('rejects an idle or standing-instructions reply', () => {
    for (const reply of [
      'Ready for assignment. Please provide the dossier JSON path or specific task to begin work within the LandOS framework.',
      'I am ready. Provide the dossier path and the output path and I will begin the analysis for Tyler.',
      'I cannot see the image you are referring to; no image was attached to this request at all.',
    ]) {
      expect(isUsableVisualObservation(reply)).toBe(false);
    }
  });

  it('rejects a reply too short to be an observation', () => {
    expect(isUsableVisualObservation('A wooded parcel.')).toBe(false);
    expect(isUsableVisualObservation('')).toBe(false);
  });

  it('accepts a real description of what the capture shows', () => {
    expect(isUsableVisualObservation(
      'The parcel is roughly rectangular with a narrow northern boundary and a wider southern section near the road. '
      + 'A paved two-lane road runs along the frontage and the rear of the tract is densely wooded.',
    )).toBe(true);
  });
});

describe('running a read', () => {
  it('makes exactly ONE model call — the judgment — and never a per-image call', async () => {
    const calls: string[][] = [];
    const analyst = createHermesAcquisitionAnalyst({
      settings: settings(),
      now: () => 1_000,
      invoke: async (args) => {
        calls.push(args);
        return '{"deal_read":{"headline":"h"}}';
      },
    });
    const run = await analyst.run({ dossier: dossier({ visualObservations: [GROUNDED_OBSERVATION] }) });
    expect(calls).toHaveLength(1);
    expect(calls[0].join(' ')).toContain('PROPERTY FILE');
    expect(run.observations.map((observation) => observation.visual)).toEqual(['vision_improvements']);
    expect(run.runtime).toMatchObject({
      engine: ACQUISITION_ANALYST_ENGINE,
      agentProfile: ACQUISITION_ANALYST_PROFILE,
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
      modelSource: 'default',
    });
    expect(run.raw).toContain('deal_read');
  });

  it('warns when imagery exists but nothing pixel-grounded has looked at it yet', async () => {
    const analyst = createHermesAcquisitionAnalyst({
      settings: settings(),
      invoke: async () => '{"deal_read":{"headline":"h"}}',
    });
    const run = await analyst.run({ dossier: dossier() });
    expect(run.observations).toEqual([]);
    expect(run.warnings.join(' ')).toMatch(/no pixel-grounded visual observation has been produced/i);
  });
});
