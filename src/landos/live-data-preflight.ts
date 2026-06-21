// LandOS Live Data leg — Step 0: config + fail-loud preflight ONLY.
//
// This module DEFINES which env keys the live data paths read and a preflight
// that decides, PER CAPABILITY, whether a live provider may be registered —
// refusing it (and keeping the honest stub) when anything required is missing.
//
// It wires NO provider and makes NO external call itself. The default Gemma
// probe is a no-op during Step 0 (so importing/typechecking this module never
// touches the network); a later leg injects a real async probe. Nothing
// external runs until keys are present AND a later leg wires the providers.
//
// Capabilities:
//   - comps   : Apify per-source actors (Redfin/Zillow). Paid (pre-approved).
//   - imagery : the EXISTING allowlisted capture-visual.js (.gov/.us public
//               records only — NO Google). Local, no API key. Chromium install
//               stays behind a SEPARATE approval; missing -> honest-disable.
//   - gemma   : normalizer-only runtime. DEGRADES to deterministic-only mapping
//               if unreachable; it never blocks the leg.

import fs from 'fs';
import path from 'path';

import { readEnvFile } from '../env.js';

/** The env keys the live data paths read. (Definitions only — no .env edit.) */
export const LIVE_DATA_ENV_KEYS = {
  apifyToken: 'APIFY_TOKEN',
  // Two-stage tri_angle Redfin flow. BOTH are REQUIRED for comps to go live;
  // there is NO single-actor variant and NO default/fallback actor id. A missing
  // one fails the preflight loud and keeps the honest stub.
  apifyRedfinSearchActor: 'APIFY_REDFIN_SEARCH_ACTOR',
  apifyRedfinDetailActor: 'APIFY_REDFIN_DETAIL_ACTOR',
  liveComps: 'LANDOS_LIVE_COMPS',
  liveImagery: 'LANDOS_LIVE_IMAGERY',
  ollamaHost: 'OLLAMA_HOST',
  gemmaModel: 'GEMMA_NORMALIZER_MODEL',
} as const;

/** OLLAMA_HOST is optional; this is the default when unset. */
export const OLLAMA_HOST_DEFAULT = 'http://127.0.0.1:11434';
/** Default Gemma model id used by the normalizer when GEMMA_NORMALIZER_MODEL is unset. */
export const GEMMA_NORMALIZER_MODEL_DEFAULT = 'gemma-4-e4b';

/** The existing allowlisted capturer (NO Google; .gov/.us public records only). */
export const CAPTURE_VISUAL_SCRIPT_REL = 'landos-agents/duke-due-diligence/scripts/capture-visual.js';

type Env = Record<string, string | undefined>;

export interface ResolveLiveDataEnvDeps {
  /** Process environment to consult (genuinely-exported values win). */
  processEnv?: Env;
  /** Injected .env reader (tests pass a fake; default is the approved readEnvFile). */
  readEnv?: (keys: string[]) => Record<string, string>;
  /** Force-skip the .env file read (hermetic tests). Defaults to the
   *  LANDOS_DISABLE_DOTENV_FALLBACK flag — same guard the LandPortal client uses. */
  disableDotenvFallback?: boolean;
}

/**
 * Resolve the live-data env from the project's APPROVED config source.
 *
 * Precedence: a genuinely-exported, non-empty process.env value wins; otherwise
 * the value comes from the .env file via readEnvFile(). This mirrors how every
 * other secret in the codebase is read and PRESERVES the security design — it
 * returns a fresh in-memory object and NEVER writes to process.env, so secrets
 * are not exported to spawned child agents. Hermetic tests
 * (LANDOS_DISABLE_DOTENV_FALLBACK) skip the .env read entirely so a developer's
 * real secrets can neither satisfy nor leak into a test.
 */
export function resolveLiveDataEnv(deps: ResolveLiveDataEnvDeps = {}): Env {
  const keys = Object.values(LIVE_DATA_ENV_KEYS) as string[];
  const processEnv: Env = deps.processEnv ?? process.env;
  const disable = deps.disableDotenvFallback ?? !!processEnv.LANDOS_DISABLE_DOTENV_FALLBACK;
  const fromFile = disable ? {} : (deps.readEnv ?? readEnvFile)(keys);

  const merged: Env = { ...fromFile };
  for (const key of keys) {
    const exported = processEnv[key];
    if (typeof exported === 'string' && exported.trim().length > 0) merged[key] = exported;
  }
  return merged;
}

