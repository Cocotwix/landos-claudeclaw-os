// LandOS — Browser Use LandPortal pilot lane.
//
// One narrow adaptive-navigation lane: Browser Use (Python, installed in its
// own venv outside the repo) attaches to the SAME persistent operator Chrome
// the existing Puppeteer driver uses (readSessionConfig().cdpUrl), operates the
// normal visible LandPortal website through the already-authenticated session,
// and returns one structured, schema-validated result with labeled visual
// evidence. The existing deterministic Puppeteer stack is untouched; this lane
// covers adaptive navigation, page interpretation and visual inspection.
//
// Boundaries (mirrors AGENTS.md): no LandPortal API, no paid reports, no skip
// tracing, no exports, no credit spend. Credentials are never read here — if
// the session is logged out the lane reports it honestly and stops.
//
// Persistence: one activity row per completed run on the SUBJECT property card
// (kind 'landportal_browseruse'), exactly like property inspections. Nothing is
// merged into other lanes' data; one failed run never erases earlier evidence.

import path from 'path';
import fs from 'fs';
import { spawn as nodeSpawn } from 'child_process';
import os from 'os';
import { logger } from '../logger.js';
import { readEnvFile, withEnvFileSecrets } from '../env.js';
import { readSessionConfig, ensureLandPortalAuthenticated, type LandPortalReadiness } from './browser-session.js';
import { getDealCard } from './deal-card.js';
import { attachCardActivity, loadPropertyInspection } from './property-card.js';
import { getLandosDb } from './db.js';

// ─────────────────────────────────────────────────────────────────────────
// Result types (the runner's stdout contract)
// ─────────────────────────────────────────────────────────────────────────

export interface BrowserUseSubject {
  address: string;
  city: string | null;
  state: string | null;
  county: string | null;
  apn: string | null;
}

export interface BrowserUseCapture {
  label: string;
  /** Basename only — resolved against the configured screenshot dir. */
  file: string;
  pageUrl: string;
  capturedAt: string;
}

export interface BrowserUseCompCandidate {
  address: string | null;
  distance: string | null;
  sale_date: string | null;
  sale_price: string | null;
  acreage: number | null;
  price_per_acre: string | null;
  property_type: string | null;
  source_context: string;
  relevance: string;
}

export interface BrowserUseFindings {
  subject_identity: {
    address_queried: string;
    landportal_address: string | null;
    apn: string | null;
    county: string | null;
    state: string | null;
    parcel_match: 'confirmed' | 'likely' | 'uncertain' | 'not_found';
    match_reasoning: string;
  };
  property_facts: {
    acreage: number | null;
    owner_shown: string | null;
    coordinates: string | null;
    property_type: string | null;
    roads_serving: string[];
    other_characteristics: string[];
    unavailable_fields: string[];
  };
  visual_observations: {
    parcel_shape: string | null;
    apparent_road_frontage: string | null;
    apparent_access: string | null;
    surroundings: string | null;
    notes: string[];
  };
  conflicts: Array<{
    structured_field: string;
    structured_value: string;
    visual_observation: string;
    explanation: string;
  }>;
  comp_attempt: {
    attempted: boolean;
    outcome: string;
    candidates: BrowserUseCompCandidate[];
  };
  failed_actions: Array<{ action: string; reason: string }>;
  auth_required: boolean;
  paid_feature_encountered: string | null;
  confidence: string;
  confidence_reasoning: string;
}

export interface BrowserUsePilotResult {
  runner: 'browser-use';
  runnerVersion: string;
  startedAt: string | null;
  finishedAt: string;
  subject: BrowserUseSubject;
  findings: BrowserUseFindings | null;
  captures: BrowserUseCapture[];
  agentErrors: string[];
  urlsVisited: string[];
  complete: boolean;
}

/** What LandOS persists: the validated result plus attribution + audit facts. */
export interface PersistedBrowserUseRun {
  dealCardId: number;
  propertyCardId: number;
  result: BrowserUsePilotResult;
  schemaValid: boolean;
  validationErrors: string[];
  persistedAt: string;
}

export const BROWSERUSE_ACTIVITY_KIND = 'landportal_browseruse';
const CAPTURE_FILE_RE = /^browseruse_[a-z0-9_]{1,60}-\d{10,16}\.png$/;

