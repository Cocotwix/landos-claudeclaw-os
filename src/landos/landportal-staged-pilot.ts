// LandOS — staged hybrid LandPortal pilot (deterministic driver + local model).
//
// The original Browser Use pilot ran one long model-driven agent whose single
// final JSON emission was all-or-nothing; a quota hiccup near the end lost the
// whole run. This module splits the same workflow into eight independently
// persisted stages:
//
//   deterministic (existing Puppeteer driver, zero model calls):
//     subject page open, field extraction, screenshots, comp screen, comp rows,
//     schema validation, persistence, tab hygiene, run status
//   model (local Gemma via Ollama, or the existing Gemini provider):
//     parcel-match confirmation, parcel-shape / road-frontage / access
//     interpretation, structured-vs-visual conflicts, comp relevance,
//     final synthesis over already persisted evidence
//
// Each completed stage persists IMMEDIATELY (one card-activity row per stage);
// a later model failure never discards facts, screenshots, or comp data
// already collected. Browser Use (the python agent) remains the adaptive
// fallback path in landportal-browseruse.ts; this staged path is the default.

import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';
import { withEnvFileSecrets } from '../env.js';
import { readSessionConfig, ensureLandPortalAuthenticated, makeLiveBrowserDriver, type LandPortalReadiness } from './browser-session.js';
import type { BrowserDriver } from './browser-intelligence.js';
import { attachCardActivity, loadPropertyInspection } from './property-card.js';
import { getLandosDb } from './db.js';
import { parseLandPortalCompRows } from './comp-extraction.js';
import {
  subjectForDealCard,
  persistBrowserUseRun,
  validateBrowserUsePilotResult,
  type BrowserUseSubject,
  type BrowserUseFindings,
  type BrowserUseCompCandidate,
  type BrowserUsePilotResult,
} from './landportal-browseruse.js';

export const STAGED_ACTIVITY_KIND = 'landportal_browseruse_stage';

export const STAGE_IDS = [
  'subject_parcel',
  'property_facts',
  'imagery',
  'frontage_access',
  'comp_screen',
  'comp_rows',
  'comp_relevance',
  'synthesis',
] as const;
export type StageId = (typeof STAGE_IDS)[number];

export interface StageRecord {
  runId: string;
  stage: StageId;
  status: 'completed' | 'failed' | 'unavailable';
  provider: string;
  startedAt: string;
  finishedAt: string;
  modelCalls: number;
  /** Stage-specific payload; safe to render directly. */
  data: Record<string, unknown>;
  error: string | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Interpretation model clients (local Ollama Gemma / existing Gemini)
// ─────────────────────────────────────────────────────────────────────────

export interface ModelCallResult { text: string; json: unknown | null; ms: number }
export interface InterpretationModel {
  name: string;
  call(opts: { prompt: string; imagePaths?: string[]; schema?: object; timeoutMs?: number }): Promise<ModelCallResult>;
}

export const OLLAMA_DEFAULT_MODEL = 'gemma4:e2b';
const OLLAMA_HOST = 'http://127.0.0.1:11434';

export function makeOllamaModel(model = OLLAMA_DEFAULT_MODEL): InterpretationModel {
  return {
    name: `ollama:${model}`,
    async call({ prompt, imagePaths, schema, timeoutMs = 240_000 }) {
      const t0 = Date.now();
      const images = (imagePaths ?? []).map((p) => fs.readFileSync(p).toString('base64'));
      const body: Record<string, unknown> = {
        model,
        stream: false,
        messages: [{ role: 'user', content: prompt, ...(images.length ? { images } : {}) }],
        options: { temperature: 0.1 },
      };
      if (schema) body.format = schema;
      const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
        method: 'POST',
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const parsed = await res.json() as { message?: { content?: string } };
      const text = parsed.message?.content ?? '';
      return { text, json: schema ? safeJson(text) : null, ms: Date.now() - t0 };
    },
  };
}

export function makeGeminiModel(model = 'gemini-2.5-flash'): InterpretationModel {
  return {
    name: `gemini:${model}`,
    async call({ prompt, imagePaths, schema, timeoutMs = 120_000 }) {
      const key = (withEnvFileSecrets(['GOOGLE_API_KEY']).GOOGLE_API_KEY ?? '').trim();
      if (!key) throw new Error('GOOGLE_API_KEY not configured');
      const t0 = Date.now();
      const parts: Array<Record<string, unknown>> = [{ text: prompt }];
      for (const p of imagePaths ?? []) {
        parts.push({ inline_data: { mime_type: 'image/png', data: fs.readFileSync(p).toString('base64') } });
      }
      const body: Record<string, unknown> = { contents: [{ parts }] };
      if (schema) body.generationConfig = { responseMimeType: 'application/json', responseSchema: schema };
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const parsed = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = parsed.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      return { text, json: schema ? safeJson(text) : null, ms: Date.now() - t0 };
    },
  };
}

/**
 * Primary/fallback interpretation: try the remote provider (better visual
 * reasoning, ~4 calls per staged run fits its quota), fall back per-call to
 * the local quota-free Gemma when the primary errors. The benchmark that set
 * this default: on identical parcel imagery gemini-2.5-flash read shape,
 * frontage sides and a real structured-vs-visual conflict; gemma4:e2b returned
 * valid but shallow output. Gemma therefore stays the resilience layer, not
 * the default interpreter.
 */
export function makeResilientModel(primary: InterpretationModel, fallback: InterpretationModel): InterpretationModel {
  return {
    name: `${primary.name}+fallback:${fallback.name}`,
    async call(opts) {
      try {
        return await primary.call(opts);
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message.slice(0, 200) : String(err) }, 'primary interpretation model failed; using local fallback');
        return fallback.call(opts);
      }
    },
  };
}

