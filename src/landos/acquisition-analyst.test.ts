import { describe, expect, it } from 'vitest';

import {
  analystInvocationArgs,
  createHermesAcquisitionAnalyst,
  isUsableVisualObservation,
  judgmentPrompt,
  prioritizeVisuals,
  resolveAnalystModel,
  visualInspectionPrompt,
  ACQUISITION_ANALYST_PROFILE,
  ACQUISITION_ANALYST_SKILL,
  ACQUISITION_ANALYST_ENGINE,
  ANALYST_RUNTIME_KEYS,
  ANALYST_TOOLSETS,
  DEFAULT_ANALYST_MODEL,
  DEFAULT_ANALYST_PROVIDER,
  type SettingsReader,
} from './acquisition-analyst.js';
import { buildAcquisitionDossier, type AcquisitionDossier } from './acquisition-intelligence-dossier.js';

// The point of these tests is the durability promise: the ANALYST (persona,
// skill, memory) is fixed and the MODEL is swappable, and no business behaviour
// is written against whichever model is in use today.

function settings(values: Record<string, string> = {}): SettingsReader {
  const store = { ...values };
  return {
    getDashboardSetting: (key) => store[key] ?? null,
    setDashboardSetting: (key, value) => { store[key] = value; },
  };
}

function dossier(overrides: Partial<AcquisitionDossier> = {}): AcquisitionDossier {
  return {
    ...buildAcquisitionDossier({
      dealCardId: 89,
      now: () => new Date('2026-08-18T00:00:00.000Z'),
      propertyIntelligence: { snapshot: { identity: { state: 'confirmed', displayAddress: '1 Test Rd', acres: 6 } } },
      visuals: [
        { key: 'close_parcel_aerial', label: 'close parcel aerial', purpose: 'Close aerial', filePath: 'C:/store/visuals/close.png' },
        { key: 'surrounding_area_aerial', label: 'surrounding area aerial', purpose: 'Surrounding aerial', filePath: 'C:/store/visuals/surrounding.png' },
      ],
    }),
    ...overrides,
  };
}

