// Browser Training Department — core logic.
//
// Session lifecycle helpers, the LandOS training persona, usage/cost accounting,
// and end-of-session synthesis of (a) a reusable Browser Playbook and (b) org
// knowledge, from the recorded transcript + browser events.
//
// The realtime transport lives in browser-training-live.ts; this file is the
// deterministic brain around it and is fully unit-testable.

import { generateContent, parseJsonResponse } from '../gemini.js';
import { landosAudit } from './db.js';
import {
  addTrainingUsage,
  appendTrainingEvent,
  createTrainingSession,
  getTrainingSession,
  listFieldBindings,
  listKnowledge,
  listLatestPlaybooks,
  listTrainingEvents,
  listTrainingSessions,
  saveDraftPlaybook,
  saveKnowledgeItem,
  updateTrainingSessionStatus,
  upsertFieldBinding,
  type KnowledgeCategory,
  type TrainingEvent,
  type TrainingKnowledge,
  type TrainingPlaybook,
  type TrainingSession,
  type TrainingSurface,
} from './browser-training-db.js';
import { redactInputValue, redactSecrets, screenPaidAction, screenPaidUrl } from './training-security.js';
import {
  FIELD_ALIASES, FIELD_LABELS, bestSelector, matchFieldPhrase, probeElementScript, labelSearchScript,
  type CanonicalField, type DomElementInfo, type FieldSelectorEntry,
} from './field-binding.js';
import type { PageLike } from './browser-session.js';

// Native-audio Live model. Swap here only — nothing else names the provider.
export const GEMINI_LIVE_MODEL = 'gemini-2.5-flash-preview-native-audio-dialog';
export const GEMINI_LIVE_FALLBACK_MODEL = 'gemini-2.0-flash-live-001';
export const SYNTHESIS_MODEL = 'gemini-2.0-flash';

// Published-rate estimates (USD per 1M tokens) for the Live API. Used only for
// the *estimated* cost display; there are no hard caps. Update if rates change.
export const GEMINI_LIVE_RATES = {
  audioInPerM: 3.0,
  audioOutPerM: 12.0,
  videoInPerM: 3.0,
  textInPerM: 0.5,
  textOutPerM: 2.0,
} as const;

export interface LiveUsageDelta {
  audioIn?: number;
  audioOut?: number;
  video?: number;
  textIn?: number;
  textOut?: number;
}

/** Estimate incremental USD cost for a usage delta. */
export function estimateLiveCost(u: LiveUsageDelta): number {
  const m = 1_000_000;
  return (
    ((u.audioIn ?? 0) * GEMINI_LIVE_RATES.audioInPerM) / m +
    ((u.audioOut ?? 0) * GEMINI_LIVE_RATES.audioOutPerM) / m +
    ((u.video ?? 0) * GEMINI_LIVE_RATES.videoInPerM) / m +
    ((u.textIn ?? 0) * GEMINI_LIVE_RATES.textInPerM) / m +
    ((u.textOut ?? 0) * GEMINI_LIVE_RATES.textOutPerM) / m
  );
}

/** Record usage + cost onto a session in one call. */
export function recordUsage(sessionId: number, u: LiveUsageDelta): void {
  addTrainingUsage(sessionId, {
    audioIn: u.audioIn,
    audioOut: u.audioOut,
    video: u.video,
    text: (u.textIn ?? 0) + (u.textOut ?? 0),
    costUsd: estimateLiveCost(u),
  });
}

// ── LandOS training persona ──────────────────────────────────────────

/**
 * System instruction for the realtime model. Defines how LandOS behaves while
 * being trained: proactive, plain-spoken, safety-first, never buys anything.
 * Credentials are NEVER included here — the model never sees secrets.
 */
