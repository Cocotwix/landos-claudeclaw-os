// LandOS — the persistent Hermes specialist executor.
//
// Slice 6: the four intelligence products keep their contracts, persistence
// and surfaces exactly as they are; what changes is the reasoning EXECUTOR
// underneath them. Each layer is produced by its own persistent Hermes
// profile:
//
//   PROPERTY  → landos-property
//   MARKET    → landos-market
//   SELLER    → landos-seller       (only when seller evidence is established;
//                                    pre-contact stays deterministic and free)
//   DEAL      → landos-deal-brain   (the chair — runs AFTER the specialists,
//                                    synthesizing their fresh products)
//
// TRANSPORT. Every invocation is the proven profile-scoped Hermes CLI
// one-shot (`--profile <bot> … --oneshot <prompt>`), spawned through the same
// argv-file bootstrap the production analyst already uses. One-shot is the
// anti-contamination mechanism, not a compromise: the persistent identity
// (SOUL, mandate, cognitive memory) lives in the profile and is loaded every
// run, while the session itself is ephemeral — no cross-deal Bot Chat thread
// exists for one deal's facts to leak into another's. The canonical Bot Chats
// remain for the future War Room. The Hermes API server can replace this
// transport behind the same adapter later without touching intelligence
// business logic; no API_SERVER_KEY is required for this path.
//
// AUTHORITY. LandOS stays authoritative: the specialists receive a bounded
// dossier view plus an explicit CURRENT DEAL CONTEXT envelope stating that
// profile memory may guide HOW they reason and may never override current
// LandOS facts. Their output only becomes LandOS data through the existing
// schema parse and validators; malformed output fails the run and the last
// good persisted product is retained. The `clarify`-only toolset means a
// specialist structurally cannot research, browse, run commands, write files,
// or mutate canonical evidence — it reasons; LandOS acts, through the
// existing bounded capability-reconciliation seam only.

import fs from 'node:fs';
import path from 'node:path';

import {
  ANALYST_TOOLSETS,
  ANALYST_JUDGMENT_TIMEOUT_MS,
  createHermesAcquisitionAnalyst,
  groundedObservationDrafts,
  hermesProfileProvisioned,
  hermesRuntimePaths,
  invokeHermesCli,
  judgmentPrompt,
  resolveAnalystModel,
  type AcquisitionAnalyst,
  type AnalystModelSelection,
  type AnalystRunInput,
  type AnalystRunOutput,
  type HermesAnalystDeps,
  type SettingsReader,
  type SpecialistModelLayer,
} from './acquisition-analyst.js';
import { extractJsonObject, type AcquisitionIntelligenceRuntime } from './acquisition-intelligence-contract.js';
import { getDashboardSetting, setDashboardSetting } from '../db.js';

export const SPECIALIST_ENGINE = 'hermes';
export const SPECIALIST_TRANSPORT = 'hermes-cli-oneshot';

/** Layer → persistent Hermes profile. Slice 7 maps the same identities onto
 *  War Room seats — no duplicate personas. */
export const SPECIALIST_PROFILES = {
  property: 'landos-property',
  market: 'landos-market',
  seller: 'landos-seller',
  deal: 'landos-deal-brain',
} as const satisfies Record<SpecialistModelLayer, string>;

// ── Executor selection: the governed rollback boundary ────────────────────

/** Same `dashboard_settings` KV the analyst model override uses: rolling back
 *  to the pre-Hermes-specialist executor is a setting, never a source edit. */
export const INTELLIGENCE_EXECUTOR_KEY = 'landos.acquisition_intelligence.executor';

export type IntelligenceExecutorChoice = 'specialists' | 'analyst';

const realSettings: SettingsReader = {
  getDashboardSetting: (key) => { try { return getDashboardSetting(key); } catch { return null; } },
  setDashboardSetting: (key, value) => { try { setDashboardSetting(key, value); } catch { /* absent DB degrades to default */ } },
};

export function resolveIntelligenceExecutor(settings: SettingsReader = realSettings): IntelligenceExecutorChoice {
  const value = (settings.getDashboardSetting(INTELLIGENCE_EXECUTOR_KEY) ?? '').trim().toLowerCase();
  return value === 'analyst' ? 'analyst' : 'specialists';
}

export function setIntelligenceExecutor(choice: IntelligenceExecutorChoice, settings: SettingsReader = realSettings): void {
  settings.setDashboardSetting(INTELLIGENCE_EXECUTOR_KEY, choice);
}

