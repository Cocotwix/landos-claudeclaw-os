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
// ONE bounded pass: JUDGMENT — one call carrying the dossier inline, with the
// pixel-grounded visual observations folded in. The dossier travels IN the
// prompt rather than as a file the model must remember to open, so the
// reasoning pass cannot fail for want of a tool call.
//
// There is deliberately NO per-image "visual pass" here any more. That pass
// placed an image FILE PATH into the prompt text on the premise that naming
// the path attaches the picture. Inspection of the installed Hermes runtime
// disproved the premise: in one-shot mode an image is attached only via the
// `--image` flag, a message that IS a dropped file path, or a kanban task-body
// scan — none of which this invocation uses — and the free-text path scanner
// (`agent/image_routing.extract_image_refs`) anchors on `/` or `~/` and can
// never match a Windows `C:/…` path. The model was receiving a filename, not
// pixels, and a filename is not vision. Grounded observations now arrive on
// `dossier.visualObservations`, produced by the vision path that provably
// base64-encodes the image bytes (`browser-vision.ts` → Gemini `inlineData`).
//
// The pass cannot research. It runs with the minimal `clarify` toolset only:
// no web, no browser, no terminal, no file writes. That is a structural bound
// rather than a promise in a prompt.

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
 * The judgment pass. The dossier travels inline; the output contract is
 * restated here so it holds even if the skill were unavailable.
 *
 * Image FILE PATHS are stripped from the inlined dossier on purpose: the
 * reasoning runtime has no proven image-attachment mechanism, so a path in the
 * prompt is dead weight at best and fake vision at worst. The pixels were
 * already looked at by the grounded vision path; this pass reasons over what
 * that path actually saw.
 */
export function judgmentPrompt(dossier: AcquisitionDossier, observations: VisualObservationDraft[]): string {
  const subject = dossier.identity.displayAddress ?? dossier.identity.apn ?? 'the subject parcel';
  const visualKeys = [...new Set([...dossier.visuals.map((visual) => visual.key), ...observations.map((observation) => observation.visual)])];
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
        '=== GROUNDED VISUAL OBSERVATIONS (a vision model actually received the image pixels; you did not) ===',
        ...observations.map((observation) => `[${observation.visual}] ${observation.observation}${observation.basis ? ` (${observation.basis})` : ''}`),
        '=== END GROUNDED VISUAL OBSERVATIONS ===',
        '',
        'These observations are EVIDENCE from the retained imagery, not canonical facts, and imagery may be stale.',
        'Ask of each: does what the imagery shows agree with what the records claim? Carry any material disagreement',
        'as a conflict with both values; never rewrite a record fact because of imagery, and never treat the absence',
        'of a record (for example a demolition permit) as proof about the ground.',
      ].join('\n')
      : 'No pixel-grounded visual observation is available for this property. Do not describe or characterize the imagery yourself: you have not seen it.',
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

// The "reply is only an observation when it actually observes" filter lives on
// the contract: it screens the grounded drafts assembled here and any
// observation the judgment pass writes into its own JSON.
import { isUsableVisualObservation, readsAsNonObservation } from './acquisition-intelligence-contract.js';
export { isUsableVisualObservation };

/** A layer of the Intelligence Stack that reaches a reasoning model. */
export type SpecialistModelLayer = 'property' | 'market' | 'seller' | 'deal';

/**
 * The per-layer execution plan the Intelligence Stack supplies alongside its
 * single combined prompt. The legacy single-profile analyst ignores it; the
 * persistent-specialist executor uses it to route each layer to its own Hermes
 * profile with a bounded, layer-specific prompt. Carrying BOTH on the same
 * input is the whole rollback story: the stack never knows which executor ran.
 */