export function trainingSystemInstruction(opts: { website?: string; title?: string } = {}): string {
  const site = opts.website || 'the website being demonstrated';
  return [
    "You are LandOS, Tyler's browser-automation trainee. Tyler is sharing his screen and",
    'talking you through a browser workflow the way he would train a new employee. Watch the',
    'screen, listen, and hold a natural two-way voice conversation.',
    '',
    'How to behave:',
    '- Talk like a grounded, competent colleague. Short, direct sentences. No filler, no',
    '  "certainly", no over-apologising, no em dashes.',
    '- Narrate what you notice: "I think this is the parcel.", "That looks like the road',
    '  frontage field.", "I have seen this layout before."',
    '- Ask a clarifying question when a step is ambiguous, but only when it genuinely matters.',
    '- Confirm understanding of each step so Tyler knows you got it.',
    '- Point out likely mistakes, website changes, and better ways to do a step.',
    '- When you learn a reusable rule, say so: "I learned a new extraction rule."',
    '',
    'Hard safety rules (never break):',
    `- You are learning ${site}. Allowed actions only: login, search, parcel/record selection,`,
    '  map search, reading visible data, screenshots, and writing data into Deal Cards.',
    '- NEVER buy reports, comps, or sold data; never skip-trace, checkout, subscribe, or touch',
    '  billing, payment, or account-settings pages. If Tyler heads toward any paid or checkout',
    '  action, stop and say clearly that it looks like a paid action, and that you are marking',
    '  this Approval Required and not doing it.',
    '- Never read or repeat passwords, API keys, tokens, cookies, or .env values, even if they',
    '  appear on screen. Treat them as invisible.',
    '',
    'At the end you will help turn this demonstration into a reusable playbook, so keep track of',
    'the workflow name, each concrete step, which fields to extract, decision points, and any',
    'business rules Tyler states out loud.',
    opts.title ? `\nThis session: ${opts.title}.` : '',
  ].join('\n');
}

// ── Session lifecycle ────────────────────────────────────────────────

export function startSession(input: {
  title?: string;
  website?: string;
  surface?: TrainingSurface;
  dealCardId?: number | null;
}): TrainingSession {
  const session = createTrainingSession({
    title: input.title,
    website: input.website,
    surface: input.surface,
    provider: 'gemini',
    model: GEMINI_LIVE_MODEL,
    dealCardId: input.dealCardId ?? null,
  });
  appendTrainingEvent({
    sessionId: session.id,
    kind: 'system',
    text: `Training session started (${session.surface} share, ${session.website || 'no site set'}).`,
  });
  landosAudit('browser-training', 'training_session_start', `session ${session.id} ${session.website}`, {
    refTable: 'landos_training_session',
    refId: session.id,
  });
  return session;
}

export function endSession(sessionId: number, status: 'ended' | 'aborted' = 'ended'): void {
  updateTrainingSessionStatus(sessionId, status);
  appendTrainingEvent({ sessionId, kind: 'system', text: `Session ${status}.` });
  landosAudit('browser-training', 'training_session_end', `session ${sessionId} ${status}`, {
    refTable: 'landos_training_session',
    refId: sessionId,
  });
}

/**
 * Record a browser event with the security guard applied. Returns whether the
 * session must stop for approval. Never throws — a guard trip is a normal,
 * expected outcome that pauses the session.
 */
export function recordBrowserEvent(input: {
  sessionId: number;
  kind: 'nav' | 'click' | 'input' | 'screenshot';
  url?: string;
  selector?: string;
  controlText?: string;
  field?: { name?: string; type?: string; value?: string };
  meta?: Record<string, unknown>;
}): { stored: TrainingEvent; approvalRequired: boolean; reason: string } {
  // Guard: paid URL or paid action → stop.
  const urlVerdict = input.url ? screenPaidUrl(input.url) : { approvalRequired: false, reason: '' };
  const actVerdict = input.controlText
    ? screenPaidAction(input.controlText)
    : { approvalRequired: false, reason: '' };
  const approvalRequired = urlVerdict.approvalRequired || actVerdict.approvalRequired;
  const reason = urlVerdict.reason || actVerdict.reason;

  if (approvalRequired) {
    const blocked = appendTrainingEvent({
      sessionId: input.sessionId,
      kind: 'guard_block',
      url: input.url ?? '',
      selector: input.selector ?? '',
      text: reason,
      meta: { ...input.meta, controlText: input.controlText },
    });
    updateTrainingSessionStatus(input.sessionId, 'paused', { approvalRequired: true });
    landosAudit('browser-training', 'training_guard_block', reason, {
      refTable: 'landos_training_session',
      refId: input.sessionId,
      blocked: true,
    });
    return { stored: blocked, approvalRequired: true, reason };
  }

  // Redact form input values before storage.
  let text = redactSecrets(input.controlText || '').text;
  if (input.kind === 'input' && input.field) {
    text = redactInputValue(input.field).value;
  }

  const stored = appendTrainingEvent({
    sessionId: input.sessionId,
    kind: input.kind,
    url: input.url ?? '',
    selector: input.selector ?? '',
    text,
    meta: input.meta,
  });
  return { stored, approvalRequired: false, reason: '' };
}