// ─────────────────────────────────────────────────────────────────────────
// Schema validation — every field typed, attributable, no quantity gates
// ─────────────────────────────────────────────────────────────────────────

const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const isNumOrNull = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v));
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

function validateFindings(f: unknown, errors: string[]): f is BrowserUseFindings {
  if (f === null || typeof f !== 'object') { errors.push('findings must be an object'); return false; }
  const x = f as Record<string, unknown>;
  const si = x.subject_identity as Record<string, unknown> | undefined;
  if (!si || typeof si !== 'object') errors.push('subject_identity missing');
  else {
    if (!isStr(si.address_queried) || !si.address_queried.trim()) errors.push('subject_identity.address_queried must be a non-empty string');
    if (!isStrOrNull(si.landportal_address)) errors.push('subject_identity.landportal_address must be string|null');
    if (!isStrOrNull(si.apn)) errors.push('subject_identity.apn must be string|null');
    if (!['confirmed', 'likely', 'uncertain', 'not_found'].includes(String(si.parcel_match))) errors.push('subject_identity.parcel_match invalid');
    if (!isStr(si.match_reasoning)) errors.push('subject_identity.match_reasoning must be a string');
  }
  const pf = x.property_facts as Record<string, unknown> | undefined;
  if (!pf || typeof pf !== 'object') errors.push('property_facts missing');
  else {
    if (!isNumOrNull(pf.acreage)) errors.push('property_facts.acreage must be number|null');
    if (!isStrOrNull(pf.owner_shown)) errors.push('property_facts.owner_shown must be string|null');
    if (!isStrOrNull(pf.coordinates)) errors.push('property_facts.coordinates must be string|null');
    if (!isStrArray(pf.roads_serving ?? [])) errors.push('property_facts.roads_serving must be string[]');
    if (!isStrArray(pf.unavailable_fields ?? [])) errors.push('property_facts.unavailable_fields must be string[]');
  }
  const vo = x.visual_observations as Record<string, unknown> | undefined;
  if (!vo || typeof vo !== 'object') errors.push('visual_observations missing');
  else {
    for (const k of ['parcel_shape', 'apparent_road_frontage', 'apparent_access', 'surroundings']) {
      if (!isStrOrNull(vo[k])) errors.push(`visual_observations.${k} must be string|null`);
    }
  }
  if (!Array.isArray(x.conflicts)) errors.push('conflicts must be an array');
  else for (const c of x.conflicts as Array<Record<string, unknown>>) {
    if (!isStr(c?.structured_field) || !isStr(c?.visual_observation) || !isStr(c?.explanation)) {
      errors.push('each conflict needs structured_field, visual_observation, explanation strings');
      break;
    }
  }
  const ca = x.comp_attempt as Record<string, unknown> | undefined;
  if (!ca || typeof ca !== 'object') errors.push('comp_attempt missing');
  else {
    if (typeof ca.attempted !== 'boolean') errors.push('comp_attempt.attempted must be boolean');
    if (!isStr(ca.outcome)) errors.push('comp_attempt.outcome must be a string');
    if (!Array.isArray(ca.candidates)) errors.push('comp_attempt.candidates must be an array');
    else for (const cand of ca.candidates as Array<Record<string, unknown>>) {
      if (!isStr(cand?.source_context) || !isStr(cand?.relevance)) { errors.push('each comp candidate needs source_context and relevance'); break; }
      if (!isNumOrNull(cand.acreage ?? null)) { errors.push('comp candidate acreage must be number|null'); break; }
    }
  }
  if (typeof x.auth_required !== 'boolean') errors.push('auth_required must be boolean');
  if (!isStrOrNull(x.paid_feature_encountered ?? null)) errors.push('paid_feature_encountered must be string|null');
  if (!isStr(x.confidence)) errors.push('confidence must be a string');
  return errors.length === 0;
}

/**
 * Validate the runner's stdout document. `expectedAddress` enforces attribution:
 * a result whose subject does not match the requesting card is rejected outright
 * so evidence can never land on the wrong property.
 */
