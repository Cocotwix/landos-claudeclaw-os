// Browser Training → Browser Agent bridge.
//
// Turns an APPROVED trained playbook into something the Browser Agent executor
// (executeBrowserPlaybook) can run: it wraps the recorded steps as a generic
// BrowserPlaybook whose run() drives a live CDP page, enforces the training
// security guard on every step, captures screenshots, extracts fields, and stays
// dry-run safe by default. Results are persisted and, when the run is live and
// tied to a Deal Card, captured facts are written back.
//
// Hard rules:
//  - Only status='approved' playbooks execute. Drafts are refused before any
//    browser action.
//  - Dry-run is the default. Live (mutating clicks/typing + Deal Card writeback)
//    must be explicitly requested.
//  - A paid/prohibited action stops the run immediately and marks Approval
//    Required — never purchased, never bypassed.

import {
  executeBrowserPlaybook,
  isScopeAllowed,
  type BrowserPlaybook,
  type PlaybookBackend,
  type PlaybookExtraction,
  type PlaybookProvenance,
  type PlaybookRunHooks,
} from './browser-agent.js';
import { screenPaidAction, screenPaidUrl } from './training-security.js';
import {
  getPlaybook,
  getTrainingSession,
  saveTrainingExecution,
  type BlockedAction,
  type ExecutionMode,
  type ExecutionStatus,
  type ExtractedField,
  type TrainingExecution,
  type TrainingPlaybook,
} from './browser-training-db.js';
import { writeBrowserFact } from './browser-fact-store.js';
import { withWorkingPage, type PageLike } from './browser-session.js';
import { createApproval, landosAudit } from './db.js';
import {
  chooseExtraction, labelValueScript, selectorTextScript, toFactConfidence,
  type FieldSelectorEntry,
} from './field-binding.js';

export const TRAINED_PLAYBOOK_PROVIDER = 'browser_agent:trained';

export interface TrainedExecRequest {
  mode: ExecutionMode;
  vars: Record<string, string>;
  dealCardId: number | null;
}
export interface TrainedItem { field: string; value: string; selector: string }

export interface TrainedBackend extends PlaybookBackend {
  getPage(): Promise<PageLike>;
  screenshotDir?: string;
}

interface RunDiagnostics {
  blockedActions: BlockedAction[];
  errors: string[];
  extractedFields: ExtractedField[];
  mode: ExecutionMode;
}