/** Record a transcript turn (operator or AI), scrubbed for secrets. */
export function recordSpeech(sessionId: number, role: 'operator' | 'ai', text: string): TrainingEvent {
  const clean = redactSecrets(text).text;
  return appendTrainingEvent({
    sessionId,
    kind: role === 'operator' ? 'operator_speech' : 'ai_speech',
    role,
    text: clean,
  });
}

// ── Field-selector capture ───────────────────────────────────────────

export interface CaptureResult {
  field: CanonicalField;
  entry: FieldSelectorEntry;
  sampleValue: string;
}

/**
 * Bind a named field to a DOM element. Resolution order for the target element:
 *   1. an explicit clicked selector (probed live for id/testid/label/value),
 *   2. a live label search using the field's aliases,
 *   3. label-only (no page) — still usable via runtime label matching.
 * Stores the binding (latest per field wins). Read-only; never mutates the page.
 */
export async function captureFieldBinding(
  sessionId: number,
  opts: { field?: CanonicalField; phrase?: string; page?: PageLike | null; clickSelector?: string },
): Promise<CaptureResult | null> {
  const field = opts.field ?? matchFieldPhrase(opts.phrase ?? '')?.field ?? null;
  if (!field) return null;

  let info: DomElementInfo = {};
  const page = opts.page ?? null;
  try {
    if (page && opts.clickSelector) {
      info = await probeDom(page, probeElementScript(opts.clickSelector));
    } else if (page) {
      info = await probeDom(page, labelSearchScript(FIELD_ALIASES[field]));
    }
  } catch {
    info = {};
  }

  const entry = bestSelector(info, FIELD_LABELS[field]) ?? {
    selector: '', label: FIELD_LABELS[field], confidence: 'low' as const, strategy: 'label' as const,
  };
  const sampleValue = redactSecrets(info.text ?? '').text;

  upsertFieldBinding({
    sessionId,
    field,
    selector: entry.selector,
    label: entry.label || FIELD_LABELS[field],
    sampleValue,
    confidence: entry.confidence,
    strategy: entry.strategy,
  });

  appendTrainingEvent({
    sessionId,
    kind: 'system',
    text: `Bound field "${field}" → ${entry.selector || `label:"${entry.label}"`} (${entry.confidence}/${entry.strategy}).`,
    meta: { fieldBinding: { field, selector: entry.selector, label: entry.label, confidence: entry.confidence, strategy: entry.strategy } },
  });
  landosAudit('browser-training', 'training_field_bound', `session ${sessionId}: ${field} (${entry.confidence})`, {
    refTable: 'landos_training_field_binding', refId: sessionId,
  });

  return { field, entry, sampleValue };
}

async function probeDom(page: PageLike, script: string): Promise<DomElementInfo> {
  const raw = await page.evaluate<string>(script);
  if (!raw || typeof raw !== 'string') return {};
  try { return JSON.parse(raw) as DomElementInfo; } catch { return {}; }
}

/** Build the playbook fieldSelectors map from a session's captured bindings. */
export function fieldSelectorsFromBindings(sessionId: number): Record<string, FieldSelectorEntry> {
  const out: Record<string, FieldSelectorEntry> = {};
  for (const b of listFieldBindings(sessionId)) {
    out[b.field] = {
      selector: b.selector,
      label: b.label,
      confidence: (b.confidence as FieldSelectorEntry['confidence']) || 'low',
      strategy: (b.strategy as FieldSelectorEntry['strategy']) || 'label',
    };
  }
  return out;
}

// ── Playbook synthesis ───────────────────────────────────────────────

export const PLAYBOOK_FIELDS = [
  'workflowName',
  'website',
  'purpose',
  'steps',
  'fieldsToExtract',
  'screenshotsRequired',
  'decisionPoints',
  'businessRules',
  'operatorPreferences',
  'exceptions',
  'commonMistakes',
  'neverDo',
  'paidActionBlockers',
  'failureHandling',
  'qaChecklist',
  'expectedOutputs',
] as const;