/** The production executor factory: the persistent specialists by default,
 *  the legacy single-profile analyst as the governed rollback path. */
export function createIntelligenceExecutor(deps: HermesAnalystDeps = {}): AcquisitionAnalyst {
  return resolveIntelligenceExecutor(deps.settings ?? realSettings) === 'analyst'
    ? createHermesAcquisitionAnalyst(deps)
    : createSpecialistIntelligenceExecutor(deps);
}

// ── Provenance ────────────────────────────────────────────────────────────

let cachedRuntimeVersion: string | null | undefined;

/** The pinned Hermes runtime version from the governance audit — read once,
 *  best-effort. Provenance, never a gate. */
export function pinnedHermesRuntimeVersion(): string | null {
  if (cachedRuntimeVersion !== undefined) return cachedRuntimeVersion;
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'config', 'hermes', 'governance', 'approved-capabilities.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { runtimeAudit?: { hermesVersion?: unknown } };
    const version = parsed?.runtimeAudit?.hermesVersion;
    cachedRuntimeVersion = typeof version === 'string' && version.trim() ? version.trim() : null;
  } catch {
    cachedRuntimeVersion = null;
  }
  return cachedRuntimeVersion;
}

// ── Invocation ────────────────────────────────────────────────────────────

/**
 * One-shot argv for one specialist. No `--skills` (the profiles are
 * provisioned `--no-skills`), `clarify` toolset only, and the same
 * provider/model override mechanism the analyst uses: swapping the reasoning
 * model never touches the profile's identity or memory.
 */
export function specialistInvocationArgs(input: {
  profile: string;
  prompt: string;
  model: AnalystModelSelection;
  toolsets?: string;
}): string[] {
  return [
    '--profile', input.profile,
    '--provider', input.model.provider,
    '-m', input.model.model,
    '-t', input.toolsets ?? ANALYST_TOOLSETS,
    '--oneshot', input.prompt,
  ];
}

function assertSpecialistProvisioned(profile: string): void {
  if (!hermesProfileProvisioned(profile)) {
    throw new Error(`The Hermes specialist profile ${profile} is not provisioned. Run: npm run landos:hermes:specialists`);
  }
}

const layerRecord = (value: Record<string, unknown> | null, layer: SpecialistModelLayer): Record<string, unknown> | null => {
  if (!value) return null;
  const keyed = value[layer];
  if (keyed && typeof keyed === 'object' && !Array.isArray(keyed)) return keyed as Record<string, unknown>;
  // Tolerate a specialist returning its layer object bare (without the
  // wrapping key) — the fields identify it well enough to accept.
  if (value[layer] === undefined && (typeof value.read === 'string' || typeof value.deal_read === 'object' || typeof value.score === 'number')) {
    return value;
  }
  return null;
};

/**
 * The LandOS-owned specialist transport adapter + executor.
 *
 * Implements the same `AcquisitionAnalyst` seam as the legacy analyst, so the
 * Intelligence Stack, its contracts, persistence and every surface stay
 * byte-identical. Given a `specialistPlan`, the non-deal layers run in
 * PARALLEL on their own profiles; the Deal Brain chair runs after them over
 * their fresh products. Without a plan (the Deal Brain conversation), the
 * single prompt runs on `landos-deal-brain`.
 */