function applyVars(text: string, vars: Record<string, string>): string {
  return (text || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

interface Step { action: string; selector?: string; url?: string; note?: string }

function readSteps(body: Record<string, unknown>): Step[] {
  const raw = Array.isArray(body.steps) ? (body.steps as unknown[]) : [];
  return raw
    .map((s) => {
      if (typeof s === 'string') return { action: s };
      const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
      return {
        action: String(o.action ?? ''),
        selector: o.selector ? String(o.selector) : undefined,
        url: o.url ? String(o.url) : undefined,
        note: o.note ? String(o.note) : undefined,
      };
    })
    .filter((s) => s.action || s.url || s.selector);
}

/**
 * Field→selector map the trainer attaches to a playbook. Accepts both the legacy
 * string form ("#owner") and the rich binding form ({selector,label,confidence,
 * strategy}) so older playbooks keep working.
 */
function readFieldSelectors(body: Record<string, unknown>): Record<string, FieldSelectorEntry> {
  const fs = body.fieldSelectors;
  if (!fs || typeof fs !== 'object') return {};
  const out: Record<string, FieldSelectorEntry> = {};
  for (const [k, v] of Object.entries(fs as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) {
      out[k] = { selector: v, label: '', confidence: 'medium', strategy: 'provided' };
    } else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const selector = typeof o.selector === 'string' ? o.selector : '';
      const label = typeof o.label === 'string' ? o.label : '';
      if (selector || label) {
        out[k] = {
          selector,
          label,
          confidence: (o.confidence as FieldSelectorEntry['confidence']) || 'low',
          strategy: (o.strategy as FieldSelectorEntry['strategy']) || (selector ? 'provided' : 'label'),
        };
      }
    }
  }
  return out;
}

/**
 * Hostnames this playbook is permitted to navigate to: the declared site host
 * only, plus any explicitly operator-declared `allowedHosts`. Deliberately NOT
 * derived from the step URLs — a rogue/erroneous step must not authorize itself.
 */
function allowedHosts(body: Record<string, unknown>): string[] {
  const hosts = new Set<string>();
  const site = typeof body.website === 'string' ? hostOf(body.website) : '';
  if (site) hosts.add(site);
  if (Array.isArray(body.allowedHosts)) {
    for (const h of body.allowedHosts as unknown[]) {
      const host = typeof h === 'string' ? h.trim().toLowerCase() : '';
      if (host) hosts.add(host);
    }
  }
  return [...hosts];
}

/**
 * Build a BrowserPlaybook that replays the trained steps against a live page.
 * The run() records structured blocked/errors/extracted into `diagnostics` so
 * the caller can persist a full execution result.
 */
export function makeTrainedBrowserPlaybook(
  pb: TrainingPlaybook,
): BrowserPlaybook<TrainedExecRequest, TrainedItem, TrainedBackend> {
  const body = pb.body || {};
  const scope = allowedHosts(body);
  const steps = readSteps(body);
  const fieldSelectors = readFieldSelectors(body);

  return {
    id: `trained:${pb.slug}`,
    label: pb.name || pb.slug,
    provider: TRAINED_PLAYBOOK_PROVIDER,
    allowedScope: scope,
    describe() {
      return `Replays the approved trained playbook "${pb.name}" (v${pb.version}) against ${pb.website}. Read-only nav + screenshots + field reads; live mode also performs recorded clicks/inputs. Paid/checkout/billing actions stop the run with Approval Required.`;
    },
    async run(backend, request, hooks: PlaybookRunHooks): Promise<PlaybookExtraction<TrainedItem>> {
      const agentRunId = `trained-${pb.slug}-${Date.now()}`;
      const prov: PlaybookProvenance = {
        provider: TRAINED_PLAYBOOK_PROVIDER,
        playbookId: `trained:${pb.slug}`,
        sourcePage: pb.website,
        extractionTimestamp: new Date().toISOString(),
        agentRunId,
      };
      const diag: RunDiagnostics = { blockedActions: [], errors: [], extractedFields: [], mode: request.mode };
      const scopeVisited: string[] = [];
      const screenshots: string[] = [];
      let page: PageLike;
      try {
        page = await backend.getPage();
      } catch (e) {
        return {
          outcome: 'awaiting_authentication', items: [], rowsCaptured: 0, scopeVisited: [], screenshots: [],
          provenance: prov, note: `No authenticated browser page available: ${(e as Error)?.message ?? String(e)}`,
          diagnostics: diag as unknown as Record<string, unknown>,
        };
      }

      let blocked = false;
      for (let i = 0; i < steps.length; i++) {
        if (hooks.isCancelled?.()) { diag.errors.push(`Cancelled by operator at step ${i}.`); break; }
        const step = steps[i];
        const action = applyVars(step.action, request.vars);
        const url = step.url ? applyVars(step.url, request.vars) : '';
        const selector = step.selector || '';

        // Guard EVERY step in BOTH modes. A paid action stops immediately.
        const urlV = url ? screenPaidUrl(url) : { approvalRequired: false, reason: '' };
        const actV = screenPaidAction(action);
        if (urlV.approvalRequired || actV.approvalRequired) {
          diag.blockedActions.push({ step: i, action, url, reason: urlV.reason || actV.reason });
          blocked = true;
          hooks.onProgress?.(`BLOCKED at step ${i}: ${urlV.reason || actV.reason}`);
          break;
        }

        try {
          if (url) {
            const host = hostOf(url);
            if (host && scope.length && !scope.includes(host)) {
              diag.errors.push(`Step ${i}: off-scope host ${host} (allowed: ${scope.join(', ')}). Stopped.`);
              break;
            }
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
            if (host && !scopeVisited.includes(host)) scopeVisited.push(host);
            hooks.onProgress?.(`Navigated to ${page.url()}`);
          } else if (/^click/i.test(action) && selector) {
            if (request.mode === 'live') {
              const found = await page.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(selector)})`);
              if (found) await page.evaluate(`(document.querySelector(${JSON.stringify(selector)}))?.click()`);
              else diag.errors.push(`Step ${i}: click target not found (${selector}).`);
            }
            // dry-run: intentionally does NOT click.
          } else if (/^enter|^input|^type/i.test(action) && selector) {
            if (request.mode === 'live' && page.type) {
              const val = extractInputValue(step, request.vars);
              if (val !== null) await page.type(selector, val);
            }
            // dry-run: does NOT type.
          } else if (/screenshot|capture/i.test(action)) {
            const path = `${backend.screenshotDir ?? 'screenshots'}/exec_${pb.slug}_${i}.png`;
            try { await page.screenshot({ path }); screenshots.push(path); }
            catch (e) { diag.errors.push(`Step ${i}: screenshot failed (${(e as Error)?.message ?? e}).`); }
          }
        } catch (e) {
          diag.errors.push(`Step ${i} (${action}): ${(e as Error)?.message ?? String(e)}`);
        }
      }

      // Field extraction (read-only, safe in both modes): selector first, then a
      // label-match fallback so a changed selector still resolves by its label.
      if (!blocked) {
        for (const [field, entry] of Object.entries(fieldSelectors)) {
          try {
            let selectorValue = '';
            if (entry.selector) {
              selectorValue = (await page.evaluate<string>(selectorTextScript(entry.selector))) || '';
            }
            let labelValue = '';
            if (!selectorValue.trim() && entry.label) {
              labelValue = (await page.evaluate<string>(labelValueScript(entry.label))) || '';
            }
            const choice = chooseExtraction(selectorValue, labelValue);
            if (choice.value) {
              diag.extractedFields.push({
                field, value: choice.value, selector: entry.selector, written: false,
                confidence: entry.confidence, strategy: choice.strategy,
              });
            }
          } catch (e) {
            diag.errors.push(`Extract "${field}": ${(e as Error)?.message ?? String(e)}`);
          }
        }
      }

      const outcome = blocked ? 'error' : 'collected';
      const note = blocked
        ? `APPROVAL_REQUIRED: ${diag.blockedActions.map((b) => b.reason).join('; ')}`
        : `Replayed ${steps.length} step(s) in ${request.mode} mode; ${diag.extractedFields.length} field(s) read, ${screenshots.length} screenshot(s), ${diag.errors.length} error(s).`;

      return {
        outcome,
        items: blocked ? [] : diag.extractedFields.map((f) => ({ field: f.field, value: f.value, selector: f.selector })),
        rowsCaptured: diag.extractedFields.length,
        scopeVisited,
        screenshots,
        provenance: { ...prov, sourcePage: page.url?.() || pb.website },
        note,
        diagnostics: diag as unknown as Record<string, unknown>,
      };
    },
  };
}

function extractInputValue(step: Step, vars: Record<string, string>): string | null {
  // A trained input step may encode its value in the note ("value: X") or a var.
  const note = step.note || '';
  const m = note.match(/value\s*[:=]\s*(.+)/i);
  if (m) return applyVars(m[1].trim(), vars);
  if (vars.inputValue) return vars.inputValue;
  return null;
}

// ── Live backend (production) ────────────────────────────────────────

export function makeLiveTrainedBackend(screenshotDir?: string): TrainedBackend {
  return {
    id: 'trained:live',
    screenshotDir,
    configured() {
      // Enabled only when the live browser session is switched on. Mirrors the
      // Browser Agent's live gate so tests never touch a real browser.
      return process.env.BROWSER_INTEL_LIVE === '1' || process.env.BROWSER_INTEL_LIVE === 'true';
    },
    async getPage(): Promise<PageLike> {
      const held = await withWorkingPage(async (page) => page);
      if (!held.ok || !held.value) throw new Error(`browser session ${held.status}`);
      return held.value;
    },
  };
}

// ── Entry point: approved-only, dry-run-safe execution ───────────────

export interface RunTrainedOptions {
  mode?: ExecutionMode;
  vars?: Record<string, string>;
  dealCardId?: number | null;
  /** Test/DI seam: supply a backend directly (bypasses the live gate). */
  backend?: TrainedBackend;
}

export interface RunTrainedResult {
  ok: boolean;
  error?: string;
  execution?: TrainingExecution;
  agentRunId?: string;
}

/**
 * Execute an approved trained playbook through the Browser Agent executor and
 * persist a full execution result. Refuses drafts. Dry-run by default.
 */
export async function runTrainedPlaybook(playbookId: number, opts: RunTrainedOptions = {}): Promise<RunTrainedResult> {
  const pb = getPlaybook(playbookId);
  if (!pb) return { ok: false, error: 'playbook not found' };

  // Approved-only. Never run a draft/rejected/superseded playbook.
  if (pb.status !== 'approved') {
    landosAudit('browser-agent', 'trained_execution_refused', `playbook ${playbookId} status=${pb.status} (not approved)`, {
      refTable: 'landos_training_playbook', refId: playbookId, blocked: true,
    });
    return { ok: false, error: `playbook is "${pb.status}"; only approved playbooks can be executed` };
  }

  const mode: ExecutionMode = opts.mode === 'live' ? 'live' : 'dry_run';
  // Deal Card link: explicit override, else inherit from the training session.
  const sessionDealCardId = pb.sessionId ? getTrainingSession(pb.sessionId)?.dealCardId ?? null : null;
  const dealCardId = opts.dealCardId ?? sessionDealCardId;
  const request: TrainedExecRequest = { mode, vars: opts.vars ?? {}, dealCardId };

  const playbook = makeTrainedBrowserPlaybook(pb);
  const backend = opts.backend ?? makeLiveTrainedBackend();

  const { run, extraction } = await executeBrowserPlaybook(playbook, backend, request, {
    hooks: {},
  });

  const diag = (extraction.diagnostics ?? {}) as unknown as RunDiagnostics;
  const blockedActions = Array.isArray(diag.blockedActions) ? diag.blockedActions : [];
  const errors = Array.isArray(diag.errors) ? diag.errors : [];
  const extractedFields: ExtractedField[] = Array.isArray(diag.extractedFields) ? diag.extractedFields : [];

  // Deal Card writeback — LIVE mode only, and only when tied to a Deal Card.
  let fieldsWritten = 0;
  if (mode === 'live' && dealCardId && extractedFields.length && blockedActions.length === 0) {
    for (const f of extractedFields) {
      writeBrowserFact(dealCardId, {
        key: f.field,
        label: f.field,
        value: f.value,
        sourceName: pb.name,
        sourceType: 'trained_playbook',
        sourceUrl: pb.website,
        origin: 'landportal',
        confidence: toFactConfidence(f.confidence),
        status: 'extracted',
        extractionMethod: `trained playbook: ${pb.slug} v${pb.version} (${f.strategy ?? 'selector'} match)`,
      }, 'browser-agent');
      f.written = true;
      fieldsWritten += 1;
    }
  }

  // Status + Approval Required.
  let status: ExecutionStatus;
  let approvalRequired = false;
  if (blockedActions.length > 0) {
    status = 'blocked';
    approvalRequired = true;
    createApproval({
      actionType: 'trained_playbook_paid_action',
      title: `Paid/prohibited action during "${pb.name}" replay`,
      payload: { playbookId, blockedActions },
      requestedBy: 'browser-agent',
    });
    landosAudit('browser-agent', 'trained_execution_blocked', blockedActions.map((b) => b.reason).join('; '), {
      refTable: 'landos_training_playbook', refId: playbookId, blocked: true,
    });
  } else if (run.status === 'not_configured') {
    status = 'not_configured';
  } else if (run.status === 'awaiting_authentication' || extraction.outcome === 'awaiting_authentication') {
    status = 'awaiting_authentication';
  } else if (run.status === 'failed') {
    status = 'failed';
  } else if (errors.length > 0) {
    status = extractedFields.length > 0 ? 'partial' : 'failed';
  } else {
    status = 'succeeded';
  }

  const qaNotes = buildQaNotes({ mode, status, extractedFields, blockedActions, errors, fieldsWritten, dealCardId, run });

  const execution = saveTrainingExecution({
    playbookId,
    playbookSlug: pb.slug,
    agentRunId: run.agentRunId,
    dealCardId,
    mode,
    status,
    approvalRequired,
    fieldsWritten,
    extractedFields,
    blockedActions,
    errors,
    screenshots: run.screenshots,
    qaNotes,
  });

  landosAudit('browser-agent', 'trained_execution', `${pb.slug} v${pb.version} (${mode}) → ${status}; ${extractedFields.length} field(s), ${fieldsWritten} written, ${run.screenshots.length} shot(s)`, {
    refTable: 'landos_training_execution', refId: execution.id,
  });

  return { ok: true, execution, agentRunId: run.agentRunId };
}

function buildQaNotes(x: {
  mode: ExecutionMode; status: ExecutionStatus; extractedFields: ExtractedField[];
  blockedActions: BlockedAction[]; errors: string[]; fieldsWritten: number; dealCardId: number | null;
  run: { status: string; scopeVisited: string[] };
}): string {
  const parts: string[] = [];
  parts.push(`Mode: ${x.mode}. Status: ${x.status}.`);
  if (x.blockedActions.length) parts.push(`STOPPED — paid/prohibited action(s): ${x.blockedActions.map((b) => b.reason).join('; ')}.`);
  parts.push(`Fields read: ${x.extractedFields.length}; written to Deal Card: ${x.fieldsWritten}${x.dealCardId ? ` (#${x.dealCardId})` : ' (none linked)'}.`);
  if (x.mode === 'dry_run') parts.push('Dry-run: navigation + screenshots + field reads only; no clicks, no typing, no Deal Card writeback.');
  if (x.errors.length) parts.push(`Errors: ${x.errors.length}.`);
  if (x.run.scopeVisited.length) parts.push(`Hosts visited: ${x.run.scopeVisited.join(', ')}.`);
  return parts.join(' ');
}
