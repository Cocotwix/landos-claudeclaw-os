// Automatic Hermes -> LandOS LandPortal lane.
//
// The lane owns exactly three sibling work units. Each one runs a bounded
// Hermes one-shot, verifies the same exact subject, and hands one category to
// the existing canonical importer. LandOS remains the only system of record.

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { logger } from '../logger.js';
import { landPortalIdentityFromUrl } from './landportal-operating-rules.js';
import {
  importHermesLandPortalFile,
  validateHermesLandPortalFileIdentity,
  type HermesLandPortalCategoryImportResult,
  type HermesLandPortalImportResult,
  type HermesLandPortalResultCategory,
  type HermesLandPortalValidatedIdentity,
} from './hermes-landportal-import.js';

const execFileAsync = promisify(execFile);

export const HERMES_LANDPORTAL_CDP_ENDPOINT = 'http://127.0.0.1:9224';
export const HERMES_LANDPORTAL_PROFILE = 'landos';
export const HERMES_LANDPORTAL_CDP_SKILL = 'driving-cdp-browser';
export const HERMES_LANDPORTAL_CONTEXT_SKILL = 'landos-landportal';
export const HERMES_LANDPORTAL_TARGET_RUNTIME_MS = 5 * 60_000;
export const HERMES_LANDPORTAL_HARD_TIMEOUT_MS = 5 * 60_000;
// Hermes v0.20.0 verifies each capture with vision-model checks before writing
// its handback; the visuals work unit measurably cannot finish that loop inside
// five minutes (it was killed mid final-check at eight). The expanded capture
// set (default 3D, rendered soil overlay with popup reads, buildability, and
// the multi-angle Street View scan) was then killed mid-work at twelve, so the
// visuals ceiling is twenty minutes. Subject and comps keep five.
export const HERMES_LANDPORTAL_VISUALS_TARGET_RUNTIME_MS = 20 * 60_000;
export const HERMES_LANDPORTAL_VISUALS_HARD_TIMEOUT_MS = 20 * 60_000;
// Comps could not keep five either, for the same reason visuals could not: the
// work unit is no longer a single sidebar read. `comp_drilldown_requirement`
// tells it to open EVERY sidebar comparable through its detail or Show on Map
// surface and retain address, city/state/zip, acres, coordinates, detail_url
// and imagery per row — a multi-page pass whose cost scales with the comp
// count. On 5170 Hwy 60 it was killed mid-work at exactly 300000 ms, so no
// LandPortal comparable was ever imported and the valuation had nothing with a
// reliable acreage to qualify. Fifteen minutes sits between the subject unit's
// five and the visuals unit's twenty, matching where the work actually sits.
export const HERMES_LANDPORTAL_COMPS_TARGET_RUNTIME_MS = 15 * 60_000;
export const HERMES_LANDPORTAL_COMPS_HARD_TIMEOUT_MS = 15 * 60_000;
export const HERMES_LANDPORTAL_SPECIALISTS = ['subject', 'comps', 'visuals'] as const;

export type HermesLandPortalSpecialist = typeof HERMES_LANDPORTAL_SPECIALISTS[number];
export type HermesLandPortalLaneStatus = 'exact_match' | 'context_only' | 'no_match' | 'failed';
export type HermesLandPortalWorkUnitStatus = 'running' | HermesLandPortalLaneStatus;

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

export interface HermesLandPortalWorkUnitProgress {
  workUnitId: string;
  specialist: HermesLandPortalSpecialist;
  label: string;
  outputFile: string;
  status: HermesLandPortalWorkUnitStatus;
  startedAt: string;
  completedAt: string | null;
  runtimeMs: number | null;
  note: string;
  persistedCategory: HermesLandPortalCategoryImportResult | null;
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
  workUnits: HermesLandPortalWorkUnitProgress[];
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
  workUnits: HermesLandPortalWorkUnitProgress[];
  note: string;
}

export interface HermesLandPortalInvocation {
  specialist: HermesLandPortalSpecialist;
  workUnitId: string;
  outputFile: string;
}