export interface SynthesizedPlaybook {
  workflowName: string;
  website: string;
  purpose: string;
  steps: { action: string; selector?: string; url?: string; note?: string }[];
  fieldsToExtract: string[];
  screenshotsRequired: string[];
  decisionPoints: string[];
  businessRules: string[];
  operatorPreferences: string[];
  exceptions: string[];
  commonMistakes: string[];
  neverDo: string[];
  paidActionBlockers: string[];
  failureHandling: string[];
  qaChecklist: string[];
  expectedOutputs: string[];
}

/** Render the recorded events as a compact transcript for the LLM. */
export function buildTranscript(events: TrainingEvent[]): string {
  return events
    .map((e) => {
      switch (e.kind) {
        case 'operator_speech':
          return `TYLER: ${e.text}`;
        case 'ai_speech':
          return `LANDOS: ${e.text}`;
        case 'nav':
          return `[nav] ${e.url}`;
        case 'click':
          return `[click] ${e.selector || e.text}`.trim();
        case 'input':
          return `[input] ${e.selector} = ${e.text}`.trim();
        case 'screenshot':
          return `[screenshot] ${e.text || e.url}`.trim();
        case 'guard_block':
          return `[BLOCKED - approval required] ${e.text}`;
        default:
          return `[note] ${e.text}`;
      }
    })
    .join('\n');
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'workflow'
  );
}

/**
 * Deterministic fallback synthesis. Produces a usable, honest draft from the
 * captured events alone (no model). Used when the LLM is unavailable/disabled,
 * and as the shape the LLM output is validated into.
 */
export function synthesizeFromEventsDeterministic(session: TrainingSession, events: TrainingEvent[]): SynthesizedPlaybook {
  const steps = events
    .filter((e) => e.kind === 'nav' || e.kind === 'click' || e.kind === 'input' || e.kind === 'screenshot')
    .map((e) => {
      if (e.kind === 'nav') return { action: `Navigate to ${e.url}`, url: e.url };
      if (e.kind === 'click') return { action: `Click ${e.selector || e.text}`, selector: e.selector };
      if (e.kind === 'input') return { action: `Enter value into ${e.selector}`, selector: e.selector };
      return { action: `Capture screenshot: ${e.text || 'page'}`, note: e.text };
    });
  const blocks = events.filter((e) => e.kind === 'guard_block').map((e) => e.text);
  return {
    workflowName: session.title || `${session.website || 'Browser'} workflow`,
    website: session.website,
    purpose: session.title || 'Reusable browser workflow captured from a live demonstration.',
    steps,
    fieldsToExtract: [],
    screenshotsRequired: events.filter((e) => e.kind === 'screenshot').map((e) => e.text || 'page'),
    decisionPoints: [],
    businessRules: [],
    operatorPreferences: [],
    exceptions: [],
    commonMistakes: [],
    neverDo: ['Never purchase reports, comps, or sold data.', 'Never checkout, subscribe, or enter payment.'],
    paidActionBlockers: blocks.length ? blocks : ['Stop and mark Approval Required on any billing/checkout/paid action.'],
    failureHandling: ['If a step fails, capture a screenshot and stop for review.'],
    qaChecklist: ['Confirm each extracted field is present and plausible.'],
    expectedOutputs: [],
  };
}