export interface SpecialistExecutionPlan {
  dealCardId: number;
  /** The layers this pass must reason (already excludes deterministic
   *  pre-contact Seller). */
  layers: SpecialistModelLayer[];
  /** Bounded prompt for one non-deal layer. */
  layerPrompt: (
    layer: Exclude<SpecialistModelLayer, 'deal'>,
    dossier: AcquisitionDossier,
    observations: VisualObservationDraft[],
  ) => string;
  /** Property Stage A: free expert review over the complete Property file plus
   * grounded observations. Natural prose, preserved verbatim. */
  propertyReviewPrompt?: (
    dossier: AcquisitionDossier,
    observations: VisualObservationDraft[],
  ) => string;
  /** Property Stage B extraction over the exact Stage A review. */
  propertyExtractionPrompt?: (
    expertReview: string,
    dossier: AcquisitionDossier,
    observations: VisualObservationDraft[],
  ) => string;
  /** Market-only Stage A, built after Property has completed. Its output is
   * natural expert prose and is preserved verbatim. */
  marketReviewPrompt?: (
    propertyLayer: unknown,
    dossier: AcquisitionDossier,
    observations: VisualObservationDraft[],
  ) => string;
  /** Market-only Stage B extraction over the exact Stage A review. */
  marketExtractionPrompt?: (
    propertyLayer: unknown,
    expertReview: string,
    dossier: AcquisitionDossier,
    observations: VisualObservationDraft[],
  ) => string;
  /** The Deal Brain prompt, built AFTER the specialist layers return so the
   *  chair synthesizes from the fresh structured products. */
  dealPrompt: (
    freshLayers: Partial<Record<Exclude<SpecialistModelLayer, 'deal'>, unknown>>,
    dossier: AcquisitionDossier,
    observations: VisualObservationDraft[],
  ) => string;
}

export interface AnalystRunInput {
  dossier: AcquisitionDossier;
  requestedProvider?: string | null;
  requestedModel?: string | null;
  /** Build the judgment-pass prompt. Defaults to the V1 acquisition prompt, so
   *  a caller with a different question (the Intelligence Stack's coordinated
   *  layered pass) reuses the same analyst, passes and runtime unchanged. */
  judgmentPromptBuilder?: (dossier: AcquisitionDossier, observations: VisualObservationDraft[]) => string;
  /** Per-layer routing for the persistent-specialist executor. Optional and
   *  ignored by the legacy analyst. */
  specialistPlan?: SpecialistExecutionPlan;
}

export interface AnalystRunOutput {
  raw: string;
  runtime: AcquisitionIntelligenceRuntime;
  observations: VisualObservationDraft[];
  warnings: string[];
  /** Per-layer execution provenance when layers ran on different profiles.
   *  Absent on the legacy single-pass analyst. */
  layerRuntimes?: Partial<Record<SpecialistModelLayer, AcquisitionIntelligenceRuntime>>;
  /** Exact Market Stage A prose when the two-stage Market path ran. */
  marketExpertReview?: string;
  /** Exact Property Stage A prose when the two-stage Property path ran. */
  propertyExpertReview?: string;
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
  judgmentTimeoutMs?: number;
}

/** Ceiling measured against the V1 runtime rather than guessed: the judgment
 *  pass over a full property file lands in about two minutes warm, and the
 *  first call of a run pays for loading the model. Still bounds a stalled
 *  runtime. */
export const ANALYST_JUDGMENT_TIMEOUT_MS = 20 * 60_000;

/**
 * The only toolset the pass runs with.
 *
 * `clarify` is a no-op question channel: it acts on nothing. The analyst
 * cannot research, read the repository, or write a file — the sandbox is
 * structural, not a promise in a prompt.
 */
export const ANALYST_TOOLSETS = 'clarify';

/**
 * Map the dossier's pixel-grounded observations into the draft shape the
 * judgment prompt and the persisted products carry. The basis line IS the
 * provenance the operator later reads: which model saw which capture, and how
 * current the capture is known to be. Refusal/idle chatter is screened even
 * here — a grounded lane can still have persisted a bad row under an older
 * filter, and it must not resurface as evidence.
 */
export function groundedObservationDrafts(dossier: AcquisitionDossier): VisualObservationDraft[] {
  return dossier.visualObservations
    .filter((observation) => !readsAsNonObservation(observation.observation))
    .map((observation) => ({
      visual: observation.key,
      observation: observation.observation,
      basis: [
        `Pixel-grounded ${observation.model ?? 'vision-model'} read of ${observation.sourceImage ?? 'a retained capture'}`,
        observation.confidence ? `${observation.confidence} confidence` : null,
        observation.capturedAt ? `captured ${observation.capturedAt}` : 'capture date unknown',
      ].filter(Boolean).join(', '),
    }));
}

/** The installed Hermes runtime paths, shared by every LandOS one-shot caller
 *  (the analyst here and the specialist executor). Throws when absent. */
export function hermesRuntimePaths(): { python: string; launcher: string } {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const root = path.join(localAppData, 'hermes', 'hermes-agent');
  const python = process.platform === 'win32'
    ? path.join(root, 'venv', 'Scripts', 'python.exe')
    : path.join(root, 'venv', 'bin', 'python');
  const launcher = path.join(root, 'hermes');
  if (!fs.existsSync(python) || !fs.existsSync(launcher)) {
    throw new Error(`The Hermes runtime was not found under ${root}.`);
  }
  return { python, launcher };
}