export interface HermesLandPortalAutoDeps {
  outputDirectory?: string;
  timeoutMs?: number;
  specialistTimeoutMs?: Partial<Record<HermesLandPortalSpecialist, number>>;
  now?: () => string;
  clockMs?: () => number;
  monitorIntervalMs?: number;
  invokeHermes?: (prompt: string, outputDirectory: string, timeoutMs: number, invocation: HermesLandPortalInvocation) => Promise<void>;
  importFile?: typeof importHermesLandPortalFile;
  validateFile?: typeof validateHermesLandPortalFileIdentity;
  /** Tests inject true; production lanes always sweep their tabs. */
  skipTabHygiene?: boolean;
}

type HermesStatusPayload = {
  subject_verification_status?: unknown;
  subject_verification_note?: unknown;
};

interface SpecialistExecution {
  workUnit: HermesLandPortalWorkUnitProgress;
  importResult: HermesLandPortalImportResult | null;
  importResults: HermesLandPortalImportResult[];
}

const activeRuns = new Map<string, Promise<HermesLandPortalLaneOutcome>>();
const completedRuns = new Map<string, HermesLandPortalLaneOutcome>();
const laneProgress = new Map<number, HermesLandPortalLaneProgress>();

const cleanText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const cryptoHash = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');
const compactIdentity = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

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

function defaultOutputDirectory(): string {
  return path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'hermes', 'profiles', HERMES_LANDPORTAL_PROFILE, 'shared', 'landportal',
  );
}

/** Retained for the existing single-file operator/import tooling. */
export function hermesLandPortalOutputFile(
  input: HermesLandPortalLaneInput,
  outputDirectory = defaultOutputDirectory(),
): string {
  const address = safeFilePart(input.address, 'property');
  const run = safeFilePart(input.runId, 'run');
  return path.join(outputDirectory, `${address}__property-card-${input.propertyCardId}__${run}.json`);
}

export function hermesLandPortalSpecialistOutputFile(
  input: HermesLandPortalLaneInput,
  specialist: HermesLandPortalSpecialist,
  outputDirectory = defaultOutputDirectory(),
): string {
  const propertyRunDirectory = hermesLandPortalOutputFile(input, outputDirectory).replace(/\.json$/i, '');
  return path.join(propertyRunDirectory, `${specialist}.json`);
}

function specialistLabel(specialist: HermesLandPortalSpecialist): string {
  if (specialist === 'subject') return 'Exact subject identity and property facts';
  if (specialist === 'comps') return 'LandPortal comparables';
  return 'Required visual and overlay evidence';
}

