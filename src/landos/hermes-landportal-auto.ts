// Automatic Hermes -> LandOS LandPortal lane.
//
// This is deliberately a thin controller around the proven Hermes one-shot
// runtime and importHermesLandPortalFile(). It does not own property facts,
// comps, or a second persistence model.

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { logger } from '../logger.js';
import {
  importHermesLandPortalFile,
  type HermesLandPortalCategoryImportResult,
  type HermesLandPortalImportResult,
  type HermesLandPortalResultCategory,
} from './hermes-landportal-import.js';

const execFileAsync = promisify(execFile);

export const HERMES_LANDPORTAL_CDP_ENDPOINT = 'http://127.0.0.1:9224';
export const HERMES_LANDPORTAL_PROFILE = 'landos';
export const HERMES_LANDPORTAL_CDP_SKILL = 'driving-cdp-browser';
export const HERMES_LANDPORTAL_CONTEXT_SKILL = 'landos-landportal';
// The authenticated LandPortal worker can need more than three minutes before
// its first verified snapshot on a cold/recovered browser session. Keep a
// bounded shutdown margin inside the existing five-minute hard ceiling so the
// incremental subject handback can land before the worker is interrupted.
export const HERMES_LANDPORTAL_TARGET_RUNTIME_MS = 280_000;
export const HERMES_LANDPORTAL_HARD_TIMEOUT_MS = 5 * 60_000;

export type HermesLandPortalLaneStatus = 'exact_match' | 'context_only' | 'no_match' | 'failed';

export interface HermesLandPortalLaneInput {
  runId: string;
  dealCardId: number;
  propertyCardId: number;
  address: string;
  apn: string | null;
  owner: string | null;
  county: string | null;
  state: string | null;
  landPortalPropertyId: string | null;
}

export interface HermesLandPortalLaneOutcome {
  status: HermesLandPortalLaneStatus;
  runId: string;
  dealCardId: number;
  propertyCardId: number;
  propertyLabel: string;
  outputFile: string;
  startedAt: string;
  completedAt: string;
  runtimeMs: number;
  note: string;
  importResult: HermesLandPortalImportResult | null;
  importResults: HermesLandPortalImportResult[];
  persistedCategories: HermesLandPortalCategoryImportResult[];
}

export interface HermesLandPortalLaneProgress {
  runId: string;
  dealCardId: number;
  propertyCardId: number;
  address: string;
  status: 'running' | HermesLandPortalLaneStatus;
  startedAt: string;
  completedAt: string | null;
  persistedCategories: HermesLandPortalCategoryImportResult[];
  note: string;
}

export interface HermesLandPortalAutoDeps {
  outputDirectory?: string;
  timeoutMs?: number;
  now?: () => string;
  clockMs?: () => number;
  monitorIntervalMs?: number;
  invokeHermes?: (prompt: string, outputDirectory: string, timeoutMs: number) => Promise<void>;
  importFile?: typeof importHermesLandPortalFile;
}

type HermesStatusPayload = {
  subject_verification_status?: unknown;
  subject_verification_note?: unknown;
};

const activeRuns = new Map<string, Promise<HermesLandPortalLaneOutcome>>();
const completedRuns = new Map<string, HermesLandPortalLaneOutcome>();
const laneProgress = new Map<number, HermesLandPortalLaneProgress>();

const cleanText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const cryptoHash = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

export function hermesLandPortalPropertyLabel(input: Pick<HermesLandPortalLaneInput, 'address' | 'propertyCardId'>): string {
  return `${input.address.trim()} [Property Card ${input.propertyCardId}]`;
}

function safeFilePart(value: string, fallback: string): string {
  const safe = value.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return safe || fallback;
}

export function hermesLandPortalOutputFile(
  input: HermesLandPortalLaneInput,
  outputDirectory = path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'hermes', 'profiles', HERMES_LANDPORTAL_PROFILE, 'shared', 'landportal',
  ),
): string {
  const address = safeFilePart(input.address, 'property');
  const run = safeFilePart(input.runId, 'run');
  return path.join(outputDirectory, `${address}__property-card-${input.propertyCardId}__${run}.json`);
}