export function validateBrowserUsePilotResult(
  raw: unknown,
  expectedAddress: string,
): { ok: boolean; errors: string[]; value: BrowserUsePilotResult | null } {
  const errors: string[] = [];
  if (raw === null || typeof raw !== 'object') return { ok: false, errors: ['result must be a JSON object'], value: null };
  const r = raw as Record<string, unknown>;
  if (r.runner !== 'browser-use') errors.push("runner must be 'browser-use'");
  if (!isStr(r.runnerVersion)) errors.push('runnerVersion must be a string');
  if (!isStrOrNull(r.startedAt ?? null)) errors.push('startedAt must be string|null');
  if (!isStr(r.finishedAt)) errors.push('finishedAt must be a string');
  if (typeof r.complete !== 'boolean') errors.push('complete must be boolean');
  if (!isStrArray(r.agentErrors ?? [])) errors.push('agentErrors must be string[]');
  if (!isStrArray(r.urlsVisited ?? [])) errors.push('urlsVisited must be string[]');

  const subject = r.subject as Record<string, unknown> | undefined;
  if (!subject || typeof subject !== 'object' || !isStr(subject.address) || !subject.address.trim()) {
    errors.push('subject.address required');
  } else if (subject.address.trim().toLowerCase() !== expectedAddress.trim().toLowerCase()) {
    errors.push(`subject.address '${subject.address}' does not match the requesting card '${expectedAddress}' — refusing cross-property attribution`);
  }

  if (!Array.isArray(r.captures)) errors.push('captures must be an array');
  else for (const cap of r.captures as Array<Record<string, unknown>>) {
    if (!isStr(cap?.label) || !isStr(cap?.file) || !isStr(cap?.capturedAt)) { errors.push('each capture needs label, file, capturedAt strings'); break; }
    if (cap.file !== path.basename(cap.file) || !CAPTURE_FILE_RE.test(cap.file)) {
      errors.push(`capture file '${cap.file}' is not a plain browseruse capture basename`);
      break;
    }
  }

  // findings may honestly be null (a failed run is data); when present it must
  // be fully typed.
  if (r.findings !== null && r.findings !== undefined) validateFindings(r.findings, errors);
  else if (r.complete === true) errors.push('complete=true requires findings');

  if (errors.length) return { ok: false, errors, value: null };
  return { ok: true, errors: [], value: raw as unknown as BrowserUsePilotResult };
}

// ─────────────────────────────────────────────────────────────────────────
// Persistence — one activity row on the subject property card
// ─────────────────────────────────────────────────────────────────────────

export function persistBrowserUseRun(run: PersistedBrowserUseRun): number {
  const f = run.result.findings;
  const compCount = f?.comp_attempt?.candidates?.length ?? 0;
  const summary = run.schemaValid
    ? `Browser Use LandPortal research: parcel ${f?.subject_identity?.parcel_match ?? 'unknown'}, ${run.result.captures.length} capture(s), ${compCount} visible comp candidate(s).`
    : `Browser Use LandPortal research returned an invalid result (${run.validationErrors.length} schema error(s)); nothing merged.`;
  return attachCardActivity({
    cardId: run.propertyCardId,
    agentId: 'browseruse-landportal',
    kind: BROWSERUSE_ACTIVITY_KIND,
    summary,
    ref: JSON.stringify(run),
  });
}