/** Validate/coerce arbitrary LLM output into the SynthesizedPlaybook shape. */
export function coercePlaybook(raw: unknown, fallback: SynthesizedPlaybook): SynthesizedPlaybook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean) : [];
  const steps = Array.isArray(r.steps)
    ? (r.steps as unknown[]).map((s) => {
        if (typeof s === 'string') return { action: s };
        const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
        return {
          action: String(o.action ?? o.step ?? ''),
          selector: o.selector ? String(o.selector) : undefined,
          url: o.url ? String(o.url) : undefined,
          note: o.note ? String(o.note) : undefined,
        };
      }).filter((s) => s.action)
    : fallback.steps;
  return {
    workflowName: typeof r.workflowName === 'string' && r.workflowName ? r.workflowName : fallback.workflowName,
    website: typeof r.website === 'string' && r.website ? r.website : fallback.website,
    purpose: typeof r.purpose === 'string' && r.purpose ? r.purpose : fallback.purpose,
    steps: steps.length ? steps : fallback.steps,
    fieldsToExtract: strArr(r.fieldsToExtract).length ? strArr(r.fieldsToExtract) : fallback.fieldsToExtract,
    screenshotsRequired: strArr(r.screenshotsRequired).length ? strArr(r.screenshotsRequired) : fallback.screenshotsRequired,
    decisionPoints: strArr(r.decisionPoints),
    businessRules: strArr(r.businessRules),
    operatorPreferences: strArr(r.operatorPreferences),
    exceptions: strArr(r.exceptions),
    commonMistakes: strArr(r.commonMistakes),
    neverDo: strArr(r.neverDo).length ? strArr(r.neverDo) : fallback.neverDo,
    paidActionBlockers: strArr(r.paidActionBlockers).length ? strArr(r.paidActionBlockers) : fallback.paidActionBlockers,
    failureHandling: strArr(r.failureHandling).length ? strArr(r.failureHandling) : fallback.failureHandling,
    qaChecklist: strArr(r.qaChecklist).length ? strArr(r.qaChecklist) : fallback.qaChecklist,
    expectedOutputs: strArr(r.expectedOutputs),
  };
}

function playbookPrompt(session: TrainingSession, transcript: string): string {
  return [
    'You are turning a live browser-training demonstration into a reusable Browser Playbook',
    'that a future automated browser agent can execute. Below is the recorded transcript of',
    'Tyler talking through the workflow, interleaved with the exact browser events captured',
    '(navigations, clicks, inputs, screenshots) and any blocked paid actions.',
    '',
    `Website: ${session.website || '(unknown)'}`,
    `Session title: ${session.title || '(none)'}`,
    '',
    'TRANSCRIPT + EVENTS:',
    transcript || '(no events captured)',
    '',
    'Return ONLY JSON with exactly these keys:',
    '{',
    '  "workflowName": string,',
    '  "website": string,',
    '  "purpose": string,',
    '  "steps": [{"action": string, "selector": string, "url": string, "note": string}],',
    '  "fieldsToExtract": string[],',
    '  "screenshotsRequired": string[],',
    '  "decisionPoints": string[],',
    '  "businessRules": string[],',
    '  "operatorPreferences": string[],',
    '  "exceptions": string[],',
    '  "commonMistakes": string[],',
    '  "neverDo": string[],',
    '  "paidActionBlockers": string[],',
    '  "failureHandling": string[],',
    '  "qaChecklist": string[],',
    '  "expectedOutputs": string[]',
    '}',
    'Rules: base steps on the captured browser events, not guesses. Always include the',
    'paid-action blockers. Never include passwords, keys, tokens, or cookies. Be concrete.',
  ].join('\n');
}

/**
 * Synthesize a draft playbook for a session and persist it. Uses the LLM when
 * available; always falls back to the deterministic version so this never fails
 * to produce a reviewable draft.
 */
export async function synthesizePlaybook(sessionId: number): Promise<TrainingPlaybook> {
  const session = getTrainingSession(sessionId);
  if (!session) throw new Error(`training session ${sessionId} not found`);
  const events = listTrainingEvents(sessionId);
  const fallback = synthesizeFromEventsDeterministic(session, events);

  let playbook = fallback;
  try {
    const transcript = redactSecrets(buildTranscript(events)).text;
    const text = await generateContent(playbookPrompt(session, transcript), SYNTHESIS_MODEL);
    const parsed = parseJsonResponse<unknown>(text);
    if (parsed) playbook = coercePlaybook(parsed, fallback);
  } catch {
    // Keep deterministic fallback — synthesis must always yield a draft.
  }

  const slug = slugify(playbook.workflowName);
  // Attach captured per-field selectors so live execution can extract + write
  // Deal Card facts. Bindings are deterministic (from what Tyler named on screen).
  const fieldSelectors = fieldSelectorsFromBindings(sessionId);
  const body = { ...(playbook as unknown as Record<string, unknown>), fieldSelectors };
  const saved = saveDraftPlaybook({
    sessionId,
    slug,
    name: playbook.workflowName,
    website: playbook.website || session.website,
    body,
    sourceRef: `training_session:${sessionId}`,
  });
  landosAudit('browser-training', 'training_playbook_draft', `${slug} v${saved.version} from session ${sessionId}`, {
    refTable: 'landos_training_playbook',
    refId: saved.id,
  });
  return saved;
}

