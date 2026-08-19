// LandOS — the Hermes Acquisition Analyst.
//
// The reasoning executor behind Acquisition Intelligence. It reuses the Hermes
// integration LandOS already has (`hermes-landportal-auto.ts`): the same
// installed runtime, the same one-shot invocation, the same profile model. It
// does not introduce a second Hermes architecture.
//
// The separation that makes the analyst durable:
//
//   THE AGENT is `landos-acquisition-analyst` — a dedicated Hermes profile that
//   owns the land-acquisition operating instructions (SOUL), the reusable
//   how-to-evaluate-land skill, and persistent memory. It accumulates method
//   across properties and belongs to LandOS.
//
//   THE RUNTIME MODEL is a per-invocation flag. GPT-5.6 Sol through the
//   configured `openai-codex` provider is the default; the local Ollama runtime
//   and any other model remain a setting change away. Swapping it never touches
//   the profile, the skill or the memory, and no business logic anywhere is
//   written against a particular model.
//
// Two bounded passes, deliberately, rather than one agentic loop:
//
//   1. VISUAL — one narrow call per retained image. A local model reliably
//      describes an image it is pointed at; it does not reliably drive a
//      multi-step tool loop. Each observation is attributed to its image.
//   2. JUDGMENT — one call carrying the dossier inline, with the visual
//      observations folded in. The dossier travels IN the prompt rather than as
//      a file the model must remember to open, so the reasoning pass cannot
//      fail for want of a tool call.
//
// Neither pass can research. Both run with the minimal `clarify` toolset only:
// no web, no browser, no terminal, no file writes. That is a structural bound
// rather than a promise in a prompt — and it is also what makes the visual pass
// work at all, because attaching a full tool schema alongside an image is what
// the local runtime refuses to tokenize.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { AcquisitionDossier } from './acquisition-intelligence-dossier.js';
import type { AcquisitionIntelligenceRuntime } from './acquisition-intelligence-contract.js';
import { getDashboardSetting, setDashboardSetting } from '../db.js';
import { logger } from '../logger.js';

const execFileAsync = promisify(execFile);

export const ACQUISITION_ANALYST_PROFILE = 'landos-acquisition-analyst';
export const ACQUISITION_ANALYST_SKILL = 'landos-acquisition-analysis';
export const ACQUISITION_ANALYST_ENGINE = 'hermes';

/** Default runtime: GPT-5.6 Sol through the already-configured `openai-codex`
 *  provider. A DEFAULT, not a dependency — every consumer of Acquisition
 *  Intelligence is written against the capability contract, never against this
 *  model, and the local Ollama runtime is still one setting away below. */
export const DEFAULT_ANALYST_PROVIDER = 'openai-codex';
export const DEFAULT_ANALYST_MODEL = 'gpt-5.6-sol';

/** Persisted operator overrides. Same `dashboard_settings` KV the model router
 *  already uses, so swapping the reasoning engine is a setting, not a rebuild. */
export const ANALYST_RUNTIME_KEYS = {
  provider: 'landos.acquisition_intelligence.provider',
  model: 'landos.acquisition_intelligence.model',
} as const;

export interface AnalystModelSelection {
  provider: string;
  model: string;
  source: 'setting' | 'default' | 'request';
}

export interface SettingsReader {
  getDashboardSetting(key: string): string | null;
  setDashboardSetting(key: string, value: string): void;
}

const realSettings: SettingsReader = {
  getDashboardSetting: (key) => { try { return getDashboardSetting(key); } catch { return null; } },
  setDashboardSetting: (key, value) => { try { setDashboardSetting(key, value); } catch { /* absent DB degrades to default */ } },
};

/**
 * The reasoning model for this run: an explicit request wins, then the
 * persisted operator setting, then the V1 default.
 */