/** Where a Hermes profile's local state lives. */
export function hermesProfileHome(profile: string): string {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'hermes', 'profiles', profile);
}

/** Is this profile provisioned on this machine? */
export function hermesProfileProvisioned(profile: string): boolean {
  return fs.existsSync(path.join(hermesProfileHome(profile), 'config.yaml'));
}

function installedHermes(): { python: string; launcher: string; profileHome: string } {
  const { python, launcher } = hermesRuntimePaths();
  const profileHome = hermesProfileHome(ACQUISITION_ANALYST_PROFILE);
  if (!fs.existsSync(path.join(profileHome, 'config.yaml'))) {
    throw new Error(`The Hermes Acquisition Analyst profile is not provisioned. Run: npm run landos:hermes:analyst`);
  }
  return { python, launcher, profileHome };
}

/**
 * Spawn the installed Hermes CLI once with the given argv and return stdout.
 *
 * The judgment prompt carries the whole property file, and Windows caps a
 * child's command line at ~32K characters — a full dossier as an argv element
 * fails with spawn ENAMETOOLONG before the runtime ever starts (surfacing as
 * "exited without output"). So the real argv travels in a temp JSON file, and
 * a tiny bootstrap sets sys.argv IN the child process, where no such ceiling
 * exists, then runs the launcher unchanged.
 */
export async function invokeHermesCli(args: string[], timeoutMs: number, signal?: AbortSignal): Promise<string> {
  const { python, launcher } = hermesRuntimePaths();
  const specPath = path.join(os.tmpdir(), `landos-analyst-args-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
  fs.writeFileSync(specPath, JSON.stringify(args), 'utf-8');
  const bootstrap = [
    'import sys, json, runpy',
    "spec = json.load(open(sys.argv[1], encoding='utf-8'))",
    'launcher = sys.argv[2]',
    'sys.argv = [launcher] + spec',
    "runpy.run_path(launcher, run_name='__main__')",
  ].join('\n');
  try {
    const { stdout } = await execFileAsync(python, ['-X', 'utf8', '-c', bootstrap, specPath, launcher], {
      cwd: process.cwd(),
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      ...(signal ? { signal } : {}),
    });
    return stdout ?? '';
  } catch (error) {
    // The default message is the whole command line, which tells an operator
    // nothing about WHY. The runtime's own first line of stderr does, so that
    // is what travels into the warning.
    if (signal?.aborted) {
      throw new Error('the specialist turn was cancelled');
    }
    const detail = error as { killed?: boolean; signal?: string | null; stderr?: string; stdout?: string };
    if (detail?.killed || detail?.signal === 'SIGTERM') {
      throw new Error(`the analyst exceeded its ${Math.round(timeoutMs / 1_000)}s limit`);
    }
    const reported = String(detail?.stderr || detail?.stdout || '').trim().split(/[\r\n]+/).find((line) => line.trim());
    throw new Error(reported?.slice(0, 300) || 'the local reasoning runtime exited without output');
  } finally {
    try { fs.unlinkSync(specPath); } catch { /* temp spec cleanup is best-effort */ }
  }
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
  const judgmentTimeoutMs = deps.judgmentTimeoutMs ?? ANALYST_JUDGMENT_TIMEOUT_MS;
  const now = deps.now ?? (() => Date.now());

  const invoke = deps.invoke ?? (async (args: string[], timeoutMs: number): Promise<string> => {
    installedHermes();
    return invokeHermesCli(args, timeoutMs);
  });

  return {
    async run(input: AnalystRunInput): Promise<AnalystRunOutput> {
      const startedAt = now();
      const model = resolveAnalystModel(
        { provider: input.requestedProvider, model: input.requestedModel },
        deps.settings ?? realSettings,
      );
      const warnings: string[] = [];

      // Visual evidence comes ONLY from the dossier's pixel-grounded
      // observations. This runtime has no proven way to show the model an
      // image, so it never pretends to; if no grounded observation exists,
      // the judgment pass is told so explicitly.
      const observations = groundedObservationDrafts(input.dossier);
      if (!observations.length && input.dossier.visuals.length > 0) {
        warnings.push('Retained imagery exists but no pixel-grounded visual observation has been produced for it yet; the read reasons without visual evidence.');
      }

      // The judgment.
      const raw = await invoke(
        analystInvocationArgs({
          prompt: (input.judgmentPromptBuilder ?? judgmentPrompt)(input.dossier, observations),
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