export function hermesLandPortalPrompt(
  input: HermesLandPortalLaneInput,
  outputFile: string,
  specialist: HermesLandPortalSpecialist = 'subject',
): string {
  const assignment = JSON.stringify({
    assignment: 'landportal_specialist_lookup',
    specialist_category: specialist,
    work_unit_id: `${input.runId}:${input.propertyCardId}:${specialist}`,
    responsibility: specialistLabel(specialist),
    address: input.address,
    apn: input.apn,
    owner: input.owner,
    county: input.county,
    state: input.state,
    property_card_id: input.propertyCardId,
    canonical_property_identifier: input.landPortalPropertyId,
    output_file: outputFile,
    visual_artifact_directory: path.dirname(outputFile),
    // KEYS and VIEWS are different fields and were previously listed together,
    // so `landportal_overview` (a key) came back in `requested_view` (a view)
    // exactly as this line implied — and the importer refused the whole batch
    // for containing it. Name the two explicitly.
    requested_visuals: specialist === 'visuals'
      ? 'keys landportal_overview, default_3d, soil_overlay, buildability, street_view; requested_view is a view name, never a key (overview uses parcel_context).'
      : '',
    overview_requirement: specialist === 'visuals'
      ? 'landportal_overview: parcel_context frame, ENTIRE boundary inside with padding all sides; zoom out until no vertex touches an edge; report boundary_fully_in_frame true|false, clipped true when one leaves; show the nearest public road and any access route; never default 3D or county scale.'
      : undefined,
    access_investigation: specialist === 'visuals'
      ? 'Land Locked: Yes or absent frontage triggers a map and Street View pass: place the marker on the nearest public road, then keep access_evidence for parcel_flag, apparent_physical, reported_legal and verified_legal separate with source_kind, basis and weight. Only a recorded instrument verifies legal access.'
      : undefined,
    comp_drilldown_requirement: specialist === 'comps'
      ? 'Open each sidebar comparable through its comp detail or Show on Map surface. Retain address, city/state/zip, acres, lat/lng or an honest unresolved location, detail_url, and the comparable image as image_url plus image_source. Set drilled_down only when that surface contributed a field; never invent a value.'
      : undefined,
    handback_mode: 'independent_specialist',
    completed_categories: [specialist],
    // The importer accepts only these literal values; free-text camera notes
    // previously caused a verified visuals handback to be rejected wholesale.
    // The per-artifact field list and the full capture procedure stay in the
    // preloaded landos-landportal skill: this work unit is held under the
    // 2,500-character assignment ceiling the lane suite enforces.
    visual_artifact_field_rules: specialist === 'visuals'
      ? 'camera_scale exactly parcel|context|county|national|unknown; obstructions [] when clean; overlay_rendered true only once polygons render; keys landportal_overview, default_3d, soil_overlay, buildability, street_view(_2/_3); set street_view_available, street_view_note and street_view_observations [{label,detail,basis}].'
      : undefined,
  }, null, 2);
  return `Complete one bounded LandOS LandPortal specialist work unit using the persistent profile context and the preloaded ${HERMES_LANDPORTAL_CONTEXT_SKILL} and ${HERMES_LANDPORTAL_CDP_SKILL} skills.

CURRENT WORK UNIT
${assignment}

Verify the exact subject independently. Own one CDP tab and never touch another worker's tab. Write only this specialist's category to output_file as soon as it is verified. Repeat the exact address, APN, subject URL, Property Card guard, and canonical LandPortal identifier. Do not wait for sibling specialists. Stop after the handback.`;
}

export function hermesLandPortalInvocationArgs(prompt: string): string[] {
  return [
    '--profile', HERMES_LANDPORTAL_PROFILE,
    '--skills', `${HERMES_LANDPORTAL_CDP_SKILL},${HERMES_LANDPORTAL_CONTEXT_SKILL}`,
    '--oneshot', prompt,
  ];
}

async function invokeInstalledHermes(
  prompt: string,
  _outputDirectory: string,
  timeoutMs: number,
  _invocation: HermesLandPortalInvocation,
): Promise<void> {
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
    cwd: process.cwd(),
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
}

function classifyPayload(filePath: string): { status: HermesLandPortalLaneStatus; note: string } {
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
    return `Hermes LandPortal execution exceeded the ${timeoutMs} ms work-unit limit.`;
  }
  const firstLine = cleanText(details?.message ?? String(error)).split(/\r?\n/, 1)[0]?.slice(0, 300);
  return `Hermes LandPortal execution failed: ${firstLine || 'Unknown execution error.'}`;
}

function cloneCategory(result: HermesLandPortalCategoryImportResult): HermesLandPortalCategoryImportResult {
  return { ...result };
}

function cloneWorkUnit(unit: HermesLandPortalWorkUnitProgress): HermesLandPortalWorkUnitProgress {
  return { ...unit, persistedCategory: unit.persistedCategory ? cloneCategory(unit.persistedCategory) : null };
}

function identityConflict(
  held: HermesLandPortalValidatedIdentity,
  incoming: HermesLandPortalValidatedIdentity,
): string | null {
  const conflicts: string[] = [];
  if (compactIdentity(held.address) !== compactIdentity(incoming.address)) conflicts.push('address');
  if (compactIdentity(held.apn) !== compactIdentity(incoming.apn)) conflicts.push('APN');
  if (held.propertyId !== incoming.propertyId) conflicts.push('LandPortal property identifier');
  const heldUrlIdentity = landPortalIdentityFromUrl(held.subjectUrl);
  const incomingUrlIdentity = landPortalIdentityFromUrl(incoming.subjectUrl);
  const sameSubjectUrlIdentity = heldUrlIdentity && incomingUrlIdentity
    ? heldUrlIdentity.fips === incomingUrlIdentity.fips
      && compactIdentity(heldUrlIdentity.apn ?? '') === compactIdentity(incomingUrlIdentity.apn ?? '')
      && heldUrlIdentity.propertyId === incomingUrlIdentity.propertyId
    : held.subjectUrl === incoming.subjectUrl;
  if (!sameSubjectUrlIdentity) conflicts.push('LandPortal subject URL');
  return conflicts.length ? conflicts.join(', ') : null;
}