export function resolveAnalystModel(
  requested?: { provider?: string | null; model?: string | null },
  settings: SettingsReader = realSettings,
): AnalystModelSelection {
  const requestedModel = (requested?.model ?? '').trim();
  const requestedProvider = (requested?.provider ?? '').trim();
  if (requestedModel) {
    return { provider: requestedProvider || DEFAULT_ANALYST_PROVIDER, model: requestedModel, source: 'request' };
  }
  const settingModel = (settings.getDashboardSetting(ANALYST_RUNTIME_KEYS.model) ?? '').trim();
  if (settingModel) {
    const settingProvider = (settings.getDashboardSetting(ANALYST_RUNTIME_KEYS.provider) ?? '').trim();
    return { provider: settingProvider || DEFAULT_ANALYST_PROVIDER, model: settingModel, source: 'setting' };
  }
  return { provider: DEFAULT_ANALYST_PROVIDER, model: DEFAULT_ANALYST_MODEL, source: 'default' };
}

/** Point the analyst at a different reasoning model. The Hermes profile, its
 *  skill and its memory are untouched by this. */
export function setAnalystModel(provider: string, model: string, settings: SettingsReader = realSettings): void {
  settings.setDashboardSetting(ANALYST_RUNTIME_KEYS.provider, provider.trim());
  settings.setDashboardSetting(ANALYST_RUNTIME_KEYS.model, model.trim());
}

// ── Prompts ───────────────────────────────────────────────────────────────

/**
 * Bounded per-image inspection. One image, one question, plain text back.
 *
 * Naming the file path is what ATTACHES the image to the turn: the analyst is
 * shown the picture, not told about it.
 */
export function visualInspectionPrompt(visual: { key: string; label: string; purpose: string | null; filePath: string }, subject: string): string {
  return [
    `Look at the retained LandOS property image at ${visual.filePath.replace(/\\/g, '/')}.`,
    `It is the "${visual.label}" capture for ${subject}.`,
    visual.purpose ? `It was taken to show: ${visual.purpose}.` : '',
    '',
    'In at most four short sentences, state only what the image itself shows that a data field would not:',
    'the shape of the parcel and where its narrow and wide parts are, where roads run and whether any road',
    'approaches or stops near a boundary, neighbouring development or subdivisions, adjoining vacant ground,',
    'and how much of the tract looks cleared versus wooded.',
    '',
    'Describe only what is visible. Do not conclude that legal access, an easement, ownership, or an entitlement exists.',
    'Plain text only, no JSON, no preamble.',
  ].filter(Boolean).join('\n');
}

/**
 * The judgment pass. The dossier travels inline; the output contract is
 * restated here so it holds even if the skill were unavailable.
 *
 * Image FILE PATHS are stripped from the inlined dossier on purpose. A path in
 * a turn attaches that image, and attaching every retained capture to the
 * reasoning turn is both wasteful and the exact payload the local runtime
 * cannot tokenize. The pictures were already looked at in pass 1; this pass
 * reasons over what was seen.
 */
export function judgmentPrompt(dossier: AcquisitionDossier, observations: VisualObservationDraft[]): string {
  const subject = dossier.identity.displayAddress ?? dossier.identity.apn ?? 'the subject parcel';
  const visualKeys = dossier.visuals.map((visual) => visual.key);
  const inlined: AcquisitionDossier = {
    ...dossier,
    visuals: dossier.visuals.map(({ filePath: _filePath, ...visual }) => ({ ...visual, filePath: null })),
  };
  return [
    `You are producing the LandOS Acquisition Intelligence read for ${subject}.`,
    '',
    'Follow the landos-acquisition-analysis skill. The PROPERTY FILE below is the complete world for this run:',
    'do not research, do not browse, and do not assert any fact it does not carry. Where it says something is',
    'not established, it is not established.',
    '',
    '=== PROPERTY FILE (JSON) ===',
    JSON.stringify(inlined),
    '=== END PROPERTY FILE ===',
    '',
    observations.length
      ? [
        '=== VISUAL OBSERVATIONS (from the retained imagery, already inspected) ===',
        ...observations.map((observation) => `[${observation.visual}] ${observation.observation}`),
        '=== END VISUAL OBSERVATIONS ===',
        '',
      ].join('\n')
      : 'No retained image could be inspected for this property.',
    '',
    'Think across the whole file rather than section by section. Say what the combinations mean.',
    'Rank only the strategies THIS property actually supports and mark the ones it does not as rejected.',
    'Carry every conflict in the file, with both values.',
    visualKeys.length
      ? `Cite images only by these exact keys: ${visualKeys.join(', ')}.`
      : 'There are no image keys to cite.',
    '',
    'Reply with ONE JSON object and nothing else, using exactly these keys:',
    '{"deal_read":{"headline":"","judgment":"","confidence":"Confirmed|Well supported|Likely|Unresolved"},',
    '"property_story":[],"market_story":[],',
    '"opportunities":[{"title":"","why":"","what_would_confirm":""}],',
    '"constraints":[{"title":"","why":"","severity":"high|medium|low"}],',
    '"strategies":[{"strategy":"","fit":"strong|possible|weak|rejected","why_it_fits":"","value_creation":"","what_weakens_it":"","what_to_confirm":""}],',
    '"visual_observations":[{"visual":"","observation":"","basis":""}],',
    '"conflicts":[{"subject":"","statement":"","resolution":""}],',
    '"unknowns":[{"question":"","why_it_matters":""}],',
    '"next_actions":[{"action":"","why":""}]}',
  ].join('\n');
}