/** Newest persisted Browser Use run for a property card, or null. */
export function loadBrowserUseRun(propertyCardId: number): PersistedBrowserUseRun | null {
  const row = getLandosDb()
    .prepare(`SELECT ref FROM landos_card_activity WHERE card_id = ? AND kind = ? ORDER BY created_at DESC, id DESC LIMIT 1`)
    .get(propertyCardId, BROWSERUSE_ACTIVITY_KIND) as { ref: string } | undefined;
  if (!row?.ref) return null;
  try {
    const parsed = JSON.parse(row.ref) as PersistedBrowserUseRun;
    if (!parsed || typeof parsed !== 'object' || !parsed.result) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Newest persisted run for a DEAL card (resolved through its subject property card). */
export function loadBrowserUseRunForDeal(dealCardId: number): PersistedBrowserUseRun | null {
  const resolved = subjectForDealCard(dealCardId);
  if (!resolved) return null;
  const run = loadBrowserUseRun(resolved.propertyCardId);
  // Attribution guard on the read path too: a row persisted for another deal
  // card is never served under this one.
  if (run && run.dealCardId !== dealCardId) return null;
  return run;
}

/**
 * Read-path authorization for a retained capture. Property Intelligence keeps
 * evidence history, while loadBrowserUseRunForDeal intentionally returns only
 * the newest run for status display. Image URLs from an older retained run
 * remain valid evidence and must therefore be authorized against every
 * persisted, deal-attributed Browser Use row rather than only the newest row.
 */
export function hasPersistedBrowserUseCaptureForDeal(dealCardId: number, file: string): boolean {
  if (file !== path.basename(file) || !CAPTURE_FILE_RE.test(file)) return false;
  const resolved = subjectForDealCard(dealCardId);
  if (!resolved) return false;
  const rows = getLandosDb()
    .prepare(`SELECT ref FROM landos_card_activity
      WHERE card_id = ? AND kind = ?
      ORDER BY created_at ASC, id ASC`)
    .all(resolved.propertyCardId, BROWSERUSE_ACTIVITY_KIND) as Array<{ ref: string }>;
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.ref) as PersistedBrowserUseRun;
      if (parsed?.dealCardId !== dealCardId) continue;
      if (parsed.result?.captures?.some((capture) => capture.file === file)) return true;
    } catch {
      // A malformed historic row must not authorize an arbitrary file.
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────
// Runner spawn
// ─────────────────────────────────────────────────────────────────────────

export interface BrowserUseRunnerDeps {
  /** Injectable for tests: runs the python runner, returns stdout. */
  execRunner?: (spec: object, env: Record<string, string | undefined>) => Promise<{ stdout: string; exitCode: number; stderrTail: string }>;
  ensureAuth?: () => Promise<LandPortalReadiness>;
  config?: ReturnType<typeof readSessionConfig>;
  timeoutMs?: number;
}

export function browserUsePythonPath(): string {
  const fromEnv = (process.env.LANDOS_BROWSERUSE_PYTHON ?? readEnvFile(['LANDOS_BROWSERUSE_PYTHON']).LANDOS_BROWSERUSE_PYTHON ?? '').trim();
  if (fromEnv) return fromEnv;
  return path.join(os.homedir(), '.landos-browseruse', 'Scripts', 'python.exe');
}

export function browserUseRunnerScript(): string {
  return path.join(process.cwd(), 'scripts', 'browseruse', 'landportal_pilot_runner.py');
}

// Generous ceiling: free-tier LLM quotas can throttle a run to a crawl; the
// runner itself reports honest partial results long before this fires.
const DEFAULT_TIMEOUT_MS = 45 * 60_000;

function defaultExecRunner(timeoutMs: number) {
  return (spec: object, env: Record<string, string | undefined>) =>
    new Promise<{ stdout: string; exitCode: number; stderrTail: string }>((resolve, reject) => {
      const py = browserUsePythonPath();
      if (!fs.existsSync(py)) { reject(new Error(`Browser Use python not found at ${py} (set LANDOS_BROWSERUSE_PYTHON)`)); return; }
      const child = nodeSpawn(py, [browserUseRunnerScript()], { env: env as NodeJS.ProcessEnv, windowsHide: true });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* already gone */ }
        reject(new Error(`Browser Use runner timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-8000); });
      child.on('error', (err) => { clearTimeout(timer); reject(err); });
      child.on('close', (code) => { clearTimeout(timer); resolve({ stdout, exitCode: code ?? -1, stderrTail: stderr }); });
      child.stdin.write(JSON.stringify(spec));
      child.stdin.end();
    });
}

// ─────────────────────────────────────────────────────────────────────────
// Run state — one run at a time per deal card, honest status for the UI
// ─────────────────────────────────────────────────────────────────────────

export interface BrowserUseRunStatus {
  state: 'idle' | 'queued' | 'running' | 'completed' | 'failed';
  dealCardId: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

const activeRuns = new Map<number, BrowserUseRunStatus>();

export function browserUseRunStatus(dealCardId: number): BrowserUseRunStatus {
  return activeRuns.get(dealCardId) ?? { state: 'idle', dealCardId, startedAt: null, finishedAt: null, error: null };
}

/** Transition helper used by the staged pilot path (same status surface). */
export function setBrowserUseRunState(dealCardId: number, state: 'running' | 'completed' | 'failed', error: string | null = null): void {
  const current = activeRuns.get(dealCardId);
  activeRuns.set(dealCardId, {
    state,
    dealCardId,
    startedAt: state === 'running' ? new Date().toISOString() : current?.startedAt ?? null,
    finishedAt: state === 'running' ? null : new Date().toISOString(),
    error,
  });
}

/** Mark a run as waiting on the shared single-Chrome mission gate. */
export function markBrowserUseQueued(dealCardId: number): void {
  const current = activeRuns.get(dealCardId);
  if (current?.state === 'running' || current?.state === 'queued') return;
  activeRuns.set(dealCardId, { state: 'queued', dealCardId, startedAt: null, finishedAt: null, error: null });
}

/** Test hook — clears in-memory run state (never touches persisted rows). */
export function _resetBrowserUseRunState(): void {
  activeRuns.clear();
}

// ─────────────────────────────────────────────────────────────────────────
// The lane
// ─────────────────────────────────────────────────────────────────────────

export interface BrowserUseLaunchOutcome {
  ok: boolean;
  error: string | null;
  status: BrowserUseRunStatus;
}

export function subjectForDealCard(dealCardId: number): { propertyCardId: number; subject: BrowserUseSubject } | null {
  const deal = getDealCard(dealCardId);
  if (!deal) return null;
  const cards = (deal as unknown as { propertyCards: Array<Record<string, unknown>> }).propertyCards ?? [];
  const link = cards.find((c) => c.role === 'subject') ?? cards[0];
  if (!link || typeof link.id !== 'number') return null;
  const address = String(link.active_input_address ?? '').trim();
  if (!address) return null;
  return {
    propertyCardId: link.id,
    subject: {
      address,
      city: (link.city as string | null) ?? null,
      state: (link.state as string | null) ?? null,
      county: (link.county as string | null) ?? null,
      apn: (link.apn as string | null) ?? null,
    },
  };
}

/**
 * Run the Browser Use LandPortal pilot for one deal card. Resolves when the
 * run has completed and persisted (or failed). Route handlers fire this async
 * and poll `browserUseRunStatus`.
 */
export async function runLandPortalBrowserUsePilot(dealCardId: number, deps: BrowserUseRunnerDeps = {}): Promise<BrowserUseLaunchOutcome> {
  const existing = activeRuns.get(dealCardId);
  if (existing?.state === 'running') {
    return { ok: false, error: 'A Browser Use run is already in progress for this deal card.', status: existing };
  }
  // A 'queued' entry for this card is OUR turn arriving through the mission
  // gate — proceed and replace it with the live running state.
  const resolved = subjectForDealCard(dealCardId);
  if (!resolved) {
    const status: BrowserUseRunStatus = { state: 'failed', dealCardId, startedAt: null, finishedAt: new Date().toISOString(), error: 'Deal card has no subject property with an address.' };
    activeRuns.set(dealCardId, status);
    return { ok: false, error: status.error, status };
  }

  const status: BrowserUseRunStatus = { state: 'running', dealCardId, startedAt: new Date().toISOString(), finishedAt: null, error: null };
  activeRuns.set(dealCardId, status);

  const fail = (message: string): BrowserUseLaunchOutcome => {
    const done: BrowserUseRunStatus = { ...status, state: 'failed', finishedAt: new Date().toISOString(), error: message };
    activeRuns.set(dealCardId, done);
    logger.warn({ dealCardId, message }, 'browseruse pilot failed');
    return { ok: false, error: message, status: done };
  };

  try {
    // 1. The approved authenticated session — reuse, never re-implement.
    const ensureAuth = deps.ensureAuth ?? (() => ensureLandPortalAuthenticated());
    const readiness = await ensureAuth();
    if (!readiness.authenticated) {
      return fail(`LandPortal session not authenticated (phase: ${readiness.phase}). Run the existing pairing/login workflow first.`);
    }

    // 2. Pick the LLM from the providers this project already has configured:
    // Anthropic when a real key exists, otherwise Google (Gemini — the
    // @google/genai provider LandOS already uses). No new provider is added.
    // withEnvFileSecrets bridges the .env FILE into the child env exactly like
    // the existing provider adapters do (empty values count as missing),
    // without mutating this process's environment.
    const baseEnv = deps.execRunner ? process.env : withEnvFileSecrets(['ANTHROPIC_API_KEY', 'GOOGLE_API_KEY']);
    const hasKey = (name: string) => !!(baseEnv[name] ?? '').trim();
    const provider = hasKey('ANTHROPIC_API_KEY') ? 'anthropic' : hasKey('GOOGLE_API_KEY') ? 'google' : null;
    if (!deps.execRunner && !provider) {
      return fail('No configured LLM provider key found (ANTHROPIC_API_KEY or GOOGLE_API_KEY); Browser Use needs one of the existing providers.');
    }

    // 3. Spawn the runner against the same CDP endpoint + screenshot dir. The
    // provider key travels ONLY through the child environment; it is never
    // logged, echoed into the spec, or placed on the command line.
    const config = deps.config ?? readSessionConfig();
    // Hybrid handoff: when the deterministic inspection lane already resolved
    // the subject's LandPortal property page, Browser Use starts there instead
    // of re-fighting the search widget. Deterministic steps stay deterministic;
    // Browser Use covers interpretation, visual inspection and recovery.
    let startUrl: string | null = null;
    try {
      const parcelUrl = loadPropertyInspection(resolved.propertyCardId)?.parcelUrl ?? null;
      if (parcelUrl && parcelUrl.startsWith('https://landportal.com/')) startUrl = parcelUrl;
    } catch { /* inspection unavailable — the runner searches normally */ }
    const spec = {
      subject: resolved.subject,
      cdpUrl: config.cdpUrl,
      outputDir: config.screenshotDir,
      startUrl,
      provider: provider ?? 'anthropic',
      model: (process.env.LANDOS_BROWSERUSE_MODEL ?? readEnvFile(['LANDOS_BROWSERUSE_MODEL']).LANDOS_BROWSERUSE_MODEL ?? '').trim() || null,
      // Each agent step costs one LLM request. The configured free-tier Gemini
      // quota is 20 requests/day per model, so the workflow is budgeted to fit
      // inside one day's allowance (the task prompt prioritizes accordingly).
      maxSteps: 15,
    };
    const childEnv: Record<string, string | undefined> = {
      ...baseEnv,
      ANONYMIZED_TELEMETRY: 'false',
      BROWSER_USE_CLOUD_SYNC: 'false',
    };

    const exec = deps.execRunner ?? defaultExecRunner(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const { stdout, exitCode, stderrTail } = await exec(spec, childEnv);
    if (exitCode !== 0) {
      return fail(`Browser Use runner exited with code ${exitCode}: ${stderrTail.slice(-500)}`);
    }

    // 3. Validate before persistence.
    let raw: unknown;
    try {
      raw = JSON.parse(stdout.trim());
    } catch {
      return fail('Browser Use runner did not return parseable JSON.');
    }
    const verdict = validateBrowserUsePilotResult(raw, resolved.subject.address);
    const persisted: PersistedBrowserUseRun = {
      dealCardId,
      propertyCardId: resolved.propertyCardId,
      result: verdict.ok ? (verdict.value as BrowserUsePilotResult) : (raw as BrowserUsePilotResult),
      schemaValid: verdict.ok,
      validationErrors: verdict.errors,
      persistedAt: new Date().toISOString(),
    };
    if (!verdict.ok) {
      // An invalid document is never merged into card evidence; record the
      // failure honestly and keep prior research untouched.
      logger.warn({ dealCardId, errors: verdict.errors }, 'browseruse result failed schema validation');
      return fail(`Result failed schema validation: ${verdict.errors.slice(0, 3).join('; ')}`);
    }
    persistBrowserUseRun(persisted);

    const done: BrowserUseRunStatus = { ...status, state: 'completed', finishedAt: new Date().toISOString(), error: null };
    activeRuns.set(dealCardId, done);
    logger.info({ dealCardId, captures: persisted.result.captures.length }, 'browseruse pilot completed');
    return { ok: true, error: null, status: done };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/** Resolve a persisted capture file inside the configured screenshot dir. */
export function resolveBrowserUseCapturePath(file: string, config = readSessionConfig()): string | null {
  if (file !== path.basename(file) || !CAPTURE_FILE_RE.test(file)) return null;
  const root = path.resolve(config.screenshotDir);
  const resolved = path.resolve(root, file);
  if (!resolved.startsWith(root + path.sep)) return null;
  return resolved;
}