function failedHandback(input: HermesLandPortalLaneInput, specialist: HermesLandPortalSpecialist, note: string, capturedAt: string): string {
  return JSON.stringify({
    specialist_category: specialist,
    subject_verification_status: 'failed',
    subject_verification_note: note,
    address: input.address,
    apn: input.apn,
    property_card_id: input.propertyCardId,
    canonical_property_identifier: input.landPortalPropertyId,
    captured_at: capturedAt,
    completed_categories: [],
    comps: [],
    visual_artifacts: [],
  }, null, 2);
}

async function executeSpecialist(input: {
  lane: HermesLandPortalLaneInput;
  specialist: HermesLandPortalSpecialist;
  outputDirectory: string;
  timeoutMs: number;
  deps: HermesLandPortalAutoDeps;
  reconcile: (identity: HermesLandPortalValidatedIdentity) => HermesLandPortalValidatedIdentity;
  publish: (workUnit: HermesLandPortalWorkUnitProgress) => void;
}): Promise<SpecialistExecution> {
  const { lane, specialist, outputDirectory, timeoutMs, deps, reconcile, publish } = input;
  const now = deps.now ?? (() => new Date().toISOString());
  const clockMs = deps.clockMs ?? (() => Date.now());
  const startedAt = now();
  const startedMs = clockMs();
  const outputFile = hermesLandPortalSpecialistOutputFile(lane, specialist, outputDirectory);
  const workUnitId = `${lane.runId}:${lane.propertyCardId}:${specialist}`;
  const importResults: HermesLandPortalImportResult[] = [];
  let importResult: HermesLandPortalImportResult | null = null;
  let persistedCategory: HermesLandPortalCategoryImportResult | null = null;
  let lastArtifactHash = '';
  let lastImportError: string | null = null;
  let monitor: ReturnType<typeof setInterval> | null = null;

  const unit = (status: HermesLandPortalWorkUnitStatus, note: string, completedAt: string | null): HermesLandPortalWorkUnitProgress => ({
    workUnitId,
    specialist,
    label: specialistLabel(specialist),
    outputFile,
    status,
    startedAt,
    completedAt,
    runtimeMs: completedAt ? Math.max(0, clockMs() - startedMs) : null,
    note,
    persistedCategory: persistedCategory ? cloneCategory(persistedCategory) : null,
  });

  const consume = (): void => {
    if (!fs.existsSync(outputFile)) return;
    let raw: string;
    try { raw = fs.readFileSync(outputFile, 'utf8'); } catch { return; }
    const artifactHash = cryptoHash(raw);
    if (!raw.trim() || artifactHash === lastArtifactHash) return;
    const classified = classifyPayload(outputFile);
    if (classified.status !== 'exact_match') return;
    lastArtifactHash = artifactHash;
    try {
      const identity = (deps.validateFile ?? validateHermesLandPortalFileIdentity)(outputFile, { propertyCardId: lane.propertyCardId });
      if (identity.specialistCategory !== specialist || identity.completedCategories.length !== 1 || identity.completedCategories[0] !== specialist) {
        throw new Error(`Hermes ${specialist} work unit returned categories assigned to another specialist.`);
      }
      const expectedIdentity = reconcile(identity);
      const imported = (deps.importFile ?? importHermesLandPortalFile)(outputFile, { propertyCardId: lane.propertyCardId, expectedIdentity });
      importResult = imported;
      importResults.push(imported);
      const category = imported.categoryResults.find((result) => result.category === specialist) ?? null;
      if (!category) throw new Error(`Canonical importer returned no ${specialist} category result.`);
      if (category.error) throw new Error(category.error);
      persistedCategory = category;
      lastImportError = null;
      logger.info({
        propertyLabel: hermesLandPortalPropertyLabel(lane), runId: lane.runId, workUnitId,
        specialist, persistedAt: category.persistedAt, itemCount: category.itemCount,
      }, 'hermes_landportal_specialist_category_persisted');
      publish(unit('running', classified.note, null));
    } catch (error) {
      lastImportError = (error as Error).message;
    }
  };

  try {
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
    const started = unit('running', `Hermes ${specialist} specialist is collecting ${specialistLabel(specialist).toLowerCase()} for ${lane.address}.`, null);
    publish(started);
    logger.info({ propertyLabel: hermesLandPortalPropertyLabel(lane), runId: lane.runId, workUnitId, specialist, outputFile }, 'hermes_landportal_specialist_started');
    monitor = setInterval(consume, Math.max(10, deps.monitorIntervalMs ?? 250));
    monitor.unref?.();
    await (deps.invokeHermes ?? invokeInstalledHermes)(
      hermesLandPortalPrompt(lane, outputFile, specialist),
      outputDirectory,
      timeoutMs,
      { specialist, workUnitId, outputFile },
    );
    consume();
    if (!fs.existsSync(outputFile)) {
      const note = `Hermes ${specialist} specialist completed without creating its required property-specific JSON file.`;
      fs.writeFileSync(outputFile, failedHandback(lane, specialist, note, now()));
      const finished = unit('failed', note, now());
      publish(finished);
      return { workUnit: finished, importResult, importResults };
    }
    const classified = classifyPayload(outputFile);
    if (classified.status !== 'exact_match') {
      const finished = unit(classified.status, classified.note, now());
      publish(finished);
      return { workUnit: finished, importResult, importResults };
    }
    if (lastImportError) {
      const finished = unit('failed', `Hermes ${specialist} handback was rejected: ${lastImportError}`, now());
      publish(finished);
      return { workUnit: finished, importResult, importResults };
    }
    if (!persistedCategory) {
      const finished = unit('failed', `Hermes ${specialist} exact-match handback did not produce its canonical category.`, now());
      publish(finished);
      return { workUnit: finished, importResult, importResults };
    }
    const finished = unit('exact_match', classified.note, now());
    publish(finished);
    return { workUnit: finished, importResult, importResults };
  } catch (error) {
    consume();
    const note = executionFailureNote(error, timeoutMs);
    if (!fs.existsSync(outputFile)) fs.writeFileSync(outputFile, failedHandback(lane, specialist, note, now()));
    const finished = unit('failed', note, now());
    publish(finished);
    return { workUnit: finished, importResult, importResults };
  } finally {
    if (monitor) clearInterval(monitor);
  }
}