describe('the model is a setting, the analyst is not', () => {
  it('defaults to Gemma 4 on the local Ollama runtime', () => {
    expect(resolveAnalystModel(undefined, settings())).toEqual({
      provider: DEFAULT_ANALYST_PROVIDER, model: DEFAULT_ANALYST_MODEL, source: 'default',
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
    const store = settings({ [ANALYST_RUNTIME_KEYS.model]: 'gemma4:12b' });
    expect(resolveAnalystModel({ provider: 'openai', model: 'gpt-5.6-sol' }, store).source).toBe('request');
    expect(resolveAnalystModel(undefined, store).model).toBe('gemma4:12b');
  });

  it('keeps the profile, the skill and the toolset fixed across every model', () => {
    for (const model of [
      { provider: 'ollama', model: 'gemma4:12b', source: 'default' as const },
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

describe('prompts', () => {
  it('names the image path, which is what actually shows the analyst the picture', () => {
    const prompt = visualInspectionPrompt(
      { key: 'close_parcel_aerial', label: 'close parcel aerial', purpose: 'Close aerial', filePath: 'C:\\store\\visuals\\close.png' },
      '1 Test Rd',
    );
    expect(prompt).toContain('C:/store/visuals/close.png');
    expect(prompt).toMatch(/Do not conclude that legal access/i);
  });

  it('inlines the property file but NEVER an image path in the judgment turn', () => {
    const prompt = judgmentPrompt(dossier(), [{ visual: 'close_parcel_aerial', observation: 'Narrow at the road.', basis: 'capture' }]);
    expect(prompt).toContain('=== PROPERTY FILE (JSON) ===');
    expect(prompt).not.toContain('C:/store/visuals/close.png');
    expect(prompt).toContain('[close_parcel_aerial] Narrow at the road.');
    // The analyst may cite only the images this property actually has.
    expect(prompt).toContain('close_parcel_aerial, surrounding_area_aerial');
    expect(prompt).toMatch(/do not research/i);
  });

  it('says plainly when no image could be inspected rather than implying one was', () => {
    expect(judgmentPrompt(dossier(), [])).toMatch(/No retained image could be inspected/i);
  });
});

describe('visual budget', () => {
  it('spends the budget on the widest, most informative captures first', () => {
    const visuals = [
      { key: 'soil_overlay', filePath: 'a.png' },
      { key: 'close_parcel_aerial', filePath: 'b.png' },
      { key: 'surrounding_area_aerial', filePath: 'c.png' },
      { key: 'comparables_map', filePath: 'd.png' },
      { key: 'road_frontage_aerial', filePath: 'e.png' },
    ];
    expect(prioritizeVisuals(visuals, 3).map((visual) => visual.key))
      .toEqual(['surrounding_area_aerial', 'close_parcel_aerial', 'road_frontage_aerial']);
  });

  it('skips a retained visual with no file on this machine', () => {
    expect(prioritizeVisuals([{ key: 'close_parcel_aerial', filePath: null }], 4)).toEqual([]);
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

  it('keeps a non-observation out of the read entirely', async () => {
    const analyst = createHermesAcquisitionAnalyst({
      settings: settings(),
      maxVisuals: 1,
      invoke: async (args) => (args.some((arg) => arg.includes('PROPERTY FILE'))
        ? '{"deal_read":{"headline":"h"}}'
        : 'Ready for assignment. Please provide the dossier JSON path.'),
    });
    const run = await analyst.run({ dossier: dossier() });
    expect(run.observations).toEqual([]);
    expect(run.warnings.join(' ')).toMatch(/produced no usable observation/);
  });
});

describe('running a read', () => {
  it('inspects each image, then reasons once, and attributes the runtime', async () => {
    const calls: string[][] = [];
    const analyst = createHermesAcquisitionAnalyst({
      settings: settings(),
      now: () => 1_000,
      invoke: async (args) => {
        calls.push(args);
        return args.some((arg) => arg.includes('PROPERTY FILE'))
          ? '{"deal_read":{"headline":"h"}}'
          : 'The tract is wooded and narrows at the road end, with a cleared strip along the frontage and neighbouring lots to the east.';
      },
    });
    const run = await analyst.run({ dossier: dossier() });
    expect(calls).toHaveLength(3); // two images, then the judgment
    expect(run.observations.map((observation) => observation.visual))
      .toEqual(['surrounding_area_aerial', 'close_parcel_aerial']);
    expect(run.runtime).toMatchObject({
      engine: ACQUISITION_ANALYST_ENGINE,
      agentProfile: ACQUISITION_ANALYST_PROFILE,
      provider: 'ollama',
      model: 'gemma4:12b',
      modelSource: 'default',
    });
    expect(run.raw).toContain('deal_read');
  });

  it('treats a failed image as a missing observation, not a failed read', async () => {
    const analyst = createHermesAcquisitionAnalyst({
      settings: settings(),
      invoke: async (args) => {
        if (args.some((arg) => arg.includes('close.png'))) throw new Error('vision runtime refused the frame');
        if (args.some((arg) => arg.includes('PROPERTY FILE'))) return '{"deal_read":{"headline":"h"}}';
        return 'A newer subdivision borders the far side of the tract and a paved road stops close to that boundary.';
      },
    });
    const run = await analyst.run({ dossier: dossier() });
    expect(run.observations.map((observation) => observation.visual)).toEqual(['surrounding_area_aerial']);
    expect(run.warnings.join(' ')).toMatch(/could not be inspected: vision runtime refused the frame/);
    expect(run.raw).toContain('deal_read');
  });

  it('reports when the budget left retained imagery uninspected', async () => {
    const analyst = createHermesAcquisitionAnalyst({
      settings: settings(),
      maxVisuals: 1,
      invoke: async () => 'The tract is wooded across its rear half with a cleared strip along the road frontage and open ground to the east.',
    });
    const run = await analyst.run({ dossier: dossier() });
    expect(run.warnings.join(' ')).toMatch(/1 retained image\(s\) were not inspected/);
  });
});