// ── Execution ─────────────────────────────────────────────────────────────

export interface VisualObservationDraft {
  visual: string;
  observation: string;
  basis: string;
}

/**
 * A model that did not actually look at the image still replies with SOMETHING
 * — usually its own standing instructions ("ready for assignment, provide the
 * dossier path"). Stored unchecked, that lands on the Deal Card labelled as an
 * observation from a named capture, which is the one thing visual evidence must
 * never be: a sentence that reads like it came from the picture and did not.
 *
 * So a reply is only an observation when it is long enough to be one and does
 * not read as an idle or refusing turn. Everything else is recorded as "this
 * capture produced no observation", which is true and useful.
 */
const NON_OBSERVATION = /\b(?:ready (?:for|to)\b|please provide|provide the (?:dossier|output|json)|i am ready|awaiting (?:your|the)|i (?:cannot|can't|am unable to) (?:see|view|access|open)|no image (?:was )?(?:provided|attached))/i;

export function isUsableVisualObservation(text: string): boolean {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length < 60) return false;
  return !NON_OBSERVATION.test(trimmed);
}

export interface AnalystRunInput {
  dossier: AcquisitionDossier;
  requestedProvider?: string | null;
  requestedModel?: string | null;
}

export interface AnalystRunOutput {
  raw: string;
  runtime: AcquisitionIntelligenceRuntime;
  observations: VisualObservationDraft[];
  warnings: string[];
}

/** The seam every caller uses. Tests substitute a fake; nothing outside this
 *  module knows the executor is Hermes or which model reasoned. */
export interface AcquisitionAnalyst {
  run(input: AnalystRunInput): Promise<AnalystRunOutput>;
}

export interface HermesAnalystDeps {
  /** Invoke the installed Hermes one-shot. Injected so tests never spawn. */
  invoke?: (args: string[], timeoutMs: number) => Promise<string>;
  settings?: SettingsReader;
  now?: () => number;
  /** How many retained images one run may inspect. Bounded because each image
   *  is a full model call. */
  maxVisuals?: number;
  visualTimeoutMs?: number;
  judgmentTimeoutMs?: number;
}

/**
 * Ceilings, measured against the V1 runtime rather than guessed.
 *
 * On the local Gemma 4 runtime a warm image read lands in about two minutes and
 * the judgment pass over a full property file in about two. The FIRST call of a
 * run is the outlier: it pays for loading the model with its full context
 * window, and on an 8 GB GPU that spills to host memory. A 6-minute image
 * ceiling measurably clipped that first call, losing a capture the analyst was
 * otherwise about to describe, so the image ceiling is set above the cold call
 * rather than the warm one. Both still bound a stalled runtime.
 */
export const ANALYST_VISUAL_TIMEOUT_MS = 10 * 60_000;
export const ANALYST_JUDGMENT_TIMEOUT_MS = 20 * 60_000;

/**
 * How many retained images one read inspects.
 *
 * Each image is a full model call, so this is the difference between a read an
 * operator waits through and one they abandon. Three covers the captures that
 * actually carry information no field holds — the surrounding area, the parcel
 * itself, and the road frontage — and `prioritizeVisuals` guarantees those are
 * the three that get spent.
 */
export const ANALYST_MAX_VISUALS = 3;

/**
 * The only toolset either pass runs with.
 *
 * `clarify` is a no-op question channel: it acts on nothing. Two things follow,
 * and both are wanted. The analyst cannot research, read the repository, or
 * write a file — the sandbox is structural, not a promise in a prompt. And the
 * turn carries no tool schema, which is what lets the local runtime accept an
 * attached image; with a full toolset attached the same request fails to
 * tokenize and the analyst never sees the picture at all.
 */
export const ANALYST_TOOLSETS = 'clarify';

/** Which captures earn a model call when a property has more images than the
 *  budget. The wide reads come first: they carry the context no field holds. */
const VISUAL_PRIORITY = [
  'surrounding_area_aerial',
  'close_parcel_aerial',
  'road_frontage_aerial',
  'parcel_context',
  'clean_parcel_aerial',
  'front_side_3d',
  'contour_terrain_view',
  'rear_side_3d',
];

export function prioritizeVisuals<T extends { key: string; filePath: string | null }>(visuals: T[], limit: number): T[] {
  const rank = (key: string) => {
    const index = VISUAL_PRIORITY.indexOf(key);
    return index === -1 ? VISUAL_PRIORITY.length : index;
  };
  return visuals
    .filter((visual) => !!visual.filePath)
    .sort((a, b) => rank(a.key) - rank(b.key))
    .slice(0, Math.max(0, limit));
}

function installedHermes(): { python: string; launcher: string; profileHome: string } {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const root = path.join(localAppData, 'hermes', 'hermes-agent');
  const python = process.platform === 'win32'
    ? path.join(root, 'venv', 'Scripts', 'python.exe')
    : path.join(root, 'venv', 'bin', 'python');
  const launcher = path.join(root, 'hermes');
  if (!fs.existsSync(python) || !fs.existsSync(launcher)) {
    throw new Error(`The Hermes runtime was not found under ${root}.`);
  }
  const profileHome = path.join(localAppData, 'hermes', 'profiles', ACQUISITION_ANALYST_PROFILE);
  if (!fs.existsSync(path.join(profileHome, 'config.yaml'))) {
    throw new Error(`The Hermes Acquisition Analyst profile is not provisioned. Run: npm run landos:hermes:analyst`);
  }
  return { python, launcher, profileHome };
}

/**
 * One-shot arguments.
 *
 * `-m` / `--provider` are per-invocation overrides: they select the reasoning
 * engine for this run and leave the profile's persona, skill and memory exactly
 * as they are. That is the whole mechanism behind "swap the model without
 * losing the agent".
 */
export function analystInvocationArgs(input: {
  prompt: string;
  model: AnalystModelSelection;
  toolsets: string;
  withSkill: boolean;
}): string[] {
  return [
    '--profile', ACQUISITION_ANALYST_PROFILE,
    ...(input.withSkill ? ['--skills', ACQUISITION_ANALYST_SKILL] : []),
    '--provider', input.model.provider,
    '-m', input.model.model,
    '-t', input.toolsets,
    '--oneshot', input.prompt,
  ];
}

export function createHermesAcquisitionAnalyst(deps: HermesAnalystDeps = {}): AcquisitionAnalyst {
  const maxVisuals = deps.maxVisuals ?? ANALYST_MAX_VISUALS;
  const visualTimeoutMs = deps.visualTimeoutMs ?? ANALYST_VISUAL_TIMEOUT_MS;
  const judgmentTimeoutMs = deps.judgmentTimeoutMs ?? ANALYST_JUDGMENT_TIMEOUT_MS;
  const now = deps.now ?? (() => Date.now());

  const invoke = deps.invoke ?? (async (args: string[], timeoutMs: number): Promise<string> => {
    const { python, launcher } = installedHermes();
    try {
      const { stdout } = await execFileAsync(python, [launcher, ...args], {
        cwd: process.cwd(),
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      });
      return stdout ?? '';
    } catch (error) {
      // The default message is the whole command line, which tells an operator
      // nothing about WHY. The runtime's own first line of stderr does, so that
      // is what travels into the warning.
      const detail = error as { killed?: boolean; signal?: string | null; stderr?: string; stdout?: string };
      if (detail?.killed || detail?.signal === 'SIGTERM') {
        throw new Error(`the analyst exceeded its ${Math.round(timeoutMs / 1_000)}s limit`);
      }
      const reported = String(detail?.stderr || detail?.stdout || '').trim().split(/[\r\n]+/).find((line) => line.trim());
      throw new Error(reported?.slice(0, 300) || 'the local reasoning runtime exited without output');
    }
  });

  return {
    async run(input: AnalystRunInput): Promise<AnalystRunOutput> {
      const startedAt = now();
      const model = resolveAnalystModel(
        { provider: input.requestedProvider, model: input.requestedModel },
        deps.settings ?? realSettings,
      );
      const warnings: string[] = [];
      const subject = input.dossier.identity.displayAddress ?? input.dossier.identity.apn ?? 'the subject parcel';

      // Pass 1 — visual evidence. A failed image is a missing observation, not
      // a failed run: the judgment pass proceeds with what was actually seen.
      const observations: VisualObservationDraft[] = [];
      const selected = prioritizeVisuals(input.dossier.visuals, maxVisuals);
      const skipped = input.dossier.visuals.filter((visual) => visual.filePath && !selected.includes(visual as never));
      if (skipped.length) {
        warnings.push(`${skipped.length} retained image(s) were not inspected this run: the analyst inspects the ${maxVisuals} most informative captures.`);
      }
      for (const visual of selected) {
        if (!visual.filePath) continue;
        try {
          const text = await invoke(
            analystInvocationArgs({
              prompt: visualInspectionPrompt({ ...visual, filePath: visual.filePath }, subject),
              model,
              toolsets: ANALYST_TOOLSETS,
              withSkill: false,
            }),
            visualTimeoutMs,
          );
          const observation = text.replace(/\s+/g, ' ').trim();
          if (isUsableVisualObservation(observation)) {
            observations.push({ visual: visual.key, observation: observation.slice(0, 1_200), basis: `Retained ${visual.label} capture` });
          } else {
            warnings.push(`The ${visual.label} capture produced no usable observation and was not carried into the read.`);
          }
        } catch (error) {
          const detail = (error as Error)?.message?.split(/\r?\n/, 1)[0] ?? 'unknown error';
          logger.warn({ event: 'acquisition_analyst_visual_failed', visual: visual.key, detail }, 'acquisition_analyst_visual_failed');
          warnings.push(`The ${visual.label} capture could not be inspected: ${detail}.`);
        }
      }

      // Pass 2 — the judgment.
      const raw = await invoke(
        analystInvocationArgs({
          prompt: judgmentPrompt(input.dossier, observations),
          model,
          toolsets: ANALYST_TOOLSETS,
          withSkill: true,
        }),
        judgmentTimeoutMs,
      );

      return {
        raw,
        observations,
        warnings,
        runtime: {
          engine: ACQUISITION_ANALYST_ENGINE,
          agentProfile: ACQUISITION_ANALYST_PROFILE,
          provider: model.provider,
          model: model.model,
          modelSource: model.source,
          durationMs: Math.max(0, now() - startedAt),
        },
      };
    },
  };
}

/**
 * What the NEXT run would use, without running anything.
 *
 * The operator surface states which agent and which reasoning model produced a
 * judgment, and which one would produce the next. Naming the profile separately
 * from the model is the point: the model is swappable, the analyst is not.
 */
export function acquisitionAnalystRuntimeStatus(settings: SettingsReader = realSettings): {
  engine: string;
  agentProfile: string;
  provider: string;
  model: string;
  modelSource: AnalystModelSelection['source'];
  provisioned: boolean;
} {
  const selection = resolveAnalystModel(undefined, settings);
  let provisioned = false;
  try {
    installedHermes();
    provisioned = true;
  } catch {
    provisioned = false;
  }
  return {
    engine: ACQUISITION_ANALYST_ENGINE,
    agentProfile: ACQUISITION_ANALYST_PROFILE,
    provider: selection.provider,
    model: selection.model,
    modelSource: selection.source,
    provisioned,
  };
}

/** Stable identity for the exact property file a read was formed from. */
export function dossierFingerprint(dossier: AcquisitionDossier): string {
  const { assembledAt: _assembledAt, ...stable } = dossier;
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 32);
}