// ── Lane tab hygiene (endpoint-level, finally-style) ─────────────────────
//
// The Hermes child drives the authenticated Chrome on the CDP endpoint from a
// separate process, so no in-process page handle exists to track. The lane
// therefore snapshots the endpoint's page ids before its specialists start
// and, in a finally, closes only the LandPortal/Maps research pages that
// appeared during the run — success, failure, and timeout alike. Operator
// pages that already existed are never touched, and one authenticated
// LandPortal tab is always left for login continuity.

async function snapshotLanePages(cdpUrl: string): Promise<Set<string> | null> {
  try {
    const list = await (await fetch(`${cdpUrl}/json/list`, { signal: AbortSignal.timeout(5_000) })).json() as Array<{ id: string; type: string }>;
    return new Set(list.filter((tab) => tab.type === 'page').map((tab) => tab.id));
  } catch {
    return null;
  }
}

const LANE_RESEARCH_URL = /landportal\.com|google\.[a-z.]+\/maps|maps\.google\./i;

async function closeLaneCreatedPages(cdpUrl: string, before: Set<string> | null): Promise<{ closed: number }> {
  let closed = 0;
  try {
    const list = await (await fetch(`${cdpUrl}/json/list`, { signal: AbortSignal.timeout(5_000) })).json() as Array<{ id: string; type: string; url: string }>;
    const pages = list.filter((tab) => tab.type === 'page');
    const candidates = before
      // Pages that appeared during this lane's run on research hosts are the
      // lane's to close; everything that predates the run is preserved.
      ? pages.filter((tab) => !before.has(tab.id) && LANE_RESEARCH_URL.test(tab.url ?? ''))
      : [];
    // EVERY PAGE THIS LANE CREATED IS CLOSED — no survivor.
    //
    // This used to retain one LandPortal tab "to keep the session
    // authenticated". That belief is wrong and it was the post-run tab escape:
    // LandPortal authentication lives in the persistent Chrome profile on disk,
    // not in an open tab, which is why `closeSurplusSessionPages` already closes
    // its cached working tab outright and the next run is still signed in.
    // Because this lane commonly runs AFTER the Deal Intelligence cleanup
    // boundary, its survivor outlived the run that created it and sat in the
    // automation browser until a manual reap.
    for (const tab of candidates) {
      try {
        const res = await fetch(`${cdpUrl}/json/close/${tab.id}`, { signal: AbortSignal.timeout(5_000) });
        if (res.ok) closed += 1;
      } catch { /* already gone */ }
    }
  } catch { /* endpoint offline — nothing to clean */ }
  return { closed };
}