function safeJson(text: string): unknown | null {
  try { return JSON.parse(text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()); } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────
// Tab hygiene — smallest necessary prevention, recorded honestly
// ─────────────────────────────────────────────────────────────────────────

/**
 * Close only EXACT duplicate page tabs (same URL), keeping one tab per URL.
 * Authenticated/profile state is untouched (it lives in the profile, not the
 * tabs); a unique tab — operator-created or otherwise — is never closed.
 */
export async function dedupeAutomationTabs(cdpUrl: string): Promise<{ before: number; after: number; closed: number }> {
  try {
    const list = await (await fetch(`${cdpUrl}/json/list`, { signal: AbortSignal.timeout(10_000) })).json() as Array<{ id: string; type: string; url: string }>;
    const pages = list.filter((t) => t.type === 'page');
    const seen = new Set<string>();
    let closed = 0;
    for (const p of pages) {
      if (seen.has(p.url)) {
        const res = await fetch(`${cdpUrl}/json/close/${p.id}`, { signal: AbortSignal.timeout(5_000) });
        if (res.ok) closed += 1;
      } else {
        seen.add(p.url);
      }
    }
    return { before: pages.length, after: pages.length - closed, closed };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'tab dedupe skipped');
    return { before: -1, after: -1, closed: 0 };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Stage persistence
// ─────────────────────────────────────────────────────────────────────────

export function persistStage(propertyCardId: number, record: StageRecord): void {
  attachCardActivity({
    cardId: propertyCardId,
    agentId: 'browseruse-staged',
    kind: STAGED_ACTIVITY_KIND,
    summary: `Stage ${record.stage}: ${record.status}${record.error ? ` — ${record.error.slice(0, 120)}` : ''}`,
    ref: JSON.stringify(record),
  });
}

/** All stage records of the NEWEST staged run for a property card. */
export function loadStagedRun(propertyCardId: number): StageRecord[] {
  const rows = getLandosDb()
    .prepare(`SELECT ref FROM landos_card_activity WHERE card_id = ? AND kind = ? ORDER BY created_at DESC, id DESC LIMIT 40`)
    .all(propertyCardId, STAGED_ACTIVITY_KIND) as Array<{ ref: string }>;
  const records: StageRecord[] = [];
  for (const row of rows) {
    try { records.push(JSON.parse(row.ref) as StageRecord); } catch { /* skip malformed */ }
  }
  const newestRunId = records[0]?.runId;
  if (!newestRunId) return [];
  // newest row per stage within the newest run, in canonical stage order
  const byStage = new Map<StageId, StageRecord>();
  for (const rec of records) {
    if (rec.runId === newestRunId && !byStage.has(rec.stage)) byStage.set(rec.stage, rec);
  }
  return STAGE_IDS.map((id) => byStage.get(id)).filter((r): r is StageRecord => !!r);
}

// ─────────────────────────────────────────────────────────────────────────
// The staged run
// ─────────────────────────────────────────────────────────────────────────

export interface StagedPilotDeps {
  ensureAuth?: () => Promise<LandPortalReadiness>;
  driver?: BrowserDriver;
  model?: InterpretationModel;
  config?: ReturnType<typeof readSessionConfig>;
  skipTabHygiene?: boolean;
  /** Stable visual keys for a repair pass. Omitting this preserves the normal
   * full package; a subset prevents overwriting accepted visual categories. */
  captureLabels?: string[];
}

export interface StagedPilotOutcome {
  ok: boolean;
  runId: string;
  stages: StageRecord[];
  error: string | null;
  modelCalls: number;
  modelMs: number;
  tabs: { start: { before: number; after: number; closed: number } | null; end: { before: number; after: number; closed: number } | null };
}

const SAFE = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'capture';

/** Copy a driver-produced screenshot into a browseruse_-named file the existing
 *  image route serves (basename pattern enforced there). */
function retainCapture(sourcePath: string | null | undefined, label: string, shotDir: string): string | null {
  if (!sourcePath) return null;
  try {
    const file = `browseruse_${SAFE(label)}-${Date.now()}.png`;
    fs.copyFileSync(sourcePath, path.join(shotDir, file));
    return file;
  } catch {
    return null;
  }
}

function numFrom(text: string | undefined): number | null {
  if (!text) return null;
  const m = text.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function fieldLookup(fields: Record<string, string>, ...names: string[]): string | null {
  const keys = Object.keys(fields);
  for (const want of names) {
    const hit = keys.find((k) => k.toLowerCase().includes(want));
    if (hit && String(fields[hit]).trim()) return String(fields[hit]).trim();
  }
  return null;
}

export async function runLandPortalStagedPilot(
  dealCardId: number,
  provider: 'ollama' | 'google' | 'auto' = 'auto',
  deps: StagedPilotDeps = {},
): Promise<StagedPilotOutcome> {
  const runId = `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const stages: StageRecord[] = [];
  let modelCalls = 0;
  let modelMs = 0;
  const outcome: StagedPilotOutcome = { ok: false, runId, stages, error: null, modelCalls: 0, modelMs: 0, tabs: { start: null, end: null } };

  const resolved = subjectForDealCard(dealCardId);
  if (!resolved) { outcome.error = 'Deal card has no subject property with an address.'; return outcome; }
  const { propertyCardId, subject } = resolved;
  const config = deps.config ?? readSessionConfig();
  const model = deps.model ?? (
    provider === 'google' ? makeGeminiModel()
    : provider === 'ollama' ? makeOllamaModel()
    : makeResilientModel(makeGeminiModel(), makeOllamaModel())
  );

  const stage = async (
    id: StageId,
    fn: () => Promise<{ status?: StageRecord['status']; data: Record<string, unknown>; calls?: number }>,
  ): Promise<StageRecord> => {
    const startedAt = new Date().toISOString();
    let rec: StageRecord;
    try {
      const out = await fn();
      rec = { runId, stage: id, status: out.status ?? 'completed', provider: model.name, startedAt, finishedAt: new Date().toISOString(), modelCalls: out.calls ?? 0, data: out.data, error: null };
    } catch (err) {
      rec = { runId, stage: id, status: 'failed', provider: model.name, startedAt, finishedAt: new Date().toISOString(), modelCalls: 0, data: {}, error: err instanceof Error ? err.message.slice(0, 400) : String(err) };
    }
    persistStage(propertyCardId, rec);
    stages.push(rec);
    return rec;
  };

  const timed = async (opts: Parameters<InterpretationModel['call']>[0]) => {
    const res = await model.call(opts);
    modelCalls += 1;
    modelMs += res.ms;
    return res;
  };

  if (!deps.skipTabHygiene) outcome.tabs.start = await dedupeAutomationTabs(config.cdpUrl);

  // Session + deterministic one-pass capture power stages 1–3 and 5–6.
  const ensureAuth = deps.ensureAuth ?? (() => ensureLandPortalAuthenticated());
  const readiness = await ensureAuth();
  if (!readiness.authenticated) {
    outcome.error = `LandPortal session not authenticated (phase: ${readiness.phase}).`;
    return outcome;
  }
  const parcelUrl = loadPropertyInspection(propertyCardId)?.parcelUrl ?? null;
  if (!parcelUrl || !parcelUrl.startsWith('https://landportal.com/')) {
    outcome.error = 'No deterministic LandPortal parcel URL is available for this card (run the standard research first).';
    return outcome;
  }
  const driver = deps.driver ?? makeLiveBrowserDriver(`browseruse_staged_${dealCardId}`);
  if (!driver.captureLandPortalVisuals) { outcome.error = 'Live driver does not support LandPortal capture.'; return outcome; }

  const scope = driver.beginOwnedPageScope ? await driver.beginOwnedPageScope() : null;
  try {
    // The heavy LandPortal SPA can outlast the driver's fixed readiness wait on
    // a cold lane page; a later attempt hits the already-booted page. Retry the
    // one-pass capture (read-only) instead of failing the whole run on boot lag.
    let cap = await driver.captureLandPortalVisuals(parcelUrl, { timeoutMs: 180_000, captureLabels: deps.captureLabels });
    for (let attempt = 0; attempt < 2 && !Object.keys(cap.fields).length && !cap.parcelShotPath; attempt++) {
      await new Promise((r) => setTimeout(r, 15_000));
      cap = await driver.captureLandPortalVisuals(parcelUrl, { timeoutMs: 180_000, captureLabels: deps.captureLabels });
    }
    const shotDir = config.screenshotDir;

    // ── Stage 1: confirm the subject parcel ────────────────────────────────
    const CONFIRM_SCHEMA = {
      type: 'object',
      properties: { match: { type: 'string', enum: ['confirmed', 'likely', 'uncertain', 'not_found'] }, reasoning: { type: 'string' } },
      required: ['match', 'reasoning'],
    };
    const factsShot = retainCapture(cap.parcelShotPath, 'subject_confirm', shotDir);
    const s1 = await stage('subject_parcel', async () => {
      if (!Object.keys(cap.fields).length && !cap.parcelShotPath) {
        return { status: 'failed', data: { reason: 'parcel page produced no fields and no screenshot' } };
      }
      const lpAddress = fieldLookup(cap.fields, 'address', 'situs');
      const lpCounty = fieldLookup(cap.fields, 'county');
      const lpApn = fieldLookup(cap.fields, 'apn', 'parcel number', 'parcel id');
      // Deterministic checks first: county must agree when both sides are known.
      const countyOk = !subject.county || !lpCounty || lpCounty.toLowerCase().includes(subject.county.toLowerCase());
      let match: string = countyOk ? 'likely' : 'uncertain';
      let reasoning = `Deterministic: parcel page from the resolved inspection URL; county ${lpCounty ?? 'not shown'} vs subject ${subject.county ?? 'unknown'}.`;
      let calls = 0;
      if (cap.parcelShotPath) {
        const res = await timed({
          prompt: `You are verifying a land parcel page. Subject property: ${subject.address}, ${subject.city ?? ''} ${subject.state ?? ''}, ${subject.county ?? 'unknown'} county. The screenshot shows the LandPortal parcel view (facts sidebar + outlined parcel). Structured fields read from the page: ${JSON.stringify({ address: lpAddress, county: lpCounty, apn: lpApn })}. Does the displayed parcel plausibly correspond to the subject? Respond with JSON {match, reasoning}. Use 'confirmed' only when address/county agree; 'not_found' if the page clearly shows a different property.`,
          imagePaths: [cap.parcelShotPath],
          schema: CONFIRM_SCHEMA,
        });
        calls = 1;
        const j = res.json as { match?: string; reasoning?: string } | null;
        if (j?.match && ['confirmed', 'likely', 'uncertain', 'not_found'].includes(j.match)) {
          match = j.match;
          reasoning = `${reasoning} Model: ${j.reasoning ?? ''}`.slice(0, 600);
        }
      }
      return { data: { match, reasoning, lpAddress, lpCounty, lpApn, parcelUrl, capturedAtIso: cap.capturedAtIso, confirmShot: factsShot }, calls };
    });

    // ── Stage 2: structured property facts (deterministic) ─────────────────
    await stage('property_facts', async () => {
      // Acreage: prefer the first acreage-named field with a POSITIVE value —
      // LandPortal panels carry several zero-valued acreage-adjacent metrics.
      let acreage: number | null = null;
      for (const name of ['deeded acre', 'acres', 'acre', 'lot size']) {
        for (const [k, v] of Object.entries(cap.fields)) {
          if (!k.toLowerCase().includes(name)) continue;
          const n = numFrom(String(v));
          if (n && n > 0) { acreage = n; break; }
        }
        if (acreage) break;
      }
      // Coordinates must actually look like a lat,lon pair.
      const coordRaw = fieldLookup(cap.fields, 'coordinate', 'latitude', 'lat/lon');
      const coordinates = coordRaw && /-?\d{1,3}\.\d+.*-?\d{1,3}\.\d+/.test(coordRaw) ? coordRaw : null;
      const facts = {
        address: fieldLookup(cap.fields, 'address', 'situs'),
        apn: fieldLookup(cap.fields, 'apn', 'parcel number', 'parcel id'),
        county: fieldLookup(cap.fields, 'county'),
        state: fieldLookup(cap.fields, 'state') ?? subject.state,
        acreage,
        owner: fieldLookup(cap.fields, 'owner'),
        coordinates,
        propertyType: fieldLookup(cap.fields, 'property type', 'land use', 'type'),
        roads: fieldLookup(cap.fields, 'road frontage', 'road'),
        fieldCount: Object.keys(cap.fields).length,
        rawFields: cap.fields,
      };
      if (!facts.fieldCount) return { status: 'unavailable', data: { reason: 'no visible fields extracted' } };
      return { data: facts as unknown as Record<string, unknown> };
    });

    // ── Stage 3: imagery (deterministic; zoom variants best-effort) ────────
    const s3 = await stage('imagery', async () => {
      // Each output from the live driver was framed after its own map-mode and
      // fit baseline. Do not create follow-on screenshots here: the capture
      // page can already be on the comps surface, and inherited state is the
      // source of the cropped visual replacements this task corrects.
      const rawCaptures = cap.visualShots?.length
        ? cap.visualShots
        : cap.parcelShotPath
          ? [{ label: 'clean_parcel_aerial', path: cap.parcelShotPath, kind: 'parcel_page' as const, purpose: 'LandPortal parcel context' }]
          : [];
      const captures = rawCaptures.map((capture) => {
        const file = retainCapture(capture.path, capture.label, shotDir);
        return file ? { ...capture, file } : null;
      }).filter((capture): capture is NonNullable<typeof capture> => !!capture);
      const byLabel = (label: string) => captures.find((capture) => capture.label === label)?.file ?? null;
      const soil = captures.find((capture) => capture.label === 'soil_overlay');
      const overlayResults = captures
        .filter((capture) => capture.kind === 'overlay')
        .map((capture) => ({ overlay: capture.overlay ?? capture.label, label: capture.label, file: capture.file }));
      const missing = (deps.captureLabels ?? ['clean_parcel_aerial', 'close_parcel_aerial', 'wider_context'])
        .filter((label) => !byLabel(label));
      return {
        status: captures.length ? 'completed' : 'failed',
        data: {
          captures,
          cleanAerial: byLabel('clean_parcel_aerial'),
          closeup: byLabel('close_parcel_aerial'),
          wider: byLabel('wider_context'),
          overlayResults,
          soilDetails: soil?.soilDetails ?? [],
          missing,
        },
      };
      {
      const cleanAerial = retainCapture(cap.parcelShotPath, 'clean_parcel_aerial', shotDir);
      let closeup: string | null = null;
      let wider: string | null = null;
      const zoom = async (selector: string, label: string, clicks: number) => {
        try {
          const outcome = await driver.evaluate?.(
            `(() => { const b = document.querySelector('${selector}'); if (!b) return 'absent'; for (let i = 0; i < ${clicks}; i++) b.click(); return 'clicked'; })()`,
            { timeoutMs: 10_000 },
          );
          if (outcome !== 'clicked') return null; // control absent — recorded as missing, no wait
          await new Promise((r) => setTimeout(r, 2_500));
          const shot = await driver.screenshot(`browseruse_${label}`, { timeoutMs: 30_000 });
          return retainCapture(shot?.path, label, shotDir);
        } catch { return null; }
      };
      const ZOOM_IN = ['.mapboxgl-ctrl-zoom-in', '.leaflet-control-zoom-in', 'button[aria-label*="oom in" i]'];
      const ZOOM_OUT = ['.mapboxgl-ctrl-zoom-out', '.leaflet-control-zoom-out', 'button[aria-label*="oom out" i]'];
      for (const sel of ZOOM_IN) { closeup = await zoom(sel, 'parcel_closeup', 2); if (closeup) break; }
      for (const sel of ZOOM_OUT) { wider = await zoom(sel, 'wider_context', 5); if (wider) break; }
      const missing = [!cleanAerial && 'clean_parcel_aerial', !closeup && 'parcel_closeup', !wider && 'wider_context'].filter(Boolean);
      return {
        status: cleanAerial ? 'completed' : 'failed',
        data: { cleanAerial, closeup, wider, missing },
      };
      }
    });

    // ── Stage 4: frontage / access / conflicts (model vision) ──────────────
    const VISION_SCHEMA = {
      type: 'object',
      properties: {
        parcel_shape: { type: 'string' },
        apparent_road_frontage: { type: 'string' },
        apparent_access: { type: 'string' },
        surroundings: { type: 'string' },
        conflicts: {
          type: 'array',
          items: {
            type: 'object',
            properties: { structured_field: { type: 'string' }, structured_value: { type: 'string' }, visual_observation: { type: 'string' }, explanation: { type: 'string' } },
            required: ['structured_field', 'structured_value', 'visual_observation', 'explanation'],
          },
        },
      },
      required: ['parcel_shape', 'apparent_road_frontage', 'apparent_access', 'surroundings', 'conflicts'],
    };
    await stage('frontage_access', async () => {
      const imgs: string[] = [];
      const d3 = s3.data as { cleanAerial?: string | null; wider?: string | null; captures?: unknown[] };
      for (const f of [d3.cleanAerial, d3.wider]) if (f) imgs.push(path.join(shotDir, f));
      if (!imgs.length) return { status: 'unavailable', data: { reason: 'no imagery captured to interpret' } };
      const factsRow = stages.find((s) => s.stage === 'property_facts')?.data ?? {};
      const res = await timed({
        prompt: `These are aerial views of one land parcel outlined in red (subject: ${subject.address}, ${subject.county ?? ''} county ${subject.state ?? ''}). Structured facts extracted from the page: ${JSON.stringify(factsRow).slice(0, 1200)}. Describe, using the exact term "road frontage": the parcel shape, the apparent road frontage (which side(s), roughly how much), the apparent access point or access neck, and the surroundings. If any structured field contradicts what the imagery shows, list it in conflicts (preserve both sides); otherwise conflicts is []. Respond with JSON only.`,
        imagePaths: imgs,
        schema: VISION_SCHEMA,
      });
      const j = res.json as Record<string, unknown> | null;
      if (!j || typeof j.parcel_shape !== 'string') return { status: 'failed', data: { reason: 'model returned no parseable interpretation', raw: res.text.slice(0, 300) }, calls: 1 };
      return { data: j, calls: 1 };
    });

    // ── Stage 5: comp screen (deterministic; already captured in one pass) ──
    await stage('comp_screen', async () => {
      const compShot = retainCapture(cap.compsMapShotPath, 'comp_map', shotDir);
      if (!cap.mapReached && !compShot && !cap.compRows.length) {
        return { status: 'unavailable', data: { reason: 'comp screen was not reachable in this pass' } };
      }
      return { data: { compShot, mapReached: cap.mapReached, rowCount: cap.compRows.length } };
    });

    // ── Stage 6: comp rows (deterministic parse) ───────────────────────────
    const factsAcreage = (stages.find((s) => s.stage === 'property_facts')?.data as { acreage?: number | null } | undefined)?.acreage ?? null;
    const s6 = await stage('comp_rows', async () => {
      const parsed = parseLandPortalCompRows(cap.compRows, factsAcreage);
      const candidates: BrowserUseCompCandidate[] = parsed.map((c) => ({
        address: c.address,
        distance: null, // LandPortal's visible rows carry no distance; recorded honestly
        sale_date: c.date,
        sale_price: c.price ? `$${c.price.toLocaleString('en-US')}` : null,
        acreage: c.acres,
        price_per_acre: c.pricePerAcre ? `$${Math.round(c.pricePerAcre).toLocaleString('en-US')}` : null,
        property_type: null,
        source_context: `LandPortal visible similar-sales rows (status: ${c.status})`,
        relevance: 'pending relevance judgment',
      }));
      return { status: candidates.length ? 'completed' : 'unavailable', data: { candidates, rawRowCount: cap.compRows.length } };
    });

    // ── Stage 7: comp relevance (model judgment) ───────────────────────────
    const RELEVANCE_SCHEMA = {
      type: 'object',
      properties: {
        judgments: {
          type: 'array',
          items: {
            type: 'object',
            properties: { index: { type: 'integer' }, relevant: { type: 'boolean' }, reason: { type: 'string' } },
            required: ['index', 'relevant', 'reason'],
          },
        },
      },
      required: ['judgments'],
    };
    const s7 = await stage('comp_relevance', async () => {
      const candidates = ((s6.data as { candidates?: BrowserUseCompCandidate[] }).candidates ?? []);
      if (!candidates.length) return { status: 'unavailable', data: { reason: 'no comp candidates to judge' } };
      const res = await timed({
        prompt: `Subject: ${subject.address}, ${subject.county ?? ''} county ${subject.state ?? ''}, ${factsAcreage ?? 'unknown'} acres of land. Judge each visible LandPortal comp for relevance to valuing the subject (acreage band similarity, land vs improved, recency). Comps: ${JSON.stringify(candidates.map((c, i) => ({ index: i, address: c.address, sale_date: c.sale_date, sale_price: c.sale_price, acreage: c.acreage })))}. Respond with JSON {judgments:[{index, relevant, reason}]}.`,
        schema: RELEVANCE_SCHEMA,
      });
      const j = res.json as { judgments?: Array<{ index: number; relevant: boolean; reason: string }> } | null;
      if (!j?.judgments?.length) return { status: 'failed', data: { reason: 'model returned no judgments', raw: res.text.slice(0, 300) }, calls: 1 };
      const judged = candidates.map((c, i) => {
        const v = j.judgments!.find((x) => x.index === i);
        return { ...c, relevance: v ? `${v.relevant ? 'Relevant' : 'Not relevant'}: ${v.reason}` : 'No judgment returned for this comp' };
      });
      return { data: { candidates: judged }, calls: 1 };
    });

    // ── Stage 8: synthesis from persisted evidence ─────────────────────────
    await stage('synthesis', async () => {
      const d1 = stages.find((s) => s.stage === 'subject_parcel')?.data as Record<string, unknown>;
      const d2 = stages.find((s) => s.stage === 'property_facts')?.data as Record<string, unknown>;
      const d3 = s3.data as { cleanAerial?: string | null; closeup?: string | null; wider?: string | null; captures?: unknown[] };
      const d4 = stages.find((s) => s.stage === 'frontage_access')?.data as Record<string, unknown>;
      const d5 = stages.find((s) => s.stage === 'comp_screen')?.data as Record<string, unknown>;
      const judgedCandidates = ((s7.data as { candidates?: BrowserUseCompCandidate[] }).candidates
        ?? (s6.data as { candidates?: BrowserUseCompCandidate[] }).candidates ?? []);

      const CONF_SCHEMA = { type: 'object', properties: { confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, reasoning: { type: 'string' } }, required: ['confidence', 'reasoning'] };
      let confidence = 'low';
      let confReason = 'Synthesis model unavailable; confidence defaulted conservatively.';
      let calls = 0;
      try {
        const res = await timed({
          prompt: `Rate overall confidence (high/medium/low) in this staged LandPortal research result and give one-sentence reasoning. Stage statuses: ${JSON.stringify(stages.map((s) => ({ stage: s.stage, status: s.status })))}. Parcel match: ${String(d1?.match)}. Facts extracted: ${Object.keys(d2 ?? {}).length > 2}. Imagery: ${!!d3.cleanAerial}. Comps judged: ${judgedCandidates.length}. Respond JSON {confidence, reasoning}.`,
          schema: CONF_SCHEMA,
        });
        calls = 1;
        const j = res.json as { confidence?: string; reasoning?: string } | null;
        if (j?.confidence) { confidence = j.confidence; confReason = j.reasoning ?? confReason; }
      } catch { /* keep conservative default */ }

      const unavailable: string[] = [];
      for (const [k, v] of Object.entries({ acreage: d2?.acreage, owner: d2?.owner, coordinates: d2?.coordinates, property_type: d2?.propertyType })) {
        if (v === null || v === undefined) unavailable.push(k);
      }
      const findings: BrowserUseFindings = {
        subject_identity: {
          address_queried: subject.address,
          landportal_address: (d2?.address as string | null) ?? (d1?.lpAddress as string | null) ?? null,
          apn: (d2?.apn as string | null) ?? (d1?.lpApn as string | null) ?? null,
          county: (d2?.county as string | null) ?? null,
          state: (d2?.state as string | null) ?? null,
          parcel_match: (d1?.match as BrowserUseFindings['subject_identity']['parcel_match']) ?? 'uncertain',
          match_reasoning: (d1?.reasoning as string) ?? 'No confirmation stage data.',
        },
        property_facts: {
          acreage: (d2?.acreage as number | null) ?? null,
          owner_shown: (d2?.owner as string | null) ?? null,
          coordinates: (d2?.coordinates as string | null) ?? null,
          property_type: (d2?.propertyType as string | null) ?? null,
          roads_serving: d2?.roads ? [String(d2.roads)] : [],
          other_characteristics: [],
          unavailable_fields: unavailable,
        },
        visual_observations: {
          parcel_shape: (d4?.parcel_shape as string | null) ?? null,
          apparent_road_frontage: (d4?.apparent_road_frontage as string | null) ?? null,
          apparent_access: (d4?.apparent_access as string | null) ?? null,
          surroundings: (d4?.surroundings as string | null) ?? null,
          notes: [],
        },
        conflicts: (d4?.conflicts as BrowserUseFindings['conflicts']) ?? [],
        comp_attempt: {
          attempted: (d5 && (d5 as { mapReached?: boolean }).mapReached !== undefined) || judgedCandidates.length > 0,
          outcome: judgedCandidates.length
            ? `Visible similar-sales rows read deterministically and judged for relevance (${judgedCandidates.length} candidate(s)).`
            : `Comp screen ${String((d5 as { reason?: string } | undefined)?.reason ?? 'reached; no usable visible row parsed')}.`,
          candidates: judgedCandidates,
        },
        failed_actions: stages.filter((s) => s.status === 'failed').map((s) => ({ action: `stage:${s.stage}`, reason: s.error ?? 'failed' })),
        auth_required: false,
        paid_feature_encountered: null,
        confidence,
        confidence_reasoning: confReason,
      };

      const retainedVisuals = Array.isArray(d3.captures)
        ? d3.captures.filter((capture): capture is { label: string; file: string } => !!capture && typeof capture === 'object' && typeof (capture as { label?: unknown }).label === 'string' && typeof (capture as { file?: unknown }).file === 'string')
        : [];
      const captures = [
        ...retainedVisuals.map((capture) => ({ label: capture.label, file: capture.file, pageUrl: parcelUrl, capturedAt: cap.capturedAtIso })),
        !retainedVisuals.length && d3.cleanAerial && { label: 'clean_parcel_aerial', file: d3.cleanAerial, pageUrl: parcelUrl, capturedAt: cap.capturedAtIso },
        !retainedVisuals.length && d3.closeup && { label: 'close_parcel_aerial', file: d3.closeup, pageUrl: parcelUrl, capturedAt: cap.capturedAtIso },
        !retainedVisuals.length && d3.wider && { label: 'wider_context', file: d3.wider, pageUrl: parcelUrl, capturedAt: cap.capturedAtIso },
        (d5 as { compShot?: string | null } | undefined)?.compShot && { label: 'comp_map', file: (d5 as { compShot?: string | null }).compShot, pageUrl: parcelUrl, capturedAt: cap.capturedAtIso },
        (d1?.confirmShot as string | null) && { label: 'subject_confirm', file: d1.confirmShot as string, pageUrl: parcelUrl, capturedAt: cap.capturedAtIso },
      ].filter(Boolean) as BrowserUsePilotResult['captures'];

      const result: BrowserUsePilotResult = {
        runner: 'browser-use',
        runnerVersion: `staged-hybrid/${model.name}`,
        startedAt: stages[0]?.startedAt ?? new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        subject,
        findings,
        captures,
        agentErrors: stages.filter((s) => s.status === 'failed').map((s) => `stage ${s.stage}: ${s.error}`),
        urlsVisited: ['https://landportal.com'],
        complete: true,
      };
      const verdict = validateBrowserUsePilotResult(result, subject.address);
      if (!verdict.ok) return { status: 'failed', data: { reason: 'synthesis failed schema validation', errors: verdict.errors.slice(0, 5) }, calls };
      persistBrowserUseRun({ dealCardId, propertyCardId, result, schemaValid: true, validationErrors: [], persistedAt: new Date().toISOString() });
      return { data: { persisted: true, captures: captures.length, compCandidates: judgedCandidates.length, confidence }, calls };
    });

    outcome.ok = stages.every((s) => s.status !== 'failed') || stages.find((s) => s.stage === 'synthesis')?.status === 'completed';
  } catch (err) {
    outcome.error = err instanceof Error ? err.message : String(err);
  } finally {
    if (scope && driver.closeOwnedPageScope) { try { await driver.closeOwnedPageScope(scope); } catch { /* logged by driver */ } }
    if (!deps.skipTabHygiene) outcome.tabs.end = await dedupeAutomationTabs(config.cdpUrl);
  }
  outcome.modelCalls = modelCalls;
  outcome.modelMs = modelMs;
  logger.info({ dealCardId, runId, modelCalls, ok: outcome.ok }, 'staged browseruse pilot finished');
  return outcome;
}