export function hermesLandPortalPrompt(input: HermesLandPortalLaneInput, outputFile: string): string {
  const assignment = JSON.stringify({
    assignment: 'landportal_subject_lookup',
    address: input.address,
    apn: input.apn,
    owner: input.owner,
    county: input.county,
    state: input.state,
    property_card_id: input.propertyCardId,
    canonical_property_identifier: input.landPortalPropertyId,
    output_file: outputFile,
    visual_artifact_directory: path.dirname(outputFile),
    requested_visuals: ['parcel_context'],
    handback_mode: 'progressive_snapshot',
    progressive_categories: ['subject', 'comps', 'visuals'],
    visual_artifact_fields: ['key', 'label', 'kind', 'purpose', 'source_path', 'timestamp', 'requested_view', 'active_view', 'boundary_required', 'boundary_visible', 'tiles_loaded', 'camera_scale', 'clipped', 'obstructions'],
  }, null, 2);
  return `Complete the current LandOS LandPortal assignment using the persistent profile context and the preloaded ${HERMES_LANDPORTAL_CONTEXT_SKILL} and ${HERMES_LANDPORTAL_CDP_SKILL} skills.

CURRENT ASSIGNMENT
${assignment}

Follow the progressive handback contract in the LandOS project context: persist the verified subject snapshot to output_file immediately after exact-subject verification, then rewrite that same property-specific snapshot after each later completed category. Visual source_path values must stay beneath visual_artifact_directory. Stop after the final rewrite.`;
}

export function hermesLandPortalInvocationArgs(prompt: string): string[] {
  return [
    '--profile', HERMES_LANDPORTAL_PROFILE,
    '--skills', `${HERMES_LANDPORTAL_CDP_SKILL},${HERMES_LANDPORTAL_CONTEXT_SKILL}`,
    '--oneshot', prompt,
  ];
}