async function executeLane(input: HermesLandPortalLaneInput, deps: HermesLandPortalAutoDeps): Promise<HermesLandPortalLaneOutcome> {
  const now = deps.now ?? (() => new Date().toISOString());
  const clockMs = deps.clockMs ?? (() => Date.now());
  const startedAt = now();
  const startedMs = clockMs();
  const propertyLabel = hermesLandPortalPropertyLabel(input);
  const outputDirectory = path.resolve(deps.outputDirectory ?? defaultOutputDirectory());
  const workUnits = new Map<HermesLandPortalSpecialist, HermesLandPortalWorkUnitProgress>();
  const categories = new Map<HermesLandPortalResultCategory, HermesLandPortalCategoryImportResult>();
  let reconciledIdentity: HermesLandPortalValidatedIdentity | null = null;

  const currentCategories = (): HermesLandPortalCategoryImportResult[] => [...categories.values()].map(cloneCategory);
  const currentUnits = (): HermesLandPortalWorkUnitProgress[] => HERMES_LANDPORTAL_SPECIALISTS
    .map((specialist) => workUnits.get(specialist))
    .filter((unit): unit is HermesLandPortalWorkUnitProgress => !!unit)
    .map(cloneWorkUnit);
  const publishLane = (status: HermesLandPortalLaneProgress['status'], note: string, completedAt: string | null): void => {
    laneProgress.set(input.dealCardId, {
      runId: input.runId,
      dealCardId: input.dealCardId,
      propertyCardId: input.propertyCardId,
      address: input.address,
      status,
      startedAt,
      completedAt,
      persistedCategories: currentCategories(),
      workUnits: currentUnits(),
      note,
    });
  };
  const publishWorkUnit = (unit: HermesLandPortalWorkUnitProgress): void => {
    workUnits.set(unit.specialist, cloneWorkUnit(unit));
    if (unit.persistedCategory && !unit.persistedCategory.error) categories.set(unit.specialist, cloneCategory(unit.persistedCategory));
    const running = currentUnits().filter((candidate) => candidate.status === 'running').length;
    publishLane('running', `${currentCategories().length}/3 Hermes categories retained; ${running}/3 specialist work units active.`, null);
  };
  const reconcile = (identity: HermesLandPortalValidatedIdentity): HermesLandPortalValidatedIdentity => {
    if (!reconciledIdentity) {
      reconciledIdentity = identity;
      return reconciledIdentity;
    }
    const conflict = identityConflict(reconciledIdentity, identity);
    if (conflict) throw new Error(`Hermes specialist identity conflict rejected (${conflict}) for ${input.address}.`);
    return reconciledIdentity;
  };

  publishLane('running', `Launching three controlled Hermes specialists for ${input.address}.`, null);
  // Tab hygiene is skipped in tests (never touch a real operator browser from
  // a test run) and when explicitly disabled; a production lane always sweeps
  // its research tabs in the finally below, whatever the specialists did.
  const tabHygiene = !deps.skipTabHygiene && !process.env.VITEST;
  const pagesBefore = tabHygiene ? await snapshotLanePages(HERMES_LANDPORTAL_CDP_ENDPOINT) : null;
  let executions: SpecialistExecution[];
  try {
    executions = await Promise.all(HERMES_LANDPORTAL_SPECIALISTS.map((specialist) => {
      const target = specialist === 'visuals'
        ? HERMES_LANDPORTAL_VISUALS_TARGET_RUNTIME_MS
        : specialist === 'comps'
          ? HERMES_LANDPORTAL_COMPS_TARGET_RUNTIME_MS
          : HERMES_LANDPORTAL_TARGET_RUNTIME_MS;
      const hardCeiling = specialist === 'visuals'
        ? HERMES_LANDPORTAL_VISUALS_HARD_TIMEOUT_MS
        : specialist === 'comps'
          ? HERMES_LANDPORTAL_COMPS_HARD_TIMEOUT_MS
          : HERMES_LANDPORTAL_HARD_TIMEOUT_MS;
      const configured = deps.specialistTimeoutMs?.[specialist] ?? deps.timeoutMs ?? target;
      const timeoutMs = Math.min(hardCeiling, Math.max(1, configured));
      return executeSpecialist({ lane: input, specialist, outputDirectory, timeoutMs, deps, reconcile, publish: publishWorkUnit });
    }));
  } finally {
    if (tabHygiene) {
      const swept = await closeLaneCreatedPages(HERMES_LANDPORTAL_CDP_ENDPOINT, pagesBefore);
      if (swept.closed > 0) {
        logger.info({ runId: input.runId, dealCardId: input.dealCardId, closed: swept.closed }, 'hermes_landportal_lane_tabs_closed');
      }
    }
  }

  const persistedCategories = currentCategories();
  const imports = executions.flatMap((execution) => execution.importResults);
  const finalImport = imports.at(-1) ?? null;
  const units = currentUnits();
  const failed = units.filter((unit) => unit.status === 'failed');
  const status: HermesLandPortalLaneStatus = persistedCategories.length > 0
    ? 'exact_match'
    : units.some((unit) => unit.status === 'context_only')
      ? 'context_only'
      : units.length === HERMES_LANDPORTAL_SPECIALISTS.length && units.every((unit) => unit.status === 'no_match')
        ? 'no_match'
        : 'failed';
  const completedAt = now();
  const note = persistedCategories.length > 0
    ? `${persistedCategories.length}/3 independently verified Hermes categories retained for ${input.address}; ${failed.length} specialist failure(s) did not retract them.`
    : `No Hermes specialist category was admitted for ${input.address}; ${failed.length} work unit(s) failed.`;
  publishLane(status, note, completedAt);
  return {
    status,
    runId: input.runId,
    dealCardId: input.dealCardId,
    propertyCardId: input.propertyCardId,
    propertyLabel,
    outputFile: hermesLandPortalSpecialistOutputFile(input, 'subject', outputDirectory),
    startedAt,
    completedAt,
    runtimeMs: Math.max(0, clockMs() - startedMs),
    note,
    importResult: finalImport,
    importResults: imports,
    persistedCategories,
    workUnits: units,
  };
}

/** Launch once for one Deal Intelligence run + Property Card. */
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
      specialists: outcome.workUnits.map((unit) => ({ specialist: unit.specialist, status: unit.status, startedAt: unit.startedAt, completedAt: unit.completedAt })),
      persistedCategories: outcome.persistedCategories.map((result) => result.category),
    }, 'hermes_landportal_lane_completed');
    return outcome;
  }).finally(() => activeRuns.delete(key));
  activeRuns.set(key, execution);
  return execution;
}

export function getHermesLandPortalLaneProgress(dealCardId: number): HermesLandPortalLaneProgress | null {
  const progress = laneProgress.get(dealCardId);
  return progress ? {
    ...progress,
    persistedCategories: progress.persistedCategories.map(cloneCategory),
    workUnits: progress.workUnits.map(cloneWorkUnit),
  } : null;
}

export function resetHermesLandPortalLaneCache(): void {
  activeRuns.clear();
  completedRuns.clear();
  laneProgress.clear();
}