function flagOn(v: string | undefined): boolean {
  return v === '1' || v === 'true' || v === 'yes';
}
function present(v: string | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

export interface CapabilityReadiness {
  capability: 'comps' | 'imagery';
  ready: boolean;
  /** Exact missing items (env keys / preconditions). Empty when ready. */
  missing: string[];
  /** Loud, honest reason — names exactly what is missing. */
  reason: string;
  /** True whenever the live path is NOT registered -> the honest stub stays. */
  usesStub: boolean;
}

export type GemmaNormalizerMode = 'gemma_normalize' | 'deterministic_only';

export interface GemmaReadiness {
  reachable: boolean;
  modelPresent: boolean;
  model: string;
  host: string;
  /** Normalizer mode. 'deterministic_only' never fabricates and never blocks. */
  mode: GemmaNormalizerMode;
  reason: string;
}

export interface LiveDataPreflight {
  comps: CapabilityReadiness;
  imagery: CapabilityReadiness;
  gemma: GemmaReadiness;
  /** True only when every gated live path that is enabled is also fully ready. */
  allEnabledReady: boolean;
}

export interface PreflightDeps {
  env?: Env;
  /** Whether the allowlisted capture-visual.js script exists. */
  captureScriptExists?: () => boolean;
  /** Whether a Playwright Chromium binary is installed. NEVER installs anything. */
  chromiumInstalled?: () => boolean;
  /** Probe the Gemma normalizer runtime. Injected in tests; the default is a
   *  no-op during Step 0 (no external call) reporting not-reachable. */
  probeGemma?: (host: string, model: string) => Promise<{ reachable: boolean; modelPresent: boolean }>;
}

function defaultCaptureScriptExists(): boolean {
  try {
    return fs.existsSync(path.resolve(process.cwd(), CAPTURE_VISUAL_SCRIPT_REL));
  } catch {
    return false;
  }
}

/** Best-effort, fs-only detection of an installed Playwright Chromium binary.
 *  NEVER installs anything; on any doubt returns false (honest-disable). */
function defaultChromiumInstalled(): boolean {
  try {
    const configured = process.env.PLAYWRIGHT_BROWSERS_PATH;
    const root = configured && configured !== '0'
      ? configured
      : path.join(
          process.env.LOCALAPPDATA || process.env.HOME || process.cwd(),
          process.platform === 'win32' ? 'ms-playwright' : '.cache/ms-playwright',
        );
    if (!fs.existsSync(root)) return false;
    return fs.readdirSync(root).some((d) => d.startsWith('chromium'));
  } catch {
    return false;
  }
}

/** Default Gemma probe: a NO-OP during Step 0 (no external call). Reports
 *  not-reachable so normalization honestly degrades until the normalizer leg
 *  injects a real async probe. */
async function defaultProbeGemma(): Promise<{ reachable: boolean; modelPresent: boolean }> {
  return { reachable: false, modelPresent: false };
}

/**
 * Fail-loud live-data preflight. Pure over its injected facts; makes no external
 * call of its own (the Gemma probe is injected). Returns per-capability
 * readiness with the EXACT missing item(s). A capability that is not ready keeps
 * its honest stub (usesStub=true) — the live provider must NOT be registered.
 * Gemma never blocks: it degrades to deterministic-only mapping when unreachable.
 */
export async function preflightLiveData(deps: PreflightDeps = {}): Promise<LiveDataPreflight> {
  const env = deps.env ?? process.env;
  const captureScriptExists = (deps.captureScriptExists ?? defaultCaptureScriptExists)();
  const chromiumInstalled = (deps.chromiumInstalled ?? defaultChromiumInstalled)();
  const probeGemma = deps.probeGemma ?? defaultProbeGemma;

  // ── Comps (Apify per-source actors; paid, pre-approved) ────────────────────
  const compsMissing: string[] = [];
  if (!flagOn(env[LIVE_DATA_ENV_KEYS.liveComps])) compsMissing.push(`${LIVE_DATA_ENV_KEYS.liveComps} (set to 1 to enable)`);
  if (!present(env[LIVE_DATA_ENV_KEYS.apifyToken])) compsMissing.push(LIVE_DATA_ENV_KEYS.apifyToken);
  if (!present(env[LIVE_DATA_ENV_KEYS.apifyRedfinSearchActor])) compsMissing.push(LIVE_DATA_ENV_KEYS.apifyRedfinSearchActor);
  if (!present(env[LIVE_DATA_ENV_KEYS.apifyRedfinDetailActor])) compsMissing.push(LIVE_DATA_ENV_KEYS.apifyRedfinDetailActor);
  const compsReady = compsMissing.length === 0;
  const comps: CapabilityReadiness = {
    capability: 'comps',
    ready: compsReady,
    missing: compsMissing,
    reason: compsReady
      ? 'Live comp retrieval ready (Apify tri_angle redfin-search + redfin-detail actors configured).'
      : `comp retrieval DISABLED: missing ${compsMissing.join(', ')}. Honest stub stays connected ("comp provider not yet connected").`,
    usesStub: !compsReady,
  };

  // ── Imagery (allowlisted capture-visual.js; NO Google; local, no key) ──────
  const imageryMissing: string[] = [];
  if (!flagOn(env[LIVE_DATA_ENV_KEYS.liveImagery])) imageryMissing.push(`${LIVE_DATA_ENV_KEYS.liveImagery} (set to 1 to enable)`);
  if (!captureScriptExists) imageryMissing.push(`${CAPTURE_VISUAL_SCRIPT_REL} (allowlisted capturer not found)`);
  if (!chromiumInstalled) imageryMissing.push('Chromium browser binary (run: npx playwright install chromium — SEPARATE approval required)');
  const imageryReady = imageryMissing.length === 0;
  const imagery: CapabilityReadiness = {
    capability: 'imagery',
    ready: imageryReady,
    missing: imageryMissing,
    reason: imageryReady
      ? 'Live imagery ready (allowlisted .gov/.us capture-visual.js + Chromium). Supporting context only — never identity.'
      : `imagery DISABLED: missing ${imageryMissing.join(', ')}. Honest stub stays ("visual not captured yet").`,
    usesStub: !imageryReady,
  };

  // ── Gemma normalizer (degrades to deterministic-only; never blocks) ────────
  const host = present(env[LIVE_DATA_ENV_KEYS.ollamaHost]) ? (env[LIVE_DATA_ENV_KEYS.ollamaHost] as string) : OLLAMA_HOST_DEFAULT;
  const model = present(env[LIVE_DATA_ENV_KEYS.gemmaModel]) ? (env[LIVE_DATA_ENV_KEYS.gemmaModel] as string) : GEMMA_NORMALIZER_MODEL_DEFAULT;
  let probe = { reachable: false, modelPresent: false };
  try {
    probe = await probeGemma(host, model);
  } catch {
    probe = { reachable: false, modelPresent: false };
  }
  const gemmaOk = probe.reachable && probe.modelPresent;
  const gemma: GemmaReadiness = {
    reachable: probe.reachable,
    modelPresent: probe.modelPresent,
    model,
    host,
    mode: gemmaOk ? 'gemma_normalize' : 'deterministic_only',
    reason: gemmaOk
      ? `Gemma normalizer reachable at ${host} (model ${model}).`
      : !probe.reachable
        ? `Gemma normalizer unreachable at ${host}; deterministic-only mapping (no fabrication). Normalization never blocks the leg.`
        : `Gemma model "${model}" not present at ${host}; deterministic-only mapping. Normalization never blocks the leg.`,
  };

  // Only the ENABLED live paths count toward readiness; a disabled capability is
  // intentionally on its stub and does not make the leg "not ready".
  const compsEnabled = flagOn(env[LIVE_DATA_ENV_KEYS.liveComps]);
  const imageryEnabled = flagOn(env[LIVE_DATA_ENV_KEYS.liveImagery]);
  const allEnabledReady =
    (!compsEnabled || comps.ready) && (!imageryEnabled || imagery.ready);

  return { comps, imagery, gemma, allEnabledReady };
}