export function createSpecialistIntelligenceExecutor(deps: HermesAnalystDeps = {}): AcquisitionAnalyst {
  const timeoutMs = deps.judgmentTimeoutMs ?? ANALYST_JUDGMENT_TIMEOUT_MS;
  const now = deps.now ?? (() => Date.now());
  const invoke = deps.invoke ?? (async (args: string[], invokeTimeoutMs: number): Promise<string> => {
    hermesRuntimePaths();
    const profile = args[args.indexOf('--profile') + 1];
    if (profile) assertSpecialistProvisioned(profile);
    return invokeHermesCli(args, invokeTimeoutMs);
  });

  const runtimeFor = (profile: string, model: AnalystModelSelection, durationMs: number): AcquisitionIntelligenceRuntime => ({
    engine: SPECIALIST_ENGINE,
    agentProfile: profile,
    provider: model.provider,
    model: model.model,
    modelSource: model.source,
    durationMs: Math.max(0, durationMs),
    transport: SPECIALIST_TRANSPORT,
    ...(pinnedHermesRuntimeVersion() ? { runtimeVersion: pinnedHermesRuntimeVersion() as string } : {}),
  });

  return {
    async run(input: AnalystRunInput): Promise<AnalystRunOutput> {
      const startedAt = now();
      const model = resolveAnalystModel(
        { provider: input.requestedProvider, model: input.requestedModel },
        deps.settings ?? realSettings,
      );
      const warnings: string[] = [];
      const observations = groundedObservationDrafts(input.dossier);
      if (!observations.length && input.dossier.visuals.length > 0) {
        warnings.push('Retained imagery exists but no pixel-grounded visual observation has been produced for it yet; the read reasons without visual evidence.');
      }

      const plan = input.specialistPlan;
      if (!plan) {
        // The single-question path (the Deal Brain conversation): the chair
        // answers over the prompt the caller built.
        const t0 = now();
        const raw = await invoke(
          specialistInvocationArgs({
            profile: SPECIALIST_PROFILES.deal,
            prompt: (input.judgmentPromptBuilder ?? judgmentPrompt)(input.dossier, observations),
            model,
          }),
          timeoutMs,
        );
        return { raw, observations, warnings, runtime: runtimeFor(SPECIALIST_PROFILES.deal, model, now() - t0) };
      }

      const layerRuntimes: Partial<Record<SpecialistModelLayer, AcquisitionIntelligenceRuntime>> = {};
      const merged: Record<string, unknown> = {};

      // The independent specialists run in parallel — a serial agent parade
      // would triple the wall clock for nothing.
      const runStructuredLayer = async (layer: Exclude<SpecialistModelLayer, 'deal'>) => {
        const profile = SPECIALIST_PROFILES[layer];
        const t0 = now();
        const raw = await invoke(
          specialistInvocationArgs({ profile, prompt: plan.layerPrompt(layer, input.dossier, observations), model }),
          timeoutMs,
        );
        const value = layerRecord(extractJsonObject(raw), layer);
        if (!value) throw new Error(`${profile} returned no parsable ${layer} layer`);
        return { layer, value, runtime: runtimeFor(profile, model, now() - t0) };
      };

      // Property Stage A/B mirrors the accepted Market pattern: a free expert
      // review first (natural prose, preserved verbatim), then a separate
      // structured extraction over that exact review. Property never gets the
      // search toolset — its SOUL forbids research; it reasons over the
      // assembled file and grounded observations and NAMES bounded
      // verifications instead of attempting them.
      const runTwoStageProperty = async () => {
        const profile = SPECIALIST_PROFILES.property;
        const t0 = now();
        const review = await invoke(
          specialistInvocationArgs({
            profile,
            prompt: plan.propertyReviewPrompt!(input.dossier, observations),
            model,
            toolsets: ANALYST_TOOLSETS,
          }),
          timeoutMs,
        );
        if (!review.trim() || review.trim().length < 200) {
          throw new Error(`${profile} returned no substantive free expert review`);
        }
        const raw = await invoke(
          specialistInvocationArgs({
            profile,
            prompt: plan.propertyExtractionPrompt!(review, input.dossier, observations),
            model,
            toolsets: ANALYST_TOOLSETS,
          }),
          timeoutMs,
        );
        const value = layerRecord(extractJsonObject(raw), 'property');
        if (!value) throw new Error(`${profile} returned no parsable property extraction`);
        return {
          layer: 'property' as const,
          value: { ...value, expertReview: review },
          review,
          runtime: runtimeFor(profile, model, now() - t0),
        };
      };

      // Property and Seller may begin together. Market is sequenced after the
      // completed Property product because it evaluates Property's plausible
      // product configurations instead of guessing them from acreage bands.
      const propertyTask = plan.layers.includes('property')
        ? (plan.propertyReviewPrompt && plan.propertyExtractionPrompt
          ? runTwoStageProperty()
          : runStructuredLayer('property'))
        : null;
      const sellerTask = plan.layers.includes('seller')
        ? runStructuredLayer('seller').then(
          (result) => ({ ok: true as const, result }),
          (error: unknown) => ({ ok: false as const, error }),
        )
        : null;
      let marketExpertReview: string | undefined;
      let propertyExpertReview: string | undefined;

      if (propertyTask) {
        const result = await propertyTask;
        merged.property = result.value;
        layerRuntimes.property = result.runtime;
        if ('review' in result) propertyExpertReview = result.review;
      }

      if (plan.layers.includes('market')) {
        const profile = SPECIALIST_PROFILES.market;
        const marketStartedAt = now();
        if (plan.marketReviewPrompt && plan.marketExtractionPrompt) {
          const review = await invoke(
            specialistInvocationArgs({
              profile,
              prompt: plan.marketReviewPrompt(merged.property, input.dossier, observations),
              model,
              toolsets: 'search',
            }),
            timeoutMs,
          );
          if (!review.trim() || review.trim().length < 200) {
            throw new Error(`${profile} returned no substantive free expert review`);
          }
          if (!/\nSOURCE LEDGER\s*\n/i.test(review)) {
            throw new Error(`${profile} returned no SOURCE LEDGER for the free expert review`);
          }
          marketExpertReview = review;
          const raw = await invoke(
            specialistInvocationArgs({
              profile,
              prompt: plan.marketExtractionPrompt(merged.property, review, input.dossier, observations),
              model,
              toolsets: ANALYST_TOOLSETS,
            }),
            timeoutMs,
          );
          const value = layerRecord(extractJsonObject(raw), 'market');
          if (!value) throw new Error(`${profile} returned no parsable market extraction`);
          merged.market = { ...value, expertReview: review };
          layerRuntimes.market = runtimeFor(profile, model, now() - marketStartedAt);
        } else {
          const result = await runStructuredLayer('market');
          merged.market = result.value;
          layerRuntimes.market = result.runtime;
        }
      }

      if (sellerTask) {
        const outcome = await sellerTask;
        if (!outcome.ok) throw outcome.error;
        merged.seller = outcome.result.value;
        layerRuntimes.seller = outcome.result.runtime;
      }

      if (plan.layers.includes('deal')) {
        // The chair runs AFTER the specialists so it synthesizes their fresh
        // products, not a guess at them.
        const profile = SPECIALIST_PROFILES.deal;
        const t0 = now();
        const freshLayers = {
          ...(merged.property !== undefined ? { property: merged.property } : {}),
          ...(merged.market !== undefined ? { market: merged.market } : {}),
          ...(merged.seller !== undefined ? { seller: merged.seller } : {}),
        };
        const raw = await invoke(
          specialistInvocationArgs({ profile, prompt: plan.dealPrompt(freshLayers, input.dossier, observations), model }),
          timeoutMs,
        );
        const value = layerRecord(extractJsonObject(raw), 'deal');
        if (!value) throw new Error(`${profile} returned no parsable deal layer`);
        merged.deal = value;
        layerRuntimes.deal = runtimeFor(profile, model, now() - t0);
      }

      const primary = layerRuntimes.deal
        ?? layerRuntimes.property ?? layerRuntimes.market ?? layerRuntimes.seller
        ?? runtimeFor(SPECIALIST_PROFILES.deal, model, 0);
      return {
        raw: JSON.stringify(merged),
        observations,
        warnings,
        runtime: { ...primary, durationMs: Math.max(0, now() - startedAt) },
        layerRuntimes,
        ...(marketExpertReview !== undefined ? { marketExpertReview } : {}),
        ...(propertyExpertReview !== undefined ? { propertyExpertReview } : {}),
      };
    },
  };
}