async function invokeInstalledHermes(prompt: string, _outputDirectory: string, timeoutMs: number): Promise<void> {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const root = path.join(localAppData, 'hermes', 'hermes-agent');
  const python = path.join(root, 'venv', 'Scripts', 'python.exe');
  const launcher = path.join(root, 'hermes');
  if (!fs.existsSync(python) || !fs.existsSync(launcher)) {
    throw new Error(`Hermes runtime was not found under ${root}.`);
  }
  const profileHome = path.join(localAppData, 'hermes', 'profiles', HERMES_LANDPORTAL_PROFILE);
  if (!fs.existsSync(path.join(profileHome, 'config.yaml'))) {
    throw new Error(`Hermes profile "${HERMES_LANDPORTAL_PROFILE}" is not provisioned. Run npm run landos:hermes:profile.`);
  }
  await execFileAsync(python, [launcher, ...hermesLandPortalInvocationArgs(prompt)], {
    // Project context files are discovered from the launch directory. Keep the
    // process rooted in LandOS; outputDirectory is already carried as an
    // absolute, property-specific assignment path.
    cwd: process.cwd(),
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
}

function classifyPayload(filePath: string): { status: Exclude<HermesLandPortalLaneStatus, 'failed'> | 'failed'; note: string } {
  let parsed: HermesStatusPayload;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as HermesStatusPayload;
  } catch (error) {
    return { status: 'failed', note: `Hermes did not write valid JSON: ${(error as Error).message}` };
  }
  const rawStatus = cleanText(parsed.subject_verification_status);
  const note = cleanText(parsed.subject_verification_note) || `Hermes returned ${rawStatus || 'no status'}.`;
  if (rawStatus === 'verified_exact_subject') return { status: 'exact_match', note };
  if (rawStatus === 'context_only') return { status: 'context_only', note };
  if (rawStatus === 'no_match') return { status: 'no_match', note };
  return { status: 'failed', note: rawStatus === 'failed' ? note : `Unsupported Hermes subject status "${rawStatus || 'missing'}".` };
}

function laneKey(input: HermesLandPortalLaneInput): string {
  return `${input.runId}:${input.propertyCardId}`;
}

function executionFailureNote(error: unknown, timeoutMs: number): string {
  const details = error as { killed?: boolean; signal?: string | null; message?: string };
  if (details?.killed || details?.signal === 'SIGTERM') {
    return `Hermes LandPortal execution exceeded the ${timeoutMs} ms lane limit.`;
  }
  const firstLine = cleanText(details?.message ?? String(error)).split(/\r?\n/, 1)[0]?.slice(0, 300);
  return `Hermes LandPortal execution failed: ${firstLine || 'Unknown execution error.'}`;
}

async function executeLane(input: HermesLandPortalLaneInput, deps: HermesLandPortalAutoDeps): Promise<HermesLandPortalLaneOutcome> {
  const now = deps.now ?? (() => new Date().toISOString());
  const clockMs = deps.clockMs ?? (() => Date.now());
  const startedAt = now();
  const startedMs = clockMs();
  const propertyLabel = hermesLandPortalPropertyLabel(input);
  const outputDirectory = path.resolve(deps.outputDirectory ?? path.dirname(hermesLandPortalOutputFile(input)));
  const outputFile = hermesLandPortalOutputFile(input, outputDirectory);
  // The approved SOP allows only three bounded searches. No caller may extend
  // this lane beyond its five-minute hard ceiling; sibling lanes remain
  // independent and continue on their own schedules.
  const timeoutMs = Math.min(HERMES_LANDPORTAL_HARD_TIMEOUT_MS, Math.max(1, deps.timeoutMs ?? HERMES_LANDPORTAL_TARGET_RUNTIME_MS));
  const importResults: HermesLandPortalImportResult[] = [];
  const categoryResults = new Map<HermesLandPortalResultCategory, HermesLandPortalCategoryImportResult>();
  let lastImportResult: HermesLandPortalImportResult | null = null;
  let lastImportError: string | null = null;
  let lastArtifactHash = '';
  let monitor: ReturnType<typeof setInterval> | null = null;
  const publishProgress = (status: HermesLandPortalLaneProgress['status'], note: string, completedAt: string | null): void => {
    laneProgress.set(input.dealCardId, {
      runId: input.runId,
      dealCardId: input.dealCardId,
      propertyCardId: input.propertyCardId,
      address: input.address,
      status,
      startedAt,
      completedAt,
      persistedCategories: [...categoryResults.values()].filter((result) => !result.error),
      note,
    });
  };
  const consumeIncrementalArtifact = (): void => {
    if (!fs.existsSync(outputFile)) return;
    let raw: string;
    try { raw = fs.readFileSync(outputFile, 'utf8'); } catch { return; }
    const artifactHash = cryptoHash(raw);
    if (!raw.trim() || artifactHash === lastArtifactHash) return;
    const classified = classifyPayload(outputFile);
    if (classified.status !== 'exact_match') return;
    lastArtifactHash = artifactHash;
    try {
      const imported = (deps.importFile ?? importHermesLandPortalFile)(outputFile, { propertyCardId: input.propertyCardId });
      lastImportResult = imported;
      lastImportError = null;
      importResults.push(imported);
      for (const result of imported.categoryResults) {
        const held = categoryResults.get(result.category);
        if (!held || result.imported || held.error) categoryResults.set(result.category, result);
        if (result.imported && !result.error) {
          logger.info({ propertyLabel, runId: input.runId, category: result.category, persistedAt: result.persistedAt, itemCount: result.itemCount }, 'hermes_landportal_category_persisted');
        }
      }
      publishProgress('running', classified.note, null);
    } catch (error) {
      lastImportError = (error as Error).message;
    }
  };
  const finish = (status: HermesLandPortalLaneStatus, note: string, importResult: HermesLandPortalImportResult | null): HermesLandPortalLaneOutcome => ({
    ...(() => {
      const completedAt = now();
      publishProgress(status, note, completedAt);
      return {
        status,
        runId: input.runId,
        dealCardId: input.dealCardId,
        propertyCardId: input.propertyCardId,
        propertyLabel,
        outputFile,
        startedAt,
        completedAt,
        runtimeMs: Math.max(0, clockMs() - startedMs),
        note,
        importResult,
        importResults,
        persistedCategories: [...categoryResults.values()].filter((result) => !result.error),
      };
    })(),
  });

  try {
    fs.mkdirSync(outputDirectory, { recursive: true });
    // Never accept a stale artifact as this run's handback.
    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
    logger.info({ propertyLabel, runId: input.runId, outputFile }, 'hermes_landportal_lane_started');
    publishProgress('running', `Hermes LandPortal is collecting verified evidence for ${input.address}.`, null);
    monitor = setInterval(consumeIncrementalArtifact, Math.max(10, deps.monitorIntervalMs ?? 250));
    monitor.unref?.();
    await (deps.invokeHermes ?? invokeInstalledHermes)(hermesLandPortalPrompt(input, outputFile), outputDirectory, timeoutMs);
    consumeIncrementalArtifact();
    if (!fs.existsSync(outputFile)) {
      const note = 'Hermes completed without creating the required property-specific JSON file.';
      fs.writeFileSync(outputFile, JSON.stringify({
        subject_verification_status: 'failed',
        subject_verification_note: note,
        address: input.address,
        apn: input.apn,
        property_card_id: input.propertyCardId,
        canonical_property_identifier: input.landPortalPropertyId,
        captured_at: now(),
        comps: [],
      }, null, 2));
      return finish('failed', note, null);
    }
    const classified = classifyPayload(outputFile);
    if (classified.status !== 'exact_match') return finish(classified.status, classified.note, null);
    const finalImport = importResults.at(-1) ?? null;
    const categoryError = finalImport?.categoryResults.find((result) => !!result.error)?.error ?? lastImportError;
    if (categoryError) return finish('failed', `Hermes exact-match JSON was rejected by the canonical importer: ${categoryError}`, finalImport);
    if (!finalImport) return finish('failed', 'Hermes exact-match JSON did not produce an importable incremental result.', null);
    return finish('exact_match', classified.note, finalImport);
  } catch (error) {
    // Import the last stable exact-subject snapshot before recording the later
    // execution failure. Already-persisted categories remain canonical.
    consumeIncrementalArtifact();
    // execFile errors include the complete prompt in their default message.
    // Persist only a bounded operational reason, never that command payload.
    const note = executionFailureNote(error, timeoutMs);
    // A failed lane still leaves one property-scoped, machine-readable
    // handback. It is never imported and cannot be mistaken for subject proof.
    if (!fs.existsSync(outputFile)) {
      fs.writeFileSync(outputFile, JSON.stringify({
        subject_verification_status: 'failed',
        subject_verification_note: note,
        address: input.address,
        apn: input.apn,
        property_card_id: input.propertyCardId,
        canonical_property_identifier: input.landPortalPropertyId,
        captured_at: now(),
        comps: [],
      }, null, 2));
    }
    return finish('failed', note, lastImportResult);
  } finally {
    if (monitor) clearInterval(monitor);
  }
}

/**
 * Launch at most once for one active Deal Intelligence run + Property Card.
 * Repeated callers receive the same in-flight or completed outcome.
 */
export function runHermesLandPortalLane(
  input: HermesLandPortalLaneInput,
  deps: HermesLandPortalAutoDeps = {},
): Promise<HermesLandPortalLaneOutcome> {
  const key = laneKey(input);
  const completed = completedRuns.get(key);
  if (completed) return Promise.resolve(completed);
  const active = activeRuns.get(key);
  if (active) return active;
  const execution = executeLane(input, deps).then((outcome) => {
    completedRuns.set(key, outcome);
    logger.info({
      propertyLabel: outcome.propertyLabel,
      runId: outcome.runId,
      status: outcome.status,
      runtimeMs: outcome.runtimeMs,
      outputFile: outcome.outputFile,
      importedCompCount: outcome.importResult?.importedCompCount ?? 0,
      persistedCategories: outcome.persistedCategories.map((result) => result.category),
    }, 'hermes_landportal_lane_completed');
    return outcome;
  }).finally(() => activeRuns.delete(key));
  activeRuns.set(key, execution);
  return execution;
}

export function getHermesLandPortalLaneProgress(dealCardId: number): HermesLandPortalLaneProgress | null {
  const progress = laneProgress.get(dealCardId);
  return progress ? { ...progress, persistedCategories: progress.persistedCategories.map((result) => ({ ...result })) } : null;
}

export function resetHermesLandPortalLaneCache(): void {
  activeRuns.clear();
  completedRuns.clear();
  laneProgress.clear();
}