// ── Knowledge extraction ─────────────────────────────────────────────

const KNOWLEDGE_CATEGORIES: KnowledgeCategory[] = [
  'business_rule',
  'provider_quirk',
  'operator_preference',
  'website_change',
  'observation',
  'never_do',
];

function knowledgePrompt(session: TrainingSession, transcript: string): string {
  return [
    'From the browser-training transcript below, extract ORGANIZATIONAL KNOWLEDGE that is',
    'separate from the step-by-step workflow: business rules, provider quirks, operator',
    'preferences, noticed website changes, recurring observations, and "never do this" rules.',
    '',
    `Website: ${session.website || '(unknown)'}`,
    'TRANSCRIPT:',
    transcript || '(none)',
    '',
    'Return ONLY a JSON array. Each item: {"category": one of',
    `[${KNOWLEDGE_CATEGORIES.join(', ')}], "title": short string, "body": one or two sentences}.`,
    'Only include things Tyler actually stated or that are clearly implied. No secrets. If',
    'nothing qualifies, return [].',
  ].join('\n');
}

/**
 * Extract knowledge candidates (status "proposed"). They are NOT saved as
 * permanent knowledge until Tyler confirms at session end.
 */
export async function extractKnowledge(sessionId: number): Promise<TrainingKnowledge[]> {
  const session = getTrainingSession(sessionId);
  if (!session) throw new Error(`training session ${sessionId} not found`);
  const events = listTrainingEvents(sessionId);
  const transcript = redactSecrets(buildTranscript(events)).text;

  let items: { category: KnowledgeCategory; title: string; body: string }[] = [];
  try {
    const text = await generateContent(knowledgePrompt(session, transcript), SYNTHESIS_MODEL);
    const parsed = parseJsonResponse<unknown>(text);
    if (Array.isArray(parsed)) {
      items = parsed
        .map((raw) => {
          const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
          const category = KNOWLEDGE_CATEGORIES.includes(o.category as KnowledgeCategory)
            ? (o.category as KnowledgeCategory)
            : 'observation';
          return { category, title: String(o.title ?? '').trim(), body: String(o.body ?? '').trim() };
        })
        .filter((k) => k.title && k.body);
    }
  } catch {
    items = [];
  }

  return items.map((k) =>
    saveKnowledgeItem({
      sessionId,
      category: k.category,
      title: k.title,
      body: k.body,
      website: session.website,
      status: 'proposed',
    }),
  );
}

// ── Usage rollups ────────────────────────────────────────────────────

export interface UsageRollup {
  provider: string;
  model: string;
  today: { sessions: number; durationMs: number; costUsd: number };
  week: { sessions: number; durationMs: number; costUsd: number };
  month: { sessions: number; durationMs: number; costUsd: number };
  lifetime: { sessions: number; durationMs: number; costUsd: number };
  playbooksCreated: number;
}

function windowStats(sessions: TrainingSession[], sinceEpoch: number) {
  const rows = sessions.filter((s) => s.createdAt >= sinceEpoch);
  return {
    sessions: rows.length,
    durationMs: rows.reduce((a, s) => a + (s.durationMs || 0), 0),
    costUsd: Number(rows.reduce((a, s) => a + (s.estCostUsd || 0), 0).toFixed(4)),
  };
}

export function usageRollup(now = Date.now()): UsageRollup {
  const sessions = listTrainingSessions(1000);
  const nowSec = Math.floor(now / 1000);
  const day = 86400;
  const playbooks = listLatestPlaybooks(1000).length;
  return {
    provider: 'gemini',
    model: GEMINI_LIVE_MODEL,
    today: windowStats(sessions, nowSec - day),
    week: windowStats(sessions, nowSec - day * 7),
    month: windowStats(sessions, nowSec - day * 30),
    lifetime: windowStats(sessions, 0),
    playbooksCreated: playbooks,
  };
}

// Re-exports so routes/tests import from one module.
export { listTrainingSessions, listTrainingEvents, getTrainingSession, listKnowledge };