/**
 * What the NEXT intelligence run would use, without running anything —
 * executor-aware. The specialist executor's headline profile is the Deal
 * Brain chair (every produced read ends with it); each persisted product
 * carries its own layer profile.
 */
export function intelligenceExecutorRuntimeStatus(settings: SettingsReader = realSettings): {
  engine: string;
  agentProfile: string;
  provider: string;
  model: string;
  modelSource: AnalystModelSelection['source'];
  provisioned: boolean;
  executor: IntelligenceExecutorChoice;
} {
  const executor = resolveIntelligenceExecutor(settings);
  const selection = resolveAnalystModel(undefined, settings);
  if (executor === 'analyst') {
    let provisioned = false;
    try {
      hermesRuntimePaths();
      provisioned = hermesProfileProvisioned('landos-acquisition-analyst');
    } catch { provisioned = false; }
    return {
      engine: SPECIALIST_ENGINE,
      agentProfile: 'landos-acquisition-analyst',
      provider: selection.provider,
      model: selection.model,
      modelSource: selection.source,
      provisioned,
      executor,
    };
  }
  let provisioned = false;
  try {
    hermesRuntimePaths();
    provisioned = Object.values(SPECIALIST_PROFILES).every((profile) => hermesProfileProvisioned(profile));
  } catch { provisioned = false; }
  return {
    engine: SPECIALIST_ENGINE,
    agentProfile: SPECIALIST_PROFILES.deal,
    provider: selection.provider,
    model: selection.model,
    modelSource: selection.source,
    provisioned,
    executor,
  };
}
